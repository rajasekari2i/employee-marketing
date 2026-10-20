import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  AppError,
  type AttendanceDayQuery,
  type RecordAttendanceInput,
} from '@field-sales/shared';

import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { CompanyClock } from '../../infra/time/company-clock.service';

const prisma = new PrismaClient();

type AttendanceTx = Pick<
  PrismaClient,
  'attendance' | 'user' | 'company' | 'companySettings' | '$executeRaw'
>;

type Session = 'MORNING' | 'EVENING';
type Status = 'PRESENT' | 'ABSENT' | 'LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF';
type Lateness = 'ON_TIME' | 'DELAY_1H' | 'DELAY_2H';

export interface AttendanceCell {
  status: Status;
  actualTime: Date | null;
  latenessFlag: Lateness | null;
  recordedByName: string | null;
  recordedAt: Date;
  version: number;
}

export interface AttendanceDay {
  businessDate: string;
  isToday: boolean;
  isFuture: boolean;
  counts: {
    present: number;
    late: number;
    absentOrLeave: number;
    notMarked: number;
  };
  people: Array<{
    userId: string;
    name: string;
    roleLabel: string;
    morning: AttendanceCell | null;
    evening: AttendanceCell | null;
  }>;
}

export interface RecordAttendanceResult {
  userId: string;
  businessDate: string;
  session: Session;
  status: Status;
  actualTime: Date | null;
  latenessFlag: Lateness | null;
  version: number;
  supersededVersion: number | null;
}

/** The default used when a company has no settings row, matching the schema. */
const DEFAULT_PAYABLE: Record<Status, number> = {
  PRESENT: 1,
  HOLIDAY: 1,
  WEEKLY_OFF: 1,
  LEAVE: 0,
  ABSENT: 0,
};

/**
 * Backs `GET /attendance` and `POST /attendance` — boards 3.7 and 3.8
 * (010-manager-app). Paths taken verbatim from `03-ARCHITECTURE.md:834`.
 *
 * Its own module because attendance is its own aggregate, with its own model
 * and its own versioning rules.
 *
 * **Company-scoped, with no per-user narrowing, and that is correct**
 * (FR-050): a manager records attendance for every member of staff. The RLS
 * migration carries the same note, because every other tenant policy in this
 * repo warns that company scope is not enough — here it is.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly cls: ClsService<TransactionClsStore>,
    private readonly clock: CompanyClock,
  ) {}

  private tx(): AttendanceTx {
    const store = this.cls.get();
    return (store?.tx as AttendanceTx | undefined) ?? prisma;
  }

  private async scopeToCaller(companyId: string): Promise<AttendanceTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  async day(
    companyId: string,
    query: AttendanceDayQuery,
  ): Promise<AttendanceDay> {
    const tx = await this.scopeToCaller(companyId);

    const today = await this.todayFor(tx, companyId);
    const businessDate = query.date ?? today;

    // The roster: every ACTIVE member of staff except the System Admin
    // (FR-040, decided with the user) — Employees, Executives, Managers and
    // Company Admins alike. A manager therefore appears on their own sheet
    // (FR-040a). That looks like a bug and is not: every record carries its
    // author and every change is an amendment, so a self-recorded entry is
    // exactly as traceable as any other.
    const people = await tx.user.findMany({
      where: { status: 'ACTIVE', role: { key: { not: 'SYSTEM_ADMIN' } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: { select: { label: true } } },
    });

    const records = await tx.attendance.findMany({
      where: {
        businessDate: this.clock.toDateColumn(businessDate),
        isActive: true,
      },
      select: {
        userId: true,
        session: true,
        status: true,
        actualTime: true,
        latenessFlag: true,
        recordedBy: true,
        recordedAt: true,
        version: true,
      },
    });

    const names = new Map(people.map((p) => [p.id, p.name]));
    const byUser = new Map<string, Partial<Record<Session, AttendanceCell>>>();
    for (const r of records) {
      const cell: AttendanceCell = {
        status: r.status,
        actualTime: r.actualTime,
        latenessFlag: r.latenessFlag,
        recordedByName: names.get(r.recordedBy) ?? null,
        recordedAt: r.recordedAt,
        version: r.version,
      };
      const entry = byUser.get(r.userId) ?? {};
      entry[r.session] = cell;
      byUser.set(r.userId, entry);
    }

    const rows = people.map((p) => {
      const entry = byUser.get(p.id) ?? {};
      return {
        userId: p.id,
        name: p.name,
        roleLabel: p.role.label,
        // `null` for an unmarked session — NEVER omitted, because the sheet
        // is a grid and a missing cell would shift the row.
        morning: entry.MORNING ?? null,
        evening: entry.EVENING ?? null,
      };
    });

    const cells = rows.flatMap((r) =>
      [r.morning, r.evening].filter((c): c is AttendanceCell => c !== null),
    );

    return {
      businessDate,
      isToday: businessDate === today,
      isFuture: businessDate > today,
      counts: {
        present: cells.filter((c) => c.status === 'PRESENT').length,
        late: cells.filter(
          (c) => c.latenessFlag === 'DELAY_1H' || c.latenessFlag === 'DELAY_2H',
        ).length,
        absentOrLeave: cells.filter(
          (c) => c.status === 'ABSENT' || c.status === 'LEAVE',
        ).length,
        notMarked: rows.length * 2 - cells.length,
      },
      people: rows,
    };
  }

  /**
   * The append-only write.
   *
   * **An amendment INSERTS at version + 1 and flips the previous row's
   * `isActive` — it never UPDATEs a status, a time or a flag**
   * (Constitution rule 4, FR-037). Both halves are in one transaction,
   * because two active rows for one session, or none, are each corrupt.
   */
  async record(
    companyId: string,
    managerId: string,
    input: RecordAttendanceInput,
  ): Promise<RecordAttendanceResult> {
    const tx = await this.scopeToCaller(companyId);

    const today = await this.todayFor(tx, companyId);
    if (input.businessDate > today) {
      throw new AppError(
        'ATTENDANCE_DATE_IN_FUTURE',
        'Attendance cannot be recorded for a future date.',
      );
    }

    const person = await tx.user.findFirst({
      where: {
        id: input.userId,
        status: 'ACTIVE',
        role: { key: { not: 'SYSTEM_ADMIN' } },
      },
      select: { id: true },
    });
    if (!person) {
      throw new AppError('NOT_FOUND', 'Person not found on the day sheet.');
    }

    const businessDate = this.clock.toDateColumn(input.businessDate);

    const existing = await tx.attendance.findFirst({
      where: {
        userId: input.userId,
        businessDate,
        session: input.session,
        isActive: true,
      },
      select: { id: true, version: true },
    });

    // The SERVER decides whether this is an amendment; the client never
    // declares it. Requiring a reason to record a plain Present would be
    // noise, and letting the client say "this is an amendment" would let it
    // lie about which case it is in.
    if (existing && !input.changeReason) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Changing an existing attendance record requires a reason.',
      );
    }

    const settings = await tx.companySettings.findUnique({
      where: { companyId },
      select: {
        morningSessionStart: true,
        eveningSessionStart: true,
        delay1hMinutes: true,
        delay2hMinutes: true,
        payableUnitByStatus: true,
      },
    });

    const actualTime = input.actualTime ? new Date(input.actualTime) : null;
    const latenessFlag = this.deriveLateness(
      input.status,
      actualTime,
      input.session,
      settings,
    );
    const payableUnits = this.derivePayableUnits(input.status, settings);

    const version = (existing?.version ?? 0) + 1;

    let createdId: string;
    try {
      const created = await tx.attendance.create({
        data: {
          companyId,
          userId: input.userId,
          businessDate,
          session: input.session,
          status: input.status,
          actualTime,
          latenessFlag,
          payableUnits: new Prisma.Decimal(payableUnits),
          version,
          isActive: true,
          changeReason: input.changeReason ?? null,
          recordedBy: managerId,
        },
        select: { id: true },
      });
      createdId = created.id;
    } catch (error) {
      // P2002 on (companyId, userId, businessDate, session, version) —
      // another manager amended the same session between our read and our
      // write. One winner, one refusal, never a lost update (SC-009).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          'ATTENDANCE_VERSION_CONFLICT',
          'This attendance record changed while you were editing it. Reload and try again.',
        );
      }
      throw error;
    }

    if (existing) {
      // Same transaction as the insert above — see the method's note.
      await tx.attendance.update({
        where: { id: existing.id },
        data: { isActive: false, supersededById: createdId },
      });
    }

    return {
      userId: input.userId,
      businessDate: input.businessDate,
      session: input.session,
      status: input.status,
      actualTime,
      latenessFlag,
      version,
      supersededVersion: existing?.version ?? null,
    };
  }

  /**
   * `ON_TIME` / `DELAY_1H` / `DELAY_2H`, from the company's own session
   * start time and delay thresholds.
   *
   * **Never accepted from a client** (FR-035, SC-010). It looks like an
   * observation the device could make — it knows the arrival time — but it
   * is the company's settings applied to one, exactly as `isExceedRange` is
   * the company's radius applied to a position.
   *
   * Only `PRESENT` has a lateness; the other four statuses have no arrival
   * time to be late against.
   */
  private deriveLateness(
    status: Status,
    actualTime: Date | null,
    session: Session,
    settings: {
      morningSessionStart: string;
      eveningSessionStart: string;
      delay1hMinutes: number;
      delay2hMinutes: number;
    } | null,
  ): Lateness | null {
    if (status !== 'PRESENT' || !actualTime) {
      return null;
    }

    const start =
      session === 'MORNING'
        ? (settings?.morningSessionStart ?? '09:00')
        : (settings?.eveningSessionStart ?? '14:00');
    const [startHour, startMinute] = start.split(':').map(Number);

    const minutesLate =
      actualTime.getUTCHours() * 60 +
      actualTime.getUTCMinutes() -
      ((startHour ?? 0) * 60 + (startMinute ?? 0));

    if (minutesLate >= (settings?.delay2hMinutes ?? 120)) {
      return 'DELAY_2H';
    }
    if (minutesLate >= (settings?.delay1hMinutes ?? 60)) {
      return 'DELAY_1H';
    }
    return 'ON_TIME';
  }

  /**
   * From `CompanySettings.payableUnitByStatus`, the JSON map slice 001
   * seeded with no consumer. This is that consumer.
   *
   * **Lateness never reduces it** (OD-01, FR-038) — the value depends on the
   * status alone, which is why `latenessFlag` is not a parameter here.
   */
  private derivePayableUnits(
    status: Status,
    settings: { payableUnitByStatus: Prisma.JsonValue } | null,
  ): number {
    const map = settings?.payableUnitByStatus as
      Record<string, number> | undefined;
    return map?.[status] ?? DEFAULT_PAYABLE[status];
  }

  private async todayFor(tx: AttendanceTx, companyId: string): Promise<string> {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { timezone: true },
    });
    return this.clock.businessDate(company?.timezone ?? 'Asia/Kolkata');
  }
}
