import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('../../../env/notifications', () => ({
  __esModule: true,
  loadNotifications: () => null,
}));

import SettingsScreen from '../SettingsScreen';
import YouAndCrewStack, {
  type YouAndCrewStackParamList,
} from '../../../navigation/YouAndCrewStack';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { useSessionStore } from '../../../state/sessionStore';
import { useThemeStore } from '../../../state/themeStore';
import { DEFAULT_APPEARANCE_PREFERENCE } from '../../../theme/appearance';
import { darkTheme, lightTheme } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { useOnboardingPreviewStore } from '../../onboarding/onboardingPreviewStore';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const Stack = createNativeStackNavigator<YouAndCrewStackParamList>();

function DummyScreen({ testID }: { readonly testID: string }): JSX.Element {
  return <View testID={testID} />;
}

function YouAndCrewMainStub(): JSX.Element {
  return <DummyScreen testID="screen-you-and-crew" />;
}
function BlockedUsersStub(): JSX.Element {
  return <DummyScreen testID="screen-blocked-users" />;
}
function FeedbackStub(): JSX.Element {
  return <DummyScreen testID="screen-feedback" />;
}
function DeleteAccountStub(): JSX.Element {
  return <DummyScreen testID="screen-delete-account" />;
}
function OnboardingStub({ route }: any): JSX.Element {
  return <DummyScreen testID={`screen-onboarding-${route?.params?.mode ?? 'none'}`} />;
}
function MainTabsStub({ route }: any): JSX.Element {
  return <DummyScreen testID={`screen-tabs-${route?.params?.screen ?? 'none'}`} />;
}

interface OnboardingStub {
  readonly needsOnboarding: boolean;
  readonly completedAt: string | null;
  readonly skippedAt: string | null;
  readonly initialIntent: 'plan' | 'in_park' | 'track_history' | 'explore' | null;
  readonly selectedPark: 'Magic Kingdom' | 'EPCOT' | 'Hollywood Studios' | 'Animal Kingdom' | null;
  readonly starterChecklistDismissedAt: string | null;
  readonly checklist: {
    readonly loggedFirstExperience: boolean;
    readonly starredFavorite: boolean;
    readonly hasTrip: boolean;
    readonly claimedPin: boolean;
  };
  readonly showStarterChecklist: boolean;
}

describe('SettingsScreen', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    apiRequestMock.mockReset();
    useSessionStore.setState({ token: 'token-abc', hydrated: true });
    useThemeStore.setState({ preference: DEFAULT_APPEARANCE_PREFERENCE, hydrated: false });
    useOnboardingPreviewStore.getState().dismissStarterChecklistPreview();
  });

  afterEach(() => {
    resetTestScheme();
  });

  function setupApi(overrides?: { onboardingResponse?: OnboardingStub }): void {
    const onboardingData: OnboardingStub = overrides?.onboardingResponse ?? {
      needsOnboarding: false,
      completedAt: '2026-11-18T00:00:00Z',
      skippedAt: null,
      initialIntent: 'explore',
      selectedPark: null,
      starterChecklistDismissedAt: null,
      checklist: {
        loggedFirstExperience: true,
        starredFavorite: false,
        hasTrip: false,
        claimedPin: false,
      },
      showStarterChecklist: false,
    };
    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (path === '/me/notification-preferences' && method === 'GET') {
        return { pushNotificationsEnabled: true } as never;
      }
      if (path === '/me/notification-preferences' && method === 'PUT') {
        return { pushNotificationsEnabled: false } as never;
      }
      if (path === '/me/onboarding' && method === 'GET') {
        return onboardingData as never;
      }
      if (path === '/me/onboarding' && method === 'PATCH') {
        return {
          ...onboardingData,
          starterChecklistDismissedAt: null,
          showStarterChecklist: true,
        } as never;
      }
      if (path === '/auth/logout' && method === 'POST') {
        return null as never;
      }
      return {} as never;
    });
  }

  function renderSettings(
    navRef?: ReturnType<typeof createNavigationContainerRef<any>>,
    initialRouteName: keyof YouAndCrewStackParamList = 'Settings',
  ) {
    return render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer ref={navRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRouteName}>
            <Stack.Screen name="YouAndCrewMain" component={YouAndCrewMainStub} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="BlockedUsers" component={BlockedUsersStub} />
            <Stack.Screen name="Feedback" component={FeedbackStub} />
            <Stack.Screen name="DeleteAccount" component={DeleteAccountStub} />
            <Stack.Screen name={'OnboardingFlow' as any} component={OnboardingStub} />
            <Stack.Screen name={'MainTabs' as any} component={MainTabsStub} />
          </Stack.Navigator>
        </NavigationContainer>
      </QueryClientProvider>,
    );
  }

  it('renders grouped sections, controls, links, disclaimer, and executes logout', async () => {
    setupApi();
    renderSettings();

    expect(await screen.findByTestId('settings-screen')).toBeTruthy();
    expect(await screen.findByTestId('notification-preference-switch')).toBeTruthy();
    expect(screen.getByText('Preferences')).toBeTruthy();
    expect(screen.getByText('Account & Safety')).toBeTruthy();
    expect(screen.getByText('Help & Legal')).toBeTruthy();
    expect(screen.getByTestId('appearance-preference-control')).toBeTruthy();
    expect(screen.getByTestId('change-password-open')).toBeTruthy();
    expect(screen.getByTestId('blocked-users-entry-button')).toBeTruthy();
    expect(screen.getByTestId('settings-app-tour-btn')).toBeTruthy();
    expect(screen.getByTestId('feedback-entry-button')).toBeTruthy();
    expect(screen.getByTestId('you-and-crew-terms-of-service-card')).toBeTruthy();
    expect(screen.getByTestId('terms-of-service-entry-button')).toBeTruthy();
    expect(screen.getByTestId('privacy-policy-entry-button')).toBeTruthy();
    expect(screen.getByTestId('delete-account-entry-button')).toBeTruthy();
    expect(screen.getByTestId('you-and-crew-legal-disclaimer')).toBeTruthy();

    fireEvent.press(screen.getByTestId('you-and-crew-logout'));
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/auth/logout');
      expect(useSessionStore.getState().token).toBeNull();
    });
  });

  it('navigates to BlockedUsers, Feedback, DeleteAccount, and back to YouAndCrewMain', async () => {
    setupApi();
    const navRef = createNavigationContainerRef<YouAndCrewStackParamList>();
    renderSettings(navRef, 'YouAndCrewMain');
    await screen.findByTestId('screen-you-and-crew');

    act(() => {
      navRef.navigate('Settings');
    });
    await screen.findByTestId('settings-screen');
    await screen.findByTestId('notification-preference-switch');

    fireEvent.press(screen.getByTestId('blocked-users-entry-button'));
    await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('BlockedUsers'));
    act(() => {
      navRef.goBack();
    });

    fireEvent.press(await screen.findByTestId('feedback-entry-button'));
    await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('Feedback'));
    act(() => {
      navRef.goBack();
    });

    fireEvent.press(await screen.findByTestId('delete-account-entry-button'));
    await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('DeleteAccount'));
    act(() => {
      navRef.goBack();
    });

    fireEvent.press(await screen.findByTestId('settings-back-button'));
    await waitFor(() => expect(navRef.getCurrentRoute()?.name).toBe('YouAndCrewMain'));
  });

  it('opens hosted Terms of Service and Privacy Policy links', async () => {
    setupApi();
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      renderSettings();
      await screen.findByTestId('notification-preference-switch');

      fireEvent.press(screen.getByTestId('terms-of-service-entry-button'));
      expect(openUrlSpy).toHaveBeenCalledWith('http://test.local/terms');

      fireEvent.press(screen.getByTestId('privacy-policy-entry-button'));
      expect(openUrlSpy).toHaveBeenCalledWith('http://test.local/privacy');
    } finally {
      openUrlSpy.mockRestore();
    }
  });

  it('supports App Tour replay and conditional Start Here checklist restore', async () => {
    setupApi({
      onboardingResponse: {
        needsOnboarding: false,
        completedAt: '2026-11-18T00:00:00Z',
        skippedAt: null,
        initialIntent: 'plan',
        selectedPark: null,
        starterChecklistDismissedAt: '2026-11-18T01:00:00Z',
        checklist: {
          loggedFirstExperience: true,
          starredFavorite: false,
          hasTrip: true,
          claimedPin: false,
        },
        showStarterChecklist: false,
      },
    });
    const navRef = createNavigationContainerRef<YouAndCrewStackParamList>();
    renderSettings(navRef);
    await screen.findByTestId('notification-preference-switch');

    const restoreBtn = await screen.findByTestId('settings-restore-starter-btn');
    fireEvent.press(restoreBtn);
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PATCH', '/me/onboarding', {
        restoreStarterChecklist: true,
      });
    });

    fireEvent.press(screen.getByTestId('settings-app-tour-btn'));
    expect(await screen.findByTestId('screen-onboarding-replay')).toBeTruthy();
  });

  it('hides restore checklist row when not dismissed', async () => {
    setupApi();
    renderSettings();
    await screen.findByTestId('notification-preference-switch');
    await screen.findByTestId('settings-app-tour-btn');
    expect(screen.queryByTestId('settings-restore-starter-btn')).toBeNull();
  });

  it('paints from dark theme and live-repaints when Appearance changes', async () => {
    setTestScheme('dark');
    setupApi();
    const { unmount } = renderSettings();
    const darkRoot = await screen.findByTestId('settings-screen');
    await screen.findByTestId('notification-preference-switch');
    expect(StyleSheet.flatten(darkRoot.props.style).backgroundColor).toBe(
      darkTheme.color.background,
    );
    unmount();

    resetTestScheme();
    setupApi();
    renderSettings();
    const root = await screen.findByTestId('settings-screen');
    await screen.findByTestId('notification-preference-switch');
    expect(StyleSheet.flatten(root.props.style).backgroundColor).toBe(
      lightTheme.color.background,
    );

    fireEvent.press(screen.getByTestId('appearance-option-dark'));

    await waitFor(() => {
      expect(useThemeStore.getState().preference).toBe('dark');
    });
    expect(screen.getByTestId('settings-screen')).toBe(root);
    expect(StyleSheet.flatten(root.props.style).backgroundColor).toBe(
      darkTheme.color.background,
    );
  });

  describe('Developer preview gating (__DEV__)', () => {
    it('renders and operates developer onboarding previews when __DEV__ is true', async () => {
      const g = global as unknown as { __DEV__: boolean };
      const originalDev = g.__DEV__;
      g.__DEV__ = true;
      try {
        setupApi();
        renderSettings();
        await screen.findByTestId('notification-preference-switch');

        expect(await screen.findByTestId('settings-dev-section')).toBeTruthy();
        const starterBtn = screen.getByTestId('settings-preview-starter-btn');
        expect(screen.getByText('Preview Start Here Checklist on Home')).toBeTruthy();

        fireEvent.press(starterBtn);
        expect(useOnboardingPreviewStore.getState().previewStarterChecklist).toBe(true);
        expect(await screen.findByTestId('screen-tabs-Home')).toBeTruthy();

        useOnboardingPreviewStore.getState().dismissStarterChecklistPreview();
        renderSettings();
        await screen.findByTestId('notification-preference-switch');
        fireEvent.press(await screen.findByTestId('settings-onboarding-preview-btn'));
        expect(await screen.findByTestId('screen-onboarding-preview')).toBeTruthy();
      } finally {
        g.__DEV__ = originalDev;
      }
    });

    it('omits developer onboarding previews completely when __DEV__ is false', async () => {
      const g = global as unknown as { __DEV__: boolean };
      const originalDev = g.__DEV__;
      g.__DEV__ = false;
      try {
        setupApi();
        renderSettings();
        await screen.findByTestId('notification-preference-switch');
        await screen.findByTestId('settings-app-tour-btn');

        expect(screen.queryByTestId('settings-dev-section')).toBeNull();
        expect(screen.queryByTestId('settings-onboarding-preview-btn')).toBeNull();
        expect(screen.queryByTestId('settings-preview-starter-btn')).toBeNull();
      } finally {
        g.__DEV__ = originalDev;
      }
    });
  });

  it('registers the real Settings route inside YouAndCrewStack', async () => {
    setupApi();
    render(
      <QueryClientProvider client={queryClient}>
        <NavigationContainer
          initialState={{
            routes: [{ name: 'Settings' }],
          }}
        >
          <YouAndCrewStack />
        </NavigationContainer>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('settings-screen')).toBeTruthy();
    expect(await screen.findByTestId('notification-preference-switch')).toBeTruthy();
  });
});
