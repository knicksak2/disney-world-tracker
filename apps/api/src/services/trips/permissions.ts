/**
 * Pure Trip authorization logic for the Trip_Service.
 *
 * This module isolates the two role-based decisions that are inherently pure —
 * the role → allowed-action matrix and the Last_Organizer_Rule guardrail — so
 * they can be property-tested directly, independently of the database and of
 * any request context. The transactional repo (`repo.ts`) and the route gates
 * (`authz.ts`) consult these functions; they own no policy of their own.
 *
 * Two rules live here:
 *
 *   1. The Trip_Role permission matrix (R4.2–R4.4, R4.7). An `organizer` may
 *      perform every action; a `member` may perform only the shared
 *      contribution actions. Because `organizer ⊇ member`, the matrix is
 *      expressed as a set of member-allowed actions plus a set of
 *      organizer-only actions, and `can` grants an organizer everything.
 *
 *   2. The Last_Organizer_Rule (R5.1–R5.6), expressed as a pure predicate over
 *      the current membership set: applying a demote/remove/leave must never
 *      leave a *non-empty* Trip with zero organizers. Emptying the Trip (the
 *      sole Member leaving) is permitted and is the caller's cue to delete the
 *      Trip (R5.6, R5.7).
 *
 * Design references:
 *   - design.md "permissions.ts" → `can`, `violatesLastOrganizer` signatures
 *   - requirements.md R4.1–R4.8, R5.1–R5.6
 *
 * Validates: Requirements 4.2, 4.3, 4.4, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6.
 */

/** The two Trip_Roles a Trip_Member may hold (R4.1). */
export type TripRole = 'organizer' | 'member';

/**
 * Every action the Trip_Service authorizes by Trip_Role.
 *
 * The first group is organizer-only (R4.2); the second is available to every
 * Trip_Member and therefore also to organizers (R4.3, R4.4).
 */
export type TripAction =
  | 'edit_settings'
  | 'send_invite'
  | 'cancel_invite'
  | 'remove_member'
  | 'promote'
  | 'demote'
  | 'delete_trip' // organizer-only (R4.2)
  | 'edit_booking_settings' // trip-booking-timeline organizer-only (R12.1, R12.5)
  | 'add_planned_item'
  | 'edit_planned_item'
  | 'set_day_park'
  | 'optimize_day'
  | 'create_log_entry'
  | 'add_rode_with'
  | 'add_comment'
  | 'add_reaction'
  | 'leave_trip' // member + organizer (R4.3, R4.4)
  | 'add_packing_item'
  | 'toggle_packing_item'
  | 'edit_packing_item'
  | 'mark_booking_window_done'
  | 'set_booking_reminder_mute' // trip-booking-timeline member (R12.1, R12.2)
  | 'upload_trip_photo'
  | 'post_feed_photo'
  | 'share_trip_summary' // member + organizer (photo-uploads R12.1, R14.3, R15.9)
  | 'delete_any_trip_photo'; // organizer-only (photo-uploads R12.5)

/**
 * Actions any Trip_Member may perform regardless of role (R4.3). Organizers
 * inherit all of these by way of `organizer ⊇ member` (R4.4).
 */
const MEMBER_ACTIONS: ReadonlySet<TripAction> = new Set<TripAction>([
  'add_planned_item',
  'edit_planned_item',
  'set_day_park',
  'optimize_day',
  'create_log_entry',
  'add_rode_with',
  'add_comment',
  'add_reaction',
  'leave_trip',
  'add_packing_item',
  'toggle_packing_item',
  'edit_packing_item',
  'mark_booking_window_done',
  'set_booking_reminder_mute',
  'upload_trip_photo',
  'post_feed_photo',
  'share_trip_summary',
]);

/**
 * Actions reserved for organizers (R4.2). Kept alongside `MEMBER_ACTIONS` so
 * the two sets together enumerate the entire `TripAction` union; a member is
 * denied precisely these.
 */
const ORGANIZER_ONLY_ACTIONS: ReadonlySet<TripAction> = new Set<TripAction>([
  'edit_settings',
  'send_invite',
  'cancel_invite',
  'remove_member',
  'promote',
  'demote',
  'delete_trip',
  'edit_booking_settings',
  'delete_any_trip_photo',
]);

/**
 * Decide whether a Trip_Member holding `role` may perform `action`.
 *
 * An `organizer` may perform every action — the organizer-only actions plus
 * everything a member can do (R4.2, R4.4). A `member` may perform only the
 * shared contribution actions and is denied the organizer-only actions (R4.3,
 * R4.7).
 *
 * @param role   The requesting Trip_Member's Trip_Role.
 * @param action The action being attempted.
 * @returns `true` iff the role is permitted to perform the action.
 */
export function can(role: TripRole, action: TripAction): boolean {
  if (role === 'organizer') {
    // organizer ⊇ member: permitted for every defined action.
    return MEMBER_ACTIONS.has(action) || ORGANIZER_ONLY_ACTIONS.has(action);
  }
  if (role === 'member') {
    return MEMBER_ACTIONS.has(action);
  }
  return false;
}

/**
 * Pure authorization check for deleting a Trip photo.
 *
 * An uploader may delete their own Trip photo at any time, whether or not they
 * are still a member of the Trip (Requirement 12.5, 12.11, decision D30).
 * Any other user may delete a photo only if they currently hold the
 * `delete_any_trip_photo` action (an organizer) on that Trip.
 */
export function canDeleteTripPhoto(
  role: TripRole | null | undefined,
  isUploader: boolean,
): boolean {
  if (isUploader) {
    return true;
  }
  if (!role) {
    return false;
  }
  return can(role, 'delete_any_trip_photo');
}

/**
 * One row of a Trip roster as the authorization layer sees it: the persisted role, when the member joined, and
 * whether their account is `active` (not pending deletion, purging or a tombstone).
 */
export interface RosterMember {
  readonly userId: string;
  readonly role: TripRole;
  readonly joinedAt: Date;
  readonly active: boolean;
}

/**
 * The role `userId` acts with on a Trip, derived from the roster at request time (account-deletion R7.1, R7.2).
 *
 * It equals the PERSISTED role, except for the Interim_Organizer: a persisted `member` who is active, when the
 * roster has no active organizer, and who is the active member with the earliest `joinedAt` (ties: lowest
 * `userId`, plain string compare) acts as `organizer`. That keeps a trip usable while its only organizer is
 * pending deletion. Nothing is persisted: when the organizer is restored the roster has an active organizer
 * again and this function returns the persisted roles with no other action (R7.5).
 *
 * Returns `null` when `userId` is not on the roster. `can`, `violatesLastOrganizer` and the action matrix are
 * unchanged; the interim organizer is only a different input role (R7.3, R7.6).
 */
export function effectiveRole(
  members: readonly RosterMember[],
  userId: string,
): TripRole | null {
  const me = members.find((m) => m.userId === userId);
  if (me === undefined) {
    return null;
  }
  if (me.role === 'organizer' || !me.active) {
    return me.role;
  }
  if (members.some((m) => m.role === 'organizer' && m.active)) {
    return me.role;
  }
  // No active organizer: the earliest-joined active member (ties by lowest user id) is the interim organizer.
  let first: RosterMember | undefined;
  for (const m of members) {
    if (!m.active) continue;
    if (first === undefined) {
      first = m;
      continue;
    }
    const byTime = m.joinedAt.getTime() - first.joinedAt.getTime();
    if (byTime < 0 || (byTime === 0 && m.userId < first.userId)) {
      first = m;
    }
  }
  return first !== undefined && first.userId === userId ? 'organizer' : me.role;
}

/** A single Trip_Member's identity and role within a Trip. */
export interface Membership {
  readonly userId: string;
  readonly role: TripRole;
}

/**
 * A pending mutation to the membership set that the Last_Organizer_Rule guards.
 *
 *   - `demote`: the named Organizer becomes a Member (R5.2).
 *   - `remove`: the named Trip_Member is removed by an Organizer (R5.4).
 *   - `leave`:  the named Trip_Member leaves the Trip (R5.3, R5.6).
 */
export type MembershipChange =
  | { readonly kind: 'demote'; readonly userId: string }
  | { readonly kind: 'remove'; readonly userId: string }
  | { readonly kind: 'leave'; readonly userId: string };

/**
 * Would applying `change` leave a *non-empty* Trip with zero organizers?
 *
 * Applies the change to a copy of `members` and inspects the result:
 *   - `demote` rewrites the named Member's role to `member`.
 *   - `remove` / `leave` drop the named Member entirely.
 *
 * The Trip's invariant (R5.1) is that any Trip retaining at least one Member
 * must retain at least one Organizer. So this returns `true` (a violation)
 * exactly when the resulting set is non-empty yet contains no organizer
 * (R5.2–R5.4). When two or more organizers exist the change is always safe
 * (R5.5), and when the change empties the Trip it is permitted (R5.6) — the
 * sole Member leaving is the caller's cue to delete the Trip (R5.7).
 *
 * A change naming a `userId` not present in `members` leaves the set
 * effectively unchanged, so the predicate reports on the current set as-is.
 *
 * @param members The Trip's current membership set.
 * @param change  The demote/remove/leave mutation to evaluate.
 * @returns `true` if the mutation would strand a non-empty Trip without an
 *          organizer; `false` if the mutation is permitted.
 */
export function violatesLastOrganizer(
  members: readonly Membership[],
  change: MembershipChange,
): boolean {
  let next: Membership[];
  if (change.kind === 'demote') {
    next = members.map((m) =>
      m.userId === change.userId ? { userId: m.userId, role: 'member' as const } : m,
    );
  } else {
    // 'remove' | 'leave': the named Member departs the Trip.
    next = members.filter((m) => m.userId !== change.userId);
  }

  if (next.length === 0) {
    // The Trip is now empty; permitted (R5.6, R5.7).
    return false;
  }

  const hasOrganizer = next.some((m) => m.role === 'organizer');
  return !hasOrganizer;
}
