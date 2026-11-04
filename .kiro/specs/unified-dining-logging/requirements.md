# Requirements Document

## Introduction

Unified Dining & Dish Logging eliminates the disconnect between logging a dish at a restaurant (`food_item_logs`) and logging a visit to the restaurant itself (`experience_logs` / `completions` / `trip_log_entries`).

Previously, a User who tapped "Log a Dish" at a restaurant could log multiple dishes they ate, yet the restaurant itself still showed as unvisited in their Park Passport, never checked off their Trip Planned List, and never appeared in their Trip Activity feed. Conversely, logging the restaurant itself required switching to the Passport tab and opening a separate sheet that could not attach the dishes eaten during that meal.

This feature unifies restaurant and dish logging so that:

1. **Eating a dish at a restaurant always counts as visiting that restaurant on that date.** Logging a `Food_Item` scoped to a catalog `Restaurant_Experience` automatically creates the User's `Experience_Log` and canonical `Completion` for that restaurant on `visitedOn` if the User does not already have one on that date—while reusing the existing visit if they are logging a second or third dish from the same meal.
2. **Same Trip pre-selection & "Dined with" controls when logging a dish.** When logging the first dish of the day at a restaurant, `LogFoodItemModal` presents the same pre-selected Trip chip and "Dined with" member chips as `LogExperienceSheet`, so the User can keep or deselect the Trip attribution rather than having it forced silently.
3. **Inline dish attachment inside `LogExperienceSheet` for restaurants.** When logging a `Restaurant_Experience` via `LogExperienceSheet` (from the dock, Trip Activity, Planned List, or FAB), the User can optionally attach one or more dishes they ate (with optional per-dish ratings) in the same submission.
4. **Connected Passport & Visit History.** On a restaurant's detail screen, each visit in `ParkPassportCard` / `VisitHistoryTimeline` displays the dishes logged on that visit date, and any historical dish logs whose parent restaurant was never marked visited are repaired via an idempotent backfill migration.

## Glossary

- **App**, **User**, **Trip**, **Trip_Member**, **Active_Trip**, **Trip_Selection**, **Preselected_Trip**, **Riding_With_Row**, **Unified_Log_Sheet** (`LogExperienceSheet`), **Log_Toast**, **Dish_Prompt**, **Trip_Log_Port** — as defined in `.kiro/specs/unified-experience-logging/requirements.md`.
- **Restaurant_Experience**, **Food_Item**, **Food_Item_Log**, **User_Submitted_Location**, **Food_Log_Service** — as defined in `.kiro/specs/food-item-logging/requirements.md`.
- **Experience_Log**, **Completion**, **Rating**, **Visit_History** — as defined in `.kiro/specs/experience-activity-logging/requirements.md`.
- **Auto_Restaurant_Visit**: The `Experience_Log` (and optional `Trip_Log_Entry` when `tripId` is supplied) automatically created by the server when a User logs a `Food_Item` scoped to a `Restaurant_Experience` on a `visitedOn` date where the User has no existing `Experience_Log` for that `Restaurant_Experience`.
- **Inline_Dish_Draft**: A dish selected inside `LogExperienceSheet` for a `Restaurant_Experience` prior to submission, carrying `foodItemId`, `name`, optional `rating` (1–10), and optional `note`.
- **Dining_Backfill**: The idempotent migration (`0071_backfill_restaurant_visits_from_food_logs.sql`) that creates one `Experience_Log` per distinct `(user_id, experience_id, visited_on)` and ensures a canonical `Completion` for historical `Food_Item_Log` rows whose `Restaurant_Experience` has no `Experience_Log` on that date.

## Requirements

### Requirement 1: Automatic Restaurant Visit Assurance on Dish Log

**User Story:** As a User logging a dish I ate at a restaurant, I want the app to automatically record that I visited the restaurant on that day, so that the restaurant never says I haven't eaten there after I just logged food from it.

#### Acceptance Criteria

1. THE `createFoodItemLogInputSchema` (`POST /me/food-items/:foodItemId/logs`) SHALL accept optional `tripId` (`UUID | null`) and `rodeWith` (`UUID[]`) fields in addition to `visitedOn`, `userTz`, `rating`, and `note`.
2. WHEN a User creates a `Food_Item_Log` for a `Food_Item` whose `experienceId` is non-null, AND the User has no existing `Experience_Log` for `(userId, experienceId, visitedOn)`, AND `tripId` is null or omitted, THE Food_Log_Service SHALL atomically create an `Experience_Log` for `(userId, experienceId, visitedOn, userTz)` with `rating = null` and `note = null` and ensure the User's canonical `Completion` row exists for `experienceId`.
3. WHEN a User creates a `Food_Item_Log` for a `Food_Item` whose `experienceId` is non-null, AND the User has no existing `Experience_Log` for `(userId, experienceId, visitedOn)`, AND `tripId` is a non-null UUID, THE Food_Log_Service SHALL delegate creation of the restaurant visit to the `Trip_Log_Port` (`logToTrip`) with `experienceId`, `visitedOn`, `userTz`, `rating: null`, `note: null`, and `rodeWith`, producing the `Experience_Log`, canonical `Completion`, `Trip_Log_Entry`, `completion_logged` `Trip_Feed_Item`, and pending `Rode_With_Tags` with tag notifications.
4. WHEN a User creates a `Food_Item_Log` for a `Food_Item` whose `experienceId` is non-null, AND the User already has one or more `Experience_Log` rows for `(userId, experienceId, visitedOn)`, THE Food_Log_Service SHALL NOT insert an additional `Experience_Log` row for that restaurant on that date, so logging multiple dishes during the same meal produces one restaurant visit and multiple dish logs.
5. WHEN a `Food_Item_Log` is created with a dish `rating` or dish `note`, THE Auto_Restaurant_Visit SHALL NOT copy the dish's `rating` or `note` onto the restaurant's `Experience_Log` or canonical `ratings` table — dish ratings rate the dish, while restaurant ratings rate the overall restaurant.
6. WHEN a User creates a `Food_Item_Log` for a `Food_Item` scoped to a `User_Submitted_Location` (`experienceId` is `null`), THE Food_Log_Service SHALL create only the `Food_Item_Log` and SHALL NOT create an `Experience_Log`.
7. IF `POST /me/food-items/:foodItemId/logs` carries a non-empty `rodeWith` when `tripId` is null/omitted or when the `Food_Item` has `experienceId === null`, THEN THE Food_Log_Service SHALL reject the request with HTTP `400` and error code `validation_failed` without writing any row.
8. IF `POST /me/food-items/:foodItemId/logs` carries a `tripId` and fails Trip authorization (`trip_forbidden`), tag validation (`trip_validation_failed`), or Trip date-range validation (`log_outside_trip_dates`), THEN THE Food_Log_Service SHALL reject the request with that error code and SHALL NOT create the `Food_Item_Log` or the `Experience_Log`.
9. THE response of `POST /me/food-items/:foodItemId/logs` SHALL keep every existing `FoodItemLogDTO` field and SHALL additionally include `restaurantVisit: { experienceId: string, logId: string, created: boolean, tripLog?: { tripId: string, logEntryId: string, taggedCount: number } } | null` and `newlyAwardedPinIds?: readonly string[]`.

### Requirement 2: Trip Pre-selection and "Dined With" in `LogFoodItemModal`

**User Story:** As a User logging a dish while on a trip, I want to see the pre-selected Trip chip and "Dined with" crew chips just like when I log a ride, with the ability to unselect the trip if I don't want the visit added to the trip feed.

#### Acceptance Criteria

1. WHEN `LogFoodItemModal` opens for a `Food_Item` with a non-null `experienceId`, THE App SHALL check whether the User already has an `Experience_Log` for that `experienceId` on the selected `visitedOn` date.
2. WHILE the User has no existing `Experience_Log` for `experienceId` on `visitedOn`, `LogFoodItemModal` SHALL display an inline banner indicating that logging this dish will also mark the restaurant as visited on that date, and SHALL render the `Trip_Selection` chips and `"Dined with"` `Riding_With_Row` governed by the same `preselectTripId` and `reconcileDraft` rules as `Unified_Log_Sheet` (Requirement 2 and Requirement 3 of `unified-experience-logging`).
3. WHEN the User deselects the pre-selected Trip chip (taps "No trip") in `LogFoodItemModal`, THE App SHALL submit `POST /me/food-items/:foodItemId/logs` with `tripId: null`, creating a personal restaurant visit without linking it to the Trip.
4. WHILE the User already has an `Experience_Log` for `experienceId` on `visitedOn`, `LogFoodItemModal` SHALL display a compact confirmation indicator (`"Restaurant visit already logged for this date"`) and SHALL omit the `Trip_Selection` and `Riding_With_Row` controls so logging additional dishes for the same meal requires no redundant Trip choices.
5. WHEN a dish log submission from `LogFoodItemModal` succeeds and `restaurantVisit` is non-null, THE App SHALL run `invalidateAfterLog` for `experienceId` (and `tripId` if linked) in addition to invalidating the food-item log queries, so the restaurant's Passport, completion status, and Trip Feed update immediately.

### Requirement 3: Inline Dish Selection Inside `LogExperienceSheet` for Restaurants

**User Story:** As a User logging a meal at a restaurant from the main "Log Visit" button or Trip screen, I want the option to add the dishes I ate right inside the same sheet, so I can log the restaurant, my dining companions, and my food in one step.

#### Acceptance Criteria

1. WHEN `LogExperienceSheet` is rendered for an Experience with `category === 'Restaurant'`, THE sheet SHALL display a `"Dishes you had"` section with an `"+ Add dish"` button above the submit row.
2. WHEN the User taps `"+ Add dish"` in `LogExperienceSheet`, THE App SHALL open `FoodItemPickerModal` scoped to that `experienceId` to select or submit a `Food_Item` and append it to the sheet's `Inline_Dish_Draft` list.
3. FOR each dish in the `Inline_Dish_Draft` list, `LogExperienceSheet` SHALL display the dish name, an optional compact 1–10 dish rating selector, and a remove button.
4. WHEN the User submits `LogExperienceSheet` with one or more `Inline_Dish_Draft` entries, THE App SHALL first submit the restaurant visit (`LogSubmission`) and, upon success, submit each `Inline_Dish_Draft` to `POST /me/food-items/:foodItemId/logs` with the same `visitedOn` and `userTz` (and `tripId: null`, since the restaurant visit was already created by the primary request), then invalidate both experience and food-item log queries.
5. WHEN `LogExperienceSheet` succeeds for a `Restaurant_Experience` and one or more `Inline_Dish_Draft` entries were logged as part of that submission, THE `Log_Toast` SHALL omit the `"Log what you ate"` `Dish_Prompt` (since the User already logged their dishes) and SHALL include the count of logged dishes in the toast message or summary.
6. WHEN `LogExperienceSheet` succeeds for a `Restaurant_Experience` with zero `Inline_Dish_Draft` entries attached, THE `Log_Toast` SHALL continue to offer the `"Log what you ate"` `Dish_Prompt` as specified in `unified-experience-logging` Requirement 8.

### Requirement 4: Clear Restaurant Action Hierarchy and Connected Visit History

**User Story:** As a User viewing a restaurant's detail screen, I want a clear primary action to log my visit/meal and I want my restaurant visit history to show which dishes I ate on each visit, so the screen feels unified and easy to understand.

#### Acceptance Criteria

1. WHEN `FloatingActionDock` renders for a `Restaurant_Experience`, THE primary dock action SHALL be `"Log Visit"` (invoking `onLogVisit` to open `LogExperienceSheet`, which supports both restaurant visit logging and inline dish attachment), while the restaurant's menu and dish cards continue to offer direct `"Log a food item"` buttons for single-dish logging.
2. WHEN `ParkPassportCard` or `VisitHistoryTimeline` renders visit history for a `Restaurant_Experience`, each `Experience_Log` entry on date `visitedOn` SHALL display the list of `Food_Item_Log` entries logged by the User at that `Restaurant_Experience` with the same `visitedOn` date (showing dish name and dish rating if rated).
3. WHEN a User has logged dishes on a date `visitedOn` at a `Restaurant_Experience`, the visit row in `ParkPassportCard` / `VisitHistoryTimeline` SHALL show those dishes beneath the visit date without conflating the individual dish ratings with the restaurant's overall visit rating.

### Requirement 5: Backfill of Historical Orphaned Dish Logs

**User Story:** As a User who already logged food items at restaurants before this update, I want those restaurants to show that I have eaten there, so my existing logs are immediately consistent.

#### Acceptance Criteria

1. THE `Dining_Backfill` migration (`0071_backfill_restaurant_visits_from_food_logs.sql`) SHALL, for every distinct `(fil.user_id, fi.experience_id, fil.visited_on)` in `food_item_logs fil JOIN food_items fi ON fi.id = fil.food_item_id` where `fi.experience_id IS NOT NULL` and no `experience_logs` row exists for `(fil.user_id, fi.experience_id, fil.visited_on)`, insert one `experience_logs` row with `user_id`, `experience_id`, `visited_on`, `user_tz = MIN(fil.user_tz)`, `logged_at = MIN(fil.logged_at)`, `rating = NULL`, and `note = NULL`.
2. THE `Dining_Backfill` migration SHALL, for every distinct `(fil.user_id, fi.experience_id)` where an `experience_logs` row was inserted (or already exists from `food_item_logs`), insert a canonical `completions` row (`ON CONFLICT (user_id, experience_id) DO NOTHING`) with `completed_on = MIN(fil.visited_on)` and `user_tz = MIN(fil.user_tz)`.
3. THE `Dining_Backfill` migration SHALL be idempotent: running it a second time SHALL insert no additional rows in `experience_logs` or `completions`.
4. THE `Dining_Backfill` migration SHALL NOT modify or delete any existing `food_item_logs`, `experience_logs`, `ratings`, or `completions` row.

