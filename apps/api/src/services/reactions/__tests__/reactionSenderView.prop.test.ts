// Feature: social-sharing-loop, Property 19: Sender's reaction view lists every reaction with its reactor's display name
/**
 * Property-based test for the sender's reaction-view invariant (task 14.5).
 *
 * Validates: Requirements 11.7
 *
 * Property 19 (design.md -> Correctness Properties):
 *
 *   For any set of `Share_Reaction`s on a `Share` the sender sent, the
 *   sender's view lists each reaction paired with the reacting recipient's
 *   display name.
 *
 * Requirement 11.7:
 *   THE Reaction_Service view of a Share's reactions is gated to the Share's
 *   sender and returns each reaction with the reactor's display name.
 *
 * Test design (real engine + independent oracle)
 * ----------------------------------------------
 * The production `createReactionsRepo` factory (task 14.1) runs verbatim
 * against a real Postgres-style engine (`pg-mem`) with the canonical schema
 * migrations `0001_init.sql` (defines `users`, `profiles`, `shares`,
 * `share_recipients`) and `0011_social_sharing_loop.sql` (defines
 * `share_reactions`). This exercises the real `profiles` join and the
 * sender-gate that `listReactionsForSender` leans on:
 *
 *   SELECT r.reaction, r.recipient_id, p.display_name, r.updated_at
 *     FROM share_reactions r JOIN profiles p ON p.user_id = r.recipient_id
 *    WHERE r.share_id = $1
 *
 * A fixed fixture seeds one sender (with a profile), a pool of recipients
 * (each with a distinct profile display name), and several shares the sender
 * owns, each delivered to every recipient. The property then draws an
 * arbitrary sequence of reaction upserts across those (share, recipient)
 * pairs and builds an independent reference model — `Map<shareIdx,
 * Map<recipientIdx, reaction>>` applying last-write-wins to mirror the
 * upsert-replaces semantics (R11.5).
 *
 * After applying every upsert through the real repo, the test asserts, for
 * every sender-owned share:
 *
 *   (A) Exactly-one-per-reaction — `listReactionsForSender(share, sender)`
 *       returns exactly one entry per reaction in the model for that share,
 *       no more and no fewer (a set comparison keyed by reactorId).
 *
 *   (B) Correct display name — each returned entry carries the reactor's
 *       display name exactly as seeded in `profiles`, plus the correct
 *       reaction value and reactorId (R11.7).
 *
 *   (C) Sender-gating — every caller who is NOT the share's sender (each
 *       recipient, plus an unrelated stranger) is rejected with
 *       `reaction_forbidden`, so the view discloses nothing to non-senders.
 *
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHARE_REACTION_VALUES, type ShareReactionValue } from '@dwt/shared';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createReactionsRepo } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors reactionLifecycle.prop.test.ts / reactionAuthorization)
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
// Fixture — one sender (with profile), a pool of recipients (each with a
// distinct display name), and several sender-owned shares delivered to all.
// ---------------------------------------------------------------------------

const RECIPIENT_COUNT = 4;
const SHARE_COUNT = 3;

let db: IMemoryDb;
let pool: DbPool;
let senderId: string;
let strangerId: string;
let recipientIds: string[];
/** display name seeded for each recipient index, for oracle comparison. */
let recipientNames: string[];
let shareIds: string[];

async function seedUserWithProfile(displayName: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [`${randomUUID()}@example.test`, 'x'],
  );
  const id = res.rows[0]!.id;
  await pool.query(
    `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`,
    [id, displayName],
  );
  return id;
}

beforeAll(async () => {
  db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  pool = new Pool() as unknown as DbPool;

  applyMigration(db, '0001_init.sql');
  applyMigration(db, '0011_social_sharing_loop.sql');

  senderId = await seedUserWithProfile('Sender Sam');
  // A user with a profile who is neither the sender nor a recipient of any
  // share, to exercise the sender-gate for an unrelated caller (C).
  strangerId = await seedUserWithProfile('Stranger Stan');

  recipientIds = [];
  recipientNames = [];
  for (let i = 0; i < RECIPIENT_COUNT; i += 1) {
    // Distinct display names so a mismatched join surfaces immediately.
    const name = `Reactor #${i} ${randomUUID().slice(0, 8)}`;
    // eslint-disable-next-line no-await-in-loop
    const id = await seedUserWithProfile(name);
    recipientIds.push(id);
    recipientNames.push(name);
  }

  shareIds = [];
  for (let s = 0; s < SHARE_COUNT; s += 1) {
    // progress shares => experience_id stays NULL (no experiences seeding).
    // eslint-disable-next-line no-await-in-loop
    const res = await pool.query<{ id: string }>(
      `INSERT INTO shares (sender_id, payload_kind, payload_snapshot)
       VALUES ($1, 'progress', $2) RETURNING id`,
      [senderId, JSON.stringify({ overall: 0 })],
    );
    shareIds.push(res.rows[0]!.id);

    // Deliver each share to every recipient so all upserts are authorized.
    for (const recipientId of recipientIds) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `INSERT INTO share_recipients (share_id, recipient_id) VALUES ($1, $2)`,
        [shareIds[s]!, recipientId],
      );
    }
  }
});

afterAll(async () => {
  await (pool as unknown as { end?: () => Promise<void> }).end?.();
});

async function resetReactions(): Promise<void> {
  await pool.query('DELETE FROM share_reactions');
}

// ---------------------------------------------------------------------------
// Generators — a sequence of upserts across (share, recipient) pairs.
// ---------------------------------------------------------------------------

interface Upsert {
  readonly shareIdx: number;
  readonly recipientIdx: number;
  readonly reaction: ShareReactionValue;
}

const upsertArb: fc.Arbitrary<Upsert> = fc.record({
  shareIdx: fc.integer({ min: 0, max: SHARE_COUNT - 1 }),
  recipientIdx: fc.integer({ min: 0, max: RECIPIENT_COUNT - 1 }),
  reaction: fc.constantFrom<ShareReactionValue>(...SHARE_REACTION_VALUES),
});

const sequenceArb = fc.array(upsertArb, { minLength: 0, maxLength: 20 });

// ---------------------------------------------------------------------------
// Property 19
// ---------------------------------------------------------------------------

describe("Reaction_Service — Property 19: sender's reaction view lists every reaction with its reactor's display name (R11.7)", () => {
  it('lists exactly one entry per reaction with the correct display name; non-senders are rejected', async () => {
    const repo = createReactionsRepo(pool);

    await fc.assert(
      fc.asyncProperty(sequenceArb, async (ops) => {
        await resetReactions();

        // Independent reference model: shareIdx -> (recipientIdx -> reaction),
        // last-write-wins to mirror upsert-replaces (R11.5).
        const model = new Map<number, Map<number, ShareReactionValue>>();
        for (let s = 0; s < SHARE_COUNT; s += 1) model.set(s, new Map());

        for (const op of ops) {
          // eslint-disable-next-line no-await-in-loop
          await repo.upsertReaction(
            shareIds[op.shareIdx]!,
            recipientIds[op.recipientIdx]!,
            op.reaction,
          );
          model.get(op.shareIdx)!.set(op.recipientIdx, op.reaction);
        }

        for (let s = 0; s < SHARE_COUNT; s += 1) {
          // (A) + (B) sender's view matches the model exactly.
          // eslint-disable-next-line no-await-in-loop
          const view = await repo.listReactionsForSender(shareIds[s]!, senderId);

          const expected = [...model.get(s)!.entries()].map(
            ([recipientIdx, reaction]) => ({
              reaction,
              reactorId: recipientIds[recipientIdx]!,
              reactorDisplayName: recipientNames[recipientIdx]!,
            }),
          );

          // (A) exactly one entry per reaction — no duplicates, no omissions.
          expect(view).toHaveLength(expected.length);
          const seenReactors = new Set(view.map((e) => e.reactorId));
          expect(seenReactors.size).toBe(view.length);

          // (B) each entry carries the correct reaction, reactorId, and the
          //     reactor's seeded display name (R11.7).
          const actualByReactor = new Map(
            view.map((e) => [
              e.reactorId,
              {
                reaction: e.reaction,
                reactorId: e.reactorId,
                reactorDisplayName: e.reactorDisplayName,
              },
            ]),
          );
          for (const exp of expected) {
            expect(actualByReactor.get(exp.reactorId)).toEqual(exp);
          }

          // Every returned entry also carries a valid ISO reactedAt timestamp.
          for (const entry of view) {
            expect(Number.isNaN(Date.parse(entry.reactedAt))).toBe(false);
          }
        }

        // (C) sender-gating: no non-sender may read the view (R11.7).
        const nonSenders = [strangerId, ...recipientIds];
        for (const share of shareIds) {
          for (const caller of nonSenders) {
            // eslint-disable-next-line no-await-in-loop
            const err = await repo.listReactionsForSender(share, caller).then(
              () => {
                throw new Error('expected listReactionsForSender to reject');
              },
              (e: unknown) => e,
            );
            expect(err).toBeInstanceOf(AppError);
            expect((err as AppError).code).toBe('reaction_forbidden');
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------

describe("Reaction_Service — Property 19 fixed examples", () => {
  it('lists every reactor with the display name joined from profiles (R11.7)', async () => {
    const repo = createReactionsRepo(pool);
    await resetReactions();

    const share = shareIds[0]!;
    await repo.upsertReaction(share, recipientIds[0]!, 'like');
    await repo.upsertReaction(share, recipientIds[2]!, 'love');

    const view = await repo.listReactionsForSender(share, senderId);
    expect(view).toHaveLength(2);

    const byReactor = new Map(view.map((e) => [e.reactorId, e]));
    expect(byReactor.get(recipientIds[0]!)?.reaction).toBe('like');
    expect(byReactor.get(recipientIds[0]!)?.reactorDisplayName).toBe(
      recipientNames[0],
    );
    expect(byReactor.get(recipientIds[2]!)?.reaction).toBe('love');
    expect(byReactor.get(recipientIds[2]!)?.reactorDisplayName).toBe(
      recipientNames[2],
    );
  });

  it('a resubmitted reaction is listed once with its replaced value (R11.5, R11.7)', async () => {
    const repo = createReactionsRepo(pool);
    await resetReactions();

    const share = shareIds[0]!;
    await repo.upsertReaction(share, recipientIds[1]!, 'like');
    await repo.upsertReaction(share, recipientIds[1]!, 'want_to_go');

    const view = await repo.listReactionsForSender(share, senderId);
    expect(view).toHaveLength(1);
    expect(view[0]!.reaction).toBe('want_to_go');
    expect(view[0]!.reactorDisplayName).toBe(recipientNames[1]);
  });

  it('a recipient (non-sender) cannot read the sender view (R11.7)', async () => {
    const repo = createReactionsRepo(pool);
    await resetReactions();

    await repo.upsertReaction(shareIds[0]!, recipientIds[0]!, 'like');

    await expect(
      repo.listReactionsForSender(shareIds[0]!, recipientIds[0]!),
    ).rejects.toMatchObject({ code: 'reaction_forbidden' });
  });

  it('an empty share (no reactions) returns an empty list to its sender', async () => {
    const repo = createReactionsRepo(pool);
    await resetReactions();

    const view = await repo.listReactionsForSender(shareIds[1]!, senderId);
    expect(view).toEqual([]);
  });
});
