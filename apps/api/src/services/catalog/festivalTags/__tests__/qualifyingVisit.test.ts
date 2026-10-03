/**
 * Unit tests for `qualifyingVisit.ts`'s pure core.
 *
 * Validates: Requirements 9.4, 9.5, 10.3, 11.1, 11.2, 11.3
 */

import { describe, expect, it } from 'vitest';

import {
  isQualifyingVisit,
  withinWindow,
  type FestivalEditionWindow,
  type QualifyingSignal,
} from '../qualifyingVisit.js';

const TODAY = '2026-11-20';

describe('withinWindow', () => {
  it('returns true for any date when window is null (R9.4: no restriction)', () => {
    expect(withinWindow('2020-01-01', null, TODAY)).toBe(true);
    expect(withinWindow('2099-01-01', null, TODAY)).toBe(true);
  });

  it('returns false for a date before startsOn', () => {
    const window: FestivalEditionWindow = { startsOn: '2026-08-28', endsOn: '2026-11-18' };
    expect(withinWindow('2026-08-27', window, TODAY)).toBe(false);
  });

  it('returns true for a date exactly on startsOn (inclusive)', () => {
    const window: FestivalEditionWindow = { startsOn: '2026-08-28', endsOn: '2026-11-18' };
    expect(withinWindow('2026-08-28', window, TODAY)).toBe(true);
  });

  it('returns true for a date exactly on ends_on (inclusive)', () => {
    const window: FestivalEditionWindow = { startsOn: '2026-08-28', endsOn: '2026-11-18' };
    expect(withinWindow('2026-11-18', window, TODAY)).toBe(true);
  });

  it('returns false for a date after ends_on', () => {
    const window: FestivalEditionWindow = { startsOn: '2026-08-28', endsOn: '2026-11-18' };
    expect(withinWindow('2026-11-19', window, TODAY)).toBe(false);
  });

  it('treats a null endsOn as "today" (R9.5: still running)', () => {
    const window: FestivalEditionWindow = { startsOn: '2026-08-28', endsOn: null };
    expect(withinWindow(TODAY, window, TODAY)).toBe(true);
    expect(withinWindow('2026-11-21', window, TODAY)).toBe(false);
  });
});

describe('isQualifyingVisit — facet-matched (temporary booth)', () => {
  it('qualifies via a completion alone (R11.1)', () => {
    const signal: QualifyingSignal = {
      matchKind: 'facet',
      completionDate: '2026-09-01',
      qualifyingFoodLogDates: [],
    };
    expect(isQualifyingVisit(signal, null, TODAY)).toBe(true);
  });

  it('qualifies via a food log alone, with no completion (R11.1)', () => {
    const signal: QualifyingSignal = {
      matchKind: 'facet',
      completionDate: null,
      qualifyingFoodLogDates: ['2026-09-01'],
    };
    expect(isQualifyingVisit(signal, null, TODAY)).toBe(true);
  });

  it('does not qualify with neither a completion nor a food log', () => {
    const signal: QualifyingSignal = {
      matchKind: 'facet',
      completionDate: null,
      qualifyingFoodLogDates: [],
    };
    expect(isQualifyingVisit(signal, null, TODAY)).toBe(false);
  });

  it('does not qualify when the only completion falls outside the window', () => {
    const signal: QualifyingSignal = {
      matchKind: 'facet',
      completionDate: '2026-07-01',
      qualifyingFoodLogDates: [],
    };
    const window: FestivalEditionWindow = { startsOn: '2026-08-28', endsOn: '2026-11-18' };
    expect(isQualifyingVisit(signal, window, TODAY)).toBe(false);
  });
});

describe('isQualifyingVisit — menu-matched (permanent restaurant)', () => {
  it('does NOT qualify from a completion alone, even with no food log at all (R10.3, R11.2)', () => {
    const signal: QualifyingSignal = {
      matchKind: 'menu',
      completionDate: '2026-09-01',
      qualifyingFoodLogDates: [],
    };
    expect(isQualifyingVisit(signal, null, TODAY)).toBe(false);
  });

  it('qualifies via a qualifying (tagged-dish) food log, regardless of completion state (R10.3)', () => {
    const signal: QualifyingSignal = {
      matchKind: 'menu',
      completionDate: null,
      qualifyingFoodLogDates: ['2026-09-01'],
    };
    expect(isQualifyingVisit(signal, null, TODAY)).toBe(true);
  });

  it('qualifies via a tagged-dish food log even alongside a present completion', () => {
    const signal: QualifyingSignal = {
      matchKind: 'menu',
      completionDate: '2026-09-01',
      qualifyingFoodLogDates: ['2026-09-01'],
    };
    expect(isQualifyingVisit(signal, null, TODAY)).toBe(true);
  });

  it('does not qualify when the only qualifying food log falls outside the window', () => {
    const signal: QualifyingSignal = {
      matchKind: 'menu',
      completionDate: null,
      qualifyingFoodLogDates: ['2026-07-01'],
    };
    const window: FestivalEditionWindow = { startsOn: '2026-08-28', endsOn: '2026-11-18' };
    expect(isQualifyingVisit(signal, window, TODAY)).toBe(false);
  });
});
