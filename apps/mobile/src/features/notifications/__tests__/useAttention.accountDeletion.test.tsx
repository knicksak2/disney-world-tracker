/**
 * `useAttention`: unread Shares from a deleted sender never reach the feed or the
 * badge (account-deletion R5.14; tasks.md 14.4).
 *
 * Real hook over a real `QueryClientProvider`; only `apiRequest` is mocked. The
 * deleted sender's id is a real `generatePlaceholderId` output.
 */

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useFocusEffect: () => undefined,
}));

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { InboxItemDTO, InboxResponse } from '@dwt/shared';

import { generatePlaceholderId } from '../../../../../api/src/services/accountDeletion/placeholderId';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { useSessionStore } from '../../../state/sessionStore';
import { useAttention } from '../useAttention';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const DELETED_ID = generatePlaceholderId(() => new Uint8Array(16).map((_, i) => (i * 53 + 7) % 256));
const REAL_ID = '11111111-2222-4333-8444-555555555555';

function share(shareId: string, senderId: string, name: string, read: boolean): InboxItemDTO {
  return {
    shareId,
    read,
    senderId,
    senderDisplayName: name,
    payloadKind: 'experience',
    payload: { kind: 'experience', experienceId: 'exp-1' },
    sentAt: '2024-03-04T10:00:00.000Z',
    myReaction: null,
  };
}

function route(inbox: InboxResponse): void {
  apiRequestMock.mockImplementation((async (_method: string, path: string) => {
    if (path === '/me/inbox') return inbox;
    if (path === '/me/friends') return { incomingRequests: [] };
    if (path === '/me/trip-invites') return [];
    if (path === '/me/rode-with-tags?state=pending') return [];
    throw new Error(`unexpected apiRequest path: ${path}`);
  }) as never);
}

function renderAttention() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useAttention('timestampDesc'), { wrapper });
}

describe('useAttention and Shares from a deleted sender', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState({ token: 'auth-token', hydrated: true });
  });

  afterEach(() => {
    act(() => {
      useSessionStore.setState({ token: null, hydrated: true });
    });
  });

  it('two unread Shares, one ordinary and one from a deleted sender: the feed and badge reflect only the first', async () => {
    route({
      unread: 2,
      items: [
        share('share-ok', REAL_ID, 'Daisy', false),
        share('share-del', DELETED_ID, 'Deleted user', false),
      ],
    });
    const { result } = renderAttention();

    await waitFor(() => expect(result.current.inFlight).toBe(false));

    expect(result.current.state.items.map((i) => i.id)).toEqual(['share-ok']);
    expect(result.current.state.badgeCount).toBe(1);
  });

  it('a READ Share from a deleted sender is absent too', async () => {
    route({ unread: 0, items: [share('share-del-read', DELETED_ID, 'Deleted user', true)] });
    const { result } = renderAttention();

    await waitFor(() => expect(result.current.inFlight).toBe(false));

    expect(result.current.state.items).toHaveLength(0);
    expect(result.current.state.badgeCount).toBe(0);
  });

  it('control: with only the ordinary sender the item is present (the filter is the sender, not the share kind)', async () => {
    route({ unread: 1, items: [share('share-ok', REAL_ID, 'Daisy', false)] });
    const { result } = renderAttention();

    await waitFor(() => expect(result.current.inFlight).toBe(false));

    expect(result.current.state.items.map((i) => i.id)).toEqual(['share-ok']);
    expect(result.current.state.badgeCount).toBe(1);
  });
});
