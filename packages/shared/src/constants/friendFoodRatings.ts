/**
 * Configuration and constants for the Friend Food Ratings feature.
 *
 * Governs defaults, pagination bounds, debounce timings, and sort vocabulary
 * for friend-scoped food ratings and inline social proof.
 */

export const FRIEND_FOOD_PAGE_SIZE_DEFAULT = 20;
export const FRIEND_FOOD_PAGE_SIZE_MAX = 50;

export const FRIEND_FOOD_HIGHLIGHT_COUNT = 5;
export const FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS = 1;

export const FRIEND_FOOD_SEARCH_MAX_LENGTH = 100;
export const FRIEND_FOOD_SEARCH_DEBOUNCE_MS = 300;

export const FRIEND_FOOD_SCOPES_MAX = 200;

export const FRIEND_FOOD_INLINE_MAX_FRIENDS = 3;
export const FRIEND_FOOD_BATCH_MAX_ROWS = 5000;

export const FRIEND_FOOD_SORTS = ['highest_rated', 'recent', 'most_logged'] as const;
