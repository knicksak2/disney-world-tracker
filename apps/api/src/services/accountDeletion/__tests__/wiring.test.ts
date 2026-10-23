/**
 * Production wiring for account deletion (task 9.4), in the style of `photos/__tests__/photos.wiring.test.ts`:
 *
 *  - `buildServer({ services: { accountDeletion } })` answers the purge cron route `401` without the secret and
 *    `202` with it, and the two `/me` routes `401` without a session;
 *  - a source scan of `composeServices.ts` and `server.ts` is evidence of the wiring (it is NOT a run of the
 *    composed app): the shared `accountDeletionLogger`, the restore port handed to `authRoutes`, the route
 *    registration, no test seam and no custom scheduler in production;
 *  - nothing but the route plugin mentions the cron path, so the keep-alive job cannot be pointed at it by code;
 *  - `docs/hosting.md` carries the Purge_Cron section the operator follows.
 *
 * Feature: account-deletion, Property 25: The cron endpoint contract
 *
 * Validates: Requirements 8.1, 8.7, 8.8, 15.2, 17.3
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../config.js';
import { AppError } from '../../../errors/AppError.js';
import { buildServer } from '../../../server.js';
import type { AccountDeletionService } from '../ports.js';
import type { PurgeRunner } from '../purgeRunner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, '..', '..', '..');
const REPO_ROOT = resolve(API_SRC, '..', '..', '..');
const CRON_SECRET = 'wiring-test-account-deletion-cron-secret';

function config() {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/appdb',
    REDIS_URL: 'redis://localhost:6379',
    SESSION_SECRET: 'a'.repeat(32),
    DISNEY_SYNC_GATEWAY_USERNAME: 'disney-user',
    DISNEY_SYNC_GATEWAY_PASSWORD: 'disney-pass',
    SAMPLING_CRON_SECRET: 'wiring-test-sampling-secret',
    PIN_RECONCILE_CRON_SECRET: 'wiring-test-pin-secret',
    TRIP_BOOKING_CRON_SECRET: 'wiring-test-trip-secret',
    ACCOUNT_DELETION_CRON_SECRET: CRON_SECRET,
    SUPPORT_EMAIL: 'support@example.com',
    ADMIN_PANEL_USERNAME: 'admin-user',
    ADMIN_PANEL_PASSWORD: 'admin-password',
  });
}

function runnerFake(): PurgeRunner & { starts: number } {
  const r = {
    starts: 0,
    tryStart() {
      r.starts += 1;
      return r.starts === 1 ? ({ started: true } as const) : ({ started: false, reason: 'in_flight' } as const);
    },
    async runOnce() {
      throw new Error('not used');
    },
  };
  return r as never;
}

describe('buildServer with services.accountDeletion', () => {
  async function server() {
    const runner = runnerFake();
    const s = buildServer(config(), {
      accountDeletion: {
        service: {} as AccountDeletionService,
        purgeRunner: runner,
        requireSession: async () => {
          throw new AppError('unauthorized', 'Authentication required.');
        },
      },
    });
    await s.ready();
    return { s, runner };
  }

  it('answers the purge route 401 without the secret and 202 with it', async () => {
    const { s, runner } = await server();
    const none = await s.inject({ method: 'POST', url: '/internal/account-deletion/purge/run' });
    expect(none.statusCode).toBe(401);
    const wrong = await s.inject({ method: 'POST', url: '/internal/account-deletion/purge/run', headers: { 'x-cron-secret': 'nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(runner.starts).toBe(0);

    const ok = await s.inject({ method: 'POST', url: '/internal/account-deletion/purge/run', headers: { 'x-cron-secret': CRON_SECRET } });
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toEqual({ status: 'accepted' });
    const overlap = await s.inject({ method: 'POST', url: '/internal/account-deletion/purge/run', headers: { 'x-cron-secret': CRON_SECRET } });
    expect(overlap.json()).toEqual({ status: 'skipped', reason: 'in_flight' });
    const head = await s.inject({ method: 'HEAD', url: '/internal/account-deletion/purge/run', headers: { 'x-cron-secret': CRON_SECRET } });
    expect(head.statusCode).toBe(202);
    expect(head.payload).toBe('');
    await s.close();
  });

  it('the secret comes from config.accountDeletion.cronSecret, not from another cron’s secret', async () => {
    const { s } = await server();
    for (const other of ['wiring-test-sampling-secret', 'wiring-test-pin-secret', 'wiring-test-trip-secret']) {
      const res = await s.inject({ method: 'POST', url: '/internal/account-deletion/purge/run', headers: { 'x-cron-secret': other } });
      expect(res.statusCode).toBe(401);
    }
    await s.close();
  });

  it('answers the two /me routes 401 without a session', async () => {
    const { s } = await server();
    for (const url of ['/me/account/deletion/reauth', '/me/account/deletion']) {
      const res = await s.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode, url).toBe(401);
    }
    await s.close();
  });

  it('registers nothing when the service is not provided', async () => {
    const s = buildServer(config(), {});
    await s.ready();
    const res = await s.inject({ method: 'POST', url: '/internal/account-deletion/purge/run', headers: { 'x-cron-secret': CRON_SECRET } });
    expect(res.statusCode).toBe(404);
    await s.close();
  });
});

// ---------------------------------------------------------------------------------------------
// Source scans
// ---------------------------------------------------------------------------------------------

/** The text of the call that starts at `opener` (e.g. `createPurgeRunner(`), up to its matching `)`. */
function callText(source: string, opener: string, from = 0): string {
  const start = source.indexOf(opener, from);
  if (start === -1) throw new Error(`${opener} not found`);
  let depth = 0;
  for (let i = start + opener.length - 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${opener} is not closed`);
}

describe('source scan: composeServices.ts and server.ts', () => {
  const compose = readFileSync(join(API_SRC, 'composeServices.ts'), 'utf8');
  const server = readFileSync(join(API_SRC, 'server.ts'), 'utf8');

  it('builds the mail service, the service and the runner on ONE shared logger', () => {
    expect(compose).toMatch(/const accountDeletionLogger = createLogger\(\);/);
    expect(callText(compose, 'createMailService(')).toMatch(/logger:\s*accountDeletionLogger/);
    expect(callText(compose, 'createAccountDeletionService(')).toMatch(/logger:\s*accountDeletionLogger/);
    expect(callText(compose, 'createPurgeRunner(')).toMatch(/logger:\s*accountDeletionLogger/);
    // Exactly one createMailService with that logger and one dedicated deletion logger.
    expect(compose.match(/accountDeletionLogger = /g)).toHaveLength(1);
  });

  it('hands the service to authRoutes as the restore port', () => {
    expect(callText(compose, 'authRoutes(')).toMatch(/accountRestore:\s*accountDeletionService/);
  });

  it('hands the service and the runner to the server, behind the session middleware', () => {
    const idx = compose.indexOf('accountDeletion: {');
    expect(idx).toBeGreaterThan(-1);
    const block = compose.slice(idx, idx + 220);
    expect(block).toMatch(/service:\s*accountDeletionService/);
    expect(block).toMatch(/purgeRunner/);
    expect(block).toMatch(/requireSession:\s*sessionMiddleware/);
  });

  it('wires the purge photo ports, the aggregate and the lockout, with no test seam and no custom scheduler', () => {
    const runner = callText(compose, 'createPurgeRunner(');
    expect(runner).toMatch(/aggregate:\s*aggregateRepo/);
    expect(runner).toMatch(/lockout,/);
    expect(runner).toMatch(/softDeleteByTarget\('trip'/);
    expect(runner).not.toMatch(/scheduler/);
    expect(compose).not.toMatch(/afterTripLocked/);
    // Photos disabled still marks existing rows deleted, with the limit forwarded.
    expect(compose).toMatch(/softDeleteByOwner\(userId, new Date\(\), undefined, o\?\.limit\)/);
  });

  it('both session adapters join users and read deletion_state', () => {
    const harness = readFileSync(join(API_SRC, '..', 'test', 'smoke', 'harness.ts'), 'utf8');
    for (const [name, src] of [['composeServices.ts', compose], ['harness.ts', harness]] as const) {
      expect(src, name).toMatch(/JOIN users u ON u\.id = s\.user_id/);
      expect(src, name).toMatch(/u\.deletion_state/);
    }
  });

  it('server.ts declares the option and registers the plugin', () => {
    expect(server).toContain('readonly accountDeletion?: AccountDeletionRoutesOptions');
    expect(server).toContain('app.register(accountDeletionRoutes(services.accountDeletion))');
  });

  it('no job-queue worker is introduced for the purge', () => {
    expect(compose).not.toMatch(/purge[\w]*\s*=\s*new (Worker|Queue)\(/i);
  });
});

describe('the cron path appears only in the route plugin (the keep-alive cannot call it)', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === '__tests__') continue;
        walk(full, out);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
    }
    return out;
  }

  it('only the route plugin (and the config’s own description of the secret) names the purge path in non-test source', () => {
    const hits = walk(API_SRC)
      .filter((f) => readFileSync(f, 'utf8').includes('/internal/account-deletion/purge/run'))
      .map((f) => relative(API_SRC, f).split(sep).join('/'));
    // `config.ts` only documents which endpoint the secret gates; it never calls it.
    expect(hits).toEqual(['config.ts', 'services/accountDeletion/routes.ts']);
  });
});

describe('docs/hosting.md', () => {
  const doc = readFileSync(join(REPO_ROOT, 'docs', 'hosting.md'), 'utf8');
  const start = doc.indexOf('### Dedicated Account Deletion Cron (Purge_Cron)');

  it('has the Purge_Cron section after the Photo_Cron section', () => {
    expect(start).toBeGreaterThan(-1);
    expect(doc.indexOf('### Dedicated Photo Sweep Cron (Photo_Cron)')).toBeLessThan(start);
  });

  it('names the endpoint, secret, timezone, crontab, single-flight, keep-alive rule, operator step and smoke list', () => {
    const section = doc.slice(start, doc.indexOf('\n---', start));
    for (const needle of [
      '/internal/account-deletion/purge/run',
      'ACCOUNT_DELETION_CRON_SECRET',
      'America/New_York',
      '35 8,20 * * *',
      'in_flight',
      'must **never** call the purge endpoint',
      'Neon',
      'Render',
      'before the first deploy',
      'Real-Postgres smoke list',
      'FOR UPDATE SKIP LOCKED',
      'CREATE VIEW',
    ]) {
      expect(section, needle).toContain(needle);
    }
  });
});
