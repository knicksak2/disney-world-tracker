// Feature: experience-favorites — FavoriteToggle in ExperienceDetailScreen header
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, Property 5 at component level

import React from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-secure-store', () => {
  const store = new Map();
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
import { useFavoritedExperiences } from '../useFavoritedExperiences';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const EXPERIENCE_ID = '33333333-3333-3333-3333-333333333333';

const DETAIL = {
  id: EXPERIENCE_ID,
  name: 'Space Mountain',
  park: 'Magic Kingdom',
  category: 'Ride',
  description: 'Blast off on a high-speed roller coaster in the dark.',
  imageUrl: null,
  areaType: 'Park',
  latitude: 28.419,
  longitude: -81.581,
};

/** Second consumer in the same QueryClient context to verify Property 5 cache convergence */
function SecondFavoritesConsumer(): JSX.Element {
  const favoritedIds = useFavoritedExperiences();
  return (
    <View testID="second-consumer">
      <Text testID="second-consumer-status">
        {favoritedIds.has(EXPERIENCE_ID) ? 'favorited' : 'unfavorited'}
      </Text>
    </View>
  );
}

function renderScreenWithConsumer(initialFavorited: boolean) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  apiRequestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === `/catalog/${EXPERIENCE_ID}`) {
      return DETAIL;
    }
    if (method === 'GET' && path === '/me/favorites') {
      return { experienceIds: initialFavorited ? [EXPERIENCE_ID] : [] };
    }
    if (method === 'GET' && path === '/trips') {
      return { trips: [] };
    }
    if (method === 'GET' && path.includes('/wait-history')) {
      return { hourlyAverages: [] };
    }
    if (method === 'GET' && path.includes('/crowds/prediction')) {
      return { crowdMultiplier: 1 };
    }
    if (method === 'GET' && path.includes('/reviews')) {
      return { reviews: [] };
    }
    if (method === 'GET' && path.includes('/experience-lists')) {
      return { lists: [] };
    }
    if (method === 'PUT' && path === `/me/experiences/${EXPERIENCE_ID}/favorite`) {
      return undefined;
    }
    if (method === 'DELETE' && path === `/me/experiences/${EXPERIENCE_ID}/favorite`) {
      return undefined;
    }
    return {};
  });

  const Stack = createNativeStackNavigator();

  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <SecondFavoritesConsumer />
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen
              name="ExperienceDetail"
              component={ExperienceDetailScreen}
              initialParams={{ experienceId: EXPERIENCE_ID }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    ),
  };
}

describe('ExperienceDetailScreen — FavoriteToggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders both the share button and favorite toggle in the header', async () => {
    renderScreenWithConsumer(false);

    await waitFor(() => {
      expect(screen.getByTestId('experience-share-button')).toBeTruthy();
      expect(screen.getByTestId(`favorite-toggle-${EXPERIENCE_ID}`)).toBeTruthy();
    });
  });

  it('taps toggle from unfavorited to favorited: calls PUT and updates second consumer', async () => {
    renderScreenWithConsumer(false);

    await waitFor(() => {
      expect(screen.getByTestId(`favorite-toggle-${EXPERIENCE_ID}`)).toBeTruthy();
    });

    const toggle = screen.getByTestId(`favorite-toggle-${EXPERIENCE_ID}`);
    expect(toggle.props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId('second-consumer-status').props.children).toBe('unfavorited');

    // When PUT settles, subsequent GET /me/favorites should return the new set
    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'PUT' && path === `/me/experiences/${EXPERIENCE_ID}/favorite`) {
        return undefined;
      }
      if (method === 'GET' && path === '/me/favorites') {
        return { experienceIds: [EXPERIENCE_ID] };
      }
      if (method === 'GET' && path === `/catalog/${EXPERIENCE_ID}`) {
        return DETAIL;
      }
      return {};
    });

    fireEvent.press(toggle);

    // Optimistic or settled update reflects in toggle
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/experiences/${EXPERIENCE_ID}/favorite`);
    });

    // Invalidation updates second consumer
    await waitFor(() => {
      expect(screen.getByTestId('second-consumer-status').props.children).toBe('favorited');
    });
  });

  it('taps toggle from favorited to unfavorited: calls DELETE and updates second consumer', async () => {
    renderScreenWithConsumer(true);

    await waitFor(() => {
      expect(screen.getByTestId(`favorite-toggle-${EXPERIENCE_ID}`)).toBeTruthy();
    });

    const toggle = screen.getByTestId(`favorite-toggle-${EXPERIENCE_ID}`);
    await waitFor(() => {
      expect(toggle.props.accessibilityState).toEqual({ selected: true });
    });
    expect(screen.getByTestId('second-consumer-status').props.children).toBe('favorited');

    // When DELETE settles, subsequent GET /me/favorites returns empty
    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'DELETE' && path === `/me/experiences/${EXPERIENCE_ID}/favorite`) {
        return undefined;
      }
      if (method === 'GET' && path === '/me/favorites') {
        return { experienceIds: [] };
      }
      if (method === 'GET' && path === `/catalog/${EXPERIENCE_ID}`) {
        return DETAIL;
      }
      return {};
    });

    fireEvent.press(toggle);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', `/me/experiences/${EXPERIENCE_ID}/favorite`);
    });

    await waitFor(() => {
      expect(screen.getByTestId('second-consumer-status').props.children).toBe('unfavorited');
    });
  });
});
