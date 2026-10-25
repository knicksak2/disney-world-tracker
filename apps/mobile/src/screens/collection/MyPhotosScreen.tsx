import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MyPhotoDTO } from '@dwt/shared';

import type { CollectionStackParamList } from '../../navigation/CollectionStack';
import { EmptyState, GradientHeader, ScreenContainer } from '../../theme/components';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  PHOTO_GALLERY_STALE_TIME_MS,
  useAllMyPhotos,
  usePhotoStatuses,
} from '../../photos/api';
import { MY_PHOTOS_GRID_COLUMNS } from '../../photos/constants';
import {
  effectiveRejectMessage,
  effectiveStatus,
  pollableMyPhotoIds,
  settledByPoll,
  tileAccessibilityLabel,
  tileImageUri,
  toViewerItem,
} from '../../photos/myPhotos.pure';
import { PhotoStatusChip } from '../../photos/PhotoStatusChip';
import { PhotoViewer } from '../../photos/PhotoViewer';

export type MyPhotosNavigationProp = NativeStackNavigationProp<
  CollectionStackParamList & { MyPhotos: undefined },
  'MyPhotos'
>;

export interface MyPhotosScreenProps {
  readonly navigation?: MyPhotosNavigationProp;
}

export default function MyPhotosScreen({ navigation: navProp }: MyPhotosScreenProps): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();
  const navigation = useNavigation<MyPhotosNavigationProp>();
  const nav = navProp ?? navigation;

  const {
    items,
    isLoading,
    isError,
    refetch,
    isRefetching,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    clearConfirmedIds,
  } = useAllMyPhotos();

  const [activePhoto, setActivePhoto] = useState<MyPhotoDTO | null>(null);
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());

  // Polling for pending photos
  const pendingIds = useMemo(() => pollableMyPhotoIds(items, settled), [items, settled]);
  const { statuses } = usePhotoStatuses(pendingIds);

  useEffect(() => {
    const next = settledByPoll(statuses);
    if (next.some((id) => !settled.has(id))) {
      setSettled((prev) => new Set([...prev, ...next]));
      void refetch();
    }
  }, [statuses, settled, refetch]);

  // Thumbnail error guard: refetches at most once per visit,
  // re-armed ONLY on pull-to-refresh or regaining focus after > PHOTO_GALLERY_STALE_TIME_MS
  const urlRefetchArmed = useRef(true);
  const lastBlurTimeRef = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (lastBlurTimeRef.current !== null) {
        const elapsed = Date.now() - lastBlurTimeRef.current;
        if (elapsed > PHOTO_GALLERY_STALE_TIME_MS) {
          urlRefetchArmed.current = true;
        }
      }
      return () => {
        lastBlurTimeRef.current = Date.now();
      };
    }, [])
  );

  const handleThumbnailError = useCallback(() => {
    if (urlRefetchArmed.current) {
      urlRefetchArmed.current = false;
      void refetch();
    }
  }, [refetch]);

  const handleRefresh = useCallback(() => {
    urlRefetchArmed.current = true;
    clearConfirmedIds();
    void refetch();
  }, [clearConfirmedIds, refetch]);

  // Dimension calculations for grid
  const windowWidth = useWindowDimensions().width;
  const paddingTotal = t.spacing.md * 2;
  const gapTotal = t.spacing.sm * (MY_PHOTOS_GRID_COLUMNS - 1);
  const tileSize = Math.floor((windowWidth - paddingTotal - gapTotal) / MY_PHOTOS_GRID_COLUMNS);

  const renderItem = useCallback(
    ({ item }: { item: MyPhotoDTO }) => {
      const uri = tileImageUri(item);
      const accessibilityLabel = tileAccessibilityLabel(item);
      const status = effectiveStatus(item, statuses);
      const rejectMessage = effectiveRejectMessage(item, statuses);

      return (
        <View style={[styles.cell, { width: tileSize }]}>
          <Pressable
            testID={`my-photo-tile-${item.id}`}
            onPress={() => setActivePhoto(item)}
            style={[styles.tile, { width: tileSize, height: tileSize }]}
            accessibilityRole="imagebutton"
            accessibilityLabel={accessibilityLabel}
          >
            {uri ? (
              <Image
                source={{ uri }}
                style={styles.thumbnail}
                resizeMode="cover"
                onError={handleThumbnailError}
                accessibilityRole="image"
              />
            ) : (
              <View style={styles.placeholder}>
                <Ionicons name="image-outline" size={32} color={t.color.textSecondary} />
              </View>
            )}
          </Pressable>
          <View style={styles.chipContainer}>
            <PhotoStatusChip
              status={status}
              rejectMessage={rejectMessage}
              testID={`my-photo-chip-${item.id}`}
            />
          </View>
        </View>
      );
    },
    [handleThumbnailError, statuses, styles, t.color.textSecondary, tileSize]
  );

  const renderFooter = useCallback(() => {
    if (isFetchingNextPage) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator
            size="small"
            color={t.color.primaryFg}
            accessibilityRole="progressbar"
            accessibilityLabel="Loading more photos"
          />
        </View>
      );
    }
    if (isFetchNextPageError) {
      return (
        <View style={styles.footerError}>
          <Text style={styles.footerErrorText}>Couldn't load more photos</Text>
          <Pressable
            onPress={() => fetchNextPage()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading more photos"
            style={styles.retryButton}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    return null;
  }, [
    fetchNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
    styles,
    t.color.primaryFg,
  ]);

  return (
    <ScreenContainer>
      <View testID="my-photos-screen" style={styles.screenWrap}>
        <GradientHeader
          title="My Photos"
          compact
          onBack={() => nav.goBack()}
        />

        {isLoading && items.length === 0 ? (
          <View style={styles.centered} testID="my-photos-loading">
            <ActivityIndicator
              size="large"
              color={t.color.primaryFg}
              accessibilityRole="progressbar"
              accessibilityLabel="Loading photos"
            />
          </View>
        ) : isError && items.length === 0 ? (
          <View style={styles.centered} testID="my-photos-error">
            <Text style={styles.errorText}>Couldn't load your photos</Text>
            <Pressable
              onPress={() => refetch()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading photos"
              style={styles.retryButton}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            numColumns={MY_PHOTOS_GRID_COLUMNS}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            columnWrapperStyle={styles.columnWrapper}
            onEndReached={() => {
              if (hasNextPage && !isFetchingNextPage) {
                void fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.5}
            ListFooterComponent={renderFooter}
            ListEmptyComponent={
              <EmptyState
                icon="images-outline"
                title="No photos yet"
                body="Photos you add to food logs and trips show up here."
              />
            }
            refreshControl={
              <RefreshControl
                refreshing={Boolean(isRefetching && !isFetchingNextPage)}
                onRefresh={handleRefresh}
              />
            }
          />
        )}

        <PhotoViewer
          visible={Boolean(activePhoto)}
          photo={activePhoto ? toViewerItem(activePhoto) : null}
          onClose={() => setActivePhoto(null)}
          onDeleted={() => setActivePhoto(null)}
        />
      </View>
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  screenWrap: {
    flex: 1,
    backgroundColor: t.color.surface,
  },
  listContent: {
    padding: t.spacing.md,
    paddingBottom: t.spacing.xl,
    flexGrow: 1,
  },
  columnWrapper: {
    gap: t.spacing.sm,
    marginBottom: t.spacing.md,
  },
  cell: {
    alignItems: 'center',
  },
  tile: {
    borderRadius: t.radius.md,
    overflow: 'hidden',
    backgroundColor: t.color.surfaceAlt,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    backgroundColor: t.color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipContainer: {
    marginTop: t.spacing.xs,
    width: '100%',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.xl,
  },
  errorText: {
    color: t.color.textPrimary,
    ...t.typography.body,
    textAlign: 'center',
    marginBottom: t.spacing.md,
  },
  retryButton: {
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.sm,
  },
  retryButtonText: {
    color: t.color.textPrimary,
    ...t.typography.meta,
  },
  footerLoader: {
    paddingVertical: t.spacing.md,
    alignItems: 'center',
  },
  footerError: {
    paddingVertical: t.spacing.md,
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  footerErrorText: {
    color: t.color.textSecondary,
    ...t.typography.meta,
  },
}));
