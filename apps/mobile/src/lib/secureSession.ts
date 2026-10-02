import * as Keychain from 'react-native-keychain';
import type { RoleKey } from '@field-sales/shared';

/**
 * User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 0, pulled forward from WU-07/T041. Backs the access/refresh token
 * pair (plus the `role` claim needed for role-based routing — research.md
 * #6) in the OS-level secure credential store via `react-native-keychain`
 * (Architecture §20, updated for the bare-RN rebuild — originally named
 * `expo-secure-store`, superseded by D-08's Expo removal).
 *
 * This is a plain module-level singleton (not a React context/hook) on
 * purpose: `apps/mobile/src/api/client.ts` needs to read/clear the session
 * from plain `fetch`-adjacent code with no React tree around it (its
 * refresh-retry interceptor), and `RootNavigator.tsx` needs to react to the
 * session changing (including a change `client.ts` makes on its own, e.g.
 * clearing the store after a `TOKEN_REUSED` refresh failure) without the two
 * modules depending on each other. `subscribe()` is the one piece of glue
 * that makes "the API client clears the session" and "the navigator shows
 * Sign In" the same event, instead of two things that have to be kept in
 * sync by hand at every call site.
 */

const KEYCHAIN_SERVICE = 'com.fieldsales.mobile.session';
/** `react-native-keychain` always needs a non-empty "username" half of the pair; this app only ever stores one session, so the value itself is arbitrary. */
const KEYCHAIN_USERNAME = 'session';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  role: RoleKey;
}

type SessionListener = (session: StoredSession | null) => void;

const listeners = new Set<SessionListener>();

/** `undefined` = not yet loaded from the keychain this process; `null` = loaded and confirmed empty. */
let cache: StoredSession | null | undefined;

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    typeof candidate.role === 'string'
  );
}

function parseStoredSession(raw: string): StoredSession | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredSession(parsed) ? parsed : null;
  } catch {
    // Corrupt/unexpected keychain content — treat as "no session" rather
    // than throwing and stranding the app on an unrecoverable boot error.
    return null;
  }
}

function notify(session: StoredSession | null): void {
  for (const listener of listeners) {
    listener(session);
  }
}

/**
 * Reads the stored session, if any. Cached in memory for the lifetime of
 * the process after the first (async, keychain-backed) load so repeated
 * calls — e.g. every `apiRequest()` — don't hit the native keychain on
 * every single request.
 */
export async function getSession(): Promise<StoredSession | null> {
  if (cache !== undefined) {
    return cache;
  }

  const credentials = await Keychain.getGenericPassword({
    service: KEYCHAIN_SERVICE,
  });
  cache = credentials ? parseStoredSession(credentials.password) : null;
  return cache;
}

/** Persists a brand-new session (login success) and notifies subscribers. */
export async function setSession(session: StoredSession): Promise<void> {
  await Keychain.setGenericPassword(
    KEYCHAIN_USERNAME,
    JSON.stringify(session),
    { service: KEYCHAIN_SERVICE },
  );
  cache = session;
  notify(cache);
}

/**
 * Replaces just the token pair after a `POST /auth/refresh` rotation,
 * keeping the already-stored `role` (a refresh never changes the signed-in
 * user's role). Used by `api/client.ts`'s refresh-retry interceptor.
 */
export async function updateTokens(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const current = await getSession();
  if (!current) {
    // Nothing to update onto — same effect as a failed refresh.
    return;
  }
  await setSession({ ...current, accessToken, refreshToken });
}

/** Clears the stored session (logout, or an unrecoverable refresh failure) and notifies subscribers. */
export async function clearSession(): Promise<void> {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  cache = null;
  notify(null);
}

/**
 * Subscribes to session changes (set or cleared), from anywhere — a login
 * screen, a logout button, or `client.ts`'s own refresh-retry interceptor
 * clearing the store on `TOKEN_REUSED`. Returns an unsubscribe function.
 * `RootNavigator.tsx` is this function's one real consumer today: it is how
 * "the session was cleared" becomes "show the Sign In screen" without
 * `client.ts` needing to import any navigation code at all.
 */
export function subscribeSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
