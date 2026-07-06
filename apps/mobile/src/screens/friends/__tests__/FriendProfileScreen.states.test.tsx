/**
 * FriendProfileScreen loading / forbidden / error / retry tests (task 8.3).
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 *
 * These React Native Testing Library tests drive the refactored,
 * tabbed Friend_Profile_View through its per-mode, per-request state
 * machine. They exercise the REAL data layer (`api/friendProfile.ts`,
 * including its 30-second `AbortController` timeout) and the REAL query
 * hooks (`hooks/useFriendProfile.ts`, including the
 * retry-unless-forbidden policy); only the lowest-level `apiRequest`
 * (`api/client`) is mocked, matching the convention established by the
 * sibling `FriendProfileScreen.test.tsx` suite.
 *
 * Each test supplies a controllable promise per backend read through a
 * mutable `routeHandlers` registry, so a request can be held pending
 * (loading), resolved (success), or rejected (error / `profile_forbidden`)
 * independently of the others. The test `QueryClient` sets
 * `retry: false` / `retryDelay: 0` so any automatic retry settles
 * without a real-time wait; the dedicated 30-second-timeout test installs
 * Jest fake timers and advances them to fire the data layer's
 * `AbortController`.
 *
 * Because the screen now scopes loading / error / retry to the active
 * mode's pane, the tests navigate between tabs (`tab-selector`) to
 * surface each per-read state in the pane that displays that read:
 *
 *   - Overview pane  → Profile read (`friend-profile-*`) + Stats read's
 *     hero/ratings block (`friend-stats-*`).
 *   - Coverage pane  → Stats read (`friend-stats-*`).
 *   - Experiences    → Completions read (`friend-completions-*`).
 *
 * Coverage map:
 *   - In-pane loading indicators for each in-flight read       (R7.1)
 *   - `profile_forbidden` → unavailable message, View_Selector
 *     and all four modes withheld                              (R7.2)
 *   - Non-`profile_forbidden` error → in-pane error + retry
 *     control, scoped to the failed read                       (R7.3)
 *   - 30-second timeout surfaces as a retryable, non-forbidden
 *     error                                                    (R7.4)
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { type ProfileDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store`. `apiRequest` is mocked so the session
// token is never actually read, but the real `api/client` module (kept via
// `requireActual`) imports the secure-store-backed session storage at load
// time, so the platform module must resolve.
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

// `expo-constants` supplies the API base URL. Never read at runtime here
// (the network call is mocked) but provided so any defensive codepath in
// the real client module does not throw on import.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Replace only `apiRequest`; preserve the real `ApiError` (and everything
// else) so the screen's `error instanceof ApiError` / `error.code` checks
// and the hooks' retry-unless-forbidden policy resolve against the genuine
// class. The real `api/friendProfile.ts` timeout wrapper and the real
// query hooks run on top of this mock.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The screen calls `useOpenExperience` (which uses React Navigation) to wire
// row taps to the Catalog tab's ExperienceDetail screen. These loading/error
// state tests render the screen standalone (no navigator), so stub the two
// navigation hooks the screen depends on.
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn() }),
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
const DISPLAY_NAME = 'Mickey Mouse';

/** A backend read's behavior for one test: receives the request's abort
 *  signal (used by the timeout test) and returns the promise the screen
 *  will observe. */
type RouteHandler = (signal?: AbortSignal) => Promise<unknown>;

interface RouteHandlers {
  profile: RouteHandler;
  stats: RouteHandler;
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
    avatarPreset: null,
    overallCompletionPercent: 42,
    ...overrides,
  };
}

function makeStats(): StatsResponse {
  return makeStatsResponse();
}

function forbidden(): ApiError {
  return new ApiError({
    code: 'profile_forbidden',
    message: 'This profile is not available.',
    status: 403,
  });
}

function transientError(): ApiError {
  return new ApiError({
    code: 'internal_error',
    message: 'Something went wrong.',
    status: 500,
  });
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
  // `retry: false` is the documented intent (errors surface promptly);
  // the hooks override it with `retryUnlessForbidden`, so `retryDelay: 0`
  // is what actually keeps any retry from introducing a real-time wait.
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

/** Count `apiRequest` calls whose path satisfies `pred`. */
function callsMatching(pred: (path: string) => boolean): number {
  return apiRequestMock.mock.calls.filter(
    (call) => typeof call[1] === 'string' && pred(call[1] as string),
  ).length;
}

const isProfilePath = (p: string): boolean => p.endsWith('/profile');
const isStatsPath = (p: string): boolean => p.includes('/stats/summary');
const isCompletionsPath = (p: string): boolean => p.endsWith('/completions');

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FriendProfileScreen loading/forbidden/error/retry (R7.1–R7.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();

    // Default: every read resolves with a sensible fixture; individual
    // tests override only the read they care about.
    routeHandlers = {
      profile: () => Promise.resolve(makeProfile()),
      stats: () => Promise.resolve(makeStats()),
      completions: () => Promise.resolve({ entries: [] }),
    };

    apiRequestMock.mockImplementation(
      async (_method, path, _body, signal) => {
        if (typeof path !== 'string') {
          throw new Error(`unexpected non-string path: ${String(path)}`);
        }
        if (isStatsPath(path)) return routeHandlers.stats(signal);
        if (isCompletionsPath(path)) return routeHandlers.completions(signal);
        if (isProfilePath(path)) return routeHandlers.profile(signal);
        throw new Error(`unexpected call to ${path}`);
      },
    );
  });

  // -------------------------------------------------------------------------
  // R7.1 — in-pane loading indicators for each in-flight read
  // -------------------------------------------------------------------------
  test('R7.1: shows an in-pane loading indicator for each in-flight read in the mode that displays it', async () => {
    routeHandlers = {
      profile: pendingForever,
      stats: pendingForever,
      completions: pendingForever,
    };

    renderScreen();

    // Overview is the default mode (R1.3): the Profile read drives the profile
    // card's loader, and the Stats read drives the hero/ratings block's loader
    // — both in-flight reads the Overview pane displays show a loader (R7.1).
    expect(await screen.findByTestId('friend-profile-loading')).toBeTruthy();
    expect(await screen.findByTestId('friend-stats-loading')).toBeTruthy();

    // Switch to the Experiences pane: the Completions read it displays is in
    // flight, so its in-pane loader shows (R7.1).
    fireEvent.press(screen.getByTestId('tab-Experiences'));
    expect(
      await screen.findByTestId('friend-completions-loading'),
    ).toBeTruthy();

    // The View_Selector remains mounted throughout the loading state.
    expect(screen.getByTestId('tab-selector')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // R7.2 — profile_forbidden withholds the View_Selector and all modes
  // -------------------------------------------------------------------------
  test('R7.2: a profile_forbidden error shows the unavailable message and withholds the selector and every mode', async () => {
    routeHandlers = {
      profile: () => Promise.reject(forbidden()),
      stats: () => Promise.reject(forbidden()),
      completions: () => Promise.reject(forbidden()),
    };

    renderScreen();

    expect(
      await screen.findByTestId('friend-profile-unavailable'),
    ).toBeTruthy();

    // The View_Selector and all four mode panes are withheld entirely.
    expect(screen.queryByTestId('tab-selector')).toBeNull();
    expect(screen.queryByTestId('friend-mode-overview')).toBeNull();
    expect(screen.queryByTestId('friend-mode-coverage')).toBeNull();
    expect(screen.queryByTestId('friend-mode-experiences')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R7.2 — a forbidden on ANY single read collapses the whole view
  // -------------------------------------------------------------------------
  test('R7.2: a profile_forbidden on any one read (here Completions) collapses the whole view', async () => {
    routeHandlers.profile = () => Promise.resolve(makeProfile());
    routeHandlers.stats = () => Promise.resolve(makeStats());
    routeHandlers.completions = () => Promise.reject(forbidden());

    renderScreen();

    expect(
      await screen.findByTestId('friend-profile-unavailable'),
    ).toBeTruthy();
    expect(screen.queryByTestId('tab-selector')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R7.3 — non-forbidden error → in-pane error + retry, scoped per read
  // -------------------------------------------------------------------------
  test('R7.3: a non-forbidden Profile error shows an in-pane error and retry control in the Overview pane', async () => {
    routeHandlers.profile = () => Promise.reject(transientError());
    routeHandlers.stats = () => Promise.resolve(makeStats());
    routeHandlers.completions = () => Promise.resolve({ entries: [] });

    renderScreen();

    expect(await screen.findByTestId('friend-profile-error')).toBeTruthy();
    expect(screen.getByTestId('friend-profile-error-retry')).toBeTruthy();
    // A non-forbidden error must NOT trip the screen-wide unavailable state,
    // and the selector stays usable (R7.6 boundary; here we assert the
    // R7.3 non-forbidden branch keeps the selector mounted).
    expect(screen.queryByTestId('friend-profile-unavailable')).toBeNull();
    expect(screen.getByTestId('tab-selector')).toBeTruthy();
  });

  test('R7.3: non-forbidden Stats and Completions errors show in-pane errors and retry controls, each scoped to the pane that displays the read', async () => {
    routeHandlers.profile = () => Promise.resolve(makeProfile());
    routeHandlers.stats = () => Promise.reject(transientError());
    routeHandlers.completions = () => Promise.reject(transientError());

    renderScreen();

    // The Coverage pane displays the Stats read; its failed read renders a
    // scoped error + retry (R7.3).
    fireEvent.press(await screen.findByTestId('tab-Coverage'));
    expect(await screen.findByTestId('friend-stats-error')).toBeTruthy();
    expect(screen.getByTestId('friend-stats-error-retry')).toBeTruthy();

    // The Experiences pane displays the Completions read; its failed read
    // renders its own scoped error + retry (R7.3).
    fireEvent.press(screen.getByTestId('tab-Experiences'));
    expect(await screen.findByTestId('friend-completions-error')).toBeTruthy();
    expect(screen.getByTestId('friend-completions-error-retry')).toBeTruthy();
    expect(screen.queryByTestId('friend-profile-unavailable')).toBeNull();
  });

  test('R7.3: tapping an in-pane retry re-issues only the failed read', async () => {
    routeHandlers.profile = () => Promise.resolve(makeProfile());
    routeHandlers.stats = () => Promise.resolve(makeStats());
    routeHandlers.completions = () => Promise.reject(transientError());

    renderScreen();

    // Surface the Completions error in the Experiences pane.
    fireEvent.press(await screen.findByTestId('tab-Experiences'));
    const retry = await screen.findByTestId('friend-completions-error-retry');

    await waitFor(() => {
      expect(callsMatching(isProfilePath)).toBe(1);
      expect(callsMatching(isStatsPath)).toBe(1);
    });
    const completionsCallsBeforeRetry = callsMatching(isCompletionsPath);
    expect(completionsCallsBeforeRetry).toBeGreaterThanOrEqual(1);

    // The re-issued Completions read now succeeds.
    routeHandlers.completions = () =>
      Promise.resolve({
        entries: [
          {
            experienceName: 'Space Mountain',
            park: 'Magic Kingdom',
            category: 'Ride',
            completedOn: '2024-01-05',
            rating: 8,
            sharedNote: 'Loved it.',
          },
        ],
      });

    fireEvent.press(retry);

    // The Experiences list renders once the retried read resolves.
    expect(await screen.findByTestId('friend-experiences-list')).toBeTruthy();

    // Only the Completions read was re-fetched; Profile/Stats counts are
    // unchanged (the retry is scoped to the failed read).
    expect(callsMatching(isProfilePath)).toBe(1);
    expect(callsMatching(isStatsPath)).toBe(1);
    expect(callsMatching(isCompletionsPath)).toBeGreaterThan(
      completionsCallsBeforeRetry,
    );
  });

  // -------------------------------------------------------------------------
  // R7.4 — 30-second timeout surfaces as a non-forbidden, retryable error
  // -------------------------------------------------------------------------
  test('R7.4: a read that stalls for 30 seconds becomes a non-forbidden, retryable in-pane error', async () => {
    jest.useFakeTimers();
    try {
      // The Profile read never responds, but honors the AbortController
      // armed by `api/friendProfile.ts`: when the 30s timer fires, the
      // controller aborts and this promise rejects, flowing through the
      // data layer's synthetic non-`profile_forbidden` timeout error.
      routeHandlers.profile = (signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        });
      routeHandlers.stats = () => Promise.resolve(makeStats());
      routeHandlers.completions = () => Promise.resolve({ entries: [] });

      renderScreen();

      // Loading while the request is in flight (R7.1), in the Overview pane.
      expect(screen.getByTestId('friend-profile-loading')).toBeTruthy();

      // Advance past the 30s deadline (plus any zero-delay retry cycles)
      // until the error surfaces.
      for (
        let i = 0;
        i < 5 && screen.queryByTestId('friend-profile-error') === null;
        i += 1
      ) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          jest.advanceTimersByTime(30_000);
        });
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          jest.advanceTimersByTime(1_000);
        });
      }

      expect(screen.getByTestId('friend-profile-error')).toBeTruthy();
      expect(screen.getByTestId('friend-profile-error-retry')).toBeTruthy();
      // A timeout is a normal error, not the unavailable (forbidden) state.
      expect(screen.queryByTestId('friend-profile-unavailable')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
