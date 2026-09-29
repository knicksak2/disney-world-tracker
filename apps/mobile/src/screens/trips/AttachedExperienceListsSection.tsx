// Feature: experience-lists, Task 19.1 — Mobile "Attached Experience Lists" UI on Trip Detail hub
//
// Validates: Requirements 14.1, 14.4, 14.8
//
// Behavior summary:
//   - Renders each `TripExperienceListDTO` attached to the Trip (R14.1, R14.8).
//   - Available entries show list name, item count, and owner display name,
//     with a tap-through to `ExperienceListDetailScreen` (R14.8).
//   - Unavailable entries (`available: false`) render with the greyed "No longer available"
//     treatment mirroring Requirement 7a from `food-lists` (R14.8).
//   - An "Attach a list" control (available to any Trip_Member) opens an attach modal
//     sourced from the user's owned lists (`GET /me/experience-lists`) and public discovery
//     lists (`GET /experience-lists/discover`), excluding lists already attached (R14.1).
//   - A detach control is gated client-side to the list's adder or any Trip Organizer
//     (server remains the authority, R14.4).
//
// Structural mirror of `AttachedFoodListsSection.tsx` — see that file for the food-list
// equivalent of every behavior here.

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
  ExperienceListDTO,
  ExperienceListDiscoveryPageDTO,
  TripExperienceListDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge, Card, PrimaryButton } from '../../theme/components';
import { tripDetailKeys } from './tripDetailQueryKeys';

// ---------------------------------------------------------------------------
// Props & Types
// ---------------------------------------------------------------------------

export interface AttachedExperienceListsSectionProps {
  readonly tripId: string;
  readonly experienceLists: readonly TripExperienceListDTO[];
  readonly isOrganizer: boolean;
  readonly callerId?: string | undefined;
  readonly callerDisplayName?: string | undefined;
  readonly navigation?: any;
  readonly onOpenExperienceList?: ((experienceListId: string) => void) | undefined;
  /** Force-allow detach buttons for testing forbidden third-party server responses */
  readonly allowAllDetachForTesting?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AttachedExperienceListsSection({
  tripId,
  experienceLists,
  isOrganizer,
  callerId: _callerId,
  callerDisplayName,
  navigation,
  onOpenExperienceList,
  allowAllDetachForTesting = false,
}: AttachedExperienceListsSectionProps): JSX.Element {
  const queryClient = useQueryClient();

  const [attachModalVisible, setAttachModalVisible] = useState(false);
  const [modalTab, setModalTab] = useState<'owned' | 'discover'>('owned');
  const [isAttaching, setIsAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [detachError, setDetachError] = useState<string | null>(null);
  const [locallyAttachedIds, setLocallyAttachedIds] = useState<Set<string>>(
    new Set(),
  );

  // Query owned experience lists (`GET /me/experience-lists`)
  const ownedListsQuery = useQuery<readonly ExperienceListDTO[], ApiError>({
    queryKey: ['my-owned-experience-lists'],
    queryFn: () =>
      apiRequest<readonly ExperienceListDTO[]>('GET', '/me/experience-lists'),
    enabled: attachModalVisible,
  });

  // Query public discoverable experience lists (`GET /experience-lists/discover?sort=popular`)
  const discoverListsQuery = useQuery<ExperienceListDiscoveryPageDTO, ApiError>({
    queryKey: ['experience-lists-discover', 'popular'],
    queryFn: () =>
      apiRequest<ExperienceListDiscoveryPageDTO>(
        'GET',
        '/experience-lists/discover?sort=popular',
      ),
    enabled: attachModalVisible && modalTab === 'discover',
  });

  // Set of experienceListIds currently attached to this Trip
  const attachedIds = useMemo(
    () => new Set(experienceLists.map((e) => e.experienceListId)),
    [experienceLists],
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
  function canCallerDetach(item: TripExperienceListDTO): boolean {
    if (allowAllDetachForTesting) return true;
    if (isOrganizer) return true;
    if (locallyAttachedIds.has(item.experienceListId)) return true;
    if (ownedListIds.has(item.experienceListId)) return true;
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

  // Handle opening an Experience_List detail screen
  function handleOpenList(experienceListId: string) {
    if (onOpenExperienceList) {
      onOpenExperienceList(experienceListId);
    } else {
      navigation.navigate('ExperienceListDetail', { experienceListId });
    }
  }

  // Handle attaching a list to this Trip (R14.1)
  async function handleAttach(experienceListId: string) {
    if (isAttaching) return;
    setIsAttaching(true);
    setAttachError(null);
    try {
      await apiRequest('POST', `/trips/${tripId}/experience-lists`, {
        experienceListId,
      });
      setLocallyAttachedIds((prev) => new Set(prev).add(experienceListId));
      await queryClient.invalidateQueries({
        queryKey: tripDetailKeys.detail(tripId),
      });
      setAttachModalVisible(false);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.code === 'trip_experience_list_ineligible') {
        setAttachError(
          'Only experience lists you own or public lists can be attached to a trip.',
        );
      } else if (apiErr?.code === 'experience_list_not_found') {
        setAttachError('This experience list could not be found.');
      } else if (apiErr?.code === 'trip_forbidden') {
        setAttachError('You must be a trip member to attach an experience list.');
      } else {
        setAttachError(
          'We had trouble attaching this experience list. Please try again.',
        );
      }
    } finally {
      setIsAttaching(false);
    }
  }

  // Handle detaching a list from this Trip (R14.4)
  async function handleDetach(experienceListId: string) {
    setDetachError(null);
    try {
      await apiRequest(
        'DELETE',
        `/trips/${tripId}/experience-lists/${encodeURIComponent(experienceListId)}`,
      );
      setLocallyAttachedIds((prev) => {
        const next = new Set(prev);
        next.delete(experienceListId);
        return next;
      });
      await queryClient.invalidateQueries({
        queryKey: tripDetailKeys.detail(tripId),
      });
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.code === 'trip_forbidden') {
        const msg = 'Only the person who attached this experience list or a trip organizer can detach it.';
        setDetachError(msg);
        Alert.alert('Cannot Detach', msg);
      } else if (apiErr?.code === 'experience_list_not_found') {
        const msg = 'This experience list was not found on the trip.';
        setDetachError(msg);
        Alert.alert('Cannot Detach', msg);
      } else {
        const msg = 'We had trouble detaching this experience list. Please try again.';
        setDetachError(msg);
        Alert.alert('Error', msg);
      }
    }
  }

  const promptDetach = (experienceListId: string, listName: string) => {
    Alert.alert(
      `Detach '${listName}'?`,
      `Detach '${listName}' from this trip? (The experience list will remain saved in your profile).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Detach',
          style: 'destructive',
          onPress: () => {
            void handleDetach(experienceListId);
          },
        },
      ],
    );
  };

  return (
    <View style={styles.sectionContainer} testID="trip-detail-experience-lists-section">
      {/* Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <Ionicons
            name="list-outline"
            size={18}
            color={theme.color.primary}
          />
          <Text style={styles.sectionTitle}>Attached Experience Lists</Text>
          {experienceLists.length > 0 ? (
            <Badge
              label={String(experienceLists.length)}
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
          accessibilityLabel="Attach an experience list"
          testID="trip-detail-attach-experience-list-btn"
        >
          <Ionicons name="add" size={16} color="#ffffff" />
          <Text style={styles.attachControlBtnText}>Attach</Text>
        </Pressable>
      </View>

      {/* Detach error notice if any */}
      {detachError ? (
        <View style={styles.errorNotice} testID="trip-detail-detach-experience-list-error">
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={theme.color.danger}
          />
          <Text style={styles.errorNoticeText}>{detachError}</Text>
        </View>
      ) : null}

      {/* List content */}
      {experienceLists.length === 0 ? (
        <View style={styles.emptyContainer} testID="attached-experience-lists-empty">
          <Text style={styles.emptyText}>No experience lists attached yet.</Text>
          <Text style={styles.emptySubtext}>
            Attach a list to browse rides and shows together with your trip party.
          </Text>
        </View>
      ) : (
        <View style={styles.experienceListItems}>
          {experienceLists.map((item) => {
            const canDetach = canCallerDetach(item);

            // Requirement 14.8: unavailable treatment mirroring food-lists Requirement 7a
            if (!item.available) {
              return (
                <View
                  key={item.experienceListId}
                  style={styles.unavailableRow}
                  testID={`attached-experience-list-unavailable-${item.experienceListId}`}
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
                      onPress={() => void handleDetach(item.experienceListId)}
                      accessibilityRole="button"
                      accessibilityLabel="Detach unavailable experience list"
                      style={styles.detachBtn}
                      testID={`detach-experience-list-btn-${item.experienceListId}`}
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
                key={item.experienceListId}
                style={styles.experienceListCard}
                onPress={() => handleOpenList(item.experienceListId)}
                accessibilityRole="button"
                accessibilityLabel={`Open experience list ${item.name}`}
                testID={`attached-experience-list-${item.experienceListId}`}
              >
                <View style={styles.experienceListRow}>
                  <View style={styles.experienceListLeft}>
                    <View style={styles.experienceListIconWrap}>
                      <Ionicons
                        name="star-outline"
                        size={20}
                        color={theme.color.primary}
                      />
                    </View>
                    <View style={styles.experienceListTextWrap}>
                      <Text style={styles.experienceListName}>{item.name}</Text>
                      <Text style={styles.experienceListMeta}>
                        by {item.ownerDisplayName} &bull; {item.itemCount}{' '}
                        {item.itemCount === 1 ? 'item' : 'items'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.experienceListRight}>
                    {canDetach ? (
                      <Pressable
                        onPress={() => promptDetach(item.experienceListId, item.name)}
                        accessibilityRole="button"
                        accessibilityLabel={`Detach ${item.name}`}
                        style={styles.detachBtn}
                        hitSlop={8}
                        testID={`detach-experience-list-btn-${item.experienceListId}`}
                      >
                        <Ionicons
                          name="ellipsis-horizontal"
                          size={18}
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

      {/* Attach Experience List Modal */}
      <Modal
        visible={attachModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAttachModalVisible(false)}
        testID="attach-experience-list-modal"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Attach an Experience List</Text>
              <Pressable
                onPress={() => setAttachModalVisible(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close attach experience list modal"
                testID="attach-experience-list-close-btn"
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
                testID="attach-experience-list-error"
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
                testID="attach-experience-list-tab-my"
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
                testID="attach-experience-list-tab-discover"
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
                    name="list-outline"
                    size={36}
                    color={theme.color.textSecondary}
                  />
                  <Text
                    style={styles.modalEmptyText}
                    testID="attach-experience-list-no-owned"
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
                      testID={`selectable-experience-list-${list.id}`}
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
                          testID={`attach-experience-list-action-${list.id}`}
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
                  testID="attach-experience-list-no-discover"
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
                    testID={`selectable-experience-list-${list.id}`}
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
                        testID={`attach-experience-list-action-${list.id}`}
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
  experienceListItems: {
    gap: theme.spacing.xs,
  },
  experienceListCard: {
    padding: theme.spacing.md,
    marginBottom: 0,
  },
  experienceListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  experienceListLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    flex: 1,
  },
  experienceListIconWrap: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${theme.color.primary}18`,
  },
  experienceListTextWrap: {
    flex: 1,
    gap: 2,
  },
  experienceListName: {
    ...theme.typography.body,
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  experienceListMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  experienceListRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  detachBtn: {
    padding: 6,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
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
