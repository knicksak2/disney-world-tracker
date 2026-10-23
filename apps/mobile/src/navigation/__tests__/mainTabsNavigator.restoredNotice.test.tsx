/**
 * `MainTabsNavigator` mounts `AccountRestoredNotice` as the FIRST child of a
 * flex container above the real bottom-tab navigator (account-deletion R4.9,
 * R1.14; tasks.md 14.3).
 *
 * The real `MainTabsNavigator` and the real bottom-tab navigator render. Only the
 * five tab destinations (Home, the three stacks, the FAB) are replaced with
 * inert stubs, because they are not under test and pull in dozens of network
 * hooks; nothing is mocked in the notice, the session store or the navigator.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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

jest.mock('../../env/notifications', () => ({
  __esModule: true,
  loadNotifications: () => null,
}));

// Only the network layer is mocked: the chained tests below drive the real LoginScreen.
jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

function mockStub(testID: string): { __esModule: true; default: () => unknown } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native') as typeof import('react-native');
  function Stub(): unknown {
    return R.createElement(View, { testID });
  }
  return { __esModule: true, default: Stub };
}

jest.mock('../../screens/home/HomeScreen', () => mockStub('home-stub'));
jest.mock('../ExploreStack', () => mockStub('explore-stub'));
jest.mock('../TripsStack', () => mockStub('trips-stub'));
jest.mock('../CollectionStack', () => mockStub('collection-stub'));
jest.mock('../../screens/quickAction/MagicFab', () => mockStub('fab-stub'));
jest.mock('../../components/pins/useClaimablePinsBadge', () => ({
  __esModule: true,
  useClaimablePinsBadge: () => ({ count: 0 }),
}));

import { MainTabsNavigator } from '../RootNavigator';
import AccountRestoredNotice, {
  ACCOUNT_RESTORED_MESSAGE,
} from '../../components/AccountRestoredNotice';
import LoginScreen from '../../screens/LoginScreen';
import { apiRequest as mockedApiRequest } from '../../api/client';
import { useSessionStore } from '../../state/sessionStore';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function renderTabs() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <MainTabsNavigator />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('MainTabsNavigator and the restored notice', () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    useSessionStore.setState(useSessionStore.getInitialState(), true);
    useSessionStore.setState({ token: 'tok', hydrated: true });
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  afterEach(() => announce.mockRestore());

  it('with the flag set, the banner is the FIRST child of the container, above the tabs', () => {
    useSessionStore.setState({ accountRestoredNotice: true });
    renderTabs();

    const root = screen.getByTestId('main-tabs-root');
    const first = root.children[0] as ReactTestInstance;
    expect(first.type).toBe(AccountRestoredNotice);
    // The banner host element lives inside that first child, and the tab navigator is a later sibling.
    expect(first.findAll((n) => n.props.testID === 'account-restored-notice').length).toBeGreaterThan(0);
    expect(root.children[1]).toBeDefined();
    expect((root.children[1] as ReactTestInstance).type).not.toBe(AccountRestoredNotice);
    expect(screen.getByTestId('account-restored-notice-text')).toHaveTextContent(
      ACCOUNT_RESTORED_MESSAGE,
    );
    // The real tab navigator renders beneath it.
    expect(screen.getByTestId('home-stub')).toBeTruthy();
    expect(root.children.length).toBeGreaterThan(1);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(ACCOUNT_RESTORED_MESSAGE);
  });

  it('without the flag no banner is rendered and nothing is announced', () => {
    renderTabs();

    expect(screen.queryByTestId('account-restored-notice')).toBeNull();
    expect(screen.getByTestId('home-stub')).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
  });

  it('dismissing removes it and it does not come back when the store changes again', () => {
    useSessionStore.setState({ accountRestoredNotice: true });
    renderTabs();

    fireEvent.press(screen.getByTestId('account-restored-notice-dismiss'));
    expect(screen.queryByTestId('account-restored-notice')).toBeNull();
    expect(useSessionStore.getState().accountRestoredNotice).toBe(false);

    act(() => {
      useSessionStore.setState({ hydrated: false });
    });
    expect(screen.queryByTestId('account-restored-notice')).toBeNull();
    expect(announce).toHaveBeenCalledTimes(1);
  });
});

describe('sign-in response to restored banner, end to end (R4.3, R4.9)', () => {
  const SESSION_BODY = {
    user: { id: 'u-1', email: 'mickey@example.com' },
    profile: { displayName: 'Mickey' },
    token: 'fresh-token',
  };
  let announce: jest.SpyInstance;

  /** The signed-in/out switch the real RootNavigator makes on `token`. */
  function Gate(): JSX.Element {
    const token = useSessionStore((s) => s.token);
    if (token === null) {
      return <LoginScreen navigation={{ navigate: jest.fn() } as never} route={{} as never} />;
    }
    return (
      <NavigationContainer>
        <MainTabsNavigator />
      </NavigationContainer>
    );
  }

  function renderGate() {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <Gate />
      </QueryClientProvider>,
    );
  }

  async function signIn(): Promise<void> {
    fireEvent.changeText(screen.getByTestId('login-email'), 'mickey@example.com');
    fireEvent.changeText(screen.getByTestId('login-password'), 'hunter2-correct');
    fireEvent.press(screen.getByTestId('login-submit'));
    await screen.findByTestId('main-tabs-root');
  }

  beforeEach(() => {
    apiRequestMock.mockReset();
    useSessionStore.setState(useSessionStore.getInitialState(), true);
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  afterEach(() => announce.mockRestore());

  it('a login response with accountRestored: true shows the banner first over the tabs, announced once, and dismiss removes it', async () => {
    apiRequestMock.mockResolvedValueOnce({ ...SESSION_BODY, accountRestored: true } as never);
    renderGate();

    await signIn();

    expect(apiRequestMock).toHaveBeenCalledWith('POST', '/auth/login', {
      email: 'mickey@example.com',
      password: 'hunter2-correct',
    });
    const root = screen.getByTestId('main-tabs-root');
    expect((root.children[0] as ReactTestInstance).type).toBe(AccountRestoredNotice);
    expect(await screen.findByTestId('account-restored-notice-text')).toHaveTextContent(
      ACCOUNT_RESTORED_MESSAGE,
    );
    expect(screen.getByTestId('home-stub')).toBeTruthy();
    expect(announce).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('account-restored-notice-dismiss'));
    expect(screen.queryByTestId('account-restored-notice')).toBeNull();
  });

  it('a login response without accountRestored shows no banner', async () => {
    apiRequestMock.mockResolvedValueOnce(SESSION_BODY as never);
    renderGate();

    await signIn();

    expect(screen.queryByTestId('account-restored-notice')).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it('regression: an undismissed restored banner does NOT reappear on a later ordinary login', async () => {
    apiRequestMock.mockResolvedValueOnce({ ...SESSION_BODY, accountRestored: true } as never);
    renderGate();
    await signIn();
    expect(await screen.findByTestId('account-restored-notice')).toBeTruthy();

    // Log out WITHOUT dismissing: the gate unmounts the tabs and shows sign-in again.
    await act(async () => {
      await useSessionStore.getState().clearToken();
    });
    await screen.findByTestId('login-body');
    expect(screen.queryByTestId('main-tabs-root')).toBeNull();

    // A plain login (no accountRestored) must not inherit the old banner.
    apiRequestMock.mockResolvedValueOnce({ ...SESSION_BODY, token: 'second-token' } as never);
    await signIn();

    expect(useSessionStore.getState().token).toBe('second-token');
    expect(screen.queryByTestId('account-restored-notice')).toBeNull();
    expect(announce).toHaveBeenCalledTimes(1);
  });
});
