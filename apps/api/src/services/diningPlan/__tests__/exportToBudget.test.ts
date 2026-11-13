/**
 * `exportToBudget` with a fake repo, fake ports and an in-memory Trip Budget (the real adapter and the real Budget repo
 * are pinned by budgetPort.test.ts).
 *
 * Validates: dining-plan-calculator Requirements 26.1, 26.2, 26.3, 26.4, 26.7, 26.9, 26.10, 26.13; Properties 42 and 43.
 */

import { describe, expect, it, vi } from 'vitest';

import { diningBudgetExportBodySchema, type DiningExportGroup, type DiningStayOptionCode } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { toPreTax } from '../engine/budgetExport.js';
import { computeDiningPlan, evaluateForExport } from '../engine/computeDiningPlan.js';
import { ID } from '../engine/__tests__/engineFixtures.js';
import type { EngineInput } from '../engine/types.js';
import type { StoredDiningEntry } from '../types.js';
import { ALEX, BLAIR, fakeBudget, guest, KID, service, stay, TRIP, world, type World } from './serviceFixtures.js';

const denied = vi.hoisted(() => ({ actions: new Set<string>() }));
vi.mock('../../trips/permissions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../trips/permissions.js')>();
  return { ...actual, can: (role: Parameters<typeof actual.can>[0], action: Parameters<typeof actual.can>[1]) => !denied.actions.has(action) && actual.can(role, action) };
});

function entry(date: string, mealPeriod: StoredDiningEntry['mealPeriod'], experienceId: string): StoredDiningEntry {
  return { id: `e-${date}-${mealPeriod}`, date, mealPeriod, kind: 'restaurant', experienceId, placeholderKind: null, plannedItemId: null, excludedKeys: [] };
}

/** More table-service meals than a 5-night Table-Service plan covers, so every group has an amount. */
const ENTRIES: StoredDiningEntry[] = [
  ...['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05'].map((d) => entry(d, 'dinner', ID.liberty)),
  entry('2027-03-02', 'lunch', ID.crt),
  entry('2027-03-03', 'lunch', ID.pecos),
];
const IMPLICIT = 'implicit:2027-03-01';
const PLAN_KEY = `dining_plan:plan:${IMPLICIT}`;
const KEYS = [PLAN_KEY, 'dining_plan:oop', 'dining_plan:tips'];

function body(input: { combination?: Record<string, DiningStayOptionCode>; include?: DiningExportGroup[]; preview?: boolean } = {}) {
  return diningBudgetExportBodySchema.parse(input);
}

/** The engine input the service builds for this world, captured through the injected engine. */
async function engineInputOf(w: World): Promise<EngineInput> {
  const spy = vi.fn(computeDiningPlan);
  await service(w, spy).getPlan(TRIP);
  return spy.mock.calls[0]![0];
}

function withKid(extra: Parameters<typeof world>[0] = {}): World {
  return world({ entries: ENTRIES, guests: [guest(KID, 'Kit', ALEX)], profiles: [{ memberId: null, guestId: KID, ageBracket: 'child', passType: 'none' }], ...extra });
}

describe('exportToBudget writes (Requirements 26.4, 26.7, 26.9)', () => {
  it('creates the plan, out-of-pocket and tips lines with the amounts of the exported Combination', async () => {
    const w = withKid();
    const combination = { [IMPLICIT]: 'table_service' as const };
    const r = await service(w).exportToBudget(TRIP, BLAIR, body({ combination }));

    expect([r.created, r.updated, r.deleted]).toEqual([3, 0, 0]);
    expect(r.lines.map((l) => [l.key, l.lineId, l.category])).toEqual([
      [PLAN_KEY, 'line-1', 'dining'],
      ['dining_plan:oop', 'line-2', 'dining'],
      ['dining_plan:tips', 'line-3', 'other'],
    ]);
    const stored = (id: string) => w.budget.lines.get(id)!;
    // Five nights of the 2027 Table-Service plan: $99.87 an adult, $31.94 a child, stored pre-tax at 6.5 %.
    expect(stored('line-1').input).toEqual({
      category: 'dining',
      description: 'Table-Service Dining Plan (No lodging recorded)',
      plannedDate: '2027-03-01',
      priceSource: 'user_entered',
      applyTip: false,
      suggestionKey: PLAN_KEY,
      linkedExpenseId: null,
      allocations: [
        { memberId: ALEX, amountCents: toPreTax(5 * 9_987, 650) },
        { memberId: BLAIR, amountCents: toPreTax(5 * 9_987, 650) },
        { guestId: KID, amountCents: toPreTax(5 * 3_194, 650) },
      ],
    });
    expect(toPreTax(5 * 9_987, 650)).toBe(46_887);
    expect(stored('line-1').createdBy).toBe(BLAIR);

    // The other groups carry each Person's figures from the same evaluation the result shows.
    const evaluation = evaluateForExport(await engineInputOf(w), combination);
    if (!evaluation.ok) throw new Error('rejected');
    const pp = evaluation.evaluation.scenario.perPerson!;
    const target = (key: string) => (key.startsWith('m:') ? { memberId: key.slice(2) } : { guestId: key.slice(2) });
    expect(stored('line-2').input).toMatchObject({ description: 'Dining out of pocket (estimate)', plannedDate: null, suggestionKey: 'dining_plan:oop' });
    expect(stored('line-2').input.allocations).toEqual(pp.filter((p) => p.oopFoodCents + p.oopSnackMugCents > 0).map((p) => ({ ...target(p.key), amountCents: p.oopFoodCents + p.oopSnackMugCents })));
    expect(stored('line-3').input).toMatchObject({ category: 'other', description: 'Dining tips (estimate)', suggestionKey: 'dining_plan:tips' });
    expect(stored('line-3').input.allocations).toEqual(pp.filter((p) => p.tipCents > 0).map((p) => ({ ...target(p.key), amountCents: p.tipCents })));
    expect(r.lines.map((l) => l.subtotalCents)).toEqual(['line-1', 'line-2', 'line-3'].map((id) => stored(id).input.allocations.reduce((a, x) => a + (x.amountCents ?? 0), 0)));
    expect(stored('line-2').input.allocations.length).toBeGreaterThan(0);
    expect(stored('line-3').input.allocations.length).toBeGreaterThan(0);
  });

  it('edits the same lines in place on a second identical export and creates nothing', async () => {
    const w = withKid();
    const s = service(w);
    const first = await s.exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } }));
    const before = new Map([...w.budget.lines].map(([id, l]) => [id, l.input]));
    w.budget.calls.length = 0;
    const second = await s.exportToBudget(TRIP, ALEX, body({ combination: { [IMPLICIT]: 'table_service' } }));
    expect([second.created, second.updated, second.deleted]).toEqual([0, 3, 0]);
    expect(second.lines.map((l) => l.lineId)).toEqual(first.lines.map((l) => l.lineId));
    expect(w.budget.calls).toEqual(['rates', 'list', 'edit:line-1', 'edit:line-2', 'edit:line-3']);
    expect(new Map([...w.budget.lines].map(([id, l]) => [id, l.input]))).toEqual(before);
  });

  it('deletes only the line of a stay whose plan is removed, after the other writes', async () => {
    const w = world({
      entries: ENTRIES,
      stays: [stay('s1', 0, 'resort', 'Contemporary', '2027-03-01', '2027-03-03'), stay('s2', 1, 'resort', 'Pop Century', '2027-03-03', '2027-03-06')],
    });
    const s = service(w);
    await s.exportToBudget(TRIP, BLAIR, body({ combination: { s1: 'table_service', s2: 'table_service' } }));
    expect([...w.budget.lines.values()].map((l) => l.key)).toEqual(['dining_plan:plan:s1', 'dining_plan:plan:s2', 'dining_plan:oop', 'dining_plan:tips']);
    w.budget.calls.length = 0;
    const r = await s.exportToBudget(TRIP, BLAIR, body({ combination: { s1: 'table_service', s2: 'none' } }));
    expect([r.created, r.updated, r.deleted]).toEqual([0, 3, 1]);
    expect(w.budget.calls).toEqual(['rates', 'list', 'edit:line-1', 'edit:line-3', 'edit:line-4', 'remove:line-2']);
    expect([...w.budget.lines.values()].map((l) => l.key)).toEqual(['dining_plan:plan:s1', 'dining_plan:oop', 'dining_plan:tips']);
    expect(r.lines.map((l) => l.key)).toEqual(['dining_plan:plan:s1', 'dining_plan:oop', 'dining_plan:tips']);
  });

  it('deletes the earlier line of a group left out of include', async () => {
    const w = withKid();
    const s = service(w);
    await s.exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } }));
    const r = await s.exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' }, include: ['plan', 'out_of_pocket'] }));
    expect([r.created, r.updated, r.deleted]).toEqual([0, 2, 1]);
    expect([...w.budget.lines.values()].map((l) => l.key)).toEqual([PLAN_KEY, 'dining_plan:oop']);
  });

  it('never reads for modification, changes or deletes a line without the dining_plan: prefix', async () => {
    const other = (id: string, key: string | null) => ({
      id,
      key,
      createdBy: ALEX,
      input: {
        category: 'dining' as const,
        description: `Mine ${id}`,
        priceSource: 'user_entered' as const,
        ...(key === null ? {} : { suggestionKey: key }),
        allocations: [{ memberId: ALEX, amountCents: 1_000 }],
      },
    });
    const seeded = [other('mine-1', null), other('mine-2', 'planned:abc'), other('mine-3', 'diningXplan:oop'), other('mine-4', 'dining_planX')];
    const w = withKid({ budget: fakeBudget(seeded) });
    const s = service(w);
    await s.exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } }));
    await s.exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'none' }, include: ['tips'] }));
    expect(w.budget.calls.filter((c) => /mine-/.test(c))).toEqual([]);
    for (const l of seeded) expect(w.budget.lines.get(l.id)!.input).toEqual(l.input);
    expect([...w.budget.lines.values()].filter((l) => l.key?.startsWith('dining_plan:')).map((l) => l.key)).toEqual(['dining_plan:tips']);
  });

  it('keeps the linked Expense of a line it replaces', async () => {
    const expense = '55555555-5555-4555-8555-555555555555';
    const linked = {
      id: 'old-oop',
      key: 'dining_plan:oop',
      createdBy: ALEX,
      input: { category: 'dining' as const, description: 'Dining out of pocket (estimate)', priceSource: 'user_entered' as const, suggestionKey: 'dining_plan:oop', linkedExpenseId: expense, allocations: [{ memberId: ALEX, amountCents: 1 }] },
    };
    const w = withKid({ budget: fakeBudget([linked]) });
    const r = await service(w).exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } }));
    expect([r.created, r.updated]).toEqual([2, 1]);
    expect(r.lines.find((l) => l.key === 'dining_plan:oop')!.lineId).toBe('old-oop');
    expect(w.budget.lines.get('old-oop')!.input.linkedExpenseId).toBe(expense);
    expect(w.budget.lines.get('old-oop')!.input.allocations).not.toEqual(linked.input.allocations);
  });

  it('carries the tax warnings of the Budget rates', async () => {
    const w = withKid();
    w.budget.rates = { dining: 700, other: 300 };
    const r = await service(w).exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' }, preview: true }));
    expect(r.warnings).toEqual([
      { code: 'tax_rate_mismatch', calculatorTaxBps: 650, budgetTaxBps: 700 },
      { code: 'other_category_taxed', budgetTaxBps: 300 },
    ]);
  });
});

describe('exportToBudget is explicit, authorized and previewable (Property 43, Requirements 26.1 to 26.3, 26.13)', () => {
  // Feature: dining-plan-calculator, Property 43: Export is explicit, authorized and previewable without side effects
  it('Property 43: preview writes nothing and returns the lines it would write', async () => {
    const w = withKid();
    const s = service(w);
    const preview = await s.exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' }, preview: true }));
    expect(w.budget.calls).toEqual(['rates', 'list']);
    expect(w.budget.lines.size).toBe(0);
    expect([preview.created, preview.updated, preview.deleted]).toEqual([3, 0, 0]);
    expect(preview.lines.map((l) => [l.key, l.lineId])).toEqual(KEYS.map((k) => [k, null]));
    const real = await s.exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } }));
    expect(real.lines.map((l) => [l.key, l.description, l.category, l.subtotalCents])).toEqual(preview.lines.map((l) => [l.key, l.description, l.category, l.subtotalCents]));
  });

  it('exports the recommended Combination when none is given', async () => {
    const w = withKid();
    const s = service(w);
    const plan = await s.getPlan(TRIP);
    const byDefault = await s.exportToBudget(TRIP, BLAIR, body({ preview: true }));
    const explicit = await s.exportToBudget(TRIP, BLAIR, body({ combination: plan.result.recommendedCombination as Record<string, DiningStayOptionCode>, preview: true }));
    expect(byDefault).toEqual(explicit);
    expect(byDefault.lines.some((l) => l.key === PLAN_KEY)).toBe(plan.result.recommendedCombination![IMPLICIT] !== 'none');
  });

  it('never changes the dining scenario', async () => {
    const w = withKid();
    await service(w).exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } }));
    expect(w.repo.writes).toEqual([]);
  });

  it.each<[string, () => World, string]>([
    ['a non-member', () => withKid(), '30000000-0000-4000-8000-00000000ffff'],
    ['a member of an unknown Trip', () => withKid({ trip: null }), BLAIR],
  ])('answers trip_forbidden to %s and writes nothing', async (_name, make, caller) => {
    const w = make();
    await expect(service(w).exportToBudget(TRIP, caller, body({ combination: { [IMPLICIT]: 'table_service' } }))).rejects.toMatchObject({ code: 'trip_forbidden' });
    expect(w.budget.calls).toEqual([]);
  });

  it.each(['edit_budget', 'edit_dining_plan'])('answers trip_forbidden to a member who may not %s, and writes nothing', async (action) => {
    const w = withKid();
    denied.actions.add(action);
    try {
      await expect(service(w).exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } }))).rejects.toMatchObject({ code: 'trip_forbidden' });
    } finally {
      denied.actions.clear();
    }
    expect(w.budget.calls).toEqual([]);
  });

  it.each<[string, Record<string, DiningStayOptionCode>, string, string]>([
    ['a stay key of no Plan_Stay', { s1: 'table_service', s2: 'none', gone: 'none' }, 'unknown_stay', 'gone'],
    ['a plan on an off-site stay', { s1: 'table_service', s2: 'quick_service' }, 'unavailable', 's2'],
    ['another plan on a stay whose plan is booked', { s1: 'deluxe', s2: 'none' }, 'held_plan', 's1'],
    ['a stay left out', { s1: 'table_service' }, 'missing_stay', 's2'],
  ])('rejects %s with trip_validation_failed and writes nothing', async (_name, combination, reason, stayKey) => {
    const w = world({
      entries: ENTRIES,
      stays: [stay('s1', 0, 'resort', 'Contemporary', '2027-03-01', '2027-03-03'), stay('s2', 1, 'offsite', 'Aunt May', '2027-03-03', '2027-03-06')],
      settings: { stayPlans: { s1: { status: 'have_plan', heldPlan: 'table_service' } } },
    });
    await expect(service(w).exportToBudget(TRIP, BLAIR, body({ combination }))).rejects.toMatchObject({ code: 'trip_validation_failed', field: 'combination', details: { reason, stayKey } });
    expect(w.budget.calls).toEqual([]);
  });

  it('rejects a plan on a stay set to no plan', async () => {
    const w = world({ entries: ENTRIES, settings: { stayPlans: { [IMPLICIT]: { status: 'no_plan' } } } });
    await expect(service(w).exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'quick_service' } }))).rejects.toMatchObject({ code: 'trip_validation_failed', details: { reason: 'no_plan' } });
    expect(w.budget.calls).toEqual([]);
  });
});

describe('exportToBudget retries (Property 42, Requirement 26.10)', () => {
  // Feature: dining-plan-calculator, Property 42: Export is idempotent and touches only its own lines
  it('Property 42: a failed third write keeps the first two, names them, and a retry completes the same set', async () => {
    const w = withKid();
    const s = service(w);
    w.budget.failOnWrite = 3;
    const failure = await s.exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } })).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: 'trip_validation_failed', message: 'Budget line limit reached (200)', details: { completedKeys: [PLAN_KEY, 'dining_plan:oop'], failedKey: 'dining_plan:tips' } });
    expect([...w.budget.lines.values()].map((l) => l.key)).toEqual([PLAN_KEY, 'dining_plan:oop']);

    const retry = await s.exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } }));
    expect([retry.created, retry.updated, retry.deleted]).toEqual([1, 2, 0]);
    const reference = withKid();
    await service(reference).exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } }));
    const byKey = (b: World['budget']) => new Map([...b.lines.values()].map((l) => [l.key, l.input]));
    expect(byKey(w.budget)).toEqual(byKey(reference.budget));
  });

  it('rethrows an error that is not an AppError unchanged', async () => {
    const w = withKid();
    const boom = new Error('connection reset');
    w.budget.createLine = async () => {
      throw boom;
    };
    await expect(service(w).exportToBudget(TRIP, BLAIR, body({ combination: { [IMPLICIT]: 'table_service' } }))).rejects.toBe(boom);
  });
});
