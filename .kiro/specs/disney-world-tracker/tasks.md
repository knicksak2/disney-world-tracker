# Implementation Plan: Disney World Tracker

## Overview

This plan turns the design into an incremental, code-only build sequence for a TypeScript monorepo containing:

- `apps/api` — Node.js + Fastify backend (seven service modules, BullMQ workers, PostgreSQL, Redis, S3-compatible avatar store)
- `apps/mobile` — React Native + TypeScript (Expo bare workflow) client
- `packages/shared` — DTOs, Zod validation schemas, error code catalog, shared enums

The architecture is hosting-agnostic. Tasks produce code that runs on the stack described in `hosting.md` (Render + Neon + Upstash + Cloudflare R2) but never bake provider names into application code. Anything provider-specific lives in env config and infra glue.

Property tests use `fast-check` driven through Vitest (backend) and Jest (mobile), each with `numRuns >= 100`. Every property test carries a one-line tag header of the form `// Feature: disney-world-tracker, Property N: <one-line description>` and maps to one or more design properties.

## Wave Schedule (Mermaid)

```mermaid
flowchart LR
    classDef wave fill:#eef,stroke:#333,stroke-width:1px;

    subgraph W0["Wave 0 — Bootstrap & Shared"]
        direction TB
        T1_1["1.1 Monorepo bootstrap"]
        T1_2["1.2 Shared error codes"]
        T1_3["1.3 Shared enums"]
    end

    subgraph W1["Wave 1 — Schemas & Pure Functions"]
        direction TB
        T1_4["1.4 Shared DTO + Zod"]
        T2_1["2.1 API skeleton + config"]
        T2_2["2.2 Logger + redactor"]
        T2_3["2.3 Error envelope"]
        T3_1["3.1 PG + migration runner"]
        T3_2["3.2 Initial migrations"]
        T4_1["4.1 classify() pure fn"]
        T4_2["4.2 reconcile() pure fn"]
        T4_3["4.3 stable internalId"]
        T5_1["5.1 computePercent()"]
        T7_1["7.1 friendship pair fn"]
        T8_1["8.1 mean_x10 update fn"]
    end

    subgraph W2["Wave 2 — Property Tests on Pure Fns"]
        direction TB
        T4_4["4.4* PBT classify P1"]
        T4_5["4.5* PBT internalId P2"]
        T4_6["4.6* PBT reconcile P5"]
        T4_7["4.7* PBT field constraints P3"]
        T5_2["5.2* PBT computePercent P9"]
        T8_2["8.2* PBT aggregate P26"]
    end

    subgraph W3["Wave 3 — Auth & Sessions"]
        direction TB
        T6_1["6.1 Argon2id + session"]
        T6_2["6.2 Session middleware"]
        T6_3["6.3 Auth routes"]
        T6_4["6.4 Lockout (Redis)"]
        T6_5["6.5 Profile + avatar"]
    end

    subgraph W4["Wave 4 — Auth PBTs"]
        direction TB
        T6_6["6.6* PBT registration P12"]
        T6_7["6.7* PBT email uniq P13"]
        T6_8["6.8* PBT session P14"]
        T6_9["6.9* PBT lockout P15"]
        T6_10["6.10* PBT no plaintext P16"]
        T6_11["6.11* PBT display name P17"]
        T6_12["6.12* PBT avatar P18"]
        T6_13["6.13* PBT profile auth P19"]
    end

    subgraph W5["Wave 5 — Catalog Service"]
        direction TB
        T9_1["9.1 ThemeParks client"]
        T9_2["9.2 Catalog repo"]
        T9_3["9.3 Sync orchestrator"]
        T9_4["9.4 Opportunistic 5s race"]
        T9_5["9.5 Scheduler"]
        T9_6["9.6 Catalog routes"]
    end

    subgraph W6["Wave 6 — Catalog PBTs + Integration"]
        direction TB
        T9_7["9.7* PBT read decision P4"]
        T9_8["9.8* PBT presentation P6"]
        T9_9["9.9* Integration fixture"]
    end

    subgraph W7["Wave 7 — Tracking & Stats"]
        direction TB
        T10_1["10.1 Completion repo+routes"]
        T10_2["10.2 Rating repo+routes"]
        T10_3["10.3 Note repo+routes"]
        T10_4["10.4 RatingChanged events"]
        T11_1["11.1 Stats query+routes"]
    end

    subgraph W8["Wave 8 — Tracking PBTs"]
        direction TB
        T10_5["10.5* PBT completion P7"]
        T10_6["10.6* PBT rating P10"]
        T10_7["10.7* PBT note P11"]
    end

    subgraph W9["Wave 9 — Aggregate, Friends, Sharing"]
        direction TB
        T8_3["8.3 Aggregate repo+worker"]
        T8_4["8.4 Aggregate routes"]
        T8_5["8.5 Leaderboard cache"]
        T7_2["7.2 Friends repo+routes"]
        T12_1["12.1 Sharing repo+routes"]
    end

    subgraph W10["Wave 10 — Aggregate/Friends/Share PBTs"]
        direction TB
        T8_6["8.6* PBT leaderboard P27"]
        T8_7["8.7* PBT cache stale P28"]
        T7_3["7.3* PBT user search P20"]
        T7_4["7.4* PBT friend graph P21"]
        T12_2["12.2* PBT share atomic P22"]
        T12_3["12.3* PBT share payload P23"]
        T12_4["12.4* PBT inbox P24"]
        T12_5["12.5* PBT recipient del P25"]
    end

    subgraph W11["Wave 11 — Smoke + Backend Checkpoint"]
        direction TB
        T13_1["13.1 Smoke harness"]
        T13_2["13.2 Smoke perf SLAs"]
        T13_3["13.3 Rate limits"]
        T13_4["13.4 Metrics hooks"]
    end

    subgraph W12["Wave 12 — Mobile Bootstrap"]
        direction TB
        T14_1["14.1 Expo bootstrap"]
        T14_2["14.2 API client + session"]
        T14_3["14.3 Navigation shell"]
    end

    subgraph W13["Wave 13 — Mobile Auth + Profile"]
        direction TB
        T15_1["15.1 Register/Login screens"]
        T15_2["15.2 Profile screen"]
        T15_3["15.3 Avatar upload"]
    end

    subgraph W14["Wave 14 — Mobile Catalog"]
        direction TB
        T16_1["16.1 Catalog list+filters"]
        T16_2["16.2 Catalog search"]
        T16_3["16.3 Detail screen"]
    end

    subgraph W15["Wave 15 — Mobile Tracking + Stats"]
        direction TB
        T17_1["17.1 Completion UI"]
        T17_2["17.2 Rating UI"]
        T17_3["17.3 Note UI"]
        T17_4["17.4 Stats screen"]
    end

    subgraph W16["Wave 16 — Mobile Friends + Sharing + Home"]
        direction TB
        T18_1["18.1 Friends screens"]
        T18_2["18.2 Share send UI"]
        T18_3["18.3 Inbox UI"]
        T19_1["19.1 Home + leaderboard"]
    end

    subgraph W17["Wave 17 — Mobile Tests + Final Checkpoint"]
        direction TB
        T20_1["20.1* RNTL navigation tests"]
        T20_2["20.2* RNTL empty-state tests"]
        T20_3["20.3* Mobile validators PBT"]
    end

    W0 --> W1 --> W2 --> W3 --> W4 --> W5 --> W6 --> W7 --> W8 --> W9 --> W10 --> W11 --> W12 --> W13 --> W14 --> W15 --> W16 --> W17

    class W0,W1,W2,W3,W4,W5,W6,W7,W8,W9,W10,W11,W12,W13,W14,W15,W16,W17 wave;
```

## Tasks

- [x] 1. Bootstrap monorepo and shared package
  - [x] 1.1 Initialize the monorepo workspace
    - Create root `package.json` with `npm` workspaces (or `pnpm-workspace.yaml`) covering `apps/api`, `apps/mobile`, `packages/shared`
    - Add root TypeScript config (`tsconfig.base.json`) with strict mode, ES2022 target, `paths` for `@dwt/shared`
    - Add root `.editorconfig`, `.gitignore`, `.nvmrc` (Node 20), and an `eslint.config.mjs` shared by all packages
    - Add a single root `README.md` describing the three workspaces and how to run each
    - _Requirements: foundation for all_
  - [x] 1.2 Implement shared error code catalog
    - Create `packages/shared/src/errors.ts` exporting the `ErrorCode` union and `ErrorEnvelope` type matching the design's uniform JSON envelope
    - Include every code in the design's error catalog (`email_in_use`, `validation_failed`, `invalid_credentials`, `account_locked`, `unauthorized`, `catalog_unavailable`, `stale_cache`, `completion_future_date`, `completion_not_found`, `completion_combined_op_not_allowed`, `rating_out_of_range`, `rating_not_found`, `note_length_invalid`, `note_not_found`, `display_name_invalid`, `avatar_invalid`, `profile_forbidden`, `search_query_length_invalid`, `friend_self_target`, `friend_duplicate_relationship`, `friend_recipient_unknown`, `friendship_not_found`, `share_recipient_count_invalid`, `share_atomic_rejected`, `internal_error`)
    - Export an `errorCodeToHttpStatus` map mirroring the design's HTTP column
    - _Requirements: R1.13, R1.24, R2.6-R2.8, R4.7-R4.8, R5.7, R5.10, R6.3-R6.10, R7.6-R7.8, R8.2, R8.7-R8.11, R9.2-R9.3_
  - [x] 1.3 Implement shared enums
    - Create `packages/shared/src/enums.ts` exporting `ExperienceCategory` (`Ride | Show | Restaurant | Parade | Character_Meet | Other`), `Park` (Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom, Typhoon Lagoon, Blizzard Beach, Disney Springs), and `SharePayloadKind` (`experience | progress`)
    - _Requirements: R1.3-R1.6, R9.7_
  - [x] 1.4 Implement shared DTOs and Zod validation schemas
    - Create `packages/shared/src/dto/*.ts` for: `User`, `Profile`, `Experience`, `Completion`, `Rating`, `Note`, `FriendRequest`, `Friendship`, `Share`, `ShareRecipient`, `AggregateRating`, `LeaderboardEntry`, `Stats`
    - Create `packages/shared/src/schemas/*.ts` mirroring each DTO with Zod, including: RFC 5322 email, display name 1-50 trimmed, password 8-128, rating int 1-10, note 1-2000 trimmed, search query 1-100, recipient list 1-50
    - Export `AggregateRatingDTO` such that the type literally has only `value: number | null` and `count: number` — no field for another user's individual rating (privacy boundary in the type system)
    - Add a `packages/shared/src/index.ts` barrel
    - _Requirements: R4.1, R4.7, R5.2, R5.10, R6.1, R6.4, R7.2, R7.5-R7.6, R8.1-R8.2, R9.2, R10.10_

- [x] 2. API skeleton, configuration, logging, error envelope
  - [x] 2.1 Create the Fastify API skeleton with config loader
    - Create `apps/api/src/server.ts` exporting `buildServer(config)` returning a configured Fastify instance
    - Create `apps/api/src/config.ts` reading env vars (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SESSION_SECRET`, `THEMEPARKS_BASE_URL` defaulting to `https://api.themeparks.wiki/v1`) via `zod` schema; never read providers' names anywhere else in code
    - Add `apps/api/src/index.ts` as the production entrypoint that calls `buildServer(loadConfig())` and listens
    - _Requirements: foundation_
  - [x] 2.2 Wire structured logging with PII/secret redaction
    - Add `pino` with `redact` paths for `req.body.password`, `req.headers.authorization`, `req.body.token`, `req.body.avatar`, and any field literally named `password`
    - Attach a `request_id` (UUID v4) to every request and include it on every domain log event and every error response
    - _Requirements: R6.11, R7.8 (no analytics on profile-deny logs are scrubbed via dedicated path)_
  - [x] 2.3 Implement uniform error envelope and global error hook
    - Create `apps/api/src/errors/AppError.ts` exporting `AppError` class with `code: ErrorCode`, optional `field`, optional `details`
    - Register a Fastify `setErrorHandler` that maps `AppError` → JSON envelope + correct HTTP status from `errorCodeToHttpStatus`, and any unhandled throw → `internal_error` 500 with redacted log
    - _Requirements: R1.13, R1.24, all error codes from 1.2_

- [x] 3. PostgreSQL connection, migration runner, initial schema
  - [x] 3.1 Add Postgres client and migration runner
    - Add `pg` and a migration runner (`node-pg-migrate` or hand-rolled in `apps/api/src/db/migrate.ts`)
    - Expose a typed `pool` via `apps/api/src/db/pool.ts`
    - Add an `npm run migrate` script at workspace root
    - _Requirements: foundation_
  - [x] 3.2 Author the initial migration set
    - Create `apps/api/migrations/0001_init.sql` with all tables from the design ER diagram: `users` (citext email UNIQUE), `profiles`, `sessions`, `experiences`, `catalog_sync_runs`, `catalog_cache_metadata`, `completions`, `ratings`, `notes`, `friend_requests` (UNIQUE on `sender_id, recipient_id`), `friendships` (PK on `user_lo_id, user_hi_id` with CHECK `user_lo_id < user_hi_id`), `shares`, `share_recipients`, `aggregate_ratings`
    - Apply CHECK constraints exactly as listed in design.md (rating 1..10, note 1..2000, mean_x10 NULL or 10..100)
    - Add indexes: `experiences(active, park, category)`, `experiences(lower(name))`, `completions(user_id)`, `ratings(experience_id)`, `users` trigram index on `email` and `display_name`
    - Enable `citext` and `pg_trgm` extensions
    - _Requirements: R1.7, R2.3, R4.2, R5.1, R6.2, R8.6, R10.1_

- [x] 4. Catalog domain pure functions
  - [x] 4.1 Implement `classify(entity) -> ExperienceCategory`
    - Create `apps/api/src/services/catalog/classify.ts` as a pure function over an upstream entity DTO
    - Apply the mapping table from design.md including parade and character-meet sub-classification by name regex and `attractionType` field when present
    - _Requirements: R1.2, R1.3, R1.4, R1.5_
  - [x] 4.2 Implement `reconcile(currentCache, upstreamSet) -> { upserts, softDeletes }`
    - Create `apps/api/src/services/catalog/reconcile.ts` as a pure function returning the diff to apply, never touching the database
    - Compute upserts (new id, or changed name/park/category) and soft-deletes (cache id absent from upstream) without ever discarding rows
    - _Requirements: R1.14, R1.15, R1.16_
  - [x] 4.3 Implement deterministic `internalId(upstreamId)`
    - Create `apps/api/src/services/catalog/internalId.ts` using `uuid` v5 with a fixed namespace constant (declared in the file)
    - _Requirements: R1.7_
  - [x] 4.4 Write property test for `classify`
    - **Property 1: Catalog classification and park mapping**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6**
    - File: `apps/api/src/services/catalog/__tests__/classify.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 1: classify maps every included entity by the rule table`
    - `numRuns: 100`
  - [x] 4.5 Write property test for `internalId`
    - **Property 2: Stable internal id is a one-to-one function of upstream entity id**
    - **Validates: Requirements 1.7**
    - File: `apps/api/src/services/catalog/__tests__/internalId.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 2: internalId is deterministic and one-to-one over upstream ids`
    - `numRuns: 100`
  - [x] 4.6 Write property test for `reconcile`
    - **Property 5: Catalog reconcile is correct on upserts and soft-deletes**
    - **Validates: Requirements 1.14, 1.15, 1.16**
    - File: `apps/api/src/services/catalog/__tests__/reconcile.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 5: reconcile produces correct upsert and soft-delete sets`
    - `numRuns: 100`
  - [x] 4.7 Write property test for Experience field constraints
    - **Property 3: Generated Experience records satisfy field constraints**
    - **Validates: Requirements 1.8**
    - File: `apps/api/src/services/catalog/__tests__/fields.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 3: produced Experiences satisfy name/park/category/description constraints`
    - `numRuns: 100`

- [x] 5. Stats pure function
  - [x] 5.1 Implement `computePercent(numerator, denominator)`
    - Create `apps/api/src/services/stats/computePercent.ts` returning a number in `[0.0, 100.0]` with `t==0 ⇒ 0.0` and `min(100.0, round1(c*100/t))` otherwise
    - Use a `round1` helper that rounds half away from zero to one decimal
    - _Requirements: R3.1, R3.2, R3.3, R3.6, R3.7, R3.8_
  - [x] 5.2 Write property test for `computePercent`
    - **Property 9: Completion-percentage formula is bounded, rounded, and zero-safe**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.6, 3.7, 3.8**
    - File: `apps/api/src/services/stats/__tests__/computePercent.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 9: computePercent is bounded, rounded, and zero-safe`
    - `numRuns: 100`

- [x] 6. Auth_Service implementation
  - [x] 6.1 Implement Argon2id hashing and session token utilities
    - Add `apps/api/src/services/auth/password.ts` wrapping `argon2` with `m=64 MiB, t=3, p=1`; export `hash(plaintext)` and `verify(hash, plaintext)`
    - Add `apps/api/src/services/auth/sessionToken.ts` generating a 256-bit URL-safe random token and a `sha256(token)` hash; only the hash is persisted
    - _Requirements: R6.11_
  - [x] 6.2 Implement session lifecycle middleware
    - Create `apps/api/src/services/auth/sessionMiddleware.ts` resolving `Authorization: Bearer <token>`, looking up by token hash, enforcing `revoked_at IS NULL`, `now < absolute_expires_at`, idle window 30 days, and applying the 24-hour continuous-activity rule (close burst on 30-minute idle, start new 24h window)
    - Reject all unauthorized requests with `unauthorized` error
    - Update `last_seen_at` on each authorized request
    - _Requirements: R6.5, R6.8, R6.9, R6.10, R6.12_
  - [x] 6.3 Implement registration, login, logout, and `/me` routes
    - Create `apps/api/src/services/auth/routes.ts` with `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /me`
    - Validate inputs with shared Zod schemas, hash with Argon2id, issue session token on success, return 409 `email_in_use` on duplicate (DB unique violation translated)
    - On logout, set `revoked_at = now()` on the session row
    - _Requirements: R6.1, R6.2, R6.3, R6.4, R6.5, R6.6, R6.8, R6.9_
  - [x] 6.4 Implement Redis-backed lockout counter and lock
    - Create `apps/api/src/services/auth/lockout.ts` with `recordFailure(userId)`, `isLocked(userId)`, `clearOnSuccess(userId)`
    - Use Redis keys `lockout:{userId}` (15-minute sliding window, 5 failures threshold) and `locked:{userId}` (15-minute TTL); reject all logins while `locked:{userId}` exists
    - _Requirements: R6.7_
  - [x] 6.5 Implement profile and avatar endpoints with magic-byte sniffing
    - Add `PATCH /me/profile` (display name update, validates trimmed 1-50)
    - Add `PUT /me/profile/avatar` (multipart, max 5 MB, sniff magic bytes for PNG `89 50 4E 47` and JPEG `FF D8 FF`; reject mismatch)
    - Add `GET /users/{userId}/profile` enforcing owner-or-friend authorization with no analytics record on deny
    - Wire `apps/api/src/services/auth/avatarStore.ts` to upload to S3-compatible bucket using `@aws-sdk/client-s3` (endpoint URL is config-driven; no provider name in code)
    - _Requirements: R7.1, R7.2, R7.3, R7.4, R7.5, R7.6, R7.7, R7.8_
  - [x] 6.6 Write property test for registration validator
    - **Property 12: Registration input validator**
    - **Validates: Requirements 6.4**
    - File: `apps/api/src/services/auth/__tests__/registration.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 12: registration accepts iff email/displayName/password all valid`
    - `numRuns: 100`
  - [x] 6.7 Write property test for email uniqueness
    - **Property 13: Email uniqueness across all User accounts**
    - **Validates: Requirements 6.2, 6.3**
    - File: `apps/api/src/services/auth/__tests__/emailUniqueness.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 13: emails are unique under case-insensitive equality`
    - `numRuns: 100`
  - [x] 6.8 Write property test for session lifecycle and authorization
    - **Property 14: Session lifecycle and authorization**
    - **Validates: Requirements 6.5, 6.8, 6.9, 6.10, 6.12**
    - File: `apps/api/src/services/auth/__tests__/session.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 14: a request is authorized iff the session is non-revoked, within absolute and idle TTLs`
    - Use `fast-check`'s `commands` API over an injected clock
    - `numRuns: 100`
  - [x] 6.9 Write property test for lockout window
    - **Property 15: Lockout window over login attempt sequences**
    - **Validates: Requirements 6.7**
    - File: `apps/api/src/services/auth/__tests__/lockout.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 15: lockout fires iff 5+ failures in trailing 15-minute window and 15 min not elapsed`
    - `numRuns: 100`
  - [x] 6.10 Write property test for plaintext password absence
    - **Property 16: Password is never stored or transmitted in plaintext**
    - **Validates: Requirements 6.11**
    - File: `apps/api/src/services/auth/__tests__/noPlaintext.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 16: plaintext password never appears in any DB row, log entry, or response body`
    - Generate random passwords, register, then scan all DB rows, captured logs, and HTTP response bodies for the literal password string
    - `numRuns: 100`
  - [x] 6.11 Write property test for display-name validator
    - **Property 17: Display-name validator preserves prior on rejection**
    - **Validates: Requirements 7.2, 7.5, 7.6**
    - File: `apps/api/src/services/auth/__tests__/displayName.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 17: display-name update accepted iff trimmed length in 1..50 with non-whitespace`
    - `numRuns: 100`
  - [x] 6.12 Write property test for avatar validator
    - **Property 18: Avatar validator preserves prior on rejection**
    - **Validates: Requirements 7.3, 7.7**
    - File: `apps/api/src/services/auth/__tests__/avatar.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 18: avatar accepted iff PNG/JPEG by magic-byte sniff and size <= 5 MB`
    - Generate random byte buffers and claimed content types including type-confusion attempts
    - `numRuns: 100`
  - [x] 6.13 Write property test for profile authorization and render
    - **Property 19: Profile authorization and render**
    - **Validates: Requirements 7.4, 7.8**
    - File: `apps/api/src/services/auth/__tests__/profileAuth.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 19: profile visible iff viewer is owner or accepted friend; no analytics on deny`
    - Assert no audit/analytics record is written on deny
    - `numRuns: 100`

- [x] 7. Friends_Service implementation (server side, pure helpers first)
  - [x] 7.1 Implement canonical friendship pair function
    - Create `apps/api/src/services/friends/canonicalPair.ts` exporting `pair(a, b) -> { lo, hi }` such that `lo < hi` lexicographically
    - _Requirements: R8.6_
  - [x] 7.2 Implement Friends repository, routes, and validation
    - Add `apps/api/src/services/friends/repo.ts` with `searchUsers`, `sendRequest`, `acceptRequest`, `declineRequest`, `removeFriend`, `listFriendsAndRequests`
    - Add `apps/api/src/services/friends/routes.ts` with `GET /users/search`, `POST /me/friend-requests`, `POST /me/friend-requests/:id/accept`, `POST /me/friend-requests/:id/decline`, `GET /me/friends`, `DELETE /me/friends/:userId`
    - Reject self-target, unknown recipient, duplicate request/friendship, and missing friendship on remove with the correct error codes
    - _Requirements: R8.1, R8.2, R8.3, R8.4, R8.5, R8.6, R8.7, R8.8, R8.9, R8.10, R8.11_
  - [x] 7.3 Write property test for user search
    - **Property 20: User search returns substring matches with size, scope, and self-exclusion**
    - **Validates: Requirements 8.1**
    - File: `apps/api/src/services/friends/__tests__/search.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 20: search returns case-insensitive substring matches over population minus requester, capped at 50`
    - `numRuns: 100`
  - [x] 7.4 Write property test for friend-graph state machine
    - **Property 21: Friend-graph state machine**
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11**
    - File: `apps/api/src/services/friends/__tests__/graph.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 21: friend-graph operations preserve symmetry, no-self, request and friendship invariants`
    - Use `fast-check`'s `commands` API
    - `numRuns: 100`

- [x] 8. Aggregate_Ratings_Service and leaderboard
  - [x] 8.1 Implement incremental `updateMeanX10(prevSum, prevCount, oldValue, newValue)` pure function
    - Create `apps/api/src/services/aggregate/updateMeanX10.ts` returning the new `(sum, count, meanX10)` triple where `meanX10 = count >= 3 ? roundHalfUp(sum * 10 / count) : null`
    - _Requirements: R10.1, R10.2, R10.8, R10.9_
  - [x] 8.2 Write property test for incremental aggregate vs reference recompute
    - **Property 26: Aggregate rating correctness, threshold gating, and privacy**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8, 10.9, 10.10**
    - File: `apps/api/src/services/aggregate/__tests__/aggregate.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 26: incremental mean_x10 equals reference recompute and threshold/privacy hold`
    - Run sequences of set/replace/remove events, compare `updateMeanX10` chained with each event against a from-scratch recompute over the resulting raw set; also assert the response shape contains only `value` and `count`
    - `numRuns: 100`
  - [x] 8.3 Implement aggregate repo and BullMQ recompute worker
    - Add `apps/api/src/services/aggregate/repo.ts` (UPSERT with advisory lock per experience)
    - Add `apps/api/src/services/aggregate/worker.ts` consuming a `RatingChanged` queue, applying `updateMeanX10` within a transaction
    - Add a periodic reconciler job that recomputes from raw `ratings` rows for drift detection
    - _Requirements: R10.7_
  - [x] 8.4 Implement aggregate routes
    - Add `GET /experiences/:id/aggregate-rating` returning `{ value: number | null, count: number }`; never returning another user's individual rating
    - _Requirements: R10.3, R10.4, R10.5, R10.6, R10.10_
  - [x] 8.5 Implement highest-rated leaderboard with Redis 5-minute cache
    - Add `apps/api/src/services/aggregate/leaderboard.ts` with a SQL query ordering by `mean_x10 DESC, count_ratings DESC, lower(name) ASC` filtered by `experiences.active AND count_ratings >= 3`, limit 10
    - Cache result under Redis key `highest-rated:v1` with 5-minute TTL; serve cached payload when fresh
    - Add `GET /home/highest-rated` route
    - _Requirements: R11.2, R11.3, R11.4, R11.5, R11.7, R11.8, R11.9, R11.10, R11.11_
  - [x] 8.6 Write property test for leaderboard ordering and content
    - **Property 27: Highest-rated leaderboard ordering and content**
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.10, 11.11**
    - File: `apps/api/src/services/aggregate/__tests__/leaderboard.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 27: leaderboard equals first 10 of qualifying active experiences in mean,count,name order`
    - `numRuns: 100`
  - [x] 8.7 Write property test for leaderboard cache staleness
    - **Property 28: Leaderboard cache staleness**
    - **Validates: Requirements 11.7, 11.8, 11.9**
    - File: `apps/api/src/services/aggregate/__tests__/cache.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 28: leaderboard refresh count over any 5-minute window is at most 1`
    - Drive a sequence of Home_Screen open events against an injected clock and a fake Redis
    - `numRuns: 100`

- [x] 9. Catalog_Service integration with ThemeParks.wiki
  - [x] 9.1 Implement ThemeParks.wiki HTTP client
    - Create `apps/api/src/services/catalog/themeparks.ts` with typed wrappers `getDestinations()` and `getEntityChildren(id)` using `undici` or `fetch`
    - Honor base URL from config; default `https://api.themeparks.wiki/v1`
    - Translate any HTTP error to a typed `UpstreamError`
    - _Requirements: R1.1, R1.2_
  - [x] 9.2 Implement Catalog repo
    - Create `apps/api/src/services/catalog/repo.ts` with `getCacheAge`, `applyReconciliation`, `recordSyncRun`, `listActiveExperiences(filters)`, `getExperience(id)`
    - Apply soft-delete (`active = false`) preserving FK references
    - Strip HTML/script content from `description` before persisting
    - _Requirements: R1.7, R1.9, R1.13, R1.14, R1.15, R1.16_
  - [x] 9.3 Implement Catalog_Sync orchestrator
    - Create `apps/api/src/services/catalog/sync.ts` exposing `runSync(options)` which acquires a Redis NX lock `catalog:sync:lock` (10-minute TTL), fetches destinations, walks WDW children, classifies, reconciles, and writes the result transactionally
    - On upstream failure, record `catalog_sync_runs` with `status=failed` and leave cache unchanged
    - _Requirements: R1.10, R1.13, R1.14, R1.15, R1.16_
  - [x] 9.4 Implement opportunistic 5-second sync race on read
    - In the `GET /catalog` handler, when `cacheAgeHours > 24`, enqueue a sync (or join the running one) and `Promise.race` against a 5-second deadline; on timeout, serve cached data with `staleCache: true`
    - When `cacheAgeHours <= 24`, serve directly from cache
    - When no successful prior cache exists and upstream is unreachable, return 503 `catalog_unavailable`
    - _Requirements: R1.11, R1.12, R1.13, R1.24_
  - [x] 9.5 Implement scheduled BullMQ sync job
    - Create `apps/api/src/services/catalog/scheduler.ts` registering a BullMQ repeatable job that calls `runSync` every 24 hours
    - _Requirements: R1.10_
  - [x] 9.6 Implement Catalog routes
    - Add `GET /catalog?parkId=&category=&q=` returning a flat list of active experiences with stable ordering (server-side filter and sort by `lower(name)` within Park groups)
    - Add `GET /catalog/:experienceId` returning detail (name, Park, Experience_Category, description)
    - _Requirements: R1.17, R1.18, R1.19, R1.20, R1.21, R1.22_
  - [x] 9.7 Write property test for catalog read decision
    - **Property 4: Catalog read decision over cache age and sync outcome**
    - **Validates: Requirements 1.11, 1.12, 1.13**
    - File: `apps/api/src/services/catalog/__tests__/readDecision.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 4: catalog read result follows cacheAge x syncOutcome x latency rule`
    - Generate `(cacheAgeHours, syncLatencyMs, syncOutcome)` triples; mock both the sync subsystem and clock
    - `numRuns: 100`
  - [x] 9.8 Write property test for catalog presentation
    - **Property 6: Catalog presentation respects grouping, ordering, filters, and search**
    - **Validates: Requirements 1.17, 1.18, 1.19, 1.20, 1.21**
    - File: `apps/api/src/services/catalog/__tests__/presentation.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 6: rendered catalog equals filtered active subset grouped by Park, sorted by lower(name)`
    - `numRuns: 100`
  - [x] 9.9 Write integration test against a recorded ThemeParks.wiki fixture
    - Create `apps/api/src/services/catalog/__tests__/themeparks.integration.test.ts`
    - Save a captured `/destinations` and `/entity/{wdwId}/children` JSON under `apps/api/src/services/catalog/__fixtures__/themeparks/`
    - Drive the sync end-to-end against the fixture and assert the resulting `experiences` rows
    - _Requirements: R1.1, R1.10_

- [x] 10. Tracking_Service (Completion, Rating, Note)
  - [x] 10.1 Implement Completion repo and routes
    - Create `apps/api/src/services/tracking/completion/repo.ts` and `routes.ts`
    - `PUT /me/experiences/:id/completion` (mark with date in user TZ; reject future date), `PATCH` (edit date; reject future date; reject combined unmark+edit), `DELETE` (404 if missing)
    - Validate user-supplied IANA TZ and local ISO date against `today_in_user_tz`
    - _Requirements: R2.1, R2.2, R2.3, R2.5, R2.6, R2.7, R2.8_
  - [x] 10.2 Implement Rating repo and routes
    - Create `apps/api/src/services/tracking/rating/repo.ts` and `routes.ts`
    - `PUT /me/experiences/:id/rating` (UPSERT, integer 1..10), `DELETE` (404 if missing)
    - On every write or delete, emit a domain event `RatingChanged{experienceId, oldValue, newValue}`
    - _Requirements: R4.1, R4.2, R4.3, R4.4, R4.7, R4.8_
  - [x] 10.3 Implement Note repo and routes
    - Create `apps/api/src/services/tracking/note/repo.ts` and `routes.ts`
    - `PUT /me/experiences/:id/note` (1..2000 trimmed; reject whitespace-only), `DELETE` (404 if missing)
    - _Requirements: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.7, R5.10_
  - [x] 10.4 Wire RatingChanged events to the BullMQ recompute queue
    - In `rating/repo.ts`, after a successful UPSERT or DELETE, enqueue a `RatingChanged` job; the worker is the one wired in 8.3
    - _Requirements: R10.7, R10.8, R10.9_
  - [x] 10.5 Write property test for completion state machine
    - **Property 7: Completion state machine and cardinality**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 2.8**
    - File: `apps/api/src/services/tracking/completion/__tests__/completion.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 7: completion state machine has at most one completion and rejects future or combined ops`
    - Use `fast-check`'s `commands` API
    - `numRuns: 100`
  - [x] 10.6 Write property test for rating state machine
    - **Property 10: Rating state machine and validator**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
    - File: `apps/api/src/services/tracking/rating/__tests__/rating.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 10: rating state has at most one entry, validates 1..10 integers, replaces and removes correctly`
    - `numRuns: 100`
  - [x] 10.7 Write property test for note state machine
    - **Property 11: Note state machine and validator**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9, 5.10**
    - File: `apps/api/src/services/tracking/note/__tests__/note.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 11: note state machine validates trimmed 1..2000 and replaces/deletes correctly`
    - `numRuns: 100`

- [x] 11. Stats_Service routes
  - [x] 11.1 Implement stats query and routes
    - Create `apps/api/src/services/stats/repo.ts` running a single transaction snapshot that returns the four denominators and four numerators
    - Add `GET /me/stats` and `GET /me/stats/summary?for=<userId>` (owner-or-friend)
    - Use `computePercent` from 5.1 for every percentage
    - _Requirements: R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R3.8, R7.4_

- [x] 12. Sharing_Service
  - [x] 12.1 Implement Sharing repo and routes
    - Create `apps/api/src/services/sharing/repo.ts` with `createShareAtomic(senderId, recipientIds, payload)` performing the design's transaction (validate 1..50, fetch friendships in one query, abort if any recipient missing, otherwise insert one `shares` row + N `share_recipients` rows)
    - Add `apps/api/src/services/sharing/routes.ts` with `POST /me/shares`, `GET /me/inbox` (unopened entries reveal only `shareId, isOpened: false` plus unread count), `POST /me/inbox/:shareId/open`, `DELETE /me/inbox/:shareId` (recipient soft-delete only)
    - Compose payload per `SharePayloadKind`: include rating only when present, otherwise include rating-unavailable notice; include note truncated to 2000 chars; for `progress`, include overall + per-Park + per-category percentages capped at 100.0
    - _Requirements: R9.1, R9.2, R9.3, R9.4, R9.5, R9.6, R9.7, R9.8, R9.9, R9.10_
  - [x] 12.2 Write property test for share atomic delivery
    - **Property 22: Share atomic delivery**
    - **Validates: Requirements 9.1, 9.3**
    - File: `apps/api/src/services/sharing/__tests__/atomic.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 22: a share is created and one delivery row inserted per recipient iff every recipient is a friend at request time`
    - `numRuns: 100`
  - [x] 12.3 Write property test for share payload composition
    - **Property 23: Share payload composition**
    - **Validates: Requirements 9.4, 9.5, 9.6, 9.7**
    - File: `apps/api/src/services/sharing/__tests__/payload.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 23: delivered payload contains rating, note (<=2000), or capped progress percentages per share kind`
    - `numRuns: 100`
  - [x] 12.4 Write property test for inbox disclosure
    - **Property 24: Inbox disclosure depends on opened state**
    - **Validates: Requirements 9.8, 9.9**
    - File: `apps/api/src/services/sharing/__tests__/inbox.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 24: inbox preview reveals sender/content/timestamp iff opened_at is set`
    - `numRuns: 100`
  - [x] 12.5 Write property test for recipient deletion independence
    - **Property 25: Recipient deletion independence**
    - **Validates: Requirements 9.10**
    - File: `apps/api/src/services/sharing/__tests__/recipientDelete.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 25: recipient deletion removes only that recipient row, leaving sender and other recipients unchanged`
    - `numRuns: 100`

- [x] 13. Backend cross-cutting: smoke perf, rate limits, metrics
  - [x] 13.1 Implement smoke test harness
    - Create `apps/api/test/smoke/harness.ts` that spins up the API against a seeded Postgres + Redis with N users, M experiences, K ratings, and produces wall-clock latency for representative scenarios
    - _Requirements: foundation for SLAs_
  - [x] 13.2 Implement smoke perf SLA tests
    - File: `apps/api/test/smoke/slas.smoke.test.ts`
    - Assert wall-clock budgets:
      - `GET /me/stats` ≤ 2s (R3.4, R3.5)
      - `PUT /me/experiences/:id/note` and `GET /me/experiences/:id/note` ≤ 2s (R5.8, R5.9)
      - `POST /auth/register` and `POST /auth/login` ≤ 2s (R6.1, R6.5)
      - Aggregate-rating recompute end-to-end ≤ 60s (R10.7)
      - `GET /home/highest-rated` ≤ 2s on warm cache (R11)
    - _Requirements: R3.4, R3.5, R5.8, R5.9, R6.1, R6.5, R10.7, R11_
  - [x] 13.3 Wire gateway-level rate limits
    - Add `@fastify/rate-limit` with route-group config: 60 rpm/user reads, 10 rpm/user mutations, 5 attempts/15 min/account on `/auth/login` (account-keyed); ensure account lockout (R6.7) is enforced after the rate limiter so floods cannot bypass lockout
    - _Requirements: R6.7 (defense in depth)_
  - [x] 13.4 Wire request_id, structured logging, and latency metrics
    - Add `apps/api/src/observability/requestId.ts` injecting/propagating a request_id header
    - Emit per-mutation domain events with `(request_id, user_id, action, target_id, outcome)`
    - Expose Prometheus-style latency histograms for `/me/stats`, aggregate-recompute, and share delivery; alert thresholds left as comments
    - _Requirements: R6.11 (redaction), observability section of design_

- [x] 14. Mobile app bootstrap
  - [x] 14.1 Initialize the React Native + TypeScript app (Expo bare workflow)
    - `apps/mobile` using `expo-cli` template with TypeScript
    - Add `react-navigation` (native stack + bottom tabs), `zustand` (or Redux Toolkit) for state, `react-query` for server state, `expo-secure-store` for session token, `expo-image-picker` for avatar upload
    - Configure path alias to `@dwt/shared`
    - _Requirements: foundation_
  - [x] 14.2 Implement API client and session storage
    - Create `apps/mobile/src/api/client.ts` wrapping `fetch` with base URL from `app.config.ts`, attaching `Authorization: Bearer <token>` from secure storage, parsing the uniform error envelope into typed `ApiError`
    - On 401, clear secure storage and route to login (R6.10)
    - _Requirements: R6.10_
  - [x] 14.3 Implement navigation shell and protected routes
    - Create `apps/mobile/src/navigation/RootNavigator.tsx` with auth stack (Register, Login) and main tabs (Home, Catalog, Stats, Friends, Profile)
    - Gate the main tabs on a valid session
    - _Requirements: R6.10_

- [x] 15. Mobile auth and profile
  - [x] 15.1 Implement Register and Login screens
    - Files: `apps/mobile/src/screens/auth/RegisterScreen.tsx`, `LoginScreen.tsx`
    - Use shared Zod schemas for client-side validation; surface `validation_failed`, `email_in_use`, `invalid_credentials`, `account_locked` from the error envelope
    - On success, store session token in secure storage and navigate to Home
    - _Requirements: R6.1, R6.3, R6.4, R6.5, R6.6, R6.7_
  - [x] 15.2 Implement Profile view and edit screen
    - File: `apps/mobile/src/screens/profile/ProfileScreen.tsx`
    - Display name, avatar, overall completion percentage; edit display name with shared schema; show `display_name_invalid` errors
    - When viewing another user, hide UI on `profile_forbidden`
    - _Requirements: R7.1, R7.2, R7.4, R7.6, R7.8_
  - [x] 15.3 Implement avatar upload
    - Use `expo-image-picker` to capture or pick PNG/JPEG up to 5 MB
    - Validate format and size client-side before upload; show `avatar_invalid` from server on rejection
    - _Requirements: R7.3, R7.7_

- [x] 16. Mobile catalog
  - [x] 16.1 Implement Catalog list screen with Park grouping and category/park filters
    - File: `apps/mobile/src/screens/catalog/CatalogScreen.tsx`
    - Group by Park, sort by `lower(name)` within group; honor server-side filters via query params; cache via `react-query` for 5 minutes
    - Surface `staleCache: true` from response with a small banner; display `catalog_unavailable` error state when no prior cache
    - _Requirements: R1.13, R1.17, R1.18, R1.19, R1.22, R1.24_
  - [x] 16.2 Implement search input and combined filter+search behavior
    - Trim query, require at least one non-whitespace character before issuing the request
    - Empty-state when zero matches: "No Experiences match your filters and search."
    - _Requirements: R1.20, R1.21, R1.23_
  - [x] 16.3 Implement Experience detail screen
    - File: `apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx`
    - Show name, Park, category, description, completion indicator + date or empty state, rating + empty state, note + empty state, aggregate rating + count or empty state for `count < 3`
    - _Requirements: R1.22, R2.4, R4.5, R4.6, R5.8, R5.9, R10.5, R10.6_

- [x] 17. Mobile tracking and stats
  - [x] 17.1 Implement Completion mark/unmark/edit-date UI
    - Files: `apps/mobile/src/screens/catalog/CompletionControls.tsx`
    - Disable future dates in the date picker; surface `completion_future_date`, `completion_not_found`, `completion_combined_op_not_allowed` errors
    - _Requirements: R2.1, R2.2, R2.4, R2.5, R2.6, R2.7, R2.8_
  - [x] 17.2 Implement Rating UI (1..10 picker)
    - File: `apps/mobile/src/screens/catalog/RatingControl.tsx`
    - Set, replace, remove; integer-only picker; show `rating_out_of_range` only on server rejection (defensive)
    - _Requirements: R4.1, R4.3, R4.4, R4.5, R4.6, R4.7, R4.8_
  - [x] 17.3 Implement Note UI (save/edit/delete)
    - File: `apps/mobile/src/screens/catalog/NoteControl.tsx`
    - Trim and validate length client-side; surface `note_length_invalid`, `note_not_found`
    - _Requirements: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R5.7, R5.8, R5.9, R5.10_
  - [x] 17.4 Implement Stats screen
    - File: `apps/mobile/src/screens/stats/StatsScreen.tsx`
    - Display overall + per-Park + per-Experience_Category percentages with completed/total counts to one decimal
    - _Requirements: R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R3.8_

- [x] 18. Mobile friends and sharing
  - [x] 18.1 Implement Friends screens (search/list/requests)
    - Files: `apps/mobile/src/screens/friends/FriendsListScreen.tsx`, `FriendsSearchScreen.tsx`
    - Search 1..100 chars; show pending incoming/outgoing; accept/decline/remove
    - Map error codes to UI messages
    - _Requirements: R8.1, R8.2, R8.3, R8.4, R8.5, R8.6, R8.7, R8.8, R8.9, R8.10, R8.11_
  - [x] 18.2 Implement Share-send UI
    - File: `apps/mobile/src/screens/share/ShareComposerScreen.tsx`
    - Pick 1..50 friends, choose payload (Experience or progress, optional rating/note); reject empty list and over-50 client-side
    - Surface `share_recipient_count_invalid`, `share_atomic_rejected` from server
    - _Requirements: R9.1, R9.2, R9.3, R9.4, R9.5, R9.6, R9.7_
  - [x] 18.3 Implement Inbox UI (unopened, open, delete)
    - File: `apps/mobile/src/screens/share/InboxScreen.tsx`
    - Unopened entries reveal only an unopened indicator and unread count; opening reveals sender, content, timestamp; recipient delete is local to the recipient
    - _Requirements: R9.8, R9.9, R9.10_

- [x] 19. Mobile Home screen with leaderboard
  - [x] 19.1 Implement Home screen Highest-Rated section
    - File: `apps/mobile/src/screens/home/HomeScreen.tsx`
    - Fetch `GET /home/highest-rated`; cache locally for 5 minutes; refresh if cache age >= 5 min; otherwise serve cached
    - Display name, Park, category, mean to one decimal, count
    - Tapping an entry opens the corresponding Experience detail
    - Empty state when zero qualifying; in empty state, ignore tap gestures within the section
    - _Requirements: R11.1, R11.2, R11.3, R11.4, R11.5, R11.6, R11.7, R11.8, R11.9, R11.10, R11.11, R11.12_

- [x] 20. Mobile tests and final checkpoint
  - [x] 20.1 Write React Native Testing Library navigation tests
    - File: `apps/mobile/src/__tests__/navigation.test.tsx`
    - Tap a leaderboard entry navigates to detail (R11.6); tap on empty-state leaderboard does not navigate (R11.12); 401 from API routes back to Login (R6.10)
    - _Requirements: R6.10, R11.6, R11.12_
  - [x] 20.2 Write empty-state snapshot tests
    - File: `apps/mobile/src/__tests__/emptyStates.test.tsx`
    - Catalog zero matches (R1.23), catalog unavailable (R1.24), aggregate count<3 (R10.6), leaderboard zero qualifying (R11.11), no rating (R4.6), no note (R5.9)
    - _Requirements: R1.23, R1.24, R4.6, R5.9, R10.6, R11.11_
  - [x] 20.3 Write property tests for mobile-side validators
    - **Property 8: Completion render matches stored state**
    - **Validates: Requirements 2.4**
    - File: `apps/mobile/src/screens/catalog/__tests__/completionRender.prop.test.tsx`
    - Tag header: `// Feature: disney-world-tracker, Property 8: rendered indicator/date matches stored completion state`
    - Generate `(present, date) | absent` states and assert the rendered output via React Native Testing Library
    - `numRuns: 100`

- [x] 21. Final checkpoint
  - Ensure all backend and mobile tests pass; ensure migrations apply cleanly on a fresh Postgres; ensure the API smoke perf SLAs are within budget; ask the user if questions arise.

- [x] 22. Experience Images
  > Added after the original plan was written. The Experience Images feature (Requirement 12, design Property 29 and the "Image survival across sync" / Image_Sourcing_Job sections) was implemented out of band because ThemeParks.wiki exposes no imagery. These tasks record the work as completed.
  - [x] 22.1 Add image columns to the experiences schema
    - Create `apps/api/migrations/0002_experience_images.sql` adding nullable `image_url` (CHECK length 1..2048) and `image_attribution` (CHECK length 1..1000) columns to `experiences`
    - Columns are absent (NULL) until populated out of band by the Image_Sourcing_Job
    - _Requirements: R12.1, R12.2_
  - [x] 22.2 Persist and map image fields in the Catalog repo so sourced images survive sync
    - In `apps/api/src/services/catalog/repo.ts`, exclude `image_url` and `image_attribution` from the `applyReconciliation` `INSERT ... ON CONFLICT (id) DO UPDATE SET` list so a curated/sourced image survives every catalog refresh untouched, and so brand-new upstream rows are inserted with both image fields NULL
    - Extend `listActiveExperiences` and `getExperience` to SELECT `image_url` / `image_attribution`; `rowToDto` maps them to `imageUrl` / `imageAttribution`
    - Carry `imageUrl: string | null` and `imageAttribution: string | null` on the shared `ExperienceDTO`
    - _Requirements: R12.3, R12.4, R12.20_
  - [x] 22.3 Return image fields from the Catalog routes
    - In `apps/api/src/services/catalog/routes.ts`, `GET /catalog` (browse list) and `GET /catalog/:experienceId` (detail) both return `imageUrl` and `imageAttribution` for every Experience (null when unsourced)
    - _Requirements: R12.21, R12.22_
  - [x] 22.4 Implement the Image_Sourcing_Job (`source-images`)
    - Create `apps/api/src/scripts/sourceImages.ts` as a standalone job (run via `npm run source-images`) that runs independently of Catalog_Sync
    - Layered resolution, first hit wins: curated override → confident Wikipedia lead-image match → confident Wikimedia Commons photo match → opt-in park-level fallback → leave NULL
    - Confident-match heuristic: Jaccard token similarity `>= 0.5` OR meaningful-token subset, with a distinctiveness guard against single short generic tokens
    - Commons filter accepts only raster photos (`.jpg/.jpeg/.png/.webp`); rejects SVG, PDF, audio, video
    - Run modes: default (active rows where `image_url IS NULL`), `--force` (re-source all active rows), `--dry-run` (report only, write nothing), `--park-fallback`, `--overrides <path>`
    - Process only active rows (`WHERE active = TRUE`); truncate attribution to 1000 characters before storing
    - Wikimedia etiquette: descriptive `User-Agent` from `WIKI_CONTACT`, politeness delay between calls, retry/backoff on HTTP 429/503 honoring `Retry-After`
    - _Requirements: R12.5, R12.6, R12.9, R12.10, R12.11, R12.12, R12.13, R12.14, R12.15, R12.16, R12.17, R12.18, R12.19_
  - [x] 22.5 Add the curated image overrides file
    - Create `apps/api/src/scripts/imageOverrides.json` mapping Experience names to curated image URLs + attribution; matched case-insensitively with punctuation ignored; an override short-circuits all other lookups
    - _Requirements: R12.7, R12.8_
  - [x] 22.6 Add the manual Catalog_Sync trigger script
    - Create `apps/api/src/scripts/runSync.ts` as a one-off manual `Catalog_Sync` trigger (run via `npm run sync`), supporting operational script for refreshing the catalog on demand
    - _Requirements: R1.10_
  - [x] 22.7 Render Experience images on the mobile catalog list and detail screens
    - In `apps/mobile/src/screens/catalog/CatalogScreen.tsx` (`ExperienceThumb`) and `apps/mobile/src/screens/catalog/ExperienceDetailScreen.tsx` (`ExperienceHero`), render the sourced image and its attribution when `imageUrl` is non-null
    - Fall back to a category-tinted placeholder (with the category glyph) when `imageUrl` is null
    - _Requirements: R12.23, R12.24_
  - [x]* 22.8 Write property test for sourced-image survival across reconciliation
    - **Property 29: Sourced images survive catalog reconciliation**
    - **Validates: Requirements 12.3, 12.4**
    - File: `apps/api/src/services/catalog/__tests__/imageSurvival.prop.test.ts`
    - Tag header: `// Feature: disney-world-tracker, Property 29: sourced image fields survive catalog reconciliation and new rows arrive null`
    - Assert that `image_url` / `image_attribution` on a row with non-null image data are unchanged across any sequence of upsert / soft-delete / re-appearance, and that newly-inserted rows have null image fields
    - `numRuns: 100`

## Notes

- Tasks marked with `*` are optional test sub-tasks. Skipping them speeds up an MVP cut at the cost of correctness coverage; the property tests are how the design's 28 properties are mechanically pinned down.
- Every PBT sub-task carries the tag header `// Feature: disney-world-tracker, Property N: <description>` and uses `fc.assert(prop, { numRuns: 100 })` (or higher).
- Each leaf task references the requirement(s) and property/properties it touches so the dependency graph below can wave-schedule safely.
- The architecture is hosting-agnostic. Provider-specific configuration lives only in `apps/api/src/config.ts` and infra glue, never in service code.
- Checkpoints (tasks 21 and the implicit wave boundaries in the dependency graph) are where the orchestrator should pause for human review before kicking off the next wave.
- "PBT applicability": the design's Correctness Properties section lists 28 properties; every property maps to exactly one optional sub-task in this plan. Non-property criteria (UI navigation, perf SLAs, external HTTP wiring, persistence existence) get the example/integration/smoke tests called out in tasks 9.9, 13.2, 20.1, and 20.2.
- Task group 22 (Experience Images) was added after the original plan was written, capturing the out-of-band imagery feature (Requirement 12, design Property 29). It appears as a final wave (id 18) in the dependency graph. All 22.x sub-tasks, including the Property 29 property test (22.8), are complete.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1", "2.2", "2.3", "3.1", "3.2", "4.1", "4.2", "4.3", "5.1", "7.1", "8.1"] },
    { "id": 2, "tasks": ["4.4", "4.5", "4.6", "4.7", "5.2", "8.2"] },
    { "id": 3, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 4, "tasks": ["6.6", "6.7", "6.8", "6.9", "6.10", "6.11", "6.12", "6.13"] },
    { "id": 5, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5", "9.6"] },
    { "id": 6, "tasks": ["9.7", "9.8", "9.9"] },
    { "id": 7, "tasks": ["10.1", "10.2", "10.3", "10.4", "11.1"] },
    { "id": 8, "tasks": ["10.5", "10.6", "10.7"] },
    { "id": 9, "tasks": ["8.3", "8.4", "8.5", "7.2", "12.1"] },
    { "id": 10, "tasks": ["8.6", "8.7", "7.3", "7.4", "12.2", "12.3", "12.4", "12.5"] },
    { "id": 11, "tasks": ["13.1", "13.2", "13.3", "13.4"] },
    { "id": 12, "tasks": ["14.1", "14.2", "14.3"] },
    { "id": 13, "tasks": ["15.1", "15.2", "15.3"] },
    { "id": 14, "tasks": ["16.1", "16.2", "16.3"] },
    { "id": 15, "tasks": ["17.1", "17.2", "17.3", "17.4"] },
    { "id": 16, "tasks": ["18.1", "18.2", "18.3", "19.1"] },
    { "id": 17, "tasks": ["20.1", "20.2", "20.3"] },
    { "id": 18, "tasks": ["22.1", "22.2", "22.3", "22.4", "22.5", "22.6", "22.7", "22.8"] }
  ]
}
```
