/**
 * Submission service for Hidden Mickeys (Task 5.2).
 *
 * Implements community submissions (Requirement 6, 9.1, 16.3, 16.4):
 *  - Enforces kill switch, ban check, and daily cap (trailing 24 hours)
 *  - Enforces URL and email denial (Requirement 1.7)
 *  - Resolves variant Experience to canonical base Experience before insert (Requirement 16.3)
 *  - Allows submission on inactive experiences (Requirement 16.4)
 *  - Integrates text harm screener (Requirement 6.3, 6.4)
 *  - Atomically creates the Hidden_Mickey, the submitter's Progress_Row (with Find),
 *    and the 'there' vote in one transaction.
 *
 * Validates: Requirements 1.4, 6.1 - 6.8, 6.11, 9.1, 16.3, 16.4
 */

import { randomUUID } from 'node:crypto';
import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import type { MickeysConfig } from '../../config.js';
import type { TextScreen } from './ports.js';
import {
  initialStatus,
  checkDailyCap,
  validateSubmission,
} from './domain/submissionPolicy.js';
import { wdwToday } from './repo.js';
import type {
  MickeySubmissionBody,
  MickeySubmissionDTO,
  MickeyStatus,
} from '@dwt/shared';

export interface SubmissionServiceOptions {
  pool: DbPool;
  config: MickeysConfig;
  textScreen?: TextScreen | undefined;
}

export class SubmissionService {
  private readonly pool: DbPool;
  private readonly config: MickeysConfig;
  private readonly textScreen?: TextScreen | undefined;

  constructor(options: SubmissionServiceOptions) {
    this.pool = options.pool;
    this.config = options.config;
    this.textScreen = options.textScreen;
  }

  async createSubmission(
    userId: string,
    input: MickeySubmissionBody,
    now: Date = new Date(),
  ): Promise<MickeySubmissionDTO> {
    // 1. Kill switches (Requirement 6.2, 14.1)
    if (!this.config.enabled) {
      throw new AppError(
        'mickey_feature_disabled',
        'Hidden Mickeys feature is currently disabled.',
      );
    }
    if (!this.config.submissionsEnabled) {
      throw new AppError(
        'mickey_feature_disabled',
        'Hidden Mickeys submissions are currently disabled.',
      );
    }

    // 2. Ban check (Requirement 6.11)
    const banCheck = await this.pool.query(
      `SELECT 1 FROM mickey_submission_bans WHERE user_id = $1`,
      [userId],
    );
    if (banCheck.rows.length > 0) {
      throw new AppError(
        'mickey_submissions_banned',
        'You are currently banned from submitting Hidden Mickeys.',
      );
    }

    // 3. Daily submission cap in trailing 24 hours (Requirement 6.7)
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const capRes = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM hidden_mickeys
        WHERE submitter_id = $1 AND created_at >= $2`,
      [userId, windowStart],
    );
    const createdLast24h = capRes.rows[0]?.n ?? 0;
    if (checkDailyCap(createdLast24h, this.config.submissionsPerDay) === 'limit') {
      throw new AppError(
        'mickey_submission_limit',
        'Daily submission limit reached. Please try again tomorrow.',
      );
    }

    // 4. Input validation (Requirements 1.1, 1.7)
    const validation = validateSubmission(input);
    if (!validation.valid) {
      throw new AppError(validation.code, validation.reason);
    }

    // 5. Experience exists check & alias-to-canonical resolution (Requirements 6.1, 16.3, 16.4)
    // Note: No check on `active`, an inactive Experience is accepted per Requirement 16.4.
    const expRes = await this.pool.query<{
      canonical_id: string;
      canonical_name: string;
    }>(
      `SELECT COALESCE(a.canonical_experience_id, e.id) AS canonical_id,
              COALESCE(ce.name, e.name) AS canonical_name
         FROM experiences e
         LEFT JOIN mickey_experience_aliases a ON a.alias_experience_id = e.id
         LEFT JOIN experiences ce ON ce.id = a.canonical_experience_id
        WHERE e.id = $1`,
      [input.experienceId],
    );
    if (expRes.rows.length === 0) {
      throw new AppError('validation_failed', 'Experience not found.', {
        field: 'experienceId',
      });
    }
    const { canonical_id, canonical_name } = expRes.rows[0]!;

    // 6. Text harm screening (Requirements 6.3, 6.4)
    let textScreenVerdict: 'pass' | 'unscreened' | 'skipped' = 'skipped';
    if (this.config.textScreenEnabled && this.textScreen) {
      const combinedText = `${input.clue1}\n${input.clue2}\n${input.reveal}`;
      const outcome = await this.textScreen.check(combinedText);
      if (outcome.kind === 'ok') {
        if (outcome.flagged) {
          throw new AppError(
            'mickey_text_rejected',
            'Submission text was rejected by moderation.',
          );
        }
        textScreenVerdict = 'pass';
      } else {
        // Retryable error: submission proceeds as pending / unscreened for operator review
        textScreenVerdict = 'unscreened';
      }
    }

    // 7. Initial status determination (Requirements 6.4, 6.5)
    const status: MickeyStatus = initialStatus(
      this.config.submissionMode,
      textScreenVerdict === 'unscreened' ? 'unscreened' : 'pass',
    );

    // 8. Atomic insertion of Hidden_Mickey, Find, and Vote in one transaction
    const newMickeyId = randomUUID();
    const today = wdwToday(now);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO hidden_mickeys (
           id, experience_id, zone, difficulty, clue_1, clue_2, reveal,
           source, official, status, submitter_id, text_screen, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'user', FALSE, $8, $9, $10, $11, $11)`,
        [
          newMickeyId,
          canonical_id,
          input.zone,
          input.difficulty,
          input.clue1,
          input.clue2,
          input.reveal,
          status,
          userId,
          textScreenVerdict,
          now,
        ],
      );

      await client.query(
        `INSERT INTO mickey_progress (
           user_id, mickey_id, hint_level, found_at, found_on, created_at, updated_at
         ) VALUES ($1, $2, 1, $3, $4, $3, $3)`,
        [userId, newMickeyId, now, today],
      );

      await client.query(
        `INSERT INTO mickey_still_there_votes (
           user_id, mickey_id, vote, voted_at
         ) VALUES ($1, $2, 'there', $3)`,
        [userId, newMickeyId, now],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return {
      id: newMickeyId,
      status,
      official: false,
      communityVerified: false,
      clue1: input.clue1,
      experienceName: canonical_name,
      reviewNote: null,
      createdAt: now.toISOString(),
    };
  }

  async listMySubmissions(userId: string): Promise<MickeySubmissionDTO[]> {
    if (!this.config.enabled) {
      throw new AppError(
        'mickey_feature_disabled',
        'Hidden Mickeys feature is currently disabled.',
      );
    }

    const res = await this.pool.query<{
      id: string;
      status: MickeyStatus;
      official: boolean;
      clue_1: string;
      experience_name: string;
      review_note: string | null;
      created_at: Date;
    }>(
      `SELECT hm.id,
              hm.status,
              hm.official,
              hm.clue_1,
              e.name AS experience_name,
              hm.review_note,
              hm.created_at
         FROM hidden_mickeys hm
         JOIN experiences e ON e.id = hm.experience_id
        WHERE hm.submitter_id = $1
        ORDER BY hm.created_at DESC`,
      [userId],
    );

    return res.rows.map((row) => ({
      id: row.id,
      status: row.status,
      official: row.official,
      communityVerified: false,
      clue1: row.clue_1,
      experienceName: row.experience_name,
      reviewNote: row.review_note,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
  }
}
