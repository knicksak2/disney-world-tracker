import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { darkTheme, lightTheme } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';

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

// Feature: dark-mode — per-batch test (d): a mounted FlatList row repaints live
// on a scheme switch, without a remount (Property 20's B7 instance).
describe('FriendsListScreen — dark mode', () => {
  const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
    (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') {
        return { ...FRIENDS_RESPONSE, outgoingRequests: [] };
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });
  afterEach(resetTestScheme);

  test('(d) a rendered FlatList friend row repaints to the dark values without remounting', async () => {
    renderWithClient(
      <FriendsListScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{} as never}
      />,
    );

    const row = await screen.findByTestId(`friends-friend-${FRIEND.userId}`);
    const nameNode = within(row).getByText('Minnie Mouse');
    const initialNode = within(row).getByText('M');
    // Light: today's values.
    expect(flat(nameNode).color).toBe(lightTheme.color.textPrimary);
    expect(flat(initialNode).color).toBe('#5b2a86');

    setTestScheme('dark');

    // Same mounted row (no remount), now painted with the dark values.
    expect(screen.getByTestId(`friends-friend-${FRIEND.userId}`)).toBe(row);
    expect(flat(within(row).getByText('Minnie Mouse')).color).toBe(darkTheme.color.textPrimary);
    // Placeholder initial: `primary` as text → primaryFg (rule 1a).
    expect(flat(within(row).getByText('M')).color).toBe(darkTheme.color.primaryFg);
    // Section header (a separate FlatList row component) also repaints.
    expect(flat(screen.getByText('Friends (1)')).color).toBe(darkTheme.color.textSecondary);
  });

  test('(a)(b) the screen root and a friend name use the dark tokens when mounted in dark', async () => {
    setTestScheme('dark');
    renderWithClient(
      <FriendsListScreen
        navigation={{ navigate: jest.fn() } as never}
        route={{} as never}
      />,
    );
    await screen.findByTestId(`friends-friend-${FRIEND.userId}`);
    expect(flat(screen.root).backgroundColor).toBe(darkTheme.color.background);
    expect(flat(screen.getByText('Minnie Mouse')).color).toBe(darkTheme.color.textPrimary);
  });
});
