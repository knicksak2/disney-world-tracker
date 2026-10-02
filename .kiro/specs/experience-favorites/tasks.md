# Implementation Plan

## Tasks

- [x] 1. Migration and Shared Schema Contracts
  - [x] 1.1 Create migration `apps/api/migrations/0054_experience_favorites.sql` adding `experience_favorites` (composite PK `(user_id, experience_id)`, `favorited_at TIMESTAMPTZ NOT NULL DEFAULT now()`, both FKs `ON DELETE CASCADE`) and its two indexes (`experience_favorites_user_idx`, `experience_favorites_experience_idx`) per design.md Data Models
    - _Requirements: 1.1, 1.3, 1.5_
  - [x] 1.2 Add migration unit test `apps/api/src/db/__tests__/migration0054.test.ts` asserting the table, composite PK, both `ON DELETE CASCADE` behaviors (deleting a `users` row and an `experiences` row each remove the dependent favorite row), and both indexes exist
    - _Requirements: 1.1, 1.3_
  - [x] 1.3 Define `FavoritesResponseDTO`, `GroupFavoriteDTO`, `GroupFavoritesResponseDTO` in `packages/shared/src/dto/Favorite.ts`; barrel them in `packages/shared/src/dto/index.ts`. No new Zod schemas or `ErrorCode` entries are needed (design.md Error Handling) — confirm no gap exists before closing this task
    - _Requirements: 1.5, 9.1_

- [x] 2. Favorite Repository and Routes (`tracking/favorite/`)
  - [x] 2.1 Implement `FavoriteRepo` in `apps/api/src/services/tracking/favorite/repo.ts`: `favorite` (existence/active check against `experiences`, then `INSERT ... ON CONFLICT DO NOTHING`, throws `experience_not_found` when the Experience is missing/inactive), `unfavorite` (plain idempotent `DELETE`, no existence check), `listFavoriteIds` — no transactions needed per design.md (single-statement atomicity suffices)
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [x] 2.2 Implement `favoriteRoutes` in `apps/api/src/services/tracking/favorite/routes.ts`: `PUT /me/experiences/:id/favorite`, `DELETE /me/experiences/:id/favorite`, `GET /me/favorites`, mirroring `tracking/completion/routes.ts`'s `requireUser`/`parseOrAppError`/local `.strict()` params-schema structure; no request body accepted on PUT/DELETE
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 2.3 Write property tests `apps/api/src/services/tracking/favorite/__tests__/favorite.prop.test.ts` (pg-mem, `0001_init.sql` + `0054_experience_favorites.sql`) validating Property 1 (idempotency of favorite/unfavorite), Property 3 (reject-before-write on non-existent/inactive Experience), and Property 4 (per-user isolation — seed two Users, assert no cross-contamination)
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [x] 2.4 Write route integration tests `apps/api/src/services/tracking/favorite/__tests__/routes.test.ts` with a fake `FavoriteRepo` (call-recording arrays, injectable thrown errors): the 401 auth gate on all three routes, the 404 `experience_not_found` path on PUT, the 204/200 success response shapes, and that DELETE never invokes any existence-check path
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 2.5 Wire `favoriteRepo`/`favoriteRoutes` into `composeServices.ts` and `server.ts`'s `BuildServerServices` opt-in block, mirroring the three-edit pattern used by every existing opt-in service
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [x] 2.6 Checkpoint — run `npm run verify:api` and `npm run verify:shared`

- [x] 3. Trip Group Favorites (Backend)
  - [x] 3.1 Add the Group Favorites read (the `GROUP BY ... HAVING count(*) >= 2` join across `experience_favorites`/`trip_memberships`/`experiences`/`profiles` from design.md) to the Trips repo, gated by the existing `assertTripMember` helper from `trips/authz.ts`
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 3.2 Add `GET /trips/:id/favorites/shared` to the existing Trips routes module, returning `GroupFavoritesResponseDTO`
    - _Requirements: 9.1, 9.2_
  - [x] 3.3 Write property/integration tests validating Property 9 (membership-scoped, read-time computation — a departed Member's favorite disappears immediately), Property 10 (strict 2+ overlap, singleton exclusion, exact `favoritingCount`), and Property 11 (non-member and non-existent Trip collapse to identical `403 trip_forbidden`), plus a `server.inject` route test for the `200`/`403` shapes
    - _Requirements: 9.1, 9.2, 9.3, 9.5_
  - [x] 3.4 Checkpoint — run `npm run verify:api`

- [x] 4. Shared Favorited-Set Hook and Favorite Toggle Component (Mobile)
  - [x] 4.1 Create `apps/mobile/src/screens/catalog/useFavoritedExperiences.ts` (single `useQuery` against `GET /me/favorites`, 5-minute `staleTime`, `retry: false`, returns a memoized `ReadonlySet<string>`), exporting `FAVORITES_QUERY_KEY`
    - _Requirements: 1.5, 2.4_
  - [x] 4.2 Create `apps/mobile/src/screens/catalog/FavoriteToggle.tsx`: a `useMutation`-based optimistic toggle (`onMutate` optimistic cache update, `onError` rollback, `onSettled` invalidate `FAVORITES_QUERY_KEY`) accepting `experienceId`/`favorited`/`size`, rendering a heart `Ionicons` `Pressable` with `accessibilityState.selected` and a stable `testID`
    - _Requirements: 2.2, 2.3, 2.4, 3.3_
  - [x] 4.3 Write `useFavoritedExperiences.test.ts` (mocked network layer, asserts correct `Set` on success and empty `Set` on error/loading) and `FavoriteToggle.test.tsx` (real component render, mocked `apiRequest`, asserts optimistic flip + rollback-on-rejection for both the favorite and unfavorite directions)
    - _Requirements: 1.1, 1.3, 2.2, 2.3_
  - [x] 4.4 Checkpoint — run `npm run verify:mobile`

- [x] 5. Experience Detail Screen Favorite Toggle
  - [x] 5.1 Widen `ExperienceDetailScreen.tsx`'s `GradientHeader` `right` prop to a `View` containing the existing `experience-share-button` and a new `<FavoriteToggle size="large" .../>`, reading `favorited` from `useFavoritedExperiences()`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 5.2 Extend `ExperienceDetailScreen.test.tsx`: the header renders both the share button and the favorite toggle; tapping the toggle dispatches the correct PUT/DELETE; a mocked second consumer of `useFavoritedExperiences()` reflects the post-toggle state after invalidation (Property 5 at the component level)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 5.3 Checkpoint — run `npm run verify:mobile`

- [x] 6. Catalog Row Favorite Toggles (CatalogScreen and DestinationScreen)
  - [x] 6.1 Thread a `favoritedIds: ReadonlySet<string>` prop into `CatalogScreen.tsx`'s `SearchResultsBody`/`SearchResultRow`, parallel to the existing `completedIds`/`completed` threading, rendering `<FavoriteToggle size="small" .../>` on each row without triggering the row's own tap-to-detail navigation
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 6.2 Apply the identical treatment to `DestinationScreen.tsx`'s `ExperienceRow` across every layout (`ThemeOrWaterParkLayout`, `DisneySpringsLayout`, `ResortsLayout`) that renders it
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 6.3 Extend `CatalogScreen.test.tsx` and `DestinationScreen.test.tsx`: each row renders a favorite toggle reflecting a mocked Favorited_Set; tapping the toggle does not invoke the row's `onSelectExperience`/navigation callback
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 6.4 Checkpoint — run `npm run verify:mobile`

- [x] 7. Destination "Favorites Only" Filter and Cross-Park "My Favorites" View
  - [x] 7.1 Add a "Favorites only" toggle control to `DestinationScreen.tsx`, applied as a `.filter()` stage against `favoritedIds` composed conjunctively with the existing category/land/attribute filters (not folded into `deriveFilterChips`); add the distinct empty-state copy for an active-toggle, zero-match result
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 7.2 Add a "My Favorites" entry point to `CatalogScreen.tsx`'s `GridBody`, opening a flat favorited-results mode that reuses `SearchResultsBody`'s `FlatList` renderer fed by the already-loaded full-catalog data filtered to the Favorited_Set; add the empty state for a zero-favorite User
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 7.3 Write property test (extend an existing filter-pipeline prop test or add a new one) validating Property 6 (Favorites filter composes conjunctively, never as a union, with other active filters) on `DestinationScreen`'s pipeline
    - _Requirements: 4.2_
  - [x] 7.4 Extend `DestinationScreen.test.tsx` (toggle + simultaneous category chip → correct intersection; empty state) and `CatalogScreen.test.tsx` ("My Favorites" entry renders the flat list and its own empty state; selecting a result navigates to `Experience_Detail_Screen`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 7.5 Checkpoint — run `npm run verify:mobile`

- [x] 8. ExperiencePicker Favorites Quick Chip
  - [x] 8.1 Add a local `favoritesOnly` boolean state to `ExperiencePicker.tsx`, rendered as a quick chip alongside the existing derived quick-chips, filtering `tabFilteredResults` (chained after the existing `filterExperiencesMulti` call) against `favoritedIds` from `useFavoritedExperiences()` — no change to `TAB_CATEGORIES`, `ExperiencePickerTab`, `deriveFilterChips`, or `deriveQuickChips`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 8.2 Write/extend a property test validating Property 6 (Favorites chip composes conjunctively with an active land/attribute chip) scoped to `ExperiencePicker`'s pipeline
    - _Requirements: 6.2_
  - [x] 8.3 Extend `ExperiencePicker.test.tsx`: the Favorites chip renders and filters correctly with another chip simultaneously active; the `POST /trips/:id/planned-items` submission payload for a selected candidate is unaffected by the chip's active state (confirms Requirement 6.4's optimizer non-interference at the submission boundary)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 8.4 Checkpoint — run `npm run verify:mobile`

- [x] 9. Live Waits Favorites Filter
  - [x] 9.1 Widen `LiveWaitsFilter` to include `'favorites'` in `apps/mobile/src/screens/liveWaits/parkLiveView.ts`; add the defaulted `favoritedIds: ReadonlySet<string> = EMPTY_FAVORITED_SET` parameter to `buildLiveWaitsRows` and the `filter === 'favorites'` branch
    - _Requirements: 7.1, 7.2_
  - [x] 9.2 Wire `LiveWaitsScreen.tsx` to call `useFavoritedExperiences()` and thread the resulting set into both the `allRows` and `rows` `buildLiveWaitsRows(...)` calls; add the fifth `❤️ Favorites` filter pill copying the existing `headliners` pill's markup
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 9.3 Write/extend a `fast-check` property test directly against `buildLiveWaitsRows` validating Property 7 (favorites filter intersects Favorited_Set with the active park's entries, re-applies correctly on a park switch) and Property 8 (omitting the new parameter reproduces pre-existing behavior byte-for-byte for every other filter value)
    - _Requirements: 7.1, 7.2, 7.4_
  - [x] 9.4 Extend `LiveWaitsScreen.test.tsx`: the fifth pill renders and selects correctly; selecting it filters rows to the mocked favorited subset; the existing "No rides match this filter" empty state renders when that subset is empty for the active park; switching parks while the filter is active recomputes against the new park
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 9.5 Checkpoint — run `npm run verify:mobile`

- [x] 10. Home Tab "Your Favorites" Section
  - [x] 10.1 Create `apps/mobile/src/screens/home/HomeFavoritesSection.tsx`: reads `useFavoritedExperiences()`, groups favorited Experiences by `park`, issues one `['park-live', park]`-keyed `useQuery` per distinct park (sharing `ParkWaitPulse`'s existing query key/cache rather than duplicating network calls), renders a horizontal scroll of pills showing each favorited Experience's name and live wait status; renders a compact empty/prompt state when there are no favorites or none with live data
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 10.2 Render `<HomeFavoritesSection />` in `HomeScreen.tsx` immediately below the existing `<ParkWaitPulse ... />`, making no edits to `ParkWaitPulse.tsx` or `pulseCalculations.ts`
    - _Requirements: 8.1, 8.5_
  - [x] 10.3 Extend `HomeScreen.render.test.tsx`: the new section renders below the Pulse carousel without altering any existing `home-park-wait-pulse`/`home-pulse-pill-*` assertion (explicit non-regression check); selecting a favorited pill navigates to `Experience_Detail_Screen`; the empty/prompt state renders for a zero-favorite User
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 10.4 Checkpoint — run `npm run verify:mobile`
  - [x] 10.5 Redesign `HomeFavoritesSection.tsx`: sort open attractions with wait times before closed/down attractions (ascending wait), widen cards to 180px with park top accent border, replace floating dot with structured status badge, add subtle heart icon and header "See All ›" link routing to favorites-filtered Live Waits
    - _Requirements: 8.2, 8.6_

- [x] 11. Trip Group Favorites (Mobile)
  - [x] 11.1 Create `apps/mobile/src/screens/trips/GroupFavoritesSection.tsx`: fetches `GET /trips/:id/favorites/shared`, renders a titled "Group Favorites" card section listing each Experience with its favoriting Members' display names, and a distinct empty state when the result is empty
    - _Requirements: 9.1, 9.4, 9.5_
  - [x] 11.2 Render `<GroupFavoritesSection tripId={tripId} />` on `TripDetailScreen.tsx` alongside the existing `AttachedFoodListsSection`/`AttachedExperienceListsSection` sections
    - _Requirements: 9.4_
  - [x] 11.3 Extend `TripDetailScreen.test.tsx`: the "Group Favorites" section renders the mocked result with correct titles/names, is textually distinct from any "Crowd Favorite" assertion in the suite, and renders its empty state for a zero-overlap mocked result
    - _Requirements: 9.1, 9.4, 9.5_
  - [x] 11.4 Checkpoint — run `npm run verify:mobile`

- [x] 12. Final Verification Gate
  - [x] 12.1 Run the full `npm run verify` (typecheck + test suite across `apps/api`, `apps/mobile`, `packages/shared`) once, as the final gate for the complete change; paste the literal tail output (per-workspace pass counts and exit code) before declaring the feature done
    - _Requirements: all_

- [x] 13. Amendment — Promote ExperiencePicker Favorites From a Quick-Chip to a Dedicated Tab (Requirement 6, revised)
  - [x] 13.1 Widen `ExperiencePickerTab` to include `'favorites'` in `experiencePickerFilters.ts`; add `TAB_CATEGORIES.favorites = []`, `POPULAR_QUICK_TAGS_BY_TAB.favorites = []`, and a `'favorites'` case to `formatEmptyFilterMessage`'s `tabLabel` branching
    - _Requirements: 6.1, 6.3_
  - [x] 13.2 In `ExperiencePicker.tsx`: add `favoriteSourcedItems`/`favoriteSourcedLoading` props mirroring `listSourcedItems`/`listSourcedLoading`; add `hasFavoritesTab` and its tab-bar `Pressable` (`❤️ Favorites`) alongside the existing `hasMyListsTab` tab; extend `searchActive`, the `GET /catalog` `enabled` guard, `rawResults`, the search placeholder, and the loading/error branches with a `'favorites'` case alongside each existing `'myLists'` case; remove the old `favoritesOnly` state, its quick-chip `Pressable`, the now-redundant `multiFilteredResults`/`filteredResults` split, and the `useFavoritedExperiences` import (favorites are now caller-resolved, never fetched inside the picker)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 13.3 Create `apps/mobile/src/screens/catalog/useFavoriteSourcedExperienceItems.ts`: resolves `useFavoritedExperiences()` against a `GET /catalog` read keyed `['catalog', 'all']` (shared with `CatalogScreen`'s "My Favorites" view and `TripScheduleScreen`'s own `catalogQuery`), returning `{ items, isLoading }` mirroring `useAttachedExperienceListItems`'s shape
    - _Requirements: 6.5_
  - [x] 13.4 Wire `useFavoriteSourcedExperienceItems` into `TripPlannedListScreen.tsx` and `TripScheduleScreen.tsx` alongside each screen's existing `useAttachedExperienceListItems*` call, gated identically (modal-visible/open), and pass the result as `favoriteSourcedItems`/`favoriteSourcedLoading` into each screen's `ExperiencePicker` usage; `TripReservationsScreen.tsx` requires no change (`showTabs={false}` already suppresses every tab)
    - _Requirements: 6.5_
  - [x] 13.5 Rewrite the stale quick-chip test in `ExperiencePicker.test.tsx` into a "Favorites" tab suite mirroring the existing "My Lists" tab suite's structure (tab omission when empty, tab render + no-`GET /catalog` on selection, loading state, `onSelect` payload purity, and land/attribute-chip conjunction via the Filters modal); update `experiencePickerFilters.prop.test.ts`'s Property 6 framing comment to reflect that the chip was promoted to a tab (the underlying set-intersection math is unchanged and needed no test logic changes)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x] 13.6 Checkpoint — run `npm run typecheck` and the mobile test suite scoped to `ExperiencePicker`, `experiencePickerFilters`, `TripPlannedListScreen`, `TripScheduleScreen`, and `TripReservationsScreen`

## Notes

- **No optimizer changes.** Requirement 6.4 and design.md are explicit: `day-planning-optimization`'s `optimizer.ts`/`OptimizeInput` are not touched by any task in this plan. The Favorites quick chip (Task 8) is a display/candidate filter only, applied before the User manually adds an item to a Trip's Planned_List — it never becomes a cost-function input.
- **No proactive push notifications.** No task in this plan adds experience-level push infrastructure or a wait-threshold alert. This is a deliberate deferral (see requirements.md Introduction) — revisit only as a future, separately-scoped spec once a polling/notification strategy consistent with the free-tier hosting constraints exists.
- **`ParkWaitPulse`/`pulseCalculations.ts` are read-only precedent, never edited.** Tasks 10.1–10.3 add a new, separate component and section; no task in this plan modifies `ParkWaitPulse.tsx`, `pulseCalculations.ts`, or Property 7 of `navigation-redesign`'s design.md. The non-regression assertion in Task 10.3 exists specifically to catch an accidental edit.
- **Naming collision avoidance.** "Group Favorites" (Task 11) must never be labeled or styled as a variant of the existing "Crowd Favorite" Trip_Summary superlative (`apps/api/src/services/trips/summary.ts`, id `crowd_favorite`) — the two are unrelated (favorite-marker overlap vs. highest-average-rating), and Task 11.3's test explicitly guards against the two being conflated in copy.
- **One shared toggle component.** `FavoriteToggle.tsx` (Task 4.2) is the single implementation reused at every surfacing point (Tasks 5, 6, 7.2, 10.1) — do not create a second, divergent toggle implementation for any surface; differences between surfaces are expressed only via the `size` prop.
- **One shared cache key.** `FAVORITES_QUERY_KEY` (Task 4.1) is invalidated by every mutation and read by every consuming hook/component across Tasks 5–11 — do not introduce a second query key for the Favorited_Set on any surface.
- **Task 13 is a formal amendment, not new scope.** Requirement 6.3 originally forbade a dedicated `ExperiencePickerTab` value for Favorites; real-world use showed the quick-chip-over-an-already-loaded-pool design left favorites undiscoverable from the picker's default state (the "All" tab with nothing selected never issues a `GET /catalog` call, so the chip filtered an empty list to an empty list). Requirement 6.3 is revised (not deleted) to require the tab mechanism instead — see requirements.md's amendment note on Requirement 6. `ExperiencePicker`'s "Favorites" tab is deliberately built as a structural clone of the pre-existing "My Lists" tab (same `hasXTab` gating pattern, same caller-resolved-prop shape) rather than a novel mechanism.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2"] },
    { "id": 3, "tasks": ["2.4", "2.5", "3.3"] },
    { "id": 4, "tasks": ["2.6", "3.4"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.2"] },
    { "id": 7, "tasks": ["4.3"] },
    { "id": 8, "tasks": ["4.4"] },
    { "id": 9, "tasks": ["5.1", "6.1", "7.1", "8.1", "9.1"] },
    { "id": 10, "tasks": ["5.2", "6.2", "7.2", "8.2", "9.2"] },
    { "id": 11, "tasks": ["5.3", "6.3", "7.3", "8.3", "9.3"] },
    { "id": 12, "tasks": ["6.4", "7.4", "8.4", "9.4"] },
    { "id": 13, "tasks": ["7.5", "9.5"] },
    { "id": 14, "tasks": ["10.1", "11.1"] },
    { "id": 15, "tasks": ["10.2", "11.2"] },
    { "id": 16, "tasks": ["10.3", "11.3"] },
    { "id": 17, "tasks": ["10.4", "11.4"] },
    { "id": 18, "tasks": ["12.1"] },
    { "id": 19, "tasks": ["13.1"] },
    { "id": 20, "tasks": ["13.2", "13.3"] },
    { "id": 21, "tasks": ["13.4"] },
    { "id": 22, "tasks": ["13.5"] },
    { "id": 23, "tasks": ["13.6"] }
  ]
}
```

Tasks within a wave can proceed in parallel; each wave depends only on earlier waves. The ASCII
diagram below shows the same structure at task-group granularity (collapsing each task's internal
subtask sequence, waves 9-17 above, into a single arrow) for a quicker visual read.

```
1. Migration & Shared Schema Contracts
   │
   ├──> 2. Favorite Repository and Routes ──┐
   │                                        │
   └──> 3. Trip Group Favorites (Backend)   │
                                             │
   2 ──> 4. Favorited-Set Hook & Toggle (Mobile)
                                             │
         ┌───────────────┬──────────────────┼──────────────────┬─────────────────┐
         ▼               ▼                  ▼                  ▼                 ▼
   5. Detail Screen  6. Catalog Rows   7. Destination    8. Picker Chip   9. Live Waits Filter
      Toggle            Toggles           Filter +                           (parkLiveView.ts)
                                           "My Favorites"
         │               │                  │                  │                 │
         └───────────────┴──────────────────┴──────────────────┴─────────────────┘
                                             │
                        ┌────────────────────┴────────────────────┐
                        ▼                                         ▼
         10. Home "Your Favorites" Section            11. Trip Group Favorites (Mobile)
              (depends on 4; independent                   (depends on 3 for the backend
               of 5–9, reads the same hook)                 endpoint, and on 4 for the hook
                                                             pattern — though this section
                                                             reads the Group Favorites endpoint
                                                             directly, not useFavoritedExperiences)
                        │                                         │
                        └────────────────────┬────────────────────┘
                                             ▼
                              12. Final Verification Gate
```

Tasks 5 through 9 are mutually independent once Task 4 lands and may be implemented in any
order (or in parallel across contributors); each depends only on Task 4's hook/component, not on
one another. Task 11 depends on Task 3 (the backend endpoint) rather than on Tasks 5–9. Task 10
depends only on Task 4.
