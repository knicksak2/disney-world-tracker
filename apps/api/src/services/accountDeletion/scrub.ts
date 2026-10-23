/**
 * Share-payload scrub: pure, never mutates its input (account-deletion R11.4, R11.5, R5.11).
 *
 * The embedded-name inventory of `shares.payload_snapshot` is exactly two kinds:
 *   pinShowcase  { ownerId, ownerDisplayName }  -> ownerId := replacementId, ownerDisplayName := 'Deleted user'
 *   tripSummary  { sharerDisplayName }          -> sharerDisplayName := 'Deleted user'
 * `experience` and `progress` embed no id or name and are returned unchanged, as is any unknown or
 * malformed shape. The caller decides WHICH rows to scrub (by sender); this function never compares ids.
 */

import { DELETED_USER_DISPLAY_NAME } from '@dwt/shared';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Returns the scrubbed payload, or the SAME reference when there is nothing to change. A second
 * call on a scrubbed payload therefore returns it unchanged (idempotent), which lets the purge
 * skip the write for a row that is already clean.
 */
export function scrubSharePayload(payload: unknown, replacementId: string): unknown {
  if (!isRecord(payload)) return payload;

  if (payload.kind === 'pinShowcase') {
    if (typeof payload.ownerId !== 'string' || typeof payload.ownerDisplayName !== 'string') {
      return payload;
    }
    if (
      payload.ownerId === replacementId &&
      payload.ownerDisplayName === DELETED_USER_DISPLAY_NAME
    ) {
      return payload;
    }
    return { ...payload, ownerId: replacementId, ownerDisplayName: DELETED_USER_DISPLAY_NAME };
  }

  if (payload.kind === 'tripSummary') {
    if (typeof payload.sharerDisplayName !== 'string') return payload;
    if (payload.sharerDisplayName === DELETED_USER_DISPLAY_NAME) return payload;
    return { ...payload, sharerDisplayName: DELETED_USER_DISPLAY_NAME };
  }

  return payload;
}
