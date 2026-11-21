/**
 * Onboarding repository — PostgreSQL reads/writes for `user_onboarding`, live
 * checklist signals, and batch starter completions.
 */

import type { OnboardingIntent, OnboardingPark } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';

type QueryableClient = { query(text: string): Promise<unknown> };
import {
  shouldGrandfatherOnFirstRead,
  type ActivitySignals,
  type StoredOnboardingRow,
} from './domain/statePolicy.js';

export interface OnboardingSnapshot {
  readonly stored: StoredOnboardingRow;
  readonly signals: ActivitySignals;
}

export interface QuickCompletionsResult {
  readonly addedCount: number;
  readonly alreadyCompletedCount: number;
}

export interface OnboardingRepo {
  getOrInitSnapshot(userId: string, now: Date): Promise<OnboardingSnapshot>;
  upsertState(
    userId: string,
    next: StoredOnboardingRow,
    now: Date,
  ): Promise<StoredOnboardingRow>;
  insertQuickCompletions(
    userId: string,
    experienceIds: readonly string[],
    completedOn: string,
    userTz: string,
  ): Promise<QuickCompletionsResult>;
}

interface OnboardingDbRow {
  completed_at: Date | string | null;
  skipped_at: Date | string | null;
  grandfathered_at: Date | string | null;
  initial_intent: string | null;
  selected_park: string | null;
  starter_checklist_dismissed_at: Date | string | null;
}

interface SignalsDbRow {
  has_completion: boolean;
  has_experience_log: boolean;
  has_food_log: boolean;
  has_favorite: boolean;
  has_trip_membership: boolean;
  has_claimed_pin: boolean;
}

function toIsoOrNull(val: Date | string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function mapRow(row: OnboardingDbRow): StoredOnboardingRow {
  return {
    completedAt: toIsoOrNull(row.completed_at),
    skippedAt: toIsoOrNull(row.skipped_at),
    grandfatheredAt: toIsoOrNull(row.grandfathered_at),
    initialIntent: (row.initial_intent as OnboardingIntent | null) ?? null,
    selectedPark: (row.selected_park as OnboardingPark | null) ?? null,
    starterChecklistDismissedAt: toIsoOrNull(row.starter_checklist_dismissed_at),
  };
}

async function readSignals(pool: DbPool, userId: string): Promise<ActivitySignals> {
  const res = await pool.query<SignalsDbRow>(
    `SELECT
       EXISTS(SELECT 1 FROM completions WHERE user_id = $1) AS has_completion,
       EXISTS(SELECT 1 FROM experience_logs WHERE user_id = $1) AS has_experience_log,
       EXISTS(SELECT 1 FROM food_item_logs WHERE user_id = $1) AS has_food_log,
       EXISTS(SELECT 1 FROM experience_favorites WHERE user_id = $1) AS has_favorite,
       EXISTS(SELECT 1 FROM active_trip_memberships WHERE user_id = $1) AS has_trip_membership,
       EXISTS(SELECT 1 FROM user_pins WHERE user_id = $1 AND claimed_at IS NOT NULL) AS has_claimed_pin`,
    [userId],
  );
  const row = res.rows[0];
  return {
    hasCompletion: Boolean(row?.has_completion),
    hasExperienceLog: Boolean(row?.has_experience_log),
    hasFoodLog: Boolean(row?.has_food_log),
    hasFavorite: Boolean(row?.has_favorite),
    hasTripMembership: Boolean(row?.has_trip_membership),
    hasClaimedPin: Boolean(row?.has_claimed_pin),
  };
}

async function safeRollback(client: QueryableClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Best-effort rollback on connection error.
  }
}

export function createOnboardingRepo(pool: DbPool): OnboardingRepo {
  return {
    async getOrInitSnapshot(userId: string, now: Date): Promise<OnboardingSnapshot> {
      const signals = await readSignals(pool, userId);

      const existing = await pool.query<OnboardingDbRow>(
        `SELECT completed_at, skipped_at, grandfathered_at, initial_intent,
                selected_park, starter_checklist_dismissed_at
           FROM user_onboarding
          WHERE user_id = $1`,
        [userId],
      );

      if (existing.rows[0]) {
        return { stored: mapRow(existing.rows[0]), signals };
      }

      const grandfatherTs = shouldGrandfatherOnFirstRead(signals)
        ? now.toISOString()
        : null;

      await pool.query(
        `INSERT INTO user_onboarding (user_id, grandfathered_at, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, grandfatherTs, now.toISOString()],
      );

      const reread = await pool.query<OnboardingDbRow>(
        `SELECT completed_at, skipped_at, grandfathered_at, initial_intent,
                selected_park, starter_checklist_dismissed_at
           FROM user_onboarding
          WHERE user_id = $1`,
        [userId],
      );

      const row = reread.rows[0];
      if (!row) {
        throw new AppError('internal_error', 'Failed to initialize onboarding row.');
      }

      return { stored: mapRow(row), signals };
    },

    async upsertState(
      userId: string,
      next: StoredOnboardingRow,
      now: Date,
    ): Promise<StoredOnboardingRow> {
      const res = await pool.query<OnboardingDbRow>(
        `INSERT INTO user_onboarding (
           user_id,
           completed_at,
           skipped_at,
           grandfathered_at,
           initial_intent,
           selected_park,
           starter_checklist_dismissed_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id) DO UPDATE SET
           completed_at = EXCLUDED.completed_at,
           skipped_at = EXCLUDED.skipped_at,
           initial_intent = EXCLUDED.initial_intent,
           selected_park = EXCLUDED.selected_park,
           starter_checklist_dismissed_at = EXCLUDED.starter_checklist_dismissed_at,
           updated_at = EXCLUDED.updated_at
         RETURNING completed_at, skipped_at, grandfathered_at, initial_intent,
                   selected_park, starter_checklist_dismissed_at`,
        [
          userId,
          next.completedAt,
          next.skippedAt,
          next.grandfatheredAt,
          next.initialIntent,
          next.selectedPark,
          next.starterChecklistDismissedAt,
          now.toISOString(),
        ],
      );
      const row = res.rows[0];
      if (!row) {
        throw new AppError('internal_error', 'Failed to persist onboarding state.');
      }
      return mapRow(row);
    },

    async insertQuickCompletions(
      userId: string,
      experienceIds: readonly string[],
      completedOn: string,
      userTz: string,
    ): Promise<QuickCompletionsResult> {
      const uniqueIds = Array.from(new Set(experienceIds));
      if (uniqueIds.length === 0) {
        return { addedCount: 0, alreadyCompletedCount: 0 };
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const verifyPlaceholders = uniqueIds.map((_, idx) => `$${idx + 1}`).join(', ');
        const foundRes = await client.query<{ id: string }>(
          `SELECT id
             FROM experiences
            WHERE id IN (${verifyPlaceholders})
              AND active = TRUE`,
          [...uniqueIds],
        );

        if (foundRes.rows.length !== uniqueIds.length) {
          await safeRollback(client);
          throw new AppError(
            'experience_not_found',
            'One or more experiences were not found or are inactive.',
          );
        }

        // Pre-filter already-completed ids inside the tx (workaround for pg-mem's
        // ON CONFLICT DO NOTHING RETURNING echoing pre-existing rows) AND use
        // RETURNING experience_id so concurrent real Postgres inserts count only
        // the rows actually inserted by this transaction.
        const existingRes = await client.query<{ experience_id: string }>(
          `SELECT experience_id
             FROM completions
            WHERE user_id = $1
              AND experience_id IN (${verifyPlaceholders.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)})`,
          [userId, ...uniqueIds],
        );
        const existingSet = new Set(existingRes.rows.map((r) => r.experience_id));
        const toInsert = uniqueIds.filter((id) => !existingSet.has(id));

        // Batch-insert only new (user_id, experience_id) pairs; intentionally omit
        // experience_logs so historical starter rides do not stamp today's visit
        // date onto timelines or trigger single-day multi-park pins (R2.3).
        let addedCount = 0;
        if (toInsert.length > 0) {
          const valuesClauses = toInsert
            .map((_, idx) => `($1, $${idx + 4}, $2, $3)`)
            .join(', ');

          const insertRes = await client.query<{ experience_id: string }>(
            `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
             VALUES ${valuesClauses}
             ON CONFLICT (user_id, experience_id) DO NOTHING
             RETURNING experience_id`,
            [userId, completedOn, userTz, ...toInsert],
          );
          addedCount = insertRes.rows.length;
        }

        await client.query('COMMIT');

        return {
          addedCount,
          alreadyCompletedCount: uniqueIds.length - addedCount,
        };
      } catch (err) {
        await safeRollback(client);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
