/**
 * Notification tap deep-linking — Booking timeline branches (Task 11.11).
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.5, 10.7, 15.4
 *
 * Tests the booking-timeline tap routing, earliest tap classification,
 * UUID validation, fallback to Trips list with notice on invalid/empty UUID,
 * and deferred authentication dispatch with cancellation on authFailed.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import fc from 'fast-check';
import type * as Notifications from 'expo-notifications';

// ---------------------------------------------------------------------------
// Mocks (declared before modules under test are imported)
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

const mockNavigateToBookingTimeline = jest.fn();
const mockNavigateToTripsList = jest.fn();
const mockSetTripsListNotice = jest.fn();
// Must NEVER be called for booking taps (R10.7):
const mockNavigateToNotificationCenter = jest.fn((..._args: unknown[]) => {
  throw new Error('navigateToNotificationCenter must NEVER be called for booking taps (R10.7)');
});
const mockNavigateToFoodListDetail = jest.fn();
const mockNavigateToExperienceListDetail = jest.fn();

jest.mock('../../navigation/navigationRef', () => ({
  __esModule: true,
  navigateToBookingTimeline: (...args: unknown[]) =>
    mockNavigateToBookingTimeline(...args),
  navigateToTripsList: (...args: unknown[]) =>
    mockNavigateToTripsList(...args),
  navigateToNotificationCenter: (...args: unknown[]) =>
    mockNavigateToNotificationCenter(...args),
  navigateToFoodListDetail: (...args: unknown[]) =>
    mockNavigateToFoodListDetail(...args),
  navigateToExperienceListDetail: (...args: unknown[]) =>
    mockNavigateToExperienceListDetail(...args),
}));

jest.mock('../../navigation/tripsListNotice', () => ({
  __esModule: true,
  setTripsListNotice: (...args: unknown[]) =>
    mockSetTripsListNotice(...args),
}));

// Attention badge mock that throws if called (R10.7)
const mockAttentionBadgeCall = jest.fn(() => {
  throw new Error('Attention badge must NEVER be touched for booking taps (R10.7)');
});

jest.mock('../../features/notifications/useAttentionBadge', () => ({
  __esModule: true,
  useAttentionBadge: () => {
    mockAttentionBadgeCall();
    return { display: 'hidden', count: 0 };
  },
}));

// ---------------------------------------------------------------------------
// Imports of modules under test
// ---------------------------------------------------------------------------

import {
  useNotificationResponse,
  classifyTap,
  extractBookingTap,
  NAV_READY_POLL_MS,
} from '../useNotificationResponse';
import {
  dispatchBookingTapEvent,
  resetBookingTapStateForTest,
  getBookingTapState,
} from '../../navigation/bookingTapState';
import { useSessionStore } from '../../state/sessionStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const VALID_UUID_1 = '12345678-1234-4234-8234-123456789abc';
const VALID_UUID_2 = 'abcdef01-2345-6789-abcd-ef0123456789';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('useNotificationResponseBooking (Tasks 11.11, Requirements 10.1-10.7)', () => {
  beforeEach(() => {
    mockGetLastNotificationResponseAsync.mockReset();
    mockAddNotificationResponseReceivedListener.mockReset();
    mockRemoveSubscription.mockReset();
    mockNavigateToBookingTimeline.mockReset();
    mockNavigateToTripsList.mockReset();
    mockSetTripsListNotice.mockReset();
    mockNavigateToNotificationCenter.mockClear();
    mockAttentionBadgeCall.mockClear();

    mockGetLastNotificationResponseAsync.mockResolvedValue(null);
    mockAddNotificationResponseReceivedListener.mockReturnValue({
      remove: mockRemoveSubscription,
    });
    mockNavigateToBookingTimeline.mockReturnValue(true);
    mockNavigateToTripsList.mockReturnValue(true);

    resetBookingTapStateForTest();
    setSession({ token: null, hydrated: false });
  });

  afterEach(() => {
    resetBookingTapStateForTest();
    setSession({ token: null, hydrated: false });
  });

  // -------------------------------------------------------------------------
  // Property 39: PBT
  // -------------------------------------------------------------------------

  test('Property 39: Tap classification routes booking taps and never leaks them to the Notification_Center', () => {
    // Feature: trip-booking-timeline, Property 39: Tap classification routes booking taps and never leaks them to the Notification_Center
    fc.assert(
      fc.property(
        fc.record({
          hasBookingTripId: fc.boolean(),
          bookingTripIdVal: fc.oneof(
            fc.uuid(),
            fc.constant(''),
            fc.string({ minLength: 1, maxLength: 50 }),
            fc.constant(null),
            fc.integer(),
          ),
          otherKeys: fc.dictionary(
            fc.constantFrom(
              'shareId',
              'tripInviteId',
              'rodeWithTagId',
              'tripLogEntryId',
              'friendRequestId',
              'foodListId',
              'experienceListId',
              'extra',
            ),
            fc.string({ minLength: 1, maxLength: 30 }),
          ),
        }),
        ({ hasBookingTripId, bookingTripIdVal, otherKeys }) => {
          const payload: Record<string, unknown> = { ...otherKeys };
          if (hasBookingTripId) {
            payload.bookingTripId = bookingTripIdVal;
          }

          const response = responseWith(payload);
          const classified = classifyTap(response);

          if (hasBookingTripId) {
            // Must classify as bookingReminder
            expect(classified.kind).toBe('bookingReminder');
            if (classified.kind === 'bookingReminder') {
              const isValidUuid =
                typeof bookingTripIdVal === 'string' &&
                UUID_REGEX.test(bookingTripIdVal);
              if (isValidUuid) {
                expect(classified.tripId).toBe(bookingTripIdVal);
              } else {
                expect(classified.tripId).toBeNull();
              }
            }
          } else {
            // Without bookingTripId, it must classify as one of the pre-existing types
            expect(classified.kind).not.toBe('bookingReminder');
            const expectedKinds = [
              'tripInvite',
              'rodeWithTag',
              'friendRequest',
              'foodListShare',
              'experienceListShare',
              'share',
            ];
            expect(expectedKinds).toContain(classified.kind);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  // -------------------------------------------------------------------------
  // Unit & Example Tests
  // -------------------------------------------------------------------------

  test('extractBookingTap returns valid UUID string or null when malformed or absent', () => {
    expect(extractBookingTap(responseWith({ bookingTripId: VALID_UUID_1 }))).toEqual({
      tripId: VALID_UUID_1,
    });
    expect(extractBookingTap(responseWith({ bookingTripId: '' }))).toEqual({
      tripId: null,
    });
    expect(extractBookingTap(responseWith({ bookingTripId: 'invalid-id' }))).toEqual({
      tripId: null,
    });
    expect(extractBookingTap(responseWith({ bookingTripId: 12345 }))).toEqual({
      tripId: null,
    });
    expect(extractBookingTap(responseWith({ bookingTripId: null }))).toEqual({
      tripId: null,
    });
    expect(extractBookingTap(responseWith({ otherKey: 'val' }))).toBeNull();
    expect(extractBookingTap(responseWith(null))).toBeNull();
  });

  test('Earliest match: booking tap takes precedence over tripInviteId, shareId, etc.', () => {
    const tap = classifyTap(
      responseWith({
        bookingTripId: VALID_UUID_1,
        tripInviteId: 'invite-999',
        shareId: 'share-888',
      }),
    );
    expect(tap).toEqual({
      kind: 'bookingReminder',
      tripId: VALID_UUID_1,
    });
  });

  test('R10.1: foreground / live tap with valid UUID navigates to BookingTimeline', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ bookingTripId: VALID_UUID_1 }));
    });

    await waitFor(() => {
      expect(mockNavigateToBookingTimeline).toHaveBeenCalledWith({
        tripId: VALID_UUID_1,
      });
    });

    expect(mockNavigateToNotificationCenter).not.toHaveBeenCalled();
    expect(mockAttentionBadgeCall).not.toHaveBeenCalled();
    expect(mockSetTripsListNotice).not.toHaveBeenCalled();
    expect(mockNavigateToTripsList).not.toHaveBeenCalled();
    expect(getBookingTapState().pending).toBeNull();
  });

  test('R10.1: cold-start tap with valid UUID navigates to BookingTimeline', async () => {
    setSession({ token: 'auth-token', hydrated: true });
    mockGetLastNotificationResponseAsync.mockResolvedValue(
      responseWith({ bookingTripId: VALID_UUID_2 }),
    );

    renderHook(() => useNotificationResponse());

    await waitFor(() => {
      expect(mockNavigateToBookingTimeline).toHaveBeenCalledWith({
        tripId: VALID_UUID_2,
      });
    });

    expect(mockNavigateToNotificationCenter).not.toHaveBeenCalled();
    expect(mockAttentionBadgeCall).not.toHaveBeenCalled();
  });

  test('R10.4, R10.5: malformed or empty bookingTripId redirects to TripsList with notice', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ bookingTripId: 'not-a-valid-uuid' }));
    });

    await waitFor(() => {
      expect(mockSetTripsListNotice).toHaveBeenCalledWith(
        'That booking timeline is no longer available.',
      );
      expect(mockNavigateToTripsList).toHaveBeenCalledTimes(1);
    });

    expect(mockNavigateToBookingTimeline).not.toHaveBeenCalled();
    expect(mockNavigateToNotificationCenter).not.toHaveBeenCalled();
    expect(mockAttentionBadgeCall).not.toHaveBeenCalled();
  });

  test('R10.5: empty bookingTripId ("") redirects to TripsList with notice', async () => {
    setSession({ token: 'auth-token', hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ bookingTripId: '' }));
    });

    await waitFor(() => {
      expect(mockSetTripsListNotice).toHaveBeenCalledWith(
        'That booking timeline is no longer available.',
      );
      expect(mockNavigateToTripsList).toHaveBeenCalledTimes(1);
    });

    expect(mockNavigateToBookingTimeline).not.toHaveBeenCalled();
  });

  test('R10.2: tap while unauthenticated is held and navigates once after sign-in', async () => {
    setSession({ token: null, hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ bookingTripId: VALID_UUID_1 }));
    });

    // Must NOT navigate while unauthenticated
    expect(mockNavigateToBookingTimeline).not.toHaveBeenCalled();
    expect(getBookingTapState().pending).toEqual({ tripId: VALID_UUID_1 });

    // User signs in
    setSession({ token: 'new-auth-token', hydrated: true });

    await waitFor(() => {
      expect(mockNavigateToBookingTimeline).toHaveBeenCalledWith({
        tripId: VALID_UUID_1,
      });
    });

    // Delivered event was dispatched: pending is cleared
    expect(getBookingTapState().pending).toBeNull();

    // Trigger another store update; should NOT navigate a second time
    mockNavigateToBookingTimeline.mockClear();
    setSession({ token: 'new-auth-token-2', hydrated: true });

    expect(mockNavigateToBookingTimeline).not.toHaveBeenCalled();
  });

  test('R10.3, R10.8: tap while unauthenticated is DISCARDED after authFailed (failed sign-in)', async () => {
    setSession({ token: null, hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ bookingTripId: VALID_UUID_1 }));
    });

    expect(mockNavigateToBookingTimeline).not.toHaveBeenCalled();
    expect(getBookingTapState().pending).toEqual({ tripId: VALID_UUID_1 });

    // Authentication failed (e.g. invalid password submitted or forgot password pressed)
    act(() => {
      dispatchBookingTapEvent({ type: 'authFailed' });
    });

    expect(getBookingTapState().pending).toBeNull();

    // A later successful sign-in in the same session must NOT navigate to the discarded tap
    setSession({ token: 'authenticated-token', hydrated: true });

    expect(mockNavigateToBookingTimeline).not.toHaveBeenCalled();
    expect(mockNavigateToTripsList).not.toHaveBeenCalled();
  });

  test('R10.1: navigation retries until container is ready within foreground timeout', async () => {
    jest.useFakeTimers();
    try {
      setSession({ token: 'auth-token', hydrated: true });
      mockNavigateToBookingTimeline
        .mockReturnValueOnce(false)
        .mockReturnValue(true);

      renderHook(() => useNotificationResponse());

      const listener = getRegisteredListener();
      act(() => {
        listener(responseWith({ bookingTripId: VALID_UUID_1 }));
      });

      // First call was not ready
      expect(mockNavigateToBookingTimeline).toHaveBeenCalledTimes(1);

      // Advance by NAV_READY_POLL_MS
      act(() => {
        jest.advanceTimersByTime(NAV_READY_POLL_MS);
      });

      // Second call succeeded
      expect(mockNavigateToBookingTimeline).toHaveBeenCalledTimes(2);
      expect(mockNavigateToBookingTimeline).toHaveBeenLastCalledWith({
        tripId: VALID_UUID_1,
      });
      expect(mockNavigateToNotificationCenter).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  test('New tap replaces previous pending tap (newest wins)', () => {
    setSession({ token: null, hydrated: true });

    renderHook(() => useNotificationResponse());

    const listener = getRegisteredListener();
    act(() => {
      listener(responseWith({ bookingTripId: VALID_UUID_1 }));
    });
    expect(getBookingTapState().pending).toEqual({ tripId: VALID_UUID_1 });

    act(() => {
      listener(responseWith({ bookingTripId: VALID_UUID_2 }));
    });
    expect(getBookingTapState().pending).toEqual({ tripId: VALID_UUID_2 });

    setSession({ token: 'auth-token', hydrated: true });

    expect(mockNavigateToBookingTimeline).toHaveBeenCalledTimes(1);
    expect(mockNavigateToBookingTimeline).toHaveBeenCalledWith({
      tripId: VALID_UUID_2,
    });
  });
});
