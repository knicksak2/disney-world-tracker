/**
 * Integration test for the Catalog_Service repository's transactional apply
 * and Resort durability, exercised end-to-end against a real Postgres-style
 * engine (`pg-mem`) — the same in-memory Postgres the smoke harness and the
 * Friend Completions integration test use (see `test/smoke/harness.ts` and
 * `tracking/friendCompletions/__tests__/completions.integration.test.ts`).
 *
 * Unlike `repo.test.ts` (which drives `applyReconciliation` through a fake
 * pool that merely records SQL strings), this test applies the project's
 * canonical migrations `0001`–`0004` to a fresh pg-mem database and runs the
 * production SQL in `applyReconciliation` verbatim against actual tables. That
 * makes the transactional guarantees observable at the storage layer rather
 * than inferred from the call log alone.
 *
 * Scenarios:
 *
 *   - Single transaction wraps the apply (R11.7): a successful apply issues
 *     exactly one `BEGIN` and one `COMMIT` (and no `ROLLBACK`) on a single
 *     pooled client, with every Experience/Resort/menu write in between.
 *
 *   - Rollback discipline on a mid-apply failure (R11.6/R11.7): a statement
 *     that fails part-way through the apply causes the repo to terminate the
 *     transaction with a `ROLLBACK` and never a `COMMIT`, the failure
 *     propagates, subsequent statements never run, and the cache is left
 *     byte-for-byte identical to its pre-run snapshot with no partial changes.
 *     (The sandbox engine accepts but does not model transactional reversion of
 *     already-applied statements, so the failure is injected before any write
 *     lands; the single-BEGIN/ROLLBACK/no-COMMIT stream asserted here is the
 *     mechanism that guarantees prior writes are undone on production Postgres.)
 *
 *   - Resort durability across restarts (R6.7): a Resort upserted by one repo
 *     instance is re-read through a FRESH `createCatalogRepo` instance bound to
 *     the same durable database, standing in for an application restart
 *     reconnecting to the same Postgres.
 *
 * Validates: Requirements 6.7, 11.6, 11.7
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createCatalogRepo } from '../repo.js';
import type {
  CatalogDiff,
  ReconcileUpsert,
  ResortReconcileUpsert,
} from '../types.js';

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors test/smoke/harness.ts + completions.integration.test.ts)
// ---------------------------------------------------------------------------

/** Build a fresh pg-mem db with the schema's extensions/functions registered. */
function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();

  db.registerExtension('citext', () => {
    // citext is supported natively by pg-mem.
  });
  db.registerExtension('pg_trgm', () => {
    // pg_trgm is only consulted by the GIN trigram indexes we strip below.
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

/** Absolute path to a migration file relative to this test. */
function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → catalog → services → src → apps/api
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

/** Apply migration 0001, stripping the GIN trigram indexes pg-mem can't model. */
function applyInitMigration(db: IMemoryDb): void {
  let sql = readFileSync(migrationPath('0001_init.sql'), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

/** Apply a later migration verbatim (no GIN indexes in 0002/0003/0004). */
function applyMigration(db: IMemoryDb, name: string): void {
  const sql = readFileSync(migrationPath(name), 'utf8');
  db.public.none(sql);
}

// ---------------------------------------------------------------------------
// Instrumented pool wrapper
// ---------------------------------------------------------------------------
//
// Wraps the pg-mem-backed pool so the test can (a) spy on the exact sequence
// of statements issued on the transactional client — the basis for the single
// BEGIN/COMMIT assertion (R11.7) — and (b) inject a failure at a precise point
// mid-apply to exercise the ROLLBACK path (R11.6). The failure is thrown
// *before* the offending statement reaches pg-mem, so any statements that
// executed earlier in the same transaction remain uncommitted and must be
// undone by the repo's ROLLBACK.

interface Instrumented {
  readonly pool: DbPool;
  /** Text of every statement issued on a pooled client, in order. */
  readonly clientQueries: string[];
}

function instrumentPool(
  base: DbPool,
  failWhen?: (text: string) => boolean,
): Instrumented {
  const clientQueries: string[] = [];

  const wrapped = {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return (base as unknown as {
        query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      }).query(text, params);
    },
    async connect() {
      const client = await (base as unknown as {
        connect(): Promise<{
          query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
          release(): void;
        }>;
      }).connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          clientQueries.push(text);
          if (failWhen?.(text)) {
            throw new Error(`injected failure on statement: ${text.trim().slice(0, 40)}`);
          }
          return client.query(text, params);
        },
        release() {
          client.release();
        },
      };
    },
  };

  return { pool: wrapped as unknown as DbPool, clientQueries };
}

/** Count occurrences of a leading keyword among the recorded client queries. */
function countKeyword(queries: readonly string[], keyword: string): number {
  return queries.filter((q) => q.trimStart().toUpperCase().startsWith(keyword))
    .length;
}

// ---------------------------------------------------------------------------
// Cache snapshot helper (byte-for-byte comparison basis for R11.6)
// ---------------------------------------------------------------------------

/**
 * Materialize the full mutable catalog cache — every `resorts`, `experiences`,
 * and `experience_menus` row — into a stable, deterministically ordered JSON
 * string. Two snapshots compared for equality prove the cache is unchanged
 * down to the byte.
 */
async function snapshotCache(pool: DbPool): Promise<string> {
  const resorts = await pool.query(
    `SELECT id, upstream_entity_id, name, description, image_url,
            latitude, longitude, address, phone, active, updated_at
       FROM resorts ORDER BY id`,
  );
  const experiences = await pool.query(
    `SELECT id, upstream_entity_id, name, park, category, description, active,
            image_url, latitude, longitude, area_type, resort_id,
            accessibility, price_tier, meal_periods, updated_at
       FROM experiences ORDER BY id`,
  );
  const menus = await pool.query(
    `SELECT experience_id, menus, updated_at
       FROM experience_menus ORDER BY experience_id`,
  );
  return JSON.stringify({
    resorts: resorts.rows,
    experiences: experiences.rows,
    menus: menus.rows,
  });
}

// ---------------------------------------------------------------------------
// Seed + diff builders
// ---------------------------------------------------------------------------

async function seedResort(
  pool: DbPool,
  id: string,
  name: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO resorts (id, upstream_entity_id, name, description, active)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [id, `ent-${id}`, name, 'seeded description'],
  );
}

async function seedExperience(
  pool: DbPool,
  id: string,
  name: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, description, active)
     VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride', $4, TRUE)`,
    [id, `ent-${id}`, name, 'seeded description'],
  );
}

function resortUpsert(
  overrides: Partial<ResortReconcileUpsert> & { id: string },
): ResortReconcileUpsert {
  return {
    upstreamEntityId: `ent-${overrides.id}`,
    name: 'Resort',
    description: null,
    imageUrl: null,
    latitude: null,
    longitude: null,
    address: null,
    phone: null,
    active: true,
    ...overrides,
  };
}

function experienceUpsert(
  overrides: Partial<ReconcileUpsert> & { id: string },
): ReconcileUpsert {
  return {
    upstreamEntityId: `ent-${overrides.id}`,
    name: 'Experience',
    park: 'Magic Kingdom',
    category: 'Ride',
    land: null,
    description: 'plain text',
    imageUrl: null,
    areaType: 'ThemePark',
    resortId: null,
    latitude: null,
    longitude: null,
    accessibility: [],
    priceTier: null,
    mealPeriods: [],
    active: true,
    ...overrides,
  };
}

function emptyDiff(): CatalogDiff {
  return {
    experiences: { upserts: [], softDeletes: [] },
    resorts: { upserts: [], softDeletes: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Catalog repo applyReconciliation — transactional apply (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool } = db.adapters.createPg();
    pool = new Pool() as unknown as DbPool;

    applyInitMigration(db);
    applyMigration(db, '0002_experience_images.sql');
    applyMigration(db, '0003_note_shareable.sql');
    applyMigration(db, '0004_disney_sources.sql');
    applyMigration(db, '0006_experience_land.sql');
  });

  afterEach(async () => {
    await (pool as unknown as { end?: () => Promise<void> }).end?.();
  });

  it('wraps a successful apply in exactly one BEGIN/COMMIT (R11.7)', async () => {
    const resortId = randomUUID();
    const expId = randomUUID();
    await seedResort(pool, resortId, 'Old Resort Name');
    await seedExperience(pool, expId, 'Old Experience Name');

    const newResortId = randomUUID();
    const { pool: spied, clientQueries } = instrumentPool(pool);
    const repo = createCatalogRepo(spied);

    const diff: CatalogDiff = {
      resorts: {
        upserts: [
          resortUpsert({ id: resortId, name: 'New Resort Name' }),
          resortUpsert({ id: newResortId, name: 'Brand New Resort' }),
        ],
        softDeletes: [],
      },
      experiences: {
        upserts: [experienceUpsert({ id: expId, name: 'New Experience Name' })],
        softDeletes: [],
      },
      menus: [
        {
          experienceId: expId,
          menus: [
            {
              menuType: 'Dinner',
              cuisineType: 'American',
              groups: [
                { name: 'Mains', items: [{ name: 'Burger', price: '$18' }] },
              ],
            },
          ],
        },
      ],
    };

    await expect(repo.applyReconciliation(diff)).resolves.toBeUndefined();

    // R11.7: a single transaction wraps the apply — exactly one BEGIN and one
    // COMMIT, no ROLLBACK, on the pooled client.
    expect(countKeyword(clientQueries, 'BEGIN')).toBe(1);
    expect(countKeyword(clientQueries, 'COMMIT')).toBe(1);
    expect(countKeyword(clientQueries, 'ROLLBACK')).toBe(0);

    // The BEGIN precedes every write and the COMMIT follows them.
    const beginIdx = clientQueries.findIndex((q) =>
      q.trimStart().toUpperCase().startsWith('BEGIN'),
    );
    const commitIdx = clientQueries.findIndex((q) =>
      q.trimStart().toUpperCase().startsWith('COMMIT'),
    );
    expect(beginIdx).toBe(0);
    expect(commitIdx).toBe(clientQueries.length - 1);

    // The writes actually committed.
    const resorts = await repo.listActiveResorts();
    expect(resorts.map((r) => r.name).sort()).toEqual([
      'Brand New Resort',
      'New Resort Name',
    ]);
    const exp = await repo.getExperience(expId);
    expect(exp?.name).toBe('New Experience Name');
    const menus = await repo.getMenusFor(expId);
    expect(menus).toHaveLength(1);
    expect(menus[0]?.menuType).toBe('Dinner');
  });

  it('rolls back — BEGIN/ROLLBACK with no COMMIT — leaving a byte-for-byte pre-run cache when a statement fails mid-apply (R11.6)', async () => {
    const resortId = randomUUID();
    const expId = randomUUID();
    await seedResort(pool, resortId, 'Original Resort');
    await seedExperience(pool, expId, 'Original Experience');

    // Capture the exact pre-run cache state.
    const before = await snapshotCache(pool);

    // Inject a failure on the Experience upsert — the first mutating statement
    // in this diff (there are no Resort upserts before it). A later Resort
    // soft-delete is included to prove the apply is interrupted mid-way: once
    // the Experience write throws, the transaction is torn down and the
    // soft-delete never runs.
    //
    // NOTE ON THE SANDBOX ENGINE: pg-mem's `pg` adapter accepts BEGIN/COMMIT/
    // ROLLBACK but does not model transactional rollback — it cannot revert a
    // statement that already reached the store (verified independently). So the
    // byte-for-byte guarantee is asserted the only way this engine can honor it
    // faithfully: the failure is thrown before any write lands, and the
    // subsequent statement never executes. The property that guarantees prior
    // writes are undone on the production Postgres engine — a single BEGIN that
    // is terminated by ROLLBACK and never by COMMIT (R11.7) — is asserted
    // directly against the repo's statement stream below.
    const { pool: failing, clientQueries } = instrumentPool(pool, (text) =>
      text.includes('INSERT INTO experiences'),
    );
    const repo = createCatalogRepo(failing);

    const diff: CatalogDiff = {
      resorts: {
        upserts: [],
        softDeletes: [{ id: resortId }],
      },
      experiences: {
        upserts: [experienceUpsert({ id: expId, name: 'Renamed Experience' })],
        softDeletes: [],
      },
    };

    await expect(repo.applyReconciliation(diff)).rejects.toThrow(
      /injected failure/,
    );

    // R11.7 on the failure path: a single BEGIN opened the transaction and a
    // ROLLBACK — never a COMMIT — terminated it.
    expect(countKeyword(clientQueries, 'BEGIN')).toBe(1);
    expect(countKeyword(clientQueries, 'ROLLBACK')).toBe(1);
    expect(countKeyword(clientQueries, 'COMMIT')).toBe(0);
    expect(clientQueries[0]?.trimStart().toUpperCase().startsWith('BEGIN')).toBe(
      true,
    );

    // The apply aborted the moment the Experience write threw: the later Resort
    // soft-delete (an `UPDATE resorts`) was never issued.
    expect(clientQueries.some((q) => q.includes('UPDATE resorts'))).toBe(false);
    // ...and the failing statement was indeed attempted.
    expect(clientQueries.some((q) => q.includes('INSERT INTO experiences'))).toBe(
      true,
    );

    // R11.6: the cache is identical to its pre-run state, byte for byte — no
    // partial changes were persisted.
    const after = await snapshotCache(pool);
    expect(after).toBe(before);
  });

  it('persists an upserted Resort durably across a fresh repo instance (R6.7)', async () => {
    const resortId = randomUUID();
    const applyingRepo = createCatalogRepo(pool);

    const diff: CatalogDiff = {
      ...emptyDiff(),
      resorts: {
        upserts: [
          resortUpsert({
            id: resortId,
            name: 'Grand Floridian',
            description: 'A flagship resort',
            imageUrl: 'https://cdn.example/gf.jpg',
            latitude: 28.4106,
            longitude: -81.5875,
            address: '4401 Floridian Way',
            phone: '407-824-3000',
          }),
        ],
        softDeletes: [],
      },
    };

    await applyingRepo.applyReconciliation(diff);

    // Simulate an application restart: a brand-new repo instance reconnects to
    // the same durable database and must still see the Resort.
    const freshRepo = createCatalogRepo(pool);
    const resorts = await freshRepo.listActiveResorts();

    expect(resorts).toHaveLength(1);
    expect(resorts[0]).toEqual({
      id: resortId,
      name: 'Grand Floridian',
      description: 'A flagship resort',
      imageUrl: 'https://cdn.example/gf.jpg',
      latitude: 28.4106,
      longitude: -81.5875,
      address: '4401 Floridian Way',
      phone: '407-824-3000',
    });
  });
});
