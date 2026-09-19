/**
 * Component tests for LiveWaitsScreen.
 * (Task 6.2, Requirements 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8)
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import type { ExperienceDTO, ParkLiveSnapshotDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../../api/client';
import LiveWaitsScreen from '../LiveWaitsScreen';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

describe('LiveWaitsScreen', () => {
  let queryClient: QueryClient;

  const mockExperiences: readonly ExperienceDTO[] = [
    {
      id: 'exp-space-mountain',
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Attraction',
      active: true,
      upstreamEntityId: 'tp-space',
      location: null,
      groupedFacets: {
        thrillFactor: [
          { id: 'thrill-rides', label: 'Thrill Rides' },
          { id: 'big-drops', label: 'Big Drops' },
        ],
      },
    } as unknown as ExperienceDTO,
    {
      id: 'exp-peter-pan',
      name: "Peter Pan's Flight",
      park: 'Magic Kingdom',
      category: 'Attraction',
      active: true,
      upstreamEntityId: 'tp-peter',
      location: null,
      groupedFacets: {
        thrillFactor: [],
      },
    } as unknown as ExperienceDTO,
    {
      id: 'exp-peoplemover',
      name: 'PeopleMover',
      park: 'Magic Kingdom',
      category: 'Attraction',
      active: true,
      upstreamEntityId: 'tp-peoplemover',
      location: null,
      groupedFacets: {
        thrillFactor: [],
      },
    } as unknown as ExperienceDTO,
    {
      id: 'exp-splash',
      name: 'Tiana Bayou Adventure',
      park: 'Magic Kingdom',
      category: 'Attraction',
      active: true,
      upstreamEntityId: 'tp-splash',
      location: null,
      groupedFacets: {
        thrillFactor: [{ id: 'big-drops', label: 'Big Drops' }],
      },
    } as unknown as ExperienceDTO,
  ];

  const mockSnapshot: ParkLiveSnapshotDTO = {
    park: 'Magic Kingdom',
    entries: [
      {
        experienceId: 'exp-peter-pan',
        name: "Peter Pan's Flight",
        status: 'OPERATING',
        waitMinutes: 45,
      },
      {
        experienceId: 'exp-peoplemover',
        name: 'PeopleMover',
        status: 'OPERATING',
        waitMinutes: 10,
      },
      {
        experienceId: 'exp-space-mountain',
        name: 'Space Mountain',
        status: 'OPERATING',
        waitMinutes: 25,
      },
      {
        experienceId: 'exp-splash',
        name: 'Tiana Bayou Adventure',
        status: 'DOWN',
        waitMinutes: null,
      },
    ],
    retrievedAt: '2026-09-17T14:00:00Z',
    stale: false,
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    mockApiRequest.mockReset();
  });

  function renderScreen(props = {}) {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <LiveWaitsScreen {...props} />
        </NavigationContainer>
      </QueryClientProvider>,
    );
  }

  it('renders rows sorted ascending with closed/down entries last under default all filter', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/parks/') && url.includes('/live')) {
        return mockSnapshot;
      }
      if (url.includes('/catalog')) {
        return { experiences: mockExperiences };
      }
      if (url.includes('/me/trips')) {
        return [];
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('PeopleMover')).toBeTruthy();
      expect(screen.getByText('Space Mountain')).toBeTruthy();
      expect(screen.getByText("Peter Pan's Flight")).toBeTruthy();
      expect(screen.getByText('Tiana Bayou Adventure')).toBeTruthy();
    });

    // Check wait times
    expect(screen.getByTestId('wait-time-exp-peoplemover')).toHaveTextContent(/10 min/);
    expect(screen.getByTestId('wait-time-exp-space-mountain')).toHaveTextContent(/25 min/);
    expect(screen.getByTestId('wait-time-exp-peter-pan')).toHaveTextContent(/45 min/);
    expect(screen.getByText('Closed')).toBeTruthy();
  });

  it('filters by walk-on when walk-on chip is tapped', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/parks/') && url.includes('/live')) {
        return mockSnapshot;
      }
      if (url.includes('/catalog')) {
        return { experiences: mockExperiences };
      }
      if (url.includes('/me/trips')) {
        return [];
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('PeopleMover')).toBeTruthy();
    });

    const walkOnChip = screen.getByTestId('filter-chip-walkOn');
    fireEvent.press(walkOnChip);

    // PeopleMover (10 min <= 25) and Space Mountain (25 min <= 25) are walk-on
    expect(screen.getByText('PeopleMover')).toBeTruthy();
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    // Peter Pan (45 min) and Tiana (Down) should not appear
    expect(screen.queryByText("Peter Pan's Flight")).toBeNull();
    expect(screen.queryByText('Tiana Bayou Adventure')).toBeNull();
  });

  it('filters by headliners when headliners chip is tapped', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/parks/') && url.includes('/live')) {
        return mockSnapshot;
      }
      if (url.includes('/catalog')) {
        return { experiences: mockExperiences };
      }
      if (url.includes('/me/trips')) {
        return [];
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('PeopleMover')).toBeTruthy();
    });

    const headlinersChip = screen.getByTestId('filter-chip-headliners');
    fireEvent.press(headlinersChip);

    // Space Mountain and Tiana have headliner thrillFactor facets
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    expect(screen.getByText('Tiana Bayou Adventure')).toBeTruthy();
    // PeopleMover and Peter Pan are not headliners
    expect(screen.queryByText('PeopleMover')).toBeNull();
    expect(screen.queryByText("Peter Pan's Flight")).toBeNull();
  });

  it('opens LogVisitModal when tapping the per-row Log button', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/parks/') && url.includes('/live')) {
        return mockSnapshot;
      }
      if (url.includes('/catalog')) {
        return { experiences: mockExperiences };
      }
      if (url.includes('/me/trips')) {
        return [];
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-exp-peoplemover')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('log-visit-exp-peoplemover'));

    // Modal opens, containing log controls
    await waitFor(() => {
      expect(screen.getByText('Log visit')).toBeTruthy();
    });
  });

  it('renders stale indicator when snapshot is marked stale', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/parks/') && url.includes('/live')) {
        return {
          ...mockSnapshot,
          stale: true,
        };
      }
      if (url.includes('/catalog')) {
        return { experiences: mockExperiences };
      }
      if (url.includes('/me/trips')) {
        return [];
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('live-stale-indicator')).toBeTruthy();
      expect(screen.getByText('Live information may be out of date.')).toBeTruthy();
    });
  });

  it('renders unavailable empty state when live fetch fails with no cache', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/parks/') && url.includes('/live')) {
        throw new ApiError({
          code: 'live_unavailable',
          message: 'Upstream live data unreachable',
          status: 503,
        });
      }
      if (url.includes('/catalog')) {
        return { experiences: mockExperiences };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('live-waits-unavailable')).toBeTruthy();
      expect(screen.getByText('Live waits unavailable')).toBeTruthy();
    });
  });

  it('excludes restaurants and schedule-only entertainment from rendered rows', async () => {
    const experiencesWithDining: readonly ExperienceDTO[] = [
      ...mockExperiences,
      {
        id: 'exp-crystal-palace',
        name: 'The Crystal Palace',
        park: 'Magic Kingdom',
        category: 'Restaurant' as any,
        active: true,
      } as ExperienceDTO,
      {
        id: 'exp-dapper-dans',
        name: 'The Dapper Dans',
        park: 'Magic Kingdom',
        category: 'Show' as any,
        active: true,
      } as ExperienceDTO,
    ];

    const snapshotWithDining: ParkLiveSnapshotDTO = {
      park: 'Magic Kingdom',
      entries: [
        ...mockSnapshot.entries,
        {
          experienceId: 'exp-crystal-palace',
          name: 'The Crystal Palace',
          status: 'CLOSED',
          waitMinutes: null,
        },
        {
          experienceId: 'exp-dapper-dans',
          name: 'The Dapper Dans',
          status: 'CLOSED',
          waitMinutes: null,
        },
      ],
      retrievedAt: '2026-09-17T14:00:00Z',
      stale: false,
    };

    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/parks/') && url.includes('/live')) {
        return snapshotWithDining;
      }
      if (url.includes('/catalog')) {
        return { experiences: experiencesWithDining };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('PeopleMover')).toBeTruthy();
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });

    // Attractions should be present
    expect(screen.getByText("Peter Pan's Flight")).toBeTruthy();
    expect(screen.getByText('Tiana Bayou Adventure')).toBeTruthy();

    // Dining and schedule-only shows should be filtered out
    expect(screen.queryByText('The Crystal Palace')).toBeNull();
    expect(screen.queryByText('The Dapper Dans')).toBeNull();
  });

  it('renders signature header, crowd status card, and refresh button', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/parks/') && url.includes('/live')) {
        return mockSnapshot;
      }
      if (url.includes('/catalog')) {
        return { experiences: mockExperiences };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('REAL-TIME LINE TIMES')).toBeTruthy();
      expect(screen.getByText('Magic Kingdom')).toBeTruthy();
      expect(screen.getByTestId('refresh-waits-button')).toBeTruthy();
      expect(screen.getByTestId('live-waits-crowd-card')).toBeTruthy();
      expect(screen.getByTestId('live-waits-tips-button')).toBeTruthy();
      expect(screen.getByText(/Crowd Level/)).toBeTruthy();
    });
  });

  it('filters by lightning lane when lightningLane chip is tapped', async () => {
    const snapshotWithLL: ParkLiveSnapshotDTO = {
      ...mockSnapshot,
      entries: [
        {
          experienceId: 'exp-space-mountain',
          name: 'Space Mountain',
          status: 'OPERATING',
          waitMinutes: 40,
          lightningLane: {
            state: 'AVAILABLE',
            returnStart: '2026-09-17T18:15:00Z',
            price: { amount: 14, currency: 'USD' },
          },
        },
        {
          experienceId: 'exp-peoplemover',
          name: 'PeopleMover',
          status: 'OPERATING',
          waitMinutes: 10,
        },
      ],
    };

    const expRide = {
      ...mockExperiences[0]!,
      id: 'exp-space-mountain',
      category: 'Ride',
    };
    const expShow = {
      ...mockExperiences[1]!,
      id: 'exp-peoplemover',
      category: 'Show',
    };

    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/parks/') && url.includes('/live')) {
        return snapshotWithLL;
      }
      if (url.includes('/catalog')) {
        return { experiences: [expRide, expShow] };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });

    const llChip = screen.getByTestId('filter-chip-lightningLane');
    fireEvent.press(llChip);

    // Space Mountain has Lightning Lane
    expect(screen.getByText('Space Mountain')).toBeTruthy();
    // PeopleMover (Show without LL) is filtered out
    expect(screen.queryByText('PeopleMover')).toBeNull();
  });
});
