import { describe, expect, it } from 'vitest';

import { leaderboardEntrySchema } from '../LeaderboardEntry.js';

const BASE_ENTRY = {
  experienceId: '11111111-1111-4111-8111-111111111111',
  name: 'Sanaa',
  park: 'Magic Kingdom',
  category: 'Restaurant',
  value: 9.6,
  count: 14,
};

describe('leaderboardEntrySchema', () => {
  it('accepts a valid theme-park entry and a null-park resort entry', () => {
    expect(leaderboardEntrySchema.safeParse(BASE_ENTRY).success).toBe(true);
    expect(leaderboardEntrySchema.safeParse({ ...BASE_ENTRY, park: null }).success).toBe(true);
  });

  it('rejects an unknown non-null park string and counts below 3', () => {
    expect(
      leaderboardEntrySchema.safeParse({ ...BASE_ENTRY, park: 'Unknown Park' }).success,
    ).toBe(false);
    expect(
      leaderboardEntrySchema.safeParse({ ...BASE_ENTRY, park: null, count: 2 }).success,
    ).toBe(false);
  });
});
