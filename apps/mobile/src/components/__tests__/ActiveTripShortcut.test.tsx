/**
 * Active_Trip_Shortcut — component tests (task 17.9).
 *
 * Validates: Requirements 19.1, 19.4
 *
 * The Active_Trip_Shortcut reads `GET /me/trips` and surfaces one-tap access to
 * the User's currently-`active` Trip(s) on surfaces outside the Trips tab:
 *
 *   - WHILE the User is a Member of >= 1 `active` Trip the shortcut is shown
 *     (R19.1); with none (or while loading/erroring) it renders nothing (R19.3).
 *   - Activating with exactly one active Trip opens it directly (R19.2); with
 *     more than one it opens a chooser and a selection opens the chosen Trip
 *     (R19.4, R19.5).
 *   - On activation it re-reads `/me/trips` and, if the target is no longer
 *     active or the User is no longer a Member, falls back to the Trips list
 *     with a "no longer available" message (R19.6).
 *
 * `apiRequest`, the `navigationRef` helpers, and the Trips-list notice store
 * are mocked so we can drive the read and assert the exact navigation.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockNavigateToTripDetail = jest.fn();
const mockNavigateToTripsList = jest.fn();

jest.mock('../../navigation/navigationRef', () => ({
  __esModule: true,
  navigateToTripDetail: (...args: unknown[]) =>
    mockNavigateToTripDetail(...args),
  navigateToTripsList: (...args: unknown[]) => mockNavigateToTripsList(...args),
}));

const mockSetTripsListNotice = jest.fn();

jest.mock('../../navigation/tripsListNotice', () => ({
  __esModule: true,
  setTripsListNotice: (...args: unknown[]) => mockSetTripsListNotice(...args),
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import ActiveTripShortcut from '../ActiveTripShortcut';
import { apiRequest as mockedApiRequest } from '../../api/client';
import type { TripDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

function activeTrip(id: string, name: string): TripDTO {
  return {
    id,
    name,
    description: '',
    startDate: '2024-05-01',
    endDate: '2024-05-05',
    status: 'active',
    createdAt: '2024-04-01T12:00:00Z',
    resorts: [],
  };
}

const TRIP_A = activeTrip('trip-a', 'Magic Kingdom Day');
const TRIP_B = activeTrip('trip-b', 'Epcot Day');

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderShortcut(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ActiveTripShortcut />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Active_Trip_Shortcut (R19.1, R19.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    mockNavigateToTripDetail.mockReset();
    mockNavigateToTripsList.mockReset();
    mockSetTripsListNotice.mockReset();
  });

  test('R19.3: renders nothing when the User has no active Trips', async () => {
    apiRequestMock.mockResolvedValue([]);

    renderShortcut();

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', '/me/trips');
    });
    expect(screen.queryByTestId('active-trip-shortcut')).toBeNull();
  });

  test('R19.1 + R19.2: with exactly one active Trip the shortcut is shown and opens it directly', async () => {
    apiRequestMock.mockResolvedValue([{ status: 'active', trips: [TRIP_A] }]);

    renderShortcut();

    const shortcut = await screen.findByTestId('active-trip-shortcut');
    expect(shortcut).toBeTruthy();

    fireEvent.press(shortcut);

    await waitFor(() => {
      expect(mockNavigateToTripDetail).toHaveBeenCalledWith({
        tripId: TRIP_A.id,
      });
    });
    // Single active Trip opens directly — no chooser.
    expect(screen.queryByTestId('active-trip-chooser')).toBeNull();
  });

  test('R19.4 + R19.5: with more than one active Trip a chooser opens and a selection opens the chosen Trip', async () => {
    apiRequestMock.mockResolvedValue([
      { status: 'active', trips: [TRIP_A, TRIP_B] },
    ]);

    renderShortcut();

    const shortcut = await screen.findByTestId('active-trip-shortcut');
    fireEvent.press(shortcut);

    // R19.4: the chooser is presented rather than opening a Trip directly.
    const chooser = await screen.findByTestId('active-trip-chooser');
    expect(chooser).toBeTruthy();
    expect(mockNavigateToTripDetail).not.toHaveBeenCalled();

    // R19.5: selecting one opens that Trip.
    fireEvent.press(screen.getByTestId(`active-trip-chooser-${TRIP_B.id}`));

    await waitFor(() => {
      expect(mockNavigateToTripDetail).toHaveBeenCalledWith({
        tripId: TRIP_B.id,
      });
    });
  });

  test('R19.6: a stale target falls back to the Trips list with a "no longer available" message', async () => {
    // Initial read: one active Trip (shortcut shows). Re-read on activation:
    // the Trip is no longer active, so the target is stale.
    apiRequestMock
      .mockResolvedValueOnce([{ status: 'active', trips: [TRIP_A] }])
      .mockResolvedValueOnce([]);

    renderShortcut();

    const shortcut = await screen.findByTestId('active-trip-shortcut');
    fireEvent.press(shortcut);

    await waitFor(() => {
      expect(mockNavigateToTripsList).toHaveBeenCalled();
    });
    // The fallback surfaces a message on the Trips list and never opens the
    // stale Trip.
    expect(mockSetTripsListNotice).toHaveBeenCalledWith(expect.any(String));
    expect(mockNavigateToTripDetail).not.toHaveBeenCalled();
  });
});
