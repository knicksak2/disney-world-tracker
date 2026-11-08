// Feature: unified-experience-logging, Property 12: Collaborative Duplicate Log Resolution Invariants
//
// Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7
//
// Invariants verified:
//   - When confirmed with `resolution: 'link'`, the count of `experience_logs`
//     for (caller, experience, visited_on) does NOT increase.
//   - When confirmed with `resolution: 'link'`, any solo `completion_logged`
//     `trip_feed_items` row created by caller for that experience on that trip
//     is retired so the trip feed does not duplicate cards.
//   - When confirmed with `resolution: 'new_log'`, the count of `experience_logs`
//     increases by exactly 1.
//   - `getRodeWithTag` reports `existingLogToday` when a prior log exists on that date,
//     and `null` when none exists.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createCompletionRepo } from '../../tracking/completion/repo.js';
import { createRatingRepo } from '../../tracking/rating/repo.js';
import { createTripRepo } from '../repo.js';

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

    CREATE OR REPLACE VIEW active_trip_memberships AS
    SELECT tm.trip_id, tm.user_id, tm.role, tm.joined_at
      FROM trip_memberships tm
      JOIN users u ON u.id = tm.user_id AND u.deletion_state = 'active';
  `);

  const { Pool } = db.adapters.createPg();
  const rawPool = new Pool();
  const pool = {
    async query(text: string, params?: ReadonlyArray<unknown>) {
      const stripped = text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
      return rawPool.query(stripped, params as unknown[]);
    },
    async connect() {
      const client = await rawPool.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          const stripped = text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
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

async function seedRun(pool: DbPool): Promise<{
  readonly bobId: string;
  readonly aliceId: string;
  readonly tripId: string;
  readonly experienceId: string;
}> {
  const bobId = randomUUID();
  const aliceId = randomUUID();
  const experienceId = randomUUID();
  const tripId = randomUUID();

  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash1'), ($3, $4, 'hash2')`,
    [bobId, `bob-${bobId}@test.local`, aliceId, `alice-${aliceId}@test.local`],
  );
  await pool.query(
    `INSERT INTO profiles (user_id, display_name) VALUES ($1, 'Bob'), ($2, 'Alice')`,
    [bobId, aliceId],
  );
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, 'Space Mountain', 'Magic Kingdom', 'Ride')`,
    [experienceId, `up-${experienceId}`],
  );
  await pool.query(
    `INSERT INTO trips (id, name, start_date, end_date, creator_id)
     VALUES ($1, 'Space Trip', '2026-11-01', '2026-11-05', $2)`,
    [tripId, bobId],
  );
  await pool.query(
    `INSERT INTO trip_memberships (trip_id, user_id, role)
     VALUES ($1, $2, 'organizer'), ($1, $3, 'member')`,
    [tripId, bobId, aliceId],
  );

  return { bobId, aliceId, tripId, experienceId };
}

describe('Feature: unified-experience-logging, Property 12: Collaborative Duplicate Log Resolution Invariants', () => {
  it(
    'handles resolution "link" vs "new_log" and reports existingLogToday accurately',
    async () => {
      const { db, pool } = buildPgMem();
      const emitRatingChanged = async () => {};
      const completions = createCompletionRepo(pool);
      const ratings = createRatingRepo({ pool, emitRatingChanged });
      const tripRepo = createTripRepo(pool, { completions, ratings });

      const { bobId, aliceId, tripId, experienceId } = await seedRun(pool);
      const backup = db.backup();

      await fc.assert(
        fc.asyncProperty(
          fc.boolean(), // whether Alice already logged the ride solo
          fc.boolean(), // whether Alice's solo log was linked to the trip
          fc.constantFrom<'link' | 'new_log'>('link', 'new_log'),
          fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
          async (aliceAlreadyLogged, aliceLoggedToTrip, resolution, confirmRating) => {
            backup.restore();

            // 1. If Alice logged beforehand:
            if (aliceAlreadyLogged) {
              const expLog = await pool.query<{ id: string }>(
                `INSERT INTO experience_logs (user_id, experience_id, visited_on, user_tz, rating)
                 VALUES ($1, $2, '2026-11-04', 'America/New_York', 8)
                 RETURNING id`,
                [aliceId, experienceId],
              );
              const aliceLogId = expLog.rows[0]?.id;

              if (aliceLoggedToTrip) {
                const entry = await pool.query<{ id: string }>(
                  `INSERT INTO trip_log_entries (trip_id, member_id, experience_id, log_id)
                   VALUES ($1, $2, $3, $4)
                   RETURNING id`,
                  [tripId, aliceId, experienceId, aliceLogId],
                );
                await pool.query(
                  `INSERT INTO trip_feed_items (trip_id, type, actor_id, metadata)
                   VALUES ($1, 'completion_logged', $2, $3::jsonb)`,
                  [
                    tripId,
                    aliceId,
                    JSON.stringify({ experienceId, logEntryId: entry.rows[0]?.id }),
                  ],
                );
              }
            }

            // 2. Bob logs the ride with Alice tagged:
            const bobLog = await tripRepo.logCompletion(tripId, bobId, {
              experienceId,
              completedOn: '2026-11-04',
              rodeWith: [aliceId],
            });
            const tagId = bobLog.pendingTags[0]!.tagId;

            // 3. Test getRodeWithTag:
            const tagTarget = await tripRepo.getRodeWithTag(tagId, aliceId);
            expect(tagTarget).not.toBeNull();
            if (aliceAlreadyLogged) {
              expect(tagTarget?.existingLogToday).not.toBeNull();
              expect(tagTarget?.existingLogToday?.visitedOn).toBe('2026-11-04');
              expect(tagTarget?.existingLogToday?.rating).toBe(8);
            } else {
              expect(tagTarget?.existingLogToday).toBeNull();
            }

            // 4. Record baseline experience_logs count for Alice
            const logsBefore = await pool.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM experience_logs WHERE user_id = $1 AND experience_id = $2`,
              [aliceId, experienceId],
            );
            const initialCount = Number(logsBefore.rows[0]?.count ?? '0');

            // 5. Confirm the tag with the chosen resolution
            await tripRepo.confirmRodeWithTag(tagId, aliceId, confirmRating, resolution);

            // 6. Check tag state
            const tagRow = await pool.query<{ state: string }>(
              `SELECT state FROM rode_with_tags WHERE id = $1`,
              [tagId],
            );
            expect(tagRow.rows[0]?.state).toBe('confirmed');

            // 7. Verify experience_logs count based on resolution
            const logsAfter = await pool.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM experience_logs WHERE user_id = $1 AND experience_id = $2`,
              [aliceId, experienceId],
            );
            const finalCount = Number(logsAfter.rows[0]?.count ?? '0');

            if (resolution === 'link') {
              // Count must not increase
              expect(finalCount).toBe(initialCount);

              // If Alice had a solo feed item on this trip, it must be retired
              if (aliceLoggedToTrip) {
                const soloFeed = await pool.query(
                  `SELECT 1 FROM trip_feed_items WHERE trip_id = $1 AND actor_id = $2 AND type = 'completion_logged'`,
                  [tripId, aliceId],
                );
                expect(soloFeed.rows.length).toBe(0);
              }
            } else {
              // new_log must increment Alice's logs by 1
              expect(finalCount).toBe(initialCount + 1);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
    30000,
  );
});
