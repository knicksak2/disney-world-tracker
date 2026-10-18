// Feature: friend-food-ratings, Task 8.4 — MenuScreen social proof interaction tests
//
// Validates:
//   Property 13: Read-only friend food ratings visibility
//   Property 15: Batch query efficiency and no background work
//   Property 17: Accessibility and display formatting
//   Requirements: 15.1, 15.3, 15.4, 15.5, 15.6, 17.1, 17.3

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import type {
  FoodItemDTO,
  FriendDishSocialProofDTO,
  FriendFoodSocialProofResponseDTO,
  MenuDTO,
} from '@dwt/shared';

import { describeSocialProof } from '../../friends/foodRatingFormat';

const EXPERIENCE_ID = 'exp-skipper-canteen';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

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

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    __esModule: true,
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
    useRoute: () => ({ params: { experienceId: EXPERIENCE_ID } }),
  };
});

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import MenuScreen from '../MenuScreen';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const SAMPLE_MENUS: readonly MenuDTO[] = [
  {
    menuType: 'Lunch',
    cuisineType: 'World Cuisine',
    groups: [
      {
        name: 'Appetizers',
        items: [
          { name: 'Lost and Found Soup', price: '$10' },
          { name: "Orinoco Ida's Cachapas", price: '$15' },
          { name: 'House Salad', price: '$8' },
        ],
      },
    ],
  },
];

const SAMPLE_FOOD_ITEMS: readonly FoodItemDTO[] = [
  {
    id: 'food-soup-1',
    experienceId: EXPERIENCE_ID,
    locationId: null,
    name: 'Lost and Found Soup',
    price: '$10',
    source: 'menu_sync',
    currentlyOnMenu: true,
  },
  {
    id: 'food-cachapas-2',
    experienceId: EXPERIENCE_ID,
    locationId: null,
    name: "Orinoco Ida's Cachapas",
    price: '$15',
    source: 'menu_sync',
    currentlyOnMenu: true,
  },
  {
    id: 'food-salad-3',
    experienceId: EXPERIENCE_ID,
    locationId: null,
    name: 'House Salad',
    price: '$8',
    source: 'menu_sync',
    currentlyOnMenu: true,
  },
];

const SAMPLE_SOCIAL_PROOF_SOUP: FriendDishSocialProofDTO = {
  foodItemId: 'food-soup-1',
  friendCount: 5,
  friendsAverageRating: 8.5,
  friends: [
    {
      friendId: 'f1',
      displayName: 'Sam',
      avatarPreset: null,
      averageRating: 9.0,
      ratedLogCount: 2,
      logCount: 2,
      latestVisitedOn: '2026-05-01',
    },
    {
      friendId: 'f2',
      displayName: 'Alex',
      avatarPreset: null,
      averageRating: 8.5,
      ratedLogCount: 1,
      logCount: 1,
      latestVisitedOn: '2026-04-15',
    },
    {
      friendId: 'f3',
      displayName: 'Taylor',
      avatarPreset: null,
      averageRating: 8.0,
      ratedLogCount: 1,
      logCount: 1,
      latestVisitedOn: '2026-03-20',
    },
  ],
};

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MenuScreen />
    </QueryClientProvider>,
  );
}

describe('MenuScreen — Friend Food Social Proof (Phase 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Feature: friend-food-ratings, Property 15: Batch query efficiency and no background work
  it('issues exactly ONE batch request per menu load regardless of row count (R15.1)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === `/catalog/${EXPERIENCE_ID}`) {
        return Promise.resolve({
          id: EXPERIENCE_ID,
          name: 'Jungle Navigation Co. LTD Skipper Canteen',
          menus: SAMPLE_MENUS,
        });
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-items`) {
        return Promise.resolve({ items: SAMPLE_FOOD_ITEMS });
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-item-logs/friends`) {
        const response: FriendFoodSocialProofResponseDTO = {
          items: [SAMPLE_SOCIAL_PROOF_SOUP],
        };
        return Promise.resolve(response);
      }
      return Promise.resolve([]);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Lost and Found Soup')).toBeTruthy();
      expect(screen.getByText("Orinoco Ida's Cachapas")).toBeTruthy();
      expect(screen.getByText('House Salad')).toBeTruthy();
    });

    // Exactly one batch request for the entire menu (not per-row)
    const batchProofCalls = apiRequestMock.mock.calls.filter(
      ([method, path]) =>
        method === 'GET' &&
        path === `/experiences/${EXPERIENCE_ID}/food-item-logs/friends`,
    );
    expect(batchProofCalls).toHaveLength(1);
    expect(batchProofCalls[0]![0]).toBe('GET');
    expect(batchProofCalls[0]![1]).toBe(
      `/experiences/${EXPERIENCE_ID}/food-item-logs/friends`,
    );
  });

  // Feature: friend-food-ratings, Property 17: Accessibility and display formatting
  it('renders social proof chip with avatars, text rating, overflow count, and describeSocialProof a11y label (R15.3, R17.3)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === `/catalog/${EXPERIENCE_ID}`) {
        return Promise.resolve({
          id: EXPERIENCE_ID,
          name: 'Jungle Navigation Co. LTD Skipper Canteen',
          menus: SAMPLE_MENUS,
        });
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-items`) {
        return Promise.resolve({ items: SAMPLE_FOOD_ITEMS });
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-item-logs/friends`) {
        return Promise.resolve({
          items: [SAMPLE_SOCIAL_PROOF_SOUP],
        });
      }
      return Promise.resolve([]);
    });

    renderScreen();

    const chip = await screen.findByTestId('friend-dish-social-proof-food-soup-1');
    expect(chip).toBeTruthy();

    // AccessibilityRole and accessibilityLabel assertions
    expect(chip.props.accessibilityRole).toBe('summary');

    const expectedA11yLabel = describeSocialProof({
      foodItemName: 'Lost and Found Soup',
      friendsAverageRating: SAMPLE_SOCIAL_PROOF_SOUP.friendsAverageRating,
      friendCount: SAMPLE_SOCIAL_PROOF_SOUP.friendCount,
      friends: SAMPLE_SOCIAL_PROOF_SOUP.friends,
    });
    expect(chip.props.accessibilityLabel).toBe(expectedA11yLabel);

    // Friends' names asserted in accessibility label
    expect(chip.props.accessibilityLabel).toContain('Sam');
    expect(chip.props.accessibilityLabel).toContain('Alex');
    expect(chip.props.accessibilityLabel).toContain('Taylor');

    // On-screen summary text (honest count: 5 friends total, first friend + 4 friends)
    expect(screen.getByText('Sam and 4 friends · 8.5/10')).toBeTruthy();

    // Overflow count badge: 5 friends total - 3 displayed = +2 overflow
    const overflowBadge = screen.getByTestId(
      'friend-dish-social-proof-food-soup-1-overflow',
    );
    expect(overflowBadge).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();

    // Avatars/initials rendered
    expect(screen.getByText('S')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('T')).toBeTruthy();
  });

  // Feature: friend-food-ratings, Property 13: Read-only friend food ratings visibility
  it('dishes without a social proof entry render unchanged with no proof element (R15.4)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === `/catalog/${EXPERIENCE_ID}`) {
        return Promise.resolve({
          id: EXPERIENCE_ID,
          name: 'Jungle Navigation Co. LTD Skipper Canteen',
          menus: SAMPLE_MENUS,
        });
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-items`) {
        return Promise.resolve({ items: SAMPLE_FOOD_ITEMS });
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-item-logs/friends`) {
        return Promise.resolve({
          items: [SAMPLE_SOCIAL_PROOF_SOUP], // Only soup has proof; cachapas and salad do not
        });
      }
      return Promise.resolve([]);
    });

    renderScreen();

    await screen.findByTestId('friend-dish-social-proof-food-soup-1');

    // Unannotated dishes must NOT contain any social-proof element
    expect(
      screen.queryByTestId('friend-dish-social-proof-food-cachapas-2'),
    ).toBeNull();
    expect(
      screen.queryByTestId('friend-dish-social-proof-food-salad-3'),
    ).toBeNull();

    // But their ordinary item rows, names, and prices are rendered exactly as today
    expect(screen.getByText("Orinoco Ida's Cachapas")).toBeTruthy();
    expect(screen.getByText('$15')).toBeTruthy();
    expect(screen.getByText('House Salad')).toBeTruthy();
    expect(screen.getByText('$8')).toBeTruthy();
  });

  it('failure of the proof request does not break the menu and shows no banner (R15.5)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === `/catalog/${EXPERIENCE_ID}`) {
        return Promise.resolve({
          id: EXPERIENCE_ID,
          name: 'Jungle Navigation Co. LTD Skipper Canteen',
          menus: SAMPLE_MENUS,
        });
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-items`) {
        return Promise.resolve({ items: SAMPLE_FOOD_ITEMS });
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-item-logs/friends`) {
        return Promise.reject(
          new ApiError({
            code: 'internal_error',
            message: 'Proof fetch failed',
            status: 500,
          }),
        );
      }
      return Promise.resolve([]);
    });

    renderScreen();

    // Menu still renders normally
    await waitFor(() => {
      expect(
        screen.getByText('Jungle Navigation Co. LTD Skipper Canteen'),
      ).toBeTruthy();
      expect(screen.getByText('Lost and Found Soup')).toBeTruthy();
      expect(screen.getByText("Orinoco Ida's Cachapas")).toBeTruthy();
    });

    // No error banner on the screen
    expect(screen.queryByTestId('menu-error')).toBeNull();

    // No social proof chip on error
    expect(
      screen.queryByTestId('friend-dish-social-proof-food-soup-1'),
    ).toBeNull();
  });

  it('rendering or interacting with menu issues no additional batch requests (R15.6)', async () => {
    apiRequestMock.mockImplementation((_method, path) => {
      if (path === `/catalog/${EXPERIENCE_ID}`) {
        return Promise.resolve({
          id: EXPERIENCE_ID,
          name: 'Jungle Navigation Co. LTD Skipper Canteen',
          menus: SAMPLE_MENUS,
        });
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-items`) {
        return Promise.resolve({ items: SAMPLE_FOOD_ITEMS });
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-item-logs/friends`) {
        return Promise.resolve({
          items: [SAMPLE_SOCIAL_PROOF_SOUP],
        });
      }
      return Promise.resolve([]);
    });

    renderScreen();

    await screen.findByTestId('friend-dish-social-proof-food-soup-1');

    const batchProofCalls = apiRequestMock.mock.calls.filter(
      ([method, path]) =>
        method === 'GET' &&
        path === `/experiences/${EXPERIENCE_ID}/food-item-logs/friends`,
    );
    expect(batchProofCalls).toHaveLength(1);
  });
});
