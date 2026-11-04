// Feature: unified-dining-logging, Property 5: Backfill Migration Completeness and Idempotence
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function buildPgMem(): { db: IMemoryDb; pool: DbPool; migration0071Sql: string } {
  const db = newDb({ noAstCoverageCheck: true });
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

  for (const name of [
    '0001_init.sql',
    '0015_trips.sql',
    '0034_experience_logs.sql',
    '0040_food_item_logging.sql',
  ]) {
    let sql = readFileSync(migrationPath(name), 'utf8');
    sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
    sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
    pub.none(sql);
  }

  const migration0071Sql = readFileSync(
    migrationPath('0071_backfill_restaurant_visits_from_food_logs.sql'),
    'utf8',
  );

  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as DbPool;
  return { db, pool, migration0071Sql };
}

describe('Feature: unified-dining-logging, Property 5: Migration 0071 Backfill Completeness & Idempotence', () => {
  it('backfills missing experience_logs and completions for catalog restaurant dish logs, leaves existing visits/ratings intact, and is idempotent', async () => {
    const { db, pool, migration0071Sql } = buildPgMem();

    const userId = randomUUID();
    const rest1Id = randomUUID();
    const rest2Id = randomUUID();
    const locId = randomUUID();
    const rest1DishA = randomUUID();
    const rest1DishB = randomUUID();
    const rest2Dish = randomUUID();
    const locDish = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'u@test.local', 'h')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ($1, 'up-r1', 'Aloha Isle', 'Magic Kingdom', 'Restaurant'),
              ($2, 'up-r2', 'Sanaa', 'EPCOT', 'Restaurant')`,
      [rest1Id, rest2Id],
    );
    await pool.query(
      `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
       VALUES ($1, 'Popcorn Cart', 'EPCOT', $2)`,
      [locId, userId],
    );
    await pool.query(
      `INSERT INTO food_items (id, experience_id, name, source)
       VALUES ($1, $4, 'Dole Whip', 'menu_sync'),
              ($2, $4, 'Pineapple Float', 'menu_sync'),
              ($3, $5, 'Bread Service', 'menu_sync')`,
      [rest1DishA, rest1DishB, rest2Dish, rest1Id, rest2Id],
    );
    await pool.query(
      `INSERT INTO food_items (id, location_id, name, source, created_by_user_id)
       VALUES ($1, $2, 'Maple Popcorn', 'user_submitted', $3)`,
      [locDish, locId, userId],
    );

    const backup = db.backup();

    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // whether rest2 already has an experience_log on 2026-11-02
        fc.integer({ min: 1, max: 3 }), // number of dishes logged at rest1 on 2026-11-01
        async (rest2AlreadyVisited, rest1DishCount) => {
          backup.restore();

          for (let i = 0; i < rest1DishCount; i++) {
            const itemId = i % 2 === 0 ? rest1DishA : rest1DishB;
            await pool.query(
              `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, rating, note)
               VALUES ($1, $2, '2026-11-01', 'America/New_York', 9, 'Tasty')`,
              [userId, itemId],
            );
          }

          await pool.query(
            `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, rating)
             VALUES ($1, $2, '2026-11-02', 'America/New_York', 10)`,
            [userId, rest2Dish],
          );

          // User-submitted location dish log (should never produce an experience_log)
          await pool.query(
            `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, rating)
             VALUES ($1, $2, '2026-11-03', 'America/New_York', 8)`,
            [userId, locDish],
          );

          if (rest2AlreadyVisited) {
            await pool.query(
              `INSERT INTO experience_logs (user_id, experience_id, visited_on, user_tz, rating, note)
               VALUES ($1, $2, '2026-11-02', 'America/New_York', 10, 'Amazing dinner')`,
              [userId, rest2Id],
            );
          }

          // Run migration 0071 once
          db.public.none(migration0071Sql);

          const expLogs1 = await pool.query<{
            experience_id: string;
            visited_on: Date | string;
            rating: number | null;
            note: string | null;
          }>(
            `SELECT experience_id, visited_on, rating, note
               FROM experience_logs
              WHERE user_id = $1
              ORDER BY visited_on ASC`,
            [userId],
          );
          expect(expLogs1.rows).toHaveLength(2);

          const r1Row = expLogs1.rows.find((r) => r.experience_id === rest1Id)!;
          expect(r1Row).toBeDefined();
          expect(r1Row.rating).toBeNull();
          expect(r1Row.note).toBeNull();

          const r2Row = expLogs1.rows.find((r) => r.experience_id === rest2Id)!;
          expect(r2Row).toBeDefined();
          if (rest2AlreadyVisited) {
            expect(r2Row.rating).toBe(10);
            expect(r2Row.note).toBe('Amazing dinner');
          } else {
            expect(r2Row.rating).toBeNull();
            expect(r2Row.note).toBeNull();
          }

          const comps1 = await pool.query<{ experience_id: string }>(
            `SELECT experience_id FROM completions WHERE user_id = $1`,
            [userId],
          );
          expect(comps1.rows.map((r) => r.experience_id).sort()).toEqual(
            [rest1Id, rest2Id].sort(),
          );

          // Run migration 0071 a second time: idempotent (zero new rows)
          db.public.none(migration0071Sql);

          const expLogs2 = await pool.query(
            `SELECT 1 FROM experience_logs WHERE user_id = $1`,
            [userId],
          );
          expect(expLogs2.rows).toHaveLength(2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
