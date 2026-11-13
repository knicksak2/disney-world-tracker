/**
 * Client function and mutation hook for a Trip's lodging Stays (trip-lodging-stays task 8.1).
 *
 * `PUT /trips/:id/stays` replaces the whole list and answers `{ stays, stayWarnings }`. On success the hook writes
 * both fields into the cached Trip (the detail key and every Trip in the list key), then invalidates:
 *   - the booking timeline, which is derived from the Stays (R9.1);
 *   - the Trip detail and list, because the server also rewrote `TripDTO.resorts` from the Stays (R4.1) and the
 *     response does not carry it.
 *
 * Validates: Requirements 5.1, 5.2, 9.7
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TripDTO, TripStatus, TripStayDTO, TripStayInput, TripStayWarningDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { bookingKeys } from './bookingTimelineApi';
import { tripDetailKeys } from './tripDetailQueryKeys';
import { tripsListKeys } from './TripsListScreen';

/** One group of the cached `GET /me/trips` list (declared locally, as each screen that reads it does). */
interface TripStatusGroup {
  readonly status: TripStatus;
  readonly trips: readonly TripDTO[];
}

/** Wire shape of `PUT /trips/:id/stays`. */
export interface TripStaysResponse {
  readonly stays: readonly TripStayDTO[];
  readonly stayWarnings: readonly TripStayWarningDTO[];
}

export async function putTripStays(
  tripId: string,
  stays: readonly TripStayInput[],
): Promise<TripStaysResponse> {
  return apiRequest<TripStaysResponse>('PUT', `/trips/${tripId}/stays`, { stays });
}

/** The cached Trip with the new Stays and warnings; any other field is left as it was. */
export function withStays(trip: TripDTO, res: TripStaysResponse): TripDTO {
  return { ...trip, stays: res.stays, stayWarnings: res.stayWarnings };
}

export function useReplaceTripStays(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation<TripStaysResponse, ApiError, readonly TripStayInput[]>({
    mutationFn: (stays) => putTripStays(tripId, stays),
    onSuccess: (res) => {
      queryClient.setQueryData<TripDTO>(tripDetailKeys.detail(tripId), (old) =>
        old ? withStays(old, res) : old,
      );
      queryClient.setQueryData<readonly TripStatusGroup[]>(tripsListKeys.list(), (old) =>
        old?.map((group) => ({
          ...group,
          trips: group.trips.map((t) => (t.id === tripId ? withStays(t, res) : t)),
        })),
      );
      void queryClient.invalidateQueries({ queryKey: bookingKeys.timeline(tripId) });
      void queryClient.invalidateQueries({ queryKey: tripDetailKeys.detail(tripId) });
      void queryClient.invalidateQueries({ queryKey: tripsListKeys.list() });
    },
  });
}
