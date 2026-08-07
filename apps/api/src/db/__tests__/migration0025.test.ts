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

describe('migration 0025_experience_early_entry', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0025_experience_early_entry.sql');
  });

  it('adds a nullable operates_during_early_entry column to experiences', () => {
    const cols = db.public.many(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'experiences' AND column_name = 'operates_during_early_entry'`,
    );
    expect(cols).toHaveLength(1);
  });

  it('accepts TRUE, FALSE, and NULL (nullable behavior) and reads them back', () => {
    const insert = (id: string, name: string, ee: string) =>
      db.public.none(
        `INSERT INTO experiences (id, upstream_entity_id, name, park, category, operates_during_early_entry)
         VALUES ('${id}', 'up-${id}', '${name}', 'Magic Kingdom', 'Ride', ${ee})`,
      );

    insert(randomUUID(), 'EE Ride', 'TRUE');
    insert(randomUUID(), 'Non-EE Ride', 'FALSE');
    // Omitted → defaults to NULL (never captured).
    const nullId = randomUUID();
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ('${nullId}', 'up-${nullId}', 'Unknown Ride', 'Magic Kingdom', 'Ride')`,
    );

    const rows = db.public.many(
      `SELECT name, operates_during_early_entry AS ee FROM experiences ORDER BY name`,
    ) as Array<{ name: string; ee: boolean | null }>;

    const byName = new Map(rows.map((r) => [r.name, r.ee]));
    expect(byName.get('EE Ride')).toBe(true);
    expect(byName.get('Non-EE Ride')).toBe(false);
    expect(byName.get('Unknown Ride')).toBeNull();
  });
});
