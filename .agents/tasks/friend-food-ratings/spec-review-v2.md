# Friend food ratings spec (pass 3): opt-out, notice and stats projection removed cleanly; only wording nits remain

The revised spec under `.kiro/specs/friend-food-ratings` now describes a read-only per-dish projection of `food_item_logs` that is always visible to accepted friends. Requirements 1, 2, 7, 8, 9 and 10 are withdrawn stubs with their numbers kept, the setting, launch notice, settings toggle, migration and stats-path projection are gone from design and tasks, and a note-free guarantee remains for the new routes and for the unchanged friend stats `foodActivity`. Traceability was checked mechanically (75 active criteria, 17 properties, 34 leaf tasks) and holds in both directions. The two new test groups the brief asked for (route-registration 401-not-404, automated accessibility assertions) are attached to the right tasks.

Watch for: (1) Requirement 5.3's rationale ("a Friend cannot reconstruct ... dates beyond `latestVisitedOn`") is literally false for the unchanged stats payload, which carries two visit dates (confirmed, non-blocking); (2) a few residual mentions of removed concepts remain outside the withdrawn stubs (`0062`, "no `sharing` field", confirmed, nit); (3) the withdrawn sub-criteria inside Requirements 13 and 17 are not EARS sentences and I could not run the spec validator to see whether it objects (possible).

**Verdict**: APPROVED

## High-level view

Removal is complete and consistent with the final decision. The Introduction, Relationship table, design Overview, decision 4, decision 10, assumptions A1 and A6 and the tasks Notes all say the same thing: friend visibility is always on for accepted Friends, there is no opt-out, notice or disclosure, and a future per-user control is an out-of-scope additive follow-up. The requested cross-reference sentence (same visibility model as ride/restaurant ratings, notes private unless a future shareable flag exists) is present in both the requirements Introduction and the design Overview. No requirement, property, task, DTO field, constant, copy string, error code or migration for the removed features is left.

The stats-path decision is coherent with the code. `stats/repo.ts` has exactly five `food_item_logs` statements (lines 607, 618, 638, 657, 674: volume totals, most logged, highest rated, most adventurous day, dish marathon) and none selects a note; `grep` for `note` across the stats service finds only unrelated comments in `computePercent.ts`, and `FoodActivityStatistics`/`FoodPersonalRecords` in `packages/shared/src/dto/Stats.ts` have no note-bearing field. The `stats-experience-redesign` R24.8 row in the Relationship table is now framed as "Unchanged; the friend exposure is intentional and consistent", and the same framing appears for R11/R22/`expanded-stats` R9.1 (friend and own `foodActivity` stay structurally identical). The guard is a source-level test (task 3.5, wave 0) mapped to Requirement 5.1 and Property 1, which is the cheapest layer that can fail.

Numbering and structure survive. Requirement numbers 1 to 19 are unrenumbered; properties are contiguous 1 to 17; task ids are contiguous and the dependency graph lists all 34 leaf tasks exactly once with no forward dependency. Only `- [ ]` checkboxes appear.

<details>
<summary>Issues (7)</summary>

1. **R5.3 contradicts the unchanged stats payload (confirmed, non-blocking)** — the friend stats `foodActivity` includes `mostAdventurousDay.date` and `dishMarathonRecord.date` (visit dates), and R5.1 explicitly counts that payload as "friend-facing". Scope R5.3 and R5.2 to the new routes' payloads (list, Highlights, batch), or add "other than the unchanged stats personal-record dates".
2. **Stub requirements are longer than one sentence (confirmed, cosmetic)** — Requirements 1, 2, 7, 8, 9, 10 each have two sentences (R8 has three) rather than the one sentence the brief specified. Trim to a single sentence each; no criteria or numbering are affected.
3. **Residual removed-concept mentions outside the stubs (confirmed, nit)** — `design.md` A6 and `tasks.md` 1.1 mention migration `0062`, and task 3.1 says "no `sharing` field exists". Drop those clauses; "no migration" already says it. The remaining hits (Introduction, design Overview/decision 4, Notes, design copy table) are intentional statements of the decision. Assumption id `A1` is a reused label for the unchanged-stats assumption, not a leftover.
4. **Withdrawn sub-criteria may trip the validator (possible)** — 13.2, 13.6, 13.7 and 17.5 are numbered items of the form "(Withdrawn: ...)" with no SHALL. Keeping them avoids renumbering references, but the Kiro format diagnostics were not run (no tool in this step), so run them once after the next edit and, if they complain, fold the withdrawn items into a single non-numbered note while keeping 13.3-13.5 and 17.1-17.4 numbers.
5. **Task 3.5 only matches the word `note` (possible)** — a future `SELECT fil.*` or `SELECT *` would leak the note and still pass. Add `fil\.\*` and `SELECT \*` to the forbidden patterns for statements referencing `food_item_logs`.
6. **No non-forbidden error state for the Friend Food History list (possible, pre-existing)** — R17.2/R17.4 mention retry and an error state, R11.4 defines them for Highlights, but R12 and task 4.4/4.5 define only empty, no-match and forbidden for the full list. Add a failed-load state with a retry control and a test, or narrow R17's wording.
7. **EARS phrasing nits (confirmed, nit)** — R3.5 uses "THE very next read" as subject, R5.1 "NO friend-facing payload ... SHALL" and R5.4 "THERE SHALL be" are not the standard `THE <system> SHALL` form. R5.3 itself is now acceptable. R8.6 and R2.5, named in the brief, no longer exist because R8 and R2 are withdrawn, so that cleanup is moot rather than missed.

</details>

<details>
<summary>Details</summary>

## Brief checks, one by one

1. **Removal.** A case-insensitive search of all three files for opt-out, optOut, opted, Sharing_Setting, sharing, notice, 0062, food_ratings_notice, A11, foodRatingSharing, disclos, toggle, launch, "keeps private" and "Share my" returns only: the six withdrawn stubs and the four withdrawn sub-criteria; the Introduction/Overview/Notes decision statements; the Relationship-table rows quoting `friend-stats-viewing` R4.3/R4.4/R4.6/R4.7 (existing spec language, correct); the design copy table sentence "There is no setting label ... withdrawn with the opt-out"; `0062` in A6 and task 1.1; "no `sharing` field exists" in task 3.1; and the English words "private"/"discloses" used in unrelated senses. `A11` and `foodRatingSharing` appear nowhere. The Glossary has no Sharing_Setting term, the DTOs have no `sharing` field, Configuration & Constants has no notice or setting constant, Error Handling has no new code, and the batch SQL has no opt-out predicate.
2. **Always on.** Nothing contradicts it. R11 to R15 and R3 contain no conditional visibility; R13.1 states the only non-success outcome is `403 profile_forbidden`; Properties 2 and 11 say there is no third "private" response.
3. **Notes never exposed.** R5.1 to R5.4 and Property 1 are intact, including the decoded `nextCursor` carrying no `logged_at`: the `recent` sort uses `latest_visited_on` then `food_item_id` with `b = null` (R6.1, design keyset SQL, tasks 2.1/2.2/2.4/3.4 all agree, and task 3.4 asserts the decoded cursor against generated `logged_at` values).
4. **Stats path.** See High-level view. One wording gap (issue 1): R5.3's stated rationale does not hold for the stats payload's personal-record dates. This does not affect any test or code change, because the stats payload is intentionally untouched and `routes.test.ts` plus `friendParity.prop.test.ts` stay green unchanged.
5. **Cross-reference.** Present in requirements Introduction ("same visibility model as ride/restaurant ratings: accepted Friends only, no opt-out, and notes private unless a future shareable flag exists"; "future per-user control ... explicitly out of scope") and design Overview.
6. **Tests.** (a) Task 3.6 builds the server with the real route plugin and a rejecting session pre-handler and asserts `401` not `404`, plus a source-level assertion on `composeServices.ts` and `server.ts` in the style of `retirement.smoke.test.ts`; task 7.3 extends the `401` assertion to both batch paths; R3.3 and Property 2 carry the requirement. The first half goes through `server.ts`, not `composeServices.ts`, so the source-level half is what actually catches a missing production entry, and the task requires proving it fails when the entry is removed. (b) Tasks 4.5, 5.2 and 8.4 assert `accessibilityRole`/`accessibilityLabel` on "See all", retry, sort/filter chips, search clear, rows, cards and the social-proof chip, and text next to icons in empty/error states. Requirement 17 criteria 17.1 to 17.4 are all cited by tasks without renumbering; 17.5 is a withdrawn stub.
7. **EARS.** R5.3 reads as a clean ubiquitous requirement. R8.6 and R2.5 are gone with their withdrawn parents (issue 7).
8. **Traceability (computed).** 75 active criteria across Requirements 3, 4, 5, 6, 11, 12, 13 (13.1, 13.3 to 13.5), 14 to 19: every one is in at least one `**Validates:**` line and at least one `_Requirements:_` line; no property or task cites a missing or withdrawn number (13.2, 13.6, 13.7, 17.5 are cited nowhere). The dependency graph has 34 entries, matching the 34 leaf tasks, with no duplicates, no omissions and no task before its dependencies (3.5 reads existing source only, so wave 0 is valid; Phase 2 follows the Phase 1 checkpoint).
9. **Format.** Design order is Overview, Key design decisions, Open Questions/Assumptions, Architecture, Components and Interfaces, Data Models, Configuration & Constants, External Interfaces, Correctness Properties (`### Property 1` to `17`, each with `**Validates:**`), Error Handling, Testing Strategy. tasks.md has `# Implementation Plan`, `## Tasks`, `## Notes`, `## Task Dependency Graph`. A regex for any checkbox other than `- [ ]` finds none.

## Not verified

No build, test run or Kiro spec diagnostics were run, per the step instructions. I read the stats SQL and DTOs on disk to confirm the no-note claim; I did not execute `GET /me/stats/summary?for=`. The line numbers cited in the spec for other files (server.ts, foodLists, mobile screens) were not re-checked in this pass; they were verified in the prior pass and this revision did not touch them.

</details>

<details>
<summary>File map</summary>

- `.kiro/specs/friend-food-ratings/requirements.md`: Introduction restated as always-on, Relationship table reframed, stubs for Requirements 1, 2, 7, 8, 9, 10, withdrawn sub-criteria in 13 and 17; issues 1, 2, 4, 6 and 7 land here.
- `.kiro/specs/friend-food-ratings/design.md`: no migration, no persistence, stats unchanged (decision 10, A1), Properties 1 to 17, wiring test; issue 3 lands here.
- `.kiro/specs/friend-food-ratings/tasks.md`: 34 leaf tasks, task 3.5 stats guard, task 3.6 wiring test, accessibility assertions in 4.5/5.2/8.4; issues 3, 5 and 6 land here.
- Reference only: `apps/api/src/services/stats/repo.ts`, `packages/shared/src/dto/Stats.ts`, `.agents/tasks/friend-food-ratings/spec-review.md`.

</details>
