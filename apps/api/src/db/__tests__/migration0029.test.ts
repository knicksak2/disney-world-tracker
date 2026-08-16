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
  '0024_planned_item_optimization_result.sql',
  '0027_planned_items_soft_windows.sql',
  '0028_planned_items_meal_period_snack.sql',
];

describe('migration 0029_show_time_patterns', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const m of BASE_MIGRATIONS) {
      applyMigration(db, m);
    }
  });

  it('applies cleanly on top of 0028', () => {
    expect(() => applyMigration(db, '0029_show_time_patterns.sql')).not.toThrow();

    const expId = randomUUID();
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
       VALUES ('${expId}', '${expId}', 'Festival of the Lion King', 'Animal Kingdom', 'Show', true);`,
    );

    db.public.none(
      `INSERT INTO show_time_patterns (experience_id, day_of_week, start_minutes, frequency, sample_count)
       VALUES ('${expId}', 0, 600, 0.8, 4);`,
    );

    const rows = db.public.many(
      `SELECT experience_id, day_of_week, start_minutes, frequency, sample_count FROM show_time_patterns WHERE experience_id = '${expId}';`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.experience_id).toBe(expId);
    expect(rows[0]!.day_of_week).toBe(0);
    expect(rows[0]!.start_minutes).toBe(600);
    expect(rows[0]!.frequency).toBeCloseTo(0.8);
    expect(rows[0]!.sample_count).toBe(4);
  });

  it('enforces day_of_week CHECK constraint (0-6)', () => {
    applyMigration(db, '0029_show_time_patterns.sql');

    const expId = randomUUID();
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
       VALUES ('${expId}', '${expId}', 'Beauty and the Beast', 'Hollywood Studios', 'Show', true);`,
    );

    // Valid bounds 0 and 6
    expect(() => {
      db.public.none(
        `INSERT INTO show_time_patterns (experience_id, day_of_week, start_minutes, frequency, sample_count)
         VALUES ('${expId}', 0, 660, 1.0, 5);`,
      );
    }).not.toThrow();

    expect(() => {
      db.public.none(
        `INSERT INTO show_time_patterns (experience_id, day_of_week, start_minutes, frequency, sample_count)
         VALUES ('${expId}', 6, 660, 1.0, 5);`,
      );
    }).not.toThrow();

    // Invalid < 0 or > 6
    expect(() => {
      db.public.none(
        `INSERT INTO show_time_patterns (experience_id, day_of_week, start_minutes, frequency, sample_count)
         VALUES ('${expId}', -1, 660, 1.0, 5);`,
      );
    }).toThrow();

    expect(() => {
      db.public.none(
        `INSERT INTO show_time_patterns (experience_id, day_of_week, start_minutes, frequency, sample_count)
         VALUES ('${expId}', 7, 660, 1.0, 5);`,
      );
    }).toThrow();
  });

  it('enforces start_minutes CHECK constraint (0-1440)', () => {
    applyMigration(db, '0029_show_time_patterns.sql');

    const expId = randomUUID();
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
       VALUES ('${expId}', '${expId}', 'Indiana Jones Epic Stunt Spectacular', 'Hollywood Studios', 'Show', true);`,
    );

    // Valid bounds 0 and 1440
    expect(() => {
      db.public.none(
        `INSERT INTO show_time_patterns (experience_id, day_of_week, start_minutes, frequency, sample_count)
         VALUES ('${expId}', 1, 0, 1.0, 5);`,
      );
    }).not.toThrow();

    expect(() => {
      db.public.none(
        `INSERT INTO show_time_patterns (experience_id, day_of_week, start_minutes, frequency, sample_count)
         VALUES ('${expId}', 1, 1440, 1.0, 5);`,
      );
    }).not.toThrow();

    // Invalid < 0 or > 1440
    expect(() => {
      db.public.none(
        `INSERT INTO show_time_patterns (experience_id, day_of_week, start_minutes, frequency, sample_count)
         VALUES ('${expId}', 1, -1, 1.0, 5);`,
      );
    }).toThrow();

    expect(() => {
      db.public.none(
        `INSERT INTO show_time_patterns (experience_id, day_of_week, start_minutes, frequency, sample_count)
         VALUES ('${expId}', 1, 1441, 1.0, 5);`,
      );
    }).toThrow();
  });

  it('cascades delete when parent experience is deleted', () => {
    applyMigration(db, '0029_show_time_patterns.sql');

    const expId = randomUUID();
    db.public.none(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
       VALUES ('${expId}', '${expId}', 'Finding Nemo', 'Animal Kingdom', 'Show', true);`,
    );

    db.public.none(
      `INSERT INTO show_time_patterns (experience_id, day_of_week, start_minutes, frequency, sample_count)
       VALUES ('${expId}', 2, 720, 0.75, 4);`,
    );

    expect(db.public.many(`SELECT * FROM show_time_patterns WHERE experience_id = '${expId}';`)).toHaveLength(1);

    db.public.none(`DELETE FROM experiences WHERE id = '${expId}';`);

    expect(db.public.many(`SELECT * FROM show_time_patterns WHERE experience_id = '${expId}';`)).toHaveLength(0);
  });
});
