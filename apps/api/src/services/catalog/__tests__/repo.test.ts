/**
 * Unit tests for the Catalog_Service repository (`repo.ts`).
 *
 * These tests exercise the public surface against an in-memory fake `pg`
 * pool that records every SQL string and parameter set the repo issues
 * and replies with rigged rows. The fake matches the shape of the real
 * `pg.Pool`/`pg.PoolClient` closely enough that the repo never knows it is
 * not talking to Postgres.
 *
 * Coverage focuses on the observable behaviors the design pins on this
 * module:
 *
 *   - getCacheAge:
 *       - returns null when no metadata row exists (fresh database)
 *       - converts the metadata timestamp to an age in hours
 *       - clamps negative ages (clock skew) to zero
 *
 *   - applyReconciliation:
 *       - opens a transaction, issues an upsert per upsert and a soft-
 *         delete per soft-delete, commits, and releases the client
 *       - sanitizes the upserted description before persisting
 *       - rolls back when any statement fails
 *       - is a no-op for an empty diff (skips connection acquisition)
 *
 *   - recordSyncRun:
 *       - inserts a row in `catalog_sync_runs` for every status
 *       - updates `catalog_cache_metadata` only on success
 *       - leaves the metadata row untouched on `failed`/`running`
 *
 *   - listActiveExperiences:
 *       - filters by park, category, and ILIKE-escaped query
 *       - omits filters when not supplied; treats whitespace `q` as missing
 *       - orders by park, lower(name), id
 *
 *   - getExperience:
 *       - returns the row regardless of `active`
 *       - returns null when no row matches
 *
 * Validates: Requirements 1.7, 1.9, 1.13, 1.14, 1.15, 1.16
 */

import { describe, expect, it } from 'vitest';
import type { ExperienceCategory, Park } from '@dwt/shared';

import { createCatalogRepo } from '../repo.js';
import type {
  CatalogDiff,
  ReconcileSoftDelete,
  ReconcileUpsert,
  ResortReconcileResult,
} from '../types.js';

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
  /** Whether the call ran on the pool itself or an explicit client. */
  readonly via: 'pool' | 'client';
}

interface RiggedResponse {
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
  readonly throw?: Error;
}

type Responder = (call: FakeCall) => RiggedResponse | undefined;

interface FakeClientHandle {
  readonly released: boolean;
}

interface FakePool {
  readonly calls: FakeCall[];
  readonly clients: FakeClientHandle[];
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
  connect(): Promise<{
    query(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
    release(): void;
  }>;
}

function makePool(responder: Responder = () => undefined): FakePool {
  const calls: FakeCall[] = [];
  const clients: FakeClientHandle[] = [];

  const dispatch = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
    via: 'pool' | 'client',
  ) => {
    const call: FakeCall = { text, params, via };
    calls.push(call);
    const rigged = responder(call);
    if (rigged?.throw) {
      throw rigged.throw;
    }
    return { rows: rigged?.rows ?? [] };
  };

  return {
    calls,
    clients,
    async query(text, params) {
      return dispatch(text, params, 'pool');
    },
    async connect() {
      const handle: { released: boolean } = { released: false };
      clients.push(handle);
      return {
        async query(text, params) {
          if (handle.released) {
            throw new Error('client used after release');
          }
          return dispatch(text, params, 'client');
        },
        release() {
          handle.released = true;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// getCacheAge
// ---------------------------------------------------------------------------

describe('CatalogRepo.getCacheAge', () => {
  it('returns null when no metadata row exists', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createCatalogRepo(pool as never);

    const age = await repo.getCacheAge(new Date('2025-01-01T00:00:00Z'));

    expect(age).toEqual({ hours: null, lastSuccessfulSyncAt: null });
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]?.text).toMatch(/FROM catalog_cache_metadata/);
  });

  it('returns the age in hours since the recorded sync', async () => {
    const last = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2025-01-01T03:30:00Z');
    const pool = makePool(() => ({
      rows: [{ last_successful_sync_at: last }],
    }));
    const repo = createCatalogRepo(pool as never);

    const age = await repo.getCacheAge(now);

    expect(age.lastSuccessfulSyncAt).toBe(last);
    expect(age.hours).toBeCloseTo(3.5, 6);
  });

  it('clamps negative ages (clock skew) to zero', async () => {
    const last = new Date('2025-01-01T01:00:00Z');
    const now = new Date('2025-01-01T00:00:00Z');
    const pool = makePool(() => ({
      rows: [{ last_successful_sync_at: last }],
    }));
    const repo = createCatalogRepo(pool as never);

    const age = await repo.getCacheAge(now);

    expect(age.hours).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyReconciliation
// ---------------------------------------------------------------------------

const RIDE: ExperienceCategory = 'Ride';
const SHOW: ExperienceCategory = 'Show';
const MAGIC_KINGDOM: Park = 'Magic Kingdom';
const EPCOT: Park = 'EPCOT';

function upsert(
  override: Partial<ReconcileUpsert> = {},
): ReconcileUpsert {
  return {
    id: 'id-1',
    upstreamEntityId: 'up-1',
    name: 'Test Attraction',
    park: MAGIC_KINGDOM,
    category: RIDE,
    land: null,
    resortArea: null,
    worldShowcaseCountry: null,
    description: 'A simple description.',
    imageUrl: null,
    areaType: 'ThemePark',
    resortId: null,
    representsResortId: null,
    latitude: null,
    longitude: null,
    accessibility: [],
    priceTier: null,
    mealPeriods: [],
    groupedFacets: {},
    heightRequirement: null,
    whyThis: null,
    subType: null,
    active: true,
    ...override,
  };
}

function softDelete(id: string): ReconcileSoftDelete {
  return { id };
}

/** An empty Resort reconcile arm. */
const EMPTY_RESORTS: ResortReconcileResult = { upserts: [], softDeletes: [] };

/**
 * Wrap an Experience diff into the combined {@link CatalogDiff} shape
 * `applyReconciliation` now consumes. Resorts default to empty so these repo
 * tests stay focused on the Experience write path.
 */
function experienceDiff(
  upserts: readonly ReconcileUpsert[],
  softDeletes: readonly ReconcileSoftDelete[] = [],
): CatalogDiff {
  return {
    experiences: { upserts, softDeletes },
    resorts: EMPTY_RESORTS,
  };
}

describe('CatalogRepo.applyReconciliation', () => {
  it('is a no-op for an empty diff (no DB connection)', async () => {
    const pool = makePool();
    const repo = createCatalogRepo(pool as never);

    await repo.applyReconciliation(experienceDiff([], []));

    expect(pool.calls).toHaveLength(0);
    expect(pool.clients).toHaveLength(0);
  });

  it('runs upserts and soft-deletes inside a single transaction', async () => {
    const pool = makePool();
    const repo = createCatalogRepo(pool as never);

    await repo.applyReconciliation(
      experienceDiff([upsert()], [softDelete('id-2')]),
    );

    const texts = pool.calls.map((c) => c.text);
    // BEGIN, UPSERT, SOFT-DELETE, COMMIT — all on the client connection.
    expect(texts[0]).toBe('BEGIN');
    expect(texts[1]).toMatch(/INSERT INTO experiences/);
    expect(texts[1]).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(texts[2]).toMatch(/UPDATE experiences/);
    expect(texts[2]).toMatch(/active = FALSE/);
    expect(texts[3]).toBe('COMMIT');

    expect(pool.clients).toHaveLength(1);
    expect(pool.clients[0]?.released).toBe(true);
  });

  it('persists the reconcile-provided description verbatim', async () => {
    const pool = makePool();
    const repo = createCatalogRepo(pool as never);

    // `reconcile` sanitizes descriptions to plain text before they reach the
    // repo (the `ReconcileUpsert.description` contract, R11.8), so the repo
    // persists the value verbatim. This asserts the repo does not re-sanitize
    // or otherwise mutate the description it is handed.
    await repo.applyReconciliation(
      experienceDiff([
        upsert({ description: 'It\u2019s magical' }),
      ]),
    );

    const insert = pool.calls.find((c) =>
      c.text.includes('INSERT INTO experiences'),
    );
    expect(insert).toBeDefined();
    // Description is the 6th param (1-based: id, upstream, name, park, category, description).
    const persistedDescription = insert?.params[5];
    expect(persistedDescription).toBe('It\u2019s magical');
  });

  it('rolls back and releases the client on a statement failure', async () => {
    const boom = new Error('insert failed');
    const pool = makePool((call) =>
      call.text.startsWith('INSERT INTO experiences') ? { throw: boom } : undefined,
    );
    const repo = createCatalogRepo(pool as never);

    await expect(
      repo.applyReconciliation(experienceDiff([upsert()])),
    ).rejects.toBe(boom);

    const texts = pool.calls.map((c) => c.text);
    expect(texts).toContain('BEGIN');
    expect(texts).toContain('ROLLBACK');
    expect(texts).not.toContain('COMMIT');
    expect(pool.clients[0]?.released).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recordSyncRun
// ---------------------------------------------------------------------------

describe('CatalogRepo.recordSyncRun', () => {
  it('inserts a sync run and updates metadata on success', async () => {
    const pool = makePool((call) =>
      call.text.startsWith('INSERT INTO catalog_sync_runs')
        ? { rows: [{ id: 'run-1' }] }
        : undefined,
    );
    const repo = createCatalogRepo(pool as never);

    const startedAt = new Date('2025-01-01T00:00:00Z');
    const finishedAt = new Date('2025-01-01T00:01:00Z');

    const result = await repo.recordSyncRun({
      status: 'success',
      startedAt,
      finishedAt,
      entitiesProcessed: 42,
    });

    expect(result).toEqual({ id: 'run-1' });

    const texts = pool.calls.map((c) => c.text);
    expect(texts[0]).toBe('BEGIN');
    expect(texts[1]).toMatch(/INSERT INTO catalog_sync_runs/);
    expect(texts[2]).toMatch(/INSERT INTO catalog_cache_metadata/);
    expect(texts[3]).toBe('COMMIT');

    const metaInsert = pool.calls.find((c) =>
      c.text.includes('catalog_cache_metadata'),
    );
    expect(metaInsert?.params[0]).toBe(finishedAt);
    expect(metaInsert?.params[1]).toBe('run-1');
  });

  it('does not touch metadata on a failed run (R1.13)', async () => {
    const pool = makePool((call) =>
      call.text.startsWith('INSERT INTO catalog_sync_runs')
        ? { rows: [{ id: 'run-2' }] }
        : undefined,
    );
    const repo = createCatalogRepo(pool as never);

    await repo.recordSyncRun({
      status: 'failed',
      startedAt: new Date('2025-01-01T00:00:00Z'),
      finishedAt: new Date('2025-01-01T00:00:30Z'),
      errorClass: 'UpstreamError',
      errorMessage: '503 Service Unavailable',
    });

    const texts = pool.calls.map((c) => c.text);
    expect(texts).toContain('BEGIN');
    expect(texts).toContain('COMMIT');
    expect(
      pool.calls.some((c) => c.text.includes('catalog_cache_metadata')),
    ).toBe(false);
  });

  it('does not touch metadata on a running run', async () => {
    const pool = makePool((call) =>
      call.text.startsWith('INSERT INTO catalog_sync_runs')
        ? { rows: [{ id: 'run-3' }] }
        : undefined,
    );
    const repo = createCatalogRepo(pool as never);

    await repo.recordSyncRun({
      status: 'running',
      startedAt: new Date('2025-01-01T00:00:00Z'),
    });

    expect(
      pool.calls.some((c) => c.text.includes('catalog_cache_metadata')),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listActiveExperiences
// ---------------------------------------------------------------------------

describe('CatalogRepo.listActiveExperiences', () => {
  it('lists every active row when no filter is provided', async () => {
    const pool = makePool(() => ({
      rows: [
        {
          id: 'a',
          upstream_entity_id: 'ua',
          name: 'Astro Orbiter',
          park: MAGIC_KINGDOM,
          category: RIDE,
          description: '',
          active: true,
          image_url: null,
          latitude: null,
          longitude: null,
          area_type: 'ThemePark',
          resort_id: null,
          accessibility: [],
          price_tier: null,
          meal_periods: [],
        },
        {
          id: 'b',
          upstream_entity_id: 'ub',
          name: 'Beauty and the Beast',
          park: EPCOT,
          category: SHOW,
          description: '',
          active: true,
          image_url: null,
          latitude: null,
          longitude: null,
          area_type: 'ThemePark',
          resort_id: null,
          accessibility: [],
          price_tier: null,
          meal_periods: [],
        },
      ],
    }));
    const repo = createCatalogRepo(pool as never);

    const rows = await repo.listActiveExperiences();

    expect(rows).toHaveLength(2);
    expect(pool.calls[0]?.text).toMatch(/WHERE active = TRUE\b/);
    expect(pool.calls[0]?.text).toMatch(/ORDER BY park ASC, lower\(name\) ASC, id ASC/);
    expect(pool.calls[0]?.params).toHaveLength(0);
  });

  it('appends park and category filters', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createCatalogRepo(pool as never);

    await repo.listActiveExperiences({ park: MAGIC_KINGDOM, category: RIDE });

    const call = pool.calls[0];
    expect(call?.text).toMatch(/active = TRUE AND park = \$1 AND category = \$2/);
    expect(call?.params).toEqual([MAGIC_KINGDOM, RIDE]);
  });

  it('escapes ILIKE metacharacters in the query parameter', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createCatalogRepo(pool as never);

    await repo.listActiveExperiences({ q: '100% _great\\stuff' });

    const call = pool.calls[0];
    expect(call?.text).toMatch(/name ILIKE \$1 ESCAPE '\\'/);
    // % -> \%, _ -> \_, \ -> \\, wrapped in % wildcards.
    expect(call?.params[0]).toBe('%100\\% \\_great\\\\stuff%');
  });

  it('treats whitespace-only `q` as no filter', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createCatalogRepo(pool as never);

    await repo.listActiveExperiences({ q: '   \t  ' });

    const call = pool.calls[0];
    expect(call?.text).not.toMatch(/ILIKE/);
    expect(call?.params).toHaveLength(0);
  });

  it('trims the query value before substituting', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createCatalogRepo(pool as never);

    await repo.listActiveExperiences({ q: '  pirates  ' });

    expect(pool.calls[0]?.params[0]).toBe('%pirates%');
  });
});

// ---------------------------------------------------------------------------
// getExperience
// ---------------------------------------------------------------------------

describe('CatalogRepo.getExperience', () => {
  it('returns the row regardless of active flag (R1.15)', async () => {
    const pool = makePool(() => ({
      rows: [
        {
          id: 'x',
          upstream_entity_id: 'ux',
          name: 'Retired Show',
          park: EPCOT,
          category: SHOW,
          description: 'Last performed years ago.',
          active: false,
          image_url: null,
          latitude: null,
          longitude: null,
          area_type: 'ThemePark',
          resort_id: null,
          accessibility: [],
          price_tier: null,
          meal_periods: [],
        },
      ],
    }));
    const repo = createCatalogRepo(pool as never);

    const row = await repo.getExperience('x');

    expect(row).toEqual({
      id: 'x',
      name: 'Retired Show',
      park: EPCOT,
      category: SHOW,
      description: 'Last performed years ago.',
      active: false,
      imageUrl: null,
      areaType: 'ThemePark',
    });
    expect(pool.calls[0]?.text).toMatch(/FROM experiences\s+WHERE id = \$1/);
  });

  it('returns null when no row matches', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const repo = createCatalogRepo(pool as never);

    expect(await repo.getExperience('missing')).toBeNull();
  });
});
