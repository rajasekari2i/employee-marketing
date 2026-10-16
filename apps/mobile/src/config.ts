import Config from 'react-native-config';

/**
 * Per-company build configuration (Architecture §16.1, D-08). These five values live in
 * `.env.<flavor>` (apps/mobile root, gitignored — see `.env.example`), one file per Android
 * product flavor (`android/app/build.gradle`'s `productFlavors`). `dotenv.gradle` (wired up in
 * that file) turns every key in the active flavor's `.env.<flavor>` into a `BuildConfig` field,
 * and `react-native-config` reads those off the generated `BuildConfig` class via reflection.
 * This is the bare-RN equivalent of what `app.config.ts`'s `extra` object provided under Expo:
 * one typed place for the rest of the app to import `APP_NAME`/`COMPANY_CODE`/`COMPANY_NAME`/
 * `API_URL`/`GOOGLE_MAPS_API_KEY` from, rather than reading `react-native-config` directly all
 * over the codebase.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required build config value "${name}" — check the active product flavor's ` +
        '.env.<flavor> file (apps/mobile root).',
    );
  }
  return value;
}

export const APP_NAME: string = required('APP_NAME', Config.APP_NAME);
export const COMPANY_CODE: string = required(
  'COMPANY_CODE',
  Config.COMPANY_CODE,
);
export const COMPANY_NAME: string = required(
  'COMPANY_NAME',
  Config.COMPANY_NAME,
);
export const API_URL: string = required('API_URL', Config.API_URL);

// Legitimately empty for the `dev` flavor (no Maps key configured locally), so this one is not
// required the way the others are.
export const GOOGLE_MAPS_API_KEY: string = Config.GOOGLE_MAPS_API_KEY ?? '';
