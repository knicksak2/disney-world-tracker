import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FoodPhotoDTO, FoodItemLogHistoryDTO } from '@dwt/shared';
import * as clientModule from '../../api/client';
import { ApiError } from '../../api/client';
import { DishPhotoStrip } from '../DishPhotoStrip';
import { DishPhotosSheet } from '../DishPhotosSheet';

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

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => 'true'),
    setItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../photoPicker', () => ({
  __esModule: true,
  pickFromLibrary: jest.fn(async () => ({
    canceled: false,
    photos: [{ uri: 'file://chosen.jpg', width: 1200, height: 800, source: 'library' }],
  })),
  captureFromCamera: jest.fn(async () => ({
    canceled: false,
    photos: [{ uri: 'file://camera.jpg', width: 1200, height: 800, source: 'camera' }],
  })),
  requestLibraryPermission: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestCameraPermission: jest.fn(async () => ({ granted: true, canAskAgain: true })),
}));

jest.mock('../imagePrep', () => ({
  __esModule: true,
  prepareImage: jest.fn(async () => ({
    full: { uri: 'file://prep-full.jpg', width: 1200, height: 800, blob: { size: 50000 } },
    thumb: { uri: 'file://prep-thumb.jpg', width: 320, height: 213, blob: { size: 5000 } },
  })),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('DishPhotoStrip & DishPhotosSheet (Task 13.6)', () => {
  let apiRequestSpy: jest.SpyInstance;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
    })) as any;
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
    global.fetch = originalFetch;
  });

  const SAMPLE_PHOTOS: FoodPhotoDTO[] = [
    {
      id: 'photo-1',
      foodItemId: 'item-1',
      thumbUrl: 'https://p/thumb-1.jpg',
      url: 'https://p/full-1.jpg',
      width: 1200,
      height: 800,
      createdDay: '2026-10-18',
      uploader: {
        userId: 'user-mickey',
        displayName: 'Mickey',
        avatarPreset: 'mickey',
      },
      mine: false,
    },
    {
      id: 'photo-2',
      foodItemId: 'item-1',
      thumbUrl: 'https://p/thumb-2.jpg',
      url: 'https://p/full-2.jpg',
      width: 1200,
      height: 800,
      createdDay: '2026-10-18',
      uploader: null, // stranger
      mine: false,
    },
  ];

  it('DishPhotoStrip renders thumbnails from query and calls onPress on tap', async () => {
    apiRequestSpy.mockResolvedValueOnce({
      items: SAMPLE_PHOTOS,
      nextCursor: null,
    });

    const onPressMock = jest.fn();
    render(
      <DishPhotoStrip
        foodItemId="dish-dole-whip"
        foodItemName="Dole Whip"
        onPress={onPressMock}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('dish-photo-strip-dish-dole-whip')).toBeTruthy();
      expect(screen.getByText('2 photos')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dish-photo-strip-dish-dole-whip'));
    expect(onPressMock).toHaveBeenCalledTimes(1);
  });

  it('DishPhotoStrip renders empty invite state when no photos exist', async () => {
    apiRequestSpy.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });

    const onPressMock = jest.fn();
    render(
      <DishPhotoStrip
        foodItemId="dish-churro"
        foodItemName="Churro"
        onPress={onPressMock}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('dish-photo-strip-dish-churro-empty')).toBeTruthy();
      expect(screen.getByText('Add photo')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dish-photo-strip-dish-churro-empty'));
    expect(onPressMock).toHaveBeenCalledTimes(1);
  });

  it('DishPhotosSheet renders empty state with invitation when there are no photos', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path.startsWith('/food-items/dish-empty/photos')) {
        return Promise.resolve({ items: [], nextCursor: null });
      }
      if (path === '/photos/config') {
        return Promise.resolve({ enabled: true, foodEnabled: true });
      }
      return Promise.resolve([]);
    });

    render(
      <DishPhotosSheet
        visible={true}
        onClose={jest.fn()}
        foodItemId="dish-empty"
        foodItemName="Citrus Swirl"
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('dish-photos-sheet-empty')).toBeTruthy();
      expect(screen.getByText('No photos yet')).toBeTruthy();
      expect(screen.getByText('Be the first to share a photo of Citrus Swirl!')).toBeTruthy();
    });
  });

  it('DishPhotosSheet: Add a photo with no log opens the log modal directly', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path.startsWith('/food-items/dish-no-logs/photos')) {
        return Promise.resolve({ items: [], nextCursor: null });
      }
      if (path.startsWith('/me/food-items/dish-no-logs/logs')) {
        const history: FoodItemLogHistoryDTO = {
          foodItemId: 'dish-no-logs',
          repeatCount: 0,
          logs: [],
        };
        return Promise.resolve(history);
      }
      if (path === '/photos/config') {
        return Promise.resolve({
          enabled: true,
          foodEnabled: true,
          maxPerFoodLog: 4,
        });
      }
      return Promise.resolve([]);
    });

    render(
      <DishPhotosSheet
        visible={true}
        onClose={jest.fn()}
        foodItemId="dish-no-logs"
        foodItemName="Cheshire Cat Tail"
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('dish-photos-add-photo-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dish-photos-add-photo-btn'));

    // Should open LogFoodItemModal since there is no existing visit log
    await waitFor(() => {
      expect(screen.getByTestId('log-food-item-modal')).toBeTruthy();
    });
  });

  it('DishPhotosSheet renders gallery with byline (named vs Another guest generic avatar) and uses session-scoped query', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path.startsWith('/food-items/dish-gallery/photos')) {
        return Promise.resolve({ items: SAMPLE_PHOTOS, nextCursor: null });
      }
      return Promise.resolve([]);
    });

    render(
      <DishPhotosSheet
        visible={true}
        onClose={jest.fn()}
        foodItemId="dish-gallery"
        foodItemName="Dole Whip"
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('photo-grid-tile-photo-1')).toBeTruthy();
      expect(screen.getByTestId('photo-grid-tile-photo-2')).toBeTruthy();
      // Mickey byline
      expect(screen.getByText('Mickey')).toBeTruthy();
      // Stranger byline
      expect(screen.getByText('Another guest')).toBeTruthy();
    });

    // Verify session-scoped endpoint called
    expect(apiRequestSpy).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('/food-items/dish-gallery/photos')
    );
  });

  it('DishPhotosSheet handles photo_target_full with Log a new visit offer and opens log modal', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path.startsWith('/food-items/dish-full/photos')) {
        return Promise.resolve({ items: SAMPLE_PHOTOS, nextCursor: null });
      }
      if (path.startsWith('/me/food-items/dish-full/logs')) {
        const history: FoodItemLogHistoryDTO = {
          foodItemId: 'dish-full',
          repeatCount: 1,
          logs: [
            {
              id: 'log-full-123',
              userId: 'u1',
              foodItemId: 'dish-full',
              visitedOn: '2026-10-18',
              userTz: 'America/New_York',
              loggedAt: '2026-10-18T12:00:00Z',
              rating: 9,
              note: null,
            },
          ],
        };
        return Promise.resolve(history);
      }
      if (path === '/photos/uploads') {
        throw new ApiError({
          code: 'photo_target_full',
          message: 'Target log has reached photo capacity.',
          status: 400,
        });
      }
      if (path === '/photos/config') {
        return Promise.resolve({
          enabled: true,
          foodEnabled: true,
          maxPerFoodLog: 4,
        });
      }
      return Promise.resolve([]);
    });

    render(
      <DishPhotosSheet
        visible={true}
        onClose={jest.fn()}
        foodItemId="dish-full"
        foodItemName="Turkey Leg"
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('dish-photos-add-photo-btn')).toBeTruthy();
    });

    // Press Add photo
    fireEvent.press(screen.getByTestId('dish-photos-add-photo-btn'));

    // Opens PhotoPickerSheet because log-full-123 exists
    await waitFor(() => {
      expect(screen.getByTestId('photo-picker-sheet')).toBeTruthy();
    });

    // The dish (food) caller passes target "food": exact food guidance (Requirement 23.1)
    expect(screen.getByText('Frame just the dish. No people or text.')).toBeTruthy();

    // Choose photo from library
    fireEvent.press(screen.getByTestId('choose-from-library-button'));

    await waitFor(() => {
      expect(screen.getByTestId('photo-preview-container')).toBeTruthy();
    });

    // Confirm upload -> will throw photo_target_full
    fireEvent.press(screen.getByTestId('confirm-photo-upload-button'));

    // Should surface target full notice with offer to Log a new visit
    await waitFor(() => {
      expect(screen.getByTestId('dish-photos-target-full-notice')).toBeTruthy();
      expect(screen.getByText('This visit log is full')).toBeTruthy();
      expect(screen.getByTestId('log-new-visit-btn')).toBeTruthy();
    });

    // Tap Log a new visit
    fireEvent.press(screen.getByTestId('log-new-visit-btn'));

    // Should open LogFoodItemModal
    await waitFor(() => {
      expect(screen.getByTestId('log-food-item-modal')).toBeTruthy();
    });
  });
});
