/**
 * Snapshot-isolation integration test for the Stats_Service repository
 * (`services/stats/repo.ts`, expanded-stats task 6.2).
 *
 * The design's "Live vs. cached boundary" section (Requirement 8) mandates that
 * every per-user statistic is computed inside ONE
 * `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction so that all
 * numerators and denominators observe the SAME point-in-time snapshot. R8.3
 * states the guarantee precisely: a `Completion` committed AFTER a stats request
 * begins its transaction MUST be excluded from that request's response.
 *
 * This behaviour is a property of Postgres MVCC and cannot be exercised against
 * the in-memory `pg-mem` engine the other tests in this repo use: pg-mem accepts
 * `BEGIN`/`COMMIT` but does not model REPEATABLE READ snapshot isolation across
 * concurrent connections (the same limitation `catalog/__tests__/
 * repo.apply.integration.test.ts` documents for rollback). We therefore run this
 * test against a REAL Postgres, in a throwaway database created and dropped per
 * run so the developer's catalog is never touched.
 *
 * How the concurrent commit is interleaved with the in-flight request:
 *
 * `getStatsSnapshot` issues its reads in a fixed order inside the one
 * transaction — `BEGIN`, then the coverage DENOMINATOR read, then the coverage
 * NUMERATOR read (which counts the Target_User's completions), then facets /
 * ratings, then `COMMIT`. In REPEATABLE READ, the transaction snapshot is pinned
 * at the FIRST data-reading statement (the denominator read), not at `BEGIN`. We
 * wrap the pool so that immediately AFTER the denominator read resolves — i.e.
 * once the snapshot is pinned — a SEPARATE connection commits a brand-new
 * completion for the Target_User. The subsequent numerator read runs in the same
 * pinned snapshot and must NOT observe that completion. We assert the returned
 * snapshot's numerator equals the pre-commit value, then prove the commit was
 * real (not a no-op) by re-reading through a fresh `getStatsSnapshot` and seeing
 * the higher value.
 *
 * Validates: Requirements 8.1, 8.3
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createStatsRepo, type StatsSnapshot } from '../repo.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Live-DB discovery
// ---------------------------------------------------------------------------
//
// The connection string mirrors the docker-compose `postgres` service used for
// local development (see apps/api/.env.example). If no Postgres is reachable the
// whole suite is skipped with a clear reason rather than failing — this test
// genuinely requires MVCC that pg-mem cannot provide.

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
      // Each migration file manages its own transaction (0001 wraps itself in
      // BEGIN/COMMIT); run the file's SQL verbatim on a real Postgres, which —
      // unlike pg-mem — supports the GIN trigram indexes and extensions.
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function insertUser(pool: DbPool): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [`${randomUUID()}@example.test`, 'argon2id$seeded'],
  );
  return res.rows[0]!.id;
}

/** Insert one active Experience and return its id. */
async function insertActiveExperience(pool: DbPool, name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, description, active)
     VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride', '', TRUE)`,
    [id, `ent-${id}`, name],
  );
  return id;
}

async function complete(
  pool: DbPool,
  userId: string,
  experienceId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
     VALUES ($1, $2, '2025-01-01', 'America/New_York')`,
    [userId, experienceId],
  );
}

/** Total completions observed across all coverage cells in a snapshot. */
function totalCompleted(snapshot: StatsSnapshot): number {
  return snapshot.coverage.reduce((sum, cell) => sum + cell.completed, 0);
}

// ---------------------------------------------------------------------------
// Instrumented pool: interleaves a concurrent commit into the in-flight txn
// ---------------------------------------------------------------------------
//
// Wraps a real pg pool so that immediately AFTER the coverage denominator read
// resolves (the statement that pins the REPEATABLE READ snapshot), the supplied
// `onSnapshotPinned` callback runs exactly once — before the numerator read that
// follows in the SAME transaction. That callback commits a concurrent completion
// on a different connection, so the numerator read must not see it.

function instrumentPool(
  realPool: DbPool,
  onSnapshotPinned: () => Promise<void>,
): DbPool {
  const wrapped = {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return (realPool as unknown as {
        query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      }).query(text, params);
    },
    async connect() {
      const client = await (realPool as unknown as {
        connect(): Promise<{
          query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
          release(): void;
        }>;
      }).connect();
      let fired = false;
      return {
        async query(text: string, params?: ReadonlyArray<unknown>) {
          const result = await client.query(text, params);
          // The denominator read is the first data-reading statement in the
          // transaction; matching its (un-aliased) GROUP BY pins the moment the
          // snapshot is established. The numerator read uses `e.park` etc., so
          // this substring cannot match it by accident.
          if (
            !fired &&
            typeof text === 'string' &&
            text.includes('GROUP BY park, category, area_type')
          ) {
            fired = true;
            await onSnapshotPinned();
          }
          return result;
        },
        release() {
          client.release();
        },
      };
    },
  };
  return wrapped as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!DB_AVAILABLE)(
  'Stats repo snapshot isolation — live Postgres (R8.1, R8.3)',
  () => {
    let adminPool: DbPool;
    let testPool: DbPool;
    let testDbName: string;

    beforeAll(async () => {
      // Create a throwaway database in the same cluster so the developer's
      // catalog is never touched, then apply the full migration chain to it.
      testDbName = `dwt_stats_iso_${randomUUID().replace(/-/g, '')}`;
      adminPool = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
      await adminPool.query(`CREATE DATABASE ${testDbName}`);

      testPool = new Pool({
        connectionString: withDatabaseName(BASE_DATABASE_URL, testDbName),
        max: 5,
      });
      await applyAllMigrations(testPool);
    }, 60_000);

    afterAll(async () => {
      await testPool?.end().catch(() => {
        /* ignore */
      });
      if (adminPool) {
        // FORCE disconnects any lingering sessions so the DROP succeeds.
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

    // Each test seeds a fresh Target_User + catalog so runs are independent.
    let targetUserId: string;
    let experienceIds: string[];

    beforeEach(async () => {
      // The coverage denominator counts every active Experience in the catalog,
      // so reset the mutable tables between tests to keep totals deterministic.
      await testPool.query(
        `TRUNCATE completions, ratings, notes, experiences, users RESTART IDENTITY CASCADE`,
      );

      targetUserId = await insertUser(testPool);
      experienceIds = [];
      for (let i = 0; i < 5; i += 1) {
        experienceIds.push(
          await insertActiveExperience(testPool, `Experience ${i}`),
        );
      }
      // The Target_User has completed exactly two of the five experiences.
      await complete(testPool, targetUserId, experienceIds[0]!);
      await complete(testPool, targetUserId, experienceIds[1]!);
    });

    it('excludes a completion committed after the snapshot is pinned (R8.3)', async () => {
      // The as-yet-uncompleted experience the concurrent transaction will claim.
      const concurrentExperienceId = experienceIds[2]!;
      let concurrentCommitObserved = false;

      const instrumented = instrumentPool(testPool, async () => {
        // Runs once, after the denominator read pins the in-flight snapshot and
        // before the numerator read. A single INSERT through the pool
        // auto-commits on its own connection, so it is durably committed the
        // instant this resolves.
        await complete(testPool, targetUserId, concurrentExperienceId);
        concurrentCommitObserved = true;
      });

      const repo = createStatsRepo(instrumented);
      const snapshot = await repo.getStatsSnapshot({
        targetUserId,
        includePercentile: false,
      });

      // The interleave actually happened...
      expect(concurrentCommitObserved).toBe(true);
      // ...yet the in-flight request observed only the two pre-snapshot
      // completions. The concurrent third completion is invisible because every
      // read in the request shares the one point-in-time snapshot (R8.1, R8.3).
      expect(totalCompleted(snapshot)).toBe(2);

      // Prove the concurrent completion truly committed (not a false pass): a
      // FRESH stats request opens a new snapshot and now sees all three.
      const freshRepo = createStatsRepo(testPool);
      const freshSnapshot = await freshRepo.getStatsSnapshot({
        targetUserId,
        includePercentile: false,
      });
      expect(totalCompleted(freshSnapshot)).toBe(3);
    });

    it('reports insufficient / consistent counts within one snapshot (R8.1)', async () => {
      // A baseline read with no interleaving: numerator (2) never exceeds the
      // denominator (5 active experiences), confirming both sides come from the
      // same snapshot.
      const repo = createStatsRepo(testPool);
      const snapshot = await repo.getStatsSnapshot({
        targetUserId,
        includePercentile: false,
      });

      const completed = totalCompleted(snapshot);
      const total = snapshot.coverage.reduce((sum, cell) => sum + cell.total, 0);
      expect(completed).toBe(2);
      expect(total).toBe(5);
      expect(completed).toBeLessThanOrEqual(total);
    });
  },
);
