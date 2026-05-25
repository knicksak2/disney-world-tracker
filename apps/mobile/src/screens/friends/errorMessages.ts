/**
 * Friends UI error code → user-visible message map.
 *
 * The Friends_Service backend (apps/api/src/services/friends/routes.ts and
 * .../repo.ts) surfaces a focused subset of the shared `ErrorCode` union.
 * Both Friends screens (`FriendsListScreen`, `FriendsSearchScreen`) need
 * the same translation, so the mapping lives in one place.
 *
 * Codes covered:
 *
 *   - `friend_self_target`             — sender == recipient on POST
 *                                        /me/friend-requests (R8.8).
 *   - `friend_request_self`            — alias kept as a defensive fallback
 *                                        in case the server renames the code.
 *   - `friend_duplicate_relationship`  — pending request or existing
 *                                        friendship in either direction (R8.7).
 *   - `friend_request_already_pending` — alias for the duplicate case.
 *   - `friend_already_friends`         — alias for the duplicate case where
 *                                        the relationship is already accepted.
 *   - `friend_recipient_unknown`       — recipient id does not resolve to a
 *                                        real User (R8.10).
 *   - `friendship_not_found`           — accept/decline a missing or
 *                                        non-recipient request, or remove a
 *                                        friend that does not exist (R8.4
 *                                        safety, R8.5 safety, R8.11).
 *   - `friend_request_not_found`       — alias for friendship_not_found for
 *                                        the request-id flavor of the same.
 *   - `friend_not_found`               — alias for friendship_not_found for
 *                                        the remove-friend flavor.
 *   - `search_query_length_invalid`    — q outside 1..100 chars (R8.2).
 *   - `validation_failed`              — generic Zod failure (e.g. q too
 *                                        short/long when the server collapses
 *                                        the dedicated code).
 *   - `unauthorized`                   — session expired mid-action; the api
 *                                        client also routes the user back to
 *                                        the auth stack via `notifyUnauthorized`.
 *   - `internal_error`                 — fallback when anything else slips
 *                                        through.
 *
 * Aliases are tolerated so a server-side rename (e.g. swapping
 * `friend_self_target` for `friend_request_self`) does not silently degrade
 * the UI to the generic fallback message. Only the codes the backend
 * actually emits today are listed in `ErrorCode`; the aliases are accepted
 * via a string lookup so they remain harmless if they never appear.
 */

import type { ErrorCode } from '@dwt/shared';

import { ApiError } from '../../api/client';

/** Defensive fallback when no specific code is recognized. */
export const GENERIC_FRIENDS_ERROR =
  'Something went wrong. Please try again later.';

/**
 * Lookup table keyed by the string form of the error code so unknown
 * aliases can be tolerated without expanding the closed `ErrorCode` union.
 */
const FRIENDS_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  // R8.8 — self-target on POST /me/friend-requests.
  friend_self_target: 'You can\u2019t send a friend request to yourself.',
  friend_request_self: 'You can\u2019t send a friend request to yourself.',

  // R8.7 — pending request or existing friendship in either direction.
  friend_duplicate_relationship:
    'You\u2019re already connected with this user or have a pending request.',
  friend_request_already_pending:
    'A friend request is already pending with this user.',
  friend_already_friends: 'You\u2019re already friends with this user.',

  // R8.10 — phantom recipient.
  friend_recipient_unknown: 'That user no longer exists.',

  // R8.4 / R8.5 / R8.11 — accept/decline/remove targeting a missing row.
  friendship_not_found: 'That request or friendship is no longer available.',
  friend_request_not_found:
    'That friend request is no longer available.',
  friend_not_found: 'You\u2019re not currently friends with that user.',

  // R8.2 — q outside 1..100.
  search_query_length_invalid:
    'Search must be between 1 and 100 characters.',

  // Generic Zod failure — used by routes when the dedicated R8.2 code does
  // not fire (e.g. a body-shape rejection on POST /me/friend-requests).
  validation_failed: 'Please check your input and try again.',

  // The api client redirects to the auth stack on 401, but a transient
  // 401 may surface here before the navigator re-renders.
  unauthorized: 'Your session has expired. Please sign in again.',

  // Fallback for the catch-all server-side path.
  internal_error: GENERIC_FRIENDS_ERROR,
};

/**
 * Translate any thrown value into a user-visible message. Non-`ApiError`
 * throws collapse to the generic message so an unexpected runtime error
 * (e.g. a JSON parse failure) does not leak its `Error.message` into the
 * UI.
 */
export function friendsErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return mapCodeToMessage(err.code);
  }
  return GENERIC_FRIENDS_ERROR;
}

/**
 * Translate an `ErrorCode` (or alias string) into a user-visible
 * message. Exposed separately so callers that already hold the code (e.g.
 * a saved-mutation result) can map without reaching for `ApiError`.
 */
export function mapCodeToMessage(code: ErrorCode | string): string {
  return FRIENDS_ERROR_MESSAGES[code] ?? GENERIC_FRIENDS_ERROR;
}
