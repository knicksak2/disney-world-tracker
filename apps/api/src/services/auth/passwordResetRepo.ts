/**
 * Password Reset Repository.
 *
 * Encapsulates PostgreSQL database access for password reset tokens, verification
 * attempts, session revocation, and password updates.
 *
 * Validates: Requirements 1.2, 1.6, 2.1, 2.2, 2.3, 2.4, 2.6, 3.3
 */

import type { DbPool } from '../../db/pool.js';

export interface PasswordResetRecord {
  readonly id: string;
  readonly userId: string;
  readonly userEmail: string;
  readonly codeHash: string;
  readonly tokenHash: string;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly createdAt: Date;
}

export interface PasswordResetRepo {
  /** Find user account by email (case-insensitive). */
  findUserByEmail(email: string): Promise<{ readonly id: string; readonly email: string } | null>;

  /** Invalidate existing unused tokens for user and create a fresh one. */
  createResetRecord(
    userId: string,
    codeHash: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<string>;

  /** Look up active (unused, not expired) reset record for email. */
  findActiveByEmail(email: string): Promise<PasswordResetRecord | null>;

  /** Look up active (unused, not expired) reset record by URL token hash. */
  findActiveByToken(tokenHash: string): Promise<PasswordResetRecord | null>;

  /** Increment failed verification attempts and return new count. */
  incrementAttempts(id: string): Promise<number>;

  /** Invalidate record due to max attempts or manual expiry. */
  invalidateRecord(id: string): Promise<void>;

  /** Complete password reset: update password hash, mark token used, revoke all user sessions. */
  completeReset(resetId: string, userId: string, newPasswordHash: string): Promise<void>;
}

export function createPasswordResetRepo(pool: DbPool): PasswordResetRepo {
  return {
    async findUserByEmail(email: string) {
      const res = await pool.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE email = $1 LIMIT 1`,
        [email.trim()],
      );
      return res.rows[0] ?? null;
    },

    async createResetRecord(userId: string, codeHash: string, tokenHash: string, expiresAt: Date) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Invalidate any previously issued unused tokens for this user
        await client.query(
          `UPDATE password_reset_tokens
              SET used_at = now()
            WHERE user_id = $1
              AND used_at IS NULL`,
          [userId],
        );

        const res = await client.query<{ id: string }>(
          `INSERT INTO password_reset_tokens (user_id, code_hash, token_hash, expires_at)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [userId, codeHash, tokenHash, expiresAt],
        );

        await client.query('COMMIT');
        const row = res.rows[0];
        if (!row) {
          throw new Error('Failed to insert password reset token');
        }
        return row.id;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async findActiveByEmail(email: string) {
      const res = await pool.query<{
        id: string;
        user_id: string;
        email: string;
        code_hash: string;
        token_hash: string;
        attempts: number;
        expires_at: Date;
        used_at: Date | null;
        created_at: Date;
      }>(
        `SELECT r.id, r.user_id, u.email, r.code_hash, r.token_hash, r.attempts,
                r.expires_at, r.used_at, r.created_at
           FROM password_reset_tokens r
           JOIN users u ON u.id = r.user_id
          WHERE u.email = $1
            AND r.used_at IS NULL
            AND r.expires_at > now()
          ORDER BY r.created_at DESC
          LIMIT 1`,
        [email.trim()],
      );

      const row = res.rows[0];
      if (!row) return null;

      return {
        id: row.id,
        userId: row.user_id,
        userEmail: row.email,
        codeHash: row.code_hash,
        tokenHash: row.token_hash,
        attempts: Number(row.attempts),
        expiresAt: new Date(row.expires_at),
        usedAt: row.used_at ? new Date(row.used_at) : null,
        createdAt: new Date(row.created_at),
      };
    },

    async findActiveByToken(tokenHash: string) {
      const res = await pool.query<{
        id: string;
        user_id: string;
        email: string;
        code_hash: string;
        token_hash: string;
        attempts: number;
        expires_at: Date;
        used_at: Date | null;
        created_at: Date;
      }>(
        `SELECT r.id, r.user_id, u.email, r.code_hash, r.token_hash, r.attempts,
                r.expires_at, r.used_at, r.created_at
           FROM password_reset_tokens r
           JOIN users u ON u.id = r.user_id
          WHERE r.token_hash = $1
            AND r.used_at IS NULL
            AND r.expires_at > now()
          LIMIT 1`,
        [tokenHash],
      );

      const row = res.rows[0];
      if (!row) return null;

      return {
        id: row.id,
        userId: row.user_id,
        userEmail: row.email,
        codeHash: row.code_hash,
        tokenHash: row.token_hash,
        attempts: Number(row.attempts),
        expiresAt: new Date(row.expires_at),
        usedAt: row.used_at ? new Date(row.used_at) : null,
        createdAt: new Date(row.created_at),
      };
    },

    async incrementAttempts(id: string) {
      const res = await pool.query<{ attempts: number }>(
        `UPDATE password_reset_tokens
            SET attempts = attempts + 1
          WHERE id = $1
        RETURNING attempts`,
        [id],
      );
      return Number(res.rows[0]?.attempts ?? 0);
    },

    async invalidateRecord(id: string) {
      await pool.query(
        `UPDATE password_reset_tokens
            SET used_at = now()
          WHERE id = $1`,
        [id],
      );
    },

    async completeReset(resetId: string, userId: string, newPasswordHash: string) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Mark reset token as used
        await client.query(
          `UPDATE password_reset_tokens
              SET used_at = now()
            WHERE id = $1`,
          [resetId],
        );

        // 2. Update user's password hash
        await client.query(
          `UPDATE users
              SET password_hash = $1
            WHERE id = $2`,
          [newPasswordHash, userId],
        );

        // 3. Revoke all active sessions for this user
        await client.query(
          `UPDATE sessions
              SET revoked_at = now()
            WHERE user_id = $1
              AND revoked_at IS NULL`,
          [userId],
        );

        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
