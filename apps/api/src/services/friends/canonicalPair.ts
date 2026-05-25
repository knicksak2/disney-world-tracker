/**
 * Canonical friendship pair helper for the Friends_Service.
 *
 * The `friendships` table stores a single canonical row per relationship using
 * the ordered pair `(min(userA, userB), max(userA, userB))` so that the
 * symmetry of the friend relation is an enforced storage invariant rather
 * than something to be checked at read time. The DB-level CHECK constraint
 * on the table requires `user_lo_id < user_hi_id` strictly.
 *
 * This module provides the pure ordering function used everywhere a
 * `(userA, userB)` pair must be normalized before reaching storage: row
 * insertion on `accept`, lookup on `remove`, and the IN list built when the
 * Sharing_Service validates that every recipient is a Friend of the sender.
 *
 * Design references:
 *   - design.md "Friends_Service" → `friendships` canonical row (R8.6)
 *   - design.md "Schema and Constraints" → `friendships` PK + CHECK
 *     `user_lo_id < user_hi_id`; R8.8 self-friend prevention is enforced at
 *     the application layer because `lo == hi` is the only way to violate
 *     the CHECK and would be caught earlier as a self-target.
 *
 * Validates: Requirements R8.6 (and supports R8.8 by making the impossible
 *            state of `lo == hi` unrepresentable in the return type).
 */

/**
 * The canonical, ordered representation of an unordered pair of user ids.
 *
 * The invariant `lo < hi` (strict, lexicographic on the underlying string
 * representation) is established by the only producer of this shape — the
 * `pair` function below — so consumers may rely on it without re-checking.
 */
export interface CanonicalPair {
  readonly lo: string;
  readonly hi: string;
}

/**
 * Return the canonical ordered representation of the unordered pair `{a, b}`.
 *
 * Ordering is strict lexicographic comparison of the input strings. Both
 * user ids in the system are UUIDs (per the design's ER diagram) and UUIDs
 * are case-sensitive in their canonical hyphenated lowercase form, so a
 * straight `<` comparison is sufficient and stable.
 *
 * @param a - First user id (a UUID string).
 * @param b - Second user id (a UUID string).
 * @returns `{ lo, hi }` where `lo < hi` lexicographically.
 * @throws {Error} If `a === b`. A self-pair is the only way to violate the
 *         `user_lo_id < user_hi_id` CHECK constraint at the storage layer
 *         and is forbidden by R8.8; rejecting it here makes the impossible
 *         state unrepresentable for any caller that has a `CanonicalPair`.
 */
export function pair(a: string, b: string): CanonicalPair {
  if (a === b) {
    throw new Error(
      'canonicalPair: cannot form a friendship pair from a single user id (R8.8 self-friend prevention)',
    );
  }
  return a < b ? { lo: a, hi: b } : { lo: b, hi: a };
}
