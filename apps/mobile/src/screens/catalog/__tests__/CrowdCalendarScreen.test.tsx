import React from 'react';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { Calendar } from 'react-native-calendars';
import { apiRequest } from '../../../api/client';
import CrowdCalendarScreen from '../CrowdCalendarScreen';
import { CROWD_LEVEL, EVENT_BADGE } from '../CrowdCalendarScreen.palette';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme } from '../../../theme/theme';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

describe('CrowdCalendarScreen', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    mockApiRequest.mockReset();
  });

  function renderScreen() {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <CrowdCalendarScreen />
        </NavigationContainer>
      </QueryClientProvider>
    );
  }

  it('renders calendar, day detail, and features when data is returned', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockApiRequest.mockResolvedValue({
      days: [
        {
          date: today,
          park: 'Magic Kingdom',
          forecastIndex: 1.2, // Level 6 - Moderate
          parkHours: { openTime: '2026-08-07T09:00:00Z', closeTime: '2026-08-07T22:00:00Z' },
          earlyEntry: true,
          extendedEvening: false,
          ticketedEvent: false,
          llMultipassPriceCents: 2900,
        },
      ],
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('MK')).toBeTruthy();
      expect(screen.getByText('Day detail')).toBeTruthy();
      expect(screen.getByText('Park info')).toBeTruthy();
      expect(screen.getByText('Early Entry')).toBeTruthy();
      expect(screen.getByText('$29')).toBeTruthy();
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      'GET',
      expect.stringMatching(/^\/crowd-calendar\?from=.*&to=.*$/),
    );
  });
});

/**
 * R7.5 — predicted-versus-actual and the recent-accuracy surface.
 *
 * The "How we did" block existed in the screen for a long time but was
 * unreachable: the API never populated `observedIndex`, so the branch never
 * rendered. These tests drive the real component with the real fields and assert
 * the rendered output, including the point that matters most — the "we predicted"
 * figure comes from the FROZEN capture, not from today's recomputed forecast.
 */
describe('CrowdCalendarScreen — predicted vs actual (R7.5)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockApiRequest.mockReset();
  });

  function renderScreen() {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <CrowdCalendarScreen />
        </NavigationContainer>
      </QueryClientProvider>
    );
  }

  function dayWith(extra: Record<string, unknown>) {
    const today = new Date().toISOString().split('T')[0];
    return {
      days: [
        {
          date: today,
          park: 'Magic Kingdom',
          // Today's RECOMPUTED forecast. Must not be what the comparison shows.
          forecastIndex: 9,
          parkHours: { openTime: '2026-08-07T09:00:00Z', closeTime: '2026-08-07T22:00:00Z' },
          earlyEntry: false,
          extendedEvening: false,
          ticketedEvent: false,
          ...extra,
        },
      ],
    };
  }

  it('shows the frozen captured forecast against the actual, not the recomputed forecast', async () => {
    mockApiRequest.mockResolvedValue(
      dayWith({
        observedIndex: 5,
        capturedForecast: { index: 6, leadDays: 7, capturedAt: '2026-08-19T12:00:00.000Z' },
      }),
    );

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('How we did')).toBeTruthy();
      // 6/10 is the CAPTURED forecast; 9/10 is today's recomputed one and must
      // not appear in this comparison.
      expect(screen.getByText('We predicted 6/10 · actual was 5/10')).toBeTruthy();
    });

    expect(screen.queryByText('We predicted 9/10 · actual was 5/10')).toBeNull();
    expect(screen.getByText('Forecast made 7 days ahead')).toBeTruthy();
  });

  it('renders the recent accuracy figure with its sample count', async () => {
    mockApiRequest.mockResolvedValue(
      dayWith({
        observedIndex: 5,
        capturedForecast: { index: 6, leadDays: 7, capturedAt: '2026-08-19T12:00:00.000Z' },
        forecastAccuracy: { meanAbsoluteErrorLevels: 1.2, leadDays: 7, sampleCount: 8 },
      }),
    );

    renderScreen();

    await waitFor(() => {
      expect(
        screen.getByText('Typically within 1.2 levels at this range (8 days scored)'),
      ).toBeTruthy();
    });
  });

  it('singularizes a one-day lead and a single scored day', async () => {
    mockApiRequest.mockResolvedValue(
      dayWith({
        observedIndex: 4,
        capturedForecast: { index: 4, leadDays: 1, capturedAt: '2026-08-25T12:00:00.000Z' },
        forecastAccuracy: { meanAbsoluteErrorLevels: 0.5, leadDays: 1, sampleCount: 1 },
      }),
    );

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Forecast made 1 day ahead')).toBeTruthy();
      expect(
        screen.getByText('Typically within 0.5 levels at this range (1 day scored)'),
      ).toBeTruthy();
    });
  });

  it('reports the actual alone when no capture survives for that date', async () => {
    mockApiRequest.mockResolvedValue(dayWith({ observedIndex: 5 }));

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('How we did')).toBeTruthy();
      expect(screen.getByText('Actual was 5/10')).toBeTruthy();
    });

    // No fabricated prediction, and no accuracy line without data behind it.
    expect(screen.queryByText(/We predicted/)).toBeNull();
    expect(screen.queryByText(/Forecast made/)).toBeNull();
    expect(screen.queryByText(/Typically within/)).toBeNull();
  });

  it('hides the whole block for a future date with no actual yet', async () => {
    mockApiRequest.mockResolvedValue(
      dayWith({
        capturedForecast: { index: 7, leadDays: 7, capturedAt: '2026-08-19T12:00:00.000Z' },
      }),
    );

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Park info')).toBeTruthy();
    });

    // A prediction with nothing to compare it against is not "how we did".
    expect(screen.queryByText('How we did')).toBeNull();
    expect(screen.queryByText(/actual was/)).toBeNull();
  });

  it('labels the comparison for screen readers without relying on the glyph separator', async () => {
    mockApiRequest.mockResolvedValue(
      dayWith({
        observedIndex: 5,
        capturedForecast: { index: 6, leadDays: 3, capturedAt: '2026-08-23T12:00:00.000Z' },
      }),
    );

    renderScreen();

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          'We predicted 6 out of 10, 3 days ahead. Actual was 5 out of 10.',
        ),
      ).toBeTruthy();
    });
  });
});

describe('CrowdCalendarScreen — Day detail additions (R6.2, R6.6, R10.5)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockApiRequest.mockReset();
  });

  function renderScreen() {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <CrowdCalendarScreen />
        </NavigationContainer>
      </QueryClientProvider>
    );
  }

  it('renders all-parks comparison, standby wait, weather, and festival', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockApiRequest.mockResolvedValue({
      days: [
        {
          date: today,
          park: 'Magic Kingdom',
          forecastIndex: 1.2,
          parkHours: { openTime: '2026-08-07T09:00:00Z', closeTime: '2026-08-07T22:00:00Z' },
          earlyEntry: false,
          extendedEvening: false,
          ticketedEvent: false,
          expectedAvgWaitMinutes: 38,
          festival: 'Food & Wine Festival',
          weather: {
            tempMaxF: 86,
            tempMinF: 74,
            condition: 'partly-cloudy',
            precipProbability: 25,
          },
          allParks: [
            { park: 'Magic Kingdom', forecastIndex: 1.2, expectedAvgWaitMinutes: 38 },
            { park: 'EPCOT', forecastIndex: 0.8, expectedAvgWaitMinutes: 28 },
            { park: 'Hollywood Studios', forecastIndex: 1.4, expectedAvgWaitMinutes: 44 },
            { park: 'Animal Kingdom', forecastIndex: 0.7, expectedAvgWaitMinutes: 24 },
          ],
        },
      ],
    });

    renderScreen();

    await waitFor(() => {
      // 4-park comparison
      expect(screen.getByText('All parks on this day')).toBeTruthy();
      expect(screen.getByLabelText(/EPCOT: Level 4\/10/)).toBeTruthy();
      expect(screen.getByText('Hollywood Studios')).toBeTruthy();
      expect(screen.getByText('Animal Kingdom')).toBeTruthy();
      expect(screen.getByText('~28m wait')).toBeTruthy();

      // Park info extras
      expect(screen.getByText('Expected Standby Avg')).toBeTruthy();
      expect(screen.getByText('~38 min')).toBeTruthy();
      expect(screen.getByText(/⛅ 86° \/ 74° · 25% rain/)).toBeTruthy();
      expect(screen.getByText(/🎉 Food & Wine Festival/)).toBeTruthy();
    });

    // Pressing another park in the comparison card selects that park
    fireEvent.press(screen.getByLabelText(/EPCOT: Level 4\/10/));
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'GET',
        expect.stringContaining('&park=EPCOT'),
      );
    });
  });

  it('renders live tracking header and format when isLiveTracking is true', async () => {
    const today = new Date().toISOString().split('T')[0];
    mockApiRequest.mockResolvedValue({
      days: [
        {
          date: today,
          park: 'Magic Kingdom',
          forecastIndex: 6,
          observedIndex: 5,
          isLiveTracking: true,
          parkHours: { openTime: '2026-08-07T09:00:00Z', closeTime: '2026-08-07T22:00:00Z' },
          earlyEntry: false,
          extendedEvening: false,
          ticketedEvent: false,
        },
      ],
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Live tracking today')).toBeTruthy();
      expect(screen.getByText('We predicted 6/10 · tracking 5/10 so far ✓')).toBeTruthy();
    });
  });
});

describe('CrowdCalendarScreen — dark mode', () => {
  let queryClient: QueryClient;
  const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};
  /** Nearest host ancestor whose flattened style sets `key`. */
  function ancestorWith(node: ReactTestInstance, key: string): Record<string, unknown> {
    let cur: ReactTestInstance | null = node.parent;
    while (cur !== null) {
      if (typeof cur.type === 'string' && flat(cur)[key] !== undefined) {
        return flat(cur);
      }
      cur = cur.parent;
    }
    return {};
  }

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockApiRequest.mockReset();
    const today = new Date().toISOString().split('T')[0];
    mockApiRequest.mockResolvedValue({
      days: [
        {
          date: today,
          park: 'Magic Kingdom',
          forecastIndex: 1.2, // Level 6 — Moderate
          parkHours: { openTime: '2026-08-07T09:00:00Z', closeTime: '2026-08-07T22:00:00Z' },
          earlyEntry: true,
          extendedEvening: false,
          ticketedEvent: false,
          festival: 'Food & Wine Festival',
          allParks: [
            { park: 'Magic Kingdom', forecastIndex: 1.2, expectedAvgWaitMinutes: 38 },
            { park: 'EPCOT', forecastIndex: 0.4, expectedAvgWaitMinutes: 20 },
          ],
        },
      ],
    });
  });
  afterEach(resetTestScheme);

  function renderScreen() {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer>
          <CrowdCalendarScreen />
        </NavigationContainer>
      </QueryClientProvider>,
    );
  }

  it('(a)(b)(c) paints the screen, primary text, badges and the calendar theme with dark values', async () => {
    setTestScheme('dark');
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Day detail')).toBeTruthy();
    });

    // (a) the screen background behind the scroll body.
    expect(ancestorWith(screen.getByText('Day detail'), 'backgroundColor').backgroundColor).toBe(
      darkTheme.color.background,
    );
    // (b) primary text.
    expect(flat(screen.getByText('Moderate')).color).toBe(darkTheme.color.textPrimary);
    // (c) converted literals / role-converted reads.
    expect(flat(screen.getByText('Early Entry')).color).toBe(EVENT_BADGE.dark.earlyEntry);
    expect(flat(screen.getByText(/Food & Wine Festival/)).color).toBe(darkTheme.color.primaryFg);
    // The crowd scale is a mode-invariant data encoding (rule 3 V).
    const epcot = screen.getByLabelText(/EPCOT: Level 2\/10/);
    expect(
      ancestorWith(within(epcot).getByText('2/10'), 'backgroundColor').backgroundColor,
    ).toBe(CROWD_LEVEL.dark.quiet);
    // The Calendar receives the themed theme prop.
    const calendar = screen.UNSAFE_getByType(Calendar);
    expect(calendar.props.theme.calendarBackground).toBe(darkTheme.color.surface);
    expect(calendar.props.theme.monthTextColor).toBe(darkTheme.color.textPrimary);
    expect(calendar.props.theme.arrowColor).toBe(darkTheme.color.primaryFg);
  });

  it('park segmented control: the selected segment is raised above the `surfaceAlt` track and moves on press', async () => {
    setTestScheme('dark');
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Day detail')).toBeTruthy();
    });
    // The segment is the nearest host ancestor carrying the segment's own radius.
    const seg = (label: string) => ancestorWith(screen.getByText(label), 'borderRadius');

    expect(seg('All').backgroundColor).toBe(darkTheme.color.borderStrong);
    expect(seg('All').backgroundColor).not.toBe(darkTheme.color.surface);
    expect(seg('All').backgroundColor).not.toBe(darkTheme.color.surfaceAlt);
    expect(seg('MK').backgroundColor).toBeUndefined();
    expect(flat(screen.getByText('All')).color).toBe(darkTheme.color.primaryFg);

    fireEvent.press(screen.getByText('MK'));
    await waitFor(() => expect(seg('MK').backgroundColor).toBe(darkTheme.color.borderStrong));
    expect(seg('All').backgroundColor).toBeUndefined();
    expect(flat(screen.getByText('MK')).color).toBe(darkTheme.color.primaryFg);
  });

  it('keeps the light calendar theme unchanged and remounts the Calendar on a scheme switch', async () => {
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Day detail')).toBeTruthy();
    });
    expect(ancestorWith(screen.getByText('All'), 'borderRadius').backgroundColor).toBe('#ffffff');
    const lightCalendar = screen.UNSAFE_getByType(Calendar);
    expect(lightCalendar.props.theme.calendarBackground).toBe('transparent');
    expect(lightCalendar.props.theme.arrowColor).toBe('#5b2a86');
    expect(flat(screen.getByText('Early Entry')).color).toBe('#2e7d3a');

    setTestScheme('dark');

    const darkCalendar = screen.UNSAFE_getByType(Calendar);
    // `key={t.scheme}` gives a fresh instance (Calendar captures styles once at mount).
    expect(darkCalendar).not.toBe(lightCalendar);
    expect(darkCalendar.props.theme.calendarBackground).toBe(darkTheme.color.surface);
    expect(flat(screen.getByText('Early Entry')).color).toBe(EVENT_BADGE.dark.earlyEntry);
  });
});

