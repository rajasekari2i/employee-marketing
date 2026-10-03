import { useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  TENANT_ASSIGNABLE_ROLE_KEYS,
  createUserSchema,
  updateUserSchema,
  type TenantAssignableRoleKey,
  type UserStatus,
} from '@field-sales/shared';

import { ApiError, apiRequest, generateIdempotencyKey } from '../../api/client';
import type { AdminStackParamList } from '../../navigation/RootNavigator';

/**
 * User Story 3 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * items 10 + 7 (the photo pipeline) / PRD §4 screen 4.11 (new/edit states).
 *
 * Reuses `createUserSchema`/`updateUserSchema` (`@field-sales/shared`) for
 * the actual submit-time validation (Constitution rule 5 — "one
 * contract"), but NOT via `react-hook-form`'s `zodResolver` the way
 * `SignInScreen.tsx` does for `loginSchema`: those two schemas' optional
 * fields are "absent/undefined", not "empty string", and a plain RN
 * `TextInput` always reports an unset field as `''`. `stripBlanks` below
 * normalizes the raw form values to that shape immediately before handing
 * them to the real shared schema — the schema itself is never loosened or
 * reimplemented, only the empty-string-vs-undefined bridge a bare
 * `TextInput` needs is added in front of it.
 */

type UserFormNavigationProp = NativeStackNavigationProp<
  AdminStackParamList,
  'UserForm'
>;
type UserFormRouteProp = RouteProp<AdminStackParamList, 'UserForm'>;

const ROLE_LABELS: Record<TenantAssignableRoleKey, string> = {
  COMPANY_ADMIN: 'Company Admin',
  MANAGER: 'Manager',
  MARKETING_EXECUTIVE: 'Marketing Executive',
  EMPLOYEE: 'Employee',
};

interface UserFormValues {
  name: string;
  email: string;
  role: TenantAssignableRoleKey;
  status: UserStatus;
  username: string;
  temporaryPassword: string;
  mobile: string;
  monthlySalary: string;
  halfDayRate: string;
  rateEffectiveFrom: string;
}

/**
 * Converts every blank/whitespace-only string field to "absent" (the shape
 * `createUserSchema`/`updateUserSchema`'s `.optional()` fields expect) — a
 * bare `TextInput` can only ever report `''`, never `undefined`.
 *
 * Iterates via `Object.keys()` + indexed access (not `Object.entries()`):
 * `UserFormValues` is a plain interface with no index signature, so
 * `Object.entries()`'s generic overload can't narrow its value type past
 * `any` for it — `Object.keys()` cast to `(keyof UserFormValues)[]` keeps
 * every access properly typed as `string`.
 */
function stripBlanks(values: UserFormValues): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(values) as Array<keyof UserFormValues>) {
    const trimmed = values[key].trim();
    if (trimmed.length > 0) {
      result[key] = trimmed;
    }
  }
  return result;
}

/** Maps a failed submit to a short, readable message — same posture as `SignInScreen.tsx`'s `errorMessageFor`. */
function errorMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'USERNAME_TAKEN':
        return 'That username is already in use in this company.';
      case 'VALIDATION_FAILED':
        return error.message || 'Please check the fields and try again.';
      case 'NETWORK_ERROR':
        return 'No internet connection. Check your signal and try again.';
      case 'NOT_FOUND':
        return 'This user could not be found.';
      default:
        return 'Something went wrong at our end. Try again in a moment.';
    }
  }
  return 'Something went wrong at our end. Try again in a moment.';
}

export function UserFormScreen() {
  const navigation = useNavigation<UserFormNavigationProp>();
  const route = useRoute<UserFormRouteProp>();
  const editingUser = route.params?.user;
  const isEditing = Boolean(editingUser);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [photoFileId, setPhotoFileId] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(
    editingUser?.photoUrl ?? null,
  );
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    defaultValues: {
      name: editingUser?.name ?? '',
      email: editingUser?.email ?? '',
      role:
        (editingUser?.role as TenantAssignableRoleKey) ?? 'MARKETING_EXECUTIVE',
      status: editingUser?.status ?? 'ACTIVE',
      username: editingUser?.username ?? '',
      temporaryPassword: '',
      mobile: '',
      monthlySalary: '',
      halfDayRate: '',
      rateEffectiveFrom: '',
    },
  });

  const role = watch('role');
  const showLoginFields = !isEditing && role !== 'EMPLOYEE';

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
    // SAFETY: React Native's FormData accepts this { uri, name, type }
    // file-descriptor shape for a multipart field (RN's own documented
    // FormData extension, not the DOM's Blob-only signature TypeScript's
    // lib.dom.d.ts declares) — there is no RN-specific FormData type
    // package in this project to type this more precisely against.
    formData.append('photo', {
      uri: asset.uri,
      name: asset.fileName ?? 'photo.jpg',
      type: asset.type ?? 'image/jpeg',
    });

    setUploadingPhoto(true);
    setSubmitError(null);
    try {
      const uploaded = await apiRequest<{ id: string; url: string }>(
        '/files/avatars',
        {
          method: 'POST',
          body: formData,
          idempotencyKey: generateIdempotencyKey(),
        },
      );
      setPhotoFileId(uploaded.id);
      setPhotoPreviewUrl(uploaded.url);
    } catch (error) {
      setSubmitError(errorMessageFor(error));
    } finally {
      setUploadingPhoto(false);
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const cleaned = stripBlanks(values);
    if (photoFileId) {
      cleaned.photoFileId = photoFileId;
    }

    try {
      if (isEditing && editingUser) {
        const parsed = updateUserSchema.safeParse(cleaned);
        if (!parsed.success) {
          setSubmitError(parsed.error.issues[0]?.message ?? 'Invalid input.');
          return;
        }
        await apiRequest(`/users/${editingUser.id}`, {
          method: 'PATCH',
          body: parsed.data,
          idempotencyKey: generateIdempotencyKey(),
        });
      } else {
        const parsed = createUserSchema.safeParse(cleaned);
        if (!parsed.success) {
          setSubmitError(parsed.error.issues[0]?.message ?? 'Invalid input.');
          return;
        }
        await apiRequest('/users', {
          method: 'POST',
          body: parsed.data,
          idempotencyKey: generateIdempotencyKey(),
        });
      }
      navigation.goBack();
    } catch (error) {
      setSubmitError(errorMessageFor(error));
    }
  });

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
          testID="user-form-photo-picker"
        >
          <View className="h-20 w-20 items-center justify-center rounded-full bg-gray-100">
            {uploadingPhoto ? (
              <ActivityIndicator />
            ) : photoPreviewUrl ? (
              <Image
                className="h-20 w-20 rounded-full"
                source={{ uri: photoPreviewUrl }}
              />
            ) : (
              <Text className="text-xs text-gray-500">Add photo</Text>
            )}
          </View>
        </Pressable>
      </View>

      <Text className="mb-1 mt-5 text-sm text-gray-600">Full name</Text>
      <Controller
        control={control}
        name="name"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextInput
            className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
            onBlur={onBlur}
            onChangeText={onChange}
            testID="user-form-name"
            value={value}
          />
        )}
        rules={{ required: 'Name is required.' }}
      />
      {errors.name ? (
        <Text className="mt-1 text-xs text-red-600">{errors.name.message}</Text>
      ) : null}

      <Text className="mb-1 mt-4 text-sm text-gray-600">Email</Text>
      <Controller
        control={control}
        name="email"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextInput
            autoCapitalize="none"
            className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
            keyboardType="email-address"
            onBlur={onBlur}
            onChangeText={onChange}
            testID="user-form-email"
            value={value}
          />
        )}
      />

      <Text className="mb-1 mt-4 text-sm text-gray-600">Role</Text>
      {isEditing ? (
        // Gap #5 (orchestration-plan.md): role is not patchable server-side
        // in this slice, so the picker is read-only once editing — the form
        // must never imply a change here is possible.
        <View
          className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
          testID="user-form-role-readonly"
        >
          <Text className="text-base text-gray-500">{ROLE_LABELS[role]}</Text>
        </View>
      ) : (
        <Controller
          control={control}
          name="role"
          render={({ field: { onChange, value } }) => (
            <View className="flex-row flex-wrap">
              {TENANT_ASSIGNABLE_ROLE_KEYS.map((key) => (
                <Pressable
                  className={
                    value === key
                      ? 'mb-2 mr-2 rounded-full bg-brand-600 px-3 py-1'
                      : 'mb-2 mr-2 rounded-full border border-gray-300 px-3 py-1'
                  }
                  key={key}
                  onPress={() => onChange(key)}
                  testID={`user-form-role-${key}`}
                >
                  <Text
                    className={
                      value === key
                        ? 'text-xs font-medium text-white'
                        : 'text-xs text-gray-700'
                    }
                  >
                    {ROLE_LABELS[key]}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        />
      )}

      <Text className="mb-1 mt-4 text-sm text-gray-600">Status</Text>
      <Controller
        control={control}
        name="status"
        render={({ field: { onChange, value } }) => (
          <View className="flex-row">
            {(['ACTIVE', 'INACTIVE'] as UserStatus[]).map((option) => (
              <Pressable
                className={
                  value === option
                    ? 'mr-2 rounded-full bg-brand-600 px-3 py-1'
                    : 'mr-2 rounded-full border border-gray-300 px-3 py-1'
                }
                key={option}
                onPress={() => onChange(option)}
                testID={`user-form-status-${option}`}
              >
                <Text
                  className={
                    value === option
                      ? 'text-xs font-medium text-white'
                      : 'text-xs text-gray-700'
                  }
                >
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      />

      {showLoginFields ? (
        <>
          <Text className="mb-1 mt-4 text-sm text-gray-600">Username</Text>
          <Controller
            control={control}
            name="username"
            render={({ field: { onBlur, onChange, value } }) => (
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
                onBlur={onBlur}
                onChangeText={onChange}
                testID="user-form-username"
                value={value}
              />
            )}
          />

          <Text className="mb-1 mt-4 text-sm text-gray-600">
            Temporary password
          </Text>
          <Controller
            control={control}
            name="temporaryPassword"
            render={({ field: { onBlur, onChange, value } }) => (
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
                onBlur={onBlur}
                onChangeText={onChange}
                secureTextEntry
                testID="user-form-temporary-password"
                value={value}
              />
            )}
          />

          <Text className="mb-1 mt-4 text-sm text-gray-600">Mobile</Text>
          <Controller
            control={control}
            name="mobile"
            render={({ field: { onBlur, onChange, value } }) => (
              <TextInput
                className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
                keyboardType="phone-pad"
                onBlur={onBlur}
                onChangeText={onChange}
                testID="user-form-mobile"
                value={value}
              />
            )}
          />
        </>
      ) : null}

      {isEditing && editingUser?.username ? (
        <Text className="mt-2 text-xs text-gray-400">
          Username: {editingUser.username} (not editable here)
        </Text>
      ) : null}

      <Text className="mb-1 mt-4 text-sm text-gray-600">Monthly salary</Text>
      <Controller
        control={control}
        name="monthlySalary"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextInput
            className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
            keyboardType="decimal-pad"
            onBlur={onBlur}
            onChangeText={onChange}
            testID="user-form-monthly-salary"
            value={value}
          />
        )}
      />

      {isEditing && editingUser?.halfDayRate ? (
        <Text className="mt-3 text-xs text-gray-500">
          Current half-day rate: ₹{editingUser.halfDayRate}
        </Text>
      ) : null}

      <Text className="mb-1 mt-4 text-sm text-gray-600">
        {isEditing
          ? 'Change half-day rate (optional)'
          : 'Half-day rate (optional)'}
      </Text>
      <Controller
        control={control}
        name="halfDayRate"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextInput
            className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
            keyboardType="decimal-pad"
            onBlur={onBlur}
            onChangeText={onChange}
            testID="user-form-half-day-rate"
            value={value}
          />
        )}
      />

      <Text className="mb-1 mt-4 text-sm text-gray-600">
        Effective from (YYYY-MM-DD)
      </Text>
      <Controller
        control={control}
        name="rateEffectiveFrom"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextInput
            autoCapitalize="none"
            className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
            onBlur={onBlur}
            onChangeText={onChange}
            placeholder="2026-10-03"
            testID="user-form-rate-effective-from"
            value={value}
          />
        )}
      />

      {submitError ? (
        <Text className="mt-4 text-sm text-red-600" testID="user-form-error">
          {submitError}
        </Text>
      ) : null}

      <Pressable
        className="mb-8 mt-6 items-center rounded-md bg-brand-600 py-3"
        disabled={isSubmitting || uploadingPhoto}
        onPress={() => {
          void onSubmit();
        }}
        testID="user-form-submit"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="font-semibold text-white">
            {isEditing ? 'Save changes' : 'Create user'}
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
