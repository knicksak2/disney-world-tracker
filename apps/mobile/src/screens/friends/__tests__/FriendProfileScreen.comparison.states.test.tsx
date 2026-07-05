/**
 * FriendProfileScreen Progress_Comparison loading / unavailable edge-case
 * tests (task 24.3).
 *
 * Validates: Requirements 12.5, 12.6
 *
 * These React Native Testing Library tests drive the Compare pane
 * (`ComparisonMode`) of the Friend_Profile_View through the two timing
 * windows R12.5 / R12.6 define:
 *
 *   - R12.5 — WHILE the comparison data is loading and fewer than 30 seconds
 *     have elapsed, the pane shows a loading indication
 *     (`friend-comparison-loading`).
 *   - R12.6 — IF either party's stats fail to load, OR they have not loaded
 *     within 30 seconds, the pane shows a comparison-unavailable message
 *     (`friend-comparison-unavailable`) while the rest of the profile (the
 *     View_Selector and the other panes) stays reachable.
 *
 * The Compare pane pairs the viewer's own stats (`useOwnStatsQuery` →
 * `GET /me/stats`) with the Friend's (`useFriendStatsQuery` →
 * `GET /me/stats/summary?for=…`). To isolate the ComparisonMode's own 30-second
 * window from the friend-read's data-layer AbortController timeout, these tests
 * hold only the viewer's `GET /me/stats` read pending (it has no timeout
 * wrapper, so it stays pending under fake timers) while the Friend's stats read
 * resolves. That leaves the ComparisonMode `setTimeout` as the single armed
 * timer, so advancing fake time drives exactly the R12.5 → R12.6 transition.
 *
 * Following the sibling suites' convention, only the lowest-level `apiRequest`
 * (`api/client`) is mocked; the real `api/friendProfile.ts` data layer and the
 * real query hooks run on top of it. Each backend read resolves (or stays
 * pending, or rejects) through a mutable `routeHandlers` registry.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { type ProfileDTO } from '@dwt/shared';

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

// The screen calls `useOpenExperience` (which uses React Navigation). These
// edge-case tests render the screen standalone (no navigator), so stub the two
// navigation hooks the screen depends on.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: () => undefined,
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import FriendProfileScreen from '../FriendProfileScreen';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { StatsResponse } from '../../../api/statsTypes';
import { makeStatsResponse } from '../../stats/__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Route registry + controllable promises
// ---------------------------------------------------------------------------

const FRIEND_ID = 'friend-0001';
const OWN_ID = 'me-0001';
const DISPLAY_NAME = 'Mickey Mouse';

type RouteHandler = () => Promise<unknown>;

interface RouteHandlers {
  me: RouteHandler;
  profile: RouteHandler;
  friendStats: RouteHandler;
  ownStats: RouteHandler;
  completions: RouteHandler;
}

let routeHandlers: RouteHandlers;

/** A promise that never settles — keeps a request in its loading state. */
const pendingForever: RouteHandler = () => new Promise<never>(() => undefined);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<ProfileDTO> = {}): ProfileDTO {
  return {
    userId: FRIEND_ID,
    displayName: DISPLAY_NAME,
    avatarUrl: null,
    overallCompletionPercent: 42,
    ...overrides,
  };
}

function makeStats(): StatsResponse {
  return makeStatsResponse();
}

function meResponse(): unknown {
  return {
    user: { id: OWN_ID, email: 'me@test.local' },
    profile: { displayName: 'Me' },
  };
}

function transientError(): ApiError {
  return new ApiError({
    code: 'internal_error',
    message: 'Something went wrong.',
    status: 500,
  });
}

// ---------------------------------------------------------------------------
// Render helper + path routing
// ---------------------------------------------------------------------------

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

const isFriendStatsPath = (p: string): boolean => p.includes('/stats/summary');
const isOwnStatsPath = (p: string): boolean => p === '/me/stats';
const isCompletionsPath = (p: string): boolean => p.endsWith('/completions');
const isProfilePath = (p: string): boolean => p.endsWith('/profile');
const isMePath = (p: string): boolean => p === '/me';

/** Flush all pending microtasks (settled promises) inside `act`. */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Advance fake time by `ms` and flush any promises that unblock as a result. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flushMicrotasks();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FriendProfileScreen Progress_Comparison loading/unavailable (R12.5, R12.6)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    apiRequestMock.mockReset();

    // Default: profile / friend-stats / completions / me all resolve; the
    // viewer's own-stats read stays pending so the Compare pane sits in its
    // loading window. Individual tests override only what they need.
    routeHandlers = {
      me: () => Promise.resolve(meResponse()),
      profile: () => Promise.resolve(makeProfile()),
      friendStats: () => Promise.resolve(makeStats()),
      ownStats: pendingForever,
      completions: () => Promise.resolve({ entries: [] }),
    };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path !== 'string') {
        throw new Error(`unexpected non-string path: ${String(path)}`);
      }
      // Order matters: `/me/stats` and `/me/stats/summary` are both prefixed
      // by `/me`, so match the more specific stats paths before `/me`.
      if (isFriendStatsPath(path)) return routeHandlers.friendStats();
      if (isOwnStatsPath(path)) return routeHandlers.ownStats();
      if (isCompletionsPath(path)) return routeHandlers.completions();
      if (isProfilePath(path)) return routeHandlers.profile();
      if (isMePath(path)) return routeHandlers.me();
      throw new Error(`unexpected call to ${path}`);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // R12.5 — loading indication while under the 30-second window
  // -------------------------------------------------------------------------
  test('R12.5: shows the comparison loading indication while data is outstanding and under 30 s', async () => {
    // Friend stats ready, viewer stats pending → the pane is loading.
    renderScreen();
    await flushMicrotasks();

    fireEvent.press(screen.getByTestId('tab-Compare'));
    await flushMicrotasks();

    // Under the 30 s window: loading, not unavailable (R12.5).
    expect(screen.getByTestId('friend-comparison-loading')).toBeTruthy();
    expect(screen.queryByTestId('friend-comparison-unavailable')).toBeNull();

    // Advance to just before the deadline: still loading.
    await advance(29_000);
    expect(screen.getByTestId('friend-comparison-loading')).toBeTruthy();
    expect(screen.queryByTestId('friend-comparison-unavailable')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R12.6 — >30 s without both parties' stats surfaces the unavailable message
  // -------------------------------------------------------------------------
  test('R12.6: after 30 s without both parties loaded, shows the unavailable message and keeps the rest of the profile reachable', async () => {
    renderScreen();
    await flushMicrotasks();

    fireEvent.press(screen.getByTestId('tab-Compare'));
    await flushMicrotasks();
    expect(screen.getByTestId('friend-comparison-loading')).toBeTruthy();

    // Cross the 30 s deadline: the ComparisonMode timer fires (R12.6).
    await advance(30_000);

    expect(screen.getByTestId('friend-comparison-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('friend-comparison-loading')).toBeNull();

    // R12.6: remaining profile content stays reachable — the View_Selector is
    // still mounted and other panes still render.
    expect(screen.getByTestId('tab-selector')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tab-Overview'));
    await flushMicrotasks();
    expect(screen.getByTestId('friend-mode-overview')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R12.6 — the viewer's own stats read failing surfaces the unavailable state
  // -------------------------------------------------------------------------
  test('R12.6: a failed viewer own-stats read shows the unavailable message without waiting for the timeout', async () => {
    routeHandlers.ownStats = () => Promise.reject(transientError());
    routeHandlers.friendStats = () => Promise.resolve(makeStats());

    renderScreen();
    await flushMicrotasks();

    fireEvent.press(screen.getByTestId('tab-Compare'));
    // The failure branch does not depend on the 30 s timer; just flush the
    // rejected read.
    await flushMicrotasks();

    expect(screen.getByTestId('friend-comparison-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('friend-comparison-loading')).toBeNull();

    // Remaining profile content still reachable (R12.6).
    expect(screen.getByTestId('tab-selector')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R12.6 — the Friend's stats read failing surfaces the unavailable state
  // -------------------------------------------------------------------------
  test('R12.6: a failed Friend stats read shows the unavailable message while the rest of the profile stays available', async () => {
    routeHandlers.ownStats = () => Promise.resolve(makeStats());
    routeHandlers.friendStats = () => Promise.reject(transientError());

    renderScreen();
    await flushMicrotasks();

    fireEvent.press(screen.getByTestId('tab-Compare'));

    // The friend stats hook retries once (retryUnlessForbidden) with a zero
    // delay; advance fake time in small steps until the failure settles.
    for (
      let i = 0;
      i < 5 &&
      screen.queryByTestId('friend-comparison-unavailable') === null;
      i += 1
    ) {
      // eslint-disable-next-line no-await-in-loop
      await advance(1_000);
    }

    expect(screen.getByTestId('friend-comparison-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('friend-comparison-loading')).toBeNull();
    expect(screen.getByTestId('tab-selector')).toBeTruthy();
  });
});
