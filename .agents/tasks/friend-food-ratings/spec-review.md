# Friend food ratings spec (pass 2): prior findings resolved, test-gap polish remains

The three spec files under `.kiro/specs/friend-food-ratings` define a read-only per-dish projection of `food_item_logs` for accepted friends, an account-level opt-out with a one-time launch notice, a stats-path projection that closes the existing wire exposure, and a Phase 2 batch endpoint for menu social proof. All seven findings from the first pass are fixed in the current files, including the blocking one: the `recent` cursor no longer carries `logged_at`. No contradiction with the fixed decisions was found; what remains is a handful of unasserted behaviors and wording mismatches.

Watch for: (1) nothing in the plan would fail if the new routes were never registered in `composeServices.ts`/`server.ts` (likely); (2) accessibility requirement 17.2 (roles, labels, switch checked state) has only a manual check in task 9.1 (likely); (3) task 3.4 asks pg-mem to load migration `0004`, which the existing food-log precedent does not (possible).

**Verdict**: APPROVED

## High-level view

Every path, table, column, migration number and existing-spec requirement number cited in the spec matches the investigation and the files on disk, including each item the investigation marked CORRECTED or NOT FOUND (no friendship status, no `experience_id` on `food_item_logs`, `notes.shareable`, no reusable seen-once mechanism, next migration `0062`). The amendment of the implicit "food logs are owner-only" stance is stated with the right specs and requirement numbers and edits none of them.

Traceability holds in both directions. Requirements 1 to 19 each appear in at least one `**Validates:**` line (Properties 1 to 22) and at least one `_Requirements:_` line, and every referenced sub-number exists. The decisions the brief asks about each have a requirement and a property: notes-never-exposed (Property 1, now including the decoded cursor), default-on opt-out enforced in the data layer (Property 3), friend-only gate (Property 2), one row per dish (Property 4), average in [1,10] from rated logs only (Property 5), display rounding never fed back (Property 10), batch equals single-list aggregates (Property 9), one-time notice (Property 16), friend history as a pushed `YouAndCrewStack` screen and not a tab (Property 21), and one batch query with no N+1 (Property 19).

The remaining issues are about what the plan would and would not catch during implementation, not about what the spec asks to build.

<details>
<summary>Issues (6)</summary>

1. **Route registration is untested (likely, non-blocking)** — `friendFoodRatings?` and `foodRatingSharing?` are optional on `BuildServerServices`, so omitting them in `composeServices.ts` silently drops the routes while every `server.inject` test that builds its own Fastify instance stays green. Add one test that builds the app through the real service map (or a source-level assertion like `retirement.smoke.test.ts`) and checks the three route families answer `401`, not `404`; attach it to tasks 2.5 and 4.5.
2. **Accessibility requirement 17.2 and 17.4 have no automated assertion (likely, non-blocking)** — Property 17 claims every added control has a role and label and the switch exposes checked state, but only the label builders (task 6.2) are tested; the controls are checked by the manual walk in task 9.1. Add `accessibilityRole`/`accessibilityLabel` assertions to tasks 6.5, 7.2, 8.4 and an `accessibilityState.checked` assertion to task 8.2.
3. **Requirement 10.5 does not match the design (confirmed, non-blocking)** — 10.5 says the saved setting invalidates the cached Sharing_Setting, while design and task 8.1 write the server echo with `setQueryData` and invalidate only the friend-ratings keys. Reword 10.5 to match, or add the invalidation. Also note that with the asymmetric opt-out (A5) invalidating friend-ratings keys on one's own toggle changes nothing the viewer sees; harmless, but 10.5 and 15.6 could say so.
4. **pg-mem loading migration `0004` (possible, non-blocking)** — task 3.4 loads `0001`, `0004`, `0040`, `0043`, `0062` to get a nullable `experiences.park`. The existing precedent (`foodItemLogs.prop.test.ts`) loads only `0001` and `0040`, and `0004` contains a large data-mapping section that pg-mem may not parse. Check early; the cheaper alternative is an `ALTER TABLE experiences ALTER COLUMN park DROP NOT NULL` in the test setup, recorded as a deviation.
5. **Highlights read also runs the scopes query (possible, non-blocking)** — the Highlights request is the first page of the list route, so it also executes `listScopes` and returns up to 200 scopes that the Overview row never uses, on every friend profile view. Two indexed queries is acceptable on the free tier; consider a one-line note in design, or an explicit decision to leave it.
6. **EARS wording nits (confirmed, non-blocking)** — R5.3 ("THIS applies to every field…"), R8.6 (a WHEN clause with an embedded IF/THEN and a recording obligation) and the function-name subjects in R2.5 are not clean WHEN/IF/WHILE/WHERE/ubiquitous sentences. Reword without changing meaning or numbering.

</details>

<details>
<summary>Details</summary>

## Route registration has no covering test

Tasks 2.5 and 4.5 wire the repos and route plugins into `composeServices.ts` and `server.ts` through an optional `services.x !== undefined` registration block. Tasks 2.4, 4.2 and 10.3 each build a private Fastify instance with the plugin, so they prove the handler logic, not that production registers it. The stats `foodSharing` port is typed as required precisely so a forgotten harness fails typecheck; the two new service entries have no equivalent safeguard. The repo has hit this class of bug before (the `awardPins` wiring regression cited in `completion/__tests__/routes.test.ts`) and already has a structural precedent in `catalog/disney/__tests__/retirement.smoke.test.ts`, which reads `composeServices.ts` as text. Task 9.1's "works end to end" check would likely catch it manually, which is why this is not blocking.

## Accessibility behaviors with no row in the behavior map

R17.2 requires a role and label on the sharing switch, notice actions, "See all", sort and filter chips, search clear and retry, with checked state on the switch. R17.4 requires the private and empty states to carry text next to icons. The only automated check is `foodRatingFormat.prop.test.ts` over label strings. A component that builds the right string but never passes it to `accessibilityLabel` would pass every listed test. Because the execution-discipline map requires an assertion per behavior, the executor will have to invent these tests anyway; naming them in the tasks avoids a late "untested" finding.

## Requirement 10.5 wording versus the implementation

R10.3 and task 8.1 set the cache from the server echo, which already keeps the control and the notice predicate consistent. R10.5 then asks to invalidate the same cache, which would add a redundant refetch. Pick one and align the text so the test in task 8.2 asserts a single behavior.

## Open product questions

Two questions remain open by design and do not block implementation: A1 (blank dish fields but keep the three counts for an opted-out owner) and A11 (ship the notice and setting a release ahead of the read routes, or together). The private-versus-empty distinguishability (design decision 7) differs from the investigation's Q4 suggestion of indistinguishable states; it is a stated, reasoned choice.

</details>

<details>
<summary>Check-by-check results</summary>

1. **Accuracy**: pass. Verified on disk this pass: `user_submitted_locations.park` is `TEXT NOT NULL` with a seven-value CHECK (`0040`); `0004` drops `NOT NULL` on `experiences.park`; `profiles.user_id` is the primary key used by the batch join; `retryUnlessForbidden` is a module-private function at `useFriendProfile.ts:65`; `navigateToFriendsList` calls `navigate('YouAndCrew', { screen: 'YouAndCrewMain' })`; `FoodActivityStatistics` has the six fields the projection assumes and `FoodPersonalRecords` fields are optional so `{}` is valid; `stats/routes.ts` uses `requesterId`, `targetId`, `authorizeTarget`, `assembleResponse` as the design snippet does; `computeProgressShareStats` is at `composeServices.ts:849` and takes `senderId`; `sessionMiddleware`, `stats:` and `friendCompletions:` blocks exist as described; `0061` is the last migration, so `0062` is free; cited mobile and test files exist; `PARKS`, `Park` and `uuidSchema` are exported from shared; no `friendFoodRatings` code exists yet. A body-less `POST` is safe: the mobile client only sets `Content-Type` when a body is present.
2. **EARS**: pass with nits (issue 6). Every numbered criterion contains SHALL and uses WHEN/IF/WHILE/WHERE or the ubiquitous form.
3. **Coverage**: pass for every decision listed in the brief.
4. **Traceability**: pass. No requirement is unreferenced by a property or a task, and no `**Validates:**` or `_Requirements:_` line cites a missing number. The dependency graph lists every sub-task exactly once and no wave depends on a later one.
5. **Validator cleanliness**: pass by manual check; `get_diagnostics` was not available in this step. Design sections are Overview, Architecture, Components and Interfaces, Data Models, Configuration & Constants, External Interfaces, Correctness Properties (`### Property 1` to `22`, each with `**Validates:**`), Error Handling, Testing Strategy, which follows the steering order; tasks.md has `# Implementation Plan`, `## Tasks`, `## Notes`, `## Task Dependency Graph`; a regex search finds no checkbox other than `- [ ]`.
6. **Non-contradiction**: pass. The amendment section lists `food-item-logging`, `food-lists`, `stats-experience-redesign`, `expanded-stats`, `friend-stats-viewing` and `notification-center` with the investigation's requirement numbers; `git status` shows no edits to other specs.
7. **Tests**: pass with issues 1, 2 and 4. Layers match the repo's runners and the execution-discipline list (pg-mem repo, `server.inject` with 401/403/200/400, `migration0062.test.ts`, shared Zod valid and invalid, per-interaction RN tests with only `apiRequest` mocked, tagged fast-check at 100 or more runs, a route-layer stats regression). The deliberate example-driven treatment of mobile Properties 20 and 21 is explained in the design.

Not verified: no build, test run or diagnostics call was made, per the step instructions. Neon query plans and pg-mem function support are unverified, and the spec says so itself.

</details>

<details>
<summary>File map</summary>

- `.kiro/specs/friend-food-ratings/requirements.md`: Introduction, amendment table, glossary, Requirements 1 to 19, cross-spec dependencies; issues 3 and 6 land here.
- `.kiro/specs/friend-food-ratings/design.md`: key decisions, A1 to A11, DTOs, SQL, constants, external interfaces, Properties 1 to 22, error handling, testing strategy; issues 2, 4 and 5 land here.
- `.kiro/specs/friend-food-ratings/tasks.md`: 12 task groups, notes, dependency graph; issues 1, 2 and 4 land here.
- Reference only: `.agents/tasks/friend-food-ratings/investigation.md`, `.kiro/steering/*`.

</details>
