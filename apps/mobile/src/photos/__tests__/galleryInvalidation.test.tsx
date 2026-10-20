// Feature: photo-uploads — public gallery caches follow a photo's lifecycle
//
// Regression for the owner-reported bug: after a photo was approved the restaurant's
// "Photos from guests" strip stayed hidden (and the dish strip stayed on "Add photo")
// because nothing invalidated the cached, empty gallery queries:
//   - usePhotoStatuses invalidated `photoKeys.dish('')`, which prefix-matches no real dish;
//   - `useRestaurantFoodPhotos` keys live under 'restaurant-food-photos', OUTSIDE
//     `photoKeys.all`, so upload/delete invalidations never touched them;
//   - the galleries had a 30-minute stale time, so a later mount reused the empty result.
//
// Real QueryClient and real components; only the network layer (`apiRequest`, `fetch` for
// the storage PUT) is mocked.
//
// Validates: Requirements 4.12, 9.6, 27.2, 27.7

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FoodPhotoDTO, MyPhotoDTO, PhotoClientConfigDTO, PhotoStatus, RestaurantFoodPhotoDTO } from '@dwt/shared';
import * as clientModule from '../../api/client';
import {
  PHOTO_GALLERY_STALE_TIME_MS,
  PHOTO_STALE_TIME_MS,
  photoKeys,
  useDeletePhoto,
  usePhotoStatuses,
  useUploadPhotos,
} from '../api';
import { DishPhotoStrip } from '../DishPhotoStrip';
import { ExperiencePhotoStrip } from '../ExperiencePhotoStrip';
import type { PreparedImages } from '../imagePrep.pure';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => 'mock-token'),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

const EXPERIENCE_ID = 'exp-aloha-isle';
const DISH_ID = 'dish-dole-whip';
const PHOTO_ID = 'photo-1';
const OWN_PHOTO_IDS: readonly string[] = [PHOTO_ID];

const RESTAURANT_PATH = `/experiences/${EXPERIENCE_ID}/food-photos?limit=8`;
const DISH_PATH = `/food-items/${DISH_ID}/photos`;

const CONFIG: PhotoClientConfigDTO = {
  enabled: true,
  foodEnabled: true,
  tripEnabled: true,
  maxPerFoodLog: 4,
  maxPerTrip: 300,
  maxFeedPostPhotos: 4,
  maxBatch: 10,
  maxBytes: 15 * 1024 * 1024,
  maxThumbBytes: 500 * 1024,
  dailyCap: 20,
  remainingToday: 20,
  experienceStripMax: 8,
};

const RESTAURANT_PHOTO: RestaurantFoodPhotoDTO = {
  id: PHOTO_ID,
  foodItemId: DISH_ID,
  foodItemName: 'Dole Whip',
  thumbUrl: 'https://p.example/thumb-1.jpg',
  url: 'https://p.example/full-1.jpg',
  width: 1200,
  height: 800,
  createdDay: '2026-10-18',
  uploader: null,
  mine: true,
};

const DISH_PHOTO: FoodPhotoDTO = {
  id: PHOTO_ID,
  foodItemId: DISH_ID,
  thumbUrl: 'https://p.example/thumb-1.jpg',
  url: 'https://p.example/full-1.jpg',
  width: 1200,
  height: 800,
  createdDay: '2026-10-18',
  uploader: null,
  mine: true,
};

function myPhoto(status: PhotoStatus): MyPhotoDTO {
  return {
    id: PHOTO_ID,
    targetKind: 'food_log',
    targetId: 'log-1',
    scopeId: DISH_ID,
    status,
    rejectReason: null,
    rejectMessage: null,
    thumbUrl: null,
    url: null,
    width: 1200,
    height: 800,
    feedItemId: null,
    createdAt: '2026-10-18T12:00:00.000Z',
  };
}

/** Mutable fake server behind the mocked network layer. */
interface FakeServer {
  /** Whether the public galleries currently contain the owner's photo. */
  photoVisible: boolean;
  /** What GET /me/photos/status reports for the owner's photo. */
  status: PhotoStatus;
}

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Mounts the status poller next to both strips, as the app does across screens. */
function Harness(): JSX.Element {
  usePhotoStatuses(OWN_PHOTO_IDS);
  return (
    <>
      <ExperiencePhotoStrip kind="experience" id={EXPERIENCE_ID} restaurantName="Aloha Isle" />
      <DishPhotoStrip foodItemId={DISH_ID} foodItemName="Dole Whip" />
    </>
  );
}

function DeleteHarness(): JSX.Element {
  const del = useDeletePhoto();
  return (
    <>
      <Pressable testID="delete-photo" onPress={() => del.mutate(PHOTO_ID)}>
        <Text>Delete</Text>
      </Pressable>
      <ExperiencePhotoStrip kind="experience" id={EXPERIENCE_ID} restaurantName="Aloha Isle" />
      <DishPhotoStrip foodItemId={DISH_ID} foodItemName="Dole Whip" />
    </>
  );
}

const PREPARED: PreparedImages = {
  full: {
    uri: 'file:///full.jpg',
    width: 1280,
    height: 720,
    blob: new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
  },
  thumb: {
    uri: 'file:///thumb.jpg',
    width: 320,
    height: 180,
    blob: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
  },
};

function UploadHarness(): JSX.Element {
  const upload = useUploadPhotos();
  return (
    <>
      <Pressable
        testID="upload-photo"
        onPress={() =>
          upload.mutate({
            target: { kind: 'food_log', id: '11111111-1111-4111-8111-111111111111' },
            items: [{ prepared: PREPARED }],
          })
        }
      >
        <Text>Upload</Text>
      </Pressable>
      <ExperiencePhotoStrip kind="experience" id={EXPERIENCE_ID} restaurantName="Aloha Isle" />
      <DishPhotoStrip foodItemId={DISH_ID} foodItemName="Dole Whip" />
    </>
  );
}

describe('gallery caches follow a photo lifecycle (restaurant strip + dish strip)', () => {
  let apiRequestSpy: jest.SpyInstance;
  let originalFetch: typeof global.fetch;
  let server: FakeServer;

  function getCalls(path: string): number {
    return apiRequestSpy.mock.calls.filter(
      (call: unknown[]) => call[0] === 'GET' && call[1] === path
    ).length;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    server = { photoVisible: false, status: 'pending' };
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async () => ({ ok: true, status: 200 }));

    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
    apiRequestSpy.mockImplementation((method: string, path: string) => {
      if (path === '/photos/config') return Promise.resolve(CONFIG);
      if (method === 'GET' && path === RESTAURANT_PATH) {
        return Promise.resolve({
          items: server.photoVisible ? [RESTAURANT_PHOTO] : [],
          nextCursor: null,
        });
      }
      if (method === 'GET' && path === DISH_PATH) {
        return Promise.resolve({
          items: server.photoVisible ? [DISH_PHOTO] : [],
          nextCursor: null,
        });
      }
      if (method === 'GET' && path.startsWith('/me/photos/status')) {
        return Promise.resolve({ photos: [myPhoto(server.status)] });
      }
      if (method === 'DELETE' && path === `/photos/${PHOTO_ID}`) {
        server.photoVisible = false;
        return Promise.resolve(undefined);
      }
      if (method === 'POST' && path === '/photos/uploads') {
        return Promise.resolve({
          slots: [
            {
              photoId: PHOTO_ID,
              putUrl: 'https://r2.example/u/photo-1/full.jpg?signed=1',
              thumbPutUrl: 'https://r2.example/u/photo-1/thumb.jpg?signed=1',
              expiresAt: '2026-10-18T18:00:00.000Z',
            },
          ],
        });
      }
      if (method === 'POST' && path === '/photos/confirm') {
        return Promise.resolve({ results: [{ photoId: PHOTO_ID, result: 'accepted' }] });
      }
      return Promise.reject(new Error(`Unexpected request: ${method} ${path}`));
    });
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  async function waitForEmptyGalleries(): Promise<void> {
    // Strip renders nothing for an empty result; the dish strip shows its invite state.
    await screen.findByTestId(`dish-photo-strip-${DISH_ID}-empty`);
    expect(getCalls(RESTAURANT_PATH)).toBe(1);
    expect(getCalls(DISH_PATH)).toBe(1);
    expect(screen.queryByTestId('experience-photo-strip')).toBeNull();
  }

  it('GalleryKeys: the key families really are prefixes of the keys the hooks use', () => {
    // dish('') is NOT a prefix of a real dish key; dishAll() is.
    const client = createClient();
    client.setQueryData(photoKeys.dish(DISH_ID), { items: [], nextCursor: null });
    expect(client.getQueryCache().findAll({ queryKey: photoKeys.dish('') })).toHaveLength(0);
    expect(client.getQueryCache().findAll({ queryKey: photoKeys.dishAll() })).toHaveLength(1);
    client.setQueryData([...photoKeys.restaurantAll(), 'experience', EXPERIENCE_ID, 8], {});
    expect(client.getQueryCache().findAll({ queryKey: photoKeys.restaurantAll() })).toHaveLength(1);
    // ...and the restaurant family is outside photoKeys.all (why upload/delete missed it).
    expect(client.getQueryCache().findAll({ queryKey: photoKeys.all })).toHaveLength(1);
  });

  it('owner photo becomes approved: restaurant strip refetches and shows a tile with the dish name; dish strip refetches too', async () => {
    const client = createClient();
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    );

    // Cached EMPTY before approval (the state the owner was in).
    await waitForEmptyGalleries();

    // The moderator approves the photo; the next status poll reports it.
    server.photoVisible = true;
    server.status = 'approved';
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    // A NEW GET /experiences/:id/food-photos?limit=8 is issued and the tile appears.
    const tile = await screen.findByTestId(`experience-photo-strip-tile-${PHOTO_ID}`);
    expect(getCalls(RESTAURANT_PATH)).toBe(2);
    expect(screen.getByText('Dole Whip')).toBeTruthy();
    expect(tile.props.accessibilityLabel).toBe('Dole Whip');
    expect(screen.getByRole('header', { name: 'Photos from guests' })).toBeTruthy();

    // The dish strip refetched as well and now shows the photo count instead of "Add photo".
    await screen.findByTestId(`dish-photo-strip-${DISH_ID}`);
    expect(getCalls(DISH_PATH)).toBe(2);
    expect(screen.getByText('1 photo')).toBeTruthy();
    expect(screen.queryByTestId(`dish-photo-strip-${DISH_ID}-empty`)).toBeNull();
  });

  it('owner photo is rejected (also final): both galleries refetch', async () => {
    const client = createClient();
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    );
    await waitForEmptyGalleries();

    server.status = 'rejected';
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(getCalls(RESTAURANT_PATH)).toBe(2);
      expect(getCalls(DISH_PATH)).toBe(2);
    });
  });

  it('a non-final status (still pending) does NOT refetch the galleries', async () => {
    const client = createClient();
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    );
    await waitForEmptyGalleries();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await waitFor(() => {
      expect(
        apiRequestSpy.mock.calls.some(
          (call: unknown[]) => typeof call[1] === 'string' && call[1].startsWith('/me/photos/status')
        )
      ).toBe(true);
    });

    expect(getCalls(RESTAURANT_PATH)).toBe(1);
    expect(getCalls(DISH_PATH)).toBe(1);
  });

  it('deleting a photo invalidates both the dish gallery and the restaurant gallery', async () => {
    server.photoVisible = true;
    const client = createClient();
    render(
      <QueryClientProvider client={client}>
        <DeleteHarness />
      </QueryClientProvider>
    );

    await screen.findByTestId(`experience-photo-strip-tile-${PHOTO_ID}`);
    await screen.findByTestId(`dish-photo-strip-${DISH_ID}`);
    expect(getCalls(RESTAURANT_PATH)).toBe(1);
    expect(getCalls(DISH_PATH)).toBe(1);

    fireEvent.press(screen.getByTestId('delete-photo'));

    // DELETE /photos/:id was sent, then both galleries refetched and lost the photo.
    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith('DELETE', `/photos/${PHOTO_ID}`);
      expect(getCalls(RESTAURANT_PATH)).toBe(2);
      expect(getCalls(DISH_PATH)).toBe(2);
    });
    await screen.findByTestId(`dish-photo-strip-${DISH_ID}-empty`);
    expect(screen.queryByTestId(`experience-photo-strip-tile-${PHOTO_ID}`)).toBeNull();
    expect(screen.queryByTestId('experience-photo-strip')).toBeNull();
  });

  it('a confirmed upload invalidates both galleries', async () => {
    const client = createClient();
    render(
      <QueryClientProvider client={client}>
        <UploadHarness />
      </QueryClientProvider>
    );
    await waitForEmptyGalleries();

    fireEvent.press(screen.getByTestId('upload-photo'));

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/photos/confirm', {
        photoIds: [PHOTO_ID],
      });
      expect(getCalls(RESTAURANT_PATH)).toBe(2);
      expect(getCalls(DISH_PATH)).toBe(2);
    });
  });

  it('re-mounting the strips after the gallery stale time refetches (the user left the polling screen before approval)', async () => {
    // The gallery window must be short (minutes), far below the 30-minute list stale time,
    // otherwise an empty result cached before approval hides the strip for half an hour.
    expect(PHOTO_GALLERY_STALE_TIME_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(PHOTO_GALLERY_STALE_TIME_MS).toBeLessThan(PHOTO_STALE_TIME_MS);

    const client = createClient();
    const first = render(
      <QueryClientProvider client={client}>
        <ExperiencePhotoStrip kind="experience" id={EXPERIENCE_ID} restaurantName="Aloha Isle" />
        <DishPhotoStrip foodItemId={DISH_ID} foodItemName="Dole Whip" />
      </QueryClientProvider>
    );
    await screen.findByTestId(`dish-photo-strip-${DISH_ID}-empty`);
    expect(getCalls(RESTAURANT_PATH)).toBe(1);
    first.unmount();

    // Approved while the user was elsewhere (no poller mounted, nothing invalidated).
    server.photoVisible = true;

    // Re-entering within the stale window reuses the cache: no extra requests.
    jest.setSystemTime(Date.now() + PHOTO_GALLERY_STALE_TIME_MS - 1000);
    const early = render(
      <QueryClientProvider client={client}>
        <ExperiencePhotoStrip kind="experience" id={EXPERIENCE_ID} restaurantName="Aloha Isle" />
        <DishPhotoStrip foodItemId={DISH_ID} foodItemName="Dole Whip" />
      </QueryClientProvider>
    );
    await screen.findByTestId(`dish-photo-strip-${DISH_ID}-empty`);
    expect(getCalls(RESTAURANT_PATH)).toBe(1);
    expect(getCalls(DISH_PATH)).toBe(1);
    early.unmount();

    // Past the stale window the next mount refetches and the strip appears.
    jest.setSystemTime(Date.now() + 2000);
    render(
      <QueryClientProvider client={client}>
        <ExperiencePhotoStrip kind="experience" id={EXPERIENCE_ID} restaurantName="Aloha Isle" />
        <DishPhotoStrip foodItemId={DISH_ID} foodItemName="Dole Whip" />
      </QueryClientProvider>
    );
    await screen.findByTestId(`experience-photo-strip-tile-${PHOTO_ID}`);
    expect(getCalls(RESTAURANT_PATH)).toBe(2);
    expect(getCalls(DISH_PATH)).toBe(2);
  });
});
