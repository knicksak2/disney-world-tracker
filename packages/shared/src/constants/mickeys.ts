export const MICKEY_ZONES = [
  'exterior',
  'queue',
  'pre_show',
  'on_ride',
  'exit',
  'interior',
  'grounds',
] as const;
export type MickeyZone = (typeof MICKEY_ZONES)[number];

export const MICKEY_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type MickeyDifficulty = (typeof MICKEY_DIFFICULTIES)[number];

export const MICKEY_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'retired',
  'hidden',
] as const;
export type MickeyStatus = (typeof MICKEY_STATUSES)[number];

export const MICKEY_SOURCES = ['seed', 'user'] as const;
export type MickeySource = (typeof MICKEY_SOURCES)[number];

export const MICKEY_CONFIDENCE_LABELS = [
  'confirmed',
  'uncertain',
  'possibly_removed',
] as const;
export type MickeyConfidenceLabel = (typeof MICKEY_CONFIDENCE_LABELS)[number];

export const MICKEY_REPORT_REASONS = [
  'inappropriate',
  'not_a_mickey',
  'restricted_area',
  'spam',
  'other',
] as const;
export type MickeyReportReason = (typeof MICKEY_REPORT_REASONS)[number];

export const MICKEY_REPORT_REASON_LABELS: Record<MickeyReportReason, string> = {
  inappropriate: 'Inappropriate',
  not_a_mickey: 'Not a Mickey',
  restricted_area: 'Restricted Area',
  spam: 'Spam',
  other: 'Other',
};

export const MICKEY_REPORT_STATUSES = ['open', 'upheld', 'dismissed'] as const;
export type MickeyReportStatus = (typeof MICKEY_REPORT_STATUSES)[number];

export const MICKEY_SCOPES = ['all', 'official', 'community'] as const;
export type MickeyScope = (typeof MICKEY_SCOPES)[number];

export const MICKEY_FOUND_FILTERS = ['all', 'found', 'unfound'] as const;
export type MickeyFoundFilter = (typeof MICKEY_FOUND_FILTERS)[number];

export const MICKEY_AREA_TYPES = [
  'ThemePark',
  'WaterPark',
  'DisneySprings',
  'Resort',
] as const;
export type MickeyAreaType = (typeof MICKEY_AREA_TYPES)[number];

export const MICKEY_HINT_LEVELS = [1, 2, 3] as const;
export type MickeyHintLevel = (typeof MICKEY_HINT_LEVELS)[number];

export const MICKEY_CLUE1_MIN = 10;
export const MICKEY_CLUE1_MAX = 140;
export const MICKEY_CLUE2_MIN = 10;
export const MICKEY_CLUE2_MAX = 300;
export const MICKEY_REVEAL_MIN = 10;
export const MICKEY_REVEAL_MAX = 500;
export const MICKEY_NOTE_MAX = 300;
export const MICKEY_REVIEW_NOTE_MAX = 300;
export const MICKEY_LIST_DEFAULT_LIMIT = 50;
export const MICKEY_LIST_MAX_LIMIT = 100;
export const MICKEY_SEARCH_MIN = 2;
export const MICKEY_SEARCH_MAX = 60;
export const MICKEY_PHOTO_URL_MAX = 2048;
