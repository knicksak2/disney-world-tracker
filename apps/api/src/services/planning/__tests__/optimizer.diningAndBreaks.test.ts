import { describe, expect, it } from 'vitest';
import type { WaitSnapshot } from '@dwt/shared';
import {
  DEFAULT_BREAK_DUR,
  DEFAULT_RIDE_DUR,
  DEFAULT_SHOW_DURATION_MIN,
  optimize,
  resolveDefaultDuration,
  type OptimizeInput,
  type OptimizeInputItem,
} from '../optimizer.js';

function makeItem(overrides: Partial<OptimizeInputItem> = {}): OptimizeInputItem {
  return {
    id: 'item-1',
    experienceId: 'exp-1',
    park: 'Magic Kingdom',
    coords: { lat: 28.4177, lng: -81.5812 },
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    durationMinutes: null,
    ...overrides,
  };
}

describe('Optimizer Duration Precedence (R3.14, Property 13)', () => {
  it('respects user override (durationMinutes) above all else', () => {
    expect(
      resolveDefaultDuration(
        makeItem({
          durationMinutes: 45,
          category: 'Restaurant',
          subType: 'Table Service',
        })
      )
    ).toBe(45);

    expect(
      resolveDefaultDuration(
        makeItem({
          durationMinutes: 90,
          itemType: 'break',
        })
      )
    ).toBe(90);

    expect(
      resolveDefaultDuration(
        makeItem({
          durationMinutes: 20,
          category: 'Show',
          catalogDurationMinutes: 40,
        })
      )
    ).toBe(20);

    expect(
      resolveDefaultDuration(
        makeItem({
          durationMinutes: 30,
          category: 'Ride',
        })
      )
    ).toBe(30);
  });

  it('defaults breaks to DEFAULT_BREAK_DUR (60 min)', () => {
    expect(
      resolveDefaultDuration(
        makeItem({
          itemType: 'break',
          durationMinutes: null,
        })
      )
    ).toBe(DEFAULT_BREAK_DUR);
  });

  it('derives dining duration from sub_type (Quick 30, Table 60, Signature 90, unknown 60)', () => {
    expect(
      resolveDefaultDuration(
        makeItem({
          category: 'Restaurant',
          subType: 'Quick Service',
          durationMinutes: null,
        })
      )
    ).toBe(30);

    expect(
      resolveDefaultDuration(
        makeItem({
          category: 'Restaurant',
          subType: 'Counter Service',
          durationMinutes: null,
        })
      )
    ).toBe(30);

    expect(
      resolveDefaultDuration(
        makeItem({
          category: 'Restaurant',
          subType: 'Table Service',
          durationMinutes: null,
        })
      )
    ).toBe(60);

    expect(
      resolveDefaultDuration(
        makeItem({
          category: 'Restaurant',
          subType: 'Fine / Signature Dining',
          durationMinutes: null,
        })
      )
    ).toBe(90);

    expect(
      resolveDefaultDuration(
        makeItem({
          category: 'Restaurant',
          subType: null,
          durationMinutes: null,
        })
      )
    ).toBe(60);
  });

  it('derives show/parade duration from catalogDurationMinutes ?? 30', () => {
    expect(
      resolveDefaultDuration(
        makeItem({
          category: 'Show',
          catalogDurationMinutes: 42,
          durationMinutes: null,
        })
      )
    ).toBe(42);

    expect(
      resolveDefaultDuration(
        makeItem({
          category: 'Show',
          catalogDurationMinutes: null,
          durationMinutes: null,
        })
      )
    ).toBe(DEFAULT_SHOW_DURATION_MIN);

    expect(
      resolveDefaultDuration(
        makeItem({
          category: 'Parade',
          catalogDurationMinutes: 25,
          durationMinutes: null,
        })
      )
    ).toBe(25);

    expect(
      resolveDefaultDuration(
        makeItem({
          category: 'Parade',
          catalogDurationMinutes: null,
          durationMinutes: null,
        })
      )
    ).toBe(DEFAULT_SHOW_DURATION_MIN);
  });

  it('defaults rides/attractions to DEFAULT_RIDE_DUR (15 min), ignoring catalog duration', () => {
    expect(
      resolveDefaultDuration(
        makeItem({
          category: 'Ride',
          catalogDurationMinutes: 4, // 4-min ride length does NOT override 15-min operational duration
          durationMinutes: null,
        })
      )
    ).toBe(DEFAULT_RIDE_DUR);

    expect(
      resolveDefaultDuration(
        makeItem({
          category: null,
          durationMinutes: null,
        })
      )
    ).toBe(DEFAULT_RIDE_DUR);
  });
});

describe('Zero Queue Wait for Dining and Breaks (R3.14, Property 13)', () => {
  it('models 0 queue wait for dining and break items while preserving ride queue wait', () => {
    const snapshots: Record<string, WaitSnapshot> = {
      'exp-ride': {
        experienceId: 'exp-ride',
        isVirtualQueue: false,
        waits: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          predictedWaitMinutes: 45,
        })),
      },
      'exp-dining': {
        experienceId: 'exp-dining',
        isVirtualQueue: false,
        waits: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          predictedWaitMinutes: 45, // even if snapshot carries waits, dining must have 0 wait
        })),
      },
    };

    const input: OptimizeInput = {
      date: '2026-10-01',
      earlyEntryEligible: false,
      walkingSpeed: 'moderate',
      snapshots,
      startHour: 10, // 10:00 AM ET (well past rope drop window)
      endHour: 20,
      items: [
        makeItem({
          id: 'item-ride',
          experienceId: 'exp-ride',
          coords: { lat: 28.4177, lng: -81.5812 },
          category: 'Ride',
          plannedTime: '2026-10-01T15:00:00.000Z', // 11:00 AM ET (outside 30m rope drop window)
          isFixed: true,
        }),
        makeItem({
          id: 'item-dining',
          experienceId: 'exp-dining',
          coords: { lat: 28.4178, lng: -81.5813 },
          category: 'Restaurant',
          subType: 'Table Service',
        }),
        makeItem({
          id: 'item-break',
          experienceId: 'exp-break',
          coords: { lat: 28.4179, lng: -81.5814 },
          itemType: 'break',
          durationMinutes: 45,
        }),
      ],
    };

    const result = optimize(input);
    expect(result.unfittedItemIds).toEqual([]);
    expect(result.items).toHaveLength(3);

    const rideRes = result.items.find((i) => i.plannedItemId === 'item-ride')!;
    const diningRes = result.items.find((i) => i.plannedItemId === 'item-dining')!;
    const breakRes = result.items.find((i) => i.plannedItemId === 'item-break')!;

    expect(rideRes.predictedWaitMinutes).toBe(45);
    expect(diningRes.predictedWaitMinutes).toBe(0);
    expect(breakRes.predictedWaitMinutes).toBe(0);
  });
});

describe('Travel Chain Linkage and Resort Transit (A1, R3.4, Property 14)', () => {
  it('charges 45m park_hop transit to a located resort (null park) and 45m park_hop from it back to a park ride', () => {
    // Magic Kingdom ride -> Polynesian Resort (null park, null coords) -> Magic Kingdom ride
    const input: OptimizeInput = {
      date: '2026-10-01',
      earlyEntryEligible: false,
      walkingSpeed: 'moderate',
      snapshots: {},
      startHour: 10,
      endHour: 20,
      items: [
        makeItem({
          id: 'mk-ride-1',
          experienceId: 'exp-mk-1',
          park: 'Magic Kingdom',
          coords: { lat: 28.4177, lng: -81.5812 },
          category: 'Ride',
          plannedTime: '2026-10-01T14:00:00.000Z', // 10:00 AM ET
          isFixed: true,
          durationMinutes: 15,
        }),
        makeItem({
          id: 'resort-item',
          experienceId: 'exp-poly-resort', // Located resort (experienceId NOT null)
          park: null, // Catalog resorts have park = null
          coords: null, // and coords = null
          category: 'Resort',
          plannedTime: '2026-10-01T15:00:00.000Z', // 11:00 AM ET
          isFixed: true,
          durationMinutes: 60,
        }),
        makeItem({
          id: 'mk-ride-2',
          experienceId: 'exp-mk-2',
          park: 'Magic Kingdom',
          coords: { lat: 28.4180, lng: -81.5815 },
          category: 'Ride',
          plannedTime: '2026-10-01T17:00:00.000Z', // 1:00 PM ET
          isFixed: true,
          durationMinutes: 15,
        }),
      ],
    };

    const result = optimize(input);
    expect(result.unfittedItemIds).toEqual([]);
    expect(result.items).toHaveLength(3);

    const mk1 = result.items.find((i) => i.plannedItemId === 'mk-ride-1')!;
    const resort = result.items.find((i) => i.plannedItemId === 'resort-item')!;
    const mk2 = result.items.find((i) => i.plannedItemId === 'mk-ride-2')!;

    expect(mk1.travelFromPrev).toBeNull();
    // Leg 1: MK -> Resort (null park) MUST be park_hop (45 min)
    expect(resort.travelFromPrev).toEqual({ kind: 'park_hop', minutes: 45 });
    // Leg 2: Resort (null park) -> MK MUST be park_hop (45 min), NOT intra-MK walk from mk-ride-1
    expect(mk2.travelFromPrev).toEqual({ kind: 'park_hop', minutes: 45 });
  });

  it('keeps unlocated breaks travel-neutral while preserving travel between adjacent located items', () => {
    // MK ride 1 -> unlocated break -> MK ride 2 (same park, known coords)
    const input: OptimizeInput = {
      date: '2026-10-01',
      earlyEntryEligible: false,
      walkingSpeed: 'moderate',
      snapshots: {},
      startHour: 10,
      endHour: 20,
      items: [
        makeItem({
          id: 'mk-ride-1',
          experienceId: 'exp-mk-1',
          park: 'Magic Kingdom',
          coords: { lat: 28.4177, lng: -81.5812 },
          category: 'Ride',
          plannedTime: '2026-10-01T14:00:00.000Z',
          isFixed: true,
          durationMinutes: 15,
        }),
        makeItem({
          id: 'unlocated-break',
          experienceId: null, // UNLOCATED break
          park: null,
          coords: null,
          itemType: 'break',
          plannedTime: '2026-10-01T15:00:00.000Z',
          isFixed: true,
          durationMinutes: 45,
        }),
        makeItem({
          id: 'mk-ride-2',
          experienceId: 'exp-mk-2',
          park: 'Magic Kingdom',
          coords: { lat: 28.4200, lng: -81.5812 }, // ~256m walk
          category: 'Ride',
          plannedTime: '2026-10-01T16:00:00.000Z',
          isFixed: true,
          durationMinutes: 15,
        }),
      ],
    };

    const result = optimize(input);
    const unlocated = result.items.find((i) => i.plannedItemId === 'unlocated-break')!;
    const mk2 = result.items.find((i) => i.plannedItemId === 'mk-ride-2')!;

    // Unlocated break has no travel
    expect(unlocated.travelFromPrev).toBeNull();
    // MK ride 2 computes travel directly from MK ride 1 (walk, not hop)
    expect(mk2.travelFromPrev?.kind).toBe('walk');
    expect(mk2.travelFromPrev?.minutes).toBeGreaterThan(0);
  });
});

describe('Non-Ride Zero-Wait Whitelist (A2, R3.14, Property 13)', () => {
  it('models wait = 0 and non-ride default duration for Resort and Spa items without snapshot fallback queue', () => {
    const input: OptimizeInput = {
      date: '2026-10-01',
      earlyEntryEligible: false,
      walkingSpeed: 'moderate',
      snapshots: {}, // No snapshots provided
      startHour: 10,
      endHour: 20,
      items: [
        makeItem({
          id: 'resort-item',
          experienceId: 'exp-resort',
          category: 'Resort',
          park: null,
          coords: null,
          durationMinutes: null,
        }),
        makeItem({
          id: 'spa-item',
          experienceId: 'exp-spa',
          category: 'Spa',
          park: null,
          coords: null,
          durationMinutes: null,
        }),
        makeItem({
          id: 'ride-item',
          experienceId: 'exp-ride',
          category: 'Ride',
          park: 'Magic Kingdom',
          coords: null,
          durationMinutes: null,
        }),
      ],
    };

    const result = optimize(input);
    expect(result.unfittedItemIds).toEqual([]);

    const resort = result.items.find((i) => i.plannedItemId === 'resort-item')!;
    const spa = result.items.find((i) => i.plannedItemId === 'spa-item')!;
    const ride = result.items.find((i) => i.plannedItemId === 'ride-item')!;

    // Resort & Spa MUST have 0 wait (no phantom 30-min queue)
    expect(resort.predictedWaitMinutes).toBe(0);
    expect(spa.predictedWaitMinutes).toBe(0);
    // Ride gets 30m default when no snapshot exists
    expect(ride.predictedWaitMinutes).toBe(30);

    // Duration defaults
    expect(resolveDefaultDuration(makeItem({ category: 'Resort', durationMinutes: null }))).toBe(60);
    expect(resolveDefaultDuration(makeItem({ category: 'Spa', durationMinutes: null }))).toBe(60);
    expect(resolveDefaultDuration(makeItem({ category: 'Ride', durationMinutes: null }))).toBe(DEFAULT_RIDE_DUR);
  });
});

describe('Same-Kind Downtime Adjacency Penalty (A3, R3.18, Property 18)', () => {
  it('separates a flexible snack from lunch when an attraction is available', () => {
    // 1 fixed lunch (12:00 PM), 1 flexible snack (category Restaurant), 1 flexible ride
    const input: OptimizeInput = {
      date: '2026-10-01',
      earlyEntryEligible: false,
      walkingSpeed: 'moderate',
      snapshots: {},
      startHour: 10,
      endHour: 20,
      seed: 42,
      items: [
        makeItem({
          id: 'lunch-item',
          experienceId: 'exp-lunch',
          category: 'Restaurant',
          subType: 'Table Service',
          park: 'Magic Kingdom',
          coords: { lat: 28.4177, lng: -81.5812 },
          plannedTime: '2026-10-01T16:00:00.000Z', // 12:00 PM ET
          isFixed: true,
          durationMinutes: 60,
        }),
        makeItem({
          id: 'snack-item',
          experienceId: 'exp-snack',
          category: 'Restaurant',
          subType: 'Quick Service',
          park: 'Magic Kingdom',
          coords: { lat: 28.4178, lng: -81.5813 },
          durationMinutes: 30,
          priority: 2,
        }),
        makeItem({
          id: 'ride-item',
          experienceId: 'exp-ride',
          category: 'Ride',
          park: 'Magic Kingdom',
          coords: { lat: 28.4179, lng: -81.5814 },
          durationMinutes: 15,
          priority: 2,
        }),
      ],
    };

    const result = optimize(input);
    expect(result.unfittedItemIds).toEqual([]);
    expect(result.items).toHaveLength(3);

    // Snack and lunch should not be adjacent when ride can separate them
    const lunchIdx = result.items.findIndex((i) => i.plannedItemId === 'lunch-item');
    const snackIdx = result.items.findIndex((i) => i.plannedItemId === 'snack-item');
    expect(Math.abs(lunchIdx - snackIdx)).toBeGreaterThan(1);
    expect(result.warnings.some((w) => w.startsWith('adjacent_dining'))).toBe(false);
  });

  it('allows a break adjacent to dining without penalty', () => {
    // Polynesian break followed by 'Ohana dinner
    const input: OptimizeInput = {
      date: '2026-10-01',
      earlyEntryEligible: false,
      walkingSpeed: 'moderate',
      snapshots: {},
      startHour: 10,
      endHour: 20,
      seed: 42,
      items: [
        makeItem({
          id: 'break-item',
          experienceId: 'exp-poly',
          itemType: 'break',
          park: null,
          coords: null,
          plannedTime: '2026-10-01T17:00:00.000Z', // 1:00 PM ET
          isFixed: true,
          durationMinutes: 60,
        }),
        makeItem({
          id: 'dinner-item',
          experienceId: 'exp-ohana',
          category: 'Restaurant',
          subType: 'Table Service',
          park: null,
          coords: null,
          plannedTime: '2026-10-01T18:00:00.000Z', // 2:00 PM ET
          isFixed: true,
          durationMinutes: 60,
        }),
      ],
    };

    const result = optimize(input);
    expect(result.unfittedItemIds).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith('adjacent_'))).toBe(false);
  });

  it('produces an optimized plan for a downtime-only day without failure (soft penalty)', () => {
    // 3 flexible meals on a dining day
    const input: OptimizeInput = {
      date: '2026-10-01',
      earlyEntryEligible: false,
      walkingSpeed: 'moderate',
      snapshots: {},
      startHour: 10,
      endHour: 20,
      seed: 42,
      items: [
        makeItem({
          id: 'meal-1',
          experienceId: 'exp-1',
          category: 'Restaurant',
          durationMinutes: 60,
          priority: 1,
        }),
        makeItem({
          id: 'meal-2',
          experienceId: 'exp-2',
          category: 'Restaurant',
          durationMinutes: 60,
          priority: 2,
        }),
      ],
    };

    const result = optimize(input);
    expect(result.unfittedItemIds).toEqual([]);
    expect(result.items).toHaveLength(2);
    // Since only 2 meals exist, they must be adjacent and emit warning
    expect(result.warnings.some((w) => w.startsWith('adjacent_dining'))).toBe(true);
  });

  it('exempts two user-pinned items from the adjacency penalty', () => {
    const input: OptimizeInput = {
      date: '2026-10-01',
      earlyEntryEligible: false,
      walkingSpeed: 'moderate',
      snapshots: {},
      startHour: 10,
      endHour: 20,
      seed: 42,
      items: [
        makeItem({
          id: 'fixed-lunch',
          experienceId: 'exp-lunch',
          category: 'Restaurant',
          plannedTime: '2026-10-01T16:00:00.000Z', // 12:00 PM ET
          isFixed: true,
          durationMinutes: 60,
        }),
        makeItem({
          id: 'fixed-dessert',
          experienceId: 'exp-dessert',
          category: 'Restaurant',
          plannedTime: '2026-10-01T17:00:00.000Z', // 1:00 PM ET
          isFixed: true,
          durationMinutes: 30,
        }),
      ],
    };

    const result = optimize(input);
    expect(result.unfittedItemIds).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith('adjacent_dining'))).toBe(false);
  });
});

