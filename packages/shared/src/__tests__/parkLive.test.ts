import { describe, it, expect } from 'vitest';
import {
  parkLiveEntrySchema,
  parkLiveSnapshotSchema,
  WALK_ON_THRESHOLD_MINUTES,
  HEADLINER_THRILL_FACET_VALUES,
} from '../index.js';

describe('ParkLive schemas and navigation constants (Tasks 1.1 - 1.4)', () => {
  it('accepts a well-formed snapshot', () => {
    const validSnapshot = {
      park: 'Magic Kingdom',
      retrievedAt: new Date().toISOString(),
      stale: false,
      entries: [
        {
          experienceId: '11111111-1111-4111-8111-111111111111',
          name: 'Space Mountain',
          status: 'OPERATING',
          waitMinutes: 45,
        },
        {
          experienceId: '22222222-2222-4222-8222-222222222222',
          name: 'Big Thunder Mountain Railroad',
          status: 'CLOSED',
          waitMinutes: null,
        },
      ],
    };

    const parsed = parkLiveSnapshotSchema.safeParse(validSnapshot);
    expect(parsed.success).toBe(true);
  });

  it('rejects negative waitMinutes', () => {
    const invalid = {
      experienceId: '11111111-1111-4111-8111-111111111111',
      name: 'Space Mountain',
      status: 'OPERATING',
      waitMinutes: -5,
    };
    expect(parkLiveEntrySchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects out-of-range waitMinutes (> 1440)', () => {
    const invalid = {
      experienceId: '11111111-1111-4111-8111-111111111111',
      name: 'Space Mountain',
      status: 'OPERATING',
      waitMinutes: 1441,
    };
    expect(parkLiveEntrySchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects non-uuid experienceId', () => {
    const invalid = {
      experienceId: 'not-a-uuid',
      name: 'Space Mountain',
      status: 'OPERATING',
      waitMinutes: 20,
    };
    expect(parkLiveEntrySchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects invalid park name in snapshot', () => {
    const invalid = {
      park: 'Universal Studios',
      retrievedAt: new Date().toISOString(),
      stale: false,
      entries: [],
    };
    expect(parkLiveSnapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it('verifies navigation constants', () => {
    expect(WALK_ON_THRESHOLD_MINUTES).toBe(25);
    expect(HEADLINER_THRILL_FACET_VALUES).toBeDefined();
    expect(HEADLINER_THRILL_FACET_VALUES.length).toBeGreaterThan(0);
    expect(HEADLINER_THRILL_FACET_VALUES).toContain('thrill-rides');
    expect(HEADLINER_THRILL_FACET_VALUES).toContain('big-drops');
  });

  it('accepts park live entry with lightningLane state', () => {
    const entryWithLL = {
      experienceId: '11111111-1111-4111-8111-111111111111',
      name: 'Space Mountain',
      status: 'OPERATING',
      waitMinutes: 40,
      lightningLane: {
        returnStart: '2026-09-17T18:15:00.000Z',
        returnEnd: '2026-09-17T19:15:00.000Z',
        state: 'AVAILABLE',
        price: {
          amount: 14,
          currency: 'USD',
        },
      },
    };
    expect(parkLiveEntrySchema.safeParse(entryWithLL).success).toBe(true);
  });
});
