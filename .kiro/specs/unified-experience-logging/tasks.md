# Implementation Plan: Unified Experience Logging

## Overview

This plan replaces the catalog "Log a visit" form and the Trip "Log a completion" form with one `LogExperienceSheet`, and routes every Trip-linked create through the single existing server function `tripRepo.logCompletion`. Build order: shared contracts and the pure core first (so server and mobile use one definition), then the API (route delegation, validation, feed `tagId`, delete parity, backfill migration), then the mobile sheet, toast host, and Trip screens, then cross-spec notes and the final gate.

Cross-spec dependencies (all already shipped): `experience-activity-logging`, `trips`, `planned-list-completion-sync`, `food-item-logging`, `pin-collection`. No dependency on any unbuilt spec. The working tree already contains uncommitted edits to other specs (`trips`, `food-item-logging`, `trip-budget`, ...); do not touch those files until Task 8.

Per `execution-discipline`: tests ship in the same task as the code, edit source directly (no codegen scripts), run only the single test file while iterating, run the scoped `npm run verify:<workspace>` when an area is done, and run the full `npm run verify` exactly once at Task 9. Finish with the behavior-to-test map.

## Tasks

- [x] 1. Shared contracts and the pure core
  - [x] 1.1 Add the `log_outside_trip_dates` error code
    - In `packages/shared/src/errors.ts` add `'log_outside_trip_dates'` to the `ErrorCode` list (with a comment citing R6.5) and `log_outside_trip_dates: 400` to `errorCodeToHttpStatus`
    - Extend `packages/shared/src/schemas/__tests__/ExperienceLog.test.ts` with an assertion that the code is in `ERROR_CODES` and maps to 400
    - _Requirements: 6.5_

  - [x] 1.2 Extend the two request schemas
    - `packages/shared/src/schemas/ExperienceLog.ts`: add `rodeWith: z.array(uuidSchema).optional()` to `createExperienceLogInputSchema` (keep `.strict()`; do not add a cross-field refinement, the route enforces it)
    - `packages/shared/src/trips.ts`: add `visitedOn: isoDateSchema.optional()` and `userTz: ianaTzSchema.optional()` to `tripLogEntryCreateSchema` (keep `.strict()`); import the two primitives from `./schemas/primitives.js` exactly as `ExperienceLog.ts` does
    - Add schema tests: valid body with the new fields, valid body without them (backward compatible), invalid `visitedOn` format, invalid `userTz`, invalid `rodeWith` entry (not a uuid), unknown key still rejected
    - _Requirements: 5.1, 5.6_

  - [x] 1.3 Implement `unifiedLogging.ts`
    - Create `packages/shared/src/unifiedLogging.ts` with exactly the exports in the design: `LogTripRef`, `LogDraft`, `isDateWithinTrip`, `preselectTripId`, `DraftHint`, `reconcileDraft`, `ridingWithCandidates`, `ridingWithLabel`, `offersDishPrompt`, `LogSubmission`, `buildLogSubmission`, `formatLogToast`; no I/O
    - Re-export from `packages/shared/src/index.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.5, 4.4, 5.1, 7.2, 8.1, 8.3, 13.2_

  - [x] 1.4 Property tests for the pure core
    - `packages/shared/src/__tests__/unifiedLogging.prop.test.ts` (fast-check, min 100 runs, tagged)
    - **Property 1: Trip date range is inclusive and decides attribution** (Validates: Requirements 2.6, 2.7, 2.8)
    - **Property 2: Pre-selection is unambiguous or absent** (Validates: Requirements 2.1, 2.2, 2.3)
    - **Property 3: Changing the Trip clears riders** (Validates: Requirements 2.4, 2.9, 3.5)
    - **Property 4: The submission targets the right endpoint with a well-formed, safe body** (Validates: Requirements 1.3, 3.5, 4.4, 5.1, 13.2); validate generated bodies against the real shared schemas
    - **Property 5: Candidates, labels, and toast text are derived consistently** (Validates: Requirements 3.1, 3.2, 7.2, 8.1, 8.3)

  - [x] 1.5 Unit tests for the pure core
    - `packages/shared/src/__tests__/unifiedLogging.test.ts`: boundary dates (equal to start, equal to end, one day before/after), 0/1/2 active trips, locked trip ignoring a tripId change, toast strings for 0, 1, 2, 3, and 5 tagged names, a whitespace-only note, a rodeWith containing the caller and duplicates
    - _Requirements: 2.6, 2.7, 4.4, 7.2_

- [x] 2. API: shared visit-date guard and `logCompletion` changes
  - [x] 2.1 Extract the future-date guard
    - Move `validateNotFutureVisitDate` and its `formatYmdInTimeZone` helper from `apps/api/src/services/tracking/logs/routes.ts` to a new exported module `apps/api/src/services/tracking/logs/visitDate.ts`, unchanged in behavior; import it back into `routes.ts`
    - Add `visitDate.test.ts` covering equal date (allowed), next day (rejected `log_future_date`), and an unknown zone (rejected `validation_failed`)
    - _Requirements: 6.4_

  - [x] 2.2 Extend `logCompletion`
    - In `apps/api/src/services/trips/repo.ts`: when `input.completedOn !== undefined`, inside the existing transaction after the tag-membership check, read `trips.start_date::text, end_date::text` and `ROLLBACK` + throw `AppError('log_outside_trip_dates', ..., { field: 'visitedOn' })` if outside the inclusive range; add `logged_at` to the `experience_logs` INSERT `RETURNING`; extend `LoggedCompletion` with `logId` and `loggedAt` (ISO string)
    - Update the `TripRepo` interface JSDoc and any in-memory fake of `logCompletion` used by tests so existing tests keep compiling
    - _Requirements: 5.2, 5.6, 6.5, 6.6_

  - [x] 2.3 Map the new fields in `POST /trips/:id/log-entries`
    - In `apps/api/src/services/trips/routes.ts` pass `completedOn: body.visitedOn` and `userTz: body.userTz` to `repo.logCompletion` (only when present), and when `visitedOn` is present run `validateNotFutureVisitDate(body.visitedOn, body.userTz ?? DEFAULT_LOG_USER_TZ, clock())`; add an optional `clock?: () => Date` route option defaulting to `() => new Date()`
    - _Requirements: 5.6, 6.4, 6.6_

- [x] 3. API: Trip-linked creates through the single path
  - [x] 3.1 Define the port and route branch
    - Create `apps/api/src/services/tracking/logs/tripLogPort.ts` with `TripLogPort` exactly as in the design (`logToTrip`, `purgeFeedForLog(logId, userId)`); it imports nothing from `services/trips/`
    - In `tracking/logs/routes.ts`: add optional `tripLog?: TripLogPort` and `onRodeWithTagCreated?` to `ExperienceLogRoutesOptions`; in the POST handler apply the new order (parse, future-date guard, `rodeWith` without `tripId` -> `validation_failed`, Trip-linked branch via the port, else existing `addLog`); respond with `tripLog: { tripId, logEntryId, taggedCount }` for Trip-linked creates; dispatch one `onRodeWithTagCreated` per pending tag; run `awardPinsSafely`
    - In the DELETE handler call `options.tripLog?.purgeFeedForLog(logId, userId)` before `repo.deleteLog`
    - Add a short comment on `addLog`'s `tripId` branch marking it as no longer on the serving path
    - _Requirements: 5.1, 5.2, 5.5, 5.7, 5.8, 5.9, 5.10, 5.11, 11.1, 11.5, 13.6_

  - [x] 3.2 Implement `purgeFeedForLog` and the feed `tagId`
    - `apps/api/src/services/trips/repo.ts`: add `purgeFeedForLog(logId, userId)` to the `TripRepo` interface and implementation as specified in the design (one transaction; ownership via `experience_logs.user_id`; delete reactions, comments, then feed items; idempotent; does not delete the entry or the log)
    - In `getFeed`, add `'tagId', CASE WHEN rwt.tagged_member_id = $2 AND rwt.state = 'pending' THEN rwt.id END` to the `rode_with` `json_build_object`
    - _Requirements: 9.1, 9.2, 11.1, 11.2_

  - [x] 3.3 Wire the port in `composeServices.ts`
    - Build `tripLogPort` as in the design (`assertTripMember` then `tripRepo.logCompletion` with `completedOn: visitedOn`; `purgeFeedForLog` delegating to `tripRepo`) and pass `tripLog: tripLogPort` and `onRodeWithTagCreated: emitRodeWithTagCreated` in the experience-logs route options block
    - Before wiring, open `TripRepo.logCompletion` in `trips/repo.ts` and use its exact parameter list
    - Run `npm run typecheck` immediately after wiring
    - _Requirements: 5.4, 5.5, 5.7_

  - [x] 3.4 Migration 0070 (Feed_Backfill)
    - Create `apps/api/migrations/0070_backfill_completion_logged_feed_items.sql` exactly as in the design (BEGIN/COMMIT, `NOT EXISTS` guard, no DDL)
    - Confirm 0070 is still the next free number (`ls apps/api/migrations`); if another branch has taken it, use the next number and update this spec
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 4. API tests
  - [x] 4.1 Equivalence and regression tests (Property 6)
    - **Property 6: Trip-linked creates are identical from either endpoint** (Validates: Requirements 5.2, 5.3, 5.4, 5.7)
    - `apps/api/src/services/tracking/logs/__tests__/unifiedLogging.equivalence.prop.test.ts` on pg-mem with the real repos; compare persisted rows from the two endpoints (ignoring generated ids/timestamps); assert one notice per tag via a recording dispatcher
    - Regression for the reported bug: a log created via `POST /me/experiences/:id/logs` with `tripId` produces a `completion_logged` `trip_feed_items` row and appears in `tripRepo.getFeed`; confirm this test fails against the pre-change `addLog`-only path

  - [x] 4.2 Rejection and authorization tests (Property 7)
    - **Property 7: Rejected Trip-linked requests write nothing, and denials do not disclose** (Validates: Requirements 5.11, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7)
    - `unifiedLogging.rejections.prop.test.ts`: generate violating inputs, assert specific error codes and unchanged row counts across all six tables; non-member vs non-existent Trip produce identical responses; `POST /trips/:id/log-entries` without `visitedOn` on a past Trip still succeeds

  - [x] 4.3 Delete parity (Property 8)
    - **Property 8: Deleting a Linked_Log removes exactly its trip footprint** (Validates: Requirements 11.1, 11.2, 11.3, 11.5)
    - `unifiedLogging.delete.prop.test.ts`: create several Linked_Logs with tags, reactions, and comments; delete one via the personal route; assert only its footprint is gone; non-linked delete unchanged; another user's `logId` returns `log_not_found` and removes nothing

  - [x] 4.4 Feed `tagId` (Property 9)
    - **Property 9: The feed exposes a tag id only to its own pending Tagged_Member** (Validates: Requirements 9.1, 9.2)
    - `apps/api/src/services/trips/__tests__/feedTagId.prop.test.ts` against pg-mem `getFeed`

  - [x] 4.5 Migration test (Property 10)
    - **Property 10: The backfill is complete, minimal, and idempotent** (Validates: Requirements 12.1, 12.2, 12.3)
    - `apps/api/src/services/trips/__tests__/migration0070.test.ts` (or the repo's existing `migrationNNNN.test.ts` location): seed entries with and without feed items, run the SQL, assert exact rows and field values, run it again and assert no change

  - [x] 4.6 Planned list and summary consistency (Property 11)
    - **Property 11: A Trip-linked log completes a matching planned item and counts in the summary** (Validates: Requirements 10.1, 10.2, 10.3)
    - `unifiedLogging.plannedSummary.test.ts`: real repo creates then real `getFeed`/`getSummary` feeding the shared `completedExperienceIdsFromFeed`, `derivePlannedListPresentation`, and the server summary counts

  - [x] 4.7 Route and structural tests
    - Extend `apps/api/src/services/tracking/logs/__tests__/routes.test.ts` (`server.inject`): 401 unauthenticated; Trip-linked happy path with a fake `TripLogPort` asserting call args, response `tripLog`, `newlyAwardedPinIds`, and notice dispatch; `rodeWith` without `tripId` -> 400 `validation_failed`; `trip_forbidden` surfaced; `log_outside_trip_dates` surfaced; non-Trip create unchanged (no port call); DELETE calls `purgeFeedForLog` before `deleteLog`
    - Extend the trips route tests: `POST /trips/:id/log-entries` with and without `visitedOn`/`userTz`, future `visitedOn` -> `log_future_date`, outside range -> `log_outside_trip_dates`
    - `apps/api/src/services/tracking/logs/__tests__/unifiedLogging.retirement.smoke.test.ts`: structural assertion that `composeServices.ts` source contains the `tripLog:` wiring for the experience-logs routes, and a route test that with a port present `repo.addLog` is never called with a non-null `tripId`
    - _Requirements: 5.1, 5.5, 5.9, 5.10, 5.11, 6.1, 6.2, 6.4, 6.5, 6.6, 11.1, 13.6_

- [x] 5. Checkpoint - shared and API
  - Run `npm run verify:shared` and `npm run verify:api`; ensure the coverage thresholds still pass; ask the user if questions arise.
  - Run `npm run verify:shared` and `npm run verify:api`; ensure the coverage thresholds still pass; ask the user if questions arise.

- [x] 6. Mobile: sheet, toast host, helpers
  - [x] 6.1 Navigation helper and invalidation helper
    - `apps/mobile/src/navigation/navigationRef.ts`: add `navigateToTripFeed({ tripId })` following `navigateToTripMembers` (seeds `TripDetail`, then `TripFeed`)
    - Create `apps/mobile/src/screens/logging/invalidateAfterLog.ts`; open `invalidateAfterLogChange` in `ExperienceDetailScreen.tsx` first and invalidate every key it does, plus the keys listed in the design
    - Tests: `navigationRef` helper test mirroring the existing ones; `invalidateAfterLog.test.ts` asserting the exact set of `queryKey`s invalidated with and without a `tripId`
    - _Requirements: 7.3, 7.5_

  - [x] 6.2 Toast store and host
    - Create `logToastStore.ts` (Zustand; `LOG_TOAST_MS = 6000`, `LOG_TOAST_WITH_DISH_PROMPT_MS = 8000`; `show` replaces and restarts the timer) and `LogToastHost.tsx` (message, **View in trip**, **Log what you ate** opening `FoodItemPickerModal` then `LogFoodItemModal`, `accessibilityLiveRegion="polite"`); mount `<LogToastHost />` once in `RootNavigator.tsx`
    - Colours via `makeStyles` / a co-located `LogToastHost.palette.ts`; reuse the `TOAST` background from `foodLists/MarkGottenUndoToast.palette.ts` if identical rather than a second literal
    - _Requirements: 7.1, 7.3, 7.4, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5, 14.2, 14.3_

  - [x] 6.3 Build `LogExperienceSheet`
    - Create `apps/mobile/src/screens/logging/LogExperienceSheet.tsx` per the design: props, reads (`['me','trips','active']`, members, `['me']`, experience hint or `['experience', id]`, `GET /trips/:id` for a locked Trip), `LogDraft` state through `reconcileDraft`, layout (Today row, Rating, Add-a-note row, Trip chips or locked label, Riding-with chips, error, Cancel/Log), submit via `buildLogSubmission`, success handling (close, `onLogged`, `invalidateAfterLog`, toast, optional `PinCelebrationModal`), error mapping for the six codes, keyboard handling via `useKeyboardBottomInset`, preselect via `preselectTripId` on open, draft reset on close/success
    - `testIDPrefix` controls the id prefix (`log-visit` default, `activity-log` for Trip entry points); keep the existing testIDs listed in the design
    - Theme: only `makeStyles`/`useAppTheme`/`usePalette`; run `themeRetrofit.guard.test.ts`
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.8, 6.9, 7.1, 7.6, 14.1, 14.2, 14.4_

  - [x] 6.4 Convert `LogVisitModal` to a wrapper
    - `apps/mobile/src/screens/catalog/LogVisitModal.tsx` renders `LogExperienceSheet` with the same props; delete the old form code; keep the default export and `LogVisitModalProps`
    - Update `LogVisitModal.keyboard.test.tsx` and `LogVisitModal.dark.test.tsx` only where they assert removed markup; they must still prove keyboard avoidance and dark rendering
    - _Requirements: 1.1, 13.3, 13.5_

  - [x] 6.5 Rebuild `LogComposerModal` on the sheet
    - In `TripFeedScreen.tsx`, keep the `LogComposerModal` props and exports; implement the picker step (existing `ExperiencePicker`) followed by `<LogExperienceSheet lockedTripId={tripId} testIDPrefix="activity-log" ... />`; when the Trip's `status` is `upcoming` do not open the sheet and show the "logging opens when the trip starts" message (also for `Planned_Item_Log_Control`)
    - Update the existing `TripFeedScreen` and `TripPlannedListScreen` tests that assert the old composer markup
    - _Requirements: 1.1, 1.4, 2.4, 2.7, 2.10, 13.2, 13.4, 13.5_

  - [x] 6.6 Inline tag response on the activity card
    - In `TripFeedScreen.tsx` add `tagId?: string | null` to `FeedRodeWith`, accept it in the type guard (~line 2047), render Confirm/Decline for `pending` entries with a `tagId`, add the two mutations and invalidations per the design, inline error on failure
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

- [x] 7. Mobile tests
  - [x] 7.1 Sheet tests
    - `apps/mobile/src/screens/logging/__tests__/LogExperienceSheet.test.tsx` with `@testing-library/react-native`, mocking only `apiRequest`/queries: pre-select with one active trip; two active trips -> no selection and chips; none -> no Trip section; locked mode posts to `/trips/:id/log-entries` with the exact body; unlocked Trip-linked posts to `/me/experiences/:id/logs` with `tripId` and `rodeWith`; date change out of range clears Trip and riders and shows the hint (drive the `DatePickerField` onChange); rider chips toggle; "Dined with" for category `Restaurant`; one-tap submit body; busy disables inputs; each of the six error codes renders its message and keeps the sheet open; success calls `onLogged`, invalidates the keys, enqueues the toast with the right message; `newlyAwardedPinIds` opens the celebration; members-load failure shows retry and still submits
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.8, 6.9, 7.1, 7.5, 7.6_

  - [x] 7.2 Toast host tests
    - `apps/mobile/src/screens/logging/__tests__/LogToastHost.test.tsx`: message text variants; **View in trip** calls the navigation helper with the trip id; Dish_Prompt visible only for restaurants and opens the picker with the experience id; auto-dismiss at 6 s and 8 s with fake timers; a second `show` replaces the first
    - _Requirements: 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.5_

  - [x] 7.3 Trip screen tests
    - In the `TripFeedScreen` tests: `LogComposerModal` shows the picker, then the sheet with the Trip locked and the riders row; the Planned_Item path pre-fills the Experience and posts to `/trips/:id/log-entries`; an `upcoming` Trip shows the message instead of the sheet; Inline_Tag_Response shows controls only for a `tagId` entry, Confirm posts `{}` to `/me/rode-with-tags/:tagId/confirm`, Decline posts to `/decline`, success refetches feed/summary/me-stats, failure shows an inline error and keeps the controls
    - _Requirements: 1.4, 2.4, 2.10, 9.3, 9.4, 9.5, 9.6, 13.2_

  - [x] 7.4 Entry-point smoke tests
    - One render test per entry point that opened `LogVisitModal` (Home dock/FAB, Live Waits, Experience detail, Your Visit card, Passport card, Experience list detail) asserting the sheet opens and a submit posts to `/me/experiences/:id/logs`, so none of the eight call sites regress
    - _Requirements: 1.1, 13.3_

- [x] 8. Cross-spec notes (additive only)
  - [x] 8.1 Record the extensions in the dependent specs
    - Append a short "Extended by `unified-experience-logging`" note (no deletions, no renumbering) to `.kiro/specs/experience-activity-logging/requirements.md` (R1.2: the Trip link now also creates the feed item and tags), `.kiro/specs/trips/requirements.md` (R10: optional `visitedOn`/`userTz`; R13: feed rode-with entries carry `tagId` for the caller's pending tag), and `.kiro/specs/planned-list-completion-sync/requirements.md` (R1: the Log_Composer is now the Unified_Log_Sheet in locked mode, still posting to `POST /trips/:id/log-entries`)
    - These three spec folders may have uncommitted edits from other work; append only, and re-read each file immediately before editing
    - Re-run the Kiro Spec Format diagnostics on all four specs and confirm they are clean
    - _Requirements: 13.2_

- [x] 10. Collaborative Duplicate Log Detection & Resolution
  - [x] 10.1 Schema & Shared Types
    - In `packages/shared/src/trips.ts`: extend `rodeWithConfirmSchema` to accept optional `resolution: z.enum(['link', 'new_log']).optional()`.
    - Build shared: `npm run build:shared`.
    - Unit tests in `packages/shared/src/__tests__/trips.test.ts`.
    - _Requirements: 15.7_
  - [x] 10.2 Backend Repository & Endpoint
    - In `apps/api/src/services/trips/repo.ts`: update `confirmRodeWithTag` to accept `resolution?: 'link' | 'new_log'`. When `'link'`, skip inserting into `experience_logs`. When caller has an existing solo `trip_feed_items` entry for that experience on that trip on that day, retire/link it so the feed avoids duplicate cards.
    - Expose existing log info on tag / feed items where needed.
    - Write unit/property tests for `confirmRodeWithTag` in `apps/api/src/services/trips/__tests__/`.
    - _Requirements: 15.1, 15.2, 15.4, 15.5, 15.6_
  - [x] 10.3 Mobile UI Resolution Sheet
    - Create `RodeWithResolutionSheet` modal in `apps/mobile/src/screens/trips/RodeWithResolutionSheet.tsx`.
    - In `TripFeedScreen.tsx`: when confirming, check if user has an existing log today for this experience; if so, open `RodeWithResolutionSheet` with "Same ride (combine them)" and "We rode it again!" options.
    - Write mobile tests in `apps/mobile/src/screens/trips/__tests__/TripFeedScreen.test.tsx`.
    - _Requirements: 15.3, 15.4, 15.6_

- [ ] 11. Final checkpoint - full gate
  - Review `git diff` against the requirements: confirm every control, route field, and testID named in the design exists in source; no stray scripts or generated files
  - Run the full `npm run verify` once and paste the literal tail (per-workspace counts and exit code `0`)
  - Write the behavior-to-test map (every requirement behavior with its test file and specific assertion) in the completion message
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Test tasks are required, not optional (`execution-discipline`).
- Property tests use fast-check with at least 100 runs and a tag comment: **Feature: unified-experience-logging, Property {number}: {property_text}**.
- Assumptions to confirm during review (called out in the design): with two or more Active_Trips nothing is pre-selected; the date-range check applies only to an explicit `visitedOn`; the visit date is the device-local date while Trip dates are WDW calendar dates, so a traveler near midnight may see `log_outside_trip_dates` and must adjust the date.
- Dish-level logging (`food_item_logs`) gains no Trip link in this spec; the Dish_Prompt only opens the existing dish flow. A Trip-linked dish log would be a separate spec (new column, feed rendering, tagging rules).
- The `candidates` prop of `LogComposerModal` is kept for source compatibility but is no longer needed once the sheet loads members itself; removing it is a later cleanup.
- No new endpoint, no schema change; the only migration is the data backfill 0070.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1"] },
    { "id": 1, "tasks": ["1.4", "1.5", "2.2", "2.3"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.4"] },
    { "id": 3, "tasks": ["3.3"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7"] },
    { "id": 5, "tasks": ["5"] },
    { "id": 6, "tasks": ["6.1", "6.2"] },
    { "id": 7, "tasks": ["6.3"] },
    { "id": 8, "tasks": ["6.4", "6.5", "6.6"] },
    { "id": 9, "tasks": ["7.1", "7.2", "7.3", "7.4"] },
    { "id": 10, "tasks": ["8.1"] },
    { "id": 11, "tasks": ["10.1"] },
    { "id": 12, "tasks": ["10.2"] },
    { "id": 13, "tasks": ["10.3"] },
    { "id": 14, "tasks": ["11"] }
  ]
}
```
