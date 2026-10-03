import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  AppError,
  type CreateUserInput,
  type ListUsersQuery,
  type RoleKey as RoleKeyType,
  type SalaryRateInput,
  type UpdateUserInput,
  type UserStatus,
} from '@field-sales/shared';

import * as password from '../../infra/security/password';
import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { FilesService } from '../files/files.service';

/**
 * Own module-level, unextended Prisma client — same established pattern as
 * `companies.service.ts`/`auth.service.ts`/`me.service.ts` (see those
 * files' comments for why there is still no shared `PrismaService`). Used
 * only as a defensive fallback if this service is ever invoked with no
 * active transaction on CLS, which should not happen on a real request:
 * every route on `UsersController` is an ordinary authenticated route (not
 * `@Public()`, not `@SkipTenant()`), so the global `TransactionInterceptor`
 * always opens one before any method here runs.
 */
const prisma = new PrismaClient();

/** The subset of the active transaction client this service needs. */
type UsersTx = Pick<
  PrismaClient,
  'user' | 'userSalaryRate' | 'role' | '$executeRaw'
>;

export interface UserListItem {
  id: string;
  name: string;
  role: RoleKeyType;
  status: UserStatus;
  username: string | null;
  email: string | null;
  halfDayRate: string | null;
  photoUrl: string | null;
}

export interface UserListResult {
  items: UserListItem[];
  nextCursor: string | null;
}

/** The subset of a looked-up `User` row (+ its role key) {@link UsersService.toListItem} needs. */
interface UserRow {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  status: string;
  photoId: string | null;
  role: { key: RoleKeyType };
}

/**
 * Backs `GET/POST /users`, `PATCH /users/:id` and `POST
 * /users/:id/salary-rates` (User Story 3,
 * specs/001-company-user-auth/orchestration-plan.md; shapes per
 * contracts/users.md).
 *
 * This is the first ordinary (non-`@SkipTenant()`) module in this codebase
 * to genuinely exercise Layer-1 tenant scoping end-to-end, per the plan's
 * "On tenant scoping without `TenantContextInterceptor`" section:
 * `TransactionInterceptor`'s ordinary branch opens this request's
 * transaction with `app.company_id` set to whatever was already in CLS —
 * which is always empty, since nothing populates CLS with a tenant user's
 * `companyId` before a handler runs yet (`TenantContextInterceptor` is a
 * later work unit). So every public method below re-sets BOTH the RLS
 * session variable and CLS's own `companyId` key, from the caller's own
 * JWT-verified `companyId` (never client input), reusing the SAME
 * already-open CLS transaction — mirroring `companies.service.ts`'s
 * mid-transaction `set_config` + `cls.set('companyId', ...)` pattern
 * exactly (NOT `me.service.ts`'s separate-transaction approach). Every
 * subsequent `tx.user.*`/`tx.userSalaryRate.*` call then runs through the
 * real `tenant.extension.ts` Layer-1 filter/injection *and* Postgres RLS
 * together, instead of a hand-rolled `where: { companyId }` filter against
 * an unextended client.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly cls: ClsService<TransactionClsStore>,
    private readonly filesService: FilesService,
  ) {}

  /** The active request transaction, or the unextended fallback client (see class doc comment above for when that fallback would ever be used). */
  private tx(): UsersTx {
    const store = this.cls.get();
    return (store?.tx as UsersTx | undefined) ?? prisma;
  }

  /**
   * Re-scopes the already-open CLS transaction to the caller's own,
   * JWT-verified `companyId` — both the RLS session variable (Layer 2) and
   * CLS's own `companyId` key (which `tenant.extension.ts`'s Layer-1 filter
   * reads for every `tx.user.*`/`tx.userSalaryRate.*` call that follows).
   * Called at the top of EVERY public method below — each is its own
   * request entry point and must never assume a sibling method already did
   * this for the same transaction.
   */
  private async scopeToCaller(companyId: string): Promise<UsersTx> {
    const tx = this.tx();
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    this.cls.set('companyId', companyId);
    return tx;
  }

  /** `GET /users` (DoD item 2). `search` matches name/username/email (FR-015); `role`/`status` are optional filters; cursor-paginated. */
  async list(
    companyId: string,
    callerId: string,
    query: ListUsersQuery,
  ): Promise<UserListResult> {
    const tx = await this.scopeToCaller(companyId);

    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: { key: query.role } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { username: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await tx.user.findMany({
      where,
      take: query.limit,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        status: true,
        photoId: true,
        role: { select: { key: true } },
      },
    });

    const items = await Promise.all(
      rows.map((row) => this.toListItem(tx, companyId, callerId, row, true)),
    );

    return {
      items,
      nextCursor:
        rows.length === query.limit
          ? (rows[rows.length - 1]?.id ?? null)
          : null,
    };
  }

  /**
   * `POST /users` (DoD item 3). Rejects a duplicate `(companyId,
   * lower(username))` as `409 USERNAME_TAKEN` (gap #4 — application-level
   * check only, mirroring `auth.service.ts`'s `mode: 'insensitive'` lookup,
   * run inside the same transaction immediately before `create()`). When
   * `halfDayRate`+`rateEffectiveFrom` are supplied, inserts one open-ended
   * `UserSalaryRate` row in the same transaction as the `User` row.
   */
  async create(
    companyId: string,
    callerId: string,
    input: CreateUserInput,
  ): Promise<UserListItem> {
    const tx = await this.scopeToCaller(companyId);

    const role = await tx.role.findUnique({
      where: { companyId_key: { companyId, key: input.role } },
    });
    if (!role) {
      // Defensive only — every company's four tenant roles are seeded the
      // moment the company is created (roles.seed.ts, User Story 1); this
      // can only happen if that seeding step is ever edited to drop one of
      // the four keys `createUserSchema`'s `role` field restricts to.
      throw new Error(
        `Role "${input.role}" is not seeded for company "${companyId}".`,
      );
    }

    if (input.username) {
      const existing = await tx.user.findFirst({
        where: {
          companyId,
          username: { equals: input.username, mode: 'insensitive' },
        },
      });
      if (existing) {
        throw new AppError(
          'USERNAME_TAKEN',
          `Username "${input.username}" is already in use in this company.`,
        );
      }
    }

    const passwordHash = input.temporaryPassword
      ? await password.hash(input.temporaryPassword)
      : null;

    const user = await tx.user.create({
      data: {
        roleId: role.id,
        name: input.name,
        email: input.email,
        username: input.username,
        passwordHash,
        mobile: input.mobile,
        photoId: input.photoFileId,
        status: input.status,
        monthlySalary: input.monthlySalary,
      },
    });

    if (input.halfDayRate && input.rateEffectiveFrom) {
      await tx.userSalaryRate.create({
        data: {
          // `companyId` is non-nullable on `UserSalaryRate` (unlike
          // `User`/`FileObject`'s nullable column), so Prisma's generated
          // `UserSalaryRateUncheckedCreateInput` requires it present even
          // though `tenant.extension.ts`'s Layer-1 filter unconditionally
          // overwrites it with the CLS value right before the query runs
          // (Constitution rule 1 — the server, never client input, owns
          // this value; this companyId is already the caller's own
          // JWT-verified one, not anything client-supplied).
          companyId,
          userId: user.id,
          halfDayRate: input.halfDayRate,
          effectiveFrom: this.parseIsoDate(input.rateEffectiveFrom),
          effectiveTo: null,
          createdByUserId: callerId,
        },
      });
    }

    return this.toListItem(
      tx,
      companyId,
      callerId,
      {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        status: user.status,
        photoId: user.photoId,
        role: { key: role.key },
      },
      false,
    );
  }

  /**
   * `PATCH /users/:id` (DoD item 4). A cross-tenant `:id` resolves as `404
   * NOT_FOUND` — the explicit `where: { id, companyId }` filter below
   * already makes a cross-tenant row invisible, no special-case code
   * needed. `status: INACTIVE` bumps `tokenVersion` so outstanding access
   * tokens for that user stop passing `ActiveAccountGuard` immediately
   * (FR-019). The rate-change pair, if present, goes through
   * {@link applyRateChange} instead of a plain field update (DoD item 5).
   */
  async update(
    companyId: string,
    callerId: string,
    id: string,
    input: UpdateUserInput,
  ): Promise<UserListItem> {
    const tx = await this.scopeToCaller(companyId);

    const existing = await tx.user.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', `User "${id}" was not found.`);
    }

    const becomingInactive =
      input.status === 'INACTIVE' && existing.status !== 'INACTIVE';

    const updated = await tx.user.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email,
        status: input.status,
        photoId: input.photoFileId,
        monthlySalary: input.monthlySalary,
        ...(becomingInactive ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        status: true,
        photoId: true,
        role: { select: { key: true } },
      },
    });

    if (input.halfDayRate && input.rateEffectiveFrom) {
      await this.applyRateChange(
        tx,
        companyId,
        id,
        callerId,
        input.halfDayRate,
        input.rateEffectiveFrom,
      );
    }

    return this.toListItem(tx, companyId, callerId, updated, false);
  }

  /** `POST /users/:id/salary-rates` (DoD item 6) — thin alias for the rate-change half of `PATCH /users/:id`, per Architecture §9's API table. */
  async changeSalaryRate(
    companyId: string,
    callerId: string,
    id: string,
    input: SalaryRateInput,
  ): Promise<UserListItem> {
    const tx = await this.scopeToCaller(companyId);

    const existing = await tx.user.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        status: true,
        photoId: true,
        role: { select: { key: true } },
      },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', `User "${id}" was not found.`);
    }

    await this.applyRateChange(
      tx,
      companyId,
      id,
      callerId,
      input.halfDayRate,
      input.rateEffectiveFrom,
    );

    return this.toListItem(tx, companyId, callerId, existing, false);
  }

  /**
   * FR-020 / data-model.md's `UserSalaryRate` rule (DoD item 5): never
   * edits the existing open-ended row — sets its `effectiveTo = new row's
   * effectiveFrom − 1 day` and inserts a new row with `effectiveTo: null`.
   * Shared by {@link update} (the rate-change half of `PATCH /users/:id`)
   * and {@link changeSalaryRate} (`POST /users/:id/salary-rates`).
   */
  private async applyRateChange(
    tx: UsersTx,
    companyId: string,
    userId: string,
    callerId: string,
    halfDayRate: string,
    rateEffectiveFrom: string,
  ): Promise<void> {
    const newEffectiveFrom = this.parseIsoDate(rateEffectiveFrom);

    const currentOpenEnded = await tx.userSalaryRate.findFirst({
      where: { userId, effectiveTo: null },
    });

    if (currentOpenEnded) {
      const previousDay = new Date(newEffectiveFrom);
      previousDay.setUTCDate(previousDay.getUTCDate() - 1);
      await tx.userSalaryRate.update({
        where: { id: currentOpenEnded.id },
        data: { effectiveTo: previousDay },
      });
    }

    await tx.userSalaryRate.create({
      data: {
        // See the identical note in `create()` above — non-nullable
        // column, Layer-1 overwrites it from CLS regardless.
        companyId,
        userId,
        halfDayRate,
        effectiveFrom: newEffectiveFrom,
        effectiveTo: null,
        createdByUserId: callerId,
      },
    });
  }

  /** `rateEffectiveFrom`/dates are plain `YYYY-MM-DD` strings (contracts/users.md) — parsed as UTC midnight so the `@db.Date` column stores the calendar date the caller meant, not a timezone-shifted neighbour. */
  private parseIsoDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  /** The current (open-ended) `UserSalaryRate` row's rate, as a decimal string, or `null` if the user has none (contracts/users.md). */
  private async currentHalfDayRate(
    tx: UsersTx,
    userId: string,
  ): Promise<string | null> {
    const row = await tx.userSalaryRate.findFirst({
      where: { userId, effectiveTo: null },
    });
    return row ? row.halfDayRate.toString() : null;
  }

  private async toListItem(
    tx: UsersTx,
    companyId: string,
    viewerId: string,
    row: UserRow,
    thumb: boolean,
  ): Promise<UserListItem> {
    const halfDayRate = await this.currentHalfDayRate(tx, row.id);
    return {
      id: row.id,
      name: row.name,
      role: row.role.key,
      status: row.status as UserStatus,
      username: row.username,
      email: row.email,
      halfDayRate,
      photoUrl: row.photoId
        ? this.filesService.signFileUrl(row.photoId, viewerId, companyId, thumb)
        : null,
    };
  }
}
