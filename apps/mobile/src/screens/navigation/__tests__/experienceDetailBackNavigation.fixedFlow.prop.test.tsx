/**
 * Fixed-flow property test — Property 1 (Back Returns To Originating Screen)
 * for the Experience Detail back-navigation bugfix (spec:
 * experience-detail-back-navigation, Task 4).
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 *   (Property 1 — for any non-Catalog origin, opening the detail then pressing
 *    the themed back control returns to that exact originating screen.)
 *
 * This mounts the REAL production navigator (`RootNavigator` → `RootStack`
 * hosting `MainTabs` above `ExperienceDetail`, with the real `MainTabs`,
 * `CatalogStack`, and `FriendsStack`) once per generated origin and returns by
 * pressing the REAL themed back control in the detail header (the
 * `GradientHeader` button labelled "Go back" that calls `navigation.goBack()`).
 * Only the lowest-level `apiRequest` is mocked; React Navigation is NOT mocked.
 *
 * The bug is deterministic per origin, so the property is scoped to the three
 * non-Catalog origins {Stats_View, Friend_Profile_View, Home_View} and run
 * once per origin (the whole scoped domain is enumerated via `examples`).
 *
 * Because the property mounts and unmounts a full tree per sample, it applies
 * the same React Query lifecycle stabilization used by the Task 1 / Task 3.7
 * harness: a synchronous notify scheduler plus a teardown that clears the
 * per-iteration QueryClient, so no batched-notify macrotask survives across
 * iterations to touch an unmounted renderer.
 */

import React from 'react';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import {
  QueryClient,
  QueryClientProvider,
  notifyManager,
} from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import RootNavigator from '../../../navigation/RootNavigator';
import { useSessionStore } from '../../../state/sessionStore';
import { apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// Run React Query observer notifications synchronously (lifecycle safeguard).
notifyManager.setScheduler((flush) => {
  flush();
});

// ---------------------------------------------------------------------------
// Identities + fixtures
// ---------------------------------------------------------------------------

const OWN_USER_ID = 'own-user-7777';
const FRIEND_ID = 'friend-0001';
const DISPLAY_NAME = 'Mickey Mouse';

const ME_RESPONSE = {
  user: { id: OWN_USER_ID, email: 'me@test.local' },
  profile: { displayName: 'Me' },
};

const EXPERIENCE_ID = 'exp-space-mountain-001';
const EXPERIENCE_NAME = 'Space Mountain';
const EXPERIENCE_PARK = 'Magic Kingdom' as Park;
const EXPERIENCE_CATEGORY = 'Ride' as ExperienceCategory;

const ENTRY = {
  experienceId: EXPERIENCE_ID,
  experienceName: EXPERIENCE_NAME,
  park: EXPERIENCE_PARK,
  category: EXPERIENCE_CATEGORY,
  completedOn: '2024-01-05',
  rating: 8,
  sharedNote: null,
};

const LEADERBOARD_ENTRY = {
  experienceId: EXPERIENCE_ID,
  name: EXPERIENCE_NAME,
  park: EXPERIENCE_PARK,
  category: EXPERIENCE_CATEGORY,
  value: 8.5,
  count: 12,
};

const EXPERIENCE_DETAIL = {
  id: EXPERIENCE_ID,
  name: EXPERIENCE_NAME,
  park: EXPERIENCE_PARK,
  category: EXPERIENCE_CATEGORY,
  description: 'A high-speed indoor roller coaster in the dark.',
  imageUrl: null,
  imageAttribution: null,
};

const FRIEND_PROFILE = {
  userId: FRIEND_ID,
  displayName: DISPLAY_NAME,
  avatarUrl: null,
  overallCompletionPercent: 42,
};

interface Breakdown {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

interface StatsShape {
  readonly overall: Breakdown;
  readonly byPark: { readonly [park in Park]: Breakdown };
  readonly byCategory: { readonly [category in ExperienceCategory]: Breakdown };
  readonly byParkAndCategory: {
    readonly [park in Park]: {
      readonly [category in ExperienceCategory]: Breakdown;
    };
  };
}

function makeStats(): StatsShape {
  const filler: Breakdown = { completed: 1, total: 10, percent: 10 };
  const byPark = Object.fromEntries(
    PARKS.map((park) => [park, filler]),
  ) as StatsShape['byPark'];
  const byCategory = Object.fromEntries(
    EXPERIENCE_CATEGORIES.map((category) => [category, filler]),
  ) as StatsShape['byCategory'];
  const byParkAndCategory = Object.fromEntries(
    PARKS.map((park) => [park, byCategory]),
  ) as StatsShape['byParkAndCategory'];
  return { overall: filler, byPark, byCategory, byParkAndCategory };
}

function installApiRouter(): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path === '/me') return ME_RESPONSE as unknown;
    if (path === '/home/highest-rated') {
      return { entries: [LEADERBOARD_ENTRY] } as unknown;
    }
    if (path.startsWith('/me/stats')) return makeStats() as unknown;
    if (path.endsWith('/profile')) return FRIEND_PROFILE as unknown;
    if (path.endsWith('/completions')) {
      return { entries: [ENTRY] } as unknown;
    }
    if (path.endsWith('/live')) {
      throw new Error('live unavailable');
    }
    if (path.startsWith('/catalog/')) return EXPERIENCE_DETAIL as unknown;
    if (
      path.endsWith('/completion') ||
      path.endsWith('/rating') ||
      path.endsWith('/note')
    ) {
      return null as unknown;
    }
    if (path.endsWith('/aggregate-rating')) {
      return { value: null, count: 0 } as unknown;
    }
    throw new Error(`unexpected apiRequest path: ${path}`);
  });
}

// ---------------------------------------------------------------------------
// Real-topology harness
// ---------------------------------------------------------------------------

const navRef = createNavigationContainerRef<Record<string, object | undefined>>();

let activeQueryClient: QueryClient | null = null;

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderApp(): void {
  useSessionStore.setState({ token: 'test-session-token', hydrated: true });
  activeQueryClient = makeQueryClient();
  render(
    <QueryClientProvider client={activeQueryClient}>
      <NavigationContainer ref={navRef}>
        <RootNavigator />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

function teardownApp(): void {
  cleanup();
  if (activeQueryClient) {
    activeQueryClient.clear();
    activeQueryClient = null;
  }
  useSessionStore.setState({ token: null, hydrated: false });
}

function pressThemedBack(): void {
  fireEvent.press(screen.getByRole('button', { name: /go back/i }));
}

async function awaitDetailPresented(): Promise<void> {
  await waitFor(() => {
    expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail');
  });
  await screen.findByTestId('experience-detail');
}

async function openFromHome(): Promise<void> {
  fireEvent.press(
    await screen.findByTestId(`home-leaderboard-row-${EXPERIENCE_ID}`),
  );
}

async function openFromStats(): Promise<void> {
  act(() => {
    navRef.navigate('MainTabs', { screen: 'Stats' });
  });
  await screen.findByTestId('stats-screen');
  fireEvent.press(screen.getByTestId('tab-Own_Experiences'));
  await screen.findByTestId('own-experiences');
  fireEvent.press(await screen.findByTestId('own-experience-row-0'));
}

async function openFromFriend(): Promise<void> {
  act(() => {
    navRef.navigate('MainTabs', {
      screen: 'Friends',
      params: {
        screen: 'FriendProfile',
        params: { friendId: FRIEND_ID, displayName: DISPLAY_NAME },
      },
    });
  });
  await screen.findByTestId('friend-profile-screen');
  fireEvent.press(screen.getByTestId('tab-Experiences'));
  await screen.findByTestId('friend-mode-experiences');
  fireEvent.press(await screen.findByTestId('friend-experience-row-0'));
}

const ORIGIN_LABELS = ['Stats_View', 'Friend_Profile_View', 'Home_View'] as const;
type OriginLabel = (typeof ORIGIN_LABELS)[number];

interface OriginCase {
  readonly expectedRoute: string;
  readonly open: () => Promise<void>;
}

const CASES: Record<OriginLabel, OriginCase> = {
  Stats_View: { expectedRoute: 'Stats', open: openFromStats },
  Friend_Profile_View: { expectedRoute: 'FriendProfile', open: openFromFriend },
  Home_View: { expectedRoute: 'Home', open: openFromHome },
};

// ===========================================================================
// Property 1 — back from any non-Catalog origin returns to that origin
// ===========================================================================

describe('Fixed flow Property 1 — themed back from a non-Catalog origin returns to that origin', () => {
  afterEach(() => {
    teardownApp();
  });

  it('for any generated origin in {Stats, Friend profile, Home}, opening the detail then pressing the themed back control resolves to that origin', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<OriginLabel>(...ORIGIN_LABELS),
        async (originLabel) => {
          apiRequestMock.mockReset();
          installApiRouter();

          const testCase = CASES[originLabel];
          try {
            renderApp();

            await testCase.open();
            await awaitDetailPresented();

            // Return via the REAL themed back control (GradientHeader →
            // goBack()), not navRef.goBack().
            pressThemedBack();

            await waitFor(() => {
              expect(navRef.getCurrentRoute()?.name).not.toBe(
                'ExperienceDetail',
              );
            });

            // Back resolves to the exact originating screen (R2.1/2.2/2.3).
            expect(navRef.getCurrentRoute()?.name).toBe(testCase.expectedRoute);
          } finally {
            teardownApp();
          }
        },
      ),
      {
        numRuns: ORIGIN_LABELS.length,
        examples: ORIGIN_LABELS.map((label) => [label] as [OriginLabel]),
      },
    );
  });
});
