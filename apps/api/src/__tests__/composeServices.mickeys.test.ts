/**
 * Integration test for Hidden Mickeys service wiring through composeServices.ts (Item 1d).
 *
 * Exercises the real composition root without injecting fakes for the Mickey repo or services.
 * Asserts:
 *  - GET /mickeys/config returns 200
 *  - GET /mickeys without a session returns 401
 *  - GET /mickeys with a valid session returns 200 and an items array
 *  - GET /admin/mickeys with basic auth returns 200
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import RedisMock from 'ioredis-mock';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { buildApp, type BuiltApp } from '../composeServices.js';
import { generateToken } from '../services/auth/sessionToken.js';
import type { DbPool } from '../db/pool.js';

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb({ noAstCoverageCheck: true });
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
  pub.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'jsonb_typeof',
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (val: unknown): string => {
      if (val === null || val === undefined) return 'null';
      let parsed = val;
      if (typeof val === 'string') {
        try {
          parsed = JSON.parse(val);
        } catch {
          return 'string';
        }
      }
      if (parsed === null) return 'null';
      if (Array.isArray(parsed)) return 'array';
      if (typeof parsed === 'object') return 'object';
      return 'null';
    },
  });

  return db;
}

function applyMigrations(db: IMemoryDb): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.*\.sql$/u.test(n))
    .sort((a, b) => a.localeCompare(b));

  for (const name of files) {
    if (/^00(70|71)_backfill/u.test(name)) continue;
    let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
    sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
    sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
    sql = sql.replace(
      /CREATE INDEX IF NOT EXISTS mickey_progress_mickey_idx ON mickey_progress\(mickey_id\) WHERE found_at IS NOT NULL;/g,
      'CREATE INDEX IF NOT EXISTS mickey_progress_mickey_idx ON mickey_progress(mickey_id);',
    );
    db.public.none(sql);
  }
}

function validTestEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/appdb',
    REDIS_URL: 'redis://localhost:6379',
    SESSION_SECRET: 'a'.repeat(32),
    DISNEY_SYNC_GATEWAY_USERNAME: 'disney-user',
    DISNEY_SYNC_GATEWAY_PASSWORD: 'disney-pass',
    SAMPLING_CRON_SECRET: 'test-sampling-cron-secret',
    PIN_RECONCILE_CRON_SECRET: 'test-pin-reconcile-secret',
    TRIP_BOOKING_CRON_SECRET: 'test-trip-booking-cron-secret',
    ACCOUNT_DELETION_CRON_SECRET: 'test-account-deletion-cron-secret',
    SUPPORT_EMAIL: 'support@example.com',
    ADMIN_PANEL_USERNAME: 'admin-user',
    ADMIN_PANEL_PASSWORD: 'admin-password',
    PHOTO_HARM_API_KEY: 'test-harm-api-key',
    MICKEYS_ENABLED: 'true',
    MICKEYS_SUBMISSIONS_ENABLED: 'true',
    MICKEYS_TEXT_SCREEN_ENABLED: 'true',
  };
}

describe('composeServices wiring for Hidden Mickeys', () => {
  let builtApp: BuiltApp;
  let pool: DbPool;
  let authToken: string;

  beforeAll(async () => {
    const db = buildPgMemDatabase();
    applyMigrations(db);
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;
    const redis = new RedisMock() as never;

    const config = loadConfig(validTestEnv());
    builtApp = await buildApp(config, { pool, redis });
    await builtApp.app.ready();

    // Seed user and session for authenticated request
    const userId = randomUUID();
    const tokenPair = generateToken();
    authToken = tokenPair.token;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'test@example.com', 'hash')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $4, $5)`,
      [randomUUID(), userId, tokenPair.tokenHash, now, expiresAt],
    );
  });

  afterAll(async () => {
    await builtApp.dispose();
  });

  it('GET /mickeys/config returns 200', async () => {
    const res = await builtApp.app.inject({
      method: 'GET',
      url: '/mickeys/config',
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.enabled).toBe(true);
    expect(json.submissionsEnabled).toBe(true);
  });

  it('GET /mickeys without a session returns 401', async () => {
    const res = await builtApp.app.inject({
      method: 'GET',
      url: '/mickeys',
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /mickeys with a session returns 200 and an items array', async () => {
    const res = await builtApp.app.inject({
      method: 'GET',
      url: '/mickeys',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(Array.isArray(json.items)).toBe(true);
  });

  it('GET /admin/mickeys with basic auth returns 200', async () => {
    const credentials = Buffer.from('admin-user:admin-password').toString('base64');
    const res = await builtApp.app.inject({
      method: 'GET',
      url: '/admin/mickeys',
      headers: {
        authorization: `Basic ${credentials}`,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});
