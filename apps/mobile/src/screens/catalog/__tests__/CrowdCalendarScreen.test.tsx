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

  it('renders calendar and days', async () => {
    mockApiRequest.mockResolvedValue({
      days: [
        {
          date: new Date().toISOString().split('T')[0],
          park: 'Magic Kingdom',
          forecastIndex: 1.2, // Level 6
          parkHours: { openTime: '2024-01-01T09:00:00Z', closeTime: '2024-01-01T22:00:00Z' },
          earlyEntry: true,
          extendedEvening: false,
          ticketedEvent: false,
        }
      ]
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('MK')).toBeTruthy(); // The park segment
    });
  });
});
