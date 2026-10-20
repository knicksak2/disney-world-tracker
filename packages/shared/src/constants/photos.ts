export const PHOTO_TARGET_KINDS = ['food_log', 'trip'] as const;
export type PhotoTargetKind = (typeof PHOTO_TARGET_KINDS)[number];

export const PHOTO_STATUSES = [
  'uploading',
  'pending',
  'approved',
  'rejected',
  'needs_review',
  'hidden',
  'deleted',
] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

export const PHOTO_REJECT_REASONS = [
  'harm',
  'not_food',
  'face_visible',
  'too_much_text',
  'invalid_image',
] as const;
export type PhotoRejectReason = (typeof PHOTO_REJECT_REASONS)[number];

export const PHOTO_REPORT_REASONS = [
  'inappropriate',
  'shows_person',
  'not_food',
  'spam',
  'other',
] as const;
export type PhotoReportReason = (typeof PHOTO_REPORT_REASONS)[number];

export const PHOTO_FULL_LONG_EDGE_PX = 1280;
export const PHOTO_JPEG_QUALITY = 0.75;
export const PHOTO_FULL_JPEG_QUALITY = 0.75;
export const PHOTO_THUMB_LONG_EDGE_PX = 320;
export const PHOTO_THUMB_JPEG_QUALITY = 0.7;
export const PHOTO_CONTENT_TYPE = 'image/jpeg';
export const PHOTO_REPORT_NOTE_MAX = 300;
export const PHOTO_POST_CAPTION_MAX = 500;
export const PHOTO_MAX_DIMENSION_PX = 4096;
export const PHOTO_MAX_ITEMS_PER_INITIATE = 10;
export const PHOTO_PICKER_GUIDANCE = 'Frame just the dish. No people or text.';

export const PHOTO_STATUS_POLL_CADENCE_INITIAL_MS = 3000;
export const PHOTO_STATUS_POLL_CADENCE_FALLBACK_MS = 15000;
export const PHOTO_STATUS_POLL_INITIAL_WINDOW_MS = 60000;
export const PHOTO_GALLERY_STALE_TIME_MS = 30 * 60 * 1000;

export const PHOTO_DEFAULT_RECAP_HIGHLIGHT_MAX = 6;
export const PHOTO_RECAP_HIGHLIGHT_MIN = 1;
export const PHOTO_RECAP_HIGHLIGHT_MAX_LIMIT = 24;

export const PHOTO_REJECT_MESSAGES: Record<PhotoRejectReason, string> = {
  harm: "This photo can't be shared in the app.",
  not_food: "This doesn't look like a photo of food or a drink. Try framing just the dish.",
  face_visible: "Photo has a person's face in it. Try framing just the dish.",
  too_much_text: 'Photo has too much text in it. Try framing just the dish.',
  invalid_image: "We couldn't read this image. Try taking the photo again.",
};

export const PHOTO_UPLOADS_DISABLED_REASONS = ['kill_switch', 'global_cap'] as const;
export type PhotoUploadsDisabledReason = (typeof PHOTO_UPLOADS_DISABLED_REASONS)[number];

export const PHOTO_UPLOADS_DISABLED_MESSAGE_KILL_SWITCH = 'Photo uploads are turned off right now';
export const PHOTO_UPLOADS_DISABLED_MESSAGE_GLOBAL_CAP = 'Photo uploads are full for today, try again tomorrow';

export const PHOTO_UPLOADS_DISABLED_MESSAGES: Record<PhotoUploadsDisabledReason, string> = {
  kill_switch: PHOTO_UPLOADS_DISABLED_MESSAGE_KILL_SWITCH,
  global_cap: PHOTO_UPLOADS_DISABLED_MESSAGE_GLOBAL_CAP,
};

// Requirement 27 constants (task 1.5)
export const PHOTO_DEFAULT_EXPERIENCE_STRIP_MAX = 8;
export const PHOTO_EXPERIENCE_STRIP_MIN = 1;
export const PHOTO_EXPERIENCE_STRIP_MAX_LIMIT = 24;
export const PHOTO_EXPERIENCE_STRIP_MAX_DEFAULT = 8;
export const PHOTO_EXPERIENCE_STRIP_HEADING = 'Photos from guests';
export const PHOTO_STRIP_BLANK_DISH_LABEL = 'Dish';
