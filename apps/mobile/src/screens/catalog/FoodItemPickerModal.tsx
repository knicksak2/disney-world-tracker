// Feature: food-item-logging, Task 7.1, 7.4 & 7.5 — Food Item Picker Modal
//
// Validates: Requirements 1.9, 2.1, 2.2, 5.1, 5.2, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.5

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  FoodItemDTO,
  FoodItemLogHistoryDTO,
  FoodItemsResponseDTO,
  MenuDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge, SecondaryButton } from '../../theme/components';
import FoodItemLogHistorySheet from './FoodItemLogHistorySheet';
import RestaurantFoodLogsSheet from './RestaurantFoodLogsSheet';

export interface FoodItemPickerModalProps {
  /** Experience id if scoped to a Restaurant_Experience. */
  readonly experienceId?: string | undefined;
  /** Location id if scoped to a User_Submitted_Location. */
  readonly locationId?: string | undefined;
  /** Optional menus to override or supply without fetching. */
  readonly menus?: readonly MenuDTO[] | undefined;
  /** Mode: 'log' (single-select default) or 'addToLists' (multi-select). */
  readonly mode?: 'log' | 'addToLists';
  /** Whether the modal is presented. */
  readonly visible: boolean;
  /** Dismiss the modal without selecting. */
  readonly onClose: () => void;
  /** Called when a food item is picked (either existing or newly added). */
  readonly onSelectFoodItem?: (item: FoodItemDTO) => void;
  /** Called when items are confirmed in addToLists multi-select mode. */
  readonly onConfirmSelection?: (items: readonly FoodItemDTO[]) => void | Promise<void>;
  /** Optional set or array of foodItemIds already present on the target food list. */
  readonly existingItemIds?: ReadonlySet<string> | readonly string[];
  /** Optional loading indicator indicating items are being saved to the list. */
  readonly isSubmittingSelection?: boolean;
}

interface FoodItemRowProps {
  readonly item: FoodItemDTO;
  readonly mode?: 'log' | 'addToLists';
  readonly isSelected?: boolean;
  readonly isAlreadyInList?: boolean;
  readonly repeatCount?: number;
  readonly onSelect: (item: FoodItemDTO) => void;
  readonly onOpenHistory: (item: FoodItemDTO) => void;
}

function FoodItemRow({
  item,
  mode = 'log',
  isSelected = false,
  isAlreadyInList = false,
  repeatCount: propRepeatCount,
  onSelect,
  onOpenHistory,
}: FoodItemRowProps): JSX.Element {
  // Sourced from GET /me/food-items/:foodItemId/logs (Requirement 5.5).
  // In addToLists mode, or when repeatCount is provided directly from the scope-level query,
  // do not flood the network with individual log queries for every single menu item.
  const logsQuery = useQuery<FoodItemLogHistoryDTO>({
    queryKey: ['food-item-logs', item.id],
    queryFn: () =>
      apiRequest<FoodItemLogHistoryDTO>(
        'GET',
        `/me/food-items/${encodeURIComponent(item.id)}/logs`,
      ),
    staleTime: 30_000,
    enabled: mode === 'log' && propRepeatCount === undefined,
  });

  const repeatCount = propRepeatCount ?? logsQuery.data?.repeatCount ?? 0;

  return (
    <Pressable
      onPress={() => onSelect(item)}
      accessibilityRole="button"
      accessibilityLabel={
        isAlreadyInList
          ? `${item.name} is already in this list`
          : `Select ${item.name}`
      }
      style={({ pressed }) => [styles.itemRow, pressed && !isAlreadyInList && styles.itemRowPressed]}
      testID={`food-item-row-${item.id}`}
    >
      {mode === 'addToLists' ? (
        <View style={styles.multiSelectCheck} testID={`food-item-checkbox-${item.id}`}>
          <Ionicons
            name={
              isAlreadyInList
                ? 'checkmark-circle'
                : isSelected
                ? 'checkbox'
                : 'square-outline'
            }
            size={22}
            color={
              isAlreadyInList
                ? theme.color.textSecondary
                : isSelected
                ? theme.color.primary
                : theme.color.textSecondary
            }
          />
        </View>
      ) : null}
      <View style={styles.itemRowLeft}>
        <Text style={[styles.itemName, isAlreadyInList && styles.itemNameInList]}>
          {item.name}
        </Text>
        <View style={styles.itemMetaRow}>
          {isAlreadyInList ? (
            <Badge
              label="Already on list"
              color={theme.color.textSecondary}
              testID={`food-item-already-on-list-${item.id}`}
            />
          ) : null}
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

type DisplayRow =
  | { readonly type: 'header'; readonly id: string; readonly title: string }
  | { readonly type: 'item'; readonly id: string; readonly item: FoodItemDTO };

export default function FoodItemPickerModal({
  experienceId,
  locationId,
  menus: propMenus,
  mode = 'log',
  visible,
  onClose,
  onSelectFoodItem,
  onConfirmSelection,
  existingItemIds,
  isSubmittingSelection = false,
}: FoodItemPickerModalProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState<string>('');
  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [historyItem, setHistoryItem] = useState<FoodItemDTO | null>(null);
  const [scopedLogsVisible, setScopedLogsVisible] = useState<boolean>(false);
  const [selectedItems, setSelectedItems] = useState<Map<string, FoodItemDTO>>(new Map());

  const scopeId = experienceId ?? locationId;

  const handleClose = useCallback(() => {
    setSearch('');
    setSelectedTab(null);
    setSubmissionError(null);
    setSelectedItems(new Map());
    onClose();
  }, [onClose]);

  // Reset state when closing modal
  useEffect(() => {
    if (!visible) {
      setSearch('');
      setSelectedTab(null);
      setSubmissionError(null);
      setSelectedItems(new Map());
    }
  }, [visible]);

  const existingSet = useMemo(() => {
    if (!existingItemIds) return new Set<string>();
    if (existingItemIds instanceof Set) return existingItemIds as Set<string>;
    return new Set(existingItemIds);
  }, [existingItemIds]);

  const itemsQuery = useQuery<FoodItemsResponseDTO>({
    queryKey: experienceId
      ? ['experience-food-items', experienceId]
      : ['location-food-items', locationId],
    queryFn: async () => {
      const path = experienceId
        ? `/experiences/${encodeURIComponent(experienceId)}/food-items`
        : `/locations/${encodeURIComponent(locationId!)}/food-items`;
      return apiRequest<FoodItemsResponseDTO>('GET', path);
    },
    enabled: visible && Boolean(scopeId),
  });

  const detailQuery = useQuery<{ id: string; name: string; menus?: readonly MenuDTO[] }>({
    queryKey: ['experience', experienceId] as const,
    queryFn: () =>
      apiRequest<{ id: string; name: string; menus?: readonly MenuDTO[] }>(
        'GET',
        `/catalog/${encodeURIComponent(experienceId!)}`,
      ),
    enabled: visible && Boolean(experienceId) && !propMenus && !itemsQuery.data?.menus,
  });

  const items = itemsQuery.data?.items ?? [];
  const menus = propMenus ?? itemsQuery.data?.menus ?? detailQuery.data?.menus ?? [];

  // Menu tab labels (R5.8): If more than 1 menu, provide "All" plus each menu's type
  const tabLabels = useMemo(() => {
    if (menus.length <= 1) return [];
    return [
      'All',
      ...menus
        .map((m) => m.menuType || (m as { type?: string }).type || (m as { name?: string }).name || '')
        .filter(Boolean),
    ];
  }, [menus]);

  // Active tab: defaults to the primary menu when multiple exist, otherwise 'All'
  const activeTab = useMemo(() => {
    if (selectedTab && (selectedTab === 'All' || tabLabels.includes(selectedTab))) {
      return selectedTab;
    }
    if (menus.length > 1) {
      const first = menus[0]!;
      return first.menuType || (first as { type?: string }).type || (first as { name?: string }).name || 'All';
    }
    return 'All';
  }, [selectedTab, tabLabels, menus]);

  // Active menu object when a specific menu tab is selected
  const activeMenu = useMemo(() => {
    if (activeTab === 'All') return null;
    return (
      menus.find(
        (m) =>
          (m.menuType || (m as { type?: string }).type || (m as { name?: string }).name) ===
          activeTab,
      ) ?? null
    );
  }, [activeTab, menus]);

  // Set of lowercase item names in the active menu (R5.8)
  const activeMenuNames = useMemo(() => {
    if (!activeMenu || !activeMenu.groups) return null;
    const names = new Set<string>();
    for (const group of activeMenu.groups ?? []) {
      for (const item of group?.items ?? []) {
        const lower = item?.name?.trim().toLowerCase();
        if (lower) names.add(lower);
      }
    }
    return names;
  }, [activeMenu]);

  // Items filtered by active menu tab
  const tabFilteredItems = useMemo(() => {
    if (!activeMenuNames) return items;
    return items.filter((item) => activeMenuNames.has(item.name.trim().toLowerCase()));
  }, [items, activeMenuNames]);

  const trimmedSearch = search.trim();
  const lowerSearch = trimmedSearch.toLowerCase();

  // All items matching the search query across the entire restaurant
  const allMatchingSearchItems = useMemo(() => {
    if (!lowerSearch) return items;
    return items.filter((item) => item.name.toLowerCase().includes(lowerSearch));
  }, [items, lowerSearch]);

  // Items matching search query in the active tab
  const currentTabSearchItems = useMemo(() => {
    if (!lowerSearch) return tabFilteredItems;
    return tabFilteredItems.filter((item) => item.name.toLowerCase().includes(lowerSearch));
  }, [tabFilteredItems, lowerSearch]);

  // Grouped rows to display in FlatList (R5.9)
  const displayRows = useMemo<readonly DisplayRow[]>(() => {
    if (!activeMenu || !activeMenu.groups || activeMenu.groups.length === 0) {
      return currentTabSearchItems.map((item) => ({
        type: 'item' as const,
        id: item.id,
        item,
      }));
    }

    const itemMap = new Map<string, FoodItemDTO>();
    for (const item of currentTabSearchItems) {
      itemMap.set(item.name.trim().toLowerCase(), item);
    }

    const rows: DisplayRow[] = [];
    const placedItemIds = new Set<string>();

    for (const group of activeMenu.groups ?? []) {
      const groupItems: FoodItemDTO[] = [];
      for (const gi of group?.items ?? []) {
        const lowerName = gi?.name?.trim().toLowerCase();
        if (!lowerName) continue;
        const matched = itemMap.get(lowerName);
        if (matched && !placedItemIds.has(matched.id)) {
          groupItems.push(matched);
          placedItemIds.add(matched.id);
        }
      }

      if (groupItems.length > 0) {
        rows.push({
          type: 'header',
          id: `header-${activeMenu.menuType ?? activeTab}-${group.name}`,
          title: group.name,
        });
        for (const item of groupItems) {
          rows.push({
            type: 'item',
            id: item.id,
            item,
          });
        }
      }
    }

    // Remaining items matching the current tab search but not placed in a group
    const remaining = currentTabSearchItems.filter((i) => !placedItemIds.has(i.id));
    if (remaining.length > 0) {
      if (rows.length > 0) {
        rows.push({
          type: 'header',
          id: `header-${activeMenu.menuType ?? activeTab}-other`,
          title: 'Other Items',
        });
      }
      for (const item of remaining) {
        rows.push({
          type: 'item',
          id: item.id,
          item,
        });
      }
    }

    return rows;
  }, [activeMenu, currentTabSearchItems]);

  // Check if trimmed search exactly matches any item case-insensitively
  const exactMatchExists = useMemo(() => {
    if (!trimmedSearch) return false;
    const lower = trimmedSearch.toLowerCase();
    return items.some((item) => item.name.toLowerCase() === lower);
  }, [items, trimmedSearch]);

  const showAddRow = trimmedSearch.length > 0 && !exactMatchExists;

  async function handleAddCustomItem(): Promise<FoodItemDTO | null> {
    if (!trimmedSearch || isSubmitting || !scopeId) return null;

    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      const path = experienceId
        ? `/experiences/${encodeURIComponent(experienceId)}/food-items`
        : `/locations/${encodeURIComponent(locationId!)}/food-items`;

      const created = await apiRequest<FoodItemDTO>('POST', path, {
        name: trimmedSearch,
      });

      // Update selection immediately so the user can hit Done without delay
      setSearch('');
      if (mode === 'addToLists') {
        setSelectedItems((prev) => new Map(prev).set(created.id, created));
      } else {
        onSelectFoodItem?.(created);
      }

      // Invalidate list in background
      void queryClient.invalidateQueries({
        queryKey: experienceId
          ? ['experience-food-items', experienceId]
          : ['location-food-items', locationId],
      });

      return created;
    } catch (err) {
      // Requirement 5.2 / 7.1: on food_item_duplicate, select the returned existing item
      if (err instanceof ApiError && err.code === 'food_item_duplicate') {
        const existingId = err.details?.['existingId'] as string | undefined;
        const existingItem =
          (existingId ? items.find((i) => i.id === existingId) : undefined) ??
          items.find((i) => i.name.toLowerCase() === trimmedSearch.toLowerCase()) ??
          (existingId
            ? {
                id: existingId,
                experienceId: experienceId ?? null,
                locationId: locationId ?? null,
                name: trimmedSearch,
                price: null,
                source: 'user_submitted' as const,
                currentlyOnMenu: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : undefined);

        if (existingItem) {
          setSearch('');
          if (mode === 'addToLists') {
            setSelectedItems((prev) => new Map(prev).set(existingItem.id, existingItem));
          } else {
            onSelectFoodItem?.(existingItem);
          }
          return existingItem;
        } else {
          setSubmissionError('Item already exists on the menu.');
        }
      } else {
        setSubmissionError("Couldn't add dish. Please check your connection and try again.");
      }
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleItemPress = useCallback(
    (item: FoodItemDTO): void => {
      // Disallow picking items already in list
      if (existingSet.has(item.id)) {
        return;
      }
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
    },
    [existingSet, mode, onSelectFoodItem],
  );

  const renderRow = useCallback(
    ({ item }: { item: DisplayRow }) => {
      if (item.type === 'header') {
        return (
          <View style={styles.groupHeaderWrap} testID={`food-item-group-${item.title}`}>
            <Text style={styles.groupHeaderText}>{item.title}</Text>
          </View>
        );
      }
      return (
        <FoodItemRow
          item={item.item}
          mode={mode}
          isSelected={selectedItems.has(item.item.id)}
          isAlreadyInList={existingSet.has(item.item.id)}
          onSelect={handleItemPress}
          onOpenHistory={(foodItem) => setHistoryItem(foodItem)}
        />
      );
    },
    [mode, selectedItems, existingSet, handleItemPress],
  );

  function handleSearchSubmit(): void {
    if (!trimmedSearch) return;
    Keyboard.dismiss();
    const exactMatch = items.find(
      (item) => item.name.toLowerCase() === trimmedSearch.toLowerCase(),
    );
    if (exactMatch) {
      if (!existingSet.has(exactMatch.id)) {
        if (mode === 'addToLists') {
          setSelectedItems((prev) => new Map(prev).set(exactMatch.id, exactMatch));
        } else {
          onSelectFoodItem?.(exactMatch);
        }
      }
    } else if (currentTabSearchItems.length === 1 && !existingSet.has(currentTabSearchItems[0]!.id)) {
      const match = currentTabSearchItems[0]!;
      if (mode === 'addToLists') {
        setSelectedItems((prev) => new Map(prev).set(match.id, match));
      } else {
        onSelectFoodItem?.(match);
      }
    } else if (showAddRow) {
      void handleAddCustomItem();
    }
  }

  async function handleDonePress(): Promise<void> {
    if (isSubmitting || isConfirming || isSubmittingSelection) return;
    Keyboard.dismiss();

    let itemsToConfirm = Array.from(selectedItems.values());

    // If no items were explicitly checked yet, but user entered a search query,
    // resolve their typed item seamlessly instead of failing with a dead press.
    if (itemsToConfirm.length === 0 && trimmedSearch.length > 0) {
      const exactMatch = items.find(
        (item) => item.name.toLowerCase() === trimmedSearch.toLowerCase(),
      );
      if (exactMatch) {
        if (!existingSet.has(exactMatch.id)) {
          itemsToConfirm = [exactMatch];
        }
      } else if (currentTabSearchItems.length === 1 && !existingSet.has(currentTabSearchItems[0]!.id)) {
        itemsToConfirm = [currentTabSearchItems[0]!];
      } else if (showAddRow) {
        const created = await handleAddCustomItem();
        if (created) {
          itemsToConfirm = [created];
        } else {
          return;
        }
      }
    }

    if (itemsToConfirm.length === 0) return;

    setIsConfirming(true);
    try {
      await onConfirmSelection?.(itemsToConfirm);
    } finally {
      setIsConfirming(false);
    }
  }

  if (!visible) {
    return null;
  }

  const isBusy = isConfirming || isSubmitting || isSubmittingSelection;
  const canPressDone =
    !isBusy && (selectedItems.size > 0 || trimmedSearch.length > 0);

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={handleClose}
        testID="food-item-picker-modal"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.backdrop}
        >
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
                onPress={handleClose}
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
                  onChangeText={(val) => {
                    setSearch(val);
                    if (submissionError) setSubmissionError(null);
                  }}
                  onSubmitEditing={handleSearchSubmit}
                  returnKeyType="done"
                  placeholder="Search dishes or snacks..."
                  placeholderTextColor={theme.color.textSecondary}
                  style={styles.searchInput}
                  testID="food-item-search-input"
                  autoCorrect={false}
                />
                {search.length > 0 && (
                  <Pressable
                    onPress={() => {
                      setSearch('');
                      if (submissionError) setSubmissionError(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search text"
                    style={styles.clearSearchBtn}
                  >
                    <Ionicons name="close-circle" size={18} color={theme.color.textSecondary} />
                  </Pressable>
                )}
              </View>
            </View>

            {/* Menu Tabs (R5.8): horizontal tab bar when multiple menus exist */}
            {tabLabels.length > 1 ? (
              <View style={styles.tabBar} testID="food-item-menu-tabs">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tabBarContent}
                >
                  {tabLabels.map((label) => {
                    const active = label === activeTab;
                    return (
                      <Pressable
                        key={label}
                        testID={`food-item-menu-tab-${label}`}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${label} menu`}
                        onPress={() => setSelectedTab(label)}
                        style={[styles.tab, active ? styles.tabActive : styles.tabInactive]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.tabText,
                            active ? styles.tabTextActive : styles.tabTextInactive,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {submissionError ? (
              <Text style={styles.submissionErrorText} testID="food-item-submission-error">
                {submissionError}
              </Text>
            ) : null}

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
                data={displayRows}
                keyExtractor={(row) => row.id}
                renderItem={renderRow}
                extraData={selectedItems}
                keyboardShouldPersistTaps="handled"
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
                  trimmedSearch.length > 0 &&
                  allMatchingSearchItems.length > 0 &&
                  activeTab !== 'All' ? (
                    <View style={styles.emptyWrap}>
                      <View style={styles.tabEmptySearchWrap}>
                        <Text style={styles.emptyText} testID="food-item-picker-tab-empty">
                          No dishes matching &quot;{trimmedSearch}&quot; in {activeTab}.
                        </Text>
                        <Pressable
                          onPress={() => setSelectedTab('All')}
                          accessibilityRole="button"
                          accessibilityLabel="Search across all menus"
                          style={styles.switchTabBtn}
                          testID="food-item-switch-to-all-btn"
                        >
                          <Ionicons name="search" size={16} color={theme.color.primary} />
                          <Text style={styles.switchTabBtnText}>
                            Search in All dishes ({allMatchingSearchItems.length} match
                            {allMatchingSearchItems.length === 1 ? '' : 'es'})
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : !showAddRow ? (
                    <View style={styles.emptyWrap}>
                      <Text style={styles.emptyText} testID="food-item-picker-empty">
                        {trimmedSearch.length > 0
                          ? 'No dishes found. Type a name to add it.'
                          : activeTab !== 'All'
                          ? `No dishes found in ${activeTab}.`
                          : 'No dishes found. Type a name to add it.'}
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
                  onPress={() => void handleDonePress()}
                  disabled={!canPressDone}
                  accessibilityRole="button"
                  accessibilityLabel={`Confirm selection of ${selectedItems.size} items`}
                  style={[styles.doneBtn, !canPressDone && styles.doneBtnDisabled]}
                  testID="food-item-picker-done-btn"
                >
                  {isBusy ? (
                    <ActivityIndicator size="small" color={theme.color.textOnPrimary} />
                  ) : (
                    <Text style={styles.doneBtnText}>
                      {selectedItems.size > 0
                        ? `Done (${selectedItems.size})`
                        : trimmedSearch.length > 0
                        ? 'Add & Done'
                        : 'Done (0)'}
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
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
  tabBar: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  tabBarContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  tabActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  tabInactive: {
    backgroundColor: theme.color.surfaceAlt,
    borderColor: theme.color.border,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: theme.color.textOnPrimary,
  },
  tabTextInactive: {
    color: theme.color.textSecondary,
  },
  groupHeaderWrap: {
    paddingTop: 16,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  groupHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tabEmptySearchWrap: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  switchTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(107, 70, 193, 0.08)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(107, 70, 193, 0.2)',
    marginTop: 4,
  },
  switchTabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.primary,
  },
  submissionErrorText: {
    color: theme.color.danger,
    fontSize: 13,
    paddingHorizontal: 20,
    paddingTop: 6,
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
  itemNameInList: {
    color: theme.color.textSecondary,
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
