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
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.dwt.mobile',
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    package: 'com.dwt.mobile',
  },
  plugins: ['expo-secure-store', 'expo-image-picker'],
  extra: {
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000',
  },
};

export default config;
