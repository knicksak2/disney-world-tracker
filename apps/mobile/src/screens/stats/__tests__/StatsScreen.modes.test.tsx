/**
 * StatsScreen (Own_Stats_View) mode-content RNTL tests (task 9.2).
 *
 * Validates: Requirements 8.5, 8.9, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3, 11.1,
 * 11.2, 11.3, 13.2, 13.4
 *
 * These React Native Testing Library tests drive the Own_Stats_View through
 * each of its four Own_Stats_View_Modes once `GET /me/stats` has loaded, and
 * pin the per-mode content the screen renders:
 *
 *   - **Own_Overview (R9.1–R9.3)** — the overall Completion_Statistic: the
 *     percentage to exactly one decimal place plus the completed / total
 *     counts, and the zero-total contract (0.0% / 0 of 0).
 *   - **Own_Parks (R10.1–R10.3)** — one Own_Park_Stat per catalog Park in
 *     `PARKS` order, each with its name, one-decimal percent, and counts, and
 *     the zero-total Park contract.
 *   - **Own_Categories (R11.1–R11.3)** — one Own_Category_Stat per
 *     Experience_Category in `EXPERIENCE_CATEGORIES` order, with the same
 *     fields and zero-total contract.
 *   - **Own_Experiences (R13.2, R13.4)** — the shared Experiences list over
 *     the Own_Completions_Read entries, and its empty-state.
 *
 * It also asserts that tapping an Own_Stats_Selector tab swaps the visible
 * pane (R8.5) and that tapping the already-active tab keeps it active (R8.9).
 *
 * Mocking strategy mirrors `screens/friends/__tests__/FriendProfileScreen.test.tsx`
 * and `hooks/__tests__/useOwnCompletions.test.tsx`: only the lowest-level
 * `apiRequest` (`api/client`) and the `fetchFriendCompletions` data-layer
 * helper are mocked, so the real `me-stats` query, the real
 * `useOwnCompletionsQuery`, and all of the screen's presentation logic run.
 * The test `QueryClient` uses `retryDelay: 0` so the completions query's
 * single automatic retry settles without a real-time wait.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type CompletionEntryDTO,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
// ---------------------------------------------------------------------------

// In-memory `expo-secure-store`: the real `api/client` module (kept via
// `requireActual`) imports the secure-store-backed session storage at load
// time, so the platform module must resolve even though `apiRequest` is
// mocked and never reads a token here.
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
// else) so the screen's error checks and the hooks resolve against the
// genuine class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// Mock the friend-profile data layer so the Own_Completions_Read is a
// spyable `jest.fn` whose resolved / rejected value the test controls,
// without exercising the real 30-second-timeout wrapper.
jest.mock('../../../api/friendProfile', () => ({
  __esModule: true,
  fetchFriendCompletions: jest.fn(),
}));

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

import StatsScreen from '../StatsScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { fetchFriendCompletions as mockedFetchCompletions } from '../../../api/friendProfile';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;
const fetchCompletionsMock = mockedFetchCompletions as jest.MockedFunction<
  typeof mockedFetchCompletions
>;

// ---------------------------------------------------------------------------
// Wire shapes (mirrors the screen's inline StatsResponse / StatsBreakdown)
// ---------------------------------------------------------------------------

interface StatsBreakdown {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

interface StatsResponse {
  readonly overall: StatsBreakdown;
  readonly byPark: { readonly [park in Park]: StatsBreakdown };
  readonly byCategory: { readonly [category in ExperienceCategory]: StatsBreakdown };
  readonly byParkAndCategory: {
    readonly [park in Park]: {
      readonly [category in ExperienceCategory]: StatsBreakdown;
    };
  };
}

const OWN_USER_ID = 'own-user-7777';

const ME_RESPONSE = {
  user: { id: OWN_USER_ID, email: 'me@test.local' },
  profile: { displayName: 'Me' },
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function breakdown(
  completed: number,
  total: number,
  percent: number,
): StatsBreakdown {
  return { completed, total, percent };
}

/**
 * Build a complete `StatsResponse`. Every Park and Category defaults to a
 * non-zero filler breakdown; `byPark` / `byCategory` / `overall` overrides
 * let a test pin specific dimensions (including zero-total ones).
 */
function makeStats(overrides: {
  overall?: StatsBreakdown;
  byPark?: Partial<Record<Park, StatsBreakdown>>;
  byCategory?: Partial<Record<ExperienceCategory, StatsBreakdown>>;
} = {}): StatsResponse {
  const filler = breakdown(2, 10, 20);

  const byPark = Object.fromEntries(
    PARKS.map((park) => [park, overrides.byPark?.[park] ?? filler]),
  ) as StatsResponse['byPark'];

  const byCategory = Object.fromEntries(
    EXPERIENCE_CATEGORIES.map((category) => [
      category,
      overrides.byCategory?.[category] ?? filler,
    ]),
  ) as StatsResponse['byCategory'];

  const byParkAndCategory = Object.fromEntries(
    PARKS.map((park) => [park, byCategory]),
  ) as StatsResponse['byParkAndCategory'];

  return {
    overall: overrides.overall ?? breakdown(2, 10, 20),
    byPark,
    byCategory,
    byParkAndCategory,
  };
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

/**
 * Wire `apiRequest` to resolve `GET /me/stats` with `stats` and `GET /me`
 * with the fixture identity, and `fetchFriendCompletions` with `entries`,
 * then render the screen and wait until the loaded content appears.
 */
async function renderScreen(
  stats: StatsResponse,
  entries: readonly CompletionEntryDTO[] = [],
): Promise<void> {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (path === '/me/stats') return stats as unknown;
    if (path === '/me') return ME_RESPONSE as unknown;
    throw new Error(`unexpected apiRequest path: ${String(path)}`);
  });
  fetchCompletionsMock.mockResolvedValue({ entries });

  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={client}>
      <StatsScreen />
    </QueryClientProvider>,
  );

  // Wait for `GET /me/stats` to resolve and the selector/content to mount.
  await waitFor(() => {
    expect(screen.getByTestId('stats-screen')).toBeTruthy();
  });

  // The screen-level Own_Completions_Read settles asynchronously (after `['me']`
  // resolves) regardless of the active mode; wait for it here so its state
  // update is flushed inside `act` rather than racing the synchronous
  // assertions of tests that never open the Own_Experiences pane.
  await waitFor(() => {
    expect(fetchCompletionsMock).toHaveBeenCalledTimes(1);
  });
}

/**
 * Depth-first walk of the rendered tree collecting, in document order, every
 * `testID` that starts with `prefix`. Used to assert catalog/enumerated order
 * of the per-Park and per-Category stat cards.
 */
function testIDsInOrder(prefix: string): string[] {
  const ids: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as { props?: { testID?: unknown }; children?: unknown[] };
    const id = n.props?.testID;
    if (typeof id === 'string' && id.startsWith(prefix)) ids.push(id);
    (n.children ?? []).forEach(visit);
  };
  visit(screen.toJSON());
  return ids;
}

// ---------------------------------------------------------------------------
// Own_Overview (R9.1–R9.3)
// ---------------------------------------------------------------------------

describe('StatsScreen — Own_Overview (R9.1–R9.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('R9.1/R9.2: shows the overall percent to one decimal and the completed/total counts', async () => {
    await renderScreen(makeStats({ overall: breakdown(1, 3, 33.3) }));

    // Own_Overview is the default mode (R8.3).
    expect(screen.getByTestId('own-overview')).toBeTruthy();

    const overall = screen.getByTestId('stats-overall');
    expect(overall).toHaveTextContent(/33\.3%/);
    expect(overall).toHaveTextContent(/1 of 3 experiences/);
  });

  test('R9.1: a whole-number percent still renders with its trailing decimal', async () => {
    await renderScreen(makeStats({ overall: breakdown(5, 10, 50) }));

    expect(screen.getByTestId('stats-overall')).toHaveTextContent(/50\.0%/);
  });

  test('R9.3: a zero-total overall renders as 0.0% and 0 of 0', async () => {
    // Even if the server were to send a non-zero completed count with a zero
    // total, the screen re-asserts the zero-total contract defensively.
    await renderScreen(makeStats({ overall: breakdown(5, 0, 0) }));

    const overall = screen.getByTestId('stats-overall');
    expect(overall).toHaveTextContent(/0\.0%/);
    expect(overall).toHaveTextContent(/0 of 0 experiences/);
  });
});

// ---------------------------------------------------------------------------
// Own_Parks (R10.1–R10.3)
// ---------------------------------------------------------------------------

describe('StatsScreen — Own_Parks (R10.1–R10.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('R10.1: renders exactly one Own_Park_Stat per catalog Park, in PARKS order', async () => {
    await renderScreen(makeStats());

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    expect(screen.getByTestId('own-parks')).toBeTruthy();
    // One card per catalog Park, in catalog order, and nothing extra.
    expect(testIDsInOrder('stats-park-')).toEqual(
      PARKS.map((park) => `stats-park-${park}`),
    );
  });

  test('R10.2: each Own_Park_Stat shows its name, one-decimal percent, and counts', async () => {
    await renderScreen(
      makeStats({ byPark: { 'Magic Kingdom': breakdown(3, 12, 25) } }),
    );

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    const card = screen.getByTestId('stats-park-Magic Kingdom');
    expect(card).toHaveTextContent(/Magic Kingdom/);
    expect(card).toHaveTextContent(/25\.0%/);
    expect(card).toHaveTextContent(/3 of 12/);
  });

  test('R10.3: a Park with a zero total renders as 0.0% and 0 of 0', async () => {
    await renderScreen(
      makeStats({ byPark: { 'Blizzard Beach': breakdown(4, 0, 0) } }),
    );

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    const card = screen.getByTestId('stats-park-Blizzard Beach');
    expect(card).toHaveTextContent(/0\.0%/);
    expect(card).toHaveTextContent(/0 of 0/);
  });
});

// ---------------------------------------------------------------------------
// Own_Categories (R11.1–R11.3)
// ---------------------------------------------------------------------------

describe('StatsScreen — Own_Categories (R11.1–R11.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('R11.1: renders exactly one Own_Category_Stat per category, in EXPERIENCE_CATEGORIES order', async () => {
    await renderScreen(makeStats());

    fireEvent.press(screen.getByTestId('tab-Own_Categories'));

    expect(screen.getByTestId('own-categories')).toBeTruthy();
    expect(testIDsInOrder('stats-category-')).toEqual(
      EXPERIENCE_CATEGORIES.map((category) => `stats-category-${category}`),
    );
  });

  test('R11.2: each Own_Category_Stat shows its label, one-decimal percent, and counts', async () => {
    await renderScreen(
      makeStats({ byCategory: { Ride: breakdown(4, 8, 50) } }),
    );

    fireEvent.press(screen.getByTestId('tab-Own_Categories'));

    const card = screen.getByTestId('stats-category-Ride');
    expect(card).toHaveTextContent(/Ride/);
    expect(card).toHaveTextContent(/50\.0%/);
    expect(card).toHaveTextContent(/4 of 8/);
  });

  test('R11.3: a category with a zero total renders as 0.0% and 0 of 0', async () => {
    await renderScreen(
      makeStats({ byCategory: { Parade: breakdown(7, 0, 0) } }),
    );

    fireEvent.press(screen.getByTestId('tab-Own_Categories'));

    const card = screen.getByTestId('stats-category-Parade');
    expect(card).toHaveTextContent(/0\.0%/);
    expect(card).toHaveTextContent(/0 of 0/);
  });
});

// ---------------------------------------------------------------------------
// Own_Experiences (R13.2, R13.4)
// ---------------------------------------------------------------------------

describe('StatsScreen — Own_Experiences (R13.2, R13.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('R13.2: renders the Own_Completions_Read entries with name, park, category, date, rating, and note', async () => {
    await renderScreen(makeStats(), [
      completionEntry({
        experienceName: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        completedOn: '2024-01-05',
        rating: 8,
        sharedNote: 'Loved every minute of it.',
      }),
    ]);

    fireEvent.press(screen.getByTestId('tab-Own_Experiences'));

    const list = await screen.findByTestId('own-experiences-list');
    expect(list).toHaveTextContent(/Space Mountain/);
    expect(list).toHaveTextContent(/Magic Kingdom/);
    expect(list).toHaveTextContent(/Ride/);
    expect(list).toHaveTextContent(/Jan 5, 2024/);
    expect(list).toHaveTextContent(/8\/10/);
    expect(list).toHaveTextContent(/Loved every minute of it\./);

    expect(screen.getByTestId('own-experience-row-0')).toBeTruthy();
  });

  test('R13.4: shows the empty-state when the Own_Completions_Read returns no entries', async () => {
    await renderScreen(makeStats(), []);

    fireEvent.press(screen.getByTestId('tab-Own_Experiences'));

    expect(await screen.findByTestId('own-experiences-empty')).toBeTruthy();
    expect(screen.queryByTestId('own-experience-row-0')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tab switching (R8.5, R8.9)
// ---------------------------------------------------------------------------

describe('StatsScreen — Own_Stats_Selector tab switching (R8.5, R8.9)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('R8.5: tapping a tab swaps the visible pane and ceases the previous one', async () => {
    await renderScreen(makeStats());

    // Starts on Own_Overview (R8.3).
    expect(screen.getByTestId('own-overview')).toBeTruthy();
    expect(screen.queryByTestId('own-parks')).toBeNull();

    // Switch to Own_Parks: its pane appears, Own_Overview is gone.
    fireEvent.press(screen.getByTestId('tab-Own_Parks'));
    expect(screen.getByTestId('own-parks')).toBeTruthy();
    expect(screen.queryByTestId('own-overview')).toBeNull();

    // Switch to Own_Categories: only it is mounted.
    fireEvent.press(screen.getByTestId('tab-Own_Categories'));
    expect(screen.getByTestId('own-categories')).toBeTruthy();
    expect(screen.queryByTestId('own-parks')).toBeNull();
  });

  test('R8.5: the tapped tab becomes the active (selected) tab', async () => {
    await renderScreen(makeStats());

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    expect(
      screen.getByTestId('tab-Own_Parks').props.accessibilityState?.selected,
    ).toBe(true);
    expect(
      screen.getByTestId('tab-Own_Overview').props.accessibilityState?.selected,
    ).toBe(false);
  });

  test('R8.9: tapping the already-active tab keeps it active and keeps its content', async () => {
    await renderScreen(makeStats());

    // Move to Own_Categories, then tap it again.
    fireEvent.press(screen.getByTestId('tab-Own_Categories'));
    expect(screen.getByTestId('own-categories')).toBeTruthy();

    fireEvent.press(screen.getByTestId('tab-Own_Categories'));

    // Still active, still showing its content.
    expect(
      screen.getByTestId('tab-Own_Categories').props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(screen.getByTestId('own-categories')).toBeTruthy();
  });
});
