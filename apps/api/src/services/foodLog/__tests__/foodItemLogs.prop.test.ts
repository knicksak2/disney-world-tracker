/**
 * Property tests for Food_Item_Log repository (Feature: food-item-logging).
 *
 * Validates:
 *   - Property 3: Food Item Log Independence from Completions/Ratings (R3.5)
 *   - Property 4: Food Log History Ordering and Repeat Count (R4.1, R4.2)
 *   - Property 5: No Future Visit Date (R3.3)
 *   - Property 9: Food Item Scope Exclusivity (R6.5, R6.6)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import {
  createFoodItemLogRepo,
  createFoodItemRepo,
  type FoodItemLogRepo,
  type FoodItemRepo,
} from '../repo.js';

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
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

const fixedNow = new Date('2026-06-15T12:00:00Z');
const todayYmd = '2026-06-15';

describe('FoodItemLogRepo Property Tests', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let foodRepo: FoodItemRepo;
  let logRepo: FoodItemLogRepo;
  let userId: string;
  let expId: string;
  let foodItemId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');

    // experience_logs table from 0034
    db.public.none(`
      CREATE TABLE IF NOT EXISTS experience_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        experience_id UUID NOT NULL REFERENCES experiences(id),
        visited_on DATE NOT NULL,
        user_tz TEXT NOT NULL,
        logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        rating SMALLINT,
        note TEXT
      );
    `);

    foodRepo = createFoodItemRepo(pool);
    logRepo = createFoodItemLogRepo({ pool, clock: () => fixedNow });

    userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'eater@example.com', 'hash')`,
      [userId],
    );

    expId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Be Our Guest', 'Restaurant', 'Magic Kingdom', 'upstream-bog')`,
      [expId],
    );

    foodItemId = randomUUID();
    await pool.query(
      `INSERT INTO food_items (id, experience_id, name, source)
       VALUES ($1, $2, 'Grey Stuff', 'menu_sync')`,
      [foodItemId, expId],
    );
  });

  // Feature: food-item-logging, Property 3: Food Item Log Independence from Completions/Ratings
  it('Property 3: Inserting a Food_Item_Log never touches completions, ratings, or experience_logs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
          note: fc.option(
            fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('\\') && !s.includes('\0')),
            { nil: null },
          ),
        }),
        async ({ rating, note }) => {
          const compBefore = await pool.query(`SELECT count(*)::int as n FROM completions`);
          const ratBefore = await pool.query(`SELECT count(*)::int as n FROM ratings`);
          const expLogBefore = await pool.query(`SELECT count(*)::int as n FROM experience_logs`);

          await logRepo.addLog({
            userId,
            foodItemId,
            visitedOn: '2026-06-10',
            userTz: 'America/New_York',
            rating,
            note,
          });

          const compAfter = await pool.query(`SELECT count(*)::int as n FROM completions`);
          const ratAfter = await pool.query(`SELECT count(*)::int as n FROM ratings`);
          const expLogAfter = await pool.query(`SELECT count(*)::int as n FROM experience_logs`);

          expect(compAfter.rows[0]?.['n']).toBe(compBefore.rows[0]?.['n']);
          expect(ratAfter.rows[0]?.['n']).toBe(ratBefore.rows[0]?.['n']);
          expect(expLogAfter.rows[0]?.['n']).toBe(expLogBefore.rows[0]?.['n']);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: food-item-logging, Property 4: Food Log History Ordering and Repeat Count
  it('Property 4: History returns repeatCount === logs.length and sorted visitedOn DESC, loggedAt DESC', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 14 }),
            rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        async (entries) => {
          const item = randomUUID();
          await pool.query(
            `INSERT INTO food_items (id, experience_id, name, source)
             VALUES ($1, $2, $3, 'menu_sync')`,
            [item, expId, `Dish-${item.slice(0, 8)}`],
          );

          for (const entry of entries) {
            const dayStr = String(entry.day).padStart(2, '0');
            await logRepo.addLog({
              userId,
              foodItemId: item,
              visitedOn: `2026-06-${dayStr}`,
              userTz: 'America/New_York',
              rating: entry.rating,
            });
          }

          const history = await logRepo.getLogHistory(userId, item);
          expect(history.repeatCount).toBe(entries.length);
          expect(history.logs).toHaveLength(entries.length);

          for (let i = 0; i < history.logs.length - 1; i++) {
            const curr = history.logs[i]!;
            const next = history.logs[i + 1]!;
            if (curr.visitedOn === next.visitedOn) {
              expect(new Date(curr.loggedAt).getTime()).toBeGreaterThanOrEqual(
                new Date(next.loggedAt).getTime(),
              );
            } else {
              expect(curr.visitedOn >= next.visitedOn).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: food-item-logging, Property 5: No Future Visit Date
  it('Property 5: Dates strictly later than today in userTz are rejected with food_log_future_date', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -30, max: 30 }),
        async (offsetDays) => {
          // Calculate offset date relative to 2026-06-15
          const target = new Date(fixedNow.getTime() + offsetDays * 86_400_000);
          const yyyy = target.getUTCFullYear();
          const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(target.getUTCDate()).padStart(2, '0');
          const visitedOn = `${yyyy}-${mm}-${dd}`;

          const countBefore = await pool.query(
            `SELECT count(*)::int as n FROM food_item_logs WHERE food_item_id = $1`,
            [foodItemId],
          );

          if (visitedOn > todayYmd) {
            await expect(
              logRepo.addLog({
                userId,
                foodItemId,
                visitedOn,
                userTz: 'America/New_York',
              }),
            ).rejects.toThrowError(AppError);

            try {
              await logRepo.addLog({
                userId,
                foodItemId,
                visitedOn,
                userTz: 'America/New_York',
              });
            } catch (err) {
              expect((err as AppError).code).toBe('food_log_future_date');
            }

            const countAfter = await pool.query(
              `SELECT count(*)::int as n FROM food_item_logs WHERE food_item_id = $1`,
              [foodItemId],
            );
            expect(countAfter.rows[0]?.['n']).toBe(countBefore.rows[0]?.['n']);
          } else {
            await expect(
              logRepo.addLog({
                userId,
                foodItemId,
                visitedOn,
                userTz: 'America/New_York',
              }),
            ).resolves.toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: food-item-logging, Property 9: Food Item Scope Exclusivity
  it('Property 9: Creation and logging require exactly one valid scope, and same names in different scopes do not collide', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[A-Za-z0-9]{3,20}$/),
        async (dishName) => {
          const locId = randomUUID();
          await pool.query(
            `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
             VALUES ($1, $2, 'Magic Kingdom', $3)`,
            [locId, `Cart-${locId.slice(0, 8)}`, userId],
          );

          const iterationExpId = randomUUID();
          await pool.query(
            `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
             VALUES ($1, 'Test Restaurant', 'Restaurant', 'Magic Kingdom', $2)`,
            [iterationExpId, `upstream-${iterationExpId}`],
          );

          // 1. Neither scope supplied -> validation_failed
          await expect(
            foodRepo.submitScopedFoodItem({
              experienceId: null,
              locationId: null,
              userId,
              name: dishName,
            }),
          ).rejects.toThrowError(AppError);

          // 2. Both scopes supplied -> validation_failed
          await expect(
            foodRepo.submitScopedFoodItem({
              experienceId: iterationExpId,
              locationId: locId,
              userId,
              name: dishName,
            }),
          ).rejects.toThrowError(AppError);

          // 3. Invalid / non-existent id -> validation_failed
          await expect(
            foodRepo.submitScopedFoodItem({
              experienceId: randomUUID(),
              locationId: null,
              userId,
              name: dishName,
            }),
          ).rejects.toThrowError(AppError);

          await expect(
            foodRepo.submitScopedFoodItem({
              experienceId: null,
              locationId: randomUUID(),
              userId,
              name: dishName,
            }),
          ).rejects.toThrowError(AppError);

          // 4. Same name in experience vs location scope do NOT collide
          const expItem = await foodRepo.submitScopedFoodItem({
            experienceId: iterationExpId,
            locationId: null,
            userId,
            name: dishName,
          });

          const locItem = await foodRepo.submitScopedFoodItem({
            experienceId: null,
            locationId: locId,
            userId,
            name: dishName,
          });

          expect(expItem.id).not.toBe(locItem.id);
          expect(expItem.experienceId).toBe(iterationExpId);
          expect(expItem.locationId).toBeNull();
          expect(locItem.experienceId).toBeNull();
          expect(locItem.locationId).toBe(locId);

          // 5. Logging against missing item throws food_item_not_found
          await expect(
            logRepo.addLog({
              userId,
              foodItemId: randomUUID(),
              visitedOn: '2026-06-10',
              userTz: 'America/New_York',
            }),
          ).rejects.toThrowError(AppError);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('updateLog updates rating and note on an existing log in pg-mem', async () => {
    const created = await logRepo.addLog({
      userId,
      foodItemId,
      visitedOn: '2026-06-10',
      userTz: 'America/New_York',
      rating: null,
      note: 'First taste',
    });

    expect(created.rating).toBeNull();
    expect(created.note).toBe('First taste');

    // Update rating
    const updatedRating = await logRepo.updateLog({
      userId,
      foodItemId,
      logId: created.id,
      rating: 9,
    });

    expect(updatedRating.rating).toBe(9);
    expect(updatedRating.note).toBe('First taste');

    // Update note and clear rating
    const updatedNote = await logRepo.updateLog({
      userId,
      foodItemId,
      logId: created.id,
      rating: null,
      note: 'Updated review text',
    });

    expect(updatedNote.rating).toBeNull();
    expect(updatedNote.note).toBe('Updated review text');

    // Other user cannot update log
    await expect(
      logRepo.updateLog({
        userId: randomUUID(),
        foodItemId,
        logId: created.id,
        rating: 10,
      }),
    ).rejects.toThrowError(AppError);
  });
});
