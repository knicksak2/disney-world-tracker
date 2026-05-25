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
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { registerInputSchema } from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import type { AuthStackParamList } from '../navigation/RootNavigator';
import { useSessionStore } from '../state/sessionStore';

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
    <View style={styles.container}>
      <Text style={styles.title}>Create your account</Text>
      <Text style={styles.subtitle}>
        Track your visits, ratings, and notes across every Park.
      </Text>

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
          editable={!submitting}
          accessibilityLabel="Display name"
          testID="register-display-name"
        />
        {fieldErrors.displayName !== null ? (
          <Text style={styles.fieldError}>{fieldErrors.displayName}</Text>
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={[
            styles.input,
            fieldErrors.password !== null && styles.inputError,
          ]}
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password-new"
          textContentType="newPassword"
          secureTextEntry
          editable={!submitting}
          accessibilityLabel="Password"
          testID="register-password"
        />
        {fieldErrors.password !== null ? (
          <Text style={styles.fieldError}>{fieldErrors.password}</Text>
        ) : null}
      </View>

      {formError !== null ? (
        <Text style={styles.formError} testID="register-form-error">
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
        accessibilityLabel="Create account"
        testID="register-submit"
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryButtonText}>Create account</Text>
        )}
      </Pressable>

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
