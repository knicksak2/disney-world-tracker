# Design Review (round 4): trip-budget

Reviewer: adversarial design-review subagent, document-only review (no build or test run; there is no code yet).
Scope: `.kiro/specs/trip-budget/{requirements,design,tasks}.md` and the additive amendments to `trip-expenses`, `restaurant-menu-display`, `crowd-calendar`, `trips`, `disney-source-resilience`, `account-deletion`, `admin-panel`, `legal-disclaimers-and-terms`, read against `.agents/tasks/trip-budget/investigation.md` and `ticket-price-source.md`, `.kiro/steering/*.md` and `AGENTS.md`.

This file replaces the round 3 review. `design-review.round2.md` is untouched. The round 3 findings (M1 hub tile rendering, M2 string-typed money columns, M3 non-destructive Lightning Lane upsert, L1 to L8) are all folded into the spec text; I checked each one against the current files and they hold (see "Round 3 follow-up").

Severity scale used here: HIGH, MEDIUM, LOW (LOW is the NIT level of the review template). Verdict rule: any HIGH or MEDIUM gives CHANGES_REQUESTED.

## Verdict: CHANGES_REQUESTED

Counts: 0 HIGH, 6 MEDIUM, 11 LOW.

None of the six MEDIUM findings is an architectural problem. The demand-driven refresh model, kill switch, circuit breaker, single-flight claim, additive-only amendments and traceability are sound. The MEDIUM findings are places where a cold-start executor would hit a contradiction, a missing definition, a dependency-order error, or a Correctness Property that cannot be true as written.

---

## Findings

### MEDIUM

#### M1. Diagnose is specified both as "works with the kill switch off" and as "refuses with `disabled`"; following the wrong one deadlocks the operator launch gate
- Where: `design.md` Admin section, the `diagnose()` paragraph ("refuses with `blocked`, `already_running`, `too_soon` (...), or `disabled`") versus `design.md` `AdminTicketPricesPort.diagnose` type (refusal union has no `disabled`, comment says "works while the kill switch is off"), `requirements.md` R19.3 ("SHALL work while the Kill_Switch is false"), R13.2 (the operator gate requires three successful Diagnose runs BEFORE enabling), Property 38, `tasks.md` 10.1.
- Problem: the operator procedure is "run Diagnose three times, then set `TICKET_PRICES_ENABLED=true`". If an executor follows the `diagnose()` paragraph and refuses when the switch is off, the gate can never be satisfied. The type, the requirement and the task say the opposite, so the contradiction is only in one sentence, but that sentence is the one an implementer of `diagnose.ts` reads.
- Fix: delete `, or \`disabled\`` from the `diagnose()` paragraph, and add one sentence there: "`diagnose()` never reads `TICKET_PRICES_ENABLED`; its only refusals are `blocked`, `already_running` and `too_soon`." Add to `diagnose.test.ts` (task 8.3): "with `enabled=false` and no block, `diagnose()` makes the two calls and returns a result, not a refusal".

#### M2. `cacheState` and `flUnavailable` give two different texts for the same null-price Florida quote, and the default configuration produces the wrong one permanently
- Where: `requirements.md` R14.8 versus R14.12; `design.md` `PriceQuoteDTO.cacheState` and Property 14; `tasks.md` 15.3 and 18.2.
- Problem: R14.12 defines `warming` as `enabled && no block && set.asOf == null` and says `last_error` is not an input. R14.8 says a Florida quote for a length that is not in `TICKET_PRICES_FL_RESIDENT_NUMDAYS`, or whose set is `not_offered`, carries `flUnavailable: true`. Under the default `TICKET_PRICES_GROUPS=std-gst`, a Traveler_Profile with `discountGroup='fl-resident'` has no `fl-resident` set, `asOf` is null, so `cacheState='warming'` while `flUnavailable=true`. The planner never demands a non-permitted pair (R13.6), so it is never fetched. R14.12 then tells the mobile app to render "Prices are being fetched, try again in a minute" for a price that will never be fetched. The same happens for any `not_offered` set (it never has an `as_of`, R13.6).
- Fix: add a precedence rule to R14.12 and Property 14: "WHEN `flUnavailable` is true, THE Mobile_App SHALL render the Florida text and ignore `cacheState`", and define `cacheState` for a permanently unfetchable set as `ready`: `warming` iff `enabled && no block && set.asOf == null && the (group, numDays) pair is permitted by the configuration && set.lastError !== 'not_offered'`. The route needs the permitted-pairs map it already passes to `decideRefresh`. Add route-test rows to 15.3: "`fl-resident` with default config: `flUnavailable: true` and `cacheState: 'ready'`" and "`std-gst` never-fetched with the switch on: `warming`".

#### M3. Task order: the `AdminTicketPricesPort` interface is used in tasks 8.3 and 8.4 but defined in task 10.1 (two waves later), and two of its types are never defined anywhere
- Where: `tasks.md` 8.3 ("an `AdminTicketPricesPort` implementation (... interface defined in `services/admin/routes.ts`)"), 8.4 ("Construct ... the `AdminTicketPricesPort` object here"), 10.1 ("define and export `AdminTicketPricesPort`"), dependency graph (8.3 wave 8, 8.4 wave 9, 10.1 wave 10); `design.md` `AdminTicketPricesPort` block.
- Problem: 8.3 and 8.4 cannot typecheck (`execution-discipline` requires typecheck right after wiring) because the type they implement does not exist until 10.1. Separately `AdminTicketPricesState` and `AdminDiagnoseResult` appear in the port signature but are not defined in design, requirements or tasks (the diagnose result is only described in prose as `{ token: {...}, prices: {...}, maxPricingCalendarDate, adultMk1DayPriceCents }`). Two implementers would shape `readState()` differently, and `ticketPriceRoutes.test.ts` (10.1) renders from it.
- Fix: (a) move the interface and its two state/result types into a type-only file `services/ticketPrices/adminPort.ts` created by task 8.3 (`routes.ts` re-exports it in 10.1), or move the `routes.ts` edit (interface plus `ticketPrices?` option) into 8.3. (b) Add the two type definitions to design.md, for example:
  `AdminTicketPricesState = { enabled: boolean; control: { lastAttemptAt, lastProbeAt, blockedUntil, inProgressSince, observedHorizonDate, lastDiagnoseAt, lastStatus, lastError: string | null }; sets: { discountGroup, numDays, asOf, horizonDate, rowCount, windowDays, lastError }[]; totalRows: number; tableSize: string; config: Record<string, string | number | boolean> }` and
  `AdminDiagnoseResult = { token: { status, bytes, ms }; prices: { status, bytes, ms, wafMarker: boolean, startDateSent: string, retried: boolean }; maxPricingCalendarDate: string | null; adultMk1DayPriceCents: number | null }`.

#### M4. The mobile app is told to use `splitEvenly` and `bpsOf`, but both live only in `apps/api` and no shared or mobile home is specified
- Where: `requirements.md` R3.4 ("THE Mobile_App SHALL offer an 'everyone' control ... using `splitEvenly` from `services/tripExpenses/allocation.ts` semantics"); `design.md` `budgetMath.ts` (`export const bpsOf` in `services/tripBudget/`); `tasks.md` 12.1 (Properties 1, 3, 28 tested in `apps/api`), 18.2 ("everyone" split test), 19.1 (Expense form tests assert `bpsOf(subtotal, BUDGET_DEFAULT_TAX_BPS.dining)`); trip-expenses Property 16.
- Verified: `grep` finds `splitEvenly` / `allocateProportionally` only in `apps/api/src/services/tripExpenses/allocation.ts`; nothing in `apps/mobile/src` or `packages/shared/src`. Mobile can import only `@dwt/shared`.
- Problem: the "everyone" split (R3.4), the "Add estimated tax" and "Add estimated gratuity" actions (trip-expenses R16.6) and the picker subtotal all need integer-cent helpers in the client. Property 28 and Property 42 are asserted against the API copy, so the mobile behavior that users see is not the code under test. An executor will either copy the algorithm (drift risk, no property test on the copy) or import across workspaces (does not compile).
- Fix: add to `packages/shared/src/tripBudget.ts` (or a new `money.ts`) pure `bpsOf(cents, bps)` and `splitCentsEvenly(totalCents, count): number[]` (floor share, remainder one cent at a time in list order), listed in task 1.1 with unit tests and Properties 28 and 1's `bpsOf` half in `packages/shared`. Make `budgetMath.ts` import `bpsOf` from `@dwt/shared`, and make `BudgetLineFormModal`, `ExpenseFormModal` (19.1) and the tests import the shared ones. Keep `allocateProportionally` API-side (the mobile app only displays server-computed per-person shares).

#### M5. Request and response contracts of the mutating Budget routes are unspecified (PATCH line body, response bodies, status codes)
- Where: `design.md` routes table (`PATCH /trips/:id/budget/lines/:lineId`, `PUT .../travelers`, `PATCH .../settings`, `POST .../lines`, `POST .../suggestions/dismiss`); `requirements.md` R2.1 ("return it including its identifier"), R2.6; `tasks.md` 15.1, 15.3, 17.1, 18.x.
- Problem: only `budgetLineInputSchema` (create) exists. R2.6 says an edit applies "the same validation as creation" and "replaces its Budget_Allocations atomically with the submitted set", but the PATCH body is never named: partial or full replace? If partial, `allocations` omitted means keep, and the `superRefine` rules (user_entered needs `amountCents`, disney_menu needs menu refs) cannot run on a partial body. Also unspecified: what an edit does to `price_as_of` and the `priceSource`, and the success status and body for create (201 with `BudgetLineDTO`?), edit, delete (204?), profile upsert, settings patch, dismiss. The mobile tests assert "the network call and the on-screen change", and `budgetApi.ts` needs the response types.
- Fix: add to design.md a short route contract table: `PATCH /lines/:lineId` takes the full `budgetLineInputSchema` (PUT semantics, named `budgetLineReplaceSchema = budgetLineInputSchema`, `suggestionKey` ignored on edit) and returns the re-resolved `BudgetLineDTO`; `POST /lines` returns 201 + `BudgetLineDTO`; `DELETE` returns 204; `PUT /travelers` returns 200 + `TravelerProfileDTO`; `DELETE /travelers/:id` 204; `PATCH /settings` returns `BudgetSettingsDTO`; `POST /suggestions/dismiss` returns 204 and its body schema is `z.object({ suggestionKey: z.string().min(1).max(120) }).strict()`. State that an edit re-stamps `price_as_of` per the rule already written for create. Add the status code to each route's happy-path assertion in 15.3.

#### M6. The "atomic single-statement" guest removal does not close the race that Property 17 and task 14.4 claim it closes
- Where: `design.md` Departure paragraph (`removeTripGuest` becomes `DELETE ... WHERE ... NOT EXISTS (...) RETURNING id`, review F16); `trip-expenses/design.md` Property 17 ("including when the allocation is inserted concurrently between the check and the delete"); `tasks.md` 14.4.
- Problem (reasoned from PostgreSQL READ COMMITTED semantics; I could not run it here, see Unverified): a concurrent allocation insert holds a lock-only `FOR KEY SHARE` on the guest row through its FK check. The DELETE blocks on that lock, and when the inserter commits the DELETE proceeds without re-evaluating its `NOT EXISTS` subquery, because the row it waited on was only locked, not updated (the re-check of the WHERE clause happens only when the blocking transaction updated the row). The guest is deleted and `ON DELETE CASCADE` removes the just-committed allocation, which is exactly the silent loss the statement was meant to prevent. The pg-mem test described (sequential insert, then remove, assert rejection) passes under any implementation that checks, so it does not prove atomicity either. A concurrent guest deletion during an allocation insert also surfaces as FK error `23503`, which no error mapping covers (it would become a 500).
- Fix: use a lock-first transaction instead of relying on one statement: `BEGIN; SELECT id, sponsor_member_id FROM trip_guests WHERE id = $1 AND trip_id = $2 FOR UPDATE;` (this waits for in-flight allocation inserts holding KEY SHARE and blocks new ones), then the reference checks as ordinary statements (a fresh snapshot per statement under READ COMMITTED sees the committed allocation), then the `DELETE`, `COMMIT`. Map FK violation `23503` on the allocation and profile inserts to `trip_validation_failed`. Replace the claim in Property 17 and task 14.4 with a two-connection `ticketRepo`-style livedb test (insert allocation on connection A without committing, start removal on B, commit A, assert B rejects and the allocation row survives) in addition to the sequential pg-mem test. If the livedb test shows the single statement is in fact sufficient on the target Postgres version, keep the statement and record that result in design.md instead of the reasoning above.

### LOW

#### L1. One `ll_prices_captured_at` timestamp masks a stale Premier Pass (or Multi Pass) price when the other advances
- Where: `requirements.md` R15.4, `design.md` Migration 0066 "One writer", Property 19, 21.
- Problem: all four LL value columns are `COALESCE(EXCLUDED, stored)`, but the single `ll_prices_captured_at` advances whenever EITHER price is present. If a later pass carries a Multi Pass price but no Premier Pass price for a date, the old Premier price stays and is labelled `current` against the fresh timestamp.
- Fix: either store `ll_multipass_captured_at` and `ll_premier_captured_at` separately, or state in R15.4 and Property 21 that the label of a Premier Pass quote uses the timestamp only when the Premier price was part of the latest pass. Add one livedb case to task 6.3.

#### L2. The beyond-horizon ticket estimate is biased toward the holiday peak
- Where: `requirements.md` R14.3, `design.md` `resolveTicketPrice` step 4.
- Problem: "latest cached same-weekday date on or before the horizon" is always in the last week of the horizon. Disney's horizon was 2027-12-31, whose last week carries the holiday peak (verified in the report: Magic Kingdom $229 on Dec 25 and 31, 2027 versus roughly $189 to $199 typical). A June 2028 trip would be estimated at the peak price. It is labelled `Estimate`, so this is accuracy, not honesty.
- Fix: prefer the same weekday nearest to `startDate` minus 364 days (rounded to a cached date) when it lies inside the cached window, falling back to the current rule; add the case to `resolveTicketPrice.prop.test.ts`.

#### L3. Ticket Suggestion draft fields (`description`, `plannedDate`, `park`) are not specified
- Where: `requirements.md` R16.4, `design.md` `BudgetSuggestionDraft`, `deriveSuggestions`.
- Problem: R16.2 and R16.3 define date and park for dining and Lightning Lane drafts, but a `tickets` draft has only a key and per-person allocations. Without a rule, a multi-day ticket has `park = null` and lands in the by-park bucket "Other (resort)", which is a misleading label for a park ticket.
- Fix: add one sentence to R16.4: `description` = "<N>-day <option> tickets", `plannedDate` = start date, `park` = for a 1-day base ticket the `startingPark` mapping of R6.7, otherwise null. Consider labelling the null-park bucket "No park assigned" or documenting why "Other (resort)" is acceptable for tickets.

#### L4. `asOf` of a Typical_LL_Price is unspecified
- Where: `design.md` `lookupLlPrice` typical branch, R5.3 ("Estimate" followed by the as-of date), R5.10.
- Problem: `PriceStampDTO.asOf` is mandatory, but for a typical estimate there is no obvious instant. Using `now` makes the label read "Estimate, as of <today>" and change every day, which implies freshness the data does not have.
- Fix: define it as the `date` of the newest history sample used (so the label reads "Estimate, based on prices through <date>") or the line's `price_as_of` for stored lines; add to `lookupLlPrice.test.ts`.

#### L5. R12.3 and R12.4 universal statements ignore the admin "Refresh now" bypass
- Where: `requirements.md` R12.3 ("at most one full refresh attempt starts per 24 hours"), R12.4 ("No sequence of runs SHALL start two set-pulling runs within ..."), Property 15's last sentence; versus R19.2 (Refresh now bypasses the attempt cooldown).
- Fix: add "except an explicit admin Refresh now (Requirement 19.2)" to both and to Property 15.

#### L6. Reconcile can delete the WDW_Today row after a UTC-date start-date retry
- Where: `requirements.md` R11.8, R11.13; `design.md` reconcile ("start_date >= $today").
- Problem: when the 400 retry used `startDate = max(WDW_Today, UTC date)` and the UTC date is the next day, the fetched set has no row for WDW_Today, and reconcile deletes that day's existing rows.
- Fix: scope reconcile to `start_date BETWEEN <startDateSent> AND <endDate>` and keep the unconditional past-date prune.

#### L7. Per-line JSON size is not bounded in aggregate
- Where: `requirements.md` R20.4, `design.md` `menuPriceRefSchema` (up to 100 items), `BUDGET_ALLOCATIONS_PER_LINE_MAX` 50, `BUDGET_LINE_LIMIT` 500.
- Problem: counts are bounded individually, but 500 lines x 50 allocations x 100 items x roughly 150 bytes is hundreds of MB of JSONB per Trip in the worst case, against the Neon 1 GB budget the steering says to protect. Realistic use is tiny, and it needs an authenticated member to hit it.
- Fix: cap the total menu items per line (for example `BUDGET_MENU_ITEMS_PER_LINE_MAX = 100`, checked in `budgetLineInputSchema.superRefine`) and note that the Fastify `bodyLimit` bounds one request.

#### L8. Mutually inconsistent `loadBudget` statement counts
- Where: `design.md` Architecture ("a CONSTANT number (6)", then "about 10"), `tasks.md` 14.3 (eight listed reads including planned items, service styles and vs-actual).
- Fix: state the real list once (for example "constant, at most 12 statements for `GET /budget`; the planned-items and service-style reads belong to `GET /suggestions`") and make the 14.3 test assert that bound rather than "6".

#### L9. Server menu verification versus client name truncation
- Where: `requirements.md` R9.6, `design.md` `menuPriceRefSchema` (`name` max 100), `selectionToExpenseItems` (truncates to 100).
- Problem: R9.6 compares the selected `name` to the cached item name. A menu title longer than 100 characters cannot be stored in the `priceRef` untruncated, so it would be rejected or mismatched.
- Fix: say verification compares `name` after the same truncation (first 100 characters, trimmed) on both sides, and add a 120-character item-name case to `repo.lines.test.ts`.

#### L10. Stale references to the previous review document and migration number reservations
- Where: `tasks.md` Notes ("`design-review.md` is the round 3 review; its findings are folded into the text"), `design.md` Notes (review-tag explanation), `design.md` Data Models ("reserves 0065 to 0068") versus `photo-uploads/design.md` ("conditional `0065_*.sql`").
- Fix: when these findings are addressed, change the Notes sentence to name the current round or drop it; this file is now the round 4 review. For migrations, the existing "re-list `apps/api/migrations/` and shift all four together" instruction is adequate; add the same instruction to `photo-uploads` or note in trip-budget Notes that whichever spec lands first takes `0065`.

#### L11. `_Requirements: all backend_` is not a requirement reference
- Where: `tasks.md` task 16 (and task 21's free-text line).
- Fix: replace with explicit numbers (for example the union of the backend tasks' references) or use the `all` form other specs use. Also note that "Add estimated tax / gratuity" in the Expense form (trip-expenses R16.6) goes beyond the user's request; it is specified and tested, but confirm it is wanted, since expenses are exact and the user asked only for menu picking.

---

## Checklist against the review brief

| Brief item | Result |
| --- | --- |
| (a) Ambiguity a cold-start executor cannot resolve | M1, M2, M4, M5; L3, L4, L9 |
| (b) Assumptions presented as fact | Every [A] item is labelled and has a verification step (tax, tip, `serviceStyle`, start-date timezone, Single Pass id mapping, sanity ratios, 143/448 figure, Render egress). Not labelled: see "Unverified" below |
| (c) Each requirement has a Property and a task | Mechanically checked: all 184 acceptance criteria appear in a `Validates:` line and in a task `_Requirements:_` line. Cross-spec numbers share the namespace but are now separated by `_Cross-spec_` lines (round 3 L6) |
| (d) Task order | One violation: M3 (port interface). All other waves checked: shared before consumers, migrations before repos, 9.2 after 3.4, 18.1 after 18.2 to 18.4, 10.1 after 8.4 |
| (e) Amended specs additive only | Verified with `git diff -U0`: no requirement, criterion, property or section removed or renumbered in the 8 amended specs. The only removed lines are the trailing comma of the last JSON wave entry. New numbers (trip-expenses R16 / 2.13 / 10.6 / Property 14 to 21, crowd-calendar R19 / Property 25, restaurant-menu-display R8 / Property 12, trips R25 / Property 30, disney-source-resilience R16 / Property 17, admin-panel R18 / Property 11, account-deletion R21 / Property 35, legal R7 / Property 6) are all the next free numbers |
| (f) Cross-spec references | All named specs exist. `crowd-calendar` owns `0020_wait_time_intelligence.sql` (verified); its Requirement 3.9 throttle statement is correctly noted as not implemented in the current loop |
| (g) Config defaults | Every `TICKET_PRICES_*` and `LL_*` variable has a name, a default and a Zod validation rule. The two non-env constants (claim timeout 15 min, shape version 2) are named |
| (h) Accessibility, theming, test runner | R22.4, R22.5, R22.7, Properties 39, 40, 49; `makeStyles`/`useAppTheme`/`*.palette.ts`, `themeRetrofit.guard`, labels as text, `accessibilityState.selected`, Jest not Vitest are all stated and tasked. `wallet-outline` exists in the installed Ionicons glyph map (verified) |
| (i) Hosting | No worker, no cron, no Redis on the Budget path (app-level `rateLimit: {}` has no Redis client in `composeServices.ts`, so the global limiter is in-process), keep-alive never touches the database (docs update tasked), ticket table bounded and pruned (about 11 MB estimate, flagged unmeasured), LL single table pruned at 400 days. L7 is the only bound gap |
| (j) ToS, WAF, kill switch, breaker, single flight, demand-driven | Complete: kill switch default false, Block now, honest UA, own client (not the transport), WAF markers on every non-JSON or non-2xx body, consecutive-failure breaker, `start_date_rejected` block, Postgres claim with claim-time stamping, probe never pulls on its own authority. The model is demand-driven with no cron, as the user asked. M1 and M2 are the only operator-facing defects |
| (k) Endpoints, params, fields, ids, units copied from the reports | Matches report sections 1.2 to 1.5, 4.5, 6.3: paths, `BEARER` header, `numDays` 1 to 10, 400/500/404 behaviours, `subtotal` not `pricePerDay`, cents conversion, id regex and token table, 12 versus 8 entries, LL purchase types/id prefixes/`price.amount` in cents |
| (l) Migration number and rules | Highest existing file is `0064_account_deletion.sql`, so `0065` to `0068` are free (checked). Additive, idempotent, `BEGIN/COMMIT`, `IF NOT EXISTS`, no edit of applied migrations, test names `migrationNNNN.test.ts`. `EXPECTED_USER_FK_COUNT` is 70 today (verified), +3 is correct for the three new `users(id)` columns |
| (m) Budget category enum separate from expense CHECK | Yes: `BUDGET_CATEGORIES` and its own CHECK, mapped by the total `BUDGET_TO_EXPENSE_CATEGORY` |
| (n) Kiro spec format | Sections and headings are as required; no stray control characters or tabs; only `- [ ]` checkboxes were added to the amended `tasks.md` files; all dependency-graph JSON blocks parse and have no duplicate wave ids. Only L11 is a nit |

## Round 3 follow-up (confirmed fixed)

- M1 hub tile: R22.1, design Mobile step 4 and task 18.5 now render a fifth `gridRow` with the Budget `Pressable`; checked against `TripDetailScreen.tsx` (hand-written tiles, `HUB_SECTIONS` count 9, `screenNames` 16 in `tripStructureRegression.test.tsx`, `withAlpha` imported).
- M2 money types: migration 0068 uses `INTEGER`; `toCents` plus a string-returning fake-pool test cover the `SUM()` and `BIGINT` reads.
- M3 non-destructive upsert: R15.4, crowd-calendar R19.3, design and tasks 6.3 and 6.4 use `COALESCE(EXCLUDED.col, park_schedule_signals.col)` (the existing statement at `IntelligenceRepo.ts` lines 434 to 461 does use `= EXCLUDED.ll_multipass_price_cents`, so the change is real and the regression test is meaningful). L1 remains as a narrower follow-on.
- L1 to L8 of round 3: R8.4 wording, single `cacheState` rule, no corrupted characters (checked: zero control characters, zero tabs), tasks 15.1/15.2 pointing at 15.3, probe-claim wording, `_Cross-spec_` lines, serviceStyle query failure row.

## Verified assumptions (read in source or data this round)

- `resolveEffectiveRole(db, tripId, userId)` returns `TripRole | null`; `findNonVisibleParties(db, tripId, parties)` is exported from `tripExpenses/repo.ts`; `parseOrAppError` is module-private in `tripExpenses/routes.ts` (so the added `export` is needed); `classifyDisneyResponse` and `DISNEY_WAF_BODY_MARKERS` are exported from `catalog/disney/classify.ts`; `wdwToday`, `wdwDayOfWeek`, `wdwOffsetMinutes` exist in `wdwClock.ts`; `isSameOriginRequest` lives in `admin/sameOrigin.ts`; `photos?: AdminPhotoPort` and `ADMIN_SECTIONS` category "Data Ingestion & External Sync" exist in `admin/routes.ts`.
- `park_schedule_signals` is created by `0020_wait_time_intelligence.sql`; `upsertParkScheduleSignals` is an 8-array `unnest` with `ON CONFLICT (park, date)` assigning `ll_multipass_price_cents = EXCLUDED...`; `samplingService.ts` builds `schedRowsMap` per park inside the loop after `getEntitySchedule(park.id)` and skips a park with no `canonicalPark` before the schedule call, and uses the exact name `'Lightning Lane Multi Pass'`.
- `trips.start_date` is `NOT NULL`, so the Savings_Plan always has a start date. `PARKS` has the seven canonical values; `trips.ts` declares `startingPark` as `z.string().optional()`. Zod is 3.25.76 (`z.record(z.enum(...))` is a partial record, which the `taxBps` patch schema relies on).
- `removeTripGuest` today is a check-then-delete in two statements (relevant to M6); `tripExpenses/repo.ts` uses `SELECT ... FROM trips WHERE id = $1 FOR UPDATE` for the Expense cap (the pattern R2.4 copies).
- The account-deletion tombstone is per account (`placeholderId.ts`), so two deleted members on one line do not collide with `uq_budget_alloc_member`.
- Migration numbers, hub and screen-name counts, `EXPECTED_USER_FK_COUNT`, `THEMEPARKS_BASE_URL`, `MENU_FRESHNESS_MS`, `createMenuRetrieval`/`decideMenuFetch`, `projectMenus`/`formatDiningPrice`, and `ThemeParksScheduleEntry.purchases` all exist as the design says.

## Unverified or wrong assumptions

- Wrong as written: the claim that a single `DELETE ... WHERE NOT EXISTS` closes the guest-removal race (M6); the claim in R14.12 that `cacheState` can be used without a precedence rule next to `flUnavailable` (M2); the claim in the `diagnose()` paragraph that Diagnose refuses when disabled (M1).
- Unverified by me and not provable from documents: the PostgreSQL lock behaviour behind M6 (reasoned, not executed; the livedb two-connection test in the fix settles it); the Akamai behaviour from a Render egress IP; the timezone basis of Disney's `startDate >= today` rule; whether the production sampling job is scheduled (hosting.md does not document who calls `/internal/sampling/run`, so Requirement 20.7's operator gate is the only protection); all upstream `serviceStyle` values beyond `Buffet`. All four are already labelled [A] or tasked as operator gates in the spec, which is the right treatment.
- Not labelled but derived from a single observation: the age-bracket boundaries (adult 10+, child 3 to 9, under 3 free) come from Disney page text and API `ageGroup`; the report marked "Disney's rules can change [A]". The glossary states them as fact. Low risk because the price API, not the app, decides the bracket price.
