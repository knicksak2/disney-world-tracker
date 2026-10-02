// Feature: restaurant-menu-display / food-lists — Menu_Screen food list affordances
//
// Validates: Requirement 5.10 (restaurant-menu-display), Requirement 9.1 & 9.9 (food-lists)

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

import type { FoodItemDTO, FoodListDTO, FoodListDetailDTO, MenuDTO } from '@dwt/shared';

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

import { apiRequest as mockedApiRequest } from '../../../api/client';
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
];

const SAMPLE_OWNED_LISTS: readonly FoodListDTO[] = [
  {
    id: 'list-favs',
    ownerId: 'user-me',
    ownerDisplayName: 'Me',
    name: 'Favorite Disney Dishes',
    visibility: 'private',
    isChecklist: false,
    itemCount: 0,
    likeCount: 0,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    pinnedAt: null,
  },
];

const SAMPLE_LIST_DETAIL: FoodListDetailDTO = {
  id: 'list-favs',
  ownerId: 'user-me',
  ownerDisplayName: 'Me',
  name: 'Favorite Disney Dishes',
  visibility: 'private',
  isChecklist: false,
  itemCount: 0,
  likeCount: 0,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  pinnedAt: null,
  liked: false,
  saved: false,
  version: 1,
  myRole: 'owner',
  items: [],
};

function renderMenuScreen(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MenuScreen />
    </QueryClientProvider>,
  );
}

describe('MenuScreen food list affordances (R5.10, R9.1, R9.9)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    mockGoBack.mockReset();
    mockNavigate.mockReset();

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/catalog/${EXPERIENCE_ID}`) {
        return {
          id: EXPERIENCE_ID,
          name: 'Jungle Navigation Co. LTD Skipper Canteen',
          menus: SAMPLE_MENUS,
        };
      }
      if (path === `/experiences/${EXPERIENCE_ID}/food-items`) {
        return {
          items: SAMPLE_FOOD_ITEMS,
          menus: SAMPLE_MENUS,
        };
      }
      if (path === '/me/food-lists') {
        return SAMPLE_OWNED_LISTS;
      }
      if (path === '/food-lists/list-favs') {
        return SAMPLE_LIST_DETAIL;
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });

  it('renders header Add to List button and opens FoodItemPickerModal in multi-select mode (R5.10, R9.9)', async () => {
    const view = renderMenuScreen();

    await waitFor(() => {
      expect(view.getByTestId('menu-screen')).toBeTruthy();
    });

    const headerAddBtn = view.getByTestId('menu-screen-add-to-list-btn');
    expect(headerAddBtn).toBeTruthy();
    expect(view.getByText('Add to List')).toBeTruthy();

    // Tap header Add to List
    fireEvent.press(headerAddBtn);

    // FoodItemPickerModal mounts
    await waitFor(() => {
      expect(view.getByTestId('food-item-picker-modal')).toBeTruthy();
    });

    // Checkbox is present in multi-select mode
    expect(view.getByTestId('food-item-checkbox-food-soup-1')).toBeTruthy();
  });

  it('renders item-level Add to List button on each menu dish and opens AddToListsSheet (R5.10, R9.9)', async () => {
    const view = renderMenuScreen();

    await waitFor(() => {
      expect(view.getByTestId('menu-screen')).toBeTruthy();
    });

    // Both dishes have an item-level add button
    const soupAddBtn = view.getByTestId('menu-item-add-to-list-0-0-0');
    expect(soupAddBtn).toBeTruthy();
    expect(view.getByTestId('menu-item-add-to-list-0-0-1')).toBeTruthy();

    // Tap Add to List on "Lost and Found Soup"
    fireEvent.press(soupAddBtn);

    // AddToListsSheet opens for this dish
    const sheet = view.getByTestId('add-to-lists-sheet');
    expect(sheet).toBeTruthy();

    // The dish name is displayed in AddToListsSheet
    expect(within(sheet).getByText(/Lost and Found Soup/)).toBeTruthy();
    // User's owned lists are listed once query resolves
    await waitFor(() => {
      expect(view.getByText('Favorite Disney Dishes')).toBeTruthy();
    });

    // Save button is initially disabled because no food list is chosen yet
    const saveBtn = view.getByTestId('add-to-lists-save-btn');
    expect(saveBtn.props.accessibilityState.disabled).toBe(true);

    // Selecting a food list enables the Save button
    fireEvent.press(view.getByTestId('food-list-checkbox-row-list-favs'));
    expect(view.getByTestId('add-to-lists-save-btn').props.accessibilityState.disabled).toBe(false);
  });
});
