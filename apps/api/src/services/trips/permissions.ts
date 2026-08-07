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
  | 'add_planned_item'
  | 'edit_planned_item'
  | 'optimize_day'
  | 'create_log_entry'
  | 'add_rode_with'
  | 'add_comment'
  | 'add_reaction'
  | 'leave_trip'; // member + organizer (R4.3, R4.4)

/**
 * Actions any Trip_Member may perform regardless of role (R4.3). Organizers
 * inherit all of these by way of `organizer ⊇ member` (R4.4).
 */
const MEMBER_ACTIONS: ReadonlySet<TripAction> = new Set<TripAction>([
  'add_planned_item',
  'edit_planned_item',
  'optimize_day',
  'create_log_entry',
  'add_rode_with',
  'add_comment',
  'add_reaction',
  'leave_trip',
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
  // role === 'member'
  return MEMBER_ACTIONS.has(action);
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
