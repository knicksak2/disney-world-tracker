// Feature: day-planning-optimization, Property 0: PlannedItem inputs and DTOs stay aligned

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { plannedItemAddSchema } from '../trips.js';

describe('PlannedItem inputs and DTOs stay aligned', () => {
  it('accepts valid scheduling fields identically', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.option(fc.constant('2024-01-01'), { nil: null }),
        fc.option(fc.constant('2024-01-01T10:00:00.000Z'), { nil: null }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom('experience', 'break'),
        fc.option(fc.integer({ min: 1, max: 200 }), { nil: null }),
        (experienceId, plannedDate, plannedTime, isFixed, isLightningLane, useSingleRider, priority, itemType, durationMinutes) => {
          const rawInput = {
            experienceId,
            plannedDate,
            plannedTime,
            isFixed,
            isLightningLane,
            useSingleRider,
            priority,
            itemType,
            durationMinutes
          };
          
          const result = plannedItemAddSchema.safeParse(rawInput);
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
