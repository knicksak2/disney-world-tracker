/**
 * Component tests for DestinationScreen in-destination search rendering
 * and accessibility announcements.
 *
 * Validates: Requirements 5.9, 12.8
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ExperienceDTO } from '@dwt/shared';

// Mocks
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
    __reset: () => {
      store.clear();
    },
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

import DestinationScreen from '../DestinationScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type { DestinationId } from '../destinations';

type CatalogStackParamList = {
  DestinationScreen: { destination: DestinationId };
  ExperienceDetail: { experienceId: string };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

const Stack = createNativeStackNavigator<CatalogStackParamList>();

function renderScreen(destination: DestinationId) {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="DestinationScreen">
          <Stack.Screen
            name="DestinationScreen"
            component={DestinationScreen}
            initialParams={{ destination }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

function stub(
  experiences: readonly ExperienceDTO[],
): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.startsWith('/catalog')) {
      return { experiences, staleCache: false };
    }
    if (path === '/me') {
      return { user: { id: 'viewer', email: 'viewer@test.local' } };
    }
    if (path.endsWith('/completions')) {
      return { entries: [] };
    }
    return {};
  });
}

describe('DestinationScreen in-destination search', () => {
  const mockExperiences: ExperienceDTO[] = [
    {
      id: 'exp-runaway',
      name: "Mickey & Minnie's Runaway Railway",
      park: 'Hollywood Studios',
      category: 'Ride',
      description: 'Runaway train adventure',
      active: true,
      imageUrl: null,
      areaType: 'ThemePark',
      land: 'Animation Courtyard',
    },
    {
      id: 'exp-tower',
      name: 'The Twilight Zone Tower of Terror™',
      park: 'Hollywood Studios',
      category: 'Ride',
      description: 'Haunted elevator drop',
      active: true,
      imageUrl: null,
      areaType: 'ThemePark',
      land: 'Sunset Boulevard',
    },
    {
      id: 'exp-peter',
      name: "Peter Pan's Flight",
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'Flight over London',
      active: true,
      imageUrl: null,
      areaType: 'ThemePark',
      land: 'Fantasyland',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    stub(mockExperiences);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('filters and displays experiences by normalized relevance when searching', async () => {
    renderScreen('Hollywood Studios');

    // Wait for experiences to load
    await screen.findByTestId('destination-search');

    const searchInput = screen.getByTestId('destination-search');

    // Type query with "and" connector
    fireEvent.changeText(searchInput, 'Mickey and Minnie');

    // Assert Runaway Railway row is displayed
    const row = await screen.findByTestId('destination-row-exp-runaway');
    expect(row).toBeTruthy();

    // Tower of Terror should not match
    expect(screen.queryByTestId('destination-row-exp-tower')).toBeNull();
  });

  it('handles apostrophe-free queries correctly', async () => {
    renderScreen('Magic Kingdom');

    await screen.findByTestId('destination-search');
    const searchInput = screen.getByTestId('destination-search');

    fireEvent.changeText(searchInput, 'Peter Pans Flight');

    const row = await screen.findByTestId('destination-row-exp-peter');
    expect(row).toBeTruthy();
  });

  it('announces result count for accessibility on query changes', async () => {
    renderScreen('Hollywood Studios');

    await screen.findByTestId('destination-search');
    const searchInput = screen.getByTestId('destination-search');

    // First search query matches all Hollywood Studios experiences (2)
    fireEvent.changeText(searchInput, 'o');
    await screen.findByTestId('destination-row-exp-runaway');

    // Narrowing query changes count from 2 to 1
    fireEvent.changeText(searchInput, 'Mickey');
    await screen.findByTestId('destination-row-exp-runaway');

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      expect.stringContaining('1 experience'),
    );
  });
});
