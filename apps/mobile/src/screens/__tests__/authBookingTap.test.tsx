/**
 * Tests for booking tap cancellation on auth failure and Forgot password (Task 11.12).
 *
 * Validates: Requirements 10.3, 10.8
 *
 * Requirements:
 * - A failed Login submit dispatches `authFailed` and clears the pending booking tap.
 * - Pressing "Forgot password?" in LoginScreen dispatches `authFailed` and clears the pending booking tap.
 * - A failed Register submit dispatches `authFailed` and clears the pending booking tap.
 * - A successful submit does NOT dispatch `authFailed` (unconditional-dispatch mistake guard).
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

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
import LoginScreen from '../LoginScreen';
import RegisterScreen from '../RegisterScreen';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import {
  dispatchBookingTapEvent,
  getBookingTapState,
  resetBookingTapStateForTest,
} from '../../navigation/bookingTapState';
import { useSessionStore } from '../../state/sessionStore';

const Stack = createNativeStackNavigator<AuthStackParamList>();

const DummyForgotPassword = () => null;

function renderLogin() {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="ForgotPassword" component={DummyForgotPassword} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

function renderRegister() {
  return render(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Register" component={RegisterScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

const TRIP_ID = '12345678-1234-4234-8234-123456789abc';

describe('Auth screens fire authFailed (Task 11.12, Requirements 10.3, 10.8)', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    resetBookingTapStateForTest();
    useSessionStore.setState({ token: null, hydrated: true });
  });

  afterEach(() => {
    resetBookingTapStateForTest();
  });

  test('failed Login submit dispatches authFailed and clears pending booking tap', async () => {
    // 1. Establish a pending booking tap in the store
    dispatchBookingTapEvent({ type: 'tap', tripId: TRIP_ID });
    expect(getBookingTapState().pending).toEqual({ tripId: TRIP_ID });

    // 2. Reject login attempt
    mockApiRequest.mockRejectedValue(
      new ApiError({
        code: 'invalid_credentials',
        message: 'Email or password is incorrect.',
        status: 401,
      }),
    );

    renderLogin();

    fireEvent.changeText(screen.getByTestId('login-email'), 'guest@example.com');
    fireEvent.changeText(screen.getByTestId('login-password'), 'wrong-password');
    fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('login-form-error')).toBeTruthy();
    });

    // 3. Pending booking tap must be cleared
    expect(getBookingTapState().pending).toBeNull();
  });

  test('pressing "Forgot password?" dispatches authFailed and clears pending booking tap', async () => {
    dispatchBookingTapEvent({ type: 'tap', tripId: TRIP_ID });
    expect(getBookingTapState().pending).toEqual({ tripId: TRIP_ID });

    renderLogin();

    fireEvent.press(screen.getByTestId('login-forgot-password'));

    // Pressing forgot password must immediately clear the pending booking tap
    expect(getBookingTapState().pending).toBeNull();
  });

  test('failed Register submit dispatches authFailed and clears pending booking tap', async () => {
    dispatchBookingTapEvent({ type: 'tap', tripId: TRIP_ID });
    expect(getBookingTapState().pending).toEqual({ tripId: TRIP_ID });

    mockApiRequest.mockRejectedValue(
      new ApiError({
        code: 'email_in_use',
        message: 'An account with that email already exists.',
        status: 409,
      }),
    );

    renderRegister();

    fireEvent.changeText(screen.getByTestId('register-email'), 'existing@example.com');
    fireEvent.changeText(screen.getByTestId('register-display-name'), 'Existing User');
    fireEvent.changeText(screen.getByTestId('register-password'), 'valid-password-123');
    fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText('An account with that email already exists.')).toBeTruthy();
    });

    expect(getBookingTapState().pending).toBeNull();
  });

  test('successful Login submit does NOT dispatch authFailed (unconditional-dispatch mistake guard)', async () => {
    dispatchBookingTapEvent({ type: 'tap', tripId: TRIP_ID });
    expect(getBookingTapState().pending).toEqual({ tripId: TRIP_ID });

    mockApiRequest.mockResolvedValue({
      user: { id: 'u1', email: 'guest@example.com' },
      profile: { displayName: 'Guest' },
      token: 'jwt-auth-token',
    });

    renderLogin();

    fireEvent.changeText(screen.getByTestId('login-email'), 'guest@example.com');
    fireEvent.changeText(screen.getByTestId('login-password'), 'correct-password');
    fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
    });

    // Successful submit must NOT clear pending booking tap via authFailed!
    // (It is cleared only when delivered/navigated by useNotificationResponse)
    expect(getBookingTapState().pending).toEqual({ tripId: TRIP_ID });
  });

  test('successful Register submit does NOT dispatch authFailed (unconditional-dispatch mistake guard)', async () => {
    dispatchBookingTapEvent({ type: 'tap', tripId: TRIP_ID });
    expect(getBookingTapState().pending).toEqual({ tripId: TRIP_ID });

    mockApiRequest.mockResolvedValue({
      user: { id: 'u2', email: 'new@example.com' },
      profile: { displayName: 'New User' },
      token: 'jwt-auth-token-2',
    });

    renderRegister();

    fireEvent.changeText(screen.getByTestId('register-email'), 'new@example.com');
    fireEvent.changeText(screen.getByTestId('register-display-name'), 'New User');
    fireEvent.changeText(screen.getByTestId('register-password'), 'valid-password-123');
    fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
    });

    expect(getBookingTapState().pending).toEqual({ tripId: TRIP_ID });
  });
});
