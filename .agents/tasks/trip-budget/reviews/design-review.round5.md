# Design Review (round 5): trip-budget

Reviewer: adversarial design-review subagent, document-only review (no build or test run; there is no code yet).
Scope: `.kiro/specs/trip-budget/{requirements,design,tasks}.md` and the additive amendments to `trip-expenses`, `restaurant-menu-display`, `crowd-calendar`, `trips`, `disney-source-resilience`, `account-deletion`, `admin-panel`, `legal-disclaimers-and-terms`, read against `.agents/tasks/trip-budget/investigation.md` and `ticket-price-source.md`, `.kiro/steering/*.md`, `AGENTS.md`, and the live source tree.
This file replaces the round 4 review, which is preserved unchanged as `design-review.round4.md` (`design-review.round2.md` is also untouched).
Severity scale: HIGH, MEDIUM, LOW (LOW is the NIT level of the review template). Verdict rule: any HIGH or MEDIUM gives CHANGES_REQUESTED.

## Verdict: CHANGES_REQUESTED

Counts: 1 HIGH, 5 MEDIUM, 14 LOW.

All 6 MEDIUM and 11 LOW findings of round 4 are folded into the text and I confirmed each against the current files (see "Round 4 follow-up"). The remaining problems are new: one of them (H1) makes an existing, always-run structural test fail by construction, and the five MEDIUM findings are a wrong arithmetic bound, a reused helper that is not as exact as the design claims (I ran it), a contradiction in the Florida-resident path, a user-facing message that stays wrong after a failed fetch, and a SQL join that can recreate duplicate conflict keys (the duplicate-key hazard is real in the local data, I queried it).

---

## Findings

### HIGH

#### H1. The mandated Budget authorization helper makes the existing `roleReader.guard.test.ts` fail
- Where: `requirements.md` R18.2 (line 337: "SHALL authorize with `resolveEffectiveRole(pool, tripId, userId)` from `services/trips/effectiveRole.ts`"), `design.md` "Authorization:" paragraph (line 753: new file `services/tripBudget/authz.ts` wrapping `resolveEffectiveRole` + `can`), `tasks.md` 15.1 (line 214), `trips/requirements.md` R25.2 and `trips/design.md` Property 30 implementation note (both name `resolveEffectiveRole`).
- Verified in source: `apps/api/src/services/trips/__tests__/roleReader.guard.test.ts` ("a caller's trip role is read in exactly three places") asserts, in the test "effectiveRole.ts is imported only by the three readers", that the set of files importing `effectiveRole.js` equals exactly `['composeServices.ts', 'services/trips/authz.ts', 'services/trips/repo.ts']`. `effectiveRole.ts` itself says the same in its header ("Exactly three readers use this module ... a guard test pins that"). A fourth importer, `services/tripBudget/authz.ts`, makes that test red. Nothing in the spec mentions this guard (grep for `roleReader` in the trip-budget, trips and account-deletion specs finds only an unrelated account-deletion design sentence). The Notes list of "structural guards you will trip" (tasks.md line 301) omits it too.
- Why it matters: every executor following R18.2 literally ships a red `npm run verify`. The only ways out are to extend the guard's allowlist (the repo rule, restated in R22.4 for the theme guard and in R18.8 for the roster guards, is to fix the code, not the allowlist) or to deviate from the spec ad hoc.
- Fix: do not import `effectiveRole.ts` from the Budget module. `assertTripMember(pool, userId, tripId)` in `services/trips/authz.ts` already returns the ACTING role (it calls `actingRole`, so the interim organizer rule of `account-deletion` R7 is applied) in one query and throws the opaque `trip_forbidden` for a non-member or unknown Trip. So:
  ```ts
  // services/tripBudget/authz.ts
  import { assertTripMember } from '../trips/authz.js';
  import { can, type TripAction } from '../trips/permissions.js';
  export async function requireBudgetAction(pool: DbPool, userId: string, tripId: string, action: TripAction): Promise<TripRole> {
    const role = await assertTripMember(pool, userId, tripId);          // trip_forbidden for non-member / unknown Trip, acting role
    if (!can(role, action)) throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
    return role;
  }
  ```
  This still uses the permission matrix (the point of R18.2 and trips R25.2: no "membership-only shortcut"), because `can(role, action)` runs. Amend, additively and with a note, R18.2 ("through `assertTripMember`, which applies the interim-organizer derivation, then `can(role, action)`"), the design Authorization paragraph, task 15.1, the trips Property 30 implementation note, and add `roleReader.guard.test.ts` to the guard lists in tasks 9.2/14.x/15.3 and to the Notes line 301. Add a Budget route test: a member of a trip with no active organizer acts as organizer for `edit_budget_settings` (proves the interim rule survives the wrapper).

### MEDIUM

#### M1. `BUDGET_READ_MAX_STATEMENTS = 12` is arithmetically wrong by at least one, and the test that guards it cannot see the difference
- Where: `requirements.md` R20.6 (line 372), `design.md` read-flow paragraph (line 95: "The exact list: six in `loadBudget` ..., three ticket reads, two LL reads, and one label lookup ...; that is 12 at most"), `tasks.md` 14.3 (lines 197-198), Property 26.
- Problem: the list omits the authorization query. Whether the route uses `assertTripMember` (one membership query) or `resolveEffectiveRole` (one roster query), it runs before `loadBudget`, so the real worst case is 6 + 1 (labels) + 3 (ticket) + 2 (LL) + 1 (auth) = 13, plus one more roster read in the rare no-active-organizer case. The task 14.3 test asserts "at most 12" with FAKE ticket and LL ports (5 of the statements issued by fakes), so it counts roughly 8 and passes while the production total is 13. R20.6 and the constant are therefore false and untested at the real number.
- Fix: either (a) state the constant as 14 and list all 14 (auth 1, optional roster 1, loadBudget 6, labels 1, ticket 3, LL 2), or (b) fold the control row and set rows into one statement. Whichever you pick, make the 14.3/15.3 test count statements with the REAL `ticketPrices` and `lightningLane` read repos over pg-mem (or a counting wrapper around the real SQL with livedb) for 1 and 300 lines, and assert equality of the two counts and `<= BUDGET_READ_MAX_STATEMENTS`. Update R20.6, the constant in design and task 1.1, and the read-flow paragraph together.

#### M2. `allocateProportionally` can return a NEGATIVE share to a zero-cent allocation, so the per-person tax and tip can go negative; Properties 1 and 2 do not check it
- Where: `design.md` `computeLine` (line 658: per-person tax and tip "come from `allocateProportionally(...)` with weights equal to the allocation cents"), Formulas (`personTax_i`), Property 1; `requirements.md` R6.6, R3.2 (allocations may be 0).
- Verified by running the helper (copied from `services/tripExpenses/allocation.ts`): `allocateProportionally(1, [0,1,1])` returns `[-1, 1, 1]`; `allocateProportionally(3, [0,1,1,1])` and `(1, [1,0,1])` are fine, but searching the small domain `total 0..6, weights 0..3` finds 13 inputs with a negative output; with all weights positive there are none. Cause: base shares use `Math.round`, ties round up, and the remainder correction subtracts from index 0 first, which is the zero-weight entry. R3.2 explicitly allows `amountCents = 0` (a free child meal, a comped item), and R6.6 feeds those allocations into the helper.
- Consequence: a person with a 0 allocation shows a tax of -1 cent and a by-person total of -$0.01; the sums still equal the line total, so Property 1/2 stay green. Property 3 (raising a rate never lowers a total) is only stated for line and party totals.
- Fix: in `computeLine`, call the helper only on allocations with weight > 0 and assign `taxCents: 0, tipCents: 0` to zero-weight allocations (keeping `perPerson` in allocation order), or write a Budget-local largest-remainder split. Add to Property 1: "every per-person tax, tip and line amount is a non-negative integer, and a zero-cent allocation gets exactly 0 tax and 0 tip", with a generated case that includes zero weights and a tie (e.g. total 1, weights `[0,1,1]`), and the same case as a unit test in task 12.1.

#### M3. The Florida-resident path is self-contradictory: a permitted but not-yet-fetched pair is reported as "unavailable", and one table row says no refresh is triggered
- Where: `requirements.md` R14.8 (line 280), R14.12 (line 284), R13.6; `design.md` `resolveTicketPrice` step 1 (line 564), Property 14, Error Handling row (line 1468: "`fl-resident` requested for a length that is not cached or is `not_offered` | quote with `flUnavailable: true`; no refresh is triggered by it"), task 18.2 precedence tests.
- Problem: R14.8 sets `flUnavailable: true` whenever the Florida set has no rows (`as_of` null), and step 1 returns it for "no set, or no rows". R14.12 (round 4 M2) then says: when `flUnavailable` is true the app renders the Florida text and ignores `cacheState`. Consider `TICKET_PRICES_GROUPS=std-gst,fl-resident`, `FL_RESIDENT_NUMDAYS=4`, a 4-day Florida quote before the first fetch. The pair is permitted, so `cacheState` would be `warming`, but `flUnavailable` is true, so the user sees "Florida resident price unavailable for 4 days; enter your price" while the very demand that triggers the fetch is under way; the next read shows a price. The error-table row above says the opposite of the planner ("not cached" is the stale/missing case that Requirement 13.6 and `decideRefresh` DO turn into a `full` run). A cold-start executor cannot tell which is intended, and the two readings produce different `noteDemand` behavior.
- Fix: define `flUnavailable` as true ONLY for a pair that will never be fetched: `discountGroup === 'fl-resident'` and (the pair is not in `allowedNumDaysByGroup` or `set.lastError === 'not_offered'`). A permitted pair with no rows yet is `flUnavailable: false` and `cacheState: 'warming'` (R14.12 already defines it). The resolver needs the permitted-pair flag as an input (add `pairPermitted: boolean` to its request or let the route overlay the flag), and the Error Handling row becomes two rows: "not permitted / `not_offered`: `flUnavailable: true`, no refresh triggered" and "permitted, never fetched: `warming`, a `full` run is triggered per `decideRefresh`". Update R14.8, Property 14 and add route test rows for the permitted-never-fetched Florida case.

#### M4. `cacheState = warming` stays true after a failed fetch, so the app says "try again in a minute" for up to 24 hours (or for ever when upstream drifted)
- Where: `requirements.md` R14.12 (`warming` iff `enabled && no block && set.asOf == null && pairPermitted && lastError !== 'not_offered'`), `design.md` Property 14, Error Handling rows for 5xx/timeout/invalid/sanity-guard, `tasks.md` 15.3, 18.2.
- Problem: `as_of` only advances on an ACCEPTED set. After any failed attempt (`network`, `timeout`, `http_status:*`, `invalid_response`, `empty`, `row_count_drop`, ...) `as_of` stays null and `last_error` holds the code. The claim-time `last_attempt_at` then blocks another `full` run for 24 hours (R12.3, Property 37). During that window the quote is still `warming`, and the app shows "Prices are being fetched, try again in a minute". If the cause is persistent (Disney changed the response shape, `invalid_response`), the daily retry fails again, a 60-minute failure block makes it `disabled` and then it returns to `warming`, so the user is told to wait indefinitely when the right message is "enter your price". The text is the one place the design promised to never present a cold cache as something it is not (R14.12's closing clause).
- Fix: add `set.lastError == null` to the `warming` predicate (a never-attempted or in-flight set), and treat a set with a recorded `lastError` other than `not_offered` as `ready` (so the "Add your price" text shows). Optionally add a fourth value `failed` with the text "Automatic ticket prices could not be fetched; enter your price". Update R14.12, the `PriceQuoteDTO.cacheState` comment, Property 14 and add route-test rows: "set with `lastError = 'network'`, `asOf = null`, switch on, no block => not `warming`".

#### M5. The Single Pass `experience_id` join can fan out and recreate duplicate conflict keys after the Map dedupe (the data has numeric-id collisions)
- Where: `requirements.md` R15.6 (line 297), `design.md` migration 0066 "One writer" paragraph (line 997: "`experience_id` resolved inside the statement by a join on `split_part(experiences.upstream_entity_id, ';', 1) = <numeric suffix of purchase_id>`"), Property 19, tasks 6.3.
- Problem: the repo dedupes `park|date|purchase_id` in a `Map` and then joins to `experiences` on the first segment of `upstream_entity_id` ONLY. If two Experiences share the numeric prefix, the join returns two rows for one input row, so the `INSERT ... ON CONFLICT (park, date, purchase_id) DO UPDATE` receives the same key twice and Postgres raises `21000` (the exact hazard `execution-discipline` and the design's own Notes tell the executor to prevent). I checked the local development database (read-only): `split_part(upstream_entity_id, ';', 1)` is NOT unique; two prefixes are shared (`17855368` by `...;entityType=Dining-Event` and `...;entityType=Event`, and `80010856` by `...;entityType=Dinner-Show` and `...;entityType=Entertainment`). Today's colliding rows are not attractions, but the design only verified two Single Pass ids (Seven Dwarfs Mine Train, TRON) and the join does not restrict the entity type. One colliding id would fail the whole single-pass batch on every pass (the failure is caught and retried, so it never recovers) and silently stop all Single Pass persistence.
- Fix: resolve the Experience in a way that returns at most one row per input and prefers attractions, for example `LEFT JOIN LATERAL (SELECT e.id FROM experiences e WHERE split_part(e.upstream_entity_id, ';', 1) = v.numeric_id ORDER BY (e.upstream_entity_id LIKE '%;entityType=Attraction') DESC, e.id LIMIT 1) x ON true`, or restrict to `e.upstream_entity_id = v.numeric_id || ';entityType=Attraction'` and fall back to NULL. Add a livedb case to `llRepo.livedb.test.ts`: two Experiences sharing the numeric prefix (one Attraction) -> one row stored, no `21000`, `experience_id` is the Attraction's.

### LOW

#### L1. Design drifted from the M4 (round 4) decision: `bpsOf` is still shown as defined in `budgetMath.ts`, `splitCentsEvenly` has no signature in design.md, `money.ts` is not in the Placement table, and the Formulas block still says `splitEvenly`
- Where: `design.md` line 653 (`export const bpsOf = ...` under `// budgetMath.ts`), Placement table (lines 20-30, no `money.ts`), Concrete Formulas (line 1110 "whole-party split (R3.4): splitEvenly(totalCents, ids)"); versus R3.4, task 1.1 and 12.1 ("defines no second copy").
- Fix: move the `bpsOf` snippet to a `// money.ts` block with `splitCentsEvenly(totalCents: number, count: number): number[]` (throws when `count < 1`), add `packages/shared/src/money.ts` to the Placement table, say `budgetMath.ts` imports it, and rename the Formulas line.

#### L2. The route contract uses `trip_not_found`, but R18.6 closes the error set to three codes
- Where: `design.md` route contract table (PATCH line: "A line that does not belong to `:id` answers `trip_not_found`"; DELETE traveler: "unknown id ... `trip_not_found`") versus `requirements.md` R18.6 ("add no new error code other than reuse of `trip_forbidden`, `trip_validation_failed` and `trip_party_deleted`").
- Fix: add `trip_not_found` (an existing code, 404) to R18.6's reuse list, or specify `trip_forbidden` for a foreign line id so nothing is leaked. Pick one and test it in 15.3.

#### L3. The horizon probe always uses `groups[0]`, and the handling of `404` for `std-gst` and of a second `401` is unspecified
- Where: `design.md` refresh flow (line 113: `client.getPrices({group: groups[0], numDays: 1, ...})`), Ticket client status mapping, Property 16, R13.5/R13.6.
- Problem: `TICKET_PRICES_GROUPS` is an unordered-looking comma list. If the operator writes `fl-resident,std-gst`, the probe asks for Florida 1-day prices, which the report says is not verified (only `numDays=4` was). A 404 there is a `not_found` on a probe with no set to attach `not_offered` to. Separately, `not_found` for `std-gst` and a second `unauthorized` are in neither the failure list nor the exempt list of the status mapping, so the consecutive-failure counter behavior is undefined for them.
- Fix: the probe always uses `std-gst` when it is configured (else the first configured group), and `TICKET_PRICES_GROUPS` validation requires `std-gst` to be present; state that `not_found` on `std-gst` and a repeated `unauthorized` are recorded as `http_status:<code>` and count as failures.

#### L4. "Block now" is documented as the instant kill switch but does not stop an in-flight run
- Where: `requirements.md` R13.10 ("takes effect on the next claim attempt"), `design.md` Admin section (review F23 "instant kill switch").
- Fix: either re-read `blocked_until` before every client call (one indexed single-row read per call, at most 12 per run) and stop on a hit, or soften the wording to "stops new runs; an in-flight run finishes (at most 12 calls)". The first is better because the operator uses it precisely when something looks wrong.

#### L5. A typical-estimate `as_of` that starts as a DATE and is stored in a TIMESTAMPTZ column can display one day early
- Where: `requirements.md` R5.10, `design.md` `lookupLlPrice` and `priceLabelText` (`asOfDate = wdwDateOf(asOf)`), `trip_budget_lines.price_as_of TIMESTAMPTZ`.
- Problem: if the sample date `2026-10-25` is stored as `2026-10-25T00:00:00Z`, `wdwDateOf` (America/New_York) prints "Oct 24, 2026". Property 21 only tests the quote path (a date string).
- Fix: define the date-to-instant conversion once (for example 12:00:00Z of the sample date, which is the same ET calendar date year-round) in `ticketPrices/dates.ts`, and add a round-trip assertion (`wdwDateOf(toInstant(d)) === d` for every date of a year including DST changes) plus a stored-line label test for a typical estimate.

#### L6. R14.5 states an observation the reports do not support
- Where: `requirements.md` R14.5 ("Magic Kingdom 199 and Animal Kingdom 184 on the same date were observed").
- Evidence: the report gives MK $199 on 2026-11-15 and AK $184 as the 2026-12-19..31 peak; it records no Animal Kingdom price for 2026-11-15. Per-park pricing itself IS verified (the 12-entries-per-date fact and the per-park ids).
- Fix: reword to the verified facts ("1-day base rows exist per park; for example the per-park Dec 2026 peaks differ: MK 209, DHS 204, AK 184") or label it **[A]**.

#### L7. The Terms-of-Use acceptance is recorded as a fact attributed to the owner, but the request only shows "lets go with option 1"
- Where: `requirements.md` Introduction and R21.1, `design.md` Decision record, admin page text (R21.1/R21.2), `admin-panel` R18.1.
- Problem: the quoted user messages do not contain the wording of "option 1", so I could not verify that it included accepting the Terms-of-Use exposure. The record is rendered in the admin UI as the owner's decision. No behavior depends on it (the kill switch stays off until the operator acts), so this is LOW.
- Fix: record the owner's message verbatim and its date ("2026-10-25: 'lets go with option 1', option 1 = <the exact option text from the thread>"), and have the owner confirm the wording before release; keep the revisit notice either way.

#### L8. Tier names from menu offers can exceed `EXPENSE_TIER_NAME_MAX` (40) and the tier name comparison is unspecified
- Where: `design.md` `menuPriceRefSchema.tier.name` (`.max(EXPENSE_TIER_NAME_MAX)` = 40, verified in `packages/shared/src/tripExpenses.ts`), `MenuPriceOffer.label` (item titles and group banners), R9.6(c).
- Fix: define `normalizeTierName(label) = label.trim().slice(0, 40)` next to `normalizeMenuName`, apply it when building the `tier` and on both sides of the verification, and add a 60-character banner-title case to `repo.lines.test.ts`.

#### L9. Lightning Lane Suggestions for undated or park-less planned items are unspecified
- Where: `requirements.md` R16.3 (distinct `(planned_date, park)` of `planned_items` with `is_lightning_lane = true`); the dining rule (R16.2) requires a date and an Experience, the LL rule does not.
- Fix: state that an LL item without `planned_date`, or whose Experience has no canonical park, proposes nothing (or proposes a line with `plannedDate: null`, `park: null` and the key `ll:multi:unassigned:other`), and test it.

#### L10. Stale review-document references
- Where: `design.md` Notes (line 1715: "`design-review.md` holds the round 4 review"), `tasks.md` Notes (the "latest one, round 4" sentence).
- Problem: this file is now the round 5 review; the round 4 review is `design-review.round4.md`.
- Fix: when the findings are folded in, change both sentences to name `design-review.round4.md` for round 4 and `design-review.md` for round 5, or drop the file-name references (the `(round N ...)` tags already carry the history).

#### L11. The no-worker structural test would trip on comments if written as a text scan
- Where: `design.md` Property 36 and `tasks.md` 8.4 (`structure.test.ts`: "none contains `setInterval`, a cron registration, `Worker`/`Queue` ...").
- Problem: the modules' own header comments will say "no worker", "no queue", "no cron". A plain regex over file text fails on them. The repo's guards (`roleReader.guard.test.ts`, `trip_memberships.guard.test.ts`) scan TypeScript AST literals/imports so comments never count.
- Fix: specify that `structure.test.ts` parses with `typescript` and inspects import specifiers, call expressions (`setInterval`) and identifiers, never comment text.

#### L12. The Expense tax and gratuity controls are still beyond the user's request
- Where: `trip-expenses` R16.6, trip-budget Property 42, task 19.1.
- Status: carried from round 4 L11. It is specified, tested and flagged for an owner veto; keeping it as a LOW reminder that the owner asked for menu-item picking only. No further spec change needed unless the owner declines.

#### L13. No requirement rejects a Traveler_Profile naming a person who is not on the Trip
- Where: `requirements.md` R4 (4.1 to 4.7), Property 33; `tasks.md` 14.1 implements "party checks".
- Problem: R3.1 covers allocations ("a person of a different Trip"), but R4 has no matching criterion, so the profile on-Trip check is implemented without a requirement or property.
- Fix: add an additive criterion to R4 ("reject with `trip_validation_failed` a profile whose member is not on the Trip or whose guest belongs to another Trip") and one line to Property 33 and task 14.1's `_Requirements:`.

#### L14. Task 9.2 says the roster guard "only changes when the Budget repo lands in task 14.2", but task 14.1 is the task that creates the repo and the pin
- Where: `tasks.md` line 149 (9.2) versus 14.1 ("Add the `services/tripBudget/repo.ts` `hits: 1` entry ... in this task").
- Fix: change 9.2 to "task 14.1".

---

## Round 4 follow-up (confirmed fixed in the current text)

- M1 diagnose never reads the kill switch: design `diagnose()` paragraph, `AdminTicketPricesPort.diagnose` type, R19.3, Property 38, tasks 8.3 and 10.1 agree.
- M2 `cacheState` rule: one total rule in R14.12 with precedence over `flUnavailable` (the residual problems are M3 and M4 above).
- M3 `adminPort.ts` created by task 8.3 with `AdminTicketPricesState` and `AdminDiagnoseResult` defined; 10.1 only re-exports.
- M4 `money.ts` in shared (task 1.1, R3.4, Properties 28 and 42 against the shared code); the leftovers are L1.
- M5 route contract table (201/200/204, PUT semantics, `price_as_of` re-stamp).
- M6 lock-first guest removal with a two-connection livedb test; the reasoning is consistent with PostgreSQL READ COMMITTED semantics (the `FOR UPDATE` conflicts with the FK check's `FOR KEY SHARE`; the later reference check takes a fresh snapshot). The 23503 mapping is stated.
- L1 to L11 of round 4: per-pass capture timestamps (migration 0066, R15.4), 364-day beyond-horizon target (R14.3, Property 14), ticket draft fields and the widened by-park label, typical estimate `asOf`, the admin Refresh-now exception in R12.3/R12.4/Property 15, reconcile scoped to the window sent, `BUDGET_MENU_ITEMS_PER_LINE_MAX`, `BUDGET_READ_MAX_STATEMENTS` (but see M1), `normalizeMenuName`, migration-number instruction, and the explicit requirement numbers on task 16.

## Checklist against the review brief

| Brief item | Result |
| --- | --- |
| (a) Ambiguity | H1, M3, M4 and L1, L2, L3, L8, L9 |
| (b) Assumptions as fact | Every [A] value from the reports is labelled and has a verification step. Unlabelled claims found: R14.5 same-date observation (L6) and the owner's Terms-of-Use acceptance wording (L7). Age brackets are stated as verified in the report (page text and API `ageGroup`), not [A] |
| (c) Every requirement has a Property and a task | Mechanically checked with a script over `requirements.md`, the `Validates:` lines and the `_Requirements:` lines: all 184 acceptance criteria have a Property; 182 appear in a task `_Requirements:` list and the other two (21.6, 22.7) are named in task 21's "all, including ..." line. No dangling references in either direction. L13 is a requirement gap, not a traceability gap |
| (d) Task order | Checked every wave of the Task Dependency Graph: all 71 tasks are placed (only the 15 parent headings are absent, correctly), ids are sequential, no duplicates, shared before consumers, migrations before repos, 8.3 before 8.4 before 10.1, 18.2 to 18.4 before 18.1, 3.4 before 9.2. No violation found |
| (e) Amended specs additive only | `git diff -U0` over the 8 amended specs: the only removed lines are the trailing comma of the last dependency-graph JSON entry in 8 files. No requirement, criterion, property or section was removed or renumbered. New numbers are the next free ones |
| (f) Cross-spec references | All named specs exist; `crowd-calendar` owns `0020_wait_time_intelligence.sql`; amended-spec numbers match the trip-budget task pointers. One cross-spec text needs the H1 amendment (`trips` R25.2 and Property 30) |
| (g) Config defaults | Every `TICKET_PRICES_*` and `LL_*` variable has a name, default and Zod rule; `TICKET_PRICES_ENABLED` default false with the boolean-parsing pitfall called out. No missing default |
| (h) Accessibility, theme, runners | R22.4, R22.5, R22.7, Properties 39, 40, 49; `makeStyles`/`useAppTheme`, `*.palette.ts`, `themeRetrofit.guard.test.ts`, Jest for mobile and Vitest for api/shared, text labels with `accessibilityLabel`, `accessibilityState.selected`. `HUB_SECTION_COLOR` and `definePalette` exist as described |
| (i) Hosting | No worker, no cron, no Redis on the Budget path, keep-alive never touches the database (docs/hosting.md already states it for the other crons; a docs update is tasked), Neon bounded and pruned, LL table pruned at 400 days. M1 is the only bound that is wrong |
| (j) ToS, WAF, kill switch, breaker, single flight, demand-driven | Complete and demand-driven (no cron, no `TICKET_PRICES_CRON_SECRET`): kill switch default false, Block now, honest UA, own client, WAF markers on any non-JSON or non-2xx body, consecutive-failure breaker, `start_date_rejected` block, Postgres claim stamped at claim time, probe never pulls on its own authority. Residual: L3, L4, M4 |
| (k) Endpoints, params, ids, units | Paths, `BEARER` header, `storeId=wdw`, `numDays` 1 to 10, 400/404/500 behaviours, `subtotal` not `pricePerDay`, cents conversion, id regex and tokens, 12 versus 8 entries, 433-day window, LL purchase types and prefixes, `price.amount` in cents all match the reports. L6 is the one unsupported sentence |
| (l) Migration number and rules | Highest existing file is `0064_account_deletion.sql` (verified), so `0065` to `0068` are free; additive, idempotent, `BEGIN/COMMIT`, `IF NOT EXISTS`, no edit of applied files; test names `migrationNNNN.test.ts`. `EXPECTED_USER_FK_COUNT` is 70 today (verified), +3 is right for three new `users(id)` columns |
| (m) Budget category enum separate | Yes: `BUDGET_CATEGORIES` with its own CHECK and the total `BUDGET_TO_EXPENSE_CATEGORY`; `PARKS` list in the CHECK equals `PARKS` in `enums.ts` (verified) |
| (n) Kiro Spec Format | Sections and headings as required; `- [ ]` checkboxes only (71 unchecked, 0 other markers; the amended `tasks.md` additions also use `- [ ]`); dependency-graph JSON parses; no stray control characters |

## Verified assumptions (read in source or data this round)

- `apps/api/migrations` ends at `0064_account_deletion.sql`; `EXPECTED_USER_FK_COUNT = 70`; `docs/hosting.md` exists and already states the keep-alive-never-touches-the-database rule for the other crons.
- `parseOrAppError` is module-private in `tripExpenses/routes.ts` (needs `export`); `findNonVisibleParties` is exported from `tripExpenses/repo.ts`; `splitEvenly` and `allocateProportionally` are exported from `tripExpenses/allocation.ts`; `classifyDisneyResponse` and `DISNEY_WAF_BODY_MARKERS` are exported from `catalog/disney/classify.ts`; `trip_party_deleted` is an existing 409 code.
- `assertTripMember` returns the acting role (interim organizer applied) in one query and throws `trip_forbidden` for non-member and unknown Trip; `resolveEffectiveRole` does a full roster read.
- `TripDetailScreen.tsx` has hand-written tiles in four `gridRow`s (Tiles 1 to 8) and `HUB_SECTION_DEFS`; `tripStructureRegression.test.tsx` asserts 9 sections and 16 screen names; `HUB_SECTION_COLOR` is a `definePalette` object with light and dark maps.
- `samplingService.ts` calls `liveClient.getEntitySchedule(park.id)` per park after computing `canonicalPark` and matches the exact name `'Lightning Lane Multi Pass'`.
- `menuRetrieval.ts` has no failure throttle (a stale row is retried on every demand); the shape-version refill inherits that existing behavior, it does not worsen it.
- `PARKS` equals the seven values in the `trip_budget_lines.park` CHECK; `EXPENSE_TIER_NAME_MAX` is 40, `EXPENSE_ITEM_NAME_MAX` is 100.

## Unverified or wrong assumptions

- Wrong as written: the claim that the Budget routes may import `effectiveRole.ts` (H1, fails an existing guard); the claim that `GET /budget` is at most 12 statements (M1); the claim that `allocateProportionally` yields valid non-negative per-person shares for every allocation vector (M2, run and disproved for zero weights); the claim that the numeric prefix of `upstream_entity_id` identifies one Experience (M5, 2 collisions in the local data); the pairing of `flUnavailable` precedence with a permitted-but-unfetched Florida pair (M3).
- Unverified by me and not provable from documents: Akamai behaviour from a Render egress IP; the timezone basis of Disney's `startDate >= today` rule; whether the production Sampling_Job is scheduled; the values of upstream `serviceStyle` beyond `Buffet`; the Single Pass id to Attraction mapping beyond two ids; Florida-resident lengths other than 4; the 143-of-448 NULL-park figure (local DB only). All are labelled [A] or tasked as operator gates in the spec, which is the right treatment.
- Not provable from the quoted request: what "option 1" contained (L7).
