// Feature: social-sharing-loop, Property 18: Reacting to an undelivered share is rejected with an authorization error
/**
 * Property-based test for the reaction authorization invariant (task 14.4).
 *
 * Validates: Requirements 11.8
 *
 * Property 18 (design.md -> Correctness Properties):
 *
 *   For any `Share` not delivered to a given User, that User's reaction
 *   submission is rejected with an authorization error and no
 *   `Share_Reaction` is persisted.
 *
 * Requirement 11.8:
 *   IF a recipient submits a Share_Reaction to a Share that was NOT delivered
 *   to that recipient, THEN THE Reaction_Service SHALL reject the request and
 *   return an authorization error.
 *
 * Test design (real engine)
 * -------------------------
 * The production `createReactionsRepo` factory (task 14.1) runs verbatim
 * against a real Postgres-style engine (`pg-mem`) with the canonical schema
 * migrations `0001_init.sql` (defines `users`, `shares`, `share_recipients`)
 * and `0011_social_sharing_loop.sql` (defines `share_reactions`). This means
 * the authorization gate — the `INSERT ... SELECT ... WHERE EXISTS (SELECT 1
 * FROM share_recipients ...)` guard inside `upsertReaction` — executes against
 * the real tables and foreign keys.
 *
 * A fixed fixture seeds a small pool of users and shares, and a deterministic
 * set of `share_recipients` rows. The property then draws an arbitrary
 * `(share, user, reaction)` triple from that pool and asserts the delivery
 * dichotomy:
 *
 *   - When the user IS a recipient of the share, `upsertReaction` resolves and
 *     the reaction is persisted (exactly one row for that (share, recipient)).
 *
 *   - When the user is NOT a recipient of the share, `upsertReaction` rejects
 *     with an `AppError` carrying the `reaction_forbidden` authorization code,
 *     and NOTHING is persisted — the `share_reactions` table is left empty.
 *
 * The table is reset before every generated case so "persists nothing" can be
 * asserted as an absolute: after a forbidden attempt there are zero reaction
 * rows anywhere.
 *
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHARE_REACTION_VALUES, type ShareReactionValue } from '@dwt/shared';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createReactionsRepo } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors pushOwnership.prop.test.ts)
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
  // __tests__ -> reactions -> services -> src -> apps/api
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

/** Apply a migration file, stripping GIN trigram indexes pg-mem can't model. */
function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

// ---------------------------------------------------------------------------
// Fixture — a fixed pool of users and shares, with a deterministic set of
// share_recipients rows so both recipient and non-recipient pairs exist.
// ---------------------------------------------------------------------------

const USER_COUNT = 4;
const SHARE_COUNT = 4;

let db: IMemoryDb;
let pool: DbPool;
let userIds: string[];
let shareIds: string[];
/** Set of "<shareIdx>::<userIdx>" pairs that ARE delivered (recipients). */
const recipientPairs = new Set<string>();

const pairKey = (shareIdx: number, userIdx: number): string =>
  `${shareIdx}::${userIdx}`;

/**
 * Deterministic recipient membership: share `s` is delivered to users at
 * indices `(s + 1) % N` and `(s + 2) % N`. This guarantees, for every share,
 * that some users are recipients and some are not (e.g. the sender `s % N`
 * and `(s + 3) % N` are never recipients), so both branches of R11.8 are
 * exercised by the generator.
 */
function isRecipient(shareIdx: number, userIdx: number): boolean {
  const n = USER_COUNT;
  return userIdx === (shareIdx + 1) % n || userIdx === (shareIdx + 2) % n;
}

beforeAll(async () => {
  db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  pool = new Pool() as unknown as DbPool;

  applyMigration(db, '0001_init.sql');
  applyMigration(db, '0011_social_sharing_loop.sql');

  // Seed users.
  userIds = [];
  for (let i = 0; i < USER_COUNT; i += 1) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [`${randomUUID()}@example.test`, 'x'],
    );
    userIds.push(res.rows[0]!.id);
  }

  // Seed shares (progress kind => experience_id NULL, per shares_*_chk).
  shareIds = [];
  for (let s = 0; s < SHARE_COUNT; s += 1) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO shares (sender_id, payload_kind, payload_snapshot)
       VALUES ($1, 'progress', '{}'::jsonb) RETURNING id`,
      [userIds[s % USER_COUNT]!],
    );
    shareIds.push(res.rows[0]!.id);
  }

  // Seed the deterministic share_recipients rows and record them.
  for (let s = 0; s < SHARE_COUNT; s += 1) {
    for (let u = 0; u < USER_COUNT; u += 1) {
      if (isRecipient(s, u)) {
        await pool.query(
          `INSERT INTO share_recipients (share_id, recipient_id) VALUES ($1, $2)`,
          [shareIds[s]!, userIds[u]!],
        );
        recipientPairs.add(pairKey(s, u));
      }
    }
  }
});

afterAll(async () => {
  await (pool as unknown as { end?: () => Promise<void> }).end?.();
});

beforeEach(async () => {
  await pool.query('DELETE FROM share_reactions');
});

/** Count reaction rows for a specific (share, recipient) pair. */
async function reactionCount(shareId: string, recipientId: string): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM share_reactions
      WHERE share_id = $1 AND recipient_id = $2`,
    [shareId, recipientId],
  );
  return Number(res.rows[0]!.n);
}

/** Count all reaction rows in the table. */
async function totalReactionCount(): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM share_reactions`,
  );
  return Number(res.rows[0]!.n);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const tripleArb = fc.record({
  shareIdx: fc.integer({ min: 0, max: SHARE_COUNT - 1 }),
  userIdx: fc.integer({ min: 0, max: USER_COUNT - 1 }),
  reaction: fc.constantFrom<ShareReactionValue>(...SHARE_REACTION_VALUES),
});

// ---------------------------------------------------------------------------
// Property 18
// ---------------------------------------------------------------------------

describe('Reaction_Service — Property 18: reacting to an undelivered share is rejected (R11.8)', () => {
  it('a non-recipient reaction is rejected with reaction_forbidden and persists nothing; a recipient reaction succeeds', async () => {
    const repo = createReactionsRepo(pool);

    await fc.assert(
      fc.asyncProperty(tripleArb, async ({ shareIdx, userIdx, reaction }) => {
        await pool.query('DELETE FROM share_reactions');

        const shareId = shareIds[shareIdx]!;
        const userId = userIds[userIdx]!;
        const delivered = recipientPairs.has(pairKey(shareIdx, userIdx));

        if (delivered) {
          // Recipient: the reaction is accepted and persisted exactly once.
          await expect(
            repo.upsertReaction(shareId, userId, reaction),
          ).resolves.toBeUndefined();
          expect(await reactionCount(shareId, userId)).toBe(1);
        } else {
          // Non-recipient: rejected with an authorization error, nothing
          // persisted anywhere (R11.8).
          const err = await repo
            .upsertReaction(shareId, userId, reaction)
            .then(
              () => {
                throw new Error('expected upsertReaction to reject');
              },
              (e: unknown) => e,
            );
          expect(err).toBeInstanceOf(AppError);
          expect((err as AppError).code).toBe('reaction_forbidden');
          expect(await totalReactionCount()).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------

describe('Reaction_Service — Property 18 fixed examples', () => {
  it('the sender reacting to their own share (not a recipient) is forbidden and persists nothing (R11.8)', async () => {
    const repo = createReactionsRepo(pool);
    // shareIds[0] was sent by userIds[0]; the sender is not a recipient.
    const shareId = shareIds[0]!;
    const senderId = userIds[0]!;
    expect(recipientPairs.has(pairKey(0, 0))).toBe(false);

    await expect(repo.upsertReaction(shareId, senderId, 'like')).rejects.toMatchObject(
      { code: 'reaction_forbidden' },
    );
    expect(await totalReactionCount()).toBe(0);
  });

  it('a delivered recipient can react (R11.1) — the authorization gate lets them through', async () => {
    const repo = createReactionsRepo(pool);
    // share 0 is delivered to user index 1 and 2 per isRecipient().
    const shareId = shareIds[0]!;
    const recipientId = userIds[1]!;

    await expect(
      repo.upsertReaction(shareId, recipientId, 'love'),
    ).resolves.toBeUndefined();
    expect(await reactionCount(shareId, recipientId)).toBe(1);
  });

  it('reacting to a nonexistent share is forbidden and persists nothing (R11.8)', async () => {
    const repo = createReactionsRepo(pool);
    const ghostShareId = randomUUID();

    await expect(
      repo.upsertReaction(ghostShareId, userIds[1]!, 'been_there'),
    ).rejects.toMatchObject({ code: 'reaction_forbidden' });
    expect(await totalReactionCount()).toBe(0);
  });
});
