import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { DeletionState } from '../deletionState.js';
import { planTripResolution, selectNewOwner, type TripMemberFact } from '../ownerSelection.js';
import { violatesLastOrganizer, type Membership } from '../../trips/permissions.js';

const RUNS = { numRuns: 100 };

const stateArb = fc.constantFrom<DeletionState>('active', 'pending_deletion', 'purging', 'tombstone');
const roleArb = fc.constantFrom<'organizer' | 'member'>('organizer', 'member');
// A small time window makes joinedAt ties common, so the userId tie-break is exercised.
const joinedArb = fc.integer({ min: 0, max: 5 }).map((n) => new Date(Date.UTC(2026, 0, 1 + n)));

const USER_POOL = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6'] as const;

const factArb = (userId: string): fc.Arbitrary<TripMemberFact> =>
  fc.record({ userId: fc.constant(userId), role: roleArb, joinedAt: joinedArb, state: stateArb });

/** Distinct members drawn from the pool, each with arbitrary role, join time and state. */
const membersArb: fc.Arbitrary<TripMemberFact[]> = fc
  .subarray([...USER_POOL], { minLength: 0 })
  .chain((ids) => fc.tuple(...ids.map(factArb)) as fc.Arbitrary<TripMemberFact[]>);

const isCandidate = (x: TripMemberFact, exclude: string): boolean =>
  x.userId !== exclude && x.state !== 'purging' && x.state !== 'tombstone';

/** Independent oracle: pick the best candidate by scanning, without sorting. */
function oracleOwner(members: readonly TripMemberFact[], exclude: string): TripMemberFact | null {
  const candidates = members.filter((x) => isCandidate(x, exclude));
  const pool = candidates.some((x) => x.state === 'active')
    ? candidates.filter((x) => x.state === 'active')
    : candidates;
  let best: TripMemberFact | null = null;
  for (const x of pool) {
    if (best === null) {
      best = x;
      continue;
    }
    const rx = x.role === 'organizer' ? 0 : 1;
    const rb = best.role === 'organizer' ? 0 : 1;
    const better =
      rx < rb ||
      (rx === rb &&
        (x.joinedAt.getTime() < best.joinedAt.getTime() ||
          (x.joinedAt.getTime() === best.joinedAt.getTime() && x.userId < best.userId)));
    if (better) best = x;
  }
  return best;
}

describe('ownerSelection properties', () => {
  // Feature: account-deletion, Property 8: New owner selection is deterministic, total over candidates, and order independent
  it('Property 8: the result is null iff there is no candidate, and otherwise a ranked candidate', () => {
    fc.assert(
      fc.property(membersArb, fc.constantFrom(...USER_POOL, 'not-a-member'), (members, exclude) => {
        const result = selectNewOwner(members, exclude);
        const candidates = members.filter((x) => isCandidate(x, exclude));

        if (candidates.length === 0) {
          expect(result).toBeNull();
          return;
        }
        expect(result).not.toBeNull();
        expect(members).toContain(result);
        expect(result!.userId).not.toBe(exclude);
        expect(['purging', 'tombstone']).not.toContain(result!.state);
        if (candidates.some((x) => x.state === 'active')) expect(result!.state).toBe('active');

        // Nothing of the same tier outranks the result.
        const tier = candidates.filter((x) => x.state === result!.state);
        for (const other of tier) {
          if (other.role === 'organizer' && result!.role === 'member') {
            throw new Error('a member was chosen over an organizer of the same tier');
          }
          if (other.role === result!.role) {
            expect(other.joinedAt.getTime()).toBeGreaterThanOrEqual(result!.joinedAt.getTime());
            if (other.joinedAt.getTime() === result!.joinedAt.getTime()) {
              expect(other.userId >= result!.userId).toBe(true);
            }
          }
        }
        expect(result).toBe(oracleOwner(members, exclude));
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 8: New owner selection is deterministic, total over candidates, and order independent
  it('Property 8: permuting the input does not change the result', () => {
    fc.assert(
      fc.property(
        membersArb.chain((members) =>
          fc.tuple(
            fc.constant(members),
            fc.array(fc.integer(), { minLength: members.length, maxLength: members.length }),
          ),
        ),
        fc.constantFrom(...USER_POOL),
        ([members, keys], exclude) => {
          const shuffled = members
            .map((member, i) => ({ member, key: keys[i]! }))
            .sort((a, b) => a.key - b.key)
            .map((x) => x.member);
          expect(selectNewOwner(shuffled, exclude)).toBe(selectNewOwner(members, exclude));
        },
      ),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: a model of trips under departures and purges
// ---------------------------------------------------------------------------

interface ModelTrip {
  creatorId: string;
  members: { userId: string; role: 'organizer' | 'member'; joinedAt: Date }[];
}

type Op =
  | { kind: 'depart'; trip: number; user: number }
  | { kind: 'mark_purging'; user: number }
  | { kind: 'purge'; user: number };

const tripArb: fc.Arbitrary<ModelTrip> = fc
  .subarray([...USER_POOL], { minLength: 1 })
  .chain((ids) =>
    fc.tuple(
      fc.constant(ids),
      fc.tuple(...ids.map(() => fc.tuple(roleArb, joinedArb))),
    ),
  )
  .map(([ids, attrs]) => {
    const members = ids.map((userId, i) => ({
      userId,
      // The first member is always an organizer and the creator: a valid starting trip.
      role: i === 0 ? ('organizer' as const) : attrs[i]![0],
      joinedAt: attrs[i]![1],
    }));
    return { creatorId: ids[0]!, members };
  });

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant('depart' as const),
    trip: fc.nat({ max: 3 }),
    user: fc.nat({ max: USER_POOL.length - 1 }),
  }),
  fc.record({ kind: fc.constant('mark_purging' as const), user: fc.nat({ max: USER_POOL.length - 1 }) }),
  fc.record({ kind: fc.constant('purge' as const), user: fc.nat({ max: USER_POOL.length - 1 }) }),
);

describe('trip resolution properties', () => {
  // Feature: account-deletion, Property 9: Trip resolution never strands or leaks a trip
  it('Property 9: planTripResolution deletes iff there is no candidate; otherwise the applied plan leaves a usable trip', () => {
    fc.assert(
      fc.property(
        membersArb,
        fc.constantFrom(...USER_POOL),
        fc.constantFrom(...USER_POOL),
        (members, purgedUserId, creatorId) => {
          const plan = planTripResolution({ purgedUserId, creatorId, members });
          const owner = selectNewOwner(members, purgedUserId);

          if (owner === null) {
            expect(plan.kind).toBe('delete_trip');
            return;
          }
          expect(plan.kind).toBe('keep_trip');
          if (plan.kind !== 'keep_trip') return;

          // Apply the plan to a copy.
          const after = members
            .filter((x) => x.userId !== purgedUserId)
            .map((x) => ({ ...x, role: x.userId === plan.promoteUserId ? ('organizer' as const) : x.role }));
          const newCreator = plan.newCreatorId ?? creatorId;

          expect(after.some((x) => x.userId === purgedUserId)).toBe(false);
          expect(newCreator).not.toBe(purgedUserId);
          if (plan.newCreatorId !== null) {
            expect(plan.newCreatorId).toBe(owner.userId);
            expect(after.find((x) => x.userId === owner.userId)?.role).toBe('organizer');
          }
          expect(plan.newCreatorId !== null).toBe(creatorId === purgedUserId);
          expect(plan.removeMembership).toBe(members.some((x) => x.userId === purgedUserId));
          // At least one non-purging organizer survives, and the persisted rows satisfy the rule.
          expect(after.some((x) => x.role === 'organizer' && x.state !== 'purging')).toBe(true);
          const rows: Membership[] = after.map((x) => ({ userId: x.userId, role: x.role }));
          expect(violatesLastOrganizer(rows, { kind: 'leave', userId: '__nobody__' })).toBe(false);
        },
      ),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 9: Trip resolution never strands or leaks a trip
  it('Property 9: over any sequence of departures, claims and purges no surviving trip violates the Last_Organizer_Rule', () => {
    fc.assert(
      fc.property(fc.array(tripArb, { minLength: 1, maxLength: 4 }), fc.array(opArb, { maxLength: 25 }), (initial, ops) => {
        const trips: (ModelTrip | null)[] = initial.map((t) => ({ ...t, members: t.members.map((x) => ({ ...x })) }));
        const state = new Map<string, DeletionState>(USER_POOL.map((u) => [u, 'active']));

        const facts = (t: ModelTrip): TripMemberFact[] =>
          t.members.map((x) => ({ ...x, state: state.get(x.userId)! }));

        const purge = (userId: string): void => {
          state.set(userId, 'purging');
          trips.forEach((t, i) => {
            if (t === null) return;
            if (!t.members.some((x) => x.userId === userId) && t.creatorId !== userId) return;
            const plan = planTripResolution({ purgedUserId: userId, creatorId: t.creatorId, members: facts(t) });
            if (plan.kind === 'delete_trip') {
              trips[i] = null;
              return;
            }
            t.members = t.members
              .filter((x) => x.userId !== userId)
              .map((x) => (x.userId === plan.promoteUserId ? { ...x, role: 'organizer' as const } : x));
            if (plan.newCreatorId !== null) t.creatorId = plan.newCreatorId;
            // Right after resolving a trip it has a non-purging organizer.
            expect(t.members.some((x) => x.role === 'organizer' && state.get(x.userId) !== 'purging')).toBe(true);
          });
          state.set(userId, 'tombstone');
        };

        for (const op of ops) {
          const userId = USER_POOL[op.user]!;
          if (op.kind === 'mark_purging') {
            if (state.get(userId) === 'active') state.set(userId, 'purging');
          } else if (op.kind === 'purge') {
            if (state.get(userId) !== 'tombstone') purge(userId);
          } else {
            const t = trips[op.trip % trips.length];
            if (!t || state.get(userId) === 'tombstone') continue;
            const rows: Membership[] = t.members.map((x) => ({ userId: x.userId, role: x.role }));
            if (!rows.some((x) => x.userId === userId)) continue;
            if (violatesLastOrganizer(rows, { kind: 'leave', userId })) continue;
            t.members = t.members.filter((x) => x.userId !== userId);
            if (t.members.length === 0) trips[op.trip % trips.length] = null;
          }
        }

        // Finish every claimed purge, then check the survivors.
        for (const u of USER_POOL) if (state.get(u) === 'purging') purge(u);

        for (const t of trips) {
          if (t === null) continue;
          const rows: Membership[] = t.members.map((x) => ({ userId: x.userId, role: x.role }));
          if (rows.length > 0) {
            expect(rows.some((x) => x.role === 'organizer')).toBe(true);
            expect(violatesLastOrganizer(rows, { kind: 'leave', userId: '__nobody__' })).toBe(false);
          }
          for (const u of USER_POOL) {
            if (state.get(u) === 'tombstone') {
              expect(t.members.some((x) => x.userId === u)).toBe(false);
              expect(t.creatorId).not.toBe(u);
            }
          }
        }
      }),
      RUNS,
    );
  });
});
