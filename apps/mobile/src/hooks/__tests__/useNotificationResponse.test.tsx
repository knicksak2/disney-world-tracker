/**
 * Notification tap deep-linking — hook unit tests (task 20.2).
 *
 * Validates: Requirements 10.1, 10.3, 10.5
 *
 * These tests exercise the root `useNotificationResponse` handler in isolation.
 * The handler's job is to turn a tapped Share push notification into a single
 * `navigateToInbox` dispatch, honoring authentication (R10.3) and the
 * foreground-navigation window (R10.1), and forwarding a resolvable `shareId`
 * so the Inbox can continue the deep link (or opening the Inbox with its
 * current contents when there is none, R10.5). The destination hop, read-state,
 * and "no longer available" message live in `InboxScreen` and are covered by
 * the `deepLinkNavigation` tests; here we only assert what the hook itself
 * dispatches.
 *
 *   - `expo-notifications` is mocked so we can drive both a cold-start tap
 *     (`getLastNotificationResponseAsync`) and a live tap
 *     (`addNotificationResponseReceivedListener`).
 *   - `navigateToInbox` (the shared navigation ref) is mocked so we can assert
 *     the exact params it is called with and simulate the container not being
 *     ready yet (returning `false`) to drive the R10.1 retry window.
 *   - The real `sessionStore` is used; we set its `token`/`hydrated` directly to
 *     model the authenticated / unauthenticated states.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type * as Notifications from 'expo-notifications';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// Prefixed with `mock` so Jest permits referencing them inside the hoisted
// `jest.mock` factories below.
const mockGetLastNotificationResponseAsync = jest.fn();
const mockAddNotificationResponseReceivedListener = jest.fn();
const mockRemoveSubscription = jest.fn();

jest.mock('expo-notifications', () => ({
  __esModule: true,
  getLastNotificationResponseAsync: (...args: unknown[]) =>
    mockGetLastNotificationResponseAsync(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) =>
    mockAddNotificationResponseReceivedListener(...args),
}));

const mockNavigateToInbox = jest.fn();

jest.mock('../../navigation/navigationRef', () => ({
  __esModule: true,
  navigateToInbox: (...args: unknown[]) => mockNavigateToInbox(...args),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import { useNotificationResponse, NAV_READY_POLL_MS } from '../useNotificationResponse';
import { useSessionStore } from '../../state/sessionStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a tapped-notification response carrying (or omitting) a `shareId`. */
function responseWith(
  data: Record<string, unknown> | null,
): Notifications.NotificationResponse {
  return {
    actionIdentifier: 'default',
    notification: {
      request: {
        content: { data },
      },
    },
  } as unknown as Notifications.NotificationResponse;
}

/**
 * Put the session store into an authenticated (or not) hydrated state. Wrapped
 * in `act` because the store update re-renders the mounted hook (its auth
 * effect re-runs the deferred-tap flush, R10.3).
 */
function setSession(opts: { token: string | null; hydrated: boolean }): void {
  act(() => {
    useSessionStore.setState({ token: opts.token, hydrated: opts.hydrated });
  });
}

/**
 * Grab the response-received listener registered by the hook so a test can
 * simulate a live (background/foreground) tap.
 */
function getRegisteredListener(): (
  response: Notifications.NotificationResponse,
) => void {
  const call = mockAddNotificationResponseReceivedListener.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('response-received listener was never registered');
  }
  return call[0] as (response: Notifications.NotificationResponse) => void;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useNotificationResponse — deep-link branches (R10.1, R10.3, R10.5)', () => {
  beforeEach(() => {
    mockGetLastNotificationResponseAsync.mockReset();
    mockAddNotificationResponseReceivedListener.mockReset();
    mockRemoveSubscription.mockReset();
    mockNavigateToInbox.mockReset();

    // Default: no cold-start tap, container is ready so a dispatch succeeds.
    mockGetLastNotificationResponseAsync.mockResolvedValue(null);
    mockAddNotificationResponseReceivedListener.mockReturnValue({
      remove: mockRemoveSubscription,
    });
    mockNavigateToInbox.mockReturnValue(true);
  });

  afterEach(() => {
    // Reset the shared session store between tests.
    setSession({ token: null, hydrated: false });
  });

  test('R10.1 cold start — a launch tap carrying a shareId navigates to the Inbox with that shareId', async () => {
    setSession({ token: 'auth-token', hydrated: true });
    mockGetLastNotificationResponseAsync.mockResolvedValue(
      responseWith({ shareId: 'share-cold-1' }),
    );

    renderHook(() => useNotificationResponse());

    await waitFor(() => {
      expect(mockNavigateToInbox).toHaveBeenCalledWith({
        shareId: 'share-cold-1',
      });
    });
  });

  test('R10.1 live tap — a background/foreground tap carrying a shareId navigates to the Inbox with that shareId', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ shareId: 'share-live-1' }));
    });

    await waitFor(() => {
      expect(mockNavigateToInbox).toHaveBeenCalledWith({
        shareId: 'share-live-1',
      });
    });
  });

  test('R10.5 — a tap with no resolvable shareId opens the Inbox with its current contents (no shareId forwarded)', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      // Payload present but carries no `shareId`.
      listener(responseWith({ some: 'other-data' }));
    });

    await waitFor(() => {
      expect(mockNavigateToInbox).toHaveBeenCalledTimes(1);
    });
    // Opened the Inbox with no destination hop: called with `undefined`.
    expect(mockNavigateToInbox).toHaveBeenCalledWith(undefined);
  });

  test('R10.5 — a tap whose payload is absent still opens the Inbox with no shareId', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith(null));
    });

    await waitFor(() => {
      expect(mockNavigateToInbox).toHaveBeenCalledWith(undefined);
    });
  });

  test('R10.3 — a tap while unauthenticated is held, then opens the Inbox after authentication', async () => {
    // Hydrated but signed out: the tap must be deferred, not dropped.
    setSession({ token: null, hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ shareId: 'share-deferred-1' }));
    });

    // No navigation while unauthenticated (R10.3).
    expect(mockNavigateToInbox).not.toHaveBeenCalled();

    // Authentication completes — the held tap now opens the Inbox.
    setSession({ token: 'auth-token', hydrated: true });

    await waitFor(() => {
      expect(mockNavigateToInbox).toHaveBeenCalledWith({
        shareId: 'share-deferred-1',
      });
    });
  });

  test('R10.1 — navigation is retried until the navigation container is ready within the foreground window', async () => {
    jest.useFakeTimers();
    try {
      setSession({ token: 'auth-token', hydrated: true });
      // Container not ready on the first attempt, ready on the retry.
      mockNavigateToInbox.mockReturnValueOnce(false).mockReturnValue(true);

      renderHook(() => useNotificationResponse());

      const listener = getRegisteredListener();
      act(() => {
        listener(responseWith({ shareId: 'share-retry-1' }));
      });

      // First attempt happened and returned "not ready".
      expect(mockNavigateToInbox).toHaveBeenCalledTimes(1);

      // Advance to the next readiness poll — the retry succeeds.
      act(() => {
        jest.advanceTimersByTime(NAV_READY_POLL_MS);
      });

      expect(mockNavigateToInbox).toHaveBeenCalledTimes(2);
      expect(mockNavigateToInbox).toHaveBeenLastCalledWith({
        shareId: 'share-retry-1',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
