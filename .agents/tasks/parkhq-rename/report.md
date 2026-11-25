# ParkHQ rename: report

## (a) Branch and commit

- Worktree: `c:/Users/knick/dev/disney-app/.worktrees/parkhq`
- Branch: `rename-parkhq` (base `9807a3f9ec79336b52c7caca44126a3e55fb5b85`)
- Commit: `da50b1921fbd6c23e807685c57e60c61c43249ca` (53 files, 108 insertions, 108 deletions)
- Nothing pushed, merged or fast-forwarded. The user's checkout (`.kiro/steering/tech-conventions.md` change, untracked reports) was not touched. No `.env` file was read.

## (b) Baseline (copied literally from baseline.md)

- Commit `9807a3f9ec79336b52c7caca44126a3e55fb5b85`, command `npm run verify`, exit code **0**.
- `@dwt/api`: vitest `--run --coverage`: Test Files 707 passed (707); Tests 5748 passed (5748)
- `@dwt/mobile`: jest: Test Suites 400 passed (400); Tests 3388 passed (3388); Snapshots 2 passed (2)
- `@dwt/shared`: vitest `--run`: Test Files 67 passed (67); Tests 961 passed (961)
- Coverage: Statements 96.01%, Branches 92.95%, Functions 95.83%, Lines 96.6%
- Verdict: GREEN.

## (c) Post-change `npm run verify` (run once from the worktree root, after all edits and test updates)

Literal lines extracted from the run output (typecheck headers, then test summaries):

```
> @dwt/api@0.0.0 typecheck
> @dwt/mobile@0.0.0 typecheck
> @dwt/shared@0.0.0 typecheck
(no `error TS` lines anywhere in the output)
> @dwt/api@0.0.0 test
 Test Files  707 passed (707)
      Tests  5748 passed (5748)
Statements   : 96.01% ( 337/351 )
Branches     : 92.95% ( 277/298 )
Functions    : 95.83% ( 23/24 )
Lines        : 96.6% ( 313/324 )
> @dwt/mobile@0.0.0 test
Test Suites: 400 passed, 400 total
Tests:       3388 passed, 3388 total
Snapshots:   2 passed, 2 total
> @dwt/shared@0.0.0 test
 Test Files  67 passed (67)
      Tests  961 passed (961)

Shell exit code: 0
```

Counts are identical to the baseline. Inner loop before that: `mailService.test.ts`, `mailService.accountDeletion.test.ts`, `webPages.prop.test.ts`, `photos.docs.guard.test.ts` (4 files, 34 tests passed) and `TripSummaryScreen.test.tsx` (11 tests passed).

## (d) Grep summary (case-insensitive, tracked files, `package-lock.json` excluded)

| Term | Files before | Files after | Notes |
|---|---|---|---|
| `Disney World Tracker` | 133 (incl. .agents) | 79 | none user-visible; see table below |
| `DisneyWorldTracker` | 0 | 0 | |
| `Disney Tracker` | 2 | 2 | both in `.agents/` historical reports |
| `DWT` as a user-facing label | 2 | 2 | only in `docs/onboarding-and-clarity-mockup.html` (a design mockup, "DWT · Clarity & Onboarding Mockup", "WELCOME TO DWT") |

Remaining `Disney World Tracker` occurrences (79 files) and why each was left:

| Group | Files | Why left |
|---|---|---|
| `apps/api/migrations/*.sql` header comments | 39 | Applied migrations must never be edited (steering). Comments only. |
| `.agents/**` | 5 | Historical reports/baselines. Told not to rewrite. |
| Design mockup HTML in `.kiro/specs/**` and `docs/**` | 17 HTML (12 in `.kiro/specs/`, 5 in `docs/`) plus `.kiro/specs/pin-collection/motifs/motif-paths.js` | Not shipped, not user-visible. The pin-catalogue files (`pin-catalog-mockup*.html`, `*-preview.html`, `motifs/motif-paths.js`) are excluded by the task. |
| Code comments / JSDoc | `apps/api/src/composeServices.ts`, `apps/api/src/services/catalog/internalId.ts`, `apps/api/vitest.config.ts`, `apps/mobile/app.config.ts` (header comment), `apps/mobile/src/__tests__/emptyStates.test.tsx`, `apps/mobile/src/__tests__/navigation.test.tsx`, `apps/mobile/src/theme/{charts.tsx,components.tsx,theme.ts}`, `apps/mobile/src/types/jsx.d.ts`, `packages/shared/src/enums.ts` | Not user-visible; scope was the visible name only. Cheap follow-up if wanted. |
| Package descriptions | root, `apps/api`, `apps/mobile`, `packages/shared` `package.json` `description` | Not user-visible; package metadata is adjacent to the open package-name point. |
| Infra file comments | `docker-compose.yml:1`, `render.yaml:1` | Comments only; `render.yaml` is an open point. |

Spec folder name `.kiro/specs/disney-world-tracker/` and the `// Feature: disney-world-tracker` tags in property tests are identifiers (lowercase hyphenated), left unchanged.

Descriptive uses of "Walt Disney World" / "Disney World" (permission strings in `app.config.ts`, privacy policy "visits to Walt Disney World", etc.) were kept as instructed.

## (e) Behavior-to-test map

| Changed string group | Test and assertion | Covered? |
|---|---|---|
| Reset-code email subject `Your ParkHQ reset code: 123 456` / `654 321` / `231 109` | `mailService.test.ts` `expect(payload.subject).toBe('Your ParkHQ reset code: 123 456')`, `expect(mailArgs.subject).toBe('Your ParkHQ reset code: 654 321')`, mocked-send `subject:` args; `mailService.accountDeletion.test.ts` `expect(sent[0]!.subject).toBe('Your ParkHQ reset code: 231 109')` | Yes |
| Email From display name `ParkHQ <myaccount@gmail.com>` (SMTP user path) | `mailService.test.ts` `expect(mailArgs.from).toBe('ParkHQ <myaccount@gmail.com>')` | Yes |
| Deletion-scheduled and deletion-cancelled email subjects | `mailService.accountDeletion.test.ts` `expect(mail.subject).toBe('Your ParkHQ account is scheduled for deletion')` and `...account deletion was cancelled` (twice) | Yes |
| Default From `ParkHQ <auth@disneytracker.app>` (no SMTP user) | no test asserts the default From display name | Untested |
| Email HTML subtitle and plain-text bodies (reset, deletion scheduled/cancelled) | no assertion on the body text or subtitle | Untested |
| Trip text share footer `Tracked with ParkHQ ✨` | `TripSummaryScreen.test.tsx` expects the share text to contain `'Tracked with ParkHQ ✨'` | Yes |
| Settings disclaimer ("ParkHQ is an independent, unofficial companion application...") | none | Untested |
| Guest management modal copy ("...without a ParkHQ account") | none | Untested |
| Expo display name `ParkHQ` (`app.config.ts` `name`) | none (`appConfigApiBaseUrl.test.ts` covers only the API URL) | Untested |
| Reset-password web pages (`routes.ts` titles, subtitle, messages) | none | Untested |
| Account deletion, privacy policy and terms HTML (`webPages.ts`) and Admin_Panel brand (`admin/html.ts`) | `webPages.prop.test.ts` and `photos.docs.guard.test.ts` run green but do not assert the product name | Untested by name |
| `docs/privacy-policy.md` and `docs/terms-of-service.md` kept identical in content to the HTML pages | I applied the same replacement to each pair by hand. No test compares them. | Untested |
| README, docs, specs, `.env.example` | n/a (prose/config template) | n/a |

I did not add new tests, as instructed ("only where a changed string is asserted"). A cheap brand guard (assert `app.config.ts` name and the page titles) would close the Untested rows if you want it.

## (f) Files changed (53)

Specs (`.kiro/specs/`): `account-deletion/{design,requirements}.md`, `admin-panel/requirements.md`, `catalog-navigation-redesign/requirements.md`, `disney-facilities-catalog-source/{design,requirements}.md`, `disney-source-resilience/{design,requirements}.md`, `disney-world-tracker/{design,requirements,tasks}.md`, `experience-activity-logging/requirements.md`, `experience-detail-back-navigation/bugfix.md`, `experience-detail-navigation/requirements.md`, `experience-favorites/requirements.md`, `experience-lists/requirements.md`, `experience-live-details/requirements.md`, `first-run-onboarding/{design,requirements}.md`, `food-item-logging/requirements.md`, `food-lists/requirements.md`, `friend-food-ratings/requirements.md`, `friend-profile-navigation/requirements.md`, `friend-stats-viewing/{design,requirements,tasks}.md`, `legal-disclaimers-and-terms/{design,requirements}.md`, `password-reset/{design,requirements}.md`, `pin-collection/requirements.md`, `resort-tracking-and-stats/requirements.md`, `social-sharing-loop/requirements.md`, `trips/{design,requirements}.md`. Each is a one-phrase prose edit; no requirement was removed or renumbered.

Docs: `README.md`, `docs/features.md`, `docs/hosting.md`, `docs/photos-runbook.md`, `docs/privacy-policy.md`, `docs/terms-of-service.md`.

API: `apps/api/.env.example`, `apps/api/src/services/accountDeletion/webPages.ts`, `apps/api/src/services/admin/html.ts`, `apps/api/src/services/auth/mailService.ts`, `apps/api/src/services/auth/routes.ts`, `apps/api/src/services/auth/__tests__/mailService.test.ts`, `apps/api/src/services/auth/__tests__/mailService.accountDeletion.test.ts`.

Mobile: `apps/mobile/app.config.ts`, `apps/mobile/src/screens/trips/TripGuestManagementModal.tsx`, `apps/mobile/src/screens/trips/TripSummaryScreen.tsx`, `apps/mobile/src/screens/trips/__tests__/TripSummaryScreen.test.tsx`, `apps/mobile/src/screens/youAndCrew/SettingsScreen.tsx`.

No `packages/shared` source, migration, or `render.yaml` change. The working tree is clean after the commit (no stray files; the temp verify log was deleted).

Notes on judgment calls:
- Limitation-of-liability sentence in the Terms (`IN NO EVENT SHALL DISNEY WORLD TRACKER, ITS OPERATORS...`) became `PARKHQ`. That text is the product name, not a legal entity, so I changed it. Have a lawyer or yourself confirm the Terms and Privacy Policy wording before release, since the operator/legal entity is still unnamed.
- The mail From **display name** changed to `ParkHQ`; the address `auth@disneytracker.app` is unchanged (open point).
- `docs/features.md` snapshot line now reads "commit `9807a3f` base + ParkHQ product rename (2026-11-24)". The date is the machine date today; the base commit is the branch base, not the rename commit.

## (g) Open points (left unchanged)

| Item | File | Current value |
|---|---|---|
| iOS bundle identifier | `apps/mobile/app.config.ts:97` | `com.dwt.mobile` |
| Android package | `apps/mobile/app.config.ts:106` (also comment line 112, `apps/mobile/google-services.json` `package_name`, README line 572) | `com.dwt.mobile` |
| Firebase/FCM project | `apps/mobile/google-services.json` | `project_id` and `storage_bucket` `disney-tracker-61944`. It is tied to the Android package; changing the package requires a new Firebase app and a new `google-services.json`. |
| Expo slug | `apps/mobile/app.config.ts:87` | `disney-tracker` |
| EAS owner | `apps/mobile/app.config.ts:88` | `knicksak2s-team` |
| EAS project id | `apps/mobile/app.config.ts` `extra.eas.projectId` | `e98d1957-cb2c-431a-be3d-486c6c66122c` |
| npm workspace scope and package names | `apps/api/package.json`, `apps/mobile/package.json`, `packages/shared/package.json`, root `package.json` | `@dwt/api`, `@dwt/mobile`, `@dwt/shared`; root `disney-world-tracker` |
| Render service name | `render.yaml:14` | `dwt-api` (docker-compose container names `dwt-postgres`, `dwt-redis`, DB/user/password `dwt` are the local equivalents) |
| Render URL / mobile API URL | `render.yaml`, `apps/mobile/eas.json`, `apps/mobile/app.config.ts:74`, `apps/mobile/.env.example`, README lines 241/493/507/546, `docs/hosting.md:73`, `apps/mobile/__tests__/appConfigApiBaseUrl.test.ts:17` | `https://dwt-api.onrender.com` (also privacy `/privacy` and terms `/terms` URLs in `eas.json`) |
| `API_PUBLIC_URL` default | `apps/api/src/services/auth/routes.ts:226-227` | `process.env.API_PUBLIC_URL ?? ... 'https://dwt-api.onrender.com'` |
| Mail sender address and `MAIL_FROM` | `apps/api/src/services/auth/mailService.ts:57`, `apps/api/.env.example:135-136`, `.kiro/specs/password-reset/design.md:187` | address `auth@disneytracker.app` (display name part is now `ParkHQ`); test fixtures use `https://app.disneytracker.app/reset` |
| Cron job URLs | configured at cron-job.org (not in the repo); endpoints `/internal/*` documented in README lines 134 and 466 | Host follows the Render URL above |
| Database names and local connection | `apps/api/.env.example:23`, `apps/api/src/test/liveDbTemplate.ts:11`, `docker-compose.yml` | `postgres://dwt:dwt@localhost:5432/dwt` |
| Deep-link URL scheme | `apps/mobile/app.config.ts` | None defined (no `scheme` key). No deep-link scheme exists to rename, but you will need one if you add links. |
| Env var names | `apps/api/.env.example`, `render.yaml`, `apps/mobile/.env.example` | Unchanged; none contain the old product name |
| Storage key prefixes | `apps/mobile/src/api/deviceId.ts`, `sessionStorage.ts`, `theme/appearanceStorage.ts` | `dwt.push.deviceId`, `dwt.session.token`, `dwt.appearance.preference`. Renaming would sign users out and lose preferences; left alone. |
| Package/comment/mockup leftovers | see (d) | `Disney World Tracker` in comments, `package.json` descriptions, `docker-compose.yml`/`render.yaml` header comments, design mockups, migrations, `.agents/` |
| Spec folder name | `.kiro/specs/disney-world-tracker/` and `// Feature: disney-world-tracker` tags | Left (spec identifier). Renaming would break references. |

Ambiguous strings left unchanged: none beyond the above. No legal-entity name or URL contained the old name.

## (h) docs/features.md and README.md

- `docs/features.md`: changed the H1 (`# ParkHQ: Feature Inventory`) and the snapshot line. No feature row changed (no feature added, removed or re-statused).
- `README.md`: changed the H1 only (`# ParkHQ`). No scripts, startup env vars, `/admin` sections, `/internal/*` endpoints, setup or deploy steps changed.
- `.env.example` (`MAIL_FROM` display name and header comment) was updated; no env var was added or renamed, so `render.yaml` needed no change.

## (i) Home search bar

None applies: no screen, Trip hub section, Stats/Collection/You & Crew page or Settings page was added, renamed, moved or removed.
