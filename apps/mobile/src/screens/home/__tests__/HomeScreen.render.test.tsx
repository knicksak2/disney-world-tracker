/**
 * Component and interaction tests for HomeScreen.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { apiRequest } from '../../../api/client';
import { useClaimablePinsBadge } from '../../../components/pins/useClaimablePinsBadge';
import * as navigationRefModule from '../../../navigation/navigationRef';
import { getTodayWDW } from '../../trips/TripScheduleScreen';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme } from '../../../theme/theme';
import HomeScreen from '../HomeScreen';
import { HOME_FAVORITES } from '../HomeFavoritesSection.palette';
import { HOME_THEME_PARKS } from '../HomeThemeParksSection.palette';
import { UPCOMING_TRIP_HERO } from '../UpcomingTripHero.palette';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('../../../components/pins/useClaimablePinsBadge', () => ({
  useClaimablePinsBadge: jest.fn(),
}));

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockUseClaimablePinsBadge = useClaimablePinsBadge as jest.MockedFunction<
  typeof useClaimablePinsBadge
>;

const Stack = createNativeStackNavigator();

describe('HomeScreen (Requirements 2.1–2.5)', () => {
  let queryClient: QueryClient;
  let mockNavigate: jest.Mock;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockApiRequest.mockReset();
    mockUseClaimablePinsBadge.mockReturnValue({
      count: 2,
      display: 'count',
    });
    mockNavigate = jest.fn();

    // Default mock responses
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me') {
        return {
          user: { id: 'user-1', email: 'nicholas@example.com' },
          profile: { displayName: 'Nicholas K', avatarPreset: null },
        };
      }
      if (path === '/home/highest-rated') {
        return {
          entries: [
            {
              experienceId: 'exp-jungle',
              name: 'Jungle Cruise',
              park: 'Magic Kingdom',
              category: 'Ride',
              value: 8.7,
              count: 3,
            },
            {
              experienceId: 'exp-pirates',
              name: 'Pirates of the Caribbean',
              park: 'Magic Kingdom',
              category: 'Ride',
              value: 7.7,
              count: 3,
            },
          ],
        };
      }
      if (path === '/me/trips') {
        return [
          {
            status: 'upcoming',
            trips: [
              {
                id: 'trip-fall-magic',
                name: 'Fall Magic Trip',
                description: '4 Parks',
                startDate: '2026-10-04',
                endDate: '2026-10-10',
                status: 'upcoming',
              },
            ],
          },
        ];
      }
      if (path.includes('/members')) {
        return [
          { userId: 'user-1', displayName: 'Nicholas K', role: 'organizer' },
          { userId: 'user-2', displayName: 'Emma Stone', role: 'member' },
        ];
      }
      if (path.includes('/booking-timeline')) {
        return {
          tripId: 'trip-fall-magic',
          rulesVersion: 1,
          stayType: { value: 'resort', source: 'auto' },
          lightningLaneTiming: { value: 'seven_day', source: 'auto' },
          arrivalDate: { value: '2026-10-04', source: 'trip_start' },
          muted: false,
          windows: [
            {
              windowKey: 'dining:2026-08-05',
              kind: 'dining',
              dropOn: '2026-08-05',
              dropAt: '2026-08-05T10:00:00.000Z',
              coveredDates: ['2026-10-04'],
              status: 'open',
              daysUntilDrop: 0,
              done: false,
              doneAt: null,
              doneByDisplayName: null,
              bookedCount: 0,
            },
          ],
        };
      }
      if (path.startsWith('/parks/')) {
        return {
          park: 'Magic Kingdom',
          entries: [
            { experienceId: 'e-1', name: 'Space Mountain', status: 'OPERATING', waitMinutes: 35 },
            { experienceId: 'e-2', name: 'Big Thunder', status: 'OPERATING', waitMinutes: 25 },
          ],
          retrievedAt: new Date().toISOString(),
          stale: false,
        };
      }
      if (path.startsWith('/crowd-calendar')) {
        return {
          days: [
            {
              date: '2026-09-18',
              park: 'Magic Kingdom',
              forecastIndex: 5,
              parkHours: { openTime: '8:00 AM', closeTime: '11:00 PM' },
              earlyEntry: false,
              extendedEvening: false,
              ticketedEvent: false,
            },
          ],
        };
      }
      if (path === '/weather/current') {
        return {
          current: {
            tempF: 84,
            condition: 'Partly Cloudy',
          },
        };
      }
      return {};
    });
  });

  function renderHome() {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Home">
              {(props) => <HomeScreen {...(props as any)} navigation={{ ...props.navigation, navigate: mockNavigate } as any} />}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );
  }

  it('renders the personalized hero header with greeting pill, hero title, and avatar pill', async () => {
    renderHome();

    expect(await screen.findByTestId('home-header')).toBeTruthy();
    expect(screen.getByTestId('home-hero-title')).toHaveTextContent('Ready for the Magic?');
    await waitFor(() => {
      expect(screen.getByTestId('home-hero-sub')).toHaveTextContent('Magic Kingdom • 8:00 AM – 11:00 PM • 84° Partly Cloudy');
    });

    const greetingPill = screen.getByTestId('home-greeting-pill');
    expect(greetingPill.props.children).toMatch(/Nicholas/);

    expect(screen.getByTestId('avatar-chip')).toBeTruthy();
  });

  it('renders the upcoming vacation countdown card with crew and milestone, handling taps (Requirement 2.8)', async () => {
    const navigateToTripDetailSpy = jest
      .spyOn(navigationRefModule, 'navigateToTripDetail')
      .mockReturnValue(true);
    const navigateToTripMembersSpy = jest
      .spyOn(navigationRefModule, 'navigateToTripMembers')
      .mockReturnValue(true);
    const navigateToBookingTimelineSpy = jest
      .spyOn(navigationRefModule, 'navigateToBookingTimeline')
      .mockReturnValue(true);

    renderHome();

    const countdownCard = await screen.findByTestId('home-upcoming-trip-card');
    expect(countdownCard).toBeTruthy();
    expect(screen.getByText('UPCOMING VACATION')).toBeTruthy();
    expect(screen.getByText('Fall Magic Trip')).toBeTruthy();

    // Crew preview row
    const crewRow = await screen.findByTestId('home-upcoming-trip-card-crew');
    expect(crewRow).toBeTruthy();
    expect(screen.getByText(/With Emma/)).toBeTruthy();

    fireEvent.press(crewRow);
    expect(navigateToTripMembersSpy).toHaveBeenCalledWith({ tripId: 'trip-fall-magic' });

    // Next booking milestone banner
    const milestoneBanner = await screen.findByTestId('home-upcoming-trip-card-milestone');
    expect(milestoneBanner).toBeTruthy();
    expect(screen.getByText(/60-Day Dining Window Open Now!/)).toBeTruthy();

    fireEvent.press(milestoneBanner);
    expect(navigateToBookingTimelineSpy).toHaveBeenCalledWith({ tripId: 'trip-fall-magic' });

    // Header card tap navigates to trip detail
    fireEvent.press(countdownCard);
    expect(navigateToTripDetailSpy).toHaveBeenCalledWith({ tripId: 'trip-fall-magic' });

    navigateToTripDetailSpy.mockRestore();
    navigateToTripMembersSpy.mockRestore();
    navigateToBookingTimelineSpy.mockRestore();
  });

  it('renders the exploration prompt card when no active or upcoming trips exist and navigates to Trips on tap', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me') {
        return {
          user: { id: 'user-1', email: 'nicholas@example.com' },
          profile: { displayName: 'Nicholas K', avatarPreset: null },
        };
      }
      if (path === '/me/trips') {
        return [];
      }
      if (path === '/home/highest-rated') {
        return { entries: [] };
      }
      if (path === '/catalog') {
        return { experiences: [] };
      }
      if (path.startsWith('/parks/')) {
        return { park: 'Magic Kingdom', entries: [], retrievedAt: new Date().toISOString(), stale: false };
      }
      if (path.startsWith('/crowd-calendar')) {
        return { days: [] };
      }
      if (path === '/weather/current') {
        return { current: null };
      }
      return {};
    });

    renderHome();

    const promptCard = await screen.findByTestId('home-exploration-prompt-card');
    expect(promptCard).toBeTruthy();
    expect(screen.getByText('PLAN A VACATION')).toBeTruthy();
    expect(screen.getByText('Plan Your Next Adventure')).toBeTruthy();
    expect(
      screen.getByText('Explore parks, build itineraries & invite crew'),
    ).toBeTruthy();

    expect(screen.queryByTestId('home-upcoming-trip-card')).toBeNull();
    expect(screen.queryByTestId('active-trip-shortcut')).toBeNull();

    fireEvent.press(promptCard);
    expect(mockNavigate).toHaveBeenCalledWith('Trips');
  });

  it('renders the 2x2 Theme Parks grid and handles park navigation to DestinationScreen (Requirement 2.7)', async () => {
    renderHome();

    expect(await screen.findByTestId('home-theme-parks-section')).toBeTruthy();
    expect(screen.getByTestId('home-parks-grid')).toBeTruthy();

    const mkCard = await screen.findByTestId('home-park-tile-Magic Kingdom');
    expect(mkCard).toBeTruthy();
    expect(await screen.findByTestId('home-park-wait-Magic Kingdom')).toHaveTextContent(/30m avg/);

    fireEvent.press(mkCard);
    expect(mockNavigate).toHaveBeenCalledWith('Explore', {
      screen: 'DestinationScreen',
      params: { destination: 'Magic Kingdom' },
    });
  });

  it('opens experience picker for Log Ride and Log Food from quick log row (Requirement 2.7)', async () => {
    renderHome();

    // Log Ride
    const logRideBtn = await screen.findByTestId('home-quick-log-ride');
    fireEvent.press(logRideBtn);

    expect(await screen.findByTestId('home-experience-picker-modal')).toBeTruthy();
    expect(screen.getByTestId('home-picker-title')).toHaveTextContent('Select Attraction to Log');

    // Close picker
    fireEvent.press(screen.getByTestId('home-picker-close-btn'));

    // Log Food
    const logFoodBtn = screen.getByTestId('home-quick-log-food');
    fireEvent.press(logFoodBtn);

    expect(await screen.findByTestId('home-experience-picker-modal')).toBeTruthy();
    expect(screen.getByTestId('home-picker-title')).toHaveTextContent('Select Restaurant to Log Food');
  });

  it('navigates to LiveWaits from the Parks section header link (Requirement 2.7)', async () => {
    renderHome();

    const liveWaitsLink = await screen.findByTestId('home-parks-live-waits-link');
    expect(liveWaitsLink).toBeTruthy();

    fireEvent.press(liveWaitsLink);
    expect(mockNavigate).toHaveBeenCalledWith('Explore', expect.objectContaining({
      screen: 'LiveWaits',
      params: { park: 'Magic Kingdom' },
    }));
  });

  it('omits Your Favorites section completely when zero favorited experiences exist (Requirements 2.7, 8.3a)', async () => {
    renderHome();

    // The Parks section is rendered
    expect(await screen.findByTestId('home-theme-parks-section')).toBeTruthy();

    // Your Favorites is completely omitted (no header, no empty state)
    expect(screen.queryByTestId('home-favorites-section')).toBeNull();
    expect(screen.queryByTestId('home-favorites-empty')).toBeNull();
  });

  it('renders favorited attractions with live wait status and navigates to ExperienceDetail on tap (Requirements 8.2, 8.4)', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me') {
        return {
          user: { id: 'user-1', email: 'nicholas@example.com' },
          profile: { displayName: 'Nicholas K', avatarPreset: null },
        };
      }
      if (path === '/me/favorites') {
        return { experienceIds: ['e-1'] };
      }
      if (path === '/catalog') {
        return {
          experiences: [
            {
              id: 'e-1',
              name: 'Space Mountain',
              park: 'Magic Kingdom',
              category: 'Attraction',
            },
          ],
        };
      }
      if (path === '/parks/Magic%20Kingdom/live' || path.startsWith('/parks/')) {
        return {
          park: 'Magic Kingdom',
          entries: [
            { experienceId: 'e-1', name: 'Space Mountain', status: 'OPERATING', waitMinutes: 35 },
          ],
          retrievedAt: new Date().toISOString(),
          stale: false,
        };
      }
      if (path === '/home/highest-rated') {
        return { entries: [] };
      }
      if (path === '/me/trips') {
        return [];
      }
      return {};
    });

    renderHome();

    expect(await screen.findByTestId('home-favorites-section')).toBeTruthy();
    const pill = await screen.findByTestId('home-favorite-pill-e-1');
    expect(pill).toBeTruthy();
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.getByTestId('home-favorite-wait-e-1')).toHaveTextContent('35m');

    fireEvent.press(pill);
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', { experienceId: 'e-1' });
  });

  it('sorts active wait times before closed attractions and navigates to LiveWaits with favorites filter on See All (Requirements 8.2, 8.6)', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me') {
        return {
          user: { id: 'user-1', email: 'nicholas@example.com' },
          profile: { displayName: 'Nicholas K', avatarPreset: null },
        };
      }
      if (path === '/me/favorites') {
        return { experienceIds: ['e-closed', 'e-long', 'e-short'] };
      }
      if (path === '/catalog') {
        return {
          experiences: [
            { id: 'e-closed', name: 'Guardians of the Galaxy', park: 'EPCOT', category: 'Ride' },
            { id: 'e-long', name: 'Space Mountain', park: 'Magic Kingdom', category: 'Ride' },
            { id: 'e-short', name: 'Pirates of the Caribbean', park: 'Magic Kingdom', category: 'Ride' },
          ],
        };
      }
      if (path === '/parks/Magic%20Kingdom/live') {
        return {
          park: 'Magic Kingdom',
          entries: [
            { experienceId: 'e-long', name: 'Space Mountain', status: 'OPERATING', waitMinutes: 45 },
            { experienceId: 'e-short', name: 'Pirates of the Caribbean', status: 'OPERATING', waitMinutes: 5 },
          ],
          retrievedAt: new Date().toISOString(),
          stale: false,
        };
      }
      if (path === '/parks/EPCOT/live') {
        return {
          park: 'EPCOT',
          entries: [
            { experienceId: 'e-closed', name: 'Guardians of the Galaxy', status: 'CLOSED', waitMinutes: null },
          ],
          retrievedAt: new Date().toISOString(),
          stale: false,
        };
      }
      if (path.startsWith('/parks/')) {
        return { park: 'Animal Kingdom', entries: [], retrievedAt: new Date().toISOString(), stale: false };
      }
      if (path === '/home/highest-rated') {
        return { entries: [] };
      }
      if (path === '/me/trips') {
        return [];
      }
      return {};
    });

    renderHome();

    expect(await screen.findByTestId('home-favorites-section')).toBeTruthy();
    const shortPill = await screen.findByTestId('home-favorite-pill-e-short');
    const longPill = await screen.findByTestId('home-favorite-pill-e-long');
    const closedPill = await screen.findByTestId('home-favorite-pill-e-closed');

    expect(shortPill).toBeTruthy();
    expect(longPill).toBeTruthy();
    expect(closedPill).toBeTruthy();

    expect(screen.getByTestId('home-favorite-wait-e-short')).toHaveTextContent('5m');
    expect(screen.getByTestId('home-favorite-wait-e-long')).toHaveTextContent('45m');
    expect(screen.getByTestId('home-favorite-wait-e-closed')).toHaveTextContent('Closed');

    // See All link navigates to Live Waits with filter: 'favorites'
    const seeAll = screen.getByTestId('home-favorites-see-all');
    fireEvent.press(seeAll);
    expect(mockNavigate).toHaveBeenCalledWith('Explore', {
      screen: 'LiveWaits',
      params: { filter: 'favorites' },
    });
  });

  it('renders the Highest-Rated Experiences leaderboard and handles See All & row tap', async () => {
    renderHome();

    expect(await screen.findByText('Highest-Rated Experiences')).toBeTruthy();
    const seeAll = screen.getByTestId('home-leaderboard-see-all');
    fireEvent.press(seeAll);
    expect(mockNavigate).toHaveBeenCalledWith('Explore', { screen: 'CatalogList' });

    const jungleRow = await screen.findByTestId('home-leaderboard-row-exp-jungle');
    expect(jungleRow).toBeTruthy();
    expect(screen.getByText('Jungle Cruise')).toBeTruthy();
    expect(screen.getByText('8.7')).toBeTruthy();

    fireEvent.press(jungleRow);
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', { experienceId: 'exp-jungle' });
  });

  it('renders active vacation mode with dynamic header, Day Plan dock tile, and active park highlighting', async () => {
    const navigateToTripScheduleSpy = jest
      .spyOn(navigationRefModule, 'navigateToTripSchedule')
      .mockReturnValue(true);

    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me') {
        return {
          user: { id: 'user-1', email: 'nicholas@example.com' },
          profile: { displayName: 'Nicholas K', avatarPreset: null },
        };
      }
      if (path === '/catalog') {
        return {
          experiences: [
            {
              id: 'exp-jungle',
              name: 'Jungle Cruise',
              park: 'Magic Kingdom',
              land: 'Adventureland',
              category: 'Ride',
            },
          ],
        };
      }
      if (path === '/home/highest-rated') {
        return {
          entries: [
            {
              experienceId: 'exp-jungle',
              name: 'Jungle Cruise',
              park: 'Magic Kingdom',
              category: 'Ride',
              value: 8.7,
              count: 3,
            },
          ],
        };
      }
      if (path === '/me/trips') {
        return [
          {
            status: 'active',
            trips: [
              {
                id: 'trip-active-1',
                name: 'new',
                description: '',
                startDate: getTodayWDW(),
                endDate: (() => {
                  const [y, m, d] = getTodayWDW().split('-').map(Number);
                  return new Date(Date.UTC(y!, m! - 1, d! + 4)).toISOString().slice(0, 10);
                })(),
                status: 'active',
              },
            ],
          },
          {
            status: 'upcoming',
            trips: [
              {
                id: 'trip-upcoming-future',
                name: 'December Vacation',
                description: '',
                startDate: '2026-12-15',
                endDate: '2026-12-31',
                status: 'upcoming',
              },
            ],
          },
        ];
      }
      if (path.includes('/planned-items')) {
        return [
          {
            id: 'plan-1',
            tripId: 'trip-active-1',
            customTitle: "Remy's Ratatouille Adventure",
            park: 'EPCOT',
            plannedDate: getTodayWDW(),
            plannedTime: '2026-09-17T13:00:00.000Z',
            itemType: 'experience',
          },
        ];
      }
      if (path.startsWith('/parks/')) {
        return {
          park: 'EPCOT',
          entries: [
            { experienceId: 'e-1', name: "Remy's Ratatouille", status: 'OPERATING', waitMinutes: 35 },
          ],
          retrievedAt: new Date().toISOString(),
          stale: false,
        };
      }
      return {};
    });

    renderHome();

    // Dynamic header for active vacation derives Day 1 and EPCOT
    await waitFor(() => {
      expect(screen.getByTestId('home-hero-title')).toHaveTextContent('Day 1 at EPCOT!');
    });
    expect(screen.getByTestId('home-hero-sub')).toHaveTextContent('EPCOT • Day 1 of 5');
    expect(screen.getByTestId('home-hero-sub')).not.toHaveTextContent('Park Closes');
    expect(screen.getByTestId('home-hero-sub')).not.toHaveTextContent('🏰');

    // Active vacation shortcut hero card renders trip name without "Park Day" suffix
    const activeShortcut = await screen.findByTestId('active-trip-shortcut');
    expect(activeShortcut).toBeTruthy();
    expect(screen.getByText('ACTIVE VACATION • DAY 1 OF 5')).toBeTruthy();
    expect(screen.getByText('new')).toBeTruthy();

    // Upcoming trip hero is suppressed while an active vacation is ongoing (Requirement 2.7 mutual exclusion)
    expect(screen.queryByTestId('home-upcoming-trip-card')).toBeNull();

    // Active vacation shortcut hero card has Today's Schedule button
    const scheduleBtn = screen.getByText("Today's Schedule ›");
    fireEvent.press(scheduleBtn);
    expect(navigateToTripScheduleSpy).toHaveBeenCalledWith({ tripId: 'trip-active-1' });

    // Live Waits button on Theme Parks section defaults to current park (EPCOT)
    const liveWaitsBtn = screen.getByTestId('home-parks-live-waits-link');
    fireEvent.press(liveWaitsBtn);
    expect(mockNavigate).toHaveBeenCalledWith('Explore', expect.objectContaining({
      screen: 'LiveWaits',
      params: { park: 'EPCOT' },
    }));

    // Leaderboard displays Land attached to park name
    expect(await screen.findByText('Magic Kingdom • Adventureland')).toBeTruthy();
  });

  describe('Regression: fabricated weather guard (Task 16.7, Requirement 2.6)', () => {
    it('never renders "78°" or "Sunny" when weather is loading or failed', async () => {
      mockApiRequest.mockImplementation(async (_method: string, path: string) => {
        if (path === '/me') {
          return { user: { id: 'u1', email: 'u1@example.com' }, profile: { displayName: 'User' } };
        }
        if (path === '/me/trips') {
          return [];
        }
        if (path === '/home/highest-rated') {
          return { entries: [] };
        }
        if (path === '/catalog') {
          return { experiences: [] };
        }
        if (path.startsWith('/parks/')) {
          return { park: 'Magic Kingdom', entries: [], retrievedAt: new Date().toISOString(), stale: false };
        }
        if (path.startsWith('/crowd-calendar')) {
          return {
            days: [
              {
                date: '2026-09-18',
                park: 'Magic Kingdom',
                forecastIndex: 5,
                parkHours: { openTime: '9:00 AM', closeTime: '10:00 PM' },
                earlyEntry: false,
                extendedEvening: false,
                ticketedEvent: false,
              },
            ],
          };
        }
        if (path === '/weather/current') {
          throw new Error('Weather service unavailable');
        }
        return {};
      });

      renderHome();

      await waitFor(() => {
        const subtitle = screen.getByTestId('home-hero-sub');
        expect(subtitle).toHaveTextContent('Magic Kingdom • 9:00 AM – 10:00 PM');
        expect(subtitle.props.children).not.toContain('78°');
        expect(subtitle.props.children).not.toContain('Sunny');
      });
    });

    it('never renders "78°" or "Sunny" when weather returns null observation', async () => {
      mockApiRequest.mockImplementation(async (_method: string, path: string) => {
        if (path === '/me') {
          return { user: { id: 'u1', email: 'u1@example.com' }, profile: { displayName: 'User' } };
        }
        if (path === '/me/trips') {
          return [];
        }
        if (path === '/home/highest-rated') {
          return { entries: [] };
        }
        if (path === '/catalog') {
          return { experiences: [] };
        }
        if (path.startsWith('/parks/')) {
          return { park: 'Magic Kingdom', entries: [], retrievedAt: new Date().toISOString(), stale: false };
        }
        if (path.startsWith('/crowd-calendar')) {
          return {
            days: [
              {
                date: '2026-09-18',
                park: 'Magic Kingdom',
                forecastIndex: 5,
                parkHours: { openTime: '9:00 AM', closeTime: '10:00 PM' },
                earlyEntry: false,
                extendedEvening: false,
                ticketedEvent: false,
              },
            ],
          };
        }
        if (path === '/weather/current') {
          return { current: null };
        }
        return {};
      });

      renderHome();

      await waitFor(() => {
        const subtitle = screen.getByTestId('home-hero-sub');
        expect(subtitle).toHaveTextContent('Magic Kingdom • 9:00 AM – 10:00 PM');
        expect(subtitle.props.children).not.toContain('78°');
        expect(subtitle.props.children).not.toContain('Sunny');
        expect(subtitle.props.children).not.toContain('°');
      });
    });

    it('renders real weather data and never the fabricated fallback when weather returns valid observation', async () => {
      mockApiRequest.mockImplementation(async (_method: string, path: string) => {
        if (path === '/me') {
          return { user: { id: 'u1', email: 'u1@example.com' }, profile: { displayName: 'User' } };
        }
        if (path === '/me/trips') {
          return [];
        }
        if (path === '/home/highest-rated') {
          return { entries: [] };
        }
        if (path === '/catalog') {
          return { experiences: [] };
        }
        if (path.startsWith('/parks/')) {
          return { park: 'Magic Kingdom', entries: [], retrievedAt: new Date().toISOString(), stale: false };
        }
        if (path.startsWith('/crowd-calendar')) {
          return {
            days: [
              {
                date: '2026-09-18',
                park: 'Magic Kingdom',
                forecastIndex: 5,
                parkHours: { openTime: '8:30 AM', closeTime: '11:00 PM' },
                earlyEntry: false,
                extendedEvening: false,
                ticketedEvent: false,
              },
            ],
          };
        }
        if (path === '/weather/current') {
          return { current: { tempF: 82, condition: 'Rain' } };
        }
        return {};
      });

      renderHome();

      await waitFor(() => {
        const subtitle = screen.getByTestId('home-hero-sub');
        expect(subtitle).toHaveTextContent('Magic Kingdom • 8:30 AM – 11:00 PM • 82° Rain');
        expect(subtitle.props.children).not.toContain('78°');
        expect(subtitle.props.children).not.toContain('Sunny');
      });
    });

    it('active-trip subtitle never renders hardcoded close times or castle emoji, and renders real park hours and weather when present', async () => {
      mockApiRequest.mockImplementation(async (_method: string, path: string) => {
        if (path === '/me') {
          return { user: { id: 'u1', email: 'u1@example.com' }, profile: { displayName: 'User' } };
        }
        if (path === '/me/trips') {
          const today = getTodayWDW();
          const [y, m, d] = today.split('-').map(Number);
          const endDate = new Date(Date.UTC(y!, m! - 1, d! + 4)).toISOString().slice(0, 10);
          return [
            {
              status: 'active',
              trips: [
                {
                  id: 'trip-active-1',
                  name: 'Spring Vacation',
                  description: 'Disney Trip',
                  startDate: today,
                  endDate,
                  status: 'active',
                  dayTouringHours: {
                    [today]: { startingPark: 'EPCOT' },
                  },
                },
              ],
            },
          ];
        }
        if (path === '/trips/trip-active-1/planned-items') {
          return [];
        }
        if (path === '/home/highest-rated') {
          return { entries: [] };
        }
        if (path === '/catalog') {
          return { experiences: [] };
        }
        if (path.startsWith('/parks/')) {
          return { park: 'EPCOT', entries: [], retrievedAt: new Date().toISOString(), stale: false };
        }
        if (path.startsWith('/crowd-calendar')) {
          const today = getTodayWDW();
          return {
            days: [
              {
                date: today,
                park: 'EPCOT',
                forecastIndex: 4,
                parkHours: { openTime: '9:00 AM', closeTime: '9:00 PM' },
                earlyEntry: false,
                extendedEvening: false,
                ticketedEvent: false,
              },
            ],
          };
        }
        if (path === '/weather/current') {
          return { current: { tempF: 86, condition: 'Clear' } };
        }
        return {};
      });

      renderHome();

      await waitFor(() => {
        const subtitle = screen.getByTestId('home-hero-sub');
        expect(subtitle).toHaveTextContent('EPCOT • Day 1 of 5 • 9:00 AM – 9:00 PM • 86° Clear');
        expect(subtitle.props.children).not.toContain('Park Closes');
        expect(subtitle.props.children).not.toContain('🏰');
        expect(subtitle.props.children).not.toContain('78°');
        expect(subtitle.props.children).not.toContain('Sunny');
      });
    });

    it('active-trip subtitle omits missing weather and hours without fabricating fallbacks', async () => {
      mockApiRequest.mockImplementation(async (_method: string, path: string) => {
        if (path === '/me') {
          return { user: { id: 'u1', email: 'u1@example.com' }, profile: { displayName: 'User' } };
        }
        if (path === '/me/trips') {
          const today = getTodayWDW();
          const [y, m, d] = today.split('-').map(Number);
          const endDate = new Date(Date.UTC(y!, m! - 1, d! + 4)).toISOString().slice(0, 10);
          return [
            {
              status: 'active',
              trips: [
                {
                  id: 'trip-active-1',
                  name: 'Spring Vacation',
                  description: 'Disney Trip',
                  startDate: today,
                  endDate,
                  status: 'active',
                  dayTouringHours: {
                    [today]: { startingPark: 'EPCOT' },
                  },
                },
              ],
            },
          ];
        }
        if (path === '/trips/trip-active-1/planned-items') {
          return [];
        }
        if (path === '/home/highest-rated') {
          return { entries: [] };
        }
        if (path === '/catalog') {
          return { experiences: [] };
        }
        if (path.startsWith('/parks/')) {
          return { park: 'EPCOT', entries: [], retrievedAt: new Date().toISOString(), stale: false };
        }
        if (path.startsWith('/crowd-calendar')) {
          return { days: [] };
        }
        if (path === '/weather/current') {
          return { current: null };
        }
        return {};
      });

      renderHome();

      await waitFor(() => {
        const subtitle = screen.getByTestId('home-hero-sub');
        expect(subtitle).toHaveTextContent('EPCOT • Day 1 of 5');
        expect(subtitle.props.children).not.toContain('Park Closes');
        expect(subtitle.props.children).not.toContain('9:00 PM');
        expect(subtitle.props.children).not.toContain('🏰');
        expect(subtitle.props.children).not.toContain('°');
        expect(subtitle.props.children).not.toContain('Sunny');
      });
    });
  });

  describe('dark mode', () => {
    afterEach(resetTestScheme);

    const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};

    /** Nearest ancestor (inclusive) whose flattened style paints a backgroundColor. */
    function paintedAncestor(node: ReactTestInstance): Record<string, unknown> {
      let cur: ReactTestInstance | null = node.parent;
      while (cur !== null) {
        if (typeof cur.type === 'string' && flat(cur).backgroundColor !== undefined) {
          return flat(cur);
        }
        cur = cur.parent;
      }
      return {};
    }

    it('(a)(b)(c) paints the screen, text and converted Home sections with dark values', async () => {
      setTestScheme('dark');
      renderHome();

      // (a) the ScreenContainer behind the hero header is the dark background.
      const header = await screen.findByTestId('home-header');
      expect(paintedAncestor(header).backgroundColor).toBe(darkTheme.color.background);

      // (b) primary text.
      expect(flat(await screen.findByText('Highest-Rated Experiences')).color).toBe(
        darkTheme.color.textPrimary,
      );

      // (c) converted tokens / palette values across the Home sections.
      expect(flat(screen.getByTestId('home-hero-title')).color).toBe(darkTheme.color.textOnPrimary);
      expect(flat(screen.getByTestId('home-greeting-pill')).color).toBe(darkTheme.color.accent);
      expect(flat(screen.getByText('See All')).color).toBe(darkTheme.color.primaryFg);
      const logBtn = flat(await screen.findByTestId('home-quick-log-ride'));
      expect(logBtn.borderColor).toBe(HOME_THEME_PARKS.dark.logBtnBorder);
      expect(logBtn.shadowColor).toBe(HOME_THEME_PARKS.dark.logBtnShadow);
      expect(logBtn.backgroundColor).toBe(HOME_THEME_PARKS.dark.logBtnBg);

      const parkCard = flat(await screen.findByTestId('home-park-tile-Magic Kingdom'));
      expect(parkCard.borderColor).toBe(HOME_THEME_PARKS.dark.tileBorder);
      expect(flat(screen.getByText('Animal Kingdom'))).toBeTruthy();

      const upcoming = flat(await screen.findByTestId('home-upcoming-trip-card'));
      expect(upcoming.borderColor).toBe(UPCOMING_TRIP_HERO.dark.cardBorder);
      expect(flat(await screen.findByText('UPCOMING VACATION')).color).toBe(darkTheme.color.primaryLight);
      expect(flat(screen.getByTestId('home-upcoming-trip-card-circle')).backgroundColor).toBe(
        UPCOMING_TRIP_HERO.dark.countdownBg,
      );

      expect(flat(screen.getByText('The Parks')).color).toBe(darkTheme.color.textPrimary);
    });

    it('renders a favorite pill status badge with its dark palette values', async () => {
      mockApiRequest.mockImplementation(async (_method: string, path: string) => {
        if (path === '/me/favorites') return { experienceIds: ['e-1'] };
        if (path === '/catalog') {
          return {
            experiences: [{ id: 'e-1', name: 'Space Mountain', park: 'Magic Kingdom', category: 'Ride' }],
          };
        }
        if (path.startsWith('/parks/')) {
          return {
            park: 'Magic Kingdom',
            entries: [{ experienceId: 'e-1', name: 'Space Mountain', status: 'OPERATING', waitMinutes: 35 }],
            retrievedAt: new Date().toISOString(),
            stale: false,
          };
        }
        if (path === '/home/highest-rated') return { entries: [] };
        if (path === '/me/trips') return [];
        return {};
      });
      setTestScheme('dark');
      renderHome();

      const pill = flat(await screen.findByTestId('home-favorite-pill-e-1'));
      expect(pill.borderColor).toBe(HOME_FAVORITES.dark.pillBorder);
      expect(pill.borderTopColor).toBe(darkTheme.parkAccent['Magic Kingdom']);
      // 35 min → the moderate (amber/orange) badge.
      expect(flat(screen.getByTestId('home-favorite-wait-e-1')).color).toBe(
        HOME_FAVORITES.dark.moderateText,
      );
    });

    it('keeps the pre-retrofit light values under light', async () => {
      renderHome();
      const header = await screen.findByTestId('home-header');
      expect(paintedAncestor(header).backgroundColor).toBe('#f5f2fb');
      expect(flat(screen.getByTestId('home-hero-title')).color).toBe('#ffffff');
      expect(flat(screen.getByTestId('home-greeting-pill')).color).toBe('#f6c343');
      const logBtn = flat(await screen.findByTestId('home-quick-log-ride'));
      expect(logBtn.borderColor).toBe('#e9d5ff');
      expect(logBtn.shadowColor).toBe('#5b2a86');
      expect(flat(await screen.findByTestId('home-park-tile-Magic Kingdom'))).toBeTruthy();
      expect(flat(screen.getByText('The Parks'))).toBeTruthy();
      expect(flat(await screen.findByText('UPCOMING VACATION')).color).toBe('#7e57c2');
    });
  });
});

