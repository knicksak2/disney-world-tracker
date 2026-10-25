/**
 * Component tests for TripDayParksSection (task 25.7).
 *
 * Validates: Requirements 24.8
 *
 * Covers:
 *  - render a 3-day trip and assert one row per date;
 *  - tap a row → picker opens → choose EPCOT → assert the PUT URL contains the right date
 *    and the body is {park:'EPCOT'} and the row now reads EPCOT;
 *  - choose "No park yet" → body is {park:null} and the row reads "Choose park";
 *  - make the PUT reject → the row reverts and the error message is shown;
 *  - assert the accessibility label contains the date and park;
 *  - a trip with no Day_Parks renders three "Choose park" rows.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { TripDTO } from '@dwt/shared';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

import TripDayParksSection from '../TripDayParksSection';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import { tripDetailKeys } from '../tripDetailQueryKeys';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const TRIP_ID = '11111111-1111-4111-8111-111111111111';

function createMockTrip(overrides: Partial<TripDTO> = {}): TripDTO {
  return {
    id: TRIP_ID,
    name: 'Family Vacation',
    description: '',
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    status: 'upcoming',
    createdAt: '2026-01-01T00:00:00.000Z',
    resorts: [],
    foodLists: [],
    experienceLists: [],
    dayTouringHours: {},
    ...overrides,
  };
}

function renderSection(trip: TripDTO, queryClient?: QueryClient) {
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

  client.setQueryData(tripDetailKeys.detail(trip.id), trip);

  return render(
    <QueryClientProvider client={client}>
      <TripDayParksSection
        tripId={trip.id}
        startDate={trip.startDate}
        endDate={trip.endDate}
        dayTouringHours={trip.dayTouringHours}
      />
    </QueryClientProvider>,
  );
}

describe('TripDayParksSection (R24.8, Task 25.7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders a 3-day trip and asserts one row per date', () => {
    const trip = createMockTrip();
    renderSection(trip);

    expect(screen.getByTestId('day-park-row-2026-10-01')).toBeTruthy();
    expect(screen.getByTestId('day-park-row-2026-10-02')).toBeTruthy();
    expect(screen.getByTestId('day-park-row-2026-10-03')).toBeTruthy();
  });

  it('a trip with no Day_Parks renders three "Choose park" rows', () => {
    const trip = createMockTrip({ dayTouringHours: {} });
    renderSection(trip);

    expect(screen.getByTestId('day-park-label-2026-10-01')).toHaveTextContent('Choose park');
    expect(screen.getByTestId('day-park-label-2026-10-02')).toHaveTextContent('Choose park');
    expect(screen.getByTestId('day-park-label-2026-10-03')).toHaveTextContent('Choose park');
  });

  it('tap a row → picker opens → choose EPCOT → assert PUT URL/body and row now reads EPCOT', async () => {
    const trip = createMockTrip();
    apiRequestMock.mockResolvedValueOnce({
      ...trip,
      dayTouringHours: {
        '2026-10-01': { startingPark: 'EPCOT' },
      },
    });

    renderSection(trip);

    // Initial label
    expect(screen.getByTestId('day-park-label-2026-10-01')).toHaveTextContent('Choose park');

    // Tap row to open picker
    fireEvent.press(screen.getByTestId('day-park-row-2026-10-01'));

    // Choose EPCOT
    const epcotOption = await screen.findByTestId('day-park-picker-option-EPCOT');
    fireEvent.press(epcotOption);

    // Assert PUT request
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PUT',
        `/trips/${TRIP_ID}/days/2026-10-01/park`,
        { park: 'EPCOT' },
      );
    });

    // Assert row now reads EPCOT
    await waitFor(() => {
      expect(screen.getByTestId('day-park-label-2026-10-01')).toHaveTextContent('EPCOT');
    });
  });

  it('choose "No park yet" → body is {park:null} and the row reads "Choose park"', async () => {
    const trip = createMockTrip({
      dayTouringHours: {
        '2026-10-01': { startingPark: 'EPCOT' },
      },
    });

    apiRequestMock.mockResolvedValueOnce({
      ...trip,
      dayTouringHours: {},
    });

    renderSection(trip);

    // Starts with EPCOT
    expect(screen.getByTestId('day-park-label-2026-10-01')).toHaveTextContent('EPCOT');

    // Open picker
    fireEvent.press(screen.getByTestId('day-park-row-2026-10-01'));

    // Choose "No park yet"
    const noneOption = await screen.findByTestId('day-park-picker-option-none');
    fireEvent.press(noneOption);

    // Assert PUT request
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PUT',
        `/trips/${TRIP_ID}/days/2026-10-01/park`,
        { park: null },
      );
    });

    // Row reverts to "Choose park"
    await waitFor(() => {
      expect(screen.getByTestId('day-park-label-2026-10-01')).toHaveTextContent('Choose park');
    });
  });

  it('make the PUT reject → the row reverts and the error message is shown', async () => {
    const trip = createMockTrip({
      dayTouringHours: {
        '2026-10-01': { startingPark: 'Magic Kingdom' },
      },
    });

    apiRequestMock.mockRejectedValueOnce(
      new ApiError({
        status: 500,
        code: 'trip_validation_failed',
        message: 'Failed to update day park',
      }),
    );

    renderSection(trip);

    // Initially Magic Kingdom
    expect(screen.getByTestId('day-park-label-2026-10-01')).toHaveTextContent('Magic Kingdom');

    // Tap and choose EPCOT
    fireEvent.press(screen.getByTestId('day-park-row-2026-10-01'));
    const epcotOption = await screen.findByTestId('day-park-picker-option-EPCOT');
    fireEvent.press(epcotOption);

    // Error is shown
    await waitFor(() => {
      expect(screen.getByTestId('day-park-error')).toHaveTextContent('Failed to update day park');
    });

    // Row reverted to Magic Kingdom
    expect(screen.getByTestId('day-park-label-2026-10-01')).toHaveTextContent('Magic Kingdom');
  });

  it('assert the accessibility label contains the date and park', () => {
    const trip = createMockTrip({
      dayTouringHours: {
        '2026-10-01': { startingPark: 'EPCOT' },
      },
    });

    renderSection(trip);

    const row1 = screen.getByTestId('day-park-row-2026-10-01');
    expect(row1.props.accessibilityLabel).toContain('2026-10-01');
    expect(row1.props.accessibilityLabel).toContain('EPCOT');

    const row2 = screen.getByTestId('day-park-row-2026-10-02');
    expect(row2.props.accessibilityLabel).toContain('2026-10-02');
    expect(row2.props.accessibilityLabel).toContain('Choose park');
  });

  it('filters out past dates on active trips and preserves 1-based day index from trip start', () => {
    // Current time is 2026-05-01; trip spans 2026-04-29 to 2026-05-03 (Day 1: 04-29, Day 2: 04-30, Day 3: 05-01)
    const trip = createMockTrip({
      startDate: '2026-04-29',
      endDate: '2026-05-03',
      dayTouringHours: {
        '2026-05-01': { startingPark: 'EPCOT' },
      },
    });

    renderSection(trip);

    // Past dates (04-29 and 04-30) should NOT be rendered
    expect(screen.queryByTestId('day-park-row-2026-04-29')).toBeNull();
    expect(screen.queryByTestId('day-park-row-2026-04-30')).toBeNull();

    // Today (05-01) and future dates (05-02, 05-03) are rendered
    expect(screen.getByTestId('day-park-row-2026-05-01')).toBeTruthy();
    expect(screen.getByTestId('day-park-row-2026-05-02')).toBeTruthy();
    expect(screen.getByTestId('day-park-row-2026-05-03')).toBeTruthy();

    // Today (05-01) is Day 3 of the trip
    expect(screen.getByText('DAY 3')).toBeTruthy();
    expect(screen.getByText('DAY 4')).toBeTruthy();
    expect(screen.getByText('DAY 5')).toBeTruthy();

    // Header displays 1 of 3 planned (for the remaining 3 days)
    expect(screen.getByText('1 of 3 planned')).toBeTruthy();
  });

  it('omits the Days section entirely when all dates of the trip are in the past', () => {
    // Current time is 2026-05-01; trip ended on 2026-04-20
    const trip = createMockTrip({
      startDate: '2026-04-10',
      endDate: '2026-04-20',
    });

    renderSection(trip);

    expect(screen.queryByTestId('trip-day-parks-section')).toBeNull();
  });
});

