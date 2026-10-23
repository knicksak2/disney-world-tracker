/**
 * DeleteAccountScreen: self-service account deletion in three steps
 * (account-deletion R1.3 to R1.13).
 *
 *   1. review    - plain-language consequences.
 *   2. password  - `POST /me/account/deletion/reauth` returns a one-use grant
 *                  and the server's `graceDays`.
 *   3. confirm   - type the Confirmation_Phrase, then `POST /me/account/deletion`.
 *
 * The password and the Reauth_Grant live in component state only (never
 * persisted, never logged) and are cleared on success, cancel and unmount.
 * `graceDays` is shown from the reauth response and is never hard-coded.
 *
 * On success the server has already revoked every session and removed the push
 * registrations, so this screen makes NO further authenticated call (no
 * `/auth/logout`, no `invalidatePushRegistration()`): it would return 401 and
 * fire the global unauthorized handler mid-transition (R1.13).
 */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  DELETE_ACCOUNT_CONFIRMATION_PHRASE,
  DELETED_USER_DISPLAY_NAME,
  type DeleteAccountRequest,
  type DeleteAccountResponse,
  type ReauthRequest,
  type ReauthResponse,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { YouAndCrewStackParamList } from '../../navigation/YouAndCrewStack';
import { useSessionStore } from '../../state/sessionStore';
import {
  Card,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
  SecondaryButton,
} from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { ACCOUNT_LOCKED_MESSAGE } from '../authCopy';

type NavigationProp = NativeStackNavigationProp<
  YouAndCrewStackParamList,
  'DeleteAccount'
>;

type Step = 'review' | 'password' | 'confirm';

const STEP_NUMBER: Readonly<Record<Step, number>> = {
  review: 1,
  password: 2,
  confirm: 3,
};

export const PASSWORD_INCORRECT_MESSAGE = 'Password is incorrect.';
export const REAUTH_EXPIRED_MESSAGE =
  'For your security, that confirmation expired. Enter your password again to continue.';
const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : GENERIC_ERROR_MESSAGE;
}

/**
 * The consequences listed on the review step (R1.4, clarified by R1.16). The
 * server's `graceDays` only exists after the password step, so this step names
 * no day count; the confirm step shows the server's number.
 */
const CONSEQUENCES: readonly string[] = [
  'Every device is signed out immediately.',
  'Your account is hidden from friends and trip members.',
  'Your account and its data are permanently deleted when the grace period ends. The exact number of days is shown before you confirm.',
  'Signing in again before then cancels the deletion and restores your account.',
  'Your photos are deleted.',
  'Trips you own are handed to another member, or deleted if you are the only member.',
  `Content other people can see, such as comments, is kept but shown as "${DELETED_USER_DISPLAY_NAME}".`,
];

export default function DeleteAccountScreen(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const navigation = useNavigation<NavigationProp>();
  const queryClient = useQueryClient();
  const clearToken = useSessionStore((state) => state.clearToken);
  const setAccountDeletionNotice = useSessionStore(
    (state) => state.setAccountDeletionNotice,
  );

  const [step, setStep] = useState<Step>('review');
  // Held in component state only (R1.12): never persisted, never logged.
  const [password, setPassword] = useState('');
  const [grant, setGrant] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [reauthNotice, setReauthNotice] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const clearSecrets = (): void => {
    setPassword('');
    setGrant(null);
    setConfirmation('');
  };

  const reauthMutation = useMutation<ReauthResponse, ApiError, ReauthRequest>({
    mutationFn: (body) =>
      apiRequest<ReauthResponse>('POST', '/me/account/deletion/reauth', body),
    onSuccess: (data) => {
      setPassword('');
      setPasswordError(null);
      setReauthNotice(null);
      setGrant(data.reauthGrant);
      setGraceDays(data.graceDays);
      setConfirmation('');
      setConfirmError(null);
      setStep('confirm');
    },
    onError: (err) => {
      // The field is always cleared after a failed attempt (R1.8). The user stays
      // signed in and on this step: `reauth_failed` is a 403, never a 401.
      setPassword('');
      setReauthNotice(null);
      if (err instanceof ApiError && err.code === 'reauth_failed') {
        setPasswordError(PASSWORD_INCORRECT_MESSAGE);
        return;
      }
      if (err instanceof ApiError && err.code === 'account_locked') {
        setPasswordError(ACCOUNT_LOCKED_MESSAGE);
        return;
      }
      setPasswordError(errorText(err));
    },
  });

  const deleteMutation = useMutation<
    DeleteAccountResponse,
    ApiError,
    DeleteAccountRequest
  >({
    mutationFn: (body) =>
      apiRequest<DeleteAccountResponse>('POST', '/me/account/deletion', body),
    onSuccess: async (data) => {
      clearSecrets();
      // Order matters (R1.13): stop in-flight reads, record the notice the
      // sign-in screen will show, sign out locally, then drop the cache.
      await queryClient.cancelQueries();
      setAccountDeletionNotice({
        scheduledPurgeAt: data.scheduledPurgeAt,
        graceDays: data.graceDays,
      });
      await clearToken();
      queryClient.clear();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'reauth_required') {
        // The grant expired or was already used: back to the password step.
        clearSecrets();
        setPasswordError(null);
        setConfirmError(null);
        setReauthNotice(REAUTH_EXPIRED_MESSAGE);
        setStep('password');
        return;
      }
      setConfirmError(errorText(err));
    },
  });

  const busy = reauthMutation.isPending || deleteMutation.isPending;
  const confirmationMatches =
    confirmation.trim() === DELETE_ACCOUNT_CONFIRMATION_PHRASE;

  const handleCancel = (): void => {
    clearSecrets();
    navigation.goBack();
  };

  const handleVerifyPassword = (): void => {
    if (busy || password.length === 0) {
      return;
    }
    setPasswordError(null);
    setReauthNotice(null);
    reauthMutation.mutate({ password });
  };

  const handleDelete = (): void => {
    if (busy || grant === null || !confirmationMatches) {
      return;
    }
    setConfirmError(null);
    deleteMutation.mutate({
      reauthGrant: grant,
      confirmation: confirmation.trim(),
    });
  };

  return (
    <ScreenContainer testID="delete-account-screen">
      <GradientHeader
        title="Delete account"
        subtitle={`Step ${STEP_NUMBER[step]} of 3`}
        icon="trash"
        compact
        onBack={busy ? undefined : handleCancel}
        backAccessibilityLabel="Cancel and go back"
        backTestID="delete-account-back"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'review' ? (
            <Card testID="delete-account-step-review">
              <Text style={styles.heading} accessibilityRole="header">
                Before you delete your account
              </Text>
              <View style={styles.list}>
                {CONSEQUENCES.map((line) => (
                  <View key={line} style={styles.listRow}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={18}
                      color={t.color.danger}
                    />
                    <Text style={styles.listText}>{line}</Text>
                  </View>
                ))}
              </View>
              <PrimaryButton
                label="Continue"
                icon="arrow-forward"
                onPress={() => {
                  setStep('password');
                }}
                testID="delete-account-continue"
              />
              <SecondaryButton
                label="Cancel"
                onPress={handleCancel}
                style={styles.secondary}
                testID="delete-account-cancel"
              />
            </Card>
          ) : null}

          {step === 'password' ? (
            <Card testID="delete-account-step-password">
              <Text style={styles.heading} accessibilityRole="header">
                Confirm it is you
              </Text>
              <Text style={styles.body}>
                Enter your current password to continue.
              </Text>
              {reauthNotice !== null ? (
                <Text
                  style={styles.notice}
                  accessibilityRole="alert"
                  testID="delete-account-reauth-notice"
                >
                  {reauthNotice}
                </Text>
              ) : null}
              <Text style={styles.label}>Current password</Text>
              <TextInput
                style={[styles.input, passwordError !== null && styles.inputError]}
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  if (passwordError !== null) setPasswordError(null);
                }}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                textContentType="password"
                maxLength={128}
                editable={!busy}
                placeholder="Your password"
                placeholderTextColor={t.color.textSecondary}
                keyboardAppearance={t.scheme}
                accessibilityLabel="Current password"
                testID="delete-account-password"
              />
              {passwordError !== null ? (
                <Text
                  style={styles.error}
                  accessibilityRole="alert"
                  testID="delete-account-password-error"
                >
                  {passwordError}
                </Text>
              ) : null}
              <PrimaryButton
                label="Verify password"
                icon="lock-closed-outline"
                loading={reauthMutation.isPending}
                disabled={busy || password.length === 0}
                onPress={handleVerifyPassword}
                testID="delete-account-verify"
              />
              <SecondaryButton
                label="Cancel"
                onPress={handleCancel}
                disabled={busy}
                style={styles.secondary}
                testID="delete-account-cancel"
              />
            </Card>
          ) : null}

          {step === 'confirm' ? (
            <Card testID="delete-account-step-confirm">
              <Text style={styles.heading} accessibilityRole="header">
                Last step
              </Text>
              <Text style={styles.body} testID="delete-account-grace-copy">
                {graceDays !== null
                  ? `Your account will be permanently deleted ${graceDays} days after you confirm. Signing in before then cancels the deletion.`
                  : 'Signing in before the grace period ends cancels the deletion.'}
              </Text>
              <Text style={styles.body}>
                Type{' '}
                <Text style={styles.phrase} testID="delete-account-phrase">
                  {DELETE_ACCOUNT_CONFIRMATION_PHRASE}
                </Text>{' '}
                to confirm.
              </Text>
              <Text style={styles.label}>Confirmation</Text>
              <TextInput
                style={[styles.input, confirmError !== null && styles.inputError]}
                value={confirmation}
                onChangeText={(value) => {
                  setConfirmation(value);
                  if (confirmError !== null) setConfirmError(null);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!busy}
                placeholder={DELETE_ACCOUNT_CONFIRMATION_PHRASE}
                placeholderTextColor={t.color.textSecondary}
                keyboardAppearance={t.scheme}
                accessibilityLabel={`Type ${DELETE_ACCOUNT_CONFIRMATION_PHRASE} to confirm`}
                testID="delete-account-confirmation"
              />
              {confirmError !== null ? (
                <Text
                  style={styles.error}
                  accessibilityRole="alert"
                  testID="delete-account-confirm-error"
                >
                  {confirmError}
                </Text>
              ) : null}
              <PrimaryButton
                label="Delete my account"
                icon="trash-outline"
                loading={deleteMutation.isPending}
                disabled={busy || !confirmationMatches}
                onPress={handleDelete}
                testID="delete-account-submit"
              />
              <SecondaryButton
                label="Cancel"
                onPress={handleCancel}
                disabled={busy}
                style={styles.secondary}
                testID="delete-account-cancel"
              />
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1 },
  content: {
    padding: t.spacing.md,
    paddingBottom: t.spacing.xxl,
  },
  heading: {
    ...t.typography.title,
    color: t.color.textPrimary,
    marginBottom: t.spacing.sm,
  },
  body: {
    ...t.typography.body,
    color: t.color.textSecondary,
    marginBottom: t.spacing.md,
  },
  list: {
    gap: t.spacing.sm,
    marginBottom: t.spacing.lg,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.sm,
  },
  listText: {
    ...t.typography.body,
    flex: 1,
    color: t.color.textPrimary,
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
    marginBottom: t.spacing.md,
  },
  inputError: {
    borderColor: t.color.danger,
  },
  error: {
    color: t.color.danger,
    fontSize: 14,
    marginBottom: t.spacing.md,
  },
  notice: {
    color: t.color.warningText,
    backgroundColor: t.color.warningSurface,
    borderRadius: t.radius.md,
    padding: t.spacing.md,
    fontSize: 14,
    marginBottom: t.spacing.md,
  },
  phrase: {
    fontWeight: '800',
    color: t.color.danger,
  },
  secondary: {
    marginTop: t.spacing.sm,
  },
}));
