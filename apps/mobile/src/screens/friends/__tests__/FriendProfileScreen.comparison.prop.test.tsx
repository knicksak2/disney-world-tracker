// Feature: social-sharing-loop, Property 20: Progress comparison presents both
// parties' percentages, labeled and one-decimal
//
// Validates: Requirements 12.1, 12.2, 12.3
//
// Property 20 (from design.md):
//   For any viewer and Friend completion data, the Progress_Comparison
//   presents, for the overall figure and for every Park and every
//   Experience_Category, both the viewer's and the Friend's percentage each
//   within [0.0, 100.0] to one decimal place and each labeled to identify
//   whether it belongs to the viewer or the Friend.
//
// Test strategy:
//   - Generate an independent completion percentage for the viewer and for the
//     Friend, for the overall figure and for every Park and every
//     Experience_Category. Percentages are drawn as integer tenths in
//     [0, 1000] mapped to [0.0, 100.0], so each already sits inside the
//     required range and has a well-defined one-decimal presentation.
//   - Render the real FriendProfileScreen over these fixtures (mocking only the
//     lowest-level `apiRequest`, exactly as the mode-content tests do), switch
//     to the Compare tab, and wait for the derived side-by-side rows.
//   - For the overall row and every per-Park / per-Experience_Category row,
//     assert BOTH parties are present as two distinct labeled cells:
//       * the viewer cell (`<row>-viewer`) carries the viewer owner label
//         ("You") and the viewer's percentage rendered to exactly one decimal
//         place with a trailing "%";
//       * the Friend cell (`<row>-friend`) carries the Friend's display name
//         and the Friend's percentage rendered the same way.
//     Exact string equality on `${value.toFixed(1)}%` enforces the one-decimal
//     presentation; the value is generated inside [0.0, 100.0] so the rendered
//     figure is necessarily in range.
//   - Unmount between samples so React trees do not accumulate across runs.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, within } from '@testing-library/react-native';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ProfileDTO,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
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

// Replace only `apiRequest`; preserve the real `ApiError` so the screen's
// `error instanceof ApiError` checks and the hooks' retry policy resolve
// against the genuine class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The Compare pane renders standalone (no navigator); stub the navigation
// hooks the screen depends on, as the mode-content tests do.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: () => undefined,
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import FriendProfileScreen from '../FriendProfileScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type { CompletionCell, StatsResponse } from '../../../api/statsTypes';
import { makeStatsResponse } from '../../stats/__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixed identity
// ---------------------------------------------------------------------------

const FRIEND_ID = 'friend-0001';
const OWN_ID = '00000000-0000-0000-0000-000000000001';
const DISPLAY_NAME = 'Minnie Mouse';
const VIEWER_LABEL = 'You';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A completion percentage drawn as integer tenths in [0, 1000] mapped to
 * [0.0, 100.0]. Every sample is already inside the required range and its
 * one-decimal presentation (`value.toFixed(1)`) is exact.
 */
const percentArb: fc.Arbitrary<number> = fc
  .integer({ min: 0, max: 1000 })
  .map((n) => n / 10);

interface StatsSpec {
  readonly overall: number;
  readonly byPark: Readonly<Record<(typeof PARKS)[number], number>>;
  readonly byCategory: Readonly<
    Record<(typeof EXPERIENCE_CATEGORIES)[number], number>
  >;
}

const statsSpecArb: fc.Arbitrary<StatsSpec> = fc.record({
  overall: percentArb,
  byPark: fc.record(
    Object.fromEntries(PARKS.map((park) => [park, percentArb])) as Record<
      (typeof PARKS)[number],
      fc.Arbitrary<number>
    >,
  ),
  byCategory: fc.record(
    Object.fromEntries(
      EXPERIENCE_CATEGORIES.map((category) => [category, percentArb]),
    ) as Record<(typeof EXPERIENCE_CATEGORIES)[number], fc.Arbitrary<number>>,
  ),
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a `CompletionCell` carrying an exact `percent`. Only `percent` feeds
 * the Progress_Comparison, so the completed/total counts are zeroed; the cell
 * still satisfies the shape the nested `coverage.*` reads expect.
 */
const cell = (percent: number): CompletionCell => ({
  completed: 0,
  total: 0,
  percent,
  remaining: 0,
  completeBadge: false,
});

/**
 * Build a full nested stats roll-up from a spec. Only `percent` feeds the
 * comparison; every Park and Category cell is present so the derivation emits
 * a stable, fully populated layout, read through `coverage.*` (task 11.1).
 */
function buildStats(spec: StatsSpec): StatsResponse {
  const byPark = Object.fromEntries(
    PARKS.map((park) => [park, cell(spec.byPark[park])]),
  ) as Record<(typeof PARKS)[number], CompletionCell>;

  const byCategory = Object.fromEntries(
    EXPERIENCE_CATEGORIES.map((category) => [
      category,
      cell(spec.byCategory[category]),
    ]),
  ) as Record<(typeof EXPERIENCE_CATEGORIES)[number], CompletionCell>;

  return makeStatsResponse({
    coverage: {
      overall: cell(spec.overall),
      byPark,
      byCategory,
    },
  });
}

function makeProfile(): ProfileDTO {
  return {
    userId: FRIEND_ID,
    displayName: DISPLAY_NAME,
    avatarPreset: null,
    overallCompletionPercent: 0,
  };
}

// ---------------------------------------------------------------------------
// Route wiring
// ---------------------------------------------------------------------------

const isStatsSummary = (p: string): boolean => p.includes('/stats/summary');
const isOwnStats = (p: string): boolean => p === '/me/stats';
const isMe = (p: string): boolean => p === '/me';
const isProfile = (p: string): boolean => p.endsWith('/profile');
const isCompletions = (p: string): boolean => p.endsWith('/completions');

function installRoutes(viewer: StatsResponse, friend: StatsResponse): void {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    // Order matters: `/me/stats/summary?for=` must match before `/me/stats`.
    if (isStatsSummary(path)) return friend;
    if (isOwnStats(path)) return viewer;
    if (isMe(path)) {
      return { user: { id: OWN_ID, email: 'me@test.local' }, profile: { displayName: 'Me' } };
    }
    if (isProfile(path)) return makeProfile();
    if (isCompletions(path)) return { entries: [] };
    throw new Error(`unexpected call to ${path}`);
  });
}

function renderScreen(): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <FriendProfileScreen
        route={{ params: { friendId: FRIEND_ID, displayName: DISPLAY_NAME } }}
      />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

/** Expected one-decimal presentation of a percentage, e.g. `42` → "42.0%". */
const expectedPercent = (value: number): string => `${value.toFixed(1)}%`;

describe("Property 20: Progress_Comparison presents both parties' percentages, labeled and one-decimal (R12.1–R12.3)", () => {
  test('every dimension shows the viewer and the Friend side by side, labeled, to one decimal', async () => {
    await fc.assert(
      fc.asyncProperty(statsSpecArb, statsSpecArb, async (viewerSpec, friendSpec) => {
        const viewer = buildStats(viewerSpec);
        const friend = buildStats(friendSpec);
        installRoutes(viewer, friend);

        const view = renderScreen();
        try {
          // Switch to the Compare pane and wait for the derived rows.
          fireEvent.press(await view.findByTestId('tab-Compare'));
          await view.findByTestId('friend-comparison-overall');

          // Assert one comparison row shows BOTH parties, each in its own
          // labeled cell, each to one decimal place.
          const assertRow = (
            testID: string,
            viewerPct: number,
            friendPct: number,
          ): void => {
            const viewerCell = within(view.getByTestId(`${testID}-viewer`));
            // Viewer cell is labeled as belonging to the viewer (R12.1–R12.3).
            expect(viewerCell.queryByText(VIEWER_LABEL)).not.toBeNull();
            // ...and shows the viewer's percentage to exactly one decimal.
            expect(
              viewerCell.queryByText(expectedPercent(viewerPct)),
            ).not.toBeNull();

            const friendCell = within(view.getByTestId(`${testID}-friend`));
            // Friend cell is labeled with the Friend's display name.
            expect(friendCell.queryByText(DISPLAY_NAME)).not.toBeNull();
            // ...and shows the Friend's percentage to exactly one decimal.
            expect(
              friendCell.queryByText(expectedPercent(friendPct)),
            ).not.toBeNull();
          };

          // Overall (R12.1).
          assertRow('friend-comparison-overall', viewerSpec.overall, friendSpec.overall);

          // Every Park (R12.2).
          for (const park of PARKS) {
            assertRow(
              `friend-comparison-park-${park}`,
              viewerSpec.byPark[park],
              friendSpec.byPark[park],
            );
          }

          // Every Experience_Category (R12.3).
          for (const category of EXPERIENCE_CATEGORIES) {
            assertRow(
              `friend-comparison-category-${category}`,
              viewerSpec.byCategory[category],
              friendSpec.byCategory[category],
            );
          }
        } finally {
          view.unmount();
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});
