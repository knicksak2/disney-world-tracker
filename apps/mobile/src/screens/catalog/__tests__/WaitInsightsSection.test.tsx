import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WaitInsightsSection from '../WaitInsightsSection';
import { apiRequest } from '../../../api/client';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

describe('WaitInsightsSection', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    mockApiRequest.mockReset();
  });

  function renderSection(experienceId: string) {
    return render(
      <QueryClientProvider client={queryClient}>
        <WaitInsightsSection experienceId={experienceId} />
      </QueryClientProvider>
    );
  }

  const baseResponse = {
    experienceId: '123',
    p50WaitMinutes: 45,
    p90WaitMinutes: 60,
    cv: 0.2,
    bestHour: 9,
    worstHour: 14,
    escalationRate: 2.0,
    downRate: 0.05,
    llSelloutMedianHour: 13,
    sampleCount: 50,
    hasSingleRider: false,
    waits: [
      { hour: 9, predictedWaitMinutes: 10 },
      { hour: 14, predictedWaitMinutes: 80 }
    ]
  };

  it('renders high confidence rope-drop verdict for a steep morning climb, plus LL price', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/trips')) return { trips: [] };
      if (url.includes('/wait-insights')) {
        return {
          ...baseResponse,
          escalationRate: 25, // steep positive minute delta -> rope drop favorable
          llMultipassPriceCents: 1500
        };
      }
      throw new Error('Unknown url');
    });

    renderSection('123');

    await waitFor(() => {
      // Prescriptive high confidence verdict for rope drop
      expect(screen.getByText('Rope drop')).toBeTruthy();
      expect(screen.getByText('Sells out ~1 PM')).toBeTruthy();
      expect(screen.getByText('$15 at peak')).toBeTruthy();
    });
  });

  it('does NOT treat a shallow escalation as rope drop (minute delta, not a ratio)', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/trips')) return { trips: [] };
      if (url.includes('/wait-insights')) {
        return {
          ...baseResponse,
          escalationRate: 2, // a 2-minute climb must NOT trigger rope drop
        };
      }
      throw new Error('Unknown url');
    });

    renderSection('123');

    await waitFor(() => {
      // High confidence + no steep climb -> prescriptive best-hour verdict, not rope drop
      expect(screen.getByText('Ride around 9 AM')).toBeTruthy();
    });
    expect(screen.queryByText('Rope drop')).toBeNull();
  });

  it('renders single rider helper when available', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/trips')) return { trips: [] };
      if (url.includes('/wait-insights')) {
        return {
          ...baseResponse,
          hasSingleRider: true,
          singleRiderP50WaitMinutes: 15
        };
      }
      throw new Error('Unknown url');
    });

    renderSection('123');

    await waitFor(() => {
      expect(screen.getByText('Single Rider')).toBeTruthy();
      expect(screen.getByText('saves ~30 min')).toBeTruthy(); // 45 - 15 = 30
    });
  });

  it('renders low confidence soft verdict and early estimate chip', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/trips')) return { trips: [] };
      if (url.includes('/wait-insights')) {
        return {
          ...baseResponse,
          sampleCount: 5, // low confidence
          bestHour: 18,
          escalationRate: 1.0 // don't trigger rope drop
        };
      }
      throw new Error('Unknown url');
    });

    renderSection('123');

    await waitFor(() => {
      expect(screen.getByText('Early Estimate')).toBeTruthy();
      expect(screen.getByText('Evenings are usually calmer')).toBeTruthy();
    });
  });

  it('refetches on context switch', async () => {
    mockApiRequest.mockImplementation(async (_method, url) => {
      if (url.includes('/trips')) return { trips: [] };
      if (url.includes('/wait-insights')) {
        if (url.includes('date=')) {
          // This is a "Now" or "Trip" request with a specific date
          return {
            ...baseResponse,
            waits: [{ hour: 10, predictedWaitMinutes: 50 }]
          };
        } else {
          // Typical request has no date param
          return {
            ...baseResponse,
            waits: [{ hour: 11, predictedWaitMinutes: 99 }]
          };
        }
      }
      throw new Error('Unknown url');
    });

    renderSection('123');

    // Default is "Now", which provides a date
    await waitFor(() => {
      expect(screen.getAllByText('10 AM').length).toBeGreaterThan(0); // from the Now waits (hour 10)
    });

    // Switch to "Typical"
    fireEvent.press(screen.getByText('Typical'));

    await waitFor(() => {
      expect(screen.getAllByText('11 AM').length).toBeGreaterThan(0); // from the Typical waits (hour 11)
    });
  });
});
