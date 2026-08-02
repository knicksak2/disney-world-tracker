// Feature: trips, Property 8: A non-empty Trip always retains at least one Organizer
/**
 * Property-based tests for the Last_Organizer_Rule guardrail.
 *
 * Validates: Requirements 4.1, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 *
 * Property 8 (design.md → Correctness Properties):
 *
 *   A non-empty Trip always retains at least one Organizer. Expressed over
 *   the pure predicate `violatesLastOrganizer(members, change)`: applying a
 *   demote/remove/leave `change` to the membership set flags a *violation*
 *   (`true`) exactly when the resulting set is non-empty yet contains zero
 *   organizers. Emptying the Trip (the sole Member departing) is permitted
 *   (`false`, R5.6), and while two or more organizers exist every such change
 *   is safe (`false`, R5.5).
 *
 * Test design
 * -----------
 * The function under test is a pure predicate over an in-memory membership
 * set, so no database or request context is needed. The property is checked
 * against an independent reference oracle derived straight from the
 * requirement text:
 *
 *   1. Apply the change to a copy of the set — `demote` rewrites the named
 *      Member's role to `member`; `remove`/`leave` drop the named Member.
 *   2. If the resulting set is empty, there is no invariant to protect, so the
 *      change is permitted (R5.6, R5.7).
 *   3. Otherwise the change violates the rule iff the resulting set has no
 *      organizer (R5.1–R5.4).
 *
 * The oracle counts organizers directly (rather than reusing the `.some(...)`
 * short-circuit the implementation uses) so the two computations are genuinely
 * independent. Generators bias `change.userId` toward an existing Member so the
 * interesting demote/remove/leave cases dominate, while still occasionally
 * naming a non-member to confirm the predicate reports on the current set as-is.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  violatesLastOrganizer,
  type Membership,
  type MembershipChange,
  type TripRole,
} from '../permissions.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
//
// User ids are drawn from a small pool so that a generated `change.userId`
// collides with an existing Member most of the time; a membership set is a
// uniqueArray keyed on `userId` so each User appears at most once (R4.1).

const roleArb: fc.Arbitrary<TripRole> = fc.constantFrom('organizer', 'member');

/** A single Member: a User id from a small pool plus a Trip_Role. */
const membershipArb: fc.Arbitrary<Membership> = fc.record({
  userId: fc.integer({ min: 0, max: 11 }).map((n) => `u-${String(n).padStart(2, '0')}`),
  role: roleArb,
});

/** A membership set with at most one role per User (R4.1). */
const membersArb: fc.Arbitrary<Membership[]> = fc.uniqueArray(membershipArb, {
  minLength: 0,
  maxLength: 8,
  selector: (m) => m.userId,
});

const changeKindArb = fc.constantFrom<MembershipChange['kind']>(
  'demote',
  'remove',
  'leave',
);

/**
 * Build a change whose `userId` is biased toward an existing Member (so the
 * mutation actually alters the set) but that occasionally names a User not in
 * the set (to confirm the predicate then reports on the unchanged set).
 */
function changeArb(members: readonly Membership[]): fc.Arbitrary<MembershipChange> {
  const memberIdArb =
    members.length > 0
      ? fc.constantFrom(...members.map((m) => m.userId))
      : fc.constant('u-absent');
  const anyIdArb = fc
    .integer({ min: 0, max: 20 })
    .map((n) => `u-${String(n).padStart(2, '0')}`);
  // 80% an existing Member, 20% an arbitrary id.
  const userIdArb = fc.oneof(
    { weight: 4, arbitrary: memberIdArb },
    { weight: 1, arbitrary: anyIdArb },
  );
  return fc.record({ kind: changeKindArb, userId: userIdArb });
}

// ---------------------------------------------------------------------------
// Reference oracle
// ---------------------------------------------------------------------------

/** Apply a change to a membership set, returning the resulting set. */
function applyChange(
  members: readonly Membership[],
  change: MembershipChange,
): Membership[] {
  if (change.kind === 'demote') {
    return members.map((m) =>
      m.userId === change.userId ? { userId: m.userId, role: 'member' } : m,
    );
  }
  return members.filter((m) => m.userId !== change.userId);
}

/**
 * Independent oracle: a change violates the Last_Organizer_Rule iff the
 * resulting set is non-empty and contains zero organizers (R5.1–R5.6).
 */
function oracleViolates(
  members: readonly Membership[],
  change: MembershipChange,
): boolean {
  const next = applyChange(members, change);
  if (next.length === 0) return false;
  const organizerCount = next.filter((m) => m.role === 'organizer').length;
  return organizerCount === 0;
}

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('violatesLastOrganizer — Property 8: a non-empty Trip retains an Organizer', () => {
  it('matches the independent oracle for any membership set and change', () => {
    fc.assert(
      fc.property(
        membersArb.chain((members) =>
          changeArb(members).map((change) => ({ members, change })),
        ),
        ({ members, change }) => {
          expect(violatesLastOrganizer(members, change)).toBe(
            oracleViolates(members, change),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('never reports a violation when the change empties the Trip (R5.6, R5.7)', () => {
    // A sole Member leaving/being removed empties the Trip: always permitted.
    fc.assert(
      fc.property(roleArb, changeKindArb, (role, kind) => {
        const members: Membership[] = [{ userId: 'solo', role }];
        const change: MembershipChange =
          kind === 'demote'
            ? { kind: 'demote', userId: 'solo' }
            : { kind, userId: 'solo' };
        // Demoting the sole Member leaves a non-empty Trip whose only Member is
        // a `member` — zero organizers — which IS a violation regardless of the
        // starting role; remove/leave empties the Trip and is permitted.
        const expected = kind === 'demote';
        expect(violatesLastOrganizer(members, change)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('permits any organizer change while two or more organizers remain (R5.5)', () => {
    fc.assert(
      fc.property(
        // At least two organizers, plus arbitrary extra members.
        fc.uniqueArray(
          fc.integer({ min: 0, max: 20 }).map((n) => `o-${String(n).padStart(2, '0')}`),
          { minLength: 2, maxLength: 5 },
        ),
        fc.uniqueArray(
          fc.integer({ min: 0, max: 20 }).map((n) => `m-${String(n).padStart(2, '0')}`),
          { minLength: 0, maxLength: 4 },
        ),
        changeKindArb,
        (organizerIds, memberIds, kind) => {
          const members: Membership[] = [
            ...organizerIds.map((userId) => ({ userId, role: 'organizer' as const })),
            ...memberIds.map((userId) => ({ userId, role: 'member' as const })),
          ];
          // Target one of the organizers: with >=2 organizers, demoting/
          // removing/leaving one still leaves at least one organizer.
          const change: MembershipChange = { kind, userId: organizerIds[0]! };
          expect(violatesLastOrganizer(members, change)).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('flags the sole Organizer departing while other Members remain (R5.2, R5.3, R5.4)', () => {
    fc.assert(
      fc.property(
        // One organizer plus one or more plain members.
        fc.uniqueArray(
          fc.integer({ min: 0, max: 20 }).map((n) => `m-${String(n).padStart(2, '0')}`),
          { minLength: 1, maxLength: 5 },
        ),
        changeKindArb,
        (memberIds, kind) => {
          const members: Membership[] = [
            { userId: 'sole-org', role: 'organizer' },
            ...memberIds.map((userId) => ({ userId, role: 'member' as const })),
          ];
          // Demote (R5.2), leave (R5.3), or remove (R5.4) of the sole organizer
          // strands the remaining members with no organizer: a violation.
          const change: MembershipChange = { kind, userId: 'sole-org' };
          expect(violatesLastOrganizer(members, change)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('never strands a non-empty Trip: after a permitted change an Organizer remains (R5.1)', () => {
    fc.assert(
      fc.property(
        membersArb.chain((members) =>
          changeArb(members).map((change) => ({ members, change })),
        ),
        ({ members, change }) => {
          if (violatesLastOrganizer(members, change)) return; // rejected changes are irrelevant here
          const next = applyChange(members, change);
          // A permitted change either empties the Trip or leaves an organizer.
          if (next.length > 0) {
            expect(next.some((m) => m.role === 'organizer')).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
