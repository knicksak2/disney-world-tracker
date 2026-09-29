import React, { useCallback, useEffect, useState } from 'react';
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
import type { ExperienceListDetailDTO, ExperienceListDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';

/**
 * `AddToExperienceListsSheet` — structural port of `foodLists/AddToListsSheet.tsx`
 * (Feature: experience-lists, Task 11.1).
 *
 * Differs from that precedent in:
 *   - Operates on a single Experience at a time (`experienceId`/`experienceName`),
 *     not an array — Requirement 9.1/9.2's entry point is Experience Detail for
 *     one Eligible Experience, unlike food-lists' multi-dish picker call site.
 *   - Fetches owned Experience_Lists (`GET /me/experience-lists`) and each list's
 *     detail (`GET /experience-lists/:id`) to pre-check membership by
 *     `experienceId` (Requirement 9.3), restricted to owned lists only
 *     (Requirement 9.6).
 *   - Adds/removes via `POST /me/experience-lists/:id/items` `{ experienceId }`
 *     and `DELETE /me/experience-lists/:id/items/:experienceId`.
 *   - Swallows `experience_list_item_duplicate` on add (Requirement 9.4).
 *   - Creates a list via `POST /me/experience-lists` `{ name, visibility: 'private' }`.
 *   - Query keys (`my-owned-experience-lists`, `experience-list-detail`,
 *     `experience-lists-collection`) match the ones `MyExperienceListsScreen.tsx`/
 *     `ExperienceListDetailScreen.tsx` already invalidate/read, so this sheet's
 *     writes are reflected there without a stale cache.
 *   - testIDs are scoped to `experience-list-*`/`*-experience-lists-*` so they
 *     never collide with the food-list sheet's testIDs if both are ever mounted.
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.6.
 */

export interface AddToExperienceListsSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly onComplete?: () => void;
}

export default function AddToExperienceListsSheet({
  visible,
  onClose,
  experienceId,
  experienceName,
  onComplete,
}: AddToExperienceListsSheetProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [initialSelectedListIds, setInitialSelectedListIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [isSubmittingNewList, setIsSubmittingNewList] = useState(false);

  // Fetch owned experience lists (Requirement 9.2 / 9.6: restricted to owned lists)
  const ownedListsQuery = useQuery<readonly ExperienceListDTO[]>({
    queryKey: ['my-owned-experience-lists'],
    queryFn: () => apiRequest<readonly ExperienceListDTO[]>('GET', '/me/experience-lists'),
    enabled: visible,
  });

  const ownedLists = ownedListsQuery.data ?? [];
  // Ids the User has created inline this session (Requirement 9.2's "Create
  // new list" action). Once a list is auto-selected via inline creation, the
  // pre-check sweep below must never re-derive (and thus clobber) its
  // selection state from server detail — a brand-new list has no items yet,
  // so re-deriving would always compute "not preselected" and silently
  // discard the auto-select the moment `ownedLists` refetches after
  // `invalidateQueries(['my-owned-experience-lists'])` runs.
  const [inlineCreatedListIds, setInlineCreatedListIds] = useState<Set<string>>(new Set());
  // Mirrors `inlineCreatedListIds` for synchronous reads inside the
  // preselection sweep below (see the token note there for why a ref
  // alone is still not sufficient).
  const inlineCreatedListIdsRef = React.useRef<Set<string>>(inlineCreatedListIds);
  inlineCreatedListIdsRef.current = inlineCreatedListIds;
  // Monotonically-increasing token identifying the *latest* preselection
  // sweep. The sweep below is a multi-await async operation (one GET per
  // owned list). `handleCreateInlineList`'s
  // `invalidateQueries(['my-owned-experience-lists'])` call can trigger a
  // *second* sweep (via the `ownedLists.length` effect dependency changing)
  // while an *earlier* sweep — started before the new list existed — is
  // still in flight. Without this guard, the earlier sweep's
  // `setSelectedListIds` call can still land after the newer sweep's,
  // silently reverting the inline "Create new list" auto-select
  // (Requirement 9.2) the newer sweep correctly preserved.
  const preselectionSweepTokenRef = React.useRef(0);

  // When visible, fetch detail for owned lists to determine pre-selection (Requirement 9.3)
  useEffect(() => {
    if (!visible || ownedLists.length === 0) {
      return;
    }

    let isMounted = true;
    const sweepToken = ++preselectionSweepTokenRef.current;

    async function checkPreselections(): Promise<void> {
      const preselected = new Set<string>();

      await Promise.all(
        ownedLists
          .filter((list) => !inlineCreatedListIdsRef.current.has(list.id))
          .map(async (list) => {
            try {
              const detail = await apiRequest<ExperienceListDetailDTO>(
                'GET',
                `/experience-lists/${encodeURIComponent(list.id)}`,
              );
              const hasItem = detail.items.some((item) => item.experienceId === experienceId);
              if (hasItem) {
                preselected.add(list.id);
              }
            } catch {
              // Ignore error fetching detail
            }
          }),
      );

      // A newer sweep has since started (or the sheet was closed) — this
      // sweep's result is stale and must not overwrite newer state.
      if (isMounted && preselectionSweepTokenRef.current === sweepToken) {
        setSelectedListIds((prev) => {
          const next = new Set(preselected);
          for (const id of prev) {
            if (inlineCreatedListIdsRef.current.has(id)) next.add(id);
          }
          return next;
        });
        setInitialSelectedListIds((prev) => {
          const next = new Set(preselected);
          for (const id of prev) {
            if (inlineCreatedListIdsRef.current.has(id)) next.add(id);
          }
          return next;
        });
      }
    }

    void checkPreselections();

    return () => {
      isMounted = false;
    };
  }, [visible, ownedLists.length, experienceId]);

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
      const created = await apiRequest<ExperienceListDTO>('POST', '/me/experience-lists', {
        name: trimmed,
        visibility: 'private',
      });

      // Auto-select the newly created list, and remember it was created
      // inline so the pre-check sweep (Requirement 9.3) never re-derives
      // (and thereby clobbers) its selection state once the owned-lists
      // refetch below picks it up. The ref is written synchronously here,
      // not left to the render-cycle sync (`inlineCreatedListIdsRef.current
      // = inlineCreatedListIds` below the `useState` declaration) — an
      // in-flight preselection sweep's `await`-resumed continuation can run
      // before this component's next render commits, so relying solely on
      // the render-cycle sync leaves a window where the ref still reads
      // stale (empty) and an older sweep clobbers this auto-select anyway.
      inlineCreatedListIdsRef.current = new Set(inlineCreatedListIdsRef.current).add(created.id);
      setInlineCreatedListIds(new Set(inlineCreatedListIdsRef.current));
      setSelectedListIds((prev) => new Set(prev).add(created.id));
      setNewListName('');
      setIsCreatingList(false);

      await queryClient.invalidateQueries({ queryKey: ['my-owned-experience-lists'] });
      await queryClient.invalidateQueries({ queryKey: ['experience-lists-collection'] });
    } catch {
      // Swallowed or handled
    } finally {
      setIsSubmittingNewList(false);
    }
  }

  async function handleConfirm(): Promise<void> {
    if (isSaving) return;
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
        try {
          await apiRequest('POST', `/me/experience-lists/${listId}/items`, {
            experienceId,
          });
        } catch (err) {
          // Requirement 9.4: swallow experience_list_item_duplicate
          if (err instanceof ApiError && err.code === 'experience_list_item_duplicate') {
            // Expected duplicate, treat as satisfied
          }
        }
        await queryClient.invalidateQueries({ queryKey: ['experience-list-detail', listId] });
      }

      // Perform removals
      for (const listId of newlyDeselected) {
        try {
          await apiRequest('DELETE', `/me/experience-lists/${listId}/items/${experienceId}`);
        } catch {
          // Ignore not found
        }
        await queryClient.invalidateQueries({ queryKey: ['experience-list-detail', listId] });
      }

      await queryClient.invalidateQueries({ queryKey: ['my-owned-experience-lists'] });
      await queryClient.invalidateQueries({ queryKey: ['experience-lists-collection'] });

      onComplete?.();
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  // Stable `renderItem` identity — an inline arrow literal is recreated every
  // render, which `FlatList`/`VirtualizedList` treats as a changed render
  // function and forces expensive re-render/re-measure work even when the row
  // is otherwise unchanged (see the same fix in `foodLists/AddToListsSheet.tsx`).
  // Placed before the `if (!visible) return null;` early return below so the
  // hook always runs, satisfying React's Rules of Hooks.
  const renderOwnedList = useCallback(
    ({ item }: { item: ExperienceListDTO }) => {
      const isSelected = selectedListIds.has(item.id);
      return (
        <Pressable
          onPress={() => toggleListSelection(item.id)}
          style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          accessibilityLabel={`List ${item.name}`}
          testID={`experience-list-checkbox-row-${item.id}`}
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
      testID="add-to-experience-lists-sheet"
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.title}>Add to Lists</Text>
              <Text style={styles.subtitle}>Select lists to include &quot;{experienceName}&quot;</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close add to lists sheet"
              style={styles.closeBtn}
              testID="close-add-to-experience-lists-btn"
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
                testID="create-experience-list-name-input"
              />
              <View style={styles.createActions}>
                <Pressable
                  onPress={() => setIsCreatingList(false)}
                  style={styles.cancelBtn}
                  testID="cancel-create-experience-list-inline-btn"
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
                  testID="submit-create-experience-list-inline-btn"
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
              testID="inline-create-experience-list-btn"
            >
              <Ionicons name="add-circle" size={20} color={theme.color.primary} />
              <Text style={styles.inlineAddListText}>Create new list</Text>
            </Pressable>
          )}

          {/* Owned Lists Checklist */}
          {ownedListsQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={theme.color.primary} testID="add-to-experience-lists-loading" />
            </View>
          ) : (
            <FlatList
              data={ownedLists}
              keyExtractor={(item) => item.id}
              renderItem={renderOwnedList}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText} testID="add-to-experience-lists-empty">
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
              disabled={isSaving}
              accessibilityRole="button"
              accessibilityLabel="Save list selections"
              style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
              testID="add-to-experience-lists-save-btn"
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
