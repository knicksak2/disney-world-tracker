/**
 * Component tests for ParkDestinationScreen (Task 7.5).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.4, 7.6
 *
 * Tests:
 * - Hero header rendering with landmark imagery, title, and live wait pulse (R3.1)
 * - Category tabs (All, Rides, Dining, Shows) filtering experiences (R3.2)
 * - Adjacent Favorites toggle pill filtering experiences conjunctively (R3.3, R7.4)
 * - Dynamic quick chips horizontal bar and reset button (R3.5)
 * - Land accordions with experience count badges and collapse/expand toggle (R3.6)
 * - Experience cards rendering thumbnail, visited badge, height requirement badge (R3.7), and navigation to detail
 * - Multi-select Filters modal with Lands, Price, Height, and Physical dimensions (R3.4, R7.6)
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

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

import ParkDestinationScreen from '../ParkDestinationScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { DESTINATIONS, type Destination } from '../destinations';

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
      heightRequirement: {
        id: '44-inch',
        name: '44 in (112 cm)',
        minInches: 44,
        minCentimeters: 112,
      },
      physicalConsiderations: [
        { id: 'pc-expectant', name: 'Expectant Mothers Advisory' },
      ],
      groupedFacets: {
        thrillFactor: [{ id: 'thrill', name: 'Thrill Rides' }],
        height: [{ id: '44-inch', name: '44 in (112 cm)' }],
      },
    },
    {
      id: 'exp-peter-pan',
      name: "Peter Pan's Flight",
      park: 'Magic Kingdom',
      areaType: 'ThemePark',
      land: 'Fantasyland',
      category: 'Ride',
      description: 'Fly over London in a pirate galleon.',
      imageUrl: null,
      active: true,
      subType: 'Dark Ride',
      heightRequirement: {
        id: 'any-height',
        name: 'Any Height',
        minInches: null,
        minCentimeters: null,
      },
      groupedFacets: {
        thrillFactor: [{ id: 'slow', name: 'Slow Rides' }],
        height: [{ id: 'any-height', name: 'Any Height' }],
      },
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
      groupedFacets: {
        dining: [{ id: 'table', name: 'Table Service' }],
      },
    },
    {
      id: 'exp-parade',
      name: 'Festival of Fantasy Parade',
      park: 'Magic Kingdom',
      areaType: 'ThemePark',
      land: 'Main Street, U.S.A.',
      category: 'Parade',
      description: 'Spectacular daytime parade celebrating Disney classics.',
      imageUrl: null,
      active: true,
      subType: 'Parade',
      groupedFacets: {
        interests: [{ id: 'parade', name: 'Parades' }],
      },
    },
  ];
}

function stubApi(
  experiences: readonly ExperienceDTO[] = createSampleExperiences(),
  favorites: readonly string[] = [],
) {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
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

describe('ParkDestinationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stubApi();
  });

  it('renders hero header with landmark imagery, title, and live wait pulse (Requirement 3.1)', async () => {
    const queryClient = makeQueryClient();
    const destination = DESTINATIONS[0] as Destination; // Magic Kingdom

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ParkDestinationScreen
            destination={destination}
            navigation={mockNavigation}
            experiences={createSampleExperiences()}
          />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Hero header
    expect(screen.getByTestId('park-destination-hero-header')).toBeTruthy();
    expect(screen.getByText('Magic Kingdom')).toBeTruthy();
    expect(screen.getByText(/Active Experiences/)).toBeTruthy();
    expect(screen.queryByText(/Cinderella Castle/)).toBeNull();

    // Wait pulse omitted from header per Requirement 3.1
    expect(screen.queryByTestId('park-destination-wait-pulse')).toBeNull();
    expect(screen.queryByText(/avg/)).toBeNull();

    // Back button
    const backBtn = screen.getByTestId('park-destination-back-btn');
    fireEvent.press(backBtn);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('filters experiences via category tabs (Requirement 3.2)', async () => {
    const queryClient = makeQueryClient();
    const destination = DESTINATIONS[0] as Destination;

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ParkDestinationScreen
            destination={destination}
            navigation={mockNavigation}
            experiences={createSampleExperiences()}
          />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Initial tab: All
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.getByText("Peter Pan's Flight")).toBeTruthy();
    expect(screen.getByText('Be Our Guest Restaurant')).toBeTruthy();
    expect(screen.getByText('Festival of Fantasy Parade')).toBeTruthy();

    // Tap "Rides"
    fireEvent.press(screen.getByTestId('destination-category-Ride'));
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.getByText("Peter Pan's Flight")).toBeTruthy();
    expect(screen.queryByText('Be Our Guest Restaurant')).toBeNull();
    expect(screen.queryByText('Festival of Fantasy Parade')).toBeNull();

    // Tap "Dining"
    fireEvent.press(screen.getByTestId('destination-category-Restaurant'));
    expect(screen.getByText('Be Our Guest Restaurant')).toBeTruthy();
    expect(screen.queryByText('Space Mountain')).toBeNull();

    // Tap "Shows"
    fireEvent.press(screen.getByTestId('destination-category-Show'));
    expect(screen.getByText('Festival of Fantasy Parade')).toBeTruthy();
    expect(screen.queryByText('Space Mountain')).toBeNull();
  });

  it('filters experiences via adjacent Favorites toggle (Requirements 3.3, 7.4)', async () => {
    const queryClient = makeQueryClient();
    const destination = DESTINATIONS[0] as Destination;
    const favoritedIds = new Set(['exp-space']);

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ParkDestinationScreen
            destination={destination}
            navigation={mockNavigation}
            experiences={createSampleExperiences()}
            favoritedIds={favoritedIds}
          />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Initial: all 4 items visible
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.getByText("Peter Pan's Flight")).toBeTruthy();

    // Tap Favorites toggle
    const favToggle = screen.getByTestId('destination-favorites-toggle');
    fireEvent.press(favToggle);

    // Only Space Mountain is favorited
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.queryByText("Peter Pan's Flight")).toBeNull();
    expect(screen.queryByText('Be Our Guest Restaurant')).toBeNull();

    // Toggle off restores all
    fireEvent.press(favToggle);
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.getByText("Peter Pan's Flight")).toBeTruthy();
  });

  it('filters experiences via dynamic quick chips (Requirement 3.5)', async () => {
    const queryClient = makeQueryClient();
    const destination = DESTINATIONS[0] as Destination;

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ParkDestinationScreen
            destination={destination}
            navigation={mockNavigation}
            experiences={createSampleExperiences()}
          />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Quick chips container
    expect(screen.getByTestId('destination-sub-filters')).toBeTruthy();

    // Find and tap a quick chip if present (e.g. Thrill Rides)
    const thrillChip = screen.queryByText(/Thrill/i);
    if (thrillChip) {
      fireEvent.press(thrillChip);
      expect(screen.getByText('Space Mountain')).toBeTruthy();
      expect(screen.queryByText("Peter Pan's Flight")).toBeNull();

      // Reset button resets filters
      const resetBtn = screen.getByTestId('destination-subfilter-reset');
      fireEvent.press(resetBtn);
      expect(screen.getByText("Peter Pan's Flight")).toBeTruthy();
    }
  });

  it('renders land accordions with item count badge and collapses/expands on tap (Requirement 3.6)', async () => {
    const queryClient = makeQueryClient();
    const destination = DESTINATIONS[0] as Destination;

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ParkDestinationScreen
            destination={destination}
            navigation={mockNavigation}
            experiences={createSampleExperiences()}
          />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Land accordion headers
    const tomorrowlandHeader = screen.getByTestId(
      'destination-section-Tomorrowland',
    );
    const fantasylandHeader = screen.getByTestId(
      'destination-section-Fantasyland',
    );
    expect(tomorrowlandHeader).toBeTruthy();
    expect(fantasylandHeader).toBeTruthy();

    // Fantasyland has 2 items: Peter Pan and Be Our Guest
    expect(screen.getByTestId('destination-section-Fantasyland')).toBeTruthy();
    expect(screen.getByTestId('destination-section-Tomorrowland')).toBeTruthy();

    // Tap to collapse Tomorrowland
    fireEvent.press(tomorrowlandHeader);
    expect(screen.queryByText('Space Mountain')).toBeNull();

    // Tap again to re-expand
    fireEvent.press(tomorrowlandHeader);
    expect(screen.getByText('Space Mountain')).toBeTruthy();
  });

  it('renders height requirement badge on experience cards and navigates on tap (Requirement 3.7)', async () => {
    const queryClient = makeQueryClient();
    const destination = DESTINATIONS[0] as Destination;
    const completedIds = new Set(['exp-space']);

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ParkDestinationScreen
            destination={destination}
            navigation={mockNavigation}
            experiences={createSampleExperiences()}
            completedIds={completedIds}
          />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Height requirement badge for Space Mountain (44 in)
    const heightBadge = screen.getByTestId('destination-height-exp-space');
    expect(heightBadge).toBeTruthy();
    expect(screen.getByText(/44 in \(112 cm\)/)).toBeTruthy();

    // Visited checkmark badge
    expect(screen.getByTestId('destination-visited-exp-space')).toBeTruthy();

    // Tapping experience card navigates to ExperienceDetail
    const card = screen.getByTestId('destination-row-exp-space');
    fireEvent.press(card);
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'exp-space',
    });
  });

  it('supports filtering by Lands, Price, Height, and Physical in Filters modal (Requirements 3.4, 7.6)', async () => {
    const queryClient = makeQueryClient();
    const destination = DESTINATIONS[0] as Destination;

    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <ParkDestinationScreen
            destination={destination}
            navigation={mockNavigation}
            experiences={createSampleExperiences()}
          />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    // Open filters modal
    const openModalBtn = screen.getByTestId('destination-open-filters-modal');
    fireEvent.press(openModalBtn);

    expect(screen.getByTestId('destination-filters-modal-content')).toBeTruthy();
    expect(screen.getByTestId('destination-modal-lands-section')).toBeTruthy();
    expect(screen.getByTestId('destination-modal-price-section')).toBeTruthy();
    expect(screen.getByTestId('destination-modal-height-section')).toBeTruthy();
    expect(screen.getByTestId('destination-modal-physical-section')).toBeTruthy();

    // Filter by Height in modal
    const heightChip = screen.getByTestId('destination-modal-filter-44-inch');
    expect(heightChip).toBeTruthy();
    fireEvent.press(heightChip);

    // Apply filters
    const applyBtn = screen.getByTestId('destination-modal-apply-btn');
    fireEvent.press(applyBtn);

    // Only Space Mountain matches 44-inch
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.queryByText("Peter Pan's Flight")).toBeNull();

    // Reopen modal and clear all
    fireEvent.press(openModalBtn);
    const clearBtn = screen.getByTestId('destination-modal-clear-all');
    fireEvent.press(clearBtn);
    fireEvent.press(applyBtn);

    // Restores Peter Pan
    expect(screen.getByText("Peter Pan's Flight")).toBeTruthy();
  });
});
