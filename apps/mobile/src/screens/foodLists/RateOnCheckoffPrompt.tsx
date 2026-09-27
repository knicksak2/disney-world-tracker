// Feature: food-lists, Task 19.2 — Optional rating prompt on checklist mark-gotten
//
// Validates: Requirements 13.15
//
// A small, purpose-built prompt shown when the User marks a Checklist
// Food_List item gotten. Deliberately NOT a reuse of `LogFoodItemModal`
// (from `food-item-logging`) — that modal carries a date picker (mark-gotten
// always uses today's date, Requirement 13.6, unchanged) and a note field
// this flow never asked for. Only its 1-10 rating-button-grid *styling* is
// reused here, not the component itself, to keep the checklist interaction
// fast and skippable.

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../../theme/theme';
import { PrimaryButton, SecondaryButton } from '../../theme/components';

export interface RateOnCheckoffPromptProps {
  /** Whether the prompt is presented. */
  readonly visible: boolean;
  /** The Food_Item's display name, shown in the prompt's title. */
  readonly foodItemName: string;
  /** Pre-selected rating when editing an existing rating after the fact. */
  readonly initialRating?: number | null | undefined;
  /**
   * Skip without a rating. Also invoked when the prompt is dismissed
   * (backdrop / hardware back) without a rating having been selected —
   * Requirement 13.15 treats "skip" and "dismiss without selecting" as the
   * same outcome, never blocking the mark-gotten submission.
   */
  readonly onSkip: () => void;
  /** Confirm with a selected 1-10 rating. */
  readonly onConfirm: (rating: number) => void;
}

const RATING_VALUES: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// The rating grid is a fixed 5-column layout (2 rows of 5), built as two
// explicit row groups rather than one `flexWrap: 'wrap'` container. RN's
// `flexWrap` + `justifyContent: 'space-between'` justifies EACH wrapped
// row independently to fill the full container width — with 10 buttons
// wrapping into two 5-button rows this can visibly differ from a plain
// evenly-gapped grid, which is what produced the uneven-looking spacing.
// Chunking into fixed rows and using a single `gap` (no `space-between`)
// on each row avoids that entirely: every gap, row and column, is the
// same literal value.
const RATING_GRID_COLUMNS = 5;

function chunk<T>(items: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

const RATING_VALUE_ROWS = chunk(RATING_VALUES, RATING_GRID_COLUMNS);

export default function RateOnCheckoffPrompt({
  visible,
  foodItemName,
  initialRating,
  onSkip,
  onConfirm,
}: RateOnCheckoffPromptProps): JSX.Element | null {
  const [rating, setRating] = useState<number | null>(initialRating ?? null);

  React.useEffect(() => {
    if (visible) {
      setRating(initialRating ?? null);
    }
  }, [visible, initialRating]);

  if (!visible) {
    return null;
  }

  const isEditing = initialRating !== undefined && initialRating !== null;

  function handleDismiss(): void {
    // Requirement 13.15: dismissal without a selection is a skip, not a
    // cancel — the mark-gotten submission still proceeds, with no rating.
    setRating(null);
    onSkip();
  }

  function handleSkip(): void {
    setRating(null);
    onSkip();
  }

  function handleConfirm(): void {
    if (rating === null) return;
    const selected = rating;
    setRating(null);
    onConfirm(selected);
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleDismiss}
      testID="rate-on-checkoff-prompt"
    >
      <Pressable
        style={styles.backdrop}
        onPress={handleDismiss}
        accessibilityLabel="Dismiss rating prompt"
        testID="rate-on-checkoff-backdrop"
      >
        {/* A plain `View` (not `Pressable`) so a tap inside the sheet never
            bubbles to the backdrop's `onPress` in the first place — no
            `stopPropagation()` needed, which React Native's synthetic
            touch events don't reliably expose in every environment. */}
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Ionicons name="restaurant" size={22} color={theme.color.primary} />
            <Text style={styles.title} numberOfLines={2}>
              {foodItemName}
            </Text>
          </View>
          {/* Never concatenate punctuation directly onto `foodItemName` —
              a menu-sourced name can itself end in an asterisk or other
              trailing mark (e.g. "Roasted Lamb Chop*"), which produced a
              garbled "...Chop*? (Optional)" when a "?" was appended after
              it. The name is isolated in its own `Text` above; this line
              never touches it. */}
          <Text style={styles.subtitle} numberOfLines={1}>
            {isEditing ? 'Update rating (1–10)' : 'Rate this dish? (Optional)'}
          </Text>

          <View style={styles.ratingGrid}>
            {RATING_VALUE_ROWS.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.ratingRow}>
                {row.map((val) => {
                  const isSelected = rating === val;
                  return (
                    <Pressable
                      key={val}
                      onPress={() => setRating(isSelected ? null : val)}
                      accessibilityRole="button"
                      accessibilityLabel={`Rate ${foodItemName} ${val} out of 10`}
                      accessibilityState={{ selected: isSelected }}
                      style={[styles.ratingBtn, isSelected && styles.ratingBtnSelected]}
                      testID={`rate-on-checkoff-rating-btn-${val}`}
                    >
                      <Text
                        style={[styles.ratingBtnText, isSelected && styles.ratingBtnTextSelected]}
                      >
                        {val}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          {/* Confirm only appears once a rating is actually selected —
              rather than rendering it disabled from the start (a
              half-opacity gradient button that looks broken more than
              inactive), "Skip" alone is the available action until a
              rating is chosen, at which point Confirm naturally appears. */}
          <View style={styles.actionsRow}>
            <View style={styles.actionBtn}>
              <SecondaryButton
                label={isEditing ? 'Cancel' : 'Skip'}
                onPress={handleSkip}
                testID="rate-on-checkoff-skip-btn"
              />
            </View>
            {rating !== null ? (
              <View style={styles.actionBtn}>
                <PrimaryButton
                  label={`Confirm (${rating}/10)`}
                  onPress={handleConfirm}
                  testID="rate-on-checkoff-confirm-btn"
                />
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: theme.color.textSecondary,
  },
  // Vertical gap between the two fixed rows (see `RATING_VALUE_ROWS` above).
  ratingGrid: {
    gap: 6,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: 6,
  },
  ratingBtn: {
    // Each row always has exactly `RATING_GRID_COLUMNS` items (chunked
    // above), so `flex: 1` alone divides the row evenly with the
    // container's `gap` handling spacing between them — identical to how
    // the row above it divides, since both rows share the same column
    // count. No `justifyContent: 'space-between'` and no percentage-vs-gap
    // arithmetic, which is what produced uneven spacing before.
    flex: 1,
    aspectRatio: 1,
    minWidth: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.color.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.surfaceAlt,
  },
  ratingBtnSelected: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  ratingBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  ratingBtnTextSelected: {
    color: theme.color.textOnPrimary,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
  },
});
