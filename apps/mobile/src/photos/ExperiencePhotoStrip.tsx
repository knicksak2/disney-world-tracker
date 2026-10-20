import React, { useState } from 'react';
import {
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RestaurantFoodPhotoDTO } from '@dwt/shared';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
import { usePhotoConfig, useRestaurantFoodPhotos } from './api';
import { buildStripModel, type ExperiencePhotoStripItem } from './experiencePhotoStrip.pure';
import { PhotoViewer, type PhotoViewerItem } from './PhotoViewer';
import { RestaurantPhotosSheet } from './RestaurantPhotosSheet';

export interface ExperiencePhotoStripProps {
  readonly kind: 'experience' | 'location';
  readonly id: string;
  readonly restaurantName: string;
  readonly onViewDish?: ((foodItemId: string) => void) | undefined;
}

export function ExperiencePhotoStrip({
  kind,
  id,
  restaurantName,
  onViewDish,
}: ExperiencePhotoStripProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();

  const [sheetVisible, setSheetVisible] = useState(false);
  const [activeViewerItem, setActiveViewerItem] = useState<RestaurantFoodPhotoDTO | null>(null);

  const {
    data: config,
    isLoading: isConfigLoading,
    isError: isConfigError,
  } = usePhotoConfig();

  const stripMax = config?.experienceStripMax ?? 8;
  const isPhotosGloballyEnabled = Boolean(config?.enabled);

  const photosQuery = useRestaurantFoodPhotos(kind, id, {
    limit: stripMax,
    enabled: isPhotosGloballyEnabled && !isConfigLoading && !isConfigError,
  });

  // Guard: if config is loading/failing, or disabled, render nothing
  if (isConfigLoading || isConfigError || !isPhotosGloballyEnabled) {
    return null;
  }

  // Failure isolation: while query is pending, or after it rejects, render nothing
  if (photosQuery.isLoading || photosQuery.isError) {
    return null;
  }

  const firstPage = photosQuery.data?.pages[0];
  const items = firstPage?.items ?? [];

  const model = buildStripModel(items, stripMax);

  // If no items, render nothing (no heading, no see all, no add control)
  if (!model.visible) {
    return null;
  }

  const viewerPhoto: PhotoViewerItem | null = activeViewerItem
    ? {
        id: activeViewerItem.id,
        url: activeViewerItem.url,
        thumbUrl: activeViewerItem.thumbUrl,
        width: activeViewerItem.width,
        height: activeViewerItem.height,
        uploader: activeViewerItem.uploader,
        mine: activeViewerItem.mine,
        ...(activeViewerItem.foodItemName ? { foodItemName: activeViewerItem.foodItemName } : {}),
      }
    : null;

  return (
    <View style={styles.container} testID="experience-photo-strip">
      <View style={styles.headerRow}>
        <Text accessibilityRole="header" style={styles.heading}>
          Photos from guests
        </Text>
        <TouchableOpacity
          testID="experience-photo-strip-see-all"
          accessibilityRole="button"
          accessibilityLabel="See all photos"
          onPress={() => setSheetVisible(true)}
          style={styles.seeAllButton}
        >
          <Text style={styles.seeAllText}>See all</Text>
          <Ionicons name="chevron-forward" size={16} color={t.color.primaryFg} />
        </TouchableOpacity>
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={model.items}
        keyExtractor={(item) => item.photoId}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }: { item: ExperiencePhotoStripItem }) => (
          <TouchableOpacity
            testID={`experience-photo-strip-tile-${item.photoId}`}
            accessibilityRole="imagebutton"
            accessibilityLabel={item.label}
            onPress={() => setActiveViewerItem(item.photo)}
            style={styles.tile}
          >
            <Image
              source={{ uri: item.thumbUrl }}
              style={styles.thumbnail}
              accessibilityLabel={item.label}
            />
            <Text style={styles.dishLabel} numberOfLines={1}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Full gallery sheet */}
      <RestaurantPhotosSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        kind={kind}
        id={id}
        restaurantName={restaurantName}
        {...(onViewDish ? { onViewDish } : {})}
      />

      {/* Viewer modal */}
      <PhotoViewer
        visible={activeViewerItem !== null}
        photo={viewerPhoto}
        onClose={() => setActiveViewerItem(null)}
        footerAction={
          onViewDish && activeViewerItem
            ? {
                label: 'View dish',
                accessibilityLabel: `View dish ${activeViewerItem.foodItemName || 'Dish'}`,
                onPress: () => {
                  const targetId = activeViewerItem.foodItemId;
                  setActiveViewerItem(null);
                  onViewDish(targetId);
                },
              }
            : undefined
        }
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    marginVertical: t.spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.md,
    marginBottom: t.spacing.sm,
  },
  heading: {
    ...t.typography.heading,
    color: t.color.textPrimary,
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: t.spacing.xs,
  },
  seeAllText: {
    ...t.typography.body,
    fontWeight: '600',
    color: t.color.primaryFg,
  },
  listContent: {
    paddingHorizontal: t.spacing.md,
    gap: t.spacing.sm,
  },
  tile: {
    width: 120,
    alignItems: 'flex-start',
  },
  thumbnail: {
    width: 120,
    height: 120,
    borderRadius: t.radius.md,
    backgroundColor: t.color.surfaceAlt,
  },
  dishLabel: {
    ...t.typography.meta,
    color: t.color.textPrimary,
    marginTop: t.spacing.xs,
    width: 120,
  },
}));
