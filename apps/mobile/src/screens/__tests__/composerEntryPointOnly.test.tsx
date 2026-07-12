/**
 * Composer-opens-only-from-an-entry-point test (task 6.2).
 *
 * Validates: Requirements 3.2
 *
 * R3.2 requires that the App open the `Share_Composer` ONLY when a Share is
 * initiated from a `Share_Entry_Point`. After task 6.1 removed the top-level
 * Share control from the Friends page and task 3.1 moved the `ShareComposer`
 * route onto the `RootStack` (requiring pre-populated params), this test pins
 * the invariant from both sides:
 *
 *   1. Non-entry-point surface — `FriendsListScreen` exposes only the Inbox
 *      and Find controls (R3.4) and no control on it navigates to
 *      `'ShareComposer'` (R3.1, R3.2). Pressing every affordance on the page
 *      never dispatches a composer navigation.
 *
 *   2. Entry points — the `Experience_Detail_View`'s and the `Progress_Screen`'s
 *      `Share_Entry_Point`s DO navigate to `'ShareComposer'`, and each does so
 *      with pre-populated, kind-discriminated params (R3.3): an `experience`
 *      payload referencing the displayed Experience, and a `progress` payload
 *      carrying the viewer's completion snapshot.
 *
 * Mocking mirrors the sibling screen tests (`friendSelectionNavigation`,
 * `StatsScreen.states`): only the lowest-level `apiRequest` is stubbed while
 * `ApiError` is preserved, and the React Navigation hooks the entry-point
 * screens depend on (`useNavigation`, `useRoute`, `useFocusEffect`) are
 * replaced so a `navigate('ShareComposer', params)` dispatch is captured
 * without mounting a real navigator. `FriendsListScreen` takes its navigation
 * object as a prop, so it is exercised with an explicit stub.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

// Replace only `apiRequest`; keep the real `ApiError` (and everything else)
// so the screens' `instanceof ApiError` branches resolve against the genuine
// class.
jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// The entry-point screens (ExperienceDetailScreen, StatsScreen) reach React
// Navigation through hooks. Replace the three hooks they use with stubs so the
// `navigate('ShareComposer', params)` dispatch is captured without a real
// navigator. FriendsListScreen does not use these hooks (it takes `navigation`
// as a prop), so this mock does not affect it.
// Prefixed with `mock` so Jest permits referencing them from the mock factory.
const mockNavigate = jest.fn();
let mockRouteParams: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: mockRouteParams }),
  // The entry points arm a focus-reset for their in-flight guard; a no-op is
  // sufficient here since each test performs a single press.
  useFocusEffect: () => undefined,
}));

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import FriendsListScreen from '../friends/FriendsListScreen';
import ExperienceDetailScreen from '../catalog/ExperienceDetailScreen';
import StatsScreen from '../stats/StatsScreen';
import { apiRequest as mockedApiRequest } from '../../api/client';
import { makeStatsResponse } from '../stats/__testSupport__/statsFixture';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRIEND = {
  userId: 'friend-123',
  displayName: 'Minnie Mouse',
  avatarPreset: null,
  establishedAt: '2024-01-02T00:00:00Z',
} as const;

const FRIENDS_RESPONSE = {
  friends: [FRIEND],
  incomingRequests: [],
  outgoingRequests: [],
} as const;

const EXPERIENCE = {
  id: 'exp-777',
  name: 'Space Mountain',
  park: 'Magic Kingdom',
  // 'Other' has no live operational section (see `catalog/gating.ts`), so the
  // detail view renders without needing a live-details fixture.
  category: 'Other',
  description: 'A classic attraction.',
  imageUrl: null,
  areaType: 'ThemePark',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderWithClient(element: React.ReactElement): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      {element}
    </QueryClientProvider>,
  );
}

/** How many times `navigate` was dispatched to the `ShareComposer` route. */
function composerNavigations(mock: jest.Mock): unknown[][] {
  return mock.mock.calls.filter((call) => call[0] === 'ShareComposer');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Share_Composer opens only from a Share_Entry_Point (R3.2)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    mockNavigate.mockReset();
    mockRouteParams = {};
  });

  // -------------------------------------------------------------------------
  // Non-entry-point surface: the Friends page never opens the composer.
  // -------------------------------------------------------------------------
  test('FriendsListScreen exposes only Inbox + Find and no control navigates to ShareComposer', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') {
        return FRIENDS_RESPONSE;
      }
      // The Friends page reads the unread-inbox tally to badge the Inbox
      // control; answer it benignly (no unread) so the mock stays quiet.
      if (path === '/me/inbox/unread-count') {
        return { count: 0 };
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });

    const friendsNavigate = jest.fn();
    renderWithClient(
      <FriendsListScreen
        // The screen only reads `navigation`; `route` is unused.
        navigation={{ navigate: friendsNavigate } as never}
        route={{} as never}
      />,
    );

    // The friends list resolves asynchronously.
    const friendRow = await screen.findByTestId(`friends-friend-${FRIEND.userId}`);

    // R3.4: the page exposes the Inbox and Find controls...
    const inbox = screen.getByTestId('friends-inbox');
    const find = screen.getByTestId('friends-find');

    // ...and no Share_Entry_Point control (R3.1). Neither entry-point testID
    // from the content screens appears on the Friends page.
    expect(screen.queryByTestId('experience-share-button')).toBeNull();
    expect(screen.queryByTestId('stats-share-button')).toBeNull();

    // Exercise every affordance on the page.
    fireEvent.press(inbox);
    fireEvent.press(find);
    fireEvent.press(friendRow);

    // The Inbox control routes to the Inbox (R3.5) and Find to search; no
    // control on the page ever opens the Share_Composer (R3.2).
    expect(friendsNavigate).toHaveBeenCalledWith('Inbox');
    expect(friendsNavigate).toHaveBeenCalledWith('FriendsSearch');
    expect(composerNavigations(friendsNavigate)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Entry point 1: the Experience_Detail_View opens the composer with an
  // `experience` payload referencing the displayed Experience.
  // -------------------------------------------------------------------------
  test('ExperienceDetailScreen entry point navigates to ShareComposer with pre-populated experience params', async () => {
    mockRouteParams = { experienceId: EXPERIENCE.id };

    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/catalog/${EXPERIENCE.id}`) return EXPERIENCE;
      if (path === `/me/experiences/${EXPERIENCE.id}/completion`) return null;
      if (path === `/me/experiences/${EXPERIENCE.id}/rating`) return null;
      if (path === `/me/experiences/${EXPERIENCE.id}/note`) return null;
      if (path === `/experiences/${EXPERIENCE.id}/aggregate-rating`) {
        return { value: null, count: 0 };
      }
      if (path === `/catalog/${EXPERIENCE.id}/live`) return null;
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderWithClient(<ExperienceDetailScreen />);

    // The entry point becomes enabled once the detail + own rating/note reads
    // have all settled (R1.2). Re-query on each poll so the assertion sees the
    // latest render rather than a stale node.
    await waitFor(() => {
      const button = screen.getByTestId('experience-share-button');
      expect(button.props.accessibilityState?.disabled).not.toBe(true);
    });

    fireEvent.press(screen.getByTestId('experience-share-button'));

    // The composer opens (R3.2/R3.3) with an `experience` payload referencing
    // the displayed Experience.
    expect(mockNavigate).toHaveBeenCalledWith(
      'ShareComposer',
      expect.objectContaining({
        kind: 'experience',
        experienceId: EXPERIENCE.id,
        experienceName: EXPERIENCE.name,
        park: EXPERIENCE.park,
        category: EXPERIENCE.category,
      }),
    );
    expect(composerNavigations(mockNavigate)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Entry point 2: the Progress_Screen opens the composer with a `progress`
  // payload carrying the viewer's completion snapshot.
  // -------------------------------------------------------------------------
  test('StatsScreen entry point navigates to ShareComposer with pre-populated progress params', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/stats?percentile=true') return makeStatsResponse();
      if (path === '/me') {
        return {
          user: { id: 'own-user', email: 'me@test.local' },
          profile: { displayName: 'Me' },
        };
      }
      if (typeof path === 'string' && path.endsWith('/completions')) {
        return { entries: [] };
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });

    renderWithClient(<StatsScreen />);

    // The share control is enabled once `GET /me/stats` has data (R1.7).
    await screen.findByTestId('stats-screen');
    await waitFor(() => {
      const button = screen.getByTestId('stats-share-button');
      expect(button.props.accessibilityState?.disabled).not.toBe(true);
    });

    fireEvent.press(screen.getByTestId('stats-share-button'));

    // The composer opens (R3.2/R3.3) with a `progress` payload carrying the
    // viewer's completion snapshot.
    expect(mockNavigate).toHaveBeenCalledWith(
      'ShareComposer',
      expect.objectContaining({
        kind: 'progress',
        overallPercent: expect.any(Number),
        perParkPercent: expect.any(Object),
        perCategoryPercent: expect.any(Object),
      }),
    );
    expect(composerNavigations(mockNavigate)).toHaveLength(1);
  });
});
