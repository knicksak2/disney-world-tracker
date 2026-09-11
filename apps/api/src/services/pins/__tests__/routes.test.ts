/**
 * Route integration tests for the Pin_Service, driven through the real
 * `buildServer` + `server.inject` over pg-mem-backed repos. These exercise the
 * `GET /me/pins` board read (auth gate, whole-collection summary, filters) and
 * the synchronous award-on-log path — the log mutation returns the newly-earned
 * Pin ids so the client can celebrate (R2.1, R3.1, R3.2, R3.3, R5.5).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { preHandlerHookHandler } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PINS } from '@dwt/shared';

import type { AppConfig } from '../../../config.js';
import type { DbPool } from '../../../db/pool.js';
import { buildServer } from '../../../server.js';
import { createExperienceLogRepo } from '../../tracking/logs/repo.js';
import { createPinRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem harness (mirrors repo.integration.test.ts)
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

function applyMigration(db: IMemoryDb, name: string): void {
  const here = dirname(fileURLToPath(import.meta.url));
  let sql = readFileSync(resolve(here, '..', '..', '..', '..', 'migrations', name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

const MIGRATIONS = [
  '0001_init.sql',
  '0006_experience_land.sql',
  '0008_experience_facet_enrichment.sql',
  '0014_experience_world_showcase_country.sql',
  '0015_trips.sql',
  '0032_experience_category_taxonomy.sql',
  '0034_experience_logs.sql',
  '0035_pins_and_challenges.sql',
  '0036_pin_claiming.sql',
];

function testConfig(): AppConfig {
  return {
    env: 'test',
    server: { host: '127.0.0.1', port: 0, logLevel: 'silent' },
    database: { url: 'postgres://test/dwt' },
    redis: { url: 'redis://test:6379' },
    session: { secret: 'test-session-secret-must-be-at-least-32-chars' },
    intelligence: { samplingCronSecret: 'test-sampling-secret', crowdSeedDir: 'seed-data/crowd/' },
    pins: { reconcileCronSecret: 'test-pin-reconcile-secret' },
    themeparks: { baseUrl: 'https://themeparks.invalid/v1' },
    disney: {
      syncGateway: { baseUrl: 'https://disney.invalid' },
      credentials: { username: 'u', password: 'p' },
      requestBudget: { maxRequestsPerSecond: 5, maxConcurrency: 4 },
      backoff: {
        baseDelayMs: 500,
        factor: 2,
        maxRetries: 5,
        maxDelayMs: 30_000,
        maxTotalDelayMs: 120_000,
      },
      diningMenuBaseUrl: 'https://disney.invalid/menu',
      menuFreshnessMs: 86_400_000,
      syncIntervalMs: 86_400_000,
    },
  } as AppConfig;
}

/** Session stub: `x-user-id` header → `request.userId`; otherwise 401. */
function sessionStub(): preHandlerHookHandler {
  return async (request, reply) => {
    const uid = request.headers['x-user-id'];
    if (typeof uid === 'string' && uid.length > 0) {
      request.userId = uid;
      return;
    }
    await reply
      .code(401)
      .send({ error: { code: 'unauthorized', message: 'No session.' } });
  };
}

interface Harness {
  readonly app: Awaited<ReturnType<typeof buildServer>>;
  readonly pool: DbPool;
}

async function setup(): Promise<Harness> {
  const db = buildPgMemDatabase();
  for (const name of MIGRATIONS) applyMigration(db, name);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as DbPool;

  const pinRepo = createPinRepo(pool);
  const logRepo = createExperienceLogRepo({ pool, emitRatingChanged: async () => {} });
  const requireSession = sessionStub();

  const app = buildServer(testConfig(), {
    pins: { repo: pinRepo, requireSession },
    tracking: {
      logs: {
        repo: logRepo,
        requireSession,
        awardPins: (userId) => pinRepo.awardNewly(userId),
      },
    },
  });
  await app.ready();
  return { app, pool };
}

async function seedUser(pool: DbPool): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'h')`,
    [id, `${id}@example.com`],
  );
  return id;
}

/** Seed one Ride experience; returns its internal id (the route path param). */
async function seedRide(pool: DbPool, park = 'Magic Kingdom'): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, grouped_facets)
     VALUES ($1, $2, 'Ride', $3, 'Ride', '{}'::jsonb)`,
    [id, `up-${id}`, park],
  );
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /me/pins + award-on-log (server.inject)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/me/pins' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the full board with progress and whole-collection summary', async () => {
    const user = await seedUser(h.pool);
    const res = await h.app.inject({
      method: 'GET',
      url: '/me/pins',
      headers: { 'x-user-id': user },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pins).toHaveLength(PINS.length);
    expect(body.totalPins).toBe(PINS.length);
    expect(body.totalUnlocked).toBe(0);
    expect(body.overallPercent).toBe(0);
    // A locked count pin carries progress toward its target (0/5 here).
    const centurion5 = body.pins.find((p: { pinId: string }) => p.pinId === 'bronze_centurion_5');
    expect(centurion5.unlocked).toBe(false);
    expect(centurion5.targetValue).toBe(5);
    // Tier summary covers every tier.
    expect(body.tierSummary.map((t: { tier: string }) => t.tier)).toContain('mythic');
  });

  it('awards pins synchronously on a log and returns their ids', async () => {
    const user = await seedUser(h.pool);
    const rideId = await seedRide(h.pool, 'Magic Kingdom');

    const res = await h.app.inject({
      method: 'POST',
      url: `/me/experiences/${rideId}/logs`,
      headers: { 'x-user-id': user },
      payload: { visitedOn: '2020-01-01', userTz: 'America/New_York' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // The log DTO fields ride back alongside the newly-awarded pin ids (R2.1).
    expect(body.experienceId).toBe(rideId);
    expect(body.newlyAwardedPinIds).toContain('bronze_park_starter_magic_kingdom');

    // And the board now reflects that award as unlocked (R3.1).
    const board = await h.app.inject({
      method: 'GET',
      url: '/me/pins',
      headers: { 'x-user-id': user },
    });
    const starter = board
      .json()
      .pins.find((p: { pinId: string }) => p.pinId === 'bronze_park_starter_magic_kingdom');
    expect(starter.unlocked).toBe(true);
    expect(starter.awardedAt).not.toBeNull();
  });

  it('filters the pin list by tier while keeping the summary whole-collection', async () => {
    const user = await seedUser(h.pool);
    const res = await h.app.inject({
      method: 'GET',
      url: '/me/pins?tier=bronze',
      headers: { 'x-user-id': user },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const bronzeCount = PINS.filter((p) => p.tier === 'bronze').length;
    expect(body.pins).toHaveLength(bronzeCount);
    // Summary + totals stay whole-collection despite the filter (R3.2, R3.3).
    expect(body.totalPins).toBe(PINS.length);
    expect(body.tierSummary).toHaveLength(7);
  });

  it('filters by unlocked status', async () => {
    const user = await seedUser(h.pool);
    const rideId = await seedRide(h.pool, 'EPCOT');
    await h.app.inject({
      method: 'POST',
      url: `/me/experiences/${rideId}/logs`,
      headers: { 'x-user-id': user },
      payload: { visitedOn: '2020-01-01', userTz: 'America/New_York' },
    });

    const res = await h.app.inject({
      method: 'GET',
      url: '/me/pins?unlocked=true',
      headers: { 'x-user-id': user },
    });
    const body = res.json();
    expect(body.pins.length).toBeGreaterThan(0);
    expect(body.pins.every((p: { unlocked: boolean }) => p.unlocked)).toBe(true);
    expect(body.pins.some((p: { pinId: string }) => p.pinId === 'bronze_park_starter_epcot')).toBe(true);
  });
});

describe('POST /me/pins/:pinId/claim (server.inject)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/me/pins/bronze_centurion_5/claim' });
    expect(res.statusCode).toBe(401);
  });

  it('returns pin_not_eligible (409) for a pin with no award row', async () => {
    const user = await seedUser(h.pool);
    const res = await h.app.inject({
      method: 'POST',
      url: '/me/pins/bronze_centurion_5/claim',
      headers: { 'x-user-id': user },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'pin_not_eligible' } });
  });

  it('claims an awarded pin and returns its claimedAt; the board then reflects the claim', async () => {
    const user = await seedUser(h.pool);
    const rideId = await seedRide(h.pool, 'Magic Kingdom');
    await h.app.inject({
      method: 'POST',
      url: `/me/experiences/${rideId}/logs`,
      headers: { 'x-user-id': user },
      payload: { visitedOn: '2020-01-01', userTz: 'America/New_York' },
    });
    // Sanity: the pin is awarded but not yet claimed (ready to claim).
    const boardBefore = await h.app.inject({
      method: 'GET',
      url: '/me/pins',
      headers: { 'x-user-id': user },
    });
    const starterBefore = boardBefore
      .json()
      .pins.find((p: { pinId: string }) => p.pinId === 'bronze_park_starter_magic_kingdom');
    expect(starterBefore.unlocked).toBe(true);
    expect(starterBefore.claimedAt).toBeNull();

    const res = await h.app.inject({
      method: 'POST',
      url: '/me/pins/bronze_park_starter_magic_kingdom/claim',
      headers: { 'x-user-id': user },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pinId).toBe('bronze_park_starter_magic_kingdom');
    expect(body.claimedAt).not.toBeNull();

    const boardAfter = await h.app.inject({
      method: 'GET',
      url: '/me/pins',
      headers: { 'x-user-id': user },
    });
    const starterAfter = boardAfter
      .json()
      .pins.find((p: { pinId: string }) => p.pinId === 'bronze_park_starter_magic_kingdom');
    expect(starterAfter.claimedAt).toBe(body.claimedAt);
    // Claiming never changes the whole-collection totals (Requirement 20.5).
    expect(boardAfter.json().totalUnlocked).toBe(boardBefore.json().totalUnlocked);
    expect(boardAfter.json().overallPercent).toBe(boardBefore.json().overallPercent);
  });

  it('claiming an already-claimed pin is a no-op that returns the existing claimedAt (200, not an error)', async () => {
    const user = await seedUser(h.pool);
    const rideId = await seedRide(h.pool, 'EPCOT');
    await h.app.inject({
      method: 'POST',
      url: `/me/experiences/${rideId}/logs`,
      headers: { 'x-user-id': user },
      payload: { visitedOn: '2020-01-01', userTz: 'America/New_York' },
    });

    const first = await h.app.inject({
      method: 'POST',
      url: '/me/pins/bronze_park_starter_epcot/claim',
      headers: { 'x-user-id': user },
    });
    const second = await h.app.inject({
      method: 'POST',
      url: '/me/pins/bronze_park_starter_epcot/claim',
      headers: { 'x-user-id': user },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().claimedAt).toBe(first.json().claimedAt);
  });
});

describe('POST/HEAD /internal/pins/reconcile (server.inject)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(async () => {
    await h.app.close();
  });

  it('rejects a missing or invalid x-cron-secret with 401', async () => {
    const missing = await h.app.inject({ method: 'POST', url: '/internal/pins/reconcile' });
    expect(missing.statusCode).toBe(401);

    const wrong = await h.app.inject({
      method: 'POST',
      url: '/internal/pins/reconcile',
      headers: { 'x-cron-secret': 'not-the-secret' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('accepts a valid secret and returns 202 immediately, awarding historical completions in the background', async () => {
    const user = await seedUser(h.pool);
    const rideId = await seedRide(h.pool, 'Magic Kingdom');
    // Complete an experience WITHOUT ever calling the award-triggering log
    // endpoint — simulating a historical completion the bug left unawarded.
    await h.pool.query(
      `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
       SELECT $1, id, '2020-01-01'::date, 'America/New_York' FROM experiences WHERE id = $2`,
      [user, rideId],
    );

    const res = await h.app.inject({
      method: 'POST',
      url: '/internal/pins/reconcile',
      headers: { 'x-cron-secret': 'test-pin-reconcile-secret' },
    });
    expect(res.statusCode).toBe(202);

    // The reconcile pass is fire-and-forget; poll for it to land instead of a
    // fixed sleep, so this isn't flaky under a loaded/parallel test run.
    const deadline = Date.now() + 2000;
    let starter: { unlocked: boolean; claimedAt: string | null } | undefined;
    while (Date.now() < deadline) {
      const board = await h.app.inject({
        method: 'GET',
        url: '/me/pins',
        headers: { 'x-user-id': user },
      });
      starter = board
        .json()
        .pins.find((p: { pinId: string }) => p.pinId === 'bronze_park_starter_magic_kingdom');
      if (starter?.unlocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(starter?.unlocked).toBe(true);
    expect(starter?.claimedAt).toBeNull(); // ready to claim, not silently claimed
  });

  it('supports HEAD with the same secret gate and 202 response, no body', async () => {
    const ok = await h.app.inject({
      method: 'HEAD',
      url: '/internal/pins/reconcile',
      headers: { 'x-cron-secret': 'test-pin-reconcile-secret' },
    });
    expect(ok.statusCode).toBe(202);

    const denied = await h.app.inject({ method: 'HEAD', url: '/internal/pins/reconcile' });
    expect(denied.statusCode).toBe(401);
  });
});
