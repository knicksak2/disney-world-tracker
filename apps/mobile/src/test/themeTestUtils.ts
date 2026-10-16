// Feature: dark-mode — test helpers for driving the Active theme.
//
// Every test that calls `setTestScheme` registers `afterEach(resetTestScheme)`:
// Zustand state persists within a test file's module registry.

import { act } from '@testing-library/react-native';

import { useThemeStore } from '../state/themeStore';

type MaybeMock = { mockReturnValue?: (value: unknown) => unknown } | undefined;

/**
 * The descriptor-copy mock replaces `react-native`'s lazy `useColorScheme`
 * getter with a plain data property holding a `jest.fn()`. Detect exactly
 * that, so a file that forgot the mock fails loudly instead of silently
 * asserting against the preset's fixed `'light'`.
 */
function osSchemeMock(): MaybeMock {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rn: object = require('react-native');
  const descriptor = Object.getOwnPropertyDescriptor(rn, 'useColorScheme');
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  return descriptor.value as MaybeMock;
}

/** Pins the Appearance preference to `s` (re-renders subscribed components). */
export function setTestScheme(s: 'light' | 'dark'): void {
  act(() => {
    useThemeStore.setState({ preference: s });
  });
}

/**
 * Restores the store default (`'system'`, not hydrated) and, when the
 * descriptor-copy `useColorScheme` mock is installed, its `'light'` default.
 */
export function resetTestScheme(): void {
  act(() => {
    useThemeStore.setState({ preference: 'system', hydrated: false });
  });
  const mock = osSchemeMock();
  if (typeof mock?.mockReturnValue === 'function') {
    mock.mockReturnValue('light');
  }
}

/**
 * Sets the mocked OS scheme. Requires the file to have installed the
 * descriptor-copy `react-native` mock from `theme/__tests__/useActiveTheme.test.tsx`.
 * A changed return value notifies no subscriber, so call it before the first
 * render, or follow it with `rerender(...)` or a store change.
 */
export function setTestOsScheme(s: 'light' | 'dark' | null): void {
  const mock = osSchemeMock();
  if (typeof mock?.mockReturnValue !== 'function') {
    throw new Error(
      'setTestOsScheme: mock react-native useColorScheme first (see useActiveTheme.test.tsx)',
    );
  }
  mock.mockReturnValue(s);
}
