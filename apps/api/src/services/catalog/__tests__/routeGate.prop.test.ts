// Feature: restaurant-menu-display, Property 2: Non-restaurant experiences never contact the Menu_Service and omit menus
/**
 * Property-based test for the catalog detail route's non-restaurant menu gate
 * (task 2.3).
 *
 * Validates: Requirements 1.4
 *
 * Property 2 (design.md → Correctness Properties → "Non-restaurant experiences
 * never contact the Menu_Service and omit menus"):
 *
 *   For any Experience whose category is not `Restaurant`, serving its detail
 *   read issues no Menu_Service request and produces an
 *   Experience_Detail_Response with no `menus` field.
 *
 * Test strategy: the catalog plugin is registered against an in-process Fastify
 * instance with a *spy* `getMenusFor` port that records every invocation. The
 * `getMenusFor` port is the seam through which the running server reaches the
 * Menu_Service (via the wired retrieval seam), so asserting the spy is never
 * invoked is exactly asserting the Menu_Service is never contacted for a
 * non-restaurant detail read (R1.4). Because the port is never called, its
 * return value is irrelevant; the spy would return a non-empty menu list if
 * called, so a spurious invocation would additionally surface as a `menus`
 * field on the response — the test asserts the field is absent either way.
 *
 * The generator draws the category from every `EXPERIENCE_CATEGORIES` member
 * except `Restaurant`, so the whole non-restaurant input space is exercised.
 *
 * `numRuns: 100` per the spec convention.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  AREA_TYPES,
  EXPERIENCE_CATEGORIES,
  PARKS,
  type AreaType,
  type ExperienceCategory,
  type ExperienceDTO,
  type MenuDTO,
  type Park,
} from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import { catalogRoutes } from '../routes.js';

const NUM_RUNS = 100;

/** Every category the browse/detail path can carry except `Restaurant`. */
const NON_RESTAURANT_CATEGORIES = EXPERIENCE_CATEGORIES.filter(
  (category): category is Exclude<ExperienceCategory, 'Restaurant'> =>
    category !== 'Restaurant',
);

/**
 * A non-empty menu list the spy would return *if* it were ever invoked. It is
 * non-empty on purpose: were the gate to leak and call the port, the menus
 * would attach to the response, so the "menus omitted" assertion doubles as a
 * second guard against a spurious fetch.
 */
const SPY_MENUS: readonly MenuDTO[] = [
  {
    menuType: 'Lunch',
    cuisineType: 'American',
    groups: [{ name: 'Entrees', items: [{ name: 'Burger', price: '$12' }] }],
  },
];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const nonRestaurantExperienceArb: fc.Arbitrary<ExperienceDTO> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  park: fc.option(fc.constantFrom<Park>(...PARKS), { nil: null }),
  category: fc.constantFrom<Exclude<ExperienceCategory, 'Restaurant'>>(
    ...NON_RESTAURANT_CATEGORIES,
  ),
  description: fc.string({ maxLength: 40 }),
  active: fc.boolean(),
  imageUrl: fc.constant<string | null>(null),
  areaType: fc.constantFrom<AreaType>(...AREA_TYPES),
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('GET /catalog/:experienceId — Property 2: non-restaurant gate', () => {
  it('never contacts the Menu_Service and omits menus for a non-restaurant detail read (R1.4)', async () => {
    await fc.assert(
      fc.asyncProperty(nonRestaurantExperienceArb, async (experience) => {
        const menuCalls: string[] = [];
        const app: FastifyInstance = Fastify({ logger: false });
        registerErrorHandler(app);
        await app.register(
          catalogRoutes({
            decideRead: async () => ({ staleCache: false, cacheAgeHours: null }),
            listActiveExperiences: async () => [],
            getExperience: async () => experience,
            // Spy Menu_Service port: records every invocation. For a
            // non-restaurant read it must never be called (R1.4).
            getMenusFor: async (id) => {
              menuCalls.push(id);
              return SPY_MENUS;
            },
          }),
        );

        try {
          const res = await app.inject({
            method: 'GET',
            url: `/catalog/${experience.id}`,
          });

          expect(res.statusCode).toBe(200);
          // No Menu_Service contact for a non-restaurant Experience.
          expect(menuCalls).toEqual([]);
          // The `menus` field is omitted entirely from the response.
          expect(res.json()).not.toHaveProperty('menus');
        } finally {
          await app.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
