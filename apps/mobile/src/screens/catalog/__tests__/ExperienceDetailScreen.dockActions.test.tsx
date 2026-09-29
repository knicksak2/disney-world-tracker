// Feature: experience-detail-redesign — FloatingActionDock in ExperienceDetailScreen
//
// Validates: Requirement 19.1, 19.2, 19.3, 19.5
//
// Asserts that activating the FloatingActionDock buttons on ExperienceDetailScreen
// opens the respective modals (LogVisitModal, RateExperienceModal) and triggers
// the plan action.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

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

import { apiRequest as mockedApiRequest } from '../../../api/client';
import ExperienceDetailScreen from '../ExperienceDetailScreen';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const EXPERIENCE_ID = '33333333-3333-3333-3333-333333333333';
const TRIP_ID = 'trip-123';

const DETAIL = {
  id: EXPERIENCE_ID,
  name: 'Pirates of the Caribbean',
  park: 'Magic Kingdom',
  category: 'Ride',
  description: 'Sail through the Golden Age of Piracy.',
  imageUrl: null,
  areaType: 'Park',
  latitude: 28.419,
  longitude: -81.581,
};

const TRIPS_ACTIVE = {
  trips: [
    {
      id: TRIP_ID,
      name: 'Family Disney Trip',
      status: 'active',
      startDate: '2026-09-24',
      endDate: '2026-09-30',
    },
  ],
};

function renderScreen(initialParams: { experienceId: string; initialLens?: 'today' | 'passport' }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const Stack = createNativeStackNavigator();

  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailScreen}
            initialParams={initialParams}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('ExperienceDetailScreen FloatingActionDock Actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/catalog/${EXPERIENCE_ID}`) return DETAIL as any;
      if (path === `/me/experiences/${EXPERIENCE_ID}/completion`) return null as any;
      if (path === `/me/experiences/${EXPERIENCE_ID}/rating`) return null as any;
      if (path === `/me/experiences/${EXPERIENCE_ID}/note`) return null as any;
      if (path === `/experiences/${EXPERIENCE_ID}/aggregate-rating`) {
        return { value: 8.5, count: 12 } as any;
      }
      if (path === `/me/experiences/${EXPERIENCE_ID}/logs`) {
        return { repeatCount: 1, logs: [] } as any;
      }
      if (path === `/catalog/${EXPERIENCE_ID}/live`) {
        return {
          operatingStatus: 'OPERATING',
          liveDetail: { waitMinutes: 15, showtimes: [] },
        } as any;
      }
      if (path.startsWith('/me/trips')) return TRIPS_ACTIVE as any;
      if (path === `/trips/${TRIP_ID}/planned-items`) return [] as any;
      return null as any;
    });
  });

  it('opens LogVisitModal when tapping primary action in dock', async () => {
    renderScreen({ experienceId: EXPERIENCE_ID, initialLens: 'today' });

    await waitFor(() => {
      expect(screen.getByTestId('dock-primary-action')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-primary-action'));

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-modal')).toBeTruthy();
    });
  });

  // Feature: experience-lists, Requirement 17 — the dock's secondary action
  // now opens a two-option choice sheet instead of posting to planned-items
  // directly. Feature: experience-lists, Requirement 18 — choosing "Add to
  // Trip" from that sheet always opens a Trip picker (Property 22, even for
  // a single eligible Trip) rather than silently posting; these tests tap
  // through both sheets before asserting the same, unchanged POST behavior.

  it('posts to planned-items for the single eligible trip after tapping through the choice sheet and trip picker (Today lens)', async () => {
    renderScreen({ experienceId: EXPERIENCE_ID, initialLens: 'today' });

    await waitFor(() => {
      expect(screen.getByTestId('dock-secondary-action')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-secondary-action'));

    await waitFor(() => {
      expect(screen.getByTestId('add-to-trip-or-list-choice-trip')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('add-to-trip-or-list-choice-trip'));

    // Property 22: the Trip picker is presented even though there is only
    // one eligible Trip — no silent auto-select.
    await waitFor(() => {
      expect(screen.getByTestId('add-to-trip-picker-sheet')).toBeTruthy();
      expect(screen.getByTestId(`add-to-trip-picker-${TRIP_ID}`)).toBeTruthy();
    });
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'POST',
      `/trips/${TRIP_ID}/planned-items`,
      expect.anything(),
    );

    fireEvent.press(screen.getByTestId(`add-to-trip-picker-${TRIP_ID}`));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/planned-items`,
        { experienceId: EXPERIENCE_ID },
      );
    });
  });

  it('posts to planned-items for the selected trip after tapping through the choice sheet and trip picker (Passport lens)', async () => {
    renderScreen({ experienceId: EXPERIENCE_ID, initialLens: 'passport' });

    await waitFor(() => {
      expect(screen.getByTestId('dock-secondary-action')).toBeTruthy();
      expect(screen.getByText('Add to…')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-secondary-action'));

    await waitFor(() => {
      expect(screen.getByTestId('add-to-trip-or-list-choice-trip')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('add-to-trip-or-list-choice-trip'));

    await waitFor(() => {
      expect(screen.getByTestId(`add-to-trip-picker-${TRIP_ID}`)).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId(`add-to-trip-picker-${TRIP_ID}`));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/planned-items`,
        { experienceId: EXPERIENCE_ID },
      );
    });
  });

  it('posts to the specific trip the user selected out of multiple eligible trips (Property 23)', async () => {
    const OTHER_TRIP_ID = 'trip-456';
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path === `/catalog/${EXPERIENCE_ID}`) return DETAIL as any;
      if (path === `/me/experiences/${EXPERIENCE_ID}/completion`) return null as any;
      if (path === `/me/experiences/${EXPERIENCE_ID}/rating`) return null as any;
      if (path === `/me/experiences/${EXPERIENCE_ID}/note`) return null as any;
      if (path === `/experiences/${EXPERIENCE_ID}/aggregate-rating`) {
        return { value: 8.5, count: 12 } as any;
      }
      if (path === `/me/experiences/${EXPERIENCE_ID}/logs`) {
        return { repeatCount: 1, logs: [] } as any;
      }
      if (path === `/catalog/${EXPERIENCE_ID}/live`) {
        return {
          operatingStatus: 'OPERATING',
          liveDetail: { waitMinutes: 15, showtimes: [] },
        } as any;
      }
      if (path.startsWith('/me/trips')) {
        return {
          trips: [
            {
              id: TRIP_ID,
              name: 'Family Disney Trip',
              status: 'active',
              startDate: '2026-09-24',
              endDate: '2026-09-30',
            },
            {
              id: OTHER_TRIP_ID,
              name: 'Solo December Trip',
              status: 'upcoming',
              startDate: '2026-12-01',
              endDate: '2026-12-05',
            },
          ],
        } as any;
      }
      return null as any;
    });

    renderScreen({ experienceId: EXPERIENCE_ID, initialLens: 'today' });

    await waitFor(() => {
      expect(screen.getByTestId('dock-secondary-action')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-secondary-action'));
    await waitFor(() => {
      expect(screen.getByTestId('add-to-trip-or-list-choice-trip')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('add-to-trip-or-list-choice-trip'));

    await waitFor(() => {
      expect(screen.getByTestId(`add-to-trip-picker-${TRIP_ID}`)).toBeTruthy();
      expect(screen.getByTestId(`add-to-trip-picker-${OTHER_TRIP_ID}`)).toBeTruthy();
    });

    // Each row shows its own status badge, matching its actual TripDTO.status.
    expect(screen.getByTestId(`add-to-trip-picker-status-${TRIP_ID}`)).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByTestId(`add-to-trip-picker-status-${OTHER_TRIP_ID}`)).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();

    // Select the second Trip, not the first.
    fireEvent.press(screen.getByTestId(`add-to-trip-picker-${OTHER_TRIP_ID}`));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${OTHER_TRIP_ID}/planned-items`,
        { experienceId: EXPERIENCE_ID },
      );
    });
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'POST',
      `/trips/${TRIP_ID}/planned-items`,
      expect.anything(),
    );
  });

  it('dismisses the trip picker via backdrop with no POST', async () => {
    renderScreen({ experienceId: EXPERIENCE_ID, initialLens: 'today' });

    await waitFor(() => {
      expect(screen.getByTestId('dock-secondary-action')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-secondary-action'));
    await waitFor(() => {
      expect(screen.getByTestId('add-to-trip-or-list-choice-trip')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('add-to-trip-or-list-choice-trip'));

    await waitFor(() => {
      expect(screen.getByTestId('add-to-trip-picker-backdrop')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('add-to-trip-picker-backdrop'));

    await waitFor(() => {
      expect(screen.queryByTestId('add-to-trip-picker-sheet')).toBeNull();
    });
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'POST',
      `/trips/${TRIP_ID}/planned-items`,
      expect.anything(),
    );
  });

  it('shows No Active Trip alert with no active or upcoming trips (no picker shown, Property 22)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path.startsWith('/me/trips')) return { trips: [] } as any;
      if (path === `/catalog/${EXPERIENCE_ID}`) return DETAIL as any;
      if (path === `/catalog/${EXPERIENCE_ID}/live`) {
        return {
          operatingStatus: 'OPERATING',
          liveDetail: { waitMinutes: 15, showtimes: [] },
        } as any;
      }
      if (path === `/experiences/${EXPERIENCE_ID}/aggregate-rating`) {
        return { value: 8.5, count: 12 } as any;
      }
      if (path === `/me/experiences/${EXPERIENCE_ID}/logs`) {
        return { repeatCount: 1, logs: [] } as any;
      }
      return null as any;
    });

    renderScreen({ experienceId: EXPERIENCE_ID, initialLens: 'today' });

    await waitFor(() => {
      expect(screen.getByTestId('dock-secondary-action')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-secondary-action'));

    await waitFor(() => {
      expect(screen.getByTestId('add-to-trip-or-list-choice-trip')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('add-to-trip-or-list-choice-trip'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'No Active Trip',
        expect.stringContaining("You don't have an active or upcoming trip yet"),
        expect.any(Array),
      );
    });
    expect(screen.queryByTestId('add-to-trip-picker-sheet')).toBeNull();

    alertSpy.mockRestore();
  });

  it('omits Trip context chip in LiveWaitCockpit when user has only past trips (Requirement 16.4)', async () => {
    apiRequestMock.mockImplementation(async (_method: string, path: string) => {
      if (path.startsWith('/me/trips')) {
        return [
          {
            status: 'past',
            trips: [
              {
                id: 'past-trip-1',
                name: 'Past Vacation',
                status: 'past',
                startDate: '2024-01-01',
                endDate: '2024-01-05',
              },
            ],
          },
        ] as any;
      }
      if (path === `/catalog/${EXPERIENCE_ID}`) return DETAIL as any;
      if (path === `/catalog/${EXPERIENCE_ID}/live`) {
        return {
          operatingStatus: 'OPERATING',
          liveDetail: { waitMinutes: 15, showtimes: [] },
        } as any;
      }
      if (path === `/experiences/${EXPERIENCE_ID}/wait-insights`) {
        return {
          p50WaitMinutes: 15,
          p90WaitMinutes: 30,
          downRate: 0.05,
          waits: [],
        } as any;
      }
      return null as any;
    });

    renderScreen({ experienceId: EXPERIENCE_ID, initialLens: 'today' });

    await waitFor(() => {
      expect(screen.getByTestId('wait-context-now')).toBeTruthy();
      expect(screen.getByTestId('wait-context-typical')).toBeTruthy();
    });

    // R16.4: Trip chip MUST be omitted when the user has only past trips
    expect(screen.queryByTestId('wait-context-trip')).toBeNull();
  });
});

