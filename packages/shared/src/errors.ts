/**
 * Shared error code catalog and uniform JSON error envelope.
 *
 * Mirrors the design's "Error Handling" section: every API error from the
 * backend is serialized as a single envelope shape, and every error code is
 * drawn from the closed `ErrorCode` union below. The `errorCodeToHttpStatus`
 * map mirrors the HTTP column from the design's error catalog table so a
 * single Fastify error hook can translate a domain error into the correct
 * status code without inline switch statements scattered across handlers.
 *
 * Validates:
 *   Requirements R1.13, R1.24, R2.6-R2.8, R4.7-R4.8, R5.7, R5.10,
 *                R6.3-R6.10, R7.6-R7.8, R8.2, R8.7-R8.11, R9.2-R9.3
 */

// ---------------------------------------------------------------------------
// ErrorCode
// ---------------------------------------------------------------------------
//
// The full closed set of `code` values that may appear in an `ErrorEnvelope`.
// Grouped by domain to mirror the design's catalog table; the runtime tuple
// is the source of truth, the union type is derived from it so it cannot
// drift.

export const ERROR_CODES = [
  // -- Auth (R6.3-R6.10) -------------------------------------------------
  'email_in_use',
  'validation_failed',
  'invalid_credentials',
  'account_locked',
  'unauthorized',

  // -- Catalog (R1.13, R1.24) -------------------------------------------
  'catalog_unavailable',
  'stale_cache',

  // -- Live experience details (R2.8, R3.2) -----------------------------
  'live_unavailable',

  // -- Tracking: completions (R2.6-R2.8) --------------------------------
  'completion_future_date',
  'completion_not_found',
  'completion_combined_op_not_allowed',

  // -- Tracking: ratings (R4.7-R4.8) ------------------------------------
  'rating_out_of_range',
  'rating_not_found',

  // -- Tracking: notes (R5.7, R5.10) ------------------------------------
  'note_length_invalid',
  'note_not_found',

  // -- Tracking: experience logs (experience-activity-logging R5.1) -----
  // `log_not_found`: a delete targeted an Experience_Log id that does not
  // exist for the authenticated User. A log owned by another User collapses
  // to this same non-probing response (the delete is scoped by user_id).
  'log_not_found',

  // `log_future_date`: a create targeted a `visited_on` calendar date strictly
  // later than today in the request's `user_tz`. A visit cannot be recorded for
  // a date that has not yet occurred (experience-activity-logging R1.5).
  'log_future_date',

  // -- Profile (R7.6-R7.8) ----------------------------------------------
  'display_name_invalid',
  'avatar_invalid',
  'profile_forbidden',

  // -- Friends (R8.2, R8.7-R8.11) ---------------------------------------
  'search_query_length_invalid',
  'friend_self_target',
  'friend_duplicate_relationship',
  'friend_recipient_unknown',
  'friendship_not_found',

  // -- Sharing (R9.2-R9.3) ----------------------------------------------
  'share_recipient_count_invalid',
  'share_atomic_rejected',

  // -- Push registration (R8.7) -----------------------------------------
  // Raised by the Push_Registration_Service when a device id / push token is
  // malformed; counts as a registration failure the client retries a bounded
  // number of times before continuing without a registration.
  'push_registration_invalid',

  // -- Reactions (R11.3, R11.8) -----------------------------------------
  // `reaction_invalid`: the reaction value is outside the closed
  // `Reaction_Vocabulary`. `reaction_forbidden`: the caller is reacting to a
  // Share that was not delivered to them (no `share_recipients` row).
  'reaction_invalid',
  'reaction_forbidden',

  // -- Stats (expanded-stats R7.8, R7.9, R8.6, R9.6, R11.3) -------------
  // `stats_unavailable`: the REPEATABLE READ READ ONLY snapshot transaction
  // failed to begin/commit or was aborted before the per-user statistics
  // were computed; no partial or precomputed statistics are returned.
  // `stats_timeout`: the stats computation exceeded its SLA-sized statement
  // timeout and the request was aborted with no partial statistics.
  // `stats_target_not_found`: a friend-view request targeted a user id that
  // does not exist; denied before any statistics read.
  'stats_unavailable',
  'stats_timeout',
  'stats_target_not_found',

  // -- Trips (trips R3.3, R3.9, R6.2, R6.4, R6.5, R7.5, R9.5, R11.8, R15.2)
  // `trip_not_found`: owner-side not-found for an edit/delete of a genuinely
  // absent Trip/invite/tag surfaced to an authorized-context caller (non-
  // probing). `trip_forbidden`: caller is not a Member / not an Organizer /
  // not the addressee; a non-existent Trip and an inaccessible Trip collapse
  // to this same response so existence cannot be probed.
  // `trip_validation_failed`: name/description/date/planned/tag/comment
  // validation failed. `trip_not_friend`: invite target is not a Friend of
  // the organizer. `trip_invite_duplicate`: target is already a Member or has
  // a pending invite. `trip_invite_state_invalid`: accept/decline/cancel of a
  // non-pending invite. `trip_last_organizer`: demote/leave/remove would
  // leave zero organizers. `trip_role_invalid`: promote an organizer / demote
  // a member (no-op change). `trip_planned_limit`: Planned_List already holds
  // 500 items. `trip_tag_state_invalid`: confirm/decline of a non-pending
  // rode-with tag.
  'trip_not_found',
  'trip_forbidden',
  'trip_validation_failed',
  'trip_not_friend',
  'trip_invite_duplicate',
  'trip_invite_state_invalid',
  'trip_last_organizer',
  'trip_role_invalid',
  'trip_planned_limit',
  'trip_tag_state_invalid',
  'trip_food_list_ineligible',
  'trip_food_list_not_found',
  'trip_experience_list_ineligible',

  // -- Pins (pin-collection R20.4, R24.5, R24.11) ----------------------
  // `pin_not_eligible`: `POST /me/pins/:pinId/claim` targeted a Pin with no
  // existing `user_pins` row — i.e. the Pin has not been awarded yet.
  // Claiming an already-claimed Pin is NOT this error; it is a no-op that
  // returns the existing `claimedAt` with `200`.
  'pin_not_eligible',
  'showcase_full',
  'showcase_position_overlap',

  // -- Food item logging (food-item-logging R1-R6) ----------------------
  // `food_item_not_found`: a log/delete targeted a food_item_id that does not
  // exist. `food_item_duplicate`: a user-submitted name case-insensitively
  // matched an existing Food_Item for that restaurant or location; the response
  // includes the existing item's id so the client can use it instead of retrying.
  // `food_log_not_found`: a delete targeted a Food_Item_Log id that does not
  // exist for the authenticated User (or belongs to another User/food item) —
  // collapsed to one non-probing response, mirroring `log_not_found`.
  // `food_log_future_date`: `visited_on` is strictly later than today in the
  // request's `user_tz`, mirroring `log_future_date`.
  // `location_duplicate`: a submitted User_Submitted_Location name
  // case-insensitively matched an existing one in the same park; the response
  // includes the existing location's id (Requirement 6.4). Note this is
  // distinct from the advisory similarity-suggest step (Requirement 6.2, 6.3),
  // which never rejects — this code is the hard exact-match backstop only.
  'food_item_not_found',
  'food_item_duplicate',
  'food_log_not_found',
  'food_log_future_date',
  'location_duplicate',

  // -- Food lists (food-lists R1-R11) -------------------------------------
  // `food_list_not_found`: a mutation/read targeted a Food_List the caller
  // has NO access to at all — non-existent, or private with no share of
  // either role. Owner-only actions (rename/delete/visibility/manage-shares)
  // also collapse a non-owner's attempt to this same response so ownership
  // cannot be probed.
  // `food_list_edit_forbidden`: the caller CAN view the list (public, or a
  // viewer-role share) but attempted a mutation requiring edit access (item
  // add/remove/reorder) or an owner-only share-management action while
  // holding only editor access — distinct from `food_list_not_found` because
  // the caller already knows the list exists.
  // `food_list_item_duplicate`: an add targeted a foodItemId already in
  // the list. `food_list_reorder_mismatch`: a reorder's id set didn't
  // exactly match the list's current items. `food_list_stale_write`: a
  // reorder's `expectedVersion` didn't match the list's current `version`
  // (a concurrent editor's add/remove/reorder landed first).
  // `food_list_share_not_friend`: a share target is not a Friend of the
  // owner. `food_list_save_self`: a User attempted to save their own list.
  'food_list_not_found',
  'food_list_edit_forbidden',
  'food_list_item_duplicate',
  'food_list_reorder_mismatch',
  'food_list_stale_write',
  'food_list_share_not_friend',
  'food_list_save_self',
  'food_list_pin_limit_reached',

  // -- Experience lists (experience-lists R1-R9) -------------------------
  // `experience_list_not_found`: a mutation/read targeted an Experience_List
  // the caller has NO access to at all — non-existent, or private with no
  // share of either role. Owner-only actions (rename/delete/visibility/
  // manage-shares) also collapse a non-owner's attempt to this same
  // response so ownership cannot be probed. Mirrors `food_list_not_found`.
  // `experience_list_edit_forbidden`: the caller CAN view the list (public,
  // or a viewer-role share) but attempted a mutation requiring edit access
  // (item add/remove/reorder) or an owner-only share-management action
  // while holding only editor access.
  // `experience_list_item_duplicate`: an add targeted an experienceId
  // already in the list. `experience_not_found`: an add's `experienceId`
  // does not reference an existing, active Experience (Requirement 2.3) —
  // distinct from `experience_list_*` codes since it's a Catalog lookup
  // failure, not a list-access failure. `experience_list_dining_ineligible`:
  // an add targeted an Experience whose `category` is `Restaurant` — dining
  // stays exclusively in `Food_List`'s domain; checked before the duplicate
  // check (and after the `experience_not_found` check).
  // `experience_list_reorder_mismatch`: a reorder's id set didn't exactly
  // match the list's current items. `experience_list_stale_write`: a
  // reorder's `expectedVersion` didn't match the list's current `version`
  // (a concurrent editor's add/remove/reorder landed first).
  // `experience_list_share_not_friend`: a share target is not a Friend of
  // the owner. `experience_list_save_self`: a User attempted to save their
  // own list.
  'experience_list_not_found',
  'experience_list_edit_forbidden',
  'experience_list_item_duplicate',
  'experience_not_found',
  'experience_list_dining_ineligible',
  'experience_list_reorder_mismatch',
  'experience_list_stale_write',
  'experience_list_share_not_friend',
  'experience_list_save_self',
  'experience_list_pin_limit_reached',

  // -- Edge / gateway (defense-in-depth, R6.7) --------------------------
  // Emitted by the gateway-level rate limiter (task 13.3) when a caller
  // exceeds the configured request budget for read, mutation, or
  // account-keyed login windows. Surfaced via the same uniform envelope
  // shape as the rest of the API so clients have a single error contract.
  'rate_limit_exceeded',

  // -- Admin panel (admin-panel R3.6, R5.5, R12.3) -----------------------
  'admin_experience_not_found',
  'admin_user_not_found',
  'admin_sync_already_running',

  // -- Catch-all --------------------------------------------------------
  // Used by the global Fastify error hook for unhandled exceptions; the
  // client never sees a raw stack or constraint name.
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// ErrorEnvelope
// ---------------------------------------------------------------------------
//
// Uniform JSON envelope returned by every error response:
//
//   {
//     "error": {
//       "code": "snake_case_code",
//       "message": "human-readable message",
//       "field": "optional, when validation pinpoints a field",
//       "details": { }
//     }
//   }
//
// `field` is present only when the error pinpoints a single input field
// (typically with `validation_failed`). `details` is an open-ended record so
// individual handlers can attach structured context (e.g. a lockout's
// `retryAfterSeconds`) without breaking the envelope shape. Both fields are
// optional.

export interface ErrorEnvelopeBody {
  readonly code: ErrorCode;
  readonly message: string;
  readonly field?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ErrorEnvelope {
  readonly error: ErrorEnvelopeBody;
}

// ---------------------------------------------------------------------------
// errorCodeToHttpStatus
// ---------------------------------------------------------------------------
//
// HTTP status code per error code, mirroring the design's catalog HTTP
// column. `stale_cache` is intentionally `200`: per the design, a stale
// catalog read is delivered in a successful response with `staleCache: true`
// in the body, not as an HTTP error (R1.13). It is kept in the catalog so
// the same code identifier can be referenced uniformly from logs, metrics,
// and shared types.

export const errorCodeToHttpStatus: { readonly [K in ErrorCode]: number } = {
  // Auth
  email_in_use: 409,
  validation_failed: 400,
  invalid_credentials: 401,
  account_locked: 423,
  unauthorized: 401,

  // Catalog
  catalog_unavailable: 503,
  stale_cache: 200,

  // Live experience details
  live_unavailable: 503,

  // Tracking: completions
  completion_future_date: 400,
  completion_not_found: 404,
  completion_combined_op_not_allowed: 400,

  // Tracking: ratings
  rating_out_of_range: 400,
  rating_not_found: 404,

  // Tracking: notes
  note_length_invalid: 400,
  note_not_found: 404,

  // Tracking: experience logs
  log_not_found: 404,
  log_future_date: 400,

  // Profile
  display_name_invalid: 400,
  avatar_invalid: 400,
  profile_forbidden: 403,

  // Friends
  search_query_length_invalid: 400,
  friend_self_target: 400,
  friend_duplicate_relationship: 409,
  friend_recipient_unknown: 400,
  friendship_not_found: 404,

  // Sharing
  share_recipient_count_invalid: 400,
  share_atomic_rejected: 403,

  // Push registration
  push_registration_invalid: 400,

  // Reactions
  reaction_invalid: 400,
  reaction_forbidden: 403,

  // Stats
  stats_unavailable: 503,
  stats_timeout: 504,
  stats_target_not_found: 404,

  // Trips
  trip_not_found: 404,
  trip_forbidden: 403,
  trip_validation_failed: 400,
  trip_not_friend: 400,
  trip_invite_duplicate: 409,
  trip_invite_state_invalid: 409,
  trip_last_organizer: 409,
  trip_role_invalid: 400,
  trip_planned_limit: 400,
  trip_tag_state_invalid: 409,
  trip_food_list_ineligible: 403,
  trip_food_list_not_found: 404,
  trip_experience_list_ineligible: 403,

  // Pins
  pin_not_eligible: 409,
  showcase_full: 409,
  showcase_position_overlap: 409,

  // Food item logging
  food_item_not_found: 404,
  food_item_duplicate: 409,
  food_log_not_found: 404,
  food_log_future_date: 400,
  location_duplicate: 409,

  // Food lists
  food_list_not_found: 404,
  food_list_edit_forbidden: 403,
  food_list_item_duplicate: 409,
  food_list_reorder_mismatch: 400,
  food_list_stale_write: 409,
  food_list_share_not_friend: 403,
  food_list_save_self: 400,
  food_list_pin_limit_reached: 400,

  // Experience lists
  experience_list_not_found: 404,
  experience_list_edit_forbidden: 403,
  experience_list_item_duplicate: 409,
  experience_not_found: 404,
  experience_list_dining_ineligible: 400,
  experience_list_reorder_mismatch: 400,
  experience_list_stale_write: 409,
  experience_list_share_not_friend: 403,
  experience_list_save_self: 400,
  experience_list_pin_limit_reached: 400,

  // Edge / gateway
  rate_limit_exceeded: 429,

  // Admin panel
  admin_experience_not_found: 404,
  admin_user_not_found: 404,
  admin_sync_already_running: 409,

  // Catch-all
  internal_error: 500,
};

