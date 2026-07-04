/**
 * ExperienceDetailScreen "Why visit" (Why_This) render example tests
 * (tasks.md → 10.4).
 *
 * Validates: Requirements 11.4, 11.5
 *
 * These example tests mount the real `ExperienceDetailScreen` with `apiRequest`
 * stubbed to fixed `/catalog/:id`, personal (`/me/...`), aggregate, live, and
 * `/resorts` fixtures and assert the Why_This section (`WhyThisSection`,
 * `testID="experience-why-this"`, `SectionLabel` "Why visit") behavior:
 *
 *   - **R11.4** when the Experience carries a `whyThis` value with one or more
 *     `bullets`, the section renders and every bullet is surfaced as flavor
 *     text.
 *
 *   - **R11.5** when the Experience has no `whyThis` value (absent/null) or its
 *     `bullets` list is empty, the section is omitted entirely — the screen
 *     never shows an empty "Why visit" card.
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
import { render, screen } from '@testing-library/react-native';

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
interface WhyThisFixture {
  readonly title: string | null;
  readonly bullets: readonly string[];
  readonly quotes: readonly string[];
}

interface DetailFixture {
  readonly id: string;
  readonly name: string;
  readonly park: string | null;
  readonly category: string;
  readonly description: string;
  readonly areaType: string;
  readonly whyThis?: WhyThisFixture | null;
}

/**
 * Route `apiRequest` for a single detail fixture. The `/me`/aggregate/live/
 * `/resorts` secondary reads are resolved to their benign empty/idle branches
 * so the tests assert on the Why_This section without those sections blocking
 * or throwing.
 */
function stubDetail(detail: DetailFixture): void {
  const id = detail.id;
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ExperienceDetailScreen Why_This section (R11.4, R11.5)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();
  });

  // -------------------------------------------------------------------------
  // R11.4 — bullets render when the Why_This value carries them
  // -------------------------------------------------------------------------
  test('R11.4: renders the Why_This section with every bullet when bullets are present', async () => {
    const experienceId = 'exp-why-present';
    stubDetail({
      id: experienceId,
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'A dark indoor roller coaster.',
      areaType: 'ThemePark',
      whyThis: {
        title: 'Why visit',
        bullets: [
          'Race through the cosmos in the dark',
          'A beloved Tomorrowland classic',
        ],
        quotes: [],
      },
    });

    renderDetail(experienceId);

    // The section appears once the detail query settles.
    await screen.findByTestId('experience-why-this');

    // The accessible section header (R11.6) and each bullet (R11.4) render.
    expect(screen.getByText('Why visit')).toBeTruthy();
    expect(
      screen.getByText('Race through the cosmos in the dark'),
    ).toBeTruthy();
    expect(screen.getByText('A beloved Tomorrowland classic')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R11.5 — the section is omitted when the Why_This value is absent
  // -------------------------------------------------------------------------
  test('R11.5: omits the Why_This section entirely when whyThis is absent', async () => {
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

    // ...but the Why_This section is omitted (R11.5).
    expect(screen.queryByTestId('experience-why-this')).toBeNull();
    expect(screen.queryByText('Why visit')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R11.5 — the section is omitted when whyThis carries no bullets
  // -------------------------------------------------------------------------
  test('R11.5: omits the Why_This section when bullets is empty', async () => {
    const experienceId = 'exp-why-empty';
    stubDetail({
      id: experienceId,
      name: 'Jungle Cruise',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'A guided riverboat tour.',
      areaType: 'ThemePark',
      // A present whyThis value, but with no bullets to show.
      whyThis: { title: 'Why visit', bullets: [], quotes: ['A skipper favorite'] },
    });

    renderDetail(experienceId);

    await screen.findByText('A guided riverboat tour.');

    // With no bullets there is nothing to surface, so the section is omitted.
    expect(screen.queryByTestId('experience-why-this')).toBeNull();
    expect(screen.queryByText('Why visit')).toBeNull();
  });
});
