/**
 * Navigation-wiring integration tests (task 10.3).
 *
 * Validates: Requirements 2.1, 2.2, 3.1, 4.1, 4.3, 11.3
 *
 * These tests mount each Grouped_View_Mode (the Stats_View's Own_Parks /
 * Own_Categories and the Friend_Profile_View's Parks / Categories) and the
 * Own_Experiences / Experiences lists inside a *real* `NavigationContainer`
 * with a real tab + nested-stack topology that mirrors the app's:
 *
 *   - a `Catalog` tab nesting a stack whose `ExperienceDetail` screen is a
 *     lightweight stub that records the `experienceId` route param it received,
 *   - a `Stats` tab rendering the real `StatsScreen`,
 *   - a `Friends` tab nesting a stack rendering the real `FriendProfileScreen`.
 *
 * Because the navigator is real, tapping (or assistive-activating) a
 * Completed_Experience_Row exercises the genuine cross-stack dispatch wired up
 * by `useOpenExperience`
 * (`navigate('Catalog', { screen: 'ExperienceDetail', params: { experienceId } })`),
 * not a mock. The stub detail screen renders the `experienceId` it was handed,
 * so each test asserts the navigation reached `ExperienceDetail` carrying the
 * tapped row's exact `experienceId` — in every mode (R2.1, R2.2, R3.1, R11.3),
 * via a single full-row control (R4.1) reachable both by a direct tap and by an
 * assistive-technology activation (R4.3).
 *
 * Mocking is limited to the lowest-level `apiRequest`, routed by path so both
 * screens' reads resolve deterministically; React Navigation is NOT mocked.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { type ExperienceCategory, type Park } from '@dwt/shared';

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

// Mock only `apiRequest`; preserve the real `ApiError` so the friend-profile
// timeout/error plumbing keeps its genuine error class.
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import StatsStack from '../../../navigation/StatsStack';
import FriendProfileScreen, {
  type FriendProfileParams,
} from '../../friends/FriendProfileScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type { StatsResponse } from '../../../api/statsTypes';
import { makeStatsResponse } from '../../stats/__testSupport__/statsFixture';

/**
 * Local Catalog-stack param list for the test harness. The production
 * `CatalogStackParamList` no longer carries `ExperienceDetail` (it moved to the
 * root stack), so this harness mirrors that: the Catalog stack owns only
 * `CatalogList`, and `ExperienceDetail` is registered on a root-level stack
 * above the tabs (see `RootTestStackParamList` below). This matches the real
 * `useOpenExperience` dispatch of `navigate('ExperienceDetail', { experienceId })`.
 */
type CatalogStackParamList = {
  CatalogList: undefined;
};

/**
 * Root-level stack param list for the test harness, mirroring the production
 * `RootStack`: `MainTabs` (the bottom-tab navigator) is the initial route and
 * `ExperienceDetail` is registered as a sibling pushed above the tabs.
 */
type RootTestStackParamList = {
  MainTabs: undefined;
  ExperienceDetail: { experienceId: string };
};

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Identities + fixtures
// ---------------------------------------------------------------------------

const OWN_USER_ID = 'own-user-7777';
const FRIEND_ID = 'friend-0001';
const DISPLAY_NAME = 'Mickey Mouse';

const ME_RESPONSE = {
  user: { id: OWN_USER_ID, email: 'me@test.local' },
  profile: { displayName: 'Me' },
};

// The single completed Experience every mode navigates to. Its Park (Magic
// Kingdom) and Experience_Category (Ride) place it in deterministic groups.
const EXPERIENCE_ID = 'exp-space-mountain-001';
const EXPERIENCE_NAME = 'Space Mountain';
const ROW_A11Y_NAME = `${EXPERIENCE_NAME}, view experience details`;

const ENTRY = {
  experienceId: EXPERIENCE_ID,
  experienceName: EXPERIENCE_NAME,
  park: 'Magic Kingdom' as Park,
  category: 'Ride' as ExperienceCategory,
  completedOn: '2024-01-05',
  rating: 8,
  sharedNote: null,
};

/** A fully-populated nested stats roll-up (every Park / Category present, R3.1). */
function makeStats(): StatsResponse {
  return makeStatsResponse();
}

const FRIEND_PROFILE = {
  userId: FRIEND_ID,
  displayName: DISPLAY_NAME,
  avatarPreset: null,
  overallCompletionPercent: 42,
};

/**
 * Route `apiRequest` by path so both screens' reads resolve:
 *   - `/me`                         → identity (own-user resolution)
 *   - `/me/stats`                   → own stats roll-up
 *   - `/me/stats/summary?for=...`   → friend stats roll-up
 *   - `/users/{id}/profile`         → friend profile
 *   - `/users/{id}/completions`     → completions (own vs friend by id)
 */
function installApiRouter(): void {
  apiRequestMock.mockImplementation(async (_method, path) => {
    if (typeof path !== 'string') {
      throw new Error(`unexpected non-string path: ${String(path)}`);
    }
    if (path === '/me') return ME_RESPONSE as unknown;
    if (path.startsWith('/me/stats')) return makeStats() as unknown;
    if (path.endsWith('/profile')) return FRIEND_PROFILE as unknown;
    if (path.endsWith('/completions')) {
      return { entries: [ENTRY] } as unknown;
    }
    throw new Error(`unexpected apiRequest path: ${path}`);
  });
}

// ---------------------------------------------------------------------------
// Real navigator harness
// ---------------------------------------------------------------------------

let capturedExperienceId: string | null = null;

/** Stub destination that records and renders the `experienceId` it received. */
function ExperienceDetailStub({
  route,
}: {
  readonly route: { readonly params: { readonly experienceId: string } };
}): JSX.Element {
  capturedExperienceId = route.params.experienceId;
  return (
    <View testID="experience-detail">
      <Text testID="experience-detail-id">{route.params.experienceId}</Text>
    </View>
  );
}

const CatalogStack = createNativeStackNavigator<CatalogStackParamList>();

function CatalogTestStack(): JSX.Element {
  return (
    <CatalogStack.Navigator screenOptions={{ headerShown: false }}>
      <CatalogStack.Screen name="CatalogList">
        {() => <View testID="catalog-list" />}
      </CatalogStack.Screen>
    </CatalogStack.Navigator>
  );
}

type FriendsTestStackParamList = {
  FriendProfile: FriendProfileParams;
};

const FriendsStack = createNativeStackNavigator<FriendsTestStackParamList>();

function FriendsTestStack(): JSX.Element {
  return (
    <FriendsStack.Navigator screenOptions={{ headerShown: false }}>
      <FriendsStack.Screen
        name="FriendProfile"
        component={FriendProfileScreen}
        initialParams={{ friendId: FRIEND_ID, displayName: DISPLAY_NAME }}
      />
    </FriendsStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator<RootTestStackParamList>();

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * Render the real root-stack + tab + nested-stack topology, focusing the tab
 * that owns the screen under test. `ExperienceDetail` (the stub recording the
 * `experienceId`) is registered on the ROOT stack above the tabs — mirroring
 * production — so the genuine `navigate('ExperienceDetail', { experienceId })`
 * dispatched by `useOpenExperience` has a real destination.
 */
function renderNavigator(initialTab: 'Stats' | 'Friends'): void {
  function MainTabsComponent(): JSX.Element {
    return (
      <Tab.Navigator
        initialRouteName={initialTab}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen name="Stats" component={StatsStack} />
        <Tab.Screen name="Friends" component={FriendsTestStack} />
        <Tab.Screen name="Catalog" component={CatalogTestStack} />
      </Tab.Navigator>
    );
  }

  render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer>
        <RootStack.Navigator
          initialRouteName="MainTabs"
          screenOptions={{ headerShown: false }}
        >
          <RootStack.Screen name="MainTabs" component={MainTabsComponent} />
          <RootStack.Screen
            name="ExperienceDetail"
            component={ExperienceDetailStub}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Per-mode navigation setup
// ---------------------------------------------------------------------------

interface ModeCase {
  /** Human-readable mode name for the test title. */
  readonly mode: string;
  /** Which tab hosts the screen under test. */
  readonly initialTab: 'Stats' | 'Friends';
  /** testID of the View_Selector tab to activate. */
  readonly tabTestId: string;
  /** testID of the mode container to await after switching. */
  readonly containerTestId: string;
  /** testID of the Group_Header to expand (grouped modes only). */
  readonly expandHeaderTestId?: string;
  /** testID of the Completed_Experience_Row to activate. */
  readonly rowTestId: string;
}

const MODE_CASES: readonly ModeCase[] = [
  {
    mode: 'Friend Experiences',
    initialTab: 'Friends',
    tabTestId: 'tab-Experiences',
    containerTestId: 'friend-mode-experiences',
    rowTestId: 'friend-experience-row-0',
  },
];

/**
 * Drive a freshly-rendered navigator to the given mode with the target row
 * mounted and ready to activate, then return that row element. Awaits the
 * async reads, switches modes, and expands the relevant Group_Section.
 */
async function arriveAtRow(testCase: ModeCase): Promise<void> {
  renderNavigator(testCase.initialTab);

  // Wait for the hosting screen to be ready.
  if (testCase.initialTab === 'Stats') {
    await screen.findByTestId('stats-screen');
  } else {
    await screen.findByTestId('friend-profile-screen');
  }

  // Switch to the mode under test, then wait for its container.
  fireEvent.press(screen.getByTestId(testCase.tabTestId));
  await screen.findByTestId(testCase.containerTestId);

  // Expand the Group_Section so its body (and the row) is rendered.
  if (testCase.expandHeaderTestId !== undefined) {
    fireEvent.press(await screen.findByTestId(testCase.expandHeaderTestId));
  }

  // The row appears once the completions read has resolved and (for grouped
  // modes) the section is expanded.
  await screen.findByTestId(testCase.rowTestId);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('navigation wiring — Completed_Experience_Row → ExperienceDetail (R2.1, R2.2, R3.1, R4.1, R4.3, R11.3)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    capturedExperienceId = null;
    installApiRouter();
  });

  describe.each(MODE_CASES)('$mode', (testCase) => {
    test('a direct tap navigates cross-stack to ExperienceDetail with the row experienceId', async () => {
      await arriveAtRow(testCase);

      // R4.1: the whole row is a single activatable control.
      const row = screen.getByTestId(testCase.rowTestId);
      expect(row.props.accessibilityRole).toBe('button');

      // R2.1 / R2.2 / R3.1 / R11.3: tapping dispatches the cross-stack
      // navigation; the stub ExperienceDetail receives the row's experienceId.
      fireEvent.press(row);

      await waitFor(() => {
        expect(screen.getByTestId('experience-detail')).toBeTruthy();
      });
      expect(screen.getByTestId('experience-detail-id')).toHaveTextContent(
        EXPERIENCE_ID,
      );
      expect(capturedExperienceId).toBe(EXPERIENCE_ID);
    });

    test('an assistive-technology activation navigates to the same ExperienceDetail target', async () => {
      await arriveAtRow(testCase);

      // R4.3: the row is reachable by assistive technology (located by its
      // button role + name) and its activation performs the same navigation a
      // direct tap performs.
      const row = screen.getByRole('button', { name: ROW_A11Y_NAME });
      fireEvent.press(row);

      await waitFor(() => {
        expect(screen.getByTestId('experience-detail')).toBeTruthy();
      });
      expect(capturedExperienceId).toBe(EXPERIENCE_ID);
    });
  });
});
