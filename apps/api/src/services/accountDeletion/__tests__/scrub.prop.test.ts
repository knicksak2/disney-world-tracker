import { DELETED_USER_DISPLAY_NAME } from '@dwt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { scrubSharePayload } from '../scrub.js';

const RUNS = { numRuns: 100 };
const REPLACEMENT = 'deadc0de-1111-4222-8333-444455556666';

// Names long enough that a substring check is meaningful (and never 'Deleted user' itself).
const nameArb = fc
  .string({ minLength: 6, maxLength: 30 })
  .filter((s) => s.trim().length >= 6 && s !== DELETED_USER_DISPLAY_NAME && !DELETED_USER_DISPLAY_NAME.includes(s));

const extraArb = fc.dictionary(
  fc.constantFrom('note', 'tripId', 'tripName', 'includePhotos', 'pinIds', 'extra'),
  fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 3 })),
);

const pinShowcaseArb = fc
  .record({ ownerId: fc.uuid(), ownerDisplayName: nameArb, rest: extraArb })
  .map(({ rest, ...core }) => ({ ...rest, kind: 'pinShowcase' as const, ...core }));

const tripSummaryArb = fc
  .record({ sharerDisplayName: nameArb, rest: extraArb })
  .map(({ rest, ...core }) => ({ ...rest, kind: 'tripSummary' as const, ...core }));

const experienceArb = fc.record({
  kind: fc.constant('experience' as const),
  experienceId: fc.uuid(),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  note: fc.string({ maxLength: 40 }),
});

const progressArb = fc.record({
  kind: fc.constant('progress' as const),
  overallPercent: fc.double({ min: 0, max: 100, noNaN: true }),
  perParkPercent: fc.dictionary(fc.constantFrom('EPCOT', 'Magic Kingdom'), fc.double({ min: 0, max: 100, noNaN: true })),
});

const malformedArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
  fc.array(fc.integer()),
  fc.constant({ kind: 'pinShowcase' }), // kind without the fields
  fc.constant({ kind: 'pinShowcase', ownerId: 5, ownerDisplayName: 'x' }),
  fc.constant({ kind: 'tripSummary', sharerDisplayName: null }),
  fc.constant({ kind: 'somethingElse', ownerId: 'x', sharerDisplayName: 'y' }),
  fc.constant({}),
);

describe('scrubSharePayload', () => {
  // Feature: account-deletion, Property 20: JSONB residue is scrubbed, nothing else is changed, and pending senders are projected at read time
  it('Property 20: pinShowcase gets the replacement id and the placeholder name; no other key changes', () => {
    fc.assert(
      fc.property(pinShowcaseArb, fc.uuid(), (payload, replacementId) => {
        const original = structuredClone(payload);
        const out = scrubSharePayload(payload, replacementId) as Record<string, unknown>;
        expect(out.ownerId).toBe(replacementId);
        expect(out.ownerDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
        const { ownerId: _a, ownerDisplayName: _b, ...before } = original;
        const { ownerId: _c, ownerDisplayName: _d, ...after } = out;
        expect(after).toEqual(before);
        expect(payload).toEqual(original); // no mutation
        expect(JSON.stringify(out)).not.toContain(original.ownerId);
        expect(JSON.stringify(out)).not.toContain(original.ownerDisplayName);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 20: JSONB residue is scrubbed, nothing else is changed, and pending senders are projected at read time
  it('Property 20: tripSummary gets the placeholder name; no other key changes', () => {
    fc.assert(
      fc.property(tripSummaryArb, fc.uuid(), (payload, replacementId) => {
        const original = structuredClone(payload);
        const out = scrubSharePayload(payload, replacementId) as Record<string, unknown>;
        expect(out.sharerDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
        const { sharerDisplayName: _a, ...before } = original;
        const { sharerDisplayName: _b, ...after } = out;
        expect(after).toEqual(before);
        expect(payload).toEqual(original);
        expect(JSON.stringify(out)).not.toContain(original.sharerDisplayName);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 20: JSONB residue is scrubbed, nothing else is changed, and pending senders are projected at read time
  it('Property 20: experience, progress and malformed payloads come back as the same reference', () => {
    fc.assert(
      fc.property(fc.oneof(experienceArb, progressArb, malformedArb), fc.uuid(), (payload, replacementId) => {
        expect(scrubSharePayload(payload, replacementId)).toBe(payload);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 20: JSONB residue is scrubbed, nothing else is changed, and pending senders are projected at read time
  it('Property 20: scrubbing is idempotent and a second pass returns the first result by reference', () => {
    fc.assert(
      fc.property(
        fc.oneof(pinShowcaseArb, tripSummaryArb, experienceArb, progressArb, malformedArb),
        fc.uuid(),
        (payload, replacementId) => {
          const once = scrubSharePayload(payload, replacementId);
          const twice = scrubSharePayload(once, replacementId);
          expect(twice).toBe(once);
          expect(twice).toEqual(once);
        },
      ),
      RUNS,
    );
  });

  it('a pinShowcase scrubbed with one tombstone id is re-pointed by a later pass with another id', () => {
    const first = scrubSharePayload(
      { kind: 'pinShowcase', ownerId: 'real', ownerDisplayName: 'Alice Example' },
      REPLACEMENT,
    );
    const second = scrubSharePayload(first, 'deadc0de-9999-4999-8999-999999999999') as Record<string, unknown>;
    expect(second.ownerId).toBe('deadc0de-9999-4999-8999-999999999999');
    expect(second.ownerDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
  });

  it('scrubs all four payload kinds correctly in one table-driven check', () => {
    const cases: [unknown, unknown][] = [
      [
        { kind: 'pinShowcase', ownerId: 'real', ownerDisplayName: 'Alice Example', note: 'n' },
        { kind: 'pinShowcase', ownerId: REPLACEMENT, ownerDisplayName: 'Deleted user', note: 'n' },
      ],
      [
        { kind: 'tripSummary', tripId: 't', tripName: 'Trip', sharerDisplayName: 'Alice Example', includePhotos: true },
        { kind: 'tripSummary', tripId: 't', tripName: 'Trip', sharerDisplayName: 'Deleted user', includePhotos: true },
      ],
      [
        { kind: 'experience', experienceId: 'e', note: 'Alice loved it' },
        { kind: 'experience', experienceId: 'e', note: 'Alice loved it' },
      ],
      [
        { kind: 'progress', overallPercent: 12.5, perParkPercent: {} },
        { kind: 'progress', overallPercent: 12.5, perParkPercent: {} },
      ],
    ];
    for (const [input, expected] of cases) {
      expect(scrubSharePayload(input, REPLACEMENT)).toEqual(expected);
    }
  });
});
