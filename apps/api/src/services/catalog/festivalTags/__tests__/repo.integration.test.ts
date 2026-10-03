/**
 * Integration tests for FestivalTagRepo (pg-mem).
 *
 * Validates: Requirements 2.2, 2.5, 3.3, 3.5, 3.6 (Properties 26, 27)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../../db/pool.js';
import { createFestivalTagRepo, type FestivalTagRepo } from '../repo.js';

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
  return resolve(here, '..', '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

interface SeedExperienceParams {
  id: string;
  name: string;
  category: string;
  park: string;
  active: boolean;
  groupedFacets: unknown;
}

async function seedExperience(pool: DbPool, params: SeedExperienceParams): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, name, category, park, active, grouped_facets, upstream_entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.id,
      params.name,
      params.category,
      params.park,
      params.active,
      JSON.stringify(params.groupedFacets),
      `entity-${params.id}`,
    ],
  );
}

describe('FestivalTagRepo (integration, pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: FestivalTagRepo;

  const booth1 = randomUUID();
  const booth2 = randomUUID();
  const inactiveBooth = randomUUID();
  const nonKioskRestaurant = randomUUID();
  const ride = randomUUID();

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0002_experience_images.sql');
    applyMigration(db, '0003_note_shareable.sql');
    applyMigration(db, '0004_disney_sources.sql');
    applyMigration(db, '0008_experience_facet_enrichment.sql');
    applyMigration(db, '0039_experience_festival_tags.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0055_festival_edition_and_dish_tags.sql');

    repo = createFestivalTagRepo(pool);

    const festivalKioskFacet = {
      quickService: [{ id: 'fk-1', name: 'Festival Kiosk' }],
    };
    const tableServiceFacet = {
      tableService: [{ id: 'ts-1', name: 'Casual Dining' }],
    };

    // 1. Active booth 1
    await seedExperience(pool, {
      id: booth1,
      name: 'Bauernmarkt',
      category: 'Restaurant',
      park: 'EPCOT',
      active: true,
      groupedFacets: festivalKioskFacet,
    });

    // 2. Active booth 2
    await seedExperience(pool, {
      id: booth2,
      name: 'Cider House',
      category: 'Restaurant',
      park: 'EPCOT',
      active: true,
      groupedFacets: festivalKioskFacet,
    });

    // 3. Inactive booth
    await seedExperience(pool, {
      id: inactiveBooth,
      name: 'Old Booth',
      category: 'Restaurant',
      park: 'EPCOT',
      active: false,
      groupedFacets: festivalKioskFacet,
    });

    // 4. Regular Restaurant
    await seedExperience(pool, {
      id: nonKioskRestaurant,
      name: 'Le Cellier Steakhouse',
      category: 'Restaurant',
      park: 'EPCOT',
      active: true,
      groupedFacets: tableServiceFacet,
    });

    // 5. Ride
    await seedExperience(pool, {
      id: ride,
      name: 'Spaceship Earth',
      category: 'Ride',
      park: 'EPCOT',
      active: true,
      groupedFacets: {},
    });
  });

  describe('listActiveFestivalBooths', () => {
    it('returns only active + Restaurant + Festival Kiosk-faceted rows', async () => {
      const booths = await repo.listActiveFestivalBooths(2026, 'flower-and-garden');
      expect(booths.map((b) => b.experienceId).sort()).toEqual([booth1, booth2].sort());
      expect(booths.find((b) => b.experienceId === booth1)?.name).toBe('Bauernmarkt');
      expect(booths.find((b) => b.experienceId === booth1)?.park).toBe('EPCOT');
      expect(booths.find((b) => b.experienceId === booth1)?.conflictingTag).toBeNull();
    });

    it('flags conflictingTag when an existing tag for the target year has a different slug', async () => {
      // Pre-tag booth1 with food-and-wine in 2026
      await repo.upsertTags(
        [{ experienceId: booth1, year: 2026, slug: 'food-and-wine', matchKind: 'facet', matchingFoodItemIds: [] }],
        { force: false },
      );

      // Now discover for flower-and-garden in 2026
      const booths = await repo.listActiveFestivalBooths(2026, 'flower-and-garden');
      const b1 = booths.find((b) => b.experienceId === booth1);
      expect(b1).toBeDefined();
      expect(b1?.conflictingTag).not.toBeNull();
      expect(b1?.conflictingTag?.festivalSlug).toBe('food-and-wine');
      expect(b1?.conflictingTag?.festivalYear).toBe(2026);

      // Same festival slug is NOT considered a conflict
      const boothsSame = await repo.listActiveFestivalBooths(2026, 'food-and-wine');
      const b1Same = boothsSame.find((b) => b.experienceId === booth1);
      expect(b1Same?.conflictingTag).toBeNull();
    });
  });

  describe('listActiveEpcotRestaurantIds', () => {
    it('returns only active, EPCOT, Restaurant ids — excluding other parks and categories', async () => {
      const otherParkRestaurant = randomUUID();
      await seedExperience(pool, {
        id: otherParkRestaurant,
        name: 'Be Our Guest Restaurant',
        category: 'Restaurant',
        park: 'Magic Kingdom',
        active: true,
        groupedFacets: {},
      });

      const ids = await repo.listActiveEpcotRestaurantIds();

      expect(ids).toContain(booth1);
      expect(ids).toContain(booth2);
      expect(ids).toContain(nonKioskRestaurant);
      // Not EPCOT.
      expect(ids).not.toContain(otherParkRestaurant);
      // Inactive EPCOT restaurant.
      expect(ids).not.toContain(inactiveBooth);
      // EPCOT but not a Restaurant.
      expect(ids).not.toContain(ride);
    });
  });

  describe('upsertTags', () => {
    it('re-running with identical inputs makes no additional row (Property 26)', async () => {
      const written1 = await repo.upsertTags(
        [{ experienceId: booth1, year: 2026, slug: 'flower-and-garden', matchKind: 'facet', matchingFoodItemIds: [] }],
        { force: false },
      );
      expect(written1).toEqual([booth1]);

      const count1 = await pool.query<{ n: number }>(
        `SELECT count(*)::int as n FROM experience_festival_tags WHERE experience_id = $1`,
        [booth1],
      );
      expect(count1.rows[0]?.n).toBe(1);

      // Re-run identical
      const written2 = await repo.upsertTags(
        [{ experienceId: booth1, year: 2026, slug: 'flower-and-garden', matchKind: 'facet', matchingFoodItemIds: [] }],
        { force: false },
      );
      expect(written2).toEqual([booth1]);

      const count2 = await pool.query<{ n: number }>(
        `SELECT count(*)::int as n FROM experience_festival_tags WHERE experience_id = $1`,
        [booth1],
      );
      expect(count2.rows[0]?.n).toBe(1);
    });

    it('excludes same-year different-slug call without force and applies with force', async () => {
      // Initial tag
      await repo.upsertTags(
        [{ experienceId: booth1, year: 2026, slug: 'food-and-wine', matchKind: 'facet', matchingFoodItemIds: [] }],
        { force: false },
      );

      // Attempt to overwrite with flower-and-garden without force
      const writtenWithoutForce = await repo.upsertTags(
        [{ experienceId: booth1, year: 2026, slug: 'flower-and-garden', matchKind: 'facet', matchingFoodItemIds: [] }],
        { force: false },
      );
      expect(writtenWithoutForce).toEqual([]);

      // Row should still be food-and-wine
      const check1 = await pool.query<{ festival_slug: string }>(
        `SELECT festival_slug FROM experience_festival_tags WHERE experience_id = $1`,
        [booth1],
      );
      expect(check1.rows[0]?.festival_slug).toBe('food-and-wine');

      // Now with force: true
      const writtenWithForce = await repo.upsertTags(
        [{ experienceId: booth1, year: 2026, slug: 'flower-and-garden', matchKind: 'facet', matchingFoodItemIds: [] }],
        { force: true },
      );
      expect(writtenWithForce).toEqual([booth1]);

      const check2 = await pool.query<{ festival_slug: string }>(
        `SELECT festival_slug FROM experience_festival_tags WHERE experience_id = $1`,
        [booth1],
      );
      expect(check2.rows[0]?.festival_slug).toBe('flower-and-garden');
    });
  });

  describe('upsertTags — match_kind + dish tags (R10.1, R10.2)', () => {
    let menuRestaurant: string;
    let foodItem1: string;
    let foodItem2: string;

    beforeEach(async () => {
      menuRestaurant = randomUUID();
      await seedExperience(pool, {
        id: menuRestaurant,
        name: 'Tangierine Cafe',
        category: 'Restaurant',
        park: 'EPCOT',
        active: true,
        groupedFacets: { quickService: [{ id: 'qsk-1', name: 'Quick Service Kiosk' }] },
      });

      const f1 = await pool.query<{ id: string }>(
        `INSERT INTO food_items (experience_id, name, source) VALUES ($1, 'Falafel Wrap', 'menu_sync') RETURNING id`,
        [menuRestaurant],
      );
      foodItem1 = f1.rows[0]!.id;
      const f2 = await pool.query<{ id: string }>(
        `INSERT INTO food_items (experience_id, name, source) VALUES ($1, 'Lentil Soup', 'menu_sync') RETURNING id`,
        [menuRestaurant],
      );
      foodItem2 = f2.rows[0]!.id;
    });

    it("writes both the experience tag AND per-dish tags in one call for matchKind: 'menu' with non-empty matchingFoodItemIds", async () => {
      const written = await repo.upsertTags(
        [
          {
            experienceId: menuRestaurant,
            year: 2026,
            slug: 'food-and-wine',
            matchKind: 'menu',
            matchingFoodItemIds: [foodItem1, foodItem2],
          },
        ],
        { force: false },
      );
      expect(written).toEqual([menuRestaurant]);

      const tagRow = await pool.query<{ match_kind: string }>(
        `SELECT match_kind FROM experience_festival_tags WHERE experience_id = $1`,
        [menuRestaurant],
      );
      expect(tagRow.rows[0]?.match_kind).toBe('menu');

      const dishRows = await pool.query<{ food_item_id: string; festival_slug: string }>(
        `SELECT food_item_id, festival_slug FROM food_item_festival_tags WHERE food_item_id IN ($1, $2)`,
        [foodItem1, foodItem2],
      );
      expect(dishRows.rows).toHaveLength(2);
      expect(dishRows.rows.every((r) => r.festival_slug === 'food-and-wine')).toBe(true);
    });

    it("writes ZERO dish tags for matchKind: 'facet' even if matchingFoodItemIds is (defensively) non-empty", async () => {
      await repo.upsertTags(
        [
          {
            experienceId: menuRestaurant,
            year: 2026,
            slug: 'food-and-wine',
            matchKind: 'facet',
            matchingFoodItemIds: [foodItem1, foodItem2],
          },
        ],
        { force: false },
      );

      const tagRow = await pool.query<{ match_kind: string }>(
        `SELECT match_kind FROM experience_festival_tags WHERE experience_id = $1`,
        [menuRestaurant],
      );
      expect(tagRow.rows[0]?.match_kind).toBe('facet');

      const dishRows = await pool.query<{ food_item_id: string }>(
        `SELECT food_item_id FROM food_item_festival_tags WHERE food_item_id IN ($1, $2)`,
        [foodItem1, foodItem2],
      );
      expect(dishRows.rows).toHaveLength(0);
    });
  });

  describe('upsertFestivalEdition (R9.3)', () => {
    it('inserts a new edition window', async () => {
      await repo.upsertFestivalEdition('food-and-wine', 2026, '2026-08-28', null);
      const r = await pool.query<{ starts_on: string; ends_on: string | null }>(
        `SELECT starts_on, ends_on FROM festival_editions WHERE festival_slug = 'food-and-wine' AND festival_year = 2026`,
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.ends_on).toBeNull();
    });

    it('never blanks a previously-set ends_on when later called with endsOn: null', async () => {
      await repo.upsertFestivalEdition('food-and-wine', 2026, '2026-08-28', '2026-11-18');
      // Operator re-runs CLI later this run without re-entering an end date.
      await repo.upsertFestivalEdition('food-and-wine', 2026, '2026-08-28', null);

      const r = await pool.query<{ ends_on: string | Date | null }>(
        `SELECT ends_on FROM festival_editions WHERE festival_slug = 'food-and-wine' AND festival_year = 2026`,
      );
      const endsOn = r.rows[0]?.ends_on;
      const isoDate = endsOn instanceof Date ? endsOn.toISOString().slice(0, 10) : String(endsOn);
      expect(isoDate).toBe('2026-11-18');
    });

    it('overwrites ends_on when a new explicit date is supplied', async () => {
      await repo.upsertFestivalEdition('food-and-wine', 2026, '2026-08-28', '2026-11-18');
      await repo.upsertFestivalEdition('food-and-wine', 2026, '2026-08-28', '2026-11-25');

      const r = await pool.query<{ ends_on: string | Date | null }>(
        `SELECT ends_on FROM festival_editions WHERE festival_slug = 'food-and-wine' AND festival_year = 2026`,
      );
      const endsOn = r.rows[0]?.ends_on;
      const isoDate = endsOn instanceof Date ? endsOn.toISOString().slice(0, 10) : String(endsOn);
      expect(isoDate).toBe('2026-11-25');
    });
  });

  describe('Tag Survives Deactivation (Property 27)', () => {
    it('soft-deleting and reactivating an experience leaves its festival tag unchanged', async () => {
      await repo.upsertTags(
        [{ experienceId: booth1, year: 2026, slug: 'flower-and-garden', matchKind: 'facet', matchingFoodItemIds: [] }],
        { force: false },
      );

      const before = await pool.query<{ festival_slug: string; festival_year: number }>(
        `SELECT festival_slug, festival_year FROM experience_festival_tags WHERE experience_id = $1`,
        [booth1],
      );
      expect(before.rows).toHaveLength(1);

      // Soft-delete experience (Catalog_Sync reconcile pattern)
      await pool.query(`UPDATE experiences SET active = FALSE WHERE id = $1`, [booth1]);

      const during = await pool.query<{ festival_slug: string; festival_year: number }>(
        `SELECT festival_slug, festival_year FROM experience_festival_tags WHERE experience_id = $1`,
        [booth1],
      );
      expect(during.rows).toEqual(before.rows);

      // Reactivate
      await pool.query(`UPDATE experiences SET active = TRUE WHERE id = $1`, [booth1]);

      const after = await pool.query<{ festival_slug: string; festival_year: number }>(
        `SELECT festival_slug, festival_year FROM experience_festival_tags WHERE experience_id = $1`,
        [booth1],
      );
      expect(after.rows).toEqual(before.rows);
    });
  });
});
