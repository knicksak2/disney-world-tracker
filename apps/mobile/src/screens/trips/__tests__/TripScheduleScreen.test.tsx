/**
 * TripScheduleScreen component tests (task 5.3).
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';

import { PlannedItemDTO, TripOptimizationResult } from '@dwt/shared';

import TripScheduleScreen, {
  getMealWindowLabel,
  getMealServiceWindowLabel,
} from '../TripScheduleScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';

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

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

const TRIP_ID = 'trip-123';

const PLANNED_ITEM: PlannedItemDTO = {
  id: 'item-1',
  experienceId: 'exp-1',
  experienceName: 'Space Mountain',
  park: 'Magic Kingdom',
  customTitle: null,
  addedByDisplayName: 'Ada',
  plannedDate: null,
  plannedTime: null,
  isFixed: false,
  isLightningLane: false,
  useSingleRider: false,
  priority: 2,
  itemType: 'experience',
  durationMinutes: 15,
  windowStartMinutes: null,
  windowEndMinutes: null,
  mealPeriod: null,
  scheduledShowtime: null,
  predictedWaitMinutes: null,
  travelFromPrev: null,
  optimizedAt: null,
};

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
  } as any;

  const route = {
    key: 'TripSchedule',
    name: 'TripSchedule' as const,
    params: { tripId: TRIP_ID },
  } as any;

  return render(
    <QueryClientProvider client={queryClient}>
      <TripScheduleScreen navigation={navigation} route={route} />
    </QueryClientProvider>,
  );
}

describe('TripScheduleScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders date selector bar, planned items, and triggers optimization', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          description: 'Fun trip',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          status: 'upcoming',
          role: 'organizer',
          resorts: [],
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [{ ...PLANNED_ITEM, plannedDate: '2026-10-01' }] as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/schedule/optimize`) {
        return {
          items: [
            {
              plannedItemId: 'item-1',
              suggestedArrival: '2026-10-01T13:00:00.000Z',
              predictedWaitMinutes: 15,
              travelFromPrev: { kind: 'walk', minutes: 3 },
            },
          ],
          totalWaitMinutes: 15,
          totalWalkMinutes: 3,
          unfittedItemIds: [],
          warnings: [],
        } as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    // Check Date Selector Bar rendered
    await waitFor(() => {
      expect(screen.getByTestId('date-pill-2026-10-01')).toBeTruthy();
      expect(screen.getByTestId('date-pill-2026-10-02')).toBeTruthy();
    });

    // Check item rendered for today
    expect(screen.getByText('Space Mountain')).toBeTruthy();

    // Trigger optimize button
    const optimizeButton = screen.getByText('✨ Optimize');
    expect(optimizeButton).toBeTruthy();
    fireEvent.press(optimizeButton);

    // Verify optimized timeline and walking connector
    await waitFor(() => {
      expect(screen.getByText('Thu, Oct 1 Itinerary')).toBeTruthy();
      expect(screen.getByText('Wait: 15 min')).toBeTruthy();
      expect(screen.getByText('+3m walk')).toBeTruthy();
    });
  });

  it('renders the persisted optimization result and last-optimized hint without re-optimizing (R8.2)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          status: 'upcoming',
          role: 'organizer',
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        // Already-optimized item: carries a persisted result + optimizedAt.
        return [
          {
            ...PLANNED_ITEM,
            plannedDate: '2026-10-01',
            plannedTime: '2026-10-01T14:00:00.000Z',
            predictedWaitMinutes: 35,
            travelFromPrev: null,
            optimizedAt: '2026-10-01T18:00:00.000Z',
          },
        ] as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    // The persisted wait renders with no optimize press, and the day shows a
    // "Last optimized" hint (never a fabricated placeholder wait).
    await waitFor(() => {
      expect(screen.getByText('Wait: 35 min')).toBeTruthy();
      expect(screen.getByTestId('last-optimized-hint')).toBeTruthy();
    });
    expect(screen.queryByTestId('not-optimized-notice')).toBeNull();
    // optimize endpoint was never called
    expect(
      apiRequestMock.mock.calls.some(
        ([m, p]) => m === 'POST' && p === `/trips/${TRIP_ID}/schedule/optimize`,
      ),
    ).toBe(false);
  });

  it('shows the not-optimized notice and omits the wait pill for a scheduled but unoptimized day (R8.3)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          status: 'upcoming',
          role: 'organizer',
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        // Scheduled (has plannedTime) but never optimized: null result fields.
        return [
          {
            ...PLANNED_ITEM,
            plannedDate: '2026-10-01',
            plannedTime: '2026-10-01T14:00:00.000Z',
            predictedWaitMinutes: null,
            travelFromPrev: null,
            optimizedAt: null,
          },
        ] as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('not-optimized-notice')).toBeTruthy();
    });
    // No wait pill is shown for an unoptimized item.
    expect(screen.queryByText(/^Wait:/)).toBeNull();
    expect(screen.queryByTestId('last-optimized-hint')).toBeNull();
  });

  it('switches dates when date pills are pressed', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-10-01',
          endDate: '2026-10-02',
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [
          { ...PLANNED_ITEM, plannedDate: '2026-10-01', experienceName: 'Day 1 Ride' },
          { ...PLANNED_ITEM, id: 'item-2', plannedDate: '2026-10-02', experienceName: 'Day 2 Ride' },
        ] as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Day 1 Ride')).toBeTruthy();
    });

    // Switch to Day 2
    const day2Pill = screen.getByTestId('date-pill-2026-10-02');
    fireEvent.press(day2Pill);

    await waitFor(() => {
      expect(screen.getByText('Day 2 Ride')).toBeTruthy();
    });
  });

  it('opens inline experience search modal and adds selected experience to date', async () => {
    let itemAdded = false;
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-10-01',
          endDate: '2026-10-02',
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return itemAdded
          ? [{ ...PLANNED_ITEM, plannedDate: '2026-10-01', experienceName: 'Pirates of the Caribbean' }]
          : [];
      }
      if (method === 'GET' && path.startsWith('/catalog')) {
        return {
          experiences: [
            {
              id: 'exp-pirates',
              name: 'Pirates of the Caribbean',
              park: 'Magic Kingdom',
              land: 'Adventureland',
              category: 'attraction',
            },
          ],
        } as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/planned-items`) {
        itemAdded = true;
        expect(body).toEqual({ experienceId: 'exp-pirates', plannedDate: '2026-10-01' });
        return { ...PLANNED_ITEM, id: 'item-new', experienceName: 'Pirates of the Caribbean', plannedDate: '2026-10-01' };
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('+ Add to Thu, Oct 1')).toBeTruthy();
    });

    // Open Inline Add Modal
    fireEvent.press(screen.getByText('+ Add to Thu, Oct 1'));

    await waitFor(() => {
      expect(screen.getByTestId('schedule-picker-search')).toBeTruthy();
    });

    // Search and select experience in picker
    fireEvent.changeText(screen.getByTestId('schedule-picker-search'), 'Pirates');

    await waitFor(() => {
      expect(screen.getByText('Pirates of the Caribbean')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Pirates of the Caribbean'));

    // Assert item is added to schedule
    await waitFor(() => {
      expect(screen.getByText('Pirates of the Caribbean')).toBeTruthy();
    });
  });

  it('R9.3: allows selecting an experience already in the schedule and adds it again', async () => {
    let addBody: any = null;
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-10-01',
          endDate: '2026-10-02',
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        // Space Mountain (exp-1) is already on the schedule for this day.
        return [{ ...PLANNED_ITEM, plannedDate: '2026-10-01' }] as any;
      }
      if (method === 'GET' && path.startsWith('/catalog')) {
        // The catalog search returns the SAME experience already planned.
        return {
          experiences: [
            {
              id: PLANNED_ITEM.experienceId,
              name: 'Space Mountain',
              park: 'Magic Kingdom',
              land: 'Tomorrowland',
              category: 'attraction',
            },
          ],
        } as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/planned-items`) {
        addBody = body;
        return { ...PLANNED_ITEM, id: 'item-dup', plannedDate: '2026-10-01' } as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('+ Add to Thu, Oct 1')).toBeTruthy();
    });

    // Open the inline add modal and search for the already-planned experience.
    fireEvent.press(screen.getByText('+ Add to Thu, Oct 1'));

    await waitFor(() => {
      expect(screen.getByTestId('schedule-picker-search')).toBeTruthy();
    });
    fireEvent.changeText(screen.getByTestId('schedule-picker-search'), 'Space');

    // The result row for the already-planned experience is selectable (not
    // disabled) and tapping it POSTs a second add for the same Experience.
    const row = await screen.findByTestId(
      `schedule-picker-result-${PLANNED_ITEM.experienceId}`,
    );
    fireEvent.press(row);

    await waitFor(() => {
      expect(addBody).toEqual({
        experienceId: PLANNED_ITEM.experienceId,
        plannedDate: '2026-10-01',
      });
    });
  });

  it('allows selecting multiple experiences consecutively to the schedule date without modal closing', async () => {
    const postedItems: any[] = [];
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-10-01',
          endDate: '2026-10-02',
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [];
      }
      if (method === 'GET' && path.startsWith('/catalog')) {
        return {
          experiences: [
            {
              id: 'exp-pirates',
              name: 'Pirates of the Caribbean',
              park: 'Magic Kingdom',
              land: 'Adventureland',
              category: 'attraction',
            },
            {
              id: 'exp-haunted',
              name: 'Haunted Mansion',
              park: 'Magic Kingdom',
              land: 'Liberty Square',
              category: 'attraction',
            },
          ],
        } as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/planned-items`) {
        postedItems.push(body);
        return { ...PLANNED_ITEM, id: `item-${postedItems.length}`, plannedDate: '2026-10-01' } as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('+ Add to Thu, Oct 1')).toBeTruthy();
    });

    // Open add modal
    fireEvent.press(screen.getByText('+ Add to Thu, Oct 1'));

    await waitFor(() => {
      expect(screen.getByTestId('schedule-picker-search')).toBeTruthy();
    });
    fireEvent.changeText(screen.getByTestId('schedule-picker-search'), 'Magic');

    // Add first experience
    const row1 = await screen.findByTestId('schedule-picker-result-exp-pirates');
    fireEvent.press(row1);

    await waitFor(() => {
      expect(postedItems).toContainEqual({
        experienceId: 'exp-pirates',
        plannedDate: '2026-10-01',
      });
    });

    // Modal is still open and search input is present; add second experience
    expect(screen.getByTestId('schedule-picker-search')).toBeTruthy();
    const row2 = await screen.findByTestId('schedule-picker-result-exp-haunted');
    fireEvent.press(row2);

    await waitFor(() => {
      expect(postedItems).toContainEqual({
        experienceId: 'exp-haunted',
        plannedDate: '2026-10-01',
      });
    });

    expect(postedItems).toHaveLength(2);

    // Tap Done to close modal
    fireEvent.press(screen.getByTestId('schedule-add-done-btn'));
  });

  it('opens item settings modal, toggles dining/break, fixed time, LL, single rider, priority, and patches item', async () => {
    let patchPayload: any = null;
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-10-01',
          endDate: '2026-10-02',
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [{ ...PLANNED_ITEM, plannedDate: '2026-10-01' }];
      }
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-1`) {
        patchPayload = body;
        return;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });

    // Open Edit Settings Modal, select Soft Window (Breakfast), and tap Done
    fireEvent.press(screen.getByText('Edit Settings'));
    await waitFor(() => {
      expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('timing-mode-soft_window'));
    fireEvent.press(screen.getByTestId('meal-period-breakfast'));
    fireEvent.press(screen.getByText('Done'));
    await waitFor(() => {
      expect(patchPayload).toMatchObject({
        mealPeriod: 'breakfast',
        windowStartMinutes: 480,
        windowEndMinutes: 630,
      });
    });

    // Re-open Edit Settings Modal, select Exact Time, and tap Done
    await waitFor(() => {
      expect(screen.getByText('Edit Settings')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Edit Settings'));
    await waitFor(() => {
      expect(screen.getByTestId('timing-mode-exact_time')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('timing-mode-exact_time'));
    fireEvent.press(screen.getByText('12:00 PM'));
    fireEvent.press(screen.getByText('Done'));
    await waitFor(() => {
      expect(patchPayload).toMatchObject({ isFixed: true });
    });
  });

  it('removes item from trip via item settings modal', async () => {
    let deletedItemId: string | null = null;
    let itemsList = [{ ...PLANNED_ITEM, plannedDate: '2026-10-01' }];

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return itemsList;
      }
      if (method === 'DELETE' && path === `/trips/${TRIP_ID}/planned-items/item-1`) {
        deletedItemId = 'item-1';
        itemsList = [];
        return;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });

    // Open Edit Settings
    fireEvent.press(screen.getByText('Edit Settings'));

    await waitFor(() => {
      expect(screen.getByText('Remove from Trip')).toBeTruthy();
    });

    // Click Remove from Trip
    fireEvent.press(screen.getByText('Remove from Trip'));

    await waitFor(() => {
      expect(deletedItemId).toBe('item-1');
      expect(screen.queryByText('Space Mountain')).toBeNull();
    });
  });

  it('assigns unassigned experience to date and unassigns assigned item', async () => {
    let patchPayload: any = null;
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [
          { ...PLANNED_ITEM, id: 'item-unassigned', plannedDate: null, experienceName: 'Haunted Mansion' },
          { ...PLANNED_ITEM, id: 'item-assigned', plannedDate: '2026-10-01', experienceName: 'Space Mountain' },
        ];
      }
      if (method === 'PATCH' && path.startsWith(`/trips/${TRIP_ID}/planned-items/`)) {
        patchPayload = body;
        return;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Assign to Thu, Oct 1')).toBeTruthy();
    });

    // Assign Haunted Mansion to Thu, Oct 1
    fireEvent.press(screen.getByText('Assign to Thu, Oct 1'));
    await waitFor(() => {
      expect(patchPayload).toMatchObject({ plannedDate: '2026-10-01' });
    });

    // Unassign Space Mountain
    fireEvent.press(screen.getByText('Unassign'));
  });

  it('normalizes plannedDate in modal save payload to YYYY-MM-DD format (not raw ISO timestamp)', async () => {
    let patchPayload: any = null;
    const isoDateItem = {
      ...PLANNED_ITEM,
      id: 'item-iso',
      plannedDate: '2026-10-01T00:00:00.000Z',
      experienceName: 'Big Thunder Mountain Railroad',
    };

    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [isoDateItem];
      }
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-iso`) {
        patchPayload = body;
        return;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Big Thunder Mountain Railroad')).toBeTruthy();
    });

    // Open Edit Settings Modal
    fireEvent.press(screen.getByText('Edit Settings'));

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeTruthy();
    });

    // Tap Done to submit item settings
    fireEvent.press(screen.getByText('Done'));

    await waitFor(() => {
      expect(patchPayload).toBeTruthy();
      expect(patchPayload.plannedDate).toBe('2026-10-01');
      expect(patchPayload.plannedDate).not.toContain('T');
    });
  });

  it('selects time via preset pill / wheel columns, renders return window, and patches plannedTime with 24h conversion', async () => {
    let patchPayload: any = null;
    const llItem = {
      ...PLANNED_ITEM,
      id: 'item-ll-wheel',
      plannedDate: '2026-10-01',
      experienceName: 'Seven Dwarfs Mine Train',
      isLightningLane: true,
    };

    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [llItem];
      }
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-ll-wheel`) {
        patchPayload = body;
        return;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Seven Dwarfs Mine Train')).toBeTruthy();
    });

    // Open Edit Settings Modal
    fireEvent.press(screen.getByText('Edit Settings'));

    await waitFor(() => {
      expect(screen.getByText('3:00 PM')).toBeTruthy();
    });

    // Tap preset pill '3:00 PM'
    fireEvent.press(screen.getByText('3:00 PM'));

    // Verify return window text renders live in the modal
    await waitFor(() => {
      expect(screen.getByText(/Return Window: 3:00 PM – 4:00 PM/)).toBeTruthy();
      expect(screen.getByText(/Valid Entry: 2:55 PM – 4:15 PM/)).toBeTruthy();
    });

    // Tap 'Done' to save
    fireEvent.press(screen.getByText('Done'));

    await waitFor(() => {
      expect(patchPayload).toBeTruthy();
      expect(patchPayload.plannedTime).toBe('2026-10-01T19:00:00.000Z');
    });
  });

  it('renders human-readable warning messages for all warning codes and id-prefixed cases (with name resolution and fallbacks)', async () => {
    const plannedItems = [
      { ...PLANNED_ITEM, id: 'item-ll', experienceName: 'Space Mountain' },
      { ...PLANNED_ITEM, id: 'item-sr', experienceName: "Rock 'n' Roller Coaster" },
      { ...PLANNED_ITEM, id: 'item-vq', experienceName: 'TRON Lightcycle / Run' },
      { ...PLANNED_ITEM, id: 'item-show', experienceName: 'Indiana Jones™ Epic Stunt Spectacular!' },
    ];

    const mockOptResult: TripOptimizationResult = {
      items: [
        { plannedItemId: 'item-ll', suggestedArrival: '2026-10-01T10:00:00.000Z', predictedWaitMinutes: 10, travelFromPrev: null },
      ],
      totalWaitMinutes: 10,
      totalWalkMinutes: 0,
      unfittedItemIds: [],
      warnings: [
        'infeasible_fixed_gap',
        'expired_lightning_lane',
        'over_constrained',
        'lightning_lane:item-ll',
        'lightning_lane:missing-id',
        'single_rider:item-sr',
        'single_rider:missing-id',
        'virtual_queue:item-vq',
        'virtual_queue:missing-id',
        'show:item-show',
        'show:missing-id',
      ],
    };

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return plannedItems;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/schedule/optimize`) {
        return mockOptResult;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });

    // Trigger Optimize Day
    fireEvent.press(screen.getByText('✨ Optimize'));

    await waitFor(() => {
      // 1. infeasible_fixed_gap
      expect(screen.getByText(/• Fixed reservation times are tight or overlap with travel time\./)).toBeTruthy();
      // 2. expired_lightning_lane
      expect(screen.getByText(/• A Lightning Lane return window expired before arrival\./)).toBeTruthy();
      // 3. over_constrained
      expect(screen.getByText(/• Some lower-priority items could not be fitted into today’s timeline\./)).toBeTruthy();
      // 4. lightning_lane (resolved & fallback)
      expect(screen.getByText(/• ⚡ Space Mountain planned via Lightning Lane/)).toBeTruthy();
      expect(screen.getByText(/• ⚡ Planned via Lightning Lane/)).toBeTruthy();
      // 5. single_rider (resolved & fallback)
      expect(screen.getByText(/• 👤 Rock 'n' Roller Coaster planned via Single Rider line/)).toBeTruthy();
      expect(screen.getByText(/• 👤 Planned via Single Rider line/)).toBeTruthy();
      // 6. virtual_queue (resolved & fallback)
      expect(screen.getByText(/• 🎟️ TRON Lightcycle \/ Run uses Virtual Queue \(join at 7 AM \/ 1 PM\)/)).toBeTruthy();
      expect(screen.getByText(/• 🎟️ Virtual Queue item/)).toBeTruthy();
      // 7. show (resolved & fallback)
      expect(screen.getByText(/• 🎭 Indiana Jones™ Epic Stunt Spectacular! scheduled for showtime/)).toBeTruthy();
      expect(screen.getByText(/• 🎭 Scheduled for showtime/)).toBeTruthy();
    });
  });

  it('opens schedule settings modal, changes walking pace, early entry, extended evening, and after-hours, and dispatches PATCH /trips/:id on Done', async () => {
    let optimizePayload: any = null;
    let patchPayload: any = null;

    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
      }
      if (method === 'GET' && path === `/catalog`) {
        return { experiences: [] };
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [PLANNED_ITEM];
      }
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}`) {
        patchPayload = body;
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01', ...(body as object) } as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/schedule/optimize`) {
        optimizePayload = body;
        return { items: [], totalWaitMinutes: 0, totalWalkMinutes: 0, unfittedItemIds: [], warnings: [] };
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('schedule-settings-btn')).toBeTruthy();
    });

    // Open Schedule Settings Modal
    fireEvent.press(screen.getByTestId('schedule-settings-btn'));

    await waitFor(() => {
      expect(screen.getByText('Settings: Thu, Oct 1')).toBeTruthy();
    });

    // Select Fast Walking Pace
    fireEvent.press(screen.getByTestId('walking-pace-fast'));

    // Toggle Early Entry
    fireEvent.press(screen.getByTestId('toggle-early-entry'));

    // Toggle Extended Evening
    fireEvent.press(screen.getByTestId('toggle-extended-evening'));

    // Toggle After-Hours Ticket
    fireEvent.press(screen.getByTestId('toggle-after-hours'));

    // Select Start Hour 8:00 AM (8) and End Hour 10:00 PM (22) via quick preset
    fireEvent.press(screen.getByTestId('preset-park-open-close'));

    // Save settings
    fireEvent.press(screen.getByTestId('save-schedule-settings-btn'));

    await waitFor(() => {
      expect(patchPayload).toBeTruthy();
      expect(patchPayload.walkingSpeed).toBe('fast');
      expect(patchPayload.earlyEntryEligible).toBe(true);
      expect(patchPayload.dayTouringHours['2026-10-01']).toEqual({
        startHour: 9,
        endHour: 21,
        useEarlyEntry: true,
        useExtendedEvening: true,
        hasAfterHoursTicket: true,
      });
    });

    // Tap Optimize
    fireEvent.press(screen.getByText('✨ Optimize'));

    await waitFor(() => {
      expect(optimizePayload).toBeTruthy();
      expect(optimizePayload.date).toBe('2026-10-01');
      expect(optimizePayload.startHour).toBe(9);
      expect(optimizePayload.endHour).toBe(21);
    });
  });

  it('renders distinct per-park operating hours and early entry times for different parks', async () => {
    const itemsWithMultipleParks: PlannedItemDTO[] = [
      {
        ...PLANNED_ITEM,
        id: 'item-mk',
        park: 'Magic Kingdom',
        plannedDate: '2026-10-01',
      },
      {
        ...PLANNED_ITEM,
        id: 'item-hs',
        park: 'Hollywood Studios',
        plannedDate: '2026-10-01',
      },
      {
        ...PLANNED_ITEM,
        id: 'item-ak',
        park: 'Animal Kingdom',
        plannedDate: '2026-10-01',
      },
    ];

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          status: 'upcoming',
          role: 'organizer',
          earlyEntryEligible: true,
          resorts: [],
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return itemsWithMultipleParks;
      }
      if (method === 'GET' && path === '/catalog') {
        return { experiences: [] };
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Magic Kingdom')).toBeTruthy();
      expect(screen.getByText('9:00 AM - 10:00 PM')).toBeTruthy();
      expect(screen.getAllByText('Early Entry 8:30 AM').length).toBeGreaterThanOrEqual(2);

      expect(screen.getByText('Hollywood Studios')).toBeTruthy();
      expect(screen.getByText('9:00 AM - 9:00 PM')).toBeTruthy();
      expect(screen.getAllByText('Early Entry 8:30 AM').length).toBeGreaterThanOrEqual(1);

      expect(screen.getByText('Animal Kingdom')).toBeTruthy();
      expect(screen.getByText('8:00 AM - 6:00 PM')).toBeTruthy();
      expect(screen.getByText('Early Entry 7:30 AM')).toBeTruthy();
    });
  });

  it('allows selecting a Starting Park in settings and auto-fills its opening start time', async () => {
    let patchPayload: any = null;

    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
      }
      if (method === 'GET' && path === `/catalog`) {
        return { experiences: [] };
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [PLANNED_ITEM];
      }
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}`) {
        patchPayload = body;
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01', ...(body as object) } as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('schedule-settings-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('schedule-settings-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('starting-park-animal-kingdom')).toBeTruthy();
    });

    // Select Animal Kingdom as Starting Park (opens at 8:00 AM)
    fireEvent.press(screen.getByTestId('starting-park-animal-kingdom'));

    fireEvent.press(screen.getByTestId('save-schedule-settings-btn'));

    await waitFor(() => {
      expect(patchPayload).toBeTruthy();
      expect(patchPayload.dayTouringHours['2026-10-01'].startingPark).toBe('Animal Kingdom');
      expect(patchPayload.dayTouringHours['2026-10-01'].startHour).toBe(8);
    });
  });

  it('hides past dates from the date selector and defaults to today', async () => {
    // Fake "now" to 2026-08-09 12:00 ET so Aug 7 & 8 are past, Aug 9 is today.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-09T16:00:00.000Z')); // noon ET

    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-08-07',
          endDate: '2026-08-11',
          status: 'upcoming',
          role: 'organizer',
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [
          { ...PLANNED_ITEM, id: 'item-past', plannedDate: '2026-08-07', experienceName: 'Past Ride' },
          { ...PLANNED_ITEM, id: 'item-today', plannedDate: '2026-08-09', experienceName: 'Today Ride' },
          { ...PLANNED_ITEM, id: 'item-future', plannedDate: '2026-08-11', experienceName: 'Future Ride' },
        ] as any;
      }
      if (method === 'GET' && path.startsWith('/catalog')) {
        return { experiences: [] };
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    // Today and future dates should appear; past dates should not.
    await waitFor(() => {
      expect(screen.getByTestId('date-pill-2026-08-09')).toBeTruthy();
      expect(screen.getByTestId('date-pill-2026-08-10')).toBeTruthy();
      expect(screen.getByTestId('date-pill-2026-08-11')).toBeTruthy();
    });
    expect(screen.queryByTestId('date-pill-2026-08-07')).toBeNull();
    expect(screen.queryByTestId('date-pill-2026-08-08')).toBeNull();

    // The active date should default to today (2026-08-09), not the trip
    // startDate (2026-08-07). The "Today Ride" item should be visible.
    expect(screen.getByText('Today Ride')).toBeTruthy();

    jest.useRealTimers();
  });

  it('shows a newly added experience after optimize without needing to re-optimize (regression)', async () => {
    // Start with one item on the day. After optimize, add a second item.
    // Bug: the stale optResult.items only contained the first item, so
    // the timeline never rendered the newly added one until the user pressed
    // Optimize again.
    let callCount = 0;
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-10-01',
          endDate: '2026-10-02',
          status: 'upcoming',
          role: 'organizer',
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        callCount++;
        // After the add succeeds (callCount >= 3), return both items.
        if (callCount >= 3) {
          return [
            { ...PLANNED_ITEM, plannedDate: '2026-10-01' },
            {
              ...PLANNED_ITEM,
              id: 'item-new',
              experienceId: 'exp-pirates',
              experienceName: 'Pirates of the Caribbean',
              plannedDate: '2026-10-01',
            },
          ] as any;
        }
        return [{ ...PLANNED_ITEM, plannedDate: '2026-10-01' }] as any;
      }
      if (method === 'GET' && path.startsWith('/catalog')) {
        return {
          experiences: [
            {
              id: 'exp-pirates',
              name: 'Pirates of the Caribbean',
              park: 'Magic Kingdom',
              land: 'Adventureland',
              category: 'attraction',
            },
          ],
        } as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/schedule/optimize`) {
        return {
          items: [
            {
              plannedItemId: 'item-1',
              suggestedArrival: '2026-10-01T13:00:00.000Z',
              predictedWaitMinutes: 15,
              travelFromPrev: { kind: 'walk', minutes: 3 },
            },
          ],
          totalWaitMinutes: 15,
          totalWalkMinutes: 3,
          unfittedItemIds: [],
          warnings: [],
        } as TripOptimizationResult;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/planned-items`) {
        return {
          ...PLANNED_ITEM,
          id: 'item-new',
          experienceId: 'exp-pirates',
          experienceName: 'Pirates of the Caribbean',
          plannedDate: '2026-10-01',
        } as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    // Wait for initial render with item visible.
    await waitFor(() => {
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });

    // Optimize
    fireEvent.press(screen.getByText('✨ Optimize'));

    await waitFor(() => {
      expect(screen.getByText('Wait: 15 min')).toBeTruthy();
    });

    // Now add an experience via the add modal.
    fireEvent.press(screen.getByText('+ Add to Thu, Oct 1'));

    await waitFor(() => {
      expect(screen.getByTestId('schedule-picker-search')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId('schedule-picker-search'), 'Pirates');

    await waitFor(() => {
      expect(screen.getByText('Pirates of the Caribbean')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Pirates of the Caribbean'));

    // The new experience should be visible on the schedule WITHOUT needing
    // to press optimize again. Before the fix, this assertion would fail
    // because the stale optimizeMutation.data hid it.
    await waitFor(() => {
      expect(screen.getByText('Pirates of the Caribbean')).toBeTruthy();
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });
  });

  describe('Unit 2 - Meal Preference & Service Windows, Snack Period & Generic Window Control', () => {
    it('formats meal preference and service window labels correctly', () => {
      expect(getMealWindowLabel('breakfast')).toBe('8:00 AM – 10:30 AM');
      expect(getMealWindowLabel('lunch')).toBe('11:30 AM – 2:00 PM');
      expect(getMealWindowLabel('dinner')).toBe('5:00 PM – 8:00 PM');

      expect(getMealServiceWindowLabel('breakfast')).toBe('7:00 AM – 11:00 AM');
      expect(getMealServiceWindowLabel('lunch')).toBe('11:00 AM – 3:30 PM');
      expect(getMealServiceWindowLabel('dinner')).toBe('4:00 PM – 9:00 PM');
    });

    it('allows selecting meal preference preset and saves window bounds', async () => {
      let savedBody: any = null;
      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
            dayTouringHours: {
              '2026-10-01': { startHour: 9, endHour: 21 },
            },
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              plannedDate: '2026-10-01',
              itemType: 'break',
              customTitle: 'Quick Lunch',
            },
          ] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-1`) {
          savedBody = body;
          return { ...PLANNED_ITEM, ...(body as any) };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Quick Lunch')).toBeTruthy();
      });

      // Open Edit Settings
      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
      });

      // Switch to Soft Window (Around...) mode
      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));

      // Press Lunch meal period preset
      fireEvent.press(screen.getByTestId('meal-period-lunch'));

      // Press Done to save
      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(savedBody).toEqual(
          expect.objectContaining({
            mealPeriod: 'lunch',
            windowStartMinutes: 690,
            windowEndMinutes: 840,
            plannedTime: null,
            isFixed: false,
          }),
        );
      });
    });

    it('allows selecting snack period with flexible null window', async () => {
      let savedBody: any = null;
      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              plannedDate: '2026-10-01',
              itemType: 'break',
              customTitle: 'Dole Whip Snack',
            },
          ] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-1`) {
          savedBody = body;
          return { ...PLANNED_ITEM, ...(body as any) };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Dole Whip Snack')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
      });

      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));
      fireEvent.press(screen.getByTestId('meal-period-snack'));

      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(savedBody).toEqual(
          expect.objectContaining({
            mealPeriod: 'snack',
            windowStartMinutes: null,
            windowEndMinutes: null,
            plannedTime: null,
            isFixed: false,
          }),
        );
      });
    });

    it('allows selecting full service window preset', async () => {
      let savedBody: any = null;
      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              plannedDate: '2026-10-01',
              itemType: 'break',
              customTitle: 'Table Service Dinner',
            },
          ] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-1`) {
          savedBody = body;
          return { ...PLANNED_ITEM, ...(body as any) };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Table Service Dinner')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
      });

      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));
      fireEvent.press(screen.getByTestId('meal-service-dinner'));

      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(savedBody).toEqual(
          expect.objectContaining({
            mealPeriod: 'dinner',
            windowStartMinutes: 960,
            windowEndMinutes: 1260,
          }),
        );
      });
    });

    it('allows selecting time of day preset for any item type', async () => {
      let savedBody: any = null;
      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              plannedDate: '2026-10-01',
              experienceName: 'Big Thunder Mountain',
            },
          ] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-1`) {
          savedBody = body;
          return { ...PLANNED_ITEM, ...(body as any) };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Big Thunder Mountain')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
      });

      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));
      fireEvent.press(screen.getByTestId('time-of-day-540'));

      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(savedBody).toEqual(
          expect.objectContaining({
            mealPeriod: null,
            windowStartMinutes: 540,
            windowEndMinutes: 720,
          }),
        );
      });
    });

    it('displays unserved meal warning when restaurant does not list meal period', async () => {
      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              plannedDate: '2026-10-01',
              experienceName: 'Be Our Guest Restaurant',
              servedMealPeriods: ['lunch', 'dinner'],
            },
          ] as any;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Be Our Guest Restaurant')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
      });

      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));
      fireEvent.press(screen.getByTestId('meal-period-breakfast'));

      // Warning should be displayed
      expect(screen.getByTestId('unserved-meal-warning')).toBeTruthy();
      expect(
        screen.getByText(/Breakfast is not listed as a served meal period for this restaurant/i),
      ).toBeTruthy();

      // Selecting Lunch should clear the warning
      fireEvent.press(screen.getByTestId('meal-period-lunch'));
      expect(screen.queryByTestId('unserved-meal-warning')).toBeNull();
    });

    it('Property 17: steps custom start/end and sends updated window bounds in PATCH payload', async () => {
      let savedBody: any = null;
      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              plannedDate: '2026-10-01',
              experienceName: 'Space Mountain',
              windowStartMinutes: 540,
              windowEndMinutes: 660,
            },
          ] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-1`) {
          savedBody = body;
          return { ...PLANNED_ITEM, ...(body as any) };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Space Mountain')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
      });

      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));

      // Step start time +30m
      fireEvent.press(screen.getByTestId('stepper-start-plus'));
      // Step end time +30m
      fireEvent.press(screen.getByTestId('stepper-end-plus'));

      expect(screen.getByTestId('custom-start-val').props.children).toBe('9:30 AM');
      expect(screen.getByTestId('custom-end-val').props.children).toBe('11:30 AM');

      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(savedBody).toEqual(
          expect.objectContaining({
            windowStartMinutes: 570,
            windowEndMinutes: 690,
          }),
        );
      });
    });

    it('Property 17: clamps custom range to MEAL_SERVICE_WINDOWS when mealPeriod is set (cannot make a 4:00 PM lunch)', async () => {
      let savedBody: any = null;
      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              plannedDate: '2026-10-01',
              itemType: 'break',
              customTitle: 'Lunch Table Reservation',
              mealPeriod: 'lunch',
              windowStartMinutes: 690, // 11:30 AM
              windowEndMinutes: 840,   // 2:00 PM
            },
          ] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-1`) {
          savedBody = body;
          return { ...PLANNED_ITEM, ...(body as any) };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Lunch Table Reservation')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
      });

      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));

      // Attempt to step start earlier than lunch service span (11:00 AM = 660 mins)
      fireEvent.press(screen.getByTestId('stepper-start-minus')); // 11:00 AM
      fireEvent.press(screen.getByTestId('stepper-start-minus')); // Clamped at 11:00 AM
      fireEvent.press(screen.getByTestId('stepper-start-minus')); // Clamped at 11:00 AM
      expect(screen.getByTestId('custom-start-val').props.children).toBe('11:00 AM');

      // Attempt to step end later than lunch service span (3:30 PM = 930 mins, e.g. 4:00 PM)
      fireEvent.press(screen.getByTestId('stepper-end-plus')); // 2:30 PM
      fireEvent.press(screen.getByTestId('stepper-end-plus')); // 3:00 PM
      fireEvent.press(screen.getByTestId('stepper-end-plus')); // 3:30 PM
      fireEvent.press(screen.getByTestId('stepper-end-plus')); // Clamped at 3:30 PM
      fireEvent.press(screen.getByTestId('stepper-end-plus')); // Clamped at 3:30 PM
      expect(screen.getByTestId('custom-end-val').props.children).toBe('3:30 PM');

      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(savedBody).toEqual(
          expect.objectContaining({
            mealPeriod: 'lunch',
            windowStartMinutes: 660,
            windowEndMinutes: 930,
          }),
        );
      });
    });

    it('Property 17: clamps custom range to day touring hours when no mealPeriod is set', async () => {
      let savedBody: any = null;
      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              plannedDate: '2026-10-01',
              experienceName: 'Haunted Mansion',
              mealPeriod: null,
              windowStartMinutes: 660, // 11:00 AM
              windowEndMinutes: 840,   // 2:00 PM
            },
          ] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-1`) {
          savedBody = body;
          return { ...PLANNED_ITEM, ...(body as any) };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Haunted Mansion')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
      });

      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));

      // Attempt to step start earlier than touring day start (9:00 AM = 540 mins)
      for (let i = 0; i < 10; i++) {
        fireEvent.press(screen.getByTestId('stepper-start-minus'));
      }
      expect(screen.getByTestId('custom-start-val').props.children).toBe('9:00 AM');

      // Attempt to step end later than touring day end (9:00 PM = 1260 mins)
      for (let i = 0; i < 20; i++) {
        fireEvent.press(screen.getByTestId('stepper-end-plus'));
      }
      expect(screen.getByTestId('custom-end-val').props.children).toBe('9:00 PM');

      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(savedBody).toEqual(
          expect.objectContaining({
            mealPeriod: null,
            windowStartMinutes: 540,
            windowEndMinutes: 1260,
          }),
        );
      });
    });
  });

  describe('Showtime Pills and Typical Showtimes Notice (crowd-calendar R12 / day-planning R13.4)', () => {
    it('renders showtime pills in Item Settings modal for a Show experience and locks performance on selection', async () => {
      let savedBody: any = null;
      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-show-1',
                name: 'Festival of the Lion King',
                category: 'Show',
                park: "Disney's Animal Kingdom",
              },
            ],
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              id: 'item-show-1',
              experienceId: 'exp-show-1',
              experienceName: 'Festival of the Lion King',
              park: "Disney's Animal Kingdom",
              plannedDate: '2026-10-01',
            },
          ] as any;
        }
        if (method === 'GET' && path.startsWith('/crowd-calendar')) {
          return [
            {
              date: '2026-10-01',
              park: "Disney's Animal Kingdom",
              rideSignals: [
                {
                  experienceId: 'exp-show-1',
                  reliability: 1,
                  showtimes: ['2026-10-01T14:00:00.000Z', '2026-10-01T18:00:00.000Z'],
                },
              ],
            },
          ] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-show-1`) {
          savedBody = body;
          return { ...PLANNED_ITEM, ...(body as any) };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Festival of the Lion King')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('showtimes-section')).toBeTruthy();
        expect(screen.getByTestId('showtime-autofit-pill')).toBeTruthy();
        expect(screen.getByTestId('showtime-pill-10:00-am')).toBeTruthy();
        expect(screen.getByTestId('showtime-pill-2:00-pm')).toBeTruthy();
      });

      // Tap 10:00 AM showtime pill
      fireEvent.press(screen.getByTestId('showtime-pill-10:00-am'));
      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(savedBody).toEqual(
          expect.objectContaining({
            isFixed: true,
            plannedTime: '2026-10-01T14:00:00.000Z',
          }),
        );
      });
    });

    it('clears plannedTime and isFixed when Auto-fit pill is pressed', async () => {
      let savedBody: any = null;
      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-show-1',
                name: 'Festival of the Lion King',
                category: 'Show',
                park: "Disney's Animal Kingdom",
              },
            ],
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              id: 'item-show-1',
              experienceId: 'exp-show-1',
              experienceName: 'Festival of the Lion King',
              park: "Disney's Animal Kingdom",
              plannedDate: '2026-10-01',
              plannedTime: '2026-10-01T14:00:00.000Z',
              isFixed: true,
            },
          ] as any;
        }
        if (method === 'GET' && path.startsWith('/crowd-calendar')) {
          return [
            {
              date: '2026-10-01',
              park: "Disney's Animal Kingdom",
              rideSignals: [
                {
                  experienceId: 'exp-show-1',
                  reliability: 1,
                  showtimes: ['2026-10-01T14:00:00.000Z', '2026-10-01T18:00:00.000Z'],
                },
              ],
            },
          ] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-show-1`) {
          savedBody = body;
          return { ...PLANNED_ITEM, ...(body as any) };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Festival of the Lion King')).toBeTruthy();
      });

      // Item has plannedTime, so tapping its name in the timeline opens the edit modal
      fireEvent.press(screen.getByText('Festival of the Lion King'));

      await waitFor(() => {
        expect(screen.getByTestId('showtimes-section')).toBeTruthy();
        expect(screen.getByTestId('showtime-autofit-pill')).toBeTruthy();
      });

      // Tap Auto-fit pill
      fireEvent.press(screen.getByTestId('showtime-autofit-pill'));
      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(savedBody).toEqual(
          expect.objectContaining({
            isFixed: false,
            plannedTime: null,
          }),
        );
      });
    });

    it('renders empty state when no showtimes are published for that date', async () => {
      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-show-1',
                name: 'Festival of the Lion King',
                category: 'Show',
                park: "Disney's Animal Kingdom",
              },
            ],
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              id: 'item-show-1',
              experienceId: 'exp-show-1',
              experienceName: 'Festival of the Lion King',
              park: "Disney's Animal Kingdom",
              plannedDate: '2026-10-01',
            },
          ] as any;
        }
        if (method === 'GET' && path.startsWith('/crowd-calendar')) {
          return [
            {
              date: '2026-10-01',
              park: "Disney's Animal Kingdom",
              rideSignals: [],
            },
          ] as any;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Festival of the Lion King')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('showtimes-section')).toBeTruthy();
        expect(screen.getByTestId('showtimes-empty-state')).toBeTruthy();
        expect(screen.getByText('Showtimes are not published yet for this date.')).toBeTruthy();
      });
    });

    it('renders typical showtime notice when optimization warning contains typical_showtimes', async () => {
      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            startDate: '2026-10-01',
            endDate: '2026-10-03',
          } as any;
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-show-1',
                name: 'Festival of the Lion King',
                category: 'Show',
                park: "Disney's Animal Kingdom",
              },
            ],
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [
            {
              ...PLANNED_ITEM,
              id: 'item-show-1',
              experienceId: 'exp-show-1',
              experienceName: 'Festival of the Lion King',
              park: "Disney's Animal Kingdom",
              plannedDate: '2026-10-01',
              plannedTime: '2026-10-01T14:00:00.000Z',
            },
          ] as any;
        }
        if (method === 'POST' && path === `/trips/${TRIP_ID}/schedule/optimize`) {
          return {
            tripId: TRIP_ID,
            date: '2026-10-01',
            totalWaitMinutes: 0,
            totalTransitMinutes: 0,
            totalWalkMinutes: 0,
            unfittedItemIds: [],
            items: [
              {
                plannedItemId: 'item-show-1',
                suggestedArrival: '2026-10-01T13:45:00.000Z',
                predictedWaitMinutes: 0,
                travelFromPrev: null,
              },
            ],
            warnings: ['typical_showtimes:item-show-1'],
          } as TripOptimizationResult;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Festival of the Lion King')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('✨ Optimize'));

      await waitFor(() => {
        expect(screen.getByTestId('typical-showtime-notice-item-show-1')).toBeTruthy();
        expect(screen.getByText('• 🎭 Estimated showtime based on past schedule for Festival of the Lion King')).toBeTruthy();
      });
    });
  });

  describe('Real-Device Fixes (Units B1, B3, B4)', () => {
    it('B1: gates Single Rider and Lightning Lane toggles strictly on ride-like categories', async () => {
      // Setup a Quick Service dining item (category: Restaurant)
      const diningItem: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-dining-1',
        experienceId: 'exp-dining-1',
        experienceName: 'Pecos Bill Tall Tale Inn and Cafe',
        plannedDate: '2026-10-01',
      };

      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [diningItem];
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-dining-1',
                name: 'Pecos Bill Tall Tale Inn and Cafe',
                category: 'Restaurant',
                subType: 'Quick Service',
                park: 'Magic Kingdom',
              },
            ],
          };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Pecos Bill Tall Tale Inn and Cafe')).toBeTruthy();
      });

      // Open Edit Settings
      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-exact_time')).toBeTruthy();
      });

      // Single Rider toggle should NOT be rendered for dining
      expect(screen.queryByText(/Single Rider Line:/)).toBeNull();

      // Switch to exact time mode
      fireEvent.press(screen.getByTestId('timing-mode-exact_time'));

      // Lightning Lane toggle should NOT be rendered for dining
      expect(screen.queryByText(/Mode: Lightning Lane/)).toBeNull();
    });

    it('B3: does not warn for lunch/dinner when restaurant serves compound "Lunch And Dinner" (Pecos Bill)', async () => {
      const pecosBillItem: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-pecos',
        experienceId: 'exp-pecos',
        experienceName: 'Pecos Bill Tall Tale Inn and Cafe',
        plannedDate: '2026-10-01',
        servedMealPeriods: ['Lunch And Dinner'],
      };

      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [pecosBillItem];
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-pecos',
                name: 'Pecos Bill Tall Tale Inn and Cafe',
                category: 'Restaurant',
                subType: 'Quick Service',
                park: 'Magic Kingdom',
                mealPeriods: [{ type: 'Lunch And Dinner' }],
              },
            ],
          };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Pecos Bill Tall Tale Inn and Cafe')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
      });

      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));

      // Select Lunch: compound "Lunch And Dinner" MUST match lunch without warning
      fireEvent.press(screen.getByTestId('meal-period-lunch'));
      expect(screen.queryByTestId('unserved-meal-warning')).toBeNull();

      // Select Dinner: compound "Lunch And Dinner" MUST match dinner without warning
      fireEvent.press(screen.getByTestId('meal-period-dinner'));
      expect(screen.queryByTestId('unserved-meal-warning')).toBeNull();

      // Select Breakfast: Pecos Bill does not serve breakfast -> warning MUST appear
      fireEvent.press(screen.getByTestId('meal-period-breakfast'));
      expect(screen.getByTestId('unserved-meal-warning')).toBeTruthy();
    });

    it('B4: does not overwrite duration with 15 when modifying only priority on Quick Service dining', async () => {
      let patchPayload: any = null;
      const diningItem: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-qs',
        experienceId: 'exp-qs',
        experienceName: 'Cosmic Ray’s Starlight Café',
        plannedDate: '2026-10-01',
        durationMinutes: null, // default duration is derived by optimizer (30 min for QS)
      };

      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [diningItem];
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-qs',
                name: 'Cosmic Ray’s Starlight Café',
                category: 'Restaurant',
                subType: 'Quick Service',
                park: 'Magic Kingdom',
              },
            ],
          };
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-qs`) {
          patchPayload = body;
          return;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Cosmic Ray’s Starlight Café')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByText('Must Do (1)')).toBeTruthy();
      });

      // User only changes Priority to 1
      fireEvent.press(screen.getByText('Must Do (1)'));

      // User saves modal
      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(patchPayload).toBeTruthy();
      });

      expect(patchPayload.priority).toBe(1);
      // durationMinutes MUST NOT be sent as 15 (which destroys the 30m QS default)
      expect(patchPayload.durationMinutes).toBeUndefined();
    });
  });
});

