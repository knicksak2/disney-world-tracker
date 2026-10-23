/**
 * Reset password screen.
 *
 * Implements password reset completion flow (Task 5.4, Requirements 5.4, 5.5, 5.6):
 *   - Displays target email address
 *   - Collects 6-digit numeric verification code
 *   - Collects new password and confirmation password with visibility toggle
 *   - Provides 60-second cooldown countdown timer for resending code
 *   - On success, stores returned session token in sessionStore for immediate login
 *   - Surfaces tailored errors for invalid_code, too_many_attempts, and validation failures
 */

import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type {
  ForgotPasswordResponseDTO,
  ResetPasswordSuccessDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { useSessionStore } from '../state/sessionStore';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
import {
  Card,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../theme/components';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

export default function ResetPasswordScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const email = route.params.email;
  const setToken = useSessionStore((state) => state.setToken);
  const setAccountRestoredNotice = useSessionStore(
    (state) => state.setAccountRestoredNotice,
  );

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(60);

  const [codeError, setCodeError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  function clearErrors(): void {
    setCodeError(null);
    setPasswordError(null);
    setConfirmPasswordError(null);
    setFormError(null);
    setInfoMessage(null);
  }

  async function handleResendCode(): Promise<void> {
    if (resendCooldown > 0 || resending) {
      return;
    }
    clearErrors();
    setResending(true);
    try {
      await apiRequest<ForgotPasswordResponseDTO>(
        'POST',
        '/auth/forgot-password',
        { email },
      );
      setResendCooldown(60);
      setInfoMessage('A new verification code has been sent to your email.');
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError('Failed to resend code. Please try again.');
      }
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) {
      return;
    }
    clearErrors();

    const trimmedCode = code.trim();
    if (!trimmedCode || trimmedCode.length !== 6 || !/^\d{6}$/.test(trimmedCode)) {
      setCodeError('Enter the 6-digit verification code.');
      return;
    }

    if (password.length < 8 || password.length > 128) {
      setPasswordError('Password must be between 8 and 128 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiRequest<ResetPasswordSuccessDTO>(
        'POST',
        '/auth/reset-password',
        {
          email,
          code: trimmedCode,
          newPassword: password,
        },
      );
      // Immediately set the fresh authenticated session token
      await setToken(response.token);
      // account-deletion R4.3 / R4.9: the reset cancelled a pending deletion.
      if (response.accountRestored === true) {
        setAccountRestoredNotice(true);
      }
      setPassword('');
      setConfirmPassword('');
      // Navigation to MainTabs happens automatically via RootNavigator token state
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.code) {
          case 'invalid_code':
            setCodeError('Invalid or expired verification code.');
            break;
          case 'too_many_attempts':
            setFormError('Too many failed attempts. Please request a new code.');
            break;
          case 'validation_failed':
            if (err.field === 'code') {
              setCodeError('Code must be exactly 6 digits.');
            } else if (err.field === 'newPassword') {
              setPasswordError('Password must be between 8 and 128 characters.');
            } else {
              setFormError(err.message);
            }
            break;
          default:
            setFormError(err.message);
        }
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
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
            title="Enter Verification Code"
            subtitle={`We sent a code to ${email}`}
            icon="shield-checkmark-outline"
          />

          <View style={styles.body} testID="reset-body">
            <Card>
              {/* 6-digit code */}
              <View style={styles.field}>
                <Text style={styles.label}>6-Digit Verification Code</Text>
                <TextInput
                  style={[styles.input, styles.codeInput, codeError !== null && styles.inputError]}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="123456"
                  placeholderTextColor={t.color.textSecondary}
                  keyboardAppearance={t.scheme}
                  editable={!submitting}
                  accessibilityLabel="Verification Code"
                  testID="reset-code"
                />
                {codeError !== null ? (
                  <Text style={styles.fieldError}>{codeError}</Text>
                ) : null}
              </View>

              {/* Resend code row */}
              <View style={styles.resendRow}>
                <Pressable
                  onPress={() => {
                    void handleResendCode();
                  }}
                  disabled={resendCooldown > 0 || resending || submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Resend code"
                  testID="reset-resend"
                >
                  <Text
                    style={[
                      styles.resendText,
                      (resendCooldown > 0 || resending || submitting) && styles.resendDisabled,
                    ]}
                  >
                    {resendCooldown > 0
                      ? `Resend code in ${resendCooldown}s`
                      : resending
                        ? 'Sending...'
                        : 'Resend code'}
                  </Text>
                </Pressable>
              </View>

              {/* New Password */}
              <View style={styles.field}>
                <Text style={styles.label}>New Password</Text>
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
                    autoComplete="password-new"
                    textContentType="newPassword"
                    secureTextEntry={!showPassword}
                    placeholder="At least 8 characters"
                    placeholderTextColor={t.color.textSecondary}
                    keyboardAppearance={t.scheme}
                    editable={!submitting}
                    accessibilityLabel="New Password"
                    testID="reset-password"
                  />
                  <Pressable
                    style={styles.passwordToggle}
                    onPress={() => setShowPassword((prev) => !prev)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    hitSlop={8}
                    testID="reset-password-toggle"
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

              {/* Confirm Password */}
              <View style={styles.field}>
                <Text style={styles.label}>Confirm New Password</Text>
                <TextInput
                  style={[
                    styles.input,
                    confirmPasswordError !== null && styles.inputError,
                  ]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password-new"
                  textContentType="newPassword"
                  secureTextEntry={!showPassword}
                  placeholder="Repeat your new password"
                  placeholderTextColor={t.color.textSecondary}
                  keyboardAppearance={t.scheme}
                  editable={!submitting}
                  accessibilityLabel="Confirm Password"
                  testID="reset-confirm-password"
                />
                {confirmPasswordError !== null ? (
                  <Text style={styles.fieldError}>{confirmPasswordError}</Text>
                ) : null}
              </View>

              {infoMessage !== null ? (
                <Text style={styles.infoMessage}>{infoMessage}</Text>
              ) : null}

              {formError !== null ? (
                <Text style={styles.formError} testID="reset-form-error">
                  {formError}
                </Text>
              ) : null}

              <PrimaryButton
                label="Reset Password"
                icon="checkmark-circle-outline"
                loading={submitting}
                onPress={() => {
                  void handleSubmit();
                }}
                testID="reset-submit"
                style={styles.submit}
              />
            </Card>

            <Pressable
              style={styles.linkButton}
              onPress={() => {
                if (!submitting) {
                  navigation.navigate('Login');
                }
              }}
              accessibilityRole="link"
              accessibilityLabel="Back to sign in"
              testID="reset-go-login"
            >
              <Text style={styles.linkText}>
                Back to <Text style={styles.linkTextEmphasis}>Sign in</Text>
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
  codeInput: {
    fontSize: 22,
    letterSpacing: 4,
    textAlign: 'center',
    fontWeight: '700',
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
  inputError: {
    borderColor: t.color.danger,
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
    textAlign: 'center',
  },
  infoMessage: {
    color: t.color.primaryFg,
    marginBottom: t.spacing.md,
    textAlign: 'center',
    fontSize: 13,
  },
  resendRow: {
    alignItems: 'flex-end',
    marginTop: -t.spacing.sm,
    marginBottom: t.spacing.lg,
  },
  resendText: {
    fontSize: 13,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  resendDisabled: {
    color: t.color.textSecondary,
    opacity: 0.6,
  },
  submit: {
    marginTop: t.spacing.xs,
  },
  linkButton: {
    alignSelf: 'center',
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
  },
  linkText: {
    ...t.typography.body,
    color: t.color.textSecondary,
  },
  linkTextEmphasis: {
    color: t.color.primaryFg,
    fontWeight: '600',
  },
}));
