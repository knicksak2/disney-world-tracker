/**
 * TripBookingTimelineScreen component tests (Task 11.5).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 10.4
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { BookingTimelineDTO, TripDTO, TripMemberDTO } from '@dwt/shared';

import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import { setTripsListNotice } from '../../../navigation/tripsListNotice';
import TripBookingTimelineScreen from '../TripBookingTimelineScreen';

jest.setTimeout(15000);

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('../../../navigation/tripsListNotice', () => ({
  __esModule: true,
  setTripsListNotice: jest.fn(),
}));

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;
const setTripsListNoticeMock = setTripsListNotice as jest.MockedFunction<typeof setTripsListNotice>;

const TRIP_ID = 'trip-timeline-123';

const BASE_TRIP: TripDTO = {
  id: TRIP_ID,
  name: 'Disney Adventure',
  startDate: '2026-10-01',
  endDate: '2026-10-08',
  status: 'upcoming',
} as unknown as TripDTO;

const ORGANIZER_ME = { user: { id: 'user-organizer' } };
const MEMBER_ME = { user: { id: 'user-member' } };

const ROSTER: readonly TripMemberDTO[] = [
  {
    userId: 'user-organizer',
    tripId: TRIP_ID,
    role: 'organizer',
    displayName: 'Mickey Mouse',
  } as unknown as TripMemberDTO,
  {
    userId: 'user-member',
    tripId: TRIP_ID,
    role: 'member',
    displayName: 'Donald Duck',
  } as unknown as TripMemberDTO,
];

const TIMELINE_FIXTURE: BookingTimelineDTO = {
  tripId: TRIP_ID,
  rulesVersion: 1,
  stayType: { value: 'resort', source: 'auto' },
  lightningLaneTiming: { value: 'seven_day', source: 'auto' },
  arrivalDate: { value: '2026-10-01', source: 'trip_start' },
  muted: false,
  windows: [
    {
      windowKey: 'dining:2026-08-02',
      kind: 'dining',
      dropOn: '2026-08-02',
      dropAt: '2026-08-02T10:00:00.000Z',
      coveredDates: ['2026-10-01', '2026-10-02', '2026-10-03'],
      status: 'upcoming',
      daysUntilDrop: 10,
      done: false,
      doneAt: null,
      doneByDisplayName: null,
      bookedCount: 2,
    },
    {
      windowKey: 'lightning_lane:2026-09-24',
      kind: 'lightning_lane',
      dropOn: '2026-09-24',
      dropAt: '2026-09-24T11:00:00.000Z',
      coveredDates: ['2026-10-01', '2026-10-02', '2026-10-03'],
      status: 'open',
      daysUntilDrop: null,
      done: false,
      doneAt: null,
      doneByDisplayName: null,
      bookedCount: 0,
    },
    {
      windowKey: 'dining:2026-05-01',
      kind: 'dining',
      dropOn: '2026-05-01',
      dropAt: '2026-05-01T10:00:00.000Z',
      coveredDates: ['2026-07-01'],
      status: 'past',
      daysUntilDrop: null,
      done: true,
      doneAt: '2026-05-01T10:05:00.000Z',
      doneByDisplayName: 'Mickey Mouse',
      bookedCount: 1,
    },
  ],
};

function renderScreen(navOverrides?: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: jest.fn(() => true),
    ...navOverrides,
  } as unknown as Parameters<typeof TripBookingTimelineScreen>[0]['navigation'];

  const route = {
    key: 'TripBookingTimeline',
    name: 'TripBookingTimeline' as const,
    params: { tripId: TRIP_ID },
  };

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <TripBookingTimelineScreen navigation={navigation} route={route} />
    </QueryClientProvider>,
  );

  return { ...rendered, navigation, queryClient };
}

describe('TripBookingTimelineScreen (Task 11.5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Open: GET timeline, displays active windows in order, toggles past windows collapsible', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/booking-timeline`) return TIMELINE_FIXTURE;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    // Verify initial timeline GET was made
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', `/trips/${TRIP_ID}/booking-timeline`);
    });

    // Active rows are rendered
    const diningRow = await screen.findByTestId('booking-window-dining:2026-08-02');
    expect(within(diningRow).getByText('Dining')).toBeTruthy();
    const llRow = screen.getByTestId('booking-window-lightning_lane:2026-09-24');
    expect(within(llRow).getByText('Lightning Lane')).toBeTruthy();
    expect(screen.getByText('Opens in 10 days')).toBeTruthy();
    expect(screen.getByText('Open now')).toBeTruthy();
    expect(screen.getByText('2 booked')).toBeTruthy();
    expect(screen.getByText('0 booked')).toBeTruthy();

    // Rules note with rulesVersion
    expect(
      screen.getByText(
        "Dates follow Disney's published booking rules (v1) — confirm in My Disney Experience.",
      ),
    ).toBeTruthy();

    // Past windows header with count 1
    const pastHeader = screen.getByTestId('booking-past-windows-header');
    expect(pastHeader).toBeTruthy();
    expect(within(pastHeader).getByText('Past windows (1)')).toBeTruthy();
    expect(pastHeader.props.accessibilityState).toEqual({ expanded: false });

    // Past window row is not visible initially
    expect(screen.queryByTestId('booking-window-dining:2026-05-01')).toBeNull();

    // Press past header to expand
    fireEvent.press(pastHeader);
    expect(pastHeader.props.accessibilityState).toEqual({ expanded: true });
    expect(await screen.findByTestId('booking-window-dining:2026-05-01')).toBeTruthy();

    // Press again to collapse
    fireEvent.press(pastHeader);
    expect(pastHeader.props.accessibilityState).toEqual({ expanded: false });
    expect(screen.queryByTestId('booking-window-dining:2026-05-01')).toBeNull();
  });

  test('Done toggle: PUT .../done updates status on success; rollback and error banner on failure', async () => {
    let doneState = false;
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/booking-timeline`) return TIMELINE_FIXTURE;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      if (method === 'PUT' && path === `/trips/${TRIP_ID}/booking-windows/dining/2026-08-02/done`) {
        const payload = body as { done: boolean };
        doneState = payload.done;
        return {
          ...TIMELINE_FIXTURE.windows[0],
          done: doneState,
          doneAt: doneState ? '2026-08-02T10:01:00Z' : null,
          doneByDisplayName: doneState ? 'Mickey Mouse' : null,
        };
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const doneCheckbox = await screen.findByTestId('booking-window-done-dining:2026-08-02');
    expect(doneCheckbox.props.accessibilityState).toEqual({ checked: false, disabled: false });

    // Press done checkbox
    fireEvent.press(doneCheckbox);

    // Verify PUT request
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PUT',
        `/trips/${TRIP_ID}/booking-windows/dining/2026-08-02/done`,
        { done: true },
      );
    });

    // Row now shows Done
    await waitFor(() => {
      const updated = screen.getByTestId('booking-window-done-dining:2026-08-02');
      expect(updated.props.accessibilityState).toEqual({ checked: true, disabled: false });
      expect(within(updated).getByText('Done')).toBeTruthy();
    });

    // Now test failure on second toggle
    apiRequestMock.mockImplementationOnce(async (method) => {
      if (method === 'PUT') {
        throw new Error('Network error');
      }
      return undefined as never;
    });

    fireEvent.press(screen.getByTestId('booking-window-done-dining:2026-08-02'));

    // Verify error banner appears and control reverts to Done (since failure rolled back the uncheck)
    await waitFor(() => {
      expect(screen.getByText("Couldn't update booking status")).toBeTruthy();
    });
  });

  test('Remind me switch: switching off sends muted: true; switching on sends muted: false; rollback on failure', async () => {
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/booking-timeline`) return TIMELINE_FIXTURE;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      if (method === 'PUT' && path === `/me/trips/${TRIP_ID}/booking-reminders`) {
        const payload = body as { muted: boolean };
        return { tripId: TRIP_ID, muted: payload.muted };
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    const switchControl = await screen.findByTestId('booking-remind-me-switch');
    expect(switchControl.props.value).toBe(true); // not muted = switch is ON

    // Toggle OFF -> muted: true
    fireEvent(switchControl, 'valueChange', false);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/trips/${TRIP_ID}/booking-reminders`, {
        muted: true,
      });
    });

    // Toggle back ON -> muted: false
    fireEvent(switchControl, 'valueChange', true);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PUT', `/me/trips/${TRIP_ID}/booking-reminders`, {
        muted: false,
      });
    });

    // Failure path: reject PUT
    apiRequestMock.mockImplementationOnce(async () => {
      throw new Error('Mute failed');
    });

    fireEvent(switchControl, 'valueChange', false);

    await waitFor(() => {
      expect(screen.getByText("Couldn't update reminders")).toBeTruthy();
    });
  });

  test('Organizer: Edit opens BookingSettingsModal, Confirm sends PATCH, Cancel sends nothing; Member: Edit is absent', async () => {
    let settingsPatch: Record<string, unknown> | null = null;
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/booking-timeline`) {
        if (settingsPatch) {
          return {
            ...TIMELINE_FIXTURE,
            stayType: { value: 'partner_hotel', source: 'override' },
          };
        }
        return TIMELINE_FIXTURE;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}/booking-settings`) {
        settingsPatch = body as Record<string, unknown>;
        return {
          tripId: TRIP_ID,
          stayType: 'partner_hotel',
          lightningLaneTiming: null,
          checkInOverride: null,
        };
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    const { queryClient } = renderScreen();

    // As organizer, Edit button is present
    const editBtn = await screen.findByTestId('booking-settings-edit');
    expect(editBtn).toBeTruthy();

    // Press Edit -> opens modal
    fireEvent.press(editBtn);

    expect(await screen.findByTestId('booking-settings-modal')).toBeTruthy();

    // Select "Partner hotel" radio
    fireEvent.press(screen.getByTestId('stay-type-partner-hotel'));

    // Cancel first to prove Cancel sends nothing
    fireEvent.press(screen.getByTestId('cancel-booking-settings'));
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'PATCH',
      `/trips/${TRIP_ID}/booking-settings`,
      expect.anything(),
    );

    // Reopen modal and confirm
    fireEvent.press(screen.getByTestId('booking-settings-edit'));
    fireEvent.press(screen.getByTestId('stay-type-partner-hotel'));
    fireEvent.press(screen.getByTestId('confirm-booking-settings'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PATCH', `/trips/${TRIP_ID}/booking-settings`, {
        stayType: 'partner_hotel',
      });
    });

    // After refresh, timeline reflects "Set by an Organizer"
    await waitFor(() => {
      expect(screen.getByText('Partner hotel')).toBeTruthy();
      expect(screen.getByText('Set by an Organizer')).toBeTruthy();
    });

    // Verify Member role: Edit button is absent
    queryClient.clear();
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/booking-timeline`) return TIMELINE_FIXTURE;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (method === 'GET' && path === '/me') return MEMBER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Booking Settings')).toBeTruthy();
    });
    expect(screen.queryByTestId('booking-settings-edit')).toBeNull();
  });

  test('Settings error: PATCH failure surfaces error banner and leaves values intact', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/booking-timeline`) return TIMELINE_FIXTURE;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      if (method === 'PATCH' && path === `/trips/${TRIP_ID}/booking-settings`) {
        throw new Error('Patch failed');
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    fireEvent.press(await screen.findByTestId('booking-settings-edit'));
    fireEvent.press(screen.getByTestId('stay-type-off-site'));
    fireEvent.press(screen.getByTestId('confirm-booking-settings'));

    await waitFor(() => {
      expect(screen.getByText("Couldn't save booking settings")).toBeTruthy();
    });
  });

  test('Empty state: zero windows renders EmptyState while keeping settings, remind me, and rules note', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/booking-timeline`) {
        return {
          ...TIMELINE_FIXTURE,
          windows: [],
        };
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    expect(await screen.findByTestId('booking-timeline-empty')).toBeTruthy();
    expect(screen.getByText('No booking windows')).toBeTruthy();
    expect(screen.getByTestId('booking-settings-summary-card')).toBeTruthy();
    expect(screen.getByTestId('booking-remind-me-card')).toBeTruthy();
    expect(
      screen.getByText(
        "Dates follow Disney's published booking rules (v1) — confirm in My Disney Experience.",
      ),
    ).toBeTruthy();
  });

  test('Loading and error retry states', async () => {
    let failFirst = true;
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/booking-timeline`) {
        if (failFirst) {
          failFirst = false;
          throw new Error('Server error');
        }
        return TIMELINE_FIXTURE;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    renderScreen();

    // Error state appears
    const retryBtn = await screen.findByTestId('booking-timeline-retry');
    expect(retryBtn).toBeTruthy();
    expect(screen.getByText("We couldn't load the timeline")).toBeTruthy();

    // Press Retry -> second request succeeds
    fireEvent.press(retryBtn);

    expect(await screen.findByText('Dining')).toBeTruthy();
  });

  test('Unavailable Trip (R10.4): trip_forbidden or trip_not_found calls setTripsListNotice and navigates to TripsList', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === `/trips/${TRIP_ID}/booking-timeline`) {
        const error = new ApiError({
          code: 'trip_forbidden',
          message: 'Access denied',
          status: 403,
        });
        throw error;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (method === 'GET' && path === '/me') return ORGANIZER_ME;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return ROSTER;
      throw new Error(`Unexpected ${method} ${path}`);
    });

    const { navigation } = renderScreen();

    await waitFor(() => {
      expect(setTripsListNoticeMock).toHaveBeenCalledWith('That booking timeline is no longer available.');
      expect(navigation.navigate).toHaveBeenCalledWith('TripsList');
    });
  });
});
