/**
 * Copy shared by every screen that asks for the account password, so the wording
 * cannot drift between sign-in and the delete-account re-authentication step
 * (account-deletion R1.8: "the lockout message used by `LoginScreen`").
 */
export const ACCOUNT_LOCKED_MESSAGE =
  'Account temporarily locked. Try again in 15 minutes.';
