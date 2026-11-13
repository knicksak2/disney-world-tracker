/**
 * The Budget export adapter over the REAL `trip_budget_lines` table and the REAL Budget repo (pg-mem, the Budget
 * suite's own schema harness), reading the rows back.
 *
 * Validates: dining-plan-calculator Requirements 26.2, 26.6, 26.7, 26.15, 26.16; Property 42.
 */

import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { diningBudgetExportBodySchema, type BudgetLineInput } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createTripBudgetRepo, type TripBudgetRepo } from '../../tripBudget/repo.js';
import { seedTestData, setupTestDb, type SeedTestData } from '../../tripBudget/__tests__/testDb.js';
import { assertTripMember } from '../../trips/authz.js';
import { createTripBudgetWritePort, type TripBudgetWritePort } from '../budgetPort.js';
import { ID } from '../engine/__tests__/engineFixtures.js';
import { createDiningPlanService } from '../service.js';
import type { StoredDiningEntry } from '../types.js';
import { guest, member, NOW, world } from './serviceFixtures.js';

let pool: DbPool;
let seed: SeedTestData;
let budgetRepo: TripBudgetRepo;
let port: TripBudgetWritePort;

beforeEach(async () => {
  pool = setupTestDb().pool;
  seed = await seedTestData(pool);
  budgetRepo = createTripBudgetRepo(pool);
  port = createTripBudgetWritePort({ pool, budget: budgetRepo });
});

function line(userId: string, suggestionKey: string | null, extra: Partial<BudgetLineInput> = {}): BudgetLineInput {
  return {
    category: 'dining',
    description: `Line ${suggestionKey ?? 'plain'}`,
    priceSource: 'user_entered',
    ...(suggestionKey === null ? {} : { suggestionKey }),
    allocations: [{ memberId: userId, amountCents: 1_000 }],
    ...extra,
  };
}

async function insertExpense(tripId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
     VALUES ($1, $2, $3, $3, 10000, 'Dinner', '2026-10-02', 'even')`,
    [id, tripId, seed.organizerId],
  );
  return id;
}

async function rows(tripId: string) {
  const res = await pool.query<{ id: string; suggestion_key: string | null; created_by: string; description: string }>(
    'SELECT id, suggestion_key, created_by, description FROM trip_budget_lines WHERE trip_id = $1',
    [tripId],
  );
  return [...res.rows].sort((a, b) => String(a.suggestion_key).localeCompare(String(b.suggestion_key)));
}

describe('listExportedLines (Requirement 26.16)', () => {
  it("returns this Trip's dining_plan: lines with their id, key and linked Expense, and nothing else", async () => {
    const expense = await insertExpense(seed.tripId);
    const oop = await budgetRepo.createLine(seed.tripId, seed.memberId, line(seed.memberId, 'dining_plan:oop', { linkedExpenseId: expense }));
    const plan = await budgetRepo.createLine(seed.tripId, seed.memberId, line(seed.memberId, 'dining_plan:plan:s1'));
    await budgetRepo.createLine(seed.tripId, seed.memberId, line(seed.memberId, 'diningXplan:oop'));
    await budgetRepo.createLine(seed.tripId, seed.memberId, line(seed.memberId, 'planned:abc'));
    await budgetRepo.createLine(seed.tripId, seed.memberId, line(seed.memberId, null));
    await budgetRepo.createLine(seed.otherTripId, seed.organizerId, line(seed.organizerId, 'dining_plan:oop'));

    const listed = await port.listExportedLines(seed.tripId);
    expect([...listed].sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { id: oop.id, key: 'dining_plan:oop', linkedExpenseId: expense },
      { id: plan.id, key: 'dining_plan:plan:s1', linkedExpenseId: null },
    ]);
    // The LIKE pattern alone also matches the look-alike key (`_` is a wildcard); the code filter excludes it.
    const raw = await pool.query<{ suggestion_key: string }>(
      `SELECT suggestion_key FROM trip_budget_lines WHERE trip_id = $1 AND suggestion_key LIKE 'dining_plan:%'`,
      [seed.tripId],
    );
    expect(raw.rows.map((r) => r.suggestion_key).sort()).toEqual(['diningXplan:oop', 'dining_plan:oop', 'dining_plan:plan:s1']);
  });
});

describe('getTaxBps (Requirement 26.6)', () => {
  it('reads the Budget defaults, then the stored rates', async () => {
    expect(await port.getTaxBps(seed.tripId)).toEqual({ dining: 650, other: 0 });
    await budgetRepo.patchSettings(seed.tripId, { taxBps: { dining: 700, other: 300 } });
    expect(await port.getTaxBps(seed.tripId)).toEqual({ dining: 700, other: 300 });
  });
});

describe('acting role for keyed lines (Requirement 26.15)', () => {
  function entry(date: string, mealPeriod: StoredDiningEntry['mealPeriod'], experienceId: string): StoredDiningEntry {
    return { id: `e-${date}-${mealPeriod}`, date, mealPeriod, kind: 'restaurant', experienceId, placeholderKind: null, plannedItemId: null, excludedKeys: [] };
  }

  /** The real service over the real adapter and Budget repo; only the dining repo and Party sources are fakes. */
  function realService() {
    const w = world({
      trip: { startDate: '2026-10-01', endDate: '2026-10-05' },
      members: [member(seed.organizerId, 'Alice', 'organizer'), member(seed.memberId, 'Bob'), member(seed.otherMemberId, 'Carol')],
      guests: [guest(seed.guestId, 'Timmy', seed.memberId, seed.tripId)],
      entries: [
        ...['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].map((d) => entry(d, 'dinner', ID.liberty)),
        entry('2026-10-02', 'lunch', ID.crt),
      ],
    });
    return createDiningPlanService({
      repo: w.repo,
      partyPort: w.partyPort,
      staysPort: w.staysPort,
      budgetPort: port,
      membership: { roleOf: (userId, tripId) => assertTripMember(pool, userId, tripId) },
      now: () => NOW,
    });
  }
  const KEY = 'implicit:2026-10-01';
  const body = (option: 'none' | 'table_service') => diningBudgetExportBodySchema.parse({ combination: { [KEY]: option } });

  it("lets a second non-Organizer Member update and delete the first Member's keyed lines", async () => {
    const service = realService();
    const first = await service.exportToBudget(seed.tripId, seed.memberId, body('table_service'));
    expect(first.lines.map((l) => l.key)).toEqual([`dining_plan:plan:${KEY}`, 'dining_plan:oop', 'dining_plan:tips']);
    const created = await rows(seed.tripId);
    expect(created.map((r) => [r.suggestion_key, r.created_by])).toEqual([
      ['dining_plan:oop', seed.memberId],
      [`dining_plan:plan:${KEY}`, seed.memberId],
      ['dining_plan:tips', seed.memberId],
    ]);

    // Carol (role member, not the creator) re-exports with no plan: the plan line goes, the others are replaced in place.
    const second = await service.exportToBudget(seed.tripId, seed.otherMemberId, body('none'));
    expect([second.created, second.updated, second.deleted]).toEqual([0, 2, 1]);
    const after = await rows(seed.tripId);
    expect(after.map((r) => [r.id, r.suggestion_key, r.created_by])).toEqual([
      [created[0]!.id, 'dining_plan:oop', seed.memberId],
      [created[2]!.id, 'dining_plan:tips', seed.memberId],
    ]);
    const oopTotal = await pool.query<{ amount_cents: number }>('SELECT amount_cents FROM trip_budget_allocations WHERE line_id = $1', [created[0]!.id]);
    expect(oopTotal.rows.reduce((a, r) => a + Number(r.amount_cents), 0)).toBe(second.lines.find((l) => l.key === 'dining_plan:oop')!.subtotalCents);
  });

  it("still refuses Carol on Bob's ordinary line, through the repo and through the adapter", async () => {
    const ordinary = await budgetRepo.createLine(seed.tripId, seed.memberId, line(seed.memberId, null));
    const keyedOther = await budgetRepo.createLine(seed.otherTripId, seed.organizerId, line(seed.organizerId, 'dining_plan:oop'));
    const replacement = line(seed.otherMemberId, null, { description: 'Changed by Carol' });

    await expect(budgetRepo.editLine(seed.tripId, ordinary.id, seed.otherMemberId, 'member', replacement)).rejects.toMatchObject({ code: 'trip_forbidden' });
    await expect(budgetRepo.removeLine(seed.tripId, ordinary.id, seed.otherMemberId, 'member')).rejects.toMatchObject({ code: 'trip_forbidden' });
    // A hand-built handle is refused before any repo call, even with a dining_plan: key.
    const forged = { id: ordinary.id, key: 'dining_plan:oop', linkedExpenseId: null };
    await expect(port.editLine(seed.tripId, forged, seed.otherMemberId, replacement)).rejects.toThrow(/may change only/);
    await expect(port.removeLine(seed.tripId, forged, seed.otherMemberId)).rejects.toThrow(/may change only/);
    // A handle listed for another Trip is refused on this one.
    const [otherHandle] = await port.listExportedLines(seed.otherTripId);
    expect(otherHandle!.id).toBe(keyedOther.id);
    await expect(port.removeLine(seed.tripId, otherHandle!, seed.otherMemberId)).rejects.toThrow(/may change only/);

    const left = await rows(seed.tripId);
    expect(left.map((r) => [r.id, r.description])).toEqual([[ordinary.id, 'Line plain']]);
    expect((await rows(seed.otherTripId)).map((r) => r.id)).toEqual([keyedOther.id]);
  });
});
