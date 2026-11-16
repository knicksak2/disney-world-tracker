/**
 * In-app feedback repository (`.kiro/specs/in-app-feedback`, Requirements 2.3 to 2.6, 3.1, 3.2, 5.2 to 5.4, 6.1, 7.2).
 *
 * The only statement that reads `users` is the insert, and its literal carries `deletion_state = 'active'`, so the
 * account-deletion visibility guard (`src/__tests__/visibility.guard.test.ts`) passes with no allowlist entry. The
 * contact email is copied by that same statement, and only when the caller gave consent.
 */
import type { FeedbackKind, FeedbackStatus } from '@dwt/shared';
import type { DbPool } from '../../db/pool.js';
import { DAY_MS, HOUR_MS, type RecentCounts } from './policy.js';

export interface FeedbackRow {
  readonly id: string;
  readonly userId: string;
  readonly kind: FeedbackKind;
  readonly message: string;
  readonly status: FeedbackStatus;
  readonly contactOk: boolean;
  readonly contactEmail: string | null;
  readonly appVersion: string | null;
  readonly platform: string | null;
  readonly osVersion: string | null;
  readonly createdAt: Date;
  readonly statusChangedAt: Date;
}

export interface FeedbackInsertInput {
  readonly userId: string;
  readonly kind: FeedbackKind;
  /** Already trimmed and length-checked by `feedbackSubmitInputSchema`. */
  readonly message: string;
  readonly contactOk: boolean;
  readonly device?: { readonly appVersion: string; readonly platform: string; readonly osVersion: string } | undefined;
}

export interface FeedbackListFilter {
  readonly status?: FeedbackStatus | undefined;
  readonly kind?: FeedbackKind | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface FeedbackRepo {
  countRecent(userId: string, now: Date): Promise<RecentCounts>;
  /** Returns the new id, or `null` when the account is not `active` (nothing is stored). */
  insert(input: FeedbackInsertInput): Promise<string | null>;
  /** Deletes at most `limit` resolved rows whose status changed before `cutoff`. Returns how many were deleted. */
  pruneResolved(cutoff: Date, limit: number): Promise<number>;
  list(filter: FeedbackListFilter): Promise<{ readonly rows: readonly FeedbackRow[]; readonly total: number }>;
  get(id: string): Promise<FeedbackRow | null>;
  /** Returns false when the id does not exist. `status_changed_at` moves only when the status actually changes. */
  setStatus(id: string, status: FeedbackStatus, now: Date): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

/** The slice of the repo the Admin_Panel consumes (types only, mirroring `AdminDiningPlanPort`). */
export type AdminFeedbackPort = Pick<FeedbackRepo, 'list' | 'get' | 'setStatus' | 'remove'>;

interface RawRow {
  id: string;
  user_id: string;
  kind: FeedbackKind;
  message: string;
  status: FeedbackStatus;
  contact_ok: boolean;
  contact_email: string | null;
  app_version: string | null;
  platform: string | null;
  os_version: string | null;
  created_at: Date | string;
  status_changed_at: Date | string;
}

const COLUMNS = `id, user_id, kind, message, status, contact_ok, contact_email,
       app_version, platform, os_version, created_at, status_changed_at`;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRow(r: RawRow): FeedbackRow {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    message: r.message,
    status: r.status,
    contactOk: r.contact_ok,
    contactEmail: r.contact_email,
    appVersion: r.app_version,
    platform: r.platform,
    osVersion: r.os_version,
    createdAt: toDate(r.created_at),
    statusChangedAt: toDate(r.status_changed_at),
  };
}

export function createFeedbackRepo(pool: DbPool): FeedbackRepo {
  return {
    async countRecent(userId, now) {
      const hourStart = new Date(now.getTime() - HOUR_MS);
      const dayStart = new Date(now.getTime() - DAY_MS);
      const res = await pool.query<{ last_hour: number | string; last_day: number | string }>(
        `SELECT count(CASE WHEN created_at >= $2 THEN 1 END)::int AS last_hour,
                count(*)::int AS last_day
           FROM user_feedback
          WHERE user_id = $1 AND created_at >= $3`,
        [userId, hourStart, dayStart],
      );
      const row = res.rows[0];
      return { lastHour: Number(row?.last_hour ?? 0), lastDay: Number(row?.last_day ?? 0) };
    },

    async insert(input) {
      const device = input.device;
      const res = await pool.query<{ id: string }>(
        `INSERT INTO user_feedback
           (user_id, kind, message, contact_ok, contact_email, app_version, platform, os_version)
         SELECT u.id, $2::text, $3::text, $4::boolean,
                CASE WHEN $4::boolean THEN u.email::text ELSE NULL END,
                $5::text, $6::text, $7::text
           FROM users u
          WHERE u.id = $1 AND u.deletion_state = 'active'
         RETURNING id`,
        [
          input.userId,
          input.kind,
          input.message,
          input.contactOk,
          device?.appVersion ?? null,
          device?.platform ?? null,
          device?.osVersion ?? null,
        ],
      );
      return res.rows[0]?.id ?? null;
    },

    async pruneResolved(cutoff, limit) {
      const res = await pool.query(
        `DELETE FROM user_feedback
          WHERE id IN (SELECT id FROM user_feedback
                        WHERE status = 'resolved' AND status_changed_at < $1
                        ORDER BY status_changed_at
                        LIMIT $2)`,
        [cutoff, limit],
      );
      return res.rowCount ?? 0;
    },

    async list(filter) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.status !== undefined) {
        params.push(filter.status);
        where.push(`status = $${params.length}`);
      }
      if (filter.kind !== undefined) {
        params.push(filter.kind);
        where.push(`kind = $${params.length}`);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const totalRes = await pool.query<{ n: number | string }>(
        `SELECT count(*)::int AS n FROM user_feedback ${clause}`,
        params,
      );
      const pageParams = [...params, filter.limit, filter.offset];
      const rowsRes = await pool.query<RawRow>(
        `SELECT ${COLUMNS}
           FROM user_feedback
           ${clause}
          ORDER BY created_at DESC, id
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        pageParams,
      );
      return { rows: rowsRes.rows.map(mapRow), total: Number(totalRes.rows[0]?.n ?? 0) };
    },

    async get(id) {
      const res = await pool.query<RawRow>(`SELECT ${COLUMNS} FROM user_feedback WHERE id = $1`, [id]);
      const row = res.rows[0];
      return row === undefined ? null : mapRow(row);
    },

    async setStatus(id, status, now) {
      const res = await pool.query(
        `UPDATE user_feedback
            SET status_changed_at = CASE WHEN status <> $2 THEN $3::timestamptz ELSE status_changed_at END,
                status = $2
          WHERE id = $1`,
        [id, status, now],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async remove(id) {
      const res = await pool.query(`DELETE FROM user_feedback WHERE id = $1`, [id]);
      return (res.rowCount ?? 0) > 0;
    },
  };
}
