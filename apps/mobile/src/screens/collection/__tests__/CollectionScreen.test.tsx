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
      itemCount: 8,
      likeCount: 4,
      createdAt: '2026-09-10T00:00:00Z',
      updatedAt: '2026-09-10T00:00:00Z',
    },
  ],
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

  it('renders segmented control with 3 tabs defaulting to Pins & Showcase', () => {
    renderCollection();

    expect(screen.getByTestId('vault-segmented-control')).toBeTruthy();
    expect(screen.getByTestId('vault-seg-pins')).toBeTruthy();
    expect(screen.getByTestId('vault-seg-food')).toBeTruthy();
    expect(screen.getByTestId('vault-seg-stats')).toBeTruthy();

    // Default active view is Pins
    expect(screen.getByTestId('collection-pins-view')).toBeTruthy();
    expect(screen.queryByTestId('collection-food-view')).toBeNull();
    expect(screen.queryByTestId('collection-stats-view')).toBeNull();
  });

  it('switches between Pins, Food, and Stats views when segmented tabs are pressed', () => {
    renderCollection();

    // Switch to Food tab
    fireEvent.press(screen.getByTestId('vault-seg-food'));
    expect(screen.getByTestId('collection-food-view')).toBeTruthy();
    expect(screen.queryByTestId('collection-pins-view')).toBeNull();

    // Switch to Stats tab
    fireEvent.press(screen.getByTestId('vault-seg-stats'));
    expect(screen.getByTestId('collection-stats-view')).toBeTruthy();
    expect(screen.queryByTestId('collection-food-view')).toBeNull();

    // Switch back to Pins tab
    fireEvent.press(screen.getByTestId('vault-seg-pins'));
    expect(screen.getByTestId('collection-pins-view')).toBeTruthy();
    expect(screen.queryByTestId('collection-stats-view')).toBeNull();
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

  it('renders food metrics and navigates to MyFoodLists via food lists link', async () => {
    const navRef = createNavigationContainerRef();
    renderCollection(navRef);

    // Switch to Food sub-tab
    fireEvent.press(screen.getByTestId('vault-seg-food'));

    // Check metric cards
    expect(screen.getByTestId('food-logged-metric')).toBeTruthy();
    expect(screen.getByTestId('food-lists-metric')).toBeTruthy();
    expect(screen.getByTestId('recent-treats-card')).toBeTruthy();

    // Food list discovery link navigates to MyFoodLists
    const foodListsLink = screen.getByTestId('food-lists-link');
    fireEvent.press(foodListsLink);
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('MyFoodLists');
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
