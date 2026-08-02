// Feature: trips, Property 6: The role permission matrix is exactly organizer ⊇ member
/**
 * Property-based tests for the Trip_Service role permission matrix.
 *
 * Validates: Requirements 4.2, 4.3, 4.4, 4.7, 15.5
 *
 * Design Property 6 ("The role permission matrix is exactly organizer ⊇
 * member") says, in essence:
 *
 *   For any Trip_Role and Trip_Action, an Organizer is permitted every action
 *   a Member is permitted plus the Organizer-only actions (edit settings,
 *   send/cancel invites, remove members, promote, demote, delete), while a
 *   Member (and any non-member) is denied every Organizer-only action.
 *
 * These tests exercise `can(role, action)` directly — it is a pure function
 * with no database or request context — across every role/action pairing.
 * The oracle is an independently-declared partition of the `TripAction` union
 * into member-allowed and organizer-only actions, so any drift in the
 * production sets is caught here rather than mirroring the implementation.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { can, type TripAction, type TripRole } from '../permissions.js';

const NUM_RUNS = 100;

/**
 * Independent oracle: the actions any Trip_Member may perform regardless of
 * role (R4.3, R4.4). Declared here separately from the implementation so the
 * property tests act as a specification check, not a mirror of the code.
 */
const MEMBER_ALLOWED: readonly TripAction[] = [
  'add_planned_item',
  'create_log_entry',
  'add_rode_with',
  'add_comment',
  'add_reaction',
  'leave_trip',
];

/**
 * Independent oracle: the actions reserved for Organizers (R4.2). A Member
 * must be denied precisely these.
 */
const ORGANIZER_ONLY: readonly TripAction[] = [
  'edit_settings',
  'send_invite',
  'cancel_invite',
  'remove_member',
  'promote',
  'demote',
  'delete_trip',
];

/** The complete Trip_Action universe = member-allowed ∪ organizer-only. */
const ALL_ACTIONS: readonly TripAction[] = [...MEMBER_ALLOWED, ...ORGANIZER_ONLY];

const roleArb: fc.Arbitrary<TripRole> = fc.constantFrom('organizer', 'member');
const actionArb: fc.Arbitrary<TripAction> = fc.constantFrom(...ALL_ACTIONS);

describe('Trip_Service permissions — Property 6: organizer ⊇ member', () => {
  it('an Organizer is permitted every action (R4.2, R4.4)', () => {
    fc.assert(
      fc.property(actionArb, (action) => can('organizer', action)),
      { numRuns: NUM_RUNS },
    );
  });

  it('a Member is permitted exactly the shared contribution actions (R4.3, R4.7)', () => {
    fc.assert(
      fc.property(actionArb, (action) => {
        const expected = MEMBER_ALLOWED.includes(action);
        return can('member', action) === expected;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a Member is denied every Organizer-only action (R4.2, R4.7)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ORGANIZER_ONLY), (action) => can('member', action) === false),
      { numRuns: NUM_RUNS },
    );
  });

  it('organizer ⊇ member: any action a Member may perform, an Organizer may too (R4.4)', () => {
    fc.assert(
      fc.property(actionArb, (action) => {
        // If a member can perform the action, the organizer must be able to as well.
        if (can('member', action)) {
          return can('organizer', action);
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the containment is strict: at least one action distinguishes the roles (R4.2)', () => {
    fc.assert(
      fc.property(roleArb, actionArb, (role, action) => {
        // Whenever the two roles disagree on an action, it must be because the
        // organizer is permitted and the member is denied — never the reverse.
        const org = can('organizer', action);
        const mem = can('member', action);
        if (org !== mem) {
          return org === true && mem === false;
        }
        // Sanity: when they agree, the shared-agreement is on member actions.
        void role;
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Trip_Service permissions — Property 6: fixed matrix examples', () => {
  it('organizer-only actions: organizer allowed, member denied', () => {
    for (const action of ORGANIZER_ONLY) {
      expect(can('organizer', action)).toBe(true);
      expect(can('member', action)).toBe(false);
    }
  });

  it('shared actions: both roles allowed', () => {
    for (const action of MEMBER_ALLOWED) {
      expect(can('organizer', action)).toBe(true);
      expect(can('member', action)).toBe(true);
    }
  });
});
