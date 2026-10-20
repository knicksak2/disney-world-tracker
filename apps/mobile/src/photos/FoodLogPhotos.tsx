import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MyPhotoDTO } from '@dwt/shared';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
import { useMyPhotos, usePhotoStatuses, useDeletePhoto } from './api';
import { PhotoStatusChip } from './PhotoStatusChip';
import { PhotoViewer, type PhotoViewerItem } from './PhotoViewer';
import { isFinalPhotoStatus } from './pollPlan';

export interface FoodLogPhotosProps {
  /** The food log's id; photos are filtered to `targetId === logId`. */
  readonly logId: string;
  /**
   * The food item (dish) id. GET /me/photos scopes a food_log photo by the
   * food item id (R4.11), so this is the query scope, not the log id.
   */
  readonly foodItemId: string;
  readonly testID?: string;
}

export function FoodLogPhotos({
  logId,
  foodItemId,
  testID,
}: FoodLogPhotosProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();
  const [activePhoto, setActivePhoto] = useState<MyPhotoDTO | null>(null);

  // One cached query per dish, shared by every log of that dish.
  const { data } = useMyPhotos('food_log', foodItemId);
  const photos = useMemo(
    () => (data?.items ?? []).filter((p) => p.targetId === logId),
    [data?.items, logId],
  );

  // Extract any non-final photo IDs for status polling
  const pendingPhotoIds = useMemo(() => {
    return photos.filter((p) => !isFinalPhotoStatus(p.status)).map((p) => p.id);
  }, [photos]);

  const { statuses } = usePhotoStatuses(pendingPhotoIds);
  const deleteMutation = useDeletePhoto();

  if (photos.length === 0) {
    return null;
  }

  const handleDelete = (photoId: string) => {
    Alert.alert(
      'Delete Photo',
      'Are you sure you want to delete this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMutation.mutate(photoId);
          },
        },
      ]
    );
  };

  const viewerItem: PhotoViewerItem | null = activePhoto
    ? {
        id: activePhoto.id,
        url: activePhoto.url,
        thumbUrl: activePhoto.thumbUrl,
        width: activePhoto.width,
        height: activePhoto.height,
        uploader: null,
        mine: true,
      }
    : null;

  return (
    <View style={styles.container} testID={testID ?? `food-log-photos-${logId}`}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {photos.map((photo) => {
          const polled = statuses[photo.id];
          const effectiveStatus = polled?.status ?? photo.status;
          const effectiveRejectMessage = polled?.rejectMessage ?? photo.rejectMessage;
          const imageUri = photo.thumbUrl || photo.url;

          return (
            <View
              key={photo.id}
              style={styles.photoCard}
              testID={`food-log-photo-card-${photo.id}`}
            >
              <Pressable
                onPress={() => setActivePhoto(photo)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`View photo ${photo.id}`}
                style={styles.thumbnailWrapper}
              >
                {imageUri ? (
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.thumbnail}
                    accessibilityRole="image"
                    accessibilityLabel="Food photo thumbnail"
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.thumbnailPlaceholder}>
                    <Ionicons name="image-outline" size={24} color={t.color.textSecondary} />
                  </View>
                )}
              </Pressable>

              <View style={styles.cardFooter}>
                {/* Status row: the chip and (when rejected) its wrapping reason. */}
                <View
                  style={styles.statusRow}
                  testID={`photo-card-status-row-${photo.id}`}
                >
                  <PhotoStatusChip
                    status={effectiveStatus}
                    rejectMessage={effectiveRejectMessage}
                    testID={`photo-status-chip-${photo.id}`}
                  />
                </View>

                {/* Actions row: its own line so the delete control never overlaps the chip. */}
                <View
                  style={styles.actionsRow}
                  testID={`photo-card-actions-row-${photo.id}`}
                >
                  <Pressable
                    onPress={() => handleDelete(photo.id)}
                    style={styles.deleteButton}
                    hitSlop={t.spacing.xs}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete photo ${photo.id}`}
                    testID={`delete-photo-btn-${photo.id}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={t.color.danger} />
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {viewerItem ? (
        <PhotoViewer
          visible={Boolean(activePhoto)}
          photo={viewerItem}
          onClose={() => setActivePhoto(null)}
          onDeleted={() => setActivePhoto(null)}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    marginTop: t.spacing.sm,
    paddingTop: t.spacing.xs,
  },
  scrollContent: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    paddingVertical: t.spacing.xs,
  },
  photoCard: {
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.spacing.xs,
    width: 140,
  },
  thumbnailWrapper: {
    width: '100%',
    height: 90,
    borderRadius: t.radius.sm,
    overflow: 'hidden',
    backgroundColor: t.color.surface,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardFooter: {
    marginTop: t.spacing.xs,
    gap: t.spacing.xs,
  },
  statusRow: {
    alignSelf: 'stretch',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  deleteButton: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.sm,
  },
}));
