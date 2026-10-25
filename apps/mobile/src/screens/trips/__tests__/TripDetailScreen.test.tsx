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
  within,
} from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';

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

import TripDetailScreen, { deriveGlanceCard } from '../TripDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { TripDTO } from '@dwt/shared';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { DARK_TONAL, darkTheme } from '../../../theme/theme';
import { ScreenContainer } from '../../../theme/components';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { HUB_TILE } from '../TripDetailScreen.palette';
import { GROUP_FAVORITES } from '../GroupFavoritesSection.palette';

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
  experienceLists: [],
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

  test('Live glance card (Task 25.8 / 25.8.3c): shows Today: EPCOT when only Day_Park exists, shows reservation when one exists, and shows old quiet copy when neither exists', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tripWithDayPark: TripDTO = {
      ...TRIP,
      dayTouringHours: {
        [today]: {
          startingPark: 'EPCOT',
        },
      },
    };

    // 1. Only Day_Park exists for today -> renders "Today: EPCOT"
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return tripWithDayPark;
      if (path === `/trips/${TRIP_ID}/planned-items`) return [];
      if (path === '/me') return { user: { id: 'user-1' } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      if (path === `/trips/${TRIP_ID}/feed`) return [];
      throw new Error(`unexpected path ${path}`);
    });
    const nav1 = makeNavigation();
    renderDetail(nav1);

    const glance1 = await screen.findByTestId('trip-detail-glance-rest');
    expect(glance1).toBeTruthy();
    expect(screen.getByText('Today: EPCOT')).toBeTruthy();
    expect(screen.queryByText('No Scheduled Plans Today')).toBeNull();

    // 2. Both Day_Park and reservation exist for today -> reservation takes precedence
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return tripWithDayPark;
      if (path === `/trips/${TRIP_ID}/planned-items`) {
        return [
          {
            id: 'item-res-1',
            experienceId: 'exp-biergarten',
            experienceName: 'Biergarten Restaurant',
            park: 'epcot',
            plannedDate: today,
            plannedTime: '18:00',
            reservationKind: 'dining',
            partySize: 4,
          },
        ];
      }
      if (path === '/me') return { user: { id: 'user-1' } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      if (path === `/trips/${TRIP_ID}/feed`) return [];
      throw new Error(`unexpected path ${path}`);
    });
    const nav2 = makeNavigation();
    renderDetail(nav2);

    const resCard = await screen.findByTestId('trip-detail-glance-reservation');
    expect(resCard).toBeTruthy();
    expect(screen.getByText('Biergarten Restaurant')).toBeTruthy();
    expect(screen.queryByText('Today: EPCOT')).toBeNull();

    // 3. Neither exists -> shows old quiet copy
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return TRIP;
      if (path === `/trips/${TRIP_ID}/planned-items`) return [];
      if (path === '/me') return { user: { id: 'user-1' } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      if (path === `/trips/${TRIP_ID}/feed`) return [];
      throw new Error(`unexpected path ${path}`);
    });
    const nav3 = makeNavigation();
    renderDetail(nav3);

    const quietCard = await screen.findByTestId('trip-detail-glance-rest');
    expect(quietCard).toBeTruthy();
    expect(screen.getByText('No Scheduled Plans Today')).toBeTruthy();
    expect(screen.getByText('Relax at your resort or explore Disney Springs!')).toBeTruthy();
  });

  describe('deriveGlanceCard unit tests (Task 25.8)', () => {
    const testDate = '2026-10-01';

    it('returns Today: <Park> when dayPark is a known park and no items are planned', () => {
      const glance = deriveGlanceCard([], testDate, undefined, 'EPCOT');
      expect(glance.type).toBe('quiet');
      expect(glance.title).toBe('Today: EPCOT');
      expect(glance.park).toBe('EPCOT');
    });

    it('returns reservation when a reservation exists today, overriding dayPark', () => {
      const resItem = {
        id: 'res-1',
        plannedDate: testDate,
        plannedTime: '12:00',
        reservationKind: 'dining' as const,
        experienceName: 'Space 220',
        park: 'EPCOT',
      } as any;
      const glance = deriveGlanceCard([resItem], testDate, undefined, 'EPCOT');
      expect(glance.type).toBe('reservation');
      expect(glance.title).toBe('Space 220');
      expect(glance.time).toBe('12:00 PM');
    });

    it('returns generic quiet placeholder when neither dayPark nor items exist', () => {
      const glance = deriveGlanceCard([], testDate, 'Contemporary Resort', undefined);
      expect(glance.type).toBe('quiet');
      expect(glance.title).toBe('No Scheduled Plans Today');
      expect(glance.meta).toBe('Relax at Contemporary Resort or explore Disney Springs!');
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

  test('R9.1, R9.4: Group Favorites section renders mocked shared favorites with titles and members, textually distinct from Crowd Favorite', async () => {
    const navigation = makeNavigation();
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return TRIP;
      if (path === `/trips/${TRIP_ID}/favorites/shared`) {
        return {
          items: [
            {
              experienceId: 'exp-space-mountain',
              experienceName: 'Space Mountain',
              park: 'Magic Kingdom',
              category: 'Attraction',
              favoritingCount: 3,
              favoritingDisplayNames: ['Alice', 'Bob', 'Charlie'],
            },
          ],
        };
      }
      return {};
    });

    renderDetail(navigation);
    await screen.findByTestId('trip-detail-hub');

    expect(await screen.findByTestId('trip-detail-group-favorites')).toBeTruthy();
    expect(screen.getByText('Group Favorites')).toBeTruthy();

    // Must be textually distinct from any "Crowd Favorite" superlative
    expect(screen.queryByText(/Crowd Favorite/i)).toBeNull();

    const item = await screen.findByTestId('group-favorite-item-exp-space-mountain');
    expect(item).toBeTruthy();
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.getByText('Magic Kingdom')).toBeTruthy();
    expect(screen.getByText('Favorited by Alice, Bob, Charlie')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();

    fireEvent.press(item);
    expect(navigation.navigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'exp-space-mountain',
    });
  });

  test('R9.5: Group Favorites section renders distinct empty state for zero-overlap mocked result', async () => {
    const navigation = makeNavigation();
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/trips/${TRIP_ID}`) return TRIP;
      if (path === `/trips/${TRIP_ID}/favorites/shared`) {
        return { items: [] };
      }
      return {};
    });

    renderDetail(navigation);
    await screen.findByTestId('trip-detail-hub');

    expect(await screen.findByTestId('trip-detail-group-favorites')).toBeTruthy();
    expect(await screen.findByTestId('group-favorites-empty')).toBeTruthy();
    expect(screen.getByText('No group favorites yet')).toBeTruthy();
    expect(
      screen.getByText(
        'When two or more crew members favorite the same experience, it will appear here.',
      ),
    ).toBeTruthy();

    // Distinct from Crowd Favorite
    expect(screen.queryByText(/Crowd Favorite/i)).toBeNull();
  });

  // Feature: dark-mode — the hub repaints with the Twilight palette.
  describe('dark mode', () => {
    afterEach(resetTestScheme);

    const flat = (node: ReactTestInstance): Record<string, unknown> =>
      (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;

    /** The screen root: the host View that `ScreenContainer` paints. */
    function rootContainer(): ReactTestInstance {
      const container = screen.UNSAFE_getAllByType(ScreenContainer)[0]!;
      return container.children[0] as ReactTestInstance;
    }

    test('(a)(b)(c) paints the root, tile titles and converted tile + favorites colours dark', async () => {
      apiRequestMock.mockImplementation(async (_method: string, path: string) => {
        if (path === `/trips/${TRIP_ID}`) return TRIP;
        if (path === `/trips/${TRIP_ID}/favorites/shared`) {
          return {
            items: [
              {
                experienceId: 'exp-space-mountain',
                experienceName: 'Space Mountain',
                park: 'Magic Kingdom',
                category: 'Attraction',
                favoritingCount: 3,
                favoritingDisplayNames: ['Alice', 'Bob', 'Charlie'],
              },
            ],
          };
        }
        return [];
      });
      setTestScheme('dark');
      renderDetail(makeNavigation());

      await screen.findByTestId('trip-detail-hub');
      // (a) root container.
      expect(flat(rootContainer()).backgroundColor).toBe(darkTheme.color.background);
      // (b) primary text — a tool tile title.
      expect(flat(screen.getByText('Planned List')).color).toBe(darkTheme.color.textPrimary);
      // (c) converted literals: the Trip Activity tile badge (rule 3 red T)
      // and the Ledger badge (`primary` as text → `primaryFg`, rule 1a).
      expect(flat(screen.getByText(/ Logs$/)).color).toBe(HUB_TILE.dark.activityText);
      expect(flat(screen.getByText('Ledger')).color).toBe(darkTheme.color.primaryFg);
      // Tool tile icons follow dark (B5-1: the rendered tiles, not HUB_SECTIONS).
      const tileIcon = (id: string): unknown =>
        within(screen.getByTestId(id)).UNSAFE_getByType(Ionicons).props.color;
      expect(tileIcon('trip-detail-section-planned')).toBe(darkTheme.color.primaryFg);
      expect(tileIcon('trip-detail-section-schedule')).toBe(darkTheme.color.primaryLight);
      expect(tileIcon('trip-detail-section-reservations')).toBe(DARK_TONAL.amber.fg);
      // GroupFavoritesSection (c): the favoriting count text (rule 3 red T).
      await screen.findByTestId('group-favorite-item-exp-space-mountain');
      expect(flat(screen.getByText('3')).color).toBe(GROUP_FAVORITES.dark.heart);
    });

    test('GroupFavoritesSection empty state keeps its rule-2a primary tint in dark', async () => {
      apiRequestMock.mockImplementation(async (_method: string, path: string) => {
        if (path === `/trips/${TRIP_ID}`) return TRIP;
        if (path === `/trips/${TRIP_ID}/favorites/shared`) return { items: [] };
        return [];
      });
      setTestScheme('dark');
      renderDetail(makeNavigation());

      const empty = await screen.findByTestId('group-favorites-empty');
      // `${t.color.primary}0a` / `${t.color.primaryFg}18` (rule 2a, suffix verbatim).
      expect(flat(empty).backgroundColor).toBe(`${darkTheme.color.primary}0a`);
      expect(flat(empty).borderColor).toBe(`${darkTheme.color.primaryFg}18`);
    });

    test('a past trip paints its recap hero with primaryDark in dark', async () => {
      apiRequestMock.mockImplementation(async (_method: string, path: string) => {
        if (path === `/trips/${TRIP_ID}`) return { ...TRIP, status: 'past' };
        return [];
      });
      setTestScheme('dark');
      renderDetail(makeNavigation());

      const hero = await screen.findByTestId('trip-detail-section-summary');
      expect(flat(hero).backgroundColor).toBe(darkTheme.color.primaryDark);
      expect(flat(screen.getByText('Magical Vacation Recap')).color).toBe(
        darkTheme.color.textOnPrimary,
      );
    });

    test('keeps the pre-retrofit light values under light', async () => {
      apiRequestMock.mockImplementation(async (_method: string, path: string) => {
        if (path === `/trips/${TRIP_ID}`) return TRIP;
        if (path === `/trips/${TRIP_ID}/favorites/shared`) return { items: [] };
        return [];
      });
      renderDetail(makeNavigation());

      await screen.findByTestId('trip-detail-hub');
      expect(flat(screen.getByText(/ Logs$/)).color).toBe('#e8505b');
      expect(flat(screen.getByText('Ledger')).color).toBe('#5b2a86');
      const tileIcon = (id: string): unknown =>
        within(screen.getByTestId(id)).UNSAFE_getByType(Ionicons).props.color;
      expect(tileIcon('trip-detail-section-planned')).toBe('#5b2a86');
      expect(tileIcon('trip-detail-section-schedule')).toBe('#7e57c2');
      expect(tileIcon('trip-detail-section-reservations')).toBe('#b27a00');
      const empty = await screen.findByTestId('group-favorites-empty');
      expect(flat(empty).backgroundColor).toBe('#5b2a860a');
    });
  });

  describe('Booking and packing hub tiles (Task 11.9)', () => {
    test('pressing the booking tile navigates to TripBookingTimeline with the Trip id', async () => {
      apiRequestMock.mockResolvedValue(TRIP);
      const navigation = makeNavigation();

      renderDetail(navigation);
      await screen.findByTestId('trip-detail-hub');

      fireEvent.press(screen.getByTestId('trip-detail-section-booking'));
      expect(navigation.navigate).toHaveBeenCalledWith('TripBookingTimeline', {
        tripId: TRIP_ID,
      });
      expect(
        within(screen.getByTestId('trip-detail-section-booking')).getByText('Timeline'),
      ).toBeTruthy();
    });

    test('pressing the packing tile navigates to TripPackingList with the Trip id', async () => {
      apiRequestMock.mockResolvedValue(TRIP);
      const navigation = makeNavigation();

      renderDetail(navigation);
      await screen.findByTestId('trip-detail-hub');

      fireEvent.press(screen.getByTestId('trip-detail-section-packing'));
      expect(navigation.navigate).toHaveBeenCalledWith('TripPackingList', {
        tripId: TRIP_ID,
      });
    });

    test('mocked packing list { packedCount: 3, totalCount: 7 } renders "3 of 7"', async () => {
      apiRequestMock.mockImplementation(async (_method: string, path: string) => {
        if (path === `/trips/${TRIP_ID}`) return TRIP;
        if (path === `/trips/${TRIP_ID}/packing-items`) {
          return { items: [], packedCount: 3, totalCount: 7 };
        }
        return [];
      });

      renderDetail(makeNavigation());
      await screen.findByTestId('trip-detail-hub');

      expect(await screen.findByText('3 of 7')).toBeTruthy();
    });

    test('empty packing list renders "0 of 0"', async () => {
      apiRequestMock.mockImplementation(async (_method: string, path: string) => {
        if (path === `/trips/${TRIP_ID}`) return TRIP;
        if (path === `/trips/${TRIP_ID}/packing-items`) {
          return { items: [], packedCount: 0, totalCount: 0 };
        }
        return [];
      });

      renderDetail(makeNavigation());
      await screen.findByTestId('trip-detail-hub');

      expect(await screen.findByText('0 of 0')).toBeTruthy();
    });

    test('rejected query renders no count text on packing tile', async () => {
      apiRequestMock.mockImplementation(async (_method: string, path: string) => {
        if (path === `/trips/${TRIP_ID}`) return TRIP;
        if (path === `/trips/${TRIP_ID}/packing-items`) {
          throw new Error('Packing query failed');
        }
        return [];
      });

      renderDetail(makeNavigation());
      await screen.findByTestId('trip-detail-hub');

      const packingTile = screen.getByTestId('trip-detail-section-packing');
      expect(packingTile).toBeTruthy();
      expect(within(packingTile).queryByText(/\d+\s+of\s+\d+/)).toBeNull();
    });
  });
});

