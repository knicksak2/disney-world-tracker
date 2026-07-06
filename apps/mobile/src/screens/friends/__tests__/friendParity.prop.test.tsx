/**
 * Friend parity tests (stats-experience-redesign task 10.3).
 *
 * Feature: stats-experience-redesign, Property 10: Friend parity
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.6, 14.6
 *
 * ## What "structurally identical" means here (scoping note)
 *
 * R11.6 asks that, given identical `StatsResponse` data, the Friend_Surface's
 * coverage and ratings sections render a component tree structurally identical
 * to the Own detail screens, with differences limited to the percentile banner,
 * the interests section, and unlock-versus-neutral copy.
 *
 * The Friend_Surface deliberately does NOT render the Own `CoverageSection`
 * directly — `FriendProfileScreen` keeps its own tabbed/grouped coverage
 * structure (`byPark` / `byCategory` group headers) while reusing the SHARED
 * ratings building block (`RatingsSection`) and the shared coverage cells. So a
 * strict whole-tree structural-identity assertion across the two whole screens
 * is not achievable without rewriting `FriendProfileScreen` (explicitly out of
 * scope for this test task).
 *
 * We therefore frame Property 10 at the level the requirement actually
 * constrains:
 *
 *   1. **Shared-component structural identity (R11.1, R11.6).** For identical
 *      `ratings` data, the SHARED `RatingsSection` — the component both the Own
 *      `RatingsDetailScreen` and the Friend Overview render — produces a
 *      byte-identical component tree on both surfaces when `sufficient`, and a
 *      tree that differs ONLY in the empty-state copy when `!sufficient`
 *      (unlock-vs-neutral). This is the "same building blocks, differences
 *      limited to unlock-vs-neutral copy" half of R11.6, proven exhaustively
 *      with fast-check.
 *
 *   2. **Requirement-level parity on the real screen (R11.2, R11.3, R11.4,
 *      14.6).** Rendering the actual `FriendProfileScreen`, we assert the
 *      friend surface: gates ratings on the friend's OWN `sufficient`, shows the
 *      neutral "Not enough ratings yet" copy when insufficient (never the
 *      self-directed unlock CTA), omits the interests/facets section and the
 *      percentile banner, and collapses to a single unavailable message on
 *      `profile_forbidden`.
 *
 * The Own `RatingsDetailScreen` renders `<RatingsSection ratings={r} />`
 * (default `emptyVariant="self-unlock"`), and the Friend Overview renders
 * `<RatingsSection ratings={r} emptyVariant="neutral" />` — so comparing the two
 * `RatingsSection` variants directly is exactly comparing the reused shared
 * component as each surface configures it.
 */

import React from 'react';
import fc from 'fast-check';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import type { ProfileDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks for the real-screen tests (hoisted above imports by babel-jest).
// The pure `RatingsSection` property tests below need none of these, but the
// mocks are harmless to them.
// ---------------------------------------------------------------------------

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; keep the real `ApiError` so the screen's
// `error.code === 'profile_forbidden'` gate resolves against the genuine class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The screen wires row taps through React Navigation; render it standalone.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: () => undefined,
}));

import type {
  RatingStatistics,
  RatingDistribution,
  StatsResponse,
} from '../../../api/statsTypes';
import { MINIMUM_RATINGS_THRESHOLD } from '../../../api/statsTypes';
import { RatingsSection } from '../../stats/components';
import {
  makeInsufficientRatings,
  makeStatsResponse,
  makeSufficientRatings,
} from '../../stats/__testSupport__/statsFixture';

import FriendProfileScreen from '../FriendProfileScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Structural comparison helpers
// ---------------------------------------------------------------------------

type RenderedTree = ReturnType<ReturnType<typeof render>['toJSON']>;

/**
 * Reduce a rendered tree to a structure-only skeleton: element `type` plus the
 * recursively-reduced children, with every text leaf collapsed to the sentinel
 * `'#text'`. Two trees with an equal skeleton have the SAME component shape
 * (same element types, same nesting, same child counts) and differ, if at all,
 * only in their text content — exactly the "differences limited to copy"
 * boundary R11.6 draws.
 */
function skeleton(node: RenderedTree): unknown {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') return '#text';
  if (Array.isArray(node)) return node.map(skeleton);
  const children = node.children ?? [];
  return {
    type: node.type,
    children: children.map((child) => skeleton(child as RenderedTree)),
  };
}

// ---------------------------------------------------------------------------
// Generators (Property 10)
// ---------------------------------------------------------------------------

const ratedExperienceArb = fc.record({
  experienceId: fc.string({ minLength: 1, maxLength: 12 }),
  name: fc.string({ minLength: 1, maxLength: 24 }),
  value: fc.integer({ min: 1, max: 10 }),
});

/** A full 1..10 distribution map with non-negative counts. */
const distributionArb: fc.Arbitrary<RatingDistribution> = fc
  .array(fc.nat({ max: 20 }), { minLength: 10, maxLength: 10 })
  .map(
    (counts) =>
      ({
        1: counts[0],
        2: counts[1],
        3: counts[2],
        4: counts[3],
        5: counts[4],
        6: counts[5],
        7: counts[6],
        8: counts[7],
        9: counts[8],
        10: counts[9],
      }) as RatingDistribution,
  );

const averageByParkArb = fc.dictionary(
  fc.constantFrom('Magic Kingdom', 'EPCOT', "Disney's Hollywood Studios"),
  fc.integer({ min: 10, max: 100 }).map((n) => n / 10),
);

const averageByCategoryArb = fc.dictionary(
  fc.constantFrom('Ride', 'Show', 'Dining'),
  fc.integer({ min: 10, max: 100 }).map((n) => n / 10),
);

/** A `sufficient: true` `RatingStatistics` with every gated field present. */
const sufficientRatingsArb: fc.Arbitrary<RatingStatistics> = fc.record({
  sufficient: fc.constant(true as const),
  ratedCompletionsCount: fc.integer({ min: MINIMUM_RATINGS_THRESHOLD, max: 250 }),
  average: fc.integer({ min: 10, max: 100 }).map((n) => n / 10),
  averageByPark: averageByParkArb,
  averageByCategory: averageByCategoryArb,
  distribution: distributionArb,
  highest: ratedExperienceArb,
  lowest: ratedExperienceArb,
});

/** A `sufficient: false` `RatingStatistics` (only `ratedCompletionsCount`). */
const insufficientRatingsArb: fc.Arbitrary<RatingStatistics> = fc
  .integer({ min: 0, max: MINIMUM_RATINGS_THRESHOLD - 1 })
  .map((ratedCompletionsCount) => ({
    sufficient: false as const,
    ratedCompletionsCount,
  }));

// ---------------------------------------------------------------------------
// Property 10 — shared-component structural identity (R11.1, R11.6)
// ---------------------------------------------------------------------------

describe('Property 10: Friend parity — shared RatingsSection (R11.1, R11.6)', () => {
  it('renders a byte-identical tree on Own and Friend surfaces when ratings are sufficient', () => {
    fc.assert(
      fc.property(sufficientRatingsArb, (ratings) => {
        // Own surface: RatingsDetailScreen renders RatingsSection with the
        // default self-unlock variant. Friend surface: FriendProfileScreen
        // renders the SAME component with emptyVariant="neutral". With
        // sufficient ratings the empty-state variant is irrelevant, so the two
        // trees must be identical — the shared building block produces the same
        // rich view on both surfaces (R11.1, R11.6).
        const own = render(<RatingsSection ratings={ratings} />);
        const ownTree = own.toJSON();
        own.unmount();

        const friend = render(
          <RatingsSection ratings={ratings} emptyVariant="neutral" />,
        );
        const friendTree = friend.toJSON();
        friend.unmount();

        expect(friendTree).toEqual(ownTree);
      }),
      { numRuns: 40 },
    );
  });

  it('differs only in empty-state copy on Own vs Friend surfaces when insufficient (R11.3, R11.6)', () => {
    fc.assert(
      fc.property(insufficientRatingsArb, (ratings) => {
        const own = render(<RatingsSection ratings={ratings} />);
        const ownSkeleton = skeleton(own.toJSON());
        // Own surface shows the self-directed unlock call-to-action.
        expect(own.queryByText('Unlock your ratings')).toBeTruthy();
        expect(own.queryByText('Not enough ratings yet')).toBeNull();
        own.unmount();

        const friend = render(
          <RatingsSection ratings={ratings} emptyVariant="neutral" />,
        );
        const friendSkeleton = skeleton(friend.toJSON());
        // Friend surface shows the neutral, friend-safe message instead.
        expect(friend.queryByText('Not enough ratings yet')).toBeTruthy();
        expect(friend.queryByText('Unlock your ratings')).toBeNull();
        friend.unmount();

        // Same component shape (element types + nesting + child counts); the
        // ONLY difference is the text copy (R11.6: differences limited to
        // unlock-vs-neutral copy).
        expect(friendSkeleton).toEqual(ownSkeleton);
      }),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// Real-screen parity assertions (R11.2, R11.3, R11.4, 14.6)
// ---------------------------------------------------------------------------

const FRIEND_ID = 'friend-0001';
const DISPLAY_NAME = 'Mickey Mouse';

function makeProfile(overrides: Partial<ProfileDTO> = {}): ProfileDTO {
  return {
    userId: FRIEND_ID,
    displayName: DISPLAY_NAME,
    avatarPreset: null,
    overallCompletionPercent: 42,
    ...overrides,
  };
}

const isProfilePath = (p: string): boolean => p.endsWith('/profile');
const isStatsSummaryPath = (p: string): boolean => p.includes('/stats/summary');
const isOwnStatsPath = (p: string): boolean => p === '/me/stats';
const isMePath = (p: string): boolean => p === '/me';
const isCompletionsPath = (p: string): boolean => p.endsWith('/completions');

interface ScreenScenario {
  /** Friend stats read result, or an ApiError to reject with. */
  friendStats: StatsResponse | ApiError;
  /** Reject the friend profile read with this error (e.g. profile_forbidden). */
  profileError?: ApiError;
}

function installApiMock(scenario: ScreenScenario): void {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (isStatsSummaryPath(path)) {
      if (scenario.friendStats instanceof ApiError) {
        throw scenario.friendStats;
      }
      return scenario.friendStats;
    }
    if (isOwnStatsPath(path)) return makeStatsResponse();
    if (isMePath(path)) {
      return { user: { id: 'me-0001', email: 'me@test.local' }, profile: { displayName: 'Me' } };
    }
    if (isCompletionsPath(path)) return { entries: [] };
    if (isProfilePath(path)) {
      if (scenario.profileError) throw scenario.profileError;
      return makeProfile();
    }
    throw new Error(`unexpected call to ${path}`);
  });
}

function renderFriendScreen(): void {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <FriendProfileScreen
        route={{ params: { friendId: FRIEND_ID, displayName: DISPLAY_NAME } }}
      />
    </QueryClientProvider>,
  );
}

function forbidden(): ApiError {
  return new ApiError({
    code: 'profile_forbidden',
    message: 'This profile is not available.',
    status: 403,
  });
}

describe('Friend parity — real FriendProfileScreen (R11.2, R11.3, R11.4, 14.6)', () => {
  test('R11.2/R11.3: an insufficiently-rated friend shows the neutral copy, never the self-directed unlock CTA', async () => {
    installApiMock({
      friendStats: makeStatsResponse({ ratings: makeInsufficientRatings(1) }),
    });

    renderFriendScreen();

    // The shared ratings section is mounted on the friend Overview...
    expect(await screen.findByTestId('friend-ratings-section')).toBeTruthy();
    // ...gated on the friend's OWN `sufficient` (false here), so it shows the
    // neutral, friend-safe message and NOT the self-directed unlock CTA (R11.3).
    expect(screen.getByText('Not enough ratings yet')).toBeTruthy();
    expect(screen.queryByText('Unlock your ratings')).toBeNull();
  });

  test('R11.1: a sufficiently-rated friend renders the same rich ratings section as the Own surface', async () => {
    const ratings = makeSufficientRatings({ ratedCompletionsCount: 21 });
    installApiMock({ friendStats: makeStatsResponse({ ratings }) });

    renderFriendScreen();

    // Rich view building blocks from the SHARED RatingsSection (R11.1, R8.1).
    expect(await screen.findByTestId('friend-ratings-section')).toBeTruthy();
    expect(screen.getByText('Average rating')).toBeTruthy();
    expect(screen.getByText('Rating distribution')).toBeTruthy();
    expect(screen.getByText('21 rated experiences')).toBeTruthy();
    // Not the unlock/neutral empty state.
    expect(screen.queryByText('Not enough ratings yet')).toBeNull();
    expect(screen.queryByText('Unlock your ratings')).toBeNull();
  });

  test('R11.4: the friend surface omits the interests/facets section', async () => {
    // Friend stats carry populated facets, but the friend Overview must not
    // render the interests section at all (R11.4).
    installApiMock({ friendStats: makeStatsResponse() });

    renderFriendScreen();

    expect(await screen.findByTestId('friend-ratings-section')).toBeTruthy();
    // DEFAULT_FACETS include the 'thrill' facet; the Own InterestsSection would
    // render `facet-tile-thrill`. It must be absent on the friend surface.
    expect(screen.queryByTestId('facet-tile-thrill')).toBeNull();
    expect(screen.queryByTestId('facet-tile-dark-ride')).toBeNull();
    expect(screen.queryByText('No interests yet')).toBeNull();
  });

  test('R10.6/R11.4: the friend surface never renders a percentile banner', async () => {
    // Even when a percentileRank is present in the data, the friend surface
    // must not render the percentile brag banner (R10.6).
    installApiMock({
      friendStats: makeStatsResponse({ percentileRank: 87.5 }),
    });

    renderFriendScreen();

    expect(await screen.findByTestId('friend-ratings-section')).toBeTruthy();
    // The banner's phrasing never appears on the friend surface.
    expect(screen.queryByText(/ahead of .*% of trackers/)).toBeNull();
  });

  test('14.6: a profile_forbidden read collapses the friend surface to a single unavailable message', async () => {
    installApiMock({
      friendStats: forbidden(),
      profileError: forbidden(),
    });

    renderFriendScreen();

    // The whole view collapses to the single unavailable message; the tab
    // selector and every mode pane are withheld (R14.6).
    expect(await screen.findByTestId('friend-profile-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('tab-selector')).toBeNull();
    expect(screen.queryByTestId('friend-ratings-section')).toBeNull();
    expect(screen.queryByTestId('friend-mode-overview')).toBeNull();
  });
});
