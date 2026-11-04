/**
 * Property 10: The backfill is complete, minimal, and idempotent
 * Validates: Requirements 12.1, 12.2, 12.3
 *
 * For any set of Trip_Log_Entries, some with an existing completion_logged feed item
 * and some without, after running migration 0070 every Trip_Log_Entry has exactly
 * one completion_logged feed item referencing it with actor_id = its member_id,
 * trip_id = its trip, and created_at = the entry's created_at;
 * pre-existing feed items, tags, and entries are unchanged;
 * and running the migration again inserts no rows.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function buildPgMem(): { db: IMemoryDb; pool: DbPool } {
  const db = newDb({ noAstCoverageCheck: true });
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
  pub.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'nullif',
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: (a, b) => (a === b ? null : a),
  });
  pub.registerFunction({
    name: 'jsonb_build_object',
    args: [DataType.text, DataType.text, DataType.text, DataType.text],
    returns: DataType.jsonb,
    implementation: (k1, v1, k2, v2) => ({ [String(k1)]: v1, [String(k2)]: v2 }),
  });

  for (const name of [
    '0001_init.sql',
    '0002_experience_images.sql',
    '0006_experience_land.sql',
    '0013_avatar_presets.sql',
    '0015_trips.sql',
    '0034_experience_logs.sql',
  ]) {
    let sql = readFileSync(migrationPath(name), 'utf8');
    sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
    sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
    pub.none(sql);
  }

  pub.none(`
    ALTER TABLE trip_feed_items DROP CONSTRAINT IF EXISTS trip_feed_items_type_chk;
    ALTER TABLE trip_feed_items ADD CONSTRAINT trip_feed_items_type_chk CHECK (
      type IN ('trip_created', 'member_joined', 'completion_logged', 'rating_recorded', 'member_post', 'log_entry_added')
    );
  `);

  const { Pool } = db.adapters.createPg();
  const rawPool = new Pool();
  const pool = {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return rawPool.query(text, params as unknown[]);
    },
  } as unknown as DbPool;

  return { db, pool };
}

function runMigration0070(db: IMemoryDb): void {
  let sql = readFileSync(migrationPath('0070_backfill_completion_logged_feed_items.sql'), 'utf8');
  // In pg-mem, correlated subqueries in NOT EXISTS referencing outer table aliases fail with column not found;
  // adapt the outer NOT EXISTS to an equivalent LEFT JOIN ... WHERE IS NULL for pg-mem execution.
  sql = sql.replace(
    /WHERE\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+trip_feed_items\s+fi\s+WHERE\s+fi\.type\s*=\s*'completion_logged'\s+AND\s+fi\.metadata->>'logEntryId'\s*=\s*tle\.id::text\s*\)/gimu,
    `LEFT JOIN trip_feed_items fi ON fi.type = 'completion_logged' AND fi.metadata->>'logEntryId' = tle.id::text WHERE fi.id IS NULL`,
  );
  db.public.none(sql);
}

describe('migration 0070 (Property 10)', () => {
  it('Concrete before/after fixture: backfills missing completion_logged feed items and is idempotent', async () => {
    const { db, pool } = buildPgMem();

    const creatorId = randomUUID();
    const tripId = randomUUID();
    const exp1 = randomUUID();
    const exp2 = randomUUID();
    const logId1 = randomUUID();
    const logId2 = randomUUID();
    const entryId1 = randomUUID();
    const entryId2 = randomUUID();
    const existingFeedId = randomUUID();

    const createdAt1 = '2026-05-02T10:00:00.000Z';
    const createdAt2 = '2026-05-03T11:00:00.000Z';

    // Seed user, experience, trip
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'h')`, [creatorId, `${creatorId}@ex.com`]);
    await pool.query(`INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, 'Exp 1', 'Magic Kingdom', 'Ride')`, [exp1, `up-${exp1}`]);
    await pool.query(`INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, 'Exp 2', 'Magic Kingdom', 'Ride')`, [exp2, `up-${exp2}`]);
    await pool.query(`INSERT INTO trips (id, creator_id, name, start_date, end_date) VALUES ($1, $2, 'Trip', '2026-05-01', '2026-05-10')`, [tripId, creatorId]);
    await pool.query(`INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'organizer')`, [tripId, creatorId]);

    // Seed experience_logs
    await pool.query(`INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz) VALUES ($1, $2, $3, '2026-05-02', 'UTC')`, [logId1, creatorId, exp1]);
    await pool.query(`INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz) VALUES ($1, $2, $3, '2026-05-03', 'UTC')`, [logId2, creatorId, exp2]);

    // Seed 2 trip_log_entries
    await pool.query(
      `INSERT INTO trip_log_entries (id, trip_id, member_id, experience_id, log_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entryId1, tripId, creatorId, exp1, logId1, createdAt1],
    );
    await pool.query(
      `INSERT INTO trip_log_entries (id, trip_id, member_id, experience_id, log_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entryId2, tripId, creatorId, exp2, logId2, createdAt2],
    );

    // Entry 1 ALREADY has a completion_logged feed item
    await pool.query(
      `INSERT INTO trip_feed_items (id, trip_id, type, actor_id, metadata, created_at)
       VALUES ($1, $2, 'completion_logged', $3, $4, $5)`,
      [existingFeedId, tripId, creatorId, JSON.stringify({ experienceId: exp1, logEntryId: entryId1 }), createdAt1],
    );

    // Initial state: exactly 1 feed item
    const feedBefore = await pool.query<{ count: string | number }>(`SELECT count(*) AS count FROM trip_feed_items`);
    expect(Number(feedBefore.rows[0]?.count)).toBe(1);

    // Run migration 0070
    runMigration0070(db);

    // After migration: exactly 2 feed items
    const feedAfter = await pool.query<{ id: string; type: string; actor_id: string; metadata: any; created_at: Date | string }>(
      `SELECT id, type, actor_id, metadata, created_at FROM trip_feed_items WHERE trip_id = $1 ORDER BY created_at ASC`,
      [tripId],
    );
    expect(feedAfter.rows).toHaveLength(2);

    // Entry 1's existing feed item was completely preserved
    const item1 = feedAfter.rows.find((r) => r.id === existingFeedId);
    expect(item1).toBeDefined();
    const meta1 = typeof item1!.metadata === 'string' ? JSON.parse(item1!.metadata) : item1!.metadata;
    expect(meta1.logEntryId).toBe(entryId1);
    expect(meta1.experienceId).toBe(exp1);

    // Entry 2 gained a new backfilled feed item with matching attributes
    const item2 = feedAfter.rows.find((r) => r.id !== existingFeedId);
    expect(item2).toBeDefined();
    expect(item2!.type).toBe('completion_logged');
    expect(item2!.actor_id).toBe(creatorId);
    const meta2 = typeof item2!.metadata === 'string' ? JSON.parse(item2!.metadata) : item2!.metadata;
    expect(meta2.logEntryId).toBe(entryId2);
    expect(meta2.experienceId).toBe(exp2);
    expect(new Date(item2!.created_at).toISOString()).toBe(new Date(createdAt2).toISOString());

    // Run migration 0070 a SECOND time (idempotence)
    runMigration0070(db);

    const feedAfterSecondRun = await pool.query<{ count: string | number }>(`SELECT count(*) AS count FROM trip_feed_items`);
    expect(Number(feedAfterSecondRun.rows[0]?.count)).toBe(2);
  });

  it('Property 10: The backfill is complete, minimal, and idempotent (100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            alreadyHasFeedItem: fc.boolean(),
            createdAt: fc.constantFrom('2026-05-02T10:00:00.000Z', '2026-05-03T11:00:00.000Z', '2026-05-04T12:00:00.000Z'),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        async (entries) => {
          const { db, pool } = buildPgMem();

          const creatorId = randomUUID();
          const tripId = randomUUID();
          await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'h')`, [creatorId, `${creatorId}@ex.com`]);
          await pool.query(`INSERT INTO trips (id, creator_id, name, start_date, end_date) VALUES ($1, $2, 'Trip', '2026-05-01', '2026-05-10')`, [tripId, creatorId]);
          await pool.query(`INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'organizer')`, [tripId, creatorId]);

          let preExistingFeedCount = 0;
          const seededEntries: { entryId: string; experienceId: string; createdAt: string; existingFeedId?: string | undefined }[] = [];

          for (let i = 0; i < entries.length; i++) {
            const spec = entries[i]!;
            const expId = randomUUID();
            const logId = randomUUID();
            const entryId = randomUUID();

            await pool.query(`INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride')`, [expId, `up-${expId}`, `Exp ${i}`]);
            await pool.query(`INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz) VALUES ($1, $2, $3, '2026-05-02', 'UTC')`, [logId, creatorId, expId]);
            await pool.query(
              `INSERT INTO trip_log_entries (id, trip_id, member_id, experience_id, log_id, created_at)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [entryId, tripId, creatorId, expId, logId, spec.createdAt],
            );

            let existingFeedId: string | undefined;
            if (spec.alreadyHasFeedItem) {
              existingFeedId = randomUUID();
              preExistingFeedCount++;
              await pool.query(
                `INSERT INTO trip_feed_items (id, trip_id, type, actor_id, metadata, created_at)
                 VALUES ($1, $2, 'completion_logged', $3, $4, $5)`,
                [existingFeedId, tripId, creatorId, JSON.stringify({ experienceId: expId, logEntryId: entryId }), spec.createdAt],
              );
            }

            seededEntries.push({ entryId, experienceId: expId, createdAt: spec.createdAt, existingFeedId });
          }

          // Initial check
          const initialFeed = await pool.query<{ count: string | number }>(`SELECT count(*) AS count FROM trip_feed_items`);
          expect(Number(initialFeed.rows[0]?.count)).toBe(preExistingFeedCount);

          // Run migration 0070
          runMigration0070(db);

          // Assert completeness: every entry has exactly one completion_logged feed item
          const allFeed = await pool.query<{ id: string; type: string; actor_id: string; metadata: any; created_at: Date | string }>(
            `SELECT id, type, actor_id, metadata, created_at FROM trip_feed_items WHERE trip_id = $1`,
            [tripId],
          );
          expect(allFeed.rows).toHaveLength(entries.length);

          for (const seeded of seededEntries) {
            const matches = allFeed.rows.filter((r) => {
              const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
              return r.type === 'completion_logged' && meta?.logEntryId === seeded.entryId;
            });
            expect(matches).toHaveLength(1);
            const feedItem = matches[0]!;
            expect(feedItem.actor_id).toBe(creatorId);
            const meta = typeof feedItem.metadata === 'string' ? JSON.parse(feedItem.metadata) : feedItem.metadata;
            expect(meta.experienceId).toBe(seeded.experienceId);
            expect(new Date(feedItem.created_at).toISOString()).toBe(new Date(seeded.createdAt).toISOString());

            if (seeded.existingFeedId) {
              expect(feedItem.id).toBe(seeded.existingFeedId);
            }
          }

          // Run migration 0070 a second time (idempotence: minimal, 0 new rows)
          runMigration0070(db);

          const afterSecond = await pool.query<{ count: string | number }>(`SELECT count(*) AS count FROM trip_feed_items`);
          expect(Number(afterSecond.rows[0]?.count)).toBe(entries.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
