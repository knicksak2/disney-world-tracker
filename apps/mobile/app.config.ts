import type { ExpoConfig } from 'expo/config';

/**
 * Expo app configuration for the Disney World Tracker mobile client.
 *
 * The `extra` block surfaces runtime configuration to the app via
 * `expo-constants`. All values must be hosting-agnostic; only env vars
 * carry provider-specific URLs.
 */
const config: ExpoConfig = {
  name: 'Disney World Tracker',
  slug: 'dwt',
  version: '0.0.0',
  orientation: 'portrait',
  // NOTE: custom icon/splash/adaptive-icon assets are not yet committed, so
  // Expo's built-in defaults are used. Add PNGs under `apps/mobile/assets/`
  // and restore the `icon`, `splash`, and `android.adaptiveIcon` fields when
  // branding is ready.
  userInterfaceStyle: 'automatic',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.dwt.mobile',
  },
  android: {
    package: 'com.dwt.mobile',
  },
  // SDK 56 promotes `expo-status-bar` to a config plugin that must be
  // registered explicitly (expo install --fix / expo-doctor enforce this).
  plugins: ['expo-secure-store', 'expo-image-picker', 'expo-status-bar'],
  extra: {
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000',
  },
};

export default config;
