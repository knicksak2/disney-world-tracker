/**
 * FoodStatsScreen — Dedicated Food Stats detail screen of the Stats tab
 * (stats-experience-redesign R24–R28, task 23).
 *
 * A focused, bounded detail screen pushed onto the `StatsStack` from the
 * Overview hub's Food & Dining highlight card. It unifies:
 *   1. Food activity volume odometer counters (total dishes logged, distinct restaurants, repeat multiplier)
 *   2. Most Logged Dishes Podium (top 3 with podium steps + ranks 4 and 5 as runners-up)
 *   3. Highest Rated Dishes list (visually distinct from podium, gated by minimum 2 ratings)
 *   4. Personal Records & Bests (Most Adventurous Day, Dish Marathon Record)
 *   5. Dish Rankings with sort toggle ("Most Logged" vs "Highest Rated")
 *   6. Empty state when totalDishesLogged === 0
 *
 * Reads from the shared cached `['me-stats', { percentile: true }]` query (R28.7).
 *
 * Validates: Requirements 24.1–24.6, 25.1–25.4, 26.1–26.5, 27.1–27.5, 28.1–28.7
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import { ApiError, apiRequest } from '../../api/client';
import type { StatsResponse } from '../../api/statsTypes';
import {
  Card,
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { theme } from '../../theme/theme';

import {
  formatDishMarathonRecord,
  formatFoodOdometer,
  formatMostAdventurousDay,
} from './statsView';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const FOOD_STATS_ERROR_TITLE = 'Couldn\u2019t load food stats';
const FOOD_STATS_ERROR_BODY =
  'Couldn\u2019t load your food statistics. Please try again.';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function FoodStatsScreen(): JSX.Element {
  const navigation = useNavigation();

  // Shared stats query for food activity metrics (reads from warm cache, R28.7)
  const statsQuery = useQuery<StatsResponse, ApiError>({
    queryKey: ['me-stats', { percentile: true }],
    queryFn: () => apiRequest<StatsResponse>('GET', '/me/stats?percentile=true'),
    staleTime: 30 * 1000,
  });

  const [sortBy, setSortBy] = React.useState<'logged' | 'rated'>('logged');

  const foodActivity = statsQuery.data?.foodActivity;
  const hasFoodActivity = Boolean(
    foodActivity && foodActivity.totalDishesLogged > 0,
  );

  const header = (
    <GradientHeader
      title="Food Stats"
      subtitle={
        hasFoodActivity
          ? `${foodActivity!.totalDishesLogged} dishes logged across ${foodActivity!.distinctRestaurantsVisited} places.`
          : 'Your dining achievements and food stats.'
      }
      icon="restaurant"
      onBack={() => navigation.goBack()}
    />
  );

  // Loading state
  if (statsQuery.isFetching && statsQuery.data === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="food-stats-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      </ScreenContainer>
    );
  }

  // Error state
  if (statsQuery.data === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="food-stats-error">
          <EmptyState
            icon="cloud-offline-outline"
            title={FOOD_STATS_ERROR_TITLE}
            body={FOOD_STATS_ERROR_BODY}
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void statsQuery.refetch();
            }}
            testID="food-stats-error-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  // R28.6: Zero-food-log empty state (omits odometer, podium, highest rated, records)
  if (!hasFoodActivity || !foodActivity) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} testID="food-empty-state">
          <EmptyState
            icon="restaurant-outline"
            title="No dishes logged yet"
            body="Start logging dishes from restaurant menus to track your dining adventures, podiums, and personal records!"
          />
        </View>
      </ScreenContainer>
    );
  }

  const odo = formatFoodOdometer(foodActivity);
  const adventurousDay = foodActivity.personalRecords
    ? formatMostAdventurousDay(foodActivity.personalRecords.mostAdventurousDay)
    : null;
  const dishMarathon = foodActivity.personalRecords
    ? formatDishMarathonRecord(foodActivity.personalRecords.dishMarathonRecord)
    : null;

  const firstDish = foodActivity.mostLogged[0];
  const secondDish = foodActivity.mostLogged[1];
  const thirdDish = foodActivity.mostLogged[2];

  return (
    <ScreenContainer>
      {header}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        testID="food-stats-screen"
      >
        {/* TOP SECTION: Food Odometer (R28.2) */}
        <View style={styles.odometerGrid} testID="food-odometer-grid">
          <View style={styles.odometerCard} testID="food-odometer-total-logged">
            <Text style={styles.odometerVal}>{odo.totalDishes}</Text>
            <Text style={styles.odometerLbl}>Total Dishes Logged</Text>
          </View>
          <View
            style={styles.odometerCard}
            testID="food-odometer-distinct-restaurants"
          >
            <Text style={styles.odometerVal}>{odo.distinctRestaurants}</Text>
            <Text style={styles.odometerLbl}>Distinct Restaurants</Text>
          </View>
          <View
            style={styles.odometerCard}
            testID="food-odometer-repeat-multiplier"
          >
            <Text style={styles.odometerVal}>{odo.repeatMultiplier}</Text>
            <Text style={styles.odometerLbl}>Repeat Multiplier</Text>
          </View>
        </View>

        {/* SECTION 2: Most Logged Dishes Podium (R25, R28.3) */}
        {foodActivity.mostLogged.length > 0 && (
          <View style={styles.podiumCard} testID="food-podium-card">
            <View style={styles.podiumHeader}>
              <Text style={styles.podiumTitle}>👑 Most Logged Dishes</Text>
              <Text style={styles.podiumSubtitle}>All-time</Text>
            </View>

            {/* 3-Step Podium (2nd, 1st, 3rd) with only-render-if-present-rank guards */}
            <View style={styles.podiumSteps}>
              {/* 2nd place (Silver) */}
              {secondDish ? (
                <View style={styles.podiumColumn} testID="food-podium-step-2">
                  <Text style={styles.podiumMedal}>🥈</Text>
                  <Text style={styles.podiumName} numberOfLines={1}>
                    {secondDish.foodItemName}
                  </Text>
                  <Text style={styles.podiumLogs}>
                    {secondDish.count} {secondDish.count === 1 ? 'log' : 'logs'}
                  </Text>
                  <View style={[styles.podiumBar, styles.podiumBarSilver]} />
                </View>
              ) : null}

              {/* 1st place (Gold) */}
              {firstDish ? (
                <View style={styles.podiumColumn} testID="food-podium-step-1">
                  <Text style={styles.podiumMedal}>🥇</Text>
                  <Text
                    style={[styles.podiumName, styles.podiumNameGold]}
                    numberOfLines={1}
                  >
                    {firstDish.foodItemName}
                  </Text>
                  <Text style={[styles.podiumLogs, styles.podiumLogsGold]}>
                    {firstDish.count} {firstDish.count === 1 ? 'log' : 'logs'}
                  </Text>
                  <View style={[styles.podiumBar, styles.podiumBarGold]} />
                </View>
              ) : null}

              {/* 3rd place (Bronze) */}
              {thirdDish ? (
                <View style={styles.podiumColumn} testID="food-podium-step-3">
                  <Text style={styles.podiumMedal}>🥉</Text>
                  <Text style={styles.podiumName} numberOfLines={1}>
                    {thirdDish.foodItemName}
                  </Text>
                  <Text style={styles.podiumLogs}>
                    {thirdDish.count} {thirdDish.count === 1 ? 'log' : 'logs'}
                  </Text>
                  <View style={[styles.podiumBar, styles.podiumBarBronze]} />
                </View>
              ) : null}
            </View>

            {/* Ranks 4 & 5 list if present */}
            {foodActivity.mostLogged.length > 3 && (
              <View style={styles.podiumRunnersUp}>
                {foodActivity.mostLogged.slice(3, 5).map((dish, idx) => (
                  <View key={dish.foodItemId} style={styles.runnerUpRow}>
                    <Text style={styles.runnerUpRank}>{idx + 4}.</Text>
                    <Text style={styles.runnerUpName} numberOfLines={1}>
                      {dish.foodItemName}
                    </Text>
                    <Text style={styles.runnerUpCount}>
                      {dish.count} {dish.count === 1 ? 'log' : 'logs'}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* SECTION 3: Highest Rated Dishes (R26, R28.3 — Visually Distinct from Podium) */}
        <View style={styles.highestRatedSection} testID="food-highest-rated-section">
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>⭐ Highest Rated Dishes</Text>
            <Text style={styles.sectionMeta}>Min. 2 ratings</Text>
          </View>
          <Card style={styles.highestRatedCard}>
            {foodActivity.highestRated.length === 0 ? (
              <Text style={styles.emptyNote} testID="food-highest-rated-empty">
                No dishes with at least 2 ratings yet — rate your favorite dishes on multiple visits to see them here!
              </Text>
            ) : (
              foodActivity.highestRated.map((dish, idx) => (
                <View
                  key={dish.foodItemId}
                  style={[
                    styles.ratedRow,
                    idx > 0 && styles.ratedRowBorder,
                  ]}
                  testID={`food-highest-rated-row-${idx + 1}`}
                >
                  <Text style={styles.ratedRank}>{idx + 1}.</Text>
                  <Text style={styles.ratedName} numberOfLines={1}>
                    {dish.foodItemName}
                  </Text>
                  <View style={styles.ratedRatingWrap}>
                    <Text style={styles.ratedStars}>★</Text>
                    <Text style={styles.ratedScore}>
                      {dish.averageRating.toFixed(1)}
                    </Text>
                    <Text style={styles.ratedCount}>
                      ({dish.ratedLogCount})
                    </Text>
                  </View>
                </View>
              ))
            )}
          </Card>
        </View>

        {/* SECTION 4: Personal Records & Bests (R27, R28.4) */}
        {(adventurousDay || dishMarathon) && (
          <View style={styles.recordsSection}>
            <Text style={styles.sectionTitle}>Personal Records & Bests</Text>
            {adventurousDay && (
              <View
                style={styles.recordCard}
                testID="food-record-adventurous-day"
              >
                <View
                  style={[
                    styles.recordIcon,
                    { backgroundColor: '#fff4d6' },
                  ]}
                >
                  <Ionicons name="compass" size={18} color="#d4a017" />
                </View>
                <View style={styles.recordBody}>
                  <Text style={styles.recordHeadline}>
                    {adventurousDay.headline}
                  </Text>
                  <Text style={styles.recordSubtext}>
                    {adventurousDay.subtext}
                  </Text>
                </View>
              </View>
            )}
            {dishMarathon && (
              <View style={styles.recordCard} testID="food-record-marathon">
                <View
                  style={[
                    styles.recordIcon,
                    { backgroundColor: '#eef2ff' },
                  ]}
                >
                  <Ionicons name="restaurant" size={18} color="#3b5bdb" />
                </View>
                <View style={styles.recordBody}>
                  <Text style={styles.recordHeadline}>
                    {dishMarathon.headline}
                  </Text>
                  <Text style={styles.recordSubtext}>
                    {dishMarathon.subtext}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* SECTION 5: Ranked Dishes with Sort Toggle (R28.5) */}
        <View style={styles.catalogHeader}>
          <Text style={styles.sectionTitle}>
            Dish Rankings ({sortBy === 'logged' ? foodActivity.mostLogged.length : foodActivity.highestRated.length})
          </Text>
          <View style={styles.sortToggleContainer}>
            <Pressable
              onPress={() => setSortBy('logged')}
              style={[
                styles.sortButton,
                sortBy === 'logged' && styles.sortButtonActive,
              ]}
              testID="food-sort-toggle-logged"
              accessibilityRole="button"
              accessibilityLabel="Sort by most logged"
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortBy === 'logged' && styles.sortButtonTextActive,
                ]}
              >
                Most Logged
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setSortBy('rated')}
              style={[
                styles.sortButton,
                sortBy === 'rated' && styles.sortButtonActive,
              ]}
              testID="food-sort-toggle-rated"
              accessibilityRole="button"
              accessibilityLabel="Sort by highest rated"
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortBy === 'rated' && styles.sortButtonTextActive,
                ]}
              >
                Highest Rated
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Sorted Dishes List */}
        <Card style={styles.dishesListCard}>
          {sortBy === 'logged' ? (
            foodActivity.mostLogged.length === 0 ? (
              <Text style={styles.emptyNote}>No logged dishes found.</Text>
            ) : (
              foodActivity.mostLogged.map((dish, idx) => (
                <View
                  key={dish.foodItemId}
                  style={[styles.dishRow, idx > 0 && styles.dishRowBorder]}
                  testID={`food-sort-row-logged-${idx + 1}`}
                >
                  <Text style={styles.dishRank}>#{idx + 1}</Text>
                  <Text style={styles.dishName} numberOfLines={1}>
                    {dish.foodItemName}
                  </Text>
                  <Text style={styles.dishBadge}>
                    {dish.count} {dish.count === 1 ? 'log' : 'logs'}
                  </Text>
                </View>
              ))
            )
          ) : foodActivity.highestRated.length === 0 ? (
            <Text style={styles.emptyNote}>
              No dishes meet the 2-rating minimum threshold yet.
            </Text>
          ) : (
            foodActivity.highestRated.map((dish, idx) => (
              <View
                key={dish.foodItemId}
                style={[styles.dishRow, idx > 0 && styles.dishRowBorder]}
                testID={`food-sort-row-rated-${idx + 1}`}
              >
                <Text style={styles.dishRank}>#{idx + 1}</Text>
                <Text style={styles.dishName} numberOfLines={1}>
                  {dish.foodItemName}
                </Text>
                <View style={styles.ratedRatingWrap}>
                  <Text style={styles.ratedStars}>★</Text>
                  <Text style={styles.ratedScore}>
                    {dish.averageRating.toFixed(1)}
                  </Text>
                  <Text style={styles.ratedCount}>
                    ({dish.ratedLogCount})
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scrollContent: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  retryBtn: {
    marginTop: theme.spacing.lg,
    alignSelf: 'center',
  },
  odometerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  odometerCard: {
    flex: 1,
    minWidth: '30%',
    backgroundColor: theme.color.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: 2,
  },
  odometerVal: {
    ...theme.typography.title,
    fontSize: 22,
    fontWeight: '800',
    color: theme.color.primary,
  },
  odometerLbl: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  podiumCard: {
    backgroundColor: '#2b1430',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: '#4d2055',
  },
  podiumHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  podiumTitle: {
    ...theme.typography.subtitle,
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  podiumSubtitle: {
    ...theme.typography.meta,
    fontSize: 10,
    color: '#d6a3d9',
  },
  podiumSteps: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingTop: theme.spacing.xs,
  },
  podiumColumn: {
    flex: 1,
    alignItems: 'center',
    textAlign: 'center',
  },
  podiumMedal: {
    fontSize: 18,
    marginBottom: 2,
  },
  podiumName: {
    ...theme.typography.meta,
    fontSize: 10.5,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
  },
  podiumNameGold: {
    fontWeight: '800',
    fontSize: 11,
  },
  podiumLogs: {
    ...theme.typography.meta,
    fontSize: 10.5,
    fontWeight: '800',
    color: '#f6c343',
    marginBottom: 4,
  },
  podiumLogsGold: {
    fontSize: 11.5,
  },
  podiumBar: {
    width: '100%',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  podiumBarGold: {
    height: 52,
    backgroundColor: 'rgba(246, 195, 67, 0.3)',
    borderTopWidth: 2,
    borderTopColor: '#f6c343',
  },
  podiumBarSilver: {
    height: 36,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  podiumBarBronze: {
    height: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  podiumRunnersUp: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    paddingTop: theme.spacing.xs,
    gap: 4,
  },
  runnerUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  runnerUpRank: {
    ...theme.typography.meta,
    color: '#d6a3d9',
    fontSize: 11,
    fontWeight: '700',
    width: 16,
  },
  runnerUpName: {
    ...theme.typography.meta,
    color: '#ffffff',
    fontSize: 11,
    flex: 1,
  },
  runnerUpCount: {
    ...theme.typography.meta,
    color: '#f6c343',
    fontSize: 11,
    fontWeight: '700',
  },
  highestRatedSection: {
    gap: theme.spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    ...theme.typography.subtitle,
    fontSize: 13,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  sectionMeta: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
    fontWeight: '500',
  },
  highestRatedCard: {
    padding: theme.spacing.sm,
  },
  ratedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.sm,
  },
  ratedRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
  },
  ratedRank: {
    ...theme.typography.meta,
    fontWeight: '700',
    fontSize: 12,
    color: theme.color.textSecondary,
    width: 18,
  },
  ratedName: {
    ...theme.typography.body,
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textPrimary,
    flex: 1,
  },
  ratedRatingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratedStars: {
    fontSize: 12,
    color: '#f59f00',
  },
  ratedScore: {
    ...theme.typography.meta,
    fontWeight: '800',
    fontSize: 12,
    color: theme.color.textPrimary,
  },
  ratedCount: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
  },
  emptyNote: {
    ...theme.typography.meta,
    fontSize: 12,
    color: theme.color.textSecondary,
    fontStyle: 'italic',
    padding: theme.spacing.xs,
    textAlign: 'center',
  },
  recordsSection: {
    gap: theme.spacing.xs,
  },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surface,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    gap: theme.spacing.sm,
  },
  recordIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBody: {
    flex: 1,
    gap: 1,
  },
  recordHeadline: {
    ...theme.typography.body,
    fontWeight: '700',
    fontSize: 12,
    color: theme.color.textPrimary,
  },
  recordSubtext: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.textSecondary,
  },
  catalogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  sortToggleContainer: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 2,
  },
  sortButton: {
    paddingVertical: 4,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.sm - 2,
  },
  sortButtonActive: {
    backgroundColor: theme.color.surface,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sortButtonText: {
    ...theme.typography.meta,
    fontSize: 10,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  sortButtonTextActive: {
    color: theme.color.primary,
    fontWeight: '700',
  },
  dishesListCard: {
    padding: theme.spacing.sm,
  },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.sm,
  },
  dishRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
  },
  dishRank: {
    ...theme.typography.meta,
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.textSecondary,
    width: 24,
  },
  dishName: {
    ...theme.typography.body,
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textPrimary,
    flex: 1,
  },
  dishBadge: {
    ...theme.typography.meta,
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.primary,
  },
});
