/**
 * Feature: dark-mode — ShareComposer recipient selection in dark
 * (Requirement 9.12).
 *
 * The unselected recipient ring must read muted and differ from the selected
 * `primaryFg` ring; the selected row keeps its `surfaceAlt` fill.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

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

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import ShareComposerScreen from '../ShareComposerScreen';
import { apiRequest } from '../../../api/client';
import type { ShareComposerParams } from '../../../navigation/RootNavigator';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { contrastRatio } from '../../../theme/contrast';
import { darkTheme } from '../../../theme/theme';

const apiRequestMock = apiRequest as jest.MockedFunction<typeof apiRequest>;

const FRIEND = {
  userId: 'friend-123',
  displayName: 'Minnie Mouse',
  avatarPreset: null,
  establishedAt: '2024-01-02T00:00:00Z',
} as const;

const PARAMS: ShareComposerParams = {
  kind: 'experience',
  experienceId: 'exp-777',
  experienceName: 'Space Mountain',
  park: 'Magic Kingdom',
  category: 'Ride',
  rating: 8,
  note: 'Loved it',
};

function renderComposer() {
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: jest.fn(() => true),
    setOptions: jest.fn(),
    addListener: jest.fn(() => () => undefined),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ShareComposerScreen
        navigation={navigation as never}
        route={{ key: 'ShareComposer-1', name: 'ShareComposer', params: PARAMS } as never}
      />
    </QueryClientProvider>,
  );
}

/** The recipient row's ring icon (the only `ellipse-outline`/row `checkmark-circle` sized 22). */
function ringIcon(): ReactTestInstance {
  const icons = screen
    .UNSAFE_getAllByType(Ionicons)
    .filter(
      (i) =>
        i.props.size === 22 &&
        (i.props.name === 'ellipse-outline' || i.props.name === 'checkmark-circle'),
    );
  expect(icons).toHaveLength(1);
  return icons[0]!;
}

/** Background colours painted on the friend name's ancestors (nearest first). */
function rowBackgrounds(): string[] {
  const out: string[] = [];
  let node: ReactTestInstance | null = screen.getByText(FRIEND.displayName);
  while (node !== null) {
    if (typeof node.type === 'string') {
      const bg = (StyleSheet.flatten(node.props.style) as { backgroundColor?: string } | undefined)
        ?.backgroundColor;
      if (typeof bg === 'string') out.push(bg);
    }
    node = node.parent;
  }
  return out;
}

describe('ShareComposerScreen recipient ring (dark)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/friends') {
        return { friends: [FRIEND], incomingRequests: [], outgoingRequests: [] } as never;
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });
  afterEach(resetTestScheme);

  it('unselected ring is muted textSecondary; selected is primaryFg; they differ', async () => {
    setTestScheme('dark');
    renderComposer();
    await screen.findByText(FRIEND.displayName);

    const before = ringIcon();
    expect(before.props.name).toBe('ellipse-outline');
    expect(before.props.color).toBe(darkTheme.color.textSecondary);
    expect(contrastRatio(before.props.color, darkTheme.color.surface)).toBeGreaterThanOrEqual(3);
    const unselectedColor: string = before.props.color;

    fireEvent.press(screen.getByText(FRIEND.displayName));

    const after = ringIcon();
    expect(after.props.name).toBe('checkmark-circle');
    expect(after.props.color).toBe(darkTheme.color.primaryFg);
    expect(after.props.color).not.toBe(unselectedColor);
    // The selected row carries the `friendRowSelected` surfaceAlt fill.
    expect(rowBackgrounds()).toContain(darkTheme.color.surfaceAlt);
  });

  it('light: the unselected ring keeps today\'s #cdbce6', async () => {
    setTestScheme('light');
    renderComposer();
    await screen.findByText(FRIEND.displayName);
    expect(ringIcon().props.color).toBe('#cdbce6');
  });
});
