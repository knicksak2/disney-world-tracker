/**
 * Structural ports of the Dining Plan service (design.md "Party assembly" and "Multi-Stay Extension / Service, party
 * port and read path"). `composeServices.ts` wires them to the existing Trips, Trip Expenses and Trip Stays code, so
 * this module adds no `trip_memberships`, `users` or `profiles` read of its own, and tests substitute fakes.
 */

import type { StayRecord, TripGuestDTO, TripMemberDTO } from '@dwt/shared';

import type { TripRole } from '../trips/permissions.js';

/**
 * The Party sources: the Trips repo's `listMembers` (reads `active_trip_memberships`, so only active accounts), the
 * Trip Expenses repo's `listTripGuests`, and `findNonVisibleParties` to drop guests whose sponsor is leaving or gone.
 */
export interface DiningPlanPartyPort {
  listMembers(tripId: string): Promise<readonly TripMemberDTO[]>;
  listTripGuests(tripId: string): Promise<readonly TripGuestDTO[]>;
  findNonVisible(
    tripId: string,
    parties: { readonly userIds: readonly string[]; readonly guestIds: readonly string[] },
  ): Promise<{ readonly userIds: readonly string[]; readonly guestIds: readonly string[] }>;
}

/** The Trip's stored stays (trip-lodging-stays), wired to `selectTripStaysByTrip` of `trips/stays.ts`. */
export interface TripStaysPort {
  listStays(tripId: string): Promise<readonly StayRecord[]>;
}

/**
 * The caller's acting role on the Trip, wired to `assertTripMember` of `trips/authz.ts`, which answers `trip_forbidden`
 * alike for a non-member and an unknown Trip (never `effectiveRole`). Only the Budget export authorizes in the
 * service (Requirement 26.2); the other routes authorize in the route.
 */
export interface TripMembershipPort {
  roleOf(userId: string, tripId: string): Promise<TripRole>;
}
