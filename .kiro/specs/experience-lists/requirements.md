# Requirements Document

## Introduction

Experience Lists lets a User curate named collections of non-dining Experiences (rides, shows,
character meets, and any other `ExperienceCategory` other than `Restaurant`) — e.g. "Thrill
Rides," "Must Do," "Kid-Friendly" — mark each list public or private, and share a private list
with specific Friends, with sharing granting persistent, live access rather than a one-time
snapshot. Public lists are additionally discoverable by any User via a browse/sort surface, can
be liked, and can be saved as a standing reference in another User's own list collection.

This feature is a structural mirror of `food-lists`, reusing its exact access model (ownership,
`Experience_List_Share` viewer/editor roles, `Experience_List_Like`, `Experience_List_Save`),
its live-access semantics (a shared or saved list's content is never a frozen copy), and its
discovery/notification patterns. Where this spec differs from `food-lists` is called out
explicitly in the Glossary and in Requirement 13 (visit/rating context) and Requirement 14 (trip
attachment) — everywhere else, assume `food-lists`' behavior applies unchanged to the
Experience-scoped equivalent.

**Why a separate table from `Food_List` rather than a generalized "list" table covering both:**
`Food_List_Item` references a `food_items` catalog row scoped to a Restaurant_Experience;
`Experience_List_Item` references an `experiences` row directly and carries no dining-specific
concept. Unifying them would require every consumer of either table to branch on which kind of
item a row holds for no shared behavior gained; keeping them separate, structurally-identical
tables costs a small amount of schema duplication in exchange for two simple, independently
reasoned-about domains — consistent with `food-lists`' own precedent of not merging with the
pre-existing `shares`/`share_recipients` point-in-time sharing mechanism for the same reason.

**Why this is not a replacement for `planned_items`:** a Trip's `Planned_List` (`planned_items`)
is trip-scoped and date-bearing — it is the sole input to the day-planning optimizer
(`day-planning-optimization`) and the sole home for Reservation state (`trip-reservations`). An
Experience_List is trip-independent and dateless — reusable across trips, shareable, and
meaningful with no trip in existence at all. Attaching an Experience_List to a Trip (Requirement
14) grants convenient browsing access while building that trip's plan; it never converts an
Experience_List_Item into a `planned_items` row automatically, and it never becomes a second
input to the optimizer. Adding an Experience_List item to a trip's schedule still goes through
the existing, unchanged `POST /trips/:id/planned-items` — the same action available from direct
catalog search.

**Cross-spec dependencies:**
- Depends on `experience-activity-logging` for `experience_logs` (Requirement 13's visit/rating
  projection reads this table) and its `GET /me/experiences/:id/logs` / `POST
  /me/experiences/:id/logs` endpoints (Requirement 13.5 reuses the existing `LogVisitModal` flow
  unchanged).
- Depends on `food-lists` as the structural precedent this spec mirrors line-for-line for
  create/rename/delete, sharing, discovery, likes/saves, and notifications. Build `food-lists`
  first if it has not already shipped (it has, per its own tasks.md).
- Depends on `social-sharing-loop` for the canonical `friendships` pair-check pattern reused by
  Requirement 4 (`Experience_List_Share` friend verification), identical to `food-lists`
  Requirement 4.1.
- **Downstream cross-spec dependency:** Requirement 14 (Attach an Experience List to a Trip) and
  Requirement 15 (Experience List as a Schedule Builder candidate source) touch `trips`' and
  `day-planning-optimization`'s mobile surfaces (`ExperiencePicker`, `TripPlannedListScreen`,
  `TripScheduleScreen`). Those two requirements are specified here (this is the owning spec for
  the new bridge table and the picker's new candidate source) but their tasks should be
  sequenced after confirming `trips`' `trip_food_lists` bridge (Requirement 22 there) is the
  exact pattern being mirrored — read that requirement and its migration
  (`0042_trip_food_lists.sql`) before implementing Requirement 14's migration here.

## Glossary

- **App**: The mobile client and web interfaces of the Disney World Tracker.
- **User**: An authenticated user of the App.
- **Experience**: A catalog entry with an `ExperienceCategory` (`Ride`, `Show`, `Restaurant`,
  `Parade`, `Character_Meet`, `Walkthrough`, `PlayArea`, `Game`, `Tour`, `Recreation`, `Spa`,
  `Event`, `Other`, `Resort`), as defined by the base catalog.
- **Eligible Experience**: An Experience whose `category` is anything other than `Restaurant`.
  Only Eligible Experiences may be added to an Experience_List (Requirement 2.3).
- **Experience_List**: A named, owned collection of Eligible Experiences, persisted in
  `experience_lists`, with a `visibility` of `private` or `public`. Unlike `Food_List`,
  `Experience_List` has no `isChecklist` flag and no manually-toggled done state — done-state is
  always derived from the User's own `experience_logs` (Requirement 13), because unlike a
  `Food_Item`, an Experience already has an unambiguous, automatically-populated visit record to
  derive it from.
- **Experience_List_Item**: One Eligible Experience's membership in an Experience_List, with an
  ordering position and the User who added it, persisted in `experience_lists_items`.
- **Experience_List_Role**: The access level an `Experience_List_Share` grants — `viewer` (can
  see the list's contents) or `editor` (can additionally add, remove, and reorder items). The
  owner always has full control regardless of role and is never represented by an
  `Experience_List_Share` row.
- **Experience_List_Share**: A persistent grant of view or edit access to a `private`
  Experience_List for one specific Friend, carrying an `Experience_List_Role`, persisted in
  `experience_list_shares`.
- **Experience_List_Like**: A User's like of an Experience_List they can currently view (public,
  or private-and-shared-with-them), persisted in `experience_list_likes`.
- **Experience_List_Save**: A User's addition of someone else's Experience_List to their own
  "My Lists" collection as a live reference (not a copy), persisted in `experience_list_saves`.
- **Experience_List_Service**: The backend service owning `experience_lists`,
  `experience_lists_items`, `experience_list_shares`, `experience_list_likes`,
  `experience_list_saves`.
- **Visit_Summary**: A per-Experience, per-viewing-User projection of `{ repeatCount, ratedCount,
  averageRating }` derived at read time from that User's own `experience_logs` rows for that
  Experience — never stored on `Experience_List_Item`. `repeatCount` is the count of that User's
  logs for the Experience (`0` if never logged); `ratedCount` is the count of those logs with a
  non-null `rating`; `averageRating` is `ROUND(AVG(rating), 1)` over the rated logs, or `null`
  when `ratedCount` is `0`. This mirrors the same per-experience averaging already shown on
  `ParkPassportCard` (`experience-activity-logging` Requirement 17), computed in one batched
  query rather than the per-experience fetch that component uses today.
- **Trip_Experience_List**: A link recording that a Trip's members are using a specific
  Experience_List for reference/browsing while planning that Trip, persisted in
  `trip_experience_lists`. Structurally and behaviorally identical to `trips`' own
  `Trip_Food_List` (Requirement 22 there) — a pure view-access bridge, never a scheduling link.

## Requirements

### Requirement 1: Create, Rename, and Delete an Experience List

**User Story:** As a User, I want to create a named list of rides/shows/experiences for whatever
purpose I want (favorites, a want-to-do list, a themed collection), rename it, and delete it
when I no longer need it.

#### Acceptance Criteria

1. WHEN a User submits a request to create an Experience_List (`POST /me/experience-lists`) with
   a `name` (1–100 chars, trimmed), THE Experience_List_Service SHALL create a new
   `Experience_List` owned by that User with `visibility = 'private'` by default and return its
   `id`, `name`, `visibility`, `createdAt`, `updatedAt`.
2. WHERE a create request (Requirement 1.1) supplies an optional `visibility` of `'private'` or
   `'public'`, THE Experience_List_Service SHALL create the `Experience_List` with that
   `visibility` instead of the default. IF `visibility` is present but is neither `'private'`
   nor `'public'`, THE Experience_List_Service SHALL reject the request with HTTP `400` and
   error code `validation_failed`, creating no row.
3. WHEN the owning User submits a rename (`PATCH /me/experience-lists/:id` with a new `name`),
   THE Experience_List_Service SHALL update the `Experience_List`'s `name` and `updatedAt`,
   rejecting an empty-after-trim or over-100-character name with HTTP `400` and error code
   `validation_failed`.
4. WHEN the owning User requests deletion (`DELETE /me/experience-lists/:id`), THE
   Experience_List_Service SHALL remove the `Experience_List` along with all its
   `Experience_List_Item`, `Experience_List_Share`, `Experience_List_Like`, and
   `Experience_List_Save` rows (cascade), returning HTTP `204`.
5. IF a rename or delete request targets an Experience_List not owned by the requesting User
   (including a non-existent id), THE Experience_List_Service SHALL reject the request with
   HTTP `404` and error code `experience_list_not_found` — ownership and existence collapse to
   the same non-probing response.
6. WHEN a User requests their own Experience_Lists (`GET /me/experience-lists`), THE
   Experience_List_Service SHALL return every Experience_List that User owns, each with its
   `visibility`, `likeCount`, and item count, ordered by `updatedAt DESC`.

### Requirement 2: Manage Experience List Membership

**User Story:** As a User (the owner, or a collaborator granted editor access), I want to add
and remove specific rides, shows, or other experiences from a list and control their order, so
the list reflects exactly what I (or the group) want, in the order wanted.

#### Acceptance Criteria

1. WHEN a User with edit access to an Experience_List — the owner, OR a User with an active
   `Experience_List_Share` whose `role = 'editor'` — adds an Experience (`POST
   /me/experience-lists/:id/items` with `experienceId`), THE Experience_List_Service SHALL
   insert an `Experience_List_Item` at the end of the list's current ordering (`position =
   max(position) + 1`, or `0` if empty), recording `added_by_user_id` as the requesting User,
   and update the Experience_List's `updatedAt` and increment its `version`.
2. IF the `experienceId` is already present in that Experience_List, THE
   Experience_List_Service SHALL reject the request with HTTP `409` and error code
   `experience_list_item_duplicate` without creating a second row. The same Experience MAY
   appear on multiple different Experience_Lists the User owns — this restriction applies only
   within one list.
3. IF the `experienceId` does not reference an existing, active Experience, THE
   Experience_List_Service SHALL reject the request with HTTP `404` and error code
   `experience_not_found`. IF the referenced Experience's `category` is `Restaurant`, THE
   Experience_List_Service SHALL reject the request with HTTP `400` and error code
   `experience_list_dining_ineligible` — dining stays exclusively in `Food_List`'s domain; this
   check runs before the duplicate check in Requirement 2.2.
4. WHEN a User with edit access removes an item (`DELETE
   /me/experience-lists/:id/items/:experienceId`), THE Experience_List_Service SHALL delete that
   `Experience_List_Item` regardless of which User originally added it, update the
   Experience_List's `updatedAt`, and increment its `version`, returning HTTP `204`; remaining
   items' relative order SHALL be preserved.
5. WHEN a User with edit access reorders items (`PUT /me/experience-lists/:id/items/order` with
   an ordered array of every current `experienceId` in the list and the `expectedVersion` last
   read for that list), THE Experience_List_Service SHALL, IF `expectedVersion` matches the
   Experience_List's current `version`, update each item's `position` to match the submitted
   order, update the Experience_List's `updatedAt`, and increment its `version`.
6. IF a reorder request's array does not contain exactly the same set of `experienceId`s
   currently in the Experience_List (missing, extra, or duplicate ids), THE
   Experience_List_Service SHALL reject the request with HTTP `400` and error code
   `experience_list_reorder_mismatch` without applying any position change.
7. IF a reorder request's `expectedVersion` does not match the Experience_List's current
   `version` at the time of the write, THE Experience_List_Service SHALL reject the request with
   HTTP `409` and error code `experience_list_stale_write` without applying any position change.
8. IF an add/remove/reorder request targets an Experience_List that does not exist or that the
   requesting User has no access to at all (not owner, no `Experience_List_Share` of any role,
   and not public), THE Experience_List_Service SHALL reject the request with HTTP `404` and
   error code `experience_list_not_found`.
9. IF an add/remove/reorder request targets an Experience_List the requesting User can view
   (public, or a `viewer`-role share) but cannot edit (not the owner and no `editor`-role
   share), THE Experience_List_Service SHALL reject the request with HTTP `403` and error code
   `experience_list_edit_forbidden`.
10. THE Experience_List_Service SHALL return `addedByUserId` and `addedByDisplayName` for each
    item in an Experience_List's contents (`GET /experience-lists/:id`), so collaborators can
    see who added each item.

### Requirement 3: Visibility — Public and Private Lists

**User Story:** As a User, I want to choose whether my list is private (visible only to people I
explicitly share it with) or public (visible to anyone), so I control who sees my lists.

#### Acceptance Criteria

1. WHEN the owning User changes an Experience_List's visibility (`PATCH
   /me/experience-lists/:id` with `visibility: 'public' | 'private'`), THE
   Experience_List_Service SHALL update the `visibility` column and the Experience_List's
   `updatedAt`.
2. WHERE an Experience_List's `visibility` is `public`, THE Experience_List_Service SHALL allow
   any authenticated User to view its contents (`GET /experience-lists/:id`) regardless of
   friendship or an explicit `Experience_List_Share` grant.
3. WHERE an Experience_List's `visibility` is `private`, THE Experience_List_Service SHALL allow
   only the owner and Users with an active `Experience_List_Share` grant for that list to view
   its contents; every other User's `GET /experience-lists/:id` SHALL be rejected with HTTP
   `404` and error code `experience_list_not_found`.
4. WHEN a `public` Experience_List is changed to `private`, THE Experience_List_Service SHALL
   leave its existing `Experience_List_Share` grants intact but SHALL cause any
   `Experience_List_Save` held by a User without a share grant, and any `Experience_List_Like`
   from such a User, to no longer resolve to viewable content on next read (Requirement 6.4
   governs the exact surfaced state).

### Requirement 4: Share a Private List with a Friend (Live Access, Viewer or Editor)

**User Story:** As a User, I want to share one of my private lists with a specific friend —
either so they can just see what I'm interested in, or so they can actively help me build the
list together — and have it stay current as anyone with access edits it.

#### Acceptance Criteria

1. WHEN the owning User shares a private Experience_List with a Friend (`POST
   /me/experience-lists/:id/shares` with `recipientId` and `role: 'viewer' | 'editor'`), THE
   Experience_List_Service SHALL verify `recipientId` is a Friend of the owner using the
   canonical `friendships` `(lo, hi)` pair check (identical to `food-lists` Requirement 4.1), and
   on success insert an `Experience_List_Share` row with that `role` granting persistent access.
2. IF `recipientId` is not a Friend of the owner, THE Experience_List_Service SHALL reject the
   request with HTTP `403` and error code `experience_list_share_not_friend`, inserting no
   `Experience_List_Share` row.
3. IF an `Experience_List_Share` already exists for that `(experienceListId, recipientId)` pair,
   THE Experience_List_Service SHALL update its `role` to the newly submitted value (HTTP `200`,
   returning the updated grant) rather than raising a duplicate error.
4. WHEN the owning User revokes a share (`DELETE
   /me/experience-lists/:id/shares/:recipientId`), THE Experience_List_Service SHALL delete the
   `Experience_List_Share` row regardless of its `role`, returning HTTP `204`.
5. WHEN two Users' `friendships` row is deleted, THE Experience_List_Service SHALL delete every
   `Experience_List_Share` row between those two specific Users in both directions, regardless
   of `role`.
6. THE Experience_List_Service SHALL NOT send a push notification for any Experience_List
   content change (item add/remove/reorder) after the initial share — only the first
   `Experience_List_Share` grant triggers a one-time notification (Requirement 8.1), and only a
   role change (Requirement 4.3) triggers a separate one-time notification (Requirement 8.3).
7. ONLY the owning User SHALL be permitted to create, change the role of, or revoke an
   `Experience_List_Share`; an `editor`-role User attempting any of these SHALL be rejected with
   HTTP `403` and error code `experience_list_edit_forbidden`.

### Requirement 5: Browse and Discover Public Lists

**User Story:** As a User, I want to browse public lists other people have made, sorted by
popularity or recency, so I can find good ride/experience lists without knowing the creator.

#### Acceptance Criteria

1. WHEN a User requests the discovery feed (`GET
   /experience-lists/discover?sort=popular|recent&cursor=...`), THE Experience_List_Service
   SHALL return only `public` Experience_Lists, paginated, sorted by `likeCount DESC, id ASC`
   for `sort=popular` or `createdAt DESC, id ASC` for `sort=recent`.
2. THE Experience_List_Service SHALL include, for each discovery result, the Experience_List's
   `id`, `name`, `ownerId`, `ownerDisplayName`, `likeCount`, item count, and `createdAt`.
3. THE Experience_List_Service SHALL default `sort` to `popular` when omitted and reject any
   other `sort` value with HTTP `400` and error code `validation_failed`.

### Requirement 6: Like and Save an Experience List

**User Story:** As a User, I want to like lists I find interesting and save other people's lists
into my own collection so I can find them again later, without duplicating the data.

#### Acceptance Criteria

1. WHEN a User likes an Experience_List they currently have view access to (`POST
   /experience-lists/:id/like`), THE Experience_List_Service SHALL insert an
   `Experience_List_Like` row (idempotent) and increment the Experience_List's denormalized
   `likeCount` transactionally with the insert.
2. IF a User attempts to like an Experience_List they do not currently have view access to, THE
   Experience_List_Service SHALL reject the request with HTTP `404` and error code
   `experience_list_not_found`.
3. WHEN a User unlikes an Experience_List (`DELETE /experience-lists/:id/like`), THE
   Experience_List_Service SHALL delete their `Experience_List_Like` row (idempotent) and
   decrement the denormalized `likeCount` transactionally.
4. WHEN a User saves someone else's viewable Experience_List (`POST
   /experience-lists/:id/save`), THE Experience_List_Service SHALL insert an
   `Experience_List_Save` row referencing the original `Experience_List` (not a copy of its
   items).
5. IF a User attempts to save an Experience_List they do not currently have view access to, THE
   Experience_List_Service SHALL reject the request with HTTP `404` and error code
   `experience_list_not_found`.
6. IF a User attempts to save their own Experience_List, THE Experience_List_Service SHALL
   reject the request with HTTP `400` and error code `experience_list_save_self`.
7. WHEN a User requests their list collection (`GET /me/experience-lists/collection`), THE
   Experience_List_Service SHALL return two groups: `owned` and `saved`, with each `saved` entry
   marked `available: false` in place of its content WHERE the referenced Experience_List is no
   longer viewable by that User.
8. WHEN the owning User deletes an Experience_List, THE Experience_List_Service SHALL
   cascade-delete every `Experience_List_Save` referencing it.

### Requirement 7: View an Experience List's Contents

**User Story:** As a User with access to a list, I want to see its current items and my own
role on the list, so I know what's actually in it right now and whether I can edit it.

#### Acceptance Criteria

1. WHEN a User with view access requests an Experience_List's contents (`GET
   /experience-lists/:id`), THE Experience_List_Service SHALL return the list's `id`, `name`,
   `visibility`, `ownerId`, `ownerDisplayName`, `likeCount`, `version`, the requesting User's own
   `liked`/`saved` flags and `myRole` (`'owner' | 'editor' | 'viewer'`), and its `items` (each
   with `experienceId`, `name`, `park`, `category`, `position`, `addedByUserId`,
   `addedByDisplayName`) ordered by `position ASC`, reflecting current state at read time.
2. THE Experience_List_Service SHALL compute view access identically across `GET
   /experience-lists/:id`, like, save, and share-revocation-driven access checks: owner, OR
   `visibility = 'public'`, OR an active `Experience_List_Share` grant of either role.
3. THE Experience_List_Service SHALL compute edit access as: owner, OR an active
   `Experience_List_Share` grant with `role = 'editor'`.

### Requirement 8: Share Notification

**User Story:** As a User, I want to be notified once when a friend shares a list with me or
changes my role on it, so I know to go look at it, without being spammed every time the list's
contents change.

#### Acceptance Criteria

1. WHEN an `Experience_List_Share` row is newly inserted (first-time grant only), THE
   Experience_List_Service SHALL dispatch a one-time push notification to the recipient via the
   existing Notification_Service background port, gated by the recipient's existing push
   notification master toggle, fire-and-forget so the `POST /me/experience-lists/:id/shares`
   response is never blocked or failed by notification delivery.
2. THE Experience_List_Service SHALL NOT dispatch any notification for an
   Experience_List_Like, Experience_List_Save, item add/remove/reorder, or a role change that
   leaves the `role` unchanged.
3. WHEN an existing `Experience_List_Share`'s `role` is changed to a different value, THE
   Experience_List_Service SHALL dispatch a separate one-time push notification to the
   recipient, gated and delivered the same way as Requirement 8.1.

### Requirement 9: Discover and Add Experiences to a List (Mobile)

**User Story:** As a User, I want to add rides/shows/experiences to my lists either while
looking at a specific Experience or from within a list itself, so building a list fits how I
actually browse the app.

#### Acceptance Criteria

1. WHEN the App renders the Experience Detail screen for an Eligible Experience, THE App SHALL
   provide a way to add that Experience to a list, distinct in mechanism from adding it to a
   Trip (adding to a list never creates a `planned_items` row, and adding to a trip never
   requires an Experience_List to exist) — as of Requirement 17, this is surfaced as one of the
   two choices in the Floating_Action_Dock's merged "Add to Trip or List" action rather than a
   separate always-visible card; see Requirement 17 for the exact merged presentation. Experience
   Detail for a `Restaurant` Experience SHALL NOT offer this choice (dining stays exclusively in
   the existing `Food_List` "Add to a list" flow, itself surfaced through `RestaurantDishLogCard`,
   unaffected by Requirement 17).
2. WHEN the User selects "Add to a list" from an Eligible Experience's detail screen, THE App
   SHALL present the User's owned Experience_Lists as a multi-select list, including a "Create
   new list" action that creates an Experience_List inline (per Requirement 1.1) without leaving
   the flow.
3. WHERE an Experience being added is already present in one of the User's Experience_Lists, THE
   App SHALL pre-select that Experience_List in the multi-select step; deselecting a
   pre-selected Experience_List SHALL remove the item from it and selecting a new one SHALL add
   it — the step behaves as a toggle, not an add-only action.
4. WHEN the User confirms changes across one or more Experiences and Experience_Lists, THE App
   SHALL submit one request per changed `(list, item)` pair and treat an
   `experience_list_item_duplicate` response as already-satisfied rather than surfacing an error.
5. WHEN the User opens an Experience_List they have edit access to (`ExperienceListDetailScreen`,
   Requirement 11.1) and activates "Add items," THE App SHALL open a catalog search/browse step
   scoped to non-`Restaurant` categories, with the target Experience_List already determined,
   without a second list-selection step.
6. THE App SHALL restrict every list-selection surface in this flow (Requirement 9.2) to
   Experience_Lists the User owns; a saved-but-not-owned or editor-shared-but-not-owned
   Experience_List SHALL NOT appear in that multi-select checklist. Entry point 2 (Requirement
   9.5) is unaffected since its target list is already determined by which list's detail screen
   the User opened.
7. THE App SHALL provide a visible removal action on each item row within an Experience_List's
   detail view for a User with edit access, invoking `DELETE
   /me/experience-lists/:id/items/:experienceId`.
8. WHERE the owning User views a private Experience_List's detail screen, THE App SHALL provide
   a "Manage sharing" surface listing every User the list is currently shared with and their
   `role` (sourced from `GET /me/experience-lists/:id/shares`), each with a revoke action and a
   role-change control.

### Requirement 10: Notification Tap Deep-Links to the Shared List

**User Story:** As a User who receives a "shared an experience list with you" or role-change
notification, I want tapping it to take me straight to that list.

#### Acceptance Criteria

1. WHEN a User taps the push notification dispatched per Requirement 8.1 or 8.3, THE App SHALL
   navigate to `ExperienceListDetailScreen` for the `experienceListId` carried in the
   notification's `data` payload, using a dedicated tap classification distinct from the
   existing Food_List, Share, friend-request, Trip_Invite, and Rode_With_Tag classifications.
2. IF the tapped notification's target Experience_List is no longer accessible to the User by
   the time the tap is handled, THE App SHALL show a "no longer available" message rather than a
   raw error.

### Requirement 11: Collaborative Editing UI

**User Story:** As a User with editor access to a shared list, I want to add and remove items
myself and see who added what.

#### Acceptance Criteria

1. WHEN the App renders `ExperienceListDetailScreen` for an Experience_List where the User's
   `myRole` is `owner` or `editor`, THE App SHALL show the "Add items" entry point and a removal
   action on each item row; WHERE `myRole` is `viewer`, THE App SHALL render the list read-only.
2. THE App SHALL render each item row with a small attribution label showing
   `addedByDisplayName` WHERE the list has more than one distinct `addedByUserId` among its
   items.
3. WHEN an `editor`-role User's reorder submission is rejected with
   `experience_list_stale_write`, THE App SHALL refetch the list's current contents and version,
   then show a brief "list was updated" message rather than silently discarding the User's
   intended order.
4. WHEN the owning User shares a list or changes an existing recipient's role via
   `ManageExperienceListSharesSheet`, THE App SHALL present a `viewer`/`editor` toggle or picker
   per recipient rather than a share action with no role choice.

### Requirement 12: Collection Entry Point to Experience Lists

**User Story:** As a User, I want a direct way to get to my experience lists (and from there,
public ones) from my Collection tab, the same way I already reach my food lists.

**Amendment (relocated per `navigation-redesign` Requirement 6's amendment):** the "Food & Lists"
sub-view referenced in Requirement 12.1 below has been split into separate "Food" and "Lists"
segments — see `navigation-redesign` Requirement 6.8b. The "My Experience Lists" affordance now
lives in the "Lists" segment, alongside "My Food Lists" as an equal-weight peer, not inside a
food-oriented view. Requirement 12.1's acceptance criterion is left unchanged as historical
record; read "Food & Lists sub-view" there as "Lists segment."

#### Acceptance Criteria

1. THE App SHALL provide a "My Experience Lists" affordance in the Food & Lists sub-view of
   `CollectionScreen.tsx`, placed alongside the existing "My Food Lists" entry point, that
   navigates to `MyExperienceListsScreen`.
2. The "View your experience lists" affordance SHALL be visible and functional regardless of
   whether the viewing User owns, has saved, or has been shared any Experience_List.
3. `MyExperienceListsScreen`'s header SHALL provide the sole navigational path into
   `ExperienceListDiscoveryScreen`.
4. WHEN a User views `MyExperienceListsScreen`, THE App SHALL render an accessible back control
   in the header that navigates back to the previous screen (or `MainTabs` if no history
   exists).

### Requirement 13: Personal Visit History and Rating on List Items

**User Story:** As a User looking at one of my experience lists, I want to see how many times
I've done each ride and my average rating for it, and be able to log a new visit right from the
list, so the list doubles as a quick personal reference without me having to look each item up
separately.

#### Acceptance Criteria

1. WHEN the App renders an Experience_List's contents, THE App SHALL fetch a Visit_Summary for
   every visible Experience_List_Item's `experienceId` in a single batched request (`GET
   /me/experiences/visit-summary?ids=id1,id2,...`) rather than one request per item.
2. THE Experience_List_Service (or the owning `experience-activity-logging` service, whichever
   owns `experience_logs` reads) SHALL compute, for the requesting User and each requested
   `experienceId`, `repeatCount` (total log count for that User and Experience), `ratedCount`
   (count of those logs with non-null `rating`), and `averageRating` (`ROUND(AVG(rating), 1)`
   over rated logs, or `null` when `ratedCount` is `0`), in one grouped SQL query across all
   requested ids rather than a per-id query.
3. WHERE `repeatCount` is `0` for an item, THE App SHALL render that item as not yet done (no
   visit badge). WHERE `repeatCount` is greater than `0` and `ratedCount` is `0`, THE App SHALL
   render a visit-count badge (e.g. "2 visits") with no rating. WHERE `ratedCount` is greater
   than `0`, THE App SHALL render both the visit count and `averageRating` (e.g. "4 visits · ★
   10.0"), consistent with the wording already used on `ParkPassportCard`
   (`experience-activity-logging` Requirement 17.2).
4. Experience_List done/not-done state SHALL always be derived from `repeatCount > 0` for the
   viewing User; THE Experience_List_Service SHALL NOT persist any manual "done"/"gotten" flag
   on `Experience_List_Item` — this differs deliberately from `Food_List`'s `isChecklist`/
   `gotten` mechanism (Requirement 13 there), which exists only because a `Food_Item` has no
   automatically-populated visit record to derive completion from; an Experience already does,
   via `experience_logs`.
5. WHEN the App renders an Experience_List_Item row, THE App SHALL provide a "Log a visit"
   action that opens the existing `LogVisitModal` (from `experience-activity-logging`)
   pre-filled with that item's `experienceId` and a default `visitedOn` of the current date,
   invoking the same `POST /me/experiences/:id/logs` endpoint used from Experience Detail — no
   new logging UI or endpoint is introduced by this requirement.
6. WHEN a visit is logged via Requirement 13.5 for an Experience currently visible in an open
   Experience_List view, THE App SHALL invalidate and refetch that list's Visit_Summary so the
   item's done-state and rating badge update without requiring the User to leave and re-enter
   the list.
7. THE Visit_Summary computed by this requirement is per-viewing-User and is never shared,
   displayed to, or computed for any other User viewing the same Experience_List (e.g. via a
   share or save) — each viewer sees only their own visit/rating history, consistent with the
   list's shared content (the Experience references) being distinct from each viewer's private
   visit history.

### Requirement 14: Attach an Experience List to a Trip

**User Story:** As a Trip_Member, I want to attach one of my own or a public Experience_List to
a Trip, so that the group can browse the rides/shows we're interested in during the visit
without me having to individually share the list with everyone.

#### Acceptance Criteria

1. WHEN a Trip_Member attaches an Experience_List to a Trip (`POST
   /trips/:id/experience-lists` with `experienceListId`), THE Trip_Service SHALL verify the
   requesting Trip_Member owns the Experience_List or it is `public`, and on success insert a
   `Trip_Experience_List` row recording `added_by = ` the requesting Trip_Member, granting every
   current and future Trip_Member view-only access to that Experience_List for as long as the
   link exists — computed live via an additional OR-branch on the Experience_List view-access
   predicate (Requirement 7.2), mirroring `trips` Requirement 22.3 exactly.
2. IF the requesting Trip_Member neither owns the Experience_List nor it is `public`, THE
   Trip_Service SHALL reject the attach request with HTTP `403` and error code
   `trip_experience_list_ineligible`, inserting no row.
3. THE `(trip_id, experience_list_id)` pair SHALL be unique — a second attach attempt for an
   already-attached pair SHALL be treated as a no-op success (`INSERT ... ON CONFLICT DO
   NOTHING`, returning HTTP `200`/`204` without error), mirroring `trips` Requirement 22.2
   exactly.
4. WHEN a Trip_Member detaches an Experience_List (`DELETE
   /trips/:id/experience-lists/:experienceListId`), THE Trip_Service SHALL require the
   requesting Trip_Member be either the Trip_Member who attached it or a Trip Organizer,
   mirroring the existing `removePlannedItem` adder-or-organizer rule.
5. THE Trip_Experience_List link SHALL reference the same canonical Experience_List and SHALL
   NOT copy its name, items, or any other content.
6. WHEN a Trip is deleted, THE Trip_Service SHALL cascade-delete its `Trip_Experience_List` rows
   without touching the referenced Experience_List itself.
7. WHEN the `experience_lists.id` referenced by a `Trip_Experience_List` row is deleted, THE
   `trip_experience_lists.experience_list_id` foreign key SHALL be `ON DELETE CASCADE`, removing
   the link in the same transaction rather than leaving a dangling reference.
8. WHEN the Trip_Detail_View displays a Trip's attached Experience_Lists, THE App SHALL display
   each Experience_List's name, item count, and owner display name; IF resolving a linked
   Experience_List fails for any reason other than the link no longer existing, THE Trip_Service
   SHALL project that entry as unavailable (carrying only its `experienceListId`) rather than
   omitting it or erroring the whole read.
9. Attaching an Experience_List to a Trip SHALL NOT create, modify, or delete any `planned_items`
   row — it is a view-access grant only, exactly as Requirement 14's introduction states.

### Requirement 15: Experience List as a Schedule Builder and Planned List Candidate Source

**User Story:** As a Trip_Member building my day's schedule or adding to the trip's overall
plan, I want to pick from an experience list I've attached to the trip instead of always
searching the whole catalog, so adding something I already know I want to do is fast.

#### Acceptance Criteria

1. THE shared `ExperiencePicker` component (used by both `TripPlannedListScreen`'s add-item flow
   and `TripScheduleScreen`'s add-item flow) SHALL gain a candidate source scoped to the Trip's
   currently-attached Experience_Lists (Requirement 14), presented as an additional tab or
   filter alongside the existing All/Rides/Dining/Shows/Breaks catalog tabs.
2. WHERE a Trip has more than one Experience_List attached, THE ExperiencePicker's list-sourced
   candidate view SHALL present the union of all attached lists' items as one flat, deduplicated
   result set (an Experience present on two attached lists appears once), rather than requiring
   the User to first choose which attached list to browse.
3. WHERE a Trip has zero Experience_Lists attached, THE ExperiencePicker SHALL omit the
   list-sourced tab/filter entirely rather than showing it empty.
4. WHEN a User selects an Experience from the list-sourced candidate view, THE App SHALL submit
   the exact same `POST /trips/:id/planned-items` request (bare `experienceId` plus, from
   `TripScheduleScreen`, the active `plannedDate`) as selecting the same Experience from ordinary
   catalog search — selection behavior does not differ by candidate source.
5. THE list-sourced candidate view SHALL indicate, per item, whether that Experience is already
   present as a `planned_items` row on the current Trip (any date), using the same derived,
   experienceId-matched presentation approach as `planned-list-completion-sync`, so a
   Trip_Member does not have to guess whether they already added something from their list.
6. THE ExperiencePicker SHALL NOT persist any link between an Experience_List_Item and the
   `planned_items` row created when it is selected (Requirement 15.4) — no
   `source_experience_list_item_id` or equivalent provenance column is introduced by this
   feature; Requirement 15.5's "already added" indication is computed by `experienceId` match
   alone, not by a stored reference.

### Requirement 16: Consolidate Per-Experience Average Rating Onto One Computation

**User Story:** As a developer maintaining this app, I want there to be exactly one place that
computes a User's average rating for an Experience across their repeat visits, so the number
shown on `ParkPassportCard` and the number shown on an Experience_List item can never silently
disagree.

#### Acceptance Criteria

1. WHEN the App renders `ParkPassportCard` for an Experience, THE App SHALL source that card's
   `averageRating` and rated-visit count from `GET /me/experiences/visit-summary` (Requirement
   13.1's endpoint, called with that single `experienceId`) rather than computing an average or
   rated-count by reducing over the `logs` array already returned by `GET
   /me/experiences/:id/logs`.
2. `ParkPassportCard` SHALL continue to source its visit-history timeline (the expandable
   per-visit list of dates/ratings/notes) from `GET /me/experiences/:id/logs` unchanged — this
   requirement affects only where the summary average/count is read from, not the detailed
   per-visit list, which `GET /me/experiences/visit-summary` does not return.
3. THE App SHALL NOT contain, after this change, any client-side computation that averages or
   rounds a set of `rating` values drawn from `experience_logs` for the purpose of displaying a
   per-experience average — every such display SHALL read a pre-computed `averageRating` from
   `GET /me/experiences/visit-summary`.

### Requirement 17: Merge "Add to Trip" and "Add to a List" Into One Floating_Action_Dock Choice

**User Story:** As a mobile user, I want the Floating_Action_Dock's secondary action to offer me
a choice between adding an Experience to a Trip or to one of my Experience_Lists, so I don't have
to already know a second, separately-placed "Add to a list" control exists elsewhere on the
screen to discover that option.

#### Acceptance Criteria

1. WHERE the Experience category is `Ride`, `Character_Meet`, `Show`, or `Resort` (every category
   the Floating_Action_Dock's secondary action currently labels "Add to Trip," per
   `experience-detail-redesign` Requirement 19.2, 19.3, and 20.5), THE Floating_Action_Dock SHALL
   relabel that secondary action "Add to…" and, WHEN activated, present a small two-option choice
   (`Add to Trip`, `Add to a List`) rather than immediately invoking the existing add-to-trip
   handler.
2. WHEN the User selects `Add to Trip` from the choice presented by Requirement 17.1, THE App
   SHALL invoke the exact same existing handler (`handleAddToPlan`) the dock's secondary action
   invoked before this requirement — no change to that handler, its trip-resolution logic, or its
   `POST /trips/:id/planned-items` call.
3. WHEN the User selects `Add to a List` from the choice presented by Requirement 17.1, THE App
   SHALL open the existing `AddToExperienceListsSheet` (Requirement 9.2) for that Experience — no
   change to that sheet or its endpoints.
4. THE standalone `AddToExperienceListCard` ("Save this for later" card, previously always
   visible on the My_Passport_And_Lore_Lens for every non-Restaurant category) SHALL be removed
   now that its only action is reachable through the merged dock choice (Requirement 17.1); this
   is a removal of a now-redundant surface, not a removal of the underlying "add to a list"
   capability, which is preserved unchanged by Requirement 17.3.
5. WHERE the Experience category is `Restaurant`, THE Floating_Action_Dock's secondary action
   SHALL remain exactly as `experience-detail-redesign` Requirement 19.4 specifies (`Reserve
   Table` or, for quick-service, `Add to Trip` invoked directly with no choice) — this
   requirement does not alter the Restaurant case, since dining's "add to a list" affordance
   (`RestaurantDishLogCard`'s Food_List button) already lives outside the dock and is unaffected.
6. THE two-option choice presented by Requirement 17.1 SHALL be dismissible without taking either
   action (e.g. a Cancel control or backdrop tap), leaving no `planned_items` row created and no
   Experience_List modified.
7. THE Floating_Action_Dock's accessibility label for the relabeled secondary action SHALL read
   "Add to trip or list" (or equivalent non-empty label conveying both options), consistent with
   `experience-detail-redesign` Requirement 19.6's existing non-empty-label requirement — this
   fuller accessibility label is retained even though the visible on-screen label is the shorter
   "Add to…", so a screen-reader User still hears both destinations named even though a sighted
   User sees the compact ellipsis form.

### Requirement 18: Choosing a Trip When Adding an Experience to a Trip

**User Story:** As a User with more than one active or upcoming Trip, I want to choose which
Trip an Experience gets added to instead of having the App silently pick one for me, so an
Experience never lands on the wrong Trip's plan without my knowledge — matching how choosing an
Experience_List already works (Requirement 9.2's list picker), rather than the two flows behaving
differently from each other.

**Note on scope:** this requirement is not about Experience_Lists — it is a trip-selection fix to
the "Add to Trip" action itself (`experience-detail-redesign` Requirement 19's secondary action,
now reached via Requirement 17's choice sheet). It is specified here, alongside Requirement 17,
because both requirements amend the same Floating_Action_Dock flow in the same effort; see
`experience-detail-redesign` Requirement 19's second amendment for the cross-reference.

#### Acceptance Criteria

1. WHEN the User selects `Add to Trip` (Requirement 17.2, or any other existing "Add to Trip"
   entry point that resolves a target Trip on the User's behalf), THE App SHALL present a Trip
   picker listing every Trip the User currently belongs to with status `active` or `upcoming`,
   before adding the Experience to any Trip's `planned_items` — this picker SHALL be presented
   unconditionally, including WHEN the User has exactly one eligible Trip, so the interaction is
   identical regardless of Trip count (matching Requirement 9.2's Experience_List picker, which is
   likewise always shown even for a User who owns exactly one Experience_List).
2. WHEN the User selects a Trip from the picker presented by Requirement 18.1, THE App SHALL
   submit `POST /trips/:id/planned-items` for that specific Trip's `id` — no change to that
   existing endpoint or its request body.
3. IF the User has zero Trips with status `active` or `upcoming`, THE App SHALL present the
   existing "No Active Trip" alert (unchanged copy and "Go to Trips"/"Cancel" actions) instead of
   an empty picker.
4. THE Trip picker presented by Requirement 18.1 SHALL be dismissible without selecting a Trip
   (e.g. a Cancel control or backdrop tap), leaving no `planned_items` row created.
5. THE Trip picker SHALL display, for each listed Trip, at minimum its name and date range, so the
   User can distinguish same-named or overlapping Trips.
6. THIS requirement SHALL NOT change `handleAddToPlan`'s (or its successor's) trip-resolution
   logic for any caller other than the Floating_Action_Dock's merged choice — if another surface
   in the App independently resolves "the active or upcoming trip" without going through this
   picker, that surface is out of scope for this requirement unless separately amended.

### Requirement 19: Pin an Experience List for Priority Display

**User Story:** As a User with several Experience_Lists, I want to pin the one I'm actively
building (e.g. this trip's "Must Do" list) so it stays visible on my Collection screen's preview
instead of being pushed out by a list I only briefly touched, and I want to pin or unpin it from
either the full list-management screen or the Collection preview itself. This is the direct
Experience_List analogue of `food-lists` Requirement 14 — same mechanism, same rationale.

#### Acceptance Criteria

1. WHEN the owning User pins an Experience_List (`PATCH /me/experience-lists/:id` with `pinned:
   true`), THE Experience_List_Service SHALL set that Experience_List's `pinnedAt` to the current
   UTC timestamp and SHALL NOT change its `updatedAt` — pinning is a display-order preference, not
   a content edit.
2. WHEN the owning User unpins an Experience_List (`PATCH /me/experience-lists/:id` with `pinned:
   false`), THE Experience_List_Service SHALL set that Experience_List's `pinnedAt` to `null` and
   SHALL NOT change its `updatedAt`.
3. IF a pin/unpin request targets an Experience_List not owned by the requesting User (including a
   non-existent id), THE Experience_List_Service SHALL reject the request with the same
   ownership-collapsing response Requirement 1's rename/delete acceptance criteria already define
   (HTTP `404` `experience_list_not_found`, or HTTP `403` `experience_list_edit_forbidden` when the
   requester can view but not own the list).
4. WHEN a User requests their own Experience_Lists (`GET /me/experience-lists`, and the `owned`
   group of `GET /me/experience-lists/collection`), THE Experience_List_Service SHALL order them
   with every pinned Experience_List first (most-recently-pinned first among those), followed by
   every unpinned Experience_List ordered by `updatedAt DESC` as Requirement 1 already specifies —
   pinning never removes a list from this listing, only reorders it.
5. THE App SHALL provide a pin/unpin toggle control on each Experience_List row in
   `MyExperienceListsScreen.tsx` (alongside the existing Rename/Visibility/Delete controls) and on
   each Experience_List row rendered in the Collection screen's "My Experience Lists" preview
   (`navigation-redesign` Requirement 6's amendment 8c); both controls invoke the same `PATCH
   /me/experience-lists/:id` pin/unpin request and reflect the resulting `pinnedAt` state
   immediately.
6. THE App SHALL provide a pin/unpin toggle control in the header action row on
   `ExperienceListDetailScreen.tsx` for an owned Experience_List (`myRole === 'owner'`), with
   testID `experience-list-pin-btn`; activating it SHALL invoke `PATCH /me/experience-lists/:id`
   with `{ pinned: list.pinnedAt === null }` and immediately reflect the updated `pinnedAt` state
   with a filled pin icon and "Pinned" label when pinned, or an outline pin icon and "Pin" label
   when unpinned. For non-owners (`myRole !== 'owner'`), the pin toggle control SHALL NOT be
   rendered.
7. THE Experience_List_Service SHALL enforce a maximum of 4 pinned Experience_Lists per User.
   IF a User attempts to pin an Experience_List (`pinned: true`) when they already have 4 pinned
   Experience_Lists, THE Experience_List_Service SHALL reject the request with HTTP `400`
   `experience_list_pin_limit_reached`. THE App SHALL prevent pinning a 5th Experience_List and
   display an alert titled "Pin Limit Reached" with message "You can pin up to 4 lists to your
   dashboard. Unpin a list first to pin this one."

## Out of Scope (Future Work)

- A provenance link from a `planned_items` row back to the Experience_List_Item it was added
  from (deferred; would enable "how much of my list did I actually get to" analytics but is not
  needed for any requirement above).
- Automatic conversion of an entire Experience_List into a Trip's Planned_List in one action
  (e.g. "add all 8 items to my schedule at once"); Requirement 15 only supports selecting items
  one at a time through the picker, matching the existing single-item add flow.
- A `Restaurant`-category equivalent of Requirement 13's Visit_Summary badge on `Food_List`
  items; that remains governed by `food-lists`' own `isChecklist`/`gotten` mechanism and is
  unchanged by this spec.
