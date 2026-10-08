# Requirements Document

## Introduction

Currently, user authentication in the Disney World Tracker only allows password changes via `POST /auth/change-password`, which requires an active, authenticated session and knowledge of the existing password. When a user forgets their password, they cannot establish a session and are permanently locked out of their account, their trip itineraries, experience favorites, food lists, and pin collections.

This feature introduces a complete, secure password recovery mechanism designed specifically for the mobile-first nature of this application:
1. **In-App 6-Digit Code (Primary Mobile Flow)**: The user requests a password reset from the login screen, receives an email with a 6-digit numeric verification code, enters the code and their new password inside the app, and is immediately logged in upon verification.
2. **Web Fallback Link (Browser Flow)**: The reset email also contains a direct web link to a lightweight, responsive server-rendered reset form hosted by the API, accommodating users who open their email on a computer or outside the mobile app.
3. **Robust Security Controls**: Anti-enumeration defense (constant-time responses and identical 200 OK messages whether an email exists or not), 15-minute token TTL, 5-attempt brute-force protection, Argon2id hashing, and complete revocation of prior sessions upon reset.
4. **Resilient Mailer Adapter**: Pluggable transactional email client (supporting Resend in production and a mock/console transport for local development and CI testing).

## Glossary

- **App**: The React Native mobile client (`apps/mobile`) for Disney World Tracker.
- **Auth_Service**: The Fastify-based authentication backend service (`apps/api/src/services/auth/`).
- **Mail_Service**: The transactional email service responsible for dispatching system notifications and reset emails.
- **Verification Code**: A 6-digit numeric code (e.g. `482195`) valid for 15 minutes, entered in the mobile app to verify identity.
- **Reset Token**: A high-entropy, cryptographically secure opaque token embedded in the web fallback reset link.
- **Token Hash**: The SHA-256 digest of a Verification Code or Reset Token, stored in the database to prevent exposure if the database is inspected.
- **User**: An account registered with a unique email address in the `users` table.

---

## Requirements

### Requirement 1: Password Reset Request (Forgot Password)

**User Story:** As a User who forgot my password, I want to request a password reset by providing my email address, so that I can regain access to my account.

#### Acceptance Criteria

1. WHEN a client submits a password reset request with an email conforming to RFC 5322 syntax, THE Auth_Service SHALL generate a 6-digit numeric verification code and a cryptographically secure URL reset token, both expiring in 15 minutes.
2. WHEN a password reset request is submitted for an existing User account, THE Auth_Service SHALL store the SHA-256 hash of the verification code and the SHA-256 hash of the reset token in the database, and SHALL dispatch a password reset email to that address within 2 seconds.
3. IF a password reset request is submitted for an email that does not correspond to any existing User account, THEN THE Auth_Service SHALL return a 200 OK success response identical in structure to an existing user request within 2 seconds, and SHALL NOT store any token or dispatch an email (Anti-Enumeration Defense).
4. IF a password reset submission contains invalid email syntax, THEN THE Auth_Service SHALL reject the request with HTTP 400 and a validation error response indicating the email field.
5. IF a client submits more than 5 password reset requests for the same email or IP address within a 15-minute window, THEN THE Auth_Service SHALL reject subsequent requests with HTTP 429 and a rate-limit error response.
6. THE Auth_Service SHALL NOT log, persist, or expose the plaintext verification code or reset token in application logs or database records at any time.

---

### Requirement 2: In-App Password Reset via Verification Code (Mobile Flow)

**User Story:** As a mobile app user, I want to enter the 6-digit code from my email into the app along with my new password, so that I can reset my password and immediately continue using the app without being redirected to a browser.

#### Acceptance Criteria

1. WHEN a client submits a valid email, a 6-digit verification code matching the stored code hash, and a new password between 8 and 128 characters, THE Auth_Service SHALL replace the User's stored password hash with a new Argon2id hash.
2. WHEN a password reset succeeds via verification code, THE Auth_Service SHALL mark the reset record as used, revoke all of that User's existing active sessions in the database, establish a fresh authenticated session, and return the session token, user info, and profile within 2 seconds.
3. IF a submitted 6-digit code does not match the active stored code hash or has expired (older than 15 minutes), THEN THE Auth_Service SHALL reject the request with HTTP 400 and an invalid-code error response, and SHALL increment the failed attempt count.
4. IF a password reset request accumulates 5 failed verification attempts, THEN THE Auth_Service SHALL immediately invalidate the reset record and reject subsequent attempts with an invalid-code error response.
5. IF a submitted new password is shorter than 8 characters or longer than 128 characters, THEN THE Auth_Service SHALL reject the request with HTTP 400 and a validation error response indicating the password field, and SHALL leave the stored password unchanged.
6. IF a password reset submission references an email or code that has already been marked as used, THEN THE Auth_Service SHALL reject the request with HTTP 400 and an invalid-code error response.

---

### Requirement 3: Web Fallback Password Reset Form (Browser Flow)

**User Story:** As a user reading my reset email on a desktop computer or in a web browser, I want to click a reset link and enter my new password on a secure web page, so that I can reset my password without having my phone handy.

#### Acceptance Criteria

1. WHEN a client issues a GET request to `/auth/reset-password` with a valid, non-expired, and unused reset token, THE Auth_Service SHALL render a responsive HTML/CSS password reset form styled with application theme colors within 1 second.
2. IF a GET request to `/auth/reset-password` provides a missing, invalid, expired, or already-used token, THEN THE Auth_Service SHALL render an error message page stating the link has expired or is invalid.
3. WHEN a client submits a new password between 8 and 128 characters via the web reset form with a valid, non-expired, unused token, THE Auth_Service SHALL update the User's password hash using Argon2id, mark the reset record as used, revoke all active sessions for that User, and render a success page instructing the user to sign in on their mobile device.
4. IF a web reset form submission provides a password shorter than 8 or longer than 128 characters, THEN THE Auth_Service SHALL re-render the form displaying a validation error message.

---

### Requirement 4: Transactional Email Delivery

**User Story:** As a system administrator, I want password reset emails to be delivered reliably in production while operating gracefully in dev and test environments without third-party email account dependencies.

#### Acceptance Criteria

1. THE Mail_Service SHALL format transactional password reset emails displaying both the prominent 6-digit numeric verification code and the clickable web fallback link.
2. WHERE the `RESEND_API_KEY` environment variable is defined, THE Mail_Service SHALL dispatch outgoing emails via the Resend REST API using the configured sender address.
3. WHERE SMTP configuration (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` or `SMTP_SERVICE`) is defined and `RESEND_API_KEY` is not defined, THE Mail_Service SHALL dispatch outgoing emails via SMTP (such as Gmail or custom SMTP relays) using the configured credentials.
4. WHERE neither `RESEND_API_KEY` nor SMTP configuration is defined, THE Mail_Service SHALL operate in mock mode, logging the reset code and fallback link to the console logger and resolving successfully.

---

### Requirement 5: Mobile User Interface and Experience

**User Story:** As a mobile app user, I want a frictionless password reset experience integrated directly into the login flow.

#### Acceptance Criteria

1. THE LoginScreen SHALL display a "Forgot password?" button below the password input field.
2. WHEN a user taps "Forgot password?" on LoginScreen, THE App SHALL navigate to `ForgotPasswordScreen`, passing any email address already entered on LoginScreen.
3. THE ForgotPasswordScreen SHALL provide an email text input and a primary "Send Code" button.
4. WHEN the user submits their email on ForgotPasswordScreen and the request succeeds, THE App SHALL navigate to `ResetPasswordScreen` displaying the destination email address, a 6-digit numeric code input, a new password input with visibility toggle, and a confirm password input.
5. THE ResetPasswordScreen SHALL provide a "Resend code" button that is disabled for 60 seconds after submission with a visible countdown timer.
6. WHEN the user successfully resets their password on ResetPasswordScreen, THE App SHALL store the returned session token in `sessionStore` and immediately navigate to the main application tabs.
