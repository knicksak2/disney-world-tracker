/**
 * Property-based test: Notes and private fields never appear in friend-facing payloads.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 6.1, Property 1
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeAll, describe, expect, it } from 'vitest';

import { FRIEND_FOOD_SORTS, type FriendFoodSort } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import {
  createFriendFoodRatingsRepo,
  type FriendFoodRatingsRepo,
} from '../repo.js';
import { friendFoodRatingRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// pg-mem setup
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
  pub.registerFunction({
    name: 'to_char',
    args: [DataType.date, DataType.text],
    returns: DataType.text,
    implementation: (d: unknown, _format: unknown): string => {
      if (d instanceof Date) return d.toISOString().split('T')[0]!;
      return String(d).split('T')[0]!;
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

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('friendFoodRatings.notes.prop — Property 1', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: FriendFoodRatingsRepo;
  let app: FastifyInstance;
  let currentUserId: string;

  beforeAll(async () => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    // The visibility views (0064) read profiles.avatar_preset, friendships and trip_memberships.
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0064_account_deletion.sql');
    db.public.none('ALTER TABLE experiences ALTER COLUMN park DROP NOT NULL');


    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;
    repo = createFriendFoodRatingsRepo(pool);

    app = Fastify({ logger: false });
    registerErrorHandler(app);

    const requireSession = async (request: { userId?: string }) => {
      request.userId = currentUserId;
    };

    await app.register(
      friendFoodRatingRoutes({
        repo,
        pool,
        requireSession,
      }),
    );
    await app.ready();
  });

  // Feature: friend-food-ratings, Property 1: Notes and private fields never appear in any friend-facing payload
  it('Property 1: serialized response never contains sentinel note, private fields or log timestamps in cursor', async () => {
    const targetUserId = randomUUID();
    const friendUserId = randomUUID();

    // Setup base users and friendship
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'target@test.com', 'hash'),
              ($2, 'friend@test.com', 'hash')`,
      [targetUserId, friendUserId],
    );

    const { lo, hi } = canonicalPair(targetUserId, friendUserId);
    await pool.query(
      `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`,
      [lo, hi],
    );

    const experienceId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, park, category, upstream_entity_id)
       VALUES ($1, 'Test Restaurant', 'Magic Kingdom', 'Restaurant', 'test-dining-1')`,
      [experienceId],
    );

    // Generator for dishes and logs with sentinels
    const dishWithLogsArb = fc.record({
      dishName: fc
        .stringMatching(/^[A-Za-z0-9 ]{2,20}$/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2),
      logs: fc.array(
        fc.record({
          rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
          visitedOn: fc
            .date({ min: new Date('2020-01-01'), max: new Date('2026-12-31') })
            .map((d) => d.toISOString().split('T')[0]!),
          loggedAt: fc
            .date({ min: new Date('2020-01-01'), max: new Date('2026-12-31') })
            .map((d) => d.toISOString()),
          userTz: fc.constantFrom('America/New_York', 'UTC', 'America/Los_Angeles'),
          sentinel: fc.uuid().map((u) => `CONFIDENTIAL_SENTINEL_NOTE_${u}`),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(dishWithLogsArb, { minLength: 1, maxLength: 4 }),
        fc.constantFrom(...FRIEND_FOOD_SORTS),
        fc.constantFrom('owner', 'friend'),
        async (dishes, sort, viewerRole) => {
          // Clean previous test data
          await pool.query('DELETE FROM food_item_logs');
          await pool.query('DELETE FROM food_items');

          const allSentinels: string[] = [];
          const allLoggedAts: string[] = [];

          for (let dishIdx = 0; dishIdx < dishes.length; dishIdx++) {
            const dish = dishes[dishIdx]!;
            const foodItemId = randomUUID();
            const uniqueName = `Dish_${dishIdx}_${dish.dishName}`;
            await pool.query(
              `INSERT INTO food_items (id, experience_id, name, source)
               VALUES ($1, $2, $3, 'menu_sync')`,
              [foodItemId, experienceId, uniqueName],
            );

            for (const log of dish.logs) {
              allSentinels.push(log.sentinel);
              allLoggedAts.push(log.loggedAt);
              await pool.query(
                `INSERT INTO food_item_logs (id, user_id, food_item_id, visited_on, logged_at, user_tz, rating, note)
                 VALUES ($1, $2, $3, $4::date, $5::timestamptz, $6, $7, $8)`,
                [
                  randomUUID(),
                  targetUserId,
                  foodItemId,
                  log.visitedOn,
                  log.loggedAt,
                  log.userTz,
                  log.rating,
                  log.sentinel,
                ],
              );
            }
          }

          currentUserId = viewerRole === 'owner' ? targetUserId : friendUserId;

          // Request small limit to test pagination cursor
          const res = await app.inject({
            method: 'GET',
            url: `/users/${targetUserId}/food-ratings?sort=${sort}&limit=2`,
          });

          expect(res.statusCode).toBe(200);
          const rawBody = res.body;

          // 1. None of the secret sentinel strings ever appear anywhere in the serialized payload
          for (const sentinel of allSentinels) {
            expect(rawBody.includes(sentinel)).toBe(false);
          }

          // 2. Parsed response inspection: no forbidden keys
          const json = res.json() as {
            items: Array<Record<string, unknown>>;
            nextCursor: string | null;
            scopes: unknown;
          };

          for (const item of json.items) {
            expect('note' in item).toBe(false);
            expect('id' in item).toBe(false);
            expect('userTz' in item).toBe(false);
            expect('user_tz' in item).toBe(false);
            expect('loggedAt' in item).toBe(false);
            expect('logged_at' in item).toBe(false);
          }

          // 3. Cursor inspection: base64-decoded JSON contains no timestamp or logged_at
          if (json.nextCursor !== null) {
            const decodedStr = Buffer.from(json.nextCursor, 'base64').toString('utf8');
            const cursor = JSON.parse(decodedStr) as {
              v: number;
              s: FriendFoodSort;
              a: string;
              b: string | null;
              id: string;
            };

            // Holds no ISO date-time
            expect(cursor.a).not.toMatch(/T\d\d:\d\d/);
            if (cursor.b !== null) {
              expect(cursor.b).not.toMatch(/T\d\d:\d\d/);
            }

            // Holds no generated logged_at timestamp
            for (const loggedAt of allLoggedAts) {
              expect(cursor.a).not.toBe(loggedAt);
              if (cursor.b !== null) {
                expect(cursor.b).not.toBe(loggedAt);
              }
            }

            // Any date in cursor must be among the returned latestVisitedOn dates
            const returnedDates = json.items.map((i) => i.latestVisitedOn as string);
            if (sort === 'recent') {
              expect(cursor.b).toBeNull();
              expect(returnedDates).toContain(cursor.a);
            } else if (sort === 'most_logged') {
              if (cursor.b !== null && /^\d{4}-\d{2}-\d{2}$/.test(cursor.b)) {
                expect(returnedDates).toContain(cursor.b);
              }
            }
          }

          // Phase 2: Batch social proof endpoint also carries no sentinel note text or private fields
          if (viewerRole === 'friend') {
            const batchRes = await app.inject({
              method: 'GET',
              url: `/experiences/${experienceId}/food-item-logs/friends`,
            });
            expect(batchRes.statusCode).toBe(200);
            const batchRawBody = batchRes.body;
            for (const sentinel of allSentinels) {
              expect(batchRawBody.includes(sentinel)).toBe(false);
            }
            const batchJson = batchRes.json() as {
              items: Array<{
                foodItemId: string;
                friendCount: number;
                friendsAverageRating: number;
                friends: Array<Record<string, unknown>>;
              }>;
            };
            for (const item of batchJson.items) {
              expect('note' in item).toBe(false);
              for (const friend of item.friends) {
                expect('note' in friend).toBe(false);
                expect('userTz' in friend).toBe(false);
                expect('user_tz' in friend).toBe(false);
                expect('loggedAt' in friend).toBe(false);
                expect('logged_at' in friend).toBe(false);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
