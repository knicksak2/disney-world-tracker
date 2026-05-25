/**
 * Friendship DTO.
 *
 * A mutual, accepted friend relationship between two Users. The design stores
 * a single canonical row per relationship using the ordered pair
 * `(min(userA, userB), max(userA, userB))` to make symmetry an enforced
 * invariant (R8.6).
 *
 * Validates: Requirements 8.4, 8.6
 */

export interface FriendshipDTO {
  /** Lexicographically lower User id of the unordered pair (`min(a, b)`). */
  readonly userLoId: string;

  /** Lexicographically higher User id of the unordered pair (`max(a, b)`). */
  readonly userHiId: string;

  /** ISO-8601 timestamp the relationship was established. */
  readonly establishedAt: string;
}
