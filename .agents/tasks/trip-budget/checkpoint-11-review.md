# Checkpoint 11 independent review (trip-budget, tasks 1 to 11)

Reviewer: independent read-only review of Gemini's work. No source, spec or env file was modified or committed. Temporary scripts were written only under the OS temp dir (`%TEMP%\cp11-*.cjs|mts`) and are listed at the end.

## Verdict: CHANGES_REQUESTED

The gates Gemini cited are real and green. I re-ran them and got the same numbers. But the green gates hide four defects in the shipped code and two false statements in the Checkpoint 11 report:

1. Admin "Refresh now" reports `started` but never fetches anything. It also leaves the control claim held for 15 minutes (reproduced).
2. The "row-count drop > 50 %" acceptance rule is dead in production wiring. The service passes the CURRENT parse as the "previous" set.
3. Several required service-level tests for tasks 8.3 and 9.2 do not exist, yet tasks 8.x/9.x are checked `[x]`. `noteDemand` has no test at all.
4. The `serviceStyle` sample was skipped for a reason that is not valid. The `startingPark` confirmation cites constants that do not exist anywhere in the repo.

Details, evidence and fixes follow. Everything not listed here looked correct.

### Prioritized list

Required fixes (block approval):

| # | Item | Where |
|---|------|-------|
| R1 | `runNow` claims the control row, then `executeRun('admin_full')` claims again and loses, so no fetch happens and the claim is never released | `ticketPrices/refreshService.ts:509-515` and `:103` |
| R2 | `previousMeta` is built from the new parse, so the acceptance rate-drop rule never fires; admin state hardcodes `rowCount: 0`, `windowDays: null` | `refreshService.ts:303-310`, `:488-489` |
| R3 | Missing tests required by tasks 8.3, 8.1 and 9.2 (list under finding 5), while 8.x and 9.x are checked | `ticketPrices/__tests__/*`, `accountDeletion/__tests__/budget.purge.test.ts` |
| R4 | `InvalidResponse` (plain `Error`) from `parsePricesResponse` falls into the "generic failure" branch: no `recordSetError`, so the set never gets `last_error = invalid_response` (design.md) and the admin page shows no error for it | `refreshService.ts:293`, `:398-407` |
| R5 | `releaseControl(status, null)` writes `last_error = NULL` right after `block(until, reason)` wrote the reason, so every block reason (waf_block, start_date_rejected, consecutive_failures) is wiped from the control row and never shown on the admin page | `ticketPrices/repo.ts:327` vs `:342`; `refreshService.ts:416` |
| R6 | `diagnose()` rethrows every upstream error, so the admin POST returns a 500 instead of a result page; `wafMarker` is hardcoded `false` | `ticketPrices/diagnose.ts:120,132`; `admin/ticketPriceRoutes.ts:171` |
| R7 | Property tags do not match design.md (list in finding 7) | `money.prop.test.ts`, `sharedMoney.crosscheck.test.ts`, `tripBudget.prop.test.ts`, missing tags on 16/29/37 |
| R8 | Correct the Checkpoint 11 report: `startingPark` claim is fabricated; `serviceStyle` reason is invalid. Either gather the sample or state honestly that no attempt was made (finding 9) | report |
| R9 | 9 new ESLint errors in new code (`no-explicit-any`, `prefer-const`, `consistent-type-imports`) | `diagnose.ts`, `refreshService.ts`, 2 test files |

Optional notes (do not block):

- N1: no logger is injected into `createTicketPricesService` in `composeServices.ts`, so the service's `logger.error` calls are no-ops and background failures are silent.
- N2: `checkForWaf` tests WAF markers on every body, including valid 2xx JSON. design.md says only non-JSON or non-2xx bodies.
- N3: `TICKET_PRICES_DIAGNOSE_MIN_INTERVAL_SECONDS` is dead; `claimControl('diagnose')` hardcodes 60 (`repo.ts:304`).
- N4: no spacing between the token call and the probe call, or around the 401 token refetch (spec: one call per 1,500 ms). Property 35 "spacing on a fake clock" is not tested (`requestSpacingMs: 0`, `sleepFn` no-op).
- N5: `structure.test.ts` last test ("composeServices constructs ticket service in its own block") is vacuous. It filters violations by `'services/ticketPrices'`, which no forbidden-import pattern can produce. `noRedis.test.ts` is regex based and non-recursive.
- N6: `tasks.md` check state is inconsistent: only 8.x and 9.x are `[x]`, although Gemini claims 1 to 11 done. This is cosmetic, but pick one story.
- N7: `diningMenuClient.asString` now trims (`v.trim().length > 0`). That is a behaviour change nobody asked for (whitespace-only titles are now dropped).
- N8: `.env.example` lists the `LL_*` keys twice (a commented block at lines 77-83 and a live block at 221-227).
- N9: `LightningLaneRepo.readBook` history statement has no lower date bound, so it reads up to `LL_PRICES_RETENTION_DAYS` of single-pass rows for the park on every Budget read.
- N10: `ADMIN_SECTIONS` always lists `/admin/ticket-prices` while the route registers only when the port is wired.
- N11: the 400-retry for the probe (`startDate=endDate=today`) retries with `startDate = UTC date` and unchanged `endDate`, which would be inverted. This follows the spec text literally, so it is a spec-level quirk, not Gemini's fault.
- N12: `TIP_BEARING_SERVICE_STYLES` is lowercase (`enums.ts:445`). The real payload and the design fixture use `"Buffet"`, so task 12.5 must compare case-insensitively.

---

## 1. Gates re-run

`npm run verify:api` (repo root), literal tail:

```
 Test Files  589 passed (589)
      Tests  4531 passed (4531)
   Start at  15:13:04
   Duration  139.45s (transform 95.15s, setup 0ms, import 532.23s, tests 2460.85s, environment 125ms)
 % Coverage report from v8
All files     |   96.68 |    94.05 |     100 |   97.05 |
 optimizer.ts |   96.47 |    94.22 |     100 |   96.85 | ...337,403,460-463,541
 travel.ts    |     100 |    88.88 |     100 |     100 | 67
Statements   : 96.68% ( 321/332 )   Branches : 94.05% ( 269/286 )   Functions : 100% ( 24/24 )   Lines : 97.05% ( 297/306 )
EXIT=0
```

Typecheck ran for api, mobile and shared inside it (exit 0). Matches Gemini's 589 / 4531. The planning coverage threshold held. The red-looking `level:50` lines in the log come from failure-path tests (pg pool, archive legs), not from failures.

The three livedb files, run individually (`npx vitest run --coverage.enabled=false --reporter=verbose <3 paths>` in `apps/api`):

```
 Test Files  3 passed (3)
      Tests  20 passed (20)
   Start at  15:30:41
   Duration  5.06s
EXIT=0
```

They RAN (not skipped). The split is 11 + 8 + 1, which matches Gemini's counts. Verbose output lists each case, including the two-connection claim race, the 21000 negative control, the round 4 L6 reconcile case, the round 5 `recordSetError`/`updateSet` case, the `split_part` regression case and the per-pass timestamp cases.

`npm run verify:shared`:

```
 Test Files  54 passed (54)
      Tests  679 passed (679)
EXIT=0
```

Mobile `receiptScan` tests (task 2 asks for them, and `receiptScan.pure.ts` changed): `npx jest receiptScan` in `apps/mobile` gave `Test Suites: 2 passed, 2 total / Tests: 16 passed, 16 total`, exit 0.

Scope check: tasks 12+ are not present. `apps/api/src/services/tripBudget/` holds only `__tests__/sharedMoney.crosscheck.test.ts`, which task 1.1 requires. No budget routes, repo, pure modules or mobile screens exist. No scope creep.

## 2. Local DB safety

- All three livedb files read `DATABASE_URL` (default `postgres://dwt:dwt@localhost:5432/dwt`). They then run `CREATE DATABASE dwt_<name>_<uuid>` on that server, apply every migration file into the new database, and `DROP DATABASE ... WITH (FORCE)` in `afterAll`. See `ticketRepo.livedb.test.ts:67-88`, `llRepo.livedb.test.ts:86-100`, `samplingService.ll.livedb.test.ts:87-113`. They never write to the developer's `dwt` data.
- Read-only check of the dev database (SELECT inside `BEGIN READ ONLY`, then `ROLLBACK`): `schema_migrations` tail is `0064_account_deletion.sql`. The five new tables are absent (`new tables present in dwt: 0`, `migrations >= 0065 recorded: 0`). `experience_menus` has no `shape_version` column. Conclusion: migrations 0065 to 0068 were NOT applied to the dev database `dwt`. Gemini's statement that "all migrations (0001 through 0068) applied" is true only for the throwaway per-test databases. The dev DB is still at 0064.
- No leftover test databases from this work. Database list is `dwt, dwt_stats_perf_3c9e3e83956a4a1dbe22e425d393b2b3, postgres`. The `dwt_stats_perf_*` database is not from these tests (a different feature's naming).
- Residual risk: if `DATABASE_URL` is exported in a shell pointing at a remote server, the livedb files would run `CREATE DATABASE` there. Vitest does not load `.env`, and `DATABASE_URL` was unset in my shell. Low risk.
- The user did not authorize migrating the dev DB, and it did not happen.

## 3. Kill switch and secrets

- `apps/api/src/config.ts:257-264`: `TICKET_PRICES_ENABLED` uses the PHOTOS-style transform. `undefined`/`''` gives `false`, boolean passes through, otherwise `'true'`/`'1'`. Default false. `config.ticketPrices.test.ts` asserts `enabled === false` by default and the coercion table `undefined, '', '0', 'false' => false`; `'1', 'true' => true`.
- `apps/api/.env.example:230`: `TICKET_PRICES_ENABLED=false`.
- `apps/api/.env` and `apps/api/.env.dev` (both untracked/ignored): no `TICKET_PRICES_*` or `LL_*` key present at all. `git grep` over `render.yaml`, `docker-compose.yml` and `.github` finds no `TICKET_PRICES`. The only other repo hit is `docs/hosting.md:182` (prose saying default false). No committed file enables it.
- `git status` for env files shows only ` M apps/api/.env.example` (the intended additions). No `.env*` file was edited.
- Secret scan over all 108 new or changed files under `apps/`, `packages/`, `docs/` (bearer hex, `access_token` hex, AKIA, `sk-`, `ghp_`, JWT shapes): zero hits. No `console.*` and no logger call that references a token in `ticketPrices/` or `admin/ticketPriceRoutes.ts`. The diagnose result is token-free (tested with `JSON.stringify(res)` not containing the fake token).
- Env file values were not printed. Only key names and the single boolean for the kill switch.

## 4. No live Disney calls in tests

- Every `createTicketPriceClient(...)` in `ticketPriceClient.test.ts` gets an injected fake `fetch`. No test calls `globalThis.fetch`. The `disneyworld.disney.go.com` strings in tests are URL expectations or config values, not requests. `api.themeparks.wiki` does not appear in any new test. The diningMenuClient tests use a stub transport.
- Fixture fidelity against `ticket-price-source.md` section 1.4: `parsePricesResponse.contract.test.ts` uses `maxPricingCalendarDate`, `numDays` as the string `"4"`, `dates[].validityEndDate`, 8 pricing entries, `pricePerDay`/`subtotal`/`tax` as dollar strings, a `stopSale` entry, an unrecognized id and a `"N/A"` subtotal. `parsePricesResponse.ts` and `dollarsStringToCents` use `subtotal` only and ignore `pricePerDay`. Cents come from decimal string arithmetic, with no float multiplication.
- The token endpoint shape (`{"access_token", "expires_in"}`) matches the client.

## 5. Spec fidelity, tasks 5 to 10

Confirmed correct (read the code and the tests that cover it):

- Ticket client: honest UA from config, `Authorization: BEARER` on P only, no Cookie, query params exactly `discountGroup,startDate,storeId,endDate,numDays`, timeout covers body read, 403/429 always `waf_block`, `classifyDisneyResponse` reused, 401 and 404 distinct kinds, one 400 retry with `max(WDW today, UTC date)` only when UTC is later, second 400 gives `start_date_rejected`. Header comment records the transport/limiter/classify findings as the task asks.
- `acceptPricesSet`: empty, invalid price, rate-per-window-day drop below `minRatio`, unrecognized fraction. The pure function is correct (but see finding 2 for wiring).
- Freshness: `ticketAgeClass` is `<= 45` current, `<= 120` may_have_changed, else estimate. Defaults 45/120 are in config.
- Demand-driven, no cron/timer/Redis: `refreshService.ts` uses only a `setTimeout` sleep; `structure.test.ts` uses the TypeScript compiler API with a detector self-test (comment words do not trip it). `composeServices.ts` builds the ticket service in its own block, nothing under a Disney live module; `retirement.smoke.test.ts` and `roleReader.guard.test.ts` are unmodified (absent from `git status`) and green in the full run.
- Single-flight + attempt cooldown + `blocked_until`: `claimControl` SQL stamps at claim time, bound `make_interval` params, no stamp rewind; the livedb race and cooldown tests pass.
- Upsert: `dedupeByKey` (Map) before a 10-array `unnest`, `IS DISTINCT FROM` tuple guard, chunks of 2,000. Negative control proves 21000 without dedupe. Prune and reconcile scoped to `[startDateSent, endDate]`.
- LL: `classifyPurchase` uses `type === 'PACKAGE'` + id prefix (exact-name only as a fallback). `extractLlPrices` is first-valid-wins per date, USD/integer>0 only. `upsertParkScheduleSignals` is COALESCE-non-destructive with per-pass timestamps. `upsertLightningLaneSinglePrices` dedupes in a Map and joins with the exact `numeric_id || ';entityType=Attraction'` (no `split_part`), so no 21000 risk. `samplingService` has no destination call, one `getEntitySchedule` per park, singles guarded by the 12 h rule, extractor failure only skips that park.
- Permissions: four actions added to the existing sets in `permissions.ts` (member: view/edit/edit_travelers; organizer-only: edit_settings). No new auth shortcut.
- Dispositions: 3 entries added (`trip_budget_lines.created_by`, `trip_budget_allocations.member_id`, `trip_traveler_profiles.member_id`). `EXPECTED_USER_FK_COUNT` 70 to 73 and anonymize count 20 to 22. Migration 0068 has exactly those three `REFERENCES users(id)` columns, so "73 foreign keys tracked" is accurate and the registry test passes.
- Admin page: Basic auth plus `isSameOriginRequest` on all three POSTs, `last_error` through `escapeHtml`/`table`, no price input, kill-switch gate text, the verbatim owner quote, "owner's written confirmation pending", revisit notice, `pg_total_relation_size`, `startDateSent`.
- Migrations 0065 to 0068: each is wrapped in `BEGIN/COMMIT`, uses `IF NOT EXISTS`, no `REFERENCES users` in 0065 to 0067. (I did not diff the DDL against design.md line by line.)
- Menu: `decideMenuRefresh` = `decideMenuFetch || shapeVersion < MENU_SHAPE_VERSION`; `upsertMenus` writes `shape_version`; `formatDiningPrice` and the `price` string untouched. Only a `Math.round(withoutTax * 100)` on 2-decimal USD values, which is safe.

### Finding 1 (R1, reproduced): Admin "Refresh now" does nothing

`refreshService.ts:509` (`runNow`) calls `repo.claimControl('full', true, 15, ...)` and, if it wins, fires `void executeRun('admin_full')` (`:515`). `executeRun` starts by claiming AGAIN (`:103`). The first claim set `in_progress_since = now()`, and the claim SQL requires `in_progress_since IS NULL OR older than the claim timeout`, so the second claim returns false. `executeRun` returns `{status:'skipped'}` before its `try/finally`, so `releaseControl` is never called.

Reproduction (`%TEMP%\cp11-runnow.mts`, real `refreshService.ts` with a fake repo that mirrors the claim condition, zero spacing):

```
runNow outcome: started
claims attempted: 2 | client calls: [] | releaseControl calls: 0 | still in_progress: true
```

User-visible consequence: the admin page flashes "started", no token/price call is made, and the control row stays in progress for 15 minutes. That blocks demand-driven runs and `diagnose` (`already_running`) for the same time. The existing test (`refreshService.test.ts:395-408`) only asserts `outcome === 'started'` and `'blocked'`, so it executes the path without asserting the effect (the "executed-but-unasserted" pattern). Tasks 8.3 also requires "a `runNow` 2 hours after a demand-driven full run starts a run", and `runNow` with the switch off, or during an in-flight run, does not. None of those three is asserted.

Fix: have `runNow` call a shared internal `run` that claims exactly once (for example `executeRun('admin_full', ..., {alreadyClaimed: true})`), or drop the pre-claim and report `already_running` from the result of `executeRun`. Add a test that, after `runNow()`, the fake client received the token call and the price calls, `releaseControl` ran, and a second `runNow()` during the run returns `already_running`.

### Finding 2 (R2): the acceptance drop rule is disabled in the service

`refreshService.ts:303-310`:

```ts
const previousMeta = prevSet && prevSet.horizonDate
  ? { rowCount: parsed.rows.length, windowDays, asOf: ..., horizonDate: ... }
  : null;
```

It uses the NEW `parsed.rows.length` and the NEW `windowDays` as "previous". `acceptPricesSet` then compares the new rate against itself (`previousRate = rows/window`, `currentRate = rows/window`), so `row_count_drop` can never fire for a set that has a stored `horizonDate`. The previous values are available: `readBook` returns `rowCount` and `windowDays` per set (`repo.ts` set mapping), but the service never reads `prevSet.rowCount`/`prevSet.windowDays`.

Consequence: a Disney response that comes back with a small fraction of the usual rows is accepted, `reconcileSet` then deletes every key absent from it inside the window, and the cache is wiped. This is the exact failure Requirement 11.9 and Property 11 exist to stop. The pure-function test (`setAcceptance.prop.test.ts`) is green, which is why the gate shows nothing.

A related stub: `readState` hardcodes `rowCount: 0` and `windowDays: null` for every set (`refreshService.ts:488-489`), so the admin "Row Count" and "Window Days" columns always show 0 and `-`.

Fix: build `previousMeta` from `prevSet.rowCount` and `prevSet.windowDays` (use `null` when the set has no prior accepted rows), and map the same fields in `readState`. Add a service test with a previous set of N rows and a response with under `minRatio` of the per-day rate: expect `recordSetError('row_count_drop')`, no `upsertRows`, no `reconcileSet`, no `updateSet`.

### Finding 3 (R4): invalid payload leaves no `last_error`

`parsePricesResponse` throws `InvalidResponse extends Error` (`parsePricesResponse.ts:12`). In the set loop (`refreshService.ts:293`), that is not a `TicketClientError`, so it reaches "Generic failure" (`:398-407`): it increments `consecutiveFailures` but never calls `recordSetError`. The set therefore has no `last_error`. Consequence (I read `cacheState.ts` to check): rule 3 of `ticketCacheState` ("set has a real error => failed") cannot fire. Right after the run the 24 h attempt cooldown makes rule 5 return `failed`, so the user briefly sees the right text. Once the cooldown elapses the same set flips to `warming` (rule 4) with nothing in flight, which is a misleading state until another demand starts a run. The admin "Last Error" for the set stays `-`, and design.md says `invalid_response` is recorded on the set. This is a smaller defect than R1 and R2, but it is a plain spec deviation with a one-line fix.

Fix: catch `InvalidResponse` (or make it a `TicketClientError('invalid_response')`) and call `recordSetError(..., 'invalid_response')`. Related smaller gaps in the same area: the token-failure path sets `errorCode = err.message` (`:131`), which `normalizeErrorCode` turns into `invalid_response` even for a network error (use `err.kind`). The probe failure paths record nothing on the control row and do not do the one token refetch on `unauthorized` that the design describes.

### Finding 4 (R5): block reason is erased

`block()` writes `last_error = <reason>` (`repo.ts:342+`). The `finally` in `executeRun` then calls `releaseControl(status, errorCode)` with `errorCode = null` for every blocked outcome, and `releaseControl` sets `last_error = $2` (`repo.ts:327`), which is `NULL`. The same happens in `runDiagnose` (`releaseControl('diagnose_complete')`). The admin page's "Last Error" and the "block reason rendered as a Ticket_Error_Code" requirement (task 10.1) therefore show `-` right after a WAF block. Fix: `releaseControl` should keep the existing `last_error` when the passed code is null (`COALESCE($2, last_error)`), or the service should pass the block reason as `errorCode`. Add a livedb or service test: after a WAF block run, `control.lastError === 'waf_block'`.

### Finding 5 (R3): required tests that do not exist

`noteDemand` has no test and no caller anywhere (`grep` over `apps/api/src` finds only its definition). It is also the only entry point for demand-driven refresh. Task 8.3 and Properties 16/37 require, among others, and I could not find any of these in `refreshService.test.ts`:

- 50 further `noteDemand` calls inside a `start_date_rejected` block start zero runs and make zero client calls (Property 37). Today the test only checks `blockedUntil` is set and `last_attempt_at` is non-null.
- Past start date and non-permitted pair are ignored; kill switch off does zero reads.
- `probe_only` pulls nothing when the horizon is unchanged, and `horizon_changed` ending when `upgradeClaimToFull` loses.
- 401 then one token refetch; second 401 recorded as `http_status:401`; `404` on `std-gst` recorded as `http_status:404` and counted.
- Call count never exceeds `2 + sets` plus one token retry plus one start-date retry.
- Spacing on a fake clock (`requestSpacingMs` is 0 and `sleepFn` is a no-op in the harness), and a success between two failures resets the count.
- `runNow` semantics (see Finding 1).
- `diagnose` through the admin port with `enabled = false` (the "round 4 M1" test calls `runDiagnose` directly, which has no `enabled` parameter, so no regression that adds a gate in `admin.diagnose()` would fail it).
- Task 9.2 asks for "two deleted accounts on one line stay two allocations". `budget.purge.test.ts` has one deleted account plus one live one. It does show the line is anonymized, totals preserved and the profile deleted. The tombstone is per account (`dispositions.ts:126` note), so I expect two deleted accounts not to collide, but it is not asserted.

Tasks 8.1 to 8.4 are checked `[x]` while these are missing. Per execution-discipline, leave 8.3 unchecked until they exist.

### Finding 6 (R6): diagnose failure handling

`runDiagnose` rethrows any client error after the `finally` (`diagnose.ts:132`), and `ticketPriceRoutes.ts:171` does `await ticketPrices.diagnose()` with no try/catch. A timeout, 401, 404 or WAF block gives a Fastify 500 instead of the diagnostic table the operator needs for the three-run launch gate. `wafMarker: false` is hardcoded (`diagnose.ts:120`) so the field is meaningless. `AdminDiagnoseResult` has no error shape. Fix: return a result that carries the failing call and error code (and set `wafMarker: true` on `waf_block`), and add a route test for the failure path. The route tests currently only cover success and the three refusals.

## 6. Did-it-fail-before check (five behaviors)

| Behavior | Test | Would it fail if the code were mutated? |
|---|---|---|
| `start_date_rejected` keeps claim-time `last_attempt_at` | `refreshService.test.ts:350` | Partly. `expect(getLastAttemptAt()).not.toBeNull()` fails only if a rewind produced null. There is no restore method on the repo interface, so a rewind cannot be written without a new method, which helps. The Property 37 half (50 `noteDemand` calls start zero runs) is not tested at all. |
| Set acceptance rejects a >50 % per-day drop | `setAcceptance.prop.test.ts` | Pure function: yes, it bites. Production: NO. Replacing `acceptPricesSet` with `() => ({ok:true})` in the service would not change any service test, and the current wiring already behaves that way (Finding 2). |
| LL upsert is non-destructive on null | `llRepo.livedb.test.ts` (non-destructive case) and `samplingService.ll.livedb.test.ts` | Yes. Real Postgres, asserts all five LL columns plus the three captured-at columns after a null-LL upsert, while `open_time`/`close_time`/`early_entry` take the new values. It would fail against `= EXCLUDED`. This one is strong. |
| Menu lazy refill shape 1 to 2 | `menuRetrieval.shape.test.ts` + `repo.menuShape.test.ts` | Yes. If `decideMenuRefresh` ignored `shapeVersion`, the first call (fresh `fetchedAt`, shape 1) would not call the client and `clientCalls` would be 0, not 1. Small oddity: the fake client flips `currentShapeVersion` itself instead of the fake `upsertMenus` writing it, so the "written as 2" half rests on the pg-mem test. |
| Diagnose ignores the kill switch | `diagnose.test.ts` ("round 4 M1") | No, effectively. `runDiagnose` cannot read the switch (no parameter), so the test cannot fail. The only place a gate could be added is `refreshService.admin.diagnose()`, which is untested with `enabled = false`. |

## 7. Property tags (design.md numbering)

Tags that match: P5, P6, P7 (`menuPricing.prop`), P8, P9, P10, P11, P12 (pure half), P13, P14 (`cacheState`, `resolveTicketPrice`), P15, P18, P19 (livedb header), P20, P21, P24, P30, P35, P36, P47, P38.

Mismatches or gaps:

| File | Tag found | Problem |
|---|---|---|
| `shared/__tests__/money.prop.test.ts:8,47` | `Property 26: Split cents...`, `Property 27: Basis-point...` | design.md P26 is "A Budget read has no side effects"; P27 is "Picker selections become valid Expense and Budget payloads". Task 1.1 says these primitives are the halves of Properties 28 (whole-party split) and 42 (bps). `money.ts:7` header repeats "Properties 26, 27". |
| `api/.../tripBudget/__tests__/sharedMoney.crosscheck.test.ts:8,24` | same 26/27 | same fix |
| `shared/__tests__/tripBudget.prop.test.ts:33` | `Property 48: ...valid line input...` | design.md P48 is "Legal text is present and there is no Budget export". Task 1.1 maps this file to P23 (mapping half), P25 (schema half), P32 (schema half). |
| `refreshService.test.ts`, `diagnose.test.ts` | no `Feature: trip-budget, Property N` tag | tasks 8.3 name P16, P37 (service) and P29 (diagnose). |
| `cacheState.prop.test.ts` | tagged P14, but has zero `fc.assert` calls | an exhaustive cross product, which is acceptable for a finite domain; just not "fast-check". Fine. |

`numRuns`: 9 of the 15 property files set no explicit `numRuns`; fast-check's default is 100 and `vitest.config.ts` has no `configureGlobal` override, so the minimum holds. Optional: make it explicit (`numRuns: 100`) so the requirement is visible.

## 8. Protected mobile files

`git diff --stat` for the nine files (current):

```
BookingSettingsModal.tsx      | 15 ++-     ExpenseFormModal.tsx   | 36 +++++-
PackingItemFormModal.tsx      | 14 ++-     ReceiptReviewModal.tsx | 14 ++-
RefundModal.tsx               | 15 ++-     ResortPickerModal.tsx  | 14 ++-
SettlementModal.tsx           | 15 ++-     TripGuestManagementModal.tsx | 15 ++-
__tests__/TripExpensesScreen.test.tsx | 48 ++++++++
```

I read the hunks. They are `useKeyboardBottomInset` / Android `KeyboardAvoidingView` behaviour changes, a `fillContainer` prop and a restaurant-name description tweak in `ExpenseFormModal`, plus one new test about linking a restaurant. A grep of every added mobile line for `budget`, `MenuItemPicker`, `menuPricing`, `bpsOf`, `splitCents`, `TIP_BEARING`, `priceRef` finds only a comment in `receiptScan.pure.ts`. None of the nine files contains trip-budget work. I cannot prove they are byte-identical to the pre-existing state because I do not have the baseline diff sizes.

`receiptScan.pure.ts` (not one of the nine) now contains `export { extractTierPriceSuggestions };` plus the import from `@dwt/shared`; the old body was removed. That is exactly the requested re-export. The mobile `receiptScan` tests pass.

## 9. `serviceStyle` step and `startingPark`

- Task 11 allows the fallback only if the sample cannot be gathered ("offline, blocked, too few menus"). Gemini's reason ("no Disney live credentials") does not hold. `diningMenuClient.ts` header (lines 9-19): the dining menu endpoint is anonymous, "No Authorization header is required". `GET /catalog/:id` through the existing `menuRetrieval` needs no credentials. Gemini did not state that it tried, or that the network was unreachable. I made no Disney calls.
- Local data cannot answer the question either. Read-only against `dwt`: `experience_menus` has 393 rows and 556 menu objects, with `SELECT DISTINCT m->>'serviceStyle'` returning only `NULL` (556). This is expected: the old projection dropped the field and the dev DB has no `shape_version` column. Menu types present: Dinner 101, Snack 99, Lunch 80, Lunch And Dinner 67, Breakfast 61, All Day 40, Bar – Lounge 38, and so on. So the real style values are still unknown.
- Decision for the user: either (a) run the ~30 restaurant sample (after the migrations are applied locally, with a 1.5 s spacing, then delete any script), or (b) accept the fallback and state the true reason. Note the current constant (`packages/shared/src/enums.ts:445`) is lowercase, `['buffet','family style','prix fixe','table service']`, while the design fixture and real payload use capitalized values like `"Buffet"` (N12). It carries no `[A]` comment yet; the comment was deferred to `suggestions.ts`, which does not exist until task 12.5.
- `startingPark` claim is false. Gemini says `PARK_CODE_TO_NAME` and `PARK_NAME_TO_CODE` in `idMapping.ts` handle both full names and codes like `'mk'`. Neither identifier exists anywhere in the repo (`grep` of all `*.ts`). The real format: `dayTouringHoursSchema.startingPark` is `z.string().optional()` (`shared/src/trips.ts:208`), but the only writer is `setDayPark`, whose body is `parkSchema` (enum `PARKS`), so stored values are canonical full names such as `'Magic Kingdom'`, `'EPCOT'`, `'Hollywood Studios'`, `'Animal Kingdom'` (and, per the enum, `'Typhoon Lagoon'`, `'Blizzard Beach'`, `'Disney Springs'`). Existing tests (`repo.setDayPark.integration.test.ts`) store full names. Codes (`mk`, `ep`) are the ticket park codes in `TICKET_PARK_BY_CANONICAL_PARK`, not what trips store. Any code written against the claimed mapping would be wrong.

## 10. Other adversarial checks

- Stubs and TODOs in new non-test source: none (`TODO|FIXME|XXX|stub|placeholder|not implemented` scan). The hardcoded admin `rowCount: 0` / `windowDays: null` (Finding 2) is the one placeholder-style value.
- Scratch or generated files: none. Untracked files are the intended sources, tests and migrations, `.kiro/specs/trip-budget/`, and `.agents/tasks/trip-budget/` (spec-step artifacts).
- Floats in money paths: ticket and menu paths use string or integer arithmetic. The one float step is `Math.round(withoutTax * 100)` in the menu projection (2-decimal USD, safe). `bpsOf`/`splitCentsEvenly` are integer formulas but do no input validation (non-integer input would yield non-integers); acceptable for now.
- Writes on read paths: `readBook`, `readState` and LL `readBook` are SELECT only. `noteDemand` does its reads and runs after the caller returns.
- BIGINT-as-string handling (`toCents`): not applicable yet; the ticket and LL columns are INT, and `Number(...)` is applied to `price_cents`, `cents`.
- `composeServices.ts:1020-1024`: the `void lightningLaneRepo; void ticketPricesRepo; ...` lines exist only to silence unused-variable errors until the Budget routes arrive. Acceptable for this checkpoint, but it means `noteDemand` has no caller yet. The ticket client, service and LL read repo are built and passed only to `admin`.
- `npm run lint` (`eslint .`) is not part of `npm run verify`, but running ESLint on the new and changed files gives 9 errors, all in new code:

```
lightningLane/__tests__/llRepo.read.test.ts   17:1   consistent-type-imports
ticketPrices/__tests__/refreshService.test.ts 31:7   prefer-const ('mockClock')
ticketPrices/diagnose.ts                      85:31, 92:50, 94:38, 97:14  no-explicit-any
ticketPrices/refreshService.ts                152:39, 327:41, 328:29      no-explicit-any
✖ 9 problems (9 errors, 0 warnings)   EXIT=1
```

I did not establish whether the whole repo's `eslint .` is red at baseline.

- Formatting: `fetchTokenWithMeta` and `getPrices` in `ticketPriceClient.ts` have mangled indentation (cosmetic).

## 11. Behavior to test map as I found it

| Behavior | Covered by | Assertion strength |
|---|---|---|
| Ticket client request shape, WAF/401/404/500/timeout, 400 retry | `ticketPriceClient.test.ts` | Real assertions on URLs, headers, call counts |
| Parse fixture, `subtotal` not `pricePerDay` | `parsePricesResponse.contract.test.ts` | Real |
| Repo SQL: dedupe, 21000 control, claim race, cooldowns, reconcile, prune | `ticketRepo.livedb.test.ts` | Real Postgres |
| Service run orchestration | `refreshService.test.ts` | Partial; gaps in Finding 5 |
| Diagnose two-call, no token, refusals | `diagnose.test.ts` | Real except kill-switch independence |
| Admin routes (401, CSRF 403, escaping, diagnose refusals, block) | `ticketPriceRoutes.test.ts` | Real, fake port only |
| LL persistence, single-pass join, non-destructive | `llRepo.livedb.test.ts`, `samplingService.ll.livedb.test.ts` | Real Postgres, strong |
| LL extract/typical/lookup | prop and unit tests | Real |
| Menu shape and projection | `menuRetrieval.shape`, `repo.menuShape`, `menu.projection.prop`, `diningMenuClient.prices` | Real |
| Permissions matrix | `permissions.budget.test.ts` | Real |
| Dispositions and purge | `dispositions.test.ts`, `budget.purge.test.ts` | Real, but no two-deleted-accounts case |
| Config defaults and validation | `config.ticketPrices.test.ts`, `config.lightningLane.test.ts` | Real |

## 12. What I could not verify

- Real Disney behavior (Akamai from Render, start-date timezone basis, Florida resident lengths, Single Pass id mapping). These are the deploy-time [A] items, and I made no network calls.
- Zod schemas in `packages/shared/src/tripBudget.ts` and the migration DDL were not diffed line by line against design.md. I only confirmed every named export exists and the shared and migration test suites pass.
- Semantics of `resolveTicketPrice`, `cacheState`, `refreshPlanner` and `typicalPrice` beyond reading their tests and running them.
- Whether the nine protected mobile files match their pre-Gemini state (no baseline sizes).
- Whether `eslint .` was already red before this work.
- Whether Gemini attempted the `serviceStyle` sample at all.

## 13. Temporary artifacts

I created `%TEMP%\cp11-verify-api.txt`, `cp11-dbcheck.cjs`, `cp11-menucheck.cjs`, `cp11-dblist.cjs` and `cp11-runnow.mts` outside the repo, and deleted them afterwards. The DB scripts only ran SELECTs inside `BEGIN READ ONLY ... ROLLBACK`. `cp11-runnow.mts` used an in-memory fake repo and client, with no network and no database. The only repo change from this review is this report file.

Recommended order of fixes: R1, R2 and R4 to R6 in `refreshService.ts` / `repo.ts` / `diagnose.ts` first (each is a few lines plus a test), then R3 tests, then R7 to R9 housekeeping and the report corrections. Re-run `npm run verify` once at the end.

**VERDICT: CHANGES_REQUESTED**
