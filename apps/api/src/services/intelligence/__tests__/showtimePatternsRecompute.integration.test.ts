import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';
import { IntelligenceRepo } from '../IntelligenceRepo.js';
import { createDerivedStatsService } from '../derivedStatsService.js';
import type { PredictionService } from '../predictionService.js';

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
  pub.registerFunction({
    name: 'date_trunc',
    args: [DataType.text, DataType.timestamptz],
    returns: DataType.timestamptz,
    implementation: (unit: unknown, d: unknown): Date => {
      const dt = new Date(d as string | number | Date);
      if (unit === 'hour') dt.setUTCMinutes(0, 0, 0);
      return dt;
    },
  });
  pub.registerFunction({
    name: 'to_char',
    args: [DataType.date, DataType.text],
    returns: DataType.text,
    implementation: (d: unknown, _format: unknown): string => {
      if (d instanceof Date) return d.toISOString().split('T')[0]!;
      return String(d).split('T')[0]!;
    },
  });

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

const ALL_MIGRATIONS = [
  '0001_init.sql',
  '0020_wait_time_intelligence.sql',
  '0029_show_time_patterns.sql',
  '0030_derived_stat_runs.sql',
];

describe('showtimePatterns derivation real SQL integration test', () => {
  let db: IMemoryDb;
  let repo: IntelligenceRepo;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const m of ALL_MIGRATIONS) {
      applyMigration(db, m);
    }
    const { Pool } = db.adapters.createPg();
    repo = new IntelligenceRepo(new Pool() as any);
  });

  it('derives show_time_patterns from ISO instants in both EST and EDT dates, yielding start_minutes = 600', async () => {
    const expId = randomUUID();
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
       VALUES ('${expId}', '${expId}', 'Festival of the Lion King', 'Animal Kingdom', 'Show', true);`,
    );

    // Seed 4 Sundays with 10:00 AM showtimes stored as raw ThemeParks objects:
    // Oct 4, Oct 11, Oct 18 are EDT (UTC-4) -> 10:00:00-04:00 (14:00:00.000Z)
    // Nov 8 is EST (UTC-5) -> 10:00:00-05:00 (15:00:00.000Z)
    // Nov 8 also has a 1:00 PM EST show -> 13:00:00-05:00 (18:00:00.000Z / 780m) on only 1 date (excluded)
    db.public.none(`
      INSERT INTO experience_daily_signals (experience_id, date, showtimes)
      VALUES
        ('${expId}', '2026-10-04', '[{"type":"Performance Time","startTime":"2026-10-04T10:00:00-04:00","endTime":"2026-10-04T10:00:00-04:00"}]'::jsonb),
        ('${expId}', '2026-10-11', '[{"type":"Performance Time","startTime":"2026-10-11T10:00:00-04:00","endTime":"2026-10-11T10:00:00-04:00"}]'::jsonb),
        ('${expId}', '2026-10-18', '[{"type":"Performance Time","startTime":"2026-10-18T10:02:00-04:00","endTime":"2026-10-18T10:02:00-04:00"}]'::jsonb),
        ('${expId}', '2026-11-08', '[{"type":"Performance Time","startTime":"2026-11-08T10:00:00-05:00","endTime":"2026-11-08T10:00:00-05:00"}, {"type":"Performance Time","startTime":"2026-11-08T13:00:00-05:00","endTime":"2026-11-08T13:00:00-05:00"}]'::jsonb);
    `);

    const dummyPredictionService = {
      getRawForecast: async () => 1.0,
    // captureForecasts freezes the CALIBRATED forecast (R7.7); without this the
    // leg would throw, be swallowed per-lead, and capture nothing silently.
    getCalibratedForecast: async () => 1.0,
    } as unknown as PredictionService;

    const service = createDerivedStatsService({
      repo,
      predictionService: dummyPredictionService,
      now: () => new Date('2026-11-15T12:00:00-05:00'),
    });

    await service.runDailyRecompute();

    // Query show_time_patterns for Sunday (dow = 0)
    const patterns = await repo.getShowTimePatterns([expId], 0);

    // Expect exactly 1 pattern at start_minutes = 600 (appeared on 4 of 4 dates = frequency 1.0, sample_count 4)
    // 780m only appeared on 1 of 4 dates -> frequency 0.25 < 0.5, sample_count 1 < 3 -> excluded
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!).toEqual({
      experience_id: expId,
      day_of_week: 0,
      start_minutes: 600,
      frequency: 1.0,
      sample_count: 4,
    });
  });
});
