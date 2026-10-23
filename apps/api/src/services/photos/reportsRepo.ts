/**
 * Reports, Blocks, and Bans repository.
 *
 * Implements: Task 7.2
 * Validates: Requirements 3.7, 5.9, 16.1, 16.3, 16.6, 17.1, 17.2, 18.5, 18.6, 18.11
 */

import type { PoolClient } from 'pg';
import type { DbPool } from '../../db/pool.js';

export interface PhotoReportRow {
  readonly id: string;
  readonly photo_id: string;
  readonly reporter_id: string;
  readonly reason: string;
  readonly note: string | null;
  readonly status: 'open' | 'upheld' | 'dismissed';
  readonly created_at: Date;
  readonly resolved_at: Date | null;
}

export interface UserBlockRow {
  readonly id: string;
  readonly blocker_id: string;
  readonly blocked_id: string;
  readonly created_at: Date;
}

export interface BlockWithProfileRow {
  readonly id: string;
  readonly blocked_id: string;
  readonly created_at: Date;
  readonly display_name: string | null;
  readonly avatar_preset: string | null;
}

export interface PhotoUploadBanRow {
  readonly user_id: string;
  readonly reason: string | null;
  readonly created_at: Date;
}

export interface ReportsRepo {
  addReport(
    params: { photoId: string; reporterId: string; reason: string; note?: string | null },
    client?: DbPool | PoolClient
  ): Promise<boolean>;
  countOpenDistinct(photoId: string, client?: DbPool | PoolClient): Promise<number>;
  countedOpenReports(photoId: string, client?: DbPool | PoolClient): Promise<number>;
  dismissOpen(photoId: string, now?: Date, client?: DbPool | PoolClient): Promise<number>;
  uphold(photoId: string, now?: Date, client?: DbPool | PoolClient): Promise<number>;
  addBlock(blockerId: string, blockedId: string, client?: DbPool | PoolClient): Promise<UserBlockRow>;
  removeBlockById(blockerId: string, blockId: string, client?: DbPool | PoolClient): Promise<boolean>;
  listBlocks(blockerId: string, client?: DbPool | PoolClient): Promise<readonly BlockWithProfileRow[]>;
  isBlockedEitherWay(userA: string, userB: string, client?: DbPool | PoolClient): Promise<boolean>;
  addBan(userId: string, reason?: string | null, client?: DbPool | PoolClient): Promise<PhotoUploadBanRow>;
  isBanned(userId: string, client?: DbPool | PoolClient): Promise<boolean>;
  removePhotoByOperator(
    photoId: string,
    now?: Date,
    client?: DbPool | PoolClient
  ): Promise<{ removed: boolean; ownerId: string | null }>;
  upheldCountForUser(userId: string, client?: DbPool | PoolClient): Promise<number>;
  getProfile(
    userId: string,
    client?: DbPool | PoolClient
  ): Promise<{ displayName: string; avatarPreset: string | null } | null>;
}

export function createReportsRepo(pool: DbPool): ReportsRepo {
  const getDb = (client?: DbPool | PoolClient) => client ?? pool;

  return {
    async addReport(
      params: { photoId: string; reporterId: string; reason: string; note?: string | null },
      client?: DbPool | PoolClient
    ): Promise<boolean> {
      const db = getDb(client);
      const sql = `
        INSERT INTO photo_reports (photo_id, reporter_id, reason, note)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (photo_id, reporter_id) DO NOTHING
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [
        params.photoId,
        params.reporterId,
        params.reason,
        params.note ?? null,
      ]);
      return res.rows.length > 0;
    },

    async countOpenDistinct(photoId: string, client?: DbPool | PoolClient): Promise<number> {
      const db = getDb(client);
      const photoRes = await db.query<{ target_kind: string; scope_id: string }>(
        'SELECT target_kind, scope_id FROM photos WHERE id = $1;',
        [photoId]
      );
      if (photoRes.rows.length === 0) return 0;
      const row = photoRes.rows[0];
      if (!row) return 0;

      // For a food photo: every distinct open reporter.
      // For a trip photo: distinct open reporters who are current members of the trip (R16.4, R16.9, D31).
      if (row.target_kind === 'trip') {
        const sql = `
          SELECT count(DISTINCT r.reporter_id)::int AS count
            FROM photo_reports r
            JOIN trip_memberships m ON m.trip_id = $2 AND m.user_id = r.reporter_id
           WHERE r.photo_id = $1 AND r.status = 'open';
        `;
        const res = await db.query<{ count: number }>(sql, [photoId, row.scope_id]);
        return res.rows[0]?.count ?? 0;
      }

      const sql = `
        SELECT count(DISTINCT reporter_id)::int AS count
          FROM photo_reports
         WHERE photo_id = $1 AND status = 'open';
      `;
      const res = await db.query<{ count: number }>(sql, [photoId]);
      return res.rows[0]?.count ?? 0;
    },

    async countedOpenReports(photoId: string, client?: DbPool | PoolClient): Promise<number> {
      return this.countOpenDistinct(photoId, client);
    },

    async dismissOpen(photoId: string, now?: Date, client?: DbPool | PoolClient): Promise<number> {
      const db = getDb(client);
      const sql = `
        UPDATE photo_reports
           SET status = 'dismissed',
               resolved_at = COALESCE($2, now())
         WHERE photo_id = $1
           AND status = 'open'
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [photoId, now ?? null]);
      return res.rowCount ?? res.rows.length;
    },

    async uphold(photoId: string, now?: Date, client?: DbPool | PoolClient): Promise<number> {
      const db = getDb(client);
      const sql = `
        UPDATE photo_reports
           SET status = 'upheld',
               resolved_at = COALESCE($2, now())
         WHERE photo_id = $1
           AND status = 'open'
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [photoId, now ?? null]);
      return res.rowCount ?? res.rows.length;
    },

    async addBlock(blockerId: string, blockedId: string, client?: DbPool | PoolClient): Promise<UserBlockRow> {
      const db = getDb(client);
      const sql = `
        INSERT INTO user_blocks (blocker_id, blocked_id)
        VALUES ($1, $2)
        ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET blocker_id = EXCLUDED.blocker_id
        RETURNING id, blocker_id, blocked_id, created_at;
      `;
      const res = await db.query<UserBlockRow>(sql, [blockerId, blockedId]);
      const row = res.rows[0];
      if (!row) throw new Error('addBlock failed to return row');
      return row;
    },

    async removeBlockById(blockerId: string, blockId: string, client?: DbPool | PoolClient): Promise<boolean> {
      const db = getDb(client);
      const sql = `
        DELETE FROM user_blocks
         WHERE id = $2 AND blocker_id = $1
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [blockerId, blockId]);
      return res.rows.length > 0;
    },

    async listBlocks(blockerId: string, client?: DbPool | PoolClient): Promise<readonly BlockWithProfileRow[]> {
      const db = getDb(client);
      const sql = `
        SELECT b.id, b.blocked_id, b.created_at, pr.display_name, pr.avatar_preset
          FROM user_blocks b
          LEFT JOIN profile_identity pr ON pr.user_id = b.blocked_id
         WHERE b.blocker_id = $1
           AND COALESCE(pr.is_visible, TRUE)
         ORDER BY b.created_at DESC, b.id DESC;
      `;
      const res = await db.query<BlockWithProfileRow>(sql, [blockerId]);
      return res.rows;
    },

    async isBlockedEitherWay(userA: string, userB: string, client?: DbPool | PoolClient): Promise<boolean> {
      const db = getDb(client);
      const sql = `
        SELECT 1
          FROM user_blocks
         WHERE (blocker_id = $1 AND blocked_id = $2)
            OR (blocker_id = $2 AND blocked_id = $1)
         LIMIT 1;
      `;
      const res = await db.query(sql, [userA, userB]);
      return res.rows.length > 0;
    },

    async addBan(userId: string, reason?: string | null, client?: DbPool | PoolClient): Promise<PhotoUploadBanRow> {
      const db = getDb(client);
      const sql = `
        INSERT INTO photo_upload_bans (user_id, reason)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason
        RETURNING user_id, reason, created_at;
      `;
      const res = await db.query<PhotoUploadBanRow>(sql, [userId, reason ?? null]);
      const row = res.rows[0];
      if (!row) throw new Error('addBan failed to return row');
      return row;
    },

    async isBanned(userId: string, client?: DbPool | PoolClient): Promise<boolean> {
      const db = getDb(client);
      const sql = `SELECT 1 FROM photo_upload_bans WHERE user_id = $1 LIMIT 1;`;
      const res = await db.query(sql, [userId]);
      return res.rows.length > 0;
    },

    async removePhotoByOperator(
      photoId: string,
      now?: Date,
      client?: DbPool | PoolClient
    ): Promise<{ removed: boolean; ownerId: string | null }> {
      // Must be run atomically. If a client is provided, use it; otherwise acquire one and run inside BEGIN...COMMIT.
      const runTransaction = async (conn: PoolClient | DbPool) => {
        // Step 1: Mark photo deleted where status IN ('approved','hidden','needs_review','pending','rejected')
        const deleteSql = `
          UPDATE photos
             SET status = 'deleted',
                 deleted_at = COALESCE($2, now())
           WHERE id = $1
             AND status IN ('approved', 'hidden', 'needs_review', 'pending', 'rejected')
          RETURNING owner_id;
        `;
        const photoRes = await conn.query<{ owner_id: string | null }>(deleteSql, [photoId, now ?? null]);
        if (photoRes.rows.length === 0) {
          return { removed: false, ownerId: null };
        }
        const ownerId = photoRes.rows[0]?.owner_id ?? null;

        // Step 2: Mark open reports upheld
        const reportSql = `
          UPDATE photo_reports
             SET status = 'upheld',
                 resolved_at = COALESCE($2, now())
           WHERE photo_id = $1
             AND status = 'open';
        `;
        await conn.query(reportSql, [photoId, now ?? null]);

        // Step 3: Increment strikes for owner if present
        if (ownerId) {
          const strikeSql = `
            INSERT INTO photo_upload_strikes (user_id, upheld_count, last_upheld_at)
            VALUES ($1, 1, COALESCE($2, now()))
            ON CONFLICT (user_id) DO UPDATE SET
              upheld_count = photo_upload_strikes.upheld_count + 1,
              last_upheld_at = COALESCE($2, now());
          `;
          await conn.query(strikeSql, [ownerId, now ?? null]);
        }

        return { removed: true, ownerId };
      };

      if (client) {
        return runTransaction(client);
      }

      // Standalone transaction
      const conn = await pool.connect();
      try {
        await conn.query('BEGIN;');
        const result = await runTransaction(conn);
        await conn.query('COMMIT;');
        return result;
      } catch (err) {
        await conn.query('ROLLBACK;').catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    },

    async upheldCountForUser(userId: string, client?: DbPool | PoolClient): Promise<number> {
      const db = getDb(client);
      const sql = `SELECT upheld_count FROM photo_upload_strikes WHERE user_id = $1;`;
      const res = await db.query<{ upheld_count: number }>(sql, [userId]);
      return res.rows[0]?.upheld_count ?? 0;
    },

    async getProfile(
      userId: string,
      client?: DbPool | PoolClient
    ): Promise<{ displayName: string; avatarPreset: string | null } | null> {
      const db = getDb(client);
      // Called with the id of ANOTHER user (the person being blocked), so it reads the view: an account that
      // is not active yields no profile (account-deletion R5.1).
      const sql = `SELECT display_name, avatar_preset FROM profile_identity WHERE user_id = $1 AND is_visible;`;
      const res = await db.query<{ display_name: string; avatar_preset: string | null }>(sql, [userId]);
      if (res.rows.length === 0) return null;
      return {
        displayName: res.rows[0]!.display_name,
        avatarPreset: res.rows[0]!.avatar_preset,
      };
    },
  };
}
