# Implementation Plan: Disney Facilities Catalog Source

## Overview

This plan implements the full migration from ThemeParks.wiki to Disney's own sources
(`Disney_Sync_Gateway` + `Menu_Service`) as described in the design. It builds bottom-up: shared
types and persistence first, then the upstream client and parser, then the pure transformation cores
(classification, area, enrichment, imagery, menu, live projection), then identity bridging,
reconciliation, persistence, the sync orchestrator, read/routes, ThemeParks.wiki retirement, and
finally the app-side browsing. Each step builds on the previous ones and ends by wiring the new code
into the existing sync/read paths so nothing is left orphaned.

All code is TypeScript in the existing `apps/api` (`services/catalog/disney/`) and `apps/mobile`
packages, tested with `vitest` and `fast-check`, matching the existing `*.prop.test.ts` conventions.
Property-based tests reference the design's Correctness Properties (Properties 1–24) and run a
minimum of 100 iterations.

## Tasks

- [x] 1. Foundation: shared domain types, persistence migration, and configuration
  - [x] 1.1 Add expanded shared domain types to `@dwt/shared`
    - Add `AREA_TYPES`/`AreaType`, expand `EXPERIENCE_CATEGORIES` with `Tour`, `Recreation`, `Spa`, `Event`
    - Add `MealPeriodDTO`, `MenuDTO`, `ResortDTO`; extend `ExperienceDTO` with `areaType`, `resortId`, `latitude`, `longitude`, `accessibility`, `priceTier`, `mealPeriods`, `menus`
    - Revise `LiveDetailDTO`: add dining `status`/`partySize`/`estimatedWaitMinutes` and busyness `percentage`; drop `returnWindow`, `paidReturnWindow`, `boardingGroup`, `imageAttribution`
    - _Requirements: 5.6, 5.7, 6.8, 8.5, 9.3, 9.7, 15.4, 15.5, 15.6_

  - [x] 1.2 Create migration `0004_disney_sources.sql`
    - Create `resorts` table, then add `experiences` enrichment/area columns (`latitude`, `longitude`, `area_type`, `resort_id`, `accessibility`, `price_tier`, `meal_periods`) and make `park` nullable
    - Expand `experiences` category/area_type CHECK constraints; create `experience_menus` and `catalog_id_bridge`; add `outcome` column to `catalog_sync_runs`
    - Drop the `image_attribution` column from `experiences` (Disney-sourced imagery needs no third-party attribution)
    - _Requirements: 6.6, 6.7, 5.1, 5.3, 5.4, 5.5, 8.2, 10.2, 12.5, 14.8_

  - [x] 1.3 Extend `config.ts` for the Disney sources
    - Add `disney.syncGateway.baseUrl` (optional env `DISNEY_SYNC_GATEWAY_BASE_URL`, default `https://realtime-sync-gw.wdprapps.disney.com/park-platform-pub/`, validated as absolute URL)
    - Add required non-empty `disney.credentials.{username,password}` (`DISNEY_SYNC_GATEWAY_USERNAME`/`PASSWORD`); throw `ConfigError` naming each offending value on missing credential or malformed URL
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [x] 1.4 Write property test for config validation
    - **Property 22: Config validation halts startup and names every offending value**
    - **Validates: Requirements 13.3, 13.6, 13.5**
    - Location: `apps/api/src/__tests__/config.disney.prop.test.ts`

- [x] 2. Facility document model, Enterprise_Id, and type sets
  - [x] 2.1 Implement `disney/facilityDoc.ts`
    - Define tolerant `FacilityDocument` and `AncestorRef` shapes (only `id` required at type level)
    - Implement `parseEnterpriseId` (`{numericId};entityType={Type}`); declare `Experience_Eligible_Type` and `Non_Experience_Type` readonly sets as the single source of truth
    - _Requirements: 3.5, 3.6, 4.1_

  - [x] 2.2 Write unit tests for `parseEnterpriseId` and type sets
    - Test well-formed, malformed, and empty ids; assert eligible/non-eligible membership
    - _Requirements: 4.1_

- [x] 3. Facilities_Client (Sync Gateway + Menu_Service)
  - [x] 3.1 Implement Sync Gateway client in `disney/facilitiesClient.ts`
    - Pure `chunk(ids, 100)` helper; `listChannelDocumentIds` (`POST /_changes` with `style/filter/feed`), `bulkGetDocuments` (batched `POST /_bulk_get`, empty set sends no request), HTTP Basic from config, base-URL default
    - Surface all failures as a single `UpstreamError` (`http_status | network | invalid_response | aborted`), reusing the existing discriminator
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.2 Write property test for bulk-get batching
    - **Property 1: Bulk-get batching partitions the id set without loss**
    - **Validates: Requirements 2.3, 2.4**
    - Location: `services/catalog/disney/__tests__/facilitiesClient.prop.test.ts`

  - [x] 3.3 Write property test for untouched document retrieval
    - **Property 2: Document retrieval returns the full set untouched**
    - **Validates: Requirements 2.5**
    - Location: `services/catalog/disney/__tests__/facilitiesClient.prop.test.ts`

  - [x] 3.4 Add Menu_Service client and Public_Token acquisition to `facilitiesClient.ts`
    - Implement `getMenus(enterpriseId)` with `Authorization: Bearer <Public_Token>`; acquire a token via the anonymous `assertion`/`public` grant when none unexpired is held, cache in memory with expiry, and reuse until expiry
    - _Requirements: 1.3, 1.4, 8.1_

  - [x] 3.5 Write property test for the single typed error
    - **Property 17: The client raises exactly one typed error whose discriminator is in the closed set**
    - **Validates: Requirements 1.7, 1.8**
    - Location: `services/catalog/disney/__tests__/facilitiesClient.prop.test.ts` (fake `fetch` driven to any status/transport/abort)

  - [x] 3.6 Write property test for Public_Token acquisition
    - **Property 18: The Public_Token is obtained exactly when none unexpired is held**
    - **Validates: Requirements 1.4**
    - Location: `services/catalog/disney/__tests__/facilitiesClient.prop.test.ts` (controllable clock)

  - [x] 3.7 Write unit tests for request shapes and error mapping
    - Spy `fetch`; assert Basic/Bearer headers, `_changes` body fields, WDW facilities channel, and `network`/`aborted` mappings
    - _Requirements: 1.2, 1.3, 1.9, 1.10, 2.1, 2.2, 15.3_

- [x] 4. Facilities_Parser (multipart/related)
  - [x] 4.1 Implement `disney/multipart.ts`
    - `parseBulkGet(contentType, body)` reads the MIME boundary, JSON-parses each part, drops parts that fail to parse, and throws `UpstreamError('invalid_response')` only when no document is recovered
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 4.2 Write property test for multipart parsing
    - **Property 3: Multipart parsing recovers every well-formed part and drops only the malformed ones**
    - **Validates: Requirements 3.1, 3.3**
    - Location: `services/catalog/disney/__tests__/multipart.prop.test.ts` (generator encodes doc lists + corrupts a subset)

- [x] 5. Pure transformation cores
  - [x] 5.1 Implement `disney/classifyFacility.ts`
    - Total mapping from `Facility_Type` to `ExperienceCategory | null` per the taxonomy table; sub-classify `attraction`/`entertainment` to `Parade`/`Character_Meet` via case-insensitive keyword match on `subType` first, then `name`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

  - [x] 5.2 Write property test for classification
    - **Property 5: Classification is a total mapping over the type space with correct sub-classification**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10**
    - Location: `services/catalog/disney/__tests__/classifyFacility.prop.test.ts`

  - [x] 5.3 Implement `disney/area.ts`
    - `resolveArea(doc)` follows ancestor precedence (ThemePark/WaterPark → DisneySprings → specific Resort → resort-wide catch-all); always returns a resolution, never drops an Experience
    - _Requirements: 4.11, 4.12, 4.13, 4.14, 4.15_

  - [x] 5.4 Write property test for area resolution
    - **Property 6: Area resolution is total and follows the ancestor precedence**
    - **Validates: Requirements 4.11, 4.12, 4.13, 4.14, 4.15**
    - Location: `services/catalog/disney/__tests__/area.prop.test.ts`

  - [x] 5.5 Implement `disney/enrich.ts`
    - `extractEnrichment(doc)`: coordinates (null when either missing), `accessibility` facets (empty when none), and — only for `restaurant` — `priceRangeDining` tier and `mealPeriods`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 5.6 Write property test for enrichment extraction
    - **Property 7: Enrichment extraction maps present fields and nulls absent ones**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
    - Location: `services/catalog/disney/__tests__/enrich.prop.test.ts`

  - [x] 5.7 Implement `disney/imagery.ts`
    - `selectImageUrl(doc)`: non-empty `detailImageUrl`, else non-empty `listImageUrl`, else `null` (shared by Experiences and Resorts)
    - _Requirements: 6.5, 7.1, 7.2, 7.3_

  - [x] 5.8 Write property test for imagery selection
    - **Property 8: Imagery selection prefers detail then list then null**
    - **Validates: Requirements 6.5, 7.1, 7.2, 7.3**
    - Location: `services/catalog/disney/__tests__/imagery.prop.test.ts`

  - [x] 5.9 Implement `disney/menu.ts`
    - `projectMenus(raw)` converts raw menus to `MenuDTO[]`, preserving menu type, cuisine type, and each group's name, item names, and item price strings
    - _Requirements: 8.2_

  - [x] 5.10 Write property test for menu round-trip
    - **Property 15: Menu persistence round-trips the full menu structure**
    - **Validates: Requirements 8.2, 8.3, 8.5**
    - Location: `services/catalog/disney/__tests__/menu.prop.test.ts`

  - [x] 5.11 Implement `disney/liveProject.ts`
    - `projectLiveDetail(input, ctx)` projects Status/Dining-Status/Forecast/Schedule docs into `LiveDetailDTO`; omit absent/unparseable fields, always present `status` (`Unknown` when absent), render times in `WDW_TIME_ZONE`, exclude Lightning Lane/boarding-group/ILL fields
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 15.4, 15.5, 15.6_

  - [x] 5.12 Write property test for live projection
    - **Property 19: The live projection carries present valid fields, defaults status, and excludes out-of-scope data**
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 15.4, 15.5, 15.6**
    - Location: `services/catalog/disney/__tests__/liveProject.prop.test.ts`

- [x] 6. Checkpoint - client, parser, and pure cores
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Identity Bridge_Map
  - [x] 7.1 Implement `disney/bridge.ts`
    - `assignInternalId(enterpriseId, bridge)`: bridged id when present, else UUIDv5 over `INTERNAL_ID_NAMESPACE` (reuse existing `internalId`); `buildBridgeMap` reads ThemeParks.wiki `externalId` exactly once and persists to `catalog_id_bridge`
    - _Requirements: 6.6, 10.1, 10.2, 10.3, 10.4, 14.3_

  - [x] 7.2 Write property test for id derivation and bridging
    - **Property 11: Internal ids are a deterministic one-to-one derivation, bridged for continuity**
    - **Validates: Requirements 6.6, 10.1, 10.2, 10.3, 10.4, 10.5**
    - Location: `services/catalog/disney/__tests__/bridge.prop.test.ts`

  - [x] 7.3 Write property test for the Bridge_Map build
    - **Property 12: The Bridge_Map maps each Enterprise_Id to the prior ThemeParks-derived id**
    - **Validates: Requirements 10.2**
    - Location: `services/catalog/disney/__tests__/bridge.prop.test.ts`

- [x] 8. Reconciliation and persistence
  - [x] 8.1 Extend `reconcile.ts` for enrichment fields and Resort records
    - Carry enrichment/area fields through upserts; add a parallel Resort diff; apply insert/reactivate/upsert/no-change/soft-delete rules to both Experiences and Resorts; run descriptions through `sanitizeDescription`
    - Carry each item's Disney-provided `image_url` (from `selectImageUrl`) through the diff — where the ThemeParks.wiki design deliberately never touched `image_url`/`image_attribution` — so Catalog_Sync becomes the sole writer of `image_url`
    - _Requirements: 6.9, 6.10, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.8, 7.1, 14.9_

  - [x] 8.2 Write property test for reconciliation
    - **Property 13: Reconciliation diff rules hold for both Experiences and Resorts**
    - **Validates: Requirements 6.9, 6.10, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5**
    - Location: `services/catalog/__tests__/reconcile.prop.test.ts`

  - [x] 8.3 Write property test for description sanitization
    - **Property 14: Persisted descriptions are plain text**
    - **Validates: Requirements 11.8**
    - Location: `services/catalog/__tests__/sanitize.prop.test.ts`

  - [x] 8.4 Extend `repo.ts` for resorts, menus, enrichment, and staleness
    - Add `getResortSnapshot`, `listActiveResorts`, `getMenusFor`; extend `applyReconciliation` to write experiences + resorts + menus in one transaction; extend `listActiveExperiences` with optional `areaType` filter and enrichment fields; extend `getCacheAge` for the staleness indicator
    - Extend `applyReconciliation` to write each item's `image_url` from the diff (previously left untouched) and stop persisting `image_attribution` (column dropped), making Catalog_Sync the sole writer of `image_url`
    - _Requirements: 5.6, 5.7, 6.7, 6.8, 8.5, 11.6, 11.7, 16.3, 7.1, 14.9_

  - [x] 8.7 Write property test for image_url sole-writer via reconciliation
    - **Property 24: Catalog_Sync is the sole writer of image_url, sourced from Disney via reconciliation**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 14.8, 14.9**
    - Location: `services/catalog/__tests__/reconcile.prop.test.ts`

  - [x] 8.5 Write property test for DTO exposure
    - **Property 9: The Experience and Resort DTOs expose exactly the persisted fields**
    - **Validates: Requirements 5.6, 5.7, 6.8**
    - Location: `services/catalog/__tests__/repoDto.prop.test.ts`

  - [x] 8.6 Write integration tests for transactional apply and resort durability
    - Inject a failing statement mid-apply against a sandbox DB; assert cache is byte-for-byte pre-run and a single `BEGIN`/`COMMIT` wraps the apply; re-read a Resort through a fresh repo to assert durability
    - _Requirements: 6.7, 11.6, 11.7_

- [x] 9. Catalog_Sync orchestration (wire cores into the sync path)
  - [x] 9.1 Rewire `sync.ts` to the Disney sources
    - Enumerate the WDW facilities channel, bulk-get + parse, normalize (exclude `softDeleted` and blank-name docs), split Resort vs Experience, classify/resolve area/enrich/select imagery, best-effort per-restaurant menu fetch, assign ids via `assignInternalId`, reconcile, apply, and record the run outcome discriminator
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.3, 8.4, 12.3, 12.4, 12.5_

  - [x] 9.2 Write property test for normalization
    - **Property 4: Normalization excludes tombstones and blank-name documents**
    - **Validates: Requirements 3.4, 3.7**
    - Location: `services/catalog/disney/__tests__/normalize.prop.test.ts`

  - [x] 9.3 Write property test for Resort production
    - **Property 10: Resort production has one record per resort document and excludes resort-area**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    - Location: `services/catalog/disney/__tests__/resort.prop.test.ts`

  - [x] 9.4 Write property test for menu failure isolation
    - **Property 16: A menu failure is isolated from the catalog run**
    - **Validates: Requirements 8.4**
    - Location: `services/catalog/__tests__/sync.prop.test.ts`

  - [x] 9.5 Write property test for the sync run outcome discriminator
    - **Property 21: Every sync run records an outcome discriminator from the closed set**
    - **Validates: Requirements 12.5**
    - Location: `services/catalog/__tests__/sync.prop.test.ts`

- [x] 10. Read decision and routes
  - [x] 10.1 Extend `readDecision.ts` for staleness, 24h refresh, and 503
    - Serve fresh cache directly; refresh when cache age exceeds 24h; on failed refresh with a prior cache serve stale with the staleness indicator and leave the cache unchanged; with no prior cache yield `503 catalog_unavailable`
    - _Requirements: 12.1, 12.2, 12.4, 12.6, 12.7, 12.9_

  - [x] 10.2 Write property test for the read decision
    - **Property 20: Catalog reads serve from cache, refresh past 24h, and preserve the cache on failure**
    - **Validates: Requirements 12.1, 12.2, 12.4, 12.7, 12.9**
    - Location: `services/catalog/__tests__/readDecision.prop.test.ts`

  - [x] 10.3 Extend `routes.ts` with resorts, filters, staleness, detail, and live
    - Add `GET /resorts`; add `areaType` filter and `staleCache`/`cacheAgeHours` to `GET /catalog`; expose enrichment + menus on `GET /catalog/:id`; wire `GET /catalog/:id/live` to the Disney live projection keyed by Enterprise_Id
    - _Requirements: 5.6, 5.7, 6.8, 8.5, 9.1, 12.1, 16.3, 16.4, 16.5_

  - [x] 10.4 Write property test for catalog filtering
    - **Property 23: Catalog filtering returns only items matching the requested facets**
    - **Validates: Requirements 16.3, 16.4**
    - Location: `services/catalog/__tests__/routes.prop.test.ts`

  - [x] 10.5 Write end-to-end sync/read smoke integration test
    - Run a full Disney-sourced sync against stubbed Sync Gateway / Menu_Service through `buildServer`; assert catalog, resorts, menus, imagery, and live all source from Disney and reads serve from cache
    - _Requirements: 9.1, 12.6, 14.1_

- [x] 11. Checkpoint - end-to-end sync and read path
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Retire ThemeParks.wiki
  - [x] 12.1 Remove ThemeParks.wiki from all catalog/live paths and wire migration completeness
    - Delete `themeparks.ts` usage from sync/live/routes; define the completeness predicate (Bridge_Map built + ≥1 Disney-only sync succeeded and persisted); ensure no code path (except the one-time bridge build) contacts ThemeParks.wiki
    - _Requirements: 14.1, 14.2, 14.4, 14.5_

  - [x] 12.2 Delete the out-of-band image-sourcing job and curated overrides
    - Delete `apps/api/src/scripts/sourceImages.ts` and `apps/api/src/scripts/imageOverrides.json`; remove the `source-images` command from `apps/api/package.json`
    - _Requirements: 14.6, 14.7_

  - [x] 12.3 Write smoke tests for cadence, migration completeness, and image-pipeline retirement
    - Assert scheduler interval ≤ 24h; assert completeness flips only after bridge + first Disney-only sync, and that no ThemeParks.wiki request is issued once complete
    - Assert the image pipeline is retired: `sourceImages.ts`/`imageOverrides.json`/`source-images` command are absent, the `image_attribution` column is dropped, and no attribution field is exposed in DTOs
    - _Requirements: 12.8, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

- [x] 13. App-side area-grouped browsing (`apps/mobile`)
  - [x] 13.1 Implement area-type grouped catalog browsing
    - Group Experiences by `Area_Type` into distinct sections/tabs; group `Resort`-area Experiences under their specific Resort; add an `Area_Type` filter alongside the existing category filter; list every Resort even with no Experiences; render category/Resort placeholders for `null` `imageUrl`
    - _Requirements: 7.5, 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 13.2 Write component tests for app rendering
    - Assert area-type sections, resort grouping, image placeholders for `null` `imageUrl`, and that a Resort with no Experiences is still listed
    - _Requirements: 5.7, 7.5, 16.1, 16.2, 16.5_

- [x] 14. Final checkpoint - full suite
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements (granular sub-requirements) for traceability.
- Property tests implement the design's Correctness Properties (1–24), one property per sub-task, each running a minimum of 100 iterations and tagged `// Feature: disney-facilities-catalog-source, Property {n}: ...`.
- Presentational/infrastructural/one-time-sequencing criteria are covered by example, component, integration, and smoke tests rather than properties.
- Checkpoints ensure incremental validation at natural boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1"] },
    { "id": 1, "tasks": ["1.4", "2.2", "3.1", "4.1", "5.1", "5.3", "5.5", "5.7", "5.9", "5.11", "7.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "4.2", "5.2", "5.4", "5.6", "5.8", "5.10", "5.12", "7.2", "7.3", "8.1"] },
    { "id": 3, "tasks": ["3.5", "3.6", "3.7", "8.2", "8.3", "8.4"] },
    { "id": 4, "tasks": ["8.5", "8.6", "8.7", "9.1"] },
    { "id": 5, "tasks": ["9.2", "9.3", "9.4", "9.5", "10.1"] },
    { "id": 6, "tasks": ["10.2", "10.3"] },
    { "id": 7, "tasks": ["10.4", "10.5", "12.1"] },
    { "id": 8, "tasks": ["12.2", "13.1"] },
    { "id": 9, "tasks": ["12.3", "13.2"] }
  ]
}
```
