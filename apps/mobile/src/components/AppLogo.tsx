import { Image, type ImageStyle, type StyleProp } from 'react-native';

import logoSource from '../../assets/logo.png';

/**
 * User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 2 / PRD §4 screen 0 ("App logo sheet") / FR-026. Purely
 * presentational — just renders `assets/logo.png`.
 *
 * `assets/logo.png` is a generated placeholder (a rounded brand-blue
 * square with an "FS" monogram, matching the `brand-700` token in
 * `packages/config/tailwind-preset.js`), NOT a real brand asset — this
 * project has none yet. Generated with Pillow:
 * `Image.new(...)` + `ImageDraw.rounded_rectangle(...)` + `ImageDraw.text(...)`,
 * saved as a 512×512 RGBA PNG. Swap the file in place (same path) once a
 * real logo exists; no other code needs to change.
 */
export interface AppLogoProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

export function AppLogo({ size = 96, style }: AppLogoProps) {
  return (
    <Image
      source={logoSource}
      style={[{ width: size, height: size }, style]}
      accessibilityRole="image"
      accessibilityLabel="App logo"
    />
  );
}
