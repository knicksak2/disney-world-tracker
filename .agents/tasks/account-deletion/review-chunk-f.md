# Account deletion chunk F: photos scope guard, privacy and runbook docs, design NITs

Chunk F adds one new guard test (`accountDeletion/__tests__/photosScope.guard.test.ts`) and leaves `photos.guards.test.ts` untouched. It also adds privacy-policy sections 4 and 5, a photos-runbook note, and two additive sentences in `design.md` that close the round-5 design-review NITs. The hosting, `render.yaml` and `.env.example` edits were already in place from tasks 2.1 and 9.4. The coder states plainly that the spec validator was unavailable and leaves task 17 unchecked.

Watch for: task 17 must stay unchecked until the spec validator has actually run (confirmed, and the coder did not tick it). `design.md` is untracked, so "purely additive" rests on content checks, not a git diff (confirmed limitation, nothing found wrong).

**Verdict**: APPROVED

## High-level view

The scope guard pins both halves of the task 16 decision: where the deletion routes live (parsed from the real `routes.ts`) and that the four files scanned by the photos guard carry neither forbidden phrase. It is not vacuous, because the parser must find exactly four registrations on three distinct paths, and a bite test shows a `/photos/...` route is flagged. `photos.guards.test.ts` does not appear in `git status`. I ran both guard files once and got 19 of 19 passing.

The docs make claims that line up with the code. The privacy policy's kept and deleted lists match the disposition registry, the in-app path matches the real screen label, and the grace period is stated as the configured default. No backup retention figure is given; the text says outright that none is stated because it is unverified. The runbook note matches the registry (photo strikes and counters deleted, reports kept and re-pointed, photo owner nulled after the soft delete, `listDeleted` still finds the rows).

Both design NITs are single-sentence additions. Nothing in `requirements.md` or `tasks.md` was renumbered, and `tasks.md` has no marker other than `- [ ]` / `- [x]`.

<details>
<summary>Issues (2)</summary>

1. **Task 17 stays open (non-blocking, confirmed)** — the spec validator was not run, so the Kiro Spec Format check on `design.md`, `tasks.md`, `requirements.md` and the eight amended specs is still outstanding. Do not tick task 17 until it runs; the coder's manual regex scan is not the validator and does not claim to be.
2. **Additivity of design.md is not diffable (non-blocking, confirmed)** — `.kiro/specs/account-deletion/` is untracked, so no diff proves nothing else was removed. The checks I could make (both sentences present, design-review.json NIT text matched, no checkbox or numbering anomaly in `tasks.md`) found no deletion. Re-confirm after the validator run, or after the spec is first committed.

</details>

<details>
<summary>Details</summary>

### Scope guard asserts real constraints

The test reads `accountDeletion/routes.ts` from disk and resolves `app.<method>(IDENT | 'literal')` against `const X_PATH = '/...'` declarations. It then asserts the distinct set equals `/me/account/deletion`, `/me/account/deletion/reauth` and `/internal/account-deletion/purge/run`, with four registrations in total (POST reauth, POST deletion, POST and HEAD purge). Each path is checked against the two allowed prefixes and against `/photos`. A synthetic `/photos/delete-me` route proves the parser flags a violator. An unresolved identifier throws instead of being skipped, so the parser fails loudly. The `it.each` over `photos/routes.ts`, `foodReadRoutes.ts`, `sweepCronRoute.ts` and `auth/routes.ts` asserts non-empty content and neither `/delete-account/i` nor `/account\/delete/i`. This is stricter than the photos guard, which reads the same four files. That matters because `auth/routes.ts` was heavily edited in chunk C. The final test pins the reason the existing guard stays green, which is the word `deletion`. Confidence: confirmed (read the file, ran it with the photos guard).

### Photos guard unedited and its docs-scan interaction

`photos.guards.test.ts` is absent from `git status`. That guard's secret-shape scan covers `docs/` and `services/photos`, so the new docs prose could have tripped it. The two-file run passes, so it did not.

### Docs accuracy

Privacy section 4 gives the 30-day default grace and a "may finish a few hours after" note for the batch job. It gives no backup retention period. Section 5 names You & Crew -> Delete account (`YouAndCrewScreen.tsx` has the "Delete account" label and navigates to `DeleteAccount`), re-entering the password, typing `DELETE`, and signing in or resetting the password to cancel. It says the days are shown on the confirmation step; `DeleteAccountScreen.tsx` takes `graceDays` from the reauth response and never hard-codes it. It records that sign-in is email and password only (R13.1). "Kept anonymized" lists comments, trip history, shares, expense records and photo reports, matching the `anonymize` rows in `dispositions.ts` (`trip_comments`, `trip_log_entries`, `shares`, `expenses` and related, `photo_reports.reporter_id`). "Deleted" lists friendships, list saves, push registrations and photos, also matching the registry. The runbook's pointers resolve (section 3 is the sweep cron, section 4 is the operator runbook it was placed under). `hosting.md`, `render.yaml` (`sync: false`) and `.env.example` (secret plus five tuning vars) are present and consistent with the task text. Confidence: confirmed.

### Design NITs

NIT 1: the unread-count sentence is present, and its factual claim is right. Every `unread-count` reference under `apps/mobile/src` is inside a `__tests__` folder, and the badge comes from `selectUnreadShares`. NIT 2: the `PurgeRunnerDeps.lockout` field comment now ends "best-effort: a Redis failure is logged at warn and never fails the account". Both match the wording requested in `design-review.json`. Confidence: confirmed for presence and accuracy, see issue 2 for additivity.

### Not tested, by nature

Documentation edits have no asserting test, and the coder says so in its map. This is acceptable for prose. The full `npm run verify` and the pin gate were deliberately not run; they belong to task 18, and no catalogue file changed.

</details>

<details>
<summary>File map</summary>

- `apps/api/src/services/accountDeletion/__tests__/photosScope.guard.test.ts`: new route-scope and phrase guard
- `apps/api/src/services/photos/__tests__/photos.guards.test.ts`: unchanged, still passing
- `docs/privacy-policy.md`: section 4 deleted-accounts and backups bullets, section 5 delete-account bullet with sub-bullets
- `docs/photos-runbook.md`: "Account Deletion Calls `deleteAllForUser`" subsection
- `.kiro/specs/account-deletion/design.md`: two additive sentences (unread-count endpoint, lockout best-effort comment)
- `.kiro/specs/account-deletion/tasks.md`: task 16 ticked, task 17 left open
- `docs/hosting.md`, `render.yaml`, `apps/api/.env.example`: pre-existing from tasks 2.1 and 9.4, confirmed present

</details>
