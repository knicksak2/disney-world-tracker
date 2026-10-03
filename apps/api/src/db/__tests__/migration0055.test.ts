/**
 * Migration test for `0055_festival_edition_and_dish_tags.sql`.
 *
 * Applies the migration to a fresh pg-mem database and asserts:
 *
 *   - `experience_festival_tags.match_kind` exists, is NOT NULL post-migration,
 *     and its CHECK rejects a value outside {'facet', 'menu'};
 *   - the one-time backfill classifies a pre-existing row carrying the
 *     `Festival Kiosk` facet as `'facet'`, and a non-kiosk-faceted row as
 *     `'menu'`;
 *   - `festival_editions` enforces its `(festival_slug, festival_year)`
 *     PRIMARY KEY, its year CHECK, and its `ends_on >= starts_on` CHECK;
 *   - `food_item_festival_tags` enforces its `(food_item_id, festival_year)`
 *     UNIQUE constraint, its year CHECK, and CASCADEs when its parent
 *     `food_items` row is deleted.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2
 */

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
  db.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  db.public.registerFunction({
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

interface Pool {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<T>; rowCount?: number | null }>;
}

async function seedExperience(
  pool: Pool,
  id: string,
  name: string,
  groupedFacets: unknown,
): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, name, category, park, upstream_entity_id, grouped_facets)
     VALUES ($1, $2, 'Restaurant', 'EPCOT', $3, $4::jsonb)`,
    [id, name, `entity-${id}`, JSON.stringify(groupedFacets)],
  );
}

function buildBaseDb(): { db: IMemoryDb; pool: Pool } {
  const db = buildPgMemDatabase();
  const { Pool: PgMemPool } = db.adapters.createPg();
  const pool = new PgMemPool() as unknown as Pool;

  applyMigration(db, '0001_init.sql');
  applyMigration(db, '0002_experience_images.sql');
  applyMigration(db, '0003_note_shareable.sql');
  applyMigration(db, '0004_disney_sources.sql');
  applyMigration(db, '0008_experience_facet_enrichment.sql');
  applyMigration(db, '0039_experience_festival_tags.sql');
  applyMigration(db, '0040_food_item_logging.sql');

  return { db, pool };
}

const FESTIVAL_KIOSK_FACET = {
  quickService: [{ id: 'festival-kiosk', name: 'Festival Kiosk' }],
};
const QUICK_SERVICE_KIOSK_FACET = {
  quickService: [{ id: 'quick-service-kiosk', name: 'Quick Service Kiosk' }],
};

describe('migration 0055_festival_edition_and_dish_tags (pg-mem)', () => {
  describe('experience_festival_tags.match_kind backfill', () => {
    let db: IMemoryDb;
    let pool: Pool;
    let kioskExp: string;
    let permanentExp: string;
    let noFacetExp: string;

    beforeEach(async () => {
      ({ db, pool } = buildBaseDb());

      kioskExp = randomUUID();
      permanentExp = randomUUID();
      noFacetExp = randomUUID();

      await seedExperience(pool, kioskExp, 'Marketplace - France', FESTIVAL_KIOSK_FACET);
      await seedExperience(pool, permanentExp, 'Tangierine Cafe', QUICK_SERVICE_KIOSK_FACET);
      await seedExperience(pool, noFacetExp, 'Block & Hans', {});

      // Pre-existing rows, as if written BEFORE the match_kind column existed
      // (simulated here by inserting before applying 0055, exactly as the
      // real column-add + backfill would encounter them).
      await pool.query(
        `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
         VALUES ($1, 'food-and-wine', 2026)`,
        [kioskExp],
      );
      await pool.query(
        `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
         VALUES ($1, 'food-and-wine', 2026)`,
        [permanentExp],
      );
      await pool.query(
        `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
         VALUES ($1, 'food-and-wine', 2026)`,
        [noFacetExp],
      );

      applyMigration(db, '0055_festival_edition_and_dish_tags.sql');
    });

    it('creates match_kind column, NOT NULL post-migration', () => {
      const columns = [...db.getTable('experience_festival_tags').getColumns()].map((c) => c.name);
      expect(columns).toContain('match_kind');
    });

    it('backfills a Festival-Kiosk-faceted row to "facet" (R9.2)', async () => {
      const r = await pool.query(
        `SELECT match_kind FROM experience_festival_tags WHERE experience_id = $1`,
        [kioskExp],
      );
      expect(r.rows[0]?.['match_kind']).toBe('facet');
    });

    it('backfills a non-Festival-Kiosk-faceted (quick-service-kiosk) row to "menu" (R9.2)', async () => {
      const r = await pool.query(
        `SELECT match_kind FROM experience_festival_tags WHERE experience_id = $1`,
        [permanentExp],
      );
      expect(r.rows[0]?.['match_kind']).toBe('menu');
    });

    it('backfills a row with no quickService facet at all to "menu" (R9.2)', async () => {
      const r = await pool.query(
        `SELECT match_kind FROM experience_festival_tags WHERE experience_id = $1`,
        [noFacetExp],
      );
      expect(r.rows[0]?.['match_kind']).toBe('menu');
    });

    it('rejects a match_kind value outside {facet, menu} going forward', async () => {
      const newExp = randomUUID();
      await seedExperience(pool, newExp, 'Another Restaurant', {});
      await expect(
        pool.query(
          `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year, match_kind)
           VALUES ($1, 'food-and-wine', 2027, 'bogus')`,
          [newExp],
        ),
      ).rejects.toThrow();
    });

    it('requires match_kind on a new insert (NOT NULL)', async () => {
      const newExp = randomUUID();
      await seedExperience(pool, newExp, 'Yet Another Restaurant', {});
      await expect(
        pool.query(
          `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
           VALUES ($1, 'food-and-wine', 2027)`,
          [newExp],
        ),
      ).rejects.toThrow();
    });
  });

  describe('festival_editions', () => {
    let pool: Pool;

    beforeEach(() => {
      const built = buildBaseDb();
      applyMigration(built.db, '0055_festival_edition_and_dish_tags.sql');
      pool = built.pool;
    });

    it('allows inserting a valid edition with no ends_on ("still running")', async () => {
      await pool.query(
        `INSERT INTO festival_editions (festival_slug, festival_year, starts_on)
         VALUES ('food-and-wine', 2026, '2026-08-28')`,
      );
      const r = await pool.query(
        `SELECT starts_on, ends_on FROM festival_editions WHERE festival_slug = 'food-and-wine' AND festival_year = 2026`,
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.['ends_on']).toBeNull();
    });

    it('enforces PRIMARY KEY (festival_slug, festival_year)', async () => {
      await pool.query(
        `INSERT INTO festival_editions (festival_slug, festival_year, starts_on)
         VALUES ('food-and-wine', 2026, '2026-08-28')`,
      );
      await expect(
        pool.query(
          `INSERT INTO festival_editions (festival_slug, festival_year, starts_on)
           VALUES ('food-and-wine', 2026, '2026-09-01')`,
        ),
      ).rejects.toThrow();
    });

    it('rejects festival_year outside [2015, 2100]', async () => {
      await expect(
        pool.query(
          `INSERT INTO festival_editions (festival_slug, festival_year, starts_on)
           VALUES ('food-and-wine', 2014, '2014-01-01')`,
        ),
      ).rejects.toThrow();
    });

    it('rejects ends_on before starts_on', async () => {
      await expect(
        pool.query(
          `INSERT INTO festival_editions (festival_slug, festival_year, starts_on, ends_on)
           VALUES ('food-and-wine', 2026, '2026-11-01', '2026-08-01')`,
        ),
      ).rejects.toThrow();
    });

    it('allows ends_on equal to starts_on (single-day edition)', async () => {
      await expect(
        pool.query(
          `INSERT INTO festival_editions (festival_slug, festival_year, starts_on, ends_on)
           VALUES ('food-and-wine', 2026, '2026-08-28', '2026-08-28')`,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('food_item_festival_tags', () => {
    let pool: Pool;
    let experienceId: string;
    let foodItemId: string;

    beforeEach(async () => {
      const built = buildBaseDb();
      applyMigration(built.db, '0055_festival_edition_and_dish_tags.sql');
      pool = built.pool;

      experienceId = randomUUID();
      await seedExperience(pool, experienceId, 'Tangierine Cafe', QUICK_SERVICE_KIOSK_FACET);

      const foodItemRes = await pool.query<{ id: string }>(
        `INSERT INTO food_items (experience_id, name, source)
         VALUES ($1, 'Plant-based Falafel Wrap', 'menu_sync')
         RETURNING id`,
        [experienceId],
      );
      foodItemId = foodItemRes.rows[0]?.['id'] as string;
    });

    it('allows inserting a valid dish tag', async () => {
      await pool.query(
        `INSERT INTO food_item_festival_tags (food_item_id, festival_slug, festival_year)
         VALUES ($1, 'food-and-wine', 2026)`,
        [foodItemId],
      );
      const r = await pool.query(
        `SELECT festival_slug, festival_year FROM food_item_festival_tags WHERE food_item_id = $1`,
        [foodItemId],
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.['festival_slug']).toBe('food-and-wine');
    });

    it('enforces UNIQUE (food_item_id, festival_year)', async () => {
      await pool.query(
        `INSERT INTO food_item_festival_tags (food_item_id, festival_slug, festival_year)
         VALUES ($1, 'food-and-wine', 2026)`,
        [foodItemId],
      );
      await expect(
        pool.query(
          `INSERT INTO food_item_festival_tags (food_item_id, festival_slug, festival_year)
           VALUES ($1, 'flower-and-garden', 2026)`,
          [foodItemId],
        ),
      ).rejects.toThrow();
    });

    it('rejects festival_year outside [2015, 2100]', async () => {
      await expect(
        pool.query(
          `INSERT INTO food_item_festival_tags (food_item_id, festival_slug, festival_year)
           VALUES ($1, 'food-and-wine', 2101)`,
          [foodItemId],
        ),
      ).rejects.toThrow();
    });

    it('cascades on parent food_item delete', async () => {
      await pool.query(
        `INSERT INTO food_item_festival_tags (food_item_id, festival_slug, festival_year)
         VALUES ($1, 'food-and-wine', 2026)`,
        [foodItemId],
      );
      await pool.query(`DELETE FROM food_items WHERE id = $1`, [foodItemId]);
      const r = await pool.query(
        `SELECT count(*)::int AS n FROM food_item_festival_tags WHERE food_item_id = $1`,
        [foodItemId],
      );
      expect(r.rows[0]?.['n']).toBe(0);
    });
  });
});
