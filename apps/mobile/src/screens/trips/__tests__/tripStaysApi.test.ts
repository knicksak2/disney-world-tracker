/**
 * Tests for the Trip Stays client function and mutation hook (trip-lodging-stays task 8.1). Only the network layer
 * (`apiRequest`) is mocked; the hook runs against a real QueryClient whose cache is read back.
 *
 * Validates: Requirements 5.1, 5.2, 9.7
 */

import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { TripDTO, TripStayDTO, TripStayInput } from '@dwt/shared';

import { ApiError, apiRequest } from '../../../api/client';
import { bookingKeys } from '../bookingTimelineApi';
import { tripDetailKeys } from '../tripDetailQueryKeys';
import { putTripStays, useReplaceTripStays } from '../tripStaysApi';
import { tripsListKeys } from '../TripsListScreen';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, apiRequest: jest.fn() };
});

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

const TRIP_ID = 'trip-1';
const OTHER_ID = 'trip-2';
const BEACH = '11111111-1111-4111-8111-111111111111';

function trip(id: string): TripDTO {
  return {
    id,
    name: id,
    description: '',
    startDate: '2027-12-15',
    endDate: '2027-12-31',
    status: 'upcoming',
    createdAt: '2027-01-01T00:00:00.000Z',
    resorts: [],
    foodLists: [],
    experienceLists: [],
    stays: [],
    stayWarnings: [],
  };
}

const BODY: TripStayInput[] = [
  { lodgingKind: 'resort', resortId: BEACH, checkIn: '2027-12-15', checkOut: '2027-12-20' },
  { lodgingKind: 'offsite', placeName: 'Aunt May', checkIn: '2027-12-22', checkOut: '2027-12-31', partyKeys: ['m:abc'] },
];

const SAVED_STAY: TripStayDTO = {
  id: 'stay-1',
  position: 0,
  lodgingKind: 'resort',
  resortId: BEACH,
  placeName: null,
  displayName: 'Beach Club',
  checkIn: '2027-12-15',
  checkOut: '2027-12-20',
  nights: 5,
  partyKeys: null,
};
const RESPONSE = {
  stays: [SAVED_STAY],
  stayWarnings: [{ code: 'gap' as const, from: '2027-12-20', to: '2027-12-22' }],
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

describe('tripStaysApi', () => {
  beforeEach(() => jest.clearAllMocks());

  it('putTripStays sends PUT /trips/:id/stays with the list under `stays`', async () => {
    mockApiRequest.mockResolvedValueOnce(RESPONSE);
    const res = await putTripStays(TRIP_ID, BODY);
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).toHaveBeenCalledWith('PUT', `/trips/${TRIP_ID}/stays`, { stays: BODY });
    expect(res).toEqual(RESPONSE);
  });

  it('useReplaceTripStays writes stays and warnings into the detail and list caches and invalidates the timeline', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(tripDetailKeys.detail(TRIP_ID), trip(TRIP_ID));
    queryClient.setQueryData(tripsListKeys.list(), [
      { status: 'upcoming', trips: [trip(TRIP_ID), trip(OTHER_ID)] },
    ]);
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    mockApiRequest.mockResolvedValueOnce(RESPONSE);

    const { result } = renderHook(() => useReplaceTripStays(TRIP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(BODY);
    });

    expect(mockApiRequest).toHaveBeenCalledWith('PUT', `/trips/${TRIP_ID}/stays`, { stays: BODY });
    const detail = queryClient.getQueryData<TripDTO>(tripDetailKeys.detail(TRIP_ID));
    expect(detail?.stays).toEqual([SAVED_STAY]);
    expect(detail?.stayWarnings).toEqual(RESPONSE.stayWarnings);
    expect(detail?.name).toBe(TRIP_ID); // other fields untouched

    const list = queryClient.getQueryData<{ trips: TripDTO[] }[]>(tripsListKeys.list());
    expect(list?.[0]?.trips.find((t) => t.id === TRIP_ID)?.stays).toEqual([SAVED_STAY]);
    expect(list?.[0]?.trips.find((t) => t.id === OTHER_ID)?.stays).toEqual([]); // another Trip is not touched

    expect(invalidate).toHaveBeenCalledWith({ queryKey: bookingKeys.timeline(TRIP_ID) });
    // trip_resorts was rewritten server-side, so the Trip itself is refetched for `resorts`.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: tripDetailKeys.detail(TRIP_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: tripsListKeys.list() });
  });

  it('a failed save leaves the caches untouched and invalidates nothing', async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(tripDetailKeys.detail(TRIP_ID), trip(TRIP_ID));
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    mockApiRequest.mockRejectedValueOnce(
      new ApiError({ code: 'trip_validation_failed', message: 'x', status: 400, field: 'stays[1]' }),
    );

    const { result } = renderHook(() => useReplaceTripStays(TRIP_ID), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(BODY)).rejects.toBeInstanceOf(ApiError);
    });

    expect(queryClient.getQueryData<TripDTO>(tripDetailKeys.detail(TRIP_ID))?.stays).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
