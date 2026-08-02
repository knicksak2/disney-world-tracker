/**
 * Trip_Service background notification notices.
 *
 * These are the fire-and-forget dispatch payloads the Trip_Service hands to
 * the Notification_Service *after* the originating transaction commits,
 * mirroring the Friends_Service's `FriendRequestReceivedNotice` and the
 * Sharing_Service's `ShareDeliveredNotice`. Each notice carries only the ids
 * needed to compose an in-App notification and a push with a deep-link target —
 * never the full Trip payload — so the notification path can run without
 * re-reading rows and stays decoupled from the notification wiring.
 *
 * The types are declared here (rather than imported from the
 * Notification_Service) so the Trip_Service does not depend on the notification
 * layer. They are structurally identical to the Notification_Service's
 * corresponding event types, so the composition root (`composeServices.ts`) can
 * hand them straight through to the background dispatch port.
 *
 * Design references:
 *   - design.md "Notification events (`events.ts` + Notification_Service handlers)"
 *   - requirements.md R6.6, R6.7 (invite notification + deep link),
 *     R10.8 (rode-with tag notification + deep link)
 *
 * Validates: Requirements 15.2, 15.4, 15.6 (task grouping); the notices
 * themselves back R6.6, R6.7, R10.8.
 */

/**
 * Emitted after a `pending` Trip_Invite is created (R6.6, R6.7).
 *
 * Carries the invite to deep-link to, the Trip it belongs to, the inviting
 * Organizer (used to title the notification with their display name), and the
 * invited User (the notification recipient).
 */
export interface TripInviteCreatedNotice {
  /** Id of the created Trip_Invite; the push deep-link target. */
  readonly inviteId: string;
  /** Id of the Trip the invite is for. */
  readonly tripId: string;
  /** Id of the Organizer who sent the invite (names the notification). */
  readonly inviterId: string;
  /** Id of the invited User (the notification recipient). */
  readonly inviteeId: string;
}

/**
 * Emitted after a `pending` Rode_With_Tag is created for a Trip_Log_Entry
 * (R10.8).
 *
 * Carries the tag to deep-link to (the confirm/decline target), the log entry
 * it hangs off, the Member who created the tag by logging the Completion (names
 * the notification), and the tagged Member (the notification recipient).
 */
export interface RodeWithTagCreatedNotice {
  /** Id of the created Rode_With_Tag; the push deep-link target. */
  readonly tagId: string;
  /** Id of the Trip_Log_Entry the tag belongs to. */
  readonly tripLogEntryId: string;
  /** Id of the Member who logged the Completion and created the tag. */
  readonly taggingMemberId: string;
  /** Id of the tagged Member (the notification recipient). */
  readonly taggedMemberId: string;
}
