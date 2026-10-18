/**
 * Feature: dark-mode — B7 coverage for AvatarChip's "You & Crew" pill.
 *
 * The pill sits on the header gradient: its gold circle and violet initial are
 * mode-invariant (G / H roles), its label is `textOnPrimary`, and avatar
 * artwork is never recoloured, so dark renders the same art as light.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AVATAR_PRESET_IDS } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme, lightTheme, withAlpha } from '../../../theme/theme';
import { AvatarChip } from '../AvatarChip';
import { AVATAR_PILL } from '../AvatarChip.palette';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate }) };
});
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

function meResponse(avatarPreset: string | null) {
  return {
    user: { id: 'user-1', email: 'guest@example.com' },
    profile: { displayName: 'Minnie', avatarPreset },
  };
}

function renderPill() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AvatarChip variant="pill" />
    </QueryClientProvider>,
  );
}

const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

describe('AvatarChip pill (dark)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockApiRequest.mockReset();
  });
  afterEach(resetTestScheme);

  it('dark: the gold circle and violet initial match light; the label is textOnPrimary', async () => {
    mockApiRequest.mockResolvedValue(meResponse(null) as never);
    setTestScheme('dark');
    renderPill();

    const initial = await screen.findByText('M');
    expect(flat(initial).color).toBe(AVATAR_PILL.light.initialText);
    expect(flat(screen.getByTestId('avatar-chip-circle')).backgroundColor).toBe(
      darkTheme.color.accent,
    );
    expect(darkTheme.color.accent).toBe(lightTheme.color.accent);
    expect(flat(screen.getByTestId('avatar-chip')).borderColor).toBe(
      withAlpha(darkTheme.color.accent, 0.7),
    );
    expect(flat(screen.getByText('You & Crew')).color).toBe(darkTheme.color.textOnPrimary);

    fireEvent.press(screen.getByTestId('avatar-chip'));
    expect(mockNavigate).toHaveBeenCalledWith('YouAndCrew');
  });

  it('avatar artwork renders identically in light and dark', async () => {
    const preset = AVATAR_PRESET_IDS[0];
    mockApiRequest.mockResolvedValue(meResponse(preset) as never);

    setTestScheme('light');
    const lightView = renderPill();
    await waitFor(() => {
      expect(screen.queryByText('Y')).toBeNull();
      expect(screen.queryByText('M')).toBeNull();
    });
    const lightTree = JSON.stringify(lightView.toJSON());
    lightView.unmount();

    setTestScheme('dark');
    const darkView = renderPill();
    await waitFor(() => {
      expect(screen.queryByText('Y')).toBeNull();
      expect(screen.queryByText('M')).toBeNull();
    });
    // The whole pill (avatar art + mode-invariant chrome) is byte-identical across schemes.
    expect(JSON.stringify(darkView.toJSON())).toBe(lightTree);
  });
});
