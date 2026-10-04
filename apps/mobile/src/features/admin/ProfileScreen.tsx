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
import { launchImageLibrary } from 'react-native-image-picker';
import type { RoleKey, UserStatus } from '@field-sales/shared';

import { ApiError, apiRequest, generateIdempotencyKey } from '../../api/client';
import type { AdminStackParamList } from '../../navigation/RootNavigator';

/**
 * User Story 4 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 8 / PRD §4 screen 4.14. Replaces `RootNavigator.tsx`'s
 * `ProfilePlaceholderScreen`.
 *
 * `name`/`email` are shown read-only with a lock icon (FR-021 — only a
 * Company Admin can change them, via `PATCH /users/:id`, never the user
 * themself through this screen). The photo picker reuses the identical
 * `react-native-image-picker` + multipart `FormData` + fresh
 * `generateIdempotencyKey()` pattern `UserFormScreen.tsx`'s own avatar
 * upload already established for User Story 3 — the only difference is
 * the target endpoint (`PATCH /me/photo`, decision #6's Idempotency-Key
 * requirement) and that there is no separate "save" step: a successful
 * upload takes effect immediately, same as contracts/me.md describes.
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
  company: { name: string; timezone: string } | null;
}

type ProfileNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'Profile'
>;

const ROLE_LABELS: Record<RoleKey, string> = {
  SYSTEM_ADMIN: 'System Admin',
  COMPANY_ADMIN: 'Company Admin',
  MANAGER: 'Manager',
  MARKETING_EXECUTIVE: 'Marketing Executive',
  EMPLOYEE: 'Employee',
};

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

export function ProfileScreen() {
  const navigation = useNavigation<ProfileNavigationProp>();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void apiRequest<MeResponse>('/me')
      .then((data) => {
        if (!cancelled) {
          setMe(data);
          setPhotoUrl(data.photoUrl);
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

  async function pickAndUploadPhoto(): Promise<void> {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
    });
    const asset = result.assets?.[0];
    if (!asset?.uri) {
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
      setPhotoUrl(uploaded.photoUrl);
    } catch (error) {
      setPhotoError(errorMessageFor(error));
    } finally {
      setUploadingPhoto(false);
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator testID="profile-loading" />
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{ padding: 16 }}
    >
      <View className="items-center">
        <Pressable
          disabled={uploadingPhoto}
          onPress={() => {
            void pickAndUploadPhoto();
          }}
          testID="profile-photo-picker"
        >
          <View className="h-24 w-24 items-center justify-center rounded-full bg-gray-100">
            {uploadingPhoto ? (
              <ActivityIndicator />
            ) : photoUrl ? (
              <Image
                className="h-24 w-24 rounded-full"
                source={{ uri: photoUrl }}
              />
            ) : (
              <Text className="text-xs text-gray-500">Add photo</Text>
            )}
          </View>
        </Pressable>
        <Text className="mt-2 text-xs text-gray-500">Tap to change photo</Text>
        {photoError ? (
          <Text
            className="mt-2 text-xs text-red-600"
            testID="profile-photo-error"
          >
            {photoError}
          </Text>
        ) : null}
      </View>

      <View className="mt-6">
        <View className="flex-row items-center">
          <Text className="text-sm text-gray-600">Full name</Text>
          <Text
            className="ml-1 text-xs text-gray-400"
            accessibilityLabel="Read-only"
          >
            🔒
          </Text>
        </View>
        <Text className="mt-1 text-base text-gray-900" testID="profile-name">
          {me?.name ?? ''}
        </Text>

        <View className="mt-4 flex-row items-center">
          <Text className="text-sm text-gray-600">Email</Text>
          <Text
            className="ml-1 text-xs text-gray-400"
            accessibilityLabel="Read-only"
          >
            🔒
          </Text>
        </View>
        <Text className="mt-1 text-base text-gray-900" testID="profile-email">
          {me?.email ?? '—'}
        </Text>

        <Text className="mt-4 text-sm text-gray-600">Role</Text>
        <Text className="mt-1 text-base text-gray-900" testID="profile-role">
          {me ? ROLE_LABELS[me.role] : ''}
        </Text>

        <Text className="mt-4 text-sm text-gray-600">Status</Text>
        <Text className="mt-1 text-base text-gray-900" testID="profile-status">
          {me?.status ?? ''}
        </Text>
      </View>

      <Pressable
        className="mb-8 mt-8 items-center rounded-md border border-gray-300 py-3"
        onPress={() => navigation.navigate('ChangePassword')}
        testID="profile-change-password"
      >
        <Text className="font-semibold text-brand-700">Change password</Text>
      </Pressable>
    </ScrollView>
  );
}
