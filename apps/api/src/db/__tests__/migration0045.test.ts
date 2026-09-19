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

const BASE_MIGRATIONS = ['0001_init.sql', '0015_trips.sql', '0019_planned_item_scheduling.sql'];

describe('migration 0045_trip_walk_wait_weighting', () => {
  let db: IMemoryDb;
  let pool: any;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }
    applyMigration(db, '0045_trip_walk_wait_weighting.sql');

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

  async function insertUser(): Promise<string> {
    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      ['planner@example.com', 'argon2id-hash'],
    );
    return userRes.rows[0].id as string;
  }

  it('adds the walk_wait_weighting column to trips', async () => {
    const res = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'trips'
        AND column_name = 'walk_wait_weighting';
    `);

    const cols = new Set(res.rows.map((r: any) => r.column_name));
    expect(cols.has('walk_wait_weighting')).toBe(true);
  });

  it('defaults walk_wait_weighting to \'balanced\' when a trip is inserted without it', async () => {
    const creatorId = await insertUser();

    const tripRes = await pool.query(
      `INSERT INTO trips (creator_id, name, start_date, end_date)
       VALUES ($1, $2, $3, $4)
       RETURNING walk_wait_weighting`,
      [creatorId, 'Fall Trip', '2026-10-01', '2026-10-03'],
    );

    expect(tripRes.rows[0].walk_wait_weighting).toBe('balanced');
  });

  it('accepts each valid walk_wait_weighting value', async () => {
    const creatorId = await insertUser();

    for (const value of ['balanced', 'minimize_walking', 'minimize_waits']) {
      const res = await pool.query(
        `INSERT INTO trips (creator_id, name, start_date, end_date, walk_wait_weighting)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING walk_wait_weighting`,
        [creatorId, `Trip ${value}`, '2026-10-01', '2026-10-03', value],
      );
      expect(res.rows[0].walk_wait_weighting).toBe(value);
    }
  });

  it('rejects an invalid walk_wait_weighting value via the CHECK constraint', async () => {
    const creatorId = await insertUser();

    await expect(
      pool.query(
        `INSERT INTO trips (creator_id, name, start_date, end_date, walk_wait_weighting)
         VALUES ($1, $2, $3, $4, $5)`,
        [creatorId, 'Bad Trip', '2026-10-01', '2026-10-03', 'fastest'],
      ),
    ).rejects.toThrow();
  });
});
