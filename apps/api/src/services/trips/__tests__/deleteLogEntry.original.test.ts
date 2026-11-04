/**
 * Tests for the original deleteLogEntry behavior and completion_logged feed item mine flag
 * against the restored TripRepo implementation.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createCompletionRepo } from '../../tracking/completion/repo.js';
import { createRatingRepo } from '../../tracking/rating/repo.js';
import { createTripRepo, type TripRepo } from '../repo.js';

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
  pub.registerFunction({
    name: 'json_build_object',
    args: [DataType.text, DataType.text, DataType.text, DataType.text, DataType.text, DataType.text, DataType.text, DataType.uuid],
    returns: DataType.json,
    allowNullArguments: true,
    implementation: (k1, v1, k2, v2, k3, v3, k4, v4) => ({
      [String(k1)]: v1,
      [String(k2)]: v2,
      [String(k3)]: v3,
      [String(k4)]: v4 ?? null,
    }),
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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_state text NOT NULL DEFAULT 'active';
  `);

  pub.none(`
    ALTER TABLE trip_feed_items DROP CONSTRAINT IF EXISTS trip_feed_items_type_chk;
    ALTER TABLE trip_feed_items ADD CONSTRAINT trip_feed_items_type_chk CHECK (
      type IN ('trip_created', 'member_joined', 'completion_logged', 'rating_recorded', 'member_post', 'log_entry_added')
    );
  `);

  pub.none(`
    CREATE OR REPLACE VIEW profile_identity AS
    SELECT p.user_id,
           p.user_id AS public_id,
           p.display_name,
           p.avatar_preset,
           true AS is_visible
      FROM profiles p;
  `);

  const { Pool } = db.adapters.createPg();
  const rawPool = new Pool();

  const pool = {
    async query(text: string, params?: ReadonlyArray<unknown>) {
      const isFeedMain = text.includes('FROM trip_feed_items fi') && text.includes('rode_with_tags rwt');
      if (isFeedMain) {
        const adaptedText = text
          .replace(/\(SELECT count\(\*\)::int\s+FROM rode_with_tags rwt[\s\S]+?WHERE[^\)]+\)/giu, '0')
          .replace(/\(SELECT json_agg\([\s\S]+?WHERE rwt\.log_entry_id = le\.id\)/giu, 'NULL');
        const res = await rawPool.query(adaptedText, params as unknown[]);
        return res;
      }

      const stripped = text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
      return rawPool.query(stripped, params as unknown[]);
    },
    async connect() {
      const client = await rawPool.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          let stripped = text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
          if (stripped.includes('= ANY($1)') && Array.isArray(params?.[0])) {
            const ids = (params[0] as string[]).map((id) => `'${id}'`).join(', ');
            stripped = stripped.replace(/=\s*ANY\(\$1\)/giu, `IN (${ids.length > 0 ? ids : 'NULL'})`);
            return client.query(stripped);
          }
          return client.query(stripped, params as unknown[]);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;

  return { db, pool };
}

interface TestFixture {
  pool: DbPool;
  repo: TripRepo;
  tripId: string;
  authorId: string;
  organizerId: string;
  otherMemberId: string;
  experienceId: string;
}

async function setupFixture(): Promise<TestFixture> {
  const { pool } = buildPgMem();
  const completionRepo = createCompletionRepo(pool);
  const ratingRepo = createRatingRepo({
    pool,
    emitRatingChanged: async () => {},
  });
  const repo = createTripRepo(pool, {
    completions: completionRepo,
    ratings: ratingRepo,
  });

  const authorId = randomUUID();
  const organizerId = randomUUID();
  const otherMemberId = randomUUID();
  const tripId = randomUUID();
  const experienceId = randomUUID();

  // Users & profiles
  for (const [id, email, name] of [
    [authorId, 'author@example.com', 'Author Member'],
    [organizerId, 'organizer@example.com', 'Trip Organizer'],
    [otherMemberId, 'other@example.com', 'Other Member'],
  ] as const) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
      [id, email],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`,
      [id, name],
    );
  }

  // Trip
  await pool.query(
    `INSERT INTO trips (id, name, start_date, end_date, creator_id)
     VALUES ($1, 'Test Trip', '2026-06-01', '2026-06-07', $2)`,
    [tripId, organizerId],
  );

  // Trip members
  await pool.query(
    `INSERT INTO trip_memberships (trip_id, user_id, role, joined_at)
     VALUES ($1, $2, 'organizer', NOW()),
            ($1, $3, 'member', NOW()),
            ($1, $4, 'member', NOW())`,
    [tripId, organizerId, authorId, otherMemberId],
  );

  // Experience
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
     VALUES ($1, 'space-mountain', 'Space Mountain', 'Magic Kingdom', 'Ride')`,
    [experienceId],
  );

  return { pool, repo, tripId, authorId, organizerId, otherMemberId, experienceId };
}

interface SeededLogEntry {
  logEntryId: string;
  logId: string;
  feedItemId: string;
}

async function seedLogEntry(f: TestFixture): Promise<SeededLogEntry> {
  const logId = randomUUID();
  const logEntryId = randomUUID();
  const feedItemId = randomUUID();

  // experience_logs
  await f.pool.query(
    `INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz, logged_at)
     VALUES ($1, $2, $3, '2026-06-02', 'America/New_York', NOW())`,
    [logId, f.authorId, f.experienceId],
  );

  // canonical completions
  await f.pool.query(
    `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
     VALUES ($1, $2, '2026-06-02', 'America/New_York')
     ON CONFLICT (user_id, experience_id) DO NOTHING`,
    [f.authorId, f.experienceId],
  );

  // canonical ratings
  await f.pool.query(
    `INSERT INTO ratings (user_id, experience_id, value, updated_at)
     VALUES ($1, $2, 9, NOW())
     ON CONFLICT (user_id, experience_id) DO UPDATE SET value = 9`,
    [f.authorId, f.experienceId],
  );

  // trip_log_entries
  await f.pool.query(
    `INSERT INTO trip_log_entries (id, trip_id, member_id, experience_id, log_id, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [logEntryId, f.tripId, f.authorId, f.experienceId, logId],
  );

  // trip_feed_items
  await f.pool.query(
    `INSERT INTO trip_feed_items (id, trip_id, actor_id, type, metadata, created_at)
     VALUES ($1, $2, $3, 'completion_logged', $4, NOW())`,
    [
      feedItemId,
      f.tripId,
      f.authorId,
      JSON.stringify({ logEntryId, experienceId: f.experienceId }),
    ],
  );

  // Reactions & comments targeting feed_item
  await f.pool.query(
    `INSERT INTO trip_reactions (trip_id, target_type, target_id, member_id, reaction, created_at)
     VALUES ($1, 'feed_item', $2, $3, 'like', NOW())`,
    [f.tripId, feedItemId, f.otherMemberId],
  );
  await f.pool.query(
    `INSERT INTO trip_comments (id, trip_id, target_type, target_id, author_id, body, created_at)
     VALUES ($1, $2, 'feed_item', $3, $4, 'Nice ride!', NOW())`,
    [randomUUID(), f.tripId, feedItemId, f.otherMemberId],
  );

  // Reactions & comments targeting log_entry
  await f.pool.query(
    `INSERT INTO trip_reactions (trip_id, target_type, target_id, member_id, reaction, created_at)
     VALUES ($1, 'log_entry', $2, $3, 'love', NOW())`,
    [f.tripId, logEntryId, f.organizerId],
  );
  await f.pool.query(
    `INSERT INTO trip_comments (id, trip_id, target_type, target_id, author_id, body, created_at)
     VALUES ($1, $2, 'log_entry', $3, $4, 'Great log!', NOW())`,
    [randomUUID(), f.tripId, logEntryId, f.organizerId],
  );

  return { logEntryId, logId, feedItemId };
}

describe('deleteLogEntry original behavior', () => {
  it('rejects deletion by non-author non-organizer member with trip_forbidden', async () => {
    const f = await setupFixture();
    const { logEntryId } = await seedLogEntry(f);

    await expect(
      f.repo.deleteLogEntry(f.tripId, logEntryId, f.otherMemberId, 'member'),
    ).rejects.toMatchObject({
      code: 'trip_forbidden',
      message: 'You can only delete your own log entries.',
    });

    // Verify row still exists
    const res = await f.pool.query(
      `SELECT 1 FROM trip_log_entries WHERE id = $1`,
      [logEntryId],
    );
    expect(res.rowCount).toBe(1);
  });

  it('allows author to delete: removes feed item, reactions, comments, experience_logs, and canonical completion', async () => {
    const f = await setupFixture();
    const { logEntryId, logId, feedItemId } = await seedLogEntry(f);

    const deleted = await f.repo.deleteLogEntry(f.tripId, logEntryId, f.authorId, 'member');
    expect(deleted).toBe(true);

    // 1. trip_log_entries deleted
    const tle = await f.pool.query(`SELECT 1 FROM trip_log_entries WHERE id = $1`, [logEntryId]);
    expect(tle.rowCount).toBe(0);

    // 2. feed item, its reactions and comments removed
    const fi = await f.pool.query(`SELECT 1 FROM trip_feed_items WHERE id = $1`, [feedItemId]);
    expect(fi.rowCount).toBe(0);
    const fiReactions = await f.pool.query(
      `SELECT 1 FROM trip_reactions WHERE target_type = 'feed_item' AND target_id = $1`,
      [feedItemId],
    );
    expect(fiReactions.rowCount).toBe(0);
    const fiComments = await f.pool.query(
      `SELECT 1 FROM trip_comments WHERE target_type = 'feed_item' AND target_id = $1`,
      [feedItemId],
    );
    expect(fiComments.rowCount).toBe(0);

    // 3. log_entry targeted reactions and comments removed
    const leReactions = await f.pool.query(
      `SELECT 1 FROM trip_reactions WHERE target_type = 'log_entry' AND target_id = $1`,
      [logEntryId],
    );
    expect(leReactions.rowCount).toBe(0);
    const leComments = await f.pool.query(
      `SELECT 1 FROM trip_comments WHERE target_type = 'log_entry' AND target_id = $1`,
      [logEntryId],
    );
    expect(leComments.rowCount).toBe(0);

    // 4. experience_logs row removed
    const el = await f.pool.query(`SELECT 1 FROM experience_logs WHERE id = $1`, [logId]);
    expect(el.rowCount).toBe(0);

    // 5. canonical completion removed (was the only log for author and experience)
    const comp = await f.pool.query(
      `SELECT 1 FROM completions WHERE user_id = $1 AND experience_id = $2`,
      [f.authorId, f.experienceId],
    );
    expect(comp.rowCount).toBe(0);

    // 6. canonical rating UNTOUCHED
    const rating = await f.pool.query(
      `SELECT value FROM ratings WHERE user_id = $1 AND experience_id = $2`,
      [f.authorId, f.experienceId],
    );
    expect(rating.rowCount).toBe(1);
    expect(rating.rows[0].value).toBe(9);
  });

  it('allows organizer to delete another members log entry', async () => {
    const f = await setupFixture();
    const { logEntryId } = await seedLogEntry(f);

    const deleted = await f.repo.deleteLogEntry(f.tripId, logEntryId, f.organizerId, 'organizer');
    expect(deleted).toBe(true);

    const tle = await f.pool.query(`SELECT 1 FROM trip_log_entries WHERE id = $1`, [logEntryId]);
    expect(tle.rowCount).toBe(0);
  });

  it('preserves canonical completion when another log remains for the experience', async () => {
    const f = await setupFixture();
    const first = await seedLogEntry(f);

    // Seed a second log for the same author and experience
    const secondLogId = randomUUID();
    await f.pool.query(
      `INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz, logged_at)
       VALUES ($1, $2, $3, '2026-06-03', 'America/New_York', NOW())`,
      [secondLogId, f.authorId, f.experienceId],
    );

    const deleted = await f.repo.deleteLogEntry(f.tripId, first.logEntryId, f.authorId, 'member');
    expect(deleted).toBe(true);

    // First experience_logs is removed
    const elFirst = await f.pool.query(`SELECT 1 FROM experience_logs WHERE id = $1`, [first.logId]);
    expect(elFirst.rowCount).toBe(0);

    // Second experience_logs remains
    const elSecond = await f.pool.query(`SELECT 1 FROM experience_logs WHERE id = $1`, [secondLogId]);
    expect(elSecond.rowCount).toBe(1);

    // Canonical completion is PRESERVED because a log still exists
    const comp = await f.pool.query(
      `SELECT 1 FROM completions WHERE user_id = $1 AND experience_id = $2`,
      [f.authorId, f.experienceId],
    );
    expect(comp.rowCount).toBe(1);
  });

  it('returns false when log entry is not found', async () => {
    const f = await setupFixture();
    const deleted = await f.repo.deleteLogEntry(f.tripId, randomUUID(), f.authorId, 'member');
    expect(deleted).toBe(false);
  });

  it('sets mine: true for author and mine: false for other member on completion_logged feed items', async () => {
    const f = await setupFixture();
    await seedLogEntry(f);

    const authorFeed = await f.repo.getFeed(f.tripId, f.authorId);
    expect(authorFeed).toHaveLength(1);
    expect(authorFeed[0]!.type).toBe('completion_logged');
    expect(authorFeed[0]!.mine).toBe(true);

    const otherFeed = await f.repo.getFeed(f.tripId, f.otherMemberId);
    expect(otherFeed).toHaveLength(1);
    expect(otherFeed[0]!.type).toBe('completion_logged');
    expect(otherFeed[0]!.mine).toBe(false);
  });
});
