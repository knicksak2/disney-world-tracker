// Feature: experience-detail-navigation, Property 1: Completion projection carries the matching Experience_Id
/**
 * Property-based test for the Experience_Id projection on the Friend
 * Completions read (experience-detail-navigation, task 2.3).
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 *
 * Property 1 (design.md → Correctness Properties):
 *
 *   For any User and any set of that User's Completions over Active
 *   Experiences, every returned Completion_Entry carries an
 *   `experienceId` equal to the catalog `experiences.id` of the same
 *   Active Experience whose `name`, `park`, and `category` that entry
 *   reports.
 *
 * Test design
 * -----------
 * Unlike the content-projection property (which drives `rowToEntry`
 * through a fake pool), this test runs the production SQL in
 * `createFriendCompletionsRepo` verbatim against a real Postgres-style
 * engine using `pg-mem` — the same in-memory Postgres the integration
 * test and the smoke harness use. This proves the `e.id AS experience_id`
 * projection threads the catalog Experience_Id through the actual
 * `JOIN experiences e ON e.id = c.experience_id AND e.active = TRUE`.
 *
 * For each iteration the generator builds:
 *   - one target User,
 *   - a population of Experiences with globally-unique names (so the
 *     `(name, park, category)` triple uniquely identifies an Active
 *     Experience and the entry → experience mapping is unambiguous),
 *     each independently marked active or inactive,
 *   - a Completion for a generated subset of those Experiences (one per
 *     Experience, respecting the `completions` PK on
 *     `(user_id, experience_id)`).
 *
 * The oracle is a lookup from each generated Active Experience's
 * `(name, park, category)` triple back to the catalog id we inserted.
 * For every returned entry we assert `entry.experienceId` equals the id
 * of the Experience reported by that entry's name/park/category, that it
 * is the catalog UUID we inserted (R1.3), and that the join only ever
 * surfaces Active Experiences.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import type { DbPool } from '../../../../db/pool.js';
import { createFriendCompletionsRepo } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors completions.integration.test.ts / smoke harness)
// ---------------------------------------------------------------------------

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
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
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

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → friendCompletions → tracking → services → src → apps/api
  return resolve(here, '..', '..', '..', '..', '..', 'migrations', name);
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
// Seed helpers
// ---------------------------------------------------------------------------

async function insertUser(pool: DbPool): Promise<string> {
  const email = `${randomUUID()}@example.test`;
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [email, 'x'],
  );
  const userId = res.rows[0]!.id;
  await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [
    userId,
    'Target User',
  ]);
  return userId;
}

async function insertExperience(
  pool: DbPool,
  id: string,
  name: string,
  park: string,
  category: string,
  active: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, description, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, `upstream-${id}`, name, park, category, '', active],
  );
}

async function complete(
  pool: DbPool,
  userId: string,
  experienceId: string,
  completedOn: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
     VALUES ($1, $2, $3, $4)`,
    [userId, experienceId, completedOn, 'America/New_York'],
  );
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const calendarDateArb = fc.record({
  y: fc.integer({ min: 2000, max: 2030 }),
  m: fc.integer({ min: 1, max: 12 }),
  d: fc.integer({ min: 1, max: 28 }),
});

function isoDate({ y, m, d }: { y: number; m: number; d: number }): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

interface GenExperience {
  readonly id: string;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly active: boolean;
  /** Whether the target User has a Completion for this Experience. */
  readonly completed: boolean;
  readonly completedOn: string;
}

/**
 * A population of Experiences with globally-unique names. The unique
 * name guarantees the `(name, park, category)` triple uniquely
 * identifies an Active Experience, so each returned entry maps back to
 * exactly one inserted Experience.
 */
const populationArb: fc.Arbitrary<readonly GenExperience[]> = fc
  .array(
    fc.record({
      park: parkArb,
      category: categoryArb,
      active: fc.boolean(),
      completed: fc.boolean(),
      completedOn: calendarDateArb.map(isoDate),
    }),
    { minLength: 0, maxLength: 25 },
  )
  .map((rows) =>
    rows.map((r, i) => ({
      id: randomUUID(),
      // Unique, deterministic name per index keeps the (name,park,category)
      // triple unambiguous across the population.
      name: `Experience ${i}`,
      park: r.park,
      category: r.category,
      active: r.active,
      completed: r.completed,
      completedOn: r.completedOn,
    })),
  );

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('friend completions — Property 1: Experience_Id projection', () => {
  it('each entry carries the catalog id of the Active Experience it reports', async () => {
    await fc.assert(
      fc.asyncProperty(populationArb, async (population) => {
        // A fresh in-memory database per iteration keeps runs independent.
        const db = buildPgMemDatabase();
        const { Pool } = db.adapters.createPg();
        const pool = new Pool() as unknown as DbPool;
        applyInitMigration(db);
        applyMigration(db, '0002_experience_images.sql');
        applyMigration(db, '0003_note_shareable.sql');
        applyMigration(db, '0004_disney_sources.sql');
        // 0010 admits the `Resort` category the arbitraries draw from
        // (`EXPERIENCE_CATEGORIES` now includes `Resort`).
        applyMigration(db, '0010_resort_experience_category.sql');

        const userId = await insertUser(pool);

        for (const exp of population) {
          await insertExperience(
            pool,
            exp.id,
            exp.name,
            exp.park,
            exp.category,
            exp.active,
          );
          if (exp.completed) {
            await complete(pool, userId, exp.id, exp.completedOn);
          }
        }

        const repo = createFriendCompletionsRepo(pool);
        const entries = await repo.listCompletions(userId);

        // Oracle: (name|park|category) → { id, active } for the inserted set.
        const byTriple = new Map<string, { id: string; active: boolean }>();
        for (const exp of population) {
          byTriple.set(`${exp.name}|${exp.park}|${exp.category}`, {
            id: exp.id,
            active: exp.active,
          });
        }

        // Expected returned set: Active Experiences with a Completion.
        const expectedIds = new Set(
          population.filter((e) => e.active && e.completed).map((e) => e.id),
        );
        expect(entries).toHaveLength(expectedIds.size);

        for (const entry of entries) {
          const source = byTriple.get(
            `${entry.experienceName}|${entry.park}|${entry.category}`,
          );

          // The reported name/park/category resolves to a known Experience.
          expect(source).toBeDefined();

          // R1.1 / R1.2: the entry carries the Experience_Id of the same
          // Active Experience whose name/park/category it reports.
          expect(entry.experienceId).toBe(source!.id);

          // R1.2: only Active Experiences are ever projected.
          expect(source!.active).toBe(true);

          // R1.3: the value is the catalog UUID (matches the id the
          // ExperienceDetailView would use to load the same Experience).
          expect(entry.experienceId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          );
          expect(expectedIds.has(entry.experienceId)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
