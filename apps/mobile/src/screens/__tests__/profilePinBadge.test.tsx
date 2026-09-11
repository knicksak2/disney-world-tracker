/**
 * Profile-screen claimable-Pin badge test (pin-collection Requirement 22.3, 22.4).
 *
 * Mirrors the existing Profile_Notifications_Entry badge (`profile-notifications-badge`): the
 * "View your pins" entry on the Profile screen itself shows a small count badge whenever at
 * least one Pin is ready to claim, sourced from the same `['me','pins']` cache the Pin Board and
 * the Profile-tab icon read, so all three surfaces can never disagree.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

jest.mock('../../env/notifications', () => ({
  __esModule: true,
  loadNotifications: () => null,
}));

import ProfileScreen from '../ProfileScreen';
import { apiRequest as mockedApiRequest } from '../../api/client';
import { useSessionStore } from '../../state/sessionStore';
import { PINS, type PinBoardDTO, type UserPinProgressDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function readyProg(pinId: string): UserPinProgressDTO {
  return {
    pinId,
    unlocked: true,
    awardedAt: '2026-01-15T10:00:00.000Z',
    currentValue: null,
    targetValue: null,
    percentComplete: null,
    claimedAt: null,
  };
}

function boardOf(pins: UserPinProgressDTO[]): PinBoardDTO {
  return {
    pins,
    tierSummary: [],
    totalUnlocked: pins.filter((p) => p.unlocked).length,
    totalPins: pins.length,
    overallPercent: 0,
  };
}

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

const Stack = createNativeStackNavigator();

function renderProfile(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="ProfileMain" component={ProfileScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

function mockApi(board: PinBoardDTO): void {
  apiRequestMock.mockImplementation(async (_method: string, path: string) => {
    if (path === '/me') {
      return {
        user: { id: 'u1', email: 'u@x.test' },
        profile: { displayName: 'Mickey', avatarPreset: null },
      } as never;
    }
    if (path === '/users/u1/profile') {
      return {
        userId: 'u1',
        displayName: 'Mickey',
        avatarPreset: null,
        overallCompletionPercent: 42.5,
      } as never;
    }
    if (path === '/me/pins') return board as never;
    return {} as never;
  });
}

describe('Profile screen — claimable-Pin badge on "View your pins"', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState({ token: 'token-abc', hydrated: true });
  });

  it('shows the exact claimable count on the pin-collection entry', async () => {
    const pinId = PINS[0]!.id;
    mockApi(boardOf([readyProg(pinId)]));
    renderProfile();

    await screen.findByTestId('profile-view-pins');
    const badge = await screen.findByTestId('profile-pins-badge');
    expect(badge).toHaveTextContent('1');
  });

  it('hides the badge when no pin is ready to claim', async () => {
    mockApi(boardOf([]));
    renderProfile();

    await screen.findByTestId('profile-view-pins');
    expect(screen.queryByTestId('profile-pins-badge')).toBeNull();
  });
});
