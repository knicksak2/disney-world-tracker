import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { apiRequest } from '../../../api/client';
import CrowdCalendarScreen from '../CrowdCalendarScreen';

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
