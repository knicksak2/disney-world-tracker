// Feature: experience-favorites — ExperiencePicker "Favorites" Tab (Requirement 6, amended).
//
// Resolves the User's Favorited_Set (a bare set of `experienceId`s) into full
// `ExperienceDTO`-shaped rows for `ExperiencePicker`'s "Favorites" tab, the
// same way `useAttachedExperienceListItems.ts` resolves attached Experience_List
// contents for the "My Lists" tab. `ExperiencePicker` itself never fetches a
// favorited-id set or the catalog — it only renders whatever
// `favoriteSourcedItems` the caller passes it; this hook is the shared
// fetch/filter logic both caller screens (`TripPlannedListScreen`,
// `TripScheduleScreen`) use so the merge behavior is defined once.
//
// Unlike the "My Lists" merge (which fetches N Experience_List detail reads),
// resolving favorites needs just one additional read: the full active catalog
// (`GET /catalog`), filtered client-side to the Favorited_Set. Both caller
// screens already perform (or can share) a `['catalog', 'all']`-keyed full
// catalog read elsewhere in the app (`CatalogScreen`'s "My Favorites" view,
// `TripScheduleScreen`'s existing `catalogQuery`), so this hook reuses that
// exact query key — a mount of this hook alongside either of those screens
// shares one cached response rather than issuing a second `GET /catalog`.

import { useQuery } from '@tanstack/react-query';

import type { ExperienceDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { useFavoritedExperiences } from './useFavoritedExperiences';

/** Wire shape of `GET /catalog` — only the field this hook reads. */
interface CatalogAllResponse {
  readonly experiences: readonly ExperienceDTO[];
}

export interface UseFavoriteSourcedExperienceItemsResult {
  /** The User's favorited Experiences, resolved to full `ExperienceDTO` rows. */
  readonly items: readonly ExperienceDTO[];
  /** True while the Favorited_Set or the full catalog is still being fetched. */
  readonly isLoading: boolean;
}

/**
 * Fetches the User's Favorited_Set and the full active catalog, and returns
 * the favorited subset resolved to full `ExperienceDTO` rows.
 *
 * @param enabled Mirrors `listSourcedLoading`'s gating pattern — pass `false`
 *   (e.g. a closed modal) to skip both underlying fetches.
 */
export function useFavoriteSourcedExperienceItems(
  enabled: boolean = true,
): UseFavoriteSourcedExperienceItemsResult {
  const favoritedIds = useFavoritedExperiences();

  const catalogQuery = useQuery<CatalogAllResponse, ApiError>({
    queryKey: ['catalog', 'all'] as const,
    queryFn: () => apiRequest<CatalogAllResponse>('GET', '/catalog'),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const items = (catalogQuery.data?.experiences ?? []).filter((exp) =>
    favoritedIds.has(exp.id),
  );

  return {
    items,
    isLoading: enabled && catalogQuery.isLoading,
  };
}
