import type { RestaurantFoodPhotoDTO } from '@dwt/shared';
import { PHOTO_STRIP_BLANK_DISH_LABEL } from './constants';

export interface ExperiencePhotoStripItem {
  readonly photoId: string;
  readonly foodItemId: string;
  readonly label: string;
  readonly thumbUrl: string;
  readonly photo: RestaurantFoodPhotoDTO;
}

export interface ExperiencePhotoStripModel {
  readonly visible: boolean;
  readonly items: readonly ExperiencePhotoStripItem[];
}

/**
 * Pure model builder for the Experience "Photos from guests" photo strip.
 *
 * Requirements:
 * - Keeps the input order verbatim.
 * - Takes at most `max` items (from the front).
 * - Sets label to trimmed `foodItemName`, falling back to 'Dish' when empty/whitespace.
 * - visible is true iff items.length > 0 (and max > 0).
 * - Never mutates input array or its items.
 */
export function buildStripModel(
  items: ReadonlyArray<RestaurantFoodPhotoDTO>,
  max: number
): ExperiencePhotoStripModel {
  if (max <= 0 || items.length === 0) {
    return {
      visible: false,
      items: [],
    };
  }

  const capped = items.slice(0, max);
  const mapped: ExperiencePhotoStripItem[] = capped.map((photo) => {
    const trimmed = photo.foodItemName ? photo.foodItemName.trim() : '';
    const label = trimmed.length > 0 ? trimmed : PHOTO_STRIP_BLANK_DISH_LABEL;
    return {
      photoId: photo.id,
      foodItemId: photo.foodItemId,
      label,
      thumbUrl: photo.thumbUrl,
      photo,
    };
  });

  return {
    visible: mapped.length > 0,
    items: mapped,
  };
}
