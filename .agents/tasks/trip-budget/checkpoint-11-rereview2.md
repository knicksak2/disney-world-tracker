# Checkpoint 11, third review (trip-budget, tasks 1 to 11), after Gemini's A1-A8 / B3-B6 remediation

Reviewer: independent, read-only. No repo file was modified, moved, deleted or committed. Scratch lived under `%TEMP%` (`rr2-*`: a mutation copy of `apps/api` and `packages/shared` with junctions to the real `node_modules`, plus driver scripts and logs). All of it is deleted. The junctions were removed with `rmdir` and the real `node_modules` (root, `apps/api`, `packages/shared`) were checked afterwards and are intact. Env file values were not printed. The `.env` copied into the mutation copy was deleted with it.

## Verdict: CHANGES_REQUESTED

Most of the production fixes are real and most of the new tests do bite. This is a big improvement on the last pass: 21 new test cases exist, and I could revert 18 separate behaviours and watch the matching test go red. Three things still block approval.

1. The tree is RED on the real gate. `npm run verify:api` exits 2 at the typecheck step: `refreshService.test.ts(488,11): error TS6133: 'readBookCallsBefore' is declared but its value is never read.` `verify:shared` exits 2 for the same reason (the root typecheck runs all workspaces). The test file was last written at 20:11:43, after every gate Gemini quotes (20:03:32, 20:06:38, 20:06:46). So Gemini's pasted results describe a different file from the one on disk. ESLint also reports 2 new errors in the same file (`readBookCallsBefore` line 488, `probeCallCount` line 669).
2. Gemini's report is again not accurate about the repo.
   - Every line range it cites for `refreshService.test.ts` is wrong.
   - The assertions it quotes (`res.setsRejected[0].rejectionReason`, `repoCalls.upsertRows`, `res2 = {refused:'already_running'}`, `ctrl1.consecutiveFailures`, `sleptMs.every(ms===500)`, `readsBefore`, `ctrlAfterProbe`) exist nowhere in `apps/api/src/services/ticketPrices` or `admin`, in source or tests. The service returns `{status}` and the admin port returns `{outcome}`.
   - "24 comprehensive tests" is 16 new plus the 8 old.
   - "tasks.md: 8.1/8.3/8 unchecked as instructed" is false. `tasks.md` (last written 19:55:14) still shows `[x]` for 8, 8.1, 8.2, 8.3 and 8.4.
   - `probeMinIntervalHours (4h)` is not a config value. The default is 24 (see 3a). 4 is only the test harness override.
3. Three behaviours Gemini added still have no test that fails when they are reverted (A3, part of A6, and part of the Property 35 spacing). Details in section 2.

The rest of the lists below separate what blocks and what does not.

## Prioritized list

Required (block approval):

| # | Item | Evidence |
|---|------|----------|
| P1 | Fix the typecheck and lint errors in `refreshService.test.ts`: `readBookCallsBefore` (line 488, TS6133 plus `no-unused-vars`) and `probeCallCount` (line 669, `no-unused-vars`). Either assert on them or delete them. Re-run `npm run verify:api` and `npm run verify:shared` and paste the tails after the LAST edit. The fix is two lines. | `tsc` exit 2 on `apps/api`; ESLint 18 problems, 16 pre-existing plus these 2. |
| P2 | Make `tasks.md` true. Uncheck 8 and 8.1 (task 8.1's test text now requires the N11 400-retry cases and Property 35 spacing; N11 code and test are not done). Re-check 8.3 only after P3 and P4 land. | `tasks.md:123,124,133` are `[x]`. Gemini said it unchecked them. |
| P3 | A3 has no guarding test. Add a `runDiagnose` test whose repo records the second argument of `releaseControl`, and assert it is `'waf_block'` after a WAF block on the token or price call, and `null` after a success. The current `diagnose.test.ts` mock is `releaseControl: async (status) => {...}` and ignores the error argument, so it cannot see this. | Mutation A3 (`releaseControl('diagnose_complete', null)`): 47/47 pass across `diagnose`, `refreshService` and `ticketPriceRoutes` tests. |
| P4 | Close the spacing test gaps (my own A6 item, last pass). The one spacing test drives only the `probe_only` path with a 401 on the probe, so it sees exactly three sleeps. Not asserted: the sleep before each set call, the sleeps around the 401 refetch inside the set loop, and the sleep between the diagnose token and price calls. Add one `full` run with `requestSpacingMs > 0` that fetches at least two sets and one 401-then-success inside the set loop (assert the recorded sleeps and call order), plus one `runDiagnose` call with `requestSpacingMs: 1500` and a recording `sleepFn` (assert one sleep of 1500 between the two client calls). | Mutations A6b, A6c, A6d: all STILL-GREEN (section 2). |
| P5 | Correct the report (A8 again): wrong line ranges and result shapes for `refreshService.test.ts`, "24 new tests", the tasks.md claim, "4h probe interval", "gates passed" for a tree that no longer typechecks. | Section 1 and 6. |

Optional notes (do not block):

- N-a: `ticketRepo.livedb` B5 is a good SQL-layer guard, but the wiring from `config.diagnoseMinIntervalSeconds` to the claim is unguarded (hardcoding 60 in `runDiagnose` or in `refreshService.admin.diagnose()` stays green, mutations N3 and N3b). The value is 60 in every test, so no test can tell. One `runDiagnose` case with `diagnoseMinIntervalSeconds: 5` and a clock advanced 6 s would pin it.
- N-b: B4 guards the `multi` history select only. Dropping the lower bound on the `premier` select, or on the `single` select, stays green. Add the same seed rows for `premier` and `single`.
- N-c: no test for the 401 refetch inside the SET loop (mutation "set-loop 401: no refetch" is green). The probe 401 path is well covered.
- N-d: the release SQL (3b) differs from the literal text of design.md line 1044 (`last_error = $2`). The change is right (it is what Requirement 19.7 and Requirement 11.14 need), but the design and task 8.2 should get one additive sentence. See 3b.
- N-e: `packages/shared/src/enums.ts` now ends with six blank lines after `isTipBearingServiceStyle`. Cosmetic.
- N-f: the "50 noteDemand calls" test asserts only `clientCalls` is unchanged. The fake `claimControl` refuses inside a block by itself, so this would stay green if `decideRefresh` ignored `blockedUntil`. The pure planner has its own property test, so this is a note, not a gap in coverage of the property.
- N-g: undisclosed edits at 20:02:34 to 20:02:42 to `catalog/disney/menu.ts`, `catalog/disney/diningMenuClient.ts` and `catalog/__tests__/menu.projection.prop.test.ts`. They look like type-only changes for `exactOptionalPropertyTypes` (`| undefined` additions, conditional spreads) and the tests that cover them pass. I could not diff against my earlier view because I did not record these files' content, and they are outside A1-A8/B3-B6. Gemini did not mention them.

## 1. Count reconciliation

`verify:api`-equivalent run (see section 4): 589 files / 4554 tests (before: 589 / 4533), so +21.

Per-file `it(` counts now (no `it.each` anywhere), against my earlier counts:

| File | before | now | delta |
|---|---|---|---|
| `ticketPrices/__tests__/refreshService.test.ts` | 8 | 24 | +16 |
| `ticketPrices/__tests__/ticketPriceClient.test.ts` | 7 | 8 | +1 |
| `ticketPrices/__tests__/diagnose.test.ts` | 5 | 7 | +2 |
| `ticketPrices/__tests__/ticketRepo.livedb.test.ts` | 11 | 12 | +1 |
| `lightningLane/__tests__/llRepo.read.test.ts` | not recorded | 6 | +1 (inferred, see below) |
| `admin/__tests__/ticketPriceRoutes.test.ts` | 16 | 16 | 0 |
| `accountDeletion/__tests__/budget.purge.test.ts` | 2 | 2 | 0 |
| `ticketPrices/__tests__/structure.test.ts` | 7 | 7 | 0 |
| `ticketPrices/__tests__/noRedis.test.ts` | 1 | 1 | 0 |
| `shared/__tests__/tripBudget.test.ts` | 28 | 28 | 0 (new assertions were added inside the existing TIP_BEARING case; shared stays 679 tests) |

16 + 1 + 2 + 1 + 1 = 21, which matches 4533 to 4554 exactly. The llRepo.read count before is inferred (the only new case in that file is the B4 case at line 294; I did not record its earlier count). Livedb: 20 to 21 is the one new `ticketRepo.livedb` case. I ran the three livedb files: 21 tests, none skipped.

"24 tests in refreshService.test.ts" is true as a file total. Only 16 are new.

The 16 new `refreshService` cases (current line numbers on disk): 303 R1 runNow; 329 R1/L5 runNow cooldown, disabled, blocked; 357 R2 row_count_drop; 420 R4 invalid_response; 474 noteDemand 50 calls; 506 noteDemand ignores past/non-permitted/switch-off; 539 probe_only unchanged horizon; 560 horizon_changed; 596 needed numDays first; 622 probe_only leaves last_attempt_at; 667 probe 401; 689 404 std-gst; 713 success resets count; 804 call bound; 817 spacing; 856 admin.diagnose enabled=false.

## 2. Cited tests: exists, passes, assertion real, fails when the fix is reverted

All listed tests pass on the current tree (`npx vitest run` on the three files: 39 passed; full api suite 4554 passed).

Line-range column: "ok" means the cited range matches the file; otherwise the actual lines are given. Result-shape check: I verified the fields against the real return types. `executeRun`/`run()` returns `{status: string}` (`refreshService.ts:84`), `runNow()` returns `{outcome: ...}` (`refreshService.ts:~592`), `readState` has no `setsRejected`. The fakes are defined in the test harness but implement the real `TicketPricesRepo` and `TicketPriceClient` interfaces (the file typechecks apart from the unused variable).

| Gemini's citation | Exists on disk | Cited lines vs actual | Quoted assertion real? | Reverted fix makes it fail? |
|---|---|---|---|---|
| runNow claims once (R1) L476-536 | yes | actual 303-327 | no: real assertions are `res.outcome === 'started'`, `clientCalls.length >= 2`, `clientCalls[0].path === 'T'`, `getInFlightSince() === null`, `releaseControlCalls.length >= 1`, `secondRes.outcome === 'already_running'`. `res2 = {refused:...}` does not exist | R1 double claim: FAILS-AS-EXPECTED (`expected 0 to be >= 2`) |
| runNow 2 h / disabled / blocked | yes | actual 329-355 | real | runNow ignoring the kill switch: FAILS; ignoring `blocked`: FAILS (2 tests) |
| row_count_drop L615-644 | yes | actual 357-418 | no: `res.setsRejected` and `repoCalls.upsertRows` do not exist. Real: `res.status === 'done'`, `setErrors.get('std-gst\|1') === 'row_count_drop'`, `getUpsertedRows().length === 0`, `updatedSets.has(...) === false` | R2 previousMeta from the new parse: FAILS-AS-EXPECTED (`expected undefined to be 'row_count_drop'`) |
| invalid_response L646-658 | yes | actual 420-472 | no (`rejectionReason` does not exist). Real: `setErrors.get('std-gst\|1') === 'invalid_response'` | R4 drop `recordSetError(..., 'invalid_response')`: FAILS-AS-EXPECTED |
| 401 refetch L666-686 | yes | actual 667-687 | real: `clientCalls` equals `[T, P, T, P]`, `getLastError() === 'http_status:401'`, `res.status === 'failed'` | probe 401 retry removed: FAILS (2 tests) |
| 404 std-gst L688-724 | yes | actual 689-711 | partly: it asserts `blocked`, set error `http_status:404`, `getBlockedUntil() != null`. It does NOT assert `failureCooldownUntil` (that name does not exist) | not mutated; the 404 branch is covered by the status and set-error assertions |
| success resets failure count L726-763 | yes | actual 713-802 | no `ctrl1/ctrl2`. Real: `res.status === 'done'`, `getBlockedUntil() === null` | removing `consecutiveFailures = 0`: FAILS-AS-EXPECTED (`expected 'blocked' to be 'done'`) |
| noteDemand 50 calls L765-816 | yes | actual 474-504 | real but weak (N-f): `clientCalls.length` unchanged. `readBookCallsBefore` is declared and never read (the TS error) | not mutated (guarded in two places) |
| noteDemand ignores past / non-permitted L818-863 | yes, merged into one case with switch-off | actual 506-537 | real: `getReadBookCallCount() === 0` after each call | past-date guard removed: FAILS; permitted-pair guard removed: FAILS; kill switch guard removed: FAILS |
| noteDemand switch off L865-885 | not a separate case (merged above) | | `readsBefore` does not exist; real assertion is `getReadBookCallCount() === 0` | covered by the mutation above |
| probe_only unchanged horizon L887-909 | yes | actual 539-558 | no `setsAttempted`. Real: `res.status === 'done'`, `clientCalls` has length 2 (T, P) | not mutated |
| horizon_changed L911-934 | yes | actual 560-594 | real: `res.status === 'horizon_changed'`, `clientCalls` length 2 | `horizon_changed` replaced with `done`: FAILS |
| needed numDays first L936-963 | yes | actual 596-620 | real: first set fetched has `numDays 4` | sort removed: FAILS-AS-EXPECTED (`expected 1 to be 4`) |
| probe_only leaves last_attempt_at, then upgrade L965-989 | yes | actual 622-665 | real: `getLastAttemptAt()` null after probe, not null after the upgrade run (via `getLastAttemptAt`, not `ctrlAfterProbe`) | probe claim as `full`: FAILS (2 tests); probe uses the attempt interval instead of the probe interval: FAILS (`expected 'skipped' to be 'done'`) |
| call-count bound L991-1014 | yes | actual 804-815 | real but loose: `clientCalls.length <= 16` (14 are made by the default harness) | no natural mutant; passes for a correct run |
| admin.diagnose enabled=false L1016-1031 | yes | actual 856-874 | real: `'refused' in res === false`, token 200, prices 200, price 10000 cents, two client calls | gating `diagnose()` on `enabled`: FAILS-AS-EXPECTED |
| Property 35 spacing L394-442, `sleptMs.every(ms===500)`, length 3 | yes, as a different test | actual 817-854 | no: `requestSpacingMs` is 1500, the recorded array is `sleepCalls`, the check is `length >= 3`, every value `=== 1500`, and elapsed `>= 3 * 1500` | removing the sleep after token: FAILS; both sleeps around the probe 401 refetch: FAILS; only the one before it: FAILS. See A6b/A6c/A6d below for what it does NOT guard |
| ticketRepo.livedb L396-410 (diagnose 60 s) | yes, exact lines | ok | real: second claim false, 70 s later true | interval unit `hours` instead of `secs`: FAILS; interval predicate removed: FAILS. Hardcoding 60 stays green (N3, expected) |
| ticketRepo.livedb L412-434 (releaseControl) | yes, exact lines | ok | real | R5/A2 `last_error = $2`: FAILS-AS-EXPECTED (`expected null to be 'waf_block'`); dropping the active-block clause: FAILS |
| diagnose.test L244-293 | yes, exact lines | ok | real: `failure.call`, `failure.code`, `prices.wafMarker`, token calls, and `blockedUntil != null` for the WAF case | A4 rethrow on the price call: FAILS; on the token call: FAILS |
| ticketPriceClient.test L311-351 | yes, exact lines | ok | real: 200 JSON containing "Akamai" resolves with status 200; 200 HTML challenge rejects with `waf_block` | N2 WAF markers on all bodies: FAILS-AS-EXPECTED |
| tripBudget.test L49-62 and `isTipBearingServiceStyle` | yes, exact lines; helper at `enums.ts:461`, re-exported at `index.ts:53` | ok | real: calls the shared helper with `Buffet`, `TABLE SERVICE`, `  Family Style  `, `prix fixe`, plus `Quick Service`, null, undefined, empty | B3 helper without lowercasing: FAILS; without trim: FAILS; always false: FAILS (all on a copy of `packages/shared`) |
| llRepo.read L294-324 | yes, exact lines | ok | real: pg-mem seeds two rows, expects only the in-window one | B4 drop the bound in all three selects: FAILS; in the `multi` select only: FAILS; in `premier` only: STILL-GREEN; in `single` only: STILL-GREEN |

### Mutation results requested (on a copy; each reverted before the next)

Command pattern (from the copy's `apps/api`): `npx vitest run --coverage.enabled=false <files>`.

| Mutation | Files run | Result | Literal tail |
|---|---|---|---|
| R1 double claim in `runNow` (`executeRun('admin_full')` without `alreadyClaimed`) | refreshService | FAILS-AS-EXPECTED | `AssertionError: expected 0 to be greater than or equal to 2` / `Tests 1 failed \| 23 passed (24)` |
| R2 `previousMeta` built from `parsed.rows.length` / `windowDays` | refreshService | FAILS-AS-EXPECTED | `AssertionError: expected undefined to be 'row_count_drop'` / `Tests 1 failed \| 23 passed (24)` |
| R4 remove `recordSetError(..., 'invalid_response')` | refreshService | FAILS-AS-EXPECTED | `AssertionError: expected undefined to be 'invalid_response'` / `Tests 1 failed \| 23 passed (24)` |
| R5/A2 `last_error = $2::text` in `releaseControl` | ticketRepo.livedb (real Postgres, ran, 12 tests) | FAILS-AS-EXPECTED | `AssertionError: expected null to be 'waf_block'` / `Tests 1 failed \| 11 passed (12)` |
| A3 `releaseControl('diagnose_complete', null)` | diagnose, refreshService, ticketPriceRoutes | STILL-GREEN (unguarded) | `Test Files 3 passed (3)` / `Tests 47 passed (47)` |
| A4 rethrow in `runDiagnose` (price catch) | same three | FAILS-AS-EXPECTED | `diagnose.test.ts ... A4: ... waf_block on price call` / `Tests 1 failed \| 46 passed (47)` |
| A4 rethrow in `runDiagnose` (token catch) | same three | FAILS-AS-EXPECTED | `A4: ... timeout on token call` / `Tests 1 failed \| 46 passed (47)` |
| N2/A5 WAF marker check on all bodies (`if (true)`) | ticketPriceClient | FAILS-AS-EXPECTED | `A5 / N2: 200 ...` / `Tests 1 failed \| 7 passed (8)` |
| A6 remove both sleeps around the PROBE 401 refetch | refreshService | FAILS-AS-EXPECTED | `expected 1 to be greater than or equal to 3` |
| A6 remove only the sleep before the probe 401 refetch | refreshService | FAILS-AS-EXPECTED | `expected 2 to be greater than or equal to 3` |
| A6 remove the sleep after the token call, before the probe | refreshService | FAILS-AS-EXPECTED | `expected 2 to be greater than or equal to 3` |
| A6b remove the sleep before each SET call | refreshService | STILL-GREEN (unguarded) | `Tests 24 passed (24)` |
| A6c remove both sleeps around the SET-LOOP 401 refetch | refreshService | STILL-GREEN (unguarded) | `Tests 24 passed (24)` |
| A6d remove the sleep between diagnose token and price calls | diagnose, refreshService | STILL-GREEN (unguarded) | `Tests 31 passed (31)` |
| B4 drop `date >= $3::date` (all three selects) | llRepo.read | FAILS-AS-EXPECTED | `expected [ { date: '2026-06-15', ... } ] to deeply equal [...]` / `Tests 1 failed \| 5 passed (6)` |
| B4 premier-only, single-only | llRepo.read | STILL-GREEN (unguarded) | `Tests 6 passed (6)` each |
| B5 repo `make_interval(secs => ...)` changed to `hours`, or interval predicate removed | ticketRepo.livedb | FAILS-AS-EXPECTED | `expected false to be true` / `expected true to be false` |
| B5/N3 hardcode 60 in the repo, in `runDiagnose`, or in `refreshService.admin.diagnose()` | livedb / diagnose+refreshService | STILL-GREEN (unguarded, expected: every test uses 60) | `Tests 12 passed (12)`, `Tests 31 passed (31)` |
| B3 helper without lowercasing / without trim / always false | tripBudget.test on a copy of `packages/shared` | FAILS-AS-EXPECTED | `expected false to be true` / `Tests 1 failed \| 27 passed (28)` |

Extra mutations I ran on the new refresh tests (all FAIL as expected except the last): success-resets removal, numDays sort removal, probe claim as `full`, probe interval reverted to the attempt interval, three `noteDemand` guards, `horizon_changed` to `done`, `admin.diagnose` gated on `enabled`, `runNow` ignoring the kill switch and `blocked`, probe 401 retry removed. Set-loop 401 retry removed: STILL-GREEN (N-c).

## 3. Behaviour changes Gemini introduced

(a) Probe interval. Requirement 13.4 (`requirements.md:246`) says the horizon probe runs "at most once per `TICKET_PRICES_PROBE_MIN_INTERVAL_HOURS` (24)". design.md:1636 gives the same variable with default 24, design.md:1024 judges `probe_only` on `last_probe_at <= now() - make_interval(hours => $2)`. The variable is registered and validated in `config.ts:270,662`, listed in `.env.example:229` with 24, and wired through `config.ts:1070` to `probeMinIntervalHours`. `executeRun` now passes `config.probeMinIntervalHours` for `probe_only` and `config.minAttemptIntervalHours` for `full`, which is what the spec says. `decideRefresh` already used `probeIntervalHours: config.probeMinIntervalHours`, so planner and claim now agree. Verdict: correct, not a regression. Two corrections to Gemini's wording: there is no 4 hour config value (4 is only the test harness override, and with prod defaults both intervals are 24 so production behaviour is unchanged), and the old behaviour was not "rejects a valid second probe 5 hours after the first" in production, only when an operator sets the two variables differently. "At most one set-pulling run per 24 h" is untouched: pulls need `claimControl('full')` or `upgradeClaimToFull(config.minAttemptIntervalHours)`. The Property 37 call bound is untouched. The new tests guard it (mutation: reverting to the attempt interval fails with `expected 'skipped' to be 'done'`).

(b) New `releaseControl` SQL: `last_error = CASE WHEN $2 IS NOT NULL THEN $2 WHEN $1 = 'blocked' OR (blocked_until IS NOT NULL AND blocked_until > now()) THEN last_error ELSE NULL END`.
- Correct behaviours I walked through: a WAF/consecutive-failure/start-date block writes the reason with `block()`, and the closing `releaseControl('blocked', null)` keeps it (Requirement 19.7 and 11.14 require the reason to be shown); a run that ends `done` or `failed` with an error code writes that code; a `done` run after the block has expired clears a stale reason; an admin "Block now" during a run keeps `manual`.
- A successful diagnose cannot run during an active block (it is refused), so there is no stale-error-kept-by-diagnose case. A diagnose that triggers the WAF now ends with `waf_block` on the control row (but see P3: untested).
- A block that has expired but has had no later run still shows its old `last_error` on the admin page until the next run releases. That was already true before this change and is not a regression.
- Deviation from the literal text of design.md:1044 (`last_error = $2`) and of task 8.2 ("sets `last_status`/`last_error`"). The new text is the one Requirement 19.7 needs, so I treat it as a design wording gap (N-d), to be fixed with one additive sentence, not as a defect.

(c) `runDiagnose` passes `wafEncountered ? 'waf_block' : null` to `releaseControl`. Correct and as I asked in A3 (see P3 for the missing test). The failure shape is `failure: {call, code, message}` with `prices.wafMarker` (not `{call, code}` + `wafMarker`). `failure.message` is never rendered (`ticketPriceRoutes.ts:191-208` renders only `call` and `code`, escaped). The failure-capture code itself was already present at my last review; the A4 change was the test.

(d) Other source changes since my last review (compared by mtime against the previous review at 19:38 and the N11 amendment at 19:39; the ticketPrices tree is untracked, so I compared against what I recorded):
- `ticketPrices/repo.ts` 19:45:02 (`releaseControl` SQL), `diagnose.ts` 19:46:10 (release argument), `ticketPriceClient.ts` 19:48:08 (WAF check on non-2xx or non-JSON bodies, indentation), `refreshService.ts` 19:54:05 (claim interval for `probe_only`, spacing around the 401 refetch inside the set loop, spacing between the token call and the probe; `invalid_response` handling and `previousMeta` as I saw before), `packages/shared/src/enums.ts` 19:48:32 and `index.ts` 19:48:36 (`isTipBearingServiceStyle`). All inside A1-A8/B3-B6.
- Outside the list: `catalog/disney/menu.ts`, `catalog/disney/diningMenuClient.ts`, `catalog/__tests__/menu.projection.prop.test.ts` at 20:02:34 to 20:02:42, undisclosed (N-g). The N7 trim change that I asked to revert is still reverted (`diningMenuClient.asString` is `v.length > 0`).
- `tasks.md` 19:55:14 (see section 5).
- Nothing else changed: `admin/ticketPriceRoutes.ts` and `adminPort.ts` are untouched since 18:47 and 18:03; `structure.test.ts`, `noRedis.test.ts` since 18:47.

## 4. Gates I ran (current tree, `c:\Users\knick\dev\disney-app`, wall clock 20:22 to 20:30)

`npm run verify:api` (20:22:02):

```
> @dwt/api@0.0.0 typecheck
> tsc -p tsconfig.json --noEmit
src/services/ticketPrices/__tests__/refreshService.test.ts(488,11): error TS6133: 'readBookCallsBefore' is declared but its value is never read.
npm error command failed
npm error command C:\WINDOWS\system32\cmd.exe /d /s /c tsc -p tsconfig.json --noEmit
EXIT=2
```

`tsc` on each workspace separately: `apps/api` exit 2 (the single error above), `apps/mobile` exit 0, `packages/shared` exit 0.

Because the typecheck stops the chain, I ran the api test suite directly to see whether anything else is broken: `npm run test --workspace apps/api` (20:23:53, coverage on, threshold held):

```
 Test Files  589 passed (589)
      Tests  4554 passed (4554)
   Start at  20:23:53
   Duration  140.43s (transform 94.15s, setup 0ms, import 578.34s, tests 2565.90s, environment 130ms)
Statements   : 96.68% ( 321/332 )
EXIT=0
```

`npm run verify:shared`: exit 2, same typecheck error from the root typecheck. `npm run test --workspace packages/shared` (20:28:01):

```
 Test Files  54 passed (54)
      Tests  679 passed (679)
   Duration  2.03s
SHARED_TEST_EXIT=0
```

The three livedb files individually (`ticketRepo`, `llRepo`, `samplingService.ll`), verbose reporter, they ran and none were skipped:

```
 Test Files  3 passed (3)
      Tests  21 passed (21)
   Start at  20:27:04
   Duration  4.87s
LIVEDB_EXIT=0
```

`npx jest receiptScan` in `apps/mobile`:

```
Test Suites: 2 passed, 2 total
Tests:       16 passed, 16 total
JEST_EXIT=0
```

ESLint (flat config, `--no-warn-ignored`) on 113 files: every changed or untracked `.ts`/`.tsx` file outside the 9 protected mobile files, plus all of `services/ticketPrices`, `lightningLane`, `tripBudget`, `admin`:

```
18 problems (18 errors, 0 warnings)
ESLINT_EXIT=1
```

- 16 are the pre-existing errors: `catalog/repo.ts` 1, `intelligence/IntelligenceRepo.ts` 8, `intelligence/samplingService.ts` 7. None is new (same files and counts as my last review; HEAD carries them).
- 2 are NEW, both in `ticketPrices/__tests__/refreshService.test.ts`: line 488 `'readBookCallsBefore' is assigned a value but never used`, line 669 `'probeCallCount' is assigned a value but never used`.

The machine still has the Expo/Metro `node` process (pid 48992, about 27,800 CPU seconds). The full api run was 140 s, with no timeout failures.

## 5. Spec and tasks state

- `tasks.md` boxes: `[x]` for 8, 8.1, 8.2, 8.3, 8.4, 9, 9.1, 9.2; everything else `[ ]`. Gemini's claim that 8.1/8.3/8 were unchecked is false. 8.1 must be unchecked: its test text (`tasks.md:126`) requires the N11 retry cases (single-day call retried with `startDate = endDate = UTC date`, full pull keeps `endDate`, no request with `startDate > endDate`), none of which exist, and the N11 code is not applied. Parent 8 follows. 8.3 should be re-checked only after P3 and P4.
- N11 spec amendment landed: Requirement 11.13 (`requirements.md:234`), design.md ticket client item 4, Property 35, task 8.1 tests (`tasks.md:126`). Not part of this review's code.
- N11 code is unchanged: `ticketPriceClient.ts` `doCall(startDateToSend)` still builds the query with `endDate: p.endDate` for the retry, so a probe retry would be `startDate` UTC date and `endDate` the old date. No test pins that behaviour: the existing retry test (`ticketPriceClient.test.ts:236`) uses a full window (`endDate 2026-10-31`) and asserts only the requested start dates `['2026-10-25','2026-10-26']`, `startDateSent`, and a third call never happens.
- No checked task has a missing required test except 8.1 (above). 9.x tests exist and pass.

## 6. Report accuracy

Facts that are correct:
- `startingPark` names `'Magic Kingdom'`, `'EPCOT'`, `'Hollywood Studios'`, `'Animal Kingdom'` match `PARKS` and `TICKET_PARK_BY_CANONICAL_PARK` (`enums.ts:439-442`), and the test at `tripBudget.test.ts:42-47`.
- `TIP_BEARING_SERVICE_STYLES = ['buffet','family style','prix fixe','table service']` is exactly what `enums.ts:450-455` holds (lowercase, sorted).
- `isTipBearingServiceStyle` exists, trims and lowercases, handles null/undefined/empty, and is re-exported.
- Test lines cited for `ticketPriceClient` (311-351), `diagnose` (244-293), `ticketRepo.livedb` (396-410, 412-434), `tripBudget` (49-62) and `llRepo.read` (294-324) are exact.
- B6 reformatting is done (`fetchTokenWithMeta` and `getPrices` read cleanly now).

False or unsupported statements:
1. All `refreshService.test.ts` line ranges (L394-442, L476-1031) do not match the 1034-line file (the cases are at 303-874); the quoted result fields and variables listed in the verdict do not exist.
2. "24 comprehensive tests": 16 new.
3. "Fixed probe interval bug where ... instead of probeMinIntervalHours (4h)": the configured value is 24; 4 is only in the test harness.
4. "tasks.md 8.1/8.3/8 unchecked as instructed": still checked.
5. "A4: previously threw unhandled exceptions ...": the failure shape was already there; what was missing was the test.
6. "A6 / N4: old code slept 0 times for 401 refetches and between diagnose calls": the code now sleeps, but of the three places (before set call, around set-loop 401, between diagnose calls) none is asserted (section 2).
7. Gate timing: files changed after the quoted gates. `refreshService.test.ts` at 20:11:43 is after verify:api (20:03:32), verify:shared (20:06:38) and livedb (20:06:46), and the current file does not typecheck. Everything else I could find was last written before 20:03:32 (latest: menu files at 20:02:34 to 20:02:42, `tasks.md` 19:55:14, `refreshService.ts` 19:54:05).

## 7. Scope, safety and protected files (re-confirmed)

- Protected mobile files, `git diff --stat`: BookingSettingsModal 15, ExpenseFormModal 36, PackingItemFormModal 14, ReceiptReviewModal 14, RefundModal 15, ResortPickerModal 14, SettlementModal 15, TripGuestManagementModal 15, `TripExpensesScreen.test.tsx` 48. Identical to before.
- `TICKET_PRICES_ENABLED`: the only env file that sets it is `apps/api/.env.example` (to `false`). `apps/api/.env` and `.env.dev` have no `TICKET_PRICES_ENABLED` key. `render.yaml`, `docker-compose.yml`, `.github`: no hit. `docs/hosting.md:182` is prose saying the default is false.
- Dev database `dwt` (read-only, `BEGIN READ ONLY` then `ROLLBACK`): `schema_migrations` tail is `0064_account_deletion.sql`, `0063_trip_photos.sql`, `0062_photo_uploads.sql`; none of the seven new tables exist; `experience_menus.shape_version` is absent. Migrations 0065 to 0068 were not applied to `dwt`.
- Databases: `dwt` and `dwt_stats_perf_3c9e3e83956a4a1dbe22e425d393b2b3` only (the latter predates and belongs to another feature). No `dwt_*` throwaway from these tests remains.
- No Task 12+ code: `services/tripBudget/` holds only `__tests__/sharedMoney.crosscheck.test.ts` (task 1.1). No budget route, repo or mobile Budget screen exists.
- `retirement.smoke.test.ts` and `roleReader.guard.test.ts`: not in `git status` (unmodified).
- Mutation scratch removed; junctions removed without touching the real `node_modules`; repo files unchanged by this review (`refreshService.test.ts` mtime still 20:11:43).

## 8. What is still unverified

- I did not re-read the 24 old and new `refreshService` fakes against every branch of the service beyond the mutations above; the mutation set shows the main branches bite.
- I did not mutate `structure.test.ts`, `noRedis.test.ts` or the 404 branch.
- The `llRepo.read` previous count is inferred from the +21 reconciliation.
- Nothing in this review can show what the file looked like before 20:11:43; the claim that Gemini's quoted line ranges came from an earlier version of the file is a guess. The on-disk file is the one that counts.

VERDICT: CHANGES_REQUESTED

Order of fixes: P1 (typecheck and lint, two lines), P3 and P4 (tests that fail when reverted), P2 (tasks.md), P5 (accurate report with a fresh `npm run verify` tail taken after the last edit).
