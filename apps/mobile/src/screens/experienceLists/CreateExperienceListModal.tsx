/**
 * CreateExperienceListModal — the "create a new Experience_List" modal,
 * extracted out of `MyExperienceListsScreen.tsx` so it can be shared between
 * that screen and `CollectionScreen.tsx`'s "+ New" action on the "My
 * Experience Lists" card (navigation-redesign Requirement 6 amendment 8c).
 * Direct structural port of `CreateFoodListModal.tsx` — same pattern, minus
 * the checklist toggle (Experience_List has no `isChecklist` concept).
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
import type { ExperienceListDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';

export interface CreateExperienceListModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Called with the newly created Experience_List once the POST succeeds; the modal closes itself immediately after. */
  readonly onCreated: (newList: ExperienceListDTO) => void;
}

export default function CreateExperienceListModal({
  visible,
  onClose,
  onCreated,
}: CreateExperienceListModalProps): JSX.Element {
  const [newListName, setNewListName] = useState('');
  const [newListVisibility, setNewListVisibility] = useState<'private' | 'public'>('private');
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
      const created = await apiRequest<ExperienceListDTO>('POST', '/me/experience-lists', {
        name: trimmed,
        visibility: newListVisibility,
      });
      setNewListName('');
      setNewListVisibility('private');
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
      testID="create-experience-list-modal"
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Create Experience List</Text>
          <TextInput
            value={newListName}
            onChangeText={(text) => {
              setNewListName(text);
              if (createError) setCreateError(null);
            }}
            placeholder="e.g. Thrill Rides"
            placeholderTextColor={theme.color.textSecondary}
            style={styles.modalInput}
            autoFocus
            testID="new-experience-list-name-input"
          />

          <View style={styles.visibilityToggleRow}>
            <Text style={styles.visibilityLabel}>Visibility:</Text>
            <View style={styles.visToggleGroup}>
              <Pressable
                onPress={() => setNewListVisibility('private')}
                style={[styles.visPill, newListVisibility === 'private' && styles.visPillActive]}
                testID="new-experience-list-visibility-private"
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
                testID="new-experience-list-visibility-public"
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

          {createError ? (
            <Text style={styles.modalErrorText} testID="create-experience-list-error">
              {createError}
            </Text>
          ) : null}

          <View style={styles.modalActions}>
            <Pressable
              onPress={handleRequestClose}
              style={styles.modalCancelBtn}
              testID="cancel-create-experience-list-btn"
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
              testID="submit-create-experience-list-btn"
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
