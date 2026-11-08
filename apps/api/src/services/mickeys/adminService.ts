/**
 * Operator console admin service for Hidden Mickeys (Task 7.1).
 *
 * Implements Operator actions (Requirement 8):
 *  - approve, reject with review note up to 300 chars (Requirement 8.3)
 *  - edit text layers, zone, difficulty (Requirement 8.3)
 *  - retire (marks open reports upheld), restore (marks open reports dismissed) (Requirements 7.6, 8.3)
 *  - promote (only approved Community; sets official and promoted_at and nothing else) (Requirement 8.4, Property 14)
 *  - dismiss open reports (Requirement 8.3)
 *  - ban submitter (inserts ban, sets approved Community entries to hidden with reason operator) (Requirement 8.6, Property 20)
 *  - unban submitter (deletes ban, restores nothing automatically) (Requirement 8.6, Property 20)
 *  - all status changes strictly guarded by canTransition (Requirement 1.3, Property 11)
 *
 * Validates: Requirements 1.3, 7.6, 8.3, 8.4, 8.6, Properties 11, 14, 20
 */

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import {
  type MickeyStatus,
  type MickeyZone,
  type MickeyDifficulty,
  type Park,
  MICKEY_NOTE_MAX,
} from '@dwt/shared';
import { canTransition } from './domain/transitions.js';
import { validateSubmission } from './domain/submissionPolicy.js';

export interface AdminMickeyServiceOptions {
  readonly pool: DbPool;
}

export class AdminMickeyService {
  private readonly pool: DbPool;

  constructor(options: AdminMickeyServiceOptions) {
    this.pool = options.pool;
  }

  async approve(mickeyId: string, now: Date = new Date()): Promise<void> {
    const res = await this.pool.query<{ status: MickeyStatus }>(
      `SELECT status FROM hidden_mickeys WHERE id = $1`,
      [mickeyId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found.');
    }
    if (!canTransition(row.status, 'approved')) {
      throw new AppError(
        'validation_failed',
        `Cannot transition Hidden Mickey from ${row.status} to approved.`,
      );
    }

    await this.pool.query(
      `UPDATE hidden_mickeys
          SET status = 'approved',
              hidden_reason = NULL,
              reviewed_at = $2,
              updated_at = $2
        WHERE id = $1`,
      [mickeyId, now],
    );
  }

  async reject(
    mickeyId: string,
    reviewNote?: string | null,
    now: Date = new Date(),
  ): Promise<void> {
    const res = await this.pool.query<{ status: MickeyStatus }>(
      `SELECT status FROM hidden_mickeys WHERE id = $1`,
      [mickeyId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found.');
    }
    if (!canTransition(row.status, 'rejected')) {
      throw new AppError(
        'validation_failed',
        `Cannot transition Hidden Mickey from ${row.status} to rejected.`,
      );
    }
    if (reviewNote && reviewNote.length > MICKEY_NOTE_MAX) {
      throw new AppError(
        'validation_failed',
        `Review note cannot exceed ${MICKEY_NOTE_MAX} characters.`,
      );
    }

    await this.pool.query(
      `UPDATE hidden_mickeys
          SET status = 'rejected',
              review_note = $2,
              reviewed_at = $3,
              updated_at = $3
        WHERE id = $1`,
      [mickeyId, reviewNote ?? null, now],
    );
  }

  async edit(
    mickeyId: string,
    input: {
      clue1: string;
      clue2: string;
      reveal: string;
      zone: MickeyZone;
      difficulty: MickeyDifficulty;
    },
    now: Date = new Date(),
  ): Promise<void> {
    const res = await this.pool.query<{ experience_id: string }>(
      `SELECT experience_id FROM hidden_mickeys WHERE id = $1`,
      [mickeyId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found.');
    }

    const validation = validateSubmission({
      experienceId: row.experience_id,
      ...input,
    });
    if (!validation.valid) {
      throw new AppError(validation.code, validation.reason);
    }

    await this.pool.query(
      `UPDATE hidden_mickeys
          SET clue_1 = $2,
              clue_2 = $3,
              reveal = $4,
              zone = $5,
              difficulty = $6,
              updated_at = $7
        WHERE id = $1`,
      [
        mickeyId,
        input.clue1.trim(),
        input.clue2.trim(),
        input.reveal.trim(),
        input.zone,
        input.difficulty,
        now,
      ],
    );
  }

  async retire(mickeyId: string, now: Date = new Date()): Promise<void> {
    const res = await this.pool.query<{ status: MickeyStatus }>(
      `SELECT status FROM hidden_mickeys WHERE id = $1`,
      [mickeyId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found.');
    }
    if (!canTransition(row.status, 'retired')) {
      throw new AppError(
        'validation_failed',
        `Cannot transition Hidden Mickey from ${row.status} to retired.`,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE hidden_mickeys
            SET status = 'retired',
                updated_at = $2
          WHERE id = $1`,
        [mickeyId, now],
      );
      // Mark open reports upheld (Requirement 7.6)
      await client.query(
        `UPDATE mickey_reports
            SET status = 'upheld',
                resolved_at = $2
          WHERE mickey_id = $1 AND status = 'open'`,
        [mickeyId, now],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async restore(mickeyId: string, now: Date = new Date()): Promise<void> {
    const res = await this.pool.query<{ status: MickeyStatus }>(
      `SELECT status FROM hidden_mickeys WHERE id = $1`,
      [mickeyId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found.');
    }
    if (!canTransition(row.status, 'approved')) {
      throw new AppError(
        'validation_failed',
        `Cannot transition Hidden Mickey from ${row.status} to approved.`,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE hidden_mickeys
            SET status = 'approved',
                hidden_reason = NULL,
                updated_at = $2
          WHERE id = $1`,
        [mickeyId, now],
      );
      // Mark open reports dismissed (Requirement 7.6)
      await client.query(
        `UPDATE mickey_reports
            SET status = 'dismissed',
                resolved_at = $2
          WHERE mickey_id = $1 AND status = 'open'`,
        [mickeyId, now],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async promote(
    mickeyId: string,
    now: Date = new Date(),
  ): Promise<{ park: Park | null }> {
    const res = await this.pool.query<{
      status: MickeyStatus;
      official: boolean;
      park: Park | null;
    }>(
      `SELECT hm.status, hm.official, e.park
         FROM hidden_mickeys hm
         JOIN experiences e ON e.id = hm.experience_id
        WHERE hm.id = $1`,
      [mickeyId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found.');
    }
    if (row.status !== 'approved' || row.official) {
      throw new AppError(
        'validation_failed',
        'Only approved Community Hidden Mickeys can be promoted to Official.',
      );
    }

    // Set official true and promoted_at and nothing else (Requirement 8.4, Property 14)
    await this.pool.query(
      `UPDATE hidden_mickeys
          SET official = TRUE,
              promoted_at = $2,
              updated_at = $2
        WHERE id = $1`,
      [mickeyId, now],
    );

    return { park: row.park };
  }

  async dismissReports(mickeyId: string, now: Date = new Date()): Promise<void> {
    await this.pool.query(
      `UPDATE mickey_reports
          SET status = 'dismissed',
              resolved_at = $2
        WHERE mickey_id = $1 AND status = 'open'`,
      [mickeyId, now],
    );
  }

  async banUser(
    userId: string,
    reason?: string | null,
    now: Date = new Date(),
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO mickey_submission_bans (user_id, reason, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason`,
        [userId, reason ?? null, now],
      );
      // Set every approved Community Hidden Mickey of that submitter to hidden with reason operator (Requirement 8.6, Property 20)
      await client.query(
        `UPDATE hidden_mickeys
            SET status = 'hidden',
                hidden_reason = 'operator',
                updated_at = $2
          WHERE submitter_id = $1
            AND status = 'approved'
            AND official = FALSE`,
        [userId, now],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async unbanUser(userId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM mickey_submission_bans WHERE user_id = $1`,
      [userId],
    );
  }
}
