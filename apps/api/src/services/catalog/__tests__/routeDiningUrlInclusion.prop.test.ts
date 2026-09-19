// Feature: restaurant-menu-display, Property 10: The Reservation_Action renders exactly when a dining URL is present, and opens that exact URL
/**
 * Property-based test for the catalog detail route's diningUrl inclusion/omission rule
 * (task 9.4 - response half).
 *
 * Validates: Requirements 6.5, 6.6, 6.7
 *
 * Property 10 (response half):
 *   WHEN a Restaurant_Experience detail is requested and has a persisted dining_url,
 *   the response carries `diningUrl` equal to that value (R6.5).
 *   IF a Restaurant_Experience has no persisted dining_url, the response omits `diningUrl`
 *   entirely (R6.6).
 *   WHERE an Experience is not a Restaurant_Experience, the response omits `diningUrl` (R6.7).
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
  type Park,
} from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import { catalogRoutes } from '../routes.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const experienceWithDiningUrlArb: fc.Arbitrary<ExperienceDTO> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  park: fc.option(fc.constantFrom<Park>(...PARKS), { nil: null }),
  category: fc.constantFrom<ExperienceCategory>(...EXPERIENCE_CATEGORIES),
  description: fc.string({ maxLength: 40 }),
  active: fc.boolean(),
  imageUrl: fc.constant<string | null>(null),
  areaType: fc.constantFrom<AreaType>(...AREA_TYPES),
  diningUrl: fc.option(
    fc.oneof(
      fc.constant(''),
      fc.webUrl({ validSchemes: ['https'] }),
      fc.string({ minLength: 1, maxLength: 100 }),
    ),
    { nil: undefined },
  ),
});

// ---------------------------------------------------------------------------
// Property Test
// ---------------------------------------------------------------------------

describe('GET /catalog/:experienceId — Property 10 (response half: diningUrl inclusion/omission)', () => {
  it('includes diningUrl iff category is Restaurant and diningUrl is non-empty; omits otherwise (R6.5, R6.6, R6.7)', async () => {
    await fc.assert(
      fc.asyncProperty(experienceWithDiningUrlArb, async (experience) => {
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
          }),
        );

        try {
          const res = await app.inject({
            method: 'GET',
            url: `/catalog/${experience.id}`,
          });

          expect(res.statusCode).toBe(200);
          const body = res.json() as Record<string, unknown>;

          const shouldInclude =
            experience.category === 'Restaurant' &&
            experience.diningUrl !== undefined &&
            experience.diningUrl !== null &&
            experience.diningUrl.trim().length > 0;

          if (shouldInclude) {
            expect(body).toHaveProperty('diningUrl');
            expect(body.diningUrl).toBe(experience.diningUrl);
          } else {
            expect(body).not.toHaveProperty('diningUrl');
          }
        } finally {
          await app.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
