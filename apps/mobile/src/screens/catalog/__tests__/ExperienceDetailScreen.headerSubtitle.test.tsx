/**
 * ExperienceDetailScreen header subtitle regression test.
 *
 * Bug: the Experience_Detail_Screen's GradientHeader always passed
 * `experience.park` (the theme-park enum) as its subtitle, so a Disney
 * Resort's detail header showed the theme park it happens to be geographically
 * closest to (e.g. "Animal Kingdom") instead of its actual Resort Area (e.g.
 * "Animal Kingdom Resort Area") — the resort area was effectively missing
 * from the header. Requirement 20.1 already establishes the Quick_Specs_Row
 * area chip should source `resortArea`; this test pins the same field onto
 * the header subtitle for the Resort category so the two don't disagree.
 *
 * Fixture/mocks mirror `ExperienceDetailScreen.preservedBehaviors.test.tsx`.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

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

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  };
});

import ExperienceDetailScreen from '../ExperienceDetailScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

type CatalogStackParamList = {
  ExperienceDetail: { experienceId: string; initialLens?: 'today' | 'passport' };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

interface ResortDetailFixture {
  readonly id: string;
  readonly name: string;
  readonly park: string;
  readonly category: string;
  readonly description: string;
  readonly areaType: string;
  readonly resortArea?: string | null;
  readonly tier?: string;
  readonly featurePool?: string;
  readonly transportationModes?: readonly string[];
}

function stubResortDetail(detail: ResortDetailFixture): void {
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
    if (path.endsWith('/completion')) {
      throw new ApiError({ code: 'completion_not_found', message: 'no completion', status: 404 });
    }
    if (path.endsWith('/rating')) {
      throw new ApiError({ code: 'rating_not_found', message: 'no rating', status: 404 });
    }
    if (path.endsWith('/note')) {
      throw new ApiError({ code: 'note_not_found', message: 'no note', status: 404 });
    }
    if (path === `/experiences/${id}/aggregate-rating`) {
      return { value: null, count: 0 };
    }
    if (path.includes('/food-item-logs')) {
      return [];
    }
    if (path.startsWith('/me/trips')) {
      return [];
    }
    if (path.endsWith('/logs')) {
      return { repeatCount: 0, logs: [] };
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
            initialParams={{ experienceId, initialLens: 'passport' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

describe('ExperienceDetailScreen header subtitle (Resort Area regression)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as { __reset: () => void };
    secureStore.__reset();
  });

  test('a Resort experience renders its resortArea as the header subtitle, not the park enum', async () => {
    const experienceId = 'exp-coronado-header';
    stubResortDetail({
      id: experienceId,
      name: "Disney's Coronado Springs Resort",
      park: 'Animal Kingdom',
      category: 'Resort',
      description: 'A Moderate resort themed around the American Southwest.',
      areaType: 'Resort',
      resortArea: 'Animal Kingdom Resort Area',
      tier: 'Moderate',
      featurePool: 'The Dig Site & Lost City of Cibola Pool',
      transportationModes: ['Bus'],
    });

    renderDetail(experienceId);

    expect(await screen.findByText('Animal Kingdom Resort Area')).toBeTruthy();
    // The bare park enum alone must not stand in for the resort area.
    expect(screen.queryByText('Animal Kingdom')).toBeNull();
  });

  test('a Resort experience without a resortArea falls back to the park rather than rendering blank', async () => {
    const experienceId = 'exp-no-area-header';
    stubResortDetail({
      id: experienceId,
      name: "Disney's Test Resort",
      park: 'EPCOT',
      category: 'Resort',
      description: 'A resort fixture with no resortArea field.',
      areaType: 'Resort',
      tier: 'Moderate',
      featurePool: 'Test Pool',
      transportationModes: ['Bus'],
    });

    renderDetail(experienceId);

    expect(await screen.findByText('EPCOT')).toBeTruthy();
  });

  test('a Resort experience with neither resortArea nor park omits the subtitle rather than rendering blank', async () => {
    const experienceId = 'exp-no-area-no-park-header';
    stubResortDetail({
      id: experienceId,
      name: "Disney's Uncharted Resort",
      // The real sync emits `park: null` for every resort-representing row;
      // this fixture also omits `resortArea` to exercise the fully-absent case.
      park: null as unknown as string,
      category: 'Resort',
      description: 'A resort fixture with neither field populated.',
      areaType: 'Resort',
      tier: 'Moderate',
      featurePool: 'Test Pool',
      transportationModes: ['Bus'],
    });

    const view = renderDetail(experienceId);

    // The header still renders (title present).
    expect(await screen.findByText("Disney's Uncharted Resort")).toBeTruthy();

    // No blank subtitle `<Text>{null}</Text>` line is left dangling: every
    // rendered `Text` node in the tree has non-null, non-empty children.
    const allTextNodes = view.UNSAFE_getAllByType(Text);
    for (const node of allTextNodes) {
      expect(node.props.children).not.toBeNull();
    }
  });

  test('a non-Resort experience keeps rendering the park as its header subtitle', async () => {
    const experienceId = 'exp-ride-header';
    stubResortDetail({
      id: experienceId,
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'A dark indoor roller coaster.',
      areaType: 'ThemePark',
    });

    renderDetail(experienceId);

    expect(await screen.findByText('Magic Kingdom')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Hero photo pin badge (`experience-park-badge`) — the same underlying bug:
  // the badge fell back to `land ?? park`, both `null` for a Resort's own
  // representing row, so the pin rendered with no location text at all.
  // -------------------------------------------------------------------------

  test('a Resort experience renders its resortArea in the hero photo pin badge', async () => {
    const experienceId = 'exp-coronado-hero';
    stubResortDetail({
      id: experienceId,
      name: "Disney's Coronado Springs Resort",
      park: null as unknown as string,
      category: 'Resort',
      description: 'A Moderate resort themed around the American Southwest.',
      areaType: 'Resort',
      resortArea: 'Animal Kingdom Resort Area',
      tier: 'Moderate',
      featurePool: 'The Dig Site & Lost City of Cibola Pool',
      transportationModes: ['Bus'],
    });

    renderDetail(experienceId);

    const badge = await screen.findByTestId('experience-park-badge');
    expect(badge).toHaveTextContent('Animal Kingdom Resort Area', { exact: false });

    // A long Geographic Area (e.g. the real upstream "Disney's Animal Kingdom
    // Resort Area") must not balloon the pin badge past the category/rating
    // pill sharing the same row: the badge is capped and its text truncates
    // with an ellipsis on overflow rather than growing unbounded.
    const flatten = (style: unknown): Record<string, unknown> =>
      Object.assign({}, ...(Array.isArray(style) ? style : [style]));
    const badgeStyle = flatten(badge.props.style);
    expect(badgeStyle.flexShrink).toBe(1);
    expect(badgeStyle.maxWidth).toBeDefined();
    const badgeTextNode = badge.props.children;
    expect(badgeTextNode.props.numberOfLines).toBe(1);
    expect(badgeTextNode.props.ellipsizeMode).toBe('tail');
  });

  test('a Resort experience with neither resortArea nor park renders a bare pin with no dangling text', async () => {
    const experienceId = 'exp-uncharted-hero';
    stubResortDetail({
      id: experienceId,
      name: "Disney's Uncharted Resort",
      park: null as unknown as string,
      category: 'Resort',
      description: 'A resort fixture with neither field populated.',
      areaType: 'Resort',
      tier: 'Moderate',
      featurePool: 'Test Pool',
      transportationModes: ['Bus'],
    });

    renderDetail(experienceId);

    const badge = await screen.findByTestId('experience-park-badge');
    // Only the pin glyph renders; no dangling "null"/"undefined" text.
    expect(badge).toHaveTextContent('📍');
    expect(badge).not.toHaveTextContent('null');
    expect(badge).not.toHaveTextContent('undefined');
  });

  test('a non-Resort experience keeps rendering land (or park) in the hero photo pin badge', async () => {
    const experienceId = 'exp-ride-hero';
    stubResortDetail({
      id: experienceId,
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'A dark indoor roller coaster.',
      areaType: 'ThemePark',
    });

    renderDetail(experienceId);

    const badge = await screen.findByTestId('experience-park-badge');
    expect(badge).toHaveTextContent('Magic Kingdom', { exact: false });
  });
});
