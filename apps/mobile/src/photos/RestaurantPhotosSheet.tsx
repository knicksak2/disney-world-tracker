import React from 'react';
import type { RestaurantFoodPhotoDTO } from '@dwt/shared';
import { useRestaurantFoodPhotos } from './api';
import { PhotoGallerySheet } from './PhotoGallerySheet';

export interface RestaurantPhotosSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly kind?: 'experience' | 'location';
  readonly id: string;
  readonly restaurantName: string;
  readonly onViewDish?: ((foodItemId: string) => void) | undefined;
}

/**
 * Full restaurant photo gallery sheet.
 *
 * Uses useRestaurantFoodPhotos(kind, id, { enabled: visible }) without limit (default 40).
 * Passes getLabel = (p) => p.foodItemName to show dish name on tiles and viewer.
 */
export function RestaurantPhotosSheet({
  visible,
  onClose,
  kind = 'experience',
  id,
  restaurantName,
  onViewDish,
}: RestaurantPhotosSheetProps): JSX.Element | null {
  const query = useRestaurantFoodPhotos(kind, id, { enabled: visible });

  return (
    <PhotoGallerySheet<RestaurantFoodPhotoDTO>
      visible={visible}
      onClose={onClose}
      title={restaurantName}
      emptyTitle="No photos yet"
      emptySubtitle={`Be the first to share a photo from ${restaurantName}!`}
      pages={query.data?.pages}
      fetchNextPage={query.fetchNextPage}
      hasNextPage={Boolean(query.hasNextPage)}
      isFetchingNextPage={query.isFetchingNextPage}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => {
        void query.refetch();
      }}
      getLabel={(p) => p.foodItemName}
      testID="restaurant-photos-sheet"
      {...(onViewDish ? { onViewDish } : {})}
    />
  );
}
