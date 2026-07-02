/**
 * End-to-end Disney sourcing smoke test (task 10.5, updated for
 * disney-source-resilience).
 *
 * This smoke test drives one full Disney-sourced Catalog_Sync against a
 * stubbed `Disney_Sync_Gateway` (`POST /_changes` + `POST /_bulk_get`), then
 * exercises the catalog read endpoints through the real `buildServer`
 * composition and asserts that:
 *
 *   - the catalog, resorts, and imagery all originate from the Disney sources,
 *     the SOLE source of Static_Catalog_Data (R13.3) — nothing is fabricated —
 *     R14.1,
 *   - the sync fetches NO menus and issues NO Menu_Service requests: menus are
 *     lazy/demand-driven now (R8.1, R10.4), so `runSync` reports
 *     `menusWritten: 0` and no cached menus exist after a sync,
 *   - `GET /catalog/:id/live` derives Live_Detail from ThemeParks.wiki keyed by
 *     the Experience's External_Id (== its Enterprise_Id), NOT from a Disney
 *     source (R13.1) — the un-retirement of ThemeParks.wiki as the sole source
 *     of Live_Data,
 *   - catalog/resort/detail reads are served from the Catalog_Cache without
 *     re-contacting the Disney sources while the cache is fresh (R12.6).
 *
 * Fidelity notes
 * --------------
 *
 * The test stubs Disney at the HTTP (`fetch`) boundary and uses the REAL
 * `createFacilitiesClient`, the REAL multipart parser, the REAL `runSync`
 * orchestrator (with a REAL `createDocumentStore` over the in-memory Postgres,
 * migrations 0001-0005 applied verbatim — 0005 adds `disney_documents` /
 * `disney_sync_checkpoint`), the REAL catalog repo, and the REAL catalog routes
 * wired through `buildServer`. So every catalog/resort/imagery assertion below
 * is a genuine end-to-end path from the Disney wire response into the served
 * DTO.
 *
 * The live path exercises the REAL ThemeParks.wiki live stack: the
 * `createThemeParksLiveClient` (against a stubbed `GET /entity/{externalId}/live`
 * feed), the `createThemeParksLiveService` orchestrator, and the real
 * `createLiveRepo` resolving the Experience's `upstream_entity_id` from the
 * synced `experiences` table. That keeps the live path genuinely
 * ThemeParks.wiki-sourced (R13.1) while proving the read never contacts a Disney
 * source for live data.
 *
 * Validates: Requirements 12.6, 13.1, 14.1
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MenuDTO } from '@dwt/shared';

import type { AppConfig } from '../../src/config.js';
import type { DbPool } from '../../src/db/pool.js';
import { buildServer } from '../../src/server.js';

import { createCatalogRepo } from '../../src/services/catalog/repo.js';
import { runSync, type RunSyncOptions } from '../../src/services/catalog/sync.js';
import { decideCatalogRead } from '../../src/services/catalog/readDecision.js';
import { createDocumentStore } from '../../src/services/catalog/documentStore.js';
import {
  createFacilitiesClient,
  type FacilitiesClient,
} from '../../src/services/catalog/disney/facilitiesClient.js';
import { createDisneyTransport } from '../../src/services/catalog/disney/transport.js';
import {
  createInProcessRateLimiter,
  createRedisRateLimiter,
} from '../../src/services/catalog/disney/rateLimiter.js';
import type { RedisClient } from '../../src/redis/client.js';
import {
  createMenuRetrieval,
  type MenuRetrievalRepo,
} from '../../src/services/catalog/menuRetrieval.js';
import type { MenuFetchState } from '../../src/services/catalog/repo.js';
import { createLiveRepo } from '../../src/services/live/repo.js';
import { createLiveCache } from '../../src/services/live/cache.js';
import { createThemeParksLiveClient } from '../../src/services/live/themeParksLiveClient.js';
import { createThemeParksLiveService } from '../../src/services/live/themeParksLiveService.js';
import { WDW_TIME_ZONE } from '../../src/services/live/parkTime.js';

// ---------------------------------------------------------------------------
// Stub Disney endpoints (only the shapes the client actually calls)
// ---------------------------------------------------------------------------

const SYNC_GATEWAY_BASE_URL = 'https://sync-gw.smoke.invalid/park-platform-pub';
const MENU_SERVICE_BASE_URL = 'https://menu.smoke.invalid/dining-menus';
const AUTHORIZATION_URL = 'https://authz.smoke.invalid/token';
const THEMEPARKS_BASE_URL = 'https://themeparks.smoke.invalid/v1';

// Enterprise_Ids of the seeded facility documents.
const RIDE_ENTERPRISE_ID = '80010110;entityType=Attraction';
const RESTAURANT_ENTERPRISE_ID = '80010177;entityType=Restaurant';
const RESORT_ENTERPRISE_ID = '80010407;entityType=Resort';
const RESORT_AREA_ENTERPRISE_ID = '80010500;entityType=resort-area';
const TRANSPORT_ENTERPRISE_ID = '80010900;entityType=bus-stop';

// The Magic Kingdom theme-park ancestor shared by the ride + restaurant.
const MAGIC_KINGDOM_ANCESTOR = {
  id: '80007944;entityType=theme-park',
  type: 'theme-park',
  name: 'Magic Kingdom Park',
};

/**
 * The facility documents the stubbed Sync Gateway enumerates + returns, keyed
 * by their Enterprise_Id (the `_bulk_get` doc id).
 */
const FACILITY_DOCS: Record<string, unknown> = {
  [RIDE_ENTERPRISE_ID]: {
    id: RIDE_ENTERPRISE_ID,
    name: 'Space Mountain',
    type: 'attraction',
    description: 'A <b>thrilling</b> indoor roller coaster.',
    detailImageUrl: 'https://cdn.disney.example/space-mountain-detail.jpg',
    listImageUrl: 'https://cdn.disney.example/space-mountain-list.jpg',
    latitude: 28.4189,
    longitude: -81.5779,
    ancestors: [MAGIC_KINGDOM_ANCESTOR],
    facets: { accessibility: ['must-transfer-wheelchair'] },
  },
  [RESTAURANT_ENTERPRISE_ID]: {
    id: RESTAURANT_ENTERPRISE_ID,
    name: 'Cinderella Royal Table',
    type: 'restaurant',
    description: '<p>Dine inside the castle.</p>',
    detailImageUrl: 'https://cdn.disney.example/crt-detail.jpg',
    ancestors: [MAGIC_KINGDOM_ANCESTOR],
    facets: {
      accessibility: ['wheelchair-access'],
      priceRangeDining: ['$$$$'],
    },
    mealPeriods: [
      { type: 'Breakfast', priceTier: '$$$$' },
      { type: 'Dinner', priceTier: '$$$$' },
    ],
  },
  [RESORT_ENTERPRISE_ID]: {
    id: RESORT_ENTERPRISE_ID,
    name: "Disney's Grand Floridian Resort & Spa",
    type: 'resort',
    description: '<p>A flagship Victorian-style resort.</p>',
    detailImageUrl: 'https://cdn.disney.example/grand-floridian-detail.jpg',
    latitude: 28.4106,
    longitude: -81.5875,
    address: '4401 Floridian Way, Lake Buena Vista, FL 32830',
    phone: '(407) 824-3000',
  },
  // A `resort-area` document — a Non_Experience_Type that is NOT a resort and
  // must be excluded from both the Experience and Resort sets (R6.2, R4.1).
  [RESORT_AREA_ENTERPRISE_ID]: {
    id: RESORT_AREA_ENTERPRISE_ID,
    name: 'Magic Kingdom Resort Area',
    type: 'resort-area',
  },
  // A structural transportation document — a Non_Experience_Type dropped
  // entirely (R4.1).
  [TRANSPORT_ENTERPRISE_ID]: {
    id: TRANSPORT_ENTERPRISE_ID,
    name: 'Contemporary Bus Stop',
    type: 'bus-stop',
    ancestors: [MAGIC_KINGDOM_ANCESTOR],
  },
};

/**
 * The instant used to scope the ThemeParks.wiki live projection's "current
 * park day" (R11.9). Fixed so the forecast fixture below lands on the same
 * Eastern calendar day regardless of when the suite runs. `15:30Z` on
 * 2024-06-01 is 11:30 EDT, and the forecast entries at 16:00Z / 17:00Z are
 * 12:00 / 13:00 EDT the same day.
 */
const LIVE_NOW = new Date('2024-06-01T15:30:00Z');

/**
 * The ThemeParks.wiki `GET /entity/{externalId}/live` feed for the ride, keyed
 * upstream by its External_Id (== the Experience's Enterprise_Id, R11.2). This
 * is the ONLY live source now (R13.1); the Disney sources are never contacted
 * for live data.
 */
const THEMEPARKS_LIVE_RESPONSE = {
  id: RIDE_ENTERPRISE_ID,
  name: 'Space Mountain',
  entityType: 'ATTRACTION',
  timezone: WDW_TIME_ZONE,
  liveData: [
    {
      id: RIDE_ENTERPRISE_ID,
      status: 'OPERATING',
      lastUpdated: '2024-06-01T15:30:00Z',
      queue: {
        STANDBY: { waitTime: 35 },
        SINGLE_RIDER: { waitTime: 10 },
      },
      forecast: [
        { time: '2024-06-01T16:00:00Z', waitTime: 40, percentage: 65 },
        { time: '2024-06-01T17:00:00Z', waitTime: 55, percentage: 80 },
      ],
    },
  ],
};

/** Menus returned by the stubbed Menu_Service, keyed by restaurant Enterprise_Id. */
const MENUS_BY_ENTERPRISE_ID: Record<string, unknown[]> = {
  [RESTAURANT_ENTERPRISE_ID]: [
    {
      menuType: 'Dinner',
      cuisineType: 'American',
      groups: [
        {
          name: 'Entrees',
          items: [
            { name: 'Chef-inspired Beef Tenderloin', price: '$62' },
            { name: 'Roasted Chicken', price: '$45' },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Fetch stub + call recorder
// ---------------------------------------------------------------------------

interface FetchCall {
  readonly method: string;
  readonly url: string;
}

/**
 * A `fetch`-shaped stub over the Disney endpoints the `FacilitiesClient`
 * touches. It records every call so the test can prove the read path does not
 * re-contact the Sync Gateway while the cache is fresh (R12.6).
 */
function createStubDisneyFetch(log: FetchCall[]): typeof globalThis.fetch {
  const encodeMultipart = (docs: readonly unknown[]): { body: string; contentType: string } => {
    const boundary = `smoke-boundary-${randomUUID()}`;
    let body = '';
    for (const doc of docs) {
      body += `--${boundary}\r\n`;
      body += 'Content-Type: application/json\r\n\r\n';
      body += `${JSON.stringify(doc)}\r\n`;
    }
    body += `--${boundary}--\r\n`;
    return { body, contentType: `multipart/related; boundary=${boundary}` };
  };

  const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const stub = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    log.push({ method, url });

    // POST /_changes — enumerate the requested channel's document ids. Only
    // the WDW facilities channel is enumerated by runSync.
    if (url.endsWith('/_changes')) {
      const ids = Object.keys(FACILITY_DOCS);
      return json({
        results: ids.map((id) => ({ id, seq: id, changes: [{ rev: '1-smoke' }] })),
        last_seq: 'smoke-seq',
      });
    }

    // POST /_bulk_get — return a multipart/related body of the requested docs.
    if (url.endsWith('/_bulk_get')) {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        docs?: readonly { id: string }[];
      };
      const requested = parsed.docs ?? [];
      const docs: unknown[] = [];
      for (const { id } of requested) {
        const doc = FACILITY_DOCS[id];
        if (doc !== undefined) {
          docs.push(doc);
        }
      }
      const { body, contentType } = encodeMultipart(docs);
      return new Response(body, {
        status: 200,
        headers: { 'content-type': contentType },
      });
    }

    // Public_Token acquisition (anonymous assertion/public grant).
    if (url === AUTHORIZATION_URL) {
      return json({ access_token: 'smoke-public-token', expires_in: 3600 });
    }

    // Menu_Service GET <base>/<encoded Enterprise_Id>.
    if (url.startsWith(MENU_SERVICE_BASE_URL)) {
      const lastSegment = url.slice(url.lastIndexOf('/') + 1);
      const enterpriseId = decodeURIComponent(lastSegment);
      return json(MENUS_BY_ENTERPRISE_ID[enterpriseId] ?? []);
    }

    throw new Error(`Unexpected stub fetch to ${method} ${url}`);
  };

  return stub as unknown as typeof globalThis.fetch;
}

/**
 * A `fetch`-shaped stub over the single ThemeParks.wiki live endpoint the
 * `ThemeParksLiveClient` touches (`GET /entity/{externalId}/live`). It records
 * every call into the shared `log` so the live test can prove the read path is
 * ThemeParks.wiki-sourced (R13.1) and never re-contacts a Disney source.
 */
function createStubThemeParksFetch(log: FetchCall[]): typeof globalThis.fetch {
  const stub = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    log.push({ method, url });

    if (url.includes('/entity/') && url.endsWith('/live')) {
      return new Response(JSON.stringify(THEMEPARKS_LIVE_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected ThemeParks stub fetch to ${method} ${url}`);
  };

  return stub as unknown as typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors services/catalog/__tests__/repo.apply.integration.test.ts)
// ---------------------------------------------------------------------------

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
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
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
  // test/smoke -> ../../migrations
  return resolve(here, '..', '..', 'migrations', name);
}

function applyMigrations(db: IMemoryDb): void {
  // 0001 carries GIN trigram indexes pg-mem cannot model; strip them.
  let init = readFileSync(migrationPath('0001_init.sql'), 'utf8');
  init = init.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(init);
  db.public.none(readFileSync(migrationPath('0002_experience_images.sql'), 'utf8'));
  db.public.none(readFileSync(migrationPath('0003_note_shareable.sql'), 'utf8'));
  db.public.none(readFileSync(migrationPath('0004_disney_sources.sql'), 'utf8'));
  // 0005 adds the Document_Store tables (`disney_documents`,
  // `disney_sync_checkpoint`) the refactored `runSync` reads/writes through the
  // real `createDocumentStore`, plus `experience_menus.fetched_at`.
  db.public.none(
    readFileSync(migrationPath('0005_disney_source_resilience.sql'), 'utf8'),
  );
  // 0006 adds the additive `experiences.land` column the reconcile/repo read
  // path now reads and writes; without it the post-sync catalog reads fail.
  db.public.none(readFileSync(migrationPath('0006_experience_land.sql'), 'utf8'));
}

// ---------------------------------------------------------------------------
// pg-mem `= ANY($n)` array-param shim (copied from documentStore.prop.test.ts)
// ---------------------------------------------------------------------------

/**
 * pg-mem cannot bind an array parameter to a `col = ANY($n)` predicate (real
 * Postgres does this natively) — the update silently matches nothing. The
 * Document_Store relies on `= ANY($1)` for its tombstone SQL, so this wrapper
 * rewrites any such predicate into an equivalent `col IN ($a, $b, …)` list,
 * appending the array's elements as fresh trailing parameters. It is a
 * harness-only shim for a known pg-mem limitation and leaves the store's real
 * SQL (JSONB upserts, ON CONFLICT, transactions, the singleton checkpoint)
 * running verbatim. The store never issues a `= ANY` predicate with an empty
 * array (both `markDeleted` and `applyDelta` short-circuit on empty input), so
 * an empty `IN ()` list can never be produced here.
 */
function adaptAnyArrayParams(
  text: string,
  params?: ReadonlyArray<unknown>,
): [string, ReadonlyArray<unknown> | undefined] {
  if (params === undefined || !/=\s*ANY\(\$\d+\)/i.test(text)) {
    return [text, params];
  }
  const newParams = [...params];
  const newText = text.replace(/=\s*ANY\(\$(\d+)\)/gi, (match, num: string) => {
    const arr = params[Number(num) - 1];
    if (!Array.isArray(arr)) {
      return match;
    }
    const placeholders = arr.map((value) => {
      newParams.push(value);
      return `$${newParams.length}`;
    });
    return `IN (${placeholders.join(', ')})`;
  });
  return [newText, newParams];
}

/** Wrap a pg-mem pool so `= ANY($n)` array predicates work (see above). */
function withAnyArrayCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      const [t, p] = adaptAnyArrayParams(text, params);
      return raw.query(t, p);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          const [t, p] = adaptAnyArrayParams(text, params);
          return client.query(t, p);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Fake Redis — SET ... NX PX + compare-and-delete EVAL (mirrors sync tests)
// ---------------------------------------------------------------------------

function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async set(
      key: string,
      value: string,
      _pxFlag: string,
      _ttlMs: number,
      nxFlag: string,
    ): Promise<'OK' | null> {
      if (nxFlag === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async eval(
      _script: string,
      _numKeys: number,
      key: string,
      token: string,
    ): Promise<number> {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

type FakeRedis = NonNullable<RunSyncOptions['redis']>;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function buildSmokeConfig(): AppConfig {
  return {
    env: 'test',
    server: { host: '127.0.0.1', port: 0, logLevel: 'silent' },
    database: { url: 'postgres://smoke/dwt' },
    redis: { url: 'redis://smoke:6379' },
    s3: {
      endpoint: 'https://s3.example.com',
      bucket: 'avatars',
      accessKeyId: 'smoke-access-key',
      secretAccessKey: 'smoke-secret-key',
    },
    session: { secret: 'smoke-session-secret-must-be-at-least-32-chars' },
    themeparks: { baseUrl: 'https://api.themeparks.example.invalid/v1' },
    disney: {
      syncGateway: { baseUrl: SYNC_GATEWAY_BASE_URL },
      credentials: { username: 'smoke-user', password: 'smoke-pass' },
      // Required by the disney-source-resilience AppConfig contract; match the
      // config.ts defaults (R2/R3/R8/R9).
      requestBudget: { maxRequestsPerSecond: 5, maxConcurrency: 4 },
      backoff: {
        baseDelayMs: 500,
        factor: 2,
        maxRetries: 5,
        maxDelayMs: 30_000,
        maxTotalDelayMs: 120_000,
      },
      diningMenuBaseUrl: MENU_SERVICE_BASE_URL,
      menuFreshnessMs: 86_400_000,
      syncIntervalMs: 86_400_000,
    },
  };
}

// ---------------------------------------------------------------------------
// ThemeParks.wiki live cache (in-memory Redis fake for createLiveCache)
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory `LiveCacheRedis` so the REAL `createLiveCache` (JSON
 * envelope + `liveDetailSchema` validation) runs verbatim without standing up
 * Redis. `set(key, value, 'EX', seconds)` ignores the TTL tail — the map lives
 * only for the test.
 */
function createFakeLiveCacheRedis() {
  const store = new Map<string, string>();
  return {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async set(
      key: string,
      value: string,
      ..._args: Array<string | number>
    ): Promise<unknown> {
      store.set(key, value);
      return 'OK';
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Disney sourcing end-to-end smoke (R12.6, R13.1, R14.1)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fetchLog: FetchCall[];
  let client: FacilitiesClient;
  let syncResult: Awaited<ReturnType<typeof runSync>>;
  let readTriggeredSync: number;

  beforeAll(async () => {
    fetchLog = [];
    readTriggeredSync = 0;

    // --- Backends ----------------------------------------------------
    db = buildPgMemDatabase();
    const { Pool } = db.adapters.createPg();
    pool = new Pool() as unknown as DbPool;
    applyMigrations(db);

    const redis = createFakeRedis();
    const catalogRepo = createCatalogRepo(pool);

    // --- Real Facilities_Client over the stubbed Disney endpoints ----
    // The client now dispatches exclusively through the shared Disney_Transport
    // (rate limiter + User-Agent + retry/backoff); we inject the stub `fetch`
    // and an in-process Rate_Limiter so the real egress path runs end-to-end.
    const disneyLimiter = createInProcessRateLimiter({
      maxRequestsPerSecond: 5,
      maxConcurrency: 4,
    });
    const disneyTransport = createDisneyTransport({
      limiter: disneyLimiter,
      backoff: {
        baseDelayMs: 500,
        factor: 2,
        maxRetries: 5,
        maxDelayMs: 30_000,
        maxTotalDelayMs: 120_000,
      },
      fetch: createStubDisneyFetch(fetchLog),
    });
    client = createFacilitiesClient({
      transport: disneyTransport,
      baseUrl: SYNC_GATEWAY_BASE_URL,
      credentials: { username: 'smoke-user', password: 'smoke-pass' },
      menuService: {
        baseUrl: MENU_SERVICE_BASE_URL,
        authorizationUrl: AUTHORIZATION_URL,
        clientId: 'SMOKE-CLIENT',
      },
    });

    // --- Run one full Disney-sourced Catalog_Sync --------------------
    // The refactored orchestrator reads/writes the Document_Store; wrap the
    // pg-mem pool so the store's `= ANY($1)` tombstone predicate binds.
    syncResult = await runSync({
      client,
      repo: catalogRepo,
      documentStore: createDocumentStore(withAnyArrayCompat(pool)),
      redis: redis as unknown as FakeRedis,
    });

    // --- Build the real server over the freshly synced cache ---------
    const config = buildSmokeConfig();
    const decideRead = (): ReturnType<typeof decideCatalogRead> =>
      decideCatalogRead({
        repo: {
          async getCacheAgeHours() {
            const info = await catalogRepo.getCacheAge();
            return info.hours;
          },
        },
        sync: {
          // Records whether a read triggered an opportunistic sync. With a
          // fresh cache (R12.6) this must never fire.
          async runOrJoinSync() {
            readTriggeredSync += 1;
          },
        },
      });

    // --- ThemeParks.wiki-sourced Live_Service (R13.1) ----------------
    // Live_Detail now comes from ThemeParks.wiki, not Disney. The real live
    // stack resolves the Experience's Enterprise_Id (== External_Id) from the
    // synced `experiences` table and fetches the ThemeParks `/entity/:id/live`
    // feed through the stubbed ThemeParks fetch — never a Disney source.
    const liveService = createThemeParksLiveService({
      repo: createLiveRepo(pool),
      cache: createLiveCache(createFakeLiveCacheRedis()),
      client: createThemeParksLiveClient({
        baseUrl: THEMEPARKS_BASE_URL,
        fetch: createStubThemeParksFetch(fetchLog),
      }),
      // The production directory maps Enterprise_Id (External_Id) → the
      // ThemeParks entity id; the stubbed feed is keyed by the Enterprise_Id, so
      // an identity resolver mirrors that join for the smoke test.
      resolveEntityId: async (id: string) => id,
      now: () => LIVE_NOW,
    });

    app = buildServer(config, {
      catalog: {
        decideRead,
        listActiveExperiences: (filters) =>
          catalogRepo.listActiveExperiences(filters),
        getExperience: (id) => catalogRepo.getExperience(id),
        getMenusFor: (id) => catalogRepo.getMenusFor(id),
        listActiveResorts: () => catalogRepo.listActiveResorts(),
        getLiveDetail: (id) => liveService.getLiveDetail(id),
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } catch {
      // idempotent close; ignore secondary errors.
    }
    try {
      await (pool as unknown as { end?: () => Promise<void> }).end?.();
    } catch {
      // pg-mem Pool#end is a shim; ignore.
    }
  });

  it('runs a full Disney-sourced sync that persists Experiences and a Resort, fetching no menus', () => {
    expect(syncResult.status).toBe('success');
    if (syncResult.status !== 'success') return;
    // Ride + Restaurant as Experiences and the Grand Floridian as a Resort;
    // resort-area and bus-stop are excluded.
    expect(syncResult.entitiesProcessed).toBe(3);
    expect(syncResult.resortUpserts).toBe(1);
    // Menus are lazy/demand-driven now — the sync fetches and writes none
    // (R8.1, R10.4).
    expect(syncResult.menusWritten).toBe(0);

    // The sync actually contacted the stubbed Disney Sync Gateway for the
    // static catalog channel.
    expect(fetchLog.some((c) => c.url.endsWith('/_changes'))).toBe(true);
    expect(fetchLog.some((c) => c.url.endsWith('/_bulk_get'))).toBe(true);
    // It issued NO Menu_Service requests and NO Public_Token grant during the
    // run — menus are never fetched during sync (R8.1, R10.4).
    expect(fetchLog.some((c) => c.url === AUTHORIZATION_URL)).toBe(false);
    expect(fetchLog.some((c) => c.url.startsWith(MENU_SERVICE_BASE_URL))).toBe(
      false,
    );
  });

  it('GET /catalog serves Disney-sourced Experiences from cache with Disney imagery (R12.6, R14.1)', async () => {
    const before = fetchLog.length;

    const res = await app.inject({ method: 'GET', url: '/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      experiences: Array<{
        id: string;
        name: string;
        park: string | null;
        category: string;
        areaType: string;
        imageUrl: string | null;
        accessibility?: readonly string[];
      }>;
      staleCache: boolean;
      cacheAgeHours: number | null;
    };

    const names = body.experiences.map((e) => e.name).sort();
    expect(names).toEqual(['Cinderella Royal Table', 'Space Mountain']);

    // Non_Experience_Types never surface in the catalog.
    expect(names).not.toContain('Magic Kingdom Resort Area');
    expect(names).not.toContain('Contemporary Bus Stop');

    const ride = body.experiences.find((e) => e.name === 'Space Mountain');
    expect(ride?.category).toBe('Ride');
    expect(ride?.park).toBe('Magic Kingdom');
    expect(ride?.areaType).toBe('ThemePark');
    // Imagery originates from the Disney detailImageUrl (R7.1, R14.1).
    expect(ride?.imageUrl).toBe(
      'https://cdn.disney.example/space-mountain-detail.jpg',
    );
    expect(ride?.accessibility).toEqual(['must-transfer-wheelchair']);

    // Served fresh from cache — no staleness, and no opportunistic sync or
    // Disney Sync Gateway contact happened during the read (R12.6).
    expect(body.staleCache).toBe(false);
    expect(readTriggeredSync).toBe(0);
    const during = fetchLog.slice(before);
    expect(during.some((c) => c.url.endsWith('/_changes'))).toBe(false);
    expect(during.some((c) => c.url.endsWith('/_bulk_get'))).toBe(false);
  });

  it('GET /resorts serves the Disney-sourced Resort from cache (R6.8, R14.1)', async () => {
    const before = fetchLog.length;

    const res = await app.inject({ method: 'GET', url: '/resorts' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      resorts: Array<{
        id: string;
        name: string;
        description: string | null;
        imageUrl: string | null;
        latitude: number | null;
        longitude: number | null;
        address: string | null;
        phone: string | null;
      }>;
    };

    expect(body.resorts).toHaveLength(1);
    const resort = body.resorts[0]!;
    expect(resort.name).toBe("Disney's Grand Floridian Resort & Spa");
    expect(resort.imageUrl).toBe(
      'https://cdn.disney.example/grand-floridian-detail.jpg',
    );
    expect(resort.latitude).toBe(28.4106);
    expect(resort.longitude).toBe(-81.5875);
    expect(resort.address).toBe(
      '4401 Floridian Way, Lake Buena Vista, FL 32830',
    );
    expect(resort.phone).toBe('(407) 824-3000');
    // Description is persisted as sanitized plain text (no markup).
    expect(resort.description).not.toContain('<');

    // Read served from cache; no Disney Sync Gateway contact.
    const during = fetchLog.slice(before);
    expect(during.some((c) => c.url.endsWith('/_bulk_get'))).toBe(false);
  });

  it('GET /catalog/:id serves a restaurant detail with Disney imagery from cache; no menus cached after sync (R8.1, R10.4, R14.1)', async () => {
    // Resolve the restaurant id from the catalog listing first.
    const list = (
      await app.inject({ method: 'GET', url: '/catalog' })
    ).json() as { experiences: Array<{ id: string; name: string }> };
    const restaurant = list.experiences.find(
      (e) => e.name === 'Cinderella Royal Table',
    );
    expect(restaurant).toBeDefined();

    const before = fetchLog.length;
    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${restaurant!.id}`,
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json() as {
      name: string;
      category: string;
      imageUrl: string | null;
      priceTier?: string | null;
      mealPeriods?: Array<{ type: string; priceTier?: string | null }>;
      description: string;
      menus?: Array<{
        menuType: string;
        cuisineType?: string | null;
        groups: Array<{
          name: string;
          items: Array<{ name: string; price?: string | null }>;
        }>;
      }>;
    };

    expect(detail.category).toBe('Restaurant');
    expect(detail.imageUrl).toBe('https://cdn.disney.example/crt-detail.jpg');
    expect(detail.priceTier).toBe('$$$$');
    expect(detail.mealPeriods?.map((m) => m.type)).toEqual([
      'Breakfast',
      'Dinner',
    ]);
    // Description sanitized to plain text (R11.8).
    expect(detail.description).not.toContain('<');

    // Menus are lazy/demand-driven now (R8.1, R10.4): the sync writes none, so
    // the cache-backed detail read carries no menus.
    expect(detail.menus).toBeUndefined();

    // Detail read served from cache; no Disney Sync Gateway contact.
    const during = fetchLog.slice(before);
    expect(during.some((c) => c.url.endsWith('/_bulk_get'))).toBe(false);
  });

  it('GET /catalog/:id/live derives Live_Detail from ThemeParks.wiki by External_Id, never from Disney (R13.1)', async () => {
    const list = (
      await app.inject({ method: 'GET', url: '/catalog' })
    ).json() as { experiences: Array<{ id: string; name: string }> };
    const ride = list.experiences.find((e) => e.name === 'Space Mountain');
    expect(ride).toBeDefined();

    const before = fetchLog.length;
    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${ride!.id}/live`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      liveDetail: {
        status: string;
        waitMinutes?: number;
        singleRiderWaitMinutes?: number;
        forecast?: Array<{ time: string; waitMinutes: number; percentage: number }>;
      };
      retrievedAt: string;
      stale: boolean;
    };

    expect(body.liveDetail.status).toBe('Operating');
    expect(body.liveDetail.waitMinutes).toBe(35);
    expect(body.liveDetail.singleRiderWaitMinutes).toBe(10);
    expect(body.liveDetail.forecast).toHaveLength(2);
    expect(body.liveDetail.forecast?.[0]?.waitMinutes).toBe(40);
    expect(body.stale).toBe(false);

    // The live path is sourced from ThemeParks.wiki (R13.1): it contacted the
    // ThemeParks `/entity/{externalId}/live` endpoint keyed by the ride's
    // External_Id (== its Enterprise_Id), and NEVER a Disney source.
    const during = fetchLog.slice(before);
    expect(
      during.some((c) => c.url.includes('/entity/') && c.url.endsWith('/live')),
    ).toBe(true);
    expect(during.some((c) => c.url.endsWith('/_bulk_get'))).toBe(false);
  });
});

// ===========================================================================
// Menu retrieval wiring: transport + budget routing (R2.1, R2.3)
// ===========================================================================
//
// The end-to-end suite above proves the *sync* path never touches the
// Menu_Service. This block proves the complementary demand-driven wiring the
// composition root installs (`composeServices.ts`): the lazy `MenuRetrieval`
// seam is built on the SAME composed `facilitiesClient` that sits on top of the
// shared `Disney_Transport` and the Redis-backed `Rate_Limiter`, so EVERY
// Menu_Service egress request first acquires a Request_Budget lease and is
// dispatched through the transport — and NO path reaches the Menu_Service
// without it (R2.1, R2.3).
//
// The assertion is structural and ordering-based: a single ordered event log
// records both every Rate_Limiter `acquire(bucket)` and every `fetch(url)`.
// Because the transport is the only code that both leases and dispatches, a
// Menu_Service fetch that were to bypass the transport/budget would appear in
// the log WITHOUT an immediately-preceding lease acquisition. Proving every
// Menu_Service (`web`) fetch is immediately preceded by a `web` lease acquire
// therefore proves the budget governs every Menu_Service dispatch.

/** An ordered record of a budget lease acquisition or an HTTP dispatch. */
type WiringEvent =
  | { readonly kind: 'acquire'; readonly bucket: string }
  | { readonly kind: 'fetch'; readonly url: string };

/**
 * A `fetch`-shaped stub for the Menu_Service + Public_Token endpoints that
 * appends every dispatch to the shared ordered `events` log. It responds only
 * to the two `web`-target URLs `getMenus` touches (token grant + menu GET); any
 * other URL throws, so an unexpected egress path fails loudly.
 */
function createMenuWiringFetch(events: WiringEvent[]): typeof globalThis.fetch {
  const json = (value: unknown): Response =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const stub = async (
    input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    events.push({ kind: 'fetch', url });

    if (url === AUTHORIZATION_URL) {
      return json({ access_token: 'wiring-public-token', expires_in: 3600 });
    }
    if (url.startsWith(MENU_SERVICE_BASE_URL)) {
      const lastSegment = url.slice(url.lastIndexOf('/') + 1);
      const enterpriseId = decodeURIComponent(lastSegment);
      return json(MENUS_BY_ENTERPRISE_ID[enterpriseId] ?? []);
    }
    throw new Error(`Unexpected menu-wiring fetch to ${url}`);
  };

  return stub as unknown as typeof globalThis.fetch;
}

/**
 * A minimal `RedisClient` fake driving the authoritative Redis-backed
 * Rate_Limiter without a real Redis. It records each budget acquisition (the
 * two-key acquire script) into the shared ordered log — deriving the target
 * bucket from the `disney:ratelimit:{bucket}:*` key — and always grants
 * (`[0, 0]`). The one-key release script is a no-op returning `0`. This proves
 * the transport really consults the Redis-backed limiter before every dispatch.
 */
function createFakeBudgetRedis(events: WiringEvent[]): RedisClient {
  return {
    async eval(
      _script: string,
      numKeys: number,
      ...args: Array<string | number>
    ): Promise<unknown> {
      if (numKeys === 2) {
        // args[0] = `disney:ratelimit:{bucket}:concurrency`.
        const bucket = String(args[0]).split(':')[2] ?? 'unknown';
        events.push({ kind: 'acquire', bucket });
        return [0, 0]; // granted: one rate slot + one concurrency slot
      }
      return 0; // release
    },
  } as unknown as RedisClient;
}

/**
 * A fake {@link MenuRetrievalRepo} for a single restaurant whose cache is
 * missing, so `getMenuForRestaurant` is forced down the fetch path (the only
 * path that contacts the Menu_Service). `upsertMenus` records the persisted
 * menus so the test can confirm the fetched result flowed back through the seam.
 */
function createFakeMenuRepo(upstreamEntityId: string): {
  readonly repo: MenuRetrievalRepo;
  readonly upserts: (readonly MenuDTO[])[];
} {
  const upserts: (readonly MenuDTO[])[] = [];
  const repo: MenuRetrievalRepo = {
    async getMenuFetchState(): Promise<MenuFetchState | null> {
      // Cache missing ⇒ decideMenuFetch returns true ⇒ fetch on demand (R8.2).
      return { upstreamEntityId, cached: null };
    },
    async upsertMenus(_experienceId, menus): Promise<void> {
      upserts.push(menus);
    },
  };
  return { repo, upserts };
}

type MenuDTOList = readonly MenuDTO[];

describe('Menu retrieval wiring: transport + budget routing (R2.1, R2.3)', () => {
  let events: WiringEvent[];
  let served: readonly unknown[];
  let upserts: MenuDTOList[];

  beforeAll(async () => {
    events = [];

    // --- Composed Disney egress stack (mirrors composeServices.ts) --------
    // Authoritative Redis-backed Request_Budget → shared Disney_Transport →
    // shared Facilities_Client. This is the exact chain the composition root
    // wires; here the Redis and fetch boundaries are faked so the real seam
    // classes run end-to-end.
    const budget = createRedisRateLimiter(
      { maxRequestsPerSecond: 5, maxConcurrency: 4 },
      { redis: createFakeBudgetRedis(events) },
    );
    const transport = createDisneyTransport({
      limiter: budget,
      backoff: {
        baseDelayMs: 500,
        factor: 2,
        maxRetries: 5,
        maxDelayMs: 30_000,
        maxTotalDelayMs: 120_000,
      },
      fetch: createMenuWiringFetch(events),
    });
    const facilitiesClient = createFacilitiesClient({
      transport,
      baseUrl: SYNC_GATEWAY_BASE_URL,
      credentials: { username: 'smoke-user', password: 'smoke-pass' },
      menuService: {
        baseUrl: MENU_SERVICE_BASE_URL,
        authorizationUrl: AUTHORIZATION_URL,
        clientId: 'WIRING-CLIENT',
      },
    });

    // --- Lazy retrieval seam wired to the composed client ----------------
    // Exactly the `createMenuRetrieval({ repo, client: facilitiesClient, ... })`
    // wiring composeServices.ts installs; the repo is faked with a missing
    // cache so the fetch path (the only Menu_Service egress) runs.
    const fake = createFakeMenuRepo(RESTAURANT_ENTERPRISE_ID);
    upserts = fake.upserts;
    const menuRetrieval = createMenuRetrieval({
      repo: fake.repo,
      client: facilitiesClient,
      freshnessMs: 86_400_000,
    });

    // The catalog `getMenusFor` port as composed at the composition root.
    const getMenusFor = (id: string): Promise<readonly unknown[]> =>
      menuRetrieval.getMenuForRestaurant(id);

    served = await getMenusFor('experience-crt');
  });

  it('fetches the restaurant menu through the composed Menu_Service egress', () => {
    // The seam resolved the fetched menus back through to the caller, and
    // persisted them via the repo — proving the wiring runs end-to-end.
    expect(served).toHaveLength(1);
    expect((served[0] as { menuType: string }).menuType).toBe('Dinner');
    expect(upserts).toHaveLength(1);

    // The Menu_Service was actually contacted (demand-driven fetch path).
    const menuFetches = events.filter(
      (e): e is Extract<WiringEvent, { kind: 'fetch' }> =>
        e.kind === 'fetch' && e.url.startsWith(MENU_SERVICE_BASE_URL),
    );
    expect(menuFetches).toHaveLength(1);
    // At most one Menu_Service request per detail read: one response carries
    // every menu (R2.2 is exercised incidentally here).
    expect(
      events.filter(
        (e) => e.kind === 'fetch' && e.url.startsWith(MENU_SERVICE_BASE_URL),
      ),
    ).toHaveLength(1);
  });

  it('leases the Redis-backed Request_Budget before every Menu_Service dispatch (R2.1)', () => {
    // The transport acquires a `web`-bucket lease from the Redis-backed limiter
    // before each `web` dispatch (Public_Token grant + menu GET), always
    // through the shared budget.
    const acquires = events.filter((e) => e.kind === 'acquire');
    const fetches = events.filter((e) => e.kind === 'fetch');

    // Every dispatch consumed exactly one budget lease.
    expect(acquires).toHaveLength(fetches.length);
    expect(acquires.length).toBeGreaterThan(0);
    // Every Menu_Service egress leases the authoritative `web` bucket.
    expect(acquires.every((e) => e.kind === 'acquire' && e.bucket === 'web')).toBe(
      true,
    );
  });

  it('routes every Menu_Service request through the transport — none bypasses the budget (R2.3)', () => {
    // Ordering invariant: because the transport is the only code that both
    // leases the budget and dispatches, EVERY fetch must be immediately
    // preceded by a lease acquisition. A Menu_Service call that bypassed the
    // transport/budget would appear as a `fetch` with no preceding `acquire`.
    events.forEach((event, index) => {
      if (event.kind !== 'fetch') {
        return;
      }
      const previous = events[index - 1];
      expect(previous).toBeDefined();
      expect(previous?.kind).toBe('acquire');
      expect(previous?.kind === 'acquire' && previous.bucket).toBe('web');
    });

    // And there is no Menu_Service dispatch that never leased the budget: the
    // acquire/fetch counts match and every fetch is a leased `web` dispatch.
    const fetches = events.filter((e) => e.kind === 'fetch');
    const leasedWebFetches = events.filter((event, index) => {
      if (event.kind !== 'fetch') return false;
      const previous = events[index - 1];
      return previous?.kind === 'acquire' && previous.bucket === 'web';
    });
    expect(leasedWebFetches).toHaveLength(fetches.length);
  });
});
