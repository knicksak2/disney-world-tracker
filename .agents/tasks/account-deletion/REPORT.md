# Account deletion: final verification report (tasks.md task 18)

Nothing was committed, staged or pushed. No real env file was edited (`apps/api/.env` and `apps/api/.env.dev` have last-write times of 10/18, before this work; `apps/api/.env.example` is the only env-style file changed, by task 2.1). The pin gate was not run (no catalogue file changed).

## Result

**GREEN.** `npm run verify` from the repository root exited 0 with typecheck clean for `apps/api`, `apps/mobile` and `packages/shared`, and every workspace's tests passing (literal tail at the end of this file). The `apps/api` coverage threshold on `src/services/planning/**` was met and was not touched.

I ran the full gate once. It needed no fixes, so there was no regression from this change to repair.

The two unrelated local modifications (`apps/api/src/db/pool.ts`, `apps/api/src/db/__tests__/pool.test.ts`) are not part of this change. I did not revert or stage them, and they did not cause any red result. Their idle-client "Connection terminated unexpectedly" log noise is expected output, not a failure.

## What was built, per chunk

- **Tasks 1-5 (foundation).**
  - `@dwt/shared`: constants (`DELETE_ACCOUNT_CONFIRMATION_PHRASE`, `DELETED_USER_DISPLAY_NAME`, `isDeletedUserId`), four error codes (`reauth_failed`, `reauth_required`, `account_deletion_confirmation_invalid`, `trip_party_deleted`), five strict Zod schemas, `AuthSessionResponseDTO`.
  - Config namespace `accountDeletion` and the six env vars, plus a cron-secret distinctness rule. `.env.example` and `render.yaml` updated.
  - Migration `0064_account_deletion.sql`: lifecycle columns and CHECKs, the grant, recompute-queue and ledger tables, and the views `profile_identity`, `active_friendships` and `active_trip_memberships`.
  - Pure modules: state machine, owner selection, placeholder id, grant, log id, cron gate, purge plan.
  - Disposition registry with the completeness and cascade audits, share scrub, visibility constants, provider tripwire.
- **Chunk A (6.1-6.6, 7).**
  - Photo soft-delete `limit` extension.
  - `accountDeletion/repo.ts`: grant and request transaction, restore, fenced claim (`FOR UPDATE SKIP LOCKED`), per-trip resolution, stage executors, tombstone, chunked enqueue, finalize and ledger.
  - Whole-purge residual tests over a seeded multi-table graph.
- **Chunk B (8.1, 8.2).** Ports, service (reauth, request, restore), mail templates (`sendDeletionScheduled`, `sendDeletionCancelled`), purge runner (single-flight, time budget, per-account failure handling, best-effort lockout cleanup).
- **Chunk C (9.1-9.4, 10, 11).**
  - Session middleware rejects non-active users and exposes `sessionId`.
  - Reauth and deletion routes, plus the cron route with a login-budget rate limit on reauth.
  - Restore on login, reset-password and the web fallback.
  - Composition wiring, `docs/hosting.md` cron section.
  - Interim-organizer `effectiveRole`.
- **Chunk D (12.1-12.5, 13).**
  - Visibility retrofit of every social, trip, booking, list, photo and money read.
  - `trip_party_deleted` on expense and settlement create or edit.
  - Admin visibility.
  - Three compiler-API structural guards.
- **Chunk E (14.1-14.4, 15).** Session-store notices, `DeleteAccountScreen` (review, password, confirm), entry row, login and register screens, restored-notice banner, `presentPerson`, attention filter and money-screen copy.
- **Chunk F (16, 17).**
  - `photosScope.guard.test.ts`, with `photos.guards.test.ts` untouched.
  - Privacy-policy sections 4 and 5, photos-runbook note, and the two design NIT sentences.

## Data inventory and disposition registry completeness

- `dispositions.ts` has one entry per foreign key to `users(id)`: 70 in total (69 existing plus `account_deletion_reauth_grants.user_id`).
- `dispositions.test.ts` (Property 11) derives every FK from `apps/api/migrations/*.sql` and fails on a missing or an invented column. It asserts the count of 70, so a silent parser regression fails too. It also checks the chunk-key rule.
- The cascade audit (Property 28) is green with the four accepted exemptions. With an empty exemption list it reports exactly those four pairs.
- `repo.stages.test.ts` runs `describe.each` over `DISPOSITIONS`, so a new registry row without a stage test fails.
- `SOFT_REFERENCES` (non-FK references) is disjoint from the FK set.
- Chunk D recorded that every Appendix B visibility row has a pg-mem test, apart from these:
  - Push delivery has no change on the delivery path. Registration deletion in the request transaction is tested in `repo.request.test.ts`.
  - The highest-rated leaderboard has no test.
  - Self reads do not apply.
  - The mobile `useAttention.ts` filter was covered later in task 14.4 (`useAttention.accountDeletion.test.tsx`).

## `photos.guards.test.ts` decision (task 16)

- **Decision:** the file is not edited. It is absent from `git status`.
- **Why:** the guard's premise holds unchanged. It scans `photos/routes.ts`, `photos/foodReadRoutes.ts`, `photos/sweepCronRoute.ts` and `auth/routes.ts` for `/delete-account/i` and `/account\/delete/i`. The new routes live in `accountDeletion/routes.ts` under `/me/account/deletion` and `/internal/account-deletion/`, and neither regex matches `deletion`.
- **Added protection:** `photosScope.guard.test.ts` resolves the route paths in `accountDeletion/routes.ts`. It asserts that they equal the three expected paths, that none is under `/photos`, and that the four scanned files contain neither phrase (comments included). It has a bite test against a synthetic `/photos/...` route.
- **Result:** both files pass together (19 tests) and passed again in the full gate.

## Unchecked or unfinished

| Item | State | Why |
|---|---|---|
| Task 17 (docs and housekeeping) | UNCHECKED | The edits are done, but the Kiro Spec Format validator (diagnostics) is not available to the executor. The 12 spec files were not validator-checked and I do not claim they are clean. A manual regex scan found only `- [ ]` and `- [x]` markers in the files this work touched. The one exception is `disney-world-tracker/tasks.md:730`, `- [x]* 22.8`, which is pre-existing in an unmodified file. That scan is not the validator. |
| 19.1 Add `ACCOUNT_DELETION_CRON_SECRET` to Render | OPEN (manual operator gate) | The service refuses to boot without it. |
| 19.2 Create the cron-job.org entry | OPEN (manual operator gate) | `POST` or `HEAD /internal/account-deletion/purge/run`, `x-cron-secret` header, crontab `35 8,20 * * *`, `America/New_York`. |
| 19.3 Real-Postgres smoke list after first deploy | OPEN (manual operator gate) | Covers tombstone insert casts, the claim statement with `Date` parameters, the six chunked statements, the multi-row enqueue insert and the three `CREATE VIEW` statements. Also watch the Render log for purge `warn` or `error`. |
| Apple token revocation | NOT IMPLEMENTED, by design, not faked | Sign-in is email and password only (R13.1). No Apple or provider credentials exist, and no revoke stub is written (R13.2). `providerTripwire.guard.test.ts` fails if Apple or Google sign-in, `appleid.apple.com`, or an `apple_sub`, `provider` or `oauth` column on `users` is ever added. |
| Parent lines 8, 9, 12, 14 in `tasks.md` | Still show `[ ]` | Every sub-task under each is `[x]`. The chunks left the parent lines for the orchestrator, and I did not change them. |
| Google Play web deletion URL | Out of scope | Follow-up work. |

Review decisions flagged earlier and left as they were. They need a product decision if you want them changed:
- Promoting the interim organizer answers `trip_role_invalid`.
- A guest add or rename under a pending sponsor is still accepted.
- Reset and web-fallback lookups with no `accountRestore` port admit a pending-in-grace account. Production always wires the port, and an `error` is logged at registration if it is missing.
- The review step shows no day count. The confirm step shows the server's `graceDays` (R1.16).

One chunk C scoped-gate run exited 1 once (`1 failed | 4057 passed`) and the failing test name was not captured. Two later runs, and this final full run, passed. I could not identify the failure. If it reappears, run with `--reporter=dot` to capture the name.

## Unverified (no test here can show these)

- **Apple token revocation against the real service.** It does not exist (see above).
- **Postgres behavior that pg-mem cannot exercise.**
  - Real concurrent `FOR UPDATE SKIP LOCKED`, locking, and the deadlock path with `departMember`.
  - Restore-versus-claim with two real connections. It is tested with a wrapped port and sequential state only.
  - The claim's `id = ANY(ARRAY(... FOR UPDATE SKIP LOCKED))` form. pg-mem ran a helper's materialized rewrite of the `IN` form.
  - Postgres parameter typing of the tombstone insert and of `$4::int`.
  - Real planning of the six composite-key `per_key` statements, the multi-row enqueue `VALUES`, the new visibility joins, the `LEFT JOIN users` photo queries, `ANY($1::uuid[])`, and the `EXISTS` select-list in `lockMemberRole`.
  - `completeReset`'s transaction under concurrency.
  - The `JOIN users` session query on the real pool.
  - pg-mem needed shims for correlated sub-selects, `to_char`, `NULLIF`, `ESCAPE '\'` and `unnest` in some visibility tests. Only the harness is shimmed; the SQL under test is unchanged.
- **Real-Postgres smoke list (task 19.3).** It has not been run. Chunk D suggests adding a gallery read, an inbox read and a net-balance read with a pending account to it.
- **Cron-job.org schedule, Render cold starts, Neon under load.** No test exercises them.
- **Composed app.** `wiring.test.ts` scans the source of `composeServices.ts`. Nothing runs `buildApp`, which needs Redis and a pool.
- **A real mail send.** Mail tests inject `sendFn`.
- **Mobile.** No device or screen-reader run: `announceForAccessibility` is asserted through a spy. The restored banner's safe-area top inset is unverified on a notch device. No run against a real API.
- **Privacy-policy facts.** The 30-day figure is the config default, not the deployed value. No backup retention period is stated because none was verified.
- **Pre-existing quirk, out of scope.** `computePairwiseBalances` de-duplicates events by `(pair, expense)`. An expense with two shares resolving to the same person loses one.

A green `npm run verify` proves nothing is broken. It does not prove the behaviors above are covered; the map below is that check.

## Behavior to test map

The foundation rows (tasks 1-5) come from tasks.md and the test files it names. All of them ran green in the full gate. The assertions for chunks A-F were recorded by those chunks in `code-status.md` and were not re-read test by test in this step.

### Foundation (tasks 1-5)

| Behavior | Test file | Assertion that would fail if wrong |
|---|---|---|
| Schemas strict | `packages/shared/src/__tests__/accountDeletion.test.ts` | `accountRestored: false`, a 129-char password and an unknown key are rejected. `accountRestored: true` and absent are valid. |
| Error codes and statuses | same file | The four codes map to their statuses. No new code maps to 401. |
| `isDeletedUserId` | same file | True for a `deadc0de-` UUID. False for a v4 UUID and for `Deleted user`. |
| Config defaults and rejections; secret distinctness (Property 23) | `config.accountDeletion.prop.test.ts` | Defaults hold. `0` and non-integers are rejected. The secret must differ from the sampling, pin-reconcile and trip-booking secrets, and from `PHOTOS_CRON_SECRET` only when non-blank. |
| Admin config page never renders the cron secret | `admin/__tests__/configSecrets.test.ts` | Sentinel secret absent from the page. |
| Migration columns, CHECKs, indexes, views, grants, reapply | `db/__tests__/migration0064.test.ts` | Each CHECK rejects an invalid row. Views hide pending and tombstone users. `profile_identity`'s literal equals `DELETED_USER_DISPLAY_NAME`. Reapply is a no-op. |
| State machine, owner selection, placeholder id, log id | `deletionState`, `ownerSelection`, `placeholderId`, `logId` `.prop.test.ts` files | Fast-check, at least 100 runs, tagged. `logId` gives 12 lowercase hex, stable, different by key and by user. |
| Cron gate, grant, purge plan | `cronGate`, `reauthGrant`, `purgePlan` `.test.ts` | Mismatch, empty and non-string inputs are false. |
| Registry completeness and cascade audit | `dispositions.test.ts` | FK count is 70. Missing or invented columns fail. The cascade audit with no exemptions reports exactly the four pairs. |
| Share scrub | `scrub.prop.test.ts` | Nothing but the owner and sharer fields changes. Idempotent. No original name or id survives. |
| Provider tripwire | `providerTripwire.guard.test.ts` | Fails on Apple or Google sign-in packages, `appleid.apple.com`, or an `apple_sub`, `provider` or `oauth` column. |

### Chunk A (repository)

| Behavior | Test file | Assertion |
|---|---|---|
| Photo soft-delete `limit` | `photos/__tests__/repo.test.ts` | Call sizes are `[4,4,2]`, the default call marks all 9, and a limit of 0 or 1.5 throws `RangeError`. |
| Grant: replace-on-issue, single use, user- and session-bound, strict expiry | `repo.request.test.ts` | A wrong user, a wrong session or an expired grant is not consumed. A second issue replaces the first. |
| Request effects (Property 6) | same file | The hash of every table except the allowed ones is identical before and after. Sessions are revoked. Reset tokens are expired. |
| Restore boundary | same file | Restore wins one millisecond before `scheduled_purge_at` and not at it. |
| Claim is one fenced `SKIP LOCKED` statement | `repo.claim.test.ts` | The SQL text contains `FOR UPDATE SKIP LOCKED`. A second claim returns nothing. Stale and released claims are re-claimed with the stage kept. |
| Fencing | same file | A write with a stale or absent claim leaves the user row byte-identical. |
| Failure and attempts (Property 31) | same file | A thrown stage adds 1 and releases the claim. A `refs_remain` write is absolute. The count saturates at 32767. A fresh account is claimed ahead of failing ones. |
| Trip resolution (Properties 9, 30) | `repo.trips.test.ts` | Transfer goes to the highest role, ties to the earliest joined. A sole member's trip is deleted with photos marked `deleted` on the transaction client. A roster change between lock and plan keeps the trip. A fenced claim rolls back. |
| Every registry row's stage | `repo.stages.test.ts` | Per row: the action applies, the bystander row is untouched, and a second pass changes 0 rows. |
| Retained `experience_logs` | same file | They are re-pointed to the tombstone with the note blanked. |
| Photos stage | same file | Photos are counted and owner-nulled in chunks `[50,50,25]`. `listDeleted` still returns them. |
| Share scrub stage and idempotence (Property 14) | same file | Scrub is selected by sender or tombstone. A second run writes nothing. |
| Tombstone statement | `repo.tombstone.test.ts` | Two parameters, each used once, with casts, no `\|\|`. A rerun is a no-op. |
| Chunked enqueue | `repo.enqueue.test.ts` | 150 distinct ids are queued in pages of at most `CHUNK_ROWS`. Enqueue precedes the first `ratings` delete. A restart adds no duplicates. |
| Finalize and ledger (Property 33) | `repo.finalize.test.ts` | A remaining reference gives `refs_remain` and no change. The ledger row has no identifying column. The ledger is pruned to 1000. The freed email can register. |
| Whole purge (Properties 21, 26, 13, 17) | `repo.purge.residual.test.ts` | The id, email, name and avatar are absent from every table after the purge. Net balances are preserved and sum to zero. Photo report counts are unchanged. No bounded statement exceeds `CHUNK_ROWS`. |

### Chunk B (service and runner)

| Behavior | Test file | Assertion |
|---|---|---|
| Reauth order and lockout | `service.test.ts` | A locked account gets calls exactly `['lockout.isLocked']`. A wrong password gives `[isLocked, getPasswordHash, verify, recordFailure]`. `clearOnSuccess` is never called. |
| Phrase exactness (Property 5) | same file, fast-check 100 runs | Accepted iff `s.trim() === 'DELETE'`, and a rejection never reaches the repo. |
| One purge date (Property 3) | same file | The stored value, the response and the mail receive the same `Date`. |
| Mail failure and logs | same file | The request still resolves. The warning carries no recipient and no user id. |
| Mail content | `mailService.accountDeletion.test.ts` | The scheduled mail shows the New York date and zone (`EDT` and `EST` cases). The payload keys are `from,html,subject,text,to`. `sendPasswordReset` is unchanged. |
| Single-flight and idle pass | `purgeRunner.test.ts` | A second `tryStart` returns `in_flight`. An idle pass issues exactly 2 statements and no write. |
| Budget expiry (Properties 17, 14) | same file | Cuts before the claim, between accounts, between stages and between chunks leave `purge_stage` equal to the completed count and the claim released. A follow-up run reaches the unbounded final state. |
| Five consecutive `refs_remain` (Property 31, R8.13) | same file | `purge_attempts` goes 1..5 with stage 0 and the claim released after each run. The alert is logged exactly once. |
| Lockout cleanup failure (Property 33) | same file | The account is still purged. The ledger outcome is `completed_with_warnings`. |
| Logs carry only `accountLogId` | same file | No user id, email, name or placeholder id appears in captured logs. |
| Stage 3 repair after a crash | same file | The share payload no longer contains the id or name after a crash between re-point and scrub. |
| No `bullmq` import | same file | A structural scan finds no `bullmq` import and no Worker, Queue or subscribe call. |

### Chunk C (routes, auth, wiring, trips)

| Behavior | Test file | Assertion |
|---|---|---|
| Non-active user's session is 401 through the real adapter SQL | `auth/__tests__/sessionMiddleware.accountDeletion.test.ts` | Status 401 with `revoked_at` still null. 200 again once active. |
| Every new route is authenticated | `accountDeletion/__tests__/routes.test.ts` | No session, no or wrong secret, or another cron's secret all give 401. `tryStart` is never called. |
| Reauth: wrong password, lockout, success | same file, `endToEnd.test.ts` | Wrong password is 403 `reauth_failed` with one `recordFailure`. Locked is refused before password work. The grant is stored hashed and bound to the session. |
| Reauth rate limit | same file, `plugins/__tests__/rateLimit.reauth.test.ts` | The sixth wrong-password call is 429 `rate_limit_exceeded` with `verifyCalls` still 5. Another token is not blocked. The deletion route is never 429. |
| Deletion request | same file | Each error code is covered. A mail failure still gives 200. A wrong phrase leaves the grant unconsumed. The grant is single-use. |
| Purge cron | same file, `wiring.test.ts` | 401 without the secret, 202 accepted, 202 skipped `in_flight`, HEAD gives an empty 202. |
| Whole path | `endToEnd.test.ts` | Register, reauth, request, dead session, restore on login, request again, jump past the due date, cron, row gone. The ledger says `completed` and the email is reusable. |
| Login restore and ineligible accounts (Property 7) | `auth/__tests__/accountRestore.test.ts` | `accountRestored: true` appears only when restored. An ineligible account's response is byte-identical to an unknown email, with no lockout call. |
| Reset restores atomically (Property 32) | same file | A pending account is restored with the hash changed and the code consumed. A `purging` account gets `invalid_code`. Losing the race inside the transaction changes nothing. |
| Web fallback pages | same file | Form for pending-in-grace, "Account Restored", ordinary page for active, invalid link for purging. |
| Composition wiring | `accountDeletion/__tests__/wiring.test.ts` | The source scan finds the shared logger passed to the mail service, service and runner, `accountRestore: accountDeletionService` passed to `authRoutes(`, and the server registration. It finds no scheduler and no test seam. |
| Interim organizer (Property 10) | `trips/__tests__/effectiveRole.prop.test.ts`, `effectiveRole.db.test.ts`, `tripBooking/__tests__/routes.interimOrganizer.test.ts` | The interim organizer passes an organizer-only route and loses the role on restore. A non-member is null. Stored roles never change. |
| Role-reader guard | `trips/__tests__/roleReader.guard.test.ts` | No non-test file outside the three allowed ones selects `role FROM trip_memberships`. |

### Chunk D (visibility, money, admin)

| Behavior | Test file | Assertion |
|---|---|---|
| Social surfaces hide a pending person; real values return after restore (Property 18) | `accountDeletion/__tests__/visibility.social.test.ts` | Search, friends list, requests and send-to are empty or rejected while pending, and present after restore. |
| Stats deny path | same file | A pending friend and a never-existing id give identical `stats_target_not_found`. |
| Share payload scrub at read time, per kind (Property 20) | same file | The four kinds show the placeholder sender and name. The stored `payload_snapshot` is unchanged. Real values return after restore. |
| `countUnreadInbox` | same file | The badge count is 1 with active and pending senders, and 2 after restore. `listInbox` returns both shares in every state. |
| Trip surfaces (roster, invites, feed, reactions, log entries, tags, planned items, summary) | `visibility.trips.test.ts` | The pending member is omitted or shown as `Deleted user`, as specified per surface. Reaction count goes 1 then 2 after restore. |
| Feed rode-with list | same file | The pending tagged member is `{taggedMemberId: deadc0de-…, displayName: 'Deleted user', state: 'pending'}`. The test fails if the conversion is reverted. |
| Booking, food lists and experience lists | same file | Reminder recipients, packing assignee and list-not-found behave as specified. |
| Photos (Property 19) | `visibility.photos.test.ts` | A pending owner's photos are absent from dish, restaurant, Album, recap and feed slots. `photos.status` is identical before and after, and photos are served again after restore. |
| Money with a non-Visible party (Properties 13, 29) | `visibility.money.test.ts` | Net balances sum to 0 with a pending and a tombstone party. Create or edit naming a non-Visible party is rejected with `trip_party_deleted` and writes nothing. Delete succeeds. A guest of a pending or purged sponsor is rejected. The CSV prints `Deleted user`. |
| Admin lookup, growth totals, ledger buckets | `admin/__tests__/repo.deletion.test.ts`, `routes.deletion.test.ts` | The user lookup has the Deletion card for non-active accounts. Totals count 1 active and 1 pending. Ledger buckets straddling UTC midnight are `[1,2,0,0,0,1,0]`. No deletion control exists and no purged id or email appears. |
| Structural guards | `visibility.guard.test.ts`, `trip_memberships.guard.test.ts`, `visibility.surfaces.guard.test.ts` | Negative fixtures trip. Live-tree pins match: visibility 6 files, roster 13 files. |

### Chunk E (mobile)

| Behavior | Test file | Assertion |
|---|---|---|
| Notices not persisted; `clearToken` keeps the deletion notice; `setToken` clears both stale notices | `state/__tests__/sessionStore.accountNotices.test.ts` | `setItemAsync` is never called. The restored flag is false after the next `setToken`. Fails if that reset is removed. |
| Banners: exact copy, alert role, announced once, dismissible | `components/__tests__/AccountNotices.test.tsx` | `announceForAccessibility` is called exactly once with text containing the formatted date. |
| Entry row placement and navigation | `youAndCrew/__tests__/DeleteAccountFlow.test.tsx` | Tree order is `[blocked, delete, logout]` and the route is `DeleteAccount`. |
| Review step has no hard-coded days; confirm shows server `graceDays` | same file | `queryByText(/after \d+ days/)` is null. The confirm copy matches `/deleted 14 days after/` and not `/30 days/`. |
| Wrong password and locked | same file | The inline message shows, the field clears and the token stays. Locked shows `ACCOUNT_LOCKED_MESSAGE`. |
| Confirm gating and submit payload | same file | The button is disabled for `''`, `delete` and `DELET`. The POST body is `{reauthGrant:'grant-1', confirmation:'DELETE'}`. |
| Success order and no extra calls | same file | The event log is `['cancelQueries','notice','token-cleared','queryClient.clear']`. There is no `/auth/logout` and no push `DELETE`. |
| `reauth_required` returns to the password step | same file | The second POST carries the fresh grant `grant-2`. |
| Pending request disables submit | same file | A second press leaves exactly 1 POST. |
| Login, register and reset screens | `screens/__tests__/authScreens.accountDeletion.test.tsx` | The banner precedes the login body. `accountRestored: true` sets the flag. Register never sets it. |
| Restored banner is first over the real tabs; stale-flag regression | `navigation/__tests__/mainTabsNavigator.restoredNotice.test.tsx` | `root.children[0].type === AccountRestoredNotice`. Restored login, then logout, then plain login shows no banner. |
| Placeholder not tappable | `components/__tests__/presentPerson.test.ts`, `screens/share/__tests__/inbox.deletedSender.test.tsx` | The label contains "Deleted user". The row is not pressable, and no `/me/friends` call is made. |
| Attention filter | `features/notifications/__tests__/useAttention.accountDeletion.test.tsx` | Two unread shares give `['share-ok']` and badge 1. |
| `trip_party_deleted` copy and no settle control | `screens/trips/__tests__/TripExpensesScreen.deletedParty.test.tsx` | The exact sentence shows. `settle-pair-btn-0` is absent for the placeholder and `-1` is present. |

### Chunk F (guard decision)

| Behavior | Test file | Assertion |
|---|---|---|
| Deletion routes only under `/me/account/` and `/internal/account-deletion/`, none under `/photos` | `accountDeletion/__tests__/photosScope.guard.test.ts` | The resolved path set equals the expected three. |
| Four photos-guard files contain neither phrase | same file | `not.toMatch` for both regexes, four times, comments included. |
| Docs and design edits | none | Documentation only. No test asserts them. |

## Behaviors with no asserting test

- Privacy-policy, photos-runbook, hosting and design prose (documentation).
- Highest-rated leaderboard (Appendix B row, no test).
- Push delivery. Only the registration deletion is tested.
- The `.env.example` and `render.yaml` contents. Config is tested, the files are not.
- Task 19 operator gates.

## Literal tail of `npm run verify` (exit code from `$LASTEXITCODE`)

```
 Test Files  534 passed | 6 skipped (540)
      Tests  4161 passed | 54 skipped (4215)
   Duration  115.73s (transform 50.56s, setup 0ms, import 535.61s, tests 2019.10s, environment 114ms)
Statements   : 96.68% ( 321/332 )

> @dwt/mobile@0.0.0 test
> jest
...
Test Suites: 335 passed, 335 total
Tests:       2645 passed, 2645 total
Snapshots:   2 passed, 2 total
Time:        83.211 s
Ran all test suites.

> @dwt/shared@0.0.0 test
> vitest --run
 Test Files  46 passed (46)
      Tests  600 passed (600)
   Duration  1.66s
EXIT: 0
```

Typecheck ran first in the same command: `@dwt/api`, `@dwt/mobile` and `@dwt/shared` each ran `tsc -p tsconfig.json --noEmit` with no errors.
