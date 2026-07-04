/**
 * Migration test for `0009_resort_representing_experiences.sql`.
 *
 * Applies the project's canonical migration chain (0001 → 0008) to a fresh
 * pg-mem database, seeds representative `experiences` rows, then applies 0009
 * on top and asserts the migration's additive contract holds:
 *
 *   - the new nullable `represents_resort_id` column exists on `experiences`;
 *   - both indexes the migration declares exist —
 *       `experiences_represents_resort_id_uniq` (partial UNIQUE) and
 *       `experiences_active_represents_resort_idx`;
 *   - every pre-existing `experiences` row is untouched: its
 *     `represents_resort_id` is NULL after the migration runs.
 *
 * The partial UNIQUE index is additionally exercised behaviorally — two
 * representing rows for the same Resort collide, while many ordinary rows keep
 * `represents_resort_id` NULL without colliding — so the "at most one
 * representing Experience per Resort" guard is observable at the storage layer,
 * not merely inferred from the catalog listing.
 *
 * Mirrors the pg-mem setup used by
 * `services/catalog/__tests__/repo.apply.integration.test.ts` and
 * `test/smoke/harness.ts` (extensions/functions registered, GIN trigram indexes
 * stripped because pg-mem lacks the `gin_trgm_ops` operator class).
 *
 * Validates: Requirements 3.5
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors repo.apply.integration.test.ts + test/smoke/harness.ts)
// ---------------------------------------------------------------------------

/** Build a fresh pg-mem db with the schema's extensions/functions registered. */
function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();

  db.registerExtension('citext', () => {
    // citext is supported natively by pg-mem.
  });
  db.registerExtension('pg_trgm', () => {
    // pg_trgm is only consulted by the GIN trigram indexes we strip below.
  });
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
    implementation: (s: unknown): number =>
      typeof s === 'string' ? s.length : 0,
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string =>
      typeof s === 'string' ? s.toLowerCase() : '',
  });

  return db;
}

/** Absolute path to a migration file relative to this test. */
function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → db → src → apps/api
  return resolve(here, '..', '..', '..', 'migrations', name);
}

/** Apply a migration file, stripping GIN trigram indexes pg-mem can't model. */
function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

/**
 * The canonical migration chain applied before 0009. Matches the proven chain
 * in `repo.apply.integration.test.ts`: 0005 (Document_Store / checkpoint) is
 * unrelated to `experiences`/`resorts` and is omitted to keep the schema focused
 * on what 0009 touches.
 */
const BASE_MIGRATIONS = [
  '0001_init.sql',
  '0002_experience_images.sql',
  '0003_note_shareable.sql',
  '0004_disney_sources.sql',
  '0006_experience_land.sql',
  '0007_experience_resort_area.sql',
  '0008_experience_facet_enrichment.sql',
];

const MIGRATION_0009 = '0009_resort_representing_experiences.sql';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

/** Insert one ordinary (pre-existing) Experience row. */
async function seedExperience(
  pool: Pool,
  id: string,
  name: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, description, active)
     VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride', $4, TRUE)`,
    [id, `ent-${id}`, name, 'seeded description'],
  );
}

/** Insert one active Resort row (FK target for represents_resort_id). */
async function seedResort(pool: Pool, id: string, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO resorts (id, upstream_entity_id, name, description, active)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [id, `ent-${id}`, name, 'seeded resort'],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migration 0009_resort_representing_experiences (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let seededIds: string[];

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }

    // Seed representative pre-existing experiences BEFORE 0009 runs so we can
    // prove the migration leaves them untouched.
    seededIds = [randomUUID(), randomUUID(), randomUUID()];
    await seedExperience(pool, seededIds[0]!, 'Space Mountain');
    await seedExperience(pool, seededIds[1]!, 'Haunted Mansion');
    await seedExperience(pool, seededIds[2]!, 'Pirates of the Caribbean');

    // Apply the migration under test on top of the seeded schema.
    applyMigration(db, MIGRATION_0009);
  });

  it('adds the nullable represents_resort_id column to experiences', () => {
    const columns = [...db.getTable('experiences').getColumns()];
    const column = columns.find((c) => c.name === 'represents_resort_id');

    expect(column).toBeDefined();
    // The column is nullable — every ordinary Experience leaves it NULL.
    expect(column?.nullable).toBe(true);
    expect(column?.type.primary).toBe(DataType.uuid);
  });

  it('creates the partial UNIQUE index and the active/representation index', () => {
    const indexNames = db
      .getTable('experiences')
      .listIndices()
      .map((idx) => idx.name);

    expect(indexNames).toContain('experiences_represents_resort_id_uniq');
    expect(indexNames).toContain('experiences_active_represents_resort_idx');
  });

  it('leaves every pre-existing experiences row untouched (represents_resort_id NULL)', async () => {
    const result = await pool.query(
      `SELECT id, name, represents_resort_id FROM experiences ORDER BY name`,
    );

    // All three seeded rows survive the migration...
    expect(result.rows).toHaveLength(3);
    // ...and none of them carries a represents_resort_id.
    for (const row of result.rows) {
      expect(row.represents_resort_id).toBeNull();
    }

    // The seeded ids are all still present, unchanged.
    const ids = result.rows.map((r) => r.id).sort();
    expect(ids).toEqual([...seededIds].sort());
  });

  it('enforces at most one representing Experience per Resort (partial UNIQUE)', async () => {
    const resortId = randomUUID();
    await seedResort(pool, resortId, 'Grand Floridian');

    const firstRepId = randomUUID();
    await pool.query(
      `INSERT INTO experiences
         (id, upstream_entity_id, name, park, category, description, active,
          area_type, resort_id, represents_resort_id)
       VALUES ($1, $2, $3, NULL, 'Other', '', TRUE, 'Resort', $4, $4)`,
      [firstRepId, `ent-${firstRepId}`, 'Grand Floridian (visit)', resortId],
    );

    // A second representing row for the SAME resort must collide.
    const secondRepId = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO experiences
           (id, upstream_entity_id, name, park, category, description, active,
            area_type, resort_id, represents_resort_id)
         VALUES ($1, $2, $3, NULL, 'Other', '', TRUE, 'Resort', $4, $4)`,
        [secondRepId, `ent-${secondRepId}`, 'Grand Floridian (dup)', resortId],
      ),
    ).rejects.toThrow();
  });

  it('permits many rows with NULL represents_resort_id (partial index exempts NULLs)', async () => {
    // The three seeded rows already have NULL represents_resort_id; adding more
    // NULL-discriminator rows must not collide with them or each other.
    const extraId = randomUUID();
    await expect(seedExperience(pool, extraId, 'Big Thunder Mountain')).resolves.toBeUndefined();

    // Count NULL-discriminator rows in JS: pg-mem's `WHERE ... IS NULL` filter
    // is unreliable on a column introduced via ALTER TABLE, but reading the
    // projected value back is faithful (see the untouched-rows assertion above).
    const all = await pool.query(`SELECT represents_resort_id FROM experiences`);
    const nullCount = all.rows.filter((r) => r.represents_resort_id === null).length;
    expect(nullCount).toBe(4);
  });
});
