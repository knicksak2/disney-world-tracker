// Feature: experience-activity-logging — LogVisitModal keyboard avoidance and notes visibility.
//
// Regression test: Verifies that soft keyboard does not block the notes field or submit buttons
// when typing in LogVisitModal.

import React from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet } from 'react-native';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;
const EXPERIENCE_ID = 'exp-log-keyboard';

async function renderModal(): Promise<void> {
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
  await waitFor(() => expect(screen.getByTestId('log-visit-modal')).toBeTruthy());
}

describe('LogVisitModal keyboard avoidance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation((method, path) => {
      if (method === 'GET' && path === '/me/trips') return Promise.resolve([]);
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('uses undefined behavior for KeyboardAvoidingView on Android to prevent jitter loops', async () => {
    const originalPlatform = Platform.OS;
    try {
      Platform.OS = 'android';
      await renderModal();
      const kav = screen.getByTestId('log-visit-keyboard-avoiding-view');
      expect(kav.props.behavior).toBeUndefined();
    } finally {
      Platform.OS = originalPlatform;
    }
  });

  test('on Android, soft keyboard dynamically applies bottom padding and clamps maxHeight so notes input is not blocked', async () => {
    const originalPlatform = Platform.OS;
    let keyboardShowCallback: ((e: unknown) => void) | undefined;
    let keyboardHideCallback: (() => void) | undefined;

    const addListenerSpy = jest.spyOn(Keyboard, 'addListener').mockImplementation((event, callback) => {
      if (event === 'keyboardDidShow') {
        keyboardShowCallback = callback as (e: unknown) => void;
      } else if (event === 'keyboardDidHide') {
        keyboardHideCallback = callback as () => void;
      }
      return { remove: jest.fn() } as any;
    });

    try {
      Platform.OS = 'android';
      await renderModal();

      const kav = screen.getByTestId('log-visit-keyboard-avoiding-view');
      expect(kav.props.behavior).toBeUndefined();

      // Initially no bottom padding
      const initialBackdropStyle = StyleSheet.flatten(kav.props.style);
      expect(initialBackdropStyle.paddingBottom).toBeFalsy();

      // Keyboard shows (320 height)
      act(() => {
        keyboardShowCallback?.({ endCoordinates: { height: 320, width: 400, screenX: 0, screenY: 480 } });
      });

      // Backdrop lifts container
      const activeBackdropStyle = StyleSheet.flatten(kav.props.style);
      expect(activeBackdropStyle.paddingBottom).toBe(320);

      // Sheet clamps maxHeight so content doesn't push off-screen or stay covered
      const sheet = screen.getByTestId('log-visit-modal');
      const sheetStyle = StyleSheet.flatten(sheet.props.style);
      expect(sheetStyle.maxHeight).toBeDefined();
      expect(typeof sheetStyle.maxHeight).toBe('number');
      expect(sheetStyle.maxHeight).toBeGreaterThan(0);

      // Notes input and action buttons remain rendered and accessible
      expect(screen.getByTestId('log-visit-note-input')).toBeTruthy();
      expect(screen.getByTestId('log-visit-submit')).toBeTruthy();

      // Keyboard hides
      act(() => {
        keyboardHideCallback?.();
      });
      const closedBackdropStyle = StyleSheet.flatten(kav.props.style);
      expect(closedBackdropStyle.paddingBottom).toBeFalsy();
    } finally {
      addListenerSpy.mockRestore();
      Platform.OS = originalPlatform;
    }
  });

  test('focusing note input triggers scroll to ensure visibility', async () => {
    const scrollToSpy = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});

    await renderModal();
    const noteInput = screen.getByTestId('log-visit-note-input');

    jest.useFakeTimers();
    try {
      fireEvent(noteInput, 'focus');
      act(() => {
        jest.runAllTimers();
      });
      expect(scrollToSpy).toHaveBeenCalledWith(
        expect.objectContaining({ y: 180, animated: true }),
      );
    } finally {
      jest.useRealTimers();
      scrollToSpy.mockRestore();
    }
  });
});
