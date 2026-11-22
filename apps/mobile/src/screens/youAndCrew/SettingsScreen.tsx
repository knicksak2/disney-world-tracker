import React from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { apiRequest, resolveBaseUrl } from '../../api/client';
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '../../photos/constants';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  Card,
  GradientHeader,
  ScreenContainer,
  SecondaryButton,
  SectionLabel,
} from '../../theme/components';
import PushNotificationPreferenceControl from '../PushNotificationPreferenceControl';
import AppearancePreferenceControl from '../AppearancePreferenceControl';
import ChangePasswordControl from '../ChangePasswordControl';
import { invalidatePushRegistration } from '../../hooks/usePushRegistration';
import { useSessionStore } from '../../state/sessionStore';
import {
  useOnboardingState,
  useUpdateOnboarding,
} from '../onboarding/onboardingApi';
import { useOnboardingPreviewStore } from '../onboarding/onboardingPreviewStore';

interface SettingsRowProps {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly accessibilityLabel: string;
  readonly accessibilityRole?: 'button' | 'link';
  readonly accessibilityHint?: string;
  readonly trailingIcon?: keyof typeof Ionicons.glyphMap;
  readonly tone?: 'default' | 'danger';
  readonly disabled?: boolean;
}

/**
 * Single interactive navigation/action row inside a grouped `Card` on `SettingsScreen`.
 */
function SettingsRow({
  icon,
  label,
  onPress,
  testID,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityHint,
  trailingIcon = 'chevron-forward',
  tone = 'default',
  disabled = false,
}: SettingsRowProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const isDanger = tone === 'danger';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      {...(accessibilityHint !== undefined ? { accessibilityHint } : {})}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
    >
      <View style={styles.rowLeft}>
        <Ionicons
          name={icon}
          size={18}
          color={isDanger ? t.color.danger : t.color.primaryFg}
        />
        <Text style={isDanger ? styles.rowLabelDanger : styles.rowLabel}>
          {label}
        </Text>
      </View>
      <Ionicons name={trailingIcon} size={18} color={t.color.textSecondary} />
    </Pressable>
  );
}

/**
 * Dedicated Settings screen for preferences, account security, help, legal,
 * account deletion, sign-out, and `__DEV__`-only onboarding preview controls.
 */
export default function SettingsScreen(): JSX.Element {
  const styles = useStyles();
  // Cross-stack navigation (OnboardingFlow, MainTabs) requires the looser hook typing.
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const clearToken = useSessionStore((state) => state.clearToken);

  const onboardingQuery = useOnboardingState();
  const updateOnboarding = useUpdateOnboarding();
  const previewStarterChecklist = useOnboardingPreviewStore(
    (s) => s.previewStarterChecklist,
  );
  const enableStarterChecklistPreview = useOnboardingPreviewStore(
    (s) => s.enableStarterChecklistPreview,
  );
  const dismissStarterChecklistPreview = useOnboardingPreviewStore(
    (s) => s.dismissStarterChecklistPreview,
  );

  const onboardingData = onboardingQuery.data;
  const canRestoreStarterChecklist =
    typeof onboardingData?.starterChecklistDismissedAt === 'string' &&
    onboardingData.checklist != null &&
    (!onboardingData.checklist.loggedFirstExperience ||
      !onboardingData.checklist.starredFavorite ||
      !onboardingData.checklist.hasTrip ||
      !onboardingData.checklist.claimedPin);

  const logoutMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      void invalidatePushRegistration();
      await apiRequest<null>('POST', '/auth/logout');
    },
    onSettled: async () => {
      await clearToken();
      queryClient.clear();
    },
  });

  return (
    <ScreenContainer style={styles.container} testID="settings-screen">
      <GradientHeader
        title="Settings"
        subtitle="Preferences, security, help & legal"
        icon="settings"
        compact
        onBack={() => navigation.goBack()}
        backTestID="settings-back-button"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <SectionLabel>Preferences</SectionLabel>
          <Card style={styles.groupCard}>
            <View style={styles.controlBlock}>
              <PushNotificationPreferenceControl />
            </View>
            <View style={styles.divider} />
            <View style={styles.controlBlock}>
              <AppearancePreferenceControl />
            </View>
          </Card>
        </View>

        <View style={styles.section}>
          <SectionLabel>Account &amp; Safety</SectionLabel>
          <Card style={styles.groupCard}>
            <View style={styles.controlBlock}>
              <ChangePasswordControl />
            </View>
            <View style={styles.divider} />
            <SettingsRow
              icon="ban-outline"
              label="Blocked Users"
              onPress={() => navigation.navigate('BlockedUsers')}
              accessibilityLabel="Manage Blocked Users"
              testID="blocked-users-entry-button"
            />
          </Card>
        </View>

        <View style={styles.section}>
          <SectionLabel>Help &amp; Legal</SectionLabel>
          <Card style={styles.groupCard}>
            <SettingsRow
              icon="compass-outline"
              label="App Tour & Quick Guide"
              onPress={() => navigation.navigate('OnboardingFlow', { mode: 'replay' })}
              accessibilityLabel="App Tour and Quick Guide"
              testID="settings-app-tour-btn"
            />

            {canRestoreStarterChecklist ? (
              <>
                <View style={styles.divider} />
                <SettingsRow
                  icon="sparkles-outline"
                  label="Show Start Here checklist on Home"
                  onPress={() => updateOnboarding.mutate({ restoreStarterChecklist: true })}
                  disabled={updateOnboarding.isPending}
                  accessibilityLabel="Show Start Here checklist on Home"
                  testID="settings-restore-starter-btn"
                />
              </>
            ) : null}

            <View style={styles.divider} />
            <SettingsRow
              icon="chatbubbles-outline"
              label="Report a problem or send feedback"
              onPress={() => navigation.navigate('Feedback')}
              accessibilityLabel="Report a problem or send feedback"
              accessibilityHint="Opens a form to send a bug report or an idea"
              testID="feedback-entry-button"
            />

            <View style={styles.divider} />
            <View testID="you-and-crew-terms-of-service-card">
              <SettingsRow
                icon="newspaper-outline"
                label="Terms of Service"
                onPress={() => {
                  const url = TERMS_OF_SERVICE_URL || `${resolveBaseUrl()}/terms`;
                  void Linking.openURL(url);
                }}
                accessibilityRole="link"
                accessibilityLabel="Terms of Service"
                trailingIcon="open-outline"
                testID="terms-of-service-entry-button"
              />
            </View>

            <View style={styles.divider} />
            <SettingsRow
              icon="document-text-outline"
              label="Privacy Policy"
              onPress={() => {
                const url = PRIVACY_POLICY_URL || `${resolveBaseUrl()}/privacy`;
                void Linking.openURL(url);
              }}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
              trailingIcon="open-outline"
              testID="privacy-policy-entry-button"
            />
          </Card>
        </View>

        <View style={styles.section}>
          <SectionLabel>Account</SectionLabel>
          <Card style={styles.groupCard}>
            <SettingsRow
              icon="trash-outline"
              label="Delete account"
              tone="danger"
              onPress={() => navigation.navigate('DeleteAccount')}
              accessibilityLabel="Delete account"
              accessibilityHint="Starts the steps to permanently delete your account"
              testID="delete-account-entry-button"
            />
          </Card>

          <View style={styles.logoutBlock}>
            <SecondaryButton
              label={logoutMutation.isPending ? 'Logging out\u2026' : 'Log out'}
              icon="log-out-outline"
              tone="danger"
              onPress={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              testID="you-and-crew-logout"
            />
          </View>
        </View>

        {__DEV__ ? (
          <View style={styles.section}>
            <SectionLabel>Developer</SectionLabel>
            <Card style={styles.groupCard} testID="settings-dev-section">
              <SettingsRow
                icon="sparkles-outline"
                label="Preview Full Onboarding"
                onPress={() => navigation.navigate('OnboardingFlow', { mode: 'preview' })}
                accessibilityLabel="Preview Full Onboarding"
                testID="settings-onboarding-preview-btn"
              />

              {!onboardingData?.showStarterChecklist ? (
                <>
                  <View style={styles.divider} />
                  <SettingsRow
                    icon="checkbox-outline"
                    label={
                      previewStarterChecklist
                        ? 'Hide Start Here Preview on Home'
                        : 'Preview Start Here Checklist on Home'
                    }
                    onPress={() => {
                      if (previewStarterChecklist) {
                        dismissStarterChecklistPreview();
                      } else {
                        enableStarterChecklistPreview();
                        navigation.navigate('MainTabs', { screen: 'Home' });
                      }
                    }}
                    accessibilityLabel={
                      previewStarterChecklist
                        ? 'Hide Start Here preview on Home'
                        : 'Preview Start Here checklist on Home'
                    }
                    testID="settings-preview-starter-btn"
                  />
                </>
              ) : null}
            </Card>
          </View>
        ) : null}

        <View style={styles.disclaimerBlock} testID="you-and-crew-legal-disclaimer">
          <Text style={styles.disclaimerText}>
            Disney World Tracker is an independent, unofficial companion application and is not
            affiliated with, endorsed by, or sponsored by The Walt Disney Company. All Disney
            trademarks, service marks, and trade names are the property of their respective owners.
            Wait times, park schedules, and price estimates are for personal planning purposes.
            Lightning Lane prices powered by ThemeParks.wiki. Ticket and menu prices come from
            Disney&apos;s website, are shown before tax, may be out of date or estimated, and final
            checkout prices may differ; discounted, military, reseller, and special-offer prices
            are not covered.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
  },
  content: {
    padding: t.spacing.md,
    gap: t.spacing.lg,
    paddingBottom: t.spacing.xxl,
  },
  section: {
    gap: t.spacing.xs,
  },
  groupCard: {
    padding: 0,
    overflow: 'hidden',
  },
  controlBlock: {
    padding: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 48,
  },
  rowPressed: {
    backgroundColor: t.color.surfaceAlt,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: t.spacing.sm,
  },
  rowLabel: {
    ...t.typography.body,
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textPrimary,
    flexShrink: 1,
  },
  rowLabelDanger: {
    ...t.typography.body,
    fontSize: 15,
    fontWeight: '600',
    color: t.color.danger,
    flexShrink: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.color.border,
    marginLeft: 14,
  },
  logoutBlock: {
    marginTop: t.spacing.sm,
  },
  disclaimerBlock: {
    paddingHorizontal: t.spacing.sm,
    paddingTop: t.spacing.sm,
    alignItems: 'center',
  },
  disclaimerText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
}));
