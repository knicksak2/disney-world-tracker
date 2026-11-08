import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MickeyStatus } from '@dwt/shared';

import type { RootStackParamList } from '../../navigation/RootNavigator';
import { useMySubmissions } from './api';
import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'MySubmissions'>;

export default function MySubmissionsScreen(): JSX.Element {
  const navigation = useNavigation<NavigationProp>();
  const styles = useStyles();
  const t = useAppTheme();

  const { data: submissions, isLoading, refetch } = useMySubmissions();

  const renderStatusBadge = (status: MickeyStatus) => {
    switch (status) {
      case 'approved':
        return (
          <View style={[styles.statusBadge, styles.statusApproved]}>
            <Ionicons name="checkmark-circle" size={12} color={t.color.success} />
            <Text style={[styles.statusText, { color: t.color.success }]}>Approved</Text>
          </View>
        );
      case 'pending':
        return (
          <View style={[styles.statusBadge, styles.statusPending]}>
            <Ionicons name="time" size={12} color={t.color.warningText} />
            <Text style={[styles.statusText, { color: t.color.warningText }]}>Pending Review</Text>
          </View>
        );
      case 'rejected':
        return (
          <View style={[styles.statusBadge, styles.statusRejected]}>
            <Ionicons name="close-circle" size={12} color={t.color.danger} />
            <Text style={[styles.statusText, { color: t.color.danger }]}>Rejected</Text>
          </View>
        );
      case 'hidden':
        return (
          <View style={[styles.statusBadge, styles.statusHidden]}>
            <Ionicons name="eye-off" size={12} color={t.color.textSecondary} />
            <Text style={[styles.statusText, { color: t.color.textSecondary }]}>Hidden</Text>
          </View>
        );
      case 'retired':
        return (
          <View style={[styles.statusBadge, styles.statusRetired]}>
            <Ionicons name="archive" size={12} color={t.color.textSecondary} />
            <Text style={[styles.statusText, { color: t.color.textSecondary }]}>Retired</Text>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={t.color.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>My Submissions</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Submit a Hidden Mickey"
          onPress={() => navigation.navigate('SubmitMickey')}
          style={styles.addButton}
        >
          <Ionicons name="add" size={24} color={t.color.primaryFg} />
        </Pressable>
      </View>

      <FlatList
        data={submissions ?? []}
        keyExtractor={(item) => item.id}
        refreshing={isLoading}
        onRefresh={() => void refetch()}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.submissionCard}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.experienceName}>{item.experienceName}</Text>
              {renderStatusBadge(item.status)}
            </View>

            <Text style={styles.clueText}>{item.clue1}</Text>

            <View style={styles.badgesRow}>
              {item.communityVerified && (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="shield-checkmark" size={12} color={t.color.primaryFg} />
                  <Text style={styles.verifiedBadgeText}>Community verified</Text>
                </View>
              )}
              {item.official && (
                <View style={styles.officialBadge}>
                  <Ionicons name="ribbon" size={12} color={t.color.textOnPrimary} />
                  <Text style={styles.officialBadgeText}>Promoted to Official</Text>
                </View>
              )}
            </View>

            {item.reviewNote && (
              <View style={styles.reviewNoteCard}>
                <Ionicons name="chatbubble-ellipses-outline" size={14} color={t.color.textSecondary} />
                <Text style={styles.reviewNoteText}>Review note: {item.reviewNote}</Text>
              </View>
            )}

            <Text style={styles.dateText}>
              Submitted on {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="sparkles-outline" size={48} color={t.color.textSecondary} />
              <Text style={styles.emptyTitle}>No Submissions Yet</Text>
              <Text style={styles.emptySubtext}>
                Have you found a Hidden Mickey in the parks? Submit it to share with fellow explorers!
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Submit your first Mickey"
                style={styles.submitFirstBtn}
                onPress={() => navigation.navigate('SubmitMickey')}
              >
                <Text style={styles.submitFirstBtnText}>Submit Your First Mickey</Text>
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator size="large" color={t.color.primary} style={{ marginTop: 40 }} />
          )
        }
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.color.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
    backgroundColor: t.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  backButton: {
    padding: theme.spacing.xs,
  },
  headerTitle: {
    ...theme.typography.heading,
    fontSize: 17,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  addButton: {
    padding: theme.spacing.xs,
  },
  listContent: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  submissionCard: {
    backgroundColor: t.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    gap: 6,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  experienceName: {
    ...theme.typography.subtitle,
    fontWeight: '700',
    color: t.color.textPrimary,
    flex: 1,
    marginRight: theme.spacing.xs,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusApproved: {
    backgroundColor: t.color.surfaceAlt,
  },
  statusPending: {
    backgroundColor: t.color.warningSurface,
  },
  statusRejected: {
    backgroundColor: t.color.surfaceAlt,
  },
  statusHidden: {
    backgroundColor: t.color.surfaceAlt,
  },
  statusRetired: {
    backgroundColor: t.color.surfaceAlt,
  },
  statusText: {
    ...theme.typography.meta,
    fontSize: 11,
    fontWeight: '700',
  },
  clueText: {
    ...theme.typography.body,
    color: t.color.textPrimary,
    lineHeight: 20,
    marginTop: 2,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  verifiedBadgeText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  officialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: t.color.primary,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  officialBadgeText: {
    ...theme.typography.meta,
    fontSize: 10.5,
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  reviewNoteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: t.color.surfaceAlt,
    padding: 8,
    borderRadius: theme.radius.sm,
    marginTop: 2,
  },
  reviewNoteText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    flex: 1,
    lineHeight: 16,
  },
  dateText: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontSize: 10.5,
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl * 2,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  emptyTitle: {
    ...theme.typography.heading,
    color: t.color.textPrimary,
    fontWeight: '700',
  },
  emptySubtext: {
    ...theme.typography.body,
    color: t.color.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  submitFirstBtn: {
    backgroundColor: t.color.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.md,
  },
  submitFirstBtnText: {
    ...theme.typography.body,
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
}));
