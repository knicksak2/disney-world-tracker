# account-deletion: code status (chunk A = tasks 6.1-6.6 and checkpoint 7)

First pass (no `review-chunk-a.json` existed). Nothing committed, staged or pushed. No real env file was touched.

## Baseline

`npm run typecheck` in `apps/api` and in `packages/shared` were both green before this chunk's tests were added (exit 0 each). The base from tasks 1-5 compiled.

Found on disk at the start: `accountDeletion/repo.ts` (all of the design's repo surface), `__tests__/helpers.ts` (pg-mem harness), `__tests__/world.ts` (seeded world), `__tests__/repo.request.test.ts`, and the `softDeleteByOwner` limit extension with its photos tests. I read all of it against design.md, did not rewrite it, and added the missing tests.

## Added in this pass

- `__tests__/repo.claim.test.ts` (task 6.3)
- `__tests__/repo.trips.test.ts` (task 6.4)
- `__tests__/repo.stages.test.ts`, `repo.tombstone.test.ts`, `repo.enqueue.test.ts`, `repo.finalize.test.ts` (task 6.5)
- `__tests__/repo.purge.residual.test.ts` (task 6.6)
- `__tests__/purgeDriver.ts`: test-side stage driver written from design.md "Purge procedure" (loop-until-empty, enqueue before the registry loop, trips before anonymize). It exists only so repo tests can run stages to completion before the real runner (task 8.2). Task 8.2's tests should use the real runner.
- `__tests__/world.ts`: the `shares` fixtures now carry the real payload `kind` key (they had none, so `scrubSharePayload` could never match them; the old fixture was not realistic).
- No source change was needed in `repo.ts`, `photos/repo.ts` or `photos/service.ts`.

## Verification (execution-discipline: inner loop per file, then ONE scoped gate)

Inner loop, each file run until green: `repo.claim` 26 tests, `repo.trips` 19, `repo.stages` 81, `repo.tombstone` + `repo.enqueue` 11, `repo.finalize` 20, `repo.purge.residual` 17. `npm run typecheck` in `apps/api`: exit 0.

Scoped gate, run once at the end: `npm run verify:api` from the repo root.

```
 Test Files  511 passed | 6 skipped (517)
      Tests  3848 passed | 54 skipped (3902)
   Start at  00:30:15
   Duration  83.17s
 Statements   : 96.68% ( 321/332 )   (src/services/planning/** coverage threshold met)
EXIT: 0
```

Not run, on purpose: the full `npm run verify` (final step of the whole change) and the pin gate (no catalogue file changed).

What this does and does not prove: green means nothing else broke and the new tests pass against pg-mem. It does not prove real-Postgres behaviour, see "Not verified".

## Behavior -> test map

| Behavior | Test and assertion |
|---|---|
| `softDeleteByOwner(.., limit)` marks at most `limit` per call; default call marks all; bad limit rejected | `photos/__tests__/repo.test.ts` "softDeleteByOwner limit": call sizes `[4,4,2]`, nothing left, other owner untouched, no-limit marks 9, `RangeError` for 0 and 1.5; `service.test.ts` `deleteAllForUser({limit:2})` returns 2 then 1 then `[]` |
| Grant: replace-on-issue, once, user- and session-bound, strict expiry, prune on issue | `repo.request.test.ts` "grant store (Property 4)" |
| Request changes only five tables and four `users` columns; revokes caller session; restore returns state | `repo.request.test.ts` "request effects (Property 6)": hash of every other table identical, changed `users` columns equal the four named |
| Restore boundary strict; `restoreInTx` outcomes; runs on caller's client (rollback undoes it) | `repo.request.test.ts` "restore boundary" |
| Claim is one `UPDATE ... RETURNING` with `FOR UPDATE SKIP LOCKED`, dates as params, documented ORDER BY | `repo.claim.test.ts` first test (statement text and params) |
| Sequential second claim returns nothing; released and 15-minute-stale re-claim keep `purge_stage`; boundary at exactly 15 min | `repo.claim.test.ts` "claimDue (Property 16)" |
| Restore vs claim: exactly one winner in both orders | `repo.claim.test.ts` "restore versus claim has exactly one winner" |
| Every fenced write with a stale, released or absent claim changes nothing | `repo.claim.test.ts` "fencing": `JSON.stringify(userRow)` unchanged, all seven calls report false/null; statement text carries `purge_claimed_at = $2` |
| `advanceStage` resets attempts; `addCounters` changes neither stage nor attempts; `rewindStage` only stage | `repo.claim.test.ts` "advanceStage / addCounters / rewindStage" |
| Thrown stage: +1 relative, `purge_last_attempt_at`, claim released; saturates at 32767; `refs_remain` write is absolute | `repo.claim.test.ts` "recordFailedAttempt..."; the absolute case reproduces the stage-resets-to-0 trap and expects `3` |
| Claim order `(attempts, scheduled_purge_at, id)`; fresh account ahead of failing ones | `repo.claim.test.ts` "claim order" + fast-check property (100 runs) comparing SQL order with `orderForClaim` |
| Trip: transfer to organizer over earlier member; ties by earliest joined then lowest id; promotion rules; creator who left; pending-over-active preference | `repo.trips.test.ts` "keep_trip" cases |
| Pending tags and invites cancelled/removed only for this trip and this user | `repo.trips.test.ts` "cancels pending rode-with tags ..." (6 tag/invite rows, each asserted) |
| `delete_trip`: photos `deleted`, trip gone, photo call on the transaction client between BEGIN and COMMIT, trip lock before roster read | `repo.trips.test.ts` "sole member" (statement order assertions) |
| Roster change between lock and plan keeps the trip and photos | `repo.trips.test.ts` seam test: status stays `approved`, new member promoted |
| Throwing seam, failing photo step after marking, and a lost claim all roll back | `repo.trips.test.ts` (snapshot-emulated rollback in the test pool): photo `approved` and trip present in all three; lost claim returns `'fenced'` |
| Trip resolution postconditions over generated trips on the real repo | `repo.trips.test.ts` fast-check property (100 runs) |
| Each of the 70 registry rows: delete/session removed in chunks, nullify nulls only the column, anonymize re-points only the column, bystander row untouched, second pass is 0 | `repo.stages.test.ts` `describe.each` over `DISPOSITIONS` |
| Cascade hazard: retained `experience_logs` re-pointed with note blanked, trip log entry, tag and feed item survive; delete path refuses while a retained row names the user | `repo.stages.test.ts` "anonymize_then_delete" |
| Photos stage: counts, no re-stamp of already-deleted, still found by owner, owner nulled in chunks `[50,50,25]`, `listDeleted` still returns them | `repo.stages.test.ts` "photos (Property 19)" |
| Share scrub by sender before and after the re-point, writes nothing second time, other kinds/senders untouched, multi-page keyset | `repo.stages.test.ts` "scrubShares" (real payload shapes for all four kinds) |
| Recompute drain: limit, oldest first, throwing row stays queued, idle = one read | `repo.stages.test.ts` "drainRecomputeQueue" |
| Stage idempotence (stages 1-4 twice == once) | `repo.stages.test.ts` "stage idempotence (Property 14)" |
| Tombstone statement shape (2 params, `$1::uuid`/`$2::text`, each once, no `\|\|`), profile insert, no-op rerun, repair, injective, no trace of the person | `repo.tombstone.test.ts` |
| Chunked enqueue: 3 pages of at most CHUNK_ROWS, exactly 150 distinct ids, all-queued page does not end the loop, restart adds no duplicates, enqueue precedes first `ratings` delete | `repo.enqueue.test.ts` |
| `finalize`: purged -> user gone + one ledger row from counters; no identifying column/value; email reusable | `repo.finalize.test.ts` "purged" |
| `finalize`: `refs_remain` for anonymize, nullify, trip and retained-log rows changes nothing; fenced changes nothing | `repo.finalize.test.ts` "refs_remain", "fenced" |
| Ledger outcome decided from locked row's `purge_warnings`; no later UPDATE of the ledger | `repo.finalize.test.ts` "ledger outcome (Property 33)" |
| Ledger pruned to 1000, at most CHUNK_ROWS surplus per finalize, never below the cap | `repo.finalize.test.ts` "ledger retention" |
| Whole purge over every registry row + several trips: original id, email, name, avatar absent from every table; present before | `repo.purge.residual.test.ts` Property 26 |
| Anonymize rows survive with only attribution changed; trip history rows, tag and feed item survive | `repo.purge.residual.test.ts` Property 21 / 28 |
| Other members' rows, trips, photos unchanged; trip A transferred, B unchanged, C deleted with photos | `repo.purge.residual.test.ts` trips and photos tests |
| Money preserved (payer, sharer, settlement party, guest sponsor), zero-sum before and after | `repo.purge.residual.test.ts` Property 13 via the real `computeNetBalances` and `computePairwiseBalances` |
| Report counts: status unchanged, open rows unchanged, member-scoped count 2 -> 1, food photo 2 -> 2 | `repo.purge.residual.test.ts` Property 21 reports |
| Bounded run: nothing but the three named statements exceeds CHUNK_ROWS; each of 5 tables cleared in >= 3 chunks | `repo.purge.residual.test.ts` Property 17 |

## Things worth knowing

- **pg-mem compatibility, found while testing.** (1) pg-mem evaluates an uncorrelated `IN (SELECT ... LIMIT n)` once per candidate row against the table as it changes, so a bounded delete removes everything. `helpers.ts` materializes such a subselect once and substitutes it as parameters (Postgres semantics). (2) pg-mem's `ROLLBACK` does not undo, so the test pool emulates transactions with `db.backup()` snapshots. Both live in the test pool only; the SQL sent by `repo.ts` is recorded as written and is what the text assertions check.
- **Existing quirk, not touched.** `computePairwiseBalances` de-duplicates events by `(pair, expense)`, so an expense with two shares that resolve to the same person (a member plus the guest they sponsor) loses one. The balance fixture avoids that shape so the comparison does not depend on row order. Worth a separate look; it is outside this spec.
- **Unrelated changes in the tree** (not mine, left alone): `apps/api/src/db/pool.ts` (idle-client error listener) and the untracked `db/__tests__/pool.test.ts`; and the `.kiro/specs/*/requirements.md` edits from the spec round.
- Photos guard: no account-deletion wording was added to `photos/routes.ts`, `foodReadRoutes.ts`, `sweepCronRoute.ts` or `auth/routes.ts`; `photos.guards.test.ts` passed in the gate.

## Not verified

pg-mem is lenient and single-connection. Not exercised here, as the design already says: real concurrent `FOR UPDATE SKIP LOCKED`; Postgres parameter typing of the tombstone insert and of `$4::int`; the claim's `id = ANY(ARRAY(... FOR UPDATE SKIP LOCKED))` form (pg-mem ran the helper's materialized rewrite of the `IN` form, and the `ANY(ARRAY(` form is handled by the same rewrite); the six `per_key` statements and the multi-row `VALUES` enqueue under a real planner; and the deadlock path with `departMember`. These are on the operator's real-Postgres smoke list in design.md.

## Checkboxes

`tasks.md`: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6 and 7 ticked after the gate above exited 0. Tasks 8 onward are untouched.


---

# account-deletion: code status, chunk B (task 8.1 ports, service, mail; task 8.2 purge runner)

First pass (no `review-chunk-b.json` existed). Nothing committed, staged or pushed. No real env file was touched. No scratch or generated files left behind.

## Added

- `accountDeletion/ports.ts`: `LoggerPort`, `Scheduler`, `AccountDeletionServiceDeps`, `ReauthResult`, `DeletionRequestResult`, `AccountDeletionService extends AccountRestorePort`, `PurgeRunnerDeps` (its `lockout` carries the best-effort comment, NIT 2). `Budget`, `PurgeRunSummary`, `PurgeRunner` live in `purgeRunner.ts`, as design.md "Supporting types" places them.
- `accountDeletion/service.ts`: `reauth` (isLocked, getPasswordHash + verify, recordFailure once, issueGrant only on success, never clearOnSuccess), `requestDeletion` (phrase before any repo call, one shared `scheduledPurgeAt`, best-effort mail with a `warn` that carries no recipient and no user id), `restore`, `restoreInTx`, `notifyRestored`.
- `auth/mailService.ts`: `sendDeletionScheduled` (purge date and time in `America/New_York` with zone abbreviation; says signing in cancels it) and `sendDeletionCancelled`, added to the same factory. `MailService` is unchanged; the factory returns `MailService & AccountDeletionMail`; the payload type and `MailServiceOptions` are unchanged.
- `accountDeletion/purgeRunner.ts`: `createBudget`, `createPurgeRunner` (`tryStart`, `runOnce`). Imports only local modules.
- `__tests__/helpers.ts`: `createRecordingLogger()`.
- Tests: `__tests__/service.test.ts` (24), `auth/__tests__/mailService.accountDeletion.test.ts` (10 incl. one property), `__tests__/purgeRunner.test.ts` (32).

## One decision beyond the written design (flagged)

design.md stage 3 reads as "ensureTombstone and the anonymize chunks only if a reference remains". Taken literally, a run that crashed AFTER the `shares.sender_id` re-point but BEFORE the payload scrub would, on retry, see zero references, skip the scrub, and leave `ownerId` / `ownerDisplayName` of the person in the retained share. The design's own scrub text says the sender-or-tombstone selection exists to repair exactly that. So the runner now: runs the anonymize chunks only for entries that still have references (and ensures the tombstone only then), but ALWAYS runs the `scrubShares` loop (with `c.placeholderId`, which is the tombstone id). It costs one SELECT on an account with no shares. The test-side `purgeDriver.ts` has the literal behaviour and the same latent gap; it is test-only and was left alone. Test: `purgeRunner.test.ts` "stage 3 repair after a crash between the re-point and the scrub".

## Smaller choices

- The post-run recompute drain is skipped when the budget expired (the next run's first statement drains it); the idle pass is unchanged.
- The recompute drain is wrapped so an aggregate failure is logged (`warn`) and never fails or blocks a purge.
- The refs_remain `error` is logged every run (`account_deletion.purge.refs_remain`, table/column/count only); the attempts alert is a separate event (`account_deletion.purge.attempts_alert`) logged exactly once when the returned count equals `PURGE_ATTEMPTS_ALERT`. "The error log exactly once after run five" in the task text is read as the alert event.
- Admin lookup (`purgeAttempts`) does not exist yet (later task); the five-run test reads `users.purge_attempts` directly, which is what that lookup will read.

## Verification

Inner loop: `service.test.ts` 24 passed; `mailService*.test.ts` 14 passed; `purgeRunner.test.ts` 32 passed (about 28 s, the property tests run 100 pg-mem purges); `npm run typecheck` in `apps/api` exit 0.

Mutation checks (temporary edits, reverted): removing the per-chunk budget check fails "(d) between chunks"; replacing the absolute `c.attempts + 1` write with a relative one fails "five consecutive refs_remain runs" at run 2.

Scoped gate, run once: `npm run verify:api` from the repo root.

```
 Test Files  514 passed | 6 skipped (520)
      Tests  3914 passed | 54 skipped (3968)
   Start at  00:48:57
   Duration  114.15s
 Statements   : 96.68% ( 321/332 )   (src/services/planning/** coverage threshold met)
EXIT: 0
```

Not run, on purpose: the full `npm run verify` (final step of the whole change) and the pin gate (no catalogue file changed).

## Behavior -> test map

| Behavior | Test and assertion |
|---|---|
| Locked account refused before any password work | `service.test.ts` "refuses a locked account": calls are exactly `['lockout.isLocked']` |
| Wrong password: one failure, no grant, `reauth_failed`; missing hash is a failure | `service.test.ts` call order `[isLocked, getPasswordHash, verify, recordFailure]`; `recordFailure` args `[userId]` |
| Success issues a hashed, session-bound grant and NEVER clears the counter (R2.13) | `service.test.ts` "success issues one grant": `clearOnSuccess` and `recordFailure` calls are empty; `issueGrant` arg equals `{userId, sessionId, grantHash: hashGrant(grant), expiresAt: now+300s, now}` |
| Grant expiry equals the window; only the hash is stored (Property 4 service half) | `service.test.ts` fast-check, 100 runs |
| Phrase checked before any repo call; exactness (Property 5) | `service.test.ts` "a wrong phrase is rejected": no calls; fast-check, 100 runs: accepted iff `s.trim() === 'DELETE'`, rejection never reaches the repo |
| One date for the stored value, the response and the mail (Property 3) | `service.test.ts` fast-check, 100 runs: `res.scheduledPurgeAt` is the same `Date` object the repo and the mail received, `= now + graceDays` |
| `reauth_required` / `not_active` both answer `reauth_required`, no mail | `service.test.ts` `it.each` |
| Mail failure still resolves; `warn` has no recipient, no user id | `service.test.ts`: one `warn`, JSON of all logs lacks the email and the user id |
| Restore / restoreInTx / notifyRestored | `service.test.ts` "restore port" (mail only when restored; `restoreInTx` passes the caller's client and sends nothing; lookup or mail failure resolves) |
| Scheduled mail: subject, New York date and zone, "sign in again before then", grace days, no code/resetUrl | `mailService.accountDeletion.test.ts`: May 2026 date `May 1, 2026` `8:00 AM` `EDT`; `2026-01-16T03:30Z` renders `January 15, 2026` `10:30 PM` `EST`; payload keys exactly `from,html,subject,text,to`; fast-check 100 runs |
| Cancelled mail | same file: subject, "Nothing was removed", payload keys |
| `sendPasswordReset` unchanged | same file: subject `...reset code: 231 109`, `code` and `resetUrl` reach the transport, old `MailService` type still assignable |
| Single-flight | `purgeRunner.test.ts` "second tryStart ... in_flight": one job scheduled for three calls, a new one after finish; crash logs error name only and resets the flag |
| Idle pass = two statements, no write | `purgeRunner.test.ts`: `statements.length === 2`, claim `rowCount 0`, account still pending |
| Budget expiry before the claim / between accounts / after each of stages 1-4 / between chunks | `purgeRunner.test.ts` (a), (b), (c) x4, (d): `purge_stage` equals completed count, `purge_claimed_at` null, `released` counted, follow-up run equals the unbounded run's table counts and ledger rows |
| Budget at ANY repo call (Properties 17 and 14) | `purgeRunner.test.ts` fast-check, 100 runs: consistent state after every cut, then rewind to stage 0 and finish equals the baseline |
| At most BATCH claimed; bounded statements except the three named | `purgeRunner.test.ts` "claims at most BATCH", "no statement touches more than CHUNK rows" |
| Rated ids queued before the first ratings delete; drained over runs | `purgeRunner.test.ts` statement order, `recomputed` 4 then 2, then idle = 2 statements |
| Five consecutive refs_remain: attempts 1..5, stage 0, claim released, alert once, not on run six | `purgeRunner.test.ts` "five consecutive": per-run row assertions, alert count 0,0,0,0,1 then still 1 |
| Thrown stage: +1, released, stage kept, alert once at five | `purgeRunner.test.ts` "a stage that throws", "five runs in a row" |
| Fresh account ahead of a failing one | `purgeRunner.test.ts` BATCH 1: fresh account purged, failing one remains |
| Fenced-out account stops silently | `purgeRunner.test.ts`: `fenced 1`, attempts 0, no warn/error |
| Recording the failure can itself fail without sinking the run | `purgeRunner.test.ts`: other account still purged, `record_failed` warn logged |
| Lockout cleanup failure: account still purged, `completed_with_warnings`, ledger has no identifying column (Property 33) | `purgeRunner.test.ts` + fast-check 100 runs over 1-3 accounts; cleanup runs at `purge_stage` 3 |
| Logs carry only `accountLogId` | `purgeRunner.test.ts`: no user id, email, name or placeholder id anywhere in the captured logs |
| Stage 3 repair after a crash between re-point and scrub | `purgeRunner.test.ts`: payload no longer contains the id or name, `ownerId` equals the placeholder |
| No bullmq / Redis import, no Worker/Queue/subscribe | `purgeRunner.test.ts` structure tests scan the real import lines and code |

## Not verified

Same as chunk A: real concurrent `FOR UPDATE SKIP LOCKED`, real Postgres typing, and the deadlock path. Also not exercised: a real SMTP/Resend send (the mail tests inject `sendFn`), and the `MailServiceOptions.logger` type question in design.md (task 9.4 wires `createLogger()` into the factory; `tsc` over the current code is clean but that assignment does not exist yet).

## Checkboxes

`tasks.md`: 8.1 and 8.2 ticked after the gate above exited 0. The parent task 8 line is left for the orchestrator.


---

# account-deletion: code status, chunk C (tasks 9.1-9.4 routes/auth/wiring, task 10 trip authorization, checkpoint 11)

First pass (no `review-chunk-c.json` existed). Nothing committed, staged or pushed. No real env file was touched (`git status` shows only `apps/api/.env.example`, edited in task 2.1). No scratch or generated files left behind (one temporary probe test was written, used and deleted; four temporary mutation edits were reverted, checked with a case-sensitive search).

## Unauthenticated surface (call-out)

There is none new. `POST /me/account/deletion/reauth` and `POST /me/account/deletion` sit behind the session middleware (plus the reauth rate limit); `POST`/`HEAD /internal/account-deletion/purge/run` sit behind `x-cron-secret`. `routes.test.ts` sends every one of them with no credentials, with a wrong secret and with another cron's secret, and asserts 401 and that nothing ran. The existing public auth routes (`/auth/login`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/reset-password-web`) were already unauthenticated by nature; their responses for non-eligible accounts are byte-identical to the unknown-email responses, so they gained no enumeration signal.

## Added or changed

- 9.1 `auth/sessionMiddleware.ts`: optional `deletion_state` on `SessionRow`; a reported non-`active` state is `unauthorized` (before any activity write); `request.sessionId = session.id`; `sessionId?: string` on the `FastifyRequest` augmentation. `composeServices.ts` `makeSessionDbAdapter` (now `export`ed so the test runs the real SQL) and the copy in `test/smoke/harness.ts` join `users` and select `u.deletion_state`.
- 9.2 `accountDeletion/routes.ts` (new), `reauthRateLimitConfig()` in `plugins/rateLimit.ts` (login budget, key `reauth:<sha256 of bearer>`, IP fallback). The grant is held to `^[A-Za-z0-9_-]{20,128}$` in the route (`deleteAccountRequestSchema.extend`), as the design's input table says. `server.ts`: `services.accountDeletion` and its registration.
- 9.3 `auth/routes.ts`: `AuthSessionResponseDTO` replaces the private body type; `handleLogin` selects `deletion_state, scheduled_purge_at`, applies `classifyLoginEligibility` with one clock read, treats `ineligible` as an unknown email, restores before minting a session, fails closed without the port or on `not_restorable`; `accountRestore?` on `AuthRoutesOptions` (one `error` log at registration when absent, per the design's error table); forgot/reset/web handlers take the application clock and the port. `auth/passwordResetRepo.ts`: the eligibility predicate in the three lookups with a trailing optional `now`, `completeReset(..., opts?)` with `restoreInTx` first, `'restored' | 'restore_lost'`. The strings `delete-account` and `account/delete` appear nowhere in `auth/routes.ts` (checked, and `photos.guards.test.ts` passed in the gate).
- 9.4 `composeServices.ts`: one `accountDeletionLogger = createLogger()` passed to `createMailService`, the service and the runner; repo, service, runner (no `scheduler`, no `afterTripLocked`); photos port with the photos-disabled fallback; trip photo port on `softDeleteByTarget('trip', ..., client)`; `accountRestore: accountDeletionService` into `authRoutes(`; `accountDeletion: {...}` into `buildServer`. `tsc` accepts a `pino.Logger` for `MailServiceOptions.logger`, so the option type is unchanged (chunk B's open question). `docs/hosting.md`: "Dedicated Account Deletion Cron (Purge_Cron)".
- 10 `trips/permissions.ts`: pure `effectiveRole`, `RosterMember`. `trips/effectiveRole.ts` (new): `resolveEffectiveRole`, `actingRole`, `ACTIVE_ORGANIZER_COUNT_SQL`. Used only in `trips/authz.ts` `assertTripMember`, `trips/repo.ts` `lockMemberRole`, and the trip-share `roleOf` in `composeServices.ts`. No new `TripAction`; `can`, `violatesLastOrganizer`, `assertTripOrganizer` untouched.

## Deviations and things to know (flagged)

1. **`EXISTS` instead of `count(*)` for the active-organizer flag.** The design's `(SELECT count(*)::int ... WHERE o.trip_id = tm.trip_id) AS active_organizers` cannot run on pg-mem: a correlated outer reference in a select-list subquery errors, and an uncorrelated `count(*)` subquery returns a phantom row for a non-member (found with a probe; it would have made every non-member look like a member). The built form is `EXISTS (... WHERE o.trip_id = $1 ...) AS has_active_organizer`: same meaning, same one-query common case, still "a row without the flag means has one". Recorded in design.md as an additive note under "Authorization for trips with a deactivated owner".
2. **The design's `lockMembership` is `lockMemberRole` in the code and its only caller is `promote`**, not planned-item/packing-item checks (those go through `assertTripMember`). Applying the effective role there means promoting the interim organizer answers `trip_role_invalid` ("already an organizer") and writes nothing; promoting any other member still persists. That follows the task text; it is a small user-visible consequence worth knowing. A behavior-preserving alternative (read the PERSISTED role in `promote`) is a one-line change if you prefer it; I did not make it because the task names this reader explicitly.
3. **Fixture blast radius of the new `users.deletion_state` read.** Every pg-mem test that applies a partial migration list and then calls `assertTripMember` or the session adapter needs migration `0064` (and `0013`/`0015` where its views need them). Added `0064` (and `0013` where missing) to: `trips/favoritesShared`, `feedEnrichment`, `feedPosts`, `tripDeletePhotos`; `photos/albumRoute`, `reportsRepo`, `targets/tripTarget`, `recapAlbumHarness.ts`; `tripBooking/testDb.ts`; `auth/passwordReset.prop` (also `0015`). The three hand-written fake pools that matched `SELECT role FROM trip_memberships` now match `SELECT tm.role` (`authz.prop`, `plannedCompletionAuthz.prop`, `repo.membership.prop`). The smoke harness adds just `ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_state` inline (its curated migration chain has no trips tables, which 0064's views need; the design's "needs no edit" holds for the seeded users, not for the schema).
4. **`README.md`** is not touched here; the design assigns its one-line addition to the docs task (17).
5. **Existing defect left alone, as the design says:** `ChangePasswordControl` still signs the user out on a wrong current password because `/auth/change-password` answers 401.

## Verification

Inner loop: every new file run to green on its own; mutation checks (all four applied together, 18 tests failed, then reverted and re-checked): letting an ineligible account through login fails the three byte-identical-to-unknown-email tests and Property 7; disabling the `restore_lost` rollback fails the reset-route and web-page race tests and Property 32; removing the session `deletion_state` check fails the middleware 401 tests; returning the persisted role from `assertTripMember` fails the db tests and two route tests. `npm run typecheck` in `apps/api`: exit 0.

Scoped gate, run once: `npm run verify:api` from the repo root.

```
 Test Files  524 passed | 6 skipped (530)
      Tests  4055 passed | 54 skipped (4109)
   Start at  01:19:40
   Duration  103.16s
 Statements   : 96.68% ( 321/332 )   (src/services/planning/** coverage threshold met)
EXIT: 0
```

(+10 files, +141 tests over chunk B.) The `Connection terminated unexpectedly` log line in that output is the pre-existing `db/__tests__/pool.test.ts`, not mine. Not run, on purpose: the full `npm run verify` and the pin gate (no catalogue file changed).

What this proves: nothing else broke and the new tests pass against pg-mem and fakes. It does not prove real-Postgres behavior; see "Not verified".

## Behavior -> test map

| Behavior | Test and assertion |
|---|---|
| Unrevoked session of a `pending_deletion`/`purging` user is 401 through the REAL adapter SQL; works again when active; revoked still 401 | `auth/sessionMiddleware.accountDeletion.test.ts`: `it.each` states expect 401 with `revoked_at` read back as null; "works again once the user is active" |
| `request.sessionId` is the session row id | same file: `/whoami` body equals `{ userId, sessionId }` read from the table; fake adapter without `deletion_state` still passes |
| Non-active state is rejected before any activity write | same file: `updateActivity` never called |
| Handler reached without a session id is 401 and does nothing | `accountDeletion/routes.test.ts` "reaches a /me handler without a session id": 401 on both routes, no repo or lockout call |
| Every route is authenticated | `routes.test.ts` "authentication on every route": no session, revoked token, no/wrong/other-cron/near-miss secret, bearer instead of secret: all 401, `tryStart` never called |
| Wrong password: 403 `reauth_failed` (not 401), one `recordFailure`, no grant, still signed in | `routes.test.ts` "a wrong password is 403"; `endToEnd.test.ts` "a wrong password costs a lockout failure and no grant row" (events exactly `[isLocked, recordFailure]`, `/me` still 200) |
| Locked account refused before password work | `routes.test.ts` "locked ... 423": `verifyCalls` empty, repo untouched |
| Success: grant matches the shared schema, hash only, bound to the session, never clears the counter | `routes.test.ts` (issued hash equals sha256 of the grant, plaintext absent); `endToEnd.test.ts` "session binding": row's `session_id` equals the session read by token hash, `grant_hash` equals sha256, no `clearOnSuccess` |
| Replace-on-issue, single use, other session, other user, expiry, not-active, wrong phrase leaves the grant | `routes.test.ts` "POST /me/account/deletion" cases; `endToEnd.test.ts` second login session gets 403 `reauth_required` and the account stays active |
| Validation: reauth body (missing, empty, 129 chars, non-string, unknown key); deletion body (missing fields, short/long/illegal grant, unknown key); no echo of the password | `routes.test.ts` `it.each` cases, all 400 `validation_failed`, repo/verify untouched; payload lacks the password |
| Mail failure still 200; the warning has no address or user id | `routes.test.ts`: one `warn`, JSON lacks `alice@example.com` and `user-alice` |
| Nothing the caller submitted is logged | `routes.test.ts`: logs lack password, wrong password, grant |
| Reauth rate limit: login budget keyed on the token hash, separate per session, shared across addresses, 429 envelope | `plugins/__tests__/rateLimit.reauth.test.ts`: key equals `reauth:<sha256>`; 6th call 429 `rate_limit_exceeded`; other token 200; same token other IP 429 |
| Purge cron: 401 without/with wrong/with another cron's secret; 202 accepted; overlap skipped `in_flight`; HEAD 202 empty; never runs inline | `routes.test.ts` "purge/run" block; `wiring.test.ts` via `buildServer` with real config (also the sampling/pin/trip secrets are rejected) |
| Whole path: register, reauth, request, dead session, wrong password, restore on login, request again, jump past the due date, cron 202 then skipped, held job runs, row gone, ledger `completed`, address reusable, runner released | `accountDeletion/__tests__/endToEnd.test.ts` (real routes, middleware, repo, runner on pg-mem) |
| A restore one millisecond before the due date wins and the purge leaves the account | `endToEnd.test.ts` "a restored account is not purged": state active, ledger empty |
| Login restore: `accountRestored: true` only when restored; active has no key; register never has it | `auth/accountRestore.test.ts` login block (key list `['profile','token','user']`); registration test |
| Ineligible accounts (pending past or at the date, purging) are byte-identical to unknown email with no lockout call and nothing changed | `accountRestore.test.ts` `it.each`: `payload` equality, `lockoutEvents` empty, row unchanged |
| Property 7 through the route | `accountRestore.test.ts` fast-check, 100 runs, `classifyLoginEligibility` oracle across state x millisecond offset |
| Failed password on a restorable account counts toward lockout and restores nothing; locked is 423 before password work | `accountRestore.test.ts`: events `[isLocked, recordFailure]`; `[isLocked]` only for locked |
| Fail closed: no port, or `not_restorable` | `accountRestore.test.ts` "login restore failure modes": 401 `invalid_credentials`, state unchanged, zero sessions, no mail; one `error` log at registration when the port is missing, none when wired |
| Forgot-password: pending in grace and active get mail; expired/at-date/purging look non-existent | `accountRestore.test.ts` forgot block: mail counts, `payload` equal to unknown, zero reset rows |
| Reset restores atomically (Property 32): pending restored with hash changed, code consumed, mail after commit, `accountRestored` true; active unchanged with no key; purging is `invalid_code`; losing the race inside the transaction changes nothing | `accountRestore.test.ts` reset block, including the wrapped-port race (hash equal, `used_at` null, state pending, no session, no mail) |
| Property 32 over every state and every millisecond around the date, with the lookup and restore on ONE clock | `accountRestore.test.ts` fast-check, 100 runs through the real `completeReset`: lookup non-null iff outcome is not `restore_lost`; hash/`used_at`/state asserted per branch |
| Web fallback: form for pending in grace, "Account Restored" page, ordinary page for active, invalid-link page for purging and for a lost race | `accountRestore.test.ts` web block |
| Wiring: shared logger into mail/service/runner, restore port into `authRoutes`, server registration, no test seam, no scheduler, session adapters join `users`, cron path named only by the route (and config's description), hosting section content | `accountDeletion/__tests__/wiring.test.ts` source scans (call text extracted with paren matching) |
| `routes.ts` imports nothing from another service folder; paths are the three expected; no logging | `routes.test.ts` "routes.ts structure" |
| `effectiveRole` equals the persisted role except for the interim organizer; null for a non-member; at most one lifted member; idempotent, order independent, no mutation; restore returns persisted roles (Property 10) | `trips/__tests__/effectiveRole.prop.test.ts`, 200 runs each, independent oracle |
| Interim organizer through real SQL: lifted only while the organizer is pending; non-member denial unchanged; restore returns persisted roles with stored roles unchanged; pending earliest member skipped; one query in the common case, two only for a member of an organizer-less trip | `trips/__tests__/effectiveRole.db.test.ts` (pg-mem; statement counts from the recording pool) |
| `promote` reads the acting role under `FOR UPDATE` | same file: plain member promoted and persisted; interim organizer gets `trip_role_invalid` and stays `member`; other member promotable while the organizer is pending |
| Route level: interim organizer passes an organizer-only action (`PATCH /trips/:id/booking-settings`), the other member does not, and loses it on restore | `tripBooking/__tests__/routes.interimOrganizer.test.ts` |
| Role-reader guard | `trips/__tests__/roleReader.guard.test.ts`: no non-test literal outside `authz.ts`/`repo.ts`/`composeServices.ts` selects `role FROM trip_memberships`; `effectiveRole.ts` imported only by those three; each calls the derivation; detector shown able to trip |

## Not verified

- Real Postgres: `FOR UPDATE` with the `EXISTS` select-list in `lockMemberRole`, the three eligibility predicates with a `Date` parameter, `completeReset`'s transaction under real concurrency, and the `JOIN users` session query on the real pool. pg-mem is single-connection, so the restore-versus-claim race is exercised by a wrapped port and sequential state, not by two connections.
- The composed app: `wiring.test.ts` scans the source of `composeServices.ts`; nothing runs `buildApp` (it needs Redis and a pool).
- cron-job.org, Render and Neon behavior; a real SMTP/Resend send.
- `docs/hosting.md` content is checked for the required facts, not for correctness of the operator's cron-job.org setup.

## Checkboxes

`tasks.md`: 9.1, 9.2, 9.3, 9.4, 10 and 11 ticked after the gate above exited 0. The parent task 9 line is left for the orchestrator. Tasks 12 onward are untouched.


---

# account-deletion: code status, chunk C, second pass (review-chunk-c.json findings)

Nothing committed, staged or pushed. No real env file touched. No scratch files left (one temporary mutation edit in `accountDeletion/routes.ts`, reverted and re-checked by search).

## Findings

1. **BLOCKING, fixed: reauth rate limit not asserted on the real route.** `accountDeletion/__tests__/routes.test.ts` gains a `withRateLimit` harness option (registers the real `registerRateLimit` with a generous global budget, so only the route override can produce a 429) and a describe "POST /me/account/deletion/reauth rate limit (R2.11, real route)": (a) five wrong-password calls on one token answer 403, the sixth answers 429 `rate_limit_exceeded`, `verifyCalls` stays 5 and `recordFailure` stays 5 (no password work for the blocked call); (b) another session token of the same user is not blocked; (c) seven calls to `POST /me/account/deletion` are never 429 (the reauth budget is not applied to the confirmation route). Mutation check: removing `config: { rateLimit: reauthRateLimitConfig() }` from the reauth route fails (a) and (b); restored, 52/52 pass.
2. **NON-BLOCKING, left as is (the review allows "leave as is and note it").** Reset / web fallback with no `accountRestore` port still admits a pending-in-grace account. Failing closed would need the lookups to return the deletion state (repo plumbing) for a case production never reaches (the port is always wired and an `error` is logged at registration if missing). No behavior changed.
3. **NON-BLOCKING, unchanged.** Promoting the interim organizer answers `trip_role_invalid`; this is the behavior in design.md "Authorization for trips with a deactivated owner" and the task text. Behavior-preserving alternative if wanted: read the persisted role in `promote`. Needs the user's confirmation; not changed.
4. **NON-BLOCKING, disclosed.** Real-Postgres-only behavior stays on the `docs/hosting.md` smoke list.

## Verification

Inner loop: `routes.test.ts` 52 passed; `npm run typecheck` in `apps/api` exit 0.

Scoped gate `npm run verify:api` (final run):

```
 Test Files  524 passed | 6 skipped (530)
      Tests  4058 passed | 54 skipped (4112)
   Start at  01:33:07
 Statements   : 96.68% ( 321/332 )
EXIT: 0
```

Honesty note: the first gate run in this pass exited 1 with `1 failed | 4057 passed` (`Test Files 1 failed | 523 passed`); the failing test name was lost in the log noise. A plain `npx vitest run` and a second `npm run verify:api` straight after both passed in full, so I treat it as a load-dependent flake (the suite runs long pg-mem property tests in parallel), but I did NOT identify it. If it reappears, run with `--reporter=dot` to capture the name.

Not run, on purpose: the full `npm run verify` and the pin gate.

## Behavior -> test map (this pass)

| Behavior | Test and assertion |
|---|---|
| Reauth route carries the login-budget rate limit | `routes.test.ts` "answers the sixth wrong-password call ... 429": calls 1-5 are 403, call 6 is 429 `rate_limit_exceeded`, `verifyCalls` length stays 5 |
| Bucket is per session token | same describe: after token A is blocked, token B of the same user answers 200 |
| Confirmation route is not throttled by the reauth budget | same describe: seven calls never 429 |

## Checkboxes

`tasks.md` boxes 9.1-9.4, 10, 11 stay ticked (the gate is green after this pass).

---

# account-deletion: code status, chunk D (tasks 12.1-12.5 visibility retrofit, checkpoint 13)

First pass (no `review-chunk-d.json` existed). Nothing committed, staged or pushed. No real env file touched (`git status` shows only `apps/api/.env.example`, edited in task 2.1). No scratch files; the working tree holds only source, tests and spec/status edits.

## Conversions (writes stay on base tables; reads go through `profile_identity`, `active_friendships`, `active_trip_memberships` or `ACTIVE_USER_SQL`)

- 12.1: `friends/repo.ts`, `friends/ownerOrFriend.ts`, `auth/profileRoutes.ts`, `stats/routes.ts` `targetExists`, `friendFoodRatings/repo.ts`, `pins/repo.ts` `reconcileAll`, `sharing/repo.ts` (inbox, single share, `countUnreadInbox`, recipient check, read-time `scrubSharePayload`), `sharing/tripRecapGate.ts`, `reactions/repo.ts`, `notifications/directory.ts`.
- 12.2: `trips/repo.ts` (rosters, invites, feed, comments, reactions, log entries, tags, planned items, summary, group favorites, tag validation, invite friend check), `tripBooking/repo.ts`, `foodLists/repo.ts`, `experienceLists/repo.ts`, the two trip list-owner ports (moved to `trips/listResolvers.ts`), `photos/repo.ts`, `photos/recapPhotoPort.ts`, `photos/feedPhotoPort.ts`, `photos/reportsRepo.ts`. `sharing/tripRecap*.ts` attribution and `trips/summary.ts` needed no edit of their own (the gate and `getSummary` carry them). `passwordResetRepo.ts` already passes the guard by rule 3 (chunk C).
- 12.3: `tripExpenses/repo.ts` (`findNonVisibleParties`, `trip_party_deleted` on create and edit before the membership check, public ids on every read, raw-roster `getNetBalances` plus parties found in the data, CSV names through `resolvePublicIds`); `resolvePublicIds` added to `accountDeletion/visibility.ts`. The route file needed no edit: the 409 comes from the repo.
- 12.4: `admin/repo.ts` and `admin/routes.ts` as the design's Admin section.
- 12.5: `__tests__/guardScan.ts` (TypeScript compiler API scanner), `visibility.guard.test.ts`, `trip_memberships.guard.test.ts`, `visibility.surfaces.guard.test.ts`.

## Deviations and findings (flagged; design.md has an additive "As built (task 12)" note)

1. **Photo queries use `LEFT JOIN users ou ... (p.owner_id IS NULL OR ou.deletion_state = 'active')`, not the correlated `EXISTS` the design wrote.** pg-mem cannot plan a correlated `EXISTS`; `photos/repo.test.ts` failed on it. Same semantics (orphaned photos still served as before), a primary-key join, passes guard rule 3.
2. **`listLogEntries` now reads tags in a second query** (`ANY($1::uuid[])`, mapped through `resolvePublicIds`) instead of a `json_agg` subquery. Needed so the tagged member is emitted as the placeholder id and so pg-mem can run it. `repo.readProjections.prop.test.ts`'s fake pool gained the two statements.
3. **The design's "who-reacted list" for Trip reactions does not exist in the code.** The only read of `trip_reactions` is the per-item count in `getFeed`; it is converted and tested (count 1, then 2 after restore). No list was invented.
4. **Appendix B client row** ("Unread-share attention items", `useAttention.ts`) is task 14.4 (mobile), not this chunk. The server half (`countUnreadInbox`, `listPendingRodeWithTags`) is done and tested.
5. **Fixture blast radius.** About 60 existing test files applied partial migration lists or matched SQL text. Fixed: added `0013`/`0015`/`0064` to the pg-mem fixtures; three suites that store free-text avatar presets keep their `ALTER TABLE ... avatar_preset TEXT` and add `0015` + `0064`; fakes now match `FROM active_friendships`, `FROM profile_identity`, `FROM active_trip_memberships`, `SELECT u.id FROM users u`, `SELECT fr.sender_id`; the food-rating route test builds the minimal `users` + `active_friendships` view. No assertion was weakened.
6. Prose strings in `dispositions.ts` that said `DELETE FROM users` were reworded (the guard reads literals, and prose is not a query) instead of allowlisted.

## Guard pins (the guards' own reports on the finished tree)

Visibility guard: `composeServices.ts` 1, `services/accountDeletion/repo.ts` 7, `services/admin/repo.ts` 5, `services/auth/routes.ts` 4, `services/friends/repo.ts` 1, `services/tripExpenses/repo.ts` 1. Roster guard: 13 files (`trips/repo.ts` 5, `tripExpenses/repo.ts` 7, `foodLists/repo.ts` 5, `tripExpenses/routes.ts` 2, `experienceLists/repo.ts` 2, `trips/effectiveRole.ts` 2, `accountDeletion/repo.ts` 3, and six files with 1). Every entry carries a one-line reason in the test file.

## Verification

Inner loop: each new file run to green on its own; `npm run typecheck` in `apps/api` exit 0. Mutation checks (temporary edits, reverted, confirmed by search): removing the active-sender join from `countUnreadInbox` fails the badge test and its property test; switching `getNetBalances` to the view fails the roster guard pin.

Scoped gate, run once at the end: `npm run verify:api` from the repo root.

```
 Test Files  533 passed | 6 skipped (539)
      Tests  4153 passed | 54 skipped (4207)
   Start at  02:27:30
   Duration  117.04s
Statements   : 96.68% ( 321/332 )   (src/services/planning/** coverage threshold met)
EXIT: 0
```

(An earlier run of the same gate failed on `repo.readProjections.prop.test.ts`, which I had broken with change 2; fixed and re-run.) +9 files, +98 tests over chunk C. Not run, on purpose: the full `npm run verify` and the pin gate (no catalogue file changed).

What this proves: nothing else broke and the new tests pass against pg-mem and fakes. It does not prove real-Postgres behavior; see "Not verified".

## Behavior -> test map

| Behavior | Test and assertion |
|---|---|
| Friend search omits a pending person, never returns their email; found after restore | `visibility.social.test.ts` searchUsers: `[]` for name and email while pending, `[{id,displayName,email}]` after restore |
| Friends list and both request directions omit a pending person; real values after restore | same file "listFriendsAndRequests": friends `[CAROL]`, incoming `[DAVE]`, outgoing `[]`, JSON lacks id and name; after restore all present |
| Send to a pending recipient is `friend_recipient_unknown`; accept and decline find nothing, nothing written | same file: `rejects.toMatchObject({code})`, `friend_requests` count 1 and `friendships` count 0 after accept/decline attempts |
| `GET /me/friends` route level | same file: friends `[CAROL]`, `incomingRequests []`, body lacks SUBJECT id; 2 and 1 after restore |
| Owner-or-friend gate, profile route, Pin Showcase route | same file: `profile_forbidden` / 403 while pending, 200 and the real name after restore |
| Stats deny path 403 vs 404 (R5.6) | same file: pending friend and never-existing id give identical `{status, code: 'stats_target_not_found'}`; active non-friend stays `403 profile_forbidden`; the repo proxy throws if read |
| Friend food ratings, pins `reconcileAll` | same file: `friendId`s `[CAROL]` then both; `usersProcessed` 3 (pending), 3 (purging), 4 (restored) |
| Share inbox per payload kind (Property 20) | same file `it.each` over the four kinds: `senderId` = placeholder, name `Deleted user`, embedded owner id/name replaced for `pinShowcase`/`tripSummary`, `experience`/`progress` equal, stored `payload_snapshot` string unchanged, `openShare` same, real values after restore |
| `countUnreadInbox` across states (Property 18) | same file: active+pending 1, purging 1, restored 2, tombstone 1; `listInbox` length 2 in every state; fast-check 100 runs: badge = unread from active senders |
| Recipient picker / `createShareAtomic`; Sent list | same file: `share_atomic_rejected`, `shares` empty; after restore `deliveredTo` 2; Sent list unchanged in both states |
| Share-reaction names, notification sender name, recap gate | same file: `reactorId`s `[CAROL]` then both; resolver `Deleted user` then real; `gate.resolve` null then `{sharerId, tripAvailable}` |
| Trip roster, invites both ways, tag validation, group favorites | `visibility.trips.test.ts`: `listMembers` omits SUBJECT, `listPendingInvites []`, `GET /me/trip-invites` `[]` then one, `trip_not_friend`, `trip_validation_failed` and no log row, favorites count 2 then 3 |
| Feed actor/comments/reactions (Property 18) | same file: `actorDisplayName` `Deleted user`, `actorAvatarPreset` null, reactions `count 1` then `2` with the stored reaction row untouched, comment `authorId` placeholder |
| Log entries, pending tags (also `purging` tagger), rode-with confirmation, planned items, summary | same file: `memberId` placeholder, `taggedMemberId` placeholder, `listPendingRodeWithTags []` (pending and purging) then 1, `Deleted user` adder/tagger/member |
| Booking: reminder roster, packing list, assignee rejection, done marks | same file: recipients `[BOB,CAROL]` then three, `addedById` placeholder, `assigneeId` null, `addPackingItem` rejects, done mark name `Deleted user` then real, `setPacked` never reveals the id |
| Food and experience lists (detail, discovery, shares, saved, share-to-friend) and the trip list resolvers | same file: `*_list_not_found`, discovery excludes, `listShares` omits SUBJECT, saved `available:false` then true, `*_share_not_friend`, resolvers `null` then the list |
| Photos pending owner absent, no status change, back after restore (Property 19) | `visibility.photos.test.ts`: dish/experience gallery, Album, highlights, recap highlights/album/`isAlbumPhoto`, feed slot `removed`; statuses JSON identical before and after; Blocked-users list, `getProfile` null, `friendIdsAmong` empty |
| Money zero-sum with pending and tombstone parties (Property 13) | `visibility.money.test.ts`: `sum(net) === 0`, alias row `-1000`, pending member with no activity listed at 0, tombstone row; fast-check 100 runs across active/pending/purged |
| `trip_party_deleted` on create/edit, delete allowed, guest sponsor (Property 29) | same file: real id, alias, tombstone id, payer, recipient, even participants, settlement all reject and write nothing; stored-party edit rejected, row unchanged, delete 204; guest of pending/purged sponsor rejected, active accepted; `findNonVisibleParties`; route 409 body lacks the id; fast-check 100 runs |
| CSV prints `Deleted user` | same file: contains `Deleted user: $10.00`, no id, alias, tombstone id or real name |
| Admin lookups, growth totals, ledger buckets, pages | `admin/__tests__/repo.deletion.test.ts` (active/pending/tombstone, totals 1 active + 1 pending, `lastPurgeAt`, UTC-midnight buckets `[1,2,0,0,0,1,0]`) and `routes.deletion.test.ts` (Deletion card, attempts text only above zero, no purged id/email, no deletion control, "never") |
| Structural guards | `visibility.guard.test.ts`, `trip_memberships.guard.test.ts`, `visibility.surfaces.guard.test.ts`: negative fixtures, synthetic unlisted/changed-pin reports, live-tree pins |

Every Appendix B row has a pg-mem test except: **Push delivery** (no change on the delivery path; the request transaction deletes registrations, tested in `repo.request.test.ts`), **Highest-rated leaderboard**, **Self reads** (n/a), and **the client filter in `useAttention.ts`** (task 14.4).

## Not verified

pg-mem cannot plan correlated sub-selects, `to_char`, `NULLIF`, `ESCAPE '\'` or `unnest`; the tests shim those statements only (the SQL under test is unchanged and listed in each file's header). Postgres planning of the new joins, the `ANY($1::uuid[])` forms and the `LEFT JOIN users` photo queries is not exercised; the operator's real-Postgres smoke list in design.md should include a gallery, an inbox and a net-balance read with a pending account.

## Checkboxes

`tasks.md`: 12.1, 12.2, 12.3, 12.4, 12.5 and 13 ticked after the gate above exited 0. The parent task 12 line is left for the orchestrator.

---

## Chunk D, iteration 2 (review-chunk-d.json findings)

1. **BLOCKING, fixed: feed rode-with list was converted but unasserted.** New test in `accountDeletion/__tests__/visibility.trips.test.ts` ("feed rode-with list: the repo's own correlated subquery ..."). It records the SQL `getFeed` really sends, cuts the `json_agg` subquery out by text, binds `le.id` to a seeded log entry id and runs that text on its own. pg-mem planned it once `json_build_object` (the one fixed signature the subquery uses) was registered in the test; pg-mem also returns the aggregate wrapped in an extra array, which the test flattens (commented). Assertions: pending tagged member = `{taggedMemberId: deadc0de-..., displayName: 'Deleted user', state: 'pending'}`; the confirmed active tag keeps the real id and name; neither the real id nor name appears in the JSON; after `restore` the real id and name return; the cut SQL contains `JOIN profile_identity pr` and not `rwt.tagged_member_id,`.
   Litmus: with the conversion reverted in `trips/repo.ts` (`'taggedMemberId', rwt.tagged_member_id,`) the test failed (`expected ... not to contain 'rwt.tagged_member_id,'`); conversion restored afterwards.
2. **NON-BLOCKING, not changed (behavior decision): guest add/rename under a pending sponsor** still passes the raw `trip_memberships` check in `tripExpenses/routes.ts`. Rejecting at add time would be a new user-visible 4xx that no requirement describes (R12.11 covers expense create/edit only), so I did not invent it. Orchestrator/user decision; behavior-preserving default is today's.
3. **NON-BLOCKING, no change: `rode_with_count`.** Count and list read the same `rode_with_tags` rows and the list shows non-visible taggers as the placeholder (it is not filtered), so count equals list length. Filtering only the count would make them disagree; this is PLACEHOLDER, not OMIT, so left as is.
4. **NON-BLOCKING, done: `sharing/repo.ts` `openShare`** now carries a SQL comment explaining why `COALESCE(p.is_visible, true)` is safe (every user, tombstones included, always has a profile row).

### Verification (iteration 2)

`npm run verify:api` run after the edits: typecheck clean for api/mobile/shared; `Test Files  533 passed | 6 skipped (539)`, `Tests  4154 passed | 54 skipped (4208)`; EXIT 0 (previous 4153 + the one new test). One earlier run in this iteration failed `tsc` (`visibility.trips.test.ts(215,9) TS2322`, my `registerFunction` return type was `unknown`); fixed to `Record<string, string>`; `npx tsc -p apps/api/tsconfig.json --noEmit` EXIT 0 and verify:api re-run EXIT 0. No scratch files; no real env file touched; nothing staged or committed.

### Behavior -> test (delta)

| Behavior | Test and assertion |
| --- | --- |
| Feed rode-with list shows a pending tagged member as placeholder id / `Deleted user`, real values after restore | `visibility.trips.test.ts` feed rode-with test: `toEqual({taggedMemberId: PLACEHOLDER, displayName: 'Deleted user', state: 'pending'})`, then the real id/name after `restore`; fails when the conversion is reverted (shown above) |

`tasks.md` boxes 12.1-12.5 and 13 stay ticked (verification passed again).

---
## Chunk E (tasks 14.1-14.4, 15): mobile flow
No `review-chunk-e.json` existed, so this is the from-scratch implementation. Nothing staged or committed; no real env file touched; `ProfileScreen.tsx` untouched.

### What changed
- 14.1: `state/sessionStore.ts` (non-persisted `accountDeletionNotice`, `accountRestoredNotice`, setters/dismissers; `clearToken` unchanged), `hooks/useAnnounceOnMount.ts`, `components/AccountDeletionNotice.tsx`, `components/AccountRestoredNotice.tsx`.
- 14.2: `screens/youAndCrew/DeleteAccountScreen.tsx`, `screens/authCopy.ts` (shared lockout copy, now also used by `LoginScreen`), `DeleteAccount` registered in `navigation/YouAndCrewStack.tsx`, entry row in `YouAndCrewScreen.tsx`.
- 14.3: `LoginScreen.tsx`, `RegisterScreen.tsx`, `ResetPasswordScreen.tsx` (DTO adoption, notice, restored flag), `RootNavigator.tsx` (`MainTabsNavigator` now exported; flex container with `<AccountRestoredNotice />` first).
- 14.4: `components/presentPerson.ts`, `InboxScreen.tsx`, `useAttention.ts`, `screens/trips/tripPartyDeleted.ts`, `ExpenseFormModal.tsx`, `SettlementModal.tsx`, `TripExpensesScreen.tsx`, `TripBalancesScreen.tsx`.

### Judgment calls (flagged, all behavior-preserving or implied by the spec)
1. **Review step cannot show `graceDays`.** The value only arrives with the reauth response, which comes AFTER the review step. The review says "when the grace period ends. The exact number of days is shown before you confirm." and the confirm step shows the server's number ("permanently deleted N days after you confirm"). Never hard-coded; test uses 14 and asserts `not 30 days`.
2. **`setToken` now also clears `accountDeletionNotice`.** Without it the "scheduled for deletion" banner would reappear on the next logout after the user signed back in (which is what cancels the deletion). Pinned in `sessionStore.accountNotices.test.ts`. `clearToken` still leaves it.
3. **Restored flag is set AFTER `await setToken`** so it follows "after the session is stored and the main tabs are shown" and a failed token write cannot leave a stale flag.
4. **Inbox:** a deleted sender's `experience` Share stays tappable (it opens the experience: content, not a person link); every other payload kind is non-pressable and `handleSelect` short-circuits with the existing "profile is no longer available" message (also covers the notification deep link). No friends read is made for a placeholder.
5. **Money screens:** the roster omits non-visible people, so the name maps in `TripExpensesScreen` / `TripBalancesScreen` now add `Deleted user` for placeholder ids found in balances/ledger (otherwise "Member"). The pairwise `Settle` button and the pairwise breakdown's `Log Payment` button are hidden when either party is a placeholder. The hero "Log Payment" prefill is unchanged (a settlement against a placeholder would be rejected with `trip_party_deleted`, which now shows the specified copy).
6. **Not changed, by reason:** `PhotoViewer` "Block uploader" is keyed by `photoId` and has no uploader user id on the client; photos of a pending/purged person are never served (R5.5, D5), so there is no reachable placeholder photo to block. `TripMembersScreen`/feed/comment authors have no profile/compare/friend link, and rosters never contain placeholders (OMIT). `YouAndCrewScreen` friends list is OMIT (never placeholders).
7. **Cleanup on unmount:** password and grant live in `useState`, so they are discarded with the component; they are explicitly cleared on success, Cancel/back, and `reauth_required`. There is no extra unmount effect (it would only set state on an unmounted component).
8. Tests import `generatePlaceholderId` from `apps/api/src/services/accountDeletion/placeholderId.ts` by relative path (the task asks for "a real `generatePlaceholderId` output"). It is a pure module whose only import is `@dwt/shared`; jest and `tsc` both accept it.

### Verification
`npm run verify:mobile` (root, run ONCE after all edits): root typecheck for api, mobile and shared printed no errors, then jest:
```
Test Suites: 335 passed, 335 total
Tests:       2637 passed, 2637 total
Snapshots:   2 passed, 2 total
EXIT=0
```
`themeRetrofit.guard.test.ts` PASS (no allowlist change). Inner loop before that: each new file run with `npx jest <file>`; `npm run typecheck` in `apps/mobile` clean. No full `npm run verify` and no pin gate (out of scope for this chunk).

### Behavior -> test map
| Behavior | Test and assertion |
|---|---|
| Notices are not persisted; `clearToken` leaves the deletion notice; fresh store has none | `state/__tests__/sessionStore.accountNotices.test.ts`: `setItemAsync` never called, `loadFromStorage` after reset gives null/false, `clearToken` keeps the notice |
| `setToken` drops a leftover deletion notice | same file: notice null after `setToken('tok-after-login')` |
| Deletion banner: exact copy with formatted date, `alert` role, dismiss, announced once | `components/__tests__/AccountNotices.test.tsx`: text equals `Your account is scheduled for deletion on <formatPurgeDate>. Sign in before then to cancel.`, role `alert`, `announceForAccessibility` calledTimes(1) and contains the date, survives re-render with 1 call, dismiss nulls the store field |
| Restored banner: exact copy, `alert`, announce once, dismiss | same file: `ACCOUNT_RESTORED_MESSAGE` equals the spec string, calledWith it once, dismiss clears flag, no re-announce on re-render |
| Entry row: testID, role button, label, trash icon + words, below Blocked Users above Log out, navigates | `youAndCrew/__tests__/DeleteAccountFlow.test.tsx` "entry row": role/label asserted, `trash-outline` icon found, tree order `[blocked, delete, logout]`, `navRef` route `DeleteAccount` |
| Review step lists consequences, no hard-coded days | same file: seven consequence texts present, `queryByText(/after \d+ days/)` null; Cancel returns to `YouAndCrewMain` |
| Reauth POST payload; correct password advances and shows SERVER graceDays | same file: calls equal `['POST','/me/account/deletion/reauth',{password}]`; copy matches `/deleted 14 days after/` and not `/30 days/` |
| Wrong password: inline message, stays signed in, field cleared, same step | same file: `Password is incorrect.`, `password` prop value `''`, token still `token-abc`, step password still mounted, no DELETE call |
| Locked: LoginScreen lockout copy | same file: error text equals `ACCOUNT_LOCKED_MESSAGE` = `Account temporarily locked. Try again in 15 minutes.`; `authScreens` test asserts LoginScreen shows the same constant |
| Confirm disabled until trimmed `DELETE` (lower case stays disabled) | same file: `toBeDisabled()` for '', 'delete', 'DELET'; press makes no POST; enabled for `'  DELETE '` |
| Submit payload | same file: `['POST','/me/account/deletion',{reauthGrant:'grant-1',confirmation:'DELETE'}]` |
| Success order and no extra authenticated calls | same file: event log `['cancelQueries','notice','token-cleared','queryClient.clear']`, cache empty, zero `/auth/logout`, zero `DELETE /me/push-registrations`; control test proves the harness would see that DELETE |
| `reauth_required` returns to password step, fresh grant used next | same file: reauth notice text, token intact, then second POST carries `grant-2` |
| Other error inline, stays signed in | same file: server message shown, confirm step still mounted, no notice |
| Pending disables submit / Verify | same file: `toBeDisabled()` while deferred, second press leaves exactly 1 POST (both steps) |
| Labels / alert roles / dark theme | same file: `accessibilityLabel` values, error `accessibilityRole==='alert'`, dark root background equals `darkTheme.color.background` |
| Login renders notice above form; no banner when fresh | `screens/__tests__/authScreens.accountDeletion.test.tsx`: banner index precedes `login-body` in the tree; absent on fresh store |
| Login/Reset `accountRestored:true` sets restored flag; absent response does not | same file: store flag true / false; `/auth/login` and `/auth/reset-password` payloads asserted |
| Register: DTO adoption, no notice, no restored flag | same file: banner absent with pending notice, `/auth/register` payload, flag false |
| Delete then sign-in screen shows date banner, token null, no push DELETE, one announcement | same file end-to-end block with a `token === null` mini root |
| Restored notice is first child of `MainTabsNavigator`'s container over the real tab navigator | `navigation/__tests__/mainTabsNavigator.restoredNotice.test.tsx`: `root.children[0].type === AccountRestoredNotice`, tab navigator is a later sibling, announce once, dismiss, no banner without flag |
| Placeholder not tappable, label has "Deleted user", control stays tappable | `components/__tests__/presentPerson.test.ts` and `screens/share/__tests__/inbox.deletedSender.test.tsx` (row not a button, press makes no `/me/friends` or `/open` call, experience share still opens, deep link shows unavailable copy) |
| `useAttention` drops deleted senders | `features/notifications/__tests__/useAttention.accountDeletion.test.tsx`: two unread shares give `['share-ok']`, badge 1; read deleted share absent |
| `trip_party_deleted` copy on expense create/edit and settlement; other errors unchanged; delete allowed | `screens/trips/__tests__/TripExpensesScreen.deletedParty.test.tsx`: exact sentence in `expense-form-error` / `settlement-error-box`, server text absent, control shows `Boom from server.`, DELETE call made |
| Settle control hidden for a placeholder pair (both screens, row and breakdown), named "Deleted user" | same file: `settle-pair-btn-0` absent / `-1` present, `pairwise-modal-settle-btn` absent for pair 0 and present for pair 1, `net-balance-card-<id>` contains `Deleted user` |

### Not covered / not verified
- No device or screen-reader run: `announceForAccessibility` is asserted through a spy, not heard. The restored banner's safe-area top padding is read from `SafeAreaInsetsContext`; its look on a notch device is unverified.
- No real-API run; the mobile contracts are exercised against `apiRequest` mocks shaped like the shared DTOs.
- Parent task line 14 is left for the orchestrator (all four sub-tasks and 15 ticked).

---
## Chunk E, review round 1 (fixes for `review-chunk-e.json`, verdict CHANGES_REQUESTED)
Nothing staged or committed; no real env file touched; `ProfileScreen.tsx` untouched.

### Findings and what was done
1. **Stale restored flag (blocking): fixed.** `sessionStore.setToken` now also resets `accountRestoredNotice` to `false`. Login and Reset set the flag after `await setToken`, so a restoring sign-in still ends with the flag true; a later ordinary sign-in starts clean. `clearToken` is unchanged.
2. **R1.4 wording: spec amended additively, dead branch dropped.** `requirements.md` gains R1.16 (clarifies 1.4: review step names no day count, confirm step shows the server's `graceDays`; nothing renumbered or removed). `DeleteAccountScreen.tsx`: `consequences(graceDays)` with its always-null branch is now the constant `CONSEQUENCES`.
3. **Chained restored flow: covered.** New block in `mainTabsNavigator.restoredNotice.test.tsx` renders the real `LoginScreen` and `MainTabsNavigator` behind a token gate (mocks only `apiRequest`).
4. **Uncovered interactions: covered** in `DeleteAccountFlow.test.tsx` (back button, Cancel on password step, confirm-error alert role, success clears confirmation and grant).
5. Tabs test stubs five tab destinations: left as is (documented, not under test).
6. Tests import `generatePlaceholderId` from `apps/api` by relative path: left as is (task text asks for real generator output).
7. Banner safe-area top inset: needs a device look, not verifiable in Jest. Left unchanged.

### Mutation check
With the `setToken` reset temporarily reverted, the new store test and the new chained regression test both FAILED (2 failed, 11 passed); restored, they pass.

### Verification
Inner loop: `npx jest` on `sessionStore.accountNotices`, `mainTabsNavigator.restoredNotice`, `DeleteAccountFlow` = 3 suites, 40 tests passed. `npm run typecheck` in `apps/mobile`: exit 0. Then `npm run verify:mobile` ONCE (`npm run typecheck && npm run test --workspace apps/mobile`):
```
Test Suites: 335 passed, 335 total
Tests:       2645 passed, 2645 total
Snapshots:   2 passed, 2 total
EXIT=0
```
`themeRetrofit.guard.test.ts` is in that run and green; no allowlist change. No full `npm run verify`, no pin gate.

### Behavior -> test map (round 1 additions)
| Behavior | Test and assertion |
|---|---|
| `setToken` resets an undismissed restored flag; `clearToken` leaves it | `sessionStore.accountNotices.test.ts`: flag true after `clearToken`, false after next `setToken`; fails with the reset reverted |
| Login `accountRestored:true` shows banner first over the tabs, announced once, dismissible | `mainTabsNavigator.restoredNotice.test.tsx` chained block: `/auth/login` payload asserted, `root.children[0].type === AccountRestoredNotice`, text, announce 1, dismiss removes |
| Plain login shows no banner | same block: banner absent, announce not called |
| Stale-flag regression: restored login, logout undismissed, plain login | same block: no banner, token `second-token`, announce still 1; fails with the reset reverted |
| Cancel on password step and header back: no API call, stay signed in, return to You & Crew | `DeleteAccountFlow.test.tsx` "leaving the password step": route `YouAndCrewMain`, zero reauth/delete calls, token intact, back label `Cancel and go back` |
| Returning user sees empty password field | same block: reopen, `delete-account-password` value `''` |
| Confirm error has alert role | same file: `delete-account-confirm-error` `accessibilityRole === 'alert'` |
| Success clears confirmation and grant | same file: confirmation value `''`, re-typing DELETE and pressing submit leaves exactly one POST |
| No day count on review step (R1.16) | existing review test: `queryByText(/after \d+ days/)` null; confirm shows server `14` |

---
# account-deletion: code status, chunk F (task 16 photos guard decision; task 17 docs and housekeeping)
No staging, commit or push; no real env file touched; `photos.guards.test.ts` untouched (absent from `git status`). No review-chunk-f.json existed, so this was implemented from scratch.

## Task 16 (done, verified)
- Added `apps/api/src/services/accountDeletion/__tests__/photosScope.guard.test.ts`: (1) parses `accountDeletion/routes.ts` for every `app.<method>(PATH|'literal')`, resolving `const X_PATH = '/...'`; asserts the distinct set is exactly `/me/account/deletion`, `/me/account/deletion/reauth`, `/internal/account-deletion/purge/run` (4 registrations incl. HEAD), each under `/me/account/` or `/internal/account-deletion/`, none containing `/photos`; (2) a bite test: the parser flags a `/photos/...` route; (3) `it.each` over the four files the photos guard scans: neither `delete-account` nor `account/delete` anywhere (comments included); (4) `/account\/delete/i` and `/delete-account/i` do not match `/me/account/deletion`.
- Verification: `npx vitest run src/services/photos/__tests__/photos.guards.test.ts src/services/accountDeletion/__tests__/photosScope.guard.test.ts` in apps/api:
```
 Test Files  2 passed (2)
      Tests  19 passed (19)
```
Exit 0. `tasks.md` task 16 ticked.

## Task 17 (edits done; NOT ticked, see "Not verified")
- `docs/privacy-policy.md` section 4: deleted-accounts bullet (30-day default grace, purge runs as a batch job so may finish hours after), database-backups bullet (ages out on the provider's schedule; no retention period stated because it is not verified). Section 5: "Delete Your Account" bullet (You & Crew -> Delete account, password re-entry, type DELETE; email+password only, no third-party provider token, R13.1; grace period; signing in or resetting the password cancels; what is deleted; what is kept anonymized; email freed).
- `docs/photos-runbook.md`: new subsection "Account Deletion Calls `deleteAllForUser`" under section 4 (R15.4).
- Confirmed present: `render.yaml` `ACCOUNT_DELETION_CRON_SECRET` (`sync: false`), `apps/api/.env.example` (secret + five tuning vars), `docs/hosting.md` "Dedicated Account Deletion Cron (Purge_Cron)".
- `design.md` (additive): sentence on `GET /me/inbox/unread-count` retained for API consumers/tests, badge derived from `['inbox']` via `selectUnreadShares` (verified in `useAttention.ts`; the endpoint has no non-test mobile consumer); `PurgeRunnerDeps.lockout` comment now ends "best-effort: a Redis failure is logged at warn and never fails the account". Matching code comment already in `ports.ts` (task 8.1).

## Behavior -> test map
| Behavior | Test and assertion |
|---|---|
| Deletion routes only under `/me/account/` and `/internal/account-deletion/`, none under `/photos` | `photosScope.guard.test.ts` set equality of resolved paths, `startsWith` prefix check, `/photos` absent |
| Guard parser is not vacuous | same file bite test on a synthetic `/photos/delete-me` route |
| Four photos-guard files carry neither phrase, comments included | same file `it.each` x4, `not.toMatch` both regexes |
| Photos guard still passes unchanged | `photos.guards.test.ts`, 19 passed together with the new file |
| Docs / design edits | documentation only; no test asserts them |

## Not verified
- The Kiro Spec Format validator (diagnostics) is NOT available to this agent: no diagnostics tool exists in this session. The 12 files were NOT validator-checked and must not be claimed clean. A manual regex scan of requirements/design/tasks of the nine specs found only `- [ ]` / `- [x]` markers, except `disney-world-tracker/tasks.md:730` (`- [x]* 22.8 ...`, an optional-task `*` suffix; the file is unmodified in `git status`, so it is pre-existing). That scan is not the validator.
- Task 17 is therefore left unchecked in `tasks.md` until the validator is run on the files edited here (`design.md`, `tasks.md`) and the eight amended specs.
- Privacy-policy statements about what is kept/deleted come from `dispositions.ts` and R15.3; the 30-day figure is the config default, not the deployed value.
- No full `npm run verify`, no pin gate (per instruction); it is task 18.
