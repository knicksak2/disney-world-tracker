/**
 * Feature: crowd-calendar — task 19.6. Real-SQL coverage for the columns
 * migration 0033 added to `ride_shapes` and `experience_season_hour`.
 *
 * This must run the ACTUAL query. A service test with a mocked repo cannot catch
 * a column dropped from an INSERT list or missing from the ON CONFLICT UPDATE
 * clause — the mock was never the thing that could break.
 *
 * It also pins the `dedupeByKey` guard: Postgres raises `21000` ("ON CONFLICT DO
 * UPDATE command cannot affect row a second time") when one command tries to
 * update the same row twice, and a sampling pass can legitimately produce two
 * entries for the same bucket. **That error only exists on real Postgres**, so a
 * pg-mem test could not guard it even if pg-mem supported the query.
 *
 * Live Postgres is required for a second reason: `upsertRideShapes` and
 * `upsertSeasonHours` use multi-array `unnest($1::uuid[], $2::int[], ...)`, and
 * pg-mem implements only single-argument `unnest` ("unnest expects 1 arguments,
 * given 13"). This joins `getRecentPercentiles` on the list of repo queries that
 * cannot be covered by the pg-mem suites.
 *
 * Skips cleanly when no database is reachable.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { IntelligenceRepo } from '../IntelligenceRepo.js';
import type { RideShapeRow, SeasonHourRow } from '../IntelligenceRepo.js';

const { Pool } = pg;

const BASE_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dwt:dwt@localhost:5432/dwt';

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

function withDatabaseName(url: string, dbName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations');
}

async function applyAllMigrations(pool: DbPool): Promise<void> {
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((name) => /^\d{4,}_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const client = await pool.connect();
  try {
    for (const name of files) {
      await client.query(readFileSync(join(dir, name), 'utf8'));
    }
  } finally {
    client.release();
  }
}

describe.skipIf(!DB_AVAILABLE)(
  'IntelligenceRepo — baseline / avg_crowd_index columns round-trip (live Postgres)',
  () => {
    let adminPool: DbPool;
    let testPool: DbPool;
    let testDbName: string;
    let repo: IntelligenceRepo;
    let expId: string;

    beforeAll(async () => {
      testDbName = `dwt_intel_base_${randomUUID().replace(/-/g, '')}`;
      adminPool = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
      await adminPool.query(`CREATE DATABASE ${testDbName}`);

      testPool = new Pool({
        connectionString: withDatabaseName(BASE_DATABASE_URL, testDbName),
        max: 5,
      });
      await applyAllMigrations(testPool);
      repo = new IntelligenceRepo(testPool as any);
    }, 120_000);

    afterAll(async () => {
      await testPool?.end().catch(() => {
        /* ignore */
      });
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`).catch(() => {
          /* ignore */
        });
        await adminPool.end().catch(() => {
          /* ignore */
        });
      }
    });

    beforeEach(async () => {
      await testPool.query('DELETE FROM experience_season_hour');
      await testPool.query('DELETE FROM ride_shapes');
      await testPool.query('DELETE FROM experiences');

      expId = randomUUID();
      await testPool.query(
        `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
         VALUES ($1, $2, 'Seven Dwarfs Mine Train', 'Magic Kingdom', 'Ride', TRUE)`,
        [expId, `upstream-${expId}`],
      );
    });

    function shape(overrides: Partial<RideShapeRow> = {}): RideShapeRow {
      return {
        experience_id: expId,
        day_of_week: 3,
        hour: 14,
        avg_wait_minutes: 45,
        sample_count: 40,
        sr_avg_wait_minutes: null,
        sr_sample_count: null,
        stddev_wait: 8,
        p50_wait: 44,
        p90_wait: 60,
        down_rate: 0.02,
        baseline_wait_minutes: 38.5,
        baseline_sample_count: 120,
        ...overrides,
      };
    }

    function season(overrides: Partial<SeasonHourRow> = {}): SeasonHourRow {
      return {
        experience_id: expId,
        season: 2,
        day_of_week: 3,
        hour: 14,
        avg_wait_minutes: 47,
        sample_count: 31,
        avg_crowd_index: 0.93,
        ...overrides,
      };
    }

    it('persists and reads back both new ride_shapes columns', async () => {
      await repo.upsertRideShapes([shape()]);

      const rows = await repo.getRideShapes([expId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.baseline_wait_minutes).toBeCloseTo(38.5, 4);
      expect(rows[0]!.baseline_sample_count).toBe(120);
      // Pre-existing columns must still round-trip.
      expect(rows[0]!.avg_wait_minutes).toBeCloseTo(45, 4);
      expect(rows[0]!.sample_count).toBe(40);
    });

    it('carries the baseline columns through the ON CONFLICT UPDATE clause', async () => {
      await repo.upsertRideShapes([shape()]);
      await repo.upsertRideShapes([
        shape({ avg_wait_minutes: 52, sample_count: 41, baseline_wait_minutes: 41.25 }),
      ]);

      const rows = await repo.getRideShapes([expId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.avg_wait_minutes).toBeCloseTo(52, 4);
      // If the column were missing from the UPDATE clause this would still read
      // 38.5, and a later re-anchor (R14.9) could never take effect.
      expect(rows[0]!.baseline_wait_minutes).toBeCloseTo(41.25, 4);
    });

    it('round-trips a NULL baseline for a not-yet-established bucket', async () => {
      await repo.upsertRideShapes([shape({ baseline_wait_minutes: null, baseline_sample_count: 0 })]);

      const rows = await repo.getRideShapes([expId]);
      expect(rows[0]!.baseline_wait_minutes).toBeNull();
      expect(rows[0]!.baseline_sample_count).toBe(0);
    });

    it('persists and reads back avg_crowd_index, including a transition back to NULL', async () => {
      await repo.upsertSeasonHours([season()]);

      let rows = await repo.getSeasonHours([expId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.avg_crowd_index).toBeCloseTo(0.93, 4);
      expect(rows[0]!.sample_count).toBe(31);

      await repo.upsertSeasonHours([season({ avg_crowd_index: null })]);
      rows = await repo.getSeasonHours([expId]);
      expect(rows[0]!.avg_crowd_index).toBeNull();
    });

    describe('conflict-key dedupe (Postgres 21000)', () => {
      it('accepts a ride_shapes batch with a duplicated conflict key, last write winning', async () => {
        // Without dedupeByKey this raises 21000: "ON CONFLICT DO UPDATE command
        // cannot affect row a second time".
        await expect(
          repo.upsertRideShapes([
            shape({ avg_wait_minutes: 10, baseline_wait_minutes: 9 }),
            shape({ avg_wait_minutes: 99, baseline_wait_minutes: 88 }),
          ]),
        ).resolves.toBeUndefined();

        const rows = await repo.getRideShapes([expId]);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.avg_wait_minutes).toBeCloseTo(99, 4);
        expect(rows[0]!.baseline_wait_minutes).toBeCloseTo(88, 4);
      });

      it('accepts an experience_season_hour batch with a duplicated conflict key', async () => {
        await expect(
          repo.upsertSeasonHours([
            season({ avg_wait_minutes: 10, avg_crowd_index: 0.5 }),
            season({ avg_wait_minutes: 90, avg_crowd_index: 1.4 }),
          ]),
        ).resolves.toBeUndefined();

        const rows = await repo.getSeasonHours([expId]);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.avg_wait_minutes).toBeCloseTo(90, 4);
        expect(rows[0]!.avg_crowd_index).toBeCloseTo(1.4, 4);
      });

      it('keeps distinct buckets in a mixed batch that also contains a duplicate', async () => {
        await repo.upsertRideShapes([
          shape({ hour: 14, avg_wait_minutes: 10 }),
          shape({ hour: 15, avg_wait_minutes: 20 }),
          shape({ hour: 14, avg_wait_minutes: 30 }),
        ]);

        const rows = (await repo.getRideShapes([expId])).sort((a, b) => a.hour - b.hour);
        expect(rows).toHaveLength(2);
        expect(rows[0]!.hour).toBe(14);
        expect(rows[0]!.avg_wait_minutes).toBeCloseTo(30, 4);
        expect(rows[1]!.hour).toBe(15);
        expect(rows[1]!.avg_wait_minutes).toBeCloseTo(20, 4);
      });
    });
  },
);
