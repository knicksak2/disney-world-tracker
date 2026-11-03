/**
 * Migration test for `0067_menu_shape_version.sql`.
 *
 * Validates: Requirements 10.7
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATION_FILE = '0067_menu_shape_version.sql';
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

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
  db.public.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  db.public.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  db.public.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  return db;
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.*\.sql$/u.test(n))
    .sort((a, b) => a.localeCompare(b));
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
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

describe('migration 0067_menu_shape_version (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let expId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    // Apply migrations up to 0066
    for (const name of migrationNames().filter((n) => n < MIGRATION_FILE)) {
      applyMigration(db, name);
    }

    expId = randomUUID();
    await pool.query(`
      INSERT INTO experiences (id, name, park, category, upstream_entity_id)
      VALUES ('${expId}', 'Cinderella Table', 'Magic Kingdom', 'Restaurant', 'cinderella-1')
    `);

    // Insert menu row BEFORE 0067
    await pool.query(`
      INSERT INTO experience_menus (experience_id, menus)
      VALUES ('${expId}', '[]'::jsonb)
    `);

    // Now apply 0067
    applyMigration(db, MIGRATION_FILE);
  });

  it('is wrapped in BEGIN/COMMIT and idempotent', () => {
    const raw = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
    expect(raw).toMatch(/^\s*BEGIN;/m);
    expect(raw).toMatch(/^\s*COMMIT;/m);
    expect(() => applyMigration(db, MIGRATION_FILE)).not.toThrow();
  });

  it('existing rows read back shape_version = 1', async () => {
    const res = await pool.query(`
      SELECT shape_version FROM experience_menus WHERE experience_id = '${expId}'
    `);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.shape_version).toBe(1);
  });

  it('new insert defaults shape_version to 1', async () => {
    const exp2 = randomUUID();
    await pool.query(`
      INSERT INTO experiences (id, name, park, category, upstream_entity_id)
      VALUES ('${exp2}', 'Be Our Guest', 'Magic Kingdom', 'Restaurant', 'bog-1')
    `);
    await pool.query(`
      INSERT INTO experience_menus (experience_id, menus)
      VALUES ('${exp2}', '[]'::jsonb)
    `);
    const res = await pool.query(`
      SELECT shape_version FROM experience_menus WHERE experience_id = '${exp2}'
    `);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.shape_version).toBe(1);
  });
});
