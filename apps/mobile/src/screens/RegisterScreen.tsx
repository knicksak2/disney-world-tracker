/**
 * Register screen.
 *
 * Implements task 15.1 of the disney-world-tracker plan for the
 * new-user side of the auth flow:
 *
 *   - Collects email, display name, and password using React Native
 *     primitives.
 *   - Runs client-side validation against the shared
 *     `registerInputSchema` from `@dwt/shared` so the rules cannot
 *     drift from the backend's Zod parser. `safeParse` lets us turn
 *     individual issues into per-field error copy without throwing.
 *   - On success, calls `POST /auth/register` via the shared
 *     `apiRequest` helper. The response carries `{ user, profile,
 *     token }`; the token is persisted via the session store so the
 *     RootNavigator flips automatically to the main tabs (R6.1,
 *     R6.5, R6.10).
 *   - On `ApiError`, surfaces user-visible copy keyed off the
 *     uniform envelope's `code`:
 *       • `email_in_use`         (R6.3)
 *       • `display_name_invalid` (R7.6)
 *       • `validation_failed`    (R6.4) — uses `error.field` to
 *         pinpoint the offending input.
 *
 * The screen never logs the password and clears it from local state
 * on a successful submit so it cannot be read back from a later
 * component-tree dump (R6.11).
 *
 * Styling: mirrors LoginScreen against the shared "Magical / Whimsical"
 * theme — a gradient hero header, an elevated card holding the form,
 * and the themed PrimaryButton. See `theme/theme.ts` and
 * `theme/components.tsx`.
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
import { Ionicons } from '@expo/vector-icons';

import { registerInputSchema } from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { useSessionStore } from '../state/sessionStore';
import { theme } from '../theme/theme';
import {
  Card,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../theme/components';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

/**
 * Server response shape for `POST /auth/register`. Mirrors the
 * `AuthSuccessBody` interface in `apps/api/src/services/auth/routes.ts`.
 */
interface RegisterResponse {
  user: { id: string; email: string };
  profile: { displayName: string };
  token: string;
}

/**
 * Per-field error copy used by both the client-side validator and
 * the server-side `validation_failed` mapper. Centralizing the
 * copy here keeps the two paths consistent.
 */
const FIELD_COPY: Record<'email' | 'displayName' | 'password', string> = {
  email: 'Email is invalid.',
  displayName:
    'Display name must be 1-50 characters with at least one non-whitespace character.',
  password: 'Password must be 8 to 128 characters.',
};

interface FieldErrors {
  email: string | null;
  displayName: string | null;
  password: string | null;
}

const NO_FIELD_ERRORS: FieldErrors = {
  email: null,
  displayName: null,
  password: null,
};

export default function RegisterScreen({ navigation }: Props): JSX.Element {
  const setToken = useSessionStore((state) => state.setToken);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_FIELD_ERRORS);

  function clearErrors(): void {
    setFormError(null);
    setFieldErrors(NO_FIELD_ERRORS);
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) {
      return;
    }
    clearErrors();

    // Client-side validation via the shared Zod schema. We trim
    // email and displayName before parsing because the shared
    // schema's primitive forms do the same: this keeps the client
    // and server in lockstep and prevents a server-rejected
    // "  Alice  " payload from being indistinguishable from a UI bug.
    const parsed = registerInputSchema.safeParse({
      email: email.trim(),
      displayName: displayName.trim(),
      password,
    });

    if (!parsed.success) {
      setFieldErrors(zodErrorsToFieldErrors(parsed.error.issues));
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiRequest<RegisterResponse>(
        'POST',
        '/auth/register',
        parsed.data,
      );
      await setToken(response.token);
      // R6.11 hygiene: clear the plaintext password from memory once
      // it is no longer needed.
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
      case 'email_in_use':
        setFieldErrors({
          ...NO_FIELD_ERRORS,
          email: 'An account with that email already exists.',
        });
        return;
      case 'display_name_invalid':
        setFieldErrors({
          ...NO_FIELD_ERRORS,
          displayName: FIELD_COPY.displayName,
        });
        return;
      case 'validation_failed':
        setFieldErrors(applyServerFieldError(err.field, err.message));
        return;
      default:
        setFormError(err.message);
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
            title="Create your account"
            subtitle="Track your visits, ratings, and notes across every Park."
            icon="sparkles"
          />

          <View style={styles.body}>
            <Card>
              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={[
                    styles.input,
                    fieldErrors.email !== null && styles.inputError,
                  ]}
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
                  accessibilityLabel="Email"
                  testID="register-email"
                />
                {fieldErrors.email !== null ? (
                  <Text style={styles.fieldError}>{fieldErrors.email}</Text>
                ) : null}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Display name</Text>
                <TextInput
                  style={[
                    styles.input,
                    fieldErrors.displayName !== null && styles.inputError,
                  ]}
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  autoComplete="name"
                  textContentType="name"
                  maxLength={50}
                  placeholder="Your name"
                  placeholderTextColor={theme.color.textSecondary}
                  editable={!submitting}
                  accessibilityLabel="Display name"
                  testID="register-display-name"
                />
                {fieldErrors.displayName !== null ? (
                  <Text style={styles.fieldError}>
                    {fieldErrors.displayName}
                  </Text>
                ) : null}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.passwordInput,
                      fieldErrors.password !== null && styles.inputError,
                    ]}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password-new"
                    textContentType="newPassword"
                    secureTextEntry={!showPassword}
                    placeholder="Choose a password"
                    placeholderTextColor={theme.color.textSecondary}
                    editable={!submitting}
                    accessibilityLabel="Password"
                    testID="register-password"
                  />
                  <Pressable
                    style={styles.passwordToggle}
                    onPress={() => setShowPassword((prev) => !prev)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    hitSlop={8}
                    testID="register-password-toggle"
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={22}
                      color={theme.color.textSecondary}
                    />
                  </Pressable>
                </View>
                {fieldErrors.password !== null ? (
                  <Text style={styles.fieldError}>{fieldErrors.password}</Text>
                ) : null}
              </View>

              {formError !== null ? (
                <Text style={styles.formError} testID="register-form-error">
                  {formError}
                </Text>
              ) : null}

              <PrimaryButton
                label="Create account"
                icon="person-add-outline"
                loading={submitting}
                onPress={() => {
                  void handleSubmit();
                }}
                testID="register-submit"
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
              accessibilityLabel="Already have an account? Sign in"
              testID="register-go-login"
            >
              <Text style={styles.linkText}>
                Already have an account?{' '}
                <Text style={styles.linkTextEmphasis}>Sign in</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Translate a list of Zod issues into per-field error copy. Only
 * the first issue per field is surfaced — the input forms are flat
 * and shallow nested issues do not exist for the registration
 * schema.
 *
 * Input from `safeParse` is a `ZodIssue[]` but we type it loosely
 * here to avoid pulling Zod's issue types into the screen module.
 */
function zodErrorsToFieldErrors(
  issues: ReadonlyArray<{ path: PropertyKey[] }>,
): FieldErrors {
  const next: FieldErrors = { ...NO_FIELD_ERRORS };
  for (const issue of issues) {
    const key = issue.path[0];
    if (key === 'email' && next.email === null) {
      next.email = FIELD_COPY.email;
    } else if (key === 'displayName' && next.displayName === null) {
      next.displayName = FIELD_COPY.displayName;
    } else if (key === 'password' && next.password === null) {
      next.password = FIELD_COPY.password;
    }
  }
  return next;
}

/**
 * Translate a server-side `validation_failed` envelope into the
 * matching per-field error copy. Falls back to a generic field-less
 * error when the server does not pinpoint a field (which the
 * registration handler always does, but the helper stays defensive).
 */
function applyServerFieldError(
  field: string | undefined,
  fallback: string,
): FieldErrors {
  switch (field) {
    case 'email':
      return { ...NO_FIELD_ERRORS, email: FIELD_COPY.email };
    case 'displayName':
      return { ...NO_FIELD_ERRORS, displayName: FIELD_COPY.displayName };
    case 'password':
      return { ...NO_FIELD_ERRORS, password: FIELD_COPY.password };
    default:
      return { ...NO_FIELD_ERRORS, email: fallback };
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: theme.spacing.xxl },
  body: {
    paddingHorizontal: theme.spacing.xl,
    marginTop: -theme.spacing.lg,
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
  passwordRow: {
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: theme.spacing.xl + theme.spacing.lg,
  },
  passwordToggle: {
    position: 'absolute',
    right: theme.spacing.md,
    height: '100%',
    justifyContent: 'center',
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
  },
  submit: {
    marginTop: theme.spacing.xs,
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  linkText: {
    fontSize: 14,
    color: theme.color.textSecondary,
  },
  linkTextEmphasis: {
    color: theme.color.primary,
    fontWeight: '700',
  },
});
