/**
 * Unit tests for `usePushRegistration`, `invalidatePushRegistration`, and the
 * `getOrCreateDeviceId` device-id helper (task 18.2).
 *
 * Validates: Requirements 8.1, 8.4, 8.7, 8.8, 9.1, 9.2
 *
 * The hook owns the device-side push registration lifecycle. These tests drive
 * it through its collaborators, all of which are module-mocked so the flow is
 * observed without touching the OS, the secure store, or the network:
 *
 *   - `expo-notifications` — `getPermissionsAsync` / `requestPermissionsAsync`
 *     model the OS permission decision (R9.1, R9.2); `getExpoPushTokenAsync`
 *     mints the Expo `Push_Token` (R8.1).
 *   - `expo-secure-store` — an in-memory Map backs `getOrCreateDeviceId` so the
 *     persisted device installation id (R8.2) behaves realistically and can be
 *     asserted, while still resolving synchronously in tests.
 *   - `api/client#apiRequest` — the lowest-level network call, replaced with a
 *     spy so `POST`/`DELETE /me/push-registrations` are observable; the real
 *     `ApiError` is preserved.
 *
 * The retry timeline (R8.7) is exercised with fake timers so the inter-attempt
 * `RETRY_DELAY_MS` spacing advances without a real-time wait.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store`. `getOrCreateDeviceId` reads then writes the
// device id key, so a Map-backed stub lets the read-back return the value that
// was minted on first call. The real `api/sessionStorage` (imported
// transitively by the session store) also resolves against this stub.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (key: string) =>
      store.has(key) ? store.get(key) : null,
    ),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    // Exposed only for test setup/reset.
    __store: store,
  };
});

// `expo-notifications` — the permission + token surface the hook drives.
jest.mock('expo-notifications', () => ({
  __esModule: true,
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

// `expo-constants` supplies the API base URL (read by the real client at load
// time) and the EAS project id (read by the hook to mint a token).
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiBaseUrl: 'http://test.local',
        eas: { projectId: 'test-project' },
      },
    },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` so failure paths
// resolve against the genuine class.
jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { apiRequest as mockedApiRequest } from '../../api/client';
import { DEVICE_ID_KEY, getOrCreateDeviceId } from '../../api/deviceId';
import { useSessionStore } from '../../state/sessionStore';
import {
  MAX_REGISTRATION_RETRIES,
  RETRY_DELAY_MS,
  invalidatePushRegistration,
  usePushRegistration,
} from '../usePushRegistration';

// ---------------------------------------------------------------------------
// Typed mock handles
// ---------------------------------------------------------------------------

const getPermissionsMock =
  Notifications.getPermissionsAsync as jest.MockedFunction<
    typeof Notifications.getPermissionsAsync
  >;
const requestPermissionsMock =
  Notifications.requestPermissionsAsync as jest.MockedFunction<
    typeof Notifications.requestPermissionsAsync
  >;
const getExpoPushTokenMock =
  Notifications.getExpoPushTokenAsync as jest.MockedFunction<
    typeof Notifications.getExpoPushTokenAsync
  >;
const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

const secureStore = SecureStore as unknown as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
  __store: Map<string, string>;
};

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const EXPO_PUSH_TOKEN = 'ExponentPushToken[unit-test-token]';
const PUSH_PATH = '/me/push-registrations';
const UUID_V4_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Permission-query result shorthand; only `status` matters to the hook. */
function permission(status: 'granted' | 'denied' | 'undetermined') {
  return { status } as unknown as Notifications.NotificationPermissionsStatus;
}

/** Put the session store into an authenticated, hydrated state. */
function authenticate(): void {
  useSessionStore.setState({ token: 'session-token', hydrated: true });
}

beforeEach(() => {
  getPermissionsMock.mockReset();
  requestPermissionsMock.mockReset();
  getExpoPushTokenMock.mockReset();
  apiRequestMock.mockReset();
  secureStore.getItemAsync.mockClear();
  secureStore.setItemAsync.mockClear();
  secureStore.deleteItemAsync.mockClear();
  secureStore.__store.clear();

  // Sensible defaults; individual tests override the permission decision.
  getExpoPushTokenMock.mockResolvedValue({
    data: EXPO_PUSH_TOKEN,
  } as Awaited<ReturnType<typeof Notifications.getExpoPushTokenAsync>>);
  apiRequestMock.mockResolvedValue(null);

  useSessionStore.setState({ token: null, hydrated: false });
  jest.useRealTimers();
});

// ===========================================================================
// usePushRegistration
// ===========================================================================

describe('usePushRegistration', () => {
  test('R8.1: on an already-granted permission it obtains a token and registers it', async () => {
    getPermissionsMock.mockResolvedValue(permission('granted'));

    authenticate();
    const { unmount } = renderHook(() => usePushRegistration());

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledTimes(1);
    });

    // Permission was already granted, so it must NOT re-prompt (R9.1).
    expect(requestPermissionsMock).not.toHaveBeenCalled();
    expect(getExpoPushTokenMock).toHaveBeenCalledTimes(1);

    // Registers the freshly obtained token keyed by the persisted device id.
    expect(apiRequestMock).toHaveBeenCalledWith(
      'POST',
      PUSH_PATH,
      { deviceId: expect.stringMatching(UUID_V4_SHAPE), expoPushToken: EXPO_PUSH_TOKEN },
      expect.anything(),
    );

    unmount();
  });

  test('R9.1: when permission has never been requested it prompts, then registers on grant', async () => {
    getPermissionsMock.mockResolvedValue(permission('undetermined'));
    requestPermissionsMock.mockResolvedValue(permission('granted'));

    authenticate();
    const { unmount } = renderHook(() => usePushRegistration());

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledTimes(1);
    });

    expect(requestPermissionsMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      'POST',
      PUSH_PATH,
      expect.objectContaining({ expoPushToken: EXPO_PUSH_TOKEN }),
      expect.anything(),
    );

    unmount();
  });

  test('R9.2: a prior denial registers nothing and does not re-prompt', async () => {
    getPermissionsMock.mockResolvedValue(permission('denied'));

    authenticate();
    const { unmount } = renderHook(() => usePushRegistration());

    // Let the permission probe resolve and the flow settle.
    await waitFor(() => {
      expect(getPermissionsMock).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Denied: no re-prompt, no token, no registration — but the app continues.
    expect(requestPermissionsMock).not.toHaveBeenCalled();
    expect(getExpoPushTokenMock).not.toHaveBeenCalled();
    expect(apiRequestMock).not.toHaveBeenCalled();

    unmount();
  });

  test('R9.2: declining the permission prompt registers nothing and continues', async () => {
    getPermissionsMock.mockResolvedValue(permission('undetermined'));
    requestPermissionsMock.mockResolvedValue(permission('denied'));

    authenticate();
    const { unmount } = renderHook(() => usePushRegistration());

    await waitFor(() => {
      expect(requestPermissionsMock).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getExpoPushTokenMock).not.toHaveBeenCalled();
    expect(apiRequestMock).not.toHaveBeenCalled();

    unmount();
  });

  test('R8.7: a persistently failing registration retries 3 times then continues without registering', async () => {
    jest.useFakeTimers();
    try {
      getPermissionsMock.mockResolvedValue(permission('granted'));
      // Every registration attempt fails so the full retry budget is spent.
      apiRequestMock.mockRejectedValue(new Error('network down'));

      authenticate();
      const { unmount } = renderHook(() => usePushRegistration());

      // Advance past each inter-attempt delay. Advancing more than the budget
      // is harmless — no further timers remain once the loop gives up — and
      // the exact-count assertion below bounds the total attempts.
      await act(async () => {
        for (let i = 0; i < MAX_REGISTRATION_RETRIES + 3; i += 1) {
          await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
        }
      });

      // Initial attempt + 3 retries = 4 total; then it gives up (R8.7).
      expect(apiRequestMock).toHaveBeenCalledTimes(MAX_REGISTRATION_RETRIES + 1);
      expect(apiRequestMock.mock.calls.every(([method]) => method === 'POST')).toBe(
        true,
      );

      unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  test('R8.7: a retried registration that later succeeds stops retrying', async () => {
    jest.useFakeTimers();
    try {
      getPermissionsMock.mockResolvedValue(permission('granted'));
      // Fail the first attempt, then succeed on the first retry.
      apiRequestMock
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue(null);

      authenticate();
      const { unmount } = renderHook(() => usePushRegistration());

      await act(async () => {
        for (let i = 0; i < MAX_REGISTRATION_RETRIES + 3; i += 1) {
          await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
        }
      });

      // One failure + one success = 2 attempts; no further retries after success.
      expect(apiRequestMock).toHaveBeenCalledTimes(2);

      unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  test('does nothing while the session is unauthenticated', async () => {
    getPermissionsMock.mockResolvedValue(permission('granted'));
    useSessionStore.setState({ token: null, hydrated: true });

    const { unmount } = renderHook(() => usePushRegistration());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getPermissionsMock).not.toHaveBeenCalled();
    expect(apiRequestMock).not.toHaveBeenCalled();

    unmount();
  });
});

// ===========================================================================
// invalidatePushRegistration
// ===========================================================================

describe('invalidatePushRegistration', () => {
  test('R8.4: issues a DELETE for the current device registration', async () => {
    apiRequestMock.mockResolvedValue(null);

    await invalidatePushRegistration();

    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith('DELETE', PUSH_PATH, {
      deviceId: expect.stringMatching(UUID_V4_SHAPE),
    });
  });

  test('R8.8: a failed invalidation resolves without throwing so logout is never blocked', async () => {
    apiRequestMock.mockRejectedValue(new Error('server unavailable'));

    // The contract is fire-and-forget: it must resolve, never reject.
    await expect(invalidatePushRegistration()).resolves.toBeUndefined();
  });

  test('R8.8: a device-id read failure also resolves without throwing', async () => {
    secureStore.getItemAsync.mockRejectedValueOnce(new Error('keystore locked'));

    await expect(invalidatePushRegistration()).resolves.toBeUndefined();
    // The failure short-circuited before any network call.
    expect(apiRequestMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// getOrCreateDeviceId (R8.2)
// ===========================================================================

describe('getOrCreateDeviceId', () => {
  test('mints a v4-shaped id and persists it under the device-id key on first call', async () => {
    const id = await getOrCreateDeviceId();

    expect(id).toMatch(UUID_V4_SHAPE);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(DEVICE_ID_KEY, id);
    expect(secureStore.__store.get(DEVICE_ID_KEY)).toBe(id);
  });

  test('returns the persisted id on subsequent calls without minting a new one', async () => {
    secureStore.__store.set(DEVICE_ID_KEY, 'existing-device-id');

    const id = await getOrCreateDeviceId();

    expect(id).toBe('existing-device-id');
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  test('is stable across calls within an install', async () => {
    const first = await getOrCreateDeviceId();
    const second = await getOrCreateDeviceId();

    expect(second).toBe(first);
    // Minted exactly once — the second call read it back.
    expect(secureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });
});
