import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
} from 'react-native';
import { changePasswordSchema } from '@field-sales/shared';

import { ApiError, apiRequest, generateIdempotencyKey } from '../../api/client';
import { clearSession } from '../../lib/secureSession';

/**
 * User Story 4 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 9 / PRD §4 screen 1.10. New `AdminStackParamList` route,
 * `RootNavigator.tsx`.
 *
 * On success, calls `clearSession()` (decision #9: the server just
 * revoked every other session for this user, including — potentially —
 * this very one) with NO explicit navigation call afterward:
 * `RootNavigator.tsx`'s existing `subscribeSession()` mechanism carries
 * the app back to Sign In on its own, the identical pattern
 * `HomeScreen.tsx`'s own logout already uses.
 */

interface ChangePasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/** Maps a failed submit to a short, readable message. */
function errorMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'INVALID_CREDENTIALS':
        return 'Current password is incorrect.';
      case 'VALIDATION_FAILED':
        return (
          error.message ||
          'New password must be at least 8 characters with a letter and a digit, and different from your current password.'
        );
      case 'NETWORK_ERROR':
        return 'No internet connection. Check your signal and try again.';
      default:
        return 'Something went wrong at our end. Try again in a moment.';
    }
  }
  return 'Something went wrong at our end. Try again in a moment.';
}

export function ChangePasswordScreen() {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);

    // Client-side FR-013 validation via the same shared schema the backend
    // uses (Constitution rule 5) — before ever hitting the network.
    const parsed = changePasswordSchema.safeParse(values);
    if (!parsed.success) {
      setSubmitError(
        parsed.error.issues[0]?.message ??
          'Please check the fields and try again.',
      );
      return;
    }

    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: parsed.data,
        idempotencyKey: generateIdempotencyKey(),
      });
      // decision #9: the server already revoked every other session for
      // this user, including possibly this one's own refresh token —
      // clearing the local store just makes the client's state match
      // that. No explicit navigation call: RootNavigator.tsx's
      // subscribeSession() swaps back to Sign In on its own.
      await clearSession();
    } catch (error) {
      setSubmitError(errorMessageFor(error));
    }
  });

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{ padding: 16 }}
    >
      <Text className="mb-1 text-sm text-gray-600">Current password</Text>
      <Controller
        control={control}
        name="currentPassword"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
            editable={!isSubmitting}
            onBlur={onBlur}
            onChangeText={onChange}
            secureTextEntry
            testID="change-password-current"
            value={value}
          />
        )}
        rules={{ required: 'Current password is required.' }}
      />
      {errors.currentPassword ? (
        <Text className="mt-1 text-xs text-red-600">
          {errors.currentPassword.message}
        </Text>
      ) : null}

      <Text className="mb-1 mt-4 text-sm text-gray-600">New password</Text>
      <Controller
        control={control}
        name="newPassword"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
            editable={!isSubmitting}
            onBlur={onBlur}
            onChangeText={onChange}
            secureTextEntry
            testID="change-password-new"
            value={value}
          />
        )}
        rules={{ required: 'New password is required.' }}
      />
      {errors.newPassword ? (
        <Text className="mt-1 text-xs text-red-600">
          {errors.newPassword.message}
        </Text>
      ) : null}

      <Text className="mb-1 mt-4 text-sm text-gray-600">
        Confirm new password
      </Text>
      <Controller
        control={control}
        name="confirmPassword"
        render={({ field: { onBlur, onChange, value } }) => (
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
            editable={!isSubmitting}
            onBlur={onBlur}
            onChangeText={onChange}
            secureTextEntry
            testID="change-password-confirm"
            value={value}
          />
        )}
        rules={{ required: 'Please confirm your new password.' }}
      />
      {errors.confirmPassword ? (
        <Text className="mt-1 text-xs text-red-600">
          {errors.confirmPassword.message}
        </Text>
      ) : null}

      {submitError ? (
        <Text
          className="mt-4 text-sm text-red-600"
          testID="change-password-error"
        >
          {submitError}
        </Text>
      ) : null}

      <Pressable
        className="mb-8 mt-6 items-center rounded-md bg-brand-600 py-3"
        disabled={isSubmitting}
        onPress={() => {
          void onSubmit();
        }}
        testID="change-password-submit"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="font-semibold text-white">Change password</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
