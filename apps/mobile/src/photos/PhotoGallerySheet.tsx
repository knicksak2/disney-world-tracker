import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FoodPhotoDTO, RestaurantFoodPhotoDTO } from '@dwt/shared';
import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
import { PhotoViewer, type PhotoViewerItem } from './PhotoViewer';

export interface PhotoGallerySheetProps<T extends FoodPhotoDTO | RestaurantFoodPhotoDTO = FoodPhotoDTO> {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly subtitle?: string;
  readonly pages?: ReadonlyArray<{ readonly items: readonly T[] }> | undefined;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
  readonly onRetry?: () => void;
  readonly fetchNextPage?: () => void;
  readonly hasNextPage?: boolean;
  readonly isFetchingNextPage?: boolean;
  readonly getLabel?: (photo: T) => string | undefined;
  readonly onViewDish?: (foodItemId: string) => void;
  readonly headerAction?: React.ReactNode;
  readonly emptyTitle?: string;
  readonly emptySubtitle?: string;
  readonly emptyAction?: React.ReactNode;
  readonly testID?: string;
}

export function PhotoGallerySheet<T extends FoodPhotoDTO | RestaurantFoodPhotoDTO = FoodPhotoDTO>({
  visible,
  onClose,
  title,
  subtitle,
  pages,
  isLoading = false,
  isError = false,
  onRetry,
  fetchNextPage,
  hasNextPage = false,
  isFetchingNextPage = false,
  getLabel,
  onViewDish,
  headerAction,
  emptyTitle = 'No photos yet',
  emptySubtitle = 'Be the first to share a photo of this dish!',
  emptyAction,
  testID = 'photo-gallery-sheet',
}: PhotoGallerySheetProps<T>): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();

  const [activeViewerPhoto, setActiveViewerPhoto] = useState<T | null>(null);

  const allPhotos = useMemo(() => {
    if (!pages) return [];
    return pages.flatMap((p) => (Array.isArray(p.items) ? p.items : []));
  }, [pages]);

  if (!visible) {
    return null;
  }

  const handleEndReached = () => {
    if (hasNextPage && !isFetchingNextPage && fetchNextPage) {
      fetchNextPage();
    }
  };

  const resolvedFoodItemName = activeViewerPhoto
    ? getLabel
      ? getLabel(activeViewerPhoto)
      : title
    : undefined;
  const viewerItem: PhotoViewerItem | null = activeViewerPhoto
    ? {
        id: activeViewerPhoto.id,
        url: activeViewerPhoto.url,
        thumbUrl: activeViewerPhoto.thumbUrl,
        width: activeViewerPhoto.width,
        height: activeViewerPhoto.height,
        uploader: activeViewerPhoto.uploader,
        mine: activeViewerPhoto.mine,
        ...(resolvedFoodItemName ? { foodItemName: resolvedFoodItemName } : {}),
      }
    : null;

  const targetFoodItemId = activeViewerPhoto?.foodItemId;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container} testID={testID}>
        {/* Header bar */}
        <View style={styles.header}>
          <View style={styles.headerTitles}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          <View style={styles.headerRight}>
            {headerAction}
            <TouchableOpacity
              testID={`${testID}-close`}
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close gallery"
            >
              <Ionicons name="close" size={24} color={t.color.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        {isLoading && allPhotos.length === 0 ? (
          <View style={styles.centered} accessibilityRole="progressbar">
            <ActivityIndicator size="large" color={t.color.primaryFg} />
          </View>
        ) : isError && allPhotos.length === 0 ? (
          <View style={styles.centered} testID={`${testID}-error`}>
            <Ionicons name="alert-circle-outline" size={48} color={t.color.danger} />
            <Text style={styles.errorText}>Could not load photos</Text>
            {onRetry ? (
              <TouchableOpacity
                testID={`${testID}-retry`}
                onPress={onRetry}
                style={styles.retryButton}
                accessibilityRole="button"
                accessibilityLabel="Retry loading photos"
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : allPhotos.length === 0 ? (
          <View style={styles.centered} testID={`${testID}-empty`}>
            <Ionicons name="images-outline" size={48} color={t.color.textSecondary} />
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
            {emptyAction ? <View style={styles.emptyActionWrapper}>{emptyAction}</View> : null}
          </View>
        ) : (
          <FlatList
            data={allPhotos}
            keyExtractor={(item) => item.id}
            numColumns={3}
            contentContainerStyle={styles.gridContent}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              isFetchingNextPage ? (
                <View style={styles.footerLoader} accessibilityRole="progressbar">
                  <ActivityIndicator size="small" color={t.color.primaryFg} />
                </View>
              ) : null
            }
            renderItem={({ item, index }) => {
              const uploaderName = item.uploader ? item.uploader.displayName : 'Another guest';
              const label = getLabel ? getLabel(item) : undefined;
              const a11yLabel = label
                ? `${label}, photo by ${uploaderName}`
                : `Photo ${index + 1} of ${title}, by ${uploaderName}`;

              return (
                <TouchableOpacity
                  testID={`photo-grid-tile-${item.id}`}
                  style={styles.tile}
                  onPress={() => setActiveViewerPhoto(item)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={a11yLabel}
                >
                  <Image
                    source={{ uri: item.thumbUrl }}
                    style={styles.tileImage}
                    accessibilityRole="image"
                    accessibilityLabel={a11yLabel}
                  />
                  <View style={styles.tileBylineRow}>
                    <Ionicons
                      name="person-circle-outline"
                      size={14}
                      color={t.color.textSecondary}
                      accessibilityLabel={uploaderName}
                    />
                    <Text style={styles.tileUploaderText} numberOfLines={1}>
                      {uploaderName}
                    </Text>
                  </View>
                  {label ? (
                    <Text style={styles.tileLabelText} numberOfLines={1}>
                      {label}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            }}
          />
        )}

        {/* Viewer */}
        <PhotoViewer
          visible={activeViewerPhoto !== null}
          photo={viewerItem}
          onClose={() => setActiveViewerPhoto(null)}
          footerAction={
            onViewDish && targetFoodItemId
              ? {
                  label: 'View dish',
                  accessibilityLabel: `View dish ${getLabel ? getLabel(activeViewerPhoto!) : title}`,
                  onPress: () => {
                    const id = targetFoodItemId;
                    setActiveViewerPhoto(null);
                    onClose();
                    onViewDish(id);
                  },
                }
              : undefined
          }
        />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => {
  const windowWidth = Dimensions.get('window').width;
  const tileWidth = Math.floor((windowWidth - t.spacing.md * 4) / 3);

  return {
    container: {
      flex: 1,
      backgroundColor: t.color.surface,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.md,
      paddingVertical: t.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: t.color.border,
    },
    headerTitles: {
      flex: 1,
      marginRight: t.spacing.sm,
    },
    title: {
      ...t.typography.subtitle,
      color: t.color.textPrimary,
      fontWeight: '700',
    },
    subtitle: {
      ...t.typography.meta,
      color: t.color.textSecondary,
      marginTop: 2,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
    },
    closeButton: {
      padding: 4,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: t.spacing.xl,
      gap: t.spacing.sm,
    },
    errorText: {
      ...t.typography.body,
      color: t.color.textSecondary,
    },
    retryButton: {
      backgroundColor: t.color.surfaceAlt,
      paddingVertical: t.spacing.xs,
      paddingHorizontal: t.spacing.md,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.color.border,
      marginTop: t.spacing.xs,
    },
    retryText: {
      ...t.typography.body,
      fontWeight: '600',
      color: t.color.primaryFg,
    },
    emptyTitle: {
      ...t.typography.subtitle,
      color: t.color.textPrimary,
      fontWeight: '600',
      marginTop: t.spacing.sm,
    },
    emptySubtitle: {
      ...t.typography.body,
      color: t.color.textSecondary,
      textAlign: 'center',
    },
    emptyActionWrapper: {
      marginTop: t.spacing.md,
    },
    gridContent: {
      padding: t.spacing.sm,
      gap: t.spacing.sm,
    },
    tile: {
      width: tileWidth,
      margin: t.spacing.xs / 2,
      borderRadius: t.radius.sm,
      backgroundColor: t.color.surfaceAlt,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.color.border,
    },
    tileImage: {
      width: '100%',
      height: tileWidth,
      backgroundColor: t.color.surface,
    },
    tileBylineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 4,
      paddingVertical: 3,
    },
    tileUploaderText: {
      ...t.typography.meta,
      fontSize: 10,
      color: t.color.textSecondary,
      flex: 1,
    },
    tileLabelText: {
      ...t.typography.meta,
      fontSize: 10,
      fontWeight: '600',
      color: t.color.textPrimary,
      paddingHorizontal: 4,
      paddingBottom: 4,
    },
    footerLoader: {
      paddingVertical: t.spacing.md,
      alignItems: 'center',
    },
  };
});
