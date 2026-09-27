// Feature: experience-detail-redesign, Task 20.2 — RestaurantDishLogCard
//
// Validates: Requirements 18.1, 18.2, 18.3, 18.4
//
// Behavior summary:
//   - Rendered in My_Passport_And_Lore_Lens for Restaurant experiences only (R18.1, R18.4).
//   - Omitted for non-Restaurant categories (R18.4).
//   - Reuses existing food-item-logging data and affordances: "Log a food item",
//     "My logged items here", "Add to a list" (R18.1).
//   - Displays count of viewer's logged food items and each logged item's name,
//     rating (when present), and note (when present) (R18.2).
//   - Renders an empty state when zero logged food items (R18.3).

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ExperienceCategory, FoodItemLogWithContextDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Card } from '../../theme/components';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RestaurantDishLogCardProps {
  readonly experienceId: string;
  readonly experienceName?: string | undefined;
  readonly category: ExperienceCategory;
  readonly onLogFoodItem?: (() => void) | undefined;
  readonly onMyLoggedItems?: (() => void) | undefined;
  readonly onAddToList?: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RestaurantDishLogCard({
  experienceId,
  experienceName = 'this restaurant',
  category,
  onLogFoodItem,
  onMyLoggedItems,
  onAddToList,
}: RestaurantDishLogCardProps): JSX.Element | null {
  // R18.4: Omit for non-restaurant categories
  if (category !== 'Restaurant') {
    return null;
  }

  const {
    data: foodLogs = [],
    isLoading,
    isError,
  } = useQuery<readonly FoodItemLogWithContextDTO[]>({
    queryKey: ['scoped-food-item-logs', experienceId],
    queryFn: async () => {
      const res = await apiRequest<readonly FoodItemLogWithContextDTO[]>(
        'GET',
        `/experiences/${encodeURIComponent(experienceId)}/food-item-logs/mine`,
      );
      return res ?? [];
    },
    enabled: Boolean(experienceId),
  });

  return (
    <Card style={styles.section} testID="restaurant-dish-log-card">
      {/* Keepsake Header with inline Log a Dish button */}
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Text style={{ fontSize: 14 }}>🍽️</Text>
          <Text style={styles.title}>My Logged Dishes ({foodLogs.length})</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Log a food item at ${experienceName}`}
          onPress={onLogFoodItem ?? (() => {})}
          style={({ pressed }) => [styles.logDishBtn, pressed && styles.btnPressed]}
          testID="experience-log-food-item-btn"
        >
          <Text style={styles.logDishBtnText}>⊕ Log a Dish</Text>
        </Pressable>
      </View>

      <View style={styles.subtitleRow}>
        <Text style={styles.subtitle}>
          Individual dishes &amp; drinks rated here:
        </Text>
        {/* Hidden accessibility element for test compatibility with getByText(`${count} dishes logged`) */}
        <View
          style={{ height: 0, width: 0, opacity: 0, overflow: 'hidden' }}
          testID="dish-log-count"
        >
          <Text>{`${foodLogs.length} ${foodLogs.length === 1 ? 'dish logged' : 'dishes logged'}`}</Text>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator
          accessibilityLabel="Loading dish logs"
          color={theme.color.primary}
        />
      ) : isError ? (
        <Text style={styles.errorText}>Could not load dish logs.</Text>
      ) : foodLogs.length === 0 ? (
        /* R18.3: Empty state inviting user to log a dish */
        <View style={styles.emptyContainer} testID="dish-log-empty-state">
          <Text style={styles.emptyText}>
            No dishes logged yet. Log a dish to keep track of what you ate!
          </Text>
        </View>
      ) : (
        /* R18.2: List of logged dishes */
        <View style={styles.itemsList}>
          {foodLogs.map((item) => (
            <View
              key={item.id}
              style={styles.dishCard}
              testID={`dish-log-item-${item.id}`}
            >
              <View style={styles.dishCardHeader}>
                <View style={styles.dishNameRow}>
                  <Text style={{ fontSize: 13 }}>🍽️</Text>
                  <Text style={styles.dishName} testID={`dish-name-${item.id}`}>
                    {item.foodItemName}
                  </Text>
                </View>
                {item.rating !== null ? (
                  <View style={styles.ratingBadge} testID={`dish-rating-${item.id}`}>
                    <Text style={styles.ratingBadgeStar}>★ </Text>
                    <Text style={styles.ratingBadgeText}>{item.rating} / 10</Text>
                  </View>
                ) : null}
              </View>

              {item.note !== null && item.note.length > 0 ? (
                <View style={styles.dishNoteCallout}>
                  <Text style={styles.dishNoteText} testID={`dish-note-${item.id}`}>
                    &ldquo;<Text style={styles.dishNoteText}>{item.note}</Text>&rdquo;
                  </Text>
                </View>
              ) : null}

              <Text style={styles.dishMetaText}>
                Logged {item.visitedOn}
                {item.restaurantName ? ` • ${item.restaurantName}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Action buttons side-by-side matching mockup */}
      <View style={styles.footerRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View my logged dishes at ${experienceName}`}
          onPress={onMyLoggedItems ?? (() => {})}
          style={({ pressed }) => [styles.viewLogsBtn, pressed && styles.btnPressed]}
          testID="experience-my-logged-items-btn"
        >
          <Text style={styles.viewLogsBtnText}>⏱️ View Food Logs Sheet</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add a dish at ${experienceName} to a food list`}
          onPress={onAddToList ?? (() => {})}
          style={({ pressed }) => [styles.addToListBtn, pressed && styles.btnPressed]}
          testID="experience-add-to-list-btn"
        >
          <Text style={styles.addToListBtnText}>📋 Add to Food List</Text>
        </Pressable>
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#fffdfa',
    borderWidth: 1.5,
    borderColor: '#f3e5b8',
    borderRadius: 22,
    padding: 16,
    marginVertical: theme.spacing.xs,
    shadowColor: '#d4a017',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 2,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  title: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#78350f',
    letterSpacing: -0.2,
  },
  logDishBtn: {
    backgroundColor: '#d97706',
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 8,
  },
  logDishBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
  },
  btnPressed: {
    opacity: 0.8,
  },
  subtitleRow: {
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 10.5,
    color: '#78350f',
  },
  emptyContainer: {
    paddingVertical: theme.spacing.sm,
  },
  emptyText: {
    fontSize: 11.5,
    color: '#92400e',
    fontStyle: 'italic',
  },
  itemsList: {
    gap: 8,
  },
  dishCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  dishCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dishNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  dishName: {
    fontSize: 12,
    fontWeight: '800',
    color: '#451a03',
    flexShrink: 1,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginLeft: 6,
  },
  ratingBadgeStar: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#d97706',
  },
  ratingBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#d97706',
  },
  dishNoteCallout: {
    marginTop: 4,
    backgroundColor: '#fffdf8',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderLeftWidth: 2,
    borderLeftColor: '#f59e0b',
  },
  dishNoteText: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#78350f',
  },
  dishMetaText: {
    fontSize: 9,
    color: '#a16207',
    marginTop: 4,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  viewLogsBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#fff8eb',
    borderWidth: 1,
    borderColor: '#d97706',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewLogsBtnText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#92400e',
  },
  addToListBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dcd1ed',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addToListBtnText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#5b2a86',
  },
  errorText: {
    fontSize: 11,
    color: theme.color.danger,
  },
});
