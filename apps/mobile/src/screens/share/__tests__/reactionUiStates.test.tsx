/**
 * Reaction UI-state unit tests (task 21.3).
 *
 * Validates: Requirements 11.9, 11.10, 11.11, 11.12
 *
 * These example-based tests pin the reaction UI states surfaced by the two
 * reaction surfaces added in tasks 21.1 and 21.2:
 *
 *   - The recipient's reaction controls on the Inbox share view
 *     (`InboxScreen` → `ShareReactions`), and
 *   - The sender's reaction list on the Sent Shares screen
 *     (`SentSharesScreen` → `ShareReactions`).
 *
 * Coverage:
 *   - **R11.9 (loading).** While a Share's reactions are being retrieved (Sent)
 *     or a submit/remove is in flight (Inbox), the surface shows a loading
 *     indication for that Share's reactions.
 *   - **R11.10 (empty).** When a Share has no reactions the surface shows an
 *     empty-state indication.
 *   - **R11.11 (unavailable).** When a Share's reaction state cannot be
 *     resolved the surface shows an unavailable message and keeps the
 *     remaining Share content visible.
 *   - **R11.12 (action failed, Inbox only).** A submit/remove failure that is
 *     NOT an authorization error (`reaction_forbidden`) shows a message,
 *     retains the Share view, and preserves the prior reaction state; an
 *     authorization error does NOT surface the generic message.
 *
 * Mocking mirrors the sibling Inbox tests: only the lowest-level `apiRequest`
 * is stubbed (routed by method + path) while the real `ApiError` is preserved
 * so the screen's `error.code` branches resolve against the genuine class. The
 * React Navigation hooks the Inbox depends on (`useNavigation`, `useRoute`)
 * are replaced so the screen renders standalone without mounting a navigator.
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

import type {
  InboxItemDTO,
  InboxResponse,
  SentShareDTO,
  ShareReactionDTO,
  ShareReactionValue,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
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
// the reaction mutations' `error.code` branches resolve against the genuine
// class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The Inbox screen calls `useNavigation()` (header back control) and
// `useRoute()` (optional deep-link `shareId`). These tests mount the screen
// standalone (no navigator), so stub both hooks. `useRoute` returns no params
// so the deep-link auto-tap-through never arms.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));

// ---------------------------------------------------------------------------
// Imports of the modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import InboxScreen from '../InboxScreen';
import SentSharesScreen from '../SentSharesScreen';
import { ApiError, apiRequest } from '../../../api/client';

const apiRequestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

// ---------------------------------------------------------------------------
// Expected user-facing copy (must match the screens exactly).
// ---------------------------------------------------------------------------

const REACTION_ACTION_FAILED_COPY =
  'Couldn\u2019t update your reaction. Please try again.';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SENDER_ID = 'sender-0001';
const SENDER_NAME = 'Minnie Mouse';

/** A `progress` inbox item — avoids the catalog metadata read entirely. */
function inboxProgressItem(
  shareId: string,
  myReaction: ShareReactionValue | null,
): InboxItemDTO {
  return {
    shareId,
    read: true,
    senderId: SENDER_ID,
    senderDisplayName: SENDER_NAME,
    payloadKind: 'progress',
    payload: {
      kind: 'progress',
      overallPercent: 42.5,
      perParkPercent: {},
      perCategoryPercent: {},
    },
    sentAt: '2024-01-02T03:04:05.000Z',
    myReaction,
  };
}

/**
 * A `progress` inbox item whose `myReaction` field is entirely absent — the
 * "reaction state cannot be resolved" shape that drives the unavailable state
 * (R11.11). The public DTO always carries the field, so build it without and
 * cast through `unknown`.
 */
function inboxItemWithoutReaction(shareId: string): InboxItemDTO {
  return {
    shareId,
    read: true,
    senderId: SENDER_ID,
    senderDisplayName: SENDER_NAME,
    payloadKind: 'progress',
    payload: {
      kind: 'progress',
      overallPercent: 42.5,
      perParkPercent: {},
      perCategoryPercent: {},
    },
    sentAt: '2024-01-02T03:04:05.000Z',
  } as unknown as InboxItemDTO;
}

function inboxResponse(items: InboxItemDTO[]): InboxResponse {
  const unread = items.reduce((acc, it) => (it.read ? acc : acc + 1), 0);
  return { unread, items };
}

/** A `progress` sent share — avoids the catalog metadata read entirely. */
function sentProgressShare(shareId: string): SentShareDTO {
  return {
    shareId,
    payloadKind: 'progress',
    payload: {
      kind: 'progress',
      overallPercent: 50,
      perParkPercent: {},
      perCategoryPercent: {},
    },
    sentAt: '2024-01-02T03:04:05.000Z',
  };
}

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
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderInbox(): void {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <InboxScreen />
    </QueryClientProvider>,
  );
}

/** A navigation stub for the Sent Shares screen's header back control. */
function makeNavigation() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: jest.fn(() => true),
    setOptions: jest.fn(),
    addListener: jest.fn(() => () => undefined),
  };
}

function renderSent(navigation: ReturnType<typeof makeNavigation>): void {
  const route = { key: 'Sent-1', name: 'Sent', params: undefined };
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <SentSharesScreen
        navigation={navigation as never}
        route={route as never}
      />
    </QueryClientProvider>,
  );
}

// ===========================================================================
// Inbox recipient reaction controls (R11.9–R11.12)
// ===========================================================================

describe('Inbox reaction controls UI states (R11.9–R11.12)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  // -------------------------------------------------------------------------
  // R11.9 — loading while a submit/remove is in flight.
  // -------------------------------------------------------------------------
  test('shows a loading indication while a reaction submit is in flight (R11.9)', async () => {
    const item = inboxProgressItem('share-load', null);
    const posted = makeDeferred<unknown>();
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/inbox') {
        return inboxResponse([item]) as never;
      }
      if (
        method === 'POST' &&
        path === `/me/inbox/${item.shareId}/reactions`
      ) {
        return posted.promise as never;
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderInbox();

    // Submit a reaction; the POST stays pending so the row is mid-flight.
    const chip = await screen.findByTestId(
      `inbox-reaction-chip-${item.shareId}-like`,
    );
    fireEvent.press(chip);

    // R11.9 — the loading indication for this Share's reactions appears.
    expect(
      await screen.findByTestId(`inbox-reaction-loading-${item.shareId}`),
    ).toBeTruthy();
    // The empty-state indication is not shown while a request is in flight.
    expect(
      screen.queryByTestId(`inbox-reaction-empty-${item.shareId}`),
    ).toBeNull();

    // Settle the request so no act warning trails the test.
    await act(async () => {
      posted.resolve(undefined);
    });
  }, 15000);

  // -------------------------------------------------------------------------
  // R11.10 — empty-state when no reaction is attached.
  // -------------------------------------------------------------------------
  test('shows an empty-state indication when the recipient has no reaction (R11.10)', async () => {
    const item = inboxProgressItem('share-empty', null);
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/inbox') {
        return inboxResponse([item]) as never;
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderInbox();

    // R11.10 — the empty-state indication is shown, and the chips are offered.
    expect(
      await screen.findByTestId(`inbox-reaction-empty-${item.shareId}`),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`inbox-reaction-chip-${item.shareId}-like`),
    ).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R11.11 — unavailable message, remaining Share content retained.
  // -------------------------------------------------------------------------
  test('shows an unavailable message and keeps the remaining Share content when the reaction state cannot be resolved (R11.11)', async () => {
    const item = inboxItemWithoutReaction('share-unavailable');
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/inbox') {
        return inboxResponse([item]) as never;
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderInbox();

    // R11.11 — the reaction-unavailable message appears.
    expect(
      await screen.findByTestId(`inbox-reaction-unavailable-${item.shareId}`),
    ).toBeTruthy();
    // The chips and empty state are not offered when the state is unresolved.
    expect(
      screen.queryByTestId(`inbox-reaction-chip-${item.shareId}-like`),
    ).toBeNull();
    // The remaining Share content stays visible: sender + progress content.
    expect(screen.getByTestId(`inbox-sender-${item.shareId}`)).toBeTruthy();
    expect(
      screen.getByTestId(`inbox-progress-overall-${item.shareId}`),
    ).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R11.12 — non-authorization failure: message + retained view + prior state.
  // -------------------------------------------------------------------------
  test('on a non-authorization failure shows a message, retains the Share view, and preserves the prior reaction (R11.12)', async () => {
    const item = inboxProgressItem('share-fail', 'like');
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/inbox') {
        return inboxResponse([item]) as never;
      }
      if (
        method === 'POST' &&
        path === `/me/inbox/${item.shareId}/reactions`
      ) {
        throw new ApiError({
          code: 'internal_error',
          message: 'boom',
          status: 500,
        });
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderInbox();

    // The prior reaction (`like`) is the active chip before the action.
    const likeChip = await screen.findByTestId(
      `inbox-reaction-chip-${item.shareId}-like`,
    );
    expect(likeChip.props.accessibilityLabel).toBe('Like, selected');

    // Attempt to replace it with `love`; the POST rejects with a
    // non-authorization error.
    fireEvent.press(
      screen.getByTestId(`inbox-reaction-chip-${item.shareId}-love`),
    );

    // R11.12 — the action-failed message appears.
    const message = await screen.findByTestId(
      `inbox-reaction-message-${item.shareId}`,
    );
    expect(message.props.children).toBe(REACTION_ACTION_FAILED_COPY);

    // R11.12 — the Share view is retained (content still visible).
    expect(screen.getByTestId(`inbox-sender-${item.shareId}`)).toBeTruthy();

    // R11.12 — the prior reaction state is preserved: `like` stays active and
    // `love` was never adopted (the cache is patched only on success).
    expect(
      screen.getByTestId(`inbox-reaction-chip-${item.shareId}-like`).props
        .accessibilityLabel,
    ).toBe('Like, selected');
    expect(
      screen.getByTestId(`inbox-reaction-chip-${item.shareId}-love`).props
        .accessibilityLabel,
    ).toBe('Love, not selected');
  });

  // -------------------------------------------------------------------------
  // R11.12 — an authorization error does NOT surface the generic message.
  // -------------------------------------------------------------------------
  test('an authorization-error failure (reaction_forbidden) does not show the generic action-failed message (R11.12)', async () => {
    const item = inboxProgressItem('share-forbidden', 'like');
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/inbox') {
        return inboxResponse([item]) as never;
      }
      if (
        method === 'POST' &&
        path === `/me/inbox/${item.shareId}/reactions`
      ) {
        throw new ApiError({
          code: 'reaction_forbidden',
          message: 'not delivered to you',
          status: 403,
        });
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderInbox();

    fireEvent.press(
      await screen.findByTestId(`inbox-reaction-chip-${item.shareId}-love`),
    );

    // Wait until the rejected submission has been dispatched and settled.
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/inbox/${item.shareId}/reactions`,
        { reaction: 'love' },
      );
    });

    // R11.12 — an authorization error is NOT the generic action-failed case,
    // so the generic message is never shown, and the prior reaction stands.
    expect(
      screen.queryByTestId(`inbox-reaction-message-${item.shareId}`),
    ).toBeNull();
    expect(
      screen.getByTestId(`inbox-reaction-chip-${item.shareId}-like`).props
        .accessibilityLabel,
    ).toBe('Like, selected');
  });
});

// ===========================================================================
// Sent Shares sender reaction list (R11.9–R11.11)
// ===========================================================================

describe('Sent Shares reaction list UI states (R11.9–R11.11)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  // -------------------------------------------------------------------------
  // R11.9 — loading while a Share's reactions are being retrieved.
  // -------------------------------------------------------------------------
  test('shows a loading indication while a Share\u2019s reactions are being retrieved (R11.9)', async () => {
    const share = sentProgressShare('sent-load');
    const reactions = makeDeferred<ShareReactionDTO[]>();
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/shares') {
        return [share] as never;
      }
      if (
        method === 'GET' &&
        path === `/me/shares/${share.shareId}/reactions`
      ) {
        return reactions.promise as never;
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderSent(makeNavigation());

    // R11.9 — the per-Share reactions loading indication appears.
    expect(
      await screen.findByTestId(`sent-reactions-loading-${share.shareId}`),
    ).toBeTruthy();

    await act(async () => {
      reactions.resolve([]);
    });
  });

  // -------------------------------------------------------------------------
  // R11.10 — empty-state when a Share has no reactions.
  // -------------------------------------------------------------------------
  test('shows an empty-state indication when a Share has no reactions (R11.10)', async () => {
    const share = sentProgressShare('sent-empty');
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/shares') {
        return [share] as never;
      }
      if (
        method === 'GET' &&
        path === `/me/shares/${share.shareId}/reactions`
      ) {
        return [] as never;
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderSent(makeNavigation());

    // R11.10 — the empty-state indication is shown for the Share.
    expect(
      await screen.findByTestId(`sent-reactions-empty-${share.shareId}`),
    ).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R11.11 — unavailable message, remaining Share content retained.
  // -------------------------------------------------------------------------
  test('shows an unavailable message and keeps the remaining Share content when reactions cannot be retrieved (R11.11)', async () => {
    const share = sentProgressShare('sent-unavailable');
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/shares') {
        return [share] as never;
      }
      if (
        method === 'GET' &&
        path === `/me/shares/${share.shareId}/reactions`
      ) {
        throw new ApiError({
          code: 'internal_error',
          message: 'boom',
          status: 500,
        });
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderSent(makeNavigation());

    // R11.11 — the reactions-unavailable message appears.
    expect(
      await screen.findByTestId(`sent-reactions-unavailable-${share.shareId}`),
    ).toBeTruthy();
    // The remaining Share content stays visible: the progress summary.
    expect(
      screen.getByTestId(`sent-progress-overall-${share.shareId}`),
    ).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R11.7-adjacent resolved case — sanity that reactions render with names.
  // (Kept minimal; the resolved disclosure is R11.7's remit.)
  // -------------------------------------------------------------------------
  test('renders each reaction with its reactor display name when reactions resolve', async () => {
    const share = sentProgressShare('sent-resolved');
    const reaction: ShareReactionDTO = {
      reaction: 'love',
      reactorId: 'reactor-1',
      reactorDisplayName: 'Donald Duck',
      reactedAt: '2024-01-03T00:00:00.000Z',
    };
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/shares') {
        return [share] as never;
      }
      if (
        method === 'GET' &&
        path === `/me/shares/${share.shareId}/reactions`
      ) {
        return [reaction] as never;
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderSent(makeNavigation());

    expect(
      await screen.findByTestId(
        `sent-reaction-${share.shareId}-${reaction.reactorId}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Donald Duck')).toBeTruthy();
  });
});
