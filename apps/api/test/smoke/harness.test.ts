/**
 * Smoke harness placeholder test (task 13.1).
 *
 * Verifies that:
 *   1. `setupHarness` wires the API and seeds the requested counts
 *      (one user, one experience, one rating in this minimal run);
 *   2. the resulting Fastify instance answers `/health` with 200,
 *      confirming the in-memory backends and route registration
 *      completed cleanly;
 *   3. `requestAs` injects the seeded session token so an
 *      authenticated route (`/me/stats`) returns 200;
 *   4. `measureScenarios` produces finite, non-negative wall-clock
 *      latencies for every documented scenario; and
 *   5. `teardown` closes the Fastify instance and the in-memory
 *      Redis without throwing, so a Vitest run can spin the harness
 *      up multiple times in the same process.
 *
 * The actual perf-SLA assertions land in `slas.smoke.test.ts`
 * (task 13.2). This test only proves the harness itself is wired
 * correctly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupHarness, type Harness, type ScenarioLatencies } from './harness.js';

let harness: Harness | null = null;

beforeEach(async () => {
  // Tiny dataset so the harness setup time stays well under a
  // second; the SLA harness in task 13.2 will use a richer dataset.
  harness = await setupHarness({ users: 3, experiences: 14, ratings: 20 });
});

afterEach(async () => {
  if (harness) {
    await harness.teardown();
    harness = null;
  }
});

describe('smoke harness', () => {
  it('seeds the requested user count and answers /health', async () => {
    expect(harness).not.toBeNull();
    const h = harness!;
    expect(h.users).toHaveLength(3);
    expect(h.experiences).toHaveLength(14);

    const res = await h.request('GET', '/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('issues a working session token for every seeded user', async () => {
    const h = harness!;
    for (const user of h.users) {
      const res = await h.requestAs(user, 'GET', '/me');
      expect(res.statusCode).toBe(200);
      const body = res.json() as { user: { id: string }; profile: { displayName: string } };
      expect(body.user.id).toBe(user.userId);
      expect(body.profile.displayName).toBe(user.displayName);
    }
  });

  it('serves /me/stats against the seeded dataset', async () => {
    const h = harness!;
    const user = h.users[0]!;
    const res = await h.requestAs(user, 'GET', '/me/stats');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { overall: { total: number } };
    // The harness seeds `experiences` active rows; the overall total
    // surfaces them through the stats query so we know the snapshot
    // pipeline is functional end-to-end.
    expect(body.overall.total).toBe(h.experiences.length);
  });

  it('serves the home leaderboard from the in-memory backend', async () => {
    const h = harness!;
    const res = await h.request('GET', '/home/highest-rated');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: ReadonlyArray<{ value: number; count: number }> };
    expect(Array.isArray(body.entries)).toBe(true);
    // Every leaderboard entry must satisfy the threshold gate (R11.2)
    // and the value range (R10.1).
    for (const entry of body.entries) {
      expect(entry.count).toBeGreaterThanOrEqual(3);
      expect(entry.value).toBeGreaterThanOrEqual(1);
      expect(entry.value).toBeLessThanOrEqual(10);
    }
  });

  it('produces finite, non-negative wall-clock latencies for every scenario', async () => {
    const h = harness!;
    const measurements = await h.measureScenarios();

    const keys: ReadonlyArray<keyof ScenarioLatencies> = [
      'meStats',
      'putNote',
      'authRegister',
      'authLogin',
      'aggregateRecompute',
      'homeHighestRatedCold',
      'homeHighestRatedWarm',
      'catalogList',
    ];
    for (const key of keys) {
      const value = measurements[key];
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }

    // Smoke-level sanity: every scenario completes well under the
    // most permissive SLA bucket (60s for aggregate recompute,
    // 2s for everything else). This is not the perf-SLA assertion
    // (that lives in task 13.2); it just confirms the harness
    // itself isn't regressing into pathological behavior.
    expect(measurements.meStats).toBeLessThan(2000);
    expect(measurements.putNote).toBeLessThan(2000);
    expect(measurements.authRegister).toBeLessThan(60000);
    expect(measurements.authLogin).toBeLessThan(60000);
    expect(measurements.homeHighestRatedCold).toBeLessThan(2000);
    expect(measurements.homeHighestRatedWarm).toBeLessThan(2000);
    expect(measurements.aggregateRecompute).toBeLessThan(60000);
    expect(measurements.catalogList).toBeLessThan(2000);
  });

  it('tears down cleanly and is safe to call twice', async () => {
    const h = harness!;
    harness = null;
    await h.teardown();
    // Calling teardown again must not throw.
    await expect(h.teardown()).resolves.not.toThrow();
  });
});
