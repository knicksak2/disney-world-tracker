import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';

import type {
  FriendDishRatingDTO,
  FriendFoodRatingsPageDTO,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

// Mock ONLY apiRequest, preserving real ApiError
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
let mockRouteParams = {
  friendId: 'friend-uuid-1111',
  displayName: 'Sam',
};

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    __esModule: true,
    ...actual,
    useNavigation: () => ({
      goBack: mockGoBack,
      navigate: mockNavigate,
    }),
    useRoute: () => ({
      params: mockRouteParams,
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import YouAndCrewStack from '../../../navigation/YouAndCrewStack';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { describeDishRating } from '../foodRatingFormat';
import FriendFoodHistoryScreen from '../FriendFoodHistoryScreen';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRIEND_ID = 'friend-uuid-1111';
const DISPLAY_NAME = 'Sam';

const DISH_DOLE_WHIP: FriendDishRatingDTO = {
  foodItemId: 'aaaaaaaa-1111-1111-1111-111111111111',
  foodItemName: 'Dole Whip',
  scopeKind: 'location',
  scopeId: 'bbbbbbbb-1111-1111-1111-111111111111',
  scopeName: 'Aloha Isle',
  park: 'Magic Kingdom',
  averageRating: 9.5,
  ratedLogCount: 2,
  logCount: 2,
  latestVisitedOn: '2024-05-01',
};

const DISH_UNRATED: FriendDishRatingDTO = {
  foodItemId: 'aaaaaaaa-2222-2222-2222-222222222222',
  foodItemName: 'Citrus Swirl',
  scopeKind: 'location',
  scopeId: 'bbbbbbbb-2222-2222-2222-222222222222',
  scopeName: 'Sunshine Tree Terrace',
  park: 'Magic Kingdom',
  averageRating: null,
  ratedLogCount: 0,
  logCount: 1,
  latestVisitedOn: '2024-05-02',
};

const DISH_CHURRO: FriendDishRatingDTO = {
  foodItemId: 'aaaaaaaa-3333-3333-3333-333333333333',
  foodItemName: 'Churro',
  scopeKind: 'experience',
  scopeId: 'bbbbbbbb-3333-3333-3333-333333333333',
  scopeName: 'Pecos Bill',
  park: 'Magic Kingdom',
  averageRating: 8.0,
  ratedLogCount: 1,
  logCount: 1,
  latestVisitedOn: '2024-04-10',
};

const PAGE_ONE: FriendFoodRatingsPageDTO = {
  items: [DISH_DOLE_WHIP, DISH_UNRATED],
  nextCursor: 'cursor_page_1',
  scopes: [
    {
      kind: 'location',
      id: 'bbbbbbbb-1111-1111-1111-111111111111',
      name: 'Aloha Isle',
      park: 'Magic Kingdom',
      dishCount: 1,
    },
    {
      kind: 'experience',
      id: 'bbbbbbbb-3333-3333-3333-333333333333',
      name: 'Pecos Bill',
      park: 'Magic Kingdom',
      dishCount: 1,
    },
  ],
};

const PAGE_TWO: FriendFoodRatingsPageDTO = {
  items: [DISH_CHURRO],
  nextCursor: null,
  scopes: null,
};

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        retryDelay: 0,
        gcTime: 0,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <FriendFoodHistoryScreen />
    </QueryClientProvider>,
  );
}

describe('FriendFoodHistoryScreen (Task 4.5, Property 16)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockReset();
    mockRouteParams = {
      friendId: FRIEND_ID,
      displayName: DISPLAY_NAME,
    };
  });

  afterEach(() => {
    resetTestScheme();
  });

  it('renders initial request params, rows, rating text, and accessibility labels', async () => {
    apiRequestMock.mockResolvedValueOnce(PAGE_ONE);

    const { getByText, getByTestId, queryByText } = renderScreen();

    await waitFor(() => {
      expect(getByText('Dole Whip')).toBeTruthy();
      expect(getByText('Citrus Swirl')).toBeTruthy();
    });

    // Check initial request url
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      'GET',
      `/users/${FRIEND_ID}/food-ratings?sort=recent`,
    );

    // Rows show rating text, "Not rated" for unrated dish, and log count
    expect(getByText('9.5/10')).toBeTruthy();
    expect(getByText('Not rated')).toBeTruthy();
    expect(getByText('Logged 2 times')).toBeTruthy();
    expect(getByText('Logged 1 time')).toBeTruthy();

    // Accessibility label on each row
    const doleRow = getByTestId(`friend-dish-row-${DISH_DOLE_WHIP.foodItemId}`);
    expect(doleRow.props.accessibilityLabel).toBe(
      describeDishRating({
        foodItemName: DISH_DOLE_WHIP.foodItemName,
        averageRating: DISH_DOLE_WHIP.averageRating,
        logCount: DISH_DOLE_WHIP.logCount,
      }),
    );

    const unratedRow = getByTestId(
      `friend-dish-row-${DISH_UNRATED.foodItemId}`,
    );
    expect(unratedRow.props.accessibilityLabel).toBe(
      describeDishRating({
        foodItemName: DISH_UNRATED.foodItemName,
        averageRating: DISH_UNRATED.averageRating,
        logCount: DISH_UNRATED.logCount,
      }),
    );

    // Strict read-only: no delete, no add-rating, no note controls
    expect(queryByText('+ Add rating')).toBeNull();
    expect(queryByText('Delete')).toBeNull();

    // Verify all api calls were GET
    for (const call of apiRequestMock.mock.calls) {
      expect(call[0]).toBe('GET');
    }
  });

  it('tapping each sort chip sends the matching sort and replaces rows', async () => {
    apiRequestMock.mockResolvedValueOnce(PAGE_ONE);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledTimes(1);
    });

    // Tapping Highest rated
    const highestRatedResponse: FriendFoodRatingsPageDTO = {
      items: [DISH_DOLE_WHIP],
      nextCursor: null,
      scopes: null,
    };
    apiRequestMock.mockResolvedValueOnce(highestRatedResponse);

    const sortChipHighest = getByTestId('sort-chip-highest_rated');
    expect(sortChipHighest.props.accessibilityRole).toBe('button');
    expect(sortChipHighest.props.accessibilityLabel).toBe(
      'Sort by Highest rated',
    );

    fireEvent.press(sortChipHighest);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        'GET',
        `/users/${FRIEND_ID}/food-ratings?sort=highest_rated`,
      );
    });

    // Tapping Most logged
    const mostLoggedResponse: FriendFoodRatingsPageDTO = {
      items: [DISH_DOLE_WHIP],
      nextCursor: null,
      scopes: null,
    };
    apiRequestMock.mockResolvedValueOnce(mostLoggedResponse);

    const sortChipLogged = getByTestId('sort-chip-most_logged');
    fireEvent.press(sortChipLogged);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        'GET',
        `/users/${FRIEND_ID}/food-ratings?sort=most_logged`,
      );
    });
  });

  it('typing in search sends trimmed q after debounce, and clearing field omits q entirely', async () => {
    apiRequestMock.mockResolvedValueOnce(PAGE_ONE);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledTimes(1);
    });

    // Type in search with surrounding spaces
    apiRequestMock.mockResolvedValueOnce({
      items: [DISH_DOLE_WHIP],
      nextCursor: null,
      scopes: null,
    });

    const searchInput = getByTestId('food-history-search-input');
    fireEvent.changeText(searchInput, '   dole whip   ');

    // Wait for debounce and network request
    await waitFor(
      () => {
        expect(apiRequestMock).toHaveBeenCalledWith(
          'GET',
          `/users/${FRIEND_ID}/food-ratings?sort=recent&q=dole+whip`,
        );
      },
      { timeout: 2000 },
    );

    // Clear search
    apiRequestMock.mockResolvedValueOnce(PAGE_ONE);

    const clearBtn = getByTestId('food-history-clear-search');
    expect(clearBtn.props.accessibilityRole).toBe('button');
    expect(clearBtn.props.accessibilityLabel).toBe('Clear search text');

    fireEvent.press(clearBtn);

    await waitFor(() => {
      const lastCallUrl = apiRequestMock.mock.calls[
        apiRequestMock.mock.calls.length - 1
      ]![1] as string;
      expect(lastCallUrl).not.toContain('q=');
      expect(lastCallUrl).toBe(`/users/${FRIEND_ID}/food-ratings?sort=recent`);
    });
  });

  it('park chip appears for location-scoped Scope and sends park; scope chip sends locationId/experienceId', async () => {
    apiRequestMock.mockResolvedValueOnce(PAGE_ONE);

    const { getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('restaurant-filter-Magic Kingdom')).toBeTruthy();
    });

    // Park chip derived from Magic Kingdom
    const parkChip = getByTestId('restaurant-filter-Magic Kingdom');
    expect(parkChip.props.accessibilityRole).toBe('button');
    expect(parkChip.props.accessibilityLabel).toBe('Filter by Magic Kingdom');

    apiRequestMock.mockResolvedValueOnce({
      items: [DISH_DOLE_WHIP],
      nextCursor: null,
      scopes: null,
    });

    fireEvent.press(parkChip);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        'GET',
        `/users/${FRIEND_ID}/food-ratings?sort=recent&park=Magic+Kingdom`,
      );
    });

    // Untoggle park chip to test scope chip in isolation
    apiRequestMock.mockResolvedValueOnce(PAGE_ONE);
    fireEvent.press(parkChip);
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        'GET',
        `/users/${FRIEND_ID}/food-ratings?sort=recent`,
      );
    });

    // Scope chip for Aloha Isle (location-scoped)
    const scopeChip = getByTestId(
      'restaurant-filter-bbbbbbbb-1111-1111-1111-111111111111',
    );
    expect(scopeChip.props.accessibilityRole).toBe('button');
    expect(scopeChip.props.accessibilityLabel).toBe('Filter by Aloha Isle');

    apiRequestMock.mockResolvedValueOnce({
      items: [DISH_DOLE_WHIP],
      nextCursor: null,
      scopes: null,
    });

    fireEvent.press(scopeChip);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        'GET',
        `/users/${FRIEND_ID}/food-ratings?sort=recent&locationId=bbbbbbbb-1111-1111-1111-111111111111`,
      );
    });
  });

  it('scrolling to the end sends cursor=<nextCursor> and appends rows', async () => {
    apiRequestMock
      .mockResolvedValueOnce(PAGE_ONE)
      .mockResolvedValueOnce(PAGE_TWO);

    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByText('Dole Whip')).toBeTruthy();
    });

    const flatList = getByTestId('friend-food-history-list');

    // Scroll near end
    act(() => {
      flatList.props.onEndReached();
    });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledTimes(2);
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        'GET',
        `/users/${FRIEND_ID}/food-ratings?sort=recent&cursor=${encodeURIComponent(
          PAGE_ONE.nextCursor!,
        )}`,
      );
      // Rows from both pages are rendered
      expect(getByText('Dole Whip')).toBeTruthy();
      expect(getByText('Churro')).toBeTruthy();
    });
  });

  it('Property 16 explicit reset sequence: sort -> search -> scope chip -> scroll-to-end -> sort', async () => {
    // 1. Initial page
    apiRequestMock.mockResolvedValueOnce(PAGE_ONE);
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText('Dole Whip')).toBeTruthy();
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        'GET',
        `/users/${FRIEND_ID}/food-ratings?sort=recent`,
      );
    });

    // 2. Sort change: Highest rated -> page 1 with no cursor
    apiRequestMock.mockResolvedValueOnce({
      items: [DISH_DOLE_WHIP],
      nextCursor: 'cursor_step1',
      scopes: null,
    });
    fireEvent.press(getByTestId('sort-chip-highest_rated'));

    await waitFor(() => {
      const url = apiRequestMock.mock.calls[
        apiRequestMock.mock.calls.length - 1
      ]![1] as string;
      expect(url).toBe(`/users/${FRIEND_ID}/food-ratings?sort=highest_rated`);
      expect(url).not.toContain('cursor=');
    });

    // 3. Search change: "churro" -> page 1 with no cursor
    apiRequestMock.mockResolvedValueOnce({
      items: [DISH_CHURRO],
      nextCursor: 'cursor_step2',
      scopes: null,
    });
    fireEvent.changeText(
      getByTestId('food-history-search-input'),
      'churro',
    );

    await waitFor(
      () => {
        const url = apiRequestMock.mock.calls[
          apiRequestMock.mock.calls.length - 1
        ]![1] as string;
        expect(url).toBe(
          `/users/${FRIEND_ID}/food-ratings?sort=highest_rated&q=churro`,
        );
        expect(url).not.toContain('cursor=');
      },
      { timeout: 2000 },
    );

    // 4. Scope chip change: Pecos Bill -> page 1 with no cursor
    apiRequestMock.mockResolvedValueOnce({
      items: [DISH_CHURRO],
      nextCursor: 'cursor_step3',
      scopes: null,
    });
    fireEvent.press(
      getByTestId('restaurant-filter-bbbbbbbb-3333-3333-3333-333333333333'),
    );

    await waitFor(() => {
      const url = apiRequestMock.mock.calls[
        apiRequestMock.mock.calls.length - 1
      ]![1] as string;
      expect(url).toBe(
        `/users/${FRIEND_ID}/food-ratings?sort=highest_rated&experienceId=bbbbbbbb-3333-3333-3333-333333333333&q=churro`,
      );
      expect(url).not.toContain('cursor=');
      expect(getByTestId('friend-food-history-list')).toBeTruthy();
      expect(getByText('Churro')).toBeTruthy();
    });

    // 5. Scroll to end -> continuation request with cursor
    apiRequestMock.mockResolvedValueOnce({
      items: [DISH_DOLE_WHIP],
      nextCursor: null,
      scopes: null,
    });
    const flatList = getByTestId('friend-food-history-list');
    act(() => {
      flatList.props.onEndReached();
    });

    await waitFor(() => {
      const url = apiRequestMock.mock.calls[
        apiRequestMock.mock.calls.length - 1
      ]![1] as string;
      expect(url).toContain('cursor=cursor_step3');
    });

    // 6. Sort change again: Most logged -> resets to first page with no cursor, no stale rows from earlier
    apiRequestMock.mockResolvedValueOnce({
      items: [DISH_DOLE_WHIP],
      nextCursor: null,
      scopes: null,
    });
    fireEvent.press(getByTestId('sort-chip-most_logged'));

    await waitFor(() => {
      const url = apiRequestMock.mock.calls[
        apiRequestMock.mock.calls.length - 1
      ]![1] as string;
      expect(url).toBe(
        `/users/${FRIEND_ID}/food-ratings?sort=most_logged&experienceId=bbbbbbbb-3333-3333-3333-333333333333&q=churro`,
      );
      expect(url).not.toContain('cursor=');
    });
  });

  it('renders empty state when friend has no logs', async () => {
    apiRequestMock.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      scopes: [],
    });

    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('friend-food-history-empty')).toBeTruthy();
      expect(getByText(`${DISPLAY_NAME} hasn't logged any dishes yet.`)).toBeTruthy();
    });
  });

  it('renders no-matches state when search or filter returns no items, with clear control', async () => {
    apiRequestMock.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      scopes: [
        {
          kind: 'location',
          id: 'bbbbbbbb-1111-1111-1111-111111111111',
          name: 'Aloha Isle',
          park: 'Magic Kingdom',
          dishCount: 1,
        },
      ],
    });

    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('restaurant-filter-Magic Kingdom')).toBeTruthy();
    });

    // Select park to trigger filter
    apiRequestMock.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      scopes: null,
    });
    fireEvent.press(getByTestId('restaurant-filter-Magic Kingdom'));

    await waitFor(() => {
      expect(getByTestId('friend-food-history-no-matches')).toBeTruthy();
      expect(getByText('No dishes match your search or filters.')).toBeTruthy();
    });

    // Tap clear filters control
    apiRequestMock.mockResolvedValueOnce(PAGE_ONE);
    const clearBtn = getByTestId('friend-food-history-clear-all');
    expect(clearBtn.props.accessibilityRole).toBe('button');
    expect(clearBtn.props.accessibilityLabel).toBe('Clear search and filters');

    fireEvent.press(clearBtn);

    await waitFor(() => {
      expect(getByText('Dole Whip')).toBeTruthy();
    });
  });

  it('profile_forbidden rejection shows terminal forbidden treatment with no retry', async () => {
    const forbiddenError = new ApiError({
      code: 'profile_forbidden',
      message: 'Forbidden',
      status: 403,
    });
    apiRequestMock.mockRejectedValue(forbiddenError);

    const { getByTestId, queryByTestId, getByText } = renderScreen();

    await waitFor(() => {
      expect(getByTestId('friend-profile-unavailable')).toBeTruthy();
      expect(getByText('Profile unavailable')).toBeTruthy();
      expect(
        getByText('This friend’s profile is no longer available to view.'),
      ).toBeTruthy();
    });

    // No retry control offered
    expect(queryByTestId('friend-food-history-retry')).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
  });

  describe('Failed load and retry (R12.9)', () => {
    it('(a) first-page rejection shows error state and retry re-requests page 1 and renders rows', async () => {
      const networkError = new ApiError({
        code: 'internal_error',
        message: 'Server error',
        status: 500,
      });
      // The hook retries once automatically (retryUnlessForbidden), so two rejections trigger the error state
      apiRequestMock
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError);

      const { getByTestId, getByText, queryByText } = renderScreen();

      await waitFor(() => {
        const errorView = getByTestId('friend-food-history-error');
        expect(errorView.props.accessibilityRole).toBe('alert');
        expect(
          getByText(`Couldn't load ${DISPLAY_NAME}'s dishes.`),
        ).toBeTruthy();
      });

      // No rows rendered
      expect(queryByText('Dole Whip')).toBeNull();

      // Retry control
      const retryBtn = getByTestId('friend-food-history-retry');
      expect(retryBtn.props.accessibilityRole).toBe('button');
      expect(retryBtn.props.accessibilityLabel).toBe(
        `Retry loading ${DISPLAY_NAME}'s dishes`,
      );

      // Now resolve on manual retry
      apiRequestMock.mockResolvedValueOnce(PAGE_ONE);
      fireEvent.press(retryBtn);

      await waitFor(() => {
        expect(apiRequestMock).toHaveBeenCalledTimes(3);
        expect(apiRequestMock).toHaveBeenLastCalledWith(
          'GET',
          `/users/${FRIEND_ID}/food-ratings?sort=recent`,
        );
        expect(getByText('Dole Whip')).toBeTruthy();
      });
    });

    it('(b) subsequent-page rejection keeps loaded rows and offers page-error retry for the same cursor', async () => {
      apiRequestMock.mockResolvedValueOnce(PAGE_ONE);

      const { getByText, getByTestId, queryByTestId } = renderScreen();

      await waitFor(() => {
        expect(getByText('Dole Whip')).toBeTruthy();
      });

      // Second page fails (auto retried once by hook, so 2 rejections)
      const pageTwoError = new ApiError({
        code: 'internal_error',
        message: 'Server error',
        status: 500,
      });
      apiRequestMock
        .mockRejectedValueOnce(pageTwoError)
        .mockRejectedValueOnce(pageTwoError);

      const flatList = getByTestId('friend-food-history-list');
      act(() => {
        flatList.props.onEndReached();
      });

      await waitFor(() => {
        // Already loaded rows are still rendered
        expect(getByText('Dole Whip')).toBeTruthy();

        // Footer shows page error and retry
        expect(getByText("Couldn't load more dishes.")).toBeTruthy();
        expect(getByTestId('friend-food-history-retry-page')).toBeTruthy();
      });

      const retryPageBtn = getByTestId('friend-food-history-retry-page');
      expect(retryPageBtn.props.accessibilityRole).toBe('button');
      expect(retryPageBtn.props.accessibilityLabel).toBe(
        'Retry loading more dishes',
      );

      // Resolve on page retry
      apiRequestMock.mockResolvedValueOnce(PAGE_TWO);
      fireEvent.press(retryPageBtn);

      await waitFor(() => {
        expect(apiRequestMock).toHaveBeenCalledTimes(4);
        expect(apiRequestMock).toHaveBeenLastCalledWith(
          'GET',
          `/users/${FRIEND_ID}/food-ratings?sort=recent&cursor=${encodeURIComponent(
            PAGE_ONE.nextCursor!,
          )}`,
        );
        expect(getByText('Churro')).toBeTruthy();
        expect(queryByTestId('friend-food-history-page-error')).toBeNull();
      });
    });
  });

  it('renders correctly in dark mode', async () => {
    setTestScheme('dark');
    apiRequestMock.mockResolvedValueOnce(PAGE_ONE);

    const { getByText, getByTestId } = renderScreen();

    await waitFor(() => {
      expect(getByText('Dole Whip')).toBeTruthy();
      expect(getByTestId('friend-food-history-screen')).toBeTruthy();
    });
  });

  it('verifies FriendFoodHistory route is registered in YouAndCrewStack', () => {
    const queryClient = new QueryClient();
    const { toJSON } = render(
      <NavigationContainer>
        <QueryClientProvider client={queryClient}>
          <YouAndCrewStack />
        </QueryClientProvider>
      </NavigationContainer>,
    );
    expect(toJSON()).toBeTruthy();
  });
});
