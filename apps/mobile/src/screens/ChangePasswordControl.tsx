// Feature: disney-world-tracker, Task 6.3.1 (client surface) — Change password
//
// Validates: Requirements R6.13, R6.14, R6.15, R6.16 (client side)
//
// Behavior summary:
//   - Renders a collapsed "Change password" affordance in the self-mode
//     Profile. Expanding it reveals a current-password, new-password, and
//     confirm-new-password form.
//   - Validates client-side against the shared `changePasswordInputSchema`
//     (both passwords 8-128 chars) and confirms the two new-password entries
//     match before any request leaves the device. The server applies the
//     same rule and is the source of truth (R6.15).
//   - Submits `POST /auth/change-password` with `{ currentPassword,
//     newPassword }`. The endpoint re-verifies the current password
//     (mismatch -> `invalid_credentials`, R6.14), rehashes the new password,
//     revokes the caller's *other* sessions, and returns 204 while keeping
//     this session valid (R6.16). On success the form clears and collapses
//     and a confirmation line is shown.
//   - The plaintext passwords are cleared from local state on success so they
//     cannot be read back from a later component-tree dump (R6.11 hygiene).

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';

import { changePasswordInputSchema } from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import { theme } from '../theme/theme';
import { PrimaryButton, SecondaryButton } from '../theme/components';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const PASSWORD_LENGTH_MESSAGE = 'Password must be 8 to 128 characters.';
const MISMATCH_MESSAGE = 'New passwords do not match.';
const CURRENT_WRONG_MESSAGE = 'Current password is incorrect.';
const SUCCESS_MESSAGE = 'Password updated. Other devices have been signed out.';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChangePasswordPayload {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/**
 * Self-contained change-password control for the signed-in user. Owns its own
 * open/closed state, field buffers, validation, and mutation so the parent
 * `ProfileScreen` only has to render `<ChangePasswordControl />` in its
 * self-mode block.
 */
export default function ChangePasswordControl(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation<void, ApiError, ChangePasswordPayload>({
    mutationFn: async (payload) => {
      await apiRequest<null>('POST', '/auth/change-password', payload);
    },
    onSuccess: () => {
      // R6.11 hygiene: drop the plaintext from memory once it is no longer
      // needed, then collapse and surface the confirmation.
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
      setSuccess(true);
      setIsOpen(false);
    },
    onError: (err) => {
      if (err.code === 'invalid_credentials') {
        setError(CURRENT_WRONG_MESSAGE);
        return;
      }
      if (err.code === 'validation_failed') {
        setError(PASSWORD_LENGTH_MESSAGE);
        return;
      }
      setError(err.message);
    },
  });

  const resetFields = (): void => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const handleOpen = (): void => {
    setSuccess(false);
    resetFields();
    setIsOpen(true);
  };

  const handleCancel = (): void => {
    resetFields();
    setIsOpen(false);
  };

  const handleSubmit = (): void => {
    if (newPassword !== confirmPassword) {
      setError(MISMATCH_MESSAGE);
      return;
    }
    // Client-side validation against the shared schema so the same 8-128
    // rule that runs server-side gates the request before bytes hit the
    // wire (R6.15).
    const parsed = changePasswordInputSchema.safeParse({
      currentPassword,
      newPassword,
    });
    if (!parsed.success) {
      setError(PASSWORD_LENGTH_MESSAGE);
      return;
    }
    mutation.mutate(parsed.data);
  };

  if (!isOpen) {
    return (
      <View style={styles.container}>
        <SecondaryButton
          label="Change password"
          icon="key-outline"
          onPress={handleOpen}
          testID="change-password-open"
        />
        {success ? (
          <Text style={styles.success} testID="change-password-success">
            {SUCCESS_MESSAGE}
          </Text>
        ) : null}
      </View>
    );
  }

  const busy = mutation.isPending;

  return (
    <View style={styles.editor}>
      <Text style={styles.label}>Current password</Text>
      <TextInput
        value={currentPassword}
        onChangeText={(value) => {
          setCurrentPassword(value);
          if (error !== null) setError(null);
        }}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password"
        textContentType="password"
        editable={!busy}
        placeholder="Current password"
        placeholderTextColor={theme.color.textSecondary}
        style={styles.input}
        accessibilityLabel="Current password"
        testID="change-password-current"
      />

      <Text style={styles.label}>New password</Text>
      <TextInput
        value={newPassword}
        onChangeText={(value) => {
          setNewPassword(value);
          if (error !== null) setError(null);
        }}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password-new"
        textContentType="newPassword"
        editable={!busy}
        placeholder="New password (8-128 characters)"
        placeholderTextColor={theme.color.textSecondary}
        style={styles.input}
        accessibilityLabel="New password"
        testID="change-password-new"
      />

      <Text style={styles.label}>Confirm new password</Text>
      <TextInput
        value={confirmPassword}
        onChangeText={(value) => {
          setConfirmPassword(value);
          if (error !== null) setError(null);
        }}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password-new"
        textContentType="newPassword"
        editable={!busy}
        placeholder="Re-enter new password"
        placeholderTextColor={theme.color.textSecondary}
        style={styles.input}
        accessibilityLabel="Confirm new password"
        testID="change-password-confirm"
      />

      {error !== null ? (
        <Text
          style={styles.error}
          accessibilityRole="alert"
          testID="change-password-error"
        >
          {error}
        </Text>
      ) : null}

      <View style={styles.row}>
        <PrimaryButton
          label="Update password"
          icon="checkmark-outline"
          loading={busy}
          onPress={handleSubmit}
          disabled={busy}
          style={styles.flexBtn}
          testID="change-password-submit"
        />
        <SecondaryButton
          label="Cancel"
          onPress={handleCancel}
          disabled={busy}
          style={styles.flexBtn}
          testID="change-password-cancel"
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.sm,
  },
  editor: {
    alignSelf: 'stretch',
    gap: theme.spacing.sm,
  },
  label: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
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
  error: {
    color: theme.color.danger,
    fontSize: 14,
  },
  success: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  flexBtn: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
