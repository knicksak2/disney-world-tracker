import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { StarterChecklistDTO } from '@dwt/shared';

import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { START_HERE_CARD } from './StartHereCard.palette';

export interface StartHereCardProps {
  readonly checklist: StarterChecklistDTO;
  readonly onLogFirst: () => void;
  readonly onStarFavorite: () => void;
  readonly onCreateTrip: () => void;
  readonly onClaimPin: () => void;
  readonly onDismiss: () => void;
}

export default function StartHereCard({
  checklist,
  onLogFirst,
  onStarFavorite,
  onCreateTrip,
  onClaimPin,
  onDismiss,
}: StartHereCardProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(START_HERE_CARD);

  const items = [
    {
      key: 'log',
      testID: 'start-here-item-log',
      label: 'Log your first ride or snack',
      done: checklist.loggedFirstExperience,
      icon: 'flash-outline' as const,
      onPress: onLogFirst,
    },
    {
      key: 'favorite',
      testID: 'start-here-item-favorite',
      label: 'Favorite a ride',
      done: checklist.starredFavorite,
      icon: 'heart-outline' as const,
      onPress: onStarFavorite,
    },
    {
      key: 'trip',
      testID: 'start-here-item-trip',
      label: 'Create or join a trip',
      done: checklist.hasTrip,
      icon: 'map-outline' as const,
      onPress: onCreateTrip,
    },
    {
      key: 'pin',
      testID: 'start-here-item-pin',
      label: 'Claim your first pin',
      done: checklist.claimedPin,
      icon: 'ribbon-outline' as const,
      onPress: onClaimPin,
    },
  ] as const;

  const completedCount = items.filter((item) => item.done).length;
  const percent = Math.round((completedCount / items.length) * 100);

  return (
    <View style={styles.card} testID="home-start-here-card">
      <View style={styles.headerRow}>
        <View style={styles.titleCluster}>
          <View style={styles.eyebrowPill}>
            <Text style={styles.eyebrowText}>START HERE</Text>
          </View>
          <Text style={styles.progressText} testID="start-here-progress">
            {completedCount} of {items.length}
          </Text>
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss Start Here checklist"
          testID="start-here-dismiss-btn"
        >
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>

      <View style={styles.rowsList}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            style={({ pressed }) => [
              styles.row,
              item.done && styles.rowDone,
              pressed && styles.pressed,
            ]}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityState={{ checked: item.done }}
            testID={item.testID}
          >
            <Ionicons
              name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
              size={18}
              color={item.done ? pal.doneText : t.color.textSecondary}
            />
            <Text style={[styles.rowLabel, item.done && styles.rowLabelDone]}>
              {item.label}
            </Text>
            <Ionicons
              name={item.icon}
              size={15}
              color={item.done ? pal.doneText : t.color.primaryFg}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    marginHorizontal: t.spacing.md,
    marginBottom: t.spacing.md,
    backgroundColor: START_HERE_CARD[t.scheme].cardBg,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: START_HERE_CARD[t.scheme].cardBorder,
    padding: t.spacing.md,
    gap: t.spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  eyebrowPill: {
    backgroundColor: START_HERE_CARD[t.scheme].badgeBg,
    borderRadius: t.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  eyebrowText: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: START_HERE_CARD[t.scheme].badgeText,
  },
  progressText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: t.color.textSecondary,
  },
  dismissText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: t.color.textSecondary,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: START_HERE_CARD[t.scheme].trackBg,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: t.color.primary,
  },
  rowsList: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: t.radius.md,
    backgroundColor: t.color.surfaceAlt,
  },
  rowDone: {
    backgroundColor: START_HERE_CARD[t.scheme].doneRowBg,
  },
  rowLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  rowLabelDone: {
    color: START_HERE_CARD[t.scheme].doneText,
  },
  pressed: {
    opacity: 0.85,
  },
}));
