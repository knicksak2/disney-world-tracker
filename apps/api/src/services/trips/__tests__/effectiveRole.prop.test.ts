/**
 * Pure `effectiveRole` (account-deletion Requirement 7): the role a trip member acts with, derived from the roster
 * at request time. It equals the persisted role except for the Interim_Organizer.
 *
 * Feature: account-deletion, Property 10: Effective role equals persisted role except for the interim organizer
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.5, 7.6
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { can, effectiveRole, violatesLastOrganizer, type RosterMember, type TripRole } from '../permissions.js';

const T0 = Date.UTC(2026, 0, 1);

const rosterArb: fc.Arbitrary<RosterMember[]> = fc
  .array(
    fc.record({
      role: fc.constantFrom<TripRole>('organizer', 'member'),
      // Few distinct join times so ties (and the user-id tie-break) are common.
      joinedOffset: fc.integer({ min: 0, max: 3 }),
      active: fc.boolean(),
    }),
    { minLength: 0, maxLength: 8 },
  )
  .chain((rows) =>
    // Distinct user ids in shuffled id order, so id order and roster order differ.
    fc.shuffledSubarray(['u-a', 'u-b', 'u-c', 'u-d', 'u-e', 'u-f', 'u-g', 'u-h'], {
      minLength: rows.length,
      maxLength: rows.length,
    }).map((ids) =>
      rows.map((r, i) => ({
        userId: ids[i]!,
        role: r.role,
        joinedAt: new Date(T0 + r.joinedOffset * 1000),
        active: r.active,
      })),
    ),
  );

/** Independent oracle for the rule, written from the requirement text and not from the implementation. */
function oracle(members: readonly RosterMember[], userId: string): TripRole | null {
  const me = members.find((m) => m.userId === userId);
  if (!me) return null;
  const activeOrganizer = members.some((m) => m.role === 'organizer' && m.active);
  if (me.role !== 'member' || !me.active || activeOrganizer) return me.role;
  const actives = members.filter((m) => m.active);
  const first = [...actives].sort(
    (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  )[0]!;
  return first.userId === userId ? 'organizer' : 'member';
}

describe('effectiveRole examples', () => {
  const at = (s: number): Date => new Date(T0 + s * 1000);

  it('promotes the earliest-joined active member when the only organizer is pending', () => {
    const roster: RosterMember[] = [
      { userId: 'org', role: 'organizer', joinedAt: at(0), active: false },
      { userId: 'late', role: 'member', joinedAt: at(20), active: true },
      { userId: 'early', role: 'member', joinedAt: at(10), active: true },
    ];
    expect(effectiveRole(roster, 'early')).toBe('organizer');
    expect(effectiveRole(roster, 'late')).toBe('member');
    // The pending organizer keeps the persisted role; nothing is rewritten.
    expect(effectiveRole(roster, 'org')).toBe('organizer');
    expect(roster[1]!.role).toBe('member');
  });

  it('breaks a joined-at tie with the lowest user id', () => {
    const roster: RosterMember[] = [
      { userId: 'org', role: 'organizer', joinedAt: at(0), active: false },
      { userId: 'b', role: 'member', joinedAt: at(5), active: true },
      { userId: 'a', role: 'member', joinedAt: at(5), active: true },
    ];
    expect(effectiveRole(roster, 'a')).toBe('organizer');
    expect(effectiveRole(roster, 'b')).toBe('member');
  });

  it('skips a pending member when picking the interim organizer', () => {
    const roster: RosterMember[] = [
      { userId: 'org', role: 'organizer', joinedAt: at(0), active: false },
      { userId: 'pending-member', role: 'member', joinedAt: at(1), active: false },
      { userId: 'active-member', role: 'member', joinedAt: at(9), active: true },
    ];
    expect(effectiveRole(roster, 'active-member')).toBe('organizer');
    expect(effectiveRole(roster, 'pending-member')).toBe('member');
  });

  it('a trip with no active member has no interim organizer', () => {
    const roster: RosterMember[] = [
      { userId: 'org', role: 'organizer', joinedAt: at(0), active: false },
      { userId: 'm', role: 'member', joinedAt: at(1), active: false },
    ];
    expect(effectiveRole(roster, 'm')).toBe('member');
  });

  it('leaves a member alone while an active organizer exists', () => {
    const roster: RosterMember[] = [
      { userId: 'org', role: 'organizer', joinedAt: at(5), active: true },
      { userId: 'm', role: 'member', joinedAt: at(1), active: true },
    ];
    expect(effectiveRole(roster, 'm')).toBe('member');
  });

  it('an interim organizer is authorized for organizer-only actions through the unchanged matrix (R7.6)', () => {
    const roster: RosterMember[] = [
      { userId: 'org', role: 'organizer', joinedAt: at(0), active: false },
      { userId: 'm', role: 'member', joinedAt: at(1), active: true },
    ];
    const role = effectiveRole(roster, 'm')!;
    expect(can(role, 'edit_settings')).toBe(true);
    expect(can(role, 'delete_trip')).toBe(true);
    expect(can('member', 'edit_settings')).toBe(false);
  });

  it('the Last_Organizer_Rule still runs over the persisted rows, where a pending organizer counts (R7.3)', () => {
    const persisted = [
      { userId: 'org', role: 'organizer' as const },
      { userId: 'm', role: 'member' as const },
    ];
    expect(violatesLastOrganizer(persisted, { kind: 'demote', userId: 'org' })).toBe(true);
  });
});

describe('effectiveRole properties', () => {
  // Feature: account-deletion, Property 10: Effective role equals persisted role except for the interim organizer
  it('equals the persisted role except for the interim organizer; null for a non-member', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        for (const m of roster) {
          expect(effectiveRole(roster, m.userId)).toBe(oracle(roster, m.userId));
          const persisted = m.role;
          const eff = effectiveRole(roster, m.userId);
          if (eff !== persisted) {
            // The only permitted difference is member -> organizer, for an active member of a trip with no active organizer.
            expect(persisted).toBe('member');
            expect(eff).toBe('organizer');
            expect(m.active).toBe(true);
            expect(roster.some((r) => r.role === 'organizer' && r.active)).toBe(false);
          }
        }
        expect(effectiveRole(roster, 'u-not-on-roster')).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  // Feature: account-deletion, Property 10: Effective role equals persisted role except for the interim organizer
  it('never lifts a member to organizer while an active organizer exists, and at most one member is lifted', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        const lifted = roster.filter((m) => m.role === 'member' && effectiveRole(roster, m.userId) === 'organizer');
        if (roster.some((m) => m.role === 'organizer' && m.active)) {
          expect(lifted).toHaveLength(0);
        } else {
          expect(lifted.length).toBeLessThanOrEqual(1);
          // Whenever any active member exists on a trip without an active organizer, exactly one is lifted.
          const anyActiveMember = roster.some((m) => m.role === 'member' && m.active);
          expect(lifted).toHaveLength(anyActiveMember ? 1 : 0);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: account-deletion, Property 10: Effective role equals persisted role except for the interim organizer
  it('is idempotent, independent of roster order, and does not mutate the roster', () => {
    fc.assert(
      fc.property(rosterArb, fc.integer({ min: 0, max: 1000 }), (roster, seed) => {
        const before = JSON.stringify(roster);
        const reversed = [...roster].reverse();
        const rotated = roster.length === 0 ? [] : [...roster.slice(seed % roster.length), ...roster.slice(0, seed % roster.length)];
        for (const m of roster) {
          const first = effectiveRole(roster, m.userId);
          expect(effectiveRole(roster, m.userId)).toBe(first);
          expect(effectiveRole(reversed, m.userId)).toBe(first);
          expect(effectiveRole(rotated, m.userId)).toBe(first);
        }
        expect(JSON.stringify(roster)).toBe(before);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: account-deletion, Property 10: Effective role equals persisted role except for the interim organizer
  it('restoring the pending organizers returns every effective role to the persisted role, with no other action', () => {
    fc.assert(
      fc.property(rosterArb, (roster) => {
        const restored = roster.map((m) => (m.role === 'organizer' ? { ...m, active: true } : m));
        if (!restored.some((m) => m.role === 'organizer')) return; // no organizer on the roster: nothing to restore
        for (const m of restored) {
          expect(effectiveRole(restored, m.userId)).toBe(m.role);
        }
      }),
      { numRuns: 200 },
    );
  });
});
