# Implementation Plan: Notification Center

## Overview

This plan builds the Notification_Center bottom-up: first the one required
backend change (the `GET /me/rode-with-tags?state=pending` read plus its
additive DTOs), then the pure, dependency-free attention model in `@dwt/shared`,
then the mobile data/hook layer that fans out the four reads and orchestrates
optimistic inline actions, then the presentation layer, and finally push
routing and consolidation of the old actionable inboxes. Each step wires into
the previous one, and testing is attached as sub-tasks next to the code it
covers. Property tests are written against the 13 correctness properties from
the design; example/integration tests cover UI wiring, navigation, polling,
session lifecycle, and push routing.

Implementation language is **TypeScript**, matching the existing monorepo
(`apps/api`, `apps/mobile`, `packages/shared`), the `fast-check` + Jest /
`jest-expo` test stack, TanStack React Query, and Zustand `sessionStore`.

## Tasks

- [x] 1. Backend: additive shared DTOs and schemas for the rode-with pending read
  - [x] 1.1 Add `PendingRodeWithTagDTO` and `pendingRodeWithTagSchema` to shared
    - Add the `PendingRodeWithTagDTO` interface (`tagId`, `tripLogEntryId`, `experienceName`, `taggingMemberDisplayName`, `createdAt`) to `packages/shared/src/trips.ts`
    - Add a `pendingRodeWithTagSchema` Zod validator alongside the existing trips schemas for API/DTO drift protection
    - Export both from the package index (`packages/shared/src/index.ts`)
    - _Requirements: 3.3_

  - [x] 1.2 Add the additive `createdAt` field to `TripIncomingInviteDTO`
    - Add `readonly createdAt: string` (ISO-8601) to `TripIncomingInviteDTO` in `packages/shared/src/trips.ts`
    - Update the corresponding Zod schema so the field is validated without making it required of existing producers/consumers (additive, no reshape)
    - _Requirements: 1.3, 1.4, 7.3_

  - [x] 1.3 Write unit tests for the new/updated shared schemas
    - Assert `pendingRodeWithTagSchema` accepts a well-formed DTO and rejects missing/extra fields
    - Assert the updated trip-invite schema accepts payloads carrying `createdAt`
    - _Requirements: 3.3, 7.3_

- [x] 2. Backend: rode-with pending read migration and repo
  - [x] 2.1 Add migration `0017_rode_with_pending_read.sql`
    - Create `apps/api/migrations/0017_rode_with_pending_read.sql` with the additive partial index `rode_with_tags_pending_by_member_idx ON rode_with_tags (tagged_member_id, created_at DESC) WHERE state = 'pending'`
    - Wrap in `BEGIN`/`COMMIT` with an inline comment, following prior migration conventions; touch no data and leave existing indexes in place
    - _Requirements: 3.1, 3.2_

  - [x] 2.2 Implement `listPendingRodeWithTags(userId)` repo function
    - Add `listPendingRodeWithTags(userId: string): Promise<PendingRodeWithTagDTO[]>` to `apps/api/src/services/trips/repo.ts`, modeled on `listMyInvites` / `getRodeWithTag`
    - Scope to `rwt.tagged_member_id = $1 AND rwt.state = 'pending'`; join `trip_log_entries`, `experiences`, and the tagging member's `profiles` row to project the required fields
    - Order by `rwt.created_at DESC, rwt.id ASC`; return `[]` when the user has no pending tags
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.3 Select and map `trip_invites.created_at` in `listMyInvites`
    - Update `listMyInvites` in `apps/api/src/services/trips/repo.ts` to select `trip_invites.created_at` and map it into the new `TripIncomingInviteDTO.createdAt` field
    - _Requirements: 1.3, 1.4, 7.3_

  - [x] 2.4 Write property test for the rode-with pending read repo
    - **Property 9: Rode-with pending read is scoped, filtered, ordered, and complete**
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - Generate rode-with tags across arbitrary users and all states; assert the result is exactly the caller's `pending` tags, excludes others, is ordered by `created_at` DESC, and populates every required field
    - Run against a test database (following `migrationNNNN.test.ts` / `repo.test.ts` patterns) or a faithful in-memory fake of the query, tagged `Feature: notification-center, Property 9`

- [x] 3. Backend: rode-with pending read route
  - [x] 3.1 Register `GET /me/rode-with-tags?state=pending` in `tripRoutes`
    - Add the collection route in `apps/api/src/services/trips/routes.ts`, registered before the parametric `/me/rode-with-tags/:tagId` route so the query form wins over `:tagId`
    - Use `preHandler: requireSession` (unauthenticated → 401 before any repo call)
    - Validate the query with a strict `z.object({ state: z.literal('pending') }).strict()`; a missing/other `state` or any extra key → `validation_failed` (400) returning no tags
    - On success delegate to `listPendingRodeWithTags(userId)` and reply `200`
    - _Requirements: 3.1, 3.4, 3.5, 3.6_

  - [x] 3.2 Write route example/integration tests for the pending read
    - Happy path (returns pending tags ordered DESC) and empty (`200` with `[]`)
    - Missing/invalid/extra `state` query → 400 with no tags; unauthenticated → 401
    - Route-ordering: `?state=pending` on the collection path is not captured as `:tagId`
    - _Requirements: 3.4, 3.5, 3.6_

- [x] 4. Checkpoint - backend pending read complete
  - Ensure all backend tests (migration, repo, route) pass, ask the user if questions arise.

- [x] 5. Shared: pure attention model types and core normalization (`@dwt/shared/attention`)
  - [x] 5.1 Define attention model types
    - Create the `@dwt/shared/attention` module: `AttentionDomain`, `AttentionItem`, `AttentionItemRef`, `AttentionSourceOutcome`, `SortMode`, `BadgeDisplay`, `AttentionState`
    - Export from the shared package index; no React, no `fetch`, no timers
    - _Requirements: 1.2, 4.1, 8.1_

  - [x] 5.2 Implement `summarize` and `toAttentionItem`
    - `summarize(domain, dto)` builds the human-readable summary identifying originating user + referenced subject and hard-truncates to 140 characters
    - `toAttentionItem(domain, dto)` normalizes each domain DTO into an `AttentionItem` (id, sourceTimestamp, summary, ref) per the normalization table
    - _Requirements: 1.2, 1.3_

  - [x] 5.3 Write property test for item summary and shape
    - **Property 2: Item summary and shape**
    - **Validates: Requirements 1.3**
    - Generate arbitrary domain items (including >140-char and multi-byte/emoji summary inputs); assert each `AttentionItem` carries its domain type and source timestamp and summary length ≤ 140

- [x] 6. Shared: ordering functions
  - [x] 6.1 Implement `DOMAIN_ORDER`, `compareItems`, and `orderItems`
    - `DOMAIN_ORDER = ['friendRequest','tripInvite','rodeWithTag','share']`
    - `compareItems(a, b)`: timestamp descending, then `DOMAIN_ORDER` index, then `id` ascending lexicographic
    - `orderItems(items, sortMode)`: `timestampDesc` sorts via `compareItems`; `groupByDomain` groups in `DOMAIN_ORDER` with each group sorted by timestamp descending
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 6.2 Write property test for default timestamp-descending ordering
    - **Property 3: Default (timestamp-descending) ordering is a total order**
    - **Validates: Requirements 1.4, 1.5, 1.6**
    - Generate item sets with duplicate timestamps and shared ids; assert output is a permutation sorted by timestamp desc, then domain sequence, then id ascending

  - [x] 6.3 Write property test for group-by-domain ordering
    - **Property 4: Group-by-domain ordering**
    - **Validates: Requirements 1.8**
    - Assert output is a permutation grouped in `DOMAIN_ORDER`, each group sorted by timestamp descending

- [x] 7. Shared: badge display and top-level state reducer
  - [x] 7.1 Implement `badgeDisplayFor` and `buildAttentionState`
    - `badgeDisplayFor(count)`: `0 → hidden`, `1..99 → count`, `>=100 → overflow "99+"`
    - `buildAttentionState(outcomes, sortMode)`: concatenate items from successful sources only, order them, set `badgeCount = items.length`, derive `badgeDisplay` from that same count, collect `failedDomains`, set `allFailed` when every source failed
    - _Requirements: 1.2, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3, 5.6, 6.1, 6.2, 6.3, 8.1, 8.4, 8.7_

  - [x] 7.2 Write property test for feed composition over successful sources
    - **Property 1: Feed composition over successful sources**
    - **Validates: Requirements 1.2, 6.1, 6.3, 8.1**
    - Generate arbitrary per-source success/failure mixes; assert one item per pending item of each successful source, no item from failed sources, and `failedDomains` equals exactly the failed set

  - [x] 7.3 Write property test for badge count equals feed size
    - **Property 7: Badge count equals feed size**
    - **Validates: Requirements 4.1, 4.5, 5.3, 5.6, 6.2, 8.4**
    - Assert `badgeCount` equals rendered item count over the same outcomes; removing k items reduces the count by exactly k and it never goes negative

  - [x] 7.4 Write property test for badge display derivation
    - **Property 8: Badge display derivation**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.6, 10.3, 10.4**
    - Generate counts including the 99/100 boundary; assert hidden at 0, exact value 1..99, "99+" at ≥100, and display always derived from the single count

  - [x] 7.5 Write property test for total-failure state
    - **Property 11: Total-failure state**
    - **Validates: Requirements 8.3, 8.7**
    - Generate outcome sets where every source failed; assert `allFailed` (error state, never empty-success) and badge display is hidden

- [x] 8. Shared: retry merge and view classifier
  - [x] 8.1 Implement retry-merge state recomputation
    - Implement the retry path so `buildAttentionState` recomputes from the latest outcome of every source: retried successes replace prior failures and merge with previously loaded successful items; still-failed sources remain in `failedDomains`
    - _Requirements: 8.5, 8.6_

  - [x] 8.2 Write property test for retry recomputation
    - **Property 10: Retry recomputes state from the latest per-source outcomes**
    - **Validates: Requirements 8.5, 8.6**
    - Generate prior successful sources and retried outcomes; assert the merged state equals the state computed from the latest per-source outcomes

  - [x] 8.3 Implement the pure view classifier
    - Implement `classifyView(inFlight, outcomes)` returning exactly one of loading / empty / error / list: loading whenever any read is in flight; empty only when all four succeeded with zero total items; otherwise error (when applicable) or the populated list
    - _Requirements: 9.2, 9.3, 9.6_

  - [x] 8.4 Write property test for mutually exclusive view classification
    - **Property 12: View classification is mutually exclusive**
    - **Validates: Requirements 9.2, 9.3, 9.6**
    - Generate arbitrary in-flight/outcome combinations; assert exactly one view is returned with loading winning while any read is in flight

- [x] 9. Checkpoint - pure attention model complete
  - Ensure all `@dwt/shared` attention model property tests pass, ask the user if questions arise.

- [x] 10. Mobile: data/hook layer read fan-out
  - [x] 10.1 Implement `useAttention(sortMode)` read fan-out
    - Create `apps/mobile/src/features/notifications` hook layer wiring four React Query reads with keys `['friends']` (select `incomingRequests`), `['trips','invites']`, `['rodeWithTags','pending']` (new read), `['inbox']` (select unread items)
    - Adapt raw domain DTOs into `AttentionSourceOutcome` inputs and call `buildAttentionState`; return `AttentionState` plus per-source loading/failure flags
    - _Requirements: 1.1, 7.2, 7.4_

  - [x] 10.2 Enforce the Load_Deadline and per-source failure normalization
    - Give each read a per-attempt 10s `AbortController` with `retry: false`; normalize a rejection, non-2xx `ApiError`, or abort/timeout into an `AttentionSourceOutcome` of `status: 'failure'`
    - _Requirements: 8.1, 9.4_

  - [x] 10.3 Configure foreground polling and focus refresh
    - Set `refetchInterval: 60_000` on all four reads for foreground polling; refetch all four on return via `useFocusEffect`
    - _Requirements: 5.1, 5.5, 6.1, 6.3, 10.6_

  - [x] 10.4 Implement session gating and cache clearing
    - Subscribe to `sessionStore.token`; with no token set queries `enabled: false` and return an empty state (no items, hidden badge)
    - On session end (401 → `notifyUnauthorized()`), call `queryClient.clear()` so no pending item leaks to a later session
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 10.5 Write property test for session gating
    - **Property 13: Session gating**
    - **Validates: Requirements 11.2, 11.3**
    - With cached/prior domain data and no authenticated session, assert the feed presents no items and the badge shows no count (hook-level test with mocked `apiRequest` and a `QueryClientProvider`)

  - [x] 10.6 Write integration tests for the read fan-out
    - Fan-out fires all four reads on open (R1.1); only the four read endpoints are used (R7.2, R7.4); 60s polling and `useFocusEffect` refresh configured (R5.1, R5.5, R6.1, R10.6); session end clears cache (R11.4–R11.6)
    - _Requirements: 1.1, 5.1, 5.5, 6.1, 7.2, 7.4, 10.6, 11.4, 11.5, 11.6_

- [x] 11. Mobile: inline action mutations with optimistic removal
  - [x] 11.1 Implement the inline action mutations
    - Add one `useMutation` per action kind (friend-request accept/decline, trip-invite accept/decline, rode-with confirm-with-optional-rating/decline, share mark-read), each calling the existing unchanged endpoint via `apiRequest('POST', endpoint, body?, signal)` with a 10s `AbortController`
    - `onMutate`: snapshot and optimistically remove the item from every relevant cached list (badge derives from list length)
    - On any returned response: keep the item removed and invalidate that source to refresh within the deadline; map `ApiError.code` (`trip_not_found`, `trip_tag_state_invalid`, `friendship_not_found`, inbox not-found) → "no longer available", other failures → "action did not complete"
    - On timeout/abort (no response): restore the snapshot item and show "action did not complete"
    - _Requirements: 2.2, 2.4, 2.5, 2.6, 2.7, 2.8, 5.2, 5.3, 7.6_

  - [x] 11.2 Write property test for inline action endpoint mapping
    - **Property 5: Inline action endpoint mapping**
    - **Validates: Requirements 2.2, 7.6**
    - Generate arbitrary items + valid actions; assert exactly the correct domain endpoint (method, path, identifiers, optional rating) is invoked and no other endpoint (mocked `apiRequest`)

  - [x] 11.3 Write property test for optimistic removal outcome invariant
    - **Property 6: Optimistic removal outcome invariant**
    - **Validates: Requirements 2.4, 2.5, 2.6, 2.7, 2.8, 5.2**
    - Assert: any returned response (success or failure) → item absent; timeout/no response → item restored; all other items unchanged (hook-level test with mocked `apiRequest` and `QueryClientProvider`)

  - [x] 11.4 Implement `useAttentionBadge()`
    - Add a thin wrapper returning just `badgeDisplay` from the same hook/query keys so the badge and open feed observe identical data
    - _Requirements: 4.5, 5.6, 10.6_

- [x] 12. Checkpoint - mobile data/hook layer complete
  - Ensure all hook-level property and integration tests pass, ask the user if questions arise.

- [x] 13. Mobile: presentation layer
  - [x] 13.1 Implement `AttentionItemRow` with per-domain inline controls
    - Render domain type, summary, and relative timestamp; render per-domain controls: Accept/Decline (friend request, trip invite), Confirm-with-optional-rating/Decline (rode-with tag), Mark read (share)
    - Render an "Open" control for a Share that references a Share_Destination, reusing the Inbox screen's destination-verify + cross-navigate logic
    - Surface action errors per-row so one failed action never blocks other rows
    - _Requirements: 2.1, 2.3_

  - [x] 13.2 Implement `AttentionBadge` component
    - Themed count badge rendering `hidden` / `count` / `"99+"` from `badgeDisplay`; usable on the Profile tab and optionally in the screen header
    - _Requirements: 4.2, 4.3, 4.4, 10.3, 10.4_

  - [x] 13.3 Implement `NotificationCenterScreen`
    - Host the Attention_Feed, the sort control (timestamp-desc ↔ group-by-domain), and render exactly one of loading / empty / error via the pure view classifier (loading wins while any read is in flight; empty only when all four succeed with zero items)
    - Add the partial-failure banner naming failed domains, an enabled retry control that re-requests only failed sources, and a control that opens the full `ShareInboxScreen`
    - _Requirements: 1.7, 2.9, 8.1, 8.2, 8.3, 8.5, 9.1, 9.2, 9.3, 9.5, 9.6, 12.2_

  - [x] 13.4 Write presentation example tests
    - Per-domain inline controls render (R2.1); share open-destination control conditional on a destination (R2.3); sort-control toggle (R1.7); loading/empty/error branches and their exclusivity in the rendered tree (R9.1, R9.5); retry re-requests only failed sources (R8.2); open-full-inbox control (R2.9, R12.2)
    - _Requirements: 1.7, 2.1, 2.3, 2.9, 8.2, 9.1, 9.5, 12.2_

- [x] 14. Mobile: Profile entry point, badge placement, and generalized badge
  - [x] 14.1 Add the Profile_Notifications_Entry and Profile-tab badge
    - Add a Profile-area entry that opens `NotificationCenterScreen`; render `AttentionBadge` on the Profile tab using the single derived total attention count; leave the bottom tab bar unchanged (Home, Catalog, Trips, Friends, Profile — no Notifications tab)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 14.2 Replace `useNotificationBadgeCount()` with `useAttentionBadge()` in `RootNavigator`
    - Remove the ad-hoc two-domain rollup rendered on the Friends tab; render the four-domain badge on the Profile tab
    - _Requirements: 4.1, 10.3_

  - [x] 14.3 Write navigation/tab example tests
    - Tab bar unchanged with no Notifications tab (R10.1); Profile_Notifications_Entry opens the center (R10.2, R10.5); badge on the Profile tab reflects the count (R10.3, R10.4)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 15. Mobile: consolidate old actionable inboxes
  - [x] 15.1 Remove the Friends list friend-request accept/decline actionable section
    - Remove the incoming friend-request accept/decline actionable section from the Friends list so the Notification_Center is the single surface for those actions
    - _Requirements: 7.1_

  - [x] 15.2 Remove the Trips list invitations actionable section
    - Remove the trip-invite invitations actionable section from the Trips list so the Notification_Center is the single surface for those actions
    - _Requirements: 7.5_

  - [x] 15.3 Keep the Share_Inbox as a browse/history/react surface
    - Ensure `ShareInboxScreen` still lists delivered shares regardless of read state via the unchanged `GET /me/inbox`, supports add/change per-share reaction, is reachable from the Notification_Center, and reflects a share marked read from the center via shared cache invalidation
    - _Requirements: 7.7, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 15.4 Write consolidation example tests
    - Friends list no longer renders friend-request accept/decline as an actionable section (R7.1); Trips list no longer renders invitations actions (R7.5); Share_Inbox still lists read+unread shares and supports reactions (R7.7, R12.1, R12.3, R12.4); marking a share read in the center reflects in the inbox (R12.5)
    - _Requirements: 7.1, 7.5, 7.7, 12.1, 12.3, 12.4, 12.5_

- [x] 16. Mobile: push routing into the Notification_Center
  - [x] 16.1 Route tapped pushes to the Notification_Center
    - Update `useNotificationResponse` / `navigationRef` so a tapped push for a Friend_Request, Trip_Invite, Rode_With_Tag, or Share opens the Notification_Center; add `navigateToNotificationCenter(params?: { focusRef?: AttentionItemRef })` deep-linking into the Profile stack
    - Remove the `TripInvite`, `RodeWithConfirm`, and inbox deep-link targets from the tap-routing switch in `dispatchPendingTap`
    - _Requirements: 13.1, 13.4_

  - [x] 16.2 Surface the referenced item or show "no longer available"
    - On open from a tap, attempt to surface the referenced Attention_Item so its inline action is available while still pending; if it is no longer pending/available, show the "no longer available" indication and still open the feed where possible
    - _Requirements: 13.2, 13.3_

  - [x] 16.3 Write push-routing example tests
    - Taps for all four kinds open the Notification_Center and no longer route to standalone handler screens (R13.1, R13.4); a still-pending referenced item is surfaced (R13.2); a stale referenced item shows "no longer available" (R13.3)
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 17. Final checkpoint - full feature wired and tested
  - Ensure all backend, shared, hook, presentation, navigation, consolidation, and push-routing tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a
  faster MVP, though the property tests directly validate the design's
  correctness properties and are recommended.
- Each task references specific granular requirements for traceability.
- Property tests use `fast-check` with `{ numRuns: 100 }` and are tagged
  `Feature: notification-center, Property {number}: {property_text}`; each of the
  13 properties is a single property-based test placed next to the code it
  validates.
- The backend reuses existing per-domain endpoints unchanged; the only backend
  additions are the new pending read, the additive `PendingRodeWithTagDTO`, and
  the additive `TripIncomingInviteDTO.createdAt` field. Surviving domain tests
  act as contract regression guards.
- Checkpoints ensure incremental validation at each layer boundary.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["1.3", "2.2", "2.3", "5.1"] },
    { "id": 2, "tasks": ["2.4", "3.1", "5.2", "6.1", "7.1", "8.1", "8.3"] },
    { "id": 3, "tasks": ["3.2", "5.3", "6.2", "6.3", "7.2", "7.3", "7.4", "7.5", "8.2", "8.4"] },
    { "id": 4, "tasks": ["10.1", "10.2", "10.3", "10.4"] },
    { "id": 5, "tasks": ["10.5", "10.6", "11.1", "11.4"] },
    { "id": 6, "tasks": ["11.2", "11.3"] },
    { "id": 7, "tasks": ["13.1", "13.2", "13.3", "14.1", "14.2"] },
    { "id": 8, "tasks": ["13.4", "14.3", "15.1", "15.2", "15.3", "16.1"] },
    { "id": 9, "tasks": ["15.4", "16.2"] },
    { "id": 10, "tasks": ["16.3"] }
  ]
}
```
