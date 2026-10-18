import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type {
  FoodScopeKind,
  FriendFoodRatingsPageDTO,
  FriendFoodSocialProofResponseDTO,
  FriendFoodSort,
  Park,
} from '@dwt/shared';

import { apiRequest, ApiError } from '../api/client';
import { retryUnlessForbidden } from './useFriendProfile';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export interface FriendFoodListParams {
  readonly sort?: FriendFoodSort | undefined;
  readonly limit?: number | undefined;
  readonly experienceId?: string | undefined;
  readonly locationId?: string | undefined;
  readonly park?: Park | undefined;
  readonly q?: string | undefined;
  readonly minRatedLogs?: number | undefined;
}

export const friendFoodRatingsKeys = {
  all: ['friend-food-ratings'] as const,
  highlights: (friendId: string) =>
    ['friend-food-ratings', friendId, 'highlights'] as const,
  list: (friendId: string, params: FriendFoodListParams) =>
    ['friend-food-ratings', friendId, 'list', params] as const,
  socialProof: (kind: FoodScopeKind, id: string) =>
    ['friend-food-social-proof', kind, id] as const,
};

// ---------------------------------------------------------------------------
// Query string builder
// ---------------------------------------------------------------------------

export function buildFriendFoodListQueryString(
  params: FriendFoodListParams,
  cursor?: string,
): string {
  const searchParams = new URLSearchParams();
  if (params.sort) {
    searchParams.set('sort', params.sort);
  }
  if (params.limit !== undefined) {
    searchParams.set('limit', String(params.limit));
  }
  if (cursor) {
    searchParams.set('cursor', cursor);
  }
  if (params.experienceId) {
    searchParams.set('experienceId', params.experienceId);
  }
  if (params.locationId) {
    searchParams.set('locationId', params.locationId);
  }
  if (params.park) {
    searchParams.set('park', params.park);
  }
  if (params.q !== undefined) {
    const trimmed = params.q.trim();
    if (trimmed.length > 0) {
      searchParams.set('q', trimmed);
    }
  }
  if (params.minRatedLogs !== undefined) {
    searchParams.set('minRatedLogs', String(params.minRatedLogs));
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Highlights row query on friend profile Overview (R11.1).
 * Fetches top 5 dishes with at least 1 rated log, staleTime 60s.
 */
export function useFriendFoodHighlights(
  friendId: string,
): UseQueryResult<FriendFoodRatingsPageDTO, ApiError> {
  return useQuery<FriendFoodRatingsPageDTO, ApiError>({
    queryKey: friendFoodRatingsKeys.highlights(friendId),
    queryFn: () =>
      apiRequest<FriendFoodRatingsPageDTO>(
        'GET',
        `/users/${encodeURIComponent(friendId)}/food-ratings?sort=highest_rated&limit=5&minRatedLogs=1`,
      ),
    staleTime: 60_000,
    retry: retryUnlessForbidden,
    retryOnMount: false,
  });
}

/**
 * Keyset-paginated full food ratings query for FriendFoodHistoryScreen (R12.4).
 */
export function useFriendFoodList(
  friendId: string,
  params: FriendFoodListParams = {},
): UseInfiniteQueryResult<InfiniteData<FriendFoodRatingsPageDTO, string | undefined>, ApiError> {
  return useInfiniteQuery<
    FriendFoodRatingsPageDTO,
    ApiError,
    InfiniteData<FriendFoodRatingsPageDTO, string | undefined>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: friendFoodRatingsKeys.list(friendId, params),
    queryFn: ({ pageParam }) => {
      const qs = buildFriendFoodListQueryString(params, pageParam);
      return apiRequest<FriendFoodRatingsPageDTO>(
        'GET',
        `/users/${encodeURIComponent(friendId)}/food-ratings${qs}`,
      );
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    retry: retryUnlessForbidden,
  });
}

/**
 * Batch social proof query for menus and picker modals (R14.1, R15.1, R15.2).
 * Single request per scope per screen, staleTime 5 min, retry: false.
 */
export function useFriendFoodSocialProof(
  kind: FoodScopeKind,
  id: string | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<FriendFoodSocialProofResponseDTO, ApiError> {
  const isEnabled = Boolean(id) && (options?.enabled ?? true);
  return useQuery<FriendFoodSocialProofResponseDTO, ApiError>({
    queryKey: friendFoodRatingsKeys.socialProof(kind, id ?? ''),
    queryFn: () => {
      const encoded = encodeURIComponent(id!);
      const endpoint =
        kind === 'experience'
          ? `/experiences/${encoded}/food-item-logs/friends`
          : `/locations/${encoded}/food-item-logs/friends`;
      return apiRequest<FriendFoodSocialProofResponseDTO>('GET', endpoint);
    },
    staleTime: 5 * 60_000,
    retry: false,
    enabled: isEnabled,
  });
}

