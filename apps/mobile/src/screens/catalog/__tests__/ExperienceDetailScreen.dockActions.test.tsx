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

  it('posts to planned-items when tapping Add to trip in dock on Today lens', async () => {
    renderScreen({ experienceId: EXPERIENCE_ID, initialLens: 'today' });

    await waitFor(() => {
      expect(screen.getByTestId('dock-secondary-action')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-secondary-action'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/planned-items`,
        { experienceId: EXPERIENCE_ID },
      );
    });
  });

  it('posts to planned-items when tapping Add to trip in dock on Passport lens', async () => {
    renderScreen({ experienceId: EXPERIENCE_ID, initialLens: 'passport' });

    await waitFor(() => {
      expect(screen.getByTestId('dock-secondary-action')).toBeTruthy();
      expect(screen.getByText(/Add to trip/i)).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('dock-secondary-action'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/planned-items`,
        { experienceId: EXPERIENCE_ID },
      );
    });
  });

  it('shows No Active Trip alert when tapping Add to trip with no active or upcoming trips', async () => {
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
      expect(alertSpy).toHaveBeenCalledWith(
        'No Active Trip',
        expect.stringContaining("You don't have an active or upcoming trip yet"),
        expect.any(Array),
      );
    });

    alertSpy.mockRestore();
  });
});
