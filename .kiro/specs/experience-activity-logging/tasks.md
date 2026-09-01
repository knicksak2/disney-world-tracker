# Implementation Plan

## Tasks

- [ ] 1. Migration and Shared Schema Contracts
  - [ ] 1.1 Create migration `apps/api/migrations/0034_experience_logs.sql` adding `experience_logs` table, indexes, `trip_log_entries.log_id` foreign key, and deterministic backfill
  - [ ] 1.2 Add migration unit test `apps/api/src/db/__tests__/migration0034.test.ts`
  - [ ] 1.3 Define `ExperienceLogDTO`, `ExperienceVisitHistoryDTO`, `CreateExperienceLogInputDTO` and Zod schemas in `packages/shared/src/schemas/ExperienceLog.ts`
  - [ ] 1.4 Export new schemas and types in `packages/shared/src/index.ts` and add schema tests

- [ ] 2. Tracking Logs Repository and Dual-Write Engine
  - [ ] 2.1 Implement `ExperienceLogRepo` in `apps/api/src/services/tracking/logs/repo.ts` handling atomic inserts, trip linkage, dual-write syncing with `completions`/`ratings`, history queries (`visited_on DESC, logged_at DESC`), and deletions
  - [ ] 2.2 Update `confirmRodeWithTag` in `apps/api/src/services/trips/repo.ts` to insert an `experience_logs` row for the tagged member with `visited_on` matching the originating log's `visited_on`
  - [ ] 2.3 Write property tests `apps/api/src/services/tracking/logs/__tests__/experienceLogs.prop.test.ts` validating Property 1, 2, 3, and 4 with `fast-check`
  - [ ] 2.4 Wire `tracking.logs` into `composeServices.ts`

- [ ] 3. Tracking Logs Fastify Routes and Integration Tests
  - [ ] 3.1 Implement `POST /me/experiences/:id/logs`, `GET /me/experiences/:id/logs`, and `DELETE /me/experiences/:id/logs/:logId` in `apps/api/src/services/tracking/logs/routes.ts`
  - [ ] 3.2 Add route integration tests `apps/api/src/services/tracking/logs/__tests__/routes.test.ts` with `server.inject` covering auth gates, validation, happy path, and delete cascades
  - [ ] 3.3 Update trip cascade delete test `apps/api/src/services/trips/__tests__/cascadeDelete.integration.test.ts` to assert `trip_log_entries` are deleted while `experience_logs` survive

- [ ] 4. Checkpoint — Backend Verification Gate
  - [ ] 4.1 Run `npm run verify:api` and `npm run verify:shared` to verify compiler clean and all test suites pass

- [ ] 5. Mobile Experience Detail UI Enhancements
  - [ ] 5.1 Create `LogVisitModal.tsx` sheet in `apps/mobile/src/screens/catalog/` with date picker, 1–10 star slider, note input, and trip selector
  - [ ] 5.2 Create `VisitHistoryTimeline.tsx` in `apps/mobile/src/screens/catalog/` rendering past visits with dates, ratings, and notes
  - [ ] 5.3 Update `YourVisitCard.tsx` to render total visit count badge, "Log Visit / Ride Again" button, embed `VisitHistoryTimeline`, and invalidate `['experience-aggregate', id]`
  - [ ] 5.4 Write React Native render and interaction tests in `apps/mobile/src/screens/catalog/__tests__/YourVisitCard.logs.test.tsx`

- [ ] 6. Final Verification & Quality Gate
  - [ ] 6.1 Run full `npm run verify` across all workspaces (`apps/api`, `apps/mobile`, `packages/shared`)

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
```

## Notes

- **Trip Cascade Independence:** Deleting a Trip removes the `trip_log_entries` row via the pre-existing `trip_id REFERENCES trips(id) ON DELETE CASCADE` (migration 0015), preserving the user's permanent `experience_logs` row.
- **Log Deletion Cascade:** Deleting an `experience_logs` row removes the referencing `trip_log_entries` record via `log_id REFERENCES experience_logs(id) ON DELETE CASCADE`.
- **Backfill Safety:** Deterministic UUID generation on `trip_log_entries.log_id` first prevents duplicate ID collisions.
- **Chronology & Back-Dating:** Personal visit history queries (`GET /me/experiences/:id/logs`) order by `visited_on DESC, logged_at DESC` to reflect real-world visit dates. Existing trip feed query `listLogEntries` retains its proven `ORDER BY le.created_at DESC, le.id DESC` contract with zero regressions on trip queries.
