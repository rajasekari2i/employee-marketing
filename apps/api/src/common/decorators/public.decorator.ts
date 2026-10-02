import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key `@Public()` stamps on a handler/class, read via `Reflector`
 * by every guard/interceptor in the pipeline that needs to let an
 * unauthenticated request through untouched.
 *
 * This is WU-04 DoD item 11 — the single most important piece of this work
 * unit. Three consumers check this flag (via
 * `reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler, class])`, so a
 * `@Public()` on either the controller class or the specific method works):
 *
 *   1. `JwtAuthGuard`        — skips token verification entirely.
 *   2. `ActiveAccountGuard`  — skips the user/company ACTIVE lookup.
 *   3. `TransactionInterceptor` (apps/api/src/common/interceptors/
 *      transaction.interceptor.ts) — skips opening a tenant-scoped
 *      transaction, since a public route (e.g. `/auth/login`) has no tenant
 *      identity yet to scope one to.
 *
 * Without this, registering `TransactionInterceptor` as a global
 * `APP_INTERCEPTOR` (as this work unit does) would force every public route
 * through a transaction that sets `app.company_id` to `''` (tenant.extension
 * .ts's documented fail-closed fallback) before the handler even runs —
 * harmless for a route that never touches a tenant-isolated model, but still
 * unnecessary transactional overhead on the hottest, highest-traffic public
 * routes (`/auth/login`, `/auth/refresh`), and actively wrong once those
 * handlers need to run their *own* non-tenant-scoped queries (e.g. `Company`
 * lookup by `code`) inside a transaction that was opened for the wrong
 * reason. Skipping it entirely for `@Public()` routes is simplest and
 * matches Architecture §4's intent that only authenticated, tenant-resolved
 * requests reach `TransactionInterceptor`.
 */
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
