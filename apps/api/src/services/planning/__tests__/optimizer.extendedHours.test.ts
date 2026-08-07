import { describe, expect, it } from 'vitest';
import { optimize, type OptimizeInput, type OptimizeInputItem } from '../optimizer.js';
import type { WaitSnapshot } from '@dwt/shared';

const WDW_TIME_ZONE = 'America/New_York';

function getETHourAndMinute(isoStr: string): { hour: number; minute: number; totalMinutes: number } {
  const d = new Date(isoStr);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: WDW_TIME_ZONE,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  let h = 0, m = 0;
  for (const part of parts) {
    if (part.type === 'hour') h = parseInt(part.value, 10);
    if (part.type === 'minute') m = parseInt(part.value, 10);
  }
  if (h === 24) h = 0;
  return { hour: h, minute: m, totalMinutes: h * 60 + m };
}

const DUMMY_SNAPSHOT: WaitSnapshot = {
  experienceId: 'exp-1',
  isVirtualQueue: false,
  waits: Array.from({ length: 24 }, (_, i) => ({ hour: i, predictedWaitMinutes: 10 })),
};

function makeItem(id: string, durationMinutes = 45): OptimizeInputItem {
  return {
    id,
    experienceId: `exp-${id}`,
    park: 'Magic Kingdom',
    coords: { lat: 28.4177, lng: -81.5812 },
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    durationMinutes,
    // These tests exercise the window *extension*, so the rides operate during
    // the extended-evening / after-hours windows (R3.13). Availability gating is
    // covered separately in optimizer.earlyEntry.test.ts / lateWindow tests.
    operatesDuringExtendedEvening: true,
    operatesDuringTicketedEvent: true,
  };
}

describe('optimizer.ts - Extended Evening & After-Hours Ticket Logic', () => {
  it('useExtendedEvening extends operating window by +120 minutes so late items fit', () => {
    // 3 items of 45 min duration + 10 min wait each = 165 minutes total needed.
    // Operating window 19:00 to 21:00 (1140m to 1260m) is only 120 minutes.
    const items = [makeItem('1'), makeItem('2'), makeItem('3')];

    const snapshots: Record<string, WaitSnapshot> = {
      'exp-1': DUMMY_SNAPSHOT,
      'exp-2': DUMMY_SNAPSHOT,
      'exp-3': DUMMY_SNAPSHOT,
    };

    const inputWithoutExtended: OptimizeInput = {
      items,
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
      useExtendedEvening: false,
      startHour: 19,
      endHour: 21,
      snapshots,
      seed: 42,
    };

    const resWithout = optimize(inputWithoutExtended);
    // Without extended evening, 120m window cannot fit 165m total time -> items dropped
    expect(resWithout.unfittedItemIds.length).toBeGreaterThan(0);

    const inputWithExtended: OptimizeInput = {
      ...inputWithoutExtended,
      useExtendedEvening: true,
    };

    const resWith = optimize(inputWithExtended);
    // With extended evening (+120 min => window extended to 23:00 / 1380m), all 3 items fit
    expect(resWith.unfittedItemIds).toHaveLength(0);
    expect(resWith.items).toHaveLength(3);
  });

  it('hasAfterHoursTicket extends operating window by +180 minutes so party items fit', () => {
    // 4 items requiring 220 minutes total. Standard window 19:00 to 21:00 is 120 mins.
    const items = [
      makeItem('1'),
      makeItem('2'),
      makeItem('3'),
      makeItem('4'),
    ];

    const snapshots: Record<string, WaitSnapshot> = {
      'exp-1': DUMMY_SNAPSHOT,
      'exp-2': DUMMY_SNAPSHOT,
      'exp-3': DUMMY_SNAPSHOT,
      'exp-4': DUMMY_SNAPSHOT,
    };

    const inputWithoutTicket: OptimizeInput = {
      items,
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
      hasAfterHoursTicket: false,
      startHour: 19,
      endHour: 21,
      snapshots,
      seed: 42,
    };

    const resWithout = optimize(inputWithoutTicket);
    expect(resWithout.unfittedItemIds.length).toBeGreaterThan(0);

    const inputWithTicket: OptimizeInput = {
      ...inputWithoutTicket,
      hasAfterHoursTicket: true,
    };

    const resWith = optimize(inputWithTicket);
    // With after-hours ticket (+180 min => window extended to 24:00), all 4 items fit
    expect(resWith.unfittedItemIds).toHaveLength(0);
    expect(resWith.items).toHaveLength(4);

    const etMinutes = resWith.items.map((i) => getETHourAndMinute(i.suggestedArrival).totalMinutes);
    expect(etMinutes.some((m) => m >= 21 * 60)).toBe(true);
  });

  it('hasAfterHoursTicket sets default mix-in start hour to 16:00 (4:00 PM)', () => {
    const items = [makeItem('1')];
    const snapshots: Record<string, WaitSnapshot> = { 'exp-1': DUMMY_SNAPSHOT };

    const inputWithAfterHours: OptimizeInput = {
      items,
      date: '2026-10-01',
      walkingSpeed: 'moderate',
      earlyEntryEligible: false,
      hasAfterHoursTicket: true,
      startHour: 9, // default start hour
      endHour: 21,
      snapshots,
      seed: 42,
    };

    const res = optimize(inputWithAfterHours);
    expect(res.items).toHaveLength(1);

    const { hour, minute } = getETHourAndMinute(res.items[0]!.suggestedArrival);
    expect(hour).toBe(16);
    expect(minute).toBe(0);
  });
});
