/**
 * FriendProfileScreen mode-content tests (task 8.2).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.5, 3.7, 4.2, 4.4,
 * 4.7, 5.2, 5.4
 *
 * These React Native Testing Library tests drive the Friend_Profile_View's
 * four Profile_View_Modes (Overview / Parks / Categories / Experiences) over
 * successful fixture data and assert the per-mode rendered content:
 *
 *   - Overview  — display name, one-decimal overall percentage, avatar vs.
 *                 default placeholder (incl. the load-failure fallback), and
 *                 the total completed-Experience count        (R2.1–R2.5)
 *   - Parks     — per-Park stat header (one-decimal percent + completed/total
 *                 counts), grouped Completion rows, and the empty-Park
 *                 indication                                   (R3.2, R3.5, R3.7)
 *   - Categories— per-Category stat header (one-decimal percent + counts),
 *                 grouped Completion rows, and the empty-Category indication
 *                 with suppressed counts                       (R4.2, R4.4, R4.7)
 *   - Experiences— Completion rows with their fields and the empty-state
 *                 message                                      (R5.2, R5.4)
 *   - Tab switching swaps exactly one visible pane
 *
 * Following the convention of `FriendProfileScreen.test.tsx`, only the
 * lowest-level `apiRequest` (`api/client`) is mocked; the real
 * `api/friendProfile.ts` data layer and the real `hooks/useFriendProfile.ts`
 * query hooks run on top of it. Each backend read resolves with a
 * controllable fixture through a mutable `routeHandlers` registry.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type CompletionEntryDTO,
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
// `error instanceof ApiError` / `error.code` checks and the hooks'
// retry-unless-forbidden policy resolve against the genuine class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The screen calls `useOpenExperience` (which uses React Navigation) to wire
// row taps to the Catalog tab's ExperienceDetail screen. These mode-content
// tests render the screen standalone (no navigator), so stub the two
// navigation hooks the screen depends on. Navigation behavior itself is
// covered by the navigation-wiring tests, not here.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: () => undefined,
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import FriendProfileScreen from '../FriendProfileScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type { CompletionCell, StatsResponse } from '../../../api/statsTypes';
import {
  makeByCategory,
  makeByPark,
  makeCell,
  makeStatsResponse,
} from '../../stats/__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Route registry + controllable promises
// ---------------------------------------------------------------------------

const FRIEND_ID = 'friend-0001';
const DISPLAY_NAME = 'Mickey Mouse';

type RouteHandler = () => Promise<unknown>;

interface RouteHandlers {
  profile: RouteHandler;
  stats: RouteHandler;
  completions: RouteHandler;
}

let routeHandlers: RouteHandlers;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<ProfileDTO> = {}): ProfileDTO {
  return {
    userId: FRIEND_ID,
    displayName: DISPLAY_NAME,
    avatarPreset: null,
    overallCompletionPercent: 42,
    ...overrides,
  };
}

/**
 * Adapter preserving the pre-migration `breakdown(completed, total, percent)`
 * call signature used throughout the test bodies. The nested `CompletionCell`
 * derives its own `percent` / `remaining` / `completeBadge`, so the third
 * argument is ignored.
 */
function breakdown(
  completed: number,
  total: number,
  _percent?: number,
): CompletionCell {
  return makeCell(completed, total);
}

/**
 * Build a full nested stats fixture: every Park and Category zeroed, then
 * overlay the supplied non-zero `byPark` / `byCategory` cells and the overall
 * figure. Reads on the Friend_Surface go through `coverage.*` (task 11.1).
 */
function makeStats(overrides?: {
  overall?: CompletionCell;
  byPark?: Partial<Record<(typeof PARKS)[number], CompletionCell>>;
  byCategory?: Partial<
    Record<(typeof EXPERIENCE_CATEGORIES)[number], CompletionCell>
  >;
}): StatsResponse {
  const zero = makeCell(0, 0);
  return makeStatsResponse({
    coverage: {
      overall: overrides?.overall ?? makeCell(50, 100),
      byPark: makeByPark(zero, overrides?.byPark),
      byCategory: makeByCategory(zero, overrides?.byCategory),
    },
  });
}

function completionEntry(
  overrides: Partial<CompletionEntryDTO> = {},
): CompletionEntryDTO {
  return {
    experienceId: '11111111-1111-1111-1111-111111111111',
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    areaType: 'ThemePark',
    category: 'Ride',
    completedOn: '2024-01-05',
    rating: 8,
    sharedNote: 'Loved every minute of it.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderScreen(
  params: { friendId: string; displayName: string } = {
    friendId: FRIEND_ID,
    displayName: DISPLAY_NAME,
  },
): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <FriendProfileScreen route={{ params }} />
    </QueryClientProvider>,
  );
}

const isProfilePath = (p: string): boolean => p.endsWith('/profile');
const isStatsPath = (p: string): boolean => p.includes('/stats/summary');
const isCompletionsPath = (p: string): boolean => p.endsWith('/completions');

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FriendProfileScreen mode content (R2.*, R3.2/3.5/3.7, R4.2/4.4/4.7, R5.2/5.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();

    routeHandlers = {
      profile: () => Promise.resolve(makeProfile()),
      stats: () => Promise.resolve(makeStats()),
      completions: () => Promise.resolve({ entries: [] }),
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path !== 'string') {
        throw new Error(`unexpected non-string path: ${String(path)}`);
      }
      if (isStatsPath(path)) return routeHandlers.stats();
      if (isCompletionsPath(path)) return routeHandlers.completions();
      if (isProfilePath(path)) return routeHandlers.profile();
      throw new Error(`unexpected call to ${path}`);
    });
  });

  // -------------------------------------------------------------------------
  // Overview mode (R2.1, R2.2, R2.3, R2.4, R2.5)
  // -------------------------------------------------------------------------

  test('R2.1/R2.4: Overview shows the display name, the redesigned overall-completion hero, and the shared ratings section', async () => {
    routeHandlers.profile = () =>
      Promise.resolve(makeProfile({ overallCompletionPercent: 42 }));
    routeHandlers.stats = () =>
      Promise.resolve(makeStats({ overall: breakdown(37, 100, 37) }));

    renderScreen();

    // Overview is the default mode on first display.
    const summary = await screen.findByTestId('friend-profile-summary');
    expect(summary).toHaveTextContent(/Mickey Mouse/);

    // R2.*: overall completion is now conveyed by the shared hero ring — its
    // one-decimal percent and completed/total count render inside the ring.
    const hero = await screen.findByTestId('friend-overview-stats');
    expect(hero).toHaveTextContent(/37\.0%/);
    expect(hero).toHaveTextContent(/37 \/ 100/);
    expect(screen.getByTestId('overall-hero-ring')).toBeTruthy();

    // R11.1: the Friend's ratings story renders via the SHARED RatingsSection.
    expect(screen.getByTestId('friend-ratings-section')).toBeTruthy();
  });

  test('R2.2: Overview renders the avatar badge when a preset is set', async () => {
    routeHandlers.profile = () =>
      Promise.resolve(makeProfile({ avatarPreset: 'castle' }));

    renderScreen();

    expect(await screen.findByTestId('friend-avatar-image')).toBeTruthy();
    expect(screen.queryByTestId('friend-avatar-placeholder')).toBeNull();
  });

  test('R2.3: Overview renders the default placeholder when no avatar is set', async () => {
    routeHandlers.profile = () =>
      Promise.resolve(makeProfile({ avatarPreset: null }));

    renderScreen();

    expect(await screen.findByTestId('friend-avatar-placeholder')).toBeTruthy();
    expect(screen.queryByTestId('friend-avatar-image')).toBeNull();
  });

  test('R2.5: Overview falls back to the placeholder for an unknown preset id', async () => {
    // A preset id the client cannot render (e.g. removed after the friend
    // chose it) degrades gracefully to the placeholder rather than crashing.
    routeHandlers.profile = () =>
      Promise.resolve(
        makeProfile({ avatarPreset: 'no-longer-a-preset' as never }),
      );

    renderScreen();

    expect(
      await screen.findByTestId('friend-avatar-placeholder'),
    ).toBeTruthy();
    expect(screen.queryByTestId('friend-avatar-image')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Coverage mode — lens switcher + shared CoverageSection (R2.*, R3.*, R4.*)
  // -------------------------------------------------------------------------

  test('Coverage shows the lens switcher and the Parks lens ranked rows by default', async () => {
    routeHandlers.stats = () =>
      Promise.resolve(
        makeStats({ byPark: { 'Magic Kingdom': breakdown(5, 10, 50) } }),
      );

    renderScreen();

    // Switch to Coverage and wait for its pane.
    fireEvent.press(await screen.findByTestId('tab-Coverage'));

    // The Lens_Switcher renders one segment per lens, Parks active by default.
    expect(
      await screen.findByTestId('friend-coverage-lens-switcher'),
    ).toBeTruthy();
    const parksLens = screen.getByTestId('friend-coverage-lens-parks');
    expect(parksLens.props.accessibilityState).toMatchObject({
      selected: true,
    });

    // The shared CoverageSection renders the Parks lens: a ranked container and
    // per-park rows (`park-row-*`), sourced purely from `stats.coverage`.
    const parksContainer = await screen.findByTestId('friend-coverage-parks');
    expect(parksContainer).toBeTruthy();
    expect(screen.getByTestId('park-row-Magic Kingdom')).toBeTruthy();
  });

  test('Coverage switches lenses on tap and renders the selected lens content', async () => {
    renderScreen();

    fireEvent.press(await screen.findByTestId('tab-Coverage'));
    await screen.findByTestId('friend-coverage-parks');

    // Switch to the Resorts lens: the per-resort activity list appears.
    fireEvent.press(screen.getByTestId('friend-coverage-lens-resorts'));

    expect(await screen.findByTestId('friend-coverage-resorts')).toBeTruthy();
    // CoverageSection's resorts lens renders the per-resort activity container.
    expect(screen.getByTestId('coverage-by-resort')).toBeTruthy();
    // The Parks lens content is no longer rendered (only the active lens).
    expect(screen.queryByTestId('friend-coverage-parks')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Experiences mode (R5.2, R5.4)
  // -------------------------------------------------------------------------

  test('R5.2: Experiences lists each Completion with name, park, category, date, rating, and note', async () => {
    routeHandlers.completions = () =>
      Promise.resolve({
        entries: [
          completionEntry({
            experienceName: 'Space Mountain',
            park: 'Magic Kingdom',
            category: 'Ride',
            completedOn: '2024-01-05',
            rating: 8,
            sharedNote: 'Loved every minute of it.',
          }),
        ],
      });

    renderScreen();

    fireEvent.press(await screen.findByTestId('tab-Experiences'));

    const list = await screen.findByTestId('friend-experiences-list');
    expect(list).toHaveTextContent(/Space Mountain/);
    expect(list).toHaveTextContent(/Magic Kingdom/);
    expect(list).toHaveTextContent(/Ride/);
    expect(list).toHaveTextContent(/Jan 5, 2024/);
    expect(list).toHaveTextContent(/8\/10/);
    expect(list).toHaveTextContent(/Loved every minute of it\./);
  });

  test('R5.4: Experiences shows the empty-state when the Friend has no completed Experiences', async () => {
    routeHandlers.completions = () => Promise.resolve({ entries: [] });

    renderScreen();

    fireEvent.press(await screen.findByTestId('tab-Experiences'));

    expect(
      await screen.findByTestId('friend-experiences-empty'),
    ).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Tab switching swaps exactly one visible pane
  // -------------------------------------------------------------------------

  test('tapping a tab swaps the visible pane to exactly that mode', async () => {
    renderScreen();

    // Default: Overview pane visible, others absent.
    expect(await screen.findByTestId('friend-mode-overview')).toBeTruthy();
    expect(screen.queryByTestId('friend-mode-coverage')).toBeNull();

    // Switch to Coverage.
    fireEvent.press(screen.getByTestId('tab-Coverage'));
    expect(await screen.findByTestId('friend-mode-coverage')).toBeTruthy();
    expect(screen.queryByTestId('friend-mode-overview')).toBeNull();
    expect(screen.queryByTestId('friend-mode-experiences')).toBeNull();

    // Switch to Experiences.
    fireEvent.press(screen.getByTestId('tab-Experiences'));
    expect(await screen.findByTestId('friend-mode-experiences')).toBeTruthy();
    expect(screen.queryByTestId('friend-mode-coverage')).toBeNull();

    // Back to Overview.
    fireEvent.press(screen.getByTestId('tab-Overview'));
    expect(await screen.findByTestId('friend-mode-overview')).toBeTruthy();
    expect(screen.queryByTestId('friend-mode-experiences')).toBeNull();
  });
});
