# Implementation Plan: Experience Facet Enrichment

## Overview

Mine the already-synced Disney `Facility_Document` fields (`facets`, `whyThis`,
`subType`) that are currently discarded, and carry six new enrichment values
(Grouped_Facets, Height_Requirement, Physical_Considerations, Interest_Facets,
Why_This, Facility_SubType) through the existing full-stack path: facet
normalization → enrichment extractor → carry-through types → reconcile →
persistence → repo projection → shared DTO + Zod schema → detail route → mobile
detail screen.

The plan builds bottom-up along the pipeline so each step compiles against the
previous one, ending with the mobile screen wired to real data. Each pure core
is validated by property-based tests (13 correctness properties from the
design), with example and integration tests covering persistence, routing, and
rendering wiring. Implementation language is TypeScript, matching the existing
`disney-app` monorepo.

## Tasks

- [x] 1. Add the shared Facet value model
  - [x] 1.1 Create `packages/shared/src/dto/Facet.ts` and export from the DTO barrel
    - Define `FacetValueDTO` (`{ id: string; name: string }`)
    - Define `GroupedFacetsDTO` (`Readonly<Record<string, readonly FacetValueDTO[]>>`)
    - Define `HeightRequirementDTO` (`{ id, name, minInches: number|null, minCentimeters: number|null }`)
    - Define `WhyThisDTO` (`{ title: string|null, bullets: readonly string[], quotes: readonly string[] }`)
    - Re-export the new types from `packages/shared/src/dto/index.ts`
    - _Requirements: 9.1_

- [x] 2. Extend Facet_Normalization in `disney/facilityDoc.ts`
  - [x] 2.1 Build the Grouped_Facets structure and carry through `whyThis`/`subType`
    - Declare `PERSISTED_FACET_GROUPS` set and `INTEREST_FACET_GROUPS` array as the single source of truth
    - Add tolerant optional `whyThis` and `groupedFacets` fields to `FacilityDocument`
    - Implement `buildGroupedFacets(rawFacets)`: keep only Persisted_Facet_Groups, preserve `id`+`name` and appearance order, skip entries missing `group`/`id`/`name` or with non-string values
    - Extend `buildFacets` to emit the grouped map in its existing single pass while leaving the flat `accessibility`/`priceRangeDining`/`interests` outputs byte-for-byte unchanged
    - In `adaptFacilityDocument`, attach `groupedFacets` when raw `facets` is an array and carry `whyThis`/`subType` through untouched
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 2.2 Write property test for facet retention
    - New file `apps/api/src/services/catalog/disney/__tests__/facetNormalization.prop.test.ts`
    - **Property 1: Facet_Normalization retains persisted groups faithfully**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

  - [x] 2.3 Write property test for preserved flat outputs
    - Extend `facetNormalization.prop.test.ts`
    - **Property 2: Facet_Normalization preserves the existing flat outputs**
    - **Validates: Requirements 1.6**

- [x] 3. Extend the Enrichment_Extractor in `disney/enrich.ts`
  - [x] 3.1 Implement the enrichment extraction helpers
    - Extend the `Enrichment` interface with `groupedFacets`, `heightRequirement`, `physicalConsiderations`, `interestFacets`, `whyThis`, `subType`
    - Implement `extractGroupedFacets`, `extractHeightRequirement` (first `height` value or null), `parseHeightMinimum` (pure unit-aware parser, inches vs cm, null when unparseable, no conversion)
    - Implement `extractPhysicalConsiderations`, `extractInterestFacets`, `extractWhyThis`, `extractSubType` (trimmed non-empty or null)
    - Implement shared `deriveFacetViews(grouped)` returning `{ physicalConsiderations, interestFacets }` so the grouping rules live in one place (reused by the repo projection)
    - Keep every helper pure, total, and deterministic
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2_

  - [x] 3.2 Write property test for height requirement selection
    - Extend `apps/api/src/services/catalog/disney/__tests__/enrich.prop.test.ts`
    - **Property 3: Height_Requirement selection and absence**
    - **Validates: Requirements 2.1, 2.5**

  - [x] 3.3 Write property test for height minimum parsing
    - Extend `enrich.prop.test.ts`
    - **Property 4: Height minimum parsing derives the encoded unit only**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [x] 3.4 Write property test for facet-view extraction
    - Extend `enrich.prop.test.ts`
    - **Property 5: Facet-view extraction preserves order, omits empties**
    - **Validates: Requirements 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4**

  - [x] 3.5 Write property test for Why_This normalization
    - Extend `enrich.prop.test.ts`
    - **Property 6: Why_This normalization maps present fields and nulls/empties absent ones**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  - [x] 3.6 Write property test for Facility_SubType extraction
    - Extend `enrich.prop.test.ts`
    - **Property 7: Facility_SubType is the non-empty trimmed value or null**
    - **Validates: Requirements 6.1, 6.2**

- [x] 4. Checkpoint - Ensure all pure-core tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add the shared DTO fields and schema validators
  - [x] 5.1 Extend `ExperienceDTO` with the six optional enrichment fields
    - In `packages/shared/src/dto/Experience.ts` add optional `heightRequirement`, `groupedFacets`, `physicalConsiderations`, `interestFacets`, `whyThis`, `subType`
    - _Requirements: 9.1_

  - [x] 5.2 Extend `experienceSchema` with matching optional validators
    - In `packages/shared/src/schemas/Experience.ts` add `facetValueSchema`, `groupedFacetsSchema`, and the six optional (nullable where applicable) validators, keeping `.strict()`
    - _Requirements: 9.2, 9.3, 9.4_

  - [x] 5.3 Write property test for the Experience schema
    - New file `packages/shared/src/schemas/__tests__/Experience.prop.test.ts`
    - **Property 9: Experience schema accepts valid payloads and rejects malformed ones**
    - **Validates: Requirements 9.2, 9.3, 9.4**

- [x] 6. Thread the persisted fields through carry-through types and reconcile
  - [x] 6.1 Extend `UpstreamExperience` and `ReconcileUpsert` in `catalog/types.ts`
    - Add `groupedFacets`, `heightRequirement`, `whyThis`, `subType` (the four persisted values only)
    - Deliberately leave `CatalogCacheRow` unchanged so the new fields never enter the diff
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 12.1_

  - [x] 6.2 Copy the new fields through `toExperienceUpsert` in `catalog/reconcile.ts`
    - Copy the four new fields straight from `UpstreamExperience`, mirroring `latitude`/`accessibility`
    - Leave `hasExperienceMaterialChange` unchanged so a change confined to a new field is not a drift signal
    - _Requirements: 12.1, 12.2_

  - [x] 6.3 Write property test for upsert carry-through
    - Extend `apps/api/src/services/catalog/__tests__/reconcile.prop.test.ts`
    - **Property 12: Upsert carries the new enrichment fields through unchanged**
    - **Validates: Requirements 12.1**

  - [x] 6.4 Write property test for non-drift behavior
    - Extend `reconcile.prop.test.ts`
    - **Property 13: New enrichment fields are not a drift signal**
    - **Validates: Requirements 12.2**

- [x] 7. Persist and project the new enrichment fields
  - [x] 7.1 Create additive migration `0008_experience_facet_enrichment.sql`
    - Add `grouped_facets JSONB NOT NULL DEFAULT '{}'`, nullable `height_requirement JSONB`, `why_this JSONB`, `sub_type TEXT`
    - Add the `sub_type` length CHECK constraint; keep the migration strictly additive (no change to existing columns/tables)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 7.2 Extend `catalog/repo.ts` persistence and projection
    - Add `grouped_facets`, `height_requirement`, `why_this`, `sub_type` to `ExperienceRow`
    - Extend `applyReconciliation`'s Experience `INSERT ... ON CONFLICT` column list, `VALUES` (`$n::jsonb` for JSONB), and `DO UPDATE SET`, following the `meal_periods` pattern within the existing single transaction
    - Add the four columns to the `listActiveExperiences` and `getExperience` SELECTs
    - Extend `rowToDto` to project each field present-only-when-persisted and derive the two views from `grouped_facets` via `deriveFacetViews`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 12.3, 12.4, 13.1, 13.2_

  - [x] 7.3 Write property test for the read projection
    - Extend `apps/api/src/services/catalog/__tests__/repoDto.prop.test.ts`
    - **Property 8: Read projection includes persisted enrichment and omits the rest**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

  - [x] 7.4 Write integration tests for the persistence round-trip
    - Extend `apps/api/src/services/catalog/__tests__/repo.apply.integration.test.ts`
    - Apply a reconciliation carrying grouped facets/height/why-this/subType and read back equal (R7.1–R7.4); apply with absent fields and assert null/empty columns (R7.5); assert existing columns and Internal_Id unchanged (R7.6); soft-delete a row and assert enrichment preserved (R12.3)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 12.3_

- [x] 8. Return the new fields on the detail route
  - [x] 8.1 Extend `ExperienceDetailResponse` and `toDetailResponse` in `catalog/routes.ts`
    - Add the six optional fields to the response interface; confirm `toDetailResponse` spreads them through present-only-when-persisted, leaving existing fields and the `/live` handler untouched
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 8.2 Write property test for detail-response pass-through
    - Extend `apps/api/src/services/catalog/__tests__/routes.prop.test.ts`
    - **Property 10: Detail response passes new fields through by persistence**
    - **Validates: Requirements 10.1, 10.2**

  - [x] 8.3 Write example test for unchanged detail/live behavior
    - Extend `apps/api/src/services/catalog/__tests__/routes.test.ts`
    - Assert existing detail-response fields are unchanged and `GET /catalog/:experienceId/live` behavior is unaffected
    - _Requirements: 10.3_

- [x] 9. Checkpoint - Ensure API and shared tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Surface the new fields on the mobile Experience_Detail_Screen
  - [x] 10.1 Extend `apps/mobile/src/screens/catalog/infoTags.ts`
    - Add the six fields to the screen's local `ExperienceDetailDTO` wire type
    - Extend `buildInfoTags` to emit a height tag (`Height requirement: <name>`), one advisory tag per Physical_Consideration (`Advisory: <name>`), and one interest tag per Interest_Facet value (`Interest: <name>`), each omitted when absent, each with a non-empty `accessibilityLabel`, preserving fixed tag ordering
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6_

  - [x] 10.2 Render the Why_This section in `ExperienceDetailScreen.tsx`
    - Add a "Why visit" `Card`/section rendering `whyThis.bullets` as flavor text when non-empty, omitted entirely when there are no bullets, with an accessible section header label
    - Wire the new DTO fields into the screen render
    - _Requirements: 11.4, 11.5, 11.6_

  - [x] 10.3 Write property test for Info_Tags
    - Extend `apps/mobile/src/screens/catalog/__tests__/infoTags.prop.test.ts`
    - **Property 11: Info_Tags surface each enrichment value with an accessible label**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.5, 11.6**

  - [x] 10.4 Write screen render example test for Why_This
    - Add a render test for `ExperienceDetailScreen.tsx`
    - Assert the Why_This bullets render when present and the section is omitted when absent
    - _Requirements: 11.4, 11.5_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirements for traceability.
- Property tests cover the 13 universal correctness properties from the design; each property is its own sub-task annotated with its property number and the requirements it validates.
- Persistence (migration + SQL wiring) and the mobile Why_This render are validated by integration and example tests rather than property tests, per the design's Testing Strategy.
- All property tests use the existing `fast-check` + `vitest` setup with `{ numRuns: 100 }` and the `// Feature: experience-facet-enrichment, Property N: ...` tag convention.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "7.1"] },
    { "id": 1, "tasks": ["2.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "5.2", "8.1", "10.1"] },
    { "id": 3, "tasks": ["2.3", "3.2", "5.3", "6.1", "8.2", "8.3", "10.2", "10.3"] },
    { "id": 4, "tasks": ["3.3", "6.2", "7.2", "10.4"] },
    { "id": 5, "tasks": ["3.4", "6.3", "7.3", "7.4"] },
    { "id": 6, "tasks": ["3.5", "6.4"] },
    { "id": 7, "tasks": ["3.6"] }
  ]
}
```
