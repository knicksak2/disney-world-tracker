import React from 'react';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import FriendsListScreen from '../FriendsListScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const FRIEND = {
  userId: 'friend-123',
  displayName: 'Minnie Mouse',
  avatarPreset: null,
  establishedAt: '2024-01-02T00:00:00Z',
};

const FRIENDS_RESPONSE = {
  friends: [FRIEND],
  incomingRequests: [],
  outgoingRequests: [],
};

function renderWithClient(ui: React.ReactElement): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <NavigationContainer>{ui}</NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('FriendsListScreen remove friend confirmation', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    jest.restoreAllMocks();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') {
        return FRIENDS_RESPONSE;
      }
      if (path === '/me/friends/friend-123') {
        return null;
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });

  test('prompts Alert.alert confirmation when Remove button is pressed and cancels without deleting', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    renderWithClient(
      <FriendsListScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{} as never}
      />,
    );

    const removeBtn = await screen.findByTestId(`friends-remove-${FRIEND.userId}`);
    fireEvent.press(removeBtn);

    expect(alertSpy).toHaveBeenCalledWith(
      'Remove Minnie Mouse?',
      expect.stringContaining('Are you sure you want to remove Minnie Mouse'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Remove', style: 'destructive' }),
      ]),
    );
    expect(apiRequestMock).not.toHaveBeenCalledWith('DELETE', '/me/friends/friend-123');
  });

  test('calls DELETE /me/friends/:userId when removal is confirmed in Alert', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirmButton = buttons?.find((b) => b.text === 'Remove');
      confirmButton?.onPress?.();
    });

    renderWithClient(
      <FriendsListScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{} as never}
      />,
    );

    const removeBtn = await screen.findByTestId(`friends-remove-${FRIEND.userId}`);
    fireEvent.press(removeBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', '/me/friends/friend-123');
    });
  });
});
