/**
 * Notification tap deep-linking — Trip branches (task 17.9).
 *
 * Validates: Requirements 18.2, 18.5
 *
 * These tests exercise the Trip-specific branches of the root
 * `useNotificationResponse` handler and the pure `classifyTap` helper:
 *
 *   - A Trip_Invite tap (payload `{ tripInviteId }`) classifies as `tripInvite`
 *     and routes to the invite accept/decline view via `navigateToTripInvite`
 *     (R18.2). This is the surface where the invited User accepts or declines.
 *   - A Rode_With_Tag tap (payload `{ rodeWithTagId, tripLogEntryId }`)
 *     classifies as `rodeWithTag` and routes to the tag confirm view via
 *     `navigateToRodeWithTag` (R18.3).
 *   - An unauthenticated Trip tap is held and, after authentication completes,
 *     opens its Trip deep-link target in the same session (R18.4).
 *   - The "no longer available" fallback (R18.5) is owned by the target screens
 *     when their read fails; the handler's sole job — asserted here — is to
 *     classify the tap and dispatch to the right Trip navigation helper.
 *
 * `expo-notifications` and the `navigationRef` helpers are mocked so we can
 * drive taps and assert the exact dispatch. The real `sessionStore` is used.
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

const mockNavigateToInbox = jest.fn();
const mockNavigateToFriendsList = jest.fn();
const mockNavigateToTripInvite = jest.fn();
const mockNavigateToRodeWithTag = jest.fn();

jest.mock('../../navigation/navigationRef', () => ({
  __esModule: true,
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
    mockNavigateToInbox.mockReset();
    mockNavigateToFriendsList.mockReset();
    mockNavigateToTripInvite.mockReset();
    mockNavigateToRodeWithTag.mockReset();

    mockGetLastNotificationResponseAsync.mockResolvedValue(null);
    mockAddNotificationResponseReceivedListener.mockReturnValue({
      remove: mockRemoveSubscription,
    });
    // Container ready so a dispatch succeeds on the first attempt.
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
      expect(mockNavigateToTripInvite).toHaveBeenCalledWith({
        tripInviteId: 'invite-abc',
      });
    });
    // The invite tap must not leak into the Share/friend routes.
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
      expect(mockNavigateToRodeWithTag).toHaveBeenCalledWith({
        rodeWithTagId: 'tag-abc',
        tripLogEntryId: 'entry-abc',
      });
    });
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
    expect(mockNavigateToTripInvite).not.toHaveBeenCalled();

    // Authentication completes — the held tap now opens the target.
    setSession({ token: 'auth-token', hydrated: true });

    await waitFor(() => {
      expect(mockNavigateToTripInvite).toHaveBeenCalledWith({
        tripInviteId: 'invite-deferred',
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
      expect(mockNavigateToTripInvite).toHaveBeenCalledWith({
        tripInviteId: 'invite-cold',
      });
    });
  });
});
