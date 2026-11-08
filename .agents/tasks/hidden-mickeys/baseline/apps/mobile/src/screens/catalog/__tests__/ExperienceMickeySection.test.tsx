import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { MickeyListItemDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import ExperienceMickeySection from '../ExperienceMickeySection';

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

const mockItems: readonly MickeyListItemDTO[] = [
  {
    id: 'm1',
    clue1: 'Clue 1',
    zone: 'queue',
    difficulty: 'easy',
    official: true,
    experienceId: 'exp-land',
    experienceName: 'Living with the Land',
    land: 'Future World',
    park: 'EPCOT',
    found: true,
    hintLevel: 1,
    confidenceLabel: 'confirmed',
    communityVerified: false,
  },
  {
    id: 'm2',
    clue1: 'Clue 2',
    zone: 'on_ride',
    difficulty: 'medium',
    official: true,
    experienceId: 'exp-land',
    experienceName: 'Living with the Land',
    land: 'Future World',
    park: 'EPCOT',
    found: false,
    hintLevel: 1,
    confidenceLabel: 'confirmed',
    communityVerified: false,
  },
];

function renderSection(experienceId: string, navRef?: any) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer ref={navRef}>
        <Stack.Navigator>
          <Stack.Screen name="ExperienceDetail">
            {() => <ExperienceMickeySection experienceId={experienceId} />}
          </Stack.Screen>
          <Stack.Screen name="HiddenMickeys">
            {() => <></>}
          </Stack.Screen>
          <Stack.Screen name="SubmitMickey">
            {() => <></>}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('ExperienceMickeySection (Task 10.6, Requirements 13.2, 16.2)', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it('renders "N Hidden Mickeys here · you\'ve found M" card and navigates to HiddenMickeys with experienceId', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/mickeys/config') {
        return { enabled: true, submissionsEnabled: true } as never;
      }
      if (path.startsWith('/mickeys?experienceId=exp-glimmering')) {
        return { items: mockItems, nextCursor: null } as never;
      }
      return {} as never;
    });

    renderSection('exp-glimmering');

    const card = await screen.findByTestId('experience-mickeys-card');
    expect(card).toBeTruthy();
    expect(screen.getByText("2 Hidden Mickeys here · you've found 1")).toBeTruthy();

    fireEvent.press(card);

    // Assert query used the viewed experience id
    expect(mockApiRequest).toHaveBeenCalledWith(
      'GET',
      expect.stringContaining('/mickeys?experienceId=exp-glimmering'),
    );
  });

  it('renders quiet "Know one? Add it" link when experience has 0 Mickeys', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/mickeys/config') {
        return { enabled: true, submissionsEnabled: true } as never;
      }
      if (path.startsWith('/mickeys?experienceId=exp-empty')) {
        return { items: [], nextCursor: null } as never;
      }
      return {} as never;
    });

    renderSection('exp-empty');

    const link = await screen.findByTestId('experience-mickeys-quiet-link');
    expect(link).toBeTruthy();
    expect(screen.getByText('Know one? Add it')).toBeTruthy();
  });

  it('renders nothing when MICKEYS_ENABLED is false', async () => {
    mockApiRequest.mockImplementation(async (_method: string, path: string) => {
      if (path === '/mickeys/config') {
        return { enabled: false, submissionsEnabled: false } as never;
      }
      return { items: mockItems, nextCursor: null } as never;
    });

    renderSection('exp-glimmering');

    expect(screen.queryByTestId('experience-mickeys-card')).toBeNull();
    expect(screen.queryByTestId('experience-mickeys-quiet-link')).toBeNull();
  });
});
