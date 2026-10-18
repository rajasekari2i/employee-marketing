import { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RoleKey, UserStatus } from '@field-sales/shared';

import {
  ApiError,
  apiRequest,
  generateIdempotencyKey,
  resolveFileUrl,
} from '../../api/client';
import { AdminBottomNav } from '../../components/AdminBottomNav';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { clearSession, getSession } from '../../lib/secureSession';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import {
  BG,
  BLUE,
  BORDER,
  DANGER,
  INK,
  MUTED,
  ROLE_LABELS,
  initialsFor,
} from './adminDesign';

/**
 * PRD §4 screen 4.14 ("Profile · company admin"). Layout/colors/icons below
 * are taken verbatim from `docs/ui-design/Field_Sales_Beat_App.html` §4.14.
 *
 * `name`/`email` are shown read-only with a lock icon (FR-021 — only a
 * Company Admin can change them, via `PATCH /users/:id`, never the user
 * themself through this screen). The photo picker reuses the identical
 * `react-native-image-picker` + multipart `FormData` + fresh
 * `generateIdempotencyKey()` pattern `UserFormScreen.tsx`'s own avatar
 * upload already established for User Story 3 — the only difference is
 * the target endpoint (`PATCH /me/photo`, decision #6's Idempotency-Key
 * requirement) and that there is no separate "save" step: a successful
 * upload takes effect immediately, same as contracts/me.md describes. The
 * design offers two explicit entry points ("Take photo"/"Gallery") plus a
 * small edit badge on the avatar itself (wired to the same gallery picker
 * as the quick default) — `CAMERA`/`READ_MEDIA_IMAGES` permissions were
 * already declared in AndroidManifest.xml for exactly this, unused until
 * now.
 */

/** contracts/me.md's exact `GET /me` response shape. */
interface MeResponse {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  role: RoleKey;
  companyId: string | null;
  status: UserStatus;
  photoUrl: string | null;
  permissions: string[];
  company: { code: string; name: string; timezone: string } | null;
}

type ProfileNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'Profile'
>;

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];
const ICON_CAMERA: IconShape[] = [
  { d: 'M4 8h3l2-3h6l2 3h3v11H4z' },
  { circle: [12, 13, 3.5] },
];
const ICON_GALLERY: IconShape[] = [
  { rect: [3, 5, 18, 14, 2] },
  { d: 'M3 16l5-5 4 4 3-3 6 6' },
  { circle: [9, 9, 1.5] },
];
const ICON_LOCK: IconShape[] = [
  { rect: [5, 11, 14, 10, 2] },
  { d: 'M8 11V8a4 4 0 0 1 8 0v3' },
];
const ICON_KEY: IconShape[] = [
  { circle: [8, 15, 4] },
  { d: 'M11 12l9-9M17 6l3 3M15 8l2 2' },
];
const ICON_CHEVRON_RIGHT: IconShape[] = [{ d: 'M9 6l6 6-6 6' }];
const ICON_LOGOUT: IconShape[] = [{ d: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10' }];

/** Maps a failed photo upload to a short, readable message — same posture as `UserFormScreen.tsx`'s `errorMessageFor`. */
function errorMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'VALIDATION_FAILED':
        return error.message || 'Please choose a different photo.';
      case 'NETWORK_ERROR':
        return 'No internet connection. Check your signal and try again.';
      default:
        return 'Something went wrong at our end. Try again in a moment.';
    }
  }
  return 'Something went wrong at our end. Try again in a moment.';
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text
        style={{
          fontSize: 13,
          fontWeight: '600',
          color: '#3A4353',
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      <View style={{ position: 'relative' }}>
        <Text
          style={{
            height: 50,
            borderWidth: 1.5,
            borderColor: BORDER,
            borderRadius: 12,
            paddingLeft: 14,
            paddingRight: 44,
            lineHeight: 50,
            fontSize: 16,
            fontWeight: '600',
            color: '#3A4353',
            backgroundColor: '#E9EDF3',
          }}
        >
          {value}
        </Text>
        <View style={{ position: 'absolute', right: 14, top: 15 }}>
          <OutlineIcon color={MUTED} shapes={ICON_LOCK} size={18} />
        </View>
      </View>
    </View>
  );
}

export function ProfileScreen() {
  const navigation = useNavigation<ProfileNavigationProp>();
  const insets = useSafeAreaInsets();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void apiRequest<MeResponse>('/me')
      .then((data) => {
        if (!cancelled) {
          setMe(data);
          setPhotoUrl(data.photoUrl ? resolveFileUrl(data.photoUrl) : null);
        }
      })
      .catch(() => {
        // Same posture as HomeScreen.tsx: a failed /me call here is almost
        // always the API client's own refresh-retry interceptor having
        // already cleared the session store, and RootNavigator is about to
        // swap back to Sign In on its own.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function uploadAsset(asset: {
    uri?: string;
    fileName?: string;
    type?: string;
  }): Promise<void> {
    if (!asset.uri) {
      return;
    }

    const formData = new FormData();
    // SAFETY: same RN FormData file-descriptor shape UserFormScreen.tsx's
    // avatar upload already uses — see that file's identical comment.
    formData.append('photo', {
      uri: asset.uri,
      name: asset.fileName ?? 'photo.jpg',
      type: asset.type ?? 'image/jpeg',
    });

    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      const uploaded = await apiRequest<{ photoUrl: string }>('/me/photo', {
        method: 'PATCH',
        body: formData,
        idempotencyKey: generateIdempotencyKey(),
      });
      setPhotoUrl(resolveFileUrl(uploaded.photoUrl));
    } catch (error) {
      setPhotoError(errorMessageFor(error));
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function pickFromCamera(): Promise<void> {
    const result = await launchCamera({ mediaType: 'photo', quality: 0.8 });
    const asset = result.assets?.[0];
    if (asset) {
      await uploadAsset(asset);
    }
  }

  async function pickFromGallery(): Promise<void> {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
    });
    const asset = result.assets?.[0];
    if (asset) {
      await uploadAsset(asset);
    }
  }

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      const session = await getSession();
      if (session) {
        await apiRequest('/auth/logout', {
          method: 'POST',
          body: { refreshToken: session.refreshToken },
        });
      }
    } catch {
      // Clear the session regardless — never strand the user looking
      // logged-in because of a network error.
    } finally {
      await clearSession();
      setLoggingOut(false);
      // No explicit navigation call: clearing the session store notifies
      // RootNavigator (subscribeSession()), which swaps back to Sign In.
    }
  }

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: BG,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator testID="profile-loading" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable
          accessibilityLabel="Back to home"
          onPress={() => navigation.goBack()}
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: BORDER,
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <OutlineIcon
            color={INK}
            shapes={ICON_BACK}
            size={20}
            strokeWidth={2}
          />
        </Pressable>
        <Text style={{ fontSize: 28, fontWeight: '700', color: INK }}>
          Profile
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          gap: 20,
          paddingBottom: 84 + insets.bottom + 20,
        }}
        style={{ flex: 1 }}
      >
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderWidth: 1,
            borderColor: BORDER,
            borderRadius: 18,
            padding: 18,
            alignItems: 'center',
            gap: 9,
          }}
        >
          <View style={{ position: 'relative' }}>
            {uploadingPhoto ? (
              <View
                style={{
                  width: 86,
                  height: 86,
                  borderRadius: 43,
                  backgroundColor: '#E9EDF3',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ActivityIndicator />
              </View>
            ) : photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={{ width: 86, height: 86, borderRadius: 43 }}
              />
            ) : (
              <View
                style={{
                  width: 86,
                  height: 86,
                  borderRadius: 43,
                  backgroundColor: BLUE,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{ fontSize: 30, fontWeight: '700', color: '#FFFFFF' }}
                >
                  {initialsFor(me?.name)}
                </Text>
              </View>
            )}
            <Pressable
              accessibilityLabel="Change profile photo"
              disabled={uploadingPhoto}
              onPress={() => {
                void pickFromGallery();
              }}
              style={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                width: 34,
                height: 34,
                borderRadius: 17,
                borderWidth: 3,
                borderColor: '#FFFFFF',
                backgroundColor: INK,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              testID="profile-photo-edit-badge"
            >
              <OutlineIcon
                color="#FFFFFF"
                shapes={ICON_CAMERA}
                size={16}
                strokeWidth={1.9}
              />
            </Pressable>
          </View>

          <Text style={{ fontSize: 22, fontWeight: '700', color: INK }}>
            {me?.name ?? ''}
          </Text>
          <View
            style={{
              height: 26,
              paddingHorizontal: 10,
              borderRadius: 999,
              backgroundColor: '#E3EBFC',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#1E3A8A' }}>
              {me ? ROLE_LABELS[me.role] : ''}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
            <Pressable
              disabled={uploadingPhoto}
              onPress={() => {
                void pickFromCamera();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                height: 38,
                paddingHorizontal: 14,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: '#CBD2DD',
                backgroundColor: '#FFFFFF',
              }}
              testID="profile-take-photo"
            >
              <OutlineIcon
                color={INK}
                shapes={ICON_CAMERA}
                size={16}
                strokeWidth={1.9}
              />
              <Text style={{ fontSize: 14, fontWeight: '600', color: INK }}>
                Take photo
              </Text>
            </Pressable>
            <Pressable
              disabled={uploadingPhoto}
              onPress={() => {
                void pickFromGallery();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                height: 38,
                paddingHorizontal: 14,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: '#CBD2DD',
                backgroundColor: '#FFFFFF',
              }}
              testID="profile-gallery"
            >
              <OutlineIcon color={INK} shapes={ICON_GALLERY} size={18} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: INK }}>
                Gallery
              </Text>
            </Pressable>
          </View>

          <Text style={{ fontSize: 12, color: MUTED }}>
            Photo is the only detail you can change here
          </Text>
          {photoError ? (
            <Text
              style={{ fontSize: 12, color: DANGER }}
              testID="profile-photo-error"
            >
              {photoError}
            </Text>
          ) : null}
        </View>

        <View style={{ gap: 14 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: MUTED,
            }}
          >
            Account details
          </Text>
          <ReadOnlyField label="Full name" value={me?.name ?? ''} />
          <ReadOnlyField label="Email" value={me?.email ?? '—'} />
          <Text style={{ fontSize: 12, color: MUTED, lineHeight: 17 }}>
            Only your company administrator can change these details.
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          <Pressable
            onPress={() => navigation.navigate('ChangePassword')}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              height: 56,
              paddingHorizontal: 16,
              borderRadius: 14,
              backgroundColor: '#FFFFFF',
              borderWidth: 1.5,
              borderColor: BORDER,
            }}
            testID="profile-change-password"
          >
            <OutlineIcon
              color={BLUE}
              shapes={ICON_KEY}
              size={20}
              strokeWidth={1.8}
            />
            <Text
              style={{
                flexGrow: 1,
                fontSize: 16,
                fontWeight: '700',
                color: INK,
              }}
            >
              Change password
            </Text>
            <OutlineIcon
              color={MUTED}
              shapes={ICON_CHEVRON_RIGHT}
              size={18}
              strokeWidth={2}
            />
          </Pressable>

          <Pressable
            disabled={loggingOut}
            onPress={() => {
              void handleLogout();
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              height: 56,
              paddingHorizontal: 16,
              borderRadius: 14,
              backgroundColor: '#FFFFFF',
              borderWidth: 1.5,
              borderColor: DANGER,
            }}
            testID="profile-logout"
          >
            <OutlineIcon
              color={DANGER}
              shapes={ICON_LOGOUT}
              size={20}
              strokeWidth={1.8}
            />
            <Text style={{ fontSize: 16, fontWeight: '700', color: DANGER }}>
              {loggingOut ? 'Logging out…' : 'Log out'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <AdminBottomNav
        active={null}
        bottomInset={insets.bottom}
        onHomePress={() => navigation.goBack()}
        onBeatsPress={() => navigation.navigate('BeatPlansList')}
        onShopsPress={() => navigation.navigate('ShopsList')}
      />
    </View>
  );
}
