# Implementation Plan: Admin Panel

## Overview

This plan builds the Admin_Panel as a new `admin` service module in `apps/api`
(`src/services/admin/{basicAuth.ts,html.ts,repo.ts,routes.ts}`), following the repo's standard
constructor-injected-factory + `composeServices.ts` wiring + `server.ts` opt-in registration
pattern. It is backend-only: no `apps/mobile` code is touched.

Work is ordered to validate the two genuinely new pieces of system behavior first — the
authentication gate (Property 1/2) and the two additive persistence hooks into existing services
(Sampling_Run_History, Push_Delivery_Log — Properties 3/4) — since every other Admin_Section is a
read-only wrapper around data that already exists and carries comparatively little risk. The
shared contracts (new `ErrorCode`s, new `AppConfig` fields) land first since the auth hook and
every route depend on them. Each Admin_Section (Requirements 3-14) is then built as its own
small, independently testable wave: a repo method, a route, and its tests.

## Tasks

- [x] 1. Establish shared contracts and config
  - [x] 1.1 Add Admin_Panel config to `apps/api/src/config.ts`
    - Add `ADMIN_PANEL_USERNAME` / `ADMIN_PANEL_PASSWORD` to `envSchema` as required non-empty
      strings (mirroring `SAMPLING_CRON_SECRET`'s pattern exactly); add `admin: { username, password }`
      to `AppConfig` and `loadConfig()`'s return; add both vars to `apps/api/.env.example` with
      `change-me` placeholders and a comment
    - _Requirements: 1.5_
  - [x] 1.2 Write/extend the config property test
    - Extend `apps/api/src/__tests__/config.prop.test.ts`'s valid-base-env builder with the two
      new required vars, and add a case asserting `loadConfig` throws `ConfigError` naming
      `ADMIN_PANEL_USERNAME`/`ADMIN_PANEL_PASSWORD` when either is missing or empty
    - _Requirements: 1.5_
  - [x] 1.3 Add new `ErrorCode` values to `packages/shared/src/errors.ts`
    - Add `admin_experience_not_found`, `admin_user_not_found`, `admin_sync_already_running` to
      `ERROR_CODES` and `errorCodeToHttpStatus` (404, 404, 409 respectively)
    - _Requirements: 3.6, 5.5, 12.3_

- [x] 2. Create the database migration
  - [x] 2.1 Author `apps/api/migrations/0056_admin_panel.sql`
    - Create `sampling_runs` (id, started_at, completed_at, outcome CHECK, error_message,
      parks_sampled_count, experiences_mapped_count, wait_samples_recorded_count,
      unmapped_with_wait_count, unmapped_sample JSONB) with `sampling_runs_started_at_idx`
    - Create `push_delivery_log` (id, occurred_at, user_id → users ON DELETE CASCADE, status
      CHECK, notification_kind CHECK) with `push_delivery_log_occurred_at_idx` and
      `push_delivery_log_user_id_idx`
    - _Requirements: 7.1, 10.1_
  - [x] 2.2 Write `migration0056.test.ts`
    - Assert both tables' columns, the `outcome`/`status`/`notification_kind` CHECK constraints
      reject an out-of-set value and accept every in-set value, and `push_delivery_log`'s
      `ON DELETE CASCADE` from `users`
    - _Requirements: 7.1, 10.1_

- [x] 3. Implement the Basic Auth gate
  - [x] 3.1 Implement `apps/api/src/services/admin/basicAuth.ts`
    - `createBasicAuthHook({ username, password })` returning a `preHandlerHookHandler`: parse
      `authorization`, base64-decode, split on first `:`, compare via `timingSafeEqual` over
      fixed-length SHA-256 digests of both sides; on any failure reply `401` +
      `WWW-Authenticate: Basic realm="admin"` with an identical body for every failure mode and
      return (no `done()`); on match call `done()`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_
  - [x] 3.2 Write unit tests for every branch
    - Missing header, non-`Basic` scheme, malformed base64, no colon in decoded value, wrong
      username, wrong password, correct credentials — assert status/headers/whether the
      downstream handler ran, for each
    - _Requirements: 1.2, 1.3_
  - [x] 3.3 * Write property test for Property 1
    - **Property 1: Basic Auth gate is total and non-leaking**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.7**
  - [x] 3.4 * Write property/unit test for Property 2
    - **Property 2: Basic Auth comparison is constant-time in input length**
    - **Validates: Requirement 1.4**
    - Assert via digest-length invariance (comparing two equal-length digests always takes the
      `timingSafeEqual` fixed-length path); a true timing measurement is not required, since the
      property is about the comparison algorithm's structure, not wall-clock measurement in CI
    - _Requirements: 1.4_

- [x] 4. Implement the sampling-pass persistence hook
  - [x] 4.1 Add `recordSamplingRun` to `IntelligenceRepo` and wrap `executePass`
    - Add `IntelligenceRepo.recordSamplingRun(row)` (plain INSERT) and
      `IntelligenceRepo.getRecentSamplingRuns(limit)`
    - In `samplingService.ts`, wrap the existing `executePass(now)` call site in a
      `try/catch`/`finally` that records `started_at`/`completed_at`/outcome/counts on success,
      and `failed` + `error_message` on a caught throw, re-throwing nothing further than the
      existing `runSamplingPass` catch already does (no behavior change to the existing
      fatal-error logging)
    - Add a prune step for `sampling_runs` older than `SAMPLING_RUNS_RETENTION_DAYS` (30) in the
      same place `wait_samples` is already pruned
    - _Requirements: 7.1, 7.2_
  - [x] 4.2 Write unit test for Property 3
    - **Property 3: Sampling_Run_History is written exactly once per executed pass, never for a
      skipped one**
    - **Validates: Requirements 7.1, 7.2**
    - Three cases against a fake `IntelligenceRepo`: a successful pass inserts one `success` row
      with correct counts; a pass whose body throws inserts one `failed` row with
      `error_message` set; a debounced/overlapping invocation (via the existing `isRunning`/
      `MIN_SAMPLE_INTERVAL_MS` guards) inserts zero rows
    - _Requirements: 7.1, 7.2_

- [x] 5. Implement the push-delivery persistence hook
  - [x] 5.1 Thread an optional `onDelivery` callback through `notifications/service.ts`
    - Add `onDelivery?: (userId: string, status: ExpoPushDeliveryStatus, kind: string) => Promise<void>`
      to `NotificationServiceDeps`/`DeliveryContext`; call it (best-effort, `.catch` → log only,
      never awaited in a way that blocks the loop) at each point `sendWithRetry` resolves a
      token's final per-attempt classification (`ok`, `device_unregistered`, or exhausted-retry
      `error`)
    - _Requirements: 10.1, 10.4_
  - [x] 5.2 Wire the real `onDelivery` in `composeServices.ts`
    - Implement it as `(userId, status, kind) => pushDeliveryLogRepo.insert({ userId, status, kind })`
      against a new minimal repo (or a method on `AdminRepo`); never let its rejection propagate
    - _Requirements: 10.1, 10.4_
  - [x] 5.3 Write unit test for Property 4
    - **Property 4: Push_Delivery_Log write failure never affects delivery outcome**
    - **Validates: Requirement 10.4**
    - Stub `onDelivery` to (a) throw synchronously and (b) return a rejected promise; assert
      `sendWithRetry`'s token classification, `invalidateByToken` calls, and resolution are
      byte-identical to the existing no-callback test cases for every pre-existing test in
      `notifications/__tests__/service.test.ts`
    - _Requirements: 10.4_

- [x] 6. Implement `html.ts` rendering helpers
  - [x] 6.1 Implement `escapeHtml`, `renderPage`, `table`, `flagged`
    - _Requirements: 2.2, 2.3, 2.4_
  - [x] 6.2 Write unit tests
    - `escapeHtml` escapes `<`, `>`, `&`, `"`, `'`; `renderPage` includes the `X-Robots-Tag`-worthy
      content is actually set as a header by the route layer, not by `renderPage` itself (confirm
      the header is asserted at the route-test level in task 7); `table` renders the right number
      of rows/columns for an empty and non-empty input
    - _Requirements: 2.2, 2.4_

- [x] 7. Implement the Admin_Panel shell and route registration skeleton
  - [x] 7.1 Implement `apps/api/src/services/admin/routes.ts` shell + `GET /admin`
    - `adminRoutes(options)` plugin shape; `GET /admin` renders a nav page linking to every
      Admin_Section path from Requirements 3-14; attach `basicAuth` as `preHandler` on every
      route registered in this plugin; set `X-Robots-Tag: noindex, nofollow` via an
      `onSend`/`preHandler` hook scoped to this plugin
    - Wrap every route body in a try/catch that renders the generic HTML error page on an
      unhandled throw (Requirement 2.3), re-using `AppError`'s `code`/`message` when present
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 1.7_
  - [x] 7.2 Wire into `composeServices.ts` and `server.ts`
    - Add `services.admin?: AdminRoutesOptions` to `BuildServerServices` in `server.ts`; build the
      real `AdminRepo`/`basicAuth` hook/closures in `composeServices.ts` and pass them through
    - _Requirements: 1.1_
  - [x] 7.3 Write route integration tests for the shell
    - `GET /admin` without credentials → `401` + `WWW-Authenticate`; with correct credentials →
      `200` containing a link for every section; `X-Robots-Tag` header present on both outcomes
    - _Requirements: 1.1, 1.2, 2.1, 2.4_

- [x] 8. Checkpoint — auth + shell + the two persistence hooks
  - Run `npx vitest run apps/api/src/services/admin apps/api/src/services/intelligence apps/api/src/services/notifications apps/api/src/db/__tests__/migration0056.test.ts` and `npm run typecheck`
  - Confirm Properties 1-4 all pass before building any read-only Admin_Section
  - _Requirements: 1, 2, 7.1, 7.2, 10.1, 10.4_

- [x] 9. Implement Requirement 3 — Catalog & Disney Sync Visibility
  - [x] 9.1 Add `AdminRepo.getRecentSyncRuns`, `getCatalogDataQuality`
    - `getCatalogDataQuality` computes the three counts (missing `image_url`, missing lat/long,
      unresolved via `themeParksDirectory.resolveEntityId` — batched through
      `getEntityIdMap()` rather than one resolve call per Experience, to avoid N sequential
      awaits over the whole catalog)
    - _Requirements: 3.1, 3.4_
  - [x] 9.2 Wire `GET /admin/catalog`
    - Display cache age, 20 most recent sync runs (visually flagging `waf_block`/`auth_failure`),
      the resolved `AppConfig` sync/backoff values (no credentials), and the data-quality counts
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 9.3 Wire `POST /admin/catalog/sync`
    - Check the existing Redis NX sync-coordination lock state before invoking; if held, respond
      `admin_sync_already_running` (409) and do not start a second sync; otherwise invoke the
      existing `runSync` orchestration and respond immediately (fire-and-forget, mirroring
      `/internal/sampling/run`'s 202-ack pattern)
    - _Requirements: 3.5, 3.6_
  - [x] 9.4 * Write repo + route tests
    - `pg-mem` test for `getCatalogDataQuality`'s three counts against seeded rows; route test
      for the already-running 409 branch and the happy-path 202/sync-triggered branch
    - _Requirements: 3.1, 3.4, 3.5, 3.6_

- [x] 10. Implement Requirement 4 — Disney Transport & Rate-Limiter Visibility
  - [x] 10.1 Add a read-only Rate_Limiter snapshot reader and `ThemeParksDirectory.getSnapshot()`
    - New standalone function (not on the `RateLimiter` interface itself, to keep it decoupled
      from the acquire/release contract) issuing `ZREMRANGEBYSCORE` + `ZCARD` + `GET` against the
      two `DISNEY_TARGETS` buckets' existing Redis keys, performing no `ZADD`/`INCR`
    - Add `getSnapshot()` to `ThemeParksDirectory`, returning the already-private
      `builtAtMs`/map-size/`ttlMs` state without forcing a rebuild
    - _Requirements: 4.1, 4.2_
  - [x] 10.2 Wire `GET /admin/disney-transport`
    - Render both buckets' current dispatch/concurrency counts against their configured budgets,
      and the directory snapshot; render an "unavailable" marker per-section on a Redis error
      rather than failing the page
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 10.3 * Write unit test for Property 5 and a route test for the degraded-Redis branch
    - **Property 5: Rate-limiter and directory snapshot reads never mutate observed state**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - Assert via `ioredis-mock`: calling the snapshot reader N times leaves the sorted
      set/counter values unchanged (compare before/after); directory snapshot read does not
      trigger `ensureFresh`'s build path
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 11. Implement Requirement 5 — Forecast Accuracy Visibility
  - [x] 11.1 Add `AdminRepo.getParkForecastAccuracies`, `getTopWaitForecastAccuracies`,
        `getWaitForecastHistory`
    - `getTopWaitForecastAccuracies` joins `wait_forecast_accuracies` to `experiences.name`,
      `ORDER BY sample_count DESC LIMIT 50`; `getWaitForecastHistory(experienceId, limit)` reads
      `wait_forecast_logs` ordered `date DESC, hour DESC`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 11.2 Wire `GET /admin/intelligence/accuracy` and `GET /admin/intelligence/accuracy/:experienceId`
    - The list page renders park-level and Experience-level accuracy (including Challenger_Model
      columns when non-null); the detail page 404s with `admin_experience_not_found` when the id
      does not resolve to an existing Experience
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 11.3 * Write repo + route tests
    - `pg-mem` seeded-row tests for all three repo methods; route test for the 404 branch and the
      Challenger_Model-columns-present/absent rendering branch
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 12. Implement Requirement 6 — Intelligence Model Internals Visibility
  - [x] 12.1 Add `AdminRepo.getParkCrowdIndexHistory`, `getRideBaselineCoverage`,
        `getTopWeatherSensitivities`, `getTopRideCascades`, `getShowTimePatterns`
    - `getRideBaselineCoverage` returns established-vs-null counts plus the top-20-by-bucket-
      density Experiences; the other three are joined `ORDER BY sample_count DESC LIMIT 50` reads
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 12.2 Wire `GET /admin/intelligence/model`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 12.3 * Write repo tests against seeded `pg-mem` rows for each of the five methods
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 13. Implement Requirement 7 (routes) — Sampling & Derived-Stats Health
  - [x] 13.1 Add `AdminRepo.getRecentSamplingRuns` route wiring (repo method landed in task 4.1)
  - [x] 13.2 Wire `GET /admin/intelligence/sampling` and `GET /admin/intelligence/derived-stats`
    - Sampling page: 20 most recent runs, time since last `success`, degraded flag when the most
      recent run `failed` or no `success` within `SAMPLING_HEALTH_STALE_MINUTES`, and the most
      recent non-empty `unmapped_sample`; derived-stats page: every `derived_stat_runs` row
      (via `IntelligenceRepo.getDerivedStatRuns`, already existing) with a degraded flag when
      `consecutive_failures > 0`
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7_
  - [x] 13.3 * Write route tests for both degraded-flag branches and the healthy branch
    - _Requirements: 7.4, 7.7_

- [x] 14. Implement Requirement 8 — Infrastructure Budget Visibility
  - [x] 14.1 Add `AdminRepo.getDatabaseSizeSnapshot`, `getRedisCommandBudget`
    - `getDatabaseSizeSnapshot`: `pg_database_size(current_database())` + top-10 tables via
      `pg_total_relation_size`; `getRedisCommandBudget`: parse `INFO commandstats`, summing
      `calls=` across lines, returning `null` on parse failure/missing section
    - _Requirements: 8.1, 8.3, 8.4_
  - [x] 14.2 Wire `GET /admin/infra`
    - Render DB size + percentage of `NEON_FREE_TIER_BYTES`, top-10 tables, Redis command count +
      percentage of `UPSTASH_FREE_TIER_DAILY_COMMANDS` or an "unavailable" marker
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 14.3 * Write repo tests (DB size against a real `pg-mem`-unsupported path — use a thin
        fake pool for the two `pg_*` calls since `pg-mem` does not implement them) and a route
        test for the `null`-budget unavailable branch
    - _Requirements: 8.1, 8.3, 8.4_

- [x] 15. Implement Requirement 9 — Authentication & Abuse Visibility
  - [x] 15.1 Add `AdminRepo.getActiveLockouts`, `clearLockout`
    - `getActiveLockouts`: `SCAN`/`KEYS locked:*` (SCAN preferred for a non-blocking Redis call),
      join each `userId` to `users.email` via one batched query; `clearLockout(userId)`: `DEL`
      both `locked:{userId}` and `lockout:{userId}`, returning whether either existed
      (`EXISTS` check before delete, or inspect `DEL`'s returned count)
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 15.2 Wire `GET /admin/accounts/lockouts` and `POST /admin/accounts/:userId/unlock`
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 15.3 * Write unit test for Property 6
    - **Property 6: Lockout clear is idempotent and reports absence truthfully**
    - **Validates: Requirements 9.2, 9.3**
    - Against `ioredis-mock`: seed both keys → `clearLockout` returns `true`, keys gone; call
      again → returns `false`; call on a `userId` that never had either key → returns `false`
    - _Requirements: 9.2, 9.3_

- [x] 16. Implement Requirement 10 (routes) — Push Notification Delivery Visibility
  - [x] 16.1 Add `AdminRepo.getRecentPushDeliveries`, `getPushDeliveryCounts`
    - _Requirements: 10.2, 10.3_
  - [x] 16.2 Wire `GET /admin/notifications`
    - 100 most recent rows, trailing-24h per-status counts, degraded flag when `error` count
      exceeds `ok` count in that window
    - _Requirements: 10.2, 10.3_
  - [x] 16.3 Add the opportunistic 30-day prune for `push_delivery_log`
    - A Redis-marker-gated best-effort prune (reusing the `MENU_FRESHNESS_MS`-style lazy pattern),
      run from the `GET /admin/notifications` handler itself rather than a new scheduled job
    - _Requirements: (retention; not a numbered acceptance criterion — housekeeping per design.md "Retention")_
  - [x] 16.4 * Write repo tests for the counts/degraded-threshold branch
    - _Requirements: 10.2, 10.3_

- [x] 17. Implement Requirement 11 — User & Support Lookup
  - [x] 17.1 Add `AdminRepo.findUserByEmail`, `revokeAllSessions`
    - `findUserByEmail`: one query against `users`/`profiles` plus scalar subqueries for the
      counts listed in Requirement 11.1, relying on `CITEXT`'s native case-insensitive equality;
      `revokeAllSessions`: `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND
      revoked_at IS NULL`, returning the affected row count
    - _Requirements: 11.1, 11.4_
  - [x] 17.2 Wire `GET /admin/users?email=` and `POST /admin/users/:userId/revoke-sessions`
    - The lookup page also links to Requirement 9's lockout status and renders the most recent 5
      `push_registrations` rows for that user
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [x] 17.3 * Write unit tests for Properties 7 and 8
    - **Property 7: User lookup is case-insensitive and non-probing on miss**
    - **Validates: Requirements 11.1, 11.2**
    - **Property 8: Session revoke is scoped to exactly the target user's un-revoked sessions**
    - **Validates: Requirement 11.4**
    - Against `pg-mem`: seed a user with a mixed-case email and look it up in three different
      casings; seed a second unrelated user with sessions and assert their rows are untouched by
      the first user's `revokeAllSessions` call
    - _Requirements: 11.1, 11.2, 11.4_

- [x] 18. Implement Requirement 12 — Pin Collection Diagnostic
  - [x] 18.1 Wire `GET /admin/users/:userId/pins` and `POST /admin/users/:userId/pins/reconcile`
    - Reuse the existing `PinRepo.getBoard(userId)` directly; verify the `userId` resolves to an
      existing user first (404 `admin_user_not_found` otherwise) since `getBoard` itself does not
      distinguish a nonexistent user from one with zero progress; the reconcile action calls the
      existing `PinRepo.reconcileAll()` and reports the resulting `pinsAwarded` count filtered to
      (or simply reports the global count and notes it is global, if no single-user
      reconciliation path exists on the current `PinRepo` interface — do not add one speculatively;
      state plainly in the rendered response which scope was actually reconciled)
    - _Requirements: 12.1, 12.2, 12.3_
  - [x] 18.2 * Write route tests for the 404 branch and the board-rendering/reconcile-trigger
        branches
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 19. Implement Requirement 13 — Growth & Engagement Counts
  - [x] 19.1 Add `AdminRepo.getGrowthTotals`, `getDailyGrowth`
    - _Requirements: 13.1, 13.2_
  - [x] 19.2 Wire `GET /admin/growth`
    - _Requirements: 13.1, 13.2_
  - [x] 19.3 * Write repo tests against seeded rows spanning multiple days
    - _Requirements: 13.1, 13.2_

- [x] 20. Implement Requirement 14 — Configuration Visibility
  - [x] 20.1 Wire `GET /admin/config`
    - Render the enumerated non-secret `AppConfig` fields only; add an explicit unit test
      asserting the rendered HTML never contains the literal values of `database.url`,
      `redis.url`, `session.secret`, `disney.credentials.*`,
      `intelligence.samplingCronSecret`, `pins.reconcileCronSecret`, or the Admin_Credentials
      themselves, by constructing a config with recognizable sentinel values for every secret
      field and asserting none of those sentinels appear in the response body
    - _Requirements: 14.1, 14.2_

- [x] 21. Final checkpoint — full Admin_Panel
  - Run `npm run verify` (full typecheck + full test suite across `apps/api`, `apps/mobile`,
    `packages/shared`) once, as the final gate for the whole feature
  - Confirm the behavior→test map covers every Requirement 1-14 acceptance criterion and every
    Property 1-8
  - Manually smoke-test locally: `npm run dev:api`, hit `GET /admin` with and without
    credentials, click through every section once against the local Docker Postgres/Redis
  - _Requirements: all_

## Notes

- Tasks marked with `*` are optional (property/unit/integration test tasks) and can be skipped
  for a faster MVP; core implementation tasks are never optional, consistent with this repo's
  "test coverage is part of done" steering — in practice every `*` task here is still expected to
  land per that steering, but it is marked to flag which tasks are pure-test additions versus
  behavior.
- Every property test uses `fast-check` with `{ numRuns: 100 }`, tagged
  `// Feature: admin-panel, Property N: <text>`.
- `repo.ts` is a single file with many small independent methods (see design.md's "AdminRepo"
  rationale); sub-tasks within a Requirement's wave touch disjoint methods, so they can be
  implemented in any order within that wave, but each wave is sequenced after task 1-8 since
  every route depends on the auth hook and the shared error codes.
- Tasks 4 and 5 (the two additive hooks into `samplingService.ts` and `notifications/service.ts`)
  are the only tasks that modify behavior of an existing, already-shipped service; every other
  task adds net-new, additive code paths. Review these two with extra care per this repo's
  "you broke it, you own it" verification discipline — run the full existing test suites for
  `services/intelligence` and `services/notifications` after task 4/5, not just the new tests.
- No mobile work exists in this plan. If a future spec wants an in-app admin surface, that is a
  new, separate spec — this one is deliberately server-rendered-only per Requirement 2.2.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1", "2.2"] },
    { "id": 1, "tasks": ["3.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "4.2", "5.2", "5.3", "6.2"] },
    { "id": 3, "tasks": ["7.1", "7.2"] },
    { "id": 4, "tasks": ["7.3"] },
    { "id": 5, "tasks": ["8"] },
    { "id": 6, "tasks": [
      "9.1", "10.1", "11.1", "12.1", "13.1", "14.1", "15.1", "16.1", "17.1", "19.1"
    ] },
    { "id": 7, "tasks": [
      "9.2", "9.3", "10.2", "11.2", "12.2", "13.2", "14.2", "15.2", "16.2", "16.3", "17.2", "18.1", "19.2", "20.1"
    ] },
    { "id": 8, "tasks": [
      "9.4", "10.3", "11.3", "12.3", "13.3", "14.3", "15.3", "16.4", "17.3", "18.2", "19.3"
    ] },
    { "id": 9, "tasks": ["21"] }
  ]
}
```

Wave 6 is every Admin_Section's repo-method task; they are independent of each other (each reads
a disjoint set of tables/keys) and can be built in parallel once wave 0-5 (contracts, the two
persistence hooks, the shell, and the checkpoint) are green. Wave 7 is each section's route
wiring, depending only on its own wave-6 repo methods plus the wave-3/4 shell. Wave 8 is the
optional (`*`) test tasks for every section, which can trail their own wave-7 route task. Task 21
is the single final full-suite gate and depends on every prior wave.
