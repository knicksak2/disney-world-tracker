import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { decidePassStart, secretMatches } from '../passGate.js';

describe('passGate.prop.test.ts', () => {
  // Feature: trip-booking-timeline, Property 24: The pass gate admits at most one pass at a time and applies a start-to-start debounce
  it('Property 24: The pass gate admits at most one pass at a time and applies a start-to-start debounce', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: 599 }).map(sec => sec * 1000), // minIntervalMs in [60s, 599s]
        fc.array(
          fc.record({
            deltaMs: fc.integer({ min: 0, max: 1_200_000 }), // up to 20 minutes between requests
            passDurationMs: fc.integer({ min: 10, max: 300_000 }), // 10ms to 5 minutes duration
            passErrors: fc.boolean(),
          }),
          { minLength: 1, maxLength: 30 }
        ),
        (minIntervalMs, events) => {
          let currentTimeMs = 1_000_000_000;
          let inFlight = false;
          let passEndMs = 0;
          let lastStartMs: number | null = null;

          for (const ev of events) {
            currentTimeMs += ev.deltaMs;

            // Update inFlight state based on elapsed time
            if (inFlight && currentTimeMs >= passEndMs) {
              inFlight = false;
            }

            const decision = decidePassStart({
              inFlight,
              lastStartMs,
              nowMs: currentTimeMs,
              minIntervalMs,
            });

            if (inFlight) {
              expect(decision).toBe('skip_in_flight');
            } else if (lastStartMs !== null && currentTimeMs - lastStartMs < minIntervalMs) {
              expect(decision).toBe('skip_debounce');
            } else {
              expect(decision).toBe('start');
              // Stamped on START, never on END
              lastStartMs = currentTimeMs;
              inFlight = true;
              passEndMs = currentTimeMs + ev.passDurationMs;
            }
          }

          // Invariant for 600s tick spacing:
          // For any minInterval in [60s, 599s], two requests exactly 600s apart always start the later one
          // (assuming earlier pass is finished)
          const start1 = 2_000_000_000;
          const d1 = decidePassStart({
            inFlight: false,
            lastStartMs: null,
            nowMs: start1,
            minIntervalMs,
          });
          expect(d1).toBe('start');

          const start2 = start1 + 600_000; // exactly 600s later
          const d2 = decidePassStart({
            inFlight: false, // earlier pass finished or errored
            lastStartMs: start1,
            nowMs: start2,
            minIntervalMs,
          });
          expect(d2).toBe('start');
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 25: Only the exact configured secret authorises the reminder endpoint
  it('Property 25: Only the exact configured secret authorises the reminder endpoint', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 64 }),
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.constant(''),
          fc.constant([]),
          fc.array(fc.string()),
          fc.string({ minLength: 0, maxLength: 64 })
        ),
        (expectedSecret, headerVal) => {
          const matches = secretMatches(headerVal, expectedSecret);
          if (typeof headerVal === 'string' && headerVal === expectedSecret && expectedSecret.length > 0) {
            expect(matches).toBe(true);
          } else {
            expect(matches).toBe(false);
          }

          // Case difference fails
          if (typeof headerVal === 'string' && headerVal.toUpperCase() === expectedSecret.toUpperCase() && headerVal !== expectedSecret) {
            expect(secretMatches(headerVal, expectedSecret)).toBe(false);
          }

          // Extra whitespace fails
          expect(secretMatches(` ${expectedSecret}`, expectedSecret)).toBe(false);
          expect(secretMatches(`${expectedSecret} `, expectedSecret)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
