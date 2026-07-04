/**
 * recipientGating — pure send-gating predicates for the Share_Composer.
 *
 * These functions carry the recipient-count and no-friends rules of the
 * Share_Composer (R2.6, R2.7, R2.15) as pure logic, decoupled from React so
 * they can be exercised directly by property tests (see task 5.4, Property 3)
 * and reused by the screen.
 *
 *   - R2.6  — the User may select between 1 and 50 recipient Friends inclusive.
 *   - R2.7  — while the selected count is 0 or greater than 50, the send
 *             control is disabled.
 *   - R2.15 — while the User has zero Friends available, the composer shows a
 *             no-friends empty state and disables the send control.
 */

/** Minimum number of recipient Friends a Share may target (R2.6). */
export const MIN_RECIPIENTS = 1;

/** Maximum number of recipient Friends a Share may target (R2.6). */
export const MAX_RECIPIENTS = 50;

/**
 * True when `count` selected recipients falls within the inclusive
 * `[MIN_RECIPIENTS, MAX_RECIPIENTS]` range (R2.6, R2.7).
 *
 * Non-integer or non-finite counts are never valid; a selection is always a
 * whole number of Friends.
 */
export function isRecipientCountValid(count: number): boolean {
  return (
    Number.isInteger(count) &&
    count >= MIN_RECIPIENTS &&
    count <= MAX_RECIPIENTS
  );
}

/**
 * True when the User has no Friends available to select as recipients (R2.15).
 * Drives the no-friends empty state and forces the send control off.
 */
export function hasNoFriends(friendCount: number): boolean {
  return friendCount <= 0;
}

/**
 * The send-gating predicate (Property 3): the send control is enabled if and
 * only if the User has at least one Friend available AND the selected recipient
 * count is within `[1, 50]` (R2.6, R2.7, R2.15).
 *
 * This intentionally does NOT account for in-flight submission or success
 * transitions; those are UI-lifecycle concerns layered on top by the screen
 * (R2.9). It captures only the recipient-count/no-friends gate.
 */
export function canSend(recipientCount: number, friendCount: number): boolean {
  return !hasNoFriends(friendCount) && isRecipientCountValid(recipientCount);
}
