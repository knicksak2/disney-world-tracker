/**
 * Accessibility tests for the redesigned catalog navigation (tasks.md → 14.2).
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.8
 *
 * Task 14.1 wired the screen-reader affordances into the screens; these tests
 * assert them, using the cleanest mix of pure-component / hook checks and
 * mounted-screen checks:
 *
 *   - **R12.1 — Destination card label.** Each Catalog_Home Destination card
 *     exposes an `accessibilityLabel` of `"{name}, {count} experiences"` with
 *     the count as a numeric value (asserted on the mounted `CatalogScreen`
 *     grid, and on the pure `destinationCardLabel` helper).
 *
 *   - **R12.2 — section expanded/collapsed state.** Each collapsible Land
 *     section header on the `DestinationScreen` exposes
 *     `accessibilityState={{ expanded }}` reflecting its current visual state,
 *     flipping when toggled.
 *
 *   - **R12.3 — category filter chip.** The `Chip` filter control exposes an
 *     accessible label including the category name and a selected /
 *     not-selected state, plus `accessibilityState.selected` (asserted directly
 *     on the `Chip` primitive and on the mounted Destination category filter).
 *
 *   - **R12.4 — search control label.** The Catalog_Home search input exposes
 *     the `accessibilityLabel` "Search experiences" identifying it as search.
 *
 *   - **R12.5 — Info_Tag alternatives.** Each enriched-detail Info_Tag carries
 *     an `accessibilityLabel` conveying its meaning (e.g. "Land: Fantasyland").
 *
 *   - **R12.8 — result-count announcement.** Changing the visible-Experience
 *     set via a category filter announces the updated count within 1 second
 *     through `AccessibilityInfo.announceForAccessibility`; the initial mount
 *     (a baseline, not a filter/search action) announces nothing. Asserted both
 *     on the mounted `DestinationScreen` filter path and on the underlying
 *     `useResultCountAnnouncement` hook.
 *
 * Implementation mirrors `ExperienceDetailScreen.enrichedDetail.test.tsx` and
 * `CatalogScreen.render.test.tsx`: `expo-secure-store`, `expo-constants`, and
 * the API client are mocked (the real `ApiError` preserved), each mounted test
 * uses a retry-disabled `QueryClient`, and screens are rendered inside a
 * `NavigationContainer` + native stack with route params seeded via
 * `initialParams`.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react-native';

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
import DestinationScreen from '../DestinationScreen';
import ExperienceDetailScreen from '../ExperienceDetailScreen';
import { Chip } from '../../../theme/components';
import { destinationCardLabel, type DestinationId } from '../destinations';
import { useResultCountAnnouncement } from '../catalogFocus';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Navigation param lists for the mounted-screen harnesses
// ---------------------------------------------------------------------------

type CatalogStackParamList = {
  CatalogList: undefined;
  DestinationScreen: { destination: DestinationId };
  ExperienceDetail: { experienceId: string };
};

type DetailStackParamList = {
  ExperienceDetail: { experienceId: string };
};

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

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

// ---------------------------------------------------------------------------
// Mounted-screen harnesses
// ---------------------------------------------------------------------------

function renderCatalog(): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<CatalogStackParamList>();
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="CatalogList" component={CatalogScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

function renderDestination(destination: DestinationId): ReturnType<typeof render> {
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

function renderDetail(experienceId: string): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<DetailStackParamList>();
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailScreen}
            initialParams={{ experienceId }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Catalog navigation accessibility (R12.1-R12.5, R12.8)', () => {
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

  // -------------------------------------------------------------------------
  // R12.1 — Destination card screen-reader label
  // -------------------------------------------------------------------------
  describe('R12.1: Destination card label', () => {
    test('destinationCardLabel embeds the name and the count as a numeric value', () => {
      expect(destinationCardLabel('Magic Kingdom', 42)).toBe(
        'Magic Kingdom, 42 experiences',
      );
      expect(destinationCardLabel('Resorts', 0)).toBe('Resorts, 0 experiences');
    });

    test('each grid card exposes accessibilityLabel "{name}, {count} experiences"', async () => {
      apiRequestMock.mockImplementation(async (_method, path) => {
        if (typeof path === 'string' && path.startsWith('/catalog/destinations')) {
          return {
            destinations: [
              { destination: 'Magic Kingdom', count: 42 },
              { destination: 'EPCOT', count: 30 },
              { destination: 'Resorts', count: 7 },
            ],
            staleCache: false,
          };
        }
        throw new Error(`unexpected call to ${String(path)}`);
      });

      renderCatalog();

      const mkCard = await screen.findByTestId(
        'catalog-destination-Magic Kingdom',
      );
      expect(mkCard.props.accessibilityLabel).toBe('Magic Kingdom, 42 experiences');

      // A Destination with no count entry falls back to a numeric zero (R4.6).
      const springs = screen.getByTestId('catalog-destination-Disney Springs');
      expect(springs.props.accessibilityLabel).toBe(
        'Disney Springs, 0 experiences',
      );

      // The aggregate Resorts card reads its aggregate count.
      const resorts = screen.getByTestId('catalog-destination-Resorts');
      expect(resorts.props.accessibilityLabel).toBe('Resorts, 7 experiences');
    });
  });

  // -------------------------------------------------------------------------
  // R12.4 — search control accessible label
  // -------------------------------------------------------------------------
  describe('R12.4: search control label', () => {
    test('the Catalog_Home search input identifies itself as the search input', async () => {
      apiRequestMock.mockImplementation(async (_method, path) => {
        if (typeof path === 'string' && path.startsWith('/catalog/destinations')) {
          return { destinations: [], staleCache: false };
        }
        throw new Error(`unexpected call to ${String(path)}`);
      });

      renderCatalog();

      const searchInput = await screen.findByTestId('catalog-search');
      expect(searchInput.props.accessibilityLabel).toBe('Search experiences');
    });
  });

  // -------------------------------------------------------------------------
  // R12.3 — category filter chip label + state
  // -------------------------------------------------------------------------
  describe('R12.3: category filter chip label and state', () => {
    test('Chip derives a "{label}, selected/not selected" label and sets accessibilityState.selected', () => {
      const { rerender } = render(
        <Chip label="Ride" active={false} onPress={() => {}} testID="chip" />,
      );
      const notSelected = screen.getByTestId('chip');
      expect(notSelected.props.accessibilityLabel).toBe('Ride, not selected');
      expect(notSelected.props.accessibilityState).toEqual({ selected: false });

      rerender(
        <Chip label="Ride" active onPress={() => {}} testID="chip" />,
      );
      const selected = screen.getByTestId('chip');
      expect(selected.props.accessibilityLabel).toBe('Ride, selected');
      expect(selected.props.accessibilityState).toEqual({ selected: true });
    });

    test('the Destination category filter chips carry name + selection state', async () => {
      apiRequestMock.mockImplementation(async (_method, path) => {
        if (typeof path === 'string' && path.startsWith('/catalog')) {
          return {
            experiences: [
              experience({
                id: 'sm',
                areaType: 'ThemePark',
                park: 'Magic Kingdom',
                category: 'Ride',
                land: 'Tomorrowland',
              }),
            ],
            staleCache: false,
          };
        }
        throw new Error(`unexpected call to ${String(path)}`);
      });

      renderDestination('Magic Kingdom');

      // The "All" chip is selected by default (R6.7); the Ride chip is not.
      const allChip = await screen.findByTestId('destination-category-All');
      expect(allChip.props.accessibilityLabel).toBe('All, selected');
      expect(allChip.props.accessibilityState).toEqual({ selected: true });

      const rideChip = screen.getByTestId('destination-category-Ride');
      expect(rideChip.props.accessibilityLabel).toBe('Ride, not selected');
      expect(rideChip.props.accessibilityState).toEqual({ selected: false });

      // Selecting the Ride chip flips both chips' state.
      fireEvent.press(rideChip);
      await waitFor(() => {
        expect(
          screen.getByTestId('destination-category-Ride').props
            .accessibilityState,
        ).toEqual({ selected: true });
      });
      expect(
        screen.getByTestId('destination-category-All').props.accessibilityState,
      ).toEqual({ selected: false });
    });
  });

  // -------------------------------------------------------------------------
  // R12.2 — collapsible section expanded/collapsed state
  // -------------------------------------------------------------------------
  describe('R12.2: section expanded/collapsed state', () => {
    test('a Land section header exposes accessibilityState.expanded, flipping on toggle', async () => {
      apiRequestMock.mockImplementation(async (_method, path) => {
        if (typeof path === 'string' && path.startsWith('/catalog')) {
          return {
            experiences: [
              experience({
                id: 'sm',
                areaType: 'ThemePark',
                park: 'Magic Kingdom',
                category: 'Ride',
                land: 'Tomorrowland',
              }),
            ],
            staleCache: false,
          };
        }
        throw new Error(`unexpected call to ${String(path)}`);
      });

      renderDestination('Magic Kingdom');

      // Sections open expanded by default (R6.4).
      const header = await screen.findByTestId(
        'destination-section-Tomorrowland-header',
      );
      expect(header.props.accessibilityState).toEqual({ expanded: true });
      // The label conveys the section name + its state too.
      expect(header.props.accessibilityLabel).toBe('Tomorrowland, expanded');

      // Toggling collapses it (R6.5), and the state value reflects the change.
      fireEvent.press(header);
      await waitFor(() => {
        expect(
          screen.getByTestId('destination-section-Tomorrowland-header').props
            .accessibilityState,
        ).toEqual({ expanded: false });
      });
      expect(
        screen.getByTestId('destination-section-Tomorrowland-header').props
          .accessibilityLabel,
      ).toBe('Tomorrowland, collapsed');
    });
  });

  // -------------------------------------------------------------------------
  // R12.5 — Info_Tag screen-reader alternatives
  // -------------------------------------------------------------------------
  describe('R12.5: Info_Tag text alternatives', () => {
    test('each rendered Info_Tag carries an accessibilityLabel conveying its meaning', async () => {
      const experienceId = 'exp-a11y-tags';
      apiRequestMock.mockImplementation(async (_method, path) => {
        if (typeof path !== 'string') {
          throw new Error(`unexpected non-string path: ${String(path)}`);
        }
        if (path.startsWith('/resorts')) {
          return { resorts: [] };
        }
        if (path === `/catalog/${experienceId}`) {
          return {
            id: experienceId,
            name: 'Space Mountain',
            park: 'Magic Kingdom',
            category: 'Ride',
            description: 'A dark indoor roller coaster.',
            areaType: 'ThemePark',
            land: 'Fantasyland',
            priceTier: '$$',
            accessibility: ['Wheelchair Accessible'],
            latitude: 28.4189,
            longitude: -81.5779,
            mealPeriods: [{ type: 'Dinner' }],
          };
        }
        if (path === `/catalog/${experienceId}/live`) {
          throw new ApiError({
            code: 'live_unavailable',
            message: 'no live detail',
            status: 503,
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

      renderDetail(experienceId);

      await screen.findByTestId('experience-location-group');

      // Location group tags each expose a meaning-bearing accessibility label
      // (R2.4 / R12.5).
      expect(
        screen.getByTestId('experience-info-tag-park').props.accessibilityLabel,
      ).toBe('Park: Magic Kingdom');
      expect(
        screen.getByTestId('experience-info-tag-land').props.accessibilityLabel,
      ).toBe('Land: Fantasyland');
      // Accessibility group tag.
      expect(
        screen.getByTestId('experience-info-tag-accessibility').props
          .accessibilityLabel,
      ).toBe('Accessibility: Wheelchair Accessible');
      // Raw coordinates are no longer a tag; the Get directions action that
      // replaces them exposes a non-empty accessibility label (R4.6).
      expect(screen.queryByTestId('experience-info-tag-coordinates')).toBeNull();
      expect(
        screen.getByTestId('experience-get-directions').props.accessibilityLabel,
      ).toBe('Get directions to Space Mountain');
    });
  });

  // -------------------------------------------------------------------------
  // R12.8 — result-count announcement
  // -------------------------------------------------------------------------
  describe('R12.8: result-count announcement', () => {
    test('useResultCountAnnouncement stays silent on the baseline and announces subsequent changes', () => {
      const announce = jest
        .spyOn(AccessibilityInfo, 'announceForAccessibility')
        .mockImplementation(() => {});
      announce.mockClear();

      const { rerender, unmount } = renderHook(
        ({ count }: { count: number }) => useResultCountAnnouncement(count),
        { initialProps: { count: 5 } },
      );

      // Initial observation is the baseline — not an announcement.
      expect(announce).not.toHaveBeenCalled();

      // A subsequent change announces the new count with the correct noun.
      rerender({ count: 3 });
      expect(announce).toHaveBeenCalledWith('3 experiences');

      rerender({ count: 1 });
      expect(announce).toHaveBeenCalledWith('1 experience');

      // An unchanged count does not re-announce.
      const callsBefore = announce.mock.calls.length;
      rerender({ count: 1 });
      expect(announce).toHaveBeenCalledTimes(callsBefore);

      // Tear down this hook harness before the next test mounts, so its
      // passive effects cannot flush late onto a subsequent test's spy.
      unmount();
    });

    test('a category-filter change on the DestinationScreen announces the new count, not on mount', async () => {
      const announce = jest
        .spyOn(AccessibilityInfo, 'announceForAccessibility')
        .mockImplementation(() => {});
      // The jest-expo AccessibilityInfo mock is shared across tests; start from
      // a clean call history so the baseline assertion reflects only this
      // screen's mount (verified silent in isolation).
      announce.mockClear();

      apiRequestMock.mockImplementation(async (_method, path) => {
        if (typeof path === 'string' && path.startsWith('/catalog')) {
          return {
            experiences: [
              experience({
                id: 'ride-1',
                areaType: 'ThemePark',
                park: 'Magic Kingdom',
                category: 'Ride',
                land: 'Tomorrowland',
              }),
              experience({
                id: 'show-1',
                areaType: 'ThemePark',
                park: 'Magic Kingdom',
                category: 'Show',
                land: 'Tomorrowland',
              }),
              experience({
                id: 'rest-1',
                areaType: 'ThemePark',
                park: 'Magic Kingdom',
                category: 'Restaurant',
                land: 'Fantasyland',
              }),
            ],
            staleCache: false,
          };
        }
        throw new Error(`unexpected call to ${String(path)}`);
      });

      renderDestination('Magic Kingdom');

      // Baseline: mounting the screen with all three Experiences visible is not
      // itself a filter/search action, so nothing is announced (R12.8).
      const rideChip = await screen.findByTestId('destination-category-Ride');
      expect(announce).not.toHaveBeenCalled();

      // Filtering to Ride reduces the visible set to a single Experience; the
      // updated count is announced within the 1-second budget.
      fireEvent.press(rideChip);
      await waitFor(() => {
        expect(announce).toHaveBeenCalledWith('1 experience');
      });
    });
  });
});
