/**
 * Response-performance integration test for the Stats_Service repository +
 * response assembly (`services/stats/repo.ts` + `services/stats/routes.ts`,
 * expanded-stats task 8.6).
 *
 * Requirement 11 bounds the end-to-end latency of a stats response near the
 * documented data volumes:
 *
 *   - R11.1: a request that does NOT ask for the Percentile_Rank returns the
 *     complete response within 2 seconds for a catalog of up to 5,000 active
 *     Experiences and a Target_User with up to 5,000 Completions and up to
 *     5,000 Ratings.
 *   - R11.2: a request that additionally asks for the Percentile_Rank returns
 *     within 3 seconds for a Completions dataset spanning up to 100,000
 *     trackers, under the volumes in R11.1.
 *
 * This is a genuine performance property of the production SQL against a real
 * Postgres planner/executor over real index structures; it cannot be modelled
 * on the in-memory `pg-mem` engine the pure/unit suites use. We therefore run
 * against a REAL Postgres in a throwaway database created and dropped per run
 * (the same harness `repo.isolation.test.ts` uses), and skip the whole suite
 * cleanly when no Postgres is reachable — a skip, never a fake pass.
 *
 * The measured unit of work mirrors what the route does per request: one
 * `getStatsSnapshot` inside the single `REPEATABLE READ READ ONLY` transaction,
 * followed by the pure `assembleResponse` fold. Seeding is done once in
 * `beforeAll` with bulk `INSERT ... SELECT generate_series(...)` so setup work
 * never bleeds into the timed sections.
 *
 * Validates: Requirements 11.1, 11.2
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createStatsRepo, type StatsSnapshot } from '../repo.js';
import { assembleResponse } from '../routes.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Data volumes near the R11 bounds
// ---------------------------------------------------------------------------

/** R11.1 catalog size: up to 5,000 active Experiences. */
const ACTIVE_EXPERIENCES = 5_000;
/** R11.1 Target_User volume: up to 5,000 Completions and 5,000 Ratings. */
const TARGET_COMPLETIONS = 5_000;
const TARGET_RATINGS = 5_000;
/** R11.2 comparative volume: Completions spanning up to 100,000 trackers. */
const OTHER_TRACKERS = 100_000;

/**
 * Number of active Resorts seeded so the additive `byResort` grouped read
 * (R7.1, R7.11) is exercised under load. Roughly matches the real Walt Disney
 * World resort-hotel count so the grouped denominator/numerator reads fold a
 * realistic number of groups.
 */
const ACTIVE_RESORTS = 30;
/**
 * How many of the `ACTIVE_EXPERIENCES` are turned into resort-linked activities
 * (their `resort_id` set to one of the seeded Resorts). Kept a strict subset of
 * the catalog so the total active-experience count — and every existing R11
 * coverage assertion — is unchanged; only `resort_id` is populated on these
 * rows, so they still count toward `coverage.overall` exactly as before. The
 * `byResort` read groups these by resort so its cost tracks with the seeded
 * load rather than an empty scan.
 */
const RESORT_LINKED_EXPERIENCES = 1_500;

/** R11.1 / R11.2 latency budgets (milliseconds). */
const BOUND_NO_PERCENTILE_MS = 2_000;
const BOUND_WITH_PERCENTILE_MS = 3_000;

// ---------------------------------------------------------------------------
// Live-DB discovery (mirrors repo.isolation.test.ts)
// ---------------------------------------------------------------------------

const BASE_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://dwt:dwt@localhost:5432/dwt';

/** Quick reachability probe with a short timeout so DB-less CI skips fast. */
async function probeDatabase(): Promise<boolean> {
  const probe = new Pool({
    connectionString: BASE_DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {
      /* ignore */
    });
  }
}

const DB_AVAILABLE = await probeDatabase();

/** Swap the database name in a Postgres connection URL. */
function withDatabaseName(url: string, dbName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

/** Absolute path to the migrations directory relative to this test file. */
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → stats → services → src → apps/api
  return resolve(here, '..', '..', '..', '..', 'migrations');
}

/** Apply every `NNNN_*.sql` migration, in lexicographic order, verbatim. */
async function applyAllMigrations(pool: DbPool): Promise<void> {
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((name) => /^\d{4,}_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const client = await pool.connect();
  try {
    for (const name of files) {
      const sql = readFileSync(join(dir, name), 'utf8');
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Bulk seed helpers — every insert is a single set-based statement so setup
// stays fast and never dominates (nor bleeds into) the timed sections.
// ---------------------------------------------------------------------------

/**
 * Insert `ACTIVE_EXPERIENCES` active Experiences in one statement. Only the
 * NOT-NULL columns are set explicitly; `area_type` defaults to `'ThemePark'`,
 * `grouped_facets` to `'{}'`, and every other dimension column is nullable.
 */
async function seedExperiences(pool: DbPool): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
     SELECT gen_random_uuid(),
            'perf-ent-' || g,
            'Perf Experience ' || g,
            'Magic Kingdom',
            'Ride',
            TRUE
       FROM generate_series(1, $1) AS g`,
    [ACTIVE_EXPERIENCES],
  );
}

/**
 * Insert `ACTIVE_RESORTS` active Resorts in one statement so the `byResort`
 * denominator read has real `resorts` rows to join against (R7.1, R7.5). Only
 * the NOT-NULL columns are set; `active` defaults to `TRUE`.
 */
async function seedResorts(pool: DbPool): Promise<void> {
  await pool.query(
    `INSERT INTO resorts (id, upstream_entity_id, name, active)
     SELECT gen_random_uuid(),
            'perf-resort-' || g,
            'Perf Resort ' || g,
            TRUE
       FROM generate_series(1, $1) AS g`,
    [ACTIVE_RESORTS],
  );
}

/**
 * Turn the first `RESORT_LINKED_EXPERIENCES` seeded Experiences (ordered by
 * upstream id, so the subset is deterministic) into resort-linked activities by
 * setting their `resort_id` to one of the seeded Resorts, spread evenly across
 * all `ACTIVE_RESORTS` by a modulo mapping. `represents_resort_id` stays NULL,
 * so these rows are exactly the non-representing, resort-linked Experiences the
 * `byResort` computation groups (R7.1–R7.4). The catalog size is unchanged (only
 * `resort_id` is populated), so every existing coverage assertion still holds;
 * this only ensures the added grouped read runs over a realistic denominator.
 */
async function seedResortLinks(pool: DbPool): Promise<void> {
  await pool.query(
    `WITH resort_list AS (
       SELECT id,
              ROW_NUMBER() OVER (ORDER BY upstream_entity_id) - 1 AS ridx
         FROM resorts
        WHERE upstream_entity_id LIKE 'perf-resort-%'
     ),
     target_exp AS (
       SELECT id,
              ROW_NUMBER() OVER (ORDER BY upstream_entity_id) - 1 AS eidx
         FROM experiences
        WHERE upstream_entity_id LIKE 'perf-ent-%'
        ORDER BY upstream_entity_id
        LIMIT $1
     )
     UPDATE experiences e
        SET resort_id = rl.id
       FROM target_exp te
       JOIN resort_list rl ON rl.ridx = (te.eidx % $2)
      WHERE e.id = te.id`,
    [RESORT_LINKED_EXPERIENCES, ACTIVE_RESORTS],
  );
}

/** Insert one Target_User and return its id. */
async function seedTargetUser(pool: DbPool): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, 'argon2id$perf-target')
     RETURNING id`,
    [`perf-target-${randomUUID()}@example.test`],
  );
  return res.rows[0]!.id;
}

/**
 * Complete the Target_User's first `TARGET_COMPLETIONS` Experiences (ordered by
 * upstream id so the subset is deterministic). With the seeded catalog this is
 * all 5,000 active Experiences — the R11.1 completion volume.
 */
async function seedTargetCompletions(pool: DbPool, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
     SELECT $1, e.id, '2025-01-01', 'America/New_York'
       FROM experiences e
      ORDER BY e.upstream_entity_id
      LIMIT $2`,
    [userId, TARGET_COMPLETIONS],
  );
}

/**
 * Rate the Target_User's first `TARGET_RATINGS` Experiences with a value in the
 * 1..10 range (the R11.1 rating volume). The value cycles deterministically so
 * every 1..10 bucket is populated.
 */
async function seedTargetRatings(pool: DbPool, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO ratings (user_id, experience_id, value)
     SELECT $1,
            sub.id,
            (sub.rn % 10) + 1
       FROM (
             SELECT e.id,
                    ROW_NUMBER() OVER (ORDER BY e.upstream_entity_id) AS rn
               FROM experiences e
              ORDER BY e.upstream_entity_id
              LIMIT $2
            ) AS sub`,
    [userId, TARGET_RATINGS],
  );
}

/**
 * Insert `OTHER_TRACKERS` additional users, then give each exactly one
 * Completion, so the percentile grouping (`GROUP BY user_id` over an active-
 * experience join) spans up to 100,000 trackers (R11.2). Each tracker's single
 * completion is spread across the catalog by a modulo mapping so the join is
 * not degenerate on one row.
 */
async function seedOtherTrackers(pool: DbPool): Promise<void> {
  await pool.query(
    `INSERT INTO users (email, password_hash)
     SELECT 'perf-tracker-' || g || '@example.test', 'argon2id$perf-tracker'
       FROM generate_series(1, $1) AS g`,
    [OTHER_TRACKERS],
  );

  // One completion per tracker, mapped onto the catalog by row number so the
  // completions distribute across experiences rather than collapsing to one.
  await pool.query(
    `WITH trackers AS (
       SELECT u.id AS user_id,
              ROW_NUMBER() OVER (ORDER BY u.id) AS rn
         FROM users u
        WHERE u.email LIKE 'perf-tracker-%'
     ),
     catalog AS (
       SELECT e.id,
              ROW_NUMBER() OVER (ORDER BY e.upstream_entity_id) - 1 AS idx
         FROM experiences e
     )
     INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
     SELECT t.user_id,
            c.id,
            '2025-01-01',
            'America/New_York'
       FROM trackers t
       JOIN catalog c
         ON c.idx = (t.rn - 1) % $1`,
    [ACTIVE_EXPERIENCES],
  );
}

/** Total completions observed across all coverage cells in a snapshot. */
function totalCompleted(snapshot: StatsSnapshot): number {
  return snapshot.coverage.reduce((sum, cell) => sum + cell.completed, 0);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!DB_AVAILABLE)(
  'Stats repo response performance near the R11 bounds — live Postgres',
  () => {
    let adminPool: DbPool;
    let testPool: DbPool;
    let testDbName: string;
    let targetUserId: string;

    beforeAll(async () => {
      // Throwaway database in the same cluster so the developer's catalog is
      // never touched; full migration chain applied to it.
      testDbName = `dwt_stats_perf_${randomUUID().replace(/-/g, '')}`;
      adminPool = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
      await adminPool.query(`CREATE DATABASE ${testDbName}`);

      testPool = new Pool({
        connectionString: withDatabaseName(BASE_DATABASE_URL, testDbName),
        max: 5,
      });
      await applyAllMigrations(testPool);

      // Bulk seed once. Order matters: experiences → resorts → link a subset of
      // experiences to resorts (so `byResort` is exercised) → target
      // (+completions, +ratings) → 100k trackers with one completion each.
      await seedExperiences(testPool);
      await seedResorts(testPool);
      await seedResortLinks(testPool);
      targetUserId = await seedTargetUser(testPool);
      await seedTargetCompletions(testPool, targetUserId);
      await seedTargetRatings(testPool, targetUserId);
      await seedOtherTrackers(testPool);

      // Update planner statistics so the timed reads use realistic plans rather
      // than the stale post-bulk-load estimates.
      await testPool.query('ANALYZE');
    }, 300_000);

    afterAll(async () => {
      await testPool?.end().catch(() => {
        /* ignore */
      });
      if (adminPool) {
        await adminPool
          .query(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`)
          .catch(() => {
            /* ignore */
          });
        await adminPool.end().catch(() => {
          /* ignore */
        });
      }
    });

    it('returns within 2s without the Percentile_Rank (R11.1)', async () => {
      const repo = createStatsRepo(testPool);

      // Prime the pool connection so TCP/handshake setup is not attributed to
      // the timed request (a fair "nominal load" warm connection).
      await repo.getStatsSnapshot({
        targetUserId,
        includePercentile: false,
      });

      const start = performance.now();
      const snapshot = await repo.getStatsSnapshot({
        targetUserId,
        includePercentile: false,
      });
      const response = assembleResponse(snapshot, false);
      const elapsedMs = performance.now() - start;

      // Sanity: the seeded data actually flowed through (full catalog completed
      // by the target), and no percentile was computed (R7.2 / R11.1 path).
      expect(totalCompleted(snapshot)).toBe(TARGET_COMPLETIONS);
      expect(response.coverage.overall.total).toBe(ACTIVE_EXPERIENCES);
      expect(response.coverage.overall.completed).toBe(TARGET_COMPLETIONS);
      expect(response.percentileRank).toBeUndefined();
      expect(snapshot.percentile).toBeNull();

      // Sanity: the additive `byResort` grouped read actually ran under load —
      // every seeded active Resort appears once, and (since the target
      // completed the whole catalog, including every resort-linked activity)
      // each per-resort cell is complete with its full seeded denominator.
      expect(snapshot.resortCoverage).toHaveLength(ACTIVE_RESORTS);
      expect(response.coverage.byResort).toHaveLength(ACTIVE_RESORTS);
      expect(
        response.coverage.byResort.reduce((sum, r) => sum + r.cell.total, 0),
      ).toBe(RESORT_LINKED_EXPERIENCES);
      expect(
        response.coverage.byResort.every((r) => r.cell.completeBadge),
      ).toBe(true);

      expect(elapsedMs).toBeLessThan(BOUND_NO_PERCENTILE_MS);
    });

    it('returns within 3s with the Percentile_Rank over 100k trackers (R11.2)', async () => {
      const repo = createStatsRepo(testPool);

      // Warm connection (see R11.1 test) so setup latency is excluded.
      await repo.getStatsSnapshot({
        targetUserId,
        includePercentile: true,
      });

      const start = performance.now();
      const snapshot = await repo.getStatsSnapshot({
        targetUserId,
        includePercentile: true,
      });
      const response = assembleResponse(snapshot, true);
      const elapsedMs = performance.now() - start;

      // Sanity: percentile material was read for all trackers and the target,
      // and the rank was computed (target is strictly ahead of every other
      // tracker, each of whom has a single completion → 100.0).
      expect(snapshot.percentile).not.toBeNull();
      expect(snapshot.percentile!.otherTotals).toHaveLength(OTHER_TRACKERS);
      expect(snapshot.percentile!.targetTotal).toBe(TARGET_COMPLETIONS);
      expect(response.percentileUnavailable).toBeUndefined();
      expect(response.percentileRank).toBe(100.0);

      // Sanity: the added `byResort` grouped read is also folded into the
      // percentile path's snapshot and stays within the R11.2 envelope.
      expect(snapshot.resortCoverage).toHaveLength(ACTIVE_RESORTS);
      expect(response.coverage.byResort).toHaveLength(ACTIVE_RESORTS);

      expect(elapsedMs).toBeLessThan(BOUND_WITH_PERCENTILE_MS);
    });
  },
);
