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
  '0020_wait_time_intelligence.sql',
];

describe('migration 0021_crowd_index_source', () => {
  let db: IMemoryDb;
  let pool: any;
  let repo: IntelligenceRepo;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }
    applyMigration(db, '0021_crowd_index_source.sql');
    
    // Create a mock pool that passes queries to pg-mem
    pool = {
      query: async (text: string, params: any[] = []) => {
        let paramIndex = 1;
        let psql = text;
        for (const p of params) {
          psql = psql.split(`$${paramIndex++}`).join(typeof p === 'string' ? `'${p}'` : p);
        }
        const res = db.public.query(psql);
        return { rows: res.rows || res || [] };
      }
    };
    repo = new IntelligenceRepo(pool as any);
  });

  it('allows valid sources and defaults to observed', async () => {
    // Default to observed
    db.public.none(`
      INSERT INTO park_crowd_index (park, date, crowd_index, daily_avg_wait, sample_count)
      VALUES ('Magic Kingdom', '2026-01-01', 1.0, 30, 10)
    `);

    let res = db.public.query(`SELECT source FROM park_crowd_index WHERE date = '2026-01-01'`);
    expect(res.rows[0].source).toBe('observed');

    // Allows seed
    db.public.none(`
      INSERT INTO park_crowd_index (park, date, crowd_index, daily_avg_wait, sample_count, source)
      VALUES ('EPCOT', '2026-01-01', 1.0, 30, 10, 'seed')
    `);

    res = db.public.query(`SELECT source FROM park_crowd_index WHERE date = '2026-01-01' AND park = 'EPCOT'`);
    expect(res.rows[0].source).toBe('seed');
  });

  it('throws on invalid source', async () => {
    expect(() => db.public.none(`
      INSERT INTO park_crowd_index (park, date, crowd_index, daily_avg_wait, sample_count, source)
      VALUES ('Magic Kingdom', '2026-01-02', 1.0, 30, 10, 'invalid')
    `)).toThrow(/check constraint.*violated/i);
  });

  it('getParkRollingBaseline ignores seed rows', async () => {
    // Insert observed row
    db.public.none(`
      INSERT INTO park_crowd_index (park, date, crowd_index, daily_avg_wait, sample_count, source)
      VALUES ('Hollywood Studios', '2026-01-03', 1.0, 40, 10, 'observed')
    `);
    
    // Insert seed row with different daily_avg_wait
    db.public.none(`
      INSERT INTO park_crowd_index (park, date, crowd_index, daily_avg_wait, sample_count, source)
      VALUES ('Hollywood Studios', '2026-01-04', 1.0, 0, 0, 'seed')
    `);

    const baseline = await repo.getParkRollingBaseline('Hollywood Studios');
    // Baseline should just be the average of the observed row(s), ignoring the seed row (which has daily_avg_wait 0)
    expect(baseline).toBe(40);
  });
});
