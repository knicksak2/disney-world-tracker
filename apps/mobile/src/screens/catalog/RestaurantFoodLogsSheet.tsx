// Feature: food-item-logging, Task 10.5 — Restaurant / Location Scoped Food Logs Sheet
//
// Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, Property 11, Property 12

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FoodItemLogWithContextDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge, Card, EmptyState } from '../../theme/components';
import {
  FOOD_HISTORY_SORT_OPTIONS,
  type FoodHistorySort,
  deriveDisplayedFoodLogs,
} from './foodHistoryFilters';

export interface RestaurantFoodLogsSheetProps {
  /** Experience id if scoped to a Restaurant_Experience. */
  readonly experienceId?: string | undefined;
  /** Location id if scoped to a User_Submitted_Location. */
  readonly locationId?: string | undefined;
  /** Whether the modal sheet is visible. */
  readonly visible: boolean;
  /** Dismiss the sheet. */
  readonly onClose: () => void;
  /** Optional callback after a log is deleted. */
  readonly onLogDeleted?: (() => void) | undefined;
}

export default function RestaurantFoodLogsSheet({
  experienceId,
  locationId,
  visible,
  onClose,
  onLogDeleted,
}: RestaurantFoodLogsSheetProps): JSX.Element | null {
  const queryClient = useQueryClient();

  const [sort, setSort] = useState<FoodHistorySort>('recent');
  const [searchText, setSearchText] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const scopeId = experienceId ?? locationId;

  // Query scoped logs (Requirement 9.1, 9.2, 9.3)
  const scopedQuery = useQuery<readonly FoodItemLogWithContextDTO[]>({
    queryKey: ['scoped-food-item-logs', scopeId],
    queryFn: () => {
      const endpoint = experienceId
        ? `/experiences/${encodeURIComponent(experienceId)}/food-item-logs/mine`
        : `/locations/${encodeURIComponent(locationId!)}/food-item-logs/mine`;
      return apiRequest<readonly FoodItemLogWithContextDTO[]>('GET', endpoint);
    },
    enabled: visible && Boolean(scopeId),
  });

  const rawLogs = scopedQuery.data ?? [];

  // Restaurant/Location name rendered once in sheet header (Requirement 9.4)
  const placeName = useMemo(() => {
    for (const log of rawLogs) {
      const name = log.restaurantName ?? log.locationName;
      if (name) return name;
    }
    return null;
  }, [rawLogs]);

  // Derived filtered & sorted logs (Requirement 9.7, 9.8: search scoped to foodItemName only, no restaurant filter)
  const displayedLogs = useMemo(() => {
    return deriveDisplayedFoodLogs(rawLogs, {
      sort,
      searchText,
      searchFields: ['foodItemName'],
    });
  }, [rawLogs, sort, searchText]);

  // Stable `renderItem` identity — an inline arrow literal is recreated every
  // render (e.g. each keystroke re-deriving `displayedLogs`), which `FlatList`
  // treats as a changed render function and forces the whole visible window
  // to re-render/re-measure. Same fix as `DestinationScreen`'s search-results
  // `renderRow`.
  const renderLogRow = useCallback(
    ({ item }: { item: FoodItemLogWithContextDTO }) => (
      <Card key={item.id} style={styles.logCard} testID={`scoped-food-log-card-${item.id}`}>
        <View style={styles.cardHeader}>
          <Text style={styles.dishName} numberOfLines={2}>
            {item.foodItemName}
          </Text>
          <Pressable
            onPress={() => void handleDeleteLog(item)}
            disabled={deletingId === item.id}
            accessibilityRole="button"
            accessibilityLabel={`Delete log for ${item.foodItemName}`}
            style={styles.deleteBtn}
            testID={`scoped-food-log-delete-${item.id}`}
          >
            {deletingId === item.id ? (
              <ActivityIndicator size="small" color={theme.color.danger} />
            ) : (
              <Ionicons name="trash-outline" size={18} color={theme.color.danger} />
            )}
          </Pressable>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.dateText}>{item.visitedOn}</Text>
          {item.rating !== null && (
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={13} color={theme.color.accent} />
              <Text style={styles.ratingText}>{item.rating}/10</Text>
            </View>
          )}
          {!item.currentlyOnMenu && (
            <Badge
              label="Not currently on menu"
              color={theme.color.textSecondary}
              testID={`scoped-food-log-not-on-menu-${item.id}`}
            />
          )}
        </View>

        {item.note && item.note.trim().length > 0 && (
          <Text style={styles.noteText}>{item.note}</Text>
        )}
      </Card>
    ),
    [deletingId, handleDeleteLog],
  );

  if (!visible) {
    return null;
  }

  async function handleDeleteLog(log: FoodItemLogWithContextDTO): Promise<void> {
    if (deletingId !== null) return;
    setDeletingId(log.id);
    setDeleteError(null);

    try {
      await apiRequest<void>(
        'DELETE',
        `/me/food-items/${encodeURIComponent(log.foodItemId)}/logs/${encodeURIComponent(log.id)}`,
      );

      // Invalidate queries per Requirement 9.5
      await queryClient.invalidateQueries({
        queryKey: ['scoped-food-item-logs', scopeId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['me-food-item-logs'],
      });
      await queryClient.invalidateQueries({
        queryKey: ['food-item-logs', log.foodItemId],
      });

      onLogDeleted?.();
    } catch {
      setDeleteError('Could not delete log entry. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      testID="restaurant-food-logs-sheet"
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitles}>
              <Text style={styles.title} numberOfLines={1}>
                {placeName ?? 'My Logged Items'}
              </Text>
              <Text style={styles.subtitle}>My Logged Items Here</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close food logs sheet"
              style={styles.closeBtn}
              testID="close-restaurant-food-logs-sheet"
            >
              <Ionicons name="close" size={24} color={theme.color.textSecondary} />
            </Pressable>
          </View>

          {/* Search bar (scoped to dish name only, Requirement 9.8) */}
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={theme.color.textSecondary} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search dishes logged here..."
              placeholderTextColor={theme.color.textSecondary}
              style={styles.searchInput}
              testID="scoped-food-search-input"
              autoCorrect={false}
            />
            {searchText.length > 0 && (
              <Pressable
                onPress={() => setSearchText('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search text"
                style={styles.clearBtn}
                testID="scoped-clear-search"
              >
                <Ionicons name="close-circle" size={18} color={theme.color.textSecondary} />
              </Pressable>
            )}
          </View>

          {/* Sort Chips (Requirement 9.7) */}
          <View style={styles.sortSection}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsScroll}
            >
              {FOOD_HISTORY_SORT_OPTIONS.map((option) => {
                const active = sort === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => setSort(option.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Sort by ${option.label}`}
                    style={[styles.chip, active && styles.chipActive]}
                    testID={`scoped-sort-chip-${option.id}`}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {deleteError && (
            <View style={styles.errorWrap}>
              <Text style={styles.errorText}>{deleteError}</Text>
            </View>
          )}

          {/* Content list */}
          {scopedQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator
                size="large"
                color={theme.color.primary}
                testID="scoped-food-logs-loading"
                accessibilityLabel="Loading logged dishes"
              />
            </View>
          ) : scopedQuery.isError ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.errorText}>Could not load logged dishes.</Text>
            </View>
          ) : displayedLogs.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="restaurant-outline"
                title={rawLogs.length === 0 ? 'No logged items here yet' : 'No matching dishes'}
                body={
                  rawLogs.length === 0
                    ? 'Dishes you log at this location will appear here.'
                    : 'Try clearing your search to see all logged dishes.'
                }
                testID="scoped-food-logs-empty"
              />
            </View>
          ) : (
            <FlatList
              data={displayedLogs}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={renderLogRow}
            />
          )}
        </View>
      </View>
    </Modal>
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
    maxHeight: '85%',
    minHeight: '45%',
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
    height: 42,
  },
  searchInput: {
    flex: 1,
    marginLeft: theme.spacing.sm,
    fontSize: 14,
    color: theme.color.textPrimary,
  },
  clearBtn: {
    padding: 4,
  },
  sortSection: {
    marginVertical: theme.spacing.xs,
  },
  chipsScroll: {
    paddingHorizontal: theme.spacing.lg,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  chipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  chipText: {
    fontSize: 12,
    color: theme.color.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: theme.color.textOnPrimary,
    fontWeight: '700',
  },
  errorWrap: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xs,
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 13,
  },
  loadingWrap: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    paddingVertical: 32,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.lg,
    gap: 10,
  },
  logCard: {
    padding: theme.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  dishName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: theme.color.textPrimary,
    marginRight: 8,
  },
  deleteBtn: {
    padding: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  dateText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surfaceAlt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  noteText: {
    marginTop: 6,
    fontSize: 13,
    color: theme.color.textSecondary,
    lineHeight: 18,
  },
});
