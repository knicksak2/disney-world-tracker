/**
 * pg-mem compatibility shims for the admin queries that read account-deletion state. The SQL under test is not
 * changed; Postgres runs it as written. Shared by `repo.deletion.test.ts` and `routes.deletion.test.ts`.
 */
import { DataType } from 'pg-mem';

import type { DbPool } from '../../../db/pool.js';
import type { World } from '../../accountDeletion/__tests__/visibility.harness.js';

/**
 * pg-mem has no `to_char`. The admin queries use exactly two formats, the ISO instant
 * `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"` and the day `YYYY-MM-DD`; both are rendered in UTC here, as Postgres does for a
 * UTC session.
 */
export function registerToChar(db: World['db']): void {
  try {
    db.public.registerFunction({
      name: 'to_char',
      args: [DataType.timestamptz, DataType.text],
      returns: DataType.text,
      implementation: (value: unknown, format: unknown): string | null => {
        if (value === null || value === undefined) return null;
        const iso = new Date(value as string | Date).toISOString();
        return String(format).includes('"T"') ? iso : iso.slice(0, 10);
      },
    });
  } catch {
    /* already registered on the shared base database */
  }
}

/**
 * pg-mem cannot plan the six correlated per-user count subselects of the lookup query (they read activity tables
 * these tests do not seed); they are replaced by a constant. It also returns a scalar sub-select in the select list
 * as a one-element array where Postgres returns the scalar, so such values are unwrapped. The deletion columns and
 * the tombstone filter under test run exactly as the repo sends them.
 */
export function adminPoolShim(pool: World['pool']): DbPool {
  const fix = (text: string): string =>
    text.replace(
      /\(SELECT COUNT\([\s\S]*?\) AS (completion_count|rating_count|note_count|friend_count|trip_count|active_session_count)/g,
      '0 AS $1',
    );
  return {
    async query(text: string, params?: unknown[]) {
      const res = await pool.query(fix(text), params);
      for (const row of res.rows as Record<string, unknown>[]) {
        for (const [k, v] of Object.entries(row)) {
          if (Array.isArray(v) && v.length <= 1) row[k] = v[0] ?? null;
        }
      }
      return res;
    },
  } as unknown as DbPool;
}
