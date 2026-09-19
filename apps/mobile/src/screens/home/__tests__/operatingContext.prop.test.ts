/**
 * Property tests for Home operating-context subtitle derivation.
 *
 * Validates: Requirements 2.6; design.md Property 9
 */

import fc from 'fast-check';
import { PARKS } from '@dwt/shared';
import type { Park } from '@dwt/shared';
import { buildOperatingContextSubtitle } from '../operatingContext';
import type { OperatingContextInputs } from '../operatingContext';

describe('Feature: navigation-redesign, Property 9: Home operating-context subtitle never renders a fabricated hours or weather value', () => {
  it('never throws, omits weather when absent, and never fabricates values across arbitrary inputs', () => {
    // Feature: navigation-redesign, Property 9: Home operating-context subtitle never renders a fabricated hours or weather value
    fc.assert(
      fc.property(
        fc.record({
          park: fc.constantFrom<Park>(...PARKS),
          parkHours: fc.option(
            fc.record(
              {
                openTime: fc.option(
                  fc.oneof(
                    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
                    fc.constantFrom('8:00 AM', '9:00 AM', '7:30 AM', 'invalid-time', ''),
                  ),
                  { nil: undefined },
                ),
                closeTime: fc.option(
                  fc.oneof(
                    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
                    fc.constantFrom('11:00 PM', '9:00 PM', '10:00 PM', 'invalid-time', ''),
                  ),
                  { nil: undefined },
                ),
              },
              { requiredKeys: [] },
            ),
            { nil: undefined },
          ),
          weather: fc.option(
            fc.record({
              tempF: fc.float({ min: -40, max: 130, noNaN: true }),
              condition: fc.constantFrom(
                'Clear',
                'Sunny',
                'Partly Cloudy',
                'Rain',
                'Thunderstorm',
                'Overcast',
                'Drizzle',
              ),
            }),
            { nil: null },
          ),
          dayContext: fc.option(
            fc.oneof(
              fc.record({
                currentDay: fc.integer({ min: 1, max: 14 }),
                totalDays: fc.integer({ min: 1, max: 14 }),
              }),
              fc.constantFrom('Day 1 of 5', 'Day 2 of 4'),
            ),
            { nil: undefined },
          ),
        }),
        (inputs: OperatingContextInputs) => {
          let subtitle: string;
          expect(() => {
            subtitle = buildOperatingContextSubtitle(inputs);
          }).not.toThrow();

          expect(typeof subtitle!).toBe('string');
          expect(subtitle!).toContain(inputs.park);

          // Never fabricates hardcoded 'Park Closes' or castle emoji
          expect(subtitle!).not.toContain('Park Closes');
          expect(subtitle!).not.toContain('🏰');

          // Day context verification
          if (inputs.dayContext) {
            if (typeof inputs.dayContext === 'string') {
              expect(subtitle!).toContain(inputs.dayContext);
            } else {
              expect(subtitle!).toContain(
                `Day ${inputs.dayContext.currentDay} of ${inputs.dayContext.totalDays}`,
              );
            }
          } else {
            expect(subtitle!).not.toContain('Day ');
          }

          // If weather is absent (null or undefined), no degree symbol or weather condition must be emitted
          if (!inputs.weather) {
            expect(subtitle!).not.toContain('°');
          } else {
            const expectedTemp = `${Math.round(inputs.weather.tempF)}°`;
            expect(subtitle!).toContain(expectedTemp);
            if (inputs.weather.condition) {
              expect(subtitle!).toContain(inputs.weather.condition);
            }
          }

          // Anti-fabrication check: '78°' must not appear unless input tempF actually rounds to 78
          if (!inputs.weather || Math.round(inputs.weather.tempF) !== 78) {
            expect(subtitle!).not.toContain('78°');
          }

          // Anti-fabrication check: 'Sunny' must not appear unless input condition was Sunny
          if (!inputs.weather || inputs.weather.condition !== 'Sunny') {
            expect(subtitle!).not.toContain('Sunny');
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
