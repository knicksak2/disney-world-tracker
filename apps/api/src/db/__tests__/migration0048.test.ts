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

// Sample of curated attractions across parks in migration 0048
const CURATED_SAMPLE = [
  // EPCOT
  { upstreamEntityId: '19497835;entityType=Attraction', name: "Remy's Ratatouille Adventure", expected: 5 },
  { upstreamEntityId: '411499845;entityType=Attraction', name: 'Guardians of the Galaxy: Cosmic Rewind', expected: 3 },
  { upstreamEntityId: '80010191;entityType=Attraction', name: 'Spaceship Earth', expected: 16 },
  { upstreamEntityId: '80010161;entityType=Attraction', name: 'Living with the Land', expected: 14 },
  { upstreamEntityId: '62992;entityType=Attraction', name: 'Turtle Talk With Crush', expected: 15 },
  // Hollywood Studios
  { upstreamEntityId: '80010193;entityType=Attraction', name: 'Star Tours – The Adventures Continue', expected: 5 },
  { upstreamEntityId: '19263736;entityType=Attraction', name: 'Star Wars: Rise of the Resistance', expected: 18 },
  { upstreamEntityId: '18904138;entityType=Attraction', name: 'Slinky Dog Dash', expected: 3 },
  { upstreamEntityId: '136;entityType=Entertainment', name: 'Indiana Jones™ Epic Stunt Spectacular!', expected: 30 },
  // Animal Kingdom
  { upstreamEntityId: '80010154;entityType=Attraction', name: 'Kali River Rapids', expected: 5 },
  { upstreamEntityId: '12432;entityType=Entertainment', name: 'Festival of the Lion King', expected: 30 },
  // Magic Kingdom
  { upstreamEntityId: '80010177;entityType=Attraction', name: 'Pirates of the Caribbean', expected: 9 },
  { upstreamEntityId: '80010190;entityType=Attraction', name: 'Space Mountain', expected: 10 },
  { upstreamEntityId: '411504498;entityType=Attraction', name: 'TRON Lightcycle / Run', expected: 2 },
  { upstreamEntityId: '412021364;entityType=Attraction', name: "Tiana's Bayou Adventure", expected: 11 },
  // Water Parks
  { upstreamEntityId: '14200;entityType=Attraction', name: "Crush 'n' Gusher", expected: 3 },
  { upstreamEntityId: '80010195;entityType=Attraction', name: 'Summit Plummet', expected: 1 },
] as const;

const NON_CURATED_UPSTREAM_ID = '99999999;entityType=Attraction';

describe('migration 0048_comprehensive_attraction_durations', () => {
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
       VALUES ($1, $2, $3, 'EPCOT', 'Ride', '')`,
      [id, upstreamEntityId, name],
    );
    return id;
  }

  it('sets duration_minutes to the curated values across all parks', async () => {
    for (const c of CURATED_SAMPLE) {
      await insertExperience(c.upstreamEntityId, c.name);
    }
    await insertExperience(NON_CURATED_UPSTREAM_ID, 'Some Other Attraction');

    applyMigration(db, '0048_comprehensive_attraction_durations.sql');

    for (const c of CURATED_SAMPLE) {
      const res = await pool.query(
        `SELECT duration_minutes FROM experiences WHERE upstream_entity_id = $1`,
        [c.upstreamEntityId],
      );
      expect(res.rows[0].duration_minutes).toBe(c.expected);
    }
  });

  it('leaves a non-curated experience unaffected (duration_minutes stays null)', async () => {
    await insertExperience(NON_CURATED_UPSTREAM_ID, 'Some Other Attraction');

    applyMigration(db, '0048_comprehensive_attraction_durations.sql');

    const res = await pool.query(
      `SELECT duration_minutes FROM experiences WHERE upstream_entity_id = $1`,
      [NON_CURATED_UPSTREAM_ID],
    );
    expect(res.rows[0].duration_minutes).toBeNull();
  });

  it('is idempotent on reapply', async () => {
    for (const c of CURATED_SAMPLE) {
      await insertExperience(c.upstreamEntityId, c.name);
    }

    applyMigration(db, '0048_comprehensive_attraction_durations.sql');
    applyMigration(db, '0048_comprehensive_attraction_durations.sql');

    for (const c of CURATED_SAMPLE) {
      const res = await pool.query(
        `SELECT duration_minutes FROM experiences WHERE upstream_entity_id = $1`,
        [c.upstreamEntityId],
      );
      expect(res.rows[0].duration_minutes).toBe(c.expected);
    }
  });
});
