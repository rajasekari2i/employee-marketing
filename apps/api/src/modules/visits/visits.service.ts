import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppError, type SubmitVisitInput } from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { haversineMetres } from './haversine';

/** Own module-level, unextended Prisma client — the established pattern. */
const prisma = new PrismaClient();

type VisitsTx = Pick<
  PrismaClient,
  | 'assignmentStop'
  | 'visit'
  | 'order'
  | 'orderLine'
  | 'brand'
  | 'reasonMessage'
  | 'companySettings'
  | '$executeRaw'
>;

export type BlockedReason =
  | 'BEAT_NOT_RUNNING'
  | 'ALREADY_COMPLETED'
  | 'PIN_MISSING'
  | 'PIN_PENDING_APPROVAL';

export interface StopDetail {
  id: string;
  sequence: number;
  positionLabel: string;
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'REVISIT';
  canRecordOutcome: boolean;
  blockedReason: BlockedReason | null;
  shop: {
    id: string;
    shopCode: string;
    name: string;
    addressLine: string | null;
    ownerName: string | null;
    phone: string | null;
    pinStatus: 'NONE' | 'PENDING_VERIFICATION' | 'APPROVED';
  };
  lastFive: Array<{
    visitedOn: string;
    outcome: 'ORDER' | 'NO_ORDER';
    summary: string;
    recordedBy: string;
  }>;
}

export interface SubmitVisitResult {
  visitId: string;
  stopId: string;
  status: 'COMPLETED';
}

/**
 * Backs `GET /stops/:id` and `POST /visits` (006-visit-outcomes; shapes per
 * contracts/visits.md).
 *
 * Scoping is **three** layers, not two. The Prisma extension and Postgres RLS
 * separate companies; every method here additionally narrows to the caller's
 * own JWT-verified `executiveId`, so one executive can never read or record
 * against another's stop inside the same company.
 *
 * **Nothing in this file selects `distanceMeters`, `isExceedRange`, `flags`,
 * `reviewStatus`, `effectiveRadiusMeters` or the frozen shop coordinates into
 * a response.** They are written on every visit and read by the manager
 * review slice. The guarantee is that the names never appear in an
 * executive-facing select list — a field that is never loaded cannot be
 * leaked by a later refactor (research.md §8).
 */
@Injectable()
export class VisitsService {
  constructor(private readonly cls: ClsService<TransactionClsStore>) {}

  private tx(): VisitsTx {
    const store = this.cls.get();
    return (store?.tx as VisitsTx | undefined) ?? prisma;
  }

  /** See `assignments.service.ts` — identical, for this module's models. */
  private async scopeToCaller(companyId: string): Promise<VisitsTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  /**
   * `GET /stops/:id` — the visit screen (board 1.7).
   *
   * `lastFive` is the **shop's** five most recent visits by anyone, not the
   * caller's: the point is what this shop has been doing, and the design
   * shows who recorded each one.
   */
  async getStopDetail(
    companyId: string,
    executiveId: string,
    stopId: string,
  ): Promise<StopDetail> {
    const tx = await this.scopeToCaller(companyId);

    const stop = await tx.assignmentStop.findFirst({
      where: { id: stopId, assignment: { executiveId } },
      select: {
        id: true,
        sequence: true,
        status: true,
        assignment: {
          select: { status: true, _count: { select: { stops: true } } },
        },
        shop: {
          select: {
            id: true,
            shopCode: true,
            name: true,
            addressLine1: true,
            city: true,
            ownerName: true,
            phone: true,
            locationStatus: true,
          },
        },
      },
    });

    if (!stop) {
      throw new AppError('NOT_FOUND', 'Stop not found.');
    }

    const blockedReason = this.blockedReasonFor(
      stop.assignment.status,
      stop.status,
      stop.shop.locationStatus,
    );

    const history = await tx.visit.findMany({
      where: { shopId: stop.shop.id },
      orderBy: { receivedAt: 'desc' },
      take: 5,
      // Deliberately narrow: no distance, verdict, flags, radius or frozen
      // coordinates. See this class's doc comment.
      select: {
        receivedAt: true,
        outcome: true,
        reasonLabel: true,
        executive: { select: { name: true } },
        order: { select: { brandCount: true, totalQuantity: true } },
      },
    });

    return {
      id: stop.id,
      sequence: stop.sequence,
      // Correct for an extra stop too (007-extra-shops): `sequence` is
      // 0-based for planned stops (`beat-plans.service.ts` writes
      // `sequence: index`) and an extra stop is appended at `max + 1`, so a
      // 12-stop day's first extra reads "Stop 13 of 13". Nothing in this
      // service reads `AssignmentStop.source` — an EXEC_EXTRA stop takes the
      // identical path, which is FR-014 expressed as code: there is no
      // second path.
      positionLabel: `Stop ${stop.sequence + 1} of ${stop.assignment._count.stops}`,
      status: stop.status,
      canRecordOutcome: blockedReason === null,
      blockedReason,
      shop: {
        id: stop.shop.id,
        shopCode: stop.shop.shopCode,
        name: stop.shop.name,
        addressLine:
          [stop.shop.addressLine1, stop.shop.city]
            .filter((part): part is string => Boolean(part))
            .join(', ') || null,
        ownerName: stop.shop.ownerName,
        phone: stop.shop.phone,
        pinStatus: stop.shop.locationStatus,
      },
      lastFive: history.map((visit) => ({
        visitedOn: visit.receivedAt.toISOString().slice(0, 10),
        outcome: visit.outcome,
        summary:
          visit.outcome === 'ORDER'
            ? `${visit.order?.brandCount ?? 0} brands · ${visit.order?.totalQuantity ?? 0} qty`
            : (visit.reasonLabel ?? 'No order'),
        recordedBy: visit.executive.name,
      })),
    };
  }

  /** The four states that stop an outcome being recorded, in precedence order. */
  private blockedReasonFor(
    dayStatus: string | null,
    stopStatus: string,
    pinStatus: string,
  ): BlockedReason | null {
    if (dayStatus !== 'RUNNING') {
      return 'BEAT_NOT_RUNNING';
    }
    if (stopStatus === 'COMPLETED') {
      return 'ALREADY_COMPLETED';
    }
    if (pinStatus === 'NONE') {
      return 'PIN_MISSING';
    }
    if (pinStatus === 'PENDING_VERIFICATION') {
      return 'PIN_PENDING_APPROVAL';
    }
    return null;
  }

  /**
   * `POST /visits` — **the critical path**.
   *
   * Everything below happens in ONE transaction, in Architecture §10's order
   * (research.md §7). The ordering is not arbitrary: the rejections come
   * before any computation so an invalid submission costs nothing; the
   * measurement happens before the write so a visit is never stored without
   * its verdict; and the stop is marked completed in the same transaction as
   * the visit, which is what makes "exactly one outcome per stop" true under
   * concurrency rather than merely likely.
   */
  async submitVisit(
    companyId: string,
    executiveId: string,
    input: SubmitVisitInput,
  ): Promise<SubmitVisitResult> {
    const tx = await this.scopeToCaller(companyId);

    // 1. Load, scoped to the company AND this executive.
    const stop = await tx.assignmentStop.findFirst({
      where: { id: input.stopId, assignment: { executiveId } },
      select: {
        id: true,
        assignmentId: true,
        shopId: true,
        status: true,
        effectiveRadiusMeters: true,
        shopLatitude: true,
        shopLongitude: true,
        // 008-my-visits: businessDate is snapshotted onto the visit below.
        assignment: { select: { status: true, businessDate: true } },
        shop: { select: { locationStatus: true } },
      },
    });

    if (!stop) {
      throw new AppError('NOT_FOUND', 'Stop not found.');
    }

    // 2. Reject everything that makes this submission impossible, before
    //    doing any work.
    if (stop.assignment.status === null) {
      throw new AppError(
        'BEAT_NOT_STARTED',
        'Start the beat before recording a visit.',
      );
    }
    if (stop.assignment.status === 'ENDED') {
      throw new AppError(
        'BEAT_DAY_ENDED',
        'The beat has ended for today, so no more visits can be recorded.',
      );
    }
    if (stop.status === 'COMPLETED') {
      throw new AppError(
        'STOP_ALREADY_COMPLETED',
        'An outcome is already recorded for this shop today.',
      );
    }
    if (stop.shop.locationStatus !== 'APPROVED' || stop.shopLatitude === null) {
      throw new AppError(
        'SHOP_PIN_REQUIRED',
        "This shop's location must be saved before an outcome can be recorded.",
      );
    }

    // 3. Resolve the outcome's own data — and validate the masters are
    //    active and in this company, so a retired brand or reason cannot be
    //    recorded even if the screen was opened before it was retired.
    const resolved =
      input.outcome === 'ORDER'
        ? await this.resolveOrder(tx, companyId, input)
        : await this.resolveNoOrder(tx, input);

    // 4-8. Classify, measure, and decide the verdict.
    const settings = await tx.companySettings.findUnique({
      where: { companyId },
      select: { maxAccuracyMeters: true, maxLocationAgeSeconds: true },
    });
    const maxAccuracy = settings?.maxAccuracyMeters ?? 20;
    const maxAgeSeconds = settings?.maxLocationAgeSeconds ?? 120;

    const receivedAt = new Date();
    const capturedAt = new Date(input.capturedAt);
    const flags: Prisma.VisitCreateInput['flags'] = [];

    if (input.accuracyMeters > maxAccuracy) {
      flags.push('LOW_ACCURACY');
    }
    if ((receivedAt.getTime() - capturedAt.getTime()) / 1000 > maxAgeSeconds) {
      flags.push('STALE_LOCATION');
    }
    // No producer today — the geolocation library does not expose the
    // signal (research.md §5). Handled so it is correct the moment one does.
    if (input.isMockLocation === true) {
      flags.push('MOCK_LOCATION_SUSPECTED');
    }
    if (input.fromOfflineQueue === true) {
      flags.push('OFFLINE_SUBMISSION');
    }

    // Measured from the coordinate FROZEN on the stop, not the shop's live
    // row — so an offline visit synced days later is still measured against
    // the location in force when it was recorded (research.md §4).
    const distanceMeters = Math.round(
      haversineMetres(
        Number(stop.shopLatitude),
        Number(stop.shopLongitude),
        input.latitude,
        input.longitude,
      ),
    );
    const isExceedRange = distanceMeters > stop.effectiveRadiusMeters;
    if (isExceedRange) {
      flags.push('EXCEED_RANGE');
    }

    // 9. Write the visit and, for an order, its order and lines TOGETHER —
    //    a visit whose order is missing is unrepresentable (FR-027).
    const visit = await tx.visit.create({
      data: {
        companyId,
        assignmentId: stop.assignmentId,
        stopId: stop.id,
        shopId: stop.shopId,
        executiveId,
        outcome: input.outcome,
        sampleShown: input.sampleShown,
        reasonId: resolved.reasonId,
        reasonLabel: resolved.reasonLabel,
        reasonText: resolved.reasonText,
        capturedLatitude: new Prisma.Decimal(input.latitude),
        capturedLongitude: new Prisma.Decimal(input.longitude),
        accuracyMeters: input.accuracyMeters,
        capturedAt,
        submittedAt: new Date(input.submittedAt),
        receivedAt,
        // 008-my-visits: the business day this visit belongs to, taken from
        // the assignment that already owns it — NEVER derived from a
        // timestamp and never accepted from the body. `businessDate` is
        // absent from submitVisitSchema, which is `.strict()`, so a client
        // sending it gets a 400 (Constitution rules 1 and 8). Do not
        // "helpfully" start accepting it: an offline visit syncing across
        // midnight would then land on the wrong day, which is precisely what
        // this column exists to prevent.
        businessDate: stop.assignment.businessDate,
        shopLatitude: stop.shopLatitude,
        shopLongitude: stop.shopLongitude,
        effectiveRadiusMeters: stop.effectiveRadiusMeters,
        distanceMeters,
        isExceedRange,
        flags,
        // Exceeded visits are ACCEPTED and routed for review — never
        // blocked, and never surfaced to the executive (FR-025).
        reviewStatus: isExceedRange ? 'PENDING_REVIEW' : 'NOT_REQUIRED',
        ...(resolved.order
          ? {
              order: {
                create: {
                  companyId,
                  shopId: stop.shopId,
                  totalQuantity: resolved.order.totalQuantity,
                  brandCount: resolved.order.brandCount,
                  lines: { create: resolved.order.lines },
                },
              },
            }
          : {}),
      },
      select: { id: true },
    });

    // 10. Mark the stop completed inside the same transaction.
    await tx.assignmentStop.update({
      where: { id: stop.id },
      data: { status: 'COMPLETED' },
    });

    // The response carries NO distance, verdict or flags (PRD FR-VISIT-12).
    return { visitId: visit.id, stopId: stop.id, status: 'COMPLETED' };
  }

  /** Order path: every brand must be active and in this company. */
  private async resolveOrder(
    tx: VisitsTx,
    companyId: string,
    input: SubmitVisitInput,
  ) {
    const lines = input.lines ?? [];
    const brandIds = lines.map((line) => line.brandId);

    const brands = await tx.brand.findMany({
      where: { id: { in: brandIds }, isActive: true },
      select: { id: true, label: true },
    });

    if (brands.length !== brandIds.length) {
      throw new AppError(
        'VALIDATION_FAILED',
        'One or more brands are no longer available.',
        [{ path: 'lines', message: 'Unknown or inactive brand.' }],
      );
    }

    const labelById = new Map(brands.map((brand) => [brand.id, brand.label]));

    return {
      reasonId: null,
      reasonLabel: null,
      reasonText: null,
      order: {
        totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
        brandCount: lines.length,
        lines: lines.map((line) => ({
          // Passed explicitly rather than relying on the tenant extension:
          // it injects companyId on a top-level create, and these rows are
          // created through a NESTED create on the visit.
          companyId,
          brandId: line.brandId,
          // Snapshot the label as it reads now.
          brandLabel: labelById.get(line.brandId) ?? '',
          quantity: line.quantity,
        })),
      },
    };
  }

  /**
   * No-order path: the reason must be active and in this company, and free
   * text is required **iff** that reason is the company's system "Other"
   * row — which only the server knows, which is why the shared schema
   * cannot enforce it.
   */
  private async resolveNoOrder(tx: VisitsTx, input: SubmitVisitInput) {
    const reason = await tx.reasonMessage.findFirst({
      where: { id: input.reasonId, isActive: true },
      select: { id: true, label: true, isSystem: true, requiresText: true },
    });

    if (!reason) {
      throw new AppError(
        'VALIDATION_FAILED',
        'That reason is no longer available.',
        [{ path: 'reasonId', message: 'Unknown or inactive reason.' }],
      );
    }

    const needsText = reason.isSystem || reason.requiresText;
    const text = input.reasonText?.trim();

    if (needsText && !text) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Describe the reason — this is required for "Other".',
        [{ path: 'reasonText', message: 'Required for this reason.' }],
      );
    }
    if (!needsText && text) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This reason does not take a description.',
        [{ path: 'reasonText', message: 'Not accepted for this reason.' }],
      );
    }

    return {
      reasonId: reason.id,
      // Snapshot — renaming the reason later never rewrites this visit.
      reasonLabel: reason.label,
      reasonText: needsText ? (text ?? null) : null,
      order: null,
    };
  }
}
