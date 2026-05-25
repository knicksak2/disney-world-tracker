/**
 * Smoke perf SLA tests (task 13.2).
 *
 * Each test in this file asserts a wall-clock budget for a single
 * representative request against the smoke harness from task 13.1
 * (`./harness.ts`). The 2-second budget is generous because the harness
 * uses in-memory backends; the goal is to catch gross algorithmic
 * regressions (e.g. an accidentally O(n²) loop on 1000 ratings, a
 * forgotten cache, an unbounded scan) rather than to validate
 * production latency.
 *
 * Coverage:
 *
 *   - POST /auth/register                          ≤ 2s (R6.1)
 *   - POST /auth/login                             ≤ 2s (R6.5)
 *   - GET  /me/stats                               ≤ 2s (R3.4, R3.5)
 *   - PUT  /me/experiences/:id/note                ≤ 2s (R5.8, R5.9)
 *   - GET  /experiences/:id/aggregate-rating       ≤ 2s (R10.7)
 *   - GET  /home/highest-rated (warm cache)        ≤ 2s (R11)
 *
 * The harness exposes `measureScenarios()` which runs each scenario once
 * and returns the wall-clock latency in ms; this file calls it once and
 * asserts each value against the relevant SLA budget.
 *
 * Validates: Requirements R3.4, R3.5, R5.8, R5.9, R6.1, R6.5, R10.7, R11
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupHarness, type Harness, type ScenarioLatencies } from './harness.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Wall-clock budget shared by every SLA test in this file. The
 * requirements quote 2 seconds for each scenario; we treat 2000 ms as
 * an inclusive upper bound.
 */
const SLA_BUDGET_MS = 2000;

/**
 * 60-second budget for the aggregate-rating recompute (R10.7).
 */
const AGGREGATE_RECOMPUTE_BUDGET_MS = 60000;

// ---------------------------------------------------------------------------
// Shared harness — built once for the suite
// ---------------------------------------------------------------------------

let harness: Harness;
let measurements: ScenarioLatencies;

beforeAll(async () => {
  harness = await setupHarness({
    users: 100,
    experiences: 200,
    ratings: 1000,
  });
  // Warm the leaderboard cache once before measuring the warm-cache
  // scenario; `measureScenarios` itself drops the cache for the cold
  // measurement and then reads it back.
  await harness.request('GET', '/home/highest-rated');
  measurements = await harness.measureScenarios();
});

afterAll(async () => {
  if (harness) {
    await harness.teardown();
  }
});

describe('POST /auth/register SLA (R6.1)', () => {
  it(`completes within ${SLA_BUDGET_MS}ms on a representative dataset`, () => {
    expect(measurements.authRegister).toBeLessThanOrEqual(SLA_BUDGET_MS);
  });
});

describe('POST /auth/login SLA (R6.5)', () => {
  it(`completes within ${SLA_BUDGET_MS}ms on a representative dataset`, () => {
    expect(measurements.authLogin).toBeLessThanOrEqual(SLA_BUDGET_MS);
  });
});

describe('GET /me/stats SLA (R3.4, R3.5)', () => {
  it(`completes within ${SLA_BUDGET_MS}ms on a representative dataset`, () => {
    expect(measurements.meStats).toBeLessThanOrEqual(SLA_BUDGET_MS);
  });
});

describe('PUT /me/experiences/:id/note SLA (R5.8, R5.9)', () => {
  it(`completes within ${SLA_BUDGET_MS}ms on a representative dataset`, () => {
    expect(measurements.putNote).toBeLessThanOrEqual(SLA_BUDGET_MS);
  });
});

describe('Aggregate-rating recompute SLA (R10.7)', () => {
  it(`completes within ${AGGREGATE_RECOMPUTE_BUDGET_MS}ms end-to-end`, () => {
    expect(measurements.aggregateRecompute).toBeLessThanOrEqual(
      AGGREGATE_RECOMPUTE_BUDGET_MS,
    );
  });
});

describe('GET /home/highest-rated SLA on warm cache (R11)', () => {
  it(`completes within ${SLA_BUDGET_MS}ms on the warm-cache path`, () => {
    expect(measurements.homeHighestRatedWarm).toBeLessThanOrEqual(
      SLA_BUDGET_MS,
    );
  });
});
