# Design Document

## Overview

Friend Food Ratings is a read projection over the existing `food_item_logs` stream. It adds **no table, no migration and no persisted state**. It adds a new backend service folder, `apps/api/src/services/friendFoodRatings/`, and two Phase 1 mobile surfaces (a Highlights row on the friend profile Overview and a read-only Friend Food History screen), then inline Social_Proof on the menu and the food item picker (Phase 2).

**Visibility model.** Friend visibility of food ratings is always on for accepted Friends: no opt-out, no launch notice, no disclosure copy (fixed product decision; see requirements.md Introduction). Food ratings follow the same model as ride/restaurant ratings (`friend-stats-viewing` R4.3/R4.4): accepted Friends only, notes private unless a future shareable flag exists. A future per-user control would be an additive follow-up (a new migration plus a filter in the same queries) and is out of scope.

### Key design decisions

1. **A new sibling service, not growth of `foodLog/`.** `foodLog/` is owner-scoped end to end (`WHERE user_id = $1` on every read). The friend read has a different authorization rule (`assertOwnerOrFriend`), a different DTO family (no `note`), and an aggregation of its own. Putting it in `foodLog/` would blur the "everything here is the caller's own data" property that makes that folder easy to audit. The new service takes `pool` for `assertOwnerOrFriend`, exactly as `tracking/friendCompletions/` does.
2. **Aggregate in SQL, mirror in a pure module.** The per-dish `AVG/COUNT/MAX` runs in Postgres (one row per dish, paginated by keyset). A pure in-memory reference (`dishAggregate.ts`) implements the same aggregation, ordering, cursor codec and LIKE-escaping so fast-check properties can run against it and a model-based pg-mem test pins that the real SQL agrees with it.
3. **Notes are excluded structurally, not by filtering.** The friend SQL never names `note` and never uses a wildcard (`fil.*`, `food_item_logs.*`, bare `SELECT *` or `RETURNING *`) over `food_item_logs`, which would carry `note` implicitly (a source-level test per repo, R5.2); the friend DTOs have no `note` field, and a property test serializes every friend payload for generated logs containing a sentinel note and asserts the sentinel never appears (analogue of `shareableNoteDisclosure.prop.test.ts`).
4. **No persistence.** With visibility always on there is nothing to store: no settings table, no notice flag, no migration. The service is read-only, which is itself asserted structurally (Requirement 19.3).
5. **Only "no dishes yet" versus "not a friend".** A Viewer who may read the target either gets rows or an empty page (`200`, `items: []`); a Viewer who may not gets the existing `403 profile_forbidden`. There is no third "private" outcome.
6. **Unrated-only dishes appear in the list, never in Highlights or Social_Proof.** The user's goal is "see all of someone's food logs"; repeat counts for unrated dishes are part of that. They show as "Not rated" (`averageRating: null`). Highlights and inline proof are ratings-only surfaces.
7. **Highlights threshold is 1 rated log, not 2** (`FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS`). The own-stats minimum of 2 (`FOOD_STATS_MIN_RATED_LOGS`) protects a personal "best of" ranking from a single outlier. A friend wants the opposite signal: most restaurant dishes are eaten once. It also discloses nothing the full list does not, since the list shows every dish. Highlights are not a separate endpoint: they are the list route with `sort=highest_rated&limit=5&minRatedLogs=1`.
8. **Pagination is keyset, matching the discovery lists.** `foodLists/repo.ts` already uses an opaque base64 JSON cursor with `limit + 1` fetch. The friend list does the same, with a cursor carrying the sort's key values and the dish id. Keyset keeps the contract uniform with the other paginated lists and avoids offset drift while a friend logs.
9. **Batch endpoint resolves the whole scope server-side.** `GET /experiences/:id/food-item-logs/friends` (and `/locations/:id/...`) takes no list of dish ids: the server joins the viewer's friend set to the logs of that scope's dishes in one query. This removes any request-size cap to abuse and cannot drift from the menu the client is showing. It parallels the existing `.../food-item-logs/mine` routes. `GET /experiences/:id/food-items` stays public and untouched.
10. **The stats path is left alone on purpose.** `GET /me/stats/summary?for=<friend>` already returns dish names, average ratings and restaurant names (`foodActivity`). With visibility always on that is intended and consistent, so no projection is added and the existing friend-stats behavior is untouched. The stats payload contains no Log note (no stats query selects one); a source-level test pins that (task 3.5).
11. **Friend History reuses presentation, not data plumbing.** `MyFoodHistoryScreen` is wired to an unpaginated `GET /me/food-item-logs`, client-side filtering and mutating actions. Its search field, sort chips and filter chips are extracted into shared presentational components; `FriendFoodHistoryScreen` is a thin screen that composes them with server-driven sort, filter and cursor pagination. Branching the existing 480-line component on a route param was rejected because every mutation path would need guarding.

### Open Questions / Assumptions

Product decisions are fixed. These are design-level defaults. **No open product questions remain.**

- **A1 — Friend stats unchanged (intentional).** Friends keep seeing `foodActivity` through the existing friend stats read. Nothing is narrowed, nothing is documented as an exception, and no `stats-experience-redesign` or `friend-stats-viewing` requirement is touched.
- **A2 — Aggregation.** The friend sees the *average* of rated logs plus counts; "latest rating" is not shown. Matches the stats path and the user's chosen model.
- **A3 — Missing scope on the batch read** returns `{ items: [] }`, matching the `.../mine` routes which also do not probe existence.
- **A4 — Deactivated experiences and off-menu dishes** are included, matching My Food History.
- **A5 — `GET /experiences/:id/food-item-logs/friends` bounds** are response-side (`FRIEND_FOOD_BATCH_MAX_ROWS`), not request-side, because the request carries no dish ids.
- **A6 — No new index and no migration.** `food_item_logs` has no index leading on `food_item_id`; the friend-first batch plan does not need one, and the list is served by `food_item_logs_user_idx`. A supporting index is not wanted now; any index is a later additive migration gated on an `EXPLAIN` against a realistic seed (Neon ~1 GB).
- **A7 — The Highlights request also runs the scopes query (decision: accept).** The Highlights read is the first page of the list route, so it also executes `listScopes` (up to `FRIEND_FOOD_SCOPES_MAX = 200` rows the Overview row does not use). Decision: **accept it**. It is two indexed, request-time queries per friend profile view (the second is a bounded `GROUP BY` over one user's logs via `food_item_logs_user_idx`), which fits the free tier, and it avoids a new request parameter, a new `scopes` nullability rule on the first page and an extra requirement. No include-scopes flag is added.

## Architecture

```
                         ┌──────────────────────────────────────────────┐
 Mobile                  │ Friend profile Overview ── Highlights row    │
 (YouAndCrewStack)       │        │ "See all"                           │
                         │        ▼                                      │
                         │ FriendFoodHistoryScreen (read-only)          │
                         │ MenuScreen / FoodItemPickerModal (Phase 2)   │
                         └───────────────┬──────────────────────────────┘
                                         │ HTTPS, session-authenticated
 API (Fastify)                           ▼
  GET  /users/:userId/food-ratings                     ┐ friendFoodRatingRoutes
  GET  /experiences/:id/food-item-logs/friends  (P2)   │ assertOwnerOrFriend (list only)
  GET  /locations/:id/food-item-logs/friends    (P2)   ┘

 Data (all existing tables, read-only)
  food_item_logs ──┐
  food_items ──────┼──► per-dish aggregate (AVG rated, COUNT, MAX visited_on)
  experiences ─────┤
  user_submitted_locations ┘
  friendships ──► audience (batch) / authorization (list)
  profiles ──► friend display name + avatar (batch)
```

Access rules, one line each:

- **List:** the viewer may read the target iff `viewer == target` or a `friendships` row exists.
- **Batch:** the audience is the viewer's own `friendships` rows; no friend id is accepted.
- **Never selected:** `food_item_logs.note`, `logged_at` (not selected, not aggregated, not an ordering or cursor key: the `recent` order and cursor use `latest_visited_on` and `food_item_id` only, so no decoded `nextCursor` carries a Log timestamp, R5.3, R6.1), `user_tz`, log `id`.

## Components and Interfaces

### Shared contracts (`packages/shared`)

**`packages/shared/src/constants/friendFoodRatings.ts`** (new; barrelled from `src/index.ts`) — see Configuration & Constants.

**`packages/shared/src/dto/FriendFoodRatings.ts`** (new; barrelled in `dto/index.ts` and `src/index.ts`):

```typescript
import type { Park } from '../enums.js';
import type { AvatarPresetId } from '../constants/avatarPresets.js';

export type FriendFoodSort = 'highest_rated' | 'recent' | 'most_logged';
export type FoodScopeKind = 'experience' | 'location';

/** One row per distinct dish. No note, no log id, no per-log timestamps (R5). */
export interface FriendDishRatingDTO {
  readonly foodItemId: string;
  readonly foodItemName: string;
  readonly scopeKind: FoodScopeKind;
  readonly scopeId: string;
  readonly scopeName: string;
  /** COALESCE(experiences.park, user_submitted_locations.park); locations always have one, null only for a park-less Experience (R4.6). */
  readonly park: Park | null;
  /** Continuous mean of rated logs, in [1,10]; null when the dish has no rated log (R4.5, R16). */
  readonly averageRating: number | null;
  readonly ratedLogCount: number;
  readonly logCount: number;
  /** YYYY-MM-DD */
  readonly latestVisitedOn: string;
}

export interface FriendFoodScopeDTO {
  readonly kind: FoodScopeKind;
  readonly id: string;
  readonly name: string;
  /** Same COALESCE as FriendDishRatingDTO.park (R4.6). */
  readonly park: Park | null;
  readonly dishCount: number;
}

export interface FriendFoodRatingsPageDTO {
  readonly items: readonly FriendDishRatingDTO[];
  readonly nextCursor: string | null;
  /** Present (possibly empty) on the first page; null on continuation pages (R6.8, R13.1). */
  readonly scopes: readonly FriendFoodScopeDTO[] | null;
}

export interface FriendDishFriendRatingDTO {
  readonly friendId: string;
  readonly displayName: string;
  readonly avatarPreset: AvatarPresetId | null;
  readonly averageRating: number;          // always non-null here: rated logs only
  readonly ratedLogCount: number;
  readonly logCount: number;
  readonly latestVisitedOn: string;
}

export interface FriendDishSocialProofDTO {
  readonly foodItemId: string;
  /** All Friends who rated this dish (not capped by `friends`). */
  readonly friendCount: number;
  /** Mean of the per-friend averages, continuous (R14.4, R16). */
  readonly friendsAverageRating: number;
  /** At most FRIEND_FOOD_INLINE_MAX_FRIENDS, ordered per R14.4. */
  readonly friends: readonly FriendDishFriendRatingDTO[];
}

export interface FriendFoodSocialProofResponseDTO {
  readonly items: readonly FriendDishSocialProofDTO[];
}
```

**`packages/shared/src/schemas/FriendFoodRatings.ts`** (new; `.strict()`, barrelled in `schemas/index.ts`):

```typescript
export const friendFoodRatingsQuerySchema = z
  .object({
    sort: z.enum(FRIEND_FOOD_SORTS).default('recent'),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(FRIEND_FOOD_PAGE_SIZE_MAX).default(FRIEND_FOOD_PAGE_SIZE_DEFAULT),
    experienceId: uuidSchema.optional(),
    locationId: uuidSchema.optional(),
    park: z.enum(PARKS).optional(),
    q: z.string().trim().min(1).max(FRIEND_FOOD_SEARCH_MAX_LENGTH).optional(),
    minRatedLogs: z.coerce.number().int().min(0).max(10).default(0),
  })
  .strict()
  .refine((v) => !(v.experienceId && v.locationId), {
    message: 'Specify at most one of experienceId or locationId',
  });
```

DTOs and the Zod schema are re-exported from all three barrels (`src/index.ts`, `dto/index.ts`, `schemas/index.ts`). **Error codes:** no new `ErrorCode`. `profile_forbidden` (403), `validation_failed` (400) and `unauthorized` (401) cover every path (see Error Handling). The mobile app imports these DTOs from `@dwt/shared`; they are **not** hand-mirrored (unlike the stats types), because food-log DTOs are already imported that way.

### Backend — `apps/api/src/services/friendFoodRatings/`

**`dishAggregate.ts`** — pure, no I/O (the property-test surface):

```typescript
export interface DishLogInput {
  readonly foodItemId: string;
  readonly rating: number | null;      // 1..10 or null
  readonly visitedOn: string;          // YYYY-MM-DD (no logged_at: it is never part of an order or cursor, R5.3)
}
export interface DishAggregate {
  readonly foodItemId: string;
  readonly averageRating: number | null;   // continuous mean of non-null ratings
  readonly ratedLogCount: number;
  readonly logCount: number;
  readonly latestVisitedOn: string;
}

/** Reference model of the SQL: one aggregate per distinct foodItemId. */
export function aggregateByDish(logs: readonly DishLogInput[]): readonly DishAggregate[];

/** The three strict total orders of R6.1. Returns negative/zero/positive. */
export function compareDishes(sort: FriendFoodSort): (a: DishAggregate, b: DishAggregate) => number;

/**
 * Opaque keyset cursor: base64 JSON { v: 1, s: sort, a: string, b: string | null, id: string }.
 * `b` is null for `recent` (single secondary key). The cursor never carries a Log timestamp (R5.3):
 * the only date it can hold is a `latest_visited_on` already present in the payload.
 */
export function encodeCursor(sort: FriendFoodSort, a: string, b: string | null, id: string): string;
export function decodeCursor(cursor: string, expectedSort: FriendFoodSort): { a: string; b: string | null; id: string }; // throws AppError('validation_failed')

/** Escape %, _ and \ so a search term matches literally; returns '%' + escaped lower(term) + '%'. */
export function toLikeContainsPattern(term: string): string;

/** Group raw per-friend-per-dish rows into the Phase 2 DTO shape (R14.4). */
export function groupSocialProof(
  rows: readonly SocialProofRow[],   // ordered by food_item_id first (see the batch SQL)
  maxFriends: number,
  capped: boolean,                   // true when the repo's LIMIT cap + 1 query returned more than the cap
): readonly FriendDishSocialProofDTO[];   // when capped, the last dish's rows are dropped: no partial dish
```

**`repo.ts`** — `createFriendFoodRatingsRepo(pool: DbPool): FriendFoodRatingsRepo`:

```typescript
export interface ListDishesInput {
  readonly targetUserId: string;
  readonly sort: FriendFoodSort;
  readonly limit: number;
  readonly cursor?: { a: string; b: string | null; id: string };
  readonly experienceId?: string;
  readonly locationId?: string;
  readonly park?: Park;
  readonly likePattern?: string;          // from toLikeContainsPattern
  readonly minRatedLogs: number;
}
export interface FriendFoodRatingsRepo {
  listDishes(input: ListDishesInput): Promise<{ rows: readonly DishRow[]; hasMore: boolean }>;
  listScopes(targetUserId: string): Promise<readonly FriendFoodScopeDTO[]>;
  listFriendSocialProof(
    viewerId: string,
    scope: { kind: 'experience' | 'location'; id: string },
  ): Promise<{ rows: readonly SocialProofRow[]; capped: boolean }>;   // queries cap + 1, returns at most cap rows; capped = the extra row existed
}
```

**`routes.ts`** — `friendFoodRatingRoutes({ repo, pool, requireSession }): FastifyPluginAsync`. Naming follows the repo's conventions: `/users/:userId/...` for friend-gated target reads (`/users/:userId/completions`, `/users/:userId/pin-showcase`, `/users/:userId/profile`) and `.../food-item-logs/<audience>` beside the existing `.../food-item-logs/mine`.

| Method and path | Auth | Gate | Result |
| --- | --- | --- | --- |
| `GET /users/:userId/food-ratings` | `requireSession` | `assertOwnerOrFriend(pool, requester, :userId)` before any Log read | `FriendFoodRatingsPageDTO` |
| `GET /experiences/:id/food-item-logs/friends` (P2) | `requireSession` | audience = viewer's `friendships` | `FriendFoodSocialProofResponseDTO` |
| `GET /locations/:id/food-item-logs/friends` (P2) | `requireSession` | same | same |

List handler order: `requireSession` (preHandler) → parse `:userId` with `uuidSchema` → parse query with `friendFoodRatingsQuerySchema` → `assertOwnerOrFriend` → decode cursor (validated against `sort`; throws `validation_failed`) → `repo.listDishes({ ... })` → on first page also `repo.listScopes(target)` → map rows to DTO (continuous `averageRating`; `Number(...)`, never rounded). Parameter validation precedes the authorization call only for the path id (as `friendCompletions` does); a malformed query is a 400 even for a non-friend, but no Log is read in either case. The cursor's *contents* are decoded only after the gate (R6.7), so a bad or wrong-sort cursor is a `400` for the Owner and for a Friend, while a non-friend still gets `403 profile_forbidden` and learns nothing about the Target's Logs; failing closed on authorization first is deliberate. Tests that exercise bad cursors therefore must use the Owner or a Friend as the Viewer.

**Wiring** (`apps/api/src/composeServices.ts`, `apps/api/src/server.ts`), mirroring the pattern of every opt-in service:

```typescript
const friendFoodRatingsRepo = createFriendFoodRatingsRepo(pool);
// BuildServerServices object literal:
friendFoodRatings: { repo: friendFoodRatingsRepo, pool, requireSession: sessionMiddleware },
```

`server.ts` gains `friendFoodRatings?: FriendFoodRatingRoutesOptions` on `BuildServerServices` and an `if (services.friendFoodRatings !== undefined) { void app.register(friendFoodRatingRoutes(services.friendFoodRatings)); }` block. Because the entry is optional, omitting it from `composeServices.ts` would silently drop the routes while every privately-built Fastify test stays green; a **wiring test** (task 3.6, extended in task 7.3) therefore asserts the production registration (see Testing Strategy). The stats service is **not** touched.

### Backend — Stats (no change)

`apps/api/src/services/stats/` is not modified. `GET /me/stats/summary?for=<friend>` keeps returning `foodActivity` exactly as today (A1). A structural test (`stats/__tests__/foodActivity.noNote.test.ts`, task 3.5) pins the one guarantee this spec relies on: no SQL statement that builds `foodActivity` in `stats/repo.ts` (any statement referencing `food_item_logs`) contains the identifier `note`, `fil.*`, `food_item_logs.*`, or a bare `SELECT *` / `RETURNING *`, and `FoodActivityStatistics` has no note-bearing field. The same test deliberately leaves the payload's two personal-record visit dates (`mostAdventurousDay.date`, `dishMarathonRecord.date`) alone: they are existing, intentional friend-visible stats data, and the "no dates beyond `latestVisitedOn`" rule (R5.3) is scoped to the new routes only.

### Mobile (`apps/mobile/src`)

**Query layer — `hooks/useFriendFoodRatings.ts`** (new): `apiRequest<T>(method, path)` wrappers and keys.

```typescript
export const friendFoodRatingsKeys = {
  all: ['friend-food-ratings'] as const,
  highlights: (friendId: string) => ['friend-food-ratings', friendId, 'highlights'] as const,
  list: (friendId: string, params: FriendFoodListParams) => ['friend-food-ratings', friendId, 'list', params] as const,
  socialProof: (kind: FoodScopeKind, id: string) => ['friend-food-social-proof', kind, id] as const,
};
```

- `useFriendFoodHighlights(friendId)` — `useQuery`, `GET /users/{id}/food-ratings?sort=highest_rated&limit=5&minRatedLogs=1`, `staleTime` 60 s, `retry` via `retryUnlessForbidden`. That helper is currently a module-private function at `apps/mobile/src/hooks/useFriendProfile.ts:65`; the implementation adds `export` to it in place (no behavior change) and imports it from `./useFriendProfile`, so `useFriendProfile.ts` is a touched file (task 4.1).
- `useFriendFoodList(friendId, params)` — `useInfiniteQuery`, `getNextPageParam: (p) => p.nextCursor ?? undefined`, same retry rule.
- `useFriendFoodSocialProof(kind, id)` (Phase 2) — `useQuery`, one request per scope per screen, `staleTime` 5 min, `retry: false`; failure yields `undefined` data and no UI.

**`screens/catalog/foodHistory/FoodHistoryControls.tsx`** (extracted from `MyFoodHistoryScreen.tsx`): the search input (`food-history-search-input`, `food-history-clear-search`), the sort chip row (`sort-chip-<id>`), and the filter chip row (`restaurant-filter-all`, `restaurant-filter-<name>`). Presentational and prop-driven (`sortOptions`, `sort`, `onSortChange`, `searchText`, `onSearchChange`, `filterChips`, `selectedFilterIds`, `onToggleFilter`). `MyFoodHistoryScreen` is refactored to consume it with identical test IDs, labels and behavior; `MyFoodHistoryScreen.test.tsx` and `foodHistoryFilters.prop.test.ts` must pass unchanged.

**`screens/friends/FriendFoodHistoryScreen.tsx`** (new; route `FriendFoodHistory: { friendId: string; displayName: string }` added to `YouAndCrewStackParamList` and registered in `YouAndCrewStack.tsx`). Composes `ScreenContainer`, `GradientHeader` (title "<name>'s Food"), `FoodHistoryControls` (sort options Highest rated / Most recent / Most logged; filter chips from `scopes` plus park chips from the distinct `scopes[].park`), and a `FlatList` over the flattened pages with `onEndReached` → `fetchNextPage`, a footer `ActivityIndicator`, `extraData={t.scheme}`, and `testID="friend-food-history-screen"`. Row component `FriendDishRow` renders name, scope, rating text, count text and date, and exposes one `accessibilityLabel` from `describeDishRating` (R17.3); the row has no press action. No delete/rating/note controls. Search text is debounced `FRIEND_FOOD_SEARCH_DEBOUNCE_MS` before it becomes a request param; any change to sort/filter/search resets to page one. **Failed load (R12.9, mirrors the Highlights row, R11.4):** a non-`profile_forbidden` error is classified from the `useInfiniteQuery` result: when the first page fails (`isError` with no loaded pages) the list is replaced by a full-area error state (`testID="friend-food-history-error"`, `accessibilityRole="alert"`, the copy below as text with a text label beside any icon) and a retry control (`testID="friend-food-history-retry"`, `accessibilityRole="button"`, `accessibilityLabel="Retry loading {name}'s dishes"`) that calls `refetch()`; when a subsequent page fails (`isFetchNextPageError`, available in the installed `@tanstack/react-query` v5) the already-loaded rows stay rendered and the footer shows the page-error text with a retry control (`testID="friend-food-history-retry-page"`, `accessibilityRole="button"`, `accessibilityLabel="Retry loading more dishes"`) that calls `fetchNextPage()`, re-issuing the same `cursor`. The `FlatList`'s `onEndReached` does not auto-fire `fetchNextPage` while the page error is showing (so a failed page is not retried in a loop); `profile_forbidden` keeps the existing forbidden treatment with no retry (R12.7), because `retryUnlessForbidden` is the query's retry rule.

**`screens/friends/FriendFoodHighlightsRow.tsx`** (new): rendered inside `OverviewMode` of `FriendProfileScreen.tsx` below the existing ratings block. States: loading, error with retry, empty, cards. `profile_forbidden` is propagated to the screen's existing forbidden handling. `testID="friend-food-highlights"`; "See all" is `friend-food-see-all`, always shown, and calls `navigation.navigate('FriendFoodHistory', { friendId, displayName })`.

**`screens/friends/foodRatingFormat.ts`** (new, pure; the single formatting/labelling source):

```typescript
/** Display-only. One decimal place. Never fed back into any computation (R16.2). */
export function formatAverageRating(avg: number): string;                 // 8.333… -> "8.3"
export function describeDishRating(d: DishRatingLabelInput): string;      // a11y label (R17.3)
export function describeSocialProof(p: SocialProofLabelInput): string;    // a11y label (R17.3)
export function logCountText(n: number): string;                          // "Logged 3 times"
```

**Phase 2 — `screens/catalog/FriendDishSocialProof.tsx`** (new): the chip rendered under a dish name in `MenuScreen.tsx` rows and `FoodItemPickerModal.tsx` rows, given the `FriendDishSocialProofDTO` looked up by `foodItemId` from a single `Map` built once per screen from `useFriendFoodSocialProof`. It renders up to three avatars or initials, text "Sam and 2 friends · 8.5/10" and `+N` overflow, with one `accessibilityLabel` from `describeSocialProof`. `MenuScreen` already queries `['experience-food-items', experienceId]`; the social-proof query is separate and independent so a failure never affects the menu. `FoodItemPickerModal`'s per-row `useQuery(['food-item-logs', item.id])` for the viewer's own repeat count is the existing anti-pattern and is **not** extended.

**Copy** (final strings):

| Where | String |
| --- | --- |
| Empty | "{name} hasn't logged any dishes yet." |
| Empty highlights | "{name} hasn't rated any dishes yet." |
| No matches | "No dishes match your search or filters." |
| Full-list load failed (first page) | "Couldn't load {name}'s dishes." with a "Retry" control |
| Full-list next page failed | "Couldn't load more dishes." with a "Retry" control |

There is no setting label, helper text, notice title/body or "keeps private" string: those were withdrawn with the opt-out.

## Data Models

### No migration

This feature adds **no migration** (decision A6). It reads existing tables only (`food_item_logs`, `food_items`, `experiences`, `user_submitted_locations`, `friendships`, `profiles`) and writes nothing. No new index is added: the single-friend list uses `food_item_logs_user_idx (user_id, visited_on DESC, logged_at DESC)` and the batch read uses `food_item_logs_user_item_idx (user_id, food_item_id, ...)`, both already present from `0040`/`0043`. A later index, if an `EXPLAIN` against a realistic seed shows a need, would be a new additive `NNNN_name.sql` with a `migrationNNNN.test.ts`.

### Per-dish aggregation SQL (`repo.ts` `listDishes`)

Parameters: `$1` target user id, `$2` experience id or null, `$3` location id or null, `$4` park or null, `$5` LIKE pattern (already lower-cased and escaped) or null, `$6` `minRatedLogs`, then the cursor values and `LIMIT`. `AVG(smallint)` is exact `numeric` in Postgres; `COUNT(rating)` counts non-null ratings only, which is what makes unrated logs not contribute to the mean.

```sql
WITH dish AS (
  SELECT fi.id                                   AS food_item_id,
         fi.name                                 AS food_item_name,
         CASE WHEN fi.experience_id IS NOT NULL THEN 'experience' ELSE 'location' END AS scope_kind,
         COALESCE(fi.experience_id, fi.location_id) AS scope_id,
         COALESCE(e.name, usl.name)              AS scope_name,
         COALESCE(e.park, usl.park)              AS park,              -- usl.park is TEXT NOT NULL (0040); NULL only for a park-less Experience
         COUNT(*)::int                           AS log_count,
         COUNT(fil.rating)::int                  AS rated_count,
         AVG(fil.rating)                         AS avg_rating,        -- numeric; NULL if no rated log
         MAX(fil.visited_on)                     AS latest_visited_on
    FROM food_item_logs fil
    JOIN food_items fi                 ON fi.id  = fil.food_item_id
    LEFT JOIN experiences e            ON e.id   = fi.experience_id
    LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
   WHERE fil.user_id = $1
     AND ($2::uuid IS NULL OR fi.experience_id = $2::uuid)
     AND ($3::uuid IS NULL OR fi.location_id   = $3::uuid)
     AND ($4::text IS NULL OR COALESCE(e.park, usl.park) = $4::text)   -- includes location-scoped dishes (R6.4)
     AND ($5::text IS NULL OR lower(fi.name) LIKE $5::text ESCAPE '\')
   GROUP BY fi.id, fi.name, fi.experience_id, fi.location_id, e.name, usl.name, e.park, usl.park
  HAVING COUNT(fil.rating) >= $6::int
), keyed AS (
  SELECT dish.*, COALESCE(avg_rating, 0) AS rating_key        -- ratings are >= 1, so 0 sorts unrated last
    FROM dish
)
SELECT food_item_id, food_item_name, scope_kind, scope_id, scope_name, park,
       log_count, rated_count,
       avg_rating::float8                       AS average_rating,
       to_char(latest_visited_on, 'YYYY-MM-DD') AS latest_visited_on,
       /* lossless cursor key text, per sort: */ {{CURSOR_A}} AS cursor_a, {{CURSOR_B}} AS cursor_b
  FROM keyed
 WHERE {{KEYSET}}
 ORDER BY {{ORDER_BY}}
 LIMIT $N                                              -- limit + 1; the extra row sets hasMore
```

`{{CURSOR_A}}`, `{{CURSOR_B}}`, `{{KEYSET}}` and `{{ORDER_BY}}` come from a closed constant map keyed by `FriendFoodSort`; no user text is ever interpolated, only values are parameterised.

| `sort` | `a` (DESC) | `b` (DESC) | tie-break | cursor casts |
| --- | --- | --- | --- | --- |
| `highest_rated` | `rating_key` | `rated_count` | `food_item_id` ASC | `numeric`, `int` |
| `recent` | `latest_visited_on` | none (`b` is null; single-key predicate below) | `food_item_id` ASC | `date` |
| `most_logged` | `log_count` | `latest_visited_on` | `food_item_id` ASC | `int`, `date` |

Keyset predicate (cursor values `$A`, `$B`, `$ID` follow `$6`; `{{a}}`, `{{b}}` substituted from the table above, with `::cast` as listed), `TRUE` when there is no cursor:

```sql
( {{a}} <  $A::{{castA}} )
OR ( {{a}} =  $A::{{castA}} AND {{b}} <  $B::{{castB}} )
OR ( {{a}} =  $A::{{castA}} AND {{b}} =  $B::{{castB}} AND food_item_id > $ID::uuid )
```

For `recent` (one DESC key, then the id) the predicate has no `b` term and takes no `$B`:

```sql
( latest_visited_on <  $A::date )
OR ( latest_visited_on =  $A::date AND food_item_id > $ID::uuid )
```

`ORDER BY` for `recent` is `latest_visited_on DESC, food_item_id ASC`. `latest_visited_on` plus `food_item_id` is already a strict total order (one row per dish), so no `logged_at` tie-break is needed, and the cursor can never carry a Log timestamp (R5.3, R6.1).

Cursor key text is produced in SQL (`rating_key::text`, `latest_visited_on::text`, `rated_count::text`, `log_count::text`; `CURSOR_B` for `recent` is `NULL::text`) so numeric keys round-trip exactly; the pure module only base64-encodes `{ v: 1, s, a, b, id }` and rejects a cursor whose `s` differs from the requested `sort`, or whose `b` presence does not match the sort (`b` must be null for `recent` and a non-empty string for the other two). `decodeCursor` also validates `a`/`b` against the sort's expected format (numeric, integer or `YYYY-MM-DD`), so a tampered cursor is a `400` and never reaches the SQL cast.

### Scopes SQL (`listScopes`, first page only)

Parameters: `$1` target user id, `$2` `FRIEND_FOOD_SCOPES_MAX`.

```sql
SELECT CASE WHEN fi.experience_id IS NOT NULL THEN 'experience' ELSE 'location' END AS kind,
       COALESCE(fi.experience_id, fi.location_id) AS id,
       COALESCE(e.name, usl.name)                 AS name,
       COALESCE(e.park, usl.park)                 AS park,   -- location parks are mandatory (0040), so chips cover locations (R6.8, R12.3)
       COUNT(DISTINCT fi.id)::int                 AS dish_count
  FROM food_item_logs fil
  JOIN food_items fi                 ON fi.id  = fil.food_item_id
  LEFT JOIN experiences e            ON e.id   = fi.experience_id
  LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
 WHERE fil.user_id = $1
 GROUP BY fi.experience_id, fi.location_id, e.name, usl.name, e.park, usl.park
 ORDER BY lower(COALESCE(e.name, usl.name)) ASC, COALESCE(fi.experience_id, fi.location_id) ASC
 LIMIT $2;
```

An Owner or Friend with no Logs yields `[]`, which the route returns as `scopes: []` on the first page (R13.1).

### Batch social-proof SQL (`listFriendSocialProof`, Phase 2)

Parameters: `$1` viewer id, `$2` scope id, `$3` row cap. `{{SCOPE_COL}}` is `fi.experience_id` or `fi.location_id`, chosen from the closed `kind` enum. One statement for the whole scope; friend-first so the plan probes `food_item_logs_user_item_idx (user_id, food_item_id, ...)`.

```sql
WITH friend_ids AS (
  SELECT CASE WHEN user_lo_id = $1 THEN user_hi_id ELSE user_lo_id END AS friend_id
    FROM friendships
   WHERE user_lo_id = $1 OR user_hi_id = $1
), per_friend AS (
  SELECT fil.food_item_id,
         fil.user_id                         AS friend_id,
         COUNT(*)::int                       AS log_count,
         COUNT(fil.rating)::int              AS rated_count,
         AVG(fil.rating)                     AS avg_rating,
         MAX(fil.visited_on)                 AS latest_visited_on
    FROM food_item_logs fil
    JOIN food_items fi   ON fi.id = fil.food_item_id
    JOIN friend_ids f    ON f.friend_id = fil.user_id
   WHERE {{SCOPE_COL}} = $2::uuid
   GROUP BY fil.food_item_id, fil.user_id
  HAVING COUNT(fil.rating) >= 1                                                    -- ratings-only (R14.6)
)
SELECT pf.food_item_id, pf.friend_id, p.display_name, p.avatar_preset,
       pf.log_count, pf.rated_count,
       pf.avg_rating::float8                         AS average_rating,
       to_char(pf.latest_visited_on, 'YYYY-MM-DD')   AS latest_visited_on
  FROM per_friend pf
  JOIN profiles p ON p.user_id = pf.friend_id
 ORDER BY pf.food_item_id ASC, pf.avg_rating DESC, pf.latest_visited_on DESC, pf.friend_id ASC
 LIMIT $3;                                                                         -- FRIEND_FOOD_BATCH_MAX_ROWS + 1 (the extra row signals the cap was hit)
```

`groupSocialProof` folds the ordered rows into one `FriendDishSocialProofDTO` per dish: `friendCount` = number of rows for the dish, `friendsAverageRating` = mean of the rows' `average_rating`, `friends` = the first `FRIEND_FOOD_INLINE_MAX_FRIENDS` rows (already in the R14.4 order). Per-friend aggregates are computed by the same expressions as `listDishes`, which is what makes Property 8 hold. The viewer is never in `friend_ids`, so their own logs are excluded. Because the statement orders by `food_item_id` first and applies `LIMIT`, a row cap that bites can cut the last dish's friend rows in half, which would give that dish a wrong `friendCount` and average. The repo therefore fetches `FRIEND_FOOD_BATCH_MAX_ROWS + 1` rows (`$3` is cap + 1); when more than the cap come back, the cap was hit, so `groupSocialProof` is given `capped = true`, drops every row of the final (possibly partial) dish, and the response never contains a dish whose friend set is incomplete. With a 5000-row cap and an audience of one viewer's friends this is not reachable in practice, but the guard keeps `friendCount` correct instead of relying on that.

### Statements deliberately not written

There is no statement that selects `note` (directly or through `fil.*`, `food_item_logs.*`, a bare `SELECT *` or `RETURNING *`; pinned by the source-level guard in task 2.5), no join from the friend reads to `food_lists_items`, and no `INSERT`, `UPDATE`, `DELETE` or DDL anywhere in this feature.

## Configuration & Constants

All constants are exported from `packages/shared/src/constants/friendFoodRatings.ts`. There are **no new environment variables**, no new secrets and no external base URLs.

| Constant | Default | Purpose |
| --- | --- | --- |
| `FRIEND_FOOD_PAGE_SIZE_DEFAULT` | `20` | Default `limit` of the list route. |
| `FRIEND_FOOD_PAGE_SIZE_MAX` | `50` | Maximum `limit`; same cap as `/locations/suggest`. |
| `FRIEND_FOOD_HIGHLIGHT_COUNT` | `5` | Dishes in the profile Highlights row (the `limit` the mobile read sends). |
| `FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS` | `1` | `minRatedLogs` the Highlights read sends. Lower than `FOOD_STATS_MIN_RATED_LOGS = 2` on purpose (Overview, decision 7). |
| `FRIEND_FOOD_SEARCH_MAX_LENGTH` | `100` | Maximum `q` length after trimming. |
| `FRIEND_FOOD_SEARCH_DEBOUNCE_MS` | `300` | Mobile debounce before a search becomes a request. |
| `FRIEND_FOOD_SCOPES_MAX` | `200` | Maximum scopes returned for filter chips. |
| `FRIEND_FOOD_INLINE_MAX_FRIENDS` | `3` | Friends shown per dish in Social_Proof. |
| `FRIEND_FOOD_BATCH_MAX_ROWS` | `5000` | Maximum per-friend-per-dish rows in the batch query. |
| `FRIEND_FOOD_SORTS` | `['highest_rated','recent','most_logged']` | Closed sort vocabulary. |
| Default sort | `recent` | Matches My Food History's default. |
| Highlights `staleTime` | `60_000` ms | Mobile cache. |
| Social-proof `staleTime` | `300_000` ms | Mobile cache. |
| Rating display | one decimal place | `formatAverageRating`; display-only. |

Hosting: no cron, worker, Redis or push is used (Requirement 19). All work is request-time SQL against Neon; the feature adds no persisted rows.

## External Interfaces

There is **no external or undocumented third-party API** in this feature. All integration points are internal; each fact below was verified at spec time against the repo paths and lines cited in the table. The table is self-contained: the "Inv." section letters are provenance only (they refer to a scratch investigation note that is not part of the repo and may not exist for a later executor), and nothing in this spec depends on that note. An executor should re-confirm any cited line number against the current source before relying on it.

| Fact relied on | Source (repo path:line, via Inv.) |
| --- | --- |
| `food_item_logs` columns: `rating` SMALLINT 1–10, `note`, `visited_on` DATE, `logged_at`, `user_tz`; no `experience_id`, no trip column | `apps/api/migrations/0040_food_item_logging.sql:74-85` (Inv. (a)) |
| `food_items` scope is `experience_id` XOR `location_id` | `0040_food_item_logging.sql:44-60` (CHECK `food_items_exactly_one_scope_chk` 56-59) (Inv. (a)) |
| Multiple logs per `(user, food_item)` allowed; stats uses `AVG(rating)` over non-null | `0040` has no unique constraint; `stats/repo.ts:628-648` (Inv. (a), (b)) |
| Join pattern for dish + restaurant/location name | `foodLog/repo.ts:574-595` (`getAllLogsForUser`) (Inv. (a)) |
| `FoodItemLogDTO`/`FoodItemLogWithContextDTO` carry `note` and must not be reused | `packages/shared/src/dto/FoodItemLog.ts:7-16, 36-41` (Inv. (a)) |
| Every existing food-log read is owner-keyed; `GET /experiences/:id/food-items` is public | `foodLog/routes.ts:95, 136, 274-300`; `repo.ts:480-507, 574, 597` (Inv. (a)) |
| `friendships` has no status column; canonical pair; hard delete on unfriend | `0001_init.sql` ~213-221; `friends/repo.ts:543-556`; `friends/routes.ts:273-276` (Inv. (c)) |
| `assertOwnerOrFriend` contract, `profile_forbidden` 403, no analytics on deny | `friends/ownerOrFriend.ts`; `shared/src/errors.ts:70, 331` (Inv. (c)) |
| Precedent: ratings visible to accepted friends with no opt-out, notes gated | `tracking/friendCompletions/repo.ts:109-155`; `0003_note_shareable.sql:15-17` (Inv. (c)) |
| Existing friend stats exposure of dish names, ratings and restaurant names (intentional, unchanged); no stats query selects a Log note | `stats/routes.ts:223-247, 265-297`; `stats/repo.ts:600-683` (the five `food_item_logs` statements select name, counts, rating aggregates, dates, restaurant names only); `shared/src/dto/Stats.ts:134-176`; test `stats/__tests__/routes.test.ts:1034-1070` (Inv. (b)) |
| `FOOD_STATS_MIN_RATED_LOGS = 2` (duplicated in mobile) | `shared/src/dto/Stats.ts:190`; `mobile/src/api/statsTypes.ts:280` (Inv. (b), (d)) |
| Friend profile modes `Overview | Coverage | Experiences | Compare`; route params | `FriendProfileScreen.tsx:210-214, 230` (Inv. (e)) |
| `MyFoodHistoryScreen` file, `CollectionStack` registration only, test IDs | `screens/catalog/MyFoodHistoryScreen.tsx`; `navigation/CollectionStack.tsx:9,28,43` (Inv. (e)) |
| `YouAndCrewStack` hosts `FriendProfile` beside `PinShowcase` (readOnly viewing precedent) | `navigation/YouAndCrewStack.tsx:19-27` (Inv. (e)) |
| Menu and picker hosts; per-row query anti-pattern | `screens/catalog/MenuScreen.tsx:105-113`; `FoodItemPickerModal.tsx:84-94` (Inv. (e)) |
| Keyset cursor convention (opaque base64 JSON, `limit + 1`) | `foodLists/routes.ts:70-74`; `foodLists/repo.ts:646-803` (Inv. (h)) |
| Indexes on `food_item_logs`: `(user_id, food_item_id, visited_on DESC, logged_at DESC)` and `(user_id, visited_on DESC, logged_at DESC)`; none leading on `food_item_id` | `0040:87-88`, `0043:15-16` (Inv. (h)) |
| `profiles.avatar_preset` is added by migration `0013_avatar_presets.sql`, not `0001_init.sql` (matters for the Phase 2 pg-mem test setup) | `apps/api/migrations/0013_avatar_presets.sql:31` |
| `experiences.park` is `NOT NULL` in `0001` and made nullable by `0004_disney_sources.sql:75` (matters for the repo test setup) | `apps/api/migrations/0004_disney_sources.sql:75` |
| Production registration pattern for opt-in services; structural wiring-test precedent | `server.ts` (`services.tracking?.friendCompletions` block ~613); `catalog/disney/__tests__/retirement.smoke.test.ts` reads `composeServices.ts` as text |
| Test templates | Inv. (g) |

**Route naming check.** Friend-gated target reads are `GET /users/:userId/<noun>` (`profile`, `completions`, `pin-showcase`), so `GET /users/:userId/food-ratings` follows it. The scope-level reads beside `.../food-item-logs/mine` are `GET /experiences/:id/food-item-logs/friends` and `GET /locations/:id/food-item-logs/friends`.

**Not verified at spec time (stated, not assumed):** actual Neon query plans (no database access); runtime behavior of any route; whether pg-mem supports every function in the SQL above (`to_char`, `lower ... LIKE ... ESCAPE`, `AVG`, casts) — the repo test registers any missing function the way `foodItemLogs.prop.test.ts` registers `char_length`/`lower`, and falls back to behaviour-equivalent SQL only where pg-mem genuinely cannot parse a construct, recording the deviation in the task.

## Correctness Properties

### Property 1: Notes and private fields never appear in any friend-facing payload

*For any set of Logs, including Logs whose `note` is a sentinel string, any Viewer (Friend or Owner), and every friend-facing endpoint (the list, the Highlights read and the batch read), the serialized response contains no sentinel note text, no `note` key, no Log `id`, no `userTz` and no `loggedAt`; for every list sort the base64-decoded `nextCursor` contains no timestamp (no ISO date-time, no `logged_at` value) and no date other than a `latestVisitedOn` value already present in the returned items; and the existing friend stats `foodActivity` payload (left unchanged by this feature) is built by SQL that selects no Log note and typed without a note-bearing field. Structurally, no SQL statement referencing `food_item_logs`, in the new repo or in `stats/repo.ts`, contains the identifier `note`, `fil.*`, `food_item_logs.*`, or a bare `SELECT *` / `RETURNING *`. The responses of the new routes carry no individual Log row and no visit date other than `latestVisitedOn`; the unchanged stats payload's personal-record dates (`mostAdventurousDay.date`, `dishMarathonRecord.date`) are an intentional carve-out (R5.3).*

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

### Property 2: Only the Owner or an accepted Friend can read a Dish_Rating_Row

*For any pair of Users, `GET /users/:userId/food-ratings` returns data iff the Viewer is the target or a `friendships` row exists for the canonical pair; a non-friend, a pending-request-only Viewer, a former Friend and a non-existent target all produce the identical `profile_forbidden` response with no Log read and no analytics record; an unauthenticated request answers `401`, and the route is registered in the production service map (it answers `401`, not `404`). For the batch read, the set of Friends whose Logs appear is a subset of the Viewer's `friendships` counterparts, for any friendship graph.*

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 14.2**

### Property 3: Exactly one row per distinct dish

*For any multiset of Logs, the number of rows produced equals the number of distinct `food_item_id`s among the Logs that pass the filters, and no `food_item_id` appears twice, for every sort and for the union of all pages.*

**Validates: Requirements 4.1, 4.6, 4.7**

### Property 4: Average lies in [1,10] and is computed only from rated logs

*For any dish whose Logs have ratings in 1..10 or null, `averageRating` equals the arithmetic mean of the non-null ratings and lies in `[1, 10]`, where the pure model is compared exactly (`sum / count` computed from integers) and the SQL result (`AVG(...)::float8`, a double) is compared to the model by the integer pair instead: the property asserts `ratedLogCount` equals the count, and `Math.abs(averageRating - sum / count) <= 1e-9`, never `===` on a float; it is `null` iff the dish has no rated log; and inserting additional Unrated_Logs never changes `averageRating` or `ratedLogCount`.*

**Validates: Requirements 4.2, 4.3, 4.5, 16.1**

### Property 5: Counts and latest date are exact

*For any dish, `logCount` equals the total number of its Logs, `ratedLogCount` equals those with a non-null rating, `ratedLogCount ≤ logCount`, and `latestVisitedOn` equals the maximum `visited_on` as `YYYY-MM-DD`.*

**Validates: Requirements 4.4**

### Property 6: Each sort is a strict total order and pagination is lossless

*For each of `highest_rated`, `recent` and `most_logged`, the returned order is sorted by the R6.1 comparator with no ties (the dish id breaks every tie; `recent` is `latestVisitedOn` descending then `foodItemId` ascending, with no `logged_at` term, and its cursor has `b = null`), and for any `limit` in 1..50, concatenating pages by following `nextCursor` yields the complete sorted list with every row exactly once; `nextCursor` is `null` exactly on the last page; a cursor issued for one sort is rejected for another with `validation_failed` when the Viewer is the Owner or a Friend (for a non-friend the `403` takes precedence, because the cursor is decoded after the gate; R6.7).*

**Validates: Requirements 6.1, 6.2, 6.3, 6.7**

### Property 7: Filters and search compose conjunctively and match literally

*For any filter combination of `experienceId` or `locationId`, `park`, `q` and `minRatedLogs`, the result equals the intersection of the sets each filter alone produces; the `park` filter and the `scopes[].park` values use `COALESCE(experiences.park, user_submitted_locations.park)`, so a dish scoped to a user-submitted location (whose park is mandatory) is matched by its location's park and appears under that park's chip; a `q` containing `%`, `_` or `\` matches only dishes whose name contains those characters literally; supplying both `experienceId` and `locationId`, or any malformed parameter, is rejected with `validation_failed` and reads no Log.*

**Validates: Requirements 6.4, 6.5, 6.6, 6.7, 6.8**

### Property 8: Batch social proof equals the single-friend aggregates

*For any friendship graph and Logs, for every dish and every Friend returned by the batch read, that Friend's `(averageRating, ratedLogCount, logCount, latestVisitedOn)` equals the row the single-friend list returns for the same Friend and dish; `friendCount` equals the number of Friends with at least one rated log of the dish; `friendsAverageRating` equals the mean of their averages; the viewer's own Logs and non-friends' Logs never appear.*

**Validates: Requirements 14.3, 14.4, 14.6, 15.3**

### Property 9: Display rounding is never fed back into calculations

*For any set of averages, sorting and aggregating produces the same order and values whether or not `formatAverageRating` was ever applied; the DTOs carry the unrounded numbers; and two averages that differ before rounding but display identically are ordered by their continuous values.*

**Validates: Requirements 16.2, 16.3**

### Property 10: Unfriending takes effect on the very next read

*For any Viewer who could read a target's ratings, after `removeFriend` hard-deletes the `friendships` row, the next `GET /users/:userId/food-ratings` is `profile_forbidden`, and the Viewer no longer appears in any batch audience containing the target (the former Friend's next `GET /experiences/:id/food-item-logs/friends` contains no entry derived from the target; and the target's next batch read no longer contains the Viewer); no revocation hook or cached state is involved.*

**Validates: Requirements 3.5**

### Property 11: Empty results are a successful, distinguishable state

*For any Owner or Friend target with zero matching dishes, the list responds `200` with `items: []`, `nextCursor: null` and, on the first page, `scopes: []`; for a Viewer who may not read the target the only outcome is `403 profile_forbidden` (there is no third "private" response); the App shows "{name} hasn't logged any dishes yet." with no filter active, "No dishes match your search or filters." plus a clear control with one active, and "{name} hasn't rated any dishes yet." on the Highlights row (which still shows "See all").*

**Validates: Requirements 13.1, 13.3, 13.4, 13.5**

### Property 12: Highlights are the top rated dishes under the lower threshold

*For any friend, the Highlights read returns at most 5 rows, each with `ratedLogCount ≥ 1` (so no unrated-only dish), in `highest_rated` order, and every dish with `ratedLogCount ≥ 1` that is not returned has a key no better than the last returned row; the Highlights threshold constant is strictly lower than `FOOD_STATS_MIN_RATED_LOGS`; the row always offers "See all"; a `profile_forbidden` response collapses like the other Overview reads while other errors show a scoped retry.*

**Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6**

### Property 13: Every rating has a text equivalent and every control a label

*For any dish row, Highlights card or Social_Proof item, the label produced by `describeDishRating` / `describeSocialProof` contains the dish name, the Display_Rating as text out of 10 (or the words "not rated"), and the log count; no meaning is carried by colour or icon alone; every added interactive control ("See all", sort chips, filter chips, search clear, retry) renders with an `accessibilityRole` and `accessibilityLabel`; the Empty_State and error state carry a text label next to any icon.*

**Validates: Requirements 17.1, 17.2, 17.3, 17.4**

### Property 14: New mobile UI is theme-compliant

*For every new or changed mobile source file, the theme guard finds no raw colour literal and no static colour token, and the screens render under both the light and the dark scheme.*

**Validates: Requirements 18.1, 18.2, 18.3, 18.4**

### Property 15: Reads are bounded, read-only and issue a fixed number of queries

*For any menu size and any number of Friends, the batch read issues exactly one friend-and-ratings statement and builds its response from at most `FRIEND_FOOD_BATCH_MAX_ROWS` underlying rows (the statement fetches one extra row only to detect the cap, and when the cap is hit the final, possibly partial, dish is dropped so no returned dish has an incomplete `friendCount`); the list never returns more than `limit ≤ 50` rows per page; the service sources contain no `INSERT`, `UPDATE`, `DELETE` or DDL statement and no queue, Redis, cron, timer or push use, so nothing is persisted and no job is scheduled.*

**Validates: Requirements 14.5, 15.1, 15.2, 19.1, 19.2, 19.3, 19.4**

### Property 16: The Friend Food History screen is read-only, not a tab, and resets on change

*For any sequence of sort, search and filter changes, each change discards prior pages and requests page one with the new parameters; the screen never renders a delete, add-rating, edit-rating or note control and issues no non-GET request; the friend profile's tab set is unchanged and the route is registered in `YouAndCrewStack` only. For any non-`profile_forbidden` failure of the first page the screen shows a text error state with a labelled retry control that re-issues the same request and then shows the rows; for any failure of a subsequent page it keeps the loaded rows and offers retry for that page with the same `cursor`; for `profile_forbidden` it offers no retry.*

**Validates: Requirements 11.7, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9**

### Property 17: Inline Social_Proof caps friends shown and keeps the count honest

*For any `FriendDishSocialProofDTO`, the row shows at most `FRIEND_FOOD_INLINE_MAX_FRIENDS` friends, the overflow `+N` equals `friendCount − friends.length`, a dish with no entry renders unchanged, a loading or failed batch query leaves the menu and picker fully functional with no banner, and exactly one batch request is issued per screen or modal open regardless of the number of rows.*

**Validates: Requirements 14.1, 14.7, 14.8, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6**

## Error Handling

No new `ErrorCode` values. Every path uses the existing `AppError`/`ErrorCode` envelope and `registerErrorHandler`.

| Condition | Status and code |
| --- | --- |
| Missing or expired session on any route | `401 unauthorized` (session pre-handler runs before any other check) |
| Non-friend, pending-only, former friend or unknown target on `GET /users/:userId/food-ratings` | `403 profile_forbidden`, identical for all cases, no logging or analytics |
| Malformed `:userId`, `:id` or query (bad `sort`, `limit`, `park`, `q`, `minRatedLogs`, both `experienceId` and `locationId`, unknown key) | `400 validation_failed` |
| Malformed, tampered or wrong-sort `cursor`, Viewer is the Owner or a Friend | `400 validation_failed` ("Invalid cursor"), same as `foodLists`; decoded after the gate, so a non-friend still gets `403 profile_forbidden` (R6.7) |
| Target (Owner or Friend) has no matching dishes | `200` with `items: []`, `nextCursor: null`, `scopes: []` on the first page |
| Viewer has no Friends / scope has no friend ratings / scope does not exist (batch) | `200` with `{ items: [] }` |
| Database failure | the standard `internal_error` mapping (`500`) |
| Mobile: batch (Phase 2) request fails | silent: menu/picker render without Social_Proof, no banner |
| Mobile: list/Highlights `profile_forbidden` | terminal, no retry (existing `retryUnlessForbidden`) |
| Mobile: other Highlights errors | scoped error with retry; the rest of the Overview is unaffected |
| Mobile: Friend Food History first-page error other than `profile_forbidden` | error state (text, `accessibilityRole="alert"`) replacing the list, with a retry control that refetches the first page (R12.9) |
| Mobile: Friend Food History subsequent-page error other than `profile_forbidden` | already-loaded rows kept; footer error text and a retry control that re-requests that page with the same `cursor` (R12.9) |

Authentication and access control: every route in this feature is session-authenticated. The friend list is additionally gated by `assertOwnerOrFriend`; the batch reads derive their audience from the session user, never from a request parameter. No new endpoint is unauthenticated.

## Testing Strategy

Test layers follow the repo's per-app runners: `apps/api` and `packages/shared` use Vitest; `apps/mobile` uses Jest (`jest-expo`) with `@testing-library/react-native`. Property tests use `fast-check`, at least 100 runs, tagged `// Feature: friend-food-ratings, Property N: <text>`.

**Shared (`packages/shared`, Vitest)**
- Schema tests for `friendFoodRatingsQuerySchema` (valid; invalid sort, `limit` 0 and 51, `q` empty and 101 chars, both id filters, bad `park`, unknown key, `minRatedLogs` 11). Barrel export test following the existing DTO tests.

**API pure (Vitest + fast-check)**
- `dishAggregate.prop.test.ts` — Properties 3, 4, 5, 6 (comparator totality, cursor round trip, pagination losslessness against the reference model), 7 (LIKE escaping, conjunctive filters on the model), 9 (server half: DTOs carry unrounded numbers) in task 2.2, and 17 (grouping and overflow math) added in task 7.3. Property 11 (empty state) is asserted by the generated route test (task 3.2) and Property 12 (Highlights selection) by the model-based repo test (task 2.4).

**API repo (pg-mem, real migration SQL loaded by path, as `foodItemLogs.prop.test.ts` does)**
- Setup loads `0001_init.sql` (`users`, `profiles`, `friendships`, `experiences`) and `0040_food_item_logging.sql` (`food_items`, `food_item_logs`, `user_submitted_locations`), exactly the precedent set. **Recorded deviation (choice for review item c):** migration `0004_disney_sources.sql` is **not** loaded. It is a large reshaping migration (new columns, constraint swaps, a data-mapping section) that the precedent test deliberately avoids and that pg-mem may not parse; the only effect the repo test needs from it is a nullable `experiences.park`, so setup runs `ALTER TABLE experiences ALTER COLUMN park DROP NOT NULL` (the same statement as `0004_disney_sources.sql:75`). `0043` (indexes) is not loaded: indexes do not change results and the query plans are not asserted. For the Phase 2 batch test, setup also runs `ALTER TABLE profiles ADD COLUMN avatar_preset TEXT` (the column `0013_avatar_presets.sql` adds, without its CHECK).
- `friendFoodRatings.repo.test.ts` — model-based: generate users, dishes in both scopes (experience dishes with a null `experiences.park` and location dishes with a non-null park), logs with nullable ratings and a sentinel note; assert `listDishes` equals `aggregateByDish` + `compareDishes` for every sort, filter and page size (Properties 3–7), that no `note`/`id`/`user_tz`/`logged_at` key is returned (Property 1), `listScopes` content, ordering and cap, the Highlights parameters selecting the model's top five rated dishes (Property 12), and (Phase 2) `listFriendSocialProof` equals `listDishes` per friend and dish (Property 8), excludes the viewer and non-friends, and runs as a single statement via a query-counting pool wrapper (Property 15).
- `friendFoodRatings.unfriend.integration.test.ts` — Property 10: real `removeFriend` + Fastify route + DB state, templated on `unfriendFoodListRevocation.integration.test.ts`. The list-route case is added in Phase 1 (task 3.3); the batch-route case is added in task 7.3.
- `friendFoodRatings.notes.prop.test.ts` — Property 1 end to end over `server.inject` for the list and batch routes, templated on `shareableNoteDisclosure.prop.test.ts`. For the list it also base64-decodes `nextCursor` for every sort and asserts it carries no ISO date-time or generated `logged_at` value and no date other than a returned `latestVisitedOn` (fails against a `latest_logged_at` cursor).
- `stats/__tests__/foodActivity.noNote.test.ts` — Property 1 for the unchanged friend stats path, as a **source-level structural test** (the cheapest layer that can fail if someone adds a note to stats): it reads `stats/repo.ts`, extracts every SQL template string that references `food_item_logs`, and asserts none contains the identifier `note` (case-insensitive word match) or matches `fil\.\*`, `food_item_logs\.\*`, `SELECT\s+\*` or `RETURNING\s+\*` (so `fil.*`, `food_item_logs.*`, bare `SELECT *` and `RETURNING *` all fail the test; `COUNT(*)` does not match); and reads the `FoodActivityStatistics`/`FoodPersonalRecords` declarations in `packages/shared/src/dto/Stats.ts` and asserts no field name contains `note`. A runtime `server.inject` test over a seeded snapshot was rejected for this guarantee because the snapshot type has no note field, so a sentinel could not fail it.
- `friendFoodRatings.noNoteSql.test.ts` — Property 1 for the new repo, as a **source-level structural test** (task 2.5): it reads `friendFoodRatings/repo.ts`, extracts every SQL template string that references `food_item_logs` (the list, scopes and, once task 7.1 lands, the batch statement) and asserts none contains the identifier `note` or matches `fil\.\*`, `food_item_logs\.\*`, `SELECT\s+\*` or `RETURNING\s+\*`. It is the SQL-level counterpart of the response-level checks in `notes.prop.test.ts` and `repo.test.ts`: a later `SELECT fil.*` would not name `note` yet would leak it, and a response-level test only catches that if its fixtures happen to serialize the leaked column.
- `friendFoodRatings.noBackgroundWork.test.ts` — structural assertion for R19.1/R19.3 (Property 15): the service's sources import no queue, Redis, cron or push module, call no timer, and contain no `INSERT`/`UPDATE`/`DELETE`/DDL statement; added in task 7.3.
- `friendFoodRatings.wiring.test.ts` — Property 2 (registration): (a) builds the server with `buildServer(config, { friendFoodRatings })` using the real route plugin and a session pre-handler that rejects, and asserts `GET /users/<uuid>/food-ratings` answers `401` (not `404`); (b) a source-level assertion in the style of `retirement.smoke.test.ts` reads `composeServices.ts` and `server.ts` as text and asserts `createFriendFoodRatingsRepo(`, the `friendFoodRatings:` services entry and the `services.friendFoodRatings` registration are present, so omitting the production wiring fails the test. Task 3.6 creates it; task 7.3 adds the two batch paths (`/experiences/<uuid>/food-item-logs/friends`, `/locations/<uuid>/food-item-logs/friends`) to the `401` assertion.

**API routes (`server.inject`)**
- `friendFoodRatings.routes.test.ts` — auth gate (401), friend gate (403 for non-friend/pending/former/unknown, identical bodies), happy path (own and friend), empty result (`200`, `items: []`, `scopes: []`), validation errors (bad cursor, wrong-sort cursor, bad `sort`, both id filters), batch auth and happy path and empty scope; fake repo with call-recording arrays plus a real pg-mem `friendships` fixture for the gate. Property 2 is a generated test (fast-check ≥100 runs over random friendship graphs and viewer/target pairs, asserting data iff owner-or-canonical-pair and otherwise the identical 403 body with no repo call); the remaining cases are examples. Uses `registerErrorHandler` and a stub session, like `foodLog/__tests__/routes.test.ts`.

**Mobile (Jest, RN testing library; mock only `apiRequest`, keep the real `ApiError`)**
- `foodRatingFormat.prop.test.ts` — Properties 9 and 13 (label builders, display rounding).
- `FriendFoodHighlightsRow.test.tsx` — requests `sort=highest_rated&limit=5&minRatedLogs=1`; renders cards with rating text; empty, loading, error+retry; "See all" navigates with `{ friendId, displayName }`; `accessibilityRole`/`accessibilityLabel` asserted on "See all", retry and the cards; empty/error text next to any icon; `profile_forbidden` handling (Properties 11, 12, 13).
- `FriendFoodHistoryScreen.test.tsx` — Property 16: changing sort/search/filter chip each triggers a new first-page request with the right params and replaces rows; scrolling to the end requests `cursor=<nextCursor>` and appends; no mutating control rendered; empty and no-match states; forbidden; failed load (R12.9, Property 16): a rejected first-page request shows the error state (found by `accessibilityRole="alert"` and text), tapping the retry control (`accessibilityRole="button"`, non-empty `accessibilityLabel`) re-requests the same endpoint and params and then shows the rows, a rejected `cursor` page keeps the loaded rows and its retry re-requests the same `cursor`, and a `profile_forbidden` rejection shows the forbidden treatment with no retry control and no second request; `accessibilityRole`/`accessibilityLabel` asserted on the sort chips, filter chips, search clear and retry controls, and the `describeDishRating` `accessibilityLabel` asserted on each row (Property 13).
- `MyFoodHistoryScreen.test.tsx` and `foodHistoryFilters.prop.test.ts` — unchanged and green after the control extraction (regression guard).
- `FriendProfileScreen.modes.test.tsx` — extended: the tab set is unchanged and the Highlights row renders in Overview only.
- Phase 2: `MenuScreen.friendProof.test.tsx` and `FoodItemPickerModal.friendProof.test.tsx` — exactly one `GET .../food-item-logs/friends` per open regardless of row count, chip content for dishes with entries, unchanged rows without, no banner on failure, `accessibilityLabel` from `describeSocialProof` on the chip (Properties 13, 15, 17).
- Theme: `src/__tests__/themeRetrofit.guard.test.ts` stays green with no allowlist change (Property 14).
- **Universally quantified mobile properties are example-tested, on purpose.** Property 16 ("for any sequence of changes") is an RN component property; a generated sequence would only re-drive the same `fireEvent` paths, so the test (task 4.5) drives an explicit multi-step sequence (sort, then search, then filter, then scroll, asserting a first-page reset each time) rather than fast-check.

**Gates.** Typecheck every affected workspace; `npm run verify:api` / `verify:mobile` / `verify:shared` at each checkpoint; the full `npm run verify` once as the final step. The pin gate (`.kiro/specs/pin-collection/verify`) is not relevant: no catalogue or artwork changes. Coverage thresholds apply only to `src/services/planning/**` and are unaffected.
