/**
 * Tests for `makeSessionDbAdapter` activity-write throttling (pg-mem).
 *
 * Verifies that `updateActivity`:
 *  - skips the UPDATE when `last_seen_at` is within 60 seconds and
 *    `absolute_expires_at` is unchanged;
 *  - persists immediately when `last_seen_at` is at least 60 seconds old;
 *  - persists immediately when `absolute_expires_at` advances (burst rollover),
 *    even if `last_seen_at` was updated less than 60 seconds ago.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { makeSessionDbAdapter } from '../../../composeServices.js';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'migrations');

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb({ noAstCoverageCheck: true });
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
  db.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  db.public.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  return db;
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

describe('makeSessionDbAdapter.updateActivity throttle (pg-mem)', () => {
  let pool: DbPool;
  let sessionId: string;
  const t0 = new Date('2026-06-01T12:00:00.000Z');
  const exp0 = new Date('2026-07-01T12:00:00.000Z');

  beforeEach(async () => {
    const db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0064_account_deletion.sql');
    const { Pool } = db.adapters.createPg();
    pool = new Pool() as unknown as DbPool;

    const userId = randomUUID();
    sessionId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'u@example.com', 'hash')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, absolute_expires_at)
       VALUES ($1, $2, 'tokhash', $3, $3, $4)`,
      [sessionId, userId, t0, exp0],
    );
  });

  it('skips UPDATE within 60s when absolute_expires_at is unchanged', async () => {
    const adapter = makeSessionDbAdapter(pool);
    const tPlus20s = new Date(t0.getTime() + 20_000);
    await adapter.updateActivity(sessionId, tPlus20s, exp0);

    const row = await adapter.findByTokenHash('tokhash');
    expect(row?.last_seen_at.getTime()).toBe(t0.getTime());
    expect(row?.absolute_expires_at.getTime()).toBe(exp0.getTime());
  });

  it('persists UPDATE once at least 60s have elapsed', async () => {
    const adapter = makeSessionDbAdapter(pool);
    const tPlus60s = new Date(t0.getTime() + 60_000);
    await adapter.updateActivity(sessionId, tPlus60s, exp0);

    const row = await adapter.findByTokenHash('tokhash');
    expect(row?.last_seen_at.getTime()).toBe(tPlus60s.getTime());
  });

  it('persists UPDATE immediately on burst rollover even within 60s', async () => {
    const adapter = makeSessionDbAdapter(pool);
    const tPlus5s = new Date(t0.getTime() + 5_000);
    const expRolled = new Date(exp0.getTime() + 30 * 60_000);
    await adapter.updateActivity(sessionId, tPlus5s, expRolled);

    const row = await adapter.findByTokenHash('tokhash');
    expect(row?.last_seen_at.getTime()).toBe(tPlus5s.getTime());
    expect(row?.absolute_expires_at.getTime()).toBe(expRolled.getTime());
  });
});
