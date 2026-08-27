/**
 * Feature: crowd-calendar — tasks 21.2 and 21.3, Property 17.
 *
 * `archiveWaitSamples` is a single server-side `INSERT ... SELECT ... GROUP BY`
 * that buckets by **Eastern** calendar date and hour. Two reasons it needs live
 * Postgres rather than pg-mem: it uses `AT TIME ZONE`, which pg-mem cannot
 * execute, and the whole point of the test is to run the real aggregation — a
 * mocked repo would prove nothing about the SQL, which is where an averaging or
 * bucketing bug would actually live.
 *
 * Also covers R17.5: the archive must be invisible to prediction. That one is a
 * guard against a future change quietly making it an input, which is exactly the
 * kind of thing that would otherwise be noticed only by its effect on accuracy.
 *
 * Skips cleanly when no database is reachable.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { IntelligenceRepo } from '../IntelligenceRepo.js';
import { createPredictionService } from '../predictionService.js';
import type { WeatherClient } from '../weatherClient.js';

const { Pool } = pg;

const BASE_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dwt:dwt@localhost:5432/dwt';

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

async function applyAllMigrations(pool: DbPool): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = resolve(here, '..', '..', '..', '..', 'migrations');
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

const weatherClient: WeatherClient = {
  getWDWWeather: vi.fn().mockResolvedValue({
    current: { condition: 'Clear', tempF: 82, precip: 0 },
    forecast: [],
  }),
};

describe.skipIf(!DB_AVAILABLE)('wait_archive aggregation + prediction neutrality (live Postgres)', () => {
  let adminPool: DbPool;
  let testPool: DbPool;
  let testDbName: string;
  let repo: IntelligenceRepo;
  let expId: string;

  beforeAll(async () => {
    testDbName = `dwt_wait_archive_${randomUUID().replace(/-/g, '')}`;
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
    await testPool.query('DELETE FROM wait_archive');
    await testPool.query('DELETE FROM wait_samples');
    await testPool.query('DELETE FROM ride_shapes');
    await testPool.query('DELETE FROM experiences');

    expId = randomUUID();
    await testPool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
       VALUES ($1, $2, 'Space Mountain', 'Magic Kingdom', 'Ride', TRUE)`,
      [expId, `upstream-${expId}`],
    );
  });

  async function seedSample(observedAt: string, waitMinutes: number, status = 'OPERATING') {
    await testPool.query(
      `INSERT INTO wait_samples (experience_id, observed_at, wait_minutes, status)
       VALUES ($1, $2, $3, $4)`,
      [expId, observedAt, waitMinutes, status],
    );
  }

  async function archiveRows() {
    const res = await testPool.query(
      `SELECT date::text AS date, hour, avg_wait_minutes, sample_count, min_wait_minutes, max_wait_minutes
       FROM wait_archive WHERE experience_id = $1 ORDER BY date, hour`,
      [expId],
    );
    return res.rows;
  }

  /** Wide enough to cover every fixture timestamp below. */
  const SINCE = new Date('2026-08-01T00:00:00Z');

  it('aggregates mean, count, min and max per Eastern hour', async () => {
    await seedSample('2026-08-05T18:05:00Z', 30); // 14:05 ET
    await seedSample('2026-08-05T18:25:00Z', 50); // 14:25 ET
    await seedSample('2026-08-05T18:45:00Z', 40); // 14:45 ET

    const written = await repo.archiveWaitSamples(SINCE);
    expect(written).toBe(1);

    const rows = await archiveRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe('2026-08-05');
    expect(rows[0]!.hour).toBe(14);
    expect(rows[0]!.avg_wait_minutes).toBeCloseTo(40, 4);
    expect(rows[0]!.sample_count).toBe(3);
    expect(rows[0]!.min_wait_minutes).toBeCloseTo(30, 4);
    expect(rows[0]!.max_wait_minutes).toBeCloseTo(50, 4);
  });

  it('buckets by EASTERN date and hour, so a late-evening sample stays on its park day', async () => {
    // 01:30 UTC on Aug 6 is 21:30 EDT on Aug 5 — the same park evening. A UTC
    // bucketing would file this as Aug 6 hour 1 and split the evening in two.
    await seedSample('2026-08-06T01:30:00Z', 25);

    await repo.archiveWaitSamples(SINCE);

    const rows = await archiveRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe('2026-08-05');
    expect(rows[0]!.hour).toBe(21);
  });

  it('keeps separate hours and dates separate', async () => {
    await seedSample('2026-08-05T14:10:00Z', 10); // 10:10 ET, Aug 5 h10
    await seedSample('2026-08-05T18:10:00Z', 60); // 14:10 ET, Aug 5 h14
    await seedSample('2026-08-06T18:10:00Z', 20); // 14:10 ET, Aug 6 h14

    const written = await repo.archiveWaitSamples(SINCE);
    expect(written).toBe(3);

    const rows = await archiveRows();
    expect(rows.map((r) => [r.date, r.hour, r.avg_wait_minutes])).toEqual([
      ['2026-08-05', 10, 10],
      ['2026-08-05', 14, 60],
      ['2026-08-06', 14, 20],
    ]);
  });

  it('includes a walk-on 0-minute standby, which is real low-crowd signal', async () => {
    await seedSample('2026-08-05T18:05:00Z', 0);
    await seedSample('2026-08-05T18:25:00Z', 10);

    await repo.archiveWaitSamples(SINCE);

    const rows = await archiveRows();
    expect(rows[0]!.sample_count).toBe(2);
    expect(rows[0]!.min_wait_minutes).toBeCloseTo(0, 4);
    expect(rows[0]!.avg_wait_minutes).toBeCloseTo(5, 4);
  });

  it('excludes non-OPERATING samples', async () => {
    await seedSample('2026-08-05T18:05:00Z', 30, 'OPERATING');
    await seedSample('2026-08-05T18:25:00Z', 999, 'DOWN');

    await repo.archiveWaitSamples(SINCE);

    const rows = await archiveRows();
    expect(rows[0]!.sample_count).toBe(1);
    expect(rows[0]!.avg_wait_minutes).toBeCloseTo(30, 4);
    expect(rows[0]!.max_wait_minutes).toBeCloseTo(30, 4);
  });

  it('is idempotent: re-running does not double-count', async () => {
    await seedSample('2026-08-05T18:05:00Z', 30);
    await seedSample('2026-08-05T18:25:00Z', 50);

    await repo.archiveWaitSamples(SINCE);
    await repo.archiveWaitSamples(SINCE);
    await repo.archiveWaitSamples(SINCE);

    const rows = await archiveRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sample_count).toBe(2);
    expect(rows[0]!.avg_wait_minutes).toBeCloseTo(40, 4);
  });

  it('recomputes an hour when later samples arrive for it', async () => {
    await seedSample('2026-08-05T18:05:00Z', 30);
    await repo.archiveWaitSamples(SINCE);
    expect((await archiveRows())[0]!.sample_count).toBe(1);

    await seedSample('2026-08-05T18:45:00Z', 50);
    await repo.archiveWaitSamples(SINCE);

    const rows = await archiveRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sample_count).toBe(2);
    expect(rows[0]!.avg_wait_minutes).toBeCloseTo(40, 4);
  });

  it('leaves archive rows for already-pruned days untouched (R17.6)', async () => {
    // An old day is archived, then its raw samples are pruned, then the archive
    // leg runs again with a narrow window that no longer covers it.
    await seedSample('2026-08-05T18:05:00Z', 30);
    await repo.archiveWaitSamples(new Date('2026-08-01T00:00:00Z'));
    expect(await archiveRows()).toHaveLength(1);

    await repo.pruneWaitSamples(new Date('2026-08-20T00:00:00Z'));
    expect((await testPool.query('SELECT COUNT(*)::int AS n FROM wait_samples')).rows[0].n).toBe(0);

    // A later run with a recent window must not delete or zero the old row.
    await repo.archiveWaitSamples(new Date('2026-08-20T00:00:00Z'));

    const rows = await archiveRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.avg_wait_minutes).toBeCloseTo(30, 4);
    expect(rows[0]!.sample_count).toBe(1);
  });

  it('only aggregates samples inside the requested window', async () => {
    await seedSample('2026-08-05T18:05:00Z', 30);
    await seedSample('2026-08-25T18:05:00Z', 70);

    const written = await repo.archiveWaitSamples(new Date('2026-08-20T00:00:00Z'));
    expect(written).toBe(1);

    const rows = await archiveRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe('2026-08-25');
  });

  it('prunes archive rows older than the retention cutoff', async () => {
    await seedSample('2026-08-05T18:05:00Z', 30);
    await seedSample('2026-08-25T18:05:00Z', 70);
    await repo.archiveWaitSamples(SINCE);
    expect(await archiveRows()).toHaveLength(2);

    await repo.pruneWaitArchive(new Date('2026-08-20'));

    const rows = await archiveRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe('2026-08-25');
  });

  it('reads back archived hours for reconciliation after the raw prune (R18.3)', async () => {
    await seedSample('2026-08-05T18:05:00Z', 30);
    await seedSample('2026-08-05T18:25:00Z', 50);
    await repo.archiveWaitSamples(SINCE);
    await repo.pruneWaitSamples(new Date('2026-08-20T00:00:00Z'));

    const hours = await repo.getWaitArchiveHours(
      [expId],
      new Date('2026-08-01'),
      new Date('2026-08-10'),
    );
    expect(hours).toHaveLength(1);
    expect(hours[0]!.hour).toBe(14);
    expect(hours[0]!.avg_wait_minutes).toBeCloseTo(40, 4);
    expect(hours[0]!.sample_count).toBe(2);
  });

  // R17.5 / Property 17 — the archive must never become a prediction input.
  describe('prediction neutrality (R17.5)', () => {
    async function snapshotWaits() {
      const service = createPredictionService({ repo: repo as any, weatherClient });
      const snapshot = await service.getDaySnapshot(
        [expId],
        'Magic Kingdom',
        new Date('2026-08-05T16:00:00Z'),
      );
      return snapshot[expId]!.waits;
    }

    beforeEach(async () => {
      // A real shape so the snapshot produces non-trivial waits.
      await testPool.query(
        `INSERT INTO ride_shapes (
           experience_id, day_of_week, hour, avg_wait_minutes, sample_count,
           stddev_wait, p50_wait, p90_wait, down_rate,
           baseline_wait_minutes, baseline_sample_count
         )
         SELECT $1, dow, hr, 45, 40, 6, 44, 60, 0.02, 45, 40
         FROM generate_series(0, 6) AS dow, generate_series(9, 20) AS hr`,
        [expId],
      );
    });

    it('returns identical predictions with an empty and a populated archive', async () => {
      const before = await snapshotWaits();
      // Sanity: the fixture really does predict something.
      expect(before.some((w) => w.predictedWaitMinutes > 0)).toBe(true);

      // Populate the archive with values wildly unlike the shape, so any
      // accidental read would visibly move the prediction.
      for (let hour = 9; hour <= 20; hour++) {
        await testPool.query(
          `INSERT INTO wait_archive (experience_id, date, hour, avg_wait_minutes, sample_count, min_wait_minutes, max_wait_minutes)
           VALUES ($1, '2026-08-05', $2, 240, 12, 200, 300)`,
          [expId, hour],
        );
      }
      expect(await archiveRows()).toHaveLength(12);

      const after = await snapshotWaits();
      expect(after).toEqual(before);
    });

    it('leaves getCrowdMultiplier unchanged by archive contents', async () => {
      const service = createPredictionService({ repo: repo as any, weatherClient });
      const target = new Date('2026-08-05T16:00:00Z');
      const before = await service.getCrowdMultiplier('Magic Kingdom', target);

      await testPool.query(
        `INSERT INTO wait_archive (experience_id, date, hour, avg_wait_minutes, sample_count, min_wait_minutes, max_wait_minutes)
         VALUES ($1, '2026-08-05', 14, 240, 12, 200, 300)`,
        [expId],
      );

      expect(await service.getCrowdMultiplier('Magic Kingdom', target)).toBe(before);
    });
  });
});

/**
 * Feature: crowd-calendar, Property 18 — the frozen-prediction guarantee lives in
 * the SQL, so it needs live Postgres.
 *
 * `upsertWaitForecastLogs` deliberately omits `predicted_wait_minutes` and
 * `forecasted_at` from its ON CONFLICT UPDATE clause. If a later capture could
 * overwrite an earlier one, accuracy would be measured against a number that was
 * never issued — the exact hindsight leak R18.1 and R7.1 forbid. A mocked repo
 * cannot test that; only running the real statement can.
 */
describe.skipIf(!DB_AVAILABLE)('wait_forecast_log SQL guarantees (live Postgres)', () => {
  let adminPool: DbPool;
  let testPool: DbPool;
  let testDbName: string;
  let repo: IntelligenceRepo;
  let expId: string;
  let otherId: string;

  beforeAll(async () => {
    testDbName = `dwt_wait_fc_${randomUUID().replace(/-/g, '')}`;
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
    await testPool.query('DELETE FROM wait_forecast_log');
    await testPool.query('DELETE FROM wait_forecast_accuracy');
    await testPool.query('DELETE FROM ride_shapes');
    await testPool.query('DELETE FROM experiences');

    expId = randomUUID();
    otherId = randomUUID();
    for (const [id, name] of [
      [expId, 'Seven Dwarfs Mine Train'],
      [otherId, 'Dumbo the Flying Elephant'],
    ] as const) {
      await testPool.query(
        `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
         VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride', TRUE)`,
        [id, `upstream-${id}`, name],
      );
    }
  });

  const TARGET = new Date('2026-09-02T12:00:00-04:00');

  function log(overrides: Record<string, unknown> = {}) {
    return {
      experience_id: expId,
      date: TARGET,
      hour: 13,
      lead_days: 7,
      predicted_wait_minutes: 52,
      forecasted_at: new Date('2026-08-26T12:00:00Z'),
      challenger_wait_minutes: null,
      observed_wait_minutes: null,
      error: null,
      challenger_error: null,
      ...overrides,
    } as any;
  }

  async function rows() {
    const res = await testPool.query(
      `SELECT date::text AS date, hour, lead_days, predicted_wait_minutes, forecasted_at,
              challenger_wait_minutes, observed_wait_minutes, error, challenger_error
       FROM wait_forecast_log WHERE experience_id = $1 ORDER BY lead_days, hour`,
      [expId],
    );
    return res.rows;
  }

  it('stores the frozen prediction against the intended Eastern date', async () => {
    await repo.upsertWaitForecastLogs([log()]);

    const r = await rows();
    expect(r).toHaveLength(1);
    // The ET-noon instant must land on Sep 2, not Sep 3 via a UTC rollover.
    expect(r[0]!.date).toBe('2026-09-02');
    expect(r[0]!.predicted_wait_minutes).toBeCloseTo(52, 4);
  });

  it('does NOT overwrite predicted_wait_minutes on a repeat capture', async () => {
    await repo.upsertWaitForecastLogs([log({ predicted_wait_minutes: 52 })]);
    await repo.upsertWaitForecastLogs([
      log({ predicted_wait_minutes: 99, forecasted_at: new Date('2026-08-27T12:00:00Z') }),
    ]);

    const r = await rows();
    expect(r).toHaveLength(1);
    // Frozen: the forecast as ISSUED, and the timestamp it was issued at.
    expect(r[0]!.predicted_wait_minutes).toBeCloseTo(52, 4);
    expect(new Date(r[0]!.forecasted_at).toISOString()).toBe('2026-08-26T12:00:00.000Z');
  });

  it('lets a challenger be attached later without disturbing the frozen prediction', async () => {
    await repo.upsertWaitForecastLogs([log()]);
    await repo.upsertWaitForecastLogs([
      log({ predicted_wait_minutes: 99, challenger_wait_minutes: 44 }),
    ]);

    const r = await rows();
    expect(r[0]!.predicted_wait_minutes).toBeCloseTo(52, 4);
    expect(r[0]!.challenger_wait_minutes).toBeCloseTo(44, 4);
  });

  it('keeps an existing challenger when a later capture supplies none', async () => {
    await repo.upsertWaitForecastLogs([log({ challenger_wait_minutes: 44 })]);
    await repo.upsertWaitForecastLogs([log({ challenger_wait_minutes: null })]);

    const r = await rows();
    expect(r[0]!.challenger_wait_minutes).toBeCloseTo(44, 4);
  });

  it('accepts a batch containing a duplicated conflict key (Postgres 21000)', async () => {
    await expect(
      repo.upsertWaitForecastLogs([
        log({ predicted_wait_minutes: 10 }),
        log({ predicted_wait_minutes: 20 }),
      ]),
    ).resolves.toBeUndefined();

    const r = await rows();
    expect(r).toHaveLength(1);
  });

  it('reconciliation writes only the observed/error columns', async () => {
    await repo.upsertWaitForecastLogs([log({ predicted_wait_minutes: 52 })]);

    await repo.updateWaitForecastReconciliation([
      {
        experience_id: expId,
        date: TARGET,
        hour: 13,
        lead_days: 7,
        observed_wait_minutes: 38,
        error: 14,
        challenger_error: null,
      },
    ]);

    const r = await rows();
    expect(r[0]!.predicted_wait_minutes).toBeCloseTo(52, 4);
    expect(r[0]!.observed_wait_minutes).toBeCloseTo(38, 4);
    expect(r[0]!.error).toBeCloseTo(14, 4);
  });

  it('returns only unreconciled rows on or before the requested date', async () => {
    await repo.upsertWaitForecastLogs([
      log({ date: new Date('2026-08-25T12:00:00-04:00'), lead_days: 1 }),
      log({ date: new Date('2026-09-02T12:00:00-04:00'), lead_days: 7 }),
    ]);

    const pending = await repo.getWaitForecastLogsToReconcile(
      new Date('2026-08-25T12:00:00-04:00'),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]!.lead_days).toBe(1);

    // Once scored it drops out of the pending set.
    await repo.updateWaitForecastReconciliation([
      {
        experience_id: expId,
        date: new Date('2026-08-25T12:00:00-04:00'),
        hour: 13,
        lead_days: 1,
        observed_wait_minutes: 40,
        error: 12,
        challenger_error: null,
      },
    ]);
    expect(
      await repo.getWaitForecastLogsToReconcile(new Date('2026-08-25T12:00:00-04:00')),
    ).toHaveLength(0);
  });

  it('prunes only rows that have already been scored', async () => {
    const old = new Date('2026-01-01T12:00:00-04:00');
    await repo.upsertWaitForecastLogs([
      log({ date: old, hour: 10, lead_days: 1 }),
      log({ date: old, hour: 13, lead_days: 1 }),
    ]);
    await repo.updateWaitForecastReconciliation([
      {
        experience_id: expId,
        date: old,
        hour: 10,
        lead_days: 1,
        observed_wait_minutes: 40,
        error: 12,
        challenger_error: null,
      },
    ]);

    await repo.pruneWaitForecastLog(new Date('2026-06-01'));

    const r = await rows();
    // The scored row is gone; the unscored one survives so it is not silently
    // lost before it can ever contribute to the accuracy summary.
    expect(r).toHaveLength(1);
    expect(r[0]!.hour).toBe(13);
    expect(r[0]!.observed_wait_minutes).toBeNull();
  });

  it('round-trips the accuracy summary with a separate challenger tally', async () => {
    await repo.upsertWaitForecastAccuracies([
      {
        experience_id: expId,
        lead_days: 1,
        mae: 8.25,
        bias: -1.5,
        sample_count: 40,
        challenger_mae: 6.5,
        challenger_bias: 0.25,
        challenger_sample_count: 12,
      },
    ]);

    const accs = await repo.getWaitForecastAccuracies([expId]);
    expect(accs).toHaveLength(1);
    expect(accs[0]!.mae).toBeCloseTo(8.25, 4);
    expect(accs[0]!.sample_count).toBe(40);
    expect(accs[0]!.challenger_mae).toBeCloseTo(6.5, 4);
    expect(accs[0]!.challenger_sample_count).toBe(12);
  });

  describe('getTopExperiencesByBaseline (R18.2)', () => {
    async function seedShape(id: string, baseline: number | null, hour = 14) {
      await testPool.query(
        `INSERT INTO ride_shapes (
           experience_id, day_of_week, hour, avg_wait_minutes, sample_count,
           stddev_wait, p50_wait, p90_wait, down_rate,
           baseline_wait_minutes, baseline_sample_count
         ) VALUES ($1, 3, $2, 45, 40, 5, 44, 60, 0, $3, 40)`,
        [id, hour, baseline],
      );
    }

    it('ranks by peak frozen baseline and honours the limit', async () => {
      await seedShape(expId, 70);
      await seedShape(otherId, 12);

      const top = await repo.getTopExperiencesByBaseline(10);
      expect(top.map((t) => t.experience_id)).toEqual([expId, otherId]);
      expect(top[0]!.peak_baseline).toBeCloseTo(70, 4);
      expect(top[0]!.park).toBe('Magic Kingdom');

      expect(await repo.getTopExperiencesByBaseline(1)).toHaveLength(1);
    });

    it('excludes experiences with no established baseline', async () => {
      await seedShape(expId, 70);
      await seedShape(otherId, null);

      const top = await repo.getTopExperiencesByBaseline(10);
      expect(top.map((t) => t.experience_id)).toEqual([expId]);
    });

    it('collapses an experience to one row using its busiest hour', async () => {
      await seedShape(expId, 30, 10);
      await seedShape(expId, 85, 14);

      const top = await repo.getTopExperiencesByBaseline(10);
      expect(top).toHaveLength(1);
      expect(top[0]!.peak_baseline).toBeCloseTo(85, 4);
    });
  });
});

/**
 * Feature: crowd-calendar — R7.5 / R7.6, tasks 20.2 and 20.3 at the SQL layer.
 *
 * `getCapturedForecast` picks which frozen capture backs the "we predicted" line,
 * and `pruneCrowdForecastLog` must never delete a row that has not been scored —
 * doing so would silently drop a sample from the calibration loop. Both are real
 * queries with real ordering and filtering, so a mocked repo proves nothing.
 */
describe.skipIf(!DB_AVAILABLE)('crowd_forecast_log read + prune (live Postgres)', () => {
  let adminPool: DbPool;
  let testPool: DbPool;
  let testDbName: string;
  let repo: IntelligenceRepo;

  beforeAll(async () => {
    testDbName = `dwt_crowd_fc_${randomUUID().replace(/-/g, '')}`;
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
    await testPool.query('DELETE FROM crowd_forecast_log');
  });

  const PARK = 'Magic Kingdom';

  async function seedCapture(
    date: string,
    leadDays: number,
    forecastIndex: number,
    observedIndex: number | null = null,
  ) {
    await testPool.query(
      `INSERT INTO crowd_forecast_log
         (park, date, lead_days, forecast_index, forecasted_at, observed_index, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        PARK,
        date,
        leadDays,
        forecastIndex,
        new Date(`2026-08-0${Math.min(9, leadDays)}T12:00:00Z`),
        observedIndex,
        observedIndex === null ? null : forecastIndex - observedIndex,
      ],
    );
  }

  it('returns the earliest-issued capture for the date', async () => {
    await seedCapture('2026-08-20', 1, 1.05);
    await seedCapture('2026-08-20', 7, 1.28);
    await seedCapture('2026-08-20', 3, 1.15);

    const captured = await repo.getCapturedForecast(PARK, new Date('2026-08-20T12:00:00Z'));
    expect(captured).not.toBeNull();
    // Largest lead_days wins: the strongest honest claim, and the one least
    // contaminated by the same-day live correction.
    expect(captured!.lead_days).toBe(7);
    expect(captured!.forecast_index).toBeCloseTo(1.28, 4);
  });

  it('returns null when the date has no capture', async () => {
    await seedCapture('2026-08-20', 7, 1.28);
    expect(await repo.getCapturedForecast(PARK, new Date('2026-08-21T12:00:00Z'))).toBeNull();
  });

  it('does not leak another park\'s capture', async () => {
    await testPool.query(
      `INSERT INTO crowd_forecast_log (park, date, lead_days, forecast_index, forecasted_at)
       VALUES ('EPCOT', '2026-08-20', 7, 2.0, '2026-08-13T12:00:00Z')`,
    );
    expect(await repo.getCapturedForecast(PARK, new Date('2026-08-20T12:00:00Z'))).toBeNull();
  });

  /**
   * `toDateKey` keys a DATE column off the instant's **UTC** calendar date, and
   * that is deliberate rather than incidental. Both callers supply an instant
   * whose UTC date already equals the intended park day:
   *
   *  - `getCrowdCalendarDay` receives midnight-UTC dates from the route.
   *  - `captureForecasts` supplies ET-noon instants (16:00Z), whose UTC date is
   *    the same day.
   *
   * Converting to Eastern instead would shift a midnight-UTC date back to the
   * previous day (00:00Z Aug 20 is 20:00 ET Aug 19) and silently break every
   * calendar read. These two cases pin the convention so a future "timezone fix"
   * has to confront it explicitly.
   */
  it('resolves a midnight-UTC date (the calendar route\'s shape) to that date', async () => {
    await seedCapture('2026-08-20', 7, 1.28);

    const captured = await repo.getCapturedForecast(PARK, new Date('2026-08-20T00:00:00Z'));
    expect(captured).not.toBeNull();
    expect(captured!.lead_days).toBe(7);
  });

  it('resolves an ET-noon instant (the capture leg\'s shape) to that date', async () => {
    await seedCapture('2026-08-20', 7, 1.28);

    const captured = await repo.getCapturedForecast(PARK, new Date('2026-08-20T12:00:00-04:00'));
    expect(captured).not.toBeNull();
    expect(captured!.lead_days).toBe(7);
  });

  it('prunes scored rows past the cutoff and keeps unscored ones', async () => {
    await seedCapture('2026-01-10', 7, 1.2, 1.1); // old + scored -> pruned
    await seedCapture('2026-01-11', 7, 1.3, null); // old + UNSCORED -> kept
    await seedCapture('2026-08-20', 7, 1.28, 1.0); // recent + scored -> kept

    await repo.pruneCrowdForecastLog(new Date('2026-06-01'));

    const rows = await testPool.query(
      `SELECT date::text AS date, observed_index FROM crowd_forecast_log ORDER BY date`,
    );
    expect(rows.rows.map((r) => r.date)).toEqual(['2026-01-11', '2026-08-20']);
    // The survivor from January is precisely the one that still owes the
    // calibration loop a sample.
    expect(rows.rows[0]!.observed_index).toBeNull();
  });
});
