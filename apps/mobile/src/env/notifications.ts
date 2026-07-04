/**
 * Lazy, environment-gated loader for `expo-notifications`.
 *
 * Importing `expo-notifications` statically executes its module body at app
 * startup. On Android in Expo Go (SDK 53+), that module wires up remote-push
 * native listeners and throws a hard "[runtime not ready]" error — before any
 * React effect or runtime guard can run. So a static `import` anywhere in the
 * startup module graph crashes the whole App in Expo Go.
 *
 * To avoid that, callers obtain the module through {@link loadNotifications},
 * which returns `null` in Expo Go (so the push code no-ops, per R8.7/R9.2) and
 * only `require`s the real module — executing its body — in a development or
 * production build where remote push is supported. Because Metro evaluates a
 * module the first time it is `require`d (not when the bundle loads), gating
 * the `require` behind {@link remotePushSupported} means `expo-notifications`
 * is never evaluated in Expo Go.
 *
 * The `import type` below is erased at compile time and does NOT load the
 * module at runtime; it exists only so callers get full typing on the returned
 * value.
 */

import type * as NotificationsModule from 'expo-notifications';

import { remotePushSupported } from './pushSupport';

/** The `expo-notifications` module surface, for typing lazily-loaded access. */
export type NotificationsApi = typeof NotificationsModule;

/**
 * Return the `expo-notifications` module in an environment that supports remote
 * push, or `null` in Expo Go (where loading it would crash). The module body
 * is only evaluated on the first successful call, never in Expo Go.
 */
export function loadNotifications(): NotificationsApi | null {
  if (!remotePushSupported()) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications') as NotificationsApi;
}
