import { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyOtpSchema,
} from '@field-sales/shared';

import { ApiError, apiRequest, generateIdempotencyKey } from '../../api/client';
import { PasswordInput } from '../../components/PasswordInput';
import { COMPANY_CODE } from '../../config';
import type { AuthStackParamList } from '../../navigation/RootNavigator';

/**
 * User Story 4 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 10 / PRD §4 screen 1.2. New `AuthStackParamList` route, reachable
 * from a new "Forgot password?" link on `SignInScreen.tsx`.
 *
 * One screen, internal step state: username entry -> masked-mobile
 * confirmation -> OTP entry (expiry countdown, attempts remaining, resend
 * disabled client-side for 30s) -> new password x2 — chaining
 * `POST /auth/forgot-password` -> `POST /auth/verify-otp` ->
 * `POST /auth/reset-password`, sending `COMPANY_CODE` on every call
 * (decision #3a, the identical build-time constant `SignInScreen.tsx`
 * already sends for login). Plain `useState` per field rather than
 * `react-hook-form` here — a 4-step wizard with step-dependent fields
 * doesn't fit a single `useForm()` call the way a one-screen form does;
 * every submit still validates against the same shared Zod schemas the
 * backend uses (Constitution rule 5), via `.safeParse()`, the same manual
 * pattern `UserFormScreen.tsx`'s own submit handlers already use.
 */

type Step = 'username' | 'confirmMobile' | 'otp' | 'newPassword' | 'done';

/** FR-012: the same 10-minute OTP lifetime and 30-second resend cooldown the backend enforces — tracked here purely for the client-side countdown/disable UX; the backend's own checks are the real enforcement. */
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

type ForgotPasswordNavigationProp = NativeStackNavigationProp<
  AuthStackParamList,
  'ForgotPassword'
>;

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Reads `verify-otp`'s `attemptsRemaining` out of `ApiError.details` (`auth.service.ts`'s `errors: [{ path: 'attemptsRemaining', message: String(n) }]`) — the structured RFC 9457 `errors` array `apiRequest()` now carries on every `ApiError`, not a value parsed out of the free-text `detail` message. */
function readAttemptsRemaining(error: ApiError): number | null {
  const entry = error.details?.find((d) => d.path === 'attemptsRemaining');
  if (!entry) {
    return null;
  }
  const value = Number(entry.message);
  return Number.isFinite(value) ? value : null;
}

export function ForgotPasswordScreen() {
  const navigation = useNavigation<ForgotPasswordNavigationProp>();

  const [step, setStep] = useState<Step>('username');
  const [username, setUsername] = useState('');
  const [maskedMobile, setMaskedMobile] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');

  const [sentAt, setSentAt] = useState<number>(0);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number>(5);
  const [now, setNow] = useState(() => Date.now());

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ticks `now` once a second while the OTP step is showing, so the expiry
  // countdown and the resend-cooldown disable both stay live.
  useEffect(() => {
    if (step !== 'otp') {
      return undefined;
    }
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [step]);

  const msSinceSent = now - sentAt;
  const msUntilExpiry = OTP_TTL_MS - msSinceSent;
  const msUntilResendAllowed = RESEND_COOLDOWN_MS - msSinceSent;
  const isExpired = msUntilExpiry <= 0;
  const canResend = msUntilResendAllowed <= 0;

  async function requestOtp(): Promise<boolean> {
    const parsed = forgotPasswordSchema.safeParse({
      companyCode: COMPANY_CODE,
      username,
    });
    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ?? 'Please enter your username.',
      );
      return false;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await apiRequest<{ maskedMobile: string }>(
        '/auth/forgot-password',
        { method: 'POST', body: parsed.data, auth: false },
      );
      setMaskedMobile(result.maskedMobile);
      setSentAt(Date.now());
      setNow(Date.now());
      setAttemptsRemaining(5);
      setCode('');
      return true;
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.code === 'NETWORK_ERROR'
          ? 'No internet connection. Check your signal and try again.'
          : 'Something went wrong at our end. Try again in a moment.',
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUsernameSubmit(): Promise<void> {
    const ok = await requestOtp();
    if (ok) {
      setStep('confirmMobile');
    }
  }

  async function handleResend(): Promise<void> {
    if (!canResend || submitting) {
      return;
    }
    await requestOtp();
  }

  async function handleVerifyOtp(): Promise<void> {
    const parsed = verifyOtpSchema.safeParse({
      companyCode: COMPANY_CODE,
      username,
      code,
    });
    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ?? 'Enter the 6-digit code.',
      );
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await apiRequest<{ resetToken: string }>(
        '/auth/verify-otp',
        { method: 'POST', body: parsed.data, auth: false },
      );
      setResetToken(result.resetToken);
      setStep('newPassword');
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'OTP_INCORRECT') {
          const remaining = readAttemptsRemaining(error);
          if (remaining !== null) {
            setAttemptsRemaining(remaining);
          }
          setErrorMessage(
            `That code is not correct. ${remaining ?? attemptsRemaining} attempts left.`,
          );
        } else if (error.code === 'OTP_EXPIRED') {
          setErrorMessage('That code has expired. Tap Resend OTP.');
        } else if (error.code === 'OTP_ATTEMPTS_EXHAUSTED') {
          setErrorMessage(
            'Too many incorrect attempts. Tap Resend OTP to request a new code.',
          );
          setAttemptsRemaining(0);
        } else if (error.code === 'NETWORK_ERROR') {
          setErrorMessage(
            'No internet connection. Check your signal and try again.',
          );
        } else {
          setErrorMessage(
            'Something went wrong at our end. Try again in a moment.',
          );
        }
      } else {
        setErrorMessage(
          'Something went wrong at our end. Try again in a moment.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(): Promise<void> {
    const parsed = resetPasswordSchema.safeParse({
      resetToken,
      newPassword,
      confirmPassword,
    });
    if (!parsed.success) {
      setErrorMessage(
        parsed.error.issues[0]?.message ??
          'Please check the fields and try again.',
      );
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: parsed.data,
        auth: false,
        idempotencyKey: generateIdempotencyKey(),
      });
      setStep('done');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TOKEN_EXPIRED') {
        setErrorMessage(
          'This reset link has expired. Start over with "Forgot password?".',
        );
      } else if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
        setErrorMessage(
          'No internet connection. Check your signal and try again.',
        );
      } else {
        setErrorMessage(
          'Something went wrong at our end. Try again in a moment.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{
        padding: 24,
        flexGrow: 1,
        justifyContent: 'center',
      }}
    >
      {step === 'username' ? (
        <View>
          <Text className="mb-1 text-xl font-semibold text-brand-700">
            Forgot password
          </Text>
          <Text className="mb-6 text-sm text-gray-600">
            Enter your username and we&apos;ll send a verification code to your
            registered mobile number.
          </Text>

          <Text className="mb-1 text-sm text-gray-600">Username</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
            editable={!submitting}
            onChangeText={setUsername}
            testID="forgot-password-username"
            value={username}
          />

          {errorMessage ? (
            <Text
              className="mt-4 text-sm text-red-600"
              testID="forgot-password-error"
            >
              {errorMessage}
            </Text>
          ) : null}

          <Pressable
            className="mt-6 items-center rounded-md bg-brand-600 py-3"
            disabled={submitting}
            onPress={() => {
              void handleUsernameSubmit();
            }}
            testID="forgot-password-submit-username"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="font-semibold text-white">Send code</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {step === 'confirmMobile' ? (
        <View>
          <Text className="mb-1 text-xl font-semibold text-brand-700">
            Check your phone
          </Text>
          <Text
            className="mb-6 text-sm text-gray-600"
            testID="forgot-password-masked-mobile"
          >
            We sent a 6-digit code to {maskedMobile}.
          </Text>

          <Pressable
            className="items-center rounded-md bg-brand-600 py-3"
            onPress={() => setStep('otp')}
            testID="forgot-password-continue-to-otp"
          >
            <Text className="font-semibold text-white">Enter code</Text>
          </Pressable>
        </View>
      ) : null}

      {step === 'otp' ? (
        <View>
          <Text className="mb-1 text-xl font-semibold text-brand-700">
            Enter the code
          </Text>
          <Text className="mb-1 text-sm text-gray-600">
            Sent to {maskedMobile}.
          </Text>
          <Text
            className="mb-6 text-xs text-gray-500"
            testID="forgot-password-countdown"
          >
            {isExpired
              ? 'This code has expired.'
              : `Expires in ${formatCountdown(msUntilExpiry)}`}
          </Text>

          <Text className="mb-1 text-sm text-gray-600">6-digit code</Text>
          <TextInput
            className="rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900"
            editable={!submitting}
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setCode}
            testID="forgot-password-otp-code"
            value={code}
          />
          <Text
            className="mt-1 text-xs text-gray-500"
            testID="forgot-password-attempts"
          >
            {attemptsRemaining} attempt(s) remaining
          </Text>

          {errorMessage ? (
            <Text
              className="mt-4 text-sm text-red-600"
              testID="forgot-password-error"
            >
              {errorMessage}
            </Text>
          ) : null}

          <Pressable
            className="mt-6 items-center rounded-md bg-brand-600 py-3"
            disabled={submitting}
            onPress={() => {
              void handleVerifyOtp();
            }}
            testID="forgot-password-submit-otp"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="font-semibold text-white">Verify code</Text>
            )}
          </Pressable>

          <Pressable
            className="mt-4 items-center py-2"
            disabled={!canResend || submitting}
            onPress={() => {
              void handleResend();
            }}
            testID="forgot-password-resend"
          >
            <Text
              className={
                canResend
                  ? 'text-sm font-medium text-brand-700'
                  : 'text-sm text-gray-400'
              }
            >
              {canResend
                ? 'Resend OTP'
                : `Resend OTP in ${formatCountdown(msUntilResendAllowed)}`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {step === 'newPassword' ? (
        <View>
          <Text className="mb-1 text-xl font-semibold text-brand-700">
            Set a new password
          </Text>
          <Text className="mb-6 text-sm text-gray-600">
            At least 8 characters, with a letter and a digit.
          </Text>

          <Text className="mb-1 text-sm text-gray-600">New password</Text>
          <PasswordInput
            editable={!submitting}
            onChangeText={setNewPassword}
            testID="forgot-password-new-password"
            value={newPassword}
          />

          <Text className="mb-1 mt-4 text-sm text-gray-600">
            Confirm new password
          </Text>
          <PasswordInput
            editable={!submitting}
            onChangeText={setConfirmPassword}
            testID="forgot-password-confirm-password"
            value={confirmPassword}
          />

          {errorMessage ? (
            <Text
              className="mt-4 text-sm text-red-600"
              testID="forgot-password-error"
            >
              {errorMessage}
            </Text>
          ) : null}

          <Pressable
            className="mt-6 items-center rounded-md bg-brand-600 py-3"
            disabled={submitting}
            onPress={() => {
              void handleResetPassword();
            }}
            testID="forgot-password-submit-new-password"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="font-semibold text-white">Reset password</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {step === 'done' ? (
        <View>
          <Text className="mb-1 text-xl font-semibold text-brand-700">
            Password updated
          </Text>
          <Text className="mb-6 text-sm text-gray-600">
            Sign in with your new password.
          </Text>

          <Pressable
            className="items-center rounded-md bg-brand-600 py-3"
            onPress={() => navigation.navigate('SignIn')}
            testID="forgot-password-done"
          >
            <Text className="font-semibold text-white">Back to sign in</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}
