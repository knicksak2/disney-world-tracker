# Implementation Plan: Trips

## Overview

This plan builds the Trips feature as a new `Trip_Service` in the Fastify + TypeScript
monolith (`apps/api/src/services/trips/`) plus the mobile screens and navigation change in
`apps/mobile`. It follows the established repo patterns: shared Zod schemas / DTOs / error codes
in `@dwt/shared`, a sequentially-numbered SQL migration, constructor-injected factory repos wired
in `composeServices.ts` and registered in `server.ts`, and fast-check property tests alongside unit
and integration tests.

Work is ordered to validate core logic early: shared contracts and the migration first, then the
pure domain modules (the property-test surface), then the transactional repo and routes one concern
at a time (each building on the last and ending wired into `server.ts`), then notifications wiring,
and finally the mobile navigation change and screens. The canonical Rating and Completion writes
reuse the existing Tracking_Service rating/completion repos so no Trip-local copies exist and the
existing `RatingChanged` propagation path is reused unchanged.

## Tasks

- [x] 1. Establish shared contracts in `@dwt/shared`
  - [x] 1.1 Add the `Trip_Reaction` vocabulary
    - Add `TRIP_REACTION_VALUES = ['like','love','celebrate','wow']` and `TripReactionValue` to `packages/shared/src/enums.ts`, plus a `tripReactionValueSchema = z.enum(TRIP_REACTION_VALUES)` primitive, mirroring `SHARE_REACTION_VALUES`
    - _Requirements: 13.6_

  - [x] 1.2 Add Trip Zod schemas and DTOs
    - Create `packages/shared/src/trips.ts` with `tripCreateSchema` and `tripEditSchema` enforcing Trip_Name present and 1–100 chars after trim, Trip_Description ≤2000 chars, valid calendar dates, and `end >= start`; plus schemas for planned-item add, log-entry create (with rode-with list + optional 1–10 whole-number rating), rode-with confirm (optional rating), reaction, and comment (1–2000 after trim)
    - Define `TripDTO`, `TripMemberDTO`, `TripInviteDTO`, `PlannedItemDTO`, `TripLogEntryDTO`, `TripFeedItemDTO`, `TripSummaryDTO`, and `TripStatus`; export from the package index
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 3.4, 3.5, 3.6, 13.9_

  - [x] 1.3 Write property test for create/edit input validation
    - **Property 2: Trip name/description/date input is validated identically on create and edit**
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 3.2, 3.4, 3.5, 3.6**

  - [x] 1.4 Add Trip error codes
    - Add `trip_not_found`, `trip_forbidden`, `trip_validation_failed`, `trip_not_friend`, `trip_invite_duplicate`, `trip_invite_state_invalid`, `trip_last_organizer`, `trip_role_invalid`, `trip_planned_limit`, `trip_tag_state_invalid` to the closed `ERROR_CODES` union and `errorCodeToHttpStatus` in `packages/shared/src/errors.ts` with the HTTP statuses from the design
    - _Requirements: 3.3, 3.9, 6.2, 6.4, 6.5, 7.5, 9.5, 11.8, 15.2_

- [x] 2. Create the database migration
  - [x] 2.1 Author `apps/api/migrations/0015_trips.sql`
    - Create `trips`, `trip_memberships`, `trip_invites`, `planned_items`, `trip_log_entries`, `rode_with_tags`, `trip_feed_items`, `trip_reactions`, `trip_comments` with the CHECK constraints, `ON DELETE CASCADE` foreign keys, composite keys, the partial unique index `trip_invites_one_pending_idx`, and the ordering index `trip_feed_items_trip_order_idx` from the design; no `status` column (status is derived)
    - _Requirements: 2.5, 3.7, 4.1, 6.5, 9.3, 11.1, 13.3, 13.4_

- [x] 3. Implement the pure domain modules (property-test surface)
  - [x] 3.1 Implement `wdwClock.ts` and `tripStatus.ts`
    - `wdwClock.ts`: `wdwToday(now?)` returns the `YYYY-MM-DD` date in `America/New_York` via `Intl.DateTimeFormat`, injectable for tests
    - `tripStatus.ts`: `deriveTripStatus(startDate, endDate, wdwToday)` returning `upcoming | active | past` by calendar-date comparison, including the single-day case
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.2 Write property test for status derivation
    - **Property 1: Trip status is derived solely from its dates and the WDW date**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

  - [x] 3.3 Implement `permissions.ts`
    - `can(role, action)` implementing the organizer ⊇ member action matrix, plus `violatesLastOrganizer(members, change)` as a pure predicate over the membership set for demote/remove/leave
    - _Requirements: 4.2, 4.3, 4.4, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.4 Write property test for the role permission matrix
    - **Property 6: The role permission matrix is exactly organizer ⊇ member**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.7, 15.5**

  - [x] 3.5 Write property test for the Last_Organizer_Rule invariant
    - **Property 8: A non-empty Trip always retains at least one Organizer**
    - **Validates: Requirements 4.1, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**

  - [x] 3.6 Implement `feedOrder.ts`
    - `orderFeed(items)` sorting by `createdAt` descending, tie-broken by `id` descending, for a total deterministic order
    - _Requirements: 13.3_

  - [x] 3.7 Write property test for feed ordering
    - **Property 24: The Trip_Feed is totally ordered reverse-chronologically with a deterministic tie-break**
    - **Validates: Requirements 13.3**

  - [x] 3.8 Implement `summary.ts`
    - `deriveTripSummary(input)` computing `distinctExperienceCount` (each Experience once, 0 when none), `topRated` (≤5 ranked by descending mean canonical Rating, then descending rating count, then ascending name), and `perMember` log-entry / confirmed-tag counts
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

  - [x] 3.9 Write property test for summary derivation
    - **Property 25: The Trip_Summary is a faithful derivation of the Trip's activity**
    - **Validates: Requirements 14.1, 14.2, 14.4, 14.5, 14.6**

  - [x] 3.10 Implement `tripsList.ts`
    - `groupTripsByStatus(trips, wdwToday)` returning Active, Upcoming, Past groups in that order, ordering Active/Upcoming by ascending start date and Past by descending end date, omitting empty groups
    - _Requirements: 16.2, 16.3, 16.4, 16.5_

  - [x] 3.11 Write property test for trips-list grouping
    - **Property 26: The Trips list shows exactly the caller's Trips grouped and ordered by status**
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5**

  - [x] 3.12 Implement `authz.ts` and `events.ts`
    - `authz.ts`: `assertTripMember` / `assertTripOrganizer` (modeled on `assertOwnerOrFriend`) that collapse non-member and non-existent Trip to the identical `trip_forbidden` response
    - `events.ts`: `TripInviteCreatedNotice` and `RodeWithTagCreatedNotice` notice types
    - _Requirements: 15.2, 15.4, 15.6_

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Trip lifecycle (create / read / edit / delete)
  - [x] 5.1 Implement lifecycle operations in `repo.ts`
    - `createTrip` (insert trip with trimmed name, creator `organizer` membership, `trip_created` feed item, return Trip_Identifier), `getTripForMember` (join derived status at read), `editTrip` (touch only supplied fields), `deleteTrip` (cascade delete, never touching canonical tracking)
    - _Requirements: 1.1, 1.2, 1.3, 1.9, 1.10, 3.1, 3.7, 3.10_

  - [x] 5.2 Write property test for Trip creation
    - **Property 3: Creating a Trip establishes the creator as the sole organizer and returns its identity**
    - **Validates: Requirements 1.1, 1.2, 1.9**

  - [x] 5.3 Write property test for Trip editing
    - **Property 5: Editing a Trip changes only the targeted fields**
    - **Validates: Requirements 3.1**

  - [x] 5.4 Register lifecycle routes in `routes.ts`
    - `POST /me/trips`, `GET /trips/:id`, `PATCH /trips/:id`, `DELETE /trips/:id` behind `requireSession`, gated by `assertTripMember`/`assertTripOrganizer`, bodies validated by the shared schemas, `:id` by `uuidSchema`
    - _Requirements: 1.1, 3.1, 3.3, 3.8, 3.9, 15.1_

  - [x] 5.5 Write property test for canonical-tracking preservation
    - **Property 9: Trip lifecycle never mutates canonical Tracking data**
    - **Validates: Requirements 3.10, 8.4, 5.7**

  - [x] 5.6 Write property test for membership-gated access and non-disclosure
    - **Property 11: Trip data access requires membership and does not disclose existence**
    - **Validates: Requirements 9.2, 10.7, 12.7, 13.10, 14.8, 15.1, 15.2, 15.4, 15.6**

  - [x] 5.7 Write property test for session-before-membership ordering
    - **Property 12: The authenticated-session check precedes the membership check**
    - **Validates: Requirements 15.3**

- [x] 6. Implement Trip invites
  - [x] 6.1 Implement invite operations in `repo.ts`
    - `sendInvite` (verify Friend of organizer, not already a member, no pending invite; partial unique index as race backstop), `cancelInvite`, `acceptInvite` (pending→accepted, idempotent member insert, `member_joined` feed item), `declineInvite`, `getInvite` (deep-link target read)
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.8, 7.1, 7.2, 7.3, 7.6_

  - [x] 6.2 Write property test for the invite state machine
    - **Property 14: A Trip_Invite follows the pending→terminal state machine**
    - **Validates: Requirements 6.1, 6.8, 7.1, 7.2, 7.3, 7.5**

  - [x] 6.3 Write property test for the Friend requirement on invites
    - **Property 15: Invites require the target to be a Friend of the organizer**
    - **Validates: Requirements 6.2, 6.4, 6.5**

  - [x] 6.4 Register invite routes in `routes.ts`
    - `POST /trips/:id/invites`, `POST /trips/:id/invites/:inviteId/cancel`, `POST /me/trip-invites/:inviteId/accept`, `POST /me/trip-invites/:inviteId/decline`, `GET /me/trip-invites/:inviteId`; emit `TripInviteCreatedNotice` on the background port after commit
    - _Requirements: 6.3, 6.6, 6.7, 6.9, 7.4, 7.5, 7.7_

- [x] 7. Implement membership management
  - [x] 7.1 Implement membership operations in `repo.ts`
    - `promote`/`demote` (reject no-op role change; demote subject to Last_Organizer_Rule), `removeMember` and `leaveTrip` (Last_Organizer_Rule check, cancel pending rode-with tags created by or naming the departing Member, retain their log entries and confirmed tags, delete the Trip when the sole Member leaves, never touch canonical tracking)
    - _Requirements: 4.5, 4.6, 4.8, 5.2, 5.3, 5.4, 5.6, 5.7, 8.1, 8.2, 8.5, 8.6, 8.7_

  - [x] 7.2 Write property test for promotion and demotion
    - **Property 7: Promotion and demotion set the target role exactly**
    - **Validates: Requirements 4.5, 4.6, 4.8**

  - [x] 7.3 Write property test for departure semantics
    - **Property 10: Departure retains contributions and cancels pending tags**
    - **Validates: Requirements 8.1, 8.2, 8.5, 8.6, 8.7, 5.7**

  - [x] 7.4 Register membership routes in `routes.ts`
    - `POST /trips/:id/members/:userId/promote`, `POST /trips/:id/members/:userId/demote`, `DELETE /trips/:id/members/:userId`, `POST /trips/:id/leave` with authorization and Last_Organizer_Rule error mapping
    - _Requirements: 4.5, 4.6, 4.8, 5.2, 5.3, 5.4, 8.1, 8.2, 8.3, 8.8, 8.9_

- [x] 8. Implement the shared Planned_List
  - [x] 8.1 Implement planned-item operations in `repo.ts`
    - `addPlannedItem` (record adder, permit the same experience more than once per R9.3, reject unknown Catalog experience, reject when list holds 500 items), `removePlannedItem` (by adder or any organizer), `listPlannedItems` (join experience name, Park, adder display name)
    - _Requirements: 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x] 8.2 Write property test for the Planned_List add/remove rules
    - **Property 16: Planned_List add records the adder and permits duplicates; removal is by adder or organizer**
    - **Validates: Requirements 9.1, 9.3, 9.6, 9.7**

  - [x] 8.3 Register planned-item routes in `routes.ts`
    - `POST /trips/:id/planned-items`, `DELETE /trips/:id/planned-items/:itemId`, `GET /trips/:id/planned-items`
    - _Requirements: 9.2, 9.9_

  - [x] 8.4 Allow the same Experience to be planned more than once (R9.3)
    - Remove the duplicate-Experience rejection from `addPlannedItem` (the `planned_items_unique` constraint was already dropped in migration 0019) so a repeat add creates an additional Planned_Item; update Property 16 to assert a duplicate add creates a second row; and remove the `disabledIds`/`disabledLabel` "already added" gating from the `ExperiencePicker` on both the `TripPlannedListScreen` add modal and the `TripScheduleScreen` add modal so an already-planned Experience stays selectable
    - _Requirements: 9.1, 9.3_

- [x] 9. Implement the Shared_Log and rode-with tagging
  - [x] 9.1 Implement `logCompletion` in `repo.ts`
    - In one transaction: ensure the logging Member's canonical Completion via the injected Tracking completion repo (insert-on-conflict, no duplicate), insert the `trip_log_entry`, insert one `pending` `rode_with_tag` per distinct tagged Member (reject self-tags, non-members, and in-request duplicates), optionally apply the logging Member's canonical Rating through the injected Tracking rating repo, add the `completion_logged` feed item; return the created entry with pending tag ids for post-commit notification
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.9, 10.10, 12.1, 12.2_

  - [x] 9.2 Write property test for idempotent Completion linking
    - **Property 18: Logging a Completion is idempotent on the canonical Completion**
    - **Validates: Requirements 10.1, 10.2**

  - [x] 9.3 Write property test for rode-with tag creation
    - **Property 19: Rode_With_Tag creation is deduplicated and target-validated**
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.6**

  - [x] 9.4 Write property test for canonical Rating round-trip through a Trip
    - **Property 22: Ratings recorded through a Trip round-trip to the single canonical Rating**
    - **Validates: Requirements 10.10, 12.1, 12.2**

  - [x] 9.5 Register log routes in `routes.ts`
    - `POST /trips/:id/log-entries` (build entry + tags + optional rating; picker excludes the logging Member) and `GET /trips/:id/log-entries` (join current canonical Rating live, unrated indicator when none); emit `RodeWithTagCreatedNotice` per tag on the background port after commit
    - _Requirements: 10.7, 10.8, 12.4, 12.7, 12.8, 15.1_

  - [x] 9.6 Write property test for Shared_Log read projections
    - **Property 17: Read projections carry the required display fields**
    - **Validates: Requirements 9.9, 12.4, 12.8**

- [x] 10. Implement rode-with tag confirm / decline (trickle-down)
  - [x] 10.1 Implement `confirmRodeWithTag` and `declineRodeWithTag` in `repo.ts`
    - Confirm (in one transaction): assert caller is the Tagged_Member and tag is `pending`, ensure the Tagged_Member's canonical Completion linked to the Trip (create when absent, leave existing unaltered), optionally apply a valid canonical Rating via the Tracking rating repo (leave unchanged when skipped, reject invalid), set tag `confirmed` (write no feed item — the originating `completion_logged` entry already records the rode-with). Decline: assert caller and pending state, set `declined`, write nothing to the Tagged_Member's data
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_

  - [x] 10.2 Write property test for the pending/declined no-write invariant
    - **Property 20: A pending or declined Rode_With_Tag never writes the Tagged_Member's data**
    - **Validates: Requirements 11.1, 11.6**

  - [x] 10.3 Write property test for confirmation linking and rating choice
    - **Property 21: Confirming a Rode_With_Tag links the completion and honors the rating choice**
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5**

  - [x] 10.4 Register confirm/decline routes in `routes.ts`
    - `POST /me/rode-with-tags/:tagId/confirm` (optional rating) and `POST /me/rode-with-tags/:tagId/decline`, scoped to the Tagged_Member
    - _Requirements: 11.7, 11.8, 11.9_

- [x] 11. Implement the Trip_Feed, reactions, and comments
  - [x] 11.1 Implement feed / reaction / comment operations in `repo.ts`
    - `getFeed` (ordered via `orderFeed`), `addReaction` (composite-key at-most-one-per-type, idempotent, validated vocabulary), `removeReaction` (own only), `addComment` (1–2000 after trim, target belongs to Trip), `removeComment` (author only); verify target `(target_type, target_id)` belongs to the caller's Trip
    - _Requirements: 13.1, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12_

  - [x] 11.2 Write property test for reactions/comments lifecycle
    - **Property 23: Trip_Reactions and Trip_Comments follow an add/remove lifecycle with at-most-one reaction per type**
    - **Validates: Requirements 13.4, 13.5, 13.7, 13.8, 13.9, 13.11**

  - [x] 11.3 Register feed / reaction / comment routes in `routes.ts`
    - `GET /trips/:id/feed`, `POST`/`DELETE` reactions on `:targetType/:targetId`, `POST /trips/:id/feed/:targetType/:targetId/comments`, `DELETE /trips/:id/comments/:commentId`
    - _Requirements: 13.3, 13.6, 13.10, 13.12_

  - [x] 11.4 Write property test for owner-scoped actions
    - **Property 13: Ownership-scoped actions are limited to the owning Trip_Member**
    - **Validates: Requirements 7.4, 9.8, 11.7, 13.12**

- [x] 12. Implement Trip_Summary and Trips list reads
  - [x] 12.1 Implement summary and list reads in `repo.ts`
    - `getSummary` (assemble `deriveTripSummary` inputs from log entries, confirmed tags, and referenced canonical Ratings; produce `TripSummaryDTO` with per-Member display names) and `listMyTrips` (fetch the caller's memberships, derive status, group via `groupTripsByStatus`)
    - _Requirements: 14.1, 14.6, 14.7, 14.8, 16.1_

  - [x] 12.2 Register summary and list routes in `routes.ts`
    - `GET /trips/:id/summary` and `GET /me/trips`
    - _Requirements: 14.8, 16.1, 19.1_

- [x] 13. Wire notifications and register the service
  - [x] 13.1 Add Notification_Service handlers
    - `handleTripInviteCreated` (title = inviter display name, deep-link data `{ tripInviteId }`) and `handleRodeWithTagCreated` (deep-link data `{ rodeWithTagId, tripLogEntryId }`), both gated by the master push preference and never throwing, mirroring `handleFriendRequestReceived`
    - _Requirements: 6.6, 6.7, 10.8_

  - [x] 13.2 Wire the Trip_Service in `composeServices.ts`
    - Build `createTripRepo(pool)` injecting the existing Tracking completion and rating repos for canonical writes, and wire the two background notification dispatches after commit
    - _Requirements: 6.6, 6.7, 10.8, 12.1_

  - [x] 13.3 Register Trip routes in `server.ts`
    - Add a `trips?: TripRoutesOptions` option block registered behind `requireSession` like every other service, wiring things end-to-end
    - _Requirements: 15.1, 15.3_

- [x] 14. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Cross-service integration tests
  - [x] 15.1 Write integration test for cascade delete with tracking survival
    - Deleting a Trip removes all child rows while canonical `completions`/`ratings`/`notes` survive
    - _Requirements: 3.7, 3.10_

  - [x] 15.2 Write integration test for invite and rode-with notification dispatch
    - In-app + push notifications fire with the correct deep-link targets; the request succeeds regardless of push outcome
    - _Requirements: 6.6, 6.7, 10.8, 13.2_

  - [x] 15.3 Write integration test for canonical Rating propagation
    - A Rating recorded through a Trip emits `RatingChanged` and is reflected by stats/catalog/aggregate within 60 seconds and counts a Trip completion the same as a non-Trip one
    - _Requirements: 12.3, 12.6_

- [x] 16. Update the mobile bottom-tab navigation
  - [x] 16.1 Rework `MainTabs` and relocate Stats under Profile
    - Set the five tabs to Home, Catalog, Trips, Friends, Profile in order; remove `StatsStack` as a top-level tab and re-host it reachable via a Profile-tab navigation control, preserving every previously reachable Stats screen
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 16.2 Write navigation test for the tab change
    - Assert the five-tab order, Stats relocated under Profile, and every prior Stats screen still reachable
    - _Requirements: 17.1, 17.3, 17.5_

  - [x] 16.3 Add `TripsStack` and deep-link routing
    - Host `Trips_List_Screen` and `Trip_Detail_View` (and section screens) in a `TripsStack`; add `navigationRef` deep-link routing for invite and rode-with notification targets
    - _Requirements: 17.2, 18.1_

- [x] 17. Build the Trips mobile screens
  - [x] 17.1 Implement `Trips_List_Screen`
    - Read `GET /me/trips` via TanStack Query; render Active/Upcoming/Past groups (omit empty), a loading indication under 10s, an error+retry on failure/timeout, an empty state with a create control, and a create control; navigate to the Trip_Detail_View on selection
    - _Requirements: 16.6, 16.7, 16.8, 16.9, 16.10_

  - [x] 17.2 Implement `Trip_Detail_View` hub
    - Present distinct navigation controls for Planned_List, Shared_Log, Trip_Feed, Trip_Members, and Trip_Summary that open the corresponding section
    - _Requirements: 18.1, 18.6_

  - [x] 17.3 Implement the log + rode-with picker
    - Build the `POST /trips/:id/log-entries` body; the rode-with picker lists only current Members and excludes the logging Member, with an optional rating input
    - _Requirements: 10.4, 10.5, 10.10_

  - [x] 17.4 Implement the Rode_With_Tag confirmation screen
    - Offer confirm/decline plus a rating add/update pre-filled with the current canonical Rating when one exists
    - _Requirements: 11.4, 11.5, 18.3_

  - [x] 17.5 Implement the Trip_Feed with reactions and comments
    - Render the ordered feed and controls to add/remove reactions and add/remove own comments
    - _Requirements: 13.3, 13.4, 13.7, 13.8, 13.11_

  - [x] 17.6 Implement the Trip_Summary screen
    - Render distinct-experience count, up to 5 top-rated Experiences with the empty state when none are rated, and per-Member log-entry and confirmed-tag counts
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 17.10 Implement the Trip_Members screen
    - Read `GET /trips/:id/members` (+ `GET /me` to gate self controls) and render each Member with their role; an Organizer sees promote (on a `member`), demote (on an `organizer`), and remove controls per other Member, and every Member sees a Leave control for themselves; map the Last_Organizer_Rule and role-validity rejections to friendly copy. Add an invite flow: an Organizer picks a Friend who is not already a Member and has no pending invite (from `GET /me/friends` filtered by `GET /trips/:id/members` and `GET /trips/:id/invites`) and sends `POST /trips/:id/invites`; outstanding invites are listed from `GET /trips/:id/invites` with a Cancel control (`POST .../invites/:inviteId/cancel`)
    - _Requirements: 18.1, 18.6, 4.5, 4.6, 4.8, 6.1, 6.4, 6.5, 6.8, 8.1, 8.2, 15.2_

  - [x] 17.12 Expose the pending-invites read (`GET /trips/:id/invites`)
    - Add a `listPendingInvites(tripId)` repo method and an Organizer-gated `GET /trips/:id/invites` route returning `TripPendingInviteDTO[]` (invite id + invitee display info), so the Members screen can list outstanding invites persistently and exclude already-invited Friends from the picker (fixes the confusing `trip_invite_duplicate` on a stale pending invite)
    - _Requirements: 6.5, 6.8, 15.2_

  - [x] 17.13 Test the Trip_Members and Planned_List screens and the invites read
    - Mobile: `TripMembersScreen.test.tsx` covers the organizer role controls (promote/demote/remove), self Leave, the invite picker exclusions and send, the duplicate-invite friendly copy, pending-invite listing + cancel, the plain-Member gating (no invite read), and the non-disclosing load error; `TripPlannedListScreen.test.tsx` covers render/empty/add/remove and the load error. API: `GET /trips/:id/invites` route cases (organizer success, non-organizer and non-member `trip_forbidden`) added to `routes.membership.test.ts`
    - _Requirements: 4.5, 4.6, 6.1, 6.4, 6.5, 6.8, 8.1, 8.2, 9.1, 9.6, 9.9, 15.2_

  - [x] 17.11 Implement the Planned_List screen
    - Read `GET /trips/:id/planned-items` and render each Planned_Item's Experience name, Park, and adder display name (R9.9); add an Experience via `POST /trips/:id/planned-items` (validated by `plannedItemAddSchema`) and remove an item via `DELETE /trips/:id/planned-items/:itemId`, mapping duplicate / limit / catalog and authorization rejections to friendly copy
    - _Requirements: 18.1, 18.6, 9.1, 9.6, 9.7, 9.9, 15.2_

  - [x] 17.7 Implement the `Active_Trip_Shortcut`
    - Show the shortcut on surfaces outside the Trips tab while the User is in ≥1 `active` Trip; open the single active Trip directly or present a chooser for several; hide when none; fall back to the list with an "no longer available" message on a stale target
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_

  - [x] 17.8 Implement the notification deep-link tap handler
    - Route invite notifications to the accept/decline view and rode-with notifications to the tag confirm view; require auth first when unauthenticated and open the target after auth in the same session (not otherwise); fall back to the Trips_List_Screen with a "no longer available" message when the target is gone or the User is no longer a Member
    - _Requirements: 7.7, 7.8, 7.9, 18.2, 18.3, 18.4, 18.5, 18.7_

  - [x] 17.9 Write mobile tests for the Trips screens
    - Cover the Trips_List_Screen loading/error/empty and navigation states, Trip_Detail_View section controls and deep-link routing (including auth-required and stale-target fallbacks), invite deep-link accept/decline surfaces, and Active_Trip_Shortcut visibility and single/multiple-active behavior
    - _Requirements: 16.6, 16.7, 16.8, 16.9, 18.2, 18.5, 19.1, 19.4_

- [x] 18. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. Consolidate the Shared_Log and Trip_Feed into a single Trip_Activity surface (R20)
  - [x] 19.1 Enrich the feed projection with per-completion rode-with tag states
    - Extend `getFeed` in `apps/api/src/services/trips/repo.ts` so each `completion_logged` `Trip_Feed_Item` folds its Rode_With_Tag states (tagged Member id + state) into the item `metadata` (additive; `TripFeedItemDTO.metadata` is already an open `Record`), so the Trip_Activity feed can render confirmation state inline without a second read. Leave the existing experience/park/rating/rode-with-count enrichment intact
    - _Requirements: 20.3_

  - [x] 19.2 Build the `Trip_Activity` screen by merging the Shared_Log composer into the feed
    - Fold the "Log a Completion" control and the log + rode-with picker/composer from `TripSharedLogScreen` into `TripFeedScreen` (the `Trip_Activity` surface): render the log control at the head of the feed, keep the existing reactions/comments, and render `completion_logged` items with the Experience, Park, live canonical Rating (or unrated indicator), and rode-with tag states
    - Add an **All / Completions** filter: All shows the mixed `GET /trips/:id/feed` stream; Completions narrows that same loaded stream to `completion_logged` items on the client, so completions stay interactive feed cards (with reactions/comments) rather than a second read. Default to All
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 12.4, 12.8, 13.3, 13.4, 13.7, 13.8, 13.11_

  - [x] 19.3 Remove the standalone Shared_Log screen and route
    - Delete `TripSharedLogScreen` and its `TripSharedLog` route from `TripsStack`; remove the Shared_Log control from the `Trip_Detail_View` hub so it presents Planned_List, Trip_Activity, Trip_Members, and Trip_Summary; repoint or remove any navigation/deep-link that targeted `TripSharedLog`
    - _Requirements: 18.1, 18.6, 20.1_

  - [x] 19.4 Update the affected tests
    - Remove/retarget `TripSharedLogScreen.test.tsx` (its log-composer coverage moves into the Trip_Activity feed test); add feed-side coverage for the log control, the completion item's rich detail (Experience/Park/Rating/rode-with state), and the All/Completions filter; update the `Trip_Detail_View` hub test to assert the four sections (no Shared_Log control); adjust the API `getFeed` tests for the enriched completion `metadata`
    - _Requirements: 20.1, 20.3, 20.4_

- [x] 20. Consolidation checkpoint
  - Ensure the mobile typecheck and the trips API + mobile test suites pass; confirm the Trip_Activity surface logs, filters, reacts, and comments end-to-end.

- [x] 21. Record the Resort(s) a Trip's party stayed at (R21)
  - [x] 21.1 Add the `trip_resorts` migration and shared contracts
    - Author `apps/api/migrations/0016_trip_resorts.sql`: a many-to-many `trip_resorts (trip_id → trips ON DELETE CASCADE, resort_id → resorts, PRIMARY KEY (trip_id, resort_id))` join table plus `trip_resorts_resort_idx`; strictly additive (split stays span >1 hotel)
    - Extend `@dwt/shared` `trips.ts`: add `tripResortIdsSchema` (array of uuids bounded by `TRIP_RESORT_LIMIT`) and `resortIds` to `tripCreateSchema`/`tripEditSchema`; add `TripResortDTO` and `resorts: readonly TripResortDTO[]` to `TripDTO`; export from the package index
    - _Requirements: 21.1, 21.2, 21.5_

  - [x] 21.2 Implement the resort read/write helpers and wire them into the lifecycle repo
    - Add `selectTripResortsByTrip` (batched, name-ordered), `selectTripResorts`, and `replaceTripResorts` (dedup, validate every id is an active Catalog Resort before writing, wholesale replace) to `apps/api/src/services/trips/repo.ts`; thread the `resorts` projection through `rowToDto` and populate it in `createTrip`, `getTripForMember`, `editTrip`, and `listMyTrips`. `POST /me/trips` and `PATCH /trips/:id` carry `resortIds` through the existing schemas, so no new route is needed
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6_

  - [x] 21.3 Test the migration, schema, and repo behavior
    - `apps/api/src/db/__tests__/migration0016.test.ts` (pg-mem): table shape, composite PK, resort FK, trip-delete cascade. `packages/shared/src/__tests__/trips.prop.test.ts`: `resortIds` shape/bound parity on create and edit. `apps/api/src/services/trips/__tests__/repo.resorts.integration.test.ts` (pg-mem): create/edit/read/list ordering, dedup, unknown/inactive rejection, wholesale replace, empty-clears, omit-preserves
    - _Requirements: 21.1, 21.2, 21.4_

  - [x] 21.4 Surface the Resort stay in the mobile create form and Trip detail
    - Add a shared, searchable "where you stayed" multi-select (`apps/mobile/src/components/ResortPicker.tsx`: selected-chip summary + name search + bounded filtered result list, backed by `GET /resorts`) to the create-trip modal in `TripsListScreen`, sending `resortIds` on `POST /me/trips`; render the recorded stay read-only on `TripDetailScreen`. The same `ResortPicker` is reused by the edit form (task 22)
    - _Requirements: 21.1_

- [x] 22. Build the mobile Trip edit form (name, description, dates, resorts)
  - [x] 22.1 Add the `TripEdit` screen and route
    - Create `apps/mobile/src/screens/trips/TripEditScreen.tsx` reading `GET /trips/:id` (shared detail cache) to pre-fill name/description/dates and the recorded Resort stay, plus `GET /resorts` for the picker; submit `PATCH /trips/:id` with the full editable set including `resortIds` (wholesale replace, empty clears — R21.5); map `trip_forbidden`/`trip_not_found` and validation to friendly copy. Register the `TripEdit: { tripId }` route on `TripsStack`
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.8, 21.1, 21.5_
  - [x] 22.2 Gate the Edit control on the Trip_Detail_View to Organizers
    - On `TripDetailScreen`, resolve the caller's role from `GET /me` + `GET /trips/:id/members` and show an Edit control (opening `TripEdit`) only to an Organizer; the server remains the authority (R3.8)
    - _Requirements: 3.8, 18.1, 18.6_
  - [x] 22.3 Test the edit form and the gated control
    - `TripEditScreen.test.tsx`: pre-fill from the Trip + stay, `PATCH` carries the edited `resortIds` (add and clear), and the `trip_forbidden` friendly-copy path. `TripDetailScreen.test.tsx`: an Organizer sees the Edit control and it opens `TripEdit`; a plain Member does not
    - _Requirements: 3.1, 3.8, 21.1, 21.5_

## Notes

- Tasks marked with `*` are optional (property, unit, integration, and mobile tests) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each property test references a specific Correctness Property from the design and the requirements it validates; each runs a minimum of 100 fast-check iterations and is tagged `Feature: trips, Property {number}: {property_text}`.
- Pure-module property tests (Properties 1, 6, 8, 24, 25, 26) run directly against functions; stateful properties run against an in-memory model of the repo, with integration tests pinning the SQL repo to the same behavior.
- `repo.ts` and `routes.ts` are each a single file built up one concern at a time, so their sub-tasks are sequenced across waves to avoid write conflicts.
- Canonical Completion and Rating writes always delegate to the existing Tracking_Service repos so no Trip-local copies exist and the existing `RatingChanged` propagation is reused.
- Checkpoints ensure incremental validation at natural breaks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.4", "2.1", "3.1", "3.3", "3.6", "3.8", "3.10", "3.12", "16.1"] },
    { "id": 1, "tasks": ["1.3", "3.2", "3.4", "3.5", "3.7", "3.9", "3.11", "5.1", "13.1", "16.2", "16.3"] },
    { "id": 2, "tasks": ["5.2", "5.3", "5.4", "6.1", "17.1", "17.2", "17.7"] },
    { "id": 3, "tasks": ["5.6", "5.7", "6.2", "6.3", "6.4", "7.1", "17.3", "17.4", "17.5", "17.6"] },
    { "id": 4, "tasks": ["5.5", "7.2", "7.3", "7.4", "8.1", "17.8"] },
    { "id": 5, "tasks": ["8.2", "8.3", "9.1", "17.9"] },
    { "id": 6, "tasks": ["9.2", "9.3", "9.4", "9.5", "10.1"] },
    { "id": 7, "tasks": ["9.6", "10.2", "10.3", "10.4", "11.1"] },
    { "id": 8, "tasks": ["11.2", "11.3", "12.1"] },
    { "id": 9, "tasks": ["11.4", "12.2", "13.2"] },
    { "id": 10, "tasks": ["13.3"] },
    { "id": 11, "tasks": ["15.1", "15.2", "15.3"] },
    { "id": 12, "tasks": ["8.4"] }
  ]
}
```
