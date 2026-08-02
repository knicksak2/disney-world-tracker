/**
 * useCompletedExperiences — resolve the signed-in User's set of completed
 * Experience ids for the catalog list views.
 *
 * The catalog list surfaces (the Catalog_Home global-search results and the
 * Destination_Screen grouped / search lists) want to show, at a glance, which
 * Experiences the User has already marked as visited without drilling into each
 * one. The per-Experience Completion read (`GET /me/experiences/:id/completion`)
 * is the wrong tool for a list — it would fan out one request per row. Instead
 * this hook reuses the target-scoped Completions list the Stats surfaces already
 * consume:
 *
 *   1. `GET /me` resolves the signed-in User's id (cached under `['me']`, the
 *      canonical "who am I" probe shared with `ProfileScreen`).
 *   2. `GET /users/:userId/completions` returns up to 5,000 of the User's
 *      Completions over active Experiences; the hook projects the entries down
 *      to a `Set<experienceId>` for O(1) membership checks per row.
 *
 * Both reads go through react-query with the catalog's 5-minute staleness so a
 * freshly-marked Completion shows up on the next list visit, and both fail
 * soft: any error (or a still-loading state) yields an empty set so the list
 * simply renders without completion markers rather than erroring. Marking a
 * Completion elsewhere invalidates `['me', 'completions']`, so callers that
 * mutate Completions can refresh the markers by invalidating that key.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { FriendCompletionsDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';

/** 5 minutes — matches the catalog's react-query staleness interval. */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Minimal shape of `GET /me` — only the signed-in user's id is read. Mirrors
 * `MeResponseBody` in `apps/api/src/services/auth/routes.ts`.
 */
interface MeResponse {
  readonly user: { readonly id: string };
}

/**
 * The set of Experience ids the signed-in User has marked as completed, for use
 * as an O(1) membership check when rendering catalog list rows. Empty while
 * loading or on any error so the list degrades gracefully.
 */
export function useCompletedExperiences(): ReadonlySet<string> {
  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
    staleTime: STALE_TIME_MS,
  });

  const userId = meQuery.data?.user.id;

  const completionsQuery = useQuery<FriendCompletionsDTO>({
    queryKey: ['me', 'completions'],
    queryFn: () =>
      apiRequest<FriendCompletionsDTO>(
        'GET',
        `/users/${encodeURIComponent(userId as string)}/completions`,
      ),
    enabled: typeof userId === 'string' && userId.length > 0,
    staleTime: STALE_TIME_MS,
    // A failed completions read must not break the catalog list; the empty set
    // below simply renders the list without completion markers.
    retry: false,
  });

  return useMemo<ReadonlySet<string>>(() => {
    const ids = new Set<string>();
    for (const entry of completionsQuery.data?.entries ?? []) {
      if (typeof entry.experienceId === 'string' && entry.experienceId.length > 0) {
        ids.add(entry.experienceId);
      }
    }
    return ids;
  }, [completionsQuery.data?.entries]);
}
