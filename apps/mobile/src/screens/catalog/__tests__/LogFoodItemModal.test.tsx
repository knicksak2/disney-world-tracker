// Feature: food-item-logging, Task 7.7 — LogFoodItemModal interaction tests
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 5.3, 5.4, 5.7

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { FoodItemDTO, FoodItemLogDTO } from '@dwt/shared';

import { darkTheme } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { LOG_FOOD } from '../LogFoodItemModal.palette';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
        uri: 'file://photo-1.jpg',
        width: 1000,
        height: 800,
        takenAt: '2026-09-14T12:00:00Z',
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

import LogFoodItemModal from '../LogFoodItemModal';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

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

const MOCK_ITEM: FoodItemDTO = {
  id: 'item-100',
  experienceId: 'exp-100',
  locationId: null,
  name: 'Cheshire Cat Tail',
  price: '$5.79',
  source: 'menu_sync',
  currentlyOnMenu: true,
};

const MOCK_STALE_ITEM: FoodItemDTO = {
  ...MOCK_ITEM,
  id: 'item-200',
  name: 'Discontinued Pastry',
  currentlyOnMenu: false,
};

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

describe('LogFoodItemModal', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.setItem('photos.disclosure.v1', 'true');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/photos/config') {
        return DEFAULT_PHOTO_CONFIG;
      }
      return undefined;
    });
  });

  it('renders dish name, visit date field, rating buttons 1-10, and note input', () => {
    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Cheshire Cat Tail')).toBeTruthy();
    expect(screen.getByText('Log Dish Visit')).toBeTruthy();
    expect(screen.getByText('Visit Date')).toBeTruthy();
    expect(screen.getByTestId('log-food-item-note-input')).toBeTruthy();

    // Check all rating buttons 1-10 exist
    for (let i = 1; i <= 10; i++) {
      expect(screen.getByTestId(`rating-btn-${i}`)).toBeTruthy();
    }

    expect(screen.getByTestId('log-food-item-scroll').props.keyboardShouldPersistTaps).toBe(
      'handled',
    );
  });

  it('renders "Not currently on menu" indicator when item is not on current menu', () => {
    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_STALE_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('log-food-item-not-on-menu')).toBeTruthy();
    expect(screen.getByText('Not currently on menu')).toBeTruthy();
  });

  it('toggles rating selection and clears rating', () => {
    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    const btn8 = screen.getByTestId('rating-btn-8');
    fireEvent.press(btn8);

    expect(screen.getByText('Rating (8/10)')).toBeTruthy();
    expect(screen.getByTestId('clear-rating-btn')).toBeTruthy();

    // Tapping clear button clears the rating
    fireEvent.press(screen.getByTestId('clear-rating-btn'));
    expect(screen.getByText('Rating (Optional)')).toBeTruthy();

    // Tapping rating button 7 selects 7, tapping it again deselects
    const btn7 = screen.getByTestId('rating-btn-7');
    fireEvent.press(btn7);
    expect(screen.getByText('Rating (7/10)')).toBeTruthy();
    fireEvent.press(btn7);
    expect(screen.getByText('Rating (Optional)')).toBeTruthy();
  });

  it('submits a food log successfully and invalidates relevant queries', async () => {
    const mockCreatedLog: FoodItemLogDTO = {
      id: 'log-999',
      userId: 'user-1',
      foodItemId: 'item-100',
      visitedOn: '2026-09-14',
      userTz: 'America/New_York',
      loggedAt: '2026-09-14T20:00:00Z',
      rating: 9,
      note: 'Super flaky and warm!',
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/photos/config') {
        return DEFAULT_PHOTO_CONFIG;
      }
      if (method === 'POST' && path.includes('/logs')) {
        return mockCreatedLog;
      }
      return undefined;
    });

    const onClose = jest.fn();
    const onLogged = jest.fn();

    const { queryClient } = renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={onClose}
        onLogged={onLogged}
      />,
    );

    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    // Select rating 9
    fireEvent.press(screen.getByTestId('rating-btn-9'));

    // Enter note
    fireEvent.changeText(
      screen.getByTestId('log-food-item-note-input'),
      'Super flaky and warm!',
    );

    // Press submit
    fireEvent.press(screen.getByTestId('submit-log-food-item-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/food-items/item-100/logs',
        expect.objectContaining({
          rating: 9,
          note: 'Super flaky and warm!',
        }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['food-item-logs', 'item-100'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['experience-food-items', 'exp-100'],
      });
      expect(onLogged).toHaveBeenCalledWith(mockCreatedLog);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('displays error when server returns food_log_future_date', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/photos/config') {
        return DEFAULT_PHOTO_CONFIG;
      }
      if (method === 'POST' && path.includes('/logs')) {
        throw new ApiError({
          code: 'food_log_future_date',
          message: 'Visit date cannot be in the future',
          status: 400,
        });
      }
      return undefined;
    });

    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId('submit-log-food-item-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('log-food-item-error')).toBeTruthy();
      expect(screen.getByText('Visit date cannot be in the future')).toBeTruthy();
    });
  });

  it('displays rate limit error when server returns rate_limit_exceeded', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/photos/config') {
        return DEFAULT_PHOTO_CONFIG;
      }
      if (method === 'POST' && path.includes('/logs')) {
        throw new ApiError({
          code: 'rate_limit_exceeded',
          message: 'Too many requests. Please try again in 1 minute.',
          status: 429,
        });
      }
      return undefined;
    });

    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId('submit-log-food-item-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('log-food-item-error')).toBeTruthy();
      expect(
        screen.getByText('Too many requests. Please wait a moment and try again.'),
      ).toBeTruthy();
    });
  });

  it('saving a log with two photos calls the log POST, then initiate with target food_log and the new log id, then confirm', async () => {
    const mockCreatedLog: FoodItemLogDTO = {
      id: 'log-1234',
      userId: 'user-1',
      foodItemId: 'item-100',
      visitedOn: '2026-09-14',
      userTz: 'America/New_York',
      loggedAt: '2026-09-14T20:00:00Z',
      rating: 8,
      note: 'Delicious!',
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/photos/config') {
        return DEFAULT_PHOTO_CONFIG;
      }
      if (method === 'POST' && path.includes('/logs')) {
        return mockCreatedLog;
      }
      if (method === 'POST' && path === '/photos/uploads') {
        return {
          slots: [
            {
              photoId: 'photo-1',
              putUrl: 'http://store.local/u/photo-1/full.jpg',
              thumbPutUrl: 'http://store.local/u/photo-1/thumb.jpg',
              expiresAt: '2026-09-14T21:00:00Z',
            },
            {
              photoId: 'photo-2',
              putUrl: 'http://store.local/u/photo-2/full.jpg',
              thumbPutUrl: 'http://store.local/u/photo-2/thumb.jpg',
              expiresAt: '2026-09-14T21:00:00Z',
            },
          ],
        };
      }
      if (method === 'POST' && path === '/photos/confirm') {
        return {
          results: [
            { photoId: 'photo-1', result: 'accepted' },
            { photoId: 'photo-2', result: 'accepted' },
          ],
        };
      }
      return undefined;
    });

    const onLogged = jest.fn();
    const onClose = jest.fn();

    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={onClose}
        onLogged={onLogged}
      />,
    );

    await screen.findByTestId('log-food-add-photo-btn');

    // Add first photo
    fireEvent.press(screen.getByTestId('log-food-add-photo-btn'));
    fireEvent.press(await screen.findByTestId('choose-from-library-button'));
    const confirmBtn1 = await screen.findByTestId('confirm-photo-upload-button');
    await waitFor(() => expect(confirmBtn1.props.accessibilityState.disabled).toBe(false));
    fireEvent.press(confirmBtn1);

    expect(await screen.findByTestId('log-food-photo-preview-0')).toBeTruthy();

    // Add second photo
    fireEvent.press(screen.getByTestId('log-food-add-photo-btn'));
    fireEvent.press(await screen.findByTestId('choose-from-library-button'));
    const confirmBtn2 = await screen.findByTestId('confirm-photo-upload-button');
    await waitFor(() => expect(confirmBtn2.props.accessibilityState.disabled).toBe(false));
    fireEvent.press(confirmBtn2);

    expect(await screen.findByTestId('log-food-photo-preview-1')).toBeTruthy();

    // Save log
    fireEvent.press(screen.getByTestId('submit-log-food-item-btn'));

    await waitFor(() => {
      // 1. Log POST
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/food-items/item-100/logs',
        expect.any(Object),
      );
      // 2. Initiate with target food_log and new log id
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/photos/uploads',
        expect.objectContaining({
          target: { kind: 'food_log', id: 'log-1234' },
          items: expect.arrayContaining([
            expect.objectContaining({ contentType: 'image/jpeg' }),
            expect.objectContaining({ contentType: 'image/jpeg' }),
          ]),
        }),
      );
      // 3. Confirm
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/photos/confirm',
        expect.objectContaining({
          photoIds: ['photo-1', 'photo-2'],
        }),
      );
      expect(onLogged).toHaveBeenCalledWith(mockCreatedLog);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('the photo control is hidden when the config says food is disabled', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/photos/config') {
        return {
          ...DEFAULT_PHOTO_CONFIG,
          foodEnabled: false,
        };
      }
      return undefined;
    });

    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('log-food-photos-section')).toBeNull();
      expect(screen.queryByTestId('log-food-add-photo-btn')).toBeNull();
    });
  });

  it('reaching the per-log cap disables adding more with a visible explanation', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/photos/config') {
        return {
          ...DEFAULT_PHOTO_CONFIG,
          maxPerFoodLog: 2,
        };
      }
      return undefined;
    });

    renderWithClient(
      <LogFoodItemModal
        foodItem={MOCK_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
    );

    await screen.findByTestId('log-food-add-photo-btn');

    // Add photo 1
    fireEvent.press(screen.getByTestId('log-food-add-photo-btn'));
    fireEvent.press(await screen.findByTestId('choose-from-library-button'));
    const confirmBtn1 = await screen.findByTestId('confirm-photo-upload-button');
    await waitFor(() => expect(confirmBtn1.props.accessibilityState.disabled).toBe(false));
    fireEvent.press(confirmBtn1);
    expect(await screen.findByTestId('log-food-photo-preview-0')).toBeTruthy();

    expect(screen.queryByTestId('log-food-photo-cap-reached')).toBeNull();
    expect(screen.getByTestId('log-food-add-photo-btn').props.accessibilityState.disabled).toBe(false);

    // Add photo 2 (reaches cap of 2)
    fireEvent.press(screen.getByTestId('log-food-add-photo-btn'));
    fireEvent.press(await screen.findByTestId('choose-from-library-button'));
    const confirmBtn2 = await screen.findByTestId('confirm-photo-upload-button');
    await waitFor(() => expect(confirmBtn2.props.accessibilityState.disabled).toBe(false));
    fireEvent.press(confirmBtn2);
    expect(await screen.findByTestId('log-food-photo-preview-1')).toBeTruthy();

    const capMsg = await screen.findByTestId('log-food-photo-cap-reached');
    expect(capMsg).toBeTruthy();
    expect(screen.getByText('Maximum 2 photos per dish visit reached.')).toBeTruthy();
    expect(screen.getByTestId('log-food-add-photo-btn').props.accessibilityState.disabled).toBe(true);
  });
});

/** Nearest painted `backgroundColor` at or above `node` (sheet surface lookup). */
function paintedBackground(node: ReactTestInstance | null): unknown {
  for (let n = node; n !== null; n = n.parent) {
    const style = n.props.style;
    if (style === undefined || typeof style === 'function') continue;
    const flat = StyleSheet.flatten(style) as { backgroundColor?: unknown } | undefined;
    if (flat?.backgroundColor !== undefined) return flat.backgroundColor;
  }
  return undefined;
}

describe('LogFoodItemModal — dark mode', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.setItem('photos.disclosure.v1', 'true');
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/photos/config') {
        return DEFAULT_PHOTO_CONFIG;
      }
      return undefined;
    });
  });
  afterEach(resetTestScheme);

  it('paints the sheet, title, selected rating and error banner with dark values', async () => {
    setTestScheme('dark');
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/photos/config') {
        return DEFAULT_PHOTO_CONFIG;
      }
      if (method === 'POST' && path.includes('/logs')) {
        throw new ApiError({ code: 'food_log_future_date', message: 'x', status: 400 });
      }
      return undefined;
    });
    renderWithClient(<LogFoodItemModal foodItem={MOCK_ITEM} visible={true} onClose={jest.fn()} />);

    const title = screen.getByText('Cheshire Cat Tail');
    // (a) sheet surface, (b) primary text.
    expect(paintedBackground(title)).toBe(darkTheme.color.surface);
    expect(StyleSheet.flatten(title.props.style).color).toBe(darkTheme.color.textPrimary);

    // (c) the selected rating tile is a primary fill with textOnPrimary text.
    fireEvent.press(screen.getByTestId('rating-btn-8'));
    expect(StyleSheet.flatten(screen.getByTestId('rating-btn-8').props.style).backgroundColor).toBe(
      darkTheme.color.primary,
    );
    const note = screen.getByTestId('log-food-item-note-input');
    expect(note.props.keyboardAppearance).toBe('dark');
    expect(StyleSheet.flatten(note.props.style).backgroundColor).toBe(darkTheme.color.surfaceAlt);

    // (c) the error banner's red tint (rule 3 role S) is the palette's dark value.
    fireEvent.press(screen.getByTestId('submit-log-food-item-btn'));
    const banner = await screen.findByTestId('log-food-item-error');
    expect(StyleSheet.flatten(banner.props.style).backgroundColor).toBe(LOG_FOOD.dark.errorBannerBg);
  });
});
