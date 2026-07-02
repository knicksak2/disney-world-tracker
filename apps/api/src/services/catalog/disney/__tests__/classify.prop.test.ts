// Feature: disney-source-resilience, Property 5: WAF vs Auth classification
/**
 * Property test for `classifyDisneyResponse` (design.md → Property 5).
 *
 * Property 5: WAF vs Auth classification.
 *
 * *For any* status/body, a WAF-marked `403`/`429` is classified as a
 * `waf_block` that is retriable (R4.1), while a `401` or a `403` without a WAF
 * marker is classified as an `auth_failure` that is non-retriable (R4.3); and
 * the WAF `kind` is never equal to the auth `kind`, so an Akamai edge block
 * (transient) can always be told apart from a credential failure (fatal)
 * (R4.5).
 *
 * The oracle is independent of the implementation: WAF bodies are constructed
 * by deliberately embedding a known Akamai/edge marker among keyword-free
 * filler, and "clean" bodies are generated and then filtered to guarantee they
 * contain none of the markers (case-insensitive). Expected classifications
 * therefore follow from the *kind* of body constructed, never by re-running the
 * production substring check.
 *
 * **Validates: Requirements 4.1, 4.3, 4.5**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DISNEY_TARGETS } from '@dwt/shared';
import type { DisneyTarget } from '@dwt/shared';

import {
  classifyDisneyResponse,
  DISNEY_WAF_BODY_MARKERS,
} from '../classify.js';

/** Spec convention: every `fc.assert` runs with at least 100 iterations. */
const NUM_RUNS = 200;

/** The two statuses that can carry a WAF_Block (R4.1). */
const WAF_ELIGIBLE_STATUSES = [403, 429] as const;

/** Any Disney request target selects the same classification rules. */
const targetArb: fc.Arbitrary<DisneyTarget> = fc.constantFrom(
  ...DISNEY_TARGETS,
);

// ---------------------------------------------------------------------------
// Body generators.
// ---------------------------------------------------------------------------

/** True when `body` contains any WAF marker (case-insensitive) — the oracle. */
function containsMarker(body: string): boolean {
  const haystack = body.toLowerCase();
  return DISNEY_WAF_BODY_MARKERS.some((marker) => haystack.includes(marker));
}

/**
 * Randomly re-case a string so the WAF match must be case-insensitive (R4.1).
 */
function mixedCaseArb(text: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: text.length, maxLength: text.length })
    .map((flags) =>
      text
        .split('')
        .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
        .join(''),
    );
}

/** Keyword-free filler that can never accidentally contain a WAF marker. */
const safeFillerArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      'the',
      'server',
      'returned',
      'a',
      'json',
      'error',
      'payload',
      'here',
      'unauthorized',
      'forbidden',
      'request',
    ),
    { minLength: 0, maxLength: 5 },
  )
  .map((words) => words.join(' '))
  // Defensive: none of these words form a marker, but guard anyway.
  .filter((s) => !containsMarker(s));

/** A body that definitely contains a WAF/edge marker in mixed case. */
const wafBodyArb: fc.Arbitrary<string> = fc
  .constantFrom(...DISNEY_WAF_BODY_MARKERS)
  .chain((marker) => mixedCaseArb(marker))
  .chain((marker) =>
    fc
      .tuple(safeFillerArb, safeFillerArb)
      .map(([before, after]) => `${before} ${marker} ${after}`),
  )
  // The re-cased marker must still be detectable case-insensitively.
  .filter((s) => containsMarker(s));

/**
 * A body that contains no WAF marker. Includes the empty string, structured
 * JSON error bodies, and arbitrary strings filtered to exclude every marker.
 */
const cleanBodyArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.constant(''),
    fc.constant('{"error":"invalid_credentials"}'),
    fc.constant('{"reason":"token expired"}'),
    safeFillerArb,
    fc.string(),
  )
  .filter((s) => !containsMarker(s));

// ---------------------------------------------------------------------------
// Property 5.
// ---------------------------------------------------------------------------

describe('classifyDisneyResponse — Property 5: WAF vs Auth classification', () => {
  it('classifies a WAF-marked 403/429 as a retriable waf_block (R4.1)', () => {
    fc.assert(
      fc.property(
        targetArb,
        fc.constantFrom(...WAF_ELIGIBLE_STATUSES),
        wafBodyArb,
        (target, status, body) => {
          const result = classifyDisneyResponse({ target, status, body });
          expect(result).not.toBeNull();
          expect(result?.kind).toBe('waf_block');
          expect(result?.retriable).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('classifies a 401 (any body) as a non-retriable auth_failure (R4.3)', () => {
    fc.assert(
      fc.property(
        targetArb,
        // Even a WAF-marked body cannot turn a 401 into a waf_block.
        fc.oneof(cleanBodyArb, wafBodyArb),
        (target, body) => {
          const result = classifyDisneyResponse({ target, status: 401, body });
          expect(result?.kind).toBe('auth_failure');
          expect(result?.retriable).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('classifies a 403 without a WAF marker as a non-retriable auth_failure (R4.3)', () => {
    fc.assert(
      fc.property(targetArb, cleanBodyArb, (target, body) => {
        const result = classifyDisneyResponse({ target, status: 403, body });
        expect(result?.kind).toBe('auth_failure');
        expect(result?.retriable).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never assigns the same kind to a WAF block and an auth failure (R4.5)', () => {
    fc.assert(
      fc.property(
        targetArb,
        fc.constantFrom(...WAF_ELIGIBLE_STATUSES),
        wafBodyArb,
        cleanBodyArb,
        (target, wafStatus, wafBody, cleanBody) => {
          const waf = classifyDisneyResponse({
            target,
            status: wafStatus,
            body: wafBody,
          });
          // A 401 is always an auth failure regardless of body.
          const auth = classifyDisneyResponse({
            target,
            status: 401,
            body: cleanBody,
          });
          // A non-WAF 403 is also an auth failure.
          const auth403 = classifyDisneyResponse({
            target,
            status: 403,
            body: cleanBody,
          });

          expect(waf?.kind).toBe('waf_block');
          expect(auth?.kind).toBe('auth_failure');
          expect(auth403?.kind).toBe('auth_failure');
          // The WAF kind is disjoint from the auth kind (R4.5).
          expect(waf?.kind).not.toBe(auth?.kind);
          expect(waf?.kind).not.toBe(auth403?.kind);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
