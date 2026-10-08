/**
 * Forgot password screen.
 *
 * Implements password reset initiation flow (Task 5.3, Requirements 5.2, 5.3):
 *   - Collects email address from user (pre-filled if passed from LoginScreen)
 *   - Submits POST /auth/forgot-password via apiRequest
 *   - On success, navigates to ResetPasswordScreen with destination email
 *   - Follows theme and layout conventions (GradientHeader, Card, PrimaryButton)
 */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ForgotPasswordResponseDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { theme } from '../theme/theme';
import {
  Card,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../theme/components';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export default function ForgotPasswordScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const initialEmail = route.params?.email ?? '';
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function clearErrors(): void {
    setEmailError(null);
    setFormError(null);
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) {
      return;
    }
    clearErrors();

    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Email is required.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest<ForgotPasswordResponseDTO>(
        'POST',
        '/auth/forgot-password',
        { email: trimmed },
      );
      // Navigate to ResetPassword with the email
      navigation.navigate('ResetPassword', { email: trimmed });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'validation_failed' && err.field === 'email') {
          setEmailError('Please enter a valid email address.');
        } else {
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
            title="Reset Password"
            subtitle="Enter your email to receive a 6-digit code."
            icon="key-outline"
          />

          <View style={styles.body} testID="forgot-body">
            <Card>
              <View style={styles.field}>
                <Text style={styles.label}>Email Address</Text>
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
                  placeholderTextColor={theme.color.textSecondary}
                  editable={!submitting}
                  accessibilityLabel="Email Address"
                  testID="forgot-email"
                />
                {emailError !== null ? (
                  <Text style={styles.fieldError}>{emailError}</Text>
                ) : null}
              </View>

              {formError !== null ? (
                <Text style={styles.formError} testID="forgot-form-error">
                  {formError}
                </Text>
              ) : null}

              <PrimaryButton
                label="Send Code"
                icon="send-outline"
                loading={submitting}
                onPress={() => {
                  void handleSubmit();
                }}
                testID="forgot-submit"
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
              accessibilityLabel="Remember your password? Sign in"
              testID="forgot-go-login"
            >
              <Text style={styles.linkText}>
                Remember your password?{' '}
                <Text style={styles.linkTextEmphasis}>Sign in</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: theme.spacing.xxl },
  body: {
    paddingHorizontal: theme.spacing.xl,
    marginTop: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  field: {
    marginBottom: theme.spacing.lg,
  },
  label: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontSize: 16,
    color: theme.color.textPrimary,
    backgroundColor: theme.color.surfaceAlt,
  },
  inputError: {
    borderColor: theme.color.danger,
  },
  fieldError: {
    marginTop: theme.spacing.xs,
    color: theme.color.danger,
    fontSize: 13,
  },
  formError: {
    marginBottom: theme.spacing.md,
    color: theme.color.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  submit: {
    marginTop: theme.spacing.xs,
  },
  linkButton: {
    alignSelf: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  linkText: {
    ...theme.typography.body,
    color: theme.color.textSecondary,
  },
  linkTextEmphasis: {
    color: theme.color.primary,
    fontWeight: '600',
  },
});
