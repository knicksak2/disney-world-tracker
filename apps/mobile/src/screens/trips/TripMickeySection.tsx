/**
 * TripMickeySection — Mobile "Hidden Mickeys" card section on Trip Detail hub.
 *
 * Implements Task 10.8 (Requirements 11.5, 13.3).
 *
 * Fetches `GET /trips/:id/mickeys` and renders a titled "Hidden Mickeys"
 * section listing each found Mickey and per-member counts, with an empty state
 * when nothing was found on the trip.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Card } from '../../theme/components';
import { theme, withAlpha } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { useMickeyConfig, useTripMickeys } from '../mickeys/api';

export interface TripMickeySectionProps {
  readonly tripId: string;
  readonly onSelectMickey?: (mickeyId: string) => void;
  readonly testID?: string;
  readonly embedded?: boolean | undefined;
}

export default function TripMickeySection({
  tripId,
  onSelectMickey,
  testID = 'trip-detail-mickeys-section',
  embedded = false,
}: TripMickeySectionProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const { data: config } = useMickeyConfig();
  const isEnabled = Boolean(config?.enabled);
  const { data, isLoading } = useTripMickeys(tripId, isEnabled);
  const [expanded, setExpanded] = useState(false);

  if (!isEnabled) {
    return null;
  }

  const members = data?.members ?? [];
  const mickeys = data?.mickeys ?? [];
  const totalFound = mickeys.length;

  if (embedded) {
    const memberSummary =
      members.length > 0
        ? members.map((m) => `${m.displayName}: ${m.count}`).join(' · ')
        : 'No Hidden Mickeys found yet';

    return (
      <View style={styles.embeddedWrap} testID={testID}>
        <Pressable
          style={styles.embeddedRow}
          onPress={() => setExpanded((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={`Hidden Mickeys, ${totalFound} found`}
          testID="trip-mickeys-toggle"
        >
          <View style={styles.embeddedIcon}>
            <Ionicons name="sparkles" size={16} color={t.color.primaryFg} />
          </View>
          <View style={styles.embeddedTextWrap}>
            <Text style={styles.embeddedTitle}>
              Hidden Mickeys{totalFound > 0 ? ` · ${totalFound} found` : ''}
            </Text>
            <Text
              style={styles.embeddedSub}
              numberOfLines={1}
              testID={!(isLoading && !data) && totalFound === 0 ? 'trip-mickeys-empty' : undefined}
            >
              {isLoading && !data ? 'Loading...' : memberSummary}
            </Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={15}
            color={t.color.textSecondary}
          />
        </Pressable>

        {expanded && totalFound > 0 ? (
          <View style={styles.embeddedExpanded} testID="trip-mickeys-content">
            {members.length > 0 ? (
              <View style={styles.membersRow} testID="trip-mickeys-members">
                {members.map((m) => (
                  <View key={m.userId} style={styles.memberPill}>
                    <Text style={styles.memberName}>{m.displayName}</Text>
                    <Text style={styles.memberCount}>{m.count}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.itemsList} testID="trip-mickeys-list">
              {mickeys.map((item) => (
                <Card key={item.mickeyId} style={styles.itemCard}>
                  <Pressable
                    testID={`trip-mickey-item-${item.mickeyId}`}
                    style={({ pressed }) => [
                      styles.itemContent,
                      pressed && onSelectMickey && styles.itemPressed,
                    ]}
                    onPress={() => onSelectMickey?.(item.mickeyId)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.clue1} at ${item.experienceName}`}
                  >
                    <View style={styles.itemTextWrap}>
                      <Text style={styles.itemClue} numberOfLines={2}>
                        {item.clue1}
                      </Text>
                      <Text style={styles.itemMeta} numberOfLines={1}>
                        {item.experienceName} · Found by {item.foundByCount}{' '}
                        {item.foundByCount === 1 ? 'member' : 'members'}
                      </Text>
                    </View>
                    <Badge
                      label={item.official ? 'Official' : 'Community'}
                      color={item.official ? t.color.primaryFg : t.color.textSecondary}
                    />
                  </Pressable>
                </Card>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.sectionContainer} testID={testID}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Ionicons name="sparkles" size={18} color={t.color.primaryFg} />
          <Text style={styles.sectionTitle}>Hidden Mickeys</Text>
          {totalFound > 0 ? (
            <Badge
              label={String(totalFound)}
              color={t.color.primaryFg}
            />
          ) : null}
        </View>
      </View>

      {/* Loading state */}
      {isLoading && !data ? (
        <View style={styles.loadingContainer} testID="trip-mickeys-loading">
          <ActivityIndicator size="small" color={t.color.primaryFg} />
        </View>
      ) : totalFound === 0 ? (
        /* Empty state (Requirement 11.5) */
        <View style={styles.emptyContainer} testID="trip-mickeys-empty">
          <Text style={styles.emptyTitle}>No Hidden Mickeys found yet</Text>
          <Text style={styles.emptySubtext}>
            Hunt together with your crew and log your finds during the trip!
          </Text>
        </View>
      ) : (
        /* Content: Member summary + items list */
        <View style={styles.contentWrap} testID="trip-mickeys-content">
          {/* Members tally row */}
          {members.length > 0 ? (
            <View style={styles.membersRow} testID="trip-mickeys-members">
              {members.map((m) => (
                <View key={m.userId} style={styles.memberPill}>
                  <Text style={styles.memberName}>{m.displayName}</Text>
                  <Text style={styles.memberCount}>{m.count}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Mickeys list */}
          <View style={styles.itemsList} testID="trip-mickeys-list">
            {mickeys.map((item) => (
              <Card key={item.mickeyId} style={styles.itemCard}>
                <Pressable
                  testID={`trip-mickey-item-${item.mickeyId}`}
                  style={({ pressed }) => [
                    styles.itemContent,
                    pressed && onSelectMickey && styles.itemPressed,
                  ]}
                  onPress={() => onSelectMickey?.(item.mickeyId)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.clue1} at ${item.experienceName}`}
                >
                  <View style={styles.itemTextWrap}>
                    <Text style={styles.itemClue} numberOfLines={2}>
                      {item.clue1}
                    </Text>
                    <Text style={styles.itemMeta} numberOfLines={1}>
                      {item.experienceName} · Found by {item.foundByCount} {item.foundByCount === 1 ? 'member' : 'members'}
                    </Text>
                  </View>
                  <Badge
                    label={item.official ? 'Official' : 'Community'}
                    color={item.official ? t.color.primaryFg : t.color.textSecondary}
                  />
                </Pressable>
              </Card>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  embeddedWrap: {
    borderTopWidth: 1,
    borderTopColor: t.color.border,
  },
  embeddedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 13,
    gap: 10,
  },
  embeddedIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  embeddedTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  embeddedTitle: {
    ...t.typography.body,
    fontSize: 13,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  embeddedSub: {
    ...t.typography.meta,
    fontSize: 12,
    color: t.color.textSecondary,
    marginTop: 1,
  },
  embeddedExpanded: {
    paddingHorizontal: 13,
    paddingBottom: 12,
    gap: 8,
  },
  sectionContainer: {
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  sectionTitle: {
    ...theme.typography.subtitle,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  loadingContainer: {
    padding: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    padding: theme.spacing.lg,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    alignItems: 'center',
  },
  emptyTitle: {
    ...theme.typography.body,
    fontWeight: '700',
    color: t.color.textPrimary,
    marginBottom: 4,
  },
  emptySubtext: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  contentWrap: {
    gap: theme.spacing.sm,
  },
  membersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  memberPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(t.color.primaryFg, 0.1),
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
    gap: 4,
  },
  memberName: {
    ...theme.typography.meta,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  memberCount: {
    ...theme.typography.meta,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  itemsList: {
    gap: theme.spacing.xs,
  },
  itemCard: {
    padding: 0,
    overflow: 'hidden',
  },
  itemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  itemPressed: {
    opacity: 0.7,
  },
  itemTextWrap: {
    flex: 1,
  },
  itemClue: {
    ...theme.typography.body,
    fontWeight: '600',
    color: t.color.textPrimary,
    marginBottom: 2,
  },
  itemMeta: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
  },
}));
