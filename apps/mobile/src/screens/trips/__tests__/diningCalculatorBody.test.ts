/**
 * The standalone calculator's request body (dining-plan-calculator task 11.4).
 *
 * Validates: Requirements 3.8, 20.2, 20.3, 16.8.
 */

import fc from 'fast-check';
import { DINING_PLAN_PARTY_MAX, diningCalculateBodySchema, type DiningEntryDTO } from '@dwt/shared';

import { LIBERTY } from '../../../test/diningPlanFixtures';
import {
  buildCalculateBody,
  CALCULATOR_DEFAULT_SETTINGS,
  countMax,
  datesProblem,
  datesProblemText,
  standaloneParty,
  type CalculatorForm,
} from '../diningCalculatorBody';

const entry = (o: Partial<DiningEntryDTO> = {}): DiningEntryDTO => ({
  date: '2027-03-02',
  mealPeriod: 'dinner',
  kind: 'restaurant',
  experienceId: LIBERTY,
  experienceName: 'Liberty Tree Tavern',
  placeholderKind: null,
  plannedItemId: null,
  excludedKeys: [],
  ...o,
});

const FORM: CalculatorForm = {
  counts: { adults: 2, children: 1, under3: 1 },
  passHolder: false,
  checkIn: '2027-03-01',
  checkOut: '2027-03-06',
  settings: CALCULATOR_DEFAULT_SETTINGS,
  entries: [],
};

describe('standaloneParty', () => {
  it('builds labelled people with stable keys and the age brackets of the counts', () => {
    expect(standaloneParty({ adults: 2, children: 1, under3: 1 }, false)).toEqual([
      { key: 'g:a1', label: 'Adult 1', ageBracket: 'adult', passType: 'none' },
      { key: 'g:a2', label: 'Adult 2', ageBracket: 'adult', passType: 'none' },
      { key: 'g:c1', label: 'Child 1', ageBracket: 'child', passType: 'none' },
      { key: 'g:u1', label: 'Under 3 (1)', ageBracket: 'under3', passType: 'none' },
    ]);
  });

  it('marks only the first adult as a pass holder (one is enough for the party discount, Requirement 3.8)', () => {
    expect(standaloneParty({ adults: 2, children: 1, under3: 0 }, true).map((p) => p.passType)).toEqual(['annual_pass', 'none', 'none']);
  });
});

describe('countMax', () => {
  it('keeps the whole party within the party limit', () => {
    expect(countMax({ adults: 2, children: 3, under3: 1 }, 'adults')).toBe(DINING_PLAN_PARTY_MAX - 4);
    expect(countMax({ adults: 2, children: 3, under3: 1 }, 'under3')).toBe(DINING_PLAN_PARTY_MAX - 5);
  });
});

describe('datesProblem', () => {
  it('names each reason the dates cannot be calculated', () => {
    expect(datesProblem('', '2027-03-06')).toBe('missing');
    expect(datesProblem('2027-03-01', '')).toBe('missing');
    expect(datesProblem('2027-03-06', '2027-03-01')).toBe('order');
    expect(datesProblem('2027-03-01', '2027-03-31')).toBeNull(); // 30 nights
    expect(datesProblem('2027-03-01', '2027-04-01')).toBe('too_long'); // 31 nights
    expect(datesProblem('2027-03-01', '2027-03-01')).toBeNull();
  });

  it('words each problem', () => {
    expect(datesProblemText('missing')).toBe('Choose your check-in and check-out dates to see the comparison.');
    expect(datesProblemText('order')).toBe('Check-out must not be before check-in.');
    expect(datesProblemText('too_long')).toBe('The calculator handles stays of up to 30 nights.');
  });
});

describe('buildCalculateBody', () => {
  it('assembles party, stay, settings and entries', () => {
    const body = buildCalculateBody({ ...FORM, entries: [entry({ excludedKeys: ['g:c1'] })] });
    expect(body).toEqual({
      party: standaloneParty(FORM.counts, false),
      stay: { checkIn: '2027-03-01', checkOut: '2027-03-06' },
      settings: { ...CALCULATOR_DEFAULT_SETTINGS, stay: null },
      entries: [{ date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: LIBERTY, placeholderKind: null, excludedKeys: ['g:c1'] }],
    });
    // The display name never goes to the server.
    expect(JSON.stringify(body)).not.toContain('Liberty Tree Tavern');
  });

  it('is null until the dates can be calculated, and for an empty party', () => {
    expect(buildCalculateBody({ ...FORM, checkOut: '' })).toBeNull();
    expect(buildCalculateBody({ ...FORM, checkOut: '2027-02-01' })).toBeNull();
    expect(buildCalculateBody({ ...FORM, counts: { adults: 0, children: 0, under3: 0 } })).toBeNull();
  });

  it('sends only the meals inside the stay', () => {
    const body = buildCalculateBody({
      ...FORM,
      checkOut: '2027-03-03',
      entries: [entry({ date: '2027-02-28' }), entry({ date: '2027-03-01', mealPeriod: 'breakfast' }), entry({ date: '2027-03-03' }), entry({ date: '2027-03-04' })],
    });
    expect(body?.entries.map((e) => `${e.date} ${e.mealPeriod}`)).toEqual(['2027-03-01 breakfast', '2027-03-03 dinner']);
  });

  it('drops keys of people no longer in the party from meals and from the alcohol list', () => {
    const body = buildCalculateBody({
      ...FORM,
      counts: { adults: 1, children: 0, under3: 0 },
      settings: { ...CALCULATOR_DEFAULT_SETTINGS, alcoholDrinkerKeys: ['g:a1', 'g:a2', 'g:c1'] },
      entries: [entry({ excludedKeys: ['g:a2', 'g:c1'] })],
    });
    expect(body?.settings.alcoholDrinkerKeys).toEqual(['g:a1']);
    expect(body?.entries[0]?.excludedKeys).toEqual([]);
  });

  it('sends the settings custom stay as null: the form dates are the stay', () => {
    const body = buildCalculateBody({ ...FORM, settings: { ...CALCULATOR_DEFAULT_SETTINGS, stay: { checkIn: '2027-01-01', checkOut: '2027-01-02' } } });
    expect(body?.settings.stay).toBeNull();
    expect(body?.stay).toEqual({ checkIn: '2027-03-01', checkOut: '2027-03-06' });
  });

  // Feature: dining-plan-calculator, Property 28: Admin and shared schemas round-trip (the standalone body side).
  it('every body it builds is accepted by the server schema unchanged (property)', () => {
    const day = fc.integer({ min: 0, max: 40 }).map((n) => {
      const d = new Date(Date.UTC(2027, 2, 1 + n));
      return d.toISOString().slice(0, 10);
    });
    const anEntry = fc.record({
      date: day,
      mealPeriod: fc.constantFrom('breakfast' as const, 'lunch' as const, 'dinner' as const),
      kind: fc.constantFrom('restaurant' as const, 'placeholder' as const, 'skip' as const),
      excludedKeys: fc.subarray(['g:a1', 'g:a2', 'g:a9', 'g:c1', 'g:c7', 'g:u1']),
    });
    fc.assert(
      fc.property(
        fc.record({ adults: fc.integer({ min: 0, max: 20 }), children: fc.integer({ min: 0, max: 20 }), under3: fc.integer({ min: 0, max: 10 }) }),
        fc.boolean(),
        day,
        day,
        fc.array(anEntry, { maxLength: 30 }),
        fc.subarray(['g:a1', 'g:a2', 'g:a5', 'g:c1']),
        (counts, passHolder, checkIn, checkOut, raw, drinkers) => {
          const entries = raw.map((e) =>
            entry({
              ...e,
              experienceId: e.kind === 'restaurant' ? LIBERTY : null,
              placeholderKind: e.kind === 'placeholder' ? 'quick_service' : null,
            }),
          );
          const body = buildCalculateBody({ counts, passHolder, checkIn, checkOut, entries, settings: { ...CALCULATOR_DEFAULT_SETTINGS, alcoholDrinkerKeys: drinkers } });
          const party = counts.adults + counts.children + counts.under3;
          if (party === 0 || checkOut < checkIn) {
            expect(body).toBeNull();
            return;
          }
          if (body === null) return; // too many nights
          expect(diningCalculateBodySchema.parse(body)).toEqual(body);
          const keys = new Set(body.party.map((p) => p.key));
          body.entries.forEach((e) => {
            expect(e.date >= checkIn && e.date <= checkOut).toBe(true);
            e.excludedKeys.forEach((k) => expect(keys.has(k)).toBe(true));
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});
