// Feature: social-sharing-loop, Property 14: A push token is active for exactly one user — the most recent registrant
/**
 * Property-based test for the push-token ownership invariant (task 12.2).
 *
 * Validates: Requirements 8.2, 8.3, 8.5
 *
 * Property 14 (design.md -> Correctness Properties):
 *
 *   After any sequence of `register(user, device, token)` calls, each physical
 *   Push_Token is active for exactly one User — the most recent registrant of
 *   that token.
 *
 * Test design (real engine + independent oracle)
 * ----------------------------------------------
 * The production `createPushRepo` factory (task 12.1) runs verbatim against a
 * real Postgres-style engine (`pg-mem`) with the canonical schema migration
 * `0011_social_sharing_loop.sql` applied on top of `0001_init.sql`. This means
 * the DELETE-then-upsert `register` transaction executes against the two real
 * unique constraints it must reconcile:
 *
 *   1. UNIQUE (expo_push_token)            — a physical token belongs to at
 *                                            most one row (R8.3).
 *   2. UNIQUE (user_id, device_id)         — one registration per device, so a
 *                                            device rotating its token reuses
 *                                            the row rather than accumulating
 *                                            rows (R8.2, R8.5).
 *
 * For any generated sequence of registrations drawn from a small pool of
 * users / devices / tokens (so reassignments and rotations actually collide),
 * the test checks three things against the resulting `push_registrations`
 * state:
 *
 *   (A) Uniqueness  — group the active rows by physical token; every group has
 *       exactly one row. No token is active for two users at once (R8.3).
 *
 *   (B) Ownership   — an INDEPENDENT oracle: for each active row carrying token
 *       `T`, the LAST operation in the sequence that mentions `T` must be the
 *       register that placed it, i.e. its (user, device) equals the row's.
 *       This holds because `register(u, d, T)` always ends with `T` active for
 *       `(u, d)` and the DELETE evicts `T` from every other holder, and the
 *       only way `T` can subsequently leave `(u, d)` is another op mentioning
 *       `T` (a rotation on `(u, d)` to a new token, or a reassignment to
 *       someone else). So if `T` survives to the final state, no later op
 *       mentioned it — the last op mentioning `T` is exactly its current owner
 *       (R8.2, R8.5).
 *
 *   (C) Completeness — a faithful reference model that mirrors the
 *       DELETE-then-upsert semantics reproduces the exact active-row set, so
 *       (A)+(B) are not vacuously satisfied by missing/extra rows.
 *
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { createPushRepo } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors migration0009.test.ts / friendCompletions prop tests)
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
  // __tests__ -> push -> services -> src -> apps/api
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

/** Apply a migration file, stripping GIN trigram indexes pg-mem can't model. */
function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

// ---------------------------------------------------------------------------
// Reference model — mirrors register's DELETE-then-upsert semantics
// ---------------------------------------------------------------------------

interface Op {
  readonly userId: string;
  readonly deviceId: string;
  readonly token: string;
}

interface ActiveRow {
  readonly userId: string;
  readonly deviceId: string;
  readonly token: string;
}

const NUL = '\u0000';
const deviceKey = (userId: string, deviceId: string): string =>
  `${userId}${NUL}${deviceId}`;

/**
 * Replay the register semantics over a fresh in-memory map keyed by
 * (user, device) -> token, producing the expected set of active rows.
 */
function modelActiveRows(ops: readonly Op[]): ActiveRow[] {
  const byDevice = new Map<string, string>(); // (user,device) -> token

  for (const op of ops) {
    const key = deviceKey(op.userId, op.deviceId);
    // DELETE FROM push_registrations WHERE expo_push_token = token
    //   AND NOT (user_id = user AND device_id = device)
    for (const [otherKey, tok] of [...byDevice.entries()]) {
      if (tok === op.token && otherKey !== key) {
        byDevice.delete(otherKey);
      }
    }
    // INSERT ... ON CONFLICT (user_id, device_id) DO UPDATE SET token = EXCLUDED
    byDevice.set(key, op.token);
  }

  return [...byDevice.entries()].map(([key, token]) => {
    const [userId, deviceId] = key.split(NUL);
    return { userId: userId!, deviceId: deviceId!, token };
  });
}

const sortRows = (rows: readonly ActiveRow[]): ActiveRow[] =>
  [...rows].sort((a, b) =>
    `${a.userId}${a.deviceId}${a.token}`.localeCompare(
      `${b.userId}${b.deviceId}${b.token}`,
    ),
  );

// ---------------------------------------------------------------------------
// Fixture — a small fixed pool of users; devices/tokens are plain strings
// ---------------------------------------------------------------------------

const USER_COUNT = 3;
const DEVICE_COUNT = 3;
const TOKEN_COUNT = 4;

let db: IMemoryDb;
let pool: DbPool;
let userIds: string[];

beforeAll(async () => {
  db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  pool = new Pool() as unknown as DbPool;

  applyMigration(db, '0001_init.sql');
  applyMigration(db, '0011_social_sharing_loop.sql');

  // Seed a fixed set of users the FK on push_registrations.user_id references.
  userIds = [];
  for (let i = 0; i < USER_COUNT; i += 1) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [`${randomUUID()}@example.test`, 'x'],
    );
    userIds.push(res.rows[0]!.id);
  }
});

afterAll(async () => {
  await (pool as unknown as { end?: () => Promise<void> }).end?.();
});

async function resetRegistrations(): Promise<void> {
  await pool.query('DELETE FROM push_registrations');
}

/** Read the current active registrations straight from the table. */
async function readActiveRows(): Promise<ActiveRow[]> {
  const res = await pool.query<{
    user_id: string;
    device_id: string;
    expo_push_token: string;
  }>(
    `SELECT user_id, device_id, expo_push_token
       FROM push_registrations
      WHERE status = 'active'`,
  );
  return res.rows.map((r) => ({
    userId: r.user_id,
    deviceId: r.device_id,
    token: r.expo_push_token,
  }));
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const opArb = (): fc.Arbitrary<Op> =>
  fc.record({
    userId: fc.integer({ min: 0, max: USER_COUNT - 1 }).map((i) => userIds[i]!),
    deviceId: fc
      .integer({ min: 0, max: DEVICE_COUNT - 1 })
      .map((i) => `device-${i}`),
    token: fc.integer({ min: 0, max: TOKEN_COUNT - 1 }).map((i) => `token-${i}`),
  });

const sequenceArb = fc.array(opArb(), { minLength: 1, maxLength: 14 });

// ---------------------------------------------------------------------------
// Property 14
// ---------------------------------------------------------------------------

describe('Push_Registration — Property 14: a token is active for exactly one user (most recent registrant)', () => {
  it('any register sequence leaves each token active for exactly one user, the most recent registrant', async () => {
    const repo = createPushRepo(pool);

    await fc.assert(
      fc.asyncProperty(sequenceArb, async (ops) => {
        await resetRegistrations();

        for (const op of ops) {
          await repo.register(op.userId, op.deviceId, op.token);
        }

        const active = await readActiveRows();

        // (A) Uniqueness: each physical token is active for exactly one row.
        const byToken = new Map<string, ActiveRow[]>();
        for (const row of active) {
          const bucket = byToken.get(row.token) ?? [];
          bucket.push(row);
          byToken.set(row.token, bucket);
        }
        for (const [token, rows] of byToken) {
          expect(
            rows.length,
            `token ${token} is active for ${rows.length} rows`,
          ).toBe(1);
        }

        // (B) Ownership (independent oracle): the last op mentioning a still-
        // active token is exactly its current (user, device).
        for (const row of active) {
          let last: Op | undefined;
          for (const op of ops) {
            if (op.token === row.token) last = op;
          }
          expect(last).toBeDefined();
          expect(last!.userId).toBe(row.userId);
          expect(last!.deviceId).toBe(row.deviceId);
        }

        // (C) Completeness: the model's active-row set matches the DB exactly.
        expect(sortRows(active)).toEqual(sortRows(modelActiveRows(ops)));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------

describe('Push_Registration — Property 14 fixed examples', () => {
  it('reassigning a token to a new user leaves it active only for the new user (R8.3, R8.5)', async () => {
    const repo = createPushRepo(pool);
    await resetRegistrations();

    await repo.register(userIds[0]!, 'device-0', 'token-shared');
    await repo.register(userIds[1]!, 'device-9', 'token-shared');

    const active = await readActiveRows();
    const holders = active.filter((r) => r.token === 'token-shared');
    expect(holders).toHaveLength(1);
    expect(holders[0]!.userId).toBe(userIds[1]);
  });

  it('a device rotating its token drops the old token from the active set (R8.2)', async () => {
    const repo = createPushRepo(pool);
    await resetRegistrations();

    await repo.register(userIds[0]!, 'device-0', 'token-old');
    await repo.register(userIds[0]!, 'device-0', 'token-new');

    const active = await readActiveRows();
    expect(active.map((r) => r.token)).toEqual(['token-new']);
    expect(active).toHaveLength(1);
    expect(active[0]!.userId).toBe(userIds[0]);
  });
});
