import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';

import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * WU-04 DoD item 2: `ThrottlerGuard` config.
 *
 * `@nestjs/throttler`'s `ThrottlerGuard` enforces *every* named throttler in
 * `ThrottlerModule.forRoot(THROTTLER_CONFIG)`'s array on every route unless
 * a given entry's own `skipIf` says otherwise — there is no "only apply
 * this throttler under this path prefix" option besides `skipIf`. So each
 * entry below is responsible for skipping itself outside the routes it's
 * meant for, rather than being opted into per-route:
 *
 *   - `auth`: 10 req/min **per IP**, applies only to `/auth/*` — skips
 *     itself for every other path.
 *   - `default`: 120 req/min **per authenticated user** (falls back to IP
 *     for an unauthenticated caller, e.g. a request that fails
 *     `JwtAuthGuard` before even reaching here is a moot point for this
 *     guard since it runs after `JwtAuthGuard` per Architecture §4's stage
 *     order — but `/auth/*` itself is `@Public()`, so `request.user` is
 *     genuinely absent there) — skips itself for `/auth/*`, since those
 *     routes get the dedicated tighter `auth` limit instead (not both,
 *     which would double-count the same traffic against two counters).
 *
 * The third piece of DoD item 2 — the 6-failures-per-15-min **lockout**
 * per *username* on `/auth/login` (FR-010) — is not expressible as a
 * request-count throttler at all (it counts failed login attempts, not
 * requests), so it is NOT in this array; see `login-throttler.guard.ts` in
 * this same directory for that mechanism.
 *
 * `ThrottlerGuard` itself is *not* registered as a global `APP_GUARD` by
 * this work unit (WU-04 DoD item 10's exact list of five global providers
 * does not include it) — `ThrottlerModule.forRoot(THROTTLER_CONFIG)` is
 * imported into `AppModule` so the config/storage exist and the guard is
 * DI-resolvable, ready for a later work unit to apply it (globally or
 * per-route) once there are live routes to actually rate-limit.
 */

const ONE_MINUTE_MS = 60_000;

function isAuthRoute(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  const path: string = request.path ?? request.url ?? '';
  // Matches both `/auth/...` and a prefixed `/api/v1/auth/...` (contracts/
  // auth.md's base path) — main.ts has not set a global prefix yet, so only
  // the former is live today, but this stays correct once one is added.
  return /\/auth(\/|$)/.test(path);
}

/**
 * `@nestjs/throttler`'s `getTracker` is typed `(req: Record<string, any>)
 * => string`, so `req` arrives untyped at this boundary. Narrowed to just
 * the two fields these trackers actually read (rather than the full
 * `AuthenticatedRequest`, whose dozens of unrelated `Request` members would
 * make a direct cast from `Record<string, unknown>` fail as "insufficient
 * overlap") and read out as an explicit `string`, rather than letting an
 * implicit `any` escape into the throttler config's `getTracker` return
 * value.
 */
interface TrackableRequest {
  ip?: string;
  user?: { sub?: string };
}

function trackByIp(req: Record<string, unknown>): string {
  return String((req as TrackableRequest).ip ?? '');
}

function trackByUserOrIp(req: Record<string, unknown>): string {
  const trackable = req as TrackableRequest;
  return trackable.user?.sub ?? String(trackable.ip ?? '');
}

export const THROTTLER_CONFIG: ThrottlerOptions[] = [
  {
    name: 'auth',
    ttl: ONE_MINUTE_MS,
    limit: 10,
    skipIf: (context) => !isAuthRoute(context),
    getTracker: trackByIp,
  },
  {
    name: 'default',
    ttl: ONE_MINUTE_MS,
    limit: 120,
    skipIf: (context) => isAuthRoute(context),
    getTracker: trackByUserOrIp,
  },
];
