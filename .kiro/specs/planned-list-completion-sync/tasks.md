# Implementation Plan: Planned List Completion Sync

## Overview

This plan implements a pure, read-time derivation layer over the shipped Trips feature: a shared
`plannedCompletion` module (the property-tested core), a small additive extension to the server-side
`deriveTripSummary` / `getSummary` for planned counts, and mobile presentation on the existing
`TripPlannedListScreen` and `TripSummaryScreen`. No migration, table, column, endpoint, or stored link is
added — every new behavior is derived by matching a `Planned_Item`'s `Experience` against the Trip's
completions (`Planned_Completion_Match`).

The work is incremental: the shared derivation is built and re-exported first so both the server summary
and the mobile screens can consume the exact same match logic, then the server counts are wired through
the existing `GET /trips/:id/summary`, then the mobile screens render the derived presentation and counts.
Property-based tests (fast-check) validate the six universal derivation/authorization properties from the
design; unit, integration, mobile, and structural tests cover examples, boundaries, external references,
and model-preservation constraints.

## Tasks

- [x] 1. Build the shared pure derivation core
  - [x] 1.1 Extend `TripSummaryDTO` with planned counts
    - In `packages/shared/src/trips.ts`, add two additive, non-negative integer fields to `TripSummaryDTO`:
      `plannedTotalCount` and `plannedCompletedCount`
    - Leave `PlannedItemDTO`, `TripFeedItemDTO`, and `TripLogEntryDTO` unchanged (they already expose
      `experienceId` and `metadata.experienceId`)
    - _Requirements: 5.1, 5.2, 5.6, 6.4_

  - [x] 1.2 Implement the pure `plannedCompletion` derivation module
    - Create `packages/shared/src/plannedCompletion.ts` (I/O-free)
    - Define types: `PlannedItemCompletionState`, `PlannedItemView`, `PlannedListProgress`,
      `PlannedListPresentation`
    - Implement `completedExperienceIdsFromFeed(feed)`: build the completed `Experience` id set from
      `completion_logged` feed items' `metadata.experienceId`; return `null` when `feed` is `null`
    - Implement `derivePlannedListPresentation(plannedItems, completedExperienceIds)`: derive each item's
      `done`/`not_done` state by set membership on `experienceId`, partition into `doneSection` /
      `notDoneSection` preserving input order and each item's Experience/Park/adder attribution, and set
      `completionAvailable = false` (all `not_done`) when `completedExperienceIds === null`
    - Implement `derivePlannedCounts(plannedItems, completedExperienceIds)`: return `plannedTotalCount`
      and `plannedCompletedCount` counting each item at most once, clamped `0 <= completed <= total`, with
      `0/0` for an empty list
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.6, 5.4, 5.5_

  - [x] 1.3 Re-export the new module from the shared barrel
    - Update `packages/shared/src/index.ts` to re-export `plannedCompletion.ts` so both API and mobile
      import one canonical derivation surface
    - _Requirements: 6.3_

  - [x] 1.4 Write property test for the completion match
    - **Property 1: A Planned_Item is done exactly when its Experience was completed in the Trip**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.7**
    - In `packages/shared/src/__tests__/plannedCompletion.prop.test.ts` using fast-check (min 100 runs);
      cover the `null`/unavailable feed case forcing all `not_done` with `completionAvailable = false`

  - [x] 1.5 Write property test for the Done/not-Done partition
    - **Property 2: The Planned_List is a total, attribution-preserving partition into Done and not-Done**
    - **Validates: Requirements 3.2, 3.3, 3.4**
    - In `packages/shared/src/__tests__/plannedCompletion.prop.test.ts`; include items with empty adder
      display names retained rather than dropped

  - [x] 1.6 Write property test for progress counting
    - **Property 4: Planned_List_Progress is a clamped completed-of-total count over distinct items**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
    - In `packages/shared/src/__tests__/plannedCompletion.prop.test.ts`; include the empty-list `0 of 0`
      case and duplicate-completion idempotence

  - [x] 1.7 Write unit and edge-case tests for the derivation module
    - In `packages/shared/src/__tests__/plannedCompletion.test.ts`: empty list; one Experience matching
      several completions counted once; a `done` item with empty adder name retained with unavailable
      attribution; the feed-unavailable (`null`) branch
    - _Requirements: 2.7, 3.4, 4.4, 5.4_

- [x] 2. Extend the server Trip_Summary with planned counts
  - [x] 2.1 Extend the pure `deriveTripSummary`
    - In `apps/api/src/services/trips/summary.ts`, add `plannedItems` to `TripSummaryInput` and
      `plannedTotalCount` / `plannedCompletedCount` to `TripSummary`
    - Compute the counts by importing and reusing `derivePlannedCounts` from `@dwt/shared` with the
      completed set built from `logEntries[*].experienceId`, so server and client match logic are the
      same function
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

  - [x] 2.2 Read `planned_items` in the `getSummary` repo assembler
    - In `apps/api/src/services/trips/repo.ts`, add `SELECT experience_id FROM planned_items WHERE
      trip_id = $1` to the existing `getSummary` `Promise.all`, map it into the extended
      `deriveTripSummary` input, and copy the two new counts onto the returned `TripSummaryDTO`
    - Surface through the existing `GET /trips/:id/summary` route with no route added (inherits
      `requireSession` + `assertTripMember`)
    - _Requirements: 5.3, 5.7, 6.4, 7.1, 7.2_

  - [x] 2.3 Write property test for the summary planned counts
    - **Property 5: The Trip_Summary planned counts faithfully derive from Planned_Items and Trip_Log_Entries**
    - **Validates: Requirements 5.1, 5.2, 5.4, 5.5, 5.6**
    - Extend `apps/api/src/services/trips/__tests__/summary.prop.test.ts` (fast-check, min 100 runs) with
      overlapping/disjoint Experience ids and duplicate log entries per Experience

  - [x] 2.4 Write property test for the no-deletion invariant
    - **Property 3: Logging a Completion never deletes or mutates a Planned_Item**
    - **Validates: Requirements 3.5, 3.6, 6.2**
    - New `apps/api/src/services/trips/__tests__/repo.plannedNoDeletion.prop.test.ts` driving the existing
      in-memory repo model: assert the Trip's `planned_items` set (and each item's Experience and adder)
      is identical before and after a generated log-completion

  - [x] 2.5 Write property test for authorization and non-disclosure
    - **Property 6: Planned-completion-sync data and actions require membership and never disclose existence**
    - **Validates: Requirements 5.7, 7.1, 7.2, 7.3, 7.4**
    - New `apps/api/src/services/trips/__tests__/plannedCompletionAuthz.prop.test.ts`: unauthenticated
      requests denied `unauthorized` before existence checks; non-member and non-existent Trip collapse to
      identical `trip_forbidden` with no data and no `Trip_Log_Entry` created; member gets only that
      Trip's data

  - [x] 2.6 Write integration tests for the extended summary and reused reads
    - New `apps/api/src/services/trips/__tests__/plannedCompletionSummary.integration.test.ts`: the
      extended `GET /trips/:id/summary` returns correct planned counts against sandbox Postgres with real
      `planned_items` and `trip_log_entries`; member-gated non-disclosing authz of `GET /summary`,
      `GET /planned-items`, `GET /feed` for a non-member and a non-existent Trip; canonical Rating read
      live (referenced, not copied) including the unavailable-Rating indication
    - _Requirements: 5.7, 6.5, 6.7, 7.2_

- [x] 3. Checkpoint - shared and server derivation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Render the derived presentation on the mobile client
  - [x] 4.1 Extend `TripPlannedListScreen` with the derived presentation
    - In `apps/mobile/src/screens/trips/TripPlannedListScreen.tsx`, additionally read
      `GET /trips/:id/feed` (sharing the `Trip_Activity` query key), then run
      `derivePlannedListPresentation(plannedItems, completedExperienceIdsFromFeed(feed))`
    - Render a `Done_Section` of `Completed_Planned_Item`s with a visually distinct completed indicator,
      showing Experience name, Park, and adder display name (with an "added by … (unavailable)"
      attribution when the adder name is missing); render `not_done` items outside the `Done_Section`
    - Render the `Planned_List_Progress` badge as `completed of total` (`0 of 0` for an empty list)
    - Render a `Planned_Item_Log_Control` on every item (done or not) that opens the existing
      `Log_Composer` (hosted in `TripFeedScreen`) pre-filled with the item's Experience, submitting the
      unchanged `POST /trips/:id/log-entries`; show it only to a Trip_Member
    - When `completionAvailable === false`, render every item `not_done` with a non-blocking "couldn't
      determine completion" indication and retry, never a `done` badge
    - Show ratings from the feed item's live `metadata.rating` (unrated indicator when absent, "rating
      unavailable" when unresolved); store no Rating copy
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 2.7, 3.1, 3.2, 3.3, 3.4, 4.1, 4.4, 6.5, 6.6, 6.7_

  - [x] 4.2 Render planned-vs-completed counts on `TripSummaryScreen`
    - In `apps/mobile/src/screens/trips/TripSummaryScreen.tsx`, render the two new `TripSummaryDTO` fields
      as a "planned: `plannedCompletedCount` of `plannedTotalCount` completed" line (`0 of 0` for an empty
      list), riding the existing `GET /trips/:id/summary` read with no new fetch
    - _Requirements: 5.4_

  - [x] 4.3 Write mobile tests for the planned list presentation
    - In `apps/mobile/src/screens/trips/__tests__/TripPlannedListScreen.test.tsx` (React Native Testing
      Library): log control present on both `done` and `not_done` items and opening the pre-filled
      composer; the visually distinct completed indicator and `Done_Section` grouping; the progress badge
      including `0 of 0`; the feed-unavailable indication with retry
    - _Requirements: 1.1, 1.2, 1.5, 2.7, 3.1, 4.1, 4.4_

  - [x] 4.4 Write mobile test for the summary planned line
    - In `apps/mobile/src/screens/trips/__tests__/TripSummaryScreen.test.tsx`: renders the
      planned-vs-completed line including the `0 of 0` empty-list case
    - _Requirements: 5.4_

- [x] 5. Model-preservation and endpoint-reuse guards
  - [x] 5.1 Write structural / smoke checks for the model constraints
    - New structural test asserting: no new migration/table/column is added; `PlannedItemDTO` carries no
      completion field (derived state lives only on the in-memory `PlannedItemView`); no stored link
      between `planned_items` and `trip_log_entries`; planned counts are exposed only on the existing
      `GET /trips/:id/summary` with no route added
    - _Requirements: 2.6, 6.1, 6.2, 6.3, 6.4_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation
  tasks are never optional.
- Each task references specific granular requirements for traceability.
- Property tests use fast-check (min 100 iterations) and each is tagged with a comment in the form
  **Feature: planned-list-completion-sync, Property {number}: {property_text}**.
- The shared `plannedCompletion` module is built first so the server summary and both mobile screens
  consume one canonical `Planned_Completion_Match`, preventing client/server drift.
- This feature adds no endpoint, migration, table, column, or stored link; all new behavior is derived at
  read time.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["1.4", "1.7", "2.1", "4.1", "4.2"] },
    { "id": 3, "tasks": ["1.5", "2.2", "2.3", "4.3", "4.4"] },
    { "id": 4, "tasks": ["1.6", "2.4", "2.5", "2.6", "5.1"] }
  ]
}
```
