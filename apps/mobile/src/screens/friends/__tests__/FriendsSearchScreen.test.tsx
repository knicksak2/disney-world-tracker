import React from 'react';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { darkTheme } from '../../../theme/theme';
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

jest.mock('../../../hooks/useDebounce', () => ({
  __esModule: true,
  useDebounce: <T,>(v: T): T => v,
  default: <T,>(v: T): T => v,
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import FriendsSearchScreen from '../FriendsSearchScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const EXISTING_FRIEND = {
  userId: 'friend-101',
  displayName: 'Mickey Mouse',
  avatarPreset: null,
  establishedAt: '2024-01-01T00:00:00Z',
};

const OUTGOING_REQUEST = {
  id: 'req-outgoing-1',
  otherUserId: 'user-outgoing-202',
  otherDisplayName: 'Donald Duck',
  createdAt: '2024-01-02T00:00:00Z',
};

const INCOMING_REQUEST = {
  id: 'req-incoming-1',
  otherUserId: 'user-incoming-303',
  otherDisplayName: 'Goofy Goof',
  createdAt: '2024-01-03T00:00:00Z',
};

const FRIENDS_RESPONSE = {
  friends: [EXISTING_FRIEND],
  incomingRequests: [INCOMING_REQUEST],
  outgoingRequests: [OUTGOING_REQUEST],
};

const SEARCH_RESULTS = {
  results: [
    {
      id: 'friend-101',
      displayName: 'Mickey Mouse',
      email: 'mickey@disney.test',
    },
    {
      id: 'user-outgoing-202',
      displayName: 'Donald Duck',
      email: 'donald@disney.test',
    },
    {
      id: 'user-incoming-303',
      displayName: 'Goofy Goof',
      email: 'goofy@disney.test',
    },
    {
      id: 'user-new-404',
      displayName: 'Daisy Duck',
      email: 'daisy@disney.test',
    },
  ],
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

describe('FriendsSearchScreen', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/friends') {
        return FRIENDS_RESPONSE;
      }
      if (typeof path === 'string' && path.startsWith('/users/search?q=')) {
        return SEARCH_RESULTS;
      }
      if (method === 'POST' && path === '/me/friend-requests') {
        return {
          id: 'req-new-1',
          senderId: 'me-1',
          recipientId: 'user-new-404',
          createdAt: '2024-01-04T00:00:00Z',
        };
      }
      throw new Error(`unexpected call to ${String(method)} ${String(path)}`);
    });
  });

  test('renders idle state when search input is empty', async () => {
    renderWithClient(<FriendsSearchScreen />);
    expect(screen.getByTestId('friends-search-idle')).toBeTruthy();
    expect(screen.getByText('Find your friends')).toBeTruthy();
  });

  test('displays previously added friends as Added (disabled) and pending/new appropriately', async () => {
    renderWithClient(<FriendsSearchScreen />);

    const input = screen.getByTestId('friends-search-input');
    fireEvent.changeText(input, 'disney');

    // Wait for search results
    await screen.findByText('Mickey Mouse');

    // Results list must persist taps so tapping "Send request" works on first tap
    expect(
      screen.getByTestId('friends-search-results-list').props.keyboardShouldPersistTaps,
    ).toBe('handled');

    // 1. Previously added friend: Mickey Mouse
    expect(screen.getByText('Mickey Mouse')).toBeTruthy();
    const addedBtn = screen.getByTestId(`friends-added-${EXISTING_FRIEND.userId}`);
    expect(addedBtn).toBeTruthy();
    expect(screen.getByText('Added')).toBeTruthy();
    // Cannot send request: send button does not exist for Mickey
    expect(screen.queryByTestId(`friends-send-${EXISTING_FRIEND.userId}`)).toBeNull();

    // 2. Pending outgoing request: Donald Duck
    expect(screen.getByText('Donald Duck')).toBeTruthy();
    const sentBtn = screen.getByTestId(`friends-send-${OUTGOING_REQUEST.otherUserId}`);
    expect(sentBtn).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();

    // 3. Pending incoming request: Goofy Goof
    expect(screen.getByText('Goofy Goof')).toBeTruthy();
    const pendingBtn = screen.getByTestId(`friends-send-${INCOMING_REQUEST.otherUserId}`);
    expect(pendingBtn).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();

    // 4. Non-friend: Daisy Duck
    expect(screen.getByText('Daisy Duck')).toBeTruthy();
    const sendBtn = screen.getByTestId('friends-send-user-new-404');
    expect(sendBtn).toBeTruthy();
    expect(screen.getByText('Send request')).toBeTruthy();
  });

  test('allows sending a friend request to a non-friend and transitions to Sent', async () => {
    renderWithClient(<FriendsSearchScreen />);

    const input = screen.getByTestId('friends-search-input');
    fireEvent.changeText(input, 'daisy');

    const sendBtn = await screen.findByTestId('friends-send-user-new-404');
    fireEvent.press(sendBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/friend-requests', {
        recipientId: 'user-new-404',
      });
    });

    // After success, button displays Sent
    await waitFor(() => {
      expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
    });
  });

  test('does not send request when pressing Added on an existing friend', async () => {
    renderWithClient(<FriendsSearchScreen />);

    const input = screen.getByTestId('friends-search-input');
    fireEvent.changeText(input, 'mickey');

    const addedBtn = await screen.findByTestId(`friends-added-${EXISTING_FRIEND.userId}`);
    fireEvent.press(addedBtn);

    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'POST',
      '/me/friend-requests',
      expect.anything(),
    );
  });

  test('displays inline error when send request mutation fails', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/friends') {
        return FRIENDS_RESPONSE;
      }
      if (typeof path === 'string' && path.startsWith('/users/search?q=')) {
        return SEARCH_RESULTS;
      }
      if (method === 'POST' && path === '/me/friend-requests') {
        throw new ApiError({
          code: 'friend_duplicate_relationship',
          status: 400,
          message: 'Already friends',
        });
      }
      throw new Error(`unexpected call to ${String(method)} ${String(path)}`);
    });

    renderWithClient(<FriendsSearchScreen />);

    const input = screen.getByTestId('friends-search-input');
    fireEvent.changeText(input, 'daisy');

    const sendBtn = await screen.findByTestId('friends-send-user-new-404');
    fireEvent.press(sendBtn);

    await screen.findByRole('alert');
    expect(
      screen.getByText(
        'You\u2019re already connected with this user or have a pending request.',
      ),
    ).toBeTruthy();
  });
});

// Feature: dark-mode — the converted screen follows the Active theme.
describe('FriendsSearchScreen — dark mode', () => {
  const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
    (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') return FRIENDS_RESPONSE;
      if (typeof path === 'string' && path.startsWith('/users/search?q=')) {
        return SEARCH_RESULTS;
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });
  afterEach(resetTestScheme);

  test('(a)(b)(c) background, result name, and the themed search input use dark values', async () => {
    setTestScheme('dark');
    renderWithClient(<FriendsSearchScreen />);

    // (a) root ScreenContainer.
    expect(flat(screen.root).backgroundColor).toBe(darkTheme.color.background);

    // (c) the search TextInput's native props follow the scheme.
    const input = screen.getByTestId('friends-search-input');
    expect(input.props.placeholderTextColor).toBe(darkTheme.color.textSecondary);
    expect(input.props.keyboardAppearance).toBe('dark');
    expect(flat(input).color).toBe(darkTheme.color.textPrimary);

    fireEvent.changeText(input, 'disney');
    // (b) a result row's primary text.
    const name = await screen.findByText('Mickey Mouse');
    expect(flat(name).color).toBe(darkTheme.color.textPrimary);
    expect(flat(screen.getByText('mickey@disney.test')).color).toBe(
      darkTheme.color.textSecondary,
    );
  });

  test('light keeps today\u2019s keyboard appearance and placeholder colour', () => {
    renderWithClient(<FriendsSearchScreen />);
    const input = screen.getByTestId('friends-search-input');
    expect(input.props.keyboardAppearance).toBe('light');
    expect(input.props.placeholderTextColor).toBe('#6b6480');
  });
});
