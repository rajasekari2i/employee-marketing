import { Image, type ImageStyle, type StyleProp } from 'react-native';

import logoSource from '../../assets/logo.png';

/**
 * User Story 2 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 2 / PRD §4 screen 0 ("App logo sheet") / FR-026. Purely
 * presentational — just renders `assets/logo.png`.
 *
 * `assets/logo.png` is the final "chakra pin" mark from
 * `docs/ui-design/Field_Sales_Beat_App.html` ("0 · App logo (final)"),
 * rasterized to a 512×512 RGBA PNG.
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
