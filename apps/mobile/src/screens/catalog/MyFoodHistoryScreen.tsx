// Feature: food-item-logging, Task 10.2 — My Food History Screen
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, Property 12

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FoodItemLogWithContextDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { Badge, Card, EmptyState, GradientHeader, ScreenContainer } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  FOOD_HISTORY_SORT_OPTIONS,
  type FoodHistorySort,
  deriveDisplayedFoodLogs,
} from './foodHistoryFilters';
import { FoodHistoryControls } from './foodHistory/FoodHistoryControls';
import RateOnCheckoffPrompt from '../foodLists/RateOnCheckoffPrompt';

export default function MyFoodHistoryScreen(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const navigation = useNavigation();
  const queryClient = useQueryClient();

  const [sort, setSort] = useState<FoodHistorySort>('recent');
  const [searchText, setSearchText] = useState<string>('');
  const [selectedRestaurants, setSelectedRestaurants] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingLog, setEditingLog] = useState<FoodItemLogWithContextDTO | null>(null);

  // Query full history (Requirement 8.1, 8.2)
  const logsQuery = useQuery<readonly FoodItemLogWithContextDTO[]>({
    queryKey: ['me-food-item-logs'],
    queryFn: () => apiRequest<readonly FoodItemLogWithContextDTO[]>('GET', '/me/food-item-logs'),
  });

  const rawLogs = logsQuery.data ?? [];

  // Extract distinct restaurant/location names for filter options (Requirement 8.8)
  const availableRestaurants = useMemo(() => {
    const names = new Set<string>();
    for (const log of rawLogs) {
      const name = log.restaurantName ?? log.locationName;
      if (name) {
        names.add(name);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rawLogs]);

  // Derived filtered & sorted logs (Requirement 8.6-8.10, Property 12)
  const displayedLogs = useMemo(() => {
    return deriveDisplayedFoodLogs(rawLogs, {
      sort,
      searchText,
      selectedRestaurantNames: selectedRestaurants,
      searchFields: ['foodItemName', 'restaurantName', 'locationName'],
    });
  }, [rawLogs, sort, searchText, selectedRestaurants]);

  function handleToggleRestaurant(name: string): void {
    setSelectedRestaurants((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function handleClearFilter(): void {
    setSelectedRestaurants(new Set());
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

      // Invalidate history query (Requirement 8.4)
      await queryClient.invalidateQueries({
        queryKey: ['me-food-item-logs'],
      });

      // Invalidate related item and scoped logs queries
      await queryClient.invalidateQueries({
        queryKey: ['food-item-logs', log.foodItemId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['scoped-food-item-logs'],
      });
    } catch {
      setDeleteError('Could not delete log entry. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  // Requirement 8.11: Update rating after the fact on an existing food log
  async function handleUpdateRating(
    foodItemId: string,
    logId: string,
    rating: number,
  ): Promise<void> {
    try {
      await apiRequest(
        'PATCH',
        `/me/food-items/${encodeURIComponent(foodItemId)}/logs/${encodeURIComponent(logId)}`,
        { rating },
      );
      await queryClient.invalidateQueries({
        queryKey: ['me-food-item-logs'],
      });
      await queryClient.invalidateQueries({
        queryKey: ['food-item-logs', foodItemId],
      });
    } catch {
      // Ignore
    }
  }

  // Stable `renderItem` identity — an inline arrow literal is recreated every
  // render (e.g. each keystroke re-deriving `displayedLogs`), which `FlatList`
  // treats as a changed render function and forces the whole visible window
  // to re-render/re-measure. Same fix as `DestinationScreen`'s search-results
  // `renderRow`.
  const renderHistoryRow = useCallback(
    ({ item }: { item: FoodItemLogWithContextDTO }) => {
      const placeName = item.restaurantName ?? item.locationName;
      return (
        <Card
          key={item.id}
          style={styles.logCard}
          testID={`food-history-card-${item.id}`}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.dishName} numberOfLines={2}>
                {item.foodItemName}
              </Text>
              {placeName && (
                <View style={styles.placeRow}>
                  <Ionicons
                    name="location-outline"
                    size={14}
                    color={t.color.textSecondary}
                  />
                  <Text style={styles.placeName} numberOfLines={1}>
                    {placeName}
                  </Text>
                </View>
              )}
            </View>
            <Pressable
              onPress={() => void handleDeleteLog(item)}
              disabled={deletingId === item.id}
              accessibilityRole="button"
              accessibilityLabel={`Delete log for ${item.foodItemName}`}
              style={styles.deleteBtn}
              testID={`food-history-delete-${item.id}`}
            >
              {deletingId === item.id ? (
                <ActivityIndicator size="small" color={t.color.danger} />
              ) : (
                <Ionicons name="trash-outline" size={18} color={t.color.danger} />
              )}
            </Pressable>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.dateText}>{item.visitedOn}</Text>
            {item.rating !== null ? (
              <Pressable
                onPress={() => setEditingLog(item)}
                accessibilityRole="button"
                accessibilityLabel={`Rating for ${item.foodItemName}: ${item.rating} out of 10. Tap to edit`}
                style={styles.ratingBadge}
                testID={`food-history-rating-${item.id}`}
              >
                <Ionicons name="star" size={13} color={t.color.accent} />
                <Text style={styles.ratingText}>{item.rating}/10</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setEditingLog(item)}
                accessibilityRole="button"
                accessibilityLabel={`Add rating for ${item.foodItemName}`}
                style={styles.addRatingBtn}
                testID={`food-history-add-rating-${item.id}`}
              >
                <Ionicons name="star-outline" size={13} color={t.color.primaryFg} />
                <Text style={styles.addRatingText}>+ Add rating</Text>
              </Pressable>
            )}
            {!item.currentlyOnMenu && (
              <Badge
                label="Not currently on menu"
                color={t.color.textSecondary}
                testID={`food-history-not-on-menu-${item.id}`}
              />
            )}
          </View>

          {item.note && item.note.trim().length > 0 && (
            <Text style={styles.noteText}>{item.note}</Text>
          )}
        </Card>
      );
    },
    [deletingId, handleDeleteLog, setEditingLog, styles, t],
  );

  return (
    <ScreenContainer>
      <View testID="my-food-history-screen" style={styles.outerWrap}>
        <GradientHeader
          title="My Food History"
          icon="restaurant"
          compact
          onBack={() => navigation.goBack()}
        />

        <View style={styles.container}>
          {/* Controls (Requirement 8.7, 8.8, 8.9) */}
          <FoodHistoryControls
            searchText={searchText}
            onSearchChange={setSearchText}
            sortOptions={FOOD_HISTORY_SORT_OPTIONS}
            sort={sort}
            onSortChange={setSort}
            filterChips={availableRestaurants.map((name) => ({ id: name, label: name }))}
            selectedFilterIds={selectedRestaurants}
            onToggleFilter={handleToggleRestaurant}
            onClearFilter={handleClearFilter}
          />

        {deleteError && (
          <View style={styles.errorWrap}>
            <Text style={styles.errorText}>{deleteError}</Text>
          </View>
        )}

        {/* Content list */}
        {logsQuery.isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator
              size="large"
              color={t.color.primaryFg}
              testID="food-history-loading"
              accessibilityLabel="Loading food history"
            />
          </View>
        ) : logsQuery.isError ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="alert-circle-outline"
              title="Could not load food history"
              body="Please check your connection and try again."
            />
          </View>
        ) : displayedLogs.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="restaurant-outline"
              title={rawLogs.length === 0 ? 'No food logs yet' : 'No matching dishes'}
              body={
                rawLogs.length === 0
                  ? 'Dishes you log at restaurants or snack stands will appear here.'
                  : 'Try clearing your search or filter to see more dishes.'
              }
              testID="food-history-empty"
            />
          </View>
        ) : (
          <FlatList
            data={displayedLogs}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={renderHistoryRow}
            extraData={t.scheme}
          />
        )}
      </View>
    </View>

    {/* Requirement 8.11: Update rating prompt */}
    {editingLog ? (
      <RateOnCheckoffPrompt
        visible={Boolean(editingLog)}
        foodItemName={editingLog.foodItemName}
        initialRating={editingLog.rating}
        onSkip={() => setEditingLog(null)}
        onConfirm={(rating) => {
          const target = editingLog;
          setEditingLog(null);
          void handleUpdateRating(target.foodItemId, target.id, rating);
        }}
      />
    ) : null}
  </ScreenContainer>
);
}

const useStyles = makeStyles((t) => ({
  outerWrap: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingTop: t.spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: t.spacing.md,
    marginHorizontal: t.spacing.lg,
    marginBottom: t.spacing.sm,
    height: 44,
  },
  searchInput: {
    flex: 1,
    marginLeft: t.spacing.sm,
    fontSize: 15,
    color: t.color.textPrimary,
  },
  clearBtn: {
    padding: 4,
  },
  sortSection: {
    marginBottom: t.spacing.xs,
  },
  filterSection: {
    marginBottom: t.spacing.sm,
  },
  chipsScroll: {
    paddingHorizontal: t.spacing.lg,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  chipActive: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  chipText: {
    fontSize: 13,
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  filterChipActive: {
    backgroundColor: t.color.surfaceAlt,
    borderColor: t.color.primaryFg,
  },
  filterChipText: {
    fontSize: 12,
    color: t.color.textSecondary,
  },
  filterChipTextActive: {
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  errorWrap: {
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.xs,
  },
  errorText: {
    color: t.color.danger,
    fontSize: 13,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: t.spacing.lg,
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.xl,
    gap: 10,
  },
  logCard: {
    padding: t.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardTitleWrap: {
    flex: 1,
    marginRight: 10,
  },
  dishName: {
    fontSize: 16,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  placeName: {
    fontSize: 13,
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  deleteBtn: {
    padding: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  dateText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  addRatingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  addRatingText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  noteText: {
    marginTop: 8,
    fontSize: 13,
    color: t.color.textSecondary,
    lineHeight: 18,
  },
}));
