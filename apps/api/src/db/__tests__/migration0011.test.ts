/**
 * Migration test for `0011_social_sharing_loop.sql` (Social Sharing Loop, Phase 2).
 *
 * Applies the initial schema (0001_init.sql — the only migration that creates
 * the FK targets 0011 references: `users` and `shares`) to a fresh pg-mem
 * database, then applies 0011 on top and asserts the migration's strictly
 * additive contract holds:
 *
 *   - all three new tables are created —
 *       `push_registrations`, `notification_preferences`, and `share_reactions`;
 *   - `push_registrations.expo_push_token` is globally UNIQUE, so a physical
 *     token belongs to at most one User at a time (R8.3);
 *   - `share_reactions` is keyed by the composite PRIMARY KEY
 *     `(share_id, recipient_id)`, so there is at most one reaction per
 *     (share, recipient) (R11.4);
 *   - `share_reactions.reaction` is guarded by a CHECK constraint restricting
 *     the value to the closed Reaction_Vocabulary
 *     (`like` / `love` / `been_there` / `want_to_go`) (R11.3, and the R11.4
 *     value guard referenced by the task).
 *
 * The UNIQUE / PRIMARY KEY / CHECK guards are exercised behaviorally — a second
 * registration reusing a physical token collides, a second reaction for the
 * same (share, recipient) collides, and an out-of-vocabulary reaction is
 * rejected — so each guard is observable at the storage layer rather than
 * merely inferred from the DDL text.
 *
 * Mirrors the pg-mem setup used by `migration0009.test.ts` (extensions/functions
 * registered, GIN trigram indexes stripped because pg-mem lacks the
 * `gin_trgm_ops` operator class). Unrelated intermediate migrations (0002–0010)
 * are omitted because none of them create a table, column, or constraint that
 * 0011 depends on — the same focused-chain rationale used by the 0009 test.
 *
 * Validates: Requirements 8.3, 11.4
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors migration0009.test.ts)
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
    implementation: (s: unknown): number =>
      typeof s === 'string' ? s.length : 0,
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
  // __tests__ → db → src → apps/api
  return resolve(here, '..', '..', '..', 'migrations', name);
}

/** Apply a migration file, stripping GIN trigram indexes pg-mem can't model. */
function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

/**
 * The only migration applied before 0011: 0001_init.sql creates `users` and
 * `shares`, the two FK targets that 0011's new tables reference. Every
 * migration between (0002–0010) is additive to unrelated tables and is omitted
 * to keep the schema focused on what 0011 touches (see the 0009 test for the
 * same rationale).
 */
const BASE_MIGRATIONS = ['0001_init.sql'];

const MIGRATION_0011 = '0011_social_sharing_loop.sql';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

/** Insert one User row (FK target for user_id / recipient_id). */
async function seedUser(pool: Pool, id: string, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
    [id, email, 'argon2id$seeded'],
  );
}

/** Insert one progress Share row (experience_id NULL, FK target for share_id). */
async function seedProgressShare(
  pool: Pool,
  id: string,
  senderId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO shares (id, sender_id, experience_id, payload_kind, payload_snapshot)
     VALUES ($1, $2, NULL, 'progress', $3)`,
    [id, senderId, '{}'],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migration 0011_social_sharing_loop (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }

    // Apply the migration under test on top of the initial schema.
    applyMigration(db, MIGRATION_0011);
  });

  it('creates the push_registrations, notification_preferences, and share_reactions tables', () => {
    // getTable throws if the table is absent, so a successful lookup proves creation.
    expect(db.getTable('push_registrations')).toBeDefined();
    expect(db.getTable('notification_preferences')).toBeDefined();
    expect(db.getTable('share_reactions')).toBeDefined();

    const pushColumns = [...db.getTable('push_registrations').getColumns()].map(
      (c) => c.name,
    );
    expect(pushColumns).toEqual(
      expect.arrayContaining([
        'id',
        'user_id',
        'device_id',
        'expo_push_token',
        'status',
      ]),
    );

    const reactionColumns = [...db.getTable('share_reactions').getColumns()].map(
      (c) => c.name,
    );
    expect(reactionColumns).toEqual(
      expect.arrayContaining(['share_id', 'recipient_id', 'reaction']),
    );
  });

  it('enforces a globally UNIQUE expo_push_token (a token belongs to at most one user)', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    await seedUser(pool, userA, 'a@example.com');
    await seedUser(pool, userB, 'b@example.com');

    const sharedToken = 'ExponentPushToken[shared-physical-token]';

    // First registration claims the physical token.
    await pool.query(
      `INSERT INTO push_registrations (user_id, device_id, expo_push_token)
       VALUES ($1, $2, $3)`,
      [userA, 'device-a', sharedToken],
    );

    // A second registration reusing the SAME physical token must collide,
    // regardless of which user or device presents it.
    await expect(
      pool.query(
        `INSERT INTO push_registrations (user_id, device_id, expo_push_token)
         VALUES ($1, $2, $3)`,
        [userB, 'device-b', sharedToken],
      ),
    ).rejects.toThrow();
  });

  it('enforces the (share_id, recipient_id) composite PRIMARY KEY on share_reactions', async () => {
    const sender = randomUUID();
    const recipient = randomUUID();
    await seedUser(pool, sender, 'sender@example.com');
    await seedUser(pool, recipient, 'recipient@example.com');

    const shareId = randomUUID();
    await seedProgressShare(pool, shareId, sender);

    // First reaction for (share, recipient) is accepted.
    await pool.query(
      `INSERT INTO share_reactions (share_id, recipient_id, reaction)
       VALUES ($1, $2, 'like')`,
      [shareId, recipient],
    );

    // A second reaction row for the SAME (share, recipient) must collide on the PK.
    await expect(
      pool.query(
        `INSERT INTO share_reactions (share_id, recipient_id, reaction)
         VALUES ($1, $2, 'love')`,
        [shareId, recipient],
      ),
    ).rejects.toThrow();
  });

  it('accepts every Reaction_Vocabulary value and rejects any value outside it (CHECK)', async () => {
    const sender = randomUUID();
    await seedUser(pool, sender, 'vocab-sender@example.com');

    const vocabulary = ['like', 'love', 'been_there', 'want_to_go'] as const;

    // Each vocabulary value is accepted (one distinct recipient per value so the
    // composite PK never interferes with the CHECK we are exercising).
    for (const reaction of vocabulary) {
      const recipient = randomUUID();
      const shareId = randomUUID();
      await seedUser(pool, recipient, `recipient-${reaction}@example.com`);
      await seedProgressShare(pool, shareId, sender);

      await expect(
        pool.query(
          `INSERT INTO share_reactions (share_id, recipient_id, reaction)
           VALUES ($1, $2, $3)`,
          [shareId, recipient, reaction],
        ),
      ).resolves.toBeDefined();
    }

    // A value outside the closed vocabulary must be rejected by the CHECK.
    const badRecipient = randomUUID();
    const badShareId = randomUUID();
    await seedUser(pool, badRecipient, 'bad@example.com');
    await seedProgressShare(pool, badShareId, sender);

    await expect(
      pool.query(
        `INSERT INTO share_reactions (share_id, recipient_id, reaction)
         VALUES ($1, $2, $3)`,
        [badShareId, badRecipient, 'thumbs_down'],
      ),
    ).rejects.toThrow();
  });
});
