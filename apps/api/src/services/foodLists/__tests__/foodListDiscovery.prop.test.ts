/**
 * Property tests for Food List Discovery repository (Feature: food-lists).
 *
 * Validates:
 *   - Property 8 — Discovery Feed Sort and Scope (popular and recent keyset pagination, public-only scope, full coverage)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import {
  createFoodListRepo,
  type FoodListRepo,
} from '../repo.js';

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

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

function withForUpdateCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  const strip = (t: string): string => t.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return raw.query(strip(text), params);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          return client.query(strip(text), params);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;
}

describe('foodListDiscovery repository properties (fast-check)', () => {
  let db: IMemoryDb;
  let rawPool: DbPool;
  let pool: DbPool;
  let foodListRepo: FoodListRepo;
  let ownerId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0041_food_lists.sql');
    applyMigration(db, '0047_food_list_checklist.sql');

    const { Pool: PgMemPool } = db.adapters.createPg();
    rawPool = new PgMemPool() as unknown as DbPool;
    pool = withForUpdateCompat(rawPool);

    foodListRepo = createFoodListRepo(pool);

    ownerId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'owner@test.com', 'hash')`,
      [ownerId],
    );
  });

  // Feature: food-lists, Property 8: Discovery Feed Sort and Scope
  it('Property 8: Discovery Feed Sort and Scope (popular sort)', async () => {
    const nameArb = fc.stringMatching(/^[A-Za-z0-9 _-]{1,30}$/).filter((s) => s.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: nameArb,
            visibility: fc.constantFrom<'public' | 'private'>('public', 'private'),
            likeCount: fc.integer({ min: 0, max: 20 }),
          }),
          { minLength: 5, maxLength: 15 },
        ),
        fc.integer({ min: 2, max: 5 }), // small page size to test multi-page pagination
        async (listSpecs, pageSize) => {
          const publicIds = new Set<string>();

          for (const spec of listSpecs) {
            const listId = randomUUID();
            await pool.query(
              `INSERT INTO food_lists (id, owner_id, name, visibility, like_count)
               VALUES ($1, $2, $3, $4, $5)`,
              [listId, ownerId, spec.name.trim() || 'List', spec.visibility, spec.likeCount],
            );
            if (spec.visibility === 'public') {
              publicIds.add(listId);
            }
          }

          // Paginate through all pages
          const collectedIds: string[] = [];
          let cursor: string | null = null;
          let pages = 0;

          do {
            const page = await foodListRepo.discover('popular', cursor, pageSize);
            pages++;
            if (pages > 20) {
              throw new Error('Infinite loop in pagination');
            }

            for (const item of page.items) {
              expect(item.visibility).toBe('public');
              collectedIds.push(item.id);
            }

            // Verify order within the page
            for (let i = 0; i < page.items.length - 1; i++) {
              const a = page.items[i]!;
              const b = page.items[i + 1]!;
              const ordered =
                a.likeCount > b.likeCount || (a.likeCount === b.likeCount && a.id < b.id);
              expect(ordered).toBe(true);
            }

            cursor = page.nextCursor;
          } while (cursor !== null);

          // Verify overall ordering across pages
          expect(new Set(collectedIds).size).toBe(collectedIds.length); // No duplicates
          expect(new Set(collectedIds)).toEqual(publicIds); // Exactly the public lists, no omissions

          await pool.query(`DELETE FROM food_lists WHERE owner_id = $1`, [ownerId]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: food-lists, Property 8: Discovery Feed Sort and Scope (recent sort)
  it('Property 8: Discovery Feed Sort and Scope (recent sort)', async () => {
    const nameArb = fc.stringMatching(/^[A-Za-z0-9 _-]{1,30}$/).filter((s) => s.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: nameArb,
            visibility: fc.constantFrom<'public' | 'private'>('public', 'private'),
            offsetSeconds: fc.integer({ min: 0, max: 1000 }),
          }),
          { minLength: 5, maxLength: 15 },
        ),
        fc.integer({ min: 2, max: 5 }),
        async (listSpecs, pageSize) => {
          const publicIds = new Set<string>();
          const baseDate = new Date('2026-06-01T12:00:00Z').getTime();

          for (let i = 0; i < listSpecs.length; i++) {
            const spec = listSpecs[i]!;
            const listId = randomUUID();
            const createdAt = new Date(baseDate + spec.offsetSeconds * 1000);
            await pool.query(
              `INSERT INTO food_lists (id, owner_id, name, visibility, created_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [listId, ownerId, spec.name.trim() || 'List', spec.visibility, createdAt],
            );
            if (spec.visibility === 'public') {
              publicIds.add(listId);
            }
          }

          const collectedIds: string[] = [];
          let cursor: string | null = null;
          let pages = 0;

          do {
            const page = await foodListRepo.discover('recent', cursor, pageSize);
            pages++;
            if (pages > 20) {
              throw new Error('Infinite loop in pagination');
            }

            for (const item of page.items) {
              expect(item.visibility).toBe('public');
              collectedIds.push(item.id);
            }

            for (let i = 0; i < page.items.length - 1; i++) {
              const a = page.items[i]!;
              const b = page.items[i + 1]!;
              const ordered =
                a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
              expect(ordered).toBe(true);
            }

            cursor = page.nextCursor;
          } while (cursor !== null);

          expect(new Set(collectedIds).size).toBe(collectedIds.length);
          expect(new Set(collectedIds)).toEqual(publicIds);

          await pool.query(`DELETE FROM food_lists WHERE owner_id = $1`, [ownerId]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
