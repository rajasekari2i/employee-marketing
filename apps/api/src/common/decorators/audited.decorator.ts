import { SetMetadata } from '@nestjs/common';

/**
 * Options `@Audited()` attaches as handler metadata, consumed by
 * `AuditInterceptor` (apps/api/src/common/interceptors/audit.interceptor.ts).
 *
 * `entityType` is optional because it can usually be derived from the
 * controller's class name (`UsersController` -> `User`); pass it explicitly
 * when a controller writes audit events for more than one entity type, or
 * when the class-name-stripping heuristic would be wrong.
 */
export interface AuditedOptions {
  /** Short verb/phrase describing the action, e.g. "user.create". */
  action: string;
  entityType?: string;
}

export const AUDITED_KEY = 'audited';

/**
 * Marks a handler as one whose successful response should produce exactly
 * one `AuditEvent` row, written by `AuditInterceptor` inside the same
 * transaction `TransactionInterceptor` opened for the request (WU-04 DoD
 * item 8) — this only holds because `AuditInterceptor` is registered as a
 * global `APP_INTERCEPTOR` *after* `TransactionInterceptor` in
 * app.module.ts's providers array, so it runs on the inside of that
 * transaction's CLS scope (see audit.interceptor.ts for the full reasoning).
 */
export const Audited = (action: string, entityType?: string) =>
  SetMetadata(AUDITED_KEY, { action, entityType } satisfies AuditedOptions);
