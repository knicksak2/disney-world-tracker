/**
 * Tests for `theme/useActiveTheme.ts`.
 *
 * Mocks `react-native`'s `useColorScheme` per design.md's specified intent:
 * preserve every other real RN export via `jest.requireActual` and override
 * only `useColorScheme`. design.md's literal form
 * (`{ ...jest.requireActual('react-native'), useColorScheme: jest.fn() }`)
 * cannot be used as written against the installed `react-native@0.85.3`:
 * that module's `index.js` defines every export as a lazy getter (`get
 * DevMenu() { return require(...) }`, etc.), and object-spread reads (and
 * thus eagerly invokes) every one of those getters — including `DevMenu`,
 * which throws (`TurboModuleRegistry.getEnforcing(...): 'DevMenu' could not
 * be found`) outside a real native runtime, crashing the whole test file.
 * `Object.getOwnPropertyDescriptors` copies the getter *functions*
 * themselves without invoking them, so every other export stays exactly as
 * lazy as it is in the real module, and only `useColorScheme`'s descriptor
 * is replaced — the same end state design.md's pattern intends (nothing
 * else shadowed), reached by a form that actually runs.
 *
 * Validates: Requirements 1.3, 1.4, 2.1, 2.2
 */

// `useActiveTheme.ts` imports `state/themeStore.ts`, which imports
// `theme/appearanceStorage.ts`, which imports
// `@react-native-async-storage/async-storage` — stub it with the package's
// own shipped jest mock so the module graph resolves without needing a
// native module (this test drives the store directly via `setState` and
// never exercises persistence).
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(actual);
  descriptors.useColorScheme = {
    value: jest.fn(),
    writable: true,
    enumerable: true,
    configurable: true,
  };
  return Object.defineProperties({}, descriptors);
});

import React from 'react';
import { Text } from 'react-native';
import { render, screen, act } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';

import { useActiveTheme } from '../useActiveTheme';
import { useThemeStore } from '../../state/themeStore';
import { DEFAULT_APPEARANCE_PREFERENCE } from '../appearance';

const mockUseColorScheme = useColorScheme as jest.Mock;

function HostComponent(): JSX.Element {
  const activeTheme = useActiveTheme();
  return <Text testID="active-theme">{activeTheme}</Text>;
}

describe('useActiveTheme', () => {
  beforeEach(() => {
    useThemeStore.setState({ preference: DEFAULT_APPEARANCE_PREFERENCE, hydrated: false });
    mockUseColorScheme.mockReset();
  });

  it("tracks the OS scheme when preference is 'system' (Requirement 1.3)", () => {
    useThemeStore.setState({ preference: 'system' });
    mockUseColorScheme.mockReturnValue('dark');

    render(<HostComponent />);

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
  });

  it("reacts live to a simulated OS scheme change while preference is 'system' (Requirement 2.1)", () => {
    useThemeStore.setState({ preference: 'system' });
    mockUseColorScheme.mockReturnValue('light');

    const view = render(<HostComponent />);
    expect(screen.getByTestId('active-theme')).toHaveTextContent('light');

    // Simulate the OS scheme changing while the App is foregrounded: the
    // mock's return value changes and the host component re-renders (the
    // real `useColorScheme` would trigger this re-render itself via its own
    // `useSyncExternalStore` subscription — not replicated by this mock, so
    // the re-render is driven explicitly here, per design.md's Testing
    // Strategy note).
    act(() => {
      mockUseColorScheme.mockReturnValue('dark');
      view.rerender(<HostComponent />);
    });

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
  });

  it("stays pinned to 'light' while preference is 'light', regardless of OS scheme (Requirement 2.2)", () => {
    useThemeStore.setState({ preference: 'light' });
    mockUseColorScheme.mockReturnValue('dark');

    render(<HostComponent />);
    expect(screen.getByTestId('active-theme')).toHaveTextContent('light');

    act(() => {
      mockUseColorScheme.mockReturnValue('light');
      useThemeStore.setState({ preference: 'light' });
    });

    expect(screen.getByTestId('active-theme')).toHaveTextContent('light');
  });

  it("stays pinned to 'dark' while preference is 'dark', regardless of OS scheme (Requirement 2.2)", () => {
    useThemeStore.setState({ preference: 'dark' });
    mockUseColorScheme.mockReturnValue('light');

    render(<HostComponent />);
    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');

    act(() => {
      mockUseColorScheme.mockReturnValue('dark');
      useThemeStore.setState({ preference: 'dark' });
    });

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
  });

  it('updates when only the preference changes (OS scheme held constant)', () => {
    useThemeStore.setState({ preference: 'system' });
    mockUseColorScheme.mockReturnValue('light');

    render(<HostComponent />);
    expect(screen.getByTestId('active-theme')).toHaveTextContent('light');

    act(() => {
      useThemeStore.setState({ preference: 'dark' });
    });

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
  });
});
