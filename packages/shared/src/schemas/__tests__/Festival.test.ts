/**
 * Unit tests for festival schemas.
 *
 * Validates: Requirements 1.2, 5.3, 5.4, 6.1 (Property 28)
 */

import { describe, expect, it } from 'vitest';
import { FESTIVAL_SLUGS, PARKS, EXPERIENCE_CATEGORIES } from '../../enums.js';
import { festivalSlugSchema } from '../Festival.js';
import { festivalStatsSchema, statsSchema } from '../Stats.js';
import type { FestivalStatsDTO, StatsDTO } from '../../dto/Stats.js';

describe('festivalSlugSchema', () => {
  it('accepts every FESTIVAL_SLUGS member', () => {
    for (const slug of FESTIVAL_SLUGS) {
      const result = festivalSlugSchema.safeParse(slug);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(slug);
      }
    }
  });

  it('rejects an arbitrary string', () => {
    expect(festivalSlugSchema.safeParse('not-a-festival').success).toBe(false);
    expect(festivalSlugSchema.safeParse('').success).toBe(false);
    expect(festivalSlugSchema.safeParse(123).success).toBe(false);
    expect(festivalSlugSchema.safeParse(null).success).toBe(false);
  });
});

describe('festivalStatsSchema', () => {
  const validFestivalStats: FestivalStatsDTO = {
    lifetimeCount: 5,
    byFestival: [
      { slug: 'food-and-wine', count: 3 },
      { slug: 'flower-and-garden', count: 2 },
    ],
  };

  it('accepts a valid FestivalStatsDTO', () => {
    const result = festivalStatsSchema.safeParse(validFestivalStats);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validFestivalStats);
    }
  });

  it('accepts an empty/zero festival stats shape', () => {
    const emptyStats: FestivalStatsDTO = {
      lifetimeCount: 0,
      byFestival: [],
    };
    expect(festivalStatsSchema.safeParse(emptyStats).success).toBe(true);
  });

  it('rejects count: 0 in byFestival', () => {
    const invalid = {
      lifetimeCount: 1,
      byFestival: [
        { slug: 'food-and-wine', count: 0 },
      ],
    };
    const result = festivalStatsSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects negative lifetimeCount', () => {
    const invalid = {
      lifetimeCount: -1,
      byFestival: [],
    };
    expect(festivalStatsSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects extra percent or total fields (Property 28)', () => {
    const withPercent = {
      lifetimeCount: 5,
      percent: 50.0,
      byFestival: [
        { slug: 'food-and-wine', count: 3 },
      ],
    };
    expect(festivalStatsSchema.safeParse(withPercent).success).toBe(false);

    const withTotal = {
      lifetimeCount: 5,
      total: 10,
      byFestival: [
        { slug: 'food-and-wine', count: 3 },
      ],
    };
    expect(festivalStatsSchema.safeParse(withTotal).success).toBe(false);

    const withByFestivalPercent = {
      lifetimeCount: 5,
      byFestival: [
        { slug: 'food-and-wine', count: 3, percent: 60.0 },
      ],
    };
    expect(festivalStatsSchema.safeParse(withByFestivalPercent).success).toBe(false);
  });
});

describe('statsSchema with festivals', () => {
  const zeroBreakdown = { completed: 0, total: 0, percent: 0 };
  const validStats: StatsDTO = {
    overall: zeroBreakdown,
    perPark: Object.fromEntries(PARKS.map((p) => [p, zeroBreakdown])) as StatsDTO['perPark'],
    perCategory: Object.fromEntries(EXPERIENCE_CATEGORIES.map((c) => [c, zeroBreakdown])) as StatsDTO['perCategory'],
    festivals: {
      lifetimeCount: 2,
      byFestival: [{ slug: 'food-and-wine', count: 2 }],
    },
  };

  it('accepts valid StatsDTO containing festivals', () => {
    expect(statsSchema.safeParse(validStats).success).toBe(true);
  });

  it('rejects StatsDTO missing festivals field because statsSchema is strict', () => {
    const { festivals: _, ...missingFestivals } = validStats;
    expect(statsSchema.safeParse(missingFestivals).success).toBe(false);
  });
});
