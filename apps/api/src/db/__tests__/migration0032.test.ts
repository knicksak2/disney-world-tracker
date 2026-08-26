import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import { EXPERIENCE_CATEGORIES, type ExperienceCategory } from '@dwt/shared';

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

const BASE_MIGRATIONS = [
  '0001_init.sql',
  '0002_experience_images.sql',
  '0004_disney_sources.sql',
  '0010_resort_experience_category.sql',
  '0032_experience_category_taxonomy.sql',
];

function insertExperience(
  db: IMemoryDb,
  category: string,
): void {
  const id = randomUUID();
  const upstreamEntityId = `entity-${id}`;
  db.public.none(`
    INSERT INTO experiences (id, upstream_entity_id, name, category, park)
    VALUES ('${id}', '${upstreamEntityId}', 'Test ${category}', '${category}', 'Magic Kingdom');
  `);
}

describe('migration 0032_experience_category_taxonomy', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }
  });

  it('accepts each of the three new categories: Walkthrough, PlayArea, Game', () => {
    const newCategories: ExperienceCategory[] = ['Walkthrough', 'PlayArea', 'Game'];
    for (const cat of newCategories) {
      expect(() => insertExperience(db, cat)).not.toThrow();
    }
  });

  it('still accepts every pre-existing category in EXPERIENCE_CATEGORIES', () => {
    for (const cat of EXPERIENCE_CATEGORIES) {
      expect(() => insertExperience(db, cat)).not.toThrow();
    }
  });

  it('rejects unknown / invalid category values', () => {
    const invalidCategories = ['Hotel', 'Attraction', 'FastPass', 'unknown', ''];
    for (const invalid of invalidCategories) {
      expect(() => insertExperience(db, invalid)).toThrow(/experiences_category_chk/);
    }
  });
});
