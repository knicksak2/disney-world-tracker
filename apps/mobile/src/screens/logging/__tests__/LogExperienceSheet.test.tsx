// Feature: unified-experience-logging, Task 7.1 — LogExperienceSheet tests
//
// Validates: Requirements 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9,
//            3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6,
//            6.8, 6.9, 7.1, 7.5, 7.6

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PINS, type TripMemberDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../../api/client';
import LogExperienceSheet from '../LogExperienceSheet';
import { useLogToastStore } from '../logToastStore';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

function deviceToday(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  let yyyy = '';
  let mm = '';
  let dd = '';
  for (const p of parts) {
    if (p.type === 'year') yyyy = p.value;
    else if (p.type === 'month') mm = p.value;
    else if (p.type === 'day') dd = p.value;
  }
  return `${yyyy}-${mm}-${dd}`;
}

const TODAY = deviceToday();

const MOCK_ACTIVE_TRIP_1 = {
  id: 'trip-1',
  name: 'Trip One',
  startDate: '2020-01-01',
  endDate: '2030-12-31',
};

const MOCK_ACTIVE_TRIP_2 = {
  id: 'trip-2',
  name: 'Trip Two',
  startDate: '2020-01-01',
  endDate: '2030-12-31',
};

const MOCK_MEMBERS: readonly TripMemberDTO[] = [
  {
    userId: 'user-caller',
    displayName: 'Caller User',
    avatarPreset: null,
    role: 'organizer',
  },
  {
    userId: 'user-bob',
    displayName: 'Bob Rider',
    avatarPreset: null,
    role: 'member',
  },
  {
    userId: 'user-carol',
    displayName: 'Carol Rider',
    avatarPreset: null,
    role: 'member',
  },
];

describe('LogExperienceSheet', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });

    useLogToastStore.getState().dismiss();

    mockApiRequest.mockImplementation(async (_method, path) => {
      if (path === '/me') {
        return { user: { id: 'user-caller' } };
      }
      if (path === '/me/trips') {
        return [{ status: 'active', trips: [MOCK_ACTIVE_TRIP_1] }];
      }
      if (path.includes('/members')) {
        return MOCK_MEMBERS;
      }
      if (path.startsWith('/catalog/')) {
        return { name: 'Space Mountain', category: 'Attraction' };
      }
      if (path.startsWith('/trips/trip-lock-1')) {
        return {
          id: 'trip-lock-1',
          name: 'Locked Family Trip',
          startDate: '2020-01-01',
          endDate: '2030-12-31',
        };
      }
      return {};
    });
  });

  afterEach(() => {
    queryClient.clear();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function renderSheet(props: Partial<React.ComponentProps<typeof LogExperienceSheet>> = {}) {
    return render(
      <QueryClientProvider client={queryClient}>
        <LogExperienceSheet
          experienceId="exp-sm"
          visible={true}
          onClose={jest.fn()}
          onLogged={jest.fn()}
          {...props}
        />
      </QueryClientProvider>,
    );
  }

  it('pre-selects the single active trip containing today', async () => {
    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-trip-trip-1')).toBeTruthy();
    });

    // The single active trip is preselected
    expect(screen.getByTestId('log-visit-trip-trip-1').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('log-visit-trip-none').props.accessibilityState.selected).toBe(false);

    // Riders row is shown since a trip is selected
    await waitFor(() => {
      expect(screen.getByTestId('log-visit-member-user-bob')).toBeTruthy();
    });
    // Caller is excluded from candidates
    expect(screen.queryByTestId('log-visit-member-user-caller')).toBeNull();
  });

  it('shows chips and selects none when there are two active trips containing today', async () => {
    mockApiRequest.mockImplementation(async (_method, path) => {
      if (path === '/me') return { user: { id: 'user-caller' } };
      if (path === '/me/trips') {
        return [{ status: 'active', trips: [MOCK_ACTIVE_TRIP_1, MOCK_ACTIVE_TRIP_2] }];
      }
      return {};
    });

    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-trip-trip-1')).toBeTruthy();
      expect(screen.getByTestId('log-visit-trip-trip-2')).toBeTruthy();
    });

    // Neither trip is preselected; "No trip" is selected
    expect(screen.getByTestId('log-visit-trip-none').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('log-visit-trip-trip-1').props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId('log-visit-trip-trip-2').props.accessibilityState.selected).toBe(false);

    // No riders row when no trip is selected
    expect(screen.queryByTestId('log-visit-rodewith')).toBeNull();
  });

  it('omits the Trip section when there are no active trips', async () => {
    mockApiRequest.mockImplementation(async (_method, path) => {
      if (path === '/me') return { user: { id: 'user-caller' } };
      if (path === '/me/trips') {
        return [{ status: 'active', trips: [] }];
      }
      return {};
    });

    renderSheet();

    await waitFor(() => {
      expect(screen.queryByTestId('log-visit-trip-none')).toBeNull();
      expect(screen.queryByTestId('log-visit-trip-trip-1')).toBeNull();
    });
  });

  it('in locked mode, displays label only and posts to /trips/:id/log-entries with exact body', async () => {
    renderSheet({ lockedTripId: 'trip-lock-1', testIDPrefix: 'activity-log' });

    await waitFor(() => {
      expect(screen.getByTestId('activity-log-trip-locked')).toBeTruthy();
    });

    expect(screen.queryByTestId('activity-log-trip-none')).toBeNull();

    // Select rating 8 and write a note
    fireEvent.press(screen.getByTestId('activity-log-rating-8'));
    fireEvent.changeText(screen.getByTestId('activity-log-note-input'), 'Amazing ride!');

    // Toggle Bob in riders
    await waitFor(() => {
      expect(screen.getByTestId('activity-log-member-user-bob')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('activity-log-member-user-bob'));

    mockApiRequest.mockResolvedValueOnce({ newlyAwardedPinIds: [] });

    fireEvent.press(screen.getByTestId('activity-log-submit'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/trips/trip-lock-1/log-entries',
        expect.objectContaining({
          experienceId: 'exp-sm',
          visitedOn: TODAY,
          rating: 8,
          note: 'Amazing ride!',
          rodeWith: ['user-bob'],
        }),
      );
    });
  });

  it('posts to /me/experiences/:id/logs with tripId and rodeWith in unlocked mode', async () => {
    const onLogged = jest.fn();
    const onClose = jest.fn();

    renderSheet({ onLogged, onClose });

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-member-user-bob')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('log-visit-member-user-bob'));

    mockApiRequest.mockResolvedValueOnce({
      id: 'log-101',
      tripLog: { tripId: 'trip-1', logEntryId: 'entry-1', taggedCount: 1 },
      newlyAwardedPinIds: [],
    });

    fireEvent.press(screen.getByTestId('log-visit-submit'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/me/experiences/exp-sm/logs',
        expect.objectContaining({
          visitedOn: TODAY,
          rating: null,
          note: null,
          tripId: 'trip-1',
          rodeWith: ['user-bob'],
        }),
      );
    });

    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('clears Trip and riders and shows hint when date changes out of range', async () => {
    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-trip-trip-1').props.accessibilityState.selected).toBe(true);
      expect(screen.getByTestId('log-visit-member-user-bob')).toBeTruthy();
    });

    // Tag Bob
    fireEvent.press(screen.getByTestId('log-visit-member-user-bob'));
    expect(screen.getByTestId('log-visit-member-user-bob').props.accessibilityState.selected).toBe(true);

    // Date changes to 2019-12-31 (outside Trip 1 range 2020-01-01..2030-12-31)
    act(() => {
      fireEvent(screen.getByTestId('log-visit-date'), 'onChange', '2019-12-31');
    });

    // Trip is deselected ("No trip" selected)
    expect(screen.getByTestId('log-visit-trip-none').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('log-visit-trip-trip-1').props.accessibilityState.selected).toBe(false);

    // Riders row is cleared/hidden
    expect(screen.queryByTestId('log-visit-rodewith')).toBeNull();

    // Hint is displayed
    expect(screen.getByTestId('log-visit-date-hint')).toBeTruthy();
    expect(screen.getByText("That date is outside this trip's dates.")).toBeTruthy();
  });

  it('toggles rider chips on tap', async () => {
    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-member-user-bob')).toBeTruthy();
    });

    const bobChip = screen.getByTestId('log-visit-member-user-bob');
    expect(bobChip.props.accessibilityState.selected).toBe(false);

    fireEvent.press(bobChip);
    expect(bobChip.props.accessibilityState.selected).toBe(true);

    fireEvent.press(bobChip);
    expect(bobChip.props.accessibilityState.selected).toBe(false);
  });

  it('shows "Dined with" for category Restaurant', async () => {
    renderSheet({
      experience: { name: 'Be Our Guest', category: 'Restaurant' },
    });

    await waitFor(() => {
      expect(screen.getByText('Dined with')).toBeTruthy();
    });
  });

  it('shows "Rode with" for category Attraction', async () => {
    renderSheet({
      experience: { name: 'Space Mountain', category: 'Attraction' },
    });

    await waitFor(() => {
      expect(screen.getByText('Rode with')).toBeTruthy();
    });
  });

  it('shows busy state and disables submit during in-flight submission', async () => {
    let resolveSubmit: (val: unknown) => void = () => {};
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });

    mockApiRequest.mockImplementation(async (method, path) => {
      if (path === '/me') return { user: { id: 'user-caller' } };
      if (path === '/me/trips') return [{ status: 'active', trips: [MOCK_ACTIVE_TRIP_1] }];
      if (path.includes('/members')) return MOCK_MEMBERS;
      if (method === 'POST') return submitPromise;
      return {};
    });

    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-submit')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('log-visit-submit'));

    expect(screen.getByTestId('log-visit-busy')).toBeTruthy();
    expect(screen.getByTestId('log-visit-submit').props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      resolveSubmit({ newlyAwardedPinIds: [] });
    });
  });

  it('renders inline error message and keeps sheet open for each of the six error codes', async () => {
    const errorCases = [
      { code: 'log_outside_trip_dates', expected: "That date is outside this trip's dates." },
      { code: 'log_future_date', expected: 'Visit date cannot be in the future.' },
      { code: 'trip_forbidden', expected: 'You do not have access to this trip.' },
      { code: 'trip_validation_failed', expected: 'Could not validate trip members.' },
      { code: 'rating_out_of_range', expected: 'Rating must be 1-10.' },
      { code: 'note_length_invalid', expected: 'Note must be 1-2000 characters.' },
    ];

    for (const ec of errorCases) {
      mockApiRequest.mockImplementation(async (method, path) => {
        if (method === 'POST') {
          throw new ApiError({
            status: 400,
            code: ec.code as any,
            message: 'Error occurred',
          });
        }
        if (path === '/me') return { user: { id: 'user-caller' } };
        if (path === '/me/trips') return [{ status: 'active', trips: [MOCK_ACTIVE_TRIP_1] }];
        if (path.includes('/members')) return MOCK_MEMBERS;
        if (path.startsWith('/catalog/')) return { name: 'Space Mountain', category: 'Attraction' };
        return {};
      });

      const { unmount } = renderSheet();

      await waitFor(() => {
        expect(screen.getByTestId('log-visit-submit')).toBeTruthy();
      });

      fireEvent.press(screen.getByTestId('log-visit-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('log-visit-error')).toBeTruthy();
        expect(screen.getByText(ec.expected)).toBeTruthy();
      });

      // Sheet stays open
      expect(screen.getByTestId('log-visit-modal')).toBeTruthy();

      unmount();
    }
  });

  it('invalidates queries and enqueues toast on success', async () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-member-user-bob')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('log-visit-member-user-bob'));

    mockApiRequest.mockResolvedValueOnce({ newlyAwardedPinIds: [] });

    fireEvent.press(screen.getByTestId('log-visit-submit'));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['experience-logs', 'exp-sm'] }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['trips', 'feed', 'trip-1'] }),
      );
    });

    const toast = useLogToastStore.getState().current;
    expect(toast).toBeTruthy();
    expect(toast?.message).toBe('Space Mountain logged to Trip One with Bob Rider');
    expect(toast?.tripId).toBe('trip-1');
  });

  it('opens PinCelebrationModal when newlyAwardedPinIds is present in response', async () => {
    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-submit')).toBeTruthy();
    });

    const pinId = PINS[0]!.id;
    mockApiRequest.mockResolvedValueOnce({ newlyAwardedPinIds: [pinId] });

    fireEvent.press(screen.getByTestId('log-visit-submit'));

    await waitFor(() => {
      expect(screen.getByTestId(`pin-celebration-${pinId}`)).toBeTruthy();
    });
  });

  it('shows inline retry when members fail to load and still allows submit', async () => {
    mockApiRequest.mockImplementation(async (method, path) => {
      if (path === '/me') return { user: { id: 'user-caller' } };
      if (path === '/me/trips') return [{ status: 'active', trips: [MOCK_ACTIVE_TRIP_1] }];
      if (path.includes('/members')) {
        throw new ApiError({
          status: 500,
          code: 'internal_error',
          message: 'Failed to load members',
        });
      }
      if (method === 'POST') return { newlyAwardedPinIds: [] };
      return {};
    });

    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('log-visit-members-retry')).toBeTruthy();
      expect(screen.getByText('Could not load trip members.')).toBeTruthy();
    });

    // Submitting still works
    fireEvent.press(screen.getByTestId('log-visit-submit'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/me/experiences/exp-sm/logs',
        expect.objectContaining({
          tripId: 'trip-1',
        }),
      );
    });
  });
});