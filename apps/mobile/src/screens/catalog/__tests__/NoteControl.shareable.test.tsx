// NoteControl shareable-toggle tests (friend-stats-viewing, task 6.4).
//
// Validates: Requirements 4.6, 4.7 (owner-facing control)
//
// These tests pin the privacy-sensitive half of the Note editor: the
// "Share with friends" toggle must (a) default a brand-new Note to private,
// (b) forward whatever value the owner picked on the `PUT .../note` save, and
// (c) reflect the persisted state in view mode. A silent regression here
// would let a Note the owner believes is private become visible to Friends
// (or the reverse), so the toggle's wire behavior is worth asserting directly.

import React from 'react';
import { StyleSheet, Switch } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { NoteDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the module under test is imported).
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

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import NoteControl from '../NoteControl';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme } from '../../../theme/theme';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = 'exp-0001';

function makeNote(overrides: Partial<NoteDTO> = {}): NoteDTO {
  return {
    userId: 'user-0001',
    experienceId: EXPERIENCE_ID,
    body: 'A lovely ride.',
    shareable: false,
    updatedAt: '2024-06-01T12:00:00.000Z',
    ...overrides,
  };
}

function renderControl(
  note: NoteDTO | null,
  onMutated: () => void = jest.fn(),
): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <NoteControl experienceId={EXPERIENCE_ID} note={note} onMutated={onMutated} />
    </QueryClientProvider>,
  );
}

/** Last body passed to a `PUT .../note` apiRequest call. */
function lastNotePutBody(): Record<string, unknown> | undefined {
  const calls = apiRequestMock.mock.calls.filter(
    (c) => c[0] === 'PUT' && typeof c[1] === 'string' && c[1].endsWith('/note'),
  );
  const last = calls[calls.length - 1];
  return last?.[2] as Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('NoteControl shareable toggle (R4.6, R4.7)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('a brand-new Note saves with shareable=false when the toggle is left off', async () => {
    apiRequestMock.mockResolvedValueOnce(makeNote({ body: 'first note', shareable: false }));
    renderControl(null);

    fireEvent.press(screen.getByTestId('note-add'));
    fireEvent.changeText(screen.getByTestId('note-input'), 'first note');
    fireEvent.press(screen.getByTestId('note-save'));

    await waitFor(() => {
      expect(lastNotePutBody()).toEqual({ body: 'first note', shareable: false });
    });
  });

  test('toggling "Share with friends" on forwards shareable=true on save', async () => {
    apiRequestMock.mockResolvedValueOnce(makeNote({ body: 'share me', shareable: true }));
    renderControl(null);

    fireEvent.press(screen.getByTestId('note-add'));
    fireEvent.changeText(screen.getByTestId('note-input'), 'share me');
    fireEvent(screen.getByTestId('note-shareable'), 'valueChange', true);
    fireEvent.press(screen.getByTestId('note-save'));

    await waitFor(() => {
      expect(lastNotePutBody()).toEqual({ body: 'share me', shareable: true });
    });
  });

  test('editing a shared Note seeds the toggle on, so saving keeps it shareable', async () => {
    apiRequestMock.mockResolvedValueOnce(makeNote({ body: 'still shared', shareable: true }));
    renderControl(makeNote({ body: 'already shared', shareable: true }));

    fireEvent.press(screen.getByTestId('note-edit'));
    // Change only the body; the toggle should already be on from the note.
    fireEvent.changeText(screen.getByTestId('note-input'), 'still shared');
    fireEvent.press(screen.getByTestId('note-save'));

    await waitFor(() => {
      expect(lastNotePutBody()).toEqual({ body: 'still shared', shareable: true });
    });
  });

  test('view mode reflects the persisted share state', () => {
    const { rerender } = renderControl(makeNote({ shareable: true }));
    expect(screen.getByTestId('note-share-status')).toHaveTextContent(
      'Shared with friends',
    );

    rerender(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <NoteControl
          experienceId={EXPERIENCE_ID}
          note={makeNote({ shareable: false })}
          onMutated={jest.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('note-share-status')).toHaveTextContent(
      'Private — only you can see this',
    );
  });

  // Feature: dark-mode — (c) the note editor's TextInput and copy (B2)
  describe('dark mode', () => {
    afterEach(resetTestScheme);

    const flat = (node: ReactTestInstance): Record<string, unknown> =>
      (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;

    test('(c) the editor input gets dark field colours, a dark placeholder and a dark keyboard', () => {
      setTestScheme('dark');
      renderControl(null);
      fireEvent.press(screen.getByTestId('note-add'));

      const input = screen.getByTestId('note-input');
      const style = flat(input);
      expect(style.backgroundColor).toBe(darkTheme.color.surfaceAlt);
      expect(style.borderColor).toBe(darkTheme.color.border);
      expect(style.color).toBe(darkTheme.color.textPrimary);
      expect(input.props.placeholderTextColor).toBe(darkTheme.color.textSecondary);
      expect(input.props.keyboardAppearance).toBe('dark');
      expect(flat(screen.getByText('Share with friends')).color).toBe(darkTheme.color.textPrimary);
    });

    test('light keeps the platform default placeholder colour (light byte-identical)', () => {
      renderControl(null);
      fireEvent.press(screen.getByTestId('note-add'));

      const input = screen.getByTestId('note-input');
      expect(input.props.placeholderTextColor).toBeUndefined();
      expect(input.props.keyboardAppearance).toBe('light');
      expect(flat(input).backgroundColor).toBe('#efe9f7');
    });

    // Feature: dark-mode polish pass (Requirement 9.15, B2-4): the share Switch.
    const shareSwitch = (): ReactTestInstance =>
      screen.UNSAFE_getAllByType(Switch).find((s) => s.props.testID === 'note-shareable')!;

    test('dark: the share Switch gets token track/thumb colours, on stronger than off', () => {
      setTestScheme('dark');
      renderControl(null);
      fireEvent.press(screen.getByTestId('note-add'));

      expect(shareSwitch().props.trackColor).toEqual({
        false: darkTheme.color.borderStrong,
        true: darkTheme.color.primary,
      });
      expect(shareSwitch().props.ios_backgroundColor).toBe(darkTheme.color.borderStrong);
      expect(shareSwitch().props.thumbColor).toBe(darkTheme.color.textSecondary);

      fireEvent(screen.getByTestId('note-shareable'), 'valueChange', true);
      expect(shareSwitch().props.value).toBe(true);
      expect(shareSwitch().props.thumbColor).toBe(darkTheme.color.textOnPrimary);
    });

    test('light: the share Switch stays on platform defaults (no colour props)', () => {
      renderControl(null);
      fireEvent.press(screen.getByTestId('note-add'));
      expect(shareSwitch().props.trackColor).toBeUndefined();
      expect(shareSwitch().props.thumbColor).toBeUndefined();
      expect(shareSwitch().props.ios_backgroundColor).toBeUndefined();
    });

    test('a live dark→light switch remounts the Switch with platform defaults', () => {
      setTestScheme('dark');
      renderControl(null);
      fireEvent.press(screen.getByTestId('note-add'));
      const darkHost = screen.getByTestId('note-shareable');
      expect(shareSwitch().props.thumbColor).toBe(darkTheme.color.textSecondary);

      setTestScheme('light');
      const lightHost = screen.getByTestId('note-shareable');
      // `key={t.scheme}`: a new native view, so no dark colour is left stuck on Android.
      expect(lightHost).not.toBe(darkHost);
      expect(shareSwitch().props.thumbColor).toBeUndefined();
      expect(shareSwitch().props.trackColor).toBeUndefined();
    });
  });
});
