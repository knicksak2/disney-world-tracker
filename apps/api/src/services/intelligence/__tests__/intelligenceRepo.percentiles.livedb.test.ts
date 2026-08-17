import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { IntelligenceRepo } from '../IntelligenceRepo.js';

const { Pool } = pg;

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
  // __tests__ → intelligence → services → src → apps/api
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

describe.skipIf(!DB_AVAILABLE)(
  'IntelligenceRepo.getRecentPercentiles — live Postgres scratch DB',
  () => {
    let adminPool: DbPool;
    let testPool: DbPool;
    let testDbName: string;
    let repo: IntelligenceRepo;

    async function seedExperience(id: string, name: string): Promise<void> {
      await testPool.query(
        `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
         VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride', TRUE)`,
        [id, `upstream-${id}`, name],
      );
    }

    async function seedWaitSample(
      experienceId: string,
      observedAt: string | Date,
      waitMinutes: number,
      status: string = 'OPERATING',
    ): Promise<void> {
      await testPool.query(
        `INSERT INTO wait_samples (experience_id, observed_at, wait_minutes, status)
         VALUES ($1, $2, $3, $4)`,
        [experienceId, observedAt instanceof Date ? observedAt.toISOString() : observedAt, waitMinutes, status],
      );
    }

    beforeAll(async () => {
      testDbName = `dwt_intel_perc_${randomUUID().replace(/-/g, '')}`;
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

    it('(a) ET BUCKETING: catches missing AT TIME ZONE clause (UTC Friday 02:00 is Thursday 22:00 EDT)', async () => {
      const expId = randomUUID();
      await seedExperience(expId, 'ET Bucketing Test Ride');

      // 2026-10-02T02:00:00Z:
      // UTC: Day of week = 5 (Friday), Hour = 2
      // America/New_York (EDT, UTC-4): Thursday 2026-10-01 at 22:00: Day of week = 4 (Thursday), Hour = 22
      await seedWaitSample(expId, '2026-10-02T02:00:00Z', 35);

      const rows = await repo.getRecentPercentiles(new Date('2026-09-01T00:00:00Z'));
      const expRows = rows.filter((r) => r.experience_id === expId);

      expect(expRows).toHaveLength(1);
      expect(expRows[0]!.day_of_week).toBe(4); // Thursday
      expect(expRows[0]!.hour).toBe(22); // 22:00 EDT
    });

    it('(b) DST INVARIANCE: winter EST and summer EDT both land in day_of_week = 4, hour = 10', async () => {
      const expId = randomUUID();
      await seedExperience(expId, 'DST Invariance Test Ride');

      // 2026-01-15T15:00:00Z -> 10:00 EST (UTC-5) on Thursday 2026-01-15
      // 2026-10-01T14:00:00Z -> 10:00 EDT (UTC-4) on Thursday 2026-10-01
      // Both are 10:00 park-local on Thursday (day_of_week = 4, hour = 10)
      await seedWaitSample(expId, '2026-01-15T15:00:00Z', 20);
      await seedWaitSample(expId, '2026-10-01T14:00:00Z', 40);

      const rows = await repo.getRecentPercentiles(new Date('2026-01-01T00:00:00Z'));
      const expRows = rows.filter((r) => r.experience_id === expId);

      // Both samples must group into the exact same (day_of_week = 4, hour = 10) bucket
      expect(expRows).toHaveLength(1);
      expect(expRows[0]!.day_of_week).toBe(4);
      expect(expRows[0]!.hour).toBe(10);
      expect(expRows[0]!.p50_wait).toBe(30); // (20 + 40) / 2
    });

    it('(c) DAY-OF-WEEK ENCODING: known Sunday yields day_of_week = 0', async () => {
      const expId = randomUUID();
      await seedExperience(expId, 'Sunday Encoding Test Ride');

      // 2026-10-04 is a Sunday. 16:00:00Z is 12:00 EDT on Sunday.
      await seedWaitSample(expId, '2026-10-04T16:00:00Z', 45);

      const rows = await repo.getRecentPercentiles(new Date('2026-09-01T00:00:00Z'));
      const expRows = rows.filter((r) => r.experience_id === expId);

      expect(expRows).toHaveLength(1);
      expect(expRows[0]!.day_of_week).toBe(0); // 0 = Sunday
      expect(expRows[0]!.hour).toBe(12);
    });

    it('(d) PERCENTILE VALUES: distribution 10, 20, 30, 40, 50 yields p50 = 30 and p90 = 46', async () => {
      const expId = randomUUID();
      await seedExperience(expId, 'Percentile Distribution Test Ride');

      // Seed 5 samples in the same bucket: Thursday 10:00 EDT
      await seedWaitSample(expId, '2026-10-01T14:05:00Z', 10);
      await seedWaitSample(expId, '2026-10-01T14:15:00Z', 20);
      await seedWaitSample(expId, '2026-10-01T14:25:00Z', 30);
      await seedWaitSample(expId, '2026-10-01T14:35:00Z', 40);
      await seedWaitSample(expId, '2026-10-01T14:45:00Z', 50);

      const rows = await repo.getRecentPercentiles(new Date('2026-09-01T00:00:00Z'));
      const expRows = rows.filter((r) => r.experience_id === expId);

      expect(expRows).toHaveLength(1);
      expect(expRows[0]!.p50_wait).toBe(30);
      expect(expRows[0]!.p90_wait).toBe(46);
    });

    it('(e) CUTOFF: WHERE observed_at >= $1 excludes older samples', async () => {
      const expId = randomUUID();
      await seedExperience(expId, 'Cutoff Test Ride');

      // Old sample: 2026-07-01
      await seedWaitSample(expId, '2026-07-01T14:00:00Z', 100);
      // Recent sample: 2026-10-01
      await seedWaitSample(expId, '2026-10-01T14:00:00Z', 25);

      const rows = await repo.getRecentPercentiles(new Date('2026-09-01T00:00:00Z'));
      const expRows = rows.filter((r) => r.experience_id === expId);

      expect(expRows).toHaveLength(1);
      // Only the recent sample (25 min) is in the bucket; old sample (100 min) excluded
      expect(expRows[0]!.p50_wait).toBe(25);
      expect(expRows[0]!.p90_wait).toBe(25);
    });
  },
);
