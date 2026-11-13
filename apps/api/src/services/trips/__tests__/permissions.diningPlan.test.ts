/**
 * Trip permission matrix with the Dining Plan actions (dining-plan-calculator task 4).
 *
 * `ROLE_OF` lists EVERY TripAction with the lowest role allowed to perform it. Its type is `Record<TripAction, ...>`,
 * so adding an action to the union without adding it here fails the typecheck: the "covers every action" check below
 * is exhaustive by construction rather than a hand-kept list.
 *
 * Validates: Requirement 16.2
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { can, type TripAction, type TripRole } from '../permissions.js';

const ROLE_OF: Readonly<Record<TripAction, 'member' | 'organizer'>> = {
  edit_settings: 'organizer',
  send_invite: 'organizer',
  cancel_invite: 'organizer',
  remove_member: 'organizer',
  promote: 'organizer',
  demote: 'organizer',
  delete_trip: 'organizer',
  edit_booking_settings: 'organizer',
  delete_any_trip_photo: 'organizer',
  edit_budget_settings: 'organizer',
  add_planned_item: 'member',
  edit_planned_item: 'member',
  set_day_park: 'member',
  optimize_day: 'member',
  create_log_entry: 'member',
  add_rode_with: 'member',
  add_comment: 'member',
  add_reaction: 'member',
  leave_trip: 'member',
  add_packing_item: 'member',
  toggle_packing_item: 'member',
  edit_packing_item: 'member',
  mark_booking_window_done: 'member',
  set_booking_reminder_mute: 'member',
  upload_trip_photo: 'member',
  post_feed_photo: 'member',
  share_trip_summary: 'member',
  view_budget: 'member',
  edit_budget: 'member',
  edit_budget_travelers: 'member',
  view_dining_plan: 'member',
  edit_dining_plan: 'member',
};
const ALL_ACTIONS = Object.keys(ROLE_OF) as TripAction[];

describe('Dining Plan permissions', () => {
  it('a member and an organizer may view and edit the dining plan', () => {
    for (const role of ['member', 'organizer'] as const) {
      expect(can(role, 'view_dining_plan')).toBe(true);
      expect(can(role, 'edit_dining_plan')).toBe(true);
    }
  });

  it('an unknown role value is denied both actions', () => {
    for (const role of ['guest', '', 'ORGANIZER', 'owner'] as unknown as TripRole[]) {
      expect(can(role, 'view_dining_plan')).toBe(false);
      expect(can(role, 'edit_dining_plan')).toBe(false);
    }
  });

  it('the member and organizer-only sets together cover every action: an organizer may perform each one', () => {
    for (const action of ALL_ACTIONS) expect(can('organizer', action)).toBe(true);
  });

  it('property: a member may perform exactly the member-level actions, and adding the dining actions changed no other', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ACTIONS), (action) => can('member', action) === (ROLE_OF[action] === 'member')),
      { numRuns: 100 },
    );
  });
});
