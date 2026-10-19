import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { MyVisitsQuery } from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { CompanyClock } from '../../infra/time/company-clock.service';

const prisma = new PrismaClient();

type MyVisitsTx = Pick<PrismaClient, 'visit' | 'company' | '$executeRaw'>;

/**
 * One row of board 1.5's list.
 *
 * **Six fields, and this shape is deliberately NOT shared with the manager's
 * future `GET /visits`** (data-model.md, *Entity: the visit row*). That list
 * carries `distanceMeters`, `isExceedRange`, the flags and the review status
 * by design — it has an "Out of range" tab built on them. The two views read
 * the same table one slice apart, and a shared shape with a role-conditional
 * filter would put the product's most load-bearing privacy rule inside an
 * `if`. The architecture's own API table splits them into two routes for
 * exactly this reason (`03-ARCHITECTURE.md:829-830`).
 *
 * **Never selected here** — the boundary stated rather than inferred:
 *
 *   * `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus` — the
 *     measurement and the verdict (FR-022, SC-007).
 *   * `effectiveRadiusMeters`, `shopLatitude`, `shopLongitude` — what the
 *     verdict was measured against. A coordinate plus a radius lets a device
 *     compute its own verdict.
 *   * `capturedLatitude`, `capturedLongitude`, `accuracyMeters` — **the
 *     executive's own position** (FR-023). Their own data, which is what
 *     makes it easy to wave through; excluded anyway, because this screen is
 *     a record of what was done, not of where the phone was.
 *   * `reasonText` — the free-text half of a no-order reason, already on the
 *     log redaction list. The board's row shows the *label*.
 *   * `sampleShown`, `stopId`, `assignmentId`, `executiveId`, `shopId` — not
 *     drawn by the board.
 *
 * The test a reviewer can apply in one line: **if a field is not visible on
 * board 1.5, it must not be in the select.**
 */
export interface VisitRow {
  id: string;
  /** `YYYY-MM-DD` — the grouping key, and why `Visit.businessDate` exists. */
  businessDate: string;
  shopName: string;
  outcome: 'ORDER' | 'NO_ORDER';
  /** `"2 brands · 32 qty"` or the no-order reason label. Composed here, never on the device. */
  summary: string;
  /** `Visit.submittedAt` — when the executive pressed submit (research.md §7). */
  occurredAt: Date;
}

/**
 * One day's totals, for the heading above its rows.
 *
 * **Both counts are the whole day's and ignore the `outcome` filter.** This
 * is read off board 1.5's own component script rather than inferred: it
 * renders `items` *filtered* by the active tab but computes the summary from
 * the day's *unfiltered* list, so on the Order tab a day showing three order
 * rows still reads "3 orders · 2 no order" (research.md §5).
 *
 * The consequence is the load-bearing part: a client **cannot** derive these
 * from the rows it was sent, because under a filter the rows are a subset.
 */
export interface DaySummary {
  businessDate: string;
  orderCount: number;
  noOrderCount: number;
}

export interface MyVisitsResult {
  items: VisitRow[];
  days: DaySummary[];
  /** First page only — totals for the whole range, not the page. */
  counts?: { all: number; order: number; noOrder: number };
  /**
   * The company's current business date, `YYYY-MM-DD`.
   *
   * Board 1.5 labels one group `"Today · Tue 29 Sep"` and the rest
   * `"Tue 29 Sep"`, so the screen has to know which day is today. It must
   * **not** work that out from the device clock: a phone in the wrong
   * timezone would stamp "Today" on the wrong group, and Constitution rule 8
   * puts that conversion in exactly one place. The server already resolves
   * this date for the range filter, so returning it costs nothing.
   */
  todayBusinessDate: string;
  nextCursor: string | null;
}

/** How many business days each preset covers, counting today. */
const RANGE_DAYS: Record<string, number | null> = {
  ALL: null,
  LAST_7_DAYS: 7,
  LAST_30_DAYS: 30,
};

/**
 * Backs `GET /visits/mine` — the executive's own visit history, board 1.5
 * (008-my-visits, contracts/my-visits.md).
 *
 * Path taken verbatim from `03-ARCHITECTURE.md:830`. Lives in the visits
 * module, which already owns the executive's whole field-and-history surface.
 *
 * Company scoping is not enough here. Every read additionally narrows to the
 * caller's own JWT-verified `executiveId` — there is no parameter for it, so
 * SC-008 ("zero cross-executive leakage") is not a guard to get right but a
 * thing that cannot be expressed.
 */
@Injectable()
export class MyVisitsService {
  constructor(
    private readonly cls: ClsService<TransactionClsStore>,
    private readonly clock: CompanyClock,
  ) {}

  private tx(): MyVisitsTx {
    const store = this.cls.get();
    return (store?.tx as MyVisitsTx | undefined) ?? prisma;
  }

  /** See `assignments.service.ts` — identical. */
  private async scopeToCaller(companyId: string): Promise<MyVisitsTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  async list(
    companyId: string,
    executiveId: string,
    query: MyVisitsQuery,
  ): Promise<MyVisitsResult> {
    const tx = await this.scopeToCaller(companyId);

    const todayBusinessDate = await this.todayFor(tx, companyId);
    const where = await this.buildWhere(tx, companyId, executiveId, query);

    const rows = await tx.visit.findMany({
      where,
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      // DAY-MAJOR, and this ordering must not be changed.
      //
      //  * `businessDate` first is what guarantees every day's visits arrive
      //    contiguously, which makes FR-011 ("one block per day, even across
      //    a page boundary") a property of the query rather than a hope.
      //  * `submittedAt` is newest-first within a day, matching what the row
      //    displays.
      //  * `id` last makes the ordering TOTAL, which a keyset cursor requires
      //    to be correct.
      //
      // Collapsing this to a single timestamp key would let a phone with a
      // wrong clock interleave two days and split a group.
      orderBy: [
        { businessDate: 'desc' },
        { submittedAt: 'desc' },
        { id: 'desc' },
      ],
      select: this.rowSelect,
    });

    const items = rows.map((row) => this.toRow(row));

    return {
      items,
      days: await this.daySummaries(tx, where, items),
      // Only on the first page: the counts describe the range, not the page,
      // so they cannot change as the executive scrolls and re-sending them
      // with every page would be noise.
      ...(query.cursor
        ? {}
        : { counts: await this.counts(tx, companyId, executiveId, query) }),
      todayBusinessDate,
      nextCursor:
        rows.length === query.limit
          ? (rows[rows.length - 1]?.id ?? null)
          : null,
    };
  }

  /**
   * The caller's own visits, narrowed by the active range.
   *
   * `executiveId` comes from the verified JWT — there is no query parameter
   * for it, by design.
   */
  private async buildWhere(
    tx: MyVisitsTx,
    companyId: string,
    executiveId: string,
    query: MyVisitsQuery,
  ): Promise<Prisma.VisitWhereInput> {
    return {
      executiveId,
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(await this.rangeFilter(tx, companyId, query.range)),
    };
  }

  /** The company's current business date — never the device's (rule 8). */
  private async todayFor(tx: MyVisitsTx, companyId: string): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    return this.clock.businessDate(company?.timezone ?? 'Asia/Kolkata');
  }

  /**
   * `LAST_7_DAYS` / `LAST_30_DAYS` as a predicate on one indexed column.
   *
   * The window's edge is a **company-local business date** from
   * `CompanyClock` — never the device clock, and never derived from a
   * timestamp (Constitution rule 8). `ALL` applies no date predicate at all,
   * which is FR-020's default.
   */
  private async rangeFilter(
    tx: MyVisitsTx,
    companyId: string,
    range: MyVisitsQuery['range'],
  ): Promise<Prisma.VisitWhereInput> {
    const days = RANGE_DAYS[range];
    if (!days) {
      return {};
    }

    const today = await this.todayFor(tx, companyId);

    // `days` counts today, so a 7-day window starts 6 days back.
    const start = new Date(this.clock.toDateColumn(today));
    start.setUTCDate(start.getUTCDate() - (days - 1));

    return { businessDate: { gte: start } };
  }

  /**
   * The three tab counts: totals for the **range in view**, not for the page.
   *
   * Board 1.5 shows `All · 64` beside roughly five rows, so these were never
   * page counts (FR-015, SC-009). One `groupBy` over the same `where` the
   * list uses, **minus the outcome predicate** — the Order tab still has to
   * know how many no-orders there are.
   */
  private async counts(
    tx: MyVisitsTx,
    companyId: string,
    executiveId: string,
    query: MyVisitsQuery,
  ): Promise<{ all: number; order: number; noOrder: number }> {
    const grouped = await tx.visit.groupBy({
      by: ['outcome'],
      where: {
        executiveId,
        ...(await this.rangeFilter(tx, companyId, query.range)),
      },
      _count: { _all: true },
    });

    const order = grouped.find((g) => g.outcome === 'ORDER')?._count._all ?? 0;
    const noOrder =
      grouped.find((g) => g.outcome === 'NO_ORDER')?._count._all ?? 0;

    return { all: order + noOrder, order, noOrder };
  }

  /**
   * One summary per business date present in this page.
   *
   * Deliberately built from a `groupBy` over the **filter-free** day set
   * rather than from `items`: under an active tab the rows are a subset, and
   * board 1.5's heading still reports the day's real totals (see
   * {@link DaySummary}).
   */
  private async daySummaries(
    tx: MyVisitsTx,
    where: Prisma.VisitWhereInput,
    items: VisitRow[],
  ): Promise<DaySummary[]> {
    if (items.length === 0) {
      return [];
    }

    const dates = [...new Set(items.map((item) => item.businessDate))];

    const grouped = await tx.visit.groupBy({
      by: ['businessDate', 'outcome'],
      where: {
        // The caller and the range still apply — a day's totals are that
        // executive's, within the window they are looking at.
        executiveId: where.executiveId,
        businessDate: { in: dates.map((d) => this.clock.toDateColumn(d)) },
      },
      _count: { _all: true },
    });

    return dates.map((businessDate) => {
      const forDay = grouped.filter(
        (g) => this.toDateString(g.businessDate) === businessDate,
      );
      return {
        businessDate,
        orderCount: forDay.find((g) => g.outcome === 'ORDER')?._count._all ?? 0,
        noOrderCount:
          forDay.find((g) => g.outcome === 'NO_ORDER')?._count._all ?? 0,
      };
    });
  }

  private toRow(row: {
    id: string;
    businessDate: Date;
    outcome: 'ORDER' | 'NO_ORDER';
    reasonLabel: string | null;
    submittedAt: Date;
    shop: { name: string };
    order: { brandCount: number; totalQuantity: number } | null;
  }): VisitRow {
    return {
      id: row.id,
      businessDate: this.toDateString(row.businessDate),
      shopName: row.shop.name,
      outcome: row.outcome,
      summary: this.summary(row),
      occurredAt: row.submittedAt,
    };
  }

  /**
   * Composed on the SERVER, from values recorded with the visit.
   *
   * `brandCount`/`totalQuantity` are stored on the order and `reasonLabel` is
   * a snapshot, so a brand or reason renamed or retired later never rewrites
   * what the history says (FR-006). Composing it once here also means the two
   * outcome shapes cannot drift between the API and the screen — the same
   * reasoning that put `distanceLabel` on the server in slice 007.
   */
  private summary(row: {
    outcome: 'ORDER' | 'NO_ORDER';
    reasonLabel: string | null;
    order: { brandCount: number; totalQuantity: number } | null;
  }): string {
    if (row.outcome === 'ORDER') {
      const brands = row.order?.brandCount ?? 0;
      const quantity = row.order?.totalQuantity ?? 0;
      return `${brands} brand${brands === 1 ? '' : 's'} · ${quantity} qty`;
    }
    return row.reasonLabel ?? 'No order';
  }

  /** A `@db.Date` column comes back as a Date at UTC midnight. */
  private toDateString(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private readonly rowSelect = {
    id: true,
    businessDate: true,
    outcome: true,
    reasonLabel: true,
    submittedAt: true,
    shop: { select: { name: true } },
    order: { select: { brandCount: true, totalQuantity: true } },
  } as const;
}
