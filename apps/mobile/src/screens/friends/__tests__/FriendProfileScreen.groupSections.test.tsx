/**
 * FriendProfileScreen collapsible Group_Section example/integration tests
 * (task 9.5).
 *
 * Validates: Requirements 7.4, 7.5, 8.2, 9.2, 10.1, 10.2, 10.3, 11.4, 12.1,
 * 12.4
 *
 * These React Native Testing Library tests drive the Friend_Profile_View's
 * Parks and Categories Grouped_View_Modes through their collapsible
 * Group_Sections and pin the collapse/expand behavior wired up via
 * `GroupSection` + `useGroupSections`:
 *
 *   - **First display (R8.2, R7.5).** Every Park / Experience_Category renders
 *     a Group_Header (none omitted) with its Group_Body hidden (Collapsed).
 *   - **Toggling (R7.4, R7.5, R12.4).** Tapping a header reveals its body;
 *     tapping again hides it. Assistive activation uses the same press path.
 *   - **Header content/state (R9.2, R12.1).** Header figures match the stats
 *     breakdown, the Categories mode suppresses the figures for an empty group,
 *     and the header announces its expandable role + current expanded state.
 *   - **Isolation + retention (R10.1, R10.2, R10.3).** Toggling one section
 *     leaves others unchanged; an expanded section survives a mode switch
 *     within the Screen_Session; presenting the screen anew resets to
 *     Collapsed.
 *   - **Compact_Empty_State (R11.4).** An empty group's body indication is a
 *     plain, non-activatable element.
 *
 * Mocking mirrors `FriendProfileScreen.modes.test.tsx`: only the lowest-level
 * `apiRequest` (`api/client`) is mocked, the real data layer + query hooks run
 * on top, and the two navigation hooks used via `useOpenExperience` are stubbed
 * since the screen is rendered standalone.
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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

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
import type {
  FriendStatsResponse,
  FriendStatsBreakdown,
} from '../../../api/friendProfile';

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
    avatarUrl: null,
    overallCompletionPercent: 42,
    ...overrides,
  };
}

function breakdown(
  completed: number,
  total: number,
  percent: number,
): FriendStatsBreakdown {
  return { completed, total, percent };
}

function makeStats(overrides?: {
  overall?: FriendStatsBreakdown;
  byPark?: Partial<Record<(typeof PARKS)[number], FriendStatsBreakdown>>;
  byCategory?: Partial<
    Record<(typeof EXPERIENCE_CATEGORIES)[number], FriendStatsBreakdown>
  >;
}): FriendStatsResponse {
  const zero = breakdown(0, 0, 0);

  const byPark = Object.fromEntries(
    PARKS.map((park) => [park, overrides?.byPark?.[park] ?? zero]),
  ) as FriendStatsResponse['byPark'];

  const byCategory = Object.fromEntries(
    EXPERIENCE_CATEGORIES.map((category) => [
      category,
      overrides?.byCategory?.[category] ?? zero,
    ]),
  ) as FriendStatsResponse['byCategory'];

  const byParkAndCategory = Object.fromEntries(
    PARKS.map((park) => [park, byCategory]),
  ) as FriendStatsResponse['byParkAndCategory'];

  return {
    overall: overrides?.overall ?? breakdown(50, 100, 50),
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

function installRouteHandlers(): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (isStatsPath(path)) return routeHandlers.stats();
    if (isCompletionsPath(path)) return routeHandlers.completions();
    if (isProfilePath(path)) return routeHandlers.profile();
    throw new Error(`unexpected call to ${path}`);
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FriendProfileScreen Group_Sections (R7.4, R7.5, R8.2, R9.2, R10.*, R11.4, R12.1, R12.4)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();

    routeHandlers = {
      profile: () => Promise.resolve(makeProfile()),
      stats: () => Promise.resolve(makeStats()),
      completions: () => Promise.resolve({ entries: [] }),
    };

    installRouteHandlers();
  });

  // -------------------------------------------------------------------------
  // First display: every header visible, every body hidden (R8.2, R7.5)
  // -------------------------------------------------------------------------

  test('R8.2: Parks shows a Group_Header for every Park with all bodies hidden', async () => {
    routeHandlers.completions = () =>
      Promise.resolve({ entries: [completionEntry()] });

    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Parks'));

    await screen.findByTestId('friend-mode-parks');

    for (const park of PARKS) {
      // Header rendered for every Park (none omitted, R8.2).
      expect(screen.getByTestId(`friend-park-group-${park}-header`)).toBeTruthy();
      // Body hidden on first display (Collapsed, R7.5).
      expect(
        screen.queryByTestId(`friend-park-group-${park}-body`),
      ).toBeNull();
    }
  });

  test('R8.2: Categories shows a Group_Header for every Category with all bodies hidden', async () => {
    routeHandlers.completions = () =>
      Promise.resolve({ entries: [completionEntry()] });

    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Categories'));

    await screen.findByTestId('friend-mode-categories');

    for (const category of EXPERIENCE_CATEGORIES) {
      expect(
        screen.getByTestId(`friend-category-group-${category}-header`),
      ).toBeTruthy();
      expect(
        screen.queryByTestId(`friend-category-group-${category}-body`),
      ).toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // Toggling reveals / hides the body (R7.4, R7.5, R12.4)
  // -------------------------------------------------------------------------

  test('R7.5/R7.4: tapping a header reveals the body, tapping again hides it', async () => {
    routeHandlers.completions = () =>
      Promise.resolve({
        entries: [
          completionEntry({
            park: 'Magic Kingdom',
            experienceName: 'Space Mountain',
          }),
        ],
      });

    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Parks'));
    await screen.findByTestId('friend-mode-parks');

    const headerId = 'friend-park-group-Magic Kingdom-header';
    const bodyId = 'friend-park-group-Magic Kingdom-body';

    expect(screen.queryByTestId(bodyId)).toBeNull();

    // Expand.
    fireEvent.press(screen.getByTestId(headerId));
    const body = screen.getByTestId(bodyId);
    expect(body).toBeTruthy();
    expect(body).toHaveTextContent(/Space Mountain/);

    // Collapse (R7.4).
    fireEvent.press(screen.getByTestId(headerId));
    expect(screen.queryByTestId(bodyId)).toBeNull();
  });

  test('R12.4: activating the header through its button role toggles the section', async () => {
    routeHandlers.completions = () =>
      Promise.resolve({ entries: [completionEntry({ park: 'Magic Kingdom' })] });

    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Parks'));
    await screen.findByTestId('friend-mode-parks');

    const headerId = 'friend-park-group-Magic Kingdom-header';
    expect(screen.getByTestId(headerId).props.accessibilityRole).toBe('button');

    fireEvent.press(screen.getByTestId(headerId));
    expect(
      screen.getByTestId('friend-park-group-Magic Kingdom-body'),
    ).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Header content + announced state (R9.2, R12.1)
  // -------------------------------------------------------------------------

  test('R9.2: a non-empty header shows the breakdown figures, identical across Collapsed/Expanded', async () => {
    routeHandlers.stats = () =>
      Promise.resolve(
        makeStats({ byPark: { 'Magic Kingdom': breakdown(5, 10, 50) } }),
      );
    routeHandlers.completions = () =>
      Promise.resolve({ entries: [completionEntry({ park: 'Magic Kingdom' })] });

    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Parks'));

    const collapsed = await screen.findByTestId(
      'friend-stats-park-Magic Kingdom',
    );
    expect(collapsed).toHaveTextContent(/50\.0%/);
    expect(collapsed).toHaveTextContent(/5 of 10/);

    fireEvent.press(
      screen.getByTestId('friend-park-group-Magic Kingdom-header'),
    );
    const expanded = screen.getByTestId('friend-stats-park-Magic Kingdom');
    expect(expanded).toHaveTextContent(/50\.0%/);
    expect(expanded).toHaveTextContent(/5 of 10/);
  });

  test('R9.2: an empty Category header suppresses its percentage and counts', async () => {
    // A non-zero Show stat exists server-side, but with no Show entries the
    // header must suppress the figures (the underlying mode's empty-group
    // suppression, preserved by the Group_Header).
    routeHandlers.stats = () =>
      Promise.resolve(makeStats({ byCategory: { Show: breakdown(2, 5, 40) } }));
    routeHandlers.completions = () =>
      Promise.resolve({ entries: [completionEntry({ category: 'Ride' })] });

    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Categories'));

    const showHeader = await screen.findByTestId('friend-stats-category-Show');
    expect(showHeader).not.toHaveTextContent(/40\.0%/);
    expect(showHeader).not.toHaveTextContent(/2 of 5/);
  });

  test('R12.1: the header exposes the expandable role and announces its expanded state', async () => {
    routeHandlers.completions = () =>
      Promise.resolve({ entries: [completionEntry({ park: 'Magic Kingdom' })] });

    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Parks'));
    await screen.findByTestId('friend-mode-parks');

    const headerId = 'friend-park-group-Magic Kingdom-header';

    let header = screen.getByTestId(headerId);
    expect(header.props.accessibilityRole).toBe('button');
    expect(header.props.accessibilityState).toMatchObject({ expanded: false });
    // The label includes the Park name (R12.2 is exercised here incidentally).
    expect(header.props.accessibilityLabel).toContain('Magic Kingdom');

    fireEvent.press(screen.getByTestId(headerId));
    header = screen.getByTestId(headerId);
    expect(header.props.accessibilityState).toMatchObject({ expanded: true });
  });

  // -------------------------------------------------------------------------
  // Isolation + per-Screen_Session retention (R10.1, R10.2, R10.3)
  // -------------------------------------------------------------------------

  test('R10.1: toggling one section leaves the other sections unchanged', async () => {
    routeHandlers.completions = () =>
      Promise.resolve({ entries: [completionEntry({ park: 'Magic Kingdom' })] });

    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Parks'));
    await screen.findByTestId('friend-mode-parks');

    fireEvent.press(
      screen.getByTestId('friend-park-group-Magic Kingdom-header'),
    );
    expect(
      screen.getByTestId('friend-park-group-Magic Kingdom-body'),
    ).toBeTruthy();

    for (const park of PARKS) {
      if (park === 'Magic Kingdom') continue;
      expect(
        screen.queryByTestId(`friend-park-group-${park}-body`),
      ).toBeNull();
    }
  });

  test('R10.2: an expanded section survives a switch to another mode and back', async () => {
    routeHandlers.completions = () =>
      Promise.resolve({ entries: [completionEntry({ park: 'Magic Kingdom' })] });

    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Parks'));
    await screen.findByTestId('friend-mode-parks');

    fireEvent.press(
      screen.getByTestId('friend-park-group-Magic Kingdom-header'),
    );
    expect(
      screen.getByTestId('friend-park-group-Magic Kingdom-body'),
    ).toBeTruthy();

    // Switch to Categories and back within the same Screen_Session.
    fireEvent.press(screen.getByTestId('tab-Categories'));
    await screen.findByTestId('friend-mode-categories');
    fireEvent.press(screen.getByTestId('tab-Parks'));
    await screen.findByTestId('friend-mode-parks');

    // Still Expanded (R10.2).
    expect(
      screen.getByTestId('friend-park-group-Magic Kingdom-body'),
    ).toBeTruthy();
  });

  test('R10.3: presenting the screen anew resets every section to Collapsed', async () => {
    routeHandlers.completions = () =>
      Promise.resolve({ entries: [completionEntry({ park: 'Magic Kingdom' })] });

    const first = renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Parks'));
    await screen.findByTestId('friend-mode-parks');

    fireEvent.press(
      screen.getByTestId('friend-park-group-Magic Kingdom-header'),
    );
    expect(
      screen.getByTestId('friend-park-group-Magic Kingdom-body'),
    ).toBeTruthy();

    // Present the screen anew — a new Screen_Session resets the state.
    first.unmount();
    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Parks'));
    await screen.findByTestId('friend-mode-parks');

    expect(
      screen.queryByTestId('friend-park-group-Magic Kingdom-body'),
    ).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Compact_Empty_State has no navigation affordance (R11.4)
  // -------------------------------------------------------------------------

  test('R11.4: an empty group body indication is not an activatable control', async () => {
    // No entries, so every Park group is empty.
    routeHandlers.completions = () => Promise.resolve({ entries: [] });

    renderScreen();
    fireEvent.press(await screen.findByTestId('tab-Parks'));
    await screen.findByTestId('friend-mode-parks');

    fireEvent.press(
      screen.getByTestId('friend-park-group-Magic Kingdom-header'),
    );

    const empty = screen.getByTestId('friend-park-empty-Magic Kingdom');
    expect(empty).toBeTruthy();
    expect(empty.props.onPress).toBeUndefined();
    expect(empty.props.accessibilityRole).toBeUndefined();
    expect(empty.props.accessibilityActions).toBeUndefined();
  });
});
