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
    applyMigration(db, '0008_experience_facet_enrichment.sql');
    applyMigration(db, '0039_experience_festival_tags.sql');

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
        [{ experienceId: booth1, year: 2026, slug: 'food-and-wine' }],
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

  describe('upsertTags', () => {
    it('re-running with identical inputs makes no additional row (Property 26)', async () => {
      const written1 = await repo.upsertTags(
        [{ experienceId: booth1, year: 2026, slug: 'flower-and-garden' }],
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
        [{ experienceId: booth1, year: 2026, slug: 'flower-and-garden' }],
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
        [{ experienceId: booth1, year: 2026, slug: 'food-and-wine' }],
        { force: false },
      );

      // Attempt to overwrite with flower-and-garden without force
      const writtenWithoutForce = await repo.upsertTags(
        [{ experienceId: booth1, year: 2026, slug: 'flower-and-garden' }],
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
        [{ experienceId: booth1, year: 2026, slug: 'flower-and-garden' }],
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

  describe('Tag Survives Deactivation (Property 27)', () => {
    it('soft-deleting and reactivating an experience leaves its festival tag unchanged', async () => {
      await repo.upsertTags(
        [{ experienceId: booth1, year: 2026, slug: 'flower-and-garden' }],
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
