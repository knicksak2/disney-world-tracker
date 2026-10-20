import React from 'react';
import { Alert, StyleSheet, type AlertButton } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  FoodItemDTO,
  FoodItemLogHistoryDTO,
  FoodItemLogWithContextDTO,
  MyPhotoDTO,
  PhotoPageDTO,
} from '@dwt/shared';
import * as clientModule from '../../api/client';
import { lightTheme, darkTheme } from '../../theme/theme';
import { setTestScheme, resetTestScheme } from '../../test/themeTestUtils';
import { FoodLogPhotos } from '../FoodLogPhotos';
import FoodItemLogHistorySheet from '../../screens/catalog/FoodItemLogHistorySheet';
import MyFoodHistoryScreen from '../../screens/catalog/MyFoodHistoryScreen';
import RestaurantFoodLogsSheet from '../../screens/catalog/RestaurantFoodLogsSheet';

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

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      goBack: jest.fn(),
      navigate: jest.fn(),
    }),
  };
});

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

// ---------------------------------------------------------------------------
// Realistic fixtures: the server stores a food_log photo with
//   targetId = the LOG id, scopeId = the FOOD ITEM (dish) id  (R4.11).
// Log ids and the food item id are deliberately all different.
// ---------------------------------------------------------------------------

const FOOD_ITEM_ID = 'dish-1';
const LOG_A = 'log-100';
const LOG_B = 'log-200';
const LOG_EMPTY = 'log-300';

/** The only list URL the real server would answer with data (scope = food item id). */
const SCOPED_PHOTOS_URL = `/me/photos?targetKind=food_log&scopeId=${FOOD_ITEM_ID}`;

const MOCK_FOOD_ITEM: FoodItemDTO = {
  id: FOOD_ITEM_ID,
  experienceId: 'exp-1',
  locationId: null,
  name: 'Mickey Waffle',
  price: '$12.99',
  source: 'menu_sync',
  currentlyOnMenu: true,
};

const MOCK_LOG_HISTORY: FoodItemLogHistoryDTO = {
  foodItemId: FOOD_ITEM_ID,
  repeatCount: 1,
  logs: [
    {
      id: LOG_A,
      userId: 'user-me',
      foodItemId: FOOD_ITEM_ID,
      visitedOn: '2026-10-18',
      userTz: 'America/New_York',
      loggedAt: '2026-10-18T10:00:00Z',
      rating: 10,
      note: 'Best breakfast ever',
    },
  ],
};

function makePhoto(overrides: Partial<MyPhotoDTO> & Pick<MyPhotoDTO, 'id'>): MyPhotoDTO {
  return {
    targetKind: 'food_log',
    targetId: LOG_A,
    scopeId: FOOD_ITEM_ID,
    status: 'approved',
    rejectReason: null,
    rejectMessage: null,
    thumbUrl: `http://cdn.test/${overrides.id}_thumb.jpg`,
    url: `http://cdn.test/${overrides.id}.jpg`,
    width: 1000,
    height: 1000,
    feedItemId: null,
    createdAt: '2026-10-18T10:05:00Z',
    ...overrides,
  };
}

const APPROVED_A = makePhoto({ id: 'photo-approved-1' });
const REJECTED_A = makePhoto({
  id: 'photo-rejected-1',
  status: 'rejected',
  rejectReason: 'too_much_text',
  rejectMessage: 'Receipt text occupies > 20% of image',
  createdAt: '2026-10-18T10:06:00Z',
});
const APPROVED_B = makePhoto({ id: 'photo-approved-b', targetId: LOG_B });
const REJECTED_B = makePhoto({
  id: 'photo-rejected-b',
  targetId: LOG_B,
  status: 'rejected',
  rejectReason: 'face_visible',
  rejectMessage: 'A face is visible in this photo',
});

const MOCK_PHOTOS_LIST: MyPhotoDTO[] = [APPROVED_A, REJECTED_A];

/** Answer `GET /me/photos` like the real server: only the food item scope returns rows. */
function answerPhotos(path: string, items: readonly MyPhotoDTO[]): PhotoPageDTO<MyPhotoDTO> {
  const matches = path === SCOPED_PHOTOS_URL;
  return { items: matches ? items : [], nextCursor: null };
}

function photoListCalls(spy: jest.SpyInstance): string[] {
  return spy.mock.calls
    .filter((c: unknown[]) => c[0] === 'GET' && typeof c[1] === 'string' && c[1].startsWith('/me/photos?'))
    .map((c: unknown[]) => String(c[1]));
}

function pressAlertButton(alertSpy: jest.SpyInstance, text: string): void {
  const buttons: AlertButton[] = alertSpy.mock.calls[0][2];
  const button = buttons.find((b) => b.text === text);
  button?.onPress?.();
}

describe('Own photos: status and delete (Task 13.7)', () => {
  let apiRequestSpy: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert');
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
    alertSpy.mockRestore();
  });

  describe('FoodLogPhotos scope contract (R4.11)', () => {
    it('queries by the FOOD ITEM id as scope (not the log id) and shows the rejected chip with its message', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path.startsWith('/me/photos')) {
          return Promise.resolve(answerPhotos(path, MOCK_PHOTOS_LIST));
        }
        return Promise.resolve([]);
      });

      render(<FoodLogPhotos logId={LOG_A} foodItemId={FOOD_ITEM_ID} />, {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(screen.getByTestId('photo-status-chip-photo-rejected-1')).toBeTruthy();
      });
      expect(screen.getByText('Receipt text occupies > 20% of image')).toBeTruthy();

      const urls = photoListCalls(apiRequestSpy);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url).toContain(`scopeId=${FOOD_ITEM_ID}`);
        expect(url).not.toContain(`scopeId=${LOG_A}`);
      }
    });

    it('with photos for two logs of the same dish, each instance renders only its own log photos', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path.startsWith('/me/photos')) {
          return Promise.resolve(
            answerPhotos(path, [APPROVED_A, REJECTED_A, APPROVED_B, REJECTED_B]),
          );
        }
        return Promise.resolve([]);
      });

      render(
        <>
          <FoodLogPhotos logId={LOG_A} foodItemId={FOOD_ITEM_ID} testID="photos-a" />
          <FoodLogPhotos logId={LOG_B} foodItemId={FOOD_ITEM_ID} testID="photos-b" />
        </>,
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(screen.getByTestId('photos-a')).toBeTruthy();
        expect(screen.getByTestId('photos-b')).toBeTruthy();
      });

      const a = within(screen.getByTestId('photos-a'));
      const b = within(screen.getByTestId('photos-b'));
      expect(a.getByTestId('photo-status-chip-photo-approved-1')).toBeTruthy();
      expect(a.getByTestId('photo-status-chip-photo-rejected-1')).toBeTruthy();
      expect(a.queryByTestId('photo-status-chip-photo-approved-b')).toBeNull();
      expect(a.queryByTestId('photo-status-chip-photo-rejected-b')).toBeNull();

      expect(b.getByTestId('photo-status-chip-photo-approved-b')).toBeTruthy();
      expect(b.getByTestId('photo-status-chip-photo-rejected-b')).toBeTruthy();
      expect(b.queryByTestId('photo-status-chip-photo-approved-1')).toBeNull();
      expect(b.queryByTestId('photo-status-chip-photo-rejected-1')).toBeNull();

      // Both logs share one cached query: a single scoped request.
      expect(photoListCalls(apiRequestSpy)).toEqual([SCOPED_PHOTOS_URL]);
    });

    it('renders nothing for a log that has no photos in the response', async () => {
      apiRequestSpy.mockImplementation((_method: string, path: string) => {
        if (path.startsWith('/me/photos')) {
          return Promise.resolve(answerPhotos(path, [APPROVED_A, REJECTED_A]));
        }
        return Promise.resolve([]);
      });

      render(<FoodLogPhotos logId={LOG_EMPTY} foodItemId={FOOD_ITEM_ID} />, {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(photoListCalls(apiRequestSpy)).toEqual([SCOPED_PHOTOS_URL]);
      });
      // Let the resolved query settle into the component.
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByTestId(`food-log-photos-${LOG_EMPTY}`)).toBeNull();
      expect(screen.queryByTestId('photo-status-chip-photo-approved-1')).toBeNull();
      expect(screen.queryByTestId('photo-status-chip-photo-rejected-1')).toBeNull();
    });
  });

  describe('FoodLogPhotos own-photo card layout (Requirement 23.2)', () => {
    const LONG_REASON = "Photo has a person's face in it. Try framing just the dish.";
    const LONG_REJECTED = makePhoto({
      id: 'photo-rejected-long',
      status: 'rejected',
      rejectReason: 'face_visible',
      rejectMessage: LONG_REASON,
      thumbUrl: null,
      url: null,
    });
    const CHIP_ID = 'photo-status-chip-photo-rejected-long';
    const DELETE_ID = 'delete-photo-btn-photo-rejected-long';

    afterEach(() => {
      resetTestScheme();
    });

    function answerWith(items: readonly MyPhotoDTO[]): void {
      apiRequestSpy.mockImplementation((method: string, path: string) => {
        if (method === 'GET' && path.startsWith('/me/photos')) {
          return Promise.resolve(answerPhotos(path, items));
        }
        if (method === 'DELETE' && path === '/photos/photo-rejected-long') {
          return Promise.resolve(undefined);
        }
        return Promise.resolve([]);
      });
    }

    it('shows the short Rejected label with the x-circle icon, and the full reason as its own wrapping line', async () => {
      answerWith([LONG_REJECTED]);
      render(<FoodLogPhotos logId={LOG_A} foodItemId={FOOD_ITEM_ID} />, {
        wrapper: createWrapper(),
      });

      const chip = await screen.findByTestId(CHIP_ID);
      const inChip = within(chip);
      expect(inChip.getByText('Rejected')).toBeTruthy();
      expect(inChip.UNSAFE_getByType(Ionicons).props.name).toBe('close-circle-outline');

      // The full reason is its own element, never merged into the label and never clamped.
      const reason = screen.getByText(LONG_REASON);
      expect(reason).toBe(screen.getByTestId(`${CHIP_ID}-message`));
      expect(reason.props.numberOfLines).toBeUndefined();
      expect(screen.queryByText(`Rejected: ${LONG_REASON}`)).toBeNull();
      // Screen readers get label and reason together.
      expect(chip.props.accessibilityLabel).toBe(`Rejected: ${LONG_REASON}`);
      // The label itself is not clamped either.
      expect(inChip.getByText('Rejected').props.numberOfLines).toBeUndefined();
    });

    it('puts the delete button in its own row, outside the status row that holds the chip', async () => {
      answerWith([LONG_REJECTED]);
      render(<FoodLogPhotos logId={LOG_A} foodItemId={FOOD_ITEM_ID} />, {
        wrapper: createWrapper(),
      });

      const statusRow = await screen.findByTestId('photo-card-status-row-photo-rejected-long');
      const actionsRow = screen.getByTestId('photo-card-actions-row-photo-rejected-long');
      expect(statusRow).not.toBe(actionsRow);

      expect(within(statusRow).getByTestId(CHIP_ID)).toBeTruthy();
      expect(within(statusRow).queryByTestId(DELETE_ID)).toBeNull();
      expect(within(actionsRow).getByTestId(DELETE_ID)).toBeTruthy();
      expect(within(actionsRow).queryByTestId(CHIP_ID)).toBeNull();

      // Touch target is at least 40 px.
      const deleteStyle = StyleSheet.flatten(screen.getByTestId(DELETE_ID).props.style);
      expect(deleteStyle.minWidth).toBeGreaterThanOrEqual(40);
      expect(deleteStyle.minHeight).toBeGreaterThanOrEqual(40);
    });

    it('delete still asks for confirmation and then calls DELETE /photos/:id', async () => {
      answerWith([LONG_REJECTED]);
      render(<FoodLogPhotos logId={LOG_A} foodItemId={FOOD_ITEM_ID} />, {
        wrapper: createWrapper(),
      });

      fireEvent.press(await screen.findByTestId(DELETE_ID));
      expect(alertSpy).toHaveBeenCalledWith(
        'Delete Photo',
        'Are you sure you want to delete this photo?',
        expect.any(Array),
      );
      expect(apiRequestSpy).not.toHaveBeenCalledWith('DELETE', '/photos/photo-rejected-long');

      await act(async () => {
        pressAlertButton(alertSpy, 'Delete');
      });
      expect(apiRequestSpy).toHaveBeenCalledWith('DELETE', '/photos/photo-rejected-long');
    });

    it('still renders label and icon for pending and approved photos', async () => {
      const pending = makePhoto({ id: 'photo-pending-x', status: 'pending', thumbUrl: null, url: null });
      apiRequestSpy.mockImplementation((method: string, path: string) => {
        if (method === 'GET' && path.startsWith('/me/photos/status')) {
          return Promise.resolve({ photos: [] });
        }
        if (method === 'GET' && path.startsWith('/me/photos')) {
          return Promise.resolve(answerPhotos(path, [APPROVED_A, pending]));
        }
        return Promise.resolve([]);
      });
      render(<FoodLogPhotos logId={LOG_A} foodItemId={FOOD_ITEM_ID} />, {
        wrapper: createWrapper(),
      });

      const approvedChip = await screen.findByTestId('photo-status-chip-photo-approved-1');
      expect(within(approvedChip).getByText('Approved')).toBeTruthy();
      expect(within(approvedChip).UNSAFE_getByType(Ionicons).props.name).toBe(
        'checkmark-circle-outline',
      );

      const pendingChip = screen.getByTestId('photo-status-chip-photo-pending-x');
      expect(within(pendingChip).getByText('Processing…')).toBeTruthy();
      expect(within(pendingChip).UNSAFE_getByType(Ionicons).props.name).toBe('time-outline');
      // No reason line for states that carry no message.
      expect(screen.queryByTestId('photo-status-chip-photo-pending-x-message')).toBeNull();
    });

    it('repaints the reason text with the dark theme colour when the scheme switches', async () => {
      resetTestScheme();
      answerWith([LONG_REJECTED]);
      render(<FoodLogPhotos logId={LOG_A} foodItemId={FOOD_ITEM_ID} />, {
        wrapper: createWrapper(),
      });

      const lightColor = StyleSheet.flatten((await screen.findByText(LONG_REASON)).props.style).color;
      expect(lightColor).toBe(lightTheme.color.danger);

      setTestScheme('dark');
      const darkColor = StyleSheet.flatten(screen.getByText(LONG_REASON).props.style).color;
      expect(darkColor).toBe(darkTheme.color.danger);
      expect(darkColor).not.toBe(lightColor);
    });
  });

  it('FoodItemLogHistorySheet renders photos per log with PhotoStatusChip and shows rejected reason message', async () => {
    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path.startsWith(`/me/food-items/${FOOD_ITEM_ID}/logs`)) {
        return Promise.resolve(MOCK_LOG_HISTORY);
      }
      if (path.startsWith('/me/photos')) {
        return Promise.resolve(answerPhotos(path, MOCK_PHOTOS_LIST));
      }
      return Promise.resolve([]);
    });

    render(
      <FoodItemLogHistorySheet
        foodItem={MOCK_FOOD_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
      { wrapper: createWrapper() }
    );

    // Verify approved photo chip
    await waitFor(() => {
      expect(screen.getByTestId('photo-status-chip-photo-approved-1')).toBeTruthy();
      expect(screen.getByText('Approved')).toBeTruthy();
    });

    // Verify rejected photo chip and reason message (Requirement 5.12)
    expect(screen.getByTestId('photo-status-chip-photo-rejected-1')).toBeTruthy();
    expect(screen.getByText('Receipt text occupies > 20% of image')).toBeTruthy();

    for (const url of photoListCalls(apiRequestSpy)) {
      expect(url).toContain(`scopeId=${FOOD_ITEM_ID}`);
      expect(url).not.toContain(`scopeId=${LOG_A}`);
    }
  });

  it('delete photo prompts confirmation alert, cancelling does not call DELETE, confirming calls DELETE and refetches the food-item-scoped list', async () => {
    let currentPhotos = [...MOCK_PHOTOS_LIST];

    apiRequestSpy.mockImplementation((method: string, path: string) => {
      if (path.startsWith(`/me/food-items/${FOOD_ITEM_ID}/logs`)) {
        return Promise.resolve(MOCK_LOG_HISTORY);
      }
      if (method === 'GET' && path.startsWith('/me/photos')) {
        return Promise.resolve(answerPhotos(path, currentPhotos));
      }
      if (method === 'DELETE' && path === '/photos/photo-rejected-1') {
        currentPhotos = currentPhotos.filter((p) => p.id !== 'photo-rejected-1');
        return Promise.resolve(undefined);
      }
      return Promise.resolve([]);
    });

    render(
      <FoodItemLogHistorySheet
        foodItem={MOCK_FOOD_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('delete-photo-btn-photo-rejected-1')).toBeTruthy();
    });
    const listCallsBeforeDelete = photoListCalls(apiRequestSpy).length;

    // 1. Press delete button
    fireEvent.press(screen.getByTestId('delete-photo-btn-photo-rejected-1'));

    // 2. Alert prompted
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Photo',
      'Are you sure you want to delete this photo?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Delete', style: 'destructive' }),
      ])
    );

    // Cancel without deleting
    pressAlertButton(alertSpy, 'Cancel');
    expect(apiRequestSpy).not.toHaveBeenCalledWith('DELETE', '/photos/photo-rejected-1');

    // 3. Confirm deletion
    await act(async () => {
      pressAlertButton(alertSpy, 'Delete');
    });

    // 4. Assert DELETE /photos/photo-rejected-1 was called
    expect(apiRequestSpy).toHaveBeenCalledWith('DELETE', '/photos/photo-rejected-1');

    // 5. Photo disappears: the list was re-requested with the food item scope
    await waitFor(() => {
      expect(screen.queryByTestId('delete-photo-btn-photo-rejected-1')).toBeNull();
      expect(screen.queryByText('Receipt text occupies > 20% of image')).toBeNull();
    });
    const after = photoListCalls(apiRequestSpy);
    expect(after.length).toBeGreaterThan(listCallsBeforeDelete);
    expect(after.every((u) => u === SCOPED_PHOTOS_URL)).toBe(true);
  });

  it('polling updates a pending chip to approved and refetches the food-item-scoped list', async () => {
    const pendingPhoto = makePhoto({
      id: 'photo-pending-1',
      status: 'pending',
      thumbUrl: null,
      url: null,
      createdAt: '2026-10-18T10:10:00Z',
    });

    let statusQueried = false;

    apiRequestSpy.mockImplementation((_method: string, path: string) => {
      if (path.startsWith(`/me/food-items/${FOOD_ITEM_ID}/logs`)) {
        return Promise.resolve(MOCK_LOG_HISTORY);
      }
      if (path.startsWith('/me/photos/status')) {
        statusQueried = true;
        return Promise.resolve({
          photos: [
            makePhoto({
              id: 'photo-pending-1',
              status: 'approved',
              thumbUrl: 'http://cdn.test/approved_thumb.jpg',
              url: 'http://cdn.test/approved.jpg',
            }),
          ],
        });
      }
      if (path.startsWith('/me/photos')) {
        return Promise.resolve(answerPhotos(path, [pendingPhoto]));
      }
      return Promise.resolve([]);
    });

    render(
      <FoodItemLogHistorySheet
        foodItem={MOCK_FOOD_ITEM}
        visible={true}
        onClose={jest.fn()}
      />,
      { wrapper: createWrapper() }
    );

    // Initial state: Processing…
    await waitFor(() => {
      expect(screen.getByTestId('photo-status-chip-photo-pending-1')).toBeTruthy();
      expect(screen.getByText('Processing…')).toBeTruthy();
    });

    // After polling resolves, status changes to Approved (poll interval is 3s)
    await waitFor(
      () => {
        expect(statusQueried).toBe(true);
        expect(screen.getByText('Approved')).toBeTruthy();
      },
      { timeout: 5000 }
    );

    // The final-status invalidation must hit the real scope key: the list is refetched
    // with the food item scope (an un-matched prefix key would leave this at one call).
    await waitFor(() => {
      expect(photoListCalls(apiRequestSpy).length).toBeGreaterThanOrEqual(2);
    });
    expect(photoListCalls(apiRequestSpy).every((u) => u === SCOPED_PHOTOS_URL)).toBe(true);
  });

  it('MyFoodHistoryScreen also renders own photos and allows deletion', async () => {
    let currentPhotos = [APPROVED_A, REJECTED_A];

    apiRequestSpy.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/me/food-item-logs') {
        return Promise.resolve([
          {
            id: LOG_A,
            userId: 'user-me',
            foodItemId: FOOD_ITEM_ID,
            foodItemName: 'Mickey Waffle',
            restaurantName: 'Chef Mickey',
            locationName: null,
            currentlyOnMenu: true,
            visitedOn: '2026-10-18',
            userTz: 'America/New_York',
            loggedAt: '2026-10-18T10:00:00Z',
            rating: 10,
            note: 'Great breakfast!',
          },
        ]);
      }
      if (method === 'GET' && path.startsWith('/me/photos')) {
        return Promise.resolve(answerPhotos(path, currentPhotos));
      }
      if (method === 'DELETE' && path === '/photos/photo-approved-1') {
        currentPhotos = currentPhotos.filter((p) => p.id !== 'photo-approved-1');
        return Promise.resolve(undefined);
      }
      return Promise.resolve([]);
    });

    render(<MyFoodHistoryScreen />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('photo-status-chip-photo-approved-1')).toBeTruthy();
      expect(screen.getByText('Approved')).toBeTruthy();
    });
    // The rejected photo and its reason are shown on the history card too.
    expect(screen.getByTestId('photo-status-chip-photo-rejected-1')).toBeTruthy();
    expect(screen.getByText('Receipt text occupies > 20% of image')).toBeTruthy();
    for (const url of photoListCalls(apiRequestSpy)) {
      expect(url).toContain(`scopeId=${FOOD_ITEM_ID}`);
      expect(url).not.toContain(`scopeId=${LOG_A}`);
    }

    // Delete photo from history screen
    fireEvent.press(screen.getByTestId('delete-photo-btn-photo-approved-1'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Photo',
      expect.any(String),
      expect.any(Array)
    );

    await act(async () => {
      pressAlertButton(alertSpy, 'Delete');
    });

    expect(apiRequestSpy).toHaveBeenCalledWith('DELETE', '/photos/photo-approved-1');

    await waitFor(() => {
      expect(screen.queryByTestId('photo-status-chip-photo-approved-1')).toBeNull();
    });
  });

  it('RestaurantFoodLogsSheet shows the rejected chip and reason on the right log card only', async () => {
    const scopedLogs: readonly FoodItemLogWithContextDTO[] = [
      {
        id: LOG_A,
        userId: 'user-me',
        foodItemId: FOOD_ITEM_ID,
        foodItemName: 'Mickey Waffle',
        restaurantName: 'Chef Mickey',
        locationName: null,
        currentlyOnMenu: true,
        visitedOn: '2026-10-18',
        userTz: 'America/New_York',
        loggedAt: '2026-10-18T10:00:00Z',
        rating: 10,
        note: 'Great breakfast!',
      },
      {
        id: LOG_B,
        userId: 'user-me',
        foodItemId: FOOD_ITEM_ID,
        foodItemName: 'Mickey Waffle',
        restaurantName: 'Chef Mickey',
        locationName: null,
        currentlyOnMenu: true,
        visitedOn: '2026-10-19',
        userTz: 'America/New_York',
        loggedAt: '2026-10-19T10:00:00Z',
        rating: 7,
        note: null,
      },
    ];

    apiRequestSpy.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path === '/experiences/exp-1/food-item-logs/mine') {
        return Promise.resolve(scopedLogs);
      }
      if (method === 'GET' && path.startsWith('/me/photos')) {
        // Only log B (the second card) has a photo, and it was rejected.
        return Promise.resolve(answerPhotos(path, [REJECTED_B]));
      }
      return Promise.resolve([]);
    });

    render(
      <RestaurantFoodLogsSheet experienceId="exp-1" visible={true} onClose={jest.fn()} />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('photo-status-chip-photo-rejected-b')).toBeTruthy();
    });
    expect(screen.getByText('A face is visible in this photo')).toBeTruthy();

    // It sits on log B's card, not log A's.
    const cardB = within(screen.getByTestId(`scoped-food-log-card-${LOG_B}`));
    const cardA = within(screen.getByTestId(`scoped-food-log-card-${LOG_A}`));
    expect(cardB.getByTestId('photo-status-chip-photo-rejected-b')).toBeTruthy();
    expect(cardA.queryByTestId('photo-status-chip-photo-rejected-b')).toBeNull();

    // Both cards share one dish-scoped request.
    expect(photoListCalls(apiRequestSpy)).toEqual([SCOPED_PHOTOS_URL]);
  });
});
