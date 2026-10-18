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

import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import TripsStack from '../../../navigation/TripsStack';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { clearTripsListNotice } from '../../../navigation/tripsListNotice';
import type { TripDTO } from '@dwt/shared';
import { darkTheme } from '../../../theme/theme';
import { ScreenContainer } from '../../../theme/components';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { TRIP_ROW } from '../TripsListScreen.palette';

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
  foodLists: [],
  experienceLists: [],
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

  test('R16.9/R16.10: opens create modal, allows entering trip name, and dismisses via close button', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/trips') return [];
      if (path === '/resorts') return { resorts: [] };
      return [];
    });

    renderTripsStack();

    const createBtn = await screen.findByTestId('trips-empty-create');
    fireEvent.press(createBtn);

    const modal = await screen.findByTestId('trips-create-modal');
    expect(modal).toBeTruthy();

    const nameInput = screen.getByTestId('trips-create-name');
    expect(nameInput).toBeTruthy();
    fireEvent.changeText(nameInput, 'Family Disney Trip');
    expect(nameInput.props.value).toBe('Family Disney Trip');

    const closeBtn = screen.getByTestId('trips-create-close');
    fireEvent.press(closeBtn);

    // Modal is dismissed
    expect(screen.queryByTestId('trips-create-name')).toBeNull();
  });

  test('R16.9/R16.10: opens create modal and dismisses via cancel button', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/trips') return [];
      if (path === '/resorts') return { resorts: [] };
      return [];
    });

    renderTripsStack();

    const createBtn = await screen.findByTestId('trips-empty-create');
    fireEvent.press(createBtn);

    expect(await screen.findByTestId('trips-create-modal')).toBeTruthy();

    const cancelBtn = screen.getByTestId('trips-create-cancel');
    fireEvent.press(cancelBtn);

    expect(screen.queryByTestId('trips-create-name')).toBeNull();
  });

  test('R16.9/R16.10: enters trip details and submits POST /me/trips', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/trips' && method === 'GET') return [];
      if (path === '/resorts') return { resorts: [] };
      if (path === '/me/trips' && method === 'POST') {
        return { id: 'created-trip-42' };
      }
      if (path === '/trips/created-trip-42') {
        return new Promise(() => undefined) as Promise<never>;
      }
      return [];
    });

    renderTripsStack();

    fireEvent.press(await screen.findByTestId('trips-empty-create'));

    const nameInput = await screen.findByTestId('trips-create-name');
    fireEvent.changeText(nameInput, 'Summer Fun Trip');

    const descInput = screen.getByTestId('trips-create-description');
    fireEvent.changeText(descInput, 'Visiting all four parks');

    // Pick start date via calendar
    fireEvent.press(screen.getByTestId('trips-create-start'));
    fireEvent.press(screen.getByText('10'));

    // Pick end date via calendar
    fireEvent.press(screen.getByTestId('trips-create-end'));
    fireEvent.press(screen.getByText('15'));

    fireEvent.press(screen.getByTestId('trips-create-submit'));

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const expectedStart = `${y}-${m}-10`;
    const expectedEnd = `${y}-${m}-15`;

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/trips',
        {
          name: 'Summer Fun Trip',
          description: 'Visiting all four parks',
          startDate: expectedStart,
          endDate: expectedEnd,
        },
      );
    });
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

  test('renders countdown badge for upcoming trips and status badges for active and completed trips', async () => {
    const upcomingTrip: TripDTO = {
      id: 'trip-upcoming-1',
      name: 'Summer Vacation',
      description: '',
      startDate: '2099-07-01',
      endDate: '2099-07-10',
      status: 'upcoming',
      createdAt: '2024-04-01T12:00:00Z',
      resorts: [],
      foodLists: [],
      experienceLists: [],
    };
    const pastTrip: TripDTO = {
      id: 'trip-past-1',
      name: 'Winter Holiday',
      description: '',
      startDate: '2020-01-01',
      endDate: '2020-01-05',
      status: 'past',
      createdAt: '2020-01-01T12:00:00Z',
      resorts: [],
      foodLists: [],
      experienceLists: [],
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/trips') {
        return [
          { status: 'active', trips: [ACTIVE_TRIP] },
          { status: 'upcoming', trips: [upcomingTrip] },
          { status: 'past', trips: [pastTrip] },
        ];
      }
      if (path === '/resorts') {
        return { resorts: [] };
      }
      return [];
    });

    renderTripsStack();

    expect(
      await screen.findByTestId(`trips-trip-active-${ACTIVE_TRIP.id}`),
    ).toBeTruthy();
    expect(
      await screen.findByTestId(`trips-trip-countdown-${upcomingTrip.id}`),
    ).toBeTruthy();
    expect(
      await screen.findByTestId(`trips-trip-past-${pastTrip.id}`),
    ).toBeTruthy();
    expect(screen.getByText('UPCOMING')).toBeTruthy();
    expect(screen.getByText('Summer Vacation')).toBeTruthy();
    expect(screen.getByText('Winter Holiday')).toBeTruthy();
  });

  // Feature: dark-mode — the Trips list repaints with the Twilight palette.
  describe('dark mode', () => {
    afterEach(resetTestScheme);

    const flat = (node: ReactTestInstance): Record<string, unknown> =>
      (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;

    const PAST_TRIP: TripDTO = {
      id: 'trip-past-dark',
      name: 'Winter Holiday',
      description: '',
      startDate: '2020-01-01',
      endDate: '2020-01-05',
      status: 'past',
      createdAt: '2020-01-01T12:00:00Z',
      resorts: [],
      foodLists: [],
      experienceLists: [],
    };

    function mockPopulatedList(): void {
      apiRequestMock.mockImplementation(async (_method, path) => {
        if (path === '/me/trips') {
          return [
            { status: 'active', trips: [ACTIVE_TRIP] },
            { status: 'past', trips: [PAST_TRIP] },
          ];
        }
        if (path === '/resorts') return { resorts: [] };
        return [];
      });
    }

    /** The screen root: the host View that `ScreenContainer` paints. */
    function rootContainer(): ReactTestInstance {
      const container = screen.UNSAFE_getAllByType(ScreenContainer)[0]!;
      return container.children[0] as ReactTestInstance;
    }

    test('(a)(b)(c) paints the root, row text and converted row badge dark', async () => {
      mockPopulatedList();
      setTestScheme('dark');
      renderTripsStack();

      const pastBadge = await screen.findByTestId(`trips-trip-past-${PAST_TRIP.id}`);
      // (a) root container.
      expect(flat(rootContainer()).backgroundColor).toBe(darkTheme.color.background);
      // (b) primary text — the Trip name.
      expect(flat(screen.getByText('Winter Holiday')).color).toBe(darkTheme.color.textPrimary);
      // (c) converted literals — the past badge tile and the row border.
      expect(flat(pastBadge).backgroundColor).toBe(TRIP_ROW.dark.pastBg);
      expect(flat(pastBadge).borderColor).toBe(TRIP_ROW.dark.pastBorder);
      expect(flat(screen.getByTestId(`trips-trip-${PAST_TRIP.id}`)).borderColor).toBe(
        TRIP_ROW.dark.rowBorder,
      );
      // The active H-role countdown tile is mode-invariant (rule 3 H).
      expect(
        flat(screen.getByTestId(`trips-trip-active-${ACTIVE_TRIP.id}`)).backgroundColor,
      ).toBe(TRIP_ROW.dark.activeBg);
    });

    test('(d) a mounted list repaints its rows live when the scheme switches (no remount)', async () => {
      mockPopulatedList();
      renderTripsStack();

      const pastBadge = await screen.findByTestId(`trips-trip-past-${PAST_TRIP.id}`);
      // Light first: today's literal values.
      expect(flat(pastBadge).backgroundColor).toBe(TRIP_ROW.light.pastBg);
      expect(flat(screen.getByText('Winter Holiday')).color).toBe('#1f1235');

      setTestScheme('dark');

      // Same mounted FlatList row, now painted with the dark values.
      await waitFor(() => {
        expect(
          flat(screen.getByTestId(`trips-trip-past-${PAST_TRIP.id}`)).backgroundColor,
        ).toBe(TRIP_ROW.dark.pastBg);
      });
      expect(flat(screen.getByText('Winter Holiday')).color).toBe(darkTheme.color.textPrimary);
      expect(flat(rootContainer()).backgroundColor).toBe(darkTheme.color.background);
    });
  });
});

