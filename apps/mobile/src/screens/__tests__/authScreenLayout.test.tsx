/**
 * Unit tests verifying that LoginScreen and RegisterScreen layout bodies
 * sit cleanly below GradientHeader with standard positive spacing
 * instead of overlapping into the header with negative margins.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
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

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

import LoginScreen from '../LoginScreen';
import RegisterScreen from '../RegisterScreen';
import type { AuthStackParamList } from '../../navigation/RootNavigator';
import { darkTheme, theme } from '../../theme/theme';
import { ScreenContainer } from '../../theme/components';
import { resetTestScheme, setTestScheme } from '../../test/themeTestUtils';

const Stack = createNativeStackNavigator<AuthStackParamList>();

describe('Auth screens layout — non-overlapping header and card body', () => {
  it('renders LoginScreen body with positive marginTop so the card sits cleanly below the header without overlap', () => {
    render(
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Login" component={LoginScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    const body = screen.getByTestId('login-body');
    const flattened = StyleSheet.flatten(body.props.style);

    // Assert that the body does NOT tuck into the header with a negative margin,
    // which caused the header's decorative star to be cut in half and created
    // awkward scalloped purple corners on the sides.
    expect(flattened.marginTop).toBeGreaterThanOrEqual(0);
    expect(flattened.marginTop).toBe(theme.spacing.lg);
  });

  it('renders RegisterScreen body with positive marginTop so the card sits cleanly below the header without overlap', () => {
    render(
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Register" component={RegisterScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    const body = screen.getByTestId('register-body');
    const flattened = StyleSheet.flatten(body.props.style);

    expect(flattened.marginTop).toBeGreaterThanOrEqual(0);
    expect(flattened.marginTop).toBe(theme.spacing.lg);
  });
});

// Feature: dark-mode — B7: RegisterScreen had no dark render assertion.
describe('RegisterScreen (dark)', () => {
  afterEach(resetTestScheme);

  it('paints the root background, inputs and title from the dark theme', () => {
    setTestScheme('dark');
    render(
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Register" component={RegisterScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    const root = screen.UNSAFE_getAllByType(ScreenContainer)[0]!.children[0] as ReactTestInstance;
    expect(StyleSheet.flatten(root.props.style).backgroundColor).toBe(
      darkTheme.color.background,
    );
    expect(screen.getByTestId('register-email').props.keyboardAppearance).toBe('dark');
    expect(screen.getByTestId('register-password').props.keyboardAppearance).toBe('dark');
    // Field labels on the dark card use the muted textSecondary token.
    expect(StyleSheet.flatten(screen.getByText('Email').props.style).color).toBe(
      darkTheme.color.textSecondary,
    );
    // The header title sits on the gradient: white in both schemes.
    expect(StyleSheet.flatten(screen.getByText('Create your account').props.style).color).toBe(
      darkTheme.color.textOnPrimary,
    );
  });
});
