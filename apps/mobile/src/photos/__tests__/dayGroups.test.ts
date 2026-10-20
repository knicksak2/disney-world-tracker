// Feature: photo-uploads, Property 45: recap album pages cover each eligible photo once (client half)
//
// Validates: Requirements 13.8, 15.32, decision D35
// Client half: grouping by America/New_York day never drops, duplicates or reorders a photo
// within its day, and orders the days newest first.

import fc from 'fast-check';

import {
  formatNewYorkDayHeading,
  getNewYorkDayKey,
  groupBySortAtNewYorkDay,
} from '../dayGroups';

describe('getNewYorkDayKey', () => {
  it('puts 2026-05-02T01:30Z under May 1 (UTC would say May 2)', () => {
    expect(getNewYorkDayKey('2026-05-02T01:30:00.000Z')).toBe('2026-05-01');
    expect(getNewYorkDayKey('2026-05-02T01:30:00.000Z')).not.toBe('2026-05-02');
  });

  it('splits the day at local midnight on both sides of the fall-back DST change', () => {
    // Before 2026-11-01T06:00Z New York is UTC-4 (EDT); after it, UTC-5 (EST).
    expect(getNewYorkDayKey('2026-11-01T03:59:59.000Z')).toBe('2026-10-31');
    expect(getNewYorkDayKey('2026-11-01T04:00:00.000Z')).toBe('2026-11-01');
    expect(getNewYorkDayKey('2026-11-02T04:59:59.000Z')).toBe('2026-11-01');
    expect(getNewYorkDayKey('2026-11-02T05:00:00.000Z')).toBe('2026-11-02');
  });

  it('splits the day at local midnight across the spring-forward DST change', () => {
    expect(getNewYorkDayKey('2026-03-08T04:59:59.000Z')).toBe('2026-03-07');
    expect(getNewYorkDayKey('2026-03-08T05:00:00.000Z')).toBe('2026-03-08');
  });
});

describe('formatNewYorkDayHeading', () => {
  it('formats the day key as a weekday, month, day and year', () => {
    expect(formatNewYorkDayHeading('2026-05-01')).toBe('Fri, May 1, 2026');
  });
});

describe('groupBySortAtNewYorkDay', () => {
  it('returns no groups for no items', () => {
    expect(groupBySortAtNewYorkDay([])).toEqual([]);
  });

  it('groups by New York day, newest day first, keeping input order inside a day', () => {
    const items = [
      { id: 'a', sortAt: '2026-05-02T01:30:00.000Z' }, // May 1 in New York
      { id: 'b', sortAt: '2026-05-03T15:00:00.000Z' }, // May 3
      { id: 'c', sortAt: '2026-05-01T20:00:00.000Z' }, // May 1
    ];

    const groups = groupBySortAtNewYorkDay(items);

    expect(groups.map((g) => g.dayKey)).toEqual(['2026-05-03', '2026-05-01']);
    expect(groups.map((g) => g.photos.map((p) => p.id))).toEqual([['b'], ['a', 'c']]);
    expect(groups[0]?.dayHeading).toBe('Sun, May 3, 2026');
  });

  it('property: groups are a permutation of the input, keyed correctly, strictly descending, order-stable', () => {
    const sortAtArb = fc
      .integer({ min: Date.UTC(2025, 0, 1), max: Date.UTC(2027, 11, 31) })
      .map((ms) => new Date(ms).toISOString());
    const itemsArb = fc.array(
      fc.record({ id: fc.uuid(), sortAt: sortAtArb }),
      { maxLength: 60 },
    );

    fc.assert(
      fc.property(itemsArb, (items) => {
        const groups = groupBySortAtNewYorkDay(items);

        // Concatenation is a permutation of the input (nothing dropped or duplicated).
        const flat = groups.flatMap((g) => g.photos.map((p) => p.id));
        expect([...flat].sort()).toEqual(items.map((i) => i.id).sort());

        // Every item shares its group's key.
        for (const g of groups) {
          expect(g.photos.length).toBeGreaterThan(0);
          for (const p of g.photos) expect(getNewYorkDayKey(p.sortAt)).toBe(g.dayKey);
        }

        // Day keys strictly descend.
        for (let i = 1; i < groups.length; i += 1) {
          expect(groups[i - 1]!.dayKey > groups[i]!.dayKey).toBe(true);
        }

        // Inside a group the order equals the input order.
        for (const g of groups) {
          const expected = items.filter((i) => getNewYorkDayKey(i.sortAt) === g.dayKey).map((i) => i.id);
          expect(g.photos.map((p) => p.id)).toEqual(expected);
        }
      }),
      { numRuns: 100 },
    );
  });
});
