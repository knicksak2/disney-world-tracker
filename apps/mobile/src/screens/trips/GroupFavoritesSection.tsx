/**
 * GroupFavoritesSection — Mobile "Group Favorites" card section on Trip Detail hub.
 *
 * Implements Task 11.1 & Task 14 (Requirements 9.1, 9.4, 9.5, 9.6, 9.7, 9.8).
 *
 * Fetches `GET /trips/:id/favorites/shared` and renders a titled "Group Favorites"
 * card section listing up to `previewLimit` (default 5) shared Experiences inline
 * with their favoriting Members' display names, plus a "See all N favorites"
 * bottom-sheet modal with search and park filters when the list overflows, and a
 * distinct empty state when the result is empty.
 *
 * Textually and visually distinct from the "Crowd Favorite" superlative in Trip Summary.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import { useQuery } from '@tanstack/react-query';
import type { GroupFavoriteDTO, GroupFavoritesResponseDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { Badge, Card } from '../../theme/components';
import { theme } from '../../theme/theme';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { GROUP_FAVORITES } from './GroupFavoritesSection.palette';
import {
  GROUP_FAVORITES_PREVIEW_LIMIT,
  deriveGroupFavoriteParks,
  filterGroupFavorites,
  sliceGroupFavoritesPreview,
} from './groupFavoritesView';

export interface GroupFavoritesSectionProps {
  readonly tripId: string;
  readonly onSelectExperience?: (experienceId: string) => void;
  readonly testID?: string;
  readonly embedded?: boolean | undefined;
  readonly compactEmpty?: boolean | undefined;
  readonly previewLimit?: number | undefined;
}

export default function GroupFavoritesSection({
  tripId,
  onSelectExperience,
  testID = 'trip-detail-group-favorites',
  embedded = false,
  compactEmpty = false,
  previewLimit = GROUP_FAVORITES_PREVIEW_LIMIT,
}: GroupFavoritesSectionProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const pal = usePalette(GROUP_FAVORITES);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalSearchQuery, setModalSearchQuery] = useState('');
  const [modalSelectedPark, setModalSelectedPark] = useState<string | null>(null);

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
  const items: readonly GroupFavoriteDTO[] = useMemo(
    () => (Array.isArray(rawItems) ? rawItems : []),
    [rawItems],
  );

  const preview = useMemo(
    () => sliceGroupFavoritesPreview(items, previewLimit),
    [items, previewLimit],
  );

  const availableParks = useMemo(
    () => deriveGroupFavoriteParks(items),
    [items],
  );

  const effectiveSelectedPark =
    modalSelectedPark !== null && availableParks.some((p) => p.park === modalSelectedPark)
      ? modalSelectedPark
      : null;

  const filteredModalItems = useMemo(
    () => filterGroupFavorites(items, effectiveSelectedPark, modalSearchQuery),
    [items, effectiveSelectedPark, modalSearchQuery],
  );

  const hasActiveModalFilters =
    effectiveSelectedPark !== null || modalSearchQuery.trim().length > 0;

  function openModal(): void {
    setModalSearchQuery('');
    setModalSelectedPark(null);
    setModalVisible(true);
  }

  function closeModal(): void {
    setModalVisible(false);
    setModalSearchQuery('');
    setModalSelectedPark(null);
  }

  function handleSelectFromModal(experienceId: string): void {
    closeModal();
    onSelectExperience?.(experienceId);
  }

  function renderFavoriteCard(
    item: GroupFavoriteDTO,
    itemTestID: string,
    onPress?: () => void,
  ): JSX.Element {
    return (
      <Card
        key={item.experienceId}
        style={styles.itemCard}
      >
        <Pressable
          testID={itemTestID}
          style={({ pressed }) => [
            styles.itemContent,
            pressed && onPress && styles.itemPressed,
          ]}
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : undefined}
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
    );
  }

  return (
    <View style={[styles.sectionContainer, embedded && { marginTop: 0 }]} testID={testID}>
      {/* Header Row */}
      {!embedded ? (
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
      ) : null}

      {/* Loading state */}
      {query.isLoading && !query.data ? (
        <View style={styles.loadingContainer} testID="group-favorites-loading">
          <ActivityIndicator size="small" color={t.color.primaryFg} />
        </View>
      ) : items.length === 0 ? (
        /* Empty state (Requirement 9.5) */
        <View
          style={[styles.emptyContainer, compactEmpty && styles.emptyContainerCompact]}
          testID="group-favorites-empty"
        >
          <Text style={styles.emptyTitle}>No group favorites yet</Text>
          <Text style={styles.emptySubtext}>
            When two or more crew members favorite the same experience, it will appear here.
          </Text>
        </View>
      ) : (
        /* Items Preview List + overflow trigger (Requirements 9.1, 9.4, 9.6) */
        <>
          <View style={styles.itemsList} testID="group-favorites-list">
            {preview.visibleItems.map((item) =>
              renderFavoriteCard(
                item,
                `group-favorite-item-${item.experienceId}`,
                onSelectExperience
                  ? () => onSelectExperience(item.experienceId)
                  : undefined,
              ),
            )}
          </View>

          {preview.hasMore ? (
            <Pressable
              testID="group-favorites-see-all-btn"
              style={({ pressed }) => [
                styles.seeAllButton,
                pressed && styles.itemPressed,
              ]}
              onPress={openModal}
              accessibilityRole="button"
              accessibilityLabel={`See all ${items.length} group favorites`}
            >
              <Text style={styles.seeAllText}>
                See all {items.length} favorites
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={t.color.primaryFg}
              />
            </Pressable>
          ) : null}
        </>
      )}

      {/* Full Group Favorites Bottom-Sheet Modal (Requirements 9.7, 9.8) */}
      {modalVisible ? (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={closeModal}
          testID="group-favorites-modal"
        >
          <View style={styles.modalRoot}>
            <Pressable
              style={[StyleSheet.absoluteFill, { backgroundColor: pal.overlayBg }]}
              onPress={closeModal}
              accessibilityRole="button"
              accessibilityLabel="Dismiss group favorites modal"
              testID="group-favorites-modal-backdrop"
            />
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalSheetWrap}
              pointerEvents="box-none"
            >
              <View style={styles.modalSheet} testID="group-favorites-modal-sheet">
                {/* Sheet Header */}
                <View style={styles.modalHeader}>
                  <View style={styles.modalTitleWrap}>
                    <Ionicons name="heart" size={18} color={pal.heart} />
                    <Text style={styles.modalTitle}>Group Favorites</Text>
                    <Badge
                      label={String(items.length)}
                      color={t.color.primaryFg}
                    />
                  </View>
                  <Pressable
                    onPress={closeModal}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Close group favorites"
                    testID="group-favorites-modal-close"
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons name="close" size={22} color={t.color.textPrimary} />
                  </Pressable>
                </View>

                {/* Search Input */}
                <View style={styles.modalSearchRow}>
                  <Ionicons
                    name="search-outline"
                    size={16}
                    color={t.color.textSecondary}
                  />
                  <TextInput
                    value={modalSearchQuery}
                    onChangeText={setModalSearchQuery}
                    placeholder="Search favorites, park, or crew..."
                    placeholderTextColor={t.color.textSecondary}
                    style={styles.modalSearchInput}
                    accessibilityLabel="Search group favorites"
                    testID="group-favorites-modal-search"
                    autoCorrect={false}
                    clearButtonMode="never"
                  />
                  {modalSearchQuery.length > 0 ? (
                    <Pressable
                      onPress={() => setModalSearchQuery('')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Clear search"
                      testID="group-favorites-modal-search-clear"
                    >
                      <Ionicons
                        name="close-circle"
                        size={18}
                        color={t.color.textSecondary}
                      />
                    </Pressable>
                  ) : null}
                </View>

                {/* Park Filter Pills (when 2+ distinct parks exist) */}
                {availableParks.length >= 2 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.parkFiltersScroll}
                    contentContainerStyle={styles.parkFiltersContent}
                    testID="group-favorites-modal-park-filters"
                  >
                    <Pressable
                      onPress={() => setModalSelectedPark(null)}
                      style={[
                        styles.parkPill,
                        effectiveSelectedPark === null && styles.parkPillActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: effectiveSelectedPark === null }}
                      testID="group-favorites-park-pill-all"
                    >
                      <Text
                        style={[
                          styles.parkPillText,
                          effectiveSelectedPark === null && styles.parkPillTextActive,
                        ]}
                      >
                        All ({items.length})
                      </Text>
                    </Pressable>
                    {availableParks.map((entry) => {
                      const isSelected = effectiveSelectedPark === entry.park;
                      return (
                        <Pressable
                          key={entry.park}
                          onPress={() =>
                            setModalSelectedPark(isSelected ? null : entry.park)
                          }
                          style={[
                            styles.parkPill,
                            isSelected && styles.parkPillActive,
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          testID={`group-favorites-park-pill-${entry.park}`}
                        >
                          <Text
                            style={[
                              styles.parkPillText,
                              isSelected && styles.parkPillTextActive,
                            ]}
                          >
                            {entry.park} ({entry.count})
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : null}

                {/* Active Filter Status */}
                {hasActiveModalFilters ? (
                  <View style={styles.filterStatusRow}>
                    <Text style={styles.filterStatusText}>
                      Showing {filteredModalItems.length} of {items.length}
                    </Text>
                    <Pressable
                      onPress={() => {
                        setModalSelectedPark(null);
                        setModalSearchQuery('');
                      }}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Reset filters"
                      testID="group-favorites-modal-reset-filters"
                    >
                      <Text style={styles.filterResetText}>Reset</Text>
                    </Pressable>
                  </View>
                ) : null}

                {/* Full Scrollable Favorites List */}
                <FlatList
                  testID="group-favorites-modal-list"
                  style={styles.modalList}
                  contentContainerStyle={styles.modalListContent}
                  data={filteredModalItems}
                  keyExtractor={(item) => item.experienceId}
                  keyboardShouldPersistTaps="handled"
                  initialNumToRender={20}
                  extraData={t.scheme}
                  renderItem={({ item }) =>
                    renderFavoriteCard(
                      item,
                      `group-favorite-modal-item-${item.experienceId}`,
                      onSelectExperience
                        ? () => handleSelectFromModal(item.experienceId)
                        : undefined,
                    )
                  }
                  ListEmptyComponent={
                    <View
                      style={styles.modalEmpty}
                      testID="group-favorites-modal-empty"
                    >
                      <Text style={styles.modalEmptyTitle}>
                        No matching favorites
                      </Text>
                      <Pressable
                        onPress={() => {
                          setModalSelectedPark(null);
                          setModalSearchQuery('');
                        }}
                        style={styles.modalClearFiltersBtn}
                        accessibilityRole="button"
                        accessibilityLabel="Clear filters"
                        testID="group-favorites-modal-clear-filters"
                      >
                        <Text style={styles.modalClearFiltersText}>
                          Clear filters
                        </Text>
                      </Pressable>
                    </View>
                  }
                />
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      ) : null}
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
  emptyContainerCompact: {
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    gap: 2,
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
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.md,
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
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingVertical: 9,
    paddingHorizontal: theme.spacing.md,
  },
  seeAllText: {
    ...theme.typography.meta,
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    height: '80%',
    backgroundColor: t.color.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  modalTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    flex: 1,
  },
  modalTitle: {
    ...theme.typography.heading,
    fontSize: 17,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 14,
    color: t.color.textPrimary,
    paddingVertical: 4,
  },
  parkFiltersScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  parkFiltersContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  parkPill: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  parkPillActive: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  parkPillText: {
    ...theme.typography.meta,
    fontSize: 12,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  parkPillTextActive: {
    color: t.color.textOnPrimary,
  },
  filterStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  filterStatusText: {
    ...theme.typography.meta,
    fontSize: 12,
    color: t.color.textSecondary,
  },
  filterResetText: {
    ...theme.typography.meta,
    fontSize: 12,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
  modalList: {
    flex: 1,
  },
  modalListContent: {
    gap: theme.spacing.xs,
    paddingBottom: theme.spacing.md,
  },
  modalEmpty: {
    paddingVertical: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  modalEmptyTitle: {
    ...theme.typography.body,
    fontSize: 14,
    fontWeight: '600',
    color: t.color.textPrimary,
  },
  modalClearFiltersBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  modalClearFiltersText: {
    ...theme.typography.meta,
    fontSize: 13,
    fontWeight: '700',
    color: t.color.primaryFg,
  },
}));
