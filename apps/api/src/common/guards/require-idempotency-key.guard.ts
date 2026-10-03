import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '@field-sales/shared';
import type { Request } from 'express';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * Rejects a request with `400 VALIDATION_FAILED` if it carries no
 * `Idempotency-Key` header at all.
 *
 * WU-04's `IdempotencyInterceptor` (apps/api/src/common/interceptors/
 * idempotency.interceptor.ts) deliberately treats the header as optional —
 * its own class doc states "a request without one simply passes through
 * unchanged (enforcing that mutating routes *must* send one is left to each
 * route's own validation, not this cross-cutting interceptor...)". This
 * guard is that per-route enforcement, for any command whose contract
 * states the header is required (e.g. `POST /companies`,
 * contracts/companies.md) — found necessary when adversarial review of
 * User Story 1 live-verified that `POST /companies` with no
 * `Idempotency-Key` header at all succeeded and created a real,
 * un-deduplicatable company + admin, violating Constitution rule 3 ("every
 * state-changing POST takes an Idempotency-Key").
 *
 * Apply via `@UseGuards(RequireIdempotencyKeyGuard)` on any command route
 * whose contract requires the header — not registered globally, since not
 * every mutating route necessarily requires one (none has been the
 * exception so far, but WU-04's own design treats this as a per-route
 * decision, not a blanket rule).
 */
@Injectable()
export class RequireIdempotencyKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.headers[IDEMPOTENCY_KEY_HEADER];

    if (typeof key !== 'string' || key.length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'An Idempotency-Key header is required for this request.',
      );
    }

    return true;
  }
}
