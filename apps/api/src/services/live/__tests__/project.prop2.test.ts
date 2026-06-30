/**
 * Property-based test for `projectLiveDetail` — Property 2.
 *
 * Kept in its own file (one property per file) so concurrent authoring of the
 * sibling projection properties never clobbers a shared file.
 *
 *   - Property 2: Operating_Status is a total mapping
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { projectLiveDetail, type ProjectionContext, WDW_TIME_ZONE } from '../project.js';
import type { ThemeParksLiveEntry } from '../themeparksLive.js';

const NUM_RUNS = 100;

/** A fixed projection context; the current day is irrelevant to status mapping. */
const CTX: ProjectionContext = {
  parkTimeZone: WDW_TIME_ZONE,
  now: new Date('2024-06-15T18:00:00.000Z'),
};

/** The five allowed Operating_Status values (R1.3, R1.4). */
const ALLOWED_STATUSES = ['Operating', 'Closed', 'Down', 'Refurbishment', 'Unknown'] as const;

/**
 * The recognized upstream status tokens and the enum member each maps to
 * (R1.3). Matching is case-insensitive, so any case variant of these tokens
 * must resolve to the same member.
 */
const RECOGNIZED: Readonly<Record<string, (typeof ALLOWED_STATUSES)[number]>> = {
  OPERATING: 'Operating',
  CLOSED: 'Closed',
  DOWN: 'Down',
  REFURBISHMENT: 'Refurbishment',
};

/**
 * Oracle mirroring the projection's status rule (R1.3, R1.4): a recognized
 * token (case-insensitive) maps to its enum member; everything else —
 * unrecognized tokens and a missing status — maps to `Unknown`.
 */
function expectedStatus(raw: string | undefined): (typeof ALLOWED_STATUSES)[number] {
  if (typeof raw !== 'string') {
    return 'Unknown';
  }
  return RECOGNIZED[raw.toUpperCase()] ?? 'Unknown';
}

/** Randomly re-case a token so the case-insensitivity branch is exercised. */
function randomCase(token: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: token.length, maxLength: token.length })
    .map((flags) =>
      token
        .split('')
        .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
        .join(''),
    );
}

// ---------------------------------------------------------------------------
// Status-candidate generator: covers recognized (any case), unrecognized,
// and missing forms across the whole input space.
// ---------------------------------------------------------------------------

const recognizedToken: fc.Arbitrary<string> = fc
  .constantFrom(...Object.keys(RECOGNIZED))
  .chain(randomCase);

const statusCandidate: fc.Arbitrary<string | undefined> = fc.oneof(
  // Recognized tokens in arbitrary case (the keep case).
  recognizedToken,
  // Arbitrary strings — almost always unrecognized → Unknown.
  fc.string(),
  // Plausible-but-unrecognized tokens.
  fc.constantFrom('OPEN', 'UNKNOWN', 'BROKEN', 'OPERATIONAL', 'CLOSE', 'DOWNED', ''),
  // Missing status.
  fc.constant(undefined),
);

// ===========================================================================
// Property 2: Operating_Status is a total mapping
// ===========================================================================
// Feature: experience-live-details, Property 2: Operating_Status is a total mapping
//
// Validates: Requirements 1.3, 1.4
//
// For any upstream status value, the projected status equals the matching enum
// member for recognized tokens (OPERATING/CLOSED/DOWN/REFURBISHMENT,
// case-insensitive) and is Unknown for every unrecognized or missing value;
// and the projected status is always one of the five allowed values (totality).

describe('projectLiveDetail — Property 2: Operating_Status is a total mapping', () => {
  it('projects every upstream status to the oracle value and never escapes the allowed set', () => {
    fc.assert(
      fc.property(statusCandidate, (rawStatus) => {
        const entry: ThemeParksLiveEntry =
          rawStatus === undefined ? {} : { status: rawStatus };
        const detail = projectLiveDetail(entry, CTX);

        // Totality: the projected status is always one of the five members.
        expect(ALLOWED_STATUSES).toContain(detail.status);
        // The mapping matches the oracle for recognized / unrecognized / missing.
        expect(detail.status).toBe(expectedStatus(rawStatus));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('maps each recognized token to its enum member regardless of case (R1.3)', () => {
    fc.assert(
      fc.property(recognizedToken, (token) => {
        const detail = projectLiveDetail({ status: token }, CTX);
        expect(detail.status).toBe(RECOGNIZED[token.toUpperCase()]);
        expect(detail.status).not.toBe('Unknown');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('maps any unrecognized or missing status to Unknown (R1.4)', () => {
    const unrecognized: fc.Arbitrary<string | undefined> = fc.oneof(
      fc.string().filter((s) => !(s.toUpperCase() in RECOGNIZED)),
      fc.constant(undefined),
    );
    fc.assert(
      fc.property(unrecognized, (rawStatus) => {
        const entry: ThemeParksLiveEntry =
          rawStatus === undefined ? {} : { status: rawStatus };
        const detail = projectLiveDetail(entry, CTX);
        expect(detail.status).toBe('Unknown');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
