# Requirements Document

## Introduction

Today a user who hits a bug or has an idea has no way to tell the operator from inside the app. This feature adds a text-only "Report a problem / Send feedback" flow for signed-in users and a review page for the operator in the existing Admin_Panel.

Scope decisions (agreed with the operator before drafting):

1. **Text only.** No screenshots or attachments. Photos would add storage and moderation work, as decided for Hidden Mickeys.
2. **Admin_Panel only.** The operator reads submissions in `/admin/feedback`. No email is sent per submission, so the feature does not depend on mail delivery from a free-tier host that cold-starts.
3. **Signed-in users only.** No unauthenticated route, so there is no new anonymous abuse surface.
4. **One-way.** The operator cannot reply from the app. The user may tick "You may contact me at my account email"; the email is copied to the submission only when they do.
5. **Deleted with the account.** A user's feedback is removed when their account is purged (`account-deletion` spec).

Out of scope: crash reporting, notifying a user when a report is resolved, screenshots, replies, and sending feedback while signed out.

## Glossary

- **App**: The React Native mobile client (`apps/mobile`).
- **Feedback_Service**: The backend service in `apps/api/src/services/feedback/`.
- **Admin_Panel**: The Basic-Auth operator pages under `/admin/*` (`admin-panel` spec).
- **Submission**: One row in `user_feedback`.
- **Kind**: One of `bug`, `idea`, `other`.
- **Status**: One of `new`, `triaged`, `resolved`. The stored value `triaged` is shown to the operator as "Reviewed" (read, still open); `new` is "New" and `resolved` is "Resolved".
- **Device_Info**: App version, platform (`ios`, `android`, `web`) and OS version, sent only when the user leaves the "Include device info" switch on.
- **Contact_Consent**: The boolean `contact_ok`, true only when the user ticked the contact checkbox.

---

## Requirements

### Requirement 1: Entry point and form

**User Story:** As a signed-in user, I want a clear place in the app to report a problem or send an idea, so that I can reach the operator without leaving the app.

#### Acceptance Criteria

1. THE App SHALL show a "Report a problem or send feedback" row (`testID` `feedback-entry-button`) on the You & Crew screen, above the Delete account entry, that navigates to a `Feedback` screen registered in `YouAndCrewStack`.
2. THE Feedback screen SHALL provide a Kind picker with three options labelled "Bug", "Idea" and "Other" (default "Bug"), a multiline message field, an "Include device info" switch (default on) with a line stating exactly which three values are sent, a "You may contact me at my account email" checkbox (default off), and a Send button.
3. THE message field SHALL show a live character counter against the 2000-character limit and SHALL refuse input beyond it.
4. THE Send button SHALL be disabled while the trimmed message is empty and while a submission is in flight.
5. THE message field label or placeholder SHALL ask the user to say which screen they were on and what they expected to happen.
6. WHEN a submission succeeds, THE App SHALL replace the form with a confirmation state ("Thanks, we got it") and a Done button that returns to You & Crew, and SHALL clear the message.
7. EVERY control of the screen SHALL carry an `accessibilityLabel`, and THE selected Kind SHALL be conveyed by `accessibilityState` and not by color alone.
8. *(Amendment — Dedicated Settings Screen Relocation):* The "Report a problem or send feedback" row (`feedback-entry-button`) now lives in the Help & Legal section of `SettingsScreen` (`YouAndCrewStack` › `Settings`, above `delete-account-entry-button`), and Done returns to `Settings`.

### Requirement 2: Submit endpoint

**User Story:** As the operator, I want submissions stored reliably and validated, so that the review page only ever holds well-formed data.

#### Acceptance Criteria

1. THE Feedback_Service SHALL expose `POST /me/feedback` behind the existing session middleware, accepting `{ kind, message, contactOk, device? }` and returning `201 { id }`.
2. THE endpoint SHALL trim the message and reject, with HTTP 400 `validation_failed`, a missing or unknown `kind`, an empty (after trim) or over-2000-character `message`, and a `device` object with an unknown `platform` or an `appVersion` or `osVersion` longer than 32 characters.
3. WHEN `device` is absent, THE endpoint SHALL store `app_version`, `platform` and `os_version` as `NULL`, and SHALL NOT derive them from the request headers, the User-Agent or the IP address.
4. WHEN `contactOk` is true, THE endpoint SHALL copy the caller's current account email into `contact_email` in the same statement as the insert, and WHEN `contactOk` is false or absent THE endpoint SHALL store `contact_email` as `NULL`.
5. THE endpoint SHALL insert the row with status `new` and SHALL derive `user_id` only from the session, never from the body.
6. IF the caller's account is not `active` (for example `pending_deletion`), THEN THE endpoint SHALL store nothing and return HTTP 401, as every other session-gated route does.
7. THE endpoint SHALL NOT log the message text, the contact email or the device values.

### Requirement 3: Per-user limits

**User Story:** As the operator, I want one account unable to flood the table, so that storage on the free tier stays bounded.

#### Acceptance Criteria

1. THE Feedback_Service SHALL count the caller's Submissions created in the trailing 1 hour and the trailing 24 hours, and IF either count has reached its cap (`FEEDBACK_PER_HOUR`, default 5; `FEEDBACK_PER_DAY`, default 20) THEN THE endpoint SHALL store nothing and return HTTP 429 with error code `rate_limit_exceeded` and a message telling the user to try again later.
2. THE cap check SHALL use the database count (as the Hidden Mickeys daily cap does), so the limit survives a restart of the host process.
3. THE boundary SHALL be exact: a caller with `cap - 1` Submissions in the window is accepted, and a caller with `cap` is refused.
4. THE App SHALL show the 429 message on the form, keep the typed text, and leave the Send button usable.

### Requirement 4: Failure handling and duplicate prevention

**User Story:** As a user, I want my typed report to survive a failed send, so that I do not have to retype it.

#### Acceptance Criteria

1. WHEN a submission fails (network error, timeout, 429, 5xx), THE App SHALL keep the Kind, message, device switch and contact checkbox exactly as entered, SHALL show an error message in the form, and SHALL leave Send enabled for a retry.
2. WHILE a submission is in flight, THE App SHALL ignore further presses of Send, so a double tap creates one request.
3. THE Feedback screen SHALL keep its draft in component state only; the message SHALL NOT be written to device storage.

### Requirement 5: Admin review page

**User Story:** As the operator, I want to read, triage and close submissions in the Admin_Panel, so that I can act on what users send.

#### Acceptance Criteria

1. THE Feedback routes SHALL be registered by `adminRoutes` only when it receives the optional `feedback` port (`AdminFeedbackPort`, mirroring `ticketPrices?`, `diningPlan?` and `photos?`); WHEN the port is supplied, THE Admin_Panel dashboard section list (`ADMIN_SECTIONS`, as for Dining Plan) SHALL list "User Feedback" (`/admin/feedback`) under "User Operations & Security", and WHEN it is absent the routes are not registered, the section is not listed, and every existing admin test is unaffected.
2. THE `GET /admin/feedback` page SHALL list Submissions newest first, 50 per page, filterable by Status (default `new`) and Kind, showing the creation time (viewer-local, `admin-panel` Requirement 16), Kind, Status, the first 120 characters of the message, and the user id.
3. THE `GET /admin/feedback/:id` page SHALL show the full message, Kind, Status, the creation and last status-change times, the Device_Info when present, the user id, and the contact email only when `contact_ok` is true and `contact_email` is not `NULL`.
4. THE detail page SHALL provide actions that set Status to `triaged` or `resolved` or back to `new`, and a Delete action, each a `POST` that enforces the same-origin check (`isSameOriginRequest`) and responds `403` with no state change on a cross-origin request.
5. THE Admin_Panel SHALL render every stored value HTML-escaped (`escapeHtml`), so a message containing markup or a script tag is shown as text.
6. EVERY Feedback response SHALL carry `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`.
7. THE Feedback forms SHALL be parsed in a child scope of the admin plugin that accepts `application/x-www-form-urlencoded` bodies, so no other admin route's body parsing changes.
8. THE page SHALL be reachable only through the existing Basic Auth.

### Requirement 6: Retention

**User Story:** As the operator, I want resolved items cleaned up automatically, so that the table stays small without a scheduled job.

#### Acceptance Criteria

1. WHEN a Submission is accepted, THE Feedback_Service SHALL make one best-effort bounded delete (at most 200 rows) of Submissions whose Status is `resolved` and whose `status_changed_at` is older than `FEEDBACK_RETENTION_DAYS` (default 90), and a failure of that delete SHALL NOT affect the response.
2. THE prune SHALL never delete a Submission whose Status is `new` or `triaged`.

### Requirement 7: Account deletion and privacy

**User Story:** As a user, I want my feedback removed when I delete my account, and I want to know what a report sends.

#### Acceptance Criteria

1. THE `user_feedback.user_id` column SHALL reference `users(id)` with `ON DELETE CASCADE`, and THE account-deletion disposition registry SHALL list `user_feedback.user_id` as `delete` at stage 4 with `chunkColumns: ['id']`, so the existing registry-completeness test passes and the purge removes the user's Submissions.
2. THE migration SHALL NOT break the account-deletion visibility guard: the only statement that reads the `users` table for this feature SHALL carry `deletion_state = 'active'` in the same SQL literal.
3. THE Feedback screen SHALL state, beside the device switch and the contact checkbox, what is sent and who can read it, and THE public privacy policy page rendered by `accountDeletion/webPages.ts` and its source document `docs/privacy-policy.md` (kept in sync by a test) SHALL describe feedback submissions: what is stored (message, kind, optional device info, optional account email), that the operator reads them, that no IP address is stored, the retention rule, and that they are deleted with the account.
4. THE Feedback_Service SHALL store no IP address and no User-Agent.

### Requirement 8: Theming and structure

**User Story:** As a maintainer, I want the feature to follow the repo's conventions, so that the existing guard tests keep passing.

#### Acceptance Criteria

1. THE Feedback screen SHALL build styles with `makeStyles` and read colors from the active theme (a one-off literal color goes in a co-located `FeedbackScreen.palette.ts`), so `themeRetrofit.guard.test.ts` passes without an allowlist change.
2. THE shared wire contract (`FEEDBACK_KINDS`, `FEEDBACK_STATUSES`, `FEEDBACK_MESSAGE_MAX`, the submit input schema and response type) SHALL live in `packages/shared` and be imported by both apps.
3. THE Feedback_Service SHALL be constructed in `composeServices.ts` by constructor injection, with a pure `policy.ts` holding the cap and retention rules.
