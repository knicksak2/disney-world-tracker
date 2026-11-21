import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { apiRequest } from '../../../api/client';
import OnboardingFlowScreen from '../OnboardingFlowScreen';
import {
  markStarterChecklistPreviewDone,
  useOnboardingPreviewStore,
} from '../onboardingPreviewStore';

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

const SAMPLE_RIDES = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Space Mountain',
    park: 'Magic Kingdom',
    category: 'Ride',
    description: '',
    active: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Soarin\u2019 Around the World',
    park: 'EPCOT',
    category: 'Ride',
    description: '',
    active: true,
  },
];

function baseStateResponse(overrides?: Record<string, unknown>) {
  return {
    needsOnboarding: false,
    completedAt: '2026-11-18T00:00:00Z',
    skippedAt: null,
    initialIntent: 'explore',
    selectedPark: null,
    starterChecklistDismissedAt: null,
    checklist: {
      loggedFirstExperience: false,
      starredFavorite: false,
      hasTrip: false,
      claimedPin: false,
    },
    showStarterChecklist: true,
    ...overrides,
  };
}

function renderFlow(mode: 'firstRun' | 'replay' | 'preview' = 'firstRun') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
  };
  const route = {
    key: 'OnboardingFlow',
    name: 'OnboardingFlow' as const,
    params: { mode },
  };
  render(
    <QueryClientProvider client={client}>
      <OnboardingFlowScreen navigation={navigation as any} route={route as any} />
    </QueryClientProvider>,
  );
  return { navigation };
}

describe('OnboardingFlowScreen', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it('plan intent: creates a trip via POST /me/trips in Step 2 and opens TripDetail after Step 3', async () => {
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (method === 'POST' && path === '/me/trips') {
        return { id: 'trip-new-1' } as never;
      }
      if (method === 'PATCH' && path === '/me/onboarding') {
        return baseStateResponse({ initialIntent: 'plan' }) as never;
      }
      return {} as never;
    });

    const { navigation } = renderFlow('firstRun');

    expect(screen.getByTestId('onboarding-step-indicator')).toHaveTextContent('Step 1 of 3');
    fireEvent.press(screen.getByTestId('onboarding-intent-plan'));
    fireEvent.press(screen.getByTestId('onboarding-step1-continue'));

    expect(await screen.findByTestId('onboarding-step-2-plan')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('onboarding-trip-name-input'), 'Holiday Magic');
    fireEvent.press(screen.getByTestId('onboarding-step2-continue'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/me/trips',
        expect.objectContaining({
          name: 'Holiday Magic',
        }),
      );
    });

    expect(await screen.findByTestId('onboarding-step-3')).toBeTruthy();
    fireEvent.press(screen.getByTestId('onboarding-finish-btn'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/me/onboarding', {
        complete: true,
        initialIntent: 'plan',
      });
    });
    expect(navigation.navigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'Trips',
      params: { screen: 'TripDetail', params: { tripId: 'trip-new-1' } },
    });
  });

  it('plan intent skip-step link skips POST /me/trips and navigates to TripsList', async () => {
    mockApiRequest.mockResolvedValue(baseStateResponse({ initialIntent: 'plan' }) as never);
    const { navigation } = renderFlow('firstRun');

    fireEvent.press(screen.getByTestId('onboarding-intent-plan'));
    fireEvent.press(screen.getByTestId('onboarding-step1-continue'));

    fireEvent.press(await screen.findByTestId('onboarding-trip-skip-btn'));
    expect(await screen.findByTestId('onboarding-step-3')).toBeTruthy();

    fireEvent.press(screen.getByTestId('onboarding-finish-btn'));

    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('MainTabs', {
        screen: 'Trips',
        params: { screen: 'TripsList' },
      });
    });
    expect(mockApiRequest).not.toHaveBeenCalledWith('POST', '/me/trips', expect.anything());
  });

  it('in_park intent: shows park live averages, saves selectedPark, and opens LiveWaits', async () => {
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/parks/EPCOT/live') {
        return {
          park: 'EPCOT',
          entries: [
            { experienceId: 'e1', name: 'Remy', status: 'OPERATING', waitMinutes: 40 },
          ],
          retrievedAt: new Date().toISOString(),
          stale: false,
        } as never;
      }
      if (method === 'GET' && path.startsWith('/parks/')) {
        return { park: 'Magic Kingdom', entries: [], retrievedAt: new Date().toISOString(), stale: false } as never;
      }
      if (method === 'PATCH' && path === '/me/onboarding') {
        return baseStateResponse({ initialIntent: 'in_park', selectedPark: 'EPCOT' }) as never;
      }
      return {} as never;
    });

    const { navigation } = renderFlow('firstRun');
    fireEvent.press(screen.getByTestId('onboarding-intent-in_park'));
    fireEvent.press(screen.getByTestId('onboarding-step1-continue'));

    const epcotCard = await screen.findByTestId('onboarding-park-EPCOT');
    expect(await screen.findByText('40m avg wait')).toBeTruthy();
    fireEvent.press(epcotCard);
    fireEvent.press(screen.getByTestId('onboarding-step2-continue'));

    expect(await screen.findByTestId('onboarding-step-3')).toBeTruthy();
    fireEvent.press(screen.getByTestId('onboarding-finish-btn'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/me/onboarding', {
        complete: true,
        initialIntent: 'in_park',
        selectedPark: 'EPCOT',
      });
    });
    expect(navigation.navigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'Explore',
      params: { screen: 'LiveWaits', params: { park: 'EPCOT' } },
    });
  });

  it('track_history intent: selects rides, shows First Pin Ready banner, posts quick-completions, and finishes to Home', async () => {
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/catalog') {
        return { experiences: SAMPLE_RIDES } as never;
      }
      if (method === 'POST' && path === '/me/onboarding/quick-completions') {
        return {
          addedCount: 1,
          alreadyCompletedCount: 0,
          newlyAwardedPinIds: ['bronze_park_starter_magic_kingdom'],
        } as never;
      }
      if (method === 'PATCH' && path === '/me/onboarding') {
        return baseStateResponse({ initialIntent: 'track_history' }) as never;
      }
      return {} as never;
    });

    const { navigation } = renderFlow('firstRun');
    fireEvent.press(screen.getByTestId('onboarding-intent-track_history'));
    fireEvent.press(screen.getByTestId('onboarding-step1-continue'));

    const spaceCard = await screen.findByTestId(
      'onboarding-ride-11111111-1111-4111-8111-111111111111',
    );
    expect(screen.queryByTestId('onboarding-first-pin-banner')).toBeNull();
    fireEvent.press(spaceCard);

    expect(screen.getByTestId('onboarding-rides-count')).toHaveTextContent('1 selected');
    expect(screen.getByTestId('onboarding-first-pin-banner')).toHaveTextContent(
      /First Pin Ready!/,
    );

    fireEvent.press(screen.getByTestId('onboarding-step2-continue'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/me/onboarding/quick-completions',
        expect.objectContaining({
          experienceIds: ['11111111-1111-4111-8111-111111111111'],
        }),
      );
    });

    expect(await screen.findByTestId('onboarding-step3-pin-awarded')).toBeTruthy();
    expect(screen.getByText('Quick Actions')).toBeTruthy();
    expect(screen.getByTestId('onboarding-fab-icon').props.name).toBe('sparkles');
    expect(screen.queryByText(/MagicFab/i)).toBeNull();
    fireEvent.press(screen.getByTestId('onboarding-finish-btn'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/me/onboarding', {
        complete: true,
        initialIntent: 'track_history',
      });
    });
    expect(navigation.navigate).toHaveBeenCalledWith('MainTabs', { screen: 'Home' });
  });

  it('explore intent with 0 rides selected skips quick-completions and still finishes', async () => {
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/catalog') {
        return { experiences: SAMPLE_RIDES } as never;
      }
      if (method === 'PATCH' && path === '/me/onboarding') {
        return baseStateResponse({ initialIntent: 'explore' }) as never;
      }
      return {} as never;
    });

    const { navigation } = renderFlow('firstRun');
    fireEvent.press(screen.getByTestId('onboarding-intent-explore'));
    fireEvent.press(screen.getByTestId('onboarding-step1-continue'));

    await screen.findByTestId('onboarding-step-2-rides');
    fireEvent.press(screen.getByTestId('onboarding-step2-continue'));

    expect(await screen.findByTestId('onboarding-step-3')).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalledWith(
      'POST',
      '/me/onboarding/quick-completions',
      expect.anything(),
    );

    fireEvent.press(screen.getByTestId('onboarding-finish-btn'));
    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('MainTabs', { screen: 'Home' });
    });
  });

  it('Skip calls PATCH /me/onboarding { skip: true } and navigates to Home', async () => {
    mockApiRequest.mockResolvedValue(
      baseStateResponse({ skippedAt: '2026-11-18T00:00:00Z' }) as never,
    );
    const { navigation } = renderFlow('firstRun');

    fireEvent.press(screen.getByTestId('onboarding-skip-btn'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', '/me/onboarding', {
        skip: true,
      });
    });
    expect(navigation.navigate).toHaveBeenCalledWith('MainTabs', { screen: 'Home' });
  });

  it('replay mode renders Step 3 Tab Map only, closes via goBack, and triggers zero mutations', () => {
    const { navigation } = renderFlow('replay');

    expect(screen.getByTestId('onboarding-tab-map')).toBeTruthy();
    expect(screen.getByTestId('onboarding-map-row-home')).toBeTruthy();
    expect(screen.getByTestId('onboarding-map-row-explore')).toBeTruthy();
    expect(screen.getByTestId('onboarding-map-row-fab')).toBeTruthy();
    expect(screen.getByText('Quick Actions')).toBeTruthy();
    expect(screen.getByTestId('onboarding-fab-icon').props.name).toBe('sparkles');
    expect(screen.queryByText(/MagicFab/i)).toBeNull();
    expect(screen.getByTestId('onboarding-map-row-trips')).toBeTruthy();
    expect(screen.getByTestId('onboarding-map-row-you')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-step-1')).toBeNull();
    expect(screen.queryByTestId('onboarding-skip-btn')).toBeNull();

    fireEvent.press(screen.getByTestId('onboarding-replay-done-btn'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it('preview mode walks all 3 steps with Back support, zero API mutations, and enables StartHereCard preview repeatedly', async () => {
    useOnboardingPreviewStore.getState().dismissStarterChecklistPreview();
    mockApiRequest.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/catalog') {
        return { experiences: SAMPLE_RIDES } as never;
      }
      return {} as never;
    });

    const { navigation } = renderFlow('preview');
    expect(screen.getByTestId('onboarding-preview-banner')).toBeTruthy();

    // Try plan branch first, then hit Back to try track_history branch
    fireEvent.press(screen.getByTestId('onboarding-intent-plan'));
    fireEvent.press(screen.getByTestId('onboarding-step1-continue'));
    expect(screen.getByTestId('onboarding-step-2-plan')).toBeTruthy();

    fireEvent.press(screen.getByTestId('onboarding-preview-back-btn'));
    expect(screen.getByTestId('onboarding-step-1')).toBeTruthy();

    fireEvent.press(screen.getByTestId('onboarding-intent-track_history'));
    fireEvent.press(screen.getByTestId('onboarding-step1-continue'));
    await screen.findByTestId('onboarding-step-2-rides');

    const rideRow = await screen.findByTestId(`onboarding-ride-${SAMPLE_RIDES[0]!.id}`);
    fireEvent.press(rideRow);
    fireEvent.press(screen.getByTestId('onboarding-step2-continue'));

    expect(await screen.findByTestId('onboarding-step-3')).toBeTruthy();
    expect(screen.getByTestId('onboarding-step3-pin-awarded')).toBeTruthy();

    fireEvent.press(screen.getByTestId('onboarding-finish-btn'));

    // Zero POST/PATCH mutations occurred
    expect(mockApiRequest).not.toHaveBeenCalledWith('POST', expect.anything(), expect.anything());
    expect(mockApiRequest).not.toHaveBeenCalledWith('PATCH', expect.anything(), expect.anything());
    expect(navigation.navigate).toHaveBeenCalledWith('MainTabs', { screen: 'Home' });

    // StartHereCard preview flag is turned on and can be checked off, dismissed, and re-enabled
    expect(useOnboardingPreviewStore.getState().previewStarterChecklist).toBe(true);
    expect(useOnboardingPreviewStore.getState().previewChecklist.loggedFirstExperience).toBe(true);
    markStarterChecklistPreviewDone('starredFavorite');
    expect(useOnboardingPreviewStore.getState().previewChecklist.starredFavorite).toBe(true);
    markStarterChecklistPreviewDone('hasTrip');
    expect(useOnboardingPreviewStore.getState().previewStarterChecklist).toBe(true);
    markStarterChecklistPreviewDone('claimedPin');
    // Completing the 4th item auto-hides the preview card just like real new-user behavior
    expect(useOnboardingPreviewStore.getState().previewStarterChecklist).toBe(false);
    useOnboardingPreviewStore.getState().enableStarterChecklistPreview();
    expect(useOnboardingPreviewStore.getState().previewStarterChecklist).toBe(true);
    useOnboardingPreviewStore.getState().dismissStarterChecklistPreview();
  });
});
