import { ApiError } from '../../api/client';

/**
 * Copy for `trip_party_deleted` (409), returned when an expense or settlement
 * create or edit names someone whose account was deleted, or whose stored parties
 * include such a person (account-deletion R12.10). Delete stays allowed, which is
 * how a group clears a debt to a person who is gone.
 */
export const TRIP_PARTY_DELETED_MESSAGE =
  "This entry involves someone who deleted their account, so it can't be changed. You can still delete it.";

/** Inline message for a failed expense / settlement save. */
export function ledgerSaveErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === 'trip_party_deleted') {
    return TRIP_PARTY_DELETED_MESSAGE;
  }
  return err instanceof Error ? err.message : fallback;
}
