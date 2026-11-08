import React from 'react';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import ExperienceDetailScreen from '../ExperienceDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

type CatalogStackParamList = {
  ExperienceDetail: { experienceId: string; initialLens?: 'today' | 'passport' };
  HiddenMickeys: { experienceId?: string; initialPark?: string };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

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

const Stack = createNativeStackNavigator<CatalogStackParamList>();

function fullyPopulatedFixture(id: string) {
  return {
    id,
    name: 'Jungle Cruise',
    park: 'Magic Kingdom',
    category: 'Ride',
    description: 'Scenic and comedic boat tour.',
    imageUrl: 'https://example.com/jungle.jpg',
    land: 'Adventureland',
    resortId: null,
    resortArea: null,
    latitude: 28.418,
    longitude: -81.584,
    areaType: 'park',
    accessibility: ['no-service-animals'],
    heightRequirement: {
      id: 'height-any',
      name: 'Any height',
      minInches: null,
      minCentimeters: null,
    },
    physicalConsiderations: [{ id: 'pc-loud', name: 'Loud environment' }],
    interestFacets: {
      age: [{ id: 'age-toddlers', name: 'Toddlers' }],
      thrill: [{ id: 'thrill-relaxing', name: 'Relaxing' }],
    },
    whyThis: {
      title: 'Why visit',
      bullets: ['A beloved cruise'],
      quotes: [],
    },
    menus: [],
  };
}

function stubResponses({
  mickeysEnabled = true,
  mickeyItems = [] as any[],
}: {
  mickeysEnabled?: boolean;
  mickeyItems?: any[];
} = {}) {
  const id = 'exp-jungle-cruise';
  const detail = fullyPopulatedFixture(id);
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path === '/mickeys/config') {
      return { enabled: mickeysEnabled };
    }
    if (path.startsWith('/mickeys?')) {
      return { items: mickeyItems };
    }
    if (path.startsWith('/resorts')) {
      return { resorts: [] };
    }
    if (path === `/catalog/${id}`) {
      return detail;
    }
    if (path === `/catalog/${id}/live`) {
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
      return { value: 7.7, count: 3 };
    }
    if (path.startsWith('/me/favorites')) {
      return { experienceIds: [] };
    }
    if (path.startsWith('/me/trips')) {
      return { trips: [] };
    }
    if (path.endsWith('/logs')) {
      return { repeatCount: 0, logs: [] };
    }
    if (path.includes('/food-item-logs')) {
      return [];
    }
    throw new Error(`unexpected call to ${path}`);
  });
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderScreen(navRef?: any) {
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer ref={navRef}>
        <Stack.Navigator>
          <Stack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailScreen}
            initialParams={{ experienceId: 'exp-jungle-cruise' }}
          />
          <Stack.Screen name="HiddenMickeys">
            {() => <></>}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('ExperienceDetailScreen — Hero Mickey Badge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders floating Mickey badge over hero canopy and navigates to hunt on tap', async () => {
    const navRef = createNavigationContainerRef<CatalogStackParamList>();
    stubResponses({
      mickeysEnabled: true,
      mickeyItems: [
        { id: 'm1', clue1: 'Look at the crate', found: true },
        { id: 'm2', clue1: 'Look near the temple', found: false },
      ],
    });

    renderScreen(navRef);

    // Wait for the badge to resolve and render over the hero photo
    const badge = await screen.findByTestId('experience-hero-mickey-badge');
    expect(badge).toBeTruthy();

    // Verifies text format with found count: "2 Mickeys (1) ›"
    expect(screen.getByText('2 Mickeys (1) ›')).toBeTruthy();
    expect(badge.props.accessibilityLabel).toBe(
      'Hunt 2 Hidden Mickeys here, 1 found',
    );

    // Tapping the floating badge routes to HiddenMickeys with experience context
    fireEvent.press(badge);
    expect(navRef.isReady()).toBe(true);
    expect(navRef.getCurrentRoute()?.name).toBe('HiddenMickeys');
    expect(navRef.getCurrentRoute()?.params).toEqual({
      experienceId: 'exp-jungle-cruise',
      initialPark: 'Magic Kingdom',
    });
  });

  it('omits floating Mickey badge when Mickey feature flag is disabled', async () => {
    stubResponses({
      mickeysEnabled: false,
      mickeyItems: [
        { id: 'm1', clue1: 'Look at the crate', found: true },
      ],
    });

    renderScreen();

    // Screen loads
    await screen.findByText('Jungle Cruise');

    // Badge is not rendered
    expect(screen.queryByTestId('experience-hero-mickey-badge')).toBeNull();
  });

  it('omits floating Mickey badge when experience has 0 Mickeys', async () => {
    stubResponses({
      mickeysEnabled: true,
      mickeyItems: [],
    });

    renderScreen();

    // Screen loads
    await screen.findByText('Jungle Cruise');

    // Badge is not rendered
    expect(screen.queryByTestId('experience-hero-mickey-badge')).toBeNull();
  });
});
