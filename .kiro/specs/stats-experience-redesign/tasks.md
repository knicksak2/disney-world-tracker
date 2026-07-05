# Implementation Plan: Stats Experience Redesign

## Overview

This plan delivers the redesign in dependency order: the one additive backend
`byResort` coverage dimension first, then the mobile foundation (shared types,
chart primitives, pure display/selector transforms, and a shared test-fixture
builder), then navigation and shared section components, then the Overview hub
and detail screens that consume them, then the Friend Profile migration, and
finally the migration of every remaining fixture off the removed flat
`byParkAndCategory` shape. Pure/foundational modules always precede the screens
and wiring that use them, tests live alongside the unit they cover, and the last
task wires everything together with a full verification pass so no code is left
orphaned.

Implementation language is **TypeScript** (both `apps/api` and `apps/mobile`),
matching the existing codebase and the concrete types in the design.

Property-based tests use **fast-check** (already a devDependency), follow the
existing `*.prop.test.ts` conventions, and are tagged
`Feature: stats-experience-redesign, Property {n}: {text}`.

### Open decisions (flagged — resolve while implementing the tagged tasks)

- **(a) ProgressRing backing — `react-native-svg` vs primitive fallback (D4).**
  Resolve in task 3.2. Whichever is chosen, `ProgressRing` MUST expose the same
  props so callers are unaffected (R17.1, R17.2). Adopting `react-native-svg` is
  the only new (optional, Expo-managed) dependency.
- **(b) Centralize `ResortCoverage` in `@dwt/shared` vs mirror locally (D5/R17.3).**
  Resolve in task 1.1. Default is to mirror the shape locally on both sides
  (existing convention); centralizing in `@dwt/shared` is the one permitted
  shared-package touch. Either way the shape MUST be byte-identical on the route
  contract and the mobile layer.

## Tasks

- [x] 1. Backend: additive `byResort` coverage dimension (apps/api)
  - [x] 1.1 Create the pure roll-up module and `ResortCoverage` type
    - Add `apps/api/src/services/stats/resorts.ts` owning `RawResortCoverageRow { resortId, label, completed, total }`, the `ResortCoverage { resortId, label, cell }` type, and the pure `rollUpResortCoverage(rows)` that maps each raw row through the shared `toCompletionCell` and sorts by percent desc → total desc → case-insensitive label asc → exact label
    - Guarantee empty-list output for empty input and no duplicate `resortId`
    - **Decision (b):** define `ResortCoverage` here for local mirroring, OR export it from `@dwt/shared` if the team centralizes it — keep the shape identical either way
    - _Requirements: 7.5, 7.6, 7.7, 7.9, 7.10, 17.3_

  - [x] 1.2 Write property test for `rollUpResortCoverage`
    - New `apps/api/src/services/stats/__tests__/resortCoverage.prop.test.ts`
    - **Property 13: `byResort` bounds, independence & ordering** — cell laws (`0 <= completed <= total`, `total >= 1`, `percent ∈ [0,100]`, `remaining = total - completed`, `completeBadge ⇔ completed === total`), total-order sort, no duplicate `resortId`, empty-list behavior, independence from the hotels-visited stat (representing rows never counted)
    - Tag: `Feature: stats-experience-redesign, Property 13: byResort bounds, independence & ordering`
    - _Requirements: 7.6, 7.7, 7.8, 7.9, 7.10_

  - [x] 1.3 Add the grouped repo read inside the existing snapshot transaction
    - In `apps/api/src/services/stats/repo.ts`, add the denominator read (active experiences grouped by `resort_id`, joined to `resorts` for the name, excluding `represents_resort_id IS NOT NULL` rows and inactive resorts/experiences) and the numerator read (same grouping restricted to the target user's completions), inside the **existing** `REPEATABLE READ READ ONLY` transaction
    - Merge denominator/numerator counts per `resort_id` into `RawResortCoverageRow[]` and expose it on `StatsSnapshot` as `resortCoverage`; add no new transaction/endpoint/migration
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.11_

  - [x] 1.4 Write repo unit/merge test for the `byResort` reads
    - Mirror the existing coverage merge-test style: assert grouping by `resort_id`, the `resorts` name join, exclusion of `represents_resort_id IS NOT NULL` rows and inactive resorts/experiences, and correct merge into `RawResortCoverageRow[]`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 1.5 Surface `byResort` in the response contract and assembly
    - In `apps/api/src/services/stats/routes.ts`, add `byResort: readonly ResortCoverage[]` to `CoverageResponse`, import `ResortCoverage`/`rollUpResortCoverage`, and add `byResort: rollUpResortCoverage(snapshot.resortCoverage)` to the `coverage` object in `assembleResponse` — no change to gating/auth/percentile/error mapping
    - Both `GET /me/stats` and `GET /me/stats/summary` inherit `byResort` via the shared `assembleResponse`
    - _Requirements: 7.12, 17.3_

  - [x] 1.6 Write route/response tests for `byResort` on both endpoints
    - Extend the `routes`/`assembleResponse` tests to assert `byResort` is present in the `coverage` object of **both** `GET /me/stats` and `GET /me/stats/summary` (self and friend structurally identical), with the expected `ResortCoverage` shape and ordering
    - _Requirements: 7.12_

  - [x] 1.7 Update the expanded-stats performance test to exercise the added read
    - In `apps/api/src/services/stats/__tests__/repo.performance.test.ts`, seed active resort-linked experiences (with `resort_id`) so the grouped `byResort` read runs under load, and assert the request stays within the existing R11 latency envelope (2s / 3s statement-timeout unchanged)
    - _Requirements: 7.11_

- [x] 2. Checkpoint — backend `byResort` complete
  - Ensure all `apps/api` stats tests pass, ask the user if questions arise.

- [x] 3. Mobile foundation: shared types, chart primitives, and test fixture
  - [x] 3.1 Create the shared nested wire types
    - Add `apps/mobile/src/api/statsTypes.ts` with the nested `StatsResponse`, `CompletionCell`, `LabeledCell`, `FacetCoverage`, **`ResortCoverage`**, `RatingStatistics`, `RatingDistribution`, `RatedExperience`, and `MINIMUM_RATINGS_THRESHOLD = 3`; `CoverageResponse` includes `byResort: readonly ResortCoverage[]`
    - Shape MUST match the API route contract from task 1.5 (Decision (b))
    - _Requirements: 16.1, 16.2, 16.3, 17.3_

  - [x] 3.2 Create the chart primitives
    - Add `apps/mobile/src/theme/charts.tsx` with `ProgressRing`, `ProgressBar`, `RatingHistogram`, `RatingDial`, and `CompleteBadge`, built from RN primitives + `expo-linear-gradient`
    - **Decision (a):** implement `ProgressRing` behind a stable prop API that works identically whether backed by `react-native-svg` (smooth arc, flag-gated) or the zero-dependency primitive fallback
    - Each visual is a single accessible element with a spoken label; the histogram normalizes bars to `[0,1]` of the tallest non-zero bin (baseline for zero bins)
    - _Requirements: 8.6, 15.1, 17.1, 17.2_

  - [x] 3.3 Write unit tests for the chart primitives
    - Test `ProgressRing`/`ProgressBar` rendering at 0/partial/100%, `CompleteBadge` visibility, `RatingDial` value, and `RatingHistogram` normalization including all-zero and single-bin cases; assert the single accessible label on each
    - _Requirements: 8.6, 15.1, 17.1, 17.2_

  - [x] 3.4 Create the shared stats test-fixture builder
    - Add `apps/mobile/src/screens/stats/__testSupport__/statsFixture.ts` producing a valid nested `StatsResponse` (with overrides for ratings sufficient/insufficient, complete/partial/empty cells, percentile present/absent/unavailable, populated/empty lands/facets/`byResort`) so no test re-derives the shape
    - _Requirements: 16.1, 16.4_

- [x] 4. Mobile foundation: pure display transforms and selectors (`statsView.ts`)
  - [x] 4.1 Implement the pure display transforms
    - Add `apps/mobile/src/screens/stats/statsView.ts` with `displayedPercent` (`cell.percent.toFixed(1)`, `0.0` when `total === 0`), badge/`N to go` decision helpers (badge iff `cell.completeBadge`; "N to go" = `cell.remaining` only when `!completeBadge && total > 0`), `buildParkTiles`, `buildCategoryTiles`, `sortFacetsForDisplay`, `normalizeDistribution`, `phrasePercentile`, `shouldShowPercentile`, `ratingsView`, and `unlockRemaining`
    - _Requirements: 2.1, 5.9, 5.10, 6.1, 8.6, 9.2, 12.1, 12.2_

  - [x] 4.2 Write property test for percent display
    - **Property 2: Percent display** — every rendered percent equals `cell.percent.toFixed(1)`; a `total === 0` cell yields `0.0%`, `completed 0`, and no "N to go"
    - Tag: `Feature: stats-experience-redesign, Property 2: Percent display`
    - _Requirements: 12.1, 12.2_

  - [x] 4.3 Write property tests for badge and remaining consistency
    - **Property 3: Complete badge equivalence** — badge shown iff `cell.completeBadge === true` (⇔ `total > 0 && completed === total`)
    - **Property 4: Remaining consistency** — "N to go" equals `cell.remaining` and is shown only when `!completeBadge && total > 0`
    - Tags: `Feature: stats-experience-redesign, Property 3: Complete badge equivalence` and `Feature: stats-experience-redesign, Property 4: Remaining consistency`
    - _Requirements: 5.8, 5.9, 5.10_

  - [x] 4.4 Write property test for distribution normalization
    - **Property 6: Distribution normalization** — each bar fraction ∈ `[0,1]`, the tallest non-zero bin maps to `1`, and counts sum to `ratedCompletionsCount` when `sufficient`
    - Tag: `Feature: stats-experience-redesign, Property 6: Distribution normalization`
    - _Requirements: 8.6_

  - [x] 4.5 Write property test for ordering determinism
    - **Property 9: Ordering determinism** — park tiles follow `PARKS`, category tiles follow `EXPERIENCE_CATEGORIES`, facet order is a total order (percent desc, total desc, case-insensitive label asc)
    - Tag: `Feature: stats-experience-redesign, Property 9: Ordering determinism`
    - _Requirements: 9.2_

  - [x] 4.6 Implement the Overview-hub highlight selector
    - Add `buildOverviewHighlights`, `pickCoverageHighlight`, `pickRatingsHighlight`, `pickInterestsHighlight` to `statsView.ts`: total & deterministic; order coverage → ratings → interests(when present) → experiences; length 3 (no facets) vs 4 (facets); coverage highlight = completed park (`complete: true`, `percent: 100`) else highest-percent park by `PARKS` tiebreak; locked ratings highlight shows `ratedCompletionsCount`/3 and targets `RatingsDetail`; every highlight `target` is a real StatsStack route
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 4.7 Write property test for highlight derivation
    - **Property 11: Highlight derivation determinism & totality** — totality over any valid `StatsResponse`, determinism (equal input → equal ordered output), length 3 vs 4, fixed order, valid targets, and the completed-park ⇒ `complete/100` rule
    - Tag: `Feature: stats-experience-redesign, Property 11: Highlight derivation determinism & totality`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9_

  - [x] 4.8 Migrate `buildProgressShareParams` onto the nested shape
    - Update `buildProgressShareParams` to read from `coverage.*`, emitting `kind: 'progress'`, `overallPercent`, a full `perParkPercent` over `PARKS`, and a full `perCategoryPercent` over `EXPERIENCE_CATEGORIES`, each set to the displayed-percent of the corresponding cell (`total === 0` → `0.0`); verify `progressShareEntry.ts` predicate stays shape-agnostic
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 4.9 Write property test for share projection stability
    - **Property 8: Share projection stability** — `overallPercent`, full `perParkPercent` over all `PARKS`, full `perCategoryPercent` over all `EXPERIENCE_CATEGORIES`, each equal to its `coverage` cell's displayed-percent
    - Tag: `Feature: stats-experience-redesign, Property 8: Share projection stability`
    - _Requirements: 13.2, 13.3, 13.4, 13.5_

- [x] 5. Checkpoint — mobile foundation complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Shared section components (consumed by hub, detail screens, and friend surface)
  - [x] 6.1 Implement coverage section building blocks
    - Add `CompletionStatTile`, `CoverageStatGrid`, `LabeledCellList`, and `CoverageSection` under `apps/mobile/src/screens/stats/components/`: fixed-enum lenses render one tile per enum member (including `total === 0` in a muted `0.0%`/0 treatment, never hidden); comparison lists render `ProgressBar` ranked rows; `CompleteBadge` when `cell.completeBadge`; "N to go" from `cell.remaining` otherwise; hotels-visited `resort` tile distinct from the Resorts lens
    - Uses the task 4.1 transforms and task 3.2 primitives; accessible labels convey completion beyond color
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 6.1, 6.2, 6.3, 6.4, 12.2, 15.1, 15.3, 15.5_

  - [x] 6.2 Write component tests for coverage section building blocks
    - Cover muted zero-total tiles, ranked-bar rows, badge vs "N to go", and the Resorts-lens rows vs hotels-visited tile separation
    - _Requirements: 5.5, 5.8, 5.9, 6.1, 6.3, 6.4_

  - [x] 6.3 Implement ratings section building blocks
    - Add `RatingsSection`, `RatingDial`, `RatingHistogram` wrapper, `HighLowHeroCards`, `RatingAveragesGrid`, and `RatingsUnlockEmptyState`: rich view iff `ratings.sufficient`, otherwise the unlock/neutral state; gated fields never read when insufficient; `ratedCompletionsCount` read in both states
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 15.1_

  - [x] 6.4 Write component tests for the ratings section
    - Cover sufficient (dial + histogram + high/low + per-park/category averages) vs insufficient (unlock copy, no gated-field reads)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 6.5 Implement interests, hero, highlight, and percentile components
    - Add `InterestsSection`/`FacetCoverageTile` (ordered via `sortFacetsForDisplay`, compact empty state), `OverallHeroCard` (hero `ProgressRing`, celebratory at `overall.completeBadge`), `PercentileBanner`, and `HighlightCard` (tappable, `accessibilityRole="button"`, story+action label)
    - _Requirements: 1.1, 1.2, 1.4, 9.1, 9.2, 9.3, 10.3, 15.1, 15.2_

  - [x] 6.6 Write component tests for interests/hero/highlight/percentile
    - Cover facet ordering + empty state, hero celebratory treatment, banner shown/hidden, and highlight-card button role/label
    - _Requirements: 1.2, 9.1, 9.3, 10.3, 15.2_

- [x] 7. Detail screens (read the shared cached `['me-stats', {percentile:true}]` query)
  - [x] 7.1 Implement `CoverageDetailScreen`
    - Add `apps/mobile/src/screens/stats/CoverageDetailScreen.tsx`: reads the shared cached stats query; lens switcher `Parks · Categories · Areas · Lands · Resorts` (exactly one active, Parks default, only active lens rendered); `CoverageStatGrid` + hotels-visited resort tile + `LabeledCellList`s for lands/resort areas; the **Resorts lens** renders `coverage.byResort` as ranked `ProgressBar` rows in server order, reading only `resortId`/`label`/`cell`, with a compact empty state; adds `'resorts'` to the `focus` union; cold-cache loading→error/Retry against the shared query
    - _Requirements: 4.2, 4.3, 5.1, 5.2, 5.3, 5.6, 5.7, 5.11, 6.1, 6.2, 6.3, 6.4, 14.3, 16.4_

  - [x] 7.2 Write tests for `CoverageDetailScreen`
    - Lens switching, muted zero-total tiles, Resorts-lens ranked bars in server order + hotels-visited tile alongside + empty `byResort` state, shared-cache read with no extra fetch (P12), cold-cache loading/error/Retry
    - _Requirements: 4.3, 5.1, 5.2, 5.3, 6.1, 6.3, 6.4, 14.3_

  - [x] 7.3 Implement `RatingsDetailScreen`
    - Add `apps/mobile/src/screens/stats/RatingsDetailScreen.tsx`: reads the shared cached query, renders `RatingsSection` (rich or unlock); cold-cache loading→error/Retry
    - _Requirements: 4.2, 8.1, 8.2, 8.3, 8.4, 14.3_

  - [x] 7.4 Write tests for `RatingsDetailScreen`
    - Rich vs unlock states, no gated-field read when insufficient, shared-cache read (P12), cold-cache treatment
    - _Requirements: 8.1, 8.2, 8.3, 14.3_

  - [x] 7.5 Implement `InterestsDetailScreen`
    - Add `apps/mobile/src/screens/stats/InterestsDetailScreen.tsx`: reads the shared cached query, renders `FacetCoverageTile`s ordered for display, compact empty state; cold-cache loading→error/Retry
    - _Requirements: 4.2, 9.1, 9.2, 9.3, 14.3_

  - [x] 7.6 Write tests for `InterestsDetailScreen`
    - Facet ordering, empty state, shared-cache read (P12), cold-cache treatment
    - _Requirements: 9.1, 9.2, 9.3, 14.3_

  - [x] 7.7 Implement `ExperiencesDetailScreen`
    - Add `apps/mobile/src/screens/stats/ExperiencesDetailScreen.tsx`: wraps the unchanged shared `ExperiencesList` over `useOwnCompletionsQuery`, with its own in-pane loading and error-with-Retry that does not affect coverage/ratings
    - _Requirements: 14.5_

  - [x] 7.8 Write tests for `ExperiencesDetailScreen`
    - Scoped completions read, in-pane loading/error/Retry isolation from stats
    - _Requirements: 14.5_

- [x] 8. Overview hub — rewrite `StatsScreen`
  - [x] 8.1 Rewrite `StatsScreen` into the Overview hub
    - Rewrite `apps/mobile/src/screens/stats/StatsScreen.tsx`: issue exactly one `['me-stats', { percentile: true }]` query (`?percentile=true`); render `OverallHeroCard` + `PercentileBanner` (shown iff `percentileRank` is a number; hidden when absent/`percentileUnavailable`, which never blocks other sections) + `buildOverviewHighlights`-driven highlight/entry cards that navigate to the matching StatsStack route; wire the migrated `buildProgressShareParams` into the share button; remove the inline flat `StatsResponse`/`StatsBreakdown`, `byParkAndCategory`, and `useViewMode`/`OWN_STATS_MODES` usage; view-level loading + error-with-Retry (Retry re-issues only the stats query)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 10.1, 10.3, 10.4, 10.5, 12.1, 13.1, 14.1, 14.2, 14.4, 16.1, 16.2, 16.3, 16.4_

  - [x] 8.2 Write hub tests (`StatsScreen.hub.test.tsx`)
    - Renders hero + percentile + highlight cards; each card is a button with the expected label; pressing dispatches `navigation.navigate` to the matching route; locked ratings card shows "(N/3)" and routes to `RatingsDetail`; banner hidden when absent/unavailable; loading and error-with-Retry
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 4.1, 10.3, 10.4, 14.1, 14.2_

- [x] 9. Navigation wiring (StatsStack + RootNavigator)
  - [x] 9.1 Create `StatsStack` and wire it into the root navigator
    - Add `apps/mobile/src/navigation/StatsStack.tsx` (`createNativeStackNavigator`) with `StatsStackParamList` — `StatsOverview` (hub, initial route) + `CoverageDetail` (optional `focus` hint incl. `'resorts'`), `RatingsDetail`, `InterestsDetail`, `ExperiencesDetail` — `headerShown: false`, mirroring `CatalogStack`/`FriendsStack`
    - In `apps/mobile/src/navigation/RootNavigator.tsx`, register the Stats tab with `component={StatsStack}` (replacing the bare `StatsScreen`) and change `MainTabParamList.Stats` to `NavigatorScreenParams<StatsStackParamList> | undefined`; pass only small serializable hint params, never a `StatsResponse`
    - _Requirements: 3.1, 3.2, 3.4, 3.5_

  - [x] 9.2 Write navigation tests (`StatsStack.test.tsx`)
    - Initial route is the hub; the four detail routes register; deep-link `navigate('MainTabs', { screen: 'Stats', params: { screen: 'RatingsDetail' } })` lands on ratings detail; native back from a detail returns to the hub
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 10. Friend Profile migration
  - [x] 10.1 Migrate the friend/own stats data layer onto the nested shape
    - Update `apps/mobile/src/api/friendProfile.ts` to use the shared nested `StatsResponse` (import/re-export from `statsTypes.ts`), replacing flat `FriendStatsResponse`/`FriendStatsBreakdown`; update `fetchFriendStats` return type; friend reads request `GET /me/stats/summary?for=<id>` without `percentile`
    - Update `apps/mobile/src/hooks/useOwnStats.ts` to return the nested `StatsResponse` and refresh its doc comment
    - _Requirements: 10.2, 16.1, 16.2, 16.3_

  - [x] 10.2 Migrate `FriendProfileScreen` and `progressComparison`
    - Update `apps/mobile/src/screens/friends/FriendProfileScreen.tsx` to consume `stats.coverage.overall`/`coverage.byPark`/`coverage.byCategory` and reuse the shared coverage/ratings sections; gate on the friend's own `ratings.sufficient` with a neutral "Not enough ratings yet" message; omit the interests section and any percentile banner; collapse to a single "profile unavailable" message on `profile_forbidden`; keep independent per-read loading/error-with-Retry for profile/stats/completions
    - Update `apps/mobile/src/screens/friends/progressComparison.ts` to read `viewer.coverage.*` / `friend.coverage.*`; verify `completionDiff.ts` needs no change
    - _Requirements: 10.2, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 14.6, 14.7_

  - [x] 10.3 Write friend parity tests
    - **Property 10: Friend parity** — given identical `StatsResponse` data, the friend coverage/ratings sections render a component tree structurally identical to the Own detail screens, differences limited to the percentile banner, interests section, and unlock-vs-neutral copy
    - Tag: `Feature: stats-experience-redesign, Property 10: Friend parity`
    - Also assert neutral ratings copy, omitted interests/percentile, and `profile_forbidden` collapse
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6, 14.6_

- [x] 11. Migrate remaining fixtures/tests off the flat `byParkAndCategory` shape
  - [x] 11.1 Re-run the discovery search and migrate stats/friend/share/navigation fixtures
    - Re-run a `byParkAndCategory` / `FriendStatsResponse` search across `apps/mobile` to confirm the full set, then migrate every match to the nested `coverage` shape using the shared `statsFixture.ts` builder (task 3.4), replacing per-file inline builders
    - Covers the enumerated stats screen tests (`StatsScreen.areas/states/refetch/modes/groupSections`), friend profile tests (`FriendProfileScreen.states/refetch/modes/groupSections/comparison.states/comparison.prop`, `friendSelectionNavigation`), share/composer tests (`composerEntryPointOnly`, `shareEntryPointProjection.prop`, `comparisonDeepLink`), and the navigation integration/prop tests under `screens/navigation/__tests__`
    - Update `shareEntryPointProjection.prop.test.tsx` and `composerEntryPointOnly.test.tsx` to the nested shape and assert P8 unchanged externally
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

- [x] 12. Final checkpoint — full verification
  - Run the TypeScript typecheck for `apps/api` and `apps/mobile`, the full mobile test suite, and the `apps/api` stats test suite; ensure all pass and no reference to the removed flat `byParkAndCategory`/flat top-level fields remains. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a
  faster MVP; core implementation sub-tasks are never optional.
- Each task references specific requirement clauses (R1–R17) for traceability.
- Property-based tests use `fast-check` and are tagged
  `Feature: stats-experience-redesign, Property {n}: {text}`; backend P13 lives
  in `apps/api`, and mobile P2/P3/P4/P6/P8/P9/P11 live on the pure `statsView`
  transforms/selectors. P1, P5, P7, P12 are covered by the component/hub/detail
  tests rather than standalone property tests.
- Open decision (a) `react-native-svg` vs primitive fallback is resolved in task
  3.2; open decision (b) centralizing `ResortCoverage` in `@dwt/shared` is
  resolved in task 1.1. Both are also called out at the top of this plan.
- Pure/foundational modules (backend roll-up, mobile types, chart primitives,
  `statsView` transforms, fixture builder) precede the components, screens, and
  wiring that consume them; navigation wiring is last so nothing is orphaned.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "3.2"] },
    { "id": 1, "tasks": ["1.2", "1.3", "3.3", "3.4", "4.1"] },
    { "id": 2, "tasks": ["1.4", "1.5", "4.2", "4.3", "4.4", "4.5", "4.6", "4.8"] },
    { "id": 3, "tasks": ["1.6", "1.7", "4.7", "4.9", "6.1", "6.3", "6.5"] },
    { "id": 4, "tasks": ["6.2", "6.4", "6.6", "7.1", "7.3", "7.5", "7.7"] },
    { "id": 5, "tasks": ["7.2", "7.4", "7.6", "7.8", "8.1", "10.1"] },
    { "id": 6, "tasks": ["8.2", "9.1", "10.2"] },
    { "id": 7, "tasks": ["9.2", "10.3", "11.1"] }
  ]
}
```
