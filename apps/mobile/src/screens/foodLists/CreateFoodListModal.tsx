/**
 * CreateFoodListModal — the "create a new Food_List" modal, extracted out of
 * `MyFoodListsScreen.tsx` so it can be shared between that screen and
 * `CollectionScreen.tsx`'s "+ New" action on the "My Food Lists" card
 * (navigation-redesign Requirement 6 amendment 8c). Behavior, styling, and
 * testIDs are unchanged from the pre-extraction inline modal — this is a
 * relocation, not a rebuild.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { FoodListDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';

export interface CreateFoodListModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Called with the newly created Food_List once the POST succeeds; the modal closes itself immediately after. */
  readonly onCreated: (newList: FoodListDTO) => void;
}

export default function CreateFoodListModal({
  visible,
  onClose,
  onCreated,
}: CreateFoodListModalProps): JSX.Element {
  const [newListName, setNewListName] = useState('');
  const [newListVisibility, setNewListVisibility] = useState<'private' | 'public'>('private');
  const [newListIsChecklist, setNewListIsChecklist] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function handleRequestClose(): void {
    setCreateError(null);
    onClose();
  }

  async function handleCreateList(): Promise<void> {
    const trimmed = newListName.trim();
    if (!trimmed || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const created = await apiRequest<FoodListDTO>('POST', '/me/food-lists', {
        name: trimmed,
        visibility: newListVisibility,
        isChecklist: newListIsChecklist,
      });
      setNewListName('');
      setNewListVisibility('private');
      setNewListIsChecklist(false);
      setCreateError(null);
      onCreated(created);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create list. Please try again.',
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleRequestClose}
      testID="create-food-list-modal"
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Create Food List</Text>
          <TextInput
            value={newListName}
            onChangeText={(text) => {
              setNewListName(text);
              if (createError) setCreateError(null);
            }}
            placeholder="e.g. Best Epcot Snacks"
            placeholderTextColor={theme.color.textSecondary}
            style={styles.modalInput}
            autoFocus
            testID="new-food-list-name-input"
          />

          <View style={styles.visibilityToggleRow}>
            <Text style={styles.visibilityLabel}>Visibility:</Text>
            <View style={styles.visToggleGroup}>
              <Pressable
                onPress={() => setNewListVisibility('private')}
                style={[styles.visPill, newListVisibility === 'private' && styles.visPillActive]}
                testID="new-food-list-visibility-private"
              >
                <Text
                  style={[
                    styles.visPillText,
                    newListVisibility === 'private' && styles.visPillTextActive,
                  ]}
                >
                  Private
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setNewListVisibility('public')}
                style={[styles.visPill, newListVisibility === 'public' && styles.visPillActive]}
                testID="new-food-list-visibility-public"
              >
                <Text
                  style={[
                    styles.visPillText,
                    newListVisibility === 'public' && styles.visPillTextActive,
                  ]}
                >
                  Public
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.visibilityToggleRow}>
            <Text style={styles.visibilityLabel}>Track as a checklist:</Text>
            <View style={styles.visToggleGroup}>
              <Pressable
                onPress={() => setNewListIsChecklist(false)}
                style={[styles.visPill, !newListIsChecklist && styles.visPillActive]}
                accessibilityRole="button"
                accessibilityLabel="Do not track as a checklist"
                testID="new-food-list-checklist-off"
              >
                <Text
                  style={[styles.visPillText, !newListIsChecklist && styles.visPillTextActive]}
                >
                  No
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setNewListIsChecklist(true)}
                style={[styles.visPill, newListIsChecklist && styles.visPillActive]}
                accessibilityRole="button"
                accessibilityLabel="Track as a checklist"
                testID="new-food-list-checklist-toggle"
              >
                <Text
                  style={[styles.visPillText, newListIsChecklist && styles.visPillTextActive]}
                >
                  Yes
                </Text>
              </Pressable>
            </View>
          </View>

          {createError ? (
            <Text style={styles.modalErrorText} testID="create-food-list-error">
              {createError}
            </Text>
          ) : null}

          <View style={styles.modalActions}>
            <Pressable
              onPress={handleRequestClose}
              style={styles.modalCancelBtn}
              testID="cancel-create-food-list-btn"
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleCreateList()}
              disabled={!newListName.trim() || isCreating}
              style={[
                styles.modalSubmitBtn,
                (!newListName.trim() || isCreating) && styles.modalSubmitBtnDisabled,
              ]}
              testID="submit-create-food-list-btn"
            >
              {isCreating ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.modalSubmitText}>Create</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContainer: {
    backgroundColor: theme.color.surface,
    width: '100%',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  modalInput: {
    backgroundColor: theme.color.background,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.color.textPrimary,
  },
  visibilityToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  visibilityLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  visToggleGroup: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 2,
  },
  visPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.sm - 2,
  },
  visPillActive: {
    backgroundColor: theme.color.primary,
  },
  visPillText: {
    fontSize: 11,
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  visPillTextActive: {
    color: '#fff',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  modalErrorText: {
    color: theme.color.danger,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 8,
    marginBottom: 4,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  modalSubmitBtn: {
    backgroundColor: theme.color.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: theme.radius.md,
  },
  modalSubmitBtnDisabled: {
    opacity: 0.5,
  },
  modalSubmitText: {
    color: '#fff',
    fontWeight: '700',
  },
});
