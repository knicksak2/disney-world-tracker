/**
 * Component tests for ExploreHubScreen (Task 6.5).
 *
 * Validates: Requirements 1.1–1.8, 7.1, 7.3, 8.1
 *
 * Tests:
 * - Header rendering with title "Explore", operating subtitle, and actions (R1.1)
 * - 3-column Utility Dock: Live Waits, Crowds, and Favorites toggle (R1.3)
 * - 2x2 Theme Parks Landmark Grid with wait pulses and navigation (R1.4, 1.5)
 * - Disney Springs Showcase card with badges and navigation (R1.6)
 * - Balanced 2-column Water Parks Grid and navigation (R1.7)
 * - Resorts Spotlight Card and navigation to ResortsDirectory (R1.8, 8.1)
 * - Debounced global search, results list, and detail navigation (R1.2, 7.3)
 * - Stale-cache banner and catalog_unavailable error states (R7.3)
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { ExperienceDTO, ParkLiveSnapshotDTO } from '@dwt/shared';

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

jest.mock('../../../features/notifications/useAttentionBadge', () => ({
  __esModule: true,
  useAttentionBadge: () => ({ display: 'hidden', count: 0 }),
}));

import ExploreHubScreen from '../ExploreHubScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

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

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
};

const mockDestinationsResponse = {
  destinations: [
    { destination: 'Magic Kingdom', count: 42 },
    { destination: 'EPCOT', count: 35 },
    { destination: 'Hollywood Studios', count: 28 },
    { destination: 'Animal Kingdom', count: 25 },
    { destination: 'Disney Springs', count: 68 },
    { destination: 'Blizzard Beach', count: 12 },
    { destination: 'Typhoon Lagoon', count: 14 },
    { destination: 'Resorts', count: 32 },
  ],
  staleCache: false,
};

const mockLiveSnapshot: ParkLiveSnapshotDTO = {
  park: 'Magic Kingdom',
  retrievedAt: new Date().toISOString(),
  stale: false,
  entries: [
    {
      experienceId: 'space-mtn-id',
      name: 'Space Mountain',
      status: 'OPERATING',
      waitMinutes: 35,
    },
    {
      experienceId: 'mine-train-id',
      name: 'Seven Dwarfs Mine Train',
      status: 'OPERATING',
      waitMinutes: 21,
    },
  ],
};

function createSampleExperiences(): readonly ExperienceDTO[] {
  return [
    {
      id: 'exp-space',
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      areaType: 'ThemePark',
      land: 'Tomorrowland',
      category: 'Ride',
      description: 'High-speed roller coaster through deep space.',
      imageUrl: null,
      active: true,
      subType: 'Roller Coaster',
    },
    {
      id: 'exp-be-our-guest',
      name: 'Be Our Guest Restaurant',
      park: 'Magic Kingdom',
      areaType: 'ThemePark',
      land: 'Fantasyland',
      category: 'Restaurant',
      description: 'Feast in the Beast’s enchanted castle.',
      imageUrl: null,
      priceTier: '$$$$',
      active: true,
      subType: 'Table Service',
    },
  ];
}

function stubApi(
  experiences: readonly ExperienceDTO[] = createSampleExperiences(),
  favorites: readonly string[] = ['exp-space'],
) {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.includes('/destinations')) {
      return mockDestinationsResponse;
    }
    if (path.includes('/live')) {
      return mockLiveSnapshot;
    }
    if (path.startsWith('/me/favorites')) {
      return { experienceIds: favorites };
    }
    if (path === '/me') {
      return { user: { id: 'viewer', email: 'viewer@test.local' } };
    }
    if (path.endsWith('/completions')) {
      return { entries: [] };
    }
    if (path.startsWith('/catalog')) {
      return { experiences, staleCache: false };
    }
    return {};
  });
}

describe('ExploreHubScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubApi();
  });

  it('renders header with title Explore, operating subtitle, and actions (Requirement 1.1)', async () => {
    const queryClient = makeQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ExploreHubScreen navigation={mockNavigation} />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Explore')).toBeTruthy();
    expect(screen.getByText('Where would you like to explore?')).toBeTruthy();
    expect(screen.getByTestId('catalog-search')).toBeTruthy();
  });

  it('renders 3-column Utility Dock and navigates on tap (Requirement 1.3)', async () => {
    const queryClient = makeQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ExploreHubScreen navigation={mockNavigation} />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Live Waits tile
    const liveWaitsBtn = screen.getByTestId('utility-dock-waits');
    expect(liveWaitsBtn).toBeTruthy();
    fireEvent.press(liveWaitsBtn);
    expect(mockNavigate).toHaveBeenCalledWith('LiveWaits');

    // Crowds tile
    const crowdsBtn = screen.getByTestId('utility-dock-crowds');
    expect(crowdsBtn).toBeTruthy();
    fireEvent.press(crowdsBtn);
    expect(mockNavigate).toHaveBeenCalledWith('CrowdCalendar');

    // Favorites tile activates in-screen favorites view
    const favoritesBtn = screen.getByTestId('utility-dock-favorites');
    expect(favoritesBtn).toBeTruthy();
    fireEvent.press(favoritesBtn);

    await waitFor(() => {
      expect(screen.getByTestId('catalog-favorites-view')).toBeTruthy();
      expect(screen.getByText('My Favorites')).toBeTruthy();
    });

    // Back button restores Explore Hub
    const backBtn = screen.getByTestId('catalog-favorites-back-button');
    fireEvent.press(backBtn);
    expect(screen.queryByTestId('catalog-favorites-view')).toBeNull();
    expect(screen.getByTestId('explore-utility-dock')).toBeTruthy();
  });

  it('renders 2x2 Theme Parks Landmark Grid with live wait pulses and navigates on park tap (Requirements 1.4, 1.5)', async () => {
    const queryClient = makeQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ExploreHubScreen navigation={mockNavigation} />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Grid container
    expect(screen.getByTestId('explore-theme-parks-grid')).toBeTruthy();

    // 4 Theme Parks
    const mkCard = screen.getByTestId('explore-park-card-Magic Kingdom');
    const epcotCard = screen.getByTestId('explore-park-card-EPCOT');
    const dhsCard = screen.getByTestId('explore-park-card-Hollywood Studios');
    const dakCard = screen.getByTestId('explore-park-card-Animal Kingdom');

    expect(mkCard).toBeTruthy();
    expect(epcotCard).toBeTruthy();
    expect(dhsCard).toBeTruthy();
    expect(dakCard).toBeTruthy();

    // Park names rendered, landmarks omitted per Req 1.5
    expect(screen.getByText('Magic Kingdom')).toBeTruthy();
    expect(screen.getByText('EPCOT')).toBeTruthy();
    expect(screen.getByText('Hollywood Studios')).toBeTruthy();
    expect(screen.getByText('Animal Kingdom')).toBeTruthy();
    expect(screen.queryByText('Cinderella Castle')).toBeNull();
    expect(screen.queryByText('Spaceship Earth')).toBeNull();

    // Live wait pulse (35 + 21) / 2 = 28m avg and resolved experience counts
    await waitFor(() => {
      expect(screen.getByTestId('explore-park-wait-pulse-Magic Kingdom')).toBeTruthy();
      expect(screen.getAllByText('28m avg').length).toBeGreaterThan(0);
      expect(screen.getByText('42 experiences')).toBeTruthy();
      expect(screen.getByText('35 experiences')).toBeTruthy();
    });

    // Tap park navigates to DestinationScreen
    fireEvent.press(mkCard);
    expect(mockNavigate).toHaveBeenCalledWith('DestinationScreen', {
      destination: 'Magic Kingdom',
    });
  });

  it('renders Disney Springs showcase card with venue counts and navigates on tap (Requirement 1.6)', async () => {
    const queryClient = makeQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ExploreHubScreen navigation={mockNavigation} />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    const dsCard = screen.getByTestId('explore-disney-springs-card');
    expect(dsCard).toBeTruthy();
    expect(screen.getByText('Disney Springs')).toBeTruthy();
    expect(screen.getByText('Waterfront Dining, Shopping & Entertainment')).toBeTruthy();
    expect(screen.getByText('Free Admission')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('68 Venues')).toBeTruthy();
    });

    fireEvent.press(dsCard);
    expect(mockNavigate).toHaveBeenCalledWith('DestinationScreen', {
      destination: 'Disney Springs',
    });
  });

  it('renders balanced 2-column Water Parks Grid and navigates on tap (Requirement 1.7)', async () => {
    const queryClient = makeQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ExploreHubScreen navigation={mockNavigation} />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('explore-water-parks-grid')).toBeTruthy();

    const bbCard = screen.getByTestId('explore-water-park-Blizzard Beach');
    const tlCard = screen.getByTestId('explore-water-park-Typhoon Lagoon');

    expect(bbCard).toBeTruthy();
    expect(tlCard).toBeTruthy();
    expect(screen.getByText("Disney's Blizzard Beach")).toBeTruthy();
    expect(screen.getByText("Disney's Typhoon Lagoon")).toBeTruthy();

    fireEvent.press(bbCard);
    expect(mockNavigate).toHaveBeenCalledWith('DestinationScreen', {
      destination: 'Blizzard Beach',
    });

    fireEvent.press(tlCard);
    expect(mockNavigate).toHaveBeenCalledWith('DestinationScreen', {
      destination: 'Typhoon Lagoon',
    });
  });

  it('renders Resorts Spotlight Card and navigates to ResortsDirectory (Requirements 1.8, 8.1)', async () => {
    const queryClient = makeQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ExploreHubScreen navigation={mockNavigation} />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    const resortsCard = screen.getByTestId('explore-resorts-spotlight-card');
    expect(resortsCard).toBeTruthy();
    expect(screen.getByText('Disney Resorts & Hotels')).toBeTruthy();
    expect(screen.getByText('32 On-Property Themed Resorts, Dining & Pools')).toBeTruthy();
    expect(screen.getByText('32 Properties')).toBeTruthy();
    expect(screen.getByText('Explore Directory ›')).toBeTruthy();

    fireEvent.press(resortsCard);
    expect(mockNavigate).toHaveBeenCalledWith('ResortsDirectory');
  });

  it('renders sections in Option A vertical order with consistent subtitles (Requirement 1 amendment)', async () => {
    const queryClient = makeQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ExploreHubScreen navigation={mockNavigation} />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Verify all section headers and subtitles exist
    expect(screen.getByText('THEME PARKS')).toBeTruthy();
    expect(screen.getByText('Explore rides, dining & shows')).toBeTruthy();

    expect(screen.getByText('RESORT HOTELS')).toBeTruthy();
    expect(screen.getByText('32 on-property hotels, dining & pools')).toBeTruthy();

    expect(screen.getByText('SHOPPING & ENTERTAINMENT')).toBeTruthy();
    expect(screen.getByText('Waterfront dining, shopping & nightlife')).toBeTruthy();

    expect(screen.getByText('WATER PARKS')).toBeTruthy();
    expect(screen.getByText('Thrills, slides & relaxation')).toBeTruthy();

    // Verify relative ordering within scroll content
    const scrollContainer = screen.getByTestId('explore-hub-content');
    const matchedNodes = scrollContainer.findAll((node) =>
      [
        'explore-theme-parks-grid',
        'explore-resorts-spotlight-card',
        'explore-disney-springs-card',
        'explore-water-parks-grid',
      ].includes(node.props.testID),
    );
    const orderedTestIds = Array.from(
      new Set(matchedNodes.map((n) => n.props.testID)),
    );

    expect(orderedTestIds).toEqual([
      'explore-theme-parks-grid',
      'explore-resorts-spotlight-card',
      'explore-disney-springs-card',
      'explore-water-parks-grid',
    ]);
  });

  it('supports debounced global search and navigates to ExperienceDetail (Requirements 1.2, 7.3)', async () => {
    const queryClient = makeQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ExploreHubScreen navigation={mockNavigation} />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    const searchInput = screen.getByTestId('catalog-search');
    fireEvent.changeText(searchInput, 'Space');

    // Debounced query runs
    await waitFor(() => {
      expect(screen.getByTestId('catalog-search-results')).toBeTruthy();
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });

    // Selecting search result navigates to ExperienceDetail
    const resultRow = screen.getByTestId('catalog-search-row-exp-space');
    fireEvent.press(resultRow);
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'exp-space',
    });

    // Clear search restores hub content
    const clearBtn = screen.getByTestId('catalog-search-clear');
    fireEvent.press(clearBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('catalog-search-results')).toBeNull();
      expect(screen.getByTestId('explore-utility-dock')).toBeTruthy();
    });
  });

  it('displays stale-cache banner when catalog is stale (Requirement 7.3)', async () => {
    const queryClient = makeQueryClient();

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path !== 'string') throw new Error(`bad path: ${path}`);
      if (path.includes('/destinations')) {
        return { ...mockDestinationsResponse, staleCache: true };
      }
      if (path.includes('/live')) {
        return mockLiveSnapshot;
      }
      if (path.startsWith('/me/favorites')) {
        return { experienceIds: ['exp-space'] };
      }
      if (path === '/me') {
        return { user: { id: 'viewer', email: 'viewer@test.local' } };
      }
      if (path.endsWith('/completions')) {
        return { entries: [] };
      }
      if (path.startsWith('/catalog')) {
        return { experiences: createSampleExperiences(), staleCache: true };
      }
      return {};
    });

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ExploreHubScreen navigation={mockNavigation} />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('catalog-stale-banner')).toBeTruthy();
      expect(screen.getByText('Showing cached catalog')).toBeTruthy();
    });
  });

  it('handles catalog_unavailable error state (Requirement 7.3)', async () => {
    const errClient = makeQueryClient();
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError({
        status: 503,
        code: 'catalog_unavailable',
        message: 'Catalog service down',
      });
    });

    render(
      <QueryClientProvider client={errClient}>
        <NavigationContainer>
          <ExploreHubScreen navigation={mockNavigation} />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('catalog-unavailable')).toBeTruthy();
    });
  });
});
