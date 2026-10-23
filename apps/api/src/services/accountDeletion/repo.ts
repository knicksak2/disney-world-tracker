/**
 * Account-deletion repository (account-deletion design, "Repo (`repo.ts`) surface", "Purge claim SQL",
 * "Trip resolution at purge", "Purge procedure"). All SQL for the request, restore, claim and purge
 * paths lives here; the rules (which stage runs when, retries, the time budget) belong to the service
 * and the runner. Keeping business decisions out of this file is what lets the pure modules
 * (`deletionState`, `ownerSelection`, `dispositions`, `scrub`) stay property-testable.
 *
 * Conventions:
 *  - Every write to a `purge_*` column carries the fencing predicate
 *    `AND deletion_state = 'purging' AND purge_claimed_at = $claimedAt` (a run that lost its claim
 *    changes nothing).
 *  - Chunk statements are keyed by the user id and are idempotent, so they are NOT fenced; each touches
 *    at most `chunkRows` rows (`buildChunkedStatement` always emits a LIMIT).
 *  - Timestamps are JS Dates (UTC `TIMESTAMPTZ`); the application chooses `now`, the database clock is
 *    never consulted for a boundary.
 *
 * Validates: Requirements 2.3, 2.7, 2.8, 2.9, 2.12, 3.1-3.3, 3.6, 3.7, 4.1, 4.4, 4.5, 4.7, 6.3, 7.7,
 *            8.3-8.5, 8.11-8.13, 9.1-9.6, 9.8-9.12, 10.1-10.11, 11.1, 11.3, 11.9, 12.1, 12.3, 12.4,
 *            12.8, 12.9, 17.2, 17.4, 17.5, 17.10
 */
import type { PoolClient } from 'pg';

import type { DbPool } from '../../db/pool.js';
import { orderForClaim, PURGE_STALE_CLAIM_MS, type DeletionState } from './deletionState.js';
import { buildChunkedStatement, DISPOSITIONS, type ChunkOp, type DispositionEntry } from './dispositions.js';
import type {
  AccountDeletionRepo,
  ClaimedAccount,
  DeletionRequestOutcome,
  PurgeCounters,
  TripResolveDeps,
} from './ports.js';
import { planTripResolution, type TripMemberFact } from './ownerSelection.js';
import { scrubSharePayload } from './scrub.js';

/** The ledger keeps the most recent rows only (Neon budget): finalize prunes to this many. */
export const LEDGER_KEEP_ROWS = 1000;

/** `purge_attempts` and `purge_warnings` are SMALLINT; the statements saturate here instead of overflowing. */
const SMALLINT_MAX = 32767;

/** Share payload kinds whose JSONB embeds a person (see `scrub.ts`). */
const SCRUBBED_PAYLOAD_KINDS = ['pinShowcase', 'tripSummary'] as const;

/** A pool or a transaction client: both expose the same `query` signature. */
type Queryable = DbPool | PoolClient;

export interface AccountDeletionRepoOptions {
  /** `ACCOUNT_DELETION_CHUNK_ROWS`: the row cap of every per-user chunk statement. */
  readonly chunkRows: number;
}

const FENCE = `id = $1 AND deletion_state = 'purging' AND purge_claimed_at = $2`;

const COUNTER_COLUMNS: Readonly<Record<keyof PurgeCounters, string>> = {
  tripsTransferred: 'purge_trips_transferred',
  tripsDeleted: 'purge_trips_deleted',
  photosDeleted: 'purge_photos_deleted',
};

/**
 * One SQL fragment for the counter increments, shared by `advanceStage` and `addCounters` so the two
 * can never diverge. Returns `{ sql: ', purge_x = purge_x + $n ...', params }` with placeholders numbered
 * from `firstParam`; an empty or all-zero `deltas` yields an empty fragment.
 */
function counterAssignments(
  deltas: Partial<PurgeCounters> | undefined,
  firstParam: number,
): { sql: string; params: number[] } {
  const parts: string[] = [];
  const params: number[] = [];
  for (const key of Object.keys(COUNTER_COLUMNS) as (keyof PurgeCounters)[]) {
    const delta = deltas?.[key];
    if (delta === undefined || delta === 0) continue;
    if (!Number.isInteger(delta) || delta < 0) {
      throw new RangeError(`counter delta ${key} must be a non-negative integer, got ${String(delta)}`);
    }
    params.push(delta);
    parts.push(`${COUNTER_COLUMNS[key]} = ${COUNTER_COLUMNS[key]} + $${firstParam + params.length - 1}`);
  }
  return { sql: parts.length > 0 ? `, ${parts.join(', ')}` : '', params };
}

interface UserStateRow {
  id: string;
  deletion_state: string;
}

interface MembershipRow {
  user_id: string;
  role: 'organizer' | 'member';
  joined_at: Date;
}

export function createAccountDeletionRepo(pool: DbPool, options: AccountDeletionRepoOptions): AccountDeletionRepo {
  const chunkRows = options.chunkRows;
  if (!Number.isInteger(chunkRows) || chunkRows < 1) {
    throw new RangeError(`createAccountDeletionRepo: chunkRows must be a positive integer, got ${String(chunkRows)}`);
  }

  async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // keep the original cause
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Request / restore
  // ---------------------------------------------------------------------------------------------

  async function restoreOn(db: Queryable, userId: string, now: Date): Promise<string | null> {
    const res = await db.query<{ email: string }>(
      `UPDATE users
          SET deletion_state = 'active',
              deletion_requested_at = NULL,
              scheduled_purge_at = NULL,
              placeholder_id = NULL
        WHERE id = $1
          AND deletion_state = 'pending_deletion'
          AND scheduled_purge_at > $2
        RETURNING email`,
      [userId, now],
    );
    return res.rows.length > 0 ? String(res.rows[0]!.email) : null;
  }

  async function transitionActiveUserToPending(
    client: PoolClient,
    args: {
      userId: string;
      now: Date;
      scheduledPurgeAt: Date;
      placeholderId: string;
    },
  ): Promise<string | null> {
    const moved = await client.query<{ email: string }>(
      `UPDATE users
          SET deletion_state = 'pending_deletion',
              deletion_requested_at = $2,
              scheduled_purge_at = $3,
              placeholder_id = $4
        WHERE id = $1 AND deletion_state = 'active'
        RETURNING email`,
      [args.userId, args.now, args.scheduledPurgeAt, args.placeholderId],
    );
    if (moved.rows.length === 0) {
      return null;
    }

    // Revoke every session, the caller's included (an already-revoked session keeps its timestamp).
    await client.query(
      `UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE user_id = $1`,
      [args.userId, args.now],
    );
    // Expire unused reset codes issued before the request.
    await client.query(
      `UPDATE password_reset_tokens
          SET expires_at = $2
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > $2`,
      [args.userId, args.now],
    );
    // No push token may stay active.
    await client.query(`DELETE FROM push_registrations WHERE user_id = $1`, [args.userId]);

    return String(moved.rows[0]!.email);
  }

  async function consumeGrantAndRequestDeletion(args: {
    userId: string;
    sessionId: string;
    grantHash: string;
    now: Date;
    scheduledPurgeAt: Date;
    placeholderId: string;
  }): Promise<DeletionRequestOutcome> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Consume the grant: bound to the user AND the session, unexpired, matching hash.
      const grant = await client.query(
        `DELETE FROM account_deletion_reauth_grants
          WHERE session_id = $1 AND user_id = $2 AND grant_hash = $3 AND expires_at > $4
          RETURNING session_id`,
        [args.sessionId, args.userId, args.grantHash, args.now],
      );
      if (grant.rows.length === 0) {
        await client.query('ROLLBACK');
        return { outcome: 'reauth_required' };
      }

      // 2. The conditional transition + session revocation + reset-token expiry + push token deletion.
      const email = await transitionActiveUserToPending(client, args);
      if (email === null) {
        await client.query('ROLLBACK');
        return { outcome: 'not_active' };
      }

      await client.query('COMMIT');
      return { outcome: 'ok', email };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // keep the original cause
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async function findActiveUserByEmail(
    email: string,
  ): Promise<{ id: string; email: string; passwordHash: string } | null> {
    const res = await pool.query<{ id: string; email: string; password_hash: string }>(
      `SELECT id, email, password_hash FROM users WHERE LOWER(email) = LOWER($1) AND deletion_state = 'active'`,
      [email],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0]!;
    return {
      id: String(row.id),
      email: String(row.email),
      passwordHash: String(row.password_hash),
    };
  }

  async function requestDeletionForUser(args: {
    userId: string;
    now: Date;
    scheduledPurgeAt: Date;
    placeholderId: string;
  }): Promise<{ outcome: 'ok'; email: string } | { outcome: 'not_active' }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const email = await transitionActiveUserToPending(client, args);
      if (email === null) {
        await client.query('ROLLBACK');
        return { outcome: 'not_active' };
      }
      await client.query('COMMIT');
      return { outcome: 'ok', email };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // keep the original cause
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async function issueGrant(args: {
    userId: string;
    sessionId: string;
    grantHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void> {
    await inTransaction(async (client) => {
      // The only pruner (R2.12): no idle write exists anywhere else.
      await client.query(`DELETE FROM account_deletion_reauth_grants WHERE expires_at < $1`, [args.now]);
      await client.query(
        `INSERT INTO account_deletion_reauth_grants (session_id, user_id, grant_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id) DO UPDATE
            SET user_id = EXCLUDED.user_id,
                grant_hash = EXCLUDED.grant_hash,
                expires_at = EXCLUDED.expires_at,
                created_at = EXCLUDED.created_at`,
        [args.sessionId, args.userId, args.grantHash, args.expiresAt, args.now],
      );
    });
  }

  async function restore(userId: string, now: Date): Promise<{ restored: boolean; email: string | null }> {
    const email = await restoreOn(pool, userId, now);
    return { restored: email !== null, email };
  }

  async function restoreInTx(
    client: PoolClient,
    userId: string,
    now: Date,
  ): Promise<'restored' | 'not_needed' | 'not_restorable'> {
    if ((await restoreOn(client, userId, now)) !== null) return 'restored';
    const res = await client.query<{ deletion_state: string }>(
      `SELECT deletion_state FROM users WHERE id = $1`,
      [userId],
    );
    return res.rows[0]?.deletion_state === 'active' ? 'not_needed' : 'not_restorable';
  }

  async function getPasswordHash(userId: string): Promise<string | null> {
    const res = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    return res.rows.length > 0 ? String(res.rows[0]!.password_hash) : null;
  }

  async function getEmail(userId: string): Promise<string | null> {
    const res = await pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
    return res.rows.length > 0 ? String(res.rows[0]!.email) : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Claim and fencing
  // ---------------------------------------------------------------------------------------------

  interface ClaimRow {
    id: string;
    placeholder_id: string;
    deletion_requested_at: Date;
    scheduled_purge_at: Date;
    purge_stage: number;
    purge_attempts: number;
  }

  async function claimDue(now: Date, limit: number): Promise<readonly ClaimedAccount[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`claimDue: limit must be a positive integer, got ${String(limit)}`);
    }
    // $1 = now (also the fencing token), $2 = now - PURGE_STALE_CLAIM_MS, $3 = batch.
    const staleBefore = new Date(now.getTime() - PURGE_STALE_CLAIM_MS);
    const res = await pool.query<ClaimRow>(
      `UPDATE users
          SET deletion_state   = 'purging',
              purge_claimed_at = $1,
              purge_stage      = CASE WHEN deletion_state = 'purging' THEN purge_stage ELSE 0 END
        WHERE id = ANY(ARRAY(
                SELECT id FROM users
                 WHERE (deletion_state = 'pending_deletion' AND scheduled_purge_at <= $1)
                    OR (deletion_state = 'purging'
                        AND (purge_claimed_at IS NULL OR purge_claimed_at <= $2))
                 ORDER BY purge_attempts ASC, scheduled_purge_at ASC, id ASC
                 LIMIT $3
                 FOR UPDATE SKIP LOCKED))
        RETURNING id, placeholder_id, deletion_requested_at, scheduled_purge_at, purge_stage, purge_attempts`,
      [now, staleBefore, limit],
    );
    const claimedAt = new Date(now.getTime());
    return [...res.rows]
      .map((r) => ({
        order: {
          attempts: Number(r.purge_attempts),
          scheduledPurgeAt: new Date(r.scheduled_purge_at),
          id: String(r.id),
        },
        account: {
          id: String(r.id),
          placeholderId: String(r.placeholder_id),
          deletionRequestedAt: new Date(r.deletion_requested_at),
          claimedAt,
          stage: Number(r.purge_stage),
          attempts: Number(r.purge_attempts),
        } satisfies ClaimedAccount,
      }))
      .sort((a, b) => orderForClaim(a.order, b.order))
      .map((x) => x.account);
  }

  async function releaseClaim(c: ClaimedAccount): Promise<boolean> {
    const res = await pool.query(`UPDATE users SET purge_claimed_at = NULL WHERE ${FENCE} RETURNING id`, [
      c.id,
      c.claimedAt,
    ]);
    return res.rows.length > 0;
  }

  async function advanceStage(
    c: ClaimedAccount,
    completed: number,
    deltas?: Partial<PurgeCounters>,
  ): Promise<boolean> {
    if (!Number.isInteger(completed) || completed < 0 || completed > 4) {
      throw new RangeError(`advanceStage: completed must be an integer 0..4, got ${String(completed)}`);
    }
    const counters = counterAssignments(deltas, 4);
    const res = await pool.query(
      `UPDATE users SET purge_stage = $3, purge_attempts = 0${counters.sql} WHERE ${FENCE} RETURNING id`,
      [c.id, c.claimedAt, completed, ...counters.params],
    );
    return res.rows.length > 0;
  }

  async function addCounters(c: ClaimedAccount, deltas: Partial<PurgeCounters>): Promise<boolean> {
    const counters = counterAssignments(deltas, 3);
    // An empty delta still runs the fenced statement (a no-op assignment) so it reports fenced-out correctly.
    const assignments = counters.sql.length > 0 ? counters.sql.slice(2) : 'purge_stage = purge_stage';
    const res = await pool.query(`UPDATE users SET ${assignments} WHERE ${FENCE} RETURNING id`, [
      c.id,
      c.claimedAt,
      ...counters.params,
    ]);
    return res.rows.length > 0;
  }

  async function rewindStage(c: ClaimedAccount, stage: 0): Promise<boolean> {
    if (stage !== 0) throw new RangeError('rewindStage only rewinds to 0 (every stage re-runs)');
    const res = await pool.query(`UPDATE users SET purge_stage = $3 WHERE ${FENCE} RETURNING id`, [
      c.id,
      c.claimedAt,
      stage,
    ]);
    return res.rows.length > 0;
  }

  async function recordFailedAttempt(
    c: ClaimedAccount,
    now: Date,
    absoluteAttempts?: number,
  ): Promise<number | null> {
    if (absoluteAttempts !== undefined && (!Number.isInteger(absoluteAttempts) || absoluteAttempts < 0)) {
      throw new RangeError(`recordFailedAttempt: absoluteAttempts must be a non-negative integer`);
    }
    const attempts =
      absoluteAttempts === undefined
        ? `LEAST(purge_attempts + 1, ${SMALLINT_MAX})`
        : `LEAST($4::int, ${SMALLINT_MAX})`;
    const params: unknown[] = [c.id, c.claimedAt, now];
    if (absoluteAttempts !== undefined) params.push(absoluteAttempts);
    const res = await pool.query<{ purge_attempts: number }>(
      `UPDATE users
          SET purge_attempts = ${attempts},
              purge_last_attempt_at = $3,
              purge_claimed_at = NULL
        WHERE ${FENCE}
        RETURNING purge_attempts`,
      params,
    );
    return res.rows.length > 0 ? Number(res.rows[0]!.purge_attempts) : null;
  }

  async function recordWarning(c: ClaimedAccount): Promise<boolean> {
    const res = await pool.query(
      `UPDATE users SET purge_warnings = LEAST(purge_warnings + 1, ${SMALLINT_MAX}) WHERE ${FENCE} RETURNING id`,
      [c.id, c.claimedAt],
    );
    return res.rows.length > 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Trip resolution (one transaction per trip, design order, R10.10)
  // ---------------------------------------------------------------------------------------------

  async function listTripsOf(userId: string): Promise<readonly string[]> {
    const res = await pool.query<{ id: string }>(
      `SELECT trip_id AS id FROM trip_memberships WHERE user_id = $1
       UNION
       SELECT id FROM trips WHERE creator_id = $1
       ORDER BY id`,
      [userId],
    );
    return res.rows.map((r) => String(r.id));
  }

  async function resolveTrip(
    c: ClaimedAccount,
    tripId: string,
    deps: TripResolveDeps,
  ): Promise<'deleted' | 'transferred' | 'unchanged' | 'fenced'> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock the trip row first. No row: already gone.
      const trip = await client.query<{ id: string; creator_id: string }>(
        `SELECT id, creator_id FROM trips WHERE id = $1 FOR UPDATE`,
        [tripId],
      );
      if (trip.rows.length === 0) {
        await client.query('COMMIT');
        return 'unchanged';
      }
      const creatorId = String(trip.rows[0]!.creator_id);

      if (deps.afterTripLocked) await deps.afterTripLocked(client);

      // 2. Roster, read AFTER the lock: two plain statements merged in TypeScript.
      const memberRows = await client.query<MembershipRow>(
        `SELECT user_id, role, joined_at FROM trip_memberships WHERE trip_id = $1 FOR UPDATE`,
        [tripId],
      );
      const memberIds = memberRows.rows.map((m) => String(m.user_id));
      const states = new Map<string, DeletionState>();
      if (memberIds.length > 0) {
        const stateRows = await client.query<UserStateRow>(
          `SELECT id, deletion_state FROM users WHERE id = ANY($1::uuid[])`,
          [memberIds],
        );
        for (const s of stateRows.rows) states.set(String(s.id), String(s.deletion_state) as DeletionState);
      }
      const members: TripMemberFact[] = memberRows.rows.map((m) => ({
        userId: String(m.user_id),
        role: m.role,
        joinedAt: new Date(m.joined_at),
        // A membership whose user row vanished can never be a candidate.
        state: states.get(String(m.user_id)) ?? 'tombstone',
      }));

      // 3. Plan from the rows just read.
      const plan = planTripResolution({ purgedUserId: c.id, creatorId, members });

      let result: 'deleted' | 'transferred' | 'unchanged';
      let counterSql: string;
      if (plan.kind === 'delete_trip') {
        // 4. Photos on THIS client, then the trip: both commit or neither.
        await deps.photoPort.softDeleteTripPhotos(tripId, deps.now, client);
        await client.query(`DELETE FROM trips WHERE id = $1`, [tripId]);
        result = 'deleted';
        counterSql = `purge_trips_deleted = purge_trips_deleted + 1`;
      } else {
        // 5. keep_trip
        if (plan.promoteUserId !== null) {
          await client.query(
            `UPDATE trip_memberships SET role = 'organizer' WHERE trip_id = $1 AND user_id = $2`,
            [tripId, plan.promoteUserId],
          );
        }
        if (plan.newCreatorId !== null) {
          await client.query(`UPDATE trips SET creator_id = $2, updated_at = $3 WHERE id = $1`, [
            tripId,
            plan.newCreatorId,
            deps.now,
          ]);
        }
        // Pending rode-with tags the purged user created (log entries they authored) or is named in.
        await client.query(
          `UPDATE rode_with_tags
              SET state = 'cancelled', updated_at = $3
            WHERE state = 'pending'
              AND log_entry_id IN (SELECT id FROM trip_log_entries WHERE trip_id = $1)
              AND (tagged_member_id = $2
                   OR log_entry_id IN (SELECT id FROM trip_log_entries WHERE trip_id = $1 AND member_id = $2))`,
          [tripId, c.id, deps.now],
        );
        await client.query(`DELETE FROM trip_invites WHERE trip_id = $1 AND (inviter_id = $2 OR invitee_id = $2)`, [
          tripId,
          c.id,
        ]);
        if (plan.removeMembership) {
          await client.query(`DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`, [tripId, c.id]);
        }
        const transferred = plan.newCreatorId !== null || plan.promoteUserId !== null;
        result = transferred ? 'transferred' : 'unchanged';
        counterSql = transferred
          ? `purge_trips_transferred = purge_trips_transferred + 1`
          : `purge_trips_transferred = purge_trips_transferred`;
      }

      // Fenced counter in the same transaction: no matching row means the claim was lost, so undo the trip.
      const fenced = await client.query(
        `UPDATE users SET ${counterSql}
          WHERE id = $1 AND deletion_state = 'purging' AND purge_claimed_at = $2
          RETURNING id`,
        [c.id, c.claimedAt],
      );
      if (fenced.rows.length === 0) {
        await client.query('ROLLBACK');
        return 'fenced';
      }

      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // keep the original cause
      }
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Tombstone, anonymize, share scrub
  // ---------------------------------------------------------------------------------------------

  async function ensureTombstone(c: ClaimedAccount): Promise<string> {
    const placeholderId = c.placeholderId;
    // Each parameter has exactly one type with an explicit cast, and the address is built here, never
    // with `||` in SQL: Postgres would deduce $1 as text from the concatenation and reject the uuid column.
    await inTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, email, password_hash, deletion_state, created_at)
         VALUES ($1::uuid, $2::text, '!', 'tombstone', '1970-01-01T00:00:00Z'::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [placeholderId, `${placeholderId}@deleted.invalid`],
      );
      await client.query(
        `INSERT INTO profiles (user_id, display_name) VALUES ($1::uuid, 'Deleted user')
         ON CONFLICT (user_id) DO NOTHING`,
        [placeholderId],
      );
    });
    return placeholderId;
  }

  /** Runs one chunk of a built statement; `tombstoneId` is only used by anonymizing ops. Returns rows changed. */
  async function runChunk(entry: DispositionEntry, op: ChunkOp, userId: string, tombstoneId?: string): Promise<number> {
    const stmt = buildChunkedStatement(entry, op, {
      userId,
      chunkRows,
      ...(tombstoneId === undefined ? {} : { tombstoneId }),
    });
    if (stmt.kind === 'single') {
      const res = await pool.query(stmt.sql, [...stmt.params]);
      return res.rowCount ?? 0;
    }
    // per_key: a bounded SELECT of key tuples, then one single-row statement per tuple, in one transaction.
    const anonymizes = op === 'anonymize' || op === 'anonymize_retained';
    return inTransaction(async (client) => {
      const tuples = await client.query<Record<string, unknown>>(stmt.selectSql, [...stmt.selectParams]);
      let changed = 0;
      for (const row of tuples.rows) {
        const keyValues = stmt.keyColumns.map((k) => row[k]);
        const params = anonymizes ? [userId, tombstoneId, ...keyValues] : [userId, ...keyValues];
        const res = await client.query(stmt.perKeySql, params);
        changed += res.rowCount ?? 0;
      }
      return changed;
    });
  }

  async function anonymizeChunk(c: ClaimedAccount, entry: DispositionEntry, tombstoneId: string): Promise<number> {
    if (entry.disposition === 'anonymize') return runChunk(entry, 'anonymize', c.id, tombstoneId);
    if (entry.disposition === 'anonymize_then_delete') return runChunk(entry, 'anonymize_retained', c.id, tombstoneId);
    throw new Error(`anonymizeChunk: ${entry.table}.${entry.column} has disposition '${entry.disposition}'`);
  }

  async function scrubShares(
    c: ClaimedAccount,
    tombstoneId: string,
    afterId: string | null = null,
  ): Promise<{ lastId: string | null; scrubbed: number }> {
    // Selected by sender (the user, or the tombstone after the re-point), never by JSON path.
    const params: unknown[] = [c.id, tombstoneId, chunkRows];
    const cursor = afterId === null ? '' : ` AND id > $4`;
    if (afterId !== null) params.push(afterId);
    const page = await pool.query<{ id: string; payload_snapshot: unknown }>(
      `SELECT id, payload_snapshot FROM shares
        WHERE sender_id IN ($1, $2)
          AND payload_kind IN ('${SCRUBBED_PAYLOAD_KINDS.join("', '")}')${cursor}
        ORDER BY id
        LIMIT $3`,
      params,
    );
    let scrubbed = 0;
    for (const row of page.rows) {
      const next = scrubSharePayload(row.payload_snapshot, tombstoneId);
      if (next === row.payload_snapshot) continue; // already scrubbed: write nothing
      await pool.query(`UPDATE shares SET payload_snapshot = $2::jsonb WHERE id = $1`, [row.id, JSON.stringify(next)]);
      scrubbed += 1;
    }
    const last = page.rows.length > 0 ? String(page.rows[page.rows.length - 1]!.id) : null;
    return { lastId: last, scrubbed };
  }

  // ---------------------------------------------------------------------------------------------
  // Recompute queue, delete / nullify chunks, remaining references, finalize
  // ---------------------------------------------------------------------------------------------

  async function enqueueRatedChunk(
    userId: string,
    afterExperienceId: string | null,
  ): Promise<{ lastId: string | null; count: number }> {
    // Two statement texts: the cursor condition is present only when there is a cursor.
    const page =
      afterExperienceId === null
        ? await pool.query<{ experience_id: string }>(
            `SELECT experience_id FROM ratings WHERE user_id = $1 ORDER BY experience_id LIMIT $2`,
            [userId, chunkRows],
          )
        : await pool.query<{ experience_id: string }>(
            `SELECT experience_id FROM ratings WHERE user_id = $1 AND experience_id > $2
              ORDER BY experience_id LIMIT $3`,
            [userId, afterExperienceId, chunkRows],
          );
    if (page.rows.length === 0) return { lastId: null, count: 0 };
    const ids = page.rows.map((r) => String(r.experience_id));
    const values = ids.map((_, i) => `($${i + 1}::uuid)`).join(', ');
    await pool.query(
      `INSERT INTO account_deletion_recompute_queue (experience_id) VALUES ${values}
       ON CONFLICT (experience_id) DO NOTHING`,
      ids,
    );
    // The cursor is the last id of the PAGE READ: RETURNING omits conflicting rows and would stop early.
    return { lastId: ids[ids.length - 1]!, count: ids.length };
  }

  async function applyDeleteOrNullChunk(c: ClaimedAccount, entry: DispositionEntry): Promise<number> {
    switch (entry.disposition) {
      case 'delete':
      case 'session':
        return runChunk(entry, 'delete', c.id);
      case 'nullify':
        return runChunk(entry, 'nullify', c.id);
      case 'anonymize_then_delete': {
        // Safety: a retained row (a surviving trip log entry depends on it) still naming the user would be
        // deleted here and cascade into that entry. Stage 3 must have re-pointed it first.
        const retained = await pool.query(
          `SELECT 1 FROM ${entry.table} WHERE ${entry.column} = $1 AND (${entry.retainWhere}) LIMIT 1`,
          [c.id],
        );
        if (retained.rows.length > 0) {
          throw new Error(
            `applyDeleteOrNullChunk: ${entry.table}.${entry.column} still has rows a survivor depends on; stage 3 must anonymize them first`,
          );
        }
        return runChunk(entry, 'delete', c.id);
      }
      default:
        throw new Error(`applyDeleteOrNullChunk: ${entry.table}.${entry.column} has disposition '${entry.disposition}'`);
    }
  }

  async function countRemaining(
    db: Queryable,
    userId: string,
  ): Promise<readonly { table: string; column: string; count: number }[]> {
    const out: { table: string; column: string; count: number }[] = [];
    for (const entry of DISPOSITIONS) {
      let where: string;
      if (entry.disposition === 'anonymize' || entry.disposition === 'nullify' || entry.disposition === 'trip') {
        where = `${entry.column} = $1`;
      } else if (entry.disposition === 'anonymize_then_delete') {
        where = `${entry.column} = $1 AND (${entry.retainWhere})`;
      } else {
        continue;
      }
      const res = await db.query<{ n: string | number }>(
        `SELECT count(*) AS n FROM ${entry.table} WHERE ${where}`,
        [userId],
      );
      const count = Number(res.rows[0]?.n ?? 0);
      if (count > 0) out.push({ table: entry.table, column: entry.column, count });
    }
    return out;
  }

  async function countRemainingReferences(
    userId: string,
  ): Promise<readonly { table: string; column: string; count: number }[]> {
    return countRemaining(pool, userId);
  }

  async function finalize(c: ClaimedAccount, now: Date): Promise<'purged' | 'fenced' | 'refs_remain'> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the user row and confirm the claim is still ours.
      const locked = await client.query<{
        deletion_requested_at: Date;
        purge_trips_transferred: number;
        purge_trips_deleted: number;
        purge_photos_deleted: number;
        purge_warnings: number;
      }>(
        `SELECT deletion_requested_at, purge_trips_transferred, purge_trips_deleted, purge_photos_deleted,
                purge_warnings
           FROM users
          WHERE ${FENCE}
          FOR UPDATE`,
        [c.id, c.claimedAt],
      );
      if (locked.rows.length === 0) {
        await client.query('ROLLBACK');
        return 'fenced';
      }
      const row = locked.rows[0]!;

      if ((await countRemaining(client, c.id)).length > 0) {
        await client.query('ROLLBACK');
        return 'refs_remain';
      }

      // The outcome is decided from the locked row BEFORE the row that carries the warnings is deleted.
      const outcome = Number(row.purge_warnings) > 0 ? 'completed_with_warnings' : 'completed';

      await client.query(`DELETE FROM users WHERE id = $1`, [c.id]);
      await client.query(
        `INSERT INTO account_deletion_ledger
           (requested_at, purged_at, trips_transferred, trips_deleted, photos_deleted, outcome)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          row.deletion_requested_at,
          now,
          Number(row.purge_trips_transferred),
          Number(row.purge_trips_deleted),
          Number(row.purge_photos_deleted),
          outcome,
        ],
      );

      // Keep the most recent LEDGER_KEEP_ROWS: a bounded page of ids past the window, then delete by id.
      const surplus = await client.query<{ id: string }>(
        `SELECT id FROM account_deletion_ledger ORDER BY purged_at DESC, id DESC OFFSET $1 LIMIT $2`,
        [LEDGER_KEEP_ROWS, chunkRows],
      );
      if (surplus.rows.length > 0) {
        await client.query(`DELETE FROM account_deletion_ledger WHERE id = ANY($1::uuid[])`, [
          surplus.rows.map((r) => String(r.id)),
        ]);
      }

      await client.query('COMMIT');
      return 'purged';
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // keep the original cause
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async function drainRecomputeQueue(
    limit: number,
    recompute: (experienceId: string) => Promise<unknown>,
  ): Promise<number> {
    const queued = await pool.query<{ experience_id: string }>(
      `SELECT experience_id FROM account_deletion_recompute_queue
        ORDER BY enqueued_at ASC, experience_id ASC
        LIMIT $1`,
      [limit],
    );
    let done = 0;
    for (const q of queued.rows) {
      const experienceId = String(q.experience_id);
      try {
        await recompute(experienceId);
      } catch {
        // Leave the row: the next run retries it, and one bad experience never blocks the rest.
        continue;
      }
      await pool.query(`DELETE FROM account_deletion_recompute_queue WHERE experience_id = $1`, [experienceId]);
      done += 1;
    }
    return done;
  }

  return {
    consumeGrantAndRequestDeletion,
    findActiveUserByEmail,
    requestDeletionForUser,
    issueGrant,
    restore,
    restoreInTx,
    getPasswordHash,
    getEmail,
    claimDue,
    releaseClaim,
    advanceStage,
    addCounters,
    rewindStage,
    recordFailedAttempt,
    recordWarning,
    listTripsOf,
    resolveTrip,
    ensureTombstone,
    anonymizeChunk,
    scrubShares,
    enqueueRatedChunk,
    applyDeleteOrNullChunk,
    countRemainingReferences,
    finalize,
    drainRecomputeQueue,
  };
}
