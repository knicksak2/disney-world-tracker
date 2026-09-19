/**
 * Integration tests (pg-mem) for `CatalogRepo.listDiningLinkEligibleRestaurants`
 * (restaurant-menu-display dining-link-candidate check follow-up).
 *
 * Exercises the real `reservations-accepted` facet-matching predicate against
 * real inserted rows and real `grouped_facets` JSON, rather than mocking the
 * repo — a bug in the facet-id match (e.g. matching on `name` instead of `id`,
 * or the wrong group key) would only be caught by a test that runs the real
 * predicate against realistic facet payloads shaped like Disney's own.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';

import type { DbPool } from '../../../db/pool.js';
import { createCatalogRepo, type CatalogRepo } from '../repo.js';

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
  applyMigration(db, '0010_resort_experience_category.sql');
  applyMigration(db, '0014_experience_world_showcase_country.sql');
  applyMigration(db, '0032_experience_category_taxonomy.sql');
  applyMigration(db, '0044_experience_dining_url.sql');

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
    groupedFacets?: unknown;
    active?: boolean;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (
       id, upstream_entity_id, name, park, category, area_type, grouped_facets, active
     )
     VALUES ($1, $2, $3, $4, $5, 'ThemePark', $6::jsonb, $7)`,
    [
      item.id,
      item.enterpriseId,
      item.name,
      item.park,
      item.category,
      JSON.stringify(item.groupedFacets ?? {}),
      item.active ?? true,
    ],
  );
}

describe('CatalogRepo.listDiningLinkEligibleRestaurants (pg-mem)', () => {
  it('includes a Restaurant whose tableService facets contain reservations-accepted', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: '18185631;entityType=restaurant',
      name: 'Jungle Navigation Co. LTD Skipper Canteen',
      park: 'Magic Kingdom',
      category: 'Restaurant',
      groupedFacets: {
        dining: [{ id: 'table-service-type', name: 'Table Service' }],
        tableService: [
          { id: 'casual-dining', name: 'Casual Dining' },
          { id: 'reservations-accepted', name: 'Reservations Accepted' },
        ],
      },
    });

    const result = await repo.listDiningLinkEligibleRestaurants();

    expect(result).toEqual([
      {
        upstreamEntityId: '18185631;entityType=restaurant',
        name: 'Jungle Navigation Co. LTD Skipper Canteen',
        park: 'Magic Kingdom',
      },
    ]);
  });

  it('includes a bar/lounge tagged barslounges-type as long as reservations-accepted is present (matches GEO-82 shape)', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: '412297708;entityType=restaurant',
      name: 'GEO-82',
      park: 'EPCOT',
      category: 'Restaurant',
      groupedFacets: {
        dining: [{ id: 'barslounges-type', name: 'Bars/Lounges' }],
        tableService: [
          { id: 'lounges', name: 'Bar-Lounge' },
          { id: 'reservations-accepted', name: 'Reservations Accepted' },
        ],
      },
    });

    const result = await repo.listDiningLinkEligibleRestaurants();

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('GEO-82');
  });

  it('excludes a quick-service Restaurant with no tableService facet group at all', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: '90002006;entityType=restaurant',
      name: 'Pizzafari',
      park: 'Animal Kingdom',
      category: 'Restaurant',
      groupedFacets: {
        dining: [{ id: 'quick-service-type', name: 'Quick Service' }],
        quickService: [{ id: 'counter-service', name: 'Quick Service Restaurant' }],
      },
    });

    const result = await repo.listDiningLinkEligibleRestaurants();

    expect(result).toEqual([]);
  });

  it('excludes a tableService restaurant lacking the reservations-accepted id specifically (e.g. a "- To Go" walk-up)', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: '90001873-togo;entityType=restaurant',
      name: 'Olivia\'s Cafe To Go',
      park: null,
      category: 'Restaurant',
      groupedFacets: {
        dining: [{ id: 'table-service-type', name: 'Table Service' }],
        tableService: [{ id: 'a-la-carte', name: 'a la Carte' }],
      },
    });

    const result = await repo.listDiningLinkEligibleRestaurants();

    expect(result).toEqual([]);
  });

  it('excludes a non-Restaurant category even if it somehow carries the facet', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'not-a-restaurant',
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      groupedFacets: {
        tableService: [{ id: 'reservations-accepted', name: 'Reservations Accepted' }],
      },
    });

    const result = await repo.listDiningLinkEligibleRestaurants();

    expect(result).toEqual([]);
  });

  it('excludes a soft-deleted (active = false) Restaurant even if eligible', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'retired;entityType=restaurant',
      name: 'Retired Restaurant',
      park: 'EPCOT',
      category: 'Restaurant',
      active: false,
      groupedFacets: {
        tableService: [{ id: 'reservations-accepted', name: 'Reservations Accepted' }],
      },
    });

    const result = await repo.listDiningLinkEligibleRestaurants();

    expect(result).toEqual([]);
  });

  it('returns an empty array when there are no experiences at all', async () => {
    const { repo } = freshRepo();

    const result = await repo.listDiningLinkEligibleRestaurants();

    expect(result).toEqual([]);
  });

  it('handles a Restaurant with grouped_facets = {} (default) without throwing', async () => {
    const { repo, pool } = freshRepo();

    await insertExperience(pool, {
      id: randomUUID(),
      enterpriseId: 'no-facets;entityType=restaurant',
      name: 'No Facets Restaurant',
      park: 'EPCOT',
      category: 'Restaurant',
      groupedFacets: {},
    });

    const result = await repo.listDiningLinkEligibleRestaurants();

    expect(result).toEqual([]);
  });
});
