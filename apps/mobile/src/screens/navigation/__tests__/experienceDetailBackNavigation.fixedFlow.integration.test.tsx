/**
 * Fixed-flow integration tests for the Experience Detail back-navigation
 * bugfix (spec: experience-detail-back-navigation, Task 4).
 *
 * Validates (Expected Behavior + Preservation of the fixed flow):
 *   Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.4
 *   (Property 1 — Back Returns To Originating Screen,
 *    Property 3 — Single Themed Header With Accessible Back Control,
 *    Property 2 — Preservation: Catalog origin, restored context)
 *
 * Unlike the Task 1 / Task 2 harnesses (which dual-registered
 * `ExperienceDetail` in both the Catalog stack and a root stack so the SAME
 * test was valid before and after the fix), this file mounts the REAL
 * production navigation topology: the actual `RootNavigator`
 * (`RootStack` hosting `MainTabs` above `ExperienceDetail`) wrapping the real
 * `MainTabs` bottom-tab navigator, the real `CatalogStack`, and the real
 * `FriendsStack`. The only mock is the lowest-level `apiRequest`, routed by
 * path; React Navigation is NOT mocked.
 *
 * Each origin drives the genuine production call site:
 *   - Home leaderboard row  → `navigation.navigate('ExperienceDetail', …)`
 *   - Stats Own_Experiences → `useOpenExperience`
 *   - Friend profile        → `useOpenExperience`
 *   - Catalog list row       → `navigation.navigate('ExperienceDetail', …)`
 *
 * and returns by pressing the REAL themed back control rendered in the
 * `ExperienceDetailScreen`'s `GradientHeader` (the Pressable with
 * `accessibilityRole="button"` and the "Go back" label that calls
 * `navigation.goBack()`) — NOT by calling `navRef.goBack()` directly. The
 * fourth origin (Catalog) exercises the preserved in-tab return.
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

// Mock only `apiRequest`; preserve the real `ApiError` so the detail screen's
// `*_not_found` swallowing and the friend-profile error plumbing keep their
// genuine error class.
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

// ---------------------------------------------------------------------------
// React Query notify scheduler (harness lifecycle stabilization).
//
// Run observer notifications synchronously so no batched-notify macrotask
// scheduled by one mounted tree fires after a later test has unmounted it.
// This is the same teardown safeguard used by the Task 1 / Task 3.7 harness;
// it changes no assertion and no production behavior.
// ---------------------------------------------------------------------------
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

// The single completed Experience every origin navigates to.
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

// Highest-rated leaderboard row consumed by HomeScreen (R11.5 shape).
const LEADERBOARD_ENTRY = {
  experienceId: EXPERIENCE_ID,
  name: EXPERIENCE_NAME,
  park: EXPERIENCE_PARK,
  category: EXPERIENCE_CATEGORY,
  value: 8.5,
  count: 12,
};

// `GET /catalog` list row consumed by the real CatalogScreen.
const CATALOG_LIST_ITEM = {
  id: EXPERIENCE_ID,
  name: EXPERIENCE_NAME,
  park: EXPERIENCE_PARK,
  category: EXPERIENCE_CATEGORY,
  // Magic Kingdom / Ride is a ThemePark-area Experience; CatalogScreen groups
  // rows by Area_Type, so the row only renders inside the Theme Parks section
  // when `areaType` is set.
  areaType: 'ThemePark',
  description: 'A high-speed indoor roller coaster in the dark.',
  active: true,
  imageUrl: null,
};

// `GET /catalog/:id` detail consumed by the real ExperienceDetailScreen.
const EXPERIENCE_DETAIL = {
  id: EXPERIENCE_ID,
  name: EXPERIENCE_NAME,
  park: EXPERIENCE_PARK,
  category: EXPERIENCE_CATEGORY,
  description: 'A high-speed indoor roller coaster in the dark.',
  imageUrl: null,
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

/** A fully-populated stats roll-up (every Park / Category present). */
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

/**
 * Route `apiRequest` by path so every origin screen AND the real
 * ExperienceDetailScreen resolve deterministically.
 */
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
    // Catalog list (with or without query params).
    if (path === '/catalog' || path.startsWith('/catalog?')) {
      return { experiences: [CATALOG_LIST_ITEM], staleCache: false } as unknown;
    }
    // CatalogScreen also fetches resorts to back the Resort-area grouping; a
    // single ThemePark experience needs no resorts, so an empty list suffices.
    if (path === '/resorts' || path.startsWith('/resorts?')) {
      return { resorts: [] } as unknown;
    }
    // Live read fails → only the unavailable indicator renders; static fields
    // still render (keeps the screen from blocking on it).
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

/**
 * Mount the REAL production navigator. A session token is seeded directly into
 * the store so `RootNavigator` renders the authenticated `RootStack`
 * (`MainTabs` + `ExperienceDetail`) rather than the auth stack. `RootNavigator`
 * does not own a `NavigationContainer` (the app root provides it), so the test
 * supplies one carrying `navRef`.
 */
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

/** Press the REAL themed back control in the detail header (calls goBack()). */
function pressThemedBack(): void {
  const backControl = screen.getByRole('button', { name: /go back/i });
  expect(backControl.props.accessibilityRole).toBe('button');
  fireEvent.press(backControl);
}

/** Wait until the pushed `ExperienceDetail` route is focused and mounted. */
async function awaitDetailPresented(): Promise<void> {
  await waitFor(() => {
    expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail');
  });
  await screen.findByTestId('experience-detail');
}

// ---------------------------------------------------------------------------
// Per-origin drivers (real production topology)
// ---------------------------------------------------------------------------

/** Home tab is the initial route — just activate the leaderboard row. */
async function openFromHome(): Promise<void> {
  fireEvent.press(
    await screen.findByTestId(`home-leaderboard-row-${EXPERIENCE_ID}`),
  );
}

/** Navigate to the Stats tab, switch to Own_Experiences, open the row. */
async function openFromStats(): Promise<void> {
  act(() => {
    navRef.navigate('MainTabs', { screen: 'Stats' });
  });
  await screen.findByTestId('stats-screen');
  fireEvent.press(screen.getByTestId('tab-Own_Experiences'));
  await screen.findByTestId('own-experiences');
  fireEvent.press(await screen.findByTestId('own-experience-row-0'));
}

/** Push the Friend profile inside the Friends tab, then open the row. */
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

/** Navigate to the Catalog tab and open a detail via the global search. */
async function openFromCatalog(): Promise<void> {
  act(() => {
    navRef.navigate('MainTabs', { screen: 'Catalog' });
  });
  // The redesigned Catalog_Home (catalog-navigation-redesign) is a Destination
  // grid; the real production call site that pushes `ExperienceDetail` from the
  // Catalog tab is the global search result row, so drive the search and tap
  // the matching row.
  fireEvent.changeText(
    await screen.findByTestId('catalog-search'),
    EXPERIENCE_NAME,
  );
  fireEvent.press(
    await screen.findByTestId(`catalog-search-row-${EXPERIENCE_ID}`),
  );
}

interface OriginCase {
  readonly label: string;
  readonly open: () => Promise<void>;
  /** Route name expected to be focused after pressing the themed back control. */
  readonly expectedRoute: string;
  /** testID of the prior-mode container expected to be restored on return. */
  readonly restoredContainerTestId?: string;
}

const ORIGIN_CASES: readonly OriginCase[] = [
  {
    label: 'Home_View',
    open: openFromHome,
    expectedRoute: 'Home',
  },
  {
    label: 'Stats_View (Own_Experiences mode)',
    open: openFromStats,
    expectedRoute: 'Stats',
    restoredContainerTestId: 'own-experiences',
  },
  {
    label: 'Friend_Profile_View (Experiences mode)',
    open: openFromFriend,
    expectedRoute: 'FriendProfile',
    restoredContainerTestId: 'friend-mode-experiences',
  },
  {
    label: 'Catalog_List_View',
    open: openFromCatalog,
    expectedRoute: 'CatalogList',
  },
];

// ===========================================================================
// Full flow per origin — tap row → real detail mounts → themed back → origin
// (Requirements 2.1, 2.2, 2.3, 3.1, 3.4)
// ===========================================================================

describe('Fixed flow — full per-origin round-trip via the real themed back control', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    installApiRouter();
  });

  afterEach(() => {
    teardownApp();
  });

  describe.each(ORIGIN_CASES)('$label', (testCase) => {
    test('tapping a row mounts the real ExperienceDetailScreen, and the themed back control returns to the originating screen', async () => {
      renderApp();

      await testCase.open();
      await awaitDetailPresented();

      // Press the REAL themed back control (GradientHeader → goBack()).
      pressThemedBack();

      // The detail route is popped off the root stack.
      await waitFor(() => {
        expect(navRef.getCurrentRoute()?.name).not.toBe('ExperienceDetail');
      });

      // Back lands on the exact originating screen (Property 1 / clause 3.1).
      expect(navRef.getCurrentRoute()?.name).toBe(testCase.expectedRoute);

      // The originating screen is restored in its prior mode (clause 3.4).
      if (testCase.restoredContainerTestId !== undefined) {
        expect(
          screen.getByTestId(testCase.restoredContainerTestId),
        ).toBeTruthy();
      }
    });
  });
});

// ===========================================================================
// Switch tab/mode before navigating, then confirm the restored context after
// the return (Requirements 3.4)
// ===========================================================================

describe('Fixed flow — prior tab and mode restored after a return', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    installApiRouter();
  });

  afterEach(() => {
    teardownApp();
  });

  test('Stats retains its Own_Experiences mode across an open + themed-back round-trip', async () => {
    renderApp();

    // Switch to the Stats tab and into the Own_Experiences mode before
    // navigating to the detail (a deliberate non-default tab + mode).
    act(() => {
      navRef.navigate('MainTabs', { screen: 'Stats' });
    });
    await screen.findByTestId('stats-screen');
    fireEvent.press(screen.getByTestId('tab-Own_Experiences'));
    await screen.findByTestId('own-experiences');

    // Open the detail from the Own_Experiences row, then return via the themed
    // back control.
    fireEvent.press(await screen.findByTestId('own-experience-row-0'));
    await awaitDetailPresented();
    pressThemedBack();

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('Stats');
    });

    // Prior tab (Stats) and prior mode (Own_Experiences) are both restored.
    expect(screen.getByTestId('own-experiences')).toBeTruthy();
  });
});

// ===========================================================================
// Structural — exactly one themed header, no native header bar on the detail
// (Requirements 2.4, 2.5)
// ===========================================================================

describe('Fixed flow — single themed header with an accessible back control, no native header bar', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    installApiRouter();
  });

  afterEach(() => {
    teardownApp();
  });

  test('the presented detail screen shows one themed back control and no redundant native "Experience" header', async () => {
    renderApp();

    await openFromHome();
    await awaitDetailPresented();

    // Exactly one themed back control is present — the detail header's. No
    // other mounted screen contributes a back control (their GradientHeaders
    // carry no `onBack`), so this is the single themed header on the detail
    // view (Property 3 / R2.4, R2.5).
    const backControls = screen.getAllByRole('button', { name: /go back/i });
    expect(backControls).toHaveLength(1);
    expect(backControls[0]?.props.accessibilityRole).toBe('button');

    // No redundant native stack header titled "Experience" renders above the
    // themed GradientHeader (the Catalog stack's old `title: 'Experience'` is
    // gone and the root route uses `headerShown: false`) (R2.5).
    expect(screen.queryByText('Experience')).toBeNull();

    // The themed header still surfaces the Experience name (R3.6 preserved).
    expect(screen.getByText(EXPERIENCE_NAME)).toBeTruthy();
  });
});
