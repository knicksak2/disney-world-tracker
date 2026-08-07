// Feature: experience-detail-navigation, Property 2: Adding Experience_Id preserves the existing read contract
/**
 * Property-based test for read-contract preservation (task 2.4).
 *
 * Validates: Requirements 1.4
 *
 * Property 2 (design.md -> Correctness Properties):
 *
 *   For any set of Completions, the returned entries with `experienceId`
 *   removed are identical -- in membership, ordering (`completed_on`
 *   descending, then case-insensitive name/park/category), 5,000-entry cap,
 *   Rating values, and shared-Note disclosure -- to the entries the read
 *   produced before the `experienceId` field was added.
 *
 * Test design (differential / oracle)
 * -----------------------------------
 * This test runs end-to-end against a real Postgres-style engine (`pg-mem`),
 * matching the setup used by `completions.integration.test.ts` so the
 * production SQL in `createFriendCompletionsRepo` runs verbatim against actual
 * tables (the `JOIN experiences ... AND e.active`, the `LEFT JOIN ratings` /
 * `LEFT JOIN notes` + `CASE WHEN n.shareable` projection, the ORDER BY, and the
 * LIMIT).
 *
 * The "pre-change contract" is captured by an ORACLE query: the exact SQL the
 * read ran *before* `e.id AS experience_id` was projected -- identical JOINs,
 * WHERE, ORDER BY, and LIMIT, but without the `experience_id` column. For any
 * generated population of Completions, the oracle is executed against the same
 * pg-mem database and its rows are mapped with the same row -> entry projection
 * the repo uses (minus `experienceId`). The test then runs the real repo,
 * strips `experienceId` from every returned entry, and asserts the two lists
 * are deeply equal.
 *
 * Because both queries run on the same engine with identical filtering,
 * ordering, and limiting, equality across the full result list proves the new
 * field changes nothing about membership, ordering, the 5,000-entry cap, Rating
 * values, or shared-Note disclosure. To keep the differential ordering
 * comparison deterministic (two separate query executions must agree on
 * fully-tied rows), each Experience is given a case-insensitively-unique name,
 * so `lower(e.name)` is a unique deterministic tie-break within each
 * Completion-date group while still exercising the case-insensitive ordering
 * path. Completion dates are drawn from a small pool to force ties so the
 * name tie-break is actually exercised. Inactive Experiences are generated to
 * exercise the membership filter; absent / private / shareable Notes exercise
 * the shared-Note disclosure; present/absent Ratings exercise the rating path.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type AreaType,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import type { DbPool } from '../../../../db/pool.js';
import { createFriendCompletionsRepo, type CompletionEntry } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors completions.integration.test.ts / test/smoke/harness.ts)
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
  // __tests__ -> friendCompletions -> tracking -> services -> src -> apps/api
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
// Oracle: the pre-change read contract (SELECT without `e.id AS experience_id`)
// ---------------------------------------------------------------------------

/** Row shape emitted by the pre-change SELECT (no experience_id column). */
interface PreChangeRow {
  experience_name: string;
  park: Park | null;
  area_type: AreaType;
  category: ExperienceCategory;
  completed_on: Date | string;
  rating: number | string | null;
  shared_note: string | null;
}

/** The contract shape before `experienceId` existed (CompletionEntry minus it). */
type PreChangeEntry = Omit<CompletionEntry, 'experienceId'>;

/** Format a DATE column value as `YYYY-MM-DD` (mirrors the repo's `toIsoDate`). */
function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  const yyyy = value.getUTCFullYear().toString().padStart(4, '0');
  const mm = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = value.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Execute the EXACT SQL the Friend Completions read ran before `experienceId`
 * was added -- identical JOINs / WHERE / ORDER BY / LIMIT, minus the
 * `e.id AS experience_id` projection -- and map each row the same way
 * `rowToEntry` does (minus `experienceId`).
 */
async function readPreChangeContract(
  pool: DbPool,
  userId: string,
): Promise<readonly PreChangeEntry[]> {
  const result = await pool.query<PreChangeRow>(
    `SELECT e.name AS experience_name,
            e.park,
            e.area_type,
            e.category,
            c.completed_on,
            r.value AS rating,
            CASE WHEN n.shareable THEN n.body ELSE NULL END AS shared_note
       FROM completions c
       JOIN experiences e ON e.id = c.experience_id AND e.active = TRUE
       LEFT JOIN ratings r ON r.user_id = c.user_id AND r.experience_id = c.experience_id
       LEFT JOIN notes   n ON n.user_id = c.user_id AND n.experience_id = c.experience_id
      WHERE c.user_id = $1
      ORDER BY c.completed_on DESC,
               lower(e.name) ASC,
               lower(e.park) ASC,
               lower(e.category) ASC
      LIMIT 5000`,
    [userId],
  );
  return result.rows.map((row) => ({
    experienceName: row.experience_name,
    park: row.park,
    areaType: row.area_type,
    category: row.category,
    completedOn: toIsoDate(row.completed_on),
    rating: row.rating === null ? null : Number(row.rating),
    sharedNote: row.shared_note,
  }));
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

type NoteKind = 'absent' | 'private' | 'shareable';

interface GeneratedItem {
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly active: boolean;
  /** Upper-case the name so `lower(name)` still collapses to a stable key. */
  readonly upperName: boolean;
  readonly completedOn: string; // YYYY-MM-DD
  readonly rating: number | null;
  readonly note: { readonly kind: NoteKind; readonly body: string };
}

// Small date pool forces Completion-date ties so the name tie-break is
// exercised (the differential ordering comparison must agree on tied rows).
const DATES = ['2025-01-10', '2025-03-22', '2024-12-31', '2025-06-15'] as const;

const itemArb: fc.Arbitrary<GeneratedItem> = fc.record({
  park: fc.constantFrom(...PARKS),
  category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
  // Mostly active, occasionally inactive (exercises the membership filter).
  active: fc.constantFrom(true, true, true, false),
  upperName: fc.boolean(),
  completedOn: fc.constantFrom(...DATES),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  note: fc.record({
    kind: fc.constantFrom<NoteKind>('absent', 'private', 'shareable'),
    // A present Note's body must satisfy the `notes_body_length_chk` constraint
    // (non-empty); the body is irrelevant when kind === 'absent'.
    // Backslashes are filtered out because pg-mem's SQL AST parser has a known
    // limitation where it throws a JSON.parse syntax error when encountering
    // escaped backslash sequences in bound parameters, whereas production
    // Postgres handles arbitrary byte strings in parameterized queries cleanly.
    body: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !s.includes('\\')),
  }),
});

const populationArb = fc.array(itemArb, { minLength: 0, maxLength: 40 });

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

let db: IMemoryDb;
let pool: DbPool;
let targetUserId: string;

beforeAll(async () => {
  db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  pool = new Pool() as unknown as DbPool;

  applyInitMigration(db);
  applyMigration(db, '0002_experience_images.sql');
  applyMigration(db, '0003_note_shareable.sql');
  applyMigration(db, '0004_disney_sources.sql');
  // 0010 admits the `Resort` category the arbitraries draw from
  // (`EXPERIENCE_CATEGORIES` now includes `Resort`).
  applyMigration(db, '0010_resort_experience_category.sql');

  // One persistent target User reused across all property runs.
  const email = `${randomUUID()}@example.test`;
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [email, 'x'],
  );
  targetUserId = res.rows[0]!.id;
  await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [
    targetUserId,
    'Target User',
  ]);
});

afterAll(async () => {
  await (pool as unknown as { end: () => Promise<void> }).end?.();
});

/** Remove all per-run tracking rows so each property iteration starts clean. */
async function resetTrackingTables(): Promise<void> {
  await pool.query('DELETE FROM completions');
  await pool.query('DELETE FROM ratings');
  await pool.query('DELETE FROM notes');
  await pool.query('DELETE FROM experiences');
}

/** Seed the generated population for the target User. */
async function seed(population: readonly GeneratedItem[]): Promise<void> {
  for (let i = 0; i < population.length; i += 1) {
    const item = population[i]!;
    const expId = randomUUID();
    // Case-insensitively-unique name: lower(name) === `experience-${i}` for all
    // rows, so the ORDER BY tie-break is unique & deterministic per date group.
    const base = `experience-${i}`;
    const name = item.upperName ? base.toUpperCase() : base;

    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, description, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [expId, `upstream-${expId}`, name, item.park, item.category, '', item.active],
    );
    await pool.query(
      `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
       VALUES ($1, $2, $3, $4)`,
      [targetUserId, expId, item.completedOn, 'America/New_York'],
    );
    if (item.rating !== null) {
      await pool.query(
        `INSERT INTO ratings (user_id, experience_id, value) VALUES ($1, $2, $3)`,
        [targetUserId, expId, item.rating],
      );
    }
    if (item.note.kind !== 'absent') {
      await pool.query(
        `INSERT INTO notes (user_id, experience_id, body, shareable) VALUES ($1, $2, $3, $4)`,
        [targetUserId, expId, item.note.body, item.note.kind === 'shareable'],
      );
    }
  }
}

/** Drop the `experienceId` field, yielding the pre-change entry shape. */
function stripExperienceId(entry: CompletionEntry): PreChangeEntry {
  const { experienceId: _omit, ...rest } = entry;
  return rest;
}

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe('Friend Completions — Property 2: adding Experience_Id preserves the read contract', () => {
  it('entries with experienceId stripped equal the pre-change contract (membership, ordering, cap, rating, shared-note)', async () => {
    const repo = createFriendCompletionsRepo(pool);

    await fc.assert(
      fc.asyncProperty(populationArb, async (population) => {
        await resetTrackingTables();
        await seed(population);

        // The pre-change contract (oracle) and the current read run against the
        // same data in the same engine.
        const expected = await readPreChangeContract(pool, targetUserId);
        const actual = await repo.listCompletions(targetUserId);

        // Every current entry carries a non-empty experienceId (so stripping is
        // meaningful), and stripping it reproduces the pre-change contract
        // exactly — same membership, ordering, rating values, and shared-note
        // disclosure, in the same order.
        for (const entry of actual) {
          expect(typeof entry.experienceId).toBe('string');
          expect(entry.experienceId.length).toBeGreaterThan(0);
        }

        const stripped = actual.map(stripExperienceId);
        expect(stripped).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------

describe('Friend Completions — Property 2 fixed examples', () => {
  it('excludes completions over inactive experiences (membership preserved)', async () => {
    const repo = createFriendCompletionsRepo(pool);
    await resetTrackingTables();
    await seed([
      {
        park: 'Magic Kingdom' as Park,
        category: 'Ride' as ExperienceCategory,
        active: true,
        upperName: false,
        completedOn: '2025-01-10',
        rating: 7,
        note: { kind: 'shareable', body: 'great' },
      },
      {
        park: 'EPCOT' as Park,
        category: 'Ride' as ExperienceCategory,
        active: false, // inactive → excluded by both queries
        upperName: false,
        completedOn: '2025-02-10',
        rating: 9,
        note: { kind: 'absent', body: '' },
      },
    ]);

    const expected = await readPreChangeContract(pool, targetUserId);
    const actual = await repo.listCompletions(targetUserId);

    expect(actual).toHaveLength(1);
    expect(actual.map(stripExperienceId)).toEqual(expected);
    expect(actual[0]!.sharedNote).toBe('great');
  });

  it('keeps a private note hidden after the field was added', async () => {
    const repo = createFriendCompletionsRepo(pool);
    await resetTrackingTables();
    await seed([
      {
        park: 'Magic Kingdom' as Park,
        category: 'Ride' as ExperienceCategory,
        active: true,
        upperName: false,
        completedOn: '2025-01-10',
        rating: null,
        note: { kind: 'private', body: 'PRIVATE_BODY' },
      },
    ]);

    const expected = await readPreChangeContract(pool, targetUserId);
    const actual = await repo.listCompletions(targetUserId);

    expect(actual.map(stripExperienceId)).toEqual(expected);
    expect(actual[0]!.sharedNote).toBeNull();
    expect(actual[0]!.rating).toBeNull();
    expect(JSON.stringify(actual)).not.toContain('PRIVATE_BODY');
  });
});
