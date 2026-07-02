# Implementation Plan: Friend Stats Viewing

## Overview

This plan builds the Friend Stats Viewing feature additively on the existing Disney World Tracker backend and mobile app, in TypeScript (Fastify API + React Native/Expo client), matching the established service/repo/route and `*.prop.test.ts` conventions.

The work proceeds bottom-up: schema and shared DTOs first, then the single shared owner-or-friend authorization helper (extracted from the two existing copies), then the new Friend Completions repository and route, then the minimal Note write-path extension, and finally the `Friend_Profile_View` mobile screen with its navigation and per-request state machine. Each step builds on the previous and ends wired into the running system. Property-based tests follow the design's Correctness Properties (Properties 1–9); each property is its own sub-task annotated with the property number and the requirements clause it validates.

## Tasks

- [x] 1. Schema and shared DTO foundation
  - [x] 1.1 Add `notes.shareable` migration
    - Create `apps/api/migrations/0003_note_shareable.sql` adding `shareable BOOLEAN NOT NULL DEFAULT FALSE` to the `notes` table, wrapped in a `BEGIN`/`COMMIT` transaction
    - Follow the existing migration file conventions in `0001_init.sql` / `0002_experience_images.sql`
    - This makes every existing and new Note private by default and gives the read path a flag to honor
    - _Requirements: 4.6, 4.7_

  - [x] 1.2 Add Friend Completions DTOs to `@dwt/shared`
    - Create `packages/shared/src/dto/CompletionEntry.ts` exporting `CompletionEntryDTO` (`experienceName`, `park: Park`, `category: ExperienceCategory`, `completedOn: string`, `rating: number | null`, `sharedNote: string | null`) and `FriendCompletionsDTO` (`{ entries: readonly CompletionEntryDTO[] }`) with `readonly` fields
    - Re-export both types from `packages/shared/src/dto/index.ts` and from `packages/shared/src/index.ts`, matching the existing barrel pattern
    - _Requirements: 4.2, 4.3, 4.4, 4.6, 4.7_

- [x] 2. Shared owner-or-friend authorization helper
  - [x] 2.1 Extract `assertOwnerOrFriend` into a single shared module and refactor callers
    - Create `apps/api/src/services/friends/ownerOrFriend.ts` exporting `assertOwnerOrFriend(pool, requesterId, targetId)`: return immediately when `requesterId === targetId`, otherwise perform exactly one `SELECT EXISTS (... FROM friendships WHERE user_lo_id = $1 AND user_hi_id = $2)` using `canonicalPair`, and throw `AppError('profile_forbidden')` on absence with no logging/analytics on the deny path
    - Refactor `apps/api/src/services/auth/profileRoutes.ts` and `apps/api/src/services/stats/routes.ts` to import and call this shared helper instead of their local copies, preserving identical behavior
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 3.6_

  - [x] 2.2 Write property test for the owner-or-friend rule
    - **Property 1: Owner-or-friend authorization and opaque denial**
    - Generate user sets, friendship graphs, pending-request sets, and `(requester, target)` pairs covering self / friend / non-friend / pending-only / unknown-target / post-termination; assert authorize-iff-owner-or-friend and an identical `profile_forbidden` (no data) across all deny cases; parameterize across the profile/stats/completions call sites
    - `fast-check` via Vitest, `numRuns >= 100`, header comment naming the property
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.7, 3.6**

  - [x] 2.3 Write unit test for no-analytics-on-deny
    - Inject a recording analytics/logger spy and assert zero viewing-attempt events are recorded across several denied requests through the shared helper
    - _Requirements: 1.4_

  - [x] 2.4 Write property test for the completion-percentage formula
    - **Property 2: Completion-percentage formula is bounded, rounded, and zero-safe**
    - Generate `(completed, total)` including `total == 0` and `completed > total`; assert the reported percent equals `total == 0 ? 0.0 : min(100.0, round1(completed*100/total))`, stays in `[0.0, 100.0]`, rounds to one decimal, and reports `0.0` when `total == 0`
    - `fast-check`, `numRuns >= 100`
    - **Validates: Requirements 2.2, 2.3, 3.2, 3.4**

  - [x] 2.5 Write property test for profile projection content
    - **Property 3: Profile projection content**
    - Generate profile rows with/without avatar; assert an authorized profile read returns display name, the avatar reference when set and `null` when not, and an overall completion percent in `[0.0, 100.0]` to one decimal
    - `fast-check`, `numRuns >= 100`
    - **Validates: Requirements 2.1**

  - [x] 2.6 Write property test for stats coverage and active-only counts
    - **Property 4: Stats coverage, active-only computation, and counts**
    - Generate catalogs of active/inactive Experiences and completion sets; assert the breakdown covers overall, every Park, and all six Experience_Categories, that counts are computed over only Active Experiences, and that each `percent` equals `computePercent(completed, total)`
    - `fast-check`, `numRuns >= 100`
    - **Validates: Requirements 3.1, 3.3**

- [x] 3. Friend Completions repository
  - [x] 3.1 Implement the Friend Completions repository
    - Create `apps/api/src/services/tracking/friendCompletions/repo.ts` exporting `CompletionEntry`, `FriendCompletionsRepo`, and `createFriendCompletionsRepo(pool)`, following the `createNoteRepo` / `createCompletionRepo` injection pattern
    - Implement `listCompletions(userId)` as the single SQL statement from the design: `JOIN experiences ... AND e.active = TRUE`, `LEFT JOIN ratings`, `LEFT JOIN notes` with `CASE WHEN n.shareable THEN n.body ELSE NULL END`, ordered by `completed_on DESC, lower(name) ASC, lower(park) ASC, lower(category) ASC`, `LIMIT 5000`; map rows to `CompletionEntry`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 3.2 Write property test for completion-entry content and rating inclusion
    - **Property 5: Completion-entry content and rating inclusion**
    - Generate completions over active experiences with/without ratings; assert each entry carries the source name/Park/Category/date and includes the rating as an integer `1..10` exactly when one exists, else `null`
    - `fast-check`, `numRuns >= 100`
    - **Validates: Requirements 4.2, 4.3, 4.4**

  - [x] 3.3 Write property test for shareable-note disclosure
    - **Property 6: Shareable-note disclosure is opaque for absent and private Notes**
    - Generate notes that are absent / present-private / present-shareable; assert `sharedNote` equals the body iff a shareable Note exists and is exactly `null` for both no-Note and present-but-private, so the two are indistinguishable
    - `fast-check`, `numRuns >= 100`
    - **Validates: Requirements 4.6, 4.7**

  - [x] 3.4 Write property test for active-only completions
    - **Property 7: Completions exclude inactive Experiences**
    - Generate completions mixing active/inactive experiences; assert no returned entry references an inactive Experience while underlying completion rows remain unmodified
    - `fast-check`, `numRuns >= 100`
    - **Validates: Requirements 4.5**

  - [x] 3.5 Write property test for the 5,000-entry cap
    - **Property 8: Completions are capped at 5,000 most-recent entries**
    - Generate `> 5000` completions with varied dates; assert the result length is `<= 5000` and, when more than 5,000 exist, every returned entry's date is `>=` every excluded entry's date
    - `fast-check`, `numRuns >= 100`
    - **Validates: Requirements 4.1**

  - [x] 3.6 Write property test for completions ordering
    - **Property 9: Completions ordering with case-insensitive tie-breaks**
    - Generate entries with colliding dates and case-differing names/parks/categories; assert ordering by date descending, then case-insensitive name, Park, then Category ascending on every adjacent pair
    - `fast-check`, `numRuns >= 100`
    - **Validates: Requirements 4.8**

- [x] 4. Friend Completions route and server wiring
  - [x] 4.1 Implement the Friend Completions route
    - Create `apps/api/src/services/tracking/friendCompletions/routes.ts` exporting `friendCompletionsRoutes(options)` and `FriendCompletionsRoutesOptions` (`repo`, `pool`, `requireSession`), following the `statsRoutes` factory pattern
    - Register `GET /users/:userId/completions` behind `requireSession`, parse `:userId` with `uuidSchema` (→ `validation_failed`), call the shared `assertOwnerOrFriend(pool, requesterId, targetId)` before any data read, then map repo rows to `CompletionEntryDTO` and return `{ entries }` (empty array when none)
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 4.2 Wire the route into `buildServer`
    - Extend `BuildServerServices.tracking` in `apps/api/src/server.ts` with a `friendCompletions?: FriendCompletionsRoutesOptions` block and register it via `app.register(friendCompletionsRoutes(...))` alongside the other tracking sub-domains
    - _Requirements: 4.1_

  - [x] 4.3 Wire the route into the composition root
    - In `apps/api/src/composeServices.ts`, construct `createFriendCompletionsRepo(pool)` and pass `tracking.friendCompletions = { repo, pool, requireSession: sessionMiddleware }` into `buildServer`
    - _Requirements: 4.1_

  - [x] 4.4 Write integration test for the endpoint and migration
    - Exercise `GET /users/:userId/completions` end-to-end against Postgres for the owner-or-friend happy path (entries returned) and the empty case (`{ entries: [] }`); add a schema test asserting `notes.shareable` exists with `NOT NULL DEFAULT FALSE`
    - _Requirements: 4.1, 4.10, 4.6_

  - [x] 4.5 Write unit tests for route error codes and session precedence
    - Assert `validation_failed` (400) on a malformed `:userId`, `profile_forbidden` (403) on a non-friend/unknown target, and `unauthorized` (401) when the session check fails before the owner-or-friend rule
    - _Requirements: 1.5, 1.6, 3.6_

- [x] 5. Checkpoint - backend reads complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Note write-path extension for the shareable flag
  - [x] 6.1 Persist the shareable flag in the Note repository
    - Extend `apps/api/src/services/tracking/note/repo.ts` so `upsertNote` accepts and writes `shareable`, defaulting to `FALSE` on first write and preserving the prior value when omitted on edit; include `shareable` in the `RETURNING`/SELECT projection and the DTO mapping
    - _Requirements: 4.6, 4.7_

  - [x] 6.2 Accept `shareable` on the Note write route
    - Extend `PUT /me/experiences/:id/note` in `apps/api/src/services/tracking/note/routes.ts` to accept an optional `shareable: boolean` field (owner-only via `request.userId`) and pass it to the repo upsert
    - _Requirements: 4.6_

  - [x] 6.3 Write unit tests for the shareable write path
    - Assert a new Note defaults to `shareable = false`, an explicit `shareable: true` persists, and omitting the field on edit preserves the prior value
    - _Requirements: 4.6, 4.7_

  - [x] 6.4 Add the owner-facing shareable toggle to the Note editor (mobile)
    - Extend `apps/mobile/src/screens/catalog/NoteControl.tsx` with a "Share with friends" `Switch` in edit mode, seeded from the note's current `shareable` value (off for a new Note, matching "private by default"); send `shareable` alongside `body` on the `PUT /me/experiences/:id/note` save
    - Show the current share state in view mode ("Shared with friends" vs. "Private — only you can see this") so the owner can tell at a glance whether a Note is visible to Friends
    - This is the minimal owner control referenced in the design's Data Models / Non-Goals; the read path (Property 6) is the flag's primary consumer
    - _Requirements: 4.6, 4.7_

  - [x] 6.5 Write RNTL tests for the shareable toggle (mobile)
    - In `apps/mobile/src/screens/catalog/__tests__/NoteControl.shareable.test.tsx`, assert a brand-new Note saves with `shareable: false` when the toggle is left off, that toggling it on forwards `shareable: true` on the `PUT .../note` save, that editing a shared Note keeps it shareable, and that view mode reflects the persisted share state
    - _Requirements: 4.6, 4.7_

- [x] 7. Mobile Friend_Profile_View data layer
  - [x] 7.1 Add client helpers and timed queries for the three reads
    - In `apps/mobile/src/api/` (and `apps/mobile/src/hooks/` following existing conventions), add typed helpers/hooks for `GET /users/{friendId}/profile`, `GET /me/stats/summary?for={friendId}`, and `GET /users/{friendId}/completions`, keyed by `friendId`
    - Enforce a 30-second per-request timeout with an `AbortController` that rejects with a synthetic non-`profile_forbidden` error so it flows through the retry path; reuse `apiRequest`/`ApiError` for envelope handling
    - _Requirements: 5.5_

- [x] 8. Mobile Friend_Profile_View screen and navigation
  - [x] 8.1 Implement the Friend_Profile_View screen
    - Create `apps/mobile/src/screens/friends/FriendProfileScreen.tsx` issuing three independent queries with per-request loading/error/retry states: render each section's own loading indicator while in flight (R5.2); on `profile_forbidden` render an unavailable message and withhold stats/Completions (R5.3); on any other error (including the 30s timeout) render an error message plus a per-request retry control while retaining already-loaded sections (R5.4, R5.5); retry re-issues only the failed request (R5.6)
    - Render display name and overall completion to one decimal, avatar image or placeholder, per-Park/per-Category percentages to one decimal with completed/total counts, completion entries (name, Park, Category, date, rating when present, shared note when present), and an empty state when no completions
    - _Requirements: 2.4, 2.5, 2.6, 3.5, 4.9, 4.10, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 8.2 Register the screen and wire navigation from the friends list
    - Add `FriendProfile` (with `friendId` + `displayName` params) to `FriendsStackParamList` and register the screen in `apps/mobile/src/navigation/FriendsStack.tsx`; add an `onPress` to `FriendRow` in `FriendsListScreen.tsx` that navigates to it
    - _Requirements: 5.1_

  - [x] 8.3 Write RNTL tests for the screen state machine
    - Using controllable promises and fake timers, cover loading, avatar/placeholder, one-decimal formatting, empty state, `profile_forbidden` withholding, per-request error + retry, retention of already-loaded sections, the 30-second timeout, and scoped retry re-fetch
    - _Requirements: 2.4, 2.5, 2.6, 3.5, 4.9, 4.10, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 8.4 Write navigation test for friend selection
    - Assert selecting a friend from the list routes to `FriendProfileScreen` with the `friendId` param
    - _Requirements: 5.1_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements (granular clauses) for traceability.
- Property-based tests use `fast-check` via Vitest at `numRuns >= 100`, one test per design property (Properties 1–9), each tagged with a header comment naming the property.
- The owner-or-friend rule, the percentage formula, and the profile/stats reads are reused from existing code; this feature consolidates the authorization rule into one shared helper rather than adding a third copy.
- Checkpoints provide incremental validation at natural breaks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "6.1", "7.1"] },
    { "id": 1, "tasks": ["3.1", "2.2", "2.3", "2.4", "2.5", "2.6", "6.2", "8.1"] },
    { "id": 2, "tasks": ["4.1", "3.2", "3.3", "3.4", "3.5", "3.6", "6.3", "8.2"] },
    { "id": 3, "tasks": ["4.2", "4.3", "6.4", "6.5", "8.3", "8.4"] },
    { "id": 4, "tasks": ["4.4", "4.5"] }
  ]
}
```
