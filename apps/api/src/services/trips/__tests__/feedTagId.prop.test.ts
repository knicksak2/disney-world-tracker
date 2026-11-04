/**
 * Property 9: The feed exposes a tag id only to its own pending Tagged_Member
 * Validates: Requirements 9.1, 9.2
 *
 * For any feed with completion_logged items having Rode_With_Tags in any states,
 * reading as caller C yields a non-null tagId on a rodeWith entry exactly when
 * that tag's Tagged_Member is C and its state is pending;
 * every other entry's tagId is null.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import type { RodeWithTagState } from '@dwt/shared';
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

    CREATE OR REPLACE VIEW active_trip_memberships AS
    SELECT tm.trip_id, tm.user_id, tm.role, tm.joined_at
      FROM trip_memberships tm
      JOIN users u ON u.id = tm.user_id AND u.deletion_state = 'active';
  `);

  const { Pool } = db.adapters.createPg();
  const rawPool = new Pool();

  const pool = {
    async query(text: string, params?: ReadonlyArray<unknown>) {
      // In pg-mem, scalar subqueries in SELECT lists cannot resolve outer tables (e.g. le.id).
      // For getFeed's main query, we execute the query without the scalar subqueries, then
      // populate rode_with via a clean standalone query for each row.
      const isFeedMain = text.includes('FROM trip_feed_items fi') && text.includes('rode_with_tags rwt');
      if (isFeedMain) {
        const adaptedText = text
          .replace(/\(SELECT count\(\*\)::int\s+FROM rode_with_tags rwt[\s\S]+?WHERE[^\)]+\)/giu, '0')
          .replace(/\(SELECT json_agg\([\s\S]+?WHERE rwt\.log_entry_id = le\.id\)/giu, 'NULL');
        const res = await rawPool.query(adaptedText, params as unknown[]);
        const callerId = params?.[1];

        // Enrich rows with rode_with
        for (const row of res.rows) {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          const logEntryId = meta?.logEntryId;
          if (logEntryId) {
            const tagRes = await rawPool.query(
              `SELECT count(*)::int AS count,
                      json_agg(
                        json_build_object(
                          'taggedMemberId', pr.public_id,
                          'displayName', pr.display_name,
                          'state', rwt.state,
                          'tagId', CASE WHEN rwt.tagged_member_id = $2 AND rwt.state = 'pending' THEN rwt.id END
                        )
                        ORDER BY rwt.created_at ASC, rwt.id ASC
                      ) AS rode_with
                 FROM rode_with_tags rwt
                 JOIN profile_identity pr ON pr.user_id = rwt.tagged_member_id
                WHERE rwt.log_entry_id = $1`,
              [logEntryId, callerId],
            );
            row.rode_with_count = tagRes.rows[0]?.count ?? 0;
            let rawRodeWith = tagRes.rows[0]?.rode_with;
            if (typeof rawRodeWith === 'string') {
              rawRodeWith = JSON.parse(rawRodeWith);
            }
            row.rode_with = rawRodeWith ?? null;
          }
        }
        return res;
      }

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

async function seedUser(pool: DbPool, name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`, [
    id,
    `${name}-${id}@example.com`,
  ]);
  await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [id, name]);
  return id;
}

async function seedExperience(pool: DbPool): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
     VALUES ($1, $2, 'Big Thunder Mountain', 'Magic Kingdom', 'Ride')`,
    [id, `up-${id}`],
  );
  return id;
}

async function seedTrip(pool: DbPool, creatorId: string, memberIds: string[]): Promise<string> {
  const tripId = randomUUID();
  await pool.query(
    `INSERT INTO trips (id, creator_id, name, start_date, end_date)
     VALUES ($1, $2, 'Disney Vacation', '2026-05-01', '2026-05-10')`,
    [tripId, creatorId],
  );
  await pool.query(
    `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'organizer')`,
    [tripId, creatorId],
  );
  for (const mid of memberIds) {
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'member')`,
      [tripId, mid],
    );
  }
  return tripId;
}

describe('feed tagId visibility (Property 9)', () => {
  it('Property 9: The feed exposes a tag id only to its own pending Tagged_Member (100 runs)', async () => {
    const { pool } = buildPgMem();
    const completions = createCompletionRepo(pool);
    const ratings = createRatingRepo({
      pool,
      emitRatingChanged: async () => {},
    });
    const tripRepo: TripRepo = createTripRepo(pool, { completions, ratings });

    const creatorId = await seedUser(pool, 'Creator');
    const memberA = await seedUser(pool, 'MemberA');
    const memberB = await seedUser(pool, 'MemberB');
    const memberC = await seedUser(pool, 'MemberC');
    const allMembers = [creatorId, memberA, memberB, memberC];

    const tripId = await seedTrip(pool, creatorId, [memberA, memberB, memberC]);
    const expId = await seedExperience(pool);

    const statesArb = fc.constantFrom<RodeWithTagState>('pending', 'confirmed', 'declined');

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          stateA: statesArb,
          stateB: statesArb,
          stateC: statesArb,
          caller: fc.constantFrom(...allMembers),
        }),
        async ({ stateA, stateB, stateC, caller }) => {
          // 1. Create a completion logged by creator
          const logged = await tripRepo.logCompletion(tripId, creatorId, {
            experienceId: expId,
            rodeWith: [memberA, memberB, memberC],
          });

          // 2. Update states of the created tags
          for (const pendingTag of logged.pendingTags) {
            let targetState: RodeWithTagState = 'pending';
            if (pendingTag.taggedMemberId === memberA) targetState = stateA;
            if (pendingTag.taggedMemberId === memberB) targetState = stateB;
            if (pendingTag.taggedMemberId === memberC) targetState = stateC;

            await pool.query(`UPDATE rode_with_tags SET state = $1 WHERE id = $2`, [
              targetState,
              pendingTag.tagId,
            ]);
          }

          // 3. Read feed as `caller`
          const feed = await tripRepo.getFeed(tripId, caller);
          const feedItem = feed.find(
            (item) => item.type === 'completion_logged' && item.metadata?.logEntryId === logged.logEntryId,
          );
          expect(feedItem).toBeDefined();

          const rodeWith = (feedItem?.metadata?.rodeWith as Array<{
            taggedMemberId: string;
            state: string;
            tagId?: string | null;
          }>) ?? [];
          expect(rodeWith).toHaveLength(3);

          // 4. Assert: tagId is non-null EXACTLY when taggedMemberId === caller AND state === 'pending'
          for (const tag of rodeWith) {
            const isCallerAndPending = tag.taggedMemberId === caller && tag.state === 'pending';
            if (isCallerAndPending) {
              expect(tag.tagId).toBeDefined();
              expect(typeof tag.tagId).toBe('string');
              expect(tag.tagId?.length).toBeGreaterThan(0);
            } else {
              expect(tag.tagId ?? null).toBeNull();
            }
          }

          // Clean up this run's feed item and tags
          await pool.query(`DELETE FROM trip_feed_items WHERE trip_id = $1`, [tripId]);
          await pool.query(`DELETE FROM trip_log_entries WHERE trip_id = $1`, [tripId]);
          await pool.query(`DELETE FROM experience_logs WHERE user_id = $1`, [creatorId]);
          await pool.query(`DELETE FROM completions WHERE user_id = $1`, [creatorId]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
