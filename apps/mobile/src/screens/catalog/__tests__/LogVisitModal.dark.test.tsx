// Feature: dark-mode (B3-N3) — LogVisitModal in the Twilight scheme.
//
// The sheet reads only theme tokens; the note TextInput gets a dark-only
// placeholder colour (light keeps the RN platform default) and the active
// keyboard appearance. Only the network layer is mocked.

import React from 'react';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import LogVisitModal from '../LogVisitModal';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { contrastRatio } from '../../../theme/contrast';
import { darkTheme } from '../../../theme/theme';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;
const EXPERIENCE_ID = 'exp-log-visit';

const flat = (node: ReactTestInstance): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;

function renderModal(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <LogVisitModal
        experienceId={EXPERIENCE_ID}
        visible={true}
        onClose={jest.fn()}
        onLogged={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('LogVisitModal — dark mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation((method, path) => {
      if (method === 'GET' && path === '/me/trips') return Promise.resolve([]);
      // The POST stays pending so the busy spinner can be inspected.
      return new Promise(() => undefined);
    });
  });
  afterEach(resetTestScheme);

  test('sheet, note input, selected rating and busy spinner use dark tokens', async () => {
    setTestScheme('dark');
    renderModal();

    expect(flat(screen.getByTestId('log-visit-modal')).backgroundColor).toBe(
      darkTheme.color.surface,
    );
    expect(flat(screen.getByText('Log a visit')).color).toBe(darkTheme.color.textPrimary);

    const note = screen.getByTestId('log-visit-note-input');
    expect(note.props.placeholderTextColor).toBe(darkTheme.color.textSecondary);
    expect(note.props.keyboardAppearance).toBe('dark');
    expect(flat(note).backgroundColor).toBe(darkTheme.color.surfaceAlt);
    expect(flat(note).color).toBe(darkTheme.color.textPrimary);

    // Selecting a rating fills its pill; the idle pill stays on surfaceAlt.
    fireEvent.press(screen.getByTestId('log-visit-rating-7'));
    const selected = flat(screen.getByTestId('log-visit-rating-7'));
    const idle = flat(screen.getByTestId('log-visit-rating-6'));
    expect(selected.backgroundColor).toBe(darkTheme.color.primary);
    expect(idle.backgroundColor).toBe(darkTheme.color.surfaceAlt);
    expect(flat(screen.getByText('7')).color).toBe(darkTheme.color.textOnPrimary);
    expect(
      contrastRatio(darkTheme.color.textOnPrimary, selected.backgroundColor as string),
    ).toBeGreaterThanOrEqual(4.5);

    fireEvent.press(screen.getByTestId('log-visit-submit'));
    await waitFor(() => expect(screen.getByTestId('log-visit-busy')).toBeTruthy());
    expect(apiRequestMock).toHaveBeenCalledWith(
      'POST',
      `/me/experiences/${EXPERIENCE_ID}/logs`,
      expect.objectContaining({ rating: 7 }),
    );
    expect(screen.getByTestId('log-visit-busy').props.color).toBe(darkTheme.color.primaryFg);
  });

  test('light keeps the platform placeholder and a light keyboard', () => {
    setTestScheme('light');
    renderModal();
    const note = screen.getByTestId('log-visit-note-input');
    expect(note.props.placeholderTextColor).toBeUndefined();
    expect(note.props.keyboardAppearance).toBe('light');
  });
});
