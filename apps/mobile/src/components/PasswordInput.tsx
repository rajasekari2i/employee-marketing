import { useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

/**
 * Shared password field for every password input in the app (sign in,
 * change password, forgot-password reset, user-form temporary password) —
 * a `TextInput` that starts masked with a tap-to-reveal eye toggle on the
 * right. `secureTextEntry` is controlled internally, so it's not part of
 * the accepted props.
 *
 * Field sizing/border and the eye glyph match
 * `docs/ui-design/Field_Sales_Beat_App.html` §1.1 exactly (52px input,
 * 1.5px #CBD2DD border, 12px radius; 20px eye icon, #5A6474 stroke,
 * absolute-positioned in a 44x44 hit area at right:4/top:4).
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
        style={{
          height: 52,
          borderWidth: 1.5,
          borderColor: '#CBD2DD',
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingRight: 52,
          fontSize: 16,
          fontWeight: '500',
          color: '#141A26',
          backgroundColor: '#FFFFFF',
        }}
        secureTextEntry={!visible}
        testID={testID}
      />
      <Pressable
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        accessibilityRole="button"
        onPress={() => setVisible((v) => !v)}
        style={{
          position: 'absolute',
          right: 4,
          top: 4,
          width: 44,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        testID={testID ? `${testID}-toggle` : undefined}
      >
        <EyeIcon passwordVisible={visible} />
      </Pressable>
    </View>
  );
}

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: '#5A6474',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * §1.1 only specifies the masked-password state (open eye, aria-label "Show
 * password") — the mock is a single static frame. The revealed-password
 * state (slashed "eye-off") isn't in the design, so it's the standard
 * Feather/Lucide eye-off glyph that pairs with §1.1's eye glyph (same
 * stroke family/weight), not an invented shape.
 */
function EyeIcon({ passwordVisible }: { passwordVisible: boolean }) {
  if (passwordVisible) {
    return (
      <Svg {...ICON_PROPS}>
        <Path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <Line x1={1} y1={1} x2={23} y2={23} />
      </Svg>
    );
  }

  return (
    <Svg {...ICON_PROPS}>
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <Circle cx={12} cy={12} r={3} />
    </Svg>
  );
}
