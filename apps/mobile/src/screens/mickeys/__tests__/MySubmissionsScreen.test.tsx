import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MickeySubmissionDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import MySubmissionsScreen from '../MySubmissionsScreen';

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

const mockSubmissions: readonly MickeySubmissionDTO[] = [
  {
    id: 'sub-1',
    status: 'approved',
    official: false,
    communityVerified: true,
    clue1: 'Look at the gear pattern in queue',
    experienceName: 'Space Mountain',
    reviewNote: null,
    createdAt: '2026-02-01T12:00:00Z',
  },
  {
    id: 'sub-2',
    status: 'pending',
    official: false,
    communityVerified: false,
    clue1: 'Pattern on the rock wall',
    experienceName: 'Big Thunder Mountain',
    reviewNote: 'Awaiting human review due to retryable screen error',
    createdAt: '2026-02-02T12:00:00Z',
  },
  {
    id: 'sub-3',
    status: 'rejected',
    official: false,
    communityVerified: false,
    clue1: 'Sticker in backstage area',
    experienceName: 'Haunted Mansion',
    reviewNote: 'Not in a guest-accessible area',
    createdAt: '2026-02-03T12:00:00Z',
  },
  {
    id: 'sub-4',
    status: 'hidden',
    official: false,
    communityVerified: false,
    clue1: 'Coin arrangement on the sill',
    experienceName: 'Pirates of the Caribbean',
    reviewNote: null,
    createdAt: '2026-02-04T12:00:00Z',
  },
  {
    id: 'sub-5',
    status: 'retired',
    official: false,
    communityVerified: false,
    clue1: 'Shadow on old sign',
    experienceName: 'Splash Mountain',
    reviewNote: 'Attraction remodeled',
    createdAt: '2026-02-05T12:00:00Z',
  },
];

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="MySubmissions" component={MySubmissionsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('MySubmissionsScreen (Task 10.5, Requirements 9.1, 9.2, 15.5)', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it('renders submissions with all status badges, review notes, and community verified badge', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/mickeys/submissions') {
        return mockSubmissions as never;
      }
      return {} as never;
    });

    renderScreen();

    // Experiences and clues rendered
    expect(await screen.findByText('Space Mountain')).toBeTruthy();
    expect(screen.getByText('Look at the gear pattern in queue')).toBeTruthy();
    expect(screen.getByText('Big Thunder Mountain')).toBeTruthy();
    expect(screen.getByText('Haunted Mansion')).toBeTruthy();
    expect(screen.getByText('Pirates of the Caribbean')).toBeTruthy();
    expect(screen.getByText('Splash Mountain')).toBeTruthy();

    // Status badges
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('Pending Review')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(screen.getByText('Retired')).toBeTruthy();

    // Badges & review notes
    expect(screen.getByText('Community verified')).toBeTruthy();
    expect(screen.getByText('Review note: Awaiting human review due to retryable screen error')).toBeTruthy();
    expect(screen.getByText('Review note: Not in a guest-accessible area')).toBeTruthy();
    expect(screen.getByText('Review note: Attraction remodeled')).toBeTruthy();
  });

  it('renders empty state when user has no submissions', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/me/mickeys/submissions') {
        return [] as never;
      }
      return {} as never;
    });

    renderScreen();

    expect(await screen.findByText('No Submissions Yet')).toBeTruthy();
    expect(screen.getByText(/Have you found a Hidden Mickey in the parks/)).toBeTruthy();
  });
});
