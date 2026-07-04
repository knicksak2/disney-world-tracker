/**
 * ShareComposerScreen state tests (task 5.6).
 *
 * Validates: Requirements 2.9, 2.10, 2.11, 2.12, 2.13
 *
 * These example-based tests pin the Share_Composer's submission lifecycle and
 * error mapping — the UI-timing and message-mapping behavior that the pure
 * property tests (send-gating in `sendControlGating.prop.test.tsx`, body
 * composition in `submittedBodyComposition.prop.test.tsx`) deliberately leave
 * to example coverage:
 *
 *   - **Submitting state (R2.9).** While a `POST /me/shares` submission is in
 *     flight the Send control shows its loading indication and is disabled, and
 *     a second press never dispatches a second submission.
 *
 *   - **Success-then-return (R2.10).** On a successful delivery the composer
 *     shows a "Sent" indication and, exactly 250 ms later, returns the User to
 *     the originating screen via `goBack()` — driven here with fake timers so
 *     the pre-250 ms and post-250 ms moments are both asserted.
 *
 *   - **Mapped error messages (R2.11, R2.12, R2.13).** A `share_recipient_
 *     count_invalid` rejection maps to the 1–50 message, a `share_atomic_
 *     rejected` rejection to the no-longer-friends message, and any other
 *     failure to the generic retry message; none returns the User to the
 *     previous screen, and the generic failure retains the recipient selection.
 *
 * Mocking mirrors the sibling screen tests (`composerEntryPointOnly`): only the
 * lowest-level `apiRequest` is stubbed while the real `ApiError` is preserved so
 * the screen's `mapServerError` branches resolve against the genuine class. The
 * screen receives its `navigation`/`route` as props (it does not reach for the
 * React Navigation hooks), so an explicit navigation stub captures `goBack()`.
 */

import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks (declared before the module under test is imported).
// ---------------------------------------------------------------------------

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; keep the real `ApiError` (and everything else) so
// the screen's `instanceof`/`err.code` branches resolve against the genuine
// class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of the module under test (after the mocks above).
// ---------------------------------------------------------------------------

import ShareComposerScreen from '../ShareComposerScreen';
import { ApiError, apiRequest } from '../../../api/client';
import type { ShareComposerParams } from '../../../navigation/RootNavigator';

const apiRequestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

// ---------------------------------------------------------------------------
// Expected user-facing copy (must match ShareComposerScreen exactly).
// ---------------------------------------------------------------------------

const ERROR_RECIPIENT_COUNT = 'Pick between 1 and 50 friends.';
const ERROR_ATOMIC_REJECTED =
  'Some recipients are no longer your friends. Refresh and try again.';
const ERROR_GENERIC = 'Couldn\u2019t send right now. Try again.';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRIEND = {
  userId: 'friend-123',
  displayName: 'Minnie Mouse',
  avatarUrl: null,
  establishedAt: '2024-01-02T00:00:00Z',
} as const;

const FRIENDS_RESPONSE = {
  friends: [FRIEND],
  incomingRequests: [],
  outgoingRequests: [],
} as const;

const EXPERIENCE_PARAMS: ShareComposerParams = {
  kind: 'experience',
  experienceId: 'exp-777',
  experienceName: 'Space Mountain',
  park: 'Magic Kingdom',
  category: 'Ride',
  rating: 8,
  note: 'Loved it',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** A navigation stub capturing the calls the composer makes. */
function makeNavigation() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: jest.fn(() => true),
    setOptions: jest.fn(),
    addListener: jest.fn(() => () => undefined),
  };
}

function renderComposer(
  navigation: ReturnType<typeof makeNavigation>,
  params: ShareComposerParams = EXPERIENCE_PARAMS,
): ReturnType<typeof render> {
  const route = {
    key: 'ShareComposer-1',
    name: 'ShareComposer',
    params,
  };
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ShareComposerScreen
        navigation={navigation as never}
        route={route as never}
      />
    </QueryClientProvider>,
  );
}

/** Read the disabled flag off the Send control's accessibility state. */
function sendDisabled(): boolean {
  const button = screen.getByLabelText('Send share');
  return button.props.accessibilityState?.disabled === true;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ShareComposerScreen submission states (R2.9–R2.13)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // R2.9 — Submitting state: loading indication + disabled + single-flight.
  // -------------------------------------------------------------------------
  test('shows a loading indication and disables Send while the submission is in flight (R2.9)', async () => {
    const posted = makeDeferred<{ shareId: string; deliveredTo: string[] }>();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') return FRIENDS_RESPONSE as never;
      if (path === '/me/shares') return posted.promise as never;
      throw new Error(`unexpected call to ${String(path)}`);
    });

    const navigation = makeNavigation();
    renderComposer(navigation);

    // Recipient picker resolves asynchronously; select the sole friend so the
    // count (1) is within [1, 50] and the Send control is enabled.
    fireEvent.press(await screen.findByText(FRIEND.displayName));
    expect(sendDisabled()).toBe(false);

    // Confirm the send: the `POST /me/shares` promise stays pending.
    fireEvent.press(screen.getByLabelText('Send share'));

    // While in flight the control is disabled (R2.9) and shows its loading
    // indication in place of the "Send" label.
    await waitFor(() => expect(sendDisabled()).toBe(true));
    expect(screen.queryByText('Send')).toBeNull();

    // A second press must not dispatch a second submission (single-flight).
    fireEvent.press(screen.getByLabelText('Send share'));
    const postCalls = apiRequestMock.mock.calls.filter(
      (call) => call[1] === '/me/shares',
    );
    expect(postCalls).toHaveLength(1);

    // Settle the in-flight request so no act warning trails the test.
    await act(async () => {
      posted.resolve({ shareId: 's1', deliveredTo: [FRIEND.userId] });
    });
  });

  // -------------------------------------------------------------------------
  // R2.10 — Success indication for 250 ms, then goBack().
  // -------------------------------------------------------------------------
  test('shows a success indication then returns to the previous screen after 250 ms (R2.10)', async () => {
    const posted = makeDeferred<{ shareId: string; deliveredTo: string[] }>();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') return FRIENDS_RESPONSE as never;
      if (path === '/me/shares') return posted.promise as never;
      throw new Error(`unexpected call to ${String(path)}`);
    });

    const navigation = makeNavigation();
    renderComposer(navigation);

    // Load the recipient picker under real timers, then select the recipient
    // and confirm the send. Switch to fake timers only to drive the 250 ms
    // success window deterministically.
    fireEvent.press(await screen.findByText(FRIEND.displayName));
    fireEvent.press(screen.getByLabelText('Send share'));

    jest.useFakeTimers();

    // Resolve the submission: onSuccess shows "Sent" and arms the 250 ms timer.
    await act(async () => {
      posted.resolve({ shareId: 's1', deliveredTo: [FRIEND.userId] });
    });
    expect(screen.getByText('Sent')).toBeTruthy();

    // Before the window elapses the User has NOT been returned.
    act(() => {
      jest.advanceTimersByTime(249);
    });
    expect(navigation.goBack).not.toHaveBeenCalled();

    // At 250 ms the composer returns to the originating screen exactly once.
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // R2.11 — Recipient-count rejection maps to the 1–50 message, stays put.
  // -------------------------------------------------------------------------
  test('maps share_recipient_count_invalid to the 1–50 message and stays on the composer (R2.11)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') return FRIENDS_RESPONSE as never;
      if (path === '/me/shares') {
        throw new ApiError({
          code: 'share_recipient_count_invalid',
          message: 'recipient count invalid',
          status: 400,
        });
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });

    const navigation = makeNavigation();
    renderComposer(navigation);

    fireEvent.press(await screen.findByText(FRIEND.displayName));
    fireEvent.press(screen.getByLabelText('Send share'));

    expect(await screen.findByText(ERROR_RECIPIENT_COUNT)).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // R2.12 — Non-friend rejection maps to the no-longer-friends message.
  // -------------------------------------------------------------------------
  test('maps share_atomic_rejected to the no-longer-friends message and stays on the composer (R2.12)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') return FRIENDS_RESPONSE as never;
      if (path === '/me/shares') {
        throw new ApiError({
          code: 'share_atomic_rejected',
          message: 'some recipients are no longer friends',
          status: 409,
        });
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });

    const navigation = makeNavigation();
    renderComposer(navigation);

    fireEvent.press(await screen.findByText(FRIEND.displayName));
    fireEvent.press(screen.getByLabelText('Send share'));

    expect(await screen.findByText(ERROR_ATOMIC_REJECTED)).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // R2.13 — Any other failure maps to the generic message and retains the
  // recipient selection.
  // -------------------------------------------------------------------------
  test('maps a generic failure to the retry message, stays put, and retains the selection (R2.13)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') return FRIENDS_RESPONSE as never;
      if (path === '/me/shares') {
        throw new ApiError({
          code: 'internal_error',
          message: 'boom',
          status: 500,
        });
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });

    const navigation = makeNavigation();
    renderComposer(navigation);

    fireEvent.press(await screen.findByText(FRIEND.displayName));
    // The single selection registers in the header subtitle.
    expect(screen.getByText('1/50 selected')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Send share'));

    expect(await screen.findByText(ERROR_GENERIC)).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();

    // R2.13: the recipient selection is retained across the failure, so the
    // User can retry without re-picking — the selection count is unchanged.
    expect(screen.getByText('1/50 selected')).toBeTruthy();
  });
});
