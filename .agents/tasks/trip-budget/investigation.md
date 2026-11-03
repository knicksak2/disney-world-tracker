# Trip Budget + Expense Menu Picker: Investigation Report

Date of investigation: 2026-10-25. Read-only. No source, migration or spec was modified.

Legend: **[V]** verified (I read the code, ran a read-only query, or fetched the URL). **[A]** assumption or inference, not verified.

How I verified:
- Code and migrations: read directly.
- DB numbers: read-only `SELECT`s inside `BEGIN READ ONLY ... ROLLBACK` against the LOCAL dev DB (`DATABASE_URL` in `apps/api/.env` points at `localhost:5432/dwt`). Production counts are unknown. The local DB has only 4 trips and 4 expenses.
- Temp probe scripts were deleted afterwards. `git status` shows no untracked files.
- ThemeParks.wiki and Disney menu endpoints: single public `GET`s.
- Working-tree warning: 9 mobile files already carry uncommitted edits that are not mine. They include `ExpenseFormModal.tsx`, `ReceiptReviewModal.tsx` and `TripExpensesScreen.test.tsx` (about 167 insertions and 19 deletions). Any coder touching the expense form must start from that state and not clobber it.

---

## 0. Executive summary

### Available now

| Need | Status | Where |
|---|---|---|
| Expense ledger (cents, splits, guests, itemized, charge lines, refunds, settlements, receipt OCR) | **Done.** Menus are only lightly used (tier suggestions and name-matching). | `apps/api/src/services/tripExpenses/*`, migration `0060_trip_expenses.sql`, `packages/shared/src/tripExpenses.ts` |
| Restaurant menus with prices | **Mostly there, but prices are display strings.** 393 of 448 active restaurants have cached menus (390 non-empty) in the local DB. | `experience_menus.menus` JSONB, `diningMenuClient.ts`, `menuRetrieval.ts` |
| Lightning Lane (LL) prices by park and date | **Yes, from ThemeParks.wiki.** The schedule feed has Multi Pass, Premier Pass and per-attraction Single Pass prices for about 31 days ahead, in cents. Only Multi Pass is persisted today. | `samplingService.ts`, `park_schedule_signals.ll_multipass_price_cents` |
| Live per-attraction LL price (today only) | Yes | `LightningLaneState` in `packages/shared/src/dto/LiveDetail.ts` |
| Per-day park assignment (for per-park and per-day views) | Yes | `trips.day_touring_hours[date].startingPark` |
| Planned items (dining reservations, LL, rides) to auto-suggest budget lines | Yes | `planned_items` (`reservation_kind`, `party_size`, `planned_date`, `experience_id`, `is_lightning_lane`) |

### Missing or blocked

1. **Park admission ticket prices by date, length, age bracket and hopper.**
   - There is no legitimate machine-readable source.
   - Not in the repo. Not in ThemeParks.wiki (checked every park and the destination). Disney has no documented public API.
   - Disney's own pages are client-rendered and could not be inspected. The calendar and price pages are covered by robots.txt rules.
   - This is the one place where "just look it up" cannot be met cleanly. It needs an admin-curated price table plus a user override, with every ticket line labeled with an as-of date. Details in section 5.
2. **Traveler data.** Trips store no ages, age brackets, passholder status, ticket type, hopper flag or park-day count. Members and guests have only names and roles.
3. **Structured menu prices.**
   - The persisted price is a lossy display string such as `"$12 / $18"`.
   - It is pre-tax, because upstream calls the field `withoutTax`.
   - The upstream price `type`, the meal-period `serviceStyle`, `experience` and the group `type` are all dropped at projection.
   - Prix fixe and buffet prices are usually free text in an item title with `prices: []`, for example `"$59 per adult, plus tax and gratuity"`.
   - About 11.7% of items have no price (4,422 of 37,649).
4. **LL prices beyond the ~31-day window.** Need a labeled "typical for this park and weekday" fallback built from accumulated history.
5. **No budget schema, API or UI.**

### Biggest surprises

- **Expenses need no schema change to use a menu-item picker.** `trip-expenses` R9.4 forbids any field that distinguishes scanned items from manual ones. The picker therefore has to be a mobile-side prefill that sends the same `expenseItemInputSchema` payload (`name`, `priceCents`, `assigneeIds`, `isAlcohol`).
- **The expense form already loads a linked restaurant's menu.** It reads `GET /catalog/:id` and uses it for tier suggestions (R11.4) and receipt name-matching (R9.9). A picker is mostly new UI over data it already fetches.
- **Upstream menu data carries an alcohol signal that is dropped.** For example, the group `type` `"Alcoholic Beverage"` could pre-check `isAlcohol` for picked items.

---

## 1. Existing Expenses feature

### Spec
- Spec dir: `.kiro/specs/trip-expenses/` (requirements 1–15, design, tasks, mockup).
- Requirements:
  - R1 Record an expense
  - R2 Trip guests
  - R3 Exact and even split
  - R4 Tiered split
  - R5 Itemized split
  - R6 Net balances
  - R7 Settlements
  - R8 Edit, remove and lifecycle
  - R9 Receipt scan
  - R10 Section and authorization
  - R11 Catalog link
  - R12 Refunds
  - R13 Filter, settle-up and export
  - R14 Alcohol-excluded discounts
  - R15 Deleted accounts (added by `account-deletion`)
- Design properties 1–13. Property 8 covers receipt parsing, 9 multi-photo append, and 10 authorization.

### Data model **[V]**
Migration `apps/api/migrations/0060_trip_expenses.sql`. All money is `BIGINT *_cents`.

| Table | Key columns and constraints |
|---|---|
| `trip_guests` | `trip_id`, `sponsor_member_id`, `name`. **No age, bracket or other attributes.** |
| `expenses` | `payer_id`, `created_by`, `amount_cents` (1..10,000,000), `description`, `expense_date`, `category` (`hotel`, `tickets`, `dining`, `shopping`, `transportation`, `other`), `split_mode` (`exact`, `even`, `tiered`, `itemized`), `experience_id`, `resort_id` |
| `expense_shares` | `member_id` XOR `guest_id`, `amount_cents` |
| `expense_tiers` / `expense_tier_counts` | Named per-unit price, per-recipient unit counts. This is the existing prix fixe and per-adult/child model. |
| `expense_items` | `item_name` (≤100), `price_cents`, `is_alcohol`. **One price per row, no quantity column.** |
| `expense_item_assignees` | `member_id` XOR `guest_id` |
| `charge_lines` / `charge_line_scopes` | `kind` in `tax`, `gratuity`, `fee`, `discount`; `exclude_alcohol` |
| `expense_refunds`, `settlements` | |

- The XOR recipient pattern (member or guest) is the reusable "person" key for per-person budget views.
- There is no `qty` anywhere. Quantity is expressed by repeating item rows.
- Constants live in `packages/shared/src/tripExpenses.ts`:
  - `EXPENSE_AMOUNT_MAX_CENTS = 10_000_000`
  - `EXPENSE_LIMIT = 1_000`
  - `EXPENSE_ITEM_NAME_MAX = 100`
- Enums are in `packages/shared/src/enums.ts`: `EXPENSE_CATEGORIES`, `EXPENSE_SPLIT_MODES`, `CHARGE_LINE_KINDS`.

### Split and settlement logic **[V by file list, not line-by-line]**
- Pure modules: `allocation.ts` (`allocateProportionally`, `splitEvenly`), `balances.ts`, `itemizedTotals.ts`. Each has `*.prop.test.ts`.
- Guest shares resolve onto the guest's sponsor for balances.

### Routes **[V]**
`apps/api/src/services/tripExpenses/routes.ts`, wired in `composeServices.ts` as `tripExpenses: { repo, requireSession, pool, emitExpenseAffected }`.

| Method | Path |
|---|---|
| POST | `/trips/:id/expenses` |
| PATCH, DELETE | `/trips/:id/expenses/:expenseId` |
| POST, PATCH, DELETE | `/trips/:id/expenses/:expenseId/refunds[/:refundId]` |
| GET, POST, PATCH, DELETE | `/trips/:id/guests[/:guestId]` |
| POST, PATCH, DELETE | `/trips/:id/settlements[/:settlementId]` |
| GET | `/trips/:id/expenses` (`?category`, `?payerId`) |
| GET | `/trips/:id/balances` |
| GET | `/trips/:id/balances/:memberId/drilldown` |
| GET | `/trips/:id/expenses/export` |

### Authorization **[V]**
- Expenses use `assertTripMember(pool, userId, tripId)` from `services/trips/authz.ts`. They do **not** use a `TripAction`.
- R10.4 says no new action is needed. Edit and remove follow an "adder or organizer" rule inside the repo.
- `permissions.ts` has the `can(role, action)` matrix and `effectiveRole` (interim organizer, from `account-deletion` R7).
- Conventions say to "add new actions there rather than inventing auth". A budget should add actions (member-level add and edit, possibly organizer-level for traveler roster or ticket plan), not copy the expenses shortcut.

### Receipt-scan flow **[V]**
- Mobile only: `receiptScan.native.ts` (`expo-image-picker` plus `expo-ocr-kit`, on-device, nothing uploaded per R9.1/9.7).
- `receiptScan.pure.ts` holds the parser, plus:
  - `matchMenuItemName(recognizedName, menuItemNames)` — suggests a name only, with no price.
  - `extractTierPriceSuggestions(menus)` — regex over item name and price text for `$X per adult/child` and `Adult: $X`.
- `ReceiptReviewModal.tsx` shows a "Did you mean: …" chip (R9.9).
- `ExpenseFormModal.tsx` (about 142 KB):
  - Fetches `['experience', experienceId]` → `GET /catalog/:id` for `menus`.
  - Derives `restaurantMenuNames` and `suggestedTiers`, and shows a "Menu Pricing Suggestions" card (R11.4).

### Mobile entry points **[V]**
- `TripDetailScreen.tsx` has tile sections: `planned`, `schedule`, `reservations`, `expenses`, `booking`, `packing`, `activity`, `members`, `summary`.
- The Expenses tile (`testID="trip-detail-section-expenses"`) navigates to `TripExpenses`. `TripBalances` is also registered in `TripsStack.tsx`.
- Screens in `apps/mobile/src/screens/trips/`: `TripExpensesScreen.tsx` (about 119 KB), `TripBalancesScreen.tsx`, `ExpenseFormModal.tsx`, `ReceiptReviewModal.tsx`, `SettlementModal.tsx`, `RefundModal.tsx`, `TripGuestManagementModal.tsx`, `tripExpenseApi.ts`.
- The theme guard applies: use `makeStyles`, `useAppTheme` and `*.palette.ts`. Every new `.tsx` needs it.

### Account deletion hook **[V]**
`apps/api/src/services/accountDeletion/dispositions.ts` lists every user-FK column with a disposition. For example, expenses use `anonymize` so balances survive. New budget tables that reference `users(id)` need entries there.
- **[A]** I believe a test enforces registry completeness but did not open it. A coder should check before adding tables.

---

## 2. Menu data

### Source **[V]**
- `apps/api/src/services/catalog/disney/diningMenuClient.ts` calls Disney's public website API: `GET https://disneyworld.disney.go.com/dining/dinemenu/api/menu?searchTerm={Enterprise_Id}`.
  - No auth header.
  - Goes through the shared `DisneyTransport`, so it is rate-limited and uses a browser user agent.
- I fetched one live example (`searchTerm=90001212`, 1900 Park Fare). The response shape:
  - `mealPeriods[]` with `name`, `label`, `experience` (for example "Character Dining"), `serviceStyle` (for example "Buffet").
  - `groups[]` with `name`, `type` ("Entree", "Alcoholic Beverage", …).
  - `items[]` with `title`, `prices[]` (`withoutTax`, `type` such as "Per Serving", `currency`), `pricesRange`, `description`.
  - The buffet price appears as item titles: `"$59 per adult, plus tax and gratuity"` and `"$38 per child, plus tax and gratuity"`, both with `prices: []`.
- **Retrieval is demand-driven.**
  - `menuRetrieval.ts` fetches only when a menu is requested and stale.
  - Freshness is `MENU_FRESHNESS_MS`, default 86,400,000 ms (24 h) in `config.ts`.
  - On failure it serves the previous cache.
  - Bulk fetch was removed because of an Akamai edge block (stated in the `menuRetrieval.ts` header).

### Storage **[V]**
- `experience_menus(experience_id PK, menus JSONB, fetched_at, updated_at)` from migrations `0004` and `0005`. JSONB holds `MenuDTO[]`.
- `MenuDTO` is in `packages/shared/src/dto/Menu.ts`: `menuType` (the meal-period label), `cuisineType` (always null for this source), `groups[].items[] { name, price?: string | null }`.
- `formatDiningPrice` produces strings such as `"$20"` or `"$12 / $18"`. Only `withoutTax` is read.
  - Prices are **pre-tax and whole-dollar-or-2-decimal strings**.
  - The per-price `type`, `pricesRange`, `serviceStyle`, `experience` and group `type` are discarded.
- `food_items` (migration `0040`) has `price TEXT`, seeded as a side effect of menu fetches (`upsertFoodItemsFromMenus`). It is flattened per restaurant, but coverage is thin (below).
- `experiences.price_tier` and `meal_periods JSONB` hold tier labels only, for example `"$ ($14.99 and under per adult)"`. They are not usable as prices.

### Coverage (local dev DB, read-only, **[V] for local, [A] for prod**)

| Measure | Value |
|---|---|
| Active restaurants (`category='Restaurant'`) | 448 (444 have lat/long) |
| `experience_menus` rows | 393 (390 with items); `fetched_at` from 2026-08-26 to 2026-10-23 |
| Menu items total | 37,649; 4,422 have a null price (11.7%) |
| `food_items` | 2,285 `menu_sync` rows (1,947 priced) across only **34** restaurants, so `food_items` is NOT a good picker source. Use the JSONB menus. |
| Priced `food_items` containing `" / "` (variant prices) | 72 of 1,947 |
| Priced `food_items` not matching `$N[.NN][ / $N[.NN]]` | 0 (USD only, easy to parse) |
| Menu types (top) | Dinner 101, Snack 99, Lunch 80, Lunch And Dinner 67, Breakfast 61, All Day 40, Bar–Lounge 38 |
| Restaurants with `park IS NULL` | **143** (resort and other dining), then EPCOT 93, Disney Springs 91, MK 35, AK 33, DHS 31, BB 11, TL 11 |

### Prix fixe and buffet representation **[V]**
- There is no structured prix fixe concept anywhere.
- Patterns in the stored data:
  - Priced single entry, for example Chefs de France group "Prix Fixe Meal" → `Menu Francais`, `$67.95`.
  - Group name as a pricing banner, for example "Breakfast Buffet Pricing" with `"Buffet Breakfast" $45`.
  - Free text in item name with `price: null`: `"$49 per adult, plus tax and gratuity"` (Hollywood & Vine, Biergarten), `"$42 per child (Ages 3-9), plus tax and gratuity"` (Garden Grill).
  - Price embedded in a group name: "Splitsville … Prix Fixe Menu ($45 per person)".
  - Kids' variants as separate groups: "Menu Enfant Prix Fixe Menu".
- The existing mobile regex `extractTierPriceSuggestions` already parses the `"$N per adult/child"` and `"Adult: $N"` patterns. It should be promoted to a shared, tested pure function. It currently lives only in the mobile app.

### Tax and gratuity **[V/A]**
- Prices are pre-tax **[V]**: the upstream field is `withoutTax`, and banners say "plus tax and gratuity".
- Tax rate: a secondary source (themeparkshark.com) cites 6.5% Florida sales tax on tickets.
- **[A]** The rate for food is not verified. Make it a configurable constant. Do not hardcode.
- **[A]** Gratuity is not in the data. Disney's automatic gratuity for large parties and its amount are not verified. Offer a user-set tip percentage in the budget.

### Exposure today **[V]**
- `GET /catalog/:id` (catalog routes) returns the experience DTO with optional `menus` (`CatalogGetMenusFor`).
- Mobile `MenuScreen.tsx` already displays menus using `['experience', id]` → `GET /catalog/:id`, showing the name plus the price string verbatim. A menu list is already a pattern.

### Gap for a priced picker
The picker needs structured prices (cents, with labels such as adult, child, size, per serving), meal-period service style, and the group type. These need an additive projection change (section 7). Existing cached rows would refill lazily within 24 h of being requested.

---

## 3. Traveler data **[V]**

- `trips` columns: `id`, `creator_id`, `name`, `description`, `start_date`, `end_date`, `walking_speed`, `early_entry_eligible`, `day_touring_hours` JSONB, `walk_wait_weighting` (migrations `0015`, `0019`, `0023`, `0045`; confirmed with `information_schema`).
- `trip_memberships(trip_id, user_id, role, joined_at)`. `trip_guests(id, trip_id, sponsor_member_id, name, created_at)`. `trip_resorts(trip_id, resort_id)`.
- A grep of migrations, `packages/shared` and `apps/*` for passholder, park hopper, age bracket, ticket type and birth date found **nothing** relevant.
- The only "party size" is `planned_items.party_size` (SMALLINT 1..50, reservations only, display only).
- `early_entry_eligible` (trip level) is the nearest existing traveler-ish flag.
- A budget therefore needs a new per-trip, per-person attributes store.
  - Suggested key: the member XOR guest pattern.
  - Attributes: age bracket (adult 10+, child 3-9, under 3 free), planned ticket days, hopper, pass type.
  - Keep it on the trip. Do not add a birth date to `users` (privacy and scope).
- The age brackets (10+, 3–9, under 3 needs no ticket) come from Disney's ticket pages and the ticket-price snippets I found (disneyworld.disney.go.com). **[A]** Disney's rules can change.

---

## 4. Lightning Lane

### Live path today **[V]**
- Client: `apps/api/src/services/live/themeParksLiveClient.ts`. `getEntityLive(externalId)` → `GET {base}/entity/{id}/live`. `getEntitySchedule(externalId)` → schedule feed.
- Projection: `projectLightningLane` in `themeParksLiveProject.ts`. It reads `queue.PAID_RETURN_TIME`, then `queue.RETURN_TIME`, then `paidReturnWindow`.
- Shared type (`packages/shared/src/dto/LiveDetail.ts`):
  ```ts
  interface LightningLaneState {
    available?: boolean;
    price?: { amount: number; currency: string };  // minor units (cents)
    returnStart?: string; returnEnd?: string; state?: string;
  }
  ```
- It is attached to `LiveDetailDTO.lightningLane` per attraction and is **current only, not date-specific**. Mobile formats `amount / 100` (`liveView.ts` comment).
- Park-level live rows (`parkLiveProject.ts`) also carry `lightningLane`.

### Date-specific path (the useful one) **[V]**
- `samplingService.ts` reads each park's schedule (`getEntitySchedule(park.id)`) and picks `purchases.find(p => p.name === 'Lightning Lane Multi Pass')`.
- It stores `ll_multipass_price_cents` in `park_schedule_signals(park, date, …)`. The primary key is `(park, date)`, and migration `0020` defines it.
- Per-experience daily rows go to `experience_daily_signals(experience_id, date, ll_price_cents, ll_available, …)` from `queue.PAID_RETURN_TIME`. That is today only.
- `predictionService.ts` consumes these (`llMultipassPriceCents`, divides by 100).
- Sampling is triggered by `POST /internal/sampling/run` with `SAMPLING_CRON_SECRET`.
- **Local DB `park_schedule_signals` is empty** (0 rows), so sampling has not run there. Production state is unverified.

### Live schedule shape (fetched 2026-10-25) **[V]**
`GET https://api.themeparks.wiki/v1/entity/75ea578a-adc8-4116-a54d-dccb60765ef9/schedule` (Magic Kingdom) returned:
- `schedule[]` entries of type `OPERATING` (with `purchases[]`) and `TICKETED_EVENT` (for example "Early Entry" or "Special Ticketed Event").
- Range: 2026-10-25 to 2026-11-24, which is **31 dates**.
- Purchase kinds:

  | `type` | `name` | `id` example |
  |---|---|---|
  | `PACKAGE` | `Lightning Lane Multi Pass` | `lightninglanemultipass_80007944` |
  | `PACKAGE` | `Lightning Lane Premier Pass` | `premierpass_80007944` |
  | `ATTRACTION` | `Lightning Lane for Seven Dwarfs Mine Train` | `lightninglane_16767284` |
  | `ATTRACTION` | `Lightning Lane for TRON Lightcycle / Run` | `lightninglane_411504498` |

- Each purchase has `price { amount, currency: "USD", formatted }` and `available`. Examples: Multi Pass `3200`/`$32.00`, Premier Pass `39900`/`$399.00`, and Single Pass `1400`.
- **`amount` is in cents.**
- EPCOT, Animal Kingdom and Hollywood Studios also expose Multi Pass, Premier Pass and one Single Pass attraction each. The Blizzard Beach schedule has no purchases. The destination entity's schedule is empty.
- Single Pass ids map to catalog Enterprise_Ids: `16767284` → `16767284;entityType=Attraction` (Seven Dwarfs Mine Train) and `411504498` → TRON, both found in `experiences.upstream_entity_id`.

### Pitfalls
1. The sampler matches on the exact name string `'Lightning Lane Multi Pass'`. Prefer `type === 'PACKAGE'` plus an id prefix (`lightninglanemultipass_`) for resilience.
2. Premier Pass and Single Pass prices are not persisted. Only Multi Pass is.
3. Date coverage is only about a month, so trips further out need the labeled fallback (section 5).
4. `available: false` means sold out, but the price is still shown.
5. Prices float with demand. Third-party Thrill Data (`thrill-data.com/lightning-lane-prices`) also shows Multi Pass per park per date, "up to 21 days ahead", which is consistent with this.

---

## 5. Ticket prices (biggest unknown)

Today is 2026-10-25. Findings below come from the live fetches and searches I ran.

### Candidates

| # | Source | What it gives | Mapping needed | Cadence and reliability | License / ToS risk | Verdict |
|---|---|---|---|---|---|---|
| A | **Disney ticket pages** (`https://disneyworld.disney.go.com/admission/tickets/`, `.../theme-parks/`, `.../theme-parks-with-park-hopper/`, calendar views) | Authoritative date-based prices. Pages say prices are per day, per ticket (ages 10+) before tax, and vary by date and park. | By ticket length, start date, bracket and hopper option. | Live. My fetch of the page returned only a co-browse stub, because the content is rendered client-side. **I could not find or inspect any documented or semi-public JSON endpoint, and I found no credible reference to one.** | **High.** I could not retrieve Disney's Terms of Use text (fetch returned nothing), so ToS wording is **unverified**. `robots.txt` (fetched) disallows the `/calendars/...` paths and `/*?*price` query patterns. The repo already had an Akamai edge block on Disney web endpoints (see `menuRetrieval.ts` header). Undocumented endpoint, fragile, and likely bot-protected. | **Do not build on it.** |
| B | **ThemeParks.wiki** (`https://api.themeparks.wiki/v1`) | LL Multi Pass, Premier Pass and Single Pass by park and date (section 4). **No admission ticket data.** | `externalId` ↔ entity GUID via `themeParksDirectory.resolveEntityId`. | About 31 days ahead. Best-effort; its pricing page says data is incomplete and has no accuracy guarantee. | Commercial use allowed. Free tier: 300 req/min, attribution "Powered by ThemeParks.wiki". You may not pass data on as data for other software (public feed, bulk export). | **Primary for LL. Not for admission.** |
| C | **Thrill Data** (`https://www.thrill-data.com/lightning-lane-prices`) | LL Multi Pass and Single Pass by date, per person. | Park names. | Updated regularly. | Third-party site. No API or terms checked. | Not needed. Useful for sanity-checking B only. |
| D | **Touring Plans ticket calculator** (`https://touringplans.com/walt-disney-world/ticket-calculator`) | Compares Disney vs six authorized sellers, including tax and shipping, for 3+ day tickets. | Dates, party size. | A web tool, "updated regularly". | Commercial, affiliate-linked, no API found. | Not a data source. |
| E | **Editorial price charts** (AllEars, WDWInfo) | Date-by-date and park charts. | n/a | Both returned **HTTP 403** to my fetch. | Copyrighted editorial content. | Do not scrape. |
| F | **Disney DVC member pricing PDF** (`WDW_Pricing_Sheet_2026.pdf` on `cdn1.parksmedia.wdprapps.disney.com`) | Member-only pricing. | n/a | n/a | Not applicable to the general audience. | Ignore. |

### Price facts to size the table (secondary sources, not verified against Disney) **[A]**
- A 2026 article (themeparkshark.com, March 2026) puts 1-day, 1-park adult tickets at roughly $119–$209 by park and date, with children 3–9 slightly lower ($114–$194 quoted).
- Another snippet says Magic Kingdom's top price rose from $199 to $209 for dates in November 2026.
- Park Hopper is an add-on on top of the base ticket. Park Hopper Plus adds water parks.
- Multi-day price depends on **start date and number of days**, not a simple multiple of the 1-day price. One example showed a 7-day ticket costing less than four times the 1-day price. So multi-day prices cannot be derived from the 1-day calendar.
- The Park Hopper entry rule differs between a 2026 article (a 2 PM start) and a Disney guest-services page snippet (any time of day). It does not affect pricing, but the app should not state the rule.
- Child bracket is ages 3–9. Under 3 needs no ticket (themeparkshark article and Disney Plan Disney answers).

### Recommendation

**Tickets: admin-curated table with an as-of date, plus a user override.** Label every ticket line as "Estimate, Disney price as of <date>". This is the one deliberate "labeled estimate" exception, and it should be presented as such. The user should know that no supported feed exists.
- New table (suggested name `ticket_price_catalog`): product (base, hopper add-on, water-park), days (1–10), bracket (adult, child), park (1-day only), `start_date` band or exact date, `price_cents`, `as_of`, `source_url`.
- Maintain it from the existing admin panel (`apps/api/src/services/admin/routes.ts` plus `html.ts`, basic auth, server-rendered). Support CSV paste so a human can transcribe published prices. Reading published prices by hand is the low-risk route.
- Give the user a per-line override ("I got a quote of $X"). A user-entered price is labeled "Your price".
- Fall back to the nearest priced band if a date is missing, and show it as "Estimate".
- Revisit if Disney or a partner offers a feed.

**Lightning Lane: ThemeParks.wiki schedule, persisted.**
- Extend `samplingService.ts` to also persist Premier Pass and per-attraction Single Pass price and `available`. This is additive.
- Store about 31 days per park. At roughly 4 parks × 1 row per day it is tiny for the 1 GB Neon limit. Keep rows for a bounded window, for example prune after 400 days.
- For dates beyond the window, return a labeled "typical" price using the median for the same park and weekday (and month) from accumulated `park_schedule_signals`. When history is thin, return "no estimate" with a clear message.
- No new background worker, no extra Redis polling. Reads come from Postgres. Refresh rides the existing authenticated cron endpoint, which already returns fast and works asynchronously.

**Hosting fit (`.kiro/steering/tech-conventions.md`, `docs/hosting.md`)**
- Render sleeps after ~15 min idle; the keep-alive cron hits every ~10 min between 7 AM and 1 AM ET. No worker. Budget math runs request-time in-process on pure modules.
- Upstash ~500k commands/month. Budget reads should not touch Redis at all.
- Neon ~1 GB. Ticket table: hundreds to low thousands of rows. LL history: small. Budget lines: bounded per trip (suggest a cap, like `EXPENSE_LIMIT = 1_000`).

### Compliance notes **[V from themeparks.wiki/pricing]**
- Free tier requires a visible "Powered by ThemeParks.wiki" credit, and bans passing the data on as data for other software (public feed, widgets, user bulk export).
- The `legal-disclaimers-and-terms` spec covers the credit on `/terms` and mobile legal notices. **[A]** I did not verify that it is implemented. Check before shipping features that show more ThemeParks.wiki-sourced prices.
- Keep the budget export limited to the trip's own lines. Do not offer a raw LL price dump.
- `docs/hosting.md` says no API key is needed. The pricing page says a free key raises history to 30 days. We only use schedule and live, so this is not required.

---

## 6. Reuse points and pitfalls

| Module | Use | Notes |
|---|---|---|
| `services/trips/wdwClock.ts` | `wdwToday`, `wdwDayOfWeek(dateString)`, `wdwOffsetMinutes` for "is this date in the LL window", weekday fallback, and day math. | Store UTC `TIMESTAMPTZ`. Trip dates are DATE. |
| `services/trips/permissions.ts` | Add budget actions to the matrix. | Do not copy expenses' `assertTripMember`-only shortcut without a decision. Keep `effectiveRole` working. |
| `services/trips/authz.ts` `assertTripMember` | Gate every route. A non-member collapses to `trip_forbidden`. | Same as expenses R10.2. |
| `services/live/themeParksDirectory.ts` `resolveEntityId` | Map Enterprise_Id to the GUID for `/live` calls. | Enterprise_Id is NOT the GUID. Build includes the six parks plus the destination's own children (resort restaurants). Some restaurants (for example Aloha Isle) have no counterpart. Not a bug. |
| `Live_Service` | Today-only LL on a given ride. | Not date-specific. Use the schedule path for planning. |
| `intelligence/samplingService.ts` plus `IntelligenceRepo` | LL by park and date. | Single batch-upsert pattern. Dedupe by conflict key (`execution-discipline`): it already uses a map keyed by date. |
| Admin panel (`services/admin/*`) | Curated ticket table. | Server-rendered HTML with basic auth. A new section plus routes and tests are needed. |
| `planned_items` | Auto-suggest lines. | `reservation_kind` in `dining`, `lightning_lane`, `activity`, `other`; `party_size`; `planned_date`; `experience_id` (nullable); `is_lightning_lane`. Dining reservation → restaurant budget line prefilled with `party_size`. LL item → LL line. Custom items (`custom_title`, null experience) have no price. |
| `trips.day_touring_hours[date].startingPark` | Per-day park for per-park and per-day views and for assigning ticket-day park. | May be absent. Unassigned days need an "Unassigned" bucket. |
| Expenses types/schemas | Reuse `EXPENSE_CATEGORIES`, the member XOR guest recipient pattern, `uuidSchema`, `tripCalendarDateSchema`. | Budget needs extra categories (for example `lightning_lane`, `parking`). Do not reuse the expense category CHECK as-is. |

### Pitfalls
- **Nullable coordinates and park.** `experiences.latitude/longitude` are nullable (4 of 448 restaurants have none). `experiences.park` is null for 143 restaurants (resort dining). Per-park grouping needs an "Other / resort" bucket.
- **Money.** Always integer cents. The menu price string is dollars and may be a range (`"$12 / $18"`). Parse in one shared pure function. Do not feed display strings into math.
- **Display vs internal.** Compute totals in cents. Rounding for display only (steering modeling rule).
- **Free text prices.** `"$49 per adult, plus tax and gratuity"` has `price: null`. Parse the title with the same pure function. If nothing parses, the line should require a manual price and be marked "Your price".
- **Group size.** Menu variants differ by service style (Buffet, Prix fixe, Family-style). A picker should show them differently.
- **Receipt flow.** `receiptScan.pure.ts` and the form are untested against these new paths. `execution-discipline` requires interaction tests for every new control.
- **Theme guard.** Raw color literals fail `themeRetrofit.guard.test.ts`.
- **Account deletion registry.** New user-FK columns need dispositions (see section 1).

---

## 7. Risks, open decisions, spec impact, build order

### Risks and blockers
1. **No legitimate feed for admission prices** (section 5). Decision needed from the user: accept a curated table with an as-of label, or defer tickets.
2. **Menu price quality.** About 12% of items have no price, prix fixe and buffet prices are often free text, and prices are pre-tax. Without the projection change, the picker cannot tell adult from child or show service style.
3. **Menu coverage depends on lazy fetch.** Local DB: 393 of 448. Production is unknown. Restaurants with no cached menu would need an on-demand fetch from the picker (this goes through `DisneyTransport` and its request budget).
4. **Taxes and gratuity.** Food tax rate and automatic-gratuity rules are not in the data. They are unverified assumptions, so make them configurable and clearly labeled.
5. **LL horizon.** Only ~31 days of real prices. Trips further out depend on a labeled typical-price fallback built from accumulated history. Production history depth is unknown.
6. **Traveler model is new** (ages, hopper, passes). Also a privacy and scope decision.
7. **ThemeParks.wiki terms.** Attribution and no bulk re-export.
8. **Uncommitted changes in nine mobile files**, including the expense form. Coordinate before editing.
9. **Spec rule.** Per `tech-conventions.md`, new user-facing behavior, persisted fields, and new engine branches require the spec to be amended in the same change. Amendments are additive: do not delete or renumber requirements.

### Open decisions (my recommendation first)
1. Budget and Expenses stay **separate data models, shown together** in the trip hub. Recommend one hub tile or screen with two tabs, or two tiles. Do not merge the tables. The existing `trip-expenses` spec never mixes in estimates.
2. Per-person key: reuse the member XOR guest pattern. Add a per-trip traveler attribute table.
3. Estimates: only for (a) ticket lines from the curated table, (b) LL beyond the real-data window, (c) anything with no parseable price. Show a visible "Estimate" badge and as-of date. Every line carries a `price_source`.
4. Views: whole party, per person, per day, per park, per category. All derivable from lines plus allocations plus `startingPark`. Compute on read in a pure module (property-testable).
5. Tip and tax: percentages with defaults in a "Configuration & Constants" section, editable per trip.

### Spec impact
- **New spec `trip-budget`** (`.kiro/specs/trip-budget/`: requirements, design, tasks). It needs a Configuration & Constants section, an External Interfaces section (ThemeParks.wiki schedule `purchases`, Disney dinemenu fields, the curated ticket table, id mapping), concrete formulas, and cross-spec dependencies.
- **`trip-expenses` (additive only):**
  - A new requirement (suggest R16) for the menu-item picker. It must respect R9.4: no new persisted origin field and the same `expenseItemInputSchema` payload.
  - Amend R10.1 so the hub shows Budget next to Expenses.
  - Add a tasks entry. **No migration is needed.**
- **`restaurant-menu-display` / `disney-facilities-catalog-source` (additive):** expose structured prices (cents, price-type label), `serviceStyle`, `experience` and group `type` on `MenuDTO` items as optional fields. Existing `projectMenus` and Property 9 (round-trip) must keep passing.
- **`crowd-calendar` / `wait-time-intelligence` (additive, whichever spec owns migration `0020`):** persist Premier Pass and Single Pass prices from the schedule. Note that `disney-source-resilience` says LL is live-only, so the schedule-based persistence belongs with the intelligence spec.
- **`trips` (additive):** new `TripAction`s in the permissions matrix.
- **`account-deletion` (additive):** dispositions for new user-FK columns.
- **`admin-panel` (additive):** a curated ticket-price page.
- **`legal-disclaimers-and-terms`:** confirm the ThemeParks.wiki credit is shown wherever LL prices appear.

### Suggested build order
1. **Pure modules in `@dwt/shared`** (property-tested, ≥100 runs):
   - Price-string parser `"$12 / $18"` and `"$49 per adult, plus tax and gratuity"` → cents with labels.
   - Promote `extractTierPriceSuggestions` out of mobile.
   - Budget totals and views.
2. **Menu projection and DTO** additive change, with a regression test at the `projectMenus`/`diningMenuClient` layer. Lazy refill covers old rows.
3. **Expenses menu picker** (mobile prefill, no migration). Covers the user's third message.
4. **LL persistence**: extend sampling, add a migration for Premier and Single Pass, plus a read route (pg-mem repo test, route test). Add the typical-price fallback.
5. **Ticket catalog**: migration, repo, admin page, read route.
6. **Budget core**: traveler attributes, `budget_lines` and allocations tables (migration `0065+`, never edit applied ones), repo, routes, permissions, account-deletion dispositions.
7. **Auto-suggestions** from planned items, reservations and day parks.
8. **Mobile Budget UI** and the hub integration.

Each step should ship its own tests, per `.kiro/steering/execution-discipline.md`. The full `npm run verify` runs once for the whole change.

---

## Sources (URLs)
- ThemeParks.wiki schedule sample: https://api.themeparks.wiki/v1/entity/75ea578a-adc8-4116-a54d-dccb60765ef9/schedule
- ThemeParks.wiki plans and terms summary: https://www.themeparks.wiki/pricing
- Thrill Data LL prices: https://www.thrill-data.com/lightning-lane-prices
- Disney ticket pages: https://disneyworld.disney.go.com/admission/tickets/, https://disneyworld.disney.go.com/admission/tickets/theme-parks/
- Disney `robots.txt`: https://disneyworld.disney.go.com/robots.txt
- Disney dining menu sample payload: https://disneyworld.disney.go.com/dining/dinemenu/api/menu?searchTerm=90001212
- Touring Plans calculator: https://touringplans.com/walt-disney-world/ticket-calculator
- Price ranges article: https://themeparkshark.com/2026/03/13/disney-world-ticket-prices-2026-complete-guide-to-every-ticket-type-and-how-to-save/

Content from external pages was paraphrased for compliance with licensing restrictions.
