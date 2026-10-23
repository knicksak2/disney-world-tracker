# Account-deletion service, mail templates and in-process purge runner (chunk B, task 8)

Chunk B adds the typed ports and dependency bags (`ports.ts`), the reauth/request/restore service (`service.ts`), two additive mail templates in `auth/mailService.ts`, and the single-flight purge runner (`purgeRunner.ts`) with its budget helper. It follows design.md "Stuck accounts", "Purge procedure" and "Run shape" closely, and the one self-declared deviation (always running the share scrub in stage 3) is justified by the design's own repair rationale. Evidence of a green scoped gate is in code-status.md and the tests assert real behavior against the real repo on pg-mem. Watch for: a logging gap in the mail transport that is outside this diff's logic but now carries deletion-mail recipients (possible, non-blocking), and the "admin lookup reads 5" clause of task 8.2 that cannot be tested until the admin task exists (confirmed, non-blocking).

**Verdict**: APPROVED

## High-level view

The service is a thin ordering layer over injected ports. Reauth refuses a locked account before touching the password, records exactly one failure on a wrong password, issues a hashed grant only on success, and never clears the lockout counter. The phrase check runs before any repo call, so a wrong phrase cannot consume the grant. One `scheduledPurgeAt` value feeds the repo write, the response and the mail, and a mail failure is logged without recipient or user id and never fails the committed request.

The runner is a plain in-process loop: no queue library, no Worker, no subscription, only local imports. An idle pass is exactly the recompute-queue read plus a claim that matches nothing. The budget is checked before the claim, between accounts, before every stage, before finalize and before every chunk, and on expiry the claim is released with `purge_stage` left at the completed count. Failures follow the design table: a thrown stage records a relative failed attempt, `refs_remain` rewinds to stage 0 and writes the absolute `c.attempts + 1`, a fenced result stops quietly, and the lockout cleanup at the end of stage 4 is best-effort with `recordWarning`.

Stage 3 deviates from the literal design text by always running the share-scrub loop, so a crash between the sender re-point and the payload scrub is repaired on retry. This is the right call and is pinned by a dedicated test.

<details>
<summary>Issues (4)</summary>

1. **Mail transport logs recipient (possible, non-blocking)** — `defaultSend` in `mailService.ts` logs `to` on the SMTP success path and in mock mode. Deletion mails now flow through it. Pre-existing code, but task 9.4 (which wires the logger into the factory) should decide whether deletion mail recipients are acceptable there against Property 22.
2. **Admin lookup clause of task 8.2 untested (confirmed, non-blocking)** — the five-run test reads `users.purge_attempts` directly because the admin `purgeAttempts` lookup does not exist yet. The admin task must carry the assertion that the lookup returns 5.
3. **Double `purge_warnings` on resume (possible, harmless)** — if stage 4 is interrupted after `recordWarning` and re-run, the cleanup throws again and the counter reaches 2. The ledger only checks `> 0`, so the outcome is unaffected. No action needed unless the counter is ever shown.
4. **Test-side `purgeDriver.ts` keeps the literal stage-3 behavior (confirmed, non-blocking)** — it has the same latent gap the runner now fixes. It is test-only and the real runner has its own repair test. Update it if a later task reuses it for crash-resume tests.

</details>

<details>
<summary>Details</summary>

## Reauth and request ordering in `service.ts`

`reauth` calls `lockout.isLocked` first and throws `account_locked` before `getPasswordHash` or `verify` run. A missing hash is treated as a failure without calling `verify`. A failure calls `recordFailure` once and throws `reauth_failed`; success computes the expiry from the injected clock and stores only `hashGrant(grant)`. `clearOnSuccess` is never referenced in the file, matching R2.13, and a lockout error propagates so the route fails closed. The tests assert the exact call sequence (`isLocked`, `getPasswordHash`, `verify`, `recordFailure`), that the clear and failure calls are empty on success, and the grant expiry as a 100-run property.

`requestDeletion` compares `confirmation.trim()` to `DELETE_ACCOUNT_CONFIRMATION_PHRASE` (`'DELETE'`) before `computeScheduledPurgeAt` or any repo call, and the Property 5 test runs 100 generated strings with `s.trim() === 'DELETE'` as the oracle and asserts the repo is untouched on rejection. Both `reauth_required` and `not_active` map to `reauth_required` with no mail. The mail send is in its own `try/catch`; the `warn` carries `account` (the keyed hash) and the error name only, and the test checks the serialized logs contain neither the address nor the user id. `restore`, `restoreInTx` and `notifyRestored` keep the split the reset flow needs: `restoreInTx` passes the caller's client and sends nothing, and the mail goes out only after commit.

## Purge runner flow and budget boundaries

```
runOnce
  drain queue (read)  -> budget? -> claimDue
  for each claimed: budget? -> release : runAccount
    stages 1..4 (skipped if c.stage > n): budget check, chunk loops with budget check
    finalize -> purged | fenced | refs_remain(rewind 0, absolute attempts, error log)
  drain again only if claimed.length > 0 and not stopped
```

The idle test asserts `statements.length === 2`, the first matching the queue read, the second the claim with `rowCount 0`, and the account row unchanged. Budget expiry is tested at (a) before the claim, (b) between accounts, (c) after each of stages 1 to 4 with a follow-up run compared to the unbounded table counts and ledger, (d) between chunks, plus a 100-run property that expires the budget after any repo call, asserts every unfinished claim is released with `purge_stage` equal to the persisted completed count, then rewinds and finishes to the baseline.

The five-run `refs_remain` test checks `purge_attempts` 1 to 5, `purge_stage` 0 and `purge_claimed_at` null after each run, and the alert `error` count 0,0,0,0,1 and still 1 after a sixth run. The absolute write is what makes this work and the test would fail with a relative write.

## Stage 3 share-scrub repair

The design table reads as "tombstone and anonymize only if a reference remains". Taken literally, a crash after the `shares.sender_id` re-point but before the payload scrub leaves `ownerId` and `ownerDisplayName` of the deleted person in a retained share, because the retry sees zero references. The runner keeps the conditional tombstone and anonymize chunks but always runs the `scrubShares` keyset loop with `c.placeholderId`, at the cost of one SELECT on accounts with no shares. `purgeRunner.test.ts` seeds exactly that crashed state and asserts the payload no longer contains the user id or name and `ownerId` equals the placeholder. design.md should be amended to match when the spec is next touched (additive wording only).

## Logging and structure rules

Every runner log object uses `account` (the `accountLogId`), `stage`, `attempts`, error names, or table/column/count triples. The logging test runs a failing and a purging run and asserts the user id, email, display name and placeholder id are absent while the keyed hash is present. The crash log asserts the error name only and that the message text does not appear. The structure tests scan the real import specifiers (confirming the scan found some) and require every specifier to start with `./`, and reject `new Worker/Queue/Redis`, `.subscribe(` and `setInterval`. I confirmed the import block in `purgeRunner.ts` is local modules only.

## Mail templates

`createMailService` now returns `MailService & AccountDeletionMail`; the existing method, payload type and options type are unchanged, and the scheduled/cancelled methods go through the same `transport`. The purge date is formatted in `America/New_York` with the zone abbreviation, and the text says signing in again cancels the deletion. Payload keys are exactly `from, html, subject, text, to`, so no `code` or `resetUrl` leaks into the new mail, and the test also checks `sendPasswordReset` still sends its code and URL. The test-side tag on the mail property says "Property 3" which is about the persisted date; it is only loosely related but harmless.

## Coverage

Property tests: Properties 3, 4 and 5 in `service.test.ts` (100 runs, tagged), 14/17 and 33 in `purgeRunner.test.ts` (100 runs, tagged), and one in the mail test. No stubs, TODOs or skipped tests found in the three new test files or in the new sources. Not covered and acknowledged by the coder: real concurrent `SKIP LOCKED`, real Postgres typing, and a real SMTP/Resend send.

</details>

<details>
<summary>File map</summary>

- `apps/api/src/services/accountDeletion/ports.ts` — structural ports, `LoggerPort`, `Scheduler`, service and runner dependency bags, `AccountDeletionRepo`
- `apps/api/src/services/accountDeletion/service.ts` — reauth, requestDeletion, restore, restoreInTx, notifyRestored
- `apps/api/src/services/accountDeletion/purgeRunner.ts` — `createBudget`, `createPurgeRunner` (`tryStart`, `runOnce`)
- `apps/api/src/services/auth/mailService.ts` — additive `sendDeletionScheduled` / `sendDeletionCancelled`, shared HTML helper
- `apps/api/src/services/accountDeletion/__tests__/service.test.ts`, `purgeRunner.test.ts`, `helpers.ts` (recording logger) — new tests
- `apps/api/src/services/auth/__tests__/mailService.accountDeletion.test.ts` — mail tests

Full diff: `git diff` plus the untracked `apps/api/src/services/accountDeletion/` directory.

</details>
