/**
 * Integration tests (pg-mem) for menu-based Festival_Booth discovery in
 * `FestivalTagRepo.listActiveFestivalBooths` (festival-booth-tagging R3.8,
 * R3.9, Property 31).
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

async function seedMenu(
  pool: DbPool,
  experienceId: string,
  groupNames: readonly string[],
): Promise<void> {
  const menus = [
    {
      menuType: 'Lunch And Dinner',
      cuisineType: null,
      groups: groupNames.map((name) => ({ name, items: [] })),
    },
  ];
  await pool.query(
    `INSERT INTO experience_menus (experience_id, menus) VALUES ($1, $2::jsonb)`,
    [experienceId, JSON.stringify(menus)],
  );
}

describe('FestivalTagRepo.listActiveFestivalBooths — menu-based discovery (integration, pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: FestivalTagRepo;

  const permanentFoodWineRestaurant = randomUUID();
  const kioskBooth = randomUUID();
  const flowerGardenOnlyRestaurant = randomUUID();
  const noMenuRestaurant = randomUUID();
  const noMatchRestaurant = randomUUID();

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

    // Permanent restaurant: ordinary quick-service facet, no Festival Kiosk,
    // but a genuine Food & Wine Festival-named menu group (mirrors Tangierine
    // Cafe / Marketplace - Hawai'i / Swirled Showcase).
    await seedExperience(pool, {
      id: permanentFoodWineRestaurant,
      name: 'Tangierine Cafe: Flavors of the Medina',
      category: 'Restaurant',
      park: 'EPCOT',
      active: true,
      groupedFacets: { quickService: [{ id: 'quick-service-kiosk', name: 'Quick Service Kiosk' }] },
    });
    await seedMenu(pool, permanentFoodWineRestaurant, [
      'Food & Wine Festival Food Offerings',
      'Food & Wine Festival Alcoholic Beverage Offerings',
    ]);

    // Existing facet-based discovery path: a Festival Kiosk booth, no menu row
    // at all (verifies the facet-only path is unaffected, Property 31).
    await seedExperience(pool, {
      id: kioskBooth,
      name: 'Marketplace - France',
      category: 'Restaurant',
      park: 'EPCOT',
      active: true,
      groupedFacets: { quickService: [{ id: 'festival-kiosk', name: 'Festival Kiosk' }] },
    });

    // A restaurant whose only festival-named menu group belongs to a
    // DIFFERENT festival (mirrors Funnel Cake's Flower & Garden group).
    await seedExperience(pool, {
      id: flowerGardenOnlyRestaurant,
      name: 'Funnel Cake',
      category: 'Restaurant',
      park: 'EPCOT',
      active: true,
      groupedFacets: { quickService: [{ id: 'snack', name: 'Snack' }] },
    });
    await seedMenu(pool, flowerGardenOnlyRestaurant, [
      'Flower & Garden Festival Food Offerings',
    ]);

    // Active restaurant with no menu row and no Festival Kiosk facet.
    await seedExperience(pool, {
      id: noMenuRestaurant,
      name: 'Ordinary Restaurant',
      category: 'Restaurant',
      park: 'EPCOT',
      active: true,
      groupedFacets: { tableService: [{ id: 'casual-dining', name: 'Casual Dining' }] },
    });

    // Active restaurant with a menu, but no festival-named group at all.
    await seedExperience(pool, {
      id: noMatchRestaurant,
      name: 'Le Cellier Steakhouse',
      category: 'Restaurant',
      park: 'EPCOT',
      active: true,
      groupedFacets: { tableService: [{ id: 'casual-dining', name: 'Casual Dining' }] },
    });
    await seedMenu(pool, noMatchRestaurant, ['Entrees', 'Desserts', 'Beverages']);
  });

  it('discovers a permanent restaurant via its festival-named menu group alone (R3.8)', async () => {
    const booths = await repo.listActiveFestivalBooths(2026, 'food-and-wine');
    const ids = booths.map((b) => b.experienceId);

    expect(ids).toContain(permanentFoodWineRestaurant);
    expect(ids).toContain(kioskBooth);
  });

  it('does NOT discover the same restaurant when tagging a different festival (R3.9)', async () => {
    const booths = await repo.listActiveFestivalBooths(2026, 'festival-of-the-arts');
    const ids = booths.map((b) => b.experienceId);

    expect(ids).not.toContain(permanentFoodWineRestaurant);
  });

  it('excludes a restaurant whose only menu group matches a DIFFERENT festival keyword (R3.9)', async () => {
    const foodWineBooths = await repo.listActiveFestivalBooths(2026, 'food-and-wine');
    expect(foodWineBooths.map((b) => b.experienceId)).not.toContain(flowerGardenOnlyRestaurant);

    const flowerGardenBooths = await repo.listActiveFestivalBooths(2026, 'flower-and-garden');
    expect(flowerGardenBooths.map((b) => b.experienceId)).toContain(flowerGardenOnlyRestaurant);
  });

  it('excludes a restaurant with no Festival Kiosk facet, no menu, and no match (Property 31 subset)', async () => {
    const booths = await repo.listActiveFestivalBooths(2026, 'food-and-wine');
    const ids = booths.map((b) => b.experienceId);

    expect(ids).not.toContain(noMenuRestaurant);
    expect(ids).not.toContain(noMatchRestaurant);
  });

  it('the facet-only discovery path is unaffected for a booth with no menu row at all (Property 31)', async () => {
    const booths = await repo.listActiveFestivalBooths(2026, 'food-and-wine');
    const kiosk = booths.find((b) => b.experienceId === kioskBooth);

    expect(kiosk).toBeDefined();
    expect(kiosk?.name).toBe('Marketplace - France');
  });

  it('excludes a matching restaurant outside EPCOT (R3.10 scoping)', async () => {
    const otherParkMatch = randomUUID();
    await seedExperience(pool, {
      id: otherParkMatch,
      name: 'Magic Kingdom Festival Snack Stand',
      category: 'Restaurant',
      park: 'Magic Kingdom',
      active: true,
      groupedFacets: { quickService: [{ id: 'quick-service-kiosk', name: 'Quick Service Kiosk' }] },
    });
    await seedMenu(pool, otherParkMatch, ['Food & Wine Festival Food Offerings']);

    const booths = await repo.listActiveFestivalBooths(2026, 'food-and-wine');

    expect(booths.map((b) => b.experienceId)).not.toContain(otherParkMatch);
  });

  it('menu-based discovery is a superset addition over the facet-only set (Property 31)', async () => {
    const amendedResults = await repo.listActiveFestivalBooths(2026, 'food-and-wine');
    const amendedIds = new Set(amendedResults.map((b) => b.experienceId));

    // The facet-only set (what R3.3 alone would have discovered) must be a
    // subset of the amended result.
    expect(amendedIds.has(kioskBooth)).toBe(true);
    // The menu-only match is a strict addition, not present in the facet-only set.
    expect(amendedIds.has(permanentFoodWineRestaurant)).toBe(true);
  });
});
