# Account deletion chunk C (second pass): session defense, deletion and cron routes, restore on login/reset, effectiveRole

Chunk C closes the API core of account deletion. The session middleware rejects any session whose user is not `active` and exposes `request.sessionId`. Two session-gated `/me/account/deletion` routes and a cron-secret-gated purge route are added. Login, forgot-password, reset and the web fallback restore a pending account inside the grace window. Trip authorization gets a pure `effectiveRole` (interim organizer) read from exactly three places. This pass re-checks the one blocking finding from the first review (the reauth rate limit had no route-level assertion). It is now covered by a behavioral test on the real route, and the single re-run test file is green. No new blocking issue was found.

Watch for: an unidentified one-off failure in the coder's first gate run this pass (disclosed, later runs green, possible); reset without the restore port still admits a pending account (confirmed, test-double-only); promoting the interim organizer answers `trip_role_invalid` (confirmed, disclosed).

**Verdict**: APPROVED

## High-level view

The authentication surface is closed. Both `/me` routes sit behind `requireSession` and re-check that `userId` and `sessionId` are present. Both `/internal` routes call `secretMatches` against `app.config.accountDeletion.cronSecret` before `tryStart()` and answer 202 `accepted` or `skipped/in_flight`, HEAD with an empty 202. No new unauthenticated endpoint exists, and the existing public auth routes treat ineligible accounts exactly like unknown emails.

Reauth does no password work when locked, maps a wrong or missing hash to `reauth_failed` (403, never 401), records one failure, and never clears the counter. Nothing the caller submits reaches a logger. The reauth route carries the login-budget rate limit keyed on the hashed bearer token, and that registration is now pinned by a test that fails if it is removed.

Login treats `ineligible` as the unknown-email path, restores before minting a session, and fails closed on a missing port or `not_restorable`. Reset and the web fallback share one clock between the eligibility lookup and `restoreInTx`; `completeReset` runs the restore first and rolls back on `not_restorable`.

`effectiveRole` is pure, adds no `TripAction`, and is read only from `assertTripMember`, `lockMemberRole` and the trip-share `roleOf`, pinned by a guard test.

<details>
<summary>Issues (3)</summary>

1. **Reset without the restore port still changes the password of a pending account (non-blocking, confirmed)** — with `accountRestore` undefined, `handleResetPassword` and the web POST skip the restore hook but the lookups still admit a pending-in-grace account. Production always wires the port and logs an `error` at registration if it is missing, so this only affects test doubles. Optionally treat a restorable account with no port as `invalid_code`.
2. **Interim organizer cannot be promoted (non-blocking, confirmed, disclosed)** — `lockMemberRole` returns the effective role, so `promote` on the interim organizer answers `trip_role_invalid` and writes nothing. It follows the task text and design; confirm this is intended, or read the persisted role in `promote`.
3. **Unidentified failure in one gate run (non-blocking, possible)** — the coder's first `verify:api` this pass exited 1 with one failed test whose name was lost; two later runs passed. If it recurs, run with `--reporter=dot` to capture the name. Real-Postgres-only behavior (`FOR UPDATE` with the `EXISTS` column, `Date` params in the eligibility predicates, the `JOIN users` session query) also stays on the `docs/hosting.md` smoke list.

</details>

<details>
<summary>Details</summary>

## Reauth rate limit is now asserted on the real route

The earlier gap: `reauthRateLimitConfig()` was tested only on a toy route, so deleting `config: { rateLimit: reauthRateLimitConfig() }` from the real reauth route left the suite green. `accountDeletion/__tests__/routes.test.ts` now builds the app with a `withRateLimit` option that registers the real `registerRateLimit` with a global budget of 1000, so only the route override can produce a 429. Five wrong-password calls on one token answer 403 and the sixth answers 429 `rate_limit_exceeded`, with `verifyCalls` and `recordFailure` both staying at 5, so the blocked call does no password work. A second token of the same user is not blocked, and seven calls to the confirmation route are never throttled by the reauth budget. The coder reports a mutation check (remove the config, tests fail) and I re-ran the file: 52 passed, exit 0. I did not repeat the mutation. The assertion shape (global budget far above the route budget) makes a false pass unlikely.

## Reset and web fallback when the restore port is absent

```
lookup (admits pending in grace)  ->  completeReset(no restoreInTx)  ->  password changed, session minted
```

Login guards this with an explicit fail-closed branch; the reset handlers only skip the hook. It cannot occur in production composition.

## Interim organizer through promote

`lockMemberRole` returns the acting role, so promoting the interim organizer reads as already an organizer and writes nothing. Other members promote normally.

## Gate evidence

The coder's pasted tail shows `Test Files 524 passed | 6 skipped`, `Tests 4058 passed | 54 skipped`, `EXIT: 0` for `npm run verify:api`, and a transparent note about the earlier red run. The full `npm run verify` is correctly deferred to the end of the whole change.

</details>

<details>
<summary>File map</summary>

- `auth/sessionMiddleware.ts`: `deletion_state` rejection, `request.sessionId`
- `composeServices.ts`: account-deletion wiring, `accountRestore` into `authRoutes`, session adapter joins `users`, trip-share `roleOf` via `resolveEffectiveRole`
- `server.ts`: registers `accountDeletionRoutes`
- `plugins/rateLimit.ts`: `reauthRateLimitConfig`
- `accountDeletion/routes.ts` (new): reauth, request, purge cron routes
- `auth/routes.ts`, `auth/passwordResetRepo.ts`: eligibility, restore on login/reset/web, `restore_lost`
- `trips/permissions.ts`, `trips/effectiveRole.ts` (new), `trips/authz.ts`, `trips/repo.ts`: effective role
- `docs/hosting.md`, `render.yaml`: Purge_Cron docs and secret key
- `test/smoke/harness.ts` plus fixture files: migration 0064 / `deletion_state` added to partial harnesses
- `accountDeletion/__tests__/routes.test.ts`: new real-route rate-limit describe (this pass)

Full diff: `git diff` plus the untracked files in the working tree.

</details>
