/**
 * Integration tests (pg-mem) for the `festivalTag` DTO projection and the
 * `festivalSlug`/`festivalYear` filter on `CatalogRepo.listActiveExperiences`
 * / `getExperience` (festival-booth-tagging Requirement 8, Property 29).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';

import type { DbPool } from '../../../db/pool.js';
import { createCatalogRepo, type CatalogRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors repo.categories.test.ts's harness)
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

function freshRepo(): { repo: CatalogRepo; pool: DbPool } {
  const db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as DbPool;

  applyInitMigration(db);
  applyMigration(db, '0002_experience_images.sql');
  applyMigration(db, '0003_note_shareable.sql');
  applyMigration(db, '0004_disney_sources.sql');
  applyMigration(db, '0006_experience_land.sql');
  applyMigration(db, '0007_experience_resort_area.sql');
  applyMigration(db, '0008_experience_facet_enrichment.sql');
  applyMigration(db, '0009_resort_representing_experiences.sql');
  applyMigration(db, '0010_resort_experience_category.sql');
  applyMigration(db, '0014_experience_world_showcase_country.sql');
  applyMigration(db, '0032_experience_category_taxonomy.sql');
  applyMigration(db, '0039_experience_festival_tags.sql');
  applyMigration(db, '0044_experience_dining_url.sql');
  applyMigration(db, '0049_resort_metadata.sql');

  return { repo: createCatalogRepo(pool), pool };
}

async function insertExperience(
  pool: DbPool,
  item: {
    id: string;
    enterpriseId: string;
    name: string;
    park: string | null;
    category: string;
    active?: boolean;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (
       id, upstream_entity_id, name, park, category, area_type, active
     )
     VALUES ($1, $2, $3, $4, $5, 'ThemePark', $6)`,
    [item.id, item.enterpriseId, item.name, item.park, item.category, item.active ?? true],
  );
}

async function insertTag(
  pool: DbPool,
  experienceId: string,
  slug: string,
  year: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
     VALUES ($1, $2, $3)`,
    [experienceId, slug, year],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CatalogRepo — festivalTag projection and festivalSlug/festivalYear filter (pg-mem)', () => {
  it('an untagged experience has no festivalTag on either read path', async () => {
    const { repo, pool } = freshRepo();
    const id = randomUUID();
    await insertExperience(pool, {
      id,
      enterpriseId: 'e-untagged',
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
    });

    const [listed] = await repo.listActiveExperiences();
    const detail = await repo.getExperience(id);

    expect(listed?.festivalTag).toBeUndefined();
    expect(detail?.festivalTag).toBeUndefined();
  });

  it('a single-year tagged experience surfaces that (slug, year) on both read paths', async () => {
    const { repo, pool } = freshRepo();
    const id = randomUUID();
    await insertExperience(pool, {
      id,
      enterpriseId: 'e-booth',
      name: 'Hanami',
      park: 'EPCOT',
      category: 'Restaurant',
    });
    await insertTag(pool, id, 'food-and-wine', 2026);

    const [listed] = await repo.listActiveExperiences();
    const detail = await repo.getExperience(id);

    expect(listed?.festivalTag).toEqual({ slug: 'food-and-wine', year: 2026 });
    expect(detail?.festivalTag).toEqual({ slug: 'food-and-wine', year: 2026 });
  });

  it('a multi-year-tagged experience surfaces only the highest year via the DTO (Property 29)', async () => {
    const { repo, pool } = freshRepo();
    const id = randomUUID();
    await insertExperience(pool, {
      id,
      enterpriseId: 'e-multi',
      name: 'Hanami',
      park: 'EPCOT',
      category: 'Restaurant',
    });
    await insertTag(pool, id, 'flower-and-garden', 2025);
    await insertTag(pool, id, 'food-and-wine', 2026);

    const detail = await repo.getExperience(id);

    expect(detail?.festivalTag).toEqual({ slug: 'food-and-wine', year: 2026 });
  });

  it("festivalSlug still matches the lower year's tag even though the DTO surfaces the higher year (Property 29)", async () => {
    const { repo, pool } = freshRepo();
    const id = randomUUID();
    await insertExperience(pool, {
      id,
      enterpriseId: 'e-multi',
      name: 'Hanami',
      park: 'EPCOT',
      category: 'Restaurant',
    });
    await insertTag(pool, id, 'flower-and-garden', 2025);
    await insertTag(pool, id, 'food-and-wine', 2026);

    const results = await repo.listActiveExperiences({
      festivalSlug: 'flower-and-garden',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(id);
    // The DTO itself still reports only the highest year's tag.
    expect(results[0]?.festivalTag).toEqual({ slug: 'food-and-wine', year: 2026 });
  });

  it('festivalSlug + festivalYear narrows to the exact tagged year', async () => {
    const { repo, pool } = freshRepo();
    const id = randomUUID();
    await insertExperience(pool, {
      id,
      enterpriseId: 'e-exact',
      name: 'Hanami',
      park: 'EPCOT',
      category: 'Restaurant',
    });
    await insertTag(pool, id, 'food-and-wine', 2025);
    await insertTag(pool, id, 'food-and-wine', 2026);

    const matchYear = await repo.listActiveExperiences({
      festivalSlug: 'food-and-wine',
      festivalYear: 2025,
    });
    expect(matchYear).toHaveLength(1);

    const missYear = await repo.listActiveExperiences({
      festivalSlug: 'food-and-wine',
      festivalYear: 1999,
    });
    expect(missYear).toHaveLength(0);
  });

  it('festivalSlug combines conjunctively with park and category', async () => {
    const { repo, pool } = freshRepo();
    const foodWineBooth = randomUUID();
    const otherFestivalBooth = randomUUID();
    const untaggedRestaurant = randomUUID();

    await insertExperience(pool, {
      id: foodWineBooth,
      enterpriseId: 'e-fw',
      name: 'Hanami',
      park: 'EPCOT',
      category: 'Restaurant',
    });
    await insertTag(pool, foodWineBooth, 'food-and-wine', 2026);

    await insertExperience(pool, {
      id: otherFestivalBooth,
      enterpriseId: 'e-mk-fw',
      name: 'Magic Kingdom Snack Stand',
      park: 'Magic Kingdom',
      category: 'Restaurant',
    });
    await insertTag(pool, otherFestivalBooth, 'food-and-wine', 2026);

    await insertExperience(pool, {
      id: untaggedRestaurant,
      enterpriseId: 'e-untagged-r',
      name: 'Le Cellier',
      park: 'EPCOT',
      category: 'Restaurant',
    });

    const results = await repo.listActiveExperiences({
      festivalSlug: 'food-and-wine',
      park: 'EPCOT',
      category: 'Restaurant',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(foodWineBooth);
  });

  it('returns an empty list when festivalSlug matches no active experiences', async () => {
    const { repo, pool } = freshRepo();
    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'e-ride',
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
    });

    const results = await repo.listActiveExperiences({
      festivalSlug: 'festival-of-the-arts',
    });

    expect(results).toEqual([]);
  });
});
