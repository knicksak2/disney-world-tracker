/**
 * StatsScreen (Overview_Hub) tests (stats-experience-redesign task 8.2).
 *
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5, 4.1, 10.3, 10.4, 14.1, 14.2
 *
 * `StatsScreen` is the Stats tab landing hub. It issues EXACTLY ONE shared,
 * cached `['me-stats', { percentile: true }]` query and derives its hero ring,
 * opt-in percentile banner, and curated highlight / entry cards from that
 * single `StatsResponse` snapshot. These React Native Testing Library tests pin
 * the behaviours called out by the task:
 *
 *   - **Renders the hero, percentile banner, and highlight cards (R1.1, R1.3).**
 *     A successful snapshot renders `OverallHeroCard` (`stats-hero`), the
 *     `PercentileBanner` (`stats-percentile-banner`) when a rank is present, and
 *     one `HighlightCard` per curated highlight (`stats-highlight-<id>`).
 *   - **Each card is a labelled button that navigates (R1.4, R1.5).** Every
 *     highlight card is exposed with `accessibilityRole="button"` and the
 *     composed story+action label; pressing it dispatches `navigation.navigate`
 *     to the highlight's matching StatsStack detail route.
 *   - **Locked ratings tease (R1.3, R2.8).** An under-threshold snapshot renders
 *     the ratings card as a locked "Unlock ratings (N/3)" tease that still
 *     routes to `RatingsDetail`.
 *   - **Percentile visibility (R10.3, R10.4).** The banner is hidden when the
 *     rank is absent or `percentileUnavailable`, without blocking the sections
 *     below.
 *   - **Loading / error (R14.1, R14.2).** A cold in-flight read shows the
 *     view-level loader; a failed read shows the error card plus a Retry control
 *     that re-issues only the shared stats query.
 *
 * Following the sibling detail-screen tests, only the lowest-level `apiRequest`
 * (`api/client`) is mocked; the real `ApiError`, the real `statsView`
 * transforms, and the real hub components run on top of it. The screen's
 * navigation hooks (`useNavigation`, `useFocusEffect`) are stubbed so the hub
 * renders standalone without a navigator, with a single shared `navigate` spy
 * so the drill-in dispatches can be asserted (P4.1: one cached read).
 */

import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store` — the real `api/client` module (kept via
// `requireActual`) imports secure-store-backed session storage at load time.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// `expo-constants` supplies the API base URL (never read at runtime here since
// the network call is mocked, but referenced defensively on import).
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` (and everything
// else) so the screen's error checks resolve against the genuine class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// A single shared `navigate` spy the hub dispatches drill-ins through. The hub
// calls `useNavigation()` more than once (highlights + the share entry point),
// so a stable object is returned each time to keep the spy assertable. The
// `mock` prefix is required for the jest.mock factory to reference it.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: () => undefined,
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import StatsScreen from '../StatsScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import { MINIMUM_RATINGS_THRESHOLD } from '../../../api/statsTypes';
import {
  buildOverviewHighlights,
  phrasePercentile,
  type HighlightTarget,
  type OverviewHighlight,
} from '../statsView';
import {
  makeInsufficientRatings,
  makeStatsResponse,
} from '../__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Shared query key (byte-identical to the one the hub registers).
// ---------------------------------------------------------------------------

const SHARED_STATS_QUERY_KEY = ['me-stats', { percentile: true }] as const;

/** The stats path the hub fetches (opt-in percentile variant, R10.1). */
const STATS_PATH = '/me/stats?percentile=true';
const isStatsPath = (p: string): boolean => p === STATS_PATH;

/** A promise that never settles — keeps the request in its loading state. */
const pendingForever = (): Promise<never> => new Promise<never>(() => undefined);

function transientError(): ApiError {
  return new ApiError({
    code: 'internal_error',
    message: 'Something went wrong.',
    status: 500,
  });
}

/** Count `apiRequest` calls whose path satisfies `pred`. */
function callsMatching(pred: (path: string) => boolean): number {
  return apiRequestMock.mock.calls.filter(
    (call) => typeof call[1] === 'string' && pred(call[1] as string),
  ).length;
}

// ---------------------------------------------------------------------------
// Label / navigation reconstruction (mirrors HighlightCard + the hub's
// `navigateToHighlight`) so assertions track the highlight data.
// ---------------------------------------------------------------------------

/** The action phrase HighlightCard appends per drill-in route (R15.2). */
function actionPhrase(target: HighlightTarget): string {
  switch (target.route) {
    case 'CoverageDetail':
      return 'Opens coverage details';
    case 'RatingsDetail':
      return 'Opens ratings details';
    case 'InterestsDetail':
      return 'Opens interests details';
    case 'ExperiencesDetail':
      return 'Opens your experiences';
    default:
      return 'Opens details';
  }
}

/** The single spoken label HighlightCard composes for a highlight (R15.2). */
function expectedCardLabel(highlight: OverviewHighlight): string {
  const parts: string[] = [highlight.title, highlight.headline];
  if (highlight.subtext !== undefined) parts.push(highlight.subtext);
  if (highlight.complete === true) parts.push('Complete');
  if (highlight.locked === true) parts.push('Locked');
  parts.push(actionPhrase(highlight.target));
  return parts.join('. ');
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

/**
 * Render the hub. When `seed` is supplied it is written into the shared cache
 * entry BEFORE mount (freshly, within the staleTime window) so the hub reads a
 * warm cache and renders its success surface with no network flash.
 */
function renderScreen(seed?: ReturnType<typeof makeStatsResponse>): {
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  if (seed !== undefined) {
    client.setQueryData(SHARED_STATS_QUERY_KEY, seed);
  }
  render(
    <QueryClientProvider client={client}>
      <StatsScreen />
    </QueryClientProvider>,
  );
  return { client };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('StatsScreen Overview_Hub (Requirements 1.1, 1.3, 1.4, 1.5, 4.1, 10.3, 10.4, 14.1, 14.2)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    mockNavigate.mockReset();
    // Default: the shared read resolves with a sufficient snapshot. Tests that
    // seed the cache never hit this; loading/error tests override it.
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === STATS_PATH) return makeStatsResponse();
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });

  // -------------------------------------------------------------------------
  // Composition — hero + percentile + highlight cards (R1.1, R1.3)
  // -------------------------------------------------------------------------
  test('R1.1/R1.3: renders the hero, percentile banner, and one card per curated highlight', async () => {
    const stats = makeStatsResponse({ percentileRank: 87.5 });
    renderScreen(stats);

    expect(await screen.findByTestId('stats-screen')).toBeTruthy();

    // Hero overall-completion card (R1.1).
    expect(screen.getByTestId('stats-hero')).toBeTruthy();
    // Opt-in percentile brag banner present (rank supplied) (R10.3).
    expect(screen.getByTestId('stats-percentile-banner')).toBeTruthy();
    // Progress share entry point present in the header.
    expect(screen.getByTestId('stats-share-button')).toBeTruthy();

    // One HighlightCard per curated highlight, in the returned order (R1.3).
    const highlights = buildOverviewHighlights(stats);
    expect(highlights.length).toBeGreaterThanOrEqual(3);
    for (const highlight of highlights) {
      expect(screen.getByTestId(`stats-highlight-${highlight.id}`)).toBeTruthy();
    }

    // Not gated by loading / error.
    expect(screen.queryByTestId('stats-loading')).toBeNull();
    expect(screen.queryByTestId('stats-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Each highlight card is a labelled button (R1.4, R15.2)
  // -------------------------------------------------------------------------
  test('R1.4: each highlight card is a button exposing the composed story+action label', async () => {
    const stats = makeStatsResponse();
    renderScreen(stats);

    expect(await screen.findByTestId('stats-screen')).toBeTruthy();

    for (const highlight of buildOverviewHighlights(stats)) {
      const card = screen.getByTestId(`stats-highlight-${highlight.id}`);
      expect(card.props.accessibilityRole).toBe('button');
      expect(card.props.accessibilityLabel).toBe(expectedCardLabel(highlight));
    }
  });

  // -------------------------------------------------------------------------
  // Pressing a card drills into its matching route (R1.4, R1.5)
  // -------------------------------------------------------------------------
  test('R1.5: pressing each highlight card dispatches navigation.navigate to its matching route', async () => {
    const stats = makeStatsResponse();
    renderScreen(stats);

    expect(await screen.findByTestId('stats-screen')).toBeTruthy();

    for (const highlight of buildOverviewHighlights(stats)) {
      mockNavigate.mockClear();
      fireEvent.press(screen.getByTestId(`stats-highlight-${highlight.id}`));

      const { target } = highlight;
      if (target.route === 'CoverageDetail') {
        // Coverage always dispatches with an (optional) serializable focus hint.
        expect(mockNavigate).toHaveBeenCalledWith(
          'CoverageDetail',
          target.focus !== undefined ? { focus: target.focus } : undefined,
        );
      } else {
        expect(mockNavigate).toHaveBeenCalledWith(target.route);
      }
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    }
  });

  // -------------------------------------------------------------------------
  // Locked ratings tease (R1.3, R2.8)
  // -------------------------------------------------------------------------
  test('R1.3: an insufficient snapshot renders the locked ratings tease "(N/3)" routing to RatingsDetail', async () => {
    const stats = makeStatsResponse({ ratings: makeInsufficientRatings(2) });
    renderScreen(stats);

    const card = await screen.findByTestId('stats-highlight-ratings');

    // Locked "Unlock ratings (2/3)" tease, exposed as a button.
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toContain(
      `Unlock ratings (2/${MINIMUM_RATINGS_THRESHOLD})`,
    );
    expect(card.props.accessibilityLabel).toContain('Locked');

    // Still routes to RatingsDetail.
    fireEvent.press(card);
    expect(mockNavigate).toHaveBeenCalledWith('RatingsDetail');
  });

  // -------------------------------------------------------------------------
  // Percentile banner present when rank is a number (R10.3)
  // -------------------------------------------------------------------------
  test('R10.3: the percentile banner renders the warm phrasing when a rank is present', async () => {
    renderScreen(makeStatsResponse({ percentileRank: 87.5 }));

    const banner = await screen.findByTestId('stats-percentile-banner');
    expect(banner.props.accessibilityLabel).toBe(phrasePercentile(87.5));
  });

  // -------------------------------------------------------------------------
  // Percentile banner hidden when the rank is absent (R10.4)
  // -------------------------------------------------------------------------
  test('R10.4: the percentile banner is hidden when no rank is present, without blocking the sections', async () => {
    renderScreen(makeStatsResponse());

    expect(await screen.findByTestId('stats-screen')).toBeTruthy();
    expect(screen.queryByTestId('stats-percentile-banner')).toBeNull();
    // The rest of the hub still renders.
    expect(screen.getByTestId('stats-hero')).toBeTruthy();
    expect(screen.getByTestId('stats-highlight-coverage')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Percentile banner hidden when unavailable (R10.4)
  // -------------------------------------------------------------------------
  test('R10.4: the percentile banner is hidden when percentileUnavailable, without blocking the sections', async () => {
    renderScreen(makeStatsResponse({ percentileUnavailable: true }));

    expect(await screen.findByTestId('stats-screen')).toBeTruthy();
    expect(screen.queryByTestId('stats-percentile-banner')).toBeNull();
    // A failed percentile never gates any other section (R14.4).
    expect(screen.getByTestId('stats-hero')).toBeTruthy();
    expect(screen.getByTestId('stats-highlight-coverage')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // View-level loading (R14.1)
  // -------------------------------------------------------------------------
  test('R14.1: shows the view-level loader while the shared query is in flight with no cached data', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === STATS_PATH) return pendingForever();
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderScreen();

    expect(await screen.findByTestId('stats-loading')).toBeTruthy();
    // The hub content is gated until the shared query resolves.
    expect(screen.queryByTestId('stats-screen')).toBeNull();
    expect(screen.queryByTestId('stats-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // View-level error + Retry (R14.2)
  // -------------------------------------------------------------------------
  test('R14.2: a failed shared query shows the error card and a Retry control', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === STATS_PATH) throw transientError();
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderScreen();

    expect(await screen.findByTestId('stats-error')).toBeTruthy();
    expect(screen.getByTestId('stats-error-retry')).toBeTruthy();
    // The hub content stays withheld while the shared query is in error.
    expect(screen.queryByTestId('stats-screen')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Retry re-issues only the shared query and recovers the view (R14.2)
  // -------------------------------------------------------------------------
  test('R14.2: tapping Retry re-issues only the shared stats query and renders the hub on success', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === STATS_PATH) throw transientError();
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderScreen();

    const retry = await screen.findByTestId('stats-error-retry');

    await waitFor(() => {
      expect(callsMatching(isStatsPath)).toBe(1);
    });

    // The re-issued request now succeeds.
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === STATS_PATH) return makeStatsResponse();
      throw new Error(`unexpected call to ${String(path)}`);
    });
    fireEvent.press(retry);

    expect(await screen.findByTestId('stats-screen')).toBeTruthy();
    // Only the one shared stats query was re-issued (R4.1).
    expect(callsMatching(isStatsPath)).toBe(2);
  });
});
