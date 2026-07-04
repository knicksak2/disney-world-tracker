/**
 * StatsScreen (Own_Stats_View) Own_Areas-pane RNTL tests (task 9.5).
 *
 * Validates: Requirements 5.2, 5.3, 5.4, 5.5
 *
 * These React Native Testing Library tests drive the Own_Stats_View into its
 * Own_Areas mode once `GET /me/stats` has loaded and pin the content the
 * `OwnAreasPane` renders:
 *
 *   - **Area_Statistic rendering (R5.2).** One `BreakdownCard` per `AREA_TYPES`
 *     value from `stats.byAreaType` (testID `stats-area-<AreaType>`), each
 *     showing its completed / total counts and one-decimal percentage, in the
 *     canonical `AREA_TYPES` order and with none omitted.
 *   - **Resort_Statistic rendering (R5.2).** The distinct `stats.resort`
 *     Resort_Statistic surfaced as the `stats-resort` card that heads the
 *     collapsible Resorts Group_Section, kept separate from the
 *     `stats-area-Resort` Area_Statistic.
 *   - **Expanding the Resort group (R5.3) + navigation (R5.4).** Expanding the
 *     group reveals the User's visited-resort rows; tapping a row invokes the
 *     Experience-detail navigation with that entry's `experienceId`.
 *   - **Zero Resort_Visits state (R5.5).** When the Own_Completions_Read has no
 *     resort-representing entries, the expanded group shows the
 *     `stats-resort-empty` zero-state rather than omitting the group.
 *
 * Mocking mirrors `StatsScreen.modes.test.tsx`: only the lowest-level
 * `apiRequest` (`api/client`) and the `fetchFriendCompletions` data-layer
 * helper are mocked, so the real `me-stats` query, the real
 * `useOwnCompletionsQuery`, and all of the screen's presentation logic run.
 * `useOpenExperience` is additionally replaced by a module-level spy so the
 * navigation assertion (R5.4) can observe the target passed on a row tap while
 * the real `resolveExperienceTarget` keeps each row activatable.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import {
  AREA_TYPES,
  EXPERIENCE_CATEGORIES,
  PARKS,
  type AreaType,
  type CompletionEntryDTO,
  type ExperienceCategory,
  type Park,
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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('../../../api/friendProfile', () => ({
  __esModule: true,
  fetchFriendCompletions: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: () => undefined,
}));

// Replace `useOpenExperience` with a module-level spy so a resort-row tap can
// be observed directly (R5.4), while keeping the real `resolveExperienceTarget`
// so a row with a present Experience_Id remains an activatable control.
const mockOpenExperience = jest.fn();
jest.mock('../../navigation/experienceNavigation', () => {
  const actual = jest.requireActual('../../navigation/experienceNavigation');
  return {
    __esModule: true,
    ...actual,
    useOpenExperience: () => mockOpenExperience,
  };
});

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
  readonly byCategory: {
    readonly [category in ExperienceCategory]: StatsBreakdown;
  };
  readonly byParkAndCategory: {
    readonly [park in Park]: {
      readonly [category in ExperienceCategory]: StatsBreakdown;
    };
  };
  readonly byAreaType: { readonly [a in AreaType]: StatsBreakdown };
  readonly resort: StatsBreakdown;
}

const OWN_USER_ID = 'own-user-7777';

const ME_RESPONSE = {
  user: { id: OWN_USER_ID, email: 'me@test.local' },
  profile: { displayName: 'Me' },
};

const RESORT_SECTION_HEADER = 'stats-section-resort-header';

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
 * Build a complete `StatsResponse`. Every Park, Category, and Area_Type
 * defaults to a non-zero filler breakdown; `byAreaType` / `resort` (and the
 * other dimensions) overrides let a test pin specific values, including
 * zero-total ones.
 */
function makeStats(overrides: {
  overall?: StatsBreakdown;
  byPark?: Partial<Record<Park, StatsBreakdown>>;
  byCategory?: Partial<Record<ExperienceCategory, StatsBreakdown>>;
  byAreaType?: Partial<Record<AreaType, StatsBreakdown>>;
  resort?: StatsBreakdown;
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

  const byAreaType = Object.fromEntries(
    AREA_TYPES.map((areaType) => [
      areaType,
      overrides.byAreaType?.[areaType] ?? filler,
    ]),
  ) as StatsResponse['byAreaType'];

  return {
    overall: overrides.overall ?? breakdown(2, 10, 20),
    byPark,
    byCategory,
    byParkAndCategory,
    byAreaType,
    resort: overrides.resort ?? breakdown(2, 10, 20),
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

/**
 * A resort-representing Completion entry: no owning Park and `areaType`
 * `'Resort'`, which is how a visited hotel arrives on the client. Used to
 * populate the Resort group's body.
 */
function resortEntry(
  overrides: Partial<CompletionEntryDTO> = {},
): CompletionEntryDTO {
  return {
    experienceId: '22222222-2222-4222-8222-222222222222',
    experienceName: "Disney's Grand Floridian",
    park: null,
    areaType: 'Resort',
    category: 'Resort',
    completedOn: '2024-02-10',
    rating: null,
    sharedNote: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

/**
 * Wire `apiRequest` to resolve `GET /me/stats` with `stats` and `GET /me` with
 * the fixture identity, and `fetchFriendCompletions` with `entries`, render the
 * screen, wait for the loaded content, then switch to the Own_Areas mode.
 */
async function renderAreasPane(
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

  await waitFor(() => {
    expect(screen.getByTestId('stats-screen')).toBeTruthy();
  });
  await waitFor(() => {
    expect(fetchCompletionsMock).toHaveBeenCalledTimes(1);
  });

  fireEvent.press(screen.getByTestId('tab-Own_Areas'));
  expect(screen.getByTestId('own-areas')).toBeTruthy();
}

/**
 * Depth-first walk of the rendered tree collecting, in document order, every
 * `testID` that starts with `prefix`. Used to assert the canonical order of the
 * per-Area_Type stat cards.
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
// Area_Statistic rendering (R5.2)
// ---------------------------------------------------------------------------

describe('StatsScreen — Own_Areas Area_Statistics (R5.2)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
    mockOpenExperience.mockReset();
  });

  test('R5.2: renders one expandable Area_Statistic card per Park-like Area_Type, in order', async () => {
    await renderAreasPane(makeStats());

    // One card per Park-like Area_Type, in canonical order. The Resort
    // Area_Type is merged into the Resorts section, not shown as its own card.
    const parkLike: AreaType[] = ['ThemePark', 'WaterPark', 'DisneySprings'];
    expect(testIDsInOrder('stats-area-')).toEqual(
      parkLike.map((areaType) => `stats-area-${areaType}`),
    );
    expect(screen.queryByTestId('stats-area-Resort')).toBeNull();
  });

  test('R5.2: each Area_Statistic card shows its completed/total counts and one-decimal percent', async () => {
    await renderAreasPane(
      makeStats({ byAreaType: { ThemePark: breakdown(3, 12, 25) } }),
    );

    const card = screen.getByTestId('stats-area-ThemePark');
    expect(card).toHaveTextContent(/25\.0%/);
    expect(card).toHaveTextContent(/3 of 12/);
  });

  test('R5.2: an Area_Type with a zero total renders as 0.0% and 0 of 0', async () => {
    await renderAreasPane(
      makeStats({ byAreaType: { WaterPark: breakdown(4, 0, 0) } }),
    );

    const card = screen.getByTestId('stats-area-WaterPark');
    expect(card).toHaveTextContent(/0\.0%/);
    expect(card).toHaveTextContent(/0 of 0/);
  });
});

// ---------------------------------------------------------------------------
// Resort_Statistic rendering (R5.2), kept distinct from the Resort Area_Statistic
// ---------------------------------------------------------------------------

describe('StatsScreen — Own_Areas Resort_Statistic (R5.2)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
    mockOpenExperience.mockReset();
  });

  test('R5.2: renders the hotels-visited Resort_Statistic from stats.resort as the group header card', async () => {
    await renderAreasPane(
      makeStats({
        resort: breakdown(2, 5, 40),
        byAreaType: { Resort: breakdown(1, 8, 12.5) },
      }),
    );

    // The Resorts section header shows the hotels-visited Resort_Statistic.
    const resortStat = screen.getByTestId('stats-resort');
    expect(resortStat).toHaveTextContent(/40\.0%/);
    expect(resortStat).toHaveTextContent(/2 of 5/);

    // The Resort Area_Type is merged into the Resorts section — there is no
    // separate "Resort Areas" Area_Statistic card.
    expect(screen.queryByTestId('stats-area-Resort')).toBeNull();
  });

  test('R5.2: a zero-total Resort_Statistic renders as 0.0% and 0 of 0', async () => {
    await renderAreasPane(makeStats({ resort: breakdown(3, 0, 0) }));

    const resortStat = screen.getByTestId('stats-resort');
    expect(resortStat).toHaveTextContent(/0\.0%/);
    expect(resortStat).toHaveTextContent(/0 of 0/);
  });
});

// ---------------------------------------------------------------------------
// Resort group: expansion, visited-resort rows, and navigation (R5.3, R5.4)
// ---------------------------------------------------------------------------

describe('StatsScreen — Own_Areas Resort group rows and navigation (R5.3, R5.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
    mockOpenExperience.mockReset();
  });

  test('R5.3: expanding the Resort group reveals the visited-resort rows', async () => {
    await renderAreasPane(makeStats(), [
      resortEntry({ experienceName: "Disney's Grand Floridian" }),
      resortEntry({
        experienceId: '33333333-3333-4333-8333-333333333333',
        experienceName: "Disney's Polynesian Village",
      }),
      // A non-resort entry must not appear in the Resort group.
      completionEntry({ experienceName: 'Space Mountain' }),
    ]);

    // Collapsed on first display: the body (and its rows) is hidden.
    expect(screen.queryByTestId('stats-resort-row-0')).toBeNull();

    fireEvent.press(screen.getByTestId(RESORT_SECTION_HEADER));

    // Expanded: one row per resort-representing entry, in source order.
    const first = screen.getByTestId('stats-resort-row-0');
    expect(first).toHaveTextContent(/Disney's Grand Floridian/);
    const second = screen.getByTestId('stats-resort-row-1');
    expect(second).toHaveTextContent(/Disney's Polynesian Village/);

    // The non-resort entry is not listed here.
    expect(screen.queryByTestId('stats-resort-row-2')).toBeNull();
  });

  test('R5.4: tapping a visited-resort row navigates to that Resort with its experienceId', async () => {
    const grandFloridianId = '22222222-2222-4222-8222-222222222222';
    await renderAreasPane(makeStats(), [
      resortEntry({
        experienceId: grandFloridianId,
        experienceName: "Disney's Grand Floridian",
      }),
    ]);

    fireEvent.press(screen.getByTestId(RESORT_SECTION_HEADER));

    fireEvent.press(screen.getByTestId('stats-resort-row-0'));

    expect(mockOpenExperience).toHaveBeenCalledTimes(1);
    expect(mockOpenExperience).toHaveBeenCalledWith(grandFloridianId);
  });
});

// ---------------------------------------------------------------------------
// Zero Resort_Visits state (R5.5)
// ---------------------------------------------------------------------------

describe('StatsScreen — Own_Areas zero Resort_Visits state (R5.5)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
    mockOpenExperience.mockReset();
  });

  test('R5.5: with no resort-representing entries the group is present and shows the zero-state', async () => {
    // Only a non-resort entry, so the Resort group has no rows.
    await renderAreasPane(makeStats(), [
      completionEntry({ experienceName: 'Space Mountain' }),
    ]);

    // The group is not omitted — its header card is present.
    expect(screen.getByTestId('stats-resort')).toBeTruthy();

    fireEvent.press(screen.getByTestId(RESORT_SECTION_HEADER));

    // The expanded body shows the zero-state, not a row.
    expect(screen.getByTestId('stats-resort-empty')).toBeTruthy();
    expect(screen.queryByTestId('stats-resort-row-0')).toBeNull();
  });

  test('R5.5: with no completions at all the Resort group still shows the zero-state', async () => {
    await renderAreasPane(makeStats(), []);

    expect(screen.getByTestId('stats-resort')).toBeTruthy();

    fireEvent.press(screen.getByTestId(RESORT_SECTION_HEADER));

    expect(screen.getByTestId('stats-resort-empty')).toBeTruthy();
  });
});
