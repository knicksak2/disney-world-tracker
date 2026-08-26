// Feature: catalog-taxonomy-cleanup, Task 8.1: ExperienceDetailScreen tests for new categories
// Requirements: 5.1, 5.2, 5.3, 5.4, 5.5

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

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

import ExperienceDetailScreen from '../ExperienceDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { LiveDetailResponseDTO } from '@dwt/shared';

type CatalogStackParamList = {
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

function renderDetail(experienceId: string): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<CatalogStackParamList>();
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailScreen}
            initialParams={{ experienceId }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

function stubScreenApi(options: {
  id: string;
  category: string;
  name: string;
  live?: LiveDetailResponseDTO | null;
}) {
  const { id, category, name, live } = options;
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.startsWith('/resorts')) {
      return { resorts: [] };
    }
    if (path === `/catalog/${id}`) {
      return {
        id,
        name,
        park: 'Magic Kingdom',
        category,
        description: `Description for ${name}`,
        areaType: 'ThemePark',
        land: 'Adventureland',
      };
    }
    if (path === `/catalog/${id}/live`) {
      if (live) {
        return live;
      }
      throw new ApiError({
        code: 'live_unavailable',
        message: 'no live detail',
        status: 503,
      });
    }
    if (path.endsWith('/completion')) {
      throw new ApiError({
        code: 'completion_not_found',
        message: 'no completion',
        status: 404,
      });
    }
    if (path.endsWith('/rating')) {
      throw new ApiError({
        code: 'rating_not_found',
        message: 'no rating',
        status: 404,
      });
    }
    if (path.endsWith('/note')) {
      throw new ApiError({
        code: 'note_not_found',
        message: 'no note',
        status: 404,
      });
    }
    if (path === `/experiences/${id}/aggregate-rating`) {
      return { value: null, count: 0 };
    }
    throw new Error(`unexpected call to ${path}`);
  });
}

describe('ExperienceDetailScreen Taxonomy Live Gating (Task 8.1, Requirements 5.1-5.5)', () => {
  it('Requirement 5.1: Walkthrough with standby wait renders wait time and status section', async () => {
    const live: LiveDetailResponseDTO = {
      liveDetail: {
        status: 'Operating',
        waitMinutes: 15,
        showtimes: [],
        operatingHours: [],
        diningAvailability: [],
      },
      retrievedAt: '2026-08-25T12:00:00Z',
      stale: false,
    };

    stubScreenApi({
      id: 'walkthrough-1',
      name: 'Swiss Family Treehouse',
      category: 'Walkthrough',
      live,
    });

    renderDetail('walkthrough-1');

    await waitFor(() => {
      expect(screen.getByText('Swiss Family Treehouse')).toBeTruthy();
    });

    // Should render wait time section (e.g. 15 min standby wait)
    expect(screen.getByTestId('standby-wait')).toBeTruthy();
    expect(screen.getByText('15 min')).toBeTruthy();
  });

  it('Requirement 5.2: Walkthrough without standby wait renders no live operational section', async () => {
    const live: LiveDetailResponseDTO = {
      liveDetail: {
        status: 'Operating',
        showtimes: [],
        operatingHours: [],
        diningAvailability: [],
      },
      retrievedAt: '2026-08-25T12:00:00Z',
      stale: false,
    };

    stubScreenApi({
      id: 'walkthrough-2',
      name: 'Swiss Family Treehouse',
      category: 'Walkthrough',
      live,
    });

    renderDetail('walkthrough-2');

    await waitFor(() => {
      expect(screen.getByText('Swiss Family Treehouse')).toBeTruthy();
    });

    // Does not render standby wait indicators or live section
    expect(screen.queryByTestId('ride-live-section')).toBeNull();
    expect(screen.queryByTestId('standby-wait')).toBeNull();
  });

  it('Requirement 5.3: Show without showtimes but with standby wait renders wait time section', async () => {
    const live: LiveDetailResponseDTO = {
      liveDetail: {
        status: 'Operating',
        waitMinutes: 20,
        showtimes: [],
        operatingHours: [],
        diningAvailability: [],
      },
      retrievedAt: '2026-08-25T12:00:00Z',
      stale: false,
    };

    stubScreenApi({
      id: 'show-1',
      name: 'Country Bear Musical Jamboree',
      category: 'Show',
      live,
    });

    renderDetail('show-1');

    await waitFor(() => {
      expect(screen.getByText('Country Bear Musical Jamboree')).toBeTruthy();
    });

    expect(screen.getByTestId('standby-wait')).toBeTruthy();
    expect(screen.getByText('20 min')).toBeTruthy();
  });

  it('Requirement 5.5: Structural category (Tour/Recreation/Spa/Event/Other/Resort) renders no live section', async () => {
    stubScreenApi({
      id: 'tour-1',
      name: 'Keys to the Kingdom Tour',
      category: 'Tour',
      live: null,
    });

    renderDetail('tour-1');

    await waitFor(() => {
      expect(screen.getByText('Keys to the Kingdom Tour')).toBeTruthy();
    });

    expect(screen.queryByTestId('ride-live-section')).toBeNull();
    expect(screen.queryByTestId('standby-wait')).toBeNull();
  });
});
