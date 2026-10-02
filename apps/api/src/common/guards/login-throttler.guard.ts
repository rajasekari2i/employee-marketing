import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '@field-sales/shared';

const LOCKOUT_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 6;

interface AttemptWindow {
  count: number;
  expiresAt: number;
}

/**
 * The 6-failures-per-15-min **lockout** per *username* on `POST
 * /auth/login`, FR-010 — the other half of WU-04 DoD item 2 that
 * `throttler.config.ts`'s request-count throttlers can't express, since
 * this counts *failed login attempts*, not requests (a correct password on
 * attempt 1 must not count against a wrong password on attempts 2-6 of some
 * unrelated earlier burst, and a string of successes must never lock
 * anyone out).
 *
 * There is no `AuthModule`/login handler yet (WU-05 builds it next), so
 * this guard cannot be wired onto a real route or exercised end-to-end in
 * this work unit. It is built now, ready for WU-05 to:
 *
 *   1. Register this class as a provider in `AuthModule` and apply
 *      `@UseGuards(LoginThrottlerGuard)` to the `POST /auth/login` handler
 *      — `canActivate()` below blocks the request with `429 RATE_LIMITED`
 *      *before* the handler runs, once that username is already locked.
 *   2. Call `registerFailedAttempt(username)` from `AuthService` whenever a
 *      login attempt fails (wrong password only — FR-010 is about guessing
 *      attempts, not about a company/account already being inactive).
 *   3. Call `clearAttempts(username)` on a successful login, so a
 *      legitimate user who mistyped their password a few times isn't left
 *      part-way toward a lockout that then fires on an unrelated future
 *      mistake much later.
 *
 * Storage is an in-memory `Map`, intentionally — this API process is a
 * single instance (Architecture's deployment target for this slice is a
 * single Railway service, no horizontal scaling yet); a multi-instance
 * deployment would need this moved to a shared store (e.g. the same Redis
 * `@nestjs/throttler` would use via a custom `ThrottlerStorage`), out of
 * scope here.
 */
@Injectable()
export class LoginThrottlerGuard implements CanActivate {
  private readonly attempts = new Map<string, AttemptWindow>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      body?: { username?: unknown };
    }>();
    const username = request.body?.username;

    if (typeof username !== 'string' || username.length === 0) {
      // Malformed body — let ZodValidationPipe reject it with
      // VALIDATION_FAILED instead of this guard guessing at a key.
      return true;
    }

    const window = this.attempts.get(this.key(username));
    if (
      window &&
      window.expiresAt > Date.now() &&
      window.count >= MAX_FAILURES
    ) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many failed login attempts for this account. Try again later.',
      );
    }

    return true;
  }

  registerFailedAttempt(username: string): void {
    const key = this.key(username);
    const now = Date.now();
    const existing = this.attempts.get(key);

    if (existing && existing.expiresAt > now) {
      existing.count += 1;
    } else {
      this.attempts.set(key, { count: 1, expiresAt: now + LOCKOUT_WINDOW_MS });
    }
  }

  clearAttempts(username: string): void {
    this.attempts.delete(this.key(username));
  }

  private key(username: string): string {
    return username.toLowerCase();
  }
}
