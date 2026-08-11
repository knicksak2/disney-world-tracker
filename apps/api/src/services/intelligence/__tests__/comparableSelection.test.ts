import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { selectComparableIndices, COMPARABLE_DAY_WINDOW } from '../crowdForecast.js';
import type { ComparableHistoryRow } from '../crowdForecast.js';
import { createPredictionService } from '../predictionService.js';
import { displayLevel } from '../waitMath.js';

// Feature: crowd-calendar, Property 11: Comparable selection is calendar-proximate
// and preserves date-specific peaks.
describe('Property 11: selectComparableIndices — calendar-proximate comparable selection', () => {
  /** Helper: build a Date for a given month/day/year at noon UTC. */
  function makeDate(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }

  /** Helper: day-of-year (1-based). */
  function dayOfYear(d: Date): number {
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d.getTime() - start.getTime()) / 86400000);
  }

  /** Helper: circular distance on a 365-day ring. */
  function doyDistance(a: number, b: number): number {
    const diff = Math.abs(a - b);
    return Math.min(diff, 365 - diff);
  }

  // Property 11a: Only rows within ±COMPARABLE_DAY_WINDOW are returned.
  // fast-check, ≥100 runs, tagged.
  it('returns only rows within the window (incl. year-wrap), ≥100 runs', () => {
    fc.assert(
      fc.property(
        // Arbitrary target date: random month/day
        fc.integer({ min: 1, max: 12 }).chain(month =>
          fc.integer({ min: 1, max: 28 }).map(day => ({ month, day }))
        ),
        // Arbitrary history: 1-50 rows across 2-3 years
        fc.array(
          fc.record({
            year: fc.integer({ min: 2020, max: 2026 }),
            month: fc.integer({ min: 1, max: 12 }),
            day: fc.integer({ min: 1, max: 28 }),
            crowd_index: fc.double({ min: 0.4, max: 3.0, noNaN: true }),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (target, historySpec) => {
          const targetDate = makeDate(2025, target.month, target.day);
          const history: ComparableHistoryRow[] = historySpec.map(h => ({
            date: makeDate(h.year, h.month, h.day),
            crowd_index: h.crowd_index,
          }));

          const result = selectComparableIndices(targetDate, history);

          // Every returned value must correspond to a history row within the window
          const targetDoy = dayOfYear(targetDate);
          for (const val of result) {
            // Find the row(s) in history with this value
            const matchingRows = history.filter(r => r.crowd_index === val);
            expect(matchingRows.length).toBeGreaterThan(0);
            // At least one matching row must be within the window
            const inWindow = matchingRows.some(
              r => doyDistance(dayOfYear(r.date), targetDoy) <= COMPARABLE_DAY_WINDOW
            );
            expect(inWindow).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 11b: When history has a peak clustered near the target, the selected
  // mean >= the flat mean over all same-month+same-dow rows (the old behavior).
  it('selected mean ≥ flat month+dow mean when a peak is near the target, ≥100 runs', () => {
    fc.assert(
      fc.property(
        // Peak level 1.4–2.5, non-peak level 0.4–0.8
        fc.double({ min: 1.4, max: 2.5, noNaN: true }),
        fc.double({ min: 0.4, max: 0.8, noNaN: true }),
        fc.integer({ min: 2021, max: 2025 }),
        (peakLevel, quietLevel, year) => {
          // Target: Dec 26 (Christmas week)
          const targetDate = makeDate(2025, 12, 26);

          // Build history: peak rows near Dec 26 + quiet early-December rows
          // across the given year, all same month (December), some same dow
          const history: ComparableHistoryRow[] = [];

          // Peak cluster: Dec 24-31 at peakLevel
          for (let d = 24; d <= 31; d++) {
            history.push({ date: makeDate(year, 12, d), crowd_index: peakLevel });
          }
          // Quiet rows: Dec 1-15 at quietLevel (same month, some share dow)
          for (let d = 1; d <= 15; d++) {
            history.push({ date: makeDate(year, 12, d), crowd_index: quietLevel });
          }

          const selected = selectComparableIndices(targetDate, history);
          if (selected.length === 0) return; // degenerate — skip

          const selectedMean = selected.reduce((a, b) => a + b, 0) / selected.length;

          // Flat month+dow mean (the old behavior): all December rows sharing the target's dow
          const targetDow = targetDate.getDay();
          const sameMonthdow = history.filter(
            r => r.date.getMonth() === 11 && r.date.getDay() === targetDow
          );
          if (sameMonthdow.length === 0) return;
          const flatMean = sameMonthdow.reduce((a, b) => a + b.crowd_index, 0) / sameMonthdow.length;

          // The selected (proximity) mean should be >= the flat month+dow mean
          // because proximity preserves the peak, while flat averaging dilutes it.
          expect(selectedMean).toBeGreaterThanOrEqual(flatMean - 0.001); // tiny epsilon for FP
        }
      ),
      { numRuns: 100 }
    );
  });

  // Deterministic tests for key edge cases

  it('correctly wraps the Dec↔Jan year boundary', () => {
    // Target: Jan 2, 2025 — should match Dec 29 (within 4 days)
    const targetDate = makeDate(2025, 1, 2);
    const history: ComparableHistoryRow[] = [
      { date: makeDate(2024, 12, 29), crowd_index: 1.8 }, // 4 days before Jan 2 across the year boundary
      { date: makeDate(2024, 12, 20), crowd_index: 0.6 }, // 13 days — outside window
      { date: makeDate(2025, 1, 5), crowd_index: 1.4 },   // 3 days after — within window
      { date: makeDate(2025, 6, 15), crowd_index: 1.0 },  // totally unrelated
    ];

    const result = selectComparableIndices(targetDate, history);
    expect(result).toContain(1.8);
    expect(result).toContain(1.4);
    expect(result).not.toContain(0.6);
    expect(result).not.toContain(1.0);
  });

  it('prefers same-day-of-week when ≥3 samples exist', () => {
    // Target: June 18, 2025 = Wednesday (day 169)
    const targetDate = makeDate(2025, 6, 18);
    expect(targetDate.getDay()).toBe(3); // Verify Wednesday

    const history: ComparableHistoryRow[] = [];
    // 3 Wednesdays within the window in prior years (same day-of-year range)
    // June 18 ±7 → June 11–25
    history.push({ date: makeDate(2023, 6, 14), crowd_index: 1.5 }); // Wed, within window
    history.push({ date: makeDate(2024, 6, 19), crowd_index: 1.5 }); // Wed, within window
    history.push({ date: makeDate(2022, 6, 15), crowd_index: 1.5 }); // Wed, within window

    // Also put non-Wednesday rows within the window
    history.push({ date: makeDate(2024, 6, 17), crowd_index: 0.6 }); // Monday
    history.push({ date: makeDate(2024, 6, 20), crowd_index: 0.6 }); // Thursday

    const result = selectComparableIndices(targetDate, history);
    // Should prefer Wednesdays (≥3) and exclude the non-Wednesday rows
    expect(result.length).toBe(3);
    expect(result.every(v => v === 1.5)).toBe(true);
  });

  it('returns empty for empty history', () => {
    const result = selectComparableIndices(new Date(), []);
    expect(result).toEqual([]);
  });
});

// Integration test: predictionService with realistic late-December peak
// This test must fail against the old month+dow-averaging behavior.
describe('predictionService integration: late-December peak (R2.9)', () => {
  it('forecasts elevated displayLevel for Christmas week vs low for early December', async () => {
    // Seed rows: a realistic late-December peak plus quiet early December.
    // The seed data mirrors the real data: MK Dec 24-31 at level 7-8 (ratio 1.4-1.6),
    // early December at level 2-4 (ratio 0.4-0.8).
    const seedRows: { park: string; date: Date; crowd_index: number; daily_avg_wait: number; sample_count: number; source: string }[] = [];

    // Populate 2 years of December seed data
    for (const year of [2023, 2024]) {
      // Early December: quiet (level 2-4 → ratio 0.4-0.8)
      for (let d = 1; d <= 15; d++) {
        seedRows.push({
          park: 'Magic Kingdom',
          date: new Date(Date.UTC(year, 11, d)),
          crowd_index: 0.5, // level ~2-3
          daily_avg_wait: 20,
          sample_count: 0,
          source: 'seed',
        });
      }
      // Late December: peak (level 7-8 → ratio 1.4-1.6)
      for (let d = 24; d <= 31; d++) {
        seedRows.push({
          park: 'Magic Kingdom',
          date: new Date(Date.UTC(year, 11, d)),
          crowd_index: 1.6, // level ~8
          daily_avg_wait: 60,
          sample_count: 0,
          source: 'seed',
        });
      }
    }

    const fakeRepo = {
      getParkCrowdIndices: async () => [], // no exact date match — force forecast path
      getParkScheduleSignals: async () => [],
      getComparableCrowdIndices: async (_park: string, _targetDate: Date) => {
        // Return the seed rows as dated {date, crowd_index} pairs
        return seedRows.map(r => ({ date: r.date, crowd_index: r.crowd_index }));
      },
    } as any;

    const weatherClient = {
      getWDWWeather: async () => ({ current: null, forecast: [] }),
    } as any;

    const service = createPredictionService({
      repo: fakeRepo,
      weatherClient,
      now: () => new Date('2025-08-01T12:00:00Z'), // Far future so no live correction
    });

    // Christmas week: Dec 26, 2025
    const christmasRaw = await service.getRawForecast('Magic Kingdom', new Date('2025-12-26T00:00:00Z'));
    const christmasLevel = displayLevel(christmasRaw);

    // Early December: Dec 5, 2025
    const earlyDecRaw = await service.getRawForecast('Magic Kingdom', new Date('2025-12-05T00:00:00Z'));
    const earlyDecLevel = displayLevel(earlyDecRaw);

    // Christmas week should forecast elevated — NOT green (level 1-3).
    // With proximity selection, the comparables for Dec 26 are Dec 24-31 rows
    // (all at 1.6), so historyEstimate ≈ 1.6, which blends to a high forecast.
    expect(christmasLevel).toBeGreaterThanOrEqual(5); // At least "moderate" — not green
    expect(christmasRaw).toBeGreaterThanOrEqual(1.0); // Above typical

    // Early December should stay low.
    expect(earlyDecLevel).toBeLessThanOrEqual(5);

    // The key assertion: Christmas week forecast is strictly higher than early December.
    expect(christmasRaw).toBeGreaterThan(earlyDecRaw);

    // Old behavior would have averaged ALL December same-weekday rows,
    // diluting the 1.6 peak with the 0.5 quiet rows → mean ~0.85 → level 4 (green).
    // New behavior selects only nearby rows, so Christmas week sees 1.6 → level 8.
  });
});
