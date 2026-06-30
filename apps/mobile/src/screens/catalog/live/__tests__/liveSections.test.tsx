// Feature: experience-live-details, Task 11.3 — live section + screen-state component tests
//
// Validates: Requirements 3.2, 3.3, 3.4, 3.5, 4.1, 4.5, 4.6, 4.7, 4.8, 4.9,
//            4.10, 4.13, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.4, 6.5, 6.6, 6.8
//
// Example-based component tests for the three gated live sections
// (`RideLiveSection`, `ShowtimesSection`, `DiningSection`) and the
// screen-level live-unavailable state on `ExperienceDetailScreen`.
//
// Each section is a pure presentation component driven by a `LiveDetailDTO`
// fixture plus the retrieval envelope (`retrievedAt`, `stale`,
// `upstreamLastUpdated`), so the section tests render them directly — no
// React Query / navigation plumbing is required. The screen-state test mounts
// the real screen with `apiRequest` stubbed (mirroring `emptyStates.test.tsx`)
// so the `live_unavailable` failure path can be exercised end-to-end.
//
// Park-local rendering: every timestamp is asserted against its
// America/New_York (US Eastern) wall-clock value. The chosen instants are in
// May (EDT, UTC-4), so e.g. `2024-05-01T19:30:00Z` renders as `3:30 PM`. The
// assertions are therefore independent of the machine's local time zone.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import type { LiveDetailDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (hoisted; only consumed by the screen-state test, harmless to the
// section render tests which never import the API client).
// ---------------------------------------------------------------------------

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../../../api/client', () => {
  const actual = jest.requireActual('../../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

import RideLiveSection from '../RideLiveSection';
import ShowtimesSection from '../ShowtimesSection';
import DiningSection from '../DiningSection';
import ExperienceDetailScreen from '../../ExperienceDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../../api/client';
import type { CatalogStackParamList } from '../../../../navigation/CatalogStack';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Park-local (America/New_York, EDT = UTC-4) reference instants.
const RETRIEVED_AT = '2024-05-01T19:30:00Z'; // 3:30 PM
const UPSTREAM_AT = '2024-05-01T19:25:00Z'; // 3:25 PM

/** A minimal, complete `LiveDetailDTO` with all arrays present. */
function emptyDetail(overrides: Partial<LiveDetailDTO> = {}): LiveDetailDTO {
  return {
    status: 'Operating',
    showtimes: [],
    operatingHours: [],
    diningAvailability: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RideLiveSection (R4.*)
// ---------------------------------------------------------------------------

describe('RideLiveSection (R4.1, R4.5–R4.10, R4.13)', () => {
  const now = new Date('2024-05-01T19:00:00Z');

  test('renders status, standby + single-rider waits, windows, boarding group, forecast, and both timestamps', () => {
    const detail = emptyDetail({
      status: 'Operating',
      waitMinutes: 45,
      singleRiderWaitMinutes: 20,
      returnWindow: {
        state: 'Available',
        start: '2024-05-01T20:00:00Z', // 4:00 PM
        end: '2024-05-01T21:00:00Z', // 5:00 PM
      },
      paidReturnWindow: {
        state: 'Available',
        price: { amount: 1500, currency: 'USD', formatted: '$15.00 per guest' },
      },
      boardingGroup: {
        allocation: 'Available',
        currentGroupStart: 10,
        currentGroupEnd: 25,
        nextAllocationTime: '2024-05-01T20:30:00Z', // 4:30 PM
        estimatedWaitMinutes: 35,
      },
      forecast: [
        { time: '2024-05-01T20:00:00Z', waitMinutes: 40, percentage: 80 }, // 4:00 PM
        { time: '2024-05-01T21:00:00Z', waitMinutes: 15, percentage: 30 }, // 5:00 PM — lowest
        { time: '2024-05-01T22:00:00Z', waitMinutes: 30, percentage: 55 }, // 6:00 PM
      ],
      upstreamLastUpdated: UPSTREAM_AT,
    });

    render(
      <RideLiveSection
        liveDetail={detail}
        retrievedAt={RETRIEVED_AT}
        stale={false}
        upstreamLastUpdated={UPSTREAM_AT}
        now={now}
      />,
    );

    // R4.1 — Operating_Status label.
    expect(screen.getByTestId('live-operating-status')).toHaveTextContent(
      'Operating',
    );

    // R4.2 — standby wait shown while Operating + wait present.
    expect(screen.getByTestId('standby-wait')).toHaveTextContent('45 min');
    expect(screen.queryByTestId('no-standby-wait')).toBeNull();

    // R4.7 — single-rider wait, distinct from standby.
    expect(screen.getByTestId('single-rider-wait')).toHaveTextContent('20 min');

    // R4.8 — return window state + park-local window (composite text node, so
    // regex/substring matchers are used).
    const returnTimes = screen.getByTestId('return-window-times');
    expect(returnTimes).toHaveTextContent(/4:00\s*PM/);
    expect(returnTimes).toHaveTextContent(/5:00\s*PM/);

    // R4.9 — paid return window formatted price verbatim from upstream.
    expect(screen.getByTestId('paid-return-price')).toHaveTextContent(
      '$15.00 per guest',
    );

    // R4.10 — boarding-group allocation + current group range.
    expect(screen.getByTestId('boarding-group')).toBeTruthy();
    expect(screen.getByTestId('boarding-group-range')).toHaveTextContent(
      /10.25/,
    );

    // R4.11 — forecast renders as a bar chart with the lowest entry highlighted.
    expect(screen.getByTestId('forecast-chart')).toBeTruthy();
    expect(screen.getByTestId('forecast-bar-lowest')).toHaveTextContent(
      /15 min/,
    );
    expect(screen.getByTestId('forecast-legend')).toHaveTextContent(/15 min/);
    expect(screen.queryByTestId('forecast-empty')).toBeNull();

    // R4.5 / R4.13 — Retrieved_At and the distinctly-labeled
    // Upstream_Last_Updated, each in park-local time.
    const retrieved = screen.getByTestId('live-retrieved-at');
    expect(retrieved).toHaveTextContent(/Retrieved/);
    expect(retrieved).toHaveTextContent(/3:30\s*PM/);
    const upstream = screen.getByTestId('live-upstream-last-updated');
    expect(upstream).toHaveTextContent(/Source updated/);
    expect(upstream).toHaveTextContent(/3:25\s*PM/);
  });

  test('R4.3/R4.4: a non-Operating status shows no standby value; Operating with no wait shows the no-wait indicator', () => {
    const closed = render(
      <RideLiveSection
        liveDetail={emptyDetail({ status: 'Closed', waitMinutes: 30 })}
        retrievedAt={RETRIEVED_AT}
        stale={false}
        now={now}
      />,
    );
    // R4.1 — label is the Closed enum literal.
    expect(closed.getByTestId('live-operating-status')).toHaveTextContent(
      'Closed',
    );
    // R4.3 — no standby value while not Operating.
    expect(closed.queryByTestId('standby-wait')).toBeNull();
    expect(closed.queryByTestId('no-standby-wait')).toBeNull();
    closed.unmount();

    // R4.4 — Operating but no wait posted → no-wait indicator.
    render(
      <RideLiveSection
        liveDetail={emptyDetail({ status: 'Operating' })}
        retrievedAt={RETRIEVED_AT}
        stale={false}
        now={now}
      />,
    );
    expect(screen.getByTestId('no-standby-wait')).toBeTruthy();
    expect(screen.queryByTestId('standby-wait')).toBeNull();
  });

  test('R4.12: no upcoming forecast entries renders the forecast empty state', () => {
    render(
      <RideLiveSection
        liveDetail={emptyDetail({ status: 'Operating', waitMinutes: 10 })}
        retrievedAt={RETRIEVED_AT}
        stale={false}
        now={now}
      />,
    );
    expect(screen.getByTestId('forecast-empty')).toBeTruthy();
    expect(screen.queryByTestId('forecast-chart')).toBeNull();
    expect(screen.queryByTestId('forecast-bar')).toBeNull();
    expect(screen.queryByTestId('forecast-bar-lowest')).toBeNull();
  });

  test('R4.6/R3.5: the stale indicator renders when the served detail is stale', () => {
    render(
      <RideLiveSection
        liveDetail={emptyDetail({ status: 'Operating', waitMinutes: 25 })}
        retrievedAt={RETRIEVED_AT}
        stale
        now={now}
      />,
    );
    expect(screen.getByTestId('live-stale-indicator')).toHaveTextContent(
      /out of date/i,
    );
    // Retrieved_At is still shown alongside the stale indicator (R3.5).
    expect(screen.getByTestId('live-retrieved-at')).toHaveTextContent(/3:30\s*PM/);
  });

  test('R4.13: with no Upstream_Last_Updated only the Retrieved_At stamp is shown', () => {
    render(
      <RideLiveSection
        liveDetail={emptyDetail({ status: 'Operating', waitMinutes: 25 })}
        retrievedAt={RETRIEVED_AT}
        stale={false}
        now={now}
      />,
    );
    expect(screen.getByTestId('live-retrieved-at')).toBeTruthy();
    expect(screen.queryByTestId('live-upstream-last-updated')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ShowtimesSection (R5.*)
// ---------------------------------------------------------------------------

describe('ShowtimesSection (R5.1, R5.3–R5.7)', () => {
  test('renders status, sorted current-day showtimes with end + optional type, and both timestamps', () => {
    const detail = emptyDetail({
      status: 'Operating',
      showtimes: [
        // Intentionally out of order; the view sorts ascending by start.
        {
          start: '2024-05-01T23:00:00Z', // 7:00 PM
          end: '2024-05-02T00:30:00Z', // 8:30 PM
          type: 'Dessert Party',
        },
        { start: '2024-05-01T22:00:00Z' }, // 6:00 PM, no end/type
      ],
      upstreamLastUpdated: UPSTREAM_AT,
    });

    render(
      <ShowtimesSection
        liveDetail={detail}
        retrievedAt={RETRIEVED_AT}
        stale={false}
        upstreamLastUpdated={UPSTREAM_AT}
      />,
    );

    // R5.3 — Operating_Status label.
    expect(screen.getByTestId('live-operating-status')).toHaveTextContent(
      'Operating',
    );

    // R5.1 — showtimes listed, sorted ascending by start.
    const rows = screen.getAllByTestId('showtime-row');
    expect(rows).toHaveLength(2);
    const times = screen.getAllByTestId('showtime-time');
    expect(times[0]).toHaveTextContent('6:00 PM'); // earliest first
    // R5.4 — end time shown when present (the later, ranged performance).
    expect(times[1]).toHaveTextContent(/7:00\s*PM/);
    expect(times[1]).toHaveTextContent(/8:30\s*PM/);

    // R5.6 — Showtime_Type label shown alongside the showtime.
    expect(screen.getByTestId('showtime-type')).toHaveTextContent(
      'Dessert Party',
    );

    // R5.5 / R5.7 — Retrieved_At + distinctly-labeled Upstream_Last_Updated.
    expect(screen.getByTestId('live-retrieved-at')).toHaveTextContent(/3:30\s*PM/);
    expect(screen.getByTestId('live-upstream-last-updated')).toHaveTextContent(
      /3:25\s*PM/,
    );
  });

  test('R5.2: no current-day showtimes renders the empty state and no rows', () => {
    render(
      <ShowtimesSection
        liveDetail={emptyDetail({ status: 'Closed', showtimes: [] })}
        retrievedAt={RETRIEVED_AT}
        stale={false}
      />,
    );
    expect(screen.getByTestId('showtimes-empty')).toBeTruthy();
    expect(screen.queryByTestId('showtimes-list')).toBeNull();
    expect(screen.queryByTestId('showtime-row')).toBeNull();
    // R5.3 — status still shown even with no performances.
    expect(screen.getByTestId('live-operating-status')).toHaveTextContent(
      'Closed',
    );
  });
});

// ---------------------------------------------------------------------------
// DiningSection (R6.*)
// ---------------------------------------------------------------------------

describe('DiningSection (R6.1, R6.2, R6.4–R6.6, R6.8)', () => {
  test('renders status, operating hours with optional type, walk-up availability, and both timestamps', () => {
    const detail = emptyDetail({
      status: 'Operating',
      operatingHours: [
        {
          open: '2024-05-01T15:00:00Z', // 11:00 AM
          close: '2024-05-02T01:00:00Z', // 9:00 PM
          type: 'Lunch',
        },
      ],
      diningAvailability: [
        { partySize: 4, estimatedWaitMinutes: 25 },
        { partySize: 2 },
      ],
      upstreamLastUpdated: UPSTREAM_AT,
    });

    render(
      <DiningSection
        liveDetail={detail}
        retrievedAt={RETRIEVED_AT}
        stale={false}
        upstreamLastUpdated={UPSTREAM_AT}
      />,
    );

    // R6.1 — Operating_Status label.
    expect(screen.getByTestId('live-operating-status')).toHaveTextContent(
      'Operating',
    );

    // R6.2 — current-day open/close in park-local time.
    const hoursText = screen.getByTestId('dining-hours-text');
    expect(hoursText).toHaveTextContent(/11:00\s*AM/);
    expect(hoursText).toHaveTextContent(/9:00\s*PM/);
    // R6.5 — Operating_Hours_Type label alongside the hours.
    expect(screen.getByTestId('dining-hours-type')).toHaveTextContent('Lunch');

    // R6.6 — walk-up availability as a first-class element, one row per entry.
    const walkupRows = screen.getAllByTestId('dining-walkup-row');
    expect(walkupRows).toHaveLength(2);
    expect(walkupRows[0]).toHaveTextContent(/Party of 4/);
    expect(walkupRows[0]).toHaveTextContent(/25 min wait/);
    expect(walkupRows[1]).toHaveTextContent(/Party of 2/);

    // R6.4 / R6.8 — Retrieved_At + distinctly-labeled Upstream_Last_Updated.
    expect(screen.getByTestId('live-retrieved-at')).toHaveTextContent(/3:30\s*PM/);
    expect(screen.getByTestId('live-upstream-last-updated')).toHaveTextContent(
      /3:25\s*PM/,
    );
  });

  test('R6.3/R6.7: missing hours and empty availability render their empty states', () => {
    render(
      <DiningSection
        liveDetail={emptyDetail({
          status: 'Closed',
          operatingHours: [],
          diningAvailability: [],
        })}
        retrievedAt={RETRIEVED_AT}
        stale={false}
      />,
    );
    // R6.3 — dining hours unavailable empty state, no hours rows.
    expect(screen.getByTestId('dining-hours-empty')).toBeTruthy();
    expect(screen.queryByTestId('dining-hours-row')).toBeNull();
    // R6.7 — walk-up unavailable empty state, no walk-up rows.
    expect(screen.getByTestId('dining-walkup-empty')).toBeTruthy();
    expect(screen.queryByTestId('dining-walkup-row')).toBeNull();
  });

  test('R6.6: walk-up availability renders independently of operating hours', () => {
    render(
      <DiningSection
        liveDetail={emptyDetail({
          status: 'Operating',
          operatingHours: [], // no hours at all
          diningAvailability: [{ partySize: 6, estimatedWaitMinutes: 40 }],
        })}
        retrievedAt={RETRIEVED_AT}
        stale={false}
      />,
    );
    // Hours empty state shows...
    expect(screen.getByTestId('dining-hours-empty')).toBeTruthy();
    // ...while walk-up availability is still rendered as a first-class element.
    const walkup = screen.getAllByTestId('dining-walkup-row');
    expect(walkup).toHaveLength(1);
    expect(walkup[0]).toHaveTextContent(/Party of 6/);
    expect(walkup[0]).toHaveTextContent(/40 min wait/);
  });
});

// ---------------------------------------------------------------------------
// Screen-level live-unavailable state (R3.2, R3.3, R3.4)
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderExperienceDetail(experienceId: string): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<CatalogStackParamList>();
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailScreen}
            initialParams={{ experienceId }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('ExperienceDetailScreen live-unavailable state (R3.2, R3.3, R3.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('R3.2/R3.3: a live_unavailable failure shows the indicator while the static fields remain visible', async () => {
    const experienceId = 'exp-live-unavailable';

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path !== 'string') {
        throw new Error(`unexpected non-string path: ${String(path)}`);
      }
      if (path === `/catalog/${experienceId}`) {
        return {
          id: experienceId,
          name: 'Space Mountain',
          park: 'Magic Kingdom',
          category: 'Ride',
          description: 'A thrilling indoor coaster.',
          imageUrl: null,
          imageAttribution: null,
        };
      }
      if (path === `/catalog/${experienceId}/live`) {
        // R3.2 — the orchestrator returns 503 live_unavailable when a fresh
        // retrieval fails and no cached Live_Detail exists.
        throw new ApiError({
          code: 'live_unavailable',
          message: 'Live data is currently unavailable',
          status: 503,
        });
      }
      // Personal / aggregate reads settle into their own empty states.
      if (path.endsWith('/completion')) {
        throw new ApiError({
          code: 'completion_not_found',
          message: 'no completion',
          status: 404,
        });
      }
      if (path.endsWith('/rating')) {
        throw new ApiError({
          code: 'rating_not_found',
          message: 'no rating',
          status: 404,
        });
      }
      if (path.endsWith('/note')) {
        throw new ApiError({
          code: 'note_not_found',
          message: 'no note',
          status: 404,
        });
      }
      if (path === `/experiences/${experienceId}/aggregate-rating`) {
        return { value: null, count: 0 };
      }
      throw new Error(`unexpected call to ${path}`);
    });

    renderExperienceDetail(experienceId);

    // R3.2 — the live-unavailable indicator renders.
    await waitFor(() => {
      expect(screen.getByTestId('live-unavailable')).toBeTruthy();
    });
    expect(
      screen.getByText(/live information currently unavailable/i),
    ).toBeTruthy();

    // R3.3 — the static detail fields remain visible.
    expect(screen.getByText('A thrilling indoor coaster.')).toBeTruthy();
    expect(screen.getByTestId('experience-park-badge')).toBeTruthy();
  });

  test('R3.4: when the static detail itself cannot be rendered the live-unavailable indicator is still shown', async () => {
    const experienceId = 'exp-detail-error';

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path !== 'string') {
        throw new Error(`unexpected non-string path: ${String(path)}`);
      }
      // The catalog detail fetch fails outright.
      if (path === `/catalog/${experienceId}`) {
        throw new ApiError({
          code: 'catalog_unavailable',
          message: 'catalog upstream unreachable',
          status: 503,
        });
      }
      // Any remaining reads are irrelevant once the detail errors.
      throw new ApiError({
        code: 'live_unavailable',
        message: 'unavailable',
        status: 503,
      });
    });

    renderExperienceDetail(experienceId);

    await waitFor(() => {
      expect(screen.getByTestId('live-unavailable')).toBeTruthy();
    });
  });
});
