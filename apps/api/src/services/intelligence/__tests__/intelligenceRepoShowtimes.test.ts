import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';
import { IntelligenceRepo } from '../IntelligenceRepo.js';

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
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

describe('IntelligenceRepo — upsertExperienceDailySignals showtimes accumulation (pg-mem)', () => {
  let db: IMemoryDb;
  let repo: IntelligenceRepo;
  let expId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0020_wait_time_intelligence.sql');

    expId = randomUUID();
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
       VALUES ('${expId}', '${expId}', 'Indiana Jones Epic Stunt Spectacular!', 'Hollywood Studios', 'Show', true);`,
    );

    const { Pool } = db.adapters.createPg();
    repo = new IntelligenceRepo(new Pool() as any);
  });

  it('accumulates showtimes across sampling passes instead of overwriting, keeping newest values for other columns', async () => {
    const targetDate = new Date('2026-08-17');

    const fiveShowtimes = [
      { type: 'Performance Time', startTime: '2026-08-17T10:45:00-04:00', endTime: '2026-08-17T10:45:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T12:00:00-04:00', endTime: '2026-08-17T12:00:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T13:15:00-04:00', endTime: '2026-08-17T13:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T15:15:00-04:00', endTime: '2026-08-17T15:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T16:30:00-04:00', endTime: '2026-08-17T16:30:00-04:00' },
    ];

    // Pass 1: Morning pass sees all 5 showtimes
    await repo.upsertExperienceDailySignals([
      {
        experience_id: expId,
        date: targetDate,
        ll_price_cents: 1500,
        ll_available: true,
        used_virtual_queue: false,
        showtimes: fiveShowtimes,
      },
    ]);

    // Pass 2: Afternoon pass sees only the last 2 remaining showtimes, and updated LL price / availability
    const lastTwoShowtimes = [
      { type: 'Performance Time', startTime: '2026-08-17T15:15:00-04:00', endTime: '2026-08-17T15:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-17T16:30:00-04:00', endTime: '2026-08-17T16:30:00-04:00' },
    ];

    await repo.upsertExperienceDailySignals([
      {
        experience_id: expId,
        date: targetDate,
        ll_price_cents: 2000,
        ll_available: false,
        used_virtual_queue: true,
        showtimes: lastTwoShowtimes,
      },
    ]);

    // Read back the row from the database
    const rows = await repo.getExperienceDailySignals([expId], targetDate);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    // Non-showtime columns take the newest values
    expect(row.ll_price_cents).toBe(2000);
    expect(row.ll_available).toBe(false);
    expect(row.used_virtual_queue).toBe(true);

    // Showtimes are merged (all 5 present, sorted, deduplicated)
    expect(row.showtimes).toEqual(fiveShowtimes);
  });

  it('deduplicates multiple signals for the same (experience_id, date) within a single batch without error 21000', async () => {
    const targetDate = new Date('2026-08-18');

    const firstPassShowtimes = [
      { type: 'Performance Time', startTime: '2026-08-18T10:45:00-04:00', endTime: '2026-08-18T10:45:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-18T12:00:00-04:00', endTime: '2026-08-18T12:00:00-04:00' },
    ];

    const secondPassShowtimes = [
      { type: 'Performance Time', startTime: '2026-08-18T13:15:00-04:00', endTime: '2026-08-18T13:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-18T15:15:00-04:00', endTime: '2026-08-18T15:15:00-04:00' },
    ];

    // Single batch contains two records for the same (experience_id, date)
    await repo.upsertExperienceDailySignals([
      {
        experience_id: expId,
        date: targetDate,
        ll_price_cents: 1500,
        ll_available: true,
        used_virtual_queue: false,
        showtimes: firstPassShowtimes,
      },
      {
        experience_id: expId,
        date: targetDate,
        ll_price_cents: 2200,
        ll_available: true,
        used_virtual_queue: true,
        showtimes: secondPassShowtimes,
      },
    ]);

    const rows = await repo.getExperienceDailySignals([expId], targetDate);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    expect(row.ll_price_cents).toBe(2200);
    expect(row.used_virtual_queue).toBe(true);
    expect(row.showtimes).toEqual([
      { type: 'Performance Time', startTime: '2026-08-18T10:45:00-04:00', endTime: '2026-08-18T10:45:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-18T12:00:00-04:00', endTime: '2026-08-18T12:00:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-18T13:15:00-04:00', endTime: '2026-08-18T13:15:00-04:00' },
      { type: 'Performance Time', startTime: '2026-08-18T15:15:00-04:00', endTime: '2026-08-18T15:15:00-04:00' },
    ]);
  });
});

