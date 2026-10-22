import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppError } from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { CompanyClock } from '../../infra/time/company-clock.service';

const prisma = new PrismaClient();

type SalaryTx = Pick<
  PrismaClient,
  | 'salaryRun'
  | 'salaryRunLine'
  | 'attendance'
  | 'userSalaryRate'
  | 'user'
  | 'company'
  | '$executeRaw'
>;

type Session = 'MORNING' | 'EVENING';
type Status = 'PRESENT' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF';
type Lateness = 'ON_TIME' | 'DELAY_1H' | 'DELAY_2H';

/**
 * One sub-line of a `SalaryRunLine.breakdown`.
 *
 * `rate` and `amount` are `null`/`"0.00"` for dates covered by no rate row —
 * the units are still carried, so unrated work stays visible instead of being
 * silently priced at zero (FR-021).
 */
export interface BreakdownEntry {
  from: string;
  to: string;
  units: string;
  rate: string | null;
  amount: string;
}

export interface SalaryRunLineView {
  userId: string;
  employeeName: string;
  payableUnits: string;
  amount: string;
  breakdown: BreakdownEntry[];
}

export interface SalaryRunView {
  period: { year: number; month: number; label: string };
  run: {
    id: string;
    status: 'DRAFT' | 'FINALISED';
    version: number;
    grossTotal: string;
    employeeCount: number;
    generatedAt: Date;
    generatedByName: string | null;
    finalisedAt: Date | null;
    finalisedByName: string | null;
    lines: SalaryRunLineView[];
  } | null;
  unmarkedSessionCount: number;
  canFinalise: boolean;
}

export interface SalaryLineDetailView {
  employeeName: string;
  period: { year: number; month: number; label: string };
  run: { id: string; status: 'DRAFT' | 'FINALISED'; version: number };
  payableUnits: string;
  amount: string;
  breakdown: BreakdownEntry[];
  unpaidSessions: Array<{
    businessDate: string;
    session: Session;
    status: Status;
  }>;
  paidNonWorking: Array<{
    businessDate: string;
    session: Session;
    status: Status;
  }>;
  lateSessions: Array<{
    businessDate: string;
    session: Session;
    latenessFlag: Lateness;
  }>;
  unmarkedSessions: Array<{ businessDate: string; session: Session }>;
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const BOTH_SESSIONS: Session[] = ['MORNING', 'EVENING'];

/**
 * Backs the five `/salary-runs` routes — board 4.13 and its employee detail
 * (012-monthly-salary-run). Paths from `03-ARCHITECTURE.md:835`.
 *
 * Its own module because salary is its own aggregate: it does not merely
 * report over attendance, it **writes records that must outlive the data they
 * were computed from**. That is the whole difference between this and the
 * `reports` module.
 *
 * **Company-scoped with no per-user narrowing, and that is correct** — a
 * salary run spans every member of staff. The RLS migration carries the same
 * note.
 *
 * Two invariants hold this file together, and both are easy to break while
 * looking correct:
 *
 * 1. **Units are SUMMED from `Attendance.payableUnits`, never re-derived from
 *    `status`.** The units were derived and frozen when the manager saved the
 *    day sheet (`attendance.service.ts`). Re-deriving gives the same answer
 *    today and a different one the moment a company edits
 *    `payableUnitByStatus` — at which point every past month silently
 *    re-prices. See {@link aggregateUnits}.
 * 2. **A `SalaryRunLine` is written once and never updated.** Its `breakdown`
 *    names a rate AS IT WAS on a date; recomputing it on read would let a
 *    back-dated rate correction rewrite a finalised payslip (FR-028, BR-24).
 */
@Injectable()
export class SalaryRunService {
  constructor(
    private readonly cls: ClsService<TransactionClsStore>,
    private readonly clock: CompanyClock,
  ) {}

  private tx(): SalaryTx {
    const store = this.cls.get();
    return (store?.tx as SalaryTx | undefined) ?? prisma;
  }

  private async scopeToCaller(companyId: string): Promise<SalaryTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  /** The company-LOCAL calendar date — never a client-supplied or device date. */
  private async todayFor(tx: SalaryTx, companyId: string): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    return this.clock.businessDate(company?.timezone ?? 'Asia/Kolkata');
  }

  private label(year: number, month: number): string {
    return `${MONTH_LABELS[month - 1]} ${year}`;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────

  /**
   * `GET /salary-runs` — board 4.13.
   *
   * Omitting `year`/`month` means **the previous month, as the SERVER reckons
   * it** (FR-002). The client opens the screen with no parameters, which is
   * the only arrangement in which the server stays the single authority on
   * what "last month" is.
   */
  async getRun(
    companyId: string,
    query: { year?: number; month?: number; version?: number },
  ): Promise<SalaryRunView> {
    const tx = await this.scopeToCaller(companyId);
    const today = await this.todayFor(tx, companyId);

    const { year, month } =
      query.year !== undefined && query.month !== undefined
        ? { year: query.year, month: query.month }
        : this.clock.previousMonth(today);

    const run = await this.findRun(tx, year, month, query.version);
    const unmarkedSessionCount = await this.countUnmarkedSessions(
      tx,
      year,
      month,
    );

    if (!run) {
      // `null` is a DISTINCT state from a run that totals zero: "never
      // generated" and "generated, and nobody earned anything" are different
      // statements, and the screen renders them differently (FR-007).
      return {
        period: { year, month, label: this.label(year, month) },
        run: null,
        unmarkedSessionCount,
        canFinalise: false,
      };
    }

    const names = await this.namesFor(tx, [
      ...run.lines.map((line) => line.userId),
      run.generatedBy,
      ...(run.finalisedBy ? [run.finalisedBy] : []),
    ]);

    return {
      period: { year, month, label: this.label(year, month) },
      run: {
        id: run.id,
        status: run.status,
        version: run.version,
        // **From the stored header, never summed from the lines on read.**
        // Independent storage is what makes "lines sum to the gross" a real
        // check rather than a tautology (SC-004).
        grossTotal: run.grossTotal.toFixed(2),
        employeeCount: run.lines.length,
        generatedAt: run.generatedAt,
        generatedByName: names.get(run.generatedBy) ?? null,
        finalisedAt: run.finalisedAt,
        finalisedByName: run.finalisedBy
          ? (names.get(run.finalisedBy) ?? null)
          : null,
        lines: run.lines.map((line) => ({
          userId: line.userId,
          employeeName: names.get(line.userId) ?? 'Unknown',
          payableUnits: line.payableUnits.toFixed(2),
          amount: line.amount.toFixed(2),
          breakdown: line.breakdown as unknown as BreakdownEntry[],
        })),
      },
      unmarkedSessionCount,
      canFinalise:
        run.status === 'DRAFT' &&
        this.clock.isPeriodComplete(year, month, today),
    };
  }

  /**
   * `GET /salary-runs/:id/lines/:userId` — the employee detail (US3).
   *
   * **Two halves with different freshness, and this must not reconcile
   * them.** The frozen half (`payableUnits`, `amount`, `breakdown`) comes
   * straight from the stored line; the live half is read from `Attendance`
   * now. After a finalised month is amended the two legitimately disagree —
   * that is the state FR-030 exists for — so `run.status`/`run.version` come
   * back too, and the screen says WHICH run is being read.
   */
  async getLine(
    companyId: string,
    runId: string,
    userId: string,
  ): Promise<SalaryLineDetailView> {
    const tx = await this.scopeToCaller(companyId);
    return this.readLine(tx, runId, userId);
  }

  /**
   * The same read, for the `@Public()` payslip route.
   *
   * **Opens its OWN transaction**, because a public route has no CLS
   * transaction from the interceptor — and `set_config(..., true)` is
   * TRANSACTION-local, so outside one it is gone by the next statement and
   * RLS (FORCE'd on both salary tables) hides every row. The symptom is a
   * `404` on a run that plainly exists.
   *
   * `files.service.ts`'s public file-serving path does exactly this, for
   * exactly this reason; this is the second instance of the pattern rather
   * than a new one.
   */
  async getLineForServing(
    companyId: string,
    runId: string,
    userId: string,
  ): Promise<SalaryLineDetailView> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      return this.readLine(tx, runId, userId);
    });
  }

  private async readLine(
    tx: SalaryTx,
    runId: string,
    userId: string,
  ): Promise<SalaryLineDetailView> {
    const run = await tx.salaryRun.findFirst({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        version: true,
        periodYear: true,
        periodMonth: true,
      },
    });
    if (!run) {
      throw new AppError('NOT_FOUND', 'Salary run not found.');
    }

    const line = await tx.salaryRunLine.findFirst({
      where: { salaryRunId: runId, userId },
      select: { payableUnits: true, amount: true, breakdown: true },
    });
    if (!line) {
      throw new AppError('NOT_FOUND', 'This employee is not on that run.');
    }

    const names = await this.namesFor(tx, [userId]);
    const rows = await this.attendanceForPeriod(
      tx,
      run.periodYear,
      run.periodMonth,
      userId,
    );

    const unpaidSessions: SalaryLineDetailView['unpaidSessions'] = [];
    const paidNonWorking: SalaryLineDetailView['paidNonWorking'] = [];
    const lateSessions: SalaryLineDetailView['lateSessions'] = [];
    const seen = new Map<string, Set<Session>>();

    for (const row of rows) {
      const businessDate = this.toDateString(row.businessDate);
      const session = row.session;
      const status = row.status;

      if (!seen.has(businessDate)) seen.set(businessDate, new Set());
      seen.get(businessDate)?.add(session);

      if (status === 'ABSENT' || status === 'LEAVE') {
        unpaidSessions.push({ businessDate, session, status });
      }
      if (status === 'HOLIDAY' || status === 'WEEKLY_OFF') {
        paidNonWorking.push({ businessDate, session, status });
      }
      if (row.latenessFlag && row.latenessFlag !== 'ON_TIME') {
        lateSessions.push({
          businessDate,
          session,
          latenessFlag: row.latenessFlag,
        });
      }
    }

    const unmarkedSessions: SalaryLineDetailView['unmarkedSessions'] = [];
    for (const [businessDate, sessions] of seen) {
      for (const session of BOTH_SESSIONS) {
        if (!sessions.has(session)) {
          unmarkedSessions.push({ businessDate, session });
        }
      }
    }
    unmarkedSessions.sort((a, b) =>
      a.businessDate.localeCompare(b.businessDate),
    );

    return {
      employeeName: names.get(userId) ?? 'Unknown',
      period: {
        year: run.periodYear,
        month: run.periodMonth,
        label: this.label(run.periodYear, run.periodMonth),
      },
      run: { id: run.id, status: run.status, version: run.version },
      payableUnits: line.payableUnits.toFixed(2),
      amount: line.amount.toFixed(2),
      breakdown: line.breakdown as unknown as BreakdownEntry[],
      unpaidSessions,
      paidNonWorking,
      lateSessions,
      unmarkedSessions,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Generate
  // ───────────────────────────────────────────────────────────────────────

  /**
   * `POST /salary-runs`.
   *
   * **Only finalisation creates a version boundary.** Regenerating a DRAFT
   * replaces it and consumes no version; regenerating after a FINALISED run
   * creates `version + 1`. The two actions look alike and must not be
   * conflated (FR-030).
   */
  async generate(
    companyId: string,
    actorId: string,
    input: { year: number; month: number },
  ): Promise<SalaryRunView> {
    const tx = await this.scopeToCaller(companyId);
    const today = await this.todayFor(tx, companyId);
    const { year, month } = input;

    if (!this.clock.isPeriodComplete(year, month, today)) {
      throw new AppError(
        'SALARY_PERIOD_NOT_COMPLETE',
        'This month is not over yet. Only a completed month can be run.',
      );
    }

    const rows = await this.attendanceForPeriod(tx, year, month);
    if (rows.length === 0) {
      // A refusal, not a run totalling zero: a zero total reads as a computed
      // answer, and "nobody recorded any attendance" is a different statement
      // from "nobody earned anything" (FR-007's edge case).
      throw new AppError(
        'SALARY_NO_ATTENDANCE',
        'No attendance was recorded for this month, so there is nothing to pay.',
      );
    }

    const unitsByUser = this.aggregateUnits(rows);
    const userIds = [...unitsByUser.keys()];

    const rates = await tx.userSalaryRate.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        halfDayRate: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
      orderBy: { effectiveFrom: 'asc' },
    });

    const lines = userIds.map((userId) => {
      const breakdown = this.splitByRate(
        unitsByUser.get(userId) ?? new Map<string, Prisma.Decimal>(),
        rates.filter((rate) => rate.userId === userId),
      );
      const payableUnits = breakdown.reduce(
        (total, entry) => total.plus(new Prisma.Decimal(entry.units)),
        new Prisma.Decimal(0),
      );
      const amount = breakdown.reduce(
        (total, entry) => total.plus(new Prisma.Decimal(entry.amount)),
        new Prisma.Decimal(0),
      );
      return { userId, payableUnits, amount, breakdown };
    });

    const grossTotal = lines.reduce(
      (total, line) => total.plus(line.amount),
      new Prisma.Decimal(0),
    );

    const current = await this.findRun(tx, year, month);
    const version =
      current === null
        ? 1
        : current.status === 'DRAFT'
          ? current.version
          : current.version + 1;

    if (current !== null && current.status === 'DRAFT') {
      // Replace the draft in place. Its lines go with it by ON DELETE
      // CASCADE, so there is never a moment where a run has stale lines.
      await tx.salaryRun.delete({ where: { id: current.id } });
    }

    try {
      await tx.salaryRun.create({
        data: {
          companyId,
          periodYear: year,
          periodMonth: month,
          version,
          status: 'DRAFT',
          grossTotal,
          generatedBy: actorId,
          lines: {
            create: lines.map((line) => ({
              companyId,
              userId: line.userId,
              payableUnits: line.payableUnits,
              amount: line.amount,
              breakdown: line.breakdown as unknown as Prisma.InputJsonValue,
            })),
          },
        },
      });
    } catch (error) {
      // P2002 on (companyId, periodYear, periodMonth, version) — another
      // admin generated the same version between our read and our write.
      // Re-read and return the winner, as assignments.service.ts does.
      if (!(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )) {
        throw error;
      }
    }

    return this.getRun(companyId, { year, month });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Finalise
  // ───────────────────────────────────────────────────────────────────────

  /**
   * `POST /salary-runs/:id/finalise`.
   *
   * **Touches no line and no attendance row.** The lines were already final
   * when written, so this changes only the header's status — and locking the
   * salary must not lock attendance (FR-032): amendments stay possible, which
   * is the whole point of the append-only attendance design, and a correction
   * surfaces as a new version instead.
   */
  async finalise(
    companyId: string,
    actorId: string,
    runId: string,
  ): Promise<SalaryRunView> {
    const tx = await this.scopeToCaller(companyId);

    const run = await tx.salaryRun.findFirst({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        periodYear: true,
        periodMonth: true,
      },
    });
    if (!run) {
      throw new AppError('NOT_FOUND', 'Salary run not found.');
    }

    if (run.status === 'FINALISED') {
      // A REFUSAL, not a silent success. Reporting success would tell this
      // admin they locked something another admin actually locked, and would
      // overwrite the attribution the run exists to record (FR-027, FR-029).
      throw new AppError(
        'SALARY_RUN_ALREADY_FINALISED',
        'This salary run has already been finalised.',
      );
    }

    await tx.salaryRun.update({
      where: { id: runId },
      data: {
        status: 'FINALISED',
        // The SERVER's clock and the JWT's user — neither is accepted from
        // the body, which is `z.object({}).strict()`.
        finalisedAt: new Date(),
        finalisedBy: actorId,
      },
    });

    return this.getRun(companyId, {
      year: run.periodYear,
      month: run.periodMonth,
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // The calculation
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Every ACTIVE attendance row in the period, optionally for one person.
   *
   * **`isActive: true` is load-bearing, not hygiene.** Attendance amendments
   * are append-only — a new version plus a flip of the previous row's flag —
   * so omitting this double-counts every amended session.
   *
   * **This result set also defines the roster** (research.md §6): a person
   * with no rows in the month is not on the run. That is how mid-month
   * joiners and leavers fall out (FR-023) without a membership rule the data
   * model has no column for.
   */
  private async attendanceForPeriod(
    tx: SalaryTx,
    year: number,
    month: number,
    userId?: string,
  ) {
    return tx.attendance.findMany({
      where: {
        isActive: true,
        businessDate: {
          gte: this.clock.toDateColumn(this.clock.periodStart(year, month)),
          lte: this.clock.toDateColumn(this.clock.periodEnd(year, month)),
        },
        ...(userId ? { userId } : {}),
      },
      select: {
        userId: true,
        businessDate: true,
        session: true,
        status: true,
        latenessFlag: true,
        payableUnits: true,
      },
      orderBy: [{ businessDate: 'asc' }, { session: 'asc' }],
    });
  }

  /**
   * Payable units per user per date.
   *
   * **SUMS THE STORED `payableUnits`. DOES NOT RE-DERIVE FROM `status`.**
   * Both give the same answer today and diverge the moment a company edits
   * `payableUnitByStatus`, at which point re-deriving silently re-prices every
   * past month. The stored column was computed and frozen when the manager
   * saved the day sheet, and it is the only thing that keeps a closed month
   * reproducible (SC-005).
   *
   * Holiday and Weekly Off therefore pay, and Absent and Leave do not,
   * **without this code naming a status at all** — FR-014 through FR-016 are
   * satisfied by arithmetic rather than by a mapping re-implemented here.
   */
  private aggregateUnits(
    rows: Array<{
      userId: string;
      businessDate: Date;
      payableUnits: Prisma.Decimal;
    }>,
  ): Map<string, Map<string, Prisma.Decimal>> {
    const byUser = new Map<string, Map<string, Prisma.Decimal>>();
    for (const row of rows) {
      const date = this.toDateString(row.businessDate);
      if (!byUser.has(row.userId)) byUser.set(row.userId, new Map());
      const byDate = byUser.get(row.userId);
      if (!byDate) continue;
      byDate.set(
        date,
        (byDate.get(date) ?? new Prisma.Decimal(0)).plus(row.payableUnits),
      );
    }
    return byUser;
  }

  /**
   * Splits one person's month into `[{from,to,units,rate,amount}]` sub-lines,
   * one per rate range that actually covers attended dates.
   *
   * **No conflict rule is needed and none may be invented.**
   * `users.service.ts` maintains `UserSalaryRate` as a closed, non-overlapping
   * chain (adding a rate sets the previous row's `effectiveTo` to the day
   * before), so every date falls in exactly one range or in none.
   *
   * Dates in **no** range become a single `rate: null` sub-line carrying their
   * units, so unrated work is visible rather than silently priced at zero
   * (FR-021).
   */
  private splitByRate(
    unitsByDate: Map<string, Prisma.Decimal>,
    rates: Array<{
      halfDayRate: Prisma.Decimal;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    }>,
  ): BreakdownEntry[] {
    const entries: BreakdownEntry[] = [];
    const unratedDates: string[] = [];
    let unratedUnits = new Prisma.Decimal(0);

    const assigned = new Set<string>();

    for (const rate of rates) {
      const from = this.toDateString(rate.effectiveFrom);
      const to = rate.effectiveTo ? this.toDateString(rate.effectiveTo) : null;

      let units = new Prisma.Decimal(0);
      let firstDate: string | null = null;
      let lastDate: string | null = null;

      for (const [date, dateUnits] of unitsByDate) {
        if (date < from) continue;
        if (to !== null && date > to) continue;
        units = units.plus(dateUnits);
        assigned.add(date);
        if (firstDate === null || date < firstDate) firstDate = date;
        if (lastDate === null || date > lastDate) lastDate = date;
      }

      // A range covering zero attended dates contributes nothing and must not
      // appear as an empty sub-line.
      if (firstDate === null || lastDate === null) continue;

      entries.push({
        from: firstDate,
        to: lastDate,
        units: units.toFixed(2),
        rate: rate.halfDayRate.toFixed(2),
        amount: units.times(rate.halfDayRate).toFixed(2),
      });
    }

    for (const [date, dateUnits] of unitsByDate) {
      if (assigned.has(date)) continue;
      unratedDates.push(date);
      unratedUnits = unratedUnits.plus(dateUnits);
    }

    if (unratedDates.length > 0) {
      unratedDates.sort();
      entries.push({
        from: unratedDates[0],
        to: unratedDates[unratedDates.length - 1],
        units: unratedUnits.toFixed(2),
        // No rate was in force for these dates. The units are carried so the
        // gap is visible; the amount is zero because nothing can price them.
        rate: null,
        amount: '0.00',
      });
    }

    entries.sort((a, b) => a.from.localeCompare(b.from));
    return entries;
  }

  /**
   * Sessions the manager never marked, across the whole company for a period.
   *
   * **Computed per request and deliberately not stored**, because it describes
   * attendance NOW: an admin who fills a gap and reopens the screen must see
   * this fall, and a stored warning would outlive the problem it warned about.
   *
   * **What this cannot catch, stated rather than implied**: a day sheet never
   * opened at all. Sessions are counted only against days a person already
   * has SOME attendance row for, because nothing in the data distinguishes
   * "the manager forgot this person" from "this person was not on staff that
   * day". Catching that needs a company working-calendar, which the product
   * does not have and this slice does not add.
   */
  private async countUnmarkedSessions(
    tx: SalaryTx,
    year: number,
    month: number,
  ): Promise<number> {
    const rows = await this.attendanceForPeriod(tx, year, month);
    const seen = new Map<string, Set<Session>>();
    for (const row of rows) {
      const key = `${row.userId}|${this.toDateString(row.businessDate)}`;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)?.add(row.session);
    }
    let unmarked = 0;
    for (const sessions of seen.values()) {
      unmarked += BOTH_SESSIONS.length - sessions.size;
    }
    return unmarked;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────

  private async findRun(
    tx: SalaryTx,
    year: number,
    month: number,
    version?: number,
  ) {
    return tx.salaryRun.findFirst({
      where: {
        periodYear: year,
        periodMonth: month,
        ...(version !== undefined ? { version } : {}),
      },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        status: true,
        version: true,
        grossTotal: true,
        generatedAt: true,
        generatedBy: true,
        finalisedAt: true,
        finalisedBy: true,
        lines: {
          select: {
            userId: true,
            payableUnits: true,
            amount: true,
            breakdown: true,
          },
        },
      },
    });
  }

  /**
   * The company's own name, for the payslip header.
   *
   * Its own transaction, for the same reason {@link getLineForServing} has
   * one: the only caller is the `@Public()` payslip route.
   */
  async companyName(companyId: string): Promise<string> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { name: true },
      });
      return company?.name ?? 'Company';
    });
  }

  private async namesFor(
    tx: SalaryTx,
    userIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    const users = await tx.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  private toDateString(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
