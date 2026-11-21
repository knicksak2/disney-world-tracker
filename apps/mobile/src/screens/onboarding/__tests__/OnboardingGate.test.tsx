import React from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import { apiRequest } from '../../../api/client';
import { useSessionStore } from '../../../state/sessionStore';
import OnboardingGate from '../OnboardingGate';

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

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const Stack = createNativeStackNavigator();

function MainTabsStub(): JSX.Element {
  return (
    <View testID="main-tabs-stub">
      <OnboardingGate />
      <Text>MainTabs</Text>
    </View>
  );
}

function OnboardingFlowStub({
  route,
}: {
  readonly route?: { readonly params?: { readonly mode?: string } };
}): JSX.Element {
  return <Text testID="onboarding-flow-stub">{route?.params?.mode ?? 'none'}</Text>;
}

function renderWithNav() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs" component={MainTabsStub} />
          <Stack.Screen name="OnboardingFlow" component={OnboardingFlowStub} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('OnboardingGate', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    useSessionStore.setState({ token: 'tok-1', hydrated: true });
  });

  it('does not flash or navigate while GET /me/onboarding is loading', async () => {
    mockApiRequest.mockImplementation(
      () => new Promise(() => undefined) as Promise<never>,
    );

    renderWithNav();

    expect(await screen.findByTestId('main-tabs-stub')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-flow-stub')).toBeNull();
  });

  it('gracefully allows MainTabs without throwing when GET /me/onboarding fails', async () => {
    mockApiRequest.mockRejectedValue(new Error('network down'));

    renderWithNav();

    expect(await screen.findByTestId('main-tabs-stub')).toBeTruthy();
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('GET', '/me/onboarding');
    });
    expect(screen.queryByTestId('onboarding-flow-stub')).toBeNull();
  });

  it('navigates to OnboardingFlow in firstRun mode when needsOnboarding is true', async () => {
    mockApiRequest.mockResolvedValue({
      needsOnboarding: true,
      completedAt: null,
      skippedAt: null,
      initialIntent: null,
      selectedPark: null,
      starterChecklistDismissedAt: null,
      checklist: {
        loggedFirstExperience: false,
        starredFavorite: false,
        hasTrip: false,
        claimedPin: false,
      },
      showStarterChecklist: true,
    } as never);

    renderWithNav();

    const stub = await screen.findByTestId('onboarding-flow-stub');
    expect(stub).toHaveTextContent('firstRun');
  });

  it('never triggers OnboardingFlow for veterans (needsOnboarding: false)', async () => {
    mockApiRequest.mockResolvedValue({
      needsOnboarding: false,
      completedAt: null,
      skippedAt: null,
      initialIntent: null,
      selectedPark: null,
      starterChecklistDismissedAt: null,
      checklist: {
        loggedFirstExperience: true,
        starredFavorite: false,
        hasTrip: false,
        claimedPin: false,
      },
      showStarterChecklist: false,
    } as never);

    renderWithNav();

    expect(await screen.findByTestId('main-tabs-stub')).toBeTruthy();
    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('GET', '/me/onboarding');
    });
    expect(screen.queryByTestId('onboarding-flow-stub')).toBeNull();
  });

  it('safely no-ops when rendered outside a NavigationContainer', () => {
    mockApiRequest.mockResolvedValue({
      needsOnboarding: true,
      completedAt: null,
      skippedAt: null,
      initialIntent: null,
      selectedPark: null,
      starterChecklistDismissedAt: null,
      checklist: {
        loggedFirstExperience: false,
        starredFavorite: false,
        hasTrip: false,
        claimedPin: false,
      },
      showStarterChecklist: true,
    } as never);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    expect(() =>
      render(
        <QueryClientProvider client={client}>
          <OnboardingGate />
        </QueryClientProvider>,
      ),
    ).not.toThrow();
  });
});
