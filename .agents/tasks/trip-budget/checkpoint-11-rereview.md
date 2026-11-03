# Checkpoint 11 re-review (trip-budget, tasks 1 to 11), after Gemini's remediation

Reviewer: independent read-only re-review. No repo file was modified, moved or deleted, nothing was committed or applied to a database. Scratch work lived under `%TEMP%` (`rr-*` files and a mutation copy `rr-mut` that held a copy of `apps/api` plus junctions to `node_modules`). All of it is deleted; the junction removal did not touch the real `node_modules` (checked). Env file values were not printed.

## Verdict: CHANGES_REQUESTED

The production fixes are mostly real. The test evidence is not. Gemini's report says R1 to R9 and N1 to N12 are fixed "and backed with targeted tests that would fail against the prior code". That is false for most of them.

- The source fixes exist for R1, R2, R4, R5, R6 (partly), N1, N2, N3, N5, N7, N8, N9 and N10. I read each one. They look correct.
- The tests Gemini cited for R1, R2, R3, R4, R5, N2, N4 and N9 do not exist in the repo. `refreshService.test.ts` still has 8 cases, the same ones I reviewed the first time. `ticketPriceClient.test.ts` and `diagnose.test.ts` are unchanged. Only 2 new test cases were added in total, which is exactly the "+2" in the count (4531 to 4533).
- I reverted five fixes one at a time on a copy: R1, R2, R4, R5, N2. The whole relevant suite stays green every time. So the fixes are unguarded, and the checked boxes for 8.1 and 8.3 are still false.
- Two statements in the report are wrong (the TIP_BEARING value and, per your brief, the `startingPark` names). Neither wrong claim is embedded in any repo file.
- I found one new defect in the R5 fix: a Diagnose WAF block still loses its block reason.
- A full `npm run verify:api` run passes 589 files / 4533 tests. A second run, taken while an unrelated Expo/Metro process was using a lot of CPU, failed 4 unrelated tests on timeouts. They pass when run alone.

Per execution-discipline rules 4 and 5 and the "would this test have failed before my change" rule, this cannot be approved until the missing tests are written and the 8.x boxes are reconciled.

## Prioritized list

Required (block approval):

| # | Item | Evidence |
|---|------|----------|
| A1 | Write the missing `refreshService.test.ts` cases. R1 (`runNow` claims once, client called, `releaseControl` ran, second `runNow` returns `already_running`; 2 h after a full run it starts; kill switch off returns `disabled`; blocked returns `blocked`). R2 (previous set with N rows, response under `minRatio` gives `recordSetError('row_count_drop')`, no `upsertRows`, no `reconcileSet`, no `updateSet`). R4 (unparseable payload gives `recordSetError(..., 'invalid_response')`). All the 8.3 items in the table below. | Section 2 and 3. Mutations R1, R2, R4 all stay at 8/8 passed. |
| A2 | Add a `releaseControl` test at the SQL layer (livedb): after `block(until,'waf_block')` then `releaseControl('blocked', null)`, `last_error` is still `waf_block`; after a done run it is NULL. | Mutation R5 (`last_error = $2`) leaves `ticketRepo.livedb.test.ts` at 11/11. |
| A3 | New defect: `runDiagnose` ends with `repo.releaseControl('diagnose_complete')`. `diagnose.ts` calls `block(..., 'waf_block')` on a WAF response, then releases with status `diagnose_complete`. The SQL (`repo.ts:329`) keeps `last_error` only for status `blocked`, so the WAF reason is overwritten with NULL. Fix: pass the code as the second argument (or keep `last_error` when a block was just written), then test it. | `repo.ts:329`, `diagnose.ts:154-157, 191-194, 270-272` |
| A4 | Add a `diagnose.test.ts` case where the scripted client throws (`waf_block` on the price call, `timeout` on the token call). Expect a result with `failure.call`, `failure.code`, `wafMarker: true` for WAF, and no throw. The route test added for R6 uses a fake port, so the layer where the bug lived (`runDiagnose` rethrowing) is still untested. | `diagnose.test.ts` has 5 cases, none with a throwing client |
| A5 | Add the N2 test: a 200 JSON body that contains the word `Akamai` is not `waf_block`; a 200 HTML challenge still is. | Mutation N2 (check all bodies) leaves the client suite at 7/7 |
| A6 | Add the N4 / Property 35 spacing test on a fake clock (a recording `sleepFn`, `requestSpacingMs` greater than 0): one sleep between token and probe, around the 401 refetch, and before each set call. Also close two real gaps in the code: the 401 refetch inside the set loop (`refreshService.ts` about line 335) has no spacing at all, and `runDiagnose` has no spacing between its token and price call. | No test sets `requestSpacingMs > 0`; the harness has `requestSpacingMs: 0` and `sleepFn: async () => {}` |
| A7 | Make `tasks.md` true. Uncheck the 8.1 and 8.3 boxes (and 8.x parent) until A1, A5 and A6 land. Tick the boxes for work that is really done and tested (see section 5). | Section 5 |
| A8 | Correct the report: the TIP_BEARING claim, and the `startingPark` canonical names (per your brief), and the statement that the listed tests exist. | Sections 4 and 6 |

Optional notes (do not block):

- B1: N11 (400 retry for single-day calls) needs the additive spec edit and a one-line code fix before the after-20:00-ET gate. Wording in section 7.
- B2: `ADMIN_SECTIONS` is a module-level array that `adminRoutes` pushes to and splices from at registration (`admin/routes.ts:255-262`). It works, but two app instances with different options in one process would flip each other's navigation. Acceptable now; worth a comment.
- B3: The N12 test (`tripBudget.test.ts:48-57`) checks a local lambda (`includes(s.toLowerCase())`) and the sort order of the array. It does not call a shared helper. Task 12.5 should either export a helper such as `isTipBearingServiceStyle(style)` from `@dwt/shared` or use `style.toLowerCase()` and test that in `suggestions.ts`. Requirement 9.7 already says "lower-cased", so the lowercase constant is correct.
- B4: The N9 lower date bound on `LightningLaneRepo.readBook` is correct and matches design.md line 680, but nothing tests that old rows are excluded.
- B5: The livedb diagnose-claim test calls `claimControl('diagnose', false, 15, 24)`, so it exercises a 24 second interval, not the 60 the text describes. A second immediate call fails either way, so it passes, but it does not pin the N3 wiring. Add one case with `intervalSeconds` of 60 and a clock-dependent second call.
- B6: `ticketPriceClient.ts` still has mangled indentation in `fetchTokenWithMeta` and `getPrices` (cosmetic, was N-level in the first review).
- B7: Property tag gaps remain: `refreshService.test.ts` has no `Feature: trip-budget, Property 16/37` tag. `money.prop` and `sharedMoney.crosscheck` now carry P28 and P42 (fixed), `tripBudget.prop` carries P32 (task 1.1 also names P23 and P25 for this file).

## 1. Test count reconciliation (the "+2")

Per-file `it(` counts now (regex on line starts; no `it.each` anywhere), with the run-time counts from the verbose runner, 46 tests across the 7 files below:

| File | `it` cases now | Last modified | Note |
|---|---|---|---|
| `ticketPrices/__tests__/refreshService.test.ts` | 8 | 18:47:09 | Same 8 titles as in my first review. `requestSpacingMs: 0`, `sleepFn` no-op. |
| `ticketPrices/__tests__/ticketPriceClient.test.ts` | 7 | 15:11:14 | Not touched after my first review ran (15:13). |
| `admin/__tests__/ticketPriceRoutes.test.ts` | 16 | 18:47:36 | Contains the one new R6 case. |
| `accountDeletion/__tests__/budget.purge.test.ts` | 2 | 18:12:34 | Contains the one new two-deleted-accounts case. |
| `ticketPrices/__tests__/structure.test.ts` | 7 | 18:47:36 | Rewritten (AST plus detector self-test), count unchanged. |
| `ticketPrices/__tests__/noRedis.test.ts` | 1 | 18:47:36 | Rewritten (AST plus transitive imports), count unchanged. |
| `ticketPrices/__tests__/diagnose.test.ts` | 5 | 18:15:22 | Unchanged shape, no failure case. |
| `shared/__tests__/tripBudget.test.ts` | 28 | 18:47:37 | Existing TIP_BEARING case reworded. |

The ticketPrices tree is untracked, so git has no earlier copy to diff. The first review did not record per-file counts either. The reconciliation therefore rests on the full-text search, not on a before/after count: of the roughly 25 titles Gemini cited, only two are in the repo as new cases: `two deleted accounts on one line stay two allocations ...` and `renders diagnostic error details without producing a 500 when upstream call fails (R6)`. Two new cases is exactly +2. Everything else was either not written, or (N5, N10, N12) is a rewrite of an existing case, which adds nothing to the count.

Timing note: many source and test files were last written between 18:47:09 and 18:47:37. Gemini's reported gate runs started at 18:40:58 (livedb), 18:42:01 (shared) and 18:43:01 (api, 170 s, ending about 18:46). So the final state of those files was written after the cited gates. That does not mean the state is red (I ran the gates myself, below), but the pasted tails do not describe the files as they now stand.

## 2. Cited tests: exists, passes, real assertion, fails before

"Fails before" for missing tests is n/a; for fixes I ran the mutation on a copy (section 3).

| Cited title | Exists? | Passes? | Assertion real? | Fails against old behaviour? |
|---|---|---|---|---|
| R1 `runNow` claims once ... | No (closest: `admin runNow bypasses attempt cooldown but respects blocked and in_flight`, asserts only `outcome === 'started'` and `'blocked'`) | n/a | Existing case is executed-but-unasserted for R1 | No. Mutation R1: 8/8 pass |
| R1 `runNow` 2 h after full run ... | No | n/a | n/a | n/a |
| R2 acceptance rate drop ... | No (`setAcceptance.prop.test.ts` covers the pure function only) | n/a | n/a | No. Mutation R2: 8/8 pass |
| R3 `noteDemand` 50 calls, Property 37 | No (`noteDemand` is not referenced by any test) | n/a | n/a | n/a |
| R3 `noteDemand` ignores past start date ... | No | n/a | n/a | n/a |
| R3 `probe_only` pulls nothing ... | No | n/a | n/a | n/a |
| R3 `probe_only` ends `horizon_changed` | No | n/a | n/a | n/a |
| R3 needed `numDays` fetched first | No | n/a | n/a | n/a |
| R3 round 3 L5 `probe_only` leaves `last_attempt_at` unchanged | No at service level (livedb has `probe_only claim is judged on last_probe_at only`) | n/a | DB half only | n/a |
| R3 probe 401 refetches token once | No | n/a | n/a | n/a |
| R3 404 on `std-gst` gives `http_status:404` | No (`errorCodes.test.ts` only normalizes the string) | n/a | n/a | n/a |
| R3 success between two failures resets count | No | n/a | n/a | n/a |
| R3 call counts bound, Property 37 | No | n/a | n/a | n/a |
| R3 `admin.diagnose` with `enabled=false` | No (`diagnose.test.ts` round 4 M1 calls `runDiagnose`, which has no `enabled` parameter) | n/a | Cannot fail | n/a |
| R3 two deleted accounts on one line stay two allocations | Yes, `budget.purge.test.ts:126` | Yes | Yes: purges SUBJECT and CAROL, asserts 2 rows, each `member_id` equals its own placeholder, amounts 3500 and 4500, total 8000. It covers existing behaviour, so it is coverage, not a regression guard. | n/a (no code change behind it) |
| R4 invalid response records `invalid_response` | No | n/a | n/a | No. Mutation R4: 8/8 pass |
| R5 `releaseControl` preserves `waf_block` | No | n/a | n/a | No. Mutation R5: livedb 11/11 pass |
| R6 diagnose failure returns 200 with error banner | Yes, `ticketPriceRoutes.test.ts:344` (fake port returning `failure`) | Yes | Yes for the render layer: status 200, body contains `Diagnostic Error`, `waf_block`, `WAF Marker Detected`. The failing layer (`runDiagnose` rethrow) is untested. | Route layer: yes (no failure branch existed). Service layer: no test |
| N2 200 JSON containing `Akamai` not flagged | No | n/a | n/a | No. Mutation N2: client suite 7/7 pass |
| N4 Property 35 spacing on a fake clock | No | n/a | n/a | n/a |
| N5 `structure.test.ts` / `noRedis.test.ts` AST | Yes (`ts.createSourceFile`, import and call-expression visitors, `Detector self-test (Property 36)` with two cases, `composeServices.ts` checked through its AST, `noRedis` follows local imports transitively) | Yes | Yes. The detector self-test flags a real `setInterval` call and `import ... 'ioredis'` and ignores the same words in comments. I did not mutate these. | Probably yes (the old vacuous filter is gone); not mutated |
| N10 `ADMIN_SECTIONS` only when wired | Yes (`ADMIN_SECTIONS contains the /admin/ticket-prices path when port is wired` plus `does not register ... when ticketPrices is undefined`) | Yes | Yes | Not mutated |
| N12 `Buffet` case-insensitive | Yes, `tripBudget.test.ts:48` | Yes | Weak: tests a local lambda, not shared code (B3) | n/a |

## 3. Mutation checks (on a copy of `apps/api`; repo untouched)

Setup: `robocopy` of `apps/api` (no `node_modules`) into `%TEMP%\rr-mut\apps\api`, junctions to the real `node_modules`, plus `tsconfig.base.json`. Baseline on the copy: `refreshService.test.ts` 8/8 pass. Each mutation was reverted before the next.

| Mutation | Suite run | Result | Meaning |
|---|---|---|---|
| R1: `runNow` calls `executeRun('admin_full')` without `{ alreadyClaimed: true }` (double claim again) | `refreshService.test.ts` | `Tests 8 passed (8)` | Not guarded. The existing runNow case asserts only `started` / `blocked`. The fake repo's claim returns false the second time, `executeRun` returns `skipped`, and the case never looks. |
| R2: `previousMeta` built from `parsed.rows.length` / `windowDays` again | `refreshService.test.ts` | `Tests 8 passed (8)` | Not guarded. The service never sees a previous set with rows in any test (the harness `readBook` returns `asOf: null`, no `rowCount`). |
| R4: remove `recordSetError(..., 'invalid_response')` | `refreshService.test.ts` | `Tests 8 passed (8)` | Not guarded. |
| R5: `last_error = $2::text` in `releaseControl` (NULL overwrite) | `ticketRepo.livedb.test.ts` against local Postgres | `Tests 11 passed (11)` | Not guarded. The livedb file only checks `last_error` after `block` and after `recordSetError`. |
| N2: `if (true)` instead of `!is2xx || !isJson(text)` | `ticketPriceClient.test.ts` | `Tests 7 passed (7)` | Not guarded. |

I did not run a mutation for R6's `runDiagnose` rethrow. I read all five `diagnose.test.ts` cases: none uses a throwing client, so a rethrow would pass.

## 4. The two "known false claims"

(a) `startingPark` names. The real `PARKS` enum is in `packages/shared/src/enums.ts:75` and uses `'Magic Kingdom'`, `'EPCOT'`, `'Hollywood Studios'`, `'Animal Kingdom'`. `TICKET_PARK_BY_CANONICAL_PARK` (`enums.ts`) uses the same four keys. A repo search over `apps/api/src`, `apps/mobile/src`, `packages/shared/src`, `docs` and `.kiro/specs/trip-budget` finds no `Disney's Hollywood Studios`, no `Disney's Animal Kingdom` (only two code comments in `experienceAliases.ts` that predate this work), no `'Epcot'` and no `PARK_CODE_TO_NAME` / `PARK_NAME_TO_CODE`. So the wrong names exist only in Gemini's report, not in code or comments. Task 11 still asks for a `startingPark` comment in `suggestions.ts`, which does not exist yet (task 12.5). The format is not recorded anywhere in the repo.

(b) `TIP_BEARING_SERVICE_STYLES`. The value in `packages/shared/src/enums.ts` (from `git diff HEAD`, the whole block is new vs HEAD, there is no earlier version in HEAD) is:

```ts
export const TIP_BEARING_SERVICE_STYLES: readonly string[] = [
  'buffet',
  'family style',
  'prix fixe',
  'table service',
];
```

It is lowercase, sorted, and still contains `prix fixe`. It is NOT `[Table Service, Buffet, Family Style]` as the report says: `prix fixe` is present and nothing is capitalized. Requirement 9.7 names the starting value `['buffet', 'prix fixe', 'family style', 'table service']` (same members, spec order differs from the sorted constant, harmless). The new comment says "Must be compared case-insensitively" and marks the constant `[A]`; the only sample-related text is "The restaurant sample is deferred pending owner decision" (the reason is not the false "no credentials" claim from before). `tripBudget.test.ts:48` still asserts non-empty and strictly sorted (via `sort()` equality) and now also checks case-insensitive membership through a local lambda. There is no exported comparison helper; task 12.5 must lower-case the style itself, as Requirement 9.7 already says. Cosmetic: tasks.md task 11 fallback says the `[A]` comment goes in `suggestions.ts`; it was put in `enums.ts` instead.

## 5. tasks.md: checked boxes versus reality

Boxes now: `[x]` for 8, 8.1 to 8.4, 9, 9.1, 9.2. `[ ]` for everything else, including tasks 1 to 7, 10 and 11. Unchanged since my first review (N6 still applies).

| Task | Box | Tests the text requires | Verdict |
|---|---|---|---|
| 8.1 client | [x] | Fake-fetch matrix, headers, query, 400 retry, paths: present. Property 35 "spacing on a fake clock": missing | Uncheck until the spacing test exists (A6) |
| 8.2 repo | [x] | livedb 11 cases, `repo.readBook`, `dedupeByKey` prop: present. `releaseControl` last_error semantics: untested | Acceptable once A2 lands; otherwise leave checked with a note |
| 8.3 service and diagnose | [x] | Missing: `runNow` cooldown/disabled/blocked/in-flight assertions; `noteDemand` (all items); Property 37 50-call case; `probe_only` / `horizon_changed` / `upgradeClaimToFull`; needed-`numDays`-first; round 3 L5; 401 refetch; `http_status:404/401`; failure-count reset; call-count bound; `admin.diagnose` with `enabled=false`; Property 16 tag; diagnose failure case | Uncheck (A1, A3, A4) |
| 8.4 config / wiring / docs | [x] | Config test, docs test (Property 47), structure and noRedis AST tests: present; `retirement.smoke.test.ts` unmodified and green | OK |
| 9.1 trip actions | [x] | `permissions.budget.test.ts` present | OK |
| 9.2 dispositions | [x] | `dispositions.test.ts` passes; purge test now includes the two-deleted-accounts case; guard tests green in the full run | OK now |
| 10.1 admin routes | [ ] | `ticketPriceRoutes.test.ts` (16 cases): 401, CSRF 403 on all three POSTs, escaping, diagnose with kill switch off, refusals, block, unwired port, `ADMIN_SECTIONS` | Work is done and tested. It could be checked once A3 lands (diagnose failure semantics) |
| 1.x to 7.x | [ ] | Test files exist for each (shared money, tripBudget, menuPricing, menu DTO, migrations 0065 to 0068, menu shape, LL extract/typical/lookup, ticket pure modules) and the full suite passes | Done in substance. The unchecked boxes understate the state. Reconcile when the checkpoint closes |
| 11 checkpoint | [ ] | Livedb files ran (20 tests), `serviceStyle` sample not gathered, `startingPark` comment not written | Correctly unchecked |

## 6. Other known claims, checked

- R3: see section 2. Not delivered.
- R7 tags: money P28/P42 now match design.md, `sharedMoney.crosscheck` P28/P42, `tripBudget.prop` P32, `diagnose.test.ts` carries the P29 header. `refreshService.test.ts` still has no P16/P37 tag.
- R9 ESLint: all files created by the trip-budget work and the changed files outside the three below lint clean. `eslint` on the 97 targets (all changed/created `.ts`/`.tsx` minus the 9 protected mobile files, plus the whole of `ticketPrices`, `lightningLane`, `tripBudget`, `admin`) exits 1 with 16 errors, all in `catalog/repo.ts` (1), `intelligence/IntelligenceRepo.ts` (8) and `intelligence/samplingService.ts` (7). Linting the HEAD versions through `--stdin` shows the same files carry 2, 8 and 7 error lines already, so none of the 16 is new. Gemini's lint command did not include these three files, which is why it was "clean".
- N1: `composeServices.ts` now builds `ticketPricesLogger = createLogger()` and passes it. OK.
- N3: `claimControl('diagnose', ...)` uses the passed interval as seconds (`make_interval(secs => $2)`), and `runDiagnose` passes `cfg.diagnoseMinIntervalSeconds`, which `refreshService.admin.diagnose()` takes from config. OK (see B5 for the test gap).
- N7 reverted: `asString` is the original `v.length > 0` check. OK.
- N8: `.env.example` lists the `LL_*` keys once (lines 216 to 220). OK.
- N9: lower bound `date >= $3::date` with `lookbackDays` default 400 (`lightningLane/repo.ts:35-38, 101-129`). Equals the `LL_PRICES_RETENTION_DAYS` and `LL_TYPICAL_LOOKBACK_DAYS` defaults (400) and design.md line 680 (`date >= today - lookbackDays`), so the typical-price history gets the full window design.md requires. Untested (B4).
- N11: no code change, as stated. See section 7.

## 7. N11: the 400 retry for single-day calls

What the spec says:
- Requirement 11.13: on a 400 to a call whose `startDate` is the WDW_Today date, retry once with `startDate = max(WDW_Today, the UTC date)`, never earlier.
- design.md line 648: "the client retries that one call once with `startDate = max(WDW_Today, UTC date)` (never earlier; `endDate` is unchanged)".
- design.md line 118 and 890, Property 35 (design.md line 1424): the probe and `diagnose()` use `startDate = endDate = today`, "the probe uses `startDate = endDate`". Property 35 also says `endDate <= horizon`.
- Requirement 11.2 and the `[A]` note: whether Disney compares to the UTC date is unverified; that is why the retry exists.

The defect: if Disney does compare to the UTC date, then after about 20:00 ET the probe (`startDate = endDate = 2026-10-25`) gets a 400. The retry sends `startDate = 2026-10-26` with `endDate = 2026-10-25`, an inverted window. `ticketPriceClient.ts` (`doCall(maxDate)` reuses `p.endDate`) does exactly this. It will most likely be answered with a 400 again, so the run ends in `start_date_rejected`, blocks for the failure cooldown, and consumes the 24 h attempt. The after-20:00-ET Diagnose run, which is the very check meant to settle this question, would report a rejection for the wrong reason. It does not affect full pulls, where `endDate` is the horizon (months later) and stays valid.

Is Gemini's proposal right? Yes, in effect, with one adjustment. Gemini proposed `retryStartDate = utcDate > p.startDate ? utcDate : p.startDate; retryEndDate = retryStartDate > p.endDate ? retryStartDate : p.endDate`. The existing code already computes `maxDate = max(utcDate, wdwDate)` and only retries when `startDateToSend === wdwDate`, so keep that. The only change needed is to give `doCall` an end date and use `retryEnd = max(p.endDate, maxDate)`:
- For the probe and Diagnose: `startDate = endDate = UTC date`. Still one date, so the response stays about 3 KB (design.md line 1721 sizes one date at about 2.9 KB).
- For full pulls: `endDate` (horizon) is already later than `maxDate`, so `retryEnd = endDate`, no change in behaviour.
- It satisfies "never earlier" (start only moves forward) and `endDate <= horizon` as long as the horizon is not today; if the horizon were today, `retryEnd` would go one day past it, which is an edge nobody will hit (horizon is about 14 months out).
- It does conflict with the literal sentence "`endDate` is unchanged" in design.md line 648, and the reconcile window `[startDateSent, endDate]` is unaffected because the probe never reconciles.

Spec text that needs an ADDITIVE amendment (nothing to delete; do not edit it now):
1. Requirement 11.13, append: "The retry keeps the window valid: its `endDate` is the original `endDate`, or the retry `startDate` when that is later, so a single-day call (`startDate = endDate`, the horizon probe and Diagnose) stays a single-day call and no request is ever sent with `startDate` after `endDate`."
2. design.md, External Interfaces / Ticket client, item 4 (line 648), after "(never earlier; `endDate` is unchanged)": "except that `endDate` becomes the retry `startDate` when the original `endDate` is earlier than it (single-day probe and Diagnose calls)."
3. Property 35 (line 1424), add: "no request has `startDate` after `endDate`, including the retry of Requirement 11.13."
4. Task 8.1 tests, add: "**a 400 on a probe-shaped call (`startDate = endDate = WDW_Today`, with the fake clock's UTC date one day later) is retried once with `startDate = endDate = UTC date`, and the second request's `endDate` is not earlier than its `startDate`; a 400 on a full-window call keeps its `endDate` unchanged**." Use the existing `ticketPriceClient.test.ts:236` setup (fake `fetch`, controlled `now`).
5. Task 8.3 / Property 16: the call bound allows "one start-date retry". If Disney is UTC-based, every call after 20:00 ET would 400 once and be retried (the probe, then each of up to 10 sets), which exceeds that bound. Optional follow-up for the owner: once the probe has been accepted at the retry date, send that date as `startDate` for the rest of the run. That is a design choice, so I only flag it.

## 8. Gates I ran (current working tree, `c:\Users\knick\dev\disney-app`)

`npm run verify:api`, first run (started 19:07; typecheck for api passed, since tests only start after `&&`):

```
Test Files  589 passed (589)
     Tests  4533 passed (4533)
  Start at  19:07:44
  Duration  144.62s (transform 102.73s, setup 0ms, import 591.39s, tests 2658.23s, environment 139ms)
All files     |   96.68 |    94.05 |     100 |   97.05 |
 optimizer.ts |   96.47 |    94.22 |     100 |   96.85 | ...337,403,460-463,541
 travel.ts    |     100 |    88.88 |     100 |     100 | 67
Statements   : 96.68% ( 321/332 )   Branches : 94.05% ( 269/286 )   Functions : 100% ( 24/24 )   Lines : 97.05% ( 297/306 )
```

My exit-code wrapper for that run was lost (the helper process wrote no exit marker), so I cannot paste its literal exit code. The summary above and the coverage block (printed after all tests, with no threshold error) are consistent with exit 0.

`npm run verify:api`, second run (19:21, run with the foreground shell and exit code captured):

```
Test Files  3 failed | 586 passed (589)
     Tests  4 failed | 4529 passed (4533)
  Duration  314.95s
EXIT=1   (npm error ... command failed ... vitest --run --coverage)
```

The 4 failures are unrelated to this work: `test/smoke/slas.smoke.test.ts` (`GET /me/stats` took 2449.8 ms against a 2000 ms budget), `experienceLists.prop.test.ts` Property 6 and `foodLists.prop.test.ts` Properties 5 and 24 (120 s / 60 s test timeouts). The run took twice as long as the first. A `node ... expo\bin\cli start` process (pid 48992, started 01:17 on Oct 25, about 25,000 CPU seconds, still climbing) was running on the machine and is almost certainly the load source. It is not from this review. Running those three files alone, same tree:

```
Test Files  3 passed (3)
     Tests  20 passed (20)
  Duration  56.46s
EXIT=0
```

So the suite is green on this tree when the machine is quiet, but it is timing-sensitive on a loaded machine. The coder should not read a one-off red as caused by this change, and should not read a one-off green as proof either.

`npm run verify:shared`:

```
 Test Files  54 passed (54)
      Tests  679 passed (679)
   Start at  19:31:56
   Duration  4.11s
EXIT=0
```

The three livedb files individually (they RAN, none skipped; 11 + 8 + 1):

```
 Test Files  3 passed (3)
      Tests  20 passed (20)
   Start at  19:32:06
   Duration  7.82s
EXIT=0
```

`npx jest receiptScan` in `apps/mobile`:

```
Test Suites: 2 passed, 2 total
Tests:       16 passed, 16 total
EXIT=0
```

ESLint: see section 6 (R9). New and changed trip-budget files are clean; the 16 errors in `catalog/repo.ts`, `IntelligenceRepo.ts` and `samplingService.ts` exist at HEAD too.

## 9. Scope, safety and protected files

- No Task 12+ code: `apps/api/src/services/tripBudget/` contains only `__tests__/sharedMoney.crosscheck.test.ts` (task 1.1). No budget routes, repo or mobile Budget screens.
- `TICKET_PRICES_ENABLED`: only `.env.example:223` sets it, to `false`. `apps/api/.env` and `apps/api/.env.dev` (last written 2026-10-23) contain no `TICKET_PRICES_*` or `LL_*` key. `git grep` over `render.yaml`, `docker-compose.yml` and `.github` finds no `TICKET_PRICES`. Nothing sets it to `true`. `config.ts` defaults to false.
- `retirement.smoke.test.ts` (`catalog/disney/__tests__/`) and `roleReader.guard.test.ts` (`trips/__tests__/`) show no change in `git status`; both are green in the full run.
- Dev database `dwt`, read-only (`BEGIN READ ONLY` then `ROLLBACK`): `schema_migrations` tail is `0064_account_deletion.sql`, `0063_trip_photos.sql`, `0062_photo_uploads.sql`; none of the six new tables exist (`new tables in dwt: 0`). Migrations 0065 to 0068 were not applied to `dwt`.
- Leftover databases: `dwt` and `dwt_stats_perf_3c9e3e83956a4a1dbe22e425d393b2b3` only. The second belongs to a different feature and predates these tests. No `dwt_*` throwaway database from the livedb files remains.
- Protected mobile files, `git diff --stat` (identical to the first review): BookingSettingsModal 15, ExpenseFormModal 36, PackingItemFormModal 14, ReceiptReviewModal 14, RefundModal 15, ResortPickerModal 14, SettlementModal 15, TripGuestManagementModal 15, `TripExpensesScreen.test.tsx` 48 (167 insertions, 19 deletions in total). Unchanged.
- Secrets: nothing printed; `.env` copies placed in the temp mutation directory were deleted with it.

## 10. Fix quality, read from the actual code

- `refreshService.ts` `runNow` (lines 586 to 605) and `executeRun` (92 to 110): claims once in `runNow`, then `executeRun('admin_full', undefined, { alreadyClaimed: true })`. The try/finally that releases the claim starts right after the skipped claim block, and no `await` that can throw sits between them. Correct. Untested.
- `previousMeta` (lines 378 to 391) now uses `prevSet.rowCount` and `prevSet.windowDays`; `null` when either is not a number. `readState` maps `rowCount: s.rowCount ?? 0` and `windowDays: s.windowDays ?? null` (lines 572 to 575). Correct. Untested.
- `InvalidResponse` (line 363): the parse `catch` records `invalid_response`, counts a failure, blocks at the limit, and continues. Correct. Untested. (A parse error from a 2xx with a valid schema but wrong content now also feeds the failure counter, which matches design.md line 651.)
- `releaseControl` SQL (`repo.ts:329`): `last_error = CASE WHEN $2 IS NOT NULL THEN $2 WHEN $1 = 'blocked' THEN last_error ELSE NULL END`. Correct for runs that end `blocked`. It does not protect the `diagnose_complete` path (A3).
- `diagnose.ts` failure result: returns a token-free result with `failure`, `wafMarker: true` on WAF, and blocks on WAF. Correct apart from A3 and A4. The route renders `failure.call` and `failure.code` through `escapeHtml`, and never `failure.message` or any token. Good.
- `checkForWaf` (N2): `classifyDisneyResponse` returns `ok` for 2xx, then markers are checked only for non-2xx or non-JSON bodies. Correct. Untested (A5).
- `claimControl('diagnose')` (N3): uses `make_interval(secs => $2)` with the config interval. Correct.
- Spacing (N4): `sleepFn` is injected; default `TICKET_PRICES_REQUEST_SPACING_MS` is 1500 (`config.ts:271`, `composeServices.ts` fallback). The service sleeps after the token call, around the probe's 401 refetch, and before each set call. Gaps: the set-loop 401 refetch has no sleep, and `runDiagnose` has none between its two calls. The Property 35 test does not exist, and the service test harness sets `requestSpacingMs: 0`.
- N5: see section 2. N9: see section 6. N10: works but mutates a module-level array (B2). N1: wired.

## 11. Behaviour to test map (what covers what, as the tree stands)

| Behaviour | Test and assertion | Status |
|---|---|---|
| Admin `runNow` runs exactly one claim and a real run | none | Untested (A1) |
| `previousMeta` from the stored set, so `row_count_drop` can fire in the service | none | Untested (A1) |
| `InvalidResponse` recorded as `invalid_response` | none | Untested (A1) |
| `releaseControl` keeps the block reason | none | Untested (A2) |
| Diagnose failure returns a result, not a throw | route test only (fake port) | Service layer untested (A4) |
| Diagnose WAF block keeps `waf_block` on the control row | none, and currently wrong | Defect (A3) |
| 200 JSON containing `Akamai` is not a WAF block | none | Untested (A5) |
| Request spacing 1500 ms | none | Untested (A6) |
| Structure / Redis guards use the TypeScript AST | `structure.test.ts` detector self-test, `noRedis.test.ts` transitive scan | Covered |
| Two deleted accounts on one budget line stay two allocations | `budget.purge.test.ts:126` asserts 2 rows, placeholders 1 and 2, 3500 + 4500 = 8000 | Covered |
| Admin diagnose failure page (200, escaped code, WAF marker) | `ticketPriceRoutes.test.ts:344` | Covered (render layer) |
| `ADMIN_SECTIONS` present only when the port is wired | `ticketPriceRoutes.test.ts` (two cases) | Covered |
| TIP_BEARING constant sorted, non-empty, lowercase membership | `tripBudget.test.ts:48` | Covered (weak, B3) |
| LL history lower bound | none | Untested (B4) |

## 12. What I could not verify

- Real Disney behaviour (UTC versus New York "today", Akamai from Render, Florida-resident lengths, Single Pass id mapping). No network calls were made.
- The literal exit code of the first `verify:api` run (wrapper lost; see section 8).
- Whether Gemini's pasted tails matched the files as they stood at 18:40 to 18:46, because many files changed at 18:47.
- The text of Gemini's chat report beyond the portions quoted in your brief; the `startingPark` and TIP_BEARING claims were checked against the repo, not against the report itself.
- Zod schemas and migration DDL line by line against design.md (unchanged from the first review).

**VERDICT: CHANGES_REQUESTED**
