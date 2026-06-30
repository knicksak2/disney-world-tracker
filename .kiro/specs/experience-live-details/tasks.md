# Implementation Plan: Experience Live Details

## Overview

This plan builds the live operational layer for the Experience detail view incrementally, from the
inside out: shared types and the new error code first, then the pure cores (upstream client,
park-time helpers, projection), then the cache, repo, and orchestrator, then the route wiring, and
finally the App-side gating, view helpers, components, and screen integration. Each step builds on
prior steps and ends with everything wired together — the route is registered in `composeServices`
and the live section is rendered in `ExperienceDetailScreen`.

The bulk of the correctness risk lives in three pure cores (`projectLiveDetail`, the orchestration
decision, and the view/gating helpers), so property-based tests cluster around those modules. All
code is TypeScript, using the project's existing `vitest` + `fast-check` setup.

## Tasks

- [x] 1. Add shared domain types and the live_unavailable error code
  - [x] 1.1 Add Live_Detail DTO types and Zod schema to `@dwt/shared`
    - Add `OperatingStatus`, `ReturnWindowState`, `BoardingGroupAllocation` unions and the
      `ReturnWindow`, `PaidReturnWindow`, `BoardingGroupStatus`, `ForecastEntry`, `Showtime`,
      `OperatingHours`, `DiningAvailabilityEntry`, `LiveDetailDTO`, and `LiveDetailResponseDTO`
      interfaces in a new `dto` module, exported from `packages/shared/src/index.ts`
    - Add a Zod schema validating the projected `LiveDetailDTO` shape (status always present;
      `showtimes`, `operatingHours`, `diningAvailability` always arrays; optionals absent or valid)
    - _Requirements: 1.2, 1.10, 1.14, 1.17, 1.21, 1.22, 2.5_

  - [x] 1.2 Add `live_unavailable` error code mapped to HTTP 503
    - Add `live_unavailable` to `ERROR_CODES` in `packages/shared/src/errors.ts`
    - Add the `live_unavailable: 503` entry to `errorCodeToHttpStatus` (consistent with
      `catalog_unavailable`)
    - _Requirements: 2.8, 3.2_

  - [x] 1.3 Write unit tests for the shared Live_Detail schema
    - Assert the schema accepts a minimal `{ status: 'Unknown', showtimes: [], operatingHours: [], diningAvailability: [] }`
      and rejects out-of-range minute/percentage values
    - _Requirements: 1.2, 1.10, 1.21_

- [x] 2. Implement the ThemeParks live HTTP client
  - [x] 2.1 Implement `themeparksLive.ts` with `getEntityLive`
    - Create `apps/api/src/services/live/themeparksLive.ts` modeled on `createThemeParksClient`,
      reusing the `UpstreamError` discriminated-failure type (`http_status | network | invalid_response | aborted`)
      and the injected `FetchLike`/`baseUrl` pattern
    - `GET /entity/{id}/live` with URL-encoded id; validate only the gross shape (top-level object,
      `liveData` an array of objects); surface a wholly unparseable body as `UpstreamError('invalid_response')`
    - Forward an `AbortSignal` into `fetch` so the deadline can cancel the in-flight request
    - _Requirements: 1.1, 1.8, 2.6_

  - [x] 2.2 Write unit tests for the live client
    - Inject a fake `fetch`; assert 2xx returns the parsed body, non-2xx → `http_status`,
      transport throw → `network`, abort → `aborted`, non-JSON/missing `liveData` → `invalid_response`
    - _Requirements: 1.1, 1.8_

- [x] 3. Implement park-time helpers
  - [x] 3.1 Implement `parkTime.ts`
    - Create `apps/api/src/services/live/parkTime.ts` exporting `WDW_TIME_ZONE = 'America/New_York'`,
      `isCurrentParkDay(instant, now, tz?)`, and `upcomingForecast(entries, now)` (filter to entries
      at/after `now`, sorted ascending by time), resolving zones via `Intl.DateTimeFormat`
    - _Requirements: 1.7, 1.16, 1.19, 4.11_

  - [x] 3.2 Write unit tests for park-time helpers
    - Cover same-day/different-day boundaries around midnight park-local and forecast filtering/sorting
    - _Requirements: 1.7, 4.11_

- [x] 4. Implement the projection pure core
  - [x] 4.1 Implement `projectLiveDetail` in `project.ts`
    - Create `apps/api/src/services/live/project.ts` with `ProjectionContext` and a pure, total,
      deterministic `projectLiveDetail(raw, ctx)` that maps status tokens to `OperatingStatus`
      (`Unknown` default), clamps minute fields to integers in `[0,1440]` or absent, maps return /
      paid-return / boarding-group queues and carries price strings verbatim, projects the forecast
      (absent on any unparseable entry, order preserved otherwise), projects current-day showtimes and
      operating hours with optional `type`, and projects `diningAvailability` (one entry per item,
      empty array when missing) plus `upstreamLastUpdated`
    - Never throws; every unrecognized/missing/out-of-range value maps to the documented absent/Unknown/empty form
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 1.20, 1.21, 1.22_

  - [x] 4.2 Write property test for present-and-valid field projection
    - **Property 1: Projection carries exactly the present, valid fields**
    - **Validates: Requirements 1.2, 1.10, 1.18, 1.19, 1.22**
    - In `apps/api/src/services/live/__tests__/project.prop.test.ts`, min 100 iterations

  - [x] 4.3 Write property test for Operating_Status total mapping
    - **Property 2: Operating_Status is a total mapping**
    - **Validates: Requirements 1.3, 1.4**

  - [x] 4.4 Write property test for minute-valued field bounds
    - **Property 3: Minute-valued fields are whole numbers in [0, 1440] or absent**
    - **Validates: Requirements 1.5, 1.6, 1.11, 1.12, 1.15**

  - [x] 4.5 Write property test for return windows and boarding groups
    - **Property 4: Return windows and boarding groups map state and carry price/numbers faithfully**
    - **Validates: Requirements 1.13, 1.14, 1.15**

  - [x] 4.6 Write property test for showtimes, hours, and dining cardinality
    - **Property 5: Showtimes, operating hours, and dining availability preserve structure and cardinality**
    - **Validates: Requirements 1.7, 1.20, 1.21**

  - [x] 4.7 Write property test for forecast degradation and ordering
    - **Property 6: A bad forecast degrades in isolation; a good forecast preserves order and bounds**
    - **Validates: Requirements 1.16, 1.17**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement the Live_Cache and upstream-id resolution
  - [x] 6.1 Implement `cache.ts` (Redis Live_Cache)
    - Create `apps/api/src/services/live/cache.ts` modeled on the leaderboard cache, exporting
      `LIVE_CACHE_TTL_SECONDS = 300`, `LIVE_CACHE_RETENTION_SECONDS`, the `CachedLiveDetail` shape,
      and a `LiveCache` with `get`/`set` keyed `live:v1:{experienceId}`; key expiry uses the longer
      retention so stale entries survive for fallback; freshness is decided in app code via
      `now - retrievedAt`; a malformed cached payload is treated as a miss
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 2.7_

  - [x] 6.2 Write unit tests for the cache
    - Assert `LIVE_CACHE_TTL_SECONDS === 300`, round-trip store/get, and malformed-payload-as-miss
    - _Requirements: 2.3, 2.4_

  - [x] 6.3 Implement `repo.ts` (`resolveUpstreamEntityId`)
    - Create `apps/api/src/services/live/repo.ts` with `resolveUpstreamEntityId(experienceId)`
      running `SELECT upstream_entity_id FROM experiences WHERE id = $1`, returning `null` when the
      row is absent; reads only, never writes
    - _Requirements: 1.1, 1.9_

  - [x] 6.4 Write unit tests for the repo
    - Assert a present mapping returns the id and an absent row returns `null`
    - _Requirements: 1.1, 1.9_

- [x] 7. Implement the orchestrator
  - [x] 7.1 Implement `getLiveDetail` in `service.ts`
    - Create `apps/api/src/services/live/service.ts` returning `LiveDetailResult`
      (`liveDetail`, `retrievedAt`, `stale`, optional `upstreamLastUpdated`); resolve id → on `null`
      treat as failed retrieval; read cache and serve fresh (`stale:false`) when age ≤ TTL; otherwise
      fetch with a 5s `AbortController` deadline, project, store with fresh `retrievedAt`, serve
      `stale:false`; on any failure (error/unparseable/timeout/unresolved id) with cache present serve
      most recent cached value (any age) `stale:true` without overwriting; with no cache throw
      `AppError('live_unavailable')` and store nothing
    - _Requirements: 1.8, 1.9, 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1_

  - [x] 7.2 Write property test for cache freshness decision
    - **Property 7: Cache freshness decision is keyed on age versus the 5-minute TTL**
    - **Validates: Requirements 2.1, 2.2**
    - In `apps/api/src/services/live/__tests__/service.prop.test.ts` with in-memory cache/client/repo fakes, min 100 iterations

  - [x] 7.3 Write property test for successful retrieval storage
    - **Property 8: A successful retrieval is stored and reflected with a Retrieved_At**
    - **Validates: Requirements 2.4, 2.5**

  - [x] 7.4 Write property test for stale fallback
    - **Property 9: Any failed retrieval with a cache present serves stale and never overwrites**
    - **Validates: Requirements 1.8, 2.6, 2.7, 3.1**

  - [x] 7.5 Write property test for live_unavailable with no cache
    - **Property 10: A failed retrieval with no cache yields live_unavailable and stores nothing**
    - **Validates: Requirements 2.8**

  - [x] 7.6 Write resolution-wiring unit tests
    - With a fake repo + spy client, assert the resolved upstream id is used on the request and that
      an unresolved id never calls upstream
    - _Requirements: 1.1, 1.9_

- [x] 8. Implement and wire the live route
  - [x] 8.1 Implement `routes.ts` Fastify plugin
    - Create `apps/api/src/services/live/routes.ts` exposing `GET /catalog/:experienceId/live`,
      validating `:experienceId` with the shared `uuidSchema`; return 200
      `{ liveDetail, retrievedAt, stale, upstreamLastUpdated? }` on success (including `stale:true`),
      letting `AppError('live_unavailable')` flow through the global error hook to a 503 envelope
    - _Requirements: 2.5, 2.6, 2.8, 3.1, 3.2_

  - [x] 8.2 Wire the live service into `composeServices.ts` and `BuildServerServices`
    - Add a `live` key to `BuildServerServices` in `server.ts`, register the route plugin in
      `buildServer`, and in `composeServices.ts` construct the client, cache, repo, and orchestrator
      and pass `{ live: { getLiveDetail } }` into `buildServer`
    - _Requirements: 1.1, 2.5_

  - [x] 8.3 Write an integration smoke test for the route
    - Exercise `GET /catalog/:experienceId/live` through `buildServer` with a stubbed upstream `fetch`
      for success, error, and timeout; assert the 200/`stale` and 503 envelopes
    - _Requirements: 2.5, 2.6, 2.8, 3.2_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement App-side gating and pure view helpers
  - [x] 10.1 Implement client-side `gating.ts`
    - Create `apps/mobile/src/screens/catalog/gating.ts` with `liveSectionFor(category)` returning at
      most one section: `Ride`/`Character_Meet` → wait/status, `Show`/`Parade` → showtimes,
      `Restaurant` → dining, `Other` → none
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 10.2 Write property test for category gating
    - **Property 15: Category gating yields at most one live section, determined solely by category**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
    - In `apps/mobile/src/screens/catalog/live/__tests__/gating.prop.test.ts`, min 100 iterations

  - [x] 10.3 Implement pure view helpers in `liveView.ts`
    - Create `apps/mobile/src/screens/catalog/live/liveView.ts` with helpers to filter+sort the
      forecast to upcoming entries ascending and pick the unique lowest-wait entry (deterministic
      tie-break), sort showtimes ascending by start, decide the wait/status display (standby shown iff
      Operating + wait present; no-wait indicator when Operating + absent; nothing otherwise), and
      decide the dining empty states (hours-unavailable when no current-day hours with open+close;
      walk-up-unavailable when `diningAvailability` empty)
    - _Requirements: 4.2, 4.3, 4.4, 4.11, 4.12, 5.1, 5.2, 6.3, 6.7_

  - [x] 10.4 Write property test for the forecast view
    - **Property 11: Forecast view shows only upcoming entries, sorted ascending, highlighting the unique lowest wait**
    - **Validates: Requirements 4.11, 4.12**
    - In `apps/mobile/src/screens/catalog/live/__tests__/liveView.prop.test.ts`

  - [x] 10.5 Write property test for wait/status display gating
    - **Property 12: Wait/status display gating is a pure function of status and wait presence**
    - **Validates: Requirements 4.2, 4.3, 4.4**

  - [x] 10.6 Write property test for the showtime view
    - **Property 13: Showtime view is sorted ascending by start, empty when none**
    - **Validates: Requirements 5.1, 5.2**

  - [x] 10.7 Write property test for dining empty states
    - **Property 14: Dining view empty states are decided purely from the data**
    - **Validates: Requirements 6.3, 6.7**

- [x] 11. Implement App-side live section components and screen integration
  - [x] 11.1 Implement the live section components
    - Create `apps/mobile/src/screens/catalog/live/RideLiveSection.tsx`, `ShowtimesSection.tsx`, and
      `DiningSection.tsx` using the existing themed components (`Card`, `SectionLabel`, `Badge`,
      `EmptyState`); render Operating_Status labels, standby and single-rider waits, return /
      paid-return windows (verbatim formatted price), boarding-group status/range, the forecast list
      with the highlighted lowest entry, showtimes (with optional type), operating hours (with
      optional type), and walk-up dining availability, each driven by the `liveView.ts` helpers
    - Render Retrieved_At and the distinctly-labeled Upstream_Last_Updated in park-local time, and the
      stale indicator when `stale` is set
    - _Requirements: 4.1, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.13, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.4, 6.5, 6.6, 6.8_

  - [x] 11.2 Integrate the gated live section into `ExperienceDetailScreen`
    - Add a `GET /catalog/:experienceId/live` read to the existing `useQueries` block (independent of
      the static catalog read); render at most one section per `liveSectionFor(category)`; on a 503
      `live_unavailable` show the "live information currently unavailable" indicator while static
      fields remain visible (and still show the indicator if the catalog detail itself errors); on a
      `stale:true` success show the "information may be out of date" indicator with Retrieved_At
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 11.3 Write component tests for the live sections and screen states
    - Render each gated section per category with representative `Live_Detail` fixtures; assert labels,
      the verbatim formatted price string, park-local timestamps, the distinct Retrieved_At vs
      Upstream_Last_Updated labels, the stale indicator, the empty states, and the live-unavailable state
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 4.1, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.13, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.4, 6.5, 6.6, 6.8_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each task references specific requirements (granular sub-requirements) for traceability.
- Checkpoints ensure incremental validation at natural boundaries (after the pure cores, after the
  backend route wiring, and at the end).
- Property tests validate the universal correctness properties from the design; each runs a minimum
  of 100 iterations and is tagged `// Feature: experience-live-details, Property {n}: ...`.
- Unit, integration, and component tests cover the example/edge-case and presentational criteria.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1", "6.3"] },
    { "id": 1, "tasks": ["1.3", "2.2", "3.2", "4.1", "6.1", "6.4"] },
    { "id": 2, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "6.2", "7.1", "10.1", "10.3"] },
    { "id": 3, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "8.1", "10.2", "10.4", "10.5", "10.6", "10.7", "11.1"] },
    { "id": 4, "tasks": ["8.2", "11.2"] },
    { "id": 5, "tasks": ["8.3", "11.3"] }
  ]
}
```
