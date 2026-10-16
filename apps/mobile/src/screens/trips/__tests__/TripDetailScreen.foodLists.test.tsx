/**
 * Mobile tests for Trip "Attached Food Lists" section (Tasks 24.6, 24.7).
 *
 * Validates: Requirements 22.1, 22.5, 22.7, 22.9, 22.10
 *
 * Covers:
 *   - R22.9/R22.10: Rendering attached food lists with name, item count, and owner.
 *   - R22.10: Tapping an available food list navigates to FoodListDetail with listId.
 *   - R22.10: Rendering unavailable entries with greyed "No longer available" treatment.
 *   - R22.1: Sourcing owned and public-browsable lists for attach, excluding already-attached lists.
 *   - R22.1: Successful attach triggers POST /trips/:id/food-lists and refreshes detail.
 *   - R22.1: Mapping trip_food_list_ineligible to friendly copy.
 *   - R22.7: Mapping trip_food_list_not_found to friendly copy.
 *   - R22.5: Organizer detach triggers DELETE /trips/:id/food-lists/:foodListId.
 *   - R22.5: Adder detach triggers DELETE /trips/:id/food-lists/:foodListId.
 *   - R22.5: Forbidden third party (non-organizer non-adder) has detach gated client-side.
 *   - R22.5: Server rejection trip_forbidden on detach displays friendly copy.
 *   - R22.10/R22.5: Organizer can detach unavailable entries to clean up dead links.
 */

import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { darkTheme } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { ATTACHED_FOOD_LISTS } from '../AttachedFoodListsSection.palette';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

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

import TripDetailScreen from '../TripDetailScreen';
import AttachedFoodListsSection from '../AttachedFoodListsSection';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type {
  FoodListDTO,
  FoodListDiscoveryPageDTO,
  TripDTO,
  TripFoodListDTO,
} from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const OWN_USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';

const LIST_1_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LIST_2_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LIST_UNAVAIL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LIST_NEW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LIST_PUB_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const AVAILABLE_LIST_1: TripFoodListDTO = {
  available: true,
  foodListId: LIST_1_ID,
  name: 'Snacks of Epcot',
  itemCount: 5,
  ownerDisplayName: 'Ariel',
};

const AVAILABLE_LIST_2: TripFoodListDTO = {
  available: true,
  foodListId: LIST_2_ID,
  name: 'Dole Whip Tour',
  itemCount: 3,
  ownerDisplayName: 'Sebastian',
};

const UNAVAILABLE_LIST: TripFoodListDTO = {
  available: false,
  foodListId: LIST_UNAVAIL_ID,
};

const BASE_TRIP: TripDTO = {
  id: TRIP_ID,
  name: 'Disney Trip 2026',
  description: 'Food and fun.',
  startDate: '2026-10-01',
  endDate: '2026-10-05',
  status: 'active',
  createdAt: '2026-09-01T00:00:00Z',
  resorts: [],
  foodLists: [AVAILABLE_LIST_1, UNAVAILABLE_LIST],
  experienceLists: [],
};

const OWNED_FOOD_LISTS: readonly FoodListDTO[] = [
  {
    id: LIST_1_ID, // already attached
    ownerId: OWN_USER_ID,
    ownerDisplayName: 'Ariel',
    name: 'Snacks of Epcot',
    visibility: 'private',
    isChecklist: false,
    likeCount: 2,
    itemCount: 5,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    pinnedAt: null,
  },
  {
    id: LIST_NEW_ID, // not attached yet
    ownerId: OWN_USER_ID,
    ownerDisplayName: 'Ariel',
    name: 'Magic Kingdom Treats',
    visibility: 'public',
    isChecklist: false,
    likeCount: 10,
    itemCount: 8,
    createdAt: '2026-09-02T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    pinnedAt: null,
  },
];

const DISCOVERY_PAGE: FoodListDiscoveryPageDTO = {
  items: [
    {
      id: LIST_1_ID, // already attached
      ownerId: OWN_USER_ID,
      ownerDisplayName: 'Ariel',
      name: 'Snacks of Epcot',
      visibility: 'public',
      isChecklist: false,
      likeCount: 20,
      itemCount: 5,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      pinnedAt: null,
    },
    {
      id: LIST_PUB_ID, // not attached yet
      ownerId: OTHER_USER_ID,
      ownerDisplayName: 'Chef Mickey',
      name: 'Best Quick Service',
      visibility: 'public',
      isChecklist: false,
      likeCount: 45,
      itemCount: 12,
      createdAt: '2026-09-03T00:00:00Z',
      updatedAt: '2026-09-03T00:00:00Z',
      pinnedAt: null,
    },
  ],
  nextCursor: null,
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeNavigation(): { navigate: jest.Mock; goBack: jest.Mock } {
  return { navigate: jest.fn(), goBack: jest.fn() };
}

describe('Attached Food Lists UI (Task 24.6, 24.7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirmButton = buttons?.find(
        (b) => b.text === 'Detach' || b.style === 'destructive',
      );
      confirmButton?.onPress?.();
    });
  });

  test('R22.9, R22.10: renders attached food lists with name, itemCount, and ownerDisplayName', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (path === '/me') return { user: { id: OWN_USER_ID } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      throw new Error(`Unexpected path ${path}`);
    });

    const navigation = makeNavigation();
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <TripDetailScreen
          navigation={navigation as any}
          route={{
            key: 'detail',
            name: 'TripDetail',
            params: { tripId: TRIP_ID },
          }}
        />
      </QueryClientProvider>,
    );

    // Header and section exist
    expect(
      await screen.findByTestId('trip-detail-food-lists-section'),
    ).toBeTruthy();
    expect(screen.getByText('Attached Food Lists')).toBeTruthy();

    // Available list item rendered with name, owner, and itemCount
    expect(screen.getByTestId(`attached-food-list-${LIST_1_ID}`)).toBeTruthy();
    expect(screen.getByText('Snacks of Epcot')).toBeTruthy();
    expect(screen.getByText(/by Ariel/)).toBeTruthy();
    expect(screen.getByText(/5 items/)).toBeTruthy();
  });

  test('R22.10: tapping an available attached food list navigates to FoodListDetail', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (path === '/me') return { user: { id: OWN_USER_ID } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      throw new Error(`Unexpected path ${path}`);
    });

    const navigation = makeNavigation();
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <TripDetailScreen
          navigation={navigation as any}
          route={{
            key: 'detail',
            name: 'TripDetail',
            params: { tripId: TRIP_ID },
          }}
        />
      </QueryClientProvider>,
    );

    const card = await screen.findByTestId(`attached-food-list-${LIST_1_ID}`);
    fireEvent.press(card);

    expect(navigation.navigate).toHaveBeenCalledWith('FoodListDetail', {
      foodListId: LIST_1_ID,
    });
  });

  test('R22.10: renders unavailable entry with greyed "No longer available" treatment', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (path === '/me') return { user: { id: OWN_USER_ID } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      throw new Error(`Unexpected path ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <TripDetailScreen
          navigation={makeNavigation() as any}
          route={{
            key: 'detail',
            name: 'TripDetail',
            params: { tripId: TRIP_ID },
          }}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByTestId(
        `attached-food-list-unavailable-${LIST_UNAVAIL_ID}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText('No longer available')).toBeTruthy();
  });

  test('R22.1: opens attach modal and attaches an owned food list', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/food-lists') return OWNED_FOOD_LISTS;
      if (path === '/food-lists/discover?sort=popular') return DISCOVERY_PAGE;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/food-lists`) {
        return { success: true };
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    const queryClient = makeQueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <AttachedFoodListsSection
          tripId={TRIP_ID}
          foodLists={[AVAILABLE_LIST_1]}
          isOrganizer={false}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    // Open attach modal
    const attachBtn = screen.getByTestId('trip-detail-attach-food-list-btn');
    fireEvent.press(attachBtn);

    expect(await screen.findByTestId('attach-food-list-modal')).toBeTruthy();

    // Already attached list LIST_1_ID should NOT be shown in the picker
    expect(screen.queryByTestId(`selectable-food-list-${LIST_1_ID}`)).toBeNull();

    // Unattached list LIST_NEW_ID is selectable
    const selectableItem = await screen.findByTestId(
      `selectable-food-list-${LIST_NEW_ID}`,
    );
    expect(selectableItem).toBeTruthy();
    expect(screen.getByText('Magic Kingdom Treats')).toBeTruthy();

    // Tap attach
    const attachItemAction = screen.getByTestId(
      `attach-list-action-${LIST_NEW_ID}`,
    );
    fireEvent.press(attachItemAction);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/food-lists`,
        { foodListId: LIST_NEW_ID },
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['trips', 'detail', TRIP_ID],
      });
    });
  });

  test('R22.1: attaches a public food list from the Discover tab', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/food-lists') return OWNED_FOOD_LISTS;
      if (path === '/food-lists/discover?sort=popular') return DISCOVERY_PAGE;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/food-lists`) {
        return { success: true };
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedFoodListsSection
          tripId={TRIP_ID}
          foodLists={[AVAILABLE_LIST_1]}
          isOrganizer={false}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    // Open modal
    fireEvent.press(screen.getByTestId('trip-detail-attach-food-list-btn'));

    // Switch to Discover tab
    const discoverTab = await screen.findByTestId(
      'attach-food-list-tab-discover',
    );
    fireEvent.press(discoverTab);

    // Public list LIST_PUB_ID appears
    expect(
      await screen.findByTestId(`selectable-food-list-${LIST_PUB_ID}`),
    ).toBeTruthy();
    expect(screen.getByText('Best Quick Service')).toBeTruthy();
    expect(screen.getByText(/by Chef Mickey/)).toBeTruthy();

    // Attach it
    fireEvent.press(screen.getByTestId(`attach-list-action-${LIST_PUB_ID}`));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/food-lists`,
        { foodListId: LIST_PUB_ID },
      );
    });
  });

  test('R22.1: surfaces friendly error when attaching an ineligible food list (trip_food_list_ineligible)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/food-lists') return OWNED_FOOD_LISTS;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/food-lists`) {
        throw new ApiError({
          code: 'trip_food_list_ineligible',
          message: 'ineligible',
          status: 403,
        });
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedFoodListsSection
          tripId={TRIP_ID}
          foodLists={[]}
          isOrganizer={false}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    fireEvent.press(screen.getByTestId('trip-detail-attach-food-list-btn'));
    const itemAction = await screen.findByTestId(
      `attach-list-action-${LIST_NEW_ID}`,
    );
    fireEvent.press(itemAction);

    expect(await screen.findByTestId('attach-food-list-error')).toBeTruthy();
    expect(
      screen.getByText(
        'Only food lists you own or public lists can be attached to a trip.',
      ),
    ).toBeTruthy();
  });

  test('R22.7: surfaces friendly error when attaching a missing food list (trip_food_list_not_found)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/food-lists') return OWNED_FOOD_LISTS;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/food-lists`) {
        throw new ApiError({
          code: 'trip_food_list_not_found',
          message: 'not found',
          status: 404,
        });
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedFoodListsSection
          tripId={TRIP_ID}
          foodLists={[]}
          isOrganizer={false}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    fireEvent.press(screen.getByTestId('trip-detail-attach-food-list-btn'));
    const itemAction = await screen.findByTestId(
      `attach-list-action-${LIST_NEW_ID}`,
    );
    fireEvent.press(itemAction);

    expect(await screen.findByTestId('attach-food-list-error')).toBeTruthy();
    expect(screen.getByText('This food list could not be found.')).toBeTruthy();
  });

  test('R22.5: an Organizer can detach any attached food list', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (
        method === 'DELETE' &&
        path === `/trips/${TRIP_ID}/food-lists/${LIST_2_ID}`
      ) {
        return undefined;
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    const queryClient = makeQueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <AttachedFoodListsSection
          tripId={TRIP_ID}
          foodLists={[AVAILABLE_LIST_2]} // Owned by Sebastian, caller is Organizer
          isOrganizer={true}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    // Organizer sees the detach button
    const detachBtn = screen.getByTestId(`detach-food-list-btn-${LIST_2_ID}`);
    expect(detachBtn).toBeTruthy();

    fireEvent.press(detachBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        `/trips/${TRIP_ID}/food-lists/${LIST_2_ID}`,
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['trips', 'detail', TRIP_ID],
      });
    });
  });

  test('R22.5: an Adder can detach their own attached food list', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (
        method === 'DELETE' &&
        path === `/trips/${TRIP_ID}/food-lists/${LIST_1_ID}`
      ) {
        return undefined;
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedFoodListsSection
          tripId={TRIP_ID}
          foodLists={[AVAILABLE_LIST_1]} // Owned by Ariel, caller is Ariel (plain member)
          isOrganizer={false}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    // Adder sees detach button for their own list
    const detachBtn = screen.getByTestId(`detach-food-list-btn-${LIST_1_ID}`);
    expect(detachBtn).toBeTruthy();

    fireEvent.press(detachBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        `/trips/${TRIP_ID}/food-lists/${LIST_1_ID}`,
      );
    });
  });

  test('R22.5: a non-organizer non-adder does not see detach control (client-side gating)', async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedFoodListsSection
          tripId={TRIP_ID}
          foodLists={[AVAILABLE_LIST_2]} // Owned by Sebastian, caller is Flounder
          isOrganizer={false}
          callerDisplayName="Flounder"
        />
      </QueryClientProvider>,
    );

    // Detach button must NOT be present for a non-organizer, non-adder
    expect(
      screen.queryByTestId(`detach-food-list-btn-${LIST_2_ID}`),
    ).toBeNull();
  });

  test('prompts confirmation when detach is pressed and cancels without calling API', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedFoodListsSection
          tripId={TRIP_ID}
          foodLists={[AVAILABLE_LIST_1]}
          isOrganizer={true}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    const detachBtn = screen.getByTestId(`detach-food-list-btn-${LIST_1_ID}`);
    fireEvent.press(detachBtn);

    expect(alertSpy).toHaveBeenCalledWith(
      "Detach 'Snacks of Epcot'?",
      expect.stringContaining("Detach 'Snacks of Epcot' from this trip?"),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Detach', style: 'destructive' }),
      ]),
    );
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'DELETE',
      `/trips/${TRIP_ID}/food-lists/${LIST_1_ID}`,
    );
  });

  test('R22.5: server rejection trip_forbidden on detach displays friendly copy', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'DELETE') {
        throw new ApiError({
          code: 'trip_forbidden',
          message: 'forbidden',
          status: 403,
        });
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedFoodListsSection
          tripId={TRIP_ID}
          foodLists={[AVAILABLE_LIST_2]}
          isOrganizer={false}
          callerDisplayName="Sebastian"
          allowAllDetachForTesting={true}
        />
      </QueryClientProvider>,
    );

    const detachBtn = screen.getByTestId(`detach-food-list-btn-${LIST_2_ID}`);
    fireEvent.press(detachBtn);

    expect(await screen.findByTestId('trip-detail-detach-error')).toBeTruthy();
    expect(
      screen.getByText(
        'Only the person who attached this food list or a trip organizer can detach it.',
      ),
    ).toBeTruthy();
  });

  test('R22.10, R22.5: Organizer can detach an unavailable entry to clean up dead references', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (
        method === 'DELETE' &&
        path === `/trips/${TRIP_ID}/food-lists/${LIST_UNAVAIL_ID}`
      ) {
        return undefined;
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedFoodListsSection
          tripId={TRIP_ID}
          foodLists={[UNAVAILABLE_LIST]}
          isOrganizer={true}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    const detachBtn = screen.getByTestId(
      `detach-food-list-btn-${LIST_UNAVAIL_ID}`,
    );
    expect(detachBtn).toBeTruthy();

    fireEvent.press(detachBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        `/trips/${TRIP_ID}/food-lists/${LIST_UNAVAIL_ID}`,
      );
    });
  });

  // Feature: dark-mode — AttachedFoodListsSection (c) assertions.
  describe('dark mode', () => {
    afterEach(resetTestScheme);

    const flat = (node: ReactTestInstance): Record<string, unknown> =>
      (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;

    function renderSection(lists: readonly TripFoodListDTO[]): void {
      render(
        <QueryClientProvider client={makeQueryClient()}>
          <AttachedFoodListsSection
            tripId={TRIP_ID}
            foodLists={lists}
            isOrganizer={true}
            callerDisplayName="Ariel"
          />
        </QueryClientProvider>,
      );
    }

    test('(c) the unavailable row, title and Attach control use dark values', () => {
      setTestScheme('dark');
      renderSection([AVAILABLE_LIST_1, UNAVAILABLE_LIST]);

      expect(
        flat(screen.getByTestId(`attached-food-list-unavailable-${LIST_UNAVAIL_ID}`))
          .backgroundColor,
      ).toBe(ATTACHED_FOOD_LISTS.dark.unavailableBg);
      expect(flat(screen.getByText('Attached Food Lists')).color).toBe(
        darkTheme.color.textPrimary,
      );
      expect(flat(screen.getByText('Snacks of Epcot')).color).toBe(darkTheme.color.textPrimary);
      expect(
        flat(screen.getByTestId('trip-detail-attach-food-list-btn')).backgroundColor,
      ).toBe(darkTheme.color.primary);
      expect(flat(screen.getByText('Attach')).color).toBe(darkTheme.color.textOnPrimary);
    });

    test('(c) the empty state keeps its rule-2a primary tint and border in dark', () => {
      setTestScheme('dark');
      renderSection([]);

      const empty = flat(screen.getByTestId('attached-food-lists-empty'));
      expect(empty.backgroundColor).toBe(`${darkTheme.color.primary}0a`);
      expect(empty.borderColor).toBe(`${darkTheme.color.primaryFg}18`);
    });

    test('keeps the pre-retrofit light values under light', () => {
      renderSection([UNAVAILABLE_LIST]);

      expect(
        flat(screen.getByTestId(`attached-food-list-unavailable-${LIST_UNAVAIL_ID}`))
          .backgroundColor,
      ).toBe('#eee');
    });
  });
});
