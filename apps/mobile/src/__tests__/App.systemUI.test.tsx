/**
 * Tests for `App.tsx`'s native window background wiring (dark-mode R6.5,
 * Property 3's extended chrome tuple): `App` must call
 * `expo-system-ui`'s `setBackgroundColorAsync` with the Active theme's root
 * background on mount, and again whenever the Active theme changes, so the
 * native area behind the Android gesture bar never shows the platform's
 * default white in Dark.
 *
 * Renders the real `App` component. Only the native module under assertion
 * (`expo-system-ui`), the navigator subtree (unrelated screens and their
 * network queries) and the push hooks (network + native notifications) are
 * mocked; the theme store, `useActiveTheme` and `deriveAppearanceChrome`
 * run for real.
 *
 * Validates: Requirements 6.5, 6.4
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import App from '../App';
import { useSessionStore } from '../state/sessionStore';
import { useThemeStore } from '../state/themeStore';
import { DARK_ROOT_BACKGROUND, LIGHT_ROOT_BACKGROUND } from '../theme/appearance';

const mockSetBackgroundColorAsync = jest.fn((_color: unknown) => Promise.resolve());

jest.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: (color: unknown) => mockSetBackgroundColorAsync(color),
}));
jest.mock('../navigation/RootNavigator', () => () => null);
jest.mock('../hooks/usePushRegistration', () => ({ usePushRegistration: () => undefined }));
jest.mock('../hooks/useNotificationResponse', () => ({
  useNotificationResponse: () => undefined,
}));

/** Pin the Appearance preference and keep storage hydration from overwriting it. */
function setPreference(preference: 'light' | 'dark'): void {
  useThemeStore.setState({ preference, loadFromStorage: async () => undefined });
}

beforeEach(() => {
  mockSetBackgroundColorAsync.mockReset();
  mockSetBackgroundColorAsync.mockImplementation(() => Promise.resolve());
  useSessionStore.setState({ loadFromStorage: async () => undefined });
});

describe('App native window background (expo-system-ui)', () => {
  it("sets the window background to Twilight '#120a1f' when the Active theme is dark", async () => {
    setPreference('dark');
    render(<App />);

    await waitFor(() => expect(mockSetBackgroundColorAsync).toHaveBeenCalledTimes(1));
    expect(mockSetBackgroundColorAsync).toHaveBeenLastCalledWith('#120a1f');
    expect(DARK_ROOT_BACKGROUND).toBe('#120a1f');
  });

  it("sets the window background to the light background '#f5f2fb' when the Active theme is light", async () => {
    setPreference('light');
    render(<App />);

    await waitFor(() => expect(mockSetBackgroundColorAsync).toHaveBeenCalledTimes(1));
    expect(mockSetBackgroundColorAsync).toHaveBeenLastCalledWith('#f5f2fb');
    expect(LIGHT_ROOT_BACKGROUND).toBe('#f5f2fb');
  });

  it('re-applies the new colour each time the theme store flips while App stays mounted', async () => {
    setPreference('light');
    render(<App />);
    await waitFor(() => expect(mockSetBackgroundColorAsync).toHaveBeenCalledTimes(1));
    expect(mockSetBackgroundColorAsync).toHaveBeenLastCalledWith('#f5f2fb');

    act(() => {
      useThemeStore.setState({ preference: 'dark' });
    });
    await waitFor(() => expect(mockSetBackgroundColorAsync).toHaveBeenCalledTimes(2));
    expect(mockSetBackgroundColorAsync).toHaveBeenLastCalledWith('#120a1f');

    act(() => {
      useThemeStore.setState({ preference: 'light' });
    });
    await waitFor(() => expect(mockSetBackgroundColorAsync).toHaveBeenCalledTimes(3));
    expect(mockSetBackgroundColorAsync).toHaveBeenLastCalledWith('#f5f2fb');
  });

  it('does not call it again on a re-render that leaves the Active theme unchanged', async () => {
    setPreference('dark');
    const { rerender } = render(<App />);
    await waitFor(() => expect(mockSetBackgroundColorAsync).toHaveBeenCalledTimes(1));

    rerender(<App />);
    act(() => {
      useThemeStore.setState({ preference: 'dark' });
    });
    expect(mockSetBackgroundColorAsync).toHaveBeenCalledTimes(1);
  });

  it('swallows a native rejection: App stays mounted and the failure is only logged', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure = new Error('native module unavailable');
    mockSetBackgroundColorAsync.mockImplementation(() => Promise.reject(failure));
    setPreference('dark');

    const { toJSON } = render(<App />);

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('expo-system-ui: setBackgroundColorAsync failed', failure),
    );
    expect(toJSON()).not.toBeNull();
    warn.mockRestore();
  });
});
