/**
 * Property tests for `ExperienceLogRepo.getVisitSummaries` (Feature:
 * experience-lists, Requirement 13 batched Visit_Summary addition to
 * `tracking/logs`). Mirrors the harness style of `experienceLogs.prop.test.ts`
 * exactly: a real pg-mem-backed repo running the actual migration SQL, driven
 * with `fast-check` (>=100 runs).
 *
 * Property 12 — Visit Summary Reflects Only the Requesting User's Own Logs
 * Property 13 — Visit Summary Batch Completeness and Zero-Log Default
 *
 * Both properties compare the SQL-derived result against a naive in-memory
 * recomputation from the same generated log records, rather than asserting
 * fixed expected numbers.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../../db/pool.js';
import { createExperienceLogRepo, type ExperienceLogRepo, type VisitSummary } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem harness (mirrors experienceLogs.prop.test.ts exactly)
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
  // pg-mem does not implement the two-arg numeric ROUND() the getVisitSummaries
  // query relies on (`ROUND(AVG(...)::numeric, 1)`); register it directly.
  pub.registerFunction({
    name: 'round',
    args: [DataType.decimal, DataType.integer],
    returns: DataType.decimal,
    implementation: (value: unknown, precision: unknown): number => {
      const n = typeof value === 'string' ? Number(value) : (value as number);
      const p = typeof precision === 'string' ? Number(precision) : (precision as number);
      const factor = 10 ** p;
      return Math.round(n * factor) / factor;
    },
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

/**
 * pg-mem's `COUNT(*) FILTER (WHERE cond)` ignores the filter clause entirely
 * and counts every row in the group (verified directly against pg-mem; `AVG(
 * expr) FILTER (WHERE cond)` is unaffected). Rewrite it to the equivalent
 * `COUNT(CASE WHEN cond THEN 1 END)` before the query reaches pg-mem. This is
 * a test-harness compatibility shim only — the production SQL in `repo.ts`
 * (task 8.1, already shipped) is untouched.
 */
function rewriteCountFilterForPgMem(sql: string): string {
  return sql.replace(
    /COUNT\(\*\)\s*FILTER\s*\(WHERE\s+([^()]+(?:\([^()]*\)[^()]*)*)\)/giu,
    'COUNT(CASE WHEN $1 THEN 1 END)',
  );
}

/**
 * pg-mem does not implement `FOR UPDATE`; strip it like the trips harness.
 * Also rewrites `COUNT(*) FILTER` per `rewriteCountFilterForPgMem` above.
 */
function withForUpdateCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  const strip = (t: string): string =>
    rewriteCountFilterForPgMem(t.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, ''));
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
}

function setup(): Harness {
  const db = buildPgMemDatabase();
  for (const name of ['0001_init.sql', '0015_trips.sql', '0034_experience_logs.sql']) {
    applyMigration(db, name);
  }
  const { Pool } = db.adapters.createPg();
  const pool = withForUpdateCompat(new Pool() as unknown as DbPool);
  const repo = createExperienceLogRepo({
    pool,
    emitRatingChanged: async () => {},
  });
  return { pool, repo };
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

// ---------------------------------------------------------------------------
// Naive in-memory recomputation (the oracle both properties compare against)
// ---------------------------------------------------------------------------

interface LogSpec {
  readonly ownerIsUserA: boolean;
  readonly experienceIndex: number;
  readonly rating: number | null;
}

/**
 * Recomputes the expected `VisitSummary` set for `userId` from the raw
 * generated log specs, restricted to whichever experience ids are requested.
 * This is a deliberately naive, independent re-derivation of the SQL's
 * `GROUP BY experience_id` / `COUNT` / `COUNT(*) FILTER` / `ROUND(AVG(...)
 * FILTER (...), 1)` logic, so the test is comparing two independent
 * implementations rather than asserting a hardcoded expectation.
 */
function naiveRecompute(
  specs: readonly LogSpec[],
  experienceIds: readonly string[],
  isOwnerMatch: (spec: LogSpec) => boolean,
): Map<string, VisitSummary> {
  const byExperience = new Map<string, LogSpec[]>();
  for (const spec of specs) {
    if (!isOwnerMatch(spec)) continue;
    const experienceId = experienceIds[spec.experienceIndex];
    if (experienceId === undefined) continue;
    const list = byExperience.get(experienceId) ?? [];
    list.push(spec);
    byExperience.set(experienceId, list);
  }

  const result = new Map<string, VisitSummary>();
  for (const [experienceId, logs] of byExperience) {
    const repeatCount = logs.length;
    const ratings = logs
      .map((l) => l.rating)
      .filter((r): r is number => r !== null);
    const ratedCount = ratings.length;
    const averageRating =
      ratedCount === 0
        ? null
        : Math.round((ratings.reduce((a, b) => a + b, 0) / ratedCount) * 10) / 10;
    result.set(experienceId, { experienceId, repeatCount, ratedCount, averageRating });
  }
  return result;
}

function sortById(rows: readonly VisitSummary[]): VisitSummary[] {
  return [...rows].sort((a, b) => a.experienceId.localeCompare(b.experienceId));
}

// ---------------------------------------------------------------------------
// Shared generator: a batch of log specs against a small fixed pool of
// experiences, tagged with which of two seeded users (A/B) owns each log.
// ---------------------------------------------------------------------------

const EXPERIENCE_POOL_SIZE = 4;

const logSpecArb = fc.record({
  ownerIsUserA: fc.boolean(),
  experienceIndex: fc.integer({ min: 0, max: EXPERIENCE_POOL_SIZE - 1 }),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
});

describe('ExperienceLogRepo.getVisitSummaries — property tests', () => {
  let h: Harness;
  beforeEach(() => {
    h = setup();
  });

  // Feature: experience-lists, Property 12: Visit Summary Reflects Only the
  // Requesting User's Own Logs — getVisitSummaries computed for User A never
  // reflects User B's experience_logs rows for the same Experience, even
  // when both users log the same experience with different ratings.
  it('Property 12 — visit summary reflects only the requesting user\'s own logs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(logSpecArb, { minLength: 0, maxLength: 20 }),
        async (specs) => {
          const userA = await seedUser(h.pool);
          const userB = await seedUser(h.pool);
          const experienceIds: string[] = [];
          for (let i = 0; i < EXPERIENCE_POOL_SIZE; i++) {
            experienceIds.push(await seedExperience(h.pool));
          }

          for (const spec of specs) {
            const experienceId = experienceIds[spec.experienceIndex]!;
            await h.repo.addLog({
              userId: spec.ownerIsUserA ? userA : userB,
              experienceId,
              visitedOn: '2026-01-02',
              userTz: 'America/New_York',
              rating: spec.rating,
            });
          }

          const actual = await h.repo.getVisitSummaries(userA, experienceIds);
          const expected = naiveRecompute(
            specs,
            experienceIds,
            (spec) => spec.ownerIsUserA === true,
          );

          // The repo must never return an entry for an id with none of A's
          // own logs, and must never return B's counts under A's id — i.e.
          // the actual set exactly matches the naive recomputation restricted
          // to A's own logs.
          expect(sortById(actual)).toEqual(sortById([...expected.values()]));
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-lists, Property 13: Visit Summary Batch Completeness
  // and Zero-Log Default — the repo returns exactly the ids with at least one
  // matching log (proving the "absent, not backfilled" contract per task 8.1),
  // and a route-level-equivalent backfill wrapper over that result produces
  // exactly N entries for N requested ids, with zero-log ids defaulting to
  // { repeatCount: 0, ratedCount: 0, averageRating: null }.
  it('Property 13 — visit summary batch completeness and zero-log default', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(logSpecArb, { minLength: 0, maxLength: 20 }),
        async (specs) => {
          const userA = await seedUser(h.pool);
          const userB = await seedUser(h.pool);
          const experienceIds: string[] = [];
          for (let i = 0; i < EXPERIENCE_POOL_SIZE; i++) {
            experienceIds.push(await seedExperience(h.pool));
          }

          for (const spec of specs) {
            const experienceId = experienceIds[spec.experienceIndex]!;
            await h.repo.addLog({
              userId: spec.ownerIsUserA ? userA : userB,
              experienceId,
              visitedOn: '2026-01-02',
              userTz: 'America/New_York',
              rating: spec.rating,
            });
          }

          const actual = await h.repo.getVisitSummaries(userA, experienceIds);
          const expected = naiveRecompute(
            specs,
            experienceIds,
            (spec) => spec.ownerIsUserA === true,
          );
          const idsWithLogs = new Set(expected.keys());

          // The repo itself does NOT backfill: it returns only ids with >=1
          // matching log for this user, and never a zero-log id.
          expect(sortById(actual)).toEqual(sortById([...expected.values()]));
          for (const row of actual) {
            expect(idsWithLogs.has(row.experienceId)).toBe(true);
          }
          for (const experienceId of experienceIds) {
            if (!idsWithLogs.has(experienceId)) {
              expect(actual.some((r) => r.experienceId === experienceId)).toBe(false);
            }
          }

          // A route-level-equivalent backfill: build a lookup from the repo
          // result, then emit exactly one entry per requested id, defaulting
          // any absent id to the zero-log shape.
          const byId = new Map(actual.map((r) => [r.experienceId, r] as const));
          const backfilled = experienceIds.map(
            (id) =>
              byId.get(id) ?? {
                experienceId: id,
                repeatCount: 0,
                ratedCount: 0,
                averageRating: null,
              },
          );

          expect(backfilled).toHaveLength(experienceIds.length);
          for (const id of experienceIds) {
            const entry = backfilled.find((r) => r.experienceId === id);
            expect(entry).toBeDefined();
            if (!idsWithLogs.has(id)) {
              expect(entry).toEqual({
                experienceId: id,
                repeatCount: 0,
                ratedCount: 0,
                averageRating: null,
              });
            } else {
              expect(entry).toEqual(expected.get(id));
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
