import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  AppError,
  type EndBeatInput,
  type StartBeatInput,
} from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { CompanyClock } from '../../infra/time/company-clock.service';
import { haversineMetres } from '../visits/haversine';

/** Own module-level, unextended Prisma client — same established pattern as `beat-plans.service.ts`. */
const prisma = new PrismaClient();

type AssignmentsTx = Pick<
  PrismaClient,
  | 'dailyAssignment'
  | 'assignmentStop'
  | 'beatPlan'
  | 'company'
  | 'companySettings'
  | '$executeRaw'
>;

export type BeatState = 'NOT_STARTED' | 'RUNNING' | 'ENDED';
export type NoBeatReason = 'NO_BEAT_PLAN' | 'NOT_A_WORKING_DAY';

export interface StopView {
  id: string;
  sequence: number;
  source: 'PLAN' | 'EXEC_EXTRA' | 'MANAGER_EXTRA';
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'REVISIT';
  shop: {
    id: string;
    name: string;
    addressLine: string | null;
    // 006-visit-outcomes widened LocationStatus with PENDING_VERIFICATION —
    // a shop whose pin is captured but not yet approved.
    pinStatus: 'NONE' | 'APPROVED' | 'PENDING_VERIFICATION';
  };
  previousOutcome: string | null;
}

export interface AssignmentView {
  id: string;
  businessDate: string;
  beatPlanName: string | null;
  state: BeatState;
  startedAt: Date | null;
  endedAt: Date | null;
  nearestShopName: string | null;
  counts: {
    total: number;
    pending: number;
    completed: number;
    revisit: number;
    extra: number;
    visited: number;
    orders: number;
    noOrder: number;
    notVisited: number;
  };
  stops: StopView[];
}

export interface TodayResult {
  assignment: AssignmentView | null;
  noBeatReason: NoBeatReason | null;
}

/** The stop row shape {@link AssignmentsService.toView} needs. */
type StopRow = Prisma.AssignmentStopGetPayload<{
  select: {
    id: true;
    sequence: true;
    source: true;
    status: true;
    effectiveRadiusMeters: true;
    shop: {
      select: {
        id: true;
        name: true;
        addressLine1: true;
        city: true;
        latitude: true;
        longitude: true;
        locationStatus: true;
      };
    };
  };
}>;

type AssignmentRow = Prisma.DailyAssignmentGetPayload<{
  select: {
    id: true;
    businessDate: true;
    beatPlanId: true;
    beatPlanName: true;
    status: true;
    startedAt: true;
    endedAt: true;
    startLatitude: true;
    startLongitude: true;
  };
}> & { stops: StopRow[] };

/**
 * Backs `GET /assignments/today`, `POST /assignments/:id/start` and
 * `POST /assignments/:id/end` (005-executive-dashboard; shapes per
 * contracts/assignments.md).
 *
 * Re-scopes the request's transaction to the caller's `companyId` the same way
 * `beat-plans.service.ts` does. **But company scoping is not enough here**:
 * every method additionally narrows to the caller's own JWT-verified
 * `executiveId`, so one executive can never read or act on another's day even
 * inside the same company. Tenant isolation is never what keeps two
 * executives apart.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly cls: ClsService<TransactionClsStore>,
    private readonly clock: CompanyClock,
  ) {}

  private readonly stopSelect = {
    id: true,
    sequence: true,
    source: true,
    status: true,
    effectiveRadiusMeters: true,
    shop: {
      select: {
        id: true,
        name: true,
        addressLine1: true,
        city: true,
        latitude: true,
        longitude: true,
        locationStatus: true,
      },
    },
  } as const;

  private readonly assignmentSelect = {
    id: true,
    businessDate: true,
    // 007-extra-shops: null marks a day with no plan behind it. Needed at
    // read time so {@link getToday} can re-derive the no-beat reason rather
    // than dropping it once the row exists.
    beatPlanId: true,
    beatPlanName: true,
    status: true,
    startedAt: true,
    endedAt: true,
    startLatitude: true,
    startLongitude: true,
    stops: { select: this.stopSelect },
  } as const;

  private tx(): AssignmentsTx {
    const store = this.cls.get();
    return (store?.tx as AssignmentsTx | undefined) ?? prisma;
  }

  /** See `beat-plans.service.ts` — identical, for `tx.dailyAssignment.*` / `tx.assignmentStop.*`. */
  private async scopeToCaller(companyId: string): Promise<AssignmentsTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  /**
   * `GET /assignments/today`.
   *
   * **This read may write** (research.md §1): when no route exists for today
   * and the executive's active beat plan covers today's weekday, it is created
   * here and then frozen. That is the user's chosen alternative to an
   * overnight job, and it is safe because the write is idempotent by
   * construction — see {@link ensureTodayRoute}.
   */
  async getToday(companyId: string, executiveId: string): Promise<TodayResult> {
    const tx = await this.scopeToCaller(companyId);
    const businessDate = await this.resolveBusinessDate(tx, companyId);

    const existing = await tx.dailyAssignment.findFirst({
      where: {
        businessDate: this.clock.toDateColumn(businessDate),
        executiveId,
      },
      select: this.assignmentSelect,
    });

    if (existing) {
      return {
        assignment: this.toView(existing, businessDate),
        // 007-extra-shops: a plan-less day is now a real row, so that it can
        // be started and can hold extra stops (PRD FR-ASSIGN-10). The
        // no-beat card must still explain WHY the day is empty, so the
        // reason is re-derived here rather than dropped the moment the row
        // exists — the response shape is unchanged, `assignment` is simply
        // no longer null in that case.
        noBeatReason:
          existing.beatPlanId === null
            ? await this.resolveNoBeatReason(tx, executiveId, businessDate)
            : null,
      };
    }

    return this.ensureTodayRoute(tx, companyId, executiveId, businessDate);
  }

  /**
   * `GET /assignments?date=&executiveId=` — the MANAGER's view
   * (010-manager-app). Path from `03-ARCHITECTURE.md:821`.
   *
   * Board 3.2 needs it because the manager chooses a PERSON while
   * `POST /assignments/:id/stops/manager` is addressed by that person's
   * DAY. It also supplies the board's "5 of 12 done" progress line.
   *
   * **Company-scoped with no executive narrowing** — the manager reads
   * every executive's day (FR-050). That differs from every other method on
   * this service, all of which narrow to the caller's own id, so it is
   * stated rather than left to be noticed.
   *
   * Unlike `getToday`, this NEVER creates a row: a manager reading a day
   * must not bring one into being for someone else.
   */
  async listForManager(
    companyId: string,
    query: { date?: string; executiveId?: string },
  ): Promise<
    Array<{
      assignmentId: string;
      executiveId: string;
      executiveName: string;
      beatPlanName: string | null;
      businessDate: string;
      state: BeatState;
      visited: number;
      total: number;
      /**
       * The shops ALREADY on that day — planned stops and extras alike.
       * Board 3.2 excludes them from its picker so the manager is not
       * offered a shop the add would refuse with `SHOP_ALREADY_IN_BEAT`.
       */
      shopIds: string[];
    }>
  > {
    const tx = await this.scopeToCaller(companyId);
    const businessDate =
      query.date ?? (await this.resolveBusinessDate(tx, companyId));

    const rows = await tx.dailyAssignment.findMany({
      where: {
        businessDate: this.clock.toDateColumn(businessDate),
        ...(query.executiveId ? { executiveId: query.executiveId } : {}),
      },
      select: {
        id: true,
        executiveId: true,
        beatPlanName: true,
        status: true,
        executive: { select: { name: true } },
        stops: { select: { status: true, shopId: true } },
      },
    });

    return rows.map((row) => ({
      assignmentId: row.id,
      executiveId: row.executiveId,
      executiveName: row.executive.name,
      beatPlanName: row.beatPlanName,
      businessDate,
      state: row.status ?? 'NOT_STARTED',
      visited: row.stops.filter((s) => s.status === 'COMPLETED').length,
      total: row.stops.length,
      shopIds: row.stops.map((s) => s.shopId),
    }));
  }

  /** The company-local calendar date — never a client-supplied or device date (FR-005). */
  private async resolveBusinessDate(
    tx: AssignmentsTx,
    companyId: string,
  ): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    return this.clock.businessDate(company?.timezone ?? 'Asia/Kolkata');
  }

  /**
   * Why a day has no plan behind it — `NO_BEAT_PLAN` when the executive has
   * no active plan at all, `NOT_A_WORKING_DAY` when they have one that does
   * not cover today's weekday (007-extra-shops).
   *
   * Only ever called for a row whose `beatPlanId` is null, so it costs one
   * extra read on exactly the days that have no stops to read.
   */
  private async resolveNoBeatReason(
    tx: AssignmentsTx,
    executiveId: string,
    businessDate: string,
  ): Promise<NoBeatReason> {
    const plan = await tx.beatPlan.findFirst({
      where: { executiveId, isActive: true },
      select: { workingDays: true },
    });
    if (!plan) {
      return 'NO_BEAT_PLAN';
    }
    return plan.workingDays.includes(this.clock.weekdayOf(businessDate))
      ? 'NO_BEAT_PLAN'
      : 'NOT_A_WORKING_DAY';
  }

  /**
   * Builds today's route from the executive's active beat plan and freezes it
   * (FR-007): the plan's name and each stop's effective radius are **copied**,
   * so a later edit to the plan, the shop or company settings can never
   * rewrite a day that already exists.
   *
   * The concurrency guarantee is the unique index on
   * `(companyId, businessDate, executiveId)`, not a lock: two devices, a
   * double tap or a refresh storm all race to insert, Postgres refuses every
   * loser with P2002, and each loser simply re-reads the winner. That is why
   * this is safe to do from a GET.
   */
  private async ensureTodayRoute(
    tx: AssignmentsTx,
    companyId: string,
    executiveId: string,
    businessDate: string,
  ): Promise<TodayResult> {
    const plan = await tx.beatPlan.findFirst({
      where: { executiveId, isActive: true },
      select: {
        id: true,
        name: true,
        workingDays: true,
        shops: {
          select: {
            sequence: true,
            shopId: true,
            shop: {
              select: {
                verificationRadiusMeters: true,
                // 006-visit-outcomes (research.md §4): frozen onto the stop
                // below so a visit is measured against the location in force
                // when it was RECORDED, not when it was received.
                latitude: true,
                longitude: true,
                locationStatus: true,
              },
            },
          },
          orderBy: { sequence: 'asc' },
        },
      },
    });

    // 007-extra-shops (research.md §7, contracts/extra-shops.md "Changed
    // behaviour"): these two cases used to return `{ assignment: null }` and
    // create NO row, which meant `start()` — which takes an assignmentId —
    // had nothing to act on, so a non-working day or an executive with no
    // plan could never start a beat and could never hold an extra shop.
    // PRD FR-ASSIGN-10 promises the opposite, and `beatPlanId` was made
    // nullable in slice 005 for exactly this ("a day can exist with no plan
    // behind it once extra-shop-only days are possible"). The row is now
    // created with a null plan and no stops; the reason is still returned,
    // so the no-beat card's existing copy keeps explaining why the day is
    // empty.
    const noBeatReason: NoBeatReason | null = !plan
      ? 'NO_BEAT_PLAN'
      : plan.workingDays.includes(this.clock.weekdayOf(businessDate))
        ? null
        : 'NOT_A_WORKING_DAY';

    /** Only a day that a plan actually covers starts with stops on it. */
    const planShops = plan && noBeatReason === null ? plan.shops : [];

    const settings = await tx.companySettings.findUnique({
      where: { companyId },
      select: { defaultRadiusMeters: true },
    });
    const defaultRadius = settings?.defaultRadiusMeters ?? 5;

    try {
      const created = await tx.dailyAssignment.create({
        data: {
          companyId,
          businessDate: this.clock.toDateColumn(businessDate),
          executiveId,
          beatPlanId: plan && noBeatReason === null ? plan.id : null,
          // Snapshot, not a join — renaming the plan later must not rewrite
          // a day that already happened.
          beatPlanName: plan && noBeatReason === null ? plan.name : null,
          stops: {
            create: planShops.map((planShop) => ({
              companyId,
              shopId: planShop.shopId,
              sequence: planShop.sequence,
              source: 'PLAN' as const,
              status: 'PENDING' as const,
              // Frozen at creation from the shop's override or the company
              // default — never re-resolved when the day is read.
              effectiveRadiusMeters:
                planShop.shop.verificationRadiusMeters ?? defaultRadius,
              // 006-visit-outcomes: the coordinate a visit at this stop is
              // measured against, frozen now. Only an APPROVED pin counts —
              // a pending one cannot accept an outcome, and a shop with no
              // pin leaves these null until the executive captures one
              // (shop-pin.service.ts fills them in then).
              shopLatitude:
                planShop.shop.locationStatus === 'APPROVED'
                  ? planShop.shop.latitude
                  : null,
              shopLongitude:
                planShop.shop.locationStatus === 'APPROVED'
                  ? planShop.shop.longitude
                  : null,
            })),
          },
        },
        select: this.assignmentSelect,
      });

      return {
        assignment: this.toView(created, businessDate),
        noBeatReason,
      };
    } catch (error) {
      // P2002 = someone else created today's route between our read and our
      // write. Not an error condition: re-read and return the winner.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await tx.dailyAssignment.findFirst({
          where: {
            businessDate: this.clock.toDateColumn(businessDate),
            executiveId,
          },
          select: this.assignmentSelect,
        });
        if (winner) {
          return {
            assignment: this.toView(winner, businessDate),
            noBeatReason,
          };
        }
      }
      throw error;
    }
  }

  /**
   * `POST /assignments/:id/start`.
   *
   * Per Architecture §10's state machine, starting an already-`RUNNING` day
   * returns it unchanged with `200` — never an error, and **regardless of the
   * idempotency key**, which only replays byte-identical requests. Starting an
   * `ENDED` day is the one genuinely illegal move.
   */
  async start(
    companyId: string,
    executiveId: string,
    assignmentId: string,
    input: StartBeatInput,
  ): Promise<AssignmentView> {
    const tx = await this.scopeToCaller(companyId);
    const row = await this.loadOwn(tx, executiveId, assignmentId);

    if (row.status === 'ENDED') {
      throw new AppError(
        'BEAT_DAY_ENDED',
        'This beat day has already ended and cannot be restarted.',
      );
    }

    if (row.status === 'RUNNING') {
      return this.toView(row, this.toDateString(row.businessDate));
    }

    const updated = await tx.dailyAssignment.update({
      where: { id: assignmentId },
      data: {
        status: 'RUNNING',
        // The SERVER's clock, not the client's `capturedAt` — a wrong device
        // clock must not be able to move a beat in time.
        startedAt: new Date(),
        startLatitude: new Prisma.Decimal(input.latitude),
        startLongitude: new Prisma.Decimal(input.longitude),
        // Recorded for the manager's later review; never a reason to reject.
        startAccuracyMeters: input.accuracyMeters,
      },
      select: this.assignmentSelect,
    });

    return this.toView(updated, this.toDateString(updated.businessDate));
  }

  /**
   * `POST /assignments/:id/end`. The mirror of {@link start}: ending an
   * already-`ENDED` day returns it unchanged; ending one that never started is
   * the illegal move.
   *
   * Deliberately does **not** rewrite pending stops to `SKIPPED` — "not
   * visited" is counted at read time, so the record keeps what was actually
   * true rather than being retro-stamped (CLAUDE.md rule 4).
   */
  async end(
    companyId: string,
    executiveId: string,
    assignmentId: string,
    input: EndBeatInput,
  ): Promise<AssignmentView> {
    const tx = await this.scopeToCaller(companyId);
    const row = await this.loadOwn(tx, executiveId, assignmentId);

    if (row.status === null) {
      throw new AppError(
        'BEAT_NOT_STARTED',
        'This beat day has not been started, so it cannot be ended.',
      );
    }

    if (row.status === 'ENDED') {
      return this.toView(row, this.toDateString(row.businessDate));
    }

    const updated = await tx.dailyAssignment.update({
      where: { id: assignmentId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        endLatitude: new Prisma.Decimal(input.latitude),
        endLongitude: new Prisma.Decimal(input.longitude),
        endAccuracyMeters: input.accuracyMeters,
      },
      select: this.assignmentSelect,
    });

    return this.toView(updated, this.toDateString(updated.businessDate));
  }

  /**
   * Loads a day that belongs to **this** executive. An id that is unknown,
   * another company's, or another executive's is a `404` alike — the response
   * never reveals which, so it cannot be used to probe for other people's days.
   */
  private async loadOwn(
    tx: AssignmentsTx,
    executiveId: string,
    assignmentId: string,
  ): Promise<AssignmentRow> {
    const row = await tx.dailyAssignment.findFirst({
      where: { id: assignmentId, executiveId },
      select: this.assignmentSelect,
    });

    if (!row) {
      throw new AppError('NOT_FOUND', 'Beat day not found.');
    }

    return row;
  }

  private toDateString(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  /**
   * Shapes a row for the executive.
   *
   * Two things are deliberately **not** in the output: `effectiveRadiusMeters`
   * and the shop coordinates. Neither is a measurement, but both would let the
   * device compute its own "am I inside the radius?" verdict, which is exactly
   * the inference Constitution rule 6 exists to prevent (research.md §5). They
   * are selected from the database because the server needs them — for the
   * nearest-shop distance here, and for visit submission later — and dropped
   * at this boundary.
   */
  private toView(row: AssignmentRow, businessDate: string): AssignmentView {
    const ordered = this.orderStops(row.stops);

    const counts = {
      total: row.stops.length,
      pending: row.stops.filter((s) => s.status === 'PENDING').length,
      completed: row.stops.filter((s) => s.status === 'COMPLETED').length,
      revisit: row.stops.filter((s) => s.status === 'REVISIT').length,
      extra: row.stops.filter((s) => s.source !== 'PLAN').length,
      visited: row.stops.filter((s) => s.status === 'COMPLETED').length,
      // Both stay 0 until visit submission exists; the card renders them as
      // the design draws them rather than changing shape later.
      orders: 0,
      noOrder: 0,
      notVisited: row.stops.filter(
        (s) => s.status === 'PENDING' || s.status === 'SKIPPED',
      ).length,
    };

    return {
      id: row.id,
      businessDate,
      beatPlanName: row.beatPlanName,
      state: row.status === null ? 'NOT_STARTED' : row.status,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      nearestShopName: this.nearestShopName(row),
      counts,
      stops: ordered.map((stop) => ({
        id: stop.id,
        sequence: stop.sequence,
        source: stop.source,
        status: stop.status,
        shop: {
          id: stop.shop.id,
          name: stop.shop.name,
          addressLine: this.addressLine(stop.shop),
          pinStatus: stop.shop.locationStatus,
        },
        // Null until visit history exists — the screen renders the design's
        // own "First visit" wording for it (research.md §8).
        previousOutcome: null,
      })),
    };
  }

  /**
   * FR-011's ordering, applied on the server so the three filter tabs, any
   * later screen and any report agree: to-do first, then revisit, then
   * completed, with extra-sourced stops first inside each group and planned
   * stops by sequence.
   */
  private orderStops(stops: StopRow[]): StopRow[] {
    const groupOf = (status: StopRow['status']): number => {
      if (status === 'PENDING') return 0;
      if (status === 'REVISIT') return 1;
      return 2;
    };

    return [...stops].sort((a, b) => {
      const group = groupOf(a.status) - groupOf(b.status);
      if (group !== 0) return group;

      const extra = Number(b.source !== 'PLAN') - Number(a.source !== 'PLAN');
      if (extra !== 0) return extra;

      return a.sequence - b.sequence;
    });
  }

  private addressLine(shop: StopRow['shop']): string | null {
    const parts = [shop.addressLine1, shop.city].filter(
      (part): part is string => Boolean(part),
    );
    return parts.length > 0 ? parts.join(', ') : null;
  }

  /**
   * The shop nearest the point the beat started, for the running card's strip.
   *
   * Computed **server-side only** — the device never calculates a distance for
   * any purpose, even a cosmetic one, so the product has exactly one distance
   * implementation (CLAUDE.md rule 1). Shops with no approved pin have no
   * coordinates to measure from and are excluded from this comparison only;
   * they still appear in the list.
   */
  private nearestShopName(row: AssignmentRow): string | null {
    if (row.startLatitude === null || row.startLongitude === null) {
      return null;
    }

    const from = {
      lat: Number(row.startLatitude),
      lng: Number(row.startLongitude),
    };

    let best: { name: string; metres: number } | null = null;

    for (const stop of row.stops) {
      const { latitude, longitude, locationStatus, name } = stop.shop;
      if (
        locationStatus !== 'APPROVED' ||
        latitude === null ||
        longitude === null
      ) {
        continue;
      }
      const metres = haversineMetres(
        from.lat,
        from.lng,
        Number(latitude),
        Number(longitude),
      );
      if (!best || metres < best.metres) {
        best = { name, metres };
      }
    }

    return best?.name ?? null;
  }
}
