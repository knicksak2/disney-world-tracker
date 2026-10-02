import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FoodItemDTO, FoodListDetailDTO, FoodListDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';

export interface AddToListsSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly foodItems: readonly FoodItemDTO[];
  readonly onComplete?: () => void;
}

export default function AddToListsSheet({
  visible,
  onClose,
  foodItems,
  onComplete,
}: AddToListsSheetProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const hasCheckedPreselectionsRef = useRef(false);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [initialSelectedListIds, setInitialSelectedListIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [isSubmittingNewList, setIsSubmittingNewList] = useState(false);

  // Fetch owned food lists (Requirement 9.2 / 9.6: restricted to owned food lists)
  const ownedListsQuery = useQuery<readonly FoodListDTO[]>({
    queryKey: ['my-owned-food-lists'],
    queryFn: () => apiRequest<readonly FoodListDTO[]>('GET', '/me/food-lists'),
    enabled: visible,
  });

  const ownedLists = ownedListsQuery.data ?? [];

  // When visible, fetch detail for owned lists to determine pre-selection (Requirement 9.3)
  useEffect(() => {
    if (
      !visible ||
      hasCheckedPreselectionsRef.current ||
      ownedLists.length === 0 ||
      foodItems.length === 0
    ) {
      return;
    }

    let isMounted = true;
    async function checkPreselections(): Promise<void> {
      const targetItemIds = new Set(foodItems.map((f) => f.id));
      const preselected = new Set<string>();

      await Promise.all(
        ownedLists.map(async (list) => {
          try {
            const detail = await apiRequest<FoodListDetailDTO>('GET', `/food-lists/${list.id}`);
            const hasItem = detail.items.some((item) => targetItemIds.has(item.foodItemId));
            if (hasItem) {
              preselected.add(list.id);
            }
          } catch {
            // Ignore error fetching detail
          }
        }),
      );

      if (isMounted) {
        hasCheckedPreselectionsRef.current = true;
        setSelectedListIds((prev) => new Set([...prev, ...preselected]));
        setInitialSelectedListIds(new Set(preselected));
      }
    }

    void checkPreselections();

    return () => {
      isMounted = false;
    };
  }, [visible, ownedLists.length, foodItems]);

  useEffect(() => {
    if (!visible) {
      hasCheckedPreselectionsRef.current = false;
      setSelectedListIds(new Set());
      setInitialSelectedListIds(new Set());
      setIsCreatingList(false);
      setNewListName('');
    }
  }, [visible]);

  function toggleListSelection(listId: string): void {
    setSelectedListIds((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) {
        next.delete(listId);
      } else {
        next.add(listId);
      }
      return next;
    });
  }

  async function handleCreateInlineList(): Promise<void> {
    const trimmed = newListName.trim();
    if (!trimmed || isSubmittingNewList) return;

    setIsSubmittingNewList(true);
    try {
      const created = await apiRequest<FoodListDTO>('POST', '/me/food-lists', {
        name: trimmed,
        visibility: 'private',
      });

      // Auto-select the newly created list
      setSelectedListIds((prev) => new Set(prev).add(created.id));
      setNewListName('');
      setIsCreatingList(false);

      await queryClient.invalidateQueries({ queryKey: ['my-owned-food-lists'] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
    } catch {
      // Swallowed or handled
    } finally {
      setIsSubmittingNewList(false);
    }
  }

  async function handleConfirm(): Promise<void> {
    if (isSaving || selectedListIds.size === 0) return;
    setIsSaving(true);

    try {
      const newlySelected = Array.from(selectedListIds).filter(
        (id) => !initialSelectedListIds.has(id),
      );
      const newlyDeselected = Array.from(initialSelectedListIds).filter(
        (id) => !selectedListIds.has(id),
      );

      // Perform additions
      for (const listId of newlySelected) {
        for (const foodItem of foodItems) {
          try {
            await apiRequest('POST', `/me/food-lists/${listId}/items`, {
              foodItemId: foodItem.id,
            });
          } catch (err) {
            // Requirement 9.4: swallow food_list_item_duplicate
            if (err instanceof ApiError && err.code === 'food_list_item_duplicate') {
              // Expected duplicate, treat as satisfied
              continue;
            }
          }
        }
        await queryClient.invalidateQueries({ queryKey: ['food-list-detail', listId] });
      }

      // Perform removals
      for (const listId of newlyDeselected) {
        for (const foodItem of foodItems) {
          try {
            await apiRequest('DELETE', `/me/food-lists/${listId}/items/${foodItem.id}`);
          } catch {
            // Ignore not found
          }
        }
        await queryClient.invalidateQueries({ queryKey: ['food-list-detail', listId] });
      }

      await queryClient.invalidateQueries({ queryKey: ['my-owned-food-lists'] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });

      onComplete?.();
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  // Stable `renderItem` identity — an inline arrow literal is recreated every
  // render, which `FlatList`/`VirtualizedList` treats as a changed render
  // function and forces expensive re-render/re-measure work even when the row
  // is otherwise unchanged (see the same fix in `DestinationScreen.tsx`).
  // Placed before the `if (!visible) return null;` early return below so the
  // hook always runs, satisfying React's Rules of Hooks.
  const renderOwnedList = useCallback(
    ({ item }: { item: FoodListDTO }) => {
      const isSelected = selectedListIds.has(item.id);
      return (
        <Pressable
          onPress={() => toggleListSelection(item.id)}
          style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={`List ${item.name}`}
          testID={`food-list-checkbox-row-${item.id}`}
        >
          <Ionicons
            name={isSelected ? 'checkbox' : 'square-outline'}
            size={22}
            color={isSelected ? theme.color.primary : theme.color.textSecondary}
          />
          <View style={styles.listRowInfo}>
            <Text style={styles.listRowName}>{item.name}</Text>
            <Text style={styles.listRowMeta}>
              {item.itemCount} items • {item.visibility}
            </Text>
          </View>
        </Pressable>
      );
    },
    [selectedListIds, toggleListSelection],
  );

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      testID="add-to-lists-sheet"
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.title}>Add to Lists</Text>
              <Text style={styles.subtitle}>
                Select lists to include {foodItems.length === 1 ? `"${foodItems[0]!.name}"` : `${foodItems.length} dishes`}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close add to lists sheet"
              style={styles.closeBtn}
              testID="close-add-to-lists-btn"
            >
              <Ionicons name="close" size={24} color={theme.color.textSecondary} />
            </Pressable>
          </View>

          {/* Create New List Inline Section */}
          {isCreatingList ? (
            <View style={styles.createSection}>
              <TextInput
                value={newListName}
                onChangeText={setNewListName}
                placeholder="New list name..."
                placeholderTextColor={theme.color.textSecondary}
                style={styles.createInput}
                autoFocus
                testID="create-list-name-input"
              />
              <View style={styles.createActions}>
                <Pressable
                  onPress={() => setIsCreatingList(false)}
                  style={styles.cancelBtn}
                  testID="cancel-create-list-btn"
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleCreateInlineList()}
                  disabled={!newListName.trim() || isSubmittingNewList}
                  style={[
                    styles.submitCreateBtn,
                    (!newListName.trim() || isSubmittingNewList) && styles.submitCreateBtnDisabled,
                  ]}
                  testID="submit-create-list-btn"
                >
                  {isSubmittingNewList ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.submitCreateBtnText}>Create</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setIsCreatingList(true)}
              style={styles.inlineAddListBtn}
              accessibilityRole="button"
              accessibilityLabel="Create new list"
              testID="inline-create-list-btn"
            >
              <Ionicons name="add-circle" size={20} color={theme.color.primary} />
              <Text style={styles.inlineAddListText}>Create new list</Text>
            </Pressable>
          )}

          {/* Owned Lists Checklist */}
          {ownedListsQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={theme.color.primary} testID="add-to-lists-loading" />
            </View>
          ) : (
            <FlatList
              data={ownedLists}
              keyExtractor={(item) => item.id}
              renderItem={renderOwnedList}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText} testID="add-to-lists-empty">
                    No lists yet. Create your first list above!
                  </Text>
                </View>
              }
              contentContainerStyle={styles.listContent}
            />
          )}

          {/* Save Button */}
          <View style={styles.footer}>
            <Pressable
              onPress={() => void handleConfirm()}
              disabled={isSaving || selectedListIds.size === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: isSaving || selectedListIds.size === 0 }}
              accessibilityLabel="Save list selections"
              style={[
                styles.saveBtn,
                (isSaving || selectedListIds.size === 0) && styles.saveBtnDisabled,
              ]}
              testID="add-to-lists-save-btn"
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Save</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '80%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  headerTitles: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  inlineAddListBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: theme.spacing.md,
    backgroundColor: 'rgba(107, 70, 193, 0.06)',
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  inlineAddListText: {
    color: theme.color.primary,
    fontWeight: '600',
    fontSize: 15,
  },
  createSection: {
    padding: theme.spacing.md,
    backgroundColor: theme.color.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  createInput: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: theme.color.textPrimary,
  },
  createActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 10,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: theme.radius.sm,
  },
  cancelBtnText: {
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  submitCreateBtn: {
    backgroundColor: theme.color.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: theme.radius.sm,
  },
  submitCreateBtnDisabled: {
    opacity: 0.5,
  },
  submitCreateBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  loadingWrap: {
    padding: 32,
    alignItems: 'center',
  },
  listContent: {
    paddingVertical: 8,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    gap: 12,
  },
  listRowPressed: {
    backgroundColor: theme.color.surfaceAlt,
  },
  listRowInfo: {
    flex: 1,
  },
  listRowName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  listRowMeta: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  emptyWrap: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.color.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  saveBtn: {
    backgroundColor: theme.color.primary,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
