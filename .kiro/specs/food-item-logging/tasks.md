# Implementation Plan

## Tasks

- [x] 1. Migration and Shared Schema Contracts
  - [x] 1.1 Create migration `apps/api/migrations/0040_food_item_logging.sql` adding `user_submitted_locations` (`name`, `park` CHECK against the Park enum, `created_by_user_id`, `UNIQUE (park, lower(name))`, plus a `gin (lower(name) gin_trgm_ops)` trigram index — `pg_trgm` is already installed by `0001_init.sql`), `food_items` (with `experience_id` and `location_id` both nullable, `name`, `price`, `source` CHECK `menu_sync|user_submitted`, `created_by_user_id`, `last_seen_at`, a scope-exclusivity CHECK requiring exactly one of `experience_id`/`location_id`, `UNIQUE (experience_id, lower(name))`, `UNIQUE (location_id, lower(name))`), and `food_item_logs` (mirroring `experience_logs`' `visited_on`/`user_tz`/`logged_at`/`rating`/`note` shape, FK to `food_items` with `ON DELETE CASCADE`)
  - [x] 1.2 Add migration unit test `apps/api/src/db/__tests__/migration0040.test.ts` asserting all three tables, every CHECK/UNIQUE constraint (including the scope-exclusivity CHECK and the per-location unique-name constraint), the trigram index exists, and cascade-on-experience-delete/location-delete
  - [x] 1.3 Add `foodItemNameSchema` to `packages/shared/src/schemas/primitives.ts` (reused for both dish and location names); define `FoodItemDTO` (`experienceId`/`locationId` both nullable), `FoodItemLogDTO`, `FoodItemLogHistoryDTO`, `CreateFoodItemLogInputDTO`, `SubmitFoodItemInputDTO`, `UserSubmittedLocationDTO`, `CreateUserSubmittedLocationInputDTO`, `LocationSuggestionDTO` and matching Zod schemas in `packages/shared/src/schemas/FoodItem.ts` / `FoodItemLog.ts` / `UserSubmittedLocation.ts`
  - [x] 1.4 Barrel the new DTOs/schemas in `packages/shared/src/dto/index.ts` and `packages/shared/src/schemas/index.ts`; add `food_item_not_found`, `food_item_duplicate`, `food_log_not_found`, `food_log_future_date`, `location_duplicate` to `ERROR_CODES` and `errorCodeToHttpStatus` in `packages/shared/src/errors.ts`; add schema/error-catalog tests for both valid and invalid cases

- [x] 2. Food Item Repository and Menu_Retrieval Seeding Hook
  - [x] 2.1 Implement `FoodItemRepo` in `apps/api/src/services/foodLog/repo.ts`: `upsertFoodItemsFromMenus(experienceId, menus, seenAt)` (insert/update-only, extracts `groups[].items[].name`/`price`, case-insensitive upsert via `ON CONFLICT (experience_id, lower(name))`, never deletes an absent item), `listFoodItems(experienceId)` (computes `currentlyOnMenu` per the `experience_menus.fetched_at` comparison in design.md), `submitFoodItem(experienceId, userId, name)` (case-insensitive collision → `AppError('food_item_duplicate', ..., { details: { existingId } })`)
  - [x] 2.2 Widen `MenuRetrievalRepo` in `apps/api/src/services/catalog/menuRetrieval.ts` with `upsertFoodItemsFromMenus`; call it from `createMenuRetrieval`'s fetch-success branch (after `upsertMenus`, never on cache-hit serve or fetch failure)
  - [x] 2.3 Write property tests `apps/api/src/services/foodLog/__tests__/foodItems.prop.test.ts` validating Property 1 (menu-sync idempotence/failure isolation), Property 2 (submission dedup), and Property 7 (menu departure preserves logs, `currentlyOnMenu` computed correctly, logging/history still succeed) with `fast-check`, against pg-mem
  - [x] 2.4 Write `apps/api/src/services/catalog/__tests__/menuRetrieval.foodItems.test.ts` asserting `upsertFoodItemsFromMenus` is invoked exactly once per real fetch, never on a fresh-cache serve, never on a fetch failure

- [x] 3. Food Item Log Repository
  - [x] 3.1 Implement `FoodItemLogRepo` in `apps/api/src/services/foodLog/repo.ts` (or a co-located `logs.ts`): `addLog(input: CreateFoodItemLogInput)`, `getLogHistory(userId, foodItemId)` (ordered `visited_on DESC, logged_at DESC`), `deleteLog(userId, foodItemId, logId)` — no writes to `completions`/`ratings`/`experience_logs`; add scope-exclusivity validation (Requirement 6.6) so a Food_Item creation/log request naming neither/both of `experienceId`/`locationId` is rejected `validation_failed` before any write
  - [x] 3.2 Write property tests `apps/api/src/services/foodLog/__tests__/foodItemLogs.prop.test.ts` validating Property 3 (independence from completions/ratings), Property 4 (ordering/repeat count), Property 5 (no future date), and Property 9 (scope exclusivity) with `fast-check`

- [x] 4. User_Submitted_Location Repository (Similarity-Suggest Dedup)
  - [x] 4.1 Implement `UserSubmittedLocationRepo` in `apps/api/src/services/foodLog/locations.ts`: `createLocation(userId, name, park)` (case-insensitive `(park, name)` collision → `AppError('location_duplicate', ..., { details: { existingId } })`), `suggestLocations(park, name, limit = LOCATION_SUGGEST_LIMIT)` (the `similarity()`-scored, `LOCATION_SIMILARITY_THRESHOLD`-filtered query from design.md, ordered by descending score), `findLocation(locationId)`
  - [x] 4.2 Extend `FoodItemRepo` with `listLocationFoodItems(locationId)` and `submitLocationFoodItem(locationId, userId, name)`, mirroring the experience-scoped equivalents from task 2.1 exactly but keyed by `location_id`
  - [x] 4.3 Write property tests `apps/api/src/services/foodLog/__tests__/userSubmittedLocations.prop.test.ts` validating Property 8 (exact-match dedup rejects, similarity-suggest never blocks creation, ranking is score-ordered) with `fast-check` against pg-mem — register a JS trigram/Dice-coefficient approximation of `similarity()` on the pg-mem instance since pg-mem's `pg_trgm` stub doesn't implement it for real; assert relative ordering, not exact scores

- [x] 5. Fastify Routes and Composition Wiring
  - [x] 5.1 Implement `GET /experiences/:id/food-items` (triggers on-demand Menu_Retrieval fetch when stale/missing before listing) and `POST /experiences/:id/food-items` in `apps/api/src/services/foodLog/routes.ts`
  - [x] 5.2 Implement `POST /me/food-items/:foodItemId/logs`, `GET /me/food-items/:foodItemId/logs`, `DELETE /me/food-items/:foodItemId/logs/:logId` in the same routes module, including the `food_log_future_date` TZ-aware guard mirroring `apps/api/src/services/tracking/logs/routes.ts`
  - [x] 5.3 Implement `POST /locations`, `GET /locations/suggest`, `POST /locations/:id/food-items` in a `locations.ts` (or the same) routes module
  - [x] 5.4 Add route integration tests `apps/api/src/services/foodLog/__tests__/routes.test.ts` (fake repo, stubbed `requireSession`) covering auth gates, validation, the `food_item_duplicate` 409 path, `food_log_future_date` 400, `food_item_not_found`/`food_log_not_found` 404s, the `location_duplicate` 409 path, the scope-exclusivity `validation_failed` cases, and happy paths for both experience-scoped and location-scoped flows
  - [x] 5.5 Wire `foodLog: { items, logs, locations }` into `composeServices.ts` (constructing `foodItemRepo`/`foodItemLogRepo`/`userSubmittedLocationRepo`, widening the existing `menuRetrieval` construction with the new seeding call) and extend `BuildServerServices` in `apps/api/src/server.ts` with the opt-in `foodLog` block

- [x] 6. Checkpoint — Backend Verification Gate
  - [x] 6.1 Run `npm run verify:api` and `npm run verify:shared` to verify compiler clean and all test suites pass

- [x] 7. Mobile Food Logging UI
  - [x] 7.1 Create `FoodItemPickerModal.tsx` in `apps/mobile/src/screens/catalog/` — search-as-you-type over `GET /experiences/:id/food-items`, "Add [name]" row on no match, duplicate-collapse-to-selection on `food_item_duplicate`; accept either an `experienceId` or `locationId` scope prop (Requirement 6.5) so it works identically for both scopes
  - [x] 7.2 Create `LogFoodItemModal.tsx` in `apps/mobile/src/screens/catalog/` — date picker capped at today, 1–10 rating, note input, opened after a Food_Item is picked
  - [x] 7.3 Add a "Log a food item" affordance to the Restaurant Experience Detail screen that opens `FoodItemPickerModal` → `LogFoodItemModal`, invalidating `['food-item-logs', foodItemId]` and `['experience-food-items', experienceId]` on log create/delete
  - [x] 7.4 Add a repeat-count indicator to each Food_Item row in `FoodItemPickerModal.tsx` (sourced from `GET /me/food-items/:foodItemId/logs`) and create `FoodItemLogHistorySheet.tsx` (date/rating/note list with per-row delete calling `DELETE /me/food-items/:foodItemId/logs/:logId`), opened by activating the indicator
  - [x] 7.5 Render a "Not currently on menu" label on any row in `FoodItemPickerModal.tsx`/`FoodItemLogHistorySheet.tsx` whose `currentlyOnMenu` is `false`, without disabling selection or the delete action (Requirement 5.7)
  - [x] 7.6 Create `CreateLocationModal.tsx` — an "It's not listed" entry point on the restaurant search, debounce-queries `GET /locations/suggest` as the User types, renders ranked suggestions above a "Create" action; selecting a suggestion routes into `FoodItemPickerModal` scoped to that `locationId` without calling `POST /locations`; choosing "Create" calls `POST /locations` immediately regardless of visible suggestions (Requirement 6.3, 7.3, 7.4)
  - [x] 7.7 Write React Native render and interaction tests `apps/mobile/src/screens/catalog/__tests__/FoodItemPickerModal.test.tsx`, `LogFoodItemModal.test.tsx`, `FoodItemLogHistorySheet.test.tsx`, and `CreateLocationModal.test.tsx`, mocking only the network/query layer, covering the repeat-count indicator, delete-row behavior, the stale-item label rendering while remaining selectable/loggable, the suggest-then-select-or-create flow, and the `location_duplicate` collapse-to-existing behavior

- [x] 8. Final Verification & Quality Gate
  - [x] 8.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`)

- [x] 9. My Food History and Restaurant-Scoped Logged Items — Backend (R8, R9)
  - [x] 9.1 Add migration `apps/api/migrations/0043_food_item_log_history_index.sql` adding `food_item_logs_user_idx ON food_item_logs(user_id, visited_on DESC, logged_at DESC)` (additive, no column changes) per design.md's "My Food History and Restaurant-Scoped Logged Items" section
  - [x] 9.2 Add migration unit test `apps/api/src/db/__tests__/migration0043.test.ts` asserting the new index exists and the existing `food_item_logs_user_item_idx` is untouched
  - [x] 9.3 Add `FoodItemLogWithContextDTO` (extends `FoodItemLogDTO` with `foodItemName`, `currentlyOnMenu`, `restaurantName`, `locationName`) and `foodItemLogWithContextSchema` to `packages/shared/src/dto/FoodItemLog.ts` / `packages/shared/src/schemas/FoodItemLog.ts`; barrel both; add schema tests for valid and invalid cases
  - [x] 9.4 Add `getAllLogsForUser(userId)` and `getLogsForUserAtScope(userId, { experienceId?, locationId? })` to `FoodItemLogRepo` in `apps/api/src/services/foodLog/repo.ts`, implementing the join query in design.md exactly (`food_item_logs → food_items → experiences`/`user_submitted_locations`, plus the `experience_menus` join for `currentlyOnMenu`); enforce the existing exactly-one-of-`experienceId`/`locationId` rule in `getLogsForUserAtScope` at the route layer before this method is called (Requirement 6.6/Property 9 precedent)
  - [x] 9.5 Write property test `apps/api/src/services/foodLog/__tests__/foodItemLogHistory.prop.test.ts` validating Property 10 (completeness/ordering/reflects-deletion) and Property 11 (scope isolation across restaurants, across locations, and across users) with `fast-check` (>=100 runs) against pg-mem, tagged `// Feature: food-item-logging, Property 10/11: <text>`
  - [x] 9.6 Implement `GET /me/food-item-logs`, `GET /experiences/:id/food-item-logs/mine`, `GET /locations/:id/food-item-logs/mine` in `apps/api/src/services/foodLog/routes.ts` (session-gated, reusing the existing `experienceParamsSchema`/`locationParamsSchema`); add route integration tests to `apps/api/src/services/foodLog/__tests__/routes.test.ts` covering the full-history list, both scoped lists, the empty-list-is-200 case for each, and the `401 unauthorized` gate on all three
  - [x] 9.7 Checkpoint — run `npm run verify:api` and `npm run verify:shared`

- [x] 10. My Food History and Restaurant-Scoped Logged Items — Mobile (R8, R9)
  - [x] 10.1 Create a pure `deriveDisplayedFoodLogs(rows, { sort, selectedRestaurantNames?, searchText, searchFields })` function in `apps/mobile/src/screens/catalog/foodHistoryFilters.ts` implementing the filter→search→sort pipeline from design.md (composable, deterministic tie-break, `null` rating always sorts last in both rating directions); this is the shared derivation both screens in 10.2/10.4 call, kept pure/no-I/O so it is directly property-testable per this repo's convention
  - [x] 10.2 Create `MyFoodHistoryScreen.tsx` in `apps/mobile/src/screens/catalog/` sourced from `GET /me/food-item-logs` (query key `['me-food-item-logs']`), rendering dish name/restaurant-or-location name/date/rating/note per row with the "Not currently on menu" label per Requirement 8.5, a per-row delete action calling `DELETE /me/food-items/:foodItemId/logs/:logId` that invalidates `['me-food-item-logs']` on success, and the sort control ("Most Recent"/"Oldest First"/"Highest Rated First"/"Lowest Rated First"), restaurant/location multi-select filter (options derived from the fetched rows, not a new endpoint), and free-text search input from Requirement 8.7-8.10, all driven through `deriveDisplayedFoodLogs` from 10.1
  - [x] 10.3 Register `MyFoodHistory: undefined` on `RootStackParamList` and add the `RootStack.Screen` entry in `apps/mobile/src/navigation/RootNavigator.tsx` (`headerShown: false`), mirroring the existing `MyFoodLists` registration exactly
  - [x] 10.4 Add a "View your food history" `SecondaryButton` to `ProfileScreen.tsx` alongside the existing "View your stats"/"View your pins" entry points, navigating to `MyFoodHistory`
  - [x] 10.5 Create `RestaurantFoodLogsSheet.tsx` in `apps/mobile/src/screens/catalog/` accepting an `experienceId` or `locationId` scope prop, sourced from `GET /experiences/:id/food-item-logs/mine` or `GET /locations/:id/food-item-logs/mine` respectively (query key `['scoped-food-item-logs', experienceId ?? locationId]`), rendering the restaurant/location name once in the sheet header and each logged dish's name/date/rating/note/"Not currently on menu" label as rows, with the same per-row delete action as 10.2, the same sort control (Requirement 9.7), and the same search input scoped to `foodItemName` only (Requirement 9.8, no restaurant filter since the view is already scoped) — both driven through `deriveDisplayedFoodLogs` from 10.1
  - [x] 10.6 Add a "My logged items here" `SecondaryButton` to the existing `styles.foodItemButtonsRow` on `ExperienceDetailScreen.tsx`'s "Dishes & Food" card (`apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx`, alongside "Log a food item"/"Add to a list"), opening `RestaurantFoodLogsSheet` scoped to the current `experienceId`; wire the equivalent affordance on the User_Submitted_Location food-item entry point (Requirement 7) scoped to `locationId`
  - [x] 10.7 Write property test `apps/mobile/src/screens/catalog/__tests__/foodHistoryFilters.prop.test.ts` for `deriveDisplayedFoodLogs` validating Property 12 (filter/search/sort compose rather than reset each other, `null`-rating-sorts-last in both rating directions, deterministic output for identical input) with `fast-check` (>=100 runs), tagged `// Feature: food-item-logging, Property 12: <text>`
  - [x] 10.8 Write `MyFoodHistoryScreen.test.tsx` and `RestaurantFoodLogsSheet.test.tsx` in `apps/mobile/src/screens/catalog/__tests__/`, mocking only the network/query layer: full-list rendering with dish/restaurant/date/rating/note, the "Not currently on menu" label, the delete action removing exactly the targeted row and calling `DELETE` with that row's ids, an assertion that a log belonging to a different restaurant present in a shared fixture never renders in the scoped sheet (Property 11), and interaction tests for each sort option, the restaurant filter (`MyFoodHistoryScreen` only), and the search input, asserting the on-screen row order/set changes as expected and that selecting a second control does not clear the first (Property 12); add an interaction test to `ExperienceDetailScreen`'s existing test file asserting the new button opens `RestaurantFoodLogsSheet` scoped to the current `experienceId`
  - [x] 10.9 Checkpoint — run `npm run verify:mobile`

- [x] 11. Final Verification & Quality Gate (Re-run after R8/R9)
  - [x] 11.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`)

- [x] 12. Add and Update Food Item Log Ratings (R4.5, R4.6, R8.11)
  - [x] 12.1 Add `updateFoodItemLogInputSchema` to `packages/shared/src/schemas/FoodItemLog.ts` and `UpdateFoodItemLogInputDTO` to `packages/shared/src/dto/FoodItemLog.ts`
  - [x] 12.2 Add `updateLog` to `FoodItemLogRepo` in `apps/api/src/services/foodLog/repo.ts` and `PATCH /me/food-items/:foodItemId/logs/:logId` in `apps/api/src/services/foodLog/routes.ts`; add route integration tests in `apps/api/src/services/foodLog/__tests__/routes.test.ts`
  - [x] 12.3 Support adding/updating rating in `apps/mobile/src/screens/catalog/MyFoodHistoryScreen.tsx` (pressable rating badge and "+ Add rating" button opening rating prompt and dispatching PATCH call)

## Task Dependency Graph

Tasks within a wave can proceed in parallel; each wave depends only on earlier waves.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "id": 2, "tasks": ["3.1", "3.2", "4.1", "4.2", "4.3"] },
    { "id": 3, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": 4, "tasks": ["6.1"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6"] },
    { "id": 6, "tasks": ["7.7"] },
    { "id": 7, "tasks": ["8.1"] },
    { "id": 8, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 9, "tasks": ["9.5", "9.6"] },
    { "id": 10, "tasks": ["9.7"] },
    { "id": 11, "tasks": ["10.1"] },
    { "id": 12, "tasks": ["10.2", "10.3", "10.4", "10.5", "10.6"] },
    { "id": 13, "tasks": ["10.7", "10.8"] },
    { "id": 14, "tasks": ["10.9"] },
    { "id": 15, "tasks": ["11.1"] }
  ]
}
```

Waves 8-15 are this amendment's addition (Requirement 8, 9). Wave 8 depends on wave 7 (task 8) only in the sense that it is layered on top of the already-fully-implemented feature — it does not require re-touching any file from waves 0-7. Wave 9 depends on wave 8 (needs the new `FoodItemLogWithContextDTO`/repo methods before the routes/property test can be written). Wave 11 (the pure `deriveDisplayedFoodLogs` function) is split into its own wave ahead of wave 12 because both mobile screens in wave 12 call it directly — writing it first avoids either screen needing a placeholder. Wave 12 depends on wave 10's checkpoint (backend must be verified before the mobile screens are wired against it). Wave 15's full `npm run verify` is the final gate for this amendment and supersedes task 8.1 as the most current all-green baseline — task 8.1 remains checked as a historical record of when the original feature (R1-R7) was verified, not because it needs to be re-run in isolation.

Wave 2 groups the Food_Item Log repo (task 3) with the User_Submitted_Location repo (task 4) since both depend only on wave 1's `food_items` migration/repo shape and touch disjoint files/tables (`food_item_logs` vs. `user_submitted_locations`).

## Notes

- **No dual-write, by design.** `food_item_logs` intentionally never touches `completions`, `ratings`, or `experience_logs` (Requirement 3.5, Property 3) — a dish log is orthogonal to restaurant-level completion.
- **Seeding is demand-driven, matching Menu_Retrieval.** There is no scheduled sync for `food_items`; it is populated exclusively as a side effect of the existing lazy menu fetch (Requirement 1.5), consistent with the hosting constraint against an always-on worker.
- **Dependency for `food-lists`.** The `food-lists` spec depends on `food_items` existing as the addressable catalog entity its list items reference — do not begin `food-lists` implementation before task 6 (backend checkpoint) here lands, since `food_lists_items.food_item_id` will FK into this table. Note `food_items.experience_id` is now nullable (a location-scoped Food_Item has `experienceId: null`) — if `food-lists` items ever need to render a restaurant name for an item, they must handle the location-scoped case (`FoodItemDTO.locationId` non-null) rather than assuming `experienceId` is always present.
- **Pins hook deferred.** Per the product discussion, a future pin/challenge tied to food logging (e.g. "log 10 dishes") is an explicit non-goal of this spec; `food_item_logs` is shaped so a future `PinActivitySnapshot` field can read distinct `(user_id, food_item_id)` pairs without a schema change, but no `evaluator.ts` change is made here.
- **A dish leaving the menu never loses its logs.** `upsertFoodItemsFromMenus` is insert/update-only — a `menu_sync` item absent from a later fetch just stops having its `last_seen_at` advanced; nothing deletes the `food_items` row or any `food_item_logs` row referencing it. Staleness is only ever surfaced as the read-time `currentlyOnMenu` flag (Requirement 1.8, Property 7) — never enforced by blocking logging, deleting history, or hiding the item from the picker (Requirement 1.9, 5.7).
- **Location dedup is suggest-then-confirm, never auto-merge.** `GET /locations/suggest` is purely advisory (Requirement 6.2, 6.3, Property 8) — no similarity score, however high, blocks or auto-selects a creation. The only hard block is the exact-match `(park, lower(name))` constraint (Requirement 6.4). Do not add an auto-merge or a "similarity too high, blocked" path — that was an explicit product decision, not an oversight.
- **No location merge/promote path.** A User_Submitted_Location that turns out to be a near-duplicate of another (missed by the suggest step), or that Disney's catalog later covers, is not consolidated or migrated by this feature (Requirement 6.8). This is a deliberate scope boundary, matching the same reasoning already applied to `user_submitted` Food_Items having no merge tooling.
- **Amendment (Requirement 8, 9): a new context-carrying DTO, not a reshaped existing one.** `FoodItemLogDTO`/`FoodItemLogHistoryDTO` are unchanged by tasks 9-11 — every existing caller of `GET /me/food-items/:foodItemId/logs` keeps its current response shape. The new cross-restaurant/scoped-restaurant reads use a new `FoodItemLogWithContextDTO` instead, because only they need a denormalized dish/restaurant/location name on each row (the existing per-item history sheet already has that context from the picker row it was opened from). Do not widen `FoodItemLogDTO` itself to add these fields — that would be an unnecessary breaking change to every existing consumer for a need only two new endpoints have.
- **Amendment: no pagination on either new list.** Both `GET /me/food-item-logs` and the two `.../food-item-logs/mine` endpoints return their full result unpaginated, unlike `food-lists`' discovery feed — a User's own food log is bounded by their own logging activity, not by all Users' content, so cursor pagination would add complexity with no realistic benefit at this feature's scale. Do not add a `cursor`/`limit` param here without a concrete reason (e.g. observed real-world row counts warranting it).
