import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { FoodListDiscoveryPageDTO, FoodListDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Card, GradientHeader, ScreenContainer } from '../../theme/components';

export default function FoodListDiscoveryScreen(): JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const [sort, setSort] = useState<'popular' | 'recent'>('popular');

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<FoodListDiscoveryPageDTO>({
    queryKey: ['food-lists-discovery', sort],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ sort });
      if (typeof pageParam === 'string' && pageParam.length > 0) {
        params.set('cursor', pageParam);
      }
      return apiRequest<FoodListDiscoveryPageDTO>('GET', `/food-lists/discover?${params.toString()}`);
    },
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const allLists: readonly FoodListDTO[] = data?.pages.flatMap((p) => p.items) ?? [];

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  };

  return (
    <ScreenContainer>
      <View style={{ flex: 1 }} testID="food-list-discovery-screen">
        <GradientHeader
          title="Discover Lists"
          subtitle="Explore community food collections"
          compact
          onBack={() => navigation.goBack()}
        />

        {/* Sort Filter Header */}
        <View style={styles.filterBar}>
          <Pressable
            onPress={() => setSort('popular')}
            style={[styles.sortTab, sort === 'popular' && styles.sortTabActive]}
            accessibilityRole="button"
            accessibilityLabel="Sort by popular"
            testID="food-discovery-sort-popular"
          >
            <Ionicons
              name="flame-outline"
              size={16}
              color={sort === 'popular' ? '#fff' : theme.color.textSecondary}
            />
            <Text style={[styles.sortTabText, sort === 'popular' && styles.sortTabTextActive]}>
              Popular
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setSort('recent')}
            style={[styles.sortTab, sort === 'recent' && styles.sortTabActive]}
            accessibilityRole="button"
            accessibilityLabel="Sort by recent"
            testID="food-discovery-sort-recent"
          >
            <Ionicons
              name="time-outline"
              size={16}
              color={sort === 'recent' ? '#fff' : theme.color.textSecondary}
            />
            <Text style={[styles.sortTabText, sort === 'recent' && styles.sortTabTextActive]}>
              Recent
            </Text>
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={theme.color.primary} />
          </View>
        ) : isError ? (
          <View style={styles.centerWrap}>
            <Text style={styles.errorText}>Could not load public food lists.</Text>
          </View>
        ) : (
          <FlatList
            data={allLists}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Card style={styles.listCard}>
                <Pressable
                  onPress={() =>
                    navigation.navigate('FoodListDetail', {
                      foodListId: item.id,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Open food list ${item.name}`}
                  testID={`food-discovery-item-${item.id}`}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.listName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <View style={styles.likeBadge}>
                      <Ionicons name="heart" size={14} color={theme.color.danger} />
                      <Text style={styles.likeCount}>{item.likeCount}</Text>
                    </View>
                  </View>

                  <View style={styles.cardFooter}>
                    <Text style={styles.ownerText}>by {item.ownerDisplayName}</Text>
                    <Text style={styles.itemCountText}>
                      {item.itemCount} {item.itemCount === 1 ? 'item' : 'items'}
                    </Text>
                  </View>
                </Pressable>
              </Card>
            )}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              isFetchingNextPage ? (
                <View style={styles.footerLoading}>
                  <ActivityIndicator size="small" color={theme.color.primary} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="compass-outline" size={48} color={theme.color.borderStrong} />
                <Text style={styles.emptyText}>No public food lists found yet.</Text>
              </View>
            }
          />
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  filterBar: {
    flexDirection: 'row',
    padding: theme.spacing.md,
    gap: 10,
  },
  sortTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
  },
  sortTabActive: {
    backgroundColor: theme.color.primary,
  },
  sortTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  sortTabTextActive: {
    color: '#fff',
  },
  listContent: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: 24,
    gap: 10,
  },
  listCard: {
    padding: theme.spacing.md,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listName: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.color.textPrimary,
    flex: 1,
    marginRight: 8,
  },
  likeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(214, 51, 108, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  likeCount: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.danger,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ownerText: {
    fontSize: 11,
    color: theme.color.textSecondary,
  },
  itemCountText: {
    fontSize: 11,
    color: theme.color.primary,
    fontWeight: '600',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 15,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
    gap: 12,
  },
  emptyText: {
    color: theme.color.textSecondary,
    fontSize: 15,
  },
  footerLoading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
