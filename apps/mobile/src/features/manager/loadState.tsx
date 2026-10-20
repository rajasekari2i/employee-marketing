import { Text } from 'react-native';

import { ApiError } from '../../api/client';
import { DANGER, LABEL } from './managerDesign';

/**
 * How every manager screen reports a read that failed (T336).
 *
 * All eight screens are **reads**. `03-ARCHITECTURE.md:1016` queues only
 * visit submission, extra-shop addition, pin capture and beat start/end —
 * reads fall back to the last loaded payload with a visible note instead.
 * So there are exactly two outcomes and they are not interchangeable:
 *
 * - something was already on screen → keep it and say it is not fresh;
 * - nothing was → say there is no connection.
 *
 * The second case is the one that matters on this role's screens. A manager
 * screen that fell back to its zero state would read as "nothing happened
 * yesterday", "this executive recorded no visits", or "nobody was marked" —
 * all of them false, and all of them things a manager would act on
 * (FR-051). An absent number and a zero must never look the same.
 *
 * Written once here rather than per screen so the wording cannot drift; it
 * follows the phrasing `MyVisitsScreen` already shows the executive.
 */

export interface LoadFailure {
  /** Shown above content that is still on screen but is no longer fresh. */
  staleNote: string | null;
  /** Shown INSTEAD of content, when there is nothing to fall back on. */
  error: string | null;
}

export function isOffline(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'NETWORK_ERROR';
}

/**
 * @param noun how the screen's content reads in a sentence — "this visit",
 *   "the day sheet", "the figures". Used as written, so it carries its own
 *   article.
 */
export function describeFailure(
  err: unknown,
  noun: string,
  hasData: boolean,
): LoadFailure {
  const offline = isOffline(err);

  if (hasData) {
    return {
      staleNote: offline
        ? `No connection. Showing ${noun} as last loaded.`
        : `Could not refresh. Showing ${noun} as last loaded.`,
      error: null,
    };
  }

  return {
    staleNote: null,
    error: offline
      ? `No connection, so ${noun} could not be loaded. Try again when you are back online.`
      : err instanceof Error
        ? err.message
        : 'Something went wrong.',
  };
}

/** The one-line note both outcomes render, in the tone each deserves. */
export function LoadNotice({
  error,
  staleNote,
}: {
  error?: string | null;
  staleNote?: string | null;
}) {
  const text = error ?? staleNote;
  if (!text) {
    return null;
  }
  return (
    <Text style={{ fontSize: 13, color: error ? DANGER : LABEL }}>{text}</Text>
  );
}
