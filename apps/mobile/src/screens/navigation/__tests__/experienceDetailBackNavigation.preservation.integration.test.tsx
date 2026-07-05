/**
 * Preservation integration tests for the Experience Detail back-navigation
 * bug (bugfix spec: experience-detail-back-navigation, Task 2).
 *
 * Validates (Preservation — behavior that must remain unchanged by the fix):
 *   Requirements 3.1, 3.2, 3.4, 3.6
 *   (Property 2 — Preservation: Catalog Origin, Data, Restored Context)
 *
 * Observation-first methodology: these tests were written against the UNFIXED
 * code and assert the baseline behavior observed there. They are EXPECTED TO
 * PASS on the unfixed code (confirming the behavior to preserve) and must
 * CONTINUE TO PASS after the navigation-structure fix is applied.
 *
 *   - Clause 3.1 — Catalog_List_View → ExperienceDetail → back returns to
 *     `CatalogList`. On unfixed code the Catalog list opens the detail with an
 *     in-stack `navigate('ExperienceDetail', …)`, so back pops the Catalog
 *     stack to `CatalogList`. After the fix the detail is pushed on the root
 *     stack above the tabs, and the Catalog tab (showing `CatalogList`) is the
 *     screen beneath it, so back still lands on `CatalogList`.
 *
 *   - Clause 3.2 / 3.6 — the detail screen renders the same Experience
 *     addressed by the entry point's Experience_Id (catalog name + Park in the
 *     themed header, Park / category badges) and loads the viewing User's OWN
 *     Completion / Rating / Note via `/me/experiences/:id/…`.
 *
 *   - Clause 3.4 — the originating screen is presented in the same tab and
 *     mode it had before navigation began. Demonstrated two ways that are
 *     robust before and after the fix: (a) the Catalog list's search/filter
 *     state survives a detail round-trip via back, and (b) the Stats screen
 *     retains its selected Own_Experiences mode across a tab switch away and
 *     back while the detail is open.
 *
 * Harness — mirrors `returnNavigationDetailSource.integration.test.tsx`,
 * `navigationWiring.integration.test.tsx`, and the Task 1 bug-condition test:
 * a real `NavigationContainer` carrying the app's tab + nested-stack topology
 * with only the lowest-level `apiRequest` mocked (routed by path). React
 * Navigation is NOT mocked.
 *
 * To keep the SAME tests valid before and after the fix, the topology registers
 * `ExperienceDetail` in BOTH places the fix moves it between: inside the
 * `Catalog` tab stack (the unfixed destination) and as a sibling screen on a
 * root-level native stack above the tabs (the fixed destination). The real
 * screens drive the real navigation dispatch, so each test follows whichever
 * destination the production code targets.
 */

import React from 'react';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { type ExperienceCategory, type Park } from '@dwt/shared';

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
// `*_not_found` swallowing keeps its genuine error class.
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

import StatsStack from '../../../navigation/StatsStack';
import CatalogScreen from '../../catalog/CatalogScreen';
import ExperienceDetailScreen from '../../catalog/ExperienceDetailScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type { StatsResponse } from '../../../api/statsTypes';
import { makeStatsResponse } from '../../stats/__testSupport__/statsFixture';

/**
 * Local Catalog-stack param list for the test harness. Mirrors the UNFIXED
 * production topology where `ExperienceDetail` was registered inside the
 * Catalog stack. The production `CatalogStackParamList` no longer carries
 * `ExperienceDetail` (it moved to the root stack), so this harness declares
 * its own param list rather than importing the trimmed production type.
 */
type CatalogStackParamList = {
  CatalogList: undefined;
  ExperienceDetail: { experienceId: string };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Identities + fixtures
// ---------------------------------------------------------------------------

const OWN_USER_ID = 'own-user-7777';

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

/** A fully-populated nested stats roll-up (every Park / Category present). */
function makeStats(): StatsResponse {
  return makeStatsResponse();
}

/**
 * Route `apiRequest` by path so the Catalog list, the Stats screen, and the
 * real ExperienceDetailScreen all resolve deterministically.
 */
function installApiRouter(): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path === '/me') return ME_RESPONSE as unknown;
    if (path.startsWith('/me/stats')) return makeStats() as unknown;
    // Own / friend completions list (drives the Stats Own_Experiences mode).
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

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

// ---------------------------------------------------------------------------
// Navigator topology (dual registration: Catalog-stack + root-level)
// ---------------------------------------------------------------------------

const CatalogStack = createNativeStackNavigator<CatalogStackParamList>();

/**
 * The Catalog tab stack — mirrors the UNFIXED production `CatalogStack`:
 * `ExperienceDetail` is registered here. This is the destination the unfixed
 * in-stack dispatch lands on.
 */
function CatalogTestStack(): JSX.Element {
  return (
    <CatalogStack.Navigator>
      <CatalogStack.Screen
        name="CatalogList"
        component={CatalogScreen}
        options={{ headerShown: false }}
      />
      <CatalogStack.Screen
        name="ExperienceDetail"
        component={ExperienceDetailScreen}
        options={{ title: 'Experience' }}
      />
    </CatalogStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();

// Set by `renderApp` before each mount so the originating tab is focused
// without driving the bottom tab bar.
let currentInitialTab: 'Stats' | 'Catalog' = 'Catalog';

function MainTabsNavigator(): JSX.Element {
  return (
    <Tab.Navigator
      initialRouteName={currentInitialTab}
      // `lazy: false` mounts every tab on first render so the Catalog stack
      // initializes with `CatalogList` at the base of its history, mirroring a
      // real session where the Catalog list has been visited.
      screenOptions={{ headerShown: false, lazy: false }}
    >
      <Tab.Screen name="Stats" component={StatsStack} />
      <Tab.Screen name="Catalog" component={CatalogTestStack} />
    </Tab.Navigator>
  );
}

type RootStackParamList = {
  MainTabs: undefined;
  ExperienceDetail: { experienceId: string };
};

const RootStack = createNativeStackNavigator<RootStackParamList>();

const navRef =
  createNavigationContainerRef<Record<string, object | undefined>>();

function renderApp(initialTab: 'Stats' | 'Catalog'): void {
  currentInitialTab = initialTab;
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer ref={navRef}>
        <RootStack.Navigator>
          <RootStack.Screen
            name="MainTabs"
            component={MainTabsNavigator}
            options={{ headerShown: false }}
          />
          <RootStack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailScreen}
            options={{ headerShown: false }}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

/** Paths the `apiRequest` mock was called with, as strings. */
function calledPaths(): readonly string[] {
  return apiRequestMock.mock.calls
    .map((call) => call[1])
    .filter((p): p is string => typeof p === 'string');
}

/** Drive the real Catalog global search to its single row and open the detail screen. */
async function openFromCatalog(): Promise<void> {
  // The redesigned Catalog_Home (catalog-navigation-redesign) is a Destination
  // grid; an Experience detail is reached from it through the always-visible
  // global search rather than a flat home list. Type a query that matches the
  // fixture, then tap the resulting search-result row (which navigates to
  // `ExperienceDetail` on the root stack).
  fireEvent.changeText(await screen.findByTestId('catalog-search'), 'Space');
  fireEvent.press(
    await screen.findByTestId(`catalog-search-row-${EXPERIENCE_ID}`),
  );
  await waitFor(() => {
    expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail');
  });
  await screen.findByTestId('experience-detail');
}

// ===========================================================================
// Clause 3.1 — Catalog origin still returns to CatalogList on back
// ===========================================================================

describe('Preservation 3.1 — Catalog_List_View → ExperienceDetail → back returns to CatalogList', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    installApiRouter();
  });

  afterEach(() => {
    cleanup();
  });

  test('opening the detail from a Catalog list row and pressing back lands on CatalogList', async () => {
    renderApp('Catalog');

    await openFromCatalog();

    act(() => {
      navRef.goBack();
    });

    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).not.toBe('ExperienceDetail');
    });

    // Baseline (preserved): back from a Catalog origin returns to CatalogList.
    expect(navRef.getCurrentRoute()?.name).toBe('CatalogList');
  });
});

// ===========================================================================
// Clause 3.2 / 3.6 — the detail screen shows the same Experience data and
// reads the viewing User's own tracking
// ===========================================================================

describe('Preservation 3.2 / 3.6 — detail renders the entry-point Experience and the viewing User\'s own data', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    installApiRouter();
  });

  afterEach(() => {
    cleanup();
  });

  test('renders the catalog Experience (name, Park, category) and issues the own /me reads', async () => {
    renderApp('Catalog');

    await openFromCatalog();

    // R3.6: the themed header shows the Experience name and Park.
    expect(screen.getByText(EXPERIENCE_NAME)).toBeTruthy();
    // Park appears in both the header subtitle and the Park badge — assert it
    // is present at least once (clause 3.2 catalog detail data).
    expect(screen.getAllByText(EXPERIENCE_PARK).length).toBeGreaterThan(0);

    // R3.2: Park + category surfaced as themed badges (catalog detail data).
    expect(screen.getByTestId('experience-park-badge')).toBeTruthy();
    expect(screen.getByTestId('experience-category-badge')).toBeTruthy();

    // R3.2: the viewing User's OWN Completion / Rating / Note are loaded via
    // `/me/experiences/:id/…`, keyed by the entry point's Experience_Id.
    await waitFor(() => {
      expect(calledPaths()).toContain(
        `/me/experiences/${EXPERIENCE_ID}/completion`,
      );
    });
    const paths = calledPaths();
    expect(paths).toContain(`/me/experiences/${EXPERIENCE_ID}/rating`);
    expect(paths).toContain(`/me/experiences/${EXPERIENCE_ID}/note`);
    // And the catalog detail itself was read for that exact id.
    expect(paths).toContain(`/catalog/${EXPERIENCE_ID}`);
  });
});

// ===========================================================================
// Clause 3.4 — the originating screen is restored in its prior tab and mode
// ===========================================================================

describe('Preservation 3.4 — originating screen restored in its prior tab and mode', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    installApiRouter();
  });

  afterEach(() => {
    cleanup();
  });

  test('Catalog list search/filter state survives a detail round-trip via back', async () => {
    renderApp('Catalog');

    // Put the Catalog list into a non-default mode: a search query.
    const searchInput = await screen.findByTestId('catalog-search');
    fireEvent.changeText(searchInput, 'Space');
    expect(searchInput.props.value).toBe('Space');

    // Open the detail and return via back.
    await openFromCatalog();
    act(() => {
      navRef.goBack();
    });
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('CatalogList');
    });

    // Baseline (preserved): the same tab and mode — the search text the User
    // typed is still present on the restored Catalog list.
    expect(screen.getByTestId('catalog-search').props.value).toBe('Space');
  });

  test('Stats screen retains its ExperiencesDetail screen while the detail is open', async () => {
    renderApp('Stats');

    // Drill from the Overview hub into the ExperiencesDetail screen.
    await screen.findByTestId('stats-screen');
    fireEvent.press(await screen.findByTestId('stats-highlight-experiences'));
    await screen.findByTestId('experiences-detail-screen');

    // Open the detail from an ExperiencesDetail row.
    fireEvent.press(await screen.findByTestId('own-experience-row-0'));
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('ExperienceDetail');
    });

    // Return to the Stats tab.
    act(() => {
      navRef.navigate('Stats');
    });
    await waitFor(() => {
      expect(navRef.getCurrentRoute()?.name).toBe('ExperiencesDetail');
    });

    // Baseline (preserved): the Stats tab is still showing the ExperiencesDetail
    // screen it was displaying before navigation began.
    expect(screen.getByTestId('experiences-detail-screen')).toBeTruthy();
  });
});
