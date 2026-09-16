// Feature: trips, Task 24.6 — Mobile "Attached Food Lists" UI on Trip Detail hub
//
// Validates: Requirements 22.1, 22.5, 22.9, 22.10
//
// Behavior summary:
//   - Renders each `TripFoodListDTO` attached to the Trip (R22.9, R22.10).
//   - Available entries show list name, item count, and owner display name,
//     with a tap-through to `FoodListDetailScreen` (R22.10).
//   - Unavailable entries (`available: false`) render with the greyed "No longer available"
//     treatment mirroring Requirement 7a from `food-lists` (R22.10).
//   - An "Attach a list" control (available to any Trip_Member) opens an attach modal
//     sourced from the user's owned lists (`GET /me/food-lists`) and public discovery
//     lists (`GET /food-lists/discover`), excluding lists already attached (R22.1).
//   - A detach control is gated client-side to the list's adder or any Trip Organizer
//     (server remains the authority, R22.5).

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FoodListDTO,
  FoodListDiscoveryPageDTO,
  TripFoodListDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge, Card, PrimaryButton } from '../../theme/components';
import { tripDetailKeys } from './tripDetailQueryKeys';

// ---------------------------------------------------------------------------
// Props & Types
// ---------------------------------------------------------------------------

export interface AttachedFoodListsSectionProps {
  readonly tripId: string;
  readonly foodLists: readonly TripFoodListDTO[];
  readonly isOrganizer: boolean;
  readonly callerId?: string | undefined;
  readonly callerDisplayName?: string | undefined;
  readonly navigation?: any;
  readonly onOpenFoodList?: ((foodListId: string) => void) | undefined;
  /** Force-allow detach buttons for testing forbidden third-party server responses */
  readonly allowAllDetachForTesting?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AttachedFoodListsSection({
  tripId,
  foodLists,
  isOrganizer,
  callerId: _callerId,
  callerDisplayName,
  navigation,
  onOpenFoodList,
  allowAllDetachForTesting = false,
}: AttachedFoodListsSectionProps): JSX.Element {
  const queryClient = useQueryClient();

  const [attachModalVisible, setAttachModalVisible] = useState(false);
  const [modalTab, setModalTab] = useState<'owned' | 'discover'>('owned');
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [detachError, setDetachError] = useState<string | null>(null);
  const [locallyAttachedIds, setLocallyAttachedIds] = useState<Set<string>>(
    new Set(),
  );

  // Query owned food lists (`GET /me/food-lists`)
  const ownedListsQuery = useQuery<readonly FoodListDTO[], ApiError>({
    queryKey: ['my-owned-food-lists'],
    queryFn: () => apiRequest<readonly FoodListDTO[]>('GET', '/me/food-lists'),
    enabled: attachModalVisible,
  });

  // Query public discoverable food lists (`GET /food-lists/discover?sort=popular`)
  const discoverListsQuery = useQuery<FoodListDiscoveryPageDTO, ApiError>({
    queryKey: ['food-lists-discover', 'popular'],
    queryFn: () =>
      apiRequest<FoodListDiscoveryPageDTO>(
        'GET',
        '/food-lists/discover?sort=popular',
      ),
    enabled: attachModalVisible && modalTab === 'discover',
  });

  // Set of foodListIds currently attached to this Trip
  const attachedIds = useMemo(
    () => new Set(foodLists.map((f) => f.foodListId)),
    [foodLists],
  );

  // Set of owned list IDs for caller adder-check
  const ownedListIds = useMemo(() => {
    const lists = Array.isArray(ownedListsQuery.data)
      ? ownedListsQuery.data
      : [];
    return new Set(lists.map((l) => l.id));
  }, [ownedListsQuery.data]);

  // Candidates for attach modal (filtered to exclude already attached lists)
  const selectableOwnedLists = useMemo(() => {
    const lists = Array.isArray(ownedListsQuery.data)
      ? ownedListsQuery.data
      : [];
    return lists.filter((l) => !attachedIds.has(l.id));
  }, [ownedListsQuery.data, attachedIds]);

  const selectableDiscoverLists = useMemo(() => {
    const items = discoverListsQuery.data?.items ?? [];
    return items.filter((l) => !attachedIds.has(l.id));
  }, [discoverListsQuery.data, attachedIds]);

  // Determine if caller can detach a given attached list
  function canCallerDetach(item: TripFoodListDTO): boolean {
    if (allowAllDetachForTesting) return true;
    if (isOrganizer) return true;
    if (locallyAttachedIds.has(item.foodListId)) return true;
    if (ownedListIds.has(item.foodListId)) return true;
    if (
      item.available &&
      callerDisplayName !== undefined &&
      item.ownerDisplayName.trim().toLowerCase() ===
        callerDisplayName.trim().toLowerCase()
    ) {
      return true;
    }
    return false;
  }

  // Handle opening a Food_List detail screen
  function handleOpenList(foodListId: string) {
    if (onOpenFoodList) {
      onOpenFoodList(foodListId);
    } else {
      navigation.navigate('FoodListDetail', { foodListId });
    }
  }

  // Handle attaching a list to this Trip (R22.1)
  async function handleAttach(foodListId: string) {
    if (isAttaching) return;
    setIsAttaching(true);
    setAttachError(null);
    try {
      await apiRequest('POST', `/trips/${tripId}/food-lists`, {
        foodListId,
      });
      setLocallyAttachedIds((prev) => new Set(prev).add(foodListId));
      await queryClient.invalidateQueries({
        queryKey: tripDetailKeys.detail(tripId),
      });
      setAttachModalVisible(false);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.code === 'trip_food_list_ineligible') {
        setAttachError(
          'Only food lists you own or public lists can be attached to a trip.',
        );
      } else if (apiErr?.code === 'trip_food_list_not_found') {
        setAttachError('This food list could not be found.');
      } else if (apiErr?.code === 'trip_forbidden') {
        setAttachError('You must be a trip member to attach a food list.');
      } else {
        setAttachError(
          'We had trouble attaching this food list. Please try again.',
        );
      }
    } finally {
      setIsAttaching(false);
    }
  }

  // Handle detaching a list from this Trip (R22.5)
  async function handleDetach(foodListId: string) {
    setDetachError(null);
    try {
      await apiRequest(
        'DELETE',
        `/trips/${tripId}/food-lists/${encodeURIComponent(foodListId)}`,
      );
      setLocallyAttachedIds((prev) => {
        const next = new Set(prev);
        next.delete(foodListId);
        return next;
      });
      await queryClient.invalidateQueries({
        queryKey: tripDetailKeys.detail(tripId),
      });
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.code === 'trip_forbidden') {
        const msg = 'Only the person who attached this food list or a trip organizer can detach it.';
        setDetachError(msg);
        Alert.alert('Cannot Detach', msg);
      } else if (apiErr?.code === 'trip_food_list_not_found') {
        const msg = 'This food list was not found on the trip.';
        setDetachError(msg);
        Alert.alert('Cannot Detach', msg);
      } else {
        const msg = 'We had trouble detaching this food list. Please try again.';
        setDetachError(msg);
        Alert.alert('Error', msg);
      }
    }
  }

  return (
    <View style={styles.sectionContainer} testID="trip-detail-food-lists-section">
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Ionicons
            name="restaurant-outline"
            size={18}
            color={theme.color.primary}
          />
          <Text style={styles.sectionTitle}>Attached Food Lists</Text>
          {foodLists.length > 0 ? (
            <Badge
              label={String(foodLists.length)}
              color={theme.color.primary}
            />
          ) : null}
        </View>
        <Pressable
          onPress={() => {
            setAttachError(null);
            setAttachModalVisible(true);
          }}
          style={styles.attachControlBtn}
          accessibilityRole="button"
          accessibilityLabel="Attach a food list"
          testID="trip-detail-attach-food-list-btn"
        >
          <Ionicons name="add" size={16} color="#ffffff" />
          <Text style={styles.attachControlBtnText}>Attach</Text>
        </Pressable>
      </View>

      {/* Detach error notice if any */}
      {detachError ? (
        <View style={styles.errorNotice} testID="trip-detail-detach-error">
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={theme.color.danger}
          />
          <Text style={styles.errorNoticeText}>{detachError}</Text>
        </View>
      ) : null}

      {/* List content */}
      {foodLists.length === 0 ? (
        <View style={styles.emptyContainer} testID="attached-food-lists-empty">
          <Text style={styles.emptyText}>No food lists attached yet.</Text>
          <Text style={styles.emptySubtext}>
            Attach a list to browse dishes together with your trip party.
          </Text>
        </View>
      ) : (
        <View style={styles.foodListItems}>
          {foodLists.map((item) => {
            const canDetach = canCallerDetach(item);

            // Requirement 22.10: unavailable treatment mirroring food-lists Requirement 7a
            if (!item.available) {
              return (
                <View
                  key={item.foodListId}
                  style={styles.unavailableRow}
                  testID={`attached-food-list-unavailable-${item.foodListId}`}
                >
                  <View style={styles.unavailableLeft}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={18}
                      color={theme.color.textSecondary}
                    />
                    <Text style={styles.unavailableRowText}>
                      No longer available
                    </Text>
                  </View>
                  {canDetach ? (
                    <Pressable
                      onPress={() => void handleDetach(item.foodListId)}
                      accessibilityRole="button"
                      accessibilityLabel="Detach unavailable food list"
                      style={styles.detachBtn}
                      testID={`detach-food-list-btn-${item.foodListId}`}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color={theme.color.textSecondary}
                      />
                    </Pressable>
                  ) : null}
                </View>
              );
            }

            // Available list item
            return (
              <Card
                key={item.foodListId}
                style={styles.foodListCard}
                onPress={() => handleOpenList(item.foodListId)}
                accessibilityRole="button"
                accessibilityLabel={`Open food list ${item.name}`}
                testID={`attached-food-list-${item.foodListId}`}
              >
                <View style={styles.foodListRow}>
                  <View style={styles.foodListLeft}>
                    <View style={styles.foodListIconWrap}>
                      <Ionicons
                        name="fast-food-outline"
                        size={20}
                        color={theme.color.primary}
                      />
                    </View>
                    <View style={styles.foodListTextWrap}>
                      <Text style={styles.foodListName}>{item.name}</Text>
                      <Text style={styles.foodListMeta}>
                        by {item.ownerDisplayName} &bull; {item.itemCount}{' '}
                        {item.itemCount === 1 ? 'item' : 'items'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.foodListRight}>
                    {canDetach ? (
                      <Pressable
                        onPress={() => void handleDetach(item.foodListId)}
                        accessibilityRole="button"
                        accessibilityLabel={`Detach ${item.name}`}
                        style={styles.detachBtn}
                        hitSlop={8}
                        testID={`detach-food-list-btn-${item.foodListId}`}
                      >
                        <Ionicons
                          name="close-circle-outline"
                          size={20}
                          color={theme.color.textSecondary}
                        />
                      </Pressable>
                    ) : null}
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={theme.color.textSecondary}
                    />
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* Attach Food List Modal */}
      <Modal
        visible={attachModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachModalVisible(false)}
        testID="attach-food-list-modal"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Attach a Food List</Text>
              <Pressable
                onPress={() => setAttachModalVisible(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close attach food list modal"
                testID="attach-food-list-close-btn"
              >
                <Ionicons
                  name="close"
                  size={24}
                  color={theme.color.textPrimary}
                />
              </Pressable>
            </View>

            {/* Error Banner */}
            {attachError ? (
              <View
                style={styles.modalErrorBanner}
                testID="attach-food-list-error"
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={16}
                  color={theme.color.danger}
                />
                <Text style={styles.modalErrorText}>{attachError}</Text>
              </View>
            ) : null}

            {/* Tabs: My Lists vs Discover */}
            <View style={styles.modalTabs}>
              <Pressable
                onPress={() => setModalTab('owned')}
                style={[
                  styles.modalTabBtn,
                  modalTab === 'owned' && styles.modalTabBtnActive,
                ]}
                accessibilityRole="tab"
                accessibilityLabel="My Lists tab"
                testID="attach-food-list-tab-my"
              >
                <Text
                  style={[
                    styles.modalTabText,
                    modalTab === 'owned' && styles.modalTabTextActive,
                  ]}
                >
                  My Lists
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setModalTab('discover')}
                style={[
                  styles.modalTabBtn,
                  modalTab === 'discover' && styles.modalTabBtnActive,
                ]}
                accessibilityRole="tab"
                accessibilityLabel="Discover Public Lists tab"
                testID="attach-food-list-tab-discover"
              >
                <Text
                  style={[
                    styles.modalTabText,
                    modalTab === 'discover' && styles.modalTabTextActive,
                  ]}
                >
                  Discover Public
                </Text>
              </Pressable>
            </View>

            {/* Modal Body / Lists */}
            {modalTab === 'owned' ? (
              ownedListsQuery.isLoading ? (
                <View style={styles.modalCenter}>
                  <ActivityIndicator color={theme.color.primary} />
                </View>
              ) : selectableOwnedLists.length === 0 ? (
                <View style={styles.modalEmpty}>
                  <Ionicons
                    name="restaurant-outline"
                    size={36}
                    color={theme.color.textSecondary}
                  />
                  <Text
                    style={styles.modalEmptyText}
                    testID="attach-food-list-no-owned"
                  >
                    No lists available to attach. Create a new list or choose
                    from public lists.
                  </Text>
                </View>
              ) : (
                <View style={styles.modalList}>
                  {selectableOwnedLists.map((list) => (
                    <Card
                      key={list.id}
                      style={styles.modalItemCard}
                      onPress={() => void handleAttach(list.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Attach ${list.name}`}
                      testID={`selectable-food-list-${list.id}`}
                    >
                      <View style={styles.modalItemRow}>
                        <View style={styles.modalItemLeft}>
                          <Text style={styles.modalItemName}>{list.name}</Text>
                          <Text style={styles.modalItemMeta}>
                            {list.itemCount}{' '}
                            {list.itemCount === 1 ? 'item' : 'items'} &bull;{' '}
                            {list.visibility}
                          </Text>
                        </View>
                        <PrimaryButton
                          label="Attach"
                          onPress={() => void handleAttach(list.id)}
                          style={styles.modalAttachItemBtn}
                          disabled={isAttaching}
                          testID={`attach-list-action-${list.id}`}
                        />
                      </View>
                    </Card>
                  ))}
                </View>
              )
            ) : discoverListsQuery.isLoading ? (
              <View style={styles.modalCenter}>
                <ActivityIndicator color={theme.color.primary} />
              </View>
            ) : selectableDiscoverLists.length === 0 ? (
              <View style={styles.modalEmpty}>
                <Ionicons
                  name="globe-outline"
                  size={36}
                  color={theme.color.textSecondary}
                />
                <Text
                  style={styles.modalEmptyText}
                  testID="attach-food-list-no-discover"
                >
                  No public lists available to attach.
                </Text>
              </View>
            ) : (
              <View style={styles.modalList}>
                {selectableDiscoverLists.map((list) => (
                  <Card
                    key={list.id}
                    style={styles.modalItemCard}
                    onPress={() => void handleAttach(list.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Attach ${list.name}`}
                    testID={`selectable-food-list-${list.id}`}
                  >
                    <View style={styles.modalItemRow}>
                      <View style={styles.modalItemLeft}>
                        <Text style={styles.modalItemName}>{list.name}</Text>
                        <Text style={styles.modalItemMeta}>
                          by {list.ownerDisplayName} &bull; {list.itemCount}{' '}
                          {list.itemCount === 1 ? 'item' : 'items'}
                        </Text>
                      </View>
                      <PrimaryButton
                        label="Attach"
                        onPress={() => void handleAttach(list.id)}
                        style={styles.modalAttachItemBtn}
                        disabled={isAttaching}
                        testID={`attach-list-action-${list.id}`}
                      />
                    </View>
                  </Card>
                ))}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
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
    color: theme.color.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  attachControlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
  },
  attachControlBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  errorNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    backgroundColor: `${theme.color.danger}18`,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
  },
  errorNoticeText: {
    ...theme.typography.meta,
    color: theme.color.danger,
    flex: 1,
  },
  emptyContainer: {
    padding: theme.spacing.md,
    backgroundColor: `${theme.color.primary}0a`,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: `${theme.color.primary}18`,
    gap: 4,
  },
  emptyText: {
    ...theme.typography.body,
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  emptySubtext: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  foodListItems: {
    gap: theme.spacing.xs,
  },
  foodListCard: {
    padding: theme.spacing.md,
    marginBottom: 0,
  },
  foodListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  foodListLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    flex: 1,
  },
  foodListIconWrap: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${theme.color.primary}18`,
  },
  foodListTextWrap: {
    flex: 1,
    gap: 2,
  },
  foodListName: {
    ...theme.typography.body,
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  foodListMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  foodListRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  detachBtn: {
    padding: 4,
  },
  unavailableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: theme.spacing.md,
    backgroundColor: '#eee',
    borderRadius: theme.radius.md,
    opacity: 0.75,
  },
  unavailableLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  unavailableRowText: {
    color: theme.color.textSecondary,
    fontSize: 14,
    fontStyle: 'italic',
  },
  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    maxHeight: '80%',
    gap: theme.spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    ...theme.typography.subtitle,
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  modalErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    backgroundColor: `${theme.color.danger}18`,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
  },
  modalErrorText: {
    ...theme.typography.meta,
    color: theme.color.danger,
    flex: 1,
  },
  modalTabs: {
    flexDirection: 'row',
    backgroundColor: theme.color.background,
    borderRadius: theme.radius.md,
    padding: 3,
  },
  modalTabBtn: {
    flex: 1,
    paddingVertical: theme.spacing.xs,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
  },
  modalTabBtnActive: {
    backgroundColor: theme.color.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  modalTabText: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.color.textSecondary,
  },
  modalTabTextActive: {
    color: theme.color.textPrimary,
    fontWeight: '600',
  },
  modalList: {
    gap: theme.spacing.xs,
  },
  modalItemCard: {
    padding: theme.spacing.md,
    marginBottom: 0,
  },
  modalItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  modalItemLeft: {
    flex: 1,
    gap: 2,
  },
  modalItemName: {
    ...theme.typography.body,
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  modalItemMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  modalAttachItemBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    minHeight: 34,
  },
  modalCenter: {
    padding: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalEmpty: {
    padding: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  modalEmptyText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textAlign: 'center',
  },
});
