/**
 * Expo Go no-op regression tests for the push hooks.
 *
 * Since Expo SDK 53 removed remote push from Expo Go, `usePushRegistration`
 * and `useNotificationResponse` must NOT touch any `expo-notifications`
 * remote-push API when running inside Expo Go — otherwise the App crashes at
 * startup with a "[runtime not ready]" error. These tests pin that behavior by
 * mocking `expo-constants` to report the Expo Go environment
 * (`executionEnvironment: 'storeClient'`) and asserting the hooks make no
 * `expo-notifications` calls, while the rest of the App keeps working
 * (R8.7, R9.2).
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// Report the Expo Go execution environment so `remotePushSupported()` is false.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    executionEnvironment: 'storeClient',
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// Every remote-push API is a spy so the test can assert none are invoked.
jest.mock('expo-notifications', () => ({
  __esModule: true,
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

jest.mock('../../navigation/navigationRef', () => ({
  __esModule: true,
  navigateToInbox: jest.fn(() => true),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import * as Notifications from 'expo-notifications';

import { apiRequest as mockedApiRequest } from '../../api/client';
import { useSessionStore } from '../../state/sessionStore';
import { usePushRegistration } from '../usePushRegistration';
import { useNotificationResponse } from '../useNotificationResponse';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('push hooks in Expo Go (remote push unsupported)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSessionStore.setState({ token: null, hydrated: false });
  });

  test('usePushRegistration registers nothing even when authenticated', async () => {
    useSessionStore.setState({ token: 'session-token', hydrated: true });

    const { unmount } = renderHook(() => usePushRegistration());
    await flush();

    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(apiRequestMock).not.toHaveBeenCalled();

    unmount();
  });

  test('useNotificationResponse attaches no listener and reads no launch response', async () => {
    const { unmount } = renderHook(() => useNotificationResponse());
    await flush();

    expect(
      Notifications.getLastNotificationResponseAsync,
    ).not.toHaveBeenCalled();
    expect(
      Notifications.addNotificationResponseReceivedListener,
    ).not.toHaveBeenCalled();

    unmount();
  });
});
