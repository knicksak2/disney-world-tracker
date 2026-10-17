/**
 * Trip Packing List Screen (Task 11.7).
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import {
  type PackingCategory,
  type PackingItemCreateInput,
  type PackingItemDTO,
  type PackingListDTO,
  type TripMemberDTO,
  type TripRole,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { EmptyState, GradientHeader, PrimaryButton, ScreenContainer } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme, usePalette } from '../../theme/useAppTheme';
import { PACKING_PALETTE } from './TripPackingListScreen.palette';
import {
  addPackingItem,
  addStarterItems,
  bookingKeys,
  deletePackingItem,
  fetchPackingList,
  patchPackingItem,
  putPacked,
} from './bookingTimelineApi';
import {
  applyFilter,
  canEditItem,
  groupByCategory,
  togglePackedOptimistic,
  type PackingFilter,
} from './packingListView';
import { PackingItemFormModal } from './PackingItemFormModal';

type Props = NativeStackScreenProps<TripsStackParamList, 'TripPackingList'>;

interface MeResponse {
  readonly user: { readonly id: string };
}

const CATEGORY_TITLES: Record<PackingCategory, string> = {
  documents: 'Documents',
  clothing: 'Clothing',
  toiletries: 'Toiletries',
  health: 'Health',
  tech: 'Tech',
  park_gear: 'Park Gear',
  kids: 'Kids',
  other: 'Other',
};

export default function TripPackingListScreen({
  navigation,
  route,
}: Props): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const palette = usePalette(PACKING_PALETTE);
  const queryClient = useQueryClient();
  const { tripId } = route.params;

  const [filter, setFilter] = useState<PackingFilter>('all');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [editingItem, setEditingItem] = useState<PackingItemDTO | null>(null);

  // Queries
  const packingQuery = useQuery<PackingListDTO, ApiError>({
    queryKey: bookingKeys.packing(tripId),
    queryFn: () => fetchPackingList(tripId),
    refetchOnMount: 'always',
  });

  const { refetch } = packingQuery;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const meQuery = useQuery<MeResponse, ApiError>({
    queryKey: ['me'],
    queryFn: () => apiRequest<MeResponse>('GET', '/me'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const membersQuery = useQuery<readonly TripMemberDTO[], ApiError>({
    queryKey: ['trips', 'members', tripId],
    queryFn: () => apiRequest<readonly TripMemberDTO[]>('GET', `/trips/${tripId}/members`),
    staleTime: 30 * 1000,
    retry: false,
  });

  const callerId = meQuery.data?.user?.id ?? '';
  const members = Array.isArray(membersQuery.data) ? membersQuery.data : [];
  const myRole: TripRole =
    members.find((m) => m.userId === callerId)?.role ?? 'member';

  const formMembers = useMemo(
    () => members.map((m) => ({ id: m.userId, displayName: m.displayName })),
    [members],
  );

  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('TripsList');
    }
  }, [navigation]);

  // Optimistic Toggle Packed
  const handleTogglePacked = useCallback(
    async (item: PackingItemDTO) => {
      setErrorMessage(null);
      const prev = queryClient.getQueryData<PackingListDTO>(bookingKeys.packing(tripId));
      if (prev) {
        queryClient.setQueryData<PackingListDTO>(
          bookingKeys.packing(tripId),
          togglePackedOptimistic(prev, item.id, !item.packed),
        );
      }

      try {
        await putPacked(tripId, item.id, !item.packed);
      } catch {
        if (prev) {
          queryClient.setQueryData<PackingListDTO>(bookingKeys.packing(tripId), prev);
        }
        setErrorMessage("Couldn't update packed status");
      } finally {
        void queryClient.invalidateQueries({ queryKey: bookingKeys.packing(tripId) });
      }
    },
    [queryClient, tripId],
  );

  // Add Item
  const handleOpenAdd = useCallback(() => {
    setEditingItem(null);
    setModalMode('add');
    setIsModalOpen(true);
  }, []);

  // Edit Item
  const handleOpenEdit = useCallback((item: PackingItemDTO) => {
    setEditingItem(item);
    setModalMode('edit');
    setIsModalOpen(true);
  }, []);

  // Remove Item
  const handleRemoveItem = useCallback(
    async (item: PackingItemDTO) => {
      setErrorMessage(null);
      try {
        await deletePackingItem(tripId, item.id);
        queryClient.setQueryData<PackingListDTO>(bookingKeys.packing(tripId), (prev) => {
          if (!prev) return prev;
          return {
            items: prev.items.filter((i) => i.id !== item.id),
            totalCount: Math.max(0, prev.totalCount - 1),
            packedCount: item.packed ? Math.max(0, prev.packedCount - 1) : prev.packedCount,
          };
        });
        await queryClient.invalidateQueries({ queryKey: bookingKeys.packing(tripId) });
      } catch (err) {
        setErrorMessage("Couldn't remove packing item");
      }
    },
    [queryClient, tripId],
  );

  // Starter Items
  const handleAddStarter = useCallback(async () => {
    setErrorMessage(null);
    try {
      await addStarterItems(tripId);
      void queryClient.invalidateQueries({ queryKey: bookingKeys.packing(tripId) });
    } catch {
      setErrorMessage("Couldn't add suggested items");
    }
  }, [queryClient, tripId]);

  // Submit Modal
  const handleSubmitModal = useCallback(
    async (values: PackingItemCreateInput) => {
      setErrorMessage(null);
      try {
        if (modalMode === 'add') {
          const newItem = await addPackingItem(tripId, values);
          queryClient.setQueryData<PackingListDTO>(bookingKeys.packing(tripId), (prev) => {
            if (!prev) return prev;
            return {
              items: [...prev.items, newItem],
              totalCount: prev.totalCount + 1,
              packedCount: prev.packedCount,
            };
          });
        } else if (editingItem) {
          const updated = await patchPackingItem(tripId, editingItem.id, values);
          queryClient.setQueryData<PackingListDTO>(bookingKeys.packing(tripId), (prev) => {
            if (!prev) return prev;
            return {
              items: prev.items.map((i) => (i.id === updated.id ? updated : i)),
              totalCount: prev.totalCount,
              packedCount: prev.packedCount,
            };
          });
        }
        setIsModalOpen(false);
        setEditingItem(null);
        void queryClient.invalidateQueries({ queryKey: bookingKeys.packing(tripId) });
      } catch {
        setErrorMessage(
          modalMode === 'add'
            ? "Couldn't add packing item"
            : "Couldn't update packing item",
        );
      }
    },
    [editingItem, modalMode, queryClient, tripId],
  );

  // Filtered and grouped items
  const data = packingQuery.data;
  const filteredItems = useMemo(() => {
    if (!data) return [];
    return applyFilter(data.items, filter, callerId);
  }, [data, filter, callerId]);

  const groups = useMemo(() => {
    return groupByCategory(filteredItems);
  }, [filteredItems]);

  const sections = useMemo(() => {
    return groups.map((g) => ({
      title: CATEGORY_TITLES[g.category],
      category: g.category,
      data: g.items,
    }));
  }, [groups]);

  // Loading state (only while nothing cached)
  if (packingQuery.isLoading && data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Packing list" icon="bag-check-outline" compact onBack={handleBack} />
        <View style={styles.center} testID="packing-list-loading">
          <ActivityIndicator color={t.color.primaryFg} size="large" />
        </View>
      </ScreenContainer>
    );
  }

  // Error state (when no data cached)
  if (packingQuery.isError && data === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader title="Packing list" icon="bag-check-outline" compact onBack={handleBack} />
        <View style={styles.center} testID="packing-list-error">
          <EmptyState
            icon="cloud-offline-outline"
            title="We couldn't load the packing list"
            body="Please check your connection and try again."
          />
          <PrimaryButton
            label="Retry"
            icon="refresh-outline"
            onPress={() => {
              void packingQuery.refetch();
            }}
            testID="packing-list-retry"
            style={styles.retryBtn}
          />
        </View>
      </ScreenContainer>
    );
  }

  const totalCount = data?.totalCount ?? 0;
  const packedCount = data?.packedCount ?? 0;

  return (
    <ScreenContainer>
      <GradientHeader title="Packing list" icon="bag-check-outline" compact onBack={handleBack} />

      <View style={styles.container}>
        {/* Error banner if any */}
        {errorMessage !== null && (
          <View style={styles.errorBanner} testID="packing-list-error-banner">
            <Ionicons name="alert-circle-outline" size={16} color={t.color.danger} />
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        )}

        {/* Headline Counts & Add Button */}
        <View style={styles.countsBar}>
          <Text style={styles.countsText} testID="packing-counts">
            {packedCount} of {totalCount} packed
          </Text>
          {totalCount > 0 && (
            <Pressable
              onPress={handleOpenAdd}
              style={styles.addButton}
              accessibilityRole="button"
              accessibilityLabel="Add packing item"
              testID="packing-add-item-btn"
            >
              <Ionicons name="add" size={16} color={t.color.primaryFg} />
              <Text style={styles.addButtonText}>Add item</Text>
            </Pressable>
          )}
        </View>

        {/* Filter Chips (always visible when list is non-empty) */}
        {totalCount > 0 && (
          <View style={styles.filterRow}>
            {(['all', 'mine', 'unpacked'] as const).map((f) => {
              const isSelected = filter === f;
              const label = f === 'all' ? 'All' : f === 'mine' ? 'Mine' : 'Unpacked';
              return (
                <Pressable
                  key={f}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${label} items`}
                  onPress={() => setFilter(f)}
                  style={[
                    styles.filterChip,
                    isSelected && { backgroundColor: palette.chipSelectedBg },
                  ]}
                  testID={`packing-filter-${f}`}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isSelected && { color: palette.chipSelectedText, fontWeight: '600' },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* List Content / Empty States */}
        {totalCount === 0 ? (
          <View style={styles.emptyContainer} testID="packing-empty-state">
            <EmptyState
              icon="bag-outline"
              title="Packing list is empty"
              body="Get started by adding items or load Disney packing suggestions."
            />
            <View style={styles.emptyActions}>
              <PrimaryButton
                label="Add suggested items"
                icon="sparkles-outline"
                onPress={handleAddStarter}
                testID="packing-add-starter-btn"
                style={styles.emptyBtn}
              />
              <Pressable
                onPress={handleOpenAdd}
                style={styles.emptyAddBtn}
                accessibilityRole="button"
                accessibilityLabel="Add item"
                testID="packing-empty-add-btn"
              >
                <Ionicons name="add-circle-outline" size={18} color={t.color.primaryFg} />
                <Text style={styles.emptyAddBtnText}>Add custom item</Text>
              </Pressable>
            </View>
          </View>
        ) : filteredItems.length === 0 ? (
          <View style={styles.noMatchContainer} testID="packing-no-match-state">
            <Text style={styles.noMatchText}>No items match this filter.</Text>
          </View>
        ) : (
          <SectionList
            key={`${filter}-${filteredItems.map((i) => i.id).join(',')}`}
            sections={sections}
            keyExtractor={(item) => item.id}
            initialNumToRender={50}
            extraData={data}
            contentContainerStyle={styles.listContent}
            renderSectionHeader={({ section: { title } }) => (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{title}</Text>
              </View>
            )}
            renderItem={({ item }) => {
              const editable = canEditItem(myRole, callerId, item);
              const packedLabel = `${item.name}, ${item.packed ? 'Packed' : 'Not packed'}`;

              return (
                <View style={styles.itemRow} testID={`packing-item-row-${item.id}`}>
                  {/* Packed Checkbox */}
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.packed }}
                    accessibilityLabel={packedLabel}
                    onPress={() => handleTogglePacked(item)}
                    style={[
                      styles.packedCheckbox,
                      item.packed && { backgroundColor: palette.packedBg },
                    ]}
                    testID={`packing-item-packed-${item.id}`}
                  >
                    <Ionicons
                      name={item.packed ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={item.packed ? palette.packedFg : palette.unpackedFg}
                    />
                    <Text
                      style={[
                        styles.packedText,
                        item.packed && { color: palette.packedFg, fontWeight: '600' },
                      ]}
                    >
                      {item.packed ? 'Packed' : 'Not packed'}
                    </Text>
                  </Pressable>

                  {/* Item Description */}
                  <View style={styles.itemInfo}>
                    <View style={styles.nameRow}>
                      <Text
                        style={[
                          styles.itemName,
                          item.packed && styles.itemNamePacked,
                        ]}
                      >
                        {item.name}
                      </Text>
                      {item.quantity > 1 && (
                        <Text style={styles.itemQuantity}>×{item.quantity}</Text>
                      )}
                    </View>
                    <Text style={styles.itemAssignee}>
                      {item.assigneeDisplayName ?? 'Unassigned'}
                    </Text>
                  </View>

                  {/* Actions for Authorized Users */}
                  {editable && (
                    <View style={styles.itemActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${item.name}`}
                        onPress={() => handleOpenEdit(item)}
                        style={styles.actionBtn}
                        testID={`packing-item-edit-${item.id}`}
                      >
                        <Ionicons name="create-outline" size={18} color={t.color.primaryFg} />
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name}`}
                        onPress={() => handleRemoveItem(item)}
                        style={styles.actionBtn}
                        testID={`packing-item-remove-${item.id}`}
                      >
                        <Ionicons name="trash-outline" size={18} color={t.color.danger} />
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            }}
          />
        )}
      </View>

      {/* Form Modal for Add/Edit */}
      <PackingItemFormModal
        visible={isModalOpen}
        mode={modalMode}
        initialItem={editingItem}
        members={formMembers}
        onSubmit={handleSubmitModal}
        onClose={() => setIsModalOpen(false)}
      />
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    paddingHorizontal: t.spacing.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.lg,
  },
  retryBtn: {
    marginTop: t.spacing.md,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: t.spacing.sm,
    backgroundColor: t.color.surfaceAlt,
    borderLeftWidth: 3,
    borderLeftColor: t.color.danger,
    borderRadius: t.radius.sm,
    marginVertical: t.spacing.xs,
    gap: t.spacing.xs,
  },
  errorBannerText: {
    ...t.typography.meta,
    color: t.color.danger,
    flex: 1,
  },
  countsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: t.spacing.sm,
  },
  countsText: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.sm,
  },
  addButtonText: {
    ...t.typography.meta,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    marginBottom: t.spacing.sm,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surfaceAlt,
  },
  filterChipText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  listContent: {
    paddingBottom: t.spacing.xxl,
  },
  sectionHeader: {
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.xs,
    backgroundColor: t.color.background,
  },
  sectionHeaderText: {
    ...t.typography.meta,
    fontWeight: '700',
    color: t.color.primaryFg,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.sm,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.xs,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  packedCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: t.radius.sm,
    marginRight: t.spacing.sm,
  },
  packedText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    fontSize: 12,
  },
  itemInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  itemName: {
    ...t.typography.body,
    fontWeight: '500',
    color: t.color.textPrimary,
  },
  itemNamePacked: {
    textDecorationLine: 'line-through',
    color: t.color.textSecondary,
  },
  itemQuantity: {
    ...t.typography.meta,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  itemAssignee: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: t.spacing.xs,
  },
  actionBtn: {
    padding: 6,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.lg,
  },
  emptyActions: {
    marginTop: t.spacing.lg,
    width: '100%',
    alignItems: 'center',
    gap: t.spacing.md,
  },
  emptyBtn: {
    width: '100%',
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  emptyAddBtnText: {
    ...t.typography.body,
    color: t.color.primaryFg,
    fontWeight: '600',
  },
  noMatchContainer: {
    padding: t.spacing.xl,
    alignItems: 'center',
  },
  noMatchText: {
    ...t.typography.body,
    color: t.color.textSecondary,
  },
}));
