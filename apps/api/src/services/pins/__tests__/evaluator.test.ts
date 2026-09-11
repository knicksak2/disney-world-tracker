/**
 * Unit tests for the pure Pin evaluation engine — concrete scenarios for each
 * criteria kind, the set predicates, the single-day feats, and the board /
 * award projections.
 *
 * Validates: Requirements 1, 2.4, 3.1, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19
 */

import { describe, expect, it } from 'vitest';

import type { Park } from '@dwt/shared';
import { PIN_SETS } from '@dwt/shared';
import {
  evaluateCriteria,
  evaluateBoard,
  newlyAwardedPinIds,
  type EvalExperience,
  type PinActivitySnapshot,
} from '../evaluator.js';

function exp(upstreamId: string, over: Partial<EvalExperience> = {}): EvalExperience {
  return {
    upstreamId,
    category: 'Ride',
    park: null,
    land: null,
    worldShowcaseCountry: null,
    facets: {},
    isDisneyResort: false,
    isRealRestaurant: false,
    ...over,
  };
}

function snap(
  catalog: EvalExperience[],
  completedIds: string[],
  over: Partial<PinActivitySnapshot> = {},
): PinActivitySnapshot {
  return {
    catalog,
    completed: new Set(completedIds),
    days: [],
    friendRides: 0,
    ratings: 0,
    notes: 0,
    trips: 0,
    ...over,
  };
}

const met = (c: Parameters<typeof evaluateCriteria>[0], s: PinActivitySnapshot) => evaluateCriteria(c, s).met;

describe('count metrics', () => {
  it('attractions counts only attraction categories among completed', () => {
    const cat = [
      exp('r1', { category: 'Ride' }),
      exp('s1', { category: 'Show' }),
      exp('rest1', { category: 'Restaurant', isRealRestaurant: true }),
      exp('res1', { category: 'Resort', isDisneyResort: true }),
    ];
    const s = snap(cat, ['r1', 's1', 'rest1', 'res1']);
    expect(evaluateCriteria({ kind: 'count', metric: 'attractions', threshold: 1 }, s).current).toBe(2);
    expect(met({ kind: 'count', metric: 'attractions', threshold: 2 }, s)).toBe(true);
    expect(met({ kind: 'count', metric: 'attractions', threshold: 3 }, s)).toBe(false);
  });

  it('restaurants counts real restaurants; snacks counts the residual', () => {
    const cat = [
      exp('rr', { category: 'Restaurant', isRealRestaurant: true }),
      exp('kiosk', { category: 'Restaurant', facets: { quickService: ['Festival Kiosk'] } }),
      exp('snack', { category: 'Restaurant', facets: { quickService: ['Snack'] } }),
    ];
    const s = snap(cat, ['rr', 'kiosk', 'snack']);
    expect(evaluateCriteria({ kind: 'count', metric: 'restaurants', threshold: 1 }, s).current).toBe(1);
    expect(evaluateCriteria({ kind: 'count', metric: 'festivalBooths', threshold: 1 }, s).current).toBe(1);
    expect(evaluateCriteria({ kind: 'count', metric: 'snacks', threshold: 1 }, s).current).toBe(1);
  });

  it('reviews = ratings + notes; ratings/notes are separate', () => {
    const s = snap([], [], { ratings: 50, notes: 25 });
    expect(evaluateCriteria({ kind: 'count', metric: 'reviews', threshold: 1 }, s).current).toBe(75);
    expect(met({ kind: 'count', metric: 'ratings', threshold: 50 }, s)).toBe(true);
    expect(met({ kind: 'count', metric: 'notes', threshold: 25 }, s)).toBe(true);
  });

  it('worldShowcaseCountries counts distinct completed countries', () => {
    const cat = [
      exp('j', { worldShowcaseCountry: 'Japan' }),
      exp('f', { worldShowcaseCountry: 'France' }),
      exp('f2', { worldShowcaseCountry: 'France' }),
    ];
    const s = snap(cat, ['j', 'f', 'f2']);
    expect(evaluateCriteria({ kind: 'count', metric: 'worldShowcaseCountries', threshold: 1 }, s).current).toBe(2);
  });
});

describe('completion criteria', () => {
  it('landComplete needs every active attraction in the land (dining excluded)', () => {
    const cat = [
      exp('a', { land: 'Fantasyland', category: 'Ride' }),
      exp('b', { land: 'Fantasyland', category: 'Show' }),
      exp('din', { land: 'Fantasyland', category: 'Restaurant', isRealRestaurant: true }),
    ];
    expect(met({ kind: 'landComplete', lands: ['Fantasyland'] }, snap(cat, ['a']))).toBe(false);
    // Both attractions done; the restaurant does not block completion.
    expect(met({ kind: 'landComplete', lands: ['Fantasyland'] }, snap(cat, ['a', 'b']))).toBe(true);
  });

  it('parkComplete attractions vs everything', () => {
    const cat = [
      exp('r', { park: 'EPCOT', category: 'Ride' }),
      exp('d', { park: 'EPCOT', category: 'Restaurant', isRealRestaurant: true }),
    ];
    // attractions-only: ride done is enough
    expect(met({ kind: 'parkComplete', park: 'EPCOT', scope: 'attractions' }, snap(cat, ['r']))).toBe(true);
    // everything: needs the dining too
    expect(met({ kind: 'parkComplete', park: 'EPCOT', scope: 'everything' }, snap(cat, ['r']))).toBe(false);
    expect(met({ kind: 'parkComplete', park: 'EPCOT', scope: 'everything' }, snap(cat, ['r', 'd']))).toBe(true);
  });

  it('catalogComplete attractions vs all', () => {
    const cat = [exp('r', { category: 'Ride' }), exp('d', { category: 'Restaurant', isRealRestaurant: true })];
    expect(met({ kind: 'catalogComplete', scope: 'attractions' }, snap(cat, ['r']))).toBe(true);
    expect(met({ kind: 'catalogComplete', scope: 'all' }, snap(cat, ['r']))).toBe(false);
    expect(met({ kind: 'catalogComplete', scope: 'all' }, snap(cat, ['r', 'd']))).toBe(true);
  });

  it('parksAttractionsComplete spans the four theme parks only', () => {
    const cat = [
      exp('mk', { park: 'Magic Kingdom', category: 'Ride' }),
      exp('ep', { park: 'EPCOT', category: 'Ride' }),
      exp('hs', { park: 'Hollywood Studios', category: 'Ride' }),
      exp('ak', { park: 'Animal Kingdom', category: 'Ride' }),
      exp('ds', { park: 'Disney Springs', category: 'Show' }), // not a theme park — ignored
    ];
    expect(met({ kind: 'parksAttractionsComplete' }, snap(cat, ['mk', 'ep', 'hs', 'ak']))).toBe(true);
    expect(met({ kind: 'parksAttractionsComplete' }, snap(cat, ['mk', 'ep', 'hs']))).toBe(false);
  });
});

describe('set criteria', () => {
  it('curated id set (roller coasters) resolves by upstream id', () => {
    const ids = (PIN_SETS.roller_coasters as { kind: 'ids'; ids: readonly string[] }).ids;
    const cat = ids.map((id) => exp(id, { category: 'Ride' }));
    expect(met({ kind: 'set', setId: 'roller_coasters', required: 1 }, snap(cat, [ids[0]!]))).toBe(true);
    expect(met({ kind: 'set', setId: 'roller_coasters', required: 'all' }, snap(cat, [ids[0]!]))).toBe(false);
    expect(met({ kind: 'set', setId: 'roller_coasters', required: 'all' }, snap(cat, [...ids]))).toBe(true);
  });

  it('facet set (water rides) resolves by thrillFactor facet', () => {
    const cat = [
      exp('w1', { facets: { thrillFactor: ['Water Rides'] } }),
      exp('w2', { facets: { thrillFactor: ['Water Rides'] } }),
      exp('dry', { facets: { thrillFactor: ['Thrill Ride'] } }),
    ];
    expect(evaluateCriteria({ kind: 'set', setId: 'water_rides', required: 'all' }, snap(cat, ['w1', 'w2'])).met).toBe(true);
    expect(evaluateCriteria({ kind: 'set', setId: 'water_rides', required: 5 }, snap(cat, ['w1', 'w2'])).met).toBe(false);
  });

  it('predicate sets (real restaurants, disney resorts, princesses)', () => {
    const cat = [
      exp('rr', { category: 'Restaurant', isRealRestaurant: true }),
      exp('resort', { category: 'Resort', isDisneyResort: true }),
      exp('princess', { category: 'Character_Meet', facets: { interests: ['Disney Princesses'] } }),
    ];
    const s = snap(cat, ['rr', 'resort', 'princess']);
    expect(met({ kind: 'set', setId: 'real_restaurants', required: 'all' }, s)).toBe(true);
    expect(met({ kind: 'set', setId: 'disney_resorts', required: 'all' }, s)).toBe(true);
    expect(met({ kind: 'set', setId: 'princesses', required: 1 }, s)).toBe(true);
  });
});

describe('single-day feats', () => {
  const day = (experiences: EvalExperience[]) => ({ date: '2026-01-02', experiences });

  it('multiPark counts distinct theme parks in a day', () => {
    const d = day([
      exp('a', { park: 'Magic Kingdom' }),
      exp('b', { park: 'EPCOT' }),
      exp('c', { park: 'EPCOT' }),
    ]);
    const s = snap([], [], { days: [d] });
    expect(met({ kind: 'singleDay', feat: { type: 'multiPark', parks: 2 } }, s)).toBe(true);
    expect(met({ kind: 'singleDay', feat: { type: 'multiPark', parks: 3 } }, s)).toBe(false);
  });

  it('grandSlam needs 4 parks AND 15 rides in one day', () => {
    const parks: Array<Park> = ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'];
    const rides = Array.from({ length: 15 }, (_, i) => exp(`ride${i}`, { category: 'Ride', park: parks[i % 4]! }));
    expect(met({ kind: 'singleDay', feat: { type: 'grandSlam' } }, snap([], [], { days: [day(rides)] }))).toBe(true);
    // 14 rides across 4 parks → not enough
    expect(met({ kind: 'singleDay', feat: { type: 'grandSlam' } }, snap([], [], { days: [day(rides.slice(0, 14))] }))).toBe(false);
  });

  it('diningAllParks and aroundTheWorld', () => {
    const parks: Array<Park> = ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'];
    const meals = parks.map((p, i) => exp(`m${i}`, { category: 'Restaurant', park: p, isRealRestaurant: true }));
    expect(met({ kind: 'singleDay', feat: { type: 'diningAllParks' } }, snap([], [], { days: [day(meals)] }))).toBe(true);

    const countries = ['Mexico', 'Norway', 'China', 'Germany', 'Italy', 'USA', 'Japan', 'Morocco', 'France', 'UK', 'Canada'];
    const stops = countries.map((cn, i) => exp(`c${i}`, { worldShowcaseCountry: cn }));
    expect(met({ kind: 'singleDay', feat: { type: 'aroundTheWorld' } }, snap([], [], { days: [day(stops)] }))).toBe(true);
    expect(met({ kind: 'singleDay', feat: { type: 'aroundTheWorld' } }, snap([], [], { days: [day(stops.slice(0, 10))] }))).toBe(false);
  });
});

describe('compound criteria', () => {
  it('Legendary Guide needs 50 friend rides AND 5 trips', () => {
    const c = { kind: 'compound' as const, all: [
      { kind: 'count' as const, metric: 'friendRides' as const, threshold: 50 },
      { kind: 'count' as const, metric: 'trips' as const, threshold: 5 },
    ] };
    expect(met(c, snap([], [], { friendRides: 50, trips: 5 }))).toBe(true);
    expect(met(c, snap([], [], { friendRides: 50, trips: 4 }))).toBe(false);
    // progress reports how many of the two conditions are met
    expect(evaluateCriteria(c, snap([], [], { friendRides: 50, trips: 4 }))).toMatchObject({ current: 1, target: 2 });
  });
});

describe('board & awards', () => {
  it('newlyAwardedPinIds returns met, not-yet-awarded pins and is idempotent', () => {
    // 5 completed attractions → Centurion 5 met, Centurion 15 not.
    const cat = Array.from({ length: 5 }, (_, i) => exp(`a${i}`, { category: 'Ride' }));
    const s = snap(cat, cat.map((e) => e.upstreamId));
    const first = newlyAwardedPinIds(s, new Set());
    expect(first).toContain('bronze_centurion_5');
    expect(first).not.toContain('bronze_centurion_15');
    // Idempotent: awarding again returns nothing new for those.
    const second = newlyAwardedPinIds(s, new Set(first));
    expect(second).not.toContain('bronze_centurion_5');
  });

  it('evaluateBoard marks awarded pins unlocked and locked pins with clamped progress', () => {
    const cat = Array.from({ length: 3 }, (_, i) => exp(`a${i}`, { category: 'Ride' }));
    const s = snap(cat, cat.map((e) => e.upstreamId));
    const board = evaluateBoard(
      s,
      new Map([['bronze_centurion_5', { awardedAt: '2026-01-02T00:00:00Z', claimedAt: null }]]),
    );
    const c5 = board.find((b) => b.pinId === 'bronze_centurion_5')!;
    expect(c5.unlocked).toBe(true);
    expect(c5.percentComplete).toBeNull();
    const c15 = board.find((b) => b.pinId === 'bronze_centurion_15')!;
    expect(c15.unlocked).toBe(false);
    expect(c15.percentComplete).toBeGreaterThanOrEqual(0);
    expect(c15.percentComplete).toBeLessThanOrEqual(99);
    // Locked pins always carry a null claimedAt (Requirement 20.1, Property 13).
    expect(c15.claimedAt).toBeNull();
    // The awarded-but-not-claimed pin carries claimedAt: null (ready to claim).
    expect(c5.claimedAt).toBeNull();
  });

  it('evaluateBoard carries claimedAt through for a claimed pin (Requirement 20.2)', () => {
    const cat = Array.from({ length: 3 }, (_, i) => exp(`a${i}`, { category: 'Ride' }));
    const s = snap(cat, cat.map((e) => e.upstreamId));
    const board = evaluateBoard(
      s,
      new Map([
        ['bronze_centurion_5', { awardedAt: '2026-01-02T00:00:00Z', claimedAt: '2026-01-03T00:00:00Z' }],
      ]),
    );
    const c5 = board.find((b) => b.pinId === 'bronze_centurion_5')!;
    expect(c5.unlocked).toBe(true);
    expect(c5.claimedAt).toBe('2026-01-03T00:00:00Z');
  });
});
