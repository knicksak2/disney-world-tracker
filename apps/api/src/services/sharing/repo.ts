/**
 * Sharing_Service repository (task 12.1).
 *
 * Single point of contact between the Sharing route handlers and the
 * `shares` and `share_recipients` tables (per the design ER diagram and
 * `migrations/0001_init.sql`):
 *
 *   shares (
 *     id, sender_id, experience_id NULL,
 *     payload_kind text,
 *     payload_snapshot jsonb,
 *     sent_at
 *   )
 *
 *   share_recipients (
 *     share_id, recipient_id, opened_at NULL, recipient_deleted_at NULL,
 *     PRIMARY KEY (share_id, recipient_id)
 *   )
 *
 * Public surface:
 *
 *   - `createShareAtomic(senderId, recipientIds, payload)` — runs the
 *     "atomic friend check + atomic insert" transaction described in
 *     design.md "Share Delivery (atomic friend check)":
 *
 *       BEGIN
 *         validate 1 <= |recipients| <= 50          (R9.2)
 *         compute canonical pair (lo,hi) per recipient
 *         SELECT (user_lo_id, user_hi_id) FROM friendships
 *           WHERE (user_lo_id, user_hi_id) IN ((lo1,hi1), ...)
 *         IF |result| != |distinct recipients|  ⇒ ROLLBACK + share_atomic_rejected (R9.3)
 *         INSERT INTO shares ... RETURNING id
 *         INSERT INTO share_recipients (share_id, recipient_id) (one per recipient)
 *       COMMIT
 *
 *     The friend check uses one SELECT for all recipients (rather than
 *     N round-trips) so the atomicity is decided in a single snapshot.
 *
 *   - `listInbox(recipientId)` — return the recipient's inbox: every
 *     non-deleted share addressed to this recipient. Returns `unread`
 *     count (rows with `opened_at IS NULL`) and an `items` array. Per
 *     R9.8, unopened items reveal only `{ shareId, isOpened: false }`;
 *     opened items reveal `senderId, payloadKind, payload, sentAt`
 *     (R9.9).
 *
 *   - `openShare(recipientId, shareId)` — set `opened_at = now()` for
 *     the recipient's row (idempotent: re-opening a previously opened
 *     share preserves its prior `opened_at`) and return the full
 *     payload. Returns `null` when no row matches (no such share, not
 *     addressed to this recipient, or recipient-deleted).
 *
 *   - `softDeleteForRecipient(recipientId, shareId)` — set
 *     `recipient_deleted_at = now()` on the recipient's row only
 *     (R9.10). The sender's `shares` row is untouched, as are any
 *     other recipient rows. Returns `true` when a row was updated,
 *     `false` otherwise.
 *
 * Validates: Requirements R9.1, R9.2, R9.3, R9.4, R9.5, R9.6, R9.7,
 *            R9.8, R9.9, R9.10.
 */

import type { SharePayload, SharePayloadKind } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { pair as canonicalPair } from '../friends/canonicalPair.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of a successful `createShareAtomic` call. The route layer echoes
 * the new share's id and the count of recipient rows actually inserted
 * (always equal to the deduplicated recipient list size on success).
 */
export interface ShareDeliveryResult {
  readonly shareId: string;
  readonly deliveredTo: number;
}

/**
 * One row of the inbox listing. Per R9.8/R9.9:
 *   - When `isOpened === false`, only `shareId` and `isOpened` are
 *     present; `senderId`, `payloadKind`, `payload`, and `sentAt` are
 *     intentionally omitted from the wire shape so an unopened share
 *     leaks no metadata.
 *   - When `isOpened === true`, the full content is included.
 */
export interface InboxItem {
  readonly shareId: string;
  readonly isOpened: boolean;
  readonly senderId?: string;
  readonly payloadKind?: SharePayloadKind;
  readonly payload?: SharePayload;
  readonly sentAt?: string;
}

/** Bundled inbox response. */
export interface InboxResponse {
  /** Count of `share_recipients` rows whose `opened_at IS NULL`. */
  readonly unread: number;
  readonly items: ReadonlyArray<InboxItem>;
}

/** Detail returned by `openShare` on success. */
export interface OpenedShareDetail {
  readonly shareId: string;
  readonly senderId: string;
  readonly payloadKind: SharePayloadKind;
  readonly payload: SharePayload;
  readonly sentAt: string;
}

/** Persistence surface returned by {@link createSharingRepo}. */
export interface SharingRepo {
  /**
   * Atomic share delivery. Throws {@link AppError} with `share_recipient_count_invalid`
   * for an out-of-range list and `share_atomic_rejected` when any recipient
   * is not a Friend of the sender (R9.2, R9.3).
   */
  createShareAtomic(
    senderId: string,
    recipientIds: ReadonlyArray<string>,
    payload: SharePayload,
  ): Promise<ShareDeliveryResult>;

  /** Bundle the recipient's inbox (R9.8, R9.9). */
  listInbox(recipientId: string): Promise<InboxResponse>;

  /**
   * Open a share for the recipient (R9.9). Returns `null` when no
   * matching un-deleted row exists.
   */
  openShare(
    recipientId: string,
    shareId: string,
  ): Promise<OpenedShareDetail | null>;

  /**
   * Recipient-side soft delete (R9.10). Returns `true` when a row was
   * updated, `false` otherwise.
   */
  softDeleteForRecipient(
    recipientId: string,
    shareId: string,
  ): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lower bound on recipient list size (R9.2). */
const MIN_RECIPIENTS = 1;
/** Upper bound on recipient list size (R9.2). */
const MAX_RECIPIENTS = 50;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a `SharingRepo` bound to the supplied pool. Constructor injection
 * (rather than reaching for `getPool()`) keeps the repo testable: unit
 * tests pass a fake whose `query` and `connect` are recorded.
 */
export function createSharingRepo(pool: DbPool): SharingRepo {
  return {
    createShareAtomic: (senderId, recipientIds, payload) =>
      createShareAtomic(pool, senderId, recipientIds, payload),
    listInbox: (recipientId) => listInbox(pool, recipientId),
    openShare: (recipientId, shareId) =>
      openShare(pool, recipientId, shareId),
    softDeleteForRecipient: (recipientId, shareId) =>
      softDeleteForRecipient(pool, recipientId, shareId),
  };
}

// ---------------------------------------------------------------------------
// createShareAtomic (R9.1, R9.2, R9.3)
// ---------------------------------------------------------------------------

/**
 * Atomic share delivery.
 *
 * Validates the recipient list size (R9.2), then runs a single
 * transaction containing the friend check and the row inserts (R9.3).
 * The friend check uses one SELECT against `friendships` keyed by the
 * canonical pair tuple list; if any recipient is missing from the
 * result, the entire transaction is rolled back so neither the share
 * row nor any recipient rows persist.
 */
async function createShareAtomic(
  pool: DbPool,
  senderId: string,
  recipientIds: ReadonlyArray<string>,
  payload: SharePayload,
): Promise<ShareDeliveryResult> {
  // R9.2: enforce the 1..50 bound at the repo edge as defense in depth.
  // The route layer's Zod schema rejects the same inputs first, but the
  // repo guards against direct callers (e.g. future internal tooling).
  if (recipientIds.length < MIN_RECIPIENTS || recipientIds.length > MAX_RECIPIENTS) {
    throw new AppError(
      'share_recipient_count_invalid',
      `Recipient count must be between ${MIN_RECIPIENTS} and ${MAX_RECIPIENTS}.`,
      { field: 'recipientIds' },
    );
  }

  // Deduplicate: a recipient appearing twice in the input would either
  // (a) trip the (share_id, recipient_id) PK if the duplicate insert
  // surfaced or (b) be silently coalesced by ON CONFLICT DO NOTHING. We
  // surface it as an explicit count-invalid error so a buggy caller gets
  // a clean envelope rather than a constraint violation 500.
  const distinctRecipients = Array.from(new Set(recipientIds));
  if (distinctRecipients.length !== recipientIds.length) {
    throw new AppError(
      'share_recipient_count_invalid',
      'Recipient list contains duplicates.',
      { field: 'recipientIds' },
    );
  }

  // R9.3: a self-target inside the recipient list cannot be a friend (no
  // self-friendship is representable, and `canonicalPair` throws on
  // `lo === hi`). Surface as `share_atomic_rejected` with the sender id
  // not contributing to the friendship lookup at all.
  if (distinctRecipients.some((id) => id === senderId)) {
    throw new AppError(
      'share_atomic_rejected',
      'Cannot share to yourself.',
      { field: 'recipientIds' },
    );
  }

  // Compute the canonical (lo, hi) pair for each recipient so the
  // friendship lookup uses the table's PK index.
  const pairs = distinctRecipients.map((recipientId) => {
    const { lo, hi } = canonicalPair(senderId, recipientId);
    return { recipientId, lo, hi };
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // R9.3 atomic friend check: one SELECT covers every recipient. We
    // build a parameterized `(user_lo_id, user_hi_id) IN ((lo,hi), ...)`
    // expression — the row-tuple IN form is supported by Postgres and
    // hits the `friendships_pkey` index directly.
    //
    // Parameter layout: $1, $2 = first pair's (lo, hi); $3, $4 = second
    // pair's (lo, hi); ...
    const params: string[] = [];
    const tuples: string[] = [];
    for (const p of pairs) {
      const loIdx = params.length + 1;
      const hiIdx = params.length + 2;
      tuples.push(`($${loIdx}::uuid, $${hiIdx}::uuid)`);
      params.push(p.lo, p.hi);
    }
    const friendshipQuery =
      `SELECT user_lo_id, user_hi_id
         FROM friendships
        WHERE (user_lo_id, user_hi_id) IN (${tuples.join(', ')})`;
    const friendshipResult = await client.query<{
      user_lo_id: string;
      user_hi_id: string;
    }>(friendshipQuery, params);

    // Convert the SELECT result into a set keyed by `lo|hi` so we can
    // check each recipient's pair in O(1). The set size cap is 50 per
    // R9.2 so the memory cost is trivial.
    const friendSet = new Set<string>();
    for (const row of friendshipResult.rows) {
      friendSet.add(`${row.user_lo_id}|${row.user_hi_id}`);
    }
    const allFriends = pairs.every((p) => friendSet.has(`${p.lo}|${p.hi}`));
    if (!allFriends) {
      // R9.3: any non-friend in the list aborts the whole transaction.
      // Rolling back inside the catch handles the same path uniformly,
      // but explicit here for clarity in the happy-path branch.
      await client.query('ROLLBACK');
      throw new AppError(
        'share_atomic_rejected',
        'Every recipient must be a friend of the sender.',
        { field: 'recipientIds' },
      );
    }

    // INSERT the share row. `experience_id` mirrors `payload.kind` per
    // the `shares_experience_payload_chk` table CHECK so we can never
    // insert an inconsistent (kind, experience_id) combination.
    const experienceId =
      payload.kind === 'experience' ? payload.experienceId : null;
    const insertShare = await client.query<{ id: string }>(
      `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id`,
      [senderId, experienceId, payload.kind, JSON.stringify(payload)],
    );
    const shareRow = insertShare.rows[0];
    if (!shareRow) {
      // Unreachable on a successful INSERT...RETURNING; surface as a
      // generic internal_error so the global hook redacts.
      throw new AppError(
        'internal_error',
        'Share insertion returned no row.',
      );
    }
    const shareId = shareRow.id;

    // INSERT one recipient row per recipient. We use a single multi-row
    // INSERT with `unnest` arrays so the round-trip cost is O(1)
    // regardless of the recipient count up to the 50 cap.
    await client.query(
      `INSERT INTO share_recipients (share_id, recipient_id)
       SELECT $1::uuid, recipient_id FROM unnest($2::uuid[]) AS t(recipient_id)`,
      [shareId, distinctRecipients],
    );

    await client.query('COMMIT');
    return { shareId, deliveredTo: distinctRecipients.length };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Swallow rollback failure so the original cause surfaces.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// listInbox (R9.8, R9.9)
// ---------------------------------------------------------------------------

interface InboxRow {
  share_id: string;
  is_opened: boolean;
  sender_id: string;
  payload_kind: SharePayloadKind;
  payload_snapshot: unknown;
  sent_at: Date | string;
}

/**
 * Return the recipient's inbox.
 *
 * The query joins `share_recipients` to `shares` and excludes
 * recipient-soft-deleted rows. The route layer is the one that strips
 * sender/payload/sentAt for unopened items in the wire shape — the repo
 * still returns those fields here so future callers (e.g. an
 * administrative tool) can read the full state without redundant
 * lookups. The route's projection is the privacy boundary.
 *
 * The unread count is a fast `COUNT(*) WHERE opened_at IS NULL` running
 * on the same base set so the two values cannot drift across requests.
 */
async function listInbox(
  pool: DbPool,
  recipientId: string,
): Promise<InboxResponse> {
  const result = await pool.query<InboxRow>(
    `SELECT sr.share_id,
            (sr.opened_at IS NOT NULL) AS is_opened,
            s.sender_id,
            s.payload_kind,
            s.payload_snapshot,
            s.sent_at
       FROM share_recipients sr
       JOIN shares s ON s.id = sr.share_id
      WHERE sr.recipient_id = $1
        AND sr.recipient_deleted_at IS NULL
      ORDER BY s.sent_at DESC, sr.share_id ASC`,
    [recipientId],
  );

  let unread = 0;
  const items: InboxItem[] = [];
  for (const row of result.rows) {
    if (!row.is_opened) {
      unread += 1;
      // R9.8: unopened entries reveal only shareId + isOpened.
      items.push({ shareId: row.share_id, isOpened: false });
      continue;
    }
    // R9.9: opened entries reveal sender, content, and timestamp.
    items.push({
      shareId: row.share_id,
      isOpened: true,
      senderId: row.sender_id,
      payloadKind: row.payload_kind,
      payload: parsePayload(row.payload_snapshot),
      sentAt: toIsoTimestamp(row.sent_at),
    });
  }
  return { unread, items };
}

// ---------------------------------------------------------------------------
// openShare (R9.9)
// ---------------------------------------------------------------------------

/**
 * Mark a share as opened by the recipient and return the full payload.
 *
 * The UPDATE is gated by `recipient_id = $1 AND recipient_deleted_at IS
 * NULL` so:
 *   - A recipient cannot open another recipient's row.
 *   - A recipient cannot un-soft-delete a share via the open path.
 *
 * `opened_at` is set with `COALESCE(opened_at, now())` so re-opening an
 * already-opened share preserves the prior timestamp (idempotent open).
 *
 * Returns `null` when no matching row exists; the route layer maps that
 * to a 404. The not-found path collapses "no such share" and "wrong
 * recipient" to one response so the response shape cannot enumerate
 * share ids belonging to other users.
 */
async function openShare(
  pool: DbPool,
  recipientId: string,
  shareId: string,
): Promise<OpenedShareDetail | null> {
  const result = await pool.query<{
    sender_id: string;
    payload_kind: SharePayloadKind;
    payload_snapshot: unknown;
    sent_at: Date | string;
  }>(
    `WITH updated AS (
       UPDATE share_recipients
          SET opened_at = COALESCE(opened_at, now())
        WHERE share_id = $1
          AND recipient_id = $2
          AND recipient_deleted_at IS NULL
       RETURNING share_id
     )
     SELECT s.sender_id, s.payload_kind, s.payload_snapshot, s.sent_at
       FROM updated u
       JOIN shares s ON s.id = u.share_id`,
    [shareId, recipientId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    shareId,
    senderId: row.sender_id,
    payloadKind: row.payload_kind,
    payload: parsePayload(row.payload_snapshot),
    sentAt: toIsoTimestamp(row.sent_at),
  };
}

// ---------------------------------------------------------------------------
// softDeleteForRecipient (R9.10)
// ---------------------------------------------------------------------------

/**
 * Recipient-side soft delete.
 *
 * The UPDATE only touches the recipient's own row. The sender's `shares`
 * row and every other recipient's `share_recipients` row are unaffected,
 * which is the exact contract of R9.10.
 *
 * `recipient_deleted_at = COALESCE(recipient_deleted_at, now())` keeps
 * the original deletion timestamp on a re-delete (idempotent). The
 * predicate `recipient_deleted_at IS NULL` would also work, but
 * COALESCE preserves the original timestamp through any retry without a
 * second SELECT.
 *
 * Returns `true` when a row was updated. We still return `false` when
 * the row exists but is already deleted (`COALESCE` is a no-op write
 * that Postgres still reports as `rowCount === 1`); to surface idempotency
 * cleanly we instead gate the UPDATE with `recipient_deleted_at IS NULL`.
 */
async function softDeleteForRecipient(
  pool: DbPool,
  recipientId: string,
  shareId: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE share_recipients
        SET recipient_deleted_at = now()
      WHERE share_id = $1
        AND recipient_id = $2
        AND recipient_deleted_at IS NULL`,
    [shareId, recipientId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a `TIMESTAMPTZ` column value as an ISO-8601 UTC string. Accepts
 * either a `Date` (the `pg` default) or a string already in ISO shape
 * (which can occur with custom type parsers).
 */
function toIsoTimestamp(value: Date | string): string {
  if (typeof value === 'string') return value;
  return value.toISOString();
}

/**
 * Coerce a `payload_snapshot` JSON column value into a typed
 * `SharePayload`. Postgres' jsonb type parser returns the parsed value
 * directly, but a string is possible if a type override is configured.
 *
 * The coercion is structural — we trust that what was inserted by
 * `createShareAtomic` round-trips faithfully through jsonb, and we do
 * not re-validate against the shared Zod schema here because the data
 * has already passed the input schema at write time. A future
 * defense-in-depth pass could re-run `sharePayloadSchema.parse` here.
 */
function parsePayload(value: unknown): SharePayload {
  if (typeof value === 'string') {
    return JSON.parse(value) as SharePayload;
  }
  return value as SharePayload;
}
