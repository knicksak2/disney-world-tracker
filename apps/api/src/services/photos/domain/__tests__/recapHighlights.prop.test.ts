import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { selectRecapHighlights, type RecapHighlightPhoto } from '../recapHighlights.js';
import { wdwToday } from '../../../trips/wdwClock.js';

function oracleRecapHighlights<T extends RecapHighlightPhoto>(photos: ReadonlyArray<T>, max: number): T[] {
  if (photos.length === 0 || max <= 0) return [];

  // Sort everything by (sortAt, id) ascending
  const sorted = [...photos].sort((a, b) => {
    const diff = a.sortAt.getTime() - b.sortAt.getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  // Keep first photo seen per day
  const seenDays = new Set<string>();
  const firstPerDay: T[] = [];
  for (const p of sorted) {
    const day = wdwToday(p.sortAt);
    if (!seenDays.has(day)) {
      seenDays.add(day);
      firstPerDay.push(p);
    }
  }

  // Sort by day ascending
  firstPerDay.sort((a, b) => wdwToday(a.sortAt).localeCompare(wdwToday(b.sortAt)));

  // Slice max
  return firstPerDay.slice(0, max);
}

const photoArb = fc.record({
  id: fc.uuid(),
  sortAt: fc.date({ min: new Date('2024-01-01T00:00:00Z'), max: new Date('2026-12-31T23:59:59Z') }),
});

describe('recapHighlights properties', () => {
  // Feature: photo-uploads, Property 38: Recap highlights
  it('Property 38: Recap highlights matches oracle, ensures at most 1 per day, chronological order, and input immutability', () => {
    fc.assert(
      fc.property(
        fc.array(photoArb, { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 1, max: 24 }),
        (photos, max) => {
          // Freeze input to guarantee immutability
          const frozen = photos.map((p) => Object.freeze({ ...p }));
          Object.freeze(frozen);

          const actual = selectRecapHighlights(frozen, max);
          const oracle = oracleRecapHighlights(frozen, max);

          expect(actual).toEqual(oracle);

          // Invariant (a): at most one photo per America/New_York day
          const days = actual.map((p) => wdwToday(p.sortAt));
          expect(new Set(days).size).toBe(actual.length);

          // Invariant (b): each day's pick has min (sortAt, id) for that day
          for (const picked of actual) {
            const pickedDay = wdwToday(picked.sortAt);
            const candidates = frozen.filter((p) => wdwToday(p.sortAt) === pickedDay);
            for (const cand of candidates) {
              const candEarlier =
                cand.sortAt.getTime() < picked.sortAt.getTime() ||
                (cand.sortAt.getTime() === picked.sortAt.getTime() && cand.id < picked.id);
              expect(candEarlier).toBe(false);
            }
          }

          // Invariant (c): ascending day order
          for (let i = 1; i < days.length; i++) {
            const current = days[i];
            const prev = days[i - 1];
            if (current !== undefined && prev !== undefined) {
              expect(current.localeCompare(prev)).toBeGreaterThan(0);
            }
          }

          // Invariant (d): length min(max, distinct days)
          const allDistinctDays = new Set(frozen.map((p) => wdwToday(p.sortAt))).size;
          expect(actual.length).toBe(Math.min(max, allDistinctDays));

          // Invariant (e): permutation invariance
          if (photos.length > 1) {
            const shuffled = [...frozen].reverse();
            const actualShuffled = selectRecapHighlights(shuffled, max);
            expect(actualShuffled).toEqual(actual);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('recapHighlights examples', () => {
  it('four photos on one day yield the earliest only', () => {
    const p1 = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', sortAt: new Date('2025-06-10T14:00:00Z') };
    const p2 = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', sortAt: new Date('2025-06-10T12:00:00Z') }; // earliest
    const p3 = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', sortAt: new Date('2025-06-10T16:00:00Z') };
    const p4 = { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', sortAt: new Date('2025-06-10T18:00:00Z') };

    const result = selectRecapHighlights([p1, p2, p3, p4], 6);
    expect(result).toEqual([p2]);
  });

  it('photos at 23:59 and 00:01 New York time fall on different days', () => {
    // In June, New York is EDT (UTC-4)
    // 23:59 EDT on June 10 is 03:59 UTC on June 11
    // 00:01 EDT on June 11 is 04:01 UTC on June 11
    const pNight = { id: '11111111-1111-1111-1111-111111111111', sortAt: new Date('2025-06-11T03:59:00Z') };
    const pMorning = { id: '22222222-2222-2222-2222-222222222222', sortAt: new Date('2025-06-11T04:01:00Z') };

    expect(wdwToday(pNight.sortAt)).toBe('2025-06-10');
    expect(wdwToday(pMorning.sortAt)).toBe('2025-06-11');

    const result = selectRecapHighlights([pMorning, pNight], 6);
    expect(result).toEqual([pNight, pMorning]);
  });

  it('UTC instant of 03:30 on the 2nd that is 23:30 on the 1st in New York is grouped under the 1st', () => {
    // 2025-06-02T03:30:00Z is 2025-06-01T23:30:00 EDT
    const p = { id: '33333333-3333-3333-3333-333333333333', sortAt: new Date('2025-06-02T03:30:00Z') };
    expect(wdwToday(p.sortAt)).toBe('2025-06-01');

    const result = selectRecapHighlights([p], 6);
    expect(result).toEqual([p]);
  });

  it('handles daylight-saving transition day correctly', () => {
    // Fall back: 2025-11-02 in America/New_York
    const p1 = { id: '44444444-4444-4444-4444-444444444444', sortAt: new Date('2025-11-02T05:00:00Z') }; // 01:00 EDT
    const p2 = { id: '55555555-5555-5555-5555-555555555555', sortAt: new Date('2025-11-02T07:00:00Z') }; // 02:00 EST
    expect(wdwToday(p1.sortAt)).toBe('2025-11-02');
    expect(wdwToday(p2.sortAt)).toBe('2025-11-02');

    const result = selectRecapHighlights([p2, p1], 6);
    expect(result).toEqual([p1]);
  });

  it('seven days with max 6 returns the first six days', () => {
    const photos: RecapHighlightPhoto[] = [];
    for (let day = 1; day <= 7; day++) {
      photos.push({
        id: `00000000-0000-0000-0000-00000000000${day}`,
        sortAt: new Date(`2025-06-0${day}T12:00:00Z`),
      });
    }
    const result = selectRecapHighlights(photos, 6);
    expect(result.length).toBe(6);
    expect(result.map((p) => wdwToday(p.sortAt))).toEqual([
      '2025-06-01',
      '2025-06-02',
      '2025-06-03',
      '2025-06-04',
      '2025-06-05',
      '2025-06-06',
    ]);
  });

  it('max 1 returns earliest day earliest photo', () => {
    const p1 = { id: '11111111-1111-1111-1111-111111111111', sortAt: new Date('2025-06-01T15:00:00Z') };
    const p2 = { id: '22222222-2222-2222-2222-222222222222', sortAt: new Date('2025-06-01T10:00:00Z') };
    const p3 = { id: '33333333-3333-3333-3333-333333333333', sortAt: new Date('2025-06-02T08:00:00Z') };

    const result = selectRecapHighlights([p1, p2, p3], 1);
    expect(result).toEqual([p2]);
  });

  it('two photos with identical sortAt pick smaller id', () => {
    const p1 = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', sortAt: new Date('2025-06-01T12:00:00Z') };
    const p2 = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', sortAt: new Date('2025-06-01T12:00:00Z') };

    const result = selectRecapHighlights([p1, p2], 6);
    expect(result).toEqual([p2]);
  });

  it('bulk upload case (defect D29 closes): 8 photos with distinct sortAt days in one upload produce highlights per day', () => {
    const photos: RecapHighlightPhoto[] = [];
    for (let day = 1; day <= 8; day++) {
      photos.push({
        id: `10000000-0000-0000-0000-00000000000${day}`,
        sortAt: new Date(`2025-06-1${day}T14:00:00Z`), // capture day
      });
    }
    const result = selectRecapHighlights(photos, 6);
    expect(result.length).toBe(6);
    expect(result.map((p) => wdwToday(p.sortAt))).toEqual([
      '2025-06-11',
      '2025-06-12',
      '2025-06-13',
      '2025-06-14',
      '2025-06-15',
      '2025-06-16',
    ]);
  });
});
