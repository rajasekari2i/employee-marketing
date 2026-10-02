import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { AppError } from '@field-sales/shared';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Single process-wide, unextended Prisma client for this guard's own
 * ACTIVE/`tokenVersion` lookup.
 *
 * This guard runs *before* `TransactionInterceptor` in the pipeline
 * (Architecture §4: JwtAuthGuard -> ActiveAccountGuard -> ... ->
 * TransactionInterceptor), so it cannot read a `tx` off CLS — none exists
 * yet for this request. It therefore needs its own lookup, raw (not
 * tenant-extended: at this point in the pipeline there is no
 * `TenantContextInterceptor`-populated `companyId` in CLS to scope a tenant
 * -isolated query to anyway, and this guard's query is a plain
 * `findUnique` by primary key, not something `TENANT_MODELS` filtering is
 * needed for).
 *
 * This mirrors the module-level `const prisma = new PrismaClient()` pattern
 * `apps/api/src/common/interceptors/transaction.interceptor.ts` (WU-03)
 * already uses — deliberately not a second, different pattern (e.g. a new
 * injectable `PrismaService`), per this work unit's design notes. It is a
 * separate client instance/connection pool from that file's, since there is
 * still no shared `PrismaModule` to inject a single instance from; a later
 * work unit should consolidate these (see transaction.interceptor.ts's own
 * TODO comment).
 */
const prisma = new PrismaClient();

/**
 * Single message used for every rejection reason (inactive user, inactive
 * company, or a stale/revoked token version) so a caller cannot distinguish
 * "your account was deactivated" from "your company was suspended" from
 * "your session was revoked" — FR-007's explicit requirement that this not
 * reveal which.
 */
const ACCOUNT_INACTIVE_MESSAGE =
  'Your account is inactive. Contact your administrator.';

/**
 * Rejects when the authenticated user's `status !== ACTIVE`, when their
 * company's `status !== ACTIVE` (for any non-`SYSTEM_ADMIN` user, i.e.
 * `companyId` set), or when the JWT's `ver` claim no longer matches the
 * user's live `tokenVersion` — Architecture §6: bumping `tokenVersion`
 * invalidates every outstanding access token. That comparison needs this
 * same per-request user-row lookup anyway (no extra DB round trip beyond
 * what the ACTIVE check already requires); Architecture's "without a
 * database lookup per request" framing is about not needing a *separate*
 * session-revocation-list lookup, not about avoiding this one. A
 * `tokenVersion` mismatch is reported with the same `ACCOUNT_INACTIVE` code
 * and message as a deactivated account, since forcing every outstanding
 * token to stop working *is* how this codebase models "this session is no
 * longer valid" (there is no dedicated `TOKEN_REVOKED` code in this slice's
 * vocabulary — see `packages/shared/src/errors.ts`).
 *
 * Short-circuits for `@Public()` routes (WU-04 DoD item 11).
 */
@Injectable()
export class ActiveAccountGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const payload = request.user;

    // Defensive: JwtAuthGuard (which always runs first, same global-guard
    // registration order in app.module.ts) should already have populated
    // `request.user` or rejected the request outright. A missing payload
    // here means this guard was reached without that happening.
    if (!payload) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Missing authenticated user context.',
      );
    }

    // Postgres RLS (WU-03's `rls_user_fileobject` migration) `FORCE`s row
    // level security on "users" for every role but the table owner,
    // including the app's own unprivileged `app_user` connection this
    // client uses — so a plain `findUnique` here would see *zero* rows
    // regardless of whether the user actually exists, failing closed into
    // a false "ACCOUNT_INACTIVE" for every single authenticated request.
    // (Found empirically while verifying this guard end-to-end for this
    // work unit's report — a plain `app_user` query against a real,
    // ACTIVE, freshly-seeded test user returned `null` until this fix.)
    //
    // The policy's two OR-branches need exactly one of two session
    // variables set, matching the claim already signature-verified by
    // `JwtAuthGuard` moments earlier (safe to trust per Constitution rule
    // 1 — this is a server-issued, signature-checked claim, not raw client
    // input): `app.company_id` for an ordinary tenant user, or
    // `app.is_system_context` for a `SYSTEM_ADMIN` (`companyId: null`).
    // `set_config(..., true)` is transaction-scoped (`SET LOCAL`
    // semantics) and must run on the *same connection* as the query that
    // follows it, which is only guaranteed inside one `$transaction` —
    // two separate top-level calls on a pooled client could land on
    // different connections.
    const user = await prisma.$transaction(async (tx) => {
      if (payload.companyId) {
        await tx.$executeRaw`SELECT set_config('app.company_id', ${payload.companyId}, true)`;
      } else {
        await tx.$executeRaw`SELECT set_config('app.is_system_context', 'true', true)`;
      }

      return tx.user.findUnique({
        where: { id: payload.sub },
        select: {
          status: true,
          tokenVersion: true,
          companyId: true,
          company: { select: { status: true } },
        },
      });
    });

    if (!user) {
      throw new AppError('ACCOUNT_INACTIVE', ACCOUNT_INACTIVE_MESSAGE);
    }

    if (user.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_INACTIVE', ACCOUNT_INACTIVE_MESSAGE);
    }

    if (user.tokenVersion !== payload.ver) {
      throw new AppError('ACCOUNT_INACTIVE', ACCOUNT_INACTIVE_MESSAGE);
    }

    // SYSTEM_ADMIN users have `companyId: null` (FR-004) and therefore no
    // company to check.
    if (user.companyId && user.company?.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_INACTIVE', ACCOUNT_INACTIVE_MESSAGE);
    }

    return true;
  }
}
