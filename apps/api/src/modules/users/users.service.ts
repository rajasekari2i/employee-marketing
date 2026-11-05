import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  AppError,
  type CreateUserInput,
  type ListUsersQuery,
  type RoleKey as RoleKeyType,
  type SalaryRateInput,
  type SetUserPasswordInput,
  type UpdateUserInput,
  type UserStatus,
} from '@field-sales/shared';

import * as password from '../../infra/security/password';
import type { TransactionClsStore } from '../../common/interceptors/transaction.interceptor';
import { TokenService } from '../auth/token.service';
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
  | 'user'
  | 'userSalaryRate'
  | 'role'
  | '$executeRaw'
  // Not queried directly here — handed to `FilesService.deleteIfUnreferenced`
  // (which needs both) so the replaced-photo cleanup runs inside THIS
  // request's already-scoped transaction rather than a second one that
  // would still see the pre-update `photoId`.
  | 'fileObject'
  | 'shopPhoto'
>;

export interface UserListItem {
  id: string;
  name: string;
  role: RoleKeyType;
  status: UserStatus;
  username: string | null;
  email: string | null;
  monthlySalary: string | null;
  halfDayRate: string | null;
  /** The current (open-ended) `UserSalaryRate` row's `effectiveFrom`, `YYYY-MM-DD` — `null` iff `halfDayRate` is. */
  rateEffectiveFrom: string | null;
  photoUrl: string | null;
}

export interface UserListResult {
  items: UserListItem[];
  nextCursor: string | null;
}

/**
 * Response shape shared by `POST /users/:id/revoke-sessions` and `POST
 * /users/:id/password` (contracts/users.md) — setting a password ends every
 * session too (FR-014), so both report the same thing.
 */
export interface RevokeSessionsResult {
  /**
   * How many still-active `RefreshToken` rows were revoked — i.e. roughly
   * how many devices this signed out. "Roughly" because a device that
   * never refreshed, or whose refresh token already expired, has no active
   * row to count, so this is a floor rather than an exact device census.
   */
  revokedSessions: number;
}

/** The subset of a looked-up `User` row (+ its role key) {@link UsersService.toListItem} needs. */
interface UserRow {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  status: string;
  photoId: string | null;
  monthlySalary: { toString(): string } | null;
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
    private readonly tokens: TokenService,
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
        monthlySalary: true,
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

    const role = await this.requireSeededRole(tx, input.role);

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
        monthlySalary: user.monthlySalary,
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
   *
   * `role` and `username` are both patchable here. Two things that are
   * deliberately NOT done when the role changes:
   *
   * - Credentials are left alone. Demoting someone to `EMPLOYEE` keeps
   *   their `username`/`passwordHash` row intact but dormant, so restoring
   *   their old role later gives back the login they already had instead
   *   of forcing a fresh username + temporary password. Sign-in is what
   *   enforces the demotion — `auth.service.ts` rejects an `EMPLOYEE` role
   *   on `login`/`refresh`/`forgotPassword`/`verifyOtp` regardless of a
   *   stored hash — so a dormant credential is never a usable one.
   * - `tokenVersion` is NOT bumped. The caller's `role` and `permissions`
   *   are claims inside their 15-minute access token, so a role change
   *   only takes effect for that user on their next token refresh. This is
   *   a deliberate product decision, not an oversight; bumping
   *   `tokenVersion` here (one line, mirroring the `becomingInactive`
   *   branch below) is what would make it immediate.
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
      // `photoId` is read only to clean up after a photo REPLACEMENT below
      // — see the `deleteIfUnreferenced` call at the end of this method.
      select: { id: true, status: true, photoId: true },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', `User "${id}" was not found.`);
    }

    const becomingInactive =
      input.status === 'INACTIVE' && existing.status !== 'INACTIVE';

    const roleId = input.role
      ? (await this.requireSeededRole(tx, input.role)).id
      : undefined;

    // Same application-level `(companyId, lower(username))` check `create()`
    // runs (gap #4 — there is no DB unique index backing it), with the one
    // difference that this row must be excluded from its own collision
    // check: re-saving the form without touching the username field sends
    // the current username back unchanged, and `id: { not: id }` is what
    // keeps that from reporting the user as a duplicate of themself.
    if (input.username) {
      const collision = await tx.user.findFirst({
        where: {
          companyId,
          id: { not: id },
          username: { equals: input.username, mode: 'insensitive' },
        },
      });
      if (collision) {
        throw new AppError(
          'USERNAME_TAKEN',
          `Username "${input.username}" is already in use in this company.`,
        );
      }
    }

    const updated = await tx.user.update({
      where: { id },
      data: {
        name: input.name,
        email: input.email,
        roleId,
        username: input.username,
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
        monthlySalary: true,
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

    // A profile photo is replaced, not versioned: once `photoId` points at
    // the newly uploaded file, the one it used to point at is nobody's
    // photo any more and should not linger in `file_objects`. Guarded on
    // `input.photoFileId` because an absent field means "leave the photo
    // alone" (Prisma reads the `undefined` above as no-change), not "clear
    // it" — only a request that actually supplied a new photo has replaced
    // anything. Left until last on purpose: it removes bytes from storage,
    // which no transaction rollback can put back, so it runs after every
    // step that could still fail.
    if (input.photoFileId && existing.photoId) {
      await this.filesService.deleteIfUnreferenced(tx, existing.photoId);
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
        monthlySalary: true,
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
   * `POST /users/:id/revoke-sessions` — signs the target user out of every
   * device they are currently signed in on.
   *
   * Both halves are needed, and neither alone is sufficient:
   *
   * - `tokenVersion` bump stops every **access** token already in that
   *   user's hands. `ActiveAccountGuard` compares the token's `ver` claim
   *   against this column, so the bump takes effect on their very next
   *   request rather than up to 15 minutes later when the token expires.
   * - `revokeAllRefreshTokens` stops every **refresh** token, which the
   *   `tokenVersion` bump on its own would not: an un-revoked refresh
   *   token would simply mint a new access token carrying the new `ver`,
   *   and the "logout" would last one round trip.
   *
   * Ordering mirrors `AuthService.resetPassword()`/`changePassword()`: the
   * column bump goes through the request's tenant-scoped transaction (so a
   * cross-tenant `:id` is invisible, as everywhere else here), and the
   * refresh-token sweep runs after it on `TokenService`'s own client —
   * `RefreshToken` carries no `companyId` and is not a tenant-scoped
   * table. That sweep is therefore outside this request's transaction, so
   * a later rollback would leave the tokens revoked but the `tokenVersion`
   * unchanged. That is the safe direction to fail in: the user is signed
   * out and has to sign in again, which is what was asked for anyway.
   *
   * Nothing stops a Company Admin aiming this at their own id — the result
   * is simply that they are signed out too, on this device along with the
   * rest. The mobile screen says so before asking them to confirm.
   */
  async revokeSessions(
    companyId: string,
    id: string,
  ): Promise<RevokeSessionsResult> {
    const tx = await this.scopeToCaller(companyId);
    await this.requireUser(tx, companyId, id);

    return { revokedSessions: await this.endAllSessions(tx, id) };
  }

  /**
   * `POST /users/:id/password` — a Company Admin setting another user's
   * password, for the two cases the app otherwise has no answer for: a
   * user promoted out of `EMPLOYEE` who has never had one, and anyone
   * locked out who cannot complete the SMS OTP reset themselves.
   *
   * Every active session ends, via the same {@link endAllSessions} the
   * revoke-sessions route uses. That is FR-014 ("completing a password
   * reset or change MUST end every other active session"), which does not
   * distinguish who performed the change — and it is the behaviour that
   * makes this safe to use on a lost or shared device, since the old
   * password's sessions do not outlive it.
   *
   * Deliberately allowed even when the target's role is `EMPLOYEE`: a
   * stored credential on an `EMPLOYEE` row is dormant, never usable (see
   * `auth.service.ts`'s `roleCanSignIn`), so this is harmless there and
   * refusing it would force role and password to be set in one specific
   * order when promoting someone.
   *
   * No `currentPassword` is required — the admin is not the account
   * holder and has no way to know it. `@Roles('COMPANY_ADMIN')` on the
   * controller plus the tenant-scoped lookup is the whole authorisation
   * story, and `@Audited('user.password.set')` records who did it.
   */
  async setPassword(
    companyId: string,
    id: string,
    input: SetUserPasswordInput,
  ): Promise<RevokeSessionsResult> {
    const tx = await this.scopeToCaller(companyId);
    await this.requireUser(tx, companyId, id);

    const passwordHash = await password.hash(input.newPassword);

    return {
      revokedSessions: await this.endAllSessions(tx, id, { passwordHash }),
    };
  }

  /** Tenant-scoped existence check — a cross-tenant `:id` is `404`, never `403`, as everywhere else here. */
  private async requireUser(
    tx: UsersTx,
    companyId: string,
    id: string,
  ): Promise<void> {
    const existing = await tx.user.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', `User "${id}" was not found.`);
    }
  }

  /**
   * Ends every session `userId` currently holds and returns how many
   * refresh tokens that revoked. Shared by {@link revokeSessions} and
   * {@link setPassword}; `alsoSet` is how the latter folds the new
   * `passwordHash` into the very same `UPDATE` as the `tokenVersion` bump,
   * so there is no window in which the password has changed but the old
   * access tokens still pass.
   *
   * See {@link revokeSessions}'s doc comment for why both halves are
   * needed and why the refresh-token sweep runs outside this request's
   * transaction.
   */
  private async endAllSessions(
    tx: UsersTx,
    userId: string,
    alsoSet: Prisma.UserUpdateInput = {},
  ): Promise<number> {
    await tx.user.update({
      where: { id: userId },
      data: { ...alsoSet, tokenVersion: { increment: 1 } },
    });

    return this.tokens.revokeAllRefreshTokens(userId);
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

  /**
   * Resolves a `RoleKey` to its application-wide `Role` row. Shared by
   * `create()` (the new user's role) and `update()` (a role change).
   *
   * A miss is `throw new Error`, not an `AppError`: `role` is already
   * constrained to `tenantAssignableRoleKeySchema` by the time it reaches
   * here, so an unseeded key is a deployment fault (a database that never
   * had `prisma db seed` run against it), not anything the caller can fix
   * by changing their request.
   */
  private async requireSeededRole(
    tx: UsersTx,
    key: CreateUserInput['role'],
  ): Promise<{ id: string; key: RoleKeyType }> {
    const role = await tx.role.findUnique({ where: { key } });
    if (!role) {
      throw new Error(
        `Role "${key}" is not seeded — run \`prisma db seed\` against this database first.`,
      );
    }
    return { id: role.id, key: role.key };
  }

  /** `rateEffectiveFrom`/dates are plain `YYYY-MM-DD` strings (contracts/users.md) — parsed as UTC midnight so the `@db.Date` column stores the calendar date the caller meant, not a timezone-shifted neighbour. */
  private parseIsoDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  /** The current (open-ended) `UserSalaryRate` row's rate + its `effectiveFrom` (as a `YYYY-MM-DD` string), or both `null` if the user has none (contracts/users.md). */
  private async currentSalaryRate(
    tx: UsersTx,
    userId: string,
  ): Promise<{ halfDayRate: string | null; rateEffectiveFrom: string | null }> {
    const row = await tx.userSalaryRate.findFirst({
      where: { userId, effectiveTo: null },
    });
    if (!row) {
      return { halfDayRate: null, rateEffectiveFrom: null };
    }
    return {
      halfDayRate: row.halfDayRate.toString(),
      rateEffectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    };
  }

  private async toListItem(
    tx: UsersTx,
    companyId: string,
    viewerId: string,
    row: UserRow,
    thumb: boolean,
  ): Promise<UserListItem> {
    const { halfDayRate, rateEffectiveFrom } = await this.currentSalaryRate(
      tx,
      row.id,
    );
    return {
      id: row.id,
      name: row.name,
      role: row.role.key,
      status: row.status as UserStatus,
      username: row.username,
      email: row.email,
      monthlySalary: row.monthlySalary ? row.monthlySalary.toString() : null,
      halfDayRate,
      rateEffectiveFrom,
      photoUrl: row.photoId
        ? this.filesService.signFileUrl(row.photoId, viewerId, companyId, thumb)
        : null,
    };
  }
}
