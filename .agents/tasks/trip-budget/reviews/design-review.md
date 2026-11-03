# Design Review (round 6, verification of the round 5 fixes): trip-budget

Reviewer: design-review subagent, document-only (no build, no suite run; only read-only source reads and two throwaway arithmetic/consistency scripts that were deleted afterwards).
Scope: `.kiro/specs/trip-budget/{requirements,design,tasks}.md` and the additive amendments to the eight sibling specs, checked against the round 5 findings preserved in `design-review.round5.md` (round 4: `design-review.round4.md`, round 2: `design-review.round2.md`).
Severity scale: HIGH, MEDIUM, NIT. Verdict rule: any HIGH or MEDIUM gives CHANGES_REQUESTED.

## Verdict: APPROVED

Counts: 0 HIGH, 0 MEDIUM, 2 NIT.

Every round 5 finding (H1, M1 to M5, L1 to L14) is fixed in the text, and the fixes that claim a source behaviour match the source. The fixes introduced no requirement, property, task or traceability inconsistency.

---

## Round 5 findings: verification

### H1 (Budget authorization imports `effectiveRole.ts`): FIXED, verified in source
- `requirements.md` R18.2, `design.md` "Authorization" paragraph (`services/tripBudget/authz.ts` with `requireBudgetAction` = `assertTripMember` then `can`), Property 24, `tasks.md` 15.1, 15.3, 9.2, 14.1 and the Notes "structural guards" line all say the Budget module never imports `services/trips/effectiveRole.ts`.
- Source check: `apps/api/src/services/trips/authz.ts` `assertTripMember` runs one `SELECT tm.role, ACTIVE_ORGANIZER_COUNT_SQL ... FROM trip_memberships tm`, throws `trip_forbidden` when no row exists, and returns `actingRole(...)`. `actingRole` (in `effectiveRole.ts`) returns the persisted role for an organizer, returns the persisted role unless `has_active_organizer === false`, and otherwise does one roster read via `resolveEffectiveRole`. So the design's claims hold: the acting role (interim organizer applied) in one statement, plus one roster read only for a persisted `member` of a Trip with no active organizer. `roleReader.guard.test.ts` pins the `effectiveRole.js` importers to `composeServices.ts`, `services/trips/authz.ts` and `services/trips/repo.ts`; the new `tripBudget/authz.ts` imports only `trips/authz.js` and `trips/permissions.js`, so the guard stays green.
- The fix keeps the permission matrix in force (`can(role, action)` runs), so trips R25.2 ("no membership-only shortcut") is still satisfied. Task 15.3 adds the interim-organizer route test (a persisted `member` of a Trip whose only organizer is `pending_deletion` may `PATCH /budget/settings`; once an active organizer exists the same member gets `trip_forbidden`) and a structural test that no Budget file imports `effectiveRole.js`.
- Sibling amendment: `trips/requirements.md` Requirement 25 criterion 2 carries a labelled clarification and `trips/design.md` Property 30 carries the implementation note. Both are additions inside text that `trip-budget` itself added to `trips`.

### M1 (statement bound): FIXED
- Constant is 14 everywhere (`requirements.md` R20.6; `design.md` read-flow paragraph, constants block, Configuration list; `tasks.md` 1.1, 14.3, 15.3): authorization 1 + optional roster 1 + `loadBudget` 6 + label lookup 1 + ticket reads 3 + Lightning Lane reads 2. The common case is 13, the interim-organizer case 14.
- The guarding test moved to task 15.3 (`routes.statementCount.test.ts`): real `assertTripMember`, real `loadBudget`, real `ticketPrices` and `lightningLane` read repos, a counting proxy over `pool.query` and over clients from `pool.connect()`, 1 line versus 300 lines, counts equal, between 13 and 14, and exactly one more for the interim-organizer member. Task 14.3 keeps the repo-level half (7 statements for `loadBudget`, 3 and 2 for the two real read repos). Ordering is valid: 14.3 is wave 14, 15.3 is wave 17, both after the ticket and Lightning Lane repos.

### M2 (negative per-person tax or tip): FIXED, verified by execution
- Budget now uses its own non-negative largest-remainder `allocateShares(totalCents, weights)` (design "Budget pure modules", task 12.1, new R6.9, Properties 1 and 2 extended); `trip-expenses/allocation.ts` is untouched.
- I ran both algorithms. `allocateProportionally(1, [0,1,1])` returns `[-1,1,1]` and `allocateProportionally(2, [1,3,3,3])` returns `[-1,1,1,1]` (a negative share for a POSITIVE weight, so the design is right that a zero-weight filter alone would not have been enough). `allocateShares(1,[0,1,1])` returns `[0,1,0]`, `(2,[1,3,3,3])` returns `[0,1,1,0]`, `(100,[1,1,1])` returns `[34,33,33]`, matching the worked examples in task 12.1. Exhaustive check over totals 0..12, 1..5 weights each 0..4: no output negative, sums exact, zero-weight entries always 0, every share at most `floor(total*w/S)+1`.
- The 2^53 bound argument in the design (tip at most 250,000,000 times weight at most 10,000,000 is 2.5e15) is correct.

### M3 (Florida-resident path) and M4 (`warming` after a failed fetch): FIXED, consistent
- `flUnavailable` is true only for `fl-resident` when the pair is not permitted or the set's `last_error` is `not_offered` (R14.8, `resolveTicketPrice` step 1 with the new `pairPermitted` input, DTO comment, Property 14). A permitted never-fetched pair is `flUnavailable: false`.
- `cacheState` is one total pure function `ticketCacheState` (new `cacheState.ts`, R14.12, design, Property 14, tasks 7.4, 15.3, 18.2) with a fixed five-rule order: `disabled`, `ready` (not permitted, `not_offered`, or rows exist), `failed` (permitted, no rows, `last_error` set), `warming` (a run in flight or the attempt cooldown elapsed, so this read starts one), otherwise `failed`. The mobile text for `failed` is specified and tested.
- Error Handling is split into the two rows requested (never-fetchable pair versus permitted never-fetched pair) and agrees with `decideRefresh`, which filters unpermitted and `not_offered` pairs and treats a missing set or null `asOf` as stale. `updateSet` clearing `last_error` on acceptance and `recordSetError` leaving `as_of` untouched are pinned in task 7.x tests. Route rows cover each case, including `lastError = 'network'` giving `failed`.

### M5 (Single Pass join fan-out): FIXED, verified in source
- The join is now the exact, type-qualified `experiences.upstream_entity_id = v.numeric_id || ';entityType=Attraction'` (R15.6, migration 0066 paragraph, Property 19, tasks 6.3 and Notes). I confirmed `upstream_entity_id TEXT NOT NULL UNIQUE` in `0001_init.sql` and `0004_disney_sources.sql`, so the join returns at most one row per input and cannot recreate a duplicate conflict key after the `Map` dedupe. The two Single Pass ids recorded in the investigation (`lightninglane_16767284`, `lightninglane_411504498`) map to `...;entityType=Attraction` Enterprise_Ids as the design states. A livedb case (two Experiences sharing the numeric prefix, one Attraction) is specified and would fail against the old `split_part` form.

### LOW findings L1 to L14: all folded in
L1 `money.ts` in the Placement table with `splitCentsEvenly` signature and the Formulas line renamed; L2 `trip_not_found` added to R18.6's reuse list and tested in 15.3; L3 new R13.11 (`std-gst` probe, boot validation requires `std-gst` in `TICKET_PRICES_GROUPS`, `http_status:404`/`401` count as failures); L4 new R13.12 (re-read `blocked_until` before each call after the first); L5 `dateToInstant` (12:00:00Z) in `ticketPrices/dates.ts` with a round-trip test across DST dates (12:00Z is 07:00 or 08:00 New York, the same calendar date); L6 R14.5 reworded to verified facts; L7 verbatim owner quote and launch gate (new R21.8); L8 `normalizeTierName` (new R9.10); L9 new R16.8; L10 stale file-name references corrected; L11 AST-based structural test; L12 declined with reasoning (still flagged for owner veto, no spec defect); L13 new R4.8 with Property 33 and task 14.1 references; L14 task 9.2 now names 14.1.

---

## Consistency of the revised spec (checked mechanically)

- Requirements: 191 acceptance criteria, no duplicates, numbering sequential inside every requirement. The seven additions (R4.8, R6.9, R9.10, R13.11, R13.12, R16.8, R21.8) are appended after the existing criteria; nothing was renumbered.
- Traceability: every one of the 191 criteria appears in a `Validates:` line of a Correctness Property and in a task `_Requirements:_` line; no dangling reference in either direction. Properties 1 to 49 are sequential. The design's requirement-to-property-to-test table has a row for every requirement and mentions the new criteria.
- Tasks: 71 tasks (50 numbered subtasks plus 21 top-level leaf tasks and headings counted as before), no duplicate ids, every subtask placed in the Task Dependency Graph (JSON parses), 71 checkboxes all `- [ ]`, zero other markers. Ordering of the changed items is valid: `dates.ts`/`dateToInstant` (7.1, wave 5) before `lookupLlPrice` (6.2, wave 6); `money.ts` (1.1, wave 0) before 12.1; real read repos before 14.3; 14.3 before the 15.3 statement-count test; 9.2 before the guard runs.
- Sibling specs are additive: `git diff -U0` over the eight amended specs shows no removed requirement, criterion, property or section; the only removed line in each `tasks.md` is the former last dependency-graph JSON entry, re-added with a trailing comma. New numbers are the next free ones (trips Requirement 25 and Property 30).

## Verified assumptions
- `assertTripMember` and `actingRole` behaviour (statement count, acting role, opaque `trip_forbidden`) read in `trips/authz.ts` and `trips/effectiveRole.ts`; `roleReader.guard.test.ts` importer allowlist read.
- `allocateProportionally` source read and the negative outputs reproduced; `allocateShares` properties checked exhaustively on the small domain.
- `experiences.upstream_entity_id` is UNIQUE in migrations 0001 and 0004; Attraction Enterprise_Ids carry the `;entityType=Attraction` suffix (migration 0046 uses it).

## Unverified assumptions
- The local development database content cited for the shared numeric prefix (`80010856`) was not re-queried this round; the exact-match join makes the fix independent of it.
- The counts "3 ticket reads" and "2 Lightning Lane reads" are design commitments for code that does not exist yet; task 14.3 and 15.3 pin them with real repos, so a mismatch is caught at implementation time.

## NIT

1. `design.md` Error Handling row for a permitted never-fetched pair cites "Requirement 13.6" for "a missing set is stale". The rule lives in `decideRefresh` (design, Requirement 12); R13.6 only excludes `not_offered` sets. Cite Requirement 12 / `decideRefresh`.
2. `requirements.md` R14.12 rule (3) says "`set` is null or has `asOf == null`, and `set.lastError != null`"; for a null `set` the error clause is vacuously false, so the sentence reads better as "`set` exists, has `asOf == null`, and `set.lastError != null`". The pure function in the design already behaves this way.

Neither NIT affects behaviour or blocks implementation.
