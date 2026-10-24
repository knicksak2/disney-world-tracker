# Requirements Document

## Introduction

Disney World Tracker has no way for a user to delete their account. Apple App Store Review Guideline 5.1.1(v) requires any app that supports account creation to let the user initiate deletion of that account from inside the app. This feature adds **self-service account deletion**.

The shape, all decided with the product owner (see "Decisions Already Made"):

1. The user starts deletion from `YouAndCrewScreen` (reached through the "You & Crew" pill on Home), re-authenticates with their password, then types a confirmation phrase.
2. The request is a **soft delete with a grace period** (default 30 days). The account becomes `Pending_Deletion`: every session is revoked, push tokens are disabled, and the user disappears from everything other users can see. Signing back in during the grace period **cancels** the deletion and restores the account.
3. After the grace period an authenticated cron endpoint (202 fast, work async, no always-on worker) **purges** the account: owned trips are transferred or deleted, the user's photos are deleted, content other people reference is kept but **anonymized**, and all remaining personal data is removed.

What the code looks like today (verified by reading it; the design must start from these facts):

- **Sign-in is email + password only.** `apps/api/src/services/auth/routes.ts` has `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/change-password`, `/auth/forgot-password`, `/auth/reset-password`, and `GET /me`. Passwords are Argon2id. There is **no** Sign in with Apple, Google, or any OAuth provider, no provider-id column on `users`, and no provider SDK in `apps/mobile`. (`google-services.json` exists with `"oauth_client": []`, which is Firebase push config, not sign-in.)
- **Sessions** are opaque bearer tokens, sha256-hashed in `sessions` (`revoked_at`), resolved by `createSessionMiddleware` (`sessionMiddleware.ts`). There are no separate refresh tokens; the "refresh token" requirement of the brief maps to `sessions` rows.
- **There are 69 foreign-key columns to `users(id)`** (counted from the column definitions in `apps/api/migrations/*.sql`; the completeness test in Requirement 12.2 is the authority), almost all `ON DELETE CASCADE`. A bare `DELETE FROM users` would therefore silently destroy other people's data: `trips.creator_id` would delete whole trips, and `trip_comments.author_id`, `trip_feed_items.actor_id`, `expenses.payer_id`, `settlements.*` and similar would delete shared records other members rely on. Two columns, `food_items.created_by_user_id` and `user_submitted_locations.created_by_user_id`, have **no** `ON DELETE` action and would make the delete fail outright. `photos.owner_id` is `ON DELETE SET NULL`, so a photo can no longer be found by owner once the user row is gone. Appendix A assigns every one of these an explicit disposition.
- **Cron pattern.** `/internal/pins/reconcile`, `/internal/sampling/run`, `/internal/trip-booking-reminders/run` and `/internal/photos/sweep/run` are `x-cron-secret`-gated, answer `202` on `POST` and `HEAD`, and work in-process. `docs/hosting.md` states that the `GET /health` keep-alive ping **must never** call a database-touching endpoint (Neon CU-hour budget), so each job has its own cron-job.org entry and its own secret. The purge follows that pattern (Requirement 8).
- **Mobile.** `apiRequest` clears the stored session and signs the user out on **any** `401`. A wrong-password response must therefore not be a `401` (Requirement 2).

## Decisions Already Made

These were agreed with the product owner and are requirements, not open questions.

- **D1.** Self-service deletion from the mobile app. The entry point is in `YouAndCrewScreen` (via `YouAndCrewStack`), **not** in `ProfileScreen.tsx`'s default export (not a registered route). Admin-initiated deletion is out of scope (future work).
- **D2.** Soft delete with grace, then hard purge. Default grace is 30 days, `ACCOUNT_DELETION_GRACE_DAYS`. On request: sessions revoked, user hidden from other users, push tokens removed or disabled. Signing in during the grace period cancels the deletion; the client is told the account was restored.
- **D3.** Purge is driven by an authenticated cron endpoint that returns `202` fast and works asynchronously in-process; no new always-on worker, no BullMQ `Worker`. It is idempotent, bounded per run, and resumable.
- **D4.** Owned trips are handled at **purge** time: ownership transfers to the highest-role remaining member (ties go to the earliest joined); a trip whose only member is the deleted user is deleted through the existing trip-delete path including photo cleanup. During the grace period a trip with a deactivated owner keeps working for its other members, using the `trips/permissions.ts` matrix.
- **D5.** The user's own uploaded photos are deleted (soft-delete via `softDeleteByOwner`; the existing storage sweep removes the objects). Content others reference (feed entries, comments, shares others received) is retained but anonymized as a neutral "Deleted user" placeholder, with no PII left.
- **D6.** Pins, Vault, collection, friendships, friend requests, push tokens, notification prefs, favorites and other purely personal data are removed at purge.
- **D7.** The user must re-authenticate and then type a confirmation phrase before the request is accepted. The **server** enforces re-auth freshness.
- **D8.** If a third-party sign-in provider exists, its tokens must be revoked at deletion (Apple requires it). See Requirement 13 for what that means when none exists.

## Assumptions

Reasonable defaults taken where the owner did not decide. Each is flagged in the closing note to the owner.

- **A1. Scheduling uses a dedicated cron-job.org job, not the keep-alive ping.** The brief says "the existing keep-alive cron". `docs/hosting.md` forbids the keep-alive `GET /health` job from touching the database, and every other job (Reminder_Cron, Photo_Cron) is its own cron-job.org entry with its own secret. The purge is built the same way: same scheduler, same endpoint pattern, dedicated secret and entry. The requirement text is "the keep-alive cron's pattern", not the keep-alive job itself.
- **A2. Retained authored text stays verbatim.** Comment bodies and feed-post captions that other members reference are kept as written; only attribution is anonymized (D5). A stricter reading (delete or blank the text) is a one-line change in Appendix A.
- **A3. Owned food and experience lists are deleted at purge**, taking their shares, likes, saves and trip attachments with them (D6, and `trips` R22.11 / `trip_food_lists` cascade). Entries the user added to other people's lists are kept with the adder nulled.
- **A4. Ratings leave the aggregate at purge, not at request.** The aggregate is anonymous, so a pending account's ratings keep contributing during the grace period, and a restore needs no recompute.
- **A5. Trip ownership candidates prefer Active members.** The brief says "highest-role remaining member, ties to earliest joined". Candidates are the remaining `Active` members; only if there are none are remaining `Pending_Deletion` members considered. This stops a trip from being deleted while another member could still restore their account.
- **A6. The email address stays reserved during the grace period** (registration with it returns `email_in_use`). It is freed at purge when the `users` row is deleted.
- **A7. Two best-effort emails** are sent through the existing Mail_Service: "deletion scheduled" and "deletion cancelled". A mail failure never fails the request.
- **A8. Google Play's web-based deletion URL is out of scope** and is called out as follow-up work. `google-services.json` shows an Android build exists.

## Glossary

- **Account_Deletion_Service**: The new backend service in `apps/api/src/services/accountDeletion/` (pure modules, `repo.ts`, `routes.ts`, purge runner), wired in `composeServices.ts` through structural ports.
- **Deletion_State**: The persisted lifecycle of an account: `active`, `pending_deletion`, or `purging`. A purged account no longer has a `users` row.
- **Pending_Deletion**: Deletion was requested and the Grace_Period has not expired. The account is deactivated and restorable.
- **Purging**: The Purge_Run has claimed the account; it is no longer restorable.
- **Grace_Period**: `ACCOUNT_DELETION_GRACE_DAYS` × 24 h, measured from the request.
- **Scheduled_Purge_At**: Request time + Grace_Period, **persisted at request time** so a later config change never moves an already-promised date.
- **Restoration**: The cancellation of a Pending_Deletion by a successful sign-in or password reset before Scheduled_Purge_At.
- **Reauth_Grant**: A short-lived opaque server-issued proof that the caller's current password was verified recently, required by the deletion request.
- **Confirmation_Phrase**: The literal text `DELETE`, defined once in `@dwt/shared`.
- **Visible_User**: A user whose Deletion_State is `active`. Only Visible_Users appear to other users.
- **OMIT / PLACEHOLDER**: The two ways a non-Visible user is presented to others (Requirement 5). OMIT removes the person from the surface. PLACEHOLDER keeps the content and replaces the person with the Deleted_User_Placeholder.
- **Deleted_User_Placeholder**: The neutral identity shown for a deleted person: display name `Deleted user`, generic avatar, no email, no profile, not navigable.
- **Disposition**: What the purge does to rows referencing a user: `DELETE`, `ANONYMIZE`, `NULLIFY`, or `TRIP` (Appendix A).
- **Purge_Run**: One invocation of the purge job, bounded by `ACCOUNT_DELETION_PURGE_BATCH` and `ACCOUNT_DELETION_PURGE_TIME_BUDGET_MS`.
- **Purge_Cron**: The dedicated cron-job.org job that calls the purge endpoint.
- **Interim_Organizer**: An Active trip member who holds organizer rights, derived at authorization time, because the persisted organizer(s) are all Pending_Deletion (Requirement 7).
- **Mobile_App**: `apps/mobile`. **Auth_Service**: `apps/api/src/services/auth`. **Trip_Service**, **Photo_Service**, **Mail_Service**, **Notification_Service**, **Push_Registration_Service**: the existing services under `apps/api/src/services/`.

## Configuration & Constants

All read through `loadConfig` in `apps/api/src/config.ts` (Zod), exposed under a new `accountDeletion` namespace. `.env` and `.env.dev` are not edited by this work; `apps/api/.env.example` and `docs/hosting.md` document the new names.

| Name | Default | Type and validation | Used by |
|---|---|---|---|
| `ACCOUNT_DELETION_GRACE_DAYS` | `30` | integer 1 to 365 | R3 (Scheduled_Purge_At), R1 copy |
| `ACCOUNT_DELETION_CRON_SECRET` | none, **required** | non-blank after trim; must differ from `SAMPLING_CRON_SECRET`, `PIN_RECONCILE_CRON_SECRET`, `TRIP_BOOKING_CRON_SECRET`, and `PHOTOS_CRON_SECRET`; each of those four checks also gains the new secret | R8 |
| `ACCOUNT_DELETION_PURGE_BATCH` | `10` | integer 1 to 100: max accounts claimed per Purge_Run | R8 |
| `ACCOUNT_DELETION_PURGE_TIME_BUDGET_MS` | `25000` | integer 1000 to 120000; matches `PHOTOS_SWEEP_TIME_BUDGET_MS` | R8 |
| `ACCOUNT_DELETION_REAUTH_WINDOW_SECONDS` | `300` | integer 30 to 900: lifetime of a Reauth_Grant | R2 |
| `ACCOUNT_DELETION_CHUNK_ROWS` | `500` | integer 50 to 5000: max rows touched per statement in the purge | R8, R9 |
| `SUPPORT_EMAIL` | none, **required** | trimmed, syntactically valid email (Zod `.email()`, at most 254 characters); exposed as `config.support.email` *(added with R20.4)* | R20.4 |
| `DELETE_ACCOUNT_CONFIRMATION_PHRASE` | `DELETE` | **constant** in `@dwt/shared`, not an env var | R1, R2 |
| `DELETED_USER_DISPLAY_NAME` | `Deleted user` | **constant** in `@dwt/shared` | R5, R6 |

Purge_Cron (documented in `docs/hosting.md`, timezone `America/New_York`): `POST` or `HEAD https://<render-host>/internal/account-deletion/purge/run`, header `x-cron-secret: <ACCOUNT_DELETION_CRON_SECRET>`, crontab `20 8,20 * * *` (twice a day, inside the Render awake window, clear of the Photo_Cron minute `:05` slots). The job is resumable, so a backlog is simply continued by the next pass.

## External Interfaces

**Endpoints this feature adds** (names fixed here so mobile and API tasks agree; request and response shapes are Requirements 2, 3, 4, 8 and live in `@dwt/shared`):

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /me/account/deletion/reauth` | session | Verify the current password, return a Reauth_Grant (R2) |
| `POST /me/account/deletion` | session + Reauth_Grant | Accept the request, enter Pending_Deletion (R3) |
| `POST` and `HEAD /internal/account-deletion/purge/run` | `x-cron-secret` | Start a Purge_Run, answer `202` (R8) |
| `GET /account-deletion` | none (public web) | Render the self-service web account-deletion page and form (R19) |
| `POST /account-deletion` | email + password + phrase (`loginRateLimitConfig`) | Verify credentials and confirmation phrase, enter Pending_Deletion, render HTML confirmation (R19) |
| `GET /privacy` | none (public web) | Render the public Privacy Policy HTML page (R20) |

**Endpoints this feature changes:** `POST /auth/login` and `POST /auth/reset-password` gain an optional `accountRestored: true` response field (R4).

**Existing interfaces reused as-is** (read their real signatures before wiring): `photoService.deleteAllForUser(userId)` and `photoService.softDeleteForTarget('trip', tripId)` (`photos/service.ts`); the sweep runner and its `tryStart()` single-flight shape (`photos/sweep.ts`, `sweepCronRoute.ts`, including `secretMatches`); `TripRepo.deleteTrip`, `TripRepo.leaveTrip` and `lockMemberships` semantics (`trips/repo.ts`); `AggregateRepo.recomputeFromScratch(experienceId)` (`aggregate/repo.ts`); `PushRepo.invalidateByToken` / `listActiveTokensForUser` (`push/repo.ts`); `LockoutService` (`auth/lockout.ts`); `MailService` (`auth/mailService.ts`); `can`, `violatesLastOrganizer` (`trips/permissions.ts`); `loginRateLimitConfig` (`plugins/rateLimit.ts`).

**Third-party sign-in provider revocation.** None is integrated, so nothing is called. For the record, if Sign in with Apple is added later, the revocation call is `POST https://appleid.apple.com/auth/revoke` (form-encoded `client_id`, `client_secret`, `token`, `token_type_hint`), where `client_secret` is an ES256 JWT signed with the team's Sign-in-with-Apple key. That description is from memory of Apple's documentation and **has not been verified in this work**; verify it against Apple's current documentation before implementing (Requirement 13).

## Cross-Spec Dependencies and Build Order

This spec depends on features that already exist and must not be started before they are present: `disney-world-tracker` (auth, profiles, friends, shares, aggregate ratings), `password-reset`, `trips` with `trip-booking-timeline`, `trip-expenses` and the trip food/experience list attachments, `photo-uploads` (its `deleteAllForUser` extension point and sweep), `social-sharing-loop` (push registrations), `notification-center`, `pin-collection`, `experience-favorites`, `food-lists`, `experience-lists`, `experience-activity-logging`, `food-item-logging`, `admin-panel`, and `dark-mode` (the mobile theme guard).

Build order inside this spec (later items need the earlier ones):

1. `@dwt/shared`: constants, DTOs, Zod schemas, error codes (R16).
2. Migration `0064_account_deletion.sql` (or the next free number): Deletion_State columns, the FK changes Appendix A needs, anonymization support, the purge ledger (R3, R9, R12).
3. Pure modules: state machine, owner selection, disposition registry (R9, R10, R12).
4. The Visible_User predicate and the retrofit of every Appendix B surface, with its guard test (R5).
5. `trips/permissions.ts` Interim_Organizer (R7).
6. Request flow: reauth, deletion, session revoke, push disable, email (R2, R3).
7. Restoration on login and reset, plus the session-middleware defense (R4).
8. Purge runner, cron route, `composeServices.ts` and `server.ts` wiring (R8 to R12).
9. Mobile: delete screen, restored notice, placeholder rendering (R1, R4, R6).
10. Docs and existing-spec amendments (R15, R18).
11. The single final `npm run verify` for the whole change (R17).

## Requirements

### Requirement 1: Delete-account entry point and mobile flow

**User Story:** As a signed-in user, I want to delete my account from inside the app, so that I control my data and the app meets App Store rules.

#### Acceptance Criteria

1. THE Mobile_App SHALL show a "Delete account" control in the "Preferences & Security" section of `YouAndCrewScreen` (`you-and-crew-screen`), below "Blocked Users" and above "Log out", with `testID` `delete-account-entry-button`, `accessibilityRole` `button`, an `accessibilityLabel` that names the action, and danger styling that is not conveyed by colour alone (an icon and the word "Delete" are both present).
2. THE Mobile_App SHALL NOT add the control to `ProfileScreen.tsx`'s default export (not a registered route); THE control SHALL open a new `DeleteAccount` screen registered in `YouAndCrewStack` (`YouAndCrewStackParamList` gains `DeleteAccount: undefined`).
3. THE `DeleteAccount` screen SHALL present three steps in order: (a) a review step that lists the consequences in plain language, (b) a re-authentication step with a password field, and (c) a confirmation step with a text field.
4. THE review step SHALL state that: every device is signed out immediately; the account is hidden from friends and trip members; the account and its data are permanently deleted after `graceDays` days (the value returned by the server, never hard-coded in the client); signing in again before then cancels the deletion; photos are deleted; trips the user owns are handed to another member or deleted if the user is the only member; content other people can see, such as comments, is kept but shown as "Deleted user".
5. WHEN the user submits the password step, THE Mobile_App SHALL call `POST /me/account/deletion/reauth` with `{ password }` and, on success, advance to the confirmation step holding the returned Reauth_Grant in memory only (never persisted, never logged).
6. THE confirmation step SHALL keep its submit control disabled until the typed text, trimmed, equals the Confirmation_Phrase exactly (case-sensitive), and SHALL show the phrase to type.
7. WHEN the user submits the confirmation step, THE Mobile_App SHALL call `POST /me/account/deletion` with `{ reauthGrant, confirmation }` and, on success, run the same local sign-out sequence as logout (`invalidatePushRegistration()`, then clear the session token and the query cache) without calling `POST /auth/logout`, and SHALL then show a final confirmation that states the `scheduledPurgeAt` date and how to cancel.
8. IF the re-authentication step receives `reauth_failed`, THEN THE Mobile_App SHALL show an inline "password is incorrect" message, SHALL keep the user signed in and on the same step, and SHALL clear the password field. IF it receives `account_locked`, THEN THE Mobile_App SHALL show the lockout message used by `LoginScreen`.
9. IF the confirmation step receives `reauth_required` (grant expired), THEN THE Mobile_App SHALL return the user to the re-authentication step with an explanatory message. IF it receives any other error, THEN THE Mobile_App SHALL show the server message inline and keep the user signed in.
10. WHILE a request is in flight, THE Mobile_App SHALL disable the submit control and show a busy indicator so a double tap cannot send two requests.
11. THE `DeleteAccount` screen SHALL build styles with `makeStyles` / `useAppTheme`, SHALL contain no raw colour literal (the theme guard `themeRetrofit.guard.test.ts` must stay green), SHALL give every field a label and every error text an accessible role, and SHALL work under both light and Twilight dark schemes.
12. THE Mobile_App SHALL hold the password and the Reauth_Grant only in component state and SHALL clear both on success, on cancel, and on unmount.
13. *(Refinement of 1.7, added at design review.)* AFTER a successful `POST /me/account/deletion` THE Mobile_App SHALL NOT call `invalidatePushRegistration()` or any other authenticated endpoint (the server has already revoked every session and removed the push registrations, so such a call would return `401` and fire the global unauthorized handler mid-transition). INSTEAD it SHALL store a non-persisted `accountDeletionNotice { scheduledPurgeAt, graceDays }` in the session store, THEN clear the session token and the query cache, and the `LoginScreen` (first screen of the signed-out stack) SHALL render the notice as a dismissible, screen-reader-announced banner stating the `scheduledPurgeAt` date and that signing in cancels the deletion. The notice SHALL NOT survive an app restart.
14. *(Refines 1.13 and 4.9, added at design review round 2.)* BECAUSE `accessibilityLiveRegion` is Android-only in React Native, the deletion notice (1.13) and the restored notice (4.9) SHALL each keep `accessibilityRole="alert"` AND call `AccessibilityInfo.announceForAccessibility(message)` once from a mount effect, with the full banner text (date included), so the announcement also happens on iOS.
15. *(Added at design review round 2.)* IF the response to `POST /me/account/deletion` is lost after the server committed, THEN every session is already revoked, so any further authenticated call (including a manual retry of the request) returns `401` and the global handler signs the user out. The Mobile_App then has no `scheduledPurgeAt` to show, the "deletion scheduled" email is the record, and the sign-in screen shows no deletion notice; the Mobile_App SHALL NOT retry the request automatically. This limitation is accepted and documented, not worked around.
16. *(Clarifies 1.4, added at chunk E review.)* BECAUSE `graceDays` is only returned by the re-authentication step (2.2), the review step (1.4(a)) cannot state the number. THE review step SHALL state the grace-period consequence without a day count (for example "when the grace period ends"), and the confirmation step (1.3(c)) SHALL state the server's `graceDays` value. The client SHALL NOT hard-code a day count on either step.

### Requirement 2: Server-enforced re-authentication and confirmation

**User Story:** As the account owner, I want a stolen or left-open session to be unable to delete my account, so that deletion needs proof that I know my password right now.

#### Acceptance Criteria

1. THE Account_Deletion_Service SHALL expose `POST /me/account/deletion/reauth` behind `requireSession`, accepting `{ password }` validated by a shared Zod schema (non-empty string, at most 128 characters).
2. WHEN the password matches the caller's Argon2id hash, THE service SHALL return `200 { reauthGrant, expiresAt, graceDays }`, where `reauthGrant` is an unguessable opaque token of at least 32 random bytes and `expiresAt` is now + `ACCOUNT_DELETION_REAUTH_WINDOW_SECONDS`.
3. THE service SHALL store only a hash of the Reauth_Grant, bound to the caller's user id **and the current session**, with an expiry, in a bounded store (rows pruned after expiry; no polling), and SHALL treat a grant as usable exactly once.
4. IF the password does not match, THEN THE service SHALL respond with `reauth_failed` and HTTP **403** (never `401`, so `apiRequest` does not sign the user out), SHALL record a failure with the existing `LockoutService` for that user, and SHALL NOT reveal anything beyond the code.
5. IF the user is locked out (`LockoutService.isLocked`), THEN THE service SHALL respond `account_locked` before doing any password work, and a successful re-auth SHALL clear the lockout counter exactly as login does.
6. THE reauth route SHALL carry the same per-route rate limit as login (`loginRateLimitConfig()`).
7. THE `POST /me/account/deletion` route SHALL require `requireSession` and a body `{ reauthGrant, confirmation }`, and SHALL reject the request unless **all** of the following hold, checked server-side: the grant exists, is unexpired, is unused, and is bound to this user and this session; and `confirmation`, trimmed, equals the Confirmation_Phrase exactly.
8. IF the grant is missing, expired, used, or bound to another user or session, THEN THE service SHALL respond `reauth_required` (HTTP 403) and SHALL change no state. IF the confirmation text is wrong, THEN THE service SHALL respond `account_deletion_confirmation_invalid` (HTTP 400) and SHALL change no state and SHALL NOT consume the grant.
9. THE service SHALL consume the grant and apply the state change in a single transaction, so two concurrent requests with one grant cannot both succeed.
10. THE service SHALL NOT log, persist in plaintext, or echo the password, the grant, or the confirmation text, other than returning the grant once from the reauth route.
11. *(Refinement of 2.6, added at design review.)* THE reauth route SHALL use the login budget (`DEFAULT_LOGIN_ACCOUNT`) through a new `reauthRateLimitConfig()` keyed on the SHA-256 of the caller's bearer token, because `loginRateLimitConfig()` keys on `body.email`, which the reauth body does not carry, and would fall back to a per-IP bucket shared with every login on the same network.
12. *(Refines 2.3, added at design review.)* THE service SHALL prune expired grants inside the same transaction that issues a new grant (`DELETE FROM account_deletion_reauth_grants WHERE expires_at < $now`), so the store is bounded with no polling and no idle write.
13. *(Refines 2.5, added at design review round 3.)* A successful re-authentication SHALL NOT call `LockoutService.clearOnSuccess` (and so SHALL NOT reset the login-failure counter): the holder of a stolen session must not be able to reset the counter that protects the account's password through a route that exists only to confirm a deletion. A failed re-authentication still records a failure (2.4), and a locked account is still refused before any password work (2.5, first clause). This supersedes only the clause of 2.5 that says a successful re-auth clears the counter; the user's own next login clears it as it always did.

### Requirement 3: Deletion request and the Pending_Deletion state

**User Story:** As a user who confirmed deletion, I want my account deactivated immediately and scheduled for permanent deletion, so that I am gone from other people's view while I can still change my mind.

#### Acceptance Criteria

1. WHEN a valid deletion request is accepted, THE Account_Deletion_Service SHALL, in one transaction, set the account's Deletion_State to `pending_deletion`, record the request time, and persist `Scheduled_Purge_At` = request time + `ACCOUNT_DELETION_GRACE_DAYS` × 24 h (UTC `TIMESTAMPTZ`).
2. IN the same transaction THE service SHALL revoke every session of the user (`sessions.revoked_at = now()` where it is null), including the caller's own, and SHALL expire every unused password-reset token of the user.
3. IN the same transaction, or in a follow-up step that is retried until it succeeds and never blocks the response, THE service SHALL disable the user's push delivery: delete or invalidate every `push_registrations` row for the user so `listActiveTokensForUser` returns none.
4. THE service SHALL respond `200 { status: 'pending_deletion', scheduledPurgeAt, graceDays }` and SHALL send the "deletion scheduled" email through Mail_Service naming `scheduledPurgeAt` and explaining that signing in cancels the deletion (Assumption A7).
5. IF the email cannot be sent, THEN THE service SHALL log at `warn` without the recipient address and SHALL still return success.
6. THE service SHALL delete or modify **none** of the user's data at request time other than the sessions, reset tokens and push registrations above; photos, trips, friendships, ratings and everything else stay intact so that Restoration is lossless.
7. IF the account is already `pending_deletion` or `purging`, THEN THE request path SHALL be unreachable because no session exists; a conditional update (`WHERE deletion_state = 'active'`) SHALL still make the state transition idempotent against a race.
8. THE service SHALL reserve the user's email address while the account is pending (Assumption A6); a registration with that address SHALL continue to answer `email_in_use`.
9. THE service SHALL NOT allow any other principal (another user, an admin) to request deletion of a user's account in this release.

### Requirement 4: Sign-in during the grace period (Restoration)

**User Story:** As a user who changed my mind, I want to get my account back by signing in, and to be told it was restored.

#### Acceptance Criteria

1. WHEN `POST /auth/login` verifies correct credentials for an account in `pending_deletion` whose `Scheduled_Purge_At` is in the future, THE Auth_Service SHALL, through an injected Account_Deletion port, atomically set the account to `active` (`WHERE deletion_state = 'pending_deletion' AND scheduled_purge_at > now()`), clear the request and schedule columns, create the session, and return the normal login body plus `accountRestored: true`.
2. WHEN a login is for an `active` account, THE response SHALL NOT contain `accountRestored` (absent, not `false`), so existing clients are unaffected.
3. WHEN `POST /auth/reset-password` succeeds for an account in `pending_deletion` whose `Scheduled_Purge_At` is in the future, THE Auth_Service SHALL apply the same Restoration and return `accountRestored: true` in `ResetPasswordSuccessDTO`. THE web fallback `POST /auth/reset-password-web` SHALL restore the account as well; its HTML success page SHALL say the account was restored.
4. IF credentials are correct but `Scheduled_Purge_At` is at or before now, OR the account is `purging`, THEN THE Auth_Service SHALL answer exactly as for wrong credentials (`invalid_credentials`, HTTP 401) and SHALL NOT restore the account. The grace boundary is strict: a restore succeeds only while `now < Scheduled_Purge_At`.
5. IF the Restoration races the purge claim, THEN exactly one SHALL win: both are conditional updates on `deletion_state`, and the loser SHALL behave as above.
6. THE `forgot-password` flow SHALL treat a `pending_deletion` account whose grace has not expired like an active one (a reset email is sent), and SHALL treat an expired or `purging` account like a non-existent one, preserving its anti-enumeration behaviour.
7. WHEN Restoration happens, THE Account_Deletion_Service SHALL send a best-effort "deletion cancelled" email, SHALL leave every piece of the user's data exactly as it was (Requirement 3.6), and SHALL NOT need to restore push registrations (the Mobile_App re-registers on sign-in through `usePushRegistration`).
8. THE session middleware SHALL, as defense in depth, reject (`unauthorized`) a session whose user is not `active`, even if an unrevoked session row somehow survived, so a request-time failure to revoke can never leave a working session on a pending account.
9. WHEN the Mobile_App receives `accountRestored: true` from login or password reset, THE Mobile_App SHALL, after the session is stored and the main tabs are shown, display a one-time, dismissible, screen-reader-announced notice: "Welcome back. Your account deletion was cancelled and your account has been restored." The notice SHALL not reappear after it is dismissed or on the next launch.
10. LOGIN failures against a `pending_deletion` account SHALL count toward the existing lockout exactly as for an active account.
11. *(Added at design review round 2: restore must not strand a changed password.)* THE reset flow SHALL restore the account BEFORE, or in the same transaction as, consuming the reset code and changing the password, so a restore that loses the race to the purge claim changes nothing (no password change, code not consumed).

### Requirement 5: Hidden from every other user

**User Story:** As a user who asked to be deleted, I want to vanish from everyone else's screens right away, so that my crew no longer sees me while my account waits out the grace period.

#### Acceptance Criteria

1. THE Account_Deletion_Service SHALL export **one** shared definition of Visible_User (a SQL predicate or view plus a TypeScript helper) in `accountDeletion/visibility.ts`, and every cross-user read listed in Appendix B SHALL use it rather than re-deriving the condition.
2. FOR every Appendix B surface marked OMIT, THE API SHALL omit a non-Visible user from results and counts, and SHALL answer a direct lookup of that user with the existing non-probing code for that surface (for example `profile_forbidden`, `stats_target_not_found`, `friend_recipient_unknown`, `trip_not_found`), never with a code that reveals deactivation.
3. FOR every Appendix B surface marked PLACEHOLDER, THE API SHALL keep the content and present its non-Visible author or participant as the Deleted_User_Placeholder (Requirement 6) while the account is pending.
4. WHILE an account is `pending_deletion`, THE Notification_Service SHALL NOT send a push to it, and THE Notification_Center SHALL NOT surface any item whose counterparty is non-Visible.
5. WHILE an account is `pending_deletion`, THE Photo_Service SHALL NOT serve its photos on any read path (dish and restaurant galleries, Trip Album, recap, feed post slots, admin queue excepted), SHALL NOT change any photo row's status, and SHALL serve them again after Restoration.
6. THE API SHALL NOT use deactivation as a signal that is observable to another user: a deactivated friend and a never-existing friend SHALL be indistinguishable on OMIT surfaces.
7. THE admin panel is not "another user" and SHALL continue to see the account, marked as pending (Requirement 18's `admin-panel` amendment).
8. THE project SHALL include a structural guard test that scans non-test sources under `apps/api/src/services/**` for `FROM profiles`, `JOIN profiles`, `FROM users` and `JOIN users` and fails when a file contains one without either using the shared Visible_User helper or being listed in an explicit allowlist with a one-line reason (the allowlist names self-reads such as `GET /me`, the auth service, and admin). The guard SHALL fail on a new unlisted query so a future surface cannot silently leak. The allowlist SHALL only be shrunk or extended with a reason, never bypassed.
9. EVERY read surface retrofitted for this requirement SHALL have a pg-mem repo test that seeds an Active and a Pending_Deletion user and asserts the pending user is absent (OMIT) or shown as the placeholder (PLACEHOLDER).
10. *(Added at design review: surfaces missing from Appendix B.)* THE following SHALL also be retrofitted and tested: share-reaction names shown to the sender (`reactions/repo.ts`, OMIT); the friend gate of the shared trip recap (`sharing/tripRecapGate.ts`, reads `active_friendships`, so a pending sender's recap is unavailable); the existence check on the stats deny path (`stats/routes.ts` `targetExists`, SHALL treat a non-active user as non-existent so a pending friend yields `stats_target_not_found` exactly like a never-existing id and never `profile_forbidden`); and `pins/repo.ts` `reconcileAll` (SHALL iterate only `active` users).
11. *(Added at design review.)* WHILE an account is `pending_deletion`, THE share inbox, Sent list and single-share lookups SHALL present the sender's embedded names and ids the same way as `senderDisplayName`: `payload.ownerDisplayName` and `payload.ownerId` of a `pinShowcase` share, and `payload.sharerDisplayName` of a `tripSummary` share SHALL be replaced at read time by `Deleted user` and the sender's public (alias) id, with the stored payload unchanged.
12. *(Added at design review round 2.)* A second structural guard SHALL scan non-test sources under `apps/api/src/services/**` for `FROM|JOIN trip_memberships` and fail on any file not in an allowlist that carries a one-line reason per file (caller-membership check, roster read through `active_trip_memberships`, money exception), so a new roster read cannot silently expose a pending member.
13. *(Added at design review round 3: makes 5.8 mechanical.)* THE guard of 5.8 SHALL define a "hit" as a string or template literal in a non-test source file under `apps/api/src/**` (not only `services/**`, so `composeServices.ts` is covered) whose text matches `(FROM|JOIN)\s+(profiles|users|friendships)\b`. A hit SHALL pass when the same literal contains `ACTIVE_USER_SQL(` or the text `deletion_state = 'active'`. Every other hit SHALL be allowlisted per file with a one-line reason and a pinned residual hit count, so a new unlisted query, or a new raw query inside an allowlisted file, fails the guard.
14. *(Added at design review round 4: makes 5.4 and `notification-center` R14.1 mechanical.)* THE Notification_Center attention feed and attention badge count SHALL include an item only while its counterparty is an `active` account. WHILE the sender of a Share is `pending_deletion`, `purging` or `tombstone`, `GET /me/inbox/unread-count` SHALL NOT count that Share and the attention feed SHALL NOT list it, although the Share remains in `GET /me/inbox` as the Deleted_User_Placeholder (Appendix B, PLACEHOLDER). WHILE the tagging member of a pending Rode_With_Tag is not a Visible_User, `GET /me/rode-with-tags?state=pending` SHALL omit that tag. WHEN the counterparty is restored to `active`, the item SHALL be counted and listed again on the next read with no stored change. This clarifies `notification-center` R14.3 without editing it: after purge the Share stays in the Share Inbox but does not re-enter the attention feed or badge, because a client cannot tell a pending alias from a tombstone and a purge must not re-surface an item from a deleted person.

### Requirement 6: Anonymized identity

**User Story:** As a crew member, I want content from a deleted person to stay intact but not identify them, so that trip history makes sense without exposing someone who left.

#### Acceptance Criteria

1. THE shared constant `DELETED_USER_DISPLAY_NAME` (`Deleted user`) SHALL be the only name used for a deleted or pending person on PLACEHOLDER surfaces, and the avatar SHALL be the generic placeholder avatar (no preset id).
2. A placeholder person SHALL carry no email, no avatar preset, no profile link, and no value derived from the original display name, email, or avatar, in any response, log line, or notification.
3. A response field that carries a user id for a placeholder person SHALL NOT carry the original user's id. The design SHALL choose and justify how a placeholder id is represented and SHALL ensure two different deleted people in the same record set never collide on a unique key or get their money merged (see Appendix A, "Design constraints").
4. THE Mobile_App SHALL render a placeholder person with the generic avatar and the text "Deleted user", SHALL NOT make it tappable to a profile or comparison screen, SHALL NOT offer friend, invite, share, block or compare actions on it, and SHALL give it an accessibility label that includes "Deleted user".
5. WHEN a pending account is restored, THE API SHALL show the person's real name again everywhere, because during the grace period anonymization is a read-time projection and no stored attribution has changed (Requirement 3.6).
6. AFTER purge, no row in any table, no JSONB value, and no search index SHALL contain the original user's id, email, display name, or avatar preset. The project SHALL include a residual-reference test (Requirement 12.6) that proves it.
7. *(Added at design review.)* THE embedded-name inventory of `shares.payload_snapshot` is exactly: `pinShowcase` (`ownerId`, `ownerDisplayName`) and `tripSummary` (`sharerDisplayName`); `experience` (optional `note`) and `progress` embed no id or name. THE residual-reference test SHALL seed all four payload kinds.

### Requirement 7: Trips keep working while an owner or organizer is pending

**User Story:** As a trip member, I want the trip to keep working when its organizer leaves the app, so that the rest of us are not locked out of editing, inviting, or deleting while we wait for the purge.

#### Acceptance Criteria

1. WHILE a Trip has no `Active` organizer but at least one `Active` member, THE Trip_Service SHALL treat the Active member with the earliest `joined_at` (ties by lowest user id) as an Interim_Organizer for authorization, derived at request time from the roster and **never persisted**.
2. THE derivation SHALL be a pure function in `apps/api/src/services/trips/permissions.ts` (`effectiveRole(members, userId)` or an equivalent signature chosen in the design, with unit and property tests), and the matrix `can(role, action)` SHALL remain the single source of authorization; no route SHALL invent a separate check.
3. THE Last_Organizer_Rule (`violatesLastOrganizer`) SHALL continue to be evaluated over the persisted membership set, unchanged, so existing guards behave as before and a pending organizer still counts as an organizer for that rule.
4. WHILE a member is pending, THE Trip_Service SHALL omit them from the roster, member counts and pickers (OMIT), and SHALL present their authored content as the placeholder (PLACEHOLDER), per Appendix B.
5. WHEN a pending organizer is restored, THE Trip_Service SHALL return to the persisted roles with no further action, because nothing was persisted for the interim.
6. WHERE an organizer-only action is attempted by an Interim_Organizer, THE Trip_Service SHALL authorize it exactly as for a persisted organizer, with no new `TripAction` unless the design shows the matrix cannot express the rule; any new action SHALL be added to `permissions.ts` with its member/organizer-only classification and a matrix test.
7. A Trip with no `Active` member (every member pending) SHALL remain stored and unmodified until the purge rules in Requirement 10 apply; no read or write by the pending members is possible because they have no session.

### Requirement 8: Purge trigger, runner, and cron endpoint

**User Story:** As the operator, I want expired accounts purged automatically on the free tier without a worker, so that deletion completes without costing a second always-on process.

#### Acceptance Criteria

1. THE Account_Deletion_Service SHALL expose `POST` and `HEAD /internal/account-deletion/purge/run`, gated by the `x-cron-secret` header compared in constant time against `ACCOUNT_DELETION_CRON_SECRET` (reusing the `secretMatches` helper), answering `unauthorized` for a missing or wrong secret.
2. THE endpoint SHALL answer `202` immediately: `POST` with `{ status: 'accepted' }` or, when a run is already in flight, `{ status: 'skipped', reason: 'in_flight' }`; `HEAD` with no body. The work SHALL then run asynchronously in-process; errors SHALL be logged and never surfaced to the caller.
3. THE runner SHALL be single-flight within a process (`tryStart()` shape as in `photos/sweep.ts`) AND SHALL claim each account with a database-level conditional update (`pending_deletion` and `scheduled_purge_at <= now()` to `purging`, using `FOR UPDATE SKIP LOCKED`), so two instances can never purge the same account.
4. THE runner SHALL be bounded: it SHALL claim at most `ACCOUNT_DELETION_PURGE_BATCH` accounts per run, SHALL touch at most `ACCOUNT_DELETION_CHUNK_ROWS` rows per statement, and SHALL stop starting new work when `ACCOUNT_DELETION_PURGE_TIME_BUDGET_MS` has elapsed.
5. THE runner SHALL be resumable: an account left in `purging` by a crash, timeout, or budget stop SHALL be picked up again by the next run (a `purging` account older than a stale-claim threshold of 15 minutes is re-claimable), and every purge step SHALL be idempotent so repeating a step after a partial failure produces the same final state as running it once.
6. THE runner SHALL process accounts independently: a failure purging one account SHALL be logged (user id hash only, never email or name) and SHALL NOT stop the run or roll back other accounts.
7. THE keep-alive job (`GET /health`) SHALL NOT call this endpoint; `docs/hosting.md` SHALL document the dedicated Purge_Cron (Configuration & Constants) and its Neon and Render impact.
8. THE runner SHALL be constructed in `composeServices.ts` through structural ports (trips, photos, push, aggregate, mail, clock, store) so tests substitute fakes, and registered in `server.ts` like `sweepCronRoute`.
9. THE endpoint SHALL start no Redis polling and no BullMQ `Worker`, and SHALL use at most O(accounts claimed) Redis commands (the runner needs none).
10. WHEN no account is due, THE run SHALL do a single indexed query and finish, so an idle pass costs one short Neon wake.
11. *(Refinement of 8.3, 8.4 and 8.10, added at design review.)* (a) THE claim SHALL be one statement, `UPDATE users ... WHERE id IN (SELECT id ... FOR UPDATE SKIP LOCKED LIMIT $batch) RETURNING ...`, which keeps requirement 8.3's `SKIP LOCKED` and makes the lock last until the update. (b) A `purging` account whose `purge_claimed_at` is `NULL` (released) or older than the 15 minute threshold SHALL be re-claimable, and the runner SHALL release (set `purge_claimed_at = NULL`, conditional on its own claim) every account it claimed but did not finish when the time budget is spent. (c) THE time budget SHALL be checked before every chunk and before every stage of an account, not only between accounts; on expiry the runner persists `purge_stage`, releases the claim and stops. (d) THE idle pass SHALL be at most two indexed statements (the claim, which finds nothing, and one recompute-queue read) and SHALL write nothing; this replaces the "single query" of 8.10 because the durable recompute queue of Requirement 9.9 must be drained even when no account is due.
12. *(Added at design review round 2: stuck accounts.)* AN account whose purge fails deterministically (a thrown stage, or `finalize` reporting remaining references) SHALL NOT starve newer accounts. The database SHALL record `purge_attempts` and `purge_last_attempt_at`; the claim SHALL order by `purge_attempts ASC, scheduled_purge_at ASC, id ASC`; a thrown stage or a `refs_remain` result SHALL increment the attempts and release the claim; a `refs_remain` result SHALL also rewind `purge_stage` to `0` so every stage re-runs; `purge_attempts` SHALL reset to `0` when a stage completes; the operator's user lookup SHALL show `purge_attempts` when it is above zero; and the runner SHALL log once at `error` when an account reaches `PURGE_ATTEMPTS_ALERT` attempts.
13. *(Added at design review round 3: clarifies 8.12.)* THE reset-on-stage rule of 8.12 SHALL NOT prevent the counter from accumulating across `refs_remain` rewinds: because every rewind re-runs stages that each reset `purge_attempts` to `0`, a `refs_remain` result SHALL set `purge_attempts` to the value read at claim time plus one (an absolute write from the claim-time value), so five consecutive `refs_remain` runs of one account reach `PURGE_ATTEMPTS_ALERT`, log the `error` exactly once, and show `purge_attempts = 5` in the operator's user lookup. A thrown stage still increments the stored value by one.

### Requirement 9: Purge procedure for one account

**User Story:** As the operator, I want a precise, safe order of operations, so that no other user's data is lost and a half-finished purge can always be finished.

#### Acceptance Criteria

1. THE purge of one claimed account SHALL perform these stages in this order, each idempotent: (1) re-verify the claim is still valid; (2) delete the user's photos (Requirement 11); (3) resolve every trip the user belongs to (Requirement 10); (4) anonymize retained content (Appendix A, `ANONYMIZE` rows); (5) delete the user's personal data (Appendix A, `DELETE` rows) and apply `NULLIFY` rows; (6) recompute the aggregate rating of every Experience the user rated (Requirement 12.4); (7) delete the `users` row; (8) write the ledger row (Requirement 9.6).
2. THE photo stage SHALL run **before** the `users` row is deleted, because `photos.owner_id` becomes `NULL` on user deletion and the photos could then no longer be found by owner.
3. THE trip stage SHALL run before the personal-data stage, because `trips.creator_id` is `ON DELETE CASCADE` and deleting the user first would delete trips other members still use.
4. EACH stage SHALL be recorded as done on the account's purge progress so a resumed run skips completed stages, and SHALL be safe to repeat if the progress write itself was lost.
5. THE `users` row SHALL be deleted only after every earlier stage has completed, in a transaction that first confirms no row in an `ANONYMIZE`, `NULLIFY` or `TRIP` column still references the user (rows in `DELETE` columns are removed by the cascade or by stage 5). IF any such reference remains, THEN THE purge SHALL abort that account's final stage, leave it in `purging`, and log at `error`, rather than let the cascade delete shared data.
6. WHEN an account is purged, THE service SHALL write one **non-identifying** ledger row (no user id, no email, no name): `requested_at`, `purged_at`, `trips_transferred`, `trips_deleted`, `photos_deleted`, `outcome`. THE ledger is a small fixed-shape table, pruned to the most recent 1000 rows, used by the admin panel (Requirement 18 amendment) and for operator proof that purges ran.
7. THE purge SHALL NOT write the deleted user's id, email, or name to any log, queue, or audit record; log lines identify an account by a one-way hash truncated to 12 hex characters.
8. AFTER step 7 the freed email address SHALL be available for a new registration.
9. *(Refinement of 9.1 steps 6 and 8, added at design review.)* THE aggregate recompute SHALL run from a durable queue of experience ids (`account_deletion_recompute_queue`, ids only, no user reference): stage 5 enqueues the rated experience ids before the ratings are deleted, and the queue is drained after `finalize` and at the start of every run, so a crash cannot lose a recompute. A rating may therefore outlive the purge in the aggregate by at most one cron interval (Assumption A4).
10. *(Refinement of 8.4, added at design review.)* EVERY statement the purge issues against a table that can hold more than `ACCOUNT_DELETION_CHUNK_ROWS` rows for one user (all registry rows, and the photo soft-delete, which SHALL accept an optional `limit`) SHALL touch at most that many rows and SHALL be repeated until it affects zero rows. Tables that hold at most one row per user are bounded by their key.
11. *(Added at design review round 2: ledger sequencing.)* THE best-effort Redis lockout cleanup of Requirement 12.5 SHALL run before `finalize` (at the end of the personal-data stage; it is idempotent), SHALL record its outcome in a `users.purge_warnings` counter, and `finalize` SHALL write the ledger `outcome` (`completed` or `completed_with_warnings`) from that counter in the same transaction that deletes the user, so the outcome is never decided after the row that carries it is gone.
12. *(Added at design review round 3: clarifies 9.9 and 9.10.)* THE enqueue of the user's rated experience ids into the recompute queue is itself a statement over a table that can exceed `ACCOUNT_DELETION_CHUNK_ROWS` rows for one user, so it SHALL be keyset-chunked (at most that many rows per statement) and SHALL complete, for all of the user's ratings, before the first statement that deletes a `ratings` row of that user.

### Requirement 10: Trip ownership at purge

**User Story:** As a trip member, I want a trip to land with someone responsible when its owner deletes their account, and to disappear only if nobody is left.

#### Acceptance Criteria

1. FOR every Trip the account is a member of, THE purge SHALL lock the Trip's membership set (`FOR UPDATE`, as `departMember` does) and compute the remaining members as all members except the account being purged.
2. IF there are no remaining members, THEN THE purge SHALL delete the Trip through the existing path: `photoLifecycle.softDeleteForTarget('trip', tripId)` and then `TripRepo.deleteTrip(tripId)`, so photos are soft-deleted before the cascade removes the Trip, exactly as `DELETE /trips/:id` does.
3. IF the account is the Trip's `creator_id` and members remain, THEN THE purge SHALL set `creator_id` to the selected new owner, chosen by the pure function `selectNewOwner(remaining)`: candidates are the remaining `Active` members, or, if none, the remaining `Pending_Deletion` members (Assumption A5); within the candidates the order is role `organizer` before `member`, then earliest `joined_at`, then lowest user id. Members in `purging` are never candidates.
4. THE new owner SHALL hold the `organizer` role afterwards: IF the selected member is a `member`, THEN THE purge SHALL promote them in the same transaction.
5. IF the account is an organizer (creator or not) and its removal would leave a non-empty Trip with no organizer (`violatesLastOrganizer`), THEN THE purge SHALL promote the selected member to `organizer` in the same transaction before removing the account's membership. The Last_Organizer_Rule SHALL hold after every purge transaction.
6. THE purge SHALL cancel the account's `pending` rode-with tags and pending invites on the Trip exactly as a member departure does (`trips` R8.6, R8.7), and SHALL delete the account's `trip_memberships` row.
7. THE log entries, feed items, planned items, comments, expenses, settlements and guests the account created SHALL be retained and anonymized per Appendix A (`trips` R8.5 and `trip-expenses` R8.5 already preserve a departed member's records; this extends that to a deleted account).
8. THE trip resolution SHALL be one transaction per Trip, so a failure leaves that Trip either fully resolved or untouched; a retry SHALL find a resolved Trip and skip it.
9. THE selection function SHALL be pure and covered by a property test (Requirement 17.2).
10. *(Refinement of 10.2, added at design review.)* BECAUSE the purge already holds the Trip row and membership locks in its own transaction, it SHALL perform the delete itself rather than call `TripRepo.deleteTrip`, in this order inside that one transaction: lock the `trips` row `FOR UPDATE`; read the memberships `FOR UPDATE`; compute the plan; for `delete_trip`, soft-delete the Trip's photos with `softDeleteByTarget('trip', tripId, now, client)` on the transaction's client, then `DELETE FROM trips`. Photos SHALL NOT be soft-deleted outside the transaction that decides the Trip is deleted.
11. *(Added at design review.)* A concurrent `acceptInvite` insert of a membership takes `FOR KEY SHARE` on the Trip row through its foreign key, which conflicts with the purge's `FOR UPDATE` on that row, so a member who joins concurrently either commits before the purge reads the roster (and keeps the Trip alive) or fails its foreign-key check after the Trip is deleted. A deadlock between the purge and a concurrent departure is possible but rare; it aborts one transaction, is logged, and is retried by the next run.

### Requirement 11: Contributed content

**User Story:** As the account owner, I want my photos gone and my words kept only without my name, so that deletion removes me without wrecking my friends' trips.

#### Acceptance Criteria

1. THE purge SHALL delete the account's photos by calling the Photo_Service `deleteAllForUser(userId)` (`softDeleteByOwner`), which sets every non-deleted photo the user owns to `deleted`; the existing Photo_Sweep SHALL then delete the storage objects and hard-delete the rows, unchanged.
2. THE purge SHALL NOT delete storage objects itself and SHALL NOT wait for the sweep; the photo stage is complete when `deleteAllForUser` has returned.
3. THE photos stage SHALL be repeatable: calling it again on an account with no remaining non-deleted photos SHALL be a no-op.
4. A Trip feed post authored by the account SHALL be retained and anonymized; its photo slots SHALL render as `removed` through the existing mechanism (`photo-uploads` R14.10), and its caption SHALL be retained (Assumption A2).
5. Comments, feed items, log entries, planned items, shares sent to others, expenses and settlements SHALL be retained with attribution anonymized, as assigned in Appendix A.
6. A `shares` row sent by the account SHALL remain readable to its recipients with the sender shown as the Deleted_User_Placeholder, SHALL carry no sender id that resolves to the original user, and SHALL NOT offer navigation to the sender's profile or comparison (a progress share deep link to the sender SHALL be disabled for a placeholder sender).
7. A report the account filed (`photo_reports`) SHALL NOT change any photo's visible or hidden state or any open-report count as a side effect of the purge.
8. EVERY retained row SHALL satisfy Requirement 6.6.
9. *(Added at design review.)* THE purge SHALL scrub the embedded names listed in Requirement 6.7 from `shares.payload_snapshot`, selecting candidate rows by `sender_id` (the user and the tombstone, so a repeat is a no-op) and `payload_kind IN ('pinShowcase','tripSummary')`, never by a JSON path.
10. *(Refines 11.7, added at design review round 2.)* `photos/reportsRepo.ts` `countOpenDistinct` counts, for a trip photo, only open reporters who are current members of the trip (`photo-uploads` R16.4, R16.9, D31). A report filed by the purged account therefore stops being counted when its membership is deleted, exactly as for any member who leaves. 11.7 SHALL be read as: the purge changes no `photos.status`, deletes no `photo_reports` row, leaves the unscoped count of open `photo_reports` rows and the admin moderation queue membership unchanged, and the member-scoped `countOpenDistinct` of a trip photo drops by exactly one when the reporter was a member. It SHALL NOT be read as keeping a departed member's report counted.

### Requirement 12: Personal data removal and completeness

**User Story:** As the account owner, I want everything that is purely mine removed, and the operator to be unable to forget a table.

#### Acceptance Criteria

1. THE purge SHALL apply, for every column in Appendix A, exactly the Disposition listed there. Appendix A is normative and complete for the schema as of migration `0063`.
2. THE project SHALL include a **disposition-completeness test** that derives the list of foreign keys to `users(id)` from the migration SQL (or the database catalog, whichever the test harness supports) and fails when any `table.column` is missing from the disposition registry in `accountDeletion/dispositions.ts` or when the registry names a column that does not exist. A migration that adds a user reference without a disposition SHALL therefore fail the suite.
3. THE `NOACTION` foreign keys `food_items.created_by_user_id` and `user_submitted_locations.created_by_user_id` SHALL be made `ON DELETE SET NULL` by the migration (or nulled by the purge before the user delete); the purge SHALL NOT fail on them.
4. FOR every Experience the account rated, THE purge SHALL call `AggregateRepo.recomputeFromScratch(experienceId)` after the ratings are deleted, bounded by the chunk size and resumable, so `aggregate_ratings` and the highest-rated leaderboard (5-minute cache `highest-rated:v1`) reflect the removal within the existing cache TTL (Assumption A4).
5. THE purge SHALL delete Redis state keyed by the user (lockout counters) on a best-effort basis; a Redis failure SHALL NOT fail the purge.
6. THE project SHALL include a **residual-reference test** (pg-mem or test DB): seed one user referenced from **every** table in Appendix A across several trips with other members, purge it, and assert (a) the user's id, email, display name, and avatar preset appear in no table, column, or JSONB value; (b) every `ANONYMIZE` row still exists with unchanged non-attribution fields; (c) every other member's rows, trips, balances and photos are unchanged.
7. Each other member's **Net_Balance** on every surviving Trip SHALL be identical before and after the purge, asserted by a test over `trip-expenses` data with the deleted account as payer, sharer, settlement party and sponsor of a guest.
8. WHERE a unique key would collide when attribution is anonymized (for example `(photo_id, reporter_id)`, `(expense_id, member_id)`, `(log_entry_id, tagged_member_id)`), THE purge SHALL NOT drop, merge, or overwrite a row; the Disposition for such columns in Appendix A, or the design's anonymization identity (Requirement 6.3), SHALL resolve the collision explicitly.
9. *(Amends the `experience_logs.user_id` row of Appendix A, added at design review; the table row is not edited.)* `trip_log_entries.log_id` is `NOT NULL ... ON DELETE CASCADE` to `experience_logs(id)` (migration 0034), so deleting an `experience_logs` row deletes the trip log entry (and its `rode_with_tags`) that other members rely on. THE purge SHALL therefore, before deleting the user's `experience_logs` rows, re-point to the tombstone (and blank the private `note` of) every `experience_logs` row referenced by a surviving `trip_log_entries` row, and only then delete the rest. THE disposition for `experience_logs.user_id` is `ANONYMIZE` for trip-referenced rows and `DELETE` for the others. THE residual-reference test SHALL seed a `trip_log_entries` row, a `rode_with_tags` row for another member, and a `completion_logged` feed item, and assert all three survive. THE design SHALL audit every `DELETE` row for cascades into an `ANONYMIZE` target.
10. *(Added at design review.)* MONEY with a non-Visible party (pending or purged) SHALL behave as follows: (a) `getNetBalances` SHALL include a row for every trip member (pending members included) and for every placeholder party that appears in the Trip's data, so the Net_Balances still sum to exactly zero; (b) an Expense or Settlement SHALL NOT be created or edited with a non-Visible party, nor edited while any of its stored parties is non-Visible: the request fails with `trip_party_deleted` (409), and the Expense or Settlement can still be deleted by its existing authorization; (c) pairwise balances against a placeholder stay visible, are labelled `Deleted user`, and offer no settle control; (d) names and ids for every party in the data are resolved through the `profile_identity` projection, not through current membership.
11. *(Extends 12.10(b), added at design review round 2.)* THE `trip_party_deleted` check SHALL also apply to the sponsor of every `guest_id` named in an Expense or Settlement: a guest whose `sponsor_member_id` is non-Visible is a non-Visible party for 12.10(b), because naming that guest changes the sponsor's balance.

### Requirement 13: Third-party sign-in providers

**User Story:** As the operator, I want account deletion to revoke provider tokens when providers exist, and an honest record that none exist today.

#### Acceptance Criteria

1. THE project SHALL document, in the design and in `docs/privacy-policy.md`, that sign-in is email and password only and that no third-party provider token exists to revoke.
2. THE Account_Deletion_Service SHALL NOT contain a stub, a fake, or a no-op "revoke Apple token" function; absence of a provider SHALL be represented by absence of code.
3. THE project SHALL include a **tripwire test** that fails if the repository gains a third-party sign-in marker: a dependency named `expo-apple-authentication`, `@invertase/react-native-apple-authentication`, `expo-auth-session`, `@react-native-google-signin/google-signin`, or `expo-google-app-auth` in `apps/mobile/package.json`; or a string `appleid.apple.com` in `apps/api/src` or `apps/mobile/src`; or an `apple_sub`, `provider`, or `oauth` column on `users`. The failure message SHALL say that provider-token revocation at deletion (Apple requires it) must be implemented and this tripwire updated in the same change.
4. WHEN a future change adds Sign in with Apple, THE Account_Deletion_Service SHALL revoke the stored Apple token at purge (and at request if the Apple policy requires it), through a port injected like the other ports; IF credentials are not configured, THEN the feature SHALL fail closed on startup with a configuration error naming the missing variable, never silently skip revocation.

### Requirement 14: Configuration and startup validation

**User Story:** As the operator, I want a misconfigured deletion feature to fail at boot, not at the first user request.

#### Acceptance Criteria

1. `loadConfig` SHALL validate every variable in Configuration & Constants, apply its default, expose it under `config.accountDeletion`, and reject values out of range with a message naming the variable.
2. `loadConfig` SHALL fail when `ACCOUNT_DELETION_CRON_SECRET` is missing, blank, or equal (after trim) to any of the other four cron secrets.
3. `loadConfig` SHALL reject `ACCOUNT_DELETION_GRACE_DAYS` of `0` or a non-integer, so a typo cannot turn the grace period into an instant purge.
4. A config test SHALL cover the defaults, each rejection, and the secret-distinctness rule in both directions.
5. `apps/api/.env.example` SHALL list the new variables with their defaults and one-line meanings. `apps/api/.env`, `.env.dev` and any other real env file SHALL NOT be edited by this work; the operator must add `ACCOUNT_DELETION_CRON_SECRET` to the Render environment before deploying, and `docs/hosting.md` SHALL say so.
6. *(Refinement of 14.2, added at design review.)* `config.ts` has `superRefine` distinctness checks only for `TRIP_BOOKING_CRON_SECRET` and, when photos are enabled, `PHOTOS_CRON_SECRET`; equality is symmetric, so ONE new rule on `ACCOUNT_DELETION_CRON_SECRET` against `SAMPLING_CRON_SECRET`, `PIN_RECONCILE_CRON_SECRET`, `TRIP_BOOKING_CRON_SECRET` and (when non-blank) `PHOTOS_CRON_SECRET` satisfies 14.2 in both directions, and the existing checks and their messages SHALL NOT be edited.

### Requirement 15: Observability, privacy, and documentation

**User Story:** As the operator and as a user, I want to know what deletion does and be able to see that it ran.

#### Acceptance Criteria

1. THE Account_Deletion_Service SHALL log structured events: request accepted, restored, purge claimed, each stage completed, purge failed (with stage), purge completed. Every event SHALL identify the account only by the truncated one-way hash of Requirement 9.7 and SHALL contain no email, name, password, grant, or phrase.
2. `docs/hosting.md` SHALL gain a "Dedicated Account Deletion Cron (Purge_Cron)" section with the endpoint, secret name, timezone, crontab, single-flight behaviour, and hosting impact, and SHALL restate that the keep-alive job must never call it.
3. `docs/privacy-policy.md` sections 4 (Retention & Deletion Schedules) and 5 (Your Controls) SHALL be updated to say: how to delete (path in the app), the grace period (the configured days), that signing in cancels it, what is deleted, what is kept anonymized (comments, captions, shares sent to others, shared expense records), and that database backups held by the hosting provider age out on the provider's schedule. The backup retention period SHALL be stated only if verified; otherwise the text says it depends on the provider and is not stated.
4. THE `docs/photos-runbook.md` SHALL note that `deleteAllForUser` is now called by the purge.
5. THE deletion state of an account SHALL be included in the operator's user lookup (Requirement 18 amendment) so support can answer "is this account pending?".
6. *(Added at design review.)* THE log account hash of Requirement 9.7 SHALL be the first 12 lowercase hex characters of `HMAC-SHA256(key = SESSION_SECRET, message = 'account-deletion-log-v1:' + userId)`, using the already-required `SESSION_SECRET` (no new variable).
7. *(Supersedes the example crontab in Configuration & Constants, added at design review.)* THE Purge_Cron crontab SHALL be `35 8,20 * * *` (America/New_York), because the earlier `20 8,20 * * *` fires in the same minute as the Reminder_Cron's `0,10,20 6,7,20` slot at 20:20.
8. *(Added at design review.)* THE change SHALL also update `docs/privacy-policy.md` (Requirement 15.3), `apps/api/.env.example` (Requirement 14.5), `docs/hosting.md` (15.2) and `docs/photos-runbook.md` (15.4); the design assigns each to a task.
9. *(Added at design review round 2.)* THE change SHALL also edit `render.yaml` to declare `ACCOUNT_DELETION_CRON_SECRET` with `sync: false` and a comment like the other cron secrets (`render.yaml` lines 51-85); it is a repository edit with a task owner, not only an operator step.

### Requirement 16: Shared contracts

**User Story:** As a developer, I want the wire contract defined once in `@dwt/shared`, so the API and the mobile app cannot drift.

#### Acceptance Criteria

1. `@dwt/shared` SHALL export: `DELETE_ACCOUNT_CONFIRMATION_PHRASE`, `DELETED_USER_DISPLAY_NAME`, Zod schemas for the reauth request and response, the deletion request and response, and the optional `accountRestored` field on the login response and `ResetPasswordSuccessDTO`.
2. `@dwt/shared` SHALL add to `ERROR_CODES` and `errorCodeToHttpStatus`: `reauth_failed` (403), `reauth_required` (403), `account_deletion_confirmation_invalid` (400). No new `401` code SHALL be introduced for this flow.
3. EVERY new schema SHALL have a schema test with one valid and one invalid case, and the error-catalog test SHALL cover the new codes and statuses.
4. THE API routes and the Mobile_App SHALL import these definitions and SHALL NOT redeclare the phrase, the placeholder name, or the response shapes.
5. *(Added at design review.)* `@dwt/shared` SHALL also add the error code `trip_party_deleted` (HTTP 409, Requirement 12.10) and the `isDeletedUserId` / `DELETED_USER_ID_PREFIX` helpers the Mobile_App uses to recognise a placeholder person from its id alone.
6. *(Refines 16.1, added at design review round 2.)* NO shared login response type exists today (`auth/routes.ts` has a private `AuthSuccessBody`, `LoginScreen.tsx` a private `LoginResponse`, `RegisterScreen.tsx` a private `RegisterResponse`). `@dwt/shared` SHALL therefore add `AuthSessionResponseDTO` (`user`, `profile`, `token`, `accountRestored?: true`) with a Zod schema, used by `auth/routes.ts` (replacing `AuthSuccessBody`), `LoginScreen` and `RegisterScreen` (replacing the private interfaces); `ResetPasswordSuccessDTO` gains the same optional field; `POST /auth/register` SHALL never set it.

### Requirement 17: Testing and verification

**User Story:** As the owner, I want proof that deletion works and cannot silently lose data, not a green build that never ran the new paths.

#### Acceptance Criteria

1. Pure modules (`deletionState.ts`: allowed transitions and the restore-window predicate; `ownerSelection.ts`: `selectNewOwner`; `dispositions.ts`; `effectiveRole` in `permissions.ts`; `selectPurgeBatch` ordering) SHALL each have unit tests and `fast-check` property tests (at least 100 runs, tagged `// Feature: account-deletion, Property N: <text>`).
2. THE properties SHALL include at least: (a) `selectNewOwner` returns a member of the input set, never the purged account, prefers role then earliest `joined_at`, and is invariant under input order; (b) the state machine admits only `active → pending_deletion → (active | purging) → purged`; (c) the restore predicate is true exactly when `now < Scheduled_Purge_At` and the state is `pending_deletion`; (d) after any sequence of trip departures and purges the Last_Organizer_Rule holds for every non-empty Trip; (e) the purge is idempotent: applying any stage twice equals applying it once.
3. Routes (`reauth`, `deletion`, `purge/run`, and the login and reset changes) SHALL have `server.inject` tests covering the auth gate, the happy path, and each error code in Requirements 2, 3, 4, 8, including `HEAD` and `in_flight`.
4. The repo SHALL have pg-mem tests that run the real SQL for: the state transition and its conditional race, the claim with `SKIP LOCKED` and stale-claim re-claim, every Appendix A disposition, the trip transfer, delete and last-organizer rules, and the migration (`migration0064.test.ts`, asserting columns, constraints, and the `SET NULL` change).
5. A regression test at the layer where a defect would live SHALL exist for each of: sessions revoked at request (a repo test reading `sessions.revoked_at`), the middleware defense (a route test with a surviving unrevoked session), and `softDeleteByOwner` running before the user row is removed (a purge test asserting the photo rows are `deleted`, not orphaned).
6. THE Mobile_App SHALL have `@testing-library/react-native` tests that render the real `DeleteAccount` screen and `YouAndCrewScreen`, mock only `apiRequest` / the query layer, and drive each interaction: open the entry; advance review to password; wrong password shows the inline error and stays signed in; correct password advances; confirm disabled until `DELETE` is typed; submit calls `POST /me/account/deletion` with `{ reauthGrant, confirmation: 'DELETE' }`; success clears the session and shows the date; expired grant returns to the password step; the restored notice shows once after a login response with `accountRestored: true`; a placeholder person is not tappable. Each test SHALL assert both the call (endpoint and payload) and the on-screen result.
7. THE structural guards of Requirements 5.8, 12.2, and 13.3 SHALL run in the normal `npm run verify`.
8. THE change SHALL be complete only when one `npm run verify` over the whole change exits `0`, with the literal output tail reported together with the behavior-to-test map required by `AGENTS.md`.
9. ANY behavior in this spec with no asserting test SHALL be named as untested and its task left unchecked.
10. *(Added at design review.)* THE tests SHALL additionally include: a purge test where the roster changes between the lock and the plan; a bounded-run test that counts rows per statement for every registry row and the photo soft-delete, and a time-budget test that stops mid-account, persists the stage and releases the claim; per-surface tests for each surface of Requirement 5.10 including the `403` versus `404` comparison; a share-inbox test for each of the four payload kinds while pending; a money test for Requirement 12.10 (zero-sum, `trip_party_deleted`, deletable); and a mobile test that the login screen shows the deletion date after a successful request and that no push `DELETE` is issued.

### Requirement 18: Amendments to existing specs

**User Story:** As a maintainer, I want the specs of the features this one touches to say so, so that nobody reads an old requirement and contradicts the new behavior.

#### Acceptance Criteria

1. THE following existing requirements files SHALL be amended **additively** (new numbered requirements appended; no existing requirement or criterion deleted, renumbered, or reworded): `photo-uploads` (Requirement 28), `trips` (Requirement 23), `trip-expenses` (Requirement 15), `admin-panel` (Requirement 17), `social-sharing-loop` (Requirement 15), `notification-center` (Requirement 14), `password-reset` (Requirement 6), `disney-world-tracker` (Requirement 13).
2. EACH amendment SHALL cite this spec's requirement numbers and SHALL state the narrow behavior it adds, not restate the whole feature.
3. THE `photo-uploads` amendment SHALL state that its Requirement 25.4 and Out of Scope line about account deletion remain true for the photo-uploads feature itself and that this spec now consumes the `deleteAllForUser` extension point.
4. AFTER the edits THE Kiro spec validator SHALL be run on each touched file and SHALL report no diagnostics.

### Requirement 19: Self-service web account deletion (Google Play Data Safety link)

**User Story:** As a user who uninstalled the app, I want a public web page where I can request deletion of my account with my email and password, so that I can delete my account without reinstalling the app and the app satisfies Google Play's Data safety web-link policy.

#### Acceptance Criteria

1. THE Account_Deletion_Service SHALL expose `GET /account-deletion` as an unauthenticated route returning HTTP `200` (`text/html; charset=utf-8`, with headers `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, and `Cache-Control: no-store`) that renders a self-contained HTML page naming the app ("Disney World Tracker"), explaining the in-app path (**You & Crew** -> **Delete account**), stating the consequences of deletion (immediate sign-out across devices, hidden from friends and trip members, permanent deletion after `graceDays` days from `config.accountDeletion.graceDays`, signing in or resetting password during the grace period cancels deletion, what data is deleted, and what shared data is retained anonymized as `"Deleted user"`), linking to `/privacy`, and presenting an HTML form (`method="POST" action="/account-deletion"`) with `email`, `password`, and `confirmation` fields.
2. THE Account_Deletion_Service SHALL expose `POST /account-deletion` accepting both `application/x-www-form-urlencoded` and `application/json` bodies containing `{ email, password, confirmation }`, gated by `loginRateLimitConfig()` (5 attempts per 15 minutes keyed on lower-cased email, falling back to IP); every response from `POST /account-deletion` SHALL include `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, and `Cache-Control: no-store`, and when rate-limited (`rate_limit_exceeded`) SHALL respond with HTTP `429` (`text/html; charset=utf-8`) rendering the form with an inline rate-limit error message.
3. WHEN `confirmation` (trimmed) does not equal `DELETE_ACCOUNT_CONFIRMATION_PHRASE` (`DELETE`, case-sensitive), OR `email` (trimmed, 1..254 characters, valid email format) or `password` (1..128 characters) is missing or invalid, `POST /account-deletion` SHALL respond with HTTP `400` (`text/html; charset=utf-8`) re-rendering the form with an inline validation message, preserving the HTML-escaped `email` value and never echoing the password or touching the database or lockout service.
4. WHEN the inputs are valid in shape and phrase, THE service SHALL look up the active user by email (`WHERE LOWER(email) = LOWER($1) AND deletion_state = 'active'`). IF no active user matches (unknown email, or `pending_deletion`, `purging`, or `tombstone`), THE service SHALL perform no lockout check, no lockout failure recording, and no state change, SHALL run a dummy Argon2id verification (`verify(DUMMY_PASSWORD_HASH, password)`) to equalize response timing against active accounts, and SHALL respond with HTTP `403` (`text/html; charset=utf-8`) re-rendering the form with the neutral message `"Invalid email or password."` (indistinguishable from a wrong password on an active account).
5. WHEN an active user matches the email, THE service SHALL check `LockoutService.isLocked(userId)` before any password work; if locked, it SHALL respond with HTTP `423` (`text/html; charset=utf-8`) re-rendering the form with the lockout message. Next it SHALL verify the Argon2id password; on mismatch it SHALL call `LockoutService.recordFailure(userId)` exactly once and respond with HTTP `403` (`text/html; charset=utf-8`) re-rendering the form with `"Invalid email or password."`.
6. WHEN the password matches for an active user, THE service SHALL NOT call `LockoutService.clearOnSuccess` (consistent with Requirement 2.13) and SHALL, in a single database transaction, transition the user from `'active'` to `'pending_deletion'` (`WHERE id = $1 AND deletion_state = 'active'`), persist `deletion_requested_at = now`, `scheduled_purge_at = now + graceDays * 24h`, and `placeholder_id`, revoke all sessions of the user, expire all unused password-reset tokens of the user, and delete all `push_registrations` of the user (Requirement 3.1-3.3).
7. AFTER the transaction commits, THE service SHALL send the best-effort "deletion scheduled" email via `MailService` (logging at `warn` with `accountLogId` and no recipient on failure, Requirement 3.4-3.5) and `POST /account-deletion` SHALL respond with HTTP `200` (`text/html; charset=utf-8`) rendering a confirmation page that states the formatted `scheduledPurgeAt` date (in `America/New_York`), the `graceDays` window, and that signing in or resetting the password before that date cancels the deletion and restores the account.
8. THE web routes SHALL never log a password, confirmation phrase, user id, or email address, and SHALL never echo a password, confirmation phrase, or user id in any response; when re-rendering the form on an error, the submitted `email` and error message SHALL be HTML-escaped (`&`, `<`, `>`, `"`, `'`).

### Requirement 20: Public privacy policy web page (`GET /privacy`)

**User Story:** As a user or app store reviewer, I want a public web URL that serves the app's Privacy Policy, so that I can read the privacy policy and data deletion disclosures in a browser without installing the app.

#### Acceptance Criteria

1. THE Account_Deletion_Service routes SHALL expose `GET /privacy` as an unauthenticated route returning HTTP `200` (`text/html; charset=utf-8`, with headers `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`) that renders the privacy policy content of `docs/privacy-policy.md` as a self-contained, mobile-responsive HTML document.
2. THE rendered `/privacy` page and `docs/privacy-policy.md` Section 5 SHALL state both the in-app deletion path (**You & Crew** -> **Delete account**) and the web deletion path (`/account-deletion`), and the `/privacy` HTML page SHALL include a clickable link (`href="/account-deletion"`) to the web deletion form.
3. *(Amendment note)* Requirements 19 and 20 supersede Assumption A8 and the Out of Scope bullet regarding Google Play's web-based account deletion URL; the original lines in Assumptions and Out of Scope are retained as historical record per the additive-spec rule.
4. *(Added after review: the support contact is configuration, never a placeholder.)* THE `GET /privacy` page SHALL render the deployment's configured `SUPPORT_EMAIL` as the support contact, as a `mailto:` link whose href and visible text are both HTML-escaped (`&`, `<`, `>`, `"`, `'`), AND the placeholder text `[Support Contact Email]` and any "owner must replace" note SHALL NOT appear in the served output. `SUPPORT_EMAIL` SHALL be a required `loadConfig` variable (trimmed, a syntactically valid email, no default) exposed as `config.support.email`, so a deployment without a valid address fails fast at boot instead of publishing a privacy page with no real contact. `docs/privacy-policy.md` SHALL name `SUPPORT_EMAIL` as the source of the address and SHALL NOT contain an address or the placeholder.
5. THE Mobile_App `YouAndCrewScreen` SHALL include a "Privacy Policy" entry control in the settings section (`testID="privacy-policy-entry-button"`, `accessibilityRole="link"`, `accessibilityLabel="Privacy Policy"`) that opens the hosted privacy policy URL (`PRIVACY_POLICY_URL` when non-empty, or `${resolveBaseUrl()}/privacy` as fallback) via `Linking.openURL`, and `apps/mobile/eas.json` and `apps/mobile/.env.example` SHALL configure `EXPO_PUBLIC_PRIVACY_POLICY_URL` pointing to `https://dwt-api.onrender.com/privacy`.

## Out of Scope

- **Admin-initiated deletion or suspension** of another user's account. Future work; it would reuse the Pending_Deletion state and purge but needs its own authorization and audit design.
- **Google Play's web-based account deletion URL and data-deletion form.** Play requires a public web link; this spec is the in-app path only. Follow-up work (the `password-reset` web fallback is a pattern to reuse).
- **Data export** ("download my data").
- **Deleting operational logs and provider backups.** Logs carry no PII by Requirement 15.1. Neon point-in-time history and any provider backups age out on the provider's schedule.
- **Changing what other members' retained content says** beyond attribution (Assumption A2).
- **A "deactivate without deleting" feature.**
- **Social login.** Not built here; Requirement 13 only guards the future.
- **Re-using the email of a pending account for a fresh registration** during the grace period (Assumption A6).
- **Fixing the existing `ChangePasswordControl` behaviour** noted in the Introduction: its wrong-current-password response is a `401` and `apiRequest` signs the user out. This spec avoids the same trap with a `403`; the existing control is a separate defect.

## Appendix A: Disposition of every reference to `users(id)`

Normative and complete for the schema as of migration `0063` (69 columns, derived from `apps/api/migrations/*.sql`). The disposition-completeness test (Requirement 12.2) keeps it complete.

Legend: **DELETE** = row deleted at purge. **ANONYMIZE** = row kept, attribution replaced by the Deleted_User_Placeholder. **NULLIFY** = column set to `NULL` (column is nullable). **TRIP** = governed by Requirement 10. **SESSION** = revoked at request, deleted at purge. In the "Today" column, `NN` is not null, `N` is nullable, and `cascade`, `setnull`, `noaction` are the current `ON DELETE` behavior.

| Table.column | Today | Disposition | Notes |
|---|---|---|---|
| `profiles.user_id` | NN cascade | DELETE | name, avatar |
| `sessions.user_id` | NN cascade | SESSION | revoked at request (R3.2) |
| `password_reset_tokens.user_id` | NN cascade | DELETE | expired at request |
| `completions.user_id` | NN cascade | DELETE | |
| `ratings.user_id` | NN cascade | DELETE | then recompute aggregates (R12.4) |
| `notes.user_id` | NN cascade | DELETE | |
| `experience_logs.user_id` | NN cascade | DELETE | |
| `food_item_logs.user_id` | NN cascade | DELETE | their photos handled first (R9.2) |
| `experience_favorites.user_id` | NN cascade | DELETE | |
| `user_pins.user_id` | NN cascade | DELETE | Pins and Vault |
| `pin_showcase_placements.user_id` | NN cascade | DELETE | |
| `push_registrations.user_id` | NN cascade | DELETE | disabled at request (R3.3) |
| `notification_preferences.user_id` | NN cascade | DELETE | |
| `push_delivery_log.user_id` | NN cascade | DELETE | |
| `friend_requests.sender_id`, `.recipient_id` | NN cascade | DELETE | both directions |
| `friendships.user_lo_id`, `.user_hi_id` | NN cascade | DELETE | both columns |
| `user_blocks.blocker_id`, `.blocked_id` | NN cascade | DELETE | both directions |
| `photos.owner_id` | N setnull | DELETE (soft) | `deleteAllForUser` before the user row (R9.2, R11.1) |
| `photo_upload_bans.user_id`, `photo_upload_strikes.user_id`, `photo_upload_counters.user_id` | NN cascade | DELETE | known limit: deleting and re-registering escapes a ban, as registering a new email already does |
| `photo_reports.reporter_id` | NN cascade | ANONYMIZE | must not change any photo's state or report counts (R11.7); unique `(photo_id, reporter_id)` collision rule applies |
| `shares.sender_id` | NN cascade | ANONYMIZE | recipients keep the share (R11.6) |
| `share_recipients.recipient_id` | NN cascade | DELETE | the user's own inbox rows |
| `share_reactions.recipient_id` | NN cascade | DELETE | the user's reactions to others' shares |
| `food_lists.owner_id`, `experience_lists.owner_id` | NN cascade | DELETE | cascades items, shares, likes, saves, trip attachments (A3) |
| `food_list_shares.shared_by_user_id`, `.shared_with_user_id`, `experience_list_shares.*` | NN cascade | DELETE | |
| `food_list_likes.user_id`, `experience_list_likes.user_id` | NN cascade | DELETE | |
| `food_list_saves.saved_by_user_id`, `experience_list_saves.saved_by_user_id` | NN cascade | DELETE | |
| `food_lists_items.added_by_user_id`, `experience_lists_items.added_by_user_id` | N setnull | NULLIFY | entries in others' lists stay |
| `food_items.created_by_user_id` | N noaction | NULLIFY | **blocks the delete today**; migration changes it (R12.3) |
| `user_submitted_locations.created_by_user_id` | N noaction | NULLIFY | **blocks the delete today**; migration changes it (R12.3) |
| `trips.creator_id` | NN cascade | TRIP | transfer or delete trip (R10) |
| `trip_memberships.user_id` | NN cascade | DELETE | after trip resolution (R10.6) |
| `trip_invites.inviter_id`, `.invitee_id` | NN cascade | DELETE | |
| `rode_with_tags.tagged_member_id` | NN cascade | DELETE | pending cancelled first (R10.6) |
| `planned_items.added_by` | NN cascade | ANONYMIZE | |
| `trip_log_entries.member_id` | NN cascade | ANONYMIZE | trip history others see (`trips` R8.5) |
| `trip_feed_items.actor_id` | NN cascade | ANONYMIZE | includes `member_post`; photo slots become `removed` (R11.4) |
| `trip_comments.author_id` | NN cascade | ANONYMIZE | body kept (A2) |
| `trip_reactions.member_id` | NN cascade | DELETE | would collide on its PK under one placeholder |
| `trip_food_lists.added_by`, `trip_experience_lists.added_by` | NN cascade | ANONYMIZE | attachment of someone else's list stays |
| `trip_guests.sponsor_member_id` | NN cascade | ANONYMIZE | guest and its shares stay; balances preserved (R12.7) |
| `expenses.payer_id`, `expenses.created_by` | NN cascade | ANONYMIZE | balances preserved (R12.7) |
| `expense_shares.member_id`, `expense_tier_counts.member_id`, `expense_item_assignees.member_id` | N cascade | ANONYMIZE | collision rule (R12.8) |
| `expense_refunds.created_by` | NN cascade | ANONYMIZE | |
| `settlements.payer_id`, `.recipient_id`, `.created_by` | NN cascade | ANONYMIZE | |
| `trip_booking_window_done.marked_by` | NN cascade | ANONYMIZE | |
| `trip_booking_reminder_mutes.user_id` | NN cascade | DELETE | personal setting |
| `trip_packing_items.added_by` | NN cascade | ANONYMIZE | |
| `trip_packing_items.assignee_id`, `.packed_by` | N setnull | NULLIFY | |

*(Added at design review round 4; no row above is edited.)* Superseded for `experience_logs.user_id` by Requirement 12.9 (`anonymize_then_delete`, not DELETE), and for `food_items.created_by_user_id` and `user_submitted_locations.created_by_user_id` by the "nulled by the purge" branch of Requirement 12.3 (the migration changes no existing foreign key). The design's "Data inventory" table is authoritative where it differs from a row here.

**Design constraints that follow from this table** (the design must decide and justify, not leave open):

- Most `ANONYMIZE` columns are `NOT NULL` with a foreign key, so "anonymize" needs a target. The design chooses between one shared placeholder identity, a fresh pseudonymous identity per deleted account (no email, no credentials, random id, mapping destroyed), or making the columns nullable. It must meet Requirement 6 and Requirement 12.8, and the choice must keep every Net_Balance intact.
- A placeholder identity must never be able to sign in, appear in search or rosters, be counted in admin growth numbers, or be a candidate in Requirement 10.3.
- JSONB values that embed a user id or name (for example `trip_feed_items.metadata`, `shares.payload_snapshot`) must be inspected and scrubbed; the residual-reference test (R12.6) is the check.

## Appendix B: Cross-user read surfaces and their mode

Derived by searching `apps/api/src/services` for joins on `profiles` and `users`. The design confirms each by reading the code and the Requirement 5.8 guard keeps it current. **OMIT** = person absent. **PLACEHOLDER** = content kept, person shown as "Deleted user".

| Surface (source) | Mode | Behavior while pending |
|---|---|---|
| Friend search, by name or email (`friends/repo.ts` `searchUsers`) | OMIT | not found, and email is never exposed |
| Friends list, incoming and outgoing requests (`listFriendsAndRequests`) | OMIT | |
| Send, accept, decline friend request involving the user | OMIT | existing `friend_recipient_unknown` or `friendship_not_found` |
| `GET /users/:id/profile` (`auth/profileRoutes.ts`) | OMIT | `profile_forbidden` |
| Friend stats, comparison, friend food ratings (`stats/routes.ts`, `friendFoodRatings/repo.ts`) | OMIT | `stats_target_not_found` or absent |
| Share recipient picker and `POST /me/shares` recipients (`sharing`) | OMIT | existing recipient-invalid error |
| Share inbox sender and Sent list (`sharing/repo.ts`) | PLACEHOLDER | share stays readable; no profile navigation |
| Trip roster, member counts, assignee and tag pickers (`trips/repo.ts` `listMembers` and siblings) | OMIT | |
| Pending trip invites, both directions (`listPendingInvites`, invite targets) | OMIT | |
| Trip feed, log entries, rode-with confirmations, comments, planned-item adder (`trips/repo.ts`) | PLACEHOLDER | |
| Trip summary and recap attribution (`sharing/tripRecap*.ts`) | PLACEHOLDER | |
| Expenses, settlements, balances, guests (`tripExpenses/repo.ts`) | PLACEHOLDER | still counted in money; only the name changes |
| Booking window done, packing assignee and adder (`tripBooking/repo.ts`) | PLACEHOLDER | |
| Food and experience list collaborators and owner names (`foodLists/repo.ts`, `experienceLists/repo.ts`) | OMIT | shared-with and shared-by entries hidden; owner's lists not served |
| Photo galleries, Album, recap photos, feed post slots (`photos/*`) | OMIT | the user's photos are not served; reader byline never shows a pending user |
| Blocked-users list (`photos/reportsRepo.ts`) | OMIT | |
| Push delivery (`notifications/service.ts`, `push/repo.ts`) | OMIT | no pushes to a pending account |
| Notification_Center attention items (`notification-center`) | OMIT | items whose counterparty is non-Visible |
| Highest-rated leaderboard (`aggregate/leaderboard.ts`) | n/a | aggregate is anonymous; unchanged until purge (A4) |
| Admin user lookup and counts (`admin/repo.ts`) | n/a | admin sees the account with status (admin-panel amendment) |
| Self reads (`GET /me`, auth) | n/a | no session exists |

*(Added at design review round 4; no row above is edited.)* The row "Notification_Center attention items" is implemented per read path, because the share inbox is PLACEHOLDER and would otherwise leak a pending sender's unread share into the feed. Requirement 5.14 states the rule (counterparty must be `active`).

| Surface (source) | Mode | Behavior while pending |
|---|---|---|
| Unread-share badge count (`GET /me/inbox/unread-count`, `sharing/repo.ts` `countUnreadInbox`) | OMIT (count only; the inbox list stays PLACEHOLDER) | a Share from a non-active sender is not counted |
| Pending rode-with tags (`GET /me/rode-with-tags?state=pending`, `trips/repo.ts` `listPendingRodeWithTags`) | OMIT | a tag whose tagging member is not Visible is not returned |
| Unread-share attention items (`apps/mobile/src/features/notifications/useAttention.ts` `selectUnreadShares`) | OMIT (client filter) | a Share whose sender id is a placeholder id (`isDeletedUserId`) is not listed |
