/**
 * HighlightCard — a tappable Overview-hub highlight / entry card
 * (stats-experience-redesign task 6.5; restyled to the design mockup).
 *
 * Renders one `OverviewHighlight` (produced by `buildOverviewHighlights`) as a
 * tappable card that both teases a dimension's story and acts as an entry point
 * into its detail screen (R1.3, R1.4): a per-dimension colored icon tile, the
 * uppercase title, the headline, optional subtext, and a chevron (or a lock
 * glyph for the ratings unlock tease). Exposed with `accessibilityRole="button"`
 * and a descriptive label conveying both its story and its action (R15.2).
 * Pressing it invokes `onPress`; the hub owns the actual navigation.
 *
 * Validates: Requirements 1.3, 1.4, 15.1, 15.2
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { OverviewHighlight } from '../statsView';
import { Card } from '../../../theme/components';
import { theme } from '../../../theme/theme';

export interface HighlightCardProps {
  /** The curated highlight to render (from `buildOverviewHighlights`). */
  readonly highlight: OverviewHighlight;
  /** Invoked when the card is activated; the hub owns the actual navigation. */
  readonly onPress: () => void;
  readonly testID?: string;
}

/** Per-dimension icon-tile background + glyph tint (matching the mockup). */
const ICON_STYLE: Record<
  OverviewHighlight['id'],
  { readonly bg: string; readonly fg: string }
> = {
  coverage: { bg: '#efe9f7', fg: '#5b2a86' },
  ratings: { bg: '#fff4d6', fg: '#d4a017' },
  interests: { bg: '#efe9f7', fg: '#7e57c2' },
  experiences: { bg: '#e8f4ff', fg: '#2f80ed' },
};

/**
 * Human phrase for the action a highlight performs, derived from its `target`
 * route, so the spoken label can convey where the card goes (R15.2).
 */
function actionPhrase(highlight: OverviewHighlight): string {
  switch (highlight.target.route) {
    case 'CoverageDetail':
      return 'Opens coverage details';
    case 'RatingsDetail':
      return 'Opens ratings details';
    case 'InterestsDetail':
      return 'Opens interests details';
    case 'ExperiencesDetail':
      return 'Opens your experiences';
    default:
      return 'Opens details';
  }
}

/**
 * Compose the single spoken label conveying both the card's story and its
 * action (R15.2): title, headline, optional subtext, lock/complete state, then
 * the destination.
 */
function highlightAccessibilityLabel(highlight: OverviewHighlight): string {
  const parts: string[] = [highlight.title, highlight.headline];
  if (highlight.subtext !== undefined) parts.push(highlight.subtext);
  if (highlight.complete === true) parts.push('Complete');
  if (highlight.locked === true) parts.push('Locked');
  parts.push(actionPhrase(highlight));
  return parts.join('. ');
}

/**
 * A tappable Overview-hub highlight / entry card.
 */
export function HighlightCard({
  highlight,
  onPress,
  testID,
}: HighlightCardProps): JSX.Element {
  const iconStyle = ICON_STYLE[highlight.id];
  return (
    <Card
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={highlightAccessibilityLabel(highlight)}
      style={styles.card}
      {...(testID !== undefined ? { testID } : {})}
    >
      <View style={styles.row}>
        <View style={[styles.iconTile, { backgroundColor: iconStyle.bg }]}>
          <Ionicons name={highlight.icon} size={20} color={iconStyle.fg} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title}>{highlight.title}</Text>
          <Text style={styles.headline} numberOfLines={2}>
            {highlight.headline}
          </Text>
          {highlight.subtext !== undefined ? (
            <Text style={styles.subtext} numberOfLines={1}>
              {highlight.subtext}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={highlight.locked === true ? 'lock-closed' : 'chevron-forward'}
          size={highlight.locked === true ? 16 : 18}
          color={theme.color.textSecondary}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: theme.spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headline: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  subtext: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
});
