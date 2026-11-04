import type { QueryClient } from '@tanstack/react-query';

import { tripFeedKeys } from '../trips/tripFeedQueryKeys';
import { tripsListKeys } from '../trips/TripsListScreen';

/**
 * Invalidate all queries affected by logging an experience completion.
 *
 * Invalidates:
 *  - Every key that ExperienceDetailScreen.invalidateAfterLogChange invalidates:
 *      ['experience-logs', experienceId], ['experience-completion', experienceId],
 *      ['experience-rating', experienceId], ['experience-aggregate', experienceId],
 *      ['scoped-food-item-logs', experienceId]
 *  - Global user stats and trip picker queries:
 *      ['me-stats'], ['me', 'trips', 'active'], tripsListKeys.list()
 *  - When tripId !== null:
 *      tripFeedKeys.feed(tripId), ['trips', tripId, 'summary'], ['trips', tripId, 'planned-items']
 */
export function invalidateAfterLog(
  qc: QueryClient,
  a: { readonly experienceId: string; readonly tripId: string | null },
): void {
  // Experience-scoped keys (matching ExperienceDetailScreen.invalidateAfterLogChange)
  void qc.invalidateQueries({
    queryKey: ['experience-logs', a.experienceId],
  });
  void qc.invalidateQueries({
    queryKey: ['experience-completion', a.experienceId],
  });
  void qc.invalidateQueries({
    queryKey: ['experience-rating', a.experienceId],
  });
  void qc.invalidateQueries({
    queryKey: ['experience-aggregate', a.experienceId],
  });
  void qc.invalidateQueries({
    queryKey: ['scoped-food-item-logs', a.experienceId],
  });

  // Global user stats and trips queries
  void qc.invalidateQueries({
    queryKey: ['me-stats'],
  });
  void qc.invalidateQueries({
    queryKey: ['me', 'trips', 'active'],
  });
  void qc.invalidateQueries({
    queryKey: tripsListKeys.list(),
  });

  // Trip-scoped queries (when linked to a Trip)
  if (a.tripId !== null) {
    void qc.invalidateQueries({
      queryKey: tripFeedKeys.feed(a.tripId),
    });
    void qc.invalidateQueries({
      queryKey: ['trips', a.tripId, 'summary'],
    });
    void qc.invalidateQueries({
      queryKey: ['trips', a.tripId, 'planned-items'],
    });
  }
}

