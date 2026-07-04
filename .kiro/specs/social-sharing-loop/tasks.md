# Implementation Plan: Social Sharing Loop

## Overview

This plan converts the Social Sharing Loop design into incremental coding steps across the
three independently shippable phases. Phase 1 (R1–R6) reworks the mobile share flow and the
`Sharing_Service.listInbox` projection. Phase 2 (R7–R11) adds the backend push/notification/
reaction services, one migration, and the mobile push plumbing. Phase 3 (R12–R14) adds the
client-side `Progress_Comparison` and `Completion_Diff` to the `Friend_Profile_View`.

Implementation language is **TypeScript** throughout: the Fastify monolith in `apps/api`,
shared contracts in `packages/shared` (`@dwt/shared`), and the React Native / Expo client in
`apps/mobile`. Property-based tests use `fast-check`; UI tests use `@testing-library/react-native`.

Each phase ends with a checkpoint. Test sub-tasks are marked `*` and may be skipped for a faster
MVP; core implementation sub-tasks are not.

## Tasks

### Phase 1 — Close the broken loop (R1–R6)

- [x] 1. Extend shared inbox contracts for the reworked projection
  - [x] 1.1 Add `InboxItemDTO` and `InboxResponse` to `@dwt/shared`
    - Define the recipient-view DTO with `shareId`, `read`, `senderId`, `senderDisplayName`, `payloadKind`, `payload`, `sentAt`, and a nullable `myReaction` field (reaction type finalized in Phase 2)
    - Export the DTOs and any Zod schemas from the shared package index
    - _Requirements: 4.1, 6.2, 6.6_

- [x] 2. Rework `Sharing_Service.listInbox` disclosure projection
  - [x] 2.1 Rework the `listInbox` repo query and route projection
    - Project sender id/display name (join `profiles`), payload, `sentAt`, per-recipient `read` (`opened_at IS NOT NULL`), and the recipient's own reaction for every non-deleted row
    - Compute `unread` as the count of items with `opened_at IS NULL`
    - Keep the `recipient_id = $1` predicate as the privacy boundary; add no new required request params to `GET /me/inbox`
    - _Requirements: 4.1, 6.1, 6.2, 6.6_
  - [x] 2.2 Write property test for inbox privacy boundary
    - **Property 12: Inbox discloses only the requesting recipient's shares**
    - **Validates: Requirements 6.1**
  - [x] 2.3 Write unit tests for the projection including legacy payloads
    - Cover pre-feature `experience` payloads lacking name/Park/category and mixed read/unread rows
    - _Requirements: 6.3, 6.4_

- [x] 3. Promote `Share_Composer` to `RootStack` with typed params
  - [x] 3.1 Add discriminated `ShareComposerParams` to `RootStackParamList` and register the modal route
    - Define the `experience` and `progress` param variants per the design
    - Move the `ShareComposer` route from `FriendsStack` to `RootStack` as a modal screen
    - _Requirements: 2.1, 3.2, 3.3_

- [x] 4. Implement content-anchored `Share_Entry_Point`s
  - [x] 4.1 Add the entry point to `ExperienceDetailScreen`
    - Render a themed share control; disable it while the Experience detail, viewer Rating, or viewer Note query is loading
    - On activation build `experience` params from loaded detail plus the viewer's Rating (whole 1–10 when present) and Note (≤2000 chars when present) and `navigate('ShareComposer', params)`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 4.2 Add the entry point to `StatsScreen` (Progress_Screen)
    - Render a themed share control; disable it while `GET /me/stats` is loading
    - On activation build `progress` params carrying overall/per-Park/per-category percentages each to one decimal as displayed
    - _Requirements: 1.6, 1.7, 1.8_
  - [x] 4.3 Write property test for entry point enablement
    - **Property 1: Share entry point enablement tracks content-load state**
    - **Validates: Requirements 1.2, 1.7**
  - [x] 4.4 Write property test for content projection into params
    - **Property 2: Entry point projects content faithfully into composer params**
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.8**

- [x] 5. Rework the `Share_Composer` screen behavior
  - [x] 5.1 Implement kind-derived read-only preview and include/exclude toggles
    - Derive payload kind from `route.params.kind` with no kind picker and no free-text identifier input
    - Render a read-only preview: name/Park/category and each included value for `experience`; overall percent to one decimal for `progress`
    - Provide independent Rating/Note include toggles, each defaulting to included when present
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.14_
  - [x] 5.2 Implement the recipient picker with send gating and empty state
    - Load friends via `GET /me/friends`; allow selecting 1–50 recipients
    - Disable send while the count is 0 or >50; show the no-friends empty state and disable send when the User has zero friends
    - _Requirements: 2.6, 2.7, 2.15_
  - [x] 5.3 Implement submission with success and error handling
    - Submit via `POST /me/shares` using the existing contract, including only toggled Rating/Note values
    - Show a loading indication and disable send while submitting; on success show a 250 ms indication then `goBack()`
    - Map `share_recipient_count_invalid`, `share_atomic_rejected`, and generic failures to messages that keep the User on the composer and retain selection
    - _Requirements: 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 6.5_
  - [x] 5.4 Write property test for send-control gating
    - **Property 3: Composer send control is gated by recipient count**
    - **Validates: Requirements 2.6, 2.7, 2.15**
  - [x] 5.5 Write property test for submitted body composition
    - **Property 4: Composer submits derived content with only marked values**
    - **Validates: Requirements 2.8, 2.14**
  - [x] 5.6 Write unit tests for composer states
    - Submitting state, 250 ms success-then-return with fake timers, and mapped error messages
    - _Requirements: 2.9, 2.10, 2.11, 2.12, 2.13_

- [x] 6. Remove the Friends-page Share entry
  - [x] 6.1 Remove the top-level Share control from `FriendsListScreen`
    - Retain the Inbox and Find controls; the Inbox control navigates to `Inbox`
    - _Requirements: 3.1, 3.4, 3.5_
  - [x] 6.2 Write unit test that the composer opens only from an entry point
    - _Requirements: 3.2_

- [x] 7. Render human-readable Inbox content
  - [x] 7.1 Render sender, timestamp, unread count, and progress percentages
    - Render every delivered share with the sender display name and timestamp regardless of `Read_State`; derive unread from unread items
    - Render `progress` shares' overall/per-Park/per-category percentages to one decimal
    - _Requirements: 4.1, 4.9, 6.2_
  - [x] 7.2 Resolve Experience metadata with loading and fallback
    - Resolve name/Park/category via a deduplicated catalog read; show a per-share loading indication under 10 s
    - On failure or after 10 s show an Experience-unavailable fallback label while keeping remaining content; never use the raw identifier as the primary label
    - _Requirements: 4.2, 4.3, 4.10, 4.11, 6.3, 6.4_
  - [x] 7.3 Render Rating and Note per payload state
    - Show Rating as 1–10 when present, a rating-unavailable indication when marked unavailable, nothing otherwise
    - Show the full Note (≤2000 chars) when present, nothing when absent
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.8_
  - [x] 7.4 Write property test for inbox disclosure and unread count
    - **Property 5: Inbox discloses sender, content, and timestamp for every item; unread counts unread items**
    - **Validates: Requirements 4.1, 6.2**
  - [x] 7.5 Write property test for resolved metadata rendering
    - **Property 6: Inbox renders resolved Experience metadata and never the raw identifier**
    - **Validates: Requirements 4.2, 4.3**
  - [x] 7.6 Write property test for rating rendering
    - **Property 7: Inbox rating rendering matches payload rating state**
    - **Validates: Requirements 4.4, 4.5, 4.6**
  - [x] 7.7 Write property test for note rendering
    - **Property 8: Inbox note rendering matches payload note state**
    - **Validates: Requirements 4.7, 4.8**
  - [x] 7.8 Write property test for progress percentage rendering
    - **Property 9: Inbox renders progress percentages to one decimal place**
    - **Validates: Requirements 4.9**

- [x] 8. Implement Inbox tap-through navigation
  - [x] 8.1 Implement cross-stack tap-through with read-state and single-flight verification
    - Navigate an `experience` share to `ExperienceDetail` on `RootStack` after verifying retrievability; navigate a `progress` share to `FriendProfile` after verifying the sender is still a Friend
    - Set `Read_State=read` via `POST /me/inbox/:shareId/open` on selecting an unread share and update the unread count
    - Keep the User on the Inbox with a message on unavailable destinations; suppress a second navigation for the same share while verifying
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x] 8.2 Write property test for read-state on open
    - **Property 10: Opening an unread share marks it read and decrements the unread count**
    - **Validates: Requirements 5.3**
  - [x] 8.3 Write property test for single-flight verification
    - **Property 11: Destination verification is single-flight per share**
    - **Validates: Requirements 5.7**
  - [x] 8.4 Write unit tests for tap-through navigation and failure branches
    - Assert cross-navigator dispatches and unavailable-destination messages using a test navigation container
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

- [x] 9. Checkpoint — Phase 1
  - Ensure all tests pass, ask the user if questions arise.

### Phase 2 — Land a Share and let recipients respond (R7–R11)

- [x] 10. Add Phase 2 shared contracts
  - [x] 10.1 Add the `Reaction_Vocabulary` enum, Zod schema, DTOs, and error codes
    - Add `SHARE_REACTION_VALUES`/`ShareReactionValue` to `enums.ts` and `shareReactionValueSchema` to primitives
    - Add `ShareReactionDTO` and `NotificationPreferenceDTO`; finalize `InboxItemDTO.myReaction` type
    - Add `reaction_invalid`, `reaction_forbidden`, and `push_registration_invalid` to `ERROR_CODES` and `errorCodeToHttpStatus`
    - _Requirements: 8.7, 11.2, 11.3_

- [x] 11. Add the Phase 2 database migration
  - [x] 11.1 Write `migrations/0011_social_sharing_loop.sql`
    - Create `push_registrations` (unique `expo_push_token`, unique `(user_id, device_id)`, status check, active index), `notification_preferences`, and `share_reactions` (composite PK, reaction CHECK, share index)
    - _Requirements: 8.3, 8.5, 11.3, 11.4_
  - [x] 11.2 Write a migration test following the `migration0009.test.ts` pattern
    - Assert table creation, the `expo_push_token` unique constraint, the `share_reactions` primary key, and the reaction CHECK
    - _Requirements: 8.3, 11.4_

- [x] 12. Implement the `Push_Registration_Service`
  - [x] 12.1 Implement the push repo and routes
    - `POST /me/push-registrations` upserts on the physical token (reassign + activate) and on `(user_id, device_id)` (token rotation); `DELETE /me/push-registrations` invalidates the current device; exclude invalidated registrations from delivery
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 12.2 Write property test for the push-token ownership invariant
    - **Property 14: A push token is active for exactly one user — the most recent registrant**
    - **Validates: Requirements 8.2, 8.3, 8.5**
  - [x] 12.3 Write unit tests for registration and invalidation
    - Logout invalidation, exclusion of invalidated tokens, and malformed-input rejection
    - _Requirements: 8.4, 8.6, 8.7_

- [x] 13. Implement the notification preference store
  - [x] 13.1 Implement the preference repo and routes
    - `GET /me/notification-preferences` returns `{ shareNotificationsEnabled }` defaulting to `true` when unset; `PUT` persists the value and returns an error when it cannot persist
    - _Requirements: 9.3, 9.4, 9.5, 9.7, 9.8_
  - [x] 13.2 Write unit tests for default and persistence-failure behavior
    - _Requirements: 9.7, 9.8_

- [x] 14. Implement the `Reaction_Service`
  - [x] 14.1 Implement the reaction repo and routes
    - `POST /me/inbox/:shareId/reactions` validates against the vocabulary, enforces recipient authorization, upserts at most one reaction per `(share, recipient)`, and replaces on resubmit; `DELETE` removes it; `GET /me/shares/:shareId/reactions` is gated to the sender and returns each reaction with the reactor's display name
    - _Requirements: 11.1, 11.4, 11.5, 11.6, 11.7, 11.8_
  - [x] 14.2 Write property test for reaction validation
    - **Property 16: Reactions are accepted if and only if drawn from the Reaction_Vocabulary**
    - **Validates: Requirements 11.2, 11.3**
  - [x] 14.3 Write property test for reaction lifecycle
    - **Property 17: Reaction lifecycle maintains at most one reaction per share per recipient**
    - **Validates: Requirements 11.1, 11.4, 11.5, 11.6**
  - [x] 14.4 Write property test for reaction authorization
    - **Property 18: Reacting to an undelivered share is rejected with an authorization error**
    - **Validates: Requirements 11.8**
  - [x] 14.5 Write property test for the sender's reaction view
    - **Property 19: Sender's reaction view lists every reaction with its reactor's display name**
    - **Validates: Requirements 11.7**

- [x] 15. Implement the `Notification_Service`
  - [x] 15.1 Implement composition, delivery targeting, and retry/invalidation
    - Handle `ShareDelivered`: skip disabled recipients, target only active tokens, compose title=sender name and body=label ≤100 chars (Experience name truncated or "shared progress") with no rating/note/percentages
    - Send via the Expo Push API with ≤3 retries within 30 s; invalidate registrations on "device not registered" receipts; never fail or block `POST /me/shares`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.6, 9.4, 9.5, 9.7_
  - [x] 15.2 Write property test for notification composition
    - **Property 13: Notification composition discloses only sender name and a bounded label**
    - **Validates: Requirements 7.2, 7.3**
  - [x] 15.3 Write property test for delivery targeting
    - **Property 15: Delivery targets are exactly the active tokens of preference-enabled recipients**
    - **Validates: Requirements 8.6, 9.4, 9.5, 9.7**
  - [x] 15.4 Write integration tests against a fake Expo client
    - One delivery per active token within the window, token invalidation on a not-registered receipt, ≤3 retries while `POST /me/shares` still returns 201, no-notification when no active registration, and the progress-share label
    - _Requirements: 7.1, 7.4, 7.5, 7.6, 7.7_

- [x] 16. Wire the Phase 2 services and the ShareDelivered seam
  - [x] 16.1 Register the new services and dispatch `ShareDelivered` after commit
    - Wire `push`, `notifications`, and `reactions` through `composeServices.ts` and register them in `server.ts`; invoke the notification dispatch on a background port after `createShareAtomic` commits
    - _Requirements: 7.7_

- [x] 17. Checkpoint — Phase 2 backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Implement push registration and permission on mobile
  - [x] 18.1 Implement `usePushRegistration` with device id, permission, and retries
    - On authentication request `Notification_Permission` if never requested; on grant obtain the Expo token and register within 10 s, retrying ≤3 times ≤60 s apart; persist a stable device id in `expo-secure-store`; on denial register nothing and continue; on logout request invalidation without blocking
    - Add `expo-notifications` as a mobile dependency
    - _Requirements: 8.1, 8.2, 8.7, 8.8, 9.1, 9.2_
  - [x] 18.2 Write unit tests for permission, token, logout, and retry flows
    - Mock `expo-notifications` and secure store; cover grant/deny, retry exhaustion, and non-blocking logout
    - _Requirements: 8.1, 8.4, 8.7, 8.8, 9.1, 9.2_

- [x] 19. Implement the `Share_Notification_Preference` control
  - [x] 19.1 Add the preference control to `ProfileScreen`
    - Display and edit the preference; on OS-permission revocation render an "unavailable until re-granted" state on next foreground regardless of stored value
    - _Requirements: 9.3, 9.6, 9.8_
  - [x] 19.2 Write unit tests for display, revoked, and persist-failure states
    - _Requirements: 9.3, 9.6, 9.8_

- [x] 20. Implement notification tap deep-linking
  - [x] 20.1 Implement the notification response handler
    - Navigate to the Inbox within 3 s of foreground, then to the share destination setting `Read_State=read`; require auth first when unauthenticated; show "no longer available" when the share is gone; open the Inbox when the payload lacks a resolvable share id
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [x] 20.2 Write unit tests for deep-link branches
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 21. Implement reactions UI and the Sent Shares surface
  - [x] 21.1 Add reaction controls to the Inbox share view
    - Offer only vocabulary reactions (no free text); show loading, empty, and unavailable states; keep the share view and prior state on non-authorization failures
    - _Requirements: 11.2, 11.9, 11.10, 11.11, 11.12_
  - [x] 21.2 Add the Sent Shares screen listing reactions with reactor names
    - List the User's sent shares and each share's reactions with reactor display names, with loading, empty, and unavailable states
    - _Requirements: 11.7, 11.9, 11.10, 11.11_
  - [x] 21.3 Write unit tests for reaction UI states
    - _Requirements: 11.9, 11.10, 11.11, 11.12_

- [x] 22. Checkpoint — Phase 2 mobile
  - Ensure all tests pass, ask the user if questions arise.

### Phase 3 — Progress comparison (R12–R14)

- [x] 23. Add the viewer's own reads to the `Friend_Profile_View`
  - [x] 23.1 Add own-stats and own-completions queries
    - Read `GET /me/stats` and the owner-path `GET /users/:ownId/completions` alongside the existing friend reads so the comparison and diff derive from already-retrieved data
    - _Requirements: 12.4, 13.5_

- [x] 24. Implement the `Progress_Comparison`
  - [x] 24.1 Implement the comparison derivation and rendering
    - Render viewer and Friend overall, per-Park, and per-category percentages side by side, each in `[0.0,100.0]` to one decimal and labeled by owner; show loading under 30 s and a comparison-unavailable message on failure/timeout while keeping remaining content
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.6_
  - [x] 24.2 Write property test for the comparison presentation
    - **Property 20: Progress comparison presents both parties' percentages, labeled and one-decimal**
    - **Validates: Requirements 12.1, 12.2, 12.3**
  - [x] 24.3 Write edge-case tests for loading and unavailable windows
    - Use fake timers for the 30 s window and failure branch
    - _Requirements: 12.5, 12.6_

- [x] 25. Implement the `Completion_Diff`
  - [x] 25.1 Implement the diff derivation, rendering, navigation, and states
    - Render the friend-minus-viewer set difference by Experience identity, each entry showing name/Park/category and navigating to `ExperienceDetail`; show empty, loading, and unavailable states and an Experience-unavailable message on a failed entry read
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.6, 13.7, 13.8_
  - [x] 25.2 Write property test for the diff computation
    - **Property 21: Completion diff is the friend-minus-viewer set difference by Experience identity**
    - **Validates: Requirements 13.1, 13.4**
  - [x] 25.3 Write property test for diff entry metadata
    - **Property 22: Each completion-diff entry carries name, Park, and Experience_Category**
    - **Validates: Requirements 13.2**

- [x] 26. Implement the `Progress_Share` deep-link to the comparison
  - [x] 26.1 Add the `initialSection` param and wire the Inbox navigation
    - Add optional `initialSection: 'comparison'` to `FriendProfileParams`; navigate a `Progress_Share` tap cross-stack to `FriendProfile` with the comparison section initially visible; keep the User on the Inbox when the sender is no longer a Friend; complete navigation and show the comparison-unavailable indication when data cannot be retrieved
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - [x] 26.2 Write unit tests for the comparison deep-link branches
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 27. Final checkpoint — Phase 3
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP.
- Each phase (1, 2, 3) is independently shippable; the Phase 1 checkpoint is a valid ship point.
- Property tests use `fast-check` (min 100 iterations) and are each tagged `Feature: social-sharing-loop, Property {n}: ...`; each property is its own sub-task placed next to its implementation.
- Backend properties (12–19) live under `apps/api/src/services/**/__tests__/*.prop.test.ts`; mobile properties (1–11, 20, 22) live under `apps/mobile/src/screens/**/__tests__/*.prop.test.tsx`.
- All tasks reuse the existing `AppError`/`ErrorCode` envelope and the constructor-injected factory + `composeServices.ts` wiring conventions.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "11.1"] },
    { "id": 1, "tasks": ["2.1", "4.1", "4.2", "10.1", "11.2"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.3", "4.4", "5.1", "6.1", "7.1", "12.1", "13.1"] },
    { "id": 3, "tasks": ["5.2", "6.2", "7.2", "12.2", "12.3", "13.2", "14.1"] },
    { "id": 4, "tasks": ["5.3", "7.3", "14.2", "14.3", "14.4", "14.5", "15.1"] },
    { "id": 5, "tasks": ["5.4", "5.5", "5.6", "7.4", "7.5", "7.6", "7.7", "7.8", "8.1", "15.2", "15.3", "15.4", "16.1"] },
    { "id": 6, "tasks": ["8.2", "8.3", "8.4", "18.1", "19.1", "20.1", "21.1", "21.2", "23.1"] },
    { "id": 7, "tasks": ["18.2", "19.2", "20.2", "21.3", "24.1"] },
    { "id": 8, "tasks": ["24.2", "24.3", "25.1"] },
    { "id": 9, "tasks": ["25.2", "25.3", "26.1"] },
    { "id": 10, "tasks": ["26.2"] }
  ]
}
```
