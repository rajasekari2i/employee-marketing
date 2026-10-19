import Geolocation from '@react-native-community/geolocation';
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Device positioning for the beat-day commands (005-executive-dashboard,
 * research.md §3). This is the first time the app reads the device's own
 * location — before this slice the only mapping was an admin tapping a point
 * on a map, which needs no permission and no native module.
 *
 * Permissions use React Native core's `PermissionsAndroid` rather than
 * `react-native-permissions`: this feature requests exactly one permission
 * group on one platform, so a second dependency would earn nothing.
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
 * Two attempts, in order. The first asks the GPS hardware for a fresh,
 * precise fix; the second accepts whatever the fused provider already knows
 * from Wi-Fi and cell towers.
 *
 * The second attempt exists because the first routinely fails indoors — a
 * cold GPS lock can take far longer than any reasonable timeout, and an
 * executive standing in a shop is exactly the case this feature has to work
 * in. `maximumAge` is non-zero on both so a fix the phone already has counts:
 * demanding `maximumAge: 0` means "ignore everything you know and re-acquire
 * from scratch", which is what made this fail on a real device.
 *
 * Accuracy is recorded, never judged (FR-014) — so a coarse fix is a
 * perfectly good answer here, and much better than refusing to start the beat.
 */
const ATTEMPTS = [
  { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
  { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
] as const;

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
  // `playServices` explicitly, not `auto`: the fused provider returns a
  // usable fix from Wi-Fi/cell almost immediately, where the legacy Android
  // LocationManager can sit waiting on a satellite lock indefinitely
  // indoors. `auto` is supposed to prefer it but silently falls back to the
  // legacy provider whenever detection is anything less than certain.
  Geolocation.setRNConfiguration({
    skipPermissionRequests: true,
    authorizationLevel: 'whenInUse',
    locationProvider: 'playServices',
  });
  configured = true;
}

/**
 * Asks for location permission, explaining why — the rationale Android shows
 * is the only place the executive is told what the app wants it for.
 */
async function ensurePermission(): Promise<
  'GRANTED' | 'PERMISSION_DENIED' | 'PERMISSION_BLOCKED'
> {
  if (Platform.OS !== 'android') {
    return 'GRANTED';
  }

  const already = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  if (already) {
    return 'GRANTED';
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location needed to start your beat',
      message:
        'Your location is saved when you start and end the beat, so your visits can be verified.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );

  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return 'GRANTED';
  }
  // "Never ask again" — retrying in-app cannot help, so the screen must send
  // the executive to Settings instead of offering a pointless retry.
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    return 'PERMISSION_BLOCKED';
  }
  return 'PERMISSION_DENIED';
}

/** One attempt at a fix. Resolves either a position or the platform's own error. */
function readOnce(
  options: (typeof ATTEMPTS)[number],
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
export async function getCurrentPosition(): Promise<LocationResult> {
  configureOnce();

  const permission = await ensurePermission();
  if (permission !== 'GRANTED') {
    return { ok: false, failure: permission };
  }

  let lastCode: number = POSITION_ERROR.POSITION_UNAVAILABLE;

  for (const options of ATTEMPTS) {
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

/** User-facing copy per failure, in the product's plain-language register (PRD §5). */
export function locationFailureMessage(failure: LocationFailure): string {
  switch (failure) {
    case 'PERMISSION_DENIED':
      return 'Location permission is needed to start the beat. Tap Start beat again to allow it.';
    case 'PERMISSION_BLOCKED':
      return 'Location permission is turned off for this app. Enable it in Settings, then try again.';
    case 'TIMED_OUT':
      // Distinct from the case below on purpose: location IS on and the app
      // IS allowed, the phone just has not got a fix yet. Telling someone to
      // check a setting that is already correct sends them hunting for a
      // problem that is not there.
      return 'Still looking for your location. Move near a window or outside, then tap Start beat again.';
    case 'POSITION_UNAVAILABLE':
      return 'Could not get your location. Check that location is switched on, then try again.';
  }
}
