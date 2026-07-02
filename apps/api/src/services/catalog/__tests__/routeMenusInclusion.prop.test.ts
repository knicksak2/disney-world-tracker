// Feature: restaurant-menu-display, Property 4: The response includes menus exactly when non-empty and omits them otherwise
/**
 * Property-based test for the catalog detail route's menu include/omit rule
 * (task 2.5).
 *
 * Validates: Requirements 3.1, 3.2
 *
 * Property 4 (design.md → Correctness Properties → "The response includes menus
 * exactly when non-empty and omits them otherwise"):
 *
 *   For any served menu list, the Experience_Detail_Response includes a `menus`
 *   field deep-equal to that list when the list is non-empty, and omits the
 *   `menus` field entirely (neither `null` nor `[]`) when the list is empty.
 *
 * Test strategy: `toDetailResponse` is not exported, so it is exercised through
 * the running `GET /catalog/:experienceId` handler. The catalog plugin is
 * registered against an in-process Fastify instance for a `Restaurant`
 * Experience (so the category gate lets the menu read through) with a
 * `getMenusFor` port that returns an arbitrary served list. Driving the real
 * HTTP handler exercises the actual `toDetailResponse` attach/omit branch
 * (`...(menus.length > 0 ? { menus } : {})`).
 *
 * The served-list generator spans the whole decision space: the empty list and
 * non-empty lists of well-formed `MenuDTO`s (arbitrary menu types, optional
 * cuisine types including `null`, ordered groups, ordered items with prices
 * spanning `null`/empty/non-empty). Because the JSON round-trip drops `null`
 * cuisine/price fields but keeps them on the served list, the non-empty
 * assertion compares against the list projected through the same JSON
 * round-trip the response undergoes — so the test asserts the response carries
 * exactly the served menus without conflating JSON's `undefined`-elision with a
 * genuine content difference.
 *
 * `numRuns: 100` per the spec convention.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  AREA_TYPES,
  PARKS,
  type AreaType,
  type ExperienceDTO,
  type MenuDTO,
  type Park,
} from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import { catalogRoutes } from '../routes.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A well-formed `MenuDTO` spanning the optional-field space (R8.2 shape). */
const menuDtoArb: fc.Arbitrary<MenuDTO> = fc.record({
  menuType: fc.string({ minLength: 1, maxLength: 20 }),
  cuisineType: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
  groups: fc.array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }),
      items: fc.array(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 20 }),
          // price spans null, empty string, and non-empty strings.
          price: fc.option(fc.string({ maxLength: 10 }), { nil: null }),
        }),
        { maxLength: 4 },
      ),
    }),
    { maxLength: 4 },
  ),
});

/** A served menu list spanning empty and non-empty. */
const servedMenusArb: fc.Arbitrary<readonly MenuDTO[]> = fc.array(menuDtoArb, {
  minLength: 0,
  maxLength: 4,
});

/** A `Restaurant` Experience — the category gate lets the menu read through. */
const restaurantExperienceArb: fc.Arbitrary<ExperienceDTO> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  park: fc.option(fc.constantFrom<Park>(...PARKS), { nil: null }),
  category: fc.constant('Restaurant' as const),
  description: fc.string({ maxLength: 40 }),
  active: fc.boolean(),
  imageUrl: fc.constant<string | null>(null),
  areaType: fc.constantFrom<AreaType>(...AREA_TYPES),
});

/**
 * Project a value through the same JSON round-trip the HTTP response undergoes,
 * so `null`/`undefined` optional fields are elided identically on both sides of
 * the comparison. This isolates the property under test (menus present iff
 * non-empty, deep-equal to the served list) from JSON serialization noise.
 */
function jsonRoundTrip<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('GET /catalog/:experienceId — Property 4: menu include/omit rule', () => {
  it('includes `menus` deep-equal to the served list when non-empty and omits the field entirely when empty (R3.1, R3.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        restaurantExperienceArb,
        servedMenusArb,
        async (experience, served) => {
          const app: FastifyInstance = Fastify({ logger: false });
          registerErrorHandler(app);
          await app.register(
            catalogRoutes({
              decideRead: async () => ({
                staleCache: false,
                cacheAgeHours: null,
              }),
              listActiveExperiences: async () => [],
              getExperience: async () => experience,
              // Return the arbitrary served list for this restaurant read.
              getMenusFor: async () => served,
            }),
          );

          try {
            const res = await app.inject({
              method: 'GET',
              url: `/catalog/${experience.id}`,
            });

            expect(res.statusCode).toBe(200);
            const body = res.json() as Record<string, unknown>;

            if (served.length > 0) {
              // Non-empty ⇒ `menus` present and deep-equal to the served list
              // (through the shared JSON round-trip).
              expect(body).toHaveProperty('menus');
              expect(body.menus).toEqual(jsonRoundTrip(served));
            } else {
              // Empty ⇒ field omitted entirely: neither `null` nor `[]`.
              expect(body).not.toHaveProperty('menus');
            }
          } finally {
            await app.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
