import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError, type RoleKey, type UserStatus } from '@field-sales/shared';

import type { AccessTokenPayload } from '../../common/guards/jwt-auth.guard';
import { FilesService } from '../files/files.service';

/**
 * Own module-level, unextended Prisma client — same established pattern as
 * `auth.service.ts`/`active-account.guard.ts`/`login-throttler.guard.ts`
 * (WU-04/WU-05's "there is no shared `PrismaService` yet" note). `GET /me`
 * is an ordinary authenticated (not `@Public()`, not `@SkipTenant()`)
 * route, so it DOES go through the global `TransactionInterceptor` — but
 * that interceptor's "ordinary tenant" branch reads `cls.get('companyId')`,
 * which nothing in this codebase populates yet for a plain authenticated
 * request (Architecture §4's `TenantContextInterceptor`, which would read
 * it off the verified JWT and seed CLS with it, is explicitly "built in a
 * later work unit" per `transaction.extension.ts`'s own doc comment). This
 * service therefore cannot rely on the CLS-attached `tx` the way a
 * `TenantContextInterceptor`-backed route eventually will — it opens its
 * own transaction and sets the RLS session variable itself, directly off
 * `request.user` (the already-verified JWT claims `JwtAuthGuard` attached),
 * exactly like `AuthService`/`ActiveAccountGuard` already do for the same
 * structural reason.
 */
const prisma = new PrismaClient();

export interface MeResult {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  role: RoleKey;
  companyId: string | null;
  status: UserStatus;
  photoUrl: string | null;
  permissions: string[];
  company: { name: string; timezone: string } | null;
}

/** The subset of a looked-up `User` row (+ role/company) this endpoint needs. */
interface MeRow {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  companyId: string | null;
  status: string;
  photoId: string | null;
  role: { key: RoleKey; permissions: string[] };
  company: { name: string; timezone: string } | null;
}

/**
 * Backs `GET /me` (User Story 2, item 1 /
 * specs/001-company-user-auth/contracts/me.md). `JwtAuthGuard`/
 * `ActiveAccountGuard` (both global `APP_GUARD`s, WU-04) have already
 * verified the access token and confirmed the user/company are ACTIVE by
 * the time this service runs — this is a pure read of the already-
 * authenticated caller's own record, never another user's.
 */
@Injectable()
export class MeService {
  /**
   * User Story 4 (specs/001-company-user-auth/orchestration-plan.md),
   * decision #5: `FilesService` is injected via `me.module.ts`'s new
   * `imports: [FilesModule]` (that module is not `@Global()`) — the exact
   * same need `UsersService` already has for its own `signFileUrl()` call.
   */
  constructor(private readonly filesService: FilesService) {}

  /**
   * `payload` is `request.user` — the verified `AccessTokenPayload`
   * `JwtAuthGuard` attached. `payload.sub` is the caller's own `User.id`;
   * there is no `:id` param on this route, so there is no way to request
   * anyone else's record through this endpoint.
   */
  async getMe(payload: AccessTokenPayload): Promise<MeResult> {
    const user = await prisma.$transaction(async (tx) => {
      await this.setRlsContext(tx, payload.companyId);

      return tx.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          companyId: true,
          status: true,
          photoId: true,
          role: { select: { key: true, permissions: true } },
          company: { select: { name: true, timezone: true } },
        },
      });
    });

    // Defensive only: ActiveAccountGuard (which runs before this handler on
    // every non-@Public() request) already looked up this exact row and
    // would have rejected the request as ACCOUNT_INACTIVE if it didn't
    // exist or wasn't ACTIVE.
    if (!user) {
      throw new AppError('NOT_FOUND', 'User not found.');
    }

    return this.toMeResult(user, payload.sub);
  }

  /**
   * `PATCH /me/photo` (User Story 4, DoD item 7 / decision #5/#6).
   * Multipart upload, reuses `FilesService.uploadAvatar()` (widened to
   * accept `companyId: string | null` by decision #5, so this works for a
   * `SYSTEM_ADMIN` caller too) with the CALLER's own `companyId`/`sub` as
   * the owner metadata, then updates only that caller's own `photoId` —
   * no other field on `User` is reachable through this endpoint (FR-022).
   */
  async updatePhoto(
    payload: AccessTokenPayload,
    buffer: Buffer,
    declaredMimeType: string,
  ): Promise<{ photoUrl: string }> {
    const fileObject = await this.filesService.uploadAvatar(
      payload.companyId,
      payload.sub,
      buffer,
      declaredMimeType,
    );

    await prisma.$transaction(async (tx) => {
      await this.setRlsContext(tx, payload.companyId);
      await tx.user.update({
        where: { id: payload.sub },
        data: { photoId: fileObject.id },
      });
    });

    return {
      photoUrl: this.filesService.signFileUrl(
        fileObject.id,
        payload.sub,
        payload.companyId,
      ),
    };
  }

  private toMeResult(user: MeRow, viewerId: string): MeResult {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role.key,
      companyId: user.companyId,
      status: user.status as UserStatus,
      photoUrl: user.photoId
        ? this.filesService.signFileUrl(user.photoId, viewerId, user.companyId)
        : null,
      permissions: user.role.permissions,
      // `User.company` is a nullable relation that is only ever non-null
      // when `companyId` is set, so this already satisfies contracts/me.md's
      // "populated only when companyId is not null" rule with no extra branch.
      company: user.company,
    };
  }

  /**
   * `set_config(..., true)` is transaction-scoped (`SET LOCAL` semantics)
   * and must run on the same connection as the query that follows — same
   * pattern as `auth.service.ts`/`active-account.guard.ts`.
   */
  private async setRlsContext(
    tx: Prisma.TransactionClient,
    companyId: string | null,
  ): Promise<void> {
    if (companyId) {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    } else {
      await tx.$executeRaw`SELECT set_config('app.is_system_context', 'true', true)`;
    }
  }
}
