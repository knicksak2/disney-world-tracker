/**
 * Pending booking tap state and module-level store (Task 11.10).
 *
 * Implements the pending tap state machine for booking notifications.
 * Ensures a held booking tap navigates at most once, only after successful sign-in,
 * and never after authentication fails or is cancelled.
 *
 * Validates: Requirements 10.2, 10.3, 10.8
 */

export type BookingTapState = {
  readonly pending: { readonly tripId: string | null } | null;
};

export type BookingTapEvent =
  | { type: 'tap'; tripId: string | null }
  | { type: 'otherTap' }
  | { type: 'authFailed' }
  | { type: 'delivered' };

export const initialBookingTapState: BookingTapState = { pending: null };

/**
 * Pure reducer for booking tap state transitions (R10.2, R10.3, R10.8).
 */
export function bookingTapReducer(
  _state: BookingTapState,
  event: BookingTapEvent,
): BookingTapState {
  switch (event.type) {
    case 'tap':
      return { pending: { tripId: event.tripId } };
    case 'otherTap':
    case 'authFailed':
    case 'delivered':
      return { pending: null };
  }
}

let currentState: BookingTapState = initialBookingTapState;
const listeners = new Set<(state: BookingTapState) => void>();

function emit(): void {
  for (const listener of listeners) {
    listener(currentState);
  }
}

export function getBookingTapState(): BookingTapState {
  return currentState;
}

export function dispatchBookingTapEvent(event: BookingTapEvent): void {
  currentState = bookingTapReducer(currentState, event);
  emit();
}

export function subscribeBookingTapState(
  listener: (state: BookingTapState) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetBookingTapStateForTest(): void {
  currentState = initialBookingTapState;
  listeners.clear();
}
