/**
 * Share_Inbox survival + cross-surface read-state example tests (task 15.4).
 *
 * Validates: Requirements 7.7, 12.1, 12.3, 12.4, 12.5
 *
 * Task 15.3 keeps the Share_Inbox (`InboxScreen`) as a browse/history/react
 * surface after the Notification_Center consolidation:
 *
 *   - **R7.7 / R12.1.** The inbox still lists EVERY delivered Share via the
 *     unchanged `GET /me/inbox`, regardless of Read_State — both a read and an
 *     unread Share render.
 *   - **R12.3 / R12.4.** The recipient can still add and change a per-share
 *     reaction from the closed Reaction_Vocabulary via
 *     `POST /me/inbox/:shareId/reactions`.
 *   - **R12.5.** Marking a Share read from the Notification_Center is reflected
 *     in the inbox. Both surfaces read the shared `['inbox']` React Query cache:
 *     the center's `useAttentionActions().markShareRead` optimistically flips
 *     the cached Share to `read` and invalidates `['inbox']`, and `InboxScreen`
 *     — reading the same key — re-renders the Share as read and drops the
 *     unread tally. This test drives `markShareRead` against a shared
 *     `QueryClient` that also hosts a mounted `InboxScreen` and asserts the
 *     inbox reflects the change.
 *
 * Only `apiRequest` is stubbed (routed by method + path); the real `ApiError`
 * is preserved so the screen's `error.code` branches resolve against the
 * genuine class. The navigation hooks the Inbox depends on are stubbed so it
 * renders standalone.
 */

import React from 'react';
import { Pressable, Text } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { toAttentionItem } from '@dwt/shared';
import type { InboxItemDTO, InboxResponse } from '@dwt/shared';

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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The Inbox screen calls `useNavigation()` and `useRoute()`. These tests mount
// it standalone (no navigator), so stub both hooks. `useRoute` returns no
// params so the deep-link auto-tap-through never arms.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));

// ---------------------------------------------------------------------------
// Imports of the modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import InboxScreen from '../InboxScreen';
import { apiRequest } from '../../../api/client';
import { useAttentionActions } from '../../../features/notifications/useAttentionActions';

const apiRequestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SENDER_ID = 'sender-0001';
const SENDER_NAME = 'Minnie Mouse';

/** A `progress` inbox item — avoids the catalog metadata read entirely. */
function inboxProgressItem(
  shareId: string,
  read: boolean,
): InboxItemDTO {
  return {
    shareId,
    read,
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
    myReaction: null,
  };
}

function inboxResponse(items: InboxItemDTO[]): InboxResponse {
  const unread = items.reduce((acc, it) => (it.read ? acc : acc + 1), 0);
  return { unread, items };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderInbox(client: QueryClient): void {
  render(
    <QueryClientProvider client={client}>
      <InboxScreen />
    </QueryClientProvider>,
  );
}

// ===========================================================================
// R7.7 / R12.1 — the inbox lists both read and unread shares
// ===========================================================================

describe('Share_Inbox survives consolidation as a browse/react surface (R7.7, R12.1, R12.3, R12.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('lists both a read and an unread delivered Share (R7.7, R12.1)', async () => {
    const readItem = inboxProgressItem('share-read', true);
    const unreadItem = inboxProgressItem('share-unread', false);
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/inbox') {
        return inboxResponse([readItem, unreadItem]) as never;
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderInbox(makeQueryClient());

    // Both rows render regardless of Read_State.
    expect(
      await screen.findByTestId(`inbox-row-${readItem.shareId}`),
    ).toBeTruthy();
    expect(screen.getByTestId(`inbox-row-${unreadItem.shareId}`)).toBeTruthy();

    // Read_State is reflected: only the unread Share carries the unread dot.
    expect(
      screen.queryByTestId(`inbox-unread-dot-${readItem.shareId}`),
    ).toBeNull();
    expect(
      screen.getByTestId(`inbox-unread-dot-${unreadItem.shareId}`),
    ).toBeTruthy();
  });

  test('supports adding a reaction on a delivered Share (R12.3, R12.4)', async () => {
    const item = inboxProgressItem('share-react', true);
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/inbox') {
        return inboxResponse([item]) as never;
      }
      if (method === 'POST' && path === `/me/inbox/${item.shareId}/reactions`) {
        return undefined as never;
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    renderInbox(makeQueryClient());

    // The reaction chips are offered on the delivered Share.
    const likeChip = await screen.findByTestId(
      `inbox-reaction-chip-${item.shareId}-like`,
    );
    expect(likeChip).toBeTruthy();

    // Tapping a reaction submits it via the reactions endpoint.
    fireEvent.press(likeChip);
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/inbox/${item.shareId}/reactions`,
        { reaction: 'like' },
      );
    });
  });
});

// ===========================================================================
// R12.5 — marking a Share read in the center reflects in the inbox
// ===========================================================================

describe('marking a Share read from the Notification_Center reflects in the inbox (R12.5)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  /**
   * A harness that exposes the center's `markShareRead` inline action. It lives
   * under the SAME `QueryClientProvider` as the mounted `InboxScreen`, so both
   * observe the shared `['inbox']` cache.
   */
  function MarkReadHarness({ item }: { item: InboxItemDTO }): JSX.Element {
    const { markShareRead } = useAttentionActions();
    return (
      <Pressable
        testID="center-mark-read"
        onPress={() => markShareRead(toAttentionItem('share', item))}
      >
        <Text>mark read</Text>
      </Pressable>
    );
  }

  test('flips the Share to read and clears the unread tally in the inbox', async () => {
    const unreadItem = inboxProgressItem('share-cross', false);

    // The inbox read reflects server-side Read_State: once the Share has been
    // opened (POST /open), subsequent reads return it as read. This lets the
    // post-mutation invalidation refetch confirm the optimistic flip rather
    // than revert it.
    const opened = new Set<string>();
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/inbox') {
        const item = {
          ...unreadItem,
          read: opened.has(unreadItem.shareId),
        };
        return inboxResponse([item]) as never;
      }
      if (
        method === 'POST' &&
        path === `/me/inbox/${unreadItem.shareId}/open`
      ) {
        opened.add(unreadItem.shareId);
        return undefined as never;
      }
      throw new Error(`unexpected apiRequest: ${method} ${String(path)}`);
    });

    const client = makeQueryClient();
    render(
      <QueryClientProvider client={client}>
        <InboxScreen />
        <MarkReadHarness item={unreadItem} />
      </QueryClientProvider>,
    );

    // The Share starts unread in the inbox.
    expect(
      await screen.findByTestId(`inbox-unread-dot-${unreadItem.shareId}`),
    ).toBeTruthy();
    expect(screen.getByTestId('inbox-unread-badge')).toHaveTextContent(
      '1 unread',
    );

    // Act from the center: mark the Share read via the shared inline action.
    await act(async () => {
      fireEvent.press(screen.getByTestId('center-mark-read'));
    });

    // R12.5 — the inbox reflects the change: the unread dot is gone and the
    // unread tally drops to zero, because both surfaces share the `['inbox']`
    // cache the mark-read mutation updates + invalidates.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`inbox-unread-dot-${unreadItem.shareId}`),
      ).toBeNull();
    });
    expect(screen.getByTestId('inbox-unread-badge')).toHaveTextContent(
      '0 unread',
    );

    // The mark-read action hit the shared inbox open endpoint.
    expect(apiRequestMock).toHaveBeenCalledWith(
      'POST',
      `/me/inbox/${unreadItem.shareId}/open`,
      undefined,
      expect.anything(),
    );
  });
});
