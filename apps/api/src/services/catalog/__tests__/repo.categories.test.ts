/**
 * Integration tests (pg-mem) for the `categories` multi-category filter on
 * `CatalogRepo.listActiveExperiences` (Task 16.3, Requirements 13.2, 13.3, 13.7, 13.8, 13.9).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';

import type { ExperienceCategory, Park } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createCatalogRepo, type CatalogRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem setup
// ---------------------------------------------------------------------------

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
    implementation: (s: unknown): number =>
      typeof s === 'string' ? s.length : 0,
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string =>
      typeof s === 'string' ? s.toLowerCase() : '',
  });

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyInitMigration(db: IMemoryDb): void {
  let sql = readFileSync(migrationPath('0001_init.sql'), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

function applyMigration(db: IMemoryDb, name: string): void {
  const sql = readFileSync(migrationPath(name), 'utf8');
  db.public.none(sql);
}

function adaptAnyArrayParams(
  text: string,
  params?: ReadonlyArray<unknown>,
): [string, ReadonlyArray<unknown> | undefined] {
  if (params === undefined || !/=\s*ANY\(\$\d+(?:::text\[\])?\)/i.test(text)) {
    return [text, params];
  }
  const newParams = [...params];
  const newText = text.replace(/=\s*ANY\(\$(\d+)(?:::text\[\])?\)/gi, (match, num: string) => {
    const arr = params[Number(num) - 1];
    if (!Array.isArray(arr)) {
      return match;
    }
    const placeholders = arr.map((value) => {
      newParams.push(value);
      return `$${newParams.length}`;
    });
    return `IN (${placeholders.join(', ')})`;
  });
  return [newText, newParams];
}

function withAnyArrayCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      const [adaptedText, adaptedParams] = adaptAnyArrayParams(text, params);
      return raw.query(adaptedText, adaptedParams as ReadonlyArray<unknown>);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          const [adaptedText, adaptedParams] = adaptAnyArrayParams(text, params);
          return client.query(adaptedText, adaptedParams as ReadonlyArray<unknown>);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;
}

function freshRepo(): { repo: CatalogRepo; pool: DbPool } {
  const db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  const pool = withAnyArrayCompat(new Pool() as unknown as DbPool);

  applyInitMigration(db);
  applyMigration(db, '0002_experience_images.sql');
  applyMigration(db, '0003_note_shareable.sql');
  applyMigration(db, '0004_disney_sources.sql');
  applyMigration(db, '0006_experience_land.sql');
  applyMigration(db, '0007_experience_resort_area.sql');
  applyMigration(db, '0008_experience_facet_enrichment.sql');
  applyMigration(db, '0010_resort_experience_category.sql');
  applyMigration(db, '0014_experience_world_showcase_country.sql');
  applyMigration(db, '0032_experience_category_taxonomy.sql');

  return { repo: createCatalogRepo(pool), pool };
}

async function insertExperience(
  pool: DbPool,
  item: {
    id: string;
    enterpriseId: string;
    name: string;
    park: Park | null;
    category: ExperienceCategory;
    areaType: 'ThemePark' | 'WaterPark' | 'DisneySprings' | 'Resort';
    land?: string | null;
    active?: boolean;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (
       id, upstream_entity_id, name, park, category, area_type, land, active
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      item.id,
      item.enterpriseId,
      item.name,
      item.park,
      item.category,
      item.areaType,
      item.land ?? null,
      item.active ?? true,
    ],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CatalogRepo.listActiveExperiences — multi-category filter (pg-mem)', () => {
  it('returns exactly the active experiences whose category matches ANY member of categories', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-ride',
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      areaType: 'ThemePark',
      land: 'Tomorrowland',
    });
    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-show',
      name: 'Festival of Fantasy Parade',
      park: 'Magic Kingdom',
      category: 'Parade',
      areaType: 'ThemePark',
      land: 'Main Street, U.S.A.',
    });
    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-meet',
      name: 'Meet Mickey at Town Square Theater',
      park: 'Magic Kingdom',
      category: 'Character_Meet',
      areaType: 'ThemePark',
      land: 'Main Street, U.S.A.',
    });
    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-dining',
      name: 'Be Our Guest Restaurant',
      park: 'Magic Kingdom',
      category: 'Restaurant',
      areaType: 'ThemePark',
      land: 'Fantasyland',
    });

    // Query for Show, Parade, Character_Meet
    const results = await repo.listActiveExperiences({
      categories: ['Show', 'Parade', 'Character_Meet'],
    });

    expect(results).toHaveLength(2);
    const names = results.map((r) => r.name);
    expect(names).toContain('Festival of Fantasy Parade');
    expect(names).toContain('Meet Mickey at Town Square Theater');
    expect(names).not.toContain('Space Mountain');
    expect(names).not.toContain('Be Our Guest Restaurant');
  });

  it('preserves established park ASC, lower(name) ASC ordering', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-1',
      name: 'Zebra Exhibit',
      park: 'Animal Kingdom',
      category: 'Show',
      areaType: 'ThemePark',
    });
    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-2',
      name: 'A Beauty and the Beast Live',
      park: 'Hollywood Studios',
      category: 'Show',
      areaType: 'ThemePark',
    });
    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-3',
      name: 'Festival of the Lion King',
      park: 'Animal Kingdom',
      category: 'Show',
      areaType: 'ThemePark',
    });

    const results = await repo.listActiveExperiences({
      categories: ['Show'],
    });

    expect(results.map((r) => r.name)).toEqual([
      'Festival of the Lion King',
      'Zebra Exhibit',
      'A Beauty and the Beast Live',
    ]);
  });

  it('handles repeated categories without duplicating result rows', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-parade',
      name: 'Festival of Fantasy Parade',
      park: 'Magic Kingdom',
      category: 'Parade',
      areaType: 'ThemePark',
    });

    const results = await repo.listActiveExperiences({
      categories: ['Parade', 'Parade', 'Parade'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('Festival of Fantasy Parade');
  });

  it('returns empty list when categories match no active experiences', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-ride',
      name: 'Big Thunder Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      areaType: 'ThemePark',
    });

    const results = await repo.listActiveExperiences({
      categories: ['Spa', 'Tour'],
    });

    expect(results).toEqual([]);
  });

  it('combines conjunctively with park, land, and category', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-mk-parade',
      name: 'Festival of Fantasy Parade',
      park: 'Magic Kingdom',
      category: 'Parade',
      areaType: 'ThemePark',
      land: 'Main Street, U.S.A.',
    });
    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-ep-show',
      name: 'Luminous',
      park: 'EPCOT',
      category: 'Show',
      areaType: 'ThemePark',
      land: 'World Celebration',
    });

    // Scoped to Magic Kingdom
    const mkResults = await repo.listActiveExperiences({
      park: 'Magic Kingdom',
      categories: ['Parade', 'Show'],
    });
    expect(mkResults).toHaveLength(1);
    expect(mkResults[0]?.name).toBe('Festival of Fantasy Parade');

    // Scoped to EPCOT
    const epResults = await repo.listActiveExperiences({
      park: 'EPCOT',
      categories: ['Parade', 'Show'],
    });
    expect(epResults).toHaveLength(1);
    expect(epResults[0]?.name).toBe('Luminous');
  });
});
