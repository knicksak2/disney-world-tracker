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
- **Food_List**: A named, owned collection of Food_Items, persisted in `food_lists`, with a `visibility` of `private` or `public`, and an `isChecklist` flag (Requirement 13) distinguishing a goal-oriented checklist (e.g. "Food & Wine 26") from a plain collection (e.g. "Favorite Snacks").
- **Food_List_Item**: One Food_Item's membership in a Food_List, with an ordering position and the User who added it, persisted in `food_lists_items`.
- **Food_List_Role**: The access level a `Food_List_Share` grants — `viewer` (can see the list's contents) or `editor` (can additionally add, remove, and reorder items). The owner always has full control regardless of role and is never represented by a `Food_List_Share` row.
- **Food_List_Share**: A persistent grant of view or edit access to a `private` Food_List for one specific Friend, carrying a `Food_List_Role`, persisted in `food_list_shares`. Distinct from the app's existing point-in-time `shares`/`share_recipients` mechanism — this grant is ongoing, not a delivered snapshot.
- **Food_List_Like**: A User's like of a Food_List they can currently view (public, or private-and-shared-with-them), persisted in `food_list_likes`.
- **Food_List_Save**: A User's addition of someone else's Food_List to their own "My Lists" collection as a live reference (not a copy), persisted in `food_list_saves`.
- **Food_List_Service**: The backend service owning `food_lists`, `food_lists_items`, `food_list_shares`, `food_list_likes`, `food_list_saves`.
- **Checklist Food_List**: A Food_List with `isChecklist = true`. Each of its items carries a derived, per-viewer `gotten` state (Requirement 13) rather than being purely descriptive.
- **Gotten**: A Checklist Food_List item's derived state for one specific viewing User — `true` if and only if that User has a `Food_Item_Log` (from `food-item-logging`) for that item's `food_item_id` dated on or after the Food_List's `created_at`. Never a stored column; always computed at read time from `food_item_logs`, so a log from a prior year's edition of the same recurring dish (e.g. last year's Food & Wine) does not count toward this year's list.

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


### Requirement 13: Checklist Food Lists — Mark Items Gotten, Track Progress, and Celebrate Completion

**User Story:** As a User building a goal-oriented list — like a Food & Wine festival must-try list — I want to check off each dish once I've had it this season and see how far along I am, without that changing anything about my other lists that are just favorites with no notion of "done."

#### Acceptance Criteria

1. WHEN a User creates a Food_List (`POST /me/food-lists`), THE Food_List_Service SHALL accept an optional `isChecklist` boolean and persist it on the `Food_List`, defaulting to `false` when omitted — a list is a plain collection unless the User explicitly marks it a checklist.
2. WHEN the owning User updates a Food_List's `isChecklist` flag (`PATCH /me/food-lists/:id` with `isChecklist: true | false`), THE Food_List_Service SHALL update the column and the Food_List's `updatedAt`, exactly mirroring how `visibility` is already updatable (Requirement 3.1) — switching a list's mode never deletes or alters its items, shares, likes, or saves.
3. WHERE a Food_List's `isChecklist` is `true`, THE Food_List_Service SHALL compute, for the requesting User on every read of that list's contents (`GET /food-lists/:id`), a per-item `gotten` boolean: `true` if and only if that User has at least one `Food_Item_Log` (from `food-item-logging`) referencing that item's `food_item_id` with `visited_on >= ` the Food_List's `created_at` (date comparison, in UTC); `false` otherwise. A `Food_Item_Log` dated before the Food_List's `created_at` (e.g. a prior year's log against a recurring festival dish whose underlying `Food_Item` row is reused year over year, per `food-item-logging` Requirement 1.7) SHALL NOT cause `gotten` to be `true`.
4. WHERE a Food_List's `isChecklist` is `false`, THE Food_List_Service SHALL NOT compute or include a `gotten` field for that list's items — a plain collection's items carry no completion state at all, not merely a `false` one.
5. THE `gotten` field (Requirement 13.3) SHALL be computed identically, and independently, for each requesting User — two Users with different access to the same Checklist Food_List (e.g. the owner and an editor-role collaborator) SHALL see `gotten` reflect only their own `Food_Item_Log` history, never a pooled or combined state across every User with access to the list.
6. WHEN a User marks a Checklist Food_List item gotten from within the Food_List's detail view, THE App SHALL submit a `Food_Item_Log` for that item's `food_item_id` (`POST /me/food-items/:foodItemId/logs`) with `visitedOn` defaulted to the current calendar date in the device's time zone, rather than introducing any new mutation or column — checking an item off IS logging it, so the same dish also appears in the User's food history (`food-item-logging` Requirement 8) as a side effect of checking it off, not as a separate action. **Amended by Requirement 13.15**: the App now offers an optional rating as part of this submission rather than never sending one.
7. THE Food_List_Service SHALL NOT reject a mark-gotten submission (Requirement 13.6) for a Food_Item already logged earlier in the same window — a repeat log is permitted exactly as `food-item-logging` Requirement 3.2 already allows, and `gotten` remains `true` regardless of how many qualifying logs exist.
8. ~~THE App SHALL provide no action to un-mark a Checklist Food_List item gotten from the list's detail view itself; a User who logged an item by mistake removes that specific log from "My Food History" or the item's log-history sheet (`food-item-logging` Requirement 4.3, 5.6), which causes `gotten` to correctly re-resolve to `false` on the list's next read once no qualifying log remains.~~ **Superseded by Requirement 13.16**: the App now offers a brief, action-scoped undo immediately after a mark-gotten submission (not a persistent un-check control), per the design amendment below.
9. WHERE a Food_List's `isChecklist` is `true`, THE Food_List_Service SHALL include, for the requesting User on every read of that list's contents, a `gottenCount` (the number of that list's items with `gotten = true` for that User) alongside the existing `itemCount`.
10. THE App SHALL render a progress indicator (e.g. "3 of 12 tried" and/or a progress bar) on a Checklist Food_List's detail screen, sourced from `gottenCount`/`itemCount`, positioned near the existing item-count section header; a non-checklist Food_List's detail screen SHALL render neither this indicator nor any per-item checkbox.
11. WHEN the App renders a Checklist Food_List's item row, THE App SHALL render a completion indicator reflecting that item's `gotten` state — an unchecked/outline state when `gotten` is `false`, and a filled "done" badge when `gotten` is `true`; activating an unchecked item's row SHALL perform Requirement 13.6's mark-gotten submission (subject to Requirement 13.15's rating prompt); an already-gotten item's row SHALL NOT re-trigger a mark-gotten submission on further taps within this view. **Amended by Requirement 13.14**: the completed state is no longer required to be a checkbox glyph specifically, and the row's dish name/price/location text SHALL NOT be struck through or otherwise visually de-emphasized when gotten — a completed item remains a fully legible record of what was eaten, not a crossed-off task.
12. WHEN a mark-gotten submission (Requirement 13.6) causes a Checklist Food_List's `gottenCount` to equal its `itemCount` for the acting User, where it did not already equal it before that submission, THE App SHALL present a one-time celebratory animation/message (e.g. a confetti effect with a "You've tried everything on [list name]!" message) to that User; THE App SHALL NOT persist any "already celebrated" state for the list — reopening an already-complete Checklist Food_List presents its progress indicator at 100% with no repeated celebration, and the celebration fires again on any future submission that once again newly completes the list (e.g. after an item was reverted via Requirement 13.16's undo, or a new item was added per Requirement 2.1, and the User subsequently re-completes it).
13. THE Food_List_Service SHALL create a checklist creation toggle on the mobile "create a new Food_List" flow (`MyFoodListsScreen.tsx`'s create modal, alongside the existing Public/Private visibility toggle) that sets `isChecklist` on the `POST /me/food-lists` request per Requirement 13.1.

**Amendment — Non-Destructive Completion Indicator, Inline Rating, and Action-Scoped Undo:** As a User checking dishes off a festival checklist, I want the completed look to still read as "a dish I can look back on or share," not a crossed-off task; I want the option to rate a dish right when I mark it gotten, since that's when I actually have an opinion about it; and if I tap the wrong item, I want a quick way to undo that specific mistake without leaving the screen.

14. WHEN the App renders a Checklist Food_List's item row, THE App SHALL represent the `gotten = true` state with a filled completion badge (e.g. a solid checkmark badge) in place of the outline checkbox, WITHOUT applying strikethrough, dimming, greying, or any other de-emphasis to that row's dish name, location, or price text — a Checklist Food_List remains a readable record to revisit or share after completion, not a to-do list whose finished items are visually discarded.
15. WHEN a User activates an unchecked Checklist Food_List item's row, THE App SHALL present an optional, skippable 1–10 rating prompt (reusing the existing rating-input pattern from `food-item-logging`'s `LogFoodItemModal`) before submitting the `Food_Item_Log` (Requirement 13.6); confirming the prompt with a rating SHALL include that `rating` in the `POST /me/food-items/:foodItemId/logs` body, and skipping the prompt (or dismissing it without selecting a rating) SHALL submit the log with no `rating`, exactly as Requirement 13.6 already behaves — the prompt SHALL NOT block or delay marking the item gotten if the User chooses to skip it.
16. WHEN a mark-gotten submission (Requirement 13.6, 13.15) succeeds, THE App SHALL present a brief, dismissible undo affordance (e.g. a toast reading "Marked as tried — Undo") scoped to that specific submission; activating it within its visible duration SHALL delete the `Food_Item_Log` row that submission created (`DELETE /me/food-items/:foodItemId/logs/:logId`, per `food-item-logging` Requirement 4.3) and cause that item's `gotten` to correctly re-resolve to `false` on the list's next read once no other qualifying log remains; letting the undo affordance dismiss or time out WITHOUT activating it SHALL leave the log in place permanently, at which point Requirement 13.7's "no other in-view un-check action" behavior applies — a User correcting an older mistake still uses "My Food History" or the item's log-history sheet, exactly as before this amendment.
17. THE undo affordance (Requirement 13.16) SHALL reference only the specific `Food_Item_Log` row created by the mark-gotten submission it followed (by that log's returned `id`) — it SHALL NOT delete an arbitrary or most-recent qualifying log for that Food_Item, so a User who had already logged the same dish earlier (Requirement 13.7's repeat-log allowance) never loses an unrelated, pre-existing log through this undo action.
18. WHERE a second mark-gotten submission occurs (for the same or a different item) while an earlier submission's undo affordance is still visible, THE App SHALL present the new submission's own undo affordance without requiring the earlier one to be dismissed first; each undo affordance SHALL act only on the specific log it was created for (Requirement 13.17), so multiple concurrently-visible undo affordances never interfere with one another.

**Amendment — Rating Visibility, Whole-Row Activation, and Drag-to-Reorder:** As a User who rated a dish at check-off time (Requirement 13.15), I want to actually see that rating afterward, not just have it stored invisibly; the row's own leading indicator still read as a two-way checkbox no matter its fill style, so tapping is moved to the whole row and the indicator is dropped entirely; and the original up/down tap controls for reordering read as expand/collapse affordances rather than a reorder action, so they are replaced with an explicit drag handle.

19. THE Food_List_Service SHALL include, for each item of a Checklist Food_List on every read of that list's contents (`GET /food-lists/:id`), a `rating` field equal to the 1–10 value from the User's most recent qualifying `Food_Item_Log` for that item (Requirement 13.3's same viewer-scoped, time-scoped qualification; "most recent" resolved by `visited_on` descending then `logged_at` descending, consistent with this codebase's existing most-recent-wins tie-break), or `null` if that most recent qualifying log carried no rating. `rating` SHALL be present only when that item's `gotten` is `true`; it SHALL be entirely absent (not merely `null`) when `gotten` is `false` or the list is not a checklist.
20. WHEN the App renders a Checklist Food_List's item row, THE App SHALL NOT render a leading circle, checkbox, or any other two-way-toggle-shaped indicator for the item's completion state. **Amended**: when `gotten` is `false`, THE App SHALL render an explicit trailing "Check off" outline button (testID `food-list-item-check-off-btn-${foodItemId}`) in the trailing slot before the delete button as the exclusive completion affordance; activating the "Check off" button SHALL open the Requirement 13.15 rating prompt and perform the mark-gotten submission. The row details area (dish name/location/price) SHALL NOT trigger mark-gotten; instead, activating the row details area WHERE the item's `experienceId` is non-null SHALL navigate to `ExperienceDetailScreen` for that restaurant (`{ experienceId }`), and SHALL be inert WHERE `experienceId` is `null`. Once `gotten` is `true`, the "Check off" button SHALL be replaced by the trailing completion badge showing the item's `rating` (Requirement 13.19) as `"{rating}/10"` when present or a generic completed label (e.g. "Ate this") when `rating` is `null`, while the row details area remains navigable to `ExperienceDetailScreen` WHERE `experienceId` is non-null. On a non-checklist Food_List, the row details area SHALL similarly navigate to `ExperienceDetailScreen` WHERE `experienceId` is non-null.
21. THE App's accessibility label and any on-screen wording for the Requirement 13.6 mark-gotten action, its trailing completed badge (Requirement 13.20), and its undo affordance (Requirement 13.16) SHALL use "ate"/"Ate this"-based phrasing rather than "tried"/"mark as tried" — this wording change carries no behavioral requirement beyond consistent terminology across the row's tap target, its completed badge, and the undo toast.
22. THE App SHALL provide a drag handle on each Checklist or non-checklist Food_List item row for a User with edit access (Requirement 11.1), positioned at the row's leading edge, that reorders items via direct drag-and-drop gesture (invoking Requirement 2.5's reorder submission on drop) in place of any discrete up/down tap control — a pair of small stacked-arrow buttons is explicitly disallowed as the reorder affordance, since it was found to read ambiguously as an expand/collapse control rather than a reorder action.
23. WHERE a Checklist Food_List item's `gotten` state is `true`, THE Food_List_Service SHALL include that item's `logId` (the UUID of the User's most recent qualifying `Food_Item_Log` that marked it gotten) in `FoodListItemDTO`; activating the item's completed status badge (testID `food-list-item-gotten-badge-${foodItemId}`) SHALL open the 1–10 rating prompt (with `initialRating` pre-selected if already rated), and confirming a rating SHALL call `PATCH /me/food-items/:foodItemId/logs/:logId` with the updated rating and refresh the list's contents.
