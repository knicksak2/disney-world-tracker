import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  };
});

import ExperienceDetailScreen from '../ExperienceDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

type CatalogStackParamList = {
  ExperienceDetail: { experienceId: string; initialLens?: 'today' | 'passport' };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function setupRecreationMocks(experienceId: string, customDetail?: any) {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.startsWith('/resorts')) {
      return {
        resorts: [
          {
            id: 'resort-coronado',
            name: "Disney's Coronado Springs Resort",
            tier: 'Moderate',
          },
          {
            id: 'resort-riviera',
            name: "Disney's Riviera Resort",
            tier: 'Deluxe Villa',
          },
        ],
      };
    }
    if (path === `/catalog/${experienceId}`) {
      if (customDetail) return customDetail;
      // If network returns 404, fallback handles it
      throw new ApiError({ code: 'experience_not_found', message: 'Not found in test mock', status: 404 });
    }
    if (path.endsWith('/completion')) {
      throw new ApiError({ code: 'completion_not_found', message: 'no completion', status: 404 });
    }
    if (path.endsWith('/rating')) {
      throw new ApiError({ code: 'rating_not_found', message: 'no rating', status: 404 });
    }
    if (path.endsWith('/note')) {
      throw new ApiError({ code: 'note_not_found', message: 'no note', status: 404 });
    }
    if (path === `/experiences/${experienceId}/aggregate-rating`) {
      return { value: null, count: 0 };
    }
    if (path.includes('/food-item-logs')) {
      return [];
    }
    if (path.startsWith('/me/trips')) {
      return [];
    }
    if (path.endsWith('/logs')) {
      return { repeatCount: 0, logs: [] };
    }
    throw new Error(`unexpected call to ${path}`);
  });
}

function renderScreen(experienceId: string) {
  const Stack = createNativeStackNavigator<CatalogStackParamList>();
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

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

describe('ExperienceDetailScreen - Resort Recreation Experiences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders Colors of Coronado Painting Experience with full details and recreation taxonomy', async () => {
    const expId = 'b1010001-c001-4000-8000-000000000001';
    setupRecreationMocks(expId);

    renderScreen(expId);

    // Assert title is rendered
    await waitFor(() => {
      expect(screen.getByText('Colors of Coronado Painting Experience')).toBeTruthy();
    });

    // Assert quick specs chips
    expect(screen.getByText('Resort Activity')).toBeTruthy();
    expect(screen.getAllByText('Arts & Crafts').length).toBeGreaterThanOrEqual(1);

    // Assert location in Today lens
    expect(screen.getByText("Disney's Coronado Springs Resort • Gran Destino Tower")).toBeTruthy();

    // Switch to My Passport & Lore lens to verify description
    fireEvent.press(screen.getByTestId('lens-tab-passport'));

    // Assert description is rendered
    await waitFor(() => {
      expect(
        screen.getByText(
          'Paint an iconic Disney masterpiece alongside master artists overlooking panoramic views from Gran Destino Tower.',
        ),
      ).toBeTruthy();
    });
  });

  it('renders Painting on the Riviera with rich details', async () => {
    const expId = 'b1010001-c001-4000-8000-000000000004';
    setupRecreationMocks(expId);

    renderScreen(expId);

    await waitFor(() => {
      expect(screen.getByText('Painting on the Riviera')).toBeTruthy();
    });

    expect(screen.getByText('Resort Activity')).toBeTruthy();
    expect(screen.getAllByText("Disney's Riviera Resort").length).toBeGreaterThanOrEqual(1);

    // Switch to My Passport & Lore lens to verify description
    fireEvent.press(screen.getByTestId('lens-tab-passport'));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Create your own Mediterranean-inspired acrylic painting on canvas with guidance from a Disney artist at Topolino's Terrace.",
        ),
      ).toBeTruthy();
    });
  });
});
