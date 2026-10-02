import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Per-company build configuration (Architecture §16.1): one APK per company,
 * with COMPANY_CODE, COMPANY_NAME, API_URL and the Google Maps key injected
 * via the EAS build profile's "env" block (see eas.json). Sensible
 * localhost-friendly defaults are used so `pnpm --filter mobile start` still
 * boots for local development without a configured EAS profile.
 */
const companyCode = process.env.COMPANY_CODE ?? 'DEV';
const companyName = process.env.COMPANY_NAME ?? 'Field Sales (Dev)';
const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: companyName,
  slug: 'mobile',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: 'field-sales',
  ios: {
    supportsTablet: true,
    config: {
      googleMapsApiKey,
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    config: {
      googleMaps: {
        apiKey: googleMapsApiKey,
      },
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  extra: {
    companyCode,
    companyName,
    apiUrl,
    googleMapsApiKey,
  },
});
