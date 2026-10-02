import type { ErrorCode } from '@field-sales/shared';

import { API_URL } from '../config';
import { clearSession, getSession, updateTokens } from '../lib/secureSession';

/**
 * User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 0, pulled forward from WU-07/T041. A small typed `fetch` wrapper —
 * not TanStack Query (see the "why not TanStack Query yet" note below) —
 * that:
 *   1. Reads `API_URL` from `../config` (already working, WU-01).
 *   2. Attaches `Authorization: Bearer <accessToken>` from the session
 *      store (`../lib/secureSession.ts`) to every authenticated request.
 *   3. On a `401` from an authenticated request, calls `POST /auth/refresh`
 *      exactly once, retries the original request with the new access
 *      token, and — if the refresh itself fails (expired, or `409
 *      TOKEN_REUSED`) — clears the session store (research.md #6). Clearing
 *      the store is itself the "signal the app to navigate back to Sign
 *      In": `RootNavigator.tsx` subscribes to session changes via
 *      `subscribeSession()` and re-renders to the Sign In stack the moment
 *      the store goes empty — this module never imports navigation code.
 *
 * **Why not TanStack Query here**: Architecture D-09 names it as the
 * eventual choice, but this story only has three call sites total
 * (`POST /auth/login`, `GET /me`, `POST /auth/logout`) and none of them
 * need caching, background refetch, or query invalidation yet — adding the
 * dependency and its provider/boilerplate now would be pure overhead for
 * what this story actually does. `apiRequest()` below is written as a
 * small, self-contained function specifically so a later story can wrap it
 * in a TanStack Query `queryFn`/`mutationFn` without reshaping it.
 */

/** This codebase's RFC 9457 error envelope (apps/api/src/common/filters/problem-details.filter.ts) — the shape every non-2xx JSON response has. */
interface ProblemDetails {
  code?: ErrorCode | 'INTERNAL';
  detail?: string;
  [key: string]: unknown;
}

/**
 * Thrown for every failed `apiRequest()` call. `code` is either this
 * codebase's own `ErrorCode` vocabulary (from the response body) or
 * `NETWORK_ERROR` for a request that never got a response at all (no
 * signal / `fetch` itself rejected) — `SignInScreen.tsx` maps both onto
 * PRD §5's exact copy.
 */
export class ApiError extends Error {
  public readonly code: ErrorCode | 'INTERNAL' | 'NETWORK_ERROR';
  public readonly status: number;

  constructor(
    code: ErrorCode | 'INTERNAL' | 'NETWORK_ERROR',
    status: number,
    detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** `false` for a `@Public()` backend route (e.g. `/auth/login`, `/auth/refresh`) — no Authorization header, and a `401` is a real auth failure, never "access token expired". Defaults to `true`. */
  auth?: boolean;
}

/** A single raw HTTP call — no auth header logic, no retry. Throws `ApiError('NETWORK_ERROR', ...)` if `fetch` itself fails (PRD §5's "No internet connection" case). */
async function rawFetch(
  path: string,
  options: ApiRequestOptions,
  accessToken: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    return await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      0,
      'No internet connection. Check your signal and try again.',
    );
  }
}

/** Parses a `Response` into its JSON body (or `undefined` for a `204`/empty body), throwing `ApiError` for any non-2xx status. */
async function toResult<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body: ProblemDetails | undefined = text
    ? (JSON.parse(text) as ProblemDetails)
    : undefined;

  if (!response.ok) {
    const code = body?.code ?? 'INTERNAL';
    const detail = body?.detail ?? 'An unexpected error occurred.';
    throw new ApiError(code, response.status, detail);
  }

  return body as T;
}

/**
 * Deduplicates concurrent refresh attempts: if two authenticated requests
 * both hit a `401` at the same moment, only one `POST /auth/refresh` call
 * is made and both retries wait on it, rather than racing two rotations
 * against the same one-time-use refresh token (the second of which would
 * always come back `409 TOKEN_REUSED`).
 */
let refreshInFlight: Promise<string | null> | null = null;

/** Calls `POST /auth/refresh`, stores the rotated pair on success, clears the session store on any failure. Returns the new access token, or `null` if refresh failed. */
async function refreshAccessToken(): Promise<string | null> {
  const session = await getSession();
  if (!session) {
    return null;
  }

  try {
    const response = await rawFetch(
      '/auth/refresh',
      { method: 'POST', body: { refreshToken: session.refreshToken } },
      null,
    );
    const pair = await toResult<{ accessToken: string; refreshToken: string }>(
      response,
    );
    await updateTokens(pair.accessToken, pair.refreshToken);
    return pair.accessToken;
  } catch {
    // Covers TOKEN_EXPIRED, 409 TOKEN_REUSED, and a network failure during
    // the refresh call itself — research.md #6: any refresh failure clears
    // the store and forces Sign In.
    await clearSession();
    return null;
  }
}

/**
 * The one function every feature screen calls instead of bare `fetch`.
 * `path` is relative to `API_URL` (e.g. `"/me"`, `"/auth/login"`).
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const needsAuth = options.auth !== false;
  const session = needsAuth ? await getSession() : null;

  const response = await rawFetch(path, options, session?.accessToken ?? null);

  if (needsAuth && response.status === 401) {
    refreshInFlight ??= refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
    const newAccessToken = await refreshInFlight;

    if (newAccessToken) {
      const retryResponse = await rawFetch(path, options, newAccessToken);
      return toResult<T>(retryResponse);
    }

    // Refresh failed — session store is already cleared (and
    // RootNavigator has already been notified via subscribeSession()).
    // Still resolve the original 401 as a thrown ApiError so the caller's
    // own error handling (if any) runs instead of silently hanging.
    return toResult<T>(response);
  }

  return toResult<T>(response);
}
