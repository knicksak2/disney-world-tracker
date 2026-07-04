// Feature: social-sharing-loop, Property 17: Reaction lifecycle maintains at most one reaction per share per recipient
/**
 * Property-based test for the reaction lifecycle invariant (task 14.3).
 *
 * Validates: Requirements 11.1, 11.4, 11.5, 11.6
 *
 * Property 17 (design.md -> Correctness Properties):
 *
 *   For any sequence of submit and remove operations by a recipient on a
 *   `Share` delivered to them, at most one `Share_Reaction` exists for that
 *   `(Share, recipient)`; a resubmission replaces the prior reaction with the
 *   submitted value, and a removal leaves no reaction.
 *
 * Test design (real engine + independent oracle)
 * ----------------------------------------------
 * The production `createReactionsRepo` factory (task 14.1) runs verbatim
 * against a real Postgres-style engine (`pg-mem`) with the canonical schema
 * migrations `0001_init.sql` + `0011_social_sharing_loop.sql` applied. This
 * exercises the real constraint the invariant leans on:
 *
 *   PRIMARY KEY (share_id, recipient_id)   — at most one reaction per
 *                                            (share, recipient) (R11.4).
 *
 * `upsertReaction`'s `INSERT ... ON CONFLICT (share_id, recipient_id) DO
 * UPDATE` therefore persists the recipient's single reaction (R11.1),
 * replacing any prior value on resubmit (R11.5); `deleteReaction` removes it
 * (R11.6).
 *
 * For any generated sequence of upsert/delete operations drawn from a small
 * pool of (share, recipient) pairs and vocabulary reaction values (so
 * replacements and deletes actually collide on the same key), the test checks,
 * AFTER EVERY STEP, three things:
 *
 *   (A) At-most-one — the DB never holds more than one reaction row for any
 *       (share, recipient) key (R11.4). The composite PK guarantees this; we
 *       assert it holds observably.
 *
 *   (B) Replacement / removal — an independent reference model that mirrors
 *       the upsert/delete semantics (a Map keyed by (share, recipient) ->
 *       reaction) reproduces the exact reaction present for the key the step
 *       touched: the last-submitted value after an upsert (R11.1, R11.5), and
 *       nothing after a delete (R11.6).
 *
 *   (C) Completeness — the full set of reaction rows in the DB equals the
 *       model's set at every step, so (A)+(B) are not vacuously satisfied by
 *       missing or stray rows.
 *
 * All operations target shares that were delivered to the acting recipient
 * (a `share_recipients` row is seeded), so `upsertReaction`'s authorization
 * gate always admits the write — the undelivered-share rejection is Property
 * 18's concern (task 14.4), not this one.
 *
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ShareReactionValue } from '@dwt/shared';
import { SHARE_REACTION_VALUES } from '@dwt/shared';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { createReactionsRepo } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors pushOwnership.prop.test.ts / migration0009.test.ts)
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
// Reference model — mirrors upsert/delete semantics
// ---------------------------------------------------------------------------

type OpKind = 'upsert' | 'delete';

interface Op {
  readonly kind: OpKind;
  readonly shareId: string;
  readonly recipientId: string;
  readonly reaction: ShareReactionValue; // ignored for 'delete'
}

interface ReactionRow {
  readonly shareId: string;
  readonly recipientId: string;
  readonly reaction: ShareReactionValue;
}

const NUL = '\u0000';
const key = (shareId: string, recipientId: string): string =>
  `${shareId}${NUL}${recipientId}`;

const sortRows = (rows: readonly ReactionRow[]): ReactionRow[] =>
  [...rows].sort((a, b) =>
    key(a.shareId, a.recipientId).localeCompare(key(b.shareId, b.recipientId)),
  );

// ---------------------------------------------------------------------------
// Fixture — a small fixed pool of delivered (share, recipient) pairs
// ---------------------------------------------------------------------------

const SHARE_COUNT = 3;
const RECIPIENT_COUNT = 3;

let db: IMemoryDb;
let pool: DbPool;
let shareIds: string[];
let recipientIds: string[];
/** The (share, recipient) pairs that were actually delivered (seeded). */
let deliveredPairs: Array<{ shareId: string; recipientId: string }>;

beforeAll(async () => {
  db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  pool = new Pool() as unknown as DbPool;

  applyMigration(db, '0001_init.sql');
  applyMigration(db, '0011_social_sharing_loop.sql');

  // A dedicated sender owns every share; each share is a `progress` share so
  // experience_id stays NULL (no experiences table seeding needed).
  const senderRes = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [`${randomUUID()}@example.test`, 'x'],
  );
  const senderId = senderRes.rows[0]!.id;

  recipientIds = [];
  for (let i = 0; i < RECIPIENT_COUNT; i += 1) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [`${randomUUID()}@example.test`, 'x'],
    );
    recipientIds.push(res.rows[0]!.id);
  }

  shareIds = [];
  for (let i = 0; i < SHARE_COUNT; i += 1) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO shares (sender_id, payload_kind, payload_snapshot)
       VALUES ($1, 'progress', $2) RETURNING id`,
      [senderId, JSON.stringify({ overall: 0 })],
    );
    shareIds.push(res.rows[0]!.id);
  }

  // Deliver every share to every recipient so all generated ops are authorized.
  deliveredPairs = [];
  for (const shareId of shareIds) {
    for (const recipientId of recipientIds) {
      await pool.query(
        `INSERT INTO share_recipients (share_id, recipient_id) VALUES ($1, $2)`,
        [shareId, recipientId],
      );
      deliveredPairs.push({ shareId, recipientId });
    }
  }
});

afterAll(async () => {
  await (pool as unknown as { end?: () => Promise<void> }).end?.();
});

async function resetReactions(): Promise<void> {
  await pool.query('DELETE FROM share_reactions');
}

/** Read the current reaction rows straight from the table. */
async function readReactionRows(): Promise<ReactionRow[]> {
  const res = await pool.query<{
    share_id: string;
    recipient_id: string;
    reaction: ShareReactionValue;
  }>(`SELECT share_id, recipient_id, reaction FROM share_reactions`);
  return res.rows.map((r) => ({
    shareId: r.share_id,
    recipientId: r.recipient_id,
    reaction: r.reaction,
  }));
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const opArb = (): fc.Arbitrary<Op> =>
  fc.record({
    kind: fc.constantFrom<OpKind>('upsert', 'delete'),
    pairIndex: fc.integer({ min: 0, max: SHARE_COUNT * RECIPIENT_COUNT - 1 }),
    reaction: fc.constantFrom<ShareReactionValue>(...SHARE_REACTION_VALUES),
  }).map(({ kind, pairIndex, reaction }) => {
    const pair = deliveredPairs[pairIndex]!;
    return { kind, shareId: pair.shareId, recipientId: pair.recipientId, reaction };
  });

const sequenceArb = fc.array(opArb(), { minLength: 1, maxLength: 16 });

// ---------------------------------------------------------------------------
// Property 17
// ---------------------------------------------------------------------------

describe('Reaction_Service — Property 17: lifecycle keeps at most one reaction per (share, recipient)', () => {
  it('any upsert/delete sequence keeps <=1 reaction per key; resubmit replaces, delete removes', async () => {
    const repo = createReactionsRepo(pool);

    await fc.assert(
      fc.asyncProperty(sequenceArb, async (ops) => {
        await resetReactions();

        // Independent reference model: (share, recipient) -> reaction value.
        const model = new Map<string, ShareReactionValue>();

        for (const op of ops) {
          const k = key(op.shareId, op.recipientId);

          if (op.kind === 'upsert') {
            await repo.upsertReaction(op.shareId, op.recipientId, op.reaction);
            model.set(k, op.reaction); // insert-or-replace (R11.1, R11.5)
          } else {
            await repo.deleteReaction(op.shareId, op.recipientId);
            model.delete(k); // removal leaves no reaction (R11.6)
          }

          const rows = await readReactionRows();

          // (A) At-most-one reaction per (share, recipient) key (R11.4).
          const seen = new Set<string>();
          for (const row of rows) {
            const rk = key(row.shareId, row.recipientId);
            expect(seen.has(rk), `duplicate reaction row for key ${rk}`).toBe(
              false,
            );
            seen.add(rk);
          }

          // (B) The key the step touched reflects the operation exactly.
          const touched = rows.find(
            (r) => key(r.shareId, r.recipientId) === k,
          );
          if (op.kind === 'upsert') {
            // Replacement / insert: the stored value is the submitted value.
            expect(touched?.reaction).toBe(op.reaction);
          } else {
            // Removal: no row remains for the key.
            expect(touched).toBeUndefined();
          }

          // (C) Completeness: DB row set equals the model at every step.
          const expected: ReactionRow[] = [...model.entries()].map(([mk, reaction]) => {
            const [shareId, recipientId] = mk.split(NUL);
            return { shareId: shareId!, recipientId: recipientId!, reaction };
          });
          expect(sortRows(rows)).toEqual(sortRows(expected));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------

describe('Reaction_Service — Property 17 fixed examples', () => {
  it('resubmitting a reaction replaces the prior value, keeping one row (R11.4, R11.5)', async () => {
    const repo = createReactionsRepo(pool);
    await resetReactions();

    const { shareId, recipientId } = deliveredPairs[0]!;
    await repo.upsertReaction(shareId, recipientId, 'like');
    await repo.upsertReaction(shareId, recipientId, 'love');

    const rows = await readReactionRows();
    const forPair = rows.filter(
      (r) => r.shareId === shareId && r.recipientId === recipientId,
    );
    expect(forPair).toHaveLength(1);
    expect(forPair[0]!.reaction).toBe('love');
  });

  it('deleting an existing reaction leaves no reaction for the key (R11.6)', async () => {
    const repo = createReactionsRepo(pool);
    await resetReactions();

    const { shareId, recipientId } = deliveredPairs[0]!;
    await repo.upsertReaction(shareId, recipientId, 'been_there');
    const removed = await repo.deleteReaction(shareId, recipientId);
    expect(removed).toBe(true);

    const rows = await readReactionRows();
    expect(
      rows.some((r) => r.shareId === shareId && r.recipientId === recipientId),
    ).toBe(false);
  });

  it('deleting a non-existent reaction is a no-op that removes nothing (R11.6)', async () => {
    const repo = createReactionsRepo(pool);
    await resetReactions();

    const { shareId, recipientId } = deliveredPairs[0]!;
    const removed = await repo.deleteReaction(shareId, recipientId);
    expect(removed).toBe(false);
    expect(await readReactionRows()).toHaveLength(0);
  });
});
