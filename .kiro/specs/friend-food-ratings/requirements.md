# Requirements Document

## Introduction

Guests log the dishes they eat (`food_item_logs`): a dish, a visit date, an optional 1–10 rating, and an optional free-text note. Today the per-dish log is visible only to its owner. Every food-log route is `/me/...` or owner-scoped, so a Guest can see their own food history but cannot browse what their friends loved, which makes the log a diary and not a social tool. (The only friend-visible slice today is the aggregated `foodActivity` block of the friend stats payload: top dishes and personal records, with no full list, no filters and no per-dish counts.) Friends already see each other's *experience* ratings by default (`friend-stats-viewing` R4.3/R4.4); dishes are the missing half of "what should I order at this restaurant".

This feature lets an **accepted Friend** see a Guest's **per-dish food ratings** — never their notes — in three places:

1. **Friend profile Overview** — a "Food highlights" row of the friend's top-rated dishes with a "See all" link (Requirement 11).
2. **Friend Food History** — a friend-scoped reuse of the existing My Food History screen, with sort, filter, search and pagination (Requirement 12). It is a pushed screen in the existing `YouAndCrewStack`, **not** a fourth tab on the friend profile.
3. **Inline social proof on a restaurant's menu and the food item picker** (Phase 2, Requirements 14–15): "Sam and 2 friends rated this 8.5".

**Visibility model (fixed product decision):** friend visibility of food ratings is **always on for accepted Friends**. There is **no opt-out setting, no launch notice and no disclosure copy**. Rationale: ride and restaurant ratings are already visible to accepted friends with no opt-out (`friend-stats-viewing` R4.3/R4.4), food ratings are the same kind of data, and the app is not live yet, so there are no existing users who logged food assuming privacy. Food ratings therefore follow the **same visibility model as ride/restaurant ratings: accepted Friends only, no opt-out, and notes private unless a future shareable flag exists** (Requirement 5). A future per-user control (an account-level or per-dish switch) would be an additive follow-up — a new migration plus a filter in the same queries — and is explicitly **out of scope** for this spec. The owner always sees their own data.

**One row per dish, aggregated.** A Guest may log the same dish many times (`food_item_logs` has no unique constraint on `(user_id, food_item_id)`). A Friend therefore sees one row per distinct dish carrying the **average** of that Guest's non-null ratings (a continuous value; the 1–10 display rounding is display-only and never fed back into any calculation), the **log count** (how often they had it), and the **latest log date** (Requirement 4). A dish that was logged but never rated appears with no rating rather than being hidden or given a fake one (Requirement 4.5).

**Why a lower highlights threshold than Stats.** `highestRated` in the own-stats payload requires two *rated* logs of the same dish (`FOOD_STATS_MIN_RATED_LOGS = 2`) so a one-off outlier does not enter a personal "best of" ranking. A friend glancing at "what did Sam like" has the opposite need: most restaurant dishes are eaten once, and a single rating is exactly the signal a friend wants. Friend highlights therefore require **one** rated log (`FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS = 1`). This discloses nothing the full list (Requirement 12) does not already show, because the list shows every dish the Guest logged (Requirement 11.3).

## Relationship to Existing Friend Visibility

This spec **deliberately widens** who can read a Guest's per-dish food logs, to accepted Friends and consistently with how ratings are already shared. No existing requirement says in so many words that "food logs are private"; the stance is *implicit* (every food-log route is `/me/...` or owner-scoped). The exact existing requirements affected are listed below. **None of those specs is edited by this change**; this spec states how it interacts with each, and the existing requirements keep their numbers and text.

| Existing spec | Requirements | Effect of this spec |
| --- | --- | --- |
| `food-item-logging` | R4.1, R4.3, R4.4, R4.5, R4.6 (history, delete, update scoped to the authenticated User; cross-user access collapses to `food_log_not_found`) | **Unchanged.** Friend reads use new, separate, read-only routes; the owner-scoped routes are not relaxed and no friend can mutate or probe a log. |
| `food-item-logging` | R8.1, R8.3 ("My Food History"), R9.1, R9.2 ("mine") | **Unchanged.** `GET /me/food-item-logs` and the `.../mine` routes stay owner-only. |
| `food-item-logging` | R3.5 (Food_Item_Log is a separate stream from completions/ratings) | **Preserved.** Friend ratings are a read projection; this feature writes nothing to `food_item_logs`. |
| `food-item-logging` | R1.5, R1.6, R2.3, R6.7 (food-item catalog is public) | **Preserved.** `GET /experiences/:id/food-items` and `GET /locations/:id/food-items` stay unauthenticated and unchanged; friend ratings are never folded into them (Requirement 14). |
| `food-lists` | R13 (R13.7, R13.19, R13.23: checklist `gotten`/`rating` reflect the *viewer's own* logs) | **Preserved.** Shared-list viewers still see only their own ratings. |
| `stats-experience-redesign` | R24.8 (`foodActivity` returned on both `GET /me/stats` and `GET /me/stats/summary`), R25.1–R25.4 (Most Logged), R26.1–R26.5 (Highest Rated), R27.1–R27.5 (Personal Records) | **Unchanged; the friend exposure is intentional and consistent.** An accepted friend can already read the target's dish names, average ratings and restaurant names through `GET /me/stats/summary?for=<targetId>`. With friend visibility always on, that is intended behavior, and this feature adds **no** projection or narrowing to the stats path. The stats payload carries no Log note (no stats query selects one), and Requirement 5.1 keeps that as a guarantee. |
| `stats-experience-redesign` | R28.8 (Compare tab shows Total Dishes Logged / Distinct Restaurants Visited) | **Unchanged.** |
| `stats-experience-redesign` | R11, R22 and `expanded-stats` R9.1 ("friend response structurally identical to own response") | **Unchanged.** Friend and own `foodActivity` stay structurally identical; no documented exception is needed. |
| `friend-stats-viewing` | R1.1–R1.7 (Owner_Or_Friend_Rule, `profile_forbidden`, no analytics on deny, termination effective immediately) | **Mirrored.** The new friend-gated routes satisfy the same contract (Requirement 3). |
| `friend-stats-viewing` | R4.3, R4.4 (ratings default-visible to friends, no opt-out), R4.6, R4.7 (notes opt-in) | **Direct precedent.** Ratings visible to accepted friends with no opt-out; notes are stricter here: never visible, no share flag (Requirement 5). |

## Glossary

- **App**: The mobile client (`apps/mobile`) of the Disney World Tracker.
- **User** / **Guest**: An authenticated user of the App.
- **Friend**: A User for whom a row exists in `friendships` with the requester (canonical pair `user_lo_id < user_hi_id`). The `friendships` table has **no status column**: a row *is* an accepted friendship. A pending request lives in `friend_requests`; there is no block and no soft-remove (`removeFriend` hard-deletes the row). "Accepted Friend" and "Friend" are the same thing in this spec.
- **Owner**: The User who logged the dishes being read.
- **Viewer**: The authenticated User making the read.
- **Dish**: A `food_items` row, scoped to exactly one of an Experience (`experience_id`, a catalog restaurant or similar) or a user-submitted location (`location_id`).
- **Scope**: The Experience or user-submitted location a Dish belongs to. Its display name is `experiences.name` or `user_submitted_locations.name`; its park is `experiences.park` for an Experience (null for a park-less Experience) and `user_submitted_locations.park` for a user-submitted location (that column is `TEXT NOT NULL` with a `CHECK` over the shared park values, migration `0040_food_item_logging.sql`, so a location-scoped Dish always has a park). A Scope's park is therefore `COALESCE(experiences.park, user_submitted_locations.park)`.
- **Log**: A `food_item_logs` row: `rating` (nullable `SMALLINT` 1–10), `note` (nullable), `visited_on` (DATE), `logged_at` (TIMESTAMPTZ).
- **Rated_Log**: A Log whose `rating` is not null. **Unrated_Log**: a Log whose `rating` is null.
- **Dish_Rating_Row**: The aggregated per-Dish view of one Owner's Logs: `averageRating` (mean of the Owner's Rated_Log ratings for that Dish, or null when there is none), `ratedLogCount`, `logCount` (all Logs, rated or not), `latestVisitedOn` (the maximum `visited_on`).
- **Friend_Food_Ratings_Service**: The backend capability added by this spec — a new service folder `apps/api/src/services/friendFoodRatings/` holding the pure aggregation module and the friend-ratings repo and routes. It has no persistence of its own.
- **Highlights**: The Friend's top-rated Dishes shown on the friend profile Overview (`FRIEND_FOOD_HIGHLIGHT_COUNT`, default 5).
- **Friend_Food_History_Screen**: The read-only `FriendFoodHistoryScreen` of Requirement 12 (the full per-Dish list for one Friend).
- **Social_Proof**: The Phase 2 inline indicator on a menu or picker row showing which of the Viewer's Friends rated that Dish and their average.
- **Empty_State**: The presentation for a Friend with no matching Dishes.
- **Display_Rating**: The human-friendly rendering of a continuous average (one decimal place, e.g. "8.3"). Display-only.

## Requirements

### Requirement 1: (Withdrawn) Account-Level Sharing Setting

**User Story:** Withdrawn by product decision: friend food-rating visibility is always on for accepted Friends, with no opt-out and no notice.

#### Acceptance Criteria

1. (Withdrawn; no acceptance criteria apply.)

### Requirement 2: (Withdrawn) Migration and Persistence

**User Story:** Withdrawn by product decision: friend food-rating visibility is always on for accepted Friends, with no opt-out and no notice.

#### Acceptance Criteria

1. (Withdrawn; no acceptance criteria apply.)

### Requirement 3: Friend-Gated Dish Ratings List

**User Story:** As a Guest, I want to see the dishes a friend has rated, so that I know what to order, and I want strangers not to.

#### Acceptance Criteria

1. WHEN a Viewer requests `GET /users/:userId/food-ratings`, THE Friend_Food_Ratings_Service SHALL authorize the read with the existing `assertOwnerOrFriend` rule before reading any Log, and SHALL return the target's Dish_Rating_Rows only when the Viewer is the target or a Friend of the target.
2. IF the Viewer is neither the target nor a Friend of the target (a non-friend, a Viewer with only a pending `friend_requests` row, a former Friend after `removeFriend`, or a non-existent target), THEN THE Friend_Food_Ratings_Service SHALL reject the request with HTTP `403` and error code `profile_forbidden`, identically for all those cases, reading no Log and writing no analytics, audit or telemetry record.
3. THE route SHALL require an authenticated session evaluated before the authorization rule; a missing or expired session SHALL yield `401` `unauthorized` regardless of the target. THE route SHALL be registered in the production service map, so an unauthenticated request answers `401` and not `404`.
4. IF the `:userId` path parameter is not a UUID, THEN THE route SHALL reject the request with `400` `validation_failed` before any database access.
5. WHEN a Friendship is removed, THE Friend_Food_Ratings_Service SHALL reject the former Friend's very next read per criterion 2, with no cached or revoked-share state to expire (the rule re-queries `friendships` on every read).
6. WHEN the Viewer is the target, THE route SHALL return the Owner's own Dish_Rating_Rows and SHALL still omit notes (Requirement 5).
7. THE route SHALL read only the target's own Logs; it SHALL NOT return any other User's Log, and it SHALL NOT write to `food_item_logs`, `completions`, `ratings` or any tracking table.
8. THE existing owner-scoped routes (`/me/food-item-logs`, `/me/food-items/:foodItemId/logs...`, `.../mine`) SHALL remain unchanged in behavior and authorization.

### Requirement 4: Per-Dish Aggregation

**User Story:** As a Guest viewing a friend's food, I want one line per dish with their overall opinion, how often they had it, and when they last did, so that I am not reading a friend's whole diary.

#### Acceptance Criteria

1. THE route SHALL return exactly one Dish_Rating_Row per distinct Dish (`food_item_id`) that the target has at least one Log for (subject to filters, Requirement 6), regardless of how many Logs the Dish has.
2. THE `averageRating` of a Dish_Rating_Row SHALL be the arithmetic mean of the ratings of the target's Rated_Logs for that Dish only; Unrated_Logs SHALL NOT contribute to the mean or to `ratedLogCount`.
3. THE `averageRating` SHALL be a continuous value (not rounded or truncated by the service) and SHALL lie in the closed interval `[1, 10]` whenever it is non-null.
4. THE `logCount` SHALL equal the number of the target's Logs for that Dish (rated and unrated), `ratedLogCount` SHALL equal the number of those with a non-null rating, and `latestVisitedOn` SHALL equal the maximum `visited_on` of those Logs as a `YYYY-MM-DD` string.
5. WHEN a Dish has Logs but none are rated, THE row SHALL be included with `averageRating = null` and `ratedLogCount = 0`, and THE App SHALL render it as "Not rated" (never as 0, never with a fabricated rating). Such Dishes SHALL be excluded from Highlights and from Phase 2 Social_Proof, which are ratings-only surfaces.
6. EACH row SHALL carry the Dish's id and name, its Scope kind (`experience` or `location`), Scope id, Scope name, and the Scope's park (the Experience's `park`, or the user-submitted location's mandatory `park`; null only for a park-less Experience).
7. THE aggregation SHALL include Dishes from both Experience scopes and user-submitted-location scopes, and SHALL NOT filter on whether the Dish is currently on the menu or the Experience is active, matching the Owner's own My Food History.

### Requirement 5: Notes and Private Fields Never Exposed

**User Story:** As a Guest, I want my notes to stay mine, so that I can write candidly without wondering who reads them.

#### Acceptance Criteria

1. THE API SHALL NOT include a Log `note`, in any field, in any friend-facing payload (the list, the Highlights read, the Phase 2 batch read, and the existing friend stats `foodActivity` payload that this feature leaves unchanged), for any Viewer including the Owner viewing through these routes.
2. THE friend-facing DTOs of the new routes SHALL have no `note` field and no per-Log identifier, `userId` of the Log, `userTz` or `loggedAt`, and SHALL NOT reuse `FoodItemLogDTO` or `FoodItemLogWithContextDTO`. THE SQL for friend reads (the new repo, and the existing stats statements that read `food_item_logs`) SHALL NOT select `food_item_logs.note`, and no statement that references `food_item_logs` SHALL contain the identifier `note`, the wildcards `fil.*` or `food_item_logs.*`, or a bare `SELECT *` or `RETURNING *`, because a wildcard would carry `note` into the result implicitly.
3. THE payloads of the new routes (the list, the Highlights read and the Phase 2 batch read) SHALL NOT include any individual Log row, only the per-Dish aggregate, so a Friend cannot reconstruct individual visit ratings or dates beyond `latestVisitedOn` from those payloads. THE decoded opaque pagination `nextCursor` SHALL carry no Log timestamp (`logged_at`) and no date other than a `latestVisitedOn` value already present in the payload, so that every field of the new routes' responses meets this criterion. This criterion does not apply to the unchanged friend stats `foodActivity` payload, which keeps carrying its existing personal-record visit dates (`mostAdventurousDay.date` and `dishMarathonRecord.date`); that exposure is intentional (Relationship to Existing Friend Visibility, `stats-experience-redesign` R27) and this feature neither adds nor removes it.
4. THE API SHALL NOT provide a share flag, setting or request parameter that causes a note to be included in a friend-facing payload.

### Requirement 6: Sort, Filter, Search and Pagination

**User Story:** As a Guest browsing a friend's dishes, I want to sort, narrow and search the list, and page through a long one, so that I can find the dish I'm after.

#### Acceptance Criteria

1. THE list route SHALL accept `sort` of `highest_rated`, `recent` or `most_logged` (default `recent`) and SHALL order the aggregated rows by a strict total order:
   - `highest_rated`: average rating descending (dishes with no rating last), then `ratedLogCount` descending, then `foodItemId` ascending;
   - `recent`: `latestVisitedOn` descending, then `foodItemId` ascending (no `logged_at` is used as a tie-break, so no Log timestamp finer than `latestVisitedOn` enters the order or the cursor, Requirements 5.2 and 5.3);
   - `most_logged`: `logCount` descending, then `latestVisitedOn` descending, then `foodItemId` ascending.
2. THE list route SHALL paginate with the keyset convention already used for discovery lists (`foodLists`): an opaque `cursor` string and a `limit` (default `FRIEND_FOOD_PAGE_SIZE_DEFAULT = 20`, minimum 1, maximum `FRIEND_FOOD_PAGE_SIZE_MAX = 50`), returning `{ items, nextCursor }` where `nextCursor` is `null` on the last page.
3. WHEN a client requests every page in sequence using each response's `nextCursor`, THE concatenation of the pages SHALL equal the complete sorted list exactly once, with no duplicate and no missing row, for every `sort`.
4. THE list route SHALL accept the filters `experienceId` (restaurant), `locationId` (user-submitted location) and `park` (a value from the shared `PARKS` list), and SHALL apply every supplied filter conjunctively. THE `park` filter SHALL match a Dish by its Scope's park as defined in the Glossary, so it includes Dishes scoped to a user-submitted location (whose `park` is mandatory) as well as Dishes scoped to an Experience. IF both `experienceId` and `locationId` are supplied, THEN THE route SHALL reject with `400` `validation_failed`.
5. THE list route SHALL accept `q`, a dish-name search of 1–`FRIEND_FOOD_SEARCH_MAX_LENGTH` (100) characters after trimming, matching case-insensitively as a substring of the Dish name, composed conjunctively with the other filters. THE characters `%`, `_` and `\` in `q` SHALL be matched literally.
6. THE list route SHALL accept `minRatedLogs` (integer 0–10, default 0) and SHALL return only Dishes whose `ratedLogCount` is at least that value. THE mobile Highlights read SHALL pass `FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS` (1).
7. IF `cursor`, `sort`, `limit`, `park`, `q`, `minRatedLogs` or any id filter is malformed, or the query contains an unknown key, THEN THE route SHALL reject the request with `400` `validation_failed` and SHALL read no Log. A `cursor` issued for one `sort` and presented with another SHALL be rejected the same way. THE query-schema checks (everything except cursor contents) SHALL run before the authorization gate; THE `cursor` contents (undecodable, tampered, or issued for a different `sort`) SHALL be checked after the gate, so the `400` for a bad `cursor` applies to the Owner and to Friends, while a non-friend still receives `403` `profile_forbidden` (Requirement 3.2), revealing nothing about the Target's Logs.
8. THE first page (no `cursor`) SHALL also return `scopes`, the distinct Scopes (id, kind, name, park, dish count; at most `FRIEND_FOOD_SCOPES_MAX = 200`, ordered by name ascending then id) the target has Logs in, computed independently of `q`, `limit` and the other filters, so the App can render restaurant and park filter chips. Continuation pages SHALL return `scopes: null`.

### Requirement 7: (Withdrawn) Opt-Out Enforced Everywhere

**User Story:** Withdrawn by product decision: friend food-rating visibility is always on for accepted Friends, with no opt-out and no notice.

#### Acceptance Criteria

1. (Withdrawn; no acceptance criteria apply.)

### Requirement 8: (Withdrawn) Friend-Stats Opt-Out Projection

**User Story:** Withdrawn by product decision: friend food-rating visibility is always on for accepted Friends, with no opt-out and no notice.

#### Acceptance Criteria

1. (Withdrawn; no acceptance criteria apply.)

### Requirement 9: (Withdrawn) One-Time Launch Notice

**User Story:** Withdrawn by product decision: friend food-rating visibility is always on for accepted Friends, with no opt-out and no notice.

#### Acceptance Criteria

1. (Withdrawn; no acceptance criteria apply.)

### Requirement 10: (Withdrawn) Settings Toggle on You & Crew

**User Story:** Withdrawn by product decision: friend food-rating visibility is always on for accepted Friends, with no opt-out and no notice.

#### Acceptance Criteria

1. (Withdrawn; no acceptance criteria apply.)

### Requirement 11: Friend Profile Highlights and See All

**User Story:** As a Guest viewing a friend's profile, I want a quick look at their best-rated dishes with a way to see everything, so that I get the gist without leaving the profile.

#### Acceptance Criteria

1. WHEN the App renders the Overview mode of the friend profile, THE App SHALL render a "Food highlights" row containing up to `FRIEND_FOOD_HIGHLIGHT_COUNT` (5) of the Friend's Dishes, obtained from the list route with `sort=highest_rated`, `limit=5` and `minRatedLogs=FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS` (1), each showing the dish name, the Display_Rating as text out of 10, and the Scope name.
2. THE Highlights SHALL include only Dishes with at least one Rated_Log (Requirement 4.5) and SHALL be ordered by the `highest_rated` order of Requirement 6.1.
3. THE row SHALL show a "See all" action, navigating to the Friend Food History screen (Requirement 12) for that Friend; "See all" shows the full list including Unrated_Log Dishes, so the lower Highlights threshold discloses nothing beyond it.
4. THE row's loading, error and forbidden behavior SHALL follow the existing friend profile model: a `profile_forbidden` response is terminal and collapses the screen like the other Overview reads, and other errors show a scoped retry without affecting the rest of the Overview.
5. THE Highlights query SHALL have its own query key and SHALL NOT be a prerequisite of, or re-issue, the profile and stats reads.
6. WHEN the Friend has no qualifying Dishes, THE row SHALL show the Empty_State of Requirement 13 instead of dish cards.
7. THE friend profile SHALL NOT gain a new tab; the entry point is the Overview row only.

### Requirement 12: Friend Food History Screen

**User Story:** As a Guest, I want to browse everything a friend has rated with the same sorting, filtering and search I already use for my own food history, so that I don't have to learn a new screen.

#### Acceptance Criteria

1. THE App SHALL provide a Friend Food History screen registered as the route `FriendFoodHistory: { friendId: string; displayName: string }` in `YouAndCrewStack`, reached from the Highlights "See all" action. THE friend profile SHALL NOT gain a tab and `CollectionStack` SHALL NOT be changed to host it.
2. THE screen SHALL reuse the search field, sort chip row and filter chip row of the existing My Food History screen, extracted into shared presentational components with My Food History's behavior, test IDs and tests unchanged.
3. THE screen SHALL offer the sort options "Highest rated", "Most recent" and "Most logged", a search field for the dish name (debounced by `FRIEND_FOOD_SEARCH_DEBOUNCE_MS`, default 300), restaurant/location filter chips and park filter chips derived from the response's `scopes`, each driving the corresponding list-route parameter (Requirement 6). WHEN the search field is empty or contains only whitespace, THE screen SHALL omit the `q` parameter from the request entirely (an empty `q` is a `400` under Requirement 6.5), and SHALL send `q` only as the trimmed non-empty text. THE park filter chips SHALL include the park of location-scoped Scopes (Requirement 4.6).
4. THE screen SHALL load subsequent pages when the list is scrolled near its end using the previous response's `nextCursor`, and SHALL show a footer loading indicator while the next page loads.
5. EACH row SHALL show the dish name, the Scope name, the Display_Rating as text out of 10 (or "Not rated"), the log count as text (for example "Logged 3 times"), and the latest visit date.
6. THE screen SHALL be strictly read-only: it SHALL NOT render delete, add-rating, edit-rating or note affordances and SHALL NOT call any mutating endpoint.
7. IF the list route returns `profile_forbidden`, THEN THE screen SHALL show the existing forbidden treatment used by the friend profile and SHALL NOT retry.
8. WHEN the Viewer changes sort, search, or any filter, THE screen SHALL discard the prior pages and request the first page with the new parameters.
9. WHEN loading a page of the list fails with an error other than `profile_forbidden`, THE Friend_Food_History_Screen SHALL show an error state with text and a retry control that has an `accessibilityRole` and an `accessibilityLabel`: WHEN the first page fails, THE screen SHALL replace the list with the error state, and WHEN a subsequent page fails (infinite scroll), THE screen SHALL keep the already-loaded rows and offer retry for that page. THE retry control SHALL re-issue the failed request with the same parameters (and the same `cursor` for a subsequent page) and, on success, THE screen SHALL show the rows. THE screen SHALL NOT offer retry for `profile_forbidden`, which remains terminal (criterion 7), mirroring the Highlights failed-load behavior (Requirement 11.4).

### Requirement 13: Empty States

**User Story:** As a Guest, I want to know when a friend simply has no dishes to show, so that an empty screen is never mistaken for a failure.

#### Acceptance Criteria

1. WHEN the target is the Viewer or a Friend and has no Logs, or none match the supplied filters, THE list route SHALL respond `200` with `items: []` and `nextCursor: null`, and with `scopes` as an empty array on a first page. The only non-success outcome for a Viewer who is not allowed to read the target is `403` `profile_forbidden` (Requirement 3.2); no separate "private" response exists.
2. (Withdrawn: the private state belonged to the withdrawn opt-out, Requirements 1 and 7. No acceptance criterion.)
3. WHEN the list response has no Dishes and no search or filter is active, THE App SHALL show "{displayName} hasn't logged any dishes yet." as text, with a text label next to any icon.
4. WHEN the list response has no Dishes while a search or filter is active, THE App SHALL show "No dishes match your search or filters." and a control to clear them.
5. WHEN the Highlights read returns no Dishes, THE row SHALL show "{displayName} hasn't rated any dishes yet." and still show "See all".
6. (Withdrawn: the Owner-never-private rule belonged to the withdrawn opt-out. No acceptance criterion.)
7. (Withdrawn: the Phase 2 opted-out-Owner rule belonged to the withdrawn opt-out; Phase 2 rows without a Social_Proof entry render as today, Requirement 15.4. No acceptance criterion.)

### Requirement 14: Batch Menu Social Proof Endpoint (Phase 2)

**User Story:** As a Guest looking at a restaurant's menu, I want to know which dishes my friends rated, loaded together with the menu, so that the menu doesn't feel slow.

#### Acceptance Criteria

1. THE Friend_Food_Ratings_Service SHALL provide `GET /experiences/:id/food-item-logs/friends` and `GET /locations/:id/food-item-logs/friends`, each requiring an authenticated session, returning `{ items: FriendDishSocialProofDTO[] }` for every Dish of that Scope that at least one of the Viewer's Friends has rated.
2. THE batch read SHALL derive the audience from the Viewer's own `friendships` rows only; it SHALL NOT accept a friend id parameter. A Viewer with no Friends SHALL receive `{ items: [] }`, and a non-friend's Logs SHALL never be returned.
3. FOR each returned Dish and each Friend included, THE per-friend aggregate (`averageRating`, `ratedLogCount`, `logCount`, `latestVisitedOn`) SHALL equal the Dish_Rating_Row the single-friend list route (Requirement 4) returns for that Friend and Dish.
4. EACH item SHALL carry `friendCount` (the number of Friends who rated the Dish, counting all of them), `friendsAverageRating` (the arithmetic mean of those Friends' average ratings, continuous), and `friends`, at most `FRIEND_FOOD_INLINE_MAX_FRIENDS` (3) Friends ordered by `averageRating` descending, then `latestVisitedOn` descending, then friend id ascending, each with `friendId`, `displayName` and `avatarPreset`.
5. THE batch read SHALL execute one friend-and-ratings query for the whole Scope regardless of how many Dishes the menu has (no per-dish and no per-friend query), and SHALL return at most `FRIEND_FOOD_BATCH_MAX_ROWS` (5000) per-friend-per-dish rows before grouping.
6. THE batch read SHALL include only Friends with at least one Rated_Log for the Dish, and SHALL exclude the Viewer's own Logs.
7. THE batch read SHALL NOT be folded into `GET /experiences/:id/food-items` or `GET /locations/:id/food-items`, which remain unauthenticated and unchanged.
8. IF the `:id` path parameter is not a UUID, THEN THE route SHALL reject with `400` `validation_failed`; IF the Scope does not exist, THEN THE route SHALL return `{ items: [] }` (no existence probe), consistent with the `.../mine` routes.

### Requirement 15: Inline Social Proof on Menu and Food Item Picker (Phase 2)

**User Story:** As a Guest choosing what to eat, I want to see right on the menu which dishes my friends rated, so that I can order with their opinion in mind.

#### Acceptance Criteria

1. WHEN the App renders `MenuScreen` for an Experience, THE App SHALL issue exactly one request to `GET /experiences/:id/food-item-logs/friends` for that screen and SHALL use its result to annotate every dish row; it SHALL NOT issue a per-row friend query.
2. WHEN the App renders `FoodItemPickerModal` for an Experience or a user-submitted location, THE App SHALL use the matching batch endpoint once per open modal, and SHALL NOT issue a per-row friend query.
3. FOR each dish with Social_Proof, THE row SHALL show up to three Friends' avatars or initials, the `friendsAverageRating` as text out of 10, and the Friend count (for example "Sam and 2 friends · 8.5/10"); WHERE `friendCount` exceeds the Friends shown, THE row SHALL show the overflow count ("+N").
4. FOR a dish with no Social_Proof entry, THE row SHALL render exactly as it does today.
5. WHEN the batch request is loading or fails, THE menu and picker SHALL render and function exactly as they do without Social_Proof; a failure SHALL NOT show an error banner or block logging a dish.
6. WHEN the Viewer logs or edits a rating, THE batch query SHALL NOT be refetched (the Viewer's own Logs are not in it).

### Requirement 16: Continuous Values and Display-Only Rounding

**User Story:** As a maintainer, I want averages kept precise internally and rounded only for display, so that sorting and aggregation stay consistent.

#### Acceptance Criteria

1. THE API SHALL return `averageRating` and `friendsAverageRating` as unrounded numbers, and every sort, comparison, filter and aggregate SHALL use those continuous values.
2. THE App SHALL format a rating for display with a single pure helper (one decimal place, for example `8.3`) used by every surface, and SHALL NOT pass the formatted value into any sort, comparison, aggregation or request.
3. THE `highest_rated` order and the `friendsAverageRating` mean SHALL be computed from continuous values only; two averages that differ before rounding but display identically SHALL still be ordered by their continuous values.

### Requirement 17: Accessibility

**User Story:** As a Guest using assistive technology, I want every rating and state announced as text, so that nothing depends on colour or an icon.

#### Acceptance Criteria

1. EVERY rating shown by this feature SHALL be presented as text (for example "8.3/10"), and any star or avatar icon SHALL be decorative alongside it; no meaning SHALL rely on colour alone.
2. EVERY interactive control added by this feature ("See all", sort chips, filter chips, search clear and retry) SHALL have an `accessibilityRole` and an `accessibilityLabel`.
3. EACH dish row, Highlights card and Social_Proof chip SHALL expose one `accessibilityLabel` that states the dish, the rating in words (or "not rated"), the log count, and for Social_Proof the Friends' names, produced by a single pure label builder.
4. THE Empty_State and the error state SHALL be announced as text with a text label next to any icon.
5. (Withdrawn: the launch-notice modal behavior belonged to the withdrawn notice, Requirement 9. No acceptance criterion.)

### Requirement 18: Dark Mode Theming

**User Story:** As a Guest using the Twilight dark theme, I want the new surfaces to look right in both themes, so that nothing is unreadable.

#### Acceptance Criteria

1. EVERY new mobile style SHALL be built with `makeStyles((t) => ...)` and every inline colour read from `useAppTheme()`; no raw colour literal and no static theme colour token SHALL be used.
2. A one-off literal colour SHALL live in a co-located `<File>.palette.ts` via `definePalette({ light, dark })`, with `primary` for fills and `primaryFg` for primary-hued text and icons.
3. MEMOIZED values and list render callbacks that read `styles` or `t` SHALL list them in their dependencies, and `FlatList`s SHALL pass `extraData` including `t.scheme`, so a scheme switch repaints.
4. THE existing guard `src/__tests__/themeRetrofit.guard.test.ts` SHALL remain green with no allowlist change.

### Requirement 19: Performance and Hosting Bounds

**User Story:** As the operator of a free-tier deployment, I want these reads to be bounded and request-time only, so that they fit the Neon, Render and Upstash budgets.

#### Acceptance Criteria

1. EVERY read in this feature SHALL be request-time SQL; THE feature SHALL NOT add a background worker, a scheduled job, a Redis key or a bulk push.
2. THE list route SHALL return at most `FRIEND_FOOD_PAGE_SIZE_MAX` rows per page and the batch read SHALL be bounded by Requirement 14.5, so no response grows with the Owner's total number of Logs.
3. THE feature SHALL add no table, column, index or other persisted growth, and the Friend_Food_Ratings_Service SHALL be read-only (it SHALL issue no `INSERT`, `UPDATE`, `DELETE` or DDL statement).
4. THE single-friend list SHALL be served by the existing index `food_item_logs_user_idx (user_id, visited_on DESC, logged_at DESC)` and the batch read by `food_item_logs_user_item_idx (user_id, food_item_id, ...)` driven from the Viewer's Friend set (friend-first), and SHALL NOT be written item-first. A new index would be an additive follow-up gated on an `EXPLAIN` against a realistic seed.

## Cross-Spec Dependencies

- **`food-item-logging`** (required, built): owns `food_items`, `food_item_logs`, `FoodItemLogDTO` and the owner-scoped routes. This spec reads those tables, reuses none of its DTOs (they carry `note`), and relaxes none of its requirements.
- **`friend-stats-viewing`** (required, built): owns `assertOwnerOrFriend`, `profile_forbidden`, and the always-visible-ratings precedent. Requirement 3 mirrors R1.1–R1.7.
- **`stats-experience-redesign`** (required, built, **not amended**): R24.8 and R25–R28 define the `foodActivity` payload that friends can already read; this spec leaves it untouched and treats that exposure as intentional.
- **`restaurant-menu-display`** (Phase 2): `MenuScreen` is the host of the inline annotation.
- **`dark-mode`**: theming rules bind Requirement 18.
- **`friend-profile-navigation`**: the Overview row follows its per-read loading/error/forbidden model.
- **`food-lists`** (optional, untouched): `FoodListDetailScreen` does not get Social_Proof in this spec.

**Build order:** shared contracts → aggregation and friend list route (with production wiring and the stats no-note guard) → mobile friend history and Highlights (**Phase 1**) → batch endpoint → inline menu and picker Social_Proof (**Phase 2**) → final full verification.
