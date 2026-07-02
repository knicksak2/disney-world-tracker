/**
 * Empty-state tests for the Disney World Tracker mobile app.
 *
 * Validates: Requirements R1.23, R1.24, R4.6, R5.9, R10.6, R11.11
 *
 * Each test mounts the relevant screen with `apiRequest` stubbed to
 * the fixture that triggers a specific empty-state branch, and
 * asserts the empty-state renders by its dedicated `testID`.
 *
 * Coverage map:
 *
 *   - **R1.23** Catalog zero matches — the Catalog_Home grid renders,
 *     then a global search returning `{ experiences: [] }` shows the
 *     `catalog-search-empty` state (the old flat `catalog-empty` view was
 *     removed when the grid + global search replaced the flat list).
 *
 *   - **R1.24** Catalog unavailable — `GET /catalog` rejects with an
 *     `ApiError` carrying code `catalog_unavailable`. With no prior
 *     cache, the screen falls into the `catalog-unavailable`
 *     full-screen error.
 *
 *   - **R10.6** Aggregate count < 3 — `GET /experiences/:id/aggregate-rating`
 *     returns `{ value: null, count: 2 }`. Per the design, the server
 *     enforces the `count >= 3` threshold by returning `value: null`
 *     rather than throwing; `ExperienceDetailScreen` renders the
 *     `aggregate-empty` view in that case.
 *
 *   - **R11.11** Leaderboard zero qualifying — `GET /home/highest-rated`
 *     returns `{ entries: [] }`. `HomeScreen` shows the
 *     `home-leaderboard-empty` block.
 *
 *   - **R4.6** No Rating — `GET /me/experiences/:id/rating` rejects
 *     with `ApiError` code `rating_not_found`. The detail screen
 *     swallows that into `null` and `RatingControl` renders the
 *     `rating-empty` view.
 *
 *   - **R5.9** No Note — `GET /me/experiences/:id/note` rejects with
 *     `ApiError` code `note_not_found`. The detail screen swallows
 *     that into `null` and `NoteControl` renders the `note-empty`
 *     view.
 *
 * Implementation notes:
 *
 *   - `expo-secure-store`, `expo-constants`, and `../api/client` are
 *     mocked using the same pattern established by the navigation
 *     suite (task 20.1). The real `ApiError` class is preserved via
 *     `jest.requireActual` so the screens' `instanceof` and `code`
 *     checks resolve correctly.
 *
 *   - Each test instantiates a fresh `QueryClient` with retries
 *     disabled so a stubbed rejection settles without exponential
 *     backoff hangs.
 *
 *   - Screens that depend on a route param (`ExperienceDetailScreen`,
 *     `CatalogScreen` via the `ExperienceDetail` push) or on a real
 *     navigation tree (`HomeScreen`, which dispatches a cross-stack
 *     `navigate` from rows) are wrapped in a `NavigationContainer`
 *     plus a minimal stack so `useRoute` and the param plumbing
 *     resolve naturally.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks (must be declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory replacement for `expo-secure-store`. Each test starts with an
// empty store; we never write through it because `apiRequest` is mocked.
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

// `expo-constants` supplies the API base URL via `Constants.expoConfig.extra`.
// `apiRequest` is mocked so this value is never read at runtime, but we
// still provide a fake string so any defensive codepath does not throw.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Mock the API client module: `apiRequest` is a `jest.fn` so each test can
// supply its own stubbed response. Everything else (`ApiError`, the
// unauthorized-callback registry) is preserved from the real module so
// the screens' `instanceof ApiError` checks still resolve.
jest.mock('../api/client', () => {
  const actual = jest.requireActual('../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import CatalogScreen from '../screens/catalog/CatalogScreen';
import ExperienceDetailScreen from '../screens/catalog/ExperienceDetailScreen';
import HomeScreen from '../screens/home/HomeScreen';
import {
  ApiError,
  apiRequest as mockedApiRequest,
} from '../api/client';
import type { MainTabParamList } from '../navigation/RootNavigator';

/**
 * Local Catalog-stack param list for the test harness. The standalone detail
 * render below registers `ExperienceDetail` in a throwaway stack; the
 * production `CatalogStackParamList` no longer carries `ExperienceDetail` (it
 * moved to the root stack), so this harness declares its own param list rather
 * than importing the trimmed production type.
 */
type CatalogStackParamList = {
  CatalogList: undefined;
  ExperienceDetail: { experienceId: string };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a `QueryClient` with retries disabled and zero `gcTime` so each
 * test starts from a clean slate and a stubbed rejection settles
 * immediately rather than running through react-query's exponential
 * backoff schedule.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * Render a component tree wrapped in a fresh `QueryClientProvider`.
 * Used by the standalone-screen renderers below.
 */
function renderWithClient(node: React.ReactElement): ReturnType<typeof render> {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

/**
 * Mount `CatalogScreen` inside a real native stack so its
 * `NativeStackScreenProps`-typed `navigation` prop resolves the way
 * the production wiring does. The stack only registers the catalog
 * list — the detail screen is not pushed by these tests.
 */
function renderCatalog(): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<CatalogStackParamList>();
  return renderWithClient(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="CatalogList" component={CatalogScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

/**
 * Mount `ExperienceDetailScreen` inside a real native stack with
 * `experienceId` seeded as the screen's `initialParams`, so
 * `useRoute().params.experienceId` resolves to the test fixture id.
 */
function renderExperienceDetail(experienceId: string): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<CatalogStackParamList>();
  return renderWithClient(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="ExperienceDetail"
          component={ExperienceDetailScreen}
          initialParams={{ experienceId }}
        />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

/**
 * Mount `HomeScreen` inside a real native stack. The screen is typed
 * as a `BottomTabScreenProps`-bearing component, but the only
 * navigation API it uses is `navigation.navigate(...)`, which the
 * native stack also exposes — and these tests never trigger a
 * navigation, so the param-list mismatch is purely structural.
 */
function renderHome(): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<MainTabParamList>();
  return renderWithClient(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="Home"
          // `HomeScreen` is typed against the bottom-tab navigator;
          // for an empty-state-only render this is structurally
          // compatible (it only calls `navigate`, which the stack
          // also provides). The cast is local to the test.
          component={HomeScreen as React.ComponentType<unknown>}
        />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('empty-state renders (R1.23, R1.24, R4.6, R5.9, R10.6, R11.11)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();
  });

  // -------------------------------------------------------------------------
  // R1.23 — Catalog zero matches (global search empty state)
  // -------------------------------------------------------------------------
  test('R1.23: an active search with zero matches renders the empty state', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path === 'string' && path.startsWith('/catalog')) {
        return { experiences: [], staleCache: false };
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderCatalog();

    // Catalog_Home renders the Destination grid first (the flat-catalog
    // `catalog-empty` state was removed when the grid + global search replaced
    // the flat list). A global search with no matches shows the search
    // empty-results state (R5.6).
    await screen.findByTestId('catalog-destination-grid');
    fireEvent.changeText(screen.getByTestId('catalog-search'), 'zzzz');

    const empty = await screen.findByTestId('catalog-search-empty');
    expect(empty).toBeTruthy();
    expect(screen.getByText(/no experiences matched/i)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R1.24 — Catalog unavailable
  // -------------------------------------------------------------------------
  test('R1.24: catalog_unavailable error renders the unavailable state', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path === 'string' && path.startsWith('/catalog')) {
        throw new ApiError({
          code: 'catalog_unavailable',
          message: 'Catalog upstream unreachable',
          status: 503,
        });
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderCatalog();

    const unavailable = await screen.findByTestId('catalog-unavailable');
    expect(unavailable).toBeTruthy();
    expect(screen.getByText(/catalog couldn.t be loaded/i)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R10.6 — Aggregate count < 3
  // -------------------------------------------------------------------------
  test('R10.6: aggregate with count<3 renders the empty state', async () => {
    const experienceId = 'exp-aggregate-empty';

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path !== 'string') {
        throw new Error(`unexpected non-string path: ${String(path)}`);
      }
      if (path === `/catalog/${experienceId}`) {
        return {
          id: experienceId,
          name: 'Test Ride',
          park: 'Magic Kingdom',
          category: 'Ride',
          description: 'A test attraction.',
        };
      }
      if (path === `/experiences/${experienceId}/aggregate-rating`) {
        // Server enforces `count >= 3` by returning `value: null`
        // when the threshold is not met (R10.4); the screen renders
        // the `aggregate-empty` view in that case (R10.6).
        return { value: null, count: 2 };
      }
      // Personal completion / rating / note are not under test here;
      // surface the corresponding `*_not_found` codes so each section
      // resolves into its own empty state without blocking the
      // aggregate render.
      if (path.endsWith('/completion')) {
        throw new ApiError({
          code: 'completion_not_found',
          message: 'no completion',
          status: 404,
        });
      }
      if (path.endsWith('/rating')) {
        throw new ApiError({
          code: 'rating_not_found',
          message: 'no rating',
          status: 404,
        });
      }
      if (path.endsWith('/note')) {
        throw new ApiError({
          code: 'note_not_found',
          message: 'no note',
          status: 404,
        });
      }
      throw new Error(`unexpected call to ${path}`);
    });

    renderExperienceDetail(experienceId);

    await waitFor(() => {
      expect(screen.getByTestId('aggregate-empty')).toBeTruthy();
    });
    expect(screen.getByText(/not enough ratings yet/i)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R11.11 — Leaderboard zero qualifying
  // -------------------------------------------------------------------------
  test('R11.11: leaderboard with zero qualifying renders the empty state', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/home/highest-rated') {
        return { entries: [] };
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderHome();

    const empty = await screen.findByTestId('home-leaderboard-empty');
    expect(empty).toBeTruthy();
    expect(screen.getByText(/no leaderboard yet/i)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R4.6 — No Rating
  // -------------------------------------------------------------------------
  test('R4.6: rating_not_found renders the rating empty state', async () => {
    const experienceId = 'exp-rating-empty';

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path !== 'string') {
        throw new Error(`unexpected non-string path: ${String(path)}`);
      }
      if (path === `/catalog/${experienceId}`) {
        return {
          id: experienceId,
          name: 'Test Ride',
          park: 'Magic Kingdom',
          category: 'Ride',
          description: 'A test attraction.',
        };
      }
      if (path === `/me/experiences/${experienceId}/rating`) {
        throw new ApiError({
          code: 'rating_not_found',
          message: 'no rating',
          status: 404,
        });
      }
      // Other personal sections + aggregate resolve to their own
      // empty/idle states; only the rating-empty assertion is the
      // subject of this test.
      if (path.endsWith('/completion')) {
        throw new ApiError({
          code: 'completion_not_found',
          message: 'no completion',
          status: 404,
        });
      }
      if (path.endsWith('/note')) {
        throw new ApiError({
          code: 'note_not_found',
          message: 'no note',
          status: 404,
        });
      }
      if (path === `/experiences/${experienceId}/aggregate-rating`) {
        return { value: null, count: 0 };
      }
      throw new Error(`unexpected call to ${path}`);
    });

    renderExperienceDetail(experienceId);

    await waitFor(() => {
      expect(screen.getByTestId('rating-empty')).toBeTruthy();
    });
    expect(screen.getByText(/not rated/i)).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R5.9 — No Note
  // -------------------------------------------------------------------------
  test('R5.9: note_not_found renders the note empty state', async () => {
    const experienceId = 'exp-note-empty';

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path !== 'string') {
        throw new Error(`unexpected non-string path: ${String(path)}`);
      }
      if (path === `/catalog/${experienceId}`) {
        return {
          id: experienceId,
          name: 'Test Ride',
          park: 'Magic Kingdom',
          category: 'Ride',
          description: 'A test attraction.',
        };
      }
      if (path === `/me/experiences/${experienceId}/note`) {
        throw new ApiError({
          code: 'note_not_found',
          message: 'no note',
          status: 404,
        });
      }
      if (path.endsWith('/completion')) {
        throw new ApiError({
          code: 'completion_not_found',
          message: 'no completion',
          status: 404,
        });
      }
      if (path.endsWith('/rating')) {
        throw new ApiError({
          code: 'rating_not_found',
          message: 'no rating',
          status: 404,
        });
      }
      if (path === `/experiences/${experienceId}/aggregate-rating`) {
        return { value: null, count: 0 };
      }
      throw new Error(`unexpected call to ${path}`);
    });

    renderExperienceDetail(experienceId);

    await waitFor(() => {
      expect(screen.getByTestId('note-empty')).toBeTruthy();
    });
    expect(screen.getByText(/no note yet/i)).toBeTruthy();
  });
});
