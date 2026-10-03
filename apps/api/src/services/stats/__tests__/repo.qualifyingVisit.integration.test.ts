/**
 * Integration tests for `StatsRepo::getStatsSnapshot`'s festival counts, now
 * sourced from the Qualifying_Visit computation (festival-booth-tagging
 * R9-R11) instead of a plain `completions JOIN experience_festival_tags`.
 *
 * Exercises the SAME scenarios `pins/__tests__/repo.integration.test.ts`
 * covers for `buildSnapshot`, against the real `getStatsSnapshot` SQL on a
 * real pg-mem database running the actual migration SQL — so the two
 * services' shared `collectQualifyingVisits`/`isQualifyingVisit` behavior is
 * verified at both call sites, not just one.
 *
 * Validates: Requirements 9.4, 9.5, 10.3, 11.1, 11.2, 11.3 (Property 32, 33, 34)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createStatsRepo, type StatsRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem harness
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
  // pg-mem does not implement the two-arg numeric ROUND() the stats repo's
  // highest-rated-dish query relies on (`ROUND(AVG(...)::numeric, 1)`).
  db.public.registerFunction({
    name: 'round',
    args: [DataType.decimal, DataType.integer],
    returns: DataType.decimal,
    implementation: (value: unknown, precision: unknown): number => {
      const n = typeof value === 'string' ? Number(value) : (value as number);
      const p = typeof precision === 'string' ? Number(precision) : (precision as number);
      const factor = 10 ** p;
      return Math.round(n * factor) / factor;
    },
  });
  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

/** Migrations that create every table/column the Stats festival-count read touches. */
const MIGRATIONS = [
  '0001_init.sql', // users, experiences (base), completions, ratings, notes
  '0002_experience_images.sql', // experiences.image_url/image_attribution (dropped by 0004)
  '0004_disney_sources.sql', // resorts table, experiences.area_type/resort_id
  '0006_experience_land.sql',
  '0007_experience_resort_area.sql', // experiences.resort_area
  '0008_experience_facet_enrichment.sql',
  '0009_resort_representing_experiences.sql', // experiences.represents_resort_id
  '0014_experience_world_showcase_country.sql',
  '0015_trips.sql',
  '0032_experience_category_taxonomy.sql',
  '0034_experience_logs.sql',
  '0039_experience_festival_tags.sql',
  '0040_food_item_logging.sql',
  '0055_festival_edition_and_dish_tags.sql',
];

interface Fixture {
  readonly pool: DbPool;
  readonly repo: StatsRepo;
}

function setup(): Fixture {
  const db = buildPgMemDatabase();
  for (const name of MIGRATIONS) applyMigration(db, name);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as DbPool;
  return { pool, repo: createStatsRepo(pool) };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedUser(pool: DbPool): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'h')`, [
    id,
    `${id}@example.com`,
  ]);
  return id;
}

interface SeedExperienceOpts {
  readonly category: string;
  readonly park?: string;
  readonly facets?: Record<string, ReadonlyArray<{ id: string; name: string }>>;
}

async function seedExperience(pool: DbPool, opts: SeedExperienceOpts): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences
       (id, upstream_entity_id, name, park, category, grouped_facets)
     VALUES ($1, $2, 'Restaurant', $3, $4, $5::jsonb)`,
    [id, `up-${id}`, opts.park ?? 'EPCOT', opts.category, JSON.stringify(opts.facets ?? {})],
  );
  return id;
}

async function complete(pool: DbPool, userId: string, experienceId: string, completedOn = '2026-01-02'): Promise<void> {
  await pool.query(
    `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
     VALUES ($1, $2, $3::date, 'America/New_York')`,
    [userId, experienceId, completedOn],
  );
}

async function seedTag(
  pool: DbPool,
  experienceId: string,
  festivalSlug: string,
  matchKind: 'facet' | 'menu',
  festivalYear = 2026,
): Promise<void> {
  await pool.query(
    `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year, match_kind)
     VALUES ($1, $2, $3::int, $4)`,
    [experienceId, festivalSlug, festivalYear, matchKind],
  );
}

async function seedFoodItem(pool: DbPool, experienceId: string, name: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO food_items (experience_id, name, source) VALUES ($1, $2, 'menu_sync') RETURNING id`,
    [experienceId, name],
  );
  return res.rows[0]!.id;
}

async function addFoodItemLog(pool: DbPool, userId: string, foodItemId: string, visitedOn: string): Promise<void> {
  await pool.query(
    `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz)
     VALUES ($1, $2, $3::date, 'America/New_York')`,
    [userId, foodItemId, visitedOn],
  );
}

async function tagFoodItemFestival(pool: DbPool, foodItemId: string, festivalSlug: string, festivalYear = 2026): Promise<void> {
  await pool.query(
    `INSERT INTO food_item_festival_tags (food_item_id, festival_slug, festival_year) VALUES ($1, $2, $3::int)`,
    [foodItemId, festivalSlug, festivalYear],
  );
}

async function seedFestivalEdition(
  pool: DbPool,
  festivalSlug: string,
  festivalYear: number,
  startsOn: string,
  endsOn: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO festival_editions (festival_slug, festival_year, starts_on, ends_on)
     VALUES ($1, $2::int, $3::date, $4::date)
     ON CONFLICT (festival_slug, festival_year) DO UPDATE
       SET starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on`,
    [festivalSlug, festivalYear, startsOn, endsOn],
  );
}

const REAL_RESTAURANT_FACETS = { tableService: [{ id: 'casual-dining', name: 'Casual Dining' }] };
const FESTIVAL_FACETS = { quickService: [{ id: 'festival-kiosk', name: 'Festival Kiosk' }] };

describe('StatsRepo festival counts — Qualifying_Visit computation (pg-mem)', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = setup();
  });

  it("does NOT count a 'menu'-matched restaurant's completion when NO tagged-dish log exists (R10.3)", async () => {
    const user = await seedUser(fx.pool);
    const restaurant = await seedExperience(fx.pool, { category: 'Restaurant', facets: REAL_RESTAURANT_FACETS });
    await seedTag(fx.pool, restaurant, 'food-and-wine', 'menu');
    await complete(fx.pool, user, restaurant);

    const snapshot = await fx.repo.getStatsSnapshot({ targetUserId: user, includePercentile: false });
    expect(snapshot.festivalCounts?.lifetimeCount).toBe(0);
    expect(snapshot.festivalCounts?.rows).toEqual([]);
  });

  it("counts a 'menu'-matched restaurant exactly once with a tagged-dish log, even WITH the completion present (R10.3)", async () => {
    const user = await seedUser(fx.pool);
    const restaurant = await seedExperience(fx.pool, { category: 'Restaurant', facets: REAL_RESTAURANT_FACETS });
    await seedTag(fx.pool, restaurant, 'food-and-wine', 'menu');
    await complete(fx.pool, user, restaurant);
    const dish = await seedFoodItem(fx.pool, restaurant, 'Falafel Wrap');
    await tagFoodItemFestival(fx.pool, dish, 'food-and-wine');
    await addFoodItemLog(fx.pool, user, dish, '2026-09-01');

    const snapshot = await fx.repo.getStatsSnapshot({ targetUserId: user, includePercentile: false });
    expect(snapshot.festivalCounts?.lifetimeCount).toBe(1);
    expect(snapshot.festivalCounts?.rows).toEqual([{ slug: 'food-and-wine', n: 1 }]);
  });

  it("counts a 'facet'-matched booth from either signal (R11.1)", async () => {
    const user = await seedUser(fx.pool);
    const booth = await seedExperience(fx.pool, { category: 'Restaurant', facets: FESTIVAL_FACETS });
    await seedTag(fx.pool, booth, 'food-and-wine', 'facet');
    await complete(fx.pool, user, booth);

    const snapshot = await fx.repo.getStatsSnapshot({ targetUserId: user, includePercentile: false });
    expect(snapshot.festivalCounts?.lifetimeCount).toBe(1);
  });

  it('does not count a signal outside a set Festival_Edition window, but does once widened (R9.4, R9.5)', async () => {
    const user = await seedUser(fx.pool);
    const booth = await seedExperience(fx.pool, { category: 'Restaurant', facets: FESTIVAL_FACETS });
    await seedTag(fx.pool, booth, 'food-and-wine', 'facet');
    await complete(fx.pool, user, booth, '2026-01-02');
    await seedFestivalEdition(fx.pool, 'food-and-wine', 2026, '2026-08-28', '2026-11-18');

    const outside = await fx.repo.getStatsSnapshot({ targetUserId: user, includePercentile: false });
    expect(outside.festivalCounts?.lifetimeCount).toBe(0);

    await seedFestivalEdition(fx.pool, 'food-and-wine', 2026, '2026-01-01', '2026-11-18');
    const widened = await fx.repo.getStatsSnapshot({ targetUserId: user, includePercentile: false });
    expect(widened.festivalCounts?.lifetimeCount).toBe(1);
  });

  it('counts exactly once when two different dishes are logged the same day (dedup, Property 32)', async () => {
    const user = await seedUser(fx.pool);
    const restaurant = await seedExperience(fx.pool, { category: 'Restaurant', facets: REAL_RESTAURANT_FACETS });
    await seedTag(fx.pool, restaurant, 'food-and-wine', 'menu');
    const dish1 = await seedFoodItem(fx.pool, restaurant, 'Falafel Wrap');
    const dish2 = await seedFoodItem(fx.pool, restaurant, 'Fig Cocktail');
    await tagFoodItemFestival(fx.pool, dish1, 'food-and-wine');
    await tagFoodItemFestival(fx.pool, dish2, 'food-and-wine');
    await addFoodItemLog(fx.pool, user, dish1, '2026-09-01');
    await addFoodItemLog(fx.pool, user, dish2, '2026-09-01');

    const snapshot = await fx.repo.getStatsSnapshot({ targetUserId: user, includePercentile: false });
    expect(snapshot.festivalCounts?.lifetimeCount).toBe(1);
    expect(snapshot.festivalCounts?.rows).toEqual([{ slug: 'food-and-wine', n: 1 }]);
  });

  it('breaks down counts per festival slug across multiple qualifying experiences (R5.2)', async () => {
    const user = await seedUser(fx.pool);
    const booth1 = await seedExperience(fx.pool, { category: 'Restaurant', facets: FESTIVAL_FACETS });
    const booth2 = await seedExperience(fx.pool, { category: 'Restaurant', facets: FESTIVAL_FACETS });
    await seedTag(fx.pool, booth1, 'food-and-wine', 'facet');
    await seedTag(fx.pool, booth2, 'flower-and-garden', 'facet');
    await complete(fx.pool, user, booth1);
    await complete(fx.pool, user, booth2);

    const snapshot = await fx.repo.getStatsSnapshot({ targetUserId: user, includePercentile: false });
    expect(snapshot.festivalCounts?.lifetimeCount).toBe(2);
    expect(snapshot.festivalCounts?.rows.slice().sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: 'flower-and-garden', n: 1 },
      { slug: 'food-and-wine', n: 1 },
    ]);
  });
});
