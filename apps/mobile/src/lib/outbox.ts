import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { ApiError, apiRequest, generateIdempotencyKey } from '../api/client';

/**
 * The held-submission queue (006-visit-outcomes, research.md §1).
 *
 * This is what makes the app usable in a shop with no signal: an outcome is
 * accepted, held on the device, survives a restart, and is sent once a
 * request actually succeeds — never reported to the executive as a failure
 * and never silently discarded.
 *
 * **Storage** is one ordered JSON list under a single AsyncStorage key. What
 * the queue needs is append / read-all-in-order / delete-one / survive a
 * restart — a list, not a relational workload, and a day's work is tens of
 * items. Architecture §1 says "SQLite outbox"; that wording is about
 * durability and ordering, both of which this satisfies without a native
 * database and its migrations. The interface below is deliberately small so
 * the storage behind it can change without touching a caller.
 */

const QUEUE_KEY = 'fieldsales.outbox.v1';

/**
 * What a held item is.
 *
 * `STOP` is 007-extra-shops: `03-ARCHITECTURE.md:1016` names extra-shop
 * addition as one of exactly four queueable commands, alongside visit
 * submission, pin capture and beat start/end. Nothing else in this file
 * needed to change for it — the queue is addressed by `path` and `body`, so
 * a new kind is a new label on the same machinery. Reads are never queued,
 * which is why the board-1.4 picker is not here.
 */
export type HeldKind = 'VISIT' | 'PIN' | 'STOP';

export interface HeldSubmission {
  id: string;
  kind: HeldKind;
  /**
   * **Minted when the item is enqueued and reused for the life of the item.**
   *
   * This single decision is what makes the offline path safe (research.md
   * §3). If the key were generated at send time, a submission that reached
   * the server, whose response was then lost, would be retried under a
   * *different* key and recorded twice. Reusing it means the server replays
   * its stored response instead of creating a second visit.
   */
  idempotencyKey: string;
  path: string;
  body: Record<string, unknown>;
  recordedAt: string;
  attempts: number;
  lastError: string | null;
  /** Set when the server rejected it in a way retrying cannot fix. */
  permanentlyRejected: boolean;
}

type Listener = (items: HeldSubmission[]) => void;

const listeners = new Set<Listener>();

/**
 * Every mutation goes through this one promise chain.
 *
 * LOAD-BEARING, not tidiness: AsyncStorage replaces the whole value on
 * write, so a read-modify-write from two callers at once silently drops one
 * item — which for this queue means losing a visit the executive believes is
 * saved.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = writeChain.then(work, work);
  // Keep the chain alive even if this link rejects.
  writeChain = next.catch(() => undefined);
  return next;
}

async function readRaw(): Promise<HeldSubmission[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HeldSubmission[]) : [];
  } catch {
    // Corrupt or unreadable storage is treated as empty rather than
    // throwing and stranding the app — the same posture secureSession takes.
    return [];
  }
}

async function writeRaw(items: HeldSubmission[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  for (const listener of listeners) {
    listener(items);
  }
}

/** Subscribe to queue changes — used by the Today screen's waiting count. */
export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  void list().then((items) => listener(items));
  return () => listeners.delete(listener);
}

export function list(): Promise<HeldSubmission[]> {
  return serialise(readRaw);
}

export async function count(): Promise<number> {
  return (await list()).length;
}

/**
 * The items that must hold a logout (FR-041): saved on this device and
 * still sendable.
 *
 * **Deliberately excludes `permanentlyRejected` items.** Those were refused
 * by the server outright — the stop was already completed, the beat had
 * ended — so no amount of waiting or reconnecting will send them. Counting
 * them produced a dead end: the executive was told to reconnect before
 * logging out, reconnecting changed nothing, and there was no way out. They
 * are surfaced by the Today screen's strip, which carries its own Dismiss.
 */
export async function sendable(): Promise<HeldSubmission[]> {
  return (await list()).filter((item) => !item.permanentlyRejected);
}

/**
 * Drops every item the server refused outright. Called when a logout goes
 * ahead, so one person's refused submissions are not left on a shared phone
 * for whoever signs in next. Sendable items are never touched — a logout
 * cannot proceed while any exist.
 */
export function discardRejected(): Promise<void> {
  return serialise(async () => {
    const items = await readRaw();
    const keep = items.filter((item) => !item.permanentlyRejected);
    if (keep.length !== items.length) {
      await writeRaw(keep);
    }
  });
}

/** One wording for both logout buttons, so they cannot drift apart. */
export function logoutBlockedMessage(waiting: number): string {
  return `${waiting} submission${waiting === 1 ? '' : 's'} still waiting to sync. Reconnect so they can be sent before logging out.`;
}

/**
 * Holds a submission and returns it. The caller then attempts an immediate
 * send; whether that succeeds or not, the submission is already safe.
 */
export function enqueue(
  kind: HeldKind,
  path: string,
  body: Record<string, unknown>,
): Promise<HeldSubmission> {
  return serialise(async () => {
    const items = await readRaw();
    const item: HeldSubmission = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      idempotencyKey: generateIdempotencyKey(),
      path,
      body,
      recordedAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
      permanentlyRejected: false,
    };
    await writeRaw([...items, item]);
    return item;
  });
}

/** Drops a held item the server will never accept, so it cannot linger. */
export function discard(id: string): Promise<void> {
  return remove(id);
}

function remove(id: string): Promise<void> {
  return serialise(async () => {
    const items = await readRaw();
    await writeRaw(items.filter((item) => item.id !== id));
  });
}

function markFailed(
  id: string,
  message: string,
  permanent: boolean,
): Promise<void> {
  return serialise(async () => {
    const items = await readRaw();
    await writeRaw(
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              attempts: item.attempts + 1,
              lastError: message,
              permanentlyRejected: permanent,
            }
          : item,
      ),
    );
  });
}

/**
 * A rejection retrying cannot fix.
 *
 * A `4xx` means the server understood and refused: the beat has ended, the
 * stop is already completed, the brand was retired. Retrying forever would
 * burn battery and hide the problem from the executive, so these stop and
 * are surfaced (FR-040). Network failures and `5xx` are transient and stay
 * queued.
 *
 * `IDEMPOTENCY_KEY_REUSED` is deliberately NOT permanent-failure territory —
 * it means this exact item already landed, so it is a success for our
 * purposes and the item is dropped by the caller.
 */
export function isPermanentRejection(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  if (error.code === 'NETWORK_ERROR') {
    return false;
  }
  return error.status >= 400 && error.status < 500;
}

let syncing = false;

/**
 * Sends held items oldest-first, stopping at the first transient failure so
 * ordering is preserved — a pin capture enqueued before the visit that
 * depends on it must arrive first (FR-042).
 *
 * Safe to call from anywhere; concurrent calls collapse into one run.
 */
export async function sync(): Promise<void> {
  if (syncing) {
    return;
  }
  syncing = true;
  try {
    const items = (await list()).sort((a, b) =>
      a.recordedAt.localeCompare(b.recordedAt),
    );

    for (const item of items) {
      if (item.permanentlyRejected) {
        // Left in place so the executive can see it; skipped so it does not
        // block everything behind it.
        continue;
      }
      try {
        await apiRequest(item.path, {
          method: 'POST',
          body: item.body,
          idempotencyKey: item.idempotencyKey,
        });
        await remove(item.id);
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === 'IDEMPOTENCY_KEY_REUSED'
        ) {
          // Already recorded — this is the retry-after-lost-response case
          // working exactly as intended.
          await remove(item.id);
          continue;
        }
        const permanent = isPermanentRejection(error);
        await markFailed(
          item.id,
          error instanceof Error ? error.message : 'Unknown error',
          permanent,
        );
        if (!permanent) {
          // Transient: stop here so later items keep their order.
          break;
        }
      }
    }
  } finally {
    syncing = false;
  }
}

/**
 * Starts the sync triggers. Called once from the app root.
 *
 * There is deliberately **no connectivity library** (research.md §2): "is
 * there a connection?" is not the useful question, since a phone behind a
 * captive portal or on a dead access point reports itself connected. Sync is
 * driven by a request actually succeeding, which is the only real evidence,
 * plus the app returning to the foreground.
 */
export function startOutboxSync(): () => void {
  // Clear the permanent-rejection flags once per app start before syncing.
  //
  // "Permanent" is a judgement about the server's answer at one moment, not
  // a fact for all time: a 409 because a stop's frozen coordinate was
  // missing became accept-able the moment that was backfilled server-side.
  // Giving every held item one fresh chance per launch means a server fix
  // heals the queue, instead of stranding work the executive believed was
  // saved. Within a session the flag still does its job — it stops a
  // doomed item being retried on every trigger.
  void serialise(async () => {
    const items = await readRaw();
    if (items.some((item) => item.permanentlyRejected)) {
      await writeRaw(
        items.map((item) => ({ ...item, permanentlyRejected: false })),
      );
    }
  }).then(() => sync());
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void sync();
    }
  });
  return () => subscription.remove();
}
