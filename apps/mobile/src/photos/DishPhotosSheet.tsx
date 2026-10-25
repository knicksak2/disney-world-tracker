import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import type { FoodItemLogHistoryDTO } from '@dwt/shared';
import { ApiError, apiRequest } from '../api/client';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
import { useDishPhotosInfinite, useUploadPhotos, photoKeys } from './api';
import { PhotoGallerySheet } from './PhotoGallerySheet';
import { PhotoPickerSheet } from './PhotoPickerSheet';
import type { PreparedImages } from './imagePrep';
import LogFoodItemModal from '../screens/catalog/LogFoodItemModal';

export interface DishPhotosSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly foodItemId: string;
  readonly foodItemName: string;
  readonly experienceId?: string | null;
  readonly testID?: string;
}

export function DishPhotosSheet({
  visible,
  onClose,
  foodItemId,
  foodItemName,
  experienceId,
  testID = 'dish-photos-sheet',
}: DishPhotosSheetProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const queryClient = useQueryClient();

  const [isCheckingLogs, setIsCheckingLogs] = useState(false);
  const [showPickerSheet, setShowPickerSheet] = useState(false);
  const [targetLogId, setTargetLogId] = useState<string | null>(null);
  const [showLogModal, setShowLogModal] = useState(false);
  const [targetFullNotice, setTargetFullNotice] = useState(false);
  const [pendingPreparedPhotos, setPendingPreparedPhotos] = useState<readonly PreparedImages[]>([]);

  const uploadPhotosMutation = useUploadPhotos();

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDishPhotosInfinite(foodItemId, { enabled: visible });

  if (!visible) {
    return null;
  }

  const handleAddPhotoPress = async () => {
    setIsCheckingLogs(true);
    setTargetFullNotice(false);
    try {
      const history = await apiRequest<FoodItemLogHistoryDTO>(
        'GET',
        `/me/food-items/${encodeURIComponent(foodItemId)}/logs`
      );
      const logs = Array.isArray(history?.logs) ? history.logs : [];
      if (logs.length === 0) {
        // No log exists yet: open log modal directly
        setShowLogModal(true);
      } else {
        // Most recent log
        setTargetLogId(logs[0]!.id);
        setShowPickerSheet(true);
      }
    } catch {
      // Fallback: open log modal
      setShowLogModal(true);
    } finally {
      setIsCheckingLogs(false);
    }
  };

  const handlePickerConfirm = async (prepared: PreparedImages, takenAt?: string) => {
    if (!targetLogId) return;

    try {
      await uploadPhotosMutation.mutateAsync({
        target: { kind: 'food_log', id: targetLogId },
        items: [{ prepared, ...(takenAt ? { takenAt } : {}) }],
      });
      setShowPickerSheet(false);
      await queryClient.invalidateQueries({ queryKey: photoKeys.dish(foodItemId) });
      await queryClient.invalidateQueries({ queryKey: ['dish-photos-infinite', foodItemId] });
      await queryClient.invalidateQueries({ queryKey: ['food-item-logs', foodItemId] });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'photo_target_full') {
        setShowPickerSheet(false);
        setPendingPreparedPhotos([prepared]);
        setTargetFullNotice(true);
      }
    }
  };

  const handleAcceptNewVisit = () => {
    setTargetFullNotice(false);
    setShowLogModal(true);
  };

  const renderAddButton = (buttonTestID: string) => (
    <TouchableOpacity
      testID={buttonTestID}
      onPress={handleAddPhotoPress}
      style={styles.addPhotoButton}
      accessibilityRole="button"
      accessibilityLabel={`Add a photo for ${foodItemName}`}
      disabled={isCheckingLogs}
    >
      {isCheckingLogs ? (
        <ActivityIndicator size="small" color={t.color.primaryFg} />
      ) : (
        <>
          <Ionicons name="camera-outline" size={16} color={t.color.primaryFg} />
          <Text style={styles.addPhotoText}>Add photo</Text>
        </>
      )}
    </TouchableOpacity>
  );

  return (
    <>
      <PhotoGallerySheet
        visible={visible}
        onClose={onClose}
        title={foodItemName}
        subtitle="Photos from guests"
        pages={data?.pages}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        fetchNextPage={fetchNextPage}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        headerAction={renderAddButton('dish-photos-add-photo-btn')}
        emptyTitle="No photos yet"
        emptySubtitle={`Be the first to share a photo of ${foodItemName}!`}
        emptyAction={renderAddButton('dish-photos-empty-add-photo-btn')}
        testID={testID}
      />

      {/* Target full banner / dialog */}
      {targetFullNotice ? (
        <View style={styles.targetFullOverlay} testID="dish-photos-target-full-notice">
          <View style={styles.targetFullCard}>
            <Ionicons name="information-circle-outline" size={32} color={t.color.accent} />
            <Text style={styles.targetFullTitle}>This visit log is full</Text>
            <Text style={styles.targetFullBody}>
              Your most recent visit already has the maximum photos (4 photos per visit). Would you like to log a new visit and attach your photo?
            </Text>
            <View style={styles.targetFullActions}>
              <TouchableOpacity
                onPress={() => setTargetFullNotice(false)}
                style={styles.targetFullCancelButton}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.targetFullCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="log-new-visit-btn"
                onPress={handleAcceptNewVisit}
                style={styles.targetFullConfirmButton}
                accessibilityRole="button"
                accessibilityLabel="Log a new visit"
              >
                <Text style={styles.targetFullConfirmText}>Log a new visit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {/* Photo Picker Sheet */}
      <PhotoPickerSheet
        visible={showPickerSheet}
        target="food"
        onClose={() => setShowPickerSheet(false)}
        onConfirm={handlePickerConfirm}
        title={`Add Photo for ${foodItemName}`}
      />

      {/* Log Food Item Modal */}
      <LogFoodItemModal
        visible={showLogModal}
        foodItem={{
          id: foodItemId,
          name: foodItemName,
          experienceId: experienceId ?? null,
          locationId: null,
          price: null,
          source: 'menu_sync',
          currentlyOnMenu: true,
        }}
        initialPhotos={pendingPreparedPhotos}
        onClose={() => {
          setShowLogModal(false);
          setPendingPreparedPhotos([]);
        }}
        onLogged={async () => {
          setShowLogModal(false);
          setPendingPreparedPhotos([]);
          await queryClient.invalidateQueries({ queryKey: photoKeys.dish(foodItemId) });
          await queryClient.invalidateQueries({ queryKey: ['dish-photos-infinite', foodItemId] });
          await queryClient.invalidateQueries({ queryKey: ['food-item-logs', foodItemId] });
        }}
      />
    </>
  );
}

const useStyles = makeStyles((t) => ({
  addPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 4,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  addPhotoText: {
    ...t.typography.meta,
    fontSize: 12,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  targetFullOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: t.spacing.xl,
    zIndex: 9999,
  },
  targetFullCard: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing.lg,
    gap: t.spacing.sm,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  targetFullTitle: {
    ...t.typography.subtitle,
    fontWeight: '700',
    color: t.color.textPrimary,
  },
  targetFullBody: {
    ...t.typography.body,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  targetFullActions: {
    flexDirection: 'row',
    gap: t.spacing.md,
    marginTop: t.spacing.sm,
    width: '100%',
  },
  targetFullCancelButton: {
    flex: 1,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color.surfaceAlt,
  },
  targetFullCancelText: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textSecondary,
  },
  targetFullConfirmButton: {
    flex: 1,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    backgroundColor: t.color.primary,
  },
  targetFullConfirmText: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.textOnPrimary,
  },
}));
