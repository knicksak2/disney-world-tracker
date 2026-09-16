// Feature: food-item-logging, Task 10.2 — My Food History Screen
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, Property 12

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FoodItemLogWithContextDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge, Card, EmptyState, GradientHeader, ScreenContainer } from '../../theme/components';
import {
  FOOD_HISTORY_SORT_OPTIONS,
  type FoodHistorySort,
  deriveDisplayedFoodLogs,
} from './foodHistoryFilters';

export default function MyFoodHistoryScreen(): JSX.Element {
  const navigation = useNavigation();
  const queryClient = useQueryClient();

  const [sort, setSort] = useState<FoodHistorySort>('recent');
  const [searchText, setSearchText] = useState<string>('');
  const [selectedRestaurants, setSelectedRestaurants] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
        {/* Search bar (Requirement 8.9) */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={theme.color.textSecondary} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search dishes or places..."
            placeholderTextColor={theme.color.textSecondary}
            style={styles.searchInput}
            testID="food-history-search-input"
            autoCorrect={false}
          />
          {searchText.length > 0 && (
            <Pressable
              onPress={() => setSearchText('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search text"
              style={styles.clearBtn}
              testID="food-history-clear-search"
            >
              <Ionicons name="close-circle" size={18} color={theme.color.textSecondary} />
            </Pressable>
          )}
        </View>

        {/* Sort Chips (Requirement 8.7) */}
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
                  testID={`sort-chip-${option.id}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Restaurant Filter Chips (Requirement 8.8) */}
        {availableRestaurants.length > 0 && (
          <View style={styles.filterSection}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsScroll}
            >
              <Pressable
                onPress={handleClearFilter}
                accessibilityRole="button"
                accessibilityLabel="All places"
                style={[
                  styles.filterChip,
                  selectedRestaurants.size === 0 && styles.filterChipActive,
                ]}
                testID="restaurant-filter-all"
              >
                <Text
                  style={[
                    styles.filterChipText,
                    selectedRestaurants.size === 0 && styles.filterChipTextActive,
                  ]}
                >
                  All Places
                </Text>
              </Pressable>
              {availableRestaurants.map((name) => {
                const active = selectedRestaurants.has(name);
                return (
                  <Pressable
                    key={name}
                    onPress={() => handleToggleRestaurant(name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter by ${name}`}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    testID={`restaurant-filter-${name}`}
                  >
                    <Text
                      style={[styles.filterChipText, active && styles.filterChipTextActive]}
                      numberOfLines={1}
                    >
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

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
              color={theme.color.primary}
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
            renderItem={({ item }) => {
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
                            color={theme.color.textSecondary}
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
                        testID={`food-history-not-on-menu-${item.id}`}
                      />
                    )}
                  </View>

                  {item.note && item.note.trim().length > 0 && (
                    <Text style={styles.noteText}>{item.note}</Text>
                  )}
                </Card>
              );
            }}
          />
        )}
      </View>
    </View>
  </ScreenContainer>
);
}

const styles = StyleSheet.create({
  outerWrap: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingTop: theme.spacing.sm,
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
    marginBottom: theme.spacing.sm,
    height: 44,
  },
  searchInput: {
    flex: 1,
    marginLeft: theme.spacing.sm,
    fontSize: 15,
    color: theme.color.textPrimary,
  },
  clearBtn: {
    padding: 4,
  },
  sortSection: {
    marginBottom: theme.spacing.xs,
  },
  filterSection: {
    marginBottom: theme.spacing.sm,
  },
  chipsScroll: {
    paddingHorizontal: theme.spacing.lg,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
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
    fontSize: 13,
    color: theme.color.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: theme.color.textOnPrimary,
    fontWeight: '700',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  filterChipActive: {
    backgroundColor: theme.color.surfaceAlt,
    borderColor: theme.color.primary,
  },
  filterChipText: {
    fontSize: 12,
    color: theme.color.textSecondary,
  },
  filterChipTextActive: {
    color: theme.color.primary,
    fontWeight: '600',
  },
  errorWrap: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xs,
  },
  errorText: {
    color: theme.color.danger,
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
    paddingHorizontal: theme.spacing.lg,
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
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
  cardTitleWrap: {
    flex: 1,
    marginRight: 10,
  },
  dishName: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  placeName: {
    fontSize: 13,
    color: theme.color.textSecondary,
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
    marginTop: 8,
    fontSize: 13,
    color: theme.color.textSecondary,
    lineHeight: 18,
  },
});
