import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  AppError,
  type AddExtraStopInput,
  type NewShopInput,
} from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';

/** Own module-level, unextended Prisma client — the established pattern in this module. */
const prisma = new PrismaClient();

type ExtraStopTx = Pick<
  PrismaClient,
  | 'dailyAssignment'
  | 'assignmentStop'
  | 'shop'
  | 'companySettings'
  | '$executeRaw'
>;

/**
 * The response for `POST /assignments/:id/stops`.
 *
 * Four fields and a count — **no distance, no radius, no flags** — the same
 * discipline as `POST /visits`, whose response is deliberately three fields.
 *
 * `pinStatus` is here because the screen must route onward: `APPROVED` → the
 * visit screen, anything else → capture the pin first. That is the rule
 * board 1.3's stop list already applies.
 */
export interface AddExtraStopResult {
  stopId: string;
  shopId: string;
  shopName: string;
  pinStatus: 'NONE' | 'PENDING_VERIFICATION' | 'APPROVED';
  /**
   * The size of the day AFTER the add — board 1.4's "as stop 13 today".
   *
   * **Not the `sequence` column.** `sequence` is an append (one past the
   * current maximum) and is never displayed; `StopRow` renders 'EX' for any
   * non-PLAN stop. Conflating the two would show a wrong number the moment
   * any stop had been added before (data-model.md).
   */
  totalStopsToday: number;
}

/**
 * The same fallback `ensureTodayRoute` uses when a company has no settings
 * row. Kept identical on purpose — two code paths freezing a different
 * radius onto two stops of the same day would be a silent inconsistency.
 */
const DEFAULT_RADIUS_METRES = 5;

/** How many times a generated shop code may collide before giving up. */
const SHOP_CODE_ATTEMPTS = 5;

/**
 * Backs `POST /assignments/:id/stops` — an executive adding an unplanned
 * shop to their own running day (007-extra-shops, board 1.4).
 *
 * Belongs to the assignments module, which owns the `DailyAssignment`
 * aggregate. The manager's sibling (`POST /assignments/:id/stops/manager`,
 * with its extra `reason`) is a later slice and will live beside this one
 * rather than require a refactor (research.md §1).
 *
 * Three guarantees are worth stating plainly, because they are what this
 * service exists to provide:
 *
 *  1. **The beat plan is never written.** An extra stop is an
 *     `AssignmentStop` on one day; `BeatPlan` and `BeatPlanShop` are not
 *     touched, read or otherwise (FR-010, SC-004).
 *  2. **A shop cannot be added twice.** That is the database constraint
 *     `@@unique([assignmentId, shopId])`, not an application pre-check —
 *     which is what makes it survive two devices racing (FR-011, SC-005).
 *  3. **The same facts are frozen as for a planned stop.** The effective
 *     radius and the shop's approved coordinates are snapshotted here
 *     exactly as `ensureTodayRoute` snapshots them, so a later master edit
 *     cannot rewrite the day (FR-013).
 */
@Injectable()
export class ExtraStopService {
  constructor(private readonly cls: ClsService<TransactionClsStore>) {}

  private tx(): ExtraStopTx {
    const store = this.cls.get();
    return (store?.tx as ExtraStopTx | undefined) ?? prisma;
  }

  /** See `assignments.service.ts` — identical. */
  private async scopeToCaller(companyId: string): Promise<ExtraStopTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  /**
   * One transaction, in the order `contracts/extra-shops.md` specifies.
   *
   * The whole method runs inside the request transaction the interceptor
   * opened, which is what lets step 5 (creating the shop) and step 10
   * (creating the stop) be atomic — FR-017. A shop created without its stop
   * would be an orphan the executive never sees again.
   */
  async addExtraStop(
    companyId: string,
    executiveId: string,
    assignmentId: string,
    input: AddExtraStopInput,
  ): Promise<AddExtraStopResult> {
    const tx = await this.scopeToCaller(companyId);

    // (3) The caller's OWN day. An id that is unknown, another company's or
    // another executive's is a 404 alike — never a 403, which would confirm
    // the row exists.
    const assignment = await tx.dailyAssignment.findFirst({
      where: { id: assignmentId, executiveId },
      select: { id: true, status: true },
    });
    if (!assignment) {
      throw new AppError('NOT_FOUND', 'Beat day not found.');
    }

    // (4) No stop may be added outside a RUNNING day (FR-002). Before it is
    // started there is nothing to add to; after it has ended, a shop added
    // after the fact would misrepresent the day.
    if (assignment.status === null) {
      throw new AppError(
        'BEAT_NOT_STARTED',
        'Start the beat before adding an extra shop.',
      );
    }
    if (assignment.status === 'ENDED') {
      throw new AppError(
        'BEAT_DAY_ENDED',
        'This beat day has ended, so no more shops can be added.',
      );
    }

    const settings = await tx.companySettings.findUnique({
      where: { companyId },
      select: { defaultRadiusMeters: true, autoApproveExecPins: true },
    });
    const defaultRadius =
      settings?.defaultRadiusMeters ?? DEFAULT_RADIUS_METRES;

    // (5) / (6) Either create the shop from the field, or load the one the
    // executive picked. Both paths end with the same four fields.
    const shop = input.newShop
      ? await this.createFieldShop(
          tx,
          companyId,
          executiveId,
          input.newShop,
          settings?.autoApproveExecPins ?? false,
        )
      : await this.loadAddableShop(tx, input.shopId!);

    // (7) The shop's override or the company default — the same rule, and the
    // same `5` fallback, as `assignments.service.ts`'s route creation.
    const effectiveRadiusMeters =
      shop.verificationRadiusMeters ?? defaultRadius;

    // (8) Freeze the coordinate a later visit is measured against — ONLY when
    // the pin is approved. A pending pin is not yet the shop's location and
    // cannot accept an outcome; the capture flow fills these in later.
    const approved = shop.locationStatus === 'APPROVED';

    // (9) An append, not a position. `orderStops` sorts by status group, then
    // extras ahead of planned, then sequence — and the number is never shown
    // — so appending simply preserves the order extras were added in, which
    // is the only ordering the executive could expect (research.md §4).
    const highest = await tx.assignmentStop.aggregate({
      where: { assignmentId: assignment.id },
      _max: { sequence: true },
    });
    const sequence = (highest._max.sequence ?? -1) + 1;

    let stopId: string;
    try {
      // (10) The one write that matters.
      const stop = await tx.assignmentStop.create({
        data: {
          companyId,
          assignmentId: assignment.id,
          shopId: shop.id,
          sequence,
          source: 'EXEC_EXTRA',
          status: 'PENDING',
          // Who and when — the server's clock, never the device's claim.
          addedByUserId: executiveId,
          addedAt: new Date(),
          effectiveRadiusMeters,
          shopLatitude: approved ? shop.latitude : null,
          shopLongitude: approved ? shop.longitude : null,
        },
        select: { id: true },
      });
      stopId = stop.id;
    } catch (error) {
      // (11) P2002 on (assignmentId, shopId). The DATABASE refused the
      // duplicate, which is what makes FR-011 hold for two devices racing
      // with different idempotency keys — eight concurrent adds give exactly
      // one 201 and seven of these.
      //
      // Note this is a REFUSAL, not the silent success `ensureTodayRoute`
      // returns for its own P2002: there, the caller asked for today's route
      // and got it; here the caller asked to add a shop that is already
      // there, and reporting success would tell them they added something
      // they did not.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          'SHOP_ALREADY_IN_BEAT',
          "This shop is already on today's list.",
        );
      }
      throw error;
    }

    const totalStopsToday = await tx.assignmentStop.count({
      where: { assignmentId: assignment.id },
    });

    return {
      stopId,
      shopId: shop.id,
      shopName: shop.name,
      pinStatus: shop.locationStatus,
      totalStopsToday,
    };
  }

  /**
   * The shop the executive picked. Inactive, missing, or another company's
   * (which RLS and the Prisma extension already exclude) are all one 404 —
   * an inactive shop is one the company has withdrawn, and putting it back
   * on a route through a side door would defeat that.
   */
  private async loadAddableShop(tx: ExtraStopTx, shopId: string) {
    const shop = await tx.shop.findFirst({
      where: { id: shopId, isActive: true },
      select: this.shopSelect,
    });
    if (!shop) {
      throw new AppError('NOT_FOUND', 'Shop not found.');
    }
    return shop;
  }

  /**
   * Creates a shop from the field (FR-016 … FR-018), in the same transaction
   * as the stop.
   *
   * **Deliberately not `ShopsService.create`**, for three reasons
   * (research.md §6):
   *
   *  1. *Role.* `ShopsController` is class-level `@Roles('COMPANY_ADMIN')`;
   *     an executive gets 403.
   *  2. *Approval.* That method sets `locationStatus: 'APPROVED'` with
   *     `locationVerifiedBy` set to the caller, justified by the caller being
   *     a Company Admin — "a brand-new shop has no prior approved pin to
   *     protect". An executive is not an admin, and FR-018 requires the
   *     opposite: the shop must be identifiable as awaiting confirmation. So
   *     the company's auto-approve setting decides, exactly as it does for
   *     executive pin capture in `shop-pin.service.ts`.
   *  3. *Atomicity.* FR-017 requires the shop and the stop to arrive
   *     together.
   *
   * **The consequence is recorded, not hidden**: with auto-approval off the
   * executive creates a shop, the stop is added with its coordinates left
   * null, and no outcome can be recorded there until an admin approves. Same
   * dead-end slice 006 flagged for pin capture, reached by a second route.
   * The pilot company should have auto-approval enabled.
   */
  private async createFieldShop(
    tx: ExtraStopTx,
    companyId: string,
    executiveId: string,
    input: NewShopInput,
    autoApprove: boolean,
  ) {
    const locationStatus = autoApprove ? 'APPROVED' : 'PENDING_VERIFICATION';
    const capturedAt = new Date(input.capturedAt);

    // `shopCode` is required and unique per company, but asking someone
    // standing in front of a shop to invent one is a bad field interaction
    // and a collision waiting to happen. The server derives one and retries;
    // the Company Admin can rename it during review.
    for (let attempt = 0; attempt < SHOP_CODE_ATTEMPTS; attempt += 1) {
      try {
        return await tx.shop.create({
          data: {
            companyId,
            shopCode: this.generateShopCode(input.name),
            name: input.name,
            isActive: true,
            ownerName: input.ownerName ?? null,
            phone: input.phone ?? null,
            addressLine1: input.addressLine1 ?? null,
            city: input.city ?? null,
            latitude: new Prisma.Decimal(input.latitude),
            longitude: new Prisma.Decimal(input.longitude),
            locationSource: 'GPS',
            locationStatus,
            locationAccuracyMeters: input.accuracyMeters,
            locationCapturedAt: capturedAt,
            locationCapturedBy: executiveId,
            // locationVerifiedAt / locationVerifiedBy stay null unless an
            // admin approves — that is what "awaiting confirmation" IS.
            ...(autoApprove
              ? { locationVerifiedAt: new Date(), locationVerifiedBy: null }
              : {}),
          },
          select: this.shopSelect,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new AppError(
      'DUPLICATE_SHOP_CODE',
      'Could not allocate a shop code. Please try again.',
    );
  }

  /**
   * A readable, company-unique-ish code derived from the name plus a random
   * suffix. Collisions are handled by the retry above rather than by trying
   * to be clever here.
   */
  private generateShopCode(name: string): string {
    const prefix =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 6) || 'SHOP';
    const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `${prefix}-${suffix}`;
  }

  private readonly shopSelect = {
    id: true,
    name: true,
    latitude: true,
    longitude: true,
    locationStatus: true,
    verificationRadiusMeters: true,
  } as const;
}
