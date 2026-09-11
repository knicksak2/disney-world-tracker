/**
 * Interaction tests for the experience-activity-logging additions to
 * YourVisitCard: the repeat-count badge, the "Log visit / ride again" modal
 * flow, and the Visit History timeline delete.
 *
 * Each interactive flow is driven with fireEvent/waitFor and asserts BOTH the
 * network call it triggers (endpoint + payload) AND the resulting on-screen
 * change / query invalidation, per the repo's testing discipline. Only the
 * network layer (apiRequest) is mocked; the real components render.
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { ExperienceVisitHistoryDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the module under test is imported).
// ---------------------------------------------------------------------------

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import YourVisitCard from '../YourVisitCard';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '99999999-9999-4999-8999-999999999999';

interface QueryLike<T> {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly data: T | undefined;
}

const emptyQuery = <T,>(): QueryLike<T | null> => ({
  isLoading: false,
  isError: false,
  data: null,
});

const dataQuery = <T,>(data: T): QueryLike<T> => ({
  isLoading: false,
  isError: false,
  data,
});

function historyWith(
  logs: ExperienceVisitHistoryDTO['logs'],
): ExperienceVisitHistoryDTO {
  return { experienceId: EXPERIENCE_ID, repeatCount: logs.length, logs };
}

function renderCard(
  logsQuery: QueryLike<ExperienceVisitHistoryDTO | null>,
): {
  readonly invalidateSpy: jest.SpiedFunction<QueryClient['invalidateQueries']>;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

  render(
    <QueryClientProvider client={client}>
      <YourVisitCard
        experienceId={EXPERIENCE_ID}
        completionQuery={emptyQuery()}
        ratingQuery={emptyQuery()}
        noteQuery={emptyQuery()}
        logsQuery={logsQuery}
      />
    </QueryClientProvider>,
  );

  return { invalidateSpy };
}

/** The five query keys R6.5 requires invalidating on a log create/delete. */
function expectAllFiveInvalidations(
  invalidateSpy: jest.SpiedFunction<QueryClient['invalidateQueries']>,
): void {
  expect(invalidateSpy).toHaveBeenCalledWith({
    queryKey: ['experience-logs', EXPERIENCE_ID],
  });
  expect(invalidateSpy).toHaveBeenCalledWith({
    queryKey: ['experience-completion', EXPERIENCE_ID],
  });
  expect(invalidateSpy).toHaveBeenCalledWith({
    queryKey: ['experience-rating', EXPERIENCE_ID],
  });
  expect(invalidateSpy).toHaveBeenCalledWith({
    queryKey: ['experience-aggregate', EXPERIENCE_ID],
  });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me-stats'] });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('YourVisitCard — activity logging', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    // Default: no active trips; the log POST echoes a minimal DTO.
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/trips') {
        return [] as never;
      }
      return null as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // R6.1 — repeat-count badge
  test('renders the repeat-count badge when the viewer has logged visits (R6.1)', () => {
    renderCard(
      dataQuery(
        historyWith([
          {
            id: 'log-1',
            userId: 'u',
            experienceId: EXPERIENCE_ID,
            visitedOn: '2026-01-03',
            userTz: 'America/New_York',
            loggedAt: '2026-01-03T15:00:00.000Z',
            rating: 9,
            note: null,
          },
          {
            id: 'log-2',
            userId: 'u',
            experienceId: EXPERIENCE_ID,
            visitedOn: '2026-01-02',
            userTz: 'America/New_York',
            loggedAt: '2026-01-02T15:00:00.000Z',
            rating: null,
            note: null,
          },
        ]),
      ),
    );

    expect(screen.getByTestId('visit-count-badge')).toBeTruthy();
    expect(screen.getByText('Completed \u2022 2 visits')).toBeTruthy();
  });

  test('shows no badge when there are no logged visits (R6.1)', () => {
    renderCard(emptyQuery());
    expect(screen.queryByTestId('visit-count-badge')).toBeNull();
    // The log button is still present so a first visit can be recorded.
    expect(screen.getByTestId('log-visit-button')).toBeTruthy();
  });

  // R6.2 — the visit-logging button uses category-neutral, count-based copy.
  // With no prior visits it reads "Log a visit" (both the visible label and the
  // spoken accessibility label), never the ride-specific "ride again" wording.
  test('labels the button "Log a visit" when there are no logged visits (R6.2)', () => {
    renderCard(emptyQuery());
    const button = screen.getByTestId('log-visit-button');
    expect(button.props.accessibilityLabel).toBe('Log a visit');
    expect(within(button).getByText('Log a visit')).toBeTruthy();
    expect(within(button).queryByText('Log another visit')).toBeNull();
  });

  // R6.2 — once the viewer has one or more Experience_Logs, the same button
  // flips to "Log another visit", signalling a repeat without ride-only copy.
  test('labels the button "Log another visit" once at least one visit exists (R6.2)', () => {
    renderCard(
      dataQuery(
        historyWith([
          {
            id: 'log-1',
            userId: 'u',
            experienceId: EXPERIENCE_ID,
            visitedOn: '2026-01-03',
            userTz: 'America/New_York',
            loggedAt: '2026-01-03T15:00:00.000Z',
            rating: null,
            note: null,
          },
        ]),
      ),
    );
    const button = screen.getByTestId('log-visit-button');
    expect(button.props.accessibilityLabel).toBe('Log another visit');
    expect(within(button).getByText('Log another visit')).toBeTruthy();
    expect(within(button).queryByText('Log a visit')).toBeNull();
  });

  // R6.2 / R6.3 — open modal and submit a log
  test('opening the modal fetches active trips and shows the sheet (R6.2, R6.3)', async () => {
    renderCard(emptyQuery());
    expect(screen.queryByTestId('log-visit-modal')).toBeNull();

    fireEvent.press(screen.getByTestId('log-visit-button'));

    expect(screen.getByTestId('log-visit-modal')).toBeTruthy();
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', '/me/trips');
    });

    // With no active trips there is nothing to attribute the visit to, so the
    // whole Trip section (including the lone "No trip" chip) is omitted (R6.3).
    expect(screen.queryByText('Trip (optional)')).toBeNull();
    expect(screen.queryByTestId('log-visit-trip-none')).toBeNull();
  });

  // R6.3 / R6.6 — visit date is chosen through the in-app calendar picker, and
  // the picker is capped at today. The modal opens on the current month whose
  // future days are non-selectable (maximumDate = today), so we step back one
  // month — entirely in the past — and select the 15th there. This is
  // deterministic regardless of the real date the suite runs on.
  test('picking a past date in the calendar sets it in the POST payload (R6.3, R6.6)', async () => {
    renderCard(emptyQuery());

    fireEvent.press(screen.getByTestId('log-visit-button'));

    fireEvent.press(screen.getByTestId('log-visit-date'));
    expect(screen.getByTestId('log-visit-date-calendar')).toBeTruthy();
    // Step back to the previous month (entirely before today), then pick its
    // 15th by the calendar's per-day testID. Computing the previous month from
    // the real "today" keeps this deterministic whatever date the suite runs.
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const y = prevMonth.getFullYear();
    const m = String(prevMonth.getMonth() + 1).padStart(2, '0');
    const expectedVisitedOn = `${y}-${m}-15`;

    // react-native-calendars renders the month-navigation arrows with
    // `importantForAccessibility="no-hide-descendants"`, so RNTL's default
    // hidden-element filter skips them — query with includeHiddenElements.
    fireEvent.press(
      screen.getByTestId('log-visit-date-calendar-view.header.leftArrow', {
        includeHiddenElements: true,
      }),
    );
    fireEvent.press(
      screen.getByTestId(`log-visit-date-calendar-view.day_${expectedVisitedOn}`),
    );

    fireEvent.press(screen.getByTestId('log-visit-submit'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/experiences/${EXPERIENCE_ID}/logs`,
        expect.objectContaining({ visitedOn: expectedVisitedOn }),
      );
    });
  });

  test('submitting the modal POSTs the log and invalidates all five queries (R6.3, R6.5)', async () => {
    const { invalidateSpy } = renderCard(emptyQuery());

    fireEvent.press(screen.getByTestId('log-visit-button'));
    // Rating and note are optional; pick a rating and type a note.
    fireEvent.press(screen.getByTestId('log-visit-rating-8'));
    fireEvent.changeText(
      screen.getByTestId('log-visit-note-input'),
      'Loved it',
    );
    fireEvent.press(screen.getByTestId('log-visit-submit'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/experiences/${EXPERIENCE_ID}/logs`,
        expect.objectContaining({
          rating: 8,
          note: 'Loved it',
          tripId: null,
        }),
      );
    });

    // Payload also carries a well-formed visit date and a time zone.
    const postCall = apiRequestMock.mock.calls.find(
      (c) => c[0] === 'POST' && c[1] === `/me/experiences/${EXPERIENCE_ID}/logs`,
    );
    const payload = postCall?.[2] as {
      visitedOn: string;
      userTz: string;
    };
    expect(payload.visitedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof payload.userTz).toBe('string');

    await waitFor(() => expectAllFiveInvalidations(invalidateSpy));

    // The modal closes on success.
    await waitFor(() => {
      expect(screen.queryByTestId('log-visit-modal')).toBeNull();
    });
  });

  // R6.3 — trip selection is reflected in the payload
  test('selecting an active trip includes its id in the POST payload (R6.3)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/trips') {
        return [
          {
            status: 'active',
            trips: [
              {
                id: TRIP_ID,
                name: 'WDW 2026',
                description: '',
                startDate: '2026-01-01',
                endDate: '2026-01-05',
                status: 'active',
                role: 'organizer',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        ] as never;
      }
      return null as never;
    });

    renderCard(emptyQuery());
    fireEvent.press(screen.getByTestId('log-visit-button'));

    // Wait for the active trip chip to appear, then select it. Because an
    // active trip exists, the section (and its "No trip" deselect chip) render.
    const tripChip = await screen.findByTestId(`log-visit-trip-${TRIP_ID}`);
    expect(screen.getByTestId('log-visit-trip-none')).toBeTruthy();
    fireEvent.press(tripChip);
    fireEvent.press(screen.getByTestId('log-visit-submit'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/me/experiences/${EXPERIENCE_ID}/logs`,
        expect.objectContaining({ tripId: TRIP_ID }),
      );
    });
  });

  // R6.4 — visit history timeline expand + delete
  test('expanding the timeline reveals logs and deleting one DELETEs and invalidates (R6.4, R6.5)', async () => {
    const { invalidateSpy } = renderCard(
      dataQuery(
        historyWith([
          {
            id: 'log-abc',
            userId: 'u',
            experienceId: EXPERIENCE_ID,
            visitedOn: '2026-01-03',
            userTz: 'America/New_York',
            loggedAt: '2026-01-03T15:00:00.000Z',
            rating: 7,
            note: 'Second ride',
          },
        ]),
      ),
    );

    // Collapsed by default: the item is not shown until expanded.
    expect(screen.queryByTestId('visit-history-item-log-abc')).toBeNull();

    fireEvent.press(screen.getByTestId('visit-history-toggle'));
    expect(screen.getByTestId('visit-history-item-log-abc')).toBeTruthy();
    expect(screen.getByText('Second ride')).toBeTruthy();

    fireEvent.press(screen.getByTestId('visit-history-delete-log-abc'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        `/me/experiences/${EXPERIENCE_ID}/logs/log-abc`,
      );
    });
    await waitFor(() => expectAllFiveInvalidations(invalidateSpy));
  });
});
