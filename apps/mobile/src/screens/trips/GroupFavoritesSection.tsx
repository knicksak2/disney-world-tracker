/**
 * GroupFavoritesSection — Mobile "Group Favorites" card section on Trip Detail hub.
 *
 * Implements Task 11.1 (Requirements 9.1, 9.4, 9.5).
 *
 * Fetches `GET /trips/:id/favorites/shared` and renders a titled "Group Favorites"
 * card section listing each Experience with its favoriting Members' display names,
 * and a distinct empty state when the result is empty.
 *
 * Textually and visually distinct from the "Crowd Favorite" superlative in Trip Summary.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { GroupFavoriteDTO, GroupFavoritesResponseDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { Badge, Card } from '../../theme/components';
import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { GROUP_FAVORITES } from './GroupFavoritesSection.palette';

export interface GroupFavoritesSectionProps {
  readonly tripId: string;
  readonly onSelectExperience?: (experienceId: string) => void;
  readonly testID?: string;
}

export default function GroupFavoritesSection({
  tripId,
  onSelectExperience,
  testID = 'trip-detail-group-favorites',
}: GroupFavoritesSectionProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(GROUP_FAVORITES);
  const query = useQuery<GroupFavoritesResponseDTO, ApiError>({
    queryKey: ['trips', tripId, 'favorites', 'shared'],
    queryFn: () =>
      apiRequest<GroupFavoritesResponseDTO>(
        'GET',
        `/trips/${tripId}/favorites/shared`,
      ),
    staleTime: 30 * 1000,
  });

  const rawItems = query.data?.items;
  const items: readonly GroupFavoriteDTO[] = Array.isArray(rawItems) ? rawItems : [];

  return (
    <View style={styles.sectionContainer} testID={testID}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Ionicons name="heart" size={18} color={pal.heart} />
          <Text style={styles.sectionTitle}>Group Favorites</Text>
          {items.length > 0 ? (
            <Badge
              label={String(items.length)}
              color={t.color.primaryFg}
            />
          ) : null}
        </View>
      </View>

      {/* Loading state */}
      {query.isLoading && !query.data ? (
        <View style={styles.loadingContainer} testID="group-favorites-loading">
          <ActivityIndicator size="small" color={t.color.primaryFg} />
        </View>
      ) : items.length === 0 ? (
        /* Empty state (Requirement 9.5) */
        <View style={styles.emptyContainer} testID="group-favorites-empty">
          <Text style={styles.emptyTitle}>No group favorites yet</Text>
          <Text style={styles.emptySubtext}>
            When two or more crew members favorite the same experience, it will appear here.
          </Text>
        </View>
      ) : (
        /* Items List (Requirement 9.1, 9.4) */
        <View style={styles.itemsList} testID="group-favorites-list">
          {items.map((item) => (
            <Card
              key={item.experienceId}
              style={styles.itemCard}
            >
              <Pressable
                testID={`group-favorite-item-${item.experienceId}`}
                style={({ pressed }) => [
                  styles.itemContent,
                  pressed && onSelectExperience && styles.itemPressed,
                ]}
                onPress={() => onSelectExperience?.(item.experienceId)}
                disabled={!onSelectExperience}
                accessibilityRole={onSelectExperience ? 'button' : undefined}
                accessibilityLabel={`${item.experienceName}, favorited by ${item.favoritingDisplayNames.join(', ')}`}
              >
                <View style={styles.itemMainRow}>
                  <View style={styles.itemLeft}>
                    <Text style={styles.experienceName} numberOfLines={1}>
                      {item.experienceName}
                    </Text>
                    {item.park ? (
                      <Text style={styles.parkText} numberOfLines={1}>
                        {item.park}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.countBadge}>
                    <Ionicons name="heart" size={12} color={pal.heart} />
                    <Text style={styles.countText}>{item.favoritingCount}</Text>
                  </View>
                </View>

                <View style={styles.membersRow}>
                  <Ionicons
                    name="people-outline"
                    size={14}
                    color={t.color.textSecondary}
                  />
                  <Text style={styles.membersText} numberOfLines={2}>
                    Favorited by {item.favoritingDisplayNames.join(', ')}
                  </Text>
                </View>
              </Pressable>
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  sectionContainer: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  sectionTitle: {
    ...theme.typography.subtitle,
    color: t.color.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  loadingContainer: {
    padding: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    padding: theme.spacing.md,
    backgroundColor: `${t.color.primary}0a`,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: `${t.color.primaryFg}18`,
    gap: 4,
  },
  emptyTitle: {
    ...theme.typography.body,
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  emptySubtext: {
    ...theme.typography.meta,
    color: t.color.textSecondary,
  },
  itemsList: {
    gap: theme.spacing.xs,
  },
  itemCard: {
    padding: theme.spacing.md,
    marginBottom: 0,
  },
  itemContent: {
    gap: theme.spacing.xs,
  },
  itemPressed: {
    opacity: 0.8,
  },
  itemMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  itemLeft: {
    flex: 1,
    gap: 2,
  },
  experienceName: {
    ...theme.typography.body,
    fontSize: 15,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  parkText: {
    ...theme.typography.meta,
    fontSize: 12,
    color: t.color.textSecondary,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: GROUP_FAVORITES[t.scheme].countBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
  },
  countText: {
    fontSize: 12,
    fontWeight: '700',
    color: GROUP_FAVORITES[t.scheme].heart,
  },
  membersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  membersText: {
    ...theme.typography.meta,
    fontSize: 13,
    color: t.color.textSecondary,
    flex: 1,
  },
}));
