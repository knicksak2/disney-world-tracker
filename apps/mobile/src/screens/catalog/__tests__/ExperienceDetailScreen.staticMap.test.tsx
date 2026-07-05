/**
 * ExperienceDetailScreen Static_Map_Preview render tests
 * (experience-detail-redesign → tasks.md 10.2).
 *
 * Validates: Requirements 10.1, 10.2, 10.5, 10.6, 10.7, 10.8
 *
 * The Static_Map_Preview lives inside `LocationGroupSection`: a tappable
 * `<Image>` wrapped in a `Pressable` (`testID="experience-static-map"`,
 * `accessibilityRole="imagebutton"`) sourced from `staticMapUrl(lat, lng)`,
 * rendered only when `hasValidCoordinates(lat, lng)` is true AND the image has
 * not failed to load. Tapping it opens the OS maps app through the SAME
 * `Linking.canOpenURL` → `Linking.openURL(directionsUrl(...))` path (wrapped in
 * try/catch) as the Get directions button; on failure it shows the inline
 * `experience-directions-error` while preserving the rest of the screen. The
 * `<Image>` `onError` handler hides ONLY the image (via `mapImageFailed`) while
 * the Get directions button and the remaining Location content stay rendered.
 *
 * These example tests assert:
 *   - **R10.1** the preview renders when the Experience has valid coordinates.
 *   - **R10.2** the preview is omitted when coordinates are missing or out of
 *     range (only latitude present; latitude > 90).
 *   - **R10.5** tapping the preview opens the OS maps app with the directions
 *     URL — identical behavior to the Get directions button.
 *   - **R10.6** when the maps app cannot be opened (`canOpenURL` false or
 *     `openURL` rejects) the inline error indication renders while the rest of
 *     the screen state is preserved.
 *   - **R10.7** firing the `<Image>` `onError` hides only the preview image
 *     while the Get directions button remains rendered.
 *   - **R10.8** the preview exposes a non-empty accessibility label.
 *
 * Implementation mirrors the sibling suites
 * (`ExperienceDetailScreen.sectionOrdering.test.tsx`,
 * `ExperienceDetailScreen.preservedBehaviors.test.tsx`): `expo-secure-store`,
 * `expo-constants`, and the API client are mocked (the real `ApiError` is
 * preserved), each test uses a retry-disabled `QueryClient`, and the screen is
 * mounted inside a native stack with `experienceId` seeded as `initialParams`.
 * `Linking.openURL` / `Linking.canOpenURL` are spied to assert open behavior.
 */

import React from 'react';
import { Image, Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

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

/**
 * Loose mirror of the screen's `ExperienceDetailDTO`. Only the fields the
 * Location area and coordinate gate read are modelled; coordinates are optional
 * so each test supplies exactly the location shape it needs.
 */
interface DetailFixture {
  readonly id: string;
  readonly name: string;
  readonly park: string | null;
  readonly category: string;
  readonly description: string;
  readonly areaType: string;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
}

/**
 * Route `apiRequest` for a single detail fixture. Secondary reads (personal,
 * aggregate, live, resorts) resolve to benign empty / idle branches so the
 * tests focus on the Location area without those sections blocking or throwing.
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

/** A location-in-a-park fixture with valid coordinates. */
function validCoordinatesFixture(id: string): DetailFixture {
  return {
    id,
    name: "'Ohana",
    park: 'Magic Kingdom',
    category: 'Ride',
    description: 'An Experience used to assert the static map preview.',
    areaType: 'ThemePark',
    latitude: 28.4072,
    longitude: -81.5836,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ExperienceDetailScreen Static_Map_Preview (R10.1, R10.2, R10.5, R10.6, R10.7, R10.8)', () => {
  let canOpenSpy: jest.SpyInstance;
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    apiRequestMock.mockReset();
    const secureStore = jest.requireMock('expo-secure-store') as {
      __reset: () => void;
    };
    secureStore.__reset();

    // Default: the OS reports it can open the maps URL and opening succeeds.
    canOpenSpy = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });

  afterEach(() => {
    canOpenSpy.mockRestore();
    openSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // R10.1 — the preview renders when the Experience has valid coordinates
  // -------------------------------------------------------------------------
  test('R10.1: renders the static map preview when the Experience has valid coordinates', async () => {
    const experienceId = 'exp-map-valid';
    stubDetail(validCoordinatesFixture(experienceId));

    renderDetail(experienceId);

    const preview = await screen.findByTestId('experience-static-map');
    expect(preview).toBeTruthy();

    // The preview wraps an <Image> sourced from the keyless ArcGIS export
    // endpoint with a bbox centered on the Experience coordinate.
    const image = within(preview).UNSAFE_getByType(Image);
    const uri = (image.props.source as { uri: string }).uri;
    expect(uri).toContain(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?',
    );

    // The bbox (xmin,ymin,xmax,ymax in EPSG:4326) is centered on the coordinate.
    const match = /[?&]bbox=([^&]+)/.exec(uri);
    expect(match).not.toBeNull();
    const parts = ((match as RegExpExecArray)[1] ?? '').split(',');
    expect(parts).toHaveLength(4);
    const xmin = Number(parts[0]);
    const ymin = Number(parts[1]);
    const xmax = Number(parts[2]);
    const ymax = Number(parts[3]);
    expect((xmin + xmax) / 2).toBeCloseTo(-81.5836, 6);
    expect((ymin + ymax) / 2).toBeCloseTo(28.4072, 6);
  });

  // -------------------------------------------------------------------------
  // R10.2 — the preview is omitted when coordinates are missing
  // -------------------------------------------------------------------------
  test('R10.2: omits the static map preview when the longitude is missing', async () => {
    const experienceId = 'exp-map-missing-lng';
    stubDetail({
      id: experienceId,
      name: 'Country Bear Jamboree',
      park: 'Magic Kingdom',
      category: 'Show',
      description: 'Only latitude present, so coordinates are incomplete.',
      areaType: 'ThemePark',
      latitude: 28.4072,
      // longitude intentionally omitted → coordinates invalid.
    });

    renderDetail(experienceId);

    // The Location group still renders (a park tag is present)...
    await screen.findByTestId('experience-location-group');
    // ...but neither the static map preview nor Get directions appears.
    expect(screen.queryByTestId('experience-static-map')).toBeNull();
    expect(screen.queryByTestId('experience-get-directions')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R10.2 — the preview is omitted when coordinates are out of range
  // -------------------------------------------------------------------------
  test('R10.2: omits the static map preview when the latitude is out of range', async () => {
    const experienceId = 'exp-map-out-of-range';
    stubDetail({
      id: experienceId,
      name: 'Impossible Place',
      park: 'Magic Kingdom',
      category: 'Ride',
      description: 'Latitude 91 is outside the valid [-90, 90] range.',
      areaType: 'ThemePark',
      latitude: 91,
      longitude: -81.5836,
    });

    renderDetail(experienceId);

    await screen.findByTestId('experience-location-group');
    expect(screen.queryByTestId('experience-static-map')).toBeNull();
    expect(screen.queryByTestId('experience-get-directions')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R10.5 — tapping the preview opens the OS maps app like Get directions
  // -------------------------------------------------------------------------
  test('R10.5: tapping the preview opens the OS maps app with the same directions URL as Get directions', async () => {
    const experienceId = 'exp-map-open';
    stubDetail(validCoordinatesFixture(experienceId));

    renderDetail(experienceId);

    const preview = await screen.findByTestId('experience-static-map');

    fireEvent.press(preview);

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    // The opened URL encodes the exact stored coordinates.
    const previewUrl = openSpy.mock.calls[0][0] as string;
    expect(previewUrl).toContain('28.4072');
    expect(previewUrl).toContain('-81.5836');

    // Tapping Get directions opens the identical URL (same open-maps path).
    openSpy.mockClear();
    canOpenSpy.mockClear();
    const getDirections = screen.getByTestId('experience-get-directions');
    fireEvent.press(getDirections);
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    expect(openSpy.mock.calls[0][0]).toBe(previewUrl);

    // No inline error is shown on a successful open.
    expect(screen.queryByTestId('experience-directions-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R10.6 — canOpenURL false shows the inline error, preserving screen state
  // -------------------------------------------------------------------------
  test('R10.6: shows the inline error when the OS reports it cannot open the maps app, preserving screen state', async () => {
    const experienceId = 'exp-map-cannot-open';
    stubDetail(validCoordinatesFixture(experienceId));
    canOpenSpy.mockResolvedValue(false);

    renderDetail(experienceId);

    const preview = await screen.findByTestId('experience-static-map');

    fireEvent.press(preview);

    // R10.6: the inline error indication renders...
    await screen.findByTestId('experience-directions-error');
    // ...openURL is never reached...
    expect(openSpy).not.toHaveBeenCalled();
    // ...and the rest of the screen state is preserved (preview + Get
    // directions + Location group all remain rendered).
    expect(screen.getByTestId('experience-static-map')).toBeTruthy();
    expect(screen.getByTestId('experience-get-directions')).toBeTruthy();
    expect(screen.getByTestId('experience-location-group')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R10.6 — openURL rejecting shows the inline error, preserving screen state
  // -------------------------------------------------------------------------
  test('R10.6: shows the inline error when opening the maps app rejects, preserving screen state', async () => {
    const experienceId = 'exp-map-open-rejects';
    stubDetail(validCoordinatesFixture(experienceId));
    openSpy.mockRejectedValue(new Error('no maps app'));

    renderDetail(experienceId);

    const preview = await screen.findByTestId('experience-static-map');

    fireEvent.press(preview);

    await screen.findByTestId('experience-directions-error');
    expect(openSpy).toHaveBeenCalledTimes(1);
    // Screen state preserved.
    expect(screen.getByTestId('experience-static-map')).toBeTruthy();
    expect(screen.getByTestId('experience-get-directions')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R10.7 — the <Image> onError hides only the image; Get directions remains
  // -------------------------------------------------------------------------
  test('R10.7: firing the image onError hides only the preview while Get directions remains rendered', async () => {
    const experienceId = 'exp-map-image-error';
    stubDetail(validCoordinatesFixture(experienceId));

    renderDetail(experienceId);

    const preview = await screen.findByTestId('experience-static-map');
    const image = within(preview).UNSAFE_getByType(Image);

    // The image fails to load.
    fireEvent(image, 'error');

    // R10.7: only the preview image is hidden...
    await waitFor(() => {
      expect(screen.queryByTestId('experience-static-map')).toBeNull();
    });
    // ...while the Get directions button and the rest of the Location content
    // keep rendering.
    expect(screen.getByTestId('experience-get-directions')).toBeTruthy();
    expect(screen.getByTestId('experience-location-group')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R10.8 — the preview exposes a non-empty accessibility label
  // -------------------------------------------------------------------------
  test('R10.8: the preview exposes a non-empty accessibility label', async () => {
    const experienceId = 'exp-map-a11y';
    stubDetail(validCoordinatesFixture(experienceId));

    renderDetail(experienceId);

    const preview = await screen.findByTestId('experience-static-map');
    const label = preview.props.accessibilityLabel as string;
    expect(typeof label).toBe('string');
    expect(label.trim().length).toBeGreaterThan(0);
  });
});
