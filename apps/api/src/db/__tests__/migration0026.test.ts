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

describe('migration 0026_experience_special_hours', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0025_experience_early_entry.sql');
    applyMigration(db, '0026_experience_special_hours.sql');
  });

  it('adds nullable extended-evening and ticketed-event columns to experiences', () => {
    const cols = db.public.many(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'experiences'
          AND column_name IN ('operates_during_extended_evening', 'operates_during_ticketed_event')`,
    );
    expect(cols).toHaveLength(2);
  });

  it('accepts TRUE/FALSE/NULL on both new columns', () => {
    const id = randomUUID();
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category,
                                operates_during_extended_evening, operates_during_ticketed_event)
       VALUES ('${id}', 'up-${id}', 'Ride', 'Magic Kingdom', 'Ride', TRUE, FALSE)`,
    );
    const nullId = randomUUID();
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ('${nullId}', 'up-${nullId}', 'Unknown', 'Magic Kingdom', 'Ride')`,
    );
    const rows = db.public.many(
      `SELECT name, operates_during_extended_evening AS ext, operates_during_ticketed_event AS tick
         FROM experiences ORDER BY name`,
    ) as Array<{ name: string; ext: boolean | null; tick: boolean | null }>;
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get('Ride')).toMatchObject({ ext: true, tick: false });
    expect(byName.get('Unknown')).toMatchObject({ ext: null, tick: null });
  });
});
