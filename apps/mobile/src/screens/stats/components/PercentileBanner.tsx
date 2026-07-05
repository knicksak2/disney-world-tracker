/**
 * PercentileBanner — the Overview hub's opt-in "you're ahead of X%" brag line
 * (stats-experience-redesign task 6.5; restyled to the design mockup).
 *
 * Rendered on the Own hub only. Shown iff `percentileRank` is a number
 * (R10.3), decided via the pure `shouldShowPercentile` transform; an absent
 * rank or `percentileUnavailable === true` hides the banner without blocking
 * any other section (R10.4) — this component simply renders `null` in that
 * case. The warm phrasing comes from the pure `phrasePercentile` transform, and
 * the banner is a celebratory gold gradient card with a medal (matching the
 * mockup).
 *
 * The Friend surface never renders this banner (R10.6) by simply not mounting
 * it.
 *
 * Validates: Requirements 10.3, 10.4, 15.1
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import type { StatsResponse } from '../../../api/statsTypes';
import { theme } from '../../../theme/theme';
import { phrasePercentile, shouldShowPercentile } from '../statsView';

export interface PercentileBannerProps {
  /** The loaded stats snapshot; the banner reads only `percentileRank`. */
  readonly stats: StatsResponse;
  readonly testID?: string;
}

/**
 * The percentile brag banner, or `null` when there is no percentile to show.
 */
export function PercentileBanner({
  stats,
  testID,
}: PercentileBannerProps): JSX.Element | null {
  if (!shouldShowPercentile(stats)) return null;
  // `shouldShowPercentile` guarantees `percentileRank` is a number here.
  const phrase = phrasePercentile(stats.percentileRank as number);
  return (
    <LinearGradient
      colors={theme.gradient.gold}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.banner}
      accessible
      accessibilityLabel={phrase}
      testID={testID}
    >
      <Text style={styles.medal}>🏅</Text>
      <View style={styles.textWrap}>
        <Text style={styles.text} numberOfLines={3}>
          {phrase}
        </Text>
        <Text style={styles.sub}>Top-tier explorer status</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    ...theme.shadow.card,
  },
  medal: {
    fontSize: 24,
  },
  textWrap: {
    flexShrink: 1,
    gap: 2,
  },
  text: {
    ...theme.typography.subtitle,
    color: theme.color.textOnAccent,
    flexShrink: 1,
  },
  sub: {
    ...theme.typography.meta,
    color: theme.color.textOnAccent,
    opacity: 0.8,
  },
});
