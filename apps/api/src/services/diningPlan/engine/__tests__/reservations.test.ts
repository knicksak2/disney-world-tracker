import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDays } from '../../../ticketPrices/dates.js';
import { wdwIsoAtMinutes } from '../../../trips/wdwClock.js';
import {
  isSuggestible,
  mealPeriodOfReservation,
  suggestFromPlannedItems,
  type PlannedDiningItemRow,
} from '../reservations.js';

describe('mealPeriodOfReservation', () => {
  it('passes a stored breakfast, lunch or dinner through, whatever the time', () => {
    expect(mealPeriodOfReservation({ mealPeriod: 'breakfast', plannedTimeIso: '2027-01-15T23:00:00.000Z', date: '2027-01-15' })).toBe('breakfast');
    expect(mealPeriodOfReservation({ mealPeriod: 'lunch', plannedTimeIso: null, date: '2027-01-15' })).toBe('lunch');
    expect(mealPeriodOfReservation({ mealPeriod: 'dinner', plannedTimeIso: '2027-01-15T13:00:00.000Z', date: '2027-01-15' })).toBe('dinner');
  });

  // 2027-01-15 is EST (UTC-5); 2027-07-15 is EDT (UTC-4).
  it.each([
    ['2027-01-15', '2027-01-15T15:59:00.000Z', 'breakfast'], // 10:59 EST
    ['2027-01-15', '2027-01-15T16:00:00.000Z', 'lunch'], // 11:00 EST
    ['2027-01-15', '2027-01-15T20:59:00.000Z', 'lunch'], // 15:59 EST
    ['2027-01-15', '2027-01-15T21:00:00.000Z', 'dinner'], // 16:00 EST
    ['2027-07-15', '2027-07-15T14:59:00.000Z', 'breakfast'], // 10:59 EDT
    ['2027-07-15', '2027-07-15T15:00:00.000Z', 'lunch'], // 11:00 EDT
    ['2027-07-15', '2027-07-15T19:59:00.000Z', 'lunch'], // 15:59 EDT
    ['2027-07-15', '2027-07-15T20:00:00.000Z', 'dinner'], // 16:00 EDT
    ['2027-07-15', '2027-07-16T02:30:00.000Z', 'dinner'], // 22:30 EDT, the next UTC day
  ] as const)('derives %s at %s as %s in WDW time', (date, plannedTimeIso, expected) => {
    expect(mealPeriodOfReservation({ mealPeriod: null, plannedTimeIso, date })).toBe(expected);
    expect(mealPeriodOfReservation({ mealPeriod: 'snack', plannedTimeIso, date })).toBe(expected);
  });

  it('is null for a snack or missing period with no usable time', () => {
    expect(mealPeriodOfReservation({ mealPeriod: 'snack', plannedTimeIso: null, date: '2027-01-15' })).toBeNull();
    expect(mealPeriodOfReservation({ mealPeriod: null, plannedTimeIso: null, date: '2027-01-15' })).toBeNull();
    expect(mealPeriodOfReservation({ mealPeriod: null, plannedTimeIso: 'not a time', date: '2027-01-15' })).toBeNull();
  });

  // Feature: dining-plan-calculator, Property 20: Reservation meal period is a total function with exact boundaries
  // Validates: Requirements 5.2, 5.9
  it('Property 20: a stored period wins; otherwise the WDW minute picks breakfast < 660 <= lunch < 960 <= dinner', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 730 }).map((n) => addDays('2026-11-01', n)),
        fc.integer({ min: 0, max: 1439 }),
        fc.constantFrom(null, 'snack', 'breakfast', 'lunch', 'dinner', 'brunch'),
        (date, minutes, stored) => {
          const plannedTimeIso = wdwIsoAtMinutes(date, minutes);
          const result = mealPeriodOfReservation({ mealPeriod: stored, plannedTimeIso, date });
          if (stored === 'breakfast' || stored === 'lunch' || stored === 'dinner') expect(result).toBe(stored);
          else expect(result).toBe(minutes < 660 ? 'breakfast' : minutes < 960 ? 'lunch' : 'dinner');
          if (stored !== 'breakfast' && stored !== 'lunch' && stored !== 'dinner') {
            expect(mealPeriodOfReservation({ mealPeriod: stored, plannedTimeIso: null, date })).toBeNull();
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

function row(overrides: Partial<PlannedDiningItemRow> & { id: string }): PlannedDiningItemRow {
  return {
    itemType: 'experience',
    experienceId: '00000000-0000-4000-8000-0000000000a1',
    experienceName: 'Be Our Guest Restaurant',
    experienceCategory: 'Restaurant',
    experienceActive: true,
    plannedDate: '2027-03-02',
    plannedTime: '2027-03-02T23:30:00.000Z', // 18:30 EST
    mealPeriod: null,
    partySize: null,
    reservationKind: 'dining',
    ...overrides,
  };
}

describe('suggestFromPlannedItems', () => {
  it('suggests exactly the dining reservations and the planned restaurants (Property 38 mixed fixture)', () => {
    const rows: PlannedDiningItemRow[] = [
      row({ id: 'r-dinner', partySize: 2 }),
      row({ id: 'p-lunch', reservationKind: null, experienceName: 'Cosmic Ray\'s Starlight Cafe', plannedTime: '2027-03-02T17:15:00.000Z' }), // 12:15 EST
      row({ id: 'break', itemType: 'break', experienceId: null, experienceName: null, experienceCategory: null, experienceActive: null, reservationKind: null }),
      // A break that names a restaurant is still a break, not a planned meal at that restaurant.
      row({ id: 'break-at-restaurant', itemType: 'break', reservationKind: null, plannedTime: '2027-03-02T17:00:00.000Z' }),
      row({ id: 'undated', plannedDate: null }),
      row({ id: 'ride', reservationKind: null, experienceName: 'Space Mountain', experienceCategory: 'Ride' }),
      row({ id: 'll-ride', reservationKind: 'lightning_lane', experienceName: 'Space Mountain', experienceCategory: 'Ride' }),
      row({ id: 'inactive', reservationKind: null, experienceActive: false }),
      row({ id: 'no-time', reservationKind: null, plannedTime: null, mealPeriod: null }),
      row({ id: 'snack-no-time', reservationKind: null, plannedTime: null, mealPeriod: 'snack' }),
      row({ id: 'p-dinner-same-slot', reservationKind: null, plannedTime: '2027-03-02T22:00:00.000Z' }), // 17:00 EST, earlier than the reservation
      row({ id: 'dessert-party', reservationKind: 'dining', experienceCategory: 'Entertainment', experienceName: 'Fireworks Dessert Party', plannedDate: '2027-03-03', plannedTime: '2027-03-04T01:30:00.000Z' }), // 20:30 EST
    ];
    const r = suggestFromPlannedItems(rows, { entries: [], eligibleCount: 3 });
    expect(r.suggestionsNeedingMealPeriod).toBe(2);
    expect(r.suggestions).toEqual([
      { plannedItemId: 'p-lunch', experienceId: rows[1]!.experienceId, experienceName: "Cosmic Ray's Starlight Cafe", date: '2027-03-02', mealPeriod: 'lunch', source: 'planned_item', partySizeMismatch: false, alreadyHasEntry: false },
      // A reservation beats a plain item in the same slot even though the plain item is earlier.
      { plannedItemId: 'r-dinner', experienceId: rows[0]!.experienceId, experienceName: 'Be Our Guest Restaurant', date: '2027-03-02', mealPeriod: 'dinner', source: 'reservation', partySizeMismatch: true, alreadyHasEntry: false },
      { plannedItemId: 'p-dinner-same-slot', experienceId: rows[0]!.experienceId, experienceName: 'Be Our Guest Restaurant', date: '2027-03-02', mealPeriod: 'dinner', source: 'planned_item', partySizeMismatch: false, alreadyHasEntry: false },
      { plannedItemId: 'dessert-party', experienceId: rows[0]!.experienceId, experienceName: 'Fireworks Dessert Party', date: '2027-03-03', mealPeriod: 'dinner', source: 'reservation', partySizeMismatch: false, alreadyHasEntry: false },
    ]);
  });

  it('flags party size only for a reservation with a party_size below the eligible count', () => {
    const rows = [
      row({ id: 'small', partySize: 2, plannedDate: '2027-03-01', plannedTime: '2027-03-01T23:30:00.000Z' }),
      row({ id: 'exact', partySize: 3, plannedDate: '2027-03-02' }),
      row({ id: 'unknown', partySize: null, plannedDate: '2027-03-03', plannedTime: '2027-03-03T23:30:00.000Z' }),
      row({ id: 'plain', reservationKind: null, partySize: 2, plannedDate: '2027-03-04', plannedTime: '2027-03-04T23:30:00.000Z' }),
    ];
    const flags = suggestFromPlannedItems(rows, { entries: [], eligibleCount: 3 }).suggestions.map((s) => [s.plannedItemId, s.partySizeMismatch]);
    expect(flags).toEqual([['small', true], ['exact', false], ['unknown', false], ['plain', false]]);
  });

  it('orders two reservations in one slot by time, then by id', () => {
    const rows = [
      row({ id: 'b-late', plannedTime: '2027-03-02T23:45:00.000Z' }),
      row({ id: 'c-early', plannedTime: '2027-03-02T22:30:00.000Z' }),
      row({ id: 'a-early', plannedTime: '2027-03-02T22:30:00.000Z' }),
    ];
    expect(suggestFromPlannedItems(rows, { entries: [], eligibleCount: 2 }).suggestions.map((s) => s.plannedItemId)).toEqual(['a-early', 'c-early', 'b-late']);
  });

  it('puts an untimed planned item with a stored period after a timed one in the same slot', () => {
    const rows = [
      row({ id: 'a-untimed', reservationKind: null, plannedTime: null, mealPeriod: 'dinner' }),
      row({ id: 'z-timed', reservationKind: null, plannedTime: '2027-03-02T23:30:00.000Z' }),
    ];
    expect(suggestFromPlannedItems(rows, { entries: [], eligibleCount: 2 }).suggestions.map((s) => s.plannedItemId)).toEqual(['z-timed', 'a-untimed']);
  });

  it('marks an occupied slot and leaves out an item already linked to an entry', () => {
    const rows = [row({ id: 'linked' }), row({ id: 'fresh', plannedDate: '2027-03-03', plannedTime: '2027-03-03T23:30:00.000Z' })];
    const r = suggestFromPlannedItems(rows, {
      entries: [
        { date: '2027-03-02', mealPeriod: 'dinner', plannedItemId: 'linked' },
        { date: '2027-03-03', mealPeriod: 'dinner', plannedItemId: null },
      ],
      eligibleCount: 2,
    });
    expect(r.suggestions.map((s) => [s.plannedItemId, s.alreadyHasEntry])).toEqual([['fresh', true]]);
  });

  // Feature: dining-plan-calculator, Property 38: Import suggestions are exactly the eligible items, with the stated precedence
  // Validates: Requirements 5.1, 5.7, 5.8, 5.9, 5.10
  it('Property 38: suggestions are exactly the suggestible rows with a meal period; the rest are counted; slot order follows precedence', () => {
    const rowArb = fc.record({
      itemType: fc.constantFrom('experience', 'experience', 'break'),
      category: fc.constantFrom('Restaurant', 'Restaurant', 'Ride', 'Entertainment'),
      active: fc.boolean(),
      dated: fc.boolean(),
      day: fc.integer({ min: 0, max: 2 }),
      minutes: fc.option(fc.integer({ min: 360, max: 1380 }), { nil: null }),
      mealPeriod: fc.constantFrom(null, null, 'snack', 'breakfast', 'lunch', 'dinner'),
      kind: fc.constantFrom(null, null, 'dining', 'lightning_lane', 'activity'),
      partySize: fc.option(fc.integer({ min: 1, max: 6 }), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 20 }), fc.integer({ min: 1, max: 6 }), (specs, eligibleCount) => {
        const rows: PlannedDiningItemRow[] = specs.map((s, i) => {
          const date = addDays('2027-03-01', s.day);
          return {
            id: `item-${String(i).padStart(2, '0')}`,
            itemType: s.itemType,
            experienceId: s.itemType === 'break' ? null : `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
            experienceName: s.itemType === 'break' ? null : `Place ${i}`,
            experienceCategory: s.itemType === 'break' ? null : s.category,
            experienceActive: s.itemType === 'break' ? null : s.active,
            plannedDate: s.dated ? date : null,
            plannedTime: s.minutes === null ? null : wdwIsoAtMinutes(date, s.minutes),
            mealPeriod: s.mealPeriod,
            partySize: s.partySize,
            reservationKind: s.kind,
          };
        });
        const r = suggestFromPlannedItems(rows, { entries: [], eligibleCount });
        const eligibleRows = rows.filter(
          (x) => x.itemType === 'experience' && x.plannedDate !== null && x.experienceId !== null &&
            (x.reservationKind === 'dining' || (x.reservationKind === null && x.experienceCategory === 'Restaurant' && x.experienceActive === true)),
        );
        for (const x of rows) expect(isSuggestible(x)).toBe(eligibleRows.includes(x));
        const resolvable = eligibleRows.filter((x) => ['breakfast', 'lunch', 'dinner'].includes(x.mealPeriod ?? '') || x.plannedTime !== null);
        expect(r.suggestionsNeedingMealPeriod).toBe(eligibleRows.length - resolvable.length);
        expect(r.suggestions.map((s) => s.plannedItemId).sort()).toEqual(resolvable.map((x) => x.id).sort());
        for (const s of r.suggestions) {
          const x = rows.find((y) => y.id === s.plannedItemId)!;
          expect(s.source).toBe(x.reservationKind === 'dining' ? 'reservation' : 'planned_item');
          expect(s.partySizeMismatch).toBe(s.source === 'reservation' && x.partySize !== null && x.partySize < eligibleCount);
        }
        // Within a slot: reservations first, then the earlier time (untimed last), then the lower id.
        for (let i = 1; i < r.suggestions.length; i += 1) {
          const a = r.suggestions[i - 1]!;
          const b = r.suggestions[i]!;
          if (a.date !== b.date || a.mealPeriod !== b.mealPeriod) continue;
          const ra = rows.find((y) => y.id === a.plannedItemId)!;
          const rb = rows.find((y) => y.id === b.plannedItemId)!;
          if (a.source !== b.source) {
            expect(a.source).toBe('reservation');
            continue;
          }
          const ta = ra.plannedTime === null ? Infinity : Date.parse(ra.plannedTime);
          const tb = rb.plannedTime === null ? Infinity : Date.parse(rb.plannedTime);
          expect(ta < tb || (ta === tb && a.plannedItemId < b.plannedItemId)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
