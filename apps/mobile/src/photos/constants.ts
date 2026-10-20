/** Food-photo guidance (Requirement 23.1). Food photos only; Trip photos never show it. */
export const PHOTO_PICKER_GUIDANCE = 'Frame just the dish. No people or text.';
/** Trip-photo guidance (Requirement 23.9, D4): Trip photos get only the harm check. */
export const PHOTO_TRIP_PICKER_GUIDANCE =
  'Share your favorite moments with your crew. People and text are welcome.';

export type PhotoPickerTarget = 'food' | 'trip';

export const PHOTO_PICKER_GUIDANCE_BY_TARGET: Readonly<Record<PhotoPickerTarget, string>> = {
  food: PHOTO_PICKER_GUIDANCE,
  trip: PHOTO_TRIP_PICKER_GUIDANCE,
};
export const PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? '';
export const PHOTOS_DISCLOSURE_VERSION = 1;
export const PHOTOS_DISCLOSURE_STORAGE_KEY = 'photos.disclosure.v1';
export const PHOTO_STRIP_BLANK_DISH_LABEL = 'Dish';
