/**
 * ExperiencesDetailScreen — the Experiences drill-in of the Stats tab
 * (stats-experience-redesign task 7.7).
 *
 * A focused, bounded detail screen pushed onto the `StatsStack` from the
 * Overview hub's Experiences entry card. It wraps the UNCHANGED shared
 * `ExperiencesList` component (design D7/D8) over the requesting User's own
 * Completion_Entries, read through `useOwnCompletionsQuery` (the owner path of
 * the existing Tracking_Service completions endpoint).
 *
 * ## Its own scoped read + in-pane treatment (R14.5)
 *
 * Unlike the coverage/ratings detail screens — which read the shared
 * `['me-stats', { percentile: true }]` cache entry — this screen's data comes
 * from a SEPARATE query (`['own-completions', ownUserId]`). Its loading
 * indicator and error-with-Retry are therefore scoped to that completions read
 * alone: a completions failure never affects the coverage or ratings surfaces,
 * and Retry re-issues only the completions read. This mirrors the Own_Experiences
 * pane's discipline in the legacy `StatsScreen` (R12.7–R12.9), now lifted into
 * its own screen.
 *
 * The shared `ExperiencesList` owns the Experience_Filter, the row rendering,
 * and its own empty-state / no-match messages, so this screen only supplies the
 * already-loaded entries plus the cross-stack `useOpenExperience` affordance so
 * a row tap opens the Catalog `ExperienceDetail` (R15.2).
 *
 * Validates: Requirements 14.5
 */

import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import {
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { theme } from '../../theme/theme';

import { useOwnCompletionsQuery } from '../../hooks/useOwnCompletions';
import { ExperiencesList } from '../navigation/ExperiencesList';
import { useOpenExperience } from '../navigation/experienceNavigation';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const EXPERIENCES_ERROR_TITLE = 'Couldn\u2019t load experiences';
const EXPERIENCES_ERROR_BODY =
  'Couldn\u2019t load your completed experiences. Please try again.';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ExperiencesDetailScreen(): JSX.Element {
  const navigation = useNavigation();

  // Scoped Own_Completions_Read — independent of the shared stats query, so its
  // loading / error / retry never touch the coverage or ratings surfaces (R14.5).
  const query = useOwnCompletionsQuery();

  // Cross-stack navigation into the Catalog tab's ExperienceDetail, threaded
  // into the shared list so a row tap opens the experience (R15.2).
  const openExperience = useOpenExperience();

  const header = (
    <GradientHeader
      title="Experiences"
      subtitle="Every experience you've completed."
      icon="list"
      onBack={() => navigation.goBack()}
    />
  );

  const entries = query.data?.entries;

  // R14.5: in-pane loader while the scoped completions read is in flight with no
  // prior data (also covers a re-issue after Retry). `isFetching` rather than
  // `isLoading` so a retry shows the loader again.
  if (query.isFetching && entries === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="experiences-detail-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // R14.5: a failed completions read (including the 30-second timeout) with no
  // prior data gates the view to an error message plus a Retry that re-issues
  // only the completions read.
  if (entries === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="experiences-detail-error">
          <EmptyState
            icon="cloud-offline-outline"
            title={EXPERIENCES_ERROR_TITLE}
            body={EXPERIENCES_ERROR_BODY}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void query.refetch();
            }}
            testID="experiences-detail-error-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  // Success — hand the loaded entries to the unchanged shared list, which owns
  // the Experience_Filter and its own empty-state / no-match messages.
  return (
    <ScreenContainer>
      {header}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="experiences-detail-screen"
      >
        <ExperiencesList
          entries={entries}
          testIDPrefix="own"
          onOpenExperience={openExperience}
        />
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scrollContent: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  retryBtn: {
    marginTop: theme.spacing.lg,
    alignSelf: 'center',
  },
});
