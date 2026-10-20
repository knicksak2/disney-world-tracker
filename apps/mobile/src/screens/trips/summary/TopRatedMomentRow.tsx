// Feature: photo-uploads, Task 22.7 — top-rated moment row (rank medal, thumbnail, name,
// park badge, rating count and mean rating) shared by the Trip Summary and the Trip
// Recap screens (Requirement 15.23).
//
// Moved verbatim from TripSummaryScreen.tsx, together with `ExperienceThumb`.

import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { ExperienceCategory, Park } from '@dwt/shared';

import { theme, withAlpha } from '../../../theme/theme';
import { makeStyles } from '../../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../../theme/useAppTheme';
import { Badge, Card } from '../../../theme/components';
import { SUMMARY_MEDAL, SUMMARY_MISC } from '../TripSummaryScreen.palette';
import { formatMeanRating, ratingCountLabel } from './summaryFormat';

export interface TopRatedMomentRowProps {
  /** Zero-based rank: 0, 1 and 2 get the gold, silver and bronze medals. */
  readonly rank: number;
  readonly name: string;
  readonly meanRating: number;
  readonly ratingCount: number;
  readonly park?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly imageUrl?: string | null | undefined;
  readonly testID: string;
}

export function TopRatedMomentRow({
  rank,
  name,
  meanRating,
  ratingCount,
  park,
  category,
  imageUrl,
  testID,
}: TopRatedMomentRowProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const medal = usePalette(SUMMARY_MEDAL);

  const rankColor =
    rank === 0
      ? medal.gold
      : rank === 1
        ? medal.silver
        : rank === 2
          ? medal.bronze
          : t.color.surfaceAlt;
  const rankTextColor = rank < 3 ? medal.text : t.color.textSecondary;

  const parkAccentColor =
    park && park in t.parkAccent ? t.parkAccent[park as Park] : t.color.primaryFg;

  return (
    <Card style={styles.rankCard} testID={testID}>
      <View style={[styles.rankBadge, { backgroundColor: rankColor }]}>
        <Text style={[styles.rankBadgeText, { color: rankTextColor }]}>#{rank + 1}</Text>
      </View>

      <ExperienceThumb imageUrl={imageUrl ?? null} category={category ?? null} />

      <View style={styles.rankBody}>
        <Text style={styles.rankName} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.rankMetaRow}>
          {park ? <Badge label={park} color={parkAccentColor} /> : null}
          <Text style={styles.rankMeta}>{ratingCountLabel(ratingCount)}</Text>
        </View>
      </View>

      <View
        style={styles.ratingPill}
        accessible
        accessibilityLabel={`Average rating ${formatMeanRating(meanRating)} out of 10`}
      >
        <Ionicons name="star" size={14} color={t.color.accent} />
        <Text style={styles.ratingPillText}>{formatMeanRating(meanRating)}</Text>
      </View>
    </Card>
  );
}

/** Experience thumbnail image or category placeholder. */
export function ExperienceThumb({
  imageUrl,
  category,
}: {
  readonly imageUrl: string | null;
  readonly category: string | null;
}): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const misc = usePalette(SUMMARY_MISC);
  const [failed, setFailed] = useState(false);
  const visual =
    category !== null && category in t.categoryVisual
      ? t.categoryVisual[category as ExperienceCategory]
      : null;

  if (imageUrl !== null && imageUrl.length > 0 && !failed) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={styles.experienceThumb}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <View
      style={[
        styles.experienceThumb,
        styles.experienceThumbPlaceholder,
        { backgroundColor: visual?.fill ?? t.color.surfaceAlt },
      ]}
    >
      <Ionicons
        name={(visual?.glyph as keyof typeof Ionicons.glyphMap | undefined) ?? 'sparkles'}
        size={18}
        color={misc.thumbGlyph}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  rankCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
  },
  rankBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: {
    ...theme.typography.meta,
    fontWeight: '800',
    fontSize: 13,
  },
  rankBody: {
    flex: 1,
    gap: 4,
  },
  rankName: {
    ...theme.typography.subtitle,
    color: t.color.textPrimary,
    fontSize: 15,
  },
  rankMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  rankMeta: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
    fontSize: 12,
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: withAlpha(t.color.accent, 0.18),
  },
  ratingPillText: {
    ...theme.typography.meta,
    color: t.color.textPrimary,
    fontWeight: '800',
    fontSize: 13,
  },
  experienceThumb: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    backgroundColor: t.color.surface,
  },
  experienceThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
