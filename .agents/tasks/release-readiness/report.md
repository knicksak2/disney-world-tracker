# Release-readiness audit (read-only)

Date of audit: 2026-10-18 (system clock). Repo: `c:\Users\knick\dev\disney-app`, branch `develop` (1 commit ahead of `origin/develop`, 31 changed/untracked paths). No source was edited. I ran `npm run typecheck` once; I did NOT run the test suites.

Legend: **[V]** = verified by reading code/running a command. **[I]** = inference, not directly proven. Effort: S (hours), M (1-3 days), L (a week or more).

---

## Summary answer

The app is feature-rich and the code is unusually clean (no TODO/FIXME in shipped source, no skipped tests, no stray `.js` beside `.ts`, secrets gitignored). It is not ready for a public store release yet, mostly because of release plumbing and policy gaps, not missing features.

The things that would actually stop or hurt a release:

1. **The working tree is red.** `npm run typecheck` fails in `apps/api` with 29 errors, all in the uncommitted photo-uploads work (`src/services/photos/*`, `src/scripts/photoStoreSmoke*.ts`). Render's build runs `tsc`, so committing this as-is would break the deploy. **[V]**
2. **No account deletion and no data export anywhere.** Apple (5.1.1(v)) and Google Play both require in-app account deletion for apps with accounts. No code, route, or UI exists. **[V]**
3. **No privacy policy, terms, or support link** anywhere in the repo or app. Both stores require a privacy-policy URL. **[V]**
4. **No store assets or versioning.** `app.config.ts` has no icon, splash, or adaptive icon (its own comment says so), `version: '0.0.0'`, `submit.production: {}`. **[V]**
5. **Password-reset email will silently not send in production.** Mail provider env vars (`RESEND_API_KEY` / `SMTP_*` / `MAIL_FROM` / `API_PUBLIC_URL`) are not in `render.yaml`, README or `hosting.md`; with none set, the mail service falls back to "mock mode" and just logs the code and link. **[V]**
6. **Legal/IP posture of the data and the name.** The app is called "Disney World Tracker", hot-links Disney image URLs, and syncs from Disney's Sync Gateway using credentials pulled from a third-party reverse-engineering repo (MouseTools). The spec itself calls the sources "undocumented" and "reverse-engineered". This is a real takedown or store-rejection risk. It is a product/legal decision, not a coding task, and this is not legal advice. **[V facts, I risk]**
7. **No crash/error reporting or monitoring** in either app (no Sentry or equivalent, no React error boundary). **[V]**
8. **No user block/report tooling for existing social features.** `user_blocks` exists only in the unapplied photo migration. Apple 1.2 expects report/block for user-generated content. **[V]**

Feature-wise, the only real unfinished feature is **photo-uploads (about 30% done, not wired)**. Decide whether it ships in v1; if not, keep it off the release branch entirely (see A1, A8). **ride-identity-aliases** has no code at all. Other open specs are mostly stale checkboxes (see E).

---

## (A) Release BLOCKERS

### A1. Typecheck is red because of in-progress photo-uploads code (S to M)
- Why: `render.yaml` buildCommand runs `npm run build --workspace apps/api` (`tsc -p tsconfig.build.json`). Any commit of the current tree would likely fail the Render deploy. It also violates the repo's own "green gate" rule.
- Evidence **[V]**: `npm run typecheck` -> `apps/api` exit 2, 29 errors. By file: `src/services/photos/service.ts` (9), `src/scripts/photoStoreSmokeReport.ts` (7), `src/scripts/photoStoreSmoke.ts` (7), `src/services/photos/repo.ts` (2), `targets/foodLogTarget.ts` (1), `src/scripts/photoHarmProbeReport.ts` (1), `photos/__tests__/fakes.ts` (1), `photos/__tests__/repo.test.ts` (1). Examples: `PhotoService.softDeleteForTarget` returns `Promise<readonly string[]>` but `PhotoLifecyclePort` expects `Promise<void>`; `exactOptionalPropertyTypes` violation in `foodLogTarget.ts:31`. `apps/mobile` and `packages/shared` typecheck clean.
- Fix: either finish or stash photo-uploads on its own branch, and keep `develop` (the Render branch) green. Note migration `0062_photo_uploads.sql` is untracked; once committed it will run on every deploy even with `PHOTOS_ENABLED=false`.

### A2. Account deletion and data export are missing (M)
- Why: store-policy requirement (Apple 5.1.1(v), Google Play account-deletion policy) and a GDPR/CCPA expectation. Photo-uploads will add more personal data (images in R2, moderation by third parties).
- Evidence **[V]**: regex search for `delete account|account deletion|data export|exportData` in `apps/**/*.{ts,tsx}` returns nothing. `services/auth/` has only register, login, logout, change-password, forgot/reset-password, `/me`; `profileRoutes.ts` has only `PATCH /me/profile` and `PUT /me/profile/avatar`. Many tables reference `users(id)` (migrations use `ON DELETE CASCADE`, so a hard delete is feasible, **[I]** but not tested end to end, including Redis keys and any future R2 objects).
- Fix: `DELETE /me` (password confirm, revoke sessions, cascade, drop push tokens) plus a mobile "Delete account" entry in `YouAndCrewScreen`; optional `GET /me/export` (JSON). This needs a spec amendment per the tech-conventions rule (new user-facing behavior).

### A3. Privacy policy, terms, and support contact (S, plus writing)
- Why: required for store listing and for Expo push/Firebase disclosures; also needed if photo uploads go to third-party moderation (OpenAI, Gemini).
- Evidence **[V]**: no privacy/terms/support files or strings in `apps/`, `docs/`, or `.kiro/`. `AttributionScreen.tsx` covers only pin-art credits.
- Fix: host a policy page (static page or GitHub Pages), add Settings links in `YouAndCrewScreen`, add a support email.

### A4. App store packaging: icon, splash, version, bundle metadata, EAS submit (M)
- Evidence **[V]**: `apps/mobile/app.config.ts` - `version: '0.0.0'`, no `icon`/`splash`/`android.adaptiveIcon` (comment: "custom icon/splash/adaptive-icon assets are not yet committed"), `apps/mobile/assets/` holds only `cork.png`. `eas.json` `submit.production` is `{}` (no Apple ID / ASC app id / Play service-account). Root `app.json` is a stray `{"expo": {}}`. Bundle id `com.dwt.mobile` is a placeholder-style id for both platforms; changing it later is painful once published.
- Also **[I]**: `expo-image-picker` plugin is registered with defaults, so iOS permission strings are generic; set custom `photosPermission`/`cameraPermission` text. iOS needs a paid Apple Developer account (README says so). `eas.json` uses `appVersionSource: remote` + `autoIncrement` for production, which is fine.
- Fix: icon (1024), adaptive icon, splash, real version (1.0.0), final bundle ids, permission strings, fill `submit` block, store screenshots and listing text.

### A5. Transactional email is not configured for production (S)
- Evidence **[V]**: `mailService.ts` falls back to mock mode that only logs `code`/`resetUrl` when no `RESEND_API_KEY` or SMTP creds are set (lines ~120-182). `render.yaml`, `README.md` and `docs/hosting.md` contain zero mentions of `RESEND`, `SMTP`, `MAIL_FROM`, or `API_PUBLIC_URL`. Those variables are read via `process.env` directly in `auth/mailService.ts` and `auth/routes.ts` (line ~194-198, default `https://dwt-api.onrender.com`), bypassing `config.ts`, contrary to README's claim that the API never reads `process.env` outside the config loader. `.env.example` default sender is `auth@disneytracker.app`, which only works if you own that domain and have verified it with Resend.
- Why it matters: "Forgot password" is the only account recovery path, and in mock mode the reset code lands in Render logs. Reset codes in logs are also a minor security smell.
- Fix: add the mail keys to `render.yaml` (`sync: false`), set a verified sender, fail loudly or warn at boot in production when no mail provider is configured, document in README/hosting.md, and send a real test email.

### A6. Legal/IP review of name, Disney imagery, and data access (decision; S to L depending on outcome)
- Evidence **[V]**: app name `Disney World Tracker` (`app.config.ts`), mail sender, `README.md`. Catalog imagery is Disney-hosted URLs stored in `experiences.image_url` (disney-facilities-catalog-source R7/R14.8 states no attribution needed). `tools/pull-disney-creds.mjs` downloads `environments.bin` from a third-party GitLab repo (MouseTools) and decrypts Sync Gateway credentials; the spec says the sources are "undocumented", "reverse-engineered", "subject to Disney's Terms of Use with no SLA" (`disney-facilities-catalog-source/requirements.md` lines 12-13, R12). Pin art direction forbids Mickey ears and similar (`docs/pin-art-direction.md` section 7), which is a good sign for original artwork. No "not affiliated with or endorsed by The Walt Disney Company" disclaimer or ThemeParks.wiki credit appears in the mobile UI (grep found none; only code comments mention ThemeParks.wiki). Pin names such as "Batuu bounty hunter" (asset `assets/pins/batuu_bounty_hunter.svg`) reference Disney/Lucasfilm names **[I]** worth a look.
- Risk **[I]**: app-store rejection (trademark / impersonation in the title, Apple 5.2), DMCA/C&D, or Disney rotating or blocking the credentials and breaking the whole catalog (the README already documents `waf_block`/`auth_failure` outcomes). A private/TestFlight or friends-and-family release carries much less risk than a public listing.
- Fix: pick a non-Disney-trademark app name and bundle id before publishing, add the disclaimer and ThemeParks.wiki/Disney data credits in Settings and the store listing, decide consciously about hot-linking Disney images and the credential source. Get real legal advice if going public.

### A7. No crash/error reporting or monitoring (M)
- Evidence **[V]**: no Sentry/Bugsnag/Crashlytics in `apps/api/package.json` or `apps/mobile/package.json`; no `ErrorBoundary`, `componentDidCatch`, or global JS exception handler in `apps/mobile/App.tsx` or `src/` (grep: no matches). API has structured pino logs and per-request `duration_ms` (`observability/requestId.ts`), and the admin panel has push/sampling/infra views, but no alerting. `/health` is a static liveness route with no DB/Redis check (`server.ts`: "A separate readiness probe is added in a later task" - never added **[V]**).
- Why: with free-tier hosting and external cron dependencies, failures are silent (the `hosting.md` notes the keep-alive pinger is explicitly "not a health monitor").
- Fix: Sentry (or similar) for RN and Fastify, a top-level error boundary with a friendly fallback, an external uptime monitor on a real readiness route. Keep within free tiers.

### A8. Photo-uploads decision and release hygiene for the in-flight work (S)
- Evidence **[V]**: `render.yaml` already declares photo env vars with `PHOTOS_ENABLED=false` (uncommitted diff). `config.ts` gains about 380 lines. `@aws-sdk/client-s3` and `s3-request-presigner` added to `apps/api/package.json` (pinned `3.1152.0`; lockfile +414 lines). No routes wired in `composeServices.ts` (grep "photo" returns nothing there); no mobile UI. Spec says Phase 1 = food photos; Phase 2 = trip photos (tasks 16-24).
- Decision needed: ship v1 without photos (recommended, because it needs R2, OpenAI moderation and Gemini vision keys, report/block, and deletion integration) and park the branch, or finish Phase 1 first. Either way make `develop` green and don't deploy half-finished migrations casually.

### A9. No block/report for user-generated content (M, becomes L if photos ship)
- Evidence **[V]**: block/report only appear in the photo-uploads migration (`user_blocks`, `photo_reports`) and photo repos; none for display names, shared lists, notes, shares, or reactions. Friend-only social graph reduces exposure **[I]** but Apple 1.2 still asks for filtering, reporting, blocking, and a published contact.
- Fix: minimal report-user plus block-user endpoint and UI, and an admin-panel queue entry. Needs a spec.

---

## (B) Should-do before release

### B1. No CI (S to M)
- Evidence **[V]**: no `.github/workflows` (only `node_modules/**/.github`). The root `verify` script is manual and relies on agent discipline. Render deploys straight from `develop` pushes, so a bad push deploys.
- Fix: a GitHub Actions workflow running `npm ci`, `npm run verify` (typecheck + tests, ~minutes), and optionally `npm run lint` and `node .kiro/specs/pin-collection/verify/run-all.js` when pin files change. Consider a protected `main` and deploy from `main` (today `main` is stale at `458ac63` Expo-56 upgrade while `develop` has the real work; `render.yaml` pins `branch: develop`).

### B2. Render cold-start UX and keep-alive dependency (S to M)
- Evidence **[V]**: README/hosting.md accept 30-60 s cold starts and rely on cron-job.org keep-alive. `apps/mobile/src/api/client.ts` has an AbortController-based timeout but I found no global "server is waking up" state or retry strategy (grep for waking/cold start found nothing; **[I]** it may live elsewhere). TanStack Query defaults were not found customized (`defaultOptions` grep: no match).
- Why: first impression for testers is a blank/error screen when the pinger is down or overnight (2-7 am sleep window).
- Fix: a "waking the server" loading state keyed on slow/failed first request, retry with backoff for the initial `/me`, and a documented decision to buy the $7 always-on tier before real users.

### B3. Operator-run cron setup is unchecked (S, manual)
- Evidence **[V]**: `trip-booking-timeline/tasks.md` task 15.1 (Reminder_Cron on cron-job.org, `TRIP_BOOKING_CRON_SECRET` on Render) is unchecked, and task 13.2 ("rules re-check" of Disney booking-window rules) may be unconfirmed (Notes section). Same class of manual steps exist for sampling (`SAMPLING_CRON_SECRET`) and pins reconcile (`PIN_RECONCILE_CRON_SECRET`). I could not verify which crons are live. Also the catalog sync is manual (`npm run sync:cloud`) by design, so catalog refresh is a recurring operator chore.
- Fix: checklist in a runbook for first deploy, confirm the three crons, and verify migrations through `0061` are applied on Neon.

### B4. Required secrets that fail-fast on Render (S)
- Evidence **[V]**: `render.yaml` marks `SAMPLING_CRON_SECRET`, `PIN_RECONCILE_CRON_SECRET`, `TRIP_BOOKING_CRON_SECRET`, `ADMIN_PANEL_USERNAME/PASSWORD` as `sync: false` and required; the build's migrate step itself loads config, so a missing secret fails the build. Local README warns admin defaults of `change-me`/`admin` exist in `.env.example`; ensure production values are strong (I did not read `.env` values and could not verify what is set on Render).

### B5. Free-tier capacity checks (S)
- Neon 1 GB: `wait_samples` is pruned (migration `0020` comments "pruned to a bounded recent window") and admin panel has an Infrastructure Budget section; day-level archive (R17) grows unbounded by design but is small **[I]**. Photo metadata would add rows; photos themselves would be in R2 (not Neon).
- Upstash 500k commands/month: Redis is used for the rate limiter (every request when `rateLimit: {}` is registered with the Redis client? **[I]** - `composeServices.ts` passes `rateLimit: {}`; I did not confirm whether the Redis client is attached, so per-request limiter commands may or may not count against Upstash), sessions are in Postgres, lockout counters, catalog sync lock, live-cache (5 min), leaderboard cache. BullMQ code exists (`aggregate/worker.ts`, `catalog/scheduler.ts`) but `composeServices.ts` deliberately uses a synchronous emitter and does not start workers **[V]** (header comment, with a `TODO(ops)` note). **Verify actual command usage** in the admin panel's Infrastructure Budget view with real traffic before inviting many users.
- Backups: Neon PITR is only 24 h on free tier (hosting.md). No scheduled `pg_dump`. Recommend a periodic manual or scripted dump.

### B6. Security hardening details (S to M)
- Verified good **[V]**: opaque 256-bit session tokens hashed (sha256) in DB, argon2 passwords, login lockout, email-keyed login rate limit (5/15 min), reset endpoints rate-limited, admin Basic auth uses constant-time compare, cron secrets use `timingSafeEqual`, `.env`/`.env.*` gitignored (`git check-ignore` confirms `apps/api/.env` and `.env.dev`; only `.env.example` files are tracked), global rate limits 300 reads / 60 writes per minute.
- Gaps **[V]**: no `@fastify/helmet` / security headers (the API serves HTML for `/admin` and `/auth/reset-password`); no CORS plugin (fine for native clients, but `/auth/reset-password` page and admin are same-origin, so likely OK **[I]**); `trustProxy: true` blanket (OK on Render, spoofable elsewhere); `/auth/register` has no dedicated stricter limit (only the global per-IP mutation budget); no email verification at signup (registered emails are unverified **[I]**: not seen in `auth/routes.ts`); `/admin` uses HTTP Basic, so make sure it is only used over HTTPS and consider IP allow-listing or a stronger password. Session absolute TTL is 24 h of continuous activity with 30-day idle expiry - reasonable.
- Run `npm audit` (not run here) and review `^` ranges in `apps/mobile/package.json` and `apps/api/package.json` (the repo convention says pin exact versions).

### B7. Offline and error/empty/loading states (M) **[I]**
- No `NetInfo`/offline detection and no query-cache persistence beyond AsyncStorage dependency (grep of `NetInfo|onlineManager|refetchOnReconnect` returned nothing). Individual screens have bespoke error handling (many tests mention it), but there is no app-wide offline banner or retry pattern. Worth a manual pass on a real phone in airplane mode and on a flaky connection in the parks, since park Wi-Fi/cell is the main use case.

### B8. Push notification setup is a manual, per-platform step (S, operator)
- Evidence **[V]**: README "Push notification credentials (FCM / APNs)": Android needs the FCM v1 service-account key uploaded via `eas credentials`; iOS needs the APNs key (Apple Developer account). `google-services.json` is committed (normal, not a secret). I did not verify that credentials are uploaded. Push tokens are removed on logout (per spec) **[I]**.

### B9. Dark mode: one known open issue (S)
- Evidence **[V]**: `.agents/tasks/dark-mode-retrofit/POLISH-report.md` "Open item: Fix 11" (white strip under non-tab screens in Dark) was later marked "Resolved (follow-up step)" with the Expo `expo-system-ui` approach, but "plan item 11's separate light `#ffffff` palette was not built". `.kiro/specs/dark-mode/tasks.md` still shows tasks 7, 8.6, 11, and 13 unchecked. Visual verification on device (task 11.1/11.2) is not recorded as done. Worth a final screenshot pass.

### B10. Accessibility spot-check (S to M)
- Evidence: 133 of 162 non-test `.tsx` files contain `accessibilityLabel` **[V]**, and repo steering requires labels and not relying on color alone. Real screen-reader testing (VoiceOver/TalkBack) was not done by anyone as far as the repo shows; full WCAG validation needs manual testing with assistive tech and expert review.

---

## (C) Nice-to-have / post-launch

- **OTA updates**: `expo-updates` is not installed (README says so deliberately); every JS fix needs a full store build. Adding `expo-updates` + EAS Update gives fast hotfixes. Do this before the first store build if you want it, because it needs a native rebuild (S to M).
- **Always-on hosting** ($7 Render) and Neon paid plan when users appear (hosting.md thresholds).
- **Automated catalog refresh**: currently a manual `sync:cloud`; a cron-triggered authenticated endpoint is allowed by the hosting conventions (202 + async) and would remove an operator chore (M).
- **Scheduled DB backups** (S).
- **Analytics / feature usage** (admin "Growth & Activity" exists, so basic coverage is there).
- **Model decisions on the calendar**: `docs/runbooks/` - 2026-11-10 shadow-challenger promotion check is upcoming; 2027-08-01 baseline re-anchor (crowd-calendar task 21.5). Not release-blocking.
- **Onboarding/first-run experience** and a "what's new" screen **[I]** (not looked for).
- **Localization**: none seen; English only **[I]**.
- **ride-identity-aliases** (see E) improves prediction for renamed rides.

---

## (D) Cleanup items

All verified unless marked.

1. **Stray root files tracked in git**: `pin-catalog-mockup.html`, `pin_preview.html` (duplicates of the canonical catalogue under `.kiro/specs/pin-collection/`), and `app.json` (`{"expo": {}}`, shadowing/confusing Expo config). Untracked/ignored but present: `verify_final3.log`, `install.ps1` (gitignored as "stray tooling installer"). (S)
2. **Uncommitted work**: 31 paths in `git status` (photo-uploads implementation, shared contract changes in `packages/shared/src/{dto,errors,index,schemas}`, six test files modified to accommodate new config, `render.yaml`, `.env.example`, lockfile). Commit or shelve deliberately (see A1/A8). `develop` is also 1 commit ahead of `origin/develop` (not pushed). (S)
3. **`TODO(ops)`** in `apps/api/src/composeServices.ts` lines ~41-44 (BullMQ aggregate worker note). It is the only TODO in shipped source; `apps/api/dist/*.d.ts` mirror it (gitignored). Leave or convert into a documented decision. (S)
4. **Dead or dormant BullMQ code**: `services/aggregate/worker.ts`, `ratingChangedQueue.ts`, `catalog/scheduler.ts` are compiled but not started in production wiring, while the README still says the API "hosts ... plus BullMQ background workers". Either delete or label as dormant and fix README. `bullmq` remains a dependency. (S)
5. **Large artifacts in git**: `.agents/tasks/dark-mode-retrofit/screenshots/*.png` (many 0.4-2 MB files) and 130 KB design docs inflate the repo history. Not harmful but consider moving out. (S)
6. **Stale git worktree**: `.worktrees/bias-vs-lag-decision` on branch `runbook/2026-10-08-bias-vs-lag-decision`. Its commits (`a94c5a5 wire bias-vs-lag Step 3A shadow challenger`) appear already on `develop`'s history (`git log` shows them) **[I]**; confirm and remove the worktree and branch when done. (S)
7. **Env-var handling inconsistency**: mail and `API_PUBLIC_URL` read from `process.env` outside `config.ts` (see A5).
8. **Test-comment duplication**: the same "ProfileScreen is not registered" comment is copied into at least 8 test files (drift audit HIGH-1). Cosmetic. And the orphaned `ProfileScreen.tsx` default export is still dead code **[V per audit]**.
9. **Unpinned dependency ranges** (`^`) in both `package.json` files, against repo convention (S).
10. **Docs numbering glitch**: `docs/hosting.md` "Setup Order" skips step 5 (goes 4 -> 6). (S)
11. **`Hosting` docs omit R2/OpenAI/Gemini**: will be wrong the moment photo uploads ship (see docs drift below). (S)

---

## (E) Open specs and remaining work

Checkbox counts come from `- [ ]` / `- [x]` per `tasks.md` **[V]**. Where code exists despite an unchecked box I mark it "stale box".

| Spec | Unchecked | Real status |
|---|---|---|
| photo-uploads | 70 (30 done) | **In progress, not shippable.** Done: shared contracts, migration `0062`, config, pure domain modules, ports/adapters. Not done: repos finalization, service layer (typecheck errors), routes + wiring, admin review queue, vision eval, mobile Phase 1, docs/ops, Phase 2 (trip photos, migration `0063`, feed, recap share). Typecheck red. Needs R2 bucket, OpenAI moderation key, Gemini key. |
| ride-identity-aliases | 16 (0 done) | **Not started.** No `rideIdentity.ts`, no aliases migration (latest migration is `0062`), grep found no `rideAliases`. Optional improvement (shared prediction history across renamed rides; coordinate fallback in optimize route). |
| crowd-calendar | 32 | Mostly **stale parent boxes**: code, migrations `0020`/`0021`, routes, mobile `CrowdCalendarScreen`/`WaitInsightsSection` and `migration0020.test.ts` exist. Truly open: 21.5 (365-day baseline re-anchor, scheduled for 2027-08-01), 10.4 (optional seasonal-prior enrichment), and the unverified tasks 1-7 parents. |
| dark-mode | 13 | Shipped (commit `b3d0fe1`). Open: 7 (baseline capture parent), 8.6 checkpoint, 11 visual verification, 13 polish pass (selected states, text hierarchy, switch colors via `themedSwitchProps`, contrast declarations). Some of 13 may already be done per `POLISH-report.md` **[I]**. Needs an on-device visual pass. |
| day-planning-optimization | 4 | Task 22 (Walk/Wait optimization priority, spec amendments) and task 23 (curated ride/show duration overrides, 23.6 verification gate) appear **unbuilt** (grep for expected identifiers found nothing) **[I]**. |
| experience-lists | 13 | Tasks 22-24 (choice sheet, trip picker, relocated card). **Stale boxes**: `AddToTripOrListChoiceSheet.tsx`, `AddToTripPickerSheet.tsx` exist and are wired in `FloatingActionDock.tsx` / `ExperienceDetailScreen.tsx`. Check 24 (depends on navigation-redesign 17). |
| navigation-redesign | 6 | Task 16 (Home operating-context subtitle with real park hours/weather) and task 17 (split Collection "Food & Lists" into "Food" and "Lists" segments, add "Log a food item") - not verified; likely genuine open UI work. |
| food-lists | 4 | Task 24 (Add-to-List from `DiningReservationCard`, Menu screen item-level add) - not verified. |
| experience-activity-logging | 8 | Tasks 7 and 8: `log_future_date` guard, `maximumDate`, `LogVisitModal` mapping exist -> **stale boxes**. Task 8 (count-based "Log a visit" label in `YourVisitCard`) not verified. |
| disney-facilities-catalog-source | 5 | 15.4 (expose early-entry on `ExperienceDTO`) is real; 15.6-15.8 are explicitly "Future - do not implement now". |
| trip-booking-timeline | 3 | Task 11 parent (sub-items checked, stale), 15/15.1 operator cron setup (see B3). |
| pin-collection | 2 | Task 20/20.1: Festival Foodie historical correctness consuming `festival-booth-tagging` tag data (additive). Pin gate (`node .kiro/specs/pin-collection/verify/run-all.js`) was not run here; only needed if catalogue/art files change. |
| admin-panel, experience-favorites, friend-food-ratings, experience-search-aliases, trip-expenses, catalog-redesign | 0 | All tasks checked. I did not re-verify that every checked task's code/tests exist (see F). Working-tree modifications to `friendFoodRatings.wiring.test.ts`, `pins` route tests, `live/routes.test.ts` are config-fixture changes caused by the new photo config, not new feature work. |
| restaurant-menu-display | 0 | Drift audit LOW-5 says tasks 13/13.1/13.2 were unchecked but implemented; the file now shows 0 unchecked, so likely fixed. |

Total per-spec counts (unchecked/checked) for all 40 specs were computed; only the ones above have unchecked items.

---

## (F) What I could not verify

- **Tests**: I did not run any test suite (as instructed). I cannot say the suites are green; the only gate I ran was `npm run typecheck` (API red, mobile and shared green). The repo's last reference figures (from `docs/runbooks/2026-08-27-commit-and-deploy.md`, about 2 months stale) were API 1973 tests, mobile 835, shared 151.
- **Production state**: what is actually set on Render (secrets, mail provider), which migrations are applied on Neon, whether the three external crons are running, whether FCM/APNs credentials are uploaded to EAS. I deliberately did not read `.env` values.
- **Real Upstash usage and Neon size** under live traffic (the admin panel has views for these; not queried).
- **Whether each checked box has its code/tests** across all 40 specs. I spot-checked experience-activity-logging, experience-lists, crowd-calendar, ride-identity-aliases, photo-uploads, and the dark-mode a11y/ErrorBoundary claims only.
- **Docs drift status**: `.agents/tasks/docs-drift-audit/full-sweep-findings.md` listed 4 HIGH, 5 MEDIUM, 5 LOW items; commit `585ce31 docs(specs): correct stale navigation and sourcing claims` fixed some. I did not recheck each. Known current drift I did see: README says the API hosts "BullMQ background workers" (not started in prod wiring); README/hosting.md say avatars are "no upload, no object storage" (true now, false once photos ship); no mention of mail provider or `API_PUBLIC_URL`; `hosting.md` setup-order numbering.
- **Accessibility, real-device behavior, offline behavior, store review outcomes**: not testable from code reading.
- **Legal conclusions**: the Disney/ThemeParks.wiki usage terms and trademark risk are flagged, not assessed. ThemeParks.wiki's own terms/attribution request were not fetched.
- **Whether `main` or `develop` should be the release branch**: `main` is stale (`458ac63`), Render deploys `develop`, `origin/develop` is one commit behind local.

---

## Recommended order of work

1. Make `develop` green: decide photo-uploads (shelve for v1 recommended) and fix or move the 29 type errors. (A1, A8)
2. Add CI running `npm run verify`. (B1)
3. Account deletion (+ optional export), privacy policy/terms/support links, report/block minimum. (A2, A3, A9)
4. Mail provider config and boot-time guard in prod. (A5)
5. Crash reporting + error boundary + readiness route/uptime monitor. (A7)
6. Decide name/disclaimer/Disney-asset posture; then app icon, splash, version, bundle ids, permission strings, EAS submit config. (A6, A4)
7. Cold-start/offline UX pass, cron/secret/credential checklist, dark-mode visual pass. (B2-B4, B7-B9)
8. Cleanup list (D) and tick/untick stale spec boxes (E) so the spec status is trustworthy.
