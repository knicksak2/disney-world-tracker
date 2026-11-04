/**
 * Property 8: Deleting a Linked_Log removes exactly its trip footprint
 * Validates: Requirements 11.1, 11.2, 11.3, 11.5
 *
 * For any set of Linked_Logs across Trips and Members, deleting one through
 * DELETE /me/experiences/:id/logs/:logId leaves no trip_log_entries, rode_with_tags,
 * completion_logged trip_feed_items, or trip_reactions/trip_comments targeting that
 * feed item for that log, and leaves every row belonging to other logs unchanged;
 * the canonical Completion is removed only when it was the last log for that Experience
 * and the Rating is never removed. Deleting a log with no Trip link behaves as before.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../../db/pool.js';
import { AppError } from '../../../../errors/AppError.js';
import { registerErrorHandler } from '../../../../errors/handler.js';
import { createCompletionRepo } from '../../completion/repo.js';
import { createRatingRepo } from '../../rating/repo.js';
import { assertTripMember } from '../../../trips/authz.js';
import { createTripRepo, type TripRepo } from '../../../trips/repo.js';
import { tripRoutes } from '../../../trips/routes.js';
import { createExperienceLogRepo, type ExperienceLogRepo } from '../repo.js';
import { experienceLogRoutes } from '../routes.js';
import type { TripLogPort } from '../tripLogPort.js';

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', '..', 'migrations', name);
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
    implementation: (k1, v1, k2, v2, k3, v3, k4, v4) => ({
      [String(k1)]: v1,
      [String(k2)]: v2,
      [String(k3)]: v3,
      [String(k4)]: v4,
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
  const strip = (t: string): string =>
    t
      .replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '')
      .replace(/\(SELECT count\(\*\)::int\s+FROM rode_with_tags rwt[\s\S]+?WHERE[^\)]+\)/giu, '0')
      .replace(/\(SELECT json_agg\([\s\S]+?WHERE rwt\.log_entry_id = le\.id\)/giu, 'NULL');

  const pool = {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return rawPool.query(strip(text), params as unknown[]);
    },
    async connect() {
      const client = await rawPool.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          return client.query(strip(text), params as unknown[]);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;

  return { db, pool };
}

interface TestContext {
  readonly pool: DbPool;
  readonly app: FastifyInstance;
  readonly tripRepo: TripRepo;
  readonly logRepo: ExperienceLogRepo;
  currentUserId: string | null;
}

function buildTestContext(pool: DbPool): TestContext {
  const completions = createCompletionRepo(pool);
  const ratings = createRatingRepo({
    pool,
    emitRatingChanged: async () => {},
  });
  const tripRepo = createTripRepo(pool, { completions, ratings });
  const logRepo = createExperienceLogRepo({
    pool,
    emitRatingChanged: async () => {},
  });

  const tripLogPort: TripLogPort = {
    async logToTrip(i) {
      await assertTripMember(pool, i.userId, i.tripId);
      const r = await tripRepo.logCompletion(i.tripId, i.userId, {
        experienceId: i.experienceId,
        rodeWith: [...i.rodeWith],
        ...(i.rating !== null ? { rating: i.rating } : {}),
        note: i.note,
        completedOn: i.visitedOn,
        userTz: i.userTz,
      });
      return {
        logId: r.logId,
        loggedAt: r.loggedAt,
        logEntryId: r.logEntryId,
        pendingTags: r.pendingTags,
      };
    },
    purgeFeedForLog: (logId, userId) => tripRepo.purgeFeedForLog(logId, userId),
  };

  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  let currentUserId: string | null = null;
  const requireSession: preHandlerHookHandler = async (req) => {
    if (!currentUserId) {
      throw new AppError('unauthorized', 'Unauthorized');
    }
    req.userId = currentUserId;
  };

  app.register(
    experienceLogRoutes({
      repo: logRepo,
      requireSession,
      tripLog: tripLogPort,
    }),
  );

  app.register(
    tripRoutes({
      repo: tripRepo,
      pool,
      requireSession,
    }),
  );

  return {
    pool,
    app,
    tripRepo,
    logRepo,
    get currentUserId() {
      return currentUserId;
    },
    set currentUserId(v: string | null) {
      currentUserId = v;
    },
  };
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
     VALUES ($1, $2, 'Space Mountain', 'Magic Kingdom', 'Ride')`,
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

describe('unifiedLogging delete parity (Property 8)', () => {
  it('Property 8: Deleting a Linked_Log removes exactly its trip footprint (100 runs)', async () => {
    const { pool } = buildPgMem();
    const ctx = buildTestContext(pool);
    await ctx.app.ready();

    const user1 = await seedUser(pool, 'User1');
    const user2 = await seedUser(pool, 'User2');
    const member = await seedUser(pool, 'Member');

    const trip1 = await seedTrip(pool, user1, [user2, member]);
    const trip2 = await seedTrip(pool, user2, [user1, member]);

    const exp1 = await seedExperience(pool);
    const exp2 = await seedExperience(pool);

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
          note: fc.option(fc.constant('Great ride!'), { nil: null }),
          hasSecondLogForSameExp: fc.boolean(),
        }),
        async ({ rating, note, hasSecondLogForSameExp }) => {
          // Setup:
          // Target log L_target by user1 for exp1 on trip1 with rodeWith [member]
          ctx.currentUserId = user1;
          const targetRes = await ctx.app.inject({
            method: 'POST',
            url: `/me/experiences/${exp1}/logs`,
            payload: {
              visitedOn: '2026-05-02',
              userTz: 'America/New_York',
              rating,
              note,
              tripId: trip1,
              rodeWith: [member],
            },
          });
          expect(targetRes.statusCode).toBe(201);
          const targetLog = JSON.parse(targetRes.payload);
          const targetLogId = targetLog.id;
          const targetLogEntryId = targetLog.tripLog.logEntryId;

          // Find the target completion_logged feed item
          const targetFiRes = await pool.query<{ id: string }>(
            `SELECT id FROM trip_feed_items WHERE trip_id = $1 AND type = 'completion_logged' AND metadata->>'logEntryId' = $2`,
            [trip1, targetLogEntryId],
          );
          expect(targetFiRes.rows).toHaveLength(1);
          const targetFeedItemId = targetFiRes.rows[0]!.id;

          // Add a reaction and a comment targeting that feed item
          await pool.query(
            `INSERT INTO trip_reactions (trip_id, target_type, target_id, member_id, reaction)
             VALUES ($1, 'feed_item', $2, $3, 'love')`,
            [trip1, targetFeedItemId, member],
          );
          await pool.query(
            `INSERT INTO trip_comments (id, trip_id, target_type, target_id, author_id, body)
             VALUES ($1, $2, 'feed_item', $3, $4, 'Nice!')`,
            [randomUUID(), trip1, targetFeedItemId, member],
          );

          // Second log for same user & exp if configured
          let secondLogId: string | null = null;
          if (hasSecondLogForSameExp) {
            const secondRes = await ctx.app.inject({
              method: 'POST',
              url: `/me/experiences/${exp1}/logs`,
              payload: {
                visitedOn: '2026-05-03',
                userTz: 'America/New_York',
                tripId: trip1,
                rodeWith: [],
              },
            });
            expect(secondRes.statusCode).toBe(201);
            secondLogId = JSON.parse(secondRes.payload).id;
          }

          // Bystander log L_bystander by user2 for exp2 on trip2 with reactions
          ctx.currentUserId = user2;
          const bystanderRes = await ctx.app.inject({
            method: 'POST',
            url: `/me/experiences/${exp2}/logs`,
            payload: {
              visitedOn: '2026-05-04',
              userTz: 'America/New_York',
              rating: 9,
              note: 'Bystander note',
              tripId: trip2,
              rodeWith: [member],
            },
          });
          expect(bystanderRes.statusCode).toBe(201);
          const bystanderLog = JSON.parse(bystanderRes.payload);
          const bystanderLogId = bystanderLog.id;
          const bystanderEntryId = bystanderLog.tripLog.logEntryId;

          const bystanderFiRes = await pool.query<{ id: string }>(
            `SELECT id FROM trip_feed_items WHERE trip_id = $1 AND type = 'completion_logged' AND metadata->>'logEntryId' = $2`,
            [trip2, bystanderEntryId],
          );
          const bystanderFeedItemId = bystanderFiRes.rows[0]!.id;

          await pool.query(
            `INSERT INTO trip_reactions (trip_id, target_type, target_id, member_id, reaction)
             VALUES ($1, 'feed_item', $2, $3, 'celebrate')`,
            [trip2, bystanderFeedItemId, user1],
          );
          await pool.query(
            `INSERT INTO trip_comments (id, trip_id, target_type, target_id, author_id, body)
             VALUES ($1, $2, 'feed_item', $3, $4, 'Cool!')`,
            [randomUUID(), trip2, bystanderFeedItemId, user1],
          );

          // Snapshot bystander rows before delete
          const [bystanderLogBefore, bystanderEntryBefore, bystanderTagsBefore, bystanderFeedBefore, bystanderReactBefore, bystanderCommBefore] =
            await Promise.all([
              pool.query('SELECT * FROM experience_logs WHERE id = $1', [bystanderLogId]),
              pool.query('SELECT * FROM trip_log_entries WHERE id = $1', [bystanderEntryId]),
              pool.query('SELECT * FROM rode_with_tags WHERE log_entry_id = $1', [bystanderEntryId]),
              pool.query('SELECT * FROM trip_feed_items WHERE id = $1', [bystanderFeedItemId]),
              pool.query('SELECT * FROM trip_reactions WHERE target_id = $1', [bystanderFeedItemId]),
              pool.query('SELECT * FROM trip_comments WHERE target_id = $1', [bystanderFeedItemId]),
            ]);

          // Now delete target log via DELETE /me/experiences/:id/logs/:logId
          ctx.currentUserId = user1;
          const deleteRes = await ctx.app.inject({
            method: 'DELETE',
            url: `/me/experiences/${exp1}/logs/${targetLogId}`,
          });
          expect(deleteRes.statusCode).toBe(204);

          // Assert target log and its entire trip footprint is completely gone
          const [elTarget, tleTarget, rwtTarget, fiTarget, reactTarget, commTarget] = await Promise.all([
            pool.query('SELECT * FROM experience_logs WHERE id = $1', [targetLogId]),
            pool.query('SELECT * FROM trip_log_entries WHERE id = $1', [targetLogEntryId]),
            pool.query('SELECT * FROM rode_with_tags WHERE log_entry_id = $1', [targetLogEntryId]),
            pool.query('SELECT * FROM trip_feed_items WHERE id = $1', [targetFeedItemId]),
            pool.query('SELECT * FROM trip_reactions WHERE target_id = $1', [targetFeedItemId]),
            pool.query('SELECT * FROM trip_comments WHERE target_id = $1', [targetFeedItemId]),
          ]);

          expect(elTarget.rows).toHaveLength(0);
          expect(tleTarget.rows).toHaveLength(0);
          expect(rwtTarget.rows).toHaveLength(0);
          expect(fiTarget.rows).toHaveLength(0);
          expect(reactTarget.rows).toHaveLength(0);
          expect(commTarget.rows).toHaveLength(0);

          // Assert canonical completion: preserved if second log exists, removed if last
          const compUser1 = await pool.query(
            'SELECT * FROM completions WHERE user_id = $1 AND experience_id = $2',
            [user1, exp1],
          );
          if (hasSecondLogForSameExp) {
            expect(compUser1.rows).toHaveLength(1);
          } else {
            expect(compUser1.rows).toHaveLength(0);
          }

          // Assert canonical rating: NEVER removed on log delete
          if (rating !== null) {
            const ratUser1 = await pool.query(
              'SELECT * FROM ratings WHERE user_id = $1 AND experience_id = $2',
              [user1, exp1],
            );
            expect(ratUser1.rows).toHaveLength(1);
          }

          // Assert all bystander rows are completely untouched
          const [bystanderLogAfter, bystanderEntryAfter, bystanderTagsAfter, bystanderFeedAfter, bystanderReactAfter, bystanderCommAfter] =
            await Promise.all([
              pool.query('SELECT * FROM experience_logs WHERE id = $1', [bystanderLogId]),
              pool.query('SELECT * FROM trip_log_entries WHERE id = $1', [bystanderEntryId]),
              pool.query('SELECT * FROM rode_with_tags WHERE log_entry_id = $1', [bystanderEntryId]),
              pool.query('SELECT * FROM trip_feed_items WHERE id = $1', [bystanderFeedItemId]),
              pool.query('SELECT * FROM trip_reactions WHERE target_id = $1', [bystanderFeedItemId]),
              pool.query('SELECT * FROM trip_comments WHERE target_id = $1', [bystanderFeedItemId]),
            ]);

          expect(bystanderLogAfter.rows).toEqual(bystanderLogBefore.rows);
          expect(bystanderEntryAfter.rows).toEqual(bystanderEntryBefore.rows);
          expect(bystanderTagsAfter.rows).toEqual(bystanderTagsBefore.rows);
          expect(bystanderFeedAfter.rows).toEqual(bystanderFeedBefore.rows);
          expect(bystanderReactAfter.rows).toEqual(bystanderReactBefore.rows);
          expect(bystanderCommAfter.rows).toEqual(bystanderCommBefore.rows);

          // Clean up created logs for next run
          if (secondLogId) {
            await pool.query('DELETE FROM experience_logs WHERE id = $1', [secondLogId]);
          }
          await pool.query('DELETE FROM experience_logs WHERE id = $1', [bystanderLogId]);
          await pool.query('DELETE FROM completions WHERE user_id IN ($1, $2)', [user1, user2]);
          await pool.query('DELETE FROM ratings WHERE user_id IN ($1, $2)', [user1, user2]);
          await pool.query('DELETE FROM trip_reactions WHERE trip_id IN ($1, $2)', [trip1, trip2]);
          await pool.query('DELETE FROM trip_comments WHERE trip_id IN ($1, $2)', [trip1, trip2]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Deleting an unlinked log behaves as before and leaves trip tables untouched', async () => {
    const { pool } = buildPgMem();
    const ctx = buildTestContext(pool);
    await ctx.app.ready();

    const user = await seedUser(pool, 'UnlinkedUser');
    const exp = await seedExperience(pool);
    ctx.currentUserId = user;

    // Create log with no tripId
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: `/me/experiences/${exp}/logs`,
      payload: {
        visitedOn: '2026-05-02',
        userTz: 'America/New_York',
        rating: 8,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const logId = JSON.parse(createRes.payload).id;

    // Delete unlinked log
    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/me/experiences/${exp}/logs/${logId}`,
    });
    expect(delRes.statusCode).toBe(204);

    const checkLog = await pool.query('SELECT * FROM experience_logs WHERE id = $1', [logId]);
    expect(checkLog.rows).toHaveLength(0);
    // Completion is removed since it was the only log
    const checkComp = await pool.query('SELECT * FROM completions WHERE user_id = $1 AND experience_id = $2', [user, exp]);
    expect(checkComp.rows).toHaveLength(0);
    // Rating preserved
    const checkRat = await pool.query('SELECT * FROM ratings WHERE user_id = $1 AND experience_id = $2', [user, exp]);
    expect(checkRat.rows).toHaveLength(1);
  });

  it("Another user's logId returns 404 log_not_found and removes nothing", async () => {
    const { pool } = buildPgMem();
    const ctx = buildTestContext(pool);
    await ctx.app.ready();

    const user1 = await seedUser(pool, 'OwnerUser');
    const user2 = await seedUser(pool, 'AttackerUser');
    const exp = await seedExperience(pool);

    // User1 creates log
    ctx.currentUserId = user1;
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: `/me/experiences/${exp}/logs`,
      payload: {
        visitedOn: '2026-05-02',
        userTz: 'America/New_York',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const logId = JSON.parse(createRes.payload).id;

    // User2 tries to delete User1's log
    ctx.currentUserId = user2;
    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/me/experiences/${exp}/logs/${logId}`,
    });
    expect(delRes.statusCode).toBe(404);
    expect(JSON.parse(delRes.payload).error?.code).toBe('log_not_found');

    // Confirm log is NOT deleted
    const checkLog = await pool.query('SELECT * FROM experience_logs WHERE id = $1', [logId]);
    expect(checkLog.rows).toHaveLength(1);
  });
});
