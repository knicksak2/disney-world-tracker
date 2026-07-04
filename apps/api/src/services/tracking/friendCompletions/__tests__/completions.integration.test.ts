/**
 * Integration test for the Friend Completions endpoint and the
 * `notes.shareable` migration (task 4.4).
 *
 * Validates: Requirements 4.1, 4.10, 4.6
 *
 * Unlike the Property tests in this folder (which drive the repo's row →
 * entry projection through a fake pool), this test exercises
 * `GET /users/:userId/completions` *end-to-end against a real Postgres-style
 * engine*. It uses `pg-mem` — the same in-memory Postgres the smoke harness
 * uses (see `test/smoke/harness.ts`) — so the production SQL in
 * `createFriendCompletionsRepo` (the `JOIN experiences ... AND e.active`,
 * `LEFT JOIN ratings`, `LEFT JOIN notes` + `CASE WHEN n.shareable` projection,
 * ordering, and `LIMIT`) runs verbatim against actual tables.
 *
 * Setup mirrors the harness exactly:
 *   - `buildPgMemDatabase()` registers the extensions/system functions the
 *     canonical schema references (`gen_random_uuid`, `char_length`, `lower`).
 *   - `applyMigration()` reads `migrations/0001_init.sql` and strips the GIN
 *     trigram indexes via `sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '')`
 *     before `db.public.none(sql)`.
 *   - This test additionally applies `0002_experience_images.sql` and
 *     `0003_note_shareable.sql` (in order) so `notes.shareable` exists.
 *
 * The route is mounted on an in-process Fastify app with the global error
 * handler, a stub `requireSession` that reads `request.userId` from a header,
 * and the real `assertOwnerOrFriend` gate backed by the same pg-mem pool.
 *
 * Three scenarios are covered:
 *   - Happy path (R4.1, R4.6): an accepted Friend reads the target's
 *     Completions and receives entries; a *shareable* Note's body appears and
 *     a *private* Note's body does NOT.
 *   - Empty case (R4.10): a Friend of a target with zero Completions receives
 *     `{ entries: [] }`.
 *   - Schema (R4.6): `notes.shareable` is `NOT NULL DEFAULT FALSE`.
 *     pg-mem's `information_schema.columns` support is unreliable, so this
 *     test asserts the *behavior* of the column instead (the choice the task
 *     brief allows): a Note inserted without `shareable` persists as `false`
 *     (proving `DEFAULT FALSE`), and inserting `NULL` into `shareable` fails
 *     (proving `NOT NULL`).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../../db/pool.js';
import { registerErrorHandler } from '../../../../errors/handler.js';
import { pair as canonicalPair } from '../../../friends/canonicalPair.js';
import { createFriendCompletionsRepo } from '../repo.js';
import {
  friendCompletionsRoutes,
  type FriendCompletionsRoutesOptions,
} from '../routes.js';

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors test/smoke/harness.ts)
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

/** Absolute path to a migration file relative to this test. */
function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → friendCompletions → tracking → services → src → apps/api
  return resolve(here, '..', '..', '..', '..', '..', 'migrations', name);
}

/** Apply migration 0001, stripping the GIN trigram indexes pg-mem can't model. */
function applyInitMigration(db: IMemoryDb): void {
  let sql = readFileSync(migrationPath('0001_init.sql'), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

/** Apply a later migration verbatim (no GIN indexes in 0002/0003). */
function applyMigration(db: IMemoryDb, name: string): void {
  const sql = readFileSync(migrationPath(name), 'utf8');
  db.public.none(sql);
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface Fixture {
  db: IMemoryDb;
  pool: DbPool;
  app: FastifyInstance;
}

/** Stub session pre-handler: sets request.userId from the x-test-user-id header. */
const requireSession: FriendCompletionsRoutesOptions['requireSession'] = (
  request,
  _reply,
  done,
) => {
  const id = request.headers['x-test-user-id'];
  if (typeof id === 'string' && id.length > 0) {
    request.userId = id;
  }
  done();
};

async function setup(): Promise<Fixture> {
  const db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as DbPool;

  applyInitMigration(db);
  applyMigration(db, '0002_experience_images.sql');
  applyMigration(db, '0003_note_shareable.sql');
  // 0004 adds `experiences.area_type` (NOT NULL DEFAULT 'ThemePark'), which the
  // Friend Completions read now projects onto each entry's `areaType`.
  applyMigration(db, '0004_disney_sources.sql');

  const repo = createFriendCompletionsRepo(pool);
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(friendCompletionsRoutes({ repo, pool, requireSession }));
  await app.ready();

  return { db, pool, app };
}

// --- Seed helpers ----------------------------------------------------------

async function insertUser(pool: DbPool, displayName: string): Promise<string> {
  const email = `${randomUUID()}@example.test`;
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [email, 'x'],
  );
  const userId = res.rows[0]!.id;
  await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [
    userId,
    displayName,
  ]);
  return userId;
}

async function befriend(pool: DbPool, a: string, b: string): Promise<void> {
  const { lo, hi } = canonicalPair(a, b);
  await pool.query(
    `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`,
    [lo, hi],
  );
}

async function insertExperience(
  pool: DbPool,
  name: string,
  park: string,
  category: string,
  active: boolean,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, description, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, `upstream-${id}`, name, park, category, '', active],
  );
  return id;
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

async function rate(
  pool: DbPool,
  userId: string,
  experienceId: string,
  value: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO ratings (user_id, experience_id, value) VALUES ($1, $2, $3)`,
    [userId, experienceId, value],
  );
}

async function note(
  pool: DbPool,
  userId: string,
  experienceId: string,
  body: string,
  shareable: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO notes (user_id, experience_id, body, shareable) VALUES ($1, $2, $3, $4)`,
    [userId, experienceId, body, shareable],
  );
}

interface CompletionEntryWire {
  experienceName: string;
  park: string;
  category: string;
  completedOn: string;
  rating: number | null;
  sharedNote: string | null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Friend Completions endpoint — integration (pg-mem)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await setup();
  });

  afterEach(async () => {
    await fx.app.close();
  });

  it('returns a Friend\'s completions with a shareable note visible and a private note hidden (R4.1, R4.6)', async () => {
    const { pool, app } = fx;

    const target = await insertUser(pool, 'Target User');
    const friend = await insertUser(pool, 'Friend User');
    await befriend(pool, friend, target);

    // expA: shareable note + rating; expB: private note, no rating.
    const expA = await insertExperience(pool, 'Space Mountain', 'Magic Kingdom', 'Ride', true);
    const expB = await insertExperience(pool, 'Test Track', 'EPCOT', 'Ride', true);

    await complete(pool, target, expA, '2025-01-10');
    await complete(pool, target, expB, '2025-01-05');
    await rate(pool, target, expA, 8);
    await note(pool, target, expA, 'SHAREABLE_BODY', true);
    await note(pool, target, expB, 'PRIVATE_BODY', false);

    const res = await app.inject({
      method: 'GET',
      url: `/users/${target}/completions`,
      headers: { 'x-test-user-id': friend },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: CompletionEntryWire[] };
    expect(body.entries).toHaveLength(2);

    // Ordered by completed_on DESC → expA (Jan 10) first, expB (Jan 5) second.
    const [first, second] = body.entries;
    expect(first!.experienceName).toBe('Space Mountain');
    expect(first!.rating).toBe(8);
    expect(first!.sharedNote).toBe('SHAREABLE_BODY'); // shareable → body visible (R4.6)

    expect(second!.experienceName).toBe('Test Track');
    expect(second!.rating).toBeNull(); // no rating
    expect(second!.sharedNote).toBeNull(); // private → hidden (R4.6/R4.7)

    // The private note's body must not appear anywhere in the response.
    expect(JSON.stringify(body)).not.toContain('PRIVATE_BODY');
  });

  it('returns { entries: [] } for a Friend of a target with zero completions (R4.10)', async () => {
    const { pool, app } = fx;

    const targetEmpty = await insertUser(pool, 'Empty Target');
    const friend = await insertUser(pool, 'Friend User');
    await befriend(pool, friend, targetEmpty);

    const res = await app.inject({
      method: 'GET',
      url: `/users/${targetEmpty}/completions`,
      headers: { 'x-test-user-id': friend },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entries: [] });
  });

  // Schema assertion for notes.shareable (R4.6).
  //
  // pg-mem's information_schema.columns support is unreliable, so per the task
  // brief we assert the column's *behavior* rather than querying the catalog:
  //   1) inserting a Note WITHOUT shareable persists it as false  → DEFAULT FALSE
  //   2) inserting NULL into shareable fails                       → NOT NULL
  it('notes.shareable is NOT NULL DEFAULT FALSE (behavioral schema check)', async () => {
    const { pool } = fx;

    const owner = await insertUser(pool, 'Note Owner');
    const exp = await insertExperience(pool, 'Haunted Mansion', 'Magic Kingdom', 'Ride', true);

    // (1) DEFAULT FALSE: omit the shareable column entirely on insert.
    await pool.query(
      `INSERT INTO notes (user_id, experience_id, body) VALUES ($1, $2, $3)`,
      [owner, exp, 'defaulted note'],
    );
    const read = await pool.query<{ shareable: boolean }>(
      `SELECT shareable FROM notes WHERE user_id = $1 AND experience_id = $2`,
      [owner, exp],
    );
    expect(read.rows[0]!.shareable).toBe(false);

    // (2) NOT NULL: explicitly inserting NULL into shareable must be rejected.
    const exp2 = await insertExperience(pool, 'Pirates', 'Magic Kingdom', 'Ride', true);
    await expect(
      pool.query(
        `INSERT INTO notes (user_id, experience_id, body, shareable) VALUES ($1, $2, $3, $4)`,
        [owner, exp2, 'null note', null],
      ),
    ).rejects.toThrow();
  });
});
