// Feature: photo-uploads, Task 22.7 — superlative award card shared by the Trip Summary
// and the Trip Recap screens (Requirement 15.23).
//
// Moved verbatim from TripSummaryScreen.tsx (`SuperlativeCard`). The prop type is
// structural so both `TripSuperlativeDTO` and `TripRecapSuperlativeDTO` satisfy it.
// It only ever displays a display name or an Experience name, never an id.

import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme, withAlpha } from '../../../theme/theme';
import { makeStyles } from '../../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../../theme/useAppTheme';
import { Card } from '../../../theme/components';
import { SUMMARY_MISC } from '../TripSummaryScreen.palette';

export interface SummaryAward {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly memberDisplayName?: string | undefined;
  readonly experienceName?: string | undefined;
  readonly value?: string | number | undefined;
}

const AWARD_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  trophy: 'trophy',
  compass: 'compass',
  people: 'people',
  star: 'star',
  sparkles: 'sparkles',
  map: 'map',
};

/** Glyph for an award's `icon` key; `ribbon` for an unknown key. */
export function awardIconName(icon: string): keyof typeof Ionicons.glyphMap {
  return AWARD_ICONS[icon] ?? 'ribbon';
}

export function SummaryAwardCard({
  award,
  testID,
}: {
  readonly award: SummaryAward;
  readonly testID: string;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const misc = usePalette(SUMMARY_MISC);

  return (
    <Card style={styles.superlativeCard} testID={testID}>
      <View style={styles.superlativeHeader}>
        <View style={styles.superlativeIconDisc}>
          <Ionicons name={awardIconName(award.icon)} size={18} color={misc.trophy} />
        </View>
        <View style={styles.superlativeTitleCol}>
          <Text style={styles.superlativeTitle}>{award.title}</Text>
          <Text style={styles.superlativeDesc}>{award.description}</Text>
        </View>
      </View>

      <View style={styles.superlativeWinnerRow}>
        <View style={styles.winnerIdentity}>
          <Ionicons name="medal" size={14} color={t.color.accent} />
          <Text style={styles.winnerText} numberOfLines={1}>
            {award.memberDisplayName ?? award.experienceName ?? 'The Group'}
          </Text>
        </View>
        {award.value !== undefined ? (
          <View style={styles.winnerValuePill}>
            <Text style={styles.winnerValueText}>{String(award.value)}</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  superlativeCard: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: t.color.accent,
  },
  superlativeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  superlativeIconDisc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: withAlpha(t.color.accent, 0.15),
    alignItems: 'center',
    justifyContent: 'center',
  },
  superlativeTitleCol: {
    flex: 1,
    gap: 2,
  },
  superlativeTitle: {
    ...theme.typography.subtitle,
    fontSize: 16,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  superlativeDesc: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
  },
  superlativeWinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.sm,
  },
  winnerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  winnerText: {
    ...theme.typography.subtitle,
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  winnerValuePill: {
    backgroundColor: SUMMARY_MISC[t.scheme].winnerValueBg,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
  },
  winnerValueText: {
    ...theme.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '700',
    fontSize: 12,
  },
}));
