# Implementation Plan

## Tasks

- [x] 1. Shared Schemas and Error Codes (`packages/shared`)
  - [x] 1.1 Add `invalid_code`, `too_many_attempts`, and `token_invalid` to `ErrorCode` in `packages/shared/src/errors/codes.ts`
    - **Corrective/superseding note (docs-drift audit, MEDIUM-3).** The real file path is
      `packages/shared/src/errors.ts` — a single file, not an `errors/` directory with a
      `codes.ts` inside it. The error codes themselves are correctly implemented and named exactly
      as described above; only the path was wrong.
    - _Requirements: 1.4, 2.3, 2.4_
  - [x] 1.2 Define `forgotPasswordInputSchema`, `resetPasswordInputSchema`, and associated DTO types in `packages/shared/src/schemas/auth.ts` and `packages/shared/src/dto/auth.ts`
    - **Corrective/superseding note (docs-drift audit, MEDIUM-3).** The real file paths are
      `packages/shared/src/schemas/User.ts` and `packages/shared/src/dto/User.ts` — there is no
      `schemas/auth.ts` or `dto/auth.ts`. The schemas and DTOs are correctly implemented and named
      exactly as described above; only the paths were wrong.
    - _Requirements: 1.1, 1.4, 2.1, 2.5_
  - [x] 1.3 Add schema tests in `packages/shared/src/schemas/__tests__/authReset.test.ts` validating boundaries, email format, and password length
    - _Requirements: 1.4, 2.5_
  - [x] 1.4 Checkpoint — run `npm run verify:shared`

- [x] 2. Database Migration (`apps/api`)
  - [x] 2.1 Create migration `apps/api/migrations/0059_password_reset_tokens.sql` defining `password_reset_tokens` table, indexes, and cascade constraints
    - _Requirements: 1.2, 1.6, 2.1_
  - [x] 2.2 Add migration unit test `apps/api/src/db/__tests__/migration0059.test.ts` asserting columns, foreign keys, constraints, and cascade delete on user deletion
    - _Requirements: 1.2, 2.2_
  - [x] 2.3 Checkpoint — run `npm run verify:api`

- [x] 3. Mail Service and Repository (`apps/api`)
  - [x] 3.1 Implement `apps/api/src/services/auth/mailService.ts` supporting Resend API in production and structured mock logger for dev/test
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 3.2 Implement `PasswordResetRepo` in `apps/api/src/services/auth/passwordResetRepo.ts` with token creation, attempt tracking, single-use marking, and user invalidation
    - _Requirements: 1.2, 2.1, 2.3, 2.4, 2.6_
  - [x] 3.3 Write property tests in `apps/api/src/services/auth/__tests__/passwordReset.prop.test.ts` (pg-mem) validating Property 1, Property 2, and Property 3
    - _Requirements: 1.2, 2.1, 2.3, 2.4_
  - [x] 3.4 Checkpoint — run `npm run verify:api`
  - [x] 3.5 Add SMTP / Gmail transport support to `mailService.ts` and test with unit tests
    - _Requirements: 4.1, 4.3, 4.4_

- [x] 4. Auth Routes and Handlers (`apps/api`)
  - [x] 4.1 Wire `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /auth/reset-password`, and `POST /auth/reset-password-web` in `apps/api/src/services/auth/routes.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 3.1, 3.2, 3.3_
  - [x] 4.2 Write route integration tests in `apps/api/src/services/auth/__tests__/passwordResetRoutes.test.ts` covering anti-enumeration, session issuance, session revocation, and web HTML responses
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 3.1, 3.3_
  - [x] 4.3 Checkpoint — run `npm run verify:api`

- [x] 5. Mobile Screens and Navigation (`apps/mobile`)
  - [x] 5.1 Update `AuthStackParamList` in `apps/mobile/src/navigation/RootNavigator.tsx` to include `ForgotPassword` and `ResetPassword`
    - _Requirements: 5.1, 5.2_
  - [x] 5.2 Add "Forgot password?" button to `apps/mobile/src/screens/LoginScreen.tsx` navigating with email param
    - _Requirements: 5.1, 5.2_
  - [x] 5.3 Implement `apps/mobile/src/screens/ForgotPasswordScreen.tsx` with email input and submission logic
    - _Requirements: 5.2, 5.3_
  - [x] 5.4 Implement `apps/mobile/src/screens/ResetPasswordScreen.tsx` with 6-digit code input, password input, and 60-second resend cooldown timer
    - _Requirements: 5.4, 5.5, 5.6_
  - [x] 5.5 Write component tests `apps/mobile/src/screens/__tests__/ForgotPasswordScreen.test.tsx` and `ResetPasswordScreen.test.tsx` asserting render, API calls, error handling, and session storage
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6_
  - [x] 5.6 Checkpoint — run `npm run verify:mobile`

- [x] 6. Final Full Verification Gate
  - [x] 6.1 Run full `npm run verify` across all workspaces and verify 0 errors
    - _Requirements: All_

---

## Task Dependency Graph

```
Task 1 (Shared Schemas & Errors)
   │
   ├──▶ Task 2 (Database Migration)
   │       │
   │       ▼
   │    Task 3 (Mail Service & PasswordResetRepo)
   │       │
   │       ▼
   │    Task 4 (Auth Routes & Handlers)
   │       │
   └───────┼──────────────────────────┐
           ▼                          ▼
        Task 5 (Mobile Screens) ──▶ Task 6 (Final Full Gate)
```
