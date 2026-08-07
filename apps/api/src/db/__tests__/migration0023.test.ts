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
  db.public.none(sql);
}

const BASE_MIGRATIONS = ['0001_init.sql', '0015_trips.sql'];

describe('migration 0023_trip_touring_hours', () => {
  let db: IMemoryDb;
  let pool: any;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }
    applyMigration(db, '0023_trip_touring_hours.sql');

    pool = {
      query: async (text: string, params: any[] = []) => {
        let paramIndex = 1;
        let psql = text;
        for (const p of params) {
          psql = psql
            .split(`$${paramIndex++}`)
            .join(typeof p === 'string' || p instanceof Date ? `'${p instanceof Date ? p.toISOString() : p}'` : p);
        }
        const res = db.public.query(psql);
        return { rows: res.rows || res || [] };
      },
    };
  });

  it('adds the day_touring_hours JSONB column to trips', async () => {
    const res = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'trips'
        AND column_name = 'day_touring_hours';
    `);

    const cols = new Set(res.rows.map((r: any) => r.column_name));
    expect(cols.has('day_touring_hours')).toBe(true);
  });

  it('defaults day_touring_hours to an empty object when a trip is inserted without it (NOT NULL DEFAULT \'{}\')', async () => {
    // A trip requires a creator; insert a user first so the FK is satisfiable.
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      ['planner@example.com', 'argon2id-hash'],
    );
    const creatorId = userRes.rows[0].id as string;

    // Insert a trip WITHOUT supplying day_touring_hours — the migration's
    // NOT NULL DEFAULT '{}' must fill it, never leave it null.
    const tripRes = await pool.query(
      `INSERT INTO trips (creator_id, name, start_date, end_date)
       VALUES ($1, $2, $3, $4)
       RETURNING day_touring_hours`,
      [creatorId, 'Fall Trip', '2026-10-01', '2026-10-03'],
    );

    expect(tripRes.rows[0].day_touring_hours).toEqual({});
  });
});
