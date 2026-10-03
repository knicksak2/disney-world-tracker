/**
 * Migration test for `0056_admin_panel.sql`.
 *
 * Validates: Requirements 7.1, 10.1
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();

  db.registerExtension('citext', () => {});
  db.registerExtension('pg_trgm', () => {});
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  });

  const pub = db.public;
  pub.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

describe('migration 0056_admin_panel', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0056_admin_panel.sql');

    userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'operator@example.com', 'hash')`,
      [userId],
    );
  });

  it('creates sampling_runs table with correct columns', async () => {
    const res = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'sampling_runs'
      ORDER BY ordinal_position;
    `);

    const colNames = res.rows.map((r) => r['column_name']);
    expect(colNames).toEqual([
      'id',
      'started_at',
      'completed_at',
      'outcome',
      'error_message',
      'parks_sampled_count',
      'experiences_mapped_count',
      'wait_samples_recorded_count',
      'unmapped_with_wait_count',
      'unmapped_sample',
    ]);
  });

  it('creates push_delivery_log table with correct columns', async () => {
    const res = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'push_delivery_log'
      ORDER BY ordinal_position;
    `);

    const colNames = res.rows.map((r) => r['column_name']);
    expect(colNames).toEqual([
      'id',
      'occurred_at',
      'user_id',
      'status',
      'notification_kind',
    ]);
  });

  it('enforces outcome check constraint on sampling_runs', async () => {
    const now = new Date();
    // Valid values: success, failed
    await pool.query(
      `INSERT INTO sampling_runs (started_at, completed_at, outcome)
       VALUES ($1, $2, 'success')`,
      [now, now],
    );

    await pool.query(
      `INSERT INTO sampling_runs (started_at, completed_at, outcome, error_message)
       VALUES ($1, $2, 'failed', 'timeout')`,
      [now, now],
    );

    // Invalid value: pending
    await expect(
      pool.query(
        `INSERT INTO sampling_runs (started_at, completed_at, outcome)
         VALUES ($1, $2, 'pending')`,
        [now, now],
      ),
    ).rejects.toThrow();
  });

  it('enforces status check constraint on push_delivery_log', async () => {
    // Valid values: ok, device_unregistered, error
    for (const validStatus of ['ok', 'device_unregistered', 'error']) {
      await pool.query(
        `INSERT INTO push_delivery_log (user_id, status, notification_kind)
         VALUES ($1, $2, 'share_delivered')`,
        [userId, validStatus],
      );
    }

    // Invalid status
    await expect(
      pool.query(
        `INSERT INTO push_delivery_log (user_id, status, notification_kind)
         VALUES ($1, 'unknown_status', 'share_delivered')`,
        [userId],
      ),
    ).rejects.toThrow();
  });

  it('enforces notification_kind check constraint on push_delivery_log', async () => {
    const validKinds = [
      'share_delivered',
      'friend_request_received',
      'trip_invite_created',
      'rode_with_tag_created',
      'food_list_shared',
      'food_list_role_changed',
      'experience_list_shared',
      'experience_list_role_changed',
    ];

    for (const kind of validKinds) {
      await pool.query(
        `INSERT INTO push_delivery_log (user_id, status, notification_kind)
         VALUES ($1, 'ok', $2)`,
        [userId, kind],
      );
    }

    // Invalid kind
    await expect(
      pool.query(
        `INSERT INTO push_delivery_log (user_id, status, notification_kind)
         VALUES ($1, 'ok', 'invalid_kind')`,
        [userId],
      ),
    ).rejects.toThrow();
  });

  it('cascades on user deletion for push_delivery_log', async () => {
    await pool.query(
      `INSERT INTO push_delivery_log (user_id, status, notification_kind)
       VALUES ($1, 'ok', 'share_delivered')`,
      [userId],
    );

    const before = await pool.query(
      `SELECT count(*)::int as count FROM push_delivery_log WHERE user_id = $1`,
      [userId],
    );
    expect(before.rows[0]?.['count']).toBe(1);

    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

    const after = await pool.query(
      `SELECT count(*)::int as count FROM push_delivery_log WHERE user_id = $1`,
      [userId],
    );
    expect(after.rows[0]?.['count']).toBe(0);
  });

  it('creates the required indexes', () => {
    const samplingIndices = db.getTable('sampling_runs').listIndices().map((idx) => idx.name);
    expect(samplingIndices).toContain('sampling_runs_started_at_idx');

    const pushIndices = db.getTable('push_delivery_log').listIndices().map((idx) => idx.name);
    expect(pushIndices).toContain('push_delivery_log_occurred_at_idx');
    expect(pushIndices).toContain('push_delivery_log_user_id_idx');
  });
});
