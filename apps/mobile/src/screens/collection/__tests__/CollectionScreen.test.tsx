/**
 * Component tests for CollectionScreen / Disney Vault Segmented Hub.
 * (Task 9.3, Requirements 6.1–6.9, design.md Section 5.1)
 */

import React from 'react';
import { View } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PINS } from '@dwt/shared';
import type {
  ExperienceListCollectionDTO,
  FoodItemLogWithContextDTO,
  FoodListCollectionDTO,
  PinBoardDTO,
  PinShowcaseDTO,
} from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import type { StatsResponse } from '../../../api/statsTypes';
import { useClaimablePinsBadge } from '../../../components/pins/useClaimablePinsBadge';
import CollectionScreen from '../CollectionScreen';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('../../../components/pins/useClaimablePinsBadge', () => ({
  useClaimablePinsBadge: jest.fn(),
}));

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockUseClaimablePinsBadge = useClaimablePinsBadge as jest.MockedFunction<typeof useClaimablePinsBadge>;

const Stack = createNativeStackNavigator();

function DummyScreen({ testID }: { readonly testID: string }): JSX.Element {
  return <View testID={testID} />;
}

const mockBoardData: PinBoardDTO = {
  pins: [
    {
      pinId: PINS[0]!.id,
      unlocked: true,
      awardedAt: '2026-01-01T00:00:00Z',
      currentValue: null,
      targetValue: null,
      percentComplete: null,
      claimedAt: null, // Ready to claim!
    },
    {
      pinId: PINS[1]!.id,
      unlocked: true,
      awardedAt: '2026-01-01T00:00:00Z',
      currentValue: null,
      targetValue: null,
      percentComplete: null,
      claimedAt: '2026-01-02T00:00:00Z', // Already claimed
    },
  ],
  tierSummary: [
    { tier: 'bronze', unlocked: 1, total: 10 },
    { tier: 'silver', unlocked: 1, total: 10 },
  ],
  totalUnlocked: 2,
  totalPins: PINS.length,
  overallPercent: Math.round((2 / PINS.length) * 100),
};

const mockShowcaseData: PinShowcaseDTO = {
  ownerId: 'user-1',
  placements: [
    { pinId: PINS[1]!.id, posX: 0.25, posY: 0.3, zIndex: 1 },
  ],
  unplaced: [],
};

const mockFoodLogs: readonly FoodItemLogWithContextDTO[] = [
  {
    id: 'log-1',
    foodItemId: 'dole-whip',
    foodItemName: 'Dole Whip Cup',
    restaurantName: 'Aloha Isle',
    locationName: 'Magic Kingdom',
    rating: 5,
    loggedAt: '2026-09-15T12:00:00Z',
    isWishlist: false,
  } as any,
];

const mockFoodLists: FoodListCollectionDTO = {
  owned: [
    {
      id: 'list-1',
      name: 'EPCOT Festival Snacks',
      ownerId: 'user-1',
      ownerDisplayName: 'User One',
      visibility: 'public',
      isChecklist: false,
      itemCount: 8,
      likeCount: 4,
      createdAt: '2026-09-10T00:00:00Z',
      updatedAt: '2026-09-10T00:00:00Z',
      pinnedAt: null,
    },
  ],
  saved: [],
};

const mockExperienceLists: ExperienceListCollectionDTO = {
  owned: [
    {
      id: 'exp-list-1',
      name: 'Thrill Rides',
      ownerId: 'user-1',
      ownerDisplayName: 'User One',
      visibility: 'public',
      itemCount: 6,
      likeCount: 2,
      createdAt: '2026-09-10T00:00:00Z',
      updatedAt: '2026-09-10T00:00:00Z',
      pinnedAt: null,
    },
  ],
  saved: [],
};

const mockEmptyExperienceLists: ExperienceListCollectionDTO = {
  owned: [],
  saved: [],
};

const mockStats: StatsResponse = {
  coverage: {
    overall: { completed: 25, total: 50, percent: 50, remaining: 25, completeBadge: false },
    byPark: {
      'magic-kingdom': { completed: 15, total: 20, percent: 75, remaining: 5, completeBadge: false },
      'epcot': { completed: 5, total: 10, percent: 50, remaining: 5, completeBadge: false },
      'hollywood-studios': { completed: 3, total: 10, percent: 30, remaining: 7, completeBadge: false },
      'animal-kingdom': { completed: 2, total: 10, percent: 20, remaining: 8, completeBadge: false },
    },
    byCategory: {
      Ride: { completed: 12, total: 20, percent: 60, remaining: 8, completeBadge: false },
      Show: { completed: 4, total: 10, percent: 40, remaining: 6, completeBadge: false },
      Parade: { completed: 1, total: 2, percent: 50, remaining: 1, completeBadge: false },
      Restaurant: { completed: 8, total: 15, percent: 53, remaining: 7, completeBadge: false },
      Resort: { completed: 3, total: 10, percent: 30, remaining: 7, completeBadge: false },
    } as any,
    byAreaType: {} as any,
    byLand: [],
    byResortArea: [],
    byFacetValue: [],
    resort: { completed: 3, total: 10, percent: 30, remaining: 7, completeBadge: false },
    byResort: [],
  },
  ratings: {
    sufficient: true,
    ratedCompletionsCount: 5,
    average: 9.2,
    highest: { experienceId: 'exp-1', name: 'Space Mountain', value: 10 },
  },
  percentileRank: 84,
} as any;

describe('CollectionScreen — Disney Vault Hub', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockApiRequest.mockReset();
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/pins') return mockBoardData as never;
      if (path === '/me/pin-showcase') return mockShowcaseData as never;
      if (path === '/me/food-item-logs') return mockFoodLogs as never;
      if (path === '/me/food-lists/collection') return mockFoodLists as never;
      if (path === '/me/experience-lists/collection') return mockExperienceLists as never;
      if (path === '/me/stats?percentile=true') return mockStats as never;
      return {} as never;
    });

    mockUseClaimablePinsBadge.mockReturnValue({
      count: 0,
      display: 'hidden',
    });
  });

  function renderCollection(navRef?: any) {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer ref={navRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="CollectionHome" component={CollectionScreen} />
            <Stack.Screen
              name="PinBoard"
              component={() => <DummyScreen testID="screen-pin-board" />}
            />
            <Stack.Screen
              name="PinShowcase"
              component={() => <DummyScreen testID="screen-pin-showcase" />}
            />
            <Stack.Screen
              name="MyFoodHistory"
              component={() => <DummyScreen testID="screen-food-history" />}
            />
            <Stack.Screen
              name="MyFoodLists"
              component={() => <DummyScreen testID="screen-food-lists" />}
            />
            <Stack.Screen
              name="MyExperienceLists"
              component={() => <DummyScreen testID="screen-experience-lists" />}
            />
            <Stack.Screen
              name="FoodListDetail"
              component={() => <DummyScreen testID="screen-food-list-detail" />}
            />
            <Stack.Screen
              name="ExperienceListDetail"
              component={() => <DummyScreen testID="screen-experience-list-detail" />}
            />
            <Stack.Screen
              name="FoodListDiscovery"
              component={() => <DummyScreen testID="screen-food-list-discovery" />}
            />
            <Stack.Screen
              name="ExperienceListDiscovery"
              component={() => <DummyScreen testID="screen-experience-list-discovery" />}
            />
            <Stack.Screen
              name="Stats"
              component={() => <DummyScreen testID="screen-stats" />}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );
  }

  it('renders header with Disney Vault eyebrow pill and title', () => {
    renderCollection();

    expect(screen.getByTestId('header-eyebrow-pill')).toBeTruthy();
    expect(screen.getByText('📌 DISNEY VAULT')).toBeTruthy();
    expect(screen.getByText('My Disney Collection')).toBeTruthy();
    expect(
      screen.getByText('Your personal scrapbook of pins, treats, and progress stats'),
    ).toBeTruthy();
  });

  it('renders segmented control with 4 tabs defaulting to Pins & Showcase (Requirement 6.6a)', () => {
    renderCollection();

    expect(screen.getByTestId('vault-segmented-control')).toBeTruthy();
    expect(screen.getByTestId('vault-seg-pins')).toBeTruthy();
    expect(screen.getByTestId('vault-seg-food')).toBeTruthy();
    expect(screen.getByTestId('vault-seg-lists')).toBeTruthy();
    expect(screen.getByTestId('vault-seg-stats')).toBeTruthy();

    // Default active view is Pins
    expect(screen.getByTestId('collection-pins-view')).toBeTruthy();
    expect(screen.queryByTestId('collection-food-view')).toBeNull();
    expect(screen.queryByTestId('collection-lists-view')).toBeNull();
    expect(screen.queryByTestId('collection-stats-view')).toBeNull();
  });

  it('switches between Pins, Food, Lists, and Stats views when segmented tabs are pressed', () => {
    renderCollection();

    // Switch to Food tab
    fireEvent.press(screen.getByTestId('vault-seg-food'));
    expect(screen.getByTestId('collection-food-view')).toBeTruthy();
    expect(screen.queryByTestId('collection-pins-view')).toBeNull();

    // Switch to Lists tab
    fireEvent.press(screen.getByTestId('vault-seg-lists'));
    expect(screen.getByTestId('collection-lists-view')).toBeTruthy();
    expect(screen.queryByTestId('collection-food-view')).toBeNull();

    // Switch to Stats tab
    fireEvent.press(screen.getByTestId('vault-seg-stats'));
    expect(screen.getByTestId('collection-stats-view')).toBeTruthy();
    expect(screen.queryByTestId('collection-lists-view')).toBeNull();

    // Switch back to Pins tab
    fireEvent.press(screen.getByTestId('vault-seg-pins'));
    expect(screen.getByTestId('collection-pins-view')).toBeTruthy();
    expect(screen.queryByTestId('collection-stats-view')).toBeNull();
  });

  it('renders no count badge on the Lists pill (Requirement 6.6a — only the claimable-pin badge is actionable enough to warrant one)', async () => {
    renderCollection();

    await waitFor(() => {
      expect(screen.getByTestId('vault-seg-lists')).toBeTruthy();
    });
    expect(screen.queryByTestId('vault-seg-badge-lists')).toBeNull();
  });

  it('renders claimable count banner when claimableCount > 0 and navigates to PinBoard with celebratePinIds', async () => {
    mockUseClaimablePinsBadge.mockReturnValue({
      count: 1,
      display: 'count',
    });

    const navRef = createNavigationContainerRef();
    renderCollection(navRef);

    expect(screen.getByTestId('claim-banner')).toBeTruthy();
    expect(screen.getByText('1 Pin Ready to Claim!')).toBeTruthy();

    const claimBtn = screen.getByTestId('claim-pins-button');
    fireEvent.press(claimBtn);

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('PinBoard');
    });
  });

  it('renders display corkboard canvas and navigates to PinShowcase on Customize press', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);

    expect(screen.getByTestId('showcase-corkboard-canvas')).toBeTruthy();

    const customizeBtn = screen.getByTestId('showcase-customize-button');
    fireEvent.press(customizeBtn);

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('PinShowcase');
    });
  });

  it('opens PinDetailModal when a placed pin on the corkboard is pressed', async () => {
    renderCollection();

    const placedPin = await screen.findByTestId(`corkboard-pin-${PINS[1]!.id}`);
    expect(placedPin).toBeTruthy();

    fireEvent.press(placedPin);

    await waitFor(() => {
      expect(screen.getByTestId('pin-detail-modal')).toBeTruthy();
    });
  });

  it('navigates to PinBoard when View Board link is pressed in Directory card', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);

    const viewBoardBtn = screen.getByTestId('pins-board-link');
    fireEvent.press(viewBoardBtn);

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('PinBoard');
    });
  });

  it('renders food metrics (no list-count tile) in the Food tab', async () => {
    renderCollection();

    // Switch to Food sub-tab
    fireEvent.press(screen.getByTestId('vault-seg-food'));

    // Check metric card — snack count only, no list-count tile here anymore
    // (Requirement 6.8a — the list-count metric moved to the Lists segment).
    expect(screen.getByTestId('food-logged-metric')).toBeTruthy();
    expect(screen.queryByTestId('food-lists-metric')).toBeNull();
    expect(screen.getByTestId('recent-treats-card')).toBeTruthy();

    // The list cards no longer render under the Food tab at all (Requirement 6.8a, 6.8b).
    expect(screen.queryByTestId('food-lists-card')).toBeNull();
    expect(screen.queryByTestId('experience-lists-card')).toBeNull();
  });

  it('opens the "Log a food item" picker flow from the Food tab (Requirement 6.8a)', async () => {
    renderCollection();

    fireEvent.press(screen.getByTestId('vault-seg-food'));

    const logFoodBtn = screen.getByTestId('collection-log-food-button');
    fireEvent.press(logFoodBtn);

    await waitFor(() => {
      expect(screen.getByTestId('collection-food-log-picker-modal')).toBeTruthy();
      expect(screen.getByTestId('collection-food-log-picker-title')).toBeTruthy();
    });
  });

  it('navigates to FoodListDiscovery via the Discover link in the Lists tab', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);

    // Switch to Lists sub-tab
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    expect(screen.getByTestId('food-lists-card')).toBeTruthy();

    // Food list Discover link navigates to FoodListDiscovery (Requirement 6 amendment 8c)
    const foodListsLink = screen.getByTestId('food-lists-link');
    fireEvent.press(foodListsLink);
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('FoodListDiscovery');
    });
  });

  // Feature: navigation-redesign amendment 8c, Property 10 — exact-order, capped preview rows
  it('renders up to 4 food list rows in pinned-first order exactly as returned, with a "View all" row when more than 4 exist', async () => {
    const manyOwned = [
      { ...mockFoodLists.owned[0]!, id: 'list-a', name: 'List A', pinnedAt: '2026-09-20T08:00:00Z' },
      { ...mockFoodLists.owned[0]!, id: 'list-b', name: 'List B', pinnedAt: null },
      { ...mockFoodLists.owned[0]!, id: 'list-c', name: 'List C', pinnedAt: null },
      { ...mockFoodLists.owned[0]!, id: 'list-d', name: 'List D', pinnedAt: null },
      { ...mockFoodLists.owned[0]!, id: 'list-e', name: 'List E', pinnedAt: null },
    ];
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/pins') return mockBoardData as never;
      if (path === '/me/pin-showcase') return mockShowcaseData as never;
      if (path === '/me/food-item-logs') return mockFoodLogs as never;
      if (path === '/me/food-lists/collection')
        return { owned: manyOwned, saved: [] } as never;
      if (path === '/me/experience-lists/collection') return mockExperienceLists as never;
      if (path === '/me/stats?percentile=true') return mockStats as never;
      return {} as never;
    });

    renderCollection();
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    // Exactly the first 4, in the order the mocked response returned them
    // (server-side pinned-first ordering) — no client re-sort.
    await waitFor(() => {
      expect(screen.getByTestId('food-list-preview-row-list-a')).toBeTruthy();
      expect(screen.getByTestId('food-list-preview-row-list-b')).toBeTruthy();
      expect(screen.getByTestId('food-list-preview-row-list-c')).toBeTruthy();
      expect(screen.getByTestId('food-list-preview-row-list-d')).toBeTruthy();
    });
    expect(screen.queryByTestId('food-list-preview-row-list-e')).toBeNull();

    // "View all (5)" row renders since ownedLists.length (5) > 4.
    expect(screen.getByText('View all (5) →')).toBeTruthy();
  });

  it('renders no "View all" row when 4 or fewer food lists are owned', async () => {
    const fourOwned = [
      { ...mockFoodLists.owned[0]!, id: 'list-a', name: 'List A', pinnedAt: null },
      { ...mockFoodLists.owned[0]!, id: 'list-b', name: 'List B', pinnedAt: null },
      { ...mockFoodLists.owned[0]!, id: 'list-c', name: 'List C', pinnedAt: null },
      { ...mockFoodLists.owned[0]!, id: 'list-d', name: 'List D', pinnedAt: null },
    ];
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/pins') return mockBoardData as never;
      if (path === '/me/pin-showcase') return mockShowcaseData as never;
      if (path === '/me/food-item-logs') return mockFoodLogs as never;
      if (path === '/me/food-lists/collection')
        return { owned: fourOwned, saved: [] } as never;
      if (path === '/me/experience-lists/collection') return mockExperienceLists as never;
      if (path === '/me/stats?percentile=true') return mockStats as never;
      return {} as never;
    });

    renderCollection();
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    await waitFor(() => {
      expect(screen.getByTestId('food-list-preview-row-list-a')).toBeTruthy();
      expect(screen.getByTestId('food-list-preview-row-list-b')).toBeTruthy();
      expect(screen.getByTestId('food-list-preview-row-list-c')).toBeTruthy();
      expect(screen.getByTestId('food-list-preview-row-list-d')).toBeTruthy();
    });
    expect(screen.queryByTestId('food-lists-view-all-row')).toBeNull();
  });

  it('tapping a specific food list row navigates to FoodListDetail with that row\'s own id (Property 11)', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);

    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    await waitFor(() => {
      expect(screen.getByTestId('food-list-preview-row-list-1')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-preview-row-list-1'));

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('FoodListDetail');
      expect(navRef.getCurrentRoute()?.params).toEqual({ foodListId: 'list-1' });
    });
  });

  it('"View all" row navigates to MyFoodLists, not FoodListDetail', async () => {
    const manyOwned = [
      { ...mockFoodLists.owned[0]!, id: 'list-a', name: 'List A' },
      { ...mockFoodLists.owned[0]!, id: 'list-b', name: 'List B' },
      { ...mockFoodLists.owned[0]!, id: 'list-c', name: 'List C' },
      { ...mockFoodLists.owned[0]!, id: 'list-d', name: 'List D' },
      { ...mockFoodLists.owned[0]!, id: 'list-e', name: 'List E' },
    ];
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/pins') return mockBoardData as never;
      if (path === '/me/pin-showcase') return mockShowcaseData as never;
      if (path === '/me/food-item-logs') return mockFoodLogs as never;
      if (path === '/me/food-lists/collection')
        return { owned: manyOwned, saved: [] } as never;
      if (path === '/me/experience-lists/collection') return mockExperienceLists as never;
      if (path === '/me/stats?percentile=true') return mockStats as never;
      return {} as never;
    });

    const navRef = createNavigationContainerRef();
    renderCollection(navRef);
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    await waitFor(() => {
      expect(screen.getByTestId('food-lists-view-all-row')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('food-lists-view-all-row'));

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('MyFoodLists');
    });
  });

  // Feature: list-pinning, Property 12 — Collection pin toggle issues the identical PATCH
  it('tapping a food list row\'s pin toggle issues PATCH with pinned: true and does not navigate', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    await waitFor(() => {
      expect(screen.getByTestId('food-list-preview-pin-btn-list-1')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-list-preview-pin-btn-list-1'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/me/food-lists/list-1', {
        pinned: true,
      });
    });
    // Tapping the pin icon must not also trigger the row's own navigation.
    expect(navRef.getCurrentRoute()?.name).not.toBe('FoodListDetail');
  });

  // Feature: navigation-redesign amendment 8c — inline "+ New" create action
  it('tapping "+ New" on the food lists card opens the create modal in place without navigating away', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    await waitFor(() => {
      expect(screen.getByTestId('food-lists-new-link')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('food-lists-new-link'));

    await waitFor(() => {
      expect(screen.getByTestId('create-food-list-modal')).toBeTruthy();
      expect(screen.getByText('Create Food List')).toBeTruthy();
    });
    // Still on the Collection screen — no navigation occurred.
    expect(navRef.getCurrentRoute()?.name).toBe('CollectionHome');
  });

  it('creating a food list via the "+ New" modal adds it to the rendered rows', async () => {
    let owned = [...mockFoodLists.owned];
    mockApiRequest.mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (path === '/me/pins') return mockBoardData as never;
      if (path === '/me/pin-showcase') return mockShowcaseData as never;
      if (path === '/me/food-item-logs') return mockFoodLogs as never;
      if (path === '/me/food-lists' && method === 'POST') {
        const created = {
          id: 'list-new-collection',
          ownerId: 'user-1',
          ownerDisplayName: 'User One',
          name: (body as any)?.name,
          visibility: (body as any)?.visibility ?? 'private',
          isChecklist: (body as any)?.isChecklist ?? false,
          itemCount: 0,
          likeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pinnedAt: null,
        };
        owned = [created, ...owned];
        return created as never;
      }
      if (path === '/me/food-lists/collection') return { owned, saved: [] } as never;
      if (path === '/me/experience-lists/collection') return mockExperienceLists as never;
      if (path === '/me/stats?percentile=true') return mockStats as never;
      return {} as never;
    });

    renderCollection();
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    await waitFor(() => {
      expect(screen.getByTestId('food-lists-new-link')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('food-lists-new-link'));

    fireEvent.changeText(
      screen.getByTestId('new-food-list-name-input'),
      'Snacks From Collection',
    );
    fireEvent.press(screen.getByTestId('submit-create-food-list-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('food-list-preview-row-list-new-collection')).toBeTruthy();
      expect(screen.getByText(/Snacks From Collection/)).toBeTruthy();
    });
  });

  it('navigates to MyFoodHistory via Open Food History Timeline button in Food tab', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);

    // Switch to Food sub-tab
    fireEvent.press(screen.getByTestId('vault-seg-food'));

    // Food timeline button navigates to MyFoodHistory
    const timelineBtn = screen.getByTestId('food-entry-button');
    fireEvent.press(timelineBtn);
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('MyFoodHistory');
    });
  });

  it('renders park coverage story and navigates to Stats in Stats tab', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);

    // Switch to Stats sub-tab
    fireEvent.press(screen.getByTestId('vault-seg-stats'));

    // Check coverage card & bars
    expect(screen.getByTestId('park-coverage-card')).toBeTruthy();
    expect(await screen.findByText('50% Total')).toBeTruthy();
    expect(await screen.findByText("🌟 You're ahead of 84% of park guests!")).toBeTruthy();

    // Stats button navigates to Stats
    const statsBtn = screen.getByTestId('stats-entry-button');
    fireEvent.press(statsBtn);
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('Stats');
    });
  });

  it('renders badges in reach card and opens PinDetailModal when an in-reach badge is pressed', async () => {
    renderCollection();

    expect(screen.getByTestId('pins-in-reach-card')).toBeTruthy();
    expect(screen.getByText('🎯 Badges in Reach')).toBeTruthy();

    const inReachBadges = screen.getAllByTestId(/^pin-in-reach-/);
    expect(inReachBadges.length).toBeGreaterThan(0);

    // Tap first badge to open details
    fireEvent.press(inReachBadges[0]!);
    await waitFor(() => {
      expect(screen.getByTestId('pin-detail-modal')).toBeTruthy();
    });
  });

  it('renders iconic treats checklist in Food tab', async () => {
    renderCollection();

    fireEvent.press(screen.getByTestId('vault-seg-food'));

    expect(screen.getByTestId('iconic-treats-checklist')).toBeTruthy();
    expect(screen.getByText('Classic Treats Checklist')).toBeTruthy();
    // Dole Whip was in mockFoodLogs so it shows Tasted! once query resolves
    expect(await screen.findByText('Tasted!')).toBeTruthy();
    expect(await screen.findByText('1 of 4 Tasted')).toBeTruthy();
  });

  it('renders My Experience Lists card with a preview row for each owned list, deep-linking to ExperienceListDetail (Property 10, Property 11)', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);

    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    expect(screen.getByTestId('experience-lists-card')).toBeTruthy();
    expect(screen.getByTestId('experience-lists-link')).toBeTruthy();

    const row = await screen.findByTestId('experience-list-preview-row-exp-list-1');
    expect(row).toBeTruthy();
    expect(await screen.findByText('🎟️ Thrill Rides')).toBeTruthy();
    expect(await screen.findByText('6 experiences tracked')).toBeTruthy();

    fireEvent.press(row);
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('ExperienceListDetail');
      expect(navRef.getCurrentRoute()?.params).toEqual({ experienceListId: 'exp-list-1' });
    });
  });

  it('navigates to ExperienceListDiscovery when the experience lists Discover link is pressed', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);

    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    const experienceListsLink = screen.getByTestId('experience-lists-link');
    fireEvent.press(experienceListsLink);
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('ExperienceListDiscovery');
    });
  });

  it('renders the My Experience Lists card and link identically regardless of owned/saved list counts (Requirement 12.2)', async () => {
    // Zero-count case: owned and saved are both empty.
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/pins') return mockBoardData as never;
      if (path === '/me/pin-showcase') return mockShowcaseData as never;
      if (path === '/me/food-item-logs') return mockFoodLogs as never;
      if (path === '/me/food-lists/collection') return mockFoodLists as never;
      if (path === '/me/experience-lists/collection') return mockEmptyExperienceLists as never;
      if (path === '/me/stats?percentile=true') return mockStats as never;
      return {} as never;
    });

    const { unmount } = renderCollection();
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    // Card and its navigation affordance are present even with zero lists.
    expect(screen.getByTestId('experience-lists-card')).toBeTruthy();
    expect(screen.getByTestId('experience-lists-link')).toBeTruthy();

    // No preview rows; empty-state text shown instead.
    await waitFor(() => {
      expect(screen.queryByTestId('experience-list-preview-row-exp-list-1')).toBeNull();
    });
    expect(
      await screen.findByText('No experience lists yet. Start a Thrill Rides or Must-Do list!'),
    ).toBeTruthy();

    unmount();

    // Non-zero-count case: at least one owned list.
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/pins') return mockBoardData as never;
      if (path === '/me/pin-showcase') return mockShowcaseData as never;
      if (path === '/me/food-item-logs') return mockFoodLogs as never;
      if (path === '/me/food-lists/collection') return mockFoodLists as never;
      if (path === '/me/experience-lists/collection') return mockExperienceLists as never;
      if (path === '/me/stats?percentile=true') return mockStats as never;
      return {} as never;
    });

    renderCollection();
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    // Same card and link are present, now showing preview rows instead of empty state.
    expect(screen.getByTestId('experience-lists-card')).toBeTruthy();
    expect(screen.getByTestId('experience-lists-link')).toBeTruthy();
    expect(await screen.findByTestId('experience-list-preview-row-exp-list-1')).toBeTruthy();
    expect(screen.queryByText('No experience lists yet. Start a Thrill Rides or Must-Do list!')).toBeNull();
  });

  // Feature: navigation-redesign amendment 8c, Property 10 — capped rows + "View all"
  it('renders up to 4 experience list rows with a "View all" row when more than 4 exist', async () => {
    const manyOwned = [
      { ...mockExperienceLists.owned[0]!, id: 'elist-a', name: 'List A' },
      { ...mockExperienceLists.owned[0]!, id: 'elist-b', name: 'List B' },
      { ...mockExperienceLists.owned[0]!, id: 'elist-c', name: 'List C' },
      { ...mockExperienceLists.owned[0]!, id: 'elist-d', name: 'List D' },
      { ...mockExperienceLists.owned[0]!, id: 'elist-e', name: 'List E' },
    ];
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/pins') return mockBoardData as never;
      if (path === '/me/pin-showcase') return mockShowcaseData as never;
      if (path === '/me/food-item-logs') return mockFoodLogs as never;
      if (path === '/me/food-lists/collection') return mockFoodLists as never;
      if (path === '/me/experience-lists/collection')
        return { owned: manyOwned, saved: [] } as never;
      if (path === '/me/stats?percentile=true') return mockStats as never;
      return {} as never;
    });

    const navRef = createNavigationContainerRef();
    renderCollection(navRef);
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    await waitFor(() => {
      expect(screen.getByTestId('experience-list-preview-row-elist-a')).toBeTruthy();
      expect(screen.getByTestId('experience-list-preview-row-elist-b')).toBeTruthy();
      expect(screen.getByTestId('experience-list-preview-row-elist-c')).toBeTruthy();
      expect(screen.getByTestId('experience-list-preview-row-elist-d')).toBeTruthy();
    });
    expect(screen.queryByTestId('experience-list-preview-row-elist-e')).toBeNull();

    const viewAllRow = screen.getByTestId('experience-lists-view-all-row');
    expect(viewAllRow).toBeTruthy();
    fireEvent.press(viewAllRow);

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('MyExperienceLists');
    });
  });

  // Feature: list-pinning, Property 12
  it('tapping an experience list row\'s pin toggle issues PATCH with pinned: true and does not navigate', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    await waitFor(() => {
      expect(screen.getByTestId('experience-list-preview-pin-btn-exp-list-1')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('experience-list-preview-pin-btn-exp-list-1'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/me/experience-lists/exp-list-1', {
        pinned: true,
      });
    });
    expect(navRef.getCurrentRoute()?.name).not.toBe('ExperienceListDetail');
  });

  it('tapping "+ New" on the experience lists card opens the create modal in place without navigating away', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);
    fireEvent.press(screen.getByTestId('vault-seg-lists'));

    await waitFor(() => {
      expect(screen.getByTestId('experience-lists-new-link')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('experience-lists-new-link'));

    await waitFor(() => {
      expect(screen.getByTestId('create-experience-list-modal')).toBeTruthy();
      expect(screen.getByText('Create Experience List')).toBeTruthy();
    });
    expect(navRef.getCurrentRoute()?.name).toBe('CollectionHome');
  });

  it('renders experience milestones and scrapbook highlights in Stats tab', async () => {
    renderCollection();

    fireEvent.press(screen.getByTestId('vault-seg-stats'));

    // Check milestones
    expect(screen.getByTestId('stats-milestones-card')).toBeTruthy();
    expect(screen.getByText('Experience Milestones')).toBeTruthy();
    expect(screen.getByText('Attractions Ridden')).toBeTruthy();
    expect(screen.getByText('Shows & Parades')).toBeTruthy();

    // Check scrapbook highlights after query resolves
    expect(screen.getByTestId('stats-favorites-card')).toBeTruthy();
    expect(screen.getByText('Scrapbook Highlights')).toBeTruthy();
    expect(screen.getByText('Average Rating')).toBeTruthy();
    expect(screen.getByText('Top Rated Item')).toBeTruthy();
    expect(await screen.findByText('Space Mountain')).toBeTruthy();
    expect(await screen.findByText('★ 9.2/10')).toBeTruthy();
  });
});
