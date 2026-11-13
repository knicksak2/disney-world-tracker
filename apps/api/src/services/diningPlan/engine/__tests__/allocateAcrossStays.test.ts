import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DINING_MEAL_PERIODS } from '@dwt/shared';

import { addDays } from '../../../ticketPrices/dates.js';
import { allocateAcrossStays, type ActiveStay, type CrossStayMeal } from '../allocateAcrossStays.js';
import { allocateCredits } from '../allocateCredits.js';

const PERIOD_ORDER = { breakfast: 0, lunch: 1, dinner: 2 } as const;

function meal(date: string, period: keyof typeof PERIOD_ORDER, kind: 'ts' | 'qs', savingsCents: number, weight = 1): CrossStayMeal {
  const day = Math.round((Date.parse(date) - Date.parse('2027-01-01')) / 86_400_000);
  return { id: `${date}:${period}`, date, kind, weight, savingsCents, order: day * 3 + PERIOD_ORDER[period] };
}
function stay(key: string, checkIn: string, checkOut: string, ts: number, qs: number): ActiveStay {
  return { key, checkIn, checkOut, capacity: { ts, qs } };
}
const assigned = (r: Map<string, string | null>) => Object.fromEntries([...r.entries()].sort());

describe('allocateAcrossStays', () => {
  it('covers both hand-off meals, one by each stay: the outgoing dinner credit and the incoming breakfast credit', () => {
    // Outgoing stay: one table-service credit left. Incoming stay: one quick-service credit.
    const r = allocateAcrossStays(
      [meal('2027-03-03', 'breakfast', 'qs', 1_500), meal('2027-03-03', 'dinner', 'ts', 6_000)],
      [stay('poly', '2027-03-02', '2027-03-03', 1, 0), stay('pop', '2027-03-03', '2027-03-04', 0, 1)],
    );
    expect(assigned(r)).toEqual({ '2027-03-03:breakfast': 'pop', '2027-03-03:dinner': 'poly' });
  });

  it('gives a single credit to the higher-savings hand-off meal whatever its meal period', () => {
    const stays = [stay('a', '2027-03-02', '2027-03-03', 1, 0), stay('b', '2027-03-03', '2027-03-04', 0, 0)];
    expect(assigned(allocateAcrossStays([meal('2027-03-03', 'breakfast', 'ts', 7_000), meal('2027-03-03', 'dinner', 'ts', 5_000)], stays))).toEqual({
      '2027-03-03:breakfast': 'a', '2027-03-03:dinner': null,
    });
    expect(assigned(allocateAcrossStays([meal('2027-03-03', 'breakfast', 'ts', 5_000), meal('2027-03-03', 'dinner', 'ts', 7_000)], stays))).toEqual({
      '2027-03-03:breakfast': null, '2027-03-03:dinner': 'a',
    });
  });

  it('solves three stays with two hand-offs jointly', () => {
    // One table-service credit per stay. Best total 20500: the two Mar 3 meals go to a and b, the Mar 5 dinner to c.
    // a covering the lunch and b the dinner ties with the reverse; the tie gives the outgoing stay the earlier meal.
    const meals = [
      meal('2027-03-01', 'dinner', 'ts', 4_000),
      meal('2027-03-03', 'lunch', 'ts', 6_000),
      meal('2027-03-03', 'dinner', 'ts', 6_500),
      meal('2027-03-04', 'dinner', 'ts', 3_000),
      meal('2027-03-05', 'dinner', 'ts', 8_000),
      meal('2027-03-06', 'dinner', 'ts', 2_000),
    ];
    const r = allocateAcrossStays(meals, [stay('c', '2027-03-05', '2027-03-07', 1, 0), stay('a', '2027-03-01', '2027-03-03', 1, 0), stay('b', '2027-03-03', '2027-03-05', 1, 0)]);
    expect(assigned(r)).toEqual({
      '2027-03-01:dinner': null, '2027-03-03:lunch': 'a', '2027-03-03:dinner': 'b', '2027-03-04:dinner': null, '2027-03-05:dinner': 'c', '2027-03-06:dinner': null,
    });
  });

  it('uses the other stay when one side has no capacity', () => {
    const r = allocateAcrossStays([meal('2027-03-03', 'dinner', 'ts', 5_000)], [stay('a', '2027-03-01', '2027-03-03', 0, 0), stay('b', '2027-03-03', '2027-03-05', 2, 0)]);
    expect(assigned(r)).toEqual({ '2027-03-03:dinner': 'b' });
  });

  it('puts a two-credit hand-off meal on the stay that can fit it', () => {
    const r = allocateAcrossStays(
      [meal('2027-03-02', 'dinner', 'ts', 3_000), meal('2027-03-03', 'dinner', 'ts', 9_000, 2)],
      [stay('a', '2027-03-02', '2027-03-03', 1, 0), stay('b', '2027-03-03', '2027-03-05', 2, 0)],
    );
    expect(assigned(r)).toEqual({ '2027-03-02:dinner': 'a', '2027-03-03:dinner': 'b' });
  });

  it('prefers the outgoing stay when either could cover a hand-off meal equally well', () => {
    const r = allocateAcrossStays([meal('2027-03-03', 'dinner', 'ts', 5_000)], [stay('a', '2027-03-01', '2027-03-03', 1, 0), stay('b', '2027-03-03', '2027-03-05', 1, 0)]);
    expect(assigned(r)).toEqual({ '2027-03-03:dinner': 'a' });
  });

  it('leaves a meal outside every stay, or with savings of 0, uncovered', () => {
    const r = allocateAcrossStays([meal('2027-02-27', 'dinner', 'ts', 5_000), meal('2027-03-02', 'lunch', 'qs', 0)], [stay('a', '2027-03-01', '2027-03-03', 2, 2)]);
    expect(assigned(r)).toEqual({ '2027-02-27:dinner': null, '2027-03-02:lunch': null });
  });

  it('rejects stays that share nights', () => {
    expect(() => allocateAcrossStays([], [stay('a', '2027-03-01', '2027-03-04', 1, 0), stay('b', '2027-03-03', '2027-03-05', 1, 0)])).toThrow(RangeError);
  });
});

// --- properties ----------------------------------------------------------------------------------------------------

interface Case {
  readonly stays: ActiveStay[];
  readonly meals: CrossStayMeal[];
}

/** 1 to 3 consecutive stays of 1 or 2 nights (sometimes with a gap), at most 6 hand-off meals and some fixed ones. */
const caseArb: fc.Arbitrary<Case> = fc
  .record({
    stays: fc.array(fc.record({ nights: fc.integer({ min: 1, max: 2 }), gap: fc.constantFrom(0, 0, 0, 1), ts: fc.integer({ min: 0, max: 3 }), qs: fc.integer({ min: 0, max: 2 }) }), { minLength: 1, maxLength: 3 }),
    slots: fc.array(fc.record({ offset: fc.integer({ min: 0, max: 7 }), period: fc.integer({ min: 0, max: 2 }), kind: fc.constantFrom('ts' as const, 'ts' as const, 'qs' as const), weight: fc.constantFrom(1, 1, 2), savings: fc.integer({ min: 1, max: 9_000 }) }), { maxLength: 14 }),
  })
  .map(({ stays: specs, slots }) => {
    const stays: ActiveStay[] = [];
    let start = '2027-03-01';
    specs.forEach((s, i) => {
      const checkIn = addDays(start, s.gap);
      const checkOut = addDays(checkIn, s.nights);
      stays.push(stay(`s${i}`, checkIn, checkOut, s.ts, s.qs));
      start = checkOut;
    });
    const seen = new Set<string>();
    const meals: CrossStayMeal[] = [];
    for (const s of slots) {
      const date = addDays('2027-03-01', s.offset);
      const period = DINING_MEAL_PERIODS[s.period]!;
      const m = meal(date, period, s.kind, s.savings, s.kind === 'ts' ? s.weight : 1);
      if (seen.has(m.id)) continue;
      const eligible = stays.filter((x) => x.checkIn <= date && date <= x.checkOut).length;
      if (eligible === 2 && meals.filter((y) => stays.filter((x) => x.checkIn <= y.date && y.date <= x.checkOut).length === 2).length >= 6) continue;
      seen.add(m.id);
      meals.push(m);
    }
    return { stays, meals };
  });

const eligibleStays = (c: Case, m: CrossStayMeal) => c.stays.filter((s) => s.checkIn <= m.date && m.date <= s.checkOut);

function feasible(c: Case, assignment: Map<string, string | null>): boolean {
  for (const s of c.stays) {
    let ts = 0;
    let qs = 0;
    for (const m of c.meals) {
      if (assignment.get(m.id) !== s.key) continue;
      if (m.kind === 'ts') ts += m.weight;
      else qs += 1;
    }
    if (ts > s.capacity.ts || qs > s.capacity.qs) return false;
  }
  return true;
}
const totalOf = (c: Case, a: Map<string, string | null>) => c.meals.reduce((sum, m) => (a.get(m.id) ? sum + m.savingsCents : sum), 0);

/** Every assignment of each meal to one of its stays or to none. */
function bruteForceBest(c: Case): number {
  let best = 0;
  const options = c.meals.map((m) => [null, ...eligibleStays(c, m).map((s) => s.key)]);
  const pick = new Map<string, string | null>();
  const walk = (i: number): void => {
    if (i === c.meals.length) {
      if (feasible(c, pick)) best = Math.max(best, totalOf(c, pick));
      return;
    }
    for (const o of options[i]!) {
      pick.set(c.meals[i]!.id, o);
      walk(i + 1);
    }
  };
  walk(0);
  return best;
}

/** Each hand-off meal forced to one side: every stay solves its own knapsack over what it is given. */
function forcedTotal(c: Case, side: 'outgoing' | 'incoming'): number {
  let total = 0;
  for (const s of c.stays) {
    const offered = c.meals.filter((m) => {
      const e = eligibleStays(c, m);
      if (e.length === 1) return e[0] === s;
      if (e.length === 2) return (side === 'outgoing' ? e[0] : e[1]) === s;
      return false;
    });
    const covered = allocateCredits(offered, s.capacity);
    total += offered.reduce((sum, m) => (covered.has(m.id) ? sum + m.savingsCents : sum), 0);
  }
  return total;
}

describe('cross-stay allocation properties', () => {
  // Feature: dining-plan-calculator, Property 29: Cross-stay allocation is optimal
  // Validates: Requirements 25.6, 25.7
  it('Property 29: the total equals the brute-force optimum over every assignment', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const r = allocateAcrossStays(c.meals, c.stays);
        expect(totalOf(c, r)).toBe(bruteForceBest(c));
      }),
      { numRuns: 150 },
    );
  });

  // Feature: dining-plan-calculator, Property 30: Per-stay capacity holds, credits never carry, ties prefer the outgoing stay
  // Validates: Requirements 25.6, 25.7
  it('Property 30: capacity holds per stay, meals go only to stays containing their date, and no hand-off meal could move to the outgoing stay for free', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const r = allocateAcrossStays(c.meals, c.stays);
        expect(feasible(c, r)).toBe(true);
        for (const m of c.meals) {
          const key = r.get(m.id);
          if (key) expect(eligibleStays(c, m).map((s) => s.key)).toContain(key);
          const e = eligibleStays(c, m);
          if (e.length === 2 && key === e[1]!.key) {
            // Moving it to the outgoing stay keeps the total; it must not fit there.
            const moved = new Map(r).set(m.id, e[0]!.key);
            expect(feasible(c, moved)).toBe(false);
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  // Feature: dining-plan-calculator, Property 34: Flexible hand-off meals never cost more than a fixed rule
  // Validates: Requirements 25.8
  it('Property 34: flexible hand-off allocation saves at least as much as forcing every hand-off meal to either side', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const total = totalOf(c, allocateAcrossStays(c.meals, c.stays));
        expect(total).toBeGreaterThanOrEqual(forcedTotal(c, 'outgoing'));
        expect(total).toBeGreaterThanOrEqual(forcedTotal(c, 'incoming'));
      }),
      { numRuns: 150 },
    );
  });

  it('a single active stay gives exactly the single-stay allocation', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const only = c.stays[0]!;
        const r = allocateAcrossStays(c.meals, [only]);
        const inStay = c.meals.filter((m) => only.checkIn <= m.date && m.date <= only.checkOut);
        const expected = allocateCredits(inStay, only.capacity);
        for (const m of c.meals) expect(r.get(m.id)).toBe(expected.has(m.id) ? only.key : null);
      }),
      { numRuns: 150 },
    );
  });
});
