/**
 * Route integration tests for Pin Showcase endpoints.
 *
 * Driven through real `buildServer` + `server.inject` against pg-mem.
 *
 * Validates: Requirements 24.1, 24.2, 24.3, 24.4, 24.5, 24.7, 24.8, 24.11;
 *            Properties 18, 19, 20, 21, 22
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { preHandlerHookHandler } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../../../config.js';
import type { DbPool } from '../../../db/pool.js';
import { buildServer } from '../../../server.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { createPinShowcaseRepo } from '../showcaseRepo.js';

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
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

const MIGRATIONS = [
  '0001_init.sql',
  '0011_social_sharing_loop.sql',
  '0035_pins_and_challenges.sql',
  '0036_pin_claiming.sql',
  '0037_pin_showcase.sql',
  '0038_pin_showcase_share_kind.sql',
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

  const repo = createPinShowcaseRepo(pool);
  const requireSession = sessionStub();

  const app = buildServer(testConfig(), {
    pinShowcase: { repo, pool, requireSession },
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

async function establishFriendship(pool: DbPool, u1: string, u2: string): Promise<void> {
  const { lo, hi } = canonicalPair(u1, u2);
  await pool.query(
    `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`,
    [lo, hi],
  );
}

async function awardAndClaimPin(pool: DbPool, userId: string, pinId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_pins (user_id, pin_id, awarded_at, claimed_at)
     VALUES ($1, $2, now(), now())`,
    [userId, pinId],
  );
}

describe('Pin Showcase Routes (server.inject)', () => {
  let harness: Harness;
  let userA: string;
  let userB: string;
  let stranger: string;

  beforeEach(async () => {
    harness = await setup();
    userA = await seedUser(harness.pool);
    userB = await seedUser(harness.pool);
    stranger = await seedUser(harness.pool);
    await establishFriendship(harness.pool, userA, userB);
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('requires authentication for /me/pin-showcase', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/me/pin-showcase',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /me/pin-showcase returns placements and unplaced claimed pins', async () => {
    await awardAndClaimPin(harness.pool, userA, 'pin_placed');
    await awardAndClaimPin(harness.pool, userA, 'pin_unplaced');

    // Place pin_placed
    await harness.app.inject({
      method: 'PUT',
      url: '/me/pin-showcase/pin_placed',
      headers: { 'x-user-id': userA },
      payload: { posX: 0.2, posY: 0.2 },
    });

    const res = await harness.app.inject({
      method: 'GET',
      url: '/me/pin-showcase',
      headers: { 'x-user-id': userA },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ownerId).toBe(userA);
    expect(body.placements).toHaveLength(1);
    expect(body.placements[0]?.pinId).toBe('pin_placed');
    expect(body.unplaced).toEqual(['pin_unplaced']);
  });

  it('GET /users/:userId/pin-showcase enforces assertOwnerOrFriend gate (Property 21)', async () => {
    await awardAndClaimPin(harness.pool, userA, 'pin_placed');
    await harness.app.inject({
      method: 'PUT',
      url: '/me/pin-showcase/pin_placed',
      headers: { 'x-user-id': userA },
      payload: { posX: 0.2, posY: 0.2 },
    });

    // 1. Self view: returns showcase with unplaced
    const selfRes = await harness.app.inject({
      method: 'GET',
      url: `/users/${userA}/pin-showcase`,
      headers: { 'x-user-id': userA },
    });
    expect(selfRes.statusCode).toBe(200);
    expect(selfRes.json().ownerId).toBe(userA);
    expect(selfRes.json().placements).toHaveLength(1);
    expect(selfRes.json().unplaced).toBeDefined();

    // 2. Friend view: returns showcase with unplaced omitted
    const friendRes = await harness.app.inject({
      method: 'GET',
      url: `/users/${userA}/pin-showcase`,
      headers: { 'x-user-id': userB },
    });
    expect(friendRes.statusCode).toBe(200);
    expect(friendRes.json().ownerId).toBe(userA);
    expect(friendRes.json().placements).toHaveLength(1);
    expect(friendRes.json().unplaced).toBeUndefined();

    // 3. Non-friend view: returns 403 profile_forbidden
    const strangerRes = await harness.app.inject({
      method: 'GET',
      url: `/users/${userA}/pin-showcase`,
      headers: { 'x-user-id': stranger },
    });
    expect(strangerRes.statusCode).toBe(403);
    expect(strangerRes.json().error.code).toBe('profile_forbidden');
  });

  it('PUT /me/pin-showcase/:pinId happy path, validation, and domain errors', async () => {
    await awardAndClaimPin(harness.pool, userA, 'pin_valid');
    await awardAndClaimPin(harness.pool, userA, 'pin_valid_2');

    // 1. Validation error: out of bounds
    const valRes = await harness.app.inject({
      method: 'PUT',
      url: '/me/pin-showcase/pin_valid',
      headers: { 'x-user-id': userA },
      payload: { posX: 1.5, posY: 0.5 },
    });
    expect(valRes.statusCode).toBe(400);
    expect(valRes.json().error.code).toBe('validation_failed');

    // 2. Unclaimed pin error: 409 pin_not_eligible
    const unclaimedRes = await harness.app.inject({
      method: 'PUT',
      url: '/me/pin-showcase/unclaimed_pin',
      headers: { 'x-user-id': userA },
      payload: { posX: 0.5, posY: 0.5 },
    });
    expect(unclaimedRes.statusCode).toBe(409);
    expect(unclaimedRes.json().error.code).toBe('pin_not_eligible');

    // 3. Happy path placement
    const happyRes = await harness.app.inject({
      method: 'PUT',
      url: '/me/pin-showcase/pin_valid',
      headers: { 'x-user-id': userA },
      payload: { posX: 0.3, posY: 0.3 },
    });
    expect(happyRes.statusCode).toBe(200);
    expect(happyRes.json().pinId).toBe('pin_valid');

    // 4. Overlap error: 409 showcase_position_overlap
    const overlapRes = await harness.app.inject({
      method: 'PUT',
      url: '/me/pin-showcase/pin_valid_2',
      headers: { 'x-user-id': userA },
      // Same point -> overlap
      payload: { posX: 0.3, posY: 0.3 },
    });
    expect(overlapRes.statusCode).toBe(409);
    expect(overlapRes.json().error.code).toBe('showcase_position_overlap');
  });

  it('DELETE /me/pin-showcase/:pinId removes placement and is idempotent', async () => {
    await awardAndClaimPin(harness.pool, userA, 'pin_to_delete');
    await harness.app.inject({
      method: 'PUT',
      url: '/me/pin-showcase/pin_to_delete',
      headers: { 'x-user-id': userA },
      payload: { posX: 0.4, posY: 0.4 },
    });

    // Delete once
    const del1 = await harness.app.inject({
      method: 'DELETE',
      url: '/me/pin-showcase/pin_to_delete',
      headers: { 'x-user-id': userA },
    });
    expect(del1.statusCode).toBe(200);
    expect(del1.json()).toEqual({ ok: true });

    // Delete again (idempotent no-op)
    const del2 = await harness.app.inject({
      method: 'DELETE',
      url: '/me/pin-showcase/pin_to_delete',
      headers: { 'x-user-id': userA },
    });
    expect(del2.statusCode).toBe(200);
    expect(del2.json()).toEqual({ ok: true });
  });

  it('Property 23: recipient reads current showcase arrangement, not a send-time snapshot (R24.13, R24.14)', async () => {
    await awardAndClaimPin(harness.pool, userA, 'pin_showcase_prop23');

    // 2. Owner places pin at (0.2, 0.2)
    const place1 = await harness.app.inject({
      method: 'PUT',
      url: '/me/pin-showcase/pin_showcase_prop23',
      headers: { 'x-user-id': userA },
      payload: { posX: 0.2, posY: 0.2 },
    });
    expect(place1.statusCode).toBe(200);

    // 3. Seed a pinShowcase share sent from userA to userB
    const shareId = randomUUID();
    await harness.pool.query(
      `INSERT INTO shares (id, sender_id, payload_kind, payload_snapshot)
       VALUES ($1, $2, 'pinShowcase', $3)`,
      [
        shareId,
        userA,
        JSON.stringify({
          kind: 'pinShowcase',
          ownerId: userA,
          ownerDisplayName: 'Owner User',
        }),
      ],
    );
    await harness.pool.query(
      `INSERT INTO share_recipients (share_id, recipient_id)
       VALUES ($1, $2)`,
      [shareId, userB],
    );

    // 4. Owner mutates arrangement by moving pin to (0.8, 0.8)
    const moveRes = await harness.app.inject({
      method: 'PUT',
      url: '/me/pin-showcase/pin_showcase_prop23',
      headers: { 'x-user-id': userA },
      payload: { posX: 0.8, posY: 0.8 },
    });
    expect(moveRes.statusCode).toBe(200);

    // 5. Recipient reads showcase via GET /users/:userId/pin-showcase
    const friendRead = await harness.app.inject({
      method: 'GET',
      url: `/users/${userA}/pin-showcase`,
      headers: { 'x-user-id': userB },
    });
    expect(friendRead.statusCode).toBe(200);
    const body = friendRead.json();
    expect(body.ownerId).toBe(userA);
    expect(body.placements).toHaveLength(1);
    // Asserts recipient sees the mutated state (0.8, 0.8), not the send-time state (0.2, 0.2)
    expect(body.placements[0].posX).toBe(0.8);
    expect(body.placements[0].posY).toBe(0.8);
  });
});
