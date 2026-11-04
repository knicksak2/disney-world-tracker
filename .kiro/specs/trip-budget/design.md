# Design Document

## Overview

Trip Budget adds a forward-looking cost plan to a Trip. It is a new sibling service to `trips` and `tripExpenses` (`apps/api/src/services/tripBudget/`), plus four supporting pieces that each live in the module that already owns the concern: a **ticket price cache** fed from Disney's public price calendar (`services/ticketPrices/`), a **Lightning Lane price store** fed by the existing ThemeParks.wiki sampling pass (`services/lightningLane/` plus a small change to `intelligence/samplingService.ts`), **structured menu prices** added additively to the menu projection (`catalog/disney/menu.ts`) and a shared pure price parser (`packages/shared/src/menuPricing.ts`), and a shared **Menu Item Picker** component used by both the Budget and Expense forms.

The central modelling decision is that **Budget and Expenses stay separate** (Budget = estimates, no payer or split; Expenses = exact, with payer, split and settlement) but are presented together in the hub, with an optional soft link and a budget-versus-actual comparison through a total category mapping. The Budget is stored at the **finest grain** (Budget_Line plus per-person Budget_Allocations, with a day and park on the line) and every view is a **pure function of that grain computed on read**. Prices are never fetched on the Budget read path: tickets and Lightning Lane prices are resolved at read time from Postgres caches by a pure function, and the only network traffic is a rare, single-flight, demand-triggered background refresh of ticket prices that is guarded by a kill switch (default off), a cooldown, and a circuit breaker.

### Key design decisions

1. **Separate tables, shared presentation.** Merging would force every Budget row to carry a payer and split it does not have, and would pollute Net_Balance (which must always sum to zero, `trip-expenses` Property 3). A soft `linked_expense_id` and a category mapping give the user the connection they asked for without merging.
2. **Finest-grain storage, derived views.** Per-line `planned_date` and `park` plus per-person allocations make party, person, day, park and category views plain group-bys of one dataset, so their totals agree by construction (Property 2).
3. **Read-time price resolution, snapshot fallback.** A ticket or Lightning Lane line stores a `priceRef` (a key) and a snapshot amount. On read the effective price is resolved from the current caches; if nothing resolves, the snapshot is used. A cache refresh therefore never writes to Budget tables (Requirement 5.8) and a user-entered price can never be overwritten (Property 17). Menu lines use their snapshot only, because menus can change or vanish.
4. **Tax and tip at read time from per-Trip basis points.** Stored amounts are pre-tax (what the sources publish). Tax and tip are applied by a pure function from `Budget_Settings`, allocated to people with the Budget-local largest-remainder `allocateShares` so per-person totals are exact and never negative (round 5 M2; the Expense helper `allocateProportionally` can return a negative share and is not used).
5. **Dedicated ticket client, not the shared `DisneyTransport`.** Chosen because the transport (a) force-overrides the User-Agent with a Chrome string (`disney-source-resilience` R5.2), which conflicts with the honest-UA mitigation, (b) retries WAF blocks with backoff (R4.2), which conflicts with the stop-at-first-block circuit breaker, and (c) draws from a Redis-backed limiter, which spends Redis commands. This is a documented exception to `disney-source-resilience` R1.3, recorded there as a new Requirement 16.
6. **Demand-driven refresh, no cron.** Following the `menuRetrieval.ts` pattern: serve the cache now, start one background refresh when stale. A global cooldown in Postgres bounds attempts to once per day across instances.
7. **A Postgres-backed control row** (`ticket_price_control`) holds the cooldown, the in-progress claim and the WAF block, so restarts and multiple instances behave.
8. **Server-authoritative sourced prices.** For `disney_ticket_calendar` and `themeparks_ll` lines the server resolves amounts from the `priceRef` and ignores client amounts; for `disney_menu` it verifies selected items against the cached menu without any network call.

### Decision record: ticket price automation (Requirement 21)

On 2026-10-25 the project owner decided to automate ticket prices from Disney's own price calendar and accepted the Terms-of-Use exposure. **Owner's message, verbatim (round 5 L7, Requirement 21.8):** "lets go with optiion 1. just make the spec ill have antigravity implement it", sent in reply to the thread that offered the ticket-price source options. The wording of "option 1" is not reproduced in the investigation reports, so this record does not claim more than the quoted message: the owner's written confirmation that option 1 includes accepting the Terms-of-Use exposure below is an operator launch gate before `TICKET_PRICES_ENABLED` is set to true (the switch defaults to false, so nothing depends on it until then). Facts behind the decision, from the second investigation (`.agents/tasks/trip-budget/ticket-price-source.md`, kept in the repo for reference):

- Disney's Terms of Use (last updated 2024-05-24) prohibit accessing or extracting Disney products by robot, spider, script or other automated means, including web scraping and compiling any data set or database, and limit use to personal, non-commercial purposes. A server-side job caching price JSON falls within the literal wording regardless of volume. This is not legal advice.
- `robots.txt` does not disallow the `/api/` or `/profile-api/` paths used; it is a separate matter and not permission.
- No cookies, CAPTCHA or authentication are bypassed; the token is issued to any anonymous visitor.
- There is no compliant machine-readable alternative for admission prices. The only compliant fallback is user-entered prices, which this design keeps as the always-available path.
- **If the app is ever monetized or widely distributed, revisit this decision before release.** Realistic worst cases are an edge block of the shared Render egress IP (which would also affect the existing menu fetches) or a notice from Disney.
- Mitigations built in: kill switch default off, demand-driven (not scheduled) refresh, 30-day staleness, 24-hour attempt cooldown, 1,500 ms request spacing, honest User-Agent, circuit breaker with 360-minute cooldown, no redistribution of raw prices, only endpoints T and P.

## Architecture

### Placement

| Concern | Location |
| --- | --- |
| Enums, constants, Zod, DTOs | `packages/shared/src/enums.ts` (additions), `packages/shared/src/tripBudget.ts` (new), `packages/shared/src/money.ts` (new: `bpsOf`, `splitCentsEvenly`, imported by `budgetMath.ts` and the mobile app; round 5 L1), `packages/shared/src/menuPricing.ts` (new), `packages/shared/src/dto/Menu.ts` (additive), `packages/shared/src/index.ts` (exports) |
| Menu projection and refill | `apps/api/src/services/catalog/disney/menu.ts`, `diningMenuClient.ts`, `catalog/menuRetrieval.ts`, `catalog/repo.ts` (additive) |
| Lightning Lane extract, typical, lookup | `apps/api/src/services/lightningLane/{llExtract,typicalPrice,lookupLlPrice}.ts` (pure), `repo.ts` (reads) |
| LL persistence | `apps/api/src/services/intelligence/samplingService.ts` and `IntelligenceRepo.ts` (additive methods) |
| Ticket prices | `apps/api/src/services/ticketPrices/` (see below) |
| Budget service | `apps/api/src/services/tripBudget/` |
| Permissions | `apps/api/src/services/trips/permissions.ts` (additive actions) |
| Account deletion | `apps/api/src/services/accountDeletion/dispositions.ts` (additive entries) |
| Admin | `apps/api/src/services/admin/ticketPriceRoutes.ts` (new, like `photoRoutes.ts`), `routes.ts` (`ADMIN_SECTIONS` entry and registration) |
| Wiring | `apps/api/src/composeServices.ts`, `apps/api/src/config.ts`, `apps/api/.env.example`, `docs/hosting.md` |
| Mobile | `apps/mobile/src/screens/trips/` (Budget screens), `apps/mobile/src/components/` (picker), `apps/mobile/src/navigation/TripsStack.tsx` |

`services/ticketPrices/` contents:

| File | Kind | Responsibility |
| --- | --- | --- |
| `idMapping.ts` | pure | `parseTicketProductId(id, requested)` and `buildTicketProductId(parts)` |
| `ticketMoney.ts` | pure | `dollarsStringToCents(s)` |
| `parsePricesResponse.ts` | pure | Zod validate endpoint P body; map to rows plus counters |
| `setAcceptance.ts` | pure | `acceptPricesSet(parsed, totalEntries, previous, windowDays, cfg)` sanity guard, per window day (review F18) |
| `dates.ts` | pure | `daysBetween`, `wdwDateOf`, `addDays`, `dateToInstant`: the one home of date arithmetic (review F22; `dateToInstant` round 5 L5) |
| `errorCodes.ts` | pure | `TICKET_ERROR_CODES` closed set and `normalizeErrorCode` (review F19) |
| `freshness.ts` | pure | `ticketAgeClass`, `worseLabel` |
| `cacheState.ts` | pure | `ticketCacheState(input)`: the one total function behind `PriceQuoteDTO.cacheState` (round 5 M3, M4) |
| `resolveTicketPrice.ts` | pure | `resolveTicketPrice(request, book, today, cfg)` |
| `refreshPlanner.ts` | pure | `decideRefresh(input)` |
| `ticketPriceClient.ts` | I/O | endpoints T and P over injected `fetch`; typed errors |
| `repo.ts` | DB | rows, sets, control claim, upsert, reconcile, prune |
| `refreshService.ts` | orchestration | single-flight run, circuit breaker, `noteDemand` |
| `diagnose.ts` | orchestration | two-call, write-nothing diagnostic |

### Budget read flow (no outbound, no Redis, fixed statement count)

```
GET /trips/:id/budget
  1. requireSession -> requireBudgetAction(pool, userId, tripId, 'view_budget')
                                       = assertTripMember (1 statement, +1 roster read only for a persisted member of a Trip with no
                                         active organizer) then can(role, 'view_budget')      (no Budget DB read before this)
  2. repo.loadBudget(tripId)            exactly 6 plain SELECTs (the whole request is at most BUDGET_READ_MAX_STATEMENTS = 14, see below), no json_build_object and no per-line query:
                                         (a) trip dates + day_touring_hours, (b) lines, (c) allocations WHERE line_id = ANY($1),
                                         (d) profiles, (e) settings, (f) vsActual expense sums; person labels via profile_identity
  3. keys = collectPriceKeys(lines)     pure
  4. ticketPrices.readBook(keys)        1 ticket-row SQL (below) + set rows + control row
     llPrices.readBook(keys)            2 SQL: stored rows for keys; history rows for typical fallback
  5. ticketPrices.noteDemand(...)       synchronous; schedules `void refresh()` only if decideRefresh says so
  6. resolveLinePrices -> computeBudget -> views, savings, vsActual     pure
  7. respond
```

**`ticketPrices.readBook(keys)` row selection (review F11).** The resolver's estimate fallbacks (`resolveTicketPrice` steps 3 to 5) need the whole date series of a key, not just the exact `start_date` row, so `readBook` loads, for every distinct `(discount_group, num_days, age_group, option_code)` among the collected keys, ALL cached rows with `start_date BETWEEN $today AND horizon_date` (where `horizon_date` is that key's set row; a key with no set row loads nothing), in ONE statement of the form

```sql
SELECT discount_group, num_days, age_group, option_code, park, start_date, price_cents, tax_cents, valid_end_date
  FROM ticket_prices
 WHERE start_date >= $1::date
   AND (discount_group, num_days, age_group, option_code) IN (<generated tuple list>)
   AND (option_code <> 'base' OR num_days <> 1 OR park = ANY($2::text[]))   -- 1-day base rows are per park; $2 = park codes the keys need ('mk','ep','hs','ak' when any key is unparked)
```

(the upper bound is applied in memory per key against its own set's `horizon_date`). Worst-case size per key: at most 433 dates (the observed 14-month horizon is about 433 days) times at most 4 park codes for a 1-day base key, and 433 rows for every other key; keys are bounded by the 500-line cap and in practice by the few distinct (group, days, age, option) combinations of a Trip, so the result is at most a few thousand rows. `readBook` adds no per-line statement. The pg-mem-incompatible tuple `IN` list is built as an OR-of-ANDs predicate when run on pg-mem; the `repo.readBook.test.ts` repo test asserts that the full series (not only the exact date) is returned, and `resolveTicketPrice.test.ts` has a case where only a non-exact date exists in the book and the nearest same-weekday estimate is returned.

The statement count of `GET /trips/:id/budget` is constant and bounded by the named constant `BUDGET_READ_MAX_STATEMENTS = 14` (round 4 L8, corrected by round 5 M1), regardless of the number of lines (Requirement 20.6). The exact list, in request order: **authorization 1** (`assertTripMember`'s single membership query, which carries the active-organizer flag) **+ 1 optional roster read** (`actingRole` reads the roster only for a persisted `member` of a Trip with no active organizer, the interim-organizer case of `account-deletion` R7), six in `loadBudget` ((a) to (f) above), one label lookup (`profile_identity`), three ticket reads (the ticket-row statement, the set rows, the control row) and two LL reads (stored rows, history rows); that is 1 + 1 + 6 + 1 + 3 + 2 = **14 at most** (13 in the common case), and a Trip with no ticket or LL keys issues fewer. The `requireSession` session lookup is a separate pre-handler and is not part of the bound; the statements of a background refresh started by `noteDemand` run after the response and are not counted (the count test runs with the kill switch off, so none is started). `planned_items` and the `experience_menus` service-style reads belong to `GET /trips/:id/budget/suggestions` (`listPlannedItemsForSuggestions`), not to `GET /budget`. **The guarding test must see every statement (round 5 M1):** it wraps the pool in a counting proxy that increments on every `pool.query` and on every `query` of a client obtained from `pool.connect()`, builds the routes with the REAL `ticketPrices` repo and the REAL `lightningLane` read repo (not fake ports; fakes issue no SQL and would hide 5 of the 14 statements) over pg-mem (or the `repo.load.livedb.test.ts` real-Postgres file for the statements pg-mem cannot run, see the Testing Strategy), and asserts for 1 line and for 300 lines that the two counts are EQUAL and at most `BUDGET_READ_MAX_STATEMENTS`, plus a third case for a persisted `member` of a Trip with no active organizer that asserts the count is the common-case count + 1 and still at most `BUDGET_READ_MAX_STATEMENTS`; the allocations are fetched with a second keyed query (`line_id = ANY($1::uuid[])`) rather than a JSON aggregate so the same SQL runs on pg-mem and on Postgres. Step 5 starts, but never awaits, a background job; with the kill switch off it returns immediately with no I/O.

### Refresh flow (background, demand-triggered)

```
noteDemand(demand) -> decideRefresh(...) ->
   'none'        : return
   'probe_only' | 'full' : void run(mode).catch(log)

run(mode):                                          -- mode is 'full' | 'probe_only' (| 'admin_full' for Refresh now)
  claim = repo.claimControl(mode)                   -- atomic UPDATE ... RETURNING (see Data Models); sets last_attempt_at
                                                    -- (full) or last_probe_at (probe_only) AT CLAIM TIME. The stamp is NEVER
                                                    -- restored or rewound by any outcome (review F1): every claimed run
                                                    -- consumes its cooldown.
  if !claim: return {status:'skipped'}
  consecutiveFailures = 0
  try:
    token   = client.getToken()
    if repo.readBlockedUntil() > now: finish with status 'blocked'      -- (round 5 L4) re-read before EVERY call after the first:
                                                                        -- one indexed single-row read of ticket_price_control per call
    probe   = client.getPrices({group: 'std-gst', numDays: 1, start: today, end: today})   -- 400 => one retry, see Ticket client
                                                    -- (round 5 L3) the probe ALWAYS uses 'std-gst' (TICKET_PRICES_GROUPS must contain it);
                                                    -- fl-resident numDays=1 is unverified and a 404 there would have no set to carry not_offered
    horizon = probe.maxPricingCalendarDate; repo.recordProbe(now, horizon)    -- stamps last_probe_at and observed_horizon_date
    sets    = plan sets (stale, missing, or horizon moved; only allowed (group, numDays) pairs; never not_offered), needed numDays first
    if mode == 'probe_only':
        if sets is empty: finish
        -- review F25: a probe never pulls on its own authority. Pulling sets needs the full-refresh attempt cooldown.
        if !repo.upgradeClaimToFull(attemptIntervalHours):   -- one conditional UPDATE: sets last_attempt_at = now() WHERE
                                                            -- in_progress_since IS NOT NULL AND (last_attempt_at IS NULL OR
                                                            -- last_attempt_at <= now() - interval)
            finish with status 'horizon_changed'            -- observed_horizon_date is already stored; the next demand that
                                                            -- passes the attempt cooldown runs a 'full' (see decideRefresh)
    for set in sets:  sleep(spacing);
         if repo.readBlockedUntil() > now: finish with status 'blocked'; STOP    -- (round 5 L4) Block now stops an in-flight run after at most
                                                                                  -- the one call already in progress; still at most 12 calls/run
         resp = client.getPrices({.., start: today, end: horizon})
         parse -> accept? -> upsert (dedupe Map) -> reconcile -> updateSet(as_of=now, horizon, row_count, window_days, last_error=NULL); consecutiveFailures = 0
         on WafBlock (403/429/marker in ANY non-JSON or non-2xx body): repo.block(now + BLOCK_COOLDOWN); STOP
         on network | timeout | 5xx | invalid_response: repo.recordSetError(set, err); consecutiveFailures++;
              if consecutiveFailures >= MAX_CONSECUTIVE_FAILURES: repo.block(now + FAILURE_COOLDOWN); STOP; else continue
         on not_found for fl-resident: recordSetError(set, 'not_offered'); continue (not a failure)
         on not_found for std-gst, or unauthorized again after the one token refetch (round 5 L3): recordSetError(set, 'http_status:404' | 'http_status:401');
              consecutiveFailures++ (same limit and block as a 5xx); a probe failure of this kind is recorded on the control row instead of a set
         on start_date_rejected (after the one retry): record 'start_date_rejected' on the set (or control row for the probe);
              KEEP the claim-time last_attempt_at (do not restore it); repo.block(now + FAILURE_COOLDOWN, 'start_date_rejected'); STOP
              -- (review F1) a persistent 400 therefore costs at most one token call + two price calls per attempt cooldown and is
              -- then blocked for TICKET_PRICES_FAILURE_COOLDOWN_MINUTES; N further noteDemand calls start zero runs.
    repo.pruneBeforeToday(today)
  finally: repo.releaseControl(status)
```

### Why the transport is not used

`DisneyTransport.request` always overwrites the caller's `User-Agent` with the per-target string (`transport.ts` line 214; for `web` it is `DISNEY_WEB_USER_AGENT`, a Chrome string), retries a `waf_block` per the Backoff_Policy (`disney-source-resilience` R4.2), and acquires a Rate_Limiter lease first (Redis-backed when API and worker are separate processes). It passes caller `Authorization` through. A response-size limit was not found in the transport source (it calls `res.text()`); the implementer SHALL read `transport.ts` and `rateLimiter.ts` and record the findings in the Ticket_Client header comment, but the decision does not depend on it: (a) and (b) alone are disqualifying. The dedicated client self-limits (single flight, one call per 1,500 ms, at most 12 calls per full run for one group) and shares only the destination host with the menu client.

## Components and Interfaces

### Shared contracts (`@dwt/shared`)

```ts
// enums.ts - additions
export const BUDGET_CATEGORIES = ['tickets','lightning_lane','dining','lodging','transportation','shopping','other'] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];
export const PRICE_SOURCES = ['disney_ticket_calendar','disney_menu','themeparks_ll','typical_estimate','user_entered'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];
export const PRICE_LABEL_KINDS = ['current','may_have_changed','estimate','add_your_price','your_price'] as const;
export type PriceLabelKind = (typeof PRICE_LABEL_KINDS)[number];
export const AGE_BRACKETS = ['adult','child','under3'] as const;
export const TICKET_OPTIONS = ['base','park_hopper','park_hopper_plus','water_parks_sports'] as const;
export const TICKET_DISCOUNT_GROUPS = ['std-gst','fl-resident'] as const;
export const TRAVELER_PASS_TYPES = ['none','annual_pass','dvc','other_discount'] as const;
export const LL_PASS_TYPES = ['multi','premier','single'] as const;
export const TICKET_PARKS = ['any','mk','ep','hs','ak'] as const;
// PARKS already exists in packages/shared/src/enums.ts (the seven canonical experiences.park values: 'Magic Kingdom','EPCOT',
// 'Hollywood Studios','Animal Kingdom','Typhoon Lagoon','Blizzard Beach','Disney Springs'); `parkSchema = z.enum(PARKS)` exists in
// schemas/primitives.ts. Import them; do NOT redefine.
export const TICKET_PARK_BY_CANONICAL_PARK = { 'Magic Kingdom': 'mk', 'EPCOT': 'ep', 'Hollywood Studios': 'hs', 'Animal Kingdom': 'ak' } as const;
// Used by (1) the mobile ticket picker's park default, (2) the server default in createLine/quotes (Requirement 14.9),
// (3) deriveSuggestions for the park of a ticket line.
export const TIP_BEARING_SERVICE_STYLES: readonly string[] = ['buffet', 'prix fixe', 'family style', 'table service']; // R9.7; lower-case; correct after querying observed values (task 11)

// tripBudget.ts - constants
export const BUDGET_LINE_LIMIT = 500;                 // R2.4
export const BUDGET_ALLOCATIONS_PER_LINE_MAX = 50;    // R3.3
export const BUDGET_DISMISSED_LIMIT = 200;            // R20.4
export const BUDGET_MENU_ITEMS_PER_LINE_MAX = 100;    // R20.4 (round 4 L7): total menu `items` entries across all allocations of one line
export const BUDGET_READ_MAX_STATEMENTS = 14;         // R20.6 (round 4 L8, round 5 M1): auth 1 + roster 1 + loadBudget 6 + labels 1 + ticket 3 + LL 2
export const BUDGET_DESCRIPTION_MAX = 200;            // R2.1
export const BUDGET_TOTAL_CAP_CENTS = 1_000_000_000;  // sanity cap for saved/target ($10,000,000.00)
export const BUDGET_DEFAULT_TAX_BPS: Readonly<Record<BudgetCategory, number>> = {
  tickets: 650,          // observed: tax/subtotal = 0.065 on every sampled Disney price row
  lightning_lane: 650,   // ASSUMPTION (unverified)
  dining: 650,           // ASSUMPTION (unverified); labelled in UI
  lodging: 0,            // users enter all-in lodging amounts
  transportation: 0,
  shopping: 650,         // ASSUMPTION (unverified)
  other: 0,
};
export const BUDGET_DEFAULT_DINING_TIP_BPS = 1800;     // ASSUMPTION (unverified); only for lines with applyTip
export const BUDGET_TO_EXPENSE_CATEGORY: Readonly<Record<BudgetCategory, ExpenseCategory>> = {
  tickets: 'tickets', lightning_lane: 'lightning_lane', dining: 'dining', lodging: 'hotel',
  transportation: 'transportation', shopping: 'shopping', other: 'other',
};
export const MENU_SHAPE_VERSION = 2;
```

```ts
// priceRef (stored as JSONB on a line and/or allocation; allocation-level takes precedence)
export const ticketPriceRefSchema = z.object({
  kind: z.literal('ticket'),
  discountGroup: z.enum(TICKET_DISCOUNT_GROUPS),
  numDays: z.number().int().min(1).max(10),
  ageGroup: z.enum(['adult','child']),
  optionCode: z.enum(TICKET_OPTIONS),
  startDate: tripCalendarDateSchema,
  park: z.enum(['mk','ep','hs','ak']).optional(),      // only meaningful for 1-day base
}).strict();
export const llPriceRefSchema = z.object({
  kind: z.literal('ll'),
  passType: z.enum(LL_PASS_TYPES),
  park: z.enum(PARKS),                                 // the seven canonical experiences.park values
  date: tripCalendarDateSchema,
  experienceId: uuidSchema.optional(),                 // Single Pass only
}).strict();
// ONE plain z.object for the menu kind (items XOR tier is enforced by the superRefine on `priceRefSchema` below), so that every
// member of the discriminated union is a ZodObject (zod 3 requires that; a ZodEffects or a nested z.union is not allowed).
export const menuPriceRefSchema = z.object({
  kind: z.literal('menu'),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(EXPENSE_ITEM_NAME_MAX),
    priceCents: z.number().int().positive().max(EXPENSE_AMOUNT_MAX_CENTS),
    priceLabel: z.string().max(60).nullable(),
    quantity: z.number().int().min(1).max(50),
    isAlcohol: z.boolean().optional(),
  }).strict()).min(1).max(100).optional(),
  tier: z.object({
    name: z.string().trim().min(1).max(EXPENSE_TIER_NAME_MAX),
    priceCents: z.number().int().positive().max(EXPENSE_AMOUNT_MAX_CENTS) }).strict().optional(),
}).strict();

/** The stored/submitted priceRef of an allocation: discriminated on `kind` for clear errors. */
export const priceRefSchema = z
  .discriminatedUnion('kind', [ticketPriceRefSchema, llPriceRefSchema, menuPriceRefSchema])
  .superRefine((v, ctx) => { /* kind 'menu': exactly one of `items` and `tier` is present */ });

export type PriceRef = z.infer<typeof priceRefSchema>;   // = TicketPriceRef | LlPriceRef | MenuPriceRef; used by BudgetAllocationDTO and BudgetSuggestionDraft

export const budgetAllocationInputSchema = z.object({
  memberId: uuidSchema.optional(),
  guestId: uuidSchema.optional(),
  // Authoritative amount rules (review F3), enforced by the repo's server-side amount resolution:
  //  - disney_ticket_calendar / themeparks_ll: IGNORED; the server resolves the amount from priceRef.
  //  - disney_menu: OPTIONAL; the server computes amountCents = sum(priceCents * quantity) over priceRef.items (or priceRef.tier.priceCents)
  //    and stores that; a submitted amountCents that differs from the computed value is REJECTED with trip_validation_failed.
  //  - user_entered: REQUIRED.
  amountCents: z.number().int().min(0).max(EXPENSE_AMOUNT_MAX_CENTS).optional(),
  priceRef: priceRefSchema.optional(),
}).strict().superRefine(/* exactly one of memberId/guestId */);

/** Sources a client may submit. 'typical_estimate' is an EFFECTIVE source only (review F2): no route accepts it and no route stores it. */
export const CREATABLE_PRICE_SOURCES = ['disney_ticket_calendar','disney_menu','themeparks_ll','user_entered'] as const;

export const budgetLineInputSchema = z.object({
  category: z.enum(BUDGET_CATEGORIES),
  description: z.string().trim().min(1).max(BUDGET_DESCRIPTION_MAX),
  plannedDate: tripCalendarDateSchema.nullable().optional(),
  park: z.enum(PARKS).nullable().optional(),
  experienceId: uuidSchema.nullable().optional(),
  priceSource: z.enum(CREATABLE_PRICE_SOURCES),      // 'typical_estimate' is rejected as input (review F2)
  // Line-level default for ticket/ll lines (allocation.priceRef takes precedence, see "Pure module data shapes"):
  priceRef: z.discriminatedUnion('kind', [llPriceRefSchema, ticketPriceRefSchema]).nullable().optional(),
  applyTip: z.boolean().optional(),                  // superRefine: true only when category === 'dining' (R2.3, R7.8)
  linkedExpenseId: uuidSchema.nullable().optional(),
  suggestionKey: z.string().max(120).optional(),
  allocations: z.array(budgetAllocationInputSchema).min(1).max(BUDGET_ALLOCATIONS_PER_LINE_MAX),
}).strict().superRefine(/* user_entered => every allocation has amountCents; disney_menu => category 'dining', experienceId non-null and every allocation has a menu priceRef (review F3); the TOTAL count of menu `items` entries summed over all allocations <= BUDGET_MENU_ITEMS_PER_LINE_MAX (round 4 L7) */);

/** Round 4 M5: PATCH /budget/lines/:lineId has PUT (full replace) semantics and takes exactly this schema; `suggestionKey` is accepted but ignored on edit
 *  (a line keeps the key it was created with). There is no partial-update schema. */
export const budgetLineReplaceSchema = budgetLineInputSchema;

/** Round 4 M5: body of POST /budget/suggestions/dismiss. */
export const dismissSuggestionBodySchema = z.object({ suggestionKey: z.string().min(1).max(120) }).strict();

export const travelerProfileInputSchema = z.object({
  memberId: uuidSchema.optional(), guestId: uuidSchema.optional(),
  ageBracket: z.enum(AGE_BRACKETS),
  ticketOption: z.enum(TICKET_OPTIONS).nullable().optional(),
  ticketDays: z.number().int().min(1).max(10).nullable().optional(),
  ticketStartDate: tripCalendarDateSchema.nullable().optional(),
  discountGroup: z.enum(TICKET_DISCOUNT_GROUPS).optional(),
  passType: z.enum(TRAVELER_PASS_TYPES).optional(),
}).strict().superRefine(/* exactly one of memberId/guestId */);

export const budgetSettingsPatchSchema = z.object({
  taxBps: z.record(z.enum(BUDGET_CATEGORIES), z.number().int().min(0).max(2500)).optional(),
  diningTipBps: z.number().int().min(0).max(5000).nullable().optional(),
  savedCents: z.number().int().min(0).max(BUDGET_TOTAL_CAP_CENTS).optional(),
  savingsTargetCents: z.number().int().min(0).max(BUDGET_TOTAL_CAP_CENTS).nullable().optional(),
}).strict();

export const priceQuoteRequestSchema = z.discriminatedUnion('kind', [
  ticketPriceRefSchema, llPriceRefSchema,   // same shapes as priceRef; `requests` is 1..40 of these. A quote has NO line, so the server applies
                                            // no park default to it (review F13, Requirement 14.9): the mobile picker sets priceRef.park itself.
]);
export const priceQuoteBodySchema = z.object({ requests: z.array(priceQuoteRequestSchema).min(1).max(40) }).strict();
```

**Zod failure mapping (review F27).** Every Budget route (all `GET`/`POST`/`PUT`/`PATCH`/`DELETE` under `/trips/:id/budget`) parses its body, params and query through the same parse helper the Expense routes use: `parseOrAppError(schema, input)` in `services/tripExpenses/routes.ts` (verified to exist; it is module-private today, so the executor adds the single word `export` to its declaration, an additive change that alters no behavior, and imports it), which converts any `ZodError` to `new AppError('trip_validation_failed', 'Invalid value for "<path>".', { field })`. This includes the `discriminatedUnion` errors for an unknown `kind`, the `superRefine` errors, and an unknown key rejected by `.strict()`. No Budget route lets a `ZodError` reach the global error handler (which would answer a different code). Each Budget route's `server.inject` validation test asserts the status and `code` `trip_validation_failed` for one malformed body of that route, and the unknown-`kind` case is asserted on the quotes route.

```ts
// DTOs (plain interfaces)
export interface PriceStampDTO { readonly effectivePriceSource: PriceSource; readonly priceLabelKind: PriceLabelKind; readonly asOf: string; readonly attribution: 'disney' | 'themeparks_wiki' | null; readonly soldOut?: boolean; }
export interface BudgetAllocationDTO { readonly id: string; readonly memberId: string | null; readonly guestId: string | null; readonly storedCents: number; readonly effectiveCents: number; readonly taxCents: number; readonly tipCents: number; readonly priceRef: PriceRef | null; }
export interface BudgetLineDTO extends PriceStampDTO { readonly id: string; readonly tripId: string; readonly createdBy: string; readonly category: BudgetCategory; readonly description: string; readonly plannedDate: string | null; readonly park: string | null; readonly experienceId: string | null; readonly priceSource: PriceSource; readonly applyTip: boolean; readonly linkedExpenseId: string | null; readonly suggestionKey: string | null; readonly subtotalCents: number; readonly taxCents: number; readonly tipCents: number; readonly totalCents: number; readonly allocations: readonly BudgetAllocationDTO[]; }
export interface BudgetBucketDTO { readonly key: string; readonly label: string; readonly totalCents: number; readonly sponsorMemberId?: string | null; }
export interface SavingsPlanDTO { readonly targetCents: number; readonly savedCents: number; readonly remainingCents: number; readonly daysUntilStart: number; readonly weeksRemaining: number | null; readonly perWeekCents: number | null; readonly status: 'on_track' | 'saving' | 'trip_started_or_past'; }
export interface VsActualDTO { readonly expenseCategory: ExpenseCategory; readonly budgetedCents: number; readonly actualCents: number; }
export interface BudgetDTO { readonly tripId: string; readonly lines: readonly BudgetLineDTO[]; readonly travelers: readonly TravelerProfileDTO[]; readonly settings: BudgetSettingsDTO; readonly totalCents: number; readonly subtotalCents: number; readonly taxCents: number; readonly tipCents: number; readonly byPerson: readonly BudgetBucketDTO[]; readonly byDay: readonly BudgetBucketDTO[]; readonly byPark: readonly BudgetBucketDTO[]; readonly byCategory: readonly BudgetBucketDTO[]; readonly savings: SavingsPlanDTO; readonly vsActual: readonly VsActualDTO[]; }
/** Review F5: the exact prefill the server derives and the mobile form consumes. Defined in tripBudget.ts next to BudgetSuggestionDTO. */
export interface BudgetSuggestionDraft {
  readonly category: BudgetCategory;
  readonly description: string;
  readonly plannedDate: string | null;                 // YYYY-MM-DD
  readonly park: (typeof PARKS)[number] | null;        // one of PARKS, per Requirement 6.7
  readonly experienceId: string | null;
  readonly priceSource: (typeof CREATABLE_PRICE_SOURCES)[number];
  readonly priceRef: TicketPriceRef | LlPriceRef | null; // line-level default; null for dining (menu refs live on allocations)
  readonly applyTip: boolean;                          // dining only; true iff TIP_BEARING_SERVICE_STYLES contains the cached serviceStyle
  readonly suggestionKey: string;
  readonly partySize: number | null;                   // dining only: planned_items.party_size; null otherwise
  /** One entry per KNOWN person (tickets: the matching Traveler_Profiles; dining/LL: empty, people are unknown). amountCents/priceRef are
   *  present only when the server could resolve them (tickets). */
  readonly allocations: readonly { memberId?: string; guestId?: string; amountCents?: number; priceRef?: PriceRef }[];
  readonly needsPrice: boolean;                        // true when the form must collect a price (menu pick, or no resolvable price)
  readonly needsPeople: boolean;                       // true when allocations is empty and the user must choose people
}
export interface BudgetSuggestionDTO { readonly suggestionKey: string; readonly kind: 'dining' | 'lightning_lane' | 'tickets'; readonly draft: BudgetSuggestionDraft; }
export const budgetSuggestionDtoSchema: z.ZodType<BudgetSuggestionDTO>; // shared schema test: one valid and one invalid draft (missing needsPrice; park not in PARKS)
export interface PriceQuoteDTO extends PriceStampDTO {
  readonly priceCents: number | null; readonly taxCents: number | null; readonly resolvedStartDate?: string; readonly parkAssumed?: boolean; readonly flUnavailable?: boolean;
  readonly estimateReason?: 'beyond_horizon' | 'no_exact_date' | 'park_unset' | 'typical' | 'stale' | 'fl_unavailable' | 'none';
  /** Review F20, round 4 M2, round 5 M3 and M4. Ticket quotes only (Lightning Lane quotes omit it). The output of the ONE total pure function
   *  `ticketCacheState` (Requirement 14.12), first match wins:
   *    'disabled' iff !enabled || blockedUntil > now;
   *    'ready'    iff !pairPermitted || set.lastError === 'not_offered' || set.asOf != null   (nothing to wait for, or rows exist);
   *    'failed'   iff set is null/asOf null AND set.lastError != null                          (the last fetch failed: never say "try again in a minute");
   *    'warming'  iff never fetched, no recorded error, AND (a run is in flight OR lastAttemptAt is null/older than attemptIntervalHours,
   *               i.e. this very read starts a full run);
   *    'failed'   otherwise (never fetched, no error, nothing in flight, attempt cooldown active: an earlier run died before this set).
   *  Derived from the control row, the set rows the quote read already loads and the allowedNumDaysByGroup configuration map: no extra I/O.
   *  PRECEDENCE: when flUnavailable is true (fl-resident AND (pair not permitted OR set.lastError === 'not_offered')) the mobile app renders
   *  the Florida-resident text and ignores cacheState. A permitted, not-yet-fetched Florida-resident pair has flUnavailable false. */
  readonly cacheState?: 'disabled' | 'warming' | 'failed' | 'ready';
}

export interface TravelerProfileDTO {
  readonly id: string;
  readonly memberId: string | null;          // exactly one of memberId / guestId is non-null
  readonly guestId: string | null;
  readonly label: string;                    // display name or guest name. Profiles of pending_deletion/purged accounts are OMITTED from the
                                             // list (review F4, matching account-deletion Appendix B), so no 'Deleted user' value and no
                                             // `deleted` flag exist on this DTO. 'Deleted user' appears only on Budget_Line allocation labels
                                             // and by-person buckets.
  readonly ageBracket: 'adult' | 'child' | 'under3';
  readonly ticketOption: TicketOption | null;
  readonly ticketDays: number | null;        // 1..10
  readonly ticketStartDate: string | null;   // YYYY-MM-DD
  readonly discountGroup: TicketDiscountGroup;
  readonly passType: TravelerPassType;
}
export interface BudgetSettingsDTO {
  readonly taxBps: Readonly<Record<BudgetCategory, number>>;   // EFFECTIVE rates: stored override merged over BUDGET_DEFAULT_TAX_BPS
  readonly taxBpsIsDefault: Readonly<Record<BudgetCategory, boolean>>; // true when no override is stored (UI shows the assumption label for unverified ones)
  readonly diningTipBps: number;             // effective: stored override or BUDGET_DEFAULT_DINING_TIP_BPS
  readonly diningTipBpsIsDefault: boolean;
  readonly savedCents: number;
  readonly savingsTargetCents: number | null;
}
```

`priceLabelText(kind, source, asOfDate)` (shared, pure) produces the visible strings of Requirement 5.3 so the mobile tests and the API agree. `asOfDate` is the `YYYY-MM-DD` WDW calendar date of the `asOf` instant (API: `wdwDateOf(asOf)`), formatted by a pure formatter in the same shared module as `en-US` `MMM d, yyyy` computed from the date's year, month and day components with a fixed month-name table (no `Intl`, no `Date` local-zone parsing, so Node, Hermes and the tests agree): `2026-10-25` renders `Oct 25, 2026`. Example outputs: `Disney price, as of Oct 25, 2026`; `Disney price, as of Oct 25, 2026 (may have changed)`; `Estimate, as of Oct 25, 2026`; `Add your price`; `Your price`.

### Pure module data shapes (api-side, no I/O)

These interfaces are the contract between the repos and the pure modules; two implementers must produce the same shapes. They live in `services/tripBudget/types.ts`, `services/ticketPrices/types.ts` and `services/lightningLane/types.ts`.

```ts
// tripBudget/types.ts
export type PersonKey = `m:${string}` | `g:${string}`;                  // member id or guest id; exactly one prefix

export interface StoredAllocation { id: string; personKey: PersonKey; storedCents: number; priceRef: PriceRef | null; }
export interface StoredLine {
  id: string; category: BudgetCategory; description: string;
  plannedDate: string | null;                                             // YYYY-MM-DD
  park: string | null;                                                    // one of PARKS or null
  experienceId: string | null;
  priceSource: PriceSource;
  priceAsOf: Date;                                                        // trip_budget_lines.price_as_of
  priceRef: TicketPriceRef | LlPriceRef | null;                           // line-level default
  applyTip: boolean;
  allocations: StoredAllocation[];                                        // SORTED by personKey (string compare) before any math
}
// Resolution precedence for a sourced allocation: allocation.priceRef ?? line.priceRef ?? (none => stored snapshot).
// allocationPriceRef takes precedence over the line's: a line may mix ages (adult and child tickets) with different refs.

export interface EffectiveAllocation {
  allocationId: string; personKey: PersonKey;
  storedCents: number; effectiveCents: number;                            // pre-tax
  labelKind: PriceLabelKind; effectivePriceSource: PriceSource; asOf: Date;
  estimateReason?: PriceQuoteDTO['estimateReason']; soldOut?: boolean;
  priceRef: PriceRef | null;
}
export interface ResolvedLine extends Omit<StoredLine, 'allocations'> {
  allocations: EffectiveAllocation[];
  effectivePriceSource: PriceSource;                                      // line-level (see resolveLinePrices)
  priceLabelKind: PriceLabelKind;                                         // worst allocation label
  asOf: Date;                                                             // oldest allocation asOf
  soldOut: boolean;
  attribution: 'disney' | 'themeparks_wiki' | null;
}
export interface PersonInfo { label: string; sponsorMemberId: string | null; deleted: boolean; }   // label 'Deleted user' when deleted
export type PersonIndex = ReadonlyMap<PersonKey, PersonInfo>;
export interface BudgetSettingsEffective {
  taxBps: Readonly<Record<BudgetCategory, number>>;                       // stored override merged over BUDGET_DEFAULT_TAX_BPS
  diningTipBps: number;                                                   // stored override ?? BUDGET_DEFAULT_DINING_TIP_BPS
  savedCents: number; savingsTargetCents: number | null;
}
export interface LineMath {
  subtotalCents: number; taxCents: number; tipCents: number; totalCents: number;
  perPerson: { personKey: PersonKey; cents: number; taxCents: number; tipCents: number }[];   // same order as allocations
}
export interface PlannedItemRow {                                         // columns of planned_items used by deriveSuggestions
  id: string; experienceId: string | null; plannedDate: string | null;
  reservationKind: string | null; partySize: number | null; isLightningLane: boolean;
}

// ticketPrices/types.ts  (camelCased mirror of the table columns)
export interface TicketPriceRow {
  discountGroup: TicketDiscountGroup; numDays: number; ageGroup: 'adult' | 'child'; optionCode: TicketOption;
  park: 'any' | 'mk' | 'ep' | 'hs' | 'ak'; startDate: string; priceCents: number; taxCents: number;
  validEndDate: string; productId: string; changedAt: Date;
}
export interface TicketPriceSetMeta {
  discountGroup: TicketDiscountGroup; numDays: number; asOf: Date | null; horizonDate: string | null;
  rowCount: number | null; lastAttemptAt: Date | null; lastError: string | null; blockedUntil: Date | null;
}
export interface TicketResolution {
  priceCents: number | null; taxCents: number | null;
  resolvedStartDate: string | null; parkAssumed: boolean;
  labelKind: PriceLabelKind;                                              // 'add_your_price' when priceCents is null
  asOf: Date | null;                                                      // the set's as_of
  estimateReason: NonNullable<PriceQuoteDTO['estimateReason']>;           // 'none' when exact and not stale
  flUnavailable: boolean;
}
export interface LabelCfg { freshDays: number; estimateAfterDays: number; }

// lightningLane/types.ts
export interface StoredLlRow {
  passType: 'multi' | 'premier' | 'single'; park: string; date: string; experienceId: string | null;
  purchaseId: string | null;                                              // single only
  cents: number; available: boolean | null;
  capturedAt: Date;                                                       // multi: ll_multipass_captured_at; premier: ll_premier_captured_at; single: captured_at (round 4 L1)
}
export interface LlHistoryRow { date: string; cents: number; }
export interface LlBook {
  stored: readonly StoredLlRow[];                                         // rows for the requested keys
  history: ReadonlyMap<string, readonly LlHistoryRow[]>;                  // key = `${passType}|${park}|${experienceId ?? ''}`
}
export interface ResolveCfg extends LabelCfg {
  llStaleHours: number; lookbackDays: number; minSamples: number;
  /** Round 5 M3: the planner's permitted-pair map; `resolveLinePrices` passes `pairPermitted = (allowedNumDaysByGroup[group] ?? []).includes(numDays)` to `resolveTicketPrice`. */
  allowedNumDaysByGroup: Readonly<Record<string, readonly number[]>>;
}
```

### Menu structured fields (`dto/Menu.ts`, additive)

```ts
export interface MenuPriceEntry { readonly cents: number; readonly label: string | null; } // label = upstream prices[].type (e.g. "Per Serving")
// MenuDTO additions (all optional, omitted when absent):
//   serviceStyle?: string | null      // mealPeriods[].serviceStyle
//   experience?: string | null        // mealPeriods[].experience (e.g. "Character Dining")
//   groups[].type?: string | null     // groups[].type (e.g. "Entree", "Alcoholic Beverage")
//   groups[].items[].prices?: readonly MenuPriceEntry[]
//   groups[].items[].priceCents?: number | null   // only when exactly one USD price
```

`mapItem` in `diningMenuClient.ts` builds `prices` from `prices[].withoutTax` (dollars, number) with `cents = Math.round(withoutTax * 100)`, skipping non-finite, non-positive or non-USD entries, and sets `label` from the entry `type`. `formatDiningPrice` and the `price` string are untouched. `RawMenuItem` gains optional `prices`, `RawMenuGroup` gains optional `type`, `RawMenu` gains optional `serviceStyle`/`experience`; `projectMenus` copies a new field only when it is a valid value, so an input without them yields byte-identical output to today.

`decideMenuRefresh({fetchedAt, shapeVersion}, now, intervalMs, currentShape)` (pure, new) returns true when `decideMenuFetch(...)` is true or `shapeVersion < currentShape`. `createMenuRetrieval` calls it; `CatalogRepo.getMenuFetchState` returns `shapeVersion` and `upsertMenus` writes `MENU_SHAPE_VERSION`. Refill is lazy, per restaurant, on demand only.

### Shared price parser (`menuPricing.ts`, pure)

```ts
/** All USD amounts in `text`, in order, as integer cents (> 0, finite). "$12 / $18" -> [1200, 1800]. */
export function parseDollarAmounts(text: string): number[];
/** Parse a verbatim menu `price` string. Returns [] when nothing parses. */
export function parseMenuPriceString(price: string | null | undefined): number[];

export interface MenuPriceOffer {
  readonly kind: 'per_person_tier' | 'fixed_menu' | 'banner_item';
  readonly label: string;                       // "Adult", "Child", "Person", item title, or banner item name
  readonly audience: 'adult' | 'child' | 'person' | null;
  readonly priceCents: number;
  readonly menuType: string;
  readonly sourceText: string;
}
export function extractMenuPriceOffers(menus: readonly MenuDTO[] | null | undefined): MenuPriceOffer[];

/** Promoted from receiptScan.pure.ts. Same signature and behavior for existing inputs. */
export function extractTierPriceSuggestions(menus?: readonly MenuDTO[] | null): { name: string; priceCents: number }[];

export function isAlcoholGroupType(type: string | null | undefined): boolean; // /alcohol/i on group.type
export function formatCentsAsDollarString(cents: number): string;            // 4995 -> "$49.95"
```

Pattern rules (all case-insensitive, evaluated on `item.name`, `item.price` and, for banners, `group.name`):

1. `\$?(\d+(?:\.\d{2})?)\s*(?:per|\/)\s*(adult|child|guest|senior|person)` yields a `per_person_tier` (`person`/`guest` audience `person`). This is the existing regex plus `person`.
2. `(Adult|Child|Guest|Senior)\s*:\s*\$?(\d+(?:\.\d{2})?)` yields a `per_person_tier`.
3. A group whose `name` contains `(\$N per person)` or `(\$N per adult)` yields a `fixed_menu` offer with that price.
4. A group whose `name` matches `/pricing|prix fixe|buffet|price/i` and whose items have a single `priceCents` yields one `banner_item` offer per priced item, labelled by the item name.
5. Every offer must have `priceCents > 0` and finite; the first occurrence of a label wins (existing dedupe).

`extractTierPriceSuggestions` returns `per_person_tier` offers as `{ name, priceCents }` with the existing capitalisation, which preserves the current mobile tests.

### Ticket price pure modules

```ts
// idMapping.ts
export interface TicketProductParts { numDays: number; ageGroup: 'adult'|'child'; optionCode: TicketOption; discountGroup: TicketDiscountGroup; park: 'any'|'mk'|'ep'|'hs'|'ak'; }
const ID_RE = /^theme-park_(\d{1,2})_([AC])_(0|P|PHP|WPS)_(0|2)_RF_AF_SOF_progenstr(?:_(mk|ep|hs|ak))?$/;
const OPT = { '0': 'base', P: 'park_hopper', PHP: 'park_hopper_plus', WPS: 'water_parks_sports' } as const;
const RES = { '0': 'std-gst', '2': 'fl-resident' } as const;
export function parseTicketProductId(id: string): TicketProductParts | null;     // total; null on no match
export function buildTicketProductId(p: TicketProductParts): string;            // inverse for matching ids
export function crossCheck(p: TicketProductParts, entry: { ageGroup?: unknown }, requested: { numDays: number; discountGroup: string }): boolean;
```

`park` rule: the suffix is accepted only when `optionCode === 'base'` and `numDays === 1`; a suffix on any other id fails the cross-check (counted as unrecognized). With no suffix, `park = 'any'`.

```ts
// ticketMoney.ts
/** "697.36" -> 69736; "139" -> 13900; "139.5" -> 13950. Decimal-string arithmetic, no floats. null when not /^\d+(\.\d{1,2})?$/ or result <= 0 or > 1_000_000_00. */
export function dollarsStringToCents(s: unknown): number | null;
```

```ts
// parsePricesResponse.ts
export interface ParsedPricesSet { rows: TicketPriceRow[]; skippedUnrecognized: number; skippedNotSellable: number; invalidPriceCount: number; horizonDate: string; }
export function parsePricesResponse(body: unknown, requested: { numDays: number; discountGroup: string }): ParsedPricesSet; // throws InvalidResponse on schema failure
```

```ts
// setAcceptance.ts
export type SetVerdict = { ok: true } | { ok: false; reason: 'empty'|'invalid_price'|'row_count_drop'|'unrecognized_fraction' };
export function acceptPricesSet(
  parsed: ParsedPricesSet, totalEntries: number,
  /** Rows PER WINDOW DAY of the previous accepted set: previous row_count / previous window_days; null when none (review F18). */
  previous: { rowCount: number; windowDays: number } | null,
  /** Days in this fetch's window: daysBetween(startDate, endDate) + 1, computed by the caller from the dates it sent. */
  windowDays: number,
  cfg: { minRatio: number; maxUnrecognizedFraction: number }): SetVerdict;
```

`ok` requires `rows.length > 0`, `invalidPriceCount === 0`, `previous == null || previous.windowDays <= 0 || rows.length / windowDays >= (previous.rowCount / previous.windowDays) * cfg.minRatio`, and `skippedUnrecognized / totalEntries <= cfg.maxUnrecognizedFraction`. The comparison is per window day because the fetch window `today..horizon` shrinks by one day every day while the horizon is fixed between Disney price releases (review F18): comparing raw counts would reject a healthy set after a long gap, and since `row_count` only advances on acceptance the rejection would repeat indefinitely. The set row stores `window_days` next to `row_count` (migration 0065).

```ts
// freshness.ts
export type TicketAgeClass = 'current' | 'may_have_changed' | 'estimate';
export function ticketAgeClass(asOf: Date, today: string, cfg: { freshDays: number; estimateAfterDays: number }): TicketAgeClass;
export const LABEL_SEVERITY: Record<PriceLabelKind, number>; // current 0 < may_have_changed 1 < estimate 2 < add_your_price 3; your_price is separate and never compared
export function worseLabel(a: PriceLabelKind, b: PriceLabelKind): PriceLabelKind;
```

`ticketAgeClass`: `days = daysBetween(wdwToday(asOf), today)`; `days <= freshDays` -> current; `days <= estimateAfterDays` -> may_have_changed; else estimate. `daysBetween(a, b)` (whole days from `a` to `b`, both `YYYY-MM-DD`) is exported from ONE module, `services/ticketPrices/dates.ts` (pure; also exports `wdwDateOf(instant)` = `wdwToday` semantics applied to an instant, and `addDays(date, n)` = the `YYYY-MM-DD` date `n` whole days from `date`, computed on UTC midnight so DST never matters, round 4 L2; and, round 5 L5, `dateToInstant(date): Date` = `new Date(`${date}T12:00:00.000Z`)`, which is 08:00 EDT or 07:00 EST of the same New York calendar date in every season, so `wdwDateOf(dateToInstant(d)) === d` for every valid date; the round-trip is asserted for every date of 2026 through 2028 including both DST changes and the 2028 leap day), and is imported by `freshness.ts`, `resolveTicketPrice.ts`, `refreshPlanner.ts` and `tripBudget/savingsPlan.ts`; nobody redefines it (review F22). It parses `YYYY-MM-DD` as UTC midnight so DST never matters and returns a signed integer; `ticketAgeClass` clamps a negative result (clock skew) to 0, while `computeSavingsPlan` uses the signed value.

```ts
// resolveTicketPrice.ts
export interface TicketBook { rows: readonly TicketPriceRow[]; sets: readonly TicketPriceSetMeta[]; }
/** `pairPermitted` (round 5 M3): whether `(req.discountGroup, req.numDays)` is in the same `allowedNumDaysByGroup` map the refresh planner uses
 *  (std-gst => 1..10; fl-resident => TICKET_PRICES_FL_RESIDENT_NUMDAYS; a group not in TICKET_PRICES_GROUPS => none). The caller (route, `resolveLinePrices`)
 *  computes it from configuration; the resolver does no I/O and never reads configuration itself. */
export function resolveTicketPrice(req: TicketPriceRef, book: TicketBook, today: string, cfg: LabelCfg, pairPermitted: boolean): TicketResolution;
```

Algorithm, in order:

0. If `req.startDate < today`, return `{ priceCents: null, labelKind: 'add_your_price', estimateReason: 'none' }` (past dates are pruned; a past trip must not be priced with a future same-weekday row; the stored snapshot fallback of `resolveLinePrices` applies, Requirement 14.10).
1. Find the set for `(discountGroup, numDays)`. (a) If `discountGroup === 'fl-resident'` and (`!pairPermitted` or the set's `lastError === 'not_offered'`): return `add_your_price` with `estimateReason: 'fl_unavailable'` and `flUnavailable: true` (a pair that will never be fetched; Requirement 14.8). (b) Else, if there is no set, or it has no rows (`asOf` null): return `add_your_price` with `estimateReason: 'none'` and `flUnavailable: false` whatever the group (round 5 M3: a permitted Florida-resident pair that has not been fetched yet is NOT unavailable; the quote's `cacheState` says why there is no price yet).
2. If `req.optionCode === 'base' && req.numDays === 1`: `parkCodes = req.park ? [req.park] : ['mk','ep','hs','ak']`, else `['any']`. The caller (route and `resolveLinePrices`) has already applied the server default of Requirement 14.9 (`req.park ??= TICKET_PARK_BY_CANONICAL_PARK[line.park]`), so `parkAssumed` is true only when the line has no mappable park either.
3. Let `rowsFor(date)` be rows with that `(discountGroup, numDays, ageGroup, optionCode, startDate = date)` and `park` in `parkCodes`. If `req.startDate <= set.horizonDate` and `rowsFor(req.startDate)` is non-empty, take `price = max(priceCents)` of them (a single row when the park is known), `parkAssumed = !req.park && parkCodes.length > 1`, `resolvedStartDate = req.startDate`, `estimate = parkAssumed`.
4. Else if `req.startDate > set.horizonDate` (round 4 L2): candidate dates are the cached dates `d` with `today <= d <= set.horizonDate` and `wdwDayOfWeek(d) === wdwDayOfWeek(req.startDate)` that have rows. Let `target = addDays(req.startDate, -364)` (`ticketPrices/dates.ts`; 364 days is 52 weeks, so `target` has the same weekday as `req.startDate`). If `today <= target <= set.horizonDate` and the candidate list is non-empty, choose the candidate minimizing `abs(daysBetween(d, target))` (ties to the earlier date); otherwise choose the latest candidate. (Choosing the latest unconditionally always lands in the holiday-peak last week of the horizon and would overstate every beyond-horizon estimate.) `estimate = true`, `estimateReason = 'beyond_horizon'`.
5. Else (within horizon, no exact row): choose the cached date with the same weekday minimizing `abs(daysBetween(d, req.startDate))`, ties to the earlier date. `estimate = true`, `estimateReason = 'no_exact_date'`.
6. If no candidate, `add_your_price`.
7. `labelKind = worseLabel(ticketAgeClass(set.asOf, today, cfg), estimate ? 'estimate' : 'current')`. `estimateReason` precedence (review F22), first match wins: `park_unset` when `parkAssumed` (it outranks `beyond_horizon` and `no_exact_date` when both apply, because the user can fix it by choosing a park); `beyond_horizon` / `no_exact_date` per steps 4 and 5; otherwise `stale` when the age class alone is `may_have_changed` or `estimate`; otherwise `none`.

```ts
// cacheState.ts  (round 5 M3, M4) - the ONE function behind PriceQuoteDTO.cacheState; pure, no I/O
export interface CacheStateInput {
  enabled: boolean; now: Date;
  control: { blockedUntil: Date | null; inProgressSince: Date | null; lastAttemptAt: Date | null };
  pairPermitted: boolean;                                         // same allowedNumDaysByGroup map as the planner
  set: { asOf: Date | null; lastError: string | null } | null;   // null = no set row for the pair
  cfg: { attemptIntervalHours: number; claimTimeoutMinutes: number };
}
export type TicketCacheState = 'disabled' | 'warming' | 'failed' | 'ready';
export function ticketCacheState(i: CacheStateInput): TicketCacheState;
```

Order (first match wins): (1) `!enabled || (control.blockedUntil && control.blockedUntil > now)` -> `disabled`; (2) `!pairPermitted || set?.lastError === 'not_offered' || set?.asOf != null` -> `ready`; (3) `set?.lastError != null` (so `asOf` is null here and the error is not `not_offered`) -> `failed`; (4) `inFlight = control.inProgressSince != null && now - inProgressSince < claimTimeoutMinutes`, `cooled = control.lastAttemptAt == null || now - lastAttemptAt >= attemptIntervalHours`; `inFlight || cooled` -> `warming`; (5) otherwise `failed`. Rationale for (3): a recorded `last_error` on a set with no rows means the last attempt for it failed (network, timeout, 5xx, invalid response, sanity guard, `start_date_rejected`, `waf_block`); the 24-hour attempt cooldown then keeps `as_of` null for up to a day (or for ever when upstream drifted), so "being fetched, try again in a minute" would be false. Rationale for (5): a claim consumes the cooldown at claim time (Property 37), so a run that died before reaching this set leaves a never-fetched set with no error and no run able to start; reporting `warming` there would be equally false. `last_error` is cleared (set to NULL) by `updateSet` in the same statement that advances `as_of` on an accepted set, so a recovered set is `ready`, and `recordSetError` never touches `as_of`. The function reads only values the quote path already loads (the control row, the set rows) plus the configuration map.

```ts
// refreshPlanner.ts
export interface RefreshDecisionInput {
  enabled: boolean; now: Date; today: string;
  control: { lastAttemptAt: Date|null; lastProbeAt: Date|null; blockedUntil: Date|null; inProgressSince: Date|null;
             /** maxPricingCalendarDate last seen by a probe (review F25); null before the first probe. */ observedHorizonDate: string|null };
  sets: readonly { discountGroup: string; numDays: number; asOf: Date|null; horizonDate: string|null; lastError: string|null }[];
  demand: { groups: readonly string[]; numDays: readonly number[]; maxStartDate: string | null };
  /** Permitted (group -> numDays[]) pairs from config: std-gst => 1..10; fl-resident => TICKET_PRICES_FL_RESIDENT_NUMDAYS; a group not in TICKET_PRICES_GROUPS => []. */
  allowedNumDaysByGroup: Readonly<Record<string, readonly number[]>>;
  cfg: { staleAfterDays: number; attemptIntervalHours: number; probeIntervalHours: number; claimTimeoutMinutes: 15 };
}
export type RefreshDecision =
  | { action: 'none'; reason: 'disabled'|'blocked'|'in_flight'|'fresh'|'attempt_cooldown'|'probe_cooldown' }
  | { action: 'probe_only' | 'full'; neededNumDays: number[] };
export function decideRefresh(i: RefreshDecisionInput): RefreshDecision;
```

Order of tests: `!enabled` -> `none/disabled`; `blockedUntil > now` -> `none/blocked`; `inProgressSince` within the claim timeout -> `none/in_flight`; the demanded pairs are first filtered to those permitted by `allowedNumDaysByGroup` and then to those whose set does not carry `lastError === 'not_offered'` (a `not_offered` set has no `as_of` and would otherwise look stale for ever and trigger a `full` run every day); `stale` = any remaining demanded `(group, numDays)` with missing set, null `asOf`, `asOf` older than `staleAfterDays`, or (review F25) a known `horizonDate` earlier than `control.observedHorizonDate` (a probe saw the horizon move but could not pull because the attempt cooldown was active) -> if `lastAttemptAt` is null or at least `attemptIntervalHours` ago, `full`, else `none/attempt_cooldown`; otherwise `beyond` = `maxStartDate` later than the minimum known `horizonDate` of the demanded sets (or none known) -> if `lastProbeAt` is null or at least `probeIntervalHours` ago, `probe_only`, else `none/probe_cooldown`; otherwise `none/fresh`.

### Ticket client (`ticketPriceClient.ts`)

```ts
export interface TicketPriceClient {
  getToken(): Promise<string>;                                        // T
  getPrices(p: { token: string; discountGroup: string; numDays: number; startDate: string; endDate: string }): Promise<{ body: unknown; bytes: number; ms: number; status: number }>; // P
}
export class TicketClientError extends Error { kind: 'waf_block'|'unauthorized'|'not_found'|'start_date_rejected'|'http_status'|'network'|'timeout'|'invalid_response'; status?: number; }
export function createTicketPriceClient(o: { baseUrl: string; userAgent: string; fetch?: typeof fetch; timeoutMs: number; maxBodyBytes: number }): TicketPriceClient;
```

Requests send `Accept: application/json` and the honest `User-Agent`; no cookies are stored or sent; the `Authorization: BEARER <token>` header is added for P only. The response is read as text, checked against `maxBodyBytes`, then `JSON.parse`d. The status mapping, evaluated in this order on every response:

1. **WAF first, whatever the status.** If the body is not parseable JSON, or the status is not 2xx, lower-case the body and test it against `DISNEY_WAF_BODY_MARKERS` (exported from `catalog/disney/classify.ts`); a match -> `waf_block` (this covers an Akamai challenge returned with HTTP 200 and an edge page returned with HTTP 503). `403` and `429` -> `waf_block` regardless of markers (the stricter, circuit-breaker reading; `classifyDisneyResponse({ target: 'web', status, body })` is reused for its 403/429 decision only, because it inspects markers only for those two statuses and requires `target: 'web'`).
2. `401` -> `unauthorized` (the service refetches the token once and retries that call once; a second `401` on the same call is recorded as `http_status:401` and counts as a failure, round 5 L3).
3. `404` -> `not_found` (for a `fl-resident` set the service records `not_offered`; for `std-gst` or the probe it is recorded as `http_status:404` and counts as a failure, round 5 L3).
4. `400` on endpoint P when `startDate` was the WDW_Today date -> the client retries that one call once with `startDate = max(WDW_Today, UTC date)` (never earlier; `endDate` is unchanged), except that `endDate` becomes the retry `startDate` when the original `endDate` is earlier than it (single-day probe and Diagnose calls); full pulls, whose `endDate` is the horizon, keep their `endDate`; if the retry also answers 400 -> `start_date_rejected` (Requirement 11.13). **[A]** the timezone basis of Disney's "today" is unverified; this retry exists because of it.
5. Any other non-2xx -> `http_status`; abort -> `timeout`; fetch rejection -> `network`; 2xx JSON that fails Zod or exceeds the body cap -> `invalid_response`.

`network`, `timeout`, `http_status`, `invalid_response`, a `not_found` on `std-gst` or the probe, and a repeated `unauthorized` count toward `TICKET_PRICES_MAX_CONSECUTIVE_FAILURES` (Requirements 13.9, 13.11); `not_found` on `fl-resident` and `start_date_rejected` do not.

### Lightning Lane pure modules

```ts
// llExtract.ts
export interface LlDayPrices { date: string; multi?: {cents:number;available:boolean|null}; premier?: {cents:number;available:boolean|null}; singles: {purchaseId:string; attractionName:string; cents:number; available:boolean|null}[] }
export function classifyPurchase(p: ThemeParksPurchase): { kind: 'multi'|'premier'|'single'; id: string } | null;
/** ONE park's schedule entries (the `schedule` array of `getEntitySchedule(park.id)`); the caller supplies the park. */
export function extractLlPrices(schedule: readonly ThemeParksScheduleEntry[]): LlDayPrices[];   // one element per date, sorted by date
```

`classifyPurchase`: `type==='PACKAGE'` and `id` starts with `lightninglanemultipass_` -> multi; starts with `premierpass_` -> premier; else if `name === 'Lightning Lane Multi Pass'` -> multi, `name === 'Lightning Lane Premier Pass'` -> premier; `type==='ATTRACTION'` and `id` starts with `lightninglane_` -> single; everything else null. The amount must be an integer greater than zero. Within one date, the first valid purchase of each kind and each single `id` wins (OPERATING entries carry purchases; TICKETED_EVENT entries do not). The date key is derived exactly as the existing loop derives it (`new Date(se.date).toISOString().split('T')[0]`).

**Integration point (no destination call, no park mapping problem).** `samplingService.ts` already does, per park in `wdwParks`: resolve `canonicalPark` from that park's live data (skipping the park when it is null), then `schedRes = await liveClient.getEntitySchedule(park.id)`, then build `schedRowsMap` and call `repo.upsertParkScheduleSignals`. Lightning Lane extraction is added **inside that same loop body**, right after `schedRes` is available: `const ll = extractLlPrices(schedRes.schedule)`, the per-date `multi`/`premier` values are written onto the `ScheduleSignalRow`s the loop already builds (new optional fields `ll_multipass_available`, `ll_premier_price_cents`, `ll_premier_available`, `ll_prices_captured_at`, and `ll_multipass_price_cents` taken from the classifier instead of the exact-name `find`), and the `singles` are collected as `{ park: canonicalPark, date, purchaseId, ... }` rows into a pass-level array that is persisted once after the loop (guarded by the 12-hour rule, below). There is therefore **one writer** of the park-level columns (the extended `upsertParkScheduleSignals`, one statement per park per pass), zero additional HTTP requests, no `parks[]` type extension and no destination GUID. `ThemeParksScheduleResponse` and its `purchases` type in `themeParksLiveClient.ts` are checked for the fields `type`, `id`, `name`, `available`, `price.amount` and extended additively only if one is missing.

The existing merge branch of the loop (`if (schedRowsMap.has(dateKey))`) must apply the same rule for the new fields as it does for `ll_multipass_price_cents` today (first valid value wins), because one date can have several schedule entries.

**The 12-hour guard.** At the start of the pass the sampler reads `repo.getLlSinglePricesLastCapturedAt()` (`SELECT max(captured_at) FROM lightning_lane_single_prices`, NULL when empty). Single-pass rows are persisted, and `pruneLightningLaneSinglePrices` runs, only when that value is NULL or older than `LL_PRICES_MIN_REFRESH_HOURS`. The park-level columns are not guarded: they ride the existing per-park statement on every pass at no extra statement. `ll_prices_captured_at` is set to the pass time on every row that has at least one LL value and is NULL otherwise, so it is the age of the stored price, never the age of the last write attempt.

```ts
// typicalPrice.ts
export type TypicalResult =
  | { priceCents: number; sampleCount: number; basis: 'weekday_month'|'weekday'; newestSampleDate: string }   // newestSampleDate = max(date) of the samples of the chosen basis subset (round 4 L4)
  | { priceCents: null; reason: 'no_estimate' };
export function medianCents(values: readonly number[]): number;   // odd: middle; even: Math.round((a+b)/2)
export function typicalLlPrice(history: readonly {date:string; cents:number}[], target: {date:string}, today: string, cfg: {lookbackDays:number; minSamples:number}): TypicalResult;
```

History rows are filtered to `date < today` and `date >= today - lookbackDays`. Step 1: rows with the same `wdwDayOfWeek` and the same `MM`; if at least `minSamples`, return their median, basis `weekday_month`. Step 2: rows with the same weekday only; if at least `minSamples`, median, basis `weekday`. Else `no_estimate`.

```ts
// lookupLlPrice.ts (pure)
export function lookupLlPrice(ref: LlPriceRef, stored: readonly StoredLlRow[], history: readonly {date:string;cents:number}[], today: string, now: Date, cfg: {staleHours:number; lookbackDays:number; minSamples:number}): PriceQuoteDTO;
```

If a stored row exists for the date: `labelKind` is `current` when `now - capturedAt <= staleHours` (the `capturedAt` of that pass type's own price, round 4 L1), else `may_have_changed`; `soldOut = available === false`; `attribution: 'themeparks_wiki'`; `asOf = capturedAt`. (`llRepo.readBook` returns a stored row only when that pass type's own timestamp is non-null; a price written by the sampler before migration 0066 has none, its age is unknown, and it feeds only the typical-price history.) Otherwise `typicalLlPrice`; on a result the label is `estimate` and **`asOf` is the `date` (as a WDW calendar date, midnight-free ISO date string) of the newest history sample used to compute the median (round 4 L4: never `now`, so the "Estimate, as of <date>" text does not change daily; for a stored Budget_Line the same value is the line `price_as_of`; `TypicalResult` therefore also returns `newestSampleDate`; round 5 L5: wherever that calendar date must be stored in a `TIMESTAMPTZ` (`trip_budget_lines.price_as_of`, allocation snapshot `asOf`) it is converted by the ONE function `dateToInstant(date)` of `ticketPrices/dates.ts`, and wherever it is shown it goes back through `wdwDateOf`; a bare `new Date('2026-10-25')` (midnight UTC, which is the previous day in New York) is never used)**, `effectivePriceSource: 'typical_estimate'`, `estimateReason: 'typical'`; on `no_estimate`, `priceCents: null`, `add_your_price`.

### Budget pure modules (`services/tripBudget/`)

```ts
// packages/shared/src/money.ts  (task 1.1; shared by the API and the mobile app, round 4 M4; round 5 L1 moved the snippet here)
export const bpsOf = (subtotalCents: number, bps: number): number => Math.floor((subtotalCents * bps + 5000) / 10000);
/** floor share for everyone, the remainder one cent at a time in list order; sums exactly to totalCents. Throws RangeError when count < 1. */
export function splitCentsEvenly(totalCents: number, count: number): number[];
```

```ts
// budgetMath.ts  (imports bpsOf from '@dwt/shared' and defines no second copy)
export function allocateShares(totalCents: number, weights: readonly number[]): number[];   // Budget-local, non-negative (below)
export function computeLine(l: { category; applyTip: boolean; allocations: {personKey: string; cents: number}[] }, s: BudgetSettingsEffective): LineMath;
// LineMath = { subtotalCents; taxCents; tipCents; totalCents; perPerson: {personKey; cents; taxCents; tipCents}[] }
```

`taxCents = bpsOf(subtotal, s.taxBps[category])`; `tipCents = applyTip && category === 'dining' ? bpsOf(subtotal, s.diningTipBps) : 0` (the only tip rate is the dining tip; the repo already rejects `applyTip` on other categories, and the pure function defends against stored legacy data). `perPerson` taxes and tips come from the Budget-local `allocateShares(taxCents, weights)` and `allocateShares(tipCents, weights)`, with `weights` equal to the allocation cents in allocation order. When `subtotal` is 0 both amounts are 0 and `computeLine` still emits one `perPerson` entry per allocation, each with `taxCents: 0` and `tipCents: 0` (`allocateShares` returns all zeros for an all-zero weight vector; review F22).

**Why not `allocateProportionally` (round 5 M2; verified by running the helper copied from `services/tripExpenses/allocation.ts`).** Its base shares use `Math.round`, so ties round up, and its remainder correction subtracts from index 0 first without regard to weight. Consequences, both reproduced: `allocateProportionally(1, [0, 1, 1])` returns `[-1, 1, 1]` (a negative share for a ZERO-weight entry), and `allocateProportionally(2, [1, 3, 3, 3])` returns `[-1, 1, 1, 1]` (a negative share for a POSITIVE-weight entry whose exact share is 0.2). Exhaustive search over `total 0..12`, `1..5` weights each `0..4` finds 2,416 vectors with a negative output (150 of them with every weight positive) and 3,588 where a zero-weight entry receives a non-zero amount. The sums are still exact, so Properties 1 and 2 stayed green, but a by-person bucket could show -$0.01. A zero-weight filter alone would therefore NOT be enough; Budget uses its own allocator and leaves the Expense helper unchanged (trip-expenses owners: see the note under "Notes").

```ts
// budgetMath.ts: largest-remainder allocation over integers (pure; no floats)
export function allocateShares(totalCents: number, weights: readonly number[]): number[] {
  // preconditions: totalCents and every weight are non-negative safe integers
  const S = weights.reduce((a, w) => a + w, 0);
  if (S === 0) return weights.map(() => 0);                        // nothing to attribute to; callers pass total 0 here (subtotal 0 => tax 0)
  const base = weights.map((w) => Math.floor((totalCents * w) / S));           // exact: totalCents * w < 2^53, see bound below
  const frac = weights.map((w) => (totalCents * w) % S);                       // integer remainder, 0 for a zero weight
  let left = totalCents - base.reduce((a, b) => a + b, 0);                      // 0 <= left < number of entries with frac > 0
  const order = weights.map((_, i) => i).sort((i, j) => frac[j]! - frac[i]! || i - j);   // largest remainder first, ties to the lower index
  for (const i of order) { if (left === 0) break; base[i]! += 1; left -= 1; }
  return base;
}
```

Guarantees (Property 1): every output is a non-negative integer; the outputs sum to `totalCents` exactly; each output is `floor(total * w / S)` or that plus one, so it differs from the exact proportional value by less than one cent; an entry with weight 0 receives exactly 0 (its `frac` is 0, and since the fractional parts sum to `S * left` with each below `S`, more than `left` entries have `frac > 0`, so the `left` winners always have `frac > 0`); the result does not depend on anything but `(totalCents, weights)`. Bound: `totalCents * w` is at most `250_000_000 * 10_000_000 = 2.5e15 < 2^53` (largest tip: `bpsOf(5e8, 5000)` = 250,000,000; largest weight: `EXPENSE_AMOUNT_MAX_CENTS` = 10,000,000), so every product and `%` is exact in a double. Intermediate products of `bpsOf` stay below 2^53 because `subtotal <= 50 * 10_000_000` and `bps <= 5000`.

```ts
// budgetViews.ts
export function computeBudgetViews(lines: ResolvedLine[], settings: BudgetSettingsEffective, people: PersonIndex): { total, byPerson, byDay, byPark, byCategory }
```

Keys: person `m:<memberId>` or `g:<guestId>`; day `<YYYY-MM-DD>` or `unassigned`; park the canonical name or `other_resort`; category the `BudgetCategory`. Buckets are sorted: persons by label then key, days ascending with `unassigned` last, parks by name with `other_resort` last, categories in `BUDGET_CATEGORIES` order. Empty buckets are omitted.

```ts
// savingsPlan.ts
export function computeSavingsPlan(i: { targetCents: number; savedCents: number; today: string; tripStartDate: string }): SavingsPlanDTO
```

```
remaining = max(0, target - saved)
daysUntilStart = daysBetween(today, tripStartDate)
if remaining == 0                -> {perWeek: 0, status: 'on_track', weeksRemaining: daysUntilStart > 0 ? ceil(days/7) : null}
else if daysUntilStart <= 0      -> {perWeek: null, status: 'trip_started_or_past'}
else weeks = ceil(daysUntilStart / 7); perWeek = ceil(remaining / weeks); status 'saving'
```

```ts
// resolveLinePrices.ts
export function resolveLinePrices(i: { lines: StoredLine[]; ticketBook: TicketBook; llBook: LlBook; today: string; now: Date; cfg: ResolveCfg }): ResolvedLine[]
```

For each line: if `priceSource === 'user_entered'` or `'disney_menu'`: effective = stored (a frozen snapshot), `effectivePriceSource` = stored source, label `your_price` for `user_entered`; for `disney_menu` the label is the stored `asOf` age class using the same `ticketAgeClass` thresholds, and `effectivePriceSource` is `disney_menu`. For `disney_ticket_calendar`, each allocation resolves by `resolveTicketPrice(allocation.priceRef ?? line.priceRef)`; for `themeparks_ll`, by `lookupLlPrice(...)`.

**A Lightning Lane line priced from the typical estimate is never frozen (review F2).** Beyond the roughly 31-day real-price window, create-time `lookupLlPrice` returns the typical estimate; the server then stores the line with `priceSource = 'themeparks_ll'` (never `typical_estimate`), the `llPriceRef`, a snapshot amount equal to the estimate and `asOf` = the `newestSampleDate` of the history behind the estimate (round 4 L4; never `now`, so the "Estimate" text does not drift daily). On every later read `lookupLlPrice` runs again: while no stored price exists the effective source is `typical_estimate` with label `estimate`; once the sampling job stores a real price for that date the same line resolves to that real price, `effectivePriceSource = 'themeparks_ll'` and label `current`. `typical_estimate` is therefore an EFFECTIVE source only: `CREATABLE_PRICE_SOURCES` excludes it, `budgetLineInputSchema` rejects it, no repo method writes it, and `resolveLinePrices` treats a stored `typical_estimate` row (which no route can create; it exists only because the column vocabulary of Requirement 5.1 admits it) exactly like `themeparks_ll` when it carries an `ll` priceRef and as a frozen snapshot otherwise. When the result `priceCents` is null the stored snapshot is used and the label is `ticketAgeClass(storedAsOf)` worsened to at least `may_have_changed`. The line label is the worst allocation label; `effectivePriceSource` is `typical_estimate` when any allocation resolved to an estimate and the stored source otherwise. The function is pure and never mutates its inputs.

```ts
// suggestions.ts
export function deriveSuggestions(i: {
  plannedItems: PlannedItemRow[];
  dayTouringHours: Record<string, { startingPark?: string }>;
  profiles: TravelerProfileDTO[];
  tripStart: string;
  existingKeys: ReadonlySet<string>;
  dismissedKeys: ReadonlySet<string>;
  llSingleAvailable: ReadonlySet<string>;                         // `${date}:${experienceId}`
  experiencePark: ReadonlyMap<string, string | null>;
  /** lower-cased meal-period serviceStyle values of the cached menu per Experience id; absent key = no cached menu. */
  serviceStyleByExperience: ReadonlyMap<string, readonly string[]>;
}): BudgetSuggestionDTO[]
```

`applyTip` of a dining Suggestion is `styles.some((s) => TIP_BEARING_SERVICE_STYLES.includes(s))` where `styles = serviceStyleByExperience.get(experienceId)`; it is `false` when the key is absent (no cached menu) or no style matches (unknown values default to no tip). `startingPark` is mapped with `PARKS.find((p) => p.toLowerCase() === value.trim().toLowerCase()) ?? null`, so a value that is not canonical yields `park: null`. `loadBudget`/the suggestions route fills `serviceStyleByExperience` from one keyed query over `experience_menus` for the planned dining Experience ids (`experience_id = ANY($1)`, reading only the `menus` JSON's `serviceStyle` fields) so the pure function gets plain data.

**Ticket draft fields (round 4 L3).** A `tickets` draft has `category: 'tickets'`, `description = "<N>-day <optionLabel> tickets"` (e.g. "4-day Park Hopper tickets"; `optionLabel` is `Base` for `base`, `Park Hopper` for `park_hopper`, `Park Hopper Plus` for `park_hopper_plus`, `Water Parks and Sports` for `water_parks_sports`, kept in a small total map in `suggestions.ts`), `plannedDate = the group's start date` (`ticketStartDate`, else `tripStart`), `experienceId: null`, and `park` = the `startingPark` mapping of Requirement 6.7 (same canonical-name rule as above) for `plannedDate` ONLY when `N = 1` and the option is `base` (a 1-day base ticket has a per-park price, Requirement 14.5), otherwise `null` (a multi-day or hopper ticket has no single park; it lands in the by-park bucket `other_resort`, labelled "Other (resort or multi-park)" per Requirement 6.5). `applyTip: false`, `partySize: null`, `needsPrice: false` when every allocation resolved a price and `true` otherwise.

```ts
// vsActual.ts
export function computeVsActual(i: { lineTotalsByBudgetCategory: Record<BudgetCategory, number>; actualByExpenseCategory: Record<ExpenseCategory, number> }): VsActualDTO[]
```

### Budget repo and routes (`services/tripBudget/repo.ts`, `routes.ts`)

`createTripBudgetRepo(pool)` returns a plain object, like `createTripExpenseRepo`:

- `loadBudget(tripId)`: the constant-statement read described in the read flow (no `json_build_object`; allocations by a second `line_id = ANY($1::uuid[])` query), returning raw rows only. Person labels come from the `profile_identity` view and `trip_guests.name`; an id missing from the view prints `Deleted user` (line allocation labels and by-person buckets only). The `travelers` list OMITS every Traveler_Profile whose member account is `pending_deletion` or purged (review F4; detected with `findNonVisibleParties` over the profile member ids, so profiles never need a `FROM|JOIN users` literal), a ticket Suggestion is never proposed for such a person, a profile write naming such an account answers `trip_party_deleted`, and `DELETE /trips/:id/budget/travelers/:profileId` by id still succeeds for an omitted profile (it only removes the row).
- `createLine(tripId, userId, input, resolvedAmounts)`: `BEGIN`; lock the Trip row (`SELECT 1 FROM trips WHERE id=$1 FOR UPDATE`) and `COUNT(*)` lines against `BUDGET_LINE_LIMIT`; validate people (on EDIT, only the Person_Keys that are NOT already allocated on that line are validated here; a person whose allocation already exists on the line is exempt from the on-Trip check and from the `trip_party_deleted` check so that editing a line that still allocates to a departed member does not fail or force their allocation to be dropped, review F15; a person newly added by the edit is fully validated): (1) `findNonVisibleParties(client, tripId, parties)` (exported from `services/tripExpenses/repo.ts`) non-empty -> `trip_party_deleted`, (2) one raw `SELECT user_id FROM trip_memberships WHERE trip_id = $1 AND user_id = ANY($2)` (the single pinned roster read of this file, Requirement 18.8) and one `SELECT id FROM trip_guests WHERE trip_id = $1 AND id = ANY($2)` for the people being named, a missing one -> `trip_validation_failed`; validate `experienceId` and `linkedExpenseId`; for `disney_menu`: require `category = 'dining'` and a non-null `experienceId` and a `menu` `priceRef` on every allocation (else `trip_validation_failed`), verify each selected item/tier against the cached `experience_menus` row of that Experience (Requirement 9.6, the three-step rule including `shape_version` 1 rows), compute each allocation `amountCents = sum(priceCents * quantity)` over its `items` (or `tier.priceCents`), reject a submitted `amountCents` that differs from the computed value (so an inflated `quantity` cannot be hidden behind an unchanged `amountCents`: the quantity is part of the computed amount and the stored `priceRef`); insert the line and allocations; `COMMIT`.
- `editLine`, `removeLine`: creator-or-organizer; edit replaces allocations in one transaction.
- `upsertProfile`, `deleteProfile`, `getSettings`, `patchSettings` (upsert on `trip_id`), `dismissSuggestion` (insert `ON CONFLICT DO NOTHING`, cap check), `listPlannedItemsForSuggestions`.

Routes (Fastify plugin `tripBudgetRoutes({ pool, repo, requireSession, ticketPrices, llPrices })`):

| Method and path | Action | Notes |
| --- | --- | --- |
| `GET /trips/:id/budget` | `view_budget` | full `BudgetDTO` |
| `GET /trips/:id/budget/suggestions` | `view_budget` | `BudgetSuggestionDTO[]` |
| `POST /trips/:id/budget/quotes` | `view_budget` | body `{ requests: priceQuoteRequest[1..40] }` -> `PriceQuoteDTO[]`; read-only; may call `noteDemand`; ticket quotes carry `cacheState` (review F20); applies no server park default (Requirement 14.9) |
| `POST /trips/:id/budget/lines` | `edit_budget` | server resolves ticket and LL amounts |
| `PATCH /trips/:id/budget/lines/:lineId` | `edit_budget` | creator or organizer |
| `DELETE /trips/:id/budget/lines/:lineId` | `edit_budget` | creator or organizer |
| `PUT /trips/:id/budget/travelers` | `edit_budget_travelers` | upsert by Person_Key; self, sponsored guest, or organizer |
| `DELETE /trips/:id/budget/travelers/:profileId` | `edit_budget_travelers` | same rule |
| `PATCH /trips/:id/budget/settings` | `edit_budget_settings` | organizer only |
| `POST /trips/:id/budget/suggestions/dismiss` | `edit_budget` | body `{ suggestionKey }` |

**Request and response contract of every mutating route (round 4 M5).** `budgetApi.ts` (mobile) and the route tests are written against exactly this table. Every body, params and query is parsed with `parseOrAppError` (exported from `tripExpenses/routes.ts`), so a `ZodError` always becomes `trip_validation_failed` (Requirement 18.9).

| Route | Request body | Success status and body | Notes |
| --- | --- | --- | --- |
| `POST /trips/:id/budget/lines` | `budgetLineInputSchema` | **201** + the created `BudgetLineDTO` (with its `id`, resolved `effectivePriceSource`, `priceLabelKind`, `asOf` and allocations) | Stamps `price_as_of` (below) |
| `PATCH /trips/:id/budget/lines/:lineId` | `budgetLineReplaceSchema` (= `budgetLineInputSchema`; **PUT semantics, full replace**: every field is re-validated, the allocations are replaced atomically with the submitted set, an omitted optional field is stored as null/default, `suggestionKey` is ignored) | **200** + the re-resolved `BudgetLineDTO` | Creator or organizer (Requirement 2.5). The edit **re-stamps `price_as_of`** with the same rule as create (the oldest `asOf` among resolved allocations; `now` for `user_entered` and `disney_menu`) and re-runs the server-side amount resolution, so changing a typed price to a sourced one (or the reverse) is just a different `priceSource` in the body. A line that does not belong to `:id` answers `trip_not_found` |
| `DELETE /trips/:id/budget/lines/:lineId` | none | **204**, empty body | Creator or organizer |
| `PUT /trips/:id/budget/travelers` | `travelerProfileInputSchema` | **200** + the stored `TravelerProfileDTO` | Upsert by Person_Key; for a person whose account is `pending_deletion` answers `trip_party_deleted` |
| `DELETE /trips/:id/budget/travelers/:profileId` | none | **204**, empty body | Same authorization as PUT; an unknown id on this Trip answers `trip_not_found` |
| `PATCH /trips/:id/budget/settings` | `budgetSettingsPatchSchema` (partial: only the supplied keys change; `taxBps` keys merge into the stored object) | **200** + the effective `BudgetSettingsDTO` | Organizer only (`edit_budget_settings`) |
| `POST /trips/:id/budget/suggestions/dismiss` | `dismissSuggestionBodySchema` (`{ suggestionKey }`, strict) | **204**, empty body | Idempotent: dismissing an already dismissed key is also 204; the 201st distinct key answers `trip_validation_failed` (`BUDGET_DISMISSED_LIMIT`) |
| `POST /trips/:id/budget/quotes` | `priceQuoteBodySchema` | **200** + `PriceQuoteDTO[]` in request order | Read-only (`view_budget`) |

Mobile consequences: after a 201/200 the client replaces the line in the TanStack cache from the returned DTO and invalidates the `['budget', tripId]` query (totals are computed server-side); after a 204 it invalidates only. Route tests (task 15.3) assert the status code of each happy path exactly as above.

Authorization (round 5 H1: verified against `apps/api/src/services/trips/__tests__/roleReader.guard.test.ts`, whose test "effectiveRole.ts is imported only by the three readers" asserts that the files importing `effectiveRole.js` are exactly `composeServices.ts`, `services/trips/authz.ts` and `services/trips/repo.ts`; a fourth importer would make `npm run verify` red, and the repo rule is to fix the code, never to extend an allowlist): the Budget module NEVER imports `services/trips/effectiveRole.ts`. A small local helper in `services/tripBudget/authz.ts` is the one gate every route calls:

```ts
// services/tripBudget/authz.ts
import { assertTripMember } from '../trips/authz.js';          // one membership query; applies actingRole (interim organizer) internally
import { can, type TripAction, type TripRole } from '../trips/permissions.js';
import { AppError } from '../../errors/AppError.js';
import type { DbPool } from '../../db/pool.js';

export async function requireBudgetAction(pool: DbPool, userId: string, tripId: string, action: TripAction): Promise<TripRole> {
  const role = await assertTripMember(pool, userId, tripId);   // throws the opaque trip_forbidden for a non-member AND for an unknown Trip
  if (!can(role, action)) throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
  return role;
}
```

`assertTripMember` returns the ACTING role (verified in source: it runs `SELECT tm.role, <ACTIVE_ORGANIZER_COUNT_SQL> ... FROM trip_memberships tm` and passes the row to `actingRole`, which returns `'organizer'` for a persisted member of a Trip with no active organizer after one roster read), so the interim-organizer rule of `account-deletion` R7 and the `pending_deletion` organizer case are handled without this module reading a role itself, the permission matrix `can(role, action)` is always consulted (the point of `trips` R25.2: Budget does not stop at membership as Expenses do), and the file contains no `FROM|JOIN trip_memberships` literal, so `roleReader.guard.test.ts` check 1 and `trip_memberships.guard.test.ts` are untouched by it. The Budget repo's single pinned raw `trip_memberships` read (Requirement 18.8) is a party-validation read for named people, not a caller-role read, and does not select `role`. There is no `services/budget/` directory. Non-members and unknown Trips collapse to `trip_forbidden` (Requirement 18.3). **Test:** `tripBudget/__tests__/authz.test.ts` and the route matrix assert that a persisted `member` of a Trip whose only organizer is `pending_deletion` (no active organizer) is allowed `edit_budget_settings` (the interim organizer), that the same member is `trip_forbidden` for it once an active organizer exists, and `roleReader.guard.test.ts` is run unmodified in tasks 14.1, 15.1 and 15.3.

**Roster and visibility guards.** Two repo-wide structural tests apply to `services/tripBudget/repo.ts` and must be run in tasks 14.x and 15.x: `apps/api/src/__tests__/trip_memberships.guard.test.ts` (pins the exact count of `(FROM|JOIN) trip_memberships` per file; this repo has exactly one, so add `{ file: 'services/tripBudget/repo.ts', hits: 1, reason: 'Party validation: a pending-deletion member still counts as on the Trip so existing allocations stay readable and an edit reports trip_party_deleted.' }` to `ROSTER_ALLOWLIST`) and `apps/api/src/__tests__/visibility.guard.test.ts` (fails on any `FROM|JOIN users|profiles|friendships` literal that lacks `ACTIVE_USER_SQL(` or `deletion_state = 'active'`; this repo has none because labels use the `profile_identity` view and deletion detection reuses `findNonVisibleParties`, which is already allowlisted in `tripExpenses/repo.ts`). The departure change in `trips/repo.ts` (below) deletes from `trip_traveler_profiles` and adds no `trip_memberships` match, so that file's pin is unchanged. `account-deletion` Appendix B gets an addendum row for the Budget by-person view and the traveler list (PLACEHOLDER for lines and allocations, OMIT for the profiles of pending accounts).

**Departure.** `departMember` in `services/trips/repo.ts` (the shared path of `leave` and `remove`, around line 2640) gains, in its existing transaction right after the `DELETE FROM trip_memberships ...` statement, `DELETE FROM trip_traveler_profiles WHERE trip_id = $1 AND member_id = $2` (Requirement 4.7). Budget_Allocations of the departed member are not touched. The same applies to `removeTripGuest` in `tripExpenses/repo.ts`, which becomes a **lock-first transaction** (review F16, corrected by round 4 M6). The current check-then-delete is two statements, and because `trip_budget_allocations.guest_id` is `ON DELETE CASCADE` an allocation inserted between them would be silently deleted with the guest. A single `DELETE ... WHERE NOT EXISTS (...)` does NOT close that race on PostgreSQL READ COMMITTED (reasoned, not executed at spec time): a concurrent allocation insert holds only a `FOR KEY SHARE` lock on the guest row through its FK check; the `DELETE` blocks on it, and when the inserter commits the `DELETE` proceeds WITHOUT re-evaluating its `NOT EXISTS` subquery (the row it waited on was locked, not updated, so no EvalPlanQual re-check happens), deletes the guest, and the cascade then removes the just-committed allocation. The transaction is therefore: `BEGIN; SELECT id, sponsor_member_id FROM trip_guests WHERE id = $1 AND trip_id = $2 FOR UPDATE;` (zero rows -> `ROLLBACK`, the existing not-found behavior; the sponsor-or-organizer check runs on the returned row as today; the `FOR UPDATE` lock conflicts with the `FOR KEY SHARE` of an in-flight allocation, expense-share, assignee or tier-count insert, so it WAITS for them to commit, and it blocks any new such insert from passing its FK check until this transaction ends); then the reference checks as ordinary statements (each statement takes a fresh READ COMMITTED snapshot, so it sees an allocation committed while the lock was awaited): `SELECT 1 FROM trip_budget_allocations WHERE guest_id = $1 LIMIT 1` plus the three existing expense reference queries, exactly as the current check issues them; any hit -> `ROLLBACK` and the existing `trip_validation_failed` for "referenced"; else `DELETE FROM trip_guests WHERE id = $1 AND trip_id = $2; COMMIT`. The guest's Traveler_Profile goes with it through the FK `ON DELETE CASCADE`; no explicit profile delete is needed (the test asserts the outcome, not the mechanism). **FK violation `23503`** raised by the inserter side when the guest was deleted first (an allocation, expense share, assignee, tier-count or profile insert naming a guest that a concurrent removal just deleted) is mapped to `trip_validation_failed` in `tripBudget/repo.ts` (`createLine`/`editLine`/`upsertProfile`) so it never surfaces as a 500; the same mapping is added where `tripExpenses/repo.ts` inserts guest-referencing rows only if a test shows the code path reachable (otherwise the existing validation-before-insert path is unchanged). **Tests (task 14.4):** (1) a pg-mem test inserts an allocation referencing the guest, calls `removeTripGuest` and asserts rejection with the guest row and the allocation both surviving, and that an unreferenced guest is removed together with its profile; (2) a `*.livedb.test.ts` two-connection test (`tripBudget/__tests__/guestRemoval.livedb.test.ts`): connection A `BEGIN`s and inserts a `trip_budget_allocations` row for the guest WITHOUT committing; connection B starts `removeTripGuest` (it blocks on the lock); A commits; assert B rejects with `trip_validation_failed` and the allocation row and the guest row both still exist. If the implementer runs this test against a deliberately single-statement `DELETE ... WHERE NOT EXISTS` implementation and it PASSES on the target Postgres version, the single statement is sufficient, and the implementer records that evidence (Postgres version, the output) in this paragraph instead of the lock-first transaction. Run once locally and paste the output; skipped is not a pass.

Server-side amount resolution on create and edit: for `disney_ticket_calendar`, each allocation's `priceRef` (ticket) is resolved with `resolveTicketPrice` against the current book; a `null` price rejects the request with `trip_validation_failed` ("no price available, use user_entered"). The client always sends the full ticket `priceRef` (including `ageGroup`); the server does not infer it from the Traveler_Profile. For a 1-day base ticket whose `priceRef.park` is absent, the server first applies `TICKET_PARK_BY_CANONICAL_PARK[line.park]` when the line has a mappable `park` (Requirement 14.9), and stores the applied park in the stored `priceRef`. `applyTip: true` on a non-`dining` line is rejected with `trip_validation_failed` (Requirement 2.3). For `themeparks_ll`, `lookupLlPrice` is used and the line is stored with `priceSource = 'themeparks_ll'`, the `llPriceRef`, the resolved cents as the snapshot and `asOf` = the quote's `asOf` (a stored real price: its own `capturedAt`; a typical estimate: the `newestSampleDate` of the history used, never `now`, round 4 L4) **whether the result was a stored real price or a typical estimate** (review F2: the stored source is never `typical_estimate`, so the line upgrades to the real price on read once it exists); `no_estimate` rejects with `trip_validation_failed`. For `disney_menu`, the line must be `dining` with a non-null `experienceId`, every allocation carries a `menu` `priceRef`, the server computes `amountCents` from the verified selection and stores that (a submitted differing `amountCents` is rejected; review F3). For `user_entered`, `amountCents` is required for every allocation. The line `price_as_of` is the oldest `asOf` among resolved allocations (or `now` for user-entered and menu); an edit (PATCH) re-stamps it by the same rule (round 4 M5). **Menu name comparison (round 4 L9):** the server compares each submitted `priceRef` item `name` to the cached item title after the SAME normalization on both sides, `normalizeMenuName(s) = s.trim().slice(0, 100)` (and, round 5 L8, `normalizeTierName(label) = label.trim().slice(0, EXPENSE_TIER_NAME_MAX)` for a `tier` offer label, with the same both-sides rule: the cached `MenuPriceOffer.label` is normalized before it is compared to the submitted `tier.name`, and the Mobile_App sets `tier.name = normalizeTierName(offer.label)`), exported from `@dwt/shared/menuPricing.ts` and used by `selectionToExpenseItems`, `menuPriceRefSchema` (`name` max 100) and the server verification, so a menu item whose title is longer than 100 characters is neither rejected by the schema nor mismatched by the verification.

### Admin (`admin/ticketPriceRoutes.ts`)

**Port and wiring (review F7, round 4 M3).** The port and its two state/result types live in a **type-only file `apps/api/src/services/ticketPrices/adminPort.ts`, created by task 8.3** (so 8.3 and 8.4 typecheck before the admin routes exist). `apps/api/src/services/admin/routes.ts` imports it and re-exports it (`export type { AdminTicketPricesPort, AdminTicketPricesState, AdminDiagnoseResult } from '../ticketPrices/adminPort'`) in task 10.1. The file defines

```ts
// services/ticketPrices/adminPort.ts  (type-only; no runtime code)
export interface AdminTicketPricesState {
  enabled: boolean;                                   // TICKET_PRICES_ENABLED as resolved
  control: {
    lastAttemptAt: string | null; lastProbeAt: string | null; blockedUntil: string | null;
    inProgressSince: string | null; observedHorizonDate: string | null;
    lastDiagnoseAt: string | null; lastStatus: string | null; lastError: string | null;   // lastError is a Ticket_Error_Code or null
  };
  sets: { discountGroup: string; numDays: number; asOf: string | null; horizonDate: string | null;
          rowCount: number; windowDays: number | null; lastError: string | null }[];
  totalRows: number;                                  // SELECT count(*) FROM ticket_prices
  tableSize: string;                                  // pg_size_pretty(pg_total_relation_size('ticket_prices'))
  config: Record<string, string | number | boolean>;  // non-secret resolved TICKET_PRICES_* values only
}
export interface AdminDiagnoseResult {
  token: { status: number; bytes: number; ms: number };
  prices: { status: number; bytes: number; ms: number; wafMarker: boolean; startDateSent: string; retried: boolean };
  maxPricingCalendarDate: string | null;              // YYYY-MM-DD from the response, or null when absent/unparseable
  adultMk1DayPriceCents: number | null;               // adult theme-park_1_A_0_0_RF_AF_SOF_progenstr_mk subtotal in cents
}

export interface AdminTicketPricesPort {
  /** One read of the control row, every set row, ticket_prices row total, pg_size_pretty size, and the resolved non-secret config. */
  readState(): Promise<AdminTicketPricesState>;
  /** Admin 'Refresh now': same claim as a full run with the attempt cooldown bypassed; returns immediately (async run). */
  runNow(): Promise<{ outcome: 'started' | 'disabled' | 'blocked' | 'already_running'; blockedUntil?: string }>;
  /** Two calls, writes no price rows, takes the diagnose claim (60 s minimum interval). */
  diagnose(): Promise<AdminDiagnoseResult | { refused: 'blocked' | 'already_running' | 'too_soon'; blockedUntil?: string }>;   // never reads TICKET_PRICES_ENABLED; works while the kill switch is off (Requirement 19.3)
  /** Sets blocked_until = now + TICKET_PRICES_BLOCK_COOLDOWN_MINUTES, reason 'manual'. Works while the kill switch is on or off. */
  blockNow(): Promise<{ blockedUntil: string }>;
}
```

and task 10.1 adds `ticketPrices?: AdminTicketPricesPort` to `AdminRoutesOptions`, mirroring the existing `photos?: AdminPhotoPort` (when absent, the four ticket-price routes are not registered, so existing admin tests are unaffected). Task 8.3 creates `adminPort.ts` and an implementation of the port; task 8.4 constructs the refresh service and that object; task 10.1 passes it as `ticketPrices: adminTicketPrices` inside the existing `admin:` block of `composeServices.ts` (next to `photos: adminPhotos`) and registers the routes. Task 10.1 is scheduled after 8.4 in the dependency graph.

Four routes registered by `adminRoutes` with `preHandler: options.basicAuth`, reusing `renderPage`, `table`, `flagged` and `explainerBanner` from `html.ts`:

- `GET /admin/ticket-prices`: renders the Kill_Switch (with the operator gate text of Requirement 13.2 while it is false), the recorded decision and revisit notice (Requirements 21.1, 21.2), the control row, a table of `ticket_price_sets`, the row total and the table size (`SELECT pg_size_pretty(pg_total_relation_size('ticket_prices'))`, Requirement 19.1), and the non-secret configuration. Contains the "Refresh now", "Diagnose" and "Block now" forms and no price input. All error text shown is a Ticket_Error_Code rendered through the escaping `table` helper.
- `POST /admin/ticket-prices/refresh`: `isSameOriginRequest` -> `ticketPrices.runNow()`; responds with a redirect to the page and a flash message (`started`, `disabled`, `blocked until ...`, `already running`).
- `POST /admin/ticket-prices/diagnose`: `isSameOriginRequest` -> `diagnose()` -> renders the result table, or the refusal reason (`too_soon` shows the seconds remaining).
- `POST /admin/ticket-prices/block`: `isSameOriginRequest` -> `blockNow()` -> redirect with flash "blocked until ...". This is the instant kill switch (review F23): `TICKET_PRICES_ENABLED` is an environment variable and changing it needs a redeploy, whereas "Block now" takes effect on the next claim attempt of every instance and, for a run already in flight, before that run's next Disney call (the run re-reads `blocked_until` before each call, Requirement 13.12, round 5 L4), so an in-flight run makes at most the one call already in progress after the click. The page documents both side by side.

`diagnose()` (no cache writes): takes the `diagnose` claim of the control-claim section (refuses with `blocked`, `already_running`, `too_soon` (a 60-second minimum between diagnoses, `TICKET_PRICES_DIAGNOSE_MIN_INTERVAL_SECONDS`)). **`diagnose()` never reads `TICKET_PRICES_ENABLED`; its only refusals are `blocked`, `already_running` and `too_soon`** (round 4 M1: the operator gate of Requirement 13.2 requires three successful diagnoses while the switch is still false, so a `disabled` refusal would deadlock it); calls `getToken`; calls `getPrices({discountGroup:'std-gst', numDays:1, startDate: today, endDate: today})` (the client's one 400 retry, Requirement 11.13, appears as a third row with the `startDate` actually sent; the result always reports the `startDate` sent so the operator can run it after 20:00 ET); extracts `maxPricingCalendarDate` and the adult `theme-park_1_A_0_0_RF_AF_SOF_progenstr_mk` `subtotal`; on a WAF outcome it sets `blocked_until` exactly as a refresh would. The result object contains `{ token: {status, bytes, ms}, prices: {status, bytes, ms, wafMarker, startDateSent, retried}, maxPricingCalendarDate, adultMk1DayPriceCents }`, never the token.

### Mobile

- `TripsStack.tsx`: add `TripBudget: { tripId: string }` and register `TripBudgetScreen`.
- **Hub tile (review F6; verified against the source: `HUB_SECTIONS` is derived from `HUB_SECTION_DEFS` by `hubSectionsFor(scheme)`, each entry needs a `body`, and `key` is typed `keyof typeof HUB_SECTION_COLOR.light`).** Exact edits:
  1. `apps/mobile/src/screens/trips/TripDetailScreen.tsx`: add `'TripBudget'` to the `HubSection['route']` union; add to `HUB_SECTION_DEFS`, immediately after the `expenses` entry, `{ key: 'budget', route: 'TripBudget', title: 'Budget', body: 'Plan costs, save per week, compare to what you spent.', icon: 'wallet-outline' }` (`wallet-outline` is a valid Ionicons glyph; the implementer confirms it exists in the installed `@expo/vector-icons` glyph map) with `testID` `trip-detail-section-budget`.
  2. `apps/mobile/src/screens/trips/TripDetailScreen.palette.ts`: add a `budget` entry to `HUB_SECTION_COLOR` through the existing `definePalette({ light, dark })` shape, with a light value distinct from `expenses` and a dark value readable on the Twilight surface (the same shape as the neighbouring entries; no raw literal outside this `*.palette.ts` file).
  3. `apps/mobile/src/screens/trips/__tests__/tripStructureRegression.test.tsx`: update deliberately: `HUB_SECTIONS` length 9 -> 10 with the new ordered key list (`budget` immediately after `expenses`), the byte-for-byte snapshot regenerated so that the diff is limited to the new `budget` entry (review the snapshot diff; do not regenerate blindly), and the `screenNames` length 16 -> 17 (adds `TripBudget`). No existing assertion is weakened or removed.
  4. **Render the visible tile (the three edits above change only the pinned contract list and do not paint anything; verified in source: the hub tiles are hand-written JSX blocks, `HUB_SECTIONS` is consumed only by `tripStructureRegression.test.tsx`).** In `TripDetailScreen.tsx`, inside `<View style={styles.grid} testID="trip-detail-grid">` and after the fourth `gridRow` (Tile 7 Packing list / Tile 8 Trip Album), add a **fifth** `<View style={styles.gridRow}>` so the four existing rows stay byte-identical. It contains one tile, copied from the structure of Tile 5 (Expenses):

     ```tsx
     {/* Tile 9: Budget */}
     <Pressable
       style={styles.hubTile}
       onPress={() => navigation.navigate('TripBudget', { tripId })}
       accessibilityRole="button"
       accessibilityLabel="Budget"
       testID="trip-detail-section-budget"
     >
       <View style={styles.tileBadge}>
         <Text style={[styles.tileBadgeText, { color: t.color.primaryFg }]}>Plan</Text>
       </View>
       <View style={[styles.tileIconWrap, { backgroundColor: withAlpha(t.color.primary, 0.1) }]}>
         <Ionicons name="wallet-outline" size={20} color={t.color.primaryFg} />
       </View>
       <Text style={styles.tileTitle}>Budget</Text>
       <Text style={styles.tileDesc} numberOfLines={2}>Plan costs & save per week.</Text>
     </Pressable>
     ```

     Layout decision: the lone tile spans the full row width because `hubTile` is `flex: 1`; no spacer and no new style are added (a half-width tile is a later design choice, not part of this spec). `withAlpha` is already imported in the file (used by Tile 3). `HUB_SECTIONS` order (budget right after expenses) is the pinned contract list and is independent of the grid order (the grid shows Budget last).
- Cache-state text (review F20, round 4 M2; **precedence: when `quote.flUnavailable` is true the Florida text is rendered and `cacheState` is ignored**): `BudgetLineFormModal` renders, from `PriceQuoteDTO.cacheState` when a ticket quote has a null price and `flUnavailable` is not true: `warming` -> "Prices are being fetched, try again in a minute"; `disabled` -> "Automatic ticket prices are unavailable right now; enter your price"; `failed` (round 5 M4) -> "Automatic ticket prices could not be fetched; enter your price"; `ready` with a null price falls through to the existing "Add your price" / "Florida resident price unavailable for N days; enter your price" texts. The text is rendered as a `Text` node with an `accessibilityLabel` equal to it.
- `screens/trips/TripBudgetScreen.tsx`: header with total; view chips (Party, Person, Day, Park, Category) with `accessibilityState.selected`; Savings_Plan card; Suggestions list with Accept and Dismiss; line list with `PriceBadge`; "Travelers", "Settings" and "Add line" actions.
- `screens/trips/BudgetLineFormModal.tsx`: category-aware form (ticket quote picker, LL picker, restaurant picker, manual price); posts through `budgetApi`. The ticket quote picker includes a **park picker** (Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom) shown only when days is 1 and the option is base; it defaults from the line's `park` through `TICKET_PARK_BY_CANONICAL_PARK`, sends `priceRef.park` as `mk|ep|hs|ak`, and when the user leaves it unset the quote returns `parkAssumed: true` with the text "Estimate (highest park price)". The Florida-resident message is rendered from `quote.flUnavailable` (Requirement 14.8).
- `screens/trips/BudgetTravelersModal.tsx`, `BudgetSettingsModal.tsx` (organizer only), `budgetApi.ts` (query keys `budgetKeys.detail(tripId)`, `.suggestions(tripId)`; client functions for every route above).
- `components/PriceBadge.tsx`: renders `priceLabelText(...)` plus the attribution line (`Powered by ThemeParks.wiki` link for LL; the Disney source line for tickets), with an `accessibilityLabel` containing the same text.
- `components/MenuItemPicker.tsx` and `components/menuItemPicker.pure.ts` (pure: `buildPickerRows`, `selectionToExpenseItems`, `selectionSubtotalCents`, `selectionToBudgetPriceRef`).
- `screens/trips/ExpenseFormModal.tsx` (uncommitted user edits present): the only change is an additive "Pick from menu" entry that opens `MenuItemPicker` and appends the confirmed drafts to the existing item state, plus offering parsed prix fixe offers through the existing "Menu Pricing Suggestions" card. Start from the current working tree; do not reformat or move existing code.
- `receiptScan.pure.ts`: replace the body of `extractTierPriceSuggestions` with a re-export from `@dwt/shared` (same name, same signature).

## Data Models

Next free migrations: the highest existing file is `0064_account_deletion.sql`. This feature reserves **`0065`, `0066`, `0067`, `0068`**. The implementer SHALL re-list `apps/api/migrations/` before creating them and shift all four numbers upward together if another migration landed first (round 4 L10: `photo-uploads/design.md` mentions a conditional, currently unused `0065_*.sql` covering index; whichever spec lands first takes `0065` and the other shifts, so check both specs' migrations before numbering). All files are additive and idempotent, wrapped in `BEGIN`/`COMMIT`, and none edits an applied migration. Tests: `apps/api/src/db/__tests__/migration0065.test.ts` ... `migration0068.test.ts`.

### Migration `0065_ticket_prices.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS ticket_prices (
  discount_group TEXT     NOT NULL CHECK (discount_group IN ('std-gst', 'fl-resident')),
  num_days       SMALLINT NOT NULL CHECK (num_days BETWEEN 1 AND 10),
  age_group      TEXT     NOT NULL CHECK (age_group IN ('adult', 'child')),
  option_code    TEXT     NOT NULL CHECK (option_code IN ('base', 'park_hopper', 'park_hopper_plus', 'water_parks_sports')),
  park           TEXT     NOT NULL DEFAULT 'any' CHECK (park IN ('any', 'mk', 'ep', 'hs', 'ak')),
  start_date     DATE     NOT NULL,
  price_cents    INTEGER  NOT NULL CHECK (price_cents > 0),
  tax_cents      INTEGER  NOT NULL CHECK (tax_cents >= 0),
  valid_end_date DATE     NOT NULL,
  product_id     TEXT     NOT NULL,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (discount_group, num_days, age_group, option_code, park, start_date)
);

CREATE TABLE IF NOT EXISTS ticket_price_sets (
  discount_group  TEXT     NOT NULL CHECK (discount_group IN ('std-gst', 'fl-resident')),
  num_days        SMALLINT NOT NULL CHECK (num_days BETWEEN 1 AND 10),
  as_of           TIMESTAMPTZ,
  horizon_date    DATE,
  row_count       INTEGER CHECK (row_count IS NULL OR row_count >= 0),
  window_days     SMALLINT CHECK (window_days IS NULL OR window_days > 0),   -- days in the fetch window that produced row_count (review F18); additive to report 4.2
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,                       -- a Ticket_Error_Code only (closed set below, review F19)
  blocked_until   TIMESTAMPTZ,
  PRIMARY KEY (discount_group, num_days)
);

-- One-row global control: cooldown, probe time, in-progress claim, WAF block.
CREATE TABLE IF NOT EXISTS ticket_price_control (
  id               SMALLINT PRIMARY KEY CHECK (id = 1),
  last_attempt_at  TIMESTAMPTZ,
  last_probe_at    TIMESTAMPTZ,
  blocked_until    TIMESTAMPTZ,
  in_progress_since TIMESTAMPTZ,
  observed_horizon_date DATE,                 -- maxPricingCalendarDate last seen by any probe (review F25)
  last_diagnose_at TIMESTAMPTZ,               -- diagnose throttle: 60 s minimum interval (review F23)
  last_status      TEXT,
  last_error       TEXT,                      -- ALWAYS a Ticket_Error_Code (closed set, below); never upstream body text (review F19)
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ticket_price_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMIT;
```

This is report section 4.2 verbatim for the first two tables, plus `ticket_price_control`. `ticket_price_sets.blocked_until` is retained from the report for per-set visibility; the authoritative block is `ticket_price_control.blocked_until` (the repo writes both on a WAF block). No user foreign key, so no `dispositions.ts` entry (the registry test confirms; Property 30).

The upsert for a chunk of at most 2,000 deduped rows uses `unnest` arrays:

```sql
INSERT INTO ticket_prices (discount_group, num_days, age_group, option_code, park, start_date,
                           price_cents, tax_cents, valid_end_date, product_id)
SELECT * FROM unnest($1::text[], $2::smallint[], $3::text[], $4::text[], $5::text[], $6::date[],
                     $7::int[], $8::int[], $9::date[], $10::text[])
ON CONFLICT (discount_group, num_days, age_group, option_code, park, start_date) DO UPDATE SET
  price_cents = EXCLUDED.price_cents, tax_cents = EXCLUDED.tax_cents,
  valid_end_date = EXCLUDED.valid_end_date, product_id = EXCLUDED.product_id, changed_at = now()
WHERE (ticket_prices.price_cents, ticket_prices.tax_cents, ticket_prices.valid_end_date)
      IS DISTINCT FROM (EXCLUDED.price_cents, EXCLUDED.tax_cents, EXCLUDED.valid_end_date);
```

**Test-database note (applies to every statement in this section).** pg-mem implements only the one-argument `unnest`, has no error `21000`, no real concurrency, no tuple `IS DISTINCT FROM (...)` guarantees and no `make_interval`, so the SQL of `ticketPrices/repo.ts` (this multi-array `unnest` upsert, the tuple `IS DISTINCT FROM`, the claim with `make_interval`, the reconcile anti-join) CANNOT be asserted on pg-mem. Its real-SQL tests are `*.livedb.test.ts` files in the pattern of `intelligence/__tests__/intelligenceRepoBaselineColumns.livedb.test.ts` (probe the database, `describe.skip` cleanly when it is unreachable; default URL `postgres://dwt:dwt@localhost:5432/dwt`), and the executor MUST run them once against the local Postgres and paste the output (Testing Strategy). A pg-mem-compatible unit layer is optional and, if written, uses a single-array `unnest` or a generated multi-row `VALUES` list for the same logical upsert.

Reconcile after an accepted set (round 4 L6): `DELETE FROM ticket_prices WHERE discount_group=$1 AND num_days=$2 AND start_date BETWEEN $startDateSent AND $endDate AND (age_group, option_code, park, start_date) NOT IN (<fetched keys>)` implemented with a temp key list or `unnest` anti-join; `$startDateSent` is the `startDate` the accepted response was actually requested with (the WDW_Today date, or `max(WDW_Today, UTC date)` after the one start-date retry of Requirement 11.13), so a response that does not cover the WDW_Today row can never delete it; the sanity guard bounds the blast radius. Prune (unconditional, unchanged): `DELETE FROM ticket_prices WHERE start_date < $today`. The livedb test adds a case: existing rows for `$today` and `$today + 1`, an accepted set requested from `$today + 1` (the UTC-retry case) leaves the `$today` row in place.

Control claim (atomic, multi-instance safe). `claimControl(mode, bypassCooldown, claimTimeoutMinutes, intervalHours)` runs one of three statements. **No outcome ever restores or rewinds a stamp** (review F1): the claim-time `last_attempt_at` / `last_probe_at` / `last_diagnose_at` is final, so no `prev_attempt_at` is returned and no `WITH prev ... FOR UPDATE` CTE is needed. The claim timeout is a parameter (`TICKET_CLAIM_TIMEOUT_MINUTES`, code constant 15, passed as `$2`/`$3` below), never a literal in the SQL (review F22):

```sql
-- mode 'full' (and the admin 'Refresh now', which passes $1 = true to bypass the attempt cooldown only)
UPDATE ticket_price_control c
   SET in_progress_since = now(), last_attempt_at = now(), updated_at = now()
 WHERE c.id = 1
   AND (c.in_progress_since IS NULL OR c.in_progress_since < now() - make_interval(mins => $2))
   AND (c.blocked_until IS NULL OR c.blocked_until <= now())
   AND ($1::boolean OR c.last_attempt_at IS NULL OR c.last_attempt_at <= now() - make_interval(hours => $3))
RETURNING c.*;

-- mode 'probe_only': judged and stamped on last_probe_at; never reads or writes last_attempt_at
UPDATE ticket_price_control
   SET in_progress_since = now(), last_probe_at = now(), updated_at = now()
 WHERE id = 1
   AND (in_progress_since IS NULL OR in_progress_since < now() - make_interval(mins => $1))
   AND (blocked_until IS NULL OR blocked_until <= now())
   AND (last_probe_at IS NULL OR last_probe_at <= now() - make_interval(hours => $2))
RETURNING *;

-- mode 'diagnose' (review F23): same in-progress claim, 60-second minimum between diagnoses, stamps last_diagnose_at
UPDATE ticket_price_control
   SET in_progress_since = now(), last_diagnose_at = now(), updated_at = now()
 WHERE id = 1
   AND (in_progress_since IS NULL OR in_progress_since < now() - make_interval(mins => $1))
   AND (blocked_until IS NULL OR blocked_until <= now())
   AND (last_diagnose_at IS NULL OR last_diagnose_at <= now() - make_interval(secs => $2))   -- $2 = TICKET_PRICES_DIAGNOSE_MIN_INTERVAL_SECONDS (60)
RETURNING *;

-- upgradeClaimToFull (review F25): a probe_only run that found a moved horizon may pull only if it also wins the attempt cooldown
UPDATE ticket_price_control
   SET last_attempt_at = now(), updated_at = now()
 WHERE id = 1 AND in_progress_since IS NOT NULL
   AND (last_attempt_at IS NULL OR last_attempt_at <= now() - make_interval(hours => $1))
RETURNING *;
```

Stamping `last_attempt_at` at claim time (not at release) means a run that crashes, is killed, or fails before its probe still counts as an attempt, so a failing environment cannot be retried by every Budget read. Release: `UPDATE ... SET in_progress_since = NULL, last_status = $1, last_error = $2` (no stamp is touched). Amendment (checkpoint 11 re-review N-d): the stored `last_error` is not blindly overwritten by `$2`; the implemented rule is `last_error = CASE WHEN $2 IS NOT NULL THEN $2 WHEN $1 = 'blocked' OR (blocked_until IS NOT NULL AND blocked_until > now()) THEN last_error ELSE NULL END`, that is, an explicit error code wins, otherwise a release with status `blocked`, or any release while `blocked_until` is still in the future, keeps the reason that `block(until, reason)` just stored (so the admin page keeps showing `waf_block`, `start_date_rejected` or `consecutive_failures` after the blocked run ends, Requirements 11.14 and 19.7), and otherwise the reason is cleared (a `done` run after the block has expired clears a stale reason); `runDiagnose` passes `'waf_block'` as the error code to `releaseControl` when its own call hit a WAF block, so the control row ends with `last_error = 'waf_block'` and the reason is not overwritten. `recordProbe(now, horizon)` stamps `last_probe_at` and `observed_horizon_date` inside a full run and a probe run. A WAF, consecutive-failure or `start_date_rejected` `block(until, reason)` sets `ticket_price_control.blocked_until` and every `ticket_price_sets.blocked_until` of the run. The admin "Block now" action (Admin section) calls `block(now + TICKET_PRICES_BLOCK_COOLDOWN_MINUTES, 'manual')` directly.

**Ticket_Error_Code (closed set, review F19).** `last_error` on `ticket_price_sets` and `ticket_price_control`, and every `reason` passed to `block`, is one of exactly these strings, exported from `services/ticketPrices/errorCodes.ts` as `TICKET_ERROR_CODES` plus the pattern `http_status:<3 digits>`: `invalid_response`, `not_offered`, `start_date_rejected`, `row_count_drop`, `empty`, `invalid_price`, `unrecognized_fraction`, `network`, `timeout`, `waf_block`, `manual`, `consecutive_failures`, `horizon_changed`. The repo normalizes any other value to `invalid_response` before writing. Upstream response text is never stored, logged at `info` or above, or rendered; the admin page renders codes through the `table` helper in `admin/html.ts`, which HTML-escapes cell text, and the `ticketPriceRoutes.test.ts` asserts that a code containing `<script>` supplied by a fake repo is rendered escaped.

### Migration `0066_lightning_lane_prices.sql`

```sql
BEGIN;

ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_multipass_available BOOLEAN;
ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_premier_price_cents INTEGER;
ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_premier_available BOOLEAN;
ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_prices_captured_at TIMESTAMPTZ;   -- newest capture of EITHER pass (operator gate, Requirement 20.7)
ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_multipass_captured_at TIMESTAMPTZ; -- age of the stored Multi Pass price (round 4 L1)
ALTER TABLE park_schedule_signals ADD COLUMN IF NOT EXISTS ll_premier_captured_at TIMESTAMPTZ;   -- age of the stored Premier Pass price (round 4 L1)

CREATE TABLE IF NOT EXISTS lightning_lane_single_prices (
  park            TEXT NOT NULL,
  date            DATE NOT NULL,
  purchase_id     TEXT NOT NULL,
  experience_id   UUID REFERENCES experiences(id) ON DELETE SET NULL,
  attraction_name TEXT NOT NULL,
  price_cents     INTEGER NOT NULL CHECK (price_cents > 0),
  available       BOOLEAN,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (park, date, purchase_id)
);
CREATE INDEX IF NOT EXISTS idx_ll_single_experience_date ON lightning_lane_single_prices (experience_id, date);
CREATE INDEX IF NOT EXISTS idx_ll_single_date ON lightning_lane_single_prices (date);

COMMIT;
```

`park_schedule_signals` is created by migration `0020` (owned by `crowd-calendar`); the implementer SHALL confirm no later migration changed its primary key `(park, date)`.

**One writer.** There is no separate `upsertLightningLanePrices`. The existing `ScheduleSignalRow` (in `IntelligenceRepo.ts`) gains four optional fields (`ll_multipass_available`, `ll_premier_price_cents`, `ll_premier_available`, `ll_prices_captured_at`, each `?: T | null`, so every existing caller and test that builds a row without them still compiles), and `upsertParkScheduleSignals` is extended to 12 arrays (`$9::boolean[]`, `$10::int[]`, `$11::boolean[]`, `$12::timestamptz[]`) and 6 more `SET` assignments (the four new row fields, and the two derived per-pass timestamps), still one statement per park per pass, still `ON CONFLICT (park, date)`. **Non-destructive on null (round 3 M3).** The existing statement assigns `ll_multipass_price_cents = EXCLUDED.ll_multipass_price_cents`, which would let one failed or empty extraction overwrite stored prices with NULL for every date of the park. The extended statement therefore assigns `ll_multipass_price_cents`, `ll_multipass_available`, `ll_premier_price_cents` and `ll_premier_available` as `col = COALESCE(EXCLUDED.col, park_schedule_signals.col)`, and three timestamps, each advancing only with a fresh price of its own kind (round 4 L1: one shared timestamp would label a stale Premier Pass price `current` whenever a later pass carried only a Multi Pass price): `ll_multipass_captured_at = CASE WHEN EXCLUDED.ll_multipass_price_cents IS NOT NULL THEN EXCLUDED.ll_prices_captured_at ELSE park_schedule_signals.ll_multipass_captured_at END`, `ll_premier_captured_at = CASE WHEN EXCLUDED.ll_premier_price_cents IS NOT NULL THEN EXCLUDED.ll_prices_captured_at ELSE park_schedule_signals.ll_premier_captured_at END`, and `ll_prices_captured_at = CASE WHEN EXCLUDED.ll_multipass_price_cents IS NOT NULL OR EXCLUDED.ll_premier_price_cents IS NOT NULL THEN EXCLUDED.ll_prices_captured_at ELSE park_schedule_signals.ll_prices_captured_at END` (the newest of either; it is what the operator gate of Requirement 20.7 watches). The builder still supplies ONE incoming timestamp per row (`ll_prices_captured_at`), so `ScheduleSignalRow` gains no extra field and the statement stays at 12 arrays; the two per-pass columns are derived in SQL. `StoredLlRow.capturedAt` for a `multi` row is read from `ll_multipass_captured_at` and for a `premier` row from `ll_premier_captured_at`, so each quote's `current`/`may_have_changed` label is judged on the age of ITS OWN price. The three timestamps describe the stored values and only advance with fresh prices. The other columns (`open_time`, `close_time`, `early_entry`, `extended_evening`, `ticketed_event`) keep their existing assignment semantics unchanged. Consequence for existing code: `ll_multipass_price_cents` can no longer be erased by a pass that lacks a Multi Pass purchase; the implementer reads the existing `IntelligenceRepo` and sampling tests first and, if one asserts that a later pass without a Multi Pass purchase clears the column, amends that single assertion deliberately and says so in the final report (no other behavior of the column changes). The source value of `ll_multipass_price_cents` changes to the id-prefix classifier. The row builder in `samplingService.ts` already dedupes by date in `schedRowsMap`. New repo methods: `upsertLightningLaneSinglePrices(rows)` (dedupe by `park|date|purchase_id` in a `Map`; `experience_id` resolved inside the statement by an EXACT, type-qualified join, round 5 M5: TypeScript extracts the numeric suffix `N` with `/_(\d+)$/` and sends it as one more parallel array `numeric_ids text[]` (NULL entries when the suffix is absent); the statement is `INSERT INTO lightning_lane_single_prices (park, date, purchase_id, experience_id, attraction_name, price_cents, available) SELECT v.park, v.date, v.purchase_id, e.id, v.attraction_name, v.price_cents, v.available FROM unnest($1::text[], $2::date[], $3::text[], $4::text[], $5::text[], $6::int[], $7::boolean[]) AS v(park, date, purchase_id, numeric_id, attraction_name, price_cents, available) LEFT JOIN experiences e ON e.upstream_entity_id = v.numeric_id || ';entityType=Attraction' ON CONFLICT (park, date, purchase_id) DO UPDATE SET ...`. The join column is the unique index `experiences_upstream_entity_id_key` (verified on the local development database: zero duplicate full ids), so it returns at most one Experience per input row and the batch can never present the same conflict key twice, whereas the earlier `split_part(upstream_entity_id, ';', 1) = N` join was NOT unique (verified read-only on the local development database: the numeric prefix `80010856` is shared by a `Dinner-Show` and an `Entertainment` Experience, so the join returned two rows for one input and would raise error `21000`, after which every single-pass batch would fail on every pass and Single Pass persistence would silently stop; the first segment is also not indexed). An Experience of another entity type is never linked. `ON CONFLICT (park, date, purchase_id) DO UPDATE SET price_cents, available, attraction_name, experience_id, captured_at = now()`), `pruneLightningLaneSinglePrices(olderThanDate)`, and `getLlSinglePricesLastCapturedAt()`. Because the 12-array `unnest` cannot run on pg-mem, the tests of these methods are `*.livedb.test.ts` (see the test-database note above).

### Migration `0067_menu_shape_version.sql`

```sql
BEGIN;
ALTER TABLE experience_menus ADD COLUMN IF NOT EXISTS shape_version SMALLINT NOT NULL DEFAULT 1;
COMMIT;
```

### Migration `0068_trip_budget.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS trip_traveler_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id          UUID REFERENCES trip_guests(id) ON DELETE CASCADE,
  age_bracket       TEXT NOT NULL CHECK (age_bracket IN ('adult', 'child', 'under3')),
  ticket_option     TEXT CHECK (ticket_option IS NULL OR ticket_option IN ('base','park_hopper','park_hopper_plus','water_parks_sports')),
  ticket_days       SMALLINT CHECK (ticket_days IS NULL OR ticket_days BETWEEN 1 AND 10),
  ticket_start_date DATE,
  discount_group    TEXT NOT NULL DEFAULT 'std-gst' CHECK (discount_group IN ('std-gst', 'fl-resident')),
  pass_type         TEXT NOT NULL DEFAULT 'none' CHECK (pass_type IN ('none','annual_pass','dvc','other_discount')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_traveler_person_xor CHECK ((member_id IS NULL) <> (guest_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_traveler_member ON trip_traveler_profiles (trip_id, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_traveler_guest  ON trip_traveler_profiles (trip_id, guest_id)  WHERE guest_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trip_budget_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  created_by        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category          TEXT NOT NULL CHECK (category IN ('tickets','lightning_lane','dining','lodging','transportation','shopping','other')),
  description       VARCHAR(200) NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 200),
  planned_date      DATE,
  park              TEXT CHECK (park IS NULL OR park IN ('Magic Kingdom','EPCOT','Hollywood Studios','Animal Kingdom','Typhoon Lagoon','Blizzard Beach','Disney Springs')),
  experience_id     UUID REFERENCES experiences(id) ON DELETE SET NULL,
  price_source      TEXT NOT NULL CHECK (price_source IN ('disney_ticket_calendar','disney_menu','themeparks_ll','typical_estimate','user_entered')),
  price_as_of       TIMESTAMPTZ NOT NULL DEFAULT now(),
  price_ref         JSONB,
  apply_tip         BOOLEAN NOT NULL DEFAULT FALSE,
  linked_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  suggestion_key    TEXT CHECK (suggestion_key IS NULL OR char_length(suggestion_key) <= 120),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_budget_lines_trip ON trip_budget_lines (trip_id, planned_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_lines_suggestion ON trip_budget_lines (trip_id, suggestion_key) WHERE suggestion_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS trip_budget_allocations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id      UUID NOT NULL REFERENCES trip_budget_lines(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_id     UUID REFERENCES trip_guests(id) ON DELETE CASCADE,   -- same as 0060 expense_shares.guest_id and trip_traveler_profiles.guest_id; the user-facing rule (no removal while referenced) is enforced by the route, R3.5
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 10000000),   -- INTEGER, not BIGINT: node-pg returns int8/numeric as strings (round 3 M2); the cap fits in int4
  price_ref    JSONB,
  CONSTRAINT chk_budget_alloc_person_xor CHECK ((member_id IS NULL) <> (guest_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_alloc_member ON trip_budget_allocations (line_id, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_budget_alloc_guest  ON trip_budget_allocations (line_id, guest_id)  WHERE guest_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trip_budget_settings (
  trip_id              UUID PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  tax_bps              JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(tax_bps) = 'object'),   -- key/range validation is in the repo (R7.8)
  dining_tip_bps       INTEGER CHECK (dining_tip_bps IS NULL OR dining_tip_bps BETWEEN 0 AND 5000),
  saved_cents          INTEGER NOT NULL DEFAULT 0 CHECK (saved_cents BETWEEN 0 AND 1000000000),   -- 1,000,000,000 < 2^31 - 1, so INTEGER holds the cap
  savings_target_cents INTEGER CHECK (savings_target_cents IS NULL OR savings_target_cents BETWEEN 0 AND 1000000000),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trip_budget_dismissed_suggestions (
  trip_id        UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  suggestion_key TEXT NOT NULL CHECK (char_length(suggestion_key) <= 120),
  dismissed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, suggestion_key)
);

COMMIT;
```

The implementer SHALL read `0060_trip_expenses.sql` and mirror its constraint naming style, and confirm the table names `trips`, `trip_guests`, `experiences`, `expenses` exist. The DDL above is authoritative for the `ON DELETE` clauses (`trip_budget_allocations.guest_id` is `ON DELETE CASCADE`, matching `0060`'s `expense_shares.guest_id`; a guest hard-delete therefore never fails on this FK). The migration test (`migration0068.test.ts`) registers the SQL functions pg-mem lacks (`char_length`, `lower` as `migration0064.test.ts` does, and also `btrim`, used by the description CHECK, and `jsonb_typeof`, used by the `tax_bps` CHECK; review F17: no migration or harness in the repo registers `jsonb_typeof` today, so the registered implementation MUST be faithful, returning the real JSON type name (`'object'`, `'array'`, `'string'`, `'number'`, `'boolean'`, `'null'`) of its argument rather than a constant, and the test inserts a settings row whose `tax_bps` is a JSON array and asserts the `CHECK` rejects it, so the constraint is genuinely exercised) and includes a Trip-delete cascade case through `trip_guests`, `trip_budget_lines`, `trip_budget_allocations` and `trip_traveler_profiles`. Each user-FK column's `ON DELETE` clause and nullability must match the `today` and `nullable` fields of its registry entry.

**Money column types and the `pg` string pitfall (round 3 M2; verified: `apps/api/src` registers no `setTypeParser`, and `tripExpenses/repo.ts` declares `amount_cents: string` for its `BIGINT` columns and wraps each with `parseInt(value, 10)`; pg-mem returns numbers for the same columns, so a pg-mem-only test cannot catch a missing conversion).** Every money column in `0068` is `INTEGER` (`trip_budget_allocations.amount_cents`, `trip_budget_settings.saved_cents`, `trip_budget_settings.savings_target_cents`; the caps 10,000,000 and 1,000,000,000 are below 2^31 - 1), and node-pg returns `int4` as a JavaScript number, so plain column reads need no conversion. Two places still return strings and MUST be converted: (1) any `SUM(...)`, `COUNT(...)` or arithmetic over an integer column returns `bigint`/`numeric`, which node-pg delivers as a string; the `vsActual` query (`SUM(expenses.amount_cents) - SUM(expense_refunds.amount_cents)` grouped by expense category, whose source columns are the `BIGINT` columns of `0060`) therefore maps every aggregate through a single exported helper `toCents(value: string | number | null): number` in `tripBudget/repo.ts` implemented as `value == null ? 0 : parseInt(String(value), 10)` and throws `Error('non_integer_cents')` when the result is not a finite integer; (2) the `0060` columns the Budget repo reads directly (`expenses.amount_cents`, `expense_refunds.amount_cents`) are `BIGINT` and therefore also pass through `toCents`. The repo's row interfaces declare these aggregate and `0060` fields as `string | number` so TypeScript forces the conversion. The ticket and LL price tables (`0065` to `0067`) already use `INTEGER` cents and are unaffected; the `0066` `park_schedule_signals` price columns follow the existing `INTEGER` `ll_multipass_price_cents`.

### Account-deletion dispositions (`dispositions.ts`)

| Column | Disposition | Stage | chunkColumns | today | nullable | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| `trip_budget_lines.created_by` | `anonymize` | 3 | `['id']` | `cascade` | false | A budget line must survive its creator's deletion |
| `trip_budget_allocations.member_id` | `anonymize` | 3 | `['id']` | `cascade` | true | Rows with `guest_id` set have `member_id` NULL |
| `trip_traveler_profiles.member_id` | `delete` | 4 | `['id']` | `cascade` | true | Personal attributes of a departing person; nothing depends on the row |

`EXPECTED_USER_FK_COUNT` in `accountDeletion/__tests__/dispositions.test.ts` is 70 today and must become 73 in the same change (re-read the constant first; if other changes landed, add 3 to the current value). The `chunkColumns` rule (`chunkColumns` plus the user column must contain a whole primary or unique key) is satisfied by `['id']` because each table has `id` as primary key.

## Concrete Formulas

All amounts are integer cents; rates are integer basis points.

```
bpsOf(x, bps)       = floor((x * bps + 5000) / 10000)                       // round half up
lineSubtotal        = sum(effective allocation cents)
lineTax             = bpsOf(lineSubtotal, taxBps[category])                 // default per BUDGET_DEFAULT_TAX_BPS
lineTip             = (applyTip && category == dining) ? bpsOf(lineSubtotal, diningTipBps) : 0   // tip on pre-tax subtotal, not on tax
lineTotal           = lineSubtotal + lineTax + lineTip
personTax_i         = allocateShares(lineTax, [alloc_1..alloc_n])_i         // Budget-local largest remainder; >= 0; sum = lineTax; 0 when alloc_i = 0 (R6.9)
personTip_i         = allocateShares(lineTip, [alloc_1..alloc_n])_i
personLine_i        = alloc_i + personTax_i + personTip_i                   // >= 0; sum over i = lineTotal
partyTotal          = sum(lineTotal)
whole-party split (R3.4): splitCentsEvenly(totalCents, count) = floor share each, remainder one cent at a time in list order   // packages/shared/src/money.ts

allocateShares(T, w):  S = sum(w); base_i = floor(T * w_i / S); frac_i = (T * w_i) mod S; left = T - sum(base);
                       give +1 to the `left` entries with the largest frac_i (ties: lower index); S = 0 => all zeros

savings:
  remaining      = max(0, target - saved)               target = settings.savingsTargetCents ?? partyTotal
  days           = daysBetween(wdwToday, tripStart)
  weeks          = ceil(days / 7)                       (days > 0)
  perWeek        = ceil(remaining / weeks)

typical LL:
  samples        = history rows with today - lookbackDays <= date < today
  tier 1         = samples with same wdwDayOfWeek and same month (MM)        need >= minSamples (4)
  tier 2         = samples with same wdwDayOfWeek                            need >= minSamples (4)
  median(v)      = odd n: v[(n-1)/2]; even n: Math.round((v[n/2-1] + v[n/2]) / 2)     (sorted ascending)
  otherwise      = no_estimate

ticket price (per person): resolveTicketPrice(priceRef) -> priceCents (pre-tax subtotal)
  under3 -> no allocation; passType != none -> user_entered
```

## Correctness Properties

### Property 1: Line arithmetic is exact

For any Budget_Line with allocations (each 0 to 10,000,000 cents), any category tax rate in 0..2500 bps and tip rate in 0..5000 bps, `subtotal + tax + tip` equals `lineTotal`; the per-person tax shares sum to exactly `tax`, the per-person tip shares sum to exactly `tip`, and the per-person line amounts sum to exactly `lineTotal`. All values are integers. **Round 5 M2:** every per-person tax, tip and line amount is a NON-NEGATIVE integer; a zero-cent allocation gets exactly 0 tax and 0 tip; each person's tax and tip share is within less than one cent of the exact proportional value (`floor(total * w / S)` or one more); and `allocateShares(T, w)` is deterministic and depends only on its arguments. The generators produce zero weights, ties and tiny totals on purpose, including the verified counter-examples `allocateShares(1, [0,1,1])` (the Expense helper gives `[-1,1,1]`; `allocateShares` gives `[0,1,0]`) and `allocateShares(2, [1,3,3,3])` (the Expense helper gives `[-1,1,1,1]`, a negative share for a POSITIVE weight; `allocateShares` gives `[0,1,1,0]`), and an exhaustive small-domain test (`T` in 0..30, 1 to 5 weights each 0..5) asserts all of the above, so a regression to `allocateProportionally` fails it.

**Validates: Requirements 7.1, 7.2, 6.6, 6.9**

### Property 2: View partitions agree

For any set of resolved lines, the sums of the by-person buckets, by-day buckets, by-park buckets and by-category buckets each equal the whole-party total exactly; a line with no `plannedDate` lands only in `unassigned`, and a line with no `park` lands only in `other_resort`; and no line is counted in two buckets of one view; and (round 5 M2) no bucket of any view is negative, in particular a person with only 0-cent allocations has a by-person total of exactly 0.

**Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.9**

### Property 3: Raising a rate never lowers a total

For fixed lines, increasing any single tax or tip rate never decreases any line total or the party total, and zero rates give `lineTotal = lineSubtotal`.

**Validates: Requirements 7.7, 7.2**

### Property 4: Savings plan is the minimal sufficient weekly amount

For `remaining > 0` and `daysUntilStart > 0`: `perWeek * weeks >= remaining` and `(perWeek - 1) * weeks < remaining`, with `weeks = ceil(days / 7)`; for `remaining = 0` the figure is 0 with status `on_track`; for `daysUntilStart <= 0` and `remaining > 0` the figure is null with status `trip_started_or_past`; for `remaining = 0` and `daysUntilStart <= 0` the result is `on_track` with `perWeekCents` 0 (Requirement 8.3 takes precedence; 8.4 applies only when `remaining > 0`; a property case pins this overlap); and `perWeek` is non-increasing as `saved` increases.

**Validates: Requirements 8.1, 8.2, 8.3, 8.4**

### Property 5: The price parser never returns an unusable amount

For any input string, `parseDollarAmounts`, `parseMenuPriceString` and `extractMenuPriceOffers` return only finite integers greater than zero (or nothing); never negative, zero, NaN or infinite; and are deterministic. Non-USD tokens produce nothing.

**Validates: Requirements 10.2, 10.3, 10.8**

### Property 6: Cents round-trip through the dollar string

For any integer `c` in 1..10,000,000, `parseDollarAmounts(formatCentsAsDollarString(c))` is `[c]`, and the join `"$a / $b"` of two values parses back to `[a, b]`.

**Validates: Requirements 10.4**

### Property 7: The promoted tier extractor is behavior-compatible

For every menu fixture used by the existing mobile tests, `extractTierPriceSuggestions` from `@dwt/shared` returns exactly what the previous mobile implementation returned; for any menus it returns a subset of `extractMenuPriceOffers` of kind `per_person_tier`, with unique names and positive prices.

**Validates: Requirements 10.1, 10.2**

### Property 8: Menu projection stays additive and verbatim

For any `RawMenu[]` without the new optional fields, `projectMenus` returns output deep-equal to its pre-change output (no new keys); for any input with them, each new field is present only when valid, `price` strings are unchanged, and each `prices[].cents` equals `Math.round(withoutTax * 100)` of a finite positive USD entry; `priceCents` is set exactly when there is one such entry.

**Validates: Requirements 10.5, 10.6**

### Property 9: Ticket product ids map totally and invertibly

`parseTicketProductId` returns null or a record for any string and never throws; for every combination of `numDays` 1..10, age `A|C`, option `0|P|PHP|WPS`, resident `0|2` and park suffix (only for 1-day base), `parseTicketProductId(buildTicketProductId(parts))` equals `parts`; an id whose age, day or resident token disagrees with the response metadata is rejected by `crossCheck`.

**Validates: Requirements 11.4, 11.5**

### Property 10: Dollar strings convert to exact cents

For any `d` in 0..99999 and `f` in 0..99 formatted as `"d.ff"`, `dollarsStringToCents` returns `d*100+f` exactly when positive; non-numeric, negative, exponent, thousands-separated, and empty strings return null; `pricePerDay` is never read.

**Validates: Requirements 11.3**

### Property 11: A set is accepted only when it is sane

`acceptPricesSet` returns `ok` if and only if the set has at least one row, zero invalid prices, a rows-per-window-day rate at least `minRatio` of the previous accepted set's rate (`rows / windowDays` against `previous.rowCount / previous.windowDays`, when a previous set exists; review F18), and an unrecognized fraction at most the limit; otherwise the verdict names the failing condition and the refresh service leaves the previous rows and `as_of` unchanged. Generated cases include a long gap: a healthy set whose window is 90 days shorter than the previous one (same horizon) and whose row count falls proportionally is accepted, while one whose per-day rate drops below `minRatio` is rejected.

**Validates: Requirements 11.9, 11.10**

### Property 12: Upsert is deduped, idempotent and bounded

Applying a set of rows with duplicate keys never raises Postgres error `21000` (dedupe by the 6-column key keeps the last duplicate); applying the same accepted set twice leaves every row's `changed_at` unchanged the second time (`IS DISTINCT FROM`); after reconcile and prune, no row has `start_date` before WDW_Today and no row of the set outside the fetched keys remains for dates within `[startDateSent, endDate]` (round 4 L6: the reconcile is scoped to the window actually requested, so a response requested from `WDW_Today + 1` after the UTC-date retry never deletes the `WDW_Today` row). The dedupe half is a pure property (a `dedupeByKey` function over generated rows keeps one row per 6-column key, the last); the SQL half (no `21000`, no `changed_at` churn, reconcile and prune) is asserted by `ticketRepo.livedb.test.ts` on real Postgres, because pg-mem has neither the multi-array `unnest`, the tuple `IS DISTINCT FROM`, nor error `21000`. The same livedb file asserts the claim concurrency: two `claimControl('full', false)` calls issued with `Promise.all` on two pool connections yield exactly one non-null result.

**Validates: Requirements 11.7, 11.8**

### Property 13: The freshness label is a total, monotone function

`ticketAgeClass` is defined for every `(asOf, today)` pair and is monotone: as `today` advances, the class never becomes less severe; the boundaries are exactly 45 and 120 days (46 is `may_have_changed`, 121 is `estimate`); and `worseLabel` is commutative, associative and idempotent over the severity order.

**Validates: Requirements 14.6, 5.9**

### Property 14: Ticket resolution follows the stated fallback order

For any cache contents and request: an exact row is always used when present (and is `current` or `may_have_changed` by age, `estimate` only when the park was assumed); a request after the horizon resolves (round 4 L2) to the cached same-weekday date nearest to `startDate - 364 days` (ties to the earlier date) when that target lies inside `[today, horizon_date]`, and otherwise to the latest cached same-weekday date on or before the horizon (a generated case with a Christmas-week peak at the end of the horizon asserts the estimate is the 364-day-earlier price, not the peak price); a within-horizon miss resolves to the nearest same-weekday date with ties to the earlier; a 1-day base ticket with no park resolves to the maximum price among the four parks; no cache yields `add_your_price` and a null price; a 1-day base ticket with a known park returns exactly that park's row with `parkAssumed` false (for each of `mk`, `ep`, `hs`, `ak`, and never another park's price); a request whose `startDate` is before `today` returns a null price, `add_your_price` and `estimateReason: 'none'` (never a future date's price); a `fl-resident` request for a pair that is not permitted (`pairPermitted` false) or whose set is `not_offered` returns `flUnavailable: true` and `estimateReason: 'fl_unavailable'`, while a `fl-resident` request for a PERMITTED pair with no set or no rows yet returns a null price, `add_your_price`, `flUnavailable: false` and `estimateReason: 'none'` (round 5 M3; a generated case asserts `flUnavailable` is true exactly when the group is `fl-resident` and (`!pairPermitted` or `lastError === 'not_offered'`)); and the function is deterministic and never returns a negative price. Review F11: for a book that holds only non-exact dates of the key (no row for the requested date), the result is the nearest (or, beyond the horizon, the latest) same-weekday cached date and never `add_your_price`. Review F20, round 3 L2, round 4 M2 and round 5 M3 and M4: the quote-level `cacheState` is the output of the pure `ticketCacheState` (a TOTAL function; every input combination yields exactly one of four values) of `(enabled, now, blockedUntil, inProgressSince, lastAttemptAt, the two cfg numbers, pairPermitted, set)` and nothing else, evaluated in this order: (1) `disabled` iff `!enabled || blockedUntil > now`; (2) `ready` iff `!pairPermitted || set.lastError === 'not_offered' || set.asOf != null`; (3) `failed` iff `set.lastError != null` (and `asOf` is null); (4) `warming` iff a run is in flight (`inProgressSince` within the claim timeout) or `lastAttemptAt` is null or at least `attemptIntervalHours` old; (5) `failed` otherwise. Generated cases (a) enumerate the full cross product of `enabled`, block, in-flight, cooldown elapsed, `pairPermitted`, set absent / `asOf` null with no error / `asOf` null with `network`, `invalid_response`, `start_date_rejected` and `not_offered` / `asOf` set, and assert the value follows the five rules, (b) assert `warming` is NEVER returned when `set.lastError` is a non-`not_offered` code (the "try again in a minute for 24 hours" defect of M4: a set with `lastError = 'network'`, `asOf = null`, the switch on and no block is `failed`, not `warming`), (c) assert `warming` is returned for a permitted never-attempted pair, so the first `fl-resident` quote after the operator adds it to `TICKET_PRICES_GROUPS` is `warming` with `flUnavailable: false`, and (d) assert a cooldown-bound never-fetched set with no error and nothing in flight is `failed`. With the default `TICKET_PRICES_GROUPS=std-gst`, a `fl-resident` quote therefore has `flUnavailable: true` and `cacheState: 'ready'`, and a never-fetched `std-gst` quote with the switch on, no block and the cooldown elapsed has `warming`. The mobile app renders the `cacheState` text only when `priceCents` is null AND `flUnavailable` is false (precedence: `flUnavailable` wins and the Florida text is shown): `warming` -> "Prices are being fetched, try again in a minute", `failed` -> "Automatic ticket prices could not be fetched; enter your price", `disabled` -> "Automatic ticket prices are unavailable right now; enter your price".

**Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.7, 14.8, 14.9, 14.10, 14.11, 14.12**

### Property 15: The refresh planner never starts an unsafe refresh

For all inputs: with `enabled=false` the decision is never `full` or `probe_only`; with `blockedUntil > now` it is never an action; with a fresh `inProgressSince` it is never an action; a `full` decision never occurs within `attemptIntervalHours` of `lastAttemptAt`; a `probe_only` decision never occurs within `probeIntervalHours` of `lastProbeAt`; and when every demanded set is fresh and the demanded start date is within the horizon, the decision is `none/fresh`; a demanded pair outside `allowedNumDaysByGroup` or whose set has `lastError = 'not_offered'` never makes the decision `full`; and the probe rate limit is judged on `lastProbeAt` only (a recent `lastAttemptAt` with an old `lastProbeAt` still permits `probe_only`, and a recent `lastProbeAt` blocks it whatever `lastAttemptAt` is). Review F25: a `probe_only` run that observes a moved horizon pulls sets only if `upgradeClaimToFull` wins the attempt cooldown; when the attempt cooldown is active it pulls nothing, finishes with status `horizon_changed`, stores `observed_horizon_date`, and the planner then reports `stale` for the demanded sets whose `horizonDate` is earlier than `observedHorizonDate`, which yields `full` only once `attemptIntervalHours` have passed since `lastAttemptAt`. Consequently no sequence of demand-driven runs starts two set-pulling runs within `attemptIntervalHours` (asserted with a scripted fake clock in `refreshService.test.ts`); the one exception is an explicit admin Refresh now (Requirement 19.2), which bypasses only the attempt cooldown (never the kill switch, the block or the in-flight check) and is asserted separately (round 4 L5).

**Validates: Requirements 12.2, 12.3, 12.4, 13.1, 13.4, 13.6, 19.2**

### Property 16: The circuit breaker stops at the first block

For any scripted sequence of client outcomes in a run, once an outcome is `waf_block` the fake client receives no further call, `blocked_until` equals `now + cooldown`, and no set is advanced; a non-WAF failure of one set leaves that set's rows and `as_of` unchanged, records `last_error`, and the run continues with the other sets; a `not_found` for a `fl-resident` set records `not_offered` and is not a run failure; the number of calls in a run never exceeds `2 + sets` plus at most one token retry plus at most one start-date retry; a response that is HTML with an Akamai marker is `waf_block` whether its status is 200, 403, 429 or 503; and after `TICKET_PRICES_MAX_CONSECUTIVE_FAILURES` consecutive network, timeout, 5xx or invalid outcomes the fake client receives no further call and `blocked_until = now + TICKET_PRICES_FAILURE_COOLDOWN_MINUTES` (a success between failures resets the count). Round 5 L3: the probe and the Diagnose price call always use `std-gst` (a scripted `groups = ['fl-resident', 'std-gst']` configuration still probes `std-gst`), a `404` on a `std-gst` call is recorded as `http_status:404`, a second `401` after the one token refetch is recorded as `http_status:401`, and both count toward the consecutive-failure limit like a `5xx`; configuration without `std-gst` in `TICKET_PRICES_GROUPS` fails boot. Round 5 L4: with a scripted client, when the control row's `blocked_until` becomes a future time between two calls of one run (the admin Block now), the fake client receives no call after that point, the run ends with status `blocked`, and at most one call (the one already in progress) happens after the block is set.

**Validates: Requirements 13.3, 13.5, 13.6, 13.9, 13.10, 13.11, 13.12, 12.5, 12.6**

### Property 17: A user's price is never overwritten and reads never write

For any sequence of cache updates and reads over a set of lines: every `user_entered` allocation's effective amount equals its stored amount; every `disney_menu` allocation's effective amount equals its stored snapshot; `resolveLinePrices` does not mutate its inputs; and the stored rows of `trip_budget_lines` and `trip_budget_allocations` are byte-identical before and after a Ticket_Price_Cache refresh and a Budget read. Review F2: for a `themeparks_ll` line created while only a typical estimate existed (stored `price_source = 'themeparks_ll'`, snapshot = the estimate), `resolveLinePrices` yields `effectivePriceSource = 'typical_estimate'` and label `estimate` while no stored price exists for the date, and, in the same generated scenario after a stored real price for that date appears, yields that real price as `effectiveCents`, `effectivePriceSource = 'themeparks_ll'` and label `current` (or `may_have_changed` when older than `LL_PRICES_STALE_HOURS`), with the stored rows still byte-identical; no `typical_estimate` value is ever accepted as input or written by any repo method.

**Validates: Requirements 5.4, 5.5, 5.6, 5.8, 5.10**

### Property 18: Lightning Lane purchases classify strictly

`classifyPurchase` returns a kind only for `PACKAGE` with the `lightninglanemultipass_` or `premierpass_` prefix (or the two exact package names) and for `ATTRACTION` with the `lightninglane_` prefix; `lightninglanemultipass_80007944` is never classified as single; any purchase whose amount is missing, non-integer or at most zero is ignored; and `extractLlPrices` returns amounts equal to `price.amount` unchanged.

**Validates: Requirements 15.2, 15.3**

### Property 19: LL persistence has one writer, is deduped and bounded

For any extracted day set with duplicate `(park, date)` or `(park, date, purchase_id)` keys, the batch statements never contain a key twice; the single-pass `experience_id` is set exactly when an Experience with `upstream_entity_id = <numeric purchase_id suffix> || ';entityType=Attraction'` exists (round 5 M5: an exact type-qualified match on a unique index, so the join returns at most one row per input and can never reintroduce a duplicate conflict key after the `Map` dedupe; an Experience of another entity type that shares the numeric prefix never matches); with two Experiences `123;entityType=Attraction` and `123;entityType=Entertainment` and a purchase `lightninglane_123`, exactly one row is stored, no error `21000` is raised, and `experience_id` is the Attraction's, and with only the `Entertainment` Experience present `experience_id` is NULL and the row is still stored; rows older than `LL_PRICES_RETENTION_DAYS` are pruned and newer rows are kept; the extended `upsertParkScheduleSignals` is the only statement that writes park-level LL columns (a structural test scans non-test sources for SQL that assigns `ll_multipass_price_cents` (`ll_multipass_price_cents =` inside a template literal) and finds exactly that one statement; the in-memory row builder in `samplingService.ts` is not SQL and is not counted), and a row built from a schedule whose package name differs from `'Lightning Lane Multi Pass'` but whose id starts with `lightninglanemultipass_` still stores the Multi Pass price in `ll_multipass_price_cents`; an existing row's non-LL columns (`open_time`, `close_time`, `early_entry`, `extended_evening`, `ticketed_event`) keep the values the same statement wrote; `ll_prices_captured_at` is NULL for a date with no LL value; and the single-pass writes run only when `max(captured_at)` is NULL or older than `LL_PRICES_MIN_REFRESH_HOURS`. The park-level statement is non-destructive on null: for any stored row and any later row whose LL fields are null, the stored `ll_multipass_price_cents`, `ll_multipass_available`, `ll_premier_price_cents`, `ll_premier_available` and `ll_prices_captured_at` are unchanged, a later row with a Multi Pass or Premier Pass price replaces the prices and advances `ll_prices_captured_at`, and `ll_prices_captured_at` never moves when both new prices are null (so `lookupLlPrice` turns `may_have_changed` after `LL_PRICES_STALE_HOURS` with no fresh price). Round 4 L1: `ll_multipass_captured_at` advances only with a non-null incoming Multi Pass price and `ll_premier_captured_at` only with a non-null incoming Premier Pass price, so after a later pass that carries only a Multi Pass price the stored Premier Pass price keeps its OLD `ll_premier_captured_at` (and is later labelled `may_have_changed` while the Multi Pass price is `current`); `ll_prices_captured_at` equals the newer of the two. The SQL is asserted by `llRepo.livedb.test.ts` on real Postgres (12-array `unnest`).

**Validates: Requirements 15.1, 15.4, 15.5, 15.6, 15.10**

### Property 20: The typical price is bounded and conservative

For any history, `typicalLlPrice` returns either `no_estimate` or a value in `[min, max]` of the samples of the tier used, uses the same-weekday-same-month tier only when it has at least `minSamples` samples and otherwise the weekday tier, never uses a sample dated on or after today or older than the lookback, and is invariant under permutation of the history.

**Validates: Requirements 15.8, 15.9**

### Property 21: A stored Lightning Lane price takes precedence and is labelled by age

When a stored row exists for the requested date, `lookupLlPrice` returns exactly its cents with attribution `themeparks_wiki`, label `current` when its age is within `staleHours` and `may_have_changed` otherwise, and `soldOut` equal to `available === false`; the typical price is never used. Round 4 L1: the age is that row's own `capturedAt` (a `premier` row is judged on `ll_premier_captured_at`, a `multi` row on `ll_multipass_captured_at`), so with two rows of the same date whose timestamps differ the two labels differ accordingly. Round 4 L4: when no stored row exists and a typical estimate is returned, the quote `asOf` equals the `newestSampleDate` of the samples used (the maximum `date` of the chosen basis subset), is strictly before `today`, and is independent of `now` (calling with two different `now` values on the same history gives the same `asOf` and the same label text). Round 5 L5: for every date `d` of 2026 through 2028 (both DST changes and the leap day included) `wdwDateOf(dateToInstant(d)) === d`, and a typical-estimate line stored through `dateToInstant(newestSampleDate)` renders the label "Estimate, as of <newestSampleDate>" (never the previous day) when read back from `price_as_of`.

**Validates: Requirements 15.7, 5.3, 5.10**

### Property 22: Suggestions are deterministic, idempotent and side-effect free

`deriveSuggestions` returns the same ordered list for the same input; never returns a key already present among existing lines or dismissed keys; accepting a suggestion (adding its key to `existingKeys`) removes exactly that suggestion; it omits `under3` travelers and `passType != none` travelers from ticket suggestions; it assigns `park` by the order Experience park, then a `startingPark` that equals (case-insensitively) a canonical `PARKS` name, then null (a non-canonical `startingPark` such as "mk" or "Magic Kingdom Park" yields null, never an invalid park); and a dining suggestion's `applyTip` is true exactly when the cached menu's lower-cased `serviceStyle` list intersects `TIP_BEARING_SERVICE_STYLES`, and false for an unknown style, an empty list and an Experience with no cached menu. Round 4 L3: every `tickets` draft has `description` matching `<N>-day <label> tickets`, `plannedDate` equal to the group's start date (`ticketStartDate`, else `tripStart`), `park` non-null only when `N = 1`, the option is `base` and the day's `startingPark` is canonical, and `applyTip: false`. Round 5 L9: a `planned_items` row with `is_lightning_lane = true` and a null `planned_date`, or whose Experience has a null canonical `park` (or no Experience), produces no Suggestion at all and in particular no key containing `null`; a dated item with a canonical park still produces `ll:multi:<date>:<park>` (or the single-pass key).

**Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.7, 16.8, 6.7, 9.7**

### Property 23: Budget versus actual is a total mapping with conserved sums

`BUDGET_TO_EXPENSE_CATEGORY` is defined for every Budget_Category and maps into the Expense category vocabulary; for any line totals, the sum of `budgetedCents` over the `vsActual` rows equals the party total, and the sum of `actualCents` equals the sum of the input actuals.

**Validates: Requirements 17.1, 17.2**

### Property 24: Authorization follows the matrix and collapses non-members

For every role and action, `can` grants `view_budget`, `edit_budget` and `edit_budget_travelers` to member and organizer, and `edit_budget_settings` to organizer only; for any non-member or unknown Trip every Budget route returns `trip_forbidden` before any Budget data is read; and edit or removal of a line succeeds if and only if the caller created it or is an organizer. Round 5 H1: the gate is `requireBudgetAction` = `assertTripMember` then `can`, so for a persisted `member` of a Trip whose only organizer is `pending_deletion` (no active organizer) `edit_budget_settings` is allowed (interim organizer), the same member is `trip_forbidden` for it once an active organizer exists, and a persisted `organizer` is allowed regardless; `services/tripBudget/**` contains no import of `effectiveRole.js` and `roleReader.guard.test.ts` passes unmodified.

**Validates: Requirements 18.1, 18.2, 18.3, 18.4, 2.5**

### Property 25: Every allocation and profile has exactly one person

For any input, the allocation and profile schemas accept an object if and only if exactly one of `memberId` and `guestId` is present; the database `chk_budget_alloc_person_xor` and `chk_traveler_person_xor` reject any other row; a duplicate person on one line is rejected; removing a Trip_Guest referenced by an allocation is rejected while removing one referenced only by a profile deletes the profile; and when a Trip_Member leaves or is removed (`departMember`), their `trip_traveler_profiles` row for that Trip is gone in the same transaction, every Budget_Allocation naming them is unchanged, and `deriveSuggestions` over the reloaded profiles no longer contains them.

**Validates: Requirements 3.1, 3.5, 4.1, 4.7**

### Property 26: A Budget read has no side effects

With a counting fake Redis, a counting fake `fetch`, and a recording pool, a Budget read with the kill switch off, and one with it on and stale caches, issues zero Redis commands, zero outbound HTTP calls on the request path, zero writes to Budget tables, and a fixed number of read statements independent of the number of lines. Round 5 M1: the number is counted over EVERY `query` of the pool and of clients taken from it, with the REAL ticket-price and Lightning Lane read repos running (fake ports would hide 5 of the statements), the count for 1 line equals the count for 300 lines, both are at most `BUDGET_READ_MAX_STATEMENTS` (14 = authorization 1 + roster 1 + `loadBudget` 6 + labels 1 + ticket 3 + LL 2), and the interim-organizer case (a persisted `member` of a Trip with no active organizer) costs exactly one more statement than the common case and is still within the bound.

**Validates: Requirements 12.9, 20.1, 20.6, 5.8**

### Property 27: Picker selections become valid Expense and Budget payloads

For any picker selection, `selectionToExpenseItems` yields rows that all pass `expenseItemInputSchema` (names 1..100 characters after truncation, `priceCents` positive and at most the cap, at least one assignee), repeats a row `quantity` times, sets `isAlcohol` exactly for items from a group whose type matches `Alcoholic Beverage`, and `selectionSubtotalCents` equals the sum of the produced rows; items without a parseable price are not selectable without a typed price; and the Expense payload contains no field that marks an item as picked.

**Validates: Requirements 9.2, 9.4, 9.5**

_Cross-spec: `trip-expenses` Requirement 16 (these are not trip-budget requirement numbers)_

### Property 28: Whole-party split is exact

For any total in 0..10,000,000 and any list of 1..50 distinct ids, the "everyone" split produces integer amounts that sum to exactly the total, differ by at most one cent, and give the extra cents to the earliest ids. Round 4 M4: the function under test is `splitCentsEvenly` from `packages/shared/src/money.ts` (the code the mobile form actually imports), run in Vitest in `packages/shared`; a cross-check in `apps/api` asserts it equals the API `splitEvenly` shares in list order for the same total and count, and `bpsOf(c, bps)` from the same module is non-negative, monotonic in `c` and in `bps`, and equal to `floor((c * bps + 5000) / 10000)`.

**Validates: Requirements 3.4**

### Property 29: Secrets never leave the client

For any scripted client behavior including errors, the diagnose result, the run result, the admin page HTML and every logged object contain no substring equal to the access token and no `Authorization` header value.

**Validates: Requirements 13.7, 19.3**

### Property 30: The disposition registry covers the new columns

The existing registry completeness test (Property 11 of `account-deletion`) passes with the three new entries and the updated expected count, and `ticket_prices`, `ticket_price_sets` and `ticket_price_control` have no `REFERENCES users` clause.

**Validates: Requirements 18.7**

### Property 31: Budget and Expenses stay separate

For any sequence of Budget writes (create, edit, remove line; profile and settings changes), a recording pool shows no `INSERT`, `UPDATE` or `DELETE` against `expenses`, `expense_shares`, `expense_tiers`, `expense_items`, `charge_lines`, `settlements` or `expense_refunds`; the responses of the existing Expense, Balances, Ledger, Feed and Summary routes contain no Budget field; no Budget row, DTO or table has a payer, split mode or balance column; a Budget route called by a non-member or for an unknown Trip answers `trip_forbidden` identically for both; deleting a Trip removes every Budget row of that Trip and no other Trip's; and a Budget_Line with `linked_expense_id` NULL is valid and complete.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6**

### Property 32: Budget line CRUD invariants

For any generated line input: it is accepted iff its category and price source are in the closed sets, its trimmed description has 1 to 200 characters, it has 1 to 50 allocations, the total number of menu `items` entries across its allocations is at most `BUDGET_MENU_ITEMS_PER_LINE_MAX` (100; round 4 L7), its `applyTip` is false unless the category is `dining`, and its `experienceId` exists; the 501st line of a Trip is rejected and the 500th is accepted; edit and remove succeed iff the caller created the line or is an organizer; an edit replaces the allocation set atomically (a failing edit leaves the previous allocations); every Budget route answers any `ZodError` (body, params, query, discriminator or `.strict()` error) with `trip_validation_failed` (Requirement 18.9); `created_by` is the submitting member regardless of whom the allocations name; and after the linked Experience is deactivated or deleted the line and every `amount_cents` are unchanged. Asserted by pure schema properties plus pg-mem repo tests (the line/allocation SQL uses only single-array statements) and `server.inject` route tests.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.2, 3.3, 18.9, 20.4**

### Property 33: Traveler profile rules

For any profile input: at most one profile exists per `(trip, person)`; `ageBracket` is required; `ticketDays` is 1 to 10 or null; a profile with `ageBracket = 'under3'` contributes no ticket line and no ticket Suggestion; a profile with `passType != 'none'` is never priced from the cache (its ticket allocation requires `user_entered`); the users table gains no column (a migration test compares `information_schema.columns` before and after); a member may write their own profile or a sponsored guest's and an organizer any, and any other caller gets `trip_forbidden`. Round 5 L13: a profile write naming a Trip_Member who is not on the Trip, or a Trip_Guest of another Trip, is rejected with `trip_validation_failed` and stores nothing, while a `pending_deletion` or purged member is answered `trip_party_deleted` first (Requirement 4.8).

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.8**

### Property 34: Menu selections are verified without the network

For any cached menu (shape 1 or 2) and any selection: a `disney_menu` create succeeds iff every selected `name` and `priceCents` is found by the three-step rule (item `prices[].cents` for shape 2, else `parseMenuPriceString(item.price)`, else a `MenuPriceOffer` for tiers); a selection with a changed price or an unknown name is rejected with `trip_validation_failed`; the verification issues zero HTTP calls; a cached row with `shape_version` 1 is accepted for a price that its display string parses to; and `selectionToBudgetPriceRef` output validates against `priceRefSchema` for every valid selection. Review F3: a `disney_menu` line without category `dining`, without an `experienceId`, or with any allocation lacking a `menu` `priceRef` is rejected with `trip_validation_failed`; the stored `amount_cents` of each allocation equals `sum(priceCents * quantity)` of its verified items (or `tier.priceCents`) for every valid selection, a submitted `amountCents` that differs is rejected, and one that equals it is accepted; an inflated `quantity` with the amount left at the one-unit value is rejected. Round 5 L8: `normalizeTierName(label) = label.trim().slice(0, EXPENSE_TIER_NAME_MAX)` is idempotent, never longer than 40 characters, and applied to the offer label both when the Mobile_App builds `tier.name` and when the server verifies it, so a `tier` built from a 60-character group-banner offer label passes `menuPriceRefSchema` and verification, a `tier.name` that is not the normalized label is rejected, and the stored name equals the normalized label. Round 4 L9: the `name` comparison uses `normalizeMenuName` (trim, first 100 characters) on both the submitted and the cached title, so a cached title of 120 characters is accepted for a submitted name equal to its first 100 characters and rejected for a name that differs within those 100 characters.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.6, 9.9, 9.10, 10.7**

### Property 35: The ticket client sends only the documented requests

For any scripted request sequence, every request path is exactly endpoint T or endpoint P; every P request has `storeId=wdw`, a `discountGroup` from `TICKET_PRICES_GROUPS`, `numDays` 1 to 10, `startDate >= WDW_Today` (or the UTC-date retry of Requirement 11.13) and `endDate <= horizon` (the probe uses `startDate = endDate`); no request has `startDate` after `endDate`, including the retry of Requirement 11.13; no request carries `fpAvailability`, `storeBasedPearlEnabled` or `addOn`; no request carries a `Cookie` header; `Authorization` appears on P only; the `User-Agent` equals `TICKET_PRICES_USER_AGENT`; the spacing between consecutive calls is at least `TICKET_PRICES_REQUEST_SPACING_MS` on a fake clock; the response is rejected above `TICKET_PRICES_MAX_BODY_BYTES` and after `TICKET_PRICES_REQUEST_TIMEOUT_MS`; a 400 on a today-dated call is retried once with the UTC date and never twice; and the Passholder, DVC, Annual Pass and single-day water park products never appear in stored rows.

**Validates: Requirements 11.1, 11.2, 11.11, 11.12, 11.13, 12.6, 12.7, 12.8**

### Property 36: There is no scheduler, worker or Redis path

A structural test (round 5 L11: written with the `typescript` compiler API like `roleReader.guard.test.ts`, inspecting import specifiers, call expressions and identifier nodes of the parsed source and NEVER comment text or raw file text, because the modules' own header comments will say "no worker", "no queue" and "no cron"; a detector self-test proves a real `setInterval(...)` call and a real `import ... from 'ioredis'` trip it while a comment containing those words does not) over the non-test sources of `services/ticketPrices/`, `services/tripBudget/`, `services/lightningLane/` and `admin/ticketPriceRoutes.ts` finds no `setInterval`, no cron registration, no `BullMQ`/`Worker`/`Queue`, no `ioredis`/Redis import, no `TICKET_PRICES_CRON_SECRET`, and no import of `catalog/disney/transport.ts`, `catalog/disney/rateLimiter.ts`, `catalog/disney/liveClient.ts` or `catalog/disney/liveService.ts`; the only timers are the request-spacing `setTimeout`/sleep inside the refresh service; `composeServices.ts` builds the ticket service in its own block that does not reference a Disney live module; and `retirement.smoke.test.ts` passes unmodified. (This replaces any "only module that calls fetch" scan, which would be false today because `liveClient.ts` and `themeparks.ts` call `fetch`.)

**Validates: Requirements 12.1, 13.8, 20.1, 20.2**

### Property 37: Every claimed run consumes its cooldown, and a rejected start date blocks further calls

For any scripted run, whatever its outcome (success, partial failure, WAF block, consecutive-failure block, `start_date_rejected`), `ticket_price_control.last_attempt_at` (full runs) or `last_probe_at` (probe runs) equals the CLAIM time and is never restored or rewound; for any run ending in `start_date_rejected` after the one UTC-date retry, `blocked_until` equals `now + TICKET_PRICES_FAILURE_COOLDOWN_MINUTES` with reason `start_date_rejected`, and N further `noteDemand` calls (any N from 1 to 50, with any demand) start zero runs and cause zero client calls until `blocked_until` passes; the `probe_only` claim statement itself does not change `last_attempt_at` (only a successful `upgradeClaimToFull` does, and then it stamps the claim time of a full attempt, never a later time); and an abandoned claim older than `TICKET_CLAIM_TIMEOUT_MINUTES` is reclaimable while a fresher one is not. Asserted in `refreshService.test.ts` with a fake client, fake repo and fake clock (the fake repo implements the claim predicate of the SQL), plus the `*.livedb.test.ts` claim test against real Postgres.

**Validates: Requirements 11.13, 12.3, 13.9**

### Property 38: The admin ticket-price page is gated, read-mostly and honest

For any request without valid Basic Auth, each of the four admin routes answers 401 and changes nothing; for any cross-origin POST, 403 and no state change; the page HTML contains the kill-switch state, the operator gate text while the switch is false, the recorded decision and revisit notice, the table size, and no `<input>` whose name or label relates to a price; `ADMIN_SECTIONS` contains the page under "Data Ingestion & External Sync"; and `refresh` and `diagnose` follow Requirement 19.2 and 19.3 (the same assertions as `admin-panel` Property 11); `diagnose` never reads `TICKET_PRICES_ENABLED` (round 4 M1: with the switch false and no block it makes its two calls and returns an `AdminDiagnoseResult`, and its only refusals are `blocked`, `already_running` and `too_soon`); diagnose refuses with `too_soon` inside 60 seconds of the previous diagnose and `already_running` while a run is in flight, and writes no price rows; `block` sets `blocked_until` to `now + TICKET_PRICES_BLOCK_COOLDOWN_MINUTES` with reason `manual`, is same-origin enforced, and afterwards every claim fails until it passes; every `last_error` shown comes from the `Ticket_Error_Code` set and a fake repo value containing `<script>` is rendered escaped (Requirement 11.14); the routes exist only when `adminRoutes` receives the `ticketPrices` port (Requirement 19.8). Round 5 L7: the page's recorded-decision text contains the owner's message verbatim ("lets go with optiion 1. just make the spec ill have antigravity implement it", dated 2026-10-25) and the launch-gate line that the owner's written confirmation of the Terms-of-Use wording is pending until the operator removes it from the decision record (Requirement 21.8).

**Validates: Requirements 11.14, 13.2, 13.10, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 21.1, 21.2, 21.8**

### Property 39: Attribution is present and no route exports raw prices

For every mobile screen or modal listed in `PRICE_SCREENS` (a constant exported by the test that enumerates the files rendering a ticket or Lightning Lane price), rendering it with a Lightning Lane price shows the text "Powered by ThemeParks.wiki" and rendering it with a ticket price shows the Disney source line and the not-covered note; and a route-table scan of the Fastify instance finds no registered route whose handler returns a list of `ticket_prices` or `lightning_lane_single_prices` rows (the only price-bearing responses are the Budget DTO and the `quotes` response, one `PriceQuoteDTO` per request, at most 40).

**Validates: Requirements 21.3, 21.4, 21.5**

### Property 40: Every new mobile screen is themed, labelled and wired

For every file in `NEW_BUDGET_TSX` (the list of new `.tsx` files of this feature), the theme guard finds no raw colour literal or static token read (`themeRetrofit.guard.test.ts` passes with its allowlist unchanged); every `Pressable`/button rendered by those screens in the tests exposes an `accessibilityLabel`; each view chip exposes `accessibilityState.selected` consistent with the selected view; every price label is text; `TripsStackParamList` contains `TripBudget: { tripId: string }`; `HUB_SECTIONS` contains `budget` immediately after `expenses` (with the body text, the `wallet-outline` icon and both `HUB_SECTION_COLOR` palette values of the Mobile section, and `tripStructureRegression.test.tsx` updated to 10 sections and 17 screen names); the rendered `TripDetailScreen` shows the Budget tile (the pinned list alone paints nothing): `testID` `trip-detail-section-budget`, `accessibilityLabel` "Budget", the text "Budget" and "Plan costs & save per week.", in a fifth `gridRow` leaving the first four rows unchanged, and pressing it calls `navigation.navigate('TripBudget', { tripId })`; every Budget mutation hook invalidates `budgetKeys.detail(tripId)`; and the Menu Item Picker is imported by both the Budget line form and the Expense form from `apps/mobile/src/components/`.

**Validates: Requirements 1.1, 22.1, 22.4, 22.5, 22.6, 22.8**

### Property 41: Deleted parties are handled safely and the guards hold

For a Budget_Line or Traveler_Profile write naming a `pending_deletion` or purged account, the response is `trip_party_deleted` (409) with a message that names nobody; existing lines and allocations naming it remain readable and deletable; the by-person bucket for it has the label `Deleted user` and its total is unchanged by the deletion; the `travelers` list does not contain that person's Traveler_Profile (omitted, review F4), no ticket Suggestion names that person, and `DELETE` of that profile by id still succeeds; editing a line that still allocates to a departed or deleted member succeeds when the allocation set keeps that person (review F15), while newly adding such a person answers `trip_party_deleted` or `trip_validation_failed` as applicable; `trip_memberships.guard.test.ts` passes with exactly the pinned `services/tripBudget/repo.ts` entry and `visibility.guard.test.ts` passes with no new entry.

**Validates: Requirements 18.5, 18.6, 18.8, 3.6, 3.7**

### Property 42: Expense form tax and gratuity actions create only explicit, editable Charge_Lines

(Defined in `trip-expenses` as its Property 16; restated here for traceability.) Pressing "Add estimated tax" or "Add estimated gratuity" in the Expense form adds exactly one `tax` or `gratuity` Charge_Line whose amount equals `bpsOf(subtotal, BUDGET_DEFAULT_TAX_BPS.dining)` or `bpsOf(subtotal, BUDGET_DEFAULT_DINING_TIP_BPS)` over the assignees' item subtotals, the line is editable and removable, nothing is added without the press, and the submitted body contains it only after the member submits the Expense.

**Validates: Requirements 9.8**

_Cross-spec: `trip-expenses` Requirements 16.6, 16.7 (these are not trip-budget requirement numbers)_

### Property 43: Stored values and label text are closed, honest and derived only on read

(a) Every stored line has a `price_source` in the closed set and a non-null `price_as_of`, and `priceLabelText` returns, for every `(kind, source)` pair, the exact visible string of Requirement 5.3 ("Estimate" is always present for `estimate`, "Your price" for `your_price`, and the date renders as `MMM d, yyyy`); a typed price over a sourced one is submitted as `user_entered`. (b) No Budget table or column stores a total or a view (a migration test lists the columns), all money is integer cents, and rounding happens only in display functions that no calculation imports. (c) Migration `0065` creates `ticket_prices`, `ticket_price_sets` and `ticket_price_control` with exactly the columns of Requirement 11.6 (plus the additive `window_days`, `observed_horizon_date` and `last_diagnose_at` columns documented in Data Models).

**Validates: Requirements 5.1, 5.2, 5.3, 5.7, 6.1, 6.8, 11.6**

### Property 44: Budget settings are bounded, organizer-only and honestly labelled

Tax rates outside 0..2500 bps and tip rates outside 0..5000 bps are rejected; the unverified defaults carry the assumption label (`taxBpsIsDefault` true, `diningTipBpsIsDefault` true) while the ticket rate does not; a stored `tax_bps` that is not a JSON object is rejected by the `CHECK` (backed by a real `jsonb_typeof`, see the migration 0068 harness note); settings writes are organizer-only; `savedCents` defaults to 0 and is a Trip-level figure; raising a rate never decreases a total.

**Validates: Requirements 7.3, 7.4, 7.5, 7.6, 7.8, 8.5**

### Property 45: The expense link is soft and the budget-versus-actual text is derived

`linkedExpenseId` must belong to the same Trip, is set to NULL when that Expense is deleted, and linking changes no Expense, Balance or Settlement; an Expense needs no Budget_Line; `vsActual` text is "Budget $X, spent $Y, $Z left" or "over by $Z" and is never conveyed by colour alone.

**Validates: Requirements 17.3, 17.4, 17.5, 17.6**

### Property 46: Accepting a Suggestion needs confirmation

Accepting a Suggestion opens the form pre-filled from `BudgetSuggestionDTO.draft` and issues no create call until the user confirms; the create call then carries the Suggestion's `suggestionKey`; fields flagged `needsPrice` or `needsPeople` must be completed before the confirm control is enabled.

**Validates: Requirements 16.6**

### Property 47: Stores are bounded and the operator is told what runs

A Trip never exceeds 500 lines, 50 allocations per line or 200 dismissals; the ticket table is pruned of past dates each run and its measured size is shown on the admin page; `lightning_lane_single_prices` is pruned beyond `LL_PRICES_RETENTION_DAYS`; `docs/hosting.md` states that ticket prices have no cron, that the keep-alive must never touch the database, and that Lightning Lane prices depend on the scheduled sampling job (a documentation structural test greps for those three sentences).

**Validates: Requirements 20.3, 20.4, 20.5, 20.7**

### Property 48: Legal text is present and there is no Budget export

No Budget export route exists, and the legal text of `legal-disclaimers-and-terms` Requirement 7 (ThemeParks.wiki credit, Disney source of ticket and menu prices) is present on `/terms`.

**Validates: Requirements 21.6, 21.7**

### Property 49: The Budget screen and line form show what the requirements list

The Budget screen shows the total, the five view chips, the savings card, the vs-actual card, the Suggestions and the line list with subtotal, tax and tip per line; the line form offers the three category pickers and a manual price; the quote cache-state texts of Requirement 14.12 render for `warming` and `disabled`; mobile tests run under Jest with `@testing-library/react-native` (the structural test fails if a Budget mobile test imports `vitest`).

**Validates: Requirements 14.12, 22.2, 22.3, 22.7**

### Property 50: Menu average per person, multi-tier buffet selection, and multi-ticket / lodging calculators

(a) `computeMenuEstimatePerPerson(menus)` returns `null` when no menu item has a positive parseable price, and otherwise returns `{ perPersonCents, basis, sampleCount }` where `perPersonCents` is a positive integer bounded between the minimum and maximum item prices of the chosen basis (`'entrees'` when at least 2 priced items exist in entrée/main groups, else `'items'` across non-alcoholic priced items). (b) `MenuItemPicker` and `menuItemPicker.pure.ts` allow selecting multiple fixed-price `MenuPriceOffer`s simultaneously (`tiers` array with quantities), with `selectionSubtotalCents` summing `offer.priceCents * quantity` across all selected tiers and items. (c) `BudgetLineFormModal` supports batch-quoting Adult + Child ticket quantities in one line, toggling Disney vs. Off-Property dining/lodging, applying the 1-tap menu average per person, and calculating Lodging subtotal from nightly rate × nights. (d) `BudgetLineFormModal` applies typical Disney baseline estimates (`TYPICAL_LL_BASELINES`) when a requested Lightning Lane date has no published price, displays quick estimate tier chips (Typical, Moderate, Peak), and updates party total and allocations on tier or quantity change. (e) `BudgetLineFormModal` presents a 3×2 category grid selector, dining estimation method segmented tabs (Buffet / Fixed, Menu Average, Pick Menu Items), paired Subtotal and Planned Day fields, a 2-column party allocation card grid with active split percentage badges, and a prominent bottom sticky "Save Line to Trip Budget" action button. (f) `BudgetLineFormModal` renders an Official Disney Pricing card for tickets featuring a horizontal Ticket Duration stepper; a 2-column party ticket quantities grid with Adults (10+) and Children (3–9) steppers and daily rate subtext; a 2×2 Ticket Type selection grid with thematic icons (✨ 1-Park Base, 🏰 Park Hopper, 🌊 Park Hopper Plus, ⛳ Water Parks & Sports); Pricing Tier pill buttons for Standard Guest and Florida Resident (Discount); an automated Disney Quote card displaying the calculated total and 6.5% FL Tax coverage; and smart ticket line description generation with Whole Trip planned day default.

**Validates: Requirements 9.11, 9.12, 22.9, 22.10, 22.11, 22.12, 22.13**

## Error Handling

| Condition | Result | Recoverable | Logged |
| --- | --- | --- | --- |
| Non-member or unknown Trip on any Budget route | `trip_forbidden` | n/a | no |
| Role lacks the action (`edit_budget_settings` as member; line edit by non-creator member) | `trip_forbidden` | n/a | no |
| Schema violation (category, description length, amounts, XOR person, > 50 allocations) | `trip_validation_failed` | caller fixes input | no |
| Person not on the Trip, `experienceId` or `linkedExpenseId` invalid, 501st line, 201st dismissal | `trip_validation_failed` | caller | no |
| `disney_menu` selection not found in the cached menu | `trip_validation_failed` | caller refetches menu | `debug` |
| Ticket or LL source resolves to no price at write time | `trip_validation_failed` ("use user_entered") | caller | no |
| Person is deleted or `pending_deletion` on a write | `trip_party_deleted` (409) | no | no |
| Ticket cache empty or stale on read | 200; `add_your_price` or aged label; refresh may start | yes | `debug` |
| Kill switch off | refresh skipped silently; reads serve cache | yes | no |
| `ticket_price_control` claim fails (cooldown, in flight, blocked) | refresh skipped | yes | `debug` |
| Endpoint T or P returns 403/429 or a WAF marker | run stops; `blocked_until = now + 360 min`; sets untouched | after cooldown | `warn` (no token) |
| Endpoint returns 401 | one token refetch, one retry of that call; second 401 records `last_error` for that set | yes | `warn` |
| Endpoint returns 404 for `fl-resident` set | `last_error = 'not_offered'`; run continues | permanent per length | `info` |
| Endpoint 5xx, timeout, network error | `last_error` on that set; rows and `as_of` kept; run continues; no retry | next demand after cooldown | `warn` |
| Body fails the Zod schema, is over `TICKET_PRICES_MAX_BODY_BYTES`, or not JSON | `invalid_response`; set rejected; old rows kept | next demand | `warn` |
| Set fails the sanity guard | rejected with reason in `last_error`; old rows kept | next demand | `warn` |
| Partial run (some sets updated, some failed) | each set independent; `last_status = 'partial'` | yes | `info` |
| Process killed mid-run | `in_progress_since` expires after 15 minutes; later demand can claim; partial sets already committed per set | yes | n/a |
| Postgres error during upsert/reconcile | transaction per set rolls back; `last_error` set; run continues | yes | `error` |
| FK violation `23503` on a Budget insert naming a guest deleted a moment earlier (round 4 M6) | `tripBudget/repo.ts` maps it to `trip_validation_failed` (400); nothing is stored; the client refreshes the people list | yes (caller retries with valid people) | `info` |
| `removeTripGuest` while a concurrent allocation insert is uncommitted (round 4 M6) | the lock-first `SELECT ... FOR UPDATE` waits for the inserter; after it commits the reference check sees the allocation and the removal is rejected with `trip_validation_failed`; guest and allocation survive | yes | none |
| Admin `diagnose()` with the kill switch off (round 4 M1) | runs normally; the kill switch is never consulted; only `blocked`, `already_running`, `too_soon` refuse | n/a | `info` |
| Ticket quote for a never-fetchable set (`fl-resident` under the default configuration, or a `not_offered` set) (round 4 M2) | `flUnavailable: true` and `cacheState: 'ready'`; the app shows the Florida text, never "being fetched" | n/a | none |
| A park's `getEntitySchedule` fails in sampling | exactly today's behavior for that park (the existing per-park `try/catch` logs and moves on); no LL values are written for it that pass; its previous `ll_prices_captured_at` stays so the stored price ages honestly | next pass | `warn` (existing) |
| `extractLlPrices` throws on an unexpected schedule shape | caught inside the per-park step; the LL fields of that pass's rows are null, the rest of the pass is unaffected, and because the upsert is `COALESCE(EXCLUDED.col, stored)` the previously stored Multi Pass, Premier Pass, availability and `ll_prices_captured_at` stay untouched, so the stored price ages honestly and the label becomes `may_have_changed` after `LL_PRICES_STALE_HOURS` (round 3 M3) | next pass | `warn` |
| The `serviceStyleByExperience` query fails | caught in `loadBudget`; yields an empty map, so every dining Suggestion gets `applyTip: false`; the Suggestions read still succeeds and no other section is affected (round 3 L8) | next read | `warn` |
| Single-pass persistence or prune fails | caught; the pass completes; `max(captured_at)` unchanged so the next pass retries | next pass | `warn` |
| Park has no mapped experiences (`canonicalPark` null) | that park is skipped by the existing loop before any LL step | yes | `debug` (existing) |
| Endpoint P answers 400 for a today-dated call | one retry with the UTC date; if still 400, `start_date_rejected`; the claim-time `last_attempt_at` is KEPT (cooldown consumed), `blocked_until = now + TICKET_PRICES_FAILURE_COOLDOWN_MINUTES`, run stops; further demand starts nothing until the block ends (review F1) | after the block ends and the attempt cooldown passes | `warn` |
| Probe finds a moved horizon while the attempt cooldown is active | no sets pulled; `observed_horizon_date` stored; status `horizon_changed`; the next demand after the cooldown runs a `full` (review F25) | yes | `info` |
| Diagnose within 60 s of the previous diagnose, or while a run is in flight | refused (`too_soon` / `already_running`); no calls (review F23) | yes | `info` |
| Upstream text would be stored in `last_error` | normalized to a Ticket_Error_Code; text never stored or rendered (review F19) | n/a | no |
| Consecutive network/timeout/5xx/invalid outcomes reach the limit | run stops; `blocked_until = now + TICKET_PRICES_FAILURE_COOLDOWN_MINUTES` (60) | after cooldown | `warn` |
| Akamai page returned with HTTP 200 or 503 | `waf_block` (markers are checked on every non-JSON or non-2xx body); run stops; `blocked_until = now + 360 min` | after cooldown | `warn` |
| Past-dated trip start for a ticket line | no cache price; stored snapshot shown with its `asOf` and an aged label | n/a | no |
| `fl-resident` requested for a pair that is NOT permitted (`fl-resident` not in `TICKET_PRICES_GROUPS`, or the length not in `TICKET_PRICES_FL_RESIDENT_NUMDAYS`) or whose set is `not_offered` (round 5 M3) | quote with `flUnavailable: true`, `estimateReason: 'fl_unavailable'`, `cacheState: 'ready'`; `decideRefresh` filters the pair out, so no refresh is triggered by it | permanent per configuration / length | no |
| `fl-resident` (or `std-gst`) requested for a PERMITTED pair that has never been fetched (no set row, or `as_of` null with no error) (round 5 M3) | null price, `flUnavailable: false`, `cacheState: 'warming'` while a run is in flight or the attempt cooldown has elapsed; the same read's `noteDemand` makes `decideRefresh` return `full` (Requirement 13.6 treats a missing set as stale), so the next quote carries a price | yes | `debug` |
| A permitted pair whose set has `as_of` null and a recorded `last_error` (a failed fetch) (round 5 M4) | null price, `cacheState: 'failed'`, text "Automatic ticket prices could not be fetched; enter your price"; never `warming`; a later demand after the 24-hour attempt cooldown (or the block) retries, and an accepted set clears `last_error` | after cooldown | `warn` (at the failure) |
| A permitted, never-fetched pair with no error, nothing in flight and the attempt cooldown active (an earlier run died before reaching it) (round 5 M4) | null price, `cacheState: 'failed'` (no run can start until the cooldown ends) | after cooldown | `debug` |
| Admin "Block now" while a run is in flight (round 5 L4) | the run re-reads `blocked_until` before its next Disney call, makes no further call, releases the claim with status `blocked` | after the block | `info` |
| Second `401` on a call after the one token refetch, or `404` on a `std-gst` call or the probe (round 5 L3) | recorded as `http_status:401` / `http_status:404`; counts toward the consecutive-failure limit | next demand after cooldown | `warn` |
| `requireBudgetAction` for a persisted `member` of a Trip with no active organizer (round 5 H1) | acts as organizer (interim organizer through `assertTripMember`); one extra roster read | n/a | no |
| LL history thin (< 4 samples) | `no_estimate`, `add_your_price` | yes | no |
| Menu refetch (shape refill) fails | previous cache served unchanged (`menuRetrieval` behavior) | yes | `warn` |
| Menu item without parseable price | picker requires typed price; line becomes `user_entered` | n/a | no |
| Missing `park` on a line | bucket `other_resort` | n/a | no |
| Experience `latitude`/`longitude` null | not used by this feature | n/a | no |
| Account of an allocation is deleted | allocation anonymized to placeholder; shown as "Deleted user"; totals unchanged | n/a | no |
| Trip has no `start_date` in the future | Savings_Plan status `trip_started_or_past` | n/a | no |
| Diagnose while blocked | refused with the block time; no calls | after cooldown | `info` |

Authorization is checked before any Budget data is read (Requirement 18.4). Validation of external input: every request body is parsed by the strict Zod schemas above (unknown keys rejected); `:lineId`, `:profileId` and `:id` are UUIDs; query strings are not used by the Budget routes.

Invariants and their owners: money is integer cents and non-negative (Zod at the edge, `CHECK` constraints as backstop); person XOR (Zod, `CHECK`); one line per suggestion key (partial unique index); line cap (repo, under a Trip row lock); token never logged (client and service, tested); read purity (route design, tested); refresh attempt rate (Postgres claim, not memory).

## Testing Strategy

Test runners follow the repo rules: `apps/api` and `packages/shared` use Vitest, `apps/mobile` uses Jest (`jest-expo`) with `@testing-library/react-native`. Property tests use `fast-check`, at least 100 runs, tagged `// Feature: trip-budget, Property N: <title>`.

- **Shared** (`packages/shared/src/__tests__/`): `menuPricing.test.ts` and `menuPricing.prop.test.ts` (Properties 5, 6, 7 with the legacy mobile fixtures copied verbatim; round 5 L8: `normalizeTierName` trims, truncates a 60-character group-banner label to 40 characters, is idempotent and never exceeds `EXPENSE_TIER_NAME_MAX`); `tripBudget.test.ts` (valid and invalid cases for every schema, XOR superRefine, `BUDGET_TO_EXPENSE_CATEGORY` totality, Property 23 mapping, Property 25 schema half, `priceLabelText` strings); `menuDto.test.ts` (additive fields accepted).
- **Catalog** (`apps/api/src/services/catalog/__tests__/`): `menu.projection.prop.test.ts` (Property 8: legacy inputs deep-equal old output; new-field presence rules), `diningMenuClient.prices.test.ts` (fixture mirroring the real 1900 Park Fare payload: titles `"$59 per adult, plus tax and gratuity"` with `prices: []`, group `type: "Alcoholic Beverage"`, `serviceStyle: "Buffet"`), `menuRetrieval.shape.test.ts` (shape_version < 2 refetches once per demand; failure serves cache), pg-mem `repo.menuShape.test.ts` (writes `shape_version = 2`).
- **Shared money helpers (round 4 M4)** (`packages/shared/src/__tests__/money.test.ts`, `money.prop.test.ts`; `apps/api/src/services/tripBudget/__tests__/sharedMoney.crosscheck.test.ts`): `splitCentsEvenly` sums exactly, shares differ by at most one cent, remainder goes to the earliest entries; `bpsOf` is `floor((x * bps + 5000) / 10000)`, monotonic in both arguments and never negative; a cross-check asserts `splitCentsEvenly` equals the API `splitEvenly` shares in list order. The mobile "everyone" split (R3.4) and the Expense form tax/gratuity actions import these from `@dwt/shared`, so Properties 28 and 42 exercise the client code and not an API-only copy.
- **Real-database (`*.livedb.test.ts`) tests.** The following cannot run on pg-mem and are therefore written as `*.livedb.test.ts` files in the pattern of `apps/api/src/services/intelligence/__tests__/intelligenceRepoBaselineColumns.livedb.test.ts` (probe `DATABASE_URL`, default `postgres://dwt:dwt@localhost:5432/dwt`; `describe.skip` with a clear message when unreachable, so CI without Postgres stays green): `ticketPrices/__tests__/ticketRepo.livedb.test.ts` (10-array upsert, no error `21000` after dedupe and, as a negative control, error `21000` WITHOUT dedupe, tuple `IS DISTINCT FROM` leaves `changed_at` untouched, reconcile, prune, both claim statements, `make_interval`, the two-connection `Promise.all` claim race yielding one winner, the 15-minute reclaim), `lightningLane/__tests__/llRepo.livedb.test.ts` (the 12-array `upsertParkScheduleSignals`, the single-pass upsert with the exact `numeric_id || ';entityType=Attraction'` experience join (round 5 M5: a case with two Experiences `123;entityType=Attraction` and `123;entityType=Entertainment` and a purchase `lightninglane_123` stores one row with no error `21000` and `experience_id` equal to the Attraction's; a case with only the `Entertainment` Experience stores the row with `experience_id` NULL; a case with a batch of 3 distinct keys writes exactly 3 rows), prune, only-LL-columns, the three timestamp semantics including the per-pass regression of round 4 L1), and `tripBudget/__tests__/guestRemoval.livedb.test.ts` (the two-connection lock-first removal race of round 4 M6; also needs the `trip_budget_allocations` table from migration `0068`). **The executor MUST run these once against a local Postgres with migrations applied (`npx vitest run <file>` with the database up) and paste the output; "skipped" is NOT a pass for the task checkpoint.** pg-mem is used only for SQL it supports: the Budget repo and its migrations (single-array statements and plain SELECTs), with `btrim`, `char_length`, `lower` and a faithful `jsonb_typeof` registered in the harness the way `migration0064.test.ts` registers `char_length` and `lower` (review F17).
- **Lightning Lane** (`services/lightningLane/__tests__/`): `llExtract.prop.test.ts` (Property 18; fixture from the real schedule: ids `lightninglanemultipass_80007944` 3200, `premierpass_80007944` 39900, `lightninglane_16767284` 1400), `typicalPrice.prop.test.ts` (Property 20), `lookupLlPrice.test.ts` and prop (Property 21), `llRepo.livedb.test.ts` (Property 19, above, including the non-destructive-on-null regression cases that fail against an `= EXCLUDED` upsert), `samplingService.ll.livedb.test.ts` (two passes through the real repo, the second yielding no purchases or a throwing extractor: stored prices, availability and `ll_prices_captured_at` unchanged, and the pure `lookupLlPrice` turns `may_have_changed` after `LL_PRICES_STALE_HOURS`), `samplingService.ll.test.ts` (with a fake repo and fake live client: no destination call is ever made, `getEntitySchedule` is called once per park exactly as before, the park-level LL fields reach `upsertParkScheduleSignals` rows, single-pass rows reach the single writer only when the 12-hour guard allows, an `extractLlPrices` failure does not fail the pass, existing sampling tests unmodified).
- **Ticket prices** (`services/ticketPrices/__tests__/`): pure property tests for Properties 9, 10, 11, 13, 14, 15, 37; `parsePricesResponse.contract.test.ts` against a fixture that mirrors the real response (the 2026-11-15 four-day entries: base `697.36`/tax `45.33`, Park Hopper `797.36`, Park Hopper Plus `816.36`, Water Parks & Sports `767.36`, plus one-day Magic Kingdom adult `199`, child `194`; eight entries for multi-day and twelve for 1-day; ids exactly as in External Interfaces); `ticketPriceClient.test.ts` with a fake `fetch` (403 with and without an Akamai marker, **200 with an HTML Akamai challenge, 503 with an Akamai page**, 401, 404, 500, timeout, oversize, non-JSON, honest User-Agent header, `Authorization` only on P, **a 400 on a today-dated call retried once with the UTC date**, Property 35); `ticketRepo.livedb.test.ts` (Property 12 SQL half and claim concurrency, above); `refreshService.test.ts` with fake client, repo and clock (Properties 16 and 37, single-flight, probe-only path pulls nothing when the horizon is unchanged, needed `numDays` first, kill switch makes zero client calls, **three consecutive timeouts block for the failure cooldown**, **`start_date_rejected` keeps the claim-time `last_attempt_at`, sets `blocked_until = now + failure cooldown`, and 50 further `noteDemand` calls with the fake clock inside the block cause zero client calls and start zero runs (review F1, Property 37)**; a probe that finds a moved horizon while the attempt cooldown is active pulls nothing, stores `observed_horizon_date`, and a later demand after the cooldown runs one `full` (review F25, Property 15); a long-gap healthy set is accepted by the per-window-day guard (review F18, Property 11)); `diagnose.test.ts` (writes nothing, two calls plus the reported retry row, no token in result: Property 29; a second diagnose within 60 s is refused `too_soon`, and one during an in-flight run `already_running`, review F23); `errorCodes.test.ts` (any non-member string normalizes to `invalid_response`, `http_status:503` accepted; review F19); `config.ticketPrices.test.ts` also asserts the validation rules of Configuration & Constants (bad group name, `numDays` 0 or 11, ratio 1.5, non-positive minutes, browser-like User-Agent each fail boot; review F17); `noRedis.test.ts` and `structure.test.ts` (Property 36; a TypeScript-AST scan of import specifiers, call expressions and identifiers, never of comment text, with a detector self-test, round 5 L11); `cacheState.prop.test.ts` (Property 14, the five-rule order of `ticketCacheState` over the full cross product, with the `failed`-not-`warming` regression of round 5 M4 and the permitted-never-fetched `warming` case of M3); `dates.test.ts` also asserts `wdwDateOf(dateToInstant(d)) === d` for every date of 2026 through 2028 (round 5 L5); `refreshService.test.ts` additionally asserts the probe uses `std-gst` even when the configured order is `fl-resident,std-gst`, a `404` on `std-gst` and a repeated `401` are recorded as `http_status:404` / `http_status:401` and count as failures (round 5 L3), and a `blocked_until` set between two calls stops the run before the next call with status `blocked` (round 5 L4).
- **Migrations** (`apps/api/src/db/__tests__/migration0065.test.ts` ... `migration0068.test.ts`): tables, columns, `CHECK` constraints, XOR constraints, indexes, the `ticket_price_control` singleton row, idempotent re-application, and (0068) cascade from `trips`.
- **Budget pure** (`services/tripBudget/__tests__/`): `budgetMath.prop.test.ts` (Properties 1, 3, 28; round 5 M2: `allocateShares` non-negativity, exact sum, zero weight gets zero, less-than-one-cent deviation, the two verified counter-examples `(1, [0,1,1])` and `(2, [1,3,3,3])`, and an exhaustive small-domain check; a line with a 0-cent allocation yields per-person tax and tip of exactly 0 for that person), `budgetViews.prop.test.ts` (Property 2), `savingsPlan.prop.test.ts` (Property 4, with unit edge cases: 0, 1, 7, 8 days; target below saved), `resolveLinePrices.prop.test.ts` (Property 17), `suggestions.prop.test.ts` (Property 22), `vsActual.test.ts` (Property 23).
- **Budget repo** (pg-mem; plain single-array SQL only): create, edit (allocations replaced atomically), remove, the 500-line cap, XOR and duplicate-person rejection, **`trip_party_deleted` for a `pending_deletion` and a purged account on both line and profile writes while existing rows stay readable and deletable and the by-person label is `Deleted user` with an unchanged total**, `linked_expense_id` set null on expense delete, **a line whose linked Experience is deleted keeps its amounts (R2.9)**, suggestion unique index, settings upsert and `tax_bps` object CHECK, cascade on Trip delete, menu verification against cached `experience_menus` **including a `shape_version` 1 row verified by `parseMenuPriceString`**, `removeTripGuest` rejection when allocations reference the guest **(sequential pg-mem case) and, for the concurrent case, the two-connection `tripBudget/__tests__/guestRemoval.livedb.test.ts` (allocation inserted on connection A and not committed, lock-first removal started on B, A commits, B rejects, guest and allocation survive; round 4 M6, review F16)**, **an LL line created with only a typical estimate is stored with `price_source = 'themeparks_ll'` and re-resolves to the real price after a stored price row appears (review F2, Property 17)**, **`disney_menu` rejections: submitted `amountCents` differing from the computed sum, missing `experienceId`, non-`dining` category, allocation without `priceRef`, inflated `quantity` with an unchanged amount (review F3, Property 34)**, **editing a line that still allocates to a member who has left the Trip succeeds, while adding a new person who is not on the Trip fails (review F15, Property 41)**, **`ticketPrices.readBook` returns the whole same-key date series and not only the exact date (review F11; `repo.readBook.test.ts`)**, **the travelers list omits the profile of a `pending_deletion` member while `DELETE` by id still succeeds (review F4)**, **`departMember` deleting the departing member's profile in the same transaction while their allocations are unchanged and the Suggestions no longer include them**, and the constant statement count of `loadBudget` for 1 and 300 lines (`loadBudget` uses only plain SELECTs and no `json_build_object`), **and (round 5 M1) the whole-request count: `GET /budget` through the real route with the REAL `ticketPrices` and `lightningLane` read repos and a counting proxy over the pool (every `pool.query` and every `client.query`) issues the same number of statements for 1 and for 300 lines, at most `BUDGET_READ_MAX_STATEMENTS` = 14, and exactly one more for a persisted `member` of a Trip with no active organizer; the cases pg-mem cannot run (tuple `IN`, if the generated predicate is unsupported) live in `repo.load.livedb.test.ts`, which the executor runs once against local Postgres and pastes**.
- **Budget routes** (`server.inject` with a fake repo): authorization matrix for every route (member, organizer, non-member, unknown Trip: Property 24), a happy path per route asserting the exact status and body of the route contract table (round 4 M5: 201, 200, 204 as listed there), one validation failure per route, `fl-resident` under the default configuration returning `flUnavailable: true` with `cacheState: 'ready'` and a never-fetched `std-gst` quote returning `warming` (round 4 M2), **a PERMITTED `fl-resident` pair (configuration `std-gst,fl-resident` and `FL_RESIDENT_NUMDAYS=4`) that has never been fetched returning `flUnavailable: false` and `cacheState: 'warming'` and scheduling a `full` refresh (round 5 M3; fails against the old rule that set `flUnavailable` for any set without rows), a `not_offered` set returning `flUnavailable: true`, and a set with `lastError = 'network'`, `asOf = null`, the switch on and no block returning `cacheState: 'failed'` and not `warming` (round 5 M4)**, **the interim-organizer case through the real `assertTripMember` over pg-mem: a persisted `member` of a Trip whose only organizer is `pending_deletion` gets 200 on `PATCH /budget/settings`, the same member gets `trip_forbidden` once an active organizer exists, and `trip_not_found` is returned for a line id that is not on the caller's Trip (round 5 H1, L2)**, server-side amount resolution (client-sent ticket amount ignored), and Property 26 with counting fakes.
- **Budget repo numeric typing (round 3 M2)** (`tripBudget/__tests__/`): `repo.toCents.test.ts` (`'2500'` -> number 2500, `null` -> 0, non-integer strings throw) and a `loadBudget` case over a recording fake pool that returns the `vsActual` aggregates and `0060` columns as strings, asserting numeric `actualCents` and numeric net of refunds (a pg-mem-only test cannot catch this because pg-mem returns numbers), plus a skip-if-no-DB `repo.load.livedb.test.ts` doing the same against real `pg`.
- **Permissions** (`trips/__tests__/permissions.budget.test.ts`): the matrix (Property 24 first half) and that `can` is total over the extended union.
- **Account deletion**: extend the existing `dispositions.test.ts` expected count and entries (Property 30) and run the full registry test; add a purge test showing Budget allocations of a deleted member are anonymized and totals are unchanged; the Appendix B addendum row (Budget by-person view and traveler list) is added to `account-deletion/requirements.md` in the same change.
- **Admin**: `ticketPriceRoutes.test.ts` (Basic Auth gate, page renders states, same-origin enforcement returns 403 with no state change, refresh refused when the kill switch is off or blocked, diagnose writes nothing and is throttled, "Block now" sets `blocked_until` with reason `manual`, no input for prices, nothing secret rendered, a fake repo `last_error` containing `<script>` is rendered escaped, routes are absent when `ticketPrices` is not passed to `adminRoutes`), `ADMIN_SECTIONS` includes the entry.
- **Mobile pure**: `menuItemPicker.pure.test.ts` and prop (Property 27), `budgetApi` tests for payload builders.
- **Mobile component** (`@testing-library/react-native`, mock only the network layer; assert both the request and the screen change): `TripBudgetScreen.test.tsx` (**every button and chip is found by `getByLabelText`/`getByRole` and each chip's `accessibilityState.selected` follows the selection (Property 40)**; renders totals and each of the five views after tapping each chip; Suggestions Accept opens the form pre-filled and Dismiss POSTs `/budget/suggestions/dismiss`; savings card text; vs-actual text; labels "Estimate", "Your price", "Add your price", the Disney source line and "Powered by ThemeParks.wiki" present), `BudgetLineFormModal.test.tsx` (ticket quote picker POSTs `/budget/quotes` and shows the label; **for days = 1 and option base the park picker appears, defaults from the line's park, choosing Animal Kingdom POSTs `priceRef.park = 'ak'` and the returned label is not "Estimate", leaving it unset shows the parkAssumed "Estimate" text; a `flUnavailable` quote shows "Florida resident price unavailable for N days; enter your price"; a null-price ticket quote with `cacheState: 'warming'` shows "Prices are being fetched, try again in a minute" with `'disabled'` shows "Automatic ticket prices are unavailable right now; enter your price" and with `'failed'` shows "Automatic ticket prices could not be fetched; enter your price" and never "Prices are being fetched" (review F20, round 5 M4)**; saving POSTs `/budget/lines` with `priceRef`; typing a price switches the label to "Your price" and sends `user_entered`; restaurant picker flow; Lightning Lane picker), `BudgetTravelersModal.test.tsx` (PUT `/budget/travelers`, under-3 note, passType requires typed price; the travelers list contains no entry for an omitted profile, review F4), `BudgetSettingsModal.test.tsx` (organizer-only visibility, PATCH `/budget/settings`, assumption labels), `MenuItemPicker.test.tsx` (select item, choose price variant, quantity, typed price for priceless item, alcohol pre-check, confirm payload), `ExpenseFormModal.menuPicker.test.tsx` (new test file so the dirty `TripExpensesScreen.test.tsx` is not touched: "Pick from menu" appears only when itemized and a restaurant is linked, confirming appends editable draft items, and the submitted POST body items have exactly `{name, priceCents, assigneeIds, isAlcohol}` with no origin field; **"Add estimated tax" appends one editable `tax` Charge_Line equal to `bpsOf(subtotal, BUDGET_DEFAULT_TAX_BPS.dining)` over the assignees' subtotals, "Add estimated gratuity" appends one `gratuity` Charge_Line equal to `bpsOf(subtotal, BUDGET_DEFAULT_DINING_TIP_BPS)`, neither appears without the press, each can be edited and removed, and the POST `chargeLines` contains them only after the member submits (Property 42)**), `TripDetailScreen` tile test (the Budget tile with its body text renders after Expenses and navigates to `TripBudget` with the `tripId`) and the updated `tripStructureRegression.test.tsx` (10 sections, regenerated snapshot limited to the `budget` entry, 17 screen names; review F6).
- **Guards**: `themeRetrofit.guard.test.ts` must pass unchanged; `retirement.smoke.test.ts` must pass unchanged; `apps/api/src/__tests__/trip_memberships.guard.test.ts` passes with the single added `services/tripBudget/repo.ts` pin and `apps/api/src/__tests__/visibility.guard.test.ts` passes with no new entry (Property 41); the account-deletion registry test passes (Property 30); **`apps/api/src/services/trips/__tests__/roleReader.guard.test.ts` passes unmodified (round 5 H1: the Budget module never imports `effectiveRole.js`, so the importer set stays exactly `composeServices.ts`, `services/trips/authz.ts` and `services/trips/repo.ts`, and no file under `services/tripBudget/` contains a `role FROM trip_memberships` literal)**. Run all five in tasks 9.2, 14.1, 14.2, 15.1 and 15.3.

### Requirement-to-test traceability

Every requirement is validated by at least one Correctness Property (column 2) and by named tests (column 3).

| Requirement | Properties | Primary tests |
| --- | --- | --- |
| 1 | 31, 40 | `repo.separation.test.ts` (recording pool), expense-route response shape tests, migration0068 cascade, routes non-member test, TripDetailScreen tile test |
| 2 | 32 | `budgetLineInputSchema` tests, `repo.lines.test.ts` (create/edit/remove/cap/creator-or-organizer/R2.9 experience deletion), routes validation tests |
| 3 | 25, 28, 32, 41 | `tripBudget.prop.test.ts`, `money.test.ts` / `money.prop.test.ts` (shared `splitCentsEvenly`, `bpsOf`) and the API cross-check, `budgetMath.prop.test.ts`, repo guest-removal pg-mem test plus `guestRemoval.livedb.test.ts` (lock-first form), repo edit-with-departed-member test (3.7) |
| 4 | 25, 33 | `repo.profiles.test.ts` (including `departMember`, under-3/passType rules and the 4.8 not-on-Trip rejection), migration0068 users-columns test, BudgetTravelersModal test |
| 5 | 13, 17, 43 | `resolveLinePrices` tests (including 5.10 estimate-to-real upgrade), repo `price_source = 'themeparks_ll'` test, `priceLabelText` tests, PriceBadge text tests |
| 6 | 1, 2, 22, 43 | `budgetMath.prop.test.ts` (`allocateShares` non-negativity, R6.9), `budgetViews.prop.test.ts`, TripBudgetScreen view-chip tests, suggestions `startingPark` case |
| 7 | 1, 3, 32, 44 | `budgetMath.prop.test.ts`, BudgetSettingsModal test, settings route test, `tax_bps` CHECK test |
| 8 | 4, 44 | `savingsPlan.prop.test.ts`, screen savings test |
| 9 | 22, 27, 34, 42 | MenuItemPicker and BudgetLineFormModal tests (including the 60-character banner tier name, 9.10), repo menu-verification and amount-computation tests (shape 1 and 2; 9.9 rejections), suggestions `applyTip` cases |
| 10 | 5, 6, 7, 8, 34 | `menuPricing.*.test.ts`, `menu.projection.prop.test.ts`, `menuRetrieval.shape.test.ts` |
| 11 | 9, 10, 11, 12, 35, 37, 38, 43 | contract and client tests, `errorCodes.test.ts`, `ticketRepo.livedb.test.ts`, migration0065 |
| 12 | 15, 16, 26, 35, 36, 37 | `refreshService.test.ts` (including the admin Refresh-now bypass case, L5), `ticketRepo.livedb.test.ts` claim tests, `structure.test.ts` |
| 13 | 15, 16, 29, 36, 37 | client tests (WAF on 200/503), `refreshService.test.ts` (consecutive failures; `std-gst` probe and `http_status` classification, 13.11; Block now stops an in-flight run, 13.12), retirement smoke |
| 14 | 13, 14, 49 | `freshness.prop.test.ts`, `resolveTicketPrice.prop.test.ts` (including the non-exact-date-only book and the 364-day beyond-horizon target), `cacheState.prop.test.ts` (the five-rule order, `failed` never `warming`), quote `cacheState` route test (default-config `fl-resident` => `flUnavailable` + `ready`; never-fetched `std-gst` => `warming`; permitted never-fetched `fl-resident` => `flUnavailable: false` + `warming`; `lastError = 'network'` => `failed`), BudgetLineFormModal cache-state and `flUnavailable` precedence tests |
| 15 | 18, 19, 20, 21 | `llExtract.prop.test.ts`, `lookupLlPrice` tests (per-pass age, typical `asOf`), `llRepo.livedb.test.ts` (incl. non-destructive-on-null cases and the per-pass timestamp regression), `samplingService.ll.test.ts`, `samplingService.ll.livedb.test.ts`, migration0066 |
| 16 | 22, 46 | `suggestions.prop.test.ts` (including the 16.8 undated / park-less LL item), screen Accept/Dismiss tests, unique index test |
| 17 | 23, 45 | `vsActual.test.ts`, repo link tests, `repo.toCents.test.ts` and the string-returning fake-pool `loadBudget` case (numeric `vsActual`), screen vs-actual text test |
| 18 | 24, 30, 32, 41 | permissions and dispositions tests, `authz.test.ts` (interim organizer through `assertTripMember`), the three guard tests (`trip_memberships`, `visibility`, `roleReader`), route matrix tests, one `trip_validation_failed` ZodError case per route (18.9) |
| 19 | 29, 38 | `ticketPriceRoutes.test.ts` (including Block now, diagnose throttle, diagnose works with the kill switch off, escaping, port-absent case), `diagnose.test.ts` |
| 20 | 26, 32, 36, 47 | `routes.sideEffects.test.ts` and the real-repo statement-count test (14 = auth 1 + roster 1 + 6 + 1 + 3 + 2, 20.6), migration tests, docs structural check (no cron; keep-alive never touches the DB; LL depends on the sampling job), `structure.test.ts` |
| 21 | 38, 39, 48 | PriceBadge/attribution tests, admin page text test (verbatim owner quote, 21.8), route-table scan |
| 22 | 40, 49 | mobile tests above, `themeRetrofit.guard.test.ts`, navigation/hub tests |

## Configuration & Constants

Environment variables (all registered in `apps/api/src/config.ts` with Zod, listed in `apps/api/.env.example`; none is a secret; none is added to `render.yaml` as `sync: false`). **Boolean parsing: use the same transform the rest of `config.ts` uses (`PHOTOS_*` flags: `undefined`/`''` -> the default, a real boolean passes through, otherwise `val === 'true' || val === '1'`), with default `false` for `TICKET_PRICES_ENABLED`; never `z.coerce.boolean()`, which treats the string `"false"` as true.** `config.ticketPrices.test.ts` asserts `"0"` and `"false"` and unset parse to false and `"1"` and `"true"` to true. Config ownership: task 6.4 adds only the `LL_*` keys and task 8.4 adds only the `TICKET_PRICES_*` keys, in separate blocks of `config.ts`.

| Env var | Default | Meaning |
| --- | --- | --- |
| `TICKET_PRICES_ENABLED` | `false` | Kill switch. Stays false in production until the diagnose action passed three times at different times of day (R13.2). |
| `TICKET_PRICES_BASE_URL` | `https://disneyworld.disney.go.com` | Origin of endpoints T and P. |
| `TICKET_PRICES_GROUPS` | `std-gst` | Comma list of discount groups to cache; MUST contain `std-gst` (the horizon probe and Diagnose always use it, round 5 L3). Add `fl-resident` only after the lengths below are verified. |
| `TICKET_PRICES_FL_RESIDENT_NUMDAYS` | `4` | Comma list of lengths cached for `fl-resident` (only `4` verified on endpoint P on 2026-10-25; endpoint C listed 1, 3, 4). The implementer probes 1 to 10 through the admin diagnose tooling and sets the verified list. Used only when `fl-resident` is in `TICKET_PRICES_GROUPS`. |
| `TICKET_PRICES_STALE_AFTER_DAYS` | `30` | A set older than this triggers a demand-driven full refresh. |
| `TICKET_PRICES_MIN_ATTEMPT_INTERVAL_HOURS` | `24` | Global minimum between refresh attempts. |
| `TICKET_PRICES_PROBE_MIN_INTERVAL_HOURS` | `24` | Global minimum between horizon probes. |
| `TICKET_PRICES_REQUEST_SPACING_MS` | `1500` | Delay between consecutive Disney calls in a run. |
| `TICKET_PRICES_BLOCK_COOLDOWN_MINUTES` | `360` | Block duration after a 403, 429 or WAF marker. |
| `TICKET_PRICES_USER_AGENT` | `DwtTripBudget/1.0 (personal trip planner)` | Honest descriptive UA. The operator SHOULD append a contact URL: `DwtTripBudget/1.0 (+<contact url>)`. Never a browser UA. |
| `TICKET_PRICES_REQUEST_TIMEOUT_MS` | `20000` | Per-call timeout. |
| `TICKET_PRICES_MAX_BODY_BYTES` | `5000000` | Largest accepted response (real bodies are about 1.2 to 1.7 MB). |
| `TICKET_PRICES_SANITY_MIN_RATIO` | `0.5` **[A] starting value (from the report, not measured)** | A set whose rows per window day are below this fraction of the previous accepted set's rows per window day is rejected (review F18). |
| `TICKET_PRICES_MAX_UNRECOGNIZED_FRACTION` | `0.1` **[A] starting value (from the report, not measured)** | A set with a larger fraction of unrecognized ids is rejected. |
| `TICKET_PRICES_DIAGNOSE_MIN_INTERVAL_SECONDS` | `60` | Minimum time between two admin Diagnose runs (review F23). |
| `TICKET_PRICES_LABEL_FRESH_DAYS` | `45` | At most this old: `current`. |
| `TICKET_PRICES_LABEL_ESTIMATE_AFTER_DAYS` | `120` | Older than this: `estimate`. Between: `may_have_changed`. |
| `TICKET_PRICES_MAX_CONSECUTIVE_FAILURES` | `2` | Consecutive network/timeout/5xx/invalid outcomes in one run that stop it (R13.9). |
| `TICKET_PRICES_FAILURE_COOLDOWN_MINUTES` | `60` | `blocked_until` duration after the consecutive-failure stop (shorter than the WAF block). |
| `LL_PRICES_MIN_REFRESH_HOURS` | `12` | Single-pass table writes and prune run at most this often (judged on `max(captured_at)`); the park-level columns ride every pass. |
| `LL_PRICES_STALE_HOURS` | `72` | A stored LL price older than this is labelled `may_have_changed`. |
| `LL_PRICES_RETENTION_DAYS` | `400` | Prune `lightning_lane_single_prices` older than this. |
| `LL_TYPICAL_LOOKBACK_DAYS` | `400` | History window for the typical price. |
| `LL_TYPICAL_MIN_SAMPLES` | `4` | Samples required per tier. |

**Validation (review F17).** `config.ts` validates every `TICKET_PRICES_*` and `LL_*` value with Zod at boot and fails startup with a message naming the variable when a value is bad: `TICKET_PRICES_ENABLED` is `true`/`false`; `TICKET_PRICES_GROUPS` is a non-empty comma list that is a subset of `std-gst,fl-resident` (duplicates removed) and CONTAINS `std-gst` (round 5 L3: `fl-resident` alone fails boot); `TICKET_PRICES_FL_RESIDENT_NUMDAYS` is a comma list of integers 1 to 10 (may be empty only when `fl-resident` is not in `TICKET_PRICES_GROUPS`); `TICKET_PRICES_SANITY_MIN_RATIO`, `TICKET_PRICES_MAX_UNRECOGNIZED_FRACTION` are numbers in 0..1; `TICKET_PRICES_STALE_AFTER_DAYS`, `TICKET_PRICES_MIN_ATTEMPT_INTERVAL_HOURS`, `TICKET_PRICES_PROBE_MIN_INTERVAL_HOURS`, `TICKET_PRICES_BLOCK_COOLDOWN_MINUTES`, `TICKET_PRICES_FAILURE_COOLDOWN_MINUTES`, `TICKET_PRICES_DIAGNOSE_MIN_INTERVAL_SECONDS`, `TICKET_PRICES_REQUEST_SPACING_MS`, `TICKET_PRICES_REQUEST_TIMEOUT_MS`, `TICKET_PRICES_MAX_BODY_BYTES`, `TICKET_PRICES_MAX_CONSECUTIVE_FAILURES`, `TICKET_PRICES_LABEL_FRESH_DAYS`, `TICKET_PRICES_LABEL_ESTIMATE_AFTER_DAYS`, `LL_PRICES_MIN_REFRESH_HOURS`, `LL_PRICES_STALE_HOURS`, `LL_PRICES_RETENTION_DAYS`, `LL_TYPICAL_LOOKBACK_DAYS`, `LL_TYPICAL_MIN_SAMPLES` are positive integers; `TICKET_PRICES_LABEL_FRESH_DAYS` must be less than `TICKET_PRICES_LABEL_ESTIMATE_AFTER_DAYS`; `TICKET_PRICES_BASE_URL` is an `https` URL; `TICKET_PRICES_USER_AGENT` is non-empty, at most 200 characters and does not match `/mozilla|chrome|safari/i`. Cases are asserted in `config.ticketPrices.test.ts` (task 8.4).

Not introduced: `TICKET_PRICES_CRON_SECRET` (there is no cron), `THEMEPARKS_WDW_DESTINATION_ID` (the destination-level schedule call is not used, see External Interfaces), any Redis key, any new queue. Existing and reused: `THEMEPARKS_BASE_URL` (already in `config.ts`; the per-park schedule call uses it through the existing `liveClient`). The existing `SAMPLING_CRON_SECRET` still gates the sampling endpoint that now also persists Lightning Lane prices.

Shared constants (not environment): `BUDGET_LINE_LIMIT` 500, `BUDGET_ALLOCATIONS_PER_LINE_MAX` 50, `BUDGET_DISMISSED_LIMIT` 200, `BUDGET_MENU_ITEMS_PER_LINE_MAX` 100, `BUDGET_READ_MAX_STATEMENTS` 14, `BUDGET_DEFAULT_TAX_BPS`, `BUDGET_DEFAULT_DINING_TIP_BPS` 1800, `BUDGET_TOTAL_CAP_CENTS` 1,000,000,000, `MENU_SHAPE_VERSION` 2, the claim timeout 15 minutes (code constant `TICKET_CLAIM_TIMEOUT_MINUTES = 15`). Label strings live in `priceLabelText`. A Budget-wide numeric `EXPENSE_AMOUNT_MAX_CENTS` (10,000,000) is reused per allocation.

## External Interfaces

All Disney values below were verified on 2026-10-25 from a residential IP by the second investigation; behaviour from a Render IP is **unverified** and is why the kill switch defaults to off. Values marked **[A]** are assumptions the implementer MUST verify before relying on them.

### Disney endpoint T: anonymous client token

`GET {TICKET_PRICES_BASE_URL}/profile-api/authentication/get-client-token/`. No auth, no cookies needed (the response sets a cookie; ignore it). Response `{"access_token":"<32 hex>","expires_in":1800}`, 69 bytes, about 150 ms. Cache the token in memory for one run only.

### Disney endpoint P: price calendar

```
GET {TICKET_PRICES_BASE_URL}/api/lexicon-view-assembler-service/wdw/tickets/product-types/theme-parks/prices
    ?discountGroup=std-gst&startDate=2026-10-25&storeId=wdw&endDate=2027-12-31&numDays=4
Authorization: BEARER <access_token>
Accept: application/json
```

| Param | Rules (verified) |
| --- | --- |
| `storeId` | `wdw` |
| `discountGroup` | `std-gst` and `fl-resident` work. `passholder` returns 404 (affiliation not enabled for this store). `dvc` and `canada-resident` return 404 ("No PIBI Found"). |
| `numDays` | 1 to 10. `11` returns 404 "No PIBI Found". |
| `startDate` | `YYYY-MM-DD`. A date earlier than "today" returns 400 (misleading message) (verified). **[A] Whose "today"** (Disney's server date in UTC, or the New York date) **is NOT verified**: the observation came from a machine clock in an unknown zone. If Disney compares against UTC, then from about 20:00 ET (00:00 UTC, already the next UTC date) a call with `startDate` = the New York date would be "earlier than today" and answer 400 every evening; the safe rule is therefore to retry once with `max(WDW_Today, UTC date)` (Requirement 11.13). The implementer MUST run the Diagnose action once after 20:00 ET and record in the Ticket_Client header comment which date Disney accepted. |
| `endDate` | `YYYY-MM-DD`, must not exceed `maxPricingCalendarDate`. Beyond it returns 500. |
| `addOn` | Not sent. Omitting returns all four options in one response. |
| `fpAvailability`, `storeBasedPearlEnabled` | Sent by Disney's own page; not required (calls without them succeeded). Not sent. |

Missing `Authorization` returns 401 `{"errors":[{"typeId":"UNAUTHORIZED","message":"Authorization header missing",...}]}`.

Response fields relied on (Zod schema lists exactly these; extra keys are ignored):

```json
{
  "maxPricingCalendarDate": "2027-12-31",
  "pricingCalendar": [
    { "numDays": "4",
      "dates": [
        { "date": "2026-11-15", "validityStartDate": "2026-11-15", "validityEndDate": "2026-11-21", "bufferDays": 3,
          "currency": "USD",
          "pricing": [
            { "id": "theme-park_4_A_0_0_RF_AF_SOF_progenstr", "ageGroup": "adult",
              "pricePerDay": "174.34", "subtotal": "697.36", "tax": "45.33",
              "stopSale": false, "availability": true, "enabled": true }
          ] } ] } ]
}
```

| Field | Use |
| --- | --- |
| `maxPricingCalendarDate` | Horizon_Date. |
| `pricingCalendar[].numDays` | string or number; cross-checked with the request. |
| `dates[].date` | ticket start date (`start_date`, WDW local calendar date). |
| `dates[].validityEndDate` | `valid_end_date`. |
| `pricing[].id` | product id; mapped below; stored as `product_id`. |
| `pricing[].ageGroup` | `adult` or `child`; cross-checked with the id. |
| `pricing[].subtotal` | **the price**: total for that length, pre-tax, dollars string -> cents. |
| `pricing[].tax` | `tax_cents` (observed ratio to `subtotal` is 0.065). |
| `pricing[].stopSale`, `availability`, `enabled` | sellable only when `stopSale=false`, `availability=true`, `enabled=true`. |
| `pricePerDay` | NEVER used (re-multiplying drifts by up to $0.09; display only). |

Sizes (full window, `startDate` today to `endDate` 2027-12-31, 433 days): `numDays=1` about 1.74 MB and 5,196 rows (12 entries per date: 4 parks x 2 ages for base, plus 2 each for Park Hopper and Park Hopper Plus; Water Parks & Sports is not sold for 1 day); `numDays` 2 to 10 about 1.19 MB and 3,464 rows each (8 entries per date). One date is about 2.9 KB, one month about 83 KB. A full All-Guests refresh is 1 token + 1 probe + 10 price calls (12 requests, about 12.4 MB, 36,372 rows).

**Id mapping** (pattern `theme-park_{numDays}_{A|C}_{opt}_{res}_RF_AF_SOF_progenstr[_{park}]`):

| Token | Value | Column |
| --- | --- | --- |
| `A` / `C` | adult 10+ / child 3-9 | `age_group` = `adult` / `child` |
| `opt` | `0` / `P` / `PHP` / `WPS` | `option_code` = `base` / `park_hopper` / `park_hopper_plus` / `water_parks_sports` |
| `res` | `0` / `2` | `discount_group` = `std-gst` / `fl-resident` |
| suffix | `_mk` `_ep` `_hs` `_ak` | `park`; present only on 1-day base rows, otherwise `park = 'any'` |

Verified examples on 2026-11-15 (adult, All Guests): 4-day base 697.36, Park Hopper 797.36 (add-on 100.00), Park Hopper Plus 816.36 (add-on 119.00), Water Parks & Sports 767.36 (add-on 70.00); 1-day Magic Kingdom adult 199, child 194; Florida Resident 4-day base 418.42. On 2026-12-26 the four 4-day adult prices are 725.93, 830.93, 848.43, 795.93. Horizon on 2026-10-25: 2027-12-31. These are test-fixture anchors and cannot be re-verified later; do not assert them against live data.

Other Disney endpoints (L, A, C) exist but are NOT used. Only T and P are called (Requirement 11.12). Annual Pass prices are HTML-only and not used.

Terms of use position: see the Decision record above. `robots.txt` does not disallow these paths; it disallows `/*?*price` query patterns, and none of the query keys used (`discountGroup`, `startDate`, `storeId`, `endDate`, `numDays`) contains `price`.

### ThemeParks.wiki: park schedule (used) and destination schedule (NOT used)

Used: the per-park schedule the sampler already fetches, `GET {THEMEPARKS_BASE_URL}/entity/{parkGuid}/schedule` (via `liveClient.getEntitySchedule(park.id)` in the per-park loop of `samplingService.ts`; the `schedule[]` of that response carries the same entries and `purchases` as the corresponding element of the destination response). Extraction runs on that array with zero additional requests (see "Lightning Lane pure modules").

Verified shape of the destination-level response (for reference only; this feature does not call it): `GET https://api.themeparks.wiki/v1/entity/e957da41-3552-4cf6-b636-5babc5cbc4e5/schedule` (WDW destination GUID) returns `{ id, name, entityType, timezone, schedule: [], parks: [ { id, name, schedule: [ { date, type, openingTime?, closingTime?, purchases?: [...] } ] } ] }`. The top-level `schedule` is empty; each park's `schedule` carries the 31 dates (2026-10-25 to 2026-11-24 when probed). `type` is `OPERATING` (carries `purchases`) or `TICKETED_EVENT`. **Why it is not used:** an earlier draft planned to replace the per-park calls with this one call; design review found that (a) the sampler already fetches each park's schedule, so the destination call would be a net extra request, (b) a `parks[]` entry is a park GUID and the destination response has no `liveData`, so it cannot be mapped to a `canonicalPark` by the sampler's experience-based path, and (c) it would force a type extension, a new env var and a second writer. If a future change removes the per-park schedule calls, this response is the one-call alternative.

Purchases (verified; `price.amount` is in cents):

| `type` | `name` | `id` example | `price.amount` example |
| --- | --- | --- | --- |
| `PACKAGE` | `Lightning Lane Multi Pass` | `lightninglanemultipass_80007944` | 3200 |
| `PACKAGE` | `Lightning Lane Premier Pass` | `premierpass_80007944` | 39900 |
| `ATTRACTION` | `Lightning Lane for Seven Dwarfs Mine Train` | `lightninglane_16767284` | 1400 |
| `ATTRACTION` | `Lightning Lane for TRON Lightcycle / Run` | `lightninglane_411504498` | not recorded |

Each purchase has `price { amount, currency: "USD", formatted }` and `available` (false means sold out; the price is still shown). The four theme parks expose purchases; Blizzard Beach has none. Single Pass ids map to Catalog Enterprise_Ids as `16767284` to `16767284;entityType=Attraction` (found in `experiences.upstream_entity_id` for Seven Dwarfs Mine Train and TRON). **[A]** whether every Single Pass id maps to an Attraction-typed Enterprise_Id; unmatched ids are stored with `experience_id` NULL. Parks are never identified by name: the sampler's `canonicalPark` (from `experiences.park` of the park's mapped live entries) is the only park key used.

Terms (verified from `themeparks.wiki/pricing`): free tier requires a visible "Powered by ThemeParks.wiki" credit and prohibits passing the data on as data for other software (public feed, widgets, user bulk export); 300 requests per minute. This feature adds no ThemeParks.wiki request at all (it reads responses the sampler already fetches).

### Disney dining menu (existing, read by `diningMenuClient.ts`)

`GET https://disneyworld.disney.go.com/dining/dinemenu/api/menu?searchTerm={Enterprise_Id}`. Response `{ name, location, destinationId, mealPeriodsList: [...], mealPeriods: [ { name, label, experience, serviceStyle, groups: [ { name, type, items: [ { title, prices: [ { withoutTax, type, currency } ], pricesRange, description } ] } ] } ] }`. Prices are pre-tax (`withoutTax`) numbers in dollars (whole or two decimals). `type` examples: `"Per Serving"` (**[A]** other values unverified). Group `type` examples: `"Entree"`, `"Alcoholic Beverage"`. `serviceStyle` example: `"Buffet"` (**[A]** other values unverified). `experience` example: `"Character Dining"`. Prix fixe and buffet prices are often item titles with `prices: []`: `"$59 per adult, plus tax and gratuity"`, `"$38 per child, plus tax and gratuity"`, `"$42 per child (Ages 3-9), plus tax and gratuity"`; a group name can be the banner ("Breakfast Buffet Pricing" with item "Buffet Breakfast" $45; "Splitsville ... Prix Fixe Menu ($45 per person)"). Coverage in the local dev database (2026-10-25): 393 of 448 restaurants have cached menus; 4,422 of 37,649 items (11.7%) have no price; priced items are USD only. Retrieval stays demand-driven through `menuRetrieval.ts` with `MENU_FRESHNESS_MS` 86,400,000.

### Identity mapping

`experiences.upstream_entity_id` is the Disney Enterprise_Id (for example `"362428;entityType=restaurant"`). The ThemeParks GUID is obtained from it with `themeParksDirectory.resolveEntityId(enterpriseId)`; a raw join does NOT equal the GUID, and some experiences (for example Aloha Isle) have no ThemeParks counterpart at all, which is a permanent upstream gap. This feature never needs the GUID for ticket or menu prices; Lightning Lane park mapping uses the GUID-to-experience path of `samplingService`.

### WDW calendar

All "today", weekday and day-difference logic uses `apps/api/src/services/trips/wdwClock.ts`: `wdwToday(now)`, `wdwDayOfWeek(dateString)` (JS convention, 0 = Sunday), `wdwOffsetMinutes`. Timestamps are stored as UTC `TIMESTAMPTZ`; trip and ticket dates are `DATE` and compared as `YYYY-MM-DD` strings; day differences are computed from UTC midnight of the date strings.

### Reused existing types and modules

`expenseItemInputSchema` (`{ id?, name 1..100, priceCents > 0, assigneeIds >= 1 distinct, isAlcohol? }`, `.strict()`), `expenseTierInputSchema`, `chargeLineInputSchema`, `EXPENSE_AMOUNT_MAX_CENTS`, `EXPENSE_ITEM_NAME_MAX`, `EXPENSE_TIER_NAME_MAX`, `ExpenseCategory`, `tripCalendarDateSchema`, `uuidSchema` from `@dwt/shared`; `splitEvenly` from `services/tripExpenses/allocation.ts` (only in the `splitCentsEvenly` cross-check test; Budget does NOT use `allocateProportionally`, round 5 M2); `can`, `TripAction`, `TripRole` from `services/trips/permissions.ts`; `assertTripMember` from `services/trips/authz.ts` as the first half of `requireBudgetAction` (round 5 H1; `services/trips/effectiveRole.ts` is NOT imported by the Budget module); `classifyDisneyResponse` and `DISNEY_WAF_BODY_MARKERS` from `services/catalog/disney/classify.ts`; `createMenuRetrieval`/`decideMenuFetch`; `projectMenus`; `isSameOriginRequest` and `renderPage` in the admin module; `wdwClock`.

## Cross-Spec Dependencies and Build Order

Build order (a later item may depend on any earlier one):

1. `trips` (hub, roster, matrix) and `trip-expenses` (person key, allocation primitives, categories). Already built; amended additively by this change (permissions actions, hub, Requirement 16 picker, guest-removal check).
2. `restaurant-menu-display` and `disney-facilities-catalog-source` menu projection: structured fields, shape version, lazy refill (amended additively: `restaurant-menu-display` Requirement 8; `disney-facilities-catalog-source` Requirement 8 describes the menu source and is not changed, because `restaurant-menu-display` owns MenuDTO projection and lazy retrieval).
3. `crowd-calendar` sampling: Lightning Lane persistence (amended additively: Requirement 19; this spec owns migration `0020` and `samplingService`).
4. `disney-source-resilience`: documented exception for the ticket client (Requirement 16 there); the transport itself is not modified. Its Property 17 is reworded at design review to checkable assertions (see Property 36 here): no module under `ticketPrices/` imports the transport, the limiter, a Redis client or the retired live path; the client's only request paths are T and P; the service is composed in its own block; `retirement.smoke.test.ts` passes. A "no other module calls `fetch` against a Disney origin" scan is NOT used because `catalog/disney/liveClient.ts` (Sync Gateway) and `themeparks.ts` call `fetch` today.
5. `account-deletion` (Requirement 21 and Appendix A/B addenda), `admin-panel` (Requirement 18; its task 24.1 depends on trip-budget tasks 8.3 and 8.4, review F7), `legal-disclaimers-and-terms` (Requirement 7).
6. `trip-budget` (this spec): shared contracts, migrations, pure modules, repo and routes, mobile.

Within this spec: shared contracts and the price parser first; then migrations; then menu changes; LL persistence; ticket prices; Budget pure modules; Budget repo and routes; mobile. The full order and wave graph are in `tasks.md`.

## Key decisions and alternatives considered

- **Merge Budget into Expenses (rejected).** Would break Net_Balance zero-sum and force payer and split onto estimates.
- **Store computed totals (rejected).** Views are cheap group-bys over at most 500 lines; storing them invites drift.
- **Resolve prices only at write time (rejected for tickets and LL).** A snapshot goes stale as caches refresh; read-time resolution keeps budgets current without ever writing on a read. Menu prices are snapshots because menus can vanish.
- **Cron-driven refresh (rejected by the project owner).** Demand-driven with a cooldown matches `menuRetrieval.ts` and avoids waking Neon on a schedule.
- **One JSONB row per date for tickets (rejected).** Normalized rows follow the investigation's recommendation; they constrain and index better.
- **Use `DisneyTransport` (rejected).** See "Why the transport is not used".
- **Per-attraction LL API calls (rejected).** The park schedule the sampler already fetches carries every purchase.
- **A new WDW destination-schedule call for LL prices (rejected at design review).** Redundant with the per-park schedule calls, not mappable to `canonicalPark`, and it would create a second writer of `ll_multipass_price_cents`.
- **Admin-curated price table (rejected by the project owner).** The admin page is diagnostic only.

## Not in scope / deferred

Annual Pass prices (HTML only, about four values, change roughly yearly); water park single-day tickets; Passholder, DVC, Canadian-resident, military and other discounts (all `user_entered`); reseller and discount-ticket prices; hotel and lodging pricing; parking; merchandise catalogs (shopping lines are manual unless trivially covered by a generic category); sharing the Budget beyond existing Trip members; Budget export; per-person saved-amount tracking; any scheduled ticket refresh; any admin price-entry UI; multi-currency.

## Notes

- Verification evidence for External Interfaces lives in `.agents/tasks/trip-budget/investigation.md` and `ticket-price-source.md`; the implementer should read both before coding.
- **[A] items needing verification before release:** the set of `serviceStyle` values (replace `TIP_BEARING_SERVICE_STYLES`; no cached row carries the field until the lazy refill runs, so task 11 gathers it by requesting about 30 restaurants through `GET /catalog/:id` at least 1.5 s apart or by a deleted-afterwards local script over `diningMenuClient`, then `SELECT DISTINCT m->>'serviceStyle' FROM experience_menus, jsonb_array_elements(menus) m`; if that cannot be done the constant stays **[A]**, is commented as such in `suggestions.ts` and the final report, and `applyTip` stays false for unknown styles; review F9), whether the production Sampling_Job is scheduled and `park_schedule_signals.ll_prices_captured_at` advances (otherwise every Lightning Lane price is `add_your_price`; operator launch gate and a `docs/hosting.md` line, review F14), the 143-of-448 NULL-park restaurant count (measured on the local development database on 2026-10-25 only, review F24), the `startingPark` string format in `day_touring_hours` (the mapping through `PARKS` makes a mismatch harmless but lowers suggestion quality), the timezone basis of Disney's `startDate >= today` rule (Diagnose after 20:00 ET), the Single Pass id to Attraction Enterprise_Id mapping, the Akamai behaviour from a Render egress IP (the three Diagnose runs), and the Florida-resident lengths (a configuration decision resolved by probing 1 to 10 through the diagnose tooling or a deleted-afterwards local script).
- **Round 5 responses.** `.agents/tasks/trip-budget/reviews/design-review.md` holds the round 5 review (1 HIGH, 5 MEDIUM, 14 LOW); the round 4 review is preserved unchanged as `.agents/tasks/trip-budget/reviews/design-review.round4.md` and the round 2 review as `.agents/tasks/trip-budget/reviews/design-review.round2.md` (round 5 L10). Every finding was verified against the source before the text changed. **H1** (verified in `roleReader.guard.test.ts`): the Budget gate is `assertTripMember` + `can` in `services/tripBudget/authz.ts`; `effectiveRole.ts` is never imported (R18.2, Authorization paragraph, Property 24, tasks 9.2/14.1/15.1/15.3, `trips` R25.2 and Property 30 amended additively). **M1**: `BUDGET_READ_MAX_STATEMENTS` is 14 (auth 1 + roster 1 + 6 + 1 + 3 + 2) and the guarding test counts real statements with the real ticket and LL repos (R20.6, read flow, Property 26, tasks 1.1/14.3/15.3). **M2** (verified by running the helper; the reviewer's claim that all-positive weights are safe is WRONG: `allocateProportionally(2, [1,3,3,3])` = `[-1,1,1,1]`, so zero-weight filtering alone is insufficient): Budget-local largest-remainder `allocateShares`, new R6.9, Property 1/2 extended, task 12.1; the Expense helper is untouched. **M3 and M4**: one total pure `ticketCacheState` with four values (`disabled`, `ready`, `failed`, `warming`), `flUnavailable` only for a never-fetchable pair, `pairPermitted` into the resolver, `last_error` cleared on acceptance (R14.8, R14.12, Property 14, Error Handling rows, tasks 7.4/15.3/18.2). **M5** (verified read-only on the local development database: unique index `experiences_upstream_entity_id_key`; the numeric prefix `80010856` is shared by a `Dinner-Show` and an `Entertainment` Experience; the review also reported `17855368`, which this run did not find, so the data may have changed, which does not change the hazard): exact `numeric_id || ';entityType=Attraction'` join on the unique index (R15.6, migration 0066 paragraph, Property 19, task 6.3). **L1** money.ts placement and signatures; **L2** `trip_not_found` added to R18.6; **L3** `std-gst` probe and failure classification (new R13.11); **L4** in-flight Block now (new R13.12); **L5** `dateToInstant`; **L6** R14.5 reworded to verified facts; **L7** verbatim owner quote and a launch gate (new R21.8); **L8** `normalizeTierName` (new R9.10); **L9** undated or park-less LL items propose nothing (new R16.8); **L10** this list; **L11** AST-based structure test; **L13** new R4.8; **L14** task 9.2 now says 14.1. **L12 declined for change** (carried from round 4 L11): the Expense tax and gratuity controls (`trip-expenses` R16.6, Property 42, task 19.1) are specified, tested and flagged for an owner veto; no further text changes unless the owner declines them.
- **Known quirk of the Expense helper, for `trip-expenses` owners (not changed here).** `allocateProportionally(totalCents, targets)` in `services/tripExpenses/allocation.ts` documents only that its outputs sum to `totalCents`. Reproduced: `allocateProportionally(1, [0,1,1])` returns `[-1,1,1]` and `allocateProportionally(2, [1,3,3,3])` returns `[-1,1,1,1]`, because the base shares use `Math.round` (ties up) and the remainder correction subtracts from index 0 first regardless of weight. For a non-negative `totalCents` and non-negative weights a negative or non-zero-for-a-zero-weight share is therefore possible. The Expense paths that call it (Charge_Line allocation, Refund distribution) are outside this spec and unchanged; an owner who wants the same guarantee can adopt the `allocateShares` algorithm of this design (the signed-total case needs its own rule).
- **Operator launch gates (manual, not done by the agent).** Before `TICKET_PRICES_ENABLED=true`: the admin Diagnose passed three times at different times of day, once after 20:00 ET (Requirement 13.2); the owner confirmed in writing that "option 1" included accepting the Terms-of-Use exposure (Requirement 21.8); the sampling job is scheduled in production (Requirement 20.7).
- **Round 4 responses.** `.agents/tasks/trip-budget/reviews/design-review.round4.md` holds the round 4 review (0 HIGH, 6 MEDIUM, 11 LOW). All six MEDIUM findings and all eleven LOW findings were addressed in the text: M1 (diagnose never reads the kill switch; Admin section, Property 38, tasks 8.3 and 10.1), M2 (`cacheState` precedence and the permitted-pair rule; R14.12, Property 14, tasks 15.3 and 18.2), M3 (`services/ticketPrices/adminPort.ts` created in task 8.3 with `AdminTicketPricesState` and `AdminDiagnoseResult` defined), M4 (`bpsOf` and `splitCentsEvenly` in `packages/shared/src/money.ts`; task 1.1), M5 (route contract table), M6 (lock-first guest removal plus a two-connection livedb test; the single-statement form is only kept if the livedb test proves it sufficient), L1 (per-pass capture timestamps, migration 0066), L2 (364-day beyond-horizon target), L3 (ticket draft fields and the widened "Other (resort or multi-park)" label), L4 (typical-estimate `asOf` = newest sample date), L5 (admin Refresh now exception), L6 (reconcile scoped to the window sent), L7 (`BUDGET_MENU_ITEMS_PER_LINE_MAX`), L8 (`BUDGET_READ_MAX_STATEMENTS`, 12 at the time; corrected to 14 by round 5 M1), L9 (`normalizeMenuName`), L10 (this Notes list and the migration-number instruction), L11 (explicit requirement numbers on task 16; the Expense tax/gratuity controls kept but flagged for the owner in task 19.1). Nothing was backlogged or ignored.
- **Review tags.** The `(review Fn)` tags in this design, in `tasks.md` and in the amended specs refer to findings in `.agents/tasks/trip-budget/reviews/design-review.round2.md` (kept unchanged there) and are informational only; the requirement text, Correctness Properties and task lists are authoritative and need no review document to be understood. Round 3 findings (hub tile rendering, string-typed money columns, non-destructive Lightning Lane upsert, and the LOW items) are folded directly into the text of the sections they affect.
