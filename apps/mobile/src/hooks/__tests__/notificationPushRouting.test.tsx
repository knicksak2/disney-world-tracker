/**
 * Push routing into the Notification_Center — example tests (task 16.3).
 *
 * Validates: Requirements 13.1, 13.4
 *
 * After the Notification_Center consolidation (task 16.1) the root
 * `useNotificationResponse` handler routes a tapped push for ALL FOUR supported
 * kinds — Friend_Request, Trip_Invite, Rode_With_Tag, and Share — to the single
 * Notification_Center via `navigateToNotificationCenter` (R13.1), and NO LONGER
 * to a per-domain standalone handler screen (R13.4). Each kind forwards the
 * identifiers it carries as a `focusRef` so the center can surface the
 * referenced Attention_Item (R13.2, owned by the screen and covered by the
 * `notificationFocus` suite):
 *
 *   - Friend_Request → opens the feed with no `focusRef` (the push carries no
 *     routing id).
 *   - Trip_Invite    → `focusRef: { inviteId }`.
 *   - Rode_With_Tag  → `focusRef: { tagId, tripLogEntryId }`.
 *   - Share          → `focusRef: { shareId }`.
 *
 * The whole `navigationRef` module is mocked: `navigateToNotificationCenter` is
 * the spy we assert the dispatch on, and the removed per-domain handlers
 * (`navigateToInbox`, `navigateToFriendsList`, `navigateToTripInvite`,
 * `navigateToRodeWithTag`) are kept as spies purely to assert they are NEVER
 * called for these taps (R13.4). `expo-notifications` is mocked so we can drive
 * a live (background/foreground) tap through the registered listener; the real
 * `sessionStore` is used, set to an authenticated hydrated state.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type * as Notifications from 'expo-notifications';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

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

const mockNavigateToNotificationCenter = jest.fn();
const mockNavigateToInbox = jest.fn();
const mockNavigateToFriendsList = jest.fn();
const mockNavigateToTripInvite = jest.fn();
const mockNavigateToRodeWithTag = jest.fn();

jest.mock('../../navigation/navigationRef', () => ({
  __esModule: true,
  navigateToNotificationCenter: (...args: unknown[]) =>
    mockNavigateToNotificationCenter(...args),
  navigateToInbox: (...args: unknown[]) => mockNavigateToInbox(...args),
  navigateToFriendsList: (...args: unknown[]) =>
    mockNavigateToFriendsList(...args),
  navigateToTripInvite: (...args: unknown[]) =>
    mockNavigateToTripInvite(...args),
  navigateToRodeWithTag: (...args: unknown[]) =>
    mockNavigateToRodeWithTag(...args),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import { useNotificationResponse } from '../useNotificationResponse';
import { useSessionStore } from '../../state/sessionStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function responseWith(
  data: Record<string, unknown> | null,
): Notifications.NotificationResponse {
  return {
    actionIdentifier: 'default',
    notification: { request: { content: { data } } },
  } as unknown as Notifications.NotificationResponse;
}

function setSession(opts: { token: string | null; hydrated: boolean }): void {
  act(() => {
    useSessionStore.setState({ token: opts.token, hydrated: opts.hydrated });
  });
}

function getRegisteredListener(): (
  response: Notifications.NotificationResponse,
) => void {
  const call = mockAddNotificationResponseReceivedListener.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('response-received listener was never registered');
  }
  return call[0] as (response: Notifications.NotificationResponse) => void;
}

/** Assert none of the removed per-domain handler screens were routed to. */
function expectNoStandaloneHandlerRouting(): void {
  expect(mockNavigateToInbox).not.toHaveBeenCalled();
  expect(mockNavigateToFriendsList).not.toHaveBeenCalled();
  expect(mockNavigateToTripInvite).not.toHaveBeenCalled();
  expect(mockNavigateToRodeWithTag).not.toHaveBeenCalled();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('push routing into the Notification_Center (R13.1, R13.4)', () => {
  beforeEach(() => {
    mockGetLastNotificationResponseAsync.mockReset();
    mockAddNotificationResponseReceivedListener.mockReset();
    mockRemoveSubscription.mockReset();
    mockNavigateToNotificationCenter.mockReset();
    mockNavigateToInbox.mockReset();
    mockNavigateToFriendsList.mockReset();
    mockNavigateToTripInvite.mockReset();
    mockNavigateToRodeWithTag.mockReset();

    // No cold-start tap; container ready so the first dispatch succeeds.
    mockGetLastNotificationResponseAsync.mockResolvedValue(null);
    mockAddNotificationResponseReceivedListener.mockReturnValue({
      remove: mockRemoveSubscription,
    });
    mockNavigateToNotificationCenter.mockReturnValue(true);
  });

  afterEach(() => {
    setSession({ token: null, hydrated: false });
  });

  test('R13.1/R13.4: a Friend_Request tap opens the Notification_Center (no focusRef) and no standalone handler', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ friendRequestId: 'fr-1' }));
    });

    await waitFor(() => {
      expect(mockNavigateToNotificationCenter).toHaveBeenCalledTimes(1);
    });
    // A friend-request push carries no routing id → the feed opens with no
    // focus target (called with no arguments).
    expect(mockNavigateToNotificationCenter).toHaveBeenCalledWith();
    expectNoStandaloneHandlerRouting();
  });

  test('R13.1/R13.4: a Trip_Invite tap opens the Notification_Center with focusRef {inviteId} and no standalone handler', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ tripInviteId: 'invite-1' }));
    });

    await waitFor(() => {
      expect(mockNavigateToNotificationCenter).toHaveBeenCalledWith({
        focusRef: { inviteId: 'invite-1' },
      });
    });
    expectNoStandaloneHandlerRouting();
  });

  test('R13.1/R13.4: a Rode_With_Tag tap opens the Notification_Center with focusRef {tagId, tripLogEntryId} and no standalone handler', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(
        responseWith({ rodeWithTagId: 'tag-1', tripLogEntryId: 'entry-1' }),
      );
    });

    await waitFor(() => {
      expect(mockNavigateToNotificationCenter).toHaveBeenCalledWith({
        focusRef: { tagId: 'tag-1', tripLogEntryId: 'entry-1' },
      });
    });
    expectNoStandaloneHandlerRouting();
  });

  test('R13.1/R13.4: a Share tap opens the Notification_Center with focusRef {shareId} and no standalone handler', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ shareId: 'share-1' }));
    });

    await waitFor(() => {
      expect(mockNavigateToNotificationCenter).toHaveBeenCalledWith({
        focusRef: { shareId: 'share-1' },
      });
    });
    expectNoStandaloneHandlerRouting();
  });
});
