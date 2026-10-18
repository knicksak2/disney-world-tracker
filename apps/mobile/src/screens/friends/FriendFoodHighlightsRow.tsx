import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { FriendDishRatingDTO } from '@dwt/shared';

import { ApiError } from '../../api/client';
import { useFriendFoodHighlights } from '../../hooks/useFriendFoodRatings';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import { describeDishRating, formatAverageRating } from './foodRatingFormat';

export interface FriendFoodHighlightsRowProps {
  readonly friendId: string;
  readonly displayName: string;
  readonly onForbidden?: () => void;
}

function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'profile_forbidden';
}

export function FriendFoodHighlightsRow({
  friendId,
  displayName,
  onForbidden,
}: FriendFoodHighlightsRowProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const navigation = useNavigation<any>();

  const { data, isLoading, isError, error, refetch } =
    useFriendFoodHighlights(friendId);

  // Filter out any unrated dishes (Highlights are rated-only)
  const items = React.useMemo(() => {
    return (data?.items ?? []).filter((item) => item.averageRating !== null);
  }, [data?.items]);

  // Propagate profile_forbidden to parent screen if callback provided
  React.useEffect(() => {
    if (isForbidden(error) && onForbidden) {
      onForbidden();
    }
  }, [error, onForbidden]);

  if (isForbidden(error)) {
    return null;
  }

  const handleSeeAll = () => {
    navigation.navigate('FriendFoodHistory', {
      friendId,
      displayName,
    });
  };

  return (
    <View style={styles.container} testID="friend-food-highlights">
      {/* Header row: Title and "See all" action */}
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>Food Highlights</Text>
          <Text style={styles.subtitle}>Top-rated favorites</Text>
        </View>
        <Pressable
          onPress={handleSeeAll}
          accessibilityRole="button"
          accessibilityLabel={`See all of ${displayName}'s dishes`}
          style={styles.seeAllBtn}
          testID="friend-food-see-all"
        >
          <Text style={styles.seeAllText}>See all</Text>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={t.color.primaryFg}
          />
        </Pressable>
      </View>

      {/* Content: Loading, Error, Empty, or Cards */}
      {isLoading ? (
        <View style={styles.loaderWrap} testID="friend-food-highlights-loading">
          <ActivityIndicator size="small" color={t.color.primary} />
        </View>
      ) : isError ? (
        <View style={styles.errorCard} testID="friend-food-highlights-error">
          <View style={styles.errorContent}>
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color={t.color.danger}
            />
            <Text style={styles.errorText}>Couldn't load food highlights.</Text>
          </View>
          <Pressable
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading food highlights"
            style={styles.retryBtn}
            testID="friend-food-highlights-retry"
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyCard} testID="friend-food-highlights-empty">
          <View style={styles.emptyContent}>
            <Ionicons
              name="restaurant-outline"
              size={20}
              color={t.color.textSecondary}
            />
            <Text style={styles.emptyText}>
              {displayName} hasn't rated any dishes yet.
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cardsScroll}
          testID="friend-food-highlights-scroll"
        >
          {items.map((item) => (
            <HighlightCard key={item.foodItemId} item={item} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function HighlightCard({ item }: { item: FriendDishRatingDTO }): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const a11yLabel = describeDishRating({
    foodItemName: item.foodItemName,
    averageRating: item.averageRating,
    logCount: item.logCount,
  });

  return (
    <View
      style={styles.card}
      testID={`friend-food-highlight-card-${item.foodItemId}`}
      accessibilityLabel={a11yLabel}
      accessible={true}
    >
      <View style={styles.cardTop}>
        <Text style={styles.dishName} numberOfLines={2}>
          {item.foodItemName}
        </Text>
        <View style={styles.scopeRow}>
          <Ionicons
            name="location-outline"
            size={12}
            color={t.color.textSecondary}
          />
          <Text style={styles.scopeName} numberOfLines={1}>
            {item.scopeName}
          </Text>
        </View>
      </View>

      <View style={styles.ratingBadge}>
        <Ionicons name="star" size={13} color={t.color.accent} />
        <Text style={styles.ratingText}>
          {item.averageRating !== null
            ? `${formatAverageRating(item.averageRating)}/10`
            : 'Not rated'}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    marginTop: t.spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: t.spacing.sm,
  },
  titleWrap: {
    flex: 1,
    marginRight: t.spacing.sm,
  },
  title: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  subtitle: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
  },
  seeAllText: {
    ...t.typography.meta,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  loaderWrap: {
    paddingVertical: t.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorCard: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.spacing.md,
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  errorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  errorText: {
    ...t.typography.body,
    fontSize: 13,
    color: t.color.textPrimary,
  },
  retryBtn: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: 5,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  retryBtnText: {
    ...t.typography.meta,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  emptyCard: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.spacing.md,
    alignItems: 'center',
  },
  emptyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  emptyText: {
    ...t.typography.body,
    fontSize: 13,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  cardsScroll: {
    gap: t.spacing.sm,
    paddingVertical: 2,
  },
  card: {
    width: 170,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.spacing.md,
    justifyContent: 'space-between',
    minHeight: 110,
  },
  cardTop: {
    gap: 4,
  },
  dishName: {
    fontSize: 14,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  scopeName: {
    fontSize: 12,
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: t.radius.sm,
    gap: 4,
    marginTop: t.spacing.xs,
  },
  ratingText: {
    fontSize: 11,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
}));
