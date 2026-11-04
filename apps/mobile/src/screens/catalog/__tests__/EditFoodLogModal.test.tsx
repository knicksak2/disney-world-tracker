// Feature: food-item-logging — EditFoodLogModal interaction tests
//
// Validates: Requirements 4.5, 4.7, 5.11, 8.11, 9.9, Property 14

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { FoodItemLogDTO } from '@dwt/shared';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('../../../photos/photoPicker', () => ({
  ...jest.requireActual('../../../photos/photoPicker'),
  requestLibraryPermission: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  requestCameraPermission: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  pickFromLibrary: jest.fn().mockResolvedValue({
    canceled: false,
    photos: [
      {
        uri: 'file://new-photo.jpg',
        width: 1000,
        height: 800,
        takenAt: '2026-10-18T12:00:00Z',
      },
    ],
  }),
}));

jest.mock('../../../photos/imagePrep', () => ({
  ...jest.requireActual('../../../photos/imagePrep'),
  prepareImage: jest.fn().mockImplementation(async (uri: string, width: number, height: number) => ({
    full: {
      uri: `${uri}-full.jpg`,
      width,
      height,
      blob: new Blob(['full-bytes'], { type: 'image/jpeg' }),
    },
    thumb: {
      uri: `${uri}-thumb.jpg`,
      width: 320,
      height: 240,
      blob: new Blob(['thumb-bytes'], { type: 'image/jpeg' }),
    },
  })),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import EditFoodLogModal, { type EditableFoodLogTarget } from '../EditFoodLogModal';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const DEFAULT_PHOTO_CONFIG = {
  enabled: true,
  foodEnabled: true,
  tripEnabled: true,
  maxPerFoodLog: 4,
  maxPerTrip: 300,
  remainingToday: 20,
  experienceStripMax: 8,
};

const MOCK_LOG: EditableFoodLogTarget = {
  id: 'log-1',
  foodItemId: 'item-100',
  foodItemName: 'Soft-serve Cup',
  restaurantName: 'Aloha Isle',
  locationName: null,
  visitedOn: '2026-10-18',
  userTz: 'America/New_York',
  rating: 10,
  note: 'good as always',
};

function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderModal(
  props: {
    log?: EditableFoodLogTarget | null;
    visible?: boolean;
    onClose?: () => void;
    onUpdated?: (log: FoodItemLogDTO) => void;
  } = {},
) {
  const queryClient = createTestClient();
  const onClose = props.onClose ?? jest.fn();
  const onUpdated = props.onUpdated ?? jest.fn();

  const result = render(
    <QueryClientProvider client={queryClient}>
      <EditFoodLogModal
        log={props.log === undefined ? MOCK_LOG : props.log}
        visible={props.visible ?? true}
        onClose={onClose}
        onUpdated={onUpdated}
      />
    </QueryClientProvider>,
  );

  return { ...result, onClose, onUpdated, queryClient };
}

describe('EditFoodLogModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/photos/config') return DEFAULT_PHOTO_CONFIG as never;
      if (typeof path === 'string' && path.includes('/me/photos?') && path.includes('food_log') && path.includes('item-100')) {
        return {
          items: [
            {
              id: 'photo-1',
              url: 'http://cdn/photo-1.jpg',
              thumbUrl: 'http://cdn/photo-1-thumb.jpg',
              width: 1000,
              height: 800,
              targetKind: 'food_log',
              targetId: 'log-1',
              status: 'ready',
              createdAt: '2026-10-18T10:00:00Z',
            },
          ],
        } as never;
      }
      return {} as never;
    });
  });

  it('renders prefilled dish name, restaurant, rating, and note', async () => {
    renderModal();

    expect(screen.getByText('Soft-serve Cup')).toBeTruthy();
    expect(screen.getByText('Edit Log · Aloha Isle')).toBeTruthy();
    expect(screen.getByTestId('edit-food-log-note-input').props.value).toBe('good as always');
    expect(screen.getByText('Rating (10/10)')).toBeTruthy();
  });

  it('does not render when visible is false or log is null', () => {
    const { toJSON } = renderModal({ visible: false });
    expect(toJSON()).toBeNull();
  });

  it('allows clearing rating and changing notes', async () => {
    renderModal();

    // Clear rating
    fireEvent.press(screen.getByTestId('edit-clear-rating-btn'));
    expect(screen.getByText('Rating (Optional)')).toBeTruthy();

    // Select rating 8
    fireEvent.press(screen.getByTestId('edit-rating-btn-8'));
    expect(screen.getByText('Rating (8/10)')).toBeTruthy();

    // Change note
    fireEvent.changeText(screen.getByTestId('edit-food-log-note-input'), 'Updated note text');
    expect(screen.getByTestId('edit-food-log-note-input').props.value).toBe('Updated note text');
  });

  it('submits update PATCH request with modified rating, note, and visitedOn', async () => {
    const updatedLog: FoodItemLogDTO = {
      id: 'log-1',
      userId: 'user-1',
      foodItemId: 'item-100',
      visitedOn: '2026-10-18',
      userTz: 'America/New_York',
      loggedAt: '2026-10-18T10:00:00Z',
      rating: 8,
      note: 'Super tasty update',
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/photos/config') return DEFAULT_PHOTO_CONFIG as never;
      if (typeof path === 'string' && path.includes('/me/photos?')) return { items: [] } as never;
      if (method === 'PATCH' && path === '/me/food-items/item-100/logs/log-1') {
        return updatedLog as never;
      }
      return {} as never;
    });

    const { onClose, onUpdated } = renderModal();

    fireEvent.press(screen.getByTestId('edit-rating-btn-8'));
    fireEvent.changeText(screen.getByTestId('edit-food-log-note-input'), 'Super tasty update');

    fireEvent.press(screen.getByTestId('submit-edit-food-log-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/food-items/item-100/logs/log-1',
        expect.objectContaining({
          rating: 8,
          note: 'Super tasty update',
          visitedOn: '2026-10-18',
        }),
      );
      expect(onUpdated).toHaveBeenCalledWith(updatedLog);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('deletes existing photo when removed and submitted', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/photos/config') return DEFAULT_PHOTO_CONFIG as never;
      if (typeof path === 'string' && path.includes('/me/photos?') && path.includes('food_log') && path.includes('item-100')) {
        return {
          items: [
            {
              id: 'photo-1',
              url: 'http://cdn/photo-1.jpg',
              thumbUrl: 'http://cdn/photo-1-thumb.jpg',
              width: 1000,
              height: 800,
              targetKind: 'food_log',
              targetId: 'log-1',
              status: 'ready',
              createdAt: '2026-10-18T10:00:00Z',
            },
          ],
        } as never;
      }
      if (method === 'DELETE' && typeof path === 'string' && path.includes('/photos/photo-1')) {
        return {} as never;
      }
      if (method === 'PATCH') {
        return { id: 'log-1' } as never;
      }
      return {} as never;
    });

    renderModal();

    await waitFor(() => {
      expect(screen.getByTestId('edit-food-photo-existing-photo-1')).toBeTruthy();
    });

    // Tap remove photo
    fireEvent.press(screen.getByTestId('remove-existing-photo-photo-1'));

    // Existing photo thumbnail disappears
    expect(screen.queryByTestId('edit-food-photo-existing-photo-1')).toBeNull();

    // Submit
    fireEvent.press(screen.getByTestId('submit-edit-food-log-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', '/photos/photo-1');
    });
  });

  it('cancels modal when Cancel button or close icon is pressed', () => {
    const { onClose } = renderModal();

    fireEvent.press(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('close-edit-food-log-btn'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
