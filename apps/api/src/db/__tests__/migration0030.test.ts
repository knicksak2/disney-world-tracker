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
];

describe('migration 0030_derived_stat_runs', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const m of BASE_MIGRATIONS) {
      applyMigration(db, m);
    }
  });

  it('applies cleanly on top of 0029', () => {
    expect(() => applyMigration(db, '0030_derived_stat_runs.sql')).not.toThrow();

    db.public.none(
      `INSERT INTO derived_stat_runs (leg, last_success_at, last_error_at, last_error, consecutive_failures)
       VALUES ('recomputePercentiles', '2026-08-16T12:00:00Z', NULL, NULL, 0);`,
    );

    const rows = db.public.many(
      `SELECT leg, last_success_at, last_error_at, last_error, consecutive_failures FROM derived_stat_runs WHERE leg = 'recomputePercentiles';`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.leg).toBe('recomputePercentiles');
    expect(rows[0]!.consecutive_failures).toBe(0);
    expect(rows[0]!.last_error).toBeNull();
  });

  it('enforces primary key uniqueness on leg', () => {
    applyMigration(db, '0030_derived_stat_runs.sql');

    db.public.none(
      `INSERT INTO derived_stat_runs (leg, last_success_at, consecutive_failures)
       VALUES ('captureForecasts', '2026-08-16T12:00:00Z', 0);`,
    );

    expect(() => {
      db.public.none(
        `INSERT INTO derived_stat_runs (leg, last_success_at, consecutive_failures)
         VALUES ('captureForecasts', '2026-08-16T13:00:00Z', 0);`,
      );
    }).toThrow();
  });

  it('enforces consecutive_failures CHECK constraint (>= 0)', () => {
    applyMigration(db, '0030_derived_stat_runs.sql');

    // Valid >= 0
    expect(() => {
      db.public.none(
        `INSERT INTO derived_stat_runs (leg, consecutive_failures)
         VALUES ('leg_zero', 0);`,
      );
    }).not.toThrow();

    expect(() => {
      db.public.none(
        `INSERT INTO derived_stat_runs (leg, consecutive_failures)
         VALUES ('leg_pos', 3);`,
      );
    }).not.toThrow();

    // Invalid < 0
    expect(() => {
      db.public.none(
        `INSERT INTO derived_stat_runs (leg, consecutive_failures)
         VALUES ('leg_neg', -1);`,
      );
    }).toThrow();
  });
});
