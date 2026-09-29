# Implementation Plan

## Tasks

- [x] 1. Migration and Shared Schema Contracts
  - [x] 1.1 Create migration `apps/api/migrations/0050_experience_lists.sql` adding `experience_lists` (with `version`), `experience_lists_items` (with `experience_id → experiences`, `added_by_user_id ON DELETE SET NULL`), `experience_list_shares` (with `role` CHECK `viewer|editor`), `experience_list_likes`, `experience_list_saves` with all CHECK/UNIQUE constraints and indexes from design.md
    - _Requirements: 1.1, 1.4, 2.1, 2.4, 3.1, 4.1, 6.1, 6.4_
  - [x] 1.2 Add migration unit test `apps/api/src/db/__tests__/migration0050.test.ts` asserting every table, constraint (including `experience_lists_version_nonneg_chk`, `experience_list_shares_role_chk`, `experience_lists_items_position_unique`), the `added_by_user_id ON DELETE SET NULL` behavior, and cascade-on-delete behavior for the rest
    - _Requirements: 1.4, 2.4_
  - [x] 1.3 Define `ExperienceListDTO`, `ExperienceListItemDTO`, `ExperienceListRole`, `ExperienceListDetailDTO` (with `version`, `myRole`), `ExperienceListCollectionDTO`, `ExperienceListDiscoveryPageDTO`, `CreateExperienceListInputDTO`, `UpdateExperienceListInputDTO`, `AddExperienceListItemInputDTO`, `ReorderExperienceListItemsInputDTO` (with `expectedVersion`), `ExperienceListShareRole`, `ShareExperienceListInputDTO`, `ExperienceListShareDTO` in `packages/shared/src/dto/ExperienceList.ts` and matching Zod schemas in `packages/shared/src/schemas/ExperienceList.ts`, mirroring `FoodList.ts`'s shapes exactly
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.5, 3.1, 4.1, 4.3, 7.1_
  - [x] 1.4 Barrel the new DTOs/schemas in `packages/shared/src/dto/index.ts`/`schemas/index.ts`; add `experience_list_not_found`, `experience_list_edit_forbidden`, `experience_list_item_duplicate`, `experience_list_dining_ineligible`, `experience_list_reorder_mismatch`, `experience_list_stale_write`, `experience_list_share_not_friend`, `experience_list_save_self` to `ERROR_CODES`/`errorCodeToHttpStatus` in `packages/shared/src/errors.ts`; add schema/error-catalog tests for valid and invalid cases
    - _Requirements: 1.2, 1.5, 2.2, 2.3, 2.6, 2.7, 2.9, 4.2, 6.6_

- [x] 2. Experience List Ownership Repository (CRUD + Edit-Access-Scoped Membership, Dining Exclusion)
  - [x] 2.1 Implement `ExperienceListRepo` in `apps/api/src/services/experienceLists/repo.ts`: `createList`, `renameList`, `setVisibility`, `deleteList`, `listOwned(userId)`, `getListDetail(listId, viewerId)` applying the Property-4 view-access predicate and resolving `myRole`; also `resolveForAttachEligibility(experienceListId)` returning `{ ownerId, visibility } | null` (the port `trips` will call for Requirement 14)
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 3.1, 3.2, 3.3, 7.1, 7.2, 7.3_
  - [x] 2.2 Implement a shared `hasEditAccess(listId, userId)` helper reused by every mutating method; implement `ExperienceListItemRepo`: `addItem` (rejects `experience_list_dining_ineligible` for a `Restaurant`-category Experience BEFORE the duplicate check; rejects `experience_not_found`; position = max+1; stamps `added_by_user_id`; bumps `version`), `removeItem` (bumps `version`), `reorderItems(listId, userId, experienceIds, expectedVersion)` (single transaction; id-set mismatch → `experience_list_reorder_mismatch`; stale `version` → `experience_list_stale_write`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_
  - [x] 2.3 Write property tests `apps/api/src/services/experienceLists/__tests__/experienceLists.prop.test.ts` validating Property 1 (ownership-scoped list-level mutation), Property 2 (edit-access-scoped item mutation, `fc.constantFrom('owner', 'editor', 'viewer', 'none')` actor-role generator), Property 3 (dining ineligibility enforced before the duplicate check, driven with an owner-role actor to isolate from Property 2's access-control cases), and Property 6 (reorder atomicity/rejection/optimistic concurrency)
    - _Requirements: 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 4.7_

- [x] 3. Access, Sharing (Viewer/Editor Roles), and Unfriend Revocation
  - [x] 3.1 Implement `ExperienceListShareRepo.shareWithFriend(listId, ownerId, recipientId, role)` reusing the `canonicalPair`/`friendships` pattern from `apps/api/src/services/sharing/repo.ts` (upserts `role` on an existing grant); implement `revokeShare`, `listShares(listId, ownerId)`, `revokeSharesBetween(userIdA, userIdB)`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 9.8_
  - [x] 3.2 Add `onFriendshipRemoved` composition in `composeServices.ts` (combining `revokeFoodListSharesOnUnfriend` and the new `revokeExperienceListSharesOnUnfriend` via `Promise.all`, per design.md) — this is a cross-spec edit to code `food-lists` already shipped; flag it clearly in the commit/PR
    - _Requirements: 4.5_
  - [x] 3.3 Write property tests `apps/api/src/services/experienceLists/__tests__/experienceListShares.prop.test.ts` validating Property 4 (view-access predicate consistency, share dimension), Property 7 (unfriend revokes bidirectional access regardless of role), and Property 10 (role upsert and change notification)
    - _Requirements: 3.2, 3.3, 4.1, 4.2, 4.3, 4.5, 6.2, 6.5, 7.2, 8.2, 8.3_
  - [x] 3.4 Write integration test `apps/api/src/services/friends/__tests__/unfriendExperienceListRevocation.integration.test.ts` exercising the real `removeFriend` → composed `onFriendshipRemoved` → `revokeSharesBetween` wiring for both list kinds
    - _Requirements: 4.5_

- [x] 4. Likes, Saves, and Collection View
  - [x] 4.1 Implement `ExperienceListAffinityRepo.like`/`unlike` (transactional `like_count` increment/decrement, idempotent) and `save` (rejects `experience_list_save_self`, rejects on no access)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [x] 4.2 Implement `getCollection(userId)` returning `owned` + `saved` groups, marking a saved-but-now-inaccessible list `available: false`
    - _Requirements: 6.7, 6.8_
  - [x] 4.3 Write property tests `apps/api/src/services/experienceLists/__tests__/experienceListAffinity.prop.test.ts` validating Property 4 (view-access predicate, like/save dimension), Property 5 (like-count denormalization consistency), and Property 8 (save is a live reference)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_

- [x] 5. Discovery Feed
  - [x] 5.1 Implement `ExperienceListRepo.discover(sort, cursor)` with keyset pagination over the `experience_lists_discover_popular_idx`/`experience_lists_discover_recent_idx` indexes
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 5.2 Write property tests `apps/api/src/services/experienceLists/__tests__/experienceListDiscovery.prop.test.ts` validating Property 9 (sort order, public-only scope, full-coverage pagination)
    - _Requirements: 5.1_

- [x] 6. Fastify Routes, Notifications (Share + Role-Change), and Composition Wiring
  - [x] 6.1 Implement all routes in `apps/api/src/services/experienceLists/routes.ts`: `POST/GET /me/experience-lists`, `PATCH/DELETE /me/experience-lists/:id`, `POST/DELETE /me/experience-lists/:id/items[/:experienceId]`, `PUT /me/experience-lists/:id/items/order`, `POST/GET/DELETE /me/experience-lists/:id/shares[/:recipientId]`, `GET /experience-lists/:id`, `POST/DELETE /experience-lists/:id/like`, `POST /experience-lists/:id/save`, `GET /experience-lists/discover`, `GET /me/experience-lists/collection`
    - _Requirements: 1.1, 1.3, 1.4, 1.6, 2.1, 2.4, 2.5, 3.1, 4.1, 4.4, 5.1, 6.1, 6.3, 6.4, 6.7, 7.1, 9.8_
  - [x] 6.2 Add `handleExperienceListShared` AND `handleExperienceListRoleChanged` to `apps/api/src/services/notifications/service.ts`, mirroring `handleFoodListShared`/`handleFoodListRoleChanged` exactly; wire the share route to call whichever fires
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 6.3 Wire `emitExperienceListShared`, `emitExperienceListRoleChanged` (fire-and-forget) into `composeServices.ts`; extend `BuildServerServices` in `apps/api/src/server.ts` with the opt-in `experienceLists` block
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 6.4 Add route integration tests `apps/api/src/services/experienceLists/__tests__/routes.test.ts` covering every error code (including `experience_list_dining_ineligible`, `experience_list_edit_forbidden`, `experience_list_stale_write`), the discovery cursor round-trip, and the collection endpoint's degradation path
    - _Requirements: 1.5, 2.2, 2.3, 2.6, 2.7, 2.9, 4.2, 5.1, 6.6, 6.7_
  - [x] 6.5 Add notification tests `apps/api/src/services/notifications/__tests__/experienceListSharedNotification.test.ts` and `experienceListRoleChangedNotification.test.ts` asserting exactly-once delivery, preference gating, and no dispatch on repeat-share-same-role/like/save/item-mutation
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 7. Checkpoint — Backend Verification Gate
  - [x] 7.1 Run `npm run verify:api` and `npm run verify:shared`

- [x] 8. Batched Visit Summary Endpoint (Requirement 13, cross-spec addition to `tracking/logs`)
  - [x] 8.1 Add `VisitSummary`/`getVisitSummaries` to the existing `ExperienceLogRepo` interface and implementation in `apps/api/src/services/tracking/logs/repo.ts` — one grouped SQL query (`GROUP BY experience_id`, `COUNT`/`COUNT(*) FILTER`/`ROUND(AVG(...) FILTER (...))`) per design.md; this is a cross-spec edit to a file `experience-activity-logging` already shipped — flag it clearly in the commit/PR
    - _Requirements: 13.1, 13.2, 13.7_
  - [x] 8.2 Add `VisitSummaryDTO`/`VisitSummaryResponseDTO` to `packages/shared/src/dto/VisitSummary.ts` and barrel it; add `VISIT_SUMMARY_MAX_IDS` constant
    - _Requirements: 13.1, 13.2_
  - [x] 8.3 Add `GET /me/experiences/visit-summary` to `apps/api/src/services/tracking/logs/routes.ts`: parses/dedupes the `ids` query param, rejects over `VISIT_SUMMARY_MAX_IDS` with `400 validation_failed`, returns `{}` for an empty/missing `ids`, fills `{ repeatCount: 0, ratedCount: 0, averageRating: null }` for any requested id absent from the query result
    - _Requirements: 13.1, 13.2_
  - [x] 8.4 Write property tests `apps/api/src/services/tracking/logs/__tests__/visitSummary.prop.test.ts` validating Property 12 (per-user isolation — another User's logs never leak in) and Property 13 (batch completeness, zero-log default), comparing the SQL result against a naive in-memory recomputation from generated logs
    - _Requirements: 13.2, 13.7_
  - [x] 8.5 Add route integration tests to `apps/api/src/services/tracking/logs/__tests__/routes.test.ts` covering the new route: empty `ids`, a mix of logged/unlogged/rated/unrated experience ids, and the over-cap rejection
    - _Requirements: 13.1, 13.2_
  - [x] 8.6 Checkpoint — run `npm run verify:api` and `npm run verify:shared`

- [x] 9. Consolidate `ParkPassportCard` Onto `getVisitSummaries` (Requirement 16)
  - [x] 9.1 Update `ParkPassportCard.tsx` to fetch `GET /me/experiences/visit-summary?ids=<experienceId>` and render `averageRating`/`ratedCount` from that response, deleting its existing client-side reduce-over-`logs` averaging code; keep sourcing the visit-history timeline from the existing `logsQuery`/`getVisitHistory` unchanged
    - _Requirements: 16.1, 16.2, 16.3_
  - [x] 9.2 Update every existing `ParkPassportCard.test.tsx` fixture/assertion that previously supplied raw `logs` ratings and asserted a computed average to instead mock the visit-summary response directly and assert straight pass-through rendering (Property 20); add a deliberately-inconsistent fixture proving no residual client-side averaging path remains active
    - _Requirements: 16.1, 16.3_
  - [x] 9.3 Checkpoint — run `npm run verify:mobile`

- [x] 10. Mobile Experience Lists UI
  - [x] 10.1 Create `MyExperienceListsScreen.tsx` (owned/saved tabs, create/rename/delete, visibility toggle, header back control) in the relevant mobile stack
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 3.1, 6.7, 12.1, 12.4_
  - [x] 10.2 Create `ExperienceListDetailScreen.tsx`: item list with `addedByDisplayName` attribution (2+ contributors only), drag-reorder and per-row delete gated on `myRole` owner/editor, like button, save button, "Add items" entry point trigger, "Manage sharing" entry
    - _Requirements: 2.10, 3.3, 7.1, 7.3, 9.5, 9.7, 9.8, 11.1, 11.2, 11.4_
  - [x] 10.3 Create `ExperienceListDiscoveryScreen.tsx` (popular/recent sort toggle, infinite-scroll pagination via `nextCursor`)
    - _Requirements: 5.1, 5.2, 5.3, 12.3_
  - [x] 10.4 Write render/interaction tests `MyExperienceListsScreen.test.tsx`, `ExperienceListDetailScreen.test.tsx`, `ExperienceListDiscoveryScreen.test.tsx` mocking only the network/query layer, covering every interactive flow in design.md's Testing Strategy
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 5.1, 6.7, 7.1, 7.3, 9.7, 11.1, 11.2, 11.3_

- [x] 11. Add-to-List Entry Points and Dining Exclusion (Requirement 9)
  - [x] 11.1 Create `AddToExperienceListsSheet.tsx` in `apps/mobile/src/screens/experienceLists/` (owned-lists checklist, pre-checked/toggle membership, inline "Create new list")
    - _Requirements: 9.2, 9.3, 9.4, 9.6_
  - [x] 11.2 Wire entry point 1: add an "Add to a list" affordance to `ExperienceDetailScreen.tsx`, rendered only when `experience.category !== 'Restaurant'`, as a sibling to the existing "Add to Trip" action, opening `AddToExperienceListsSheet`
    - _Requirements: 9.1_
  - [x] 11.3 Wire entry point 2: add an "Add items" button to `ExperienceListDetailScreen.tsx` opening a catalog search step filtered to `categories != Restaurant`, target list pre-determined
    - _Requirements: 9.5_
  - [x] 11.4 Write `AddToExperienceListsSheet.test.tsx` and add interaction assertions to `ExperienceDetailScreen.test.tsx`/`ExperienceListDetailScreen.test.tsx` covering both entry points, the toggle/pre-check behavior, inline list creation, duplicate-response swallowing (Requirement 9.4), and — the dining-exclusion mobile check (Property 3) — that the Experience_List "Add to a list" affordance is absent for a `Restaurant` fixture and present for a `Ride`/`Show`/`Character_Meet` fixture, while the existing Food_List affordance shows the inverse
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 12. Item Removal, Manage Sharing, and Reorder Conflict UI
  - [x] 12.1 Ensure `ExperienceListDetailScreen.tsx`'s item rows carry a delete action invoking `DELETE /me/experience-lists/:id/items/:experienceId`, gated on `myRole` owner/editor
    - _Requirements: 9.7, 11.1_
  - [x] 12.2 Create `ManageExperienceListSharesSheet.tsx` in `apps/mobile/src/screens/experienceLists/` (recipient list with `role`, viewer/editor toggle per row, revoke action), wired from a "Manage sharing" entry on private owned lists
    - _Requirements: 9.8, 11.4_
  - [x] 12.3 Submit `expectedVersion` alongside `experienceIds` on every drag-reorder in `ExperienceListDetailScreen.tsx`; on `experience_list_stale_write`, refetch and show a brief "list was updated" message
    - _Requirements: 11.3_
  - [x] 12.4 Write `ManageExperienceListSharesSheet.test.tsx` and extend `ExperienceListDetailScreen.test.tsx` for the delete action's role-gating and the stale-write refetch-and-message path
    - _Requirements: 9.7, 9.8, 11.1, 11.3, 11.4_

- [x] 13. Visit Summary and Log-From-List (Requirement 13, mobile half)
  - [x] 13.1 Wire `ExperienceListDetailScreen.tsx` to fetch `GET /me/experiences/visit-summary` once with every visible item's `experienceId`, keyed into a lookup map for per-row rendering
    - _Requirements: 13.1_
  - [x] 13.2 Render the three badge states per item row (no badge / visit-count-only / visit-count-plus-rating) from the visit-summary lookup, matching `ParkPassportCard`'s `★ {value.toFixed(1)}` formatting
    - _Requirements: 13.3_
  - [x] 13.3 Split the item list into "Not yet done" / "Done" sections derived purely from `repeatCount > 0` — no stored flag, no manual toggle
    - _Requirements: 13.4_
  - [x] 13.4 Add a "Log a visit" action per row opening the existing `LogVisitModal` pre-filled with that row's `experienceId` and today's date, submitting to the existing `POST /me/experiences/:id/logs`; on success, invalidate and refetch the list's visit-summary query
    - _Requirements: 13.5, 13.6_
  - [x] 13.5 Write/extend `ExperienceListDetailScreen.test.tsx`: asserts the batched fetch is issued once (call-count assertion) not per-item; asserts each badge state renders for its matching fixture (Property 13); asserts an item moves between sections when its `repeatCount` fixture changes (Property 14); asserts "Log a visit" opens `LogVisitModal` pre-filled and a successful submission triggers a visit-summary refetch that updates the row without a full remount (Property 15)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [x] 14. Notification Tap Deep-Link
  - [x] 14.1 Add `extractExperienceListId` and an `experienceListShare` case to `PendingTap`/`classifyTap` in `useNotificationResponse.ts` (checked before the `share` fallback); add `navigateToExperienceListDetail` to `navigationRef.ts`; wire the dispatch switch's new case
    - _Requirements: 10.1_
  - [x] 14.2 Handle the deep-linked-list-unavailable case on `ExperienceListDetailScreen.tsx` using the existing transient-notice pattern
    - _Requirements: 10.2_
  - [x] 14.3 Add `data: { experienceListId }` to the push payloads composed by `handleExperienceListShared`/`handleExperienceListRoleChanged` (task 6.2); write `useNotificationResponse.test.ts` assertions and an `ExperienceListDetailScreen.test.tsx` assertion for the unavailable-list notice
    - _Requirements: 10.1, 10.2_

- [x] 15. Checkpoint — Mobile Verification Gate
  - [x] 15.1 Run `npm run verify:mobile`

- [x] 16. Profile Entry Point
  - [x] 16.1 Add a "View your experience lists" `SecondaryButton` to `ProfileScreen.tsx`, alongside the existing "View your food lists" entry, calling `navigation.navigate('MyExperienceLists')`
    - _Requirements: 12.1, 12.2_
  - [x] 16.2 Write a `ProfileScreen` test assertion for the new button, including that it renders identically regardless of the User's owned/saved list counts
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 17. Checkpoint — Backend + Mobile Verification Gate
  - [x] 17.1 Run `npm run verify:api`, `npm run verify:mobile`, and `npm run verify:shared`

- [x] 18. Trip Attachment Bridge (Requirement 14, cross-spec addition to `trips`)
  - [x] 18.1 Create migration `apps/api/migrations/0051_trip_experience_lists.sql` adding `trip_experience_lists (trip_id → trips ON DELETE CASCADE, experience_list_id → experience_lists ON DELETE CASCADE, added_by → users ON DELETE CASCADE, PRIMARY KEY (trip_id, experience_list_id))` plus its index, mirroring `0042_trip_food_lists.sql` exactly
    - _Requirements: 14.6, 14.7_
  - [x] 18.2 Add migration unit test `apps/api/src/db/__tests__/migration0051.test.ts`
    - _Requirements: 14.6, 14.7_
  - [x] 18.3 Add `TripExperienceListDTO` to `packages/shared/src/dto/Trip.ts`; add `experienceLists: readonly TripExperienceListDTO[]` to `TripDTO`; add `trip_experience_list_ineligible` (403) to `ERROR_CODES`/`errorCodeToHttpStatus`
    - _Requirements: 14.2, 14.8_
  - [x] 18.4 Implement `attachExperienceList`/`detachExperienceList` in `apps/api/src/services/trips/repo.ts`, mirroring `attachFoodList`/`detachFoodList` exactly (injected `resolveExperienceList` port; `ON CONFLICT DO NOTHING`; adder-or-organizer detach gate); this is a cross-spec edit to a file `trips` already shipped — flag it clearly in the commit/PR
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
  - [x] 18.5 Widen `Experience_List_Service`'s view-access predicate in `apps/api/src/services/experienceLists/repo.ts` with the `trip_experience_lists JOIN trip_memberships` OR-branch (this widening lives here, not in `trips`, since both halves ship together in this spec)
    - _Requirements: 3.2, 7.2, 14.1_
  - [x] 18.6 Wire `POST/DELETE /trips/:id/experience-lists[/:experienceListId]` routes in `apps/api/src/services/trips/routes.ts`; extend the Trip read projection to resolve `experienceLists` alongside `foodLists`, projecting `available: false` on a non-deletion resolve failure
    - _Requirements: 14.1, 14.4, 14.8_
  - [x] 18.7 Wire `resolveExperienceListForAttach` into `composeServices.ts`'s `trips` options block
    - _Requirements: 14.1, 14.2_
  - [x] 18.8 Write property/integration tests `apps/api/src/services/trips/__tests__/experienceListAttachment.test.ts` validating Property 16 (attach eligibility and idempotency) and Property 17 (attachment never touches `planned_items`), covering attach/detach (adder/organizer/forbidden-third-party), the ineligible-attach rejection, and the unavailable-entry projection
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.8, 14.9_
  - [x] 18.9 Checkpoint — run `npm run verify:api` and `npm run verify:shared`

- [x] 19. Trip Detail Mobile Surface for Attached Experience Lists
  - [x] 19.1 Build the "Attached Experience Lists" section on the Trip Detail hub, mirroring the existing "Attached Food Lists" section (render, attach control sourced from owned + public lists, detach, `available: false` treatment)
    - _Requirements: 14.1, 14.4, 14.8_
  - [x] 19.2 Write render/interaction tests mirroring the Food_List attachment section's coverage
    - _Requirements: 14.1, 14.4, 14.8_
  - [x] 19.3 Checkpoint — run `npm run verify:mobile`

- [x] 20. Schedule Builder / Planned List Picker Integration (Requirement 15)
  - [x] 20.1 Widen `ExperiencePicker.tsx` to accept the Trip's attached Experience_Lists (from the already-fetched `TripDTO.experienceLists`) and, when non-empty, render an additional "My Lists" tab; fetch each attached list's contents and merge into one flat, deduplicated-by-`experienceId` result set; omit the tab entirely when zero lists are attached
    - _Requirements: 15.1, 15.2, 15.3_
  - [x] 20.2 Annotate each merged row with an "Already added" tag when its `experienceId` already exists among the Trip's currently-fetched `planned_items` (any date), reusing the `planned-list-completion-sync`-style `experienceId`-matching approach
    - _Requirements: 15.5_
  - [x] 20.3 Confirm selecting a row from the "My Lists" tab flows through the existing `handleSelectExperience`/`POST /trips/:id/planned-items` path unchanged, with no new field written — no code change expected here beyond routing the new tab's selection through the existing handler, since both `TripPlannedListScreen.tsx` and `TripScheduleScreen.tsx` already render the shared `ExperiencePicker`
    - _Requirements: 15.4, 15.6_
  - [x] 20.4 Write/extend `ExperiencePicker.test.tsx` (exercised from both `TripScheduleScreen.test.tsx` and `TripPlannedListScreen.test.tsx`) validating Property 18 (tab presence/absence, union/dedup across attached lists) and Property 19 (identical request body/row regardless of selection source), plus the "Already added" tag's fixture-driven presence
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

- [x] 21. Final Verification & Quality Gate
  - [x] 21.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`)

- [ ] 22. Merge "Add to Trip" and "Add to a List" Into the Floating_Action_Dock (Requirement 17, cross-spec addition to `experience-detail-redesign`)
  - [ ] 22.1 Create `AddToTripOrListChoiceSheet.tsx` in `apps/mobile/src/screens/catalog/` — a small two-option modal (`Add to Trip` / `Add to a List` / Cancel/backdrop dismiss), mirroring `QuickActionSheet`'s modal/backdrop conventions at a smaller scale
    - _Requirements: 17.1, 17.6_
  - [ ] 22.2 Update `FloatingActionDock.tsx`: for the Ride/Character_Meet/Show and Resort branches, relabel the secondary pill "Add to Trip or List" (accessibility label "Add to trip or list") and route its `onPress` to open `AddToTripOrListChoiceSheet` instead of calling `onAddToPlan` directly; wire the sheet's `onAddToTrip` to the existing `onAddToPlan` prop and `onAddToList` to a new `onAddToExperienceList` prop; leave the Restaurant branch's secondary action untouched
    - _Requirements: 17.1, 17.2, 17.3, 17.5, 17.7_
  - [ ] 22.3 Update `ExperienceDetailScreen.tsx`: pass `onAddToExperienceList={() => setAddToExperienceListsSheetVisible(true)}` into `FloatingActionDock`; delete `AddToExperienceListCard.tsx` and its render call in `PassportAndLoreLens.tsx` (drop that component's now-unused `onAddToExperienceList` prop pass-through); `AddToExperienceListsSheet` itself is unchanged
    - _Requirements: 17.3, 17.4_
  - [ ] 22.4 Update/replace tests: extend `FloatingActionDock`'s test coverage for the new choice-sheet routing (Property 21) across Ride/Character_Meet/Show/Resort categories and the unaffected Restaurant case; remove or repurpose `ExperienceDetailScreen.addToExperienceList.test.tsx`'s assertions that targeted the now-deleted `AddToExperienceListCard` card, replacing them with assertions that the dock's choice sheet opens the same `AddToExperienceListsSheet`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_
  - [ ] 22.5 Checkpoint — run `npm run verify:mobile`

- [ ] 23. Trip Picker for "Add to Trip" (Requirement 18)
  - [ ] 23.1 Create `AddToTripPickerSheet.tsx` in `apps/mobile/src/screens/catalog/` — lists `active`/`upcoming` Trips (name + date range, mirroring `ActiveTripShortcut.tsx`'s `ActiveTripChooser` row styling), always rendered when visible regardless of trip count, Cancel/backdrop dismissible
    - _Requirements: 18.1, 18.4, 18.5_
  - [ ] 23.2 Split `ExperienceDetailScreen.tsx`'s `handleAddToPlan`: keep its existing eligible-trip resolution, but on a non-empty result open `AddToTripPickerSheet` instead of silently picking one; on an empty result keep the existing "No Active Trip" alert unchanged; extract the existing `POST /trips/:id/planned-items` call + success/error alert + invalidation into a new `addToTrip(tripId)` called from the sheet's `onSelect`
    - _Requirements: 18.1, 18.2, 18.3, 18.6_
  - [ ] 23.3 Update/extend `ExperienceDetailScreen.dockActions.test.tsx` and `FloatingActionDock.test.tsx`'s "Add to Trip" assertions to tap through the new picker (single-trip and multi-trip fixtures) before asserting the `POST` call, and add a multi-trip fixture asserting the correct selected trip's id lands in the request (Property 22, Property 23)
    - _Requirements: 18.1, 18.2, 18.3, 18.4_
  - [ ] 23.4 Checkpoint — run `npm run verify:mobile`

- [ ] 24. Relocate the "My Experience Lists" Collection card (Requirement 12's amendment; cross-spec with `navigation-redesign` Requirement 6's amendment/task 17)
  - [ ] 24.1 No new code in this spec — task 17 in `navigation-redesign`'s own tasks.md performs the actual relocation (splitting `CollectionScreen.tsx`'s "Food & Lists" segment into "Food" and "Lists", moving the existing "My Experience Lists" card into the new "Lists" segment unchanged). This task exists only so `experience-lists`' own plan reflects that Requirement 12's Collection entry point now lives outside a food-oriented view; do not implement task 17's work twice
    - _Requirements: 12.1_

- [x] 25. List Pinning (R19, added by this amendment; direct structural port of `food-lists` task 22)
  - [x] 25.1 Create migration `apps/api/migrations/0053_experience_list_pinning.sql` adding `experience_lists.pinned_at TIMESTAMPTZ NULL` and index `experience_lists_owner_pinned_idx (owner_id, pinned_at DESC, updated_at DESC)`
    - _Requirements: 19.1, 19.2_
  - [x] 25.2 Add migration test `apps/api/src/db/__tests__/migration0053.test.ts`
    - Asserts the column exists, is nullable, defaults to `null` on an insert that omits it, and can be set/cleared via `UPDATE`
    - _Requirements: 19.1, 19.2_
  - [x] 25.3 Widen `ExperienceListDTO`/`experienceListSchema` with `pinnedAt: string | null` (always present) and `UpdateExperienceListInputDTO`/`updateExperienceListInputSchema` with `pinned?: boolean` in `packages/shared/src/dto/ExperienceList.ts`/`packages/shared/src/schemas/ExperienceList.ts`
    - Add schema tests to `packages/shared/src/schemas/__tests__/ExperienceList.test.ts` covering `pinnedAt` null/timestamp/invalid, and `pinned` true/false/non-boolean
    - _Requirements: 19.1, 19.2_
  - [x] 25.4 Implement `ExperienceListRepo.setPinned(listId, ownerId, pinned)` in `apps/api/src/services/experienceLists/repo.ts`, mirroring `setVisibility`'s owner-only gating exactly but WITHOUT touching `updated_at`; widen `listOwned`'s `ORDER BY` to `pinned_at DESC NULLS LAST, updated_at DESC`; include `pinned_at`/`pinnedAt` in every `ExperienceListRow`-producing query (`getListSummary`, `listOwned`, `getListDetail`, all 4 `discover` variants, `getCollection`'s `saved` mapping)
    - _Requirements: 19.1, 19.2, 19.4_
  - [x] 25.5 Wire `PATCH /me/experience-lists/:id` to accept `pinned` and route to `setPinned`
    - _Requirements: 19.1, 19.2, 19.3_
  - [x] 25.6 Write property test coverage validating Property 24 (no side effects, ownership-gated) and Property 25 (pinned-first total ordering) in `apps/api/src/services/experienceLists/__tests__/experienceLists.prop.test.ts`
    - _Requirements: 19.1, 19.2, 19.3, 19.4_
  - [x] 25.7 Add route integration test coverage to `routes.test.ts`: `PATCH` with `pinned: true`/`false` calls `setPinned` and returns the expected `pinnedAt`; non-boolean `pinned` rejected with `400 validation_failed`; non-owner pin attempt rejected with the existing ownership-collapsing error
    - _Requirements: 19.1, 19.2, 19.3_
  - [x] 25.8 Checkpoint — ran `npx vitest run` for `apps/api/src/services/experienceLists` and related trips/friends/migration test files (all green) and `npx tsc --noEmit` for `apps/api`/`packages/shared` (clean); full `npm run verify:api`/`verify:shared` scripts not separately invoked this checkpoint, covered by the final full-workspace gate instead
    - _Requirements: 19.1, 19.2, 19.3, 19.4_
  - [x] 25.9 Add a pin/unpin toggle control to each row in `MyExperienceListsScreen.tsx`'s owned-list `FlatList`, alongside the existing Rename/Visibility/Delete controls, calling `PATCH /me/experience-lists/:id` with the new `pinned` value and invalidating `['experience-lists-collection']`
    - _Requirements: 19.5_
  - [x] 25.10 Write/extend `MyExperienceListsScreen.test.tsx` asserting the pin toggle renders per row, calls `PATCH` with the correct `pinned` value, and the row reflects the resulting pinned state
    - _Requirements: 19.5_
  - [x] 25.11 Checkpoint — ran `npx tsc --noEmit` (clean) and full `npx jest` (234 suites, 1564 tests, all passing) in `apps/mobile`; covered by the final full-workspace `npm run verify` gate as well

- [x] 26. Final Verification & Quality Gate (Re-run after R19)
  - [x] 26.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`) — apps/api: 375 test files / 2545 tests passed; apps/mobile: 234 suites / 1564 tests passed; packages/shared: 34 files / 390 tests passed; exit code 0

## Notes

- Tasks 8-9 (Visit Summary endpoint and `ParkPassportCard` consolidation) edit
  `experience-activity-logging`'s already-shipped files (`tracking/logs/repo.ts`,
  `tracking/logs/routes.ts`, `ParkPassportCard.tsx`). Tasks 18 edits `trips`' already-shipped
  files (`trips/repo.ts`, `trips/routes.ts`). Both are deliberate, spec'd cross-service edits —
  see design.md's "Why Visit_Summary lives in `tracking/logs`" and the Trip Attachment Bridge
  section — not accidental scope creep. Flag them explicitly in any commit/PR the same way
  `food-lists` task 24.2 flagged its own edit to `food-lists`' predicate from within `trips`.
- Task 9 (consolidating `ParkPassportCard`) is a refactor of already-shipped, already-tested
  code with no new user-facing behavior — its test task updates existing fixtures rather than
  adding new ones, per Requirement 16 and Property 20.
- Tasks 18-20 (Trip attachment + picker integration) depend on tasks 1-7 (the Experience_List
  service itself existing) being complete first, since `resolveExperienceListForAttach` calls
  into `ExperienceListRepo.resolveForAttachEligibility`, and the picker's "My Lists" tab reads
  `GET /experience-lists/:id`.
- Dining exclusion (Requirement 2.3, Property 3) must be implemented in task 2.2 before any add-item
  route or UI ships, since it is a write-path invariant, not a UI-only nicety.

## Task Dependency Graph

```
1 (migration + shared contracts)
   │
   ├──> 2 (ownership repo, edit-access, dining exclusion) ──> 3 (sharing + unfriend) ──> 4 (likes/saves)
   │                                                                                          │
   └──> 5 (discovery) ────────────────────────────────────────────────────────────────────────┤
                                                                                                ▼
                                                                                     6 (routes + notifications)
                                                                                                │
                                                                                                ▼
                                                                                    7 (checkpoint: backend)
                                                                                                │
                        ┌───────────────────────────────────────────────────────────────────────┤
                        ▼                                                                       │
        8 (visit-summary endpoint, tracking/logs)                                               │
                        │                                                                        │
                        ▼                                                                        │
        9 (ParkPassportCard consolidation)                                                       │
                        │                                                                        │
                        ▼                                                                        ▼
        10 (mobile: list screens) <───────────────────────────────────────────────────────────────┘
                        │
                        ├──> 11 (add-to-list entry points + dining exclusion UI)
                        ├──> 12 (item removal, manage sharing, reorder conflict UI)
                        ├──> 13 (visit summary + log-from-list UI, depends on 8)
                        └──> 14 (notification tap deep-link)
                        │
                        ▼
        15 (checkpoint: mobile)
                        │
                        ▼
        16 (profile entry point)
                        │
                        ▼
        17 (checkpoint: backend + mobile)
                        │
                        ▼
        18 (trip attachment bridge, depends on 2's resolveForAttachEligibility)
                        │
                        ▼
        19 (trip detail mobile surface)
                        │
                        ▼
        20 (schedule builder / planned list picker integration, depends on 18 + 19)
                        │
                        ▼
        21 (final verification, all workspaces)
```

Tasks 1-7 (the standalone Experience_List feature) can proceed independently of tasks 8-9 (the
Visit_Summary consolidation) — they touch disjoint files — but task 13 (visit summary UI)
cannot start until task 8 ships the endpoint it calls. Tasks 18-20 (Trip integration) are
strictly downstream of the standalone feature (task 2's port) and should not begin until
checkpoint 17 is green, consistent with `trips`' own historical sequencing of its Food_List
attachment work (built only after `food-lists` shipped its own backend checkpoint).
