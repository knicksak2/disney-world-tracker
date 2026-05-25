/**
 * Friends_Service repository (task 7.2).
 *
 * Single point of contact between the Friends route handlers and the
 * `friend_requests` and `friendships` tables. The repo's surface is
 * shaped around the design's `Friends_Service` "Key endpoints" table:
 *
 *   - `searchUsers`          — `GET /users/search`                (R8.1, R8.2)
 *   - `sendRequest`          — `POST /me/friend-requests`         (R8.3, R8.7, R8.8, R8.10)
 *   - `acceptRequest`        — `POST /me/friend-requests/:id/accept` (R8.4, R8.6)
 *   - `declineRequest`       — `POST /me/friend-requests/:id/decline` (R8.5)
 *   - `removeFriend`         — `DELETE /me/friends/:userId`       (R8.6, R8.11)
 *   - `listFriendsAndRequests` — `GET /me/friends`                (R8.9)
 *
 * Domain invariants enforced here (rather than at the route layer)
 * because they require database state:
 *
 *   - **Self-target rejection (R8.8)**: the caller is responsible for
 *     comparing `senderId === recipientId`, but the repo throws
 *     `friend_self_target` when the route forwards an obviously-self
 *     payload anyway. This belt-and-braces check makes
 *     `friendships.user_lo_id < user_hi_id` impossible to violate from
 *     `acceptRequest` (which builds the canonical pair).
 *   - **Unknown recipient (R8.10)**: a `users` lookup precedes the
 *     INSERT so the friend_request never points at a phantom id.
 *     `friend_recipient_unknown` is the response code.
 *   - **Duplicate relationship (R8.7)**: before INSERT we check for
 *     (a) an existing friendship in the canonical pair, (b) a pending
 *     request in the same direction, and (c) a pending request in the
 *     reverse direction. Any hit produces `friend_duplicate_relationship`.
 *     The same code surfaces if a concurrent INSERT trips the
 *     `(sender_id, recipient_id)` UNIQUE constraint between the SELECT
 *     and the INSERT.
 *   - **Missing friendship on remove (R8.11)**: `removeFriend` returns
 *     `false` when no `friendships` row matched; the route maps that to
 *     `friendship_not_found`.
 *   - **Accept/decline of missing or non-recipient requests**: the repo
 *     returns `null` so the route can map to `friendship_not_found`
 *     (404) without leaking whether the request id exists or simply
 *     belongs to a different recipient.
 *   - **Canonical pair (R8.6)**: every INSERT/SELECT/DELETE on
 *     `friendships` runs through `pair(a, b)` so the
 *     `user_lo_id < user_hi_id` CHECK is impossible to violate from
 *     this layer.
 *
 * The repo is constructed via `createFriendsRepo(pool)` so route plugins
 * and tests pass in their own pool. Inside, transactional operations
 * use `pool.connect()` directly so a single client carries the BEGIN
 * through COMMIT/ROLLBACK.
 *
 * Validates: Requirements R8.1, R8.2, R8.3, R8.4, R8.5, R8.6, R8.7,
 *            R8.8, R8.9, R8.10, R8.11.
 */

import type { FriendRequestDTO } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { pair as canonicalPair } from './canonicalPair.js';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * One row of the user-search result. Mirrors the minimal projection the
 * client renders in the "add friend" picker — display name, email, and
 * the User id needed to start a Friend_Request flow.
 */
export interface FriendSearchHit {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

/**
 * One entry in the `friends` array of `listFriendsAndRequests`. The
 * `establishedAt` field comes straight from the canonical row;
 * `displayName` and `avatarUrl` are joined from the friend's profile so
 * the client renders a friendly list without a second round-trip.
 */
export interface FriendListEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly establishedAt: string;
}

/**
 * One pending request in the `incomingRequests` / `outgoingRequests`
 * arrays. The "other party" fields (`senderId` for incoming,
 * `recipientId` for outgoing) carry the display name as a render aid.
 */
export interface FriendRequestListEntry {
  readonly id: string;
  readonly otherUserId: string;
  readonly otherDisplayName: string;
  readonly createdAt: string;
}

/** Bundled response of `listFriendsAndRequests` (R8.9). */
export interface FriendsAndRequests {
  readonly friends: ReadonlyArray<FriendListEntry>;
  readonly incomingRequests: ReadonlyArray<FriendRequestListEntry>;
  readonly outgoingRequests: ReadonlyArray<FriendRequestListEntry>;
}

/** Persistence surface returned by {@link createFriendsRepo}. */
export interface FriendsRepo {
  /**
   * Case-insensitive substring search on `display_name` and `email`,
   * excluding `requesterId`, capped at `limit` rows (default 50 per
   * R8.1). The query string is forwarded as-is — the route layer is
   * responsible for length validation against `searchQuerySchema`.
   */
  searchUsers(
    requesterId: string,
    query: string,
    limit?: number,
  ): Promise<ReadonlyArray<FriendSearchHit>>;

  /**
   * Create a pending Friend_Request from `senderId` to `recipientId`.
   * Throws an `AppError` for the rejection cases listed in the module
   * docstring; returns the persisted DTO on success.
   */
  sendRequest(
    senderId: string,
    recipientId: string,
  ): Promise<FriendRequestDTO>;

  /**
   * Atomically convert a pending request into a friendship. The caller
   * is the recipient: only a request whose `recipient_id` matches
   * `recipientId` is consumed. Returns the resulting canonical pair on
   * success, `null` when no matching request exists.
   */
  acceptRequest(
    recipientId: string,
    requestId: string,
  ): Promise<{ readonly userLoId: string; readonly userHiId: string } | null>;

  /**
   * Delete a pending request without creating a friendship. Same
   * recipient gating as `acceptRequest`. Returns `true` when a row was
   * deleted, `false` otherwise.
   */
  declineRequest(recipientId: string, requestId: string): Promise<boolean>;

  /**
   * Delete the canonical friendship row for `(userId, otherUserId)`.
   * Returns `true` when a row was deleted, `false` when none matched
   * (R8.11).
   */
  removeFriend(userId: string, otherUserId: string): Promise<boolean>;

  /**
   * Bundle the requesting User's friends list and pending requests
   * (R8.9). Friends are joined to their profiles for display fields;
   * pending requests carry the other party's display name for the same
   * reason.
   */
  listFriendsAndRequests(userId: string): Promise<FriendsAndRequests>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on user-search result size (R8.1). */
const SEARCH_RESULT_CAP = 50;

/** Postgres SQLSTATE for a `unique_violation` on an INSERT. */
const PG_UNIQUE_VIOLATION = '23505';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a `FriendsRepo` bound to the supplied pool. Constructor
 * injection (rather than reaching for `getPool()`) keeps the repo
 * trivially testable: integration tests use a sandbox pool, unit tests
 * pass a fake whose `query` and `connect` are recorded.
 */
export function createFriendsRepo(pool: DbPool): FriendsRepo {
  return {
    searchUsers: (requesterId, query, limit) =>
      searchUsers(pool, requesterId, query, limit ?? SEARCH_RESULT_CAP),
    sendRequest: (senderId, recipientId) =>
      sendRequest(pool, senderId, recipientId),
    acceptRequest: (recipientId, requestId) =>
      acceptRequest(pool, recipientId, requestId),
    declineRequest: (recipientId, requestId) =>
      declineRequest(pool, recipientId, requestId),
    removeFriend: (userId, otherUserId) =>
      removeFriend(pool, userId, otherUserId),
    listFriendsAndRequests: (userId) =>
      listFriendsAndRequests(pool, userId),
  };
}

// ---------------------------------------------------------------------------
// searchUsers (R8.1, R8.2)
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substring search on `display_name` (from `profiles`)
 * and `email` (from `users.email`, which is a `citext` column so the
 * `ILIKE` already runs case-insensitively). The requesting User is
 * excluded from results.
 *
 * The query is parameterized with `$2` (the raw query) so we can build
 * an `ILIKE` pattern with explicit escaping of the SQL wildcards `%`,
 * `_`, and `\` — otherwise an attacker could pass `%` to match every
 * row at once or `_` to fish for short display-name prefixes.
 */
async function searchUsers(
  pool: DbPool,
  requesterId: string,
  query: string,
  limit: number,
): Promise<ReadonlyArray<FriendSearchHit>> {
  const pattern = `%${escapeLikePattern(query)}%`;
  // The `min(limit, SEARCH_RESULT_CAP)` belt-and-braces guard ensures a
  // misconfigured caller can never blow past the R8.1 hard cap.
  const effectiveLimit = Math.min(Math.max(limit, 0), SEARCH_RESULT_CAP);
  const result = await pool.query<SearchUserRow>(
    `SELECT u.id, p.display_name, u.email::text AS email
       FROM users u
       JOIN profiles p ON p.user_id = u.id
      WHERE u.id <> $1
        AND (p.display_name ILIKE $2 ESCAPE '\\'
             OR u.email::text ILIKE $2 ESCAPE '\\')
      ORDER BY lower(p.display_name) ASC, u.id ASC
      LIMIT $3`,
    [requesterId, pattern, effectiveLimit],
  );
  return result.rows.map(searchRowToHit);
}

/** Internal row shape projected by the search query. */
interface SearchUserRow {
  id: string;
  display_name: string;
  email: string;
}

/** Project a `SearchUserRow` to the public `FriendSearchHit` DTO. */
function searchRowToHit(row: SearchUserRow): FriendSearchHit {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
  };
}

/**
 * Escape SQL `LIKE` / `ILIKE` wildcards in the user-supplied query so a
 * `%` or `_` in the input matches its literal character rather than
 * acting as a wildcard. Backslashes are doubled because the surrounding
 * `ILIKE ... ESCAPE '\\'` clause treats `\\` as the escape character.
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/gu, (ch) => `\\${ch}`);
}

// ---------------------------------------------------------------------------
// sendRequest (R8.3, R8.7, R8.8, R8.10)
// ---------------------------------------------------------------------------

/**
 * Create a pending Friend_Request after validating that:
 *
 *   1. `senderId !== recipientId`              (R8.8 self-target)
 *   2. `recipientId` resolves to a real `users` row (R8.10)
 *   3. No friendship exists for the canonical pair  (R8.7)
 *   4. No same-direction pending request exists     (R8.7)
 *   5. No reverse-direction pending request exists  (R8.7)
 *
 * The four "exists" checks run inside a single transaction so a
 * concurrent INSERT cannot squeeze between the read and the write. The
 * `(sender_id, recipient_id)` UNIQUE constraint on `friend_requests`
 * provides a final safety net: any race that survives the SELECTs trips
 * the unique violation, which we translate to
 * `friend_duplicate_relationship`.
 */
async function sendRequest(
  pool: DbPool,
  senderId: string,
  recipientId: string,
): Promise<FriendRequestDTO> {
  // R8.8: surface self-target before any DB I/O so the rejection is
  // cheap and so `canonicalPair` (which throws on `lo === hi`) is
  // never reached with equal ids.
  if (senderId === recipientId) {
    throw new AppError(
      'friend_self_target',
      'Cannot send a friend request to yourself.',
      { field: 'recipientId' },
    );
  }

  const { lo, hi } = canonicalPair(senderId, recipientId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // R8.10: phantom recipient → friend_recipient_unknown.
    const recipientExists = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1`,
      [recipientId],
    );
    if (recipientExists.rows.length === 0) {
      throw new AppError(
        'friend_recipient_unknown',
        'Recipient user does not exist.',
        { field: 'recipientId' },
      );
    }

    // R8.7: existing friendship → duplicate_relationship.
    const friendshipExists = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM friendships
          WHERE user_lo_id = $1 AND user_hi_id = $2
       ) AS exists`,
      [lo, hi],
    );
    if (friendshipExists.rows[0]?.exists === true) {
      throw new AppError(
        'friend_duplicate_relationship',
        'A friendship already exists with this user.',
      );
    }

    // R8.7: pending request in either direction → duplicate_relationship.
    const requestExists = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM friend_requests
          WHERE (sender_id = $1 AND recipient_id = $2)
             OR (sender_id = $2 AND recipient_id = $1)
       ) AS exists`,
      [senderId, recipientId],
    );
    if (requestExists.rows[0]?.exists === true) {
      throw new AppError(
        'friend_duplicate_relationship',
        'A pending friend request already exists between you and this user.',
      );
    }

    // R8.3: persist the new request.
    let inserted: {
      id: string;
      sender_id: string;
      recipient_id: string;
      created_at: Date | string;
    };
    try {
      const result = await client.query<{
        id: string;
        sender_id: string;
        recipient_id: string;
        created_at: Date | string;
      }>(
        `INSERT INTO friend_requests (sender_id, recipient_id)
         VALUES ($1, $2)
       RETURNING id, sender_id, recipient_id, created_at`,
        [senderId, recipientId],
      );
      const row = result.rows[0];
      if (!row) {
        // Postgres always returns a row for a successful INSERT...RETURNING;
        // an empty rows array would indicate a driver-level fault.
        throw new AppError(
          'internal_error',
          'Friend request insertion returned no row.',
        );
      }
      inserted = row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Race: a concurrent INSERT slipped in between our SELECT and
        // our INSERT. Map the constraint violation to the same
        // user-facing code we'd have produced from the SELECT.
        throw new AppError(
          'friend_duplicate_relationship',
          'A pending friend request already exists between you and this user.',
          { cause: err },
        );
      }
      throw err;
    }

    await client.query('COMMIT');

    return {
      id: inserted.id,
      senderId: inserted.sender_id,
      recipientId: inserted.recipient_id,
      createdAt: toIsoTimestamp(inserted.created_at),
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Surface the original cause; rollback failure does not change
      // the user-visible error.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// acceptRequest (R8.4, R8.6)
// ---------------------------------------------------------------------------

/**
 * Atomically convert a pending request into a friendship:
 *
 *   1. SELECT the request by id, gated by `recipient_id = $recipientId`
 *      so an attacker cannot accept a request not addressed to them.
 *   2. Compute the canonical pair from `(sender_id, recipient_id)`.
 *   3. INSERT into `friendships` (PK on canonical pair).
 *   4. DELETE the request row.
 *
 * All four steps run in one transaction. If the request does not exist
 * (or belongs to a different recipient), we return `null` and the route
 * surfaces `friendship_not_found`. We do not differentiate between
 * "no such id" and "wrong recipient" so the response can never be used
 * to enumerate request ids.
 */
async function acceptRequest(
  pool: DbPool,
  recipientId: string,
  requestId: string,
): Promise<{ readonly userLoId: string; readonly userHiId: string } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const requestRow = await client.query<{
      sender_id: string;
      recipient_id: string;
    }>(
      `SELECT sender_id, recipient_id
         FROM friend_requests
        WHERE id = $1 AND recipient_id = $2`,
      [requestId, recipientId],
    );
    const row = requestRow.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    // Defense in depth: the table's `friend_requests_no_self_chk` already
    // forbids self-target rows, so this branch is unreachable in practice.
    // Asserting it here keeps `canonicalPair` from throwing on a malformed
    // pre-existing row and the error code consistent with the API contract.
    if (row.sender_id === row.recipient_id) {
      throw new AppError(
        'friend_self_target',
        'Cannot establish a friendship with yourself.',
      );
    }

    const { lo, hi } = canonicalPair(row.sender_id, row.recipient_id);

    // INSERT first so a race with another accept-or-send does not leave
    // the request deleted with no friendship row created. The PK on
    // `(user_lo_id, user_hi_id)` makes the INSERT idempotent under a
    // duplicate-accept retry: ON CONFLICT DO NOTHING returns no row,
    // and we still proceed to delete the request.
    await client.query(
      `INSERT INTO friendships (user_lo_id, user_hi_id)
       VALUES ($1, $2)
       ON CONFLICT (user_lo_id, user_hi_id) DO NOTHING`,
      [lo, hi],
    );

    await client.query(`DELETE FROM friend_requests WHERE id = $1`, [
      requestId,
    ]);

    await client.query('COMMIT');
    return { userLoId: lo, userHiId: hi };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Swallow rollback failure to surface the original cause.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// declineRequest (R8.5)
// ---------------------------------------------------------------------------

/**
 * Delete a pending request without creating a friendship. The
 * `recipient_id` predicate ensures only the addressed recipient can
 * decline; mismatches return `false` (mapped to 404 by the route).
 */
async function declineRequest(
  pool: DbPool,
  recipientId: string,
  requestId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM friend_requests
      WHERE id = $1 AND recipient_id = $2`,
    [requestId, recipientId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// removeFriend (R8.6, R8.11)
// ---------------------------------------------------------------------------

/**
 * Delete the canonical friendship row for `(userId, otherUserId)`.
 *
 * Returns `false` (i.e. R8.11 trigger) when:
 *   - `otherUserId === userId`            (self-friend can never exist)
 *   - no canonical row matched the pair  (the natural "not found" case)
 *
 * The self-target case is short-circuited rather than allowed to reach
 * `canonicalPair` (which would throw); R8.11's contract is "validation
 * error" without specifying a separate code, so the unified
 * `friendship_not_found` mapping at the route layer is what surfaces
 * to the client.
 */
async function removeFriend(
  pool: DbPool,
  userId: string,
  otherUserId: string,
): Promise<boolean> {
  if (userId === otherUserId) {
    return false;
  }
  const { lo, hi } = canonicalPair(userId, otherUserId);
  const result = await pool.query(
    `DELETE FROM friendships
      WHERE user_lo_id = $1 AND user_hi_id = $2`,
    [lo, hi],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// listFriendsAndRequests (R8.9)
// ---------------------------------------------------------------------------

/**
 * Bundle the requesting User's:
 *
 *   - current friends (joined to profile display name and avatar URL),
 *   - incoming pending requests (joined to the sender's display name),
 *   - outgoing pending requests (joined to the recipient's display name).
 *
 * Three independent queries are issued in parallel. The friends query
 * walks both columns of the canonical pair so it returns the friend's
 * id regardless of whether the requester is the lo or hi side.
 */
async function listFriendsAndRequests(
  pool: DbPool,
  userId: string,
): Promise<FriendsAndRequests> {
  // The three queries are independent (no shared transactional state)
  // so issuing them in parallel halves the round-trip cost compared to
  // a serial call chain.
  const [friendRows, incomingRows, outgoingRows] = await Promise.all([
    pool.query<FriendListRow>(
      `SELECT
         CASE WHEN f.user_lo_id = $1 THEN f.user_hi_id ELSE f.user_lo_id END AS friend_id,
         p.display_name,
         p.avatar_url,
         f.established_at
       FROM friendships f
       JOIN profiles p
         ON p.user_id = (CASE WHEN f.user_lo_id = $1 THEN f.user_hi_id ELSE f.user_lo_id END)
      WHERE f.user_lo_id = $1 OR f.user_hi_id = $1
      ORDER BY lower(p.display_name) ASC, friend_id ASC`,
      [userId],
    ),
    pool.query<RequestListRow>(
      `SELECT fr.id,
              fr.sender_id AS other_user_id,
              p.display_name,
              fr.created_at
         FROM friend_requests fr
         JOIN profiles p ON p.user_id = fr.sender_id
        WHERE fr.recipient_id = $1
        ORDER BY fr.created_at DESC, fr.id ASC`,
      [userId],
    ),
    pool.query<RequestListRow>(
      `SELECT fr.id,
              fr.recipient_id AS other_user_id,
              p.display_name,
              fr.created_at
         FROM friend_requests fr
         JOIN profiles p ON p.user_id = fr.recipient_id
        WHERE fr.sender_id = $1
        ORDER BY fr.created_at DESC, fr.id ASC`,
      [userId],
    ),
  ]);

  return {
    friends: friendRows.rows.map(friendRowToEntry),
    incomingRequests: incomingRows.rows.map(requestRowToEntry),
    outgoingRequests: outgoingRows.rows.map(requestRowToEntry),
  };
}

/** Internal row shape projected by the friends list query. */
interface FriendListRow {
  friend_id: string;
  display_name: string;
  avatar_url: string | null;
  established_at: Date | string;
}

/** Internal row shape projected by both incoming and outgoing request queries. */
interface RequestListRow {
  id: string;
  other_user_id: string;
  display_name: string;
  created_at: Date | string;
}

/** Project a `FriendListRow` to the public `FriendListEntry` DTO. */
function friendRowToEntry(row: FriendListRow): FriendListEntry {
  return {
    userId: row.friend_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    establishedAt: toIsoTimestamp(row.established_at),
  };
}

/** Project a `RequestListRow` to the public `FriendRequestListEntry` DTO. */
function requestRowToEntry(row: RequestListRow): FriendRequestListEntry {
  return {
    id: row.id,
    otherUserId: row.other_user_id,
    otherDisplayName: row.display_name,
    createdAt: toIsoTimestamp(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a `TIMESTAMPTZ` column value as an ISO-8601 UTC string. Accepts
 * either a JavaScript `Date` (the default for `pg`) or a string already
 * in ISO shape (which can occur with custom type parsers).
 */
function toIsoTimestamp(value: Date | string): string {
  if (typeof value === 'string') return value;
  return value.toISOString();
}

/**
 * Detect a Postgres `unique_violation` (SQLSTATE 23505) without
 * depending on the `pg` package's exported error type at compile time.
 * The `code` property is the stable signal across `pg` versions.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
