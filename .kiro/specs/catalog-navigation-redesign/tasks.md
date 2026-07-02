# Implementation Plan: Catalog Navigation Redesign

## Overview

This plan implements the catalog navigation redesign as a full vertical slice in the existing
TypeScript monorepo (`packages/shared`, `apps/api`, `apps/mobile`), building directly on the completed
`disney-facilities-catalog-source` and `disney-source-resilience` work and reusing its cores unchanged.

The work proceeds bottom-up: shared DTO/schema → API persistence, Land resolution, reconcile, repo, and
routes → mobile framework-free pure cores (destinations, grouping, info tags, section state) → the
two-level mobile drill-down (Catalog_Home grid + global search, per-Destination screens) → navigation
wiring → enriched detail → accessibility. Each step builds on the previous and ends by wiring the new
code into an existing surface so there is no orphaned code.

Property-based tests are written for the pure cores. The design's component contracts describe the
universal behaviors under test; each property sub-task below names the behavior it validates and the
requirement clause it maps to. Property numbers are assigned in this plan for traceability. All test
sub-tasks are marked optional with `*`.

## Tasks

- [x] 1. Add Land to the shared Experience domain model
  - [x] 1.1 Add `land` to `ExperienceDTO` and the Zod schema
    - Add `readonly land?: string | null` to `packages/shared/src/dto/Experience.ts` following the existing enrichment convention (present only when persisted)
    - Add `land: z.string().max(200).nullable().optional()` to `packages/shared/src/schemas/Experience.ts`, mirroring the 200-character persistence cap
    - Export any updated inferred types so `apps/api` and `apps/mobile` consume the field
    - _Requirements: 3.1, 3.2, 1.7_
  - [x] 1.2 Write unit tests for the schema's `land` validation
    - Verify `null`, absent, a valid string, and a >200-char string are handled per the schema
    - _Requirements: 3.1, 3.2, 1.7_

- [x] 2. Establish Land persistence in the API
  - [x] 2.1 Create the additive Land migration `0006_experience_land.sql`
    - Wrap in `BEGIN`/`COMMIT`; `ALTER TABLE experiences ADD COLUMN land TEXT` (nullable, no default)
    - Add `experiences_land_length_chk CHECK (land IS NULL OR char_length(land) BETWEEN 1 AND 200)`
    - Add `CREATE INDEX experiences_active_land_idx ON experiences(active, land)`
    - Touch no existing row, no Internal_Id, and none of the `completions`/`ratings`/`notes` tables
    - _Requirements: 2.2, 2.3, 1.7, 11.2, 11.3_
  - [x] 2.2 Extend API-internal catalog types with `land`
    - Add `land: string | null` to `UpstreamExperience`, `CatalogCacheRow`, and `ReconcileUpsert` in `apps/api/src/services/catalog/types.ts`
    - Add `land: string | null` to the `ExperienceRow` read shape used by `repo.ts`
    - _Requirements: 2.1, 3.1_

- [x] 3. Resolve Land during Catalog_Sync
  - [x] 3.1 Implement the `resolveLand` pure core (`disney/land.ts`)
    - Signature `resolveLand(doc: FacilityDocument, area: AreaResolution): string | null`; pure, total, never throws
    - Return `null` immediately when `area.areaType` is `DisneySprings` or `Resort`
    - Otherwise scan the Ancestor_Chain for the first `type === 'land'` entry, trim its name, preserve original casing, return `null` for empty/whitespace-only, and truncate to at most 200 characters
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_
  - [x] 3.2 Write property tests for `resolveLand`
    - **Property 1: Area gating** — for any doc, when area is `DisneySprings`/`Resort` the result is `null`; ancestors are never inspected. **Validates: Requirements 1.5**
    - **Property 2: Nearest-ancestor normalization** — for park areas, the result equals the first Land_Ancestor name trimmed, original casing preserved, truncated to ≤200 chars. **Validates: Requirements 1.1, 1.2, 1.7**
    - **Property 3: Null cases** — no Land_Ancestor, or a Land_Ancestor whose name is absent/whitespace-only, yields `null`. **Validates: Requirements 1.3, 1.4**
  - [x] 3.3 Wire `resolveLand` into `toUpstreamExperience` (`sync.ts`)
    - Add `land: resolveLand(doc, area)` alongside the existing `areaType`/`park`/`resortId`/enrichment assignments, leaving area/park/resort resolution unchanged
    - _Requirements: 1.6, 1.1_

- [x] 4. Reconcile Land with the existing cache discipline
  - [x] 4.1 Carry Land through reconcile (`reconcile.ts`)
    - Add `land: entity.land` to `toExperienceUpsert` for inserts, reactivations, and upserts
    - Add a `cached.land !== entity.land` clause to `hasExperienceMaterialChange`
    - _Requirements: 2.4, 2.5, 2.6, 2.7_
  - [x] 4.2 Write property tests for Land reconciliation
    - **Property 4: Drift triggers upsert / equality is a no-op** — a differing Land upserts to the resolved value; an equal Land leaves the row unchanged. **Validates: Requirements 2.4, 2.5**
    - **Property 5: Idempotence** — two or more consecutive syncs over unchanged documents leave the same persisted Land. **Validates: Requirements 2.6**
    - **Property 6: Soft-delete/reactivate retention** — soft-delete then reactivate preserves Land and the Internal_Id. **Validates: Requirements 2.7**

- [x] 5. Expose and filter Land in the repository
  - [x] 5.1 Add Land to reads and the Land filter (`repo.ts`)
    - Add `land` to the `SELECT` column list and to `rowToDto` (emit only when non-null)
    - Add optional `land?: string` to `CatalogListFilters`; when present append a case-sensitive exact `land = $n` predicate that combines conjunctively with all existing filters
    - _Requirements: 3.1, 3.2, 3.4, 3.7, 3.8_
  - [x] 5.2 Implement `listDestinationCounts` (`repo.ts`)
    - One grouped query returning all eight `DestinationCount` entries: seven park Destinations counted by `park`; the aggregate `Resorts` Destination counting every active `Resort`-area Experience; zero-count Destinations return `0`
    - _Requirements: 3.6, 4.5, 4.6_
  - [x] 5.3 Write property/unit tests for the Land filter and destination counts
    - **Property 7: Case-sensitive conjunctive filter** — results are exactly the active Experiences whose Land equals the filter value (case-sensitive) and that satisfy every other supplied parameter; a non-matching value yields an empty list. **Validates: Requirements 3.4, 3.7, 3.8**
    - **Property 8: Destination counts** — counts sum active Experiences per Destination with the Resorts aggregate, always returning all eight entries including zeros. **Validates: Requirements 3.6, 4.5, 4.6**

- [x] 6. Serve Land and destination counts through the routes
  - [x] 6.1 Add the Land query param and detail field (`routes.ts`)
    - Add `land: z.string().min(1).max(200).optional()` to `catalogQuerySchema` and map it to `filters.land` in `parseListQuery`; keep `parkId`/`category`/`areaType`/`q` behavior unchanged
    - Add `land?: string | null` to `ExperienceDetailResponse` and carry it through `toDetailResponse`
    - _Requirements: 3.3, 3.4, 3.5_
  - [x] 6.2 Add the `GET /catalog/destinations` endpoint (`routes.ts`)
    - Call `decideRead()` first, then return `{ destinations, staleCache, cacheAgeHours }`; propagate `catalog_unavailable` with no prior cache and flag a stale cache; register only when the repo port is wired (existing optional-port pattern)
    - _Requirements: 3.6, 10.1, 10.2_
  - [x] 6.3 Write route tests for the Land param, detail field, and destinations endpoint
    - Cover Land filtering, combined filters, detail `land`, the eight-entry destinations payload, and stale/unavailable propagation
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 10.1, 10.2_

- [x] 7. Checkpoint - API
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Build the mobile framework-free pure cores
  - [x] 8.1 Implement the Destination model and ordering (`screens/catalog/destinations.ts`)
    - Define `DestinationId`, `DestinationKind`, `Destination`, the canonical eight-Destination `DESTINATIONS` grid order (four theme parks → two water parks → Disney Springs → Resorts), and `destinationCatalogFilter(d)` returning `{ parkId }` or `{ areaType: 'Resort' }`
    - _Requirements: 4.1, 6.1, 7.1, 8.1_
  - [x] 8.2 Write property tests for destination ordering and filters
    - **Property 9: Canonical grid order** — `DESTINATIONS` always lists the eight Destinations in the fixed order, and `destinationCatalogFilter` maps each Destination to the correct catalog filter. **Validates: Requirements 4.1, 6.1, 7.1, 8.1**
  - [x] 8.3 Implement the grouping cores (`screens/catalog/catalogGrouping.ts`)
    - `groupByLand`: named Land sections in case-insensitive ascending order, items in case-insensitive ascending order by name, a single `LAND_CATCHALL_KEY` section appended last, total partition (no Experience omitted)
    - `groupByLandFiltered`: null category returns the full grouping; a category keeps grouping/ordering and omits emptied Land sections
    - `groupByCategory`: canonical Experience_Category order, omitting empty categories
    - `buildResortRows`: every active Resort as an anchor ordered case-insensitively (including empty resorts), each followed by its `resortId`-matched Experiences, then a single catch-all group last, total partition
    - _Requirements: 6.2, 6.3, 6.6, 6.7, 6.8, 6.9, 7.2, 7.5, 8.2, 8.3, 8.4_
  - [x] 8.4 Write property tests for the grouping cores
    - **Property 10: Land grouping totality and ordering** — sections are sorted case-insensitively, items sorted within, catch-all last, and the union of all items equals the input. **Validates: Requirements 6.2, 6.3, 6.6**
    - **Property 11: Category-filtered grouping** — null returns the unfiltered grouping; a category preserves order and drops emptied sections. **Validates: Requirements 6.7, 6.8, 6.9**
    - **Property 12: Category grouping order** — Disney Springs groups follow canonical category order with empties omitted. **Validates: Requirements 7.2, 7.5**
    - **Property 13: Resort rows totality** — anchors cover every active Resort in case-insensitive order, each Experience appears exactly once under its resort or the single trailing catch-all. **Validates: Requirements 8.2, 8.3, 8.4**
  - [x] 8.5 Implement the Info_Tag core (`screens/catalog/infoTags.ts`)
    - `buildInfoTags(experience, resortName)`: emit a tag only when its value is present/non-empty, in the fixed order Land → price tier → accessibility (one per tag, persisted order) → coordinates (only when both lat/long present) → meal period (one per period) → resort (only for `Resort` area with a referenced resort); each tag carries an `accessibilityLabel`
    - `priceTierListTag(priceTier)`: the compact list-row price tag with identical label/value to the detail tag
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.11, 12.5_
  - [x] 8.6 Write property tests for the Info_Tag core
    - **Property 14: Tag ordering and omission** — present tags always appear in the fixed relative order and absent/empty values produce no tag. **Validates: Requirements 9.8, 9.11**
    - **Property 15: List/detail price parity** — `priceTierListTag` and the detail price-tier tag produce identical label text and value. **Validates: Requirements 9.9**
  - [x] 8.7 Implement the default-expanded section hook and card-label helper
    - `useDestinationSections(keys)`: wrap the existing pure `toggle`/`isExpanded` reducer, seeding the initial expanded set with all provided keys so the first render is fully expanded; keep the proven reducer untouched
    - `destinationCardLabel(name, count)`: pure helper producing `"{name}, {count} experiences"` with a numeric count
    - _Requirements: 6.4, 6.5, 7.3, 7.4, 12.1_
  - [x] 8.8 Write tests for the section hook and card-label helper
    - **Property 16: Default-expanded seeding and toggle** — every provided key starts expanded and each toggle flips exactly that key's state. **Validates: Requirements 6.4, 6.5**
    - Unit-test `destinationCardLabel` for the numeric-count label format. _Requirements: 12.1_

- [x] 9. Rewrite Catalog_Home (`screens/catalog/CatalogScreen.tsx`)
  - [x] 9.1 Implement the Destination grid
    - Render the eight Destination cards in `DESTINATIONS` order with a representative image (bundled placeholder when none), name, and active count from `GET /catalog/destinations`; show a loading state while first-loading with no prior data; navigate to `DestinationScreen` on card tap; show stale-cache indicator and full-screen `catalog_unavailable` per the existing conventions
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 10.1, 10.2, 10.3, 10.6_
  - [x] 9.2 Implement global search
    - Always-visible search control; debounce ≥300 ms; when the query has ≥1 non-whitespace char, drive `GET /catalog?q=...` across all Area_Types and replace the grid with a flat tappable result list showing each result's Destination and (when present) Land; navigate to `ExperienceDetail` on selection; restore the grid when cleared; show empty-results and search-error states that retain the query; show the Restaurant list-row price tag via `priceTierListTag`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 9.9, 10.7_
  - [x] 9.3 Write component tests for Catalog_Home
    - Cover grid ordering/counts/loading, search debounce/results/empty/error/clear, and navigation
    - _Requirements: 4.1, 4.4, 4.7, 5.2, 5.3, 5.5, 5.6, 5.7_

- [x] 10. Build the Destination_Screen (`screens/catalog/DestinationScreen.tsx`)
  - [x] 10.1 Implement the base screen and data fetch
    - New screen parameterized by `DestinationId`; fetch the Destination's Experiences via `GET /catalog` with `destinationCatalogFilter`; wire `useDestinationSections`, stale-banner, `catalog_unavailable`, and empty-state conventions; render Experience rows that navigate to `ExperienceDetail` and show the Restaurant price tag via `priceTierListTag`
    - _Requirements: 6.1, 6.10, 7.1, 8.1, 8.5, 9.9, 10.1, 10.2, 10.3, 10.7_
  - [x] 10.2 Implement the theme/water-park layout
    - Render `groupByLand` collapsible sections (default expanded), the Land_Catchall section last, and a scoped Experience_Category `Chip` filter (default no category) driving `groupByLandFiltered` client-side over already-fetched data
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
  - [x] 10.3 Implement the Disney Springs layout
    - Render `groupByCategory` collapsible sections in canonical order, omitting empty categories, with an empty state when the Destination has no active Experiences
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.7_
  - [x] 10.4 Implement the Resorts layout
    - Also fetch `GET /resorts`; render `buildResortRows`: Resort anchors ordered case-insensitively, matched Experiences under each resort, a trailing catch-all group, an empty-group indication for resorts with no Experiences, and scroll-to-group on anchor tap while staying on the screen
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 10.5_
  - [x] 10.5 Write component tests for the three Destination_Screen layouts
    - Cover Land grouping + category filter, Disney Springs category grouping/empty state, Resorts anchors/catch-all/scroll/empty group, and default-expanded sections
    - _Requirements: 6.2, 6.4, 6.8, 6.9, 7.2, 7.5, 7.7, 8.3, 8.4, 8.6, 8.7_

- [x] 11. Wire the redesigned navigation
  - [x] 11.1 Register `DestinationScreen` in the Catalog stack (`navigation/CatalogStack.tsx`)
    - Add `DestinationScreen` and its `DestinationId` param to the stack param list; keep `ExperienceDetail` on the root stack; move focus to the Destination_Screen primary heading on entry and restore focus to the activating Destination card on back
    - _Requirements: 4.8, 6.10, 12.6, 12.7_

- [x] 12. Enrich the Experience detail view (`screens/catalog/ExperienceDetailScreen.tsx`)
  - [x] 12.1 Render Info_Tags
    - Render `buildInfoTags(...)` as a wrapping badge row beneath the existing Park/category badges (resort name from the Resorts list or a `GET /resorts` lookup; omit when unavailable); keep the existing Park presentation, description, dining menus, live section, completion, rating, and note sections unchanged; render soft-deleted Experiences reachable via user data
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.10, 9.11, 10.8_
  - [x] 12.2 Write component tests for the enriched detail
    - Cover tag presence/ordering, omission of absent values, and unchanged existing sections
    - _Requirements: 9.8, 9.10, 9.11_

- [x] 13. Checkpoint - Mobile screens
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Apply accessibility across the redesigned navigation
  - [x] 14.1 Wire accessibility affordances into the screens
    - Destination cards: `accessibilityLabel` from `destinationCardLabel`; section headers: `accessibilityState={{ expanded }}`; category `Chip`s: labels with name + selected state; search input: search `accessibilityLabel`; Info_Tags: their `accessibilityLabel`; announce the updated visible-Experience count within 1 second on filter/search change (same effect that recomputes visible sections)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.8_
  - [x] 14.2 Write accessibility tests
    - Assert card labels, section expanded/collapsed state, chip labels/state, search label, Info_Tag alternatives, and result-count announcement
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.8_

- [x] 15. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each task references specific requirement sub-clauses for traceability.
- Property numbers are assigned in this plan (the design describes these universal behaviors on the pure cores); each property sub-task names the behavior it validates and its requirement clauses.
- Property tests target the framework-free pure cores (`resolveLand`, reconcile predicate, repo filter/counts, grouping cores, Info_Tag core, section hook) so they run without rendering; component tests cover the screens.
- Checkpoints ensure incremental validation at the API boundary, after the mobile screens, and at the end.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "8.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.1", "8.2", "8.3", "8.5", "8.7"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.1", "5.1", "8.4", "8.6", "8.8", "12.1"] },
    { "id": 3, "tasks": ["4.2", "5.2", "6.1", "12.2"] },
    { "id": 4, "tasks": ["5.3", "6.2"] },
    { "id": 5, "tasks": ["6.3", "9.1", "10.1"] },
    { "id": 6, "tasks": ["9.2", "10.2"] },
    { "id": 7, "tasks": ["10.3", "11.1"] },
    { "id": 8, "tasks": ["10.4"] },
    { "id": 9, "tasks": ["14.1"] },
    { "id": 10, "tasks": ["9.3", "10.5", "14.2"] }
  ]
}
```
