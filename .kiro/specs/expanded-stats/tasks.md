# Implementation Plan: Expanded Stats

## Overview

This plan grows the existing Stats_Service from a single overall/per-Park/per-Category
completion surface into three richer statistic groups — Coverage (Group A), Personal Rating
Statistics (Group B), and Comparative (Group C) — plus a curated subset injected into the
Progress_Share payload.

The work is almost entirely additive and reuses the existing `REPEATABLE READ READ ONLY`
snapshot transaction, the `computePercent`/`round1` primitives, and the `assertOwnerOrFriend`
gate. No new tables or migrations are required. Implementation language is **TypeScript**
(matching the existing `apps/api` service), tested with **fast-check + Vitest** to match the
existing `*.prop.test.ts` conventions.

The build order is: shared foundation → pure roll-up modules (coverage, facets, ratings,
percentile) → extended snapshot repository → route wiring and error mapping → curated share
snapshot. Pure modules are built and property-tested before the repository and routes wire
them together, so there is no orphaned code.

## Tasks

- [x] 1. Shared foundation (error codes and share payload schema)
  - [x] 1.1 Add new stats error codes to the shared error set
    - Add `stats_unavailable`, `stats_timeout`, and `stats_target_not_found` to the shared
      `ERROR_CODES` set with appropriate HTTP status mappings (500/503 for unavailable,
      504/timeout for timeout, 404 for not-found)
    - Keep mappings consistent with the existing `AppError` envelope
    - _Requirements: 7.8, 7.9, 8.6, 9.6, 11.3_

  - [x] 1.2 Extend the Progress_Share payload schema with curated fields
    - In `packages/shared/src/dto/Share.ts`, add optional `topFacet` (`{ label: string; cell: CompletionCell }`)
      and optional `percentileRank` (number) to `ProgressSharePayload` and to the
      `progressSharePayloadSchema` Zod schema
    - Export the shared `CompletionCell` type used by both the stats response and the payload
    - No DB migration (payload is schemaless JSONB in `shares.payload_snapshot`)
    - _Requirements: 10.1, 10.2, 10.3, 10.7, 10.8_

- [x] 2. Implement pure Coverage_Statistic roll-up (`services/stats/coverage.ts`)
  - [x] 2.1 Implement `CompletionCell`/`LabeledCell` types, `toCompletionCell`, and `rollUpCoverage`
    - Define `CompletionCell { completed, total, percent, remaining, completeBadge }` and a
      `toCompletionCell(completed, total)` constructor that computes `percent` via `computePercent`,
      `remaining = total - completed`, and `completeBadge = total > 0 && completed === total`,
      so every dimension derives these uniformly
    - Implement `rollUpCoverage` producing: `overall`, `byPark` (one cell per `PARKS`), `byCategory`
      (one per `EXPERIENCE_CATEGORIES`), `byAreaType` (one per `AREA_TYPES`, excluding
      resort-representing rows), `byLand` and `byResortArea` (grouped by trimmed + case-insensitive
      key, excluding null/empty/whitespace, label = first form under ascending case-insensitive
      order), and the `resort` Resort_Statistic (resort-representing rows only, reported separately
      from `byAreaType['Resort']`)
    - Enforce empty-group semantics: `total === 0 ⇒ completed 0, percent 0.0, remaining 0, completeBadge false`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.2 Write property test for coverage count invariants
    - **Property 1: Coverage counts are bounded and consistent**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.10, 2.1, 2.3**

  - [x] 2.3 Write property test for percent well-formedness
    - **Property 2: Percent is well-formed for every coverage cell**
    - **Validates: Requirements 1.11, 1.12**

  - [x] 2.4 Write property test for complete-badge and empty-group behavior
    - **Property 3: Complete_Badge and empty-group behavior**
    - **Validates: Requirements 2.4, 2.5, 1.12**

  - [x] 2.5 Write property test for Land/Resort_Area normalization
    - **Property 4: Land and Resort_Area grouping normalizes by trim + case-insensitive**
    - **Validates: Requirements 1.6, 1.7, 1.8, 1.9**

  - [x] 2.6 Write property test for Resort_Statistic independence
    - **Property 5: Resort_Statistic is independent of per-Area_Type Resort**
    - **Validates: Requirements 2.1, 2.2**

  - [x] 2.7 Write unit tests for coverage edge cases
    - Empty catalog, single-group catalog, whitespace-only Land label selection, all-inactive input
    - _Requirements: 1.8, 1.9, 1.10, 1.12_

- [x] 3. Implement pure per-Facet_Value_Key roll-up (`services/stats/facets.ts`)
  - [x] 3.1 Implement `FacetCoverage` type and `rollUpFacets`
    - Flatten every Facet_Value across all `grouped_facets` groups per experience (this set already
      includes Interest_Facets as a derived subset); key = Facet_Value `id` (exact string), display
      label = `name`
    - Per-experience dedup via a `Set<key>` so an experience counts at most once in a key's `total`
      and at most once in its `completed`
    - Group by exact key equality (case/whitespace differences are distinct keys); exclude
      experiences with no Facet_Values from every key; choose the label sorting first by ascending
      case-insensitive comparison when a key carries multiple labels
    - Skip a group whose JSONB value is not a `{id, name}[]` array (defense-in-depth)
    - Return an open-ended list, never a fixed map
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 3.2 Write property test for facet dedup
    - **Property 6: Facet coverage counts each experience at most once per key**
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.6**

  - [x] 3.3 Write property test for facet key equality and label selection
    - **Property 7: Facet_Value_Key equality is exact; display label is case-insensitively first**
    - **Validates: Requirements 3.5, 3.7, 3.8**

  - [x] 3.4 Write unit tests for facet edge cases
    - Same key appearing in both Grouped_Facets and Interest_Facets views, empty-facet experience,
      key present with multiple distinct labels
    - _Requirements: 3.4, 3.6, 3.8_

- [x] 4. Implement pure Personal Rating Statistics (`services/stats/ratingStats.ts`)
  - [x] 4.1 Implement rating statistics types and `rollUpRatings`
    - Define `MINIMUM_RATINGS_THRESHOLD = 3`, `RatingStatistics`, `RatedExperience`, and
      `RatingDistribution` types
    - Gate on the count of the Target_User's active ratings: when below threshold (including zero),
      set `sufficient = false` and omit `average`, `averageByPark`, `averageByCategory`,
      `distribution`, `highest`, `lowest`; always report `ratedCompletionsCount`
    - Compute overall/per-Park/per-Category averages in `[1.0, 10.0]` one decimal half-away-from-zero
      (`round1`), per-group entries only where the user has ≥ 1 active rating
    - Compute the 1..10 distribution (zeros included, ten counts sum to total active ratings), the
      rated-completions count, and highest/lowest selection with tie-break by ascending
      case-insensitive name then ascending experience id (same experience for both when all ratings
      share one value)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 4.2 Write property test for rating averages gating
    - **Property 8: Rating averages are gated and well-formed**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

  - [x] 4.3 Write property test for rating distribution partitioning
    - **Property 9: Rating distribution partitions the active ratings**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  - [x] 4.4 Write property test for highest/lowest deterministic selection
    - **Property 10: Highest and lowest selection is deterministic under ties**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**

  - [x] 4.5 Write unit tests for rating threshold boundary cases
    - Exactly at threshold (count === 3), one below threshold, zero ratings with non-zero rated
      completions count
    - _Requirements: 4.4, 4.6, 5.3, 6.4_

- [x] 5. Implement pure Percentile_Rank (`services/stats/percentile.ts`)
  - [x] 5.1 Add `roundHalfUpDecimal` helper to `computePercent.ts`
    - Add `roundHalfUpDecimal(value, decimals)` rounding half toward +∞, distinct from `round1`,
      used by percentile so the round-half-up rule is honored by name
    - _Requirements: 7.3_

  - [x] 5.2 Implement `computePercentileRank`
    - Compute `100 * (count of other trackers strictly less than target) / (number of other trackers
      with ≥ 1 completion)`, in `[0.0, 100.0]`, one decimal via `roundHalfUpDecimal`
    - Trackers tying the target are excluded from the numerator but retained in the denominator;
      return `0.0` when the target is the only tracker with a completion or when the target has zero
      completions; value lives only in the response (never persisted/cached)
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 5.3 Write property test for percentile rank
    - **Property 11: Percentile rank is well-formed and honors ties and edge cases**
    - **Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6**

  - [x] 5.4 Write unit tests for percentile edge cases
    - All-tied trackers, single tracker, zero completions, target strictly ahead of all
    - _Requirements: 7.4, 7.5, 7.6_

- [x] 6. Extend the snapshot repository (`services/stats/repo.ts`)
  - [x] 6.1 Extend `StatsSnapshot` and `getStatsSnapshot` to read all raw material in one transaction
    - Accept `StatsSnapshotInput { targetUserId, includePercentile }` and return a richer
      `StatsSnapshot { coverage, facetExperiences, userRatings, percentile }`
    - Inside one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` block, read: coverage
      denominators/numerators grouped by `(park, category, area_type, land, resort_area,
      is_resort_representation)` keeping raw `land`/`resort_area`; per-active-experience facet rows
      (`id`, `completedByUser`, parsed `grouped_facets`); the Target_User's active rating rows
      (`experience_id`, `name`, `value`, `park`, `category`); and — only when `includePercentile` —
      per-user active-completion totals for ranking
    - Let transaction begin/commit/abort failures propagate (route maps to `stats_unavailable`),
      returning no partial or precomputed per-user statistics
    - Do not read any per-user statistic from a cache; leave the aggregate-ratings and leaderboard
      read paths untouched
    - _Requirements: 1.2, 1.6, 1.7, 1.8, 1.9, 1.10, 3.1, 4.5, 5.4, 6.5, 7.1, 7.2, 8.1, 8.2, 8.3, 8.6_

  - [x] 6.2 Write integration test for snapshot isolation
    - Commit a concurrent completion after `BEGIN` and assert it is invisible to the in-flight
      request (numerators/denominators observe one point-in-time snapshot)
    - _Requirements: 8.1, 8.3_

  - [x] 6.3 Write integration test for the not-live cache boundary
    - Assert aggregate ratings and the highest-rated leaderboard are still served from their existing
      stores and not recomputed live
    - _Requirements: 8.4, 8.5_

- [x] 7. Checkpoint - pure modules and repository
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Wire routes, response assembly, gating, and error handling (`services/stats/routes.ts`)
  - [x] 8.1 Assemble `StatsResponse` and wire endpoints, gating, timeout, and error mapping
    - Build the superset `StatsResponse` (coverage dimensions, `ratings`, optional `percentileRank`,
      optional `percentileUnavailable`) from `coverage.ts`, `facets.ts`, `ratingStats.ts`,
      `percentile.ts`, and the extended repo, preserving existing fields for compatibility
    - Run `assertOwnerOrFriend` before any snapshot read; map non-owner/non-friend to
      `profile_forbidden` (no target data read, no analytics event) and non-existent target to
      `stats_target_not_found`
    - Gate a friend's rating statistics by the friend's own active-rating count against the threshold
      (identical structure/types to self; hidden when below, including zero-ratings)
    - Support `?percentile=true` opt-in (omit and skip computation otherwise); isolate percentile
      failure by omitting `percentileRank`, setting `percentileUnavailable: true`, and returning the
      remaining statistics; set a per-request `statement_timeout` sized to the SLA and map timeout to
      `stats_timeout` with no partial statistics; map transaction failure to `stats_unavailable`
    - _Requirements: 7.2, 7.8, 7.9, 8.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 11.1, 11.2, 11.3_

  - [x] 8.2 Write property test for friend/self structural parity
    - **Property 13: Friend and self responses are structurally identical with independent gating**
    - **Validates: Requirements 9.1, 9.4, 9.5**

  - [x] 8.3 Write integration tests for authorization and target resolution
    - Owner-or-friend allowed, non-friend denied with `profile_forbidden` and no analytics event,
      non-existent target denied with `stats_target_not_found`
    - _Requirements: 9.2, 9.3, 9.6_

  - [x] 8.4 Write integration tests for percentile opt-in and failure isolation
    - Percentile omitted when not requested (no computation), present when requested, and isolated
      failure returns `percentileUnavailable: true` with all other statistics unchanged
    - _Requirements: 7.2, 7.9_

  - [x] 8.5 Write integration tests for timeout and transaction-failure error mapping
    - Forced overrun aborts within 5s and returns `stats_timeout` with no partial data; transaction
      failure returns `stats_unavailable` with no partial or precomputed statistics
    - _Requirements: 7.8, 8.6, 11.3_

  - [x] 8.6 Write performance integration test near the R11 bounds
    - Seed up to 5,000 active experiences, a Target_User with up to 5,000 completions/ratings, and up
      to 100,000 trackers for the percentile case; assert the 2s (no percentile) and 3s (percentile)
      bounds
    - _Requirements: 11.1, 11.2_

- [x] 9. Inject curated stats into the Progress_Share (`services/sharing/repo.ts`, `services/sharing/routes.ts`)
  - [x] 9.1 Capture the curated snapshot at Progress_Share creation
    - At `progress` share creation, compute the sender's stats via the live computation and write
      `overallPercent`, `topFacet`, and `percentileRank` into the payload snapshot
    - Select `topFacet` as the facet statistic with the highest `completed`, tie-broken by highest
      `percent` then ascending case-insensitive label; include it (even when `completed` is 0)
      whenever the sender has ≥ 1 facet statistic and omit it entirely otherwise
    - Report `percentileRank` in `[0.0, 100.0]` (0.0 when sender has zero completions); exclude the
      rating distribution, per-group breakdown maps, and highest/lowest experiences; capture as a
      send-time snapshot so later sender changes do not alter the recipient's view
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [x] 9.2 Write property test for the curated share snapshot
    - **Property 12: Curated share snapshot selects the top facet and excludes verbose stats**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8**

  - [x] 9.3 Write unit/integration tests for send-time snapshot capture
    - Sender with no facet statistic omits `topFacet`; sender with facets whose top `completed` is 0
      still includes it; recipient view is unchanged after the sender's stats change post-send
    - _Requirements: 10.6, 10.7, 10.8_

- [x] 10. Final checkpoint - full verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core
  implementation tasks are never optional.
- Each task references specific requirement sub-clauses for traceability.
- Property tests use fast-check + Vitest with `{ numRuns: 100 }` and a comment tag in the format
  `Feature: expanded-stats, Property {number}: {property_text}`, matching the existing
  `aggregate/__tests__/*.prop.test.ts` conventions.
- Property tests validate the universal correctness properties over the pure roll-up layer; unit
  and integration tests cover edge cases, authorization, isolation, timeout, and the not-live cache
  boundary that property testing is not suited to.
- The feature is additive: no new tables or migrations; the Progress_Share payload change is a
  schemaless JSONB extension.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1", "4.1", "5.1", "6.1"] },
    { "id": 1, "tasks": ["5.2", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "3.2", "3.3", "3.4", "4.2", "4.3", "4.4", "4.5", "6.2", "6.3"] },
    { "id": 2, "tasks": ["5.3", "5.4", "8.1"] },
    { "id": 3, "tasks": ["8.2", "8.3", "8.4", "8.5", "8.6", "9.1"] },
    { "id": 4, "tasks": ["9.2", "9.3"] }
  ]
}
```
