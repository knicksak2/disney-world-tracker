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

  // -- Edge / gateway (defense-in-depth, R6.7) --------------------------
  // Emitted by the gateway-level rate limiter (task 13.3) when a caller
  // exceeds the configured request budget for read, mutation, or
  // account-keyed login windows. Surfaced via the same uniform envelope
  // shape as the rest of the API so clients have a single error contract.
  'rate_limit_exceeded',

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

  // Edge / gateway
  rate_limit_exceeded: 429,

  // Catch-all
  internal_error: 500,
};
