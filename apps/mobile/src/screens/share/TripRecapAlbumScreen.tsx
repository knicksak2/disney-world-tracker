/**
 * TripRecapAlbumScreen — read-only album of every approved Trip photo behind a shared
 * recap (photo-uploads decision D35, Requirements 15.31 to 15.33).
 *
 * Reached from "View all photos" in the recap's recipient photo section. Loads
 * `GET /me/inbox/:shareId/trip-recap/photos` with cursor paging, groups by America/New_York
 * day, and opens the shared viewer whose only actions are Report and "Block" (both carry
 * the `shareId`). There is no delete, add, upload, edit, status or byline control here.
 */

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import type { SharedSummaryPhotoDTO } from '@dwt/shared';

import { ApiError } from '../../api/client';
import type { YouAndCrewStackParamList } from '../../navigation/YouAndCrewStack';
import { groupBySortAtNewYorkDay, type DayGroup } from '../../photos/dayGroups';
import { PhotoGrid, type PhotoGridItem } from '../../photos/PhotoGrid';
import { PhotoViewer, type PhotoViewerItem } from '../../photos/PhotoViewer';
import { useRecapAlbum } from '../../photos/api';
import { makeStyles } from '../../theme/makeStyles';
import {
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  RECAP_PHOTOS_NOT_INCLUDED_COPY,
  RECAP_UNAVAILABLE_COPY,
  tripRecapKeys,
} from './TripRecapScreen';

export const RECAP_ALBUM_EMPTY_COPY = 'No photos to show';
export const RECAP_ALBUM_MORE_ERROR_COPY = "Couldn't load more photos";

type Props = NativeStackScreenProps<YouAndCrewStackParamList, 'TripRecapAlbum'>;

interface AlbumTile extends PhotoGridItem {
  readonly photo: SharedSummaryPhotoDTO;
}

interface AlbumGroup {
  readonly group: DayGroup<SharedSummaryPhotoDTO>;
  readonly tiles: readonly AlbumTile[];
}

export default function TripRecapAlbumScreen({ navigation, route }: Props): JSX.Element {
  const { shareId, tripName } = route.params;
  const styles = useStyles();
  const t = useAppTheme();
  const queryClient = useQueryClient();

  const [activePhoto, setActivePhoto] = useState<SharedSummaryPhotoDTO | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useRecapAlbum(shareId);

  const photos = useMemo(() => data?.pages.flatMap((page) => page.photos) ?? [], [data]);
  const access = data?.pages[0]?.access;

  // Day groups with the position of each photo in the flattened list, so every tile reads
  // "Trip photo N of M, opens viewer" with N counted across days.
  const groups = useMemo<readonly AlbumGroup[]>(() => {
    const total = photos.length;
    let position = 0;
    return groupBySortAtNewYorkDay(photos).map((group) => ({
      group,
      tiles: group.photos.map((photo) => {
        position += 1;
        return {
          id: photo.id,
          thumbUrl: photo.thumbUrl,
          url: photo.url,
          accessibilityLabel: `Trip photo ${position} of ${total}, opens viewer`,
          photo,
        };
      }),
    }));
  }, [photos]);

  const goBack = (): void => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const header = (
    <GradientHeader
      title="All trip photos"
      {...(tripName ? { subtitle: tripName } : {})}
      icon="images-outline"
      compact
      onBack={goBack}
    />
  );

  const unavailable = (
    <View style={styles.center}>
      <Text
        style={styles.unavailableText}
        accessibilityRole="alert"
        testID="trip-recap-album-unavailable"
      >
        {RECAP_UNAVAILABLE_COPY}
      </Text>
    </View>
  );

  if (isLoading && data === undefined) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center} accessibilityRole="progressbar" testID="trip-recap-album-loading">
          <ActivityIndicator size="large" color={t.color.primaryFg} />
        </View>
      </ScreenContainer>
    );
  }

  if (isError && data === undefined) {
    // The route's collapsed answer (deleted share, unfriended sender) reads as "no longer
    // available", never as a failure to retry (R15.26, R15.33).
    const collapsed = error instanceof ApiError && error.code === 'validation_failed';
    return (
      <ScreenContainer>
        {header}
        {collapsed ? (
          unavailable
        ) : (
          <View style={styles.center} testID="trip-recap-album-error">
            <EmptyState
              icon="cloud-offline-outline"
              title="We couldn't load these photos"
              body="Check your connection and try again."
            />
            <PrimaryButton
              label="Retry"
              icon="refresh-outline"
              onPress={() => {
                void refetch();
              }}
              testID="trip-recap-album-retry"
              style={styles.retryBtn}
            />
          </View>
        )}
      </ScreenContainer>
    );
  }

  if (data === undefined) {
    return <ScreenContainer>{header}</ScreenContainer>;
  }

  if (access === 'unavailable') {
    return (
      <ScreenContainer>
        {header}
        {unavailable}
      </ScreenContainer>
    );
  }

  if (access === 'not_included') {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center}>
          <Text style={styles.noteText} testID="trip-recap-album-not-included">
            {RECAP_PHOTOS_NOT_INCLUDED_COPY}
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  if (photos.length === 0) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center}>
          <EmptyState
            icon="images-outline"
            title={RECAP_ALBUM_EMPTY_COPY}
            testID="trip-recap-album-empty"
          />
        </View>
      </ScreenContainer>
    );
  }

  const activeViewerItem: PhotoViewerItem | null = activePhoto
    ? {
        id: activePhoto.id,
        url: activePhoto.url,
        thumbUrl: activePhoto.thumbUrl,
        width: activePhoto.width,
        height: activePhoto.height,
      }
    : null;

  return (
    <ScreenContainer>
      {header}
      <FlatList
        data={groups}
        keyExtractor={(item) => item.group.dayKey}
        testID="trip-recap-album-list"
        contentContainerStyle={styles.listContent}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            void fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        extraData={t.scheme}
        ListFooterComponent={
          isFetchNextPageError ? (
            <View style={styles.footer} testID="trip-recap-album-more-error">
              <Text style={styles.noteText}>{RECAP_ALBUM_MORE_ERROR_COPY}</Text>
              <TouchableOpacity
                onPress={() => {
                  void fetchNextPage();
                }}
                style={styles.moreRetry}
                accessibilityRole="button"
                accessibilityLabel="Retry loading more photos"
                testID="trip-recap-album-more-retry"
              >
                <Text style={styles.moreRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : isFetchingNextPage ? (
            <View style={styles.footer} testID="trip-recap-album-paging-loader">
              <ActivityIndicator size="small" color={t.color.primaryFg} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.dayGroup} testID={`recap-album-day-group-${item.group.dayKey}`}>
            <View style={styles.dayHeader}>
              <Text
                style={styles.dayHeadingText}
                accessibilityRole="header"
                testID={`recap-album-day-heading-${item.group.dayKey}`}
              >
                {item.group.dayHeading}
              </Text>
              <Text style={styles.dayCountText}>
                {item.tiles.length} photo{item.tiles.length === 1 ? '' : 's'}
              </Text>
            </View>
            <PhotoGrid
              photos={item.tiles}
              testID={`recap-album-grid-${item.group.dayKey}`}
              onSelectPhoto={(tile) => setActivePhoto(tile.photo)}
            />
          </View>
        )}
      />

      <PhotoViewer
        visible={activePhoto !== null}
        photo={activeViewerItem}
        shareId={shareId}
        canDelete={false}
        onClose={() => setActivePhoto(null)}
        onBlocked={() => {
          void queryClient.invalidateQueries({ queryKey: tripRecapKeys.recap(shareId) });
        }}
      />
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.xl,
  },
  unavailableText: {
    ...t.typography.subtitle,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  noteText: {
    ...t.typography.body,
    color: t.color.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: t.spacing.md,
  },
  listContent: {
    paddingBottom: t.spacing.xxl,
  },
  dayGroup: {
    marginTop: t.spacing.lg,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: t.spacing.sm,
    marginHorizontal: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  dayHeadingText: {
    ...t.typography.heading,
    color: t.color.textPrimary,
    fontWeight: '700',
  },
  dayCountText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
  },
  footer: {
    paddingVertical: t.spacing.lg,
    alignItems: 'center',
    gap: t.spacing.sm,
  },
  moreRetry: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.primaryFg,
  },
  moreRetryText: {
    ...t.typography.meta,
    color: t.color.primaryFg,
  },
}));
