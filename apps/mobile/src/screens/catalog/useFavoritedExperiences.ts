/**
 * useFavoritedExperiences — resolve the signed-in User's set of favorited
 * Experience ids for mobile surfaces.
 *
 * Validates: Requirements 1.5, 2.4
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { FavoritesResponseDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';

export const FAVORITES_QUERY_KEY = ['me', 'favorites'] as const;

/** 5 minutes — matches the catalog's react-query staleness interval. */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * The set of Experience ids the signed-in User has marked as favorite, for use
 * as an O(1) membership check when rendering surfaces across the app. Empty while
 * loading or on error.
 */
export function useFavoritedExperiences(): ReadonlySet<string> {
  const query = useQuery<FavoritesResponseDTO>({
    queryKey: FAVORITES_QUERY_KEY,
    queryFn: () => apiRequest<FavoritesResponseDTO>('GET', '/me/favorites'),
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  return useMemo<ReadonlySet<string>>(
    () => new Set(query.data?.experienceIds ?? []),
    [query.data?.experienceIds],
  );
}
