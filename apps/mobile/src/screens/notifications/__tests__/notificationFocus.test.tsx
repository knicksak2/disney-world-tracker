/**
 * NotificationCenterScreen push-focus surfacing — example tests (task 16.3).
 *
 * Validates: Requirements 13.2, 13.3
 *
 * When the Notification_Center is opened from a tapped push (task 16.1), the
 * screen receives a `focusRef` route param naming the referenced item. Once the
 * feed has settled it resolves that reference two ways:
 *
 *   - **R13.2** — a still-pending referenced item is surfaced/highlighted so its
 *     Inline_Action is easy to find. The focused row renders the
 *     `attention-row-highlighted-{id}` marker, and no "no longer available"
 *     indication is shown.
 *   - **R13.3** — a referenced item that is no longer pending/available (the
 *     `focusRef` matches nothing in the settled feed) shows the
 *     `notification-focus-unavailable` indication while the rest of the feed
 *     still opens.
 *
 * Mocking mirrors the sibling `NotificationCenterScreen` presentation suite:
 * `useRoute` supplies the push `focusRef`, the two feature hooks
 * (`useAttention`, `useAttentionActions`) are programmed per scenario, and
 * `useNavigation` is a shared spy. The screen's `useQueryClient()` runs for real
 * under a `QueryClientProvider`.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type {
  AttentionDomain,
  AttentionItem,
  AttentionItemRef,
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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// `useRoute` carries the push `focusRef` into the screen; `useNavigation` is a
// shared spy. Both are programmed per scenario.
const mockNavigate = jest.fn();
const mockRouteParams = jest.fn<{ focusRef?: AttentionItemRef } | undefined, []>(
  () => undefined,
);
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: mockRouteParams() }),
}));

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

/** A trip-invite Attention_Item referenced by `inviteId`. */
function tripInviteItem(inviteId: string): AttentionItem {
  return {
    domain: 'tripInvite',
    id: `item-${inviteId}`,
    sourceTimestamp: TIMESTAMP,
    summary: 'Goofy invited you to a trip',
    ref: { inviteId },
  };
}

function success(
  domain: AttentionDomain,
  items: readonly AttentionItem[] = [],
): AttentionSourceOutcome {
  return { domain, status: 'success', items };
}

const ALL_DOMAINS: readonly AttentionDomain[] = [
  'friendRequest',
  'tripInvite',
  'rodeWithTag',
  'share',
];

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

function programAttention(result: {
  state: AttentionState;
  outcomes: readonly AttentionSourceOutcome[];
  inFlight: boolean;
}): void {
  mockUseAttention.mockImplementation((sortMode: SortMode) => ({
    state: result.state,
    outcomes: result.outcomes,
    inFlight: result.inFlight,
    sources: {} as never,
    retryFailed: jest.fn(),
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

describe('NotificationCenterScreen push-focus surfacing (R13.2, R13.3)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockRouteParams.mockReset();
    mockRouteParams.mockReturnValue(undefined);
    mockUseAttention.mockReset();
    mockUseAttentionActions.mockReset();
    mockUseAttentionActions.mockReturnValue(noopActions);
  });

  test('R13.2: a still-pending referenced item is surfaced/highlighted when the focusRef matches', async () => {
    const item = tripInviteItem('invite-1');
    // Opened from a tapped Trip_Invite push referencing this still-pending item.
    mockRouteParams.mockReturnValue({ focusRef: { inviteId: 'invite-1' } });
    programAttention({
      state: makeState({ items: [item] }),
      outcomes: [
        success('friendRequest'),
        success('tripInvite', [item]),
        success('rodeWithTag'),
        success('share'),
      ],
      inFlight: false,
    });

    renderScreen();

    // The referenced row is highlighted so its Inline_Action is easy to find,
    // and the "no longer available" indication is NOT shown (R13.2).
    await waitFor(() => {
      expect(
        screen.getByTestId(`attention-row-highlighted-${item.id}`),
      ).toBeTruthy();
    });
    expect(screen.queryByTestId('notification-focus-unavailable')).toBeNull();
  });

  test('R13.3: a stale referenced item shows the "no longer available" indication once the feed settles', async () => {
    const otherItem = tripInviteItem('invite-other');
    // Opened from a push referencing an item that is no longer pending: the
    // feed settled without a matching item.
    mockRouteParams.mockReturnValue({ focusRef: { inviteId: 'invite-gone' } });
    programAttention({
      state: makeState({ items: [otherItem] }),
      outcomes: [
        success('friendRequest'),
        success('tripInvite', [otherItem]),
        success('rodeWithTag'),
        success('share'),
      ],
      inFlight: false,
    });

    renderScreen();

    // The "no longer available" indication is shown (R13.3), while the rest of
    // the feed still opens (the unrelated item stays visible) and nothing is
    // highlighted.
    await waitFor(() => {
      expect(
        screen.getByTestId('notification-focus-unavailable'),
      ).toBeTruthy();
    });
    expect(
      screen.queryByTestId(`attention-row-highlighted-${otherItem.id}`),
    ).toBeNull();
    expect(screen.getByTestId(`attention-row-${otherItem.id}`)).toBeTruthy();
  });

  test('R13.3: the referenced item is not judged unavailable while the feed is still loading', () => {
    mockRouteParams.mockReturnValue({ focusRef: { inviteId: 'invite-1' } });
    // Feed still in flight — the screen must not prematurely report the item
    // unavailable before the reads settle.
    programAttention({
      state: makeState({ items: [] }),
      outcomes: [],
      inFlight: true,
    });

    renderScreen();

    expect(screen.getByTestId('notification-loading')).toBeTruthy();
    expect(screen.queryByTestId('notification-focus-unavailable')).toBeNull();
  });

  test('opened without a push focus (Profile entry) shows neither highlight nor unavailable indication', () => {
    // No focusRef → the full feed renders as usual.
    mockRouteParams.mockReturnValue(undefined);
    const item = tripInviteItem('invite-1');
    programAttention({
      state: makeState({ items: [item] }),
      outcomes: ALL_DOMAINS.map((domain) =>
        domain === 'tripInvite' ? success(domain, [item]) : success(domain),
      ),
      inFlight: false,
    });

    renderScreen();

    expect(screen.queryByTestId('notification-focus-unavailable')).toBeNull();
    expect(
      screen.queryByTestId(`attention-row-highlighted-${item.id}`),
    ).toBeNull();
    expect(screen.getByTestId(`attention-row-${item.id}`)).toBeTruthy();
  });
});
