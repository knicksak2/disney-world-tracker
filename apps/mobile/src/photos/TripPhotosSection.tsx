import React, { useState } from 'react';
import {
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SharedSummaryPhotoDTO } from '@dwt/shared';

import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';
import { usePhotoConfig, useTripSummaryPhotos } from './api';
import { PhotoViewer, type PhotoViewerItem } from './PhotoViewer';

export type TripPhotosSectionProps =
  | {
      readonly mode: 'member';
      readonly tripId: string;
      /** Opens the trip album. Member mode only; the recipient mode has no album (R16.8). */
      readonly onNavigateToAlbum: () => void;
    }
  | {
      readonly mode: 'recipient';
      readonly photos: readonly SharedSummaryPhotoDTO[];
      readonly shareId: string;
      /** Opens the read-only recipient album ("View all photos", photo-uploads R15.31, D35). */
      readonly onViewAll?: (() => void) | undefined;
    };

export function TripPhotosSection(props: TripPhotosSectionProps): JSX.Element | null {
  const styles = useStyles();
  const t = useAppTheme();

  const [selectedPhoto, setSelectedPhoto] = useState<PhotoViewerItem | null>(null);

  const isMember = props.mode === 'member';

  // Config check for member mode
  const {
    data: config,
    isLoading: isConfigLoading,
    isError: isConfigError,
  } = usePhotoConfig(isMember);
  const isPhotosGloballyEnabled = Boolean(config?.enabled);

  // Highlights query for member mode
  const tripId = isMember ? props.tripId : '';
  const shouldFetchMemberPhotos = isMember && isPhotosGloballyEnabled && !isConfigLoading && !isConfigError;
  const { data: memberPhotos } = useTripSummaryPhotos(tripId, shouldFetchMemberPhotos);

  // If member mode and config is loading/failing or disabled, render nothing
  if (isMember && (isConfigLoading || isConfigError || !isPhotosGloballyEnabled)) {
    return null;
  }

  // Determine active photos list
  const photos: readonly SharedSummaryPhotoDTO[] = isMember
    ? (memberPhotos ?? [])
    : props.photos;

  // If no photos, render nothing (no heading, no action)
  if (photos.length === 0) {
    return null;
  }

  const handleOpenPhoto = (photo: SharedSummaryPhotoDTO) => {
    setSelectedPhoto({
      id: photo.id,
      url: photo.url,
      thumbUrl: photo.thumbUrl,
      width: photo.width,
      height: photo.height,
      mine: isMember ? Boolean(photo.mine) : false,
    });
  };

  const handleNavigateToAlbum = () => {
    if (props.mode === 'member') {
      props.onNavigateToAlbum();
    }
  };

  return (
    <View style={styles.sectionContainer} testID="trip-photos-section">
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Ionicons name="images-outline" size={20} color={t.color.primaryFg} />
          <Text
            style={styles.sectionTitle}
            accessibilityRole="header"
            testID="trip-photos-heading"
          >
            Trip Photos
          </Text>
        </View>

        {isMember ? (
          <TouchableOpacity
            onPress={handleNavigateToAlbum}
            style={styles.albumLink}
            accessibilityRole="button"
            accessibilityLabel="View all in album"
            testID="view-all-in-album-btn"
          >
            <Text style={styles.albumLinkText}>View all in album</Text>
            <Ionicons name="chevron-forward" size={16} color={t.color.primaryFg} />
          </TouchableOpacity>
        ) : props.onViewAll ? (
          <TouchableOpacity
            onPress={props.onViewAll}
            style={styles.albumLink}
            accessibilityRole="button"
            accessibilityLabel="View all photos"
            testID="view-all-photos-btn"
          >
            <Text style={styles.albumLinkText}>View all photos</Text>
            <Ionicons name="chevron-forward" size={16} color={t.color.primaryFg} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stripContent}
        testID="trip-photos-strip"
      >
        {photos.map((photo, index) => (
          <TouchableOpacity
            key={photo.id}
            onPress={() => handleOpenPhoto(photo)}
            style={styles.thumbnailWrapper}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Trip photo ${index + 1}, opens viewer`}
            testID={`trip-photo-highlight-${photo.id}`}
          >
            <Image
              source={{ uri: photo.thumbUrl || photo.url }}
              style={styles.thumbnailImage}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <PhotoViewer
        visible={selectedPhoto !== null}
        photo={selectedPhoto}
        shareId={!isMember ? props.shareId : undefined}
        canDelete={false}
        onClose={() => setSelectedPhoto(null)}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  sectionContainer: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing.md,
    marginVertical: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: t.spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  sectionTitle: {
    ...t.typography.subtitle,
    color: t.color.textPrimary,
  },
  albumLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  albumLinkText: {
    ...t.typography.meta,
    color: t.color.primaryFg,
  },
  stripContent: {
    flexDirection: 'row',
    gap: t.spacing.sm,
    paddingVertical: t.spacing.xs,
  },
  thumbnailWrapper: {
    width: 96,
    height: 96,
    borderRadius: t.radius.md,
    overflow: 'hidden',
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
}));
