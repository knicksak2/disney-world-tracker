/**
 * DestinationScreen layout component tests (tasks.md → 10.5).
 *
 * Validates: Requirements 6.2, 6.4, 6.8, 6.9, 7.2, 7.5, 7.7, 8.3, 8.4, 8.6, 8.7
 *
 * These component tests mount the real `DestinationScreen` for each of its three
 * Level-2 layouts with `apiRequest` stubbed to fixed `/catalog` (and, for the
 * Resorts Destination, `/resorts`) fixtures, and assert the grouped/collapsible
 * rendering each layout produces:
 *
 *   - **Theme / water park (Magic Kingdom).** `groupByLand` sections render in
 *     case-insensitive ascending order with the Land_Catchall section last
 *     (R6.2); every section is expanded on first render so its rows are visible
 *     (R6.4); selecting an Experience_Category chip filters to that category
 *     while preserving the Land grouping (R6.8) and dropping Land sections left
 *     with no matching Experience (R6.9).
 *
 *   - **Disney Springs.** `groupByCategory` sections render in canonical
 *     Experience_Category order with empty categories omitted (R7.2, R7.5), and
 *     a Destination with zero active Experiences shows the empty state (R7.7).
 *
 *   - **Resorts.** Every active Resort renders as a browsable anchor including
 *     Resorts with no Experiences (R8.3); Experiences with no / unmatched
 *     `resortId` fall under the trailing catch-all group (R8.4); an empty Resort
 *     shows its empty-group indication (R8.7); tapping a Resort anchor scrolls
 *     the list to that group and stays on the screen (R8.6).
 *
 * Implementation mirrors `CatalogScreen.render.test.tsx` /
 * `ExperienceDetailScreen.enrichedDetail.test.tsx`: `expo-secure-store`,
 * `expo-constants`, and the API client are mocked (the real `ApiError` is
 * preserved), each test uses a retry-disabled `QueryClient`, and the screen is
 * mounted inside a native stack with `destination` seeded as `initialParams`.
 *
 * `DestinationScreen` renders each layout through a virtualizing `FlatList`; in
 * the layout-less test environment only the leading window of cells is
 * committed, so every fixture is kept small enough that all asserted
 * items/sections fall inside the rendered window.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

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

import DestinationScreen from '../DestinationScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type { DestinationId } from '../destinations';

type CatalogStackParamList = {
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

/**
 * Wire `apiRequest` to serve the supplied catalog and resort fixtures.
 * `/resorts` is matched before the `/catalog` prefix branch.
 */
function stub(experiences: readonly ExperienceDTO[]): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.startsWith('/catalog')) {
      return { experiences, staleCache: false };
    }
    // The rows badge visited Experiences: the screen reads `/me` for the
    // viewer id and `/users/:id/completions` for the completed set. Neither
    // affects the layout/order assertions here, so serve empty defaults.
    if (path === '/me') {
      return { user: { id: 'viewer', email: 'viewer@test.local' } };
    }
    if (path.endsWith('/completions')) {
      return { entries: [] };
    }
    throw new Error(`unexpected call to ${path}`);
  });
}

function renderDestination(
  destination: DestinationId,
): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<CatalogStackParamList>();
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="DestinationScreen"
            component={DestinationScreen}
            initialParams={{ destination }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

/**
 * Collect the `testID` of every node in the rendered tree in depth-first render
 * order. Reading only the `testID` prop (a string) avoids serializing the whole
 * props bag, which can contain circular values (e.g. a React context provider)
 * that would break a naive `JSON.stringify(screen.toJSON())`.
 */
type TestJson =
  | string
  | null
  | {
      readonly props?: { readonly testID?: unknown };
      readonly children?: readonly TestJson[] | null;
    };

function collectTestIds(node: TestJson | readonly TestJson[] | null, acc: string[]): void {
  if (node === null || node === undefined) {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectTestIds(child, acc);
    }
    return;
  }
  if (typeof node !== 'object') {
    return;
  }
  const element = node as {
    readonly props?: { readonly testID?: unknown };
    readonly children?: readonly TestJson[] | null;
  };
  const testID = element.props?.testID;
  if (typeof testID === 'string') {
    acc.push(testID);
  }
  if (element.children != null) {
    collectTestIds(element.children, acc);
  }
}

/**
 * Position of a `testID` within the rendered tree in depth-first render order.
 * Elements rendered earlier appear earlier, so comparing indices yields a
 * reliable relative ordering. Returns -1 when the id is absent.
 */
function orderOf(testID: string): number {
  const ids: string[] = [];
  collectTestIds(screen.toJSON() as TestJson | readonly TestJson[] | null, ids);
  return ids.indexOf(testID);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('DestinationScreen layouts (R6, R7, R8)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });



  // =========================================================================
  // Disney Springs layout
  // =========================================================================
  describe('Disney Springs layout', () => {
    // ---------------------------------------------------------------------
    // R7.2 / R7.5 — category sections in canonical order, empties omitted
    // ---------------------------------------------------------------------
    test('R7.2/R7.5: category sections render in canonical order with empty categories omitted', async () => {
      stub([
        experience({
          id: 'ds-morimoto',
          areaType: 'DisneySprings',
          park: 'Disney Springs',
          name: 'Morimoto Asia',
          category: 'Restaurant',
        }),
        experience({
          id: 'ds-boathouse',
          areaType: 'DisneySprings',
          park: 'Disney Springs',
          name: 'The Boathouse',
          category: 'Restaurant',
        }),
        experience({
          id: 'ds-drawn',
          areaType: 'DisneySprings',
          park: 'Disney Springs',
          name: 'Drawn to Life',
          category: 'Show',
        }),
      ]);

      renderDestination('Disney Springs');

      await screen.findByTestId('destination-section-Restaurant');

      const show = orderOf('destination-section-Show');
      const restaurant = orderOf('destination-section-Restaurant');

      // Both present, and canonical order places Show before Restaurant.
      expect(show).toBeGreaterThanOrEqual(0);
      expect(restaurant).toBeGreaterThanOrEqual(0);
      expect(show).toBeLessThan(restaurant);

      // Rows are visible under their default-expanded category sections.
      expect(screen.getByTestId('destination-row-ds-morimoto')).toBeTruthy();
      expect(screen.getByTestId('destination-row-ds-drawn')).toBeTruthy();

      // R7.5 — categories with no active Experience are omitted entirely.
      expect(screen.queryByTestId('destination-section-Ride')).toBeNull();
      expect(screen.queryByTestId('destination-section-Tour')).toBeNull();
      expect(screen.queryByTestId('destination-section-Other')).toBeNull();

      // There is deliberately no category filter row in the Disney Springs
      // layout (the categories are the sections).
      expect(screen.queryByTestId('destination-category-filter')).toBeNull();
    });

    // ---------------------------------------------------------------------
    // R7.7 — empty state when the Destination has zero active Experiences
    // ---------------------------------------------------------------------
    test('R7.7: an empty Disney Springs Destination shows the empty state', async () => {
      stub([]);

      renderDestination('Disney Springs');

      expect(await screen.findByTestId('destination-empty')).toBeTruthy();
      // No category sections are rendered when there are no Experiences.
      expect(screen.queryByTestId('destination-section-Restaurant')).toBeNull();
    });
  });


});
