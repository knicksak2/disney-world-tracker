// Feature: experience-favorites, Property 1: Favorite/Unfavorite Is Idempotent
// Feature: experience-favorites, Property 3: Favoriting a Non-Existent or Inactive Experience Is Rejected Before Any Write
// Feature: experience-favorites, Property 4: The Favorited_Set Is Scoped Exclusively to the Requesting User

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../errors/AppError.js';
import type { DbPool } from '../../../../db/pool.js';
import { createFavoriteRepo, type FavoriteRepo } from '../repo.js';

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
  return resolve(here, '..', '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

interface TestHarness {
  db: IMemoryDb;
  pool: DbPool;
  repo: FavoriteRepo;
  createActiveExperience(name: string): Promise<string>;
  createInactiveExperience(name: string): Promise<string>;
  createUser(emailPrefix: string): Promise<string>;
}

async function setupHarness(): Promise<TestHarness> {
  const db = buildPgMemDatabase();
  const { Pool: PgMemPool } = db.adapters.createPg();
  const pool = new PgMemPool() as unknown as DbPool;

  applyMigration(db, '0001_init.sql');
  applyMigration(db, '0054_experience_favorites.sql');

  const repo = createFavoriteRepo(pool);

  return {
    db,
    pool,
    repo,
    createActiveExperience: async (name: string): Promise<string> => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO experiences (id, name, category, park, active, upstream_entity_id)
         VALUES ($1, $2, 'Ride', 'Magic Kingdom', TRUE, $3)`,
        [id, name, `upstream-${id}`],
      );
      return id;
    },
    createInactiveExperience: async (name: string): Promise<string> => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO experiences (id, name, category, park, active, upstream_entity_id)
         VALUES ($1, $2, 'Ride', 'Magic Kingdom', FALSE, $3)`,
        [id, name, `upstream-${id}`],
      );
      return id;
    },
    createUser: async (emailPrefix: string): Promise<string> => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash)
         VALUES ($1, $2, 'hash')`,
        [id, `${emailPrefix}-${id}@example.com`],
      );
      return id;
    },
  };
}

describe('FavoriteRepo property tests', () => {
  // Feature: experience-favorites, Property 1: Favorite/Unfavorite Is Idempotent
  it('Property 1: Favorite and unfavorite are idempotent', async () => {
    const harness = await setupHarness();
    const userId = await harness.createUser('prop1');
    const expId = await harness.createActiveExperience('Space Mountain');

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        async (numFavorites, numUnfavorites) => {
          // Calling favorite() numFavorites times in sequence leaves exactly 1 row
          for (let i = 0; i < numFavorites; i++) {
            await harness.repo.favorite(userId, expId);
          }
          let res = await harness.pool.query(
            `SELECT count(*)::int as count FROM experience_favorites WHERE user_id = $1 AND experience_id = $2`,
            [userId, expId],
          );
          expect(res.rows[0]?.['count']).toBe(1);

          // Calling unfavorite() numUnfavorites times leaves 0 rows
          for (let i = 0; i < numUnfavorites; i++) {
            await harness.repo.unfavorite(userId, expId);
          }
          res = await harness.pool.query(
            `SELECT count(*)::int as count FROM experience_favorites WHERE user_id = $1 AND experience_id = $2`,
            [userId, expId],
          );
          expect(res.rows[0]?.['count']).toBe(0);

          // Extra unfavorite calls on empty state remain 0 rows with no error
          await harness.repo.unfavorite(userId, expId);
          res = await harness.pool.query(
            `SELECT count(*)::int as count FROM experience_favorites WHERE user_id = $1 AND experience_id = $2`,
            [userId, expId],
          );
          expect(res.rows[0]?.['count']).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-favorites, Property 3: Favoriting a Non-Existent or Inactive Experience Is Rejected Before Any Write
  it('Property 3: Favoriting non-existent or inactive experience is rejected before write', async () => {
    const harness = await setupHarness();
    const userId = await harness.createUser('prop3');

    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        async (isInactiveRatherThanMissing) => {
          let targetExpId: string;
          if (isInactiveRatherThanMissing) {
            targetExpId = await harness.createInactiveExperience(`Inactive-${randomUUID()}`);
          } else {
            targetExpId = randomUUID();
          }

          let caughtError: unknown;
          try {
            await harness.repo.favorite(userId, targetExpId);
          } catch (err) {
            caughtError = err;
          }

          expect(caughtError).toBeInstanceOf(AppError);
          expect((caughtError as AppError).code).toBe('experience_not_found');

          // Assert zero rows inserted for targetExpId
          const res = await harness.pool.query(
            `SELECT count(*)::int as count FROM experience_favorites WHERE experience_id = $1`,
            [targetExpId],
          );
          expect(res.rows[0]?.['count']).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-favorites, Property 4: The Favorited_Set Is Scoped Exclusively to the Requesting User
  it('Property 4: Favorited_Set is scoped exclusively to the requesting user', async () => {
    const harness = await setupHarness();
    const userA = await harness.createUser('userA');
    const userB = await harness.createUser('userB');

    // Create a pool of experiences
    const expIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      expIds.push(await harness.createActiveExperience(`Exp-${i}-${randomUUID()}`));
    }

    await fc.assert(
      fc.asyncProperty(
        fc.subarray(expIds),
        fc.subarray(expIds),
        async (userAFavorites, userBFavorites) => {
          // Reset favorites for both users
          await harness.pool.query(
            `DELETE FROM experience_favorites WHERE user_id IN ($1, $2)`,
            [userA, userB],
          );

          // Apply favorites for user A
          for (const id of userAFavorites) {
            await harness.repo.favorite(userA, id);
          }

          // Apply favorites for user B
          for (const id of userBFavorites) {
            await harness.repo.favorite(userB, id);
          }

          // Read favorite IDs
          const listA = await harness.repo.listFavoriteIds(userA);
          const listB = await harness.repo.listFavoriteIds(userB);

          const setA = new Set(listA);
          const setB = new Set(listB);

          // User A's set must match userAFavorites exactly
          expect(setA).toEqual(new Set(userAFavorites));

          // User B's set must match userBFavorites exactly
          expect(setB).toEqual(new Set(userBFavorites));

          // Neither set can contain items only favorited by the other
          for (const bOnly of userBFavorites.filter((id) => !userAFavorites.includes(id))) {
            expect(setA.has(bOnly)).toBe(false);
          }
          for (const aOnly of userAFavorites.filter((id) => !userBFavorites.includes(id))) {
            expect(setB.has(aOnly)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
