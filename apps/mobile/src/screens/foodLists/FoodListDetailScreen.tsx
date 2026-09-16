import React, { useMemo, useState } from 'react';
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
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ExperienceDTO,
  FoodItemDTO,
  FoodListDetailDTO,
  FoodListItemDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge, Card, GradientHeader, ScreenContainer } from '../../theme/components';
import FoodItemPickerModal from '../catalog/FoodItemPickerModal';
import ManageFoodListSharesSheet from './ManageFoodListSharesSheet';
import { useFoodListNotice } from './foodListNotice';

export interface FoodListDetailParams {
  readonly foodListId: string;
}

interface CatalogSearchResponse {
  readonly experiences: readonly ExperienceDTO[];
}

type FoodListDetailRouteProp = RouteProp<{ FoodListDetail: FoodListDetailParams }, 'FoodListDetail'>;

export default function FoodListDetailScreen(): JSX.Element {
  const route = useRoute<FoodListDetailRouteProp>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { foodListId } = route.params;
  const queryClient = useQueryClient();

  const [isLiking, setIsLiking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [staleWriteNotice, setStaleWriteNotice] = useState<string | null>(null);
  const [manageSharesVisible, setManageSharesVisible] = useState(false);

  // Entry Point 2: Restaurant search modal & scoped picker
  const [restaurantSearchModalVisible, setRestaurantSearchModalVisible] = useState(false);
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [selectedExperience, setSelectedExperience] = useState<ExperienceDTO | null>(null);
  const [pickerModalVisible, setPickerModalVisible] = useState(false);
  const [isAddingItems, setIsAddingItems] = useState(false);

  const transientNotice = useFoodListNotice();

  const listQuery = useQuery<FoodListDetailDTO>({
    queryKey: ['food-list-detail', foodListId],
    queryFn: () =>
      apiRequest<FoodListDetailDTO>(
        'GET',
        `/food-lists/${encodeURIComponent(foodListId)}`,
      ),
  });

  // Restaurant search for Entry Point 2
  //
  // `GET /catalog` validates its query params with a `.strict()` Zod schema
  // that only recognizes `parkId`, `category`/`categories`, `areaType`, `q`,
  // `land`, and `worldShowcaseCountry` (apps/api/src/services/catalog/routes.ts).
  // `search` and `limit` are NOT recognized keys, so sending them caused every
  // request here to be rejected with `400 validation_failed` — silently, since
  // this query only branches on `isLoading` and falls through to an empty
  // `experiences` array on error, rendering "No restaurants found" instead of
  // surfacing the failure. Use `category` + `q`, mirroring the already-correct
  // usage in `ExperiencePicker.tsx`.
  const restaurantSearchQuery = useQuery<CatalogSearchResponse, ApiError>({
    queryKey: ['restaurant-catalog-search', restaurantSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        category: 'Restaurant',
      });
      if (restaurantSearch.trim()) {
        params.set('q', restaurantSearch.trim());
      }
      return apiRequest<CatalogSearchResponse>('GET', `/catalog?${params.toString()}`);
    },
    enabled: restaurantSearchModalVisible,
  });

  const list = listQuery.data;

  // Requirement 11.2: attribution label shown ONLY when list has 2+ distinct contributors
  const showAttribution = useMemo(() => {
    if (!list || !list.items) return false;
    const contributorIds = new Set(
      list.items.map((i) => i.addedByUserId).filter((id): id is string => Boolean(id)),
    );
    return contributorIds.size >= 2;
  }, [list]);

  // Actions
  async function handleToggleLike(): Promise<void> {
    if (!list || isLiking) return;
    setIsLiking(true);
    try {
      if (list.liked) {
        await apiRequest('DELETE', `/food-lists/${encodeURIComponent(foodListId)}/like`);
      } else {
        await apiRequest('POST', `/food-lists/${encodeURIComponent(foodListId)}/like`);
      }
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
    } catch {
      // Ignore
    } finally {
      setIsLiking(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!list || isSaving || list.myRole === 'owner') return;
    setIsSaving(true);
    try {
      await apiRequest('POST', `/food-lists/${encodeURIComponent(foodListId)}/save`);
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
    } catch {
      // Ignore
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteItem(foodItemId: string): Promise<void> {
    try {
      await apiRequest(
        'DELETE',
        `/me/food-lists/${encodeURIComponent(foodListId)}/items/${encodeURIComponent(foodItemId)}`,
      );
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
    } catch {
      // Ignore
    }
  }

  // Task 8.15: Submit expectedVersion on reorder; handle food_list_stale_write (Requirement 11.3)
  async function handleReorderItems(newItems: readonly FoodListItemDTO[]): Promise<void> {
    if (!list) return;
    setStaleWriteNotice(null);

    const foodItemIds = newItems.map((i) => i.foodItemId);
    try {
      await apiRequest(
        'PUT',
        `/me/food-lists/${encodeURIComponent(foodListId)}/items/order`,
        {
          foodItemIds,
          expectedVersion: list.version,
        },
      );
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'food_list_stale_write') {
        // Refetch and display brief message
        await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
        setStaleWriteNotice('List was updated by another collaborator. Refreshed.');
      }
    }
  }

  function moveItem(index: number, direction: 'up' | 'down'): void {
    if (!list) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.items.length) return;

    const reordered = [...list.items];
    const temp = reordered[index]!;
    reordered[index] = reordered[targetIndex]!;
    reordered[targetIndex] = temp;

    void handleReorderItems(reordered);
  }

  // Entry point 2: Add selected items from picker scoped to restaurant
  async function handleConfirmAddItems(pickedItems: readonly FoodItemDTO[]): Promise<void> {
    if (pickedItems.length === 0 || isAddingItems) return;
    setIsAddingItems(true);
    try {
      for (const item of pickedItems) {
        try {
          await apiRequest(
            'POST',
            `/me/food-lists/${encodeURIComponent(foodListId)}/items`,
            {
              foodItemId: item.id,
            },
          );
        } catch (err) {
          // Swallow duplicate per Requirement 9.4
          if (err instanceof ApiError && err.code === 'food_list_item_duplicate') {
            continue;
          }
        }
      }
      setPickerModalVisible(false);
      setSelectedExperience(null);
      await queryClient.invalidateQueries({ queryKey: ['food-list-detail', foodListId] });
      // Adding items changes this list's itemCount, which the collection
      // card on MyFoodListsScreen also displays — invalidate it too so that
      // screen doesn't keep showing a stale count after navigating back,
      // mirroring the equivalent invalidation already done at the end of
      // AddToListsSheet.tsx's own add/remove flow (Entry Point 1).
      await queryClient.invalidateQueries({ queryKey: ['food-lists-collection'] });
      await queryClient.invalidateQueries({ queryKey: ['my-owned-food-lists'] });
    } finally {
      setIsAddingItems(false);
    }
  }

  // Loading state
  if (listQuery.isLoading) {
    return (
      <ScreenContainer style={styles.centerContainer}>
        <ActivityIndicator color={theme.color.primary} size="large" />
      </ScreenContainer>
    );
  }

  // Requirement 10.2 / Task 8.13: Unavailable state
  if (listQuery.isError || !list) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Food List"
          compact
          onBack={() => navigation.goBack()}
        />
        <View style={styles.unavailableWrap} testID="food-list-unavailable-notice">
          <Ionicons name="alert-circle-outline" size={48} color={theme.color.danger} />
          <Text style={styles.unavailableTitle}>No longer available</Text>
          <Text style={styles.unavailableBody}>
            {transientNotice ?? 'This food list does not exist or is no longer shared with you.'}
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            testID="food-list-unavailable-back-btn"
          >
            <Text style={styles.backBtnText}>Return to previous screen</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const canEdit = list.myRole === 'owner' || list.myRole === 'editor';
  const isOwner = list.myRole === 'owner';

  return (
    <ScreenContainer>
      <View style={{ flex: 1 }} testID="food-list-detail-screen">
        <GradientHeader
        title={list.name}
        subtitle={`by ${list.ownerDisplayName}`}
        compact
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Stale write message (Requirement 11.3) */}
        {staleWriteNotice ? (
          <View style={styles.staleNotice} testID="food-list-stale-write-message">
            <Ionicons name="information-circle" size={18} color={theme.color.primary} />
            <Text style={styles.staleNoticeText}>{staleWriteNotice}</Text>
          </View>
        ) : null}

        {/* List Header Card */}
        <Card style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View style={styles.titleArea}>
              <Text style={styles.listName} testID="food-list-name">{list.name}</Text>
              <Text style={styles.metaText}>
                Created by {list.ownerDisplayName} • {list.visibility === 'public' ? 'Public' : 'Private'}
              </Text>
            </View>

            {/* Badges */}
            <View style={styles.roleBadgeContainer}>
              <Badge
                label={list.myRole === 'owner' ? 'Owner' : list.myRole === 'editor' ? 'Editor' : 'Viewer'}
                color={list.myRole === 'editor' ? theme.color.primary : theme.color.textSecondary}
              />
            </View>
          </View>

          {/* Action Row */}
          <View style={styles.actionRow}>
            {/* Like button */}
            <Pressable
              onPress={() => void handleToggleLike()}
              disabled={isLiking}
              style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
              accessibilityRole="button"
              accessibilityLabel={`${list.liked ? 'Unlike' : 'Like'} list, ${list.likeCount} likes`}
              testID="food-list-like-btn"
            >
              <Ionicons
                name={list.liked ? 'heart' : 'heart-outline'}
                size={20}
                color={list.liked ? theme.color.danger : theme.color.textSecondary}
              />
              <Text style={styles.actionButtonText}>{list.likeCount}</Text>
            </Pressable>

            {/* Save button (non-owners only) */}
            {!isOwner ? (
              <Pressable
                onPress={() => void handleSave()}
                disabled={isSaving || list.saved}
                style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
                accessibilityRole="button"
                accessibilityLabel={list.saved ? 'List saved' : 'Save list'}
                testID="food-list-save-btn"
              >
                <Ionicons
                  name={list.saved ? 'bookmark' : 'bookmark-outline'}
                  size={20}
                  color={list.saved ? theme.color.primary : theme.color.textSecondary}
                />
                <Text style={styles.actionButtonText}>
                  {list.saved ? 'Saved' : 'Save'}
                </Text>
              </Pressable>
            ) : null}

            {/* Manage sharing button (owner of private list only, Requirement 9.8) */}
            {isOwner && list.visibility === 'private' ? (
              <Pressable
                onPress={() => setManageSharesVisible(true)}
                style={styles.actionButton}
                accessibilityRole="button"
                accessibilityLabel="Manage sharing"
                testID="food-list-manage-sharing-btn"
              >
                <Ionicons name="people-outline" size={20} color={theme.color.primary} />
                <Text style={styles.actionButtonText}>Share</Text>
              </Pressable>
            ) : null}

            {/* Add items button (owner or editor, Requirement 9.5 / 11.1) */}
            {canEdit ? (
              <Pressable
                onPress={() => setRestaurantSearchModalVisible(true)}
                style={[styles.actionButton, styles.addItemsBtn]}
                accessibilityRole="button"
                accessibilityLabel="Add items to this list"
                testID="food-list-add-items-btn"
              >
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={styles.addItemsBtnText}>Add items</Text>
              </Pressable>
            ) : null}
          </View>
        </Card>

        {/* Section Header */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            Dishes ({list.items.length})
          </Text>
        </View>

        {/* Items List */}
        {list.items.length === 0 ? (
          <View style={styles.emptyItemsWrap}>
            <Ionicons name="restaurant-outline" size={40} color={theme.color.textSecondary} />
            <Text style={styles.emptyItemsText}>No dishes in this list yet.</Text>
            {canEdit ? (
              <Pressable
                onPress={() => setRestaurantSearchModalVisible(true)}
                style={styles.emptyAddBtn}
              >
                <Text style={styles.emptyAddBtnText}>Add your first dish</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          list.items.map((item, index) => {
            const placeName = item.experienceName ?? item.locationName ?? 'Walt Disney World';
            return (
              <Card
                key={item.foodItemId}
                style={styles.itemCard}
                testID={`food-list-item-row-${item.foodItemId}`}
              >
                <View style={styles.itemCardMain}>
                  <View style={styles.itemDetails}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.itemLocation}>{placeName}</Text>
                    {item.price ? (
                      <Text style={styles.itemPrice}>{item.price}</Text>
                    ) : null}

                    {/* Attribution label (Requirement 11.2) */}
                    {showAttribution && item.addedByDisplayName ? (
                      <Text
                        style={styles.attributionLabel}
                        testID={`food-list-attribution-${item.foodItemId}`}
                      >
                        added by {item.addedByDisplayName}
                      </Text>
                    ) : null}
                  </View>

                  {/* Actions for editor/owner (Requirement 11.1) */}
                  {canEdit ? (
                    <View style={styles.itemControls}>
                      {/* Move controls */}
                      <View style={styles.moveButtons}>
                        <Pressable
                          onPress={() => moveItem(index, 'up')}
                          disabled={index === 0}
                          style={[styles.moveBtn, index === 0 && styles.moveBtnDisabled]}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${item.name} up`}
                          testID={`food-list-item-move-up-${item.foodItemId}`}
                        >
                          <Ionicons
                            name="chevron-up"
                            size={18}
                            color={index === 0 ? theme.color.border : theme.color.textSecondary}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => moveItem(index, 'down')}
                          disabled={index === list.items.length - 1}
                          style={[styles.moveBtn, index === list.items.length - 1 && styles.moveBtnDisabled]}
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${item.name} down`}
                          testID={`food-list-item-move-down-${item.foodItemId}`}
                        >
                          <Ionicons
                            name="chevron-down"
                            size={18}
                            color={index === list.items.length - 1 ? theme.color.border : theme.color.textSecondary}
                          />
                        </Pressable>
                      </View>

                      {/* Delete action */}
                      <Pressable
                        onPress={() => void handleDeleteItem(item.foodItemId)}
                        style={styles.itemDeleteBtn}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name} from list`}
                        testID={`food-list-item-delete-${item.foodItemId}`}
                      >
                        <Ionicons name="trash-outline" size={18} color={theme.color.danger} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* Manage Sharing Sheet */}
      <ManageFoodListSharesSheet
        foodListId={foodListId}
        visible={manageSharesVisible}
        onClose={() => setManageSharesVisible(false)}
      />

      {/* Entry Point 2: Restaurant Search Modal */}
      <Modal
        visible={restaurantSearchModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setRestaurantSearchModalVisible(false)}
        testID="restaurant-search-modal"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose a Restaurant</Text>
              <Pressable
                onPress={() => setRestaurantSearchModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close restaurant search"
                testID="close-restaurant-search-btn"
              >
                <Ionicons name="close" size={24} color={theme.color.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.searchSection}>
              <Ionicons name="search" size={18} color={theme.color.textSecondary} />
              <TextInput
                value={restaurantSearch}
                onChangeText={setRestaurantSearch}
                placeholder="Search restaurants..."
                placeholderTextColor={theme.color.textSecondary}
                style={styles.searchInput}
                autoCorrect={false}
                testID="restaurant-search-input"
              />
            </View>

            {restaurantSearchQuery.isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={theme.color.primary} testID="restaurant-search-loading" />
              </View>
            ) : restaurantSearchQuery.isError ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyWrapText} testID="restaurant-search-error">
                  Could not load restaurants. Please try again.
                </Text>
              </View>
            ) : (
              <FlatList
                data={restaurantSearchQuery.data?.experiences ?? []}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => {
                      setSelectedExperience(item);
                      setRestaurantSearchModalVisible(false);
                      setPickerModalVisible(true);
                    }}
                    style={({ pressed }) => [styles.restaurantRow, pressed && styles.restaurantRowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Select restaurant ${item.name}`}
                    testID={`restaurant-select-row-${item.id}`}
                  >
                    <Ionicons name="restaurant" size={20} color={theme.color.primary} />
                    <View style={styles.restaurantRowText}>
                      <Text style={styles.restaurantRowName}>{item.name}</Text>
                      <Text style={styles.restaurantRowMeta}>{item.park}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.color.textSecondary} />
                  </Pressable>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyWrapText}>No restaurants found.</Text>
                  </View>
                }
                contentContainerStyle={styles.restaurantListContent}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Entry Point 2: FoodItemPickerModal scoped to selected restaurant */}
      {selectedExperience ? (
        <FoodItemPickerModal
          experienceId={selectedExperience.id}
          mode="addToLists"
          visible={pickerModalVisible}
          onClose={() => {
            setPickerModalVisible(false);
            setSelectedExperience(null);
          }}
          onConfirmSelection={(items) => void handleConfirmAddItems(items)}
        />
      ) : null}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: theme.spacing.md,
    gap: 12,
  },
  unavailableWrap: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 40,
  },
  unavailableTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  unavailableBody: {
    fontSize: 15,
    color: theme.color.textSecondary,
    textAlign: 'center',
  },
  backBtn: {
    marginTop: 12,
    backgroundColor: theme.color.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
  },
  backBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  staleNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(107, 70, 193, 0.1)',
    padding: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.primary,
  },
  staleNoticeText: {
    fontSize: 13,
    color: theme.color.primary,
    fontWeight: '500',
    flex: 1,
  },
  headerCard: {
    padding: theme.spacing.md,
    gap: 12,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleArea: {
    flex: 1,
    marginRight: 8,
  },
  listName: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  metaText: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 4,
  },
  roleBadgeContainer: {
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceAlt,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  addItemsBtn: {
    backgroundColor: theme.color.primary,
    marginLeft: 'auto',
  },
  addItemsBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  sectionHeaderRow: {
    marginTop: 8,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  emptyItemsWrap: {
    padding: 36,
    alignItems: 'center',
    gap: 8,
  },
  emptyItemsText: {
    fontSize: 15,
    color: theme.color.textSecondary,
  },
  emptyAddBtn: {
    marginTop: 8,
    backgroundColor: theme.color.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
  },
  emptyAddBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  itemCard: {
    padding: 12,
  },
  itemCardMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemDetails: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  itemLocation: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 11,
    fontWeight: '500',
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  attributionLabel: {
    fontSize: 11,
    color: theme.color.primary,
    fontWeight: '500',
    marginTop: 4,
  },
  itemControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  moveButtons: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  moveBtn: {
    padding: 2,
  },
  moveBtnDisabled: {
    opacity: 0.3,
  },
  itemDeleteBtn: {
    padding: 6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    maxHeight: '80%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  searchSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: theme.spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.color.background,
    borderRadius: theme.radius.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: theme.color.textPrimary,
  },
  loadingWrap: {
    padding: 32,
    alignItems: 'center',
  },
  restaurantListContent: {
    paddingVertical: 8,
  },
  restaurantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  restaurantRowPressed: {
    backgroundColor: theme.color.surfaceAlt,
  },
  restaurantRowText: {
    flex: 1,
  },
  restaurantRowName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  restaurantRowMeta: {
    fontSize: 11,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  emptyWrap: {
    padding: 24,
    alignItems: 'center',
  },
  emptyWrapText: {
    color: theme.color.textSecondary,
    fontSize: 13,
  },
});
