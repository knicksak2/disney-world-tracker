import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { canModifyPackingItem } from '../packingAuth.js';
import type { TripRole } from '@dwt/shared';

describe('packingAuth.prop.test.ts', () => {
  // Feature: trip-booking-timeline, Property 35: Only the adder or an Organizer may edit, reassign, or remove a Packing_Item
  it('Property 35: Only the adder or an Organizer may edit, reassign, or remove a Packing_Item', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TripRole>('organizer', 'member'),
        fc.uuid(),
        fc.uuid(),
        (role, callerId, addedBy) => {
          const allowed = canModifyPackingItem(role, callerId, addedBy);
          const expected = role === 'organizer' || callerId === addedBy;
          expect(allowed).toBe(expected);

          // If role is member and callerId != addedBy, always false
          if (role === 'member' && callerId !== addedBy) {
            expect(allowed).toBe(false);
          }

          // If role is organizer, always true
          if (role === 'organizer') {
            expect(allowed).toBe(true);
          }

          // If caller is the adder, always true regardless of role
          if (callerId === addedBy) {
            expect(canModifyPackingItem('member', callerId, callerId)).toBe(true);
          }

          // When adder has left the trip (callerId is never addedBy):
          // only organizer passes
          const departedAdderId = 'departed-user-id';
          const activeMemberCallerId = 'active-member-id';
          expect(canModifyPackingItem('member', activeMemberCallerId, departedAdderId)).toBe(false);
          expect(canModifyPackingItem('organizer', activeMemberCallerId, departedAdderId)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
