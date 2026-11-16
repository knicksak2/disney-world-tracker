import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkCaps, pruneCutoff, previewMessage } from '../policy.js';

// Feature: in-app-feedback, Property 1: Cap boundary is exact
describe('Property 1: cap boundary is exact', () => {
  it('is limit iff lastHour >= perHour || lastDay >= perDay', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (lastHour, lastDay, perHour, perDay) => {
          const expected = lastHour >= perHour || lastDay >= perDay ? 'limit' : 'ok';
          expect(checkCaps({ lastHour, lastDay }, { perHour, perDay })).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('accepts cap - 1 and refuses cap in each window independently', () => {
    const caps = { perHour: 5, perDay: 20 };
    expect(checkCaps({ lastHour: 4, lastDay: 4 }, caps)).toBe('ok');
    expect(checkCaps({ lastHour: 5, lastDay: 5 }, caps)).toBe('limit');
    expect(checkCaps({ lastHour: 0, lastDay: 19 }, caps)).toBe('ok');
    expect(checkCaps({ lastHour: 0, lastDay: 20 }, caps)).toBe('limit');
  });
});

// Feature: in-app-feedback, Property 7: Prune cutoff arithmetic
describe('Property 7: prune cutoff arithmetic', () => {
  it('equals now minus retentionDays * 86_400_000 ms and is strictly earlier than now', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true }),
        fc.integer({ min: 1, max: 3650 }),
        (now, days) => {
          const cutoff = pruneCutoff(now, days);
          expect(cutoff.getTime()).toBe(now.getTime() - days * 86_400_000);
          expect(cutoff.getTime()).toBeLessThan(now.getTime());
        },
      ),
      { numRuns: 200 },
    );
  });

  it('throws RangeError outside 1..3650 and for non-integers', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    for (const bad of [0, -1, 3651, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pruneCutoff(now, bad), String(bad)).toThrow(RangeError);
    }
    expect(() => pruneCutoff(now, 1)).not.toThrow();
    expect(() => pruneCutoff(now, 3650)).not.toThrow();
  });
});

// Feature: in-app-feedback, Property 10: Preview truncation
describe('Property 10: preview truncation', () => {
  it('returns the message unchanged when it fits, else the first max code points plus an ellipsis', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), fc.integer({ min: 1, max: 70 }), (message, max) => {
        const points = Array.from(message);
        const out = previewMessage(message, max);
        if (points.length <= max) {
          expect(out).toBe(message);
        } else {
          expect(out).toBe(`${points.slice(0, max).join('')}…`);
          // No lone surrogate is produced by the cut.
          expect(Array.from(out.slice(0, -1))).toHaveLength(max);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('does not split an emoji surrogate pair', () => {
    expect(previewMessage('ab😀cd', 3)).toBe('ab😀…');
    expect(previewMessage('ab😀', 3)).toBe('ab😀');
  });

  it('rejects a max below 1', () => {
    expect(() => previewMessage('x', 0)).toThrow(RangeError);
  });
});
