# ParkHQ rename: review

Verdict: **APPROVED**. No blockers.

Reviewed: `git diff 9807a3f...HEAD` on `rename-parkhq` (one commit, `da50b19`, 53 files, 108+/108-), `report.md`, `baseline.md` and the commit message. I did not rerun the suites. I ran read-only greps and git commands only.

## Checks against the blocking criteria

1. **Remaining old name in user-visible places: none.**
   - Greps of `apps/` and `packages/` for `Disney World Tracker`, `DisneyWorldTracker`, `Disney Tracker` and `disneytracker` leave only these:
     - Code comments and JSDoc.
     - Four `package.json` descriptions.
     - The `auth@disneytracker.app` sender address and `https://app.disneytracker.app/reset` test fixtures. Both are open points.
     - The `disney-tracker` slug and the Firebase `project_id`. Both are open points.
   - `README.md` and `docs/*.md` have no remaining occurrences.
   - `.kiro/specs/**/*.md` has no remaining occurrences.
   - In `README.md`, `docs/` and `.kiro/`, the old name remains only in design mockup HTML, `motif-paths.js` (pin art, excluded by the task) and `.agents/` history. Mockups are not shipped and not user-visible. The report lists them.
   - `DWT` as a label appears only in `docs/onboarding-and-clarity-mockup.html`, a design mockup. Same reasoning.
   - The changed user-visible strings are:
     - Expo `name`.
     - The Settings disclaimer, the guest modal and the trip share footer.
     - Email subjects, bodies, HTML subtitle and From display name, including `DEFAULT_FROM`.
     - The reset-password page titles and messages.
     - The account deletion, privacy and terms pages.
     - The Admin_Panel brand.
2. **Privacy policy parity: holds.** `docs/privacy-policy.md` and `renderPrivacyPolicyHtml` changed on the same six sentences, with identical wording. `docs/terms-of-service.md` and `renderTermsOfServiceHtml` also match, including `PARKHQ` in the liability clause.
3. **Open points: unchanged.** The diff touches none of the following:
   - `app.config.ts` other than the `name` line.
   - `render.yaml`, `eas.json`, `google-services.json`.
   - `package.json` files and migrations.
   - The mail sender address.
   - Env var names. Only the `MAIL_FROM` display-name text changed.
   - `API_PUBLIC_URL` default. The `routes.ts` hunks are only message and title text.
4. **Excluded files untouched.**
   - No pin catalogue or art files.
   - No `.agents/` files in the diff.
   - Spec edits are one-phrase prose changes, with nothing removed or renumbered. The `pin-collection/requirements.md` change is a single intro sentence.
5. **Name spelling.** It is `ParkHQ` throughout, and `PARKHQ` only in the all-caps legal clause. "Disney" was not added to the name.
6. **Stray files.** None. All 53 entries are modifications, and the worktree is clean.
7. **Tests.**
   - I reversed the name swap on every changed file and compared it with the base. Every file except 15 is a pure name swap.
   - Those 15 are 14 spec files plus `docs/features.md`. The 14 spec files only drop a leading "the" ("the Disney World Tracker" becomes "ParkHQ").
   - `docs/features.md` carries the planned H1 and snapshot-line change.
   - No assertion in the repo still pins the old name. The three mail tests and the `TripSummaryScreen` test were updated to the new strings.
   - The report's behavior-to-test map labels every uncovered group "Untested" (default From, email bodies and subtitle, Settings and guest copy, `app.config.ts` name, reset pages, HTML pages, docs/HTML parity). That satisfies the "explicit untested note" condition.
8. **Report completeness.** It has:
   - The baseline with per-workspace counts: api 707 files / 5748 tests, mobile 400 suites / 3388 tests, shared 67 files / 961 tests.
   - The post-change `npm run verify` lines with identical counts and "Shell exit code: 0".
   - Grep summary counts, the 53-file list and the open-points list.
9. **Isolation.**
   - `develop` is still `9807a3f9ec79336b52c7caca44126a3e55fb5b85`.
   - `rename-parkhq` exists only as a local ref at `da50b19`.
   - There is no `refs/remotes` entry for it and no upstream configured.

## Non-blocking notes (no action required for approval)

- The Terms/Privacy name is not a legal entity. The coder flagged this.
- The post-change evidence is literal extracted lines rather than a raw tail. Counts and exit code are present and match the commit message.
