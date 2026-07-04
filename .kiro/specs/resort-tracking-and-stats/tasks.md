# Implementation Plan: Resort Tracking and Stats

## Overview

This plan implements the feature additively. It starts with the database
migration and the shared DTO change (the contracts everything else depends on),
then teaches Catalog_Sync to emit one resort-representing Experience per active
Resort, widens the statistics snapshot to be Park-optional with an Area_Type and
representation dimension, extends the stats response with `byAreaType` and
`resort`, and finally wires the mobile Own_Stats_View Areas pane. Property tests
(Properties 1–9 from the design) are placed next to the code they validate so
regressions surface early. All code is TypeScript, matching the existing
`apps/api` and mobile/shared packages.

## Tasks

- [x] 1. Database migration for resort-representing Experiences
  - [x] 1.1 Write migration `0009_resort_representing_experiences.sql`
    - Add nullable `represents_resort_id UUID REFERENCES resorts(id)` to `experiences`
    - Add partial UNIQUE index `experiences_represents_resort_id_uniq` on `represents_resort_id WHERE represents_resort_id IS NOT NULL`
    - Add index `experiences_active_represents_resort_idx` on `(active, represents_resort_id)`
    - Wrap in `BEGIN`/`COMMIT`; leave `completions`, `ratings`, `notes` untouched
    - _Requirements: 3.1, 3.2, 3.5_
  - [x] 1.2 Write migration test
    - Apply `0009` against a seeded DB; assert the column and both indexes exist
    - Assert existing `experiences` rows are untouched (`represents_resort_id` is NULL)
    - _Requirements: 3.5_

- [x] 2. Extend shared CompletionEntry DTO
  - [x] 2.1 Add `areaType` and make `park` nullable on `CompletionEntryDTO`
    - Edit `packages/shared/src/dto/CompletionEntry.ts`: add `readonly areaType: AreaType`, change `park` to `Park | null`
    - Reuse the existing `AREA_TYPES`/`AreaType` export; update any serializer/validator in shared
    - _Requirements: 5.2, 5.3_
  - [x] 2.2 Write unit tests for the updated DTO shape
    - Assert a resort-area / resort entry serializes with `park: null` and a valid `areaType`
    - _Requirements: 5.2_

- [x] 3. Emit resort-representing Experiences in Catalog_Sync
  - [x] 3.1 Extend Catalog_Sync types for representing rows
    - Edit `apps/api/src/services/catalog/types.ts`: add `representsResortId` (and confirm `areaType`, nullable `park`) on `UpstreamExperience`
    - _Requirements: 3.1, 3.2_
  - [x] 3.2 Emit one representing `UpstreamExperience` per active Resort
    - Edit `apps/api/src/services/catalog/sync.ts` `buildUpstreamCatalog`: for each upstream Resort emit a representing Experience with `id = internalId(enterpriseId, "resort-visit")`, `park = null`, `category = 'Other'`, `areaType = 'Resort'`, `resortId` and `representsResortId` set to the Resort's Internal_Id, name/image/description copied
    - Ensure `upstreamEntityId` stays UNIQUE in `experiences`
    - Route representing rows through the existing insert / reactivate / soft-delete reconciliation
    - _Requirements: 3.1, 3.2, 3.4, 3.5_
  - [x] 3.3 Persist and project `represents_resort_id` in the catalog repo
    - Edit `apps/api/src/services/catalog/repo.ts`: include `represents_resort_id` in the upsert and read/projection paths
    - _Requirements: 3.1, 3.2_
  - [x] 3.4 Write property test for representation uniqueness and stability
    - **Property 7: Representation uniqueness and stability**
    - **Validates: Requirements 3.2, 3.5**
  - [x] 3.5 Write unit tests for representing-row reconciliation
    - Cover emission, soft-delete on Resort inactivation (Completions preserved), and reactivation restore
    - _Requirements: 3.4, 3.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Make the statistics snapshot Park-optional with new dimensions
  - [x] 5.1 Widen `StatsCell` and the grouped snapshot queries
    - Edit `apps/api/src/services/stats/repo.ts`: add `areaType: AreaType` and `isResortRepresentation: boolean` to `StatsCell`; make `park` nullable
    - Add `area_type` and `(represents_resort_id IS NOT NULL) AS is_resort_representation` to both the denominator and numerator `SELECT`/`GROUP BY`; drop the Park-only filter
    - Keep the single-transaction `REPEATABLE READ READ ONLY` snapshot
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 2.2_
  - [x] 5.2 Update `mergeRows` to retain Park-less rows
    - Keep a row when `category ∈ EXPERIENCE_CATEGORIES` and `area_type ∈ AREA_TYPES`; no longer require a valid `park`
    - _Requirements: 1.1, 1.3, 2.2_
  - [x] 5.3 Write property test for overall totals
    - **Property 1: Overall is the total over active items**
    - **Validates: Requirements 1.1, 1.2**

- [x] 6. Extend the stats response with byAreaType and resort
  - [x] 6.1 Add `byAreaType` and `resort` to `StatsResponse` and roll them up in `buildResponse`
    - Edit `apps/api/src/services/stats/routes.ts`: add `byAreaType: { [a in AreaType]: StatsBreakdown }` and `resort: StatsBreakdown`
    - Apply per-cell roll-up: `overall` always; `byPark`/`byParkAndCategory` when `park !== null`; `byCategory` and `byAreaType` when `!isResortRepresentation`; `resort` when `isResortRepresentation`
    - Produce every breakdown through `computePercent` (rounding, `[0.0,100.0]` clamp, zero-denominator rule)
    - _Requirements: 1.3, 1.4, 2.1, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4_
  - [x] 6.2 Write property test for Park scoping
    - **Property 2: Park dimensions are Park-scoped**
    - **Validates: Requirements 1.4**
  - [x] 6.3 Write property test for Category excluding representing rows
    - **Property 3: Category excludes representing rows**
    - **Validates: Requirements 1.3, 4.4**
  - [x] 6.4 Write property test for the Area partition
    - **Property 4: Area partition**
    - **Validates: Requirements 2.1, 2.2**
  - [x] 6.5 Write property test for Resort_Statistic identity
    - **Property 5: Resort_Statistic identity**
    - **Validates: Requirements 4.1, 4.4**
  - [x] 6.6 Write property test for percent invariants
    - **Property 6: Percent invariants hold everywhere**
    - **Validates: Requirements 2.4, 4.3**
  - [x] 6.7 Write contract test for the stats endpoint shape
    - Assert `GET /me/stats` returns every `AREA_TYPES` key in `byAreaType` and a `resort` breakdown, with the zero-shape when empty
    - _Requirements: 2.1, 2.3, 4.2_

- [x] 7. Resort completion path and friend parity
  - [x] 7.1 Surface a Resort's representing `experienceId` for completion targeting
    - Ensure the Resort read/detail projection exposes the representing `experienceId` so the client can PUT/DELETE a completion against it (reuse existing per-Experience completion endpoints unchanged)
    - Confirm recording against a missing/inactive representing Experience is rejected like any missing/inactive Experience completion
    - _Requirements: 3.1, 3.3, 3.4_
  - [x] 7.2 Write property test for resort completion idempotence
    - **Property 8: Completion idempotence for resorts**
    - **Validates: Requirements 3.1, 3.2, 3.3**
  - [x] 7.3 Write property test for friend parity
    - **Property 9: Friend parity**
    - **Validates: Requirements 6.1, 6.2**

- [x] 8. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Mobile Areas pane and grouping
  - [x] 9.1 Add the `groupByAreaType` fold
    - Edit `grouping.ts`: add `groupByAreaType(entries, AREA_TYPES)` mirroring `groupByPark`, partitioning named entries by `entry.areaType`; leave `groupByPark` unchanged (Park-less entries match no Park group)
    - _Requirements: 5.2_
  - [x] 9.2 Write property test for the `groupByAreaType` fold
    - Partition completeness, stable order, and Park-less handling
    - _Requirements: 5.2_
  - [x] 9.3 Add the `Own_Areas` mode and "Areas" tab
    - Edit `OwnStatsViewMode` to add `Own_Areas`; add an "Areas" tab (e.g. `business-outline`) to `OWN_STATS_TABS` in `TabSelector.tsx`
    - _Requirements: 5.1_
  - [x] 9.4 Implement `OwnAreasPane` and mount it in `StatsScreen`
    - Render one `BreakdownCard` per `AREA_TYPES` value from `stats.byAreaType`
    - Render a collapsible Resorts Group_Section headed by `stats.resort`; body lists visited resorts (representing Completion entries), each navigating to the Resort detail view; show a zero-state message when none
    - Reuse the screen-level stats loading/error/retry gating
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 9.5 Write tests for the Areas pane rendering
    - Cover Area_Statistic + Resort_Statistic rendering, the zero Resort_Visits state, and navigation into a Resort
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each task references specific requirements (granular clauses) for traceability.
- Checkpoints ensure incremental validation at natural breaks.
- Property tests encode the design's Correctness Properties (1–9); place them beside the code they validate. Existing fast-check suites live under `services/*/__tests__/*.prop.test.ts`.
- Unit, contract, and integration tests validate specific examples and edge cases the properties do not cover.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.2"] },
    { "id": 2, "tasks": ["3.3", "5.1", "9.1"] },
    { "id": 3, "tasks": ["3.4", "3.5", "5.2", "9.2", "9.3"] },
    { "id": 4, "tasks": ["5.3", "6.1", "9.4"] },
    { "id": 5, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "7.1", "9.5"] },
    { "id": 6, "tasks": ["7.2", "7.3"] }
  ]
}
```
