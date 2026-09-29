// Feature: experience-lists — Schedule Builder / Planned List Picker Integration (Requirement 15).
//
// Fetches every currently-attached, available Experience_List's contents for
// a Trip and merges them into one flat, deduplicated-by-`experienceId` result
// set for `ExperiencePicker`'s "My Lists" tab (Requirement 15.1, 15.2, 15.3).
//
// This hook is Trip-scoped fetching that the two caller screens
// (`TripPlannedListScreen`, `TripScheduleScreen`) own — `ExperiencePicker`
// itself never fetches a Trip or an Experience_List; it only renders whatever
// `listSourcedItems` the caller passes it. Both add-item flows need identical
// merge behavior, so the fetch/merge logic lives here once rather than being
// duplicated per screen (Requirement 15.1's "used by both" framing).
//
// `ExperienceListItemDTO` (the wire shape returned by
// `GET /experience-lists/:id`) is a lighter-weight projection than
// `ExperienceDTO` — it carries `experienceId`/`name`/`park`/`category` but
// none of the Catalog enrichment fields (`description`, `active`,
// `imageUrl`, `areaType`, `land`, `groupedFacets`, ...). There is no
// `GET /catalog?ids=` batch-by-id endpoint to resolve real values for those
// fields, so `toExperienceDTO` below fills the handful of fields that are
// *required* on `ExperienceDTO` with inert placeholders. This is safe
// specifically because `ExperiencePicker`'s rendering/filtering/grouping
// pipeline (`ExperienceResultRow`, `browseLandOf`, `deriveFilterChips`,
// `groupByPavilionFiltered`) never reads `description`, `active`, or
// `areaType`, and treats a `null` `imageUrl` as an ordinary, already-handled
// case (R7.5's category-placeholder fallback) — so the placeholders can
// never surface as incorrect data, only as absent optional fields.

import { useQueries, useQuery } from '@tanstack/react-query';

import {
  type ExperienceDTO,
  type ExperienceListDetailDTO,
  type ExperienceListItemDTO,
  type TripDTO,
  type TripExperienceListDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { tripDetailKeys } from './tripDetailQueryKeys';

/** Query key namespace for one attached Experience_List's detail read. */
export const attachedExperienceListItemsKeys = {
  detail: (experienceListId: string) =>
    ['experience-lists', 'detail', experienceListId] as const,
};

/**
 * Converts the lightweight `ExperienceListItemDTO` wire shape into the
 * `ExperienceDTO` shape `ExperiencePicker` expects. Only `id` needs an actual
 * rename (`experienceId` -> `id`); the handful of `ExperienceDTO` fields with
 * no `ExperienceListItemDTO` counterpart are filled with inert, never-read
 * placeholders (see module doc comment).
 */
function toExperienceDTO(item: ExperienceListItemDTO): ExperienceDTO {
  return {
    id: item.experienceId,
    name: item.name,
    park: item.park,
    category: item.category,
    description: '',
    active: true,
    imageUrl: null,
    areaType: 'ThemePark',
  };
}

/** The `available: true` variant of `TripExperienceListDTO`. */
function isAvailableList(
  entry: TripExperienceListDTO,
): entry is Extract<TripExperienceListDTO, { available: true }> {
  return entry.available;
}

export interface UseAttachedExperienceListItemsResult {
  /** Flat, deduplicated-by-`experienceId` union of every attached list's items. */
  readonly items: readonly ExperienceDTO[];
  /** True while any attached list's contents are still being fetched. */
  readonly isLoading: boolean;
}

/**
 * Fetches every attached (available) Experience_List's contents for a Trip
 * and merges them into one flat, deduplicated-by-`experienceId` result set.
 *
 * @param experienceLists The Trip's already-fetched `TripDTO.experienceLists`
 *   (Requirement 15.1 — no new fetch is needed to know whether any lists are
 *   attached). Pass `undefined` while the Trip itself is still loading.
 */
export function useAttachedExperienceListItems(
  experienceLists: readonly TripExperienceListDTO[] | undefined,
  enabled: boolean = true,
): UseAttachedExperienceListItemsResult {
  const availableListIds = (experienceLists ?? [])
    .filter(isAvailableList)
    .map((entry) => entry.experienceListId);

  const listQueries = useQueries({
    queries: availableListIds.map((experienceListId) => ({
      queryKey: attachedExperienceListItemsKeys.detail(experienceListId),
      queryFn: () =>
        apiRequest<ExperienceListDetailDTO>(
          'GET',
          `/experience-lists/${experienceListId}`,
        ),
      enabled,
    })),
  });

  const isLoading = listQueries.some((q) => q.isLoading);

  const seen = new Set<string>();
  const items: ExperienceDTO[] = [];
  for (const query of listQueries) {
    const detail = query.data as ExperienceListDetailDTO | undefined;
    if (!detail) continue;
    for (const item of detail.items) {
      if (seen.has(item.experienceId)) continue;
      seen.add(item.experienceId);
      items.push(toExperienceDTO(item));
    }
  }

  return { items, isLoading };
}

/**
 * Convenience wrapper for a caller screen that only has a `tripId` and has
 * not already fetched the Trip elsewhere — fetches the Trip (keyed
 * identically to `tripDetailKeys.detail`, so it shares cache with any other
 * screen reading the same Trip) and derives the attached-list merge from it.
 */
export function useAttachedExperienceListItemsForTrip(
  tripId: string,
  enabled: boolean = true,
): UseAttachedExperienceListItemsResult {
  const tripQuery = useQuery<TripDTO, ApiError>({
    queryKey: tripDetailKeys.detail(tripId),
    queryFn: () => apiRequest<TripDTO>('GET', `/trips/${tripId}`),
    enabled,
  });

  const merged = useAttachedExperienceListItems(tripQuery.data?.experienceLists, enabled);

  return {
    items: merged.items,
    isLoading: enabled && (tripQuery.isLoading || merged.isLoading),
  };
}
