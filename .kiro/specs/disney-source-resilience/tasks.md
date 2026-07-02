# Implementation Plan: Disney Source Resilience

## Overview

This plan re-architects Disney data sourcing along the data-by-change-rate principle and
hardens every Disney access path. It is a refactor and extension of the shipped
`disney-facilities-catalog-source` implementation, not a green-field build, so it builds
bottom-up: shared types, persistence migration, and configuration first; then the pure
decision cores of the `Disney_Transport` (classification, backoff, rate-limiter scheduling);
then the transport itself and the `Facilities_Client` refactor that routes every Disney
request through it; then the durable `Document_Store` and the incremental `Catalog_Sync`;
then lazy menu retrieval, the infrequent cadence guard, and graceful degradation on read;
and finally the ThemeParks.wiki live path that replaces the retired Disney live modules and
is wired into `composeServices.ts`. Each step builds on the previous ones and ends by wiring
new code into an existing seam so nothing is left orphaned.

All code is TypeScript in the existing `apps/api` (`services/catalog/disney/`,
`services/catalog/`, `services/live/`) and `packages/shared` packages, tested with `vitest`
and `fast-check`, matching the existing `*.prop.test.ts` conventions. Property-based tests
implement the design's Correctness Properties (Properties 1–16), one property per sub-task,
each running a minimum of 100 iterations (`numRuns: 100`) and tagged
`// Feature: disney-source-resilience, Property {n}: ...` with a `Validates: Requirements X.Y`
annotation.

## Tasks

- [x] 1. Foundation: shared types, persistence migration, and configuration
  - [x] 1.1 Add transport-facing and live DTO types to `@dwt/shared`
    - Add `LightningLaneState` and `BoardingGroupState` interfaces and the two new optional fields (`lightningLane`, `boardingGroup`) to `LiveDetailDTO` in `packages/shared/src/dto/LiveDetail.ts`; extend `liveDetailSchema` (Zod) in lockstep with matching optional sub-schemas so the `Live_Cache` round-trip and response envelope validate them
    - Add the `SyncRunOutcome` closed set (`success | waf_block | auth_failure | network | invalid_response | aborted`) and the transport-facing type surface (`DisneyTarget`, `DisneyRequestSpec`, `DisneyResponse`, `DisneyFailureKind`, `DisneyClassification`, `BackoffConfig`, `RateLimiterConfig`, `StoredDocument`) as the single source of truth for downstream modules
    - _Requirements: 11.6, 11.7, 11.8, 12.6_

  - [x] 1.2 Create migration `0005_disney_source_resilience.sql`
    - Create `disney_documents` (`enterprise_id` PK, `body` JSONB, `deleted` BOOLEAN, `change_seq` TEXT, `updated_at`) with the `disney_documents_active_idx` index, and `disney_sync_checkpoint` (singleton `id=1` CHECK, `last_seq`, `updated_at`)
    - Add the `fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()` column to `experience_menus`; keep `catalog_sync_runs.outcome` TEXT/nullable for legacy rows
    - _Requirements: 7.1, 7.2, 7.3, 6.3, 7.5, 8.2, 8.4, 12.6_

  - [x] 1.3 Extend `config.ts` for resilience and the un-retired live path
    - Add `disney.requestBudget` (`DISNEY_MAX_RPS`, `DISNEY_MAX_CONCURRENCY`), `disney.backoff` (`DISNEY_BACKOFF_BASE_MS`, `DISNEY_BACKOFF_FACTOR`, `DISNEY_BACKOFF_MAX_RETRIES`, `DISNEY_BACKOFF_MAX_DELAY_MS`, `DISNEY_BACKOFF_MAX_TOTAL_MS`), `disney.menuFreshnessMs` (`MENU_FRESHNESS_MS`), and `disney.syncIntervalMs` (`CATALOG_SYNC_INTERVAL_MS`, default ≥ 24h) — all with sane defaults so only credentials are strictly required
    - Validate `THEMEPARKS_BASE_URL` and `DISNEY_SYNC_GATEWAY_BASE_URL` as well-formed absolute URLs and require non-empty `DISNEY_SYNC_GATEWAY_USERNAME`/`_PASSWORD`; throw `ConfigError` naming each offending value and halting startup before the API accepts a request; keep the config loader the only reader of these env values
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 1.4 Write property test for configuration fail-fast
    - **Property 16: Configuration fail-fast**
    - **Validates: Requirements 14.2, 14.5**
    - Location: `apps/api/src/__tests__/config.prop.test.ts` — generate nonempty subsets of required credentials set empty/absent and malformed Disney/ThemeParks URLs; assert `loadConfig` throws a `ConfigError` naming each offending variable and succeeds otherwise

- [x] 2. Disney_Transport pure decision cores
  - [x] 2.1 Implement `classifyDisneyResponse` in `services/catalog/disney/classify.ts`
    - Pure mapping from `{ target, status, body }` to `DisneyClassification`: 2xx ⇒ not a failure; `403`/`429` with an Akamai "Access Denied" / edge rate-limit body marker ⇒ `waf_block` (retriable); `401` or `403` without the marker ⇒ `auth_failure` (non-retriable); `5xx` ⇒ `http_status` retriable; export `DisneyFailureKind` usage from the shared types
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 2.2 Write property test for WAF vs Auth classification
    - **Property 5: WAF vs Auth classification**
    - **Validates: Requirements 4.1, 4.3, 4.5**
    - Location: `services/catalog/disney/__tests__/classify.prop.test.ts` — for any status/body, assert WAF-marked 403/429 ⇒ `waf_block` retriable, 401/non-WAF-403 ⇒ `auth_failure` non-retriable, and the WAF `kind` never equals the auth `kind`

  - [x] 2.3 Implement `computeBackoffDelay` and `parseRetryAfter` in `services/catalog/disney/backoff.ts`
    - Pure exponential growth `base * factor^(attempt-1)` capped at `maxDelayMs`, jittered within the documented band, with `Retry-After` (delta-seconds and HTTP-date forms) applied as a floor via `parseRetryAfter(headerValue, now)`; expose the cumulative-delay cap semantics against `maxTotalDelayMs`
    - _Requirements: 3.2, 3.4, 3.6_

  - [x] 2.4 Write property test for the backoff delay schedule
    - **Property 3: Backoff delay schedule**
    - **Validates: Requirements 3.2, 3.4, 3.6**
    - Location: `services/catalog/disney/__tests__/backoff.prop.test.ts` — for any attempt/config/jitter/Retry-After, assert exponential pre-jitter base capped at `maxDelayMs`, jittered value within band, delay ≥ Retry-After, and cumulative delay across a full schedule ≤ `maxTotalDelayMs`

  - [x] 2.5 Implement the rate-limiter scheduling core `nextDispatchDelay` in `services/catalog/disney/rateLimiter.ts`
    - Pure `nextDispatchDelay(state, cfg, now)` computing the delay until dispatch is allowed given current 1-second window count, in-flight count, `maxRequestsPerSecond`, and `maxConcurrency`; never rejects — always yields a (possibly zero) wait
    - _Requirements: 2.2, 2.3, 2.5, 2.6_

  - [x] 2.6 Write property test for rate-limiter pacing bounds
    - **Property 2: Rate-limiter pacing bounds**
    - **Validates: Requirements 2.2, 2.3, 2.5, 6.6, 8.3**
    - Location: `services/catalog/disney/__tests__/rateLimiter.prop.test.ts` — for any burst and limits, drive `nextDispatchDelay` to build a schedule and assert no 1-second window exceeds `maxRequestsPerSecond` and in-flight never exceeds `maxConcurrency`

- [x] 3. Rate_Limiter runtime (Redis-backed + in-process)
  - [x] 3.1 Implement `RateLimiter` in `services/catalog/disney/rateLimiter.ts`
    - Add the Redis-backed shared limiter (small Lua script keyed `disney:ratelimit:{bucket}:*` for window rate + a counter with expiry for concurrency) as the authoritative multi-process budget, and an in-process queue+semaphore limiter as the same-process fast path/fallback; `acquire(bucket)` resolves a `RateLimitLease` when capacity is available (waits, never rejects) built on the pure `nextDispatchDelay` core
    - _Requirements: 2.1, 2.4, 2.5, 2.6_

  - [x] 3.2 Write integration test for the shared budget across processes
    - Drive two limiter clients against a single Redis instance and assert their combined outbound rate for one bucket does not exceed the configured maximum (1–2 examples)
    - _Requirements: 2.4_

- [x] 4. Disney_Transport (single shared egress)
  - [x] 4.1 Implement `createDisneyTransport` and `DisneyTransportError` in `services/catalog/disney/transport.ts`
    - Single `request(spec)` operation that acquires a `Rate_Limiter` lease before every dispatch, injects the target-appropriate `User-Agent` (`Couchbase_User_Agent` for `sync_gateway`, `Web_User_Agent` for `web`) and passes through client-supplied Basic/Bearer auth, dispatches via injected `fetch`, classifies via `classifyDisneyResponse`, retries retriable failures per `computeBackoffDelay` (honoring `Retry-After` and the retry/total-delay caps), and raises exactly one `DisneyTransportError` whose `kind` is in the closed set; inject `fetch`, limiter, backoff config, `now()`, `sleep`, and jitter for testability
    - _Requirements: 1.1, 1.4, 1.5, 2.1, 3.1, 3.3, 3.5, 5.1, 5.2, 5.3, 15.2_

  - [x] 4.2 Write property test for transport dispatch discipline
    - **Property 1: Transport dispatch discipline**
    - **Validates: Requirements 1.4, 2.1, 2.6, 5.1, 5.2, 5.3, 15.2**
    - Location: `services/catalog/disney/__tests__/transport.prop.test.ts` — with injected fetch/limiter, assert every dispatch is preceded by an acquired lease and carries the target-appropriate User-Agent and auth scheme and no per-guest credential

  - [x] 4.3 Write property test for the retry loop
    - **Property 4: Retry loop honors classification and bounds**
    - **Validates: Requirements 1.5, 3.1, 3.3, 3.5, 4.2, 4.4**
    - Location: `services/catalog/disney/__tests__/transport.prop.test.ts` — for any failure outcome, assert retry iff retriable, at most `maxRetries + 1` dispatches, exactly one `DisneyTransportError` with `kind` in the closed set, and a single dispatch + immediate raise for non-retriable classifications

- [x] 5. Checkpoint - transport cores and shared egress
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Facilities_Client refactor (route all Disney HTTP through the transport)
  - [x] 6.1 Refactor `services/catalog/disney/facilitiesClient.ts` onto the transport
    - Replace every `fetch` with `transport.request(spec)`, keeping URL building/body encoding/response parsing and the Public_Token cache in the client; add the optional `since` argument to `listChannelDocumentIds` and change its return to `{ changes: ReadonlyArray<{ id: string; deleted: boolean }>; lastSeq: string }`; keep `bulkGetDocuments` batching at 100 and `getMenus` Public_Token flow, building Basic (`sync_gateway`) and Bearer (`web`) auth headers into `spec.headers` while the transport owns the `User-Agent`
    - _Requirements: 1.2, 1.3, 5.3, 6.2, 6.3, 7.3_

  - [x] 6.2 Write wiring example test for transport dispatch
    - Spy the transport and assert `Facilities_Client` reaches Disney only through `transport.request` (never a bare `fetch`), passes `since` on delta enumeration, and surfaces `lastSeq` and per-id `deleted` flags
    - _Requirements: 1.2, 1.3_

- [x] 7. Document_Store (durable local persistence)
  - [x] 7.1 Implement `services/catalog/documentStore.ts`
    - Postgres-backed `DocumentStore` with `upsertDocuments`, `markDeleted`, `getActiveDocuments`, `getCheckpoint`, `setCheckpoint`, and `applyDelta({ upserts, deletes, lastSeq })` that writes document upserts/tombstones and the new checkpoint in one transaction so they never diverge; documents keyed by `Enterprise_Id` survive restarts and re-upserts replace the prior version
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 6.3_

  - [x] 7.2 Write property test for document store reconciliation
    - **Property 9: Document store reconciliation**
    - **Validates: Requirements 7.2, 7.3, 7.4, 10.3**
    - Location: `services/catalog/__tests__/documentStore.prop.test.ts` — for any sequence of upserts/tombstones, assert re-upserting an `Enterprise_Id` leaves exactly one entry with the latest body, tombstoned ids are excluded from the active set while checkpoint continuity holds, and the upstream entity set fed to `buildUpstreamCatalog` equals the store's active documents

  - [x] 7.3 Write property test for checkpoint lifecycle
    - **Property 8: Checkpoint lifecycle**
    - **Validates: Requirements 6.3, 6.5, 7.5**
    - Location: `services/catalog/__tests__/checkpoint.prop.test.ts` — using an in-memory `DocumentStore.applyDelta` fake, assert the new checkpoint equals the enumeration `last_seq` after a successful persist and remains byte-identical when the run fails before the atomic persist

  - [x] 7.4 Write integration test for document durability
    - Persist documents, reopen the store against a sandbox DB, and assert active documents and the checkpoint survive the reopen
    - _Requirements: 7.1_

- [x] 8. Catalog_Sync (incremental, checkpoint-driven)
  - [x] 8.1 Implement `outcomeFromError` in `services/catalog/outcome.ts`
    - Total mapping from a run result or caught error to `SyncRunOutcome`: `waf_block → waf_block`, `auth_failure → auth_failure`, `network`/`invalid_response`/`aborted` pass through, any non-transport error → `invalid_response`; WAF and auth outcomes never coincide
    - _Requirements: 12.4, 12.5, 12.6_

  - [x] 8.2 Write property test for sync outcome mapping
    - **Property 15: Sync outcome mapping is total and distinct**
    - **Validates: Requirements 12.4, 12.5, 12.6**
    - Location: `services/catalog/__tests__/outcome.prop.test.ts` — for any transport error kind or arbitrary error, assert the result is in the closed set with the documented mapping and WAF ≠ auth

  - [x] 8.3 Refactor `services/catalog/sync.ts` to checkpoint-driven incremental sync
    - Read the checkpoint at run start: absent ⇒ `Bootstrap_Sync` (full enumeration, no `since`, paced within the budget); present ⇒ `Delta_Sync` (`_changes?since=<seq>`, fetch only non-deleted changed ids, apply tombstones); reconcile from `documentStore.getActiveDocuments()` (no full re-enumeration), skip all per-restaurant menu fetches, apply the reconcile diff, persist the checkpoint only on success via `applyDelta`, and record the run outcome via `outcomeFromError`, leaving checkpoint and cache unchanged on failure
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 7.4, 10.1, 10.4, 12.1_

  - [x] 8.4 Write property test for the sync-mode decision
    - **Property 6: Sync-mode decision**
    - **Validates: Requirements 6.1, 6.2**
    - Location: `services/catalog/__tests__/syncMode.prop.test.ts` — for any checkpoint state, assert an absent checkpoint drives a full enumeration with no `since` and a present checkpoint drives an enumeration whose `since` equals the stored checkpoint

  - [x] 8.5 Write property test for the delta fetch set
    - **Property 7: Delta fetch set**
    - **Validates: Requirements 6.4**
    - Location: `services/catalog/__tests__/syncMode.prop.test.ts` — for any `_changes` feed, assert the set of ids fetched via `_bulk_get` equals exactly the non-deleted changed ids and no unchanged document is fetched

- [x] 9. Lazy and throttled menu retrieval
  - [x] 9.1 Implement `services/catalog/menuRetrieval.ts` and repo freshness extension
    - Pure `decideMenuFetch(fetchedAt, now, interval)` plus the `getMenuForRestaurant(experienceId, now)` seam: serve cached menu without contacting the `Menu_Service` while within freshness; on missing/stale fetch via `Facilities_Client.getMenus` (through the transport, within the budget) and cache with a fresh `fetched_at`; on fetch failure serve any prior cached menu unchanged and record the failure without raising; extend the repo to read/write `experience_menus.fetched_at`
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

  - [x] 9.2 Write property test for lazy menu retrieval
    - **Property 10: Lazy menu retrieval**
    - **Validates: Requirements 8.2, 8.4, 8.5**
    - Location: `services/catalog/__tests__/menuRetrieval.prop.test.ts` — for any restaurant and cache state, assert fresh cache serves without a `Menu_Service` call, missing/stale fetches and caches, and a fetch failure serves the prior cached menu unchanged and records the failure without raising

  - [x] 9.3 Implement the optional background menu-refresh job
    - Iterate stale restaurants and refresh their menus through the `Disney_Transport` within the `Request_Budget`, best-effort and rate-limited by the shared limiter; a failure never fails any enclosing operation
    - _Requirements: 8.3_

  - [x] 9.4 Write integration test for background menu refresh
    - Assert the background refresh dispatches its `Menu_Service` requests through the transport and is paced by the limiter
    - _Requirements: 8.3_

- [x] 10. Infrequent static sync cadence
  - [x] 10.1 Add the configurable cadence and freshness guard
    - Make the BullMQ scheduler interval configurable (`services/catalog/scheduler.ts`) defaulting to ≥ 24h, and add a freshness guard to `runSync` so a scheduled invocation is a no-op while the most recent successful sync completed within the freshness interval; retain the on-read opportunistic refresh in `decideCatalogRead`
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 10.2 Write property test for the sync freshness guard
    - **Property 11: Sync freshness guard**
    - **Validates: Requirements 9.2**
    - Location: `services/catalog/__tests__/freshnessGuard.prop.test.ts` — for any last-successful-sync age, assert a scheduled invocation is a no-op within the freshness interval and proceeds when the age exceeds it

- [x] 11. Graceful degradation on catalog read
  - [x] 11.1 Extend `services/catalog/readDecision.ts` for degradation and staleness
    - On any `Catalog_Sync` failure (including `waf_block` and `auth_failure`) with a prior successful cache, leave the cache byte-identical and continue serving catalog reads from it with a staleness indicator conveying the cache's age; surface `catalog_unavailable` (503) only on a first-ever failure with no prior cache
    - _Requirements: 12.1, 12.2_

  - [x] 11.2 Write property test for degradation preserving cache and staleness
    - **Property 14: Catalog degradation preserves cache and conveys staleness**
    - **Validates: Requirements 12.1, 12.2**
    - Location: `services/catalog/__tests__/readDecision.prop.test.ts` (extend) — for any sync failure with a prior cache, assert cache contents are byte-identical and a subsequent read resolves from cache without error while conveying a staleness indicator and the cache's age

- [x] 12. Checkpoint - incremental sync, menus, cadence, and degradation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. ThemeParks.wiki live path (replace retired Disney live modules)
  - [x] 13.1 Implement `services/live/themeParksLiveClient.ts`
    - Wrap ThemeParks.wiki `GET /entity/{externalId}/live` carrying `status`, `queue.STANDBY`/`SINGLE_RIDER`, `queue.PAID_RETURN_TIME`/`RETURN_TIME`, `queue.BOARDING_GROUP`, `showtimes`, `operatingHours`, `forecast`, and dining fields; reuse the existing `createThemeParksClient` transport pattern and `UpstreamError`; do not use the `Disney_Transport`
    - _Requirements: 11.1, 11.2_

  - [x] 13.2 Implement the entity resolver in `services/live/resolveEntity.ts`
    - Pure `resolveThemeParksEntity` that resolves the ThemeParks.wiki entity whose `External_Id` equals the Experience's `Enterprise_Id` and resolves to none when no such entity exists, never matching on any other key
    - _Requirements: 11.2, 13.4_

  - [x] 13.3 Write property test for ThemeParks entity resolution
    - **Property 12: ThemeParks entity resolution**
    - **Validates: Requirements 11.2, 13.4**
    - Location: `services/live/__tests__/themeParksResolve.prop.test.ts` — for any Experience and dataset, assert resolution matches exactly on `External_Id == Enterprise_Id`, yields none when absent, and never matches another key

  - [x] 13.4 Implement `services/live/themeParksLiveProject.ts` (pure)
    - Total, deterministic projection into `LiveDetailDTO`: `status` mapped to `OperatingStatus` defaulting to `Unknown`; `waitMinutes`/`singleRiderWaitMinutes` from `queue.STANDBY`/`SINGLE_RIDER`; `forecast`/`showtimes`/`operatingHours` scoped to the current Park day as canonical ISO instants in the Park's local time zone; walk-up `diningAvailability`; `lightningLane` from `paidReturnWindow` and `boardingGroup` from `queue.BOARDING_GROUP` when present; omit absent/unparseable fields, never fabricate, always present `status`
    - _Requirements: 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [x] 13.5 Write property test for the live projection
    - **Property 13: Live projection totality and field mapping**
    - **Validates: Requirements 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9**
    - Location: `services/live/__tests__/themeParksLiveProject.prop.test.ts` — for any payload, assert the projection never throws, always produces a `status`, populates each field exactly when its source is present and valid (omitting otherwise), and emits every time as a canonical ISO-8601 instant with current-day scoping in the Park's time zone

  - [x] 13.6 Implement `services/live/themeParksLiveService.ts` and wire it in
    - Same resolve → cache check → fetch under deadline → project → cache → serve (stale-serve or 503) lifecycle as the retired `DisneyLiveService`, sourcing from `ThemeParksLiveClient` and never contacting a Disney source; wire it into the catalog `getLiveDetail` port in `composeServices.ts` in place of `createDisneyLiveService`, and route `Facilities_Client` through the composed `Disney_Transport` + `Rate_Limiter` at the composition root
    - _Requirements: 11.1, 11.10, 12.3, 13.1_

  - [x] 13.7 Write live-path isolation and static-path wiring example tests
    - Spies: the live path never contacts a Disney source and stays functional while Disney is blocked; the static path never contacts ThemeParks.wiki; the sync issues no menu or Disney live-channel requests; only the `Facilities_Channel` is enumerated
    - _Requirements: 10.4, 11.10, 12.3, 13.5, 15.1, 15.3_

- [x] 14. Final checkpoint - full suite
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements (granular sub-requirements) for traceability.
- Property tests implement the design's Correctness Properties (1–16), one property per sub-task, each running a minimum of 100 iterations (`numRuns: 100`) and tagged `// Feature: disney-source-resilience, Property {n}: ...`.
- Structural/wiring criteria (R1.2, R8.1, R10.4, R11.10, R12.3, R13.5, R15.1, R15.3) and external-service/durability criteria (R2.4, R7.1, R8.3) are covered by example, integration, and smoke tests rather than properties, per the design's Testing Strategy.
- The pure decision cores (`classifyDisneyResponse`, `computeBackoffDelay`, `nextDispatchDelay`, `decideMenuFetch`, freshness guard, resolver, `themeParksLiveProject`, `outcomeFromError`) are injectable so every property runs deterministically in-memory without real timers, Redis, network, or a database.
- Checkpoints ensure incremental validation at natural boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1", "2.3", "2.5", "7.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "3.1", "7.2", "7.3", "7.4"] },
    { "id": 3, "tasks": ["3.2", "4.1", "8.1"] },
    { "id": 4, "tasks": ["4.2", "6.1", "8.2"] },
    { "id": 5, "tasks": ["4.3", "6.2", "8.3"] },
    { "id": 6, "tasks": ["8.4", "9.1", "11.1"] },
    { "id": 7, "tasks": ["8.5", "9.2", "9.3", "10.1", "11.2"] },
    { "id": 8, "tasks": ["9.4", "10.2", "13.1", "13.2", "13.4"] },
    { "id": 9, "tasks": ["13.3", "13.5", "13.6"] },
    { "id": 10, "tasks": ["13.7"] }
  ]
}
```
