/**
 * TripReservationsScreen component tests (trip-reservations task 6.6).
 *
 * Renders the real screen and mocks only the network layer (`apiRequest`).
 * Every interaction the screen adds is driven with `fireEvent`/`waitFor` and
 * asserted on BOTH sides: the request it issues (path + exact payload) and the
 * resulting on-screen change.
 *
 * Validates: Requirements 2.1–2.7, 3.1–3.6, 5.1, 5.2
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';

jest.setTimeout(15000);

import type { PlannedItemDTO } from '@dwt/shared';

import TripReservationsScreen from '../TripReservationsScreen';
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

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const TRIP_ID = 'trip-123';

function item(overrides: Partial<PlannedItemDTO> = {}): PlannedItemDTO {
  return {
    id: 'item-1',
    experienceId: 'exp-1',
    experienceName: 'Be Our Guest',
    park: 'Magic Kingdom',
    customTitle: null,
    addedByDisplayName: 'Ada',
    plannedDate: '2026-10-01',
    // 22:00Z on Oct 1 is 6:00 PM EDT — the assertions below are therefore
    // independent of the machine's local zone.
    plannedTime: '2026-10-01T22:00:00.000Z',
    isFixed: true,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    durationMinutes: 60,
    windowStartMinutes: null,
    windowEndMinutes: null,
    mealPeriod: null,
    scheduledShowtime: null,
    predictedWaitMinutes: null,
    travelFromPrev: null,
    optimizedAt: null,
    reservationKind: 'dining',
    confirmationNumber: 'ABC123456',
    partySize: 4,
    ...overrides,
  };
}

const TRIP = {
  id: TRIP_ID,
  name: 'Disney Trip',
  startDate: '2026-10-01',
  endDate: '2026-10-03',
  status: 'upcoming',
  role: 'organizer',
};

interface MockOptions {
  readonly items?: readonly PlannedItemDTO[];
}

function mockApi({ items = [item()] }: MockOptions = {}): void {
  apiRequestMock.mockImplementation(async (method, path) => {
    if (method === 'GET' && path === `/trips/${TRIP_ID}`) return TRIP as any;
    if (method === 'GET' && path === `/trips/${TRIP_ID}/planned-items`) return items as any;
    if (method === 'POST' && path === `/trips/${TRIP_ID}/planned-items`) return item() as any;
    if (method === 'PATCH' && path.startsWith(`/trips/${TRIP_ID}/planned-items/`)) {
      return item() as any;
    }
    if (method === 'DELETE' && path.startsWith(`/trips/${TRIP_ID}/planned-items/`)) {
      return undefined as any;
    }
    // The catalog search inside ExperiencePicker. The picker asks for the
    // categories its active tab allows, which is what the kind drives.
    if (method === 'GET' && path.startsWith('/catalog')) {
      if (path.includes('categories=Restaurant')) {
        return { experiences: [CATALOG_RESTAURANT] } as any;
      }
      if (path.includes('categories=Ride')) {
        return { experiences: [CATALOG_RIDE] } as any;
      }
      return { experiences: [] } as any;
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
}

const CATALOG_RESTAURANT = {
  id: 'exp-restaurant',
  name: 'Le Cellier Steakhouse',
  park: 'EPCOT',
  category: 'Restaurant',
  areaType: 'ThemePark',
} as any;

const CATALOG_RIDE = {
  id: 'exp-ride',
  name: 'Test Track',
  park: 'EPCOT',
  category: 'Ride',
  areaType: 'ThemePark',
} as any;

/** Every catalog path the picker requested during the test. */
function catalogRequests(): readonly string[] {
  return apiRequestMock.mock.calls
    .filter(([m, p]) => m === 'GET' && String(p).startsWith('/catalog'))
    .map(([, p]) => String(p));
}

const navigation = { navigate: jest.fn(), goBack: jest.fn() } as any;

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const route = {
    key: 'TripReservations',
    name: 'TripReservations' as const,
    params: { tripId: TRIP_ID },
  } as any;

  return render(
    <QueryClientProvider client={queryClient}>
      <TripReservationsScreen navigation={navigation} route={route} />
    </QueryClientProvider>,
  );
}

/**
 * Drive the Time_Picker wheel: press the hour, minute, and meridiem cells. The
 * time is chosen, never typed (R3.8), so tests must exercise the same three
 * presses a user makes.
 */
function pickTime(prefix: string, hour: string, minute: string, meridiem: 'AM' | 'PM'): void {
  fireEvent.press(screen.getByTestId(`${prefix}-hour-${hour}`));
  fireEvent.press(screen.getByTestId(`${prefix}-minute-${minute}`));
  fireEvent.press(screen.getByTestId(`${prefix}-meridiem-${meridiem}`));
}

/** The body of the first request matching a method + path prefix. */
function bodyOf(method: string, pathPrefix: string): Record<string, unknown> {
  const call = apiRequestMock.mock.calls.find(
    ([m, p]) => m === method && String(p).startsWith(pathPrefix),
  );
  if (!call) throw new Error(`No ${method} ${pathPrefix} request was made`);
  return call[2] as Record<string, unknown>;
}

describe('TripReservationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Render + grouping (R2.1, R2.2, R2.3)
  // -------------------------------------------------------------------------

  it('renders each reservation with its park-local time, title, kind, party size, and confirmation', async () => {
    mockApi();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-row-item-1')).toBeTruthy();
    });

    // 22:00Z on 2026-10-01 is 6:00 PM Eastern.
    expect(screen.getByTestId('reservation-time-item-1').props.children).toBe('6:00 PM');
    expect(screen.getByText('Be Our Guest')).toBeTruthy();
    // Kind is conveyed as words, not only an icon/color (R2.3).
    expect(screen.getByTestId('reservation-kind-label-item-1').props.children).toBe('Dining');
    expect(screen.getByTestId('reservation-party-item-1')).toBeTruthy();
    expect(screen.getByText('Confirmation ABC123456')).toBeTruthy();
    expect(screen.getByText('Added by Ada')).toBeTruthy();
  });

  it('groups reservations under a heading per date, in date order', async () => {
    mockApi({
      items: [
        item({
          id: 'later',
          plannedDate: '2026-10-03',
          plannedTime: '2026-10-03T22:00:00.000Z',
          experienceName: 'Ohana',
        }),
        item({ id: 'earlier' }),
      ],
    });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-row-earlier')).toBeTruthy();
    });
    expect(screen.getByText('Thu, Oct 1')).toBeTruthy();
    expect(screen.getByText('Sat, Oct 3')).toBeTruthy();
  });

  it('excludes a self-pinned planned item that is not a reservation (R1.3)', async () => {
    mockApi({
      items: [
        item({ id: 'booking' }),
        item({
          id: 'self-pinned',
          reservationKind: null,
          confirmationNumber: null,
          partySize: null,
          experienceName: 'Space Mountain',
        }),
      ],
    });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-row-booking')).toBeTruthy();
    });
    expect(screen.queryByTestId('reservation-row-self-pinned')).toBeNull();
    expect(screen.queryByText('Space Mountain')).toBeNull();
  });

  it('shows the empty state when the trip holds no reservations (R2.4)', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-empty')).toBeTruthy();
    });
    expect(screen.getByText('No reservations yet')).toBeTruthy();
  });

  it('labels a non-catalog reservation by its title and kind, never as a break (R5.2)', async () => {
    mockApi({
      items: [
        item({
          id: 'off-prop',
          experienceId: null,
          experienceName: null,
          park: null,
          itemType: 'break',
          customTitle: 'Off-property steakhouse',
        }),
      ],
    });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Off-property steakhouse')).toBeTruthy();
    });
    expect(screen.getByTestId('reservation-kind-label-off-prop').props.children).toBe('Dining');
    expect(screen.queryByText(/break/iu)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Row press opens the Edit / Details modal (R2.5)
  // -------------------------------------------------------------------------

  it('opens the edit modal when a reservation row is tapped (R2.5)', async () => {
    mockApi();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-row-item-1')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-row-item-1'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-save-button')).toBeTruthy();
    });
    expect(screen.getByTestId('reservation-edit-time-readout').props.children).toBe('6:00 PM');
  });

  it('navigates to ExperienceDetail when View Experience Details is pressed in edit modal', async () => {
    mockApi();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-row-item-1')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-row-item-1'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-view-experience-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-view-experience-button'));

    expect(navigation.navigate).toHaveBeenCalledWith('ExperienceDetail', {
      experienceId: 'exp-1',
    });
  });

  it('navigates to TripSchedule when View on Schedule is pressed in edit modal', async () => {
    mockApi();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-row-item-1')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-row-item-1'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-view-schedule-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-view-schedule-button'));

    expect(navigation.navigate).toHaveBeenCalledWith('TripSchedule', { tripId: TRIP_ID });
  });

  // -------------------------------------------------------------------------
  // Add flow (R3.1, R3.2, R3.3, R5.1)
  // -------------------------------------------------------------------------

  it('opens the add modal and POSTs a dining reservation with the exact payload', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-time-wheel')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('reservation-date-2026-10-02'));
    pickTime('reservation-time', '6', '30', 'PM');
    fireEvent.changeText(screen.getByTestId('reservation-party-size-input'), '5');
    fireEvent.changeText(screen.getByTestId('reservation-confirmation-input'), 'CONF-77');
    fireEvent.changeText(
      screen.getByTestId('reservation-custom-title-input'),
      'Off-property steakhouse',
    );
    fireEvent.press(screen.getByTestId('reservation-save-button'));

    await waitFor(() => {
      expect(
        apiRequestMock.mock.calls.some(
          ([m, p]) => m === 'POST' && p === `/trips/${TRIP_ID}/planned-items`,
        ),
      ).toBe(true);
    });

    const body = bodyOf('POST', `/trips/${TRIP_ID}/planned-items`);
    expect(body).toMatchObject({
      reservationKind: 'dining',
      plannedDate: '2026-10-02',
      // 18:30 Eastern on 2026-10-02 (EDT, UTC-4) is 22:30Z.
      plannedTime: '2026-10-02T22:30:00.000Z',
      partySize: 5,
      confirmationNumber: 'CONF-77',
      // No catalog venue chosen → an unlocated titled break (R5.1).
      experienceId: null,
      itemType: 'break',
      customTitle: 'Off-property steakhouse',
    });
  });

  it('sends the chosen kind when a different kind chip is selected', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-kind-lightning_lane')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-kind-lightning_lane'));
    fireEvent.press(screen.getByTestId('reservation-date-2026-10-01'));
    pickTime('reservation-time', '9', '15', 'AM');
    fireEvent.changeText(screen.getByTestId('reservation-custom-title-input'), 'Tron');
    fireEvent.press(screen.getByTestId('reservation-save-button'));

    await waitFor(() => {
      expect(
        apiRequestMock.mock.calls.some(
          ([m, p]) => m === 'POST' && p === `/trips/${TRIP_ID}/planned-items`,
        ),
      ).toBe(true);
    });

    const body = bodyOf('POST', `/trips/${TRIP_ID}/planned-items`);
    expect(body.reservationKind).toBe('lightning_lane');
    // 09:15 Eastern on 2026-10-01 (EDT) is 13:15Z.
    expect(body.plannedTime).toBe('2026-10-01T13:15:00.000Z');
  });

  it('blocks a save when no time has been picked and issues no request (R3.11)', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-time-wheel')).toBeTruthy();
    });
    // A booking time is never defaulted into the payload — the picker starts
    // with no selection and the form must say so.
    expect(screen.getByTestId('reservation-time-readout').props.children).toBe(
      'No time selected',
    );
    fireEvent.press(screen.getByTestId('reservation-date-2026-10-01'));
    fireEvent.changeText(screen.getByTestId('reservation-custom-title-input'), 'Somewhere');
    fireEvent.press(screen.getByTestId('reservation-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-form-error').props.children).toBe(
        'Pick a time for this reservation.',
      );
    });
    expect(
      apiRequestMock.mock.calls.some(
        ([m, p]) => m === 'POST' && p === `/trips/${TRIP_ID}/planned-items`,
      ),
    ).toBe(false);
  });

  it('saves 1:00 PM as 13:00 park time — the twelve-hour defect the picker removes', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-time-wheel')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-date-2026-10-01'));
    pickTime('reservation-time', '1', '00', 'PM');

    // The selection reads back as an afternoon time on screen before saving —
    // asserted here because the modal closes once the POST succeeds.
    expect(screen.getByTestId('reservation-time-readout').props.children).toBe('1:00 PM');

    fireEvent.changeText(screen.getByTestId('reservation-custom-title-input'), 'Via Napoli');
    fireEvent.press(screen.getByTestId('reservation-save-button'));

    await waitFor(() => {
      expect(
        apiRequestMock.mock.calls.some(
          ([m, p]) => m === 'POST' && p === `/trips/${TRIP_ID}/planned-items`,
        ),
      ).toBe(true);
    });

    // 1:00 PM Eastern on 2026-10-01 (EDT, UTC-4) is 17:00Z. Under the old
    // free-text field the same intent produced 05:00Z — 1:00 AM.
    expect(bodyOf('POST', `/trips/${TRIP_ID}/planned-items`).plannedTime).toBe(
      '2026-10-01T17:00:00.000Z',
    );
  });

  it('blocks a save with an out-of-range party size and issues no request (R3.6)', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-time-wheel')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-date-2026-10-01'));
    pickTime('reservation-time', '6', '30', 'PM');
    fireEvent.changeText(screen.getByTestId('reservation-custom-title-input'), 'Somewhere');
    fireEvent.changeText(screen.getByTestId('reservation-party-size-input'), '99');
    fireEvent.press(screen.getByTestId('reservation-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-form-error')).toBeTruthy();
    });
    expect(
      apiRequestMock.mock.calls.some(
        ([m, p]) => m === 'POST' && p === `/trips/${TRIP_ID}/planned-items`,
      ),
    ).toBe(false);
  });

  it('blocks a save with no venue named and issues no request (R5.4)', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-time-wheel')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-date-2026-10-01'));
    pickTime('reservation-time', '6', '30', 'PM');
    fireEvent.press(screen.getByTestId('reservation-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-form-error')).toBeTruthy();
    });
    expect(
      apiRequestMock.mock.calls.some(
        ([m, p]) => m === 'POST' && p === `/trips/${TRIP_ID}/planned-items`,
      ),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Kind-scoped venue picker (R3.2, R3.3)
  // -------------------------------------------------------------------------

  it('scopes the venue picker to restaurants for a dining reservation (R3.2)', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    // `dining` is the default kind, so the picker asks the Catalog for
    // restaurants only — never an unscoped search.
    await waitFor(() => {
      expect(catalogRequests().some((p) => p.includes('categories=Restaurant'))).toBe(true);
    });
    expect(catalogRequests().some((p) => p.includes('categories=Ride'))).toBe(false);

    await waitFor(() => {
      expect(screen.getByTestId('reservation-picker-result-exp-restaurant')).toBeTruthy();
    });
  });

  it('scopes the venue picker to rides for a Lightning Lane reservation (R3.3)', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-kind-lightning_lane')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-kind-lightning_lane'));

    await waitFor(() => {
      expect(catalogRequests().some((p) => p.includes('categories=Ride'))).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId('reservation-picker-result-exp-ride')).toBeTruthy();
    });
    expect(screen.queryByTestId('reservation-picker-result-exp-restaurant')).toBeNull();
  });

  it('POSTs the selected catalog venue as an experienceId, not a custom title', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-picker-result-exp-restaurant')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-picker-result-exp-restaurant'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-selected-venue')).toBeTruthy();
    });
    expect(screen.getByTestId('reservation-selected-venue').props.children).toBe(
      'Le Cellier Steakhouse',
    );

    fireEvent.press(screen.getByTestId('reservation-date-2026-10-01'));
    pickTime('reservation-time', '6', '30', 'PM');
    fireEvent.press(screen.getByTestId('reservation-save-button'));

    await waitFor(() => {
      expect(
        apiRequestMock.mock.calls.some(
          ([m, p]) => m === 'POST' && p === `/trips/${TRIP_ID}/planned-items`,
        ),
      ).toBe(true);
    });

    const body = bodyOf('POST', `/trips/${TRIP_ID}/planned-items`);
    expect(body.experienceId).toBe('exp-restaurant');
    expect(body.customTitle).toBeUndefined();
    expect(body.itemType).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Destination filter (R3.13, R3.14, R3.15)
  // -------------------------------------------------------------------------

  it('renders Destination chips including Resorts, with none selected initially', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-picker-park-filters')).toBeTruthy();
    });

    for (const destination of [
      'Magic Kingdom',
      'EPCOT',
      'Hollywood Studios',
      'Animal Kingdom',
      'Typhoon Lagoon',
      'Blizzard Beach',
      'Disney Springs',
      // Much of the best table service is at a resort, so this chip matters.
      'Resorts',
    ]) {
      expect(screen.getByTestId(`reservation-picker-park-chip-${destination}`)).toBeTruthy();
    }

    // Nothing is narrowed until the member chooses to narrow (R3.14).
    expect(
      screen.getByTestId('reservation-picker-park-chip-all').props.accessibilityState.selected,
    ).toBe(true);
    expect(
      screen.getByTestId('reservation-picker-park-chip-EPCOT').props.accessibilityState.selected,
    ).toBe(false);
  });

  it('composes the Destination filter WITH the kind category rather than replacing it (R3.15)', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-picker-park-chip-EPCOT')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-picker-park-chip-EPCOT'));

    await waitFor(() => {
      expect(catalogRequests().some((p) => p.includes('parkId=EPCOT'))).toBe(true);
    });

    // The dining category restriction survives the destination narrowing: the
    // same request carries both, so the two filters compose.
    const composed = catalogRequests().find((p) => p.includes('parkId=EPCOT'));
    expect(composed).toContain('categories=Restaurant');
  });

  it('scopes to resort venues by areaType when the Resorts chip is pressed', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-picker-park-chip-Resorts')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-picker-park-chip-Resorts'));

    await waitFor(() => {
      expect(catalogRequests().some((p) => p.includes('areaType=Resort'))).toBe(true);
    });
    const composed = catalogRequests().find((p) => p.includes('areaType=Resort'));
    expect(composed).toContain('categories=Restaurant');
  });

  it('keeps the Destination chips available for an activity reservation, which has no category scope', async () => {
    mockApi({ items: [] });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservations-add-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservations-add-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-kind-activity')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-kind-activity'));

    // An `activity` booking is unscoped by category, so without a Destination or
    // a typed query the picker would show nothing — the chips are what make it
    // browsable.
    await waitFor(() => {
      expect(screen.getByTestId('reservation-picker-park-chip-Magic Kingdom')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-picker-park-chip-Magic Kingdom'));

    await waitFor(() => {
      expect(catalogRequests().some((p) => p.includes('parkId=Magic+Kingdom'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Edit flow (R3.4)
  // -------------------------------------------------------------------------

  it('opens the edit modal seeded with the current booking and PATCHes only what changed', async () => {
    mockApi();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-item-1')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-edit-item-1'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-time-wheel')).toBeTruthy();
    });
    // Preselected from the stored Booked_Time in park-local 12-hour form (R3.10):
    // 22:00Z is 6:00 PM Eastern, and the wheel shows that selection.
    expect(screen.getByTestId('reservation-edit-time-readout').props.children).toBe('6:00 PM');
    expect(
      screen.getByTestId('reservation-edit-time-hour-6').props.accessibilityState.selected,
    ).toBe(true);
    expect(
      screen.getByTestId('reservation-edit-time-meridiem-PM').props.accessibilityState.selected,
    ).toBe(true);
    expect(screen.getByTestId('reservation-edit-party-size-input').props.value).toBe('4');
    expect(screen.getByTestId('reservation-edit-confirmation-input').props.value).toBe(
      'ABC123456',
    );

    fireEvent.changeText(screen.getByTestId('reservation-edit-party-size-input'), '6');
    fireEvent.press(screen.getByTestId('reservation-edit-save-button'));

    await waitFor(() => {
      expect(
        apiRequestMock.mock.calls.some(
          ([m, p]) => m === 'PATCH' && p === `/trips/${TRIP_ID}/planned-items/item-1`,
        ),
      ).toBe(true);
    });

    const body = bodyOf('PATCH', `/trips/${TRIP_ID}/planned-items/item-1`);
    // Only the changed field travels; the unchanged Booked_Time is not resent.
    expect(body).toEqual({ partySize: 6 });
  });

  it('PATCHes a changed time as a UTC instant derived from park-local wall clock', async () => {
    mockApi();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-item-1')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-edit-item-1'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-time-wheel')).toBeTruthy();
    });
    pickTime('reservation-edit-time', '7', '45', 'PM');
    fireEvent.press(screen.getByTestId('reservation-edit-save-button'));

    await waitFor(() => {
      expect(
        apiRequestMock.mock.calls.some(
          ([m, p]) => m === 'PATCH' && p === `/trips/${TRIP_ID}/planned-items/item-1`,
        ),
      ).toBe(true);
    });

    const body = bodyOf('PATCH', `/trips/${TRIP_ID}/planned-items/item-1`);
    // 19:45 Eastern on 2026-10-01 (EDT, UTC-4) is 23:45Z.
    expect(body).toEqual({ plannedTime: '2026-10-01T23:45:00.000Z' });
  });

  it('clears a confirmation number by sending an explicit null', async () => {
    mockApi();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-item-1')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-edit-item-1'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-confirmation-input')).toBeTruthy();
    });
    fireEvent.changeText(screen.getByTestId('reservation-edit-confirmation-input'), '');
    fireEvent.press(screen.getByTestId('reservation-edit-save-button'));

    await waitFor(() => {
      expect(
        apiRequestMock.mock.calls.some(
          ([m, p]) => m === 'PATCH' && p === `/trips/${TRIP_ID}/planned-items/item-1`,
        ),
      ).toBe(true);
    });
    expect(bodyOf('PATCH', `/trips/${TRIP_ID}/planned-items/item-1`)).toEqual({
      confirmationNumber: null,
    });
  });

  it('blocks an edit with an out-of-range party size and issues no PATCH', async () => {
    mockApi();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-item-1')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-edit-item-1'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-party-size-input')).toBeTruthy();
    });
    fireEvent.changeText(screen.getByTestId('reservation-edit-party-size-input'), '0');
    fireEvent.press(screen.getByTestId('reservation-edit-save-button'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-error')).toBeTruthy();
    });
    expect(
      apiRequestMock.mock.calls.some(
        ([m, p]) => m === 'PATCH' && String(p).startsWith(`/trips/${TRIP_ID}/planned-items/`),
      ),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Remove flow (R3.5)
  // -------------------------------------------------------------------------

  it('DELETEs the reservation and closes the modal', async () => {
    mockApi();
    const { queryByTestId } = renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('reservation-edit-item-1')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-edit-item-1'));

    await waitFor(() => {
      expect(screen.getByTestId('reservation-remove-button')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('reservation-remove-button'));

    await waitFor(() => {
      expect(
        apiRequestMock.mock.calls.some(
          ([m, p]) => m === 'DELETE' && p === `/trips/${TRIP_ID}/planned-items/item-1`,
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(queryByTestId('reservation-remove-button')).toBeNull();
    });
  });
});
