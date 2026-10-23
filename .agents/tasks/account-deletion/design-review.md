# Design Review: account-deletion (round 5, re-review after the round-4 fix pass)

Reviewed: `.kiro/specs/account-deletion/design.md` (1732 lines, including the Round 1 to 4 responses) and `requirements.md` (including the new R5.14), against `AGENTS.md`, `.agents/AGENTS.md` and every file in `.kiro/steering/` (`tech-conventions`, `execution-discipline`, `pin-collection`, `pin-collection-detail`), and against the prior review (round 4: 0 HIGH, 2 MEDIUM, 6 NIT). Design review only: no builds or tests were run. I read the code paths the two MEDIUM findings referenced.

**Verdict: APPROVED.** 0 HIGH, 0 MEDIUM, 2 NIT.

Both prior MEDIUM findings are genuinely resolved, checked against source and not against the design's own account of the fix. The six prior NITs were also addressed. No new HIGH or MEDIUM issue was introduced by the round-4 edits.

---

## Prior MEDIUM findings: resolution check

### Prior finding 1 (Notification_Center omission): RESOLVED

What I checked in the code:

- `apps/mobile/src/features/notifications/useAttention.ts` builds the attention feed from exactly four reads: `GET /me/friends` (line 332), `GET /me/trip-invites` (350), `GET /me/rode-with-tags?state=pending` (371) and `GET /me/inbox` (390, mapped by `selectUnreadShares`, line 224). That is the set the design's "Notification_Center: the pending-versus-purged rule" subsection names.
- `sharing/repo.ts countUnreadInbox` is currently `FROM share_recipients sr WHERE recipient_id = $1 AND opened_at IS NULL AND recipient_deleted_at IS NULL`, with no sender join. The design now joins `shares s` and `users su` with `ACTIVE_USER_SQL('su')` (pending, purging and tombstone senders excluded). The join is expressible against the real schema (`share_recipients.share_id`, `shares.sender_id`).
- `trips/repo.ts listPendingRodeWithTags` (line 3903) currently does `JOIN profiles p ON p.user_id = tle.member_id`. The design converts that to `profile_identity` with `AND p.is_visible`. The select list is unchanged, so the DTO is unchanged.
- `Inbox.ts` and `schemas/Inbox.ts` carry `senderId: uuidSchema`. The design's placeholder id is a valid v4-shaped UUID with the `deadc0de-` prefix (design line 218), so `isDeletedUserId(senderId)` in `selectUnreadShares` works on a real DTO and the Zod check accepts it.
- The omission is now consistent across all three read paths. The two server reads (`countUnreadInbox`, `listPendingRodeWithTags`) and the one client filter (`selectUnreadShares`) follow one rule: the counterparty must be an active account. The design records why "pending only" was declined (the client cannot tell an alias from a tombstone) and states the accepted consequence (the inbox screen's own `unread` field can exceed the indicator).
- Requirement R5.14 exists in `requirements.md` (line 215) and backs the rule. Property 18 gains a Notification_Center clause and its `Validates:` line now lists 5.4 and 5.14. The Testing Strategy lists pg-mem tests for both reads (active, pending, purging, restore, tombstone) and a Jest `useAttention.accountDeletion.test.tsx`. The new `countUnreadInbox` literal contains `ACTIVE_USER_SQL(`, so it passes the visibility guard by rule 3 and needs no allowlist pin.

### Prior finding 2 (service/runner deps, Logger port, mail wiring): RESOLVED

What I checked in the code:

- `composeServices.ts` has no `createMailService` call. The only call is in `auth/routes.ts:191` (`options.mailService ?? createMailService({ logger: app.log })`). That matches the design's claim.
- `createLogger` is imported from `./logger.js` (line 172) and already used as `notificationLogger` (line 399), so a compose-time `accountDeletionLogger = createLogger()` is buildable.
- `createLockoutService(redis as never)` is `const lockout` at line 771. The photos block starts near line 825 and ends before `authRoutes({ pool, lockout, requireSession: sessionMiddleware })` at line 1220. So "build the service after the photos block, pass it to `authRoutes` at registration" is ordering-correct.
- `password.ts` exports `verify(encoded, plaintext)`. `config.session.secret` exists (`config.ts:645`). `createAggregateRepo(pool)` is `aggregateRepo` (line 224), and `recomputeFromScratch` is on it. `LockoutService` has `isLocked`, `recordFailure(userId, at?)` and `clearOnSuccess`, which matches `LockoutPort`.
- `MailServiceOptions.sendFn`'s payload has optional `code` and `resetUrl` only, so the two new templates can call `transport({ from, to, subject, html, text })` without changing the type. The `FastifyBaseLogger` versus `pino.Logger` assignability is not compiler-checked, and the design says so and records a narrowing fallback (`Pick<FastifyBaseLogger, 'info' | 'error'>`).
- The new "Factories and dependencies" subsection fixes `LoggerPort`, `Scheduler`, `AccountDeletionServiceDeps`, `ReauthResult`, `DeletionRequestResult`, `AccountDeletionService extends AccountRestorePort` (thrown `AppError` codes per method) and `PurgeRunnerDeps`, including the `afterTripLocked` test seam that composeServices never sets. The recording logger shape (`createRecordingLogger()`) is defined, so "a captured logger shows the alert `error` exactly once" has a fixed seam. `getEmail(userId)` is added to the repo so `notifyRestored(userId)` has an address.
- "One object implements `AccountRestorePort`: the service" is stated, and the Wiring bullets 1 to 5 enumerate every constructor argument.

---

## Findings

### 1. NIT: `GET /me/inbox/unread-count` has no non-test mobile consumer, so "server count and client feed agree" is weaker than the text implies

**Where:** design.md "Notification_Center: the pending-versus-purged rule"; Property 18 final clause ("so the server count and the client feed agree on every state").

**Problem:** A search of non-test `apps/**/src` finds the route only in `sharing/routes.ts`. The mobile attention hook never calls it; the badge is derived from the `['inbox']` read through `selectUnreadShares`. The server change to `countUnreadInbox` is still correct (the endpoint exists and R14.1 names the count), but the real user-visible guarantee comes from the client filter and the `listPendingRodeWithTags` conversion, not from the count agreeing with a feed.

**Fix:** Add one sentence saying the unread-count endpoint is retained for API consumers and tests and that the app's badge is derived from the feed. No behaviour change.

### 2. NIT: `PurgeRunnerDeps.lockout` exists for an end-of-stage-4 cleanup, but `LockoutPort` is also the sole path that touches Redis in the purge

**Where:** design.md "Factories and dependencies", `PurgeRunnerDeps.lockout` comment ("end-of-stage-4 clearOnSuccess cleanup (R9.11)").

**Problem:** If Redis is unavailable, a `clearOnSuccess` throw after the user row is already deleted must not release or re-run the claim. The design's Error Handling and Property 33 (ledger outcome decided before the row that carries it) imply the answer, but the runner deps comment does not say the cleanup is best-effort.

**Fix:** Append "best-effort: a Redis failure is logged at `warn` and never fails the account" to that field comment, matching how mail failures are treated.

---

## Verified Assumptions

- The Notification_Center feed inputs are the four reads above; the two server sources are `countUnreadInbox` and `listPendingRodeWithTags`, and both are now assigned an explicit mechanism, a pinned test and a requirement (R5.14).
- `createMailService` is not built at compose time today; `authRoutes` builds it with `app.log`; `createLogger()` exists and is used at compose time.
- `lockout` is defined (line 771) before the photos block; the `authRoutes` registration (line 1220) is after it, so the service exists when it is passed.
- `secretMatches` is exported from both `photos/sweepCronRoute.ts:20` and `tripBooking/passGate.ts:24` (round-4 NIT 3 wording is now accurate).
- `senderId` is `uuidSchema` in the Inbox DTO and schema; the placeholder id format is UUID-valid, so the alias flows through existing validation.
- `config.session.secret` and `createAggregateRepo`/`recomputeFromScratch` exist as the wiring uses them.
- All other items verified in the round-4 review (69 FKs, migration number, cron pattern, photo guard plan, session plumbing, config fixtures, trip behaviour, additive spec amendments, property/Validates format) were not touched by the round-4 edits except where noted above, and I saw no regression.

## Unverified / Wrong Assumptions

- **Not verified (the design says so):** that `pino.Logger` is assignable to `FastifyBaseLogger` in `MailServiceOptions` (no `tsc` run; the narrowing fallback is recorded); pg-mem behaviour of the new `countUnreadInbox` join and the `profile_identity` view join (no new construct, but not executed); real-Postgres behaviour of the chunk and tombstone statements.
- **Not run:** the Kiro spec validator on `design.md` and `requirements.md`. By reading only, every `### Property N` heading still has a `**Validates:**` line and no non-standard checkbox marker was introduced.
- **Wrong assumptions found:** none that block implementation.
