/**
 * Banner shown on the sign-in screen after the user requested account deletion
 * (account-deletion R1.13, R1.14).
 *
 * Reads `accountDeletionNotice` from the session store and takes no props, so
 * `LoginScreen` mounts it as `<AccountDeletionNotice />` above the form. The
 * notice is in memory only; it is gone after an app restart.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAnnounceOnMount } from '../hooks/useAnnounceOnMount';
import { useSessionStore } from '../state/sessionStore';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';

/** Format the purge date in the device locale (for example "March 15, 2030"). */
export function formatPurgeDate(scheduledPurgeAt: string): string {
  const date = new Date(scheduledPurgeAt);
  if (Number.isNaN(date.getTime())) {
    return scheduledPurgeAt;
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function accountDeletionNoticeMessage(scheduledPurgeAt: string): string {
  return `Your account is scheduled for deletion on ${formatPurgeDate(
    scheduledPurgeAt,
  )}. Sign in before then to cancel.`;
}

function Banner({
  message,
  onDismiss,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  useAnnounceOnMount(message);

  return (
    <View
      style={styles.banner}
      accessibilityRole="alert"
      testID="account-deletion-notice"
    >
      <Ionicons name="trash-outline" size={20} color={t.color.warningText} />
      <Text style={styles.text} testID="account-deletion-notice-text">
        {message}
      </Text>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss account deletion notice"
        hitSlop={8}
        testID="account-deletion-notice-dismiss"
      >
        <Ionicons name="close" size={20} color={t.color.warningText} />
      </Pressable>
    </View>
  );
}

export default function AccountDeletionNotice(): JSX.Element | null {
  const notice = useSessionStore((state) => state.accountDeletionNotice);
  const dismiss = useSessionStore((state) => state.dismissAccountDeletionNotice);
  if (!notice) {
    return null;
  }
  return (
    <Banner
      message={accountDeletionNoticeMessage(notice.scheduledPurgeAt)}
      onDismiss={dismiss}
    />
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    marginHorizontal: t.spacing.xl,
    marginTop: t.spacing.lg,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.warning,
    backgroundColor: t.color.warningSurface,
  },
  text: {
    flex: 1,
    fontSize: 14,
    color: t.color.warningText,
  },
}));
