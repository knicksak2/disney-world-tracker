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

describe('IntelligenceRepo — recordDerivedStatRun (pg-mem)', () => {
  let db: IMemoryDb;
  let repo: IntelligenceRepo;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0020_wait_time_intelligence.sql');
    applyMigration(db, '0030_derived_stat_runs.sql');

    const pool = {
      query: async (text: string, params: any[] = []) => {
        let paramIndex = 1;
        let psql = text;
        for (const p of params) {
          const literal =
            p === null
              ? 'NULL'
              : typeof p === 'string' || p instanceof Date
                ? `'${p instanceof Date ? p.toISOString() : p.replace(/'/g, "''")}'`
                : p;
          psql = psql.split(`$${paramIndex++}`).join(String(literal));
        }
        const res = db.public.query(psql);
        return { rows: (res as any).rows || res || [] };
      },
    };
    repo = new IntelligenceRepo(pool as any);
  });

  it('drives sequence success -> failure -> failure -> success and tracks consecutive_failures, timestamps, and error clearing', async () => {
    const leg = 'recomputePercentiles';

    // Step 1: Initial success
    await repo.recordDerivedStatRun(leg, { ok: true });
    let run = await repo.getDerivedStatRun(leg);
    expect(run).not.toBeNull();
    expect(run!.leg).toBe(leg);
    expect(run!.consecutive_failures).toBe(0);
    expect(run!.last_success_at).toBeInstanceOf(Date);
    expect(run!.last_error_at).toBeNull();
    expect(run!.last_error).toBeNull();

    const firstSuccessAt = run!.last_success_at;

    // Step 2: First failure
    await repo.recordDerivedStatRun(leg, { ok: false, error: new Error('First failure reason') });
    run = await repo.getDerivedStatRun(leg);
    expect(run!.consecutive_failures).toBe(1);
    expect(run!.last_error).toBe('First failure reason');
    expect(run!.last_error_at).toBeInstanceOf(Date);
    // Step 3: Second failure
    await repo.recordDerivedStatRun(leg, { ok: false, error: 'Second failure string' });
    run = await repo.getDerivedStatRun(leg);
    expect(run!.consecutive_failures).toBe(2);
    expect(run!.last_error).toBe('Second failure string');
    expect(run!.last_error_at).toBeInstanceOf(Date);
    expect(run!.last_success_at).toEqual(firstSuccessAt); // last_success_at still survived

    // Step 4: Recovery success
    await repo.recordDerivedStatRun(leg, { ok: true });
    run = await repo.getDerivedStatRun(leg);
    expect(run!.consecutive_failures).toBe(0);
    expect(run!.last_error).toBeNull(); // cleared on success
    expect(run!.last_error_at).toBeInstanceOf(Date); // last_error_at survives so you can see when it last broke
    expect(run!.last_success_at).toBeInstanceOf(Date);
    expect(run!.last_success_at!.getTime()).toBeGreaterThanOrEqual(firstSuccessAt!.getTime());
  });

  it('truncates long error messages to 500 characters', async () => {
    const leg = 'captureForecasts';
    const longMessage = 'E'.repeat(800);

    await repo.recordDerivedStatRun(leg, { ok: false, error: new Error(longMessage) });
    const run = await repo.getDerivedStatRun(leg);

    expect(run).not.toBeNull();
    expect(run!.last_error).toHaveLength(500);
    expect(run!.last_error).toBe('E'.repeat(500));
  });

  it('handles initial failure correctly with consecutive_failures = 1 and null last_success_at', async () => {
    const leg = 'learnWeatherSensitivities';

    await repo.recordDerivedStatRun(leg, { ok: false, error: new Error('Cold start failure') });
    const run = await repo.getDerivedStatRun(leg);

    expect(run).not.toBeNull();
    expect(run!.consecutive_failures).toBe(1);
    expect(run!.last_success_at).toBeNull();
    expect(run!.last_error_at).toBeInstanceOf(Date);
    expect(run!.last_error).toBe('Cold start failure');
  });
});
