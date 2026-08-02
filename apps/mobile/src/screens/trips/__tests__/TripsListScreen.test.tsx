/**
 * Trips_List_Screen — screen tests (task 17.9).
 *
 * Validates: Requirements 16.6, 16.7, 16.8, 16.9
 *
 * These tests exercise the `Trips_List_Screen` end-to-end inside a real
 * `TripsStack` + `NavigationContainer` (mirroring `src/__tests__/navigation.test.tsx`)
 * so its `useFocusEffect`-driven refetch and cross-screen navigation run for
 * real. Only `apiRequest` is mocked; each test drives the `GET /me/trips`
 * response to reach one of the screen's states:
 *
 *   - loading indication while the read is in flight (R16.7),
 *   - error + Retry when the read fails (R16.8),
 *   - empty state + create control on a successful read of zero Trips (R16.9),
 *   - selecting a Trip navigates into its `Trip_Detail_View` (R16.6).
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
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

// Mock the API client: `apiRequest` is a `jest.fn` so each test supplies its
// own response. `ApiError` and the rest of the module are preserved.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import TripsStack from '../../../navigation/TripsStack';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { clearTripsListNotice } from '../../../navigation/tripsListNotice';
import type { TripDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const ACTIVE_TRIP: TripDTO = {
  id: 'trip-active-1',
  name: 'Spring Break at WDW',
  description: '',
  startDate: '2024-05-01',
  endDate: '2024-05-05',
  status: 'active',
  createdAt: '2024-04-01T12:00:00Z',
  resorts: [],
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderTripsStack(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer>
        <TripsStack />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Trips_List_Screen (R16.6, R16.7, R16.8, R16.9)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    clearTripsListNotice();
  });

  test('R16.7: shows a loading indication while the trips read is in flight', async () => {
    // A read that never settles keeps the query in its loading state.
    apiRequestMock.mockImplementation(
      () => new Promise(() => undefined) as Promise<never>,
    );

    renderTripsStack();

    expect(await screen.findByTestId('trips-loading')).toBeTruthy();
    // Neither a populated list, empty state, nor error is shown mid-flight.
    expect(screen.queryByTestId('trips-empty')).toBeNull();
    expect(screen.queryByTestId('trips-error')).toBeNull();
  });

  test('R16.8: a failed read shows an error indication with a Retry control that re-reads', async () => {
    apiRequestMock.mockRejectedValue(new Error('network down'));

    renderTripsStack();

    const retry = await screen.findByTestId('trips-retry');
    expect(screen.getByTestId('trips-error')).toBeTruthy();

    // The initial mount reads /me/trips once (focus refetch may add more).
    expect(apiRequestMock).toHaveBeenCalledWith(
      'GET',
      '/me/trips',
      undefined,
      expect.anything(),
    );

    // Tapping Retry re-issues the read.
    const callsBefore = apiRequestMock.mock.calls.length;
    fireEvent.press(retry);
    await waitFor(() => {
      expect(apiRequestMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  test('R16.9: a successful read of zero Trips shows the empty state with a create control', async () => {
    apiRequestMock.mockResolvedValue([]);

    renderTripsStack();

    expect(await screen.findByTestId('trips-empty')).toBeTruthy();
    // The empty state offers a create control (R16.9/R16.10).
    expect(screen.getByTestId('trips-empty-create')).toBeTruthy();
    expect(screen.queryByTestId('trips-error')).toBeNull();
  });

  test('R16.6: selecting a Trip navigates into its Trip_Detail_View', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/trips') {
        return [{ status: 'active', trips: [ACTIVE_TRIP] }];
      }
      if (path === `/trips/${ACTIVE_TRIP.id}`) {
        // Keep the detail screen in its loading state — reaching it is enough
        // to prove the navigation fired.
        return new Promise(() => undefined) as Promise<never>;
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderTripsStack();

    const row = await screen.findByTestId(`trips-trip-${ACTIVE_TRIP.id}`);
    fireEvent.press(row);

    // The Trip_Detail_View mounts for the tapped Trip (its loading testID
    // appears once its own read is in flight).
    await waitFor(() => {
      expect(screen.getByTestId('trip-detail-loading')).toBeTruthy();
    });
  });
});
