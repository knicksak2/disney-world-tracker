// Feature: food-item-logging, Task 7.1, 7.4 & 7.5 — Food Item Picker Modal
//
// Validates: Requirements 1.9, 2.1, 2.2, 5.1, 5.2, 5.5, 5.6, 5.7, 6.5

import React, { useMemo, useState } from 'react';
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

import type { FoodItemDTO, FoodItemLogHistoryDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge, SecondaryButton } from '../../theme/components';
import FoodItemLogHistorySheet from './FoodItemLogHistorySheet';
import RestaurantFoodLogsSheet from './RestaurantFoodLogsSheet';

export interface FoodItemPickerModalProps {
  /** Experience id if scoped to a Restaurant_Experience. */
  readonly experienceId?: string;
  /** Location id if scoped to a User_Submitted_Location. */
  readonly locationId?: string;
  /** Mode: 'log' (single-select default) or 'addToLists' (multi-select). */
  readonly mode?: 'log' | 'addToLists';
  /** Whether the modal is presented. */
  readonly visible: boolean;
  /** Dismiss the modal without selecting. */
  readonly onClose: () => void;
  /** Called when a food item is picked (either existing or newly added). */
  readonly onSelectFoodItem?: (item: FoodItemDTO) => void;
  /** Called when items are confirmed in addToLists multi-select mode. */
  readonly onConfirmSelection?: (items: readonly FoodItemDTO[]) => void;
}

interface FoodItemRowProps {
  readonly item: FoodItemDTO;
  readonly mode?: 'log' | 'addToLists';
  readonly isSelected?: boolean;
  readonly onSelect: (item: FoodItemDTO) => void;
  readonly onOpenHistory: (item: FoodItemDTO) => void;
}

function FoodItemRow({ item, mode = 'log', isSelected = false, onSelect, onOpenHistory }: FoodItemRowProps): JSX.Element {
  // Sourced from GET /me/food-items/:foodItemId/logs (Requirement 5.5)
  const logsQuery = useQuery<FoodItemLogHistoryDTO>({
    queryKey: ['food-item-logs', item.id],
    queryFn: () =>
      apiRequest<FoodItemLogHistoryDTO>(
        'GET',
        `/me/food-items/${encodeURIComponent(item.id)}/logs`,
      ),
    staleTime: 30_000,
  });

  const repeatCount = logsQuery.data?.repeatCount ?? 0;

  return (
    <Pressable
      onPress={() => onSelect(item)}
      accessibilityRole="button"
      accessibilityLabel={`Select ${item.name}`}
      style={({ pressed }) => [styles.itemRow, pressed && styles.itemRowPressed]}
      testID={`food-item-row-${item.id}`}
    >
      {mode === 'addToLists' ? (
        <View style={styles.multiSelectCheck} testID={`food-item-checkbox-${item.id}`}>
          <Ionicons
            name={isSelected ? 'checkbox' : 'square-outline'}
            size={22}
            color={isSelected ? theme.color.primary : theme.color.textSecondary}
          />
        </View>
      ) : null}
      <View style={styles.itemRowLeft}>
        <Text style={styles.itemName}>{item.name}</Text>
        <View style={styles.itemMetaRow}>
          {item.price ? <Text style={styles.itemPrice}>{item.price}</Text> : null}
          {!item.currentlyOnMenu && (
            <Badge
              label="Not currently on menu"
              color={theme.color.textSecondary}
              testID={`food-item-not-on-menu-${item.id}`}
            />
          )}
        </View>
      </View>

      <View style={styles.itemRowRight}>
        {repeatCount > 0 ? (
          <Pressable
            onPress={(e) => {
              // Prevent triggering onSelect when viewing history
              e.stopPropagation();
              onOpenHistory(item);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Logged ${repeatCount} times. View history.`}
            style={styles.repeatBadge}
            testID={`food-item-repeat-count-${item.id}`}
          >
            <Ionicons name="time-outline" size={14} color={theme.color.primary} />
            <Text style={styles.repeatText}>Logged {repeatCount}x</Text>
          </Pressable>
        ) : null}
        {mode === 'log' ? (
          <Ionicons name="chevron-forward" size={18} color={theme.color.textSecondary} />
        ) : null}
      </View>
    </Pressable>
  );
}

export default function FoodItemPickerModal({
  experienceId,
  locationId,
  mode = 'log',
  visible,
  onClose,
  onSelectFoodItem,
  onConfirmSelection,
}: FoodItemPickerModalProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [historyItem, setHistoryItem] = useState<FoodItemDTO | null>(null);
  const [scopedLogsVisible, setScopedLogsVisible] = useState<boolean>(false);
  const [selectedItems, setSelectedItems] = useState<Map<string, FoodItemDTO>>(new Map());

  const scopeId = experienceId ?? locationId;

  const itemsQuery = useQuery<readonly FoodItemDTO[]>({
    queryKey: experienceId
      ? ['experience-food-items', experienceId]
      : ['location-food-items', locationId],
    queryFn: async () => {
      const path = experienceId
        ? `/experiences/${encodeURIComponent(experienceId)}/food-items`
        : `/locations/${encodeURIComponent(locationId!)}/food-items`;
      // The backend wraps the list in an `{ items: [...] }` envelope
      // (see `foodItemRoutes`'s `GET /experiences/:id/food-items` and
      // `GET /locations/:id/food-items`), so unwrap it here rather than
      // treating the response as the array itself.
      const response = await apiRequest<{ items: readonly FoodItemDTO[] }>(
        'GET',
        path,
      );
      return response.items;
    },
    enabled: visible && Boolean(scopeId),
  });

  const items = itemsQuery.data ?? [];

  // Filter items by search query
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.name.toLowerCase().includes(query));
  }, [items, search]);

  // Check if trimmed search exactly matches any item case-insensitively
  const trimmedSearch = search.trim();
  const exactMatchExists = useMemo(() => {
    if (!trimmedSearch) return false;
    const lower = trimmedSearch.toLowerCase();
    return items.some((item) => item.name.toLowerCase() === lower);
  }, [items, trimmedSearch]);

  const showAddRow = trimmedSearch.length > 0 && !exactMatchExists;

  async function handleAddCustomItem(): Promise<void> {
    if (!trimmedSearch || isSubmitting || !scopeId) return;

    setIsSubmitting(true);
    try {
      const path = experienceId
        ? `/experiences/${encodeURIComponent(experienceId)}/food-items`
        : `/locations/${encodeURIComponent(locationId!)}/food-items`;

      const created = await apiRequest<FoodItemDTO>('POST', path, {
        name: trimmedSearch,
      });

      // Invalidate list
      await queryClient.invalidateQueries({
        queryKey: experienceId
          ? ['experience-food-items', experienceId]
          : ['location-food-items', locationId],
      });

      setSearch('');
      if (mode === 'addToLists') {
        setSelectedItems((prev) => new Map(prev).set(created.id, created));
      } else {
        onSelectFoodItem?.(created);
      }
    } catch (err) {
      // Requirement 5.2 / 7.1: on food_item_duplicate, select the returned existing item
      if (err instanceof ApiError && err.code === 'food_item_duplicate') {
        const existingId = err.details?.['existingId'] as string | undefined;
        const existingItem =
          (existingId ? items.find((i) => i.id === existingId) : undefined) ??
          items.find((i) => i.name.toLowerCase() === trimmedSearch.toLowerCase()) ?? {
            id: existingId ?? 'duplicate-id',
            experienceId: experienceId ?? null,
            locationId: locationId ?? null,
            name: trimmedSearch,
            price: null,
            source: 'user_submitted' as const,
            currentlyOnMenu: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

        setSearch('');
        if (mode === 'addToLists') {
          setSelectedItems((prev) => new Map(prev).set(existingItem.id, existingItem));
        } else {
          onSelectFoodItem?.(existingItem);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleItemPress(item: FoodItemDTO): void {
    if (mode === 'addToLists') {
      setSelectedItems((prev) => {
        const next = new Map(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.set(item.id, item);
        }
        return next;
      });
    } else {
      onSelectFoodItem?.(item);
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={onClose}
        testID="food-item-picker-modal"
      >
        <View style={styles.backdrop}>
          <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerTitles}>
                <Text style={styles.title}>Select Dish</Text>
                <Text style={styles.subtitle}>
                  Choose a dish to log or add one if it&apos;s missing
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close dish picker"
                style={styles.closeBtn}
                testID="close-food-item-picker-btn"
              >
                <Ionicons name="close" size={24} color={theme.color.textSecondary} />
              </Pressable>
            </View>

            {/* Search Input */}
            <View style={styles.searchSection}>
              <View style={styles.searchBar}>
                <Ionicons name="search" size={18} color={theme.color.textSecondary} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search dishes or snacks..."
                  placeholderTextColor={theme.color.textSecondary}
                  style={styles.searchInput}
                  testID="food-item-search-input"
                  autoCorrect={false}
                />
                {search.length > 0 && (
                  <Pressable
                    onPress={() => setSearch('')}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search text"
                    style={styles.clearSearchBtn}
                  >
                    <Ionicons name="close-circle" size={18} color={theme.color.textSecondary} />
                  </Pressable>
                )}
              </View>
            </View>

            {/* Scoped food logs affordance for location (Requirement 9.4) */}
            {locationId && mode === 'log' && (
              <View style={styles.locationAffordanceWrap}>
                <SecondaryButton
                  label="My logged items here"
                  icon="time-outline"
                  onPress={() => setScopedLogsVisible(true)}
                  accessibilityLabel="View my logged items here"
                  testID="location-my-logged-items-btn"
                />
              </View>
            )}

            {/* Content List */}
            {itemsQuery.isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator
                  color={theme.color.primary}
                  accessibilityLabel="Loading dishes"
                  testID="food-item-picker-loading"
                />
              </View>
            ) : itemsQuery.isError ? (
              <View style={styles.errorWrap}>
                <Text style={styles.errorText}>Could not load dishes.</Text>
              </View>
            ) : (
              <FlatList
                data={filteredItems}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <FoodItemRow
                    item={item}
                    mode={mode}
                    isSelected={selectedItems.has(item.id)}
                    onSelect={handleItemPress}
                    onOpenHistory={(foodItem) => setHistoryItem(foodItem)}
                  />
                )}
                ListHeaderComponent={
                  showAddRow ? (
                    <Pressable
                      onPress={() => void handleAddCustomItem()}
                      disabled={isSubmitting}
                      accessibilityRole="button"
                      accessibilityLabel={`Add "${trimmedSearch}" to menu`}
                      style={styles.addRow}
                      testID="food-item-picker-add-btn"
                    >
                      <Ionicons name="add-circle" size={22} color={theme.color.primary} />
                      <View style={styles.addRowTextWrap}>
                        <Text style={styles.addRowTitle}>
                          Add &quot;{trimmedSearch}&quot;
                        </Text>
                        <Text style={styles.addRowSubtitle}>
                          Item not listed? Add it to the menu
                        </Text>
                      </View>
                      {isSubmitting ? (
                        <ActivityIndicator size="small" color={theme.color.primary} />
                      ) : null}
                    </Pressable>
                  ) : null
                }
                ListEmptyComponent={
                  !showAddRow ? (
                    <View style={styles.emptyWrap}>
                      <Text style={styles.emptyText} testID="food-item-picker-empty">
                        No dishes found. Type a name to add it.
                      </Text>
                    </View>
                  ) : null
                }
                contentContainerStyle={styles.listContent}
              />
            )}

            {/* Done Button in addToLists mode */}
            {mode === 'addToLists' ? (
              <View style={styles.footer}>
                <Pressable
                  onPress={() => onConfirmSelection?.(Array.from(selectedItems.values()))}
                  disabled={selectedItems.size === 0}
                  accessibilityRole="button"
                  accessibilityLabel={`Confirm selection of ${selectedItems.size} items`}
                  style={[styles.doneBtn, selectedItems.size === 0 && styles.doneBtnDisabled]}
                  testID="food-item-picker-done-btn"
                >
                  <Text style={styles.doneBtnText}>
                    Done ({selectedItems.size})
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* History Sheet */}
      <FoodItemLogHistorySheet
        foodItem={historyItem}
        visible={Boolean(historyItem)}
        onClose={() => setHistoryItem(null)}
      />

      {/* Location food logs sheet (Requirement 9.4) */}
      <RestaurantFoodLogsSheet
        locationId={locationId}
        visible={scopedLogsVisible}
        onClose={() => setScopedLogsVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    height: '85%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  headerTitles: {
    flex: 1,
    marginRight: 12,
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
  searchSection: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: theme.color.textPrimary,
  },
  clearSearchBtn: {
    padding: 4,
  },
  locationAffordanceWrap: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  loadingWrap: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  errorWrap: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 14,
  },
  emptyWrap: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.color.textSecondary,
    fontSize: 14,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(107, 70, 193, 0.08)',
    borderRadius: theme.radius.md,
    marginBottom: 8,
    gap: 12,
  },
  addRowTextWrap: {
    flex: 1,
  },
  addRowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.primary,
  },
  addRowSubtitle: {
    fontSize: 12,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  itemRowPressed: {
    opacity: 0.7,
  },
  itemRowLeft: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  itemPrice: {
    fontSize: 13,
    color: theme.color.textSecondary,
    fontWeight: '500',
  },
  itemRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  repeatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(107, 70, 193, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  repeatText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.primary,
  },
  multiSelectCheck: {
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    padding: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  doneBtn: {
    backgroundColor: theme.color.primary,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnDisabled: {
    opacity: 0.5,
  },
  doneBtnText: {
    color: theme.color.textOnPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
});
