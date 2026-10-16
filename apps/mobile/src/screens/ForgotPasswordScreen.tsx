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
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ForgotPasswordResponseDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
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
  const styles = useStyles();
  const t = useAppTheme();
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
                  placeholderTextColor={t.color.textSecondary}
                  keyboardAppearance={t.scheme}
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
