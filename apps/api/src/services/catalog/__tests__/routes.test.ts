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

import type { ExperienceDTO, MenuDTO, ResortDTO } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import { AppError } from '../../../errors/AppError.js';
import {
  catalogRoutes,
  type CatalogRoutesOptions,
  type CatalogGetExperience,
  type CatalogListActiveExperiences,
  type CatalogDestinationCount,
  type CatalogLiveDetailResult,
} from '../routes.js';

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
    imageUrl: null,
    areaType: 'ThemePark',
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
    catalogRoutes({
      decideRead,
      listActiveExperiences,
      getExperience,
      ...(overrides.getMenusFor ? { getMenusFor: overrides.getMenusFor } : {}),
      ...(overrides.listActiveResorts
        ? { listActiveResorts: overrides.listActiveResorts }
        : {}),
      ...(overrides.listDestinationCounts
        ? { listDestinationCounts: overrides.listDestinationCounts }
        : {}),
      ...(overrides.getLiveDetail
        ? { getLiveDetail: overrides.getLiveDetail }
        : {}),
    }),
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
      cacheAgeHours: null,
    });
    await app.close();
  });

  it('forwards staleCache=true from the read decision', async () => {
    const { app } = await buildApp({
      decideRead: async () => ({ staleCache: true, cacheAgeHours: 30 }),
      listActiveExperiences: async () => [],
    });

    const res = await app.inject({ method: 'GET', url: '/catalog' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      experiences: [],
      staleCache: true,
      cacheAgeHours: 30,
    });
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

  it('forwards comma-separated categories to the repo as an array and dedupes members (R13.1, R13.2, R13.7)', async () => {
    const { app, listFilters } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?categories=Show,Parade,Character_Meet,Event,Show',
    });

    expect(res.statusCode).toBe(200);
    expect(listFilters).toEqual([
      { categories: ['Show', 'Parade', 'Character_Meet', 'Event'] },
    ]);
    await app.close();
  });

  it('forwards categories conjunctively alongside parkId, category, areaType, land, and q (R13.3)', async () => {
    const { app, listFilters } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?parkId=Magic%20Kingdom&categories=Show,Parade&category=Show&areaType=ThemePark&land=Tomorrowland&q=Space',
    });

    expect(res.statusCode).toBe(200);
    expect(listFilters).toEqual([
      {
        park: 'Magic Kingdom',
        categories: ['Show', 'Parade'],
        category: 'Show',
        areaType: 'ThemePark',
        land: 'Tomorrowland',
        q: 'Space',
      },
    ]);
    await app.close();
  });

  it('rejects an invalid member in categories with validation_failed naming categories (R13.5)', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?categories=Show,NotACategory',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'categories' },
    });
    await app.close();
  });

  it('rejects an empty or whitespace-only categories parameter with validation_failed naming categories (R13.6)', async () => {
    const { app } = await buildApp();

    const res1 = await app.inject({
      method: 'GET',
      url: '/catalog?categories=',
    });
    expect(res1.statusCode).toBe(400);
    expect(res1.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'categories' },
    });

    const res2 = await app.inject({
      method: 'GET',
      url: '/catalog?categories=%20%20',
    });
    expect(res2.statusCode).toBe(400);
    expect(res2.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'categories' },
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
    // The detail response carries the full Experience projection (id, name,
    // park, category, description, imageUrl, areaType, plus any persisted
    // enrichment) minus the browse-only `active` flag; no `imageAttribution`
    // (Disney imagery needs no third-party credit).
    expect(res.json()).toEqual({
      id: exp.id,
      name: exp.name,
      park: exp.park,
      category: exp.category,
      description: exp.description,
      imageUrl: null,
      areaType: 'ThemePark',
    });
    expect(res.json()).not.toHaveProperty('active');
    expect(res.json()).not.toHaveProperty('imageAttribution');
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

// ---------------------------------------------------------------------------
// GET /catalog — areaType filter (R16.3)
// ---------------------------------------------------------------------------

describe('GET /catalog areaType filter', () => {
  it('forwards a valid areaType filter to the repo (R16.3)', async () => {
    const { app, listFilters } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?areaType=Resort',
    });

    expect(res.statusCode).toBe(200);
    expect(listFilters).toEqual([{ areaType: 'Resort' }]);
    await app.close();
  });

  it('forwards areaType alongside parkId, category, and q (R16.3, R16.4)', async () => {
    const { app, listFilters } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?parkId=EPCOT&category=Restaurant&areaType=ThemePark&q=Space',
    });

    expect(res.statusCode).toBe(200);
    expect(listFilters).toEqual([
      {
        park: 'EPCOT',
        category: 'Restaurant',
        areaType: 'ThemePark',
        q: 'Space',
      },
    ]);
    await app.close();
  });

  it('rejects an invalid areaType enum value with validation_failed', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?areaType=Galaxy',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'areaType' },
    });
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /catalog/:experienceId — enrichment + menus (R5.6, R5.7, R8.5)
// ---------------------------------------------------------------------------

describe('GET /catalog/:experienceId enrichment + menus', () => {
  it('exposes persisted enrichment fields on the detail response (R5.6, R5.7)', async () => {
    const exp = makeExperience({
      id: '55555555-5555-4555-8555-555555555555',
      areaType: 'Resort',
      resortId: '66666666-6666-4666-8666-666666666666',
      latitude: 28.4,
      longitude: -81.5,
      accessibility: ['wheelchair-access'],
      priceTier: '$$',
      mealPeriods: [{ type: 'Dinner', priceTier: '$$' }],
    });
    const { app } = await buildApp({ getExperience: async () => exp });

    const res = await app.inject({ method: 'GET', url: `/catalog/${exp.id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: exp.id,
      name: exp.name,
      park: exp.park,
      category: exp.category,
      description: exp.description,
      imageUrl: null,
      areaType: 'Resort',
      resortId: '66666666-6666-4666-8666-666666666666',
      latitude: 28.4,
      longitude: -81.5,
      accessibility: ['wheelchair-access'],
      priceTier: '$$',
      mealPeriods: [{ type: 'Dinner', priceTier: '$$' }],
    });
    await app.close();
  });

  it('attaches persisted menus fetched via getMenusFor (R8.5)', async () => {
    const exp = makeExperience({
      id: '77777777-7777-4777-8777-777777777777',
      category: 'Restaurant',
    });
    const menus: MenuDTO[] = [
      {
        menuType: 'Dinner',
        cuisineType: 'American',
        groups: [
          {
            name: 'Appetizers',
            items: [{ name: 'Soup', price: '$8' }],
          },
        ],
      },
    ];
    const menuCalls: string[] = [];
    const { app } = await buildApp({
      getExperience: async () => exp,
      getMenusFor: async (id) => {
        menuCalls.push(id);
        return menus;
      },
    });

    const res = await app.inject({ method: 'GET', url: `/catalog/${exp.id}` });

    expect(res.statusCode).toBe(200);
    expect(menuCalls).toEqual([exp.id]);
    expect(res.json().menus).toEqual(menus);
    await app.close();
  });

  it('omits menus when getMenusFor returns none (R8.3)', async () => {
    const exp = makeExperience({
      id: '88888888-8888-4888-8888-888888888888',
    });
    const { app } = await buildApp({
      getExperience: async () => exp,
      getMenusFor: async () => [],
    });

    const res = await app.inject({ method: 'GET', url: `/catalog/${exp.id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('menus');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /resorts (R6.8, R16.5)
// ---------------------------------------------------------------------------

describe('GET /resorts', () => {
  it('returns the active resort list from the repo port (R6.8)', async () => {
    const resorts: ResortDTO[] = [
      {
        id: '99999999-9999-4999-8999-999999999999',
        name: "Disney's Polynesian Village Resort",
        description: 'A South Seas paradise.',
        imageUrl: 'https://cdn.example/poly.jpg',
        latitude: 28.4,
        longitude: -81.58,
        address: '1600 Seven Seas Dr',
        phone: '407-555-0100',
        representingExperienceId: '88888888-8888-4888-8888-888888888888',
      },
    ];
    const { app } = await buildApp({ listActiveResorts: async () => resorts });

    const res = await app.inject({ method: 'GET', url: '/resorts' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ resorts });
    await app.close();
  });

  it('is not registered (404) when no resort port is wired', async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/resorts' });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /catalog/:experienceId/live (R9.1)
// ---------------------------------------------------------------------------

describe('GET /catalog/:experienceId/live', () => {
  it('serves the Disney live projection via the injected port (R9.1)', async () => {
    const experienceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const result: CatalogLiveDetailResult = {
      liveDetail: {
        status: 'Operating',
        waitMinutes: 35,
        showtimes: [],
        operatingHours: [],
        diningAvailability: [],
      },
      retrievedAt: '2024-01-01T12:00:00.000Z',
      stale: false,
    };
    const liveCalls: string[] = [];
    const { app } = await buildApp({
      getLiveDetail: async (id) => {
        liveCalls.push(id);
        return result;
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${experienceId}/live`,
    });

    expect(res.statusCode).toBe(200);
    expect(liveCalls).toEqual([experienceId]);
    expect(res.json()).toEqual(result);
    await app.close();
  });

  it('rejects a non-UUID experienceId on the live route with validation_failed', async () => {
    const { app } = await buildApp({
      getLiveDetail: async () => {
        throw new Error('should not be called');
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/catalog/not-a-uuid/live',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'experienceId' },
    });
    await app.close();
  });

  it('propagates live_unavailable from the port as HTTP 503', async () => {
    const { app } = await buildApp({
      getLiveDetail: async () => {
        throw new AppError(
          'live_unavailable',
          'Live data is currently unavailable.',
        );
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/catalog/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/live',
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: 'live_unavailable' },
    });
    await app.close();
  });

  it('is not registered here (404) when no live port is wired', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog/cccccccc-cccc-4ccc-8ccc-cccccccccccc/live',
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /catalog — Land filter (R3.4, R3.5, R3.7)
// ---------------------------------------------------------------------------

describe('GET /catalog land filter', () => {
  it('forwards a Land filter value to the repo (R3.4)', async () => {
    const { app, listFilters } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?land=Fantasyland',
    });

    expect(res.statusCode).toBe(200);
    expect(listFilters).toEqual([{ land: 'Fantasyland' }]);
    await app.close();
  });

  it('preserves the Land filter value case-sensitively (R3.4)', async () => {
    const { app, listFilters } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?land=TOMORROWLAND',
    });

    expect(res.statusCode).toBe(200);
    // The route forwards the exact casing to the repo, which applies the
    // case-sensitive `land = $n` predicate.
    expect(listFilters).toEqual([{ land: 'TOMORROWLAND' }]);
    await app.close();
  });

  it('forwards Land alongside parkId, category, areaType, and q (R3.5, R3.7)', async () => {
    const { app, listFilters } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?parkId=Magic%20Kingdom&category=Ride&areaType=ThemePark&q=mountain&land=Fantasyland',
    });

    expect(res.statusCode).toBe(200);
    expect(listFilters).toEqual([
      {
        park: 'Magic Kingdom',
        category: 'Ride',
        areaType: 'ThemePark',
        q: 'mountain',
        land: 'Fantasyland',
      },
    ]);
    await app.close();
  });

  it('returns an empty list when the Land filter matches nothing (R3.8)', async () => {
    const { app } = await buildApp({
      listActiveExperiences: async () => [],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/catalog?land=NoSuchLand',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      experiences: [],
      staleCache: false,
      cacheAgeHours: null,
    });
    await app.close();
  });

  it('exposes a persisted Land value on each list Experience (R3.1, R3.3)', async () => {
    const exp = makeExperience({ land: 'Fantasyland' });
    const { app } = await buildApp({
      listActiveExperiences: async () => [exp],
    });

    const res = await app.inject({ method: 'GET', url: '/catalog' });

    expect(res.statusCode).toBe(200);
    expect(res.json().experiences[0].land).toBe('Fantasyland');
    await app.close();
  });

  it('rejects a Land filter longer than 200 characters with validation_failed (R1.7)', async () => {
    const { app } = await buildApp();
    const longLand = 'x'.repeat(201);

    const res = await app.inject({
      method: 'GET',
      url: `/catalog?land=${longLand}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'land' },
    });
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /catalog/:experienceId — Land detail field (R3.3)
// ---------------------------------------------------------------------------

describe('GET /catalog/:experienceId land field', () => {
  it('carries a persisted Land value on the detail response (R3.3)', async () => {
    const exp = makeExperience({
      id: '12121212-1212-4121-8121-121212121212',
      land: 'Fantasyland',
    });
    const { app } = await buildApp({ getExperience: async () => exp });

    const res = await app.inject({ method: 'GET', url: `/catalog/${exp.id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json().land).toBe('Fantasyland');
    await app.close();
  });

  it('carries an explicit null Land through the detail response (R3.2)', async () => {
    const exp = makeExperience({
      id: '13131313-1313-4131-8131-131313131313',
      land: null,
    });
    const { app } = await buildApp({ getExperience: async () => exp });

    const res = await app.inject({ method: 'GET', url: `/catalog/${exp.id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json().land).toBeNull();
    await app.close();
  });

  it('omits the Land field when the Experience has no persisted Land (R3.2)', async () => {
    const exp = makeExperience({
      id: '14141414-1414-4141-8141-141414141414',
    });
    const { app } = await buildApp({ getExperience: async () => exp });

    const res = await app.inject({ method: 'GET', url: `/catalog/${exp.id}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('land');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /catalog/destinations (R3.6, R10.1, R10.2)
// ---------------------------------------------------------------------------

describe('GET /catalog/destinations', () => {
  /** The eight-Destination payload the repo port produces (R3.6, R4.5, R4.6). */
  const destinations: CatalogDestinationCount[] = [
    { destination: 'Magic Kingdom', count: 42 },
    { destination: 'EPCOT', count: 30 },
    { destination: 'Hollywood Studios', count: 25 },
    { destination: 'Animal Kingdom', count: 28 },
    { destination: 'Typhoon Lagoon', count: 5 },
    { destination: 'Blizzard Beach', count: 0 },
    { destination: 'Disney Springs', count: 18 },
    { destination: 'Resorts', count: 60 },
  ];

  it('returns the eight-entry destinations payload with staleCache=false (R3.6)', async () => {
    const { app } = await buildApp({
      listDestinationCounts: async () => destinations,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/catalog/destinations',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      destinations,
      staleCache: false,
      cacheAgeHours: null,
    });
    // All eight Destinations are present, including a zero-count one (R4.6).
    expect(res.json().destinations).toHaveLength(8);
    await app.close();
  });

  it('flags staleCache=true and the cache age from the read decision (R10.1)', async () => {
    const { app } = await buildApp({
      decideRead: async () => ({ staleCache: true, cacheAgeHours: 30 }),
      listDestinationCounts: async () => destinations,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/catalog/destinations',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      destinations,
      staleCache: true,
      cacheAgeHours: 30,
    });
    await app.close();
  });

  it('propagates catalog_unavailable from the read decision as HTTP 503 (R10.2)', async () => {
    let countsCalled = false;
    const { app } = await buildApp({
      decideRead: async () => {
        throw new AppError(
          'catalog_unavailable',
          'The Disney World catalog could not be loaded.',
        );
      },
      listDestinationCounts: async () => {
        countsCalled = true;
        return destinations;
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/catalog/destinations',
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: 'catalog_unavailable',
        message: 'The Disney World catalog could not be loaded.',
      },
    });
    // The counts read is short-circuited when the decision throws (R10.2).
    expect(countsCalled).toBe(false);
    await app.close();
  });

  it('runs the read decision before reading the counts', async () => {
    const events: string[] = [];
    const { app } = await buildApp({
      decideRead: async () => {
        events.push('decide');
        return { staleCache: false };
      },
      listDestinationCounts: async () => {
        events.push('counts');
        return destinations;
      },
    });

    await app.inject({ method: 'GET', url: '/catalog/destinations' });

    expect(events).toEqual(['decide', 'counts']);
    await app.close();
  });

  it('falls through to the detail param route (400) when no destinations port is wired', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/catalog/destinations',
    });

    // Without the destinations port the static route is not registered, so
    // `/catalog/destinations` is captured by the parametric
    // `/catalog/:experienceId` route, where "destinations" fails UUID
    // validation and surfaces as 400 validation_failed.
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'experienceId' },
    });
    await app.close();
  });

  it('resolves /catalog/destinations to the counts route, not the detail param route', async () => {
    // Fastify resolves the static `/catalog/destinations` ahead of the
    // parametric `/catalog/:experienceId`, so the detail port is never hit.
    const detailIds: string[] = [];
    const { app } = await buildApp({
      getExperience: async (id) => {
        detailIds.push(id);
        return null;
      },
      listDestinationCounts: async () => destinations,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/catalog/destinations',
    });

    expect(res.statusCode).toBe(200);
    expect(detailIds).toEqual([]);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// GET /catalog/:experienceId + /live — unchanged behavior with facet
// enrichment wired in (R10.3)
// ---------------------------------------------------------------------------

describe('detail + live behavior unchanged by facet enrichment (R10.3)', () => {
  it('leaves the existing detail-response fields unchanged for a DTO without the new facet fields', async () => {
    // A DTO carrying the pre-existing detail fields (core projection plus the
    // already-persisted enrichment: coordinates, accessibility, menus/meal
    // periods) but none of the six new facet-enrichment fields.
    const exp = makeExperience({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      name: "Be Our Guest Restaurant",
      park: 'Magic Kingdom',
      category: 'Restaurant',
      description: 'Dine in the Beast\u2019s enchanted castle.',
      imageUrl: 'https://cdn.example/bog.jpg',
      areaType: 'ThemePark',
      latitude: 28.42,
      longitude: -81.58,
      accessibility: ['wheelchair-access'],
      priceTier: '$$$',
      mealPeriods: [{ type: 'Dinner', priceTier: '$$$' }],
      land: 'Fantasyland',
    });
    const menus: MenuDTO[] = [
      {
        menuType: 'Dinner',
        cuisineType: 'French',
        groups: [{ name: 'Entrees', items: [{ name: 'Ratatouille', price: '$34' }] }],
      },
    ];
    const { app } = await buildApp({
      getExperience: async () => exp,
      getMenusFor: async () => menus,
    });

    const res = await app.inject({ method: 'GET', url: `/catalog/${exp.id}` });

    expect(res.statusCode).toBe(200);
    // Every existing detail field is projected verbatim; `active` is stripped.
    expect(res.json()).toEqual({
      id: exp.id,
      name: exp.name,
      park: exp.park,
      category: exp.category,
      description: exp.description,
      imageUrl: 'https://cdn.example/bog.jpg',
      areaType: 'ThemePark',
      latitude: 28.42,
      longitude: -81.58,
      accessibility: ['wheelchair-access'],
      priceTier: '$$$',
      mealPeriods: [{ type: 'Dinner', priceTier: '$$$' }],
      land: 'Fantasyland',
      menus,
    });
    // None of the six new facet-enrichment fields appear when unpersisted.
    const body = res.json();
    expect(body).not.toHaveProperty('heightRequirement');
    expect(body).not.toHaveProperty('groupedFacets');
    expect(body).not.toHaveProperty('physicalConsiderations');
    expect(body).not.toHaveProperty('interestFacets');
    expect(body).not.toHaveProperty('whyThis');
    expect(body).not.toHaveProperty('subType');
    expect(body).not.toHaveProperty('active');
    await app.close();
  });

  it('serves the live projection unchanged via the injected port (R10.3)', async () => {
    const experienceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const result: CatalogLiveDetailResult = {
      liveDetail: {
        status: 'Operating',
        waitMinutes: 20,
        showtimes: [],
        operatingHours: [],
        diningAvailability: [],
      },
      retrievedAt: '2024-06-01T09:30:00.000Z',
      stale: false,
    };
    const liveCalls: string[] = [];
    const { app } = await buildApp({
      getLiveDetail: async (id) => {
        liveCalls.push(id);
        return result;
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${experienceId}/live`,
    });

    expect(res.statusCode).toBe(200);
    // The live handler forwards the id to the port and returns its result
    // byte-for-byte: the facet-enrichment work never touches this path.
    expect(liveCalls).toEqual([experienceId]);
    expect(res.json()).toEqual(result);
    await app.close();
  });

  it('keeps live behavior independent of persisted facet enrichment on the same Experience', async () => {
    // Even when the detail read would surface the new facet fields, the live
    // route is served solely by its own port and is unaffected (R10.3).
    const experienceId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const result: CatalogLiveDetailResult = {
      liveDetail: {
        status: 'Down',
        showtimes: [],
        operatingHours: [],
        diningAvailability: [],
      },
      retrievedAt: '2024-06-01T10:00:00.000Z',
      stale: true,
    };
    const { app } = await buildApp({
      getExperience: async () =>
        makeExperience({
          id: experienceId,
          subType: 'Roller Coaster',
          groupedFacets: { Thrill: [{ id: 'big-drops', name: 'Big Drops' }] },
        }),
      getLiveDetail: async () => result,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${experienceId}/live`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(result);
    await app.close();
  });
});
