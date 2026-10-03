declare module 'react-native-config' {
  /**
   * Per-company build config (Architecture §16.1, D-08), surfaced to JS by react-native-config
   * from the `BuildConfig` fields each Android product flavor sets in
   * `android/app/build.gradle` — the bare-RN replacement for Expo's `expo-constants`.
   */
  export interface NativeConfig {
    COMPANY_CODE?: string;
    COMPANY_NAME?: string;
    API_URL?: string;
    GOOGLE_MAPS_API_KEY?: string;
  }

  export const Config: NativeConfig;
  export default Config;
}
