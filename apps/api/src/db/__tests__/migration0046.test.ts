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

const BASE_MIGRATIONS = ['0001_init.sql', '0015_trips.sql', '0019_planned_item_scheduling.sql'];

// The five curated attractions from Requirement 11.4, plus a control row that
// is NOT in the curated set (must remain unaffected).
const CURATED = [
  { upstreamEntityId: '18665186;entityType=Attraction', name: 'Avatar Flight of Passage', expected: 12 },
  { upstreamEntityId: '18665185;entityType=Attraction', name: "Na'vi River Journey", expected: 5 },
  { upstreamEntityId: '80010157;entityType=Attraction', name: 'Kilimanjaro Safaris', expected: 20 },
  { upstreamEntityId: '26068;entityType=Attraction', name: 'Expedition Everest - Legend of the Forbidden Mountain', expected: 4 },
  { upstreamEntityId: '412430582;entityType=Attraction', name: 'Zootopia: Better Zoogether! - NEW!', expected: 9 },
] as const;

const NON_CURATED_UPSTREAM_ID = '99999999;entityType=Attraction';

describe('migration 0046_curated_attraction_durations', () => {
  let db: IMemoryDb;
  let pool: any;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }

    pool = {
      query: async (text: string, params: any[] = []) => {
        let paramIndex = 1;
        let psql = text;
        for (const p of params) {
          const literal =
            typeof p === 'string' || p instanceof Date
              ? `'${(p instanceof Date ? p.toISOString() : (p as string)).replace(/'/g, "''")}'`
              : p;
          psql = psql.split(`$${paramIndex++}`).join(literal);
        }
        const res = db.public.query(psql);
        return { rows: res.rows || res || [] };
      },
    };
  });

  async function insertExperience(upstreamEntityId: string, name: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, description)
       VALUES ($1, $2, $3, 'Animal Kingdom', 'Ride', '')`,
      [id, upstreamEntityId, name],
    );
    return id;
  }

  it('sets duration_minutes to the curated value for each of the 5 attractions', async () => {
    for (const c of CURATED) {
      await insertExperience(c.upstreamEntityId, c.name);
    }
    await insertExperience(NON_CURATED_UPSTREAM_ID, 'Some Other Attraction');

    applyMigration(db, '0046_curated_attraction_durations.sql');

    for (const c of CURATED) {
      const res = await pool.query(
        `SELECT duration_minutes FROM experiences WHERE upstream_entity_id = $1`,
        [c.upstreamEntityId],
      );
      expect(res.rows[0].duration_minutes).toBe(c.expected);
    }
  });

  it('leaves a non-curated experience unaffected (duration_minutes stays null)', async () => {
    await insertExperience(NON_CURATED_UPSTREAM_ID, 'Some Other Attraction');

    applyMigration(db, '0046_curated_attraction_durations.sql');

    const res = await pool.query(
      `SELECT duration_minutes FROM experiences WHERE upstream_entity_id = $1`,
      [NON_CURATED_UPSTREAM_ID],
    );
    expect(res.rows[0].duration_minutes).toBeNull();
  });

  it('is idempotent on reapply — applying twice produces the same values with no error', async () => {
    for (const c of CURATED) {
      await insertExperience(c.upstreamEntityId, c.name);
    }

    applyMigration(db, '0046_curated_attraction_durations.sql');
    applyMigration(db, '0046_curated_attraction_durations.sql');

    for (const c of CURATED) {
      const res = await pool.query(
        `SELECT duration_minutes FROM experiences WHERE upstream_entity_id = $1`,
        [c.upstreamEntityId],
      );
      expect(res.rows[0].duration_minutes).toBe(c.expected);
    }
  });
});
