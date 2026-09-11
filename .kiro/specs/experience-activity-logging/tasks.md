# Implementation Plan

## Tasks

- [x] 1. Migration and Shared Schema Contracts
  - [x] 1.1 Create migration `apps/api/migrations/0034_experience_logs.sql` adding `experience_logs` table, indexes, `trip_log_entries.log_id` foreign key, and deterministic backfill
  - [x] 1.2 Add migration unit test `apps/api/src/db/__tests__/migration0034.test.ts`
  - [x] 1.3 Define `ExperienceLogDTO`, `ExperienceVisitHistoryDTO`, `CreateExperienceLogInputDTO` and Zod schemas in `packages/shared/src/schemas/ExperienceLog.ts`
  - [x] 1.4 Export new schemas and types in `packages/shared/src/index.ts` and add schema tests

- [x] 2. Tracking Logs Repository and Dual-Write Engine
  - [x] 2.1 Implement `ExperienceLogRepo` in `apps/api/src/services/tracking/logs/repo.ts` handling atomic inserts, trip linkage, dual-write syncing with `completions`/`ratings`, history queries (`visited_on DESC, logged_at DESC`), and deletions
  - [x] 2.2 Update `confirmRodeWithTag` in `apps/api/src/services/trips/repo.ts` to insert an `experience_logs` row for the tagged member with `visited_on` matching the originating log's `visited_on`
  - [x] 2.3 Write property tests `apps/api/src/services/tracking/logs/__tests__/experienceLogs.prop.test.ts` validating Property 1, 2, 3, and 4 with `fast-check`
  - [x] 2.4 Wire `tracking.logs` into `composeServices.ts`

- [x] 3. Tracking Logs Fastify Routes and Integration Tests
  - [x] 3.1 Implement `POST /me/experiences/:id/logs`, `GET /me/experiences/:id/logs`, and `DELETE /me/experiences/:id/logs/:logId` in `apps/api/src/services/tracking/logs/routes.ts`
  - [x] 3.2 Add route integration tests `apps/api/src/services/tracking/logs/__tests__/routes.test.ts` with `server.inject` covering auth gates, validation, happy path, and delete cascades
  - [x] 3.3 Update trip cascade delete test `apps/api/src/services/trips/__tests__/cascadeDelete.integration.test.ts` to assert `trip_log_entries` are deleted while `experience_logs` survive

- [x] 4. Checkpoint — Backend Verification Gate
  - [x] 4.1 Run `npm run verify:api` and `npm run verify:shared` to verify compiler clean and all test suites pass

- [x] 5. Mobile Experience Detail UI Enhancements
  - [x] 5.1 Create `LogVisitModal.tsx` sheet in `apps/mobile/src/screens/catalog/` with date picker, 1–10 star slider, note input, and trip selector
  - [x] 5.2 Create `VisitHistoryTimeline.tsx` in `apps/mobile/src/screens/catalog/` rendering past visits with dates, ratings, and notes
  - [x] 5.3 Update `YourVisitCard.tsx` to render total visit count badge, the visit-logging button, embed `VisitHistoryTimeline`, and invalidate `['experience-aggregate', id]` _(button label refined in Task 8)_
  - [x] 5.4 Write React Native render and interaction tests in `apps/mobile/src/screens/catalog/__tests__/YourVisitCard.logs.test.tsx`

- [x] 6. Final Verification & Quality Gate
  - [x] 6.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`)

- [ ] 7. No Future Visit Date (R1.5, R6.6, R6.7)
  - [ ] 7.1 Add `log_future_date` (HTTP 400) to the `ErrorCode` catalog and status map in `packages/shared/src/errors.ts`; assert both a valid and an invalid case in the shared errors test
  - [ ] 7.2 Add a TZ-aware future-date guard to `POST /me/experiences/:id/logs` in `apps/api/src/services/tracking/logs/routes.ts` (injectable `clock`, reject `visited_on > today_in_user_tz` with `log_future_date`, field `visitedOn`), mirroring the Completion route; add a `server.inject` test proving a future date is rejected 400 and no log is written, and that a today/past date is accepted
  - [ ] 7.3 Add an optional `maximumDate` prop to `apps/mobile/src/components/DatePickerField.tsx` (passed through as the Calendar's `maxDate`); add a render test proving a day after `maximumDate` does not fire `onChange` while an in-range day does
  - [ ] 7.4 Cap the `LogVisitModal` visit-date picker at today via `maximumDate`, map `log_future_date` to a friendly message in the modal's error mapping, and cover the hidden-trip-selector behavior (R6.7) in `YourVisitCard.logs.test.tsx`

- [ ] 8. Category-neutral visit-logging button label (R6.2)
  - [ ] 8.1 In `apps/mobile/src/screens/catalog/YourVisitCard.tsx`, make the visit-logging button label and accessibility label count-based: *"Log a visit"* when `repeatCount === 0`, *"Log another visit"* when `repeatCount > 0` — replacing the ride-specific *"Log visit / ride again"* copy so it reads correctly for restaurants, shows, and character meets
  - [ ] 8.2 Add interaction/render assertions in `apps/mobile/src/screens/catalog/__tests__/YourVisitCard.logs.test.tsx` covering both label states (no prior visits vs one or more)

## Task Dependency Graph

```
1.1-1.4 (Migration & Shared Contracts)
          │
          ▼
2.1-2.4 (Logs Repository, Rode-With Confirm & composeServices)
          │
          ▼
3.1-3.3 (Fastify Routes & Cascade Tests)
          │
          ▼
4.1 (Checkpoint: Backend Verification Gate)
          │
          ▼
5.1-5.4 (Mobile UI Enhancements & Component Tests)
          │
          ▼
6.1 (Final Full Verification Gate)
          │
          ▼
7.1 (shared: log_future_date code)
          │
          ▼
7.2 (api: server-side future-date guard) ──┐
          │                                 │
          ▼                                 ▼
7.3 (mobile: DatePickerField maximumDate)  (independent of 7.2)
          │
          ▼
7.4 (mobile: cap LogVisitModal + error mapping + tests)

5.3 (YourVisitCard)
          │
          ▼
8.1 (mobile: count-based button label) ──▶ 8.2 (label-state tests)
```

## Notes

- **Trip Cascade Independence:** Deleting a Trip removes the `trip_log_entries` row via the pre-existing `trip_id REFERENCES trips(id) ON DELETE CASCADE` (migration 0015), preserving the user's permanent `experience_logs` row.
- **Log Deletion Cascade:** Deleting an `experience_logs` row removes the referencing `trip_log_entries` record via `log_id REFERENCES experience_logs(id) ON DELETE CASCADE`.
- **Backfill Safety:** Deterministic UUID generation on `trip_log_entries.log_id` first prevents duplicate ID collisions.
- **Chronology & Back-Dating:** Personal visit history queries (`GET /me/experiences/:id/logs`) order by `visited_on DESC, logged_at DESC` to reflect real-world visit dates. Existing trip feed query `listLogEntries` retains its proven `ORDER BY le.created_at DESC, le.id DESC` contract with zero regressions on trip queries.
