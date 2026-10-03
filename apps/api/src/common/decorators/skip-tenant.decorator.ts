import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key `@SkipTenant()` stamps on a handler/class, read via
 * `Reflector` by `TransactionInterceptor`
 * (apps/api/src/common/interceptors/transaction.interceptor.ts) — mirrors
 * `@Public()`'s exact shape (apps/api/src/common/decorators/public.decorator
 * .ts), down to the `SetMetadata(KEY, true)` pattern, so the same
 * `reflector.getAllAndOverride(KEY, [handler, class])` idiom works
 * identically for both.
 *
 * Unlike `@Public()` (which skips opening a transaction entirely, correct
 * for a route with no tenant identity *and no transactional work at all*,
 * e.g. `/auth/login`), `@SkipTenant()` is for a route that IS authenticated
 * and DOES need a transaction — just never a tenant-scoped one, because the
 * only role that can ever reach it is `SYSTEM_ADMIN` (`companyId: null`,
 * BRD/Architecture §5's documented case). `TransactionInterceptor` still
 * opens its usual `$transaction`, but sets the Postgres session variable
 * `app.is_system_context = 'true'` instead of reading `cls.get('companyId')`
 * and setting `app.company_id` — see that file's own doc comment, and
 * `specs/001-company-user-auth/orchestration-plan.md`'s "User Story 1"
 * section (the design-gap writeup this decorator exists to resolve), for
 * the full reasoning.
 *
 * `RolesGuard`'s `@Roles('SYSTEM_ADMIN')` (apps/api/src/common/decorators/
 * roles.decorator.ts) is what actually enforces that only a System Admin
 * reaches a `@SkipTenant()` handler at all — this decorator only changes
 * which RLS context the resulting transaction runs under, it grants no
 * access by itself.
 */
export const IS_SKIP_TENANT_KEY = 'isSkipTenant';

export const SkipTenant = () => SetMetadata(IS_SKIP_TENANT_KEY, true);
