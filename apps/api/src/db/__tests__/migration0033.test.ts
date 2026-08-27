import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

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
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

const BASE_MIGRATIONS = [
  '0001_init.sql',
  '0015_trips.sql',
  '0019_planned_item_scheduling.sql',
  '0020_wait_time_intelligence.sql',
  '0024_planned_item_optimization_result.sql',
  '0027_planned_items_soft_windows.sql',
  '0028_planned_items_meal_period_snack.sql',
  '0029_show_time_patterns.sql',
  '0030_derived_stat_runs.sql',
];

const EXPERIENCE_ID = '11111111-1111-4111-8111-111111111111';

/** Insert the one Experience the new FKs point at. */
function seedExperience(db: IMemoryDb): void {
  db.public.none(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
     VALUES ('${EXPERIENCE_ID}', '${EXPERIENCE_ID}', 'Seven Dwarfs Mine Train', 'Magic Kingdom', 'Ride', true);`,
  );
}

/**
 * Pre-existing ride_shapes / experience_season_hour rows, written BEFORE 0033
 * is applied, so the backfill assertions are about real migrated data rather
 * than rows inserted after the fact.
 */
function seedPre0033Rows(db: IMemoryDb): void {
  db.public.none(
    `INSERT INTO ride_shapes (experience_id, day_of_week, hour, avg_wait_minutes, sample_count)
     VALUES ('${EXPERIENCE_ID}', 3, 14, 42.5, 137),
            ('${EXPERIENCE_ID}', 4, 14, 30.0, 900);`,
  );
  db.public.none(
    `INSERT INTO experience_season_hour (experience_id, season, day_of_week, hour, avg_wait_minutes, sample_count)
     VALUES ('${EXPERIENCE_ID}', 2, 3, 14, 55.0, 21);`,
  );
}

describe('migration 0033_stable_baseline_and_wait_archive', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const m of BASE_MIGRATIONS) {
      applyMigration(db, m);
    }
    seedExperience(db);
    seedPre0033Rows(db);
  });

  it('applies cleanly on top of 0030', () => {
    expect(() => applyMigration(db, '0033_stable_baseline_and_wait_archive.sql')).not.toThrow();
  });

  // R14.4 — the baseline must start from the level already in the store (which
  // carries the seed's multi-year absolute average), not from a cold start.
  it('backfills baseline_wait_minutes from avg_wait_minutes for pre-existing rows', () => {
    applyMigration(db, '0033_stable_baseline_and_wait_archive.sql');

    const rows = db.public.many(
      `SELECT day_of_week, avg_wait_minutes, baseline_wait_minutes, baseline_sample_count
       FROM ride_shapes ORDER BY day_of_week;`,
    );
    expect(rows).toHaveLength(2);

    const dow3 = rows[0]!;
    expect(dow3.baseline_wait_minutes).toBeCloseTo(42.5, 5);
    expect(dow3.baseline_wait_minutes).toBeCloseTo(dow3.avg_wait_minutes as number, 5);
    // sample_count 137 is under the 500 cap, so it carries across verbatim.
    expect(dow3.baseline_sample_count).toBe(137);
  });

  // The cap keeps the seeded count consistent with what the ~500-sample EMA
  // can actually represent.
  it('caps backfilled baseline_sample_count at BASELINE_EMA_MAX_SAMPLES (500)', () => {
    applyMigration(db, '0033_stable_baseline_and_wait_archive.sql');

    const row = db.public.one(
      `SELECT sample_count, baseline_sample_count FROM ride_shapes WHERE day_of_week = 4;`,
    );
    expect(row.sample_count).toBe(900);
    expect(row.baseline_sample_count).toBe(500);
  });

  // R15.2 — asserting 1.0 would bake in a false premise about buckets that
  // accumulated under an unknown crowd level.
  it('adds experience_season_hour.avg_crowd_index as NULL, not defaulted to 1.0', () => {
    applyMigration(db, '0033_stable_baseline_and_wait_archive.sql');

    const row = db.public.one(
      `SELECT avg_wait_minutes, avg_crowd_index FROM experience_season_hour WHERE season = 2;`,
    );
    expect(row.avg_wait_minutes).toBeCloseTo(55.0, 5);
    expect(row.avg_crowd_index).toBeNull();

    // And it is writable once the sampler learns it.
    db.public.none(
      `UPDATE experience_season_hour SET avg_crowd_index = 0.93 WHERE season = 2;`,
    );
    const updated = db.public.one(
      `SELECT avg_crowd_index FROM experience_season_hour WHERE season = 2;`,
    );
    expect(updated.avg_crowd_index).toBeCloseTo(0.93, 5);
  });

  describe('wait_archive', () => {
    beforeEach(() => {
      applyMigration(db, '0033_stable_baseline_and_wait_archive.sql');
    });

    it('accepts a valid row and enforces the composite primary key', () => {
      db.public.none(
        `INSERT INTO wait_archive (experience_id, date, hour, avg_wait_minutes, sample_count, min_wait_minutes, max_wait_minutes)
         VALUES ('${EXPERIENCE_ID}', '2026-08-20', 14, 47.5, 5, 40, 55);`,
      );

      const row = db.public.one(`SELECT * FROM wait_archive;`);
      expect(row.avg_wait_minutes).toBeCloseTo(47.5, 5);
      expect(row.sample_count).toBe(5);

      expect(() => {
        db.public.none(
          `INSERT INTO wait_archive (experience_id, date, hour, avg_wait_minutes, sample_count, min_wait_minutes, max_wait_minutes)
           VALUES ('${EXPERIENCE_ID}', '2026-08-20', 14, 50, 6, 40, 60);`,
        );
      }).toThrow();
    });

    it('enforces hour, sample_count and min <= max CHECK constraints', () => {
      expect(() => {
        db.public.none(
          `INSERT INTO wait_archive (experience_id, date, hour, avg_wait_minutes, sample_count, min_wait_minutes, max_wait_minutes)
           VALUES ('${EXPERIENCE_ID}', '2026-08-21', 24, 10, 1, 10, 10);`,
        );
      }).toThrow();

      expect(() => {
        db.public.none(
          `INSERT INTO wait_archive (experience_id, date, hour, avg_wait_minutes, sample_count, min_wait_minutes, max_wait_minutes)
           VALUES ('${EXPERIENCE_ID}', '2026-08-21', 10, 10, 0, 10, 10);`,
        );
      }).toThrow();

      expect(() => {
        db.public.none(
          `INSERT INTO wait_archive (experience_id, date, hour, avg_wait_minutes, sample_count, min_wait_minutes, max_wait_minutes)
           VALUES ('${EXPERIENCE_ID}', '2026-08-21', 10, 10, 1, 60, 20);`,
        );
      }).toThrow();
    });
  });

  describe('wait_forecast_log / wait_forecast_accuracy', () => {
    beforeEach(() => {
      applyMigration(db, '0033_stable_baseline_and_wait_archive.sql');
    });

    it('stores a frozen prediction with nullable challenger and reconciliation columns', () => {
      db.public.none(
        `INSERT INTO wait_forecast_log
           (experience_id, date, hour, lead_days, predicted_wait_minutes, forecasted_at)
         VALUES ('${EXPERIENCE_ID}', '2026-09-01', 13, 7, 52.0, '2026-08-25T12:00:00Z');`,
      );

      const row = db.public.one(`SELECT * FROM wait_forecast_log;`);
      expect(row.predicted_wait_minutes).toBeCloseTo(52.0, 5);
      expect(row.challenger_wait_minutes).toBeNull();
      expect(row.observed_wait_minutes).toBeNull();
      expect(row.error).toBeNull();
      expect(row.challenger_error).toBeNull();

      // Reconciliation fills only the observed/error columns.
      db.public.none(
        `UPDATE wait_forecast_log
         SET observed_wait_minutes = 45.0, error = 7.0
         WHERE experience_id = '${EXPERIENCE_ID}' AND date = '2026-09-01' AND hour = 13 AND lead_days = 7;`,
      );
      const reconciled = db.public.one(
        `SELECT predicted_wait_minutes, observed_wait_minutes, error FROM wait_forecast_log;`,
      );
      expect(reconciled.predicted_wait_minutes).toBeCloseTo(52.0, 5);
      expect(reconciled.observed_wait_minutes).toBeCloseTo(45.0, 5);
      expect(reconciled.error).toBeCloseTo(7.0, 5);
    });

    it('keys the log by (experience, date, hour, lead_days) so different leads coexist', () => {
      db.public.none(
        `INSERT INTO wait_forecast_log
           (experience_id, date, hour, lead_days, predicted_wait_minutes, forecasted_at)
         VALUES ('${EXPERIENCE_ID}', '2026-09-01', 13, 7, 52.0, '2026-08-25T12:00:00Z'),
                ('${EXPERIENCE_ID}', '2026-09-01', 13, 1, 48.0, '2026-08-31T12:00:00Z');`,
      );

      const rows = db.public.many(
        `SELECT lead_days, predicted_wait_minutes FROM wait_forecast_log ORDER BY lead_days;`,
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]!.lead_days).toBe(1);
      expect(rows[1]!.lead_days).toBe(7);

      expect(() => {
        db.public.none(
          `INSERT INTO wait_forecast_log
             (experience_id, date, hour, lead_days, predicted_wait_minutes, forecasted_at)
           VALUES ('${EXPERIENCE_ID}', '2026-09-01', 13, 7, 99.0, '2026-08-26T12:00:00Z');`,
        );
      }).toThrow();
    });

    it('keeps challenger accuracy in separate columns defaulting to a zero tally', () => {
      db.public.none(
        `INSERT INTO wait_forecast_accuracy (experience_id, lead_days, mae, bias, sample_count)
         VALUES ('${EXPERIENCE_ID}', 1, 8.25, -1.5, 40);`,
      );

      const row = db.public.one(`SELECT * FROM wait_forecast_accuracy;`);
      expect(row.mae).toBeCloseTo(8.25, 5);
      expect(row.bias).toBeCloseTo(-1.5, 5);
      expect(row.sample_count).toBe(40);
      expect(row.challenger_mae).toBeNull();
      expect(row.challenger_bias).toBeNull();
      expect(row.challenger_sample_count).toBe(0);
    });

    it('rejects a negative sample_count on either tally', () => {
      expect(() => {
        db.public.none(
          `INSERT INTO wait_forecast_accuracy (experience_id, lead_days, sample_count)
           VALUES ('${EXPERIENCE_ID}', 3, -1);`,
        );
      }).toThrow();

      expect(() => {
        db.public.none(
          `INSERT INTO wait_forecast_accuracy (experience_id, lead_days, challenger_sample_count)
           VALUES ('${EXPERIENCE_ID}', 3, -1);`,
        );
      }).toThrow();
    });
  });
});
