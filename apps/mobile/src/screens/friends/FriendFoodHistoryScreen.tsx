import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import {
  FRIEND_FOOD_SEARCH_DEBOUNCE_MS,
  type FoodScopeKind,
  type FriendDishRatingDTO,
  type FriendFoodScopeDTO,
  type FriendFoodSort,
  type Park,
} from '@dwt/shared';

import { ApiError } from '../../api/client';
import { useDebounce } from '../../hooks/useDebounce';
import {
  useFriendFoodList,
  type FriendFoodListParams,
} from '../../hooks/useFriendFoodRatings';
import type { YouAndCrewStackParamList } from '../../navigation/YouAndCrewStack';
import { EmptyState, GradientHeader, ScreenContainer } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  FoodHistoryControls,
  type FilterChipOption,
  type SortOption,
} from '../catalog/foodHistory/FoodHistoryControls';
import {
  describeDishRating,
  formatAverageRating,
  logCountText,
} from './foodRatingFormat';

// ---------------------------------------------------------------------------
// Copy constants
// ---------------------------------------------------------------------------

const UNAVAILABLE_TITLE = 'Profile unavailable';
const UNAVAILABLE_BODY = 'This friend\u2019s profile is no longer available to view.';

const SORT_OPTIONS: readonly SortOption<FriendFoodSort>[] = [
  { id: 'highest_rated', label: 'Highest rated' },
  { id: 'recent', label: 'Most recent' },
  { id: 'most_logged', label: 'Most logged' },
];

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'profile_forbidden';
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function FriendFoodHistoryScreen(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<YouAndCrewStackParamList, 'FriendFoodHistory'>>();
  const { friendId, displayName } = route.params;

  const [sort, setSort] = useState<FriendFoodSort>('recent');
  const [searchText, setSearchText] = useState<string>('');
  const [selectedPark, setSelectedPark] = useState<Park | null>(null);
  const [selectedScope, setSelectedScope] = useState<{
    kind: FoodScopeKind;
    id: string;
  } | null>(null);

  const debouncedSearch = useDebounce(searchText, FRIEND_FOOD_SEARCH_DEBOUNCE_MS);
  const trimmedSearch = debouncedSearch.trim();
  const qParam = trimmedSearch.length > 0 ? trimmedSearch : undefined;

  const listParams: FriendFoodListParams = useMemo(
    () => ({
      sort,
      q: qParam,
      park: selectedPark ?? undefined,
      experienceId:
        selectedScope?.kind === 'experience' ? selectedScope.id : undefined,
      locationId:
        selectedScope?.kind === 'location' ? selectedScope.id : undefined,
    }),
    [sort, qParam, selectedPark, selectedScope],
  );

  const {
    data,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isFetchNextPageError,
  } = useFriendFoodList(friendId, listParams);

  // Cache scopes from first page so filter chips stay available across pagination
  const [cachedScopes, setCachedScopes] = useState<readonly FriendFoodScopeDTO[]>([]);
  useEffect(() => {
    const firstPageScopes = data?.pages[0]?.scopes;
    if (firstPageScopes && firstPageScopes.length > 0) {
      setCachedScopes(firstPageScopes);
    }
  }, [data?.pages]);

  const activeScopes = useMemo(() => {
    const firstPageScopes = data?.pages[0]?.scopes;
    if (firstPageScopes && firstPageScopes.length > 0) {
      return firstPageScopes;
    }
    return cachedScopes;
  }, [data?.pages, cachedScopes]);

  // Derived filter chips: park chips from distinct non-null scopes[].park, plus scope chips
  const availableParks = useMemo(() => {
    const parks = new Set<Park>();
    for (const s of activeScopes) {
      if (s.park) {
        parks.add(s.park);
      }
    }
    return Array.from(parks).sort();
  }, [activeScopes]);

  const filterChips = useMemo<readonly FilterChipOption[]>(() => {
    const chips: FilterChipOption[] = [];
    for (const park of availableParks) {
      chips.push({
        id: park,
        label: park,
        testID: `restaurant-filter-${park}`,
      });
    }
    for (const scope of activeScopes) {
      chips.push({
        id: scope.id,
        label: scope.name,
        testID: `restaurant-filter-${scope.id}`,
      });
    }
    return chips;
  }, [availableParks, activeScopes]);

  const selectedFilterIds = useMemo(() => {
    const set = new Set<string>();
    if (selectedPark) set.add(selectedPark);
    if (selectedScope) set.add(selectedScope.id);
    return set;
  }, [selectedPark, selectedScope]);

  const handleToggleFilter = useCallback(
    (chipId: string) => {
      // Check if it matches a park
      if (availableParks.includes(chipId as Park)) {
        const park = chipId as Park;
        setSelectedPark((prev) => (prev === park ? null : park));
        return;
      }
      // Otherwise it's a scope id
      const matchedScope = activeScopes.find((s) => s.id === chipId);
      if (matchedScope) {
        setSelectedScope((prev) =>
          prev?.id === chipId ? null : { kind: matchedScope.kind, id: matchedScope.id },
        );
      }
    },
    [availableParks, activeScopes],
  );

  const handleClearFilters = useCallback(() => {
    setSelectedPark(null);
    setSelectedScope(null);
  }, []);

  const handleClearAll = useCallback(() => {
    setSearchText('');
    setSelectedPark(null);
    setSelectedScope(null);
  }, []);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  const allItems: readonly FriendDishRatingDTO[] = useMemo(() => {
    return data?.pages.flatMap((p) => p.items) ?? [];
  }, [data?.pages]);

  // Forbidden terminal state (R12.7)
  if (isForbidden(error)) {
    return (
      <ScreenContainer>
        <GradientHeader
          title={`${displayName}'s Food`}
          icon="restaurant"
          compact
          onBack={() => navigation.goBack()}
        />
        <View style={styles.center} testID="friend-profile-unavailable">
          <EmptyState
            icon="lock-closed-outline"
            title={UNAVAILABLE_TITLE}
            body={UNAVAILABLE_BODY}
          />
        </View>
      </ScreenContainer>
    );
  }

  // First-page error state (R12.9)
  const isFirstPageError = isError && allItems.length === 0;

  const renderDishRow = ({ item }: { item: FriendDishRatingDTO }) => (
    <FriendDishRow item={item} />
  );

  const hasActiveFilters = Boolean(
    qParam || selectedPark || selectedScope,
  );

  return (
    <ScreenContainer>
      <View style={styles.outerWrap} testID="friend-food-history-screen">
        <GradientHeader
          title={`${displayName}'s Food`}
          icon="restaurant"
          compact
          onBack={() => navigation.goBack()}
        />

        <View style={styles.container}>
          {/* Controls: Search, Sort Chips, Filter Chips */}
          <FoodHistoryControls
            searchText={searchText}
            onSearchChange={setSearchText}
            searchPlaceholder="Search dishes..."
            sortOptions={SORT_OPTIONS}
            sort={sort}
            onSortChange={setSort}
            filterChips={filterChips}
            selectedFilterIds={selectedFilterIds}
            onToggleFilter={handleToggleFilter}
            onClearFilter={handleClearFilters}
          />

          {/* First page error state */}
          {isFirstPageError ? (
            <View
              style={styles.center}
              testID="friend-food-history-error"
              accessibilityRole="alert"
            >
              <Ionicons
                name="alert-circle-outline"
                size={44}
                color={t.color.danger}
              />
              <Text style={styles.errorTitle}>
                Couldn't load {displayName}'s dishes.
              </Text>
              <Pressable
                onPress={() => void refetch()}
                accessibilityRole="button"
                accessibilityLabel={`Retry loading ${displayName}'s dishes`}
                style={styles.retryBtn}
                testID="friend-food-history-retry"
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : isLoading && allItems.length === 0 ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={t.color.primary} />
            </View>
          ) : allItems.length === 0 ? (
            hasActiveFilters ? (
              <View style={styles.center} testID="friend-food-history-no-matches">
                <Ionicons
                  name="search-outline"
                  size={44}
                  color={t.color.textSecondary}
                />
                <Text style={styles.emptyTitle}>
                  No dishes match your search or filters.
                </Text>
                <Pressable
                  onPress={handleClearAll}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search and filters"
                  style={styles.clearBtn}
                  testID="friend-food-history-clear-all"
                >
                  <Text style={styles.clearBtnText}>Clear filters</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.center} testID="friend-food-history-empty">
                <EmptyState
                  icon="restaurant-outline"
                  title={`${displayName} hasn't logged any dishes yet.`}
                />
              </View>
            )
          ) : (
            <FlatList
              testID="friend-food-history-list"
              data={allItems as FriendDishRatingDTO[]}
              keyExtractor={(item) => item.foodItemId}
              renderItem={renderDishRow}
              contentContainerStyle={styles.listContent}
              onEndReached={handleEndReached}
              onEndReachedThreshold={0.5}
              extraData={t.scheme}
              ListFooterComponent={
                isFetchNextPageError ? (
                  <View
                    style={styles.footerErrorWrap}
                    testID="friend-food-history-page-error"
                  >
                    <Text style={styles.footerErrorText}>
                      Couldn't load more dishes.
                    </Text>
                    <Pressable
                      onPress={() => void fetchNextPage()}
                      accessibilityRole="button"
                      accessibilityLabel="Retry loading more dishes"
                      style={styles.retryPageBtn}
                      testID="friend-food-history-retry-page"
                    >
                      <Text style={styles.retryPageBtnText}>Retry</Text>
                    </Pressable>
                  </View>
                ) : isFetchingNextPage ? (
                  <View style={styles.footerLoaderWrap}>
                    <ActivityIndicator size="small" color={t.color.primary} />
                  </View>
                ) : null
              }
            />
          )}
        </View>
      </View>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// FriendDishRow
// ---------------------------------------------------------------------------

export function FriendDishRow({ item }: { item: FriendDishRatingDTO }): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const a11yLabel = describeDishRating({
    foodItemName: item.foodItemName,
    averageRating: item.averageRating,
    logCount: item.logCount,
  });

  return (
    <View
      style={styles.dishCard}
      testID={`friend-dish-row-${item.foodItemId}`}
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.cardHeader}>
        <View style={styles.titleWrap}>
          <Text style={styles.dishName} numberOfLines={2}>
            {item.foodItemName}
          </Text>
          <View style={styles.placeRow}>
            <Ionicons
              name="location-outline"
              size={14}
              color={t.color.textSecondary}
            />
            <Text style={styles.placeName} numberOfLines={1}>
              {item.scopeName}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.dateText}>{item.latestVisitedOn}</Text>
        <Text style={styles.countText}>{logCountText(item.logCount)}</Text>
        {item.averageRating !== null ? (
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={13} color={t.color.accent} />
            <Text style={styles.ratingText}>
              {formatAverageRating(item.averageRating)}/10
            </Text>
          </View>
        ) : (
          <View style={styles.notRatedBadge}>
            <Text style={styles.notRatedText}>Not rated</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = makeStyles((t) => ({
  outerWrap: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingTop: t.spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.xxl,
    gap: t.spacing.md,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  listContent: {
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.xl,
    gap: 10,
  },
  dishCard: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  titleWrap: {
    flex: 1,
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  dateText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  countText: {
    fontSize: 12,
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: t.radius.sm,
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  notRatedBadge: {
    backgroundColor: t.color.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: t.radius.sm,
  },
  notRatedText: {
    fontSize: 12,
    fontWeight: '500',
    color: t.color.textSecondary,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textPrimary,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    backgroundColor: t.color.primary,
    borderRadius: t.radius.pill,
    marginTop: t.spacing.xs,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textOnPrimary,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textPrimary,
    textAlign: 'center',
  },
  clearBtn: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
    marginTop: t.spacing.xs,
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  footerLoaderWrap: {
    paddingVertical: t.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerErrorWrap: {
    paddingVertical: t.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerErrorText: {
    fontSize: 13,
    color: t.color.danger,
    fontWeight: '500',
  },
  retryPageBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  retryPageBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
}));
