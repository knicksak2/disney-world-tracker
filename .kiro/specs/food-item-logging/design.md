# Design Document

## Architecture Overview

Food Item Logging adds two new tables and hooks one new write into the existing lazy Menu_Retrieval seam:

1. **`food_items`** — a per-Restaurant_Experience dish catalog. Seeded automatically the moment `Menu_Retrieval.getMenuForRestaurant` performs a real fetch (cache miss or stale), by extracting `groups[].items[].name`/`price` from the returned `MenuDTO[]`. This is the *only* proactive population path — no scheduled job touches `food_items`, matching the hosting constraint that rules out an always-on worker and matching Menu_Retrieval's own "demand-driven" design. A narrow escape hatch (`source = 'user_submitted'`) lets a User add a dish the synced menu doesn't yet carry (e.g. a seasonal festival item).
2. **`food_item_logs`** — a per-User log of dishes eaten, shaped identically to `experience_logs` (`visited_on`, `user_tz`, `logged_at`, optional 1–10 `rating`, optional `note`) but scoped to `food_item_id` instead of `experience_id`. Unlike `experience_logs`, it does **not** dual-write into `completions`/`ratings` — a dish log is orthogonal to "have I completed this restaurant," so no existing catalog-coverage or aggregate-rating stat is touched by this feature.

```
                    GET /experiences/:id/food-items
                                    │
                                    ▼
                     ┌───────────────────────────────┐
                     │   Menu_Retrieval (existing)   │
                     │  getMenuForRestaurant(id)      │
                     └───────────────┬───────────────┘
                     cache fresh?    │    cache miss/stale
                     serve cached    │    fetch Menu_Service → projectMenus
                     menus, skip     │           │
                     food_items      │           ▼
                     upsert          │   repo.upsertMenus(id, menus, now)
                                     │   repo.upsertFoodItemsFromMenus(id, menus)  ◄── NEW
                                     │           │
                                     ▼           ▼
                     ┌───────────────────────────────┐
                     │   food_items (per-restaurant   │
                     │   dish catalog, source=        │
                     │   'menu_sync' | 'user_submitted')│
                     └───────────────┬───────────────┘
                                     │
                                     ▼
                    POST /me/food-items/:foodItemId/logs
                                     │
                                     ▼
                     ┌───────────────────────────────┐
                     │  food_item_logs (per-user log, │
                     │  no completions/ratings write) │
                     └───────────────────────────────┘
```

The seeding hook is placed inside `createMenuRetrieval`'s success branch (only on a real fetch, never on a cache-hit serve and never on a fetch failure — Requirement 1.4), so the `food_items` catalog only ever reflects data Disney has actually served, never a partial or stale extraction.

## Components and Interfaces

### Backend Structure (`apps/api/src/services/foodLog/`)

A new top-level service, sibling to `tracking/`, `sharing/`, `pins/` — not nested under `tracking/` because it introduces two new entities (a catalog + a log) rather than extending the existing Experience-log stream, and `food-lists` will need to sit beside it and depend on its `food_items` table.

- `repo.ts`:
  - `FoodItemRepo` — `upsertFoodItemsFromMenus(experienceId, menus, now)`, `listFoodItems(experienceId)` (computes `currentlyOnMenu` per item, see below), `submitFoodItem(experienceId, userId, name)`, `listLocationFoodItems(locationId)`, `submitLocationFoodItem(locationId, userId, name)`, `findFoodItem(foodItemId)`.
  - `FoodItemLogRepo` — `addLog(input: CreateFoodItemLogInput)`, `getLogHistory(userId, foodItemId)`, `deleteLog(userId, foodItemId, logId)`, and (Requirement 8, 9 — added by this amendment) `getAllLogsForUser(userId)`, `getLogsForUserAtScope(userId, scope: { experienceId?: string; locationId?: string })` — see "My Food History and Restaurant-Scoped Logged Items" below.
  - `UserSubmittedLocationRepo` — `createLocation(userId, name, park)` (case-insensitive exact-match collision → `AppError('location_duplicate', ..., { details: { existingId } })`), `suggestLocations(park, name)` (trigram `similarity()` query, see below), `findLocation(locationId)`.
- `routes.ts`: Fastify routes for `/experiences/:id/food-items`, `/me/food-items/:foodItemId/logs`, `/locations`, `/locations/suggest`, `/locations/:id/food-items`, and (Requirement 8, 9) `/me/food-item-logs`, `/experiences/:id/food-item-logs/mine`, `/locations/:id/food-item-logs/mine`.
- Extends `MenuRetrievalRepo` (in `apps/api/src/services/catalog/menuRetrieval.ts`) with the new seeding call — see "Menu_Retrieval Integration" below.

### Menu_Retrieval Integration

`MenuRetrievalDeps.repo` widens by one method:

```typescript
export interface MenuRetrievalRepo {
  getMenuFetchState(experienceId: string): Promise<MenuFetchState | null>;
  upsertMenus(experienceId: string, menus: readonly MenuDTO[], fetchedAt: Date): Promise<void>;
  // NEW — Food Item Logging (Requirement 1.1-1.4):
  upsertFoodItemsFromMenus(
    experienceId: string,
    menus: readonly MenuDTO[],
    seenAt: Date,
  ): Promise<void>;
}
```

`createMenuRetrieval`'s fetch-success branch calls both `upsertMenus` and `upsertFoodItemsFromMenus` after `projectMenus(raw)`, before returning. `CatalogRepo` (the concrete `MenuRetrievalRepo` implementation, `apps/api/src/services/catalog/repo.ts`) is composed with the `FoodItemRepo`'s upsert function in `composeServices.ts` so the catalog module doesn't need to know about `food_items` directly — the composition root wires `upsertFoodItemsFromMenus: (id, menus, now) => foodItemRepo.upsertFoodItemsFromMenus(id, menus, now)` onto the object passed as `repo` to `createMenuRetrieval`.

### Mobile Structure (`apps/mobile/src/screens/catalog/`)

- `FoodItemPickerModal.tsx`: Search-as-you-type picker sourced from `GET /experiences/:id/food-items`, with an "Add [name]" row when no match, mirroring the existing `LogVisitModal.tsx` sheet pattern.
- `LogFoodItemModal.tsx`: Date picker (capped at today), 1–10 rating, note — same shape as `LogVisitModal.tsx`, opened after a Food_Item is picked.
- **Stale-item labeling (Requirement 5.7):** both `FoodItemPickerModal.tsx` and `FoodItemLogHistorySheet.tsx` render a "Not currently on menu" label on any row whose `FoodItemDTO.currentlyOnMenu`/history entry resolves to `false`, without disabling selection — the item stays fully loggable and its history stays fully viewable, only its presentation differs from a current menu item.
- `FoodItemLogHistorySheet.tsx`: Mirrors `VisitHistoryTimeline.tsx` from `experience-activity-logging` — lists every `Food_Item_Log` for one Food_Item (date, rating, note) sourced from `GET /me/food-items/:foodItemId/logs`, each row with a delete action (`DELETE /me/food-items/:foodItemId/logs/:logId`). Opened from a repeat-count indicator on the Food_Item's row inside `FoodItemPickerModal` (Requirement 5.5, 5.6) — without this, a User could log a dish repeatedly but never see or correct their own history, unlike ride/restaurant visit logging.
- `CreateLocationModal.tsx` (new, Requirement 6, 7): opened from an "It's not listed" action on the restaurant search used to enter `FoodItemPickerModal` in the first place. As the User types a name, it debounce-queries `GET /locations/suggest?park=...&name=...` and renders each `LocationSuggestionDTO` as a selectable row above a "Create '[name]' as a new location" action. Selecting a suggestion routes directly into `FoodItemPickerModal` scoped to that existing `locationId`, calling `POST /locations` never happens (Requirement 7.3). Choosing "Create" instead calls `POST /locations` immediately — suggestions are advisory only, so there is no secondary "are you sure none of these match" confirmation gate (Requirement 6.3, 7.4). `FoodItemPickerModal` itself is unchanged beyond accepting either an `experienceId` or a `locationId` scope prop, since Requirement 6.5's `POST /locations/:id/food-items` mirrors `POST /experiences/:id/food-items` exactly.

### My Food History and Restaurant-Scoped Logged Items (Requirement 8, 9 — added by this amendment)

The existing `FoodItemLogDTO`/`FoodItemLogHistoryDTO` carry only `foodItemId` — no dish name, no restaurant/location name — because `getLogHistory` is always called in a context where the caller already has the `FoodItemDTO` in hand (the picker row). Requirement 8 and 9's screens are entered from Profile or from an Experience Detail screen the User may not have the picker open on, and Requirement 8's screen spans many restaurants at once, so both need a self-describing row. This amendment adds one new DTO rather than overloading the existing one, so no existing caller's response shape changes:

```typescript
// packages/shared/src/dto/FoodItemLog.ts — added by this amendment
export interface FoodItemLogWithContextDTO extends FoodItemLogDTO {
  readonly foodItemName: string;
  readonly currentlyOnMenu: boolean;
  /** Exactly one of these two is non-null, mirroring `FoodItemDTO`'s scope pair. */
  readonly restaurantName: string | null;
  readonly locationName: string | null;
}
```

`FoodItemLogRepo` gains two new read methods returning `readonly FoodItemLogWithContextDTO[]` directly (no `repeatCount`/history wrapper — Requirement 8 and 9's lists are not scoped to one Food_Item, so a per-item repeat count is not the relevant figure here):

```typescript
// apps/api/src/services/foodLog/repo.ts — added by this amendment
export interface FoodItemLogRepo {
  addLog(input: CreateFoodItemLogRepoInput): Promise<FoodItemLogDTO>;
  getLogHistory(userId: string, foodItemId: string): Promise<FoodItemLogHistoryDTO>;
  deleteLog(userId: string, foodItemId: string, logId: string): Promise<void>;
  // NEW:
  getAllLogsForUser(userId: string): Promise<readonly FoodItemLogWithContextDTO[]>;
  getLogsForUserAtScope(
    userId: string,
    scope: { readonly experienceId?: string; readonly locationId?: string },
  ): Promise<readonly FoodItemLogWithContextDTO[]>;
}
```

Both share one underlying query shape (a join from `food_item_logs` through `food_items` out to `experiences`/`user_submitted_locations`), differing only in their `WHERE` clause:

```sql
-- getAllLogsForUser(userId)
SELECT fil.id, fil.user_id, fil.food_item_id, fil.visited_on, fil.user_tz, fil.logged_at,
       fil.rating, fil.note,
       fi.name AS food_item_name, fi.experience_id, fi.location_id,
       (fi.source = 'user_submitted' OR fi.last_seen_at >= em.fetched_at) AS currently_on_menu,
       e.name AS restaurant_name, usl.name AS location_name
  FROM food_item_logs fil
  JOIN food_items fi ON fi.id = fil.food_item_id
  LEFT JOIN experiences e ON e.id = fi.experience_id
  LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
  LEFT JOIN experience_menus em ON em.experience_id = fi.experience_id
 WHERE fil.user_id = $1
 ORDER BY fil.visited_on DESC, fil.logged_at DESC

-- getLogsForUserAtScope(userId, { experienceId }) — identical, plus:
   AND fi.experience_id = $2
-- getLogsForUserAtScope(userId, { locationId }) — identical, plus:
   AND fi.location_id = $2
```

`getLogsForUserAtScope` enforces the same exactly-one-of-`experienceId`/`locationId` rule as every other dual-scope entry point in this feature (Requirement 6.6/Property 9) — the route layer rejects a call supplying neither or both with `validation_failed` before this method is ever invoked, exactly mirroring how `foodItemParamsSchema`/`locationParamsSchema` gate the existing scoped routes.

**New index.** The existing `food_item_logs_user_item_idx (user_id, food_item_id, visited_on DESC, logged_at DESC)` leads with `user_id` so Postgres can still use it for a `WHERE user_id = $1` scan, but it's optimized for the item-scoped read, not a cross-item one. This amendment's migration adds a second index without dropping the first:

```sql
CREATE INDEX food_item_logs_user_idx
    ON food_item_logs(user_id, visited_on DESC, logged_at DESC);
```

**New routes** in `foodItemLogRoutes` (`apps/api/src/services/foodLog/routes.ts`):

- `GET /me/food-item-logs` (Requirement 8.1, 8.2) — session-gated, no params, calls `repo.getAllLogsForUser(userId)`.
- `GET /experiences/:id/food-item-logs/mine` (Requirement 9.1, 9.3) — session-gated, `experienceParamsSchema` (already defined in this file) for `:id`, calls `repo.getLogsForUserAtScope(userId, { experienceId })`.
- `GET /locations/:id/food-item-logs/mine` (Requirement 9.2, 9.3) — session-gated, `locationParamsSchema` (already defined in this file) for `:id`, calls `repo.getLogsForUserAtScope(userId, { locationId })`.

All three are plain reads with no not-found branch — an experience/location id that doesn't resolve to any logs is indistinguishable from one with zero logs, and both return an empty list with `200`, consistent with Requirement 4.2's existing no-history-is-not-an-error convention. No new `ErrorCode` is introduced by this amendment (see Error Handling).

### Mobile Structure — My Food History and Restaurant-Scoped Logged Items (Requirement 8, 9)

- `MyFoodHistoryScreen.tsx` (new, `apps/mobile/src/screens/catalog/`): a full screen (not a modal sheet, since it is a primary navigable destination, mirroring `MyFoodListsScreen.tsx`'s precedent of a root-stack screen reached from Profile rather than a sheet) sourced from `GET /me/food-item-logs`, rendered as a `FlatList` of rows (dish name, restaurant/location name, visit date, rating, note, "Not currently on menu" label when `currentlyOnMenu` is `false`), each with a delete action calling `DELETE /me/food-items/:foodItemId/logs/:logId` and invalidating `['me-food-item-logs']` on success. Registered on `RootStackParamList` as `MyFoodHistory: undefined` and rendered with `headerShown: false`, exactly mirroring `MyFoodLists`'s existing registration. Reached from a "View your food history" `SecondaryButton` on the Profile screen, placed alongside the existing "View your stats"/"View your pins" entry points.
- `RestaurantFoodLogsSheet.tsx` (new, `apps/mobile/src/screens/catalog/`): a modal bottom sheet (matching `FoodItemLogHistorySheet.tsx`'s existing sheet pattern, since this is a secondary view opened from an already-open Experience Detail screen, not a primary destination) accepting either an `experienceId` or `locationId` scope prop, sourced from `GET /experiences/:id/food-item-logs/mine` or `GET /locations/:id/food-item-logs/mine` respectively, rendering the identical row shape as `MyFoodHistoryScreen.tsx` (dish name instead of restaurant name is now redundant since every row shares the same restaurant, so the restaurant/location name is shown once in the sheet's header instead of per-row) with the same per-row delete action, invalidating `['scoped-food-item-logs', experienceId ?? locationId]` on success.
- A "My logged items here" `SecondaryButton` is added to the existing `styles.foodItemButtonsRow` on the Experience Detail screen's "Dishes & Food" card (`apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx`, alongside the existing "Log a food item"/"Add to a list" buttons), opening `RestaurantFoodLogsSheet` scoped to `experienceId`. The equivalent affordance for a User_Submitted_Location's food-item entry point (Requirement 7) opens the same sheet scoped to `locationId`.

#### Client-Side Sort, Filter, and Search (Requirement 8.6-8.10, 9.7-9.8)

Both `GET /me/food-item-logs` and the two `.../food-item-logs/mine` endpoints return their entire result in one unpaginated call (per the "no pagination" decision above), so sort/filter/search are pure client-side derivations over the already-fetched array — no new query params, no new endpoint, no additional network request as the User sorts, filters, or types a search term. This mirrors the existing `ExperiencesList` sort-toggle pattern (`apps/mobile/src/screens/stats/`) rather than a server-side sort/filter API.

Both screens hold three pieces of local UI state (`sort: 'recent' | 'oldest' | 'ratingDesc' | 'ratingAsc'`, `selectedRestaurantNames: ReadonlySet<string>` — `MyFoodHistoryScreen` only, per Requirement 9.7's note that the scoped sheet omits this control — and `searchText: string`) and derive the displayed rows with a single `useMemo` pipeline applied in this order: filter by `selectedRestaurantNames` (if any selected) → filter by case-insensitive substring match of `searchText` against `foodItemName`/`restaurantName`/`locationName` (`RestaurantFoodLogsSheet` matches `foodItemName` only, per Requirement 9.8) → sort by the selected `sort` value. Composing in this fixed order (filter, then search, then sort) is what makes Requirement 8.10's "controls compose rather than reset" behavior correct — each step narrows/reorders the prior step's output, none of the three ever clears another's selection.

Sort comparators:
- `recent` (default): `visitedOn DESC, loggedAt DESC` — identical to the server's own order, so selecting it after another sort is a no-op re-sort, not a special "reset" path.
- `oldest`: the exact reverse of `recent`.
- `ratingDesc`/`ratingAsc`: primary key `rating` (descending or ascending respectively), with `null` (no rating) always sorted after every rated row in both directions (Requirement 8.7); tie-break (equal rating, including two `null` rows) falls back to the `recent` order, so the result is fully deterministic for any input.

The restaurant/location filter's option list (`MyFoodHistoryScreen` only) is derived from `Array.from(new Set(rows.map(r => r.restaurantName ?? r.locationName)))` over the currently-fetched `rows` — never a separate `GET`, so it can never suggest a restaurant/location the User hasn't actually logged anything at.

## Data Models & Migration

### Migration `0040_food_item_logging.sql`

```sql
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. food_items — per-restaurant dish catalog
-- ---------------------------------------------------------------------------
-- 0. user_submitted_locations — manually-created food-selling spots with no
--    corresponding Restaurant_Experience in the catalog (Requirement 6).
--    pg_trgm is already installed by 0001_init.sql; no new extension needed.
CREATE TABLE user_submitted_locations (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT         NOT NULL,
    park                TEXT         NOT NULL,
    created_by_user_id  UUID         REFERENCES users(id),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT user_submitted_locations_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT user_submitted_locations_park_chk CHECK (park IN (
        'Magic Kingdom', 'EPCOT', "Disney's Hollywood Studios", "Disney's Animal Kingdom",
        'Typhoon Lagoon', 'Blizzard Beach', 'Disney Springs'
    )), -- mirrors the existing PARKS enum (packages/shared/src/enums.ts)
    CONSTRAINT user_submitted_locations_unique_name_per_park UNIQUE (park, lower(name))
);

-- Trigram index backing the similarity-based suggest query (Requirement 6.2).
-- Mirrors the existing `profiles_display_name_trgm_idx` pattern from 0001_init.sql.
CREATE INDEX user_submitted_locations_name_trgm_idx
    ON user_submitted_locations USING gin (lower(name) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 1. food_items — per-restaurant-or-user-submitted-location dish catalog
-- ---------------------------------------------------------------------------
CREATE TABLE food_items (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    experience_id       UUID         REFERENCES experiences(id) ON DELETE CASCADE,
    location_id         UUID         REFERENCES user_submitted_locations(id) ON DELETE CASCADE,
    name                TEXT         NOT NULL,
    price               TEXT,
    source              TEXT         NOT NULL DEFAULT 'menu_sync',
    created_by_user_id  UUID         REFERENCES users(id),
    last_seen_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT food_items_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT food_items_source_chk CHECK (source IN ('menu_sync', 'user_submitted')),
    -- Requirement 6.6: scoped to exactly one of experience_id / location_id, never
    -- both and never neither. A menu_sync item is always experience-scoped (Disney's
    -- feed never produces a location_id), enforced at the application layer since
    -- upsertFoodItemsFromMenus never sets location_id.
    CONSTRAINT food_items_exactly_one_scope_chk CHECK (
        (experience_id IS NOT NULL AND location_id IS NULL) OR
        (experience_id IS NULL AND location_id IS NOT NULL)
    ),
    CONSTRAINT food_items_unique_name_per_experience UNIQUE (experience_id, lower(name)),
    CONSTRAINT food_items_unique_name_per_location UNIQUE (location_id, lower(name))
);

CREATE INDEX food_items_experience_idx ON food_items(experience_id);
CREATE INDEX food_items_location_idx ON food_items(location_id);

-- ---------------------------------------------------------------------------
-- 2. food_item_logs — per-user dish visit log
-- ---------------------------------------------------------------------------
CREATE TABLE food_item_logs (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    food_item_id   UUID         NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
    visited_on     DATE         NOT NULL,
    user_tz        TEXT         NOT NULL,
    logged_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    rating         SMALLINT,
    note           TEXT,
    CONSTRAINT food_item_logs_rating_range_chk CHECK (rating IS NULL OR rating BETWEEN 1 AND 10),
    CONSTRAINT food_item_logs_note_length_chk CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 2000)
);

CREATE INDEX food_item_logs_user_item_idx
    ON food_item_logs(user_id, food_item_id, visited_on DESC, logged_at DESC);

COMMIT;
```

Notes mirroring existing precedent:
- `food_items_unique_name_per_experience UNIQUE (experience_id, lower(name))` is the case-insensitive dedup constraint (Requirement 1.2, 2.2), following the same `lower(name)` pattern used by `experience_festival_tags`' sibling uniqueness checks and the `char_length`/`lower` pg-mem test shims already registered in the existing property-test harness (`experienceLogs.prop.test.ts`), so no new pg-mem function registration is needed for these tests.
- `food_items.experience_id` is `ON DELETE CASCADE` (not merely referencing): if a Restaurant_Experience is ever hard-deleted from the catalog, its dish catalog and every log against those dishes goes with it — there is no scenario where a dangling `food_items` row referencing a deleted restaurant is meaningful. `food_item_logs.food_item_id` cascades the same way, transitively removing a User's logs if the parent dish is removed (which in practice only happens via the experience cascade, since `food_items` rows are never deleted directly by any endpoint in this feature). `food_items.location_id` cascades identically for the User_Submitted_Location side, though `user_submitted_locations` rows are likewise never deleted by any endpoint in this feature (Requirement 6.8 — no merge/delete operation exists), so this cascade is dormant in practice, kept only for schema consistency with the experience side.
- **Dedup is suggest-then-confirm, not auto-merge (Requirement 6.2, 6.3).** `similarity()` from `pg_trgm` scores two strings from 0 to 1 by shared trigrams; it is a *ranking* signal, not a certainty test — "Spring Roll Cart," "Spring Roll Snack Cart," and "Springroll Snack Cart" score highly similar to each other but a lower, non-zero score is still possible between two genuinely different locations that happen to share common words (e.g. two different "X Snack Cart"s in the same park). Because no threshold can safely auto-merge without a real risk of merging two distinct real-world places, `GET /locations/suggest` only ever *ranks and returns* candidates — the decision of whether a suggestion is the same real place is always made by the User in the mobile flow (Requirement 7.2, 7.3), never by the server. The exact-match `UNIQUE (park, lower(name))` constraint (Requirement 6.4) is the only hard backstop, and it only catches identical-after-normalization names, not near-misses.
- **A dish falling off the menu never deletes anything.** `upsertFoodItemsFromMenus` is insert/update-only (Requirement 1.1, 1.2) — it never deletes a `food_items` row that was absent from the latest fetch. A `menu_sync` item's `last_seen_at` simply stops advancing once it's no longer on the real menu, while its row and every `Food_Item_Log` referencing it (Requirement 1.7) remain exactly as they were. Staleness is surfaced as the read-time `currentlyOnMenu` computed flag (see `FoodItemDTO` below), not enforced by deleting or blocking anything — a User can always still log, view, and delete history against a no-longer-served dish.
- No unique constraint on `food_item_logs` — like `experience_logs`, repeat logs for the same dish on the same or different days are intentional (Requirement 3.2).

### Computing `currentlyOnMenu`

`listFoodItems(experienceId)` derives `currentlyOnMenu` at read time by comparing each item's `last_seen_at` against the Restaurant_Experience's most recent successful menu-sync fetch timestamp (`experience_menus.fetched_at`, already maintained by the existing `upsertMenus`):

```sql
SELECT fi.id, fi.name, fi.price, fi.source,
       (fi.source = 'user_submitted'
         OR fi.last_seen_at >= em.fetched_at) AS currently_on_menu
  FROM food_items fi
  LEFT JOIN experience_menus em ON em.experience_id = fi.experience_id
 WHERE fi.experience_id = $1
 ORDER BY fi.name ASC
```

A `user_submitted` item is always `true` regardless of `last_seen_at` (it was never sourced from a menu fetch, so it has no sync cycle to fall stale against — Requirement 1.8). A `menu_sync` item is `true` only when its `last_seen_at` is at or after the latest `experience_menus.fetched_at` for that restaurant, i.e. it was seen in the most recent fetch; an older `last_seen_at` means a later fetch happened without seeing that name, so it dropped off. When `experience_menus` has no row yet (no fetch has ever completed — only possible for `user_submitted` items, since `menu_sync` items only exist after a fetch), the `LEFT JOIN` yields `em.fetched_at = NULL` and the comparison is `NULL`, which SQL's `OR` short-circuits correctly for `user_submitted` rows (`true OR NULL = true`) — there is no `menu_sync` row this ambiguity could apply to, since one cannot exist without a completed fetch.

### Computing `suggestLocations` (Requirement 6.2)

`suggestLocations(park, name)` uses `pg_trgm`'s `similarity()` function against the trigram-indexed `lower(name)` column, filtered by the `LOCATION_SIMILARITY_THRESHOLD` constant (see Configuration & Constants):

```sql
SELECT id, name, similarity(lower(name), lower($2)) AS sim
  FROM user_submitted_locations
 WHERE park = $1
   AND similarity(lower(name), lower($2)) >= $3   -- LOCATION_SIMILARITY_THRESHOLD
 ORDER BY sim DESC
 LIMIT 10
```

`similarity()` scores two strings 0.0–1.0 by the fraction of shared trigrams (overlapping 3-character sequences) — "spring roll cart" and "springroll snack cart" share enough trigrams to score well above a `0.3`-ish threshold despite no exact substring or case-insensitive match between them, which is exactly the class of near-miss (missing space, extra/dropped word) the exact-match `UNIQUE (park, lower(name))` constraint cannot catch. The `park` filter keeps the comparison scoped and the index-backed (`gin (lower(name) gin_trgm_ops)`) query cheap even as the table grows — this mirrors `users_email_trgm_idx`/`profiles_display_name_trgm_idx` from `0001_init.sql`, the existing precedent for a trigram-indexed search column in this schema, extended here from substring `ILIKE` matching (as used by `friends/repo.ts`'s `searchUsers`) to similarity-score ranking, since ranking near-misses — not substring containment — is what dedup-assistance needs.

## Shared Contracts

### `packages/shared/src/dto/FoodItem.ts`

```typescript
export interface FoodItemDTO {
  readonly id: string;
  /** Exactly one of `experienceId`/`locationId` is non-null (Requirement 6.6). */
  readonly experienceId: string | null;
  readonly locationId: string | null;
  readonly name: string;
  readonly price: string | null;
  readonly source: 'menu_sync' | 'user_submitted';
  /**
   * `true` when this item is a `user_submitted` entry, or its `last_seen_at`
   * falls within the Restaurant_Experience's most recent successful menu-sync
   * fetch; `false` when a `menu_sync` item was not seen in that most recent
   * fetch (the dish dropped off the current menu). Computed at read time from
   * `food_items.last_seen_at` vs. `experience_menus.fetched_at` — never a
   * stored column, so it always reflects the latest sync without a backfill
   * (Requirement 1.7, 1.8).
   */
  readonly currentlyOnMenu: boolean;
}
```

### `packages/shared/src/dto/FoodItemLog.ts`

```typescript
export interface FoodItemLogDTO {
  readonly id: string;
  readonly userId: string;
  readonly foodItemId: string;
  readonly visitedOn: string; // YYYY-MM-DD
  readonly userTz: string;
  readonly loggedAt: string; // ISO-8601 UTC
  readonly rating: number | null; // 1..10
  readonly note: string | null;
}

export interface FoodItemLogHistoryDTO {
  readonly foodItemId: string;
  readonly repeatCount: number;
  readonly logs: readonly FoodItemLogDTO[];
}

export interface CreateFoodItemLogInputDTO {
  readonly visitedOn: string; // YYYY-MM-DD
  readonly userTz: string;
  readonly rating?: number | null;
  readonly note?: string | null;
}

export interface SubmitFoodItemInputDTO {
  readonly name: string;
}

// Added by this amendment (Requirement 8, 9) — see "My Food History and
// Restaurant-Scoped Logged Items" above for the full shape and rationale.
export interface FoodItemLogWithContextDTO extends FoodItemLogDTO {
  readonly foodItemName: string;
  readonly currentlyOnMenu: boolean;
  readonly restaurantName: string | null;
  readonly locationName: string | null;
}
```

`foodItemLogWithContextSchema` (Zod, `.strict()`) is added to `packages/shared/src/schemas/FoodItemLog.ts` alongside the existing schemas, and both are barreled in `packages/shared/src/dto/index.ts` / `packages/shared/src/schemas/index.ts` exactly as every other DTO/schema pair in this feature already is. No new primitive is needed — `foodItemLogWithContextSchema` extends `foodItemLogSchema` with `foodItemName: foodItemNameSchema`, `currentlyOnMenu: z.boolean()`, `restaurantName: z.string().nullable()`, `locationName: z.string().nullable()`.

### `packages/shared/src/dto/UserSubmittedLocation.ts`

```typescript
export interface UserSubmittedLocationDTO {
  readonly id: string;
  readonly name: string;
  readonly park: Park; // reuses the existing Park enum
}

export interface CreateUserSubmittedLocationInputDTO {
  readonly name: string;
  readonly park: Park;
}

/** One ranked candidate from `GET /locations/suggest` (Requirement 6.2). */
export interface LocationSuggestionDTO {
  readonly id: string;
  readonly name: string;
  readonly similarity: number; // 0..1, pg_trgm's similarity() score
}
```

All three (`FoodItem.ts`, `FoodItemLog.ts`, `UserSubmittedLocation.ts`) are barreled in `packages/shared/src/dto/index.ts` and mirrored by Zod schemas in matching files under `packages/shared/src/schemas/`, reusing the existing `uuidSchema`, `ratingValueSchema`, `noteBodySchema`, `isoDateSchema`, `ianaTzSchema`, `parkSchema` primitives from `packages/shared/src/schemas/primitives.ts` — no new primitives are needed for rating/note/date/tz/park validation. A new bounded-string primitive is added for the dish/location name (shared by both, since both are 1–200 char trimmed names), following the `noteBodySchema` shape:

```typescript
// packages/shared/src/schemas/primitives.ts — added
export const foodItemNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'validation_failed' })
  .max(200, { message: 'validation_failed' });
```

`createUserSubmittedLocationInputSchema` = `z.object({ name: foodItemNameSchema, park: parkSchema }).strict()`. All new schema files are barreled in `packages/shared/src/schemas/index.ts` alongside the existing `ExperienceLog.ts` exports, following the identical barrel pattern.

## Composition Wiring (`apps/api/src/composeServices.ts`)

```typescript
const foodItemRepo = createFoodItemRepo(pool);
const foodItemLogRepo = createFoodItemLogRepo({ pool });

// Widen the existing menuRetrieval repo dependency with the new seeding call,
// BEFORE menuRetrieval is constructed:
const menuRetrieval = createMenuRetrieval({
  repo: {
    getMenuFetchState: (id) => catalogRepo.getMenuFetchState(id),
    upsertMenus: (id, menus, fetchedAt) => catalogRepo.upsertMenus(id, menus, fetchedAt),
    upsertFoodItemsFromMenus: (id, menus, seenAt) =>
      foodItemRepo.upsertFoodItemsFromMenus(id, menus, seenAt),
  },
  client: diningMenuClient,
  freshnessMs: config.disney.menuFreshnessMs,
});

// ... later, in the object passed to buildServer(config, { ... }):
const userSubmittedLocationRepo = createUserSubmittedLocationRepo(pool);

foodLog: {
  items: { repo: foodItemRepo, requireSession: sessionMiddleware, menuRetrieval },
  logs: { repo: foodItemLogRepo, requireSession: sessionMiddleware },
  locations: { repo: userSubmittedLocationRepo, requireSession: sessionMiddleware },
},
```

`BuildServerServices` (in `apps/api/src/server.ts`) gains a `readonly foodLog?: { items?: FoodItemRoutesOptions; logs?: FoodItemLogRoutesOptions; locations?: UserSubmittedLocationRoutesOptions }` block, opt-in like `tracking`, so unit tests registering only the routes they need don't have to satisfy the whole surface.

## Error Handling

New `ErrorCode` entries added to `packages/shared/src/errors.ts` under a new `-- Food item logging (food-item-logging R1-R6) --` block, following the existing catalog's grouped-by-domain convention:

```typescript
// -- Food item logging (food-item-logging R1-R6) ----------------------
// `food_item_not_found`: a log/delete targeted a food_item_id that does not
// exist. `food_item_duplicate`: a user-submitted name case-insensitively
// matched an existing Food_Item for that restaurant or location; the response
// includes the existing item's id so the client can use it instead of retrying.
// `food_log_not_found`: a delete targeted a Food_Item_Log id that does not
// exist for the authenticated User (or belongs to another User/food item) —
// collapsed to one non-probing response, mirroring `log_not_found`.
// `food_log_future_date`: `visited_on` is strictly later than today in the
// request's `user_tz`, mirroring `log_future_date`.
// `location_duplicate`: a submitted User_Submitted_Location name
// case-insensitively matched an existing one in the same park; the response
// includes the existing location's id (Requirement 6.4). Note this is
// distinct from the advisory similarity-suggest step (Requirement 6.2, 6.3),
// which never rejects — this code is the hard exact-match backstop only.
'food_item_not_found',
'food_item_duplicate',
'food_log_not_found',
'food_log_future_date',
'location_duplicate',
```

And in `errorCodeToHttpStatus`:
```typescript
food_item_not_found: 404,
food_item_duplicate: 409,
food_log_not_found: 404,
food_log_future_date: 400,
location_duplicate: 409,
```

- `400 validation_failed`: invalid date shape, unparseable timezone, rating outside 1..10, note exceeding 2000 chars, a submitted dish/location name empty after trim / exceeding 200 chars, an invalid `park` value, or a Food_Item create/log request naming neither/both of `experienceId`/`locationId` (Requirement 6.6).
- `404 food_item_not_found`: `foodItemId` does not reference an existing `Food_Item` (Requirement 3.4).
- `404 food_log_not_found`: delete target missing, foreign, or mismatched food item (Requirement 4.4).
- `409 food_item_duplicate`: case-insensitive name collision on submit, whether experience-scoped (Requirement 2.2) or location-scoped (Requirement 6.5).
- `409 location_duplicate`: case-insensitive `(park, name)` collision on location creation (Requirement 6.4).
- `401 unauthorized`: unauthenticated request on any `/me/...` route.

**Amendment note (Requirement 8, 9):** the three new routes (`GET /me/food-item-logs`, `GET /experiences/:id/food-item-logs/mine`, `GET /locations/:id/food-item-logs/mine`) introduce no new `ErrorCode`. They are read-only, auth-gated (`401 unauthorized` on missing session, reusing the existing gate) with no not-found branch — an unresolved or logless scope simply returns an empty list with `200`, per Requirement 8.2/9.3. `GET /experiences/:id/food-item-logs/mine` and `GET /locations/:id/food-item-logs/mine` validate their path param via the existing `experienceParamsSchema`/`locationParamsSchema` (`400 validation_failed` on a malformed UUID, unchanged from every other route already using those schemas).

## Configuration & Constants

| Constant | Value | Purpose |
|---|---|---|
| `FOOD_ITEM_NAME_MAX_LENGTH` | `200` | Maximum character length for a Food_Item name (menu_sync or user_submitted) |
| `MAX_NOTE_LENGTH` | `2000` | Maximum character length for a food log note (reuses the existing `experience_logs` constant) |
| `MIN_RATING` / `MAX_RATING` | `1` / `10` | Reuses the existing rating bounds from `experience-activity-logging` |
| `DEFAULT_USER_TZ` | `'America/New_York'` | Default fallback IANA timezone, reused from `experience-activity-logging` |
| `LOCATION_NAME_MAX_LENGTH` | `200` | Maximum character length for a User_Submitted_Location name |
| `LOCATION_SIMILARITY_THRESHOLD` | `0.3` | Minimum `pg_trgm` `similarity()` score for `GET /locations/suggest` to return a candidate (Requirement 6.2). `0.3` matches Postgres's own default `pg_trgm.similarity_threshold` GUC, chosen as a starting point rather than derived from data; revisit once real submission volume exists to see if it under- or over-suggests in practice. |
| `LOCATION_SUGGEST_LIMIT` | `10` | Maximum candidates returned per `GET /locations/suggest` call |

No new env vars are introduced — this feature reuses `config.disney.menuFreshnessMs` (already configured via `MENU_FRESHNESS_MS`) as the trigger for when `food_items` gets (re)seeded; there is no independent freshness window for the dish catalog. `LOCATION_SIMILARITY_THRESHOLD`/`LOCATION_SUGGEST_LIMIT` are code constants, not env vars — they are UX-tuning values with no per-environment reason to differ.

**Amendment note (Requirement 8, 9):** no new constant, threshold, or env var is introduced. The two new read endpoints reuse every existing bound (rating 1–10, note length, `currentlyOnMenu` computation) unchanged; they add no pagination limit, since a User's own food log history is bounded by how much they personally log and is not expected to need cursor-based paging at any realistic scale for this feature (unlike `food-lists`' discovery feed, which paginates because it spans all Users' public content).

## External Interfaces

This feature does not call any new external API. It piggybacks entirely on the existing Menu_Service integration (`apps/api/src/services/catalog/disney/menu.ts`, `diningMenuClient.ts`) already used by `Menu_Retrieval`. The only "external interface" relevant here is the shape already consumed from that integration:

- **Source**: `MenuDTO[]` as returned by `projectMenus(raw)` (existing code, unchanged).
- **Fields relied on**: `menus[].groups[].name` (not used by this feature), `menus[].groups[].items[].name` (→ `food_items.name`), `menus[].groups[].items[].price` (→ `food_items.price`, carried verbatim, no parsing).
- **No id mapping**: there is no upstream item id; identity is derived entirely from `(experience_id, lower(name))`.

## Correctness Properties

### Property 1: Menu-Sync Seeding Idempotence and Failure Isolation
*For any Restaurant_Experience and any sequence of Menu_Retrieval fetches, a successful fetch upserts exactly one `food_items` row per distinct (case-insensitive) item name across all groups in the fetched menus, updating `price`/`last_seen_at` on repeat sightings rather than duplicating; a failed fetch (Menu_Service error) leaves `food_items` for that Restaurant_Experience completely unchanged; and a fresh-cache serve (no fetch performed) never touches `food_items`.*
**Validates:** Requirement 1.1, Requirement 1.2, Requirement 1.4

### Property 2: User-Submission Deduplication
*For any Restaurant_Experience and any submitted name, if a case-insensitively equal `Food_Item` name already exists for that Restaurant_Experience (of either `source`), the submission is rejected with `food_item_duplicate` and no new row is inserted; otherwise a new `user_submitted` row is inserted and is visible in `GET /experiences/:id/food-items` to any User, not only the submitter.*
**Validates:** Requirement 2.1, Requirement 2.2, Requirement 2.3

### Property 3: Food Item Log Independence from Completions/Ratings
*For any User and Food_Item, inserting a `Food_Item_Log` (with or without a rating) never inserts, updates, or deletes any row in `completions`, `ratings`, or `experience_logs` for the parent Restaurant_Experience.*
**Validates:** Requirement 3.5

### Property 4: Food Log History Ordering and Repeat Count
*For any User and Food_Item, `GET /me/food-items/:foodItemId/logs` returns `repeatCount === logs.length`, and every item in `logs` satisfies `logs[i].visitedOn >= logs[i+1].visitedOn` (with `loggedAt >= logs[i+1].loggedAt` as tie-breaker).*
**Validates:** Requirement 4.1, Requirement 4.2

### Property 5: No Future Visit Date
*For any `visited_on` strictly later than today in the request's `user_tz`, `POST /me/food-items/:foodItemId/logs` is rejected with `400 food_log_future_date` and no `Food_Item_Log` row is written; for any `visited_on` on or before that date the request is accepted.*
**Validates:** Requirement 3.3

### Property 6: Mobile History Visibility and Delete
*For any Food_Item with one or more `Food_Item_Log` records for the User, `FoodItemPickerModal` renders a repeat-count indicator on that row, and activating it opens `FoodItemLogHistorySheet` listing every log with a working delete action that removes exactly the targeted log and no other.*
**Validates:** Requirement 5.5, Requirement 5.6

### Property 7: Menu Departure Preserves Logs and Is Surfaced, Never Enforced
*For any `menu_sync` Food_Item present before a fetch and absent from that fetch's returned menus, the fetch's `upsertFoodItemsFromMenus` call leaves that Food_Item's row and every `Food_Item_Log` referencing it byte-for-byte unchanged; `listFoodItems` computes `currentlyOnMenu: false` for it from that point forward (until a later fetch sees the name again); and `POST /me/food-items/:foodItemId/logs`/`DELETE .../logs/:logId` continue to succeed against it exactly as they would for a `currentlyOnMenu: true` item.*
**Validates:** Requirement 1.7, Requirement 1.8, Requirement 1.9

### Property 8: Location Exact-Match Dedup and Advisory Similarity Suggestion
*For any park and any submitted location name, IF a case-insensitively equal `User_Submitted_Location` name already exists in that park, the creation is rejected with `location_duplicate` and no new row is inserted; OTHERWISE creation succeeds regardless of how many similarity-suggested candidates `GET /locations/suggest` would have returned for that name — the suggest endpoint's results never affect whether `POST /locations` succeeds, only what the client displays before calling it. For any two names with a `pg_trgm` `similarity()` score at or above `LOCATION_SIMILARITY_THRESHOLD`, the higher-scoring name is suggested before the lower-scoring one.*
**Validates:** Requirement 6.2, Requirement 6.3, Requirement 6.4

### Property 9: Food Item Scope Exclusivity
*For any Food_Item creation or log request, the request succeeds only when exactly one of `experienceId`/`locationId` is supplied and resolves to an existing row of the matching kind; a request supplying neither, both, or an id that does not resolve is rejected with `validation_failed`/`food_item_not_found` and no row is written. For any two Food_Items with the same case-insensitive `name`, they never collide with each other if one is experience-scoped and the other location-scoped (the `UNIQUE` constraints are per-scope, not global).*
**Validates:** Requirement 6.5, Requirement 6.6

### Property 10: My Food History Completeness and Ordering (Added by this amendment)
*For any User, `GET /me/food-item-logs` returns exactly the set of `Food_Item_Log` rows belonging to that User across every Food_Item — no more, no fewer, and none belonging to another User — sorted by `visited_on DESC, logged_at DESC`, each entry carrying its Food_Item's `name` and exactly one non-null `restaurantName`/`locationName` matching that Food_Item's own scope. Deleting a log via `DELETE /me/food-items/:foodItemId/logs/:logId` removes exactly that row from a subsequent `GET /me/food-item-logs` call and no other row.*
**Validates:** Requirement 8.1, Requirement 8.2, Requirement 8.4

### Property 11: Restaurant/Location-Scoped Logged Items Isolation (Added by this amendment)
*For any User and any Restaurant_Experience or User_Submitted_Location, `GET /experiences/:id/food-item-logs/mine` (respectively `GET /locations/:id/food-item-logs/mine`) returns exactly the subset of that User's `Food_Item_Log` rows whose Food_Item is scoped to that specific Restaurant_Experience/User_Submitted_Location — never a log belonging to a different restaurant/location, and never another User's log, even for the same Food_Item. This holds even when the same User has logs at multiple restaurants: the scoped result for restaurant A never includes a row whose Food_Item is scoped to restaurant B.*
**Validates:** Requirement 9.1, Requirement 9.2, Requirement 9.3

### Property 12: Client-Side Sort/Filter/Search Composition and Determinism (Added by this amendment)
*For any fetched list of `FoodItemLogWithContextDTO` rows and any combination of a selected sort, a selected restaurant/location filter subset, and a search string, the displayed rows are exactly those rows matching every active filter and search term (a row is displayed iff it satisfies all currently-active narrowing criteria, never just the most-recently-changed one), ordered by the selected sort comparator with a deterministic tie-break such that two independent evaluations over the same input array and the same control state always produce the same displayed order. Changing one control (sort, filter, or search) never resets the other two.*
**Validates:** Requirement 8.7, Requirement 8.8, Requirement 8.9, Requirement 8.10, Requirement 9.7, Requirement 9.8

## Testing Strategy

- **Repository property tests** (`apps/api/src/services/foodLog/__tests__/foodItems.prop.test.ts`, `foodItemLogs.prop.test.ts`, `userSubmittedLocations.prop.test.ts`): `fast-check` (>=100 runs) against pg-mem, following the exact harness in `apps/api/src/services/tracking/logs/__tests__/experienceLogs.prop.test.ts` (`buildPgMemDatabase()` registering `gen_random_uuid`/`char_length`/`lower`, `applyMigration(db, '0040_food_item_logging.sql')`, `withForUpdateCompat` if any `FOR UPDATE` read is added). `userSubmittedLocations.prop.test.ts` additionally needs a `similarity` function registered on the pg-mem instance (pg-mem's `pg_trgm` stub does not implement it for real — register a JS Dice-coefficient/trigram approximation purely for test determinism, asserting relative ordering rather than exact score values, since the goal is Property 8's ranking claim, not bit-for-bit parity with Postgres's C implementation). Tagged `// Feature: food-item-logging, Property N: <text>`.
- **Menu_Retrieval integration test** (`apps/api/src/services/catalog/__tests__/menuRetrieval.foodItems.test.ts`): a fake `MenuRetrievalRepo` asserting `upsertFoodItemsFromMenus` is called exactly once per real fetch with the projected menus, never on a fresh-cache serve, and never on a fetch failure (extends the existing `decideMenuFetch`-driven test style already covering `upsertMenus`).
- **Route integration tests** (`apps/api/src/services/foodLog/__tests__/routes.test.ts`): `server.inject`-equivalent Fastify harness mirroring `apps/api/src/services/tracking/logs/__tests__/routes.test.ts` (fake repo, stubbed `requireSession`), covering auth gates, the `food_item_duplicate` 409 path, `food_log_future_date` 400, the `food_log_not_found`/`food_item_not_found` 404 collapses, the `location_duplicate` 409 path, and the scope-exclusivity `validation_failed` cases (neither/both of `experienceId`/`locationId`).
- **Migration test** (`apps/api/src/db/__tests__/migration0040.test.ts`): asserts the new tables, the `CHECK`/`UNIQUE` constraints (case-insensitive name dedup per-experience and per-location, source enum, rating/note bounds, the scope-exclusivity CHECK, `park` enum), the trigram index exists, and cascade-on-experience-delete/location-delete behavior.
- **Mobile component tests** (`apps/mobile/src/screens/catalog/__tests__/FoodItemPickerModal.test.tsx`, `LogFoodItemModal.test.tsx`, `FoodItemLogHistorySheet.test.tsx`): `@testing-library/react-native`, mocking only the network/query layer, covering search-filter, the "Add [name]" submission path (including the duplicate-collapse-to-selection behavior), date-cap enforcement, rating/note submission, the repeat-count indicator rendering when logs exist, the history sheet's delete action removing exactly the targeted row (asserting the `DELETE` call and the resulting list update), and the "Not currently on menu" label rendering for a `currentlyOnMenu: false` item while remaining selectable/loggable (Requirement 5.7, Property 7).
- **`CreateLocationModal.test.tsx`**: mocking only the network/query layer, asserting: typing debounce-queries `GET /locations/suggest` and renders returned suggestions; selecting a suggestion navigates straight into `FoodItemPickerModal` scoped to that `locationId` without calling `POST /locations`; choosing "Create" calls `POST /locations` immediately regardless of whether suggestions are showing (Requirement 7.3, 7.4); and a `location_duplicate` response surfaces the existing location instead of a raw error, mirroring the dish-level duplicate-collapse pattern.

**Added by this amendment (Requirement 8, 9):**
- **Repository property test** (`apps/api/src/services/foodLog/__tests__/foodItemLogHistory.prop.test.ts`): `fast-check` (>=100 runs) against pg-mem, validating Property 10 (`getAllLogsForUser` returns exactly one User's rows, correctly ordered, with correct restaurant/location name resolution per row, and reflects a deletion on the next read) and Property 11 (`getLogsForUserAtScope` never leaks a row from a different restaurant/location or a different User, including the specific case of the same User having logs at two different restaurants simultaneously).
- **Route integration tests** (added to the existing `apps/api/src/services/foodLog/__tests__/routes.test.ts`): `GET /me/food-item-logs` returns the full cross-restaurant list and an empty list for a User with no logs; `GET /experiences/:id/food-item-logs/mine` and `GET /locations/:id/food-item-logs/mine` return only that scope's logs and an empty list for an unresolved/logless id; all three reject an unauthenticated request with `401 unauthorized`.
- **Mobile component tests**: `MyFoodHistoryScreen.test.tsx` (new) — mocking only the network/query layer, asserting the full cross-restaurant list renders with dish name/restaurant name/date/rating/note per row, the delete action removes exactly the targeted row and calls `DELETE /me/food-items/:foodItemId/logs/:logId` with that row's ids, and the "Not currently on menu" label renders per Requirement 8.5. `RestaurantFoodLogsSheet.test.tsx` (new) — the same assertions scoped to one `experienceId`/`locationId`, plus an assertion that a log belonging to a different restaurant (present in a shared fixture alongside the target restaurant's logs) never renders in this scoped view (Property 11). Interaction tests added to `ExperienceDetailScreen`'s existing test file asserting the new "My logged items here" button opens `RestaurantFoodLogsSheet` scoped to the current `experienceId`.
- **Sort/filter/search unit and property tests** (added to `MyFoodHistoryScreen.test.tsx` and `RestaurantFoodLogsSheet.test.tsx`, plus a pure-function property test at `apps/mobile/src/screens/catalog/__tests__/foodHistoryFilters.prop.test.ts` if the derivation pipeline is extracted to a standalone pure function per this repo's "pure modules are property-testable" convention): unit tests driving each sort option against a fixture with mixed/`null` ratings and asserting the exact resulting order (including the `null`-sorts-last rule in both directions); a restaurant-filter interaction test selecting one then a second restaurant and asserting the displayed set narrows/widens correctly; a search-input interaction test asserting case-insensitive substring matching against `foodItemName`/`restaurantName`/`locationName` (and `foodItemName`-only for the scoped sheet); and a composition test that applies a filter, then a search term, then a sort change, asserting all three remain active simultaneously (Property 12) rather than the later action clearing the earlier ones. The `fast-check` property test (>=100 runs, tagged `// Feature: food-item-logging, Property 12: <text>`) generates random row arrays and random control-state combinations, asserting the displayed set always equals the pure-function intersection of the three narrowing criteria and that two runs with identical inputs produce byte-identical output order (determinism).
