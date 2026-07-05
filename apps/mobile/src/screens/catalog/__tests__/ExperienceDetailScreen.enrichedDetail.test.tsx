/**
 * ExperienceDetailScreen enriched-detail component tests.
 *
 * Validates: Requirements (experience-detail-redesign) 1.2, 1.6, 4.3, 4.6,
 *            6.1, 7.1, 8.x
 *
 * These component tests mount the real `ExperienceDetailScreen` with
 * `apiRequest` stubbed to fixed `/catalog/:id`, personal (`/me/...`),
 * aggregate, live, and `/resorts` fixtures and assert the redesigned, grouped
 * enrichment layout: the flat `experience-info-tags` row has been replaced by
 * labelled Tag_Group cards (`experience-location-group`,
 * `experience-tag-group-goodToKnow`, `experience-tag-group-accessibility`,
 * `experience-tag-group-goodFor`), each holding individual
 * `experience-info-tag-{kind}` badges:
 *
 *   - present enrichment renders in its assigned group, in the fixed section
 *     order (Location group first, then the remaining groups), with the park
 *     and land surfaced inside the Location group;
 *
 *   - raw coordinates are no longer a tag — valid coordinates power the
 *     `experience-get-directions` action within the Location group, and invalid
 *     or partial coordinates omit it;
 *
 *   - absent / empty enrichment omits the corresponding tags and, when a group
 *     has no tags, the whole group card (including the Location group);
 *
 *   - the three personal controls now live in a single consolidated
 *     `your-visit-card`, and the About / Community sections still render.
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

describe('ExperienceDetailScreen grouped enrichment layout', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();
  });

  // -------------------------------------------------------------------------
  // R1.2 / R7.1 — present enrichment renders in its assigned group, in section
  // order; coordinates power the Get directions action rather than a tag.
  // -------------------------------------------------------------------------
  test('R1.2/R7.1: park and land render in the Location group and accessibility values in the Accessibility group, in section order', async () => {
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

    // The Location Tag_Group card appears once the detail query settles.
    await screen.findByTestId('experience-location-group');

    // The Location group surfaces the park and land tags.
    expect(screen.getByTestId('experience-info-tag-park')).toBeTruthy();
    expect(screen.getByTestId('experience-info-tag-land')).toBeTruthy();

    // The Accessibility group surfaces one badge per persisted value.
    expect(
      screen.getByTestId('experience-tag-group-accessibility'),
    ).toBeTruthy();
    expect(
      screen.getAllByTestId('experience-info-tag-accessibility'),
    ).toHaveLength(2);

    // Raw coordinates are no longer a tag; valid coordinates power the
    // Get directions action inside the Location group instead (R4.2).
    expect(screen.queryByTestId('experience-info-tag-coordinates')).toBeNull();
    expect(screen.getByTestId('experience-get-directions')).toBeTruthy();

    // This ThemePark Experience references no Resort, so no resort tag.
    expect(screen.queryByTestId('experience-info-tag-resort')).toBeNull();

    // Fixed relative order (R1.2, R7.1): park before land within the Location
    // group, and the Location group renders above the Accessibility group.
    const park = orderOf('experience-info-tag-park');
    const land = orderOf('experience-info-tag-land');
    const locationGroup = orderOf('experience-location-group');
    const accessibilityGroup = orderOf('experience-tag-group-accessibility');

    expect(park).toBeGreaterThanOrEqual(0);
    expect(park).toBeLessThan(land);
    expect(locationGroup).toBeGreaterThanOrEqual(0);
    expect(locationGroup).toBeLessThan(accessibilityGroup);

    // The visible values carry the persisted enrichment verbatim.
    expect(screen.getAllByText('Magic Kingdom').length).toBeGreaterThan(0);
    expect(screen.getByText('Tomorrowland')).toBeTruthy();
    expect(screen.getByText('Wheelchair Accessible')).toBeTruthy();
    expect(screen.getByText('Service Animals')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R1.2 — the specific-Resort tag renders inside the Location group for a
  // Resort area with a resolvable Resort name.
  // -------------------------------------------------------------------------
  test('R1.2: a Resort-area Experience with a resolvable Resort renders the resort tag in the Location group', async () => {
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

    await screen.findByTestId('experience-location-group');

    // The resolved Resort name renders as the resort tag within the Location group.
    expect(screen.getByTestId('experience-info-tag-resort')).toBeTruthy();
    expect(screen.getByText('Polynesian Village Resort')).toBeTruthy();

    // The resort tag lives inside the Location group card.
    const locationGroup = orderOf('experience-location-group');
    const resort = orderOf('experience-info-tag-resort');

    expect(locationGroup).toBeGreaterThanOrEqual(0);
    expect(resort).toBeGreaterThanOrEqual(0);
    expect(locationGroup).toBeLessThan(resort);
  });

  // -------------------------------------------------------------------------
  // R1.6 — absent enrichment omits the corresponding tags and the optional
  // Tag_Group cards; only the park remains in the Location group.
  // -------------------------------------------------------------------------
  test('R1.6: an Experience with no enrichment beyond its park omits the other tags and optional groups', async () => {
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

    // ...the only Location enrichment is the park, so the Location group shows
    // the park tag but none of land / resort / resort-area (R1.6).
    expect(screen.getByTestId('experience-info-tag-park')).toBeTruthy();
    expect(screen.queryByTestId('experience-info-tag-land')).toBeNull();
    expect(screen.queryByTestId('experience-info-tag-resort')).toBeNull();
    expect(screen.queryByTestId('experience-info-tag-resortArea')).toBeNull();

    // Raw coordinates are never a tag, and none are present so there is no
    // Get directions action either.
    expect(screen.queryByTestId('experience-info-tag-coordinates')).toBeNull();
    expect(screen.queryByTestId('experience-get-directions')).toBeNull();

    // The optional Tag_Group cards are omitted entirely when they have no tags.
    expect(screen.queryByTestId('experience-tag-group-goodToKnow')).toBeNull();
    expect(screen.queryByTestId('experience-tag-group-accessibility')).toBeNull();
    expect(screen.queryByTestId('experience-tag-group-goodFor')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R4.3 — partial coordinates omit the Get directions action while present
  // enrichment (land) still renders.
  // -------------------------------------------------------------------------
  test('R4.3: the Get directions action is omitted when only one coordinate is present', async () => {
    const experienceId = 'exp-partial';
    stubDetail({
      id: experienceId,
      name: 'Jungle Cruise',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'A guided riverboat tour.',
      areaType: 'ThemePark',
      land: 'Adventureland',
      latitude: 28.418, // longitude absent → invalid coordinates (R4.3)
    });

    renderDetail(experienceId);

    await screen.findByTestId('experience-location-group');

    // Land is present in the Location group...
    expect(screen.getByTestId('experience-info-tag-land')).toBeTruthy();
    // ...coordinates are never a tag, and with only latitude the coordinates
    // are invalid so the Get directions action is omitted (R4.3).
    expect(screen.queryByTestId('experience-info-tag-coordinates')).toBeNull();
    expect(screen.queryByTestId('experience-get-directions')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R1.6 — resort tag omitted when the referenced Resort name is unavailable;
  // with no other Location enrichment the whole Location group is omitted.
  // -------------------------------------------------------------------------
  test('R1.6: the resort tag is omitted when the referenced Resort name is unavailable', async () => {
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

    // Wait for a stable, always-present section before asserting omissions.
    await screen.findByTestId('your-visit-card');

    // The resort tag is omitted because the resolved name is unavailable.
    expect(screen.queryByTestId('experience-info-tag-resort')).toBeNull();
    // With no park, land, resort, or resort-area, the Location group is omitted
    // entirely (R1.6).
    expect(screen.queryByTestId('experience-location-group')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R6.1 / R8 — the description, the consolidated "Your visit" card, and the
  // Community section all continue to render.
  // -------------------------------------------------------------------------
  test('R6.1/R8: description, the "Your visit" card, and the community section still render', async () => {
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

    // About / description section.
    await screen.findByText('A haunted doombuggy dark ride.');
    expect(screen.getByText('About')).toBeTruthy();

    // The Park / category badge presentation is preserved alongside the tags.
    expect(screen.getByTestId('experience-park-badge')).toBeTruthy();
    expect(screen.getByTestId('experience-category-badge')).toBeTruthy();

    // The completion, rating, and note controls now live in a single
    // consolidated "Your visit" card (R6.1); the community section persists.
    expect(screen.getByTestId('your-visit-card')).toBeTruthy();
    expect(screen.getByText('Your visit')).toBeTruthy();
    expect(screen.getByText('Community Rating')).toBeTruthy();

    // The empty personal-section states still resolve through their own paths.
    await waitFor(() => {
      expect(screen.getByTestId('rating-empty')).toBeTruthy();
      expect(screen.getByTestId('note-empty')).toBeTruthy();
    });
  });
});
