// Feature: trip-budget, Property 24: Role-based authorization matrix
/**
 * Property 24 (matrix half):
 * Validates the extended Trip authorization matrix with Trip Budget actions:
 * - organizer may perform every action (member actions + organizer-only actions).
 * - member may perform member actions (including view_budget, edit_budget, edit_budget_travelers)
 *   and is denied organizer-only actions (including edit_budget_settings).
 * - can() evaluates cleanly over every action in the extended TripAction union.
 *
 * Validates: Requirements 18.1
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { can, type TripAction, type TripRole } from '../permissions.js';

const BUDGET_MEMBER_ACTIONS: readonly TripAction[] = [
  'view_budget',
  'edit_budget',
  'edit_budget_travelers',
];

const BUDGET_ORGANIZER_ONLY_ACTIONS: readonly TripAction[] = [
  'edit_budget_settings',
];

const ALL_MEMBER_ACTIONS: readonly TripAction[] = [
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
  ...BUDGET_MEMBER_ACTIONS,
];

const ALL_ORGANIZER_ONLY_ACTIONS: readonly TripAction[] = [
  'edit_settings',
  'send_invite',
  'cancel_invite',
  'remove_member',
  'promote',
  'demote',
  'delete_trip',
  'edit_booking_settings',
  'delete_any_trip_photo',
  ...BUDGET_ORGANIZER_ONLY_ACTIONS,
];

const EXTENDED_ACTIONS: readonly TripAction[] = [
  ...ALL_MEMBER_ACTIONS,
  ...ALL_ORGANIZER_ONLY_ACTIONS,
];

describe('Trip Budget Permissions (Property 24 matrix half)', () => {
  it('organizer is permitted all budget actions', () => {
    for (const action of [...BUDGET_MEMBER_ACTIONS, ...BUDGET_ORGANIZER_ONLY_ACTIONS]) {
      expect(can('organizer', action)).toBe(true);
    }
  });

  it('member is permitted view_budget, edit_budget, and edit_budget_travelers', () => {
    for (const action of BUDGET_MEMBER_ACTIONS) {
      expect(can('member', action)).toBe(true);
    }
  });

  it('member is denied edit_budget_settings', () => {
    for (const action of BUDGET_ORGANIZER_ONLY_ACTIONS) {
      expect(can('member', action)).toBe(false);
    }
  });

  it('property: organizer is permitted every action across the extended union', () => {
    fc.assert(
      fc.property(fc.constantFrom(...EXTENDED_ACTIONS), (action) => {
        return can('organizer', action) === true;
      }),
      { numRuns: 100 },
    );
  });

  it('property: member is permitted exactly the member-allowed actions across the extended union', () => {
    fc.assert(
      fc.property(fc.constantFrom(...EXTENDED_ACTIONS), (action) => {
        const expected = ALL_MEMBER_ACTIONS.includes(action);
        return can('member', action) === expected;
      }),
      { numRuns: 100 },
    );
  });

  it('property: organizer ⊇ member holds across the extended union', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TripRole>('organizer', 'member'),
        fc.constantFrom(...EXTENDED_ACTIONS),
        (role, action) => {
          if (can('member', action)) {
            expect(can('organizer', action)).toBe(true);
          }
          return typeof can(role, action) === 'boolean';
        },
      ),
      { numRuns: 100 },
    );
  });
});

