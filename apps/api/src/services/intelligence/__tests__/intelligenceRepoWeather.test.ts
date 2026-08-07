import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';
import { IntelligenceRepo } from '../IntelligenceRepo.js';

/**
 * Real-SQL coverage for the wait×weather join that feeds weather-sensitivity
 * learning, and the observed-weather prune. Runs the actual queries against
 * pg-mem with the same schema the migration creates.
 */

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
  // Postgres has date_trunc natively; pg-mem does not, so register an hour-truncation.
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

describe('IntelligenceRepo — wait×weather aggregation + observation prune', () => {
  let db: IMemoryDb;
  let repo: IntelligenceRepo;
  let expId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0020_wait_time_intelligence.sql');

    const pool = {
      query: async (text: string, params: any[] = []) => {
        let paramIndex = 1;
        let psql = text;
        for (const p of params) {
          const literal =
            typeof p === 'string' || p instanceof Date
              ? `'${p instanceof Date ? p.toISOString() : p}'`
              : p;
          psql = psql.split(`$${paramIndex++}`).join(String(literal));
        }
        const res = db.public.query(psql);
        return { rows: (res as any).rows || res || [] };
      },
    };
    repo = new IntelligenceRepo(pool as any);

    expId = randomUUID();
    db.public.none(`
      INSERT INTO experiences (id, upstream_entity_id, name, park, category)
      VALUES ('${expId}', '${expId}', 'Test Ride', 'Magic Kingdom', 'Ride')
    `);

    // Weather: clear at 10:00Z, rain at 12:00Z.
    db.public.none(`
      INSERT INTO weather_observations (observed_at, temp_f, precip, condition)
      VALUES
        ('2026-08-05T10:00:00Z', 85, 0, 'clear'),
        ('2026-08-05T12:00:00Z', 78, 0.4, 'rain')
    `);

    // Waits: two operating samples in the clear hour (avg 35), one in the rain hour (60).
    // Plus a DOWN sample and a 0-wait sample in the clear hour that must be excluded.
    db.public.none(`
      INSERT INTO wait_samples (experience_id, observed_at, wait_minutes, status)
      VALUES
        ('${expId}', '2026-08-05T10:15:00Z', 30, 'OPERATING'),
        ('${expId}', '2026-08-05T10:45:00Z', 40, 'OPERATING'),
        ('${expId}', '2026-08-05T10:30:00Z', 0,  'OPERATING'),
        ('${expId}', '2026-08-05T10:05:00Z', 99, 'DOWN'),
        ('${expId}', '2026-08-05T12:20:00Z', 60, 'OPERATING')
    `);
  });

  it('aggregates operating, positive waits by experience and same-hour weather condition', async () => {
    const rows = await repo.getWaitWeatherAggregates(new Date('2026-08-01T00:00:00Z'));

    const clear = rows.find((r) => r.condition === 'clear');
    const rain = rows.find((r) => r.condition === 'rain');

    expect(clear).toBeDefined();
    expect(clear!.experience_id).toBe(expId);
    expect(clear!.avg_wait).toBeCloseTo(35, 5); // (30 + 40) / 2, the 0-wait and DOWN excluded
    expect(clear!.sample_count).toBe(2);

    expect(rain).toBeDefined();
    expect(rain!.avg_wait).toBeCloseTo(60, 5);
    expect(rain!.sample_count).toBe(1);
  });

  it('excludes samples older than the since cutoff', async () => {
    const rows = await repo.getWaitWeatherAggregates(new Date('2026-08-05T11:00:00Z'));
    // Only the rain-hour (12:00Z) samples remain in range.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.condition).toBe('rain');
  });

  it('pruneWeatherObservations deletes only rows older than the cutoff', async () => {
    await repo.pruneWeatherObservations(new Date('2026-08-05T11:00:00Z'));
    const res = db.public.query(`SELECT condition FROM weather_observations ORDER BY observed_at ASC`);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].condition).toBe('rain');
  });
});

describe('IntelligenceRepo — getExperiencesWithUpstreamIds excludes inactive experiences', () => {
  let db: IMemoryDb;
  let repo: IntelligenceRepo;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');

    const pool = {
      query: async (text: string, params: any[] = []) => {
        let paramIndex = 1;
        let psql = text;
        for (const p of params) {
          const literal =
            typeof p === 'string' || p instanceof Date
              ? `'${p instanceof Date ? p.toISOString() : p}'`
              : p;
          psql = psql.split(`$${paramIndex++}`).join(String(literal));
        }
        const res = db.public.query(psql);
        return { rows: (res as any).rows || res || [] };
      },
    };
    repo = new IntelligenceRepo(pool as any);
  });

  it('returns only active experiences, excluding inactive (e.g. legacy GUID-keyed) rows', async () => {
    const activeId = randomUUID();
    const inactiveId = randomUUID();
    // Active row with a normal Enterprise_Id upstream.
    db.public.none(`
      INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
      VALUES ('${activeId}', '80010110;entityType=Attraction', 'Active Ride', 'Magic Kingdom', 'Ride', true)
    `);
    // Inactive legacy row with a GUID upstream (the orphaned re-keying artifact).
    db.public.none(`
      INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
      VALUES ('${inactiveId}', 'de3309ca-97d5-4211-bffe-739fed47e92f', 'Legacy Ride', 'Magic Kingdom', 'Ride', false)
    `);

    const rows = await repo.getExperiencesWithUpstreamIds();
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(inactiveId);
  });
});
