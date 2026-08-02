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
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ExperienceDTO, ResortDTO } from '@dwt/shared';

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

function resort(
  overrides: Partial<ResortDTO> & Pick<ResortDTO, 'id' | 'name'>,
): ResortDTO {
  return {
    description: null,
    imageUrl: null,
    latitude: null,
    longitude: null,
    address: null,
    phone: null,
    representingExperienceId: null,
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
function stub(
  experiences: readonly ExperienceDTO[],
  resorts: readonly ResortDTO[] = [],
): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.startsWith('/resorts')) {
      return { resorts };
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
  // Theme / water-park layout (Magic Kingdom)
  // =========================================================================
  describe('theme/water-park layout', () => {
    // Lands chosen with mixed casing so case-insensitive ordering is exercised:
    // case-insensitive → Adventureland < Fantasyland < tomorrowland, whereas a
    // case-sensitive ASCII sort would order the lowercase `tomorrowland` first.
    function magicKingdomFixture(): readonly ExperienceDTO[] {
      return [
        experience({
          id: 'mk-space',
          areaType: 'ThemePark',
          park: 'Magic Kingdom',
          name: 'Space Mountain',
          land: 'tomorrowland',
          category: 'Ride',
        }),
        experience({
          id: 'mk-teacups',
          areaType: 'ThemePark',
          park: 'Magic Kingdom',
          name: 'Mad Tea Party',
          land: 'Fantasyland',
          category: 'Ride',
        }),
        experience({
          id: 'mk-jungle',
          areaType: 'ThemePark',
          park: 'Magic Kingdom',
          name: 'Jungle Cruise',
          land: 'Adventureland',
          category: 'Ride',
        }),
        experience({
          id: 'mk-crystal',
          areaType: 'ThemePark',
          park: 'Magic Kingdom',
          name: 'Crystal Palace',
          land: 'Fantasyland',
          category: 'Restaurant',
        }),
        experience({
          id: 'mk-flag',
          areaType: 'ThemePark',
          park: 'Magic Kingdom',
          name: 'Flag Retreat',
          land: null,
          category: 'Show',
        }),
      ];
    }

    // ---------------------------------------------------------------------
    // R6.2 — Land sections in case-insensitive order + catch-all last
    // R6.4 — sections default-expanded so rows are visible
    // ---------------------------------------------------------------------
    test('R6.2/R6.4: Land sections render case-insensitively ordered with catch-all last and default-expanded rows', async () => {
      stub(magicKingdomFixture());

      renderDestination('Magic Kingdom');

      await screen.findByTestId('destination-section-Fantasyland');

      const adventureland = orderOf('destination-section-Adventureland');
      const fantasyland = orderOf('destination-section-Fantasyland');
      const tomorrowland = orderOf('destination-section-tomorrowland');
      const catchall = orderOf('destination-section-__land_catchall__');

      // All four sections render (three named Lands + the Land_Catchall).
      expect(adventureland).toBeGreaterThanOrEqual(0);
      expect(fantasyland).toBeGreaterThanOrEqual(0);
      expect(tomorrowland).toBeGreaterThanOrEqual(0);
      expect(catchall).toBeGreaterThanOrEqual(0);

      // R6.2 — case-insensitive ascending Land order, catch-all appended last.
      expect(adventureland).toBeLessThan(fantasyland);
      expect(fantasyland).toBeLessThan(tomorrowland);
      expect(tomorrowland).toBeLessThan(catchall);

      // R6.4 — every section opens expanded, so its Experience rows are visible
      // on first render (no header tap required).
      expect(screen.getByTestId('destination-row-mk-space')).toBeTruthy();
      expect(screen.getByTestId('destination-row-mk-teacups')).toBeTruthy();
      expect(screen.getByTestId('destination-row-mk-jungle')).toBeTruthy();
      expect(screen.getByTestId('destination-row-mk-crystal')).toBeTruthy();
      expect(screen.getByTestId('destination-row-mk-flag')).toBeTruthy();
    });

    // ---------------------------------------------------------------------
    // R6.4 / R6.5 — default expanded, and a header tap collapses the section
    // ---------------------------------------------------------------------
    test('R6.5: toggling a Land section header collapses its rows', async () => {
      stub(magicKingdomFixture());

      renderDestination('Magic Kingdom');

      await screen.findByTestId('destination-section-tomorrowland');
      // Default-expanded: Space Mountain is visible before any interaction.
      expect(screen.getByTestId('destination-row-mk-space')).toBeTruthy();

      // Collapse the Tomorrowland section via its header.
      fireEvent.press(
        screen.getByTestId('destination-section-tomorrowland-header'),
      );

      // Its only row is no longer rendered, while other sections stay expanded.
      expect(screen.queryByTestId('destination-row-mk-space')).toBeNull();
      expect(screen.getByTestId('destination-row-mk-teacups')).toBeTruthy();
    });

    // ---------------------------------------------------------------------
    // R6.8 / R6.9 — category filter preserves grouping and drops empty sections
    // ---------------------------------------------------------------------
    test('R6.8/R6.9: selecting a category filters within Land grouping and omits emptied sections', async () => {
      stub(magicKingdomFixture());

      renderDestination('Magic Kingdom');

      await screen.findByTestId('destination-category-filter');
      // Before filtering, the Ride-only Tomorrowland section is present.
      expect(screen.getByTestId('destination-section-tomorrowland')).toBeTruthy();

      // Activate the Restaurant category chip.
      fireEvent.press(screen.getByTestId('destination-category-Restaurant'));

      // R6.8 — Fantasyland (the only Land with a Restaurant, Crystal Palace) is
      // preserved with its matching Experience...
      expect(screen.getByTestId('destination-section-Fantasyland')).toBeTruthy();
      expect(screen.getByTestId('destination-row-mk-crystal')).toBeTruthy();

      // ...while the Ride/Show-only Experiences are filtered out.
      expect(screen.queryByTestId('destination-row-mk-space')).toBeNull();
      expect(screen.queryByTestId('destination-row-mk-teacups')).toBeNull();
      expect(screen.queryByTestId('destination-row-mk-flag')).toBeNull();

      // R6.9 — Land sections left with no matching Experience are omitted.
      expect(
        screen.queryByTestId('destination-section-Adventureland'),
      ).toBeNull();
      expect(
        screen.queryByTestId('destination-section-tomorrowland'),
      ).toBeNull();
      expect(
        screen.queryByTestId('destination-section-__land_catchall__'),
      ).toBeNull();
    });
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

  // =========================================================================
  // Resorts layout
  // =========================================================================
  describe('Resorts layout', () => {
    function resortsFixture(): {
      readonly experiences: readonly ExperienceDTO[];
      readonly resorts: readonly ResortDTO[];
    } {
      return {
        experiences: [
          experience({
            id: 'poly-ohana',
            areaType: 'Resort',
            name: "'Ohana",
            category: 'Restaurant',
            resortId: 'resort-poly',
          }),
          // References a resortId that matches no active Resort → catch-all.
          experience({
            id: 'exp-ghost',
            areaType: 'Resort',
            name: 'Phantom Lounge',
            category: 'Restaurant',
            resortId: 'resort-missing',
          }),
          // References no Resort at all → catch-all.
          experience({
            id: 'exp-cart',
            areaType: 'Resort',
            name: 'Wandering Cart',
            category: 'Recreation',
          }),
        ],
        resorts: [
          // Contemporary has no Experiences → an empty, still-browsable anchor.
          resort({ id: 'resort-contemp', name: 'Contemporary Resort' }),
          resort({ id: 'resort-poly', name: 'Polynesian Village Resort' }),
        ],
      };
    }

    // ---------------------------------------------------------------------
    // R8.3 / R8.4 / R8.7 — anchors (incl. empty), catch-all, empty indication
    // ---------------------------------------------------------------------
    test('R8.3/R8.4/R8.7: every Resort is a collapsible section (incl. empty); expanding reveals its Experiences and the catch-all', async () => {
      const { experiences, resorts } = resortsFixture();
      stub(experiences, resorts);

      renderDestination('Resorts');

      await screen.findByTestId('destination-resort-resort-poly');

      // R8.3 — every active Resort renders as a section header, including the
      // Contemporary Resort that has no associated Experiences.
      const contemp = orderOf('destination-resort-resort-contemp');
      const poly = orderOf('destination-resort-resort-poly');
      const catchall = orderOf('destination-resort-__resort_catchall__');

      expect(contemp).toBeGreaterThanOrEqual(0);
      expect(poly).toBeGreaterThanOrEqual(0);
      expect(catchall).toBeGreaterThanOrEqual(0);

      // Case-insensitive name order (Contemporary < Polynesian), catch-all last.
      expect(contemp).toBeLessThan(poly);
      expect(poly).toBeLessThan(catchall);

      // Collapsed by default — no Experience rows are shown until a section is
      // expanded.
      expect(screen.queryByTestId('destination-row-poly-ohana')).toBeNull();

      // R8.2 — expanding Polynesian reveals 'Ohana beneath it.
      fireEvent.press(
        screen.getByTestId('destination-resort-resort-poly-header'),
      );
      expect(screen.getByTestId('destination-row-poly-ohana')).toBeTruthy();

      // R8.4 — expanding the catch-all reveals both the unmatched-resortId and
      // the no-resortId Experiences.
      fireEvent.press(
        screen.getByTestId('destination-resort-__resort_catchall__-header'),
      );
      expect(screen.getByTestId('destination-row-exp-ghost')).toBeTruthy();
      expect(screen.getByTestId('destination-row-exp-cart')).toBeTruthy();

      // R8.7 — expanding the empty Contemporary section shows its empty-group
      // indication, while the Polynesian section (which has 'Ohana) does not.
      fireEvent.press(
        screen.getByTestId('destination-resort-resort-contemp-header'),
      );
      expect(
        screen.getByTestId('destination-resort-empty-resort-contemp'),
      ).toBeTruthy();
      expect(
        screen.queryByTestId('destination-resort-empty-resort-poly'),
      ).toBeNull();
    });

    // ---------------------------------------------------------------------
    // Tapping a Resort section header expands/collapses it, staying on screen
    // ---------------------------------------------------------------------
    test('tapping a Resort section header expands then collapses it in place', async () => {
      const { experiences, resorts } = resortsFixture();
      stub(experiences, resorts);

      renderDestination('Resorts');

      const polyHeader = await screen.findByTestId(
        'destination-resort-resort-poly-header',
      );

      // Collapsed initially.
      expect(screen.queryByTestId('destination-row-poly-ohana')).toBeNull();

      // Tap to expand — the Resort's Experiences appear.
      fireEvent.press(polyHeader);
      expect(screen.getByTestId('destination-row-poly-ohana')).toBeTruthy();

      // Tap again to collapse — the Experiences are hidden again.
      fireEvent.press(polyHeader);
      expect(screen.queryByTestId('destination-row-poly-ohana')).toBeNull();

      // We remained on the screen throughout.
      expect(
        screen.getByTestId('destination-resort-resort-poly'),
      ).toBeTruthy();
    });
  });
});
