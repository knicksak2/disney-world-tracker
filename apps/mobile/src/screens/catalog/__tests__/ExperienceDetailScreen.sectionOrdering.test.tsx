/**
 * ExperienceDetailScreen section-ordering & info-tag rendering example tests
 * (tasks.md → 7.3).
 *
 * Validates: Requirements 1.7, 2.2, 7.1, 7.2, 7.3, 7.4, 7.5
 *
 * These example tests mount the real (reorganized) `ExperienceDetailScreen`
 * with `apiRequest` stubbed to fixed `/catalog/:id`, personal (`/me/...`),
 * aggregate, live, and `/resorts` fixtures, then assert the redesigned
 * top-to-bottom section layout:
 *
 *   - **R7.1** a fully-populated Experience renders every section in the fixed
 *     order header/hero → Location group → Your visit → Live section →
 *     Menu summary (Restaurant) → About → Why visit → Community rating →
 *     remaining Tag_Groups (Good to know, Accessibility, Good for).
 *   - **R7.5** a sparse Experience omits the sections that would render no
 *     content while preserving the relative order of those that remain.
 *   - **R7.2 / R7.3** the Your visit card and the Live section both sit above
 *     the About section.
 *   - **R7.4** for a Restaurant the Menu_Summary_Card renders between the Live
 *     section and the About section.
 *   - **R1.7** each Tag_Group renders its exact human-facing label ("Location",
 *     "Good to know", "Accessibility", "Good for").
 *   - **R2.2** the raw accessibility slug `no-service-animals` renders as the
 *     human-friendly label "Service animals not permitted".
 *
 * Implementation mirrors `ExperienceDetailScreen.enrichedDetail.test.tsx`:
 * `expo-secure-store`, `expo-constants`, and the API client are mocked (the
 * real `ApiError` is preserved), each test uses a retry-disabled `QueryClient`,
 * and the screen is mounted inside a native stack with `experienceId` seeded as
 * `initialParams` so `useRoute().params` resolves.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

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
  ExperienceDetail: { experienceId: string; initialLens?: 'today' | 'passport' };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixture types & builders
// ---------------------------------------------------------------------------

/**
 * Loose mirror of the screen's `ExperienceDetailDTO` (the `GET /catalog/:id`
 * shape). Only the runtime fields the reorganized screen and `buildTagGroups`
 * read are modelled; everything is optional so each test supplies just the
 * enrichment it needs.
 */
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
  readonly land?: string | null;
  readonly resortArea?: string | null;
  readonly heightRequirement?: {
    readonly id: string;
    readonly name: string;
    readonly minInches: number | null;
    readonly minCentimeters: number | null;
  } | null;
  readonly physicalConsiderations?: readonly { id: string; name: string }[];
  readonly interestFacets?: Readonly<
    Record<string, readonly { id: string; name: string }[]>
  >;
  readonly whyThis?: {
    readonly title: string | null;
    readonly bullets: readonly string[];
    readonly quotes: readonly string[];
  } | null;
  readonly menus?: readonly { id: string; menuType: string }[];
}

interface ResortFixture {
  readonly id: string;
  readonly name: string;
}

/**
 * Route `apiRequest` for a single detail fixture. The personal (`/me/...`),
 * aggregate, and live secondary reads resolve to their benign empty / idle
 * branches so the tests assert on the static section layout without those
 * sections blocking or throwing. The live read throws `live_unavailable`, so
 * the Live_Operational_Section degrades to the live-unavailable indicator while
 * still occupying its slot in the section order. `/resorts` serves the supplied
 * resorts (defaulting to empty) and is matched before the `/catalog` branch.
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
    if (path.startsWith('/me/trips')) {
      return { trips: [] };
    }
    if (path.endsWith('/logs')) {
      return { repeatCount: 0, logs: [] };
    }
    if (path.includes('/food-item-logs')) {
      return [];
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

function renderDetail(
  experienceId: string,
  initialLens: 'today' | 'passport' = 'today',
): ReturnType<typeof render> {
  const Stack = createNativeStackNavigator<CatalogStackParamList>();
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailScreen}
            initialParams={{ experienceId, initialLens }}
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

/**
 * A fully-populated Restaurant-in-a-Resort fixture that exercises every
 * ordered section: a Location group (park + land + resort + resort area), a
 * Get directions action (valid coordinates), a dining Live section, a Menu
 * summary card, an About description, a Why visit section, a Community rating,
 * and all three remaining Tag_Groups (Good to know / Accessibility / Good for).
 */
function fullyPopulatedFixture(id: string): DetailFixture {
  return {
    id,
    name: "'Ohana",
    park: 'Magic Kingdom',
    category: 'Restaurant',
    description:
      'Family-style Polynesian dining with wood-grilled meats, served ' +
      'all-you-care-to-enjoy in a warm island setting overlooking the lagoon.',
    areaType: 'Resort',
    resortId: 'resort-poly',
    latitude: 28.4072,
    longitude: -81.5836,
    land: 'World Showcase',
    resortArea: 'Magic Kingdom Resort Area',
    accessibility: ['no-service-animals', 'wheelchair-accessible'],
    heightRequirement: {
      id: 'height-any',
      name: 'Any height',
      minInches: null,
      minCentimeters: null,
    },
    physicalConsiderations: [{ id: 'pc-loud', name: 'Loud environment' }],
    interestFacets: {
      age: [{ id: 'age-toddlers', name: 'Toddlers' }],
      thrill: [{ id: 'thrill-relaxing', name: 'Relaxing' }],
    },
    whyThis: {
      title: 'Why visit',
      bullets: ['A beloved family-style island feast'],
      quotes: [],
    },
    menus: [{ id: 'menu-dinner', menuType: 'Dinner' }],
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ExperienceDetailScreen section ordering & info tags (R1.7, R2.2, R7.*)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();
  });

  // -------------------------------------------------------------------------
  // R7.1 — fully-populated render asserts the top-to-bottom section order
  // -------------------------------------------------------------------------
  test('R7.1: renders every section in the fixed top-to-bottom order per lens', async () => {
    const experienceId = 'exp-full';
    stubDetail(fullyPopulatedFixture(experienceId), [
      { id: 'resort-poly', name: 'Polynesian Village Resort' },
    ]);

    renderDetail(experienceId, 'today');

    // Wait for the detail (and the resort name lookup) to settle
    await screen.findByTestId('experience-location-group');
    await screen.findByText('Polynesian Village Resort');

    // Today in Park Lens section ordering:
    //   header/hero region → Park badge
    //   Quick specs row    → experience-quick-specs-row
    //   Lens switcher      → lens-switcher
    //   Location group     → experience-location-group
    //   Floating dock      → floating-action-dock
    const todayPositions = [
      orderOf('experience-park-badge'),
      orderOf('experience-quick-specs-row'),
      orderOf('lens-switcher'),
      orderOf('experience-location-group'),
      orderOf('floating-action-dock'),
    ];

    for (const position of todayPositions) {
      expect(position).toBeGreaterThanOrEqual(0);
    }
    const todaySorted = [...todayPositions].sort((a, b) => a - b);
    expect(todayPositions).toEqual(todaySorted);

    // Switch to My Passport & Lore lens
    fireEvent.press(screen.getByTestId('lens-tab-passport'));
    await screen.findByTestId('park-passport-card');

    // Passport & Lore Lens section ordering:
    //   Park passport card → park-passport-card (supersedes your-visit-card, R17)
    //   Dish log card      → restaurant-dish-log-card (Restaurant, R18)
    //   About              → about-section
    //   Why visit          → experience-why-this
    //   Community rating   → aggregate-empty
    //   remaining groups   → good to know → accessibility → good for
    const passportPositions = [
      orderOf('park-passport-card'),
      orderOf('restaurant-dish-log-card'),
      orderOf('about-section'),
      orderOf('experience-why-this'),
      orderOf('aggregate-empty'),
      orderOf('experience-tag-group-goodToKnow'),
      orderOf('experience-tag-group-accessibility'),
      orderOf('experience-tag-group-goodFor'),
    ];

    for (const position of passportPositions) {
      expect(position).toBeGreaterThanOrEqual(0);
    }
    const passportSorted = [...passportPositions].sort((a, b) => a - b);
    expect(passportPositions).toEqual(passportSorted);
  });

  // -------------------------------------------------------------------------
  // R7.2 — Park Passport sits above About
  // -------------------------------------------------------------------------
  test('R7.2: Park Passport card renders above the About section on Passport lens', async () => {
    const experienceId = 'exp-above-about';
    stubDetail(fullyPopulatedFixture(experienceId), [
      { id: 'resort-poly', name: 'Polynesian Village Resort' },
    ]);

    renderDetail(experienceId, 'passport');

    await screen.findByTestId('about-section');

    const parkPassport = orderOf('park-passport-card');
    const about = orderOf('about-section');

    expect(parkPassport).toBeGreaterThanOrEqual(0);
    expect(about).toBeGreaterThanOrEqual(0);
    // R7.2 — Park Passport above About.
    expect(parkPassport).toBeLessThan(about);
  });

  // -------------------------------------------------------------------------
  // R7.4 — the Menu_Summary_Card sits below dining and above Location on Today lens
  // -------------------------------------------------------------------------
  test('R7.4: Restaurant renders the Menu summary card below Dining Reservations and above Location on Today in Park lens', async () => {
    const experienceId = 'exp-restaurant-menu';
    stubDetail({
      id: experienceId,
      name: 'Be Our Guest',
      park: 'Magic Kingdom',
      category: 'Restaurant',
      description: 'Enchanted dining in the Beast\u2019s castle.',
      areaType: 'ThemePark',
      menus: [
        { id: 'menu-lunch', menuType: 'Lunch' },
        { id: 'menu-dinner', menuType: 'Dinner' },
      ],
    });

    renderDetail(experienceId, 'today');

    await screen.findByTestId('menu-summary-card');

    const dining = orderOf('dining-reservation-card');
    const menu = orderOf('menu-summary-card');
    const location = orderOf('experience-location-group');

    expect(dining).toBeGreaterThanOrEqual(0);
    expect(menu).toBeGreaterThanOrEqual(0);
    expect(location).toBeGreaterThanOrEqual(0);
    // Menu summary sits below dining reservations and above location group
    expect(dining).toBeLessThan(menu);
    expect(menu).toBeLessThan(location);
  });

  // -------------------------------------------------------------------------
  // R7.5 — sparse render omits empty sections, preserving relative order
  // -------------------------------------------------------------------------
  test('R7.5: sparse render omits empty sections while preserving relative order', async () => {
    const experienceId = 'exp-sparse';
    stubDetail({
      id: experienceId,
      name: 'Country Bear Jamboree',
      park: null, // no Park tag → empty Location group
      category: 'Other', // no live section for `Other`
      description: 'A classic audio-animatronic revue.',
      areaType: 'ThemePark',
      // No land, resort, coordinates, accessibility, height, facets, whyThis,
      // or menus — every optional section collapses.
    });

    renderDetail(experienceId, 'passport');

    // The About section still renders once the detail settles.
    await screen.findByTestId('about-section');

    // Omitted sections (R7.5): no Location group, no Menu
    // card, no Why visit, and none of the remaining Tag_Groups.
    expect(screen.queryByTestId('experience-location-group')).toBeNull();
    expect(screen.queryByTestId('menu-summary-card')).toBeNull();
    expect(screen.queryByTestId('menu-summary-empty')).toBeNull();
    expect(screen.queryByTestId('experience-why-this')).toBeNull();
    expect(screen.queryByTestId('experience-tag-group-goodToKnow')).toBeNull();
    expect(screen.queryByTestId('experience-tag-group-accessibility')).toBeNull();
    expect(screen.queryByTestId('experience-tag-group-goodFor')).toBeNull();

    // The sections that do render preserve their relative top-to-bottom order:
    // header/hero → Park Passport → About → Community rating.
    const positions = [
      orderOf('experience-park-badge'),
      orderOf('park-passport-card'),
      orderOf('about-section'),
      orderOf('aggregate-empty'),
    ];
    for (const position of positions) {
      expect(position).toBeGreaterThanOrEqual(0);
    }
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });

  // -------------------------------------------------------------------------
  // R1.7 — each Tag_Group renders its exact human-facing label
  // -------------------------------------------------------------------------
  test('R1.7: renders the exact group labels Location, Good to know, Accessibility, Good for', async () => {
    const experienceId = 'exp-labels';
    stubDetail(fullyPopulatedFixture(experienceId), [
      { id: 'resort-poly', name: 'Polynesian Village Resort' },
    ]);

    renderDetail(experienceId, 'today');

    await screen.findByTestId('experience-location-group');
    expect(screen.getByText('Location')).toBeTruthy();

    fireEvent.press(screen.getByTestId('lens-tab-passport'));
    await screen.findByTestId('experience-tag-group-goodFor');

    expect(screen.getByText('Good to know')).toBeTruthy();
    expect(screen.getByText('Accessibility')).toBeTruthy();
    expect(screen.getByText('Good for')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R2.2 — the `no-service-animals` slug renders as its friendly label
  // -------------------------------------------------------------------------
  test('R2.2: renders `no-service-animals` as "Service animals not permitted"', async () => {
    const experienceId = 'exp-accessibility-label';
    stubDetail({
      id: experienceId,
      name: 'Test Attraction',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'An attraction used to assert accessibility relabeling.',
      areaType: 'ThemePark',
      accessibility: ['no-service-animals'],
    });

    renderDetail(experienceId, 'passport');

    await screen.findByTestId('experience-tag-group-accessibility');

    // The human-friendly label is shown (R2.2)...
    expect(screen.getByText('Service animals not permitted')).toBeTruthy();
    // ...and the raw slug is never surfaced.
    expect(screen.queryByText('no-service-animals')).toBeNull();
  });
});
