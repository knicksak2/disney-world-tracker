# Implementation Plan

## Tasks

- [x] 1. Migration and Shared Schema Contracts
  - [x] 1.1 Create migration `apps/api/migrations/0041_food_lists.sql` adding `food_lists` (with `version`), `food_lists_items` (with `added_by_user_id ON DELETE SET NULL`), `food_list_shares` (with `role` CHECK `viewer|editor`), `food_list_likes`, `food_list_saves` with all CHECK/UNIQUE constraints and indexes from design.md
  - [x] 1.2 Add migration unit test `apps/api/src/db/__tests__/migration0041.test.ts` asserting every table, constraint (including `food_lists_version_nonneg_chk`, `food_list_shares_role_chk`), the `added_by_user_id ON DELETE SET NULL` behavior, and cascade-on-delete behavior for the rest
  - [x] 1.3 Add `foodListNameSchema` to `packages/shared/src/schemas/primitives.ts`; define `FoodListDTO`, `FoodListItemDTO`, `FoodListRole`, `FoodListDetailDTO` (with `version`, `myRole`), `FoodListCollectionDTO`, `FoodListDiscoveryPageDTO`, `CreateFoodListInputDTO`, `UpdateFoodListInputDTO`, `AddFoodListItemInputDTO`, `ReorderFoodListItemsInputDTO` (with `expectedVersion`), `FoodListShareRole`, `ShareFoodListInputDTO` (with `role`), `FoodListShareDTO` (with `role`) and matching Zod schemas in `packages/shared/src/schemas/FoodList.ts`
  - [x] 1.4 Barrel the new DTOs/schemas; add `food_list_not_found`, `food_list_edit_forbidden`, `food_list_item_duplicate`, `food_list_reorder_mismatch`, `food_list_stale_write`, `food_list_share_not_friend`, `food_list_save_self` to `ERROR_CODES`/`errorCodeToHttpStatus` in `packages/shared/src/errors.ts`; add schema/error-catalog tests for valid and invalid cases

- [x] 2. Food List Ownership Repository (CRUD + Edit-Access-Scoped Membership)
  - [x] 2.1 Implement `FoodListRepo` in `apps/api/src/services/foodLists/repo.ts`: `createList`, `renameList`, `setVisibility`, `deleteList`, `listOwned(userId)`, `getListDetail(listId, viewerId)` applying the Property-3 view-access predicate and resolving `myRole`
  - [x] 2.2 Implement a shared `hasEditAccess(listId, userId)` helper (owner OR active `editor`-role share) reused by every method in 2.3; implement `FoodListItemRepo`: `addItem` (position = max+1, stamps `added_by_user_id`, bumps `version`; rejects `food_list_edit_forbidden`/`food_list_not_found` per Property 2), `removeItem` (bumps `version`; same access gating), `reorderItems(listId, userId, foodItemIds, expectedVersion)` (single transaction; all-or-nothing on id-set mismatch → `food_list_reorder_mismatch`; `expectedVersion` mismatch → `food_list_stale_write`; bumps `version` on success)
  - [x] 2.3 Write property tests `apps/api/src/services/foodLists/__tests__/foodLists.prop.test.ts` validating Property 1 (ownership-scoped list-level mutation), Property 2 (edit-access-scoped item mutation, driven by an `fc.constantFrom('owner', 'editor', 'viewer', 'none')` actor-role generator), and Property 5 (reorder atomicity/rejection/optimistic concurrency, including the concurrent-write race assertion) with `fast-check` against pg-mem

- [x] 3. Access, Sharing (Viewer/Editor Roles), and Unfriend Revocation
  - [x] 3.1 Implement `FoodListShareRepo.shareWithFriend(listId, ownerId, recipientId, role)` reusing the `canonicalPair`/`friendships` IN-lookup pattern from `apps/api/src/services/sharing/repo.ts` (upserts `role` on an existing grant rather than erroring — Requirement 4.3); implement `revokeShare`, `listShares(listId, ownerId)` (owner-scoped read backing "Manage sharing," Requirement 9.8, includes `role`), and `revokeSharesBetween(userIdA, userIdB)` (deletes both-direction rows regardless of `role`)
  - [x] 3.2 Add `onFriendshipRemoved` to `FriendsRoutesOptions` in `apps/api/src/services/friends/routes.ts`; call it (awaited, not fire-and-forget) after a successful `repo.removeFriend` in `DELETE /me/friends/:userId`
  - [x] 3.3 Write property tests `apps/api/src/services/foodLists/__tests__/foodListShares.prop.test.ts` validating Property 3 (view-access predicate consistency, share dimension), Property 6 (unfriend revokes bidirectional access regardless of role), Property 9 (manage-sharing read is owner-scoped), and Property 11 (role upsert and change notification, including the same-role no-op case)
  - [x] 3.4 Write integration test `apps/api/src/services/friends/__tests__/unfriendFoodListRevocation.integration.test.ts` exercising the real `removeFriend` → `onFriendshipRemoved` → `revokeSharesBetween` wiring end to end (not a fake)

- [x] 4. Likes, Saves, and Collection View
  - [x] 4.1 Implement `FoodListAffinityRepo.like`/`unlike` (transactional `like_count` increment/decrement, idempotent) and `save` (rejects `food_list_save_self`, rejects on no access)
  - [x] 4.2 Implement `getCollection(userId)` returning `owned` + `saved` groups, marking a saved-but-now-inaccessible list `available: false` per Requirement 6.7
  - [x] 4.3 Write property tests `apps/api/src/services/foodLists/__tests__/foodListAffinity.prop.test.ts` validating Property 3 (view-access predicate, like/save dimension), Property 4 (like-count denormalization consistency), and Property 7 (save is a live reference)

- [x] 5. Discovery Feed
  - [x] 5.1 Implement `FoodListRepo.discover(sort, cursor)` with keyset pagination (opaque base64 cursor) over the `food_lists_discover_popular_idx`/`food_lists_discover_recent_idx` indexes
  - [x] 5.2 Write property tests `apps/api/src/services/foodLists/__tests__/foodListDiscovery.prop.test.ts` validating Property 8 (sort order, public-only scope, full-coverage pagination)

- [x] 6. Fastify Routes, Notifications (Share + Role-Change), and Composition Wiring
  - [x] 6.1 Implement all routes in `apps/api/src/services/foodLists/routes.ts`: `POST/GET /me/food-lists`, `PATCH/DELETE /me/food-lists/:id`, `POST/DELETE /me/food-lists/:id/items[/:foodItemId]` (edit-access-gated, not owner-only), `PUT /me/food-lists/:id/items/order` (edit-access-gated, `expectedVersion` required), `POST/GET/DELETE /me/food-lists/:id/shares[/:recipientId]` (owner-only), `GET /food-lists/:id` (returns `version`/`myRole`/item `addedBy*`), `POST/DELETE /food-lists/:id/like`, `POST /food-lists/:id/save`, `GET /food-lists/discover`, `GET /me/food-lists/collection`
  - [x] 6.2 Add `handleFoodListShared` AND `handleFoodListRoleChanged` (two distinct handlers, Requirement 8.1 vs 8.3) to `apps/api/src/services/notifications/service.ts`, structurally mirroring `handleShareDelivered` (preference-gated, fire-and-forget from the route); wire the `POST /me/food-lists/:id/shares` route to call whichever fires based on whether the grant was newly inserted or had its `role` changed (never both, never neither)
  - [x] 6.3 Wire `emitFoodListShared`, `emitFoodListRoleChanged` (both fire-and-forget) and `onFriendshipRemoved: revokeFoodListSharesOnUnfriend` (awaited) into `composeServices.ts`; extend `BuildServerServices` in `apps/api/src/server.ts` with the opt-in `foodLists` block
  - [x] 6.4 Add route integration tests `apps/api/src/services/foodLists/__tests__/routes.test.ts` covering every error code (including `food_list_edit_forbidden` and `food_list_stale_write`), the discovery cursor round-trip, and the collection endpoint's degradation path
  - [x] 6.5 Add notification tests `apps/api/src/services/notifications/__tests__/foodListSharedNotification.test.ts` and `foodListRoleChangedNotification.test.ts` asserting exactly-once delivery on first share / on an actual role change respectively, preference gating, and no dispatch on repeat-share-same-role/like/save/item-mutation

- [x] 7. Checkpoint — Backend Verification Gate
  - [x] 7.1 Run `npm run verify:api` and `npm run verify:shared` to verify compiler clean and all test suites pass

- [x] 8. Mobile Food Lists UI
  - [x] 8.1 Create `MyFoodListsScreen.tsx` (owned/saved tabs, create/rename/delete, visibility toggle) in the relevant mobile stack
  - [x] 8.2 Create `FoodListDetailScreen.tsx`: item list with `addedByDisplayName` attribution label (shown only when 2+ distinct contributors, Requirement 11.2), drag-reorder and a per-row delete action gated on `myRole` being `owner`/`editor` (Requirement 9.7, 11.1 — `viewer` renders fully read-only), like button, save button, "Add items" entry point 2 trigger per 8.7 (also `owner`/`editor`-gated), "Manage sharing" entry per 8.9
  - [x] 8.3 Create `FoodListDiscoveryScreen.tsx` (popular/recent sort toggle, infinite-scroll pagination via `nextCursor`)
  - [x] 8.4 Write render/interaction tests `MyFoodListsScreen.test.tsx`, `FoodListDetailScreen.test.tsx`, `FoodListDiscoveryScreen.test.tsx` mocking only the network/query layer, covering every interactive flow named in design.md's Testing Strategy, including the item-row delete action for `owner`/`editor` and its absence for `viewer` (Requirement 9.7, 11.1), and the attribution label's 2+-contributor gating (Requirement 11.2)
  - [x] 8.5 Add `mode: 'log' | 'addToLists'` to `FoodItemPickerModal.tsx` (from `food-item-logging`) enabling multi-select in `addToLists` mode; create `AddToListsSheet.tsx` in `apps/mobile/src/screens/foodLists/` (owned-lists checklist, pre-checked/toggle membership, inline "Create new list")
  - [x] 8.6 Wire entry point 1: add an "Add to a list" button to the Restaurant Experience Detail screen beside "Log a food item," opening `FoodItemPickerModal` in `addToLists` mode → `AddToListsSheet`
  - [x] 8.7 Wire entry point 2: add an "Add items" button to `FoodListDetailScreen.tsx` (per 8.2's `myRole` gating) opening a restaurant search step (reusing existing Catalog search filtered to `category = 'Restaurant'`) → `FoodItemPickerModal` in `addToLists` mode scoped to the selected restaurant, target list pre-determined, skipping the list-checklist step
  - [x] 8.8 Write `AddToListsSheet.test.tsx` and add interaction assertions to the Restaurant Experience Detail and `FoodListDetailScreen` test files covering both entry points, the toggle/pre-check behavior, inline list creation, and duplicate-response swallowing (Requirement 9.4)
  - [x] 8.9 Create `ManageFoodListSharesSheet.tsx` in `apps/mobile/src/screens/foodLists/` (recipient list with `role` from `GET /me/food-lists/:id/shares`, a `viewer`/`editor` toggle per row calling `POST /me/food-lists/:id/shares` with the new `role`, revoke action per row calling `DELETE /me/food-lists/:id/shares/:recipientId`; the same `viewer`/`editor` choice appears on the initial share-creation flow), wired from a "Manage sharing" entry on `FoodListDetailScreen.tsx` for private owned lists (Requirement 9.8, 11.4)
  - [x] 8.10 Write `ManageFoodListSharesSheet.test.tsx` asserting the recipient list renders with roles, the role toggle calls `POST` with the new `role` and updates the row, and the revoke action calls the DELETE endpoint and removes the row
  - [x] 8.11 Render the `saved` tab's `available: false` entries in `MyFoodListsScreen.tsx` as a greyed, non-interactive "No longer available" row (Requirement 7a); write the corresponding assertion in `MyFoodListsScreen.test.tsx`
  - [x] 8.12 Add `extractFoodListId` and a `foodListShare` case to `PendingTap`/`classifyTap` in `apps/mobile/src/hooks/useNotificationResponse.ts` (checked before the `share` fallback, per Property 10); add `navigateToFoodListDetail` to `apps/mobile/src/navigation/navigationRef.ts` mirroring `navigateToTripsList`; wire the dispatch switch's new `case 'foodListShare'` branch (handles both the first-share and role-change notification taps identically, since both carry the same `{ foodListId }` payload)
  - [x] 8.13 Handle the deep-linked-list-unavailable case on `FoodListDetailScreen.tsx` using the `tripsListNotice.ts`-style transient notice pattern (Requirement 10.2)
  - [x] 8.14 Add `data: { foodListId }` to the push payloads composed by `handleFoodListShared` and `handleFoodListRoleChanged` (task 6.2); write `useNotificationResponse.test.ts` assertions for Property 10 and the dispatch-to-`navigateToFoodListDetail` behavior, plus a `FoodListDetailScreen.test.tsx` assertion for the unavailable-list notice
  - [x] 8.15 Submit `expectedVersion` (from the last-fetched `FoodListDetailDTO.version`) alongside `foodItemIds` on every drag-reorder in `FoodListDetailScreen.tsx`; on a `food_list_stale_write` response, refetch the list and show a brief "list was updated" message rather than retrying the stale order (Requirement 11.3)
  - [x] 8.16 Write a `FoodListDetailScreen.test.tsx` assertion driving the `food_list_stale_write` refetch-and-message path (Property 5's client-facing behavior)

- [x] 9. Final Verification & Quality Gate
  - [x] 9.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`)

- [x] 10. Profile Entry Point to Food Lists (R12, added by this amendment)
  - [x] 10.1 Add a "View your food lists" `SecondaryButton` to `ProfileScreen.tsx`
    - Place it in its own `Card` section immediately alongside the existing "Your stats"/"Food history" sections, mirroring the exact pattern already used for "View your stats" (`onViewStats`) and "View your food history" (`onViewFoodHistory`, `testID="profile-view-food-history"`); give it `testID="profile-view-food-lists"` and call `navigation.navigate('MyFoodLists')` — `MyFoodLists` is already a registered `RootStackParamList` route (task 8.1), so no navigation/route change is needed here
    - _Requirements: 12.1, 12.2_
  - [x] 10.2 Write a `ProfileScreen` test assertion for the new button
    - Add to `apps/mobile/src/screens/__tests__/ProfileScreen.test.tsx` (or its existing equivalent test file): pressing `profile-view-food-lists` calls `navigation.navigate('MyFoodLists')`; the button renders identically regardless of the User's owned/saved list counts (Requirement 12.2, Property 13)
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 11. Final Verification & Quality Gate (Re-run after R12)
  - [x] 11.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`)

- [x] 12. Create-Time Visibility Override — Backend (R1a, added by this amendment)
  - [x] 12.1 Widen `createFoodListInputSchema` and `CreateFoodListInputDTO`
    - In `packages/shared/src/schemas/FoodList.ts`, add `visibility: foodListVisibilitySchema.optional()` to `createFoodListInputSchema`; add the matching optional field to `CreateFoodListInputDTO` in `packages/shared/src/dto/FoodList.ts`; add schema tests to `packages/shared/src/schemas/__tests__/FoodList.test.ts` covering `visibility` present (both enum values), `visibility` omitted (still valid), and an invalid `visibility` value (rejected)
    - _Requirements: 1a_
  - [x] 12.2 Update `FoodListRepo.createList` to honor the supplied `visibility`
    - In `apps/api/src/services/foodLists/repo.ts`, parameterize the `INSERT INTO food_lists (..., visibility) VALUES (..., $N)` statement on `input.visibility ?? 'private'` instead of the hardcoded `'private'` literal
    - _Requirements: 1.1, 1a_
  - [x] 12.3 Write property test validating Property 14
    - Add to (or extend) `apps/api/src/services/foodLists/__tests__/foodLists.prop.test.ts`: `fast-check` (>=100 runs) generating a create request with `visibility` present (either value), absent, or invalid, asserting the created row's `visibility` matches the supplied value, defaults to `'private'` when omitted, and that an invalid value is rejected with no row created
    - _Requirements: 1a_
  - [x] 12.4 Add route integration test coverage
    - In `apps/api/src/services/foodLists/__tests__/routes.test.ts`: `POST /me/food-lists` with `visibility: 'public'` returns a list with `visibility: 'public'`; with `visibility` omitted returns `'private'`; with an invalid `visibility` value returns `400 validation_failed`
    - _Requirements: 1a_
  - [x] 12.5 Checkpoint — run `npm run verify:api` and `npm run verify:shared`

- [x] 13. Create-Time Visibility Override — Mobile (R1a, added by this amendment)
  - [x] 13.1 Wire the existing Public/Private toggle in `MyFoodListsScreen.tsx`'s create modal to the request body
    - In `handleCreateList`, change the `POST /me/food-lists` call to send `{ name: trimmed, visibility: newListVisibility }` (the toggle's state was already being tracked and rendered — it was never included in the actual request body, which is why nothing visibly happened: the request was rejected by the pre-amendment `.strict()` schema and the failure was silently swallowed)
    - _Requirements: 1a_
  - [x] 13.2 Surface create failures to the User instead of silently swallowing them
    - Replace `handleCreateList`'s empty `catch {}` with a visible error state (e.g. an inline error message in the create modal, mirroring the error-surfacing pattern already used elsewhere in this screen's other mutations or in `FoodListDetailScreen.tsx`) so a future regression of this kind fails loudly instead of looking like the button does nothing
    - _Requirements: 1a_
  - [x] 13.3 Write/extend `MyFoodListsScreen.test.tsx` coverage
    - Assert selecting "Public" in the create modal and submitting calls `apiRequest('POST', '/me/food-lists', { name, visibility: 'public' })` and the new list appears in the `owned` tab; assert selecting "Private" (or leaving the default) sends `visibility: 'private'`; assert a mocked create-request rejection surfaces a visible error and leaves the modal open with the User's entered name intact (not a silent no-op)
    - _Requirements: 1a_
  - [x] 13.4 Checkpoint — run `npm run verify:mobile`

- [x] 14. Final Verification & Quality Gate (Re-run after R1a)
  - [x] 14.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`)

- [x] 15. Food Lists Header Back Navigation (R12.4, added by this amendment)
  - [x] 15.1 Add back navigation handler to `MyFoodListsScreen.tsx` header
    - Wire `onBack` in `GradientHeader` on `MyFoodListsScreen.tsx` to invoke `navigation.goBack()` when `canGoBack()` is true, and fall back to `navigation.navigate('MainTabs')` when false
    - _Requirements: 12.4_
  - [x] 15.2 Write unit/interaction tests in `MyFoodListsScreen.test.tsx`
    - Assert that a back control renders in `GradientHeader` and activating it invokes `navigation.goBack()` when history exists, and `navigation.navigate('MainTabs')` when history does not exist (Property 15)
    - _Requirements: 12.4_
  - [x] 15.3 Checkpoint — run `npm run verify:mobile`

## Task Dependency Graph

Tasks within a wave can proceed in parallel; each wave depends only on earlier waves. Assumes `food-item-logging`'s tasks 1-5 (through its own backend checkpoint) are already complete, since `food_lists_items.food_item_id` is a foreign key into `food_items`.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "5.1", "5.2"] },
    { "id": 4, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["8.1", "8.2", "8.3", "8.5", "8.6", "8.7", "8.9", "8.11", "8.12", "8.13", "8.15"] },
    { "id": 7, "tasks": ["8.4", "8.8", "8.10", "8.14", "8.16"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["10.1"] },
    { "id": 10, "tasks": ["10.2"] },
    { "id": 11, "tasks": ["11.1"] },
    { "id": 12, "tasks": ["12.1", "12.2"] },
    { "id": 13, "tasks": ["12.3", "12.4"] },
    { "id": 14, "tasks": ["12.5"] },
    { "id": 15, "tasks": ["13.1", "13.2"] },
    { "id": 16, "tasks": ["13.3"] },
    { "id": 17, "tasks": ["13.4"] },
    { "id": 18, "tasks": ["14.1"] },
    { "id": 19, "tasks": ["15.1"] },
    { "id": 20, "tasks": ["15.2"] },
    { "id": 21, "tasks": ["15.3"] }
  ]
}
```

Wave 3 groups likes/saves/collection (task 4) with discovery (task 5) since both depend only on wave 1's ownership/access-predicate repo and are otherwise independent (disjoint files). Wave 6 groups every mobile screen and add-flow entry point since they depend only on wave 5's backend checkpoint and touch mostly-disjoint files; wave 7 is their component tests, sequenced after so tests assert against the finished screens rather than in-flight ones. Wave 8 is the (still-pending as of this amendment) final full-verify gate for the original feature; waves 9-11 are the R12 Profile-entry-point amendment and its own final-verify re-run. Waves 12-18 are this second amendment (Requirement 1a) — the backend schema/repo fix (wave 12), its tests (wave 13), its checkpoint (wave 14), the mobile wiring fix (wave 15), its tests (wave 16), its checkpoint (wave 17), and the final full re-verify (wave 18). Waves 19-21 are this third amendment (Requirement 12.4) — the MyFoodListsScreen back navigation handler (wave 19), its interaction and fallback tests (wave 20), and the mobile verification checkpoint (wave 21).

## Notes

- **Hard cross-spec dependency.** `food_lists_items.food_item_id` is a foreign key into `food_items` (from `food-item-logging`). Do not start migration `0041` until `food-item-logging`'s migration `0040` has landed.
- **Live access, not snapshot.** Every read path (list detail, like, save) recomputes access and content at read time. No table in this feature stores a copy of another list's content — `food_list_saves` is strictly a `(food_list_id, saved_by_user_id)` reference row (Property 7).
- **Awaited revocation, not fire-and-forget.** Unlike every other cross-service hook in this codebase (`awardPins`, `emitShareDelivered`, `emitFriendRequestReceived`), `onFriendshipRemoved` is awaited before `DELETE /me/friends/:userId` responds, because a missed revocation is an access-control gap, not a missed enhancement. Do not follow the fire-and-forget precedent for this one hook.
- **No notification spam.** Only the first `food_list_shares` grant per `(list, recipient)` and an actual role change (not a same-role repeat) trigger a push; every content edit, like, save, or no-op share is silent by design (Requirement 8.2) — this is a deliberate Upstash-budget and UX decision, not an oversight to "fix" later.
- **Editor access is item-scoped only, never share-management.** An `editor`-role User can add/remove/reorder items but can never create, change the role of, or revoke a `food_list_shares` grant — that stays owner-only (Requirement 4.7, Property 1). Do not widen the share-management routes' access check when implementing task 6.1.
- **Amendment (Requirement 1a): create-time visibility was always intended, just never fully wired.** Requirement 1.1's "with `visibility = 'private'` by default" phrasing anticipated an override; `createFoodListInputSchema` was originally `name`-only and `.strict()`, so the mobile Create modal's already-built Public/Private toggle sent a field the backend rejected outright, and `MyFoodListsScreen.tsx`'s empty `catch {}` on the create call turned that rejection into a silent no-op (tapping "Create" visibly did nothing). Fix both ends together — the schema/repo (task 12) and the mobile wiring plus visible error surfacing (task 13) — not just one side, since fixing only the backend would still leave the toggle's choice silently ignored, and fixing only the mobile request body without the backend accepting `visibility` would just change which layer rejects it.
- **Optimistic concurrency is scoped to reorder, not add/remove.** `version` is bumped by every item mutation, but only `reorderItems` requires `expectedVersion` and can reject with `food_list_stale_write` — add/remove are commutative and never collide at the row level, so gating them on version would only add friction without preventing a real conflict. Do not add an `expectedVersion` requirement to `addItem`/`removeItem`.
- **Attribution is best-effort, not identity-critical.** `added_by_user_id` uses `ON DELETE SET NULL`, not `CASCADE` — a deleted contributor's items stay on the list for the remaining collaborators; only the "added by" label disappears for their rows. Do not change this to `CASCADE` even though it looks more consistent with the rest of the schema's per-user join tables — those tables represent *the User's own relationship* to a list (a share, a like, a save), which should vanish with the account; a contributed item is *the list's* content, which should not.
- **Pins hook remains out of scope**, same as `food-item-logging` — no `evaluator.ts` change in this spec.
