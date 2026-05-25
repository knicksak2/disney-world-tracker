/**
 * Unit tests for the Catalog_Service routes plugin (task 9.6).
 *
 * The plugin is registered against an in-process Fastify instance with
 * fake implementations of the three injected ports (`decideRead`,
 * `listActiveExperiences`, `getExperience`). No database, Redis, or
 * upstream HTTP traffic is involved; each test is hermetic and
 * deterministic.
 *
 * Coverage focuses on the requirements scoped to this task:
 *
 *   - R1.17  GET /catalog returns the active list with stable ordering;
 *            the route forwards the repo's ordering verbatim.
 *   - R1.18  category filter is forwarded to the repo.
 *   - R1.19  parkId filter is forwarded as `park` to the repo.
 *   - R1.20  q filter is trimmed; whitespace-only collapses to "no
 *            filter" rather than raising a validation error; valid
 *            query is forwarded to the repo.
 *   - R1.21  Combined parkId/category/q filters are forwarded together.
 *   - R1.22  GET /catalog/:experienceId returns the detail projection
 *            (id, name, park, category, description); active flag is
 *            stripped from the wire response.
 *   - R1.13  staleCache:true from the read decision surfaces in the
 *            envelope on the GET /catalog response.
 *   - R1.24  catalog_unavailable from the read decision propagates as
 *            HTTP 503 via the global error hook.
 *   - Validation: invalid enum values for parkId/category surface as
 *            400 validation_failed; invalid UUID for the detail path
 *            surfaces as 400 validation_failed; missing experience is
 *            a 404.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { ExperienceDTO } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import { AppError } from '../../../errors/AppError.js';
import { catalogRoutes, type CatalogRoutesOptions, type CatalogGetExperience, type CatalogListActiveExperiences } from '../routes.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build an Experience DTO fixture. Every field has a sensible default so
 * each test only specifies the fields it cares about.
 */
function makeExperience(overrides: Partial<ExperienceDTO> = {}): ExperienceDTO {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Space Mountain',
    park: 'Magic Kingdom',
    category: 'Ride',
    description: 'A classic indoor roller coaster.',
    active: true,
    ...overrides,
  };
}

/**
 * Build a Fastify instance with the catalog routes registered against a
 * set of stub ports. The error handler is wired so AppError throws (e.g.
 * `catalog_unavailable`) translate to the uniform envelope.
 */
async function buildApp(
  overrides: Partial<CatalogRoutesOptions> = {},
): Promise<{
  app: FastifyInstance;
  decideReadCalls: number;
  listFilters: Array<Record<string, unknown>>;
  detailIds: string[];
}> {
  const decideReadDefault = async () => ({ staleCache: false });
  const listDefault = async () => [] as readonly ExperienceDTO[];
  const detailDefault = async () => null;

  let decideReadCalls = 0;
  const listFilters: Array<Record<string, unknown>> = [];
  const detailIds: string[] = [];

  const decideRead = overrides.decideRead
    ? overrides.decideRead
    : async () => {
        decideReadCalls += 1;
        return decideReadDefault();
      };

  const listActiveExperiences: CatalogListActiveExperiences = overrides.listActiveExperiences
    ? overrides.listActiveExperiences
    : async (filters) => {
        listFilters.push({ ...filters });
        return listDefault();
      };

  const getExperience: CatalogGetExperience = overrides.getExperience
    ? overrides.getExperience
    : async (id) => {
        detailIds.push(id);
        return detailDefault();
      };

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    catalogRoutes({ decideRead, listActiveExperiences, getExperience }),
  );

  return { app, get decideReadCalls() { return decideReadCalls; }, listFilters, detailIds };
}

// ---------------------------------------------------------------------------
// GET /catalog
// ---------------------------------------------------------------------------

describe('GET /catalog', () => {
  it('returns the repo result and staleCache=false on a fresh cache', async () => {
    const exp = makeExperience();
    const { app } = await buildApp({
      listActiveExperiences: async () => [exp],
    });

    const res = await app.inject({ method: 'GET', url: '/catalog' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      experiences: [exp],
      staleCache: false,
    });
    await app.close();
  });

  it('forwards staleCache=true from the read decision', async () => {
    const { app } = await buildApp({
      decideRead: async () => ({ staleCache: true }),
      listActiveExperiences: async () => [],
    });

    const res = await app.inject({ method: 'GET', url: '/catalog' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ experiences: [], staleCache: true });
    await app.close();
  });

  it('preserves repo ordering verbatim (R1.17)', async () => {
    const a = makeExperience({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Astro Orbiter',
      park: 'Magic Kingdom',
    });
    const b = makeExperience({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Buzz Lightyear',
      park: 'Magic Kingdom',
    });
    const c = makeExperience({
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Soarin',
      park: 'EPCOT',
    });

    const { app } = await buildApp({
      // The repo guarantees `park, lower(name)` ordering. The route is
      // expected to forward the list as-is, not re-sort it.
      listActiveExperiences: async () => [a, b, c],
    });

    const res = await app.inject({ method: 'GET', url: '/catalog' });
    expect(res.statusCode).toBe(200);
    expect(res.json().experiences).toEqual([a, b, c]);
    await app.close();
  });

  it('forwards parkId, category, and trimmed q filters to the repo (R1.18-R1.21)', async () => {
    const { app, listFilters } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?parkId=EPCOT&category=Restaurant&q=%20Space%20',
    });

    expect(res.statusCode).toBe(200);
    expect(listFilters).toEqual([
      { park: 'EPCOT', category: 'Restaurant', q: 'Space' },
    ]);
    await app.close();
  });

  it('drops a whitespace-only q (R1.20: at least 1 non-whitespace character)', async () => {
    const { app, listFilters } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?q=%20%20%20',
    });

    expect(res.statusCode).toBe(200);
    expect(listFilters).toEqual([{}]);
    await app.close();
  });

  it('rejects an invalid parkId enum value with validation_failed', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?parkId=Universal',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'parkId' },
    });
    await app.close();
  });

  it('rejects an invalid category enum value with validation_failed', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?category=Coaster',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'category' },
    });
    await app.close();
  });

  it('rejects a q longer than 100 characters with search_query_length_invalid', async () => {
    const { app } = await buildApp();
    const longQuery = 'x'.repeat(101);

    const res = await app.inject({
      method: 'GET',
      url: `/catalog?q=${longQuery}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'search_query_length_invalid', field: 'q' },
    });
    await app.close();
  });

  it('propagates catalog_unavailable from the read decision as HTTP 503 (R1.24)', async () => {
    const { app } = await buildApp({
      decideRead: async () => {
        throw new AppError(
          'catalog_unavailable',
          'The Disney World catalog could not be loaded.',
        );
      },
    });

    const res = await app.inject({ method: 'GET', url: '/catalog' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: 'catalog_unavailable',
        message: 'The Disney World catalog could not be loaded.',
      },
    });
    await app.close();
  });

  it('runs the read decision before listing rows', async () => {
    const events: string[] = [];
    const { app } = await buildApp({
      decideRead: async () => {
        events.push('decide');
        return { staleCache: false };
      },
      listActiveExperiences: async () => {
        events.push('list');
        return [];
      },
    });

    await app.inject({ method: 'GET', url: '/catalog' });

    expect(events).toEqual(['decide', 'list']);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /catalog/:experienceId
// ---------------------------------------------------------------------------

describe('GET /catalog/:experienceId', () => {
  it('returns the detail projection of an existing experience (R1.22)', async () => {
    const exp = makeExperience({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Soarin Around the World',
      park: 'EPCOT',
      category: 'Ride',
      description: 'Hang glide over global landmarks.',
    });
    const { app } = await buildApp({
      getExperience: async () => exp,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${exp.id}`,
    });

    expect(res.statusCode).toBe(200);
    // The detail response carries id+name+park+category+description; no
    // `active` flag (it's only relevant to the browse path).
    expect(res.json()).toEqual({
      id: exp.id,
      name: exp.name,
      park: exp.park,
      category: exp.category,
      description: exp.description,
    });
    expect(res.json()).not.toHaveProperty('active');
    await app.close();
  });

  it('returns the detail projection even for a soft-deleted experience (R1.15)', async () => {
    const exp = makeExperience({
      id: '33333333-3333-4333-8333-333333333333',
      active: false,
    });
    const { app } = await buildApp({
      getExperience: async () => exp,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${exp.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(exp.id);
    await app.close();
  });

  it('returns 404 when the repo finds no row', async () => {
    const { app } = await buildApp({
      getExperience: async () => null,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/catalog/44444444-4444-4444-8444-444444444444',
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a non-UUID experienceId with validation_failed', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog/not-a-uuid',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'experienceId' },
    });
    await app.close();
  });
});
