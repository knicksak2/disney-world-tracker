// Feature: food-lists, Task 19.6 — Action-scoped undo toast for a mark-gotten submission
//
// Validates: Requirements 13.16, 13.17, 13.18
//
// A self-contained, per-instance transient toast — deliberately NOT the
// cross-screen `foodListNotice.ts` store, since this needs to carry a
// specific `logId`/`foodItemId` payload and auto-dismiss on a timer,
// neither of which that store (a single optional string, consumed once on
// next mount) supports. `FoodListDetailScreen` renders one of these per
// active mark-gotten submission (Requirement 13.18 — multiple can coexist),
// each independently timed and keyed to the specific log it can undo
// (Requirement 13.17 — never "the most recent log for this item").

import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../../theme/theme';

export interface MarkGottenUndoToastProps {
  /** The Food_Item's display name, shown in the toast's message. */
  readonly itemName: string;
  /** Activating "Undo" reverts the specific log this toast was created for. */
  readonly onUndo: () => void;
  /** Called when the toast should be removed — on timeout or after undo. */
  readonly onDismiss: () => void;
  /** How long the toast stays visible before auto-dismissing, in ms. */
  readonly durationMs?: number;
}

const DEFAULT_DURATION_MS = 5000;

export default function MarkGottenUndoToast({
  itemName,
  onUndo,
  onDismiss,
  durationMs = DEFAULT_DURATION_MS,
}: MarkGottenUndoToastProps): JSX.Element {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = setTimeout(() => {
      onDismissRef.current();
    }, durationMs);
    return () => clearTimeout(timer);
    // Intentionally does not depend on `onDismiss` directly — a new
    // `onDismiss` identity on every parent re-render (common with an
    // inline arrow function) must not restart this toast's countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  function handleUndo(): void {
    onUndo();
    onDismiss();
  }

  return (
    <View style={styles.toast} testID="mark-gotten-undo-toast">
      <Ionicons name="checkmark-circle" size={18} color={theme.color.success} />
      <Text style={styles.message} numberOfLines={2}>
        Ate this: {itemName}
      </Text>
      <Pressable
        onPress={handleUndo}
        accessibilityRole="button"
        accessibilityLabel={`Undo: ${itemName}`}
        style={styles.undoBtn}
        testID="mark-gotten-undo-btn"
      >
        <Text style={styles.undoText}>Undo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.color.textPrimary,
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: theme.color.textOnPrimary,
  },
  undoBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  undoText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.accent,
  },
});
