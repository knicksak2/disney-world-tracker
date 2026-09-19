/**
 * Claimable-Pin badge and collection entry tests (pin-collection Requirement 22.3, 22.4, navigation-redesign Requirement 6.1, 6.4).
 *
 * Tests that CollectionScreen displays the claimable Pin badge when pins are ready to claim,
 * hides it when zero, and provides the Food & Dining entry point.
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

import CollectionScreen from '../collection/CollectionScreen';
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
    totalPins: PINS.length,
    overallPercent: 0,
  };
}

const Stack = createNativeStackNavigator();

function renderCollection(): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="CollectionHome" component={CollectionScreen} />
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
    if (path === '/me/pins') return board as never;
    return {} as never;
  });
}

describe('Collection screen — claimable-Pin badge on Pins & Badges card', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState({ token: 'token-abc', hydrated: true });
  });

  it('shows the exact claimable count on the pin-collection entry', async () => {
    const pinId = PINS[0]!.id;
    mockApi(boardOf([readyProg(pinId)]));
    renderCollection();

    await screen.findByTestId('collection-pins-card');
    const badge = await screen.findByTestId('claimable-pins-badge');
    expect(badge).toHaveTextContent('1 to claim');
  });

  it('hides the badge when no pin is ready to claim', async () => {
    mockApi(boardOf([]));
    renderCollection();

    await screen.findByTestId('collection-pins-card');
    expect(screen.queryByTestId('claimable-pins-badge')).toBeNull();
  });

  it('renders Food & Dining card on CollectionScreen (Requirement 6.1)', async () => {
    mockApi(boardOf([]));
    renderCollection();

    const btn = await screen.findByTestId('food-entry-button');
    expect(btn).toBeTruthy();
  });
});
