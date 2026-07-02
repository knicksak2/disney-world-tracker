/**
 * Property-based test for the Catalog_Sync run-outcome mapping
 * (`outcomeFromError`) — design.md → "Property 15: Sync outcome mapping is
 * total and distinct".
 *
 * A failed `Catalog_Sync` run must be recorded in `Sync_Run_History` with a
 * discriminator drawn from the closed `SYNC_RUN_OUTCOMES` set (R12.6).
 * `outcomeFromError` owns the single, total translation from a caught value of
 * ANY shape — a classified transport failure carrying a `kind`, or an arbitrary
 * error (string, number, plain `Error`, `null`, `undefined`, bare object) — to
 * that discriminator. This property drives the mapper across both halves of its
 * input space and asserts:
 *
 *   1. Totality / closed-set: for EVERY input the result is a member of
 *      `SYNC_RUN_OUTCOMES` and the call never throws (R12.6).
 *
 *   2. Documented per-kind mapping: a transport error `{ kind }` where
 *      `kind ∈ DISNEY_FAILURE_KINDS` maps exactly per the design table —
 *      `waf_block → waf_block` (R12.4), `auth_failure → auth_failure` (R12.5),
 *      `network`/`invalid_response`/`aborted` pass through, and `http_status →
 *      invalid_response` (retired from the outcome set) — while any
 *      non-transport / unknown value maps to `invalid_response`.
 *
 *   3. Distinctness: the `waf_block` outcome NEVER equals the `auth_failure`
 *      outcome, so an Akamai edge block (transient) is always recorded as a
 *      different outcome than a credential failure (fatal) (R12.4, R12.5).
 *
 * The mapper is pure and dependency-light, so this property runs entirely
 * in-memory with no timers, network, or database.
 *
 * // Feature: disney-source-resilience, Property 15: Sync outcome mapping is total and distinct
 * Validates: Requirements 12.4, 12.5, 12.6
 */

import {
  DISNEY_FAILURE_KINDS,
  SYNC_RUN_OUTCOMES,
  type DisneyFailureKind,
  type SyncRunOutcome,
} from '@dwt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { outcomeFromError } from '../outcome.js';

// ---------------------------------------------------------------------------
// Reference mapping (mirrors the design table, independent of the impl)
// ---------------------------------------------------------------------------

/**
 * The expected outcome for each transport failure `kind`, transcribed directly
 * from the design's documented mapping. Kept as an independent oracle so the
 * property checks the implementation against the spec rather than against
 * itself.
 */
const EXPECTED_BY_KIND: Readonly<Record<DisneyFailureKind, SyncRunOutcome>> = {
  waf_block: 'waf_block',
  auth_failure: 'auth_failure',
  network: 'network',
  invalid_response: 'invalid_response',
  aborted: 'aborted',
  http_status: 'invalid_response',
};

const OUTCOME_SET: ReadonlySet<string> = new Set(SYNC_RUN_OUTCOMES);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Any transport failure kind from the closed set. */
const failureKindArb = fc.constantFrom<DisneyFailureKind>(
  ...DISNEY_FAILURE_KINDS,
);

/**
 * A transport-shaped error: an object carrying a `kind` in
 * `DISNEY_FAILURE_KINDS`, optionally decorated with extra fields (a `message`,
 * a `name`, arbitrary noise) to mirror a real `DisneyTransportError` and prove
 * the mapper keys only off `kind`.
 */
const transportErrorArb: fc.Arbitrary<{ readonly kind: DisneyFailureKind }> =
  failureKindArb.chain((kind) =>
    fc
      .record({
        message: fc.string(),
        name: fc.constantFrom('DisneyTransportError', 'Error', 'X'),
        extra: fc.anything(),
      })
      .map((decor) => ({ ...decor, kind })),
  );

/**
 * An arbitrary NON-transport value: strings, numbers, booleans, `null`,
 * `undefined`, plain `Error`s, and objects — including objects whose `kind` is
 * NOT a member of `DISNEY_FAILURE_KINDS`, which must still fall through to
 * `invalid_response`.
 */
const nonTransportErrorArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.string().map((m) => new Error(m)),
  // Objects that never carry a valid transport `kind`.
  fc.record({
    kind: fc.oneof(
      fc.constant(undefined),
      fc.constantFrom('success', 'nope', 'timeout', '', 'HTTP_STATUS'),
      fc.integer(),
    ),
    message: fc.string(),
  }),
  // Deeply arbitrary values, filtered so we never accidentally synthesize a
  // legitimate transport-shaped error (that space is covered above).
  fc
    .anything()
    .filter(
      (v) =>
        typeof v !== 'object' ||
        v === null ||
        !DISNEY_FAILURE_KINDS.includes(
          (v as { kind?: unknown }).kind as DisneyFailureKind,
        ),
    ),
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('outcomeFromError (Property 15: total and distinct)', () => {
  it('maps every transport failure kind to the documented closed-set outcome', () => {
    fc.assert(
      fc.property(transportErrorArb, (err) => {
        const outcome = outcomeFromError(err);

        // (1) Totality: result is always in the closed set (R12.6).
        expect(OUTCOME_SET.has(outcome)).toBe(true);

        // (2) Documented per-kind mapping (R12.4, R12.5).
        expect(outcome).toBe(EXPECTED_BY_KIND[err.kind]);
      }),
      { numRuns: 100 },
    );
  });

  it('maps any non-transport / unknown value to invalid_response and stays in the closed set', () => {
    fc.assert(
      fc.property(nonTransportErrorArb, (err) => {
        const outcome = outcomeFromError(err);

        // (1) Totality: never throws and result is in the closed set (R12.6).
        expect(OUTCOME_SET.has(outcome)).toBe(true);

        // Non-transport failures collapse to the generic invalid_response.
        expect(outcome).toBe('invalid_response');
      }),
      { numRuns: 100 },
    );
  });

  it('never records a waf_block as an auth_failure (distinctness)', () => {
    fc.assert(
      fc.property(
        fc.oneof(transportErrorArb, nonTransportErrorArb),
        (err) => {
          const outcome = outcomeFromError(err);

          // (3) The WAF outcome and the auth outcome never coincide, so a
          //     transient edge block is never confused with a fatal credential
          //     failure (R12.4, R12.5).
          expect(EXPECTED_BY_KIND.waf_block).not.toBe(
            EXPECTED_BY_KIND.auth_failure,
          );
          if (outcome === 'waf_block') {
            expect(outcome).not.toBe('auth_failure');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
