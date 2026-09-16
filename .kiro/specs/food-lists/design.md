# Design Document

## Architecture Overview

Food Lists introduces five new tables layered on top of `food_items` (from `food-item-logging`) and the existing `friendships`/`users`/`profiles` tables. The core design decision — explicitly requested over the app's existing `shares`/`share_recipients` pattern — is that access is **live**, not a delivered snapshot: every read (`GET /food-lists/:id`) computes the list's current contents and the requester's current access at read time. There is no payload copy anywhere in this feature.

Three distinct relationships are modeled as three distinct join tables, deliberately not conflated:

1. **Ownership** — `food_lists.owner_id`. One owner, full CRUD including managing shares — never represented by a `food_list_shares` row.
2. **Access grant, with a role** — `food_list_shares` (private-list, friend-scoped, revocable, carrying `role: 'viewer' | 'editor'`) and the `visibility = 'public'` column (implicit *viewer* access for everyone — public visibility never grants edit access). Together these answer both "can User X view this list right now?" (Requirement 7.2) and "can User X mutate its items right now?" (Requirement 7.3) — two related but distinct predicates, both reused by every read/mutate endpoint.
3. **Affinity** — `food_list_likes` (a reaction, available to anyone with view access) and `food_list_saves` (a standing reference in the User's own collection, also gated by view access). Neither implies the other; neither implies ownership or edit access.

```
food_lists (owner_id, name, visibility, like_count, version)
     │
     ├──< food_lists_items (food_list_id, food_item_id, position, added_by_user_id)  ──> food_items (from food-item-logging)
     │
     ├──< food_list_shares (food_list_id, shared_with_user_id, shared_by_user_id, role)   [private-list access grant, viewer|editor]
     │
     ├──< food_list_likes (food_list_id, user_id)                                   [affinity, view-gated]
     │
     └──< food_list_saves (food_list_id, saved_by_user_id)                          [affinity, view-gated, live ref]

Access predicates (every read/mutate path):
  can_view(list, user) := list.owner_id = user
                        OR list.visibility = 'public'
                        OR EXISTS food_list_shares(list, user)               -- either role
                        OR EXISTS trip_food_lists(list) JOIN trip_memberships(user)  -- see below, added by `trips` R22
  can_edit(list, user) := list.owner_id = user
                        OR EXISTS food_list_shares(list, user, role='editor') -- public/viewer alone never suffices
```

**Cross-spec extension point (added by `trips` Requirement 22, not this spec):** the `trips` feature adds a
`trip_food_lists` join table letting a Trip_Member attach a Food_List they own or that is public to a Trip,
which grants every current and future Trip_Member of that Trip view access for as long as the link and
their membership both exist — computed live via the fourth OR-branch above, never materialized as a row in
`food_list_shares`. This spec's own tables and code are unaffected by that feature; the only touchpoint is
the view-access predicate itself, which `trips` task 24.2 widens in place. `food-lists` never grants edit
access via a Trip attachment — `can_edit` is untouched by this extension.

### Why a role on the share, not a second table

An `editor` grant is still exactly "does this specific User have a persistent access row for this list" — the same shape of fact `viewer` already is, just with a wider set of allowed actions. Splitting it into a separate `food_list_editors` table would mean every access check has to query two tables and merge the result, and every revoke/unfriend cleanup has to touch two tables instead of one. A `role` column on the existing `food_list_shares` row keeps "does a grant exist for `(list, user)`" a single-row lookup, with the role only mattering for the second question ("what can they do with it") — which is exactly how Trips' `permissions.ts` role/action matrix already separates "is this person a member" from "what can this role do."

### Why not reuse `shares`/`share_recipients`

`shares`/`share_recipients` model a **point-in-time delivery**: `payload_snapshot` is a JSONB copy taken at send time, and `share_recipients` tracks per-recipient `opened_at`/`recipient_deleted_at` state for that one delivered copy. A Food_List's whole point is that it keeps changing after it's shared, and the recipient should see the live content, not the day-one snapshot. Reusing `shares` would require either (a) re-sending a new snapshot on every edit — expensive, and it would spam the recipient's inbox — or (b) storing a "live" `payload_kind` that isn't actually a payload, which breaks the invariant that `payload_snapshot` is immutable once sent. A dedicated `food_list_shares` grant table (row = "this person can see this list," no content copy) is simpler and correct for this access model. The **friend-verification pattern** from `createShareAtomic` (the canonical-pair `(lo, hi)` `IN` lookup against `friendships`) is reused as-is, since that part of the problem — "is this recipient a friend of the sharer" — is identical.

## Components and Interfaces

### Backend Structure (`apps/api/src/services/foodLists/`)

A new top-level service, sibling to `foodLog/`, `sharing/`, `friends/`.

- `repo.ts`:
  - `FoodListRepo` — `createList` (accepts an optional `visibility` on `CreateFoodListInputDTO`, per Requirement 1a below; defaults to `'private'` when omitted — the create statement's `visibility` column is parameterized on this input rather than hardcoded to `'private'`), `renameList`, `setVisibility`, `deleteList`, `listOwned(userId)`, `getListDetail(listId, viewerId)` (applies the view-access predicate and resolves `myRole`), `discover(sort, cursor)`.
  - `FoodListItemRepo` — `addItem` (requires edit access; stamps `added_by_user_id`; bumps `version`), `removeItem` (requires edit access; bumps `version`), `reorderItems(listId, userId, foodItemIds, expectedVersion)` (requires edit access; `expectedVersion` mismatch → `food_list_stale_write`; bumps `version` on success).
  - `FoodListShareRepo` — `shareWithFriend(listId, ownerId, recipientId, role)` (reuses `canonicalPair` friend check; upserts `role` on an existing grant per Requirement 4.3), `revokeShare`, `listShares(listId, ownerId)` (owner-only read backing the "Manage sharing" surface, Requirement 9.8, includes each grant's `role`), `revokeSharesBetween(userIdA, userIdB)` (called on unfriend, regardless of `role`).
  - `FoodListAffinityRepo` — `like`, `unlike`, `save`, `getCollection(userId)`.
  - **Edit-access check, shared by every mutating method above:** `hasEditAccess(listId, userId) := owner OR EXISTS food_list_shares(listId, userId, role='editor')`, computed once and reused rather than duplicated per method — mirrors how `hasViewAccess` is a single predicate reused across read/like/save.
- `routes.ts`: Fastify routes for `/me/food-lists`, `/me/food-lists/:id/items` (add/remove/reorder — accessible to owner AND editors, not owner-only), `/me/food-lists/:id/shares` (`POST`/`GET`/`DELETE /:recipientId` — owner-only per Requirement 4.7), `/food-lists/:id`, `/food-lists/:id/like`, `/food-lists/:id/save`, `/food-lists/discover`, `/me/food-lists/collection`.

### Mobile Structure — Add-to-List Entry Points (Requirement 9)

Two entry points share one underlying multi-select component rather than being built as separate flows, since both end at the same "which lists should these items belong to" step:

- `FoodItemPickerModal.tsx` (from `food-item-logging`) gains a `mode: 'log' | 'addToLists'` prop. In `addToLists` mode it becomes multi-select (checkboxes instead of single-tap-to-select) and its confirm action opens `AddToListsSheet` instead of `LogFoodItemModal`.
- `AddToListsSheet.tsx` (new, `apps/mobile/src/screens/foodLists/`): given one or more `foodItemId`s, fetches the User's owned lists (`GET /me/food-lists`) plus, for each selected item, which of those lists already contain it (derived from each list's `GET /food-lists/:id` items — batched client-side, or a small dedicated membership-check endpoint if N+1 reads prove to be an issue at review time), renders the toggle checklist described in Requirement 9.3, and includes an inline "Create new list" row that calls `POST /me/food-lists` and adds the new list to the checklist without closing the sheet.
- **Entry point 1 (restaurant → list):** the Restaurant Experience Detail screen's existing menu section gains an "Add to a list" button beside "Log a food item" (`food-item-logging` Requirement 5.1), opening `FoodItemPickerModal` in `addToLists` mode pre-scoped to that restaurant's `food-items`.
- **Entry point 2 (list → restaurant):** `FoodListDetailScreen.tsx`'s "Add items" button — visible when the User's `myRole` is `owner` or `editor` (Requirement 11.1), hidden for `viewer` — opens a restaurant search step first — reusing the existing Catalog search component filtered to `category = 'Restaurant'`, no new search endpoint — then, on restaurant selection, opens `FoodItemPickerModal` in `addToLists` mode scoped to that restaurant, with the target list pre-determined (skipping `AddToListsSheet`'s list-checklist step entirely, since Requirement 9.5 only needs a single-list toggle-add here, not a multi-list choice).
- **Item removal (Requirement 9.7):** `FoodListDetailScreen.tsx`'s item rows carry a swipe-to-delete/delete-button action invoking `DELETE /me/food-lists/:id/items/:foodItemId` directly, visible for `owner`/`editor` `myRole` and hidden for `viewer` — this is the removal counterpart to the two add entry points above and must not be left implicit in "renders the item list."
- **Attribution labels (Requirement 11.2):** each item row shows `addedByDisplayName` (e.g. "added by Jordan") only when the list's items collectively carry more than one distinct `addedByUserId` — a solo list never shows the label. A `null` `addedByUserId` (contributor's account since deleted) renders no label for that row.
- **Reorder version conflict (Requirement 2.7, 11.3):** `FoodListDetailScreen.tsx`'s drag-reorder submits `expectedVersion` from the last-fetched `FoodListDetailDTO.version` alongside the reordered `foodItemIds`. On a `food_list_stale_write` response, the screen refetches the list (new `version` + current `items`) and shows a brief "list was updated" toast rather than silently discarding the User's drag — the User's specific intended order is not retried automatically, since the underlying item set may have changed.
- **Role-aware read-only rendering (Requirement 11.1):** `FoodListDetailScreen.tsx` derives its edit affordances (Add items, per-row delete, drag handles) entirely from `FoodListDetailDTO.myRole` — `viewer` renders every item row static with no drag handle and no delete control, matching how a `public`-but-not-editor viewer already had to be handled even before roles existed.
- **Manage Sharing surface (Requirement 9.8, 11.4):** a private, owned Food_List's detail screen shows a "Manage sharing" entry (visible only when `visibility = 'private'` and the list has at least one share) opening `ManageFoodListSharesSheet.tsx` (new, `apps/mobile/src/screens/foodLists/`) — a list of `FoodListShareDTO` rows (recipient display name, a `viewer`/`editor` segmented control reflecting and updating `role` via `POST /me/food-lists/:id/shares`, shared-at date) from `GET /me/food-lists/:id/shares`, each with a revoke action calling `DELETE /me/food-lists/:id/shares/:recipientId` and optimistically removing the row. The initial share flow (before any grant exists) presents the same `viewer`/`editor` choice at share-creation time.
- **Unavailable saved-list row (Requirement 6.7, 7a):** `MyFoodListsScreen.tsx`'s `saved` tab renders each `FoodListCollectionDTO.saved` entry with `available: false` as a greyed (reduced-opacity, non-interactive) row showing only the label "No longer available" in place of the list's name/thumbnail/like-count — no `onPress` handler is attached, distinguishing it at a glance from a normal tappable saved-list row.

### Mobile Structure — Profile Entry Point (Requirement 12, added by this amendment)

`MyFoodListsScreen.tsx` and `FoodListDiscoveryScreen.tsx` were both fully implemented and registered on `RootStackParamList` by task 8, but no screen actually navigated to `MyFoodListsScreen` — Profile, Home, and Catalog all lacked an entry point into it, leaving the whole feature (including public-list discovery, reached only via `MyFoodListsScreen`'s existing header "Discover" control) unreachable in the shipped app. This is a navigation-wiring gap only; no new screen, endpoint, or DTO is introduced.

- **Profile affordance (Requirement 12.1):** `ProfileScreen.tsx` gains a `SecondaryButton` labeled "View your food lists" (icon `restaurant-outline` or similar), placed in its own `Card` section immediately alongside the existing "Your stats"/"Food history" sections (mirroring the exact `styles.securityCard` + `SecondaryButton` pattern already used for "View your stats" and "View your food history"), calling `navigation.navigate('MyFoodLists')`. `MyFoodLists` is already a registered `RootStackParamList` route (task 8.1); this amendment adds no new route.
- **No new discovery path (Requirement 12.3):** `FoodListDiscoveryScreen` remains reachable exclusively through `MyFoodListsScreen`'s existing "Discover" header button (`my-food-lists-discover-btn`, already implemented). This amendment does not add a second navigation path to it (e.g. a direct Profile button skipping `MyFoodListsScreen`) — Discover is conceptually a sub-view of "my food lists," not a peer destination.
- **Unconditional visibility (Requirement 12.2):** the Profile button is never hidden or disabled based on the User's list/save/share state — `MyFoodListsScreen`'s own existing empty states (`my-food-lists-owned-empty` and the `saved`-tab equivalent) already handle the zero-lists case; the entry point itself carries no such gating.
- **Back navigation control (Requirement 12.4):** `MyFoodListsScreen.tsx` provides `onBack` to its `GradientHeader` that calls `navigation.goBack()` (or falls back to `navigation.navigate('MainTabs')` if no back stack exists). Since `MyFoodLists` is a root-stack screen with headers hidden and tabs suppressed, the in-header back control provides the required return affordance to the originating screen or main tabs.

### Unfriend Hook

`Friends_Service.removeFriend` (in `apps/api/src/services/friends/repo.ts`) is the single place a friendship is deleted. Rather than having the Friends_Service import the Food_Lists repo directly (which would invert the dependency direction the rest of this codebase uses for cross-service hooks), `composeServices.ts` wires a port the same way `awardPins` is threaded through mutating tracking routes:

```typescript
// composeServices.ts
const revokeFoodListSharesOnUnfriend = (userIdA: string, userIdB: string): Promise<void> =>
  foodListShareRepo.revokeSharesBetween(userIdA, userIdB);

// passed into friends route options:
friends: {
  repo: friendsRepo,
  requireSession: sessionMiddleware,
  emitFriendRequestReceived,
  onFriendshipRemoved: revokeFoodListSharesOnUnfriend, // NEW, awaited (not fire-and-forget:
                                                        // Requirement 4.5 is a hard access
                                                        // revocation, not a best-effort side
                                                        // effect, so unlike awardPins/notification
                                                        // dispatch this one IS awaited before the
                                                        // DELETE /me/friends/:userId responds).
},
```

`FriendsRoutesOptions` gains an optional `onFriendshipRemoved?: (userIdA: string, userIdB: string) => Promise<void>`, called after `repo.removeFriend` returns `true`, awaited before the `204` is sent. This is a deliberate asymmetry from `awardPins`/`emitShareDelivered` (which are fire-and-forget): those are best-effort enhancements where a failure shouldn't block the primary mutation, but a revocation is a security-relevant invariant (Requirement 4.5) — silently failing to revoke access on unfriend would leave a stale grant live, so this hook's failure should surface as a 500 rather than be swallowed.

### Discovery Cursor

No existing endpoint in this codebase paginates with a cursor (existing lists like `listSentShares`/`listInbox` return everything unbounded), so this is new. Keyset pagination (not `OFFSET`, which drifts under concurrent inserts) using a composite cursor of `(sortKey, id)`:

- `sort=popular`: cursor encodes `(likeCount, id)`; query adds `WHERE (like_count, id) < ($cursorLikeCount, $cursorId)` with `ORDER BY like_count DESC, id ASC`.
- `sort=recent`: cursor encodes `(createdAt, id)`; analogous with `created_at`.

The cursor is an opaque base64-encoded JSON string (`{ k: string | number, id: string }`) returned as `nextCursor` (or `null` when the page is the last), decoded and validated server-side before use in the query.

## Data Models & Migration

### Migration `0041_food_lists.sql`

```sql
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. food_lists
-- ---------------------------------------------------------------------------
CREATE TABLE food_lists (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT         NOT NULL,
    visibility   TEXT         NOT NULL DEFAULT 'private',
    like_count   INTEGER      NOT NULL DEFAULT 0,
    version      INTEGER      NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT food_lists_name_length_chk CHECK (char_length(name) BETWEEN 1 AND 100),
    CONSTRAINT food_lists_visibility_chk CHECK (visibility IN ('private', 'public')),
    CONSTRAINT food_lists_like_count_nonneg_chk CHECK (like_count >= 0),
    CONSTRAINT food_lists_version_nonneg_chk CHECK (version >= 0)
);

CREATE INDEX food_lists_owner_idx ON food_lists(owner_id, updated_at DESC);
CREATE INDEX food_lists_discover_popular_idx ON food_lists(visibility, like_count DESC, id ASC);
CREATE INDEX food_lists_discover_recent_idx ON food_lists(visibility, created_at DESC, id ASC);

-- ---------------------------------------------------------------------------
-- 2. food_lists_items
-- ---------------------------------------------------------------------------
CREATE TABLE food_lists_items (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    food_list_id      UUID         NOT NULL REFERENCES food_lists(id) ON DELETE CASCADE,
    food_item_id      UUID         NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
    position          INTEGER      NOT NULL,
    added_by_user_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
    added_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT food_lists_items_unique UNIQUE (food_list_id, food_item_id),
    CONSTRAINT food_lists_items_position_unique UNIQUE (food_list_id, position)
);

CREATE INDEX food_lists_items_list_idx ON food_lists_items(food_list_id, position ASC);

-- ---------------------------------------------------------------------------
-- 3. food_list_shares — private-list live access grant (NOT a shares/share_recipients row)
-- ---------------------------------------------------------------------------
CREATE TABLE food_list_shares (
    food_list_id         UUID         NOT NULL REFERENCES food_lists(id) ON DELETE CASCADE,
    shared_with_user_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_by_user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                 TEXT         NOT NULL DEFAULT 'viewer',
    shared_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT food_list_shares_role_chk CHECK (role IN ('viewer', 'editor')),
    PRIMARY KEY (food_list_id, shared_with_user_id)
);

CREATE INDEX food_list_shares_recipient_idx ON food_list_shares(shared_with_user_id);

-- ---------------------------------------------------------------------------
-- 4. food_list_likes
-- ---------------------------------------------------------------------------
CREATE TABLE food_list_likes (
    food_list_id  UUID         NOT NULL REFERENCES food_lists(id) ON DELETE CASCADE,
    user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (food_list_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 5. food_list_saves — a live reference, never a content copy
-- ---------------------------------------------------------------------------
CREATE TABLE food_list_saves (
    food_list_id     UUID         NOT NULL REFERENCES food_lists(id) ON DELETE CASCADE,
    saved_by_user_id UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    saved_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (food_list_id, saved_by_user_id)
);

CREATE INDEX food_list_saves_user_idx ON food_list_saves(saved_by_user_id);

COMMIT;
```

Design notes:
- `food_lists.like_count` is denormalized (Requirement 5.1's popularity sort needs an indexed sortable column; `COUNT(*)` over `food_list_likes` on every paginated discovery read would not scale and cannot be indexed for ordering). It is updated transactionally with every `food_list_likes` insert/delete (see `like`/`unlike` below), the same pattern `share_recipients`'s `unread` count avoids by being a cheap live `COUNT(*)` — but that works there because inbox size per user is small and unpaginated cross-user sorting isn't needed; discovery's cross-user popularity sort is exactly the case that justifies denormalizing here.
- `food_lists.version` is the optimistic-concurrency counter for Requirement 2.5/2.7. It is incremented on every item add/remove/reorder (not on rename/visibility change — those aren't concurrent-editor collision surfaces since only the owner can do them). A reorder request must submit the `version` it last read; a mismatch means another editor's add/remove/reorder landed first, and the request is rejected with `food_list_stale_write` rather than silently overwriting. Add/remove don't need this guard themselves — two editors adding different dishes, or removing different dishes, never actually conflict at the row level, and `food_lists_items_unique`/the delete predicate already make each individually safe. Reorder is the one operation that submits a full replacement of every item's position, which is exactly what can silently clobber a concurrent add/remove if unguarded.
- `food_lists_items_position_unique UNIQUE (food_list_id, position)` makes a corrupt double-write (two items claiming the same position) impossible at the DB level; `reorderItems` writes all positions in one transaction so this constraint is never transiently violated by a partial update (see "reorderItems" below for the swap-safe update order).
- `food_lists_items.added_by_user_id` is `ON DELETE SET NULL`, not `CASCADE` — deliberately, since cascading would delete a collaborator's contributed items out of a shared list the moment they deleted their account, which the other collaborators never asked for and would find surprising. The item survives; only its attribution becomes anonymous (`addedByUserId: null`, and the mobile attribution label per Requirement 11.2 is simply omitted for that row).
- `food_list_shares.role` (`viewer` | `editor`) is a single column on the existing grant row rather than a second table — see "Why a role on the share, not a second table" above.
- `food_list_shares`/`food_list_likes`/`food_list_saves` all cascade on `food_lists` deletion (Requirement 1.3) and on the referencing `users` row deletion (account deletion, consistent with every other per-user join table in this schema, e.g. `share_recipients`).
- No cascade exists (or is needed) from `friendships` to `food_list_shares` — the unfriend-triggered cleanup (Requirement 4.5) is an explicit application-level delete (`revokeSharesBetween`) rather than a DB trigger, because it must delete shares in **both directions** between the two users (A shared with B, and B shared with A are two independent rows, both keyed by the recipient side of each), which a single FK cascade cannot express. It deletes regardless of `role`.

## Shared Contracts

### `packages/shared/src/dto/FoodList.ts`

```typescript
export interface FoodListDTO {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerDisplayName: string;
  readonly name: string;
  readonly visibility: 'private' | 'public';
  readonly likeCount: number;
  readonly itemCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FoodListItemDTO {
  readonly foodItemId: string;
  readonly name: string;
  /**
   * Exactly one of `experienceId`/`locationId` is non-null, mirroring
   * `food-item-logging`'s `FoodItemDTO` (that spec's Requirement 6 lets a
   * Food_Item be scoped to a User_Submitted_Location instead of a catalog
   * Restaurant_Experience, e.g. an uncatalogued snack cart). `locationName`
   * is populated from `user_submitted_locations.name` in that case.
   */
  readonly experienceId: string | null;
  readonly experienceName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly price: string | null;
  readonly position: number;
  /** `null` when the contributing User's account has since been deleted (ON DELETE SET NULL). */
  readonly addedByUserId: string | null;
  readonly addedByDisplayName: string | null;
}

/** The requesting User's access level on a Food_List (Requirement 7.1, 7.3). */
export type FoodListRole = 'owner' | 'editor' | 'viewer';

export interface FoodListDetailDTO extends FoodListDTO {
  readonly liked: boolean;
  readonly saved: boolean;
  /** Optimistic-concurrency counter (Requirement 2.5, 2.7) — echo back as `expectedVersion` on the next reorder. */
  readonly version: number;
  readonly myRole: FoodListRole;
  readonly items: readonly FoodListItemDTO[];
}

export interface FoodListCollectionDTO {
  readonly owned: readonly FoodListDTO[];
  readonly saved: readonly (
    | ({ readonly available: true } & FoodListDTO)
    | { readonly available: false; readonly foodListId: string }
  )[];
}

export interface FoodListDiscoveryPageDTO {
  readonly items: readonly FoodListDTO[];
  readonly nextCursor: string | null;
}

export interface CreateFoodListInputDTO {
  readonly name: string;
  /** Optional; defaults server-side to `'private'` when omitted (Requirement 1.1, 1a). */
  readonly visibility?: 'private' | 'public';
}

export interface UpdateFoodListInputDTO {
  readonly name?: string;
  readonly visibility?: 'private' | 'public';
}

export interface AddFoodListItemInputDTO {
  readonly foodItemId: string;
}

export interface ReorderFoodListItemsInputDTO {
  readonly foodItemIds: readonly string[];
  /** The `version` last read for this list (Requirement 2.5, 2.7); a mismatch at write time is rejected as stale. */
  readonly expectedVersion: number;
}

export type FoodListShareRole = 'viewer' | 'editor';

export interface ShareFoodListInputDTO {
  readonly recipientId: string;
  readonly role: FoodListShareRole;
}

/** Backs the mobile "Manage sharing" surface (Requirement 9.8). */
export interface FoodListShareDTO {
  readonly recipientId: string;
  readonly recipientDisplayName: string;
  readonly role: FoodListShareRole;
  readonly sharedAt: string; // ISO-8601 UTC
}
```

Barreled in `packages/shared/src/dto/index.ts`; matching Zod schemas in `packages/shared/src/schemas/FoodList.ts` reusing `uuidSchema` for ids, a new `foodListNameSchema` (trim, 1–100, same shape as `displayNameSchema`/`noteBodySchema`), `z.enum(['private', 'public'])` for visibility, and `z.enum(['viewer', 'editor'])` for `role` — both two-value enums are small enough they don't need a shared tuple in `enums.ts`, but if a third value is ever added to either, promote it there following the `SHARE_PAYLOAD_KINDS` precedent. `reorderFoodListItemsInputSchema` validates `expectedVersion` as `z.number().int().min(0)`.

**Amendment (Requirement 1a):** `createFoodListInputSchema` gains `visibility: foodListVisibilitySchema.optional()` alongside its existing `name`:

```typescript
export const createFoodListInputSchema = z
  .object({
    name: foodListNameSchema,
    visibility: foodListVisibilitySchema.optional(),
  })
  .strict();
```

This closes a real gap: Requirement 1.1's "with `visibility = 'private'` **by default**" already implied an override existed, but `createFoodListInputSchema` was originally shipped `name`-only and `.strict()`, so any client sending `visibility` on create (a reasonable reading of the requirement) was rejected outright with `validation_failed` — silently, in the shipped mobile client, because `MyFoodListsScreen.tsx`'s `handleCreateList` swallows the create request's error with an empty `catch {}` rather than surfacing it, so the Create button visibly did nothing. Both sides are fixed by this amendment: the schema now accepts the optional field (server-side default to `'private'` unchanged when omitted, per Requirement 1a), and the mobile catch block is widened to surface a create failure to the User (see Testing Strategy).

## Composition Wiring (`apps/api/src/composeServices.ts`)

```typescript
const foodListRepo = createFoodListRepo(pool);
const foodListShareRepo = createFoodListShareRepo(pool);
const foodListAffinityRepo = createFoodListAffinityRepo(pool);

const emitFoodListShared = (event: FoodListSharedNotice): void => {
  void notificationService.handleFoodListShared(event).catch((err: unknown) => {
    notificationLogger.error({ err, foodListId: event.foodListId }, 'food list share notification failed');
  });
};

// Fires on Requirement 4.3's role-change path (only when `role` actually changed),
// separate from emitFoodListShared's first-grant path (Requirement 8.1 vs 8.3).
const emitFoodListRoleChanged = (event: FoodListRoleChangedNotice): void => {
  void notificationService.handleFoodListRoleChanged(event).catch((err: unknown) => {
    notificationLogger.error({ err, foodListId: event.foodListId }, 'food list role-change notification failed');
  });
};

const revokeFoodListSharesOnUnfriend = (userIdA: string, userIdB: string): Promise<void> =>
  foodListShareRepo.revokeSharesBetween(userIdA, userIdB);

// ... in the object passed to buildServer(config, {...}):
foodLists: {
  repo: foodListRepo,
  shareRepo: foodListShareRepo,
  affinityRepo: foodListAffinityRepo,
  requireSession: sessionMiddleware,
  emitFoodListShared,
  emitFoodListRoleChanged,
},
friends: {
  repo: friendsRepo,
  requireSession: sessionMiddleware,
  emitFriendRequestReceived,
  onFriendshipRemoved: revokeFoodListSharesOnUnfriend,
},
```

`Notification_Service` (`apps/api/src/services/notifications/service.ts`) gains `handleFoodListShared(event: FoodListSharedEvent): Promise<void>`, structurally mirroring `handleShareDelivered`/the friend-request-received handler: reads the recipient's `notification_preferences` master toggle, composes a title (sharer's display name) and a fixed body ("shared a food list with you"), and delivers via the existing `PushTokenTargeter`. The push payload's `data` carries `{ foodListId }`, following the same shape as the existing Trip_Invite push (`{ tripInviteId }`).

It additionally gains a second, distinct handler `handleFoodListRoleChanged(event: FoodListRoleChangedEvent): Promise<void>` (Requirement 8.3) — same preference gate and delivery mechanism, but a role-specific body ("You can now edit [list name]" for a promotion to `editor`, "Your access to [list name] changed to view-only" for a demotion), and the same `{ foodListId }` payload shape so the tap deep-link (Requirement 10.1) works identically regardless of which of the two events fired. Keeping these as two handlers rather than one parameterized handler mirrors how `handleShareDelivered` and the friend-request handler are already separate methods on the same service for two conceptually distinct events, rather than one handler branching on an event-kind flag.

`BuildServerServices` in `apps/api/src/server.ts` gains an opt-in `foodLists` block alongside `foodLog`.

### Mobile Notification Tap Deep-Link

`apps/mobile/src/hooks/useNotificationResponse.ts`'s `classifyTap` is a closed union (`PendingTap`) that currently recognizes `share`, `friendRequest`, `tripInvite`, and `rodeWithTag` — it has no case for a food-list share and would otherwise misroute the tap into the `share` fallback (which expects a `shareId`, not a `foodListId`, in the payload). This feature must add a fifth kind rather than rely on the fallback:

```typescript
// PendingTap gains:
| { readonly kind: 'foodListShare'; readonly foodListId: string }
```

- Add `extractFoodListId(response)` (mirrors `extractTripInviteId`) reading `data.foodListId`.
- In `classifyTap`, check it before the Share fallback (alongside the `tripInvite`/`rodeWithTag` checks), returning `{ kind: 'foodListShare', foodListId }` when present.
- Add `navigateToFoodListDetail(foodListId)` to `apps/mobile/src/navigation/navigationRef.ts`, mirroring `navigateToTripsList`'s nested-dispatch pattern, landing on `FoodListDetailScreen` with that id.
- The hook's dispatch switch (wherever `PendingTap` is consumed to call the right `navigateTo*`) gains a `case 'foodListShare'` branch calling `navigateToFoodListDetail`.
- When the target Food_List is no longer accessible by the time the tap is handled (revoked share, deleted list — Requirement 3.3, 4.4), `FoodListDetailScreen` surfaces the same "no longer available" treatment the Trips flow uses via `tripsListNotice.ts`'s pattern (a transient notice store read on screen mount), rather than a raw 404.

## Error Handling

New `ErrorCode` entries in `packages/shared/src/errors.ts`, grouped under a new block:

```typescript
// -- Food lists (food-lists R1-R11) -------------------------------------
// `food_list_not_found`: a mutation/read targeted a Food_List the caller
// has NO access to at all — non-existent, or private with no share of
// either role. Owner-only actions (rename/delete/visibility/manage-shares)
// also collapse a non-owner's attempt to this same response so ownership
// cannot be probed.
// `food_list_edit_forbidden`: the caller CAN view the list (public, or a
// viewer-role share) but attempted a mutation requiring edit access (item
// add/remove/reorder) or an owner-only share-management action while
// holding only editor access — distinct from `food_list_not_found` because
// the caller already knows the list exists.
// `food_list_item_duplicate`: an add targeted a foodItemId already in
// the list. `food_list_reorder_mismatch`: a reorder's id set didn't
// exactly match the list's current items. `food_list_stale_write`: a
// reorder's `expectedVersion` didn't match the list's current `version`
// (a concurrent editor's add/remove/reorder landed first).
// `food_list_share_not_friend`: a share target is not a Friend of the
// owner. `food_list_save_self`: a User attempted to save their own list.
'food_list_not_found',
'food_list_edit_forbidden',
'food_list_item_duplicate',
'food_list_reorder_mismatch',
'food_list_stale_write',
'food_list_share_not_friend',
'food_list_save_self',
```

And in `errorCodeToHttpStatus`:
```typescript
food_list_not_found: 404,
food_list_edit_forbidden: 403,
food_list_item_duplicate: 409,
food_list_reorder_mismatch: 400,
food_list_stale_write: 409,
food_list_share_not_friend: 403,
food_list_save_self: 400,
```

- `400 validation_failed`: name empty-after-trim/over-100-chars, invalid `sort` value, invalid `visibility` value, invalid `role` value.
- `404 food_item_not_found`: reused from `food-item-logging` when an `AddFoodListItemInputDTO.foodItemId` doesn't resolve.
- `403 food_list_share_not_friend`: share target not a friend (Requirement 4.2).
- `403 food_list_edit_forbidden`: a viewer (or public-only visitor) attempted an edit-gated action, or an editor attempted an owner-only share-management action (Requirement 2.9, 4.7).
- `409 food_list_item_duplicate`: duplicate add (Requirement 2.2).
- `400 food_list_reorder_mismatch`: id-set mismatch on reorder (Requirement 2.6).
- `409 food_list_stale_write`: reorder submitted against a stale `version` (Requirement 2.7).

## Configuration & Constants

| Constant | Value | Purpose |
|---|---|---|
| `FOOD_LIST_NAME_MAX_LENGTH` | `100` | Maximum character length for a Food_List name |
| `DISCOVERY_PAGE_SIZE` | `20` | Default/max page size for `GET /food-lists/discover` |
| `DEFAULT_DISCOVERY_SORT` | `'popular'` | Default `sort` value when omitted (Requirement 5.3) |

No new env vars. No new external API calls — this feature is entirely internal persistence plus the existing push-notification port.

## Correctness Properties

### Property 1: Ownership-Scoped List-Level Mutation
*For any Food_List, a rename, visibility change, delete, or share create/role-change/revoke request succeeds only when the requesting User is the list's `owner_id`; an `editor`-role User attempting any of these is rejected with `food_list_edit_forbidden`, and a User with no access at all is rejected with `food_list_not_found`; no row is changed in either rejection case.*
**Validates:** Requirement 1.2, Requirement 1.3, Requirement 1.4, Requirement 4.7

### Property 2: Edit-Access-Scoped Item Mutation
*For any Food_List, an item add/remove/reorder request succeeds when the requesting User is the owner OR holds an active `editor`-role `food_list_shares` grant; a User with only view access (public visibility or a `viewer`-role share) is rejected with `food_list_edit_forbidden`; a User with no access at all is rejected with `food_list_not_found`; no row is changed in either rejection case.*
**Validates:** Requirement 2.1, Requirement 2.4, Requirement 2.5, Requirement 2.8, Requirement 2.9

### Property 3: View-Access Predicate Consistency
*For any Food_List and any User, `GET /food-lists/:id`, `POST /food-lists/:id/like`, and `POST /food-lists/:id/save` all resolve view access identically: granted if and only if the User owns the list, OR the list's `visibility = 'public'`, OR an active `food_list_shares` row exists for `(list, user)` of either role. A User denied by this predicate never receives list content, a like, or a save.*
**Validates:** Requirement 3.2, Requirement 3.3, Requirement 6.2, Requirement 6.5, Requirement 7.2

### Property 4: Like Count Denormalization Consistency
*For any Food_List, at any point in time, `food_lists.like_count` equals `COUNT(*) FROM food_list_likes WHERE food_list_id = list.id` — every like insert increments it by exactly 1 and every unlike delete decrements it by exactly 1, in the same transaction as the row change, and a repeat like/unlike (already-liked/already-unliked) changes neither the row set nor the count.*
**Validates:** Requirement 6.1, Requirement 6.3

### Property 5: Reorder Atomicity, Rejection, and Optimistic Concurrency
*For any Food_List and any submitted reorder array with `expectedVersion`: IF the array's id set does not exactly equal the list's current item id set, the request is rejected with `food_list_reorder_mismatch` and no `position`/`version` changes. ELSE IF `expectedVersion` does not equal the list's current `version`, the request is rejected with `food_list_stale_write` and no `position`/`version` changes. ELSE every item's `position` is updated to match the submitted order and `version` is incremented by exactly 1, all in one transaction. For any two concurrent reorder/add/remove operations against the same list, at most one can succeed against a given `version` value — the second necessarily observes the first's incremented `version` and is rejected if it does not account for it.*
**Validates:** Requirement 2.5, Requirement 2.6, Requirement 2.7

### Property 6: Unfriend Revokes Bidirectional Share Access Regardless of Role
*For any two Users A and B with one or more `food_list_shares` rows between them in either direction (of either `role`), deleting their `friendships` row (via `removeFriend`) deletes every `food_list_shares` row where A shared with B and every row where B shared with A, and after the deletion neither A's nor B's shared-with-them private lists (that have no other access path) resolve via the access predicate in Property 3, regardless of what `role` the deleted grant carried.*
**Validates:** Requirement 4.5

### Property 7: Save Is a Live Reference, Never a Copy
*For any Food_List saved by User U, and any subsequent item add/remove/reorder or rename by the owner, U's next `GET /food-lists/:id` (while access remains valid) reflects the owner's latest change — no `food_list_saves` row ever stores item or name data, only the `(food_list_id, saved_by_user_id)` reference.*
**Validates:** Requirement 4 (live-access framing), Requirement 6.4, Requirement 7.1

### Property 8: Discovery Feed Sort and Scope
*For any `sort=popular` request, every returned page's items are non-increasing in `likeCount` (ties broken by ascending `id`), and for any `sort=recent` request, every returned page's items are non-increasing in `createdAt` (ties broken by ascending `id`); every returned item has `visibility = 'public'`; and paginating through every page via `nextCursor` yields the full set of public lists with no duplicate and no omission.*
**Validates:** Requirement 5.1

### Property 9: Manage-Sharing Read Is Owner-Scoped
*For any Food_List, `GET /me/food-lists/:id/shares` returns the exact set of active `food_list_shares` recipients (with their current `role`) for that list when the requester is the owner, and is rejected with `food_list_not_found`/`food_list_edit_forbidden` per Property 1's rules for any non-owner requester.*
**Validates:** Requirement 9.8

### Property 10: Notification Tap Classification Is Exhaustive and Non-Overlapping
*For any notification response carrying a `foodListId` in its `data` payload, `classifyTap` returns `{ kind: 'foodListShare', foodListId }` and never falls through to the `share` classification (which would misroute the tap toward the Inbox); this classification takes precedence identically to how `tripInvite`/`rodeWithTag` are checked before the `share` fallback.*
**Validates:** Requirement 10.1

### Property 11: Role Upsert and Change Notification
*For any Food_List and any `(owner, recipient)` pair, a share request with a `role` that differs from an existing grant's current `role` updates that grant's `role` in place (no new row, no duplicate) and triggers exactly one `handleFoodListRoleChanged` dispatch; a share request with a `role` matching the existing grant's current `role` changes nothing and triggers no notification of either kind.*
**Validates:** Requirement 4.3, Requirement 8.2, Requirement 8.3

### Property 12: Attribution Survives Contributor Account Deletion
*For any Food_List_Item added by User U, if U's account is subsequently deleted, the `food_lists_items` row referencing that Food_Item is NOT deleted — only its `added_by_user_id` becomes `null` — so the item remains in the list for every other User with access.*
**Validates:** Requirement 2.1, Requirement 2.10 (attribution field), design note on `ON DELETE SET NULL`

### Property 13: Profile-to-Discovery Navigation Path Is Reachable and Singular (Added by this amendment)
*For any User viewing the Profile screen, activating the "View your food lists" affordance navigates to `MyFoodListsScreen` unconditionally — never gated on that User owning, having saved, or having been shared any Food_List. From `MyFoodListsScreen`, exactly one control ("Discover," already existing) navigates to `FoodListDiscoveryScreen`; this amendment adds no second path into it.*
**Validates:** Requirement 12.1, Requirement 12.2, Requirement 12.3

### Property 14: Create-Time Visibility Override (Added by this amendment)
*For any create request supplying `visibility: 'private' | 'public'`, the created `Food_List`'s `visibility` column equals exactly the supplied value; for any create request omitting `visibility` entirely, the created `Food_List`'s `visibility` is `'private'`; for any create request supplying a `visibility` value outside `{'private', 'public'}`, the request is rejected with `400 validation_failed` and no row is created.*
**Validates:** Requirement 1a

### Property 15: Food Lists Header Back Navigation (Added by this amendment)
*For any User viewing `MyFoodListsScreen`, activating the header back control invokes `navigation.goBack()` when a prior navigation history exists, and navigates to `'MainTabs'` when no prior history exists, never leaving the User trapped without navigation.*
**Validates:** Requirement 12.4

## Testing Strategy

- **Repository property tests** (`apps/api/src/services/foodLists/__tests__/foodLists.prop.test.ts`, `foodListShares.prop.test.ts`, `foodListAffinity.prop.test.ts`, `foodListDiscovery.prop.test.ts`): `fast-check` (>=100 runs) against pg-mem, following the `experienceLogs.prop.test.ts` harness (`buildPgMemDatabase()`, `applyMigration(db, '0041_food_lists.sql')` after `'0040_food_item_logging.sql'`). Covers Properties 1-9, 11, 12.
  - Property 1 and 2 specifically require both an `owner` and an `editor`-role fixture per test run (not just owner-only, as a single-role fixture would pass even if the edit-access check regressed to owner-only or regressed to allow any viewer) — `fc.constantFrom('owner', 'editor', 'viewer', 'none')` as the actor-role generator is the concrete way to drive all four cases.
  - Property 5's concurrency claim is exercised by running two `reorderItems`/`addItem` calls against the same `listId` with the same starting `expectedVersion` inside `Promise.all` and asserting exactly one throws `food_list_stale_write` (or, for add/remove pairs, that both succeed since they're commutative — Property 5's "at most one can succeed against a given version" clause applies to reorder-vs-anything, not add-vs-add).
- **Unfriend cascade integration test** (`apps/api/src/services/friends/__tests__/unfriendFoodListRevocation.integration.test.ts`): asserts `removeFriend` → `onFriendshipRemoved` hook → both-direction `food_list_shares` deletion regardless of `role`, exercising Property 6 against the real `friendsRoutes` + `foodListShareRepo` wiring (not a fake), since this crosses two services and the `awaited-not-fire-and-forget` distinction is safety-relevant.
- **Route integration tests** (`apps/api/src/services/foodLists/__tests__/routes.test.ts`): Fastify `server.inject`-equivalent harness mirroring `tracking/logs/__tests__/routes.test.ts` — fake repos, stubbed `requireSession`, covering every error code above (including `food_list_edit_forbidden` and `food_list_stale_write`), the discovery cursor round-trip, and the `collection` endpoint's `available: false` degradation path.
- **Notification tests** (`apps/api/src/services/notifications/__tests__/foodListSharedNotification.test.ts`, `foodListRoleChangedNotification.test.ts`): mirrors `notificationComposition.prop.test.ts`'s style — asserts `handleFoodListShared` composes and delivers exactly once per first-time share, `handleFoodListRoleChanged` composes and delivers exactly once per role change (Property 11), both are gated by the preference toggle, and neither is invoked on likes/saves/item mutations or a same-role repeat share.
- **Migration test** (`apps/api/src/db/__tests__/migration0041.test.ts`): asserts every table, `UNIQUE`/`CHECK` constraint (including `food_lists_items_position_unique`, `food_list_shares_role_chk`, `food_lists_version_nonneg_chk`), the `added_by_user_id ON DELETE SET NULL` behavior (Property 12), and cascade-on-list-delete/user-delete behavior for the rest.
- **Mobile component tests** (`apps/mobile/src/screens/**/__tests__/FoodListDetailScreen.test.tsx`, `FoodListDiscoveryScreen.test.tsx`, `MyFoodListsScreen.test.tsx`): `@testing-library/react-native`, mocking only the network/query layer, covering create/rename/delete, visibility toggle, item add/remove/reorder (drag interaction) for `owner`/`editor` roles, read-only rendering for `viewer` role (Requirement 11.1 — no drag handle, no delete control, no "Add items" button), the attribution label appearing only with 2+ distinct contributors, the `food_list_stale_write` refetch-and-toast path (Requirement 11.3), share/revoke/role-change, like/unlike, save, and the owned/saved tab switch including an `available: false` saved-list row.
- **Add-to-list flow tests** (`apps/mobile/src/screens/foodLists/__tests__/AddToListsSheet.test.tsx`, plus interaction assertions added to the Restaurant Experience Detail and `FoodListDetailScreen` test files for their respective entry points): asserts entry point 1 (restaurant → multi-select → `AddToListsSheet`), entry point 2 (list → restaurant search → single-list scoped picker, no checklist step, visible only for `owner`/`editor` `myRole`), the pre-checked/toggle-to-remove behavior of Requirement 9.3, the inline "Create new list" path, and that a `food_list_item_duplicate` response is swallowed rather than surfaced as an error (Requirement 9.4).
- **Item removal and manage-sharing tests** (added to `FoodListDetailScreen.test.tsx`, plus new `apps/mobile/src/screens/foodLists/__tests__/ManageFoodListSharesSheet.test.tsx`): asserts the item row's delete action calls `DELETE /me/food-lists/:id/items/:foodItemId` and removes the row, visible for `owner`/`editor` and absent for `viewer` (Requirement 9.7, 11.1); asserts `ManageFoodListSharesSheet` renders every current recipient and `role` from `GET /me/food-lists/:id/shares`, that its role toggle calls `POST /me/food-lists/:id/shares` with the new `role` and updates the row, and that its revoke action calls `DELETE /me/food-lists/:id/shares/:recipientId` and removes that row (Requirement 9.8, 11.4).
- **Notification tap classification test** (added to `apps/mobile/src/hooks/__tests__/useNotificationResponse.test.ts`): asserts `classifyTap` returns `{ kind: 'foodListShare', foodListId }` for a response carrying `data.foodListId` regardless of whether the underlying event was a first-share or a role-change (both carry the same payload shape), that it takes precedence over the `share` fallback (Property 10), and that the dispatch path calls `navigateToFoodListDetail` with that id; asserts `FoodListDetailScreen` shows the "no longer available" treatment (not a raw error) when the deep-linked list has become inaccessible (Requirement 10.2).
- **Unavailable saved-row test** (added to `MyFoodListsScreen.test.tsx`): asserts a `saved` entry with `available: false` renders the greyed "No longer available" row with no `name`/`likeCount` shown and that tapping it triggers no navigation (Requirement 7a).
- **Profile entry point test** (added by this amendment, to `apps/mobile/src/screens/__tests__/ProfileScreen.test.tsx` or its existing equivalent test file): asserts the "View your food lists" button renders and calls `navigation.navigate('MyFoodLists')` on press (Requirement 12.1), and that it renders identically regardless of whether the mocked stats/collection data shows zero or many lists (Requirement 12.2, Property 13).
- **Create-time visibility tests** (added by this amendment): a route integration test in `apps/api/src/services/foodLists/__tests__/routes.test.ts` asserting `POST /me/food-lists` with `{ name, visibility: 'public' }` creates a list with `visibility: 'public'` in the response, with `visibility` omitted still creates `'private'`, and an invalid `visibility` value is rejected `400 validation_failed` with no row created (Property 14); a schema test in `packages/shared/src/schemas/__tests__/FoodList.test.ts` asserting `createFoodListInputSchema` accepts both, accepts the field omitted, and rejects an invalid enum value; a `MyFoodListsScreen.test.tsx` assertion that selecting "Public" in the create modal and submitting calls `apiRequest('POST', '/me/food-lists', { name, visibility: 'public' })`, that the list appears in the `owned` tab afterward, and — separately — that a failed create request (mocked rejection) surfaces a visible error rather than silently closing or leaving the modal inert, closing the gap where `handleCreateList`'s empty `catch {}` previously made a failed create indistinguishable from doing nothing.
- **Header back navigation test** (added by this amendment, to `apps/mobile/src/screens/foodLists/__tests__/MyFoodListsScreen.test.tsx`): asserts the header renders an accessible back button with role "button" and label "Go back" (Requirement 12.4), and that activating it invokes `navigation.goBack()` when `navigation.canGoBack()` is true, and `navigation.navigate('MainTabs')` when `canGoBack()` is false (Property 15).

