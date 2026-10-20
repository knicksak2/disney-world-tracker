/**
 * Trip_Activity: 'Checking photo...' slots update without leaving the screen.
 *
 * Validates: photo-uploads Requirements 14.4, 23.4, 23.10 (Property 29).
 *
 * The signed-in user's own `checking` post slots are polled through the batched
 * `GET /me/photos/status` route (one request per tick) and the feed is refetched when a
 * photo reaches a final status. Only `apiRequest` is mocked, by method + path; the real
 * screen, hook and QueryClient run under jest fake timers.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type {
  MyPhotoDTO,
  PhotoStatus,
  TripFeedItemDTO,
  TripMemberDTO,
  TripPostPhotoSlotDTO,
} from '@dwt/shared';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import TripFeedScreen from '../TripFeedScreen';
import type { TripsStackParamList } from '../../../navigation/TripsStack';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const TRIP_ID = 'trip-1';
const OWN_USER_ID = '00000000-0000-4000-8000-000000000001';
const FEED_PATH = `/trips/${TRIP_ID}/feed`;
const STATUS_PREFIX = '/me/photos/status?ids=';
const POST_ID = 'post-own';

const MEMBERS: TripMemberDTO[] = [
  { userId: OWN_USER_ID, displayName: 'Me', avatarPreset: null, role: 'member' },
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function slot(
  photoId: string,
  state: TripPostPhotoSlotDTO['state'],
  mine: boolean,
  status: PhotoStatus | null,
): TripPostPhotoSlotDTO {
  const visible = state === 'ready';
  return {
    photoId,
    state,
    mine,
    status,
    thumbUrl: visible ? `https://cdn.example.com/p/${photoId}/thumb.jpg` : null,
    url: visible ? `https://cdn.example.com/p/${photoId}/full.jpg` : null,
    width: visible ? 1280 : null,
    height: visible ? 960 : null,
  };
}

function post(
  slots: readonly TripPostPhotoSlotDTO[],
  id: string = POST_ID,
  mine = true,
): TripFeedItemDTO {
  return {
    id,
    type: 'member_post',
    actorDisplayName: mine ? 'Me' : 'Donald',
    actorAvatarPreset: null,
    createdAt: '2025-08-01T20:00:00.000Z',
    metadata: { caption: 'Castle day' },
    photos: slots,
    mine,
    reactions: [],
    comments: [],
  };
}

function statusDto(id: string, status: PhotoStatus): MyPhotoDTO {
  return {
    id,
    targetKind: 'trip',
    targetId: TRIP_ID,
    scopeId: TRIP_ID,
    status,
    rejectReason: status === 'rejected' ? 'harm' : null,
    rejectMessage: null,
    thumbUrl: null,
    url: null,
    width: 1280,
    height: 960,
    feedItemId: POST_ID,
    createdAt: '2025-08-01T20:00:00.000Z',
  };
}

/** A tiny in-memory server: the feed the screen reads and the status each photo reports. */
interface FakeServer {
  feed: readonly TripFeedItemDTO[];
  statuses: Record<string, PhotoStatus>;
  /** The id list of every `GET /me/photos/status` request, in order. */
  statusCalls: string[][];
}

function installServer(server: FakeServer): void {
  apiRequestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/me') return { user: { id: OWN_USER_ID } };
    if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS;
    if (method === 'GET' && path === '/photos/config') {
      return { enabled: true, tripEnabled: true, remainingToday: 20 };
    }
    if (method === 'GET' && path === FEED_PATH) return server.feed;
    if (method === 'GET' && path.startsWith(STATUS_PREFIX)) {
      const ids = decodeURIComponent(path.slice(STATUS_PREFIX.length)).split(',');
      server.statusCalls.push(ids);
      return { photos: ids.map((id) => statusDto(id, server.statuses[id] ?? 'pending')) };
    }
    return null;
  });
}

function countGets(path: string): number {
  return apiRequestMock.mock.calls.filter((c) => c[0] === 'GET' && c[1] === path).length;
}

const Stack = createNativeStackNavigator<TripsStackParamList>();

function renderFeed(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="TripFeed"
            component={TripFeedScreen}
            initialParams={{ tripId: TRIP_ID }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Trip_Activity photo status polling (Requirement 23.10)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    apiRequestMock.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('two own checking slots: one batched status request per tick, then the feed refetches and the placeholders become the photos', async () => {
    const server: FakeServer = {
      feed: [
        post([slot('ph-c1', 'checking', true, 'pending'), slot('ph-c2', 'checking', true, 'pending')]),
      ],
      statuses: {},
      statusCalls: [],
    };
    installServer(server);
    renderFeed();

    expect(await screen.findByTestId('trip-feed-slot-checking-ph-c1')).toBeTruthy();
    expect(screen.getAllByText('Checking photo...')).toHaveLength(2);
    expect(server.statusCalls).toHaveLength(0);
    expect(countGets(FEED_PATH)).toBe(1);

    // Moderation finishes on the server before the first tick.
    server.statuses = { 'ph-c1': 'approved', 'ph-c2': 'approved' };
    server.feed = [
      post([slot('ph-c1', 'ready', true, 'approved'), slot('ph-c2', 'ready', true, 'approved')]),
    ];

    await advance(3000);

    // Exactly one request for the whole tick, carrying both ids.
    expect(server.statusCalls).toEqual([['ph-c1', 'ph-c2']]);

    // The feed is refetched and the placeholders are replaced by the ready images.
    expect(await screen.findByTestId('trip-feed-slot-ready-ph-c1')).toBeTruthy();
    expect(screen.getByTestId('trip-feed-slot-ready-ph-c2')).toBeTruthy();
    expect(countGets(FEED_PATH)).toBe(2);
    expect(screen.queryByText('Checking photo...')).toBeNull();
    expect(screen.queryByTestId('trip-feed-slot-checking-ph-c1')).toBeNull();

    // Everything is final, so the poll is over: no more status requests, no more feed GETs.
    await advance(60_000);
    expect(server.statusCalls).toHaveLength(1);
    expect(countGets(FEED_PATH)).toBe(2);
  });

  test('a photo that reports deleted refetches the feed and shows the removed placeholder', async () => {
    const server: FakeServer = {
      feed: [
        post([slot('ph-c1', 'checking', true, 'pending'), slot('ph-c2', 'checking', true, 'pending')]),
      ],
      statuses: {},
      statusCalls: [],
    };
    installServer(server);
    renderFeed();
    await screen.findByTestId('trip-feed-slot-checking-ph-c1');

    server.statuses = { 'ph-c1': 'deleted', 'ph-c2': 'approved' };
    server.feed = [
      post([slot('ph-c1', 'removed', true, 'deleted'), slot('ph-c2', 'ready', true, 'approved')]),
    ];
    await advance(3000);

    expect(await screen.findByTestId('trip-feed-slot-removed-ph-c1')).toBeTruthy();
    expect(screen.getByText('photo removed')).toBeTruthy();
    expect(screen.getByTestId('trip-feed-slot-ready-ph-c2')).toBeTruthy();
    expect(screen.queryByText('Checking photo...')).toBeNull();
  });

  test('a rejected photo refetches the feed once and polling ends even though the owner slot stays in the checking state', async () => {
    const server: FakeServer = {
      feed: [post([slot('ph-c1', 'checking', true, 'pending')])],
      statuses: {},
      statusCalls: [],
    };
    installServer(server);
    renderFeed();
    await screen.findByTestId('trip-feed-slot-checking-ph-c1');

    // The server keeps an owner's rejected photo in the `checking` state (status 'rejected').
    server.statuses = { 'ph-c1': 'rejected' };
    server.feed = [post([slot('ph-c1', 'checking', true, 'rejected')])];
    await advance(3000);

    await waitFor(() => {
      expect(countGets(FEED_PATH)).toBe(2);
    });
    expect(server.statusCalls).toEqual([['ph-c1']]);

    // The refetched slot is final (rejected), so it is no longer polled and the feed is not
    // refetched in a loop.
    await advance(60_000);
    expect(server.statusCalls).toHaveLength(1);
    expect(countGets(FEED_PATH)).toBe(2);
  });

  test('keeps one request per tick while the photo is still pending, without refetching the feed', async () => {
    const server: FakeServer = {
      feed: [post([slot('ph-c1', 'checking', true, 'pending')])],
      statuses: {},
      statusCalls: [],
    };
    installServer(server);
    renderFeed();
    await screen.findByTestId('trip-feed-slot-checking-ph-c1');

    await advance(3000);
    expect(server.statusCalls).toHaveLength(1);
    await advance(3000);
    expect(server.statusCalls).toHaveLength(2);
    await advance(3000);
    expect(server.statusCalls).toHaveLength(3);

    // Still pending: the placeholder stays and the feed is not refetched.
    expect(screen.getByTestId('trip-feed-slot-checking-ph-c1')).toBeTruthy();
    expect(countGets(FEED_PATH)).toBe(1);
  });

  test('polling stops when the screen unmounts', async () => {
    const server: FakeServer = {
      feed: [post([slot('ph-c1', 'checking', true, 'pending')])],
      statuses: {},
      statusCalls: [],
    };
    installServer(server);
    const view = renderFeed();
    await screen.findByTestId('trip-feed-slot-checking-ph-c1');

    await advance(3000);
    expect(server.statusCalls).toHaveLength(1);

    view.unmount();
    await advance(60_000);
    expect(server.statusCalls).toHaveLength(1);
  });

  test('never polls when no slot is checking, or when the checking slot belongs to another member', async () => {
    const server: FakeServer = {
      feed: [
        post([slot('ph-ready', 'ready', true, 'approved')], 'post-ready'),
        post([slot('ph-theirs', 'checking', false, null)], 'post-other', false),
      ],
      statuses: {},
      statusCalls: [],
    };
    installServer(server);
    renderFeed();

    expect(await screen.findByTestId('trip-feed-slot-ready-ph-ready')).toBeTruthy();
    // Another member's checking slot is shown (Requirement 14.9) but is not pollable: the
    // status route only answers for the caller's own photos.
    expect(screen.getByTestId('trip-feed-slot-checking-ph-theirs')).toBeTruthy();

    await advance(60_000);
    expect(server.statusCalls).toHaveLength(0);
  });
});
