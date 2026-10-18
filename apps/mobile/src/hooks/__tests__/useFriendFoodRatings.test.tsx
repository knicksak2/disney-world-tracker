import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import type { FriendFoodRatingsPageDTO } from '@dwt/shared';

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

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { ApiError, apiRequest as mockedApiRequest } from '../../api/client';
import {
  buildFriendFoodListQueryString,
  friendFoodRatingsKeys,
  useFriendFoodHighlights,
  useFriendFoodList,
} from '../useFriendFoodRatings';
import { retryUnlessForbidden } from '../useFriendProfile';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRIEND_ID = '11111111-2222-3333-4444-555555555555';

const PAGE_ONE: FriendFoodRatingsPageDTO = {
  items: [
    {
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
    },
  ],
  nextCursor: 'eyB2OiAxLCBzOiAicmVjZW50IiwgYSA6ICIyMDI0LTA1LTAxIiwgYiA6IG51bGwsIGlkIDogImFhYWFhYWFhLTExMTEtMTExMS0xMTExLTExMTExMTExMTExMSIgfQ==',
  scopes: [
    {
      kind: 'location',
      id: 'bbbbbbbb-1111-1111-1111-111111111111',
      name: 'Aloha Isle',
      park: 'Magic Kingdom',
      dishCount: 1,
    },
  ],
};

const PAGE_TWO: FriendFoodRatingsPageDTO = {
  items: [
    {
      foodItemId: 'cccccccc-2222-2222-2222-222222222222',
      foodItemName: 'Churro',
      scopeKind: 'experience',
      scopeId: 'dddddddd-2222-2222-2222-222222222222',
      scopeName: 'Pecos Bill',
      park: 'Magic Kingdom',
      averageRating: 8.0,
      ratedLogCount: 1,
      logCount: 1,
      latestVisitedOn: '2024-04-10',
    },
  ],
  nextCursor: null,
  scopes: null,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('useFriendFoodRatings query layer (Task 4.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('friendFoodRatingsKeys', () => {
    it('constructs consistent and typed query keys', () => {
      expect(friendFoodRatingsKeys.all).toEqual(['friend-food-ratings']);
      expect(friendFoodRatingsKeys.highlights(FRIEND_ID)).toEqual([
        'friend-food-ratings',
        FRIEND_ID,
        'highlights',
      ]);
      expect(
        friendFoodRatingsKeys.list(FRIEND_ID, { sort: 'highest_rated' }),
      ).toEqual([
        'friend-food-ratings',
        FRIEND_ID,
        'list',
        { sort: 'highest_rated' },
      ]);
      expect(
        friendFoodRatingsKeys.socialProof('experience', 'exp-123'),
      ).toEqual(['friend-food-social-proof', 'experience', 'exp-123']);
    });
  });

  describe('buildFriendFoodListQueryString', () => {
    it('returns empty string when no params or cursor provided', () => {
      expect(buildFriendFoodListQueryString({})).toBe('');
    });

    it('builds full query string with all options', () => {
      const qs = buildFriendFoodListQueryString(
        {
          sort: 'most_logged',
          limit: 25,
          experienceId: '11111111-1111-1111-1111-111111111111',
          park: 'EPCOT',
          q: '  waffle sandwich  ',
          minRatedLogs: 2,
        },
        'cursor123',
      );
      expect(qs).toBe(
        '?sort=most_logged&limit=25&cursor=cursor123&experienceId=11111111-1111-1111-1111-111111111111&park=EPCOT&q=waffle+sandwich&minRatedLogs=2',
      );
    });

    it('omits q if undefined, empty or whitespace-only', () => {
      expect(buildFriendFoodListQueryString({ q: '' })).toBe('');
      expect(buildFriendFoodListQueryString({ q: '   ' })).toBe('');
      expect(buildFriendFoodListQueryString({ q: 'dole' })).toBe('?q=dole');
    });

    it('includes locationId when provided', () => {
      expect(
        buildFriendFoodListQueryString({
          locationId: '22222222-2222-2222-2222-222222222222',
        }),
      ).toBe('?locationId=22222222-2222-2222-2222-222222222222');
    });
  });

  describe('retryUnlessForbidden', () => {
    it('returns false immediately on profile_forbidden', () => {
      const forbiddenError = new ApiError({
        code: 'profile_forbidden',
        message: 'Forbidden',
        status: 403,
      });
      expect(retryUnlessForbidden(0, forbiddenError)).toBe(false);
      expect(retryUnlessForbidden(1, forbiddenError)).toBe(false);
    });

    it('allows exactly one automatic retry for non-forbidden errors', () => {
      const networkError = new ApiError({
        code: 'internal_error',
        message: 'Server error',
        status: 500,
      });
      expect(retryUnlessForbidden(0, networkError)).toBe(true);
      expect(retryUnlessForbidden(1, networkError)).toBe(false);
      expect(retryUnlessForbidden(2, networkError)).toBe(false);
    });
  });

  describe('useFriendFoodHighlights', () => {
    it('requests highlights with sort=highest_rated&limit=5&minRatedLogs=1', async () => {
      apiRequestMock.mockResolvedValueOnce(PAGE_ONE);

      const { result } = renderHook(() => useFriendFoodHighlights(FRIEND_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiRequestMock).toHaveBeenCalledTimes(1);
      expect(apiRequestMock).toHaveBeenCalledWith(
        'GET',
        `/users/${FRIEND_ID}/food-ratings?sort=highest_rated&limit=5&minRatedLogs=1`,
      );
      expect(result.current.data).toEqual(PAGE_ONE);
    });
  });

  describe('useFriendFoodList', () => {
    it('loads first page and pages sequentially using nextCursor', async () => {
      apiRequestMock
        .mockResolvedValueOnce(PAGE_ONE)
        .mockResolvedValueOnce(PAGE_TWO);

      const { result } = renderHook(
        () => useFriendFoodList(FRIEND_ID, { sort: 'recent' }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(apiRequestMock).toHaveBeenCalledTimes(1);
      expect(apiRequestMock).toHaveBeenCalledWith(
        'GET',
        `/users/${FRIEND_ID}/food-ratings?sort=recent`,
      );
      expect(result.current.data?.pages[0]).toEqual(PAGE_ONE);
      expect(result.current.hasNextPage).toBe(true);

      // Fetch second page
      await result.current.fetchNextPage();

      await waitFor(() =>
        expect(result.current.data?.pages).toHaveLength(2),
      );

      expect(apiRequestMock).toHaveBeenCalledTimes(2);
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        'GET',
        `/users/${FRIEND_ID}/food-ratings?sort=recent&cursor=${encodeURIComponent(
          PAGE_ONE.nextCursor!,
        )}`,
      );
      expect(result.current.data?.pages[1]).toEqual(PAGE_TWO);
      expect(result.current.hasNextPage).toBe(false);
    });
  });
});
