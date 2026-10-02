/**
 * TripScheduleScreen component tests (task 5.3).
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';

jest.setTimeout(15000);

import { ExperienceDTO, PlannedItemDTO, TripOptimizationResult } from '@dwt/shared';

import TripScheduleScreen, {
  getMealWindowLabel,
  getMealServiceWindowLabel,
  getTodayWDW,
  getWDWNowMinutes,
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
  catalogDurationMinutes: null,
  windowStartMinutes: null,
  windowEndMinutes: null,
  mealPeriod: null,
  scheduledShowtime: null,
  predictedWaitMinutes: null,
  travelFromPrev: null,
  optimizedAt: null,
  // Not a Reservation: an ordinary planned item carries a null booking facet.
  reservationKind: null,
  confirmationNumber: null,
  partySize: null,
};

function renderScreen(navOverrides?: Record<string, any>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    replace: jest.fn(),
    getState: jest.fn(() => ({
      index: 0,
      routes: [{ name: 'TripSchedule', params: { tripId: TRIP_ID } }],
    })),
    ...navOverrides,
  } as any;

  const route = {
    key: 'TripSchedule',
    name: 'TripSchedule' as const,
    params: { tripId: TRIP_ID },
  } as any;

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <TripScheduleScreen navigation={navigation} route={route} />
    </QueryClientProvider>,
  );

  return Object.assign(rendered, { navigation });
}

describe('TripScheduleScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
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

  it('shows the curated catalog duration on the duration pill when there is no user override (R11.6, Property 23)', async () => {
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
        // No user-set durationMinutes, but a curated catalogDurationMinutes —
        // the pill must show 12m, never the flat 15m fallback. A plannedTime
        // is required so the item renders in the scheduled timeline (where
        // the duration pill lives), not the unscheduled-items card.
        return [
          {
            ...PLANNED_ITEM,
            plannedDate: '2026-10-01',
            plannedTime: '2026-10-01T14:00:00.000Z',
            durationMinutes: null,
            catalogDurationMinutes: 12,
          },
        ] as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('🎢 12m duration')).toBeTruthy();
    });
    expect(screen.queryByText('🎢 15m duration')).toBeNull();
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

  it('does not bleed a stale optimize result from one date into a subsequently selected date', async () => {
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
        return [
          {
            ...PLANNED_ITEM,
            id: 'item-day1',
            plannedDate: '2026-10-01',
            plannedTime: '2026-10-01T13:00:00.000Z',
            experienceName: 'Day 1 Ride',
          },
          {
            ...PLANNED_ITEM,
            id: 'item-day2',
            plannedDate: '2026-10-02',
            plannedTime: '2026-10-02T13:00:00.000Z',
            experienceName: 'Day 2 Ride',
          },
        ] as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/schedule/optimize`) {
        expect((body as any).date).toBe('2026-10-01');
        return {
          items: [
            {
              plannedItemId: 'item-day1',
              suggestedArrival: '2026-10-01T13:00:00.000Z',
              predictedWaitMinutes: 5,
              travelFromPrev: null,
            },
          ],
          totalWaitMinutes: 5,
          totalWalkMinutes: 0,
          unfittedItemIds: [],
          warnings: [],
        };
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Day 1 Ride')).toBeTruthy();
    });

    // Day 1 starts not-optimized (no persisted result yet).
    expect(screen.getByTestId('not-optimized-notice')).toBeTruthy();

    // Optimize Day 1 — a fresh optResult now sits in optimizeMutation.data,
    // and the day's wait pill switches from persisted-null to the fresh 5-min
    // optimize result.
    fireEvent.press(screen.getByText('✨ Optimize'));

    await waitFor(() => {
      expect(screen.getByText(/5 min/)).toBeTruthy();
    });
    expect(screen.queryByTestId('not-optimized-notice')).toBeNull();

    // Switch to Day 2, which has never been optimized.
    fireEvent.press(screen.getByTestId('date-pill-2026-10-02'));

    await waitFor(() => {
      expect(screen.getByText('Day 2 Ride')).toBeTruthy();
    });

    // Day 2's own item must render (from the persisted/never-optimized path),
    // not Day 1's stale optimize result: Day 1's item must be gone, Day 2 must
    // NOT show a 5-min wait pill (that belonged to Day 1's fresh result), and
    // Day 2 must show its own not-optimized notice.
    expect(screen.queryByText('Day 1 Ride')).toBeNull();
    expect(screen.queryByText(/5 min/)).toBeNull();
    expect(screen.getByTestId('not-optimized-notice')).toBeTruthy();
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

  it('R9.3 & R15.5: shows the "Already added" tag for a Trip-wide already-planned experience, while keeping it selectable and adding it again', async () => {
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

    // R15.5: the row is annotated with a non-blocking "Already added" tag,
    // derived Trip-wide (any date) from the already-fetched planned_items —
    // not the disabledIds mechanism, so accessibilityState.disabled is false.
    expect(screen.getByText('Already added')).toBeTruthy();
    expect(row.props.accessibilityState?.disabled).toBe(false);

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
    fireEvent.press(screen.getByTestId('time-of-day-540'));
    fireEvent.press(screen.getByText('Done'));
    await waitFor(() => {
      expect(patchPayload).toMatchObject({
        mealPeriod: null,
        windowStartMinutes: 540,
        windowEndMinutes: 720,
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

  // NOTE: this case drives the *preset pill* only. The wheel columns are covered
  // separately in the "shared time wheel" describe block at the end of this file
  // — the name previously claimed wheel coverage it did not have.
  it('selects time via a preset pill, renders the return window, and patches plannedTime with 24h conversion', async () => {
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
        startMinutes: 540,
        startMode: 'park_open',
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
      expect(optimizePayload.startMode).toBe('park_open');
      expect(optimizePayload.startMinutes).toBe(540);
    });
  });

  it('selects Minimize Waits walk/wait priority and dispatches it on PATCH /trips/:id (R10.1, R10.4)', async () => {
    let patchPayload: any = null;

    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01', walkWaitWeighting: 'balanced' } as any;
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
      expect(screen.getByText('Settings: Thu, Oct 1')).toBeTruthy();
    });

    // Balanced is the default and should be visible.
    expect(screen.getByTestId('walk-wait-weighting-balanced')).toBeTruthy();

    // Select Minimize Waits.
    fireEvent.press(screen.getByTestId('walk-wait-weighting-minimize_waits'));

    // Save settings
    fireEvent.press(screen.getByTestId('save-schedule-settings-btn'));

    await waitFor(() => {
      expect(patchPayload).toBeTruthy();
      expect(patchPayload.walkWaitWeighting).toBe('minimize_waits');
    });
  });

  it('reflects a persisted non-default walk/wait priority from the trip on load (R10.1, R10.4)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01', walkWaitWeighting: 'minimize_walking' } as any;
      }
      if (method === 'GET' && path === `/catalog`) {
        return { experiences: [] };
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [PLANNED_ITEM];
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('schedule-settings-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('schedule-settings-btn'));

    await waitFor(() => {
      expect(screen.getByText('Settings: Thu, Oct 1')).toBeTruthy();
    });

    // The persisted 'minimize_walking' value should render as the active
    // chip: optionChipTextActive overrides `color` to theme.color.textOnPrimary,
    // distinct from the inactive chip's theme.color.textSecondary.
    const activeLabel = screen.getByText('🚶 Minimize Walking');
    const inactiveLabel = screen.getByText('⚖️ Balanced');
    const flatten = (style: unknown) => Object.assign({}, ...(Array.isArray(style) ? style : [style]));
    expect(flatten(activeLabel.props.style).color).not.toBe(flatten(inactiveLabel.props.style).color);
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
          // The real endpoint responds with a `{ days: [...] }` envelope, not a bare array.
          return { days: [
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
          ] } as any;
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
          // The real endpoint responds with a `{ days: [...] }` envelope, not a bare array.
          return { days: [
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
          ] } as any;
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
          // The real endpoint responds with a `{ days: [...] }` envelope, not a bare array.
          return { days: [
            {
              date: '2026-10-01',
              park: "Disney's Animal Kingdom",
              rideSignals: [],
            },
          ] } as any;
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

    // A failing crowd-calendar read must NOT be indistinguishable from "no showtimes".
    // This screen previously swallowed the error and rendered the empty state, which is
    // what hid a response-shape mismatch: the endpoint returns `{ days: [...] }` and the
    // client was indexing the envelope as an array.
    it('renders a distinct error state when the crowd-calendar read fails', async () => {
      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, startDate: '2026-10-01', endDate: '2026-10-03' } as any;
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
          throw new Error('crowd-calendar unavailable');
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Festival of the Lion King')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('showtimes-error-state')).toBeTruthy();
      });
      // The failure must not be reported as "not published yet".
      expect(screen.queryByTestId('showtimes-empty-state')).toBeNull();
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
      expect(screen.queryByTestId('single-rider-toggle')).toBeNull();

      // Switch to exact time mode
      fireEvent.press(screen.getByTestId('timing-mode-exact_time'));

      // Lightning Lane toggle should NOT be rendered for dining
      expect(screen.queryByText(/Mode: Lightning Lane/)).toBeNull();
      expect(screen.queryByTestId('timing-mode-lightning-lane')).toBeNull();
      expect(screen.queryByTestId('ll-option-toggle')).toBeNull();
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

    it('renders Time Window presets without meal periods and renders Lightning Lane & Single Rider options for a Ride', async () => {
      const rideItem: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-ride-1',
        experienceId: 'exp-ride-1',
        experienceName: 'Space Mountain',
        plannedDate: '2026-10-01',
      };

      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [rideItem];
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-ride-1',
                name: 'Space Mountain',
                category: 'Ride',
                park: 'Magic Kingdom',
              },
            ],
          };
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

      // Switch to Time Window
      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));

      // Meal preference and service presets MUST NOT appear for a ride
      expect(screen.queryByText('Meal Preference Presets')).toBeNull();
      expect(screen.queryByText('Full Service Window Presets')).toBeNull();
      expect(screen.queryByTestId('meal-period-breakfast')).toBeNull();

      // Generic Time of Day presets MUST appear
      expect(screen.getByText('Time of Day Presets')).toBeTruthy();
      expect(screen.getByTestId('time-of-day-540')).toBeTruthy();

      // Options section MUST show both Lightning Lane and Single Rider for rides
      expect(screen.getByTestId('ll-option-toggle')).toBeTruthy();
      expect(screen.getByTestId('single-rider-toggle')).toBeTruthy();

      // Duration section MUST NOT appear for a ride
      expect(screen.queryByText('Duration')).toBeNull();
      expect(screen.queryByTestId('duration-chip-15')).toBeNull();
    });

    it('renders Time Window presets without meal periods and renders Lightning Lane option for a Show (Indiana Jones)', async () => {
      let patchPayload: any = null;
      const showItem: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-indy',
        experienceId: 'exp-indy',
        experienceName: 'Indiana Jones™ Epic Stunt Spectacular!',
        park: 'Hollywood Studios',
        plannedDate: '2026-10-01',
      };

      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [showItem];
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-indy',
                name: 'Indiana Jones™ Epic Stunt Spectacular!',
                category: 'Show',
                park: 'Hollywood Studios',
              },
            ],
          };
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-indy`) {
          patchPayload = body;
          return;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Indiana Jones™ Epic Stunt Spectacular!')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-soft_window')).toBeTruthy();
      });

      // Duration section MUST NOT appear for a show
      expect(screen.queryByText('Duration')).toBeNull();
      expect(screen.queryByTestId('duration-chip-30')).toBeNull();

      // Switch to Time Window
      fireEvent.press(screen.getByTestId('timing-mode-soft_window'));

      // Meal presets MUST NOT be shown for Indiana Jones (Show)
      expect(screen.queryByText('Meal Preference Presets')).toBeNull();
      expect(screen.queryByText('Full Service Window Presets')).toBeNull();
      expect(screen.queryByTestId('meal-period-lunch')).toBeNull();

      // Time of Day presets MUST be shown
      expect(screen.getByText('Time of Day Presets')).toBeTruthy();

      // Lightning Lane option MUST be available for Show
      expect(screen.getByTestId('ll-option-toggle')).toBeTruthy();

      // Switch to Exact Time mode
      fireEvent.press(screen.getByTestId('timing-mode-exact_time'));

      // Exact mode toggle row MUST show Lightning Lane and Fixed Time options
      expect(screen.getByTestId('timing-mode-lightning-lane')).toBeTruthy();
      expect(screen.getByTestId('timing-mode-fixed-lock')).toBeTruthy();

      // Select Lightning Lane
      fireEvent.press(screen.getByTestId('timing-mode-lightning-lane'));
      expect(screen.getByText('⚡ Lightning Lane Window Start Time')).toBeTruthy();

      // Pick preset time 12:00 PM
      fireEvent.press(screen.getByText('12:00 PM'));

      // Return window breakdown MUST be visible
      expect(screen.getByTestId('ll-window-info')).toBeTruthy();
      expect(screen.getByText(/Return Window: 12:00 PM – 1:00 PM/)).toBeTruthy();

      // Save
      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(patchPayload).toBeTruthy();
      });

      expect(patchPayload.isLightningLane).toBe(true);
      expect(patchPayload.isFixed).toBe(false);
      expect(patchPayload.plannedTime).toBe('2026-10-01T16:00:00.000Z');
      expect(patchPayload.durationMinutes).toBeUndefined();
    });

    it('enabling Lightning Lane via Options toggle switches to exact time mode and sets pass', async () => {
      let patchPayload: any = null;
      const rideItem: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-ride-2',
        experienceId: 'exp-ride-2',
        experienceName: 'Big Thunder Mountain Railroad',
        plannedDate: '2026-10-01',
      };

      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [rideItem];
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-ride-2',
                name: 'Big Thunder Mountain Railroad',
                category: 'Ride',
                park: 'Magic Kingdom',
              },
            ],
          };
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-ride-2`) {
          patchPayload = body;
          return;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Big Thunder Mountain Railroad')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('ll-option-toggle')).toBeTruthy();
      });

      // Tap LL Option toggle
      fireEvent.press(screen.getByTestId('ll-option-toggle'));

      // Saves modal
      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(patchPayload).toBeTruthy();
      });

      expect(patchPayload.isLightningLane).toBe(true);
      expect(patchPayload.isFixed).toBe(false);
      expect(patchPayload.durationMinutes).toBeUndefined();
    });

    it('renders duration chips and allows customizing duration for breaks and dining', async () => {
      let patchPayload: any = null;
      const breakItem: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-break-1',
        itemType: 'break',
        customTitle: 'Resort Pool Break',
        plannedDate: '2026-10-01',
      };

      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [breakItem];
        }
        if (method === 'GET' && path === '/catalog') {
          return { experiences: [] };
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-break-1`) {
          patchPayload = body;
          return;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Resort Pool Break')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Edit Settings'));

      await waitFor(() => {
        expect(screen.getByTestId('duration-chip-45')).toBeTruthy();
      });

      // Select 45 min duration chip
      fireEvent.press(screen.getByTestId('duration-chip-45'));

      // Save modal
      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(patchPayload).toBeTruthy();
      });

      expect(patchPayload.durationMinutes).toBe(45);
    });
  });

  describe('Break and custom item location display (R4.11)', () => {
    it('renders location on timeline attraction card and transit leg to break destination', async () => {
      const breakWithLoc: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-break-loc',
        itemType: 'break',
        customTitle: 'Back to the hotel',
        experienceId: 'exp-resort-poly',
        experienceName: "Disney's Polynesian Village Resort",
        park: null,
        plannedDate: '2026-10-01',
        plannedTime: '2026-10-01T16:51:00.000Z',
        durationMinutes: 60,
        predictedWaitMinutes: 0,
        travelFromPrev: { kind: 'park_hop', minutes: 45 },
      };

      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [breakWithLoc];
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: 'exp-resort-poly',
                name: "Disney's Polynesian Village Resort",
                category: 'Resort',
                land: 'Seven Seas Lagoon',
                park: null,
              },
            ],
          };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Back to the hotel')).toBeTruthy();
      });

      // Assert location is rendered on the timeline card
      const locEl = screen.getByTestId('item-location-item-break-loc');
      expect(locEl).toBeTruthy();
      expect(within(locEl).getByText(/Disney's Polynesian Village Resort/)).toBeTruthy();

      // Assert transit leg shows destination instead of empty park hop
      expect(screen.getByText(/Transit to Disney's Polynesian Village Resort/)).toBeTruthy();

      // Assert wait pill is omitted for break items even when predictedWaitMinutes is 0
      expect(screen.queryByText(/^Wait:/)).toBeNull();
      expect(screen.getByText('☕ 60m break')).toBeTruthy();

      // Open Edit Settings modal
      fireEvent.press(screen.getByText('Back to the hotel'));

      await waitFor(() => {
        expect(screen.getByTestId('item-modal-location')).toBeTruthy();
      });

      expect(screen.getByText("Disney's Polynesian Village Resort")).toBeTruthy();
    });

    it('renders location on unscheduled item cards when custom title is present', async () => {
      const unscheduledBreak: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-unscheduled-break',
        itemType: 'break',
        customTitle: 'Midday Nap',
        experienceId: 'exp-resort-poly',
        experienceName: "Disney's Polynesian Village Resort",
        park: null,
        plannedDate: '2026-10-01',
        plannedTime: null,
      };

      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [unscheduledBreak];
        }
        if (method === 'GET' && path === '/catalog') {
          return { experiences: [] };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Midday Nap')).toBeTruthy();
      });

      expect(screen.getByTestId('unscheduled-item-location-item-unscheduled-break')).toBeTruthy();
      expect(screen.getByText("📍 Disney's Polynesian Village Resort")).toBeTruthy();
    });
  });

  describe('Optimized Schedule Interaction Regressions', () => {
    it('regression: clicking an optimized experience and hitting Done preserves wait time and walk time without sending PATCH or locking to fixed time', async () => {
      const optimizedItem: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-opt-1',
        experienceName: 'Test Track',
        plannedDate: '2026-10-01',
        plannedTime: '2026-10-01T12:56:00.000Z',
        predictedWaitMinutes: 25,
        travelFromPrev: { kind: 'walk', minutes: 8 },
        optimizedAt: '2026-10-01T12:00:00.000Z',
        isFixed: false,
        isLightningLane: false,
      };

      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [optimizedItem];
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: optimizedItem.experienceId,
                name: 'Test Track',
                category: 'Ride',
                park: 'EPCOT',
                land: 'World Discovery',
              },
            ],
          };
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      // Verify wait time and walk connector are rendered
      await waitFor(() => {
        expect(screen.getByText('Test Track')).toBeTruthy();
        expect(screen.getByText('Wait: 25 min')).toBeTruthy();
        expect(screen.getByText(/\+8m/)).toBeTruthy();
      });

      // Verify no FIXED TIME badge
      expect(screen.queryByText('FIXED TIME')).toBeNull();

      // Open the edit modal for Test Track
      fireEvent.press(screen.getByText('Test Track'));

      await waitFor(() => {
        expect(screen.getByTestId('timing-mode-any_time')).toBeTruthy();
      });

      // Hit Done without making changes
      fireEvent.press(screen.getByText('Done'));

      // Ensure no PATCH request was dispatched
      expect(
        apiRequestMock.mock.calls.some(([method]) => method === 'PATCH'),
      ).toBe(false);

      // Verify wait time and walk connector remain on screen and no FIXED TIME badge was added
      await waitFor(() => {
        expect(screen.getByText('Wait: 25 min')).toBeTruthy();
        expect(screen.getByText(/\+8m/)).toBeTruthy();
        expect(screen.queryByText('FIXED TIME')).toBeNull();
      });
    });

    it('regression: changing only priority on an optimized flexible item does not convert it to fixed time', async () => {
      let patchPayload: any = null;
      const optimizedItem: PlannedItemDTO = {
        ...PLANNED_ITEM,
        id: 'item-opt-2',
        experienceName: 'Test Track',
        plannedDate: '2026-10-01',
        plannedTime: '2026-10-01T12:56:00.000Z',
        predictedWaitMinutes: 25,
        travelFromPrev: { kind: 'walk', minutes: 8 },
        optimizedAt: '2026-10-01T12:00:00.000Z',
        isFixed: false,
        isLightningLane: false,
        priority: 2,
      };

      apiRequestMock.mockImplementation(async (method, path, body) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [optimizedItem];
        }
        if (method === 'GET' && path === '/catalog') {
          return {
            experiences: [
              {
                id: optimizedItem.experienceId,
                name: 'Test Track',
                category: 'Ride',
                park: 'EPCOT',
                land: 'World Discovery',
              },
            ],
          };
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-opt-2`) {
          patchPayload = body;
          return;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByText('Test Track')).toBeTruthy();
      });

      // Open the edit modal
      fireEvent.press(screen.getByText('Test Track'));

      await waitFor(() => {
        expect(screen.getByText('Must Do (1)')).toBeTruthy();
      });

      // Change priority to 1
      fireEvent.press(screen.getByText('Must Do (1)'));

      // Hit Done
      fireEvent.press(screen.getByText('Done'));

      await waitFor(() => {
        expect(patchPayload).toBeTruthy();
        expect(patchPayload.priority).toBe(1);
        expect(patchPayload.isFixed).toBeUndefined();
        expect(patchPayload.plannedTime).toBeUndefined();
      });
    });
  });
});


// ---------------------------------------------------------------------------
// trip-reservations R4.3 / R5.2 — a Reservation is badged by its kind on the
// timeline, so a real booking is distinguishable from a self-pinned time.
// ---------------------------------------------------------------------------

describe('TripScheduleScreen — reservation badges (trip-reservations R4.3, R5.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockDayWith(items: readonly PlannedItemDTO[]): void {
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
        return items as any;
      }
      if (method === 'GET' && String(path).startsWith('/catalog')) {
        return { experiences: [] } as any;
      }
      if (method === 'GET' && String(path).startsWith('/crowd-calendar')) {
        return {} as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
  }

  it('renders a kind badge for a Reservation on the timeline', async () => {
    mockDayWith([
      {
        ...PLANNED_ITEM,
        id: 'booking',
        experienceName: 'Be Our Guest',
        plannedDate: '2026-10-01',
        plannedTime: '2026-10-01T22:00:00.000Z',
        isFixed: true,
        reservationKind: 'dining',
        confirmationNumber: 'ABC123456',
        partySize: 4,
      },
    ]);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('item-reservation-badge-booking')).toBeTruthy();
    });
    expect(screen.getByTestId('item-reservation-badge-booking').props.children).toContain(
      'Dining',
    );
  });

  it('does NOT render a kind badge for a self-pinned fixed item that is not a Reservation', async () => {
    mockDayWith([
      {
        ...PLANNED_ITEM,
        id: 'self-pinned',
        experienceName: 'Space Mountain',
        plannedDate: '2026-10-01',
        plannedTime: '2026-10-01T22:00:00.000Z',
        // Fixed, but no booking behind it.
        isFixed: true,
        reservationKind: null,
        confirmationNumber: null,
        partySize: null,
      },
    ]);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Space Mountain')).toBeTruthy();
    });
    expect(screen.queryByTestId('item-reservation-badge-self-pinned')).toBeNull();
  });

  it('shows a non-catalog Reservation as reserved rather than as a break (R5.2)', async () => {
    mockDayWith([
      {
        ...PLANNED_ITEM,
        id: 'off-prop',
        experienceId: null,
        experienceName: null,
        park: null,
        itemType: 'break',
        customTitle: 'Off-property steakhouse',
        plannedDate: '2026-10-01',
        plannedTime: '2026-10-01T22:00:00.000Z',
        isFixed: true,
        durationMinutes: 90,
        reservationKind: 'dining',
      },
    ]);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('item-reservation-badge-off-prop')).toBeTruthy();
    });
    // The duration pill reads as dining, not as a break.
    expect(screen.getByText('🍽️ 90m dining')).toBeTruthy();
    expect(screen.queryByText(/m break/u)).toBeNull();
  });

  it('sets reservationKind: dining when saving exact time on a restaurant', async () => {
    let patchPayload: any = null;
    const RESTAURANT_EXP: ExperienceDTO = {
      id: 'exp-restaurant',
      name: 'Skipper Canteen',
      park: 'Magic Kingdom',
      category: 'Restaurant',
      description: '',
      active: true,
      imageUrl: null,
      areaType: 'ThemePark',
    };

    apiRequestMock.mockImplementation(async (method, path, body) => {
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
        return [
          {
            ...PLANNED_ITEM,
            id: 'item-restaurant',
            experienceId: 'exp-restaurant',
            experienceName: 'Skipper Canteen',
            plannedDate: '2026-10-01',
            plannedTime: null,
            reservationKind: null,
          },
        ] as any;
      }
      if (method === 'GET' && String(path).startsWith('/catalog')) {
        return { experiences: [RESTAURANT_EXP] } as any;
      }
      if (method === 'GET' && String(path).startsWith('/crowd-calendar')) {
        return {} as any;
      }
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-restaurant`) {
        patchPayload = body;
        return { id: 'item-restaurant', reservationKind: 'dining' } as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Skipper Canteen')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Edit Settings'));
    await waitFor(() => {
      expect(screen.getByTestId('timing-mode-exact_time')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('timing-mode-exact_time'));
    fireEvent.press(screen.getByText('6:00 PM'));
    fireEvent.press(screen.getByText('Done'));

    await waitFor(() => {
      expect(patchPayload).toMatchObject({
        reservationKind: 'dining',
        isFixed: true,
      });
    });
  });

  it('clears reservationKind to null when switching a dining reservation to flexible timing', async () => {
    let patchPayload: any = null;
    const RESTAURANT_EXP: ExperienceDTO = {
      id: 'exp-restaurant',
      name: 'Skipper Canteen',
      park: 'Magic Kingdom',
      category: 'Restaurant',
      description: '',
      active: true,
      imageUrl: null,
      areaType: 'ThemePark',
    };

    apiRequestMock.mockImplementation(async (method, path, body) => {
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
        return [
          {
            ...PLANNED_ITEM,
            id: 'item-restaurant',
            experienceId: 'exp-restaurant',
            experienceName: 'Skipper Canteen',
            plannedDate: '2026-10-01',
            plannedTime: '2026-10-01T22:00:00.000Z',
            isFixed: true,
            reservationKind: 'dining',
          },
        ] as any;
      }
      if (method === 'GET' && String(path).startsWith('/catalog')) {
        return { experiences: [RESTAURANT_EXP] } as any;
      }
      if (method === 'GET' && String(path).startsWith('/crowd-calendar')) {
        return {} as any;
      }
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-restaurant`) {
        patchPayload = body;
        return { id: 'item-restaurant', reservationKind: null } as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Skipper Canteen')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Skipper Canteen'));
    await waitFor(() => {
      expect(screen.getByTestId('timing-mode-any_time')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('timing-mode-any_time'));
    fireEvent.press(screen.getByText('Done'));

    await waitFor(() => {
      expect(patchPayload).toMatchObject({
        reservationKind: null,
        isFixed: false,
        plannedTime: null,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// trip-reservations task 8.1 — the hour/minute/AM-PM wheel moved into the shared
// `TimeWheelPicker`. The pre-existing suite only ever pressed the preset pills,
// so the wheel itself was executed but never asserted; this drives the three
// columns directly so the extraction is genuinely guarded here too.
// ---------------------------------------------------------------------------

describe('TripScheduleScreen — shared time wheel (trip-reservations task 8.1)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('picks a time via the wheel columns and PATCHes the 24-hour conversion', async () => {
    let patchPayload: any = null;
    const llItem = {
      ...PLANNED_ITEM,
      id: 'item-wheel',
      plannedDate: '2026-10-01',
      experienceName: 'Seven Dwarfs Mine Train',
      isLightningLane: true,
    };

    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [llItem] as any;
      }
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}/planned-items/item-wheel`) {
        patchPayload = body;
        return undefined as any;
      }
      if (method === 'GET' && String(path).startsWith('/catalog')) {
        return { experiences: [] } as any;
      }
      if (method === 'GET' && String(path).startsWith('/crowd-calendar')) {
        return {} as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Seven Dwarfs Mine Train')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Edit Settings'));

    await waitFor(() => {
      expect(screen.getByTestId('schedule-time-wheel')).toBeTruthy();
    });

    // Drive all three columns: 4:45 PM park time.
    fireEvent.press(screen.getByTestId('schedule-time-hour-4'));
    fireEvent.press(screen.getByTestId('schedule-time-minute-45'));
    fireEvent.press(screen.getByTestId('schedule-time-meridiem-PM'));

    fireEvent.press(screen.getByText('Done'));

    await waitFor(() => {
      expect(patchPayload).toBeTruthy();
      // 4:45 PM Eastern on 2026-10-01 (EDT, UTC-4) is 20:45Z.
      expect(patchPayload.plannedTime).toBe('2026-10-01T20:45:00.000Z');
    });
  });

  it('keeps quarter-hour granularity in the Schedule Builder', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [
          {
            ...PLANNED_ITEM,
            id: 'item-wheel-granularity',
            plannedDate: '2026-10-01',
            experienceName: 'Seven Dwarfs Mine Train',
            isLightningLane: true,
          },
        ] as any;
      }
      if (method === 'GET' && String(path).startsWith('/catalog')) {
        return { experiences: [] } as any;
      }
      if (method === 'GET' && String(path).startsWith('/crowd-calendar')) {
        return {} as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Seven Dwarfs Mine Train')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Edit Settings'));

    await waitFor(() => {
      expect(screen.getByTestId('schedule-time-wheel')).toBeTruthy();
    });
    // A touring preference does not need 5-minute steps; reservations do.
    expect(screen.getByTestId('schedule-time-minute-30')).toBeTruthy();
    expect(screen.queryByTestId('schedule-time-minute-25')).toBeNull();
  });

  describe('Schedule Settings & Intent Presets (R9, Property 20, Task 21)', () => {
    it('allows selecting Party Mix-in intent preset and dispatches startMode & startMinutes', async () => {
      let patchPayload: any = null;
      let optimizePayload: any = null;

      apiRequestMock.mockImplementation(async (method, path, body: any) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}`) {
          patchPayload = body;
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01', dayTouringHours: body.dayTouringHours } as any;
        }
        if (method === 'POST' && path === `/trips/${TRIP_ID}/schedule/optimize`) {
          optimizePayload = body;
          return { items: [], totalWaitMinutes: 0, totalWalkMinutes: 0, unfittedItemIds: [], warnings: [] };
        }
        if (method === 'GET' && String(path).startsWith('/catalog')) {
          return { experiences: [] } as any;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByTestId('schedule-settings-btn')).toBeTruthy();
      });

      // Open Settings
      fireEvent.press(screen.getByTestId('schedule-settings-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('arrival-mode-party-mix-in')).toBeTruthy();
      });

      // Select Party Mix-in
      fireEvent.press(screen.getByTestId('arrival-mode-party-mix-in'));

      // Save settings
      fireEvent.press(screen.getByTestId('save-schedule-settings-btn'));

      await waitFor(() => {
        expect(patchPayload).toBeTruthy();
        expect(patchPayload.dayTouringHours['2026-10-01']).toMatchObject({
          startHour: 16,
          startMinutes: 960,
          startMode: 'party_mix_in',
        });
      });

      // Tap Optimize
      fireEvent.press(screen.getByText('✨ Optimize'));

      await waitFor(() => {
        expect(optimizePayload).toBeTruthy();
        expect(optimizePayload.date).toBe('2026-10-01');
        expect(optimizePayload.startHour).toBe(16);
        expect(optimizePayload.startMinutes).toBe(960);
        expect(optimizePayload.startMode).toBe('party_mix_in');
      });
    });

    it('allows selecting Custom Time with TimeWheelPicker minute precision and persists selection', async () => {
      let patchPayload: any = null;
      let optimizePayload: any = null;

      apiRequestMock.mockImplementation(async (method, path, body: any) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01' } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}`) {
          patchPayload = body;
          return { id: TRIP_ID, name: 'Disney Trip', startDate: '2026-10-01', dayTouringHours: body.dayTouringHours } as any;
        }
        if (method === 'POST' && path === `/trips/${TRIP_ID}/schedule/optimize`) {
          optimizePayload = body;
          return { items: [], totalWaitMinutes: 0, totalWalkMinutes: 0, unfittedItemIds: [], warnings: [] };
        }
        if (method === 'GET' && String(path).startsWith('/catalog')) {
          return { experiences: [] } as any;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByTestId('schedule-settings-btn')).toBeTruthy();
      });

      // Open Settings
      fireEvent.press(screen.getByTestId('schedule-settings-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('arrival-mode-custom')).toBeTruthy();
      });

      // Select Custom Time
      fireEvent.press(screen.getByTestId('arrival-mode-custom'));

      await waitFor(() => {
        expect(screen.getByTestId('custom-start-time-picker-container')).toBeTruthy();
      });

      // Select 10:45 AM via TimeWheelPicker
      fireEvent.press(screen.getByTestId('custom-start-time-hour-10'));
      fireEvent.press(screen.getByTestId('custom-start-time-minute-45'));
      fireEvent.press(screen.getByTestId('custom-start-time-meridiem-AM'));

      // Save settings
      fireEvent.press(screen.getByTestId('save-schedule-settings-btn'));

      await waitFor(() => {
        expect(patchPayload).toBeTruthy();
        expect(patchPayload.dayTouringHours['2026-10-01']).toMatchObject({
          startHour: 10,
          startMinutes: 645,
          startMode: 'custom',
        });
      });

      // Tap Optimize
      fireEvent.press(screen.getByText('✨ Optimize'));

      await waitFor(() => {
        expect(optimizePayload).toBeTruthy();
        expect(optimizePayload.date).toBe('2026-10-01');
        expect(optimizePayload.startHour).toBe(10);
        expect(optimizePayload.startMinutes).toBe(645);
        expect(optimizePayload.startMode).toBe('custom');
      });
    });

    it('displays touring start mode indicator badge on today and supports Right Now preset', async () => {
      const todayWDW = getTodayWDW();
      let patchPayload: any = null;
      let optimizePayload: any = null;

      apiRequestMock.mockImplementation(async (method, path, body: any) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: todayWDW } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}`) {
          patchPayload = body;
          return { id: TRIP_ID, name: 'Disney Trip', startDate: todayWDW, dayTouringHours: body.dayTouringHours } as any;
        }
        if (method === 'POST' && path === `/trips/${TRIP_ID}/schedule/optimize`) {
          optimizePayload = body;
          return { items: [], totalWaitMinutes: 0, totalWalkMinutes: 0, unfittedItemIds: [], warnings: [] };
        }
        if (method === 'GET' && String(path).startsWith('/catalog')) {
          return { experiences: [] } as any;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      // Verify touring start indicator badge is visible on today and pressable to open settings modal
      await waitFor(() => {
        expect(screen.getByTestId('touring-start-indicator')).toBeTruthy();
      });
      expect(screen.getByText(/Touring: (Park Open|Right Now)/)).toBeTruthy();

      // Open Settings via touring-start-indicator badge
      fireEvent.press(screen.getByTestId('touring-start-indicator'));

      await waitFor(() => {
        // Right Now option is visible because activeDate === todayWDW
        expect(screen.getByTestId('arrival-mode-now')).toBeTruthy();
      });

      // Select Right Now
      fireEvent.press(screen.getByTestId('arrival-mode-now'));

      // Save settings
      fireEvent.press(screen.getByTestId('save-schedule-settings-btn'));

      // In patch payload, ephemeral 'now' is sanitized/omitted from DB persistence
      await waitFor(() => {
        expect(patchPayload).toBeTruthy();
        expect(patchPayload.dayTouringHours[todayWDW]?.startMode).toBeUndefined();
      });

      // On the main screen, the badge reflects 'Right Now' with resolved time
      await waitFor(() => {
        expect(screen.getByText(/Touring: Right Now/)).toBeTruthy();
      });

      // Tap Optimize - dispatches startMode: 'now'
      fireEvent.press(screen.getByText('✨ Optimize'));

      await waitFor(() => {
        expect(optimizePayload).toBeTruthy();
        expect(optimizePayload.date).toBe(todayWDW);
        expect(optimizePayload.startMode).toBe('now');
      });
    });

    it('clamps Custom Time selection to >= roundedNow on today and prevents optimizing in the past (R9.8)', async () => {
      const todayWDW = getTodayWDW();
      let patchPayload: any = null;
      let optimizePayload: any = null;

      apiRequestMock.mockImplementation(async (method, path, body: any) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return { id: TRIP_ID, name: 'Disney Trip', startDate: todayWDW } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [] as any;
        }
        if (method === 'PATCH' && path === `/trips/${TRIP_ID}`) {
          patchPayload = body;
          return { id: TRIP_ID, name: 'Disney Trip', startDate: todayWDW, dayTouringHours: body.dayTouringHours } as any;
        }
        if (method === 'POST' && path === `/trips/${TRIP_ID}/schedule/optimize`) {
          optimizePayload = body;
          return { items: [], totalWaitMinutes: 0, totalWalkMinutes: 0, unfittedItemIds: [], warnings: [] };
        }
        if (method === 'GET' && String(path).startsWith('/catalog')) {
          return { experiences: [] } as any;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      });

      renderScreen();

      await waitFor(() => {
        expect(screen.getByTestId('schedule-settings-btn')).toBeTruthy();
      });

      // Open Settings
      fireEvent.press(screen.getByTestId('schedule-settings-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('arrival-mode-custom')).toBeTruthy();
      });

      // Select Custom Time
      fireEvent.press(screen.getByTestId('arrival-mode-custom'));

      await waitFor(() => {
        expect(screen.getByTestId('custom-start-time-picker-container')).toBeTruthy();
      });

      // Attempt to pick a time in the past: 1:00 AM (60 minutes from midnight)
      fireEvent.press(screen.getByTestId('custom-start-time-hour-1'));
      fireEvent.press(screen.getByTestId('custom-start-time-minute-00'));
      fireEvent.press(screen.getByTestId('custom-start-time-meridiem-AM'));

      // Save settings
      fireEvent.press(screen.getByTestId('save-schedule-settings-btn'));

      const nowMins = getWDWNowMinutes();
      const roundedNow = Math.min(Math.ceil(nowMins / 15) * 15, 1439);

      await waitFor(() => {
        expect(patchPayload).toBeTruthy();
        // startMinutes is clamped to >= roundedNow
        expect(patchPayload.dayTouringHours[todayWDW].startMinutes).toBeGreaterThanOrEqual(roundedNow);
      });

      // Tap Optimize
      fireEvent.press(screen.getByText('✨ Optimize'));

      await waitFor(() => {
        expect(optimizePayload).toBeTruthy();
        expect(optimizePayload.date).toBe(todayWDW);
        expect(optimizePayload.startMinutes).toBeGreaterThanOrEqual(roundedNow);
      });
    });
  });

  describe('TripScheduleScreen — back navigation (backToHub)', () => {
    it('replaces to TripDetail when opened directly without TripDetail in the stack', async () => {
      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            name: 'Walt Disney World Vacation',
            startDate: '2026-10-01',
            endDate: '2026-10-03',
            status: 'upcoming',
            role: 'organizer',
            resorts: [],
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [];
        }
        return null as any;
      });

      const { navigation } = renderScreen({
        getState: jest.fn(() => ({
          index: 0,
          routes: [{ name: 'TripSchedule', params: { tripId: TRIP_ID } }],
        })),
      });

      // Subtitle renders trip name once trip data resolves
      expect(await screen.findByText('Walt Disney World Vacation')).toBeTruthy();

      const backBtn = screen.getByRole('button', { name: /Back to Walt Disney World Vacation/i });
      fireEvent.press(backBtn);

      expect(navigation.replace).toHaveBeenCalledWith('TripDetail', { tripId: TRIP_ID });
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('pops via goBack when TripDetail is the immediate predecessor in the stack', async () => {
      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            name: 'Walt Disney World Vacation',
            startDate: '2026-10-01',
            endDate: '2026-10-03',
            status: 'upcoming',
            role: 'organizer',
            resorts: [],
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [];
        }
        return null as any;
      });

      const { navigation } = renderScreen({
        getState: jest.fn(() => ({
          index: 1,
          routes: [
            { name: 'TripDetail', params: { tripId: TRIP_ID } },
            { name: 'TripSchedule', params: { tripId: TRIP_ID } },
          ],
        })),
      });

      expect(await screen.findByText('Walt Disney World Vacation')).toBeTruthy();

      const backBtn = screen.getByRole('button', { name: /Back to Walt Disney World Vacation/i });
      fireEvent.press(backBtn);

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('pops via goBack when TripReservations is the immediate predecessor in the stack', async () => {
      apiRequestMock.mockImplementation(async (method, path) => {
        if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
          return {
            id: TRIP_ID,
            name: 'Walt Disney World Vacation',
            startDate: '2026-10-01',
            endDate: '2026-10-03',
            status: 'upcoming',
            role: 'organizer',
            resorts: [],
          } as any;
        }
        if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
          return [];
        }
        return null as any;
      });

      const { navigation } = renderScreen({
        getState: jest.fn(() => ({
          index: 1,
          routes: [
            { name: 'TripReservations', params: { tripId: TRIP_ID } },
            { name: 'TripSchedule', params: { tripId: TRIP_ID } },
          ],
        })),
      });

      expect(await screen.findByText('Walt Disney World Vacation')).toBeTruthy();

      const backBtn = screen.getByRole('button', { name: /Back to Walt Disney World Vacation/i });
      fireEvent.press(backBtn);

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
      expect(navigation.replace).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Property 19: Selecting a List-Sourced Candidate Is Behaviorally Identical
// to Catalog Search (Requirement 15.4, 15.6) — task 20.4
// ---------------------------------------------------------------------------
//
// Property 18's "My Lists" tab presence/absence and dedup-across-lists clause
// is already validated at the correct layer: the tab omission/inclusion
// itself in `ExperiencePicker.test.tsx` ("omits the My Lists tab entirely
// when zero lists are attached" / "renders the My Lists tab when one or more
// attached lists supply items"), and the actual union/dedup-across-attached-
// lists computation in `useAttachedExperienceListItems.test.tsx`
// ("deduplicates by experienceId when the same Experience appears on more
// than one attached list"), since `useAttachedExperienceListItems` — not
// `ExperiencePicker` — is where the merge/dedup happens (the picker only
// renders whatever `listSourcedItems` it is given). This suite does not
// re-derive that coverage; it closes the one remaining gap: Property 19,
// which requires observing the actual `POST /trips/:id/planned-items`
// request body, something only a screen-level test (not
// `ExperiencePicker.test.tsx` alone) can do.
describe('TripScheduleScreen — Property 19: list-sourced selection is behaviorally identical to catalog search (R15.4, R15.6)', () => {
  it('POSTs the identical /trips/:id/planned-items request body whether the same Experience is selected from catalog search or from the "My Lists" tab', async () => {
    const postedBodies: unknown[] = [];
    const SHARED_EXPERIENCE_ID = 'exp-shared-jungle-cruise';

    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return {
          id: TRIP_ID,
          name: 'Disney Trip',
          startDate: '2026-10-01',
          endDate: '2026-10-02',
          // One attached Experience_List — enables the "My Lists" tab.
          experienceLists: [
            {
              available: true,
              experienceListId: 'list-1',
              name: 'Must Do',
              itemCount: 1,
              ownerDisplayName: 'Ada',
            },
          ],
        } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) {
        return [];
      }
      if (method === 'GET' && path === '/experience-lists/list-1') {
        // The list-sourced view of the SAME experienceId the catalog search
        // below will also return.
        return {
          id: 'list-1',
          ownerId: 'owner-1',
          ownerDisplayName: 'Ada',
          name: 'Must Do',
          visibility: 'private',
          likeCount: 0,
          itemCount: 1,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          liked: false,
          saved: false,
          version: 1,
          myRole: 'owner',
          items: [
            {
              experienceId: SHARED_EXPERIENCE_ID,
              name: 'Jungle Cruise',
              park: 'Magic Kingdom',
              category: 'Ride',
              position: 0,
              addedByUserId: 'owner-1',
              addedByDisplayName: 'Ada',
            },
          ],
        } as any;
      }
      if (method === 'GET' && path.startsWith('/catalog')) {
        // Ordinary catalog search surfaces the exact same experienceId.
        return {
          experiences: [
            {
              id: SHARED_EXPERIENCE_ID,
              name: 'Jungle Cruise',
              park: 'Magic Kingdom',
              land: 'Adventureland',
              category: 'Ride',
              description: '',
              active: true,
              imageUrl: null,
              areaType: 'ThemePark',
            },
          ],
        } as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/planned-items`) {
        postedBodies.push(body);
        return {
          ...PLANNED_ITEM,
          id: `item-${postedBodies.length}`,
          experienceId: SHARED_EXPERIENCE_ID,
          experienceName: 'Jungle Cruise',
          plannedDate: '2026-10-01',
        } as any;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('+ Add to Thu, Oct 1')).toBeTruthy();
    });

    // --- Selection path 1: ordinary catalog search (the "All" tab) --------
    fireEvent.press(screen.getByText('+ Add to Thu, Oct 1'));

    await waitFor(() => {
      expect(screen.getByTestId('schedule-picker-search')).toBeTruthy();
    });
    fireEvent.changeText(screen.getByTestId('schedule-picker-search'), 'Jungle');

    const catalogRow = await screen.findByTestId(
      `schedule-picker-result-${SHARED_EXPERIENCE_ID}`,
    );
    fireEvent.press(catalogRow);

    await waitFor(() => {
      expect(postedBodies.length).toBe(1);
    });

    fireEvent.press(screen.getByTestId('schedule-add-done-btn'));

    // --- Selection path 2: the "My Lists" tab ------------------------------
    fireEvent.press(screen.getByText('+ Add to Thu, Oct 1'));

    await waitFor(() => {
      expect(screen.getByTestId('schedule-picker-tab-myLists')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('schedule-picker-tab-myLists'));

    const listSourcedRow = await screen.findByTestId(
      `schedule-picker-result-${SHARED_EXPERIENCE_ID}`,
    );
    fireEvent.press(listSourcedRow);

    await waitFor(() => {
      expect(postedBodies.length).toBe(2);
    });

    // Property 19: the two request bodies — one from catalog search, one
    // from the list-sourced candidate view — are identical in every field.
    // No extra "source"/"listId"/provenance field is present on either.
    expect(postedBodies[0]).toEqual(postedBodies[1]);
    expect(postedBodies[0]).toEqual({
      experienceId: SHARED_EXPERIENCE_ID,
      plannedDate: '2026-10-01',
    });
    expect(Object.keys(postedBodies[0] as object).sort()).toEqual(
      ['experienceId', 'plannedDate'].sort(),
    );
  });
});
