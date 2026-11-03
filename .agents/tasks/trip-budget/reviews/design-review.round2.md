# Design Review: trip-budget (and its additive amendments), round 2

Reviewer: adversarial design review, document-only. No build or test suite was run (there is no code yet). This review replaces the earlier round-1 document at the same path.

Scope read: all four files in `.kiro/steering/` plus `AGENTS.md`; the two reports `.agents/tasks/trip-budget/investigation.md` and `ticket-price-source.md` in full; `.kiro/specs/trip-budget/{requirements,design,tasks}.md` in full; the git diff of the eight amended specs (`trip-expenses`, `restaurant-menu-display`, `crowd-calendar` (owner of migration `0020`), `trips`, `account-deletion`, `admin-panel`, `legal-disclaimers-and-terms`, `disney-source-resilience`). Source files were read to check the design's claims about them (listed under Verified Assumptions).

## Verdict: CHANGES_REQUESTED

Counts: 2 HIGH, 9 MEDIUM, 16 LOW. Any HIGH or MEDIUM blocks approval.

Round 1's blockers are fixed (LL integration inside the per-park loop, one writer for the park-level columns, livedb tests for SQL that pg-mem cannot run, guard-test pins, per-request-shape Zod, consecutive-failure breaker, WAF markers on every non-JSON/non-2xx body). What remains is mostly new: two behaviors that defeat the design's own intent (an unbounded retry path against Disney, and Lightning Lane lines that can never leave "Estimate"), several under-specified contracts a cold-start executor would have to guess, a few dependency-order mistakes in `tasks.md`, and gaps in the amended `trip-expenses` spec.

Checklist outcome for the requested review axes:

| Axis | Result |
| --- | --- |
| (a) ambiguity | F3, F5, F6, F7, F11 (plus LOW items) |
| (b) unverified assumptions | Mostly labelled [A]. Gaps: F9 (data does not exist), F14, F24 |
| (c) every requirement has a Property and a task | Mechanically complete: all 174 criteria appear in a `**Validates:**` line and in a task `_Requirements:_` line (checked by script). Quality gaps: F10 (amended trip-expenses), F26 (Property 43 is a catch-all) |
| (d) task order | F7, F8 |
| (e) additive-only amendments | Pass. `git diff` of `.kiro/specs` shows only added lines plus the trailing comma on the previous wave entry in each `tasks.md` JSON block. No criterion or section was renumbered or removed |
| (f) cross-spec references | Spec names and requirement/property numbers all exist and do not collide (the duplicate `Property 12` in `crowd-calendar/design.md` is already in `HEAD`). Stale wording: F12. Wrong dependency: F7 |
| (g) config defaults | All `TICKET_PRICES_*` and `LL_*` variables have a name and default. Gap: F17 (no validation rules) |
| (h) accessibility and theme | Covered (makeStyles/useAppTheme, `*.palette.ts`, guard test, text labels, jest-expo). Hub tile detail missing: F6 |
| (i) hosting | No worker, no Redis on reads, keep-alive untouched, Neon bounded. Gap: F14, F20 |
| (j) ToS/WAF/kill switch/breaker/single-flight | Demand-driven (not cron) model is what is specified. Hole: F1 |
| (k) reports copied exactly | Endpoints, params, id regex, units and sizes match the reports. One derived claim to label: F24 |
| (l) migrations | `0065` to `0068` are free (highest on disk is `0064_account_deletion.sql`); rules stated. Harness gap: F17 |
| (m) budget category enum separate | Pass (own `CHECK`, `BUDGET_TO_EXPENSE_CATEGORY` total) |
| (n) Kiro format | Pass: required headings present, 71 checkboxes all `- [ ]`, properties all have `**Validates:**`. Glossary gap: F21 |

---

## Findings

### HIGH

**F1. [HIGH] A persistent `start_date_rejected` outcome removes the attempt cooldown, so any Budget read or quote can trigger Disney calls without limit.**
Where: requirements R11.13; design "Refresh flow", "Control claim", Error Handling row "Endpoint P answers 400 for a today-dated call"; Property 37; tasks 8.2, 8.3.
Problem: R11.13 says that when the one UTC-date retry also answers 400 the service "SHALL restore the `last_attempt_at` value that existed before the run's claim so that this outcome does not consume the attempt cooldown". Nothing else throttles the next attempt: `decideRefresh` reads only `lastAttemptAt`, `lastProbeAt`, `blockedUntil` and `inProgressSince` (it never looks at `last_error`/`last_status`), and no `blocked_until` is set for this outcome. The retry with `max(WDW_Today, UTC date)` already covers the timezone theory that motivated the restore, so the only way to reach this branch is a 400 for some other reason. In that case every Budget read, and every `POST /budget/quotes` (any Trip_Member can call it), whose planner says "stale" starts a new run: token call, `numDays=1` call, retry call, repeated for as long as the condition lasts. That defeats the 24-hour cooldown, the circuit breaker and the "honest low-volume" posture that the Decision record relies on, against an endpoint whose ToS exposure the owner accepted only on those terms.
Fix: Do not restore `last_attempt_at`. On `start_date_rejected` after the retry, keep the claim-time stamp (so the 24-hour cooldown is consumed) and also call `block(now + TICKET_PRICES_FAILURE_COOLDOWN_MINUTES, 'start_date_rejected')`. Change R11.13 accordingly (drop the "restore" sentence), the run-flow line "restore previous last_attempt_at; STOP", the `releaseControl` description (no `prev_attempt_at` argument, so the `WITH prev ... FOR UPDATE` CTE in the full claim can go), the Error Handling row, tasks 8.2 and 8.3, and rewrite Property 37 to: "for any run ending in `start_date_rejected`, `last_attempt_at` equals the claim time, `blocked_until = now + failure cooldown`, and N further `noteDemand` calls start zero runs and cause zero client calls". Add that test to `refreshService.test.ts`. Update `disney-source-resilience` R16.3 (it lists the block triggers) if the new trigger is added there.

**F2. [HIGH] A Lightning Lane line created beyond the real-price window is stored as `typical_estimate` and is then treated as a frozen snapshot, so it never upgrades to the real price.**
Where: design "Server-side amount resolution on create and edit" (`themeparks_ll`: "an estimate result is stored with `priceSource` `typical_estimate`") and `resolveLinePrices` ("if `priceSource` is `user_entered` or `disney_menu` or `typical_estimate`: effective = stored"); requirements R5.1, R5.4 to R5.6, R15.7, R15.8; task 14.2.
Problem: People plan months ahead and real Lightning Lane prices exist for about 31 days. The typical case is therefore: the user adds an LL line 3 months out, `lookupLlPrice` returns the typical estimate, the server stores `priceSource = typical_estimate`, and `resolveLinePrices` then returns the stored amount without consulting the store again. When the date enters the 31-day window and a real price exists, the line still shows "Estimate" with the old amount. This contradicts the product rule in the Introduction ("Estimates ... used only when no real price exists for that date") and the contrast with tickets, whose beyond-horizon estimates stay `disney_ticket_calendar` and do re-resolve on read. No requirement defines read behavior for a stored `typical_estimate` line (R5.4 to R5.6 cover `user_entered`, the two sourced kinds, and `disney_menu` only).
Fix: Keep `priceSource = 'themeparks_ll'` (with its `llPriceRef` and a snapshot amount and `asOf = now`) when the write-time lookup returned a typical estimate; the read path already yields `effectivePriceSource = 'typical_estimate'` and label `estimate` through `lookupLlPrice` and upgrades to the stored real price once it exists. Then either remove `typical_estimate` from the stored vocabulary (keep it only as an `effectivePriceSource` value) or state explicitly in R5 that a stored `typical_estimate` line with a `priceRef` is re-resolved like `themeparks_ll`. Update the design paragraph, `resolveLinePrices` text, R5.1/R5.5, the `budgetLineInputSchema` comment ("typical_estimate is never client-submitted"), and add tests that would fail today: a `resolveLinePrices` unit/property case (line created with no stored row, then a stored row appears: effective cents change and the label becomes `current`) and a pg-mem `repo.lines.test.ts` case asserting the stored `price_source` of an estimate-priced LL line is `themeparks_ll`.

### MEDIUM

**F3. [MEDIUM] For `disney_menu` lines the authoritative amount and the required `experienceId` are not specified.**
Where: requirements R9.2, R9.6; design `budgetAllocationInputSchema` (`amountCents ... // ignored for ticket/ll sources`), `createLine`, "Server-side amount resolution"; Property 34.
Problem: R9.2 says the allocation `amountCents` "SHALL equal" the sum of selected `priceCents` times quantity, and R9.6 verifies each item's `name` and `priceCents` against the cached menu, but nothing says who computes the amount or what happens when the submitted `amountCents` disagrees with the selection (a client could send verified items and a different amount). The design's "server-authoritative sourced prices" decision covers ticket and LL only. R9.6 also verifies "the cached `experience_menus` row of the linked Experience", with no rule for a `disney_menu` line that has no `experienceId` or is not `dining`.
Fix: Add to R9.6/R9.2 and the design: a `disney_menu` line requires category `dining` and a non-null `experienceId` (else `trip_validation_failed`); every allocation requires a `menu` `priceRef`; the server computes `amountCents = Σ priceCents × quantity` (or `tier.priceCents`) and stores that, rejecting a submitted `amountCents` that differs (or ignoring it; pick one and say so in the schema comment). Add repo test cases: amount mismatch, missing `experienceId`, quantity inflated beyond the stored amount, allocation without `priceRef`. Extend Property 34.

**F4. [MEDIUM] Contradiction on how a pending-deletion account's Traveler_Profile appears: "Deleted user" row versus omitted.**
Where: requirements R18.5; `account-deletion` R21.5 and the Appendix B addendum row ("Traveler_Profile list ... OMIT ... not listed"); design `TravelerProfileDTO` (`label`, `deleted`); Property 41; task 18.3 ("a profile labelled 'Deleted user' renders as text and its edit control is disabled").
Problem: R18.5 and R21.5 say existing rows naming such an account stay readable and are presented as "Deleted user"; the `TravelerProfileDTO` carries `deleted` and the label; task 18.3 tests that rendering. The Appendix B addendum (which the Budget repo must honour for the visibility guards) says the same profile is OMITTED from the list and produces no ticket Suggestion. Both cannot hold, and the guard tests and mobile tests would encode whichever the executor picks.
Fix: Choose one and make all places agree. Recommended: OMIT. Then drop `deleted` and the "Deleted user" label from `TravelerProfileDTO` (label stays a plain display name), change R18.5/R21.5/Property 41 to "profiles of such accounts are not returned; a write naming such an account returns `trip_party_deleted`; `DELETE` by profile id still succeeds", and change the task 18.3 test to assert the profile is absent. Keep "Deleted user" for Budget_Line/Allocation labels only.

**F5. [MEDIUM] Wire contracts typed `unknown`: `BudgetSuggestionDTO.draft` and `BudgetAllocationDTO.priceRef`.**
Where: design Shared contracts (`draft: unknown`, `priceRef: unknown | null`); R16.6; tasks 12.5, 14.3, 18.1, 18.2.
Problem: `@dwt/shared` is the single source of truth for wire shapes so the apps cannot drift. The suggestion draft is described only in prose ("budgetLineInput-shaped prefill with needsPrice/needsPeople flags"). The API task that builds it (12.5) and the mobile task that consumes it (18.1/18.2) run in different tasks with no shared type, so field names, which people are pre-filled, and how `needsPrice` is conveyed will diverge. `priceRef: unknown` forces unsafe casts in mobile code.
Fix: Define `BudgetSuggestionDraft` in `tripBudget.ts` with exact fields: `category`, `description`, `plannedDate`, `park`, `experienceId`, `priceSource`, `priceRef`, `applyTip`, `suggestionKey`, `partySize` (dining), `allocations: { memberId?; guestId?; amountCents?; priceRef? }[]` (empty when people are unknown), `needsPrice: boolean`, `needsPeople: boolean`. Type `BudgetSuggestionDTO.draft` as that and `BudgetAllocationDTO.priceRef` as `PriceRef | null`. Add a shared schema test for both.

**F6. [MEDIUM] The Hub tile change omits fields and edits the real file requires, and the "deliberate" regression update is not specified.**
Where: requirements R22.1; design Mobile (`{ key: 'budget', route: 'TripBudget', title: 'Budget', icon: 'wallet-outline' }` "to `HUB_SECTIONS`"); task 18.5; `apps/mobile/src/screens/trips/TripDetailScreen.tsx`, `TripDetailScreen.palette.ts`, `__tests__/tripStructureRegression.test.tsx`.
Problem (verified in source): `HUB_SECTIONS` is derived from `HUB_SECTION_DEFS` by `hubSectionsFor(scheme)`; each entry also needs a `body` string; `key` is typed `keyof typeof HUB_SECTION_COLOR.light`, so a `budget` entry needs light and dark colours added to `HUB_SECTION_COLOR` in `TripDetailScreen.palette.ts`; the route union `HubSection['route']` needs `'TripBudget'`. The regression test asserts `HUB_SECTIONS` has length 9 with an ordered key list, pins a snapshot "byte-for-byte", and asserts `screenNames` length 16. The spec names none of this, so the executor discovers it from red typecheck/tests and may weaken an assertion instead of updating it.
Fix: Rewrite R22.1/task 18.5 to name: add `'TripBudget'` to the route union; add a `budget` entry to `HUB_SECTION_DEFS` after `expenses` with `title: 'Budget'`, a concrete `body` (for example "Plan costs, save per week, compare to what you spent."), and `icon: 'wallet-outline'` (a valid Ionicons glyph); add `budget` light/dark values to `HUB_SECTION_COLOR` through `definePalette`; update the test to 10 sections with the new ordered key list, the regenerated snapshot diff limited to the new entry, and `screenNames` 17.

**F7. [MEDIUM] Admin wiring is unspecified, the admin task runs in the same wave as the task it depends on, and the admin-panel pointer cites the wrong dependency.**
Where: design Admin; tasks 8.4, 10.1 and the Task Dependency Graph (both in wave 9); `admin-panel/tasks.md` task 24.1; `apps/api/src/services/admin/routes.ts` (`AdminRoutesOptions`) and `composeServices.ts` (the `admin:` block).
Problem (verified): `AdminRoutesOptions` has no ticket-price port. The photos feature adds `photos?: AdminPhotoPort` and `composeServices.ts` passes `photos: adminPhotos` in the `admin:` block; no equivalent is named for ticket prices, so neither task says who defines the port or who edits `composeServices.ts`' admin block. Task 10.1 needs the service (8.3), the resolved config (8.4) and the composition (8.4), yet it is listed in wave 9 beside 8.4; both edit `composeServices.ts`. The admin-panel pointer says 24.1 "depends on trip-budget tasks 8.3 and 6.4"; 6.4 is the sampling integration and is unrelated.
Fix: Define `AdminTicketPricesPort` (`{ readState(): Promise<...>; runNow(): Promise<...>; diagnose(): Promise<...>; config: ... }`) and add `ticketPrices?: AdminTicketPricesPort` to `AdminRoutesOptions`; state that task 8.4 constructs the service and task 10.1 passes it in the `admin:` block. Move 10.1 to a wave after 8.4. Correct the admin-panel pointer to "depends on trip-budget tasks 8.3 and 8.4".

**F8. [MEDIUM] Task 18.1 depends on tasks 18.2 to 18.4 but is scheduled in the same wave.**
Where: tasks 18.1 to 18.4 and the Task Dependency Graph wave 19.
Problem: 18.1's tests require "Accept opens the form pre-filled" (18.2's `BudgetLineFormModal`), and its actions open the Travelers and Settings modals (18.3, 18.4). The screen imports all three. Tasks in one wave are meant to be independent; building 18.1 first would require stubs, which the execution rules forbid.
Fix: Put 18.2, 18.3 and 18.4 in wave 19 and 18.1 in a following wave (then 18.5/19.1 after it), and add a graph note: "18.1 imports the three modals; build them first".

**F9. [MEDIUM] Task 11 asks the executor to query observed `serviceStyle` values that the cache does not contain.**
Where: requirements R9.7; design Notes ([A] list); task 11.
Problem (verified): `serviceStyle` is dropped by today's projection (`menu.ts`/`diningMenuClient.ts` mention it only in a comment), so no cached `experience_menus.menus` JSON has it. After task 5 lands, rows gain it only when each restaurant is lazily refetched on demand. "Query the distinct `serviceStyle` values in cached `experience_menus`" at task 11 therefore returns nothing on a developer database, and the starting list (`prix fixe`, `family style`, `table service`) stays unverified while the checkpoint can be ticked.
Fix: In task 11 state the procedure: after task 5, request `GET /catalog/:id` for a defined sample (for example 30 restaurants across Dinner, Buffet, Character Dining, Bar–Lounge, Quick service) at least 1.5 s apart through the real transport, or run a one-off local script over `diningMenuClient` (deleted afterwards), then `SELECT DISTINCT m->>'serviceStyle' FROM experience_menus, jsonb_array_elements(menus) m`. State the fallback when values cannot be gathered: keep the constant as an [A] value, record that in the `suggestions.ts` comment and the final report, leave `applyTip` default false (already specified).

**F10. [MEDIUM] The amended `trip-expenses` spec leaves five new criteria without a Correctness Property and mislabels one.**
Where: `trip-expenses/design.md` Properties 14 to 16; `trip-expenses/requirements.md` 2.13, 10.6, 16.1, 16.5, 16.8.
Problem: Property 14 validates 16.2, 16.3; Property 15 validates 16.4, 16.5, 9.4 but its text is about request key sets (that is 16.4, not 16.5 "tiered suggestions are offered, never persisted unconfirmed"); Property 16 validates 16.6, 16.7. Nothing validates 2.13 (guest removal rejected while a Budget_Allocation references the guest), 10.6 (hub tile does not touch Expenses data), 16.1 (the control is offered only for itemized with a linked restaurant that has priced items), 16.5, or 16.8 (one shared component). The task entry 21.1 lists all of them, so the convention "every requirement has a Property and a task" fails inside that spec even though trip-budget's own properties cover the same behavior.
Fix: Add `trip-expenses` Properties 17 to 20 (or extend 14 to 16) with `**Validates:**` lines for 2.13, 10.6, 16.1, 16.5 and 16.8, each pointing at the trip-budget test that proves it (task 14.4, 18.5, 19.1, 17.3), and correct Property 15's line to `16.4, 9.4`.

**F11. [MEDIUM] Which ticket rows `readBook` returns is not specified, but the fallback steps need more than the exact date.**
Where: design Budget read flow step 4 ("needed ticket rows"), `resolveTicketPrice` steps 3 to 5; R14.3, R14.4; R20.6; task 8.2.
Problem: Steps 4 and 5 pick "the latest cached same-weekday date on or before the horizon" and "the nearest same-weekday date" for a `(group, numDays, age, option[, park])` key. That needs the date series for the key, not the single `start_date` row. If an executor loads only exact-date rows, every estimate path silently returns `add_your_price`; if it loads everything it may read tens of thousands of rows. Neither the SQL nor a row bound is given.
Fix: State that for each distinct `(discount_group, num_days, age_group, option_code)` in the collected keys, `readBook` selects all rows with `start_date BETWEEN today AND horizon_date` (and `park = ANY` for 1-day base), in one statement using `(discount_group, num_days, age_group, option_code) IN (...)`; give the worst-case bound (433 dates, at most 4 park codes per key, keys capped by the 500-line cap in practice) and add a repo test that the series is returned and a resolver test where only a non-exact date exists.

### LOW

**F12. [LOW] Stale and conflicting text in the amended `crowd-calendar` spec.**
`crowd-calendar/tasks.md` task 23.1 is titled "Extract, persist, and wire the destination schedule step", but the design removed the destination call. `crowd-calendar` R3.9 says the sampler "refreshes Schedule_Signals at most once per day" while the new R19.1 says park-level LL values ride the statement "on every pass", and the real loop upserts every pass (verified). Fix: retitle 23.1 ("... extraction inside the per-park loop"); add one sentence to R19 noting R3.9's throttle is not implemented in the code and that `LL_PRICES_STALE_HOURS` (72) tolerates either cadence.

**F13. [LOW] R14.9 promises the server park default for quotes, but a quote request has no line park.**
`priceQuoteRequestSchema` is the bare `priceRef` shape; `TICKET_PARK_BY_CANONICAL_PARK[line.park]` needs a Budget_Line. Fix: either add an optional `linePark` (one of `PARKS`) to the quote body and apply the mapping to it, or drop "quotes" from R14.9 and say the mobile picker defaults `priceRef.park` client-side (as the form already does).

**F14. [LOW] Lightning Lane prices depend on the sampling cron actually running in production, which nothing records.**
The investigation noted `park_schedule_signals` is empty locally and production is unverified; `docs/hosting.md` has no sampling-cron section. If `POST /internal/sampling/run` is not scheduled, every LL line is `add_your_price`. Fix: add to the Assumptions and Notes [A] list and to the operator launch gate: "confirm the sampling job is scheduled in production and `park_schedule_signals.ll_prices_captured_at` is advancing"; add a line to the `docs/hosting.md` update in task 8.4.

**F15. [LOW] Editing a line that still allocates to a departed member is undefined.**
R4.7 keeps allocations of a member who left; R3.1 and R18.8 reject persons "not on the Trip". Replacing the allocation set on edit (R2.6) therefore fails with `trip_validation_failed` unless the form drops the departed person, which silently changes totals. Fix: say that on edit, persons whose allocation already exists on the line are exempt from the on-Trip check (only newly added persons are validated), and add the repo test.

**F16. [LOW] `removeTripGuest` checks and deletes in two statements, now with a cascading FK.**
The guest-removal check (`NOT EXISTS` ... then `DELETE`) is not atomic, and `trip_budget_allocations.guest_id` is `ON DELETE CASCADE`; an allocation added between the two statements is silently deleted. Fix: do the delete as one statement `DELETE FROM trip_guests WHERE id = $1 AND trip_id = $2 AND NOT EXISTS (SELECT 1 FROM trip_budget_allocations WHERE guest_id = $1)` (and the existing three expense checks), checking `rowCount`, in task 14.4.

**F17. [LOW] Test harness and config validation gaps.**
(1) `trip_budget_settings` uses `jsonb_typeof(tax_bps) = 'object'`; no migration or harness in the repo uses `jsonb_typeof`, and the design's registration list (`btrim`, `char_length`, `lower`) omits it. Fix: add `jsonb_typeof` to the list and require the registered function to return real JSON types so the CHECK is genuinely exercised. (2) No validation rules for the list/number env vars. Fix: in task 8.4 require Zod validation that `TICKET_PRICES_GROUPS` is a non-empty subset of `std-gst,fl-resident`, `TICKET_PRICES_FL_RESIDENT_NUMDAYS` values are integers 1 to 10, the two ratios are in 0..1, the minutes/hours/day values are positive integers, and boot fails on a bad value (add cases to `config.ticketPrices.test.ts`).

**F18. [LOW] The row-count sanity guard can wedge refreshes as the window shrinks.**
`TICKET_PRICES_SANITY_MIN_RATIO` compares the new accepted row count with the previous `row_count`, but the fetch window is `today..horizon` and shrinks every day while the horizon is fixed between Disney price releases. After a long gap (or near the end of a horizon) a healthy set is rejected, and since `row_count` only updates on acceptance it stays rejected, retried daily. Fix: compare per window day (`rows / days(today..horizon)`) or store `row_count` with the window length it came from; add a property case with a long gap.

**F19. [LOW] `last_error` is free text rendered on an HTML page.**
`ticket_price_sets.last_error`/`ticket_price_control.last_error` are `TEXT` with reasons written by the service, and the admin page renders them. Fix: define a closed set of codes (`invalid_response`, `not_offered`, `start_date_rejected`, `row_count_drop`, `empty`, `invalid_price`, `unrecognized_fraction`, `http_status:<n>`, `network`, `timeout`, `waf_block`), never store upstream body text, and require HTML escaping through the existing `table` helper (add to `ticketPriceRoutes.test.ts`).

**F20. [LOW] A cold cache is indistinguishable from "no price exists".**
With the kill switch off, or on the first read after enabling (the refresh is in the background), quotes return `add_your_price` with `estimateReason: 'none'`, the mobile text says "Add your price", and creating a `disney_ticket_calendar` line is rejected. Users cannot tell "being fetched" from "not available". Fix: add `cacheState: 'disabled' | 'warming' | 'ready'` to `PriceQuoteDTO` (derived from the control row, no new I/O) and render "Prices are being fetched, try again in a minute" / "Automatic ticket prices are off; enter your price"; add one mobile test.

**F21. [LOW] Glossary omits terms used by the criteria.**
`Trip_Service`, `Mobile_App`, `Admin_Panel`, `Trip_Detail_View`, `Trip_Budget_Section`, `Budget_Screen`, `Balances_View`, `Expense_Ledger_Screen`, `Menu Item Picker`, `Sampling_Job` are used as actors without definition here. Fix: add them to the Glossary with "as defined by <spec>" where they come from another spec.

**F22. [LOW] Small pure-module ambiguities.**
(1) `daysBetween` is used by `freshness.ts`, `savingsPlan.ts` and `resolveTicketPrice.ts` but its home is unspecified; name one module (`ticketPrices/dates.ts`) and export it. (2) `computeLine` says the helper returns `[]` for a zero subtotal but `perPerson` must still list every allocation; say it emits zero tax/tip entries. (3) When both `park_unset` and `beyond_horizon`/`no_exact_date` apply, step 7 gives `park_unset` precedence implicitly; state it. (4) `priceLabelText` has no date format; specify `en-US` `MMM d, yyyy` (UTC date of `asOf`'s WDW date). (5) The claim SQL hard-codes `interval '15 minutes'` while `TICKET_CLAIM_TIMEOUT_MINUTES = 15` is a code constant; pass it as a parameter.

**F23. [LOW] Diagnose has no throttle, and the "instant" kill switch is an env change.**
`POST /admin/ticket-prices/diagnose` takes no claim and has no minimum interval, so a double click or a script can send repeated token and price calls; and `TICKET_PRICES_ENABLED` is an env var, so "turn it off instantly" (the story) means a Render redeploy. Fix: have diagnose take the same `in_progress_since` claim and a 60-second minimum between runs (stored on the control row); add an admin "Block now" action that sets `blocked_until` (same-origin enforced), and mention it next to the env var.

**F24. [LOW] Report-sourced [A] values and local-only counts presented as plain fact.**
R6.5 states "143 of 448 Catalog restaurants have `park` NULL" as fact; the investigation measured that on the local development database only. `TICKET_PRICES_SANITY_MIN_RATIO = 0.5` is marked "[A] reasonable default, tune later" in the report but carries no label in the spec. Fix: add "(local development database, 2026-10-25; production unverified)" to R6.5, and mark the sanity ratio and unrecognized-fraction defaults "[A] starting values" in the Configuration table.

**F25. [LOW] A horizon-moved probe can escalate into a full pull without consuming the full-refresh cooldown.**
R12.3 says at most one `full` attempt per 24 hours, but R12.4 lets a `probe_only` run pull the sets again when the horizon changed, stamping only `last_probe_at`. A probe run plus a full run can therefore do two 12-call pulls in a day. Fix: when a probe finds a moved horizon, require the same `full` claim (24-hour attempt cooldown) before pulling; otherwise record `horizon_changed` and wait. Add to Property 15.

**F26. [LOW] Property 43 is a catch-all, not a property.**
It bundles nine unrelated assertions (a) to (i) and 25 requirement numbers. The coverage rule is satisfied mechanically but a failing sub-assertion cannot be traced to one requirement. Fix: split into properties per theme (label text, no stored totals, settings bounds, link semantics, bounds/pruning, attribution/legal, Budget screen contents), keeping the Validates lines.

**F27. [LOW] The mapping from Zod failures to `trip_validation_failed` is not stated for the new schemas.**
Existing expense schemas pass `{ message: 'trip_validation_failed' }` on each check. The design snippets for `budgetLineInputSchema` and friends show none, and task 1.1 tests "reports a discriminator error for an unknown `kind`". Fix: state that every Budget route maps any `ZodError` (including discriminator errors) to `trip_validation_failed` through the same parse helper the expenses routes use, and assert it in the route validation tests (one per route is already required).

---

## Verified Assumptions

Read in source and found to match the design:

- Migrations: highest file is `0064_account_deletion.sql`; `0065` to `0068` are free. `park_schedule_signals` is created in `0020_wait_time_intelligence.sql` with primary key `(park, date)`, columns as described, and `crowd-calendar` is the spec that references it.
- `samplingService.ts` per-park loop: `canonicalPark` computed from live data (park skipped when null), then `schedRes = await liveClient.getEntitySchedule(park.id)`, a `schedRowsMap` keyed by `toISOString().split('T')[0]`, the exact-name `find(p => p.name === 'Lightning Lane Multi Pass')`, the first-valid-wins merge branch, and one `repo.upsertParkScheduleSignals(...)` per park; the whole body sits in one per-park `try/catch`. `ThemeParksPurchase` already has `id`, `name`, `type`, `price.amount`, `available` (no type extension needed).
- `ScheduleSignalRow` and `upsertParkScheduleSignals` are an 8-array `unnest` upsert with `ON CONFLICT (park, date)`.
- `classify.ts` exports `DISNEY_WAF_BODY_MARKERS` and `classifyDisneyResponse({ target, status, body })`, and only inspects markers for 403/429. `transport.ts` overrides the caller's User-Agent (`headers['User-Agent'] = userAgents[spec.target]`, line 214).
- `resolveEffectiveRole(db, tripId, userId)` in `services/trips/effectiveRole.ts` returns `TripRole | null`; `can`, `effectiveRole`, `MEMBER_ACTIONS`, `ORGANIZER_ONLY_ACTIONS` exist in `permissions.ts`; `findNonVisibleParties(db, tripId, parties)` is exported from `tripExpenses/repo.ts`; `allocateProportionally(total, {recipientId, weight}[])` and `splitEvenly` behave as the design describes.
- `departMember` in `trips/repo.ts` is one transaction containing the `DELETE FROM trip_memberships` statement; a `DELETE FROM trip_traveler_profiles` there adds no `trip_memberships` match, so the `services/trips/repo.ts` pin (5) stays correct. `ROSTER_ALLOWLIST` entries have the `{file, hits, reason}` shape the design uses.
- `dispositions.test.ts` has `EXPECTED_USER_FK_COUNT = 70`; the proposed entries match the `e(table, column, disposition, stage, chunkColumns, today, nullable)` shape. The purge tombstone is per account (`photo_reports` note), so two deleted accounts on one line do not collide on `uq_budget_alloc_member`.
- `profile_identity` exists (`0064`) and is already used by `tripExpenses/repo.ts`. `0060` `expense_shares.guest_id` is `ON DELETE CASCADE`, matching the Budget DDL. Partial unique indexes are used in `0064` and tested under pg-mem.
- `PARKS`, `parkSchema`, `uuidSchema` exist; `tripCalendarDateSchema` is in `shared/src/trips.ts`; `startingPark` is a free `z.string()`; zod is `^3.23.0` (so `z.record(z.enum(...), ...)` and `discriminatedUnion` over `.strict()` objects are valid).
- `wdwToday`, `wdwDayOfWeek`, `wdwOffsetMinutes` exist in `wdwClock.ts`. `isSameOriginRequest` is in `admin/sameOrigin.ts`; `ADMIN_SECTIONS` has the "Data Ingestion & External Sync" category; `config.ts` has the `PHOTOS_*` boolean transform (`'true' || '1'`) and `THEMEPARKS_BASE_URL`.
- Session middleware uses the DB adapter only, so Budget reads can be Redis-free.
- The `*.livedb.test.ts` precedent exists and creates a separate database, applies all migrations, and skips cleanly without Postgres.
- Report fidelity: endpoints T and P, headers, params and their failure codes, the id regex and mapping table, row counts (433 days: 5,196 and 3,464), body sizes, the 6.5% tax ratio, ThemeParks purchase ids/names/types and the cents unit all match `ticket-price-source.md` and `investigation.md`.
- Spec mechanics: 174 requirement criteria, 43 properties each with `**Validates:**`, every criterion referenced by a property and a task `_Requirements:_` line, no reference to a non-existent criterion, 71 task checkboxes all `- [ ]`, all amended specs additive.

## Unverified / Wrong Assumptions

- Wrong or contradictory: F1 (the restore branch), F2 (frozen `typical_estimate`), F4 (OMIT versus "Deleted user" for profiles), F7 (`6.4` cited as the admin dependency), F12 (stale "destination schedule" task title).
- Unverifiable until implementation, correctly labelled [A] by the spec: Disney's `startDate >= today` timezone basis, Akamai behavior from Render, Florida-resident lengths other than 4, Single Pass id to Attraction mapping, the `startingPark` string format, the food/LL/shopping tax rates and the dining tip default, the set of `serviceStyle` values (but see F9: the proposed way to verify it cannot work as written).
- Unlabelled: F14 (sampling cron running in production), F24 (local-only counts, report-[A] defaults).
- Not checked because there is no code: whether pg-mem accepts every Budget-repo statement the design calls "plain" (`FOR UPDATE` on `trips`, `ANY($n::uuid[])`, partial unique indexes are known-good from existing repos; `jsonb_typeof` is not, F17).
