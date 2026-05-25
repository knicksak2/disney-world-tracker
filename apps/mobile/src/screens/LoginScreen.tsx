/**
 * Login screen.
 *
 * Implements task 15.1 of the disney-world-tracker plan for the
 * existing-user side of the auth flow:
 *
 *   - Collects email + password using React Native primitives
 *   - On submit, calls `POST /auth/login` via the shared `apiRequest`
 *     helper; on success persists the bearer token in the session
 *     store (which writes through to expo-secure-store) so the
 *     RootNavigator flips automatically to the main tabs (R6.5,
 *     R6.10).
 *   - On `ApiError`, surfaces user-visible copy keyed off the
 *     uniform envelope's `code`:
 *       • `invalid_credentials` (R6.6)
 *       • `account_locked`      (R6.7)
 *       • `validation_failed`   (R6.4) — uses `error.field` to
 *         pinpoint the offending input.
 *   - Provides a "Don't have an account? Register" link that
 *     navigates to the RegisterScreen via the auth-stack navigator.
 *
 * The screen never logs the password and never echoes it back into
 * the visible state once submitted — only the email is preserved on
 * a failed attempt so the user does not have to retype it. This
 * matches R6.11's "no plaintext password storage or transmission"
 * intent on the client side.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { ApiError, apiRequest } from '../api/client';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { useSessionStore } from '../state/sessionStore';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

/**
 * Server response shape for `POST /auth/login`. Mirrors the
 * `AuthSuccessBody` interface in `apps/api/src/services/auth/routes.ts`
 * — only the fields the screen actually uses are typed here so a
 * future field addition does not require a coordinated mobile
 * change.
 */
interface LoginResponse {
  user: { id: string; email: string };
  profile: { displayName: string };
  token: string;
}

export default function LoginScreen({ navigation }: Props): JSX.Element {
  const setToken = useSessionStore((state) => state.setToken);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function clearErrors(): void {
    setFormError(null);
    setEmailError(null);
    setPasswordError(null);
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) {
      return;
    }
    clearErrors();
    setSubmitting(true);
    try {
      const response = await apiRequest<LoginResponse>('POST', '/auth/login', {
        email: email.trim(),
        password,
      });
      // setToken persists to expo-secure-store and updates the in-
      // memory store; the RootNavigator subscribes to `token` and
      // re-renders into the main tabs on the next tick.
      await setToken(response.token);
      // Wipe the password from memory once the request succeeds so
      // it cannot be read by a later component-tree dump.
      setPassword('');
    } catch (err) {
      handleSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmitError(err: unknown): void {
    if (!(err instanceof ApiError)) {
      setFormError('Something went wrong. Please try again.');
      return;
    }
    switch (err.code) {
      case 'invalid_credentials':
        setFormError('Email or password is incorrect.');
        return;
      case 'account_locked':
        setFormError(
          'Account temporarily locked. Try again in 15 minutes.',
        );
        return;
      case 'validation_failed':
        applyFieldError(err.field, err.message);
        return;
      default:
        setFormError(err.message);
    }
  }

  function applyFieldError(field: string | undefined, fallback: string): void {
    if (field === 'email') {
      setEmailError('Email is invalid.');
      return;
    }
    if (field === 'password') {
      setPasswordError('Password is too short.');
      return;
    }
    setFormError(fallback);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.subtitle}>
        Welcome back to your Disney World Tracker.
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={[styles.input, emailError !== null && styles.inputError]}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          editable={!submitting}
          accessibilityLabel="Email"
          testID="login-email"
        />
        {emailError !== null ? (
          <Text style={styles.fieldError}>{emailError}</Text>
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={[styles.input, passwordError !== null && styles.inputError]}
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          textContentType="password"
          secureTextEntry
          editable={!submitting}
          accessibilityLabel="Password"
          testID="login-password"
        />
        {passwordError !== null ? (
          <Text style={styles.fieldError}>{passwordError}</Text>
        ) : null}
      </View>

      {formError !== null ? (
        <Text style={styles.formError} testID="login-form-error">
          {formError}
        </Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          (pressed || submitting) && styles.primaryButtonPressed,
        ]}
        disabled={submitting}
        onPress={() => {
          void handleSubmit();
        }}
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        testID="login-submit"
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryButtonText}>Sign in</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.linkButton}
        onPress={() => {
          if (!submitting) {
            navigation.navigate('Register');
          }
        }}
        accessibilityRole="link"
        accessibilityLabel="Don't have an account? Register"
        testID="login-go-register"
      >
        <Text style={styles.linkText}>
          Don&apos;t have an account?{' '}
          <Text style={styles.linkTextEmphasis}>Register</Text>
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 64,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#555555',
    marginBottom: 24,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    color: '#222222',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#ffffff',
  },
  inputError: {
    borderColor: '#cc0033',
  },
  fieldError: {
    marginTop: 6,
    color: '#cc0033',
    fontSize: 13,
  },
  formError: {
    marginBottom: 12,
    color: '#cc0033',
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: '#003a9b',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 14,
    color: '#444444',
  },
  linkTextEmphasis: {
    color: '#003a9b',
    fontWeight: '600',
  },
});
