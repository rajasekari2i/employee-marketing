import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { PreviousDayQuery } from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { CompanyClock } from '../../infra/time/company-clock.service';

const prisma = new PrismaClient();

type ReportsTx = Pick<
  PrismaClient,
  'company' | 'dailyAssignment' | 'assignmentStop' | 'visit' | '$executeRaw'
>;

export interface PreviousDayReport {
  period: { businessDate: string; label: string };
  counts: {
    assigned: number;
    visited: number;
    pending: number;
    order: number;
    noOrder: number;
    outOfRange: number;
  };
  range: {
    within: number;
    exceeded: number;
    notVisited: number;
    withinPercent: number | null;
  };
  outOfRangeVisits: Array<{
    visitId: string;
    shopName: string;
    executiveName: string;
    flag: string;
    distanceMeters: number;
  }>;
  executives: Array<{
    executiveId: string;
    name: string;
    beatPlanName: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
    dayState: 'NOT_STARTED' | 'RUNNING' | 'ENDED' | 'AUTO_CLOSED';
  }>;
}

/**
 * Backs `GET /reports/previous-day` — board 3.1 (010-manager-app).
 * Path taken verbatim from `03-ARCHITECTURE.md:836`.
 *
 * Joins the `reports` module **slice 009 created one route wide for exactly
 * this**, with a note saying so.
 *
 * **Scope is company-wide, and the absence of an executive narrowing is
 * correct here.** Every executive-facing service in this repo additionally
 * narrows to the caller's own JWT id — `assignments`, `visits`,
 * `my-visits`, `executive-totals`. This one must not: a manager reviews
 * every executive in the company (FR-050, decided with the user). This is
 * the first service where that is right rather than a bug, so do not "fix"
 * it by adding one.
 *
 * **A manager may see what an executive may not** — `distanceMeters` and the
 * flags are returned here deliberately (FR-046). The executive's own
 * services are untouched by this file and must stay that way (FR-047).
 */
@Injectable()
export class PreviousDayService {
  constructor(
    private readonly cls: ClsService<TransactionClsStore>,
    private readonly clock: CompanyClock,
  ) {}

  private tx(): ReportsTx {
    const store = this.cls.get();
    return (store?.tx as ReportsTx | undefined) ?? prisma;
  }

  private async scopeToCaller(companyId: string): Promise<ReportsTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  async get(
    companyId: string,
    query: PreviousDayQuery,
  ): Promise<PreviousDayReport> {
    const tx = await this.scopeToCaller(companyId);

    const businessDate =
      query.date ?? (await this.previousBusinessDate(tx, companyId));
    const date = this.clock.toDateColumn(businessDate);

    // The day's assignments, narrowed by the optional executive and beat
    // filters. Everything else hangs off these.
    const assignments = await tx.dailyAssignment.findMany({
      where: {
        businessDate: date,
        ...(query.executiveId ? { executiveId: query.executiveId } : {}),
        ...(query.beatPlanId ? { beatPlanId: query.beatPlanId } : {}),
      },
      select: {
        id: true,
        executiveId: true,
        beatPlanName: true,
        status: true,
        startedAt: true,
        endedAt: true,
        executive: { select: { name: true } },
      },
    });

    const assignmentIds = assignments.map((a) => a.id);

    const [stopGroups, visitRows] = await Promise.all([
      assignmentIds.length === 0
        ? Promise.resolve([])
        : tx.assignmentStop.groupBy({
            by: ['status'],
            where: { assignmentId: { in: assignmentIds } },
            _count: { _all: true },
          }),
      assignmentIds.length === 0
        ? Promise.resolve([])
        : tx.visit.findMany({
            where: { assignmentId: { in: assignmentIds } },
            select: {
              id: true,
              outcome: true,
              isExceedRange: true,
              distanceMeters: true,
              flags: true,
              shop: { select: { name: true } },
              executive: { select: { name: true } },
            },
          }),
    ]);

    // "Assigned" counts EVERY stop whatever its source — a manager-added
    // extra is in both halves of the ratio, exactly as slice 009
    // established, so the proportions can never exceed the whole.
    const assigned = stopGroups.reduce((sum, g) => sum + g._count._all, 0);
    const visited =
      stopGroups.find((g) => g.status === 'COMPLETED')?._count._all ?? 0;
    const pending = assigned - visited;

    const order = visitRows.filter((v) => v.outcome === 'ORDER').length;
    const noOrder = visitRows.filter((v) => v.outcome === 'NO_ORDER').length;
    const exceeded = visitRows.filter((v) => v.isExceedRange).length;
    const within = visitRows.length - exceeded;

    return {
      period: {
        businessDate,
        label: this.formatDay(businessDate),
      },
      counts: {
        assigned,
        visited,
        pending,
        order,
        noOrder,
        outOfRange: exceeded,
      },
      range: {
        within,
        exceeded,
        // `within + exceeded + notVisited === assigned` by construction:
        // the first two partition the visits, this is the rest (SC-005).
        notVisited: Math.max(0, assigned - visitRows.length),
        // null rather than 0 when nothing was visited — a day with no visits
        // and a day where none were in range are different facts.
        withinPercent:
          visitRows.length === 0
            ? null
            : Math.round((within / visitRows.length) * 100),
      },
      outOfRangeVisits: visitRows
        .filter((v) => v.isExceedRange)
        .map((v) => ({
          visitId: v.id,
          shopName: v.shop.name,
          executiveName: v.executive.name,
          flag: v.flags.includes('EXCEED_RANGE')
            ? 'EXCEED_RANGE'
            : (v.flags[0] ?? 'EXCEED_RANGE'),
          distanceMeters: v.distanceMeters,
        })),
      executives: assignments.map((a) => ({
        executiveId: a.executiveId,
        name: a.executive.name,
        beatPlanName: a.beatPlanName,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        // `AUTO_CLOSED` is read correctly and will simply never appear until
        // the nightly job that writes it ships (research.md §5). It is NOT
        // synthesised here from, say, an ENDED day with no end position.
        dayState: a.status ?? 'NOT_STARTED',
      })),
    };
  }

  /** The company-local day before today — board 3.1's default (FR-005). */
  private async previousBusinessDate(
    tx: ReportsTx,
    companyId: string,
  ): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    const today = this.clock.businessDate(company?.timezone ?? 'Asia/Kolkata');
    return this.clock.shiftDays(today, -1);
  }

  /** `Mon, 28 Sep` — board 3.1's header. */
  private formatDay(businessDate: string): string {
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
    return `${weekday}, ${dayMonth}`;
  }
}
