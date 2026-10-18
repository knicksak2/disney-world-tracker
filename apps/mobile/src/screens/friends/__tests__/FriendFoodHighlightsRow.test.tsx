import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import type { FriendDishRatingDTO } from '@dwt/shared';

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

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    __esModule: true,
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import { describeDishRating } from '../foodRatingFormat';
import { FriendFoodHighlightsRow } from '../FriendFoodHighlightsRow';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRIEND_ID = 'friend-uuid-5555';
const DISPLAY_NAME = 'Woody';

const DISH_ONE: FriendDishRatingDTO = {
  foodItemId: 'item-1111',
  foodItemName: 'Cheeseburger Spring Rolls',
  scopeKind: 'location',
  scopeId: 'loc-1111',
  scopeName: 'Spring Roll Cart',
  park: 'Magic Kingdom',
  averageRating: 9.2,
  ratedLogCount: 3,
  logCount: 3,
  latestVisitedOn: '2024-05-10',
};

const DISH_TWO: FriendDishRatingDTO = {
  foodItemId: 'item-2222',
  foodItemName: 'Dole Whip Float',
  scopeKind: 'location',
  scopeId: 'loc-2222',
  scopeName: 'Aloha Isle',
  park: 'Magic Kingdom',
  averageRating: 8.8,
  ratedLogCount: 2,
  logCount: 2,
  latestVisitedOn: '2024-05-01',
};

const DISH_UNRATED: FriendDishRatingDTO = {
  foodItemId: 'item-3333',
  foodItemName: 'Unrated Pretzel',
  scopeKind: 'experience',
  scopeId: 'exp-3333',
  scopeName: 'Gaston’s Tavern',
  park: 'Magic Kingdom',
  averageRating: null,
  ratedLogCount: 0,
  logCount: 1,
  latestVisitedOn: '2024-04-12',
};

function renderRow(props?: { onForbidden?: () => void }) {
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
      <FriendFoodHighlightsRow
        friendId={FRIEND_ID}
        displayName={DISPLAY_NAME}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('FriendFoodHighlightsRow (Task 5.2, Properties 11, 12, 13)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockReset();
  });

  it('queries with sort=highest_rated, limit=5, minRatedLogs=1 and renders cards with dish, rating text, and scope', async () => {
    apiRequestMock.mockResolvedValueOnce({
      items: [DISH_ONE, DISH_TWO, DISH_UNRATED],
      nextCursor: null,
      scopes: null,
    });

    const { getByText, getByTestId, queryByText } = renderRow();

    await waitFor(() => {
      expect(getByText('Cheeseburger Spring Rolls')).toBeTruthy();
      expect(getByText('Dole Whip Float')).toBeTruthy();
    });

    // Validates query parameters
    expect(apiRequestMock).toHaveBeenCalledWith(
      'GET',
      `/users/${FRIEND_ID}/food-ratings?sort=highest_rated&limit=5&minRatedLogs=1`,
    );

    // Cards display dish name, scope name, and rating text out of 10
    expect(getByText('Spring Roll Cart')).toBeTruthy();
    expect(getByText('9.2/10')).toBeTruthy();
    expect(getByText('Aloha Isle')).toBeTruthy();
    expect(getByText('8.8/10')).toBeTruthy();

    // Unrated-only dish is NOT rendered in Highlights (Requirement 11.2)
    expect(queryByText('Unrated Pretzel')).toBeNull();

    // Cards expose describeDishRating accessibilityLabel (Property 13)
    const card1 = getByTestId(`friend-food-highlight-card-${DISH_ONE.foodItemId}`);
    expect(card1.props.accessibilityLabel).toBe(
      describeDishRating({
        foodItemName: DISH_ONE.foodItemName,
        averageRating: DISH_ONE.averageRating,
        logCount: DISH_ONE.logCount,
      }),
    );

    // "See all" action: testID, role, label, and navigation
    const seeAllBtn = getByTestId('friend-food-see-all');
    expect(seeAllBtn.props.accessibilityRole).toBe('button');
    expect(seeAllBtn.props.accessibilityLabel).toBe(
      `See all of ${DISPLAY_NAME}'s dishes`,
    );

    fireEvent.press(seeAllBtn);
    expect(mockNavigate).toHaveBeenCalledWith('FriendFoodHistory', {
      friendId: FRIEND_ID,
      displayName: DISPLAY_NAME,
    });
  });

  it('renders empty state when friend has no rated dishes, while still showing "See all"', async () => {
    apiRequestMock.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      scopes: null,
    });

    const { getByText, getByTestId } = renderRow();

    await waitFor(() => {
      expect(getByTestId('friend-food-highlights-empty')).toBeTruthy();
      expect(
        getByText(`${DISPLAY_NAME} hasn't rated any dishes yet.`),
      ).toBeTruthy();
    });

    // "See all" still present and navigable (Requirement 13.5)
    const seeAllBtn = getByTestId('friend-food-see-all');
    expect(seeAllBtn).toBeTruthy();
    fireEvent.press(seeAllBtn);
    expect(mockNavigate).toHaveBeenCalledWith('FriendFoodHistory', {
      friendId: FRIEND_ID,
      displayName: DISPLAY_NAME,
    });
  });

  it('scoped error with retry: shows error message with retry control that re-requests', async () => {
    const error500 = new ApiError({
      code: 'internal_error',
      message: 'Server error',
      status: 500,
    });
    // Hook auto-retries once on non-403 (retryUnlessForbidden), so mock 2 rejections
    apiRequestMock
      .mockRejectedValueOnce(error500)
      .mockRejectedValueOnce(error500);

    const { getByText, getByTestId } = renderRow();

    await waitFor(() => {
      expect(getByTestId('friend-food-highlights-error')).toBeTruthy();
      expect(getByText("Couldn't load food highlights.")).toBeTruthy();
    });

    const retryBtn = getByTestId('friend-food-highlights-retry');
    expect(retryBtn.props.accessibilityRole).toBe('button');
    expect(retryBtn.props.accessibilityLabel).toBe(
      'Retry loading food highlights',
    );

    // Resolve on retry
    apiRequestMock.mockResolvedValueOnce({
      items: [DISH_ONE],
      nextCursor: null,
      scopes: null,
    });

    fireEvent.press(retryBtn);

    await waitFor(() => {
      expect(getByText('Cheeseburger Spring Rolls')).toBeTruthy();
      expect(apiRequestMock).toHaveBeenCalledTimes(3);
    });
  });

  it('profile_forbidden rejection propagates via callback and returns null', async () => {
    const forbiddenError = new ApiError({
      code: 'profile_forbidden',
      message: 'Forbidden',
      status: 403,
    });
    apiRequestMock.mockRejectedValue(forbiddenError);

    const onForbiddenMock = jest.fn();
    const { queryByTestId } = renderRow({ onForbidden: onForbiddenMock });

    await waitFor(() => {
      expect(onForbiddenMock).toHaveBeenCalled();
    });

    // Does not render cards, empty, or scoped error
    expect(queryByTestId('friend-food-highlights-error')).toBeNull();
    expect(queryByTestId('friend-food-highlights-empty')).toBeNull();
  });
});
