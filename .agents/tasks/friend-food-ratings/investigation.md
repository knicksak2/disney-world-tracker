# Investigation: `friend-food-ratings`

Read-only investigation for authoring the `friend-food-ratings` spec. Nothing in application code was
modified. All paths are relative to the repo root `c:\Users\knick\dev\disney-app` and all line numbers
were read from the working tree on this run (`git status` showed only unrelated mobile edits to
`DatePickerField`/`TripsListScreen`).

Fixed product decisions (not re-litigated): accepted friends see each other's **per-dish food ratings,
not notes**; **default-on** with an **account-level opt-out**; a **one-time launch notice**.

Steering read first: `.kiro/steering/{tech-conventions,execution-discipline,pin-collection,pin-collection-detail}.md`
and `AGENTS.md`. Structure/tone read from `.kiro/specs/experience-favorites/*` and `.kiro/specs/trip-expenses/*`.
The pin gate (`.kiro/specs/pin-collection/verify`) is **not** relevant to this spec (no catalogue/artwork change).

---

## Headline findings (read these first)

1. **EXISTING EXPOSURE (flag): `GET /me/stats/summary?for=<friendId>` already returns a friend's dish names,
   per-dish average ratings, and restaurant names**, with no opt-out. See section (b). It is deliberate
   (stats-experience-redesign R24.8) but it **contradicts the new opt-out**: an opted-out user would still
   leak `mostLogged`, `highestRated`, and `personalRecords` to every accepted friend. The new spec must
   decide and amend this path. It exposes **no notes**.
2. **No existing spec states that food logs are private.** A repo-wide search found no such requirement
   (see "Cross-spec dependencies"). Privacy today is only *implicit* (every food-log route is `/me/...`
   or owner-scoped). So the new spec amends *implicit* scoping plus one *explicit* friend exposure
   (R24.8), rather than a stated "private" requirement.
3. **Friendship has no status column.** The claim of `accepted/pending/blocked/removed` is wrong. A row in
   `friendships` *is* "accepted"; pending lives in `friend_requests`; there is no block and no soft-remove.
4. **`food_item_logs` has no `experience_id` and no trip column.** Scope comes only via `food_items`
   (`experience_id` XOR `location_id`).
5. **`GET /experiences/:id/food-items` is unauthenticated.** Friend ratings must be a *separate*
   authenticated endpoint, never folded into it.
6. **Next migration is `0062`.** Latest on disk is `0061_trip_booking_timeline.sql`.
7. **There is no "seen once" / announcement mechanism to reuse.** The existing `*Notice` modules are
   transient in-memory error toasts. See section (f).
8. **"My Food History" is registered only in `CollectionStack`**, not in `YouAndCrewStack`/`ExploreStack`.
   A friend-scoped mode needs a new route registration (the component can still be reused).

---

## (a) foodLog service

### Files
- `apps/api/src/services/foodLog/routes.ts` (flat plugins: `foodItemRoutes`, `foodItemLogRoutes`,
  `userSubmittedLocationRoutes`, combined `foodLogRoutes`)
- `apps/api/src/services/foodLog/repo.ts` (`createFoodItemRepo`, `createFoodItemLogRepo({pool, clock})`)
- `apps/api/src/services/foodLog/locations.ts` (user-submitted locations)
- Wiring: `apps/api/src/composeServices.ts:703` (`createFoodItemLogRepo({ pool })`), `:889-904` (`foodLog:`
  block), `apps/api/src/server.ts:573-583` (opt-in registration).
- Tests: `apps/api/src/services/foodLog/__tests__/{foodItemLogs.prop,foodItemLogHistory.prop,foodItems.prop,userSubmittedLocations.prop}.test.ts`, `routes.test.ts`.

### Real schema (migration `apps/api/migrations/0040_food_item_logging.sql`)

`food_item_logs` (0040:74-85):

| column | type | notes |
| --- | --- | --- |
| `id` | `UUID PK DEFAULT gen_random_uuid()` | |
| `user_id` | `UUID NOT NULL → users(id) ON DELETE CASCADE` | |
| `food_item_id` | `UUID NOT NULL → food_items(id) ON DELETE CASCADE` | |
| `visited_on` | `DATE NOT NULL` | the logged date |
| `user_tz` | `TEXT NOT NULL` | IANA tz, used by future-date guard |
| `logged_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `rating` | `SMALLINT` | `CHECK (rating IS NULL OR rating BETWEEN 1 AND 10)` (0040:83) |
| `note` | `TEXT` | `CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000)` (0040:84) |

`food_items` (0040:44-60): `id`, `experience_id` (nullable, FK `experiences`), `location_id` (nullable, FK
`user_submitted_locations`), `name` (1-200), `price TEXT` (verbatim), `source` (`menu_sync`|`user_submitted`),
`created_by_user_id`, `last_seen_at`, `created_at`; CHECK `food_items_exactly_one_scope_chk` (0040:56-59);
unique `(experience_id, lower(name))` and `(location_id, lower(name))` (0040:62-66).
Later additions touching food items: `food_item_festival_tags` (0055:99-111), `food_lists_items.food_item_id` (0041:31).

**Verdict on the unverified column claim: CORRECTED.**
- There is **no `experience_id` column on `food_item_logs`** and **no trip column**. A log's restaurant/location
  is derived by joining `food_items` (`fi.experience_id` / `fi.location_id`), then `experiences`/`user_submitted_locations`
  (see `repo.ts:574-595` join pattern).
- The "logged date" is `visited_on` (user-chosen calendar date, may not be in the future in `user_tz`,
  enforced in `repo.ts:417-430` and `routes.ts` `validateNotFutureVisitDate`) plus `logged_at`.
- Multiple logs per `(user, food_item)` are allowed (0040 has no unique constraint; Requirement 3.2 of food-item-logging).
  A friend rating projection therefore needs an explicit aggregation rule (latest rating vs average vs all). The stats path uses
  `AVG(rating)` over logs with a non-null rating; the food-list checklist uses "most recent log wins"
  (`DISTINCT ON (food_item_id) ... ORDER BY visited_on DESC, logged_at DESC`, `foodLists/repo.ts:544-549`).

DTO leakage hazard: `FoodItemLogDTO` (`packages/shared/src/dto/FoodItemLog.ts:7-16`) carries `userId` and `note`;
`FoodItemLogWithContextDTO` (`:36-41`) adds `foodItemName`, `currentlyOnMenu`, `restaurantName`, `locationName`.
**Do not reuse these for friend reads** - they include `note`. Define new friend-scoped DTOs without `note`.

### Existing endpoints and auth gates (`foodLog/routes.ts`)

| Route | Line | Gate |
| --- | --- | --- |
| `GET /experiences/:id/food-items` | 95 | **none (public)** |
| `POST /experiences/:id/food-items` | 111-113 | `requireSession` |
| `GET /locations/:id/food-items` | 136 | **none (public)** |
| `POST /locations/:id/food-items` | 147-149 | `requireSession` |
| `POST /me/food-items/:foodItemId/logs` | 186-188 | `requireSession` |
| `GET /me/food-items/:foodItemId/logs` | 217-219 | `requireSession`, own logs only (`WHERE user_id=$1 AND food_item_id=$2`, `repo.ts:480-507`) |
| `DELETE /me/food-items/:foodItemId/logs/:logId` | 232-234 | `requireSession`, ownership in SQL (`repo.ts:509-524`) → `food_log_not_found` (404) for non-owner (non-probing) |
| `PATCH /me/food-items/:foodItemId/logs/:logId` | 249-251 | `requireSession`, ownership in SQL |
| `GET /me/food-item-logs` | 274-276 | `requireSession`, **unpaginated**, `repo.ts:574` (`WHERE fil.user_id = $1`) |
| `GET /experiences/:id/food-item-logs/mine` | 284-286 | `requireSession`, own logs (`repo.ts:597`) |
| `GET /locations/:id/food-item-logs/mine` | 298-300 | `requireSession`, own logs |
| `POST /locations`, `GET /locations/suggest` | 324 / 346 | session / **public** |

Claim `GET /me/food-item-logs` and `GET /experiences/:id/food-item-logs/mine`: **VERIFIED**.
All reads of `food_item_logs` today are keyed to the authenticated user's own id. Nothing in `foodLog/` reads
another user's logs. Error codes already present (`packages/shared/src/errors.ts:161-165`, status map `:377-381`):
`food_item_not_found` 404, `food_item_duplicate` 409, `food_log_not_found` 404, `food_log_future_date` 400, `location_duplicate` 409.

Other readers of `food_item_logs` (full list, non-test): `foodLog/repo.ts`, `foodLists/repo.ts:544-549` (viewer's **own**
logs only: `WHERE user_id = $2` where `$2 = viewerId`, so shared-list viewers never see the owner's ratings),
`stats/repo.ts` (section b), `catalog/festivalTags/qualifyingVisitQuery.ts` (own user), `admin/repo.ts:978` (aggregate count only).

---

## (b) Stats - `apps/api/src/services/stats/repo.ts`

### Queries (all inside one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` snapshot, `repo.ts:400`)

| Field | Query | Min threshold | Exposes |
| --- | --- | --- | --- |
| volume (`totalDishesLogged`, `distinctRestaurantsVisited`, `uniqueLoggedFoodItems`) | `repo.ts:603-612` | none | counts only |
| `mostLogged` | `repo.ts:614-626`, `LIMIT 5`, `GROUP BY food_item_id, fi.name` | none | `foodItemId`, **`foodItemName`**, `count` |
| `highestRated` | `repo.ts:628-648`, `LIMIT 5` | `rated_log_count >= $2`, `$2 = FOOD_STATS_MIN_RATED_LOGS` | `foodItemId`, **`foodItemName`**, **`averageRating`**, `ratedLogCount` |
| `mostAdventurousDay` | `repo.ts:650-667` | none | `date`, `dishCount`, **`restaurantNames[]`** |
| `dishMarathonRecord` | `repo.ts:669-683` | none | `foodItemId`, **`foodItemName`**, `date`, `count` |

Roll-up is pure: `stats/foodActivity.ts` (`rollUpFoodActivity`). Shared wire types: `packages/shared/src/dto/Stats.ts:134-176`
(`MostLoggedFoodItem`, `HighestRatedFoodItem`, `FoodPersonalRecords`, `FoodActivityStatistics`).
`FOOD_STATS_MIN_RATED_LOGS = 2` is defined in `packages/shared/src/dto/Stats.ts:190` **and duplicated** in
`apps/mobile/src/api/statsTypes.ts:280` (mobile mirrors the stats types rather than importing them).

**Claim: highestRated requires min 2 logs - VERIFIED, with a precision:** it requires **2 *rated* logs of the same
dish by the same user** (`WHERE fil.rating IS NOT NULL ... rated_log_count >= 2`), not 2 logs of any kind.
A dish the user rated once never appears in stats. The new feature is therefore a materially wider disclosure
(single-rating dishes become visible to friends). `mostLogged` has no minimum.

**Claim: foodActivity is in the FRIEND stats payload - VERIFIED.**
- `GET /me/stats/summary?for=<userId>` (`stats/routes.ts:223-247`) calls `authorizeTarget` (`:403`, wraps
  `assertOwnerOrFriend`) and then `loadSnapshot` + `assembleResponse(snapshot, includePercentile)` (`:265`) - the *same*
  assembler as `GET /me/stats` (`:209`). `assembleResponse` includes `foodActivity: rollUpFoodActivity(...)`
  (`stats/routes.ts:294-297`). There is **no friend-specific projection**; the doc comment at `routes.ts:102-104` says the
  response is "structurally identical for self and friend reads (R9.1)".
- The route test pins this on purpose: `stats/__tests__/routes.test.ts:1034-1070`
  ("GET /me/stats/summary delivers foodActivity in friend response body (Requirement 24.8)"), which only asserts
  `totalDishesLogged` and `distinctRestaurantsVisited` today.
- Spec basis: `.kiro/specs/stats-experience-redesign/requirements.md` R24.8 (line 373): "THE Stats_Service SHALL return
  `foodActivity` within both `GET /me/stats` and `GET /me/stats/summary`."

**Does it include dish names, ratings, or NOTES?**
- Dish names: **YES** (`foodItemName` in `mostLogged`, `highestRated`, `dishMarathonRecord`).
- Ratings: **YES, as averages** (`averageRating` in `highestRated`), only for dishes with >=2 rated logs.
- Restaurant/location names: **YES** (`personalRecords.mostAdventurousDay.restaurantNames`).
- Notes: **NO.** No stats query selects `fil.note`.

**EXISTING LEAK FLAGGED (does the friend-stats path contradict "food logs are private"?)**
YES in substance, though by design: any accepted friend can read the target's top-5 most-logged dishes, top-5
highest-rated dishes with average rating, most-adventurous-day restaurant names, and dish-marathon dish name, via the
raw HTTP response. **The mobile app does not render these for friends**: the only friend-side consumer is the Compare tab,
which reads just `totalDishesLogged` and `distinctRestaurantsVisited` (`FriendProfileScreen.tsx:877-980`; confirmed by
grep - the only other mobile `foodActivity` consumer is the own-stats `FoodStatsScreen.tsx`). So the exposure is
**wire-level, not UI-level**. Consequences for this spec:
- With the opt-out ON (user hides ratings), `/me/stats/summary` must **not** still return `highestRated` (names + avg
  ratings) or the other dish-name fields to friends, or the opt-out is cosmetic. Recommend the spec require the friend
  path to strip/blank `mostLogged`, `highestRated`, and `personalRecords` (or gate them on the same setting) while keeping
  the two volume counts used by Compare (decision to confirm - see Open Questions Q1).
- This needs a friend-specific projection step in `summary` (route `:223-247`), because `assembleResponse` is shared with the
  owner path. The doc comment's "structurally identical" statement and expanded-stats R9.1 must be called out as amended
  for the `foodActivity` sub-object. `stats/__tests__/friendParity.prop.test.ts` pins parity only for the coverage dimensions
  (R6.1/6.2, R9.1/9.2 of other specs), so it should not break, but a regression test is still required at the route layer.

---

## (c) Friend authorization, visibility gating, and settings storage

### Friendship model - **CORRECTED**
- Table `friendships` (`apps/api/migrations/0001_init.sql`, ~lines 213-221): `user_lo_id`, `user_hi_id`, `established_at`;
  PK `(user_lo_id, user_hi_id)`; `CHECK (user_lo_id < user_hi_id)` (canonical pair); index `friendships_user_hi_id_idx`.
  **No `status` column.**
- Pending state: separate table `friend_requests` (`0001_init.sql`, ~lines 196-206): `sender_id`, `recipient_id`, unique pair.
  Accept inserts the friendship and deletes the request (`friends/repo.ts:480-489`); decline just deletes the request
  (`:519-522`).
- **There is no `blocked` and no `removed` state.** `removeFriend` hard-deletes the `friendships` row (`friends/repo.ts:543-556`)
  and the route then calls `onFriendshipRemoved` (`friends/routes.ts:273-276`; wired at `composeServices.ts:829-832` to revoke
  food-list and experience-list shares). Re-friending is a fresh row.
- Therefore "accepted friend" == "a `friendships` row exists for the canonical pair". Unfriending immediately revokes
  visibility on the very next read, because every read re-queries (`friend-stats-viewing` R1.7).

### The authorization helper (reuse this)
`apps/api/src/services/friends/ownerOrFriend.ts` - `assertOwnerOrFriend(pool, requesterId, targetId)`: returns immediately
if requester === target, else one `SELECT EXISTS (... FROM friendships WHERE user_lo_id=$1 AND user_hi_id=$2)` against
`canonicalPair(...)` (`friends/canonicalPair.ts`); throws `AppError('profile_forbidden')` (403). No logging/analytics on deny
(friend-stats-viewing R1.4). Used by: `auth/profileRoutes.ts` (`GET /users/:userId/profile`), `stats/routes.ts`
(`authorizeTarget`), `tracking/friendCompletions/routes.ts` (`GET /users/:userId/completions`), `pins/showcaseRoutes.ts`
(`GET /users/:userId/pin-showcase`). These routes take `pool` in their options and call the helper directly (see
`composeServices.ts:946-950` for `friendCompletions: { repo, pool, requireSession }`; `:936` for `stats`).
`trips/repo.ts:1957-1960` re-implements the same single lookup for invitees.

Error code: `profile_forbidden` 403 (`packages/shared/src/errors.ts:70`, status `:331`). Non-existent target also returns
`profile_forbidden` (friend-stats-viewing R1.5), except stats, which maps a non-existent target to `stats_target_not_found`
(`stats/routes.ts:388-427`).

### How existing friend-visible data is gated (the precedents to mirror)
- **Experience ratings are visible to accepted friends by default with NO per-user opt-out**:
  `tracking/friendCompletions/repo.ts:109-155` does `LEFT JOIN ratings r ON r.user_id = c.user_id ...` and returns `r.value AS rating`
  to any accepted friend (friend-stats-viewing R4.3, R4.4). `LIMIT 5000` hard cap, no pagination (`:41`, `:151`).
- **Notes are opt-in per item**: `notes.shareable BOOLEAN NOT NULL DEFAULT FALSE` (`migrations/0003_note_shareable.sql:15-17`);
  `CASE WHEN n.shareable THEN n.body ELSE NULL END AS shared_note` (`friendCompletions/repo.ts:~127`), so a private note is
  indistinguishable from no note (friend-stats-viewing R4.6, R4.7). **This is the direct precedent for "ratings default-visible,
  notes never visible"** - the food variant is stricter (notes have no share flag at all in this feature).
- Mobile copy precedent for visibility: `NoteControl.tsx:278-279, 361-362` ("Friends viewing your profile can read this note." /
  "Private - only you can see this"). No equivalent copy exists for food logs (grep found no "only you"/"private" string near any food UI).

### Where per-user privacy/settings flags are stored today - the pattern to reuse for the opt-out
There is **no general `user_settings`/`user_preferences` table.** Findings:
- `notification_preferences` (`migrations/0011_social_sharing_loop.sql:46-51`, column renamed in `0012`): `user_id UUID PRIMARY KEY
  REFERENCES users(id) ON DELETE CASCADE`, `push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE`, `updated_at`.
  **Absence of a row means the default** (enabled) - R9.7. This is the closest pattern for a default-on, per-account boolean.
- Backend: `apps/api/src/services/push/preferenceRepo.ts` (`getPreference` defaults to `true` when no row, writes nothing on read; `setPreference`
  is a single `INSERT ... ON CONFLICT (user_id) DO UPDATE ... RETURNING`), `push/preferenceRoutes.ts` (`GET`/`PUT /me/notification-preferences`,
  `requireSession`, local `parseBody` mapping Zod error → `validation_failed`, repo failure → `internal_error`). Wired `composeServices.ts:931-935`,
  registered `server.ts:527-531`.
- Shared: `packages/shared/src/dto/NotificationPreference.ts` (`{ pushNotificationsEnabled: boolean }`), `schemas/NotificationPreference.ts`
  (`notificationPreferenceSchema`, `notificationPreferenceInputSchema`, both `.strict()`), barrelled in `src/index.ts:129,301-302,410` and
  `schemas/index.ts:101-104`, `dto/index.ts:50`.
- Mobile control: `apps/mobile/src/screens/PushNotificationPreferenceControl.tsx` (TanStack `useQuery` key `['notificationPreference']`, `useMutation` PUT,
  `setQueryData` on success - **not optimistic**, error message on failure, `Switch` via `themedSwitchProps`), palette
  `PushNotificationPreferenceControl.palette.ts`, test `screens/__tests__/PushNotificationPreferenceControl.test.tsx`.
- `profiles` has only `display_name` + `avatar_preset` (`0001_init.sql`, `0013_avatar_presets.sql:31`). `ProfileDTO` (`packages/shared/src/dto/Profile.ts`) has
  no settings flags. Do not put the opt-out on `profiles`/`ProfileDTO` (it would ride on every friend profile read).
- Other visibility concepts (not account-level, do not reuse): `food_lists.visibility`, `notes.shareable`, pin showcase placements.

**Recommended opt-out storage (to be confirmed in design):** a new per-user table mirroring `notification_preferences`
(`user_id PK → users ON DELETE CASCADE`, `share_food_ratings_with_friends BOOLEAN NOT NULL DEFAULT TRUE`, `updated_at`),
**absence = default ON**, with its own `foodRatingSharing` repo/routes (`GET`/`PUT /me/...`). Do **not** overload
`notification_preferences` (different semantics, its repo is imported as a structural port by `notifications/service.ts:217-222`).

---

## (d) `packages/shared` - what exists, what to add

Existing (barrel `packages/shared/src/index.ts`, `dto/index.ts`, `schemas/index.ts`):
- Food-log DTOs: `dto/FoodItemLog.ts`, `dto/FoodItem.ts` (index `dto/index.ts:133-140`; `src/index.ts:172-180`).
- Food-log schemas: `schemas/FoodItemLog.ts` (`createFoodItemLogInputSchema` etc.; index `schemas/index.ts:159-163`).
- Stats: `dto/Stats.ts` (`FoodActivityStatistics`, `FOOD_STATS_MIN_RATED_LOGS`).
- Profile/friends: `dto/Profile.ts`, `dto/Friendship.ts`, `dto/FriendRequest.ts`, `dto/CompletionEntry.ts` (FriendCompletionsDTO).
- Error catalog: `packages/shared/src/errors.ts` - `ERROR_CODES` tuple (`:25`), derived `ErrorCode` (`:248`), `errorCodeToHttpStatus: { [K in ErrorCode]: number }`
  (`:293`) - the mapped type forces every new code to have a status.
- Settings precedent: `dto/NotificationPreference.ts`, `schemas/NotificationPreference.ts`.

To add (all `.strict()` Zod, matching existing style; confirm exact names in design):
1. **Friend-scoped read DTOs** (no `note`, no `userId` per row beyond what is needed): e.g. a per-dish `FriendDishRatingDTO`
   (`foodItemId`, `foodItemName`, restaurant/location name, `rating`, `visitedOn`) for the friend history screen, and a batch
   "friends' ratings for these dishes" DTO for the menu overlay (`foodItemId` → list of `{ friendId, displayName, avatarPreset, rating }`
   and/or friend count + average). Add matching Zod schemas.
2. **Sharing-setting DTO/schemas**: `{ shareFoodRatingsWithFriends: boolean }` response + input (`.strict()`), same shape as `NotificationPreference`.
3. **One-time-notice state** DTO/schema if server-side (see (f)); e.g. `{ foodRatingsNoticeSeen: boolean }` or a timestamp.
4. **Batch request schema** for the menu overlay (cap on `foodItemIds`; there is no existing cap constant for this - define one in shared with a concrete
   default, e.g. `FRIEND_FOOD_RATINGS_BATCH_MAX`, per the "Configuration & Constants" rule).
5. **Error codes**: possibly none. `profile_forbidden` (403) already covers non-friend. Consider whether "target opted out" should return an empty
   result (recommended - indistinguishable from "no ratings", mirrors the private-note rule) rather than a new code. If a code is added it must go in both
   `ERROR_CODES` and `errorCodeToHttpStatus`.
6. Barrel exports in all three index files (`src/index.ts`, `dto/index.ts`, `schemas/index.ts`).

Caveat: stats types are **mirrored by hand** in `apps/mobile/src/api/statsTypes.ts` (FoodActivityStatistics at `:266`, `FOOD_STATS_MIN_RATED_LOGS` at `:280`,
`StatsResponse` at `:295`) rather than imported. If the friend path changes the `foodActivity` shape, both copies must change. Food-log DTOs, by contrast,
are imported from `@dwt/shared` in mobile (e.g. `MyFoodHistoryScreen.tsx:20`).

---

## (e) Mobile - `apps/mobile/src`

### Screens and where each belongs

| Target | File | Findings |
| --- | --- | --- |
| Friend profile | `screens/friends/FriendProfileScreen.tsx` | Tabbed (`FRIEND_PROFILE_TABS`, `FRIEND_MODES`, `:230`), modes `Overview | Coverage | Experiences | Compare`. Route params `FriendProfileParams { friendId, displayName, initialSection? }` (`:210-214`). Hooks in `hooks/useFriendProfile.ts` with keys `friendProfileKeys` (`['friend-profile', id]`, `['friend-stats', id]`, completions). Pin showcase query uses key `['users', friendId, 'pin-showcase']`, `staleTime` 5 min, `retry:false` (`:292-298`). Natural place for a "Food" entry: a new tab or a card in Overview that navigates to the friend food history screen. |
| Experiences tab | `screens/navigation/ExperiencesList.tsx` | **No food references** (grep: none). Shows completions + friend rating; not a food surface. Not a candidate. |
| Ratings section | `screens/stats/components/RatingsSection.tsx` | **No food references** (grep: none). Experience-rating stats only. Not a candidate. |
| Compare tab | `FriendProfileScreen.tsx:876-980` | **VERIFIED** uses `viewerStats.foodActivity` / `friendStats.foodActivity` for "Total Dishes Logged" and "Distinct Restaurants Visited" (`testID friend-comparison-total-dishes`, `:964-979`). Volumes only. If the opt-out hides volumes, this card needs a defined empty state (Open Question Q1). |
| My Food History | `screens/catalog/MyFoodHistoryScreen.tsx` | **Exact file confirmed.** Registered **only** in `navigation/CollectionStack.tsx:9,28,43` (route `MyFoodHistory: undefined`); entry from `screens/collection/CollectionScreen.tsx:845` ("Open Food History Timeline"). Takes no route params. Fetches `GET /me/food-item-logs` with key `['me-food-item-logs']`; has search, sort chips (`foodHistoryFilters.ts` `deriveDisplayedFoodLogs`), restaurant filter chips, **delete** and **edit-rating** (`RateOnCheckoffPrompt`) actions, and renders `note`. |
| Menu screen | `screens/catalog/MenuScreen.tsx` | Root-stack route `Menu: { experienceId }` (`RootNavigator.tsx:81,209`). Already queries `['experience-food-items', experienceId]` (`:105-113`) and renders per-item rows (`testID menu-item-...`, add-to-list button). Best place for a friends' ratings overlay per dish. |
| Food item picker | `screens/catalog/FoodItemPickerModal.tsx` | Per-row `useQuery(['food-item-logs', item.id])` for the user's own repeat count (`:86-94`); modes `'log' | 'addToLists'`. Secondary overlay candidate; **per-row queries are the existing anti-pattern** (comment `:84-85`) - friend data must come from one batched query, not per row. |
| Food list detail | `screens/foodLists/FoodListDetailScreen.tsx` | Root-stack `FoodListDetail: { foodListId }`. Shows the viewer's **own** gotten/rating per item. Optional overlay candidate; out of scope unless the spec says otherwise. |
| Settings | `screens/youAndCrew/YouAndCrewScreen.tsx:~418-445` | Section "Preferences & Security" (`testID you-and-crew-settings-section`) of `<Card style={styles.settingsCard}>` blocks each with a `settingsCardHeader` (icon + `settingsTitle`) then a control: `PushNotificationPreferenceControl`, `AppearancePreferenceControl`, `ChangePasswordControl`. **The opt-out toggle belongs here as a new card/control**, modelled on `PushNotificationPreferenceControl`. Test: `screens/youAndCrew/__tests__/YouAndCrewScreen.test.tsx`. |

### Navigation stacks
- `navigation/YouAndCrewStack.tsx` hosts `YouAndCrewMain`, `FriendsList`, `FriendProfile`, `FriendsSearch`, `Inbox`, `Sent`, `PinShowcase`
  (`YouAndCrewStackParamList`, `:19-27`). A friend food history screen registers here (e.g. `FriendFoodHistory: { friendId, displayName }`) beside
  `FriendProfile`. `PinShowcase: { userId?: string; readOnly?: boolean }` is the precedent for a "viewing someone else" route param.
- `navigation/ExploreStack.tsx` hosts only `CatalogList`, `DestinationScreen`, `ResortsDirectory`, `CrowdCalendar`, `LiveWaits`. It does **not** host
  Menu/ExperienceDetail (those are root-stack). Nothing food-related needs to register in `ExploreStack`.
- `navigation/CollectionStack.tsx` hosts `MyFoodHistory` and `MyFoodLists`.
- `navigation/RootNavigator.tsx` hosts `ExperienceDetail`, `Menu`, `FoodListDetail`, `FoodListDiscovery` above the tabs.

### Reuse assessment: friend-scoped "My Food History"
`MyFoodHistoryScreen` is reusable in part, but not as a one-line route param: it hard-wires `GET /me/food-item-logs`, a delete action, an edit-rating action,
note rendering, and `navigation.goBack()` header. A friend mode would need: (1) a `friendId` route param selecting the data source (`['friend-food-ratings', friendId]`),
(2) hiding delete/add-rating/edit-rating and note, (3) a different row DTO (no `note`, no `logId`-based mutations), (4) different empty/opted-out copy. Recommended: **extract the
shared list shell** (search/sort/filter via the pure `foodHistoryFilters.ts`, which is already pure and prop-tested in `__tests__/foodHistoryFilters.prop.test.ts`) and add a thin
`FriendFoodHistoryScreen`, rather than branching the existing 480-line component on a param. Either way it must be registered in `YouAndCrewStack` because `CollectionStack` is a
different navigator.

### Theming rules that bind the new UI (tech-conventions "Mobile conventions")
- Styles: `const useStyles = makeStyles((t) => ({...}))` from `theme/makeStyles.ts`; inline values via `const t = useAppTheme()` (`theme/useAppTheme.ts`).
- No raw colour literals and no static colour tokens: guard `src/__tests__/themeRetrofit.guard.test.ts` (rules in `src/test/themeGuard.ts`) fails the mobile suite on hex /
  chromatic `rgb()` / static theme import outside its allowlists (`ARTWORK_AND_TOKEN_FILES`, `THEME_INTERNALS`, `*.palette.ts`). A one-off literal goes in `<File>.palette.ts`
  via `definePalette({ light, dark })` + `usePalette(P)` (example: `PushNotificationPreferenceControl.palette.ts`, `NOTIFICATION_SWITCH`). Use `primary` for fills, `primaryFg` for
  primary-hued text/icons. Memoized values / `FlatList` render callbacks that read `styles`/`t` must list them in deps and pass `extraData={t.scheme}` (see `MyFoodHistoryScreen.tsx:176-180, 349`).
- Accessibility: every control has `accessibilityRole`/`accessibilityLabel`; never colour alone (e.g. rating shown as text "8/10", not only a star colour).
- Switch pattern: `Switch key={t.scheme} {...themedSwitchProps(t, value, { trackColor })}` (`PushNotificationPreferenceControl.tsx`).

### TanStack Query patterns in use
- `apiRequest<T>(method, path, body?)` from `api/client`; `ApiError` for typed codes.
- Key conventions seen: `['me-food-item-logs']`, `['food-item-logs', foodItemId]`, `['experience-food-items', experienceId]`, `['scoped-food-item-logs']`,
  `['notificationPreference']`, `['friend-profile', id]`, `['friend-stats', id]`, `['users', friendId, 'pin-showcase']`.
- Reads use `staleTime` (30 s - 5 min) and `retry: false` or `retryUnlessForbidden` (`hooks/useFriendProfile.ts`: `profile_forbidden` is terminal, no retry).
- Preference toggles use a non-optimistic `useMutation` that writes the server echo with `setQueryData` and surfaces a save-error message.
- Mutations invalidate related keys after success (`MyFoodHistoryScreen.tsx:108-122`).
- New keys to add: friend food history list, friend-ratings-for-menu batch (keyed by `experienceId` + friend set), sharing setting, notice state. After a rating write or
  an opt-out change, invalidate the friend-ratings keys.

---

## (f) Notifications / one-time-notice patterns

**Claim of an existing "seen once"/announcement mechanism: NOT FOUND.**
- `foodListNotice.ts`, `experienceListNotice.ts`, `navigation/tripsListNotice.ts` are **module-level in-memory singletons** (`let notice: string | null`, `useSyncExternalStore`)
  that queue a *transient error message* for the next screen render. Not persisted, not "seen once".
- `notification-center` spec (`.kiro/specs/notification-center/requirements.md`) is an *attention feed of pending items needing a response* (friend requests, trip invites,
  rode-with tags, shares) with a badge count (R1, R4). A launch notice is not an actionable pending item; forcing it in would pollute the badge. Not a fit.
- Push (`apps/api/src/services/notifications/service.ts`, `push_delivery_log_kind_chk` in `0056_admin_panel.sql:32-35` and re-declared in `0061_trip_booking_timeline.sql:75-78`) is
  event-driven and gated by `push_notifications_enabled`; a one-time launch push to all users would need a bulk sender and a new `notification_kind` (CHECK must be replaced again as 0061 did).
  Recommended against: Render free tier has no worker, and a push would be dropped for users with notifications off.
- Persistence building blocks that do exist:
  - Device-local: `@react-native-async-storage/async-storage` (`apps/mobile/package.json`), pattern in `theme/appearanceStorage.ts` (key `dwt.appearance.preference`,
    `getItem`/`setItem`, falls back to default on error). `expo-secure-store` for token/device id (`api/deviceId.ts`, `api/sessionStorage.ts`).
  - Server-side per-account: a row/column like the notification-preference pattern in (c).

**Recommendation for the spec:** persist "notice seen" **server-side on the same per-user settings row** as the opt-out (e.g. nullable `food_ratings_notice_seen_at TIMESTAMPTZ`),
so the notice shows once per *account* across devices/reinstalls and uses the same `GET`/`PUT` plumbing. Device-local AsyncStorage is simpler and offline-friendly but re-shows the
notice on a new device and is not testable at the repo layer. Decision flagged in Open Questions Q3. The notice should link directly to the opt-out control (YouAndCrew settings card).

---

## (g) Existing test patterns to cite in Testing Strategy

API (Vitest, `npx vitest run <path>`):
- **pg-mem repo + property**: `apps/api/src/services/foodLog/__tests__/foodItemLogs.prop.test.ts` (builds `newDb()`, registers `citext`/`pg_trgm`/`pgcrypto` +
  `gen_random_uuid`/`char_length`/`lower`, loads real migration SQL by path, fast-check). Also `foodItemLogHistory.prop.test.ts`.
- **pg-mem with friendships end-to-end**: `apps/api/src/services/friends/__tests__/unfriendFoodListRevocation.integration.test.ts` (real `removeFriend` + Fastify route + DB state) -
  the template for "unfriend immediately hides ratings".
- **server.inject route test with fake repo**: `apps/api/src/services/foodLog/__tests__/routes.test.ts` (fake repos with call-recording arrays, `registerErrorHandler`,
  stub session), `apps/api/src/services/push/__tests__/preference.test.ts` (fake pool + fake repo; the template for the settings routes), `apps/api/src/services/tracking/friendCompletions/__tests__/routes.test.ts`
  and `completions.integration.test.ts` (friend gate).
- **Owner-or-friend gate property/no-analytics**: `friends/__tests__/ownerOrFriend.prop.test.ts`, `ownerOrFriend.noanalytics.test.ts`.
- **Private-field projection property (closest analogue to "notes never leak")**: `tracking/friendCompletions/__tests__/shareableNoteDisclosure.prop.test.ts`.
- **Stats friend-path tests**: `stats/__tests__/routes.test.ts:923-1071` (foodActivity in friend response), `routes.authorization.test.ts`, `friendParity.prop.test.ts`,
  `foodActivity.prop.test.ts`, `foodActivity.repo.unit.test.ts` - all need updating/extending if the friend `foodActivity` projection changes.
- **Migration test**: `apps/api/src/db/__tests__/migration0054.test.ts` (favorites; table, composite PK, FK cascade, indexes), `migration0060.test.ts`, `migration0061.test.ts`
  -> new `migration0062.test.ts`.
- Coverage gate: only `src/services/planning/**` is threshold-enforced (execution-discipline); not applicable here.

Mobile (Jest + `jest-expo` + `@testing-library/react-native`; mock only `apiRequest`, run via `npm run test` in `apps/mobile`; typecheck `npm run typecheck`):
- Preference control: `apps/mobile/src/screens/__tests__/PushNotificationPreferenceControl.test.tsx` (mocks `../../api/client` keeping real `ApiError`; asserts GET value, PUT payload,
  failure message, dark-scheme style via `resetTestScheme`/`setTestScheme`).
- Food history screen: `apps/mobile/src/screens/catalog/__tests__/MyFoodHistoryScreen.test.tsx`; pure filters: `__tests__/foodHistoryFilters.prop.test.ts`.
- Menu: `screens/catalog/__tests__/MenuScreen.foodListAffordances.test.tsx` (+ `MenuScreen.backControlAndTheme.test.tsx`, `FoodItemPickerModal.test.tsx`).
- Friend profile: `screens/friends/__tests__/FriendProfileScreen.{comparison.prop,comparison.states,modes,refetch,states}.test.tsx`.
- Settings screen: `screens/youAndCrew/__tests__/YouAndCrewScreen.test.tsx`.
- Theme guard (must stay green): `src/__tests__/themeRetrofit.guard.test.ts`, `src/test/__tests__/themeGuard.prop.test.ts`.

Rules from `execution-discipline.md` to carry into the spec's tasks: every new behavior needs a test that would fail without it; a bug-fix-style change (closing the stats wire
exposure) needs a regression test **at the layer where it lived** (route-level `server.inject` against the real `assembleResponse`/projection, not a mock); mobile tests must assert both
the network call (endpoint + payload) and the on-screen change for each interaction (toggle, notice dismiss, navigation to friend history); final `npm run verify` once with literal tail output.

---

## (h) Performance / hosting (Neon ~1 GB, Render free, Upstash)

### Existing indexes on `food_item_logs` (all of them)
- PK `id`.
- `food_item_logs_user_item_idx ON (user_id, food_item_id, visited_on DESC, logged_at DESC)` - `0040:87-88`.
- `food_item_logs_user_idx ON (user_id, visited_on DESC, logged_at DESC)` - `0043:15-16`.
- **No index leading on `food_item_id`.** (Only these two exist; `grep food_item_logs` over all migrations returns 0040 and 0043 only.)
- `food_items`: unique `(experience_id, lower(name))` and `(location_id, lower(name))`, plus `food_items_experience_idx`, `food_items_location_idx` (0040:62-69).
- `friendships`: PK `(user_lo_id, user_hi_id)` + `friendships_user_hi_id_idx` (0001) - both sides of a friend lookup are indexed.

### Index needs for the new queries
- **Friend food history** (`WHERE fil.user_id = $friend ORDER BY visited_on DESC, logged_at DESC`): served by `food_item_logs_user_idx` (0043). **No new index.**
- **Batch menu overlay** ("which of my friends rated these N dishes of this restaurant"): drive from the viewer's friend set, then probe
  `food_item_logs (user_id = ANY(friendIds) AND food_item_id = ANY($itemIds))` - the leading `(user_id, food_item_id, ...)` of `food_item_logs_user_item_idx` is exactly the access path
  (index probes ~ friends x items; e.g. 30 friends x 100 dishes = 3k probes, fine). **No new index is required for the friend-first plan.** A
  `food_item_logs (food_item_id, user_id)` index would only be needed if the query is written item-first (scan all users' logs for the dishes, then filter to friends) - recommend **not**
  writing it that way. State this reasoning in the design and gate any new index on an `EXPLAIN` against a realistic seed rather than adding speculatively (Neon budget, additive-only migrations).
- **Opt-out lookup**: new settings table PK `(user_id)` is the access path; join as `LEFT JOIN settings s ON s.user_id = fil.user_id WHERE COALESCE(s.share_food_ratings, TRUE)`.
  Row count <= users, negligible storage.
- pg-mem cannot prove query plans, so the migration test asserts the index/PK exists and behavior, not performance. `stats/__tests__/repo.performance.test.ts` is the nearest precedent.
- No background worker, no cron, no Redis polling is needed: all reads are request-time SQL. Do not add a BullMQ worker (tech-conventions hosting constraints). The launch notice must not use a bulk push job.

### Pagination convention
There is **no single convention**:
- Keyset `cursor` (opaque string) + `LIMIT $1` for public discovery lists: `foodLists/routes.ts:70-74`, `foodLists/repo.ts:700-785` (`ORDER BY like_count DESC, id ASC` / `created_at DESC, id ASC`),
  same in `experienceLists/`.
- Hard cap, no pagination: friend completions `LIMIT 5000` (`friendCompletions/repo.ts:41,151`); `GET /me/friends`, `GET /me/food-item-logs`, `getLogsForUserAtScope` are unbounded.
- `limit` query param, `z.coerce.number().int().min(1).max(50)`: `/locations/suggest` (`foodLog/routes.ts:77`).
Recommendation: friend food history = hard cap with a named constant (mirroring `MAX_ENTRIES`, concrete default to be set in Configuration & Constants, e.g. 500-1000 most recent) or keyset
cursor on `(visited_on DESC, logged_at DESC, id)` if the spec wants infinite scroll; the batch menu endpoint = request-size cap on `foodItemIds`. Bounded either way (Neon/Render memory).

### Next migration number
`apps/api/migrations/` ends at `0061_trip_booking_timeline.sql` (listing verified; no gaps at the tail). **Next is `0062`** (e.g. `0062_friend_food_ratings.sql`, `BEGIN/COMMIT`,
`gen_random_uuid()`/`TIMESTAMPTZ`/`CHECK`/`ON DELETE CASCADE`, `IF NOT EXISTS` for idempotent reapply, matching 0054/0060). Test: `apps/api/src/db/__tests__/migration0062.test.ts`.
Note `apps/api/dist/` contains stale compiled output; do not treat it as source.

---

## Cross-spec dependencies & affected existing requirements

### Is there an existing spec that states food logs are private? **NOT FOUND (no explicit statement).**
Searched every spec under `.kiro/specs/` (regex for food/dish near private/privacy/never shared/not visible, both directions), plus `docs/`, `README.md`, steering, and mobile UI copy. **Zero hits.**
The only explicit "private" language in food-adjacent specs is about **Food Lists visibility** (`food-lists` R3, e.g. R3.3 line 68 of its requirements: private lists are viewable only by owner + share grantees) and
**Notes** (`friend-stats-viewing` glossary "Note" + R4.6/R4.7), neither of which is the food-log stream.

What *implicitly* scopes food logs to the owner (the new spec intentionally widens this; call each out as a **deliberate, scoped amendment**, do not edit or renumber them):

| Spec | Requirement(s) | What it implies |
| --- | --- | --- |
| `food-item-logging` | **R3.5** | Food_Item_Log is a separate stream; does not touch completions/ratings/experience_logs. (Leave intact: friend food ratings are a *read* projection and must not write there.) |
| `food-item-logging` | **R4.1, R4.3, R4.4, R4.5, R4.6** | History/delete/update are scoped to the authenticated User; cross-user access collapses to `food_log_not_found` "so ownership cannot be probed." The new friend read must be a **separate route** and must not relax these. |
| `food-item-logging` | **R8.1, R8.3** ("My Food History"), **R9.1, R9.2** ("mine") | All log reads are "my/mine" by definition (`/me/food-item-logs`, `.../mine`). New friend history is additive and must not change these routes. |
| `food-item-logging` | **R1.5/R1.6, R2.3, R6.7** | Food-item *catalog* is public/shared across users (not private). The new feature relies on `GET /experiences/:id/food-items` staying public and unchanged. |
| `food-lists` | **R13 (checklist `gotten`/`rating`/`logId`; R13.7, R13.19, R13.23)** | Checklist rating on a shared list reflects the **viewer's own** logs (`foodLists/repo.ts:544-549`). Must remain viewer-only; do not make it show friends' ratings without an explicit requirement. |
| `stats-experience-redesign` ("Amendment: Food Stats") | **R24.8** (line 373) | **Explicitly** returns `foodActivity` on both `GET /me/stats` and `GET /me/stats/summary` (friend-or-self) - the existing friend exposure of volumes + dish names + avg ratings. The new spec must state how it amends/narrows this (Q1). |
| `stats-experience-redesign` | **R25.1-25.4** (Most Logged), **R26.1-26.5** (Highest Rated, min-rated-logs gate), **R27.1-27.5** (Personal Records) | Define the dish-name/rating/restaurant-name fields that currently reach friends via R24.8. Not edited; the new spec constrains only the *friend* projection. |
| `stats-experience-redesign` | **R28.8** (line 423) | Friend Compare pane shows Total Dishes Logged / Distinct Restaurants Visited from `friend.foodActivity`. Affected if volumes are hidden when opted out (Q1). |
| `stats-experience-redesign` | **R11 / R22** (friend parity & volume comparison) | Established the "Friend_Surface structurally identical to Own_Surface" convention that the shared `assembleResponse` follows. |
| `expanded-stats` | **R9.1** (cited by `stats/routes.ts` comments and `friendParity.prop.test.ts`) | "Friend response is structurally identical" - a friend-specific `foodActivity` projection is a documented exception. |
| `friend-stats-viewing` | **R1.1-R1.7** (Owner_Or_Friend_Rule, `profile_forbidden`, no analytics on deny, termination takes effect immediately), **R4.3, R4.4, R4.6, R4.7** | The authorization contract and the rating-default-visible / note-opt-in precedent the new spec mirrors. New routes must satisfy R1.1-R1.7 equivalents. |
| `food-lists` / `experience-lists` | friend-removal revocation (`onFriendshipRemoved`, `composeServices.ts:829-832`) | Unfriend revokes list shares today. Food-rating visibility needs **no** revocation hook because it is computed per-read from `friendships`. |
| `notification-center` | R1/R4 (attention feed and badge) | Do **not** route the launch notice through it (not an actionable pending item). |
| `friend-profile-navigation` | friend profile view modes | New "Food" entry in `FriendProfileScreen` must respect the existing per-read loading/error/forbidden model (`profile_forbidden` collapses the whole screen; stats-experience-redesign R14.6 / friend-stats-viewing R7). |

Build-order dependencies for the new spec: requires `food-item-logging` (tables, DTOs), `friend-stats-viewing` (Owner_Or_Friend_Rule, friends model), `stats-experience-redesign` Food Stats amendment
(R24-R28, to narrow the friend `foodActivity` projection), `restaurant-menu-display` (`MenuScreen` host for the overlay), `dark-mode` (theming rules). Optional: `food-lists` (FoodListDetailScreen overlay).

---

## Open Questions / Assumptions

Product decisions are fixed; these are the *design-level* questions the spec must answer, each with a recommended default.

- **Q1 - Friend `foodActivity` on `/me/stats/summary` (existing exposure).** Recommended: for the *friend* read, always omit `mostLogged`, `highestRated`, `personalRecords` (the new feature supersedes them with the
  per-dish, opt-out-aware view), and apply the opt-out to the two volume counts (return zero/omitted `foodActivity` for an opted-out friend, with the Compare card showing a neutral "Not shared" state).
  Alternative: keep volumes visible regardless of opt-out (counts are not ratings). Needs the user's call because it changes what the Compare tab shows and amends stats-experience-redesign R24.8/R28.8.
- **Q2 - Which rating does a friend see per dish?** Multiple logs per dish are allowed. Candidates: latest rated log (matches food-list checklist "most recent wins"), average of rated logs (matches stats), or both
  (latest + count). Recommended: show latest rating + rated-visit count in lists; average in the batch menu overlay. Must be defined as a concrete pure function (property-testable, "continuous internal value, display-only rounding" per modeling conventions).
- **Q3 - One-time notice persistence and trigger.** Recommended: server-side nullable timestamp on the sharing-settings row; show on first app open after release for existing users **and** to new users on first
  entering the app; dismissal writes the timestamp. Alternative: AsyncStorage (`dwt.*` key). Also decide whether the notice is a modal or an inline banner on Home/You & Crew.
- **Q4 - Opt-out semantics.** Assumed: retroactive and immediate (applies to existing logs on the next read; no copy of data is made); the opted-out user still sees their own ratings; an opted-out friend is
  **indistinguishable from a friend with no ratings** in friend history and menu overlays (mirrors the private-note rule, avoids a new error code). Confirm. Also: should the setting be asymmetric (hide mine but still see friends')? Assumed **yes, independent** - flag if reciprocity is wanted.
- **Q5 - Ratings only, never notes.** Assumed enforced structurally: friend DTOs have **no `note` field** and the SQL never selects `note`; add a property test (analogue of `shareableNoteDisclosure.prop.test.ts`) asserting the serialized response contains no note text for any generated log. Also exclude `userId` of logs that are not the requested friend's.
- **Q6 - Unrated logs.** `rating` is nullable. Assumed: friend views only include logs with a non-null rating (a bare "I ate this" log is not a "rating"). Confirm, since the user's wording is "per-dish food ratings".
- **Q7 - Scope of dishes.** `food_items` may be `experience`- or `location`-scoped (user-submitted spots). Assumed friend history includes both, with restaurant/location name joined as `getAllLogsForUser` does.
  `currentlyOnMenu` flag (a menu-join computation) can be reused or dropped for the friend view.
- **Q8 - Placement of the friend food history entry point.** Recommended: a card/row on `FriendProfileScreen` Overview that navigates to a new `FriendFoodHistory` route registered in `YouAndCrewStack` (route params `{ friendId, displayName }`). A new tab is the alternative.
- **Q9 - Menu overlay shape.** Recommended: one `POST`/`GET` batch call per menu screen (`experienceId` + capped `foodItemIds`, or `experienceId` alone and resolve all items server-side) returning, per dish, friends' avatars/names + ratings (cap displayed friends,
  e.g. 3 plus "+N"); never per-row queries (existing anti-pattern). `GET /experiences/:id/food-items` must **not** be extended (it is public).
- **Q10 - Naming/location of the new service.** Recommended: a new `apps/api/src/services/friendFoodRatings/` (pure projection module, `repo.ts`, `routes.ts`) and a separate small settings repo/routes, wired in `composeServices.ts` by constructor injection with `pool` for
  `assertOwnerOrFriend` (as `friendCompletions` does), rather than growing `foodLog/`. Settings could alternatively live in a new `userSettings/` service reusable by later flags.
- **Assumption:** the batch/list endpoints accept only a target `friendId` (or the viewer's own friend set) and always pass through `assertOwnerOrFriend`; self-requests (`requester === target`) are allowed by the helper and return the owner's own view.
- **Not verified in this pass:** actual query plans on Neon (no DB access, read-only run); runtime behavior (no test suite was run - nothing was changed); whether `FoodStatsScreen`/Hall-of-fame share flows (`computeProgressShareStats`, `composeServices.ts:849`) include `foodActivity` in progress-share payloads
  (grep of mobile `foodActivity` consumers found none, but the API-side share composer was not opened) - the spec author should confirm before asserting that no other path leaks dish data.

## Verdict table for each unverified claim

| # | Claim | Verdict | Evidence |
| --- | --- | --- | --- |
| a1 | `food_item_logs` has `rating`, `note`, `user_id`, `food_item_id` | VERIFIED | `0040_food_item_logging.sql:74-85` |
| a2 | ...and `experience_id` and a logged date/**trip** | **CORRECTED** | no `experience_id`/trip column; scope via `food_items`; date = `visited_on` + `user_tz` + `logged_at` |
| a3 | `GET /me/food-item-logs`, `GET /experiences/:id/food-item-logs/mine` exist, authenticated | VERIFIED | `foodLog/routes.ts:274-276, 284-286` |
| b1 | `highestRated` requires min 2 logs | VERIFIED (precision: 2 *rated* logs) | `stats/repo.ts:628-648`, `Stats.ts:190` |
| b2 | `foodActivity` is in the friend stats payload | VERIFIED | `stats/routes.ts:223-247, 265-297`; `routes.test.ts:1034-1070`; R24.8 |
| b3 | It includes dish names/ratings/notes | PARTIAL: names YES, avg ratings YES, **notes NO** | `repo.ts:614-683`, `foodActivity.ts` |
| b4 | Friend path leaks nothing contradicting "private" | **CORRECTED - existing wire-level exposure** | see (b); not rendered in UI |
| c1 | Friendships have statuses accepted/pending/blocked/removed | **CORRECTED** | no status column; `friendships` row = accepted; `friend_requests` = pending; no block/removed; hard delete |
| c2 | A helper checks accepted friend | VERIFIED | `friends/ownerOrFriend.ts` `assertOwnerOrFriend` |
| c3 | Notes gated by `is_shareable` | CORRECTED name | column is `notes.shareable` (`0003_note_shareable.sql`) |
| c4 | Ratings gated for friends | CORRECTED | experience ratings are visible to all accepted friends by default, no flag (`friendCompletions/repo.ts`) |
| c5 | Existing per-user settings pattern | VERIFIED (narrow) | only `notification_preferences` (no general settings table) |
| d | DTO/schema/error homes in `@dwt/shared` | VERIFIED | see (d); stats types also mirrored in mobile |
| e1 | Compare tab uses foodActivity volumes | VERIFIED | `FriendProfileScreen.tsx:876-980` |
| e2 | `ExperiencesList.tsx`, `RatingsSection.tsx` relevant to food | CORRECTED | no food references in either |
| e3 | "My Food History" file | VERIFIED: `screens/catalog/MyFoodHistoryScreen.tsx`, registered in `CollectionStack` only | `CollectionStack.tsx:9,43` |
| e4 | Friend food screen registers in YouAndCrewStack/ExploreStack | PARTIAL: YouAndCrewStack yes; ExploreStack hosts none of Menu/ExperienceDetail (root stack) | stack files |
| f | Existing "seen once" mechanism | **NOT FOUND** | `*Notice.ts` are transient in-memory; AsyncStorage pattern exists in `appearanceStorage.ts` |
| g | Test patterns exist | VERIFIED | paths in (g) |
| h1 | Index on `food_item_logs(user_id, food_item_id)` | VERIFIED | `0040:87-88`, also `0043:15-16` |
| h2 | Pagination convention | NO SINGLE CONVENTION | keyset cursor (discovery), hard cap 5000 (friend completions), unbounded (history) |
| h3 | Next migration | `0062` | latest `0061_trip_booking_timeline.sql` |
