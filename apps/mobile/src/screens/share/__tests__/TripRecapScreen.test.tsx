/**
 * TripRecapScreen (photo-uploads task 22.4, Requirements 15.8, 15.13, 15.15,
 * 16.8, 17.1; decisions D25, D27).
 *
 * Renders the real screen (and the real `TripPhotosSection` it reuses in
 * recipient mode) inside a real native stack; only `apiRequest` is spied.
 */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Image, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ReactTestInstance } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { SharedSummaryPhotoDTO, TripRecapDTO, TripRecapFiguresDTO } from '@dwt/shared';

import * as clientModule from '../../../api/client';
import { ApiError } from '../../../api/client';
import type { YouAndCrewStackParamList } from '../../../navigation/YouAndCrewStack';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme, lightTheme } from '../../../theme/theme';
import { SUMMARY_MISC } from '../../trips/TripSummaryScreen.palette';
import TripRecapScreen, {
  RECAP_NO_PLAN_COPY,
  RECAP_PHOTOS_NOT_INCLUDED_COPY,
  RECAP_PHOTOS_UNAVAILABLE_COPY,
  RECAP_UNAVAILABLE_COPY,
} from '../TripRecapScreen';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

const SHARE_ID = 'share-recap-1';
const RECAP_PATH = `/me/inbox/${SHARE_ID}/trip-recap`;

// Each tile gets a distinct value so a swapped binding fails a test.
const FIGURES: TripRecapFiguresDTO = {
  distinctExperienceCount: 12,
  plannedCompletedCount: 7,
  plannedTotalCount: 9,
  totalCompletionsCount: 31,
  totalRatingsCount: 18,
  parksExploredCount: 4,
  superlatives: [
    {
      id: 'group_mvp',
      title: 'Group MVP',
      description: 'Most experiences completed across the entire trip',
      icon: 'trophy',
      memberDisplayName: 'Mickey',
      value: 7,
    },
    {
      id: 'crowd_favorite',
      title: 'Crowd Favorite',
      description: 'Highest average rating from the group',
      icon: 'sparkles',
      experienceName: 'Space Mountain',
      value: '9.5 ★',
    },
  ],
  topRated: [
    {
      experienceName: 'Space Mountain',
      meanRating: 9.5,
      ratingCount: 4,
      park: 'Magic Kingdom',
      category: 'Ride',
      imageUrl: 'https://img.example.test/space-mountain.jpg',
    },
    {
      experienceName: 'Soarin Around the World',
      meanRating: 9,
      ratingCount: 1,
      park: 'EPCOT',
      category: 'Ride',
    },
    { experienceName: 'Dumbo the Flying Elephant', meanRating: 7.25, ratingCount: 2 },
  ],
};

/** A trip with nothing logged and no plan: every count is zero. */
const EMPTY_FIGURES: TripRecapFiguresDTO = {
  distinctExperienceCount: 0,
  plannedCompletedCount: 0,
  plannedTotalCount: 0,
  totalCompletionsCount: 0,
  totalRatingsCount: 0,
  parksExploredCount: 0,
  superlatives: [],
  topRated: [],
};

const PHOTO_A: SharedSummaryPhotoDTO = {
  id: 'photo-a',
  thumbUrl: 'https://r2.test/p/photo-a/t.jpg',
  url: 'https://r2.test/p/photo-a/f.jpg',
  width: 1200,
  height: 800,
  sortAt: '2026-05-01T12:00:00.000Z',
};

const PHOTO_B: SharedSummaryPhotoDTO = {
  id: 'photo-b',
  thumbUrl: 'https://r2.test/p/photo-b/t.jpg',
  url: 'https://r2.test/p/photo-b/f.jpg',
  width: 1200,
  height: 800,
  sortAt: '2026-05-02T12:00:00.000Z',
};

function recapDto(overrides: Partial<TripRecapDTO> = {}): TripRecapDTO {
  return {
    tripId: 'trip-1',
    tripName: 'Fall 2026 Family Trip',
    sharerDisplayName: 'Minnie Mouse',
    recap: FIGURES,
    photos: { access: 'granted', photos: [PHOTO_A, PHOTO_B] },
    ...overrides,
  };
}

const Stack = createNativeStackNavigator<YouAndCrewStackParamList>();

/** Stands in for the album screen and prints the params the recap navigated with. */
function AlbumStub({
  route,
}: NativeStackScreenProps<YouAndCrewStackParamList, 'TripRecapAlbum'>): JSX.Element {
  return <Text testID="album-stub-params">{JSON.stringify(route.params)}</Text>;
}

/** The real screen inside a real native stack and a fresh query client. */
function RecapHarness(): JSX.Element {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0 },
            mutations: { retry: false },
          },
        })
      }
    >
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen
            name="TripRecap"
            component={TripRecapScreen}
            initialParams={{ shareId: SHARE_ID }}
          />
          <Stack.Screen name="TripRecapAlbum" component={AlbumStub} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>
  );
}

function renderRecap(): void {
  render(<RecapHarness />);
}

describe('TripRecapScreen', () => {
  let apiRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
  });
  afterEach(() => {
    apiRequestSpy.mockRestore();
  });

  function program(recap: TripRecapDTO): void {
    apiRequestSpy.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === RECAP_PATH) return recap;
      if (method === 'POST' && /^\/photos\/[^/]+\/report$/.test(path)) return undefined;
      if (method === 'POST' && path === '/me/blocks') {
        return { id: 'block-1', createdAt: '2026-05-01T00:00:00.000Z' };
      }
      throw new Error(`unexpected apiRequest ${method} ${path}`);
    });
  }

  test('requests GET /me/inbox/:shareId/trip-recap and renders the live figures with the sharer name', async () => {
    program(recapDto());
    renderRecap();

    expect(await screen.findByTestId('trip-recap-trip-name')).toBeTruthy();
    expect(apiRequestSpy).toHaveBeenCalledWith('GET', RECAP_PATH);
    expect(screen.getByText('Fall 2026 Family Trip')).toBeTruthy();
    // The sharer's name appears once, in the hero pill, not repeated in the header.
    expect(screen.getByText('Shared by Minnie Mouse')).toBeTruthy();
    expect(screen.queryByText('Minnie Mouse shared this recap')).toBeNull();
    expect(screen.getByTestId('trip-recap-distinct-count')).toHaveTextContent('12');
    expect(screen.getByTestId('trip-recap-planned-count')).toHaveTextContent('7 of 9');
    // The allowed display name appears only through the superlative that carried it.
    expect(screen.getByText('Group MVP')).toBeTruthy();
    expect(screen.getByText('Mickey')).toBeTruthy();
    expect(screen.getByTestId('trip-recap-top-rated-Space Mountain')).toBeTruthy();
    expect(screen.queryByText(RECAP_UNAVAILABLE_COPY)).toBeNull();
  });

  test('granted: renders the returned thumbnails with accessibility labels and no album, add, edit, delete or stop-sharing control', async () => {
    program(recapDto());
    renderRecap();

    const first = await screen.findByTestId('trip-photo-highlight-photo-a');
    expect(first.props.accessibilityLabel).toBe('Trip photo 1, opens viewer');
    expect(
      screen.getByTestId('trip-photo-highlight-photo-b').props.accessibilityLabel,
    ).toBe('Trip photo 2, opens viewer');

    expect(screen.queryByTestId('view-all-in-album-btn')).toBeNull();
    expect(screen.queryByText(/view all in album/i)).toBeNull();
    expect(screen.queryByText(/add photos?/i)).toBeNull();
    expect(screen.queryByText(/edit/i)).toBeNull();
    expect(screen.queryByText(/delete/i)).toBeNull();
    expect(screen.queryByText(/stop sharing|revoke|unsend/i)).toBeNull();
    // Recipient mode makes no photo-config or highlights request of its own.
    expect(apiRequestSpy).not.toHaveBeenCalledWith('GET', '/photos/config');
    expect(apiRequestSpy.mock.calls.filter(([method]) => method === 'GET')).toHaveLength(1);
  });

  test('granted: "View all photos" opens TripRecapAlbum with { shareId, tripName } (D35, R15.31)', async () => {
    program(recapDto());
    renderRecap();

    const action = await screen.findByTestId('view-all-photos-btn');
    expect(action.props.accessibilityRole).toBe('button');
    fireEvent.press(action);

    const params = await screen.findByTestId('album-stub-params');
    expect(JSON.parse(params.props.children as string)).toEqual({
      shareId: SHARE_ID,
      tripName: 'Fall 2026 Family Trip',
    });
  });

  test('"View all photos" omits tripName from the params when the trip name is empty', async () => {
    program(recapDto({ tripName: '' }));
    renderRecap();

    fireEvent.press(await screen.findByTestId('view-all-photos-btn'));

    const params = await screen.findByTestId('album-stub-params');
    const parsed = JSON.parse(params.props.children as string) as Record<string, unknown>;
    expect(parsed).toEqual({ shareId: SHARE_ID });
    expect(parsed).not.toHaveProperty('tripName');
  });

  test.each(['not_included', 'unavailable'] as const)(
    '%s: no "View all photos" action',
    async (access) => {
      program(recapDto({ photos: { access, photos: [] } }));
      renderRecap();

      await screen.findByTestId(`trip-recap-photos-${access}`);
      expect(screen.queryByTestId('view-all-photos-btn')).toBeNull();
      expect(screen.queryByText('View all photos')).toBeNull();
    },
  );

  test('granted with zero photos: no "View all photos" action', async () => {
    program(recapDto({ photos: { access: 'granted', photos: [] } }));
    renderRecap();

    await screen.findByTestId('trip-recap-stats');
    expect(screen.queryByTestId('view-all-photos-btn')).toBeNull();
  });

  test('Report on a photo posts { reason, shareId } and shows the confirmation', async () => {
    program(recapDto());
    renderRecap();

    fireEvent.press(await screen.findByTestId('trip-photo-highlight-photo-a'));
    fireEvent.press(await screen.findByTestId('photo-viewer-report'));
    fireEvent.press(await screen.findByTestId('report-reason-inappropriate'));
    fireEvent.press(screen.getByTestId('submit-report-button'));

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/photos/photo-a/report', {
        reason: 'inappropriate',
        shareId: SHARE_ID,
      });
    });
    expect(await screen.findByTestId('photo-report-confirmation')).toBeTruthy();
    expect(screen.getByText('Report Submitted')).toBeTruthy();
  });

  test('"Block uploader" posts { photoId, shareId } and never a userId', async () => {
    program(recapDto());
    renderRecap();

    fireEvent.press(await screen.findByTestId('trip-photo-highlight-photo-b'));
    fireEvent.press(await screen.findByTestId('photo-viewer-block'));
    fireEvent.press(await screen.findByTestId('confirm-block-button'));

    await waitFor(() => {
      expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/me/blocks', {
        photoId: 'photo-b',
        shareId: SHARE_ID,
      });
    });
    const blockCall = apiRequestSpy.mock.calls.find(([, path]) => path === '/me/blocks');
    expect(blockCall?.[2]).not.toHaveProperty('userId');
    expect(await screen.findByTestId('block-confirmation-notice')).toBeTruthy();
  });

  test('not_included: shows the explanation and no strip', async () => {
    program(recapDto({ photos: { access: 'not_included', photos: [] } }));
    renderRecap();

    const note = await screen.findByTestId('trip-recap-photos-not_included');
    expect(note.props.children).toBe(RECAP_PHOTOS_NOT_INCLUDED_COPY);
    expect(screen.queryByTestId('trip-photos-strip')).toBeNull();
    // The figures are still shown.
    expect(screen.getByTestId('trip-recap-stats')).toBeTruthy();
  });

  test('unavailable (photos off) with figures: shows the explanation, figures stay', async () => {
    program(recapDto({ photos: { access: 'unavailable', photos: [] } }));
    renderRecap();

    const note = await screen.findByTestId('trip-recap-photos-unavailable');
    expect(note.props.children).toBe(RECAP_PHOTOS_UNAVAILABLE_COPY);
    expect(screen.queryByTestId('trip-photos-strip')).toBeNull();
    expect(screen.getByTestId('trip-recap-stats')).toBeTruthy();
  });

  test('recap: null shows only "This recap is no longer available" and no figures or photo explanation (D27)', async () => {
    program(recapDto({ recap: null, photos: { access: 'unavailable', photos: [] } }));
    renderRecap();

    const text = await screen.findByTestId('trip-recap-unavailable');
    expect(text.props.children).toBe('This recap is no longer available');
    expect(screen.queryByTestId('trip-recap-stats')).toBeNull();
    expect(screen.queryByTestId('trip-recap-distinct-count')).toBeNull();
    expect(screen.queryByTestId('trip-recap-hero')).toBeNull();
    expect(screen.queryByTestId('trip-recap-photos-unavailable')).toBeNull();
    expect(screen.queryByTestId('trip-photos-strip')).toBeNull();
    // With no hero pill, the header is the only place that names the sharer.
    expect(screen.getByText('Minnie Mouse shared this recap')).toBeTruthy();
    expect(screen.queryByText('Shared by Minnie Mouse')).toBeNull();
  });

  test('the collapsed validation_failed (deleted share, unfriended sender) reads as no longer available, with no retry (D25)', async () => {
    apiRequestSpy.mockImplementation(async () => {
      throw new ApiError({
        code: 'validation_failed',
        message: 'Invalid request.',
        status: 400,
      });
    });
    renderRecap();

    const text = await screen.findByTestId('trip-recap-unavailable');
    expect(text.props.children).toBe(RECAP_UNAVAILABLE_COPY);
    expect(screen.queryByTestId('trip-recap-retry')).toBeNull();
    expect(screen.queryByTestId('trip-recap-stats')).toBeNull();
  });

  test('another failure shows a retry that re-requests the recap', async () => {
    let attempts = 0;
    apiRequestSpy.mockImplementation(async (_method: string, path: string) => {
      if (path !== RECAP_PATH) throw new Error(`unexpected ${path}`);
      attempts += 1;
      if (attempts === 1) {
        throw new ApiError({ code: 'internal_error', message: 'boom', status: 500 });
      }
      return recapDto();
    });
    renderRecap();

    fireEvent.press(await screen.findByTestId('trip-recap-retry'));

    expect(await screen.findByTestId('trip-recap-stats')).toBeTruthy();
    expect(attempts).toBe(2);
    expect(screen.queryByTestId('trip-recap-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // photo-uploads task 22.7 — the redesigned recap (Requirements 15.21 to 15.24)
  // -------------------------------------------------------------------------

  describe('redesigned recap (decision D34)', () => {
    const flat = (node: ReactTestInstance): Record<string, unknown> =>
      (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;

    /** Every mocked icon host node (optionally with a glyph name) under `root`. */
    function iconsIn(root: ReactTestInstance, name?: string): ReactTestInstance[] {
      return root.findAll(
        (n) => (n.type as unknown) === 'Icon' && (name === undefined || n.props.name === name),
      );
    }

    /** The nearest ancestor of `node` that paints a background colour. */
    function paintedAncestor(node: ReactTestInstance): ReactTestInstance {
      let current: ReactTestInstance | null = node.parent;
      while (current !== null && flat(current).backgroundColor === undefined) {
        current = current.parent;
      }
      if (current === null) throw new Error('no painted ancestor');
      return current;
    }

    test('hero: trip name as a header, "Shared by <name>" pill, ring and "N of M" with the right numbers', async () => {
      program(recapDto());
      renderRecap();

      const title = await screen.findByTestId('trip-recap-trip-name');
      expect(title).toHaveTextContent('Fall 2026 Family Trip');
      expect(title.props.accessibilityRole).toBe('header');
      expect(screen.getByText('Shared by Minnie Mouse')).toBeTruthy();
      // The sharer is named exactly once on screen: the header does not repeat the pill.
      expect(screen.getAllByText(/Minnie Mouse/)).toHaveLength(1);
      expect(screen.queryByText('Minnie Mouse shared this recap')).toBeNull();
      // The Summary's own hero copy must not leak into the recap.
      expect(screen.queryByText('Vacation Wrap-Up')).toBeNull();

      expect(screen.getByLabelText('78% of planned experiences completed')).toBeTruthy();
      expect(screen.getByTestId('trip-recap-planned-count')).toHaveTextContent('7 of 9');
      expect(screen.getByText('planned Experiences completed')).toBeTruthy();
      expect(screen.queryByText(RECAP_NO_PLAN_COPY)).toBeNull();
    });

    test('hero falls back to "Shared recap" when the sharer name is empty', async () => {
      program(recapDto({ sharerDisplayName: '' }));
      renderRecap();

      expect(await screen.findByText('Shared recap')).toBeTruthy();
      expect(screen.queryByText(/^Shared by/)).toBeNull();
    });

    test('the four stat tiles show the Summary labels with their own bound values', async () => {
      program(recapDto());
      renderRecap();

      await screen.findByTestId('trip-recap-stats');
      expect(screen.getByTestId('trip-recap-distinct-count')).toHaveTextContent('12');
      expect(screen.getByTestId('trip-recap-total-completions-count')).toHaveTextContent('31');
      expect(screen.getByTestId('trip-recap-total-ratings-count')).toHaveTextContent('18');
      expect(screen.getByTestId('trip-recap-parks-explored-count')).toHaveTextContent('4');

      expect(screen.getByText('Distinct Rides & Shows')).toBeTruthy();
      expect(screen.getByText('Total Logged Rides')).toBeTruthy();
      expect(screen.getByText('Ratings Given')).toBeTruthy();
      expect(screen.getByText('Parks Explored')).toBeTruthy();
      // Each label sits in the same tile as its value (a swapped binding fails here).
      expect(
        within(screen.getByTestId('trip-recap-total-ratings')).getByText('Ratings Given'),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('trip-recap-parks-explored')).getByTestId(
          'trip-recap-parks-explored-count',
        ),
      ).toHaveTextContent('4');
    });

    test('a single distinct experience reads "Distinct Ride" like the Summary', async () => {
      program(recapDto({ recap: { ...FIGURES, distinctExperienceCount: 1 } }));
      renderRecap();

      expect(await screen.findByText('Distinct Ride')).toBeTruthy();
      expect(screen.queryByText('Distinct Rides & Shows')).toBeNull();
    });

    test('awards render as cards with the Summary icon mapping, the display name and the value', async () => {
      program(recapDto());
      renderRecap();

      expect(await screen.findByText('Group Superlatives & Awards')).toBeTruthy();
      const mvp = screen.getByTestId('trip-recap-superlative-group_mvp');
      expect(within(mvp).getByText('Group MVP')).toBeTruthy();
      expect(within(mvp).getByText('Mickey')).toBeTruthy();
      expect(within(mvp).getByText('7')).toBeTruthy();
      expect(iconsIn(mvp, 'trophy')).toHaveLength(1);

      const favorite = screen.getByTestId('trip-recap-superlative-crowd_favorite');
      expect(within(favorite).getByText('Space Mountain')).toBeTruthy();
      expect(within(favorite).getByText('9.5 ★')).toBeTruthy();
      expect(iconsIn(favorite, 'sparkles')).toHaveLength(1);
    });

    test('an award with an unknown icon key falls back to the ribbon glyph and an award with no winner reads "The Group"', async () => {
      program(
        recapDto({
          recap: {
            ...FIGURES,
            superlatives: [
              { id: 'odd', title: 'Odd One', description: 'Something new', icon: 'unknown-key' },
            ],
          },
        }),
      );
      renderRecap();

      const card = await screen.findByTestId('trip-recap-superlative-odd');
      expect(iconsIn(card, 'ribbon')).toHaveLength(1);
      expect(within(card).getByText('The Group')).toBeTruthy();
    });

    test('awards section is hidden when there are no superlatives', async () => {
      program(recapDto({ recap: { ...FIGURES, superlatives: [] } }));
      renderRecap();

      await screen.findByTestId('trip-recap-stats');
      expect(screen.queryByText('Group Superlatives & Awards')).toBeNull();
      expect(screen.queryByTestId('trip-recap-superlatives')).toBeNull();
    });

    test('top-rated rows show the catalog image, a category placeholder, the mean rating, the count and the park', async () => {
      program(recapDto());
      renderRecap();

      expect(await screen.findByText('Top-Rated Moments')).toBeTruthy();

      const space = screen.getByTestId('trip-recap-top-rated-Space Mountain');
      expect(space.findAllByType(Image)).toHaveLength(1);
      expect(space.findByType(Image).props.source).toEqual({
        uri: 'https://img.example.test/space-mountain.jpg',
      });
      expect(within(space).getByText('9.5')).toBeTruthy();
      expect(within(space).getByText('4 ratings')).toBeTruthy();
      expect(within(space).getByText('Magic Kingdom')).toBeTruthy();
      expect(within(space).getByText('#1')).toBeTruthy();
      expect(within(space).getByLabelText('Average rating 9.5 out of 10')).toBeTruthy();

      // No image: the Ride placeholder painted with the category fill, no <Image>.
      const soarin = screen.getByTestId('trip-recap-top-rated-Soarin Around the World');
      expect(soarin.findAllByType(Image)).toHaveLength(0);
      const glyph = iconsIn(soarin, lightTheme.categoryVisual.Ride.glyph).find(
        (n) => n.props.color === SUMMARY_MISC.light.thumbGlyph,
      );
      expect(glyph).toBeDefined();
      expect(flat(paintedAncestor(glyph!)).backgroundColor).toBe(
        lightTheme.categoryVisual.Ride.fill,
      );
      expect(within(soarin).getByText('1 rating')).toBeTruthy();
      expect(within(soarin).getByText('EPCOT')).toBeTruthy();
      expect(within(soarin).getByText('9')).toBeTruthy();

      // No catalog fields at all: neutral placeholder, no park badge, still renders.
      const dumbo = screen.getByTestId('trip-recap-top-rated-Dumbo the Flying Elephant');
      expect(dumbo.findAllByType(Image)).toHaveLength(0);
      expect(within(dumbo).getByText('7.3')).toBeTruthy();
      expect(within(dumbo).getByText('2 ratings')).toBeTruthy();
      expect(within(dumbo).getByText('#3')).toBeTruthy();
    });

    test('a catalog image that fails to load falls back to the category placeholder', async () => {
      program(recapDto());
      renderRecap();

      const space = await screen.findByTestId('trip-recap-top-rated-Space Mountain');
      fireEvent(space.findByType(Image), 'error');

      await waitFor(() => {
        expect(screen.getByTestId('trip-recap-top-rated-Space Mountain').findAllByType(Image)).toHaveLength(0);
      });
      expect(
        iconsIn(
          screen.getByTestId('trip-recap-top-rated-Space Mountain'),
          lightTheme.categoryVisual.Ride.glyph,
        ).length,
      ).toBeGreaterThan(0);
    });

    test('shows at most three top-rated rows', async () => {
      program(
        recapDto({
          recap: {
            ...FIGURES,
            topRated: [
              ...FIGURES.topRated,
              { experienceName: 'Fourth Row', meanRating: 6, ratingCount: 1 },
            ],
          },
        }),
      );
      renderRecap();

      await screen.findByText('Top-Rated Moments');
      expect(screen.getByTestId('trip-recap-top-rated-Dumbo the Flying Elephant')).toBeTruthy();
      expect(screen.queryByTestId('trip-recap-top-rated-Fourth Row')).toBeNull();
    });

    test('top-rated section is hidden when there are no rated experiences', async () => {
      program(recapDto({ recap: { ...FIGURES, topRated: [] } }));
      renderRecap();

      await screen.findByTestId('trip-recap-stats');
      expect(screen.queryByText('Top-Rated Moments')).toBeNull();
      expect(screen.queryByTestId('trip-recap-top-rated')).toBeNull();
    });

    test('never renders Member Contributions or any member id, even if the wire payload carried extras', async () => {
      const SENTINEL = 'SENTINEL_MEMBER_ID_9c1e';
      // A hostile/older server answer with runtime extras the DTO type forbids.
      apiRequestSpy.mockImplementation(async (_method: string, path: string) => {
        if (path !== RECAP_PATH) throw new Error(`unexpected ${path}`);
        return {
          ...recapDto(),
          recap: {
            ...FIGURES,
            memberId: SENTINEL,
            perMember: [
              {
                memberId: SENTINEL,
                displayName: 'SENTINEL_MEMBER_NAME',
                logEntryCount: 918273,
                confirmedTagCount: 918274,
              },
            ],
          },
        };
      });
      renderRecap();

      await screen.findByTestId('trip-recap-stats');
      expect(screen.queryByText('Member Contributions')).toBeNull();
      expect(screen.queryByText(/contributions/i)).toBeNull();
      const tree = JSON.stringify(screen.toJSON());
      expect(tree).not.toContain(SENTINEL);
      expect(tree).not.toContain('SENTINEL_MEMBER_NAME');
      expect(tree).not.toContain('918273');
      expect(tree).not.toContain('918274');
    });

    test('an empty trip renders the hero, four zero tiles and photos with no ring, no awards and no empty-state clutter', async () => {
      program(recapDto({ recap: EMPTY_FIGURES }));
      renderRecap();

      expect(await screen.findByTestId('trip-recap-hero')).toBeTruthy();
      expect(screen.getByText(RECAP_NO_PLAN_COPY)).toBeTruthy();
      expect(screen.queryByLabelText(/of planned experiences completed/)).toBeNull();
      expect(screen.queryByText(/\d+ of \d+/)).toBeNull();
      for (const id of [
        'trip-recap-distinct-count',
        'trip-recap-total-completions-count',
        'trip-recap-total-ratings-count',
        'trip-recap-parks-explored-count',
      ]) {
        expect(screen.getByTestId(id)).toHaveTextContent('0');
      }
      expect(screen.queryByText('Group Superlatives & Awards')).toBeNull();
      expect(screen.queryByText('Top-Rated Moments')).toBeNull();
      expect(screen.queryByText(/no rated experiences/i)).toBeNull();
      expect(screen.queryByText(RECAP_UNAVAILABLE_COPY)).toBeNull();
      // The unchanged photos section still renders under the figures.
      expect(await screen.findByTestId('trip-photo-highlight-photo-a')).toBeTruthy();
    });

    describe('theme', () => {
      afterEach(resetTestScheme);

      test('repaints with the active scheme: the tile value colour follows light and dark, and the placeholder keeps its category fill', async () => {
        program(recapDto());
        setTestScheme('dark');
        const dark = render(<RecapHarness />);
        const darkValue = await screen.findByTestId('trip-recap-distinct-count');
        expect(flat(darkValue).color).toBe(darkTheme.color.textPrimary);
        const darkSoarin = screen.getByTestId('trip-recap-top-rated-Soarin Around the World');
        const darkGlyph = iconsIn(darkSoarin, darkTheme.categoryVisual.Ride.glyph)[0]!;
        expect(flat(paintedAncestor(darkGlyph)).backgroundColor).toBe(
          darkTheme.categoryVisual.Ride.fill,
        );
        dark.unmount();

        setTestScheme('light');
        render(<RecapHarness />);
        const lightValue = await screen.findByTestId('trip-recap-distinct-count');
        expect(flat(lightValue).color).toBe(lightTheme.color.textPrimary);
        const lightSoarin = screen.getByTestId('trip-recap-top-rated-Soarin Around the World');
        const lightGlyph = iconsIn(lightSoarin, lightTheme.categoryVisual.Ride.glyph)[0]!;
        expect(flat(paintedAncestor(lightGlyph)).backgroundColor).toBe(
          lightTheme.categoryVisual.Ride.fill,
        );

        // The scheme actually changed the painted value (Ride fills are scheme-invariant).
        expect(darkTheme.color.textPrimary).not.toBe(lightTheme.color.textPrimary);
      });
    });

    test('the screen is built from the shared Summary components and mentions no per-member field', () => {
      const source = readFileSync(join(__dirname, '..', 'TripRecapScreen.tsx'), 'utf8');
      expect(source).not.toMatch(/perMember|memberId|Member Contributions/);
      for (const component of [
        'SummaryHeroCard',
        'SummaryStatTiles',
        'SummarySectionHeader',
        'SummaryAwardCard',
        'TopRatedMomentRow',
      ]) {
        expect(source).toMatch(
          new RegExp(`import \\{ ${component} \\} from '\\.\\./trips/summary/${component}'`),
        );
      }
    });
  });

  test('the screen reuses TripPhotosSection and defines no second photos section', () => {
    const source = readFileSync(join(__dirname, '..', 'TripRecapScreen.tsx'), 'utf8');
    expect(source).toMatch(/import \{ TripPhotosSection \} from '\.\.\/\.\.\/photos\/TripPhotosSection'/);
    expect(source).toMatch(/<TripPhotosSection\s+mode="recipient"/);
    expect(source).not.toMatch(/PhotoViewer|function\s+\w*Photos?Section/);
  });
});
