# Implementation Plan

## Overview

This plan builds in-app feedback as a vertical slice across `packages/shared`, `apps/api` and `apps/mobile`. It starts with the shared Zod contract (`feedback.ts`), then adds the `user_feedback` migration together with its account-deletion registry entry, then the feedback service (config caps, pure policy, repo, `POST /me/feedback` route, purge test). It continues with the admin review section (list, detail, status, delete), the mobile `FeedbackScreen` with its You & Crew entry row, and a privacy-policy sentence. Each task ships with its tests, each area ends at a scoped verification checkpoint, and the full `npm run verify` runs once at the end.

## Tasks

- [x] 1. Shared contract (`packages/shared`)
  - [x] 1.1 Create `packages/shared/src/feedback.ts` with `FEEDBACK_KINDS`, `FEEDBACK_STATUSES`, `FEEDBACK_PLATFORMS`, `FEEDBACK_MESSAGE_MAX`, `FEEDBACK_DEVICE_FIELD_MAX`, `feedbackDeviceSchema`, `feedbackSubmitInputSchema`, and the `FeedbackSubmitInput` / `FeedbackSubmitResponse` types; export them from `packages/shared/src/index.ts`
    - _Requirements: 2.1, 2.2, 8.2_
  - [x] 1.2 Add `packages/shared/src/__tests__/feedback.test.ts` with valid and invalid cases and the fast-check Property 5 (at least 100 runs)
    - _Requirements: 2.2_
  - [x] 1.3 Checkpoint: run `npm run verify:shared`

- [x] 2. Migration and account-deletion registry (`apps/api`)
  - [x] 2.1 Create `apps/api/migrations/0076_user_feedback.sql` exactly as in the design's Data Models section
    - _Requirements: 2.4, 7.1_
  - [x] 2.2 Add the `user_feedback.user_id` `delete` entry (stage 4, `chunkColumns: ['id']`) to `apps/api/src/services/accountDeletion/dispositions.ts` in the same change as 2.1
    - _Requirements: 7.1_
  - [x] 2.3 Add `apps/api/src/db/__tests__/migration0076.test.ts` asserting columns, each CHECK (kind, status, platform, message length, `contact_ok`/`contact_email`), both indexes, and cascade delete when the user row is deleted
    - _Requirements: 2.4, 7.1_
  - [x] 2.4 Checkpoint: run `npm run verify:api`, confirming `dispositions.test.ts` (registry completeness) and every suite that applies all migrations under pg-mem still pass

- [x] 3. Feedback service (`apps/api`)
  - [x] 3.1 Add `FEEDBACK_PER_HOUR`, `FEEDBACK_PER_DAY`, `FEEDBACK_RETENTION_DAYS` to `apps/api/src/config.ts` and expose `config.feedback`; add a config test for defaults and bounds
    - _Requirements: 3.1, 6.1_
  - [x] 3.2 Create `services/feedback/policy.ts` (`checkCaps`, `pruneCutoff`, `previewMessage`) with `__tests__/policy.prop.test.ts` for Properties 1, 7 and 10
    - _Requirements: 3.1, 3.3, 5.2, 6.1_
  - [x] 3.3 Create `services/feedback/repo.ts` (`countRecent`, `insert`, `pruneResolved`, `list`, `get`, `setStatus`, `remove`); the only statement reading `users` carries `deletion_state = 'active'` in the same literal
    - _Requirements: 2.4, 2.5, 2.6, 3.2, 6.1, 7.2_
  - [x] 3.4 Add `__tests__/repo.test.ts` (pg-mem, real SQL) for Properties 2, 3, 4 and 6, the inactive-account insert returning `null`, and cross-user isolation of the counts
    - _Requirements: 2.3, 2.4, 3.1, 6.2_
  - [x] 3.5 Create `services/feedback/routes.ts` (`POST /me/feedback`) and wire it in `composeServices.ts` and `server.ts`
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 3.1, 6.1_
  - [x] 3.6 Add `__tests__/routes.test.ts` (`server.inject`) covering every row of the route-layer entry in the design's Testing Strategy, including the 429 boundary for both windows and "message never logged"
    - _Requirements: 2.1, 2.2, 2.6, 2.7, 3.1, 3.3, 6.1, 6.2_
  - [x] 3.7 Add `__tests__/purge.test.ts` using the account-deletion purge harness, asserting Property 8
    - _Requirements: 7.1_
  - [x] 3.8 Checkpoint: run `npm run verify:api`; `src/__tests__/visibility.guard.test.ts` must pass with no allowlist change

- [x] 4. Admin review section (`apps/api`)
  - [x] 4.1 Append Requirement 20 "User feedback section" to `.kiro/specs/admin-panel/requirements.md` (additive; mirrors Requirement 19: optional `feedback` port, navigation link, same-origin POSTs, escaping, headers, urlencoded child scope). Done while drafting this spec; confirm the Kiro spec diagnostics show that file clean
    - _Requirements: 5.1_
  - [x] 4.2 Create `services/admin/feedbackRoutes.ts` (list, detail, status, delete) in a child scope with a urlencoded parser; register it from `adminRoutes` only when the optional `feedback` port is passed; add the "User Feedback" navigation link in `html.ts` gated the same way; pass the port from `server.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
  - [x] 4.3 Add `services/admin/__tests__/feedbackRoutes.test.ts` covering every admin row of the design's Testing Strategy, with Properties 9 and 11, and a real `application/x-www-form-urlencoded` `inject` for the POSTs
    - _Requirements: 5.1 to 5.8_
  - [x] 4.4 Checkpoint: run `npm run verify:api`

- [x] 5. Mobile (`apps/mobile`)
  - [x] 5.1 Create `screens/feedback/FeedbackScreen.tsx` (form, `useMutation` to `POST /me/feedback`, confirmation state, draft kept on failure, in-flight guard) and the exported pure `buildDeviceInfo()`; use `makeStyles` and the theme, with a `.palette.ts` only if a literal color is unavoidable
    - _Requirements: 1.2 to 1.7, 2.3, 3.4, 4.1 to 4.3, 7.3, 8.1_
  - [x] 5.2 Register `Feedback` in `navigation/YouAndCrewStack.tsx` and add the `feedback-entry-button` row to `YouAndCrewScreen.tsx` above the delete entry
    - _Requirements: 1.1_
  - [x] 5.3 Add `screens/feedback/__tests__/FeedbackScreen.test.tsx` driving every interaction listed in the design's Testing Strategy (request body and on-screen result for each) plus a `buildDeviceInfo` unit test; extend `YouAndCrewScreen.test.tsx` for the entry row
    - _Requirements: 1.1 to 1.7, 3.4, 4.1, 4.2_
  - [x] 5.4 Checkpoint: run `npm run verify:mobile`

- [x] 6. Privacy wording
  - [x] 6.1 Add one sentence about feedback submissions to `renderPrivacyPolicyHtml` in `services/accountDeletion/webPages.ts` and update that renderer's existing test to assert the sentence
    - _Requirements: 7.3_

- [x] 7. Final full verification gate
  - [x] 7.1 Run the full `npm run verify` once across all workspaces (this change touches `packages/shared`, `apps/api` and `apps/mobile`); paste the literal tail with exit code 0
    - _Requirements: All_
  - [x] 7.2 Write the behavior-to-test map for the final report, and confirm the working tree holds only intended source changes

## Notes

- Cross-spec dependencies: `account-deletion` (registry entry and purge harness), `admin-panel` (new Requirement 20), `legal-disclaimers-and-terms` / `accountDeletion/webPages.ts` (privacy sentence). All three specs exist and are built; this spec edits them additively only.
- Migration number `0076` is the next free number at drafting time (latest is `0075_dining_plan.sql`). Re-check before creating the file.
- A new foreign key to `users(id)` fails `dispositions.test.ts` until the registry entry exists, so tasks 2.1 and 2.2 land together.
- Do not add an allowlist entry to `visibility.guard.test.ts`. If it fails, the insert literal is missing `deletion_state = 'active'`.
- Deliberately not built: screenshots, replies, a purge cron, an email per submission, and a screen-name field. Each is listed with its reason in `design.md`.
- Implementation notes (differences from the plan above, all additive):
  - `dispositions.test.ts` pins the number of `users(id)` foreign keys (`EXPECTED_USER_FK_COUNT`); it was raised from 78 to 79 with the registry entry.
  - Task 3.4/3.8 also gained `repo.livedb.test.ts` (real Postgres) and `src/__tests__/composeServices.feedback.test.ts` (wiring through the real composition root); task 3.1 gained `src/__tests__/config.feedback.test.ts`.
  - Task 6.1 changed both `docs/privacy-policy.md` and `renderPrivacyPolicyHtml`, because `webPages.prop.test.ts` requires the two to match.
  - The checkpoints after tasks 2 to 5 were run as focused suites. `verify:api` ran once (after task 4); its single failure was a 5 s timeout in the unrelated `trips/feedPosts` property test under load, which passes alone. The full `npm run verify` ran twice: the first run caught a `tsc` error in the new mobile test (invisible to Jest), the second passed with exit code 0.
- Pushing to `develop` deploys production (stored project note), so run the final gate before any push.

## Task Dependency Graph

Waves group tasks whose dependencies are all satisfied by earlier waves. Tasks in the same wave are independent of each other. Task 2.2 must land with 2.1 in the same change, so both sit in wave 2. Task 5 needs the shared contract from Task 1 and the route contract from 3.5. Task 7.1 runs once, after every other task.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1", "2.2", "3.1"] },
    { "id": 3, "tasks": ["2.3", "3.2", "3.3"] },
    { "id": 4, "tasks": ["2.4", "3.4", "3.5"] },
    { "id": 5, "tasks": ["3.6", "3.7"] },
    { "id": 6, "tasks": ["3.8"] },
    { "id": 7, "tasks": ["4.1", "4.2", "5.1"] },
    { "id": 8, "tasks": ["4.3", "5.2", "6.1"] },
    { "id": 9, "tasks": ["4.4", "5.3"] },
    { "id": 10, "tasks": ["5.4"] },
    { "id": 11, "tasks": ["7.1"] },
    { "id": 12, "tasks": ["7.2"] }
  ]
}
```

Diagram of the same ordering:

```
Task 1 (Shared contract)
   │
   ├──▶ Task 2 (Migration + registry entry)
   │       │
   │       ▼
   │    Task 3 (Feedback service: config, policy, repo, routes, purge test)
   │       │
   │       ├──▶ Task 4 (Admin review section)
   │       │
   └───────┼──▶ Task 5 (Mobile screen + entry)   [needs Task 1 and the route contract from Task 3.5]
           │
           ▼
        Task 6 (Privacy wording)
           │
           ▼
        Task 7 (Final full gate)   [after Tasks 4, 5 and 6]
```
