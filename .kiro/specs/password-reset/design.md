# Design Document

## Overview

The Password Reset feature provides a secure, multi-channel password recovery flow for Disney World Tracker. It is designed around the mobile-first use case with a 6-digit numeric verification code entered directly in the mobile app, alongside an email-linked web fallback form rendered by the Fastify API.

Key pillars of this design:
1. **Zero Plaintext Storage**: Both the 6-digit verification code and the web reset token are hashed via SHA-256 before storage in PostgreSQL (`password_reset_tokens`).
2. **Anti-Enumeration Guardrails**: The `POST /auth/forgot-password` endpoint always returns HTTP 200 with an identical message and timing profile, whether the email is registered or not.
3. **Defense-in-Depth Rate Limiting & Lockout**: 15-minute token expiration, a strict 5-attempt limit per verification code before automatic invalidation, and IP/email rate limiting on reset initiation.
4. **Immediate Mobile Session Issuance**: Upon successful in-app code verification and password reset, the backend automatically issues a fresh session token so the user is directly authenticated into the app without an extra login step.
5. **Session Invalidation**: All existing sessions for the user are immediately revoked upon password reset to safeguard against account takeover.

---

## Architecture

```
[Mobile App / LoginScreen]
       │
       ▼ (Taps "Forgot Password?")
[ForgotPasswordScreen] ──(POST /auth/forgot-password)──▶ [Fastify Auth_Service]
                                                                  │
                                                ┌─────────────────┴─────────────────┐
                                                ▼                                   ▼
                                     [Create Reset Row in DB]             [Mail_Service Dispatch]
                                     - SHA256(code)                       - Resend API (or Mock)
                                     - SHA256(token)                      - Sends 6-digit code +
                                     - expires_at = now() + 15m             web reset URL
                                                │
               ┌────────────────────────────────┴───────────────────────────────┐
               ▼ (Mobile Flow - Primary)                                        ▼ (Web Flow - Fallback)
[User enters Code + New Password]                               [User clicks email link]
               │                                                                │
               ▼ (POST /auth/reset-password)                                    ▼ (GET /auth/reset-password?token=...)
      [Verify Code Hash]                                               [Render Server HTML Form]
      [Hash New Password (Argon2id)]                                            │
      [Revoke All Prior Sessions]                                               ▼ (POST /auth/reset-password-web)
      [Issue New Session Token]                                        [Update Password & Revoke Sessions]
               │                                                                │
               ▼                                                                ▼
[Navigates to MainTabs]                                        [Display Success Page -> "Open App"]
```

---

## Components and Interfaces

### 1. Database Table (`password_reset_tokens`)

Defined in migration `apps/api/migrations/0059_password_reset_tokens.sql`:

```sql
CREATE TABLE password_reset_tokens (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash           TEXT         NOT NULL,
    token_hash          TEXT         NOT NULL UNIQUE,
    attempts            INTEGER      NOT NULL DEFAULT 0,
    expires_at          TIMESTAMPTZ  NOT NULL,
    used_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens(user_id);
CREATE INDEX password_reset_tokens_code_hash_idx ON password_reset_tokens(code_hash);
CREATE INDEX password_reset_tokens_token_hash_idx ON password_reset_tokens(token_hash);
```

### 2. Backend Mail Service (`apps/api/src/services/auth/mailService.ts`)

```typescript
export interface SendPasswordResetInput {
  readonly to: string;
  readonly code: string;
  readonly resetUrl: string;
}

export interface MailService {
  sendPasswordReset(input: SendPasswordResetInput): Promise<void>;
}

export function createMailService(config: {
  apiKey?: string;
  from?: string;
  logger: FastifyBaseLogger;
}): MailService;
```

### 3. Password Reset Repository (`apps/api/src/services/auth/passwordResetRepo.ts`)

```typescript
export interface CreateResetTokenParams {
  readonly userId: string;
  readonly codeHash: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface PasswordResetRow {
  readonly id: string;
  readonly userId: string;
  readonly codeHash: string;
  readonly tokenHash: string;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly createdAt: Date;
}

export interface PasswordResetRepo {
  createToken(params: CreateResetTokenParams): Promise<void>;
  findActiveByEmailAndCode(email: string, codeHash: string): Promise<PasswordResetRow | null>;
  findActiveByToken(tokenHash: string): Promise<PasswordResetRow | null>;
  incrementAttempts(id: string): Promise<number>;
  markUsed(id: string): Promise<void>;
  invalidateForUser(userId: string): Promise<void>;
}
```

### 4. HTTP Endpoints in `apps/api/src/services/auth/routes.ts`

- `POST /auth/forgot-password`:
  - Body: `{ email: string }`
  - Response: `200 OK` `{ message: "If an account exists, a reset code has been sent." }`
- `POST /auth/reset-password`:
  - Body: `{ email: string, code: string, newPassword: string }`
  - Response: `200 OK` `{ token: string, user: { id, email }, profile: { displayName } }`
- `GET /auth/reset-password`:
  - Query: `?token=string`
  - Response: HTML page containing the web reset form (or error page if token invalid/expired)
- `POST /auth/reset-password-web`:
  - Body: Form-encoded `{ token: string, password: string, confirmPassword: string }`
  - Response: HTML page displaying confirmation message

### 5. Shared Contracts (`packages/shared`)

- Schemas in `@dwt/shared`:
  - `forgotPasswordInputSchema`: `{ email: z.string().email() }`
  - `resetPasswordInputSchema`: `{ email: z.string().email(), code: z.string().length(6), newPassword: z.string().min(8).max(128) }`
- Error codes in `packages/shared/src/errors/codes.ts`:
  - `invalid_code`: The 6-digit code is incorrect or expired.
  - `too_many_attempts`: 5 failed attempts exceeded; request a new code.
  - `token_invalid`: Web reset token is invalid or expired.

---

## Correctness Properties

### Property 1: Anti-Enumeration & Idempotent Forgot Password
*For any input email address (whether registered, unregistered, uppercase, or lowercase), `POST /auth/forgot-password` SHALL always return HTTP 200 with identical response structure. For unregistered emails, no database record or email dispatch shall occur.*
**Validates:** Requirements 1.2, 1.3

### Property 2: Expiry & Single-Use Enforcement
*For any generated password reset record, if `now() > expires_at` or `used_at IS NOT NULL`, all subsequent attempts to verify using the code or web token SHALL be rejected.*
**Validates:** Requirements 2.1, 2.3, 2.6, 3.2

### Property 3: Maximum 5 Failed Verification Attempts
*For any active reset record, entering 5 non-matching codes SHALL immediately invalidate the record (`attempts >= 5`), causing all subsequent attempts to fail even if the correct code is subsequently submitted.*
**Validates:** Requirement 2.4

### Property 4: Complete Session Revocation Upon Reset
*When a password reset completes successfully (via mobile code or web link), all existing active sessions for that user in the `sessions` table SHALL have `revoked_at` set to current timestamp, invalidating all other active devices.*
**Validates:** Requirements 2.2, 3.3

### Property 5: Password Hashing & Argon2id Integrity
*When a password reset completes, the stored `users.password_hash` SHALL be an encoded Argon2id hash verifiable by `verifyPassword`, and the user's previous password SHALL no longer authenticate.*
**Validates:** Requirements 2.1, 3.3

### Property 6: Input Validation
*Password reset requests with invalid email formatting or passwords outside the [8, 128] character boundary SHALL be rejected with validation errors without updating any credentials.*
**Validates:** Requirements 1.4, 2.5, 3.4

---

## Configuration & Constants

| Config Variable | Default Value | Description |
| :--- | :--- | :--- |
| `RESEND_API_KEY` | `""` | Resend API key for sending transactional emails via REST. |
| `SMTP_HOST` | `""` | SMTP server host (e.g. `smtp.gmail.com`). |
| `SMTP_PORT` | `587` | SMTP server port (`465` for SSL, `587` for TLS). |
| `SMTP_USER` | `""` | SMTP username/account (e.g. `yourname@gmail.com`). |
| `SMTP_PASS` | `""` | SMTP password or Google App Password. |
| `SMTP_SERVICE` | `""` | Shorthand SMTP service (e.g. `"gmail"`). |
| `SMTP_SECURE` | `"false"` | Use direct TLS/SSL connection (`true` for port 465). |
| `MAIL_FROM` | `"Disney World Tracker <auth@disneytracker.app>"` | Sender name and address for transactional emails. |
| `PASSWORD_RESET_EXPIRY_MINUTES` | `15` | Expiration time for reset codes and tokens. |
| `PASSWORD_RESET_MAX_ATTEMPTS` | `5` | Maximum failed verification attempts before invalidation. |
| `API_PUBLIC_URL` | `"https://dwt-api.onrender.com"` | Base URL used to formulate the fallback web reset link. |

---

## Error Handling

Standard `AppError` responses:
- `validation_failed` (400): Malformed email or password length violations.
- `invalid_code` (400): Code mismatch, expired code, or code already used.
- `too_many_attempts` (429): Exceeded 5 failed verification attempts; user must request a fresh code.
- `rate_limit_exceeded` (429): Exceeded 5 forgot-password requests within 15 minutes.

---

## Testing Strategy

1. **Unit & Property Tests**:
   - `passwordReset.prop.test.ts`: Fast-check property tests validating code generation, hash verification, attempt limits, and single-use constraints.
2. **Database Migration Test**:
   - `migration0059.test.ts`: Asserts table creation, foreign keys, constraints, and cascade delete behavior when a user is deleted.
3. **Integration Route Tests**:
   - `routes.test.ts`: Integration tests covering `POST /auth/forgot-password`, `POST /auth/reset-password`, and web reset fallback rendering with session issuance and revocation assertions.
4. **Mobile Component Tests**:
   - `ForgotPasswordScreen.test.tsx` & `ResetPasswordScreen.test.tsx`: Component tests verifying form interactions, cooldown timer countdown, error rendering, and session store integration.
