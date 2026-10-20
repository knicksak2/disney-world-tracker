import React from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDishPhotos } from './api';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';

export interface DishPhotoStripProps {
  readonly foodItemId: string;
  readonly foodItemName: string;
  readonly onPress?: () => void;
  readonly testID?: string;
}

export function DishPhotoStrip({
  foodItemId,
  foodItemName,
  onPress,
  testID,
}: DishPhotoStripProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();

  const { data, isLoading } = useDishPhotos(foodItemId);
  const photos = Array.isArray(data?.items) ? data.items : [];

  if (isLoading) {
    return null;
  }

  const containerTestId = testID ?? `dish-photo-strip-${foodItemId}`;

  if (photos.length === 0) {
    return (
      <Pressable
        testID={`${containerTestId}-empty`}
        onPress={onPress}
        style={styles.emptyContainer}
        accessibilityRole="button"
        accessibilityLabel={`Add photo for ${foodItemName}`}
      >
        <Ionicons name="camera-outline" size={13} color={t.color.primaryFg} />
        <Text style={styles.emptyText}>Add photo</Text>
      </Pressable>
    );
  }

  const displayedPhotos = photos.slice(0, 3);
  const overflowCount = photos.length - displayedPhotos.length;

  return (
    <Pressable
      testID={containerTestId}
      onPress={onPress}
      style={styles.container}
      accessibilityRole="button"
      accessibilityLabel={`Photos of ${foodItemName}, ${photos.length} available`}
    >
      <View style={styles.thumbnailCluster}>
        {displayedPhotos.map((photo, idx) => (
          <View
            key={photo.id}
            style={[styles.thumbnailWrapper, idx > 0 && styles.thumbnailOverlap]}
          >
            <Image
              source={{ uri: photo.thumbUrl }}
              style={styles.thumbnail}
              accessibilityLabel={`Photo ${idx + 1} of ${foodItemName}`}
              accessibilityRole="image"
            />
          </View>
        ))}
        {overflowCount > 0 ? (
          <View style={[styles.overflowBadge, styles.thumbnailOverlap]}>
            <Text style={styles.overflowText}>+{overflowCount}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.countText}>
        {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 3,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  thumbnailCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbnailWrapper: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
    overflow: 'hidden',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailOverlap: {
    marginLeft: -6,
  },
  overflowBadge: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: t.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.color.border,
  },
  overflowText: {
    ...t.typography.meta,
    fontSize: 9,
    fontWeight: '700',
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  countText: {
    ...t.typography.meta,
    fontSize: 12,
    fontWeight: '500',
    color: t.color.textSecondary,
  },
  emptyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: t.spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: t.color.surfaceAlt,
    paddingVertical: 3,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  emptyText: {
    ...t.typography.meta,
    fontSize: 12,
    fontWeight: '500',
    color: t.color.primaryFg,
  },
}));
