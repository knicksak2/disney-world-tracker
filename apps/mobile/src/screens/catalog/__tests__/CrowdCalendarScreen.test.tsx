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
