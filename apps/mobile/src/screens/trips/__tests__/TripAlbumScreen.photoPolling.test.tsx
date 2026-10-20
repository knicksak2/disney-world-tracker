/**
 * Trip Album: the owner's pending photos update without leaving the screen.
 *
 * Validates: photo-uploads Requirements 13.5, 23.4, 23.10 (Property 29).
 *
 * The owner's own non-final Album photos are polled through the batched
 * `GET /me/photos/status` route (one request per tick, chunked at 10 ids). When one reaches
 * a final status the Album and the recap photos queries are refetched, so the chip flips to
 * Approved and the image appears. Only `apiRequest` is mocked, by method + path.
 */

import React from 'react';
import { Image } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render, screen, waitFor, within } from '@testing-library/react-native';
import type { MyPhotoDTO, PhotoStatus, TripMemberDTO, TripPhotoDTO } from '@dwt/shared';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import TripAlbumScreen from '../TripAlbumScreen';
import type { TripsStackParamList } from '../../../navigation/TripsStack';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { useTripSummaryPhotos } from '../../../photos/api';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const TRIP_ID = 'trip-album-poll';
const OWN_USER_ID = 'user-me';
const ALBUM_PATH = `/trips/${TRIP_ID}/photos`;
const RECAP_PATH = `/trips/${TRIP_ID}/photos?summary=true`;
const STATUS_PREFIX = '/me/photos/status?ids=';

const MEMBERS: TripMemberDTO[] = [
  { userId: OWN_USER_ID, displayName: 'Me', avatarPreset: null, role: 'member' },
];

function albumPhoto(id: string, status: PhotoStatus, mine = true): TripPhotoDTO {
  const approved = status === 'approved';
  return {
    id,
    tripId: TRIP_ID,
    thumbUrl: approved ? `https://cdn.example.com/p/${id}/thumb.jpg` : null,
    url: approved ? `https://cdn.example.com/p/${id}/full.jpg` : null,
    width: 1280,
    height: 960,
    sortAt: '2026-05-02T15:00:00.000Z',
    createdAt: '2026-05-02T15:00:00.000Z',
    uploader: { userId: mine ? OWN_USER_ID : 'user-other', displayName: 'Mickey', avatarPreset: null },
    mine,
    status,
    feedItemId: null,
  };
}

function statusDto(id: string, status: PhotoStatus): MyPhotoDTO {
  return {
    id,
    targetKind: 'trip',
    targetId: TRIP_ID,
    scopeId: TRIP_ID,
    status,
    rejectReason: null,
    rejectMessage: null,
    thumbUrl: null,
    url: null,
    width: 1280,
    height: 960,
    feedItemId: null,
    createdAt: '2026-05-02T15:00:00.000Z',
  };
}

interface FakeServer {
  album: readonly TripPhotoDTO[];
  statuses: Record<string, PhotoStatus>;
  /** The id list of every `GET /me/photos/status` request, in order. */
  statusCalls: string[][];
}

function installServer(server: FakeServer): void {
  apiRequestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/photos/config') {
      return { enabled: true, tripEnabled: true, remainingToday: 20 };
    }
    if (method === 'GET' && path === '/me') return { user: { id: OWN_USER_ID } };
    if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS;
    if (method === 'GET' && path === ALBUM_PATH) return { items: server.album, nextCursor: null };
    if (method === 'GET' && path === RECAP_PATH) return { items: [], nextCursor: null };
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

/** Keeps the recap photos query active next to the Album, as the Trip Summary does. */
function RecapProbe(): null {
  useTripSummaryPhotos(TRIP_ID);
  return null;
}

const Stack = createNativeStackNavigator<TripsStackParamList>();

function renderAlbum(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecapProbe />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="TripAlbum"
            component={TripAlbumScreen}
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

function chipLabel(photoId: string): string {
  const label = screen.getByTestId(`album-photo-status-${photoId}`).props.accessibilityLabel;
  return typeof label === 'string' ? label : '';
}

describe('Trip Album photo status polling (Requirement 23.10)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    apiRequestMock.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('an own pending photo flips to Approved with its image, and the Album and recap photos are refetched', async () => {
    const server: FakeServer = {
      album: [albumPhoto('ph-1', 'pending')],
      statuses: {},
      statusCalls: [],
    };
    installServer(server);
    renderAlbum();

    await screen.findByTestId('album-photo-tile-ph-1');
    expect(chipLabel('ph-1')).toMatch(/^Processing/);
    // No image yet: the tile shows the placeholder.
    expect(
      within(screen.getByTestId('album-photo-tile-ph-1')).UNSAFE_queryByType(Image),
    ).toBeNull();
    await waitFor(() => {
      expect(countGets(RECAP_PATH)).toBe(1);
    });
    expect(countGets(ALBUM_PATH)).toBe(1);
    expect(server.statusCalls).toHaveLength(0);

    // Moderation finishes on the server before the first tick.
    server.statuses = { 'ph-1': 'approved' };
    server.album = [albumPhoto('ph-1', 'approved')];
    await advance(3000);

    expect(server.statusCalls).toEqual([['ph-1']]);
    await waitFor(() => {
      expect(chipLabel('ph-1')).toBe('Approved');
    });
    const image = within(screen.getByTestId('album-photo-tile-ph-1')).UNSAFE_getByType(Image);
    expect((image.props as { source: { uri: string } }).source.uri).toBe(
      'https://cdn.example.com/p/ph-1/thumb.jpg',
    );
    expect(countGets(ALBUM_PATH)).toBe(2);
    await waitFor(() => {
      expect(countGets(RECAP_PATH)).toBe(2);
    });

    // Final: the poll is over.
    await advance(60_000);
    expect(server.statusCalls).toHaveLength(1);
    expect(countGets(ALBUM_PATH)).toBe(2);
  });

  test('more than 10 pending photos are chunked into groups of 10, one request per tick', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `ph-${String(i + 1).padStart(2, '0')}`);
    const server: FakeServer = {
      album: ids.map((id) => albumPhoto(id, 'pending')),
      statuses: {},
      statusCalls: [],
    };
    installServer(server);
    renderAlbum();
    await screen.findByTestId('album-photo-tile-ph-01');

    await advance(3000);
    expect(server.statusCalls).toEqual([ids.slice(0, 10)]);

    await advance(3000);
    expect(server.statusCalls).toEqual([ids.slice(0, 10), ids.slice(10)]);

    await advance(3000);
    expect(server.statusCalls).toHaveLength(3);
    expect(server.statusCalls[2]).toEqual(ids.slice(0, 10));
  });

  test('polling stops when the screen unmounts', async () => {
    const server: FakeServer = {
      album: [albumPhoto('ph-1', 'pending')],
      statuses: {},
      statusCalls: [],
    };
    installServer(server);
    const view = renderAlbum();
    await screen.findByTestId('album-photo-tile-ph-1');

    await advance(3000);
    expect(server.statusCalls).toHaveLength(1);

    view.unmount();
    await advance(60_000);
    expect(server.statusCalls).toHaveLength(1);
  });

  test('never polls when every photo is approved or belongs to another member', async () => {
    const server: FakeServer = {
      album: [albumPhoto('ph-mine', 'approved'), albumPhoto('ph-theirs', 'approved', false)],
      statuses: {},
      statusCalls: [],
    };
    installServer(server);
    renderAlbum();
    await screen.findByTestId('album-photo-tile-ph-mine');

    await advance(60_000);
    expect(server.statusCalls).toHaveLength(0);
  });
});
