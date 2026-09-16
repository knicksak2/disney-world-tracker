# Requirements Document

## Introduction

Food Lists lets a User curate named collections of Food_Items (e.g. "Favorite Snacks," "Food & Wine Must-Tries") drawn from the `food_items` catalog introduced by `food-item-logging`, mark each list public or private, and share a private list with specific Friends — with sharing granting persistent, live access rather than a one-time snapshot, so a shared list stays current as the owner edits it. Public lists are additionally discoverable by any User via a browse/sort surface, can be liked, and can be saved as a standing reference in another User's own list collection.

This is a live-access model, not the point-in-time `shares`/`share_recipients` pattern used elsewhere in the app (sharing an Experience or a Progress snapshot): a Food_List's content can change after it is shared or saved, and everyone with access sees the current content on next read, not a frozen copy from the moment of sharing.

**Cross-spec dependency:** This feature depends on `food-item-logging` for the `food_items` catalog (`food_lists_items.food_item_id` references it) and reuses the `friendships` canonical-pair table and check pattern from `social-sharing-loop` (`apps/api/src/services/friends/canonicalPair.ts`) for private-list share authorization. Build `food-item-logging` first.

**Downstream cross-spec dependency:** `trips` Requirement 22 (built after this spec) attaches a Food_List to a Trip and widens this spec's view-access predicate with a Trip-derived branch. That work is specified and tracked entirely in `trips`, not here — this spec's own requirements, schema, and tasks are unaffected and do not need to anticipate it.

## Glossary

- **App**: The mobile client and web interfaces of the Disney World Tracker.
- **User**: An authenticated user of the App.
- **Food_Item**: A dish catalog entry scoped to a Restaurant_Experience, as defined by `food-item-logging`.
- **Food_List**: A named, owned collection of Food_Items, persisted in `food_lists`, with a `visibility` of `private` or `public`.
- **Food_List_Item**: One Food_Item's membership in a Food_List, with an ordering position and the User who added it, persisted in `food_lists_items`.
- **Food_List_Role**: The access level a `Food_List_Share` grants — `viewer` (can see the list's contents) or `editor` (can additionally add, remove, and reorder items). The owner always has full control regardless of role and is never represented by a `Food_List_Share` row.
- **Food_List_Share**: A persistent grant of view or edit access to a `private` Food_List for one specific Friend, carrying a `Food_List_Role`, persisted in `food_list_shares`. Distinct from the app's existing point-in-time `shares`/`share_recipients` mechanism — this grant is ongoing, not a delivered snapshot.
- **Food_List_Like**: A User's like of a Food_List they can currently view (public, or private-and-shared-with-them), persisted in `food_list_likes`.
- **Food_List_Save**: A User's addition of someone else's Food_List to their own "My Lists" collection as a live reference (not a copy), persisted in `food_list_saves`.
- **Food_List_Service**: The backend service owning `food_lists`, `food_lists_items`, `food_list_shares`, `food_list_likes`, `food_list_saves`.

## Requirements

### Requirement 1: Create, Rename, and Delete a Food List

**User Story:** As a User, I want to create a named list for whatever purpose I want (favorites, a trip-specific wish list, etc.), rename it, and delete it when I no longer need it.

#### Acceptance Criteria

1. WHEN a User submits a request to create a Food_List (`POST /me/food-lists`) with a `name` (1–100 chars, trimmed), THE Food_List_Service SHALL create a new `Food_List` owned by that User with `visibility = 'private'` by default and return its `id`, `name`, `visibility`, `createdAt`, `updatedAt`.
1a. WHERE a create request (Requirement 1.1) supplies an optional `visibility` of `'private'` or `'public'`, THE Food_List_Service SHALL create the `Food_List` with that `visibility` instead of the `'private'` default — this is the concrete mechanism the "by default" wording in Requirement 1.1 anticipates; a create request omitting `visibility` entirely SHALL still default to `'private'` unchanged. IF `visibility` is present but is neither `'private'` nor `'public'`, THE Food_List_Service SHALL reject the request with HTTP `400` and error code `validation_failed`, creating no row.
2. WHEN the owning User submits a rename (`PATCH /me/food-lists/:id` with a new `name`), THE Food_List_Service SHALL update the `Food_List`'s `name` and `updatedAt`, rejecting an empty-after-trim or over-100-character name with HTTP `400` and error code `validation_failed`.
3. WHEN the owning User requests deletion (`DELETE /me/food-lists/:id`), THE Food_List_Service SHALL remove the `Food_List` along with all its `Food_List_Item`, `Food_List_Share`, `Food_List_Like`, and `Food_List_Save` rows (cascade), returning HTTP `204`.
4. IF a rename or delete request targets a Food_List not owned by the requesting User (including a non-existent id), THE Food_List_Service SHALL reject the request with HTTP `404` and error code `food_list_not_found` — ownership and existence collapse to the same non-probing response.
5. WHEN a User requests their own Food_Lists (`GET /me/food-lists`), THE Food_List_Service SHALL return every Food_List that User owns, each with its `visibility`, `likeCount`, and item count, ordered by `updatedAt DESC`.

### Requirement 2: Manage Food List Membership

**User Story:** As a User (the owner, or a collaborator granted editor access), I want to add and remove specific dishes from a list and control their order, so the list reflects exactly what the group wants, in the order the group wants it.

#### Acceptance Criteria

1. WHEN a User with edit access to a Food_List — the owner, OR a User with an active `Food_List_Share` whose `role = 'editor'` — adds a Food_Item (`POST /me/food-lists/:id/items` with `foodItemId`), THE Food_List_Service SHALL insert a `Food_List_Item` at the end of the list's current ordering (`position = max(position) + 1`, or `0` if empty), recording `added_by_user_id` as the requesting User, and update the Food_List's `updatedAt` and increment its `version`.
2. IF the `foodItemId` is already present in that Food_List, THE Food_List_Service SHALL reject the request with HTTP `409` and error code `food_list_item_duplicate` without creating a second row.
3. IF the `foodItemId` does not reference an existing `Food_Item`, THE Food_List_Service SHALL reject the request with HTTP `404` and error code `food_item_not_found`.
4. WHEN a User with edit access removes an item (`DELETE /me/food-lists/:id/items/:foodItemId`), THE Food_List_Service SHALL delete that `Food_List_Item` regardless of which User originally added it, update the Food_List's `updatedAt`, and increment its `version`, returning HTTP `204`; remaining items' relative order SHALL be preserved.
5. WHEN a User with edit access reorders items (`PUT /me/food-lists/:id/items/order` with an ordered array of every current `foodItemId` in the list and the `expectedVersion` last read for that list), THE Food_List_Service SHALL, IF `expectedVersion` matches the Food_List's current `version`, update each item's `position` to match the submitted order, update the Food_List's `updatedAt`, and increment its `version`.
6. IF a reorder request's array does not contain exactly the same set of `foodItemId`s currently in the Food_List (missing, extra, or duplicate ids), THE Food_List_Service SHALL reject the request with HTTP `400` and error code `food_list_reorder_mismatch` without applying any position change.
7. IF a reorder request's `expectedVersion` does not match the Food_List's current `version` at the time of the write, THE Food_List_Service SHALL reject the request with HTTP `409` and error code `food_list_stale_write` without applying any position change, so a User reordering against stale data never silently overwrites a concurrent editor's changes.
8. IF an add/remove/reorder request targets a Food_List that does not exist or that the requesting User has no access to at all (not owner, no `Food_List_Share` of any role, and not public), THE Food_List_Service SHALL reject the request with HTTP `404` and error code `food_list_not_found`.
9. IF an add/remove/reorder request targets a Food_List the requesting User can view (public, or a `viewer`-role share) but cannot edit (not the owner and no `editor`-role share), THE Food_List_Service SHALL reject the request with HTTP `403` and error code `food_list_edit_forbidden` — this is distinct from `food_list_not_found` because the requester already knows the list exists.
10. THE Food_List_Service SHALL return `addedByUserId` and `addedByDisplayName` for each item in a Food_List's contents (`GET /food-lists/:id`), so collaborators can see who added each dish.

### Requirement 3: Visibility — Public and Private Lists

**User Story:** As a User, I want to choose whether my list is private (visible only to people I explicitly share it with) or public (visible to anyone), so I control who sees my lists.

#### Acceptance Criteria

1. WHEN the owning User changes a Food_List's visibility (`PATCH /me/food-lists/:id` with `visibility: 'public' | 'private'`), THE Food_List_Service SHALL update the `visibility` column and the Food_List's `updatedAt`.
2. WHERE a Food_List's `visibility` is `public`, THE Food_List_Service SHALL allow any authenticated User to view its contents (`GET /food-lists/:id`) regardless of friendship or an explicit `Food_List_Share` grant.
3. WHERE a Food_List's `visibility` is `private`, THE Food_List_Service SHALL allow only the owner and Users with an active `Food_List_Share` grant for that list to view its contents; every other User's `GET /food-lists/:id` SHALL be rejected with HTTP `404` and error code `food_list_not_found` (existence of a private, unshared list is not disclosed).
4. WHEN a `public` Food_List is changed to `private`, THE Food_List_Service SHALL leave its existing `Food_List_Share` grants intact (visibility change does not clear explicit shares) but SHALL cause any `Food_List_Save` held by a User without a share grant, and any `Food_List_Like` from such a User, to no longer resolve to viewable content on next read (Requirement 6.4 governs the exact surfaced state).

### Requirement 4: Share a Private List with a Friend (Live Access, Viewer or Editor)

**User Story:** As a User, I want to share one of my private lists with a specific friend — either so they can just see my current favorites, or so they can actively help me build the list together — and have it stay current as anyone with access edits it.

#### Acceptance Criteria

1. WHEN the owning User shares a private Food_List with a Friend (`POST /me/food-lists/:id/shares` with `recipientId` and `role: 'viewer' | 'editor'`), THE Food_List_Service SHALL verify `recipientId` is a Friend of the owner using the canonical `friendships` `(lo, hi)` pair check (the same pattern as `Sharing_Service.createShareAtomic`'s friend verification), and on success insert a `Food_List_Share` row with that `role` granting persistent access.
2. IF `recipientId` is not a Friend of the owner, THE Food_List_Service SHALL reject the request with HTTP `403` and error code `food_list_share_not_friend`, inserting no `Food_List_Share` row.
3. IF a `Food_List_Share` already exists for that `(foodListId, recipientId)` pair, THE Food_List_Service SHALL update its `role` to the newly submitted value (HTTP `200`, returning the updated grant) rather than raising a duplicate error — this is how the owner promotes a viewer to editor or demotes an editor to viewer.
4. WHEN the owning User revokes a share (`DELETE /me/food-lists/:id/shares/:recipientId`), THE Food_List_Service SHALL delete the `Food_List_Share` row regardless of its `role`, returning HTTP `204`; the revoked User's subsequent `GET /food-lists/:id` for that (now-inaccessible, assuming the list is still private) list SHALL return `404 food_list_not_found`.
5. WHEN two Users' `friendships` row is deleted (`DELETE /me/friends/:userId` per `social-sharing-loop`), THE Food_List_Service SHALL delete every `Food_List_Share` row between those two specific Users in both directions (as sharer and as recipient), regardless of `role`, so access granted while friends does not persist after unfriending.
6. THE Food_List_Service SHALL NOT send a push notification for any Food_List content change (item add/remove/reorder) after the initial share — only the first `Food_List_Share` grant triggers a one-time "shared a list with you" notification (Requirement 8.1), and only a role change on an existing share (Requirement 4.3) triggers a separate one-time "your access changed" notification (Requirement 8.3). Content updates from any editor are surfaced only by revisiting the list.
7. ONLY the owning User SHALL be permitted to create, change the role of, or revoke a `Food_List_Share` (`POST`/`DELETE /me/food-lists/:id/shares[/:recipientId]`); an `editor`-role User attempting any of these SHALL be rejected with HTTP `403` and error code `food_list_edit_forbidden` — editor access extends to item membership only, never to managing who else has access.

### Requirement 5: Browse and Discover Public Lists

**User Story:** As a User, I want to browse public lists other people have made, sorted by popularity or recency, so I can find good food lists without knowing the creator.

#### Acceptance Criteria

1. WHEN a User requests the discovery feed (`GET /food-lists/discover?sort=popular|recent&cursor=...`), THE Food_List_Service SHALL return only `public` Food_Lists, paginated, sorted by `likeCount DESC, id ASC` for `sort=popular` or `createdAt DESC, id ASC` for `sort=recent`.
2. THE Food_List_Service SHALL include, for each discovery result, the Food_List's `id`, `name`, `ownerId`, `ownerDisplayName`, `likeCount`, item count, and `createdAt`.
3. THE Food_List_Service SHALL default `sort` to `popular` when omitted and reject any other `sort` value with HTTP `400` and error code `validation_failed`.

### Requirement 6: Like and Save a Food List

**User Story:** As a User, I want to like lists I find interesting (mine or someone else's I can view) and save other people's lists into my own collection so I can find them again later, without duplicating the data.

#### Acceptance Criteria

1. WHEN a User likes a Food_List they currently have view access to (`POST /food-lists/:id/like`), THE Food_List_Service SHALL insert a `Food_List_Like` row (idempotent: a repeat like is a no-op success) and increment the Food_List's denormalized `likeCount` transactionally with the insert.
2. IF a User attempts to like a Food_List they do not currently have view access to (private and unshared with them), THE Food_List_Service SHALL reject the request with HTTP `404` and error code `food_list_not_found`.
3. WHEN a User unlikes a Food_List (`DELETE /food-lists/:id/like`), THE Food_List_Service SHALL delete their `Food_List_Like` row (idempotent) and decrement the denormalized `likeCount` transactionally.
4. WHEN a User saves someone else's viewable Food_List (`POST /food-lists/:id/save`), THE Food_List_Service SHALL insert a `Food_List_Save` row referencing the original `Food_List` (not a copy of its items), so subsequent edits by the owner are reflected when the saving User views it.
5. IF a User attempts to save a Food_List they do not currently have view access to, THE Food_List_Service SHALL reject the request with HTTP `404` and error code `food_list_not_found`.
6. IF a User attempts to save their own Food_List, THE Food_List_Service SHALL reject the request with HTTP `400` and error code `food_list_save_self`.
7. WHEN a User requests their list collection (`GET /me/food-lists/collection`), THE Food_List_Service SHALL return two groups: `owned` (every Food_List that User owns, per Requirement 1.5) and `saved` (every `Food_List_Save` the User holds), with each `saved` entry marked `available: false` in place of its content WHERE the referenced Food_List is no longer viewable by that User (made private without a share grant, or deleted) rather than omitting the entry or raising an error, so the User can see that something they saved is no longer accessible.
7a. WHEN the App renders a `saved` entry marked `available: false` in the collection view, THE App SHALL render it as a visually de-emphasized (greyed) row labeled "No longer available" in place of the list's name/thumbnail, with no navigation action (tapping it does nothing), distinguishing it from a normal, tappable saved-list row.
8. WHEN the owning User deletes a Food_List, THE Food_List_Service SHALL cascade-delete every `Food_List_Save` referencing it (Requirement 1.3); a save referencing a since-deleted list is never surfaced as `available: false` because the row itself no longer exists.

### Requirement 7: View a Food List's Contents

**User Story:** As a User with access to a list (mine, a public one, or one shared with me), I want to see its current dishes and my own role on the list, so I know what's actually in it right now and whether I can edit it.

#### Acceptance Criteria

1. WHEN a User with view access requests a Food_List's contents (`GET /food-lists/:id`), THE Food_List_Service SHALL return the list's `id`, `name`, `visibility`, `ownerId`, `ownerDisplayName`, `likeCount`, `version`, the requesting User's own `liked`/`saved` boolean flags and `myRole` (`'owner' | 'editor' | 'viewer'`), and its `items` (each with `foodItemId`, `name`, `price`, `position`, `addedByUserId`, `addedByDisplayName`, and — per `food-item-logging`'s Food_Item scoping — either the referenced Restaurant_Experience's id and name, or the referenced User_Submitted_Location's id and name, whichever the Food_Item is scoped to) ordered by `position ASC`, reflecting the list's current state at read time — never a cached or point-in-time snapshot.
2. THE Food_List_Service SHALL compute view access identically across `GET /food-lists/:id`, like, save, and share-revocation-driven access checks (Requirement 3.2, 3.3): owner, OR `visibility = 'public'`, OR an active `Food_List_Share` grant of either role.
3. THE Food_List_Service SHALL compute edit access (Requirement 2.1, 2.4, 2.5) as: owner, OR an active `Food_List_Share` grant with `role = 'editor'` — a `viewer`-role share or public visibility alone never grants edit access.

### Requirement 8: Share Notification

**User Story:** As a User, I want to be notified once when a friend shares a list with me or changes my role on it, so I know to go look at it, without being spammed every time the list's contents change.

#### Acceptance Criteria

1. WHEN a `Food_List_Share` row is newly inserted (Requirement 4.1, first-time grant only — not the role-change case in Requirement 4.3), THE Food_List_Service SHALL dispatch a one-time push notification to the recipient via the existing Notification_Service background port (structurally identical to `emitShareDelivered`/`emitFriendRequestReceived`), gated by the recipient's existing push notification master toggle (`notification_preferences`), fire-and-forget so the `POST /me/food-lists/:id/shares` response is never blocked or failed by notification delivery.
2. THE Food_List_Service SHALL NOT dispatch any notification for a Food_List_Like, Food_List_Save, item add/remove/reorder, or a role change that leaves the `role` unchanged (a repeat share request with the same `role` it already had).
3. WHEN an existing `Food_List_Share`'s `role` is changed to a different value (Requirement 4.3), THE Food_List_Service SHALL dispatch a separate one-time push notification to the recipient (e.g. "You can now edit [list name]" for a promotion to `editor`), gated and delivered the same way as Requirement 8.1, and distinct from the initial-share notification so a recipient can tell a role change from a fresh share.

### Requirement 9: Discover and Add Food Items to a List (Mobile)

**User Story:** As a User, I want to add dishes to my lists either while looking at a specific restaurant or from within a list itself, so that building a list fits naturally into how I actually browse the app rather than requiring me to know a dish's exact name up front.

#### Acceptance Criteria

1. WHEN the App renders the Experience Detail screen for a Restaurant_Experience, THE App SHALL provide an "Add to a list" affordance alongside the existing "Log a food item" affordance (`food-item-logging` Requirement 5.1), opening the Food_Item picker scoped to that Restaurant_Experience (`GET /experiences/:id/food-items`).
2. WHEN the User selects one or more Food_Items from the Restaurant_Experience-scoped picker via "Add to a list," THE App SHALL present the User's owned Food_Lists as a multi-select list, including a "Create new list" action that creates a Food_List inline (per Requirement 1.1) without leaving the flow.
3. WHERE a Food_Item being added is already present in one of the User's Food_Lists, THE App SHALL pre-select that Food_List in the multi-select step; deselecting a pre-selected Food_List SHALL remove the item from it (`DELETE /me/food-lists/:id/items/:foodItemId`) and selecting a new one SHALL add it (`POST /me/food-lists/:id/items`) — the step behaves as a toggle, not an add-only action.
4. WHEN the User confirms changes across one or more Food_Items and Food_Lists, THE App SHALL submit one request per changed `(list, item)` pair and treat a `food_list_item_duplicate` response as already-satisfied rather than surfacing an error to the User.
5. WHEN the User opens a Food_List they have edit access to (`FoodListDetailScreen`, Requirement 7.3) and activates "Add items," THE App SHALL first present a restaurant search/browse step (reusing the existing Catalog search scoped to `category = 'Restaurant'`), then open the Food_Item picker scoped to the selected Restaurant_Experience in multi-select mode with the target Food_List already determined, without a second list-selection step.
6. THE App SHALL restrict every list-selection surface in this flow (Requirement 9.2) to Food_Lists the User owns; a saved-but-not-owned or editor-shared-but-not-owned Food_List SHALL NOT appear in the multi-select checklist from entry point 1 — that checklist is for the User's own list collection, not every list they can edit. Entry point 2 (Requirement 9.5) is unaffected since its target list is already determined by which list's detail screen the User opened.
7. THE App SHALL provide a visible removal action (e.g. a swipe or delete control) on each item row within a Food_List's detail view for a User with edit access (Requirement 11.1), invoking `DELETE /me/food-lists/:id/items/:foodItemId` (Requirement 2.4).
8. WHERE the owning User views a private Food_List's detail screen, THE App SHALL provide a "Manage sharing" surface listing every User the list is currently shared with and their `role` (sourced from a new `GET /me/food-lists/:id/shares`), each with a revoke action invoking `DELETE /me/food-lists/:id/shares/:recipientId` and a role-change control invoking `POST /me/food-lists/:id/shares` with the new `role` (Requirement 4.3, 4.4).

### Requirement 10: Notification Tap Deep-Links to the Shared List

**User Story:** As a User who receives a "shared a food list with you" or role-change notification, I want tapping it to take me straight to that list, so that I don't have to go hunting for it manually.

#### Acceptance Criteria

1. WHEN a User taps the push notification dispatched per Requirement 8.1 or 8.3, THE App SHALL navigate to `FoodListDetailScreen` for the `foodListId` carried in the notification's `data` payload, using a dedicated tap classification (distinct from the existing Share/friend-request/Trip_Invite/Rode_With_Tag classifications in `useNotificationResponse.ts`) so the tap is never misrouted to the Inbox.
2. IF the tapped notification's target Food_List is no longer accessible to the User by the time the tap is handled (the share was revoked, the list was made private without a grant, or the list was deleted), THE App SHALL show a "no longer available" message rather than a raw error, consistent with the existing Trips deep-link fallback pattern.

### Requirement 11: Collaborative Editing UI

**User Story:** As a User with editor access to a shared list, I want to add and remove items myself and see who added what, so that a group can actually build the list together instead of relaying requests through the owner.

#### Acceptance Criteria

1. WHEN the App renders `FoodListDetailScreen` for a Food_List where the User's `myRole` (Requirement 7.1) is `owner` or `editor`, THE App SHALL show the "Add items" entry point (Requirement 9.5) and a removal action on each item row (Requirement 2.4); WHERE `myRole` is `viewer`, THE App SHALL render the list read-only, showing neither control.
2. THE App SHALL render each item row with a small attribution label showing `addedByDisplayName` (e.g. "added by Jordan") WHERE the list has more than one distinct `addedByUserId` among its items — a single-contributor list omits the label to avoid stating the obvious.
3. WHEN an `editor`-role User's reorder submission is rejected with `food_list_stale_write` (Requirement 2.7), THE App SHALL refetch the list's current contents and version, then show a brief "list was updated" message rather than silently discarding the User's intended order.
4. WHEN the owning User shares a list (Requirement 4.1) or changes an existing recipient's role (Requirement 4.3) via `ManageFoodListSharesSheet`, THE App SHALL present a `viewer`/`editor` toggle or picker per recipient rather than a share action with no role choice.

### Requirement 12: Profile Entry Point to Food Lists

**User Story:** As a User, I want a direct way to get to my food lists (and from there, public ones) from my Profile, the same way I already reach my stats and my food history, so I don't have to already be adding a dish to a restaurant just to browse or manage my own lists.

#### Acceptance Criteria

1. THE App SHALL provide a "View your food lists" affordance on the Profile screen, placed alongside the existing "View your stats" and "View your food history" entry points, that navigates to `MyFoodListsScreen`.
2. THE "View your food lists" affordance (Requirement 12.1) SHALL be visible and functional regardless of whether the viewing User owns, has saved, or has been shared any Food_List — an empty owned/saved collection (Requirement 1.5, 6.7) is rendered by `MyFoodListsScreen` itself (its existing empty states), never by hiding or disabling the Profile entry point.
3. THE "Discover" control already present in `MyFoodListsScreen`'s header (Requirement 5, opening `FoodListDiscoveryScreen`) SHALL remain the sole navigational path into the public discovery feed — this requirement adds only the missing Profile → `MyFoodListsScreen` entry point and SHALL NOT introduce a second, separate path to `FoodListDiscoveryScreen`.
4. WHEN a User views `MyFoodListsScreen`, THE App SHALL render an accessible back control in the header that navigates back to the previous screen (or `MainTabs` if no history exists), enabling the User to return from Food Lists to Profile and the rest of the application.

