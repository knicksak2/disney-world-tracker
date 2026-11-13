# Design Document

## Overview

The Dining Plan Calculator is a **pure calculation engine** (`apps/api/src/services/diningPlan/`) with three thin shells around it: a **Trip-scoped service and routes** that load a Trip's party, stay, entries and the cached catalog data and return the engine's result; a **stateless route** that runs the same engine on a request body; and an **Admin_Panel section** where the operator maintains the three things the app cannot learn from Disney's data: plan price periods, per-restaurant credit rules, and default assumptions. The mobile app is a view over the server result and never recomputes a total.

The engine compares **No Plan** against each available **Dining Plan** on one basis: every out-of-pocket amount carries tax, every table-service meal carries a tip, and a credit-covered amount carries neither (the plan price already includes tax), except that a location with included gratuity saves its tip too. For each plan it chooses, **per person**, the meals to cover by solving a small exact knapsack, then totals, compares, labels every figure's basis, and reports how sensitive the verdict is to how the party orders.

### Key design decisions

1. **Pure engine, injected data.** `computeDiningPlan(input)` takes plain values (persons, stay, settings, entries, locations with their menus and rules, price rows, config, today) and returns a `DiningPlanResultDTO`. No I/O, no clock reads, no randomness. This makes the whole feature property-testable and makes the Trip route and the stateless route share one code path (Requirement 16.9).
2. **Credits are per person and non-transferable.** Disney's Dining Plan page says meals and snacks are "nontransferable between party members" and that table-service and quick-service credits are not interchangeable. Several third-party guides describe credits as pooled; the calculator follows Disney. Per-person allocation also falls out naturally when a child is on the children's menu or someone skips a meal.
3. **Exact allocation, not a heuristic.** Table-service credits are a 0/1 knapsack with weights 1 or 2 over at most 120 meals and at most 60 credits per person, which is trivially exact by dynamic programming. A greedy "highest price first" would misprice the two-credit trap (a $120 two-credit meal versus two $70 one-credit meals), which is the exact case users ask about.
4. **Tax on both sides of the comparison.** Plan prices include tax; menu prices do not. Out-of-pocket food, snacks and mugs are taxed at `taxBps` (default 650, the `trip-budget` dining default), covered amounts are not. Skipping this understates every out-of-pocket scenario by about 6.5% and biases the answer against the plan. Neither reference calculator (WDW Prep School, distripplanner.com) has a tax input on its form, so this is where the app can be more accurate.
5. **Tip is modelled, not ignored.** The first proposal was to leave tip out and note it applies equally. That is wrong for the few locations whose gratuity is included with a plan (Cinderella's Royal Table, Hoop-Dee-Doo, Private Dining at Disney's Grand Floridian), where the plan saves the tip. Tip is therefore a line in every scenario (`tipBps`, default 1800, set to 0 to ignore it), owed on table-service meals in every scenario, and waived only for covered meals at Gratuity_Included locations.
6. **Every figure carries its basis.** A meal is priced by the first available of: operator override, fixed menu offer, priced menu items, average-entree estimate, price-tier estimate, configured default. The result counts how many meals sit on each basis and how many rules are unverified, and the UI says "Estimated" when the answer rests on guesses.
7. **Operator-maintained, not scraped.** Plan prices, credit costs and defaults live in Postgres and are edited in the Admin_Panel. There is no outbound call at request time, no cron and no worker (hosting constraints). Disney does not publish a machine-readable list of which restaurants cost two credits, so that list is curated in the Admin_Panel, starts from a broad seed (the locations Disney's own channels name as two-credit, marked verified with their dates, plus third-party-only and non-participating locations marked unverified, so the operator deletes wrong rows instead of typing every row), and every row records whether it is verified.
8. **Save with the Trip, calculate on read.** The database stores settings and entries only. Party, stay, menus, rules and prices are read at request time, so a change to any of them changes the answer without a migration or a recompute job.
9. **Reuse, not reinvent.** Money helpers (`bpsOf`, `splitCentsEvenly`) from `@dwt/shared/money.ts`; price parsing (`extractMenuPriceOffers`, `computeMenuEstimatePerPerson`) from `@dwt/shared/menuPricing.ts`; tax and tip defaults from `trip-budget` constants; date arithmetic from `services/ticketPrices/dates.ts`; WDW time from `services/trips/wdwClock.ts`; authorization from `assertTripMember` and `can`.

### Decision record: what changed from the conversation

- **Tip** is in the model (decision 5), where the conversation proposed leaving it out.
- **Standalone mode** is included as a stateless route and a local-state screen (Requirement 20). It persists nothing.
- **Credits are per person** (decision 2), not a shared pool.
- **Where the verified facts end.** Confirmed against Disney's own pages on 2026-11-09: the entitlements per plan, the 3-and-over rule, rollover and expiry, non-transferable and non-interchangeable credits, two-credit fine/signature dining, the gratuity exceptions, and the 2026 kids-free offer conditions. Confirmed on a Disney Q&A page: the 2026 adult prices. Not confirmed by Disney: that plan prices include tax (third-party reports say so), every child price, and every 2027 price. Those are seeded as unverified, and `planPricesIncludeTax` is a setting in case the report is wrong.
- **Guests under 3 are not diners.** They get no plan and no credits, and their food is not priced, because they usually eat free or share. The screen says so. This is a deliberate simplification; pricing them would add the same phantom cost to every scenario.

## Architecture

### Placement

| Concern | Location |
| --- | --- |
| Constants, enums, Zod, DTOs | `packages/shared/src/diningPlan.ts` (new), `packages/shared/src/index.ts` (exports), `packages/shared/src/menuPricing.ts` (additive: `classifyMenuGroup`, `menuGroupItemCents`) |
| Permissions | `apps/api/src/services/trips/permissions.ts` (additive: `view_dining_plan`, `edit_dining_plan` in `MEMBER_ACTIONS`) |
| Pure engine | `apps/api/src/services/diningPlan/engine/*.ts` (see Components) |
| Service, repo, routes | `apps/api/src/services/diningPlan/{service,repo,routes,authz,types}.ts` |
| Admin | `apps/api/src/services/admin/diningPlanRoutes.ts` (new, like `ticketPriceRoutes.ts`), `apps/api/src/services/admin/routes.ts` (`ADMIN_SECTIONS` entry, `AdminRoutesOptions.diningPlan`, registration) |
| Seed | `apps/api/src/services/diningPlan/seed/locationRules.seed.json` |
| Migration | `apps/api/migrations/0075_dining_plan.sql` |
| Wiring | `apps/api/src/composeServices.ts` (a `diningPlan` options block beside `tripBudget`), `apps/api/src/server.ts` (register the plugin where `tripBudgetRoutes` is registered) |
| Mobile | `apps/mobile/src/screens/trips/TripDiningPlanScreen.tsx` and siblings, `apps/mobile/src/screens/trips/diningPlanApi.ts`, `apps/mobile/src/navigation/TripsStack.tsx`, `apps/mobile/src/screens/trips/TripDetailScreen.tsx` (hub tile), `TripDetailScreen.palette.ts` (tile colour), `TripsListScreen.tsx` (standalone entry) |

### Request flows

```
GET /trips/:id/dining-plan
  1. requireSession -> assertTripMember + can(role,'view_dining_plan')      (no dining-plan read before this)
  2. repo.loadTripCore(tripId)               trip start/end
     repo.loadScenario(tripId)               settings row + entries (2 statements)
     party = partyPort(tripId)               listMembers + listTripGuests + findNonVisibleParties + profiles
     repo.loadPlannedDiningReservations      planned_items dining rows not already linked
  3. ids = distinct experienceIds of entries + suggestions
     repo.loadLocations(ids)                 experiences (+grouped_facets, price_tier, name) joined to rules, then experience_menus (2 statements)
     repo.loadGlobals()                      price rows + config row (2 statements)
  4. computeDiningPlan(input)                pure
  5. respond DiningPlanDTO { settings, entries, party, stay, suggestions, result }
```

`GET` never writes, never goes to the network, never reads Redis (Requirement 16.5, 16.6). Every mutating route runs `BEGIN; SELECT id FROM trips WHERE id = $1 FOR UPDATE; ...; COMMIT`, applies the change, then performs the same read and compute as `GET` and returns the full `DiningPlanDTO`. The statement bound `DINING_PLAN_READ_MAX_STATEMENTS = 18` (19 once the Multi-Stay Extension adds the stays read; a starting ceiling to be measured and, if lower, pinned lower; it must not be raised without amending this design) covers: authorization 1 (+1 roster read for the interim organizer), trip row 1, scenario 2, members and guests and public-id and visibility reads about 5, profiles 1, reservations 1, locations 2, globals 2. **Constancy rules.** `loadLocations(ids)` runs its two `= ANY($1::uuid[])` statements, and `loadGlobals()` its two reads, unconditionally (even for an empty id list), as `tripBudget/repo.ts` does, so zero, one and a hundred entries issue the same statements. The existing `TripExpenseRepo.listTripGuests` issues one statement when the Trip has no guests and two when it has at least one (its public-id lookup is skipped for an empty list), and `TripRepo.listMembers` reads `active_trip_memberships` joined to `profile_identity` (public id; equal to the real user id for an active account, per `0064_account_deletion.sql`); the counting test therefore fixes the party (including at least one guest) across the cases it compares and states the bound for a party with guests. The guarding test wraps the pool in a counting proxy (every `pool.query` and every `query` of a client from `pool.connect()`), uses the real repo over pg-mem, and asserts equal counts for 1 entry and 100 entries.

*As built (task 8), pinned by `routes.statementCount.test.ts`:* the read path issues 16 statements for a Party that includes a guest: authorization 1, trip row 1, scenario 2, `listMembers` 1, `listTripGuests` 2 (the guest rows and their sponsors' public ids), `findNonVisibleParties` 2 (the guests' sponsors and the accounts that are not active), profiles 1, planned items 1, stays 1, locations 2, globals 2. While the Trip has no active Organizer, authorization reads the roster once more (17). `DINING_PLAN_READ_MAX_STATEMENTS` is therefore pinned at 17 (the starting ceiling was 19, and the constants listed below show the earlier values). The test uses the REAL party sources rather than a fake party port, so the pinned bound is the production count; it asserts the same statement list, table by table, for 1 and 100 entries and for 1 and 6 stays, no `INSERT`, `UPDATE`, `DELETE` or `BEGIN`, and no `fetch`. The module has no Redis dependency at all, which `sourceGuard.test.ts` pins structurally (no Redis or queue client import under `services/diningPlan/**`) in place of a fake Redis.

*Also as built (task 8):* the services are composed by `diningPlan/wiring.ts` (`createDiningPlanServiceFromRepos`), which `composeServices.ts` calls with `tripRepo`, `tripExpenseRepo` and `tripBudgetRepo` and which the route tests call with the same repos over pg-mem. The Trip routes authorize before parsing the body, so a non-member sending an invalid body still gets `trip_forbidden`. The export route is the exception: it parses its body first and the service authorizes (it checks two actions), so an invalid export body from a non-member answers `trip_validation_failed`; that answer depends only on the body, never on the Trip.

```
POST /dining-plan/calculate   (stateless)
  1. requireSession
  2. validate body (party <= 50, entries <= 120, nights <= 30)
  3. repo.loadLocations(ids), repo.loadGlobals()      (4 statements; unknown ids are dropped with a warning)
  4. computeDiningPlan(input)  ->  DiningPlanResultDTO
```

### Party assembly (Trip route)

The party is assembled from existing ports so no new raw `trip_memberships` read is added (guarded by `trip_memberships.guard.test.ts` and `roleReader.guard.test.ts`): `TripRepo.listMembers(tripId)` for members, `TripExpenseRepo.listTripGuests(tripId)` for guests, `findNonVisibleParties` to drop pending-deletion and deleted accounts, and one new `SELECT ... FROM trip_traveler_profiles WHERE trip_id = $1` for Age_Bracket and pass type. Person_Keys are `m:<id>` and `g:<id>` with ids in the public form the other Trip DTOs use (`accountDeletion/visibility.ts` `resolvePublicIds`). The executor SHALL confirm that an `active` account's public id equals its real id; if it does not, store real ids in `settings.alcoholDrinkerKeys` and `excluded_keys` and map at the boundary.

## Components and Interfaces

### Shared contracts (`@dwt/shared`, `packages/shared/src/diningPlan.ts`)

```ts
export const DINING_PLAN_CODES = ['quick_service', 'table_service', 'deluxe'] as const;
export type DiningPlanCode = (typeof DINING_PLAN_CODES)[number];
export const DINING_SCENARIO_CODES = ['none', ...DINING_PLAN_CODES] as const;
export type DiningScenarioCode = (typeof DINING_SCENARIO_CODES)[number];

/** Per Plan_Eligible_Person per night (Requirement 2.1). A mug is included in every plan. */
export const DINING_PLAN_ENTITLEMENTS_PER_NIGHT: Readonly<Record<DiningPlanCode, { ts: number; qs: number; snack: number }>> = {
  quick_service: { ts: 0, qs: 2, snack: 1 },
  table_service: { ts: 1, qs: 1, snack: 1 },
  deluxe: { ts: 2, qs: 1, snack: 1 },
};

export const DINING_MEAL_PERIODS = ['breakfast', 'lunch', 'dinner'] as const;
export const DINING_ORDER_STYLES = ['budget', 'typical', 'splurge', 'max_value'] as const;
export const DINING_ORDER_STYLE_PERCENTILE: Readonly<Record<DiningOrderStyle, number>> = { budget: 25, typical: 50, splurge: 85, max_value: 100 };
export const DINING_BEVERAGES = ['water', 'soft_drink', 'specialty'] as const;
export const DINING_STAY_TYPES = ['disney_resort_package', 'dvc_or_passholder_resort', 'not_disney_resort'] as const;
export const DINING_SERVICE_TYPES = ['table_service', 'quick_service', 'snack_only', 'not_eligible'] as const;
export const DINING_ENTRY_KINDS = ['restaurant', 'placeholder', 'skip'] as const;
export const DINING_PLACEHOLDER_KINDS = ['quick_service', 'table_service'] as const;
export const DINING_MENU_BASES = ['admin_override', 'menu_offer', 'menu_items', 'menu_estimate', 'tier_estimate', 'default_estimate'] as const;
export const DINING_VERDICTS = ['plan_saves', 'about_even', 'plan_costs_more', 'plan_unavailable'] as const;
export const DINING_UNAVAILABLE_REASONS = ['not_disney_resort', 'no_nights', 'stay_too_long', 'no_eligible_guests', 'no_price_for_dates'] as const;
export const DINING_COVERAGE = ['all', 'partial', 'none'] as const;
export const DINING_UNCOVERED_REASONS = ['not_eligible', 'no_matching_credits', 'better_use_elsewhere'] as const;

export const DINING_PLAN_PARTY_MAX = 50;
export const DINING_PLAN_ENTRIES_MAX = 120;
export const DINING_PLAN_MAX_NIGHTS = 30;
export const DINING_EVEN_FLOOR_CENTS = 2000;   // Even_Threshold floor
export const DINING_EVEN_BPS = 200;            // 2% of the No_Plan total
export const DINING_PLAN_READ_MAX_STATEMENTS = 18;
export const DINING_STANDALONE_DEBOUNCE_MS = 400;
```

Zod schemas (all `.strict()`):

```ts
export const diningPlanSettingsSchema = z.object({
  stay: z.object({ checkIn: tripCalendarDateSchema, checkOut: tripCalendarDateSchema }).strict().nullable().default(null),
  stayType: z.enum(DINING_STAY_TYPES).default('disney_resort_package'),
  orderStyle: z.enum(DINING_ORDER_STYLES).default('typical'),
  beverage: z.enum(DINING_BEVERAGES).default('soft_drink'),
  alcoholDrinkerKeys: z.array(personKeySchema).max(50).default([]),
  orderDessert: z.boolean().default(true),
  appetizersPerTable: z.number().int().min(0).max(4).default(0),
  snacksPerPersonPerDay: z.number().int().min(0).max(4).default(1),
  mugsWanted: z.number().int().min(0).max(DINING_PLAN_PARTY_MAX).default(0),
  kidsEatFree: z.boolean().default(true),
  tipBps: z.number().int().min(0).max(5000).nullable().default(null),
  taxBps: z.number().int().min(0).max(2500).nullable().default(null),
}).strict().superRefine(/* stay.checkOut >= stay.checkIn */);

const diningEntryFields = z.object({
  kind: z.enum(DINING_ENTRY_KINDS),
  experienceId: uuidSchema.nullable().default(null),
  placeholderKind: z.enum(DINING_PLACEHOLDER_KINDS).nullable().default(null),
  excludedKeys: z.array(personKeySchema).max(50).default([]),
}).strict();
/** restaurant => experienceId set, placeholderKind null; placeholder => placeholderKind set, experienceId null; skip => both null (mirrors chk_dpe_shape). */
const diningEntryShapeCheck = (v: z.infer<typeof diningEntryFields>, ctx: z.RefinementCtx): void => { /* adds an issue per violated rule */ };
export const diningPlanEntryBodySchema = diningEntryFields.superRefine(diningEntryShapeCheck);

export const diningPlanImportBodySchema = z.object({
  plannedItemIds: z.array(uuidSchema).min(1).max(DINING_PLAN_ENTRIES_MAX).optional(),  // omitted = all suggestions
  overwrite: z.boolean().default(false),
}).strict();

export const diningCalculateBodySchema = z.object({
  party: z.array(z.object({
    key: personKeySchema, label: z.string().trim().min(1).max(60),
    ageBracket: z.enum(AGE_BRACKETS), passType: z.enum(TRAVELER_PASS_TYPES).default('none'),
  }).strict()).min(1).max(DINING_PLAN_PARTY_MAX),
  stay: z.object({ checkIn: tripCalendarDateSchema, checkOut: tripCalendarDateSchema }).strict(),
  settings: diningPlanSettingsSchema,
  entries: z.array(
    diningEntryFields
      .extend({ date: tripCalendarDateSchema, mealPeriod: z.enum(DINING_MEAL_PERIODS) })
      .superRefine(diningEntryShapeCheck),
  ).max(DINING_PLAN_ENTRIES_MAX),
}).strict();
// personKeySchema = z.string().regex(/^[mg]:[A-Za-z0-9_-]{1,64}$/)

export const diningConfigSchema = z.object({ /* every key of DINING_CONFIG_DEFAULTS, with the bounds in Configuration & Constants */ }).strict();
export type DiningConfig = z.infer<typeof diningConfigSchema>;
```

DTOs (interfaces, `readonly`):

```ts
export interface DiningPartyPersonDTO { key: string; label: string; ageBracket: AgeBracket; passType: TravelerPassType }
export interface DiningStayDTO { checkIn: string; checkOut: string; nights: number; days: number; source: 'trip' | 'custom' }
export interface DiningEntryDTO { date: string; mealPeriod: DiningMealPeriod; kind: DiningEntryKind; experienceId: string | null; experienceName: string | null;
  placeholderKind: DiningPlaceholderKind | null; plannedItemId: string | null; excludedKeys: string[] }
export interface DiningSuggestionDTO { plannedItemId: string; experienceId: string; experienceName: string; date: string; mealPeriod: DiningMealPeriod;
  source: 'reservation' | 'planned_item'; partySizeMismatch: boolean; alreadyHasEntry: boolean }

export interface DiningMealLineDTO {          // per Dining_Entry, per scenario
  date: string; mealPeriod: DiningMealPeriod; kind: DiningEntryKind; experienceId: string | null; label: string;
  serviceType: DiningServiceType; creditCost: 1 | 2; gratuityIncluded: boolean; twoCredit: boolean;
  basis: DiningMenuBasis; ruleBasis: 'verified' | 'unverified' | 'derived'; unverifiedRule: boolean /* true iff ruleBasis === 'unverified' */; dinerCount: number;
  perDinerFoodCents: { adult: number | null; child: number | null };     // pre-tax, after pass discount, before coverage
  coverage: DiningCoverage; creditsUsedPerDiner: number; coveredDinerCount: number;
  savingsCents: number; outOfPocketCents: number;                           // outOfPocket = food + tax + extras + tip actually paid for this entry
  action: 'use_plan' | 'partly_covered' | 'pay_out_of_pocket' | 'not_applicable'; reason: DiningUncoveredReason | null;
}
export interface DiningCreditSummaryDTO { ts: CreditCount; qs: CreditCount; snack: CreditCount; snacksPerDayToUseAll: number; mugsCovered: number }
export interface CreditCount { issued: number; used: number; unused: number }
export interface DiningScenarioResultDTO {
  code: DiningScenarioCode; displayName: string; available: boolean; unavailableReason: DiningUnavailableReason | null;
  planCostCents: number; promoLabel: string | null;
  foodOutOfPocketCents: number; taxCents: number; tipCents: number; snackOutOfPocketCents: number; mugOutOfPocketCents: number;
  totalCents: number; netSavingsCents: number;        // net = noPlan.totalCents - totalCents; 0 for 'none'
  credits: DiningCreditSummaryDTO | null; meals: DiningMealLineDTO[]; bestCreditUses: { date: string; mealPeriod: DiningMealPeriod; label: string; savingsCents: number }[];
  priceVerifiedAt: string | null;                      // latest verified_at among periods in use, null if any is unverified
}
export interface DiningPlanResultDTO {
  computedForDate: string;                 // WDW_Today passed in
  stay: DiningStayDTO; eligibleCount: number; scenarios: DiningScenarioResultDTO[];     // order: none, quick_service, table_service, deluxe
  recommended: DiningScenarioCode; verdict: DiningVerdict; bestPlan: DiningPlanCode | null; evenThresholdCents: number; breakEvenGapCents: number;
  sensitivity: { orderStyle: DiningOrderStyle; bestPlan: DiningPlanCode | null; netSavingsCents: number }[];
  dataQuality: { byBasis: Record<DiningMenuBasis, number>; estimatedEntries: number; unverifiedRules: number; derivedRules: number; unverifiedPrices: number; outsideStayEntries: number };
  assumptions: { taxBps: number; taxIsDefault: boolean; tipBps: number; tipIsDefault: boolean; planPricesIncludeTax: boolean; passDiscountBps: number | null; pricesAsOf: string | null };
  warnings: { code: 'outside_stay' | 'unknown_experience' | 'party_size_mismatch' | 'no_entries'; date?: string; mealPeriod?: DiningMealPeriod }[];
}
export interface DiningPlanDTO { settings: DiningPlanSettings; entries: DiningEntryDTO[]; party: DiningPartyPersonDTO[]; stay: DiningStayDTO; suggestions: DiningSuggestionDTO[]; suggestionsNeedingMealPeriod: number; result: DiningPlanResultDTO }
export interface DiningPlanImportResultDTO { plan: DiningPlanDTO; created: number; skippedExisting: number; skippedOutOfStay: number }
```

`menuPricing.ts` additive exports (existing exports untouched; the existing module-private regexes are reused):

```ts
export type MenuGroupClass = 'entree' | 'kids' | 'dessert' | 'appetizer' | 'beverage' | 'alcohol' | 'other';
/** Classifies a menu group by its `type` and `name`. Order: alcohol, kids, dessert, appetizer, beverage, entree, other. */
export function classifyMenuGroup(group: { name?: string | null; type?: string | null }): MenuGroupClass;
/** Representative integer cents of one item (single price, or the mean of variants, or the parsed price string); null when unpriced. Wraps the existing private resolveItemRepresentativeCents. */
export function menuGroupItemCents(item: MenuItemDTO): number | null;
```

Group classification regexes (case-insensitive over `type + ' ' + name`): alcohol `/alcohol|cocktail|wine|beer|spirit/`; kids `/kid|child/`; dessert `/dessert|sweet/`; appetizer `/appetizer|starter|small plate|shareable/`; beverage `/beverage|drink|soda|coffee|tea/`; entree reuses `ENTREE_GROUP_REGEX` and `!NON_ENTREE_GROUP_REGEX`. The first match in the stated order wins.

*As built (task 1.2), three corrections to the patterns above, each pinned by `menuGroupClass.test.ts`:* (1) the beverage pattern matches `tea` only as a word (`\btea\b|\bteas\b`), because the plain `tea` also matched "Steaks" and "Steakhouse", which would have classified a steak group as a beverage before the entree test; (2) the alcohol test runs on the text with alcohol-free wording removed (`non-alcoholic`, `alcohol-free`, `zero-proof`, `mocktail(s)`), because "Non-Alcoholic Drinks" otherwise matched `alcohol` and would have priced a soft drink at the alcohol price; (3) the beverage pattern also matches `mocktail`.

### Engine modules (`apps/api/src/services/diningPlan/engine/`)

All pure. Money is integer cents; every rounding uses `bpsOf` (half up) or `splitCentsEvenly`.

| File | Function | Responsibility |
| --- | --- | --- |
| `stay.ts` | `nightsOf(checkIn, checkOut): string[]`, `daysInclusive(checkIn, checkOut): number`, `isInStay(date, stay)` | Date arithmetic via `ticketPrices/dates.ts` (`addDays`, `daysBetween`). Nights are `checkIn .. checkOut-1`. |
| `percentile.ts` | `pickPercentile(sortedAsc: number[], p: number): number \| null` | Nearest-rank: `i = clamp(ceil(p / 100 * n) - 1, 0, n - 1)`; null for an empty list. |
| `locationRules.ts` | `deriveServiceType(groupedFacets)`, `resolveLocationRule(rule, location): ResolvedRule` | Requirement 8.1 to 8.3, 8.6. |
| `menuSelect.ts` | `menusForPeriod(menus, period)`, `groupCents(menus, cls, audience)` | Meal-period menu filter and sorted price lists per `MenuGroupClass`, via `classifyMenuGroup` and `menuGroupItemCents`. |
| `mealValuation.ts` | `valueEntry(entry, location, ctx): EntryValuation` | Requirement 7: basis precedence, per-diner food, extras. |
| `planPrice.ts` | `nightPrice(rows, plan, date)`, `planCost(input): { cents; promoLabel; unavailable? }` | Requirement 2, 13.2. |
| `allocateCredits.ts` | `allocateCredits(items, capacity): Set<string>` | Requirement 10. |
| `scenario.ts` | `evaluateScenario(code, ctx): DiningScenarioResultDTO` | Per-person allocation, snacks, mugs, totals, per-meal lines. |
| `compare.ts` | `compareScenarios(scenarios, noPlan): { recommended; verdict; bestPlan; breakEvenGapCents; evenThresholdCents }` | Requirement 13.4 to 13.7. |
| `computeDiningPlan.ts` | `computeDiningPlan(input): DiningPlanResultDTO` | Orchestrates; runs the 4 sensitivity passes. |
| `reservations.ts` | `mealPeriodOfReservation(...)`, `suggestFromPlannedItems(...)` (reservations and Planned_Restaurants, with `source` and the needs-a-meal-period count) | Requirement 5.1 to 5.3, 5.7 to 5.10. |
| `budgetExport.ts` | `buildBudgetExport(input): BudgetExportPlan` | Requirement 26: pure builder of the export lines from a result with per-Person amounts, the Combination, the Budget tax rate and the existing exported lines. |

#### Engine input

```ts
export interface EnginePerson { key: string; label: string; ageBracket: AgeBracket; passType: TravelerPassType }
export interface EngineEntry { date: string; mealPeriod: DiningMealPeriod; kind: DiningEntryKind; experienceId: string | null;
  placeholderKind: DiningPlaceholderKind | null; excludedKeys: readonly string[] }
export interface EngineLocation { experienceId: string; name: string; priceTier: string | null; groupedFacets: Record<string, unknown>;
  menus: readonly MenuDTO[] | null; rule: LocationRuleRow | null }
export interface EnginePriceRow { planCode: DiningPlanCode; displayName: string; validFrom: string; validTo: string; adultCents: number; childCents: number;
  childPromoCents: number | null; promoLabel: string | null; verifiedAt: string | null }
export interface EngineInput { persons: readonly EnginePerson[]; stay: { checkIn: string; checkOut: string; source: 'trip' | 'custom' };
  settings: DiningPlanSettings; entries: readonly EngineEntry[]; locations: ReadonlyMap<string, EngineLocation>;
  priceRows: readonly EnginePriceRow[]; config: DiningConfig; today: string }
```

#### Meal valuation (the formulas)

For each entry that is not `skip`, in-stay and with at least one Diner, `valueEntry` resolves the location (`placeholder` entries use a synthetic location: `serviceType = placeholderKind`, no menus, no rule, basis `default_estimate`):

1. **Rule.** `resolveLocationRule` returns `{ serviceType, creditCost, creditCostByPeriod, gratuityIncluded, passDiscountEligible, overrideAdultCents, overrideChildCents, status }`, and `creditCostFor(rule, mealPeriod)` is `creditCostByPeriod[mealPeriod] ?? creditCost`; the allocation uses `creditCostFor(rule, entry.mealPeriod)` as an item's weight (Requirement 8.8). With no rule row, or a NULL `service_type`, `serviceType = deriveServiceType(groupedFacets)`, which returns `not_eligible` first for a lounge-only location (`tableService` facets `lounges` plus only booking or drinks facets, Requirement 8.11, Property 44; `isLoungeOnly` in `locationRules.ts`). Derived: `creditCost 1`, `gratuityIncluded false`, `status 'derived'` (not stored, counted in `dataQuality.derivedRules`, never in `unverifiedRules`, and it does not trigger the "Estimated" headline; a stored row with `rule_status = 'unverified'` has status `unverified`). A rule row with `rule_status = 'verified'` has status `verified`.
2. **Audience prices.** For `audience` in `adult`, `child` (computed only if some Diner has that bracket), and per drink class (`alcohol` for a Diner in `alcoholDrinkerKeys`, otherwise the scenario `beverage`), the base `foodCents` is the first of:
   - **a. `admin_override`**: `overrideAdultCents` / `overrideChildCents` if set for the audience. All-in price.
   - **b. `menu_offer`**: `extractMenuPriceOffers(menusForPeriod(...))`. Adult uses offers with audience `adult` or `person`; child uses `child`, falling back to the adult price times `childFallbackBps`. If several offers apply, take `pickPercentile` of their prices at the Order_Style percentile. All-in price.
   - **c. `menu_items`** (requires at least one priced entree in the audience's group, or for `child` the adult entree list with the fallback): `entree = pickPercentile(entrees, p)`; for `table_service` with `orderDessert`: `dessert = pickPercentile(desserts, p) ?? config.dessertCents`; `beverage` = 0 for `water`, `softDrinkCents`, `specialtyBeverageCents`, and for an alcohol drinker `median(alcohol group prices) ?? alcoholBeverageCents`, except that the alcohol price applies only when `serviceType === 'table_service'` or the Meal_Period is not `breakfast` (a quick-service breakfast uses the scenario `beverage` for the drinker too, because almost no one orders a cocktail at a counter-service breakfast and it would inflate the plan's covered value by about $8.50 per adult per breakfast). `foodCents = entree + dessert + beverage`. A quick-service meal is `entree + beverage`.
   - **d. `menu_estimate`**: `computeMenuEstimatePerPerson(menus).perPersonCents`. All-in price.
   - **e. `tier_estimate`**: `config.tierEstimates[serviceType][tierLevel]` where `tierLevel = clamp(count of leading '$' in priceTier, 1, 4)`; only if `priceTier` parses. All-in price.
   - **f. `default_estimate`**: `placeholderTsCents` for `table_service`, `placeholderQsCents` for `quick_service`. All-in price.
   - For `child`, bases a/b/e/f that yield only an adult figure use `bpsOf(adult, childFallbackBps)`.
3. **Pass discount.** If the Party has a pass holder, the rule's `passDiscountEligible !== false`, and `serviceType` is `table_service` or `quick_service`: `foodNet = foodCents - bpsOf(foodCents, passDiningDiscountBps)`; else `foodNet = foodCents`.
4. **Extras (appetizers, table service only).** `extrasTable = appetizersPerTable * appetizerPrice` where `appetizerPrice = median(appetizer group prices) ?? appetizerCents`; the table total is split across the Diners with `splitCentsEvenly(extrasTable, dinerCount)` (Diners in Party order); each share gets the same pass discount: `extraNet`.
5. **Tax and tip per Diner.** `taxFood = bpsOf(foodNet, taxBps)`, `taxExtra = bpsOf(extraNet, taxBps)`, `tip = serviceType === 'table_service' ? bpsOf(foodNet + extraNet, tipBps) : 0`.
6. **Savings of covering one Diner's meal**: `foodNet + taxFood + (gratuityIncluded ? tip : 0)`.

A `snack_only` location produces no meal valuation; it adds one snack per Diner to snack demand (Requirement 4.9). A `not_eligible` location is valued like `quick_service` for its price but is never coverable.

#### Allocation

Per Plan_Eligible_Person `p` and plan `P` with `n` = number of nights:

```
capacity.ts = n * ENT[P].ts ;  capacity.qs = n * ENT[P].qs
items = for each entry p dines at, in (date, mealPeriod) order, with serviceType 'table_service' or 'quick_service':
          { id, kind: 'ts' | 'qs', weight: kind==='ts' ? creditCost : 1, savingsCents, order }
allocateCredits(items, capacity):
   ts: items with kind 'ts', weight <= capacity.ts, savings > 0.
       suffix DP: f[i][w] = max savings from items i.. with capacity w;
       f[n][*] = 0; f[i][w] = max(f[i+1][w], savings_i + f[i+1][w - weight_i]) if weight_i <= w.
       reconstruct from i = 0, w = capacity.ts: take item i iff weight_i <= w and savings_i + f[i+1][w - weight_i] >= f[i+1][w] and savings_i > 0.
       (">=" with the forward order makes ties cover earlier meals.)
   qs: sort by savings desc, then order asc; take the first capacity.qs with savings > 0.
```

The state space is at most 120 x 60 per person per plan. Persons with identical brackets, drink class and Diner membership produce identical results; the implementation MAY memoize by that signature (an optimization that must not change results; Property 6 covers it).

#### Scenario totals

For scenario `S` (`none` or plan `P`), over Plan_Eligible_Persons and in-stay entries:

```
planCost        = Σ_nights Σ_eligible persons price(P, night, bracket, promo)       (0 for none)
                  [+ bpsOf(planCost, taxBps) when !config.planPricesIncludeTax]
for each (entry, diner):
   covered?     = diner in allocation(P)             (false for none)
   foodOop     += covered ? 0 : foodNet
   taxOop      += (covered ? 0 : taxFood) + taxExtra
   foodOop     += extraNet                             (extras are never covered)
   tip         += (covered && gratuityIncluded) ? 0 : tip_d
snacks:  demand_p = snacksPerPersonPerDay * days + snackOnlyEntries_p
         covered_p = min(demand_p, nights * ENT[P].snack)               (0 for none or under3)
         snackOop += (demand_p - covered_p) * snackCents + bpsOf((demand_p - covered_p) * snackCents, taxBps)
mugs:    uncoveredMugs = mugsWanted - (plan ? min(mugsWanted, eligibleCount) : 0)
         mugOop = uncoveredMugs * mugCents + bpsOf(uncoveredMugs * mugCents, taxBps)
totalCents = planCost + foodOop + taxOop + tip + snackOop + mugOop
```

A Person with Age_Bracket `under3` is not a Diner, has no snack or mug demand, and contributes nothing to any scenario. Only Plan_Eligible_Persons (adult and child) are Diners.

*As built (task 5.5), two refinements, each pinned by `scenario.test.ts`:* (1) each out-of-pocket snack and mug is taxed as its own purchase, `snackOop = uncovered x (snackCents + bpsOf(snackCents, taxBps))` and the same for mugs, instead of `bpsOf` on a Person's uncovered total. Rounding a total is not additive (at 650 bps and 650 cents, a second snack adds 43 cents of tax while a seventh adds 42), so with the total form one more snack-only entry could lower a plan's net savings by a cent and break Property 7; a mutation test with the total form fails Property 7. Per-snack tax also matches Requirement 12.1 ("per line"). (2) A `snack_only` entry appears in `meals` as a line with `serviceType 'snack_only'`, one credit per covered Diner, savings and out-of-pocket at the per-snack price, and basis `default_estimate` (the snack price is the configured `snackCents`); a Person's snack credits cover their snack-only entries first, then the daily snacks. Property 27's "sum of savingsCents over all meals" is over the non-snack lines; the snack lines' savings are the "covered snacks" term.

#### Comparison and verdict

```
noPlan = scenarios['none']
available = scenarios.filter(s => s.code !== 'none' && s.available)
for each: netSavingsCents = noPlan.totalCents - s.totalCents
best      = argmax(netSavingsCents) over available (ties: quick_service, table_service, deluxe)
threshold = max(DINING_EVEN_FLOOR_CENTS, bpsOf(noPlan.totalCents, DINING_EVEN_BPS))
verdict   = available.length === 0 ? 'plan_unavailable'
          : best.net >  threshold ? 'plan_saves'
          : |best.net| <= threshold ? 'about_even' : 'plan_costs_more'
recommended = verdict === 'plan_saves' ? best.code : 'none'
breakEvenGapCents = best ? max(0, best.totalCents - noPlan.totalCents) : 0
```

`sensitivity` re-runs `computeDiningPlan` internally for each Order_Style with every other input unchanged and records `{ orderStyle, bestPlan, best.net }`; the row for the current Order_Style equals the main result (Property 26).

### Reservation meal period

`mealPeriodOfReservation({ mealPeriod, plannedTimeIso, date })`: returns `mealPeriod` when it is one of the three; otherwise `m = wdwMinutesFromMidnight(date, plannedTimeIso)`; `m < 660 -> 'breakfast'`, `m < 960 -> 'lunch'`, else `'dinner'`. `'snack'` or null with no time returns null (suggestion omitted).

### Service, repo and routes

`createDiningPlanService({ pool, repo, partyPort, now })` returns `getPlan`, `putSettings`, `putEntry`, `deleteEntry`, `importReservations`, `calculateStateless`. `partyPort` is a structural interface (`listMembers`, `listTripGuests`, `findNonVisible`) wired in `composeServices.ts` to the existing trips and tripExpenses repos, so tests substitute fakes. `routes.ts` exports `diningPlanRoutes(options): FastifyPluginAsync` with `{ pool, service, requireSession }`, using `parseOrAppError` from `tripExpenses/routes.ts`, and registers the five Trip routes and the stateless route. Errors use the existing envelope: `trip_forbidden` (non-member and unknown Trip), `trip_validation_failed` (Trip routes), `validation_failed` (stateless).

### Admin_Panel

`AdminDiningPlanPort` (type-only, `services/diningPlan/adminPort.ts`) with `readState()`, `listLocations({ q, filter, limit, offset })`, `getLocation(experienceId)`, `savePrice(input)`, `deletePrice(id)`, `saveConfig(values)`, `resetConfig()`, `saveRule(experienceId, input)`, `deleteRule(experienceId)`, `applySeed()`. `registerDiningPlanRoutes(fastify, options)` follows `ticketPriceRoutes.ts` exactly for auth, same-origin, headers, `escapeHtml`, `renderPage` and flash redirects:

| Route | Method | Action |
| --- | --- | --- |
| `/admin/dining-plan` | GET | Dashboard: plan prices table and add form; defaults table with edit form; coverage metrics; link to locations |
| `/admin/dining-plan/prices` | POST | Create or update one price period (validated, overlap-checked) |
| `/admin/dining-plan/prices/:id/delete` | POST | Delete one period |
| `/admin/dining-plan/config` | POST | Save defaults (validated by `diningConfigSchema`); `reset=1` clears the stored values |
| `/admin/dining-plan/locations` | GET | Search (`q`), filter (`needs_review`, `has_rule`, `all`), paged list with derived and effective Service_Type |
| `/admin/dining-plan/locations/:experienceId` | GET / POST | Edit form / save rule; `POST .../delete` removes the rule |
| `/admin/dining-plan/seed` | POST | Apply `locationRules.seed.json` (Requirement 18.8, 8.10) and render the per-entry result page (`inserted`, `updated`, `kept`, `unmatched`, `ambiguous`; Requirement 18.10) |

`ADMIN_SECTIONS` gains `{ path: '/admin/dining-plan', title: 'Dining Plan Calculator', category: 'Data Ingestion & External Sync', icon: '🍽️', badge: 'Curated Rules' }`, added when `options.diningPlan` is supplied, the same way the ticket-price section is.

*As built (task 9), pinned by `adminForms.test.ts`, `seedRules.test.ts`, `adminRepo.test.ts` and `services/admin/__tests__/diningPlanRoutes.test.ts`:*

- **Modules.** The port is `diningPlan/adminPort.ts`; the implementation is `diningPlan/adminRepo.ts` (`createDiningPlanAdminRepo({ pool, logger, seed? })`); the pure parts are `diningPlan/admin/forms.ts` (form parsing, the overlap check, the config diff), `diningPlan/admin/views.ts` (coverage and list rows) and `diningPlan/seed/seedRules.ts` (normalization, matching, the seed plan).
- **The seed file ships in the build.** `seed/bundledSeed.ts` imports `locationRules.seed.json` with `with { type: 'json' }`, so `tsc` emits the JSON into `dist/` beside it (checked with a build: the file is emitted and the module loads). Reading it from `src/` at runtime would fail on Render, which runs `dist/`.
- **Seed entries carry the catalog's `upstreamEntityId`.** Each was looked up in the dev catalog (2026-11-10), so matching is by id first; the names and aliases are kept for a catalog without the id. Against the dev catalog 30 of the 31 entries match; Wolfgang Puck Bar & Grill is inactive there and is reported `unmatched`, which is the intended outcome for a closed restaurant.
- **`kept` also covers "already matches".** When a stored rule already holds the seed's values the seed writes nothing and reports `kept` with the reason "The stored rule already matches the seed", besides the reason for a verified rule. This is what makes a second run leave the table identical to one run, `updated_at` included (Property 40). The seed writes only the columns it owns (service type, credit cost, period map, gratuity, status, verified date, note); the per-person overrides and the pass-discount flag are left as the operator set them.
- **"Seeded and unverified" without a new column.** The filter lists rules whose status is `unverified` and whose `source_note` equals the note of a seed entry. An operator who edits the note has reviewed the row, so it leaves the filter. No migration is needed.
- **Forms.** Prices and per-person overrides are typed in dollars and stored in cents; config values are typed as integers (cents, basis points) and the tier estimates as eight fields. Saving the config stores only the keys that differ from `DINING_CONFIG_DEFAULTS`, so a later change to a default still applies where the operator kept it; `reset=1` stores `{}`. The location list reads the active Restaurant Experiences in one statement and searches, filters and pages in memory, so the search ignores accents and punctuation ("citricos" finds "Cítricos").
- **Form bodies.** The section registers in a child scope that parses `application/x-www-form-urlencoded`; the server's catch-all parser would otherwise drop an HTML form body. The other admin routes keep their behavior.
- **Known limit.** The overlap check locks the plan's existing periods (`FOR UPDATE`) but cannot lock a period that does not exist yet, so two operators adding overlapping periods at the same instant could both succeed. The Admin_Panel has one operator; the unique `(plan_code, valid_from)` index still stops two identical starts.

### Mobile

| File | Role |
| --- | --- |
| `diningPlanApi.ts` | `diningPlanKeys`, `fetchDiningPlan`, `putDiningSettings`, `putDiningEntry`, `deleteDiningEntry`, `importDiningReservations`, `calculateDining` (stateless), mutation hooks that set the query cache from the returned `DiningPlanDTO` |
| `diningPlanView.ts` | Pure formatting: `verdictHeadline(result)`, `scenarioRows(result)`, `slotLabel(entry)`, `actionLabel(line)`, `qualityNotice(result)`; no arithmetic on totals |
| `TripDiningPlanScreen.tsx` | The screen of Requirement 19 |
| `DiningSlotSheet.tsx` | Choose restaurant (reuses `ExperiencePicker` restricted to category `Restaurant`), typical quick-service or table-service meal, skip, and exclude Diners |
| `DiningSettingsSheet.tsx` | Settings of Requirement 6 |
| `DiningCompareCard.tsx`, `DiningMealList.tsx` | Comparison table and per-meal actions |
| `DiningPlanCalculatorScreen.tsx` | Standalone screen (Requirement 20), local state, debounced `calculateDining` |
| `*.palette.ts` | One-off colours per the theming convention |

Hub integration: `HUB_SECTION_DEFS` gets `{ key: 'diningPlan', route: 'TripDiningPlan', title: 'Dining Plan', body: 'Is the dining plan worth it? Compare plans for your meals.', icon: 'restaurant-outline' }` after `budget`; `HUB_SECTION_COLOR` gets `diningPlan` in both schemes; the pinned `tripStructureRegression` snapshot and any hub-count assertion are updated in the same task. `TripsStack` adds `TripDiningPlan: { tripId: string }` and `DiningPlanCalculator: undefined`.

## Data Models

Migration `0075_dining_plan.sql` (`trip-lodging-stays` is built first and reserves `0073` and `0074`; re-list `apps/api/migrations/` before creating it; the highest existing file at spec time is `0072_hidden_mickeys.sql`; shift the number and the `migration0075.test.ts` name together if another migration lands first). The file runs under the pg-mem migration helper `buildMigratedDb()`, so it avoids `jsonb_array_length` (not registered there; the 50-key limit is enforced by Zod and the repo), `NULLS LAST` in an index, and non-unique partial indexes.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS dining_plan_prices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code         TEXT NOT NULL CHECK (plan_code IN ('quick_service','table_service','deluxe')),
  display_name      VARCHAR(80) NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  valid_from        DATE NOT NULL,
  valid_to          DATE NOT NULL,
  adult_cents       INTEGER NOT NULL CHECK (adult_cents BETWEEN 1 AND 100000),
  child_cents       INTEGER NOT NULL CHECK (child_cents BETWEEN 0 AND 100000),
  child_promo_cents INTEGER CHECK (child_promo_cents IS NULL OR child_promo_cents BETWEEN 0 AND 100000),
  promo_label       VARCHAR(80),
  source_note       VARCHAR(200),
  verified_at       DATE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_dining_plan_prices_range CHECK (valid_to >= valid_from),
  CONSTRAINT chk_dining_plan_prices_promo CHECK (child_promo_cents IS NULL OR promo_label IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dining_plan_prices_start ON dining_plan_prices (plan_code, valid_from);

CREATE TABLE IF NOT EXISTS dining_plan_location_rules (
  experience_id          UUID PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
  service_type           TEXT CHECK (service_type IS NULL OR service_type IN ('table_service','quick_service','snack_only','not_eligible')),
  credit_cost            SMALLINT NOT NULL DEFAULT 1 CHECK (credit_cost IN (1, 2)),
  credit_cost_by_period  JSONB CHECK (credit_cost_by_period IS NULL OR jsonb_typeof(credit_cost_by_period) = 'object'),   -- {"dinner": 2}; values 1|2 and keys breakfast|lunch|dinner enforced by Zod and the repo
  gratuity_included      BOOLEAN NOT NULL DEFAULT FALSE,
  pass_discount_eligible BOOLEAN,
  per_person_adult_cents INTEGER CHECK (per_person_adult_cents IS NULL OR per_person_adult_cents BETWEEN 1 AND 100000),
  per_person_child_cents INTEGER CHECK (per_person_child_cents IS NULL OR per_person_child_cents BETWEEN 1 AND 100000),
  rule_status            TEXT NOT NULL DEFAULT 'unverified' CHECK (rule_status IN ('verified','unverified')),
  verified_at            DATE,
  source_note            VARCHAR(200),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_dpl_credit_cost CHECK (credit_cost = 1 OR service_type = 'table_service'),
  CONSTRAINT chk_dpl_gratuity    CHECK (NOT gratuity_included OR service_type = 'table_service'),
  CONSTRAINT chk_dpl_period_cost CHECK (credit_cost_by_period IS NULL OR service_type = 'table_service'),
  CONSTRAINT chk_dpl_verified    CHECK (rule_status <> 'verified' OR verified_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS dining_plan_config (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO dining_plan_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS trip_dining_plan_scenarios (
  trip_id    UUID PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trip_dining_plan_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id          UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  entry_date       DATE NOT NULL,
  meal_period      TEXT NOT NULL CHECK (meal_period IN ('breakfast','lunch','dinner')),
  kind             TEXT NOT NULL CHECK (kind IN ('restaurant','placeholder','skip')),
  experience_id    UUID REFERENCES experiences(id) ON DELETE CASCADE,
  placeholder_kind TEXT CHECK (placeholder_kind IS NULL OR placeholder_kind IN ('quick_service','table_service')),
  planned_item_id  UUID REFERENCES planned_items(id) ON DELETE SET NULL,
  excluded_keys    JSONB NOT NULL DEFAULT '[]'::jsonb
                   CHECK (jsonb_typeof(excluded_keys) = 'array'),   -- the 50-key limit is enforced by Zod and the repo
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_dpe_shape CHECK (
    (kind = 'restaurant'  AND experience_id IS NOT NULL AND placeholder_kind IS NULL) OR
    (kind = 'placeholder' AND experience_id IS NULL AND placeholder_kind IS NOT NULL) OR
    (kind = 'skip'        AND experience_id IS NULL AND placeholder_kind IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dpe_slot ON trip_dining_plan_entries (trip_id, entry_date, meal_period);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dpe_planned_item ON trip_dining_plan_entries (trip_id, planned_item_id) WHERE planned_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dpe_planned_item ON trip_dining_plan_entries (planned_item_id);   -- plain index: a non-unique partial index would make pg-mem hide NULL rows

-- Seed price periods (see Configuration & Constants). Re-applying inserts nothing.
INSERT INTO dining_plan_prices
  (plan_code, display_name, valid_from, valid_to, adult_cents, child_cents, child_promo_cents, promo_label, source_note, verified_at)
VALUES
  ('quick_service', 'Disney Quick-Service Dining Plan', '2026-01-01', '2026-12-31', 6047, 2616, 0, 'Kids Eat Free 2026', 'Adult: plandisney.disney.go.com Q&A. Child and promotion: Pixie Vacations (2026-11). Verify.', NULL),
  ('table_service', 'Disney Dining Plan', '2026-01-01', '2026-12-31', 9859, 3194, 0, 'Kids Eat Free 2026', 'Adult: plandisney.disney.go.com Q&A. Child and promotion: Pixie Vacations (2026-11). Verify.', NULL),
  ('quick_service', 'Quick-Service Dining Plan', '2027-01-01', '2027-12-31', 6278, 2582, NULL, NULL, 'Pixie Vacations citing TouringPlans and AllEars (2026-11). Verify.', NULL),
  ('table_service', 'Table-Service Dining Plan', '2027-01-01', '2027-12-31', 9987, 3194, NULL, NULL, 'Pixie Vacations citing TouringPlans and AllEars (2026-11). Verify.', NULL),
  ('deluxe', 'Deluxe Table-Service Dining Plan', '2027-01-01', '2027-12-31', 16301, 4685, NULL, NULL, 'Pixie Vacations citing TouringPlans (2026-11). Verify.', NULL)
ON CONFLICT (plan_code, valid_from) DO NOTHING;

COMMIT;
```

*As built (task 3):* the three service-type CHECKs read `... OR (service_type IS NOT NULL AND service_type = 'table_service')`. As written above, a NULL ("derive") `service_type` makes the comparison NULL, which a CHECK treats as passing, so a rule with `credit_cost = 2`, `gratuity_included` or a period map and no service type was accepted; if that location then derives as quick-service it would cost two credits, contradicting Requirement 8.3 and Property 15. `migration0075.test.ts` pins all three cases.

Notes on the DDL: the unique index on `(plan_code, valid_from)` is a plain unique index, so `ON CONFLICT (plan_code, valid_from)` works on pg-mem and Postgres. The partial unique index `uq_dpe_planned_item` is never the target of an `ON CONFLICT`; the import checks inside the locked transaction instead (see the memory note on pg-mem and partial-index conflicts). Overlap between two periods of the same plan cannot be a SQL constraint portable to pg-mem; the repo and the Admin_Panel check it and Property 24 pins it. Entries reference `planned_items` and `experiences`; neither table's rows are ever hard-deleted in normal operation, and `ON DELETE CASCADE` on `experience_id` keeps the entry shape constraint valid if one is.

### Stored settings and entries

`trip_dining_plan_scenarios.settings` holds exactly the `diningPlanSettingsSchema` object (all keys optional in storage; missing keys take the schema defaults on read). The repo validates on write and tolerates missing keys on read. `trip_dining_plan_entries` holds one row per Dining_Entry; there is no entry for an empty slot.

## Configuration & Constants

No environment variables are added; nothing here is a secret or a base URL. The tunables are database-backed and editable in the Admin_Panel. `DINING_CONFIG_DEFAULTS` lives in `@dwt/shared`; a missing key in `dining_plan_config.config` falls back to it, and the Admin_Panel shows the default beside the stored value. Starting values (every `ASSUMPTION` is shown as an estimate in the UI and should be revisited against real receipts):

| Key | Default | Bounds | Basis |
| --- | --- | --- | --- |
| `taxBps` | 650 | 0 to 2500 | Same as `BUDGET_DEFAULT_TAX_BPS.dining` (itself an assumption) |
| `tipBps` | 1800 | 0 to 5000 | Same as `BUDGET_DEFAULT_DINING_TIP_BPS` (assumption) |
| `planPricesIncludeTax` | true | boolean | Third-party reports and Disney Q&A state plan prices include tax; confirm in the booking flow |
| `mugCents` | 2299 | 0 to 10000 | Out-of-pocket price of the resort refillable mug, plus tax (WDW Prep School, WDWNT, DisneyDining, 2026-27) |
| `snackCents` | 650 | 0 to 5000 | ASSUMPTION: single-serving snack |
| `softDrinkCents` | 450 | 0 to 3000 | ASSUMPTION |
| `specialtyBeverageCents` | 750 | 0 to 3000 | ASSUMPTION |
| `alcoholBeverageCents` | 1300 | 0 to 5000 | ASSUMPTION: typical beer, wine or cocktail |
| `dessertCents` | 1000 | 0 to 5000 | ASSUMPTION: used when a menu has no dessert group |
| `appetizerCents` | 1500 | 0 to 5000 | ASSUMPTION: used when a menu has no appetizer group |
| `childFallbackBps` | 6000 | 1000 to 10000 | ASSUMPTION: child price as a share of the adult price when no children's menu exists |
| `passDiningDiscountBps` | 1000 | 0 to 5000 | ASSUMPTION: Annual Passholder and DVC discount at participating locations |
| `placeholderQsCents` | 1800 | 100 to 10000 | About $18 for a counter-service meal with a drink (Pixie Vacations food cost guide) |
| `placeholderTsCents` | 4500 | 100 to 20000 | ASSUMPTION: entree, dessert and drink at a typical table-service restaurant (character meals run $50 to $70) |
| `tierEstimates.table_service` | `{1: 2800, 2: 4200, 3: 6500, 4: 9500}` | each 100 to 30000 | ASSUMPTION, keyed by the count of `$` in the price tier |
| `tierEstimates.quick_service` | `{1: 1400, 2: 1700, 3: 2000, 4: 2400}` | each 100 to 10000 | ASSUMPTION |

Code constants (not admin-editable): `DINING_EVEN_FLOOR_CENTS` 2000, `DINING_EVEN_BPS` 200, `DINING_PLAN_PARTY_MAX` 50, `DINING_PLAN_ENTRIES_MAX` 120, `DINING_PLAN_MAX_NIGHTS` 30, `DINING_PLAN_READ_MAX_STATEMENTS` 18, `DINING_STANDALONE_DEBOUNCE_MS` 400, the order-style percentiles 25, 50, 85, 100, and the plan entitlements.

Seed price periods: the five rows in the migration. 2026 adult prices ($60.47 and $98.59 per night) appear on Disney's own Q&A pages; every child price and every 2027 price comes from Pixie Vacations citing TouringPlans and AllEars, so `verified_at` is NULL and the UI shows "price not yet verified". The period boundaries (calendar years) are an assumption: Disney may price by booking window or season. The operator edits the table; the first admin task after deploy is to confirm each row against the Disney booking flow and set `verified_at`.

Seed location rules (`locationRules.seed.json`). Policy (Requirement 8.9, 8.10): err on the side of inclusion so the operator deletes a wrong row instead of typing every row. Each entry is `{ name, aliases?, upstreamEntityId?, serviceType, creditCost, creditCostByPeriod?, gratuityIncluded, ruleStatus, verifiedAt?, sourceNote }`. Matching uses `upstreamEntityId` when given, otherwise a normalized name (lower case, diacritics and punctuation removed, a leading "the" ignored) against `name` and `aliases`; an entry that matches nothing, or more than one Experience, is skipped and listed on the result page.

**Verified** (named by Disney's own channels; `verifiedAt` is the date of the Disney statement). Sources: the Dining Plans page (2026-11-09) for gratuity and the generic two-credit statement; the planDisney answer "What restaurants charge 2 table service meals" (2026-07-20); the planDisney answer on private in-room dining (2026-04-05). The planDisney answer says the list "is subject to change and may not be exhaustive":

| Name (aliases) | Credit cost | Notes |
| --- | --- | --- |
| Cinderella's Royal Table | 2 | gratuity included (Dining Plans page) |
| Be Our Guest Restaurant | 2 | an older (2019) answer said dinner only; the 2026 answer lists it without a period; seed 2 for every period |
| Akershus Royal Banquet Hall | 1, with `{lunch: 2, dinner: 2}` | Disney: "lunch and dinner"; breakfast stays at the default 1 |
| Le Cellier Steakhouse | 2 | |
| The Hollywood Brown Derby (Hollywood Brown Derby) | 2 | |
| Tiffins Restaurant (Tiffins) | 2 | |
| The BOATHOUSE (Boathouse) | 2 | |
| Jaleo by José Andrés (Jaleo) | 2 | |
| Morimoto Asia | 1, with `{dinner: 2}` | Disney: dinner |
| Paddlefish | 2 | |
| Cítricos (Citricos) | 2 | |
| Narcoossee's | 2 | |
| Story Book Dining at Artist Point with Snow White (Artist Point) | 2 | |
| Hoop-Dee-Doo Musical Revue | 2 | gratuity included (Dining Plans page) |
| Jiko - The Cooking Place (Jiko) | 2 | |
| Topolino's Terrace - Flavors of the Riviera (Topolino's Terrace) | 1, with `{dinner: 2}` | Disney: dinner |
| Flying Fish | 2 | |
| Yachtsman Steakhouse | 2 | Disney notes it was closed for refurbishment on 2026-07-20 |
| Private Dining at Disney's Grand Floridian Resort & Spa (Private Dining) | 2 | gratuity included (Dining Plans page); two credits from the 2026-04-05 answer; the catalog may not contain this entry, in which case it is reported unmatched |

**Unverified** (third-party only: The Magic For Less, "Disney Dining Plan Two Credit Meals", 2026-11):

| Name | Rule | Notes |
| --- | --- | --- |
| Cape Town Lounge and Wine Bar | table service, 2 | |
| Toledo - Tapas, Steak & Seafood | table service, 2 | |
| California Grill | `not_eligible` | Two recent sources agree it is currently off the plan: The Magic For Less (2026-11) and Disney Tourist Blog's review (2026-06: "not on the list of participating restaurants", and "prior to the 3-course dinner it was a 2-credit table service location"), and Disney's own 2026-07-20 two-credit list omits it. Disney answers from 2019 and 2024 listed it as two credits; those predate the prix-fixe menu. Disney Tourist Blog says it may return in 2027, so the operator should recheck each year. The seed records the recent sources and says so |
| Victoria & Albert's (Chef's Table at Victoria & Albert's, Queen Victoria's Room) | `not_eligible` | planDisney answer (2019): "not available on the Disney Dining Plan"; old, so unverified |
| Takumi-Tei | `not_eligible` | planDisney answer (2020): dining plans not accepted; old, so unverified |
| Space 220 (Space 220 Restaurant) | `not_eligible` | |
| La Cava del Tequila | `not_eligible` | |
| The Cake Bake Shop | `not_eligible` | |
| Summer House on the Lake | `not_eligible` | |
| Wolfgang Puck Bar & Grill (Wolfgang Puck Bar and Grill) | `not_eligible` | |
| Wine Bar George | `not_eligible` | |
| STK Orlando (STK) | `not_eligible` | |

Reviewed and deliberately NOT seeded as non-participating: Monsieur Paul (a 2020 planDisney answer says its table-service credits are usable there; its credit cost is not stated in the sources reviewed, so it gets no rule and uses the derived one-credit default until the operator sets it), Shiki-Sai and the Swan and Dolphin restaurants (no Disney-channel source was found for them in this pass; Swan and Dolphin are not Disney-owned and a 2016 planDisney answer says they do not accept the plan, but their catalog names were not checked, so the operator can add them if they appear in the catalog). Participation also changes yearly: a December 2025 WDWNT article listed The BOATHOUSE among restaurants dropped from the 2026 plans, yet Disney's 2026-07-20 answer lists it as two credits, so a later Disney statement governs and the operator should expect to revisit this list each year.

Every entry's `sourceNote` names its source and date, in at most 200 characters. The file is data only; the seed action (Requirement 18.8) is the only code that applies it, and it never downgrades a stored `verified` rule. Example entries:

```json
[
  { "name": "Cinderella's Royal Table", "serviceType": "table_service", "creditCost": 2, "gratuityIncluded": true,
    "ruleStatus": "verified", "verifiedAt": "2026-11-09",
    "sourceNote": "Disney Dining Plans page 2026-11-09: 2 table-service meals per person; gratuity included" },
  { "name": "Akershus Royal Banquet Hall", "serviceType": "table_service", "creditCost": 1, "creditCostByPeriod": { "lunch": 2, "dinner": 2 },
    "gratuityIncluded": false, "ruleStatus": "verified", "verifiedAt": "2026-07-20",
    "sourceNote": "planDisney 2026-07-20: 2 table-service meals at lunch and dinner" },
  { "name": "Cape Town Lounge and Wine Bar", "serviceType": "table_service", "creditCost": 2, "gratuityIncluded": false,
    "ruleStatus": "unverified", "sourceNote": "The Magic For Less 2026-11 (third party only); confirm in the booking flow" },
  { "name": "California Grill", "serviceType": "not_eligible", "creditCost": 1, "gratuityIncluded": false,
    "ruleStatus": "unverified", "sourceNote": "Not on the plan per Disney Tourist Blog 2026-06 and The Magic For Less 2026-11; was 2 credits before its prix-fixe menu; recheck yearly" }
]
```

Hoop-Dee-Doo's credit cost, Private Dining's credit cost and the fine-dining list can still change; the operator keeps the table current through the Admin_Panel, setting `verified` only against Disney's own statements or booking-flow labels ("Fine/Signature Dining", the number of credits shown).

## External Interfaces

The calculator makes **no outbound request**. Facts relied on, so a cold-start implementer does not re-research them (checked 2026-11-09):

- **Disney Dining Plans page** `https://disneyworld.disney.go.com/dining/plans/`: 2026 offers the Quick-Service plan and the Disney Dining Plan; 2027 offers Quick-Service, Table-Service and Deluxe Table-Service. Per night: Quick-Service 0 table-service, 2 quick-service, 1 snack; Table-Service 1, 1, 1; Deluxe 2, 1, 1. Everyone aged 3 and over receives the entitlements and a resort-refillable mug. The plan must be bought for the entire stay and the entire party (ages 3 and over). Credits can be used any time during the stay, roll over day to day, expire at midnight on the day of check-out, and are non-transferable between party members. Children aged 3 to 9 must order from the children's menu where available. Guests 21 and over may substitute beer, wine or a cocktail for the beverage. Gratuities are not included except at Hoop-Dee-Doo Musical Revue, Cinderella's Royal Table and Private Dining at Disney's Grand Floridian Resort & Spa; for fine/signature and select character dining, two table-service meals are redeemed per person. 2026: children aged 3 to 9 receive the plan free with a package that includes a Disney Resorts Collection room and a dining plan for each guest aged 10 and over. A package is required (the page describes adding a plan to a Walt Disney Travel Company package; third-party sources say DVC members and Annual Passholders can also add it).
- **Disney Q&A** (`plandisney.disney.go.com/question/...`): a table-service credit cannot be used at a quick-service location; credits cannot be split, combined, converted to another credit type, or shared with another party.
- **Plan prices**: the Disney Q&A states 2026 adult prices of $60.47 (Quick-Service) and $98.59 (Disney Dining Plan) per night; third-party sources (Pixie Vacations, WDW Travels) state that both include tax but not tip, and give child and 2027 prices (seeded as unverified).
- **Cached catalog data the engine reads**: `experiences.name`, `category = 'Restaurant'`, `active`, `price_tier` (text such as `$`, `$$`, `$$$`; a meal period's tier can read `$ (...)`, so only the leading `$` run is counted), `grouped_facets` (JSONB keyed by group; `tableService` and `quickService` are group names persisted by `disney-facilities-catalog-source`, and a non-empty array means the location belongs to that group), and `experience_menus.menus` (the `MenuDTO[]` of `restaurant-menu-display` as extended additively by `trip-budget`: `menuType`, `serviceStyle`, groups with `type`, items with `price`, `priceCents`, `prices`).
- **Planned items the import reads**: `planned_items.reservation_kind = 'dining'`, `planned_date`, `planned_time` (TIMESTAMPTZ), `meal_period` (`breakfast`, `lunch`, `dinner` or `snack`), `experience_id`, `party_size`, `id`.
- **Id mapping**: none beyond the above. The ThemeParks.wiki live path is not used. Person_Keys follow Cross-spec Person_Key rules (Party assembly above).

## Correctness Properties

### Property 1: Money is exact and decomposes

For any valid input, every amount in the result is a safe integer number of cents; each scenario's `totalCents` equals `planCostCents + foodOutOfPocketCents + taxCents + tipCents + snackOutOfPocketCents + mugOutOfPocketCents`; every term is at least 0; and `netSavingsCents` equals the No_Plan total minus the scenario total (0 for No_Plan).

**Validates: Requirements 13.1, 13.3, 23.4**

### Property 2: Plan cost is the sum of per-night prices

For any Stay, party and price rows, `planCostCents` equals the sum, over each night and each Plan_Eligible_Person, of that night's period price for the person's bracket (child promotion price when `kidsEatFree`, the Stay_Type is `disney_resort_package` and the period has one); an under-3 Person adds 0; a Stay spanning two periods uses each night's own period; and a plan is unavailable, with the stated reason, when any night has no period, there are zero nights, more than 30 nights, no Plan_Eligible_Person, or the Stay_Type is `not_disney_resort`. When `planPricesIncludeTax` is false the cost gains `bpsOf(cost, taxBps)`.

**Validates: Requirements 2.4, 2.5, 2.7, 3.4, 3.5, 3.6, 13.2, 1.5**

### Property 3: Credit allocation is optimal

For any set of at most 10 meals with credit costs 1 or 2, positive savings and any table-service capacity, `allocateCredits` returns a set whose total savings equals the maximum over all feasible subsets found by brute force, and whose total weight does not exceed the capacity. For quick-service, the returned set is the capacity-many highest-savings meals. This includes the counter-example capacity 2 with meals (weight 2, savings 12000) and (weight 1, 7000), (weight 1, 6900), where the answer is the two cheap meals (13900).

**Validates: Requirements 10.1, 10.3, 10.5**

### Property 4: Credits never exceed capacity and kinds never mix

For any input and plan, for every Plan_Eligible_Person, table-service credits used (counting 2 for a two-credit meal) are at most `nights x ts`, quick-service credits used are at most `nights x qs`, snacks covered are at most `nights x snack`; no quick-service meal is covered by a table-service credit and no table-service meal by a quick-service credit; a `quick_service` plan covers no table-service meal; and a `not_eligible` or `snack_only` location is never covered as a meal.

**Validates: Requirements 9.1, 9.3, 9.4, 9.5, 4.10**

### Property 5: Allocation is deterministic with earlier-meal ties

For any meals, permuting equal-savings meals' input order but not their `order` keys never changes the covered set; for meals with equal savings and a capacity that fits only some of them, the covered ones are the earliest by (date, meal period).

**Validates: Requirements 10.4, 16.9**

### Property 6: Credits are not transferable between people

For any input, a Person's covered meals use only that Person's credits; with `appetizersPerTable = 0`, removing a different Person from the Party does not change any remaining Person's covered set or savings (with appetizers on, the shared-table split changes extras and the tip base, so the property is stated for the zero case); and two Persons with the same bracket, drink class and Diner membership have equal results.

**Validates: Requirements 9.2, 9.6, 10.1**

### Property 7: Adding a meal never lowers a plan's net savings

For any input and any plan, appending one more non-skip entry (in a free slot, inside the Stay) never decreases that plan's `netSavingsCents`. Both totals grow by the new meal's out-of-pocket cost when it is uncovered, and the optimal allocation can only do better.

**Validates: Requirements 13.3, 10.1**

### Property 8: Raising tax or tip never lowers a plan's net savings

For any input and plan, raising `taxBps` never decreases `netSavingsCents` when `planPricesIncludeTax` is true, and raising `tipBps` never decreases it; with `taxBps = 0` and `tipBps = 0` every out-of-pocket meal costs exactly its pre-tax food total.

**Validates: Requirements 12.1, 12.2, 12.3, 12.4**

### Property 9: Covered amounts carry no tax

For any input, in a plan scenario the tax charged on a covered Diner's meal food is 0, the tax on that Diner's extras (appetizers) is not 0 when extras are not 0, and No_Plan applies tax to every meal; the tip is never applied to quick-service meals, snacks or mugs.

**Validates: Requirements 12.2, 12.6, 9.7**

### Property 10: Included gratuity saves exactly the tip

For any covered table-service Diner at a Gratuity_Included location, the plan scenario charges no tip for that meal and No_Plan charges `bpsOf(foodNet + extraNet, tipBps)`; the savings of covering that meal exceed the savings of an otherwise identical meal at a location without included gratuity by exactly that tip. For a covered meal without included gratuity the tip charged is the same in both scenarios.

**Validates: Requirements 12.3, 12.4, 10.2**

### Property 11: A bolder order style never lowers cost

For any menu and any two Order_Styles in the order budget, typical, splurge, max_value, the later one's per-Diner food price on the `menu_items` basis is at least the earlier one's, and the No_Plan total is non-decreasing; `max_value` equals the maximum entree price.

**Validates: Requirements 7.2, 6.1**

### Property 12: Percentile selection returns a real price

For any non-empty ascending integer list and `p` in 1..100, `pickPercentile` returns a member of the list, is non-decreasing in `p`, equals the minimum for `p` small enough that `ceil(p/100 x n) = 1`, and equals the maximum for `p = 100`; for an empty list it returns null.

**Validates: Requirements 7.2**

### Property 13: Menu basis follows the precedence order

For any location, the reported basis is the first applicable in the order `admin_override`, `menu_offer`, `menu_items`, `menu_estimate`, `tier_estimate`, `default_estimate`; removing the data for the reported basis changes the basis to the next applicable one; the reported basis counts in `dataQuality.byBasis` sum to the number of non-skip, in-stay entries with Diners.

**Validates: Requirements 7.1, 7.9, 15.2**

### Property 14: Valuation is total and positive

For any entry that is not `skip`, in the Stay, with at least one Diner, over any combination of menus (including none, malformed groups and unpriced items), rules, price tiers and settings, `valueEntry` returns a positive integer food price for every Diner and never throws; a `child` Diner with no children's menu gets `bpsOf(adult, childFallbackBps)`.

**Validates: Requirements 7.4, 7.7, 7.8**

### Property 15: Service type derivation and rule constraints

For any `grouped_facets`: `table_service` iff `tableService` is a non-empty array, else `quick_service` iff `quickService` is a non-empty array, else `not_eligible`; a derived rule has credit cost 1, no included gratuity and status `derived`, is counted in `derivedRules` and never in `unverifiedRules`, and leaves `unverifiedRule` false; a stored rule's non-null fields override the derived ones; a rule with `credit_cost = 2` or `gratuity_included` is rejected unless the service type is `table_service`, and `verified` is rejected without `verified_at`; and no input produces credit cost 2 without an explicit rule.

**Validates: Requirements 8.1, 8.2, 8.3, 8.5, 8.6**

### Property 16: Recommendation and verdict are consistent

For any set of scenario totals, `recommended` is the available option with the lowest total (ties in the order none, quick_service, table_service, deluxe); `verdict` is `plan_unavailable` iff no plan is available, `plan_saves` iff the best plan's net exceeds the Even_Threshold, `about_even` iff its absolute net is at most the threshold, otherwise `plan_costs_more`; `recommended` is `none` for the last two; `breakEvenGapCents` equals `max(0, best total - No_Plan total)`.

**Validates: Requirements 13.4, 13.5, 13.6, 13.7**

### Property 17: Snack accounting

For any input, a Person's snack demand is `snacksPerPersonPerDay x days + snack_only entries`; covered snacks are `min(demand, nights x snack credits)` for a Plan_Eligible_Person on a plan and 0 otherwise; unused snack credits are issued minus covered; `snacksPerDayToUseAll` is `ceil(issued per person / days)`; the snack out-of-pocket amount is the uncovered count times `snackCents` plus its tax.

**Validates: Requirements 11.1, 11.2, 11.3, 4.9**

### Property 18: Mug accounting

For any `mugsWanted`, No_Plan pays for all of them with tax; a plan covers `min(mugsWanted, eligibleCount)` and pays the rest; the amount is never negative.

**Validates: Requirements 11.4**

### Property 19: Stay and slot handling

For any entries, an entry outside `[checkIn, checkOut]` appears in `warnings` as `outside_stay`, is counted in `dataQuality.outsideStayEntries`, and changes no total; nights are exactly `checkIn .. checkOut-1`; an entry whose Diners are all excluded behaves as `skip`; a Person_Key not in the Party is ignored; and adding or removing an `under3` Person from the Party changes no scenario total.

**Validates: Requirements 3.4, 4.5, 4.6, 4.7**

### Property 20: Reservation meal period is a total function with exact boundaries

For any `meal_period` value and any `planned_time`, `mealPeriodOfReservation` returns the stored period when it is breakfast, lunch or dinner; otherwise 10:59 WDW local is `breakfast`, 11:00 is `lunch`, 15:59 is `lunch`, 16:00 is `dinner`, in both EST and EDT dates; a `snack` period with no usable time returns null.

**Validates: Requirements 5.2**

### Property 21: Import is idempotent and keeps slots unique

For any set of reservations and existing entries, importing twice leaves exactly the entries one import creates; no two entries share `(trip, date, meal period)`; no two entries share a `planned_item_id`; existing entries are untouched unless `overwrite`; two reservations for one slot import only the earlier; the counts `created + skippedExisting + skippedOutOfStay` equal the number of suggestions processed.

**Validates: Requirements 5.4, 5.5, 5.7, 4.1**

### Property 22: The read path is bounded and read-only

For a Trip with 1 entry and a Trip with 100 entries, `GET /trips/:id/dining-plan` issues the same number of SQL statements, at most `DINING_PLAN_READ_MAX_STATEMENTS`, no `INSERT`, `UPDATE` or `DELETE`, no outbound request and no Redis command; a restaurant with no cached menu is valued on an estimate basis without a fetch.

**Validates: Requirements 16.5, 16.6, 23.1, 23.2**

### Property 23: Authorization matches the Trip model

For any user and Trip, a non-member and an unknown Trip id receive the same `trip_forbidden` response on every Trip route; every member and organizer may view and edit; the stateless route requires only a session.

**Validates: Requirements 16.2, 16.3**

### Property 24: Admin edits are validated

For any price period, an overlap with another period of the same plan, `valid_to < valid_from`, or a promotion without a label is rejected and stores nothing; any config value outside its bound is rejected; any rule violating the constraints of Property 15 is rejected; a valid save is visible to the next calculation without restart.

**Validates: Requirements 2.6, 8.3, 18.2, 18.3, 18.4, 18.9**

### Property 25: The engine is pure and deterministic

For any input, two calls to `computeDiningPlan` return deeply equal results, the input is not mutated, and the result does not depend on the order of `persons` beyond the documented Party-order tie-breaks (appetizer split remainder).

**Validates: Requirements 16.9, 23.4**

### Property 26: Sensitivity agrees with the main result

For any input, the `sensitivity` row for the current Order_Style equals the main result's best plan and best net savings, and there is exactly one row per Order_Style.

**Validates: Requirements 15.1**

### Property 27: Per-meal verdicts agree with the allocation

For any plan scenario, a meal's `coverage` is `all`, `partial` or `none` exactly as its Diners are in the allocation; `savingsCents` is the sum over covered Diners of the covering savings; `reason` is null iff coverage is not `none`; `reason` is `not_eligible` for a `not_eligible` location, `no_matching_credits` when the plan has zero credits of the needed kind, and `better_use_elsewhere` otherwise; `noPlan.totalCents - (plan.totalCents - plan.planCostCents)` equals the sum of `savingsCents` over all meals, plus covered snacks times `snackCents` plus their tax, plus covered mugs times `mugCents` plus their tax.

**Validates: Requirements 14.1, 14.2, 14.3, 14.4**

### Property 28: Admin and shared schemas round-trip

For any valid `DiningPlanSettings`, entry body, calculate body and `DiningConfig`, parsing then serializing then parsing yields an equal value; any unknown key, out-of-range number or malformed key is rejected; `DINING_CONFIG_DEFAULTS` itself parses; the migration seed rows satisfy every CHECK.

**Validates: Requirements 6.1, 6.3, 6.4, 16.4, 17.6**

### Property 29: Cross-stay allocation is optimal

For any Person with two or three plan-active Plan_Stays joined by Hand_Off_Dates, any meals (with credit costs 1 or 2 and positive savings) and any per-stay capacities, `allocateAcrossStays` returns an assignment of meals to stays (or none) whose total savings equals the maximum over all feasible assignments found by brute force, and where every meal not on a Hand_Off_Date is assigned only to the one stay containing its date.

**Validates: Requirements 25.6, 25.7**

### Property 30: Per-stay capacity holds, credits never carry, ties prefer the outgoing stay

For any input, the table-service and quick-service credits assigned to a stay never exceed that stay's `nights x entitlement` per Person; a meal dated outside `[checkIn, checkOut]` of a stay is never assigned to it; and when two assignments have equal total savings, the chosen one assigns each Hand_Off_Date meal to the outgoing stay whenever that is feasible and equally good.

**Validates: Requirements 25.6, 25.7**

### Property 31: One stay reproduces the single-stay result

For any input with exactly one Plan_Stay spanning the Stay, `computeDiningPlan` returns a result deeply equal (on every field defined before this amendment) to the result of the single-stay engine for the same inputs, and `stays` has one element whose recommended plan equals the old recommendation.

**Validates: Requirements 25.1, 25.10, 25.11**

### Property 32: The recommended Combination is the cheapest

For any Plan_Stays (at most 3 `compare`), the recommended Combination has the lowest `totalCents` over all enumerated Combinations (a brute-force enumeration in the test); held and `no_plan` stays are identical in every Combination; the Baseline equals the Combination of all `compare` stays set to No_Plan; `netSavingsCents` of every Combination equals the Baseline total minus its total; and ties resolve by fewest plans bought then the stated order.

**Validates: Requirements 25.4, 25.5, 25.9, 25.10**

### Property 33: A Person receives credits only on stays they are on

For any `partyKeys`, a Person not named by a Plan_Stay has no credits from it, adds nothing to its plan cost, and pays their meals on its dates out of pocket; a Plan_Stay with null `partyKeys` behaves as if every Party member were named; a key naming no Party member changes nothing.

**Validates: Requirements 25.8**

### Property 34: Flexible hand-off meals never cost more than a fixed rule

For any input, the recommended total with hand-off meals assignable to either stay is at most the total when every Hand_Off_Date meal is forced to the outgoing stay and at most the total when forced to the incoming stay.

**Validates: Requirements 25.7**

### Property 35: Snacks and mugs are accounted per stay and per person

For any input, snack credits covered in a stay never exceed that stay's `nights x snack credits` per Person nor that stay's attributed snack demand; each calendar date from the earliest check-in to the last check-out is attributed to exactly one stay; and covered mugs equal `min(mugsWanted, number of Plan_Eligible_Persons on at least one plan-active stay)`.

**Validates: Requirements 25.12**

### Property 36: Eligibility follows the stay kind and source

For any Plan_Stay, a stay of kind `partner_hotel` or `offsite` with source `stay` is unavailable with reason `not_disney_resort`; kind `resort`, source `legacy_resorts`, `implicit_no_lodging` and `implicit_gap` are plan-eligible; `no_plan` and unavailable stays have plan cost 0 and no credits; a `have_plan` stay is fixed to its plan in every Combination and its cost is in every total.

**Validates: Requirements 25.2, 25.4, 25.5**

### Property 37: Alcohol is not priced at a quick-service breakfast

For any menu, Party and settings, an alcohol drinker's per-Diner food price at a `quick_service` entry in the `breakfast` period on the `menu_items` basis equals the price of an otherwise identical non-drinker; at a `table_service` entry in any period, and at a `quick_service` entry at lunch or dinner, it is at least that non-drinker's price when the alcohol price is at least the scenario beverage price, and equals `entree + dessert + alcohol price` otherwise.

**Validates: Requirements 7.5**

### Property 38: Import suggestions are exactly the eligible items, with the stated precedence

For any planned items of a Trip, the suggestions are exactly: dining reservations (`reservation_kind = 'dining'`) with a date and an Experience, plus plain planned items (`reservation_kind` NULL, `item_type = 'experience'`) with a date whose Experience is an active Restaurant; no `break` item, no non-Restaurant experience without a dining reservation kind, no other reservation kind and no undated item is ever suggested; an item with no resolvable Meal_Period is not suggested and is counted in `suggestionsNeedingMealPeriod`; for two candidates in one slot a reservation beats a plain item and otherwise the earlier time wins; each suggestion's `source` matches its origin.

**Validates: Requirements 5.8, 5.9, 5.10, 5.7**

### Property 39: Credit cost follows the meal period

For any table-service location with a `credit_cost` and a `credit_cost_by_period`, the cost of an entry is `credit_cost_by_period[period]` when present and `credit_cost` otherwise; the allocation weight, the `creditsUsedPerDiner` and the `twoCredit` flag use that cost; a rule with a period map on a non-table-service location, or any value other than 1 or 2, or any key other than breakfast, lunch or dinner, is rejected; and for Akershus-shaped rules (`{lunch: 2, dinner: 2}`) a breakfast entry costs one credit while lunch and dinner cost two.

**Validates: Requirements 8.8, 9.4**

### Property 40: The seed is consistent, never downgrades, and reports what it skipped

For the bundled seed file: every entry satisfies the rule constraints (credit cost 2, a period map or included gratuity only on table service; `verified` only with a date); the `verified` entries are exactly those whose source note cites a Disney channel; applying the seed twice leaves the table identical to applying it once; applying it over a stored `verified` rule never changes that rule to `unverified`; normalized name matching maps "The BOATHOUSE", "Boathouse", "Cítricos" and "Citricos" to one key each and never matches two different Experiences silently; an unmatched or ambiguous entry writes nothing and appears in the result with its reason.

**Validates: Requirements 8.4, 8.9, 8.10, 18.8, 18.10**

### Property 41: Exported lines sum to the displayed figures

For any result with per-Person amounts and any Combination, summed over Persons: the `out_of_pocket` line equals the Combination's out-of-pocket food, appetizer, snack and mug terms before tax; the `tips` line equals the Combination's tip term; each `plan` line equals the pre-tax conversion of that stay's plan cost, and the Budget total of the line (`pre-tax + bpsOf(pre-tax, r)`) is within one cent per allocation of the tax-inclusive plan cost when the Budget dining rate is `r`; with `planPricesIncludeTax` false the stored amount equals the plan cost; zero amounts are omitted and a line with no allocation is not produced.

**Validates: Requirements 26.4, 26.6, 26.8, 26.14**

### Property 42: Export is idempotent and touches only its own lines

For any existing Budget lines and any Combination, exporting twice produces the same set of keyed lines as exporting once (same ids, same amounts); a previously exported keyed line that is no longer part of the export is deleted; a line without the `dining_plan:` prefix is never modified or deleted; a replaced line keeps its id and `linkedExpenseId`; a failed run that is retried completes to the same final set; and a keyed line created by one non-Organizer Member is updated and deleted by a different non-Organizer Member's export, while an unprefixed line created by the first Member stays uneditable by the second.

**Validates: Requirements 26.7, 26.10, 26.15, 26.16**

### Property 43: Export is explicit, authorized and previewable without side effects

For any request, `preview: true` performs no Budget write; a caller who lacks `edit_budget` or `edit_dining_plan`, a non-member and an unknown Trip receive `trip_forbidden` with no write; an invalid Combination (an unavailable plan, an unknown stay key, a contradiction of `have_plan` or `no_plan`) returns `trip_validation_failed` with no write; no read route and no calculation ever invokes the export.

**Validates: Requirements 26.1, 26.2, 26.3, 26.13, 1.3**

### Property 44: A lounge is never covered without an explicit rule

For any `grouped_facets` whose `tableService` facet ids include `lounges` and are all in `{lounges, reservations-accepted, reservations-strongly-recommended, speciality-food-beverage}`, `deriveServiceType` returns `not_eligible`, so with no stored rule (or a stored rule with a NULL `service_type`) no plan covers a meal there and its line's reason is `not_eligible`; when `tableService` also has any other facet id the derivation is the one of Requirement 8.1; a stored rule with `service_type = 'table_service'` makes the lounge coverable.

**Validates: Requirements 8.11, 8.1, 8.2**

### Property 45: An about-even result names the cheaper side

For any result with verdict `about_even`, the screen's verdict text names `bestPlan` (or No_Plan when `netSavingsCents` of `bestPlan` is negative) and shows the absolute difference from the server's figures, no option carries a "Recommended" label, and both options' totals and per-meal details are reachable.

**Validates: Requirements 15.6, 13.6**

### Property 46: An imported dining reservation keeps its Experience

For any dining reservation imported into a free slot, the created entry is a `restaurant` entry naming the reservation's Experience and planned item, whatever that Experience's category or active flag; a user-set `restaurant` entry naming the same Experience is rejected unless it is an active Restaurant.

**Validates: Requirements 5.11, 4.3**

## Error Handling

| Condition | Result |
| --- | --- |
| Non-member or unknown Trip on any Trip route | `trip_forbidden` (403), identical response |
| Invalid body, params or settings | `trip_validation_failed` (400) naming the field; `validation_failed` (400) on the stateless route |
| `restaurant` entry for a missing, inactive or non-Restaurant Experience | `trip_validation_failed` |
| 121st entry on a Trip | `trip_validation_failed` ("a Trip can hold 120 dining entries") |
| Party over 50 people | `trip_validation_failed` |
| Unknown Experience in a stateless entry | Entry dropped, warning `unknown_experience` in the result |
| No cached menu, no price tier | Valued on `default_estimate`; counted in `dataQuality` and shown as "Estimate" |
| No price period for a night | That plan `available: false`, reason `no_price_for_dates`; others unaffected |
| `dining_plan_config` row missing or a key missing | Constants from `DINING_CONFIG_DEFAULTS` |
| Config row holds an invalid value (edited by hand) | The invalid key falls back to its default and a server warning is logged; the request does not fail |
| Admin validation failure | Re-render the page with the error message, no write |
| Database error in the Admin_Panel | Generic in-page error through `renderAdminSection`; details only in server logs |
| Mobile network failure | Error state with retry; the last good result stays visible while a mutation is pending |

## Testing Strategy

Per the execution-discipline steering: Vitest in `apps/api` and `packages/shared`, Jest (`jest-expo`) in `apps/mobile`; property tests use `fast-check` with at least 100 runs and the tag `// Feature: dining-plan-calculator, Property N: <title>`. Every task ships its tests; the full `npm run verify` runs once at the final task.

| Layer | Tests |
| --- | --- |
| Shared (`packages/shared/src/__tests__/diningPlan.test.ts`, `diningPlan.prop.test.ts`) | Schemas valid and invalid cases; defaults parse; `classifyMenuGroup` and `menuGroupItemCents` unit cases plus a regression test that every existing `menuPricing` test is unchanged; Properties 28, 12 (if kept pure in shared) |
| Engine units (`services/diningPlan/engine/__tests__/`) | One file per module with hand-checked numbers: a worked example of 2 adults, 1 child, 5 nights, a character dinner at Cinderella's Royal Table, a quick-service lunch, to pin tax, tip, gratuity and the two-credit case; both the 2026 and 2027 plan sets |
| Engine properties | Properties 1 to 14, 16 to 19, 25 to 27; the brute-force oracle for Property 3 lives in the test file only; generators produce zero-priced and unpriced items, empty menus, ties, 1 to 12 persons, 0 to 40 entries, stays crossing a price-period boundary |
| Reservation mapping | Property 20 with boundary table tests in EST and EDT dates |
| Repo (pg-mem, `repo.test.ts`) | Real SQL for every method; entry upsert and delete; slot uniqueness; entry cap under the Trip lock; import idempotence (Property 21) including the partial unique index; cascade on Trip delete; a bug-fix regression rule: a test must read the persisted row back |
| Migration (`apps/api/src/db/__tests__/migration0075.test.ts`) | Tables, columns, every CHECK, both unique indexes, seed rows present exactly once and satisfy the CHECKs, singleton config row, idempotent re-apply |
| Routes (`server.inject`, `routes.test.ts`) | Auth gate (Property 23), happy path, validation errors, concurrent writes, the statement-count test (Property 22) with the counting proxy over the real repo, the stateless route |
| Admin (`services/admin/__tests__/diningPlanRoutes.test.ts`) | Basic Auth, same-origin refusal, escaping, flash redirects, overlap rejection, config bounds, rule constraints, seed action idempotence and the verified-rule no-downgrade, search and filters (Property 24) |
| Guards | `roleReader.guard.test.ts`, `trip_memberships.guard.test.ts`, `visibility.guard.test.ts` and the account-deletion registry test pass unchanged; `themeRetrofit.guard.test.ts` passes without allowlist changes |
| Mobile (`@testing-library/react-native`) | See below |

**Mobile interaction coverage** (mock only the network layer): open the screen and see the verdict, the comparison rows and the quality notice from a fixture result; tap a slot, search and choose a restaurant, and assert the `PUT .../entries/:date/:mealPeriod` payload and that the grid shows the name from the response; choose a typical table-service meal; skip a slot; exclude a Diner; clear a slot (`DELETE`); open settings, change order style and beverage, save, and assert the `PUT .../settings` body and the updated verdict; tap "Add N reservations" and assert the `POST` body and the created and skipped counts shown; loading, error and retry; empty entries state; an unavailable plan shows its reason; the standalone screen debounces and posts `/dining-plan/calculate` once after the last edit and renders the response; the hub tile navigates to `TripDiningPlan`. The screen test also asserts no total is computed client-side by feeding a fixture whose totals do not sum, and checking that the screen shows the server values unchanged.

**Hosting constraints respected.** No cron, worker, Redis or outbound call; bounded statements; fixed-shape tables.

## Cross-Spec Dependencies and Build Order

- Built after: `trips`, `trip-expenses`, `trip-budget` (money helpers, `menuPricing`, `BUDGET_DEFAULT_*`, Traveler_Profiles), `trip-reservations`, `restaurant-menu-display`, `disney-facilities-catalog-source`, `account-deletion`, `admin-panel`, `legal-disclaimers-and-terms`, `dark-mode` (theming rules). All are already implemented. Also built after **`trip-lodging-stays`** (dated stays and `effectiveStays`, consumed by the Multi-Stay Extension); that spec is not yet implemented, so build it first.
- Amended additively in the same change (Requirement 24): `trips`, `admin-panel`, `legal-disclaimers-and-terms`, `restaurant-menu-display`.
- Order inside this plan: shared contracts, migration, pure engine, repo and service, routes and permissions, admin, mobile Trip screen, standalone screen, amendments, final gate.

## Multi-Stay Extension (added with `trip-lodging-stays`)

Requirement 25 generalizes the single stay of the sections above. This section states the deltas; where it differs from an earlier section for a Trip with several Plan_Stays, this section governs, and the single-stay engine is the one-element case (Property 31). The earlier sections are unchanged.

### Why per-stay pools, and why hand-off meals are flexible

A dining plan belongs to one room reservation. Its credits are issued per night of that reservation, can be used on any day of it, and expire at midnight on its check-out day. On the day a party moves hotels, both reservations are live for that Person: the outgoing stay's credits have not yet expired and the incoming stay's credits are already issued. A leftover dinner credit from the hotel being left is therefore still usable at dinner that day, and the incoming hotel's credit can cover that morning's breakfast. A fixed rule (breakfast to the outgoing stay, dinner to the incoming) would miss both cases. The calculator instead treats each hand-off meal as assignable to either stay and chooses the assignment that saves the most.

### Settings, DTOs and constants (additive)

`diningPlanSettingsSchema` gains `stayPlans: z.record(z.string().min(1).max(80), stayPlanSettingSchema).default({})` with `stayPlanSettingSchema = { status: 'compare' | 'have_plan' | 'no_plan' = 'compare', heldPlan: DiningPlanCode | null = null, channel: 'package' | 'dvc_or_passholder' = 'package' }` and a refine that `heldPlan` is set iff `status === 'have_plan'`. The earlier `settings.stay` (custom dates) and `settings.stayType` apply only to a single `implicit_no_lodging` or `legacy_resorts` segment, as before; with dated stays they are ignored and the screen says to edit stays in Trip settings. New constants: `DINING_PLAN_COMPARE_STAYS_MAX = 3`, `DINING_PLAN_SPAN_MAX_DAYS = 60`, `DINING_PLAN_STAYS_MAX = 8`; `DINING_PLAN_READ_MAX_STATEMENTS` becomes 19.

`DINING_SCENARIO_CODES` gains `'mix'`. `EngineInput` gains `stays: readonly EnginePlanStay[]` where

```ts
export interface EnginePlanStay {
  key: string;                       // Trip stay id, or 'implicit:<checkIn>' for a synthesized segment, or the client key (stateless)
  label: string; lodgingKind: StayType; source: EffectiveStaySource;
  checkIn: string; checkOut: string; partyKeys: readonly string[] | null;
  setting: StayPlanSetting;          // defaults applied
}
```

When `stays` is omitted, the engine builds one `EnginePlanStay` from `input.stay` and `settings.stayType` (the earlier behavior). `DiningPlanResultDTO` gains the optional fields `stays`, `recommendedCombination`, `alternatives` (Requirement 25.11); `scenarios` keeps `none` (the Baseline) and, per plan code available to at least one `compare` stay, the uniform option "that plan on every `compare` stay where available, none elsewhere", and a `mix` scenario when the recommended Combination is not uniform. `DiningMealLineDTO` gains `stayKey` and `coveredByStayKey`. `DiningStayDTO` becomes the span of all stays for display, with `stays` carrying the per-stay detail.

### Engine changes (`engine/stays.ts`, `engine/allocateAcrossStays.ts`, `engine/combinations.ts`)

1. **Plan_Stay availability and cost.** `planStayAvailability(stay, setting, priceRows, settings)` applies Requirement 25.2 and the single-stay unavailability reasons per stay (`no_nights`, `stay_too_long`, `no_price_for_dates`, `no_eligible_guests` for the stay's persons). `planCost` of the earlier design is called per Plan_Stay over that stay's nights and persons (the stay's `partyKeys` intersected with the Party's Plan_Eligible_Persons), with the promotion only when the stay's channel is `package`.
2. **Pools.** For Person `p` and plan assignment `A: stayKey -> plan | none`, the active stays `S_p` are those with a plan, available, and with `p` in their persons. Each active stay `i` has capacity `cap_i.ts = nights_i x ENT[A(i)].ts` and `cap_i.qs = nights_i x ENT[A(i)].qs`.
3. **Eligible stays per meal.** Meal `m` on date `d` is eligible for each active stay `i` with `checkIn_i <= d <= checkOut_i`. Because stays' nights are disjoint, a date is in at most two stays, and then only on a Hand_Off_Date.
4. **Allocation (`allocateAcrossStays`).** Meals eligible for exactly one active stay go to that stay's knapsack (`allocateCredits` of the single-stay design, per stay). Meals eligible for two stays are *flexible*; at most 3 exist per Hand_Off_Date (three meal slots). The stays are processed in date order with a DP whose state is the subset of the next Hand_Off_Date's flexible meals already claimed by the outgoing stay:

```
G_i(X)  = best total savings over stays 1..i, where X ⊆ F_i is the set of flexible meals at the i -> i+1 hand-off
          claimed by stay i  (F_i = flexible meals at that hand-off; |F_i| <= 3, so at most 8 states)
G_0({}) = 0
for stay i, for each X ⊆ F_i, for each X_prev ⊆ F_{i-1}, for each Y ⊆ (F_{i-1} \ X_prev) that stay i claims from the previous hand-off:
      value = G_{i-1}(X_prev) + knapsack_i( fixed meals of i  ∪ Y ∪ X )        // exact, per kind (ts weights 1 or 2, qs weight 1)
      G_i(X) = max(G_i(X), value)
answer = max_X G_n(X)   (the last stay has no outgoing hand-off, so F_n = {})
Flexible meals claimed by neither stay are paid out of pocket.
Reconstruct by storing argmax; on equal value prefer the larger X (outgoing stay claims more), then the lexicographically smaller set.
```

   The state space is at most 8 states per stay; each transition solves up to 64 small knapsacks of the single-stay DP. A Person with one active stay reduces to the single-stay allocation.
5. **Per-Person results are summed.** Persons with the same signature (bracket, drink class, Diner membership, set of stays they are on) share one allocation (memoization), so the cost grows with the number of distinct signatures, not people.
6. **Snacks and mugs.** Snack demand per Person per stay uses the date attribution of Requirement 25.12; covered snacks are `min(demand_i, nights_i x snack credits)` per stay. Mugs covered = `min(mugsWanted, count of Plan_Eligible_Persons with at least one active stay)`; the uncovered remainder is out of pocket as before.
7. **Combinations (`combinations.ts`).** `options(stay)` is `[none, ...availablePlans]` for a `compare` stay (the first 3 by date) and the single fixed option for every other stay. The engine evaluates the Cartesian product (at most 4^3 = 64) with the full per-Combination evaluation (plan cost per stay plus per-Person allocation plus snacks, mugs, tax, tip), picks the minimum, and ranks up to 5 alternatives. The Baseline is the Combination with every `compare` stay set to `none`. `contributionCents` of a stay is the recommended total with that stay's option replaced by `none` minus the recommended total.
8. **Sensitivity.** The four Order_Style re-runs repeat the Combination enumeration; with 64 Combinations and memoized signatures this stays within the Requirement 25.14 bounds, and the engine MUST NOT enumerate when there is no `compare` stay (one evaluation).
9. **Verdict.** `best` of Requirement 13.5 is the recommended Combination; `breakEvenGapCents` and `evenThresholdCents` are computed against the Baseline total.

*As built (task 5.9), each decision pinned by `multiStay.test.ts` or `combinations.test.ts`:*

- **One path.** Every input runs through the Plan_Stay model. Without `stays` the engine builds one stay (`singlePlanStay`: `resort`, or `offsite` for `not_disney_resort`; channel `dvc_or_passholder` for `dvc_or_passholder_resort`, else `package`) and leaves `stays`, `recommendedCombination`, `alternatives`, `scenario.combination` and the line `stayKey`/`coveredByStayKey` out, so the single-stay results are unchanged. The single-stay `evaluateScenario` is the one-stay case of `evaluateCombination`. `stays` is reported whenever `input.stays` is given, including one stay (Property 31 expects the one element; Requirement 25.11's "more than one" is the minimum).
- **`best` and `recommended`.** `best` is the top-ranked Combination other than the Baseline (Requirement 25.10's order); the verdict compares it with the Baseline; the recommended Combination is `best` only when the verdict is `plan_saves`, else the Baseline, the same rule as Requirement 13.6. With no Combination other than the Baseline (no `compare` stay offers a plan) the verdict is `plan_unavailable`. `bestPlan` is null when `best` is a `mix`.
- **Scenarios.** `none` is the Baseline, named "No additional plan" when a held plan applies. Each plan code gets its uniform scenario when a `compare` stay offers it; otherwise, if there is a `compare` stay, an unavailable scenario with the first `compare` stay's reason (this keeps the single-stay shape); with no `compare` stay the plan codes are left out. A `mix` scenario ("A plan per hotel") is added when `best` is not uniform, recommended or not, so the screen can show it.
- **Attribution.** A date belongs to the stay with that night; a date with no night (a gap on the stateless route, or the last check-out) goes to the latest stay already started. A meal line's `stayKey` is that stay; `coveredByStayKey` is the stay covering the first covered Diner in Party order.
- **Reasons.** An uncovered meal is `no_matching_credits` when no plan on a stay containing its date issues that credit kind, else `better_use_elsewhere`; with no plan anywhere in the Combination the reason is null, as for No_Plan.
- **Per-stay credits and mugs.** Each stay's credit summary counts its own Persons' credits; mugs are counted once per Person, and the per-stay `mugsCovered` is reported on the first plan-active stay only (the scenario total is authoritative). A `have_plan` stay that is not plan-eligible gets no plan.
- **Memoization.** Allocations are shared by Persons with the same plan-active stays and the same items (kind, weight, savings), which covers the bracket and drink-class signature of step 5 and also the appetizer split, which changes savings through the tip.

### Service, party port and read path

The service gets the Trip's stays through a new structural port `TripStaysPort { listStays(tripId): Promise<StayRecord[]> }`, wired in `composeServices.ts` to `selectTripStaysByTrip` of `trips/stays.ts` (the repo function added by `trip-lodging-stays`), and calls `effectiveStays` from `@dwt/shared` with the Trip's dates. `DiningPlanDTO` carries the per-stay detail in `result.stays`, which the client uses to render the per-stay controls. `putSettings` validates `stayPlans` keys against the current Plan_Stay keys only for format (a stale key is harmless and is dropped on the next save). The service does not write to `trip_stays`; stays are edited through `PUT /trips/:id/stays`, which only Organizers may call, while `stayPlans` is a Dining_Scenario setting any Member may change.

### Mobile

`TripDiningPlanScreen.tsx` gains a "Your stays" section above the meal grid (new `DiningStaysSection.tsx`): one row per Plan_Stay with the hotel name, dates, nights and a three-way control (Compare plans, I already have a plan with a plan picker, No plan), the channel toggle for Disney Resort stays, and the unavailable reason in words for other kinds; synthesized segments show "No lodging recorded; assuming a Disney Resort package" with a link to edit stays when the viewer is an Organizer. The meal grid shows the hotel name under each date and a Hand_Off_Date marker with the Requirement 25.16 text. The result shows the recommended Combination sentence, a per-stay table (plan, cost, contribution), and the alternatives list. A change to a stay's setting calls the settings route (existing) with the updated `stayPlans`.

### Testing additions

Engine: a worked three-stay example (Contemporary Dec 15 to 20 with the plan held, Pop Century Dec 20 to 26 compared, off-site Dec 26 to 28) asserting every term in cents, including a leftover outgoing dinner credit covering the Dec 20 dinner and an incoming credit covering the Dec 20 breakfast; Properties 29 to 36 (the brute-force oracle for 29 enumerates assignments of at most 6 flexible meals; the oracle for 32 enumerates all Combinations); the single-stay golden result of the earlier design re-run through the multi-stay entry point (Property 31). Service: fake `TripStaysPort` with dated, undated and no stays; `stayPlans` round trip. Routes: the statement-count test now allows one more statement and still asserts equality for 1 and 100 entries and for 1 and 6 stays. Mobile: set a stay to "I already have a plan" and assert the settings `PUT` body; switch one to "No plan"; the hand-off marker and explanation text render; per-stay rows and the recommended Combination sentence render from a fixture; an off-site stay shows its reason.

## Import, Seed and Budget Export Extensions (second review pass)

This section states the deltas for Requirements 5.8 to 5.10, 8.8 to 8.10, 18.10 and 26. Where it differs from an earlier section, this section governs.

### Planned-restaurant import (Requirement 5)

`repo.loadPlannedDiningReservations(tripId)` is renamed `loadPlannedDiningItems(tripId)` and stays one statement:

```sql
SELECT pi.id, pi.experience_id, e.name AS experience_name, pi.planned_date, pi.planned_time,
       pi.meal_period, pi.party_size, pi.reservation_kind
  FROM planned_items pi
  JOIN experiences e ON e.id = pi.experience_id
 WHERE pi.trip_id = $1
   AND pi.planned_date IS NOT NULL
   AND pi.item_type = 'experience'
   AND (pi.reservation_kind = 'dining'
        OR (pi.reservation_kind IS NULL AND e.category = 'Restaurant' AND e.active = TRUE))
```

`suggestFromPlannedItems` resolves each row's Meal_Period with `mealPeriodOfReservation`; a row that yields null is dropped and counted in `suggestionsNeedingMealPeriod`; each kept row gets `source: 'reservation'` when `reservation_kind = 'dining'`, otherwise `'planned_item'`; slot conflicts are resolved reservation first, then earlier `planned_time` (rows without a time sort after rows with one), then lowest id. The import route and its idempotence (`uq_dpe_planned_item`, the in-transaction check) are unchanged: a Planned_Restaurant imports exactly like a reservation. The read path's statement count is unchanged because the same single statement is used.

### Credit cost by meal period (Requirement 8.8)

`LocationRuleRow` gains `creditCostByPeriod: Partial<Record<DiningMealPeriod, 1 | 2>> | null`; `diningCreditCostByPeriodSchema` is a strict object with optional keys `breakfast`, `lunch`, `dinner` and values 1 or 2, added to the shared module and to the admin form. `creditCostFor(rule, period)` is used wherever the engine previously read `creditCost` (the allocation weight, `creditsUsedPerDiner`, the `twoCredit` flag). For a derived rule (no row) the cost stays 1 (Requirement 8.5).

### Seed application (Requirements 8.9, 8.10, 18.8, 18.10)

`applySeed()` loads the JSON, validates every entry with the same schema as the admin form (a malformed entry fails the whole action before any write and names the entry), loads the active Restaurant Experiences once (`id`, `name`, `upstream_entity_id`), builds a normalized-name index (lower case, `NFD` diacritics removed, punctuation removed, a leading "the" dropped), resolves each entry, and then upserts with `ON CONFLICT (experience_id) DO UPDATE` (a primary-key target, safe on pg-mem), skipping an update that would replace a stored `verified` rule with an `unverified` one (outcome `kept`). The batch is deduplicated by `experience_id` before the statement (two seed entries can match one Experience; the more specific `upstreamEntityId` entry wins, else the later entry, and the loser is reported `ambiguous`). The result page lists every entry and its outcome with the source note.

### Budget export (Requirement 26)

**Port.** `TripBudgetWritePort` (structural, in `diningPlan/budgetPort.ts`) with `getDiningTaxBps(tripId)` (from `getSettings`: the stored `taxBps.dining` else `BUDGET_DEFAULT_TAX_BPS.dining`), `listExportedLines(tripId)`, `createLine`, `editLine` and `removeLine`. `createLine`, `editLine` and `removeLine` are wired in `composeServices.ts` to the existing `createTripBudgetRepo(pool)` (the same instance the Budget routes use). `listExportedLines` is the dining module's own adapter query and does NOT use `loadBudget`: `SELECT id, suggestion_key, linked_expense_id FROM trip_budget_lines WHERE trip_id = $1 AND suggestion_key LIKE 'dining_plan:%'`, followed by an exact `startsWith('dining_plan:')` filter in code (in SQL `LIKE`, `_` is a single-character wildcard, so the pattern also matches look-alike keys and the code filter makes it exact). Reason: `loadBudget` in `tripBudget/repo.ts` selects `suggestion_key` but never maps it onto the `StoredLine` it returns (it maps `linkedExpenseId` only), so every line comes back with `suggestionKey` undefined; an export built on it would never find its earlier lines, would call `createLine` again, and would fail on the unique `(trip_id, suggestion_key)` index. The same omission makes `GET /trips/:id/budget` report `suggestionKey: null` for every line; that is a separate Budget defect that this feature does not depend on and does not change (see tasks.md Notes). (Fixed 2026-11-11 as its own change after task 13; the export still uses its own adapter query, which stays correct either way.)

**Acting role for keyed lines.** `editLine` and `removeLine` reject a caller who is not an Organizer and did not create the line (`callerRole !== 'organizer' && created_by !== userId` gives `trip_forbidden`). The exported lines belong to the shared Trip scenario, not to whichever Member exported first, so a second Member re-exporting would be refused. After the route has authorized the caller (`can(role, 'edit_dining_plan')` and `can(role, 'edit_budget')`), the adapter therefore passes the caller role `organizer` to `editLine` and `removeLine`, and only for a line that `listExportedLines` returned for this Trip in this request (never for a client-supplied id and never for a line without the `dining_plan:` prefix); `userId` remains the acting Member. `createLine` records the acting Member as `created_by` as usual. The user-entered path of the Budget repo accepts a `BudgetLineInput` directly (the Budget route's price resolution only matters for sourced prices), so the export calls the repo methods and does the authorization itself (`assertTripMember`, then `can(role, 'edit_dining_plan')` and `can(role, 'edit_budget')`).

**Engine.** `computeDiningPlan` gains an option `includePerPerson`; when set, each `DiningScenarioResultDTO` also carries (not serialized to the client by default) `perPerson: { key: string; planCostByStay: Record<stayKey, number>; oopFoodCents: number; oopSnackMugCents: number; tipCents: number }[]` computed in the same pass, so the exported figures and the displayed figures cannot diverge (Property 41). With no `stays` the single Plan_Stay key is used.

*As built (task 5.10), pinned by `budgetExport.test.ts`:* `planCostByStay` is each Person's share of the plan *price* (the per-night adult, child or promotion prices summed over the stay's nights), before the tax the engine adds when `planPricesIncludeTax` is false. So with the default (prices include tax) the shares sum to the scenario's `planCostCents`, and with prices excluding tax the shares are the pre-tax price, which the export stores unchanged as Requirement 26.6 says (storing the engine's tax-added figure would make the Budget tax it twice). `perPerson` lists Plan_Eligible_Persons only. `mugsWanted` is a count, so the per-Person mug amounts give the wanted mugs first to Persons a plan covers, then in Party order. The builder takes each stay as `{ key, label, checkIn, hasPlan, held, displayName }`, a Person_Key to `memberId`/`guestId` map of active accounts, and the existing keyed lines; a group left out of `include` has its earlier line deleted (Requirement 26.7, "not part of this export"); descriptions are clipped to `BUDGET_DESCRIPTION_MAX`; `other_category_taxed` is raised only when a tips line is produced.

**Builder `buildBudgetExport`.**

```
input: { combination, include, scenario (the evaluated Combination with perPerson), stays, party (key -> memberId|guestId, active only),
         budgetTaxBps, planPricesIncludeTax, existing: { id, key, linkedExpenseId }[] }
lines = []
if 'plan' in include:   for each stay with a plan in the combination:
      allocations = for each Person on the stay with planCostByStay[stay][person] > 0:
                       amount = planPricesIncludeTax ? round(share * 10000 / (10000 + budgetTaxBps)) : share
      line { key: 'dining_plan:plan:' + stayKey, category: 'dining', plannedDate: stay.checkIn,
             description: displayName + ' (' + stayLabel + ')' + (held ? ' (already booked)' : '') }
if 'out_of_pocket':     allocations from oopFoodCents + snack/mug out-of-pocket (pre-tax); key 'dining_plan:oop'; category 'dining'
if 'tips':              allocations from tipCents; key 'dining_plan:tips'; category 'other'
drop allocations of 0; drop lines with no allocations; limit 50 allocations per line (the party limit already guarantees it)
each line input: { category, description, plannedDate?, priceSource: 'user_entered', applyTip: false, suggestionKey: key,
                   linkedExpenseId: existing?.linkedExpenseId ?? null, allocations: [{ memberId|guestId, amountCents }] }
actions = for each line: existing key ? editLine : createLine
deletes = existing keys (prefix 'dining_plan:') not produced by lines
warnings = tax_rate_mismatch when the calculator's effective tax rate != budgetTaxBps
```

The `tips` line uses category `other` because every `dining` line is taxed by the Budget and a tip is not taxable (Requirement 26.5). If an operator or user has set a non-zero tax rate for category `other`, the tips line would be taxed; the response then carries `other_category_taxed` so the sheet can say so. Rounding: `round` is half-up integer division; the plan conversion is applied per Person so the Budget's per-line tax (computed once over the line and allocated with its own largest-remainder rule) lands within one cent per allocation of the intended figure.

**Service and route.** `exportToBudget(tripId, userId, body)` runs authorization, loads the Trip's current plan exactly as `getPlan` does (with `includePerPerson`), validates the `combination` (Requirement 26.3), builds the plan, and, unless `preview`, executes creates and edits first and deletes last. `POST /trips/:id/dining-plan/export-to-budget` is registered with the other Trip routes; its body and response schemas (`diningBudgetExportBodySchema`, `DiningBudgetExportResultDTO`) live in `@dwt/shared`.

*As built (task 7.4), pinned by `exportToBudget.test.ts`, `budgetPort.test.ts` and `budgetExport.test.ts`:*

- **Evaluating the exported Combination.** A requested Combination is often none of the result's scenarios (an alternative, for example), so the service does not pick a scenario out of a `getPlan` result. The engine's `evaluateForExport(input, combination?)` evaluates that Combination with `perPerson` on the same prepared context `computeDiningPlan` uses (`prepare` is shared by both), and without `combination` it takes the recommended Combination of `computeDiningPlan(input)`. The engine input is the one `getPlan` builds (`loadInput` is shared by both). The Property 41 test asserts that for every available scenario and every alternative the evaluated terms equal the displayed ones.
- **Combination validation (Requirement 26.3).** Every Plan_Stay key must be present (Requirement 26.1 says the record maps each Plan_Stay), no other key may appear, and each option must be one of the stay's options in a Combination. A failure is `trip_validation_failed` with field `combination` and `details: { stayKey, reason }`, where `reason` is `unknown_stay`, `missing_stay`, `held_plan`, `no_plan` (also a `compare` stay past the limit) or `unavailable`; it is raised before any Budget call.
- **Ports.** `TripBudgetWritePort.getTaxBps(tripId)` returns `{ dining, other }` from `getSettings` (the builder needs the `other` rate for `other_category_taxed`), in place of a dining-only `getDiningTaxBps`. `editLine` and `removeLine` take a line handle, not an id: the adapter records by identity each handle `listExportedLines` returned and for which Trip, and refuses any other object (a hand-built `{ id, key }`, another Trip's handle, an unprefixed key) before calling the Budget repo with role `organizer`. Authorization goes through a `TripMembershipPort.roleOf(userId, tripId)` (in `partyPort.ts`), which task 8 wires to `assertTripMember`; the service then checks `can` for both actions.
- **Response.** `lines` lists the lines written (or, in a preview, to be written) in display order: plan lines by stay, then out of pocket, then tips. Deleted lines are counted in `deleted` and not listed, because their stored amounts are not read.
- **Partial failure (Requirement 26.10).** When a Budget call throws an `AppError`, the service rethrows the same code and message with `details.completedKeys` (the keys already written) and `details.failedKey`. Any other error is rethrown unchanged. A retry lists the written lines again and edits them in place.

**Mobile.** `DiningBudgetExportSheet.tsx`: opened from an "Add to Trip Budget" button on the recommended-option card; on open it calls the route with `preview: true`; it lists each line with description, category and amount, a checkbox per group, the replace-in-place note and any warning in words; Confirm calls the route with `preview: false` and `include` set from the checkboxes; success shows the created, updated and deleted counts and an "Open Budget" action that navigates to `TripBudget`; the Budget query cache is invalidated (`budgetKeys.detail(tripId)`).

### Testing additions

Shared: schemas for the period map, the export body and the suggestion `source`. Engine: Akershus-shaped rules at breakfast, lunch and dinner (Property 39); suggestions from a mixed planned-items fixture including a break item, an undated item, a non-Restaurant experience, a Restaurant with no time or meal period, a reservation and a plain item in one slot (Property 38); `buildBudgetExport` with hand-computed cents for a two-stay Combination with a held plan, a compared plan and a tips line, the tax conversion at 650 bps (for example a plan share of 10,650 cents becomes 10,000 pre-tax), a rate mismatch warning, and zero amounts omitted (Property 41). Repo (pg-mem): `loadPlannedDiningItems` against real rows, including a `NULL` `reservation_kind`. Admin: the bundled seed file validates against the rule schema; applying it to a fixture catalog inserts the matched entries, reports the unmatched and ambiguous ones, is idempotent, and never downgrades a verified rule; the normalized matching table (Property 40). Service and routes: export with fake ports creates, then re-exports to update in place, then drops a stay's plan and sees its line deleted; a non-prefixed line is never touched; `linkedExpenseId` is preserved; preview writes nothing; each authorization and validation case writes nothing (Properties 42, 43). Mobile: the import action shows planned restaurants with their source and the "N planned restaurants have no meal time" note; the export sheet previews, toggles a group off, confirms with the right `include`, and shows the counts and the Open Budget action.

## Mobile UI Redesign Extension (Requirement 27, 4-Tab Resort Chapters)

Reference visual prototype: `.kiro/specs/dining-plan-calculator/mockup.html`. This extension updates the React Native presentation layer in `apps/mobile/src/screens/trips/` with zero API, schema, or engine changes (`DiningPlanDTO` and `DiningPlanCalculatorRequest` already supply every figure needed).

### Shared Workspace Components (used by both `TripDiningPlanScreen` and `DiningPlanCalculatorScreen`)

| Component | Responsibility |
| --- | --- |
| `DiningVerdictBar.tsx` (in `DiningResultParts.tsx`) | Sticky 2-line verdict headline (`Saves about $X` / `Total $Y` + explicit winning plan & hotel), compact Requirement 21.1 `dining-disclaimer` text always visible above the fold, and expandable `Why?` drawer holding the 4-way mini-stats and `DiningQualityNotice`. |
| `DiningTabBar` (segmented 4-tab bar) | Fixed top segmented tabs: `Meals`, `Compare`, `Credits`, `Settings` (with optional `testID`s `dining-tab-meals`, `dining-tab-compare`, `dining-tab-credits`, `dining-tab-settings`). Header right profile chip (`<OrderStyle> • <Tip>% tip`) navigates straight to `Settings`. |
| `DiningResortChapters.tsx` (replaces linear `DiningMealGrid` + `DiningStaysSection` stack) | Renders the calendar filter pills (`All`, `Use Credits`, `Pay Cash`) and groups trip dates by `Plan_Stay` into collapsible chapters (`Hide days` / `Show Nd`). Each chapter renders an unmistakable 2-line plan & channel bar (`Change`) expanding the plain-English stay status (`Find best`, `Already have plan` + held plan picker, `Pay cash only`) and booking channel (`Package` / `DVC or Passholder`) or unavailable reason. Column header (`Day \| Breakfast \| Lunch \| Dinner`) appears once per chapter; meal cells display server `mealAction` tags (`Use plan`, `2 TS`, `Partly covered`, `Pay cash`) + dollar amount (`Covers $X` / `Pay $X`), `numberOfLines={2}`, and switch-day badges + slim inter-stay switch divider. When filtered (`Use Credits` / `Pay Cash`), empty chapters collapse to 1 line and days with 0 matching slots inside mixed chapters are hidden with a `Showing M of N days` bar. |
| `DiningCompareTab.tsx` (updates `DiningCompareCard.tsx`) | Shows `Best Plan Per Hotel` with explicit plan names (`PLAN_NAME`), credit breakdowns and savings; collapsible `Compare all other hotel combinations` 3-column pill matrix (`diningPlanView.ts` helper maps `alternatives` / `stays`); and collapsible 4 scenario cards where only the recommended scenario is expanded by default and others expand their 7-row breakdowns on tap, plus `Add to Trip Budget`. |
| `DiningCreditsTab.tsx` (replaces duplicate 42-meal `DiningMealList` + `DiningResultParts` bottom stack) | Visual credit meters (`Table-Service`, `Quick-Service`, `Snacks` used vs total + refillable mugs summary), Top 5 highest-value credit meals + `See all credit meals on the Calendar` button (switches to `Meals` + sets `Use Credits` filter), `DiningSensitivityTable`, and collapsible `DiningAboutFigures`. |
| `DiningSettingsForm.tsx` (extracted from `DiningSettingsSheet.tsx`) | Inline settings form rendered directly inside the `Settings` tab (and reusable in modal context if needed), exposing all Requirement 6 controls (all 4 `OrderStyle` values, 3 non-alcoholic `Beverage` options, per-adult alcohol checkboxes, `Order dessert`, `Appetizers per table`, `Snacks per person per day`, `Refillable mugs wanted`, `Kids Eat Free`, `Sales tax %`, `Table-service tip %`, plus Party steppers & custom stay dates/type when `showStay` / `showParty` on the standalone calculator). On `TripDiningPlanScreen`, saves explicitly via a sticky/bottom `Save settings` bar or `Reset` button with clear unsaved-changes / error feedback; on `DiningPlanCalculatorScreen`, updates local state immediately (`400 ms` debounced `calculateDining`). |

### Styling & Theme Discipline

All new and updated components MUST use `makeStyles` and `useAppTheme` (light + Twilight dark mode), move any bespoke accent colors into `diningPlan.palette.ts` using theme tokens, keep every interactive element accessible (`accessibilityRole`, `accessibilityLabel`, `accessibilityState`) per Requirement 22, and pass `themeRetrofit.guard.test.ts` without expanding its allowlist.
