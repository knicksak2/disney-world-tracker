/**
 * Notification_Center navigation / tab example tests (task 14.3).
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5
 *
 * These are example (not property) tests for the Profile-area entry point,
 * the unchanged bottom tab bar, and the Profile-tab Attention_Badge:
 *
 *   - **R10.1** — the bottom tab bar is unchanged: it presents exactly Home,
 *     Catalog, Trips, Friends, and Profile, with NO dedicated "Notifications"
 *     tab. The real `RootNavigator` is rendered inside a real
 *     `NavigationContainer` (mirroring `src/__tests__/navigation.test.tsx`) so
 *     the actual bottom-tab set is asserted from the rendered tab bar.
 *
 *   - **R10.2 / R10.5** — the `Profile_Notifications_Entry` on the Profile
 *     screen ("View notifications", testID `profile-open-notifications`) opens
 *     the Notification_Center. `ProfileScreen` is rendered (self mode) inside a
 *     minimal real stack whose `NotificationCenter` route is a sentinel; the
 *     screen's own `navigation.navigate('NotificationCenter')` is exercised for
 *     real and asserted by the sentinel appearing.
 *
 *   - **R10.3 / R10.4** — the Profile-tab badge reflects the count. The
 *     `AttentionBadge` component (the view rendered on the Profile tab) is
 *     tested directly across its three display modes: `'hidden'` renders
 *     nothing (count zero → no indicator, R10.4), `'count'` renders the exact
 *     count (R10.3), and `'overflow'` renders "99+".
 *
 * Mocking mirrors the sibling screen tests: `expo-secure-store` /
 * `expo-constants` / `apiRequest` are stubbed (the real `ApiError` and the
 * unauthorized-callback registry preserved). `useAttentionBadge` is stubbed for
 * the tab-bar render so the Profile tab icon does not fan out the four attention
 * reads (its count behavior is covered directly by the `AttentionBadge` tests
 * below), and `env/notifications` `loadNotifications` returns `null` so the
 * Profile screen's push-preference control no-ops its native permission probe.
 */

import React from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory replacement for `expo-secure-store`, matching the navigation suite.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __reset: () => {
      store.clear();
    },
  };
});

// `expo-constants` supplies the API base URL; a fake value keeps any defensive
// URL-resolution codepath from throwing (the `apiRequest` mock never resolves
// the URL itself).
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Stub `apiRequest`; keep the real `ApiError` and the unauthorized-callback
// registry so `RootNavigator`'s 401 wiring stays intact.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The Profile tab icon reads the four-domain badge via `useAttentionBadge`.
// The tab-bar structure test does not care about the count (that is covered by
// the direct `AttentionBadge` tests), so stub it to a hidden badge to avoid
// fanning out the real attention reads through the rendered navigator.
jest.mock('../../../features/notifications/useAttentionBadge', () => ({
  __esModule: true,
  useAttentionBadge: () => ({ display: 'hidden', count: 0 }),
}));

// `loadNotifications` is called by the Profile screen's push-preference control
// on mount; returning `null` takes the Expo Go / unsupported path so no native
// `expo-notifications` module is loaded during the test.
jest.mock('../../../env/notifications', () => ({
  __esModule: true,
  loadNotifications: () => null,
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import RootNavigator from '../../../navigation/RootNavigator';
import ProfileScreen from '../../ProfileScreen';
import { AttentionBadge } from '../../../features/notifications/AttentionBadge';
import { useSessionStore } from '../../../state/sessionStore';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Render the real `RootNavigator` inside a real `NavigationContainer`. */
function renderApp(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

/**
 * Render `ProfileScreen` (self mode) inside a minimal real native stack whose
 * `NotificationCenter` route renders a sentinel, so the screen's real
 * `navigation.navigate('NotificationCenter')` can be asserted by the sentinel
 * appearing.
 */
const Stack = createNativeStackNavigator();

function NotificationCenterSentinel(): JSX.Element {
  return <View testID="notification-center-sentinel" />;
}

function renderProfile(): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="ProfileMain" component={ProfileScreen} />
          <Stack.Screen
            name="NotificationCenter"
            component={NotificationCenterSentinel}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Notification_Center navigation / tab entry (R10.1, R10.2, R10.3, R10.4, R10.5)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState({ token: null, hydrated: true });
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();
  });

  // -------------------------------------------------------------------------
  // R10.1 — bottom tab bar unchanged, no Notifications tab
  // -------------------------------------------------------------------------
  test('R10.1: the bottom tab bar presents Home, Catalog, Trips, Friends, Profile and no Notifications tab', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/home/highest-rated') {
        return { entries: [] };
      }
      if (path === '/me') {
        return {
          user: { id: 'u1', email: 'u@x.test' },
          profile: { displayName: 'U', avatarPreset: null },
        };
      }
      // The Home screen mounts <ActiveTripShortcut>, which reads GET /me/trips
      // and calls `.find` on the response. Return a valid (empty) grouped-trips
      // array so the shortcut renders nothing rather than throwing on `{}` and
      // unmounting the tree.
      if (path === '/me/trips') {
        return [];
      }
      // No other read should be required to render the tab bar; answer any
      // stray call benignly rather than throwing.
      return {};
    });

    // A session token flips the navigator into the main tabs.
    useSessionStore.setState({ token: 'token-abc', hydrated: true });
    renderApp();

    // The five expected tabs render as tab-bar labels (React Navigation labels
    // each tab with its route name by default).
    await waitFor(() => {
      expect(screen.getAllByText('Home').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Catalog').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Trips').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Friends').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Profile').length).toBeGreaterThan(0);

    // There is NO dedicated Notifications tab in the bottom bar (R10.1).
    expect(screen.queryByText('Notifications')).toBeNull();
    expect(screen.queryByText('Notification Center')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R10.2 / R10.5 — Profile_Notifications_Entry opens the Notification_Center
  // -------------------------------------------------------------------------
  test('R10.2/R10.5: the Profile notifications entry navigates to the Notification_Center', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me') {
        return {
          user: { id: 'u1', email: 'u@x.test' },
          profile: { displayName: 'Mickey', avatarPreset: null },
        };
      }
      if (path === '/users/u1/profile') {
        return {
          userId: 'u1',
          displayName: 'Mickey',
          avatarPreset: null,
          overallCompletionPercent: 42.5,
        };
      }
      if (path === '/me/notification-preferences') {
        return { pushNotificationsEnabled: true };
      }
      return {};
    });

    useSessionStore.setState({ token: 'token-abc', hydrated: true });
    renderProfile();

    // The Profile_Notifications_Entry appears once the self-mode profile loads.
    const entry = await screen.findByTestId('profile-open-notifications');
    expect(entry).toBeTruthy();

    // The center is not open yet.
    expect(screen.queryByTestId('notification-center-sentinel')).toBeNull();

    fireEvent.press(entry);

    // Pressing the entry opens the Notification_Center (R10.2, R10.5).
    await waitFor(() => {
      expect(screen.getByTestId('notification-center-sentinel')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // R10.3 / R10.4 — Profile-tab badge reflects the count
  // -------------------------------------------------------------------------
  describe('R10.3/R10.4: the Profile-tab Attention_Badge reflects the count', () => {
    test("hidden display renders no indicator (count zero → nothing shown)", () => {
      render(
        <AttentionBadge display="hidden" count={0} testID="profile-tab-badge" />,
      );
      expect(screen.queryByTestId('profile-tab-badge')).toBeNull();
    });

    test('count display renders the exact count (1-99)', () => {
      render(
        <AttentionBadge display="count" count={7} testID="profile-tab-badge" />,
      );
      expect(screen.getByTestId('profile-tab-badge')).toBeTruthy();
      expect(screen.getByText('7')).toBeTruthy();

      // A boundary count of 99 still shows the exact value.
      screen.rerender(
        <AttentionBadge display="count" count={99} testID="profile-tab-badge" />,
      );
      expect(screen.getByText('99')).toBeTruthy();
    });

    test('overflow display renders "99+" (count of 100 or more)', () => {
      render(
        <AttentionBadge
          display="overflow"
          count={100}
          testID="profile-tab-badge"
        />,
      );
      expect(screen.getByTestId('profile-tab-badge')).toBeTruthy();
      expect(screen.getByText('99+')).toBeTruthy();
    });
  });
});
