/**
 * Catalog_Home (`CatalogScreen`) component tests (tasks.md → 9.3).
 *
 * Validates: Requirements 4.1, 4.4, 4.7, 5.2, 5.3, 5.5, 5.6, 5.7
 *
 * Task 9.1/9.2 rewrote `CatalogScreen` from the old flat, area-grouped scroll
 * into the Level-1 Catalog_Home: a Destination grid (`GET /catalog/destinations`)
 * with an always-visible global search (`GET /catalog?q=...`). These component
 * tests mount the real screen with `apiRequest` stubbed to fixed destination and
 * search fixtures and assert:
 *
 *   - **Grid (R4.1, R4.4, R4.7)** the eight Destination cards render in the
 *     canonical grid order with their active-Experience counts, and a loading
 *     state shows while the counts first load with no prior data.
 *
 *   - **Navigation (R4.8)** tapping a Destination card navigates to
 *     `DestinationScreen` with the Destination id.
 *
 *   - **Search (R5.2, R5.3)** typing debounces ~300 ms, then drives
 *     `GET /catalog?q=...` and replaces the grid with a flat result list whose
 *     rows show the Experience's Destination and (when present) its Land.
 *
 *   - **Clear (R5.5)** clearing the query restores the Destination grid.
 *
 *   - **Empty (R5.6) / error (R5.7)** a query with no matches renders the
 *     empty-results state, a failed search renders the search-error state, and
 *     both retain the typed query in the search control.
 *
 * Implementation mirrors `ExperienceDetailScreen.enrichedDetail.test.tsx`:
 * `expo-secure-store`, `expo-constants`, and the API client are mocked (the real
 * `ApiError` is preserved), each test uses a retry-disabled `QueryClient`, and
 * the screen is mounted inside a `NavigationContainer` + native stack that also
 * registers stub `DestinationScreen` / `ExperienceDetail` targets so the
 * screen's cross-stack `navigate(...)` calls resolve and are observable.
 *
 * The 300 ms search debounce is exercised with jest fake timers in the timing
 * test; the remaining search tests wait the real debounce out via `findBy*`.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Text } from 'react-native';

import type { ExperienceDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

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

import CatalogScreen from '../CatalogScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import { DESTINATIONS, type DestinationId } from '../destinations';

/**
 * Local harness param list. The production stacks split these across the
 * Catalog stack (`CatalogList`, `DestinationScreen`) and the root stack
 * (`ExperienceDetail`); a single test navigator that registers all three lets
 * the screen's composite `navigate(...)` calls resolve and be asserted.
 */
type HarnessParamList = {
  CatalogList: undefined;
  DestinationScreen: { destination: DestinationId };
  ExperienceDetail: { experienceId: string };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function experience(
  overrides: Partial<ExperienceDTO> & Pick<ExperienceDTO, 'id' | 'areaType'>,
): ExperienceDTO {
  return {
    name: overrides.id,
    park: null,
    category: 'Ride',
    description: '',
    active: true,
    imageUrl: null,
    ...overrides,
  };
}

interface DestinationCountEntry {
  readonly destination: DestinationId;
  readonly count: number;
}

// ---------------------------------------------------------------------------
// Stub wiring
// ---------------------------------------------------------------------------

type SearchOutcome =
  | { readonly kind: 'ok'; readonly experiences: readonly ExperienceDTO[] }
  | { readonly kind: 'error' };

/**
 * Wire `apiRequest` to serve the Destination counts (`GET /catalog/destinations`)
 * and the global search (`GET /catalog?q=...`). The `destinations` branch is
 * matched before the generic `/catalog` branch so the search prefix does not
 * swallow it.
 */
function stub(options: {
  readonly destinations?: readonly DestinationCountEntry[];
  readonly staleCache?: boolean;
  readonly search?: SearchOutcome;
  /** When set, the destinations read rejects with this error. */
  readonly destinationsError?: ApiError;
}): void {
  const {
    destinations = [],
    staleCache = false,
    search = { kind: 'ok', experiences: [] },
    destinationsError,
  } = options;

  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.startsWith('/catalog/destinations')) {
      if (destinationsError !== undefined) {
        throw destinationsError;
      }
      return { destinations, staleCache };
    }
    if (path.startsWith('/catalog?') || path.startsWith('/catalog%')) {
      if (search.kind === 'error') {
        throw new ApiError({
          code: 'catalog_unavailable',
          message: 'search upstream unreachable',
          status: 503,
        });
      }
      return { experiences: search.experiences, staleCache: false };
    }
    throw new Error(`unexpected call to ${path}`);
  });
}

/** Count the `GET /catalog?q=...` search dispatches observed so far. */
function searchCallCount(): number {
  return apiRequestMock.mock.calls.filter(
    ([, path]) => typeof path === 'string' && path.startsWith('/catalog?'),
  ).length;
}

// ---------------------------------------------------------------------------
// Navigation harness
// ---------------------------------------------------------------------------

function DestinationTarget({
  route,
}: {
  readonly route: { readonly params: { readonly destination: DestinationId } };
}): JSX.Element {
  return <Text testID="nav-destination">{route.params.destination}</Text>;
}

function DetailTarget({
  route,
}: {
  readonly route: { readonly params: { readonly experienceId: string } };
}): JSX.Element {
  return <Text testID="nav-detail">{route.params.experienceId}</Text>;
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderCatalog(): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<HarnessParamList>();
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="CatalogList" component={CatalogScreen} />
          <Stack.Screen
            name="DestinationScreen"
            component={DestinationTarget as React.ComponentType<unknown>}
          />
          <Stack.Screen
            name="ExperienceDetail"
            component={DetailTarget as React.ComponentType<unknown>}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

/**
 * Position of a `testID` within the rendered tree, serialized in render order.
 * Elements rendered earlier serialize earlier, so comparing indices gives a
 * reliable relative ordering. Returns -1 when the id is absent.
 */
function orderOf(testID: string): number {
  return JSON.stringify(screen.toJSON()).indexOf(`"testID":"${testID}"`);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Catalog_Home grid + global search (R4.1, R4.4, R4.7, R5.2, R5.3, R5.5, R5.6, R5.7)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // R4.7 — loading state before the counts arrive
  // -------------------------------------------------------------------------
  test('R4.7: shows the loading state before destination counts load', async () => {
    stub({ destinations: [] });

    renderCatalog();

    // On the first synchronous render the counts query is in-flight with no
    // prior data, so the grid body shows the loading spinner.
    expect(screen.getByTestId('catalog-loading')).toBeTruthy();

    // Let the counts settle so the grid mounts (and no act warning leaks).
    await screen.findByTestId('catalog-destination-grid');
  });

  // -------------------------------------------------------------------------
  // R4.1 / R4.4 — the eight Destination cards render in canonical order
  //               with their active-Experience counts
  // -------------------------------------------------------------------------
  test('R4.1/R4.4: renders eight destination cards in canonical order with counts', async () => {
    stub({
      destinations: [
        { destination: 'Magic Kingdom', count: 42 },
        { destination: 'EPCOT', count: 30 },
        { destination: 'Hollywood Studios', count: 25 },
        { destination: 'Animal Kingdom', count: 20 },
        { destination: 'Typhoon Lagoon', count: 5 },
        { destination: 'Blizzard Beach', count: 4 },
        { destination: 'Disney Springs', count: 12 },
        { destination: 'Resorts', count: 60 },
      ],
    });

    renderCatalog();

    await screen.findByTestId('catalog-destination-grid');

    // All eight cards are present (R4.1).
    for (const destination of DESTINATIONS) {
      expect(
        screen.getByTestId(`catalog-destination-${destination.id}`),
      ).toBeTruthy();
    }

    // Canonical grid order: four theme parks → two water parks → Disney
    // Springs → Resorts (R4.1). Ordering is asserted on the per-card testIDs.
    const positions = DESTINATIONS.map((d) =>
      orderOf(`catalog-destination-${d.id}`),
    );
    for (const position of positions) {
      expect(position).toBeGreaterThanOrEqual(0);
    }
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);

    // Each card shows its active-Experience count (R4.4). The count is asserted
    // scoped to its own card so counts do not collide across cards.
    const mk = within(screen.getByTestId('catalog-destination-Magic Kingdom'));
    expect(mk.getByText('42 experiences')).toBeTruthy();

    const resorts = within(screen.getByTestId('catalog-destination-Resorts'));
    expect(resorts.getByText('60 experiences')).toBeTruthy();

    const springs = within(
      screen.getByTestId('catalog-destination-Disney Springs'),
    );
    expect(springs.getByText('12 experiences')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R4.4 — a Destination with no count entry renders zero
  // -------------------------------------------------------------------------
  test('R4.4: a destination missing from the counts payload renders a zero count', async () => {
    // Only Magic Kingdom is reported; every other card falls back to zero.
    stub({ destinations: [{ destination: 'Magic Kingdom', count: 7 }] });

    renderCatalog();

    await screen.findByTestId('catalog-destination-grid');

    const epcot = within(screen.getByTestId('catalog-destination-EPCOT'));
    expect(epcot.getByText('0 experiences')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R4.8 — tapping a card navigates to DestinationScreen with the id
  // -------------------------------------------------------------------------
  test('R4.8: tapping a destination card navigates to DestinationScreen', async () => {
    stub({ destinations: [{ destination: 'EPCOT', count: 30 }] });

    renderCatalog();

    const card = await screen.findByTestId('catalog-destination-EPCOT');
    fireEvent.press(card);

    const target = await screen.findByTestId('nav-destination');
    expect(target).toHaveTextContent('EPCOT');
  });

  // -------------------------------------------------------------------------
  // R5.2 — the search debounces ~300ms before firing GET /catalog?q=
  // -------------------------------------------------------------------------
  test('R5.2: search debounces ~300ms before dispatching GET /catalog?q=', async () => {
    jest.useFakeTimers();

    stub({
      destinations: [],
      search: { kind: 'ok', experiences: [experience({ id: 'space', areaType: 'ThemePark', park: 'Magic Kingdom', name: 'Space Mountain' })] },
    });

    renderCatalog();

    // Settle the initial destinations read.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    const before = searchCallCount();
    fireEvent.changeText(screen.getByTestId('catalog-search'), 'space');

    // Just short of the debounce window: no search dispatched yet (R5.2).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(299);
    });
    expect(searchCallCount()).toBe(before);

    // Crossing 300 ms fires the catalog-wide search.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(searchCallCount()).toBeGreaterThan(before);

    // Let react-query commit the resolved results after the fetch settles.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });

    // The dispatched path carries the `q` parameter and no area filter, so the
    // search spans the entire catalog (R5.2).
    const searchPaths = apiRequestMock.mock.calls
      .map(([, path]) => path)
      .filter(
        (path): path is string =>
          typeof path === 'string' && path.startsWith('/catalog?'),
      );
    expect(searchPaths.some((path) => path.includes('q=space'))).toBe(true);

    expect(screen.getByTestId('catalog-search-results')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R5.3 — results replace the grid; rows show Destination (+ Land) meta
  // -------------------------------------------------------------------------
  test('R5.3: results replace the grid and show destination + land meta', async () => {
    stub({
      destinations: [{ destination: 'Magic Kingdom', count: 42 }],
      search: {
        kind: 'ok',
        experiences: [
          experience({
            id: 'space',
            areaType: 'ThemePark',
            park: 'Magic Kingdom',
            name: 'Space Mountain',
            land: 'Tomorrowland',
          }),
          experience({
            id: 'ohana',
            areaType: 'Resort',
            category: 'Restaurant',
            name: "'Ohana",
          }),
        ],
      },
    });

    renderCatalog();
    await screen.findByTestId('catalog-destination-grid');

    fireEvent.changeText(screen.getByTestId('catalog-search'), 'a');

    // The flat result list replaces the grid (R5.3).
    await screen.findByTestId('catalog-search-results');
    expect(screen.queryByTestId('catalog-destination-grid')).toBeNull();

    expect(screen.getByTestId('catalog-search-row-space')).toBeTruthy();
    expect(screen.getByTestId('catalog-search-row-ohana')).toBeTruthy();

    // A park Experience shows its Destination and, when present, its Land.
    expect(screen.getByTestId('catalog-search-meta-space')).toHaveTextContent(
      'Magic Kingdom · Tomorrowland',
    );
    // A Resort-area Experience shows the aggregate Resorts Destination.
    expect(screen.getByTestId('catalog-search-meta-ohana')).toHaveTextContent(
      'Resorts',
    );
  });

  // -------------------------------------------------------------------------
  // R5.4 — selecting a result navigates to ExperienceDetail
  // -------------------------------------------------------------------------
  test('R5.4: tapping a search result navigates to ExperienceDetail', async () => {
    stub({
      destinations: [],
      search: {
        kind: 'ok',
        experiences: [
          experience({
            id: 'space',
            areaType: 'ThemePark',
            park: 'Magic Kingdom',
            name: 'Space Mountain',
          }),
        ],
      },
    });

    renderCatalog();
    await screen.findByTestId('catalog-destination-grid');

    fireEvent.changeText(screen.getByTestId('catalog-search'), 'space');

    const row = await screen.findByTestId('catalog-search-row-space');
    fireEvent.press(row);

    const target = await screen.findByTestId('nav-detail');
    expect(target).toHaveTextContent('space');
  });

  // -------------------------------------------------------------------------
  // R5.5 — clearing the query restores the Destination grid
  // -------------------------------------------------------------------------
  test('R5.5: clearing the search restores the destination grid', async () => {
    stub({
      destinations: [{ destination: 'Magic Kingdom', count: 42 }],
      search: {
        kind: 'ok',
        experiences: [
          experience({
            id: 'space',
            areaType: 'ThemePark',
            park: 'Magic Kingdom',
            name: 'Space Mountain',
          }),
        ],
      },
    });

    renderCatalog();
    await screen.findByTestId('catalog-destination-grid');

    fireEvent.changeText(screen.getByTestId('catalog-search'), 'space');
    await screen.findByTestId('catalog-search-results');

    // Tap the clear affordance; the grid returns once the query debounces empty.
    fireEvent.press(screen.getByTestId('catalog-search-clear'));

    await screen.findByTestId('catalog-destination-grid');
    expect(screen.queryByTestId('catalog-search-results')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R5.6 — no matches renders the empty-results state, retaining the query
  // -------------------------------------------------------------------------
  test('R5.6: an empty result set renders the empty state and retains the query', async () => {
    stub({
      destinations: [],
      search: { kind: 'ok', experiences: [] },
    });

    renderCatalog();
    await screen.findByTestId('catalog-destination-grid');

    fireEvent.changeText(screen.getByTestId('catalog-search'), 'zzzz');

    await screen.findByTestId('catalog-search-empty');
    // The grid is replaced by the empty-results state...
    expect(screen.queryByTestId('catalog-destination-grid')).toBeNull();
    // ...and the typed query is retained in the search control (R5.6).
    expect(screen.getByTestId('catalog-search')).toHaveProp('value', 'zzzz');
  });

  // -------------------------------------------------------------------------
  // R5.7 — a failed search renders the error state, retaining the query
  // -------------------------------------------------------------------------
  test('R5.7: a failed search renders the search-error state and retains the query', async () => {
    stub({
      destinations: [],
      search: { kind: 'error' },
    });

    renderCatalog();
    await screen.findByTestId('catalog-destination-grid');

    fireEvent.changeText(screen.getByTestId('catalog-search'), 'boom');

    await screen.findByTestId('catalog-search-error');
    expect(screen.queryByTestId('catalog-destination-grid')).toBeNull();
    // The typed query is retained in the search control (R5.7).
    expect(screen.getByTestId('catalog-search')).toHaveProp('value', 'boom');
  });
});
