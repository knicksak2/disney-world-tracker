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

describe('migration 0044_experience_dining_url', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0044_experience_dining_url.sql');
  });

  it('adds a dining_url column to experiences', () => {
    const cols = db.public.many(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_name = 'experiences' AND column_name = 'dining_url'`,
    );
    expect(cols).toHaveLength(1);
  });

  it('accepts NULL (both explicit and omitted) and a valid normal URL', () => {
    const idA = randomUUID();
    const idB = randomUUID();
    const idC = randomUUID();

    // Omitted dining_url → NULL
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ('${idA}', 'up-${idA}', 'Restaurant A', 'EPCOT', 'Restaurant')`,
    );

    // Explicit NULL
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, dining_url)
       VALUES ('${idB}', 'up-${idB}', 'Restaurant B', 'EPCOT', 'Restaurant', NULL)`,
    );

    // Valid normal URL
    const validUrl = 'https://disneyworld.disney.go.com/dining/animal-kingdom/tiffins-restaurant/';
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, dining_url)
       VALUES ('${idC}', 'up-${idC}', 'Restaurant C', 'Animal Kingdom', 'Restaurant', '${validUrl}')`,
    );

    const rows = db.public.many(
      `SELECT name, dining_url FROM experiences WHERE id IN ('${idA}', '${idB}', '${idC}') ORDER BY name`,
    ) as Array<{ name: string; dining_url: string | null }>;

    expect(rows).toEqual([
      { name: 'Restaurant A', dining_url: null },
      { name: 'Restaurant B', dining_url: null },
      { name: 'Restaurant C', dining_url: validUrl },
    ]);
  });

  it('accepts boundary lengths 1 and 500 characters', () => {
    const id1 = randomUUID();
    const id500 = randomUUID();

    const str1 = 'x';
    const str500 = 'h'.repeat(500);

    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, dining_url)
       VALUES ('${id1}', 'up-${id1}', 'Restaurant 1', 'EPCOT', 'Restaurant', '${str1}')`,
    );

    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, dining_url)
       VALUES ('${id500}', 'up-${id500}', 'Restaurant 500', 'EPCOT', 'Restaurant', '${str500}')`,
    );

    const r1 = db.public.one(`SELECT dining_url FROM experiences WHERE id = '${id1}'`);
    const r500 = db.public.one(`SELECT dining_url FROM experiences WHERE id = '${id500}'`);

    expect(r1.dining_url).toBe(str1);
    expect(r500.dining_url).toBe(str500);
  });

  it('rejects empty string violating CHECK constraint', () => {
    const id = randomUUID();
    expect(() => {
      db.public.none(
        `INSERT INTO experiences (id, upstream_entity_id, name, park, category, dining_url)
         VALUES ('${id}', 'up-${id}', 'Restaurant Empty', 'EPCOT', 'Restaurant', '')`,
      );
    }).toThrow();
  });

  it('rejects >500-char string violating CHECK constraint', () => {
    const id = randomUUID();
    const str501 = 'h'.repeat(501);
    expect(() => {
      db.public.none(
        `INSERT INTO experiences (id, upstream_entity_id, name, park, category, dining_url)
         VALUES ('${id}', 'up-${id}', 'Restaurant Long', 'EPCOT', 'Restaurant', '${str501}')`,
      );
    }).toThrow();
  });
});
