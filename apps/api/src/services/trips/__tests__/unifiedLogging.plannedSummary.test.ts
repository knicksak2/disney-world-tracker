/**
 * Property 11: A Trip-linked log completes a matching planned item and counts in the summary
 * Validates: Requirements 10.1, 10.2, 10.3
 *
 * For any Trip with Planned_Items and a Trip-linked create for an Experience that is
 * (or is not) a Planned_Item, completedExperienceIdsFromFeed(feed) after the create
 * contains that Experience and derivePlannedListPresentation marks the matching Planned_Item
 * done (and no other item changes), and getSummary reports a plannedCompletedCount that
 * increases by exactly one when the Experience newly completes a previously not-done
 * Planned_Item and is otherwise unchanged.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { PlannedItemDTO } from '@dwt/shared';
import {
  completedExperienceIdsFromFeed,
  derivePlannedListPresentation,
} from '@dwt/shared';

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

    CREATE OR REPLACE VIEW active_trip_memberships AS
    SELECT tm.trip_id, tm.user_id, tm.role, tm.joined_at
      FROM trip_memberships tm
      JOIN users u ON u.id = tm.user_id AND u.deletion_state = 'active';
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
        const callerId = params?.[1];

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

async function seedExperience(pool: DbPool, name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
     VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride')`,
    [id, `up-${id}`, name],
  );
  return id;
}

async function seedTrip(pool: DbPool, creatorId: string): Promise<string> {
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
  return tripId;
}

async function seedPlannedItem(
  pool: DbPool,
  tripId: string,
  adderId: string,
  expId: string,
): Promise<PlannedItemDTO> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO planned_items (id, trip_id, experience_id, added_by)
     VALUES ($1, $2, $3, $4)`,
    [id, tripId, expId, adderId],
  );

  return {
    id,
    experienceId: expId,
    experienceName: 'Exp',
    park: 'Magic Kingdom',
    customTitle: null,
    addedByDisplayName: 'Creator',
    plannedDate: null,
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 0,
    itemType: 'experience',
    durationMinutes: null,
    catalogDurationMinutes: null,
  } as unknown as PlannedItemDTO;
}

describe('unifiedLogging planned items and summary (Property 11)', () => {
  it('Property 11: A Trip-linked log completes a matching planned item and counts in the summary (100 runs)', async () => {
    const { pool } = buildPgMem();
    const completions = createCompletionRepo(pool);
    const ratings = createRatingRepo({
      pool,
      emitRatingChanged: async () => {},
    });
    const tripRepo: TripRepo = createTripRepo(pool, { completions, ratings });

    const creatorId = await seedUser(pool, 'Creator');
    const tripId = await seedTrip(pool, creatorId);

    // Seed 3 planned items
    const expA = await seedExperience(pool, 'Exp A');
    const expB = await seedExperience(pool, 'Exp B');
    const expC = await seedExperience(pool, 'Exp C');
    const expD = await seedExperience(pool, 'Exp D (unplanned)');

    const plannedA = await seedPlannedItem(pool, tripId, creatorId, expA);
    const plannedB = await seedPlannedItem(pool, tripId, creatorId, expB);
    const plannedC = await seedPlannedItem(pool, tripId, creatorId, expC);
    const allPlanned = [plannedA, plannedB, plannedC];

    const expUniverse = [expA, expB, expC, expD];

    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...expUniverse), async (targetExp) => {
        // 1. Initial reads before create
        const feedBefore = await tripRepo.getFeed(tripId, creatorId);
        const completedBefore = completedExperienceIdsFromFeed(feedBefore) ?? new Set();
        const presentationBefore = derivePlannedListPresentation(allPlanned, completedBefore);
        const summaryBefore = await tripRepo.getSummary(tripId);

        const isPlanned = allPlanned.some((p) => p.experienceId === targetExp);
        const wasAlreadyDone = completedBefore.has(targetExp);

        // 2. Perform Trip-linked create
        await tripRepo.logCompletion(tripId, creatorId, {
          experienceId: targetExp,
          completedOn: '2026-05-02',
          rodeWith: [],
        });

        // 3. Reads after create
        const feedAfter = await tripRepo.getFeed(tripId, creatorId);
        const completedAfter = completedExperienceIdsFromFeed(feedAfter);
        expect(completedAfter).not.toBeNull();
        expect(completedAfter!.has(targetExp)).toBe(true);

        // 4. Planned list presentation assertions
        const presentationAfter = derivePlannedListPresentation(allPlanned, completedAfter);

        if (isPlanned) {
          // Matching item is now in doneSection
          const matchingView = presentationAfter.doneSection.find((v) => v.experienceId === targetExp);
          expect(matchingView).toBeDefined();

          // No other items changed status unexpectedly
          for (const item of allPlanned) {
            if (item.experienceId !== targetExp) {
              const beforeDone = presentationBefore.doneSection.some((v) => v.id === item.id);
              const afterDone = presentationAfter.doneSection.some((v) => v.id === item.id);
              expect(afterDone).toBe(beforeDone);
            }
          }
        } else {
          // Unplanned experience: all planned items preserve their done/not-done state exactly
          expect(presentationAfter.doneSection.map((v) => v.id)).toEqual(
            presentationBefore.doneSection.map((v) => v.id),
          );
          expect(presentationAfter.notDoneSection.map((v) => v.id)).toEqual(
            presentationBefore.notDoneSection.map((v) => v.id),
          );
        }

        // 5. Trip summary assertions
        const summaryAfter = await tripRepo.getSummary(tripId);
        expect(summaryAfter.plannedTotalCount).toBe(allPlanned.length);

        if (isPlanned && !wasAlreadyDone) {
          expect(summaryAfter.plannedCompletedCount).toBe(summaryBefore.plannedCompletedCount + 1);
        } else {
          expect(summaryAfter.plannedCompletedCount).toBe(summaryBefore.plannedCompletedCount);
        }

        // Reset feed/logs for next test run
        await pool.query('DELETE FROM trip_feed_items WHERE trip_id = $1', [tripId]);
        await pool.query('DELETE FROM trip_log_entries WHERE trip_id = $1', [tripId]);
        await pool.query('DELETE FROM experience_logs WHERE user_id = $1', [creatorId]);
        await pool.query('DELETE FROM completions WHERE user_id = $1', [creatorId]);
      }),
      { numRuns: 100 },
    );
  });
});
