# Design Document

## Overview

Favorite is a single new table (`experience_favorites`) and a small backend module
(`tracking/favorite/`) added to the existing Tracking_Service family, plus one additional
read endpoint owned by the Trips service for Group Favorites (Requirement 9). No new
cross-cutting access model is introduced — unlike `experience-lists`, there is no
ownership/visibility/sharing predicate to compute, because a Favorite has exactly one possible
viewer (the User who set it) and no shared or discoverable state of its own.

This is the same structural shape as `tracking/completion/` (`completions` table, composite PK
`(user_id, experience_id)`, PUT=mark/DELETE=unmark/GET=read) rather than `experience-lists`'
owned-entity-plus-affinity-tables shape. The decision to fold Favorite into the `tracking/`
service family (as `tracking/favorite/`), not a new top-level `services/experienceFavorites/`
folder, follows directly from that structural identity: `tracking/` already groups
`completion/`, `rating/`, `note/`, and `logs/` — four simple per-`(User, Experience)` facts with
no sharing/ownership model — and Favorite is a fifth.

Favorites apply to every `ExperienceCategory`, including `Restaurant` — there is no dining
exclusion (contrast `experience-lists` Requirement 2.3), since Favorite is not a curation tool
with a dining/non-dining split; it is a personal-interest marker.

## Architecture

```
experience_favorites (user_id, experience_id, favorited_at)   [composite PK, no surrogate id]
     │
     ├──> experiences (FK, ON DELETE CASCADE)
     └──> users        (FK, ON DELETE CASCADE)

Access rule (every read/mutate path):
  A User may only mark, unmark, or read their OWN Favorite rows — `user_id` is always
  `request.userId`, never a path/body parameter. There is no cross-user read of another
  User's Favorited_Set anywhere in this spec except Requirement 9's Group Favorites, which
  reads every current Trip_Member's own Favorited_Set (never writes, never exposes any
  Member's full Favorited_Set to another — only the aggregated 2+-overlap result).
```

## Components and Interfaces

### Backend — `apps/api/src/services/tracking/favorite/`

**`repo.ts`**

```typescript
export interface FavoriteRepo {
  /** Idempotent insert. No-op (not an error) if already favorited. */
  favorite(userId: string, experienceId: string): Promise<void>;
  /** Idempotent delete. No-op (not an error) if not currently favorited. */
  unfavorite(userId: string, experienceId: string): Promise<void>;
  /** Every experienceId the user has favorited. No ordering guarantee. */
  listFavoriteIds(userId: string): Promise<readonly string[]>;
}

export function createFavoriteRepo(pool: DbPool): FavoriteRepo { ... }
```

Unlike `experienceLists/repo.ts`'s `like`/`unlike` (which run inside a transaction only because
they must also increment/decrement a denormalized `like_count`), Favorite has no denormalized
counter and no access predicate to check before mutating, so each method is a single atomic
statement — no `BEGIN`/`COMMIT` needed:

```sql
-- favorite(): existence/active check, then idempotent insert
SELECT id FROM experiences WHERE id = $1 AND active = TRUE;
-- (if found) --
INSERT INTO experience_favorites (user_id, experience_id)
VALUES ($1, $2)
ON CONFLICT (user_id, experience_id) DO NOTHING;

-- unfavorite(): idempotent delete, no existence check (nothing to protect against)
DELETE FROM experience_favorites WHERE user_id = $1 AND experience_id = $2;

-- listFavoriteIds()
SELECT experience_id FROM experience_favorites WHERE user_id = $1;
```

`favorite()` throws `AppError('experience_not_found', ...)` when the referenced Experience does
not exist or is not active, mirroring `experienceLists/repo.ts`'s `addItem` existence check
(Requirement 1.2). `unfavorite()` performs no existence check at all — deleting a row that was
never there is indistinguishable from deleting one that existed and is already gone, and both
are success per Requirement 1.3.

**`routes.ts`**

```typescript
export interface FavoriteRoutesOptions {
  readonly repo: FavoriteRepo;
  readonly requireSession: preHandlerHookHandler;
}

export function favoriteRoutes(options: FavoriteRoutesOptions): FastifyPluginAsync { ... }
```

Routes, mirroring `tracking/completion/routes.ts`'s structure (`requireUser`, `parseOrAppError`,
a local `.strict()` params schema — no new shared Zod schema needed since every route here has
an empty or absent body):

```
PUT    /me/experiences/:id/favorite    → 204, calls repo.favorite(userId, id)
DELETE /me/experiences/:id/favorite    → 204, calls repo.unfavorite(userId, id)
GET    /me/favorites                   → 200, { experienceIds: string[] }
```

No PATCH, no edit semantics — a Favorite has no field to edit beyond its own existence.

### Backend — Trip Group Favorites (`apps/api/src/services/trips/`)

New repo method on the existing Trips repo (or a small standalone function taking the pool and
`FavoriteRepo`/direct SQL — implementation detail left to task time, but the query shape is
fixed below), gated by the existing `assertTripMember` helper from `trips/authz.ts` exactly as
every other Trip-member-gated read is:

```sql
SELECT ef.experience_id,
       e.name AS experience_name,
       e.park,
       e.category,
       array_agg(p.display_name ORDER BY p.display_name) AS favoriting_display_names,
       count(*)::int AS favoriting_count
  FROM experience_favorites ef
  JOIN trip_memberships tm ON tm.user_id = ef.user_id AND tm.trip_id = $1
  JOIN experiences e ON e.id = ef.experience_id AND e.active = TRUE
  JOIN profiles p ON p.user_id = ef.user_id
 GROUP BY ef.experience_id, e.name, e.park, e.category
HAVING count(*) >= 2
 ORDER BY count(*) DESC, lower(e.name) ASC
```

New route:

```
GET /trips/:id/favorites/shared
  preHandler: requireSession
  → assertTripMember(pool, userId, tripId)   // trip_forbidden on non-member/non-existent (R9.2)
  → { items: GroupFavoriteDTO[] }
```

This is a pure read with no new table and no persisted/cached result (Requirement 9.3) — every
call re-joins `experience_favorites` against the Trip's current membership set, so a Member
joining/leaving or changing their own favorites is reflected on the very next read.

### Shared Types (`packages/shared`)

**`packages/shared/src/dto/Favorite.ts`** (new file):

```typescript
/** Bulk read shape backing `GET /me/favorites` and the mobile `useFavoritedExperiences` cache. */
export interface FavoritesResponseDTO {
  readonly experienceIds: readonly string[];
}

/** One row of a Trip's Group Favorites (`GET /trips/:id/favorites/shared`). */
export interface GroupFavoriteDTO {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  readonly favoritingCount: number;
  readonly favoritingDisplayNames: readonly string[];
}

export interface GroupFavoritesResponseDTO {
  readonly items: readonly GroupFavoriteDTO[];
}
```

No Zod input schema is needed beyond the existing `uuidSchema` for the `:id` path param (local
to each `routes.ts`, following the `tracking/completion/routes.ts` convention) — every route in
this spec is either body-less or has no body at all. Both DTOs above are added to
`packages/shared/src/dto/index.ts`'s type-export barrel as a new block.

**Error codes:** no new `ErrorCode` values. `experience_not_found` (existing) covers
Requirement 1.2; `trip_forbidden` (existing) covers Requirement 9.2; `validation_failed`
(existing) covers a malformed `:id`.

### Composition Wiring

`apps/api/src/composeServices.ts`:

```typescript
const favoriteRepo = createFavoriteRepo(pool);
// ...
// BuildServerServices object literal:
favorite: {
  repo: favoriteRepo,
  requireSession: sessionMiddleware,
},
```

`apps/api/src/server.ts` (three edits, mirroring every existing opt-in service block):

1. `import { favoriteRoutes, type FavoriteRoutesOptions } from './services/tracking/favorite/routes.js';`
2. `readonly favorite?: FavoriteRoutesOptions;` added to `BuildServerServices`.
3. `if (services.favorite !== undefined) { void app.register(favoriteRoutes(services.favorite)); }`

The Trip Group Favorites route is registered as part of the existing Trips route plugin
registration (no new opt-in block) since it lives inside `trips/routes.ts`, not a new service.

### Mobile — Shared Favorited-Set Hook

**`apps/mobile/src/screens/catalog/useFavoritedExperiences.ts`** (new file), mirroring
`useCompletedExperiences.ts`'s shape but simpler — `GET /me/favorites` is already scoped to the
session, with no `userId` path indirection needed:

```typescript
export function useFavoritedExperiences(): ReadonlySet<string> {
  const query = useQuery<FavoritesResponseDTO>({
    queryKey: FAVORITES_QUERY_KEY,              // ['me', 'favorites']
    queryFn: () => apiRequest<FavoritesResponseDTO>('GET', '/me/favorites'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return useMemo(
    () => new Set(query.data?.experienceIds ?? []),
    [query.data?.experienceIds],
  );
}

export const FAVORITES_QUERY_KEY = ['me', 'favorites'] as const;
```

Every surface in this spec (`ExperienceDetailScreen`, `CatalogScreen`, `DestinationScreen`,
`ExperiencePicker`, `LiveWaitsScreen`, `HomeScreen`) calls this one hook, so there is exactly one
client-side cache of the Favorited_Set. `FAVORITES_QUERY_KEY` is exported so every mutating
component invalidates the identical key (Requirement 2.4).

### Mobile — Favorite Toggle Component

**`apps/mobile/src/screens/catalog/FavoriteToggle.tsx`** (new file), following `NoteControl.tsx`'s
`useMutation`-based pattern (optimistic update + rollback-on-error, rather than
`CompletionControls.tsx`'s manual-busy-state pattern, since Requirement 2.3's "revert on
failure" needs the mutation library's `onError` + prior-state rollback):

```typescript
export interface FavoriteToggleProps {
  readonly experienceId: string;
  readonly favorited: boolean;
  readonly size?: 'small' | 'large';   // 'small' for row-inline (R3), 'large' for header (R2)
  readonly accessibilityLabel?: string;
}

export default function FavoriteToggle({
  experienceId,
  favorited,
  size = 'large',
}: FavoriteToggleProps): JSX.Element {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation<void, ApiError, boolean>({
    mutationFn: (nextFavorited) =>
      nextFavorited
        ? apiRequest<null>('PUT', `/me/experiences/${encodeURIComponent(experienceId)}/favorite`)
        : apiRequest<null>('DELETE', `/me/experiences/${encodeURIComponent(experienceId)}/favorite`),
    onMutate: async (nextFavorited) => {
      await queryClient.cancelQueries({ queryKey: FAVORITES_QUERY_KEY });
      const previous = queryClient.getQueryData<FavoritesResponseDTO>(FAVORITES_QUERY_KEY);
      queryClient.setQueryData<FavoritesResponseDTO>(FAVORITES_QUERY_KEY, (old) => {
        const ids = new Set(old?.experienceIds ?? []);
        if (nextFavorited) ids.add(experienceId); else ids.delete(experienceId);
        return { experienceIds: [...ids] };
      });
      return { previous };
    },
    onError: (_err, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(FAVORITES_QUERY_KEY, context.previous);
      }
      // Non-blocking error toast, consistent with the App's existing pattern.
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: FAVORITES_QUERY_KEY });
    },
  });

  return (
    <Pressable
      onPress={() => toggleMutation.mutate(!favorited)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (favorited ? 'Remove from favorites' : 'Add to favorites')}
      accessibilityState={{ selected: favorited }}
      testID={`favorite-toggle-${experienceId}`}
      hitSlop={8}
    >
      <Ionicons name={favorited ? 'heart' : 'heart-outline'} size={size === 'large' ? 22 : 18}
        color={favorited ? '#FF2D55' : theme.color.textSecondary} />
    </Pressable>
  );
}
```

Reused verbatim (same component, different `size`) at every surfacing point in this spec that
needs a tappable heart: `ExperienceDetailScreen` header, `SearchResultRow`, `ExperienceRow`, and
the "My Favorites" / "Your Favorites" row renderers. One implementation, one accessibility
contract, one optimistic-update strategy, satisfying Requirement 2.2/2.3 and Requirement 3.3's
"same behavior" clause by construction rather than by convention.

### Mobile — Surfacing Points

- **`ExperienceDetailScreen.tsx`**: `GradientHeader`'s `right` prop is widened from a single
  `Pressable` to a `View` (`flexDirection: 'row', gap: 8`) containing the existing
  `experience-share-button` and a new `<FavoriteToggle size="large" .../>`, reading `favorited`
  from `useFavoritedExperiences().has(experience.id)`.
- **`CatalogScreen.tsx`'s `SearchResultRow`**: gains a `favorited` prop (threaded from a
  `favoritedIds: ReadonlySet<string>` prop on `SearchResultsBody`, parallel to the existing
  `completedIds`/`completed` threading), rendering `<FavoriteToggle size="small" .../>` in
  `styles.rowBadges` or as a small top-right overlay on the row (final placement is a visual
  call, not behavior — either satisfies Requirement 3.1). The toggle's `onPress` must stop
  propagation to the row's own `Card onPress` (Requirement 3.2) — `Pressable`'s event does not
  bubble to a parent `Pressable`/`Card` in React Native by default, so no extra guard is needed
  beyond rendering the toggle as a sibling (not a descendant) of the row's tap target, or calling
  `event.stopPropagation()` if nested inside it.
- **`DestinationScreen.tsx`'s `ExperienceRow`**: identical treatment to `SearchResultRow` above.
- **`DestinationScreen.tsx` "Favorites only" toggle (Requirement 4)**: a new local
  `favoritesOnly: boolean` state, rendered as a toggle/switch control alongside the existing
  category Chip row. Applied as one more `.filter()` stage against `favoritedIds` in the same
  data pipeline that already applies the category/land/attribute filters, run before
  `groupByLandFiltered`/`groupByCategory`/grouping — **not** folded into
  `deriveFilterChips`/`experiencePickerFilters.ts`, since those functions mine chips from
  catalog-row *attributes* (facets, price, land) and favorite-ness is a session fact about the
  viewing User, not a property of the Experience row itself. A distinct empty-state message
  (Requirement 4.3) is shown when the toggle is active and the filtered set is empty, reusing the
  existing `EmptyState` component with new copy.
- **`CatalogScreen.tsx` "My Favorites" entry point (Requirement 5)**: a new pressable entry
  (e.g. a card or header link) alongside the Destination grid in `GridBody`, opening a new
  `favoritesActive` display mode that reuses `SearchResultsBody`'s flat `FlatList` renderer,
  fed by `catalog.experiences.filter(exp => favoritedIds.has(exp.id))` sourced from the same
  all-experiences catalog read `GridBody`/search already has access to (no new network call —
  the destination counts/search machinery already proves a full-catalog read is cheap and
  cached). Empty state per Requirement 5.4 reuses `EmptyState` with "no experiences favorited
  yet" copy.
- **`ExperiencePicker.tsx` / `experiencePickerFilters.ts` (Requirement 6, amended)**: originally a
  local `favoritesOnly: boolean` quick-chip filter layered over whatever tab was active; revised
  to a dedicated `'favorites'` `ExperiencePickerTab` value, structurally identical to the existing
  `'myLists'` tab:
  - `ExperiencePickerTab` widens to include `'favorites'`; `TAB_CATEGORIES.favorites = []` and
    `POPULAR_QUICK_TAGS_BY_TAB.favorites = []` (unrestricted — membership is affinity-based, not
    category-based, exactly like `myLists`).
  - `ExperiencePickerProps` gains `favoriteSourcedItems?: readonly ExperienceDTO[]` and
    `favoriteSourcedLoading?: boolean`, mirroring `listSourcedItems`/`listSourcedLoading` exactly.
    `hasFavoritesTab = (favoriteSourcedItems?.length ?? 0) > 0` gates the tab's render, mirroring
    `hasMyListsTab`.
  - `searchActive`, the `GET /catalog` `enabled` guard, `rawResults`, the loading/error branches,
    and the search placeholder text all gain a `'favorites'` case alongside each existing
    `'myLists'` case — same treatment, same reasoning (a caller-resolved candidate source that
    never issues its own catalog fetch).
  - The old `favoritesOnly` state, its quick-chip `Pressable`, and the
    `.filter(exp => !favoritesOnly || favoritedIds.has(exp.id))` stage are removed entirely —
    `useFavoritedExperiences()` is no longer called from inside `ExperiencePicker.tsx` itself.
  - `filterExperiencesMulti(tabFilteredResults, selectedLands, selectedTags)`'s result is used
    directly as `filteredResults` (no second favorites-filter stage needed, since the tab's
    candidate source — `favoriteSourcedItems` — is already exactly the Favorited_Set; land/
    attribute chips still apply on top via the same shared pipeline every other tab uses).
  - **New shared hook — `apps/mobile/src/screens/catalog/useFavoriteSourcedExperienceItems.ts`**:
    resolves the User's Favorited_Set (via the existing `useFavoritedExperiences()`) against a
    `GET /catalog` read keyed `['catalog', 'all']` — the same query key `CatalogScreen`'s "My
    Favorites" view and `TripScheduleScreen`'s own `catalogQuery` already use, so a mount of this
    hook shares that cached response rather than issuing a redundant fetch. Returns `{ items,
    isLoading }`, mirroring `useAttachedExperienceListItems`'s return shape.
  - **Caller wiring**: `TripPlannedListScreen.tsx` and `TripScheduleScreen.tsx` each call
    `useFavoriteSourcedExperienceItems(<visible/open gate>)` alongside their existing
    `useAttachedExperienceListItems*` call, and pass the result as
    `favoriteSourcedItems`/`favoriteSourcedLoading` into `ExperiencePicker`, gated identically to
    how each screen already gates its "My Lists" resolution. `TripReservationsScreen.tsx` is
    unaffected — it renders the picker with `showTabs={false}`, so no tab (including Favorites)
    is ever shown regardless of whether `favoriteSourcedItems` is supplied.
- **`LiveWaitsScreen.tsx` / `parkLiveView.ts` (Requirement 7)**: `LiveWaitsFilter` widens to
  `'all' | 'walkOn' | 'lightningLane' | 'headliners' | 'favorites'`. `buildLiveWaitsRows` gains a
  new, defaulted fourth parameter so no existing call site or test breaks:

  ```typescript
  export function buildLiveWaitsRows(
    entries: readonly ParkLiveEntryDTO[],
    experiencesById: ReadonlyMap<string, ExperienceDTO>,
    filter: LiveWaitsFilter,
    favoritedIds: ReadonlySet<string> = EMPTY_FAVORITED_SET,
  ): readonly LiveWaitsRow[] {
    // ...unchanged body...
    if (filter === 'favorites') {
      return rows.filter((row) => favoritedIds.has(row.experienceId));
    }
    return rows;
  }
  ```

  `LiveWaitsScreen.tsx` calls `useFavoritedExperiences()` and threads the resulting set into both
  the `allRows` and `rows` `useMemo` calls' `buildLiveWaitsRows(...)` invocations, and renders a
  fifth filter pill (`❤️ Favorites`) copying the existing `headliners` pill's markup, changing
  only the `filter` value compared and the label (Requirement 7.1). Requirement 7.3's empty state
  is the screen's existing `live-waits-filter-empty` `EmptyState` — no new copy needed, since "No
  rides match this filter" already reads correctly for an empty favorites result.
- **`HomeScreen.tsx` "Your Favorites" section (Requirement 8)**: a component,
  `HomeFavoritesSection.tsx`, rendered immediately below the existing `<ParkWaitPulse ... />` in
  `HomeScreen.tsx`'s JSX, structurally distinct from and additive to it (own `useQuery` for live
  data, horizontal `ScrollView`) but **not a modification of `ParkWaitPulse.tsx` or
  `pulseCalculations.ts`** (Requirement 8.5). It reads `useFavoritedExperiences()` for the id set,
  and for live wait data reuses the same `GET /parks/:park/live` read `ParkWaitPulse`'s `ParkPill`
  already performs — scoped per favorited Experience's own `park`, grouped by park to minimize
  redundant live-data queries (one `useQuery` per distinct park among the User's favorites, each
  keyed `['park-live', park]`, sharing cached responses).
  Experiences in the horizontal scroll are sorted with open attractions with active wait times
  displayed first (ordered ascending by wait duration) and closed/down attractions placed last
  (sorted alphabetically by name as tie-breaker) (Requirement 8.2). Cards are styled with adequate
  horizontal breathing room (`width: 180`), a park accent top border/stripe matching the park's hue,
  a subtle favorite heart icon, and a structured status/wait badge (e.g. green/amber/red wait pill or
  slate closed pill) rather than unstyled floating dots and stark text. The section header includes an
  `Ionicons` heart icon and a "See All ›" link (Requirement 8.6) routing to Live Waits with the
  favorites filter applied. Favorites with no park (e.g. a `Resort`-area favorite, or a favorite
  with no live-wait-eligible category) are omitted from this section's rendered pills.
- **Trip Group Favorites section (Requirement 9)**: a new `GroupFavoritesSection.tsx`, rendered
  on `TripDetailScreen.tsx` alongside the existing `AttachedFoodListsSection`/
  `AttachedExperienceListsSection` pattern (same "fetch via a scoped query, render a titled
  card section" shape), reading `GET /trips/:id/favorites/shared`. Section title is "Group
  Favorites" — deliberately distinct from `TripSummaryScreen.tsx`'s existing "Crowd Favorite"
  superlative tile, which is an unrelated, already-shipped, rating-derived concept (Requirement
  9.4).

## Data Models

### `experience_favorites` (new table, migration `0054_experience_favorites.sql`)

```sql
BEGIN;

-- experience_favorites — a simple boolean (user, experience) affinity. NOT an
-- Experience_List (no sharing/visibility/membership/ordering); a pure join row,
-- structurally identical to experience_list_likes.
CREATE TABLE experience_favorites (
    user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experience_id  UUID         NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
    favorited_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, experience_id)
);

-- Supports GET /me/favorites, the mobile favorited-set hook, and every
-- surface's reverse lookup by user. Mirrors experience_list_saves_user_idx.
CREATE INDEX experience_favorites_user_idx ON experience_favorites(user_id);

-- Supports the Trip Group Favorites join (GROUP BY experience_id across a
-- Trip's membership set) — a forward lookup by experience, the PK already
-- covers lookups scoped by both columns, this covers an experience-first scan.
CREATE INDEX experience_favorites_experience_idx ON experience_favorites(experience_id);

COMMIT;
```

No surrogate `id` column (the composite PK is the full identity of the row, same as
`experience_list_likes`). No `CHECK` constraints needed — there is no enum or numeric field.
`ON DELETE CASCADE` on both FKs (not `SET NULL`): unlike `experience_lists_items.added_by_user_id`
(attribution on someone else's content, which should survive the attributor's account deletion),
a Favorite row's entire existence *is* the User's relationship to the Experience — deleting the
User's account should delete it, exactly like `experience_list_likes`/`experience_list_saves`.

### Shared DTOs

See Components and Interfaces → Shared Types above for `FavoritesResponseDTO`,
`GroupFavoriteDTO`, `GroupFavoritesResponseDTO`.

## Error Handling

No new `ErrorCode` values are introduced by this spec.

- `PUT /me/experiences/:id/favorite` with a non-existent or inactive `:id` → `404
  experience_not_found` (existing code, reused).
- `DELETE /me/experiences/:id/favorite` is unconditionally idempotent — never errors on a
  missing row, and performs no existence check on the Experience itself (a since-deactivated
  Experience's Favorite row can still be unmarked).
- A malformed `:id` (not a UUID) on any route → `400 validation_failed` (existing code, via the
  local `.strict()` params schema, mirroring `tracking/completion/routes.ts`).
- `GET /trips/:id/favorites/shared` for a non-member or non-existent Trip → `403 trip_forbidden`
  (existing code, via `assertTripMember`), collapsing both cases identically per that helper's
  existing contract.
- Every route in this spec requires an active session (`requireSession` preHandler); a missing
  session → `401 unauthorized` (existing code), consistent with every other route module.

## Configuration & Constants

| Constant | Value | Purpose |
| --- | --- | --- |
| `FAVORITES_QUERY_KEY` | `['me', 'favorites']` | TanStack Query cache key shared by every mobile surface reading or invalidating the Favorited_Set (`useFavoritedExperiences.ts`). |

No new environment variables. No new external API calls — Requirement 8's live-wait data reuses
the existing `GET /parks/:park/live` read (ThemeParks.wiki, via the existing `Live_Service`);
this spec adds no new upstream integration.

## External Interfaces

None. This spec introduces no new integration with an external or undocumented API; it reuses
the existing internal `GET /parks/:park/live` endpoint (already documented in
`navigation-redesign`/`disney-facilities-catalog-source`) for Requirement 8's live wait data.

## Correctness Properties

### Property 1: Favorite/Unfavorite Is Idempotent

*For any User and any existing, active Experience, calling `favorite()` any number of times
(≥1) in sequence leaves exactly one `experience_favorites` row for that pair; calling
`unfavorite()` any number of times (≥0) in sequence leaves zero rows for that pair. Neither
operation ever raises an error due to repetition.*

**Validates: Requirements 1.1, 1.3**

### Property 2: Favorite State Is Independent of Completion, Rating, Note, and List Membership

*For any User and Experience, toggling that Experience's Favorite state never inserts, updates,
or deletes any row in `completions`, `experience_logs`, `ratings`, `notes`,
`experience_lists_items`, or any other tracking table; and toggling any of those other tables
never inserts, updates, or deletes an `experience_favorites` row.*

**Validates: Requirements 1.6**

### Property 3: Favoriting a Non-Existent or Inactive Experience Is Rejected Before Any Write

*For any `:id` that does not reference an existing, active Experience row, `PUT
/me/experiences/:id/favorite` returns `404 experience_not_found` and leaves
`experience_favorites` completely unchanged (no row inserted for any user).*

**Validates: Requirements 1.2**

### Property 4: The Favorited_Set Is Scoped Exclusively to the Requesting User

*For any two distinct Users A and B, `GET /me/favorites` requested as A never includes an
`experienceId` that A has not favorited, regardless of what B has favorited — favoriting is
never visible cross-user except through the aggregated Requirement 9 read, which never exposes
any individual Member's full Favorited_Set, only the 2+-overlap aggregate.*

**Validates: Requirements 1.5, 9.3**

### Property 5: Every Mobile Surface Reads One Consistent Favorited_Set

*For any sequence of favorite/unfavorite toggles performed from any one surfacing point
(`ExperienceDetailScreen`, a catalog row, or any other `FavoriteToggle` instance), every other
currently-mounted surface reading `useFavoritedExperiences()` reflects the updated state after
that surface's next render following the mutation's settlement — no surface can display a
favorited-state value that contradicts another concurrently-mounted surface's value for the same
Experience once both have re-rendered.*

**Validates: Requirements 2.4, 3.3, 5.5**

### Property 6: Destination and Picker Favorites Filters Compose Conjunctively With Existing Filters

*For any Destination_Screen state with one or more active category/land/attribute filters AND
the "Favorites only" toggle active, the displayed result set equals the intersection of
(favorited Experiences) and (Experiences matching every other active filter) — never a union,
and never a result produced by evaluating the Favorites filter in isolation. For
ExperiencePicker's "Favorites" tab (Requirement 6, amended), the same conjunction holds against
its land/attribute chips: the displayed result set equals the intersection of
`favoriteSourcedItems` (already exactly the Favorited_Set, resolved by the caller) and Experiences
matching every active land/attribute chip, via the same shared `filterExperiencesMulti` pipeline
every other tab uses — never a union, and never a result influenced by any other tab's category
restriction.*

**Validates: Requirements 4.2, 6.2**

### Property 7: Live Waits Favorites Filter Is Park-Scoped and Re-Applies on Park Switch

*For any active park P and the "favorites" `LiveWaitsFilter` selected, `buildLiveWaitsRows`'
output contains only rows whose `experienceId` is both in the Favorited_Set AND present among
P's live entries; switching the active park to P' while the filter remains "favorites" recomputes
the same intersection against P''s entries, never retaining P's result set.*

**Validates: Requirements 7.2, 7.4**

### Property 8: `buildLiveWaitsRows`'s New Parameter Is Fully Backward Compatible

*For any call to `buildLiveWaitsRows` with its `favoritedIds` parameter omitted, the function's
output is byte-for-byte identical to its pre-existing (pre-this-spec) behavior for every filter
value other than `'favorites'` — the default empty set changes no existing filter's output.*

**Validates: Requirements 7.1**

(Non-regression of requirements already shipped by `navigation-redesign`/the Live Waits
feature.)

### Property 9: Group Favorites Reflects Only Current Trip Membership, Computed at Read Time

*For any Trip and any User U, U appears in a Group Favorite's `favoritingDisplayNames` for
Experience E if and only if U currently holds a `trip_memberships` row for that Trip AND U
currently has an `experience_favorites` row for E — a former Member's favorite is excluded
immediately upon their membership's removal, with no stored or cached Group Favorites result to
invalidate.*

**Validates: Requirements 9.1, 9.3**

### Property 10: Group Favorites Requires a Strict Majority-of-Two Overlap and Excludes Singletons

*For any Experience favorited by exactly zero or one of a Trip's current Trip_Members, that
Experience never appears in `GET /trips/:id/favorites/shared`'s result; for any Experience
favorited by two or more, it appears exactly once with `favoritingCount` equal to the exact count
of favoriting current Trip_Members.*

**Validates: Requirements 9.1, 9.5**

### Property 11: Trip Membership Gate Collapses Non-Member and Non-Existent Trip Identically

*For any `:id` that is either a Trip the requesting User is not currently a Member of, or does
not exist at all, `GET /trips/:id/favorites/shared` returns the identical `403 trip_forbidden`
response in both cases.*

**Validates: Requirements 9.2**

## Testing Strategy

Backend:

- **`tracking/favorite/__tests__/favorite.prop.test.ts`** — `fast-check` property tests
  (≥100 runs, tagged `// Feature: experience-favorites, Property N: <text>`) against a `pg-mem`
  harness applying `0001_init.sql` + `0054_experience_favorites.sql`, covering Property 1
  (idempotency), Property 3 (reject-before-write on a non-existent/inactive id), and Property 4
  (per-user scoping) by seeding two distinct Users and asserting cross-contamination never
  occurs.
- **`tracking/favorite/__tests__/routes.test.ts`** — `server.inject` integration tests with a
  fake `FavoriteRepo` (call-recording arrays, injectable thrown errors, mirroring
  `experienceLists/__tests__/routes.test.ts`'s fake-repo pattern), covering: the 401 auth gate
  for all three routes (added to any existing shared all-routes-401 loop test if one exists in
  this codebase, else a dedicated loop here), the 404 `experience_not_found` path, the 204/200
  success shapes, and that `DELETE` never calls any existence-check method on the fake repo
  (proving Property 1's "no error on repeated unmark" is enforced at the route layer too, not
  only the repo layer).
- **`trips/__tests__/favoritesShared.*.test.ts`** (prop + integration) — Property 9, 10, and 11:
  a `pg-mem`-or-fake-pool model seeded with several Users' `experience_favorites` rows and a
  Trip's `trip_memberships`, asserting the exact overlap-count/exclusion/membership-gate
  behavior, plus a `server.inject` test for the `403`/`200` route shapes.
- **Migration test** `apps/api/src/db/__tests__/migration0054.test.ts` — asserts the table,
  composite PK, both FK `ON DELETE CASCADE` behaviors, and both indexes exist, following the
  existing `migrationNNNN.test.ts` convention.

Mobile:

- **`useFavoritedExperiences.test.ts`** (or inline in a consuming component's test) — mocks the
  network layer only, asserting the hook returns the correct `Set` from a mocked `GET
  /me/favorites` response and an empty `Set` on error/loading.
- **`FavoriteToggle.test.tsx`** — renders the real component with `@testing-library/react-native`,
  mocking only `apiRequest`; asserts tapping an unfavorited toggle calls `PUT .../favorite`,
  optimistically flips the rendered icon immediately (before the mocked network call resolves),
  and rolls back the icon on a mocked rejection; asserts tapping a favorited toggle calls `DELETE
  .../favorite` with the same optimistic/rollback behavior.
- **`ExperienceDetailScreen.test.tsx`** (extend existing) — asserts the header renders a favorite
  toggle alongside the existing share button and that invalidating the Favorited_Set after a
  toggle is observable (e.g. via a second mounted consumer reflecting the new state, covering
  Property 5 at the component level).
- **`CatalogScreen.test.tsx` / `DestinationScreen.test.tsx`** (extend existing) — asserts each row
  renders a favorite toggle reflecting the mocked Favorited_Set, that tapping it does not trigger
  the row's navigation callback (`onSelectExperience`), and (`DestinationScreen`) that the
  "Favorites only" toggle filters the rendered rows to the mocked favorited subset while an
  active category chip remains applied simultaneously (Property 6).
- **`CatalogScreen.test.tsx`** (extend) — "My Favorites" entry point renders the flat favorited
  list and the empty state when the mocked Favorited_Set is empty (Requirement 5.4).
- **`ExperiencePicker.test.tsx`** (extend existing) — asserts the "Favorites" quick chip filters
  `tabFilteredResults` to the mocked favorited subset while a land/attribute chip remains applied
  simultaneously (Property 6), and that the optimizer-facing submission payload
  (`POST /trips/:id/planned-items`) is unaffected by the chip's active state (Requirement 6.4).
- **`parkLiveView.prop.test.ts`** (extend existing, if present, else add) — a `fast-check`
  property test for Property 8 (backward-compatible default parameter) directly against
  `buildLiveWaitsRows`, plus a dedicated case for Property 7 (favorites filter intersects
  Favorited_Set with the active park's entries).
- **`LiveWaitsScreen.test.tsx`** (extend existing) — asserts the fifth "Favorites" pill renders,
  selecting it filters the rendered rows to the mocked favorited subset, and the existing empty
  state renders when that subset is empty for the active park.
- **`HomeScreen.render.test.tsx`** (extend existing) — asserts the new "Your Favorites" section
  renders below `ParkWaitPulse` without altering any existing `home-park-wait-pulse`/
  `home-pulse-pill-*` assertions already in this file (explicit non-regression check for
  Requirement 8.5), and that it renders the empty/prompt state when the mocked Favorited_Set is
  empty.
- **`TripDetailScreen.test.tsx`** (extend existing) — asserts the "Group Favorites" section
  renders the mocked `GET /trips/:id/favorites/shared` result, is visually/textually distinct
  from any "Crowd Favorite" assertion elsewhere in the suite, and renders its own empty state
  when the mocked result is an empty list.
