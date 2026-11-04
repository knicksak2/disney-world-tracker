// Query keys for the reads the Trip_Activity surface depends on.
//
// Extracted into its own module to break require cycles when external
// consumers (e.g. `invalidateAfterLog.ts`) need the query keys without
// pulling in `TripFeedScreen.tsx`.
//
// `TripFeedScreen.tsx` re-exports `tripFeedKeys` from here so existing
// imports of `{ tripFeedKeys } from './TripFeedScreen'` keep working.
export const tripFeedKeys = {
  feed: (tripId: string) => ['trips', 'feed', tripId] as const,
  members: (tripId: string) => ['trips', 'members', tripId] as const,
};

