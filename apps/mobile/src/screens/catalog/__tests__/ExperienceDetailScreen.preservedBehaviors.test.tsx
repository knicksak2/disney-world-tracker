/**
 * ExperienceDetailScreen preserved-behavior render tests
 * (experience-detail-redesign → tasks.md 7.4).
 *
 * Validates: Requirements 8.1, 8.2, 8.4, 8.5, 8.7, 8.8, 8.9, 8.10, 8.11
 *
 * The Experience_Detail_Screen was reorganized (task 7.2) into the new
 * top-to-bottom section order, but every pre-existing screen behavior must keep
 * working after the layout change (R8). These example-based tests mount the
 * real `ExperienceDetailScreen` and assert the preserved behaviors that are not
 * universal properties and are not already covered by the section-ordering /
 * info-tag-label suite (task 7.3):
 *
 *   - **R8.1** Share entry point is disabled while the viewer's Rating (or
 *     Note) is still loading and does not navigate on activation.
 *   - **R8.2** activating the enabled Share entry point navigates to the Share
 *     composer with the loaded detail, Rating, and Note projected into params.
 *   - **R8.4** a live retrieval failure renders the live-unavailable indicator
 *     while the static detail fields stay visible.
 *   - **R8.5** a null community aggregate renders "Not enough ratings yet".
 *   - **R8.6** a non-null community aggregate renders the one-decimal mean plus
 *     the rating count (the populated companion of the R8.5 empty state).
 *   - **R8.7** a Restaurant Experience renders the Menu_Summary_Card.
 *   - **R8.8** the detail query loading state renders the loading indicator.
 *   - **R8.9** a detail query failure renders the error empty state together
 *     with the live-unavailable indicator.
 *   - **R8.10** an absent Why_This value omits the "Why visit" section.
 *   - **R8.11** a Why_This whose every bullet duplicates the description omits
 *     the "Why visit" section.
 *
 * Implementation mirrors `ExperienceDetailScreen.enrichedDetail.test.tsx` and
 * `emptyStates.test.tsx`: `expo-secure-store`, `expo-constants`, and the API
 * client are mocked (the real `ApiError` is preserved), `@react-navigation`'s
 * `useNavigation` is stubbed with a spy so the Share navigation target and
 * params can be asserted without registering the composer route, each test uses
 * a retry-disabled `QueryClient`, and the screen is mounted inside a native
 * stack with `experienceId` seeded as `initialParams` so `useRoute().params`
 * resolves.
 */

import React from 'react';
import { ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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

// Spy on the screen's navigation so the Share entry point's navigation target
// and projected params can be asserted directly (R8.1, R8.2). `useRoute` and
// `NavigationContainer` are preserved from the real module so the screen's
// `experienceId` route param still resolves through the native stack below.
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
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

interface WhyThisFixture {
  readonly title: string | null;
  readonly bullets: readonly string[];
  readonly quotes: readonly string[];
}

/** Mirrors the screen's `ExperienceDetailDTO` (the `GET /catalog/:id` shape). */
interface DetailFixture {
  readonly id: string;
  readonly name: string;
  readonly park: string | null;
  readonly category: string;
  readonly description: string;
  readonly areaType: string;
  readonly menus?: readonly { name: string; type: string }[];
  readonly whyThis?: WhyThisFixture | null;
}

interface RatingFixture {
  readonly userId: string;
  readonly experienceId: string;
  readonly value: number;
  readonly updatedAt: string;
}

interface NoteFixture {
  readonly userId: string;
  readonly experienceId: string;
  readonly body: string;
  readonly shareable: boolean;
  readonly updatedAt: string;
}

interface AggregateFixture {
  readonly value: number | null;
  readonly count: number;
}

/** Options controlling how each secondary read resolves for a given test. */
interface StubOptions {
  /** Resolve the viewer's Rating to this value; otherwise `rating_not_found`. */
  readonly rating?: RatingFixture;
  /** Resolve the viewer's Note to this value; otherwise `note_not_found`. */
  readonly note?: NoteFixture;
  /** Community aggregate; defaults to the empty `{ value: null, count: 0 }`. */
  readonly aggregate?: AggregateFixture;
  /**
   * When `true`, the viewer's Rating read never resolves so `ratingQ.isLoading`
   * stays true — used to exercise the Share entry point's disabled state (R8.1).
   */
  readonly ratingPending?: boolean;
}

/**
 * Route `apiRequest` for a single detail fixture. The live read fails with a
 * `live_unavailable` `ApiError` so the live-unavailable indicator path is
 * exercised (R8.4); completion resolves to its empty state; rating, note, and
 * aggregate follow the supplied options.
 */
function stubDetail(detail: DetailFixture, options: StubOptions = {}): void {
  const id = detail.id;
  const aggregate = options.aggregate ?? { value: null, count: 0 };
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path.startsWith('/resorts')) {
      return { resorts: [] };
    }
    if (path === `/catalog/${id}`) {
      return detail;
    }
    if (path === `/catalog/${id}/live`) {
      // R8.4: a failed live retrieval degrades to the unavailable indicator
      // while the static detail fields above remain visible.
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
      if (options.ratingPending === true) {
        // Never resolves: keeps `ratingQ.isLoading` true so the Share entry
        // point stays disabled (R8.1).
        return new Promise(() => {});
      }
      if (options.rating !== undefined) {
        return options.rating;
      }
      throw new ApiError({
        code: 'rating_not_found',
        message: 'no rating',
        status: 404,
      });
    }
    if (path.endsWith('/note')) {
      if (options.note !== undefined) {
        return options.note;
      }
      throw new ApiError({
        code: 'note_not_found',
        message: 'no note',
        status: 404,
      });
    }
    if (path === `/experiences/${id}/aggregate-rating`) {
      return aggregate;
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

describe('ExperienceDetailScreen preserved behaviors (R8.1, R8.2, R8.4, R8.5, R8.7, R8.8, R8.9, R8.10, R8.11)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();
  });

  // -------------------------------------------------------------------------
  // R8.1 — Share entry point disabled while the viewer's Rating is loading
  // -------------------------------------------------------------------------
  test('R8.1: the Share entry point is disabled and does not navigate while the Rating is loading', async () => {
    const experienceId = 'exp-share-loading';
    stubDetail(
      {
        id: experienceId,
        name: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        description: 'A dark indoor roller coaster.',
        areaType: 'ThemePark',
      },
      { ratingPending: true },
    );

    renderDetail(experienceId);

    // The detail settles and the Share control renders, but with the Rating
    // read still pending the entry point is disabled (R8.1).
    const shareButton = await screen.findByTestId('experience-share-button');
    expect(shareButton.props.accessibilityState?.disabled).toBe(true);

    // Activating a disabled entry point performs no navigation.
    fireEvent.press(shareButton);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // R8.2 — activating the enabled Share entry point navigates with built params
  // -------------------------------------------------------------------------
  test('R8.2: activating the enabled Share entry point navigates to the composer with the loaded detail, Rating, and Note', async () => {
    const experienceId = 'exp-share-enabled';
    stubDetail(
      {
        id: experienceId,
        name: 'Haunted Mansion',
        park: 'Magic Kingdom',
        category: 'Ride',
        description: 'A haunted doombuggy dark ride.',
        areaType: 'ThemePark',
      },
      {
        rating: {
          userId: 'user-1',
          experienceId,
          value: 7,
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        note: {
          userId: 'user-1',
          experienceId,
          body: 'Loved the stretching room.',
          shareable: true,
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      },
    );

    renderDetail(experienceId);

    const shareButton = await screen.findByTestId('experience-share-button');

    // Once the Rating and Note reads settle the entry point becomes enabled.
    await waitFor(() => {
      expect(shareButton.props.accessibilityState?.disabled).toBe(false);
    });

    fireEvent.press(shareButton);

    // R8.2: navigation targets the Share composer with the loaded detail plus
    // the viewer's Rating (whole 1–10) and Note (trimmed) projected into params.
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('ShareComposer', {
      kind: 'experience',
      experienceId,
      experienceName: 'Haunted Mansion',
      park: 'Magic Kingdom',
      category: 'Ride',
      rating: 7,
      note: 'Loved the stretching room.',
    });
  });

  // -------------------------------------------------------------------------
  // R8.4 — a live failure shows the live-unavailable indicator; static fields stay
  // -------------------------------------------------------------------------
  test('R8.4: a live retrieval failure renders the live-unavailable indicator while static fields remain visible', async () => {
    const experienceId = 'exp-live-fail';
    stubDetail({
      id: experienceId,
      name: 'Jungle Cruise',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'A guided riverboat tour.',
      areaType: 'ThemePark',
    });

    renderDetail(experienceId);

    // The live section degrades to the unavailable indicator (R8.4)...
    await screen.findByTestId('live-unavailable');
    // ...while the static detail fields (name, description) stay visible.
    expect(screen.getByText('A guided riverboat tour.')).toBeTruthy();
    expect(screen.getByTestId('experience-park-badge')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R8.5 — a null community aggregate renders "Not enough ratings yet"
  // -------------------------------------------------------------------------
  test('R8.5: a null community aggregate renders the "Not enough ratings yet" empty state', async () => {
    const experienceId = 'exp-aggregate-empty';
    stubDetail(
      {
        id: experienceId,
        name: 'Country Bear Jamboree',
        park: 'Magic Kingdom',
        category: 'Show',
        description: 'A classic audio-animatronic revue.',
        areaType: 'ThemePark',
      },
      { aggregate: { value: null, count: 2 } },
    );

    renderDetail(experienceId);

    await waitFor(() => {
      expect(screen.getByTestId('aggregate-empty')).toBeTruthy();
    });
    expect(screen.getByText(/not enough ratings yet/i)).toBeTruthy();
    // The populated value block is not shown when the aggregate is empty.
    expect(screen.queryByTestId('aggregate-value')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R8.6 — a non-null aggregate renders the one-decimal mean plus the count
  // -------------------------------------------------------------------------
  test('R8.6: a non-null community aggregate renders the one-decimal mean and the rating count', async () => {
    const experienceId = 'exp-aggregate-populated';
    stubDetail(
      {
        id: experienceId,
        name: 'Pirates of the Caribbean',
        park: 'Magic Kingdom',
        category: 'Ride',
        description: 'A swashbuckling boat ride.',
        areaType: 'ThemePark',
      },
      { aggregate: { value: 8.25, count: 12 } },
    );

    renderDetail(experienceId);

    // R8.6: the mean is rendered to one decimal place (`(8.25).toFixed(1)`)...
    const value = await screen.findByTestId('aggregate-value');
    expect(value).toHaveTextContent('8.3 / 10');
    // ...alongside the contributing rating count.
    expect(screen.getByTestId('aggregate-count')).toHaveTextContent(
      '(12 ratings)',
    );
    expect(screen.queryByTestId('aggregate-empty')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R8.7 — a Restaurant Experience renders the Menu_Summary_Card
  // -------------------------------------------------------------------------
  test('R8.7: a Restaurant Experience renders the Menu_Summary_Card', async () => {
    const experienceId = 'exp-restaurant';
    stubDetail({
      id: experienceId,
      name: "'Ohana",
      park: 'Magic Kingdom',
      category: 'Restaurant',
      description: 'Family-style Polynesian dining.',
      areaType: 'Resort',
      menus: [
        { name: 'Dinner', type: 'Dinner' },
        { name: 'Breakfast', type: 'Breakfast' },
      ],
    });

    renderDetail(experienceId);

    // R8.7: the pressable menu summary card renders for the restaurant.
    const card = await screen.findByTestId('menu-summary-card');
    expect(card).toBeTruthy();
    expect(screen.getByTestId('menu-summary-count')).toHaveTextContent(
      '2 menus available',
    );
  });

  // -------------------------------------------------------------------------
  // R8.8 — the detail query loading state renders the loading indicator
  // -------------------------------------------------------------------------
  test('R8.8: while the Experience detail query is loading the loading indicator renders', async () => {
    const experienceId = 'exp-detail-loading';
    // The catalog detail read never resolves, so the screen stays in its
    // top-level loading branch (R8.8).
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path === 'string' && path === `/catalog/${experienceId}`) {
        return new Promise(() => {});
      }
      if (typeof path === 'string' && path.startsWith('/resorts')) {
        return { resorts: [] };
      }
      // Secondary reads may or may not fire before the detail settles; resolve
      // them benignly so nothing throws.
      return new Promise(() => {});
    });

    renderDetail(experienceId);

    // The loading indicator (an ActivityIndicator inside the progressbar
    // region) renders and no detail content is shown.
    await waitFor(() => {
      expect(screen.UNSAFE_getAllByType(ActivityIndicator).length).toBeGreaterThan(
        0,
      );
    });
    expect(screen.queryByTestId('experience-detail')).toBeNull();
    expect(screen.queryByTestId('experience-share-button')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R8.9 — a detail query failure renders the error empty state + live-unavailable
  // -------------------------------------------------------------------------
  test('R8.9: a detail query failure renders the error empty state together with the live-unavailable indicator', async () => {
    const experienceId = 'exp-detail-error';
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path === 'string' && path === `/catalog/${experienceId}`) {
        throw new ApiError({
          code: 'internal_error',
          message: 'boom',
          status: 500,
        });
      }
      if (typeof path === 'string' && path.startsWith('/resorts')) {
        return { resorts: [] };
      }
      throw new ApiError({
        code: 'internal_error',
        message: 'boom',
        status: 500,
      });
    });

    renderDetail(experienceId);

    // R8.9: the error empty state renders...
    await screen.findByText(/couldn't load this experience/i);
    // ...together with the live-unavailable indicator.
    expect(screen.getByTestId('live-unavailable')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R8.10 — an absent Why_This value omits the "Why visit" section
  // -------------------------------------------------------------------------
  test('R8.10: the "Why visit" section is omitted when the Why_This value is absent', async () => {
    const experienceId = 'exp-why-absent';
    stubDetail({
      id: experienceId,
      name: 'Country Bear Jamboree',
      park: 'Magic Kingdom',
      category: 'Show',
      description: 'A classic audio-animatronic revue.',
      areaType: 'ThemePark',
      // No whyThis value at all.
    });

    renderDetail(experienceId);

    // The static detail still renders...
    await screen.findByText('A classic audio-animatronic revue.');
    // ...but the "Why visit" section is omitted (R8.10).
    expect(screen.queryByTestId('experience-why-this')).toBeNull();
    expect(screen.queryByText('Why visit')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R8.11 — a Why_This whose every bullet duplicates the description is omitted
  // -------------------------------------------------------------------------
  test('R8.11: the "Why visit" section is omitted when every bullet duplicates the description', async () => {
    const experienceId = 'exp-why-duplicate';
    const description = 'A beloved Tomorrowland classic.';
    stubDetail({
      id: experienceId,
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      description,
      areaType: 'ThemePark',
      // Every bullet merely restates the About description (case/whitespace
      // insensitive), so there is nothing distinct to surface.
      whyThis: {
        title: 'Why visit',
        bullets: ['  A Beloved Tomorrowland Classic.  '],
        quotes: [],
      },
    });

    renderDetail(experienceId);

    // The About description renders...
    await screen.findByText(description);
    // ...but the "Why visit" section is omitted because its only bullet
    // duplicates the description (R8.11).
    expect(screen.queryByTestId('experience-why-this')).toBeNull();
    expect(screen.queryByText('Why visit')).toBeNull();
  });
});
