import { describe, expect, it } from 'vitest';
import type { WaitSnapshot } from '@dwt/shared';
import {
  optimize,
  SHOW_ARRIVAL_BUFFER_MIN,
  type OptimizeInput,
  type OptimizeInputItem,
} from '../optimizer.js';

function makeItem(overrides: Partial<OptimizeInputItem> = {}): OptimizeInputItem {
  return {
    id: 'item-show',
    experienceId: 'exp-show-1',
    park: 'Magic Kingdom',
    coords: { lat: 28.4177, lng: -81.5812 },
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    durationMinutes: null,
    category: 'Show',
    ...overrides,
  };
}

describe('Optimizer Showtime Scheduling (R8.1, Property 15)', () => {
  it('schedules arrival to doors time (15 min before showtime) and charges idle gap', () => {
    const snapshots: Record<string, WaitSnapshot> = {
      'exp-show-1': {
        experienceId: 'exp-show-1',
        isVirtualQueue: false,
        waits: Array.from({ length: 14 }, (_, i) => ({
          hour: i + 8,
          predictedWaitMinutes: 0,
        })),
        showtimes: ['2026-10-01T16:00:00.000Z', '2026-10-01T19:00:00.000Z'], // 12:00 PM & 3:00 PM EDT
      },
    };

    const input: OptimizeInput = {
      items: [
        makeItem({
          id: 'item-show-1',
          experienceId: 'exp-show-1',
          durationMinutes: 30,
        }),
      ],
      date: '2026-10-01',
      snapshots,
      startHour: 9,
      endHour: 21,
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
    };

    const result = optimize(input);

    expect(result.items.length).toBe(1);
    const item = result.items[0]!;

    // Day starts at 9:00 AM (540 mins).
    // Earliest show is 12:00 PM (720 mins).
    // Doors open 15 min before = 11:45 AM (705 mins).
    // Arrival is clamped to 11:45 AM (705 mins).
    // Idle gap = 705 - 540 = 165 mins.
    // Predicted wait = 15 mins.
    // Total wait = 15 (wait) + 165 (idle) = 180 mins.
    expect(item.predictedWaitMinutes).toBe(SHOW_ARRIVAL_BUFFER_MIN);
    expect(result.totalWaitMinutes).toBe(180);
    expect(result.warnings).toContain('show:item-show-1');

    // 12:00 PM ET on 2026-10-01 (EDT is UTC-4) is 16:00:00.000Z
    // Doors at 11:45 AM ET is 15:45:00.000Z
    expect(item.suggestedArrival).toBe('2026-10-01T15:45:00.000Z');
    expect(item.scheduledShowtime).toBe('2026-10-01T16:00:00.000Z');
  });

  it('picks the next available showtime after preceding items finish', () => {
    const snapshots: Record<string, WaitSnapshot> = {
      'exp-ride-1': {
        experienceId: 'exp-ride-1',
        isVirtualQueue: false,
        waits: Array.from({ length: 14 }, (_, i) => ({
          hour: i + 8,
          predictedWaitMinutes: 10,
        })),
      },
      'exp-show-1': {
        experienceId: 'exp-show-1',
        isVirtualQueue: false,
        waits: Array.from({ length: 14 }, (_, i) => ({
          hour: i + 8,
          predictedWaitMinutes: 0,
        })),
        showtimes: [
          '2026-10-01T14:00:00.000Z', // 10:00 AM EDT
          '2026-10-01T17:00:00.000Z', // 1:00 PM EDT
          '2026-10-01T20:00:00.000Z', // 4:00 PM EDT
        ],
      },
    };

    // Ride at 9:00 AM (540m) + 10m wait + 15m dur = 565m (9:25 AM).
    // Walk to show = 5m -> arrives at 9:30 AM (570m).
    // 10:00 AM show doors open at 9:45 AM (585m) >= 570m.
    // Show is scheduled for 10:00 AM show (doors at 9:45 AM).
    const input: OptimizeInput = {
      items: [
        makeItem({
          id: 'item-ride-1',
          experienceId: 'exp-ride-1',
          category: 'Ride',
        }),
        makeItem({
          id: 'item-show-1',
          experienceId: 'exp-show-1',
          category: 'Show',
          durationMinutes: 20,
        }),
      ],
      date: '2026-10-01',
      snapshots,
      startHour: 9,
      endHour: 21,
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
    };

    const result = optimize(input);

    expect(result.items.length).toBe(2);
    const showResult = result.items.find((i) => i.plannedItemId === 'item-show-1')!;
    expect(showResult.predictedWaitMinutes).toBe(SHOW_ARRIVAL_BUFFER_MIN);
    expect(showResult.suggestedArrival).toBe('2026-10-01T13:45:00.000Z'); // 9:45 AM EDT
    expect(showResult.scheduledShowtime).toBe('2026-10-01T14:00:00.000Z'); // 10:00 AM EDT
    expect(result.warnings).toContain('show:item-show-1');
  });

  it('emits show_missed and sets scheduledShowtime = null when arrival is past last doors', () => {
    const snapshots: Record<string, WaitSnapshot> = {
      'exp-show-1': {
        experienceId: 'exp-show-1',
        isVirtualQueue: false,
        waits: Array.from({ length: 14 }, (_, i) => ({
          hour: i + 8,
          predictedWaitMinutes: 0,
        })),
        showtimes: ['2026-10-01T14:00:00.000Z'], // 10:00 AM EDT (doors at 9:45 AM / 585 min / 13:45 UTC)
      },
    };

    // Day starts at 12:00 PM (720 mins), 135 mins past last doors (585 min)
    const input: OptimizeInput = {
      items: [
        makeItem({
          id: 'item-show-1',
          experienceId: 'exp-show-1',
          durationMinutes: 30,
        }),
      ],
      date: '2026-10-01',
      snapshots,
      startHour: 12,
      endHour: 21,
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
    };

    const result = optimize(input);

    expect(result.warnings).toContain('show_missed:item-show-1');
    const showItem = result.items[0]!;
    expect(showItem.scheduledShowtime).toBeNull();
  });

  it('graded show-miss penalty creates cost gradient moving show earlier in sequence', () => {
    // Show has showtimes at 10:00 and 12:00 (last doors at 11:45 AM = 705 mins).
    // Ride 1 takes 30 mins, Ride 2 takes 30 mins, Ride 3 takes 30 mins, Ride 4 takes 30 mins.
    // If sequence places Show after 4 rides, arrival at ~11:00 AM + travel fits 12:00 PM show.
    // But if rides push arrival past 11:45 AM, graded penalty kicks in heavily.
    const snapshots: Record<string, WaitSnapshot> = {
      'exp-ride-1': {
        experienceId: 'exp-ride-1',
        isVirtualQueue: false,
        waits: Array.from({ length: 14 }, (_, i) => ({
          hour: i + 8,
          predictedWaitMinutes: 0,
        })),
      },
      'exp-show-1': {
        experienceId: 'exp-show-1',
        isVirtualQueue: false,
        waits: Array.from({ length: 14 }, (_, i) => ({
          hour: i + 8,
          predictedWaitMinutes: 0,
        })),
        showtimes: ['2026-10-01T14:00:00.000Z'], // 10:00 AM EDT show (doors at 9:45 AM)
      },
    };

    // 4 rides of 30 min duration each
    const input: OptimizeInput = {
      items: [
        makeItem({ id: 'item-ride-1', experienceId: 'exp-ride-1', durationMinutes: 30 }),
        makeItem({ id: 'item-ride-2', experienceId: 'exp-ride-1', durationMinutes: 30 }),
        makeItem({ id: 'item-ride-3', experienceId: 'exp-ride-1', durationMinutes: 30 }),
        makeItem({ id: 'item-show-1', experienceId: 'exp-show-1', durationMinutes: 30 }),
      ],
      date: '2026-10-01',
      snapshots,
      startHour: 9,
      endHour: 21,
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
    };

    const result = optimize(input);

    // Because of the 1000/min show miss penalty, the optimizer schedules the show
    // in time to catch the 10:00 AM show (doors at 9:45 AM) rather than pushing it
    // past the 9:45 AM cutoff.
    const showItem = result.items.find((i) => i.plannedItemId === 'item-show-1')!;
    expect(showItem).toBeDefined();
    expect(showItem.scheduledShowtime).toBe('2026-10-01T14:00:00.000Z');
    expect(result.warnings).not.toContain('show_missed:item-show-1');
  });
});
