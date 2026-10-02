# Requirements Document

## Introduction

Food Item Logging lets a User record and rate individual dishes they have eaten at a Restaurant-category Experience — a table-service or quick-service restaurant, or a festival booth (a `Restaurant` Experience tagged `Festival Kiosk` per `festival-booth-tagging`) — separately from the existing Experience-level completion/rating/note captured by `experience-activity-logging`.

Today, `experience_logs` (migration 0034) captures that a User visited a *restaurant as a whole* with one optional 1–10 rating and note per visit. It has no notion of *which dish* was eaten. Meanwhile `experience_menus` (migration 0004) caches each restaurant's menu as a JSONB blob refreshed lazily from Disney's Menu_Service, with no durable per-item identifier — items are positional entries in an array that is fully replaced on every refresh.

This feature introduces a durable, per-restaurant dish catalog (`food_items`) seeded automatically from that same lazy menu-fetch pathway (no separate sync job, no free-text dish entry), and a per-User dish log (`food_item_logs`) mirroring `experience_logs`' shape (visit date, timezone, optional 1–10 rating, optional note) but scoped to a specific `food_items` row instead of the whole restaurant. This is the foundation `food-lists` builds on to let Users curate and share dish collections; it does not itself add sharing or list behavior.

## Glossary

- **App**: The mobile client and web interfaces of the Disney World Tracker.
- **User**: An authenticated user of the App.
- **Restaurant_Experience**: An `experiences` row with `category = 'Restaurant'` (table-service, quick-service, or a festival booth carrying a `Festival Kiosk` facet per `festival-booth-tagging`).
- **Food_Item**: A single named dish/menu entry scoped to one Restaurant_Experience, persisted in `food_items`. Sourced either from a Menu_Service menu fetch (`source = 'menu_sync'`) or, when no synced item matches, from direct User submission (`source = 'user_submitted'`).
- **Food_Item_Log**: A record of a User having eaten a specific Food_Item on a specific calendar date, with an optional 1–10 rating and an optional note, persisted in `food_item_logs`.
- **Menu_Retrieval**: The existing demand-driven seam (`apps/api/src/services/catalog/menuRetrieval.ts`) that fetches and caches a Restaurant_Experience's menu from the Menu_Service on read, serving the cache when fresh and refetching when missing or stale.
- **User_Submitted_Location**: A named food-selling location a User creates manually because it has no corresponding Restaurant_Experience in the catalog at all — e.g. a standalone snack cart Disney's own Facilities feed does not model as a distinct entity (confirmed absent from the catalog, not merely uncategorized). Persisted in `user_submitted_locations`. A Food_Item scoped to a User_Submitted_Location has no `experience_id`.
- **Food_Log_Service**: The backend service owning `food_items`, `food_item_logs`, and `user_submitted_locations`.

## Requirements

### Requirement 1: Food Item Catalog Seeded from Menu Retrieval

**User Story:** As a User browsing a restaurant to log a dish, I want to pick from the restaurant's actual menu items without typing anything, so that my entry matches what everyone else who eats there sees, with consistent spelling.

#### Acceptance Criteria

1. WHEN `Menu_Retrieval.getMenuForRestaurant` fetches a fresh menu from the Menu_Service for a Restaurant_Experience (cache miss or stale, per the existing `decideMenuFetch` freshness check), THE Food_Log_Service SHALL upsert one `Food_Item` row per distinct `groups[].items[].name` found in the fetched `MenuDTO[]` for that Restaurant_Experience, with `source = 'menu_sync'` and `last_seen_at` set to the fetch instant.
2. WHERE a `Food_Item` with the same `experience_id` and case-insensitively equal `name` already exists, THE Food_Log_Service SHALL update its `price` and `last_seen_at` rather than inserting a duplicate row.
3. THE Food_Log_Service SHALL persist each `menu_sync`-sourced `Food_Item`'s `price` verbatim from the source item's `price` field (nullable) without reformatting or currency parsing.
4. WHEN a Menu_Retrieval fetch fails (Menu_Service error) and cached menus are served unchanged (per the existing `getMenuForRestaurant` failure path), THE Food_Log_Service SHALL NOT modify `food_items` for that Restaurant_Experience — a fetch failure never partially seeds or clears the catalog.
5. WHEN a User requests the Food_Item catalog for a Restaurant_Experience (`GET /experiences/:id/food-items`) and the cached menu is missing or stale, THE Food_Log_Service SHALL trigger the same on-demand Menu_Retrieval fetch used by the Experience Detail menu display before returning the catalog, so opening this list for the first time is sufficient to populate it — no separate sync step is required.
6. THE Food_Log_Service SHALL return the Food_Item catalog for a Restaurant_Experience ordered by `name` ascending, including `id`, `name`, `price`, and `source` for each item.
7. WHEN a menu-sync fetch (Requirement 1.1) completes for a Restaurant_Experience and a `menu_sync`-sourced `Food_Item` for that Restaurant_Experience was not among the names found in that fetch, THE Food_Log_Service SHALL leave that `Food_Item` row and every `Food_Item_Log` referencing it unchanged — a dish dropping off the current menu never deletes the item or any User's log of it.
8. THE Food_Log_Service SHALL compute a Food_Item as `currentlyOnMenu: true` WHEN its `source = 'user_submitted'`, OR its `last_seen_at` falls within the most recent successful menu-sync fetch for its Restaurant_Experience; OTHERWISE `currentlyOnMenu: false`. `GET /experiences/:id/food-items` and `GET /me/food-items/:foodItemId/logs` SHALL include this computed flag for each Food_Item.
9. WHERE a Food_Item's `currentlyOnMenu` is `false`, THE Food_Log_Service SHALL continue to allow a User to log a visit against it (`POST /me/food-items/:foodItemId/logs`) — a dish leaving the current menu never blocks logging or reviewing history for it, only affects whether the App presents it as a currently-orderable choice (Requirement 5.7).

### Requirement 2: User-Submitted Food Item Fallback

**User Story:** As a User building a list before a seasonal event (e.g. Food & Wine Festival) whose booth items are not yet reflected in Disney's menu feed, I want to add the missing dish myself, so that I am not blocked from logging or listing it.

#### Acceptance Criteria

1. WHEN a User submits a new Food_Item name for a Restaurant_Experience (`POST /experiences/:id/food-items`) that does not case-insensitively match any existing `Food_Item` name for that Restaurant_Experience, THE Food_Log_Service SHALL insert a new `Food_Item` row with `source = 'user_submitted'`, `created_by_user_id` set to the submitting User, and `name` trimmed to 1–200 characters.
2. IF a User-submitted name case-insensitively matches an existing `Food_Item` for that Restaurant_Experience (`menu_sync` or `user_submitted`), THE Food_Log_Service SHALL reject the submission with HTTP `409` and error code `food_item_duplicate`, returning the id of the existing matching item so the client can use it instead of creating a duplicate.
3. THE Food_Log_Service SHALL make every `user_submitted` Food_Item visible to all Users browsing that Restaurant_Experience's catalog identically to a `menu_sync` item — visibility is never scoped to the submitting User alone.
4. IF a submitted name is empty after trimming or exceeds 200 characters, THE Food_Log_Service SHALL reject the request with HTTP `400` and error code `validation_failed`.

### Requirement 3: Log a Food Item Visit with Rating and Note

**User Story:** As a User, I want to log that I ate a specific dish on a specific day and rate it, so that I can remember what I liked and eventually see aggregate stats on my favorite dishes.

#### Acceptance Criteria

1. WHEN a User submits a request to log a Food_Item (`POST /me/food-items/:foodItemId/logs`), THE Food_Log_Service SHALL record a new `Food_Item_Log` containing `id`, `user_id`, `food_item_id`, `visited_on` calendar date, `user_tz`, `logged_at` timestamp, optional `rating` (1–10 integer), and optional `note` (1–2000 chars, trimmed).
2. THE Food_Log_Service SHALL allow a User to create multiple distinct `Food_Item_Log` records for the same Food_Item on the same calendar date or across different dates (repeat visits to a favorite dish).
3. IF a request to log a Food_Item supplies a `visited_on` calendar date strictly later than the current calendar date in the request's `user_tz`, THE Food_Log_Service SHALL reject the request with HTTP `400` and error code `food_log_future_date` without creating any `Food_Item_Log` row, mirroring the `experience_logs` future-date guard (`log_future_date`).
4. IF `foodItemId` does not reference an existing `Food_Item`, THE Food_Log_Service SHALL reject the request with HTTP `404` and error code `food_item_not_found`.
5. THE Food_Log_Service SHALL NOT write to `completions`, `ratings`, or `experience_logs` when a `Food_Item_Log` is created — Food_Item_Log is a separate stream from the Experience-level activity log and does not affect Restaurant_Experience completion/rating stats.

### Requirement 4: Query and Delete Food Item Visit History

**User Story:** As a User, I want to see every time I've logged a specific dish, and remove a mistaken entry, so that my dish history stays accurate.

#### Acceptance Criteria

1. WHEN a User requests their log history for a Food_Item (`GET /me/food-items/:foodItemId/logs`), THE Food_Log_Service SHALL return all `Food_Item_Log` records for that User and Food_Item sorted by `visited_on DESC, logged_at DESC`, including a `repeatCount` equal to the number of logs returned.
2. IF the User has no `Food_Item_Log` records for the Food_Item, THE Food_Log_Service SHALL return an empty list with `repeatCount = 0` and HTTP status `200`.
3. WHEN a User requests to delete a `Food_Item_Log` by its id (`DELETE /me/food-items/:foodItemId/logs/:logId`), THE Food_Log_Service SHALL remove that specific log record if and only if it belongs to the authenticated User and references that Food_Item, returning HTTP `204`.
4. IF the targeted `Food_Item_Log` does not exist, belongs to another User, or references a different Food_Item, THE Food_Log_Service SHALL reject the request with HTTP `404` and error code `food_log_not_found` — a non-existent log and one owned by another User collapse to the same response so ownership cannot be probed.
5. WHEN a User requests to update a `Food_Item_Log` by its id (`PATCH /me/food-items/:foodItemId/logs/:logId`), THE Food_Log_Service SHALL update the log's `rating` (1–10 or `null`) and/or `note` (trimmed 1–2000 chars or `null`) if and only if it belongs to the authenticated User and references that Food_Item, returning the updated `Food_Item_Log` with HTTP status `200`.
6. IF the targeted `Food_Item_Log` does not exist, belongs to another User, or references a different Food_Item, THE Food_Log_Service SHALL reject the PATCH request with HTTP `404` and error code `food_log_not_found`.

### Requirement 5: Mobile Food Logging on the Experience Detail Screen

**User Story:** As a mobile App user viewing a restaurant's detail screen, I want to pick a dish from its menu and log/rate it in a couple of taps, so that logging a snack or meal is as easy as logging a ride.

#### Acceptance Criteria

1. WHEN the App renders the Experience Detail screen for a Restaurant_Experience, THE App SHALL provide a "Log a food item" affordance that opens a Food_Item picker sourced from `GET /experiences/:id/food-items`.
2. WHERE the User's search text in the Food_Item picker does not case-insensitively match any existing Food_Item, THE App SHALL offer an "Add [name]" action that submits it via `POST /experiences/:id/food-items` and, on `food_item_duplicate`, selects the returned existing item instead of showing an error.
3. WHEN the User selects a Food_Item, THE App SHALL open a modal sheet allowing the User to select a visit date (defaulting to today, latest selectable day capped at today in the device time zone), assign an optional 1–10 rating, and enter an optional note.
4. WHEN a `Food_Item_Log` is created or deleted, THE App SHALL invalidate the `['food-item-logs', foodItemId]` and `['experience-food-items', experienceId]` queries so the picker and any visible history reflect the change immediately.
5. WHERE a Food_Item has one or more `Food_Item_Log` records for the User, THE App SHALL display a repeat-count indicator (e.g. "Logged 3x") on that Food_Item's row in the picker, sourced from `GET /me/food-items/:foodItemId/logs`.
6. WHEN the User activates the repeat-count indicator on a Food_Item, THE App SHALL open a history view listing every `Food_Item_Log` for that Food_Item (date, rating, note), each with a delete action that calls `DELETE /me/food-items/:foodItemId/logs/:logId`.
7. WHERE a Food_Item's `currentlyOnMenu` is `false`, THE App SHALL render that item's row in the Food_Item picker and in any history view with a "Not currently on menu" label distinguishing it from a current item, while still allowing it to be selected for logging (Requirement 3, unaffected) — a past dish is never hidden, only visually distinguished from what is presently orderable.
8. WHERE a restaurant offers more than one menu (`MenuDTO`), THE Food_Item picker SHALL display a horizontal tab bar allowing the User to filter the displayed dishes by menu (e.g. "Breakfast", "Lunch and Dinner", "Allergy-Friendly") or view "All" dishes, defaulting to the primary menu when multiple menus exist.
9. WHEN a specific menu tab is selected in the Food_Item picker, THE App SHALL group the displayed dishes by the menu's groups (courses/sections) preserving the menu's group and item order.
10. WHERE a User searches within a specific menu tab and no items match within that menu but matching dishes exist on other menus for the restaurant, THE App SHALL provide an affordance to view matching dishes across all menus.

### Requirement 6: User-Submitted Locations for Uncatalogued Food-Selling Spots

**User Story:** As a User who wants to log a dish from a real food-selling location that has no catalog entry at all — e.g. a standalone snack cart Disney's own feed never modeled as its own entity — I want to create that location myself so logging isn't blocked, and I want the App to help me avoid creating a duplicate of a location someone else already added.

#### Acceptance Criteria

1. WHEN a User submits a request to create a User_Submitted_Location (`POST /locations`) with a `name` (1–200 chars, trimmed) and a `park` (one of the existing `Park` enum values), THE Food_Log_Service SHALL insert a new `User_Submitted_Location` row with `created_by_user_id` set to the submitting User, and return its `id`, `name`, and `park`.
2. BEFORE a User_Submitted_Location is created, THE Food_Log_Service SHALL surface, via `GET /locations/suggest?park=...&name=...`, every existing User_Submitted_Location in that `park` whose `name` has a trigram similarity (Postgres `pg_trgm` `similarity()`) to the submitted `name` at or above `LOCATION_SIMILARITY_THRESHOLD`, ordered by descending similarity, so the App can prompt the User to confirm whether one of these is the same real-world place before creating a new row.
3. THE Food_Log_Service SHALL NOT auto-merge, auto-select, or reject a creation request based on similarity alone — a suggested match is advisory only; creation proceeds if the User confirms none of the suggestions match, and Requirement 6.2's suggestion step never blocks or delays `POST /locations` itself (the two are separate requests, sequenced by the client).
4. THE Food_Log_Service SHALL enforce at most one User_Submitted_Location per case-insensitively identical `(park, name)` pair, rejecting an exact (post-normalization) duplicate with HTTP `409` and error code `location_duplicate`, returning the existing matching location's id — this exact-match guard is a backstop distinct from the similarity-based suggestion in Requirement 6.2, which only ever advises and never blocks.
5. THE Food_Log_Service SHALL allow a Food_Item (Requirement 1, 2) to be scoped to a User_Submitted_Location instead of a Restaurant_Experience: `POST /locations/:id/food-items` creates a `user_submitted`-sourced Food_Item exactly as Requirement 2 describes, except scoped by `location_id` instead of `experience_id`, with the identical case-insensitive per-scope duplicate rule and `food_item_duplicate` response.
6. THE Food_Log_Service SHALL reject a Food_Item creation or log request that supplies neither a Restaurant_Experience id nor a User_Submitted_Location id, or that supplies both, with HTTP `400` and error code `validation_failed` — a Food_Item is scoped to exactly one location kind.
7. THE Food_Log_Service SHALL make every User_Submitted_Location, and every Food_Item scoped to it, visible to all Users browsing that `park` identically to a catalog-scoped Food_Item — visibility is never scoped to the creating User alone, mirroring Requirement 2.3's rule for user-submitted dishes.
8. THE Food_Log_Service SHALL NOT provide a merge, rename-to-canonical, or promote-to-Restaurant_Experience operation for a User_Submitted_Location in this feature — a User_Submitted_Location that turns out to duplicate another, or that Disney's catalog later covers, remains a separate manually-created row; consolidating it is out of scope.

### Requirement 7: Mobile Flow for Creating and Using a User-Submitted Location

**User Story:** As a mobile App user who can't find their cart or stand in the app's restaurant search, I want a clear "this isn't in the list" path that helps me avoid creating a duplicate of one a friend already added.

#### Acceptance Criteria

1. WHERE the App's restaurant search (used to scope Food_Item logging, per Requirement 5.1) returns no match for what the User is looking for, THE App SHALL offer an "It's not listed" action that opens a User_Submitted_Location creation flow scoped to the User's currently-selected park.
2. WHEN the User types a name in the User_Submitted_Location creation flow, THE App SHALL query `GET /locations/suggest` (Requirement 6.2) and display any returned suggestions above the create action, each selectable in place of creating a new location.
3. WHEN the User selects a suggested existing User_Submitted_Location instead of creating a new one, THE App SHALL proceed directly to that location's Food_Item picker (Requirement 5) without calling `POST /locations`.
4. WHEN the User proceeds to create a new User_Submitted_Location despite one or more suggestions being shown, THE App SHALL submit the creation without further confirmation — Requirement 6.3 makes suggestions advisory, and the App SHALL NOT block creation on the User having reviewed or dismissed every suggestion.

### Requirement 8: My Food History (All Dishes Logged, Across All Restaurants and Locations)

**User Story:** As a User who has logged dishes at several restaurants over a trip, I want one place to see every dish I've eaten and rated, so that I don't have to remember which restaurant a dish was at just to find my own log of it.

#### Acceptance Criteria

1. WHEN a User requests their full food log history (`GET /me/food-item-logs`), THE Food_Log_Service SHALL return every `Food_Item_Log` belonging to that User across every Food_Item, sorted by `visited_on DESC, logged_at DESC`, each entry including the log's own fields (Requirement 3.1) plus its Food_Item's `name`, and the display name of the Food_Item's Restaurant_Experience or User_Submitted_Location (whichever scope applies).
2. IF the User has no `Food_Item_Log` records at all, THE Food_Log_Service SHALL return an empty list with HTTP status `200` — the same no-history-is-not-an-error convention as Requirement 4.2.
3. THE App SHALL provide a "My Food History" screen, reachable from the Profile screen, that renders the list from Requirement 8.1 with each row showing the dish name, the restaurant or location name, the visit date, the rating (if any), and the note (if any).
4. WHEN the User activates the delete action on a row in the My Food History screen, THE App SHALL call `DELETE /me/food-items/:foodItemId/logs/:logId` (Requirement 4.3) using that row's `foodItemId` and `logId`, and SHALL remove exactly that row from the displayed list on success.
5. WHERE a Food_Item's `currentlyOnMenu` is `false`, THE My Food History screen SHALL render that row with the same "Not currently on menu" label used elsewhere (Requirement 5.7), without disabling its delete action.
6. THE My Food History screen SHALL, by default, present the full list unfiltered and sorted by `visited_on DESC, logged_at DESC` (the order Requirement 8.1 already returns); the additional sort, filter, and search behavior in Requirement 8.7-8.10 changes only how the already-fetched Requirement 8.1 response is presented on screen, never what the App requests from the server.
7. THE My Food History screen SHALL provide a sort control offering, at minimum, "Most Recent" (the default order), "Oldest First", "Highest Rated First", and "Lowest Rated First"; selecting a sort option re-orders the currently-displayed rows client-side without issuing a new network request. WHERE two or more rows have an equal rating (including the `null`/no-rating case, which sorts after every rated row regardless of sort direction), THE App SHALL break the tie using the Requirement 8.1 order (`visited_on DESC, logged_at DESC`) so the ordering is deterministic.
8. THE My Food History screen SHALL provide a restaurant/location filter control populated from the distinct set of `restaurantName`/`locationName` values present in the currently-fetched list (derived client-side, not a separate endpoint call); selecting one or more values narrows the displayed rows to only those whose row matches a selected value, and clearing the filter restores the full list.
9. THE My Food History screen SHALL provide a free-text search input that, as the User types, narrows the displayed rows to those whose `foodItemName`, `restaurantName`, or `locationName` case-insensitively contains the entered text; clearing the search input restores the rows implied by the current sort and filter selections.
10. THE sort, filter, and search controls in Requirement 8.7-8.9 SHALL compose together (e.g. a search term narrows within an already-restaurant-filtered set, and the sort order applies to whatever rows remain after filtering/search) rather than resetting one another.
11. THE My Food History screen SHALL provide an affordance to add or update a rating for any displayed log: for an unrated log, an accessible "+ Add rating" button opens a 1–10 rating prompt; for a rated log, activating its rating indicator opens the rating prompt to change the rating; confirming a rating SHALL call `PATCH /me/food-items/:foodItemId/logs/:logId` (Requirement 4.5) with the updated rating and refresh the food history view.

### Requirement 9: My Logged Items at a Specific Restaurant or Location

**User Story:** As a User standing at a restaurant I've visited before, I want to quickly see which dishes I've already logged here, so that I can decide whether to try something new or log a repeat of a favorite, without having to search my full food history for this one place.

#### Acceptance Criteria

1. WHEN a User requests their logged Food_Items for a specific Restaurant_Experience (`GET /experiences/:id/food-item-logs/mine`), THE Food_Log_Service SHALL return every `Food_Item_Log` belonging to that User whose Food_Item is scoped to that Restaurant_Experience, sorted by `visited_on DESC, logged_at DESC`, each entry including the log's own fields plus its Food_Item's `name`.
2. WHEN a User requests their logged Food_Items for a specific User_Submitted_Location (`GET /locations/:id/food-item-logs/mine`), THE Food_Log_Service SHALL return the equivalent list scoped to that User_Submitted_Location, identical in shape to Requirement 9.1's response.
3. IF the User has no `Food_Item_Log` records at that Restaurant_Experience or User_Submitted_Location, THE Food_Log_Service SHALL return an empty list with HTTP status `200`.
4. THE App SHALL provide a "My logged items here" affordance on the Experience Detail screen for a Restaurant_Experience (Requirement 5) and on the equivalent User_Submitted_Location food-item picker entry point (Requirement 7), each opening a view sourced from Requirement 9.1/9.2 respectively, scoped to that specific restaurant or location only — never the User's full history.
5. WHEN the User activates the delete action on a row in this restaurant/location-scoped view, THE App SHALL call `DELETE /me/food-items/:foodItemId/logs/:logId` (Requirement 4.3) exactly as Requirement 8.4 describes, removing exactly that row.
6. WHERE a Food_Item's `currentlyOnMenu` is `false`, THE restaurant/location-scoped view SHALL render that row with the same "Not currently on menu" label used elsewhere (Requirement 5.7), without disabling its delete action.
7. THE restaurant/location-scoped view SHALL provide the same sort control described in Requirement 8.7 ("Most Recent", "Oldest First", "Highest Rated First", "Lowest Rated First", with the identical tie-break rule), applied client-side to the already-fetched Requirement 9.1/9.2 response — a restaurant/location filter control (Requirement 8.8) is not offered here since the view is already scoped to one restaurant or location.
8. THE restaurant/location-scoped view SHALL provide the same free-text search input described in Requirement 8.9, narrowing displayed rows by case-insensitive match against `foodItemName` only (there is no restaurant/location name to search against, since every row in this view shares the same one).
