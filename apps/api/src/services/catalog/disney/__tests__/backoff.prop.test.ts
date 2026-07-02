// Feature: disney-source-resilience, Property 3: Backoff delay schedule
/**
 * Property-based test for the Backoff_Policy pure decision core
 * (`services/catalog/disney/backoff.ts`).
 *
 * ---------------------------------------------------------------------------
 * Property 3: Backoff delay schedule.
 *
 * Validates: Requirements 3.2, 3.4, 3.6
 *
 * For any attempt index, `BackoffConfig`, injected jitter sample, and parsed
 * `Retry-After`, the backoff core:
 *
 *   - computes an exponential pre-jitter base delay
 *     `baseDelayMs * factor^(attempt-1)` that is always capped at `maxDelayMs`
 *     (R3.2);
 *   - jitters the capped base into the documented equal-jitter band
 *     `[base * JITTER_FLOOR_RATIO, base)` (R3.2);
 *   - treats `Retry-After` as a floor, so the returned delay is never shorter
 *     than the parsed header duration (R3.4); and
 *   - builds a full schedule (`computeBackoffSchedule`) whose length never
 *     exceeds `maxRetries` and whose cumulative delay never exceeds
 *     `maxTotalDelayMs` (R3.3, R3.6).
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { BackoffConfig } from '@dwt/shared';

import {
  JITTER_FLOOR_RATIO,
  computeBaseDelay,
  computeBackoffDelay,
  computeBackoffSchedule,
  parseRetryAfter,
  type BackoffScheduleInput,
} from '../backoff.js';

const NUM_RUNS = 100;

/**
 * A well-formed `BackoffConfig` with sane relationships between the fields:
 * a positive base, a growth factor >= 1, a per-attempt ceiling at least as
 * large as the base, a bounded retry count, and a cumulative cap. These bounds
 * keep the generated space realistic while still exercising the cap logic.
 */
const backoffConfigArb: fc.Arbitrary<BackoffConfig> = fc
  .record({
    baseDelayMs: fc.integer({ min: 1, max: 5_000 }),
    factor: fc.double({ min: 1, max: 4, noNaN: true, noDefaultInfinity: true }),
    maxRetries: fc.integer({ min: 0, max: 10 }),
    maxDelayMs: fc.integer({ min: 1, max: 60_000 }),
    maxTotalDelayMs: fc.integer({ min: 0, max: 600_000 }),
  })
  .map((cfg) => ({
    ...cfg,
    // The per-attempt ceiling should be at least the base so the cap is a
    // ceiling, not a floor.
    maxDelayMs: Math.max(cfg.maxDelayMs, cfg.baseDelayMs),
  }));

/** A jitter sample in the injected `[0, 1)` range. */
const jitterArb: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
  maxExcluded: true,
});

/** A 1-based retry attempt index. */
const attemptArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 20 });

describe('backoff — Property 3: backoff delay schedule', () => {
  it('caps the exponential pre-jitter base at maxDelayMs and never goes below the base for attempt 1', () => {
    fc.assert(
      fc.property(backoffConfigArb, attemptArb, (cfg, attempt) => {
        const base = computeBaseDelay(cfg, attempt);
        // Base is always capped at maxDelayMs (R3.2).
        expect(base).toBeLessThanOrEqual(cfg.maxDelayMs);
        // Base is non-negative.
        expect(base).toBeGreaterThanOrEqual(0);
        // The uncapped exponential value; the cap must never exceed it.
        const raw = cfg.baseDelayMs * Math.pow(cfg.factor, attempt - 1);
        expect(base).toBeLessThanOrEqual(raw + 1e-9);
        // When the raw value fits under the ceiling, no capping occurs.
        if (raw <= cfg.maxDelayMs) {
          expect(base).toBeCloseTo(raw, 6);
        } else {
          expect(base).toBe(cfg.maxDelayMs);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is monotonically non-decreasing in attempt (before the cap flattens it)', () => {
    fc.assert(
      fc.property(backoffConfigArb, attemptArb, (cfg, attempt) => {
        const here = computeBaseDelay(cfg, attempt);
        const next = computeBaseDelay(cfg, attempt + 1);
        expect(next).toBeGreaterThanOrEqual(here - 1e-9);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('jitters the capped base into the equal-jitter band [base*floor, base) when no Retry-After applies', () => {
    fc.assert(
      fc.property(backoffConfigArb, attemptArb, jitterArb, (cfg, attempt, jitter) => {
        const base = computeBaseDelay(cfg, attempt);
        const delay = computeBackoffDelay(cfg, { attempt, jitter });
        // Lower edge of the band, inclusive (R3.2).
        expect(delay).toBeGreaterThanOrEqual(base * JITTER_FLOOR_RATIO - 1e-9);
        // Upper edge of the band, exclusive: with jitter < 1 the delay stays
        // strictly below the base.
        expect(delay).toBeLessThan(base + 1e-9);
        // Never negative.
        expect(delay).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('treats Retry-After as a floor: the delay is never shorter than the parsed header', () => {
    fc.assert(
      fc.property(
        backoffConfigArb,
        attemptArb,
        jitterArb,
        fc.integer({ min: 0, max: 300_000 }),
        (cfg, attempt, jitter, retryAfterMs) => {
          const delay = computeBackoffDelay(cfg, { attempt, jitter, retryAfterMs });
          // Retry-After acts as a lower bound (R3.4).
          expect(delay).toBeGreaterThanOrEqual(retryAfterMs - 1e-9);
          // And it never drops below the jittered value either.
          const jittered = computeBackoffDelay(cfg, { attempt, jitter });
          expect(delay).toBeGreaterThanOrEqual(Math.min(jittered, retryAfterMs) - 1e-9);
          expect(delay).toBe(Math.max(jittered, retryAfterMs));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('builds a schedule bounded by maxRetries in length and maxTotalDelayMs in sum', () => {
    fc.assert(
      fc.property(
        backoffConfigArb,
        fc.array(
          fc.record({
            jitter: jitterArb,
            retryAfterMs: fc.option(fc.integer({ min: 0, max: 120_000 }), {
              nil: undefined,
            }),
          }),
          { minLength: 0, maxLength: 25 },
        ),
        (cfg, rawInputs) => {
          const inputs: BackoffScheduleInput[] = rawInputs.map((r) =>
            r.retryAfterMs !== undefined
              ? { jitter: r.jitter, retryAfterMs: r.retryAfterMs }
              : { jitter: r.jitter },
          );
          const schedule = computeBackoffSchedule(cfg, inputs);

          // Length never exceeds maxRetries and never exceeds the input count (R3.3).
          expect(schedule.length).toBeLessThanOrEqual(Math.max(0, Math.trunc(cfg.maxRetries)));
          expect(schedule.length).toBeLessThanOrEqual(inputs.length);

          // Cumulative delay never exceeds the total cap (R3.6).
          const total = schedule.reduce((acc, d) => acc + d, 0);
          expect(total).toBeLessThanOrEqual(cfg.maxTotalDelayMs + 1e-9);

          // Each scheduled delay matches the per-attempt computation for its
          // 1-based position.
          for (let i = 0; i < schedule.length; i += 1) {
            const input = inputs[i]!;
            const expected =
              input.retryAfterMs !== undefined
                ? computeBackoffDelay(cfg, {
                    attempt: i + 1,
                    jitter: input.jitter,
                    retryAfterMs: input.retryAfterMs,
                  })
                : computeBackoffDelay(cfg, { attempt: i + 1, jitter: input.jitter });
            expect(schedule[i]).toBe(expected);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('stops the schedule as soon as adding the next delay would exceed maxTotalDelayMs', () => {
    fc.assert(
      fc.property(
        backoffConfigArb,
        fc.array(jitterArb, { minLength: 1, maxLength: 25 }),
        (cfg, jitters) => {
          const inputs: BackoffScheduleInput[] = jitters.map((jitter) => ({ jitter }));
          const schedule = computeBackoffSchedule(cfg, inputs);
          const total = schedule.reduce((acc, d) => acc + d, 0);

          // If the schedule stopped early (before maxRetries and before
          // consuming all inputs), the next delay must have overflowed the cap.
          const limit = Math.min(inputs.length, Math.max(0, Math.trunc(cfg.maxRetries)));
          if (schedule.length < limit) {
            const nextIndex = schedule.length;
            const nextDelay = computeBackoffDelay(cfg, {
              attempt: nextIndex + 1,
              jitter: inputs[nextIndex]!.jitter,
            });
            expect(total + nextDelay).toBeGreaterThan(cfg.maxTotalDelayMs);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('backoff — parseRetryAfter (Retry-After floor source, R3.4)', () => {
  it('parses delta-seconds into milliseconds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        (seconds, now) => {
          expect(parseRetryAfter(String(seconds), now)).toBe(seconds * 1000);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('parses an HTTP-date into a non-negative delay relative to now', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        fc.integer({ min: -500_000, max: 500_000 }),
        (now, offsetMs) => {
          // Round to whole seconds because HTTP-date has 1-second resolution.
          const target = Math.floor((now + offsetMs) / 1000) * 1000;
          const header = new Date(target).toUTCString();
          const result = parseRetryAfter(header, now);
          expect(result).toBe(Math.max(0, target - now));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns undefined for absent, blank, or unparseable values', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<string | null | undefined>(null, undefined, '', '   ', 'not-a-date', 'soon'),
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        (value, now) => {
          expect(parseRetryAfter(value, now)).toBeUndefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
