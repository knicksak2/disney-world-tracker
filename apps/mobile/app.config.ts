import type { ExpoConfig } from 'expo/config';

/**
 * Expo app configuration for the Disney World Tracker mobile client.
 *
 * The `extra` block surfaces runtime configuration to the app via
 * `expo-constants`. All values must be hosting-agnostic; only env vars
 * carry provider-specific URLs.
 */

/**
 * Resolve the API base URL the app should talk to.
 *
 * Resolution order (first match wins):
 *   1. `API_BASE_URL` — explicit override for any context (set in `.env.local`
 *      to point at a specific emulator/LAN/phone address, or inline for a
 *      one-off). Always wins so you can test against anything.
 *   2. When building/exporting for release (`NODE_ENV=production`, which Expo
 *      sets for `expo export` and EAS builds) → the hosted API. Use
 *      `PROD_API_BASE_URL` to override the default Render URL.
 *   3. Local dev (`expo start`, `NODE_ENV=development`) → the Android emulator
 *      route to the host machine.
 *
 * This means a plain `npm run dev:mobile` keeps hitting your local API, while
 * a production build automatically targets Render — no env juggling needed.
 */
const LOCAL_DEFAULT = 'http://10.0.2.2:3000';
const HOSTED_DEFAULT =
  process.env.PROD_API_BASE_URL ?? 'https://dwt-api.onrender.com';

const apiBaseUrl =
  process.env.API_BASE_URL ??
  (process.env.NODE_ENV === 'production' ? HOSTED_DEFAULT : LOCAL_DEFAULT);

const config: ExpoConfig = {
  name: 'Disney World Tracker',
  slug: 'disney-tracker',
  owner: 'knicksak2s-team',
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
    // FCM config for the `com.dwt.mobile` Firebase app. Expo's prebuild reads
    // this file and wires the Google Services Gradle plugin automatically, so
    // the native FCM SDK can obtain a device push token in a dev/production
    // build (remote push is unsupported in Expo Go, SDK 53+).
    googleServicesFile: './google-services.json',
  },
  // SDK 56 promotes `expo-status-bar` to a config plugin that must be
  // registered explicitly (expo install --fix / expo-doctor enforce this).
  plugins: [
    'expo-secure-store',
    'expo-image-picker',
    'expo-status-bar',
    'expo-notifications',
  ],
  extra: {
    apiBaseUrl,
    eas: {
      projectId: 'e98d1957-cb2c-431a-be3d-486c6c66122c',
    },
  },
};

export default config;
