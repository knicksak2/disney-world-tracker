// Query key for a single Trip's header info; keyed by Trip_Identifier.
//
// Extracted from `TripDetailScreen.tsx` into its own module so that sibling
// components (e.g. `AttachedFoodListsSection.tsx`, which `TripDetailScreen`
// renders) can depend on the key without importing `TripDetailScreen` itself,
// which would create a require cycle
// (TripDetailScreen -> AttachedFoodListsSection -> TripDetailScreen).
//
// `TripDetailScreen.tsx` re-exports `tripDetailKeys` from here so existing
// imports of `{ tripDetailKeys } from './TripDetailScreen'` keep working.
export const tripDetailKeys = {
  detail: (tripId: string) => ['trips', 'detail', tripId] as const,
};
