/**
 * Unit tests for pure festival stats roll-up (Feature: festival-booth-tagging, Requirement 5).
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.5, 6.1
 */

import { describe, expect, it } from 'vitest';
import { FESTIVAL_SLUGS } from '@dwt/shared';
import { rollUpFestivalStats, type RawFestivalCountRow } from '../festivals.js';

describe('rollUpFestivalStats', () => {
  it('passes through lifetimeCount and returns empty byFestival for empty rows', () => {
    const result = rollUpFestivalStats(0, []);
    expect(result).toEqual({
      lifetimeCount: 0,
      byFestival: [],
    });
  });

  it('omits zero-count festivals (R5.5)', () => {
    const rows: RawFestivalCountRow[] = [
      { slug: 'food-and-wine', n: 5 },
      { slug: 'flower-and-garden', n: 0 },
      { slug: 'festival-of-the-arts', n: '0' },
      { slug: 'festival-of-the-holidays', n: 2 },
    ];
    const result = rollUpFestivalStats(7, rows);
    expect(result.lifetimeCount).toBe(7);
    expect(result.byFestival).toEqual([
      { slug: 'food-and-wine', count: 5 },
      { slug: 'festival-of-the-holidays', count: 2 },
    ]);
  });

  it('handles string numbers from postgres driver (e.g. bigint / COUNT)', () => {
    const rows: RawFestivalCountRow[] = [
      { slug: 'food-and-wine', n: '12' },
      { slug: 'flower-and-garden', n: '3' },
    ];
    const result = rollUpFestivalStats(15, rows);
    expect(result.byFestival).toEqual([
      { slug: 'food-and-wine', count: 12 },
      { slug: 'flower-and-garden', count: 3 },
    ]);
  });

  it('sorts by count descending', () => {
    const rows: RawFestivalCountRow[] = [
      { slug: 'festival-of-the-arts', n: 3 },
      { slug: 'food-and-wine', n: 10 },
      { slug: 'flower-and-garden', n: 7 },
    ];
    const result = rollUpFestivalStats(20, rows);
    expect(result.byFestival.map((f) => f.slug)).toEqual([
      'food-and-wine',
      'flower-and-garden',
      'festival-of-the-arts',
    ]);
  });

  it('breaks ties by slug ascending (total deterministic sort order)', () => {
    // Both flower-and-garden and food-and-wine have count 5
    // flower-and-garden comes before food-and-wine alphabetically
    const rows: RawFestivalCountRow[] = [
      { slug: 'food-and-wine', n: 5 },
      { slug: 'flower-and-garden', n: 5 },
    ];
    const result = rollUpFestivalStats(10, rows);
    expect(result.byFestival).toEqual([
      { slug: 'flower-and-garden', count: 5 },
      { slug: 'food-and-wine', count: 5 },
    ]);
  });

  it('correctly handles all four known festival slugs', () => {
    const rows: RawFestivalCountRow[] = FESTIVAL_SLUGS.map((slug, idx) => ({
      slug,
      n: idx + 1,
    }));
    const result = rollUpFestivalStats(10, rows);
    expect(result.byFestival).toHaveLength(4);
    expect(result.byFestival[0]?.count).toBeGreaterThanOrEqual(result.byFestival[1]?.count ?? 0);
  });
});
