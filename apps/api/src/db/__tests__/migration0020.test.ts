import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';
import { IntelligenceRepo } from '../../services/intelligence/IntelligenceRepo.js';

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
    implementation: (s: unknown): number => typeof s === 'string' ? s.length : 0,
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => typeof s === 'string' ? s.toLowerCase() : '',
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
];

describe('migration 0020_wait_time_intelligence', () => {
  let db: IMemoryDb;
  let pool: any;
  let repo: IntelligenceRepo;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }
    applyMigration(db, '0020_wait_time_intelligence.sql');
    
    // Create a mock pool that passes queries to pg-mem
    pool = {
      query: async (text: string, params: any[] = []) => {
        let paramIndex = 1;
        let psql = text;
        for (const p of params) {
          psql = psql.split(`$${paramIndex++}`).join(typeof p === 'string' || p instanceof Date ? `'${p instanceof Date ? p.toISOString() : p}'` : p);
        }
        const res = db.public.query(psql);
        return { rows: res.rows || res || [] };
      }
    };
    repo = new IntelligenceRepo(pool as any);
  });

  it('creates all 13 intelligence tables', () => {
    const tables = [
      'ride_shapes',
      'experience_season_hour',
      'park_crowd_index',
      'park_schedule_signals',
      'crowd_forecast_log',
      'crowd_forecast_accuracy',
      'experience_signals',
      'experience_daily_signals',
      'weather_observations',
      'experience_weather_sensitivity',
      'experience_event_impact',
      'ride_cascade',
      'wait_samples'
    ];

    for (const table of tables) {
      // (a) each table exists (a trivial SELECT succeeds)
      expect(() => db.public.query(`SELECT * FROM ${table} LIMIT 1`)).not.toThrow();
    }
  });

  it('ride_shapes day_of_week check constraint rejects day_of_week = 7', () => {
    // Generate an experience first to satisfy FK
    const experienceId = randomUUID();
    db.public.none(`
      INSERT INTO experiences (id, upstream_entity_id, name, park, category) 
      VALUES ('${experienceId}', '${experienceId}', 'Test Ride', 'Magic Kingdom', 'Ride')
    `);

    // Valid insert (day_of_week 0)
    expect(() => db.public.none(`
      INSERT INTO ride_shapes (experience_id, day_of_week, hour, avg_wait_minutes, sample_count)
      VALUES ('${experienceId}', 0, 10, 30.5, 10)
    `)).not.toThrow();

    // Invalid insert (day_of_week 7)
    // (b) the ride_shapes day_of_week CHECK(0..6) rejects day_of_week = 7
    expect(() => db.public.none(`
      INSERT INTO ride_shapes (experience_id, day_of_week, hour, avg_wait_minutes, sample_count)
      VALUES ('${experienceId}', 7, 10, 30.5, 10)
    `)).toThrow(/check constraint.*violated/i);
  });

  it('IntelligenceRepo.pruneWaitSamples(before) deletes only wait_samples older than the cutoff', async () => {
    const experienceId = randomUUID();
    db.public.none(`
      INSERT INTO experiences (id, upstream_entity_id, name, park, category) 
      VALUES ('${experienceId}', '${experienceId}', 'Test Ride', 'Magic Kingdom', 'Ride')
    `);

    // Insert wait samples at different times
    db.public.none(`
      INSERT INTO wait_samples (experience_id, observed_at, wait_minutes, status)
      VALUES 
      ('${experienceId}', '2026-01-01T10:00:00Z', 30, 'operating'),
      ('${experienceId}', '2026-01-01T12:00:00Z', 45, 'operating'),
      ('${experienceId}', '2026-01-02T10:00:00Z', 60, 'operating')
    `);

    // Prune before 2026-01-01 11:00:00Z
    const cutoff = new Date('2026-01-01T11:00:00Z');
    await repo.pruneWaitSamples(cutoff);

    // Verify only the older sample was deleted
    const res = db.public.query(`SELECT observed_at FROM wait_samples ORDER BY observed_at ASC`);
    const remaining = res.rows;
    
    expect(remaining).toHaveLength(2);
    // Note: pg-mem returns strings or numbers for dates depending on config, check ISO string
    expect(new Date(remaining[0].observed_at).toISOString()).toBe('2026-01-01T12:00:00.000Z');
    expect(new Date(remaining[1].observed_at).toISOString()).toBe('2026-01-02T10:00:00.000Z');
  });
});
