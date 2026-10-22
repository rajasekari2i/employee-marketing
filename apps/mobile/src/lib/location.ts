import Geolocation from '@react-native-community/geolocation';

import { ensureLocationPermission } from './permissions';

/**
 * Device positioning for the beat-day commands (005-executive-dashboard,
 * research.md §3). This is the first time the app reads the device's own
 * location — before this slice the only mapping was an admin tapping a point
 * on a map, which needs no permission and no native module.
 *
 * The permission itself lives in `./permissions`, which both this module and
 * the app's launch-time ask share — the rationale copy below the fold there
 * is the only disclosure of what location is used for, so it must have one
 * home, not two.
 *
 * Failures are returned as a discriminated union rather than thrown, because
 * the three cases need visibly different copy (FR-015) and a raw platform
 * error string must never reach the executive.
 */

export type LocationFailure =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_BLOCKED'
  | 'TIMED_OUT'
  | 'POSITION_UNAVAILABLE';

export interface Position {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  /** The device's claim about when it read this. The server's clock remains authoritative. */
  capturedAt: string;
}

export type LocationResult =
  { ok: true; position: Position } | { ok: false; failure: LocationFailure };

/**
 * How long this caller is willing to wait for precision.
 *
 * **`precise`** — the measurement depends on it. A visit's `distanceMeters`
 * is computed from the position this returns, so a 500 m cell-tower fix
 * there would manufacture a range exception out of nothing. Worth up to 22
 * seconds.
 *
 * **`fast`** — the beat-day commands. `startAccuracyMeters` is *recorded and
 * never judged* (FR-014, and the server's own comment on the column: "for
 * the manager's later review; never a reason to reject"), so a coarse fix is
 * exactly as good an answer as a precise one — and waiting 12 seconds for
 * GPS to lock indoors buys literally nothing that is ever read.
 *
 * **`fresh`** — capturing a shop pin, the one place in the product where
 * accuracy *blocks* instead of flagging (`shop-pin.service.ts`: "a bad pin
 * becomes the fixed point every future visit at this shop is measured
 * against"). Here a cached fix is not a shortcut, it is the bug: the screen's
 * Retry GPS button could hand back the very same stale coarse reading that
 * just failed the gate, so retrying changed nothing and there was no way
 * forward. This mode refuses cached readings outright.
 */
export type Precision = 'precise' | 'fast' | 'fresh';

interface ReadOptions {
  enableHighAccuracy: boolean;
  timeout: number;
  maximumAge: number;
}

/**
 * Attempts in order, per precision. `maximumAge` is non-zero everywhere so a
 * fix the phone already has counts: demanding `maximumAge: 0` means "ignore
 * everything you know and re-acquire from scratch", which is what made this
 * fail on a real device.
 *
 * **`precise` tries the GPS hardware first**, then falls back to whatever the
 * fused provider knows from Wi-Fi and cell towers — because the first
 * routinely fails indoors, and a coarse fix still beats refusing to record
 * the visit.
 *
 * **`fast` inverts that order**, and the inversion is the whole point: the
 * cheap read is tried first and the expensive one only if it finds nothing.
 * Android almost always has a last-known location, so in practice this
 * returns in well under a second instead of the 12 s the GPS attempt spends
 * failing. Its worst case is 12 s rather than 22 s, and it only reaches that
 * on a phone that has no idea where it is at all.
 */
const ATTEMPTS: Record<Precision, readonly ReadOptions[]> = {
  precise: [
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
  ],
  fast: [
    { enableHighAccuracy: false, timeout: 4_000, maximumAge: 120_000 },
    { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
  ],
  // `maximumAge: 0` — the one mode that genuinely needs it, and the reason
  // the general warning against it does not apply: everywhere else a cached
  // fix is a usable answer, so refusing it only wasted time. Here the server
  // rejects anything coarser than the company's limit, so a cached coarse
  // reading cannot be saved no matter how quickly it arrives — and returning
  // it makes Retry GPS a button that does nothing.
  //
  // **One attempt, and no coarse fallback.** A Wi-Fi/cell fix is tens to
  // hundreds of metres; the gate is 20 m by default. Falling back to one
  // would only reach an unsaveable number faster. Timing out and saying so
  // is the honest answer, and the screen already tells the executive to step
  // outside and retry — which, now, actually re-reads.
  fresh: [{ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }],
};

/** Android's `PositionError` codes, which the platform sends back as numbers. */
const POSITION_ERROR = {
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
} as const;

let configured = false;

function configureOnce(): void {
  if (configured) {
    return;
  }
  // `android` (the legacy LocationManager), NOT `playServices`.
  //
  // This was briefly set to `playServices` for its faster Wi-Fi/cell fix, and
  // that **crashed the app natively** on a real device. The library's
  // PlayServicesLocationManager keeps ONE `mSingleLocationCallback` field,
  // nulls it after delivering a fix, and then calls
  // `removeLocationUpdates(mSingleLocationCallback)` with that now-null value
  // when a second read has already reset it:
  //
  //   java.lang.NullPointerException: Listener must not be null
  //     at ...location.zzbi.removeLocationUpdates
  //     at ...PlayServicesLocationManager$2.onLocationResult(:170)
  //
  // The retry in getCurrentPosition below makes exactly that overlap happen
  // whenever the first attempt times out and its fix lands late. The legacy
  // manager cannot hit it: its listener is a `final` field that is never
  // nulled, and it carries its own `mTriggered` guard.
  //
  // Nothing is lost by switching back. What actually fixed the original
  // "could not get your location" failure was allowing a cached fix
  // (`maximumAge`) and falling back to a coarse read — not the provider.
  Geolocation.setRNConfiguration({
    skipPermissionRequests: true,
    authorizationLevel: 'whenInUse',
    locationProvider: 'android',
  });
  configured = true;
}

/** One attempt at a fix. Resolves either a position or the platform's own error. */
function readOnce(
  options: ReadOptions,
): Promise<
  | { ok: true; position: Position }
  | { ok: false; code: number; message: string }
> {
  return new Promise((resolve) => {
    Geolocation.getCurrentPosition(
      (position) => {
        resolve({
          ok: true,
          position: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            // Android can report accuracy as a float; the contract is an integer.
            accuracyMeters: Math.max(
              0,
              Math.round(position.coords.accuracy ?? 0),
            ),
            capturedAt: new Date(position.timestamp).toISOString(),
          },
        });
      },
      (error) => {
        // Keep what the platform actually said. Discarding it here is what
        // made a real-device failure undiagnosable: every cause collapsed
        // into one message that blamed the user's location settings, even
        // when location was switched on and permission was granted.
        resolve({
          ok: false,
          code: error?.code ?? POSITION_ERROR.POSITION_UNAVAILABLE,
          message: error?.message ?? 'unknown',
        });
      },
      { ...options },
    );
  });
}

/**
 * A position for starting or ending a beat.
 *
 * Tries a precise fix first, then falls back to whatever the phone already
 * knows (see {@link ATTEMPTS}) — because FR-014 records accuracy rather than
 * judging it, a coarse fix is a valid answer and far better than refusing to
 * start the beat.
 *
 * Accuracy is never a reason to fail. The only failures returned are "no
 * permission" and "no fix of any kind".
 */
/**
 * Guards against two position reads being in flight at once.
 *
 * Defensive in depth alongside the provider choice above: the native crash
 * that motivated it needed two overlapping reads, and the UI can produce
 * them easily — a double tap on Submit, or Submit pressed while the pin
 * screen is still acquiring. Sharing the in-flight promise means a second
 * caller waits for the first result instead of starting a parallel read.
 *
 * Two precisions make that a queue rather than a single slot. Callers
 * wanting the SAME precision still share one read; a caller wanting the
 * other one waits its turn and then reads for itself, because sharing
 * across precisions would silently answer the wrong question — a `fast`
 * read's coarse fix is not an acceptable basis for a visit's distance.
 * Either way, never two reads at once.
 */
let inFlight: { precision: Precision; read: Promise<LocationResult> } | null =
  null;

export function getCurrentPosition(
  precision: Precision = 'precise',
): Promise<LocationResult> {
  // The same read is already running — join it. This is the double-tap case
  // the guard was written for.
  if (inFlight?.precision === precision) {
    return inFlight.read;
  }

  // A read of the OTHER precision is running. Joining it would hand back the
  // wrong answer — a `fast` read's coarse fix must never become the position
  // a visit's distance is measured against — but starting a second read now
  // is the overlap that crashed the app natively. So queue: wait for the
  // current one to settle, then take our turn.
  const previous = inFlight?.read ?? null;
  const read = (
    previous ? previous.catch(() => undefined) : Promise.resolve()
  ).then(() => readPositionWithFallback(precision));

  const entry = { precision, read };
  inFlight = entry;
  void read.finally(() => {
    // Only clear if nobody has queued behind us; otherwise the queue's tail
    // is theirs, not ours.
    if (inFlight === entry) {
      inFlight = null;
    }
  });
  return read;
}

async function readPositionWithFallback(
  precision: Precision,
): Promise<LocationResult> {
  configureOnce();

  const permission = await ensureLocationPermission();
  if (permission !== 'GRANTED') {
    return {
      ok: false,
      failure:
        permission === 'BLOCKED' ? 'PERMISSION_BLOCKED' : 'PERMISSION_DENIED',
    };
  }

  let lastCode: number = POSITION_ERROR.POSITION_UNAVAILABLE;

  for (const options of ATTEMPTS[precision]) {
    const attempt = await readOnce(options);
    if (attempt.ok) {
      return { ok: true, position: attempt.position };
    }
    lastCode = attempt.code;

    // The platform can still report a permission failure even after our own
    // check passed — for example when the user grants "approximate only" and
    // the request asked for precise. Retrying cannot fix that, so stop.
    if (attempt.code === POSITION_ERROR.PERMISSION_DENIED) {
      return { ok: false, failure: 'PERMISSION_DENIED' };
    }

    // Never log the coordinates themselves (Constitution rule 9) — only the
    // platform's error code, which is what makes this diagnosable.
    console.warn(
      `[location] attempt failed (highAccuracy=${String(options.enableHighAccuracy)}, code=${attempt.code}): ${attempt.message}`,
    );
  }

  return {
    ok: false,
    failure:
      lastCode === POSITION_ERROR.TIMEOUT
        ? 'TIMED_OUT'
        : 'POSITION_UNAVAILABLE',
  };
}

/**
 * User-facing copy per failure, in the product's plain-language register
 * (PRD §5).
 *
 * `retryLabel` names the button the reader is actually looking at. It was
 * hardwired to "Start beat", which was already wrong on the End beat
 * command, on the pin screen and on the create-shop screen, and only stayed
 * invisible because those paths rarely failed. The `fresh` mode above makes
 * the pin screen's timeout a normal, expected outcome, so the wrong button
 * name would now be read often.
 *
 * Omit it where the screen has no retry button — the copy then says "try
 * again" rather than sending the reader to look for a control that is not
 * on their screen.
 */
export function locationFailureMessage(
  failure: LocationFailure,
  retryLabel?: string,
): string {
  const retry = retryLabel ? `tap ${retryLabel} again` : 'try again';
  switch (failure) {
    case 'PERMISSION_DENIED':
      return `Location permission is needed. Allow it, then ${retry}.`;
    case 'PERMISSION_BLOCKED':
      return 'Location permission is turned off for this app. Enable it in Settings, then try again.';
    case 'TIMED_OUT':
      // Distinct from the case below on purpose: location IS on and the app
      // IS allowed, the phone just has not got a fix yet. Telling someone to
      // check a setting that is already correct sends them hunting for a
      // problem that is not there.
      return `Still looking for your location. Move near a window or outside, then ${retry}.`;
    case 'POSITION_UNAVAILABLE':
      return 'Could not get your location. Check that location is switched on, then try again.';
  }
}
