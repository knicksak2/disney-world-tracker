import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExpoConfig } from 'expo/config';

/**
 * Minimal `.env` parser (no dependency): reads `KEY=VALUE` lines, ignoring
 * blanks and `#` comments and stripping matched surrounding quotes. Returns an
 * empty object if the file is absent. Used to load an opt-in, script-selected
 * env file (e.g. `.env.dev`) that Expo does not auto-load — Expo only loads
 * `.env`, `.env.local`, and `.env.<mode>` and has no `--env-file` flag.
 */
function loadEnvFile(fileName: string): Record<string, string> {
  try {
    const raw = readFileSync(join(process.cwd(), fileName), 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

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
 *   1. `.env.<APP_ENV>` file's `API_BASE_URL`, when `APP_ENV` is set. The
 *      `dev:mobile:cloud` script sets `APP_ENV=dev`, loading `apps/mobile/
 *      .env.dev` for a dev run (fast refresh, dev bundling) that talks to the
 *      hosted backend. Mirrors the API's `.env.dev` / `dev:cloud` convention,
 *      and deliberately wins over a local `API_BASE_URL` pinned in `.env.local`.
 *   2. When `APP_ENV=dev` but `.env.dev` is absent or has no `API_BASE_URL` →
 *      the hosted Render default. So the cloud script works with no setup;
 *      `.env.dev` is an optional override (like `PROD_API_BASE_URL`), and since
 *      it is gitignored a fresh clone still targets Render.
 *   3. `API_BASE_URL` — explicit override for any other context (set in
 *      `.env.local` to point at a specific emulator/LAN/phone address, or
 *      inline for a one-off). Wins over the defaults below.
 *   4. When building/exporting for release (`NODE_ENV=production`, which Expo
 *      sets for `expo export` and EAS builds) → the hosted API. Use
 *      `PROD_API_BASE_URL` to override the default Render URL.
 *   5. Local dev (`expo start`, `NODE_ENV=development`) → the Android emulator
 *      route to the host machine.
 *
 * This means a plain `npm run dev:mobile` keeps hitting your local API, a
 * production build automatically targets Render, and `npm run dev:mobile:cloud`
 * points a dev run at Render — no env juggling needed.
 */
const LOCAL_DEFAULT = 'http://10.0.2.2:3000';
const HOSTED_DEFAULT =
  process.env.PROD_API_BASE_URL ?? 'https://dwt-api.onrender.com';

const appEnv = process.env.APP_ENV;
const appEnvFile = appEnv ? loadEnvFile(`.env.${appEnv}`) : {};

const apiBaseUrl =
  appEnvFile.API_BASE_URL ??
  (appEnv === 'dev' ? HOSTED_DEFAULT : undefined) ??
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
