import React from 'react';
import { processColor, Share, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { darkTheme } from '../../../theme/theme';
import { ScreenContainer } from '../../../theme/components';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { SUMMARY_HERO, SUMMARY_MISC, SUMMARY_STAT } from '../TripSummaryScreen.palette';

import type { TripSummaryDTO } from '@dwt/shared';

import TripSummaryScreen from '../TripSummaryScreen';
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

function renderSummary(): void {
  const props = {
    navigation: makeNavigation(),
    route: { key: 'TripSummary-1', name: 'TripSummary', params: { tripId: TRIP_ID } },
  } as unknown as React.ComponentProps<typeof TripSummaryScreen>;
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <TripSummaryScreen {...props} />
    </QueryClientProvider>,
  );
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
