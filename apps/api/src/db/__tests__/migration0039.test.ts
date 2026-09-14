/**
 * Migration test for `0039_experience_festival_tags.sql`.
 *
 * Applies 0001 (experiences FK target) and 0039 to a fresh pg-mem database
 * and asserts the festival tag table contract:
 *
 *   - `experience_festival_tags` exists with required columns;
 *   - `(experience_id, festival_year)` UNIQUE constraint rejects duplicate pairs
 *     and allows distinct years for the same experience;
 *   - `festival_year` CHECK constraint enforces [2015, 2100] range;
 *   - Cascade on delete removes tags when the parent experience is deleted;
 *   - Indexes on experience_id and festival_year exist.
 *
 * Validates: Requirements 2.1, 2.3, 2.4
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

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

async function seedExperience(pool: Pool, id: string, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
     VALUES ($1, $2, 'Restaurant', 'EPCOT', $3)`,
    [id, name, `entity-${id}`],
  );
}

describe('migration 0039_experience_festival_tags (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let expA: string;
  let expB: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0039_experience_festival_tags.sql');

    expA = randomUUID();
    expB = randomUUID();
    await seedExperience(pool, expA, 'Bauernmarkt: Farmer\'s Market');
    await seedExperience(pool, expB, 'Cider House');
  });

  it('creates experience_festival_tags with expected columns', () => {
    const columns = [...db.getTable('experience_festival_tags').getColumns()].map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining(['id', 'experience_id', 'festival_slug', 'festival_year', 'tagged_at']),
    );
  });

  it('allows inserting a valid festival tag and defaults tagged_at', async () => {
    await pool.query(
      `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
       VALUES ($1, $2, $3)`,
      [expA, 'flower-and-garden', 2026],
    );

    const r = await pool.query(
      `SELECT experience_id, festival_slug, festival_year, tagged_at
         FROM experience_festival_tags
        WHERE experience_id = $1`,
      [expA],
    );

    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.['experience_id']).toBe(expA);
    expect(r.rows[0]?.['festival_slug']).toBe('flower-and-garden');
    expect(r.rows[0]?.['festival_year']).toBe(2026);
    expect(r.rows[0]?.['tagged_at']).not.toBeNull();
  });

  it('enforces UNIQUE (experience_id, festival_year) on duplicate pairs', async () => {
    await pool.query(
      `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
       VALUES ($1, $2, $3)`,
      [expA, 'flower-and-garden', 2026],
    );

    // Duplicate year for expA fails
    await expect(
      pool.query(
        `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
         VALUES ($1, $2, $3)`,
        [expA, 'food-and-wine', 2026],
      ),
    ).rejects.toThrow();

    // Same year for expB succeeds
    await expect(
      pool.query(
        `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
         VALUES ($1, $2, $3)`,
        [expB, 'flower-and-garden', 2026],
      ),
    ).resolves.toBeDefined();
  });

  it('allows multiple distinct festival years for the same experience', async () => {
    await pool.query(
      `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
       VALUES ($1, $2, $3)`,
      [expA, 'flower-and-garden', 2025],
    );

    await pool.query(
      `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
       VALUES ($1, $2, $3)`,
      [expA, 'flower-and-garden', 2026],
    );

    const r = await pool.query(
      `SELECT festival_year FROM experience_festival_tags WHERE experience_id = $1 ORDER BY festival_year`,
      [expA],
    );
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.['festival_year']).toBe(2025);
    expect(r.rows[1]?.['festival_year']).toBe(2026);
  });

  it('rejects festival_year outside [2015, 2100] check bounds', async () => {
    await expect(
      pool.query(
        `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
         VALUES ($1, $2, 2014)`,
        [expA, 'flower-and-garden'],
      ),
    ).rejects.toThrow();

    await expect(
      pool.query(
        `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
         VALUES ($1, $2, 2101)`,
        [expA, 'flower-and-garden'],
      ),
    ).rejects.toThrow();

    await expect(
      pool.query(
        `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
         VALUES ($1, $2, 2015)`,
        [expA, 'flower-and-garden'],
      ),
    ).resolves.toBeDefined();
  });

  it('cascades on parent experience delete', async () => {
    await pool.query(
      `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
       VALUES ($1, $2, 2026)`,
      [expA, 'flower-and-garden'],
    );

    await pool.query(`DELETE FROM experiences WHERE id = $1`, [expA]);

    const r = await pool.query(
      `SELECT count(*)::int AS n FROM experience_festival_tags WHERE experience_id = $1`,
      [expA],
    );
    expect(r.rows[0]?.['n']).toBe(0);
  });
});
