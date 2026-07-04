/**
 * Reaction_Service repository (task 14.1).
 *
 * Single point of contact between the Reaction route handlers and the
 * `share_reactions` table (per `migrations/0011_social_sharing_loop.sql`):
 *
 *   share_reactions (
 *     share_id, recipient_id, reaction text,
 *     created_at, updated_at,
 *     PRIMARY KEY (share_id, recipient_id),
 *     CHECK reaction IN ('like','love','been_there','want_to_go')
 *   )
 *
 * Public surface:
 *
 *   - `upsertReaction(shareId, recipientId, reaction)` — persist the
 *     recipient's single `Share_Reaction` for a Share (R11.1). The write
 *     is authorized only when a `share_recipients (share_id, recipient_id)`
 *     row exists, i.e. the Share was delivered to the caller (R11.8);
 *     otherwise an `AppError('reaction_forbidden')` is thrown and nothing
 *     is persisted. The composite PK guarantees at most one reaction per
 *     `(share, recipient)` (R11.4); the `ON CONFLICT ... DO UPDATE` clause
 *     replaces a prior reaction on resubmit (R11.5).
 *
 *   - `deleteReaction(shareId, recipientId)` — remove the caller's
 *     reaction to a Share (R11.6). Idempotent: returns `true` when a row
 *     was deleted and `false` when none existed. Removing a reaction the
 *     caller does not have is a no-op, so a caller who was never a
 *     recipient simply deletes nothing.
 *
 *   - `listReactionsForSender(shareId, senderId)` — the sender's view of
 *     the reactions on a Share they sent (R11.7). Gated to the Share's
 *     sender: a caller who is not the sender (or a Share that does not
 *     exist) yields `AppError('reaction_forbidden')` so the endpoint
 *     cannot be used to enumerate other users' Shares. Each reaction is
 *     joined against `profiles` to disclose the reactor's display name.
 *
 * The reaction value itself is validated against the closed
 * `Reaction_Vocabulary` at the route boundary (R11.2, R11.3); the
 * `share_reactions_value_chk` CHECK constraint is defense in depth.
 *
 * Validates: Requirements 11.1, 11.4, 11.5, 11.6, 11.7, 11.8.
 */

import type { ShareReactionDTO, ShareReactionValue } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Persistence surface returned by {@link createReactionsRepo}. */
export interface ReactionsRepo {
  /**
   * Persist (or replace) the recipient's `Share_Reaction`.
   *
   * Throws {@link AppError} with `reaction_forbidden` when the Share was
   * not delivered to the caller (no `share_recipients` row); nothing is
   * persisted in that case (R11.8). On success the reaction is stored at
   * most once per `(share, recipient)` (R11.4), replacing any prior value
   * (R11.5).
   */
  upsertReaction(
    shareId: string,
    recipientId: string,
    reaction: ShareReactionValue,
  ): Promise<void>;

  /**
   * Remove the caller's reaction to a Share (R11.6). Returns `true` when a
   * row was deleted, `false` when the caller had no reaction to remove.
   */
  deleteReaction(shareId: string, recipientId: string): Promise<boolean>;

  /**
   * The sender's view of the reactions on a Share they sent (R11.7).
   *
   * Throws {@link AppError} with `reaction_forbidden` when the caller is
   * not the Share's sender (or the Share does not exist). Returns each
   * reaction with the reactor's display name, ordered oldest-first.
   */
  listReactionsForSender(
    shareId: string,
    senderId: string,
  ): Promise<ShareReactionDTO[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link ReactionsRepo} bound to the supplied pool. Constructor
 * injection (rather than reaching for `getPool()`) keeps the repo testable:
 * unit tests pass a fake whose `query` method records or rewrites SQL.
 */
export function createReactionsRepo(pool: DbPool): ReactionsRepo {
  return {
    upsertReaction: (shareId, recipientId, reaction) =>
      upsertReaction(pool, shareId, recipientId, reaction),
    deleteReaction: (shareId, recipientId) =>
      deleteReaction(pool, shareId, recipientId),
    listReactionsForSender: (shareId, senderId) =>
      listReactionsForSender(pool, shareId, senderId),
  };
}

// ---------------------------------------------------------------------------
// upsertReaction (R11.1, R11.4, R11.5, R11.8)
// ---------------------------------------------------------------------------

/**
 * Insert or replace the recipient's reaction.
 *
 * The `INSERT ... SELECT ... WHERE EXISTS` gates the write on the presence
 * of a `share_recipients (share_id, recipient_id)` row — the authorization
 * predicate for R11.8. When the caller is not a recipient the SELECT yields
 * no source row, so nothing is inserted and `rowCount` is 0; we translate
 * that into `reaction_forbidden`. When the caller is a recipient, exactly
 * one source row is produced and the `ON CONFLICT (share_id, recipient_id)`
 * clause either inserts a new reaction or replaces the existing one (R11.4,
 * R11.5), refreshing `updated_at`.
 *
 * Because authorization and persistence happen in one statement there is no
 * check-then-act race: a recipient row that disappears concurrently simply
 * yields the forbidden path.
 */
async function upsertReaction(
  pool: DbPool,
  shareId: string,
  recipientId: string,
  reaction: ShareReactionValue,
): Promise<void> {
  const result = await pool.query(
    `INSERT INTO share_reactions (share_id, recipient_id, reaction)
     SELECT $1::uuid, $2::uuid, $3
      WHERE EXISTS (
        SELECT 1
          FROM share_recipients sr
         WHERE sr.share_id = $1
           AND sr.recipient_id = $2
      )
     ON CONFLICT (share_id, recipient_id) DO UPDATE
        SET reaction   = EXCLUDED.reaction,
            updated_at = now()`,
    [shareId, recipientId, reaction],
  );

  if ((result.rowCount ?? 0) === 0) {
    // No `share_recipients` row for this (share, recipient): the Share was
    // not delivered to the caller (R11.8). Nothing was persisted.
    throw new AppError(
      'reaction_forbidden',
      'You can only react to a share delivered to you.',
      { field: 'shareId' },
    );
  }
}

// ---------------------------------------------------------------------------
// deleteReaction (R11.6)
// ---------------------------------------------------------------------------

/**
 * Remove the caller's reaction to a Share.
 *
 * Scoped to `(share_id, recipient_id)` so a caller can only ever delete
 * their own reaction. Returns `true` when a row was removed and `false`
 * when the caller had no reaction — the route treats both as success so
 * removal is idempotent.
 */
async function deleteReaction(
  pool: DbPool,
  shareId: string,
  recipientId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM share_reactions
      WHERE share_id = $1
        AND recipient_id = $2`,
    [shareId, recipientId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// listReactionsForSender (R11.7)
// ---------------------------------------------------------------------------

interface ReactionRow {
  reaction: ShareReactionValue;
  reactor_id: string;
  reactor_display_name: string;
  reacted_at: Date | string;
}

/**
 * Return every reaction on a Share for its sender.
 *
 * Authorization gate: we first confirm the Share exists and its `sender_id`
 * equals the caller. A missing Share and a Share owned by someone else both
 * collapse to `reaction_forbidden` so the endpoint cannot enumerate Shares
 * belonging to other users. Only then do we read the reactions, joining
 * `profiles` to disclose each reactor's display name (R11.7). The
 * `updated_at` timestamp — refreshed whenever a reaction is replaced (R11.5)
 * — is projected as `reactedAt`, and rows are ordered oldest-first for a
 * stable sender view.
 */
async function listReactionsForSender(
  pool: DbPool,
  shareId: string,
  senderId: string,
): Promise<ShareReactionDTO[]> {
  const shareResult = await pool.query<{ sender_id: string }>(
    `SELECT sender_id FROM shares WHERE id = $1`,
    [shareId],
  );
  const shareRow = shareResult.rows[0];
  if (!shareRow || shareRow.sender_id !== senderId) {
    // Not the sender (or no such share): R11.7 gates this view to the
    // Share's sender. Collapse both cases to one response.
    throw new AppError(
      'reaction_forbidden',
      'You can only view reactions on a share you sent.',
      { field: 'shareId' },
    );
  }

  const result = await pool.query<ReactionRow>(
    `SELECT r.reaction,
            r.recipient_id       AS reactor_id,
            p.display_name       AS reactor_display_name,
            r.updated_at         AS reacted_at
       FROM share_reactions r
       JOIN profiles p ON p.user_id = r.recipient_id
      WHERE r.share_id = $1
      ORDER BY r.created_at ASC, r.recipient_id ASC`,
    [shareId],
  );

  return result.rows.map((row) => ({
    reaction: row.reaction,
    reactorId: row.reactor_id,
    reactorDisplayName: row.reactor_display_name,
    reactedAt: toIsoTimestamp(row.reacted_at),
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a `TIMESTAMPTZ` column value as an ISO-8601 UTC string. Accepts
 * either a `Date` (the `pg` default) or a string already in ISO shape
 * (which can occur with custom type parsers). Mirrors the helper in
 * `services/sharing/repo.ts`.
 */
function toIsoTimestamp(value: Date | string): string {
  if (typeof value === 'string') return value;
  return value.toISOString();
}
