import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { ExecutiveTotalsQuery } from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { CompanyClock } from '../../infra/time/company-clock.service';

const prisma = new PrismaClient();

type ReportsTx = Pick<
  PrismaClient,
  | 'company'
  | 'dailyAssignment'
  | 'assignmentStop'
  | 'visit'
  | 'order'
  | 'orderLine'
  | '$executeRaw'
>;

export interface PeriodView {
  period: ExecutiveTotalsQuery['period'];
  /** `YYYY-MM-DD`, company-local. */
  from: string;
  to: string;
  /** `"Tue, 29 Sep"` / `"Mon 28 Sep – Sun 4 Oct"` / `"September 2026"`. */
  label: string;
}

export interface CompletionView {
  assignedStops: number;
  visitedStops: number;
  /** `null` — not 0 — when nothing was assigned. See {@link completion}. */
  completionRate: number | null;
}

export interface OutcomeTotals {
  orderCount: number;
  noOrderCount: number;
  totalQuantity: number;
}

export interface BrandTotal {
  brandId: string;
  /** A recorded snapshot, never the current `Brand.label`. */
  label: string;
  quantity: number;
}

export interface DayTotal {
  businessDate: string;
  /** `"Mon"` … `"Sun"`. */
  label: string;
  orderCount: number;
  isToday: boolean;
}

export interface ExecutiveTotals {
  period: PeriodView;
  completion: CompletionView;
  totals: OutcomeTotals;
  brands: BrandTotal[];
  /** Always the CURRENT week, whatever `period` was asked for. */
  week: { from: string; to: string; days: DayTotal[] };
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * Backs `GET /reports/executive-totals` — board 1.6 (009-my-totals,
 * contracts/executive-totals.md). Path taken verbatim from
 * `03-ARCHITECTURE.md:837`.
 *
 * **What is NOT in any response here**, stated rather than inferred:
 * `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`,
 * `effectiveRadiusMeters`, any coordinate, **any out-of-range count**, **any
 * monetary value**, and anything describing another executive.
 *
 * The out-of-range count deserves its own sentence because it is the one a
 * future contributor will reach for: the manager's previous-day report has
 * one (`02-PRD.md` FR-MGR-02) and this screen must not, in any period. It is
 * the aggregate form of the same rule — "how many of my visits were flagged"
 * tells the executive exactly what an individual flag would.
 *
 * **The one-line test**: if a number is not visible on board 1.6, it must not
 * be in this response.
 *
 * Company scoping is not enough. Every read additionally narrows to the
 * caller's own JWT-verified `executiveId` — there is no parameter for it, so
 * cross-executive leakage is not a guard to get right but a thing that cannot
 * be expressed.
 *
 * **Nothing is stored.** Every figure is recomputed on read, which is what
 * makes a visit that synced late appear the next time the screen is opened,
 * with no invalidation story to get wrong.
 */
@Injectable()
export class ExecutiveTotalsService {
  constructor(
    private readonly cls: ClsService<TransactionClsStore>,
    private readonly clock: CompanyClock,
  ) {}

  private tx(): ReportsTx {
    const store = this.cls.get();
    return (store?.tx as ReportsTx | undefined) ?? prisma;
  }

  /** See `assignments.service.ts` — identical. */
  private async scopeToCaller(companyId: string): Promise<ReportsTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  async get(
    companyId: string,
    executiveId: string,
    query: ExecutiveTotalsQuery,
  ): Promise<ExecutiveTotals> {
    const tx = await this.scopeToCaller(companyId);

    const today = await this.todayFor(tx, companyId);
    const period = this.resolvePeriod(query.period, today);

    const [completion, totals, brands, week] = await Promise.all([
      this.completion(tx, executiveId, period),
      this.totals(tx, executiveId, period),
      this.brands(tx, executiveId, period),
      this.week(tx, executiveId, today),
    ]);

    return { period, completion, totals, brands, week };
  }

  /** The company's current business date — never the device's (rule 8). */
  private async todayFor(tx: ReportsTx, companyId: string): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    return this.clock.businessDate(company?.timezone ?? 'Asia/Kolkata');
  }

  /**
   * What each tab means, in the company's own calendar.
   *
   * The client sends a NAME and never a date, so this is the only place that
   * decides what "this week" is — which is what keeps an executive's figures
   * agreeing with their manager's however the phone's timezone is set.
   */
  private resolvePeriod(
    period: ExecutiveTotalsQuery['period'],
    today: string,
  ): PeriodView {
    if (period === 'TODAY') {
      return {
        period,
        from: today,
        to: today,
        label: this.formatDay(today, { weekday: 'short', comma: true }),
      };
    }

    if (period === 'THIS_WEEK') {
      const from = this.clock.startOfWeek(today);
      const to = this.clock.shiftDays(from, 6);
      return {
        period,
        from,
        to,
        label: `${this.formatDay(from)} – ${this.formatDay(to)}`,
      };
    }

    const from = this.clock.startOfMonth(today);
    return {
      period,
      from,
      to: this.clock.endOfMonth(today),
      label: this.formatMonth(from),
    };
  }

  /**
   * Beat completion.
   *
   * Two indexed reads rather than a join through visits: the period's
   * assignments (`@@index([companyId, executiveId, businessDate])`), then a
   * `groupBy` over their stops (`@@index([companyId, assignmentId, status])`).
   *
   * **`source` is deliberately not filtered.** Counting only `PLAN` stops
   * would show an executive who visited twelve planned shops plus two extras
   * (slice 007) as "14 of 12", with a progress bar at 117%. Counting every
   * stop on the day in both halves makes `completionRate <= 100` true by
   * construction.
   *
   * **"Visited" is a stop at `COMPLETED`, not a visit row.** It is the stop
   * that is or is not covered, and `submitVisit` already sets that status.
   */
  private async completion(
    tx: ReportsTx,
    executiveId: string,
    period: PeriodView,
  ): Promise<CompletionView> {
    const assignments = await tx.dailyAssignment.findMany({
      where: { executiveId, ...this.dateRange(period.from, period.to) },
      select: { id: true },
    });

    if (assignments.length === 0) {
      return { assignedStops: 0, visitedStops: 0, completionRate: null };
    }

    const grouped = await tx.assignmentStop.groupBy({
      by: ['status'],
      where: { assignmentId: { in: assignments.map((a) => a.id) } },
      _count: { _all: true },
    });

    const assignedStops = grouped.reduce((sum, g) => sum + g._count._all, 0);
    const visitedStops =
      grouped.find((g) => g.status === 'COMPLETED')?._count._all ?? 0;

    return {
      assignedStops,
      visitedStops,
      // `null`, NOT 0. A holiday week and a wasted week are different facts
      // and "0%" says the wrong one; the screen renders copy for null.
      completionRate:
        assignedStops === 0
          ? null
          : Math.round((visitedStops / assignedStops) * 100),
    };
  }

  /**
   * The three tiles.
   *
   * Both counts are one `groupBy` over `visits_exec_history_idx` — the index
   * slice 008 added as `(companyId, executiveId, businessDate, submittedAt,
   * id)`, so a period filter is a range scan on the third column with the
   * first two already pinned.
   *
   * `totalQuantity` sums `Order.totalQuantity`, which slice 006 already
   * derives server-side from the submitted lines, so this sums a value the
   * server owns rather than re-deriving one.
   */
  private async totals(
    tx: ReportsTx,
    executiveId: string,
    period: PeriodView,
  ): Promise<OutcomeTotals> {
    const where = {
      executiveId,
      ...this.dateRange(period.from, period.to),
    } satisfies Prisma.VisitWhereInput;

    const [grouped, quantity] = await Promise.all([
      tx.visit.groupBy({
        by: ['outcome'],
        where,
        _count: { _all: true },
      }),
      tx.order.aggregate({
        where: { visit: where },
        _sum: { totalQuantity: true },
      }),
    ]);

    return {
      orderCount: grouped.find((g) => g.outcome === 'ORDER')?._count._all ?? 0,
      noOrderCount:
        grouped.find((g) => g.outcome === 'NO_ORDER')?._count._all ?? 0,
      totalQuantity: quantity._sum.totalQuantity ?? 0,
    };
  }

  /**
   * Quantity by brand, largest first. **Every brand — none is capped.**
   *
   * That is what earns the guarantee the contract makes: the brand
   * quantities add up to `totals.totalQuantity` exactly. A capped list could
   * never promise it.
   *
   * **Grouped by `brandId`, labelled from a recorded snapshot.** Grouping by
   * `brandLabel` would satisfy "show the recorded name" literally, but a
   * brand renamed mid-period would then appear as two rows with two names
   * and a split quantity — and this screen exists to answer "which products
   * are moving". Joining the live `Brand.label` is the opposite error: it is
   * the current master value, and a retired brand would render blank. So the
   * grouping key is the thing and the label is how it was last recorded.
   */
  private async brands(
    tx: ReportsTx,
    executiveId: string,
    period: PeriodView,
  ): Promise<BrandTotal[]> {
    const lines = await tx.orderLine.findMany({
      where: {
        order: {
          visit: {
            executiveId,
            ...this.dateRange(period.from, period.to),
          },
        },
      },
      select: {
        brandId: true,
        brandLabel: true,
        quantity: true,
        order: { select: { createdAt: true } },
      },
    });

    const byBrand = new Map<
      string,
      { label: string; quantity: number; labelAt: Date }
    >();

    for (const line of lines) {
      const existing = byBrand.get(line.brandId);
      if (!existing) {
        byBrand.set(line.brandId, {
          label: line.brandLabel,
          quantity: line.quantity,
          labelAt: line.order.createdAt,
        });
        continue;
      }
      existing.quantity += line.quantity;
      // The most recently recorded label in the period wins.
      if (line.order.createdAt > existing.labelAt) {
        existing.label = line.brandLabel;
        existing.labelAt = line.order.createdAt;
      }
    }

    return [...byBrand.entries()]
      .map(([brandId, value]) => ({
        brandId,
        label: value.label,
        quantity: value.quantity,
      }))
      .sort((a, b) => b.quantity - a.quantity);
  }

  /**
   * Orders per day, **always for the current week**, whatever `period` was
   * asked for.
   *
   * `02-PRD.md` FR-MY-04 says the period switcher "recalculates everything
   * shown" while FR-MY-05 says this is "orders per day for the current
   * week". The design settles it twice over: the section's heading reads
   * "Orders per day · this week", and board 1.6's own component script
   * computes `perDay` outside the period lookup entirely. Returning it only
   * for `THIS_WEEK` would make the screen fetch twice.
   *
   * **Seven entries, Monday to Sunday, always.** A `groupBy` returns no row
   * for a day with no orders, so the week is materialised from the date range
   * and the gaps filled with zero — omitting a day would collapse the shape
   * of the week, which is the only thing the chart is for.
   */
  private async week(
    tx: ReportsTx,
    executiveId: string,
    today: string,
  ): Promise<ExecutiveTotals['week']> {
    const from = this.clock.startOfWeek(today);
    const to = this.clock.shiftDays(from, 6);

    const grouped = await tx.visit.groupBy({
      by: ['businessDate'],
      where: {
        executiveId,
        outcome: 'ORDER',
        ...this.dateRange(from, to),
      },
      _count: { _all: true },
    });

    const counts = new Map(
      grouped.map((g) => [
        g.businessDate.toISOString().slice(0, 10),
        g._count._all,
      ]),
    );

    const days: DayTotal[] = DAY_LABELS.map((label, index) => {
      const businessDate = this.clock.shiftDays(from, index);
      return {
        businessDate,
        label,
        orderCount: counts.get(businessDate) ?? 0,
        // Server-computed: a phone in the wrong timezone would otherwise
        // highlight the wrong column (rule 8).
        isToday: businessDate === today,
      };
    });

    return { from, to, days };
  }

  /**
   * A `@db.Date` range, inclusive at both ends.
   *
   * Returned as a plain structural shape rather than a
   * `Prisma.VisitWhereInput`: `Visit` and `DailyAssignment` both carry a
   * `businessDate`, and Prisma's where-inputs are branded per model, so a
   * model-typed return value cannot be spread into both.
   */
  private dateRange(
    from: string,
    to: string,
  ): { businessDate: { gte: Date; lte: Date } } {
    return {
      businessDate: {
        gte: this.clock.toDateColumn(from),
        lte: this.clock.toDateColumn(to),
      },
    };
  }

  /** `Tue, 29 Sep` (with `comma`) or `Mon 28 Sep`. */
  private formatDay(
    businessDate: string,
    options: { weekday?: 'short'; comma?: boolean } = {},
  ): string {
    const date = new Date(`${businessDate}T00:00:00.000Z`);
    const weekday = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(date);
    const dayMonth = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(date);
    return `${weekday}${options.comma ? ',' : ''} ${dayMonth}`;
  }

  /** `September 2026`. */
  private formatMonth(businessDate: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${businessDate}T00:00:00.000Z`));
  }
}
