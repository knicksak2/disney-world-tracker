# Implementation Plan: Unified Dining & Dish Logging

## Overview

This plan bridges dish logging (`food_item_logs`) and restaurant visit logging (`experience_logs` / `completions` / `trip_log_entries`) so logging food at a restaurant always ensures the restaurant is marked visited on that date (with user-controlled Trip pre-selection and "Dined with" tagging), while logging a restaurant visit via `LogExperienceSheet` allows attaching dishes inline and displays those dishes on the restaurant's Passport visit history.

Cross-spec dependencies (all already shipped): `food-item-logging`, `experience-activity-logging`, `unified-experience-logging`, `trips`, `planned-list-completion-sync`, `experience-detail-redesign`.

Per `execution-discipline`: write tests alongside the code in each task, iterate with single-file test runs, run scoped `npm run verify:<workspace>` at checkpoints, and run the full `npm run verify` once at the final checkpoint with a complete behavior→test map.

## Tasks

- [x] 1. Shared contracts and pure helpers (`packages/shared`)
  - [x] 1.1 Extend `FoodItemLog` DTOs and Zod schema
    - In `packages/shared/src/schemas/FoodItemLog.ts`: add optional `tripId: uuidSchema.nullable().optional()` and `rodeWith: z.array(uuidSchema).optional()` to `createFoodItemLogInputSchema` (keep `.strict()`).
    - In `packages/shared/src/dto/FoodItemLog.ts`: add `tripId` and `rodeWith` to `CreateFoodItemLogInputDTO`, and export `FoodLogRestaurantVisitDTO` and `CreateFoodItemLogResponseDTO`.
    - Export new types from `packages/shared/src/dto/index.ts` and `packages/shared/src/index.ts`.
    - _Requirements: 1.1, 1.9_
  - [x] 1.2 Implement `packages/shared/src/diningLogging.ts` and property tests
    - Create `packages/shared/src/diningLogging.ts` exporting `InlineDishDraft`, `hasVisitOnDate`, and `groupDishesByVisitDate`; re-export from `packages/shared/src/index.ts`.
    - Create `packages/shared/src/__tests__/diningLogging.prop.test.ts` testing **Property 4: Grouping Dishes by Visit Date Preserves All Dishes Per Date** (`fast-check`, ≥100 runs) and schema tests for `createFoodItemLogInputSchema`.
    - _Requirements: 1.1, 2.1, 4.2, 4.3_

- [x] 2. Backend: Automatic restaurant visit assurance and Migration 0071 (`apps/api`)
  - [x] 2.1 Add `RestaurantVisitPort` and wire `POST /me/food-items/:foodItemId/logs`
    - Create `apps/api/src/services/foodLog/restaurantVisitPort.ts` defining `EnsureRestaurantVisitInput`, `EnsureRestaurantVisitResult`, and `RestaurantVisitPort`.
    - Extend `FoodItemLogRoutesOptions` in `apps/api/src/services/foodLog/routes.ts` with `restaurantVisit?: RestaurantVisitPort`, `onRodeWithTagCreated?`, and `pinAwardService?`.
    - In `POST /me/food-items/:foodItemId/logs`: validate `rodeWith` requires `tripId`; look up the `Food_Item` (`findFoodItem`); reject `tripId`/`rodeWith` on location-scoped items (`experienceId === null`) with `validation_failed`; when `experienceId !== null` and `restaurantVisit` is present, call `ensureVisitForDishLog` before inserting the `food_item_logs` row so any Trip error aborts before writing the dish log; dispatch pending tag notices and pin awards when `created === true`; include `restaurantVisit` and `newlyAwardedPinIds` in the `201` response.
    - Wire `restaurantVisit` in `apps/api/src/composeServices.ts` using `pool`, `experienceLogRepo`, and `tripLogPort`.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_
  - [x] 2.2 Create Migration `0071_backfill_restaurant_visits_from_food_logs.sql`
    - Add `apps/api/migrations/0071_backfill_restaurant_visits_from_food_logs.sql` inserting missing `experience_logs` and `completions` rows for historical catalog-restaurant `food_item_logs`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 2.3 API property, route, and migration tests
    - Create `apps/api/src/services/foodLog/__tests__/autoRestaurantVisit.prop.test.ts` covering **Property 1**, **Property 2**, and **Property 3** against `pg-mem`.
    - Create `apps/api/src/services/foodLog/__tests__/migration0071.test.ts` covering **Property 5** (completeness, rating non-pollution, and idempotence).
    - Extend `apps/api/src/services/foodLog/__tests__/routes.test.ts` for `POST /me/food-items/:foodItemId/logs` with `tripId`/`rodeWith`, rejection cases, and `restaurantVisit` response payload.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 5.1, 5.2, 5.3, 5.4_

- [x] 3. Checkpoint - Shared and API verification
  - Run `npm run verify:shared` and `npm run verify:api` and confirm all tests and typechecks pass.

- [x] 4. Mobile: Unified Dining & Dish UI (`apps/mobile`)
  - [x] 4.1 Add Trip pre-selection and "Dined with" to `LogFoodItemModal`
    - In `apps/mobile/src/screens/catalog/LogFoodItemModal.tsx`: query `['experience-logs', foodItem.experienceId]`, `['me', 'trips', 'active']`, `['me']`, and `['trips', tripId, 'members']` when `foodItem.experienceId !== null`.
    - When `!hasVisitOnDate(logs, visitedOn)`, render the auto-visit info banner (`testID="log-food-auto-visit-banner"`), Trip chips (`testID="log-food-trip-section"`), and `"Dined with"` member chips (`testID="log-food-rode-with-section"`), governed by `preselectTripId` and `reconcileDraft`.
    - When `hasVisitOnDate(logs, visitedOn)` is true, render the existing-visit badge (`testID="log-food-existing-visit-badge"`) and omit Trip/member chips.
    - Call `invalidateAfterLog` when `restaurantVisit` is returned.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 4.2 Add inline `"Dishes you had"` section to `LogExperienceSheet`
    - In `apps/mobile/src/screens/logging/LogExperienceSheet.tsx`: when `category === 'Restaurant'`, render the `"Dishes you had"` section (`testID={`${testIDPrefix}-dishes-section`}`) with `"+ Add dish"` (`testID={`${testIDPrefix}-add-dish-btn`}`) opening `FoodItemPickerModal`.
    - Render each selected `InlineDishDraft` with optional 1–10 rating pills and remove button.
    - On submit, after the restaurant visit request succeeds, post each attached dish to `POST /me/food-items/:foodItemId/logs` for `draft.visitedOn`, invalidate food log queries, and set `offerDishPrompt: inlineDishes.length === 0` on the toast.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 4.3 Update `FloatingActionDock` and connect dishes in `ParkPassportCard` / `VisitHistoryTimeline`
    - In `apps/mobile/src/screens/catalog/FloatingActionDock.tsx`: set the primary button for `Restaurant` to `"Log Visit"` calling `onLogVisit` (updating existing dock tests accordingly).
    - In `apps/mobile/src/screens/catalog/ParkPassportCard.tsx` and `VisitHistoryTimeline.tsx`: display dishes logged on each visit's `visitedOn` date using `groupDishesByVisitDate`.
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 4.4 Mobile component tests
    - Update and extend `LogFoodItemModal.test.tsx`, `LogExperienceSheet.test.tsx`, `FloatingActionDock.test.tsx`, and `ParkPassportCard.test.tsx` to cover every new interaction and assertion.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3_

- [ ] 5. Final checkpoint - Full verification gate
  - Audit `git diff` against all requirements.
  - Run `npm run verify` across all workspaces and paste the literal tail output and behavior→test map.

## Notes

- Dish ratings (`food_item_logs.rating`) never overwrite or seed the restaurant's overall rating (`experience_logs.rating` / `ratings`).
- All new UI colours must come from `makeStyles` / `useAppTheme` / `*.palette.ts` to satisfy `themeRetrofit.guard.test.ts`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3"] },
    { "id": 3, "tasks": ["3"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 5, "tasks": ["4.4"] },
    { "id": 6, "tasks": ["5"] }
  ]
}
```

