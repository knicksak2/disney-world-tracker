/**
 * Trip_Detail_View hub — screen tests (task 17.9).
 *
 * Validates: Requirements 18.1, 18.6
 *
 * The Trip_Detail_View reads its header via `GET /trips/:id` and presents one
 * distinct navigation control per section (Planned_List, Shared_Log, Trip_Feed,
 * Trip_Members, Trip_Summary — R18.1). Selecting a control opens the matching
 * section route for this Trip, forwarding the `tripId` (R18.6). It also
 * surfaces the shared `trip_forbidden` non-disclosure error with a Retry.
 *
 * The screen consumes `navigation`/`route` from props (no navigation-context
 * hooks), so it renders directly with a stubbed navigation object; only
 * `apiRequest` is mocked.
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

import TripDetailScreen from '../TripDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { TripDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-1';

const TRIP: TripDTO = {
  id: TRIP_ID,
  name: 'Spring Break at WDW',
  description: 'A magical week.',
  startDate: '2024-05-01',
  endDate: '2024-05-05',
  status: 'active',
  createdAt: '2024-04-01T12:00:00Z',
  resorts: [],
  foodLists: [],
};

/** Section control testIDs paired with the route each opens (R18.1, R18.6). */
const SECTIONS: ReadonlyArray<{
  readonly testId: string;
  readonly route: string;
}> = [
  { testId: 'trip-detail-section-planned', route: 'TripPlannedList' },
  // The Reservations section opens the bookings screen (trip-reservations R2.6).
  { testId: 'trip-detail-section-reservations', route: 'TripReservations' },
  { testId: 'trip-detail-section-activity', route: 'TripFeed' },
  { testId: 'trip-detail-section-members', route: 'TripMembers' },
  { testId: 'trip-detail-section-summary', route: 'TripSummary' },
];

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeNavigation(state?: unknown): {
  navigate: jest.Mock;
  goBack: jest.Mock;
  getState: jest.Mock;
} {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    getState: jest.fn(() => state),
  };
}

function renderDetail(
  navigation: ReturnType<typeof makeNavigation>,
): ReturnType<typeof render> {
  // The screen only reads `navigation`/`route` from props, so a stubbed pair
  // is sufficient; cast through `unknown` to satisfy the prop types.
  const props = {
    navigation,
    route: { key: 'TripDetail-1', name: 'TripDetail', params: { tripId: TRIP_ID } },
  } as unknown as React.ComponentProps<typeof TripDetailScreen>;

  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <TripDetailScreen {...props} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Trip_Detail_View hub (R18.1, R18.6)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('R18.1: presents a distinct navigation control for each of the four sections', async () => {
    apiRequestMock.mockResolvedValue(TRIP);

    renderDetail(makeNavigation());

    expect(await screen.findByTestId('trip-detail-hub')).toBeTruthy();
    for (const section of SECTIONS) {
      expect(screen.getByTestId(section.testId)).toBeTruthy();
    }
  });

  test('R18.6: selecting each section control opens that section for this Trip', async () => {
    apiRequestMock.mockResolvedValue(TRIP);
    const navigation = makeNavigation();

    renderDetail(navigation);
    await screen.findByTestId('trip-detail-hub');

    for (const section of SECTIONS) {
      navigation.navigate.mockClear();
      fireEvent.press(screen.getByTestId(section.testId));
      expect(navigation.navigate).toHaveBeenCalledWith(section.route, {
        tripId: TRIP_ID,
      });
    }
  });

  test('R21.1: renders the Resort(s) the party stayed at when the Trip records them', async () => {
    apiRequestMock.mockResolvedValue({
      ...TRIP,
      resorts: [
        { id: 'resort-contemporary', name: 'Contemporary' },
        { id: 'resort-poly', name: 'Polynesian Village' },
      ],
    });

    renderDetail(makeNavigation());

    expect(await screen.findByTestId('trip-detail-resorts')).toBeTruthy();
    expect(screen.getByTestId('trip-detail-resort-resort-contemporary')).toBeTruthy();
    expect(screen.getByTestId('trip-detail-resort-resort-poly')).toBeTruthy();
    expect(screen.getByText('Contemporary')).toBeTruthy();
    expect(screen.getByText('Polynesian Village')).toBeTruthy();
  });

  test('R21.1: omits the Resort stay block when the Trip records none', async () => {
    apiRequestMock.mockResolvedValue(TRIP); // TRIP.resorts === []

    renderDetail(makeNavigation());

    await screen.findByTestId('trip-detail-hub');
    expect(screen.queryByTestId('trip-detail-resorts')).toBeNull();
  });

  test('R3.8: an Organizer sees the Edit control, and it opens the TripEdit form', async () => {
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return TRIP;
      if (path === '/me') return { user: { id: 'me' } };
      if (path === `/trips/${TRIP_ID}/members`) {
        return [
          {
            userId: 'me',
            displayName: 'Me',
            avatarPreset: null,
            role: 'organizer',
          },
        ];
      }
      throw new Error(`unexpected path ${path}`);
    });
    const navigation = makeNavigation();

    renderDetail(navigation);

    const edit = await screen.findByTestId('trip-detail-edit');
    fireEvent.press(edit);
    expect(navigation.navigate).toHaveBeenCalledWith('TripEdit', {
      tripId: TRIP_ID,
    });
  });

  test('R3.8: a plain Member does not see the Edit control', async () => {
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return TRIP;
      if (path === '/me') return { user: { id: 'me' } };
      if (path === `/trips/${TRIP_ID}/members`) {
        return [
          {
            userId: 'me',
            displayName: 'Me',
            avatarPreset: null,
            role: 'member',
          },
        ];
      }
      throw new Error(`unexpected path ${path}`);
    });

    renderDetail(makeNavigation());

    await screen.findByTestId('trip-detail-hub');
    expect(screen.queryByTestId('trip-detail-edit')).toBeNull();
  });

  test('R15.2 non-disclosure: a trip_forbidden read shows an error with a Retry control', async () => {
    apiRequestMock.mockRejectedValue(
      new ApiError({
        code: 'trip_forbidden',
        message: 'forbidden',
        status: 403,
      }),
    );

    renderDetail(makeNavigation());

    expect(await screen.findByTestId('trip-detail-error')).toBeTruthy();
    const retry = screen.getByTestId('trip-detail-retry');

    const callsBefore = apiRequestMock.mock.calls.length;
    fireEvent.press(retry);
    await waitFor(() => {
      expect(apiRequestMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  test('rate limit exceeded: surfaces a clear "Too many requests" message with a Retry control', async () => {
    apiRequestMock.mockRejectedValue(
      new ApiError({
        code: 'rate_limit_exceeded',
        message: 'Too many requests.',
        status: 429,
        details: { retryAfterMs: 30000, max: 120 },
      }),
    );

    renderDetail(makeNavigation());

    expect(await screen.findByTestId('trip-detail-error')).toBeTruthy();
    expect(
      screen.getByText('Too many requests. Please wait a moment and try again.'),
    ).toBeTruthy();
    const retry = screen.getByTestId('trip-detail-retry');
    expect(retry).toBeTruthy();
  });

  test('Schedule Builder tile in 2x2 grid navigates to TripSchedule', async () => {
    apiRequestMock.mockResolvedValue(TRIP);
    const navigation = makeNavigation();

    renderDetail(navigation);
    await screen.findByTestId('trip-detail-hub');

    const scheduleTile = screen.getByTestId('trip-detail-section-schedule');
    expect(scheduleTile).toBeTruthy();
    fireEvent.press(scheduleTile);
    expect(navigation.navigate).toHaveBeenCalledWith('TripSchedule', {
      tripId: TRIP_ID,
    });
  });

  test('Live glance card: renders reservation glance card and navigates to TripReservations', async () => {
    const today = new Date().toISOString().slice(0, 10);
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return TRIP;
      if (path === `/trips/${TRIP_ID}/planned-items`) {
        return [
          {
            id: 'item-res-1',
            experienceId: 'exp-biergarten',
            experienceName: 'Biergarten Restaurant',
            park: 'epcot',
            customTitle: null,
            addedByDisplayName: 'Alex',
            plannedDate: today,
            plannedTime: '21:00',
            isFixed: true,
            isLightningLane: false,
            useSingleRider: false,
            priority: 1,
            itemType: 'experience',
            durationMinutes: 60,
            windowStartMinutes: null,
            windowEndMinutes: null,
            mealPeriod: 'dinner',
            scheduledShowtime: null,
            reservationKind: 'dining',
            confirmationNumber: 'W12345',
            partySize: 4,
          },
        ];
      }
      if (path === '/me') return { user: { id: 'user-1' } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      if (path === `/trips/${TRIP_ID}/feed`) return [];
      throw new Error(`unexpected path ${path}`);
    });
    const navigation = makeNavigation();

    renderDetail(navigation);

    const glanceCard = await screen.findByTestId('trip-detail-glance-reservation');
    expect(glanceCard).toBeTruthy();
    expect(screen.getByText('Biergarten Restaurant')).toBeTruthy();
    expect(screen.getByText('EPCOT')).toBeTruthy();
    expect(screen.getByText('👥 Party of 4')).toBeTruthy();

    fireEvent.press(glanceCard);
    expect(navigation.navigate).toHaveBeenCalledWith('TripReservations', {
      tripId: TRIP_ID,
    });
  });

  test('Live glance card: renders scheduled item glance card when no reservation exists today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return TRIP;
      if (path === `/trips/${TRIP_ID}/planned-items`) {
        return [
          {
            id: 'item-sched-1',
            experienceId: 'exp-space-mtn',
            experienceName: 'Space Mountain',
            park: 'magic-kingdom',
            customTitle: null,
            addedByDisplayName: 'Alex',
            plannedDate: today,
            plannedTime: '14:30',
            isFixed: false,
            isLightningLane: false,
            useSingleRider: false,
            priority: 2,
            itemType: 'experience',
            durationMinutes: 45,
            windowStartMinutes: null,
            windowEndMinutes: null,
            mealPeriod: null,
            scheduledShowtime: null,
            reservationKind: null,
            confirmationNumber: null,
            partySize: null,
          },
        ];
      }
      if (path === '/me') return { user: { id: 'user-1' } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      if (path === `/trips/${TRIP_ID}/feed`) return [];
      throw new Error(`unexpected path ${path}`);
    });
    const navigation = makeNavigation();

    renderDetail(navigation);

    const glanceCard = await screen.findByTestId('trip-detail-glance-schedule');
    expect(glanceCard).toBeTruthy();
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.getByText('Magic Kingdom')).toBeTruthy();
    expect(screen.getByText('🎯 2:30 PM Target')).toBeTruthy();

    fireEvent.press(glanceCard);
    expect(navigation.navigate).toHaveBeenCalledWith('TripSchedule', {
      tripId: TRIP_ID,
    });
  });

  test('Live glance card: renders quiet day fallback when no plans exist today', async () => {
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return TRIP;
      if (path === `/trips/${TRIP_ID}/planned-items`) return [];
      if (path === '/me') return { user: { id: 'user-1' } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      if (path === `/trips/${TRIP_ID}/feed`) return [];
      throw new Error(`unexpected path ${path}`);
    });
    const navigation = makeNavigation();

    renderDetail(navigation);

    const quietCard = await screen.findByTestId('trip-detail-glance-rest');
    expect(quietCard).toBeTruthy();
    expect(screen.getByText('No Scheduled Plans Today')).toBeTruthy();

    const addBtn = screen.getByText('+ Add from Wishlist');
    fireEvent.press(addBtn);
    expect(navigation.navigate).toHaveBeenCalledWith('TripPlannedList', {
      tripId: TRIP_ID,
    });

    const openScheduleBtn = screen.getByText('Open Schedule');
    fireEvent.press(openScheduleBtn);
    expect(navigation.navigate).toHaveBeenCalledWith('TripSchedule', {
      tripId: TRIP_ID,
    });
  });

  test('Past Trip mode: renders celebratory Wrap-Up Hero and TRAVEL PARTY label', async () => {
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) {
        return {
          ...TRIP,
          status: 'past',
        };
      }
      if (path === `/trips/${TRIP_ID}/planned-items`) return [];
      if (path === '/me') return { user: { id: 'user-1' } };
      if (path === `/trips/${TRIP_ID}/members`) {
        return [
          {
            userId: 'user-1',
            displayName: 'Alex',
            avatarPreset: null,
            role: 'organizer',
          },
        ];
      }
      if (path === `/trips/${TRIP_ID}/feed`) return [];
      throw new Error(`unexpected path ${path}`);
    });
    const navigation = makeNavigation();

    renderDetail(navigation);

    await screen.findByTestId('trip-detail-hub');
    expect(screen.getByText('TRAVEL PARTY (1)')).toBeTruthy();
    expect(screen.getByText('🏆 TRIP COMPLETE')).toBeTruthy();
    expect(screen.getByText('Magical Vacation Recap')).toBeTruthy();

    const summaryCard = screen.getByTestId('trip-detail-section-summary');
    fireEvent.press(summaryCard);
    expect(navigation.navigate).toHaveBeenCalledWith('TripSummary', {
      tripId: TRIP_ID,
    });
  });

  test('Active Trip mode: renders celebratory vacation progress card with live superlatives hint and navigates to TripSummary', async () => {
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return TRIP;
      if (path === `/trips/${TRIP_ID}/planned-items`) return [];
      if (path === '/me') return { user: { id: 'user-1' } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      if (path === `/trips/${TRIP_ID}/feed`) {
        return [
          {
            id: 'feed-1',
            tripId: TRIP_ID,
            userId: 'user-1',
            type: 'completion',
            createdAt: '2024-05-02T12:00:00Z',
            experienceName: 'Flight of Passage',
            rating: 5,
            photoUrl: null,
            comment: null,
            rodeWith: [],
            reactions: {},
            reactionCount: 0,
          },
        ];
      }
      throw new Error(`unexpected path ${path}`);
    });
    const navigation = makeNavigation();

    renderDetail(navigation);

    await screen.findByTestId('trip-detail-hub');
    const summaryCard = screen.getByTestId('trip-detail-section-summary');
    expect(summaryCard).toBeTruthy();
    expect(screen.getByText(/VACATION UNDERWAY/)).toBeTruthy();
    expect(screen.getByText('1 magical moment logged!')).toBeTruthy();
    expect(
      screen.getByText('Tap to see live group superlatives & top ratings ›'),
    ).toBeTruthy();

    fireEvent.press(summaryCard);
    expect(navigation.navigate).toHaveBeenCalledWith('TripSummary', {
      tripId: TRIP_ID,
    });
  });

  test('Back button: pops via goBack when TripsList is in navigation stack history', async () => {
    apiRequestMock.mockResolvedValue(TRIP);
    const navigation = makeNavigation({
      index: 1,
      routes: [{ name: 'TripsList' }, { name: 'TripDetail' }],
    });

    renderDetail(navigation);
    await screen.findByTestId('trip-detail-hub');

    const backBtn = screen.getByLabelText('Go back');
    fireEvent.press(backBtn);
    expect(navigation.goBack).toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('TripsList');
  });

  test('Back button: navigates to TripsList when TripsList is not in stack history', async () => {
    apiRequestMock.mockResolvedValue(TRIP);
    const navigation = makeNavigation({
      index: 0,
      routes: [{ name: 'TripDetail' }],
    });

    renderDetail(navigation);
    await screen.findByTestId('trip-detail-hub');

    const backBtn = screen.getByLabelText('Go back');
    fireEvent.press(backBtn);
    expect(navigation.navigate).toHaveBeenCalledWith('TripsList');
  });
});

