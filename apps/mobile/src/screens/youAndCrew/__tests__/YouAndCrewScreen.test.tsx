/**
 * Component tests for YouAndCrewScreen.
 * (Task 10.3, Requirements 7.3, 7.4, design.md Section 6)
 *
 * Verifies:
 *   - Identity block rendering and display name editing via PATCH /me/profile
 *   - Shared items entry points (Inbox and Sent) navigate to respective screens
 *   - Friends list rendering, Find Friends navigation, and outgoing requests
 *   - Friend "Compare" button navigates to FriendProfile with initialSection: 'comparison'
 *   - Friend "Remove" button calls DELETE /me/friends/:userId
 *   - Empty state when no friends or outgoing requests
 *   - Settings and security controls render and logout triggers POST /auth/logout
 */

import React from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

jest.mock('../../../env/notifications', () => ({
  __esModule: true,
  loadNotifications: () => null,
}));

import YouAndCrewScreen from '../YouAndCrewScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { useSessionStore } from '../../../state/sessionStore';
import type { YouAndCrewStackParamList } from '../../../navigation/YouAndCrewStack';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const Stack = createNativeStackNavigator<YouAndCrewStackParamList>();

function DummyScreen({ testID }: { readonly testID: string }): JSX.Element {
  return <View testID={testID} />;
}

describe('YouAndCrewScreen (Requirements 7.3, 7.4)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    apiRequestMock.mockReset();
    useSessionStore.setState({ token: 'token-abc', hydrated: true });
  });

  const ME_RESPONSE = {
    user: { id: 'u1', email: 'mickey@disney.test' },
    profile: { displayName: 'Mickey Mouse', avatarPreset: null },
  };

  const PROFILE_RESPONSE = {
    userId: 'u1',
    displayName: 'Mickey Mouse',
    avatarPreset: null,
  };

  const FRIENDS_RESPONSE = {
    friends: [
      {
        userId: 'f1',
        displayName: 'Donald Duck',
        avatarPreset: null,
        establishedAt: '2024-01-01T00:00:00Z',
      },
      {
        userId: 'f2',
        displayName: 'Goofy',
        avatarPreset: null,
        establishedAt: '2024-01-02T00:00:00Z',
      },
    ],
    incomingRequests: [],
    outgoingRequests: [
      {
        id: 'out-1',
        otherUserId: 'f3',
        otherDisplayName: 'Pluto',
        createdAt: '2024-01-03T00:00:00Z',
      },
    ],
  };

  function setupApi(overrides?: {
    friendsResponse?: typeof FRIENDS_RESPONSE;
  }): void {
    const friendsData = overrides?.friendsResponse ?? FRIENDS_RESPONSE;
    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (path === '/me') {
        return ME_RESPONSE as never;
      }
      if (path === '/users/u1/profile') {
        return PROFILE_RESPONSE as never;
      }
      if (path === '/me/friends') {
        return friendsData as never;
      }
      if (path === '/me/profile' && method === 'PATCH') {
        return {
          userId: 'u1',
          displayName: 'Mickey Renamed',
          avatarPreset: null,
        } as never;
      }
      if (path === '/me/friends/f1' && method === 'DELETE') {
        return null as never;
      }
      if (path === '/auth/logout' && method === 'POST') {
        return null as never;
      }
      return {} as never;
    });
  }

  function renderScreen(navRef?: any) {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer ref={navRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="YouAndCrewMain" component={YouAndCrewScreen} />
            <Stack.Screen
              name="FriendProfile"
              component={() => <DummyScreen testID="screen-friend-profile" />}
            />
            <Stack.Screen
              name="FriendsSearch"
              component={() => <DummyScreen testID="screen-friends-search" />}
            />
            <Stack.Screen
              name="Inbox"
              component={() => <DummyScreen testID="screen-inbox" />}
            />
            <Stack.Screen
              name="Sent"
              component={() => <DummyScreen testID="screen-sent" />}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );
  }

  it('renders user identity block with display name and avatar placeholder', async () => {
    setupApi();
    renderScreen();

    const nameText = await screen.findByTestId('profile-display-name');
    expect(nameText).toHaveTextContent('Mickey Mouse');
    expect(screen.getByTestId('profile-avatar-placeholder')).toBeTruthy();
    expect(screen.getByTestId('header-eyebrow-pill')).toHaveTextContent('👤 Profile & Crew');
    expect(screen.getByText('CHANGE')).toBeTruthy();
  });

  it('toggles avatar picker grid when tapping avatar', async () => {
    setupApi();
    renderScreen();

    await screen.findByTestId('profile-display-name');
    const changeAvatarBtn = screen.getByTestId('change-avatar-button');
    fireEvent.press(changeAvatarBtn);

    expect(screen.getByTestId('avatar-picker-grid')).toBeTruthy();
  });

  it('allows editing display name via inline editor and calls PATCH /me/profile', async () => {
    setupApi();
    renderScreen();

    await screen.findByTestId('profile-display-name');

    const editButton = screen.getByTestId('edit-display-name-button');
    fireEvent.press(editButton);

    const input = screen.getByTestId('edit-display-name-input');
    fireEvent.changeText(input, 'Mickey Renamed');

    const saveButton = screen.getByTestId('save-display-name-button');
    fireEvent.press(saveButton);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PATCH', '/me/profile', {
        displayName: 'Mickey Renamed',
      });
    });
  });

  it('navigates to Inbox and Sent when shared cards are pressed', async () => {
    setupApi();
    const navRef = createNavigationContainerRef<YouAndCrewStackParamList>();
    renderScreen(navRef);

    await screen.findByTestId('profile-display-name');

    // Both cards take equal half-width (flex: 1)
    const inboxCard = screen.getByTestId('you-and-crew-inbox-card');
    const sentCard = screen.getByTestId('you-and-crew-sent-card');
    expect(StyleSheet.flatten(inboxCard.props.style).flex).toBe(1);
    expect(StyleSheet.flatten(sentCard.props.style).flex).toBe(1);

    // Tap Inbox
    const inboxBtn = screen.getByTestId('inbox-entry-button');
    fireEvent.press(inboxBtn);

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('Inbox');
    });

    // Go back and tap Sent
    navRef.goBack();
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('YouAndCrewMain');
    });

    const sentBtn = screen.getByTestId('sent-entry-button');
    fireEvent.press(sentBtn);

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('Sent');
    });
  });

  it('renders friends list, navigates to Find Friends, and renders outgoing requests', async () => {
    setupApi();
    const navRef = createNavigationContainerRef<YouAndCrewStackParamList>();
    renderScreen(navRef);

    await screen.findByText('Donald Duck');
    expect(screen.getByText('Goofy')).toBeTruthy();

    // Check outgoing requests
    expect(screen.getByText(/Outgoing Requests \(1\)/i)).toBeTruthy();
    expect(screen.getByText('Pluto')).toBeTruthy();

    // Tap Find Friends
    const findFriendsBtn = screen.getByTestId('find-friends-button');
    fireEvent.press(findFriendsBtn);

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('FriendsSearch');
    });
  });

  it('navigates to FriendProfile with comparison section when Compare is pressed', async () => {
    setupApi();
    const navRef = createNavigationContainerRef<YouAndCrewStackParamList>();
    renderScreen(navRef);

    await screen.findByText('Donald Duck');

    const compareBtn = screen.getByTestId('compare-friend-f1');
    fireEvent.press(compareBtn);

    await waitFor(() => {
      const route = navRef.getCurrentRoute();
      expect(route?.name).toBe('FriendProfile');
      expect(route?.params).toEqual({
        friendId: 'f1',
        displayName: 'Donald Duck',
        initialSection: 'comparison',
      });
    });
  });

  it('prompts confirmation when Remove is pressed and cancels without deleting', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    setupApi();
    renderScreen();

    await screen.findByText('Donald Duck');

    const removeBtn = screen.getByTestId('remove-friend-f1');
    fireEvent.press(removeBtn);

    expect(alertSpy).toHaveBeenCalledWith(
      'Remove Donald Duck?',
      expect.stringContaining('Are you sure you want to remove Donald Duck'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Remove', style: 'destructive' }),
      ]),
    );
    expect(apiRequestMock).not.toHaveBeenCalledWith('DELETE', '/me/friends/f1');
  });

  it('removes a friend when confirmed in the alert dialog', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirmButton = buttons?.find((b) => b.text === 'Remove');
      confirmButton?.onPress?.();
    });
    setupApi();
    renderScreen();

    await screen.findByText('Donald Duck');

    const removeBtn = screen.getByTestId('remove-friend-f1');
    fireEvent.press(removeBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', '/me/friends/f1');
    });
  });

  it('renders empty state when friends and outgoing requests are empty', async () => {
    setupApi({
      friendsResponse: {
        friends: [],
        incomingRequests: [],
        outgoingRequests: [],
      },
    });

    renderScreen();

    await screen.findByTestId('profile-display-name');
    expect(screen.getByTestId('friends-empty')).toBeTruthy();
    expect(screen.getByText('No friends yet')).toBeTruthy();
  });

  it('renders settings controls and executes logout', async () => {
    setupApi();
    renderScreen();

    await screen.findByTestId('profile-display-name');

    // Settings titles
    expect(screen.getByText('Push Notifications')).toBeTruthy();
    expect(screen.getByText('Account Security')).toBeTruthy();

    // Logout button
    const logoutBtn = screen.getByTestId('you-and-crew-logout');
    fireEvent.press(logoutBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/auth/logout');
      expect(useSessionStore.getState().token).toBeNull();
    });
  });

  it('omits redundant header settings shortcut and displays settings directly in content (Requirement 7.6)', async () => {
    setupApi();
    renderScreen();

    await screen.findByTestId('profile-display-name');
    expect(screen.queryByTestId('header-settings-button')).toBeNull();
    expect(screen.getByTestId('you-and-crew-settings-section')).toBeTruthy();
  });

  it('caps inline friends list to MAX_INLINE_FRIENDS (3) and toggles expansion (Requirement 7.7)', async () => {
    const manyFriends = [
      { userId: 'f1', displayName: 'Friend One', avatarPreset: null, establishedAt: '2024-01-01' },
      { userId: 'f2', displayName: 'Friend Two', avatarPreset: null, establishedAt: '2024-01-02' },
      { userId: 'f3', displayName: 'Friend Three', avatarPreset: null, establishedAt: '2024-01-03' },
      { userId: 'f4', displayName: 'Friend Four', avatarPreset: null, establishedAt: '2024-01-04' },
      { userId: 'f5', displayName: 'Friend Five', avatarPreset: null, establishedAt: '2024-01-05' },
    ];

    setupApi({
      friendsResponse: {
        friends: manyFriends,
        incomingRequests: [],
        outgoingRequests: [],
      },
    });

    renderScreen();

    // First 3 friends should be visible
    await screen.findByText('Friend One');
    expect(screen.getByText('Friend Two')).toBeTruthy();
    expect(screen.getByText('Friend Three')).toBeTruthy();

    // 4th and 5th friends should be capped
    expect(screen.queryByText('Friend Four')).toBeNull();
    expect(screen.queryByText('Friend Five')).toBeNull();

    // Toggle button should be displayed
    const toggleBtn = screen.getByTestId('toggle-all-friends-button');
    expect(toggleBtn).toHaveTextContent('Show all (5) friends \u25BE');

    // Tap to expand
    fireEvent.press(toggleBtn);
    expect(screen.getByText('Friend Four')).toBeTruthy();
    expect(screen.getByText('Friend Five')).toBeTruthy();
    expect(toggleBtn).toHaveTextContent('Show fewer');

    // Tap to collapse
    fireEvent.press(toggleBtn);
    expect(screen.queryByText('Friend Four')).toBeNull();
    expect(screen.queryByText('Friend Five')).toBeNull();
    expect(toggleBtn).toHaveTextContent('Show all (5) friends \u25BE');
  });
});
