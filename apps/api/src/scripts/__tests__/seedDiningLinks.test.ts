import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';

import {
  runSeedDiningLinks,
  type DiningLinkEntry,
  type SeedDiningLinksRepo,
} from '../seedDiningLinksLogic.js';
import { createCatalogRepo } from '../../services/catalog/repo.js';

const SAMPLE_SEED_DATA: DiningLinkEntry[] = [
  {
    upstreamEntityId: '18069632;entityType=restaurant',
    name: 'Tiffins Restaurant',
    diningUrl: 'https://disneyworld.disney.go.com/dining/animal-kingdom/tiffins-restaurant/',
  },
  {
    upstreamEntityId: '90002686;entityType=restaurant',
    name: 'Tusker House Restaurant',
    diningUrl: 'https://disneyworld.disney.go.com/dining/animal-kingdom/tusker-house-restaurant/',
  },
  {
    upstreamEntityId: 'unmatched-id;entityType=restaurant',
    name: 'Retired Restaurant',
    diningUrl: 'https://disneyworld.disney.go.com/dining/animal-kingdom/retired-restaurant/',
  },
];

describe('seedDiningLinksLogic', () => {
  it('parses entries, calls updateDiningUrl for each, and skips unmatched without aborting', async () => {
    const updatedCalls: Array<{ id: string; url: string }> = [];

    const mockRepo: SeedDiningLinksRepo = {
      updateDiningUrl: vi.fn(async (id: string, url: string) => {
        if (id === 'unmatched-id;entityType=restaurant') {
          return false; // unmatched row
        }
        updatedCalls.push({ id, url });
        return true;
      }),
    };

    const mockFsLib = {
      readFile: vi.fn().mockResolvedValue(JSON.stringify(SAMPLE_SEED_DATA)),
    };

    const warnFn = vi.fn();
    const result = await runSeedDiningLinks({
      repo: mockRepo,
      filePath: '/test/seed-data/dining-links.json',
      fsLib: mockFsLib,
      log: vi.fn(),
      warn: warnFn,
      error: vi.fn(),
    });

    expect(mockFsLib.readFile).toHaveBeenCalledWith(
      '/test/seed-data/dining-links.json',
      'utf8',
    );
    expect(mockRepo.updateDiningUrl).toHaveBeenCalledTimes(3);
    expect(result.updated).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.total).toBe(3);

    expect(updatedCalls).toEqual([
      {
        id: '18069632;entityType=restaurant',
        url: 'https://disneyworld.disney.go.com/dining/animal-kingdom/tiffins-restaurant/',
      },
      {
        id: '90002686;entityType=restaurant',
        url: 'https://disneyworld.disney.go.com/dining/animal-kingdom/tusker-house-restaurant/',
      },
    ]);

    expect(warnFn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping unmatched upstreamEntityId unmatched-id;entityType=restaurant'),
    );
  });

  it('is idempotent when run twice against the same seed file (R6.4)', async () => {
    const store = new Map<string, string>();

    const mockRepo: SeedDiningLinksRepo = {
      updateDiningUrl: vi.fn(async (id: string, url: string) => {
        store.set(id, url);
        return true;
      }),
    };

    const mockFsLib = {
      readFile: vi.fn().mockResolvedValue(JSON.stringify(SAMPLE_SEED_DATA.slice(0, 2))),
    };

    // Run 1
    const res1 = await runSeedDiningLinks({
      repo: mockRepo,
      filePath: '/test/seed-data/dining-links.json',
      fsLib: mockFsLib,
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    const state1 = new Map(store);

    // Run 2
    const res2 = await runSeedDiningLinks({
      repo: mockRepo,
      filePath: '/test/seed-data/dining-links.json',
      fsLib: mockFsLib,
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    const state2 = new Map(store);

    expect(res1).toEqual(res2);
    expect(state1).toEqual(state2);
    expect(state2.get('18069632;entityType=restaurant')).toBe(
      'https://disneyworld.disney.go.com/dining/animal-kingdom/tiffins-restaurant/',
    );
  });

  it('skips a missing seed file without throwing (ENOENT)', async () => {
    const mockRepo: SeedDiningLinksRepo = {
      updateDiningUrl: vi.fn(),
    };
    const enoent = Object.assign(new Error('no file'), { code: 'ENOENT' });
    const mockFsLib = {
      readFile: vi.fn().mockRejectedValue(enoent),
    };

    const result = await runSeedDiningLinks({
      repo: mockRepo,
      filePath: '/missing/dining-links.json',
      fsLib: mockFsLib,
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    expect(result).toEqual({ updated: 0, skipped: 0, total: 0 });
    expect(mockRepo.updateDiningUrl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Integration test against pg-mem with CatalogRepo and migrations 0001 + 0044
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
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

describe('runSeedDiningLinks integration with CatalogRepo (pg-mem)', () => {
  it('updates experiences.dining_url in real database and reads back through getExperience', async () => {
    const db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
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

    const { Pool: PgMemPool } = db.adapters.createPg();
    const pool = new PgMemPool();
    const repo = createCatalogRepo(pool as any);

    const expId1 = randomUUID();
    const expId2 = randomUUID();

    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ($1, $2, $3, 'Animal Kingdom', 'Restaurant')`,
      [expId1, '18069632;entityType=restaurant', 'Tiffins Restaurant'],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ($1, $2, $3, 'Animal Kingdom', 'Restaurant')`,
      [expId2, '90002686;entityType=restaurant', 'Tusker House Restaurant'],
    );

    const mockFsLib = {
      readFile: vi.fn().mockResolvedValue(JSON.stringify(SAMPLE_SEED_DATA)),
    };

    // Run seedDiningLinks
    const result = await runSeedDiningLinks({
      repo,
      filePath: '/virtual/dining-links.json',
      fsLib: mockFsLib,
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    expect(result.updated).toBe(2);
    expect(result.skipped).toBe(1);

    // Read back via getExperience
    const tiffins = await repo.getExperience(expId1);
    expect(tiffins?.diningUrl).toBe(
      'https://disneyworld.disney.go.com/dining/animal-kingdom/tiffins-restaurant/',
    );

    const tusker = await repo.getExperience(expId2);
    expect(tusker?.diningUrl).toBe(
      'https://disneyworld.disney.go.com/dining/animal-kingdom/tusker-house-restaurant/',
    );

    // Re-running produces the exact same end state (idempotency)
    const result2 = await runSeedDiningLinks({
      repo,
      filePath: '/virtual/dining-links.json',
      fsLib: mockFsLib,
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });
    expect(result2.updated).toBe(2);

    const tiffinsAfter = await repo.getExperience(expId1);
    expect(tiffinsAfter?.diningUrl).toBe(
      'https://disneyworld.disney.go.com/dining/animal-kingdom/tiffins-restaurant/',
    );
  });
});
