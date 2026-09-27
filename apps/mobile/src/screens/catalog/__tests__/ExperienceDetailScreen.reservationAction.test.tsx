/**
 * ExperienceDetailScreen Reservation_Action tests
 * (restaurant-menu-display -> tasks.md Task 11).
 *
 * Validates: Requirements 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5
 */

import React from 'react';
import { Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import fc from 'fast-check';
import type { ExperienceCategory, Park } from '@dwt/shared';

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
// Imports of modules under test
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

interface DetailFixture {
  readonly id: string;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly description: string;
  readonly areaType: string;
  readonly diningUrl?: string | null | undefined;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
}

function stubDetail(detail: DetailFixture): void {
  const id = detail.id;
  const encodedId = encodeURIComponent(id);
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.startsWith('/resorts')) {
      return { resorts: [] };
    }
    if (path === `/catalog/${id}` || path === `/catalog/${encodedId}`) {
      return detail;
    }
    if (path === `/catalog/${id}/live` || path === `/catalog/${encodedId}/live`) {
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
    if (
      path === `/me/experiences/${id}/food-logs` ||
      path === `/me/experiences/${encodedId}/food-logs`
    ) {
      return [];
    }
    if (
      path === `/experiences/${id}/aggregate-rating` ||
      path === `/experiences/${encodedId}/aggregate-rating`
    ) {
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ExperienceDetailScreen Reservation_Action (R6.5, R6.6, R6.7, R7.1, R7.2, R7.3, R7.4, R7.5)', () => {
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    apiRequestMock.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();

    openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Property 10: Reservation Action Presence and Target URL
  // -------------------------------------------------------------------------
  // Feature: restaurant-menu-display, Property 10: The Reservation_Action renders exactly when a dining URL is present, and opens that exact URL
  // Validates: Requirements 6.5, 6.6, 6.7, 7.1, 7.2, 7.4
  test(
    'Property 10: The Reservation_Action renders exactly when a dining URL is present, and opens that exact URL',
    async () => {
      const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
        'Restaurant',
        'Ride',
        'Show',
        'Parade',
        'Character_Meet',
        'Other',
      );

      const diningUrlArb: fc.Arbitrary<string | null | undefined> = fc.oneof(
        fc.constant(undefined),
        fc.constant(null),
        fc.constant(''),
        fc.constant('   '),
        fc.webUrl({ validSchemes: ['https'] }),
      );

      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
          categoryArb,
          diningUrlArb,
          async (id, name, category, diningUrl) => {
            openSpy.mockClear();
            const fixture: DetailFixture = {
              id,
              name,
              park: 'Magic Kingdom',
              category,
              description: 'A magical experience description.',
              areaType: 'ThemePark',
              diningUrl,
            };

            stubDetail(fixture);
            const { unmount } = renderDetail(id);

            await screen.findByTestId('experience-detail');

            const isRestaurantWithValidDiningUrl =
              category === 'Restaurant' &&
              typeof diningUrl === 'string' &&
              diningUrl.trim().length > 0;

            const button = screen.queryByTestId('experience-reserve-action');

            if (isRestaurantWithValidDiningUrl) {
              expect(button).not.toBeNull();
              fireEvent.press(button!);
              expect(openSpy).toHaveBeenCalledWith(diningUrl);
            } else {
              expect(button).toBeNull();
            }

            unmount();
          },
        ),
        { numRuns: 100 },
      );
    },
    60000,
  );

  // -------------------------------------------------------------------------
  // Example-based tests (Task 11.3, R7.1-R7.5)
  // -------------------------------------------------------------------------

  test('R7.1, R7.2, R7.5: renders button with correct label/icon and opens exact diningUrl on press', async () => {
    const id = 'restaurant-1';
    const diningUrl =
      'https://disneyworld.disney.go.com/dining/magic-kingdom/cinderella-royal-table/';

    stubDetail({
      id,
      name: "Cinderella's Royal Table",
      park: 'Magic Kingdom',
      category: 'Restaurant',
      description: 'Dine inside the iconic castle.',
      areaType: 'ThemePark',
      diningUrl,
    });

    const { unmount } = renderDetail(id);

    await screen.findByTestId('experience-detail');

    const button = screen.getByTestId('experience-reserve-action');
    expect(button).toBeTruthy();
    expect(screen.getByText(/Reserve on Disney's [Ss]ite/)).toBeTruthy();

    fireEvent.press(button);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(diningUrl);
    expect(screen.queryByTestId('experience-reservation-error')).toBeNull();

    unmount();
  });

  test('R7.3: displays non-blocking inline error on Linking.openURL rejection and preserves screen state, clearing error on subsequent success', async () => {
    const id = 'restaurant-2';
    const diningUrl =
      'https://disneyworld.disney.go.com/dining/magic-kingdom/be-our-guest-restaurant/';

    stubDetail({
      id,
      name: 'Be Our Guest Restaurant',
      park: 'Magic Kingdom',
      category: 'Restaurant',
      description: 'Feast in the Beast’s enchanted castle.',
      areaType: 'ThemePark',
      diningUrl,
    });

    // Linking.openURL fails
    openSpy.mockRejectedValueOnce(new Error('Browser failed to launch'));

    const { unmount } = renderDetail(id);

    await screen.findByTestId('experience-detail');

    const button = screen.getByTestId('experience-reserve-action');
    fireEvent.press(button);

    // Error appears inline
    await screen.findByTestId('experience-reservation-error');
    expect(
      screen.getByText("Couldn't open the reservation page. Please try again."),
    ).toBeTruthy();

    // Rest of screen is intact
    expect(screen.getByTestId('experience-detail')).toBeTruthy();
    expect(screen.getByTestId('experience-category-badge')).toBeTruthy();

    // Subsequent press succeeds -> clears error
    openSpy.mockResolvedValueOnce(undefined);
    fireEvent.press(button);

    await waitFor(() => {
      expect(screen.queryByTestId('experience-reservation-error')).toBeNull();
    });

    unmount();
  });

  test('R7.4: does not render button when category is not Restaurant', async () => {
    const id = 'ride-1';
    stubDetail({
      id,
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'High-speed rollercoaster in the dark.',
      areaType: 'ThemePark',
      diningUrl:
        'https://disneyworld.disney.go.com/dining/magic-kingdom/cinderella-royal-table/',
    });

    const { unmount } = renderDetail(id);

    await screen.findByTestId('experience-detail');

    expect(screen.queryByTestId('experience-reserve-action')).toBeNull();

    unmount();
  });

  test('R7.4: does not render button when diningUrl is undefined, null, or empty string', async () => {
    const cases: Array<string | null | undefined> = [
      undefined,
      null,
      '',
      '   ',
    ];

    let i = 0;
    for (const diningUrl of cases) {
      const id = `restaurant-empty-${i++}`;
      stubDetail({
        id,
        name: 'Quick-Service Cafe',
        park: 'Magic Kingdom',
        category: 'Restaurant',
        description: 'Snacks and beverages.',
        areaType: 'ThemePark',
        diningUrl,
      });

      const { unmount } = renderDetail(id);

      await screen.findByTestId('experience-detail');

      expect(screen.queryByTestId('experience-reserve-action')).toBeNull();

      unmount();
    }
  });

  test('R7.4: does not render button when detail query fails', async () => {
    const id = 'failing-id';
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/catalog/${id}`) {
        throw new ApiError({
          code: 'catalog_unavailable',
          message: 'not found',
          status: 404,
        });
      }
      return {};
    });

    const { unmount } = renderDetail(id);

    await screen.findByText("We couldn't load this experience");

    expect(screen.queryByTestId('experience-reserve-action')).toBeNull();

    unmount();
  });
});
