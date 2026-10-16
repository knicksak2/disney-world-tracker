/**
 * Property 13: the tab bar and the MagicFab follow the Active theme.
 *
 * Renders the real, authenticated `RootNavigator` inside a real
 * `NavigationContainer` themed exactly as `App.tsx` themes it
 * (`deriveAppearanceChrome(active).navigationTheme`), with one ready-to-claim
 * pin so the Vault badge shows. Only the network layer (`apiRequest`), the
 * notification badge hook and native-only modules are mocked; AsyncStorage
 * comes from the global automatic mock.
 *
 * Validates: Requirements 10.1, 10.2, 10.5
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { PINS } from '@dwt/shared';
import type { PinBoardDTO } from '@dwt/shared';

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

jest.mock('../../env/notifications', () => ({
  __esModule: true,
  loadNotifications: () => null,
}));

jest.mock('../../features/notifications/useAttentionBadge', () => ({
  __esModule: true,
  useAttentionBadge: jest.fn(() => ({ display: 'hidden', count: 0 })),
}));

import RootNavigator from '../RootNavigator';
import { apiRequest as mockedApiRequest } from '../../api/client';
import { useSessionStore } from '../../state/sessionStore';
import { resetTestScheme, setTestScheme } from '../../test/themeTestUtils';
import { deriveAppearanceChrome } from '../../theme/AppearanceChrome';
import { themes } from '../../theme/theme';
import { useActiveTheme } from '../../theme/useActiveTheme';

type Scheme = 'light' | 'dark';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const FOCUSED_GLYPHS = new Set(['home', 'compass', 'map', 'albums']);
const UNFOCUSED_GLYPHS = new Set(['home-outline', 'compass-outline', 'map-outline', 'albums-outline']);

const board: PinBoardDTO = {
  pins: [
    {
      pinId: PINS[0]!.id,
      unlocked: true,
      awardedAt: '2026-01-15T10:00:00.000Z',
      currentValue: null,
      targetValue: null,
      percentComplete: null,
      claimedAt: null,
    },
  ],
  tierSummary: [],
  totalUnlocked: 1,
  totalPins: 1,
  overallPercent: 0,
};

const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};

/** Mirrors App.tsx: the NavigationContainer theme follows the Active theme. */
function ThemedApp(): JSX.Element {
  const active = useActiveTheme();
  return (
    <NavigationContainer theme={deriveAppearanceChrome(active).navigationTheme}>
      <RootNavigator />
    </NavigationContainer>
  );
}

function renderApp(): void {
  apiRequestMock.mockImplementation(async (_method: string, path: string) => {
    if (path === '/me/pins') return board as never;
    if (path === '/home/highest-rated') return { entries: [] } as never;
    if (path === '/me') {
      return {
        user: { id: 'u1', email: 'u@x.test' },
        profile: { displayName: 'U', avatarPreset: null },
      } as never;
    }
    if (path === '/me/trips') return [] as never;
    return {} as never;
  });
  useSessionStore.setState({ token: 'token-abc', hydrated: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <ThemedApp />
    </QueryClientProvider>,
  );
}

/** The BottomTabBar root: painted from nav `colors.card` with a `colors.border` top hairline. */
function tabBarFor(s: Scheme): ReactTestInstance {
  const { background, border } = themes[s].tabBar;
  const matches = screen.UNSAFE_root.findAll(
    (n) =>
      typeof n.type === 'string' &&
      flat(n).borderTopColor === border &&
      flat(n).backgroundColor === background,
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[0]!;
}

async function expectTabChrome(s: Scheme): Promise<void> {
  const t = themes[s];
  await waitFor(() => {
    const bar = tabBarFor(s);
    const badge = bar.findAll((n) => n.type === Text && n.props.children === 1);
    expect(badge).toHaveLength(1);
  });
  const bar = tabBarFor(s);

  const icons = bar.findAllByType(Ionicons);
  const tabIcons = icons.filter(
    (n) => FOCUSED_GLYPHS.has(n.props.name) || UNFOCUSED_GLYPHS.has(n.props.name),
  );
  expect(tabIcons.length).toBeGreaterThanOrEqual(4);
  for (const icon of tabIcons) {
    expect(icon.props.color).toBe(
      FOCUSED_GLYPHS.has(icon.props.name) ? t.tabBar.activeTint : t.tabBar.inactiveTint,
    );
  }

  const labelColor = (label: string): unknown => {
    const node = bar.findAll((n) => n.type === Text && n.props.children === label)[0];
    expect(node).toBeDefined();
    return flat(node!).color;
  };
  expect(labelColor('Home')).toBe(t.tabBar.activeTint);
  for (const label of ['Explore', 'Trips', 'Vault']) {
    expect(labelColor(label)).toBe(t.tabBar.inactiveTint);
  }

  const badge = bar.findAll((n) => n.type === Text && n.props.children === 1)[0]!;
  expect(flat(badge).backgroundColor).toBe(t.tabBar.badgeBackground);
  expect(flat(badge).color).toBe(t.tabBar.badgeText);

  const fab = screen.getByTestId('magic-fab').findByType(LinearGradient);
  expect(fab.props.colors).toEqual(t.gradient.fab);
}

beforeEach(() => {
  apiRequestMock.mockReset();
});
afterEach(resetTestScheme);

describe('Property 13: tab bar and MagicFab follow the active theme', () => {
  // Feature: dark-mode, Property 13: tab bar and MagicFab follow the active theme
  it("light renders today's tab tints, badge and FAB gradient", async () => {
    renderApp();
    await expectTabChrome('light');
    const t = themes.light;
    expect([t.tabBar.activeTint, t.tabBar.inactiveTint]).toEqual(['#003a9b', '#6b7280']);
    expect([t.tabBar.badgeBackground, t.tabBar.badgeText]).toEqual(['#d97706', '#ffffff']);
    expect(t.gradient.fab).toEqual(['#7e57c2', '#5b2a86', '#3d1c5c']);
  });

  // Feature: dark-mode, Property 13: tab bar and MagicFab follow the active theme
  it('dark renders the Twilight tab tints, badge, tab surface and FAB gradient', async () => {
    setTestScheme('dark');
    renderApp();
    await expectTabChrome('dark');
    const t = themes.dark;
    expect([t.tabBar.activeTint, t.tabBar.inactiveTint]).toEqual(['#f6c343', '#8a7fa3']);
    expect([t.tabBar.badgeBackground, t.tabBar.badgeText]).toEqual(['#f6c343', '#3d1c5c']);
    expect([t.tabBar.background, t.tabBar.border]).toEqual(['#170e27', '#33264d']);
    expect(t.gradient.fab).toEqual(['#9d7ae0', '#7e57c2', '#7650b9']);
  });

  // Feature: dark-mode, Property 13: tab bar and MagicFab follow the active theme
  it('repaints the mounted tab bar live when the scheme switches', async () => {
    renderApp();
    await expectTabChrome('light');
    setTestScheme('dark');
    await expectTabChrome('dark');
    setTestScheme('light');
    await expectTabChrome('light');
  });
});
