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
