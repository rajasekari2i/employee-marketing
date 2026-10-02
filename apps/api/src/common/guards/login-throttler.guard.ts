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
 *   1. Register this class as a provider in `AuthModule`.
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
 *
 * ---------------------------------------------------------------------
 * WU-05 addendum — do NOT apply this via `@UseGuards(LoginThrottlerGuard)`:
 * ---------------------------------------------------------------------
 * The original plan (point 1 above, as first written) was to also apply
 * `@UseGuards(LoginThrottlerGuard)` on `POST /auth/login`. Verified live
 * while wiring `AuthModule` that this does NOT share state with the
 * instance `AuthService` gets via ordinary constructor injection, even
 * though both reference the exact same class and it's registered as an
 * `AuthModule` provider: Nest's `Module.addInjectable()` (invoked for any
 * class referenced by a `@UseGuards()`/`@UsePipes()`/`@UseInterceptors()`/
 * `@UseFilters()` decorator) stores its `InstanceWrapper` in the module's
 * `_injectables` collection — a *different* map from `_providers`, keyed
 * by the same class token but populated and resolved independently. Two
 * live instances with two live (and divergent) `attempts` Maps result,
 * silently defeating the lockout (confirmed: 6+ failed attempts through
 * the `@UseGuards()` path never tripped it, because that copy's map never
 * saw `registerFailedAttempt`'s writes — those landed on the
 * constructor-injected copy instead).
 *
 * The fix (in `AuthService`, not here) is to call `assertNotLocked()`
 * below directly, through the one instance actually obtained via
 * constructor injection — never through `@UseGuards()` on this class.
 * `canActivate()` is kept (delegating to the same method) purely so this
 * class still satisfies `CanActivate` for any future caller that manages
 * to resolve a single correctly-shared instance (e.g. a custom provider
 * token), but WU-05 does not use it that way.
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

    this.assertNotLocked(username);
    return true;
  }

  /**
   * Throws `429 RATE_LIMITED` if `username` is currently locked out.
   * Public so `AuthService` can call it directly on its own
   * constructor-injected (correctly singleton) instance — see the WU-05
   * addendum above for why that, not `@UseGuards()`, is the real
   * enforcement point.
   */
  assertNotLocked(username: string): void {
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
