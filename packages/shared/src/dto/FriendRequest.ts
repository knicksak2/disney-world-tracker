/**
 * FriendRequest DTO.
 *
 * A pending request from one User to another. At most one pending request
 * may exist between any unordered pair of Users at a time (R8.7), and a User
 * may not target themselves (R8.8). A `FriendRequest` is removed from the
 * pending state when accepted (and replaced by a `Friendship`, R8.4) or
 * declined (R8.5).
 *
 * Validates: Requirements 8.3, 8.4, 8.5, 8.7, 8.8
 */

export interface FriendRequestDTO {
  /** Server-assigned unique id of the pending request. */
  readonly id: string;

  /** User id that initiated the request. */
  readonly senderId: string;

  /** User id the request was sent to. */
  readonly recipientId: string;

  /** ISO-8601 timestamp the request was created. */
  readonly createdAt: string;
}
