/**
 * One-time "welcome back" banner shown over the main tabs after a sign-in or
 * password reset that restored an account pending deletion (account-deletion
 * R4.9, R1.14).
 *
 * Reads `accountRestoredNotice` from the session store and takes no props. It
 * is mounted by `MainTabsNavigator` (not by the auth screens, which unmount the
 * moment the token is set). The flag lives in memory only, so it cannot come
 * back on the next launch.
 */

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { useAnnounceOnMount } from '../hooks/useAnnounceOnMount';
import { useSessionStore } from '../state/sessionStore';
import { makeStyles } from '../theme/makeStyles';
import { withAlpha } from '../theme/theme';
import { useAppTheme } from '../theme/useAppTheme';

export const ACCOUNT_RESTORED_MESSAGE =
  'Welcome back. Your account deletion was cancelled and your account has been restored.';

function Banner({ onDismiss }: { readonly onDismiss: () => void }): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  // The banner is the topmost thing on screen, so it clears the status bar /
  // notch itself. Read the context directly (not `useSafeAreaInsets`) so it
  // still renders where no provider is mounted, as `GradientHeader` does.
  const insets = React.useContext(SafeAreaInsetsContext);
  useAnnounceOnMount(ACCOUNT_RESTORED_MESSAGE);

  return (
    <View
      style={[styles.banner, { paddingTop: t.spacing.md + (insets?.top ?? 0) }]}
      accessibilityRole="alert"
      testID="account-restored-notice"
    >
      <Ionicons name="checkmark-circle-outline" size={20} color={t.color.success} />
      <Text style={styles.text} testID="account-restored-notice-text">
        {ACCOUNT_RESTORED_MESSAGE}
      </Text>
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss account restored notice"
        hitSlop={8}
        testID="account-restored-notice-dismiss"
      >
        <Ionicons name="close" size={20} color={t.color.textSecondary} />
      </Pressable>
    </View>
  );
}

export default function AccountRestoredNotice(): JSX.Element | null {
  const visible = useSessionStore((state) => state.accountRestoredNotice);
  const dismiss = useSessionStore((state) => state.dismissAccountRestoredNotice);
  if (!visible) {
    return null;
  }
  return <Banner onDismiss={dismiss} />;
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color.success,
    backgroundColor: withAlpha(t.color.success, 0.14),
  },
  text: {
    flex: 1,
    fontSize: 14,
    color: t.color.textPrimary,
  },
}));
