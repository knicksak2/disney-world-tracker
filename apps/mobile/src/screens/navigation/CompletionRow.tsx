/**
 * CompletionRow — the shared per-entry row for a Completion_Entry (task 5.3).
 *
 * Extracted from the inline row previously rendered by
 * `FriendProfileScreen.tsx` so the Parks, Categories, and Experiences modes —
 * and both the Friend_Profile_View and the Own_Stats_View — render entries
 * identically. Every row shows the Experience name, the Completion date as a
 * calendar date, the Rating when one is present (omitted when absent), and the
 * shared Note text when one is present (omitted when absent) (R3.5, R4.4,
 * R5.2, R13.2).
 *
 * The `fields` prop selects the contextual metadata line so each mode shows
 * only the fields it needs:
 *
 *   - `'parks'`       → omits the Park (it is implied by the Park_Group), so
 *                       the meta line is `Category · date`.
 *   - `'categories'`  → omits the Category (implied by the Category_Group), so
 *                       the meta line is `Park · date`.
 *   - `'experiences'` → shows both, so the meta line is `Park · Category · date`.
 *
 * The Completion date is parsed from its `YYYY-MM-DD` string parts rather than
 * `new Date()` so the rendered day never shifts with the device's time zone.
 *
 * When an `onOpenExperience` callback is supplied and the entry resolves to a
 * navigation target (`resolveExperienceTarget`), the whole row becomes a single
 * activatable control (`accessibilityRole="button"` with an accessibility label
 * that includes the Experience name) that calls `onOpenExperience(target)` on
 * tap or assistive activation (R4.1, R4.2, R4.3). When no callback is supplied
 * or the target is unavailable, the row renders exactly as a plain,
 * non-activatable card that ignores taps (R4.4, R6.1, R6.2).
 *
 * Validates: Requirements 3.5, 4.1, 4.2, 4.3, 4.4, 5.2, 6.1, 6.2, 13.2
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CompletionEntryDTO, ExperienceCategory } from '@dwt/shared';

import { theme } from '../../theme/theme';
import { Badge, Card } from '../../theme/components';
import { resolveExperienceTarget } from './experienceNavigation';

// ---------------------------------------------------------------------------
// Fields selector
// ---------------------------------------------------------------------------

/**
 * Selects which contextual metadata the row's meta line shows. The Completion
 * date is always shown; `fields` only governs whether the Park and/or Category
 * appear:
 *
 *   - `'parks'`       omits the Park (implied by the surrounding Park_Group).
 *   - `'categories'`  omits the Category (implied by the surrounding
 *                     Category_Group).
 *   - `'experiences'` shows both Park and Category.
 */
export type CompletionRowFields = 'parks' | 'categories' | 'experiences';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CompletionRow({
  entry,
  fields,
  onOpenExperience,
  testID,
}: {
  readonly entry: CompletionEntryDTO;
  readonly fields: CompletionRowFields;
  readonly onOpenExperience?: (experienceId: string) => void;
  readonly testID?: string;
}): JSX.Element {
  const metaParts: string[] = [];
  if (fields !== 'parks' && entry.park !== null) {
    metaParts.push(entry.park);
  }
  if (fields !== 'categories') {
    metaParts.push(categoryLabel(entry.category));
  }
  metaParts.push(formatCalendarDate(entry.completedOn));

  // Resolve the navigation target (R6.1, R6.2). The row becomes an activatable
  // control only when a callback is supplied AND a target is available.
  const target = resolveExperienceTarget(entry);
  const activatable = onOpenExperience !== undefined && target !== null;

  return (
    <Card
      style={styles.card}
      {...(testID !== undefined ? { testID } : {})}
      {...(activatable
        ? {
            // Single full-row Pressable spanning the whole card (R4.1). RN maps
            // both direct taps and assistive activation to `onPress` (R4.3).
            onPress: () => onOpenExperience(target),
            accessibilityRole: 'button' as const,
            accessibilityLabel: `${entry.experienceName}, view experience details`,
          }
        : {})}
    >
      <View style={styles.cardHeader}>
        <View style={styles.titleWrap}>
          <View
            style={[styles.categoryDot, { backgroundColor: categoryTint(entry.category) }]}
          />
          <Text style={styles.cardTitle} numberOfLines={2}>
            {entry.experienceName}
          </Text>
        </View>
        {entry.rating !== null ? (
          <Badge
            label={`${entry.rating}/10`}
            color={ratingColor(entry.rating)}
            icon="star"
          />
        ) : null}
      </View>
      <Text style={[styles.completionMeta, styles.metaIndent]}>
        {metaParts.join(' \u00b7 ')}
      </Text>
      {entry.sharedNote !== null ? (
        <Text style={[styles.completionNote, styles.metaIndent]}>{entry.sharedNote}</Text>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Friendly label for an Experience_Category, falling back to the raw enum. */
function categoryLabel(category: ExperienceCategory): string {
  return theme.categoryVisual[category]?.label ?? category;
}

/** The category's accent tint for the row's color dot, matching the coverage /
 * interests dot language; falls back to the brand purple. */
function categoryTint(category: ExperienceCategory): string {
  return theme.categoryVisual[category]?.tint ?? theme.color.primary;
}

/**
 * Map a 1–10 Rating to a palette color so the badge conveys sentiment at a
 * glance: high ratings read green, middling ratings gold, and low ratings
 * raspberry. The `Badge` applies this color to its star icon, text, and tinted
 * background.
 */
function ratingColor(rating: number): string {
  if (rating >= 8) return theme.color.success;
  if (rating >= 5) return theme.color.accentDark;
  return theme.color.danger;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Format a `YYYY-MM-DD` Completion date as a readable calendar date (e.g.
 * "Jan 5, 2024"). Parsed by string parts rather than `new Date()` so the
 * rendered day never shifts with the device's time zone. Falls back to the
 * raw string if it does not match the expected shape.
 */
function formatCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return value;
  const year = match[1];
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const month = MONTHS[monthIndex];
  if (month === undefined) return value;
  return `${month} ${day}, ${year}`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    marginBottom: theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
    gap: theme.spacing.sm,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flexShrink: 1,
  },
  categoryDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  cardTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  metaIndent: {
    // Align the meta / note under the title text, past the 10px dot + 8px gap.
    paddingLeft: 18,
  },
  completionMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  completionNote: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
    marginTop: theme.spacing.sm,
    fontStyle: 'italic',
  },
});
