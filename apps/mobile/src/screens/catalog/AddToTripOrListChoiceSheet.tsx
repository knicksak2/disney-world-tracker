// Feature: experience-lists, Requirement 17 — AddToTripOrListChoiceSheet
//
// Validates: Requirements 17.1, 17.6
//
// A small, purpose-built two-option modal presented by the
// Floating_Action_Dock's merged "Add to Trip or List" secondary action
// (Ride/Character_Meet/Show on either lens, and Resort). Not a reuse of the
// four-action QuickActionSheet (built for a larger, unrelated action set)
// and not a new generic reusable "action sheet" primitive — this spec needs
// exactly one two-option picker, so a small dedicated component avoids
// premature generalization while still mirroring QuickActionSheet's
// modal/backdrop/dismiss conventions for visual consistency.

import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';

export interface AddToTripOrListChoiceSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onAddToTrip: () => void;
  readonly onAddToList: () => void;
}

export default function AddToTripOrListChoiceSheet({
  visible,
  onClose,
  onAddToTrip,
  onAddToList,
}: AddToTripOrListChoiceSheetProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="add-to-trip-or-list-choice-sheet"
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="add-to-trip-or-list-backdrop">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.dragHandle} />
          <View style={styles.header}>
            <Text style={styles.title}>Add to…</Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="add-to-trip-or-list-close-btn"
            >
              <Ionicons name="close" size={24} color={t.color.textSecondary} />
            </Pressable>
          </View>

          <Pressable
            style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            onPress={onAddToTrip}
            accessibilityRole="button"
            accessibilityLabel="Add to Trip"
            testID="add-to-trip-or-list-choice-trip"
          >
            <View style={styles.iconCircle}>
              <Ionicons name="add" size={22} color={t.color.primaryFg} />
            </View>
            <Text style={styles.optionLabel}>Add to Trip</Text>
            <Ionicons name="chevron-forward" size={18} color={t.color.textSecondary} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            onPress={onAddToList}
            accessibilityRole="button"
            accessibilityLabel="Add to a List"
            testID="add-to-trip-or-list-choice-list"
          >
            <View style={styles.iconCircle}>
              <Ionicons name="list" size={22} color={t.color.primaryFg} />
            </View>
            <Text style={styles.optionLabel}>Add to a List</Text>
            <Ionicons name="chevron-forward" size={18} color={t.color.textSecondary} />
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.color.surface,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    gap: 8,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: t.color.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: t.radius.md,
    backgroundColor: t.color.surfaceAlt,
  },
  optionPressed: {
    opacity: 0.7,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.color.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  optionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
}));
