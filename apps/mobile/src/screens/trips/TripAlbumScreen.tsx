import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { TripMemberDTO, TripPhotoDTO } from '@dwt/shared';

import { apiRequest } from '../../api/client';
import type { TripsStackParamList } from '../../navigation/TripsStack';
import { makeStyles } from '../../theme/makeStyles';
import { useAppTheme } from '../../theme/useAppTheme';
import {
  EmptyState,
  GradientHeader,
  PrimaryButton,
  ScreenContainer,
} from '../../theme/components';
import {
  getUploadErrorMessage,
  usePhotoConfig,
  usePhotoStatuses,
  useTripAlbum,
  useUploadPhotos,
} from '../../photos/api';
import {
  formatNewYorkDayHeading,
  getNewYorkDayKey,
  groupBySortAtNewYorkDay,
} from '../../photos/dayGroups';
import { isFinalPhotoStatus } from '../../photos/pollPlan';
import { PhotoStatusChip } from '../../photos/PhotoStatusChip';
import { PhotoViewer, type PhotoViewerItem } from '../../photos/PhotoViewer';
import { PhotoPickerSheet } from '../../photos/PhotoPickerSheet';
import type { PreparedImages } from '../../photos/imagePrep';

export const ALBUM_NOTICE_STORAGE_KEY = 'photos.albumNotice.v1';

// The day helpers live in photos/dayGroups so the recipient Recap Album groups identically.
export { getNewYorkDayKey, formatNewYorkDayHeading };

export interface DayGroupedPhotos {
  readonly dayKey: string;
  readonly dayHeading: string;
  readonly photos: readonly TripPhotoDTO[];
}

export function groupPhotosByNewYorkDay(
  photos: readonly TripPhotoDTO[]
): readonly DayGroupedPhotos[] {
  return groupBySortAtNewYorkDay(photos);
}

type Props = NativeStackScreenProps<TripsStackParamList, 'TripAlbum'>;

export default function TripAlbumScreen({ navigation, route }: Props): JSX.Element {
  const { tripId } = route.params;
  const styles = useStyles();
  const t = useAppTheme();

  const [activePhoto, setActivePhoto] = useState<TripPhotoDTO | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState<boolean | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Load config & membership
  const configQuery = usePhotoConfig();
  const config = configQuery.data;

  const meQuery = useQuery<{ user: { id: string } }>({
    queryKey: ['me'],
    queryFn: () => apiRequest<{ user: { id: string } }>('GET', '/me'),
    staleTime: 60 * 1000,
  });

  const membersQuery = useQuery<readonly TripMemberDTO[]>({
    queryKey: ['trip-members', tripId],
    queryFn: () => apiRequest<readonly TripMemberDTO[]>('GET', `/trips/${tripId}/members`),
    staleTime: 30 * 1000,
  });

  const callerId = meQuery.data?.user?.id;
  const isOrganizer = Boolean(
    callerId &&
      membersQuery.data?.some(
        (m) => m.userId === callerId && m.role === 'organizer'
      )
  );

  // Album photos query with infinite pagination
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useTripAlbum(tripId);

  const uploadPhotosMutation = useUploadPhotos();

  // Load crew notice dismissal state
  useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem(ALBUM_NOTICE_STORAGE_KEY).then((val) => {
      if (isMounted) {
        setNoticeDismissed(val !== null);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleDismissNotice = async () => {
    await AsyncStorage.setItem(ALBUM_NOTICE_STORAGE_KEY, 'dismissed');
    setNoticeDismissed(true);
  };

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Flatten infinite query pages
  const photos = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) ?? [];
  }, [data]);

  // The Album shows the caller's own non-approved photos with their status (Requirement
  // 13.5). Poll those through the batched status route (Requirement 23.4) so a Checking chip
  // turns into Approved/Rejected and the image appears without leaving the screen: on a
  // final status the hook invalidates the Album and recap photos queries, which refetches
  // the Album. Other members' photos are never pending here and are not pollable.
  const pendingOwnPhotoIds = useMemo(
    () => photos.filter((p) => p.mine && !isFinalPhotoStatus(p.status)).map((p) => p.id),
    [photos],
  );
  usePhotoStatuses(pendingOwnPhotoIds);

  // Group photos by America/New_York day
  const dayGroups = useMemo(() => {
    return groupPhotosByNewYorkDay(photos);
  }, [photos]);

  const canUpload =
    config?.enabled !== false &&
    config?.tripEnabled !== false;

  const handleUploadBatch = async (
    items: readonly { prepared: PreparedImages; takenAt?: string }[]
  ) => {
    setUploadError(null);
    try {
      await uploadPhotosMutation.mutateAsync({
        target: { kind: 'trip', id: tripId },
        items,
      });
      setIsPickerOpen(false);
      void refetch();
    } catch (err: unknown) {
      setUploadError(getUploadErrorMessage(err));
    }
  };

  const activeViewerItem: PhotoViewerItem | null = activePhoto
    ? {
        id: activePhoto.id,
        url: activePhoto.url,
        thumbUrl: activePhoto.thumbUrl,
        width: activePhoto.width,
        height: activePhoto.height,
        uploader: activePhoto.uploader,
        mine: activePhoto.mine,
      }
    : null;

  return (
    <ScreenContainer>
      <GradientHeader
        title="Trip Album"
        icon="images-outline"
        compact
        onBack={handleBack}
      />

      <View style={styles.container}>
        {/* Upload error banner */}
        {uploadError ? (
          <View style={styles.errorBanner} testID="album-upload-error">
            <Ionicons name="alert-circle" size={18} color={t.color.danger} />
            <Text style={styles.errorText}>{uploadError}</Text>
            <TouchableOpacity
              onPress={() => setUploadError(null)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
            >
              <Ionicons name="close" size={18} color={t.color.danger} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Crew notice (dismissible one-time notice in AsyncStorage) */}
        {noticeDismissed === false ? (
          <View style={styles.noticeBanner} testID="album-crew-notice">
            <Ionicons name="information-circle-outline" size={20} color={t.color.primaryFg} />
            <Text style={styles.noticeText}>
              Any trip member can share the trip recap with friends, it can include photos from everyone on the trip, deleting a photo removes it everywhere.
            </Text>
            <TouchableOpacity
              onPress={handleDismissNotice}
              style={styles.noticeDismissButton}
              testID="dismiss-album-notice-btn"
              accessibilityRole="button"
              accessibilityLabel="Dismiss crew notice"
            >
              <Ionicons name="close" size={18} color={t.color.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Action bar: Add photos button & remaining quota */}
        {canUpload ? (
          <View style={styles.toolbar}>
            <PrimaryButton
              label="Add photos"
              icon="camera-outline"
              onPress={() => {
                setUploadError(null);
                setIsPickerOpen(true);
              }}
              testID="add-trip-photos-btn"
              style={styles.addPhotosButton}
            />
            {typeof config?.remainingToday === 'number' ? (
              <Text style={styles.quotaText} testID="album-daily-quota">
                {config.remainingToday} upload{config.remainingToday === 1 ? '' : 's'} left today
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Main photo list */}
        {isLoading && photos.length === 0 ? (
          <View style={styles.center} testID="trip-album-loading">
            <ActivityIndicator size="large" color={t.color.primaryFg} />
          </View>
        ) : photos.length === 0 ? (
          <View style={styles.center} testID="trip-album-empty">
            <EmptyState
              icon="images-outline"
              title="No photos yet"
              body="Photos uploaded to this trip or shared in the feed will appear here."
            />
          </View>
        ) : (
          <FlatList
            data={dayGroups}
            keyExtractor={(item) => item.dayKey}
            testID="trip-album-list"
            contentContainerStyle={styles.listContent}
            onEndReached={() => {
              if (hasNextPage && !isFetchingNextPage) {
                void fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
              isFetchingNextPage ? (
                <View style={styles.footerLoader} testID="album-paging-loader">
                  <ActivityIndicator size="small" color={t.color.primaryFg} />
                </View>
              ) : null
            }
            renderItem={({ item: group }) => (
              <View
                style={styles.dayGroup}
                testID={`album-day-group-${group.dayKey}`}
              >
                <View style={styles.dayHeader}>
                  <Text
                    style={styles.dayHeadingText}
                    testID={`album-day-heading-${group.dayKey}`}
                  >
                    {group.dayHeading}
                  </Text>
                  <Text style={styles.dayCountText}>
                    {group.photos.length} photo{group.photos.length === 1 ? '' : 's'}
                  </Text>
                </View>

                <View style={styles.photoGrid}>
                  {group.photos.map((photo) => {
                    const thumbUri = photo.thumbUrl || photo.url;
                    return (
                      <Pressable
                        key={photo.id}
                        onPress={() => setActivePhoto(photo)}
                        style={styles.photoTile}
                        testID={`album-photo-tile-${photo.id}`}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={`Photo by ${photo.uploader.displayName}`}
                      >
                        {thumbUri ? (
                          <Image
                            source={{ uri: thumbUri }}
                            style={styles.photoImage}
                            resizeMode="cover"
                            accessibilityRole="image"
                            accessibilityLabel={`Photo by ${photo.uploader.displayName}`}
                          />
                        ) : (
                          <View style={styles.photoPlaceholder}>
                            <Ionicons
                              name="image-outline"
                              size={28}
                              color={t.color.textSecondary}
                            />
                          </View>
                        )}

                        {photo.mine ? (
                          <View style={styles.statusChipOverlay}>
                            <PhotoStatusChip
                              status={photo.status}
                              testID={`album-photo-status-${photo.id}`}
                            />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          />
        )}
      </View>

      {/* Viewer Modal */}
      <PhotoViewer
        visible={Boolean(activePhoto)}
        photo={activeViewerItem}
        canDelete={isOrganizer}
        onClose={() => setActivePhoto(null)}
        onDeleted={() => {
          setActivePhoto(null);
          void refetch();
        }}
      />

      {/* Photo Picker Sheet */}
      <PhotoPickerSheet
        visible={isPickerOpen}
        target="trip"
        title="Add Trip Photos"
        allowsMultipleSelection
        maxSelection={config?.maxBatch ?? 10}
        onClose={() => setIsPickerOpen(false)}
        onConfirmBatch={handleUploadBatch}
      />
    </ScreenContainer>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.color.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: t.spacing.xl,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    backgroundColor: t.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
  },
  addPhotosButton: {
    paddingHorizontal: t.spacing.lg,
  },
  quotaText: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    borderLeftWidth: 4,
    borderLeftColor: t.color.primary,
    padding: t.spacing.md,
    marginHorizontal: t.spacing.md,
    marginTop: t.spacing.md,
    borderRadius: t.radius.sm,
    gap: t.spacing.sm,
  },
  noticeText: {
    ...t.typography.meta,
    color: t.color.textPrimary,
    flex: 1,
    lineHeight: 18,
  },
  noticeDismissButton: {
    padding: t.spacing.xs,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.danger,
    padding: t.spacing.sm,
    marginHorizontal: t.spacing.md,
    marginTop: t.spacing.sm,
    borderRadius: t.radius.sm,
    gap: t.spacing.xs,
  },
  errorText: {
    ...t.typography.meta,
    color: t.color.danger,
    flex: 1,
  },
  listContent: {
    paddingBottom: t.spacing.xxl,
  },
  dayGroup: {
    marginTop: t.spacing.lg,
    paddingHorizontal: t.spacing.md,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.color.border,
    marginBottom: t.spacing.sm,
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
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.xs,
  },
  photoTile: {
    width: '32%',
    aspectRatio: 1,
    borderRadius: t.radius.sm,
    overflow: 'hidden',
    backgroundColor: t.color.surfaceAlt,
    position: 'relative',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.surfaceAlt,
  },
  statusChipOverlay: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
  },
  footerLoader: {
    paddingVertical: t.spacing.lg,
    alignItems: 'center',
  },
}));
