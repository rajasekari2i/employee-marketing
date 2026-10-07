import { useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';

/**
 * Shared password field for every password input in the app (sign in,
 * change password, forgot-password reset, user-form temporary password) —
 * a `TextInput` that starts masked with a tap-to-reveal eye toggle on the
 * right. `secureTextEntry` is controlled internally, so it's not part of
 * the accepted props.
 *
 * No icon library is installed in this project, so the eye glyph below is
 * drawn from plain `View`s (fixed pixel sizes, not NativeWind className,
 * since the transform/arbitrary-value classes it needs aren't worth
 * depending on) rather than pulling in react-native-vector-icons/svg for
 * one icon.
 */
export function PasswordInput({
  testID,
  ...props
}: Omit<TextInputProps, 'secureTextEntry'>) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={{ position: 'relative' }}>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        className="rounded-md border border-gray-300 px-3 py-2 pr-11 text-base text-gray-900"
        secureTextEntry={!visible}
        testID={testID}
      />
      <Pressable
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        accessibilityRole="button"
        onPress={() => setVisible((v) => !v)}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 44,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        testID={testID ? `${testID}-toggle` : undefined}
      >
        <EyeIcon open={visible} />
      </Pressable>
    </View>
  );
}

const EYE_COLOR = '#4b5563'; // tailwind gray-600, matching the field labels

function EyeIcon({ open }: { open: boolean }) {
  return (
    <View
      style={{
        height: 20,
        width: 20,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          height: 11,
          width: 18,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: EYE_COLOR,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {open ? (
          <View
            style={{
              height: 5,
              width: 5,
              borderRadius: 2.5,
              backgroundColor: EYE_COLOR,
            }}
          />
        ) : null}
      </View>
      {!open ? (
        <View
          style={{
            position: 'absolute',
            height: 1.5,
            width: 22,
            backgroundColor: EYE_COLOR,
            transform: [{ rotate: '45deg' }],
          }}
        />
      ) : null}
    </View>
  );
}
