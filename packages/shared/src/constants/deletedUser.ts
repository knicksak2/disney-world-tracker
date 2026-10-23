/**
 * Account-deletion shared constants (account-deletion R16.1, R16.4, R16.5).
 *
 * Defined once here so the API and the mobile app cannot drift: neither side
 * redeclares the confirmation phrase, the placeholder display name or the
 * placeholder id prefix.
 */

/** The text the user must type to confirm deletion (compared after trim, exactly). */
export const DELETE_ACCOUNT_CONFIRMATION_PHRASE = 'DELETE';

/** The display name shown for a person whose account is pending deletion or purged. */
export const DELETED_USER_DISPLAY_NAME = 'Deleted user';

/**
 * First 32 bits of every placeholder / tombstone id. A real `gen_random_uuid()` id
 * starts with it with probability 2^-32 (accepted risk, see the migration notes).
 */
export const DELETED_USER_ID_PREFIX = 'deadc0de-';

/**
 * True when `id` is a placeholder (alias or tombstone) user id. Lets the client
 * recognise a deleted person from the id alone, with no extra DTO field.
 */
export function isDeletedUserId(id: string): boolean {
  return typeof id === 'string' && id.toLowerCase().startsWith(DELETED_USER_ID_PREFIX);
}
