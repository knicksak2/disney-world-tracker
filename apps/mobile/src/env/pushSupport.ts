/**
 * Remote-push environment gate.
 *
 * Since Expo SDK 53, remote (push) notification support was removed from
 * Expo Go: calling `expo-notifications` push APIs there throws at runtime. The
 * feature only works in a development build or a production/standalone build.
 *
 * The Share notification flow (push registration in `usePushRegistration` and
 * the notification-tap handler in `useNotificationResponse`) therefore checks
 * {@link remotePushSupported} before touching any remote-push API. When the App
 * runs inside Expo Go the flow no-ops, and every other in-App capability
 * (sharing, Inbox, reactions, comparison) keeps working — exactly the graceful
 * degradation Requirements 8.7 and 9.2 mandate when a device has no active
 * `Push_Registration`.
 *
 * The check compares against `expo-constants`' `executionEnvironment`. Expo Go
 * reports the `storeClient` environment; a development build reports `bare` and
 * a production build reports `standalone`. The string literal is compared
 * directly (rather than importing the `ExecutionEnvironment` enum) so unit
 * tests that mock `expo-constants` with a minimal `default` export — where the
 * named enum export is absent — still resolve the check to "supported" and keep
 * exercising the full flow.
 */

import Constants from 'expo-constants';

/** `expo-constants` `executionEnvironment` value reported by Expo Go. */
const EXPO_GO_ENVIRONMENT = 'storeClient';

/**
 * True when the current runtime supports remote push notifications — i.e. any
 * environment other than Expo Go. In Expo Go this returns `false` so callers
 * skip all `expo-notifications` remote-push usage instead of crashing.
 */
export function remotePushSupported(): boolean {
  return Constants.executionEnvironment !== EXPO_GO_ENVIRONMENT;
}
