# Requirements Document

## Introduction

The Dining Plan Calculator answers one planning question: **"Should we buy the Disney Dining Plan, which one, and which meals should we spend credits on?"** A user describes who is going and how they eat, lists where they expect to eat (with or without a reservation), and the app compares **No Plan**, the **Quick-Service Dining Plan**, the **Table-Service Dining Plan** and the **Deluxe Table-Service Dining Plan** on one tax-inclusive, tip-aware basis. It states which plan wins, by how many dollars, and for every planned meal whether to use a credit or pay out of pocket.

The calculator is the app's second use of its restaurant data. It reads the **menus and catalog the app already caches** (`restaurant-menu-display`, `disney-facilities-catalog-source`), the **party and ages** the Trip already records (`trips`, `trip-expenses`, `trip-budget` Traveler_Profiles), and the **dining reservations** the Trip already holds (`trip-reservations`). It adds only what the app cannot know from those sources, and keeps that data **editable by the operator in the Admin_Panel**: plan price periods, per-restaurant credit rules, and a small set of default assumptions.

Rules the calculator models, and where they come from (verified against Disney's Dining Plan page on 2026-11-09; see design.md External Interfaces):

- A plan is bought for the **whole party aged 3 and over** and for the **whole stay**. Children aged 3 to 9 are on the plan at a child price and must order from the children's menu where one exists. Guests under 3 get nothing.
- Credits are issued **per person per night**. They can be used on any day of the stay, roll over day to day and expire at midnight on the day of check-out. They are **not transferable between party members**.
- **Table-service credits and quick-service credits are not interchangeable.** A table-service credit is not accepted at a quick-service location. Snack credits cannot be exchanged for meals.
- Some experiences (fine and signature dining, select character dining, dinner shows) cost **two** table-service credits per person. Gratuity is **not** included with a plan, **except** at a small set of named locations.
- The plan price **includes tax**. Menu prices do not. Comparing them without tax understates what the party would pay out of pocket and makes every plan look worse than it is. This calculator applies tax to out-of-pocket food so the comparison is like for like.
- 2026 offers two plans. 2027 offers three (a Deluxe Table-Service plan returns). In 2026, children aged 3 to 9 receive the plan free with an eligible package.

The calculator is an **estimate**, not a quote. Every figure carries its basis (a real menu price, a fixed-price offer, an operator override, or a labelled default estimate), and the screen shows how many meals were estimated and how many credit rules are unverified. It is labelled as unofficial and not affiliated with Disney.

**Depends on** (must be built after): `trips` (membership, permissions, hub, `planned_items`), `trip-expenses` (Trip_Guest, Person_Key, `findNonVisibleParties`), `trip-budget` (Traveler_Profiles, `BUDGET_DEFAULT_TAX_BPS`, `BUDGET_DEFAULT_DINING_TIP_BPS`, shared `money.ts` and `menuPricing.ts`), `trip-reservations` (dining reservations on `planned_items`), `restaurant-menu-display` and `disney-facilities-catalog-source` (cached menus, `grouped_facets`, `price_tier`), `account-deletion` (party visibility), `admin-panel`, `legal-disclaimers-and-terms`, and **`trip-lodging-stays`** (dated hotel stays and the `effectiveStays` resolver; Requirement 25 here). See the design's Cross-Spec Dependencies and Build Order.

## Glossary

- **Dining_Plan**: one of three plans, with `plan_code` `quick_service`, `table_service` or `deluxe`.
- **No_Plan**: the comparison baseline in which every meal, snack and mug is paid for out of pocket.
- **Plan_Entitlements**: the per-person, per-night credits of a Dining_Plan: `quick_service` is 0 table-service, 2 quick-service, 1 snack; `table_service` is 1, 1, 1; `deluxe` is 2, 1, 1. A mug is included in every plan.
- **Credit_Kind**: `table_service` (TS), `quick_service` (QS) or `snack`.
- **Plan_Price_Period**: one operator-managed row giving a Dining_Plan's adult and child price per night for an inclusive date range, with an optional child promotional price.
- **Kids_Eat_Free**: a Plan_Price_Period's `child_promo_cents` and `promo_label` (2026: children aged 3 to 9 at 0 cents with an eligible package).
- **Stay**: the check-in and check-out dates. Nights are the dates from check-in up to, but not including, check-out.
- **Party**: the people in the calculation. Each Person has a Person_Key, a label and an Age_Bracket.
- **Person_Key**: exactly one of a Trip_Member or a Trip_Guest, in the form `m:<id>` or `g:<id>`; standalone mode uses client-chosen keys.
- **Age_Bracket**: `adult` (10 and over), `child` (3 to 9) or `under3`, as in `trip-budget`.
- **Plan_Eligible_Person**: a Person whose Age_Bracket is `adult` or `child`.
- **Stay_Type**: `disney_resort_package` (default), `dvc_or_passholder_resort`, or `not_disney_resort`. The last makes every plan unavailable.
- **Meal_Period**: `breakfast`, `lunch` or `dinner`.
- **Meal_Slot**: one (date, Meal_Period) pair within the Stay.
- **Dining_Entry**: what the party plans to do in a Meal_Slot: `restaurant` (a catalog Restaurant Experience), `placeholder` (a typical `quick_service` or `table_service` meal, no restaurant chosen) or `skip` (no meal, or eating elsewhere). At most one per Meal_Slot.
- **Diners**: the Party members eating at a Dining_Entry: everyone except the entry's `excludedKeys`.
- **Service_Type**: `table_service`, `quick_service`, `snack_only` or `not_eligible`, the way a location uses credits.
- **Location_Rule**: an optional operator-managed row per Restaurant Experience: Service_Type, Credit_Cost, Gratuity_Included, pass-discount eligibility, per-person price overrides, and a verification status.
- **Credit_Cost**: 1 or 2 table-service credits per Diner. Always 1 for quick-service.
- **Gratuity_Included**: the location's gratuity is included when paid with a plan.
- **Rule_Status**: for a stored Location_Rule, `verified` (confirmed against Disney's own wording, with a date) or `unverified` (assumed, third-party or inferred). A location with no Location_Rule row has the non-stored status `derived`: its rule is inferred from catalog facets and Disney's statement that most table-service locations cost one credit, and it is reported separately from `unverified` so that ordinary restaurants do not make every result look provisional.
- **Order_Style**: `budget`, `typical`, `splurge` or `max_value`, selecting the percentile of a menu's entree prices used for a typical order (25, 50, 85, 100).
- **Menu_Basis**: how a meal's price was obtained, in precedence order: `admin_override`, `menu_offer` (a fixed per-person price from the menu), `menu_items` (priced items at the Order_Style percentile), `menu_estimate` (the average-entree estimate), `tier_estimate` (from the location's price tier), `default_estimate` (configured placeholder).
- **Dining_Config**: the operator-editable singleton of default assumptions (tax rate, tip rate, snack, mug and drink prices, placeholder meal prices, tier estimates, thresholds).
- **Scenario_Result**: the computed totals and per-meal coverage for one option (No_Plan or one Dining_Plan).
- **Comparison_Result**: the set of Scenario_Results with the recommendation and verdict.
- **Verdict**: `plan_saves`, `about_even`, `plan_costs_more` or `plan_unavailable`.
- **Even_Threshold**: `max(DINING_EVEN_FLOOR_CENTS, bpsOf(No_Plan total, DINING_EVEN_BPS))`.
- **Dining_Scenario**: the persisted settings and entries of one Trip.
- **Trip_Service**: the API-side service that serves a Trip's Dining_Scenario (`apps/api/src/services/diningPlan/`); as defined by `trips` for the surrounding Trip routes.
- **Mobile_App**: the React Native and Expo client in `apps/mobile`.
- **Admin_Panel**: the existing Basic-Auth operator HTML panel, as defined by `admin-panel`.
- **WDW_Today**: the current calendar date in `America/New_York`, from `wdwToday` in `services/trips/wdwClock.ts`.
- **Estimate**: any figure whose Menu_Basis is `tier_estimate` or `default_estimate`, or whose Rule_Status is `unverified`; always labelled as such.
- **Planned_Restaurant**: a `planned_items` row (without a reservation kind) whose Experience is a Restaurant and which has a date; a source of import suggestions alongside dining reservations (Requirement 5.8).
- **Budget_Export**: the explicit, user-triggered action that writes the calculator's chosen Combination into Budget_Lines of the same Trip (Requirement 26).
- **Export_Key**: the `suggestion_key` of an exported Budget_Line: `dining_plan:plan:<stayKey>`, `dining_plan:oop` or `dining_plan:tips`.
- **Plan_Stay**: one Effective_Stay of `trip-lodging-stays` (or one stay supplied to the stateless route) as the calculator sees it: dates, lodging kind, optional party subset, and a Stay_Plan_Setting. A Trip with one Plan_Stay is the single-stay case of Requirements 1 to 24.
- **Stay_Plan_Setting**: per Plan_Stay, `status` (`compare`, `have_plan` or `no_plan`), `heldPlan` (a plan code, when `have_plan`) and `channel` (`package` or `dvc_or_passholder`).
- **Hand_Off_Date**: a date that is the check-out of one Plan_Stay and the check-in of the next.
- **Combination**: an assignment of a plan code (or No_Plan) to every Plan_Stay whose status is `compare`; `have_plan` and `no_plan` Plan_Stays are fixed.
- **Baseline**: the Combination in which every `compare` Plan_Stay has No_Plan (held plans still apply).

## Requirements

### Requirement 1: Entry points and scope

**User Story:** As a user planning a Disney trip, I want a dining plan calculator inside my Trip and also available without a Trip, so that I can decide on the dining plan whether or not I have set up a Trip yet.

#### Acceptance Criteria

1. THE Trip_Detail_View SHALL present a "Dining Plan" hub tile (`HUB_SECTION_DEFS` key `diningPlan`) that opens the Dining Plan screen for that Trip.
2. THE Mobile_App SHALL provide a standalone calculator screen reachable from the Trips list that works without a Trip, using the same calculation engine and the same result layout (Requirement 20).
3. THE Trip_Service SHALL store a Trip's Dining_Scenario in tables separate from Budget and Expense tables; THE calculator SHALL NOT create, edit or delete any Budget_Line, Expense or Traveler_Profile, except the Budget_Lines written by the explicit, user-triggered export of Requirement 26 (never automatically and never as a side effect of a calculation).
4. THE calculator SHALL compare exactly: No_Plan, and each of the three Dining_Plans that is available for the Stay (Requirement 3).
5. WHERE a Stay_Type of `not_disney_resort` is selected, THE calculator SHALL mark every Dining_Plan unavailable with reason `not_disney_resort` and SHALL still report the No_Plan estimate.
6. THE calculator SHALL NOT purchase, reserve, or modify any Disney booking, and SHALL NOT call any Disney endpoint at request time (Requirement 16.6).

### Requirement 2: Plan catalogue and price periods

**User Story:** As the operator, I want to maintain plan prices by date range in the Admin_Panel, so that the calculator stays correct when Disney changes prices or adds a plan, without a code change or deploy.

#### Acceptance Criteria

1. THE system SHALL define the three plan codes `quick_service`, `table_service` and `deluxe` and their Plan_Entitlements as shared constants (`DINING_PLAN_ENTITLEMENTS_PER_NIGHT`), not as database rows.
2. THE system SHALL store Plan_Price_Periods in the table `dining_plan_prices` with: `plan_code`, `display_name`, inclusive `valid_from` and `valid_to`, `adult_cents`, `child_cents`, optional `child_promo_cents` and `promo_label`, optional `source_note` and `verified_at`.
3. THE migration SHALL seed the Plan_Price_Periods listed in design.md Configuration & Constants, idempotently, with `verified_at` NULL for every seeded row (the operator confirms each row against the Disney booking flow in the Admin_Panel).
4. THE price of one night SHALL be taken from the Plan_Price_Period of the plan whose `[valid_from, valid_to]` contains that night's date; a Stay that spans two periods SHALL use each night's own period.
5. IF any night of the Stay has no Plan_Price_Period for a plan, THEN THE calculator SHALL mark that plan unavailable with reason `no_price_for_dates` and SHALL NOT guess a price.
6. THE Admin_Panel SHALL reject a Plan_Price_Period that overlaps another period of the same plan, or whose `valid_to` is before `valid_from`.
7. THE plan prices SHALL be treated as tax-inclusive when `Dining_Config.planPricesIncludeTax` is true (default); WHEN it is false, THE calculator SHALL add `bpsOf(planCost, taxBps)` to each plan's cost.
8. THE calculator SHALL show each available plan under its period's `display_name` (for example "Disney Dining Plan" for the 2026 table-service plan) and SHALL show the period's `verified_at`, or "price not yet verified" when it is NULL.

### Requirement 3: Party, ages and stay

**User Story:** As a Trip_Member, I want the calculator to use the people and dates already on my Trip, so that I do not retype who is going, and the plan is priced for the right people and nights.

#### Acceptance Criteria

1. WHEN the Dining Plan screen opens for a Trip, THE Trip_Service SHALL build the Party from the Trip's Trip_Members and Trip_Guests, omitting any person whose account is not `active` (the same exclusion as `trip-budget`, via `findNonVisibleParties`).
2. THE Trip_Service SHALL take each Person's Age_Bracket and pass type from their `trip_traveler_profiles` row when one exists; a Person with no profile SHALL default to Age_Bracket `adult` and pass type `none`.
3. THE Stay SHALL default to the Trip's start and end dates; THE Dining_Scenario MAY override it with a custom check-in and check-out (`settings.stay`), and the screen SHALL show which is in use.
4. THE nights of the Stay SHALL be the dates `checkIn` up to but not including `checkOut`; a Stay of zero nights, or longer than `DINING_PLAN_MAX_NIGHTS` (30), SHALL make every Dining_Plan unavailable with reason `no_nights` or `stay_too_long` respectively.
5. THE calculator SHALL count Plan_Eligible_Persons as Persons with Age_Bracket `adult` or `child`; IF there are none, THEN every Dining_Plan SHALL be unavailable with reason `no_eligible_guests`.
6. THE Dining_Plan cost SHALL apply to every Plan_Eligible_Person for every night of the Stay (the plan cannot be bought for part of the party or part of the stay), and a Person with Age_Bracket `under3` SHALL have no plan cost, no credits and no mug, SHALL NOT be a Diner, and SHALL add nothing to any scenario total (the screen SHALL say that guests under 3 are not priced).
7. THE Party SHALL contain at most `DINING_PLAN_PARTY_MAX` (50) people; IF a Trip's Party is larger, THEN THE Trip_Service SHALL reject the calculation with `trip_validation_failed`.
8. WHERE the Party contains any Person whose pass type is `annual_pass` or `dvc`, THE calculator SHALL apply the pass dining discount of Requirement 12.5 and SHALL show that it did so.
9. THE Party and Stay SHALL be read at request time from the Trip; THE Dining_Scenario SHALL NOT store a copy of the roster.

### Requirement 4: Meal grid and Dining_Entries

**User Story:** As a user, I want to say where I plan to eat each day, with or without a reservation, so that the comparison reflects my real plan and not only the bookings I already hold.

#### Acceptance Criteria

1. THE Dining_Scenario SHALL hold at most one Dining_Entry per (Trip, date, Meal_Period), enforced by a unique index, and at most `DINING_PLAN_ENTRIES_MAX` (120) entries per Trip.
2. A Dining_Entry of kind `restaurant` SHALL reference an active catalog Experience of category `Restaurant`; a kind `placeholder` SHALL name `quick_service` or `table_service`; a kind `skip` SHALL reference nothing.
3. THE Trip_Service SHALL reject a `restaurant` entry whose Experience does not exist, is inactive, or is not a Restaurant, with `trip_validation_failed`.
4. WHEN a user sets an entry for a Meal_Slot that already has one, THE Trip_Service SHALL replace it (upsert), and WHEN a user clears a slot, THE Trip_Service SHALL delete the entry.
5. A Dining_Entry MAY carry `excludedKeys`: Person_Keys of Party members who are not eating that meal; THE calculator SHALL treat Diners as the Party minus those people, and a Person_Key not in the Party SHALL be ignored.
6. WHERE an entry has no Diners (everyone excluded), THE calculator SHALL treat it as `skip`.
7. WHERE an entry's date falls outside `[checkIn, checkOut]` of the Stay, THE calculator SHALL ignore it in every total and SHALL list it under `warnings` with code `outside_stay`; THE entry SHALL remain stored.
8. THE screen SHALL let the user pick the restaurant from the full catalog of Restaurant Experiences by name search, and SHALL NOT require a Trip reservation or a planned item to exist.
9. A `restaurant` entry for a location whose Service_Type is `snack_only` SHALL count as one snack per Diner added to snack demand (Requirement 11.1) and SHALL NOT be treated as a meal.
10. IF an entry's Experience has Service_Type `not_eligible`, THEN THE calculator SHALL value it as an out-of-pocket meal in every scenario and SHALL mark it `not_eligible` in the per-meal verdict.

### Requirement 5: Importing reservations

**User Story:** As a Trip_Member who already holds dining reservations, I want to pull them into the calculator in one tap, so that I only fill in the meals I have not booked.

#### Acceptance Criteria

1. THE Trip_Service SHALL expose reservation suggestions: every `planned_items` row of the Trip with `reservation_kind = 'dining'`, a non-null `planned_date` and a non-null `experience_id`, that is not already linked to an entry (`planned_item_id`).
2. THE Meal_Period of a suggestion SHALL be the row's `meal_period` when it is `breakfast`, `lunch` or `dinner`; otherwise it SHALL be derived from `planned_time` in WDW time: before 11:00 `breakfast`, from 11:00 to before 16:00 `lunch`, from 16:00 `dinner` (boundaries exact, via `wdwMinutesFromMidnight`).
3. THE party-size of a reservation SHALL NOT change the Party; IF the reservation's `party_size` is smaller than the number of Plan_Eligible_Persons, THEN THE suggestion SHALL carry the flag `partySizeMismatch` and the screen SHALL show it.
4. WHEN the user imports suggestions, THE Trip_Service SHALL create one entry per selected suggestion with `planned_item_id` set, and SHALL skip any suggestion whose Meal_Slot already has an entry unless `overwrite` is true, reporting `created`, `skippedExisting` and `skippedOutOfStay` counts.
5. THE import SHALL be idempotent: importing the same planned item twice SHALL NOT create a second entry (guarded by a unique index on `(trip_id, planned_item_id)` and by a check inside the transaction).
6. THE import SHALL be a snapshot: a later change to the planned item SHALL NOT change the entry, and deleting the planned item SHALL leave the entry in place with `planned_item_id` NULL.
7. WHERE two suggestions target the same Meal_Slot, THE import SHALL take the one with the earlier `planned_time` and report the other under `skippedExisting`.
8. IN ADDITION to dining reservations (criterion 1), THE Trip_Service SHALL suggest every `planned_items` row of the Trip with `item_type = 'experience'`, `reservation_kind` NULL, a non-null `planned_date`, and an `experience_id` whose Experience has category `Restaurant` and is active (a Planned_Restaurant: a counter-service stop or any unbooked dining stop the group has added to its itinerary), so that a user who has already planned meals does not have to re-add them; every suggestion SHALL carry `source` `reservation` or `planned_item`.
9. THE Meal_Period of a Planned_Restaurant SHALL be derived exactly as in criterion 2; WHEN the row has neither a `meal_period` of `breakfast`, `lunch` or `dinner` nor a `planned_time`, THE Trip_Service SHALL NOT suggest it and SHALL count it in `suggestionsNeedingMealPeriod`, and the screen SHALL say "N planned restaurants have no meal time; add them by hand".
10. WHERE a reservation and a Planned_Restaurant target the same Meal_Slot, THE reservation SHALL win (criterion 7 then applies among equals), and the other SHALL be reported under `skippedExisting` on import; a `partySizeMismatch` flag SHALL apply only to a reservation that has a `party_size`.
11. (Added 2026-11-09.) AN entry imported from a dining reservation SHALL keep the reservation's Experience even when it is not an active Experience of category `Restaurant` (for example a fireworks dessert party, catalog category `Event`, or a restaurant that has since closed), because the group has booked and will pay for that meal; the Restaurant check of Requirement 4.3 applies to entries a user sets by hand. Such an entry is valued like any other location (its Location_Rule, or the derivation of Requirement 8.1, which gives `not_eligible` to a location with no table- or quick-service facets).

### Requirement 6: Eating style settings

**User Story:** As a user, I want to describe how my group eats, so that out-of-pocket costs reflect what we would actually order.

#### Acceptance Criteria

1. THE Dining_Scenario `settings` SHALL contain: `stay` (optional custom dates), `stayType`, `orderStyle`, `beverage` (`water`, `soft_drink`, `specialty`), `alcoholDrinkerKeys`, `orderDessert`, `appetizersPerTable` (0 to 4), `snacksPerPersonPerDay` (0 to 4), `mugsWanted`, `kidsEatFree`, `tipBps` and `taxBps` (each optional, NULL meaning the Dining_Config default).
2. THE defaults SHALL be: `stayType` `disney_resort_package`, `orderStyle` `typical`, `beverage` `soft_drink`, `alcoholDrinkerKeys` empty, `orderDessert` true, `appetizersPerTable` 0, `snacksPerPersonPerDay` 1, `mugsWanted` 0, `kidsEatFree` true.
3. THE Trip_Service SHALL validate settings with a strict schema (unknown keys rejected, ranges enforced) and SHALL reject an invalid value with `trip_validation_failed` naming the field.
4. `mugsWanted` SHALL be at most the number of Plan_Eligible_Persons; `alcoholDrinkerKeys` SHALL contain only `adult` Persons and at most 50 keys; a key not in the Party SHALL be ignored at calculation time.
5. THE Dining_Scenario for a Trip with no stored row SHALL behave as the defaults of criterion 2 and SHALL NOT require a row to exist.
6. WHEN settings change, THE Trip_Service SHALL return the recomputed Comparison_Result in the same response.

### Requirement 7: Meal valuation

**User Story:** As a user, I want each meal priced from the real menu when the app has it, and from a clearly labelled estimate when it does not, so that I can trust the result and see where it is weak.

#### Acceptance Criteria

1. THE calculator SHALL price each Diner's meal for audience `adult` (Age_Bracket `adult`) or `child` (Age_Bracket `child`) using the first applicable Menu_Basis in this order: (1) `admin_override` from the Location_Rule's `per_person_adult_cents` / `per_person_child_cents`; (2) `menu_offer`, a fixed per-person price extracted by `extractMenuPriceOffers` for the Meal_Period; (3) `menu_items`; (4) `menu_estimate` from `computeMenuEstimatePerPerson`; (5) `tier_estimate` from the location's `price_tier` and Service_Type; (6) `default_estimate` from the configured placeholder price.
2. THE `menu_items` basis SHALL price a table-service meal as: entree at the Order_Style percentile of the audience's entree prices, plus (when `orderDessert`) a dessert at the same percentile of dessert prices, plus a beverage; and a quick-service meal as an entree plus a beverage. Percentile selection SHALL use nearest-rank on ascending integer cents (`index = ceil(p/100 * n) - 1`, clamped to `[0, n-1]`), so the chosen price is always a real menu price.
3. THE `menu_items` basis SHALL use only menus whose `menuType` matches the Meal_Period (case-insensitive contains `breakfast`, `lunch` or `dinner`), or `all day`; IF none match, THEN it SHALL use all menus.
4. FOR audience `child`, THE `menu_items` basis SHALL use the children's group (group name or type matching `kid|child`); IF the menu has none, THEN THE child price SHALL be the adult price multiplied by `childFallbackBps / 10000`, rounded half up.
5. THE beverage price SHALL be `0` for `water`, `softDrinkCents` for `soft_drink`, `specialtyBeverageCents` for `specialty`, and for a Person in `alcoholDrinkerKeys` the median priced item of the menu's alcohol groups, or `alcoholBeverageCents` when the menu has none, EXCEPT at a quick-service meal in the `breakfast` Meal_Period, where that Person's beverage SHALL be priced like everyone else's (the scenario `beverage`); an alcoholic drink SHALL therefore be priced at every table-service meal (including breakfast and brunch) and at quick-service lunch and dinner. THE beverage SHALL be added only on the `menu_items` basis; the other bases are all-in prices.
6. A table-service meal's appetizers SHALL cost `appetizersPerTable` times the appetizer price (median appetizer group item, else `appetizerCents`) shared across the Diners with `splitCentsEvenly`; appetizers SHALL never be covered by a plan credit.
7. A `placeholder` entry SHALL be valued at `placeholderQsCents` (quick_service) or `placeholderTsCents` (table_service) for an adult, with the child fallback of criterion 4 for a child; its Menu_Basis SHALL be `default_estimate`.
8. THE valuation SHALL be deterministic and SHALL return integer cents greater than 0 for every Diner of every entry that is not `skip`.
9. THE result SHALL report, per entry, its Menu_Basis; and in `dataQuality` the count of entries per basis and the count of unverified rules in use (Requirement 15).

### Requirement 8: Location rules and credit classification

**User Story:** As the operator, I want to record how each restaurant uses dining plan credits, so that the calculator knows which credit a meal needs and how many.

#### Acceptance Criteria

1. THE system SHALL derive a location's Service_Type when it has no Location_Rule: `table_service` when its `grouped_facets.tableService` is a non-empty array; otherwise `quick_service` when `grouped_facets.quickService` is a non-empty array; otherwise `not_eligible`. A derived rule SHALL have Credit_Cost 1, Gratuity_Included false, and Rule_Status `derived`.
2. THE system SHALL store Location_Rules in `dining_plan_location_rules`, one row per Experience; a row's non-null fields SHALL override the derived values, a NULL `service_type` SHALL mean "derive".
3. THE database SHALL enforce: `credit_cost` is 1 or 2; `credit_cost = 2` and `gratuity_included = true` require `service_type = 'table_service'`; `rule_status = 'verified'` requires `verified_at`.
4. THE seed action of Requirement 18.8 SHALL record each location that Disney's own channels name as costing two table-service credits (the Dining Plans page of 2026-11-09 and the planDisney answers of 2026-07-20 and 2026-04-05, listed in design.md) as `verified` with that date and source; it SHALL record every location named only by a third-party source as `unverified`; and it SHALL record no location as `verified` that Disney's channels do not name. (This replaces the earlier wording that only two restaurants were verified; Cinderella's Royal Table and Narcoossee's remain verified.)
5. THE calculator SHALL NOT infer Credit_Cost 2 for any location without a Location_Rule.
6. EACH entry's meal line SHALL report `ruleBasis` (`verified`, `unverified` or `derived`); WHERE a location's stored Rule_Status is `unverified`, THE result SHALL flag every entry that depends on it (`unverifiedRule: true`) and SHALL count it in `dataQuality.unverifiedRules`; WHERE the rule is `derived`, THE result SHALL count the entry in `dataQuality.derivedRules` and SHALL NOT set `unverifiedRule`.
7. THE per-person price overrides SHALL be positive integer cents; an override SHALL apply to the audience it names only (a missing child override falls through to the next basis for children).
8. A Location_Rule SHALL carry an optional `credit_cost_by_period`: an object whose keys are `breakfast`, `lunch` or `dinner` and whose values are 1 or 2; the Credit_Cost of an entry SHALL be `credit_cost_by_period[mealPeriod]` when present, otherwise `credit_cost`. This models locations that cost two credits only at some meals (for example Akershus Royal Banquet Hall at lunch and dinner but not breakfast; Morimoto Asia and Topolino's Terrace at dinner only). THE database SHALL require `service_type = 'table_service'` whenever `credit_cost_by_period` is set, and THE repo and Admin_Panel SHALL reject any value other than 1 or 2.
9. THE seed file SHALL deliberately err on the side of inclusion, so the operator removes a wrong row instead of adding every row by hand: it SHALL include every location named as two-credit by any source reviewed (Disney's or a third party's), and every location a source says does not accept the dining plan (recorded with `service_type = 'not_eligible'`), each with its source note and with `rule_status = 'unverified'` unless Criterion 4 makes it `verified`. Where sources disagree (for example California Grill, which older Disney answers list as two credits and a 2026 guide lists as not accepting the plan), the seed SHALL record the more recent source and say so in the note.
10. THE seed action SHALL match each seed entry to an active Restaurant Experience by `upstreamEntityId` when given, otherwise by normalized name (lower case, diacritics and punctuation removed, a leading "the" ignored) against the entry's `name` and `aliases`; WHEN a seed entry matches no Experience, or more than one, THE action SHALL skip it and SHALL list it by name and reason in the result, so the operator can fix the catalog name or add an alias.
11. (Added 2026-11-09.) WHERE a location has no Location_Rule, or one with a NULL `service_type`, and its `grouped_facets.tableService` contains the `lounges` facet and no facet other than `lounges`, `reservations-accepted`, `reservations-strongly-recommended` or `speciality-food-beverage`, THE derived Service_Type SHALL be `not_eligible` instead of `table_service`, so a bar or lounge is never covered by a credit unless the operator records a table-service rule for it. A location that also carries a meal facet (for example Raglan Road, `casual-dining` and `a-la-carte`) SHALL derive as in criterion 1. Reason: Disney's planDisney answers disagree (2026-10-03 says lounges are not included; 2026-03-19 says many accept one table-service credit and names one that does not), and the catalog files 64 of 452 active Restaurants as lounge-only, so treating them as table service by default would overstate what a plan saves.

### Requirement 9: Credit rules

**User Story:** As a user, I want the calculator to follow Disney's actual credit rules, so that it never tells me a credit works somewhere it does not.

#### Acceptance Criteria

1. THE calculator SHALL issue credits per Plan_Eligible_Person: `nights x Plan_Entitlements` for each Credit_Kind, usable on any date from check-in to check-out inclusive.
2. THE calculator SHALL NOT transfer credits between people: a Person's meals SHALL be covered only by that Person's own credits.
3. A table-service credit SHALL cover only a table-service meal; a quick-service credit SHALL cover only a quick-service meal; a snack credit SHALL cover only a snack. THE calculator SHALL NOT convert or substitute one Credit_Kind for another.
4. A table-service meal at a location with Credit_Cost 2 SHALL consume two of that Person's table-service credits, and SHALL be coverable only when the Person has at least two unused.
5. A `deluxe` plan SHALL issue 2 table-service credits per night; a `quick_service` plan SHALL issue none, so every table-service meal under it is out of pocket.
6. THE calculator SHALL cover a meal for a Person only if that Person is a Plan_Eligible_Person and a Diner of that entry.
7. THE calculator SHALL treat a plan as covering one entree, one dessert (table-service) and one beverage per credit (Requirement 7.2), and SHALL NOT treat appetizers, additional beverages, or merchandise as covered.

### Requirement 10: Optimal credit allocation

**User Story:** As a user, I want the calculator to tell me which meals to spend my credits on, so that I get the most value from whichever plan I choose.

#### Acceptance Criteria

1. FOR each Plan_Eligible_Person and each Dining_Plan, THE calculator SHALL choose the set of that Person's meals to cover that maximizes the total savings, subject to the Person's credit capacity for each Credit_Kind (Requirement 9).
2. THE savings of covering one meal SHALL be its tax-inclusive out-of-pocket cost for that Person (Requirement 12), plus its tip when the location has Gratuity_Included and the tip would otherwise be owed.
3. THE table-service choice SHALL be an exact solution of the 0/1 knapsack with item weights 1 or 2 (Credit_Cost) and capacity equal to the Person's table-service credits; THE quick-service choice SHALL be the quick-service meals of greatest savings up to the Person's quick-service credits.
4. WHERE several optimal choices exist, THE calculator SHALL choose deterministically, preferring to cover earlier meals (earlier date, then Breakfast before Lunch before Dinner).
5. A meal with savings of 0 or less SHALL never be covered.
6. THE calculator SHALL report, per Person and Credit_Kind, credits issued, used and unused, and SHALL report the party totals.
7. THE allocation SHALL be recomputed on every request from the stored entries and settings; THE calculator SHALL NOT persist an allocation.

### Requirement 11: Snacks and mugs

**User Story:** As a user, I want snack credits and the refillable mug counted, so that the plan's smaller perks are in the comparison and I can see how many snacks I would need to eat to use them.

#### Acceptance Criteria

1. A Person's snack demand SHALL be `snacksPerPersonPerDay x (number of days from check-in to check-out inclusive)` plus the number of that Person's `snack_only` entries as a Diner.
2. A snack SHALL cost `snackCents` (tax added at the tax rate) out of pocket; a plan SHALL cover `min(snack credits, snack demand)` snacks per Person.
3. THE result SHALL report, per plan, snack credits issued, used, and unused, and the snacks per day a Person would need to eat to use every snack credit (`ceil(issued / days)`).
4. THE calculator SHALL value a mug at `mugCents` plus tax; the No_Plan scenario SHALL pay for `mugsWanted` mugs out of pocket; a plan scenario SHALL cover `min(mugsWanted, Plan_Eligible_Persons)` of them (every Plan_Eligible_Person receives one mug) and SHALL pay the remainder out of pocket.
5. THE screen SHALL state that the plan mug refills only at self-service stations in Disney resort hotel quick-service locations, not in the parks or Disney Springs.

### Requirement 12: Tax, tip and pass discount

**User Story:** As a user, I want out-of-pocket costs shown the way I will actually pay them, with tax and tip, so that the comparison with a tax-inclusive plan price is fair.

#### Acceptance Criteria

1. THE calculator SHALL add tax to every out-of-pocket food, snack and mug amount at `taxBps` (the scenario value, else `Dining_Config.taxBps`, default 650), computed per Diner per line with `bpsOf`.
2. THE calculator SHALL NOT add tax to an amount covered by a credit, because the plan price already includes it (Requirement 2.7).
3. THE calculator SHALL add a tip to every table-service meal at `tipBps` (the scenario value, else `Dining_Config.tipBps`, default 1800) on the pre-tax food total, in every scenario, including meals covered by a credit.
4. WHERE a covered meal's location has Gratuity_Included, THE calculator SHALL add no tip to that meal in the plan scenario, while the No_Plan scenario SHALL still add it; the difference is part of the plan's savings.
5. WHERE the Party contains a pass holder (Requirement 3.8) and a location's `pass_discount_eligible` is not false, THE calculator SHALL reduce the pre-tax food total of each table-service and quick-service meal by `bpsOf(total, passDiningDiscountBps)` (default 1000) in every scenario.
6. THE tip SHALL never apply to quick-service meals, snacks, or mugs.
7. THE tax rate and tip rate SHALL each be an integer number of basis points between 0 and 2500 (tax) or 0 and 5000 (tip).
8. THE screen SHALL show the tax rate and tip rate used and whether each is the default or a user setting.

### Requirement 13: Scenario totals, comparison and verdict

**User Story:** As a user, I want to see what each option costs in total and which one is cheapest, so that I can decide in one glance.

#### Acceptance Criteria

1. FOR each scenario, THE calculator SHALL compute `totalCents = planCostCents + outOfPocketFoodCents + outOfPocketTaxCents + tipCents + outOfPocketSnackCents + outOfPocketMugCents`, each an integer, and SHALL return each term.
2. THE plan cost SHALL be the sum over the nights of the Stay, over the Plan_Eligible_Persons, of the night's adult or child price; WHERE `kidsEatFree` is true, the Stay_Type is `disney_resort_package`, and the night's Plan_Price_Period has `child_promo_cents`, THE child price SHALL be `child_promo_cents`, and the result SHALL name the promotion by `promo_label`.
3. THE calculator SHALL report `netSavingsCents = noPlanTotal - planTotal` for each available plan (positive means the plan saves money).
4. THE recommended option SHALL be the available option with the lowest `totalCents`, breaking ties in the order No_Plan, `quick_service`, `table_service`, `deluxe`.
5. THE Verdict SHALL be: `plan_unavailable` when no plan is available; otherwise, with `best` the available plan of greatest `netSavingsCents`: `plan_saves` when `best.netSavingsCents > Even_Threshold`; `about_even` when its absolute value is at most `Even_Threshold`; `plan_costs_more` otherwise.
6. WHERE the Verdict is `about_even` or `plan_costs_more`, THE recommended option SHALL be No_Plan; WHERE it is `plan_saves`, THE recommended option SHALL be `best`.
7. THE result SHALL report `breakEvenGapCents` = `max(0, best.totalCents - noPlanTotal)`: the extra value the party would need to capture for the best plan to break even.
8. THE result SHALL contain every number needed to render the comparison without recomputation on the client; THE Mobile_App SHALL NOT recompute totals.

### Requirement 14: Per-meal verdicts and credit summary

**User Story:** As a user, I want to see for each planned meal whether to use a credit or pay, and why, so that I know exactly what to do at the restaurant.

#### Acceptance Criteria

1. FOR each Dining_Entry (not `skip`) in each available plan scenario, THE result SHALL report `coverage` (`all`, `partial` or `none` across the Diners), `creditsUsedPerDiner`, `savingsCents` (summed across covered Diners), `outOfPocketCents`, and a `reason`.
2. THE `reason` for an uncovered entry SHALL be one of `not_eligible` (Service_Type `not_eligible`), `no_matching_credits` (the plan has no credit of that Credit_Kind, for example a table-service meal under the quick-service plan), or `better_use_elsewhere` (the Diner's credits are spent on higher-savings meals).
3. THE result SHALL flag an entry with Credit_Cost 2 (`twoCredit: true`) and an entry whose location has Gratuity_Included.
4. THE result SHALL list, per available plan, the entries ranked by `savingsCents` descending as `bestCreditUses`, so the screen can show the best meals to spend credits on first.
5. FOR the recommended option, THE screen SHALL show each entry's action as "Use plan", "Partly covered" or "Pay out of pocket", with the reason, and SHALL NOT rely on colour alone (Requirement 22).

### Requirement 15: Sensitivity, data quality and honesty

**User Story:** As a user, I want to see how sure the answer is, so that I do not over-trust a close call or a result built on guesses.

#### Acceptance Criteria

1. THE result SHALL include `sensitivity`: for each Order_Style, the best plan and its `netSavingsCents`, computed by running the engine with that Order_Style and every other setting unchanged.
2. THE result SHALL include `dataQuality`: entries per Menu_Basis, `estimatedEntries` (Menu_Basis `tier_estimate` or `default_estimate`), `unverifiedRules` (entries relying on a stored `unverified` rule), `derivedRules` (entries relying on a rule inferred from facets, no stored row), `unverifiedPrices` (plan periods in use with NULL `verified_at`), and `outsideStayEntries`.
3. THE screen SHALL show a visible notice when `estimatedEntries` or `unverifiedRules` or `unverifiedPrices` is greater than zero, stating the counts, and SHALL show the Verdict as provisional wording ("Estimated") in that case; `derivedRules` SHALL NOT trigger that notice or wording, and the screen SHALL show it only as a secondary detail line ("N restaurants use the standard rules: one table-service credit") in the quality details.
4. WHEN the Verdict is `about_even`, THE screen SHALL say the result is too close to call and show the sensitivity table.
5. THE result SHALL include `assumptions`: the tax rate, tip rate, whether plan prices include tax, the pass discount if applied, and the prices-as-of date (the latest `verified_at` of the periods in use, or null).
6. (Added 2026-11-09.) WHEN the Verdict is `about_even`, THE screen SHALL also name the cheaper option and the difference from the result's own figures (`bestPlan` and its `netSavingsCents`), for example "About even: the Table-Service plan would save about $12, less than the margin of these estimates", or "About even: no plan is about $9 cheaper". THE screen SHALL NOT mark either option as recommended for an `about_even` result: it SHALL say the choice is up to the user, show both options' totals and per-meal details, and state what favours each (a plan: paid in advance, nothing to track at the table; no plan: no unused credits and free choice of where to eat). The result's `recommended` field stays No_Plan (Requirement 13.6) and is used only where one default is needed, such as the default Combination of the Budget export, which the user can change.

### Requirement 16: Server API

**User Story:** As a Mobile_App developer, I want a small, consistent API, so that the screen is a thin view over server-computed results.

#### Acceptance Criteria

1. THE Trip_Service SHALL expose:
   - `GET /trips/:id/dining-plan` (`view_dining_plan`) returning `DiningPlanDTO`: settings, entries, party, stay, reservation suggestions, and the Comparison_Result.
   - `PUT /trips/:id/dining-plan/settings` (`edit_dining_plan`) replacing the settings, returning `DiningPlanDTO`.
   - `PUT /trips/:id/dining-plan/entries/:date/:mealPeriod` (`edit_dining_plan`) upserting one entry, returning `DiningPlanDTO`.
   - `DELETE /trips/:id/dining-plan/entries/:date/:mealPeriod` (`edit_dining_plan`) clearing one slot, returning `DiningPlanDTO`.
   - `POST /trips/:id/dining-plan/import-reservations` (`edit_dining_plan`) returning `DiningPlanImportResultDTO`.
   - `POST /dining-plan/calculate` (session only) returning `DiningPlanResultDTO` for a stateless request (Requirement 20).
2. THE actions `view_dining_plan` and `edit_dining_plan` SHALL be added to `services/trips/permissions.ts` as member actions (available to organizers and members).
3. IF a user who is not a Trip_Member requests any Trip route, THEN THE Trip_Service SHALL respond `trip_forbidden`, identically for an unknown Trip id; authorization SHALL use `assertTripMember` and `can` and SHALL NOT import `trips/effectiveRole.ts`.
4. THE routes SHALL validate params and bodies with strict Zod schemas from `@dwt/shared` and SHALL reject invalid input with `trip_validation_failed` (Trip routes) or `validation_failed` (the stateless route).
5. THE read path (`GET`) SHALL issue a fixed, bounded number of SQL statements, independent of the number of entries (`DINING_PLAN_READ_MAX_STATEMENTS`, pinned by a counting test), SHALL issue no write, and SHALL make no outbound network request and no Redis command.
6. THE read path SHALL use only cached menus; a restaurant with no cached menu SHALL be valued on the `tier_estimate` or `default_estimate` basis, and the route SHALL NOT trigger a menu fetch.
7. THE write routes SHALL run inside a transaction that locks the Trip row, so that the entry cap and the slot uniqueness hold under concurrent requests.
8. THE stateless route SHALL accept at most `DINING_PLAN_PARTY_MAX` people and `DINING_PLAN_ENTRIES_MAX` entries, SHALL write nothing, and SHALL ignore (with a warning `unknown_experience`) an entry whose Experience does not exist.
9. THE calculation SHALL be a pure function of its inputs: the same Party, Stay, settings, entries, rules, prices, menus and config SHALL always return the same result.

### Requirement 17: Persistence

**User Story:** As a user, I want my dining plan work saved with my Trip, so that I can come back to it and share it with my group.

#### Acceptance Criteria

1. THE migration `0075_dining_plan.sql` SHALL create `dining_plan_prices`, `dining_plan_location_rules`, `dining_plan_config`, `trip_dining_plan_scenarios` and `trip_dining_plan_entries` exactly as in design.md Data Models, idempotently, wrapped in `BEGIN`/`COMMIT`.
2. WHEN a Trip is deleted, THE database SHALL delete its Dining_Scenario and entries through `ON DELETE CASCADE`.
3. THE Trip tables SHALL carry no reference to a user account, so that account deletion needs no disposition entry; person keys stored inside `settings` (`alcoholDrinkerKeys`) and `excluded_keys` are plain text and are inert once the person leaves the Party. THE `SOFT_REFERENCES` ledger in `accountDeletion/dispositions.ts` SHALL gain entries for `trip_dining_plan_scenarios.settings` and `trip_dining_plan_entries.excluded_keys` stating that the keys are inert (ignored because the Party is built from visible members only) and that no scrub is required.
4. THE global tables (`dining_plan_prices`, `dining_plan_location_rules`, `dining_plan_config`) SHALL be readable by the calculation for every user and writable only through the Admin_Panel.
5. THE data volume SHALL stay bounded: at most 120 entries per Trip, one settings row per Trip, one rule row per Restaurant Experience, and a handful of price periods.
6. THE system SHALL be usable with no `dining_plan_config` values, no Location_Rules and no cached menus: missing config keys fall back to the constants in design.md, and missing rules and menus fall back to derived classification and labelled estimates.

### Requirement 18: Admin_Panel management

**User Story:** As the operator, I want to maintain plan prices, restaurant credit rules and default assumptions in the Admin_Panel, so that the calculator stays accurate without a deploy.

#### Acceptance Criteria

1. THE Admin_Panel SHALL provide `GET /admin/dining-plan` behind the existing Basic Auth, listed in the Admin_Panel navigation, with sections for plan prices, default assumptions, location rules and coverage.
2. THE Plan prices section SHALL list every Plan_Price_Period and SHALL let the operator add, edit and delete a period, validating Requirement 2.6 and showing validation errors on the page.
3. THE Default assumptions section SHALL show every Dining_Config value with its default and let the operator edit and reset them; values SHALL be validated against the `diningConfigSchema` bounds.
4. THE Location rules section SHALL let the operator search Restaurant Experiences by name, filter to "needs review" (derived or `unverified` rules), view the derived Service_Type for a location with no rule, and create, edit or delete its Location_Rule.
5. THE Coverage section SHALL show: count of active Restaurant Experiences by derived Service_Type, count with a Location_Rule, count `verified`, count with a cached menu, and count with neither a menu nor a price tier (these can only be valued by default estimate).
6. EVERY mutating Admin_Panel action SHALL be a `POST` guarded by Basic Auth and the same-origin check, SHALL escape all rendered values, SHALL redirect with a flash message, and SHALL send `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`.
7. THE Admin_Panel SHALL never display or accept free text longer than the column limits, and SHALL render a database or validation error as an in-page message without a stack trace.
8. THE Admin_Panel SHALL provide an "Apply seed rules" action that upserts the rules in `locationRules.seed.json` by `upstream_entity_id` (or exact name when the id is absent), never overwriting a rule whose `rule_status` is `verified` with an `unverified` one, and reporting how many rows were inserted, updated and skipped.
9. Changes made in the Admin_Panel SHALL take effect on the next calculation request without a restart.
10. THE "Apply seed rules" result page SHALL list every seed entry with its outcome (`inserted`, `updated`, `kept` because a stored `verified` rule is never downgraded, `unmatched`, `ambiguous`) and its source note; THE location edit form SHALL let the operator edit `credit_cost_by_period` and mark a rule verified with a date and note; and THE Location rules list SHALL offer a "seeded and unverified" filter so the operator can review and delete wrong rows quickly.

### Requirement 19: Mobile Dining Plan screen

**User Story:** As a Trip_Member, I want a clear screen that shows the verdict first and lets me edit my meals and eating style, so that I can explore options quickly on my phone.

#### Acceptance Criteria

1. THE Mobile_App SHALL add a screen `TripDiningPlan` (route param `tripId`) to `TripsStack`, opened from the hub tile of Requirement 1.1.
2. THE screen SHALL show, in order: the verdict card (recommended option and the dollar difference), the party and stay summary, the eating-style settings entry point, the meal grid, the plan comparison, the per-meal actions for the recommended option, the credit summary, the sensitivity table, and the disclaimer.
3. THE meal grid SHALL show every date of the Stay with three Meal_Slots; tapping a slot SHALL open a slot sheet to choose a restaurant (name search), a typical quick-service or table-service meal, or skip, and to exclude Diners.
4. WHEN the user saves a slot, THE Mobile_App SHALL call the entry route and SHALL update the screen from the response.
5. WHEN reservation suggestions exist, THE screen SHALL show an "Add N reservations" action that calls the import route and then shows the created and skipped counts.
6. THE settings sheet SHALL expose every setting of Requirement 6 and SHALL call the settings route on save.
7. THE comparison SHALL show, for No_Plan and each available plan: the plan cost, the out-of-pocket total, the tip, the grand total, and the net savings; and for an unavailable plan, the reason in plain words.
8. THE screen SHALL show a loading state, an error state with retry, and an empty state when the Stay has no entries ("Add the places you plan to eat"), and SHALL still show the No_Plan estimate and plan costs with no entries.
9. THE screen SHALL show money with `formatCentsAsDollarString` and SHALL NOT recompute any total.
10. THE screen SHALL follow the theming conventions (`makeStyles`, `useAppTheme`, palette files) and SHALL pass `themeRetrofit.guard.test.ts` without extending its allowlist.

### Requirement 20: Standalone calculator

**User Story:** As someone who has not created a Trip, I want to try the calculator with a few numbers, so that I can decide on the plan before I plan the trip.

#### Acceptance Criteria

1. THE Mobile_App SHALL provide a screen `DiningPlanCalculator` reachable from the Trips list, requiring a signed-in session and no Trip.
2. THE screen SHALL let the user enter the number of adults (10 and over), children (3 to 9), children under 3, check-in and check-out dates, pass holder yes/no, the same eating-style settings, and the same meal grid, held in local component state.
3. THE screen SHALL call `POST /dining-plan/calculate` (debounced by 400 ms after the last edit) and SHALL render the same verdict, comparison, per-meal actions and credit summary as the Trip screen.
4. THE standalone screen SHALL persist nothing on the server and SHALL clearly say its entries are not saved.
5. WHERE the user later opens a Trip's Dining Plan screen, THE standalone entries SHALL NOT be carried over.

### Requirement 21: Disclaimers and labelling

**User Story:** As the operator, I want the calculator to be clearly an estimate and independent of Disney, so that users are not misled and the app stays within its legal posture.

#### Acceptance Criteria

1. THE screen SHALL show, above the fold of the result, the text "Estimate only. Not affiliated with or endorsed by Disney. Plan prices and rules change; confirm in the Disney booking flow before you buy."
2. THE screen SHALL label any figure based on a `tier_estimate` or `default_estimate` as "Estimate", and any rule that is `unverified` as "Unverified rule".
3. THE screen SHALL show the plan prices' "as of" date (Requirement 15.5) and "price not yet verified" for a period with NULL `verified_at`.
4. THE calculator SHALL NOT display Disney logos or imagery; plan names SHALL be shown as text.
5. THE `legal-disclaimers-and-terms` spec SHALL gain Requirement 9 recording that Dining Plan figures are user-facing estimates derived from public information and operator-entered rules (cross-spec amendment, Requirement 24).

### Requirement 22: Accessibility and theming

**User Story:** As a user with low vision or colour blindness, I want the verdict and per-meal actions understandable without relying on colour, so that I can use the calculator.

#### Acceptance Criteria

1. THE verdict, the per-meal action ("Use plan", "Partly covered", "Pay out of pocket"), "Estimate" and "Unverified rule" labels SHALL each be conveyed by text and an icon, never by colour alone.
2. EVERY interactive control SHALL have an accessibility label, and every meal slot SHALL announce its date, Meal_Period and current content.
3. THE screen SHALL repaint correctly in light and "Twilight" dark themes.
4. TEXT and money SHALL scale with the system font size without clipping the verdict card.

### Requirement 23: Limits and determinism

**User Story:** As the operator on a free hosting tier, I want the calculator to be cheap and predictable, so that it cannot exhaust the database or the server.

#### Acceptance Criteria

1. THE calculation SHALL be bounded: at most 50 people, 120 entries, 30 nights, 4 plans and 4 sensitivity runs; its worst-case work SHALL be bounded by these constants and SHALL involve no network I/O.
2. THE read path SHALL use no Redis and no background job; THE feature SHALL add no cron, worker or scheduled task.
3. THE stateless route SHALL be subject to the application's existing request body limit and session requirement and SHALL write nothing.
4. THE result SHALL be deterministic (Requirement 16.9) and every amount SHALL be a safe integer number of cents.

### Requirement 24: Cross-spec amendments (additive)

**User Story:** As a maintainer, I want the specs this feature touches to record it, so that nothing is orphaned.

#### Acceptance Criteria

1. THE `trips` spec SHALL gain the next free requirement number (expected 27, after `trip-lodging-stays` takes 26) adding the actions `view_dining_plan` and `edit_dining_plan` to the permission matrix and the "Dining Plan" hub tile.
2. THE `admin-panel` spec SHALL gain the next free requirement number (expected 19) describing the Dining Plan section (Requirement 18 here).
3. THE `legal-disclaimers-and-terms` spec SHALL gain the next free requirement number (expected 9) of Requirement 21.5.
4. THE `restaurant-menu-display` spec SHALL gain a requirement recording the additive shared helpers `classifyMenuGroup` and `menuGroupItemCents` exported from `packages/shared/src/menuPricing.ts` (design.md Components).
5. EACH amendment SHALL be additive: no existing requirement, acceptance criterion or design section SHALL be removed or renumbered, and the numbers used SHALL be re-checked against the target file at implementation time.
6. THE `trip-budget` spec SHALL gain the next free requirement number recording that Budget_Lines whose `suggestion_key` starts with `dining_plan:` are created, updated and deleted by the Dining Plan export of Requirement 26 through the existing Budget repo, are ordinary Budget_Lines for every other purpose, and are never produced by the Budget's own suggestions.

### Requirement 25: Multiple stays and per-stay plans (added with `trip-lodging-stays`)

**User Story:** As a Trip_Member on a split stay, I want the calculator to treat each hotel booking separately, so that I can say I already hold a dining plan for one hotel, compare plans for another, and still get the best use of credits on the day we move between them.

This requirement is additive. A Trip with one Plan_Stay behaves exactly as Requirements 1 to 24 describe (Property 31). Where this requirement and an earlier one differ for a Trip with several Plan_Stays, this requirement governs; the earlier wording describes the single-stay case.

#### Acceptance Criteria

1. FOR a Trip, THE Trip_Service SHALL take the Plan_Stays from `effectiveStays` of `trip-lodging-stays` (dated stays, plus the synthesized segments that resolver returns); FOR the stateless route, THE calculator SHALL take the Plan_Stays from the request; a Plan_Stay carries `key`, `label`, `lodgingKind`, `checkIn`, `checkOut`, `partyKeys` and `source`.
2. A Plan_Stay SHALL be plan-eligible when its `lodgingKind` is `resort`, when its `source` is `legacy_resorts` (the first undated stay is a Disney Resort), or when its `source` is `implicit_no_lodging` or `implicit_gap` (lodging not yet recorded, assumed to be a Disney Resort package so a user can decide before booking, labelled "No lodging recorded; assuming a Disney Resort package"). A Plan_Stay of kind `partner_hotel` or `offsite` with `source: 'stay'` SHALL be unavailable with reason `not_disney_resort`.
3. THE Dining_Scenario `settings` SHALL gain `stayPlans`: a map keyed by Trip stay id (or `implicit:<checkIn>` for a synthesized segment) of Stay_Plan_Settings, defaulting to `{ status: 'compare', heldPlan: null, channel: 'package' }`; a missing key behaves as the default; keys that match no Plan_Stay SHALL be ignored.
4. WHEN a Plan_Stay has status `have_plan`, THE calculator SHALL fix that Plan_Stay to its `heldPlan` in every scenario, SHALL include its plan cost in every scenario total, and SHALL allocate its credits to that stay's meals like any plan; IF no Plan_Price_Period covers a night of a held plan, THEN its cost SHALL be 0 and the result SHALL carry the warning `held_plan_price_unknown`.
5. WHEN a Plan_Stay has status `no_plan`, or is unavailable by criterion 2, THE calculator SHALL give it no plan and no credits, and every meal on its nights SHALL be paid out of pocket.
6. Each Plan_Stay with a plan SHALL issue its own credits per Plan_Eligible_Person on it (Requirement 9.1 applied per stay): credits SHALL NOT carry from one Plan_Stay to another, and a Plan_Stay's credits SHALL be usable from its check-in date to its check-out date inclusive.
7. A meal on a Hand_Off_Date SHALL be coverable by either Plan_Stay's credits when both are plan-active for that Person; THE calculator SHALL choose, for each Person, the assignment of such meals to the outgoing stay, the incoming stay, or neither that maximizes total savings subject to every stay's credit capacity (Requirement 10.1 generalized), preferring the outgoing stay's credits when savings are equal because those credits expire that night.
8. A Plan_Stay with `partyKeys` SHALL issue credits and charge plan cost only for Party members named in it; a Party member not on a Plan_Stay SHALL still be a Diner for meals on its dates and SHALL pay those meals out of pocket; `partyKeys` null SHALL mean the whole Party.
9. THE calculator SHALL evaluate every Combination of plan choices for the `compare` Plan_Stays, where each `compare` Plan_Stay's options are No_Plan and each Dining_Plan available for all its nights; at most `DINING_PLAN_COMPARE_STAYS_MAX` (3) Plan_Stays may be `compare`, and any further `compare` Plan_Stay (in date order) SHALL be treated as `no_plan` with the warning `too_many_compare_stays`.
10. THE recommended Combination SHALL be the one with the lowest `totalCents`, breaking ties by fewest plans bought, then by the order No_Plan, `quick_service`, `table_service`, `deluxe` for each Plan_Stay in date order; THE Verdict and Even_Threshold of Requirement 13 SHALL be applied to the recommended Combination against the Baseline.
11. THE result SHALL additionally report, when there is more than one Plan_Stay: `stays` (per Plan_Stay: key, label, kind, dates, nights, party count, status, held plan, recommended plan, plan cost, credit summary, and `contributionCents`, the increase in total if this stay's recommended plan were removed with the others unchanged), `recommendedCombination` (plan code per stay key), and `alternatives` (up to 5 other Combinations with their totals and net savings); and every per-meal line SHALL carry its `stayKey` and `coveredByStayKey`.
12. SNACK credits SHALL be issued and consumed per Plan_Stay, with each calendar date attributed to the Plan_Stay that has that Night (the final check-out date to the last stay); a MUG SHALL be counted at most once per Person, covered when that Person is on at least one plan-active Plan_Stay.
13. THE price of each night, the Kids Eat Free promotion and the `channel` SHALL be evaluated per Plan_Stay; the promotion SHALL apply only to a Plan_Stay whose `channel` is `package`.
14. THE calculator SHALL bound the work: at most 8 Plan_Stays, each of at most `DINING_PLAN_MAX_NIGHTS` (30) nights, a total span from the earliest check-in to the latest check-out of at most `DINING_PLAN_SPAN_MAX_DAYS` (60) days, and at most 3 `compare` stays; a Trip beyond the span limit SHALL be rejected with `trip_validation_failed`.
15. THE Dining Plan screen SHALL show each Plan_Stay as a row with its hotel name, dates and a control to set its status (Compare plans, I already have a plan with a plan picker, No plan) and, for a Disney Resort stay, its channel; SHALL mark each Hand_Off_Date in the meal grid with text saying either stay's credits can be used that day and that the calculator picks whichever saves the most; SHALL show the hotel name under each date; and SHALL show the per-stay results and the recommended Combination in words, for example "Table-Service plan for Contemporary (Dec 15 to 20); no plan for Pop Century (Dec 20 to 26)".
16. THE screen SHALL show the explanation "Credits do not carry between hotels. Meals on the day you switch can use either hotel's credits." beside the Hand_Off_Date marker.
17. THE stateless route SHALL accept an optional `stays` array of Plan_Stays with their Stay_Plan_Settings; WHEN omitted it SHALL behave as one Plan_Stay spanning the request's stay; the standalone screen MAY remain single-stay.
18. THE read path SHALL load the Trip's stays with one additional statement (`DINING_PLAN_READ_MAX_STATEMENTS` becomes 19) and SHALL remain independent of the number of entries. (Amended 2026-11-10, task 8: the bound was measured and pinned lower, as design.md "Request flows" allows: `DINING_PLAN_READ_MAX_STATEMENTS` is 17, which is 16 statements for a Party with a guest plus 1 roster read while the Trip has no active Organizer.)

### Requirement 26: Send to Trip Budget

**User Story:** As a Trip_Member who has decided on a dining plan (or on no plan), I want to put the plan cost, the meals I will still pay for, and the tips into my Trip Budget in one step, so that I do not retype the numbers and my savings plan covers dining.

This requirement is additive. The calculator remains read-only with respect to the Budget except through this explicit action (Requirement 1.3).

#### Acceptance Criteria

1. THE Trip_Service SHALL expose `POST /trips/:id/dining-plan/export-to-budget` with body `{ combination?, include?, preview? }`: `combination` maps each Plan_Stay key to a scenario code (default: the recommended Combination of the current result); `include` is a non-empty subset of `plan`, `out_of_pocket` and `tips` (default: all three); `preview` (default false) returns the lines that would be written and writes nothing.
2. THE route SHALL require that the caller may perform both `edit_dining_plan` and `edit_budget` on the Trip (`assertTripMember`, then `can` for each), and SHALL respond `trip_forbidden` to a non-member or unknown Trip identically to the other Trip routes.
3. IF `combination` names a plan that is unavailable for a stay, or names a stay key that is not a Plan_Stay of the Trip, or contradicts a `have_plan` or `no_plan` setting, THEN THE route SHALL respond `trip_validation_failed` and write nothing.
4. THE export SHALL produce up to these Budget_Lines, each with `priceSource` `user_entered` and `applyTip` false:
   a. `plan`: one per Plan_Stay with a plan in the Combination (including a `have_plan` stay, whose description ends "(already booked)"), Export_Key `dining_plan:plan:<stayKey>`, category `dining`, `plannedDate` the stay's check-in, description "<plan display name> (<hotel label>)", one allocation per Plan_Eligible_Person on that stay holding that Person's share of the stay's plan cost.
   b. `out_of_pocket`: Export_Key `dining_plan:oop`, category `dining`, no date, description "Dining out of pocket (estimate)", one allocation per Person holding that Person's pre-tax out-of-pocket meals, appetizers, snacks and mugs for the Combination.
   c. `tips`: Export_Key `dining_plan:tips`, category `other`, no date, description "Dining tips (estimate)", one allocation per Person holding that Person's tips for the Combination (zero for gratuity-included meals covered by a credit).
5. THE tips SHALL be a separate line in category `other` because the Budget applies tax to every `dining` line and applies a tip only to a line's own subtotal; a tip is not taxable and the calculator's tip depends on the meal type and on whether a credit covers it.
6. BECAUSE the Budget stores pre-tax amounts and adds tax at read time, THE export SHALL convert each plan-cost share to `round(share x 10000 / (10000 + r))` where `r` is the Trip's effective Budget dining tax rate in basis points (from `getSettings`, else `BUDGET_DEFAULT_TAX_BPS.dining`), unless `planPricesIncludeTax` is false, in which case the share is stored unchanged; out-of-pocket and tip amounts are already pre-tax and are stored unchanged. THE resulting Budget total for each exported line SHALL be within 1 cent per allocation of the calculator's tax-inclusive figure for that line when the Budget's dining tax rate equals the calculator's tax rate; WHEN the two rates differ, THE response SHALL carry a warning `tax_rate_mismatch` naming both.
7. THE export SHALL be idempotent and shall identify its lines by Export_Key: a line whose key exists SHALL be replaced in place (same id, preserving its `linkedExpenseId`); a line whose key does not exist SHALL be created; a previously exported line (key prefix `dining_plan:`) that is not part of this export, including because its stay no longer has a plan or its amounts are now zero, SHALL be deleted; and no Budget_Line without that prefix SHALL be read for modification, changed or deleted.
8. A line whose every allocation is zero SHALL NOT be created; an allocation of zero SHALL be omitted; at most `BUDGET_ALLOCATIONS_PER_LINE_MAX` (50) allocations are written per line; Persons whose accounts are not `active` SHALL be omitted.
9. THE response SHALL contain `{ created, updated, deleted, lines: [{ key, lineId, description, category, subtotalCents }], warnings }`; with `preview` true the same shape with `lineId` null and nothing written.
10. THE Budget repo calls (`createLine`, `editLine`, `removeLine`) run in their own transactions, so the export is not one atomic transaction; it SHALL therefore be safe to retry (criterion 7), SHALL process deletions last, and SHALL report a failure as `trip_validation_failed` or the Budget's own error without hiding which keys succeeded.
11. WHERE the Budget would exceed `BUDGET_LINE_LIMIT`, THE route SHALL surface the Budget's `trip_validation_failed` unchanged.
12. THE Mobile_App SHALL show an "Add to Trip Budget" action on the result; WHEN tapped it SHALL call the route with `preview: true`, show each line with its description and amount and a checkbox per group (plan, out of pocket, tips), and on confirmation call it again with `preview: false`; on success it SHALL show how many lines were created, updated and deleted and an "Open Budget" action; the sheet SHALL say that exporting again updates the same lines and that lines you edited in the Budget will be overwritten.
13. THE export SHALL NOT run automatically, SHALL NOT be called by any read route, and SHALL NOT change the Dining_Scenario.
14. THE calculator's per-Person amounts for the export SHALL come from the same engine run that produced the displayed result (an engine option `includePerPerson`), so that the exported lines sum to the displayed figures: the sum over Persons of each exported group equals the corresponding scenario term.
15. ANY Trip_Member who may perform both `edit_dining_plan` and `edit_budget` SHALL be able to re-export and thereby update or delete the `dining_plan:` Budget_Lines that another Member created, because those lines belong to the shared Trip scenario; THE export SHALL act with the Organizer role toward the Budget repo for those keyed lines only, after the authorization of criterion 2, and SHALL NOT use that role for any other line or for any client-supplied line id.
16. THE export SHALL find its earlier lines by their Export_Key through a query of its own over `trip_budget_lines` (the Budget's `loadBudget` does not return `suggestion_key`), so that re-exporting updates in place and never creates a duplicate key.

### Requirement 27: Mobile UI Redesign — 4-Tab Resort Chapters (additive; updates layout of Requirements 19.2 and 25.15)

**User Story:** As a Trip_Member planning a multi-day or split-stay trip on mobile, I want a clean, scannable, non-repetitive layout where I see Day 1 meals near the top, edit each hotel right in place, and view comparisons, credits, and settings in dedicated tabs, so that managing a long trip feels effortless rather than overwhelming.

This requirement is additive to the engine, API, accessibility (Requirement 22), data-honesty (Requirement 15), and disclaimer (Requirement 21) guarantees. Where the screen layout order or section grouping differs from Requirement 19.2 or 25.15, this requirement governs.

#### Acceptance Criteria

1. THE screen SHALL replace the tall top stack with a compact sticky verdict header containing:
   - a two-line headline bar (line 1: net savings headline + grand total + `Why?` toggle; line 2: recommended plan and stay summary with explicit official plan names, never abbreviations like `DDP`),
   - an expandable `Why?` drawer showing the hotel-specific explanation, the 4-way mini comparison (`No Plan`, `Best Mix`, `All QS`, `All Dining`), any data-quality estimate/unverified-rule notice, and the Requirement 21.1 non-Disney disclaimer (`dining-disclaimer`), and
   - a fixed 4-tab segmented bar (`Meals`, `Compare`, `Credits`, `Settings`) immediately below the verdict header.
2. THE `Meals` tab SHALL present:
   - a compact 2-row reservation import banner (`N reservations ready`, party-mismatch badge if applicable, `Review` drawer showing source & missing-meal-time note, and `Add N reservations`),
   - a calendar filter bar (`All`, `Use Credits`, `Pay Cash`), and
   - days grouped by `Plan_Stay` into collapsible **Resort Chapters** (`Hide days` / `Show Nd`), removing any duplicate top hotel strip.
3. EACH Resort Chapter header SHALL display the stay name, date range, nights, party count, and a clearly interactive 2-line plan & channel bar (`Change` toggle) that expands inline controls for:
   - stay status using plain language (`Find best` / `compare`, `Already have plan` / `have_plan` with a `Disney Quick-Service Dining Plan` vs `Disney Dining Plan` picker, `Pay cash only` / `no_plan`), and
   - booking channel (`Package — Kids Eat Free eligible` vs `DVC / Annual Passholder`), or the plain-words unavailable reason when `not_disney_resort`.
4. INSIDE each Resort Chapter, the column header (`Day | Breakfast | Lunch | Dinner`) SHALL appear once per chapter (not repeated inside every cell); each meal cell SHALL clamp long full restaurant names cleanly to two lines with an ellipsis (`numberOfLines={2}`) while tapping opens `DiningSlotSheet` showing the full restaurant name, all 4 real meal choices (`A restaurant`, `Typical table-service`, `Typical quick-service`, `Skip this meal`), `Who is eating` per-diner checkboxes, and `Clear this slot`; and each hand-off date SHALL show a compact switch-day marker plus a single slim divider note between adjoining stays explaining that credits do not carry over and either stay's credits may be used on switch day.
5. WHEN the `Use Credits` or `Pay Cash` filter is active on `Meals`:
   - ANY Resort Chapter with zero matching meals SHALL auto-collapse to a single slim summary row (`0 credit meals` / `0 cash meals`), and
   - ANY day inside a mixed stay with zero matching meals SHALL be hidden, with a slim note (`Showing M of N days with ... meals` + `Show all`) and muted non-matching slots in the visible rows.
6. THE `Compare` tab SHALL display:
   - a `Best Plan Per Hotel` card spelling out the exact Disney plan name (`No Plan (Pay Cash)`, `Disney Quick-Service Dining Plan`, or `Disney Dining Plan`), credit inclusions, and per-stay savings,
   - a collapsible `Compare all other hotel combinations` drawer rendering alternatives as a clean multi-column pill matrix rather than semicolon-delimited sentences,
   - all evaluated scenario cards as bar meters where the recommended/mixed scenario starts expanded and other scenarios toggle their 7-row accounting breakdown on tap (all amounts still formatted strictly from server values), and
   - the `Save to Trip Budget` (`Add to Trip Budget`) button opening `DiningBudgetExportSheet`.
7. THE `Credits` tab SHALL eliminate any duplicate 42-item per-meal scroll list (since the `Meals` tab filter already serves that view) and instead show:
   - visual credit progress meters (Table-Service, Quick-Service, Snacks used vs total + refillable mugs note),
   - Top 5 highest-value credit meals plus a `See all credit meals on the Calendar` button that switches to `Meals` with `Use Credits` active, and
   - the server's `Sensitivity` comparison and collapsible `About these figures` notes (pricing `as of` date, tax/tip rates, buffet/fixed-price and passholder rules).
8. THE `Settings` tab SHALL expose all eating-style controls of Requirement 6 inline (including all 4 `How do you order?` choices: `Budget`, `Typical`, `Splurge`, `Most expensive`; `Usual drink`; `Who orders alcohol (adults only)`; `Order dessert`; `Appetizers per table`; `Snacks per person per day`; `Refillable mugs wanted`; `Kids Eat Free`; `Sales tax %`; `Table-service tip %`) — plus party size and custom stay dates/type when on the standalone `DiningPlanCalculator` screen — and a quick header chip (`<OrderStyle> • <Tip>% tip`) jumping directly to `Settings`.
