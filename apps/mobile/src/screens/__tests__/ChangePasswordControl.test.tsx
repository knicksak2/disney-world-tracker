// ChangePasswordControl tests (disney-world-tracker, change-password client surface).
//
// Validates: Requirements R6.13, R6.14, R6.15, R6.16 (client side)
//
// Covers the expand/collapse affordance, client-side validation (new vs.
// confirm mismatch and the shared 8-128 length rule), the happy-path
// `POST /auth/change-password` call shape, success collapse + confirmation,
// and the `invalid_credentials` / `validation_failed` error mappings.

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

// Replace only `apiRequest`; keep the real `ApiError` so the component's
// `err.code` branches resolve against the genuine class.
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

import ChangePasswordControl from '../ChangePasswordControl';
import { ApiError, apiRequest as mockedApiRequest } from '../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderControl(): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChangePasswordControl />
    </QueryClientProvider>,
  );
}

/** Expand the form and fill the three fields. */
function openAndFill(values: {
  current: string;
  next: string;
  confirm: string;
}): void {
  fireEvent.press(screen.getByTestId('change-password-open'));
  fireEvent.changeText(screen.getByTestId('change-password-current'), values.current);
  fireEvent.changeText(screen.getByTestId('change-password-new'), values.next);
  fireEvent.changeText(screen.getByTestId('change-password-confirm'), values.confirm);
}

const VALID_CURRENT = 'current-pass-1';
const VALID_NEW = 'brand-new-pass-2';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ChangePasswordControl', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  test('starts collapsed and expands to reveal the three fields', () => {
    renderControl();

    expect(screen.queryByTestId('change-password-current')).toBeNull();

    fireEvent.press(screen.getByTestId('change-password-open'));

    expect(screen.getByTestId('change-password-current')).toBeTruthy();
    expect(screen.getByTestId('change-password-new')).toBeTruthy();
    expect(screen.getByTestId('change-password-confirm')).toBeTruthy();
  });

  test('blocks submit and shows a mismatch message when the new entries differ', () => {
    renderControl();
    openAndFill({ current: VALID_CURRENT, next: VALID_NEW, confirm: 'different-pass-3' });

    fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(screen.getByTestId('change-password-error')).toHaveTextContent(
      'New passwords do not match.',
    );
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  test('blocks submit and shows the length message when the new password is too short', () => {
    renderControl();
    openAndFill({ current: VALID_CURRENT, next: 'short', confirm: 'short' });

    fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(screen.getByTestId('change-password-error')).toHaveTextContent(
      'Password must be 8 to 128 characters.',
    );
    expect(apiRequestMock).not.toHaveBeenCalled();
  });

  test('submits the correct call shape, then collapses and confirms on success', async () => {
    apiRequestMock.mockResolvedValueOnce(null);
    renderControl();
    openAndFill({ current: VALID_CURRENT, next: VALID_NEW, confirm: VALID_NEW });

    fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/auth/change-password', {
        currentPassword: VALID_CURRENT,
        newPassword: VALID_NEW,
      });
    });

    // Form collapses and the confirmation line appears.
    await waitFor(() => {
      expect(screen.getByTestId('change-password-success')).toBeTruthy();
    });
    expect(screen.queryByTestId('change-password-current')).toBeNull();
  });

  test('maps invalid_credentials to a "current password is incorrect" message', async () => {
    apiRequestMock.mockRejectedValueOnce(
      new ApiError({
        code: 'invalid_credentials',
        message: 'nope',
        status: 401,
      }),
    );
    renderControl();
    openAndFill({ current: 'wrong-pass-9', next: VALID_NEW, confirm: VALID_NEW });

    fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('change-password-error')).toHaveTextContent(
        'Current password is incorrect.',
      );
    });
    // Stays open so the user can correct the current password.
    expect(screen.getByTestId('change-password-current')).toBeTruthy();
  });

  test('maps validation_failed to the length message', async () => {
    apiRequestMock.mockRejectedValueOnce(
      new ApiError({
        code: 'validation_failed',
        message: 'bad',
        status: 400,
        field: 'newPassword',
      }),
    );
    renderControl();
    openAndFill({ current: VALID_CURRENT, next: VALID_NEW, confirm: VALID_NEW });

    fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('change-password-error')).toHaveTextContent(
        'Password must be 8 to 128 characters.',
      );
    });
  });
});
