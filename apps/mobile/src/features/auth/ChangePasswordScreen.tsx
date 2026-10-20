import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { changePasswordSchema } from '@field-sales/shared';

import { ApiError, apiRequest, generateIdempotencyKey } from '../../api/client';
import {
  OutlineIcon,
  type IconShape,
} from '../../components/icons/OutlineIcon';
import { PasswordInput } from '../../components/PasswordInput';
import {
  BG,
  BLUE,
  BORDER,
  DANGER,
  INK,
  LABEL,
  MUTED,
} from '../admin/adminDesign';
import type { AdminStackParamList } from '../../navigation/RootNavigator';
import { clearSession } from '../../lib/secureSession';

/**
 * PRD §4 screen 1.10 ("Change password", all users), board uuid
 * `dc8d6d35-7831-4edd-a4b6-bbbf844bf751` — decoded with the CLAUDE.md
 * recipe and carried over verbatim, not approximated.
 *
 * Every value below comes from that board: the `#F3F5F9` page with
 * `52/24/32` padding and a 24 gap, the 44 square back chip, the 24/700
 * heading, the 18-gap form, the 13/600 `#3A4353` labels, the hairline
 * `#DFE4EC` rule under the current-password field, the 12/`#5A6474` rule
 * line under the new one, the 12/600 `#1E3A8A` "Passwords match" tick, and
 * the 54-tall `#1D4ED8` button pinned to the bottom by `margin-top: auto`.
 *
 * The board draws the back chip itself, so the route hides the native
 * stack header (`headerShown: false` in `RootNavigator.tsx`) — with it on,
 * the screen carried two titles and no board-accurate header at all, which
 * is what made it look unlike 1.10.
 *
 * On success, calls `clearSession()` (decision #9: the server just revoked
 * every other session for this user, including — potentially — this very
 * one) with NO explicit navigation call afterward: `RootNavigator.tsx`'s
 * `subscribeSession()` carries the app back to Sign In on its own.
 */

interface ChangePasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const ICON_BACK: IconShape[] = [{ d: 'M15 18l-6-6 6-6' }];

/** The board's confirmation tick and its copy are `#1E3A8A`, not the blue. */
const MATCH_INK = '#1E3A8A';
const ICON_TICK: IconShape[] = [{ d: 'M5 12l5 5L20 7' }];

/** `.lbl` — 13/600 `#3A4353`, 6 above the field. */
const LABEL_STYLE = {
  fontSize: 13,
  fontWeight: '600',
  color: LABEL,
  marginBottom: 6,
} as const;

/** The board's own two rule lines under a field: 12px, 6 below it. */
const HINT_STYLE = { marginTop: 6, fontSize: 12, color: MUTED } as const;

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
  const insets = useSafeAreaInsets();
  // Every stack that registers this route declares it identically, so the
  // admin's parameter list types the `goBack` the board's chip performs.
  const navigation =
    useNavigation<
      NativeStackNavigationProp<AdminStackParamList, 'ChangePassword'>
    >();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  // Board 1.10 draws the retyped field with a live confirmation under it.
  const newPassword = watch('newPassword');
  const confirmPassword = watch('confirmPassword');
  const bothTyped = newPassword.length > 0 && confirmPassword.length > 0;
  const matches = bothTyped && newPassword === confirmPassword;

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
      // clearing the local store just makes the client's state match that.
      await clearSession();
    } catch (error) {
      setSubmitError(errorMessageFor(error));
    }
  });

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 24,
          paddingBottom: 24,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable
          accessibilityLabel="Back to profile"
          accessibilityRole="button"
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
          testID="change-password-back"
        >
          <OutlineIcon
            color={INK}
            shapes={ICON_BACK}
            size={20}
            strokeWidth={2}
          />
        </Pressable>
        <Text
          style={{
            fontSize: 24,
            fontWeight: '700',
            color: INK,
            letterSpacing: -0.24,
          }}
        >
          Change password
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 32,
          gap: 18,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text style={LABEL_STYLE}>Current password</Text>
          <Controller
            control={control}
            name="currentPassword"
            render={({ field: { onBlur, onChange, value } }) => (
              <PasswordInput
                autoComplete="current-password"
                editable={!isSubmitting}
                onBlur={onBlur}
                onChangeText={onChange}
                testID="change-password-current"
                value={value}
              />
            )}
            rules={{ required: 'Current password is required.' }}
          />
          {errors.currentPassword ? (
            <Text style={{ ...HINT_STYLE, color: DANGER }}>
              {errors.currentPassword.message}
            </Text>
          ) : null}
        </View>

        {/* The board separates the current password from the new pair. */}
        <View style={{ height: 1, backgroundColor: BORDER }} />

        <View>
          <Text style={LABEL_STYLE}>New password</Text>
          <Controller
            control={control}
            name="newPassword"
            render={({ field: { onBlur, onChange, value } }) => (
              <PasswordInput
                autoComplete="new-password"
                editable={!isSubmitting}
                onBlur={onBlur}
                onChangeText={onChange}
                testID="change-password-new"
                value={value}
              />
            )}
            rules={{ required: 'New password is required.' }}
          />
          {errors.newPassword ? (
            <Text style={{ ...HINT_STYLE, color: DANGER }}>
              {errors.newPassword.message}
            </Text>
          ) : (
            <Text style={HINT_STYLE}>
              At least 8 characters, with a letter and a number. Must differ
              from the current password.
            </Text>
          )}
        </View>

        <View>
          <Text style={LABEL_STYLE}>Retype new password</Text>
          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onBlur, onChange, value } }) => (
              <PasswordInput
                autoComplete="new-password"
                editable={!isSubmitting}
                onBlur={onBlur}
                onChangeText={onChange}
                testID="change-password-confirm"
                value={value}
              />
            )}
            rules={{ required: 'Please confirm your new password.' }}
          />
          {errors.confirmPassword ? (
            <Text style={{ ...HINT_STYLE, color: DANGER }}>
              {errors.confirmPassword.message}
            </Text>
          ) : matches ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                marginTop: 6,
              }}
            >
              <OutlineIcon
                color={MATCH_INK}
                shapes={ICON_TICK}
                size={14}
                strokeWidth={2.4}
              />
              <Text
                style={{ fontSize: 12, fontWeight: '600', color: MATCH_INK }}
              >
                Passwords match
              </Text>
            </View>
          ) : bothTyped ? (
            /*
              Not on the board, which only draws the matching state — but
              the opposite state has to say something, and saying it here
              in the same slot is what keeps the layout from jumping.
            */
            <Text style={{ ...HINT_STYLE, color: DANGER }}>
              Passwords do not match
            </Text>
          ) : null}
        </View>

        {submitError ? (
          <Text
            style={{ fontSize: 13, color: DANGER }}
            testID="change-password-error"
          >
            {submitError}
          </Text>
        ) : null}

        {/* `margin-top: auto` on the board — the button sits at the bottom. */}
        <View style={{ flexGrow: 1, justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => {
              void onSubmit();
            }}
            style={{
              height: 54,
              borderRadius: 14,
              backgroundColor: BLUE,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            testID="change-password-submit"
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}
              >
                Update password
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
