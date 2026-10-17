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
 *
 * Styling: uses the shared "Magical / Whimsical" theme — a gradient
 * hero header, an elevated card holding the form, and the themed
 * PrimaryButton. See `theme/theme.ts` and `theme/components.tsx`.
 */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  Pressable,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { ApiError, apiRequest } from '../api/client';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { dispatchBookingTapEvent } from '../navigation/bookingTapState';
import { useSessionStore } from '../state/sessionStore';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
import {
  Card,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../theme/components';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

interface LoginResponse {
  user: { id: string; email: string };
  profile: { displayName: string };
  token: string;
}

export default function LoginScreen({ navigation }: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const setToken = useSessionStore((state) => state.setToken);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      await setToken(response.token);
      setPassword('');
    } catch (err) {
      handleSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmitError(err: unknown): void {
    dispatchBookingTapEvent({ type: 'authFailed' });
    if (!(err instanceof ApiError)) {
      setFormError('Something went wrong. Please try again.');
      return;
    }
    switch (err.code) {
      case 'invalid_credentials':
        setFormError('Email or password is incorrect.');
        return;
      case 'account_locked':
        setFormError('Account temporarily locked. Try again in 15 minutes.');
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
    <ScreenContainer>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <GradientHeader
            title="Welcome back"
            subtitle="Sign in to keep tracking the magic."
            icon="sparkles"
          />

          <View style={styles.body} testID="login-body">
            <Card>
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
                  placeholder="you@example.com"
                  placeholderTextColor={t.color.textSecondary}
                  keyboardAppearance={t.scheme}
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
                <View style={styles.passwordRow}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.passwordInput,
                      passwordError !== null && styles.inputError,
                    ]}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password"
                    textContentType="password"
                    secureTextEntry={!showPassword}
                    placeholder="Your password"
                    placeholderTextColor={t.color.textSecondary}
                    keyboardAppearance={t.scheme}
                    editable={!submitting}
                    accessibilityLabel="Password"
                    testID="login-password"
                  />
                  <Pressable
                    style={styles.passwordToggle}
                    onPress={() => setShowPassword((prev) => !prev)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    hitSlop={8}
                    testID="login-password-toggle"
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={22}
                      color={t.color.textSecondary}
                    />
                  </Pressable>
                </View>
                {passwordError !== null ? (
                  <Text style={styles.fieldError}>{passwordError}</Text>
                ) : null}
              </View>

              <Pressable
                style={styles.forgotPasswordButton}
                onPress={() => {
                  if (!submitting) {
                    dispatchBookingTapEvent({ type: 'authFailed' });
                    navigation.navigate(
                      'ForgotPassword',
                      email.trim() ? { email: email.trim() } : undefined,
                    );
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Forgot password?"
                testID="login-forgot-password"
              >
                <Text style={styles.forgotPasswordText}>Forgot password?</Text>
              </Pressable>

              {formError !== null ? (
                <Text style={styles.formError} testID="login-form-error">
                  {formError}
                </Text>
              ) : null}

              <PrimaryButton
                label="Sign in"
                icon="log-in-outline"
                loading={submitting}
                onPress={() => {
                  void handleSubmit();
                }}
                testID="login-submit"
                style={styles.submit}
              />
            </Card>

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
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: t.spacing.xxl },
  body: {
    paddingHorizontal: t.spacing.xl,
    marginTop: t.spacing.lg,
    gap: t.spacing.lg,
  },
  field: {
    marginBottom: t.spacing.lg,
  },
  label: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    marginBottom: t.spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
    fontSize: 16,
    color: t.color.textPrimary,
    backgroundColor: t.color.surfaceAlt,
  },
  inputError: {
    borderColor: t.color.danger,
  },
  passwordRow: {
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: t.spacing.xl + t.spacing.lg,
  },
  passwordToggle: {
    position: 'absolute',
    right: t.spacing.md,
    height: '100%',
    justifyContent: 'center',
  },
  fieldError: {
    marginTop: t.spacing.xs,
    color: t.color.danger,
    fontSize: 13,
  },
  formError: {
    marginBottom: t.spacing.md,
    color: t.color.danger,
    fontSize: 14,
  },
  submit: {
    marginTop: t.spacing.xs,
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginTop: -t.spacing.sm,
    marginBottom: t.spacing.md,
    paddingVertical: t.spacing.xs,
  },
  forgotPasswordText: {
    fontSize: 13,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: t.spacing.sm,
  },
  linkText: {
    fontSize: 14,
    color: t.color.textSecondary,
  },
  linkTextEmphasis: {
    color: t.color.primaryFg,
    fontWeight: '700',
  },
}));
