import React from 'react';
import { View, Image, TouchableOpacity, Dimensions } from 'react-native';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';

export interface PhotoGridItem {
  readonly id: string;
  readonly thumbUrl?: string | null;
  readonly url?: string | null;
  readonly foodItemName?: string;
  /** Overrides the default tile and image label (for example "Trip photo 3 of 12, opens viewer"). */
  readonly accessibilityLabel?: string | undefined;
}

export interface PhotoGridProps<T extends PhotoGridItem = PhotoGridItem> {
  readonly photos: readonly T[];
  readonly onSelectPhoto?: (photo: T) => void;
  readonly columns?: number;
  readonly renderOverlay?: (photo: T) => React.ReactNode;
  readonly testID?: string;
}

export function PhotoGrid<T extends PhotoGridItem = PhotoGridItem>({
  photos,
  onSelectPhoto,
  columns = 3,
  renderOverlay,
  testID,
}: PhotoGridProps<T>) {
  const styles = useStyles();
  const t = useAppTheme();

  if (!photos || photos.length === 0) {
    return null;
  }

  const windowWidth = Dimensions.get('window').width;
  const paddingTotal = t.spacing.md * 2;
  const gapTotal = t.spacing.sm * (columns - 1);
  const tileSize = Math.floor((windowWidth - paddingTotal - gapTotal) / columns);

  return (
    <View style={styles.gridContainer} testID={testID ?? 'photo-grid'}>
      {photos.map((photo) => {
        const imageUrl = photo.thumbUrl || photo.url || '';
        const label =
          photo.accessibilityLabel ??
          (photo.foodItemName ? `Photo of ${photo.foodItemName}` : 'Guest photo');

        return (
          <TouchableOpacity
            key={photo.id}
            testID={`photo-grid-tile-${photo.id}`}
            onPress={() => onSelectPhoto && onSelectPhoto(photo)}
            activeOpacity={0.8}
            style={[styles.tile, { width: tileSize, height: tileSize }]}
            accessibilityRole="imagebutton"
            accessibilityLabel={label}
          >
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                style={styles.image}
                resizeMode="cover"
                accessibilityRole="image"
                accessibilityLabel={label}
              />
            ) : null}
            {renderOverlay ? renderOverlay(photo) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  tile: {
    borderRadius: t.radius.md,
    overflow: 'hidden',
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  image: {
    width: '100%',
    height: '100%',
  },
}));
