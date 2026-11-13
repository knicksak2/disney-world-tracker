/**
 * The booking timeline per lodging Stay (trip-lodging-stays task 6). Pure-function tests plus one reminder-runner
 * pass; the existing `timeline.prop.test.ts` stays unmodified and pins the legacy derivation on its own.
 *
 * Properties 10, 11, 12 and the timeline half of 13. Validates: Requirements 9.1 to 9.9, 10.6.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  BOOKING_RULES,
  BOOKING_RULES_VERSION,
  LIGHTNING_LANE_TIMINGS,
  STAY_TYPES,
  addCalendarDays,
  type LightningLaneTiming,
  type StayRecord,
  type StayType,
} from '@dwt/shared';

import { wdwIsoAtMinutes } from '../../trips/wdwClock.js';
import type { TripBookingReminderNotice } from '../events.js';
import type { ReminderConfig } from '../reminderConfig.js';
import { ledgerKey, type DueReminder } from '../reminders.js';
import { createReminderRunner, type CandidateTrip, type ReminderRunnerRepo } from '../runner.js';
import {
  applyRule,
  compareWindows,
  deriveBookingTimeline,
  deriveLegacyTimeline,
  type DerivedWindow,
  type StoredBookingSettings,
  type TimelineTripInput,
} from '../timeline.js';

const RUNS = 100;
const BASE = '2027-11-01';
const day = (n: number): string => addCalendarDays(BASE, n);

let seq = 0;
function stay(kind: StayType, checkIn: string | null, checkOut: string | null, position = 0): StayRecord {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${seq.toString().padStart(12, '0')}`,
    position,
    lodgingKind: kind,
    resortId: kind === 'resort' ? '11111111-1111-4111-8111-111111111111' : null,
    displayName: `${kind} ${seq}`,
    checkIn,
    checkOut,
    partyKeys: null,
  };
}

const kindArb = fc.constantFrom<StayType>(...STAY_TYPES);
const timingArb = fc.constantFrom<LightningLaneTiming>(...LIGHTNING_LANE_TIMINGS);
const settingsArb: fc.Arbitrary<StoredBookingSettings | null> = fc.option(
  fc.record({
    stayType: fc.option(kindArb, { nil: null }),
    lightningLaneTiming: fc.option(timingArb, { nil: null }),
    checkInOverride: fc.option(fc.integer({ min: -35, max: 2 }).map((n) => day(n)), { nil: null }),
  }),
  { nil: null },
);
const tripArb = fc
  .record({ len: fc.integer({ min: 0, max: 20 }), hasResortStay: fc.boolean(), settings: settingsArb })
  .map(({ len, hasResortStay, settings }) => ({ startDate: day(0), endDate: day(len), hasResortStay, settings }));

/** Two to four touching or gapped scheduled stays starting near the Trip start (the multi-segment case). */
const multiStaysArb = fc
  .array(fc.record({ kind: kindArb, gap: fc.integer({ min: 0, max: 2 }), nights: fc.integer({ min: 1, max: 12 }) }), {
    minLength: 2,
    maxLength: 4,
  })
  .map((parts) => {
    let cursor = 0;
    return parts.map((p, i) => {
      cursor += p.gap;
      const s = stay(p.kind, day(cursor), day(cursor + p.nights), i);
      cursor += p.nights;
      return s;
    });
  });

function keysUnique(ws: readonly DerivedWindow[]): boolean {
  return new Set(ws.map((w) => w.windowKey)).size === ws.length;
}

// ---------------------------------------------------------------------------

describe('deriveBookingTimeline with stays', () => {
  it('golden: resort Dec 15 to 20, resort Dec 20 to 26, offsite Dec 26 to 31', () => {
    const trip: TimelineTripInput = {
      startDate: '2027-12-15',
      endDate: '2027-12-31',
      hasResortStay: true,
      settings: null,
      stays: [
        stay('resort', '2027-12-15', '2027-12-20', 0),
        stay('resort', '2027-12-20', '2027-12-26', 1),
        stay('offsite', '2027-12-26', '2027-12-31', 2),
      ],
    };
    const d = deriveBookingTimeline(trip);
    const range = (from: string, to: string): string[] => {
      const out: string[] = [];
      for (let x = from; x <= to; x = addCalendarDays(x, 1)) out.push(x);
      return out;
    };

    expect(d.windows.map((w) => [w.windowKey, w.coveredDates])).toEqual([
      ['dining:2027-10-16', range('2027-12-15', '2027-12-20')], // resort 1, 60 days before its check-in
      ['dining:2027-10-21', range('2027-12-20', '2027-12-26')], // resort 2, from ITS check-in
      ['dining:2027-10-27', ['2027-12-26']], // off-site: head covers the first day only
      ['dining:2027-10-28', ['2027-12-27']],
      ['dining:2027-10-29', ['2027-12-28']],
      ['dining:2027-10-30', ['2027-12-29']],
      ['dining:2027-10-31', ['2027-12-30']],
      ['dining:2027-11-01', ['2027-12-31']],
      ['lightning_lane:2027-12-08', range('2027-12-15', '2027-12-20')], // resort: 7 days, seven_day default
      ['lightning_lane:2027-12-13', range('2027-12-20', '2027-12-26')],
      ['lightning_lane:2027-12-23', range('2027-12-26', '2027-12-31')], // off-site: 3 days, three_day default
    ]);
    // Each window carries the exact WDW drop instant of its kind.
    expect(d.windows[0]!.dropAt).toBe(wdwIsoAtMinutes('2027-10-16', BOOKING_RULES.dining.dropMinutes));
    expect(d.windows[8]!.dropAt).toBe(wdwIsoAtMinutes('2027-12-08', BOOKING_RULES.lightning_lane.dropMinutes));
    // The hand-off dates appear once in the Trip's stay dates.
    expect(d.stayDates).toEqual(range('2027-12-15', '2027-12-31'));
    expect(d.stayDates.filter((x) => x === '2027-12-20')).toHaveLength(1);
    expect(d.stayDates.filter((x) => x === '2027-12-26')).toHaveLength(1);
    // Top-level fields come from the first segment, marked as derived from stays.
    expect(d.stayType).toEqual({ value: 'resort', source: 'stays' });
    expect(d.arrival).toEqual({ value: '2027-12-15', source: 'stays' });
    expect(d.lightningLaneTiming).toEqual({ value: 'seven_day', source: 'auto' });
    expect(d.rulesVersion).toBe(BOOKING_RULES_VERSION);
    expect(d.stays?.map((s) => [s.lodgingKind, s.checkIn, s.checkOut, s.source])).toEqual([
      ['resort', '2027-12-15', '2027-12-20', 'stay'],
      ['resort', '2027-12-20', '2027-12-26', 'stay'],
      ['offsite', '2027-12-26', '2027-12-31', 'stay'],
    ]);
  });

  it('a gap between stays becomes an off-site segment with its own windows', () => {
    const d = deriveBookingTimeline({
      startDate: '2027-12-15',
      endDate: '2027-12-31',
      hasResortStay: true,
      settings: null,
      stays: [stay('resort', '2027-12-15', '2027-12-20'), stay('resort', '2027-12-22', '2027-12-31', 1)],
    });
    expect(d.stays?.map((s) => [s.lodgingKind, s.checkIn, s.checkOut, s.source, s.stayId === null])).toEqual([
      ['resort', '2027-12-15', '2027-12-20', 'stay', false],
      ['offsite', '2027-12-20', '2027-12-22', 'implicit_gap', true],
      ['resort', '2027-12-22', '2027-12-31', 'stay', false],
    ]);
    expect(d.windows.map((w) => w.windowKey)).toContain('lightning_lane:2027-12-17'); // the gap's three_day window
  });

  it('merges two segments that produce the same window key into one with the sorted union of dates', () => {
    // The hand-off date day(5) is in both segments' inclusive dates. The off-site segment emits a per-date dining
    // window for it (drop day(5) − 60, covering [day(5)]); the resort segment's head window has the SAME drop (its
    // check-in is day(5)) and covers day(5)..day(14). One window results, covering the union.
    const d = deriveBookingTimeline({
      startDate: day(0),
      endDate: day(15),
      hasResortStay: true,
      settings: null,
      stays: [stay('offsite', day(0), day(5)), stay('resort', day(5), day(15), 1)],
    });
    expect(keysUnique(d.windows)).toBe(true);
    const key = `dining:${addCalendarDays(day(5), -60)}`;
    const merged = d.windows.filter((w) => w.windowKey === key);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.coveredDates).toEqual(Array.from({ length: 10 }, (_, i) => day(5 + i)));
  });

  // Feature: trip-lodging-stays, Property 10: The timeline is unchanged for single-segment Trips
  it('Property 10: with no or only undated stays the output deep-equals the original derivation', () => {
    fc.assert(
      fc.property(tripArb, fc.array(kindArb, { maxLength: 3 }), (trip, undatedKinds) => {
        const stays = undatedKinds.map((k, i) => stay(k, null, null, i));
        const withStays = deriveBookingTimeline({ ...trip, stays });
        expect(withStays).toEqual(deriveLegacyTimeline(trip));
        expect(withStays).toEqual(deriveBookingTimeline(trip)); // stays omitted: the original call shape
        expect('stays' in withStays).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: trip-lodging-stays, Property 10: The timeline is unchanged for single-segment Trips
  it('Property 10: one dated stay equal to the Trip dates gives the original windows with that stay type as override', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        kindArb,
        settingsArb,
        fc.boolean(),
        (len, kind, settings, hasResortStay) => {
          const trip = { startDate: day(0), endDate: day(len), hasResortStay, settings };
          const d = deriveBookingTimeline({ ...trip, stays: [stay(kind, day(0), day(len))] });
          const legacy = deriveLegacyTimeline({
            ...trip,
            settings: { stayType: kind, lightningLaneTiming: settings?.lightningLaneTiming ?? null, checkInOverride: null },
          });
          expect(d.windows).toEqual(legacy.windows);
          expect(d.stayDates).toEqual(legacy.stayDates);
          expect(d.stayType.value).toBe(kind);
          expect(d.lightningLaneTiming).toEqual(legacy.lightningLaneTiming);
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Feature: trip-lodging-stays, Property 11: Merged timeline windows are unique and complete
  it('Property 11: merged windows are unique, contain every segment window, have sorted unique dates, and are ordered', () => {
    fc.assert(
      fc.property(multiStaysArb, fc.option(timingArb, { nil: null }), (stays, timing) => {
        const last = stays[stays.length - 1]!.checkOut as string;
        const trip: TimelineTripInput = {
          startDate: day(0),
          endDate: last,
          hasResortStay: false,
          settings: timing === null ? null : { stayType: null, lightningLaneTiming: timing, checkInOverride: null },
          stays,
        };
        const d = deriveBookingTimeline(trip);
        expect(keysUnique(d.windows)).toBe(true);

        for (const seg of d.stays ?? []) {
          const dates: string[] = [];
          for (let x = seg.checkIn; x <= seg.checkOut; x = addCalendarDays(x, 1)) dates.push(x);
          const t = timing ?? BOOKING_RULES.lightning_lane.defaultTimingByStayType[seg.lodgingKind];
          const single = [
            ...applyRule('dining', BOOKING_RULES.dining.byStayType[seg.lodgingKind], dates, seg.checkIn),
            ...applyRule('lightning_lane', BOOKING_RULES.lightning_lane.byTiming[t], dates, seg.checkIn),
          ];
          for (const w of single) {
            const m = d.windows.find((x) => x.windowKey === w.windowKey);
            expect(m).toBeDefined();
            for (const c of w.coveredDates) expect(m!.coveredDates).toContain(c);
          }
        }
        for (const w of d.windows) {
          expect([...new Set(w.coveredDates)].sort()).toEqual(w.coveredDates);
        }
        expect([...d.windows].sort(compareWindows)).toEqual(d.windows);
      }),
      { numRuns: RUNS },
    );
  });

  // Feature: trip-lodging-stays, Property 12: Override precedence in the timeline
  it('Property 12: with a dated stay the trip-level stay type and check-in override change nothing; LL timing changes every segment', () => {
    fc.assert(
      fc.property(multiStaysArb, kindArb, fc.integer({ min: -30, max: 0 }), timingArb, (stays, stayType, ci, timing) => {
        const base = { startDate: day(0), endDate: stays[stays.length - 1]!.checkOut as string, hasResortStay: true, stays };
        const plain = deriveBookingTimeline({ ...base, settings: null });
        const overridden = deriveBookingTimeline({
          ...base,
          settings: { stayType, lightningLaneTiming: null, checkInOverride: day(ci) },
        });
        expect(overridden).toEqual(plain);

        const timed = deriveBookingTimeline({
          ...base,
          settings: { stayType: null, lightningLaneTiming: timing, checkInOverride: null },
        });
        expect(timed.lightningLaneTiming).toEqual({ value: timing, source: 'override' });
        expect(timed.windows.filter((w) => w.kind === 'dining')).toEqual(plain.windows.filter((w) => w.kind === 'dining'));
        // Every segment's LL windows follow the override rule: the head drop is check-in minus that rule's offset.
        for (const seg of timed.stays ?? []) {
          const head = addCalendarDays(seg.checkIn, -BOOKING_RULES.lightning_lane.byTiming[timing].headOffsetDays);
          expect(timed.windows.some((w) => w.kind === 'lightning_lane' && w.dropOn === head)).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('Property 12: without a dated stay the trip-level overrides still apply exactly as before', () => {
    const trip = {
      startDate: '2027-12-15',
      endDate: '2027-12-20',
      hasResortStay: true,
      settings: { stayType: 'offsite' as const, lightningLaneTiming: null, checkInOverride: '2027-12-12' },
    };
    const d = deriveBookingTimeline({ ...trip, stays: [stay('resort', null, null)] });
    expect(d.stayType).toEqual({ value: 'offsite', source: 'override' });
    expect(d.arrival).toEqual({ value: '2027-12-12', source: 'override' });
    expect(d).toEqual(deriveLegacyTimeline(trip));
  });

  // Feature: trip-lodging-stays, Property 13: The backfill is conservative and idempotent (timeline half)
  it('Property 13: the timeline of a Trip built as its old rows equals the timeline of its backfilled stays', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 3 }),
        settingsArb,
        (len, resortCount, settings) => {
          const old: TimelineTripInput = { startDate: day(0), endDate: day(len), hasResortStay: resortCount > 0, settings };
          // The backfill of 0074 (Requirement 10.2 and 10.3), applied to this Trip's old rows.
          let stays: StayRecord[] = [];
          if (resortCount === 1) {
            const kind = settings?.stayType ?? 'resort';
            const o = settings?.checkInOverride ?? null;
            const ci = o !== null && o >= addCalendarDays(old.startDate, -30) && o <= old.startDate ? o : old.startDate;
            stays = [old.endDate > ci ? stay(kind, ci, old.endDate) : stay(kind, null, null)];
          } else if (resortCount > 1) {
            stays = Array.from({ length: resortCount }, (_, i) => stay('resort', null, null, i));
          }
          const before = deriveBookingTimeline(old);
          const after = deriveBookingTimeline({ ...old, stays });

          expect(after.windows).toEqual(before.windows);
          expect(after.stayDates).toEqual(before.stayDates);
          expect(after.stayType.value).toBe(before.stayType.value);
          expect(after.arrival.value).toBe(before.arrival.value);
          expect(after.lightningLaneTiming).toEqual(before.lightningLaneTiming);
          if (after.stays === undefined) expect(after).toEqual(before); // legacy path: fully identical
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Reminder runner with a two-stay Trip (R9.8)
// ---------------------------------------------------------------------------

class LedgerRepo implements ReminderRunnerRepo {
  readonly ledger: { tripId: string; kind: string; dropAt: string; lead: string }[] = [];
  constructor(private readonly trips: CandidateTrip[]) {}
  async listCandidateTrips(): Promise<CandidateTrip[]> {
    return this.trips;
  }
  async listDoneKeys(ids: readonly string[]): Promise<Map<string, Set<string>>> {
    return new Map(ids.map((id) => [id, new Set<string>()]));
  }
  async listClaimedKeys(ids: readonly string[]): Promise<Map<string, Set<string>>> {
    const out = new Map(ids.map((id) => [id, new Set<string>()]));
    for (const r of this.ledger) out.get(r.tripId)?.add(ledgerKey(r.kind as never, r.dropAt, r.lead as never));
    return out;
  }
  async claimReminder(tripId: string, r: DueReminder): Promise<boolean> {
    if (this.ledger.some((x) => x.tripId === tripId && x.kind === r.kind && x.dropAt === r.dropAt && x.lead === r.lead)) {
      return false;
    }
    this.ledger.push({ tripId, kind: r.kind, dropAt: r.dropAt, lead: r.lead });
    return true;
  }
  async listReminderRecipients(): Promise<string[]> {
    return ['user-1'];
  }
  async pruneLedger(): Promise<number> {
    return 0;
  }
}

const CONFIG: ReminderConfig = {
  leads: ['open'],
  catchupMinutes: 180,
  minPassIntervalSeconds: 300,
  sendStartMinutes: 360,
  sendEndMinutes: 1380,
  retentionDays: 30,
} as ReminderConfig;

const quietLogger = { info() {}, warn() {}, error() {} };

describe('reminder runner with a split stay', () => {
  it("reminds for the second reservation's own dining window, and a second tick does not send it again", async () => {
    const trip: CandidateTrip = {
      id: 'trip-1',
      name: 'Holiday',
      startDate: '2027-12-15',
      endDate: '2027-12-31',
      hasResortStay: true,
      settings: null,
      stays: [stay('resort', '2027-12-15', '2027-12-20'), stay('resort', '2027-12-20', '2027-12-31', 1)],
    };
    const repo = new LedgerRepo([trip]);
    const sent: TripBookingReminderNotice[] = [];
    const now = new Date(wdwIsoAtMinutes('2027-10-21', 6 * 60 + 30)); // 06:30 WDW, 30 minutes after the drop
    const runner = createReminderRunner({
      repo,
      dispatch: async (n) => {
        sent.push(n);
      },
      config: CONFIG,
      logger: quietLogger,
      now: () => now,
    });

    const first = await runner.runPass(now);
    expect(first.remindersDispatched).toBe(1);
    expect(repo.ledger).toEqual([
      { tripId: 'trip-1', kind: 'dining', dropAt: wdwIsoAtMinutes('2027-10-21', 360), lead: 'open' },
    ]);
    expect(JSON.stringify(sent[0]!.windows)).toContain('2027-10-21');

    // Without the stays the Trip is one resort stay from Dec 15, which has no window dropping on Oct 21.
    const legacyKeys = deriveBookingTimeline({ ...trip, stays: undefined }).windows.map((w) => w.windowKey);
    expect(legacyKeys).not.toContain('dining:2027-10-21');

    const second = await runner.runPass(now);
    expect(second.remindersDispatched).toBe(0);
    expect(second.remindersClaimed).toBe(0);
    expect(repo.ledger).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});
