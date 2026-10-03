import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  loginSchema,
  type LoginInput,
  type RoleKey,
} from '@field-sales/shared';

import { ApiError, apiRequest } from '../../api/client';
import { AppLogo } from '../../components/AppLogo';
import { COMPANY_CODE } from '../../config';
import { setSession } from '../../lib/secureSession';

/**
 * User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * items 3-4 / PRD §4 screen 1.1. Username + password only (FR-AUTH-01) —
 * `companyCode` is never a form field the user sees or edits; it is set
 * once, from the per-company build config (`../../config.ts`, WU-01),
 * as a `react-hook-form` default value so `loginSchema` still validates and
 * submits the exact same three-field shape the backend expects (Constitution
 * rule 5 — "one contract"). This mobile build never logs in a SYSTEM_ADMIN
 * (CLAUDE.md: "System Admin ... no mobile screens"), so there is no case
 * here that needs to omit `companyCode`.
 */

interface LoginSuccessResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    role: RoleKey;
    companyId: string | null;
    permissions: string[];
  };
}

/** Maps a failed login to the exact copy PRD §5 / contracts/auth.md specify. */
function errorMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'INVALID_CREDENTIALS':
        return 'Username or password is incorrect.';
      case 'ACCOUNT_INACTIVE':
        return 'This account is not active. Ask your administrator.';
      case 'NETWORK_ERROR':
        return 'No internet connection. Check your signal and try again.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait 15 minutes and try again.';
      default:
        return 'Something went wrong at our end. Try again in a moment.';
    }
  }
  return 'Something went wrong at our end. Try again in a moment.';
}

export function SignInScreen() {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { companyCode: COMPANY_CODE, username: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const result = await apiRequest<LoginSuccessResponse>('/auth/login', {
        method: 'POST',
        body: values,
        auth: false,
      });

      // DoD item 4: store the pair, then "navigate" into the authenticated
      // stack — there is no explicit navigation call here on purpose; see
      // RootNavigator.tsx's class doc for why setSession() alone is enough.
      await setSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        role: result.user.role,
      });
    } catch (error) {
      setSubmitError(errorMessageFor(error));
    }
  });

  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <AppLogo size={96} style={{ marginBottom: 32 }} />
      <Text className="mb-6 text-xl font-semibold text-brand-700">Sign in</Text>

      <View className="w-full max-w-sm">
        <Text className="mb-1 text-sm text-gray-600">Username</Text>
        <Controller
          control={control}
          name="username"
          render={({ field: { onBlur, onChange, value } }) => (
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
              editable={!isSubmitting}
              onBlur={onBlur}
              onChangeText={onChange}
              testID="sign-in-username"
              value={value}
            />
          )}
        />
        {errors.username ? (
          <Text className="mt-1 text-xs text-red-600">
            {errors.username.message}
          </Text>
        ) : null}

        <Text className="mb-1 mt-4 text-sm text-gray-600">Password</Text>
        <Controller
          control={control}
          name="password"
          render={({ field: { onBlur, onChange, value } }) => (
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
              editable={!isSubmitting}
              onBlur={onBlur}
              onChangeText={onChange}
              secureTextEntry
              testID="sign-in-password"
              value={value}
            />
          )}
        />
        {errors.password ? (
          <Text className="mt-1 text-xs text-red-600">
            {errors.password.message}
          </Text>
        ) : null}

        {submitError ? (
          <Text className="mt-4 text-sm text-red-600" testID="sign-in-error">
            {submitError}
          </Text>
        ) : null}

        <Pressable
          className="mt-6 items-center rounded-md bg-brand-600 py-3"
          disabled={isSubmitting}
          onPress={() => {
            void onSubmit();
          }}
          testID="sign-in-submit"
        >
          {isSubmitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Sign in</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
