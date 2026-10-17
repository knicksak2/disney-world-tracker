/**
 * Property-based test for booking tap state reducer and store (Task 11.10).
 *
 * Validates: Requirements 10.2, 10.3, 10.8
 */

import fc from 'fast-check';

import {
  bookingTapReducer,
  dispatchBookingTapEvent,
  getBookingTapState,
  initialBookingTapState,
  resetBookingTapStateForTest,
  subscribeBookingTapState,
  type BookingTapState,
} from '../bookingTapState';

type SimAction =
  | { readonly type: 'tap'; readonly tripId: string | null }
  | { readonly type: 'otherTap' }
  | { readonly type: 'authFailed' }
  | { readonly type: 'authenticated' };

describe('bookingTapState (Property 40)', () => {
  beforeEach(() => {
    resetBookingTapStateForTest();
  });

  // Feature: trip-booking-timeline, Property 40: A held booking tap navigates at most once, only after sign-in, never after an auth failure
  test('Property 40: navigation invariants under arbitrary action sequences', () => {
    const actionArb = fc.oneof(
      fc.record({
        type: fc.constant('tap' as const),
        tripId: fc.oneof(fc.uuid(), fc.constant(null)),
      }),
      fc.constant({ type: 'otherTap' as const }),
      fc.constant({ type: 'authFailed' as const }),
      fc.constant({ type: 'authenticated' as const }),
    );

    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(actionArb, { minLength: 1, maxLength: 50 }),
        (initialAuth, actions: readonly SimAction[]) => {
          let state: BookingTapState = initialBookingTapState;
          let isAuth = initialAuth;
          const navigations: (string | null)[] = [];
          let tapsCount = 0;

          // Helper simulating the flush step when auth state is true and pending tap exists
          const tryFlush = () => {
            if (isAuth && state.pending !== null) {
              navigations.push(state.pending.tripId);
              state = bookingTapReducer(state, { type: 'delivered' });
            }
          };

          for (const action of actions) {
            switch (action.type) {
              case 'tap': {
                tapsCount++;
                state = bookingTapReducer(state, { type: 'tap', tripId: action.tripId });
                tryFlush();
                break;
              }
              case 'otherTap': {
                state = bookingTapReducer(state, { type: 'otherTap' });
                break;
              }
              case 'authFailed': {
                isAuth = false;
                state = bookingTapReducer(state, { type: 'authFailed' });
                break;
              }
              case 'authenticated': {
                isAuth = true;
                tryFlush();
                break;
              }
            }
          }

          // Invariant 1: At most one navigation per tap
          expect(navigations.length).toBeLessThanOrEqual(tapsCount);

          // Invariant 2: If auth is false, state cannot have navigated without an authenticated event
          if (!initialAuth && !actions.some((a) => a.type === 'authenticated')) {
            expect(navigations.length).toBe(0);
          }

          // Invariant 3: After authFailed or otherTap, pending is always null until next tap
          const lastAction = actions[actions.length - 1];
          if (lastAction && (lastAction.type === 'authFailed' || lastAction.type === 'otherTap')) {
            expect(state.pending).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test('direct unit behaviors: tap replacement, auth failure cancellation, delivered clearance', () => {
    let s: BookingTapState = initialBookingTapState;

    // 1. A new tap replaces an earlier pending one
    s = bookingTapReducer(s, { type: 'tap', tripId: 'trip-1' });
    expect(s.pending).toEqual({ tripId: 'trip-1' });
    s = bookingTapReducer(s, { type: 'tap', tripId: 'trip-2' });
    expect(s.pending).toEqual({ tripId: 'trip-2' });

    // 2. authFailed clears pending
    s = bookingTapReducer(s, { type: 'authFailed' });
    expect(s.pending).toBeNull();

    // 3. otherTap clears pending
    s = bookingTapReducer(s, { type: 'tap', tripId: 'trip-3' });
    expect(s.pending).toEqual({ tripId: 'trip-3' });
    s = bookingTapReducer(s, { type: 'otherTap' });
    expect(s.pending).toBeNull();

    // 4. delivered clears pending
    s = bookingTapReducer(s, { type: 'tap', tripId: 'trip-4' });
    expect(s.pending).toEqual({ tripId: 'trip-4' });
    s = bookingTapReducer(s, { type: 'delivered' });
    expect(s.pending).toBeNull();
  });

  test('module store subscription and dispatching', () => {
    resetBookingTapStateForTest();
    expect(getBookingTapState().pending).toBeNull();

    const seen: BookingTapState[] = [];
    const unsubscribe = subscribeBookingTapState((state) => {
      seen.push(state);
    });

    dispatchBookingTapEvent({ type: 'tap', tripId: 'trip-123' });
    expect(getBookingTapState().pending).toEqual({ tripId: 'trip-123' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.pending).toEqual({ tripId: 'trip-123' });

    dispatchBookingTapEvent({ type: 'authFailed' });
    expect(getBookingTapState().pending).toBeNull();
    expect(seen).toHaveLength(2);
    expect(seen[1]?.pending).toBeNull();

    unsubscribe();
    dispatchBookingTapEvent({ type: 'tap', tripId: 'trip-456' });
    // Subscriber was unsubscribed, so seen count doesn't increment
    expect(seen).toHaveLength(2);
    expect(getBookingTapState().pending).toEqual({ tripId: 'trip-456' });
  });
});
