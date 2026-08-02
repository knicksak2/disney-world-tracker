/**
 * NotificationCenterScreen presentation example tests (task 13.4).
 *
 * Validates: Requirements 1.7, 2.9, 8.2, 9.1, 9.5, 12.2
 *
 * The screen composes the read/action hook layer (`useAttention`,
 * `useAttentionActions`) and the pure view classifier into the single
 * Attention_Feed surface. These example tests drive the screen through its
 * presentation branches by mocking those two hooks (and `useNavigation`), so
 * each render exercises real screen logic — `classifyView`, the local sort
 * state, the partial/total-failure split, and the navigation dispatches — over
 * a controlled state:
 *
 *   - **R1.7** — the sort control (`notification-sort-toggle`) flips the local
 *     SortMode between timestamp-descending and group-by-domain, re-requesting
 *     the feed for the new mode.
 *   - **R9.1 / R9.5** — the loading / empty / error views render mutually
 *     exclusively (`notification-loading` / `notification-empty` /
 *     `notification-error`), driven by the classifier's inputs.
 *   - **R8.2** — the retry control (`notification-retry`) re-requests only the
 *     failed sources via the hook's `retryFailed`.
 *   - **R2.9 / R12.2** — the open-full-inbox control (`notification-open-inbox`)
 *     cross-navigates to the Share_Inbox on the Friends tab.
 *
 * Mocking mirrors the sibling screen tests: `expo-secure-store` /
 * `expo-constants` / `apiRequest` are stubbed (the real `ApiError` preserved),
 * the two feature hooks are replaced with `jest.fn()`s the tests program per
 * scenario, and `useNavigation` is replaced with a shared `navigate` spy. The
 * screen's `useQueryClient()` runs for real under a `QueryClientProvider`.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type {
  AttentionDomain,
  AttentionItem,
  AttentionSourceOutcome,
  AttentionState,
  SortMode,
} from '@dwt/shared';

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

// Preserve the real `ApiError`; stub only `apiRequest` (used solely by the
// Share "Open" destination-verify path, which these tests do not exercise).
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The screen reaches React Navigation only through `useNavigation`. A shared
// `navigate` spy (prefixed `mock` so the jest.mock factory may reference it)
// captures the open-full-inbox dispatch without a real navigator.
const mockNavigate = jest.fn();
// `useRoute` supplies the screen's route params; these presentation tests open
// the center from the Profile_Notifications_Entry (no push focus), so the
// default params carry no `focusRef` and the full feed renders as usual. The
// push-focus surfacing branches (R13.2/R13.3) are covered by the dedicated
// `notificationFocus` suite.
const mockUseRoute = jest.fn(() => ({ params: {} }));
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => mockUseRoute(),
}));

// The two feature hooks are the seams these tests drive. Each is a `jest.fn()`
// programmed per scenario in `beforeEach` / individual tests.
const mockUseAttention = jest.fn();
jest.mock('../../../features/notifications/useAttention', () => ({
  __esModule: true,
  useAttention: (sortMode: SortMode) => mockUseAttention(sortMode),
}));

const mockUseAttentionActions = jest.fn();
jest.mock('../../../features/notifications/useAttentionActions', () => ({
  __esModule: true,
  useAttentionActions: () => mockUseAttentionActions(),
}));

// ---------------------------------------------------------------------------
// Imports of the module under test (after the mocks above).
// ---------------------------------------------------------------------------

import NotificationCenterScreen from '../NotificationCenterScreen';

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const TIMESTAMP = '2024-05-01T12:00:00.000Z';

function friendRequestItem(id = 'fr-1'): AttentionItem {
  return {
    domain: 'friendRequest',
    id,
    sourceTimestamp: TIMESTAMP,
    summary: 'Minnie Mouse sent you a friend request',
    ref: { requestId: id },
  };
}

/** A success outcome carrying the given items for a domain. */
function success(
  domain: AttentionDomain,
  items: readonly AttentionItem[] = [],
): AttentionSourceOutcome {
  return { domain, status: 'success', items };
}

/** A failure outcome for a domain. */
function failure(domain: AttentionDomain): AttentionSourceOutcome {
  return { domain, status: 'failure' };
}

const ALL_DOMAINS: readonly AttentionDomain[] = [
  'friendRequest',
  'tripInvite',
  'rodeWithTag',
  'share',
];

/** Build an `AttentionState` with sensible defaults for the given items. */
function makeState(overrides: Partial<AttentionState> = {}): AttentionState {
  const items = overrides.items ?? [];
  return {
    items,
    badgeCount: items.length,
    badgeDisplay: items.length === 0 ? 'hidden' : 'count',
    failedDomains: [],
    allFailed: false,
    ...overrides,
  };
}

const noopActions = {
  acceptFriendRequest: jest.fn(),
  declineFriendRequest: jest.fn(),
  acceptTripInvite: jest.fn(),
  declineTripInvite: jest.fn(),
  confirmRodeWithTag: jest.fn(),
  declineRodeWithTag: jest.fn(),
  markShareRead: jest.fn(),
  errors: {},
  pendingItemIds: new Set<string>(),
  clearError: jest.fn(),
};

/**
 * Program `useAttention` to return a fixed result. `retryFailed` is a shared
 * spy so a test can assert the retry control invoked it.
 */
function programAttention(result: {
  state: AttentionState;
  outcomes: readonly AttentionSourceOutcome[];
  inFlight: boolean;
  retryFailed: jest.Mock;
}): void {
  mockUseAttention.mockImplementation((sortMode: SortMode) => ({
    state: result.state,
    outcomes: result.outcomes,
    inFlight: result.inFlight,
    sources: {} as never,
    retryFailed: result.retryFailed,
    // Echo the sort mode the screen asked for so a test can assert the toggle.
    __sortMode: sortMode,
  }));
}

function renderScreen(): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotificationCenterScreen />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('NotificationCenterScreen presentation (R1.7, R2.9, R8.2, R9.1, R9.5, R12.2)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseAttention.mockReset();
    mockUseAttentionActions.mockReset();
    mockUseAttentionActions.mockReturnValue(noopActions);
  });

  // -------------------------------------------------------------------------
  // R1.7 — sort control toggles the SortMode
  // -------------------------------------------------------------------------
  test('R1.7: the sort toggle flips the SortMode and re-requests the feed', () => {
    const item = friendRequestItem();
    programAttention({
      state: makeState({ items: [item] }),
      outcomes: [
        success('friendRequest', [item]),
        success('tripInvite'),
        success('rodeWithTag'),
        success('share'),
      ],
      inFlight: false,
      retryFailed: jest.fn(),
    });

    renderScreen();

    // Default mode is timestamp-descending → "Sort: Newest".
    const toggle = screen.getByTestId('notification-sort-toggle');
    expect(screen.getByText('Sort: Newest')).toBeTruthy();
    expect(mockUseAttention).toHaveBeenCalledWith('timestampDesc');

    // Pressing the toggle flips local state to group-by-domain and the screen
    // re-requests the feed for that mode (R1.7).
    fireEvent.press(toggle);
    expect(screen.getByText('Sort: By type')).toBeTruthy();
    expect(mockUseAttention).toHaveBeenCalledWith('groupByDomain');

    // Pressing again flips back to timestamp-descending.
    fireEvent.press(screen.getByTestId('notification-sort-toggle'));
    expect(screen.getByText('Sort: Newest')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R9.1 / R9.5 — loading / empty / error render mutually exclusively
  // -------------------------------------------------------------------------
  test('R9.1/R9.5: loading view renders alone while a read is in flight', () => {
    programAttention({
      state: makeState(),
      outcomes: [],
      inFlight: true,
      retryFailed: jest.fn(),
    });

    renderScreen();

    expect(screen.getByTestId('notification-loading')).toBeTruthy();
    expect(screen.queryByTestId('notification-empty')).toBeNull();
    expect(screen.queryByTestId('notification-error')).toBeNull();
    // Controls are hidden while loading.
    expect(screen.queryByTestId('notification-sort-toggle')).toBeNull();
  });

  test('R9.1/R9.5: empty view renders alone when all sources succeed with zero items', () => {
    programAttention({
      state: makeState({ items: [] }),
      outcomes: ALL_DOMAINS.map((domain) => success(domain)),
      inFlight: false,
      retryFailed: jest.fn(),
    });

    renderScreen();

    expect(screen.getByTestId('notification-empty')).toBeTruthy();
    expect(screen.queryByTestId('notification-loading')).toBeNull();
    expect(screen.queryByTestId('notification-error')).toBeNull();
  });

  test('R9.1/R9.5: error view renders alone on total failure', () => {
    programAttention({
      state: makeState({
        items: [],
        failedDomains: ALL_DOMAINS,
        allFailed: true,
      }),
      outcomes: ALL_DOMAINS.map((domain) => failure(domain)),
      inFlight: false,
      retryFailed: jest.fn(),
    });

    renderScreen();

    expect(screen.getByTestId('notification-error')).toBeTruthy();
    expect(screen.queryByTestId('notification-loading')).toBeNull();
    expect(screen.queryByTestId('notification-empty')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R8.2 — retry re-requests only the failed sources
  // -------------------------------------------------------------------------
  test('R8.2: the partial-failure retry control invokes retryFailed', () => {
    const retryFailed = jest.fn();
    const item = friendRequestItem();
    programAttention({
      // Partial failure: the friend-request source loaded, the trip-invite
      // source failed. The successfully loaded item stays in the feed and a
      // banner names the failed domain with a retry control.
      state: makeState({
        items: [item],
        failedDomains: ['tripInvite'],
        allFailed: false,
      }),
      outcomes: [
        success('friendRequest', [item]),
        failure('tripInvite'),
        success('rodeWithTag'),
        success('share'),
      ],
      inFlight: false,
      retryFailed,
    });

    renderScreen();

    // The partial-failure banner and its retry control render alongside the
    // still-loaded feed (not the total-failure error view).
    expect(screen.getByTestId('notification-failure-banner')).toBeTruthy();
    expect(screen.queryByTestId('notification-error')).toBeNull();

    fireEvent.press(screen.getByTestId('notification-retry'));
    expect(retryFailed).toHaveBeenCalledTimes(1);
  });

  test('R8.2: the total-failure retry control invokes retryFailed', () => {
    const retryFailed = jest.fn();
    programAttention({
      state: makeState({
        items: [],
        failedDomains: ALL_DOMAINS,
        allFailed: true,
      }),
      outcomes: ALL_DOMAINS.map((domain) => failure(domain)),
      inFlight: false,
      retryFailed,
    });

    renderScreen();

    fireEvent.press(screen.getByTestId('notification-retry'));
    expect(retryFailed).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // R2.9 / R12.2 — open-full-inbox control cross-navigates to the Share_Inbox
  // -------------------------------------------------------------------------
  test('R2.9/R12.2: the open-full-inbox control navigates to Friends → Inbox', () => {
    programAttention({
      state: makeState({ items: [] }),
      outcomes: ALL_DOMAINS.map((domain) => success(domain)),
      inFlight: false,
      retryFailed: jest.fn(),
    });

    renderScreen();

    fireEvent.press(screen.getByTestId('notification-open-inbox'));
    expect(mockNavigate).toHaveBeenCalledWith('Friends', { screen: 'Inbox' });
  });
});
