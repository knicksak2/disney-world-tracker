/**
 * Dining Plan service with fake ports and an in-memory fake repo (the repo itself is pinned by repo.test.ts).
 *
 * Validates: dining-plan-calculator Requirements 3.1, 3.2, 3.3, 3.7, 3.9, 5.1, 5.4, 6.4, 16.8, 25.1, 25.2, 25.3,
 * 25.14, 25.17.
 */

import { describe, expect, it, vi } from 'vitest';

import { diningCalculateBodySchema, diningPlanSettingsSchema } from '@dwt/shared';

import { wdwToday } from '../../trips/wdwClock.js';
import { computeDiningPlan } from '../engine/computeDiningPlan.js';
import type { PlannedDiningItemRow } from '../engine/reservations.js';
import { ID } from '../engine/__tests__/engineFixtures.js';
import type { StoredDiningEntry } from '../types.js';
import { ALEX, BABY, BLAIR, guest, KID, member, NOW, ORPHAN, PENDING, RIDE, service, stay, TRIP, world } from './serviceFixtures.js';

describe('Party assembly (Requirement 3)', () => {
  it('builds members and guests with profiles, defaults to adult, and omits hidden accounts and their guests', async () => {
    const w = world({
      members: [member(ALEX, 'Alex', 'organizer'), member(BLAIR, 'Blair'), member(PENDING, 'Pending Pat')],
      guests: [guest(KID, 'Kit', ALEX), guest(BABY, 'Bo', BLAIR), guest(ORPHAN, 'Orla', PENDING)],
      hidden: { userIds: [PENDING], guestIds: [ORPHAN] },
      profiles: [
        { memberId: BLAIR, guestId: null, ageBracket: 'adult', passType: 'annual_pass' },
        { memberId: null, guestId: KID, ageBracket: 'child', passType: 'none' },
        { memberId: null, guestId: BABY, ageBracket: 'under3', passType: 'none' },
      ],
    });
    const plan = await service(w).getPlan(TRIP);
    expect(plan.party).toEqual([
      { key: `m:${ALEX}`, label: 'Alex', ageBracket: 'adult', passType: 'none' },
      { key: `m:${BLAIR}`, label: 'Blair', ageBracket: 'adult', passType: 'annual_pass' },
      { key: `g:${KID}`, label: 'Kit', ageBracket: 'child', passType: 'none' },
      { key: `g:${BABY}`, label: 'Bo', ageBracket: 'under3', passType: 'none' },
    ]);
    expect(plan.result.eligibleCount).toBe(3);
    // Blair's annual pass applies the pass discount for the Party (Requirement 3.8).
    expect(plan.result.assumptions.passDiscountBps).toBe(1000);
  });

  it('rejects a Party of 51', async () => {
    const members = Array.from({ length: 51 }, (_, i) => member(`30000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `P${i}`));
    await expect(service(world({ members })).getPlan(TRIP)).rejects.toMatchObject({ code: 'trip_validation_failed', field: 'party' });
  });

  it('answers trip_forbidden for an unknown Trip', async () => {
    await expect(service(world({ trip: null })).getPlan(TRIP)).rejects.toMatchObject({ code: 'trip_forbidden' });
  });
});

describe('getPlan', () => {
  it('passes the engine the Party, the stays, the entries, the locations and WDW today', async () => {
    const entries: StoredDiningEntry[] = [
      { id: 'e1', date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: ID.crt, placeholderKind: null, plannedItemId: null, excludedKeys: [`m:${BLAIR}`] },
    ];
    const spy = vi.fn(computeDiningPlan);
    const plan = await service(world({ entries }), spy).getPlan(TRIP);
    expect(spy).toHaveBeenCalledTimes(1);
    const input = spy.mock.calls[0]![0];
    expect(input.persons.map((p) => p.key)).toEqual([`m:${ALEX}`, `m:${BLAIR}`]);
    expect(input.stay).toEqual({ checkIn: '2027-03-01', checkOut: '2027-03-06', source: 'trip' });
    expect(input.stays).toEqual([
      { key: 'implicit:2027-03-01', label: 'No lodging recorded', lodgingKind: 'offsite', source: 'implicit_no_lodging', checkIn: '2027-03-01', checkOut: '2027-03-06', partyKeys: null, setting: { status: 'compare', heldPlan: null, channel: 'package' } },
    ]);
    expect(input.entries).toEqual([{ date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: ID.crt, placeholderKind: null, excludedKeys: [`m:${BLAIR}`] }]);
    expect([...input.locations.keys()]).toEqual([ID.crt]);
    expect(input.today).toBe(wdwToday(NOW));
    expect(plan.entries[0]).toMatchObject({ experienceName: "Cinderella's Royal Table", excludedKeys: [`m:${BLAIR}`] });
    expect(plan.stay).toEqual(plan.result.stay);
  });

  it('uses the custom stay of the settings on a Trip with no lodging recorded, and says so', async () => {
    const plan = await service(world({ settings: { stay: { checkIn: '2027-03-02', checkOut: '2027-03-04' } } })).getPlan(TRIP);
    expect(plan.stay).toEqual({ checkIn: '2027-03-02', checkOut: '2027-03-04', nights: 2, days: 3, source: 'custom' });
    expect(plan.result.stays!.map((s) => s.key)).toEqual(['implicit:2027-03-01']);
  });

  it('turns planned items into suggestions, counting those with no meal time', async () => {
    const planned: PlannedDiningItemRow[] = [
      { id: 'p1', itemType: 'experience', experienceId: ID.crt, experienceName: "Cinderella's Royal Table", experienceCategory: 'Restaurant', experienceActive: true, plannedDate: '2027-03-02', plannedTime: '2027-03-02T23:00:00.000Z', mealPeriod: null, partySize: 1, reservationKind: 'dining' },
      { id: 'p2', itemType: 'experience', experienceId: ID.pecos, experienceName: 'Pecos Bill', experienceCategory: 'Restaurant', experienceActive: true, plannedDate: '2027-03-03', plannedTime: null, mealPeriod: null, partySize: null, reservationKind: null },
    ];
    const plan = await service(world({ planned })).getPlan(TRIP);
    expect(plan.suggestions).toEqual([
      { plannedItemId: 'p1', experienceId: ID.crt, experienceName: "Cinderella's Royal Table", date: '2027-03-02', mealPeriod: 'dinner', source: 'reservation', partySizeMismatch: true, alreadyHasEntry: false },
    ]);
    expect(plan.suggestionsNeedingMealPeriod).toBe(1);
  });
});

describe('Plan_Stays from the Trip (Requirements 25.1 to 25.3, 25.14)', () => {
  it('assumes a Disney Resort package for a Trip with no stays', async () => {
    const plan = await service(world()).getPlan(TRIP);
    expect(plan.result.stays).toEqual([expect.objectContaining({ key: 'implicit:2027-03-01', source: 'implicit_no_lodging', available: true })]);
    expect(plan.result.scenarios.find((s) => s.code === 'table_service')!.available).toBe(true);
  });

  it('gives one legacy_resorts Plan_Stay for undated stays', async () => {
    const w = world({ stays: [stay('s1', 0, 'resort', 'Pop Century', null, null)] });
    const plan = await service(w).getPlan(TRIP);
    expect(plan.result.stays!.map((s) => [s.key, s.source, s.label, s.checkIn, s.checkOut])).toEqual([['implicit:2027-03-01', 'legacy_resorts', 'Pop Century', '2027-03-01', '2027-03-06']]);
  });

  it('gives one Plan_Stay per dated stay plus gap segments, with their stayPlans settings', async () => {
    const w = world({
      stays: [stay('s1', 0, 'resort', 'Contemporary', '2027-03-01', '2027-03-03'), stay('s2', 1, 'offsite', 'Aunt May', '2027-03-04', '2027-03-06')],
      settings: { stayPlans: { s1: { status: 'have_plan', heldPlan: 'table_service' }, gone: { status: 'no_plan' } } },
    });
    const plan = await service(w).getPlan(TRIP);
    expect(plan.result.stays!.map((s) => [s.key, s.source, s.status, s.heldPlan, s.available])).toEqual([
      ['s1', 'stay', 'have_plan', 'table_service', true],
      ['implicit:2027-03-03', 'implicit_gap', 'compare', null, true],
      ['s2', 'stay', 'compare', null, false],
    ]);
  });

  it('round-trips stayPlans through a settings save and drops a stale key', async () => {
    const w = world({ stays: [stay('s1', 0, 'resort', 'Contemporary', '2027-03-01', '2027-03-06')] });
    const settings = diningPlanSettingsSchema.parse({ stayPlans: { s1: { status: 'have_plan', heldPlan: 'deluxe', channel: 'dvc_or_passholder' }, gone: { status: 'no_plan' } } });
    const plan = await service(w).putSettings(TRIP, settings);
    expect(w.repo.saved).toEqual([{ ...settings, stayPlans: { s1: { status: 'have_plan', heldPlan: 'deluxe', channel: 'dvc_or_passholder' } } }]);
    expect(plan.settings.stayPlans).toEqual({ s1: { status: 'have_plan', heldPlan: 'deluxe', channel: 'dvc_or_passholder' } });
    expect(plan.result.stays![0]).toMatchObject({ status: 'have_plan', heldPlan: 'deluxe', channel: 'dvc_or_passholder' });
  });

  it('rejects a Trip spanning 61 days, and accepts 60', async () => {
    await expect(service(world({ trip: { startDate: '2027-03-01', endDate: '2027-05-01' } })).getPlan(TRIP)).rejects.toMatchObject({ code: 'trip_validation_failed', field: 'stays' });
    await expect(service(world({ trip: { startDate: '2027-03-01', endDate: '2027-04-30' } })).getPlan(TRIP)).resolves.toBeDefined();
  });

  it('makes the single segment off-site for stayType not_disney_resort, and DVC for dvc_or_passholder_resort', async () => {
    const off = await service(world({ settings: { stayType: 'not_disney_resort' } })).getPlan(TRIP);
    expect(off.result.verdict).toBe('plan_unavailable');
    expect(off.result.stays![0]).toMatchObject({ available: false, unavailableReason: 'not_disney_resort' });
    const dvc = await service(world({ settings: { stayType: 'dvc_or_passholder_resort' } })).getPlan(TRIP);
    expect(dvc.result.stays![0]).toMatchObject({ channel: 'dvc_or_passholder' });
  });
});

describe('putSettings', () => {
  it('rejects a child among the alcohol drinkers and more mugs than eligible people, writing nothing', async () => {
    const w = world({ guests: [guest(KID, 'Kit', ALEX)], profiles: [{ memberId: null, guestId: KID, ageBracket: 'child', passType: 'none' }] });
    const s = service(w);
    await expect(s.putSettings(TRIP, diningPlanSettingsSchema.parse({ alcoholDrinkerKeys: [`g:${KID}`] }))).rejects.toMatchObject({ code: 'trip_validation_failed', field: 'alcoholDrinkerKeys' });
    await expect(s.putSettings(TRIP, diningPlanSettingsSchema.parse({ mugsWanted: 4 }))).rejects.toMatchObject({ code: 'trip_validation_failed', field: 'mugsWanted' });
    expect(w.repo.saved).toEqual([]);
    // A key that names nobody in the Party is kept and ignored at calculation time (Requirement 6.4).
    const ok = await s.putSettings(TRIP, diningPlanSettingsSchema.parse({ alcoholDrinkerKeys: [`m:${ALEX}`, 'm:stranger'], mugsWanted: 3 }));
    expect(ok.settings.alcoholDrinkerKeys).toEqual([`m:${ALEX}`, 'm:stranger']);
  });

  it('returns the recomputed plan', async () => {
    const plan = await service(world()).putSettings(TRIP, diningPlanSettingsSchema.parse({ snacksPerPersonPerDay: 0 }));
    expect(plan.result.scenarios[0]!.snackOutOfPocketCents).toBe(0);
  });
});

describe('putEntry, deleteEntry and importReservations', () => {
  it('writes an entry and returns the plan with it, then clears it', async () => {
    const w = world();
    const s = service(w);
    const added = await s.putEntry(TRIP, '2027-03-02', 'dinner', { kind: 'restaurant', experienceId: ID.liberty, placeholderKind: null, excludedKeys: [] });
    expect(added.entries.map((e) => [e.date, e.mealPeriod, e.experienceName])).toEqual([['2027-03-02', 'dinner', 'Liberty Tree Tavern']]);
    expect(added.result.scenarios[0]!.meals).toHaveLength(1);
    const cleared = await s.deleteEntry(TRIP, '2027-03-02', 'dinner');
    expect(cleared.entries).toEqual([]);
  });

  it('imports in-stay suggestions in order, counts out-of-stay ones, and reports a requested item that is already imported', async () => {
    const planned: PlannedDiningItemRow[] = [
      { id: 'p-in', itemType: 'experience', experienceId: ID.crt, experienceName: 'CRT', experienceCategory: 'Restaurant', experienceActive: true, plannedDate: '2027-03-02', plannedTime: '2027-03-02T23:00:00.000Z', mealPeriod: null, partySize: null, reservationKind: 'dining' },
      { id: 'p-out', itemType: 'experience', experienceId: ID.pecos, experienceName: 'Pecos', experienceCategory: 'Restaurant', experienceActive: true, plannedDate: '2027-03-09', plannedTime: null, mealPeriod: 'lunch', partySize: null, reservationKind: null },
      { id: 'p-done', itemType: 'experience', experienceId: ID.liberty, experienceName: 'Liberty', experienceCategory: 'Restaurant', experienceActive: true, plannedDate: '2027-03-03', plannedTime: null, mealPeriod: 'dinner', partySize: null, reservationKind: null },
    ];
    const entries: StoredDiningEntry[] = [
      { id: 'e-done', date: '2027-03-03', mealPeriod: 'dinner', kind: 'restaurant', experienceId: ID.liberty, placeholderKind: null, plannedItemId: 'p-done', excludedKeys: [] },
    ];
    const w = world({ planned, entries });
    const r = await service(w).importReservations(TRIP, { plannedItemIds: ['p-in', 'p-out', 'p-done'], overwrite: true });
    expect(w.repo.imports).toEqual([{ items: [{ plannedItemId: 'p-in', experienceId: ID.crt, date: '2027-03-02', mealPeriod: 'dinner' }], overwrite: true }]);
    expect({ created: r.created, skippedExisting: r.skippedExisting, skippedOutOfStay: r.skippedOutOfStay }).toEqual({ created: 1, skippedExisting: 1, skippedOutOfStay: 1 });
    expect(r.plan.entries.map((e) => e.plannedItemId).sort()).toEqual(['p-done', 'p-in']);
    expect(r.plan.suggestions.map((s) => s.plannedItemId)).toEqual(['p-out']);
  });

  it('imports every suggestion when no ids are given', async () => {
    const planned: PlannedDiningItemRow[] = [
      { id: 'a', itemType: 'experience', experienceId: ID.crt, experienceName: 'CRT', experienceCategory: 'Restaurant', experienceActive: true, plannedDate: '2027-03-02', plannedTime: null, mealPeriod: 'dinner', partySize: null, reservationKind: 'dining' },
      { id: 'b', itemType: 'experience', experienceId: ID.pecos, experienceName: 'Pecos', experienceCategory: 'Restaurant', experienceActive: true, plannedDate: '2027-03-03', plannedTime: null, mealPeriod: 'lunch', partySize: null, reservationKind: null },
    ];
    const w = world({ planned });
    const r = await service(w).importReservations(TRIP, { overwrite: false });
    expect(w.repo.imports[0]!.items.map((i) => i.plannedItemId)).toEqual(['a', 'b']);
    expect(r.created).toBe(2);
  });
});

describe('calculateStateless (Requirements 16.8, 25.17)', () => {
  const body = (extra: Record<string, unknown> = {}) =>
    diningCalculateBodySchema.parse({
      party: [{ key: 'm:a', label: 'Alex', ageBracket: 'adult' }, { key: 'g:k', label: 'Kit', ageBracket: 'child' }],
      stay: { checkIn: '2027-03-01', checkOut: '2027-03-04' },
      settings: {},
      entries: [
        { date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: ID.crt },
        { date: '2027-03-02', mealPeriod: 'lunch', kind: 'placeholder', placeholderKind: 'quick_service' },
      ],
      ...extra,
    });

  it('computes one stay without writing anything', async () => {
    const w = world();
    const r = await service(w).calculateStateless(body());
    expect(r.stays).toBeUndefined();
    expect(r.stay).toEqual({ checkIn: '2027-03-01', checkOut: '2027-03-04', nights: 3, days: 4, source: 'custom' });
    expect(r.scenarios[0]!.meals).toHaveLength(2);
    expect(r.warnings).toEqual([]);
    expect(w.repo.saved).toEqual([]);
  });

  it('drops an unknown, an inactive and a non-Restaurant Experience with unknown_experience warnings and the same totals', async () => {
    const base = await service(world()).calculateStateless(body());
    const missing = '00000000-0000-4000-8000-0000000000ff';
    const extra = body({
      entries: [
        { date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: ID.crt },
        { date: '2027-03-02', mealPeriod: 'lunch', kind: 'placeholder', placeholderKind: 'quick_service' },
        { date: '2027-03-03', mealPeriod: 'dinner', kind: 'restaurant', experienceId: missing },
        { date: '2027-03-03', mealPeriod: 'lunch', kind: 'restaurant', experienceId: RIDE },
      ],
    });
    const r = await service(world()).calculateStateless(extra);
    expect(r.warnings).toEqual([
      { code: 'unknown_experience', date: '2027-03-03', mealPeriod: 'dinner' },
      { code: 'unknown_experience', date: '2027-03-03', mealPeriod: 'lunch' },
    ]);
    expect(r.scenarios).toEqual(base.scenarios);
  });

  it('accepts stays and returns the per-stay result', async () => {
    const r = await service(world()).calculateStateless(
      body({
        stays: [
          { key: 'a', label: 'Contemporary', lodgingKind: 'resort', checkIn: '2027-03-01', checkOut: '2027-03-03', setting: { status: 'have_plan', heldPlan: 'table_service' } },
          { key: 'b', label: 'Aunt May', lodgingKind: 'offsite', checkIn: '2027-03-03', checkOut: '2027-03-04' },
        ],
      }),
    );
    expect(r.stays!.map((s) => [s.key, s.recommendedPlan, s.available])).toEqual([['a', 'table_service', true], ['b', 'none', false]]);
  });

  it('rejects a span over 60 days with validation_failed', async () => {
    await expect(service(world()).calculateStateless(body({ stay: { checkIn: '2027-03-01', checkOut: '2027-05-01' } }))).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
