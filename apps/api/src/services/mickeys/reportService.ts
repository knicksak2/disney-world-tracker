/**
 * Report service for Hidden Mickeys (Task 6.1).
 *
 * Implements report ingestion and auto-hide (Requirement 7):
 *  - Rejects reports by the submitter on their own submission (Requirement 7.6)
 *  - Enforces idempotent duplicate reporting per (user_id, mickey_id) (Requirement 7.7)
 *  - Counts counted reports (users with a find on the mickey) (Requirement 7.3)
 *  - Automatically soft-hides Community entries reaching threshold (Requirement 7.4)
 *  - Official entries are NEVER auto-hidden; only hidden from reporter (Requirement 7.1, 7.4)
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.6, 7.7
 */

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import type { MickeysConfig } from '../../config.js';
import {
  mickeyReportBodySchema,
  type MickeyReportBody,
} from '@dwt/shared';
import { shouldAutoHide } from './domain/reportPolicy.js';

export interface ReportServiceOptions {
  pool: DbPool;
  config: MickeysConfig;
}

export class ReportService {
  private readonly pool: DbPool;
  private readonly config: MickeysConfig;

  constructor(options: ReportServiceOptions) {
    this.pool = options.pool;
    this.config = options.config;
  }

  async reportMickey(
    userId: string,
    mickeyId: string,
    input: MickeyReportBody,
    now: Date = new Date(),
  ): Promise<void> {
    // 1. Kill switch check
    if (!this.config.enabled) {
      throw new AppError(
        'mickey_feature_disabled',
        'Hidden Mickeys feature is currently disabled.',
      );
    }

    // 2. Validate body schema
    const parsed = mickeyReportBodySchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError(
        'validation_failed',
        parsed.error.issues[0]?.message ?? 'Invalid report input.',
      );
    }
    const { reason, note } = parsed.data;

    // 3. Find mickey and check existence
    const mickeyRes = await this.pool.query<{
      id: string;
      submitter_id: string | null;
      status: string;
      official: boolean;
    }>(
      `SELECT id, submitter_id, status, official
         FROM hidden_mickeys
        WHERE id = $1`,
      [mickeyId],
    );

    const mickey = mickeyRes.rows[0];
    if (!mickey) {
      throw new AppError('mickey_not_found', 'Hidden Mickey not found.');
    }

    // 4. Submitter cannot report their own submission (Requirement 7.6)
    if (mickey.submitter_id === userId) {
      throw new AppError(
        'mickey_report_forbidden',
        'You cannot report your own submission.',
      );
    }

    // 5. Insert report idempotently (Requirement 7.7)
    await this.pool.query(
      `INSERT INTO mickey_reports (user_id, mickey_id, reason, note, status, created_at)
       VALUES ($1, $2, $3, $4, 'open', $5)
       ON CONFLICT (user_id, mickey_id) DO NOTHING`,
      [userId, mickeyId, reason, note ?? null, now],
    );

    // 6. Check counted reports (users with a find on the mickey per Requirement 7.3)
    const countRes = await this.pool.query<{ count: number }>(
      `SELECT count(DISTINCT r.user_id)::int AS count
         FROM mickey_reports r
         JOIN mickey_progress p ON p.user_id = r.user_id AND p.mickey_id = r.mickey_id
        WHERE r.mickey_id = $1
          AND p.found_at IS NOT NULL`,
      [mickeyId],
    );
    const countedReporters = countRes.rows[0]?.count ?? 0;

    // 7. Auto-hide check (Requirement 7.4)
    // Only approved Community (!official) entries auto-hide. Official entries NEVER auto-hide.
    if (
      shouldAutoHide(
        {
          status: mickey.status,
          official: mickey.official,
          countedReporters,
        },
        this.config.reportAutohide,
      )
    ) {
      await this.pool.query(
        `UPDATE hidden_mickeys
            SET status = 'hidden',
                hidden_reason = 'reports'
          WHERE id = $1
            AND status = 'approved'
            AND official = FALSE`,
        [mickeyId],
      );
    }
  }
}
