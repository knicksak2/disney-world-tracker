/**
 * ExperienceDetailScreen enriched-detail component tests (tasks.md → 12.2).
 *
 * Validates: Requirements 9.8, 9.10, 9.11
 *
 * These component tests mount the real `ExperienceDetailScreen` with
 * `apiRequest` stubbed to fixed `/catalog/:id`, personal (`/me/...`),
 * aggregate, live, and `/resorts` fixtures and assert the enriched Info_Tag
 * row rendered beneath the Park/category badges:
 *
 *   - **R9.11 / R9.2-R9.7** present tags render in the fixed relative order
 *     Land → price tier → accessibility → coordinates → meal period → resort,
 *     each surfaced through its `experience-info-tag-{kind}` testID.
 *
 *   - **R9.8** absent / empty enrichment values produce no tag: an Experience
 *     with no enrichment renders no `experience-info-tags` row at all, and a
 *     `Resort`-area Experience whose referenced Resort name is unavailable
 *     omits the resort tag.
 *
 *   - **R9.10** the existing detail sections (About/description, live,
 *     completion, rating, note, community rating) continue to render.
 *
 * Implementation mirrors `src/__tests__/emptyStates.test.tsx`: `expo-secure-store`,
 * `expo-constants`, and the API client are mocked (the real `ApiError` is
 * preserved), each test uses a retry-disabled `QueryClient`, and the screen is
 * mounted inside a native stack with `experienceId` seeded as `initialParams`
 * so `useRoute().params` resolves.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

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

import ExperienceDetailScreen from '../ExperienceDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

type CatalogStackParamList = {
  ExperienceDetail: { experienceId: string };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixture types & builders
// ---------------------------------------------------------------------------

/** Mirrors the screen's `ExperienceDetailDTO` (the `GET /catalog/:id` shape). */
interface DetailFixture {
  readonly id: string;
  readonly name: string;
  readonly park: string | null;
  readonly category: string;
  readonly description: string;
  readonly imageUrl?: string | null;
  readonly areaType: string;
  readonly resortId?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly accessibility?: readonly string[];
  readonly priceTier?: string | null;
  readonly mealPeriods?: readonly { type: string; priceTier?: string | null }[];
  readonly land?: string | null;
}

interface ResortFixture {
  readonly id: string;
  readonly name: string;
}

/**
 * Route `apiRequest` for a single detail fixture. The five `/me`/aggregate/live
 * secondary reads are resolved to their benign empty/idle branches so the tests
 * assert on the static detail + Info_Tag rendering without those sections
 * blocking or throwing. `/resorts` serves the supplied resorts (defaulting to
 * empty), and is matched before the `/catalog` prefix branch.
 */
function stubDetail(
  detail: DetailFixture,
  resorts: readonly ResortFixture[] = [],
): void {
  const id = detail.id;
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.startsWith('/resorts')) {
      return { resorts };
    }
    if (path === `/catalog/${id}`) {
      return detail;
    }
    if (path === `/catalog/${id}/live`) {
      // No live detail cached: the live section degrades to the
      // unavailable indicator without affecting the static fields (R9.10).
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
    if (path === `/experiences/${id}/aggregate-rating`) {
      return { value: null, count: 0 };
    }
    throw new Error(`unexpected call to ${path}`);
  });
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderDetail(experienceId: string): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<CatalogStackParamList>();
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

/**
 * Position of a `testID` within the rendered tree, serialized in render order.
 * Elements rendered earlier serialize earlier, so comparing indices yields a
 * reliable relative ordering. Returns -1 when the id is absent.
 */
function orderOf(testID: string): number {
  return JSON.stringify(screen.toJSON()).indexOf(`"testID":"${testID}"`);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ExperienceDetailScreen enriched Info_Tags (R9.8, R9.10, R9.11)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();
  });

  // -------------------------------------------------------------------------
  // R9.11 / R9.2-R9.6 — present tags render in the fixed relative order
  // -------------------------------------------------------------------------
  test('R9.11: Land, price, accessibility, coordinates, and meal-period tags render in fixed order', async () => {
    const experienceId = 'exp-enriched-park';
    stubDetail({
      id: experienceId,
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'A dark indoor roller coaster.',
      areaType: 'ThemePark',
      land: 'Tomorrowland',
      priceTier: '$$',
      accessibility: ['Wheelchair Accessible', 'Service Animals'],
      latitude: 28.4189,
      longitude: -81.5779,
      mealPeriods: [{ type: 'Breakfast' }, { type: 'Dinner' }],
    });

    renderDetail(experienceId);

    // The Info_Tag row appears once the detail query settles.
    await screen.findByTestId('experience-info-tags');

    // Every present tag kind is rendered.
    expect(screen.getByTestId('experience-info-tag-land')).toBeTruthy();
    expect(screen.getByTestId('experience-info-tag-priceTier')).toBeTruthy();
    expect(
      screen.getAllByTestId('experience-info-tag-accessibility'),
    ).toHaveLength(2);
    expect(screen.getByTestId('experience-info-tag-coordinates')).toBeTruthy();
    expect(screen.getAllByTestId('experience-info-tag-mealPeriod')).toHaveLength(
      2,
    );

    // R9.8 — this ThemePark Experience references no Resort, so no resort tag.
    expect(screen.queryByTestId('experience-info-tag-resort')).toBeNull();

    // R9.11 — present tags appear in the canonical relative order
    // Land → price tier → accessibility → coordinates → meal period.
    const land = orderOf('experience-info-tag-land');
    const price = orderOf('experience-info-tag-priceTier');
    const accessibility = orderOf('experience-info-tag-accessibility');
    const coordinates = orderOf('experience-info-tag-coordinates');
    const mealPeriod = orderOf('experience-info-tag-mealPeriod');

    expect(land).toBeGreaterThanOrEqual(0);
    expect(land).toBeLessThan(price);
    expect(price).toBeLessThan(accessibility);
    expect(accessibility).toBeLessThan(coordinates);
    expect(coordinates).toBeLessThan(mealPeriod);

    // The visible values carry the persisted enrichment verbatim.
    expect(screen.getByText('Tomorrowland')).toBeTruthy();
    expect(screen.getByText('$$')).toBeTruthy();
    expect(screen.getByText('Wheelchair Accessible')).toBeTruthy();
    expect(screen.getByText('28.4189, -81.5779')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R9.7 / R9.11 — the specific-Resort tag renders (last) for a Resort area
  // -------------------------------------------------------------------------
  test('R9.7: a Resort-area Experience with a resolvable Resort renders the resort tag last', async () => {
    const experienceId = 'exp-resort-dining';
    stubDetail(
      {
        id: experienceId,
        name: "'Ohana",
        park: null,
        category: 'Restaurant',
        description: 'Family-style Polynesian dining.',
        areaType: 'Resort',
        resortId: 'resort-poly',
        priceTier: '$$$',
      },
      [{ id: 'resort-poly', name: 'Polynesian Village Resort' }],
    );

    renderDetail(experienceId);

    await screen.findByTestId('experience-info-tags');

    const price = orderOf('experience-info-tag-priceTier');
    const resort = orderOf('experience-info-tag-resort');

    expect(price).toBeGreaterThanOrEqual(0);
    expect(resort).toBeGreaterThanOrEqual(0);
    // R9.11 — resort is the last tag, after the price tier.
    expect(price).toBeLessThan(resort);

    expect(screen.getByText('Polynesian Village Resort')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R9.8 — absent enrichment values produce no Info_Tag row at all
  // -------------------------------------------------------------------------
  test('R9.8: an Experience with no enrichment renders no Info_Tag row', async () => {
    const experienceId = 'exp-bare';
    stubDetail({
      id: experienceId,
      name: 'Country Bear Jamboree',
      park: 'Magic Kingdom',
      category: 'Show',
      description: 'A classic audio-animatronic revue.',
      areaType: 'ThemePark',
      // No land, price tier, accessibility, coordinates, meal periods, resort.
    });

    renderDetail(experienceId);

    // The static detail still renders (its description is shown)...
    await screen.findByText('A classic audio-animatronic revue.');

    // ...but the Info_Tag row and every individual tag are omitted (R9.8).
    expect(screen.queryByTestId('experience-info-tags')).toBeNull();
    expect(screen.queryByTestId('experience-info-tag-land')).toBeNull();
    expect(screen.queryByTestId('experience-info-tag-priceTier')).toBeNull();
    expect(screen.queryByTestId('experience-info-tag-coordinates')).toBeNull();
    expect(screen.queryByTestId('experience-info-tag-resort')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R9.8 — a single absent value is omitted while present ones still render
  // -------------------------------------------------------------------------
  test('R9.8: coordinates tag is omitted when only one coordinate is present', async () => {
    const experienceId = 'exp-partial';
    stubDetail({
      id: experienceId,
      name: 'Jungle Cruise',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'A guided riverboat tour.',
      areaType: 'ThemePark',
      land: 'Adventureland',
      latitude: 28.418, // longitude absent → no coordinates tag (R9.5, R9.8)
    });

    renderDetail(experienceId);

    await screen.findByTestId('experience-info-tags');

    // Land is present...
    expect(screen.getByTestId('experience-info-tag-land')).toBeTruthy();
    // ...but the coordinates tag is omitted because longitude is absent.
    expect(screen.queryByTestId('experience-info-tag-coordinates')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R9.8 — resort tag omitted when the referenced Resort name is unavailable
  // -------------------------------------------------------------------------
  test('R9.8: resort tag is omitted when the referenced Resort is not in the list', async () => {
    const experienceId = 'exp-resort-unknown';
    stubDetail(
      {
        id: experienceId,
        name: 'Mystery Lounge',
        park: null,
        category: 'Restaurant',
        description: 'A resort lounge.',
        areaType: 'Resort',
        resortId: 'resort-missing',
        priceTier: '$$',
      },
      // The referenced resort is not present, so its name is unavailable.
      [{ id: 'resort-other', name: 'Grand Floridian Resort' }],
    );

    renderDetail(experienceId);

    await screen.findByTestId('experience-info-tags');

    // Price tier still renders...
    expect(screen.getByTestId('experience-info-tag-priceTier')).toBeTruthy();
    // ...but the resort tag is omitted because the name is unavailable (R9.8).
    expect(screen.queryByTestId('experience-info-tag-resort')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R9.10 — the existing detail sections continue to render unchanged
  // -------------------------------------------------------------------------
  test('R9.10: description and the completion, rating, note, and community sections still render', async () => {
    const experienceId = 'exp-sections';
    stubDetail({
      id: experienceId,
      name: 'Haunted Mansion',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'A haunted doombuggy dark ride.',
      areaType: 'ThemePark',
      land: 'Liberty Square',
    });

    renderDetail(experienceId);

    // Description (About) section (R9.10).
    await screen.findByText('A haunted doombuggy dark ride.');
    expect(screen.getByText('About')).toBeTruthy();

    // The Park badge presentation is preserved (R9.1) alongside the new tags.
    expect(screen.getByTestId('experience-park-badge')).toBeTruthy();
    expect(screen.getByTestId('experience-category-badge')).toBeTruthy();

    // Completion / Rating / Note / Community section labels are all present.
    expect(screen.getByText('Your Completion')).toBeTruthy();
    expect(screen.getByText('Your Rating')).toBeTruthy();
    expect(screen.getByText('Your Note')).toBeTruthy();
    expect(screen.getByText('Community Rating')).toBeTruthy();

    // The empty personal-section states still resolve through their own paths.
    await waitFor(() => {
      expect(screen.getByTestId('rating-empty')).toBeTruthy();
      expect(screen.getByTestId('note-empty')).toBeTruthy();
    });
  });
});
