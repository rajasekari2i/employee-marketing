import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type TextStyle,
} from 'react-native';
import {
  loginSchema,
  type LoginInput,
  type RoleKey,
} from '@field-sales/shared';

import { ApiError, apiRequest } from '../../api/client';
import { AppLogo } from '../../components/AppLogo';
import { PasswordInput } from '../../components/PasswordInput';
import { COMPANY_CODE, COMPANY_NAME } from '../../config';
import { setSession } from '../../lib/secureSession';
import type { AuthStackParamList } from '../../navigation/RootNavigator';

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
 *
 * Layout/colors below are taken verbatim from
 * `docs/ui-design/Field_Sales_Beat_App.html` §1.1 ("1.1 Sign in (all
 * users)") rather than the shared NativeWind/Tailwind scale, since most of
 * its hex values (background, border, label, heading) aren't on that
 * scale. `brand-600`/`brand-700` (packages/config/tailwind-preset.js) do
 * already equal the design's #1D4ED8/#1E40AF, so those two keep using the
 * shared tokens.
 */

const INPUT_STYLE: TextStyle = {
  height: 52,
  borderWidth: 1.5,
  borderColor: '#CBD2DD',
  borderRadius: 12,
  paddingHorizontal: 14,
  fontSize: 16,
  fontWeight: '500',
  color: '#141A26',
  backgroundColor: '#FFFFFF',
};

const LABEL_STYLE: TextStyle = {
  fontSize: 13,
  fontWeight: '600',
  color: '#3A4353',
  marginBottom: 6,
};

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

type SignInNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  'SignIn'
>;

export function SignInScreen() {
  const navigation = useNavigation<SignInNavigationProp>();
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
    <View
      style={{
        flex: 1,
        backgroundColor: '#F3F5F9',
        paddingTop: 104,
        paddingHorizontal: 24,
        paddingBottom: 32,
        gap: 40,
      }}
    >
      <View style={{ alignItems: 'center', gap: 14 }}>
        <AppLogo size={128} />
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#141A26' }}>
          {COMPANY_NAME}
        </Text>
      </View>

      <View style={{ gap: 18 }}>
        <View>
          <Text style={LABEL_STYLE}>Username</Text>
          <Controller
            control={control}
            name="username"
            render={({ field: { onBlur, onChange, value } }) => (
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isSubmitting}
                onBlur={onBlur}
                onChangeText={onChange}
                style={INPUT_STYLE}
                testID="sign-in-username"
                value={value}
              />
            )}
          />
          {errors.username ? (
            <Text style={{ marginTop: 4, fontSize: 12, color: '#DC2626' }}>
              {errors.username.message}
            </Text>
          ) : null}
        </View>

        <View>
          <Text style={LABEL_STYLE}>Password</Text>
          <Controller
            control={control}
            name="password"
            render={({ field: { onBlur, onChange, value } }) => (
              <PasswordInput
                editable={!isSubmitting}
                onBlur={onBlur}
                onChangeText={onChange}
                testID="sign-in-password"
                value={value}
              />
            )}
          />
          {errors.password ? (
            <Text style={{ marginTop: 4, fontSize: 12, color: '#DC2626' }}>
              {errors.password.message}
            </Text>
          ) : null}
        </View>

        {submitError ? (
          <Text
            style={{ fontSize: 14, color: '#DC2626' }}
            testID="sign-in-error"
          >
            {submitError}
          </Text>
        ) : null}

        <Pressable
          android_ripple={{ color: '#1E40AF' }}
          disabled={isSubmitting}
          onPress={() => {
            void onSubmit();
          }}
          style={{
            marginTop: 8,
            height: 54,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#1D4ED8',
          }}
          testID="sign-in-submit"
        >
          {isSubmitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
              Sign in
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('ForgotPassword')}
          style={{ alignSelf: 'center', padding: 10 }}
          testID="sign-in-forgot-password"
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#1D4ED8' }}>
            Forgot password?
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
