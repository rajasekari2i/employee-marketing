import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Every runtime permission the app asks for, in one place.
 *
 * Android has not granted dangerous permissions at install time since API 23,
 * so "ask on install" is not a thing the platform offers — the nearest
 * equivalent, and what {@link requestStartupPermissions} does, is to ask for
 * all of them once as the app launches instead of at each point of use.
 *
 * Point-of-use checks still exist and still matter: a launch-time ask can be
 * declined, and a permission can be revoked from Settings at any time after
 * it was granted. The startup ask is a convenience, never a guarantee.
 *
 * Uses React Native core's `PermissionsAndroid` rather than
 * `react-native-permissions` — the app asks for two permission groups on one
 * platform, so a second dependency would earn nothing.
 */

/**
 * BLOCKED is Android's "Don't allow" a second time / "Never ask again":
 * re-requesting in-app silently resolves to denied forever after, so callers
 * must send the user to Settings rather than offer a pointless retry.
 */
export type PermissionStatus = 'GRANTED' | 'DENIED' | 'BLOCKED';

async function request(
  permission: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS],
  rationale: { title: string; message: string },
): Promise<PermissionStatus> {
  if (Platform.OS !== 'android') {
    return 'GRANTED';
  }

  const already = await PermissionsAndroid.check(permission);
  if (already) {
    return 'GRANTED';
  }

  const result = await PermissionsAndroid.request(permission, {
    ...rationale,
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });

  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return 'GRANTED';
  }
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    return 'BLOCKED';
  }
  return 'DENIED';
}

/**
 * Asks for location permission, explaining why — the rationale Android shows
 * is the only place the executive is told what the app wants it for.
 */
export function ensureLocationPermission(): Promise<PermissionStatus> {
  return request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
    title: 'Location needed for your beat',
    // LOAD-BEARING, not cosmetic (006 FR-021, 007 FR-020). The
    // confirm-and-submit screen deliberately says nothing about location
    // (006 FR-018), so this prompt is the ONLY place the app discloses
    // what it does with it. It must therefore cover every use, and
    // 007-extra-shops adds a third: board 1.4 reads the position to order
    // the shop picker nearest-first and to show each shop's distance.
    // Adding a use without widening this string would leave the
    // disclosure incomplete.
    message:
      'Your location is saved when you start and end the beat, and when you record a visit at a shop. It is also used to find shops near you when you add an extra shop.',
  });
}

/**
 * Asks for camera permission.
 *
 * This is not optional politeness: `react-native-image-picker` refuses to
 * open the camera at all when CAMERA is declared in the manifest but not
 * granted (its `Utils.isCameraPermissionFulfilled`), returning an error
 * instead of launching the capture Intent. Without this call the Take photo
 * buttons do nothing at all.
 */
export function ensureCameraPermission(): Promise<PermissionStatus> {
  return request(PermissionsAndroid.PERMISSIONS.CAMERA, {
    title: 'Camera needed for shop photos',
    message:
      'The camera is used to take photos of a shop and to set your profile photo.',
  });
}

/** User-facing copy for a camera permission the app does not have (PRD §5 register). */
export function cameraPermissionMessage(status: PermissionStatus): string {
  return status === 'BLOCKED'
    ? 'Camera permission is turned off for this app. Enable it in Settings, then try again.'
    : 'Camera permission is needed to take a photo. Tap Take photo again to allow it.';
}

let startupAsked = false;

/**
 * The launch-time ask: both permissions, once per app start.
 *
 * Sequential rather than `PermissionsAndroid.requestMultiple`, which accepts
 * no rationale — and the location rationale above is the app's only
 * disclosure of what location is used for, so it cannot be dropped. Android
 * shows the two system dialogs one after the other.
 *
 * Never throws and never blocks startup: a declined or failed ask just leaves
 * the point-of-use checks to handle it later.
 */
export async function requestStartupPermissions(): Promise<void> {
  if (Platform.OS !== 'android' || startupAsked) {
    return;
  }
  startupAsked = true;

  try {
    await ensureLocationPermission();
    await ensureCameraPermission();
  } catch (error) {
    // Permission names are not secrets, but nothing here is worth failing
    // launch over (Constitution rule 9 keeps the payload out of it).
    console.warn('[permissions] startup request failed', error);
  }
}
