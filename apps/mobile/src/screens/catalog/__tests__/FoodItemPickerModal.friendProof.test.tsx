// Feature: friend-food-ratings, Task 8.4 — FoodItemPickerModal social proof interaction tests
//
// Validates:
//   Property 13: Read-only friend food ratings visibility
//   Property 15: Batch query efficiency and no background work
//   Property 17: Accessibility and display formatting
//   Requirements: 15.2, 15.3, 15.4, 15.5, 15.6, 17.1, 17.3

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type {
  FoodItemDTO,
  FriendDishSocialProofDTO,
  FriendFoodSocialProofResponseDTO,
} from '@dwt/shared';

import { describeSocialProof } from '../../friends/foodRatingFormat';

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

import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import FoodItemPickerModal from '../FoodItemPickerModal';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const MOCK_ITEMS: readonly FoodItemDTO[] = [
  {
    id: 'item-1',
    experienceId: 'exp-1',
    locationId: null,
    name: 'Churro with Chocolate Sauce',
    price: '$6.50',
    source: 'menu_sync',
    currentlyOnMenu: true,
  },
  {
    id: 'item-2',
    experienceId: 'exp-1',
    locationId: null,
    name: 'Mickey Pretzel',
    price: '$7.75',
    source: 'menu_sync',
    currentlyOnMenu: true,
  },
  {
    id: 'item-3',
    experienceId: 'exp-1',
    locationId: null,
    name: 'Dole Whip',
    price: '$5.99',
    source: 'menu_sync',
    currentlyOnMenu: true,
  },
];

const SAMPLE_SOCIAL_PROOF_CHURRO: FriendDishSocialProofDTO = {
  foodItemId: 'item-1',
  friendCount: 4,
  friendsAverageRating: 9.2,
  friends: [
    {
      friendId: 'f1',
      displayName: 'Sam',
      avatarPreset: null,
      averageRating: 9.5,
      ratedLogCount: 2,
      logCount: 2,
      latestVisitedOn: '2026-06-01',
    },
    {
      friendId: 'f2',
      displayName: 'Maya',
      avatarPreset: null,
      averageRating: 9.0,
      ratedLogCount: 1,
      logCount: 1,
      latestVisitedOn: '2026-05-15',
    },
    {
      friendId: 'f3',
      displayName: 'Jordan',
      avatarPreset: null,
      averageRating: 9.1,
      ratedLogCount: 1,
      logCount: 1,
      latestVisitedOn: '2026-04-10',
    },
  ],
};

function renderPicker(props: Partial<React.ComponentProps<typeof FoodItemPickerModal>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <FoodItemPickerModal
          experienceId="exp-1"
          visible={true}
          onClose={jest.fn()}
          onSelectFoodItem={jest.fn()}
          {...props}
        />
      </QueryClientProvider>,
    ),
  };
}

describe('FoodItemPickerModal — Friend Food Social Proof (Phase 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Feature: friend-food-ratings, Property 15: Batch query efficiency and no background work
  it('issues exactly ONE batch request per picker open for experienceId scope (R15.2)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === '/experiences/exp-1/food-items') {
        return Promise.resolve({ items: MOCK_ITEMS });
      }
      if (path === '/experiences/exp-1/food-item-logs/friends') {
        const response: FriendFoodSocialProofResponseDTO = {
          items: [SAMPLE_SOCIAL_PROOF_CHURRO],
        };
        return Promise.resolve(response);
      }
      if (path.startsWith('/me/food-items/')) {
        return Promise.resolve({ foodItemId: 'x', repeatCount: 0, logs: [] });
      }
      return Promise.resolve([]);
    });

    renderPicker({ experienceId: 'exp-1' });

    await waitFor(() => {
      expect(screen.getByText('Churro with Chocolate Sauce')).toBeTruthy();
      expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
      expect(screen.getByText('Dole Whip')).toBeTruthy();
    });

    // Exactly one batch request for the picker (endpoint + params verified)
    const batchProofCalls = apiRequestMock.mock.calls.filter(
      ([method, path]) =>
        method === 'GET' && path === '/experiences/exp-1/food-item-logs/friends',
    );
    expect(batchProofCalls).toHaveLength(1);
    expect(batchProofCalls[0]![0]).toBe('GET');
    expect(batchProofCalls[0]![1]).toBe('/experiences/exp-1/food-item-logs/friends');
  });

  // Feature: friend-food-ratings, Property 15: Batch query efficiency and no background work
  it('issues exactly ONE batch request per picker open for locationId scope (R15.2)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === '/locations/loc-1/food-items') {
        return Promise.resolve({ items: MOCK_ITEMS });
      }
      if (path === '/locations/loc-1/food-item-logs/friends') {
        return Promise.resolve({ items: [SAMPLE_SOCIAL_PROOF_CHURRO] });
      }
      if (path.startsWith('/me/food-items/')) {
        return Promise.resolve({ foodItemId: 'x', repeatCount: 0, logs: [] });
      }
      return Promise.resolve([]);
    });

    renderPicker({ experienceId: undefined, locationId: 'loc-1' });

    await waitFor(() => {
      expect(screen.getByText('Churro with Chocolate Sauce')).toBeTruthy();
    });

    const batchProofCalls = apiRequestMock.mock.calls.filter(
      ([method, path]) =>
        method === 'GET' && path === '/locations/loc-1/food-item-logs/friends',
    );
    expect(batchProofCalls).toHaveLength(1);
    expect(batchProofCalls[0]![0]).toBe('GET');
    expect(batchProofCalls[0]![1]).toBe('/locations/loc-1/food-item-logs/friends');
  });

  // Feature: friend-food-ratings, Property 17: Accessibility and display formatting
  it('renders social proof chip with avatars, text rating, overflow count, and describeSocialProof a11y label (R15.3, R17.3)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === '/experiences/exp-1/food-items') {
        return Promise.resolve({ items: MOCK_ITEMS });
      }
      if (path === '/experiences/exp-1/food-item-logs/friends') {
        return Promise.resolve({ items: [SAMPLE_SOCIAL_PROOF_CHURRO] });
      }
      if (path.startsWith('/me/food-items/')) {
        return Promise.resolve({ foodItemId: 'x', repeatCount: 0, logs: [] });
      }
      return Promise.resolve([]);
    });

    renderPicker({ experienceId: 'exp-1' });

    const chip = await screen.findByTestId('friend-dish-social-proof-item-1');
    expect(chip).toBeTruthy();

    // AccessibilityRole and accessibilityLabel assertions
    expect(chip.props.accessibilityRole).toBe('summary');

    const expectedA11yLabel = describeSocialProof({
      foodItemName: 'Churro with Chocolate Sauce',
      friendsAverageRating: SAMPLE_SOCIAL_PROOF_CHURRO.friendsAverageRating,
      friendCount: SAMPLE_SOCIAL_PROOF_CHURRO.friendCount,
      friends: SAMPLE_SOCIAL_PROOF_CHURRO.friends,
    });
    expect(chip.props.accessibilityLabel).toBe(expectedA11yLabel);

    // Assert friends' names in label
    expect(chip.props.accessibilityLabel).toContain('Sam');
    expect(chip.props.accessibilityLabel).toContain('Maya');
    expect(chip.props.accessibilityLabel).toContain('Jordan');

    // On-screen summary text (honest count: 4 friends total, Sam and 3 friends)
    expect(screen.getByText('Sam and 3 friends · 9.2/10')).toBeTruthy();

    // Overflow count badge: 4 friends total - 3 displayed = +1 overflow
    const overflowBadge = screen.getByTestId(
      'friend-dish-social-proof-item-1-overflow',
    );
    expect(overflowBadge).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();

    // Avatars/initials rendered
    expect(screen.getByText('S')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.getByText('J')).toBeTruthy();
  });

  // Feature: friend-food-ratings, Property 13: Read-only friend food ratings visibility
  it('dishes without a social proof entry render unchanged with no proof element (R15.4)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === '/experiences/exp-1/food-items') {
        return Promise.resolve({ items: MOCK_ITEMS });
      }
      if (path === '/experiences/exp-1/food-item-logs/friends') {
        return Promise.resolve({ items: [SAMPLE_SOCIAL_PROOF_CHURRO] });
      }
      if (path.startsWith('/me/food-items/')) {
        return Promise.resolve({ foodItemId: 'x', repeatCount: 0, logs: [] });
      }
      return Promise.resolve([]);
    });

    renderPicker({ experienceId: 'exp-1' });

    await screen.findByTestId('friend-dish-social-proof-item-1');

    // Item 2 and 3 have no social proof
    expect(screen.queryByTestId('friend-dish-social-proof-item-2')).toBeNull();
    expect(screen.queryByTestId('friend-dish-social-proof-item-3')).toBeNull();

    // But render normally as today
    expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
    expect(screen.getByText('$7.75')).toBeTruthy();
    expect(screen.getByText('Dole Whip')).toBeTruthy();
    expect(screen.getByText('$5.99')).toBeTruthy();
  });

  it('failure of the proof request does not break the picker and shows no banner (R15.5)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === '/experiences/exp-1/food-items') {
        return Promise.resolve({ items: MOCK_ITEMS });
      }
      if (path === '/experiences/exp-1/food-item-logs/friends') {
        return Promise.reject(
          new ApiError({
            code: 'internal_error',
            message: 'Proof fetch failed',
            status: 500,
          }),
        );
      }
      if (path.startsWith('/me/food-items/')) {
        return Promise.resolve({ foodItemId: 'x', repeatCount: 0, logs: [] });
      }
      return Promise.resolve([]);
    });

    const onSelectFoodItem = jest.fn();
    renderPicker({ experienceId: 'exp-1', onSelectFoodItem });

    // Dish list still renders normally
    await waitFor(() => {
      expect(screen.getByText('Churro with Chocolate Sauce')).toBeTruthy();
      expect(screen.getByText('Mickey Pretzel')).toBeTruthy();
    });

    // No error banner
    expect(screen.queryByTestId('food-item-picker-error')).toBeNull();

    // Social proof chip not rendered
    expect(screen.queryByTestId('friend-dish-social-proof-item-1')).toBeNull();

    // Selecting a dish still works
    fireEvent.press(screen.getByText('Churro with Chocolate Sauce'));
    expect(onSelectFoodItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1', name: 'Churro with Chocolate Sauce' }),
    );
  });

  it('selecting or logging items issues no additional batch proof requests (R15.6)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === '/experiences/exp-1/food-items') {
        return Promise.resolve({ items: MOCK_ITEMS });
      }
      if (path === '/experiences/exp-1/food-item-logs/friends') {
        return Promise.resolve({ items: [SAMPLE_SOCIAL_PROOF_CHURRO] });
      }
      if (path.startsWith('/me/food-items/')) {
        return Promise.resolve({ foodItemId: 'x', repeatCount: 0, logs: [] });
      }
      return Promise.resolve([]);
    });

    const onSelectFoodItem = jest.fn();
    renderPicker({ experienceId: 'exp-1', onSelectFoodItem });

    await screen.findByTestId('friend-dish-social-proof-item-1');

    // Selecting a dish
    fireEvent.press(screen.getByText('Churro with Chocolate Sauce'));
    expect(onSelectFoodItem).toHaveBeenCalledTimes(1);

    // Call count on batch endpoint remains 1
    const batchProofCalls = apiRequestMock.mock.calls.filter(
      ([method, path]) =>
        method === 'GET' && path === '/experiences/exp-1/food-item-logs/friends',
    );
    expect(batchProofCalls).toHaveLength(1);
  });
});
