/**
 * Component and interaction tests for HomeScreen.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { apiRequest } from '../../../api/client';
import { useClaimablePinsBadge } from '../../../components/pins/useClaimablePinsBadge';
import * as navigationRefModule from '../../../navigation/navigationRef';
import { getTodayWDW } from '../../trips/TripScheduleScreen';
import HomeScreen from '../HomeScreen';

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

  it('renders the upcoming vacation countdown card and handles tap to view trip', async () => {
    const navigateToTripDetailSpy = jest
      .spyOn(navigationRefModule, 'navigateToTripDetail')
      .mockReturnValue(true);

    renderHome();

    const countdownCard = await screen.findByTestId('home-upcoming-trip-card');
    expect(countdownCard).toBeTruthy();
    expect(screen.getByText('UPCOMING VACATION')).toBeTruthy();
    expect(screen.getByText('Fall Magic Trip')).toBeTruthy();

    fireEvent.press(countdownCard);
    expect(navigateToTripDetailSpy).toHaveBeenCalledWith({ tripId: 'trip-fall-magic' });

    navigateToTripDetailSpy.mockRestore();
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

  it('renders the 4 action dock tiles with badge and handles Live Waits tap', async () => {
    const navigateToLiveWaitsSpy = jest
      .spyOn(navigationRefModule, 'navigateToLiveWaits')
      .mockReturnValue(true);

    renderHome();

    expect(await screen.findByTestId('home-action-dock')).toBeTruthy();
    expect(screen.getByTestId('home-dock-live-waits')).toBeTruthy();
    expect(screen.getByTestId('home-dock-log-ride')).toBeTruthy();
    expect(screen.getByTestId('home-dock-log-snack')).toBeTruthy();
    expect(screen.getByTestId('home-dock-my-pins')).toBeTruthy();
    expect(screen.getByTestId('home-dock-pins-badge')).toHaveTextContent('2');

    fireEvent.press(screen.getByTestId('home-dock-live-waits'));
    expect(mockNavigate).toHaveBeenCalledWith('Explore', expect.objectContaining({
      screen: 'LiveWaits',
      params: { park: 'Magic Kingdom' },
    }));

    navigateToLiveWaitsSpy.mockRestore();
  });

  it('opens experience picker for Log Ride and Log Snack from action dock', async () => {
    renderHome();

    // Log Ride
    const logRideBtn = await screen.findByTestId('home-dock-log-ride');
    fireEvent.press(logRideBtn);

    expect(await screen.findByTestId('home-experience-picker-modal')).toBeTruthy();
    expect(screen.getByTestId('home-picker-title')).toHaveTextContent('Select Attraction to Log');

    // Close picker
    fireEvent.press(screen.getByTestId('home-picker-close-btn'));

    // Log Snack
    const logSnackBtn = screen.getByTestId('home-dock-log-snack');
    fireEvent.press(logSnackBtn);

    expect(await screen.findByTestId('home-experience-picker-modal')).toBeTruthy();
    expect(screen.getByTestId('home-picker-title')).toHaveTextContent('Select Restaurant to Log Food');
  });

  it('renders the Park Wait Pulse carousel and navigates to LiveWaits on park tap', async () => {
    renderHome();

    expect(await screen.findByTestId('home-park-wait-pulse')).toBeTruthy();
    expect(screen.getByText('Park Wait Pulse')).toBeTruthy();

    const mkPill = await screen.findByTestId('home-pulse-pill-Magic Kingdom');
    expect(mkPill).toBeTruthy();

    fireEvent.press(mkPill);
    expect(mockNavigate).toHaveBeenCalledWith('Explore', expect.objectContaining({
      screen: 'LiveWaits',
      params: { park: 'Magic Kingdom' },
    }));
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

    // ActionDock switches tile 4 to Day 1 Plan and navigates to TripSchedule
    const dayPlanBtn = screen.getByTestId('home-dock-my-pins');
    expect(dayPlanBtn).toHaveTextContent(/Day 1 Plan/);
    fireEvent.press(dayPlanBtn);
    expect(navigateToTripScheduleSpy).toHaveBeenCalledWith({ tripId: 'trip-active-1' });

    // Live Waits button defaults to current park (EPCOT)
    const liveWaitsBtn = screen.getByTestId('home-dock-live-waits');
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
});

