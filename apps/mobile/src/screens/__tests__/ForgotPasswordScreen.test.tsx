/**
 * Component tests for ForgotPasswordScreen and LoginScreen "Forgot password?" entry point.
 *
 * Validates: Requirements 5.1, 5.2, 5.3
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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

import LoginScreen from '../LoginScreen';
import ForgotPasswordScreen from '../ForgotPasswordScreen';
import type { AuthStackParamList } from '../../navigation/RootNavigator';

const Stack = createNativeStackNavigator<AuthStackParamList>();

describe('ForgotPasswordScreen & LoginScreen Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('displays "Forgot password?" on LoginScreen and navigates with entered email (R5.1, R5.2)', async () => {
    render(
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    // Enter email on LoginScreen
    const emailInput = screen.getByTestId('login-email');
    fireEvent.changeText(emailInput, 'donald@example.com');

    // Tap "Forgot password?"
    const forgotBtn = screen.getByTestId('login-forgot-password');
    expect(forgotBtn).toBeTruthy();
    fireEvent.press(forgotBtn);

    // Verify navigation to ForgotPasswordScreen with pre-filled email
    await waitFor(() => {
      expect(screen.getByText('Reset Password')).toBeTruthy();
      const prefilledInput = screen.getByTestId('forgot-email');
      expect(prefilledInput.props.value).toBe('donald@example.com');
    });
  });

  it('submits email and navigates to ResetPasswordScreen on success (R5.3, R5.4)', async () => {
    mockApiRequest.mockResolvedValueOnce({
      message: 'If an account exists with this email, a reset code has been sent.',
    });

    const mockNavigate = jest.fn();
    const navigation = { navigate: mockNavigate } as any;
    const route = { params: { email: 'goofy@example.com' } } as any;

    render(
      <NavigationContainer>
        <ForgotPasswordScreen navigation={navigation} route={route} />
      </NavigationContainer>,
    );

    // Verify initial render
    const emailInput = screen.getByTestId('forgot-email');
    expect(emailInput.props.value).toBe('goofy@example.com');

    // Tap Send Code
    const submitBtn = screen.getByTestId('forgot-submit');
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        'POST',
        '/auth/forgot-password',
        { email: 'goofy@example.com' },
      );
      expect(mockNavigate).toHaveBeenCalledWith('ResetPassword', {
        email: 'goofy@example.com',
      });
    });
  });

  it('validates empty email before submission (R5.3)', async () => {
    const mockNavigate = jest.fn();
    const navigation = { navigate: mockNavigate } as any;
    const route = { params: undefined } as any;

    render(
      <NavigationContainer>
        <ForgotPasswordScreen navigation={navigation} route={route} />
      </NavigationContainer>,
    );

    const submitBtn = screen.getByTestId('forgot-submit');
    fireEvent.press(submitBtn);

    expect(screen.getByText('Email is required.')).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });
});
