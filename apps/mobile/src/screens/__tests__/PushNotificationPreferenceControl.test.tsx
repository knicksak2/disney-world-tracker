// Feature: social-sharing-loop, Task 19.2 — Share_Notification_Preference control tests
//
// Validates: Requirements 9.3, 9.6, 9.8
//
// Covers the three behaviors the control owns:
//   - R9.3: the toggle displays the stored `Share_Notification_Preference`
//     (GET /me/notification-preferences) and flipping it persists the new
//     value (PUT /me/notification-preferences).
//   - R9.6: when the OS Notification_Permission is revoked, the control
//     renders an "unavailable until re-granted" state — disabled and off,
//     regardless of the stored value — both on mount and again when the App
//     next becomes active (AppState 'active').
//   - R9.8: when the PUT cannot persist, the control retains the previously
//     persisted value (the cache is not mutated) and surfaces a message.

import React from 'react';
import { AppState } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks (declared before the module under test is imported).
// ---------------------------------------------------------------------------

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

// Mock only `getPermissionsAsync` from expo-notifications; the component reads
// `settings.granted` to decide whether the OS permission is present (R9.6).
jest.mock('expo-notifications', () => ({
  __esModule: true,
  getPermissionsAsync: jest.fn(),
}));

// Replace only `apiRequest`; keep the real `ApiError` so the component's
// error branch resolves against the genuine class.
jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import * as Notifications from 'expo-notifications';

import PushNotificationPreferenceControl from '../PushNotificationPreferenceControl';
import { ApiError, apiRequest as mockedApiRequest } from '../../api/client';

import type { NotificationPreferenceDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;
const getPermissionsMock = Notifications.getPermissionsAsync as jest.MockedFunction<
  typeof Notifications.getPermissionsAsync
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal `expo-notifications` permission response. The component only
 * reads `.granted`, so the remaining fields are stubbed to satisfy the type.
 */
function permission(granted: boolean): Notifications.NotificationPermissionsStatus {
  return {
    granted,
    status: granted ? 'granted' : 'denied',
    canAskAgain: true,
    expires: 'never',
  } as Notifications.NotificationPermissionsStatus;
}

/** Resolve `GET /me/notification-preferences` with the given stored value. */
function stubPreferenceGet(enabled: boolean): void {
  apiRequestMock.mockImplementation(async (method, path) => {
    if (method === 'GET' && path === '/me/notification-preferences') {
      return { pushNotificationsEnabled: enabled } as NotificationPreferenceDTO;
    }
    throw new Error(`Unexpected apiRequest ${method} ${path}`);
  });
}

/**
 * Capture the `AppState` 'change' listener the control registers so a test can
 * drive it to the foreground ('active') state and force a permission re-check.
 */
function captureAppStateListener(): () => (state: string) => void {
  let listener: ((state: string) => void) | undefined;
  const spy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((event, handler) => {
      if (event === 'change') {
        listener = handler as (state: string) => void;
      }
      return { remove: jest.fn() } as unknown as ReturnType<
        typeof AppState.addEventListener
      >;
    });
  // Track the spy so the caller can restore it via afterEach's restoreAllMocks.
  void spy;
  return () => {
    if (listener === undefined) {
      throw new Error('AppState change listener was never registered');
    }
    return listener;
  };
}

function renderControl(): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <PushNotificationPreferenceControl />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('PushNotificationPreferenceControl', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    getPermissionsMock.mockReset();
    // Default: OS permission granted so the control is available unless a
    // specific test overrides it.
    getPermissionsMock.mockResolvedValue(permission(true));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // R9.3 — display the stored preference and persist a change
  // -------------------------------------------------------------------------

  test('R9.3: renders the stored preference as the toggle value (enabled)', async () => {
    stubPreferenceGet(true);
    renderControl();

    const toggle = await screen.findByTestId('notification-preference-switch');
    await waitFor(() => {
      expect(toggle.props.value).toBe(true);
    });
    expect(toggle.props.disabled).toBeFalsy();
    expect(screen.queryByTestId('notification-preference-permission-revoked')).toBeNull();
  });

  test('R9.3: renders a disabled stored preference as an off toggle', async () => {
    stubPreferenceGet(false);
    renderControl();

    const toggle = await screen.findByTestId('notification-preference-switch');
    await waitFor(() => {
      expect(toggle.props.value).toBe(false);
    });
    expect(toggle.props.disabled).toBeFalsy();
  });

  test('R9.3: flipping the toggle persists the new value via PUT', async () => {
    // First the GET resolves enabled; the subsequent PUT echoes the new value.
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (method === 'GET' && path === '/me/notification-preferences') {
        return { pushNotificationsEnabled: true } as NotificationPreferenceDTO;
      }
      if (method === 'PUT' && path === '/me/notification-preferences') {
        return body as NotificationPreferenceDTO;
      }
      throw new Error(`Unexpected apiRequest ${method} ${path}`);
    });

    renderControl();
    const toggle = await screen.findByTestId('notification-preference-switch');
    await waitFor(() => expect(toggle.props.value).toBe(true));

    fireEvent(toggle, 'valueChange', false);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PUT',
        '/me/notification-preferences',
        { pushNotificationsEnabled: false },
      );
    });
    // The server-echoed value flows into the cache, so the toggle now reads off.
    await waitFor(() => {
      expect(
        screen.getByTestId('notification-preference-switch').props.value,
      ).toBe(false);
    });
    expect(screen.queryByTestId('notification-preference-save-error')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R9.6 — OS permission revoked
  // -------------------------------------------------------------------------

  test('R9.6: renders the unavailable state (disabled, off) when permission is revoked, regardless of stored value', async () => {
    // Stored value is enabled, but the OS permission is revoked.
    stubPreferenceGet(true);
    getPermissionsMock.mockResolvedValue(permission(false));

    renderControl();

    // The revoked message appears once the permission check resolves.
    await screen.findByTestId('notification-preference-permission-revoked');

    const toggle = screen.getByTestId('notification-preference-switch');
    // Off and disabled, never reflecting the stored `true`.
    expect(toggle.props.value).toBe(false);
    expect(toggle.props.disabled).toBe(true);
  });

  test('R9.6: re-checks permission on foreground and flips to the unavailable state', async () => {
    stubPreferenceGet(true);
    // Granted at mount, then revoked in system settings while backgrounded.
    getPermissionsMock
      .mockResolvedValueOnce(permission(true))
      .mockResolvedValue(permission(false));

    const getListener = captureAppStateListener();
    renderControl();

    // Initially available: no revoked message, toggle on and enabled.
    const toggle = await screen.findByTestId('notification-preference-switch');
    await waitFor(() => expect(toggle.props.value).toBe(true));
    expect(
      screen.queryByTestId('notification-preference-permission-revoked'),
    ).toBeNull();

    // App returns to the foreground → the control re-checks the permission.
    getListener()('active');

    await screen.findByTestId('notification-preference-permission-revoked');
    await waitFor(() => {
      const t = screen.getByTestId('notification-preference-switch');
      expect(t.props.value).toBe(false);
      expect(t.props.disabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // R9.8 — persist failure retains the previous value and shows a message
  // -------------------------------------------------------------------------

  test('R9.8: on persist failure retains the previous value and shows a message', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/me/notification-preferences') {
        return { pushNotificationsEnabled: true } as NotificationPreferenceDTO;
      }
      if (method === 'PUT' && path === '/me/notification-preferences') {
        throw new ApiError({
          code: 'internal_error',
          message: 'could not persist',
          status: 500,
        });
      }
      throw new Error(`Unexpected apiRequest ${method} ${path}`);
    });

    renderControl();
    const toggle = await screen.findByTestId('notification-preference-switch');
    await waitFor(() => expect(toggle.props.value).toBe(true));

    fireEvent(toggle, 'valueChange', false);

    // The failure message surfaces...
    await screen.findByTestId('notification-preference-save-error');
    // ...and the toggle retains the previously persisted value (still on).
    expect(
      screen.getByTestId('notification-preference-switch').props.value,
    ).toBe(true);
  });
});
