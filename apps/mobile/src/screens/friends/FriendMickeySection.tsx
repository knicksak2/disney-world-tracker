import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { UseQueryResult } from '@tanstack/react-query';
import type { FriendMickeyFindsPageDTO, MickeySummaryDTO } from '@dwt/shared';
import { useMickeyConfig, useMickeySummary, useFriendMickeyFinds } from '../mickeys/api';
import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

export interface FriendMickeySectionProps {
  readonly friendId: string;
  readonly displayName: string;
  readonly summaryQuery?: UseQueryResult<MickeySummaryDTO, unknown>;
  readonly findsQuery?: UseQueryResult<FriendMickeyFindsPageDTO, unknown>;
}

export default function FriendMickeySection({
  friendId,
  displayName,
  summaryQuery: propSummaryQuery,
  findsQuery: propFindsQuery,
}: FriendMickeySectionProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();

  const { data: config } = useMickeyConfig();
  const isEnabled = Boolean(config?.enabled);
  const hookSummaryQuery = useMickeySummary(friendId, !propSummaryQuery && isEnabled);
  const hookFindsQuery = useFriendMickeyFinds(friendId, !propFindsQuery && isEnabled);

  const summaryQuery = propSummaryQuery ?? hookSummaryQuery;
  const findsQuery = propFindsQuery ?? hookFindsQuery;

  const { data: summary, isLoading: isSummaryLoading } = summaryQuery;
  const { data: findsPage, isLoading: isFindsLoading } = findsQuery;

  // Hidden when feature is disabled server-side (Requirement 13.9)
  if (!isEnabled) {
    return null;
  }

  return (
    <View style={styles.section} testID="friend-mickey-section">
      <View style={styles.headerRow}>
        <Ionicons name="sparkles" size={16} color={t.color.primaryFg} />
        <Text style={styles.sectionTitle}>HIDDEN MICKEYS</Text>
      </View>

      {isSummaryLoading || isFindsLoading ? (
        <ActivityIndicator size="small" color={t.color.primary} style={{ marginVertical: 12 }} />
      ) : (
        <View style={styles.card}>
          {/* Summary stats */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Official Found</Text>
              <Text style={styles.statValue}>
                {summary?.overall?.found ?? 0} / {summary?.overall?.total ?? 0}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Community Finds</Text>
              <Text style={styles.statValue}>{summary?.community?.found ?? 0}</Text>
            </View>
          </View>

          {/* Recent Finds (Read-only, Clue 1 only, Requirement 10.2, 10.4) */}
          <View style={styles.findsContainer}>
            <Text style={styles.findsTitle}>Recent Finds</Text>
            {findsPage?.items && findsPage.items.length > 0 ? (
              findsPage.items.slice(0, 5).map((item) => (
                <View key={item.mickeyId} style={styles.findItem}>
                  <View style={styles.findHeader}>
                    <Text style={styles.findExpName}>{item.experienceName}</Text>
                    <Text style={styles.findDate}>{item.foundOn}</Text>
                  </View>
                  <Text style={styles.findClue} numberOfLines={2}>
                    {item.clue1}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>
                {displayName} hasn't recorded any Hidden Mickey finds yet.
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  section: {
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  sectionTitle: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: t.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: theme.spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: theme.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  statBox: {
    alignItems: 'center',
  },
  statLabel: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontSize: 10.5,
  },
  statValue: {
    ...theme.typography.heading,
    fontSize: 16,
    color: t.color.primaryFg,
    fontWeight: '800',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: t.color.border,
  },
  findsContainer: {
    gap: 6,
    marginTop: 2,
  },
  findsTitle: {
    ...theme.typography.meta,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  findItem: {
    backgroundColor: t.color.surfaceAlt,
    padding: 8,
    borderRadius: theme.radius.sm,
    gap: 2,
  },
  findHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  findExpName: {
    ...theme.typography.meta,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  findDate: {
    ...theme.typography.meta,
    fontSize: 10,
    color: t.color.textSecondary,
  },
  findClue: {
    ...theme.typography.meta,
    color: t.color.textPrimary,
    lineHeight: 16,
  },
  emptyText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
}));
