import type { TripRole } from '@dwt/shared';

/**
 * R12.4: Only the adder of a Packing_Item or a Trip Organizer may edit,
 * reassign, or remove that item. A member who is neither the adder nor an
 * organizer is denied. A departed adder can never be `callerId`.
 */
export function canModifyPackingItem(role: TripRole, callerId: string, addedBy: string): boolean {
  return role === 'organizer' || callerId === addedBy;
}
