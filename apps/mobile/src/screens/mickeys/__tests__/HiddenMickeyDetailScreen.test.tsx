import React from 'react';
import { Alert, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MickeyDetailDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import HiddenMickeyDetailScreen from '../HiddenMickeyDetailScreen';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const Stack = createNativeStackNavigator();

const mockMickeyUnfound: MickeyDetailDTO = {
  id: 'm-100',
  clue1: 'Look at the gear pattern above the door',
  zone: 'queue',
  difficulty: 'medium',
  official: true,
  experienceId: 'exp-1',
  experienceName: 'Space Mountain',
  land: 'Tomorrowland',
  park: 'Magic Kingdom',
  hintLevel: 1,
  found: false,
  tripId: null,
  confidenceLabel: 'confirmed',
  communityVerified: false,
  friendsFoundCount: 2,
};

const mockMickeyFound: MickeyDetailDTO = {
  ...mockMickeyUnfound,
  clue2: 'It is on the third gear from the left',
  reveal: 'Exact coordinates on panel 4',
  hintLevel: 3,
  found: true,
  tripId: 'trip-abc',
};

function MockExperienceDetailScreen({ route }: any) {
  return <Text>{`ExperienceDetail:${route.params?.experienceId}`}</Text>;
}

function renderScreen(mickeyId = 'm-100') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="HiddenMickeyDetail"
            component={HiddenMickeyDetailScreen}
            initialParams={{ mickeyId }}
          />
          <Stack.Screen name="ExperienceDetail" component={MockExperienceDetailScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('HiddenMickeyDetailScreen (Tasks 10.4 & 10.10, Requirements 3.2, 3.3, 4.1, 4.5, 5.1, 7.1, 7.2, 11.5, 13.5, 13.6, 13.8, 13.12)', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it('renders progressive 3-step hint trail, friends found count, zone, and hint requests', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/mickeys/m-100') {
        return mockMickeyUnfound as never;
      }
      if (path === '/me/trips') {
        return [] as never;
      }
      if (path === '/me/mickeys/m-100/hint') {
        return { mickeyId: 'm-100', hintLevel: 2 } as never;
      }
      return {} as never;
    });

    renderScreen();

    expect(await screen.findByText('Look at the gear pattern above the door')).toBeTruthy();
    expect(screen.getByTestId('progressive-hint-trail')).toBeTruthy();
    expect(screen.getByText('Step 1 of 3 Unlocked')).toBeTruthy();
    expect(screen.getByText('2 friends found this!')).toBeTruthy();
    expect(screen.getByText('queue')).toBeTruthy();
    expect(screen.getByText('medium')).toBeTruthy();

    // Requests hint 2
    fireEvent.press(screen.getByLabelText('Need a hint?'));
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/me/mickeys/m-100/hint', { level: 2 });
    });

    // Requests reveal 3
    fireEvent.press(screen.getByLabelText('Show me'));
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/me/mickeys/m-100/hint', { level: 3 });
    });
  });

  it('navigates to ExperienceDetail when pressing View Venue on the hero card', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/mickeys/m-100') {
        return mockMickeyUnfound as never;
      }
      if (path === '/me/trips') {
        return [] as never;
      }
      return {} as never;
    });

    renderScreen();

    await screen.findByText('Look at the gear pattern above the door');

    fireEvent.press(screen.getByLabelText('View venue details'));

    expect(await screen.findByText('ExperienceDetail:exp-1')).toBeTruthy();
  });

  it('marks as found with trip selection and allows undoing find', async () => {
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (path === '/mickeys/m-100') {
        return mockMickeyUnfound as never;
      }
      if (path === '/me/trips') {
        return [
          {
            status: 'active',
            trips: [
              {
                id: 'trip-1',
                name: 'Spring Vacation',
                startDate: '2026-02-01',
                endDate: '2026-02-10',
              },
            ],
          },
        ] as never;
      }
      if (method === 'POST' && path === '/me/mickeys/m-100/find') {
        return {
          mickeyId: 'm-100',
          foundAt: '2026-02-01T12:00:00Z',
          foundOn: '2026-02-01',
          tripId: 'trip-1',
        } as never;
      }
      return {} as never;
    });

    renderScreen();

    await screen.findByText('Look at the gear pattern above the door');

    // Select trip
    const tripChip = await screen.findByLabelText('Link to trip Spring Vacation');
    fireEvent.press(tripChip);

    // Press I found it
    fireEvent.press(screen.getByLabelText('I found it'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/me/mickeys/m-100/find', {
        tripId: 'trip-1',
      });
    });
  });

  it('renders found state with All 3 Steps Unlocked badge and triggers undo mutation', async () => {
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (path === '/mickeys/m-100') {
        return mockMickeyFound as never;
      }
      if (path === '/me/trips') {
        return [] as never;
      }
      if (method === 'DELETE' && path === '/me/mickeys/m-100/find') {
        return { mickeyId: 'm-100', found: false } as never;
      }
      return {} as never;
    });

    renderScreen();

    expect(await screen.findByLabelText('Marked as found')).toBeTruthy();
    expect(screen.getByText('You found it!')).toBeTruthy();
    expect(screen.getByText('All 3 Steps Unlocked')).toBeTruthy();

    // Trigger undo
    fireEvent.press(screen.getByLabelText('Undo find'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('DELETE', '/me/mickeys/m-100/find');
    });
  });

  it('triggers Still there and Could not find it votes', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/mickeys/m-100') {
        return mockMickeyUnfound as never;
      }
      if (path === '/me/trips') {
        return [] as never;
      }
      if (path === '/me/mickeys/m-100/vote') {
        return { mickeyId: 'm-100', vote: 'there' } as never;
      }
      return {} as never;
    });

    renderScreen();

    await screen.findByText('Look at the gear pattern above the door');

    // Vote still there
    fireEvent.press(screen.getByLabelText('Vote still there'));
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('PUT', '/me/mickeys/m-100/vote', {
        vote: 'there',
      });
    });
    expect(await screen.findByText('Vote recorded: Still there')).toBeTruthy();

    // Vote couldn't find it
    fireEvent.press(screen.getByLabelText("Vote couldn't find it"));
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('PUT', '/me/mickeys/m-100/vote', {
        vote: 'gone',
      });
    });
    expect(await screen.findByText("Vote recorded: Couldn't find it")).toBeTruthy();
  });

  it('opens report dialog with warning and submits a report after confirmation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/mickeys/m-100') {
        return mockMickeyUnfound as never;
      }
      if (path === '/me/trips') {
        return [] as never;
      }
      if (path === '/mickeys/m-100/report') {
        return { id: 'rep-1', status: 'open' } as never;
      }
      return {} as never;
    });

    renderScreen();

    await screen.findByText('Look at the gear pattern above the door');

    // Open report dialog
    fireEvent.press(screen.getByLabelText('Report Hidden Mickey'));

    expect(await screen.findByText('Report Hidden Mickey')).toBeTruthy();
    expect(
      screen.getByText(/Reporting permanently hides this Mickey from your hunt/i),
    ).toBeTruthy();

    // Select reason
    fireEvent.press(screen.getByLabelText('Reason: Restricted Area'));

    // Tap Report & Hide button
    fireEvent.press(screen.getByLabelText('Submit report'));

    // Confirmation Alert shown
    expect(alertSpy).toHaveBeenCalledWith(
      'Report & Hide Mickey?',
      expect.stringContaining('permanently removed from your hunt'),
      expect.any(Array),
    );

    // Confirm report in Alert
    const confirmBtn = alertSpy.mock.calls[0]?.[2]?.find((b) => b.text === 'Report & Hide');
    expect(confirmBtn).toBeDefined();
    confirmBtn?.onPress?.();

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/mickeys/m-100/report', {
        reason: 'restricted_area',
        note: undefined,
      });
    });

    alertSpy.mockRestore();
  });
});
