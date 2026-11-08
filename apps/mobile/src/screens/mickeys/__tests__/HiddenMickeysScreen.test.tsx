import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MickeyListItemDTO, MickeySummaryDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import HiddenMickeysScreen from '../HiddenMickeysScreen';

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

const mockSummary: MickeySummaryDTO = {
  overall: { found: 15, total: 42 },
  byPark: [
    { park: 'Magic Kingdom', found: 10, total: 20 },
    { park: 'EPCOT', found: 3, total: 17 },
    { park: null, found: 2, total: 5 },
  ],
  community: { found: 4, total: 10 },
};

const mockItems: readonly MickeyListItemDTO[] = [
  {
    id: 'm1',
    clue1: 'Look closely at the gears on the clock',
    zone: 'queue',
    difficulty: 'medium',
    official: true,
    experienceId: 'exp-1',
    experienceName: 'Space Mountain',
    land: 'Tomorrowland',
    park: 'Magic Kingdom',
    hintLevel: 1,
    found: true,
    confidenceLabel: 'confirmed',
    communityVerified: false,
  },
  {
    id: 'm2',
    clue1: 'Hidden in the floral carpet pattern',
    zone: 'interior',
    difficulty: 'hard',
    official: true,
    experienceId: 'exp-2',
    experienceName: 'Grand Floridian Lobby',
    land: null,
    park: null,
    hintLevel: 1,
    found: false,
    confidenceLabel: 'possibly_removed',
    communityVerified: false,
  },
  {
    id: 'm3',
    clue1: 'Scratched onto the railing near exit',
    zone: 'exit',
    difficulty: 'easy',
    official: false,
    experienceId: 'exp-3',
    experienceName: 'Big Thunder Mountain',
    land: 'Frontierland',
    park: 'Magic Kingdom',
    hintLevel: 1,
    found: false,
    confidenceLabel: 'confirmed',
    communityVerified: true,
  },
  {
    id: 'm4',
    clue1: 'Glowing star cluster above the launch tunnel',
    zone: 'on_ride',
    difficulty: 'easy',
    official: true,
    experienceId: 'exp-1',
    experienceName: 'Space Mountain',
    land: 'Tomorrowland',
    park: 'Magic Kingdom',
    hintLevel: 1,
    found: false,
    confidenceLabel: 'confirmed',
    communityVerified: false,
  },
];

function renderScreen(initialParams?: any) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="HiddenMickeys"
            component={HiddenMickeysScreen}
            initialParams={initialParams}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('HiddenMickeysScreen (Tasks 10.3 & 10.10, Requirements 2.1, 2.2, 13.1, 13.4, 13.6, 13.7, 13.10, 13.11)', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (path === '/mickeys/summary') {
        return mockSummary as never;
      }
      if (method === 'POST' && path === '/me/mickeys/m2/hint') {
        return {
          ...mockItems[1],
          hintLevel: 2,
          clue2: 'Check the border petals near the elevator',
        } as never;
      }
      if (method === 'POST' && path === '/me/mickeys/m2/find') {
        return {
          mickeyId: 'm2',
          hintLevel: 1,
          foundAt: '2026-11-08T12:00:00Z',
          foundOn: '2026-11-08',
          tripId: null,
        } as never;
      }
      if (method === 'DELETE' && path === '/me/mickeys/m1/find') {
        return undefined as never;
      }
      if (path.startsWith('/mickeys')) {
        return { items: mockItems, nextCursor: null } as never;
      }
      return {} as never;
    });
  });

  it('renders summary progress card with percent & progress bar, items list, and possibly removed badge', async () => {
    renderScreen();

    // Summary progress card + percentage badge + progress bar + + Add pill button
    expect(await screen.findByText('15 / 42')).toBeTruthy();
    expect(screen.getByText('36%')).toBeTruthy();
    expect(screen.getByTestId('hunt-progress-bar')).toBeTruthy();
    expect(screen.getByText('+ Add')).toBeTruthy();
    expect(screen.getByText('Official (42)')).toBeTruthy();
    expect(screen.getByText('Community (10)')).toBeTruthy();
    expect(screen.getByText('All Parks 15/42')).toBeTruthy();
    expect(screen.getByText('Magic Kingdom 10/20')).toBeTruthy();
    expect(screen.getByText('Resorts 2/5')).toBeTruthy();

    // Items rendered
    expect(await screen.findByText('Look closely at the gears on the clock')).toBeTruthy();
    expect(screen.getByText('Hidden in the floral carpet pattern')).toBeTruthy();
    expect(screen.getByText('Scratched onto the railing near exit')).toBeTruthy();

    // Found badge on m1
    expect(screen.getByLabelText('Found')).toBeTruthy();

    // Badges on m2 & m3
    expect(screen.getByText('Possibly removed')).toBeTruthy();
    expect(screen.getByText('Community verified')).toBeTruthy();
    expect(screen.getByText('Community')).toBeTruthy();
  });

  it('filters by Zone pill: tapping Queue sends zone=queue, All sends no zone', async () => {
    renderScreen();

    await screen.findByText('Look closely at the gears on the clock');

    // Tap Queue zone pill
    fireEvent.press(screen.getByLabelText('Filter by Queue zone'));
    await waitFor(() => {
      const calls = mockApiRequest.mock.calls.filter((c) => c[1].startsWith('/mickeys'));
      const lastCall = calls[calls.length - 1]!;
      expect(lastCall[1]).toContain('zone=queue');
    });

    // Tap All zone pill
    fireEvent.press(screen.getByLabelText('Filter by all zones'));
    await waitFor(() => {
      const calls = mockApiRequest.mock.calls.filter((c) => c[1].startsWith('/mickeys'));
      const lastCall = calls[calls.length - 1]!;
      expect(lastCall[1]).not.toContain('zone=');
    });
  });

  it('composes park tab, found filter, and zone pill in the query params', async () => {
    renderScreen();

    await screen.findByText('Look closely at the gears on the clock');

    // Select Magic Kingdom tab
    fireEvent.press(screen.getByLabelText('Magic Kingdom'));

    // Select Unfound filter
    fireEvent.press(screen.getByLabelText('Found filter: unfound'));

    // Select Pre-show zone
    fireEvent.press(screen.getByLabelText('Filter by Pre-show zone'));

    await waitFor(() => {
      const calls = mockApiRequest.mock.calls.filter((c) => c[1].startsWith('/mickeys?'));
      const lastCall = calls[calls.length - 1]!;
      expect(lastCall[1]).toContain('park=Magic+Kingdom');
      expect(lastCall[1]).toContain('found=unfound');
      expect(lastCall[1]).toContain('zone=pre_show');
    });
  });

  it('Resorts tab requests areaType=Resort and resolves the null-park summary entry', async () => {
    renderScreen();

    await screen.findByText('Look closely at the gears on the clock');

    fireEvent.press(screen.getByLabelText('Resorts'));

    await waitFor(() => {
      const calls = mockApiRequest.mock.calls.filter((c) => c[1].startsWith('/mickeys?'));
      const lastCall = calls[calls.length - 1]!;
      expect(lastCall[1]).toContain('areaType=Resort');
      expect(lastCall[1]).not.toContain('park=');
    });

    // Summary card resolves the park === null entry (2 / 5 = 40%)
    expect(await screen.findByText('2 / 5')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText('Disney Resort Hotels found')).toBeTruthy();
  });

  it('search input sends q param when length >= 2', async () => {
    renderScreen();

    await screen.findByText('Look closely at the gears on the clock');

    fireEvent.changeText(screen.getByLabelText('Search Hidden Mickeys'), 'clock');

    await waitFor(() => {
      const calls = mockApiRequest.mock.calls.filter((c) => c[1].startsWith('/mickeys?'));
      const lastCall = calls[calls.length - 1]!;
      expect(lastCall[1]).toContain('q=clock');
    });
  });

  it('switches between All Mickeys and By Venue grouped view with Mickey k of N labels', async () => {
    renderScreen();

    await screen.findByText('Look closely at the gears on the clock');
    expect(screen.getByText('4 Hidden Mickeys')).toBeTruthy();

    // Switch to By Venue grouped mode
    fireEvent.press(screen.getByLabelText('View mode: By Venue'));

    expect(await screen.findByText('3 venues • 4 Mickeys')).toBeTruthy();
    expect(screen.getByTestId('venue-group-exp-1')).toBeTruthy();
    expect(screen.getByText('Magic Kingdom • Tomorrowland • 2 Hidden Mickeys')).toBeTruthy();
    expect(screen.getByText('1/2 Spotted')).toBeTruthy();
    expect(screen.getByText('Mickey 1 of 2')).toBeTruthy();
    expect(screen.getByText('Mickey 2 of 2')).toBeTruthy();

    // Switch back to All Mickeys card mode
    fireEvent.press(screen.getByLabelText('View mode: All Mickeys'));
    expect(await screen.findByText('4 Hidden Mickeys')).toBeTruthy();
  });

  it('swaps between Official and Community scopes from the Hero Card scope pills', async () => {
    renderScreen();

    await screen.findByText('Look closely at the gears on the clock');

    // Tap Community pill inside Hero Card -> sends scope=community
    fireEvent.press(screen.getByTestId('hero-scope-community'));
    await waitFor(() => {
      const calls = mockApiRequest.mock.calls.filter((c) => c[1].startsWith('/mickeys?'));
      const lastCall = calls[calls.length - 1]!;
      expect(lastCall[1]).toContain('scope=community');
    });
    expect(screen.getByText('Community Hunt')).toBeTruthy();
    expect(screen.getByText('4 / 10')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText('All Parks 4/10')).toBeTruthy();

    // Tap Official pill inside Hero Card -> sends scope=official
    fireEvent.press(screen.getByTestId('hero-scope-official'));
    await waitFor(() => {
      const calls = mockApiRequest.mock.calls.filter((c) => c[1].startsWith('/mickeys?'));
      const lastCall = calls[calls.length - 1]!;
      expect(lastCall[1]).toContain('scope=official');
    });
    expect(screen.getByText('Official Hunt')).toBeTruthy();
    expect(screen.getByText('15 / 42')).toBeTruthy();
    expect(screen.getByText('36%')).toBeTruthy();
    expect(screen.getByText('All Parks 15/42')).toBeTruthy();
  });

  it('supports 1-tap Spot and Undo directly from list cards', async () => {
    renderScreen();

    await screen.findByText('Hidden in the floral carpet pattern');

    // Tap Spot on unfound item m2
    fireEvent.press(screen.getByTestId('spot-toggle-m2'));
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/me/mickeys/m2/find', {
        tripId: undefined,
      });
    });

    // Tap Found on already-found item m1 to undo
    fireEvent.press(screen.getByTestId('spot-toggle-m1'));
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('DELETE', '/me/mickeys/m1/find');
    });
  });

  it('requests Hint_Level 2 and toggles Clue_2 inline when pressing Need a closer hint?', async () => {
    renderScreen();

    await screen.findByText('Hidden in the floral carpet pattern');

    // Request closer hint inline on m2
    fireEvent.press(screen.getByTestId('peek-hint-m2'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('POST', '/me/mickeys/m2/hint', { level: 2 });
    });

    expect(await screen.findByTestId('inline-hint-box-m2')).toBeTruthy();
    expect(screen.getByText('Closer Hint')).toBeTruthy();
    expect(screen.getByText('Check the border petals near the elevator')).toBeTruthy();
    expect(screen.getByText('Hide closer hint')).toBeTruthy();

    // Tap again to collapse inline hint
    fireEvent.press(screen.getByTestId('peek-hint-m2'));
    await waitFor(() => {
      expect(screen.queryByTestId('inline-hint-box-m2')).toBeNull();
    });
  });
});
