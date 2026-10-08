/**
 * Component tests for ResetPasswordScreen.
 *
 * Validates: Requirements 5.4, 5.5, 5.6
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockSecureStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { apiBaseUrl: 'http://localhost:3000' },
    },
  },
}));

const mockApiRequest = jest.fn();
jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  };
});

import { ApiError } from '../../api/client';
import ResetPasswordScreen from '../ResetPasswordScreen';
import { useSessionStore } from '../../state/sessionStore';

describe('ResetPasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSecureStore.clear();
    useSessionStore.setState({ token: null });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders target email, inputs, and disabled resend timer with 60s cooldown (R5.4, R5.5)', () => {
    const navigation = { navigate: jest.fn() } as any;
    const route = { params: { email: 'mickey@example.com' } } as any;

    render(
      <NavigationContainer>
        <ResetPasswordScreen navigation={navigation} route={route} />
      </NavigationContainer>,
    );

    expect(screen.getByText('We sent a code to mickey@example.com')).toBeTruthy();
    expect(screen.getByTestId('reset-code')).toBeTruthy();
    expect(screen.getByTestId('reset-password')).toBeTruthy();
    expect(screen.getByTestId('reset-confirm-password')).toBeTruthy();

    // Resend button is initially disabled with countdown
    const resendBtn = screen.getByTestId('reset-resend');
    expect(resendBtn).toBeTruthy();
    expect(screen.getByText('Resend code in 60s')).toBeTruthy();

    // Fast-forward 60 seconds
    act(() => {
      jest.advanceTimersByTime(60000);
    });

    expect(screen.getByText('Resend code')).toBeTruthy();
  });

  it('resets password, stores returned session token, and establishes session (R5.6)', async () => {
    mockApiRequest.mockResolvedValueOnce({
      user: { id: 'u-1', email: 'mickey@example.com' },
      profile: { displayName: 'Mickey' },
      token: 'fresh-session-token-xyz',
    });

    const navigation = { navigate: jest.fn() } as any;
    const route = { params: { email: 'mickey@example.com' } } as any;

    render(
      <NavigationContainer>
        <ResetPasswordScreen navigation={navigation} route={route} />
      </NavigationContainer>,
    );

    // Enter 6-digit code
    fireEvent.changeText(screen.getByTestId('reset-code'), '123456');

    // Enter new password and confirmation
    fireEvent.changeText(screen.getByTestId('reset-password'), 'SuperSecurePassword99');
    fireEvent.changeText(screen.getByTestId('reset-confirm-password'), 'SuperSecurePassword99');

    // Submit
    fireEvent.press(screen.getByTestId('reset-submit'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/auth/reset-password',
        {
          email: 'mickey@example.com',
          code: '123456',
          newPassword: 'SuperSecurePassword99',
        },
      );
      // Session store token was updated
      expect(useSessionStore.getState().token).toBe('fresh-session-token-xyz');
    });
  });

  it('rejects mismatched password and confirmation before sending network request', async () => {
    const navigation = { navigate: jest.fn() } as any;
    const route = { params: { email: 'mickey@example.com' } } as any;

    render(
      <NavigationContainer>
        <ResetPasswordScreen navigation={navigation} route={route} />
      </NavigationContainer>,
    );

    fireEvent.changeText(screen.getByTestId('reset-code'), '123456');
    fireEvent.changeText(screen.getByTestId('reset-password'), 'SuperSecurePassword99');
    fireEvent.changeText(screen.getByTestId('reset-confirm-password'), 'DifferentPassword123');

    fireEvent.press(screen.getByTestId('reset-submit'));

    expect(screen.getByText('Passwords do not match.')).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it('surfaces invalid_code and too_many_attempts error responses from API', async () => {
    mockApiRequest.mockRejectedValueOnce(
      new ApiError({
        code: 'invalid_code',
        message: 'Invalid or expired verification code.',
        status: 400,
      }),
    );

    const navigation = { navigate: jest.fn() } as any;
    const route = { params: { email: 'mickey@example.com' } } as any;

    render(
      <NavigationContainer>
        <ResetPasswordScreen navigation={navigation} route={route} />
      </NavigationContainer>,
    );

    fireEvent.changeText(screen.getByTestId('reset-code'), '000000');
    fireEvent.changeText(screen.getByTestId('reset-password'), 'SuperSecurePassword99');
    fireEvent.changeText(screen.getByTestId('reset-confirm-password'), 'SuperSecurePassword99');

    fireEvent.press(screen.getByTestId('reset-submit'));

    await waitFor(() => {
      expect(screen.getByText('Invalid or expired verification code.')).toBeTruthy();
    });
  });
});
