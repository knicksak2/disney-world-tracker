/**
 * StatsScreen (Own_Stats_View) collapsible Group_Section example/integration
 * tests (task 9.5).
 *
 * Validates: Requirements 7.4, 7.5, 8.2, 9.2, 10.1, 10.2, 10.3, 11.4, 12.1,
 * 12.4
 *
 * These React Native Testing Library tests drive the Own_Parks and
 * Own_Categories Grouped_View_Modes through their collapsible Group_Sections
 * and pin the collapse/expand behavior the screen wires up via `GroupSection`
 * + `useGroupSections`:
 *
 *   - **First display (R8.2, R7.5).** Every Park / Experience_Category renders
 *     a Group_Header (none omitted), and every Group_Body is hidden because
 *     each section starts Collapsed.
 *   - **Toggling (R7.4, R7.5, R12.4).** Tapping a Group_Header reveals its
 *     Group_Body; tapping it again hides it. Assistive activation routes
 *     through the same press path.
 *   - **Header content/state (R9.2, R12.1).** The header figures match the
 *     stats breakdown and are identical across Collapsed/Expanded; the header
 *     is exposed as an expandable control whose announced expanded state
 *     reflects the section.
 *   - **Isolation + retention (R10.1, R10.2, R10.3).** Toggling one section
 *     leaves the others unchanged; the state survives a mode switch within the
 *     Screen_Session; presenting the screen anew resets every section to
 *     Collapsed.
 *   - **Compact_Empty_State (R11.4).** An empty group's body indication is a
 *     plain, non-activatable element with no navigation affordance.
 *
 * Mocking mirrors `StatsScreen.modes.test.tsx`: only `apiRequest`
 * (`api/client`) and `fetchFriendCompletions` (`api/friendProfile`) are
 * mocked, and the two navigation hooks the screen depends on via
 * `useOpenExperience` are stubbed since these tests render the screen
 * standalone (no navigator).
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

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
// Wire shapes
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

async function renderScreen(
  stats: StatsResponse,
  entries: readonly CompletionEntryDTO[] = [],
): Promise<ReturnType<typeof render>> {
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

  const result = render(
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

  return result;
}

// ---------------------------------------------------------------------------
// First display: every header visible, every body hidden (R8.2, R7.5)
// ---------------------------------------------------------------------------

describe('StatsScreen Group_Sections — first display (R8.2, R7.5)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('R8.2: Own_Parks shows a Group_Header for every Park with all bodies hidden', async () => {
    await renderScreen(makeStats(), [completionEntry()]);

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    // Every Park's header is rendered (none omitted) ...
    for (const park of PARKS) {
      expect(screen.getByTestId(`stats-park-${park}`)).toBeTruthy();
      // ... and every Group_Body is hidden on first display (all Collapsed).
      expect(
        screen.queryByTestId(`stats-section-park-${park}-body`),
      ).toBeNull();
    }
  });

  test('R8.2: Own_Categories shows a Group_Header for every Category with all bodies hidden', async () => {
    await renderScreen(makeStats(), [completionEntry()]);

    fireEvent.press(screen.getByTestId('tab-Own_Categories'));

    for (const category of EXPERIENCE_CATEGORIES) {
      expect(screen.getByTestId(`stats-category-${category}`)).toBeTruthy();
      expect(
        screen.queryByTestId(`stats-section-category-${category}-body`),
      ).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Toggling reveals / hides the body (R7.4, R7.5, R12.4)
// ---------------------------------------------------------------------------

describe('StatsScreen Group_Sections — toggling (R7.4, R7.5, R12.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('R7.5/R7.4: tapping a header reveals the body, tapping again hides it', async () => {
    await renderScreen(makeStats(), [
      completionEntry({ park: 'Magic Kingdom', experienceName: 'Space Mountain' }),
    ]);

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    const headerId = 'stats-section-park-Magic Kingdom-header';
    const bodyId = 'stats-section-park-Magic Kingdom-body';

    // Collapsed: body hidden.
    expect(screen.queryByTestId(bodyId)).toBeNull();

    // Tap to Expand: body appears with the group's row.
    fireEvent.press(screen.getByTestId(headerId));
    const body = screen.getByTestId(bodyId);
    expect(body).toBeTruthy();
    expect(body).toHaveTextContent(/Space Mountain/);

    // Tap again to Collapse: body hidden again (R7.4).
    fireEvent.press(screen.getByTestId(headerId));
    expect(screen.queryByTestId(bodyId)).toBeNull();
  });

  test('R12.4: activating the header through its button role toggles the section', async () => {
    await renderScreen(makeStats(), [completionEntry({ park: 'Magic Kingdom' })]);

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    const headerId = 'stats-section-park-Magic Kingdom-header';
    const bodyId = 'stats-section-park-Magic Kingdom-body';

    // The header is an activatable control (assistive activation routes through
    // the same onPress as a direct tap).
    expect(screen.getByTestId(headerId).props.accessibilityRole).toBe('button');

    fireEvent.press(screen.getByTestId(headerId));
    expect(screen.getByTestId(bodyId)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Header content + announced state (R9.2, R12.1)
// ---------------------------------------------------------------------------

describe('StatsScreen Group_Sections — header content and state (R9.2, R12.1)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('R9.2: the header figures match the stats breakdown and are identical across Collapsed/Expanded', async () => {
    await renderScreen(
      makeStats({ byPark: { 'Magic Kingdom': breakdown(3, 12, 25) } }),
      [completionEntry({ park: 'Magic Kingdom' })],
    );

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    // Collapsed: header shows the breakdown figures.
    const collapsed = screen.getByTestId('stats-park-Magic Kingdom');
    expect(collapsed).toHaveTextContent(/Magic Kingdom/);
    expect(collapsed).toHaveTextContent(/25\.0%/);
    expect(collapsed).toHaveTextContent(/3 of 12/);

    // Expand: the same header still shows the same figures (R9.2/R9.3).
    fireEvent.press(
      screen.getByTestId('stats-section-park-Magic Kingdom-header'),
    );
    const expanded = screen.getByTestId('stats-park-Magic Kingdom');
    expect(expanded).toHaveTextContent(/Magic Kingdom/);
    expect(expanded).toHaveTextContent(/25\.0%/);
    expect(expanded).toHaveTextContent(/3 of 12/);
  });

  test('R12.1: the header exposes the expandable role and announces its expanded state', async () => {
    await renderScreen(makeStats(), [completionEntry({ park: 'Magic Kingdom' })]);

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    const headerId = 'stats-section-park-Magic Kingdom-header';

    // Collapsed: role=button (expandable control), announced expanded=false.
    let header = screen.getByTestId(headerId);
    expect(header.props.accessibilityRole).toBe('button');
    expect(header.props.accessibilityState).toMatchObject({ expanded: false });

    // Expand: announced expanded=true.
    fireEvent.press(screen.getByTestId(headerId));
    header = screen.getByTestId(headerId);
    expect(header.props.accessibilityState).toMatchObject({ expanded: true });
  });
});

// ---------------------------------------------------------------------------
// Isolation + per-Screen_Session retention (R10.1, R10.2, R10.3)
// ---------------------------------------------------------------------------

describe('StatsScreen Group_Sections — isolation and retention (R10.1, R10.2, R10.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('R10.1: toggling one section leaves the other sections unchanged', async () => {
    await renderScreen(makeStats(), [completionEntry({ park: 'Magic Kingdom' })]);

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    // Expand only Magic Kingdom.
    fireEvent.press(
      screen.getByTestId('stats-section-park-Magic Kingdom-header'),
    );

    expect(
      screen.getByTestId('stats-section-park-Magic Kingdom-body'),
    ).toBeTruthy();

    // Every other Park remains Collapsed (its body is not rendered).
    for (const park of PARKS) {
      if (park === 'Magic Kingdom') continue;
      expect(
        screen.queryByTestId(`stats-section-park-${park}-body`),
      ).toBeNull();
    }
  });

  test('R10.2: an expanded section survives a switch to another mode and back', async () => {
    await renderScreen(makeStats(), [completionEntry({ park: 'Magic Kingdom' })]);

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));
    fireEvent.press(
      screen.getByTestId('stats-section-park-Magic Kingdom-header'),
    );
    expect(
      screen.getByTestId('stats-section-park-Magic Kingdom-body'),
    ).toBeTruthy();

    // Switch to Own_Categories, then back to Own_Parks within the same
    // Screen_Session.
    fireEvent.press(screen.getByTestId('tab-Own_Categories'));
    expect(screen.queryByTestId('own-parks')).toBeNull();
    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    // The section is still Expanded (R10.2).
    expect(
      screen.getByTestId('stats-section-park-Magic Kingdom-body'),
    ).toBeTruthy();
  });

  test('R10.3: presenting the screen anew resets every section to Collapsed', async () => {
    const first = await renderScreen(makeStats(), [
      completionEntry({ park: 'Magic Kingdom' }),
    ]);

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));
    fireEvent.press(
      screen.getByTestId('stats-section-park-Magic Kingdom-header'),
    );
    expect(
      screen.getByTestId('stats-section-park-Magic Kingdom-body'),
    ).toBeTruthy();

    // Present the screen anew (a new Screen_Session): the section state is
    // re-initialized to all-Collapsed.
    first.unmount();
    fetchCompletionsMock.mockClear();
    await renderScreen(makeStats(), [completionEntry({ park: 'Magic Kingdom' })]);

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));
    expect(
      screen.queryByTestId('stats-section-park-Magic Kingdom-body'),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Compact_Empty_State has no navigation affordance (R11.4)
// ---------------------------------------------------------------------------

describe('StatsScreen Group_Sections — Compact_Empty_State (R11.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    fetchCompletionsMock.mockReset();
  });

  test('R11.4: an empty group body indication is not an activatable control', async () => {
    // No entries anywhere, so every Park group is empty.
    await renderScreen(makeStats(), []);

    fireEvent.press(screen.getByTestId('tab-Own_Parks'));

    // Expand a Park with no completed Experiences.
    fireEvent.press(
      screen.getByTestId('stats-section-park-Magic Kingdom-header'),
    );

    const empty = screen.getByTestId('stats-park-empty-Magic Kingdom');
    expect(empty).toBeTruthy();
    // No press handler, no accessibility role / action — nothing to activate.
    expect(empty.props.onPress).toBeUndefined();
    expect(empty.props.accessibilityRole).toBeUndefined();
    expect(empty.props.accessibilityActions).toBeUndefined();
  });
});
