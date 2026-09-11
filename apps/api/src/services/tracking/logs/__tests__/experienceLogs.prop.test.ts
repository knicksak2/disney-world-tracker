/**
 * Property tests for the Experience_Log repository (Feature:
 * experience-activity-logging). Each property is validated with `fast-check`
 * (>=100 runs) against a real pg-mem-backed repo running the actual migration
 * SQL, so the dual-write, ordering, and cascade behavior is exercised end to
 * end rather than mocked.
 *
 * Property 1 — Dual-Write Completion Invariant (R1.1, R1.3, R2.1)
 * Property 2 — Rated Log Canonical Update Invariant (R2.2, R5.3)
 * Property 3 — Visit History Ordering and Repeat Count (R4.1, R4.2)
 * Property 4 — Delete Cleanup & Trip Cascade link removal (R1.4, R5.1, R5.2)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../../db/pool.js';
import { createExperienceLogRepo, type ExperienceLogRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem harness
// ---------------------------------------------------------------------------

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();
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
  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  // pg-mem lacks the `AT TIME ZONE` operator; strip it (production Postgres
  // runs it). No rows exist at migration time in these tests, so the backfill
  // selects nothing regardless.
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

/** pg-mem does not implement `FOR UPDATE`; strip it like the trips harness. */
function withForUpdateCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  const strip = (t: string): string => t.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return raw.query(strip(text), params);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          return client.query(strip(text), params);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;
}

interface Harness {
  readonly pool: DbPool;
  readonly repo: ExperienceLogRepo;
  readonly ratingEvents: { experienceId: string; oldValue: number | null; newValue: number | null }[];
}

function setup(): Harness {
  const db = buildPgMemDatabase();
  for (const name of ['0001_init.sql', '0015_trips.sql', '0034_experience_logs.sql']) {
    applyMigration(db, name);
  }
  const { Pool } = db.adapters.createPg();
  const pool = withForUpdateCompat(new Pool() as unknown as DbPool);
  const ratingEvents: Harness['ratingEvents'] = [];
  const repo = createExperienceLogRepo({
    pool,
    emitRatingChanged: async (evt) => {
      ratingEvents.push(evt);
    },
  });
  return { pool, repo, ratingEvents };
}

async function seedUser(pool: DbPool): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'h')`, [
    id,
    `${id}@example.com`,
  ]);
  return id;
}

async function seedExperience(pool: DbPool): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
     VALUES ($1, $2, 'Ride', 'Magic Kingdom', 'Ride')`,
    [id, `up-${id}`],
  );
  return id;
}

async function seedTripWithMember(pool: DbPool, memberId: string): Promise<string> {
  const tripId = randomUUID();
  await pool.query(
    `INSERT INTO trips (id, creator_id, name, start_date, end_date)
     VALUES ($1, $2, 'T', '2026-01-01', '2026-01-05')`,
    [tripId, memberId],
  );
  await pool.query(
    `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'organizer')`,
    [tripId, memberId],
  );
  return tripId;
}

async function countCompletions(pool: DbPool, userId: string, experienceId: string): Promise<number> {
  const r = await pool.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM completions WHERE user_id = $1 AND experience_id = $2`,
    [userId, experienceId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExperienceLogRepo — property tests', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });

  // Feature: experience-activity-logging, Property 1: For any user and
  // experience, inserting logs guarantees exactly one matching completion row,
  // and repeat logs never produce a duplicate completion.
  it('Property 1 — dual-write completion invariant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
        async (repeats, baseDate) => {
          const userId = await seedUser(h.pool);
          const experienceId = await seedExperience(h.pool);
          for (let i = 0; i < repeats; i++) {
            const d = new Date(baseDate.getTime() + i * 86_400_000);
            await h.repo.addLog({
              userId,
              experienceId,
              visitedOn: d.toISOString().slice(0, 10),
              userTz: 'America/New_York',
            });
            // Invariant holds after every insert, not just at the end.
            expect(await countCompletions(h.pool, userId, experienceId)).toBe(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-activity-logging, Property 2: a rated log updates the
  // canonical rating to that value; deleting a log leaves the rating untouched.
  it('Property 2 — rated log canonical update invariant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        async (r1, r2) => {
          const userId = await seedUser(h.pool);
          const experienceId = await seedExperience(h.pool);

          await h.repo.addLog({
            userId,
            experienceId,
            visitedOn: '2026-01-02',
            userTz: 'America/New_York',
            rating: r1,
          });
          const afterFirst = await h.pool.query<{ value: number | string }>(
            `SELECT value FROM ratings WHERE user_id = $1 AND experience_id = $2`,
            [userId, experienceId],
          );
          expect(Number(afterFirst.rows[0]?.value)).toBe(r1);

          const second = await h.repo.addLog({
            userId,
            experienceId,
            visitedOn: '2026-01-03',
            userTz: 'America/New_York',
            rating: r2,
          });
          const afterSecond = await h.pool.query<{ value: number | string }>(
            `SELECT value FROM ratings WHERE user_id = $1 AND experience_id = $2`,
            [userId, experienceId],
          );
          expect(Number(afterSecond.rows[0]?.value)).toBe(r2);

          // Deleting a log must NOT touch the canonical rating (R5.3).
          await h.repo.deleteLog(userId, experienceId, second.id);
          const afterDelete = await h.pool.query<{ value: number | string }>(
            `SELECT value FROM ratings WHERE user_id = $1 AND experience_id = $2`,
            [userId, experienceId],
          );
          expect(Number(afterDelete.rows[0]?.value)).toBe(r2);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-activity-logging, Property 3: getVisitHistory returns
  // repeatCount === logs.length and orders by visited_on DESC, logged_at DESC.
  it('Property 3 — visit history ordering and repeat count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
          { minLength: 1, maxLength: 6 },
        ),
        async (dates) => {
          const userId = await seedUser(h.pool);
          const experienceId = await seedExperience(h.pool);
          for (const d of dates) {
            await h.repo.addLog({
              userId,
              experienceId,
              visitedOn: d.toISOString().slice(0, 10),
              userTz: 'America/New_York',
            });
          }
          const history = await h.repo.getVisitHistory(userId, experienceId);
          expect(history.repeatCount).toBe(dates.length);
          expect(history.logs).toHaveLength(dates.length);
          for (let i = 0; i + 1 < history.logs.length; i++) {
            const a = history.logs[i]!;
            const b = history.logs[i + 1]!;
            expect(a.visitedOn >= b.visitedOn).toBe(true);
            if (a.visitedOn === b.visitedOn) {
              expect(a.loggedAt >= b.loggedAt).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-activity-logging, Property 4: deleting a trip-linked
  // log removes both the log and its trip_log_entries link (log_id cascade),
  // and removes the canonical completion only when it was the last log.
  it('Property 4 — delete cleanup and trip-link cascade', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (extraLogs) => {
        const userId = await seedUser(h.pool);
        const experienceId = await seedExperience(h.pool);
        const tripId = await seedTripWithMember(h.pool, userId);

        // One trip-linked log plus `extraLogs` unlinked logs for the same exp.
        const linked = await h.repo.addLog({
          userId,
          experienceId,
          visitedOn: '2026-01-02',
          userTz: 'America/New_York',
          tripId,
        });
        for (let i = 0; i < extraLogs; i++) {
          await h.repo.addLog({
            userId,
            experienceId,
            visitedOn: '2026-01-03',
            userTz: 'America/New_York',
          });
        }

        const linkBefore = await h.pool.query(
          `SELECT 1 FROM trip_log_entries WHERE log_id = $1`,
          [linked.id],
        );
        expect(linkBefore.rows.length).toBe(1);

        // Deleting the linked log cascades its trip_log_entries row away, but
        // other logs remain so the completion is preserved.
        const del = await h.repo.deleteLog(userId, experienceId, linked.id);
        expect(del.deleted).toBe(true);
        expect(del.completionRemoved).toBe(false);

        const linkAfter = await h.pool.query(
          `SELECT 1 FROM trip_log_entries WHERE log_id = $1`,
          [linked.id],
        );
        expect(linkAfter.rows.length).toBe(0);
        expect(await countCompletions(h.pool, userId, experienceId)).toBe(1);

        // Delete the remaining logs; the last deletion removes the completion.
        const history = await h.repo.getVisitHistory(userId, experienceId);
        let last: Awaited<ReturnType<ExperienceLogRepo['deleteLog']>> | null = null;
        for (const log of history.logs) {
          last = await h.repo.deleteLog(userId, experienceId, log.id);
        }
        expect(last?.completionRemoved).toBe(true);
        expect(await countCompletions(h.pool, userId, experienceId)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
