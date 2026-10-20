import React from 'react';
import { processColor, Share, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { darkTheme } from '../../../theme/theme';
import { ScreenContainer } from '../../../theme/components';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { SUMMARY_HERO, SUMMARY_MISC, SUMMARY_STAT } from '../TripSummaryScreen.palette';

import type {
  PhotoClientConfigDTO,
  SharedSummaryPhotoDTO,
  TripDTO,
  TripSummaryDTO,
} from '@dwt/shared';

import TripSummaryScreen, { TRIP_SUMMARY_TEXT_SHARE_NOTE } from '../TripSummaryScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-1';

/** A rich celebratory summary fixture. */
const SUMMARY_RICH: TripSummaryDTO = {
  distinctExperienceCount: 5,
  topRated: [
    {
      experienceId: 'exp-1',
      experienceName: 'Space Mountain',
      meanRating: 9.5,
      ratingCount: 4,
      park: 'Magic Kingdom',
      category: 'Ride',
      imageUrl: 'https://images.unsplash.com/space.jpg',
    },
    {
      experienceId: 'exp-2',
      experienceName: 'Soarin Around the World',
      meanRating: 9.0,
      ratingCount: 3,
      park: 'EPCOT',
      category: 'Ride',
      imageUrl: null,
    },
  ],
  perMember: [
    {
      memberId: 'mem-1',
      displayName: 'Mickey',
      avatarPreset: 'mickey',
      logEntryCount: 5,
      confirmedTagCount: 2,
      totalCompletedCount: 7,
      topRatedExperienceName: 'Space Mountain',
      topRating: 10,
    },
    {
      memberId: 'mem-2',
      displayName: 'Donald',
      avatarPreset: null,
      logEntryCount: 2,
      confirmedTagCount: 4,
      totalCompletedCount: 6,
      topRatedExperienceName: 'Soarin Around the World',
      topRating: 9,
    },
  ],
  plannedTotalCount: 6,
  plannedCompletedCount: 5,
  totalCompletionsCount: 13,
  totalRatingsCount: 7,
  parkBreakdown: [
    { park: 'Magic Kingdom', count: 3 },
    { park: 'EPCOT', count: 2 },
  ],
  categoryBreakdown: [
    { category: 'Ride', count: 5 },
  ],
  superlatives: [
    {
      id: 'group_mvp',
      title: 'Group MVP',
      description: 'Most experiences completed across the entire trip',
      icon: 'trophy',
      memberId: 'mem-1',
      memberDisplayName: 'Mickey',
      value: 7,
    },
    {
      id: 'best_copilot',
      title: 'Best Co-Pilot',
      description: 'Most confirmed rode-with tags on group rides',
      icon: 'people',
      memberId: 'mem-2',
      memberDisplayName: 'Donald',
      value: 4,
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
};

/** A summary with a non-empty Planned_List: 2 of 3 planned Experiences done. */
const SUMMARY_WITH_PLANNED: TripSummaryDTO = {
  distinctExperienceCount: 2,
  topRated: [],
  perMember: [],
  plannedTotalCount: 3,
  plannedCompletedCount: 2,
};

/** A summary for an empty Planned_List: the DTO reports 0/0 (R5.4). */
const SUMMARY_EMPTY_PLANNED: TripSummaryDTO = {
  distinctExperienceCount: 0,
  topRated: [],
  perMember: [],
  plannedTotalCount: 0,
  plannedCompletedCount: 0,
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeNavigation(): {
  navigate: jest.Mock;
  goBack: jest.Mock;
  canGoBack: jest.Mock;
} {
  return { navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true) };
}

function renderSummary(): ReturnType<typeof makeNavigation> {
  const navigation = makeNavigation();
  const props = {
    navigation,
    route: { key: 'TripSummary-1', name: 'TripSummary', params: { tripId: TRIP_ID } },
  } as unknown as React.ComponentProps<typeof TripSummaryScreen>;
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <TripSummaryScreen {...props} />
    </QueryClientProvider>,
  );
  return navigation;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Trip_Summary screen — celebratory culmination & stats (R14)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    jest.spyOn(Share, 'share').mockImplementation(async () => ({ action: 'sharedAction' }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders the completed-of-total planned line for a non-empty Planned_List', async () => {
    apiRequestMock.mockResolvedValue(SUMMARY_WITH_PLANNED);

    renderSummary();

    expect(await screen.findByTestId('trip-summary-planned')).toBeTruthy();
    const plannedCount = screen.getByTestId('trip-summary-planned-count');
    expect(plannedCount).toHaveTextContent('2 of 3');
    expect(screen.getByText('planned Experiences completed')).toBeTruthy();
  });

  test('R5.4: renders 0 of 0 for an empty Planned_List', async () => {
    apiRequestMock.mockResolvedValue(SUMMARY_EMPTY_PLANNED);

    renderSummary();

    expect(await screen.findByTestId('trip-summary-planned')).toBeTruthy();
    const plannedCount = screen.getByTestId('trip-summary-planned-count');
    expect(plannedCount).toHaveTextContent('0 of 0');
  });

  test('renders quick stat grid, superlatives, top rated, parks, and member favorites', async () => {
    apiRequestMock.mockResolvedValue(SUMMARY_RICH);

    renderSummary();

    // 1. Hero & Quick Stats
    expect(await screen.findByTestId('trip-summary-hero')).toBeTruthy();
    expect(screen.getByText('A Magical Adventure!')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-distinct-count')).toHaveTextContent('5');
    expect(screen.getByTestId('trip-summary-total-completions')).toBeTruthy();

    // 2. Superlatives
    expect(screen.getByTestId('trip-summary-superlatives')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-superlative-group_mvp')).toBeTruthy();
    expect(screen.getByText('Group MVP')).toBeTruthy();
    expect(screen.getByText('Best Co-Pilot')).toBeTruthy();
    expect(screen.getByText('Crowd Favorite')).toBeTruthy();

    // 3. Top-Rated Moments
    expect(screen.getByTestId('trip-summary-toprated')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-toprated-exp-1')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-toprated-exp-2')).toBeTruthy();
    expect(screen.getByText('Soarin Around the World')).toBeTruthy();

    // 4. Adventures by Park
    expect(screen.getByTestId('trip-summary-parks')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-park-Magic Kingdom')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-park-EPCOT')).toBeTruthy();

    // 5. Member Contributions
    expect(screen.getByTestId('trip-summary-member-mem-1')).toBeTruthy();
    expect(screen.getByTestId('trip-summary-member-mem-1-logs')).toHaveTextContent('5');
    expect(screen.getByTestId('trip-summary-member-mem-1-tags')).toHaveTextContent('2');
    expect(screen.getByTestId('trip-summary-member-mem-1-top')).toHaveTextContent(
      'Top Ride: Space Mountain (10 ★)',
    );

    // 6. Share trigger
    const shareBtn = screen.getByTestId('trip-summary-share-btn');
    fireEvent.press(shareBtn);
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Disney World Trip Highlights'),
      }),
    );
  });

  // Feature: dark-mode — the Trip Summary repaints with the Twilight palette.
  describe('dark mode', () => {
    afterEach(resetTestScheme);

    const flat = (node: ReactTestInstance): Record<string, unknown> =>
      (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;

    /** The screen root: the host View that `ScreenContainer` paints. */
    function rootContainer(): ReactTestInstance {
      const container = screen.UNSAFE_getAllByType(ScreenContainer)[0]!;
      return container.children[0] as ReactTestInstance;
    }

    /** Every mocked icon host node with the given glyph name. */
    function icons(name: string): ReactTestInstance[] {
      return screen.UNSAFE_root.findAll(
        (n) => (n.type as unknown) === 'Icon' && n.props.name === name,
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

    test('(a)(b)(c) paints the root, section titles and converted stat / favourite colours dark', async () => {
      apiRequestMock.mockResolvedValue(SUMMARY_RICH);
      setTestScheme('dark');
      renderSummary();

      await screen.findByTestId('trip-summary-hero');
      // (a) root container.
      expect(flat(rootContainer()).backgroundColor).toBe(darkTheme.color.background);
      // (b) primary text — a section title.
      expect(flat(screen.getByText('Top-Rated Moments')).color).toBe(darkTheme.color.textPrimary);
      // (c) quick-stat icon disc (rule 3 green S + T).
      const compass = icons('compass')[0]!;
      expect(compass.props.color).toBe(SUMMARY_STAT.dark.greenIcon);
      expect(flat(paintedAncestor(compass)).backgroundColor).toBe(SUMMARY_STAT.dark.greenBg);
      // (c) the member "Top Ride" pill text (rule 3 pink T).
      expect(flat(screen.getByText(/Top Ride: Soarin/)).color).toBe(SUMMARY_MISC.dark.favoriteText);
      // The H-role hero gradient is mode-invariant.
      // (expo-linear-gradient hands the native view processed colour ints.)
      expect(screen.getByTestId('trip-summary-hero').props.colors).toEqual(
        [SUMMARY_HERO.light.gradStart, SUMMARY_HERO.light.gradMid, SUMMARY_HERO.light.gradEnd].map(
          (c) => processColor(c),
        ),
      );
    });

    test('a category placeholder thumb uses the dark category fill with a white glyph', async () => {
      apiRequestMock.mockResolvedValue(SUMMARY_RICH);
      setTestScheme('dark');
      renderSummary();

      await screen.findByTestId('trip-summary-hero');
      // "Soarin" has no image, so it renders the Ride placeholder.
      const glyph = icons(darkTheme.categoryVisual.Ride.glyph).find(
        (n) => n.props.color === SUMMARY_MISC.dark.thumbGlyph,
      );
      expect(glyph).toBeDefined();
      expect(glyph!.props.color).toBe(darkTheme.color.textOnPrimary);
      expect(flat(paintedAncestor(glyph!)).backgroundColor).toBe(
        darkTheme.categoryVisual.Ride.fill,
      );
    });

    test('keeps the pre-retrofit light values under light', async () => {
      apiRequestMock.mockResolvedValue(SUMMARY_RICH);
      renderSummary();

      await screen.findByTestId('trip-summary-hero');
      const compass = icons('compass')[0]!;
      expect(compass.props.color).toBe('#2ECC71');
      expect(flat(paintedAncestor(compass)).backgroundColor).toBe('rgba(46, 204, 113, 0.15)');
      expect(flat(screen.getByText(/Top Ride: Soarin/)).color).toBe('#D81B60');
      const glyph = icons(darkTheme.categoryVisual.Ride.glyph).find(
        (n) => n.props.color === '#5b2a86',
      );
      expect(glyph).toBeDefined();
      expect(flat(paintedAncestor(glyph!)).backgroundColor).toBe('#7e57c2');
    });
  });
});

// ---------------------------------------------------------------------------
// photo-uploads task 22.5 — "Send to friends" entry beside the unchanged text share
// ---------------------------------------------------------------------------

const TRIP_DETAIL: TripDTO = {
  id: TRIP_ID,
  name: 'Fall 2026 Family Trip',
  description: '',
  startDate: '2026-10-01',
  endDate: '2026-10-08',
  status: 'past',
  createdAt: '2026-01-01T00:00:00.000Z',
  resorts: [],
  foodLists: [],
  experienceLists: [],
};

describe('Trip_Summary screen — Send to friends (photo-uploads R15.1, R15.8, R26.3)', () => {
  let shareSpy: jest.SpyInstance;

  beforeEach(() => {
    apiRequestMock.mockReset();
    shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  });

  afterEach(() => {
    shareSpy.mockRestore();
  });

  test('the OS text share still receives the unchanged text only, with no link and no photo', async () => {
    apiRequestMock.mockImplementation(async (_method, path) =>
      path === `/trips/${TRIP_ID}` ? TRIP_DETAIL : SUMMARY_RICH,
    );
    renderSummary();

    fireEvent.press(await screen.findByTestId('trip-summary-share-btn'));

    const expectedText = [
      '🏰 ✨ Disney World Trip Highlights ✨ 🏰',
      '',
      '🌟 Distinct Rides & Attractions: 5',
      '📋 Itinerary Completed: 5 of 6',
      '',
      '🏆 Group Superlatives:',
      '• Group MVP: Mickey (7)',
      '• Best Co-Pilot: Donald (4)',
      '• Crowd Favorite: Space Mountain (9.5 ★)',
      '',
      '⭐ Top Moments:',
      '1. Space Mountain — 9.5 ★',
      '2. Soarin Around the World — 9 ★',
      '',
      'Tracked with Disney World Tracker ✨',
    ].join('\n');
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy).toHaveBeenCalledWith({
      message: expectedText,
      title: 'Walt Disney World Vacation Summary',
    });
    expect(expectedText).not.toMatch(/https?:\/\//);
  });

  test('renders the note that photos cannot go in a text share', async () => {
    apiRequestMock.mockImplementation(async (_method, path) =>
      path === `/trips/${TRIP_ID}` ? TRIP_DETAIL : SUMMARY_RICH,
    );
    renderSummary();

    const note = await screen.findByTestId('trip-summary-text-share-note');
    expect(note.props.children).toBe(
      "Photos can't go in a text share. Use Send to friends to share the recap with photos.",
    );
    expect(TRIP_SUMMARY_TEXT_SHARE_NOTE).toBe(note.props.children);
  });

  test('"Send to friends" opens the tripSummary composer with the trip id and name, and does not open the OS share sheet', async () => {
    apiRequestMock.mockImplementation(async (_method, path) =>
      path === `/trips/${TRIP_ID}` ? TRIP_DETAIL : SUMMARY_RICH,
    );
    const navigation = renderSummary();

    const button = await screen.findByTestId('trip-summary-send-to-friends-btn');
    expect(button.props.accessibilityLabel).toBe('Send trip recap to friends');
    // Wait for the Trip name read so the composer preview gets the real name.
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', `/trips/${TRIP_ID}`);
    });
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(button);

    expect(navigation.navigate).toHaveBeenCalledWith('ShareComposer', {
      kind: 'tripSummary',
      tripId: TRIP_ID,
      tripName: 'Fall 2026 Family Trip',
    });
    expect(shareSpy).not.toHaveBeenCalled();
  });

  test('"View all in album" in the photos section navigates to TripAlbum with the trip id', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/photos/config') {
        return {
          enabled: true,
          foodEnabled: true,
          tripEnabled: true,
          maxPerFoodLog: 4,
          maxPerTrip: 500,
          maxFeedPostPhotos: 4,
          maxBatch: 10,
          maxBytes: 15_000_000,
          maxThumbBytes: 500_000,
          dailyCap: 20,
          remainingToday: 20,
          experienceStripMax: 8,
        } satisfies PhotoClientConfigDTO;
      }
      if (path === `/trips/${TRIP_ID}/photos?summary=true`) {
        return {
          items: [
            {
              id: 'photo-1',
              thumbUrl: 'https://r2.test/p/photo-1/t.jpg',
              url: 'https://r2.test/p/photo-1/f.jpg',
              width: 1200,
              height: 800,
              sortAt: '2026-10-02T12:00:00Z',
              mine: false,
            },
          ] satisfies SharedSummaryPhotoDTO[],
          nextCursor: null,
        };
      }
      return path === `/trips/${TRIP_ID}` ? TRIP_DETAIL : SUMMARY_RICH;
    });
    const navigation = renderSummary();

    fireEvent.press(await screen.findByTestId('view-all-in-album-btn'));

    expect(navigation.navigate).toHaveBeenCalledWith('TripAlbum', { tripId: TRIP_ID });
  });

  test('"Send to friends" falls back to a generic name when the Trip read fails, and still opens the composer', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/trips/${TRIP_ID}`) {
        throw new Error('offline');
      }
      return SUMMARY_RICH;
    });
    const navigation = renderSummary();

    fireEvent.press(await screen.findByTestId('trip-summary-send-to-friends-btn'));

    expect(navigation.navigate).toHaveBeenCalledWith('ShareComposer', {
      kind: 'tripSummary',
      tripId: TRIP_ID,
      tripName: 'Trip',
    });
  });
});
