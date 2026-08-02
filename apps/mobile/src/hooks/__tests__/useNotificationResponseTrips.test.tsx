/**
 * Notification tap deep-linking — Trip branches (task 17.9; routing target
 * updated for notification-center task 16.1/16.3).
 *
 * Validates: Requirements 18.2, 18.4, 13.1, 13.4
 *
 * These tests exercise the Trip-specific branches of the root
 * `useNotificationResponse` handler and the pure `classifyTap` helper. Following
 * the Notification_Center consolidation (task 16.1) a tapped Trip push now opens
 * the Notification_Center rather than a per-domain handler screen (R13.1,
 * R13.4); the handler classifies the tap and forwards the identifiers it carries
 * as a `focusRef` so the center can surface the referenced Attention_Item
 * (R13.2, owned by the screen):
 *
 *   - A Trip_Invite tap (payload `{ tripInviteId }`) classifies as `tripInvite`
 *     and opens the center with `focusRef: { inviteId }` — no longer the
 *     standalone `navigateToTripInvite` handler screen (R13.4).
 *   - A Rode_With_Tag tap (payload `{ rodeWithTagId, tripLogEntryId }`)
 *     classifies as `rodeWithTag` and opens the center with
 *     `focusRef: { tagId, tripLogEntryId }` — no longer the standalone
 *     `navigateToRodeWithTag` handler screen (R13.4).
 *   - An unauthenticated Trip tap is held and, after authentication completes,
 *     opens the Notification_Center in the same session (R18.4).
 *
 * `expo-notifications` and the `navigationRef` helpers are mocked so we can
 * drive taps and assert the exact dispatch; the removed per-domain handlers are
 * kept as spies to assert they are no longer called (R13.4). The real
 * `sessionStore` is used.
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
// The removed per-domain handlers are still mocked as spies so the tests can
// assert a Trip tap NO LONGER routes to a standalone handler screen (R13.4).
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

import {
  useNotificationResponse,
  classifyTap,
} from '../useNotificationResponse';
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

// ---------------------------------------------------------------------------
// Suite — pure classifier
// ---------------------------------------------------------------------------

describe('classifyTap — Trip kinds (R18.2, R18.3)', () => {
  test('a Trip_Invite payload classifies as a tripInvite tap carrying its id', () => {
    expect(classifyTap(responseWith({ tripInviteId: 'invite-1' }))).toEqual({
      kind: 'tripInvite',
      tripInviteId: 'invite-1',
    });
  });

  test('a Rode_With_Tag payload classifies as a rodeWithTag tap carrying both ids', () => {
    expect(
      classifyTap(
        responseWith({ rodeWithTagId: 'tag-1', tripLogEntryId: 'entry-1' }),
      ),
    ).toEqual({
      kind: 'rodeWithTag',
      rodeWithTagId: 'tag-1',
      tripLogEntryId: 'entry-1',
    });
  });

  test('the Trip_Invite kind takes precedence over a co-present shareId', () => {
    expect(
      classifyTap(
        responseWith({ tripInviteId: 'invite-1', shareId: 'share-9' }),
      ),
    ).toEqual({ kind: 'tripInvite', tripInviteId: 'invite-1' });
  });
});

// ---------------------------------------------------------------------------
// Suite — hook dispatch
// ---------------------------------------------------------------------------

describe('useNotificationResponse — Trip deep-link routing (R18.2, R18.4, R18.5)', () => {
  beforeEach(() => {
    mockGetLastNotificationResponseAsync.mockReset();
    mockAddNotificationResponseReceivedListener.mockReset();
    mockRemoveSubscription.mockReset();
    mockNavigateToNotificationCenter.mockReset();
    mockNavigateToInbox.mockReset();
    mockNavigateToFriendsList.mockReset();
    mockNavigateToTripInvite.mockReset();
    mockNavigateToRodeWithTag.mockReset();

    mockGetLastNotificationResponseAsync.mockResolvedValue(null);
    mockAddNotificationResponseReceivedListener.mockReturnValue({
      remove: mockRemoveSubscription,
    });
    // Container ready so a dispatch succeeds on the first attempt.
    mockNavigateToNotificationCenter.mockReturnValue(true);
    mockNavigateToTripInvite.mockReturnValue(true);
    mockNavigateToRodeWithTag.mockReturnValue(true);
    mockNavigateToInbox.mockReturnValue(true);
    mockNavigateToFriendsList.mockReturnValue(true);
  });

  afterEach(() => {
    setSession({ token: null, hydrated: false });
  });

  test('R18.2: a Trip_Invite tap routes to the invite accept/decline view with its tripInviteId', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ tripInviteId: 'invite-abc' }));
    });

    await waitFor(() => {
      expect(mockNavigateToNotificationCenter).toHaveBeenCalledWith({
        focusRef: { inviteId: 'invite-abc' },
      });
    });
    // The invite tap no longer routes to the standalone Trip_Invite handler
    // screen, nor leaks into the other per-domain routes (R13.4).
    expect(mockNavigateToTripInvite).not.toHaveBeenCalled();
    expect(mockNavigateToInbox).not.toHaveBeenCalled();
    expect(mockNavigateToRodeWithTag).not.toHaveBeenCalled();
  });

  test('R18.3: a Rode_With_Tag tap routes to the tag confirm view with both ids', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(
        responseWith({ rodeWithTagId: 'tag-abc', tripLogEntryId: 'entry-abc' }),
      );
    });

    await waitFor(() => {
      expect(mockNavigateToNotificationCenter).toHaveBeenCalledWith({
        focusRef: { tagId: 'tag-abc', tripLogEntryId: 'entry-abc' },
      });
    });
    // No longer routes to the standalone Rode_With_Tag handler screen (R13.4).
    expect(mockNavigateToRodeWithTag).not.toHaveBeenCalled();
    expect(mockNavigateToTripInvite).not.toHaveBeenCalled();
  });

  test('R18.4: a Trip_Invite tap while unauthenticated is held, then opens the invite view after authentication', async () => {
    // Hydrated but signed out — the tap must be deferred, not dropped.
    setSession({ token: null, hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ tripInviteId: 'invite-deferred' }));
    });

    // No navigation while unauthenticated (R7.8/R18.4).
    expect(mockNavigateToNotificationCenter).not.toHaveBeenCalled();

    // Authentication completes — the held tap now opens the Notification_Center.
    setSession({ token: 'auth-token', hydrated: true });

    await waitFor(() => {
      expect(mockNavigateToNotificationCenter).toHaveBeenCalledWith({
        focusRef: { inviteId: 'invite-deferred' },
      });
    });
  });

  test('R18.2 cold start: a launch tap on a Trip_Invite routes to the invite view', async () => {
    setSession({ token: 'auth-token', hydrated: true });
    mockGetLastNotificationResponseAsync.mockResolvedValue(
      responseWith({ tripInviteId: 'invite-cold' }),
    );

    renderHook(() => useNotificationResponse());

    await waitFor(() => {
      expect(mockNavigateToNotificationCenter).toHaveBeenCalledWith({
        focusRef: { inviteId: 'invite-cold' },
      });
    });
  });
});
