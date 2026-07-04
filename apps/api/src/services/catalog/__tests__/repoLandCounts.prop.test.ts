// Feature: catalog-navigation-redesign
// Property 7: Case-sensitive conjunctive Land filter (Requirements 3.4, 3.7, 3.8)
// Property 8: Destination counts (Requirements 3.6, 4.5, 4.6)
/**
 * Property-based tests for the Catalog_Service repository's Land filter and
 * Destination-count reads (`listActiveExperiences` land handling and
 * `listDestinationCounts`, `repo.ts`).
 *
 * Both properties exercise real SQL *semantics* — case-sensitive `=`,
 * conjunctive `WHERE`, and grouped counting — rather than the SQL string
 * shape, so they run the production repo verbatim against an in-memory
 * Postgres (`pg-mem`), mirroring `repo.apply.integration.test.ts`. The pg-mem
 * database applies the canonical migrations `0001`–`0004` plus the additive
 * Land migration `0006_experience_land.sql`, so the `land` column, its length
 * CHECK, and the browse index all exist exactly as production would have them.
 *
 * pg-mem cannot parse the `q` filter's `ILIKE ... ESCAPE` clause, so the `q`
 * dimension of the conjunction (R3.7) is covered separately by a fake-pool
 * SQL-shape assertion at the bottom of this file, which proves that when a
 * Land filter and a `q` filter are supplied together both predicates are
 * ANDed into the same `WHERE` clause.
 *
 * Property 7 — Case-sensitive conjunctive Land filter:
 *   For any set of persisted Experiences and any Land filter value combined
 *   with any subset of the `park`/`category`/`areaType` parameters, the rows
 *   returned are EXACTLY the active Experiences whose persisted `land` equals
 *   the filter value under a case-sensitive comparison AND that satisfy every
 *   other supplied parameter; a Land value matching no active Experience yields
 *   an empty list. Validates: Requirements 3.4, 3.7, 3.8
 *
 * Property 8 — Destination counts:
 *   For any set of persisted Experiences, `listDestinationCounts` returns all
 *   eight Destinations in canonical order (the seven `PARKS`, then `'Resorts'`),
 *   where each park Destination's count is the number of active Experiences
 *   with that `park` and the Resorts Destination's count is the number of
 *   active `Resort`-area Experiences, including Destinations with a count of
 *   zero. Validates: Requirements 3.6, 4.5, 4.6
 *
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { AreaType, ExperienceCategory, Park } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createCatalogRepo } from '../repo.js';
import type { CatalogRepo, DestinationId } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors repo.apply.integration.test.ts)
// ---------------------------------------------------------------------------

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

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → catalog → services → src → apps/api
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyInitMigration(db: IMemoryDb): void {
  let sql = readFileSync(migrationPath('0001_init.sql'), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

function applyMigration(db: IMemoryDb, name: string): void {
  const sql = readFileSync(migrationPath(name), 'utf8');
  db.public.none(sql);
}

/** Build a fresh, migrated pg-mem-backed repo for one property iteration. */
function freshRepo(): { repo: CatalogRepo; pool: DbPool } {
  const db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as DbPool;

  applyInitMigration(db);
  applyMigration(db, '0002_experience_images.sql');
  applyMigration(db, '0003_note_shareable.sql');
  applyMigration(db, '0004_disney_sources.sql');
  applyMigration(db, '0006_experience_land.sql');
  applyMigration(db, '0007_experience_resort_area.sql');
  applyMigration(db, '0008_experience_facet_enrichment.sql');
  // 0010 admits the `Resort` category the arbitraries now draw from
  // (`EXPERIENCE_CATEGORIES` includes `Resort`).
  applyMigration(db, '0010_resort_experience_category.sql');

  return { repo: createCatalogRepo(pool), pool };
}

// ---------------------------------------------------------------------------
// Seed model + insert helper
// ---------------------------------------------------------------------------

interface ExperienceSeed {
  readonly id: string;
  readonly name: string;
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  readonly areaType: AreaType;
  readonly land: string | null;
  readonly active: boolean;
}

async function seed(pool: DbPool, seeds: readonly ExperienceSeed[]): Promise<void> {
  for (const s of seeds) {
    await pool.query(
      `INSERT INTO experiences
         (id, upstream_entity_id, name, park, category, description, active, area_type, land)
       VALUES ($1, $2, $3, $4, $5, '', $6, $7, $8)`,
      [s.id, `ent-${s.id}`, s.name, s.park, s.category, s.active, s.areaType, s.land],
    );
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * An (areaType, park) pair that respects the domain: park Experiences carry a
 * matching Park, Resort-area Experiences carry a `null` park (the schema makes
 * `park` nullable for exactly this case).
 */
const areaParkArb: fc.Arbitrary<{ areaType: AreaType; park: Park | null }> =
  fc.oneof(
    fc.record({
      areaType: fc.constant<AreaType>('ThemePark'),
      park: fc.constantFrom<Park>(
        'Magic Kingdom',
        'EPCOT',
        'Hollywood Studios',
        'Animal Kingdom',
      ),
    }),
    fc.record({
      areaType: fc.constant<AreaType>('WaterPark'),
      park: fc.constantFrom<Park>('Typhoon Lagoon', 'Blizzard Beach'),
    }),
    fc.record({
      areaType: fc.constant<AreaType>('DisneySprings'),
      park: fc.constant<Park>('Disney Springs'),
    }),
    fc.record({
      areaType: fc.constant<AreaType>('Resort'),
      park: fc.constant<Park | null>(null),
    }),
  );

/**
 * Persisted Land values used when seeding. Includes `null` and two names that
 * differ only by case (`Fantasyland` / `fantasyland`) so the filter's
 * case-sensitivity is exercised.
 */
const SEED_LANDS: readonly (string | null)[] = [
  null,
  'Fantasyland',
  'fantasyland',
  'Tomorrowland',
  'Adventureland',
];

/**
 * Land values used as the filter. `FANTASYLAND` (wrong case) and `Frontierland`
 * (never seeded) never match any seeded row, exercising the case-sensitive
 * no-match → empty-list path (R3.4, R3.8).
 */
const FILTER_LANDS: readonly string[] = [
  'Fantasyland',
  'fantasyland',
  'FANTASYLAND',
  'Tomorrowland',
  'Frontierland',
];

/**
 * Experience-name generator constrained to a safe alphanumeric alphabet. The
 * name is irrelevant to the Land/park/category/areaType conjunction under test;
 * restricting the charset sidesteps a pg-mem sandbox quirk where a backslash in
 * an inlined string parameter mis-parses (production Postgres round-trips it
 * fine over the wire protocol).
 */
const nameArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')), {
    minLength: 1,
    maxLength: 40,
  })
  .map((chars) => {
    const s = chars.join('').trim();
    return s.length > 0 ? s : 'x';
  });

const experienceSeedArb: fc.Arbitrary<ExperienceSeed> = areaParkArb.chain(
  ({ areaType, park }) =>
    fc.record({
      id: fc.uuid(),
      name: nameArb,
      park: fc.constant(park),
      category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
      areaType: fc.constant(areaType),
      land: fc.constantFrom(...SEED_LANDS),
      active: fc.boolean(),
    }),
);

/** Distinct-id seed list so id-set comparisons are unambiguous. */
const seedsArb: fc.Arbitrary<readonly ExperienceSeed[]> = fc.uniqueArray(
  experienceSeedArb,
  { maxLength: 12, selector: (s) => s.id },
);

interface LandFilterCase {
  readonly land: string;
  readonly park?: Park;
  readonly category?: ExperienceCategory;
  readonly areaType?: AreaType;
}

const landFilterArb: fc.Arbitrary<LandFilterCase> = fc
  .record({
    land: fc.constantFrom(...FILTER_LANDS),
    park: fc.option(fc.constantFrom(...PARKS), { nil: undefined }),
    category: fc.option(fc.constantFrom(...EXPERIENCE_CATEGORIES), {
      nil: undefined,
    }),
    areaType: fc.option(fc.constantFrom(...AREA_TYPES), { nil: undefined }),
  })
  .map((f) => {
    // Drop undefined keys so the object matches the sparse CatalogListFilters
    // contract (a missing key means "no constraint").
    const out: LandFilterCase = { land: f.land };
    return {
      ...out,
      ...(f.park !== undefined ? { park: f.park } : {}),
      ...(f.category !== undefined ? { category: f.category } : {}),
      ...(f.areaType !== undefined ? { areaType: f.areaType } : {}),
    };
  });

// ---------------------------------------------------------------------------
// Property 7 — Case-sensitive conjunctive Land filter
// ---------------------------------------------------------------------------

describe('Property 7: case-sensitive conjunctive Land filter', () => {
  it('returns exactly the active Experiences matching Land (case-sensitive) and every other supplied filter', async () => {
    await fc.assert(
      fc.asyncProperty(
        seedsArb,
        landFilterArb,
        async (seeds, filter) => {
          const { repo, pool } = freshRepo();
          await seed(pool, seeds);

          const rows = await repo.listActiveExperiences(filter);

          // Oracle: an independent restatement of the conjunctive, case-
          // sensitive rule. `land === filter.land` is a strict string
          // comparison, so a case mismatch never matches (R3.4).
          const expectedIds = seeds
            .filter(
              (s) =>
                s.active &&
                s.land === filter.land &&
                (filter.park === undefined || s.park === filter.park) &&
                (filter.category === undefined ||
                  s.category === filter.category) &&
                (filter.areaType === undefined ||
                  s.areaType === filter.areaType),
            )
            .map((s) => s.id)
            .sort();

          const actualIds = rows.map((r) => r.id).sort();
          expect(actualIds).toEqual(expectedIds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns an empty list for a Land value matching no active Experience (R3.8)', async () => {
    const { repo, pool } = freshRepo();
    await seed(pool, [
      {
        id: randomUUID(),
        name: 'Peter Pan',
        park: 'Magic Kingdom',
        category: 'Ride',
        areaType: 'ThemePark',
        land: 'Fantasyland',
        active: true,
      },
    ]);

    // Wrong-case value must not match the persisted 'Fantasyland' (R3.4),
    // and an entirely unseeded value must not match either (R3.8).
    expect(await repo.listActiveExperiences({ land: 'FANTASYLAND' })).toEqual([]);
    expect(await repo.listActiveExperiences({ land: 'Frontierland' })).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8 — Destination counts
// ---------------------------------------------------------------------------

const CANONICAL_DESTINATIONS: readonly DestinationId[] = [...PARKS, 'Resorts'];

describe('Property 8: destination counts', () => {
  it('returns all eight Destinations in canonical order with per-Destination active counts', async () => {
    await fc.assert(
      fc.asyncProperty(seedsArb, async (seeds) => {
        const { repo, pool } = freshRepo();
        await seed(pool, seeds);

        const counts = await repo.listDestinationCounts();

        // The endpoint always returns all eight Destinations in canonical
        // grid order (R4.6): the seven PARKS, then 'Resorts'.
        expect(counts.map((c) => c.destination)).toEqual(
          CANONICAL_DESTINATIONS,
        );

        // Oracle: seed every Destination at zero, then tally active rows —
        // park Destinations by `park` (R3.6) and the Resorts Destination by
        // Resort-area membership (R4.5).
        const expected = new Map<DestinationId, number>();
        for (const d of CANONICAL_DESTINATIONS) expected.set(d, 0);
        for (const s of seeds) {
          if (!s.active) continue;
          if (s.areaType === 'Resort') {
            expected.set('Resorts', (expected.get('Resorts') ?? 0) + 1);
          } else if (s.park !== null) {
            expected.set(s.park, (expected.get(s.park) ?? 0) + 1);
          }
        }

        for (const { destination, count } of counts) {
          expect(count).toBe(expected.get(destination));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports zero for Destinations with no active Experiences (R4.6)', async () => {
    const { repo, pool } = freshRepo();
    // Only a single active Magic Kingdom Experience and one inactive Resort
    // Experience — every other Destination must report zero.
    await seed(pool, [
      {
        id: randomUUID(),
        name: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        areaType: 'ThemePark',
        land: 'Tomorrowland',
        active: true,
      },
      {
        id: randomUUID(),
        name: 'Retired Resort Dining',
        park: null,
        category: 'Restaurant',
        areaType: 'Resort',
        land: null,
        active: false,
      },
    ]);

    const counts = await repo.listDestinationCounts();
    const byId = new Map(counts.map((c) => [c.destination, c.count]));

    expect(byId.get('Magic Kingdom')).toBe(1);
    expect(byId.get('EPCOT')).toBe(0);
    expect(byId.get('Hollywood Studios')).toBe(0);
    expect(byId.get('Animal Kingdom')).toBe(0);
    expect(byId.get('Typhoon Lagoon')).toBe(0);
    expect(byId.get('Blizzard Beach')).toBe(0);
    expect(byId.get('Disney Springs')).toBe(0);
    // The only Resort-area Experience is inactive, so Resorts is zero (R4.5).
    expect(byId.get('Resorts')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Property 7 (q dimension) — SQL-shape assertion via a fake pool
// ---------------------------------------------------------------------------
//
// pg-mem cannot parse the `q` filter's `ILIKE ... ESCAPE` clause, so the
// conjunction of a Land filter with a `q` filter (R3.7) is verified here at the
// SQL-shape level: both predicates must be ANDed into the same WHERE clause.

interface RecordedCall {
  readonly text: string;
  readonly params: readonly unknown[];
}

function recordingPool(): { pool: DbPool; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const pool = {
    async query(text: string, params: readonly unknown[] = []) {
      calls.push({ text, params });
      return { rows: [] };
    },
  } as unknown as DbPool;
  return { pool, calls };
}

describe('Property 7 (q dimension): Land and q combine conjunctively', () => {
  it('ANDs a case-sensitive land predicate with the ILIKE query predicate', async () => {
    const { pool, calls } = recordingPool();
    const repo = createCatalogRepo(pool);

    await repo.listActiveExperiences({ land: 'Fantasyland', q: 'pirates' });

    const sql = calls[0]?.text ?? '';
    // Case-sensitive exact match on land (no lower() wrapping), ANDed with the
    // ILIKE substring match on name — both under the single WHERE clause.
    expect(sql).toMatch(/land = \$\d+/);
    expect(sql).toMatch(/name ILIKE \$\d+ ESCAPE/);
    expect(sql).toMatch(
      /active = TRUE AND land = \$\d+ AND name ILIKE \$\d+/,
    );
    expect(calls[0]?.params).toContain('Fantasyland');
    expect(calls[0]?.params).toContain('%pirates%');
  });
});
