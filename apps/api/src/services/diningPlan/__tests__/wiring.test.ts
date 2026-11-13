/**
 * Production wiring of the Dining Plan calculator (task 8), in the style of `tripBudget/__tests__/budget.wiring.test.ts`:
 *
 *  - `buildServer` with only `diningPlan` registers every route (each answers 401 without a session, not 404);
 *  - a source scan of `composeServices.ts` and `server.ts` is evidence of the production wiring (it is not a run of
 *    the composed app): the service is built by `createDiningPlanServiceFromRepos` from the same `tripRepo`,
 *    `tripExpenseRepo` and `tripBudgetRepo` instances the other Trip routes use, and the plugin is registered.
 *
 * Validates: dining-plan-calculator Requirements 16.1, 26.1.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../config.js';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { buildServer } from '../../../server.js';
import type { DiningPlanService } from '../service.js';

const API_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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
    ACCOUNT_DELETION_CRON_SECRET: 'wiring-test-account-deletion-cron-secret',
    SUPPORT_EMAIL: 'support@example.com',
    ADMIN_PANEL_USERNAME: 'admin-user',
    ADMIN_PANEL_PASSWORD: 'admin-password',
    PHOTO_HARM_API_KEY: 'wiring-test-photo-harm-key',
  });
}

describe('Dining Plan wiring and registration', () => {
  it('registers every route behind the session check', async () => {
    const server = buildServer(config(), {
      diningPlan: {
        pool: {} as DbPool,
        service: {} as DiningPlanService,
        requireSession: async () => {
          throw new AppError('unauthorized', 'Session required');
        },
      },
    });
    await server.ready();
    const trip = randomUUID();
    const routes = [
      { method: 'GET', url: `/trips/${trip}/dining-plan` },
      { method: 'PUT', url: `/trips/${trip}/dining-plan/settings` },
      { method: 'PUT', url: `/trips/${trip}/dining-plan/entries/2027-03-02/dinner` },
      { method: 'DELETE', url: `/trips/${trip}/dining-plan/entries/2027-03-02/dinner` },
      { method: 'POST', url: `/trips/${trip}/dining-plan/import-reservations` },
      { method: 'POST', url: `/trips/${trip}/dining-plan/export-to-budget` },
      { method: 'POST', url: '/dining-plan/calculate' },
    ] as const;
    for (const route of routes) {
      const res = await server.inject(route);
      expect(res.statusCode, `${route.method} ${route.url} should be registered`).toBe(401);
    }
    await server.close();
  });

  it('composeServices.ts builds the service from the shared Trip, Expense and Budget repos, and server.ts registers it', () => {
    const compose = readFileSync(join(API_SRC, 'composeServices.ts'), 'utf8');
    const server = readFileSync(join(API_SRC, 'server.ts'), 'utf8');
    const block = /diningPlan: \{[\s\S]*?createDiningPlanServiceFromRepos\(\{([\s\S]*?)\}\),\s*\},/.exec(compose);
    expect(block, 'composeServices.ts must pass a diningPlan block built by createDiningPlanServiceFromRepos').not.toBeNull();
    expect(block![1]).toMatch(/members: tripRepo,/);
    expect(block![1]).toMatch(/guests: tripExpenseRepo,/);
    // The Budget export writes through the same Budget repo instance the Budget routes use.
    expect(block![1]).toMatch(/budget: tripBudgetRepo,/);
    expect(compose).toMatch(/tripBudget: \{\s*pool,\s*repo: tripBudgetRepo,/);
    // Task 9: the Admin_Panel section gets its port in the `admin:` block.
    const admin = /\n {4}admin: \{([\s\S]*?)\n {4}\},/.exec(compose);
    expect(admin, 'composeServices.ts must pass an admin block').not.toBeNull();
    expect(admin![1]).toMatch(/diningPlan: createDiningPlanAdminRepo\(\{ pool, logger: createLogger\(\) \}\),/);
    expect(server).toMatch(/readonly diningPlan\?: DiningPlanRoutesOptions;/);
    expect(server).toMatch(/if \(services\.diningPlan !== undefined\) \{\s*void app\.register\(diningPlanRoutes\(services\.diningPlan\)\);/);
  });
});
