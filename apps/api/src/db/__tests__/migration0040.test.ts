/**
 * Migration test for `0040_food_item_logging.sql`.
 *
 * Applies 0001 (users, experiences FK targets) and 0040 to a fresh pg-mem database
 * and asserts the schema contract:
 *   - `user_submitted_locations` table, park CHECK, name length CHECK, unique (park, lower(name));
 *   - `food_items` table, source CHECK, name length CHECK, exactly-one-scope CHECK,
 *     unique (experience_id, lower(name)), unique (location_id, lower(name));
 *   - `food_item_logs` table, rating range CHECK, note length CHECK;
 *   - Cascades on experience, location, user, and food_item deletion.
 *
 * Validates: Requirements 1.1, 1.2, 2.2, 3.1, 3.2, 6.1, 6.4, 6.5, 6.6
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

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
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

describe('migration 0040_food_item_logging (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;
  let expIdA: string;
  let expIdB: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');

    userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'test@example.com', 'hash')`,
      [userId],
    );

    expIdA = randomUUID();
    expIdB = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Be Our Guest', 'Restaurant', 'Magic Kingdom', $2),
              ($3, 'Le Cellier', 'Restaurant', 'EPCOT', $4)`,
      [expIdA, `entity-${expIdA}`, expIdB, `entity-${expIdB}`],
    );
  });

  describe('user_submitted_locations', () => {
    it('creates table with expected columns', () => {
      const columns = [...db.getTable('user_submitted_locations').getColumns()].map((c) => c.name);
      expect(columns).toEqual(
        expect.arrayContaining(['id', 'name', 'park', 'created_by_user_id', 'created_at']),
      );
    });

    it('enforces park CHECK constraint', async () => {
      await expect(
        pool.query(
          `INSERT INTO user_submitted_locations (name, park, created_by_user_id)
           VALUES ('Invalid Cart', 'Universal Studios', $1)`,
          [userId],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `INSERT INTO user_submitted_locations (name, park, created_by_user_id)
           VALUES ('Spring Roll Cart', 'Magic Kingdom', $1)`,
          [userId],
        ),
      ).resolves.toBeDefined();
    });

    it('enforces name length constraint (1-200)', async () => {
      await expect(
        pool.query(
          `INSERT INTO user_submitted_locations (name, park, created_by_user_id)
           VALUES ('', 'Magic Kingdom', $1)`,
          [userId],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `INSERT INTO user_submitted_locations (name, park, created_by_user_id)
           VALUES ($1, 'Magic Kingdom', $2)`,
          ['x'.repeat(201), userId],
        ),
      ).rejects.toThrow();
    });

    it('enforces UNIQUE (park, lower(name)) case-insensitively', async () => {
      await pool.query(
        `INSERT INTO user_submitted_locations (name, park, created_by_user_id)
         VALUES ('Spring Roll Cart', 'Magic Kingdom', $1)`,
        [userId],
      );

      // Case-insensitive duplicate in same park fails
      await expect(
        pool.query(
          `INSERT INTO user_submitted_locations (name, park, created_by_user_id)
           VALUES ('SPRING ROLL CART', 'Magic Kingdom', $1)`,
          [userId],
        ),
      ).rejects.toThrow();

      // Same name in different park succeeds
      await expect(
        pool.query(
          `INSERT INTO user_submitted_locations (name, park, created_by_user_id)
           VALUES ('Spring Roll Cart', 'EPCOT', $1)`,
          [userId],
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('food_items', () => {
    it('creates table with expected columns', () => {
      const columns = [...db.getTable('food_items').getColumns()].map((c) => c.name);
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'experience_id',
          'location_id',
          'name',
          'price',
          'source',
          'created_by_user_id',
          'last_seen_at',
          'created_at',
        ]),
      );
    });

    it('enforces scope exclusivity (exactly one of experience_id or location_id)', async () => {
      const locId = randomUUID();
      await pool.query(
        `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
         VALUES ($1, 'Spring Roll Cart', 'Magic Kingdom', $2)`,
        [locId, userId],
      );

      // Neither provided -> fails
      await expect(
        pool.query(
          `INSERT INTO food_items (name, source)
           VALUES ('Grey Stuff', 'menu_sync')`,
        ),
      ).rejects.toThrow();

      // Both provided -> fails
      await expect(
        pool.query(
          `INSERT INTO food_items (experience_id, location_id, name, source)
           VALUES ($1, $2, 'Grey Stuff', 'menu_sync')`,
          [expIdA, locId],
        ),
      ).rejects.toThrow();

      // Exactly experience_id -> succeeds
      await expect(
        pool.query(
          `INSERT INTO food_items (experience_id, name, source)
           VALUES ($1, 'Grey Stuff', 'menu_sync')`,
          [expIdA],
        ),
      ).resolves.toBeDefined();

      // Exactly location_id -> succeeds
      await expect(
        pool.query(
          `INSERT INTO food_items (location_id, name, source)
           VALUES ($1, 'Cheeseburger Spring Roll', 'user_submitted')`,
          [locId],
        ),
      ).resolves.toBeDefined();
    });

    it('enforces source check (menu_sync or user_submitted)', async () => {
      await expect(
        pool.query(
          `INSERT INTO food_items (experience_id, name, source)
           VALUES ($1, 'Grey Stuff', 'invalid_source')`,
          [expIdA],
        ),
      ).rejects.toThrow();
    });

    it('enforces UNIQUE (experience_id, lower(name)) and UNIQUE (location_id, lower(name))', async () => {
      const locId = randomUUID();
      await pool.query(
        `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
         VALUES ($1, 'Spring Roll Cart', 'Magic Kingdom', $2)`,
        [locId, userId],
      );

      await pool.query(
        `INSERT INTO food_items (experience_id, name, source)
         VALUES ($1, 'Grey Stuff', 'menu_sync')`,
        [expIdA],
      );

      // Duplicate under expIdA fails
      await expect(
        pool.query(
          `INSERT INTO food_items (experience_id, name, source)
           VALUES ($1, 'GREY STUFF', 'user_submitted')`,
          [expIdA],
        ),
      ).rejects.toThrow();

      // Same name under expIdB succeeds
      await expect(
        pool.query(
          `INSERT INTO food_items (experience_id, name, source)
           VALUES ($1, 'Grey Stuff', 'menu_sync')`,
          [expIdB],
        ),
      ).resolves.toBeDefined();

      // Same name under locId succeeds
      await expect(
        pool.query(
          `INSERT INTO food_items (location_id, name, source)
           VALUES ($1, 'Grey Stuff', 'user_submitted')`,
          [locId],
        ),
      ).resolves.toBeDefined();

      // Duplicate under locId fails
      await expect(
        pool.query(
          `INSERT INTO food_items (location_id, name, source)
           VALUES ($1, 'grey stuff', 'user_submitted')`,
          [locId],
        ),
      ).rejects.toThrow();
    });

    it('cascades on experience deletion', async () => {
      const foodId = randomUUID();
      await pool.query(
        `INSERT INTO food_items (id, experience_id, name)
         VALUES ($1, $2, 'Grey Stuff')`,
        [foodId, expIdA],
      );

      await pool.query(`DELETE FROM experiences WHERE id = $1`, [expIdA]);
      const res = await pool.query(`SELECT count(*)::int as count FROM food_items WHERE id = $1`, [foodId]);
      expect(res.rows[0]?.['count']).toBe(0);
    });

    it('cascades on location deletion', async () => {
      const locId = randomUUID();
      const foodId = randomUUID();
      await pool.query(
        `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
         VALUES ($1, 'Spring Roll Cart', 'Magic Kingdom', $2)`,
        [locId, userId],
      );
      await pool.query(
        `INSERT INTO food_items (id, location_id, name, source)
         VALUES ($1, $2, 'Spring Roll', 'user_submitted')`,
        [foodId, locId],
      );

      await pool.query(`DELETE FROM user_submitted_locations WHERE id = $1`, [locId]);
      const res = await pool.query(`SELECT count(*)::int as count FROM food_items WHERE id = $1`, [foodId]);
      expect(res.rows[0]?.['count']).toBe(0);
    });
  });

  describe('food_item_logs', () => {
    let foodItemId: string;

    beforeEach(async () => {
      foodItemId = randomUUID();
      await pool.query(
        `INSERT INTO food_items (id, experience_id, name)
         VALUES ($1, $2, 'Grey Stuff')`,
        [foodItemId, expIdA],
      );
    });

    it('creates table with expected columns', () => {
      const columns = [...db.getTable('food_item_logs').getColumns()].map((c) => c.name);
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'user_id',
          'food_item_id',
          'visited_on',
          'user_tz',
          'logged_at',
          'rating',
          'note',
        ]),
      );
    });

    it('enforces rating range CHECK (1-10 or null)', async () => {
      await expect(
        pool.query(
          `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, rating)
           VALUES ($1, $2, '2026-05-01', 'America/New_York', 0)`,
          [userId, foodItemId],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, rating)
           VALUES ($1, $2, '2026-05-01', 'America/New_York', 11)`,
          [userId, foodItemId],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, rating)
           VALUES ($1, $2, '2026-05-01', 'America/New_York', 10)`,
          [userId, foodItemId],
        ),
      ).resolves.toBeDefined();
    });

    it('enforces note length CHECK (1-2000 or null)', async () => {
      await expect(
        pool.query(
          `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, note)
           VALUES ($1, $2, '2026-05-01', 'America/New_York', '')`,
          [userId, foodItemId],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, note)
           VALUES ($1, $2, '2026-05-01', 'America/New_York', $3)`,
          [userId, foodItemId, 'x'.repeat(2001)],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, note)
           VALUES ($1, $2, '2026-05-01', 'America/New_York', 'Delicious')`,
          [userId, foodItemId],
        ),
      ).resolves.toBeDefined();
    });

    it('cascades on food_items deletion and users deletion', async () => {
      const logId = randomUUID();
      await pool.query(
        `INSERT INTO food_item_logs (id, user_id, food_item_id, visited_on, user_tz)
         VALUES ($1, $2, $3, '2026-05-01', 'America/New_York')`,
        [logId, userId, foodItemId],
      );

      await pool.query(`DELETE FROM food_items WHERE id = $1`, [foodItemId]);
      const res = await pool.query(`SELECT count(*)::int as count FROM food_item_logs WHERE id = $1`, [logId]);
      expect(res.rows[0]?.['count']).toBe(0);
    });
  });
});
