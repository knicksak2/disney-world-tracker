/**
 * Unit tests for the Aggregate_Ratings_Service routes plugin (task 8.4).
 *
 * The plugin is registered against an in-process Fastify instance with a
 * fake `AggregateRepo` port. No database, Redis, or upstream HTTP traffic
 * is involved; each test is hermetic and deterministic.
 *
 * Coverage focuses on the requirements scoped to this task:
 *
 *   - R10.3, R10.5  At or above the 3-rating threshold, the response
 *                   reports the published mean to one decimal place
 *                   together with the count.
 *   - R10.4, R10.6  Below the 3-rating threshold, `value` is `null`
 *                   and the count is still present.
 *   - R10.10        The response shape is exactly two fields, `value`
 *                   and `count`. No path, including the absent-row case,
 *                   exposes any other field (privacy boundary).
 *   - Absent row    A `null` from the repo (no `aggregate_ratings` row
 *                   for the Experience yet) projects to
 *                   `{ value: null, count: 0 }`.
 *   - Validation    A non-UUID `:id` path param surfaces as 400
 *                   `validation_failed` with `field: "id"`.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { AggregateRatingDTO } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  aggregateRoutes,
  projectAggregate,
  type AggregateRepo,
  type AggregateRoutesOptions,
  type AggregateRowState,
} from '../routes.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface RepoCalls {
  getAggregate: string[];
}

interface RepoStubs {
  getAggregate?: (
    experienceId: string,
  ) => Promise<AggregateRowState | null>;
}

/**
 * Build an in-memory `AggregateRepo` implementation. Every call is
 * recorded so tests can assert that `getAggregate` was invoked (and
 * with which Experience id) without having to interpose a separate
 * spy harness.
 */
function makeRepo(stubs: RepoStubs = {}): {
  repo: AggregateRepo;
  calls: RepoCalls;
} {
  const calls: RepoCalls = { getAggregate: [] };
  return {
    calls,
    repo: {
      async getAggregate(experienceId) {
        calls.getAggregate.push(experienceId);
        if (stubs.getAggregate) {
          return stubs.getAggregate(experienceId);
        }
        return null;
      },
    },
  };
}

async function buildApp(
  overrides: Partial<AggregateRoutesOptions> & { repo?: AggregateRepo } = {},
): Promise<{ app: FastifyInstance; calls: RepoCalls }> {
  const fallback = makeRepo();
  const repo = overrides.repo ?? fallback.repo;
  // When the caller injects their own repo we cannot observe its calls;
  // hand back an empty record so assertions on `calls` remain harmless.
  const calls = overrides.repo ? { getAggregate: [] } : fallback.calls;

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(aggregateRoutes({ repo }));
  await app.ready();
  return { app, calls };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// projectAggregate (pure projection)
// ---------------------------------------------------------------------------

describe('projectAggregate', () => {
  it('returns { value: null, count: 0 } when no row exists', () => {
    expect(projectAggregate(null)).toEqual({ value: null, count: 0 });
  });

  it('returns null value when count < 3 (R10.4)', () => {
    expect(
      projectAggregate({ sum: 5, count: 1, meanX10: null }),
    ).toEqual({ value: null, count: 1 });
    expect(
      projectAggregate({ sum: 12, count: 2, meanX10: null }),
    ).toEqual({ value: null, count: 2 });
  });

  it('renders meanX10 / 10 to one decimal at exactly count = 3 (R10.3)', () => {
    // sum = 21, count = 3, mean_x10 = 70 → value = 7.0
    expect(
      projectAggregate({ sum: 21, count: 3, meanX10: 70 }),
    ).toEqual({ value: 7, count: 3 });
  });

  it('renders meanX10 / 10 to one decimal for non-integer means', () => {
    // sum = 22, count = 3, mean_x10 = round_half_up(220/3) = 73 → value = 7.3
    expect(
      projectAggregate({ sum: 22, count: 3, meanX10: 73 }),
    ).toEqual({ value: 7.3, count: 3 });
  });

  it('preserves the [1.0, 10.0] bounds at the extremes (R10.1)', () => {
    expect(
      projectAggregate({ sum: 30, count: 3, meanX10: 100 }),
    ).toEqual({ value: 10, count: 3 });
    expect(
      projectAggregate({ sum: 3, count: 3, meanX10: 10 }),
    ).toEqual({ value: 1, count: 3 });
  });
});

// ---------------------------------------------------------------------------
// GET /experiences/:id/aggregate-rating
// ---------------------------------------------------------------------------

describe('GET /experiences/:id/aggregate-rating', () => {
  it('returns { value: null, count: 0 } when no aggregate row exists', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: `/experiences/${EXPERIENCE_ID}/aggregate-rating`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ value: null, count: 0 });
    expect(calls.getAggregate).toEqual([EXPERIENCE_ID]);
    await app.close();
  });

  it('returns { value: null, count: 1 } when count is below threshold (R10.4, R10.6)', async () => {
    const { repo } = makeRepo({
      async getAggregate() {
        return { sum: 7, count: 1, meanX10: null };
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'GET',
      url: `/experiences/${EXPERIENCE_ID}/aggregate-rating`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ value: null, count: 1 });
    await app.close();
  });

  it('returns { value: null, count: 2 } at the boundary just below the threshold', async () => {
    const { repo } = makeRepo({
      async getAggregate() {
        return { sum: 14, count: 2, meanX10: null };
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'GET',
      url: `/experiences/${EXPERIENCE_ID}/aggregate-rating`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ value: null, count: 2 });
    await app.close();
  });

  it('returns the published mean and count at the threshold (R10.3, R10.5)', async () => {
    // sum = 24, count = 3, mean = 8.0
    const { repo } = makeRepo({
      async getAggregate() {
        return { sum: 24, count: 3, meanX10: 80 };
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'GET',
      url: `/experiences/${EXPERIENCE_ID}/aggregate-rating`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ value: 8, count: 3 });
    await app.close();
  });

  it('renders a one-decimal mean correctly above the threshold', async () => {
    // sum = 47, count = 6, mean = 7.83… → mean_x10 = 78 → value = 7.8
    const { repo } = makeRepo({
      async getAggregate() {
        return { sum: 47, count: 6, meanX10: 78 };
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'GET',
      url: `/experiences/${EXPERIENCE_ID}/aggregate-rating`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ value: 7.8, count: 6 });
    await app.close();
  });

  it('response body has exactly the keys "value" and "count" (R10.10 privacy boundary)', async () => {
    // Privacy-boundary regression: even if a future change to the
    // AggregateRowState shape adds another field, the route projection
    // must NOT pass it through to the wire response.
    const richRow = {
      sum: 21,
      count: 3,
      meanX10: 70,
      // Extra fields a careless future repo change might add. The route
      // projection only reads `count` and `meanX10`, so these never
      // surface on the wire.
      individualRatings: [4, 8, 9],
      contributorIds: ['user-a', 'user-b', 'user-c'],
    } as unknown as AggregateRowState;
    const { repo } = makeRepo({
      async getAggregate() {
        return richRow;
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'GET',
      url: `/experiences/${EXPERIENCE_ID}/aggregate-rating`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(['count', 'value']);
    expect(body).not.toHaveProperty('individualRatings');
    expect(body).not.toHaveProperty('contributorIds');
    expect(body).not.toHaveProperty('sum');
    expect(body).not.toHaveProperty('meanX10');

    // The body still typechecks as an AggregateRatingDTO.
    const dto: AggregateRatingDTO = {
      value: body.value as number | null,
      count: body.count as number,
    };
    expect(dto).toEqual({ value: 7, count: 3 });
    await app.close();
  });

  it('absent row response body has exactly the keys "value" and "count"', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: `/experiences/${EXPERIENCE_ID}/aggregate-rating`,
    });

    expect(res.statusCode).toBe(200);
    const keys = Object.keys(res.json() as Record<string, unknown>).sort();
    expect(keys).toEqual(['count', 'value']);
    await app.close();
  });

  it('rejects a non-UUID :id path param with 400 validation_failed', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/experiences/not-a-uuid/aggregate-rating',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'id' },
    });
    // The repo must not be touched when validation fails — this keeps a
    // bad-input request from spending DB time.
    expect(calls.getAggregate).toEqual([]);
    await app.close();
  });

  it('forwards the experience id verbatim to the repo', async () => {
    const customId = '22222222-2222-4222-8222-222222222222';
    const { app, calls } = await buildApp();

    await app.inject({
      method: 'GET',
      url: `/experiences/${customId}/aggregate-rating`,
    });

    expect(calls.getAggregate).toEqual([customId]);
    await app.close();
  });
});
