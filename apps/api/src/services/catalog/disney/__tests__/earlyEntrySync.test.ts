/**
 * Special-hours capture step (disney-facilities-catalog-source R5.8, R5.9).
 *
 * Uses the real `facilities` shape verified against the live gateway: a
 * `wdw.today.1_0.Attraction` document whose `facilities` map is keyed by
 * `facilityId` (= Enterprise_Id) with `ScheduleBlock[]` values carrying a
 * `scheduleType`.
 */

import { describe, expect, it, vi } from 'vitest';

import { captureSpecialHours, ATTRACTION_SCHEDULE_DOC_ID } from '../earlyEntrySync.js';

interface Entry {
  upstreamEntityId: string;
  earlyEntry: boolean;
  extendedEvening: boolean;
  ticketedEvent: boolean;
}

const SCHEDULE_DOC = {
  id: ATTRACTION_SCHEDULE_DOC_ID,
  channels: ['wdw.today.1_0'],
  facilities: {
    '80010190;entityType=Attraction': [
      { facilityId: '80010190;entityType=Attraction', scheduleType: 'Early Entry' },
      { facilityId: '80010190;entityType=Attraction', scheduleType: 'Operating' },
    ],
    '80010110;entityType=Attraction': [
      { facilityId: '80010110;entityType=Attraction', scheduleType: 'Operating' },
      { facilityId: '80010110;entityType=Attraction', scheduleType: 'Special Ticketed Event' },
    ],
    '16767284;entityType=Attraction': [
      { facilityId: '16767284;entityType=Attraction', scheduleType: 'Extended Evening' },
    ],
  },
};

describe('captureSpecialHours (R5.8, R5.9)', () => {
  it('maps the schedule doc to per-ride special-hours flags and persists them', async () => {
    const captured: Entry[] = [];
    const client = { bulkGetDocuments: vi.fn(async () => [SCHEDULE_DOC as any]) };
    const repo = {
      updateSpecialHoursParticipation: vi.fn(async (entries: Entry[]) => {
        captured.push(...entries);
      }),
    };

    const res = await captureSpecialHours({ client, repo });

    expect(client.bulkGetDocuments).toHaveBeenCalledWith([ATTRACTION_SCHEDULE_DOC_ID]);
    expect(res.updated).toBe(3);
    const byId = new Map(captured.map((e) => [e.upstreamEntityId, e]));
    expect(byId.get('80010190;entityType=Attraction')).toMatchObject({ earlyEntry: true, extendedEvening: false, ticketedEvent: false });
    expect(byId.get('80010110;entityType=Attraction')).toMatchObject({ earlyEntry: false, extendedEvening: false, ticketedEvent: true });
    expect(byId.get('16767284;entityType=Attraction')).toMatchObject({ earlyEntry: false, extendedEvening: true, ticketedEvent: false });
  });

  it('is best-effort: a fetch failure leaves flags unchanged and does not throw (R5.9)', async () => {
    const client = {
      bulkGetDocuments: vi.fn(async () => {
        throw new Error('WAF block');
      }),
    };
    const repo = { updateSpecialHoursParticipation: vi.fn(async () => {}) };

    const res = await captureSpecialHours({ client, repo });

    expect(res.updated).toBe(0);
    expect(repo.updateSpecialHoursParticipation).not.toHaveBeenCalled();
  });

  it('handles a malformed/absent facilities map without throwing', async () => {
    const client = { bulkGetDocuments: vi.fn(async () => [{ id: ATTRACTION_SCHEDULE_DOC_ID } as any]) };
    const repo = { updateSpecialHoursParticipation: vi.fn(async () => {}) };

    const res = await captureSpecialHours({ client, repo });

    expect(res.updated).toBe(0);
    expect(repo.updateSpecialHoursParticipation).not.toHaveBeenCalled();
  });
});
