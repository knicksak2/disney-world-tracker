import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { makeStyles } from '../../theme/makeStyles';
import { usePalette } from '../../theme/useAppTheme';
import { ZERO_PINS_STARTER } from './ZeroPinsStarterCard.palette';

export interface ZeroPinsStarterCardProps {
  readonly onLogFirstRide: () => void;
  readonly onBrowseBoard: () => void;
}

export default function ZeroPinsStarterCard({
  onLogFirstRide,
  onBrowseBoard,
}: ZeroPinsStarterCardProps): JSX.Element {
  const styles = useStyles();
  const pal = usePalette(ZERO_PINS_STARTER);

  return (
    <View style={styles.card} testID="zero-pins-starter-card">
      <View style={styles.topRow}>
        <View style={styles.iconWrap}>
          <Ionicons name="ribbon" size={24} color={pal.iconColor} />
        </View>
        <View style={styles.eyebrowPill}>
          <Ionicons name="sparkles" size={11} color={pal.badgeText} />
          <Text style={styles.eyebrowText}>FIRST PIN STARTER</Text>
        </View>
      </View>

      <Text style={styles.title}>Earn Your First Collectible Pin</Text>
      <Text style={styles.body}>
        Collectible pins unlock automatically when you log rides, try snacks, or check in at resorts. Log one favorite right now to earn your first Bronze Pin!
      </Text>

      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          onPress={onLogFirstRide}
          accessibilityRole="button"
          accessibilityLabel="Log your first ride to earn a collectible pin"
          testID="zero-pins-log-ride-cta"
        >
          <Ionicons name="add-circle-outline" size={17} color={pal.ctaText} />
          <Text style={styles.primaryBtnText}>Log Your First Ride</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={onBrowseBoard}
          accessibilityRole="button"
          accessibilityLabel="Browse all collectible pins"
          testID="zero-pins-browse-board"
        >
          <Text style={styles.secondaryBtnText}>Browse All Pins ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: ZERO_PINS_STARTER[t.scheme].cardBg,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: ZERO_PINS_STARTER[t.scheme].cardBorder,
    padding: t.spacing.md,
    gap: t.spacing.sm,
    marginBottom: t.spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: ZERO_PINS_STARTER[t.scheme].iconBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrowPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: ZERO_PINS_STARTER[t.scheme].badgeBg,
    borderWidth: 1,
    borderColor: ZERO_PINS_STARTER[t.scheme].badgeBorder,
    borderRadius: t.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eyebrowText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: ZERO_PINS_STARTER[t.scheme].badgeText,
  },
  title: {
    ...t.typography.heading,
    fontSize: 18,
    fontWeight: '800',
    color: t.color.textPrimary,
  },
  body: {
    fontSize: 13.5,
    lineHeight: 19,
    color: t.color.textSecondary,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: ZERO_PINS_STARTER[t.scheme].ctaBg,
    borderRadius: t.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  primaryBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: ZERO_PINS_STARTER[t.scheme].ctaText,
  },
  secondaryBtn: {
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  pressed: {
    opacity: 0.85,
  },
}));
