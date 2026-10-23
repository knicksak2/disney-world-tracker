/**
 * Trip owner selection and trip resolution planning for the purge: pure, order independent
 * (account-deletion design, "Pure modules, exact contracts"; Requirements 10.3, 10.9).
 */

import type { DeletionState } from './deletionState.js';

export interface TripMemberFact {
  readonly userId: string;
  readonly role: 'organizer' | 'member';
  readonly joinedAt: Date;
  /** `users.deletion_state` of the member. */
  readonly state: DeletionState;
}

const isCandidate = (m: TripMemberFact, excludeUserId: string): boolean =>
  m.userId !== excludeUserId && m.state !== 'purging' && m.state !== 'tombstone';

function compareMembers(a: TripMemberFact, b: TripMemberFact): number {
  if (a.role !== b.role) return a.role === 'organizer' ? -1 : 1;
  const at = a.joinedAt.getTime();
  const bt = b.joinedAt.getTime();
  if (at !== bt) return at - bt;
  if (a.userId === b.userId) return 0;
  return a.userId < b.userId ? -1 : 1;
}

/**
 * Candidates are members other than `excludeUserId` whose state is not `purging` or `tombstone`.
 * An `active` candidate is preferred; a `pending_deletion` one is chosen only when no candidate is
 * active. Among equals: organizer before member, then earliest `joinedAt`, then lowest `userId`.
 * Returns null when there is no candidate. The result does not depend on the input order.
 */
export function selectNewOwner(
  members: readonly TripMemberFact[],
  excludeUserId: string,
): TripMemberFact | null {
  const candidates = members.filter((m) => isCandidate(m, excludeUserId));
  const active = candidates.filter((m) => m.state === 'active');
  const pool = active.length > 0 ? active : candidates;
  if (pool.length === 0) return null;
  return [...pool].sort(compareMembers)[0]!;
}

export type TripResolution =
  | { readonly kind: 'delete_trip' }
  | {
      readonly kind: 'keep_trip';
      /** Non-null iff the purged user is `trips.creator_id`. */
      readonly newCreatorId: string | null;
      /** Non-null iff the selected owner holds `member` and a promotion is required. */
      readonly promoteUserId: string | null;
      /** True iff the purged user currently has a membership row. */
      readonly removeMembership: boolean;
    };

/**
 * What the purge does to one trip the purged user belongs to or created:
 *
 * 1. no candidate owner -> `delete_trip` (the sole member, or everyone else already purging);
 * 2. otherwise `keep_trip`: the owner becomes creator when the purged user was; the owner is promoted to
 *    organizer when the purged user was the creator, or when no non-purging organizer would remain.
 */
export function planTripResolution(input: {
  purgedUserId: string;
  creatorId: string;
  members: readonly TripMemberFact[];
}): TripResolution {
  const { purgedUserId, creatorId, members } = input;
  const owner = selectNewOwner(members, purgedUserId);
  if (owner === null) return { kind: 'delete_trip' };

  const purgedIsCreator = creatorId === purgedUserId;
  const organizerRemains = members.some(
    (m) => m.userId !== purgedUserId && m.role === 'organizer' && m.state !== 'purging' && m.state !== 'tombstone',
  );
  const needsPromotion = owner.role === 'member' && (purgedIsCreator || !organizerRemains);

  return {
    kind: 'keep_trip',
    newCreatorId: purgedIsCreator ? owner.userId : null,
    promoteUserId: needsPromotion ? owner.userId : null,
    removeMembership: members.some((m) => m.userId === purgedUserId),
  };
}
