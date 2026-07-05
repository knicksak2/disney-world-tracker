// Feature: experience-detail-redesign, Property 5: For any string value,
// `relabelTagValue` returns the mapped human-friendly label when the value
// (whitespace-trimmed, case-sensitive) matches a key in the accessibility label
// map; otherwise it returns the value with every hyphen and underscore replaced
// by a single space, consecutive separators collapsed to a single space, and no
// leading or trailing whitespace.
//
// Validates: Requirements 2.1, 2.3
//
// This suite targets the framework-free `relabelTagValue` fold in `infoTags.ts`
// and follows the existing `infoTags.prop.test.ts` conventions: `fast-check`
// generators that deliberately span the interesting input space (mapped keys,
// unmapped hyphen/underscore slugs, surrounding and interior whitespace, and
// runs of consecutive separators) and a single property-based test asserted at
// `numRuns: 100`.

import fc from 'fast-check';

import { ACCESSIBILITY_LABELS, relabelTagValue } from '../infoTags';

const NUM_RUNS = 100;

// The map's keys, used to build inputs that must resolve to a mapped label even
// when padded with surrounding whitespace (R2.1). Includes the canonical
// `no-service-animals` slug (R2.2).
const MAP_KEYS = Object.keys(ACCESSIBILITY_LABELS);

// ---------------------------------------------------------------------------
// Oracle — an independent restatement of R2.3's humanisation rule as a
// character-by-character state machine (deliberately NOT the regex the
// implementation uses). Every run of `-`/`_` collapses to exactly one space;
// interior whitespace from the original value is preserved; the result is
// trimmed. Mapped keys (after trimming) short-circuit to their label (R2.1).
// ---------------------------------------------------------------------------
function expectedRelabel(value: string): string {
  const trimmed = value.trim();
  if (Object.prototype.hasOwnProperty.call(ACCESSIBILITY_LABELS, trimmed)) {
    return ACCESSIBILITY_LABELS[trimmed]!;
  }

  let out = '';
  let inSeparatorRun = false;
  for (const ch of trimmed) {
    if (ch === '-' || ch === '_') {
      if (!inSeparatorRun) {
        out += ' ';
      }
      inSeparatorRun = true;
    } else {
      out += ch;
      inSeparatorRun = false;
    }
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// Generators — span the four interesting families called out by the task.
// ---------------------------------------------------------------------------

// Whitespace fragments used to pad values (must be stripped before lookup and
// from the final result).
const whitespaceArb = fc.constantFrom('', ' ', '  ', '\t', ' \n ', '\t \t');

// A mapped key wrapped in arbitrary surrounding whitespace: must still resolve
// to the mapped human-friendly label (R2.1, R2.2).
const mappedKeyArb = fc
  .tuple(whitespaceArb, fc.constantFrom(...MAP_KEYS), whitespaceArb)
  .map(([lead, key, trail]) => `${lead}${key}${trail}`);

// Slug word tokens (no separators / whitespace of their own).
const tokenArb = fc.constantFrom(
  'wheelchair',
  'accessible',
  'asl',
  'ride',
  'intensity',
  'high',
  'stroller',
  'friendly',
  'transfer',
  'required',
);

// A run of one-or-more separators, possibly mixing hyphens and underscores, so
// "consecutive separators collapse to a single space" is genuinely exercised.
const separatorRunArb = fc.constantFrom(
  '-',
  '_',
  '--',
  '__',
  '-_',
  '_-',
  '---',
  '___',
  '-_-',
);

// An unmapped slug: tokens joined by separator runs, optionally with leading /
// trailing separator runs (which must be trimmed away).
const slugArb = fc
  .tuple(
    separatorRunArb, // optional leading separators
    fc.array(fc.tuple(tokenArb, separatorRunArb), {
      minLength: 1,
      maxLength: 5,
    }),
    fc.boolean(), // whether to keep a trailing separator run
  )
  .map(([lead, pairs, keepTrailing]) => {
    const body = pairs
      .map(([token, sep], i) => (i === pairs.length - 1 && !keepTrailing ? token : `${token}${sep}`))
      .join('');
    return `${lead}${body}`;
  });

// Free-form strings assembled from letters, digits, spaces, and separators so
// arbitrary whitespace/separator interleavings (and the occasional accidental
// map-key collision) are covered too.
const slugCharArb = fc.stringOf(
  fc.constantFrom('a', 'b', 'z', '1', ' ', '  ', '-', '_', '--', '__'),
  { maxLength: 24 },
);

const valueArb = fc.oneof(
  { weight: 3, arbitrary: mappedKeyArb },
  { weight: 4, arbitrary: slugArb },
  { weight: 2, arbitrary: slugCharArb },
  { weight: 1, arbitrary: fc.string() },
);

// ---------------------------------------------------------------------------
// Property 5 — Relabeling
// ---------------------------------------------------------------------------

describe('Property 5: relabelTagValue maps known slugs and humanises the rest', () => {
  it('returns the mapped label for known keys and a trimmed, separator-collapsed value otherwise', () => {
    // Concrete R2.2 anchor: the canonical slug renders as the mapped label.
    expect(relabelTagValue('no-service-animals')).toBe(
      'Service animals not permitted',
    );

    fc.assert(
      fc.property(valueArb, (value) => {
        const result = relabelTagValue(value);
        const trimmed = value.trim();
        const isMapped = Object.prototype.hasOwnProperty.call(
          ACCESSIBILITY_LABELS,
          trimmed,
        );

        // The result always matches the independent oracle (R2.1 + R2.3).
        expect(result).toBe(expectedRelabel(value));

        if (isMapped) {
          // R2.1 / R2.2 — an exact, whitespace-trimmed, case-sensitive key hit
          // yields the mapped human-friendly label verbatim.
          expect(result).toBe(ACCESSIBILITY_LABELS[trimmed]);
        } else {
          // R2.3 — a miss humanises the trimmed value:
          //  * no hyphen or underscore separator survives;
          expect(result).not.toMatch(/[-_]/);
          //  * no leading or trailing whitespace;
          expect(result).toBe(result.trim());
          //  * every separator run collapsed to a single space, so the output
          //    never contains a run of separators (already guaranteed) nor a
          //    space introduced by a separator adjacent to another separator.
          //    Verify idempotence: relabelling the humanised value is a no-op
          //    once it carries no separators.
          expect(relabelTagValue(result)).toBe(result);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
