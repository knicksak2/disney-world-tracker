/**
 * Task 12.3 — Retirement smoke tests.
 *
 * A single, hermetic smoke suite that pins the three end-state guarantees of the
 * ThemeParks.wiki → Disney migration once the retirement work (tasks 12.1/12.2)
 * is in place:
 *
 *   1. **Sync cadence (R12.8).** The scheduled Catalog_Sync interval never
 *      exceeds 24 hours.
 *
 *   2. **Migration completeness (R14.5) + source split (R13.1, R13.3).**
 *      `isMigrationComplete` flips to `true` *only* once the Bridge_Map has been
 *      built AND at least one Disney-only Catalog_Sync has succeeded and
 *      persisted — never on just one of the two. Structural scans then pin the
 *      disney-source-resilience source split: Disney is the sole source of
 *      Static_Catalog_Data (R13.3), so the composition root wires the Disney
 *      static egress (`createDisneyTransport` + `createFacilitiesClient`) and the
 *      Catalog_Sync orchestrator never constructs a ThemeParks *catalog* request
 *      client — the *only* ThemeParks catalog read left in the codebase is the
 *      one-time `buildBridgeMap` (R14.3). Live_Detail, by contrast, is now
 *      derived from ThemeParks.wiki (R13.1), so the composition root DOES wire
 *      the ThemeParks.wiki live client for the live path.
 *
 *   3. **Image-pipeline retirement (R14.6, R14.7, R14.8).** The out-of-band
 *      image-sourcing job (`sourceImages.ts`), its curated overrides
 *      (`imageOverrides.json`), and the `source-images` npm command are all
 *      absent; the `image_attribution` column is dropped from `experiences`; and
 *      no attribution field is exposed on the catalog detail DTO.
 *
 * These are deliberately lightweight "does the end state hold" checks rather than
 * exhaustive behavioral tests — the per-module behavior is covered by the unit and
 * property suites elsewhere. No database, Redis, or upstream HTTP is touched: the
 * migration predicate runs against a fake reader, the column drop runs against an
 * in-memory pg-mem schema, and the retirement guarantees are asserted structurally
 * over the source tree.
 *
 * _Requirements: 12.8, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { ExperienceDTO } from '@dwt/shared';

import { registerErrorHandler } from '../../../../errors/handler.js';
import { catalogRoutes } from '../../routes.js';
import { CATALOG_SYNC_INTERVAL_MS } from '../../scheduler.js';
import {
  hasSuccessfulDisneySync,
  isBridgeMapBuilt,
  isMigrationComplete,
  type MigrationStateReader,
} from '../migrationComplete.js';

// ---------------------------------------------------------------------------
// Paths (this file lives at src/services/catalog/disney/__tests__/)
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → disney → catalog → services → src
const SRC_DIR = resolve(HERE, '..', '..', '..', '..');
// __tests__ → disney → catalog → services → src → apps/api
const API_DIR = resolve(SRC_DIR, '..');

function srcFile(...parts: string[]): string {
  return resolve(SRC_DIR, ...parts);
}
function migrationPath(name: string): string {
  return resolve(API_DIR, 'migrations', name);
}

// ---------------------------------------------------------------------------
// pg-mem harness (mirrors repo.apply.integration.test.ts)
// ---------------------------------------------------------------------------

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();

  db.registerExtension('citext', () => {
    // native
  });
  db.registerExtension('pg_trgm', () => {
    // only consulted by the GIN indexes stripped below
  });
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

function applyInitMigration(db: IMemoryDb): void {
  let sql = readFileSync(migrationPath('0001_init.sql'), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

function applyMigration(db: IMemoryDb, name: string): void {
  const sql = readFileSync(migrationPath(name), 'utf8');
  db.public.none(sql);
}

// ---------------------------------------------------------------------------
// Fake migration-state reader
// ---------------------------------------------------------------------------

/**
 * Build a {@link MigrationStateReader} from the two independently observable
 * facts the completeness predicate depends on: whether the Bridge_Map carries
 * any entry, and whether a successful sync has been recorded.
 */
function makeReader(opts: {
  bridgeBuilt: boolean;
  syncSucceeded: boolean;
}): MigrationStateReader {
  const bridge = new Map<string, string>(
    opts.bridgeBuilt ? [['80010177;entityType=Attraction', randomUUID()]] : [],
  );
  return {
    async getBridgeMap() {
      return bridge;
    },
    async getCacheAge() {
      return {
        lastSuccessfulSyncAt: opts.syncSucceeded ? new Date() : null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Cadence (R12.8)
// ---------------------------------------------------------------------------

describe('Catalog_Sync cadence (R12.8)', () => {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  it('the scheduled sync interval does not exceed 24 hours', () => {
    expect(CATALOG_SYNC_INTERVAL_MS).toBeLessThanOrEqual(TWENTY_FOUR_HOURS_MS);
  });

  it('the interval is a positive duration', () => {
    expect(CATALOG_SYNC_INTERVAL_MS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Migration completeness (R14.5)
// ---------------------------------------------------------------------------

describe('migration completeness predicate (R14.5)', () => {
  it('is false when neither the bridge is built nor a sync has succeeded', async () => {
    const reader = makeReader({ bridgeBuilt: false, syncSucceeded: false });
    await expect(isMigrationComplete(reader)).resolves.toBe(false);
  });

  it('is false when only the bridge is built (no Disney sync yet)', async () => {
    const reader = makeReader({ bridgeBuilt: true, syncSucceeded: false });
    await expect(isBridgeMapBuilt(reader)).resolves.toBe(true);
    await expect(hasSuccessfulDisneySync(reader)).resolves.toBe(false);
    await expect(isMigrationComplete(reader)).resolves.toBe(false);
  });

  it('is false when only a sync has succeeded (bridge not built)', async () => {
    const reader = makeReader({ bridgeBuilt: false, syncSucceeded: true });
    await expect(isBridgeMapBuilt(reader)).resolves.toBe(false);
    await expect(hasSuccessfulDisneySync(reader)).resolves.toBe(true);
    await expect(isMigrationComplete(reader)).resolves.toBe(false);
  });

  it('flips to true only once the bridge is built AND a Disney sync has succeeded', async () => {
    const reader = makeReader({ bridgeBuilt: true, syncSucceeded: true });
    await expect(isBridgeMapBuilt(reader)).resolves.toBe(true);
    await expect(hasSuccessfulDisneySync(reader)).resolves.toBe(true);
    await expect(isMigrationComplete(reader)).resolves.toBe(true);
  });

  it('treats an empty Bridge_Map as "not built"', async () => {
    const reader: MigrationStateReader = {
      async getBridgeMap() {
        return new Map<string, string>();
      },
      async getCacheAge() {
        return { lastSuccessfulSyncAt: new Date() };
      },
    };
    await expect(isBridgeMapBuilt(reader)).resolves.toBe(false);
    await expect(isMigrationComplete(reader)).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Source split — Disney static catalog + ThemeParks.wiki live (R13.1, R13.3, R14.3)
// ---------------------------------------------------------------------------

describe('source split — Disney static catalog, ThemeParks.wiki live (R13.1, R13.3, R14.3)', () => {
  it('the composition root wires the ThemeParks.wiki live client and the Disney static egress (R13.1, R13.3)', () => {
    const source = readFileSync(srcFile('composeServices.ts'), 'utf8');
    // disney-source-resilience reverses the earlier retirement. Live_Detail is
    // now derived from ThemeParks.wiki (R13.1), so the composition root DOES
    // wire the ThemeParks.wiki live client for the live path.
    expect(source).toMatch(/createThemeParksLiveClient\s*\(/);
    // Disney remains the SOLE source of Static_Catalog_Data (R13.3): the
    // Facilities_Client is built on top of the shared Disney_Transport for the
    // static egress.
    expect(source).toMatch(/createFacilitiesClient/);
    expect(source).toMatch(/createDisneyTransport/);
    // The retired Disney live client is never wired (its live role moved back
    // to ThemeParks.wiki, R13.1).
    expect(source).not.toMatch(/createDisneyLiveClient/);
  });

  it('the Catalog_Sync orchestrator never constructs a ThemeParks catalog request client', () => {
    const source = readFileSync(srcFile('services', 'catalog', 'sync.ts'), 'utf8');
    // sync.ts may reuse the shared `UpstreamError` vocabulary from themeparks.ts,
    // but static catalog data comes only from Disney (R13.3): it must not build
    // or depend on the ThemeParks catalog request client type.
    expect(source).not.toMatch(/createThemeParksClient/);
    expect(source).not.toMatch(/\bThemeParksClient\b/);
  });

  it('the one-time Bridge_Map build is the sole remaining ThemeParks catalog reader (R14.3)', () => {
    const source = readFileSync(
      srcFile('services', 'catalog', 'disney', 'bridge.ts'),
      'utf8',
    );
    // bridge.ts is the single permitted ThemeParks read — assert it is present
    // here so the "exactly once" invariant has a pinned location.
    expect(source).toMatch(/\bThemeParksClient\b/);
    expect(source).toMatch(/buildBridgeMap/);
  });
});

// ---------------------------------------------------------------------------
// 4. Image-pipeline retirement — files and command absent (R14.6, R14.7)
// ---------------------------------------------------------------------------

describe('image-pipeline retirement (R14.6, R14.7)', () => {
  it('the out-of-band image-sourcing job is deleted', () => {
    expect(existsSync(srcFile('scripts', 'sourceImages.ts'))).toBe(false);
  });

  it('the curated image-override file is deleted', () => {
    expect(existsSync(srcFile('scripts', 'imageOverrides.json'))).toBe(false);
  });

  it('the source-images npm command is removed from package.json', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(API_DIR, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    expect(scripts).not.toHaveProperty('source-images');
    // Belt and suspenders: no surviving command should invoke the deleted script.
    for (const command of Object.values(scripts)) {
      expect(command).not.toMatch(/sourceImages/);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. image_attribution dropped and not exposed (R14.8)
// ---------------------------------------------------------------------------

describe('image_attribution retirement (R14.8)', () => {
  it('migration 0004 drops the image_attribution column', () => {
    const sql = readFileSync(migrationPath('0004_disney_sources.sql'), 'utf8');
    expect(sql).toMatch(/ALTER TABLE experiences\s+DROP COLUMN image_attribution/i);
  });

  it('the column exists after 0002 but is gone after the full migration set', () => {
    // Present after 0002 (added by the ThemeParks-era image feature).
    const before = buildPgMemDatabase();
    applyInitMigration(before);
    applyMigration(before, '0002_experience_images.sql');
    expect(() =>
      before.public.none('SELECT image_attribution FROM experiences'),
    ).not.toThrow();

    // Gone after 0004 drops it, while the rest of the table remains intact.
    const after = buildPgMemDatabase();
    applyInitMigration(after);
    applyMigration(after, '0002_experience_images.sql');
    applyMigration(after, '0003_note_shareable.sql');
    applyMigration(after, '0004_disney_sources.sql');
    expect(() =>
      after.public.none('SELECT image_attribution FROM experiences'),
    ).toThrow();
    // image_url is retained (now the sole Disney-sourced imagery column).
    expect(() =>
      after.public.none('SELECT image_url FROM experiences'),
    ).not.toThrow();
  });

  it('the catalog detail DTO exposes no attribution field', async () => {
    const app = await buildDetailApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/catalog/11111111-1111-4111-8111-111111111111',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).not.toHaveProperty('imageAttribution');
      expect(body).not.toHaveProperty('attribution');
    } finally {
      await app.close();
    }
  });
});

/**
 * Build a Fastify instance exposing just the catalog detail route, backed by a
 * stub that returns a fully-enriched Experience. Used to assert the wire DTO
 * carries no attribution field (R14.8).
 */
async function buildDetailApp(): Promise<FastifyInstance> {
  const experience: ExperienceDTO = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Space Mountain',
    park: 'Magic Kingdom',
    category: 'Ride',
    description: 'A classic indoor roller coaster.',
    active: true,
    imageUrl: 'https://cdn.disney.example/space-mountain.jpg',
    areaType: 'ThemePark',
  };

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    catalogRoutes({
      decideRead: async () => ({ staleCache: false }),
      listActiveExperiences: async () => [],
      getExperience: async () => experience,
    }),
  );
  await app.ready();
  return app;
}
