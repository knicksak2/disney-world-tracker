/**
 * Task 12.3, money with a non-Visible party (account-deletion R12.7, R12.10, R12.11; Properties 13 and 29).
 *
 * A pending or purged person still counts in money: Net_Balances sum to exactly zero and carry the placeholder id and
 * the name `Deleted user`. Creating or editing an Expense or Settlement that names such a party (or a guest whose
 * sponsor is one) answers `trip_party_deleted` (409) and writes nothing; deleting the record stays allowed.
 */
import { randomUUID } from 'node:crypto';

import { DELETED_USER_DISPLAY_NAME, isDeletedUserId } from '@dwt/shared';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTripExpenseRepo, findNonVisibleParties, type TripExpenseRepo } from '../../tripExpenses/repo.js';
import { tripExpenseRoutes } from '../../tripExpenses/routes.js';
import {
  as,
  BOB,
  buildApp,
  CAROL,
  claimSubject,
  createWorld,
  DAVE,
  makePending,
  restore,
  sessionStub,
  SUBJECT,
  type World,
} from './visibility.harness.js';

let w: World;
let repo: TripExpenseRepo;
let tripId: string;
const PLACEHOLDER = `deadc0de-${SUBJECT.id.slice(9)}`;

beforeEach(async () => {
  w = await createWorld();
  repo = createTripExpenseRepo(w.pool);
  const trip = await w.seeder.insertRow('trips', { creator_id: BOB.id });
  tripId = String(trip.id);
  for (const [u, role] of [[BOB.id, 'organizer'], [CAROL.id, 'member'], [SUBJECT.id, 'member']] as const) {
    await w.seeder.insertRow('trip_memberships', { trip_id: tripId, user_id: u, role });
  }
});

const sum = (xs: readonly { netCents: number }[]): number => xs.reduce((s, x) => s + x.netCents, 0);

/** BOB pays 3000, split exactly: CAROL 1000, SUBJECT 1000 (BOB keeps the rest). Created while everyone is active. */
async function seedExpense(): Promise<string> {
  const e = await repo.createExpense(tripId, BOB.id, {
    payerId: BOB.id,
    amountCents: 3000,
    description: 'Dinner',
    date: '2026-10-02',
    splitMode: 'exact',
    shares: [
      { memberId: CAROL.id, amountCents: 1000 },
      { memberId: SUBJECT.id, amountCents: 1000 },
    ],
  } as never);
  return e.id;
}

/** Turns SUBJECT into a purged person: tombstone row, shares re-pointed, membership removed (what the purge does). */
async function purgeSubject(): Promise<string> {
  const claimed = await claimSubject(w);
  const tombstoneId = await w.repo.ensureTombstone(claimed);
  await w.pool.query(`UPDATE expense_shares SET member_id = $1 WHERE member_id = $2`, [tombstoneId, SUBJECT.id]);
  await w.pool.query(`UPDATE settlements SET payer_id = $1 WHERE payer_id = $2`, [tombstoneId, SUBJECT.id]);
  await w.pool.query(`UPDATE settlements SET recipient_id = $1 WHERE recipient_id = $2`, [tombstoneId, SUBJECT.id]);
  await w.pool.query(`DELETE FROM trip_memberships WHERE user_id = $1`, [SUBJECT.id]);
  return tombstoneId;
}

describe('Net_Balances, pairwise balances, drill-down, CSV (Property 13)', () => {
  it('a pending member still counts: balances sum to exactly zero, the member is listed under the alias, real values return after restore', async () => {
    await seedExpense();
    await makePending(w, SUBJECT.id);

    const net = await repo.getNetBalances(tripId);
    expect(sum(net)).toBe(0);
    expect(net).toHaveLength(3);
    expect(net.find((n) => n.memberId === PLACEHOLDER)!.netCents).toBe(-1000);
    expect(net.some((n) => n.memberId === SUBJECT.id)).toBe(false);
    expect(net.find((n) => n.memberId === BOB.id)!.netCents).toBe(2000);

    const pairs = await repo.getPairwiseBalances(tripId);
    expect(pairs.some((p) => p.memberIdA === PLACEHOLDER || p.memberIdB === PLACEHOLDER)).toBe(true);
    expect(JSON.stringify(pairs)).not.toContain(SUBJECT.id);
    const drill = await repo.getBalanceDrillDown(tripId, PLACEHOLDER);
    expect(drill).toHaveLength(1);

    await restore(w);
    const after = await repo.getNetBalances(tripId);
    expect(sum(after)).toBe(0);
    expect(after.find((n) => n.memberId === SUBJECT.id)!.netCents).toBe(-1000);
  });

  it('a pending member with no activity is still listed (under the alias, at 0): money reads the raw roster', async () => {
    await w.seeder.insertRow('trip_memberships', { trip_id: tripId, user_id: DAVE.id, role: 'member' });
    await seedExpense();
    await makePending(w, DAVE.id);
    const net = await repo.getNetBalances(tripId);
    const alias = `deadc0de-${DAVE.id.slice(9)}`;
    expect(net.find((n) => n.memberId === alias)).toEqual({ memberId: alias, netCents: 0 });
    expect(net.some((n) => n.memberId === DAVE.id)).toBe(false);
    expect(sum(net)).toBe(0);
  });

  it('a purged (tombstone) party who is no longer a member still gets a row, so the balances sum to zero', async () => {
    await seedExpense();
    const tombstoneId = await purgeSubject();

    const net = await repo.getNetBalances(tripId);
    expect(sum(net)).toBe(0);
    expect(net.find((n) => n.memberId === tombstoneId)!.netCents).toBe(-1000);
    expect(isDeletedUserId(tombstoneId)).toBe(true);
    const expense = (await repo.listExpensesAndSettlements(tripId))[0]!;
    expect('shares' in expense && expense.shares.map((s) => s.memberId)).toContain(tombstoneId);
  });

  it('the CSV prints "Deleted user", never a raw id, for a pending party and for a tombstone party', async () => {
    const expenseId = await seedExpense();
    await repo.createSettlement(tripId, BOB.id, { payerId: SUBJECT.id, recipientId: BOB.id, amountCents: 500, date: '2026-10-03' } as never);
    await makePending(w, SUBJECT.id);

    const pending = await repo.exportLedgerCsv(tripId);
    expect(pending).toContain(`${DELETED_USER_DISPLAY_NAME}: $10.00`);
    expect(pending).toContain(`Payment to ${BOB.displayName}`);
    expect(pending).toContain(`,${DELETED_USER_DISPLAY_NAME},5.00,,Settlement`);
    expect(pending).not.toContain(SUBJECT.id);
    expect(pending).not.toContain(PLACEHOLDER);
    expect(pending).not.toContain(SUBJECT.displayName);

    const tombstoneId = await purgeSubject();
    const purged = await repo.exportLedgerCsv(tripId);
    expect(purged).toContain(`${DELETED_USER_DISPLAY_NAME}: $10.00`);
    expect(purged).not.toContain(tombstoneId);
    expect(purged).not.toContain(SUBJECT.id);
    expect(expenseId).toBeTruthy();
  });

  it('the expense and settlement DTOs carry the placeholder id for a pending party and real ids again after restore', async () => {
    const expenseId = await seedExpense();
    await repo.createSettlement(tripId, BOB.id, { payerId: SUBJECT.id, recipientId: BOB.id, amountCents: 500, date: '2026-10-03' } as never);
    await makePending(w, SUBJECT.id);

    const during = await repo.listExpensesAndSettlements(tripId);
    expect(JSON.stringify(during)).not.toContain(SUBJECT.id);
    expect(JSON.stringify(during)).toContain(PLACEHOLDER);
    expect((await repo.getExpense(tripId, expenseId))!.shares.map((s) => s.memberId)).toContain(PLACEHOLDER);

    await restore(w);
    expect(JSON.stringify(await repo.listExpensesAndSettlements(tripId))).toContain(SUBJECT.id);
  });

  it('property: Net_Balances sum to exactly zero for any amounts with a pending or purged party (Property 13)', async () => {
    // Feature: account-deletion, Property 13: money stays zero-sum when a party is pending or purged
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.integer({ min: 100, max: 90000 }), fc.integer({ min: 1, max: 99 }), fc.integer({ min: 1, max: 99 })), {
          minLength: 1,
          maxLength: 4,
        }),
        fc.constantFrom('active', 'pending', 'purged'),
        async (entries, state) => {
          const world = await createWorld();
          const r = createTripExpenseRepo(world.pool);
          const trip = String((await world.seeder.insertRow('trips', { creator_id: BOB.id })).id);
          for (const [u, role] of [[BOB.id, 'organizer'], [CAROL.id, 'member'], [SUBJECT.id, 'member']] as const) {
            await world.seeder.insertRow('trip_memberships', { trip_id: trip, user_id: u, role });
          }
          for (const [amount, pctA, pctB] of entries) {
            const a = Math.max(1, Math.floor((amount * pctA) / 200));
            const b = Math.max(1, Math.floor((amount * pctB) / 200));
            await r.createExpense(trip, BOB.id, {
              payerId: BOB.id,
              amountCents: amount,
              description: 'x',
              date: '2026-10-02',
              splitMode: 'exact',
              shares: [
                { memberId: CAROL.id, amountCents: a },
                { memberId: SUBJECT.id, amountCents: b },
              ],
            } as never);
          }
          if (state === 'pending') await makePending(world, SUBJECT.id);
          if (state === 'purged') {
            const tombstoneId = await world.repo.ensureTombstone(await claimSubject(world));
            await world.pool.query(`UPDATE expense_shares SET member_id = $1 WHERE member_id = $2`, [tombstoneId, SUBJECT.id]);
            await world.pool.query(`DELETE FROM trip_memberships WHERE user_id = $1`, [SUBJECT.id]);
          }
          const net = await r.getNetBalances(trip);
          expect(sum(net)).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('writes naming a non-Visible party (Property 29)', () => {
  const expenseBody = (over: Record<string, unknown>): never =>
    ({
      payerId: BOB.id,
      amountCents: 1000,
      description: 'Snacks',
      date: '2026-10-04',
      splitMode: 'exact',
      shares: [{ memberId: CAROL.id, amountCents: 500 }],
      ...over,
    }) as never;

  const countRows = async (table: string): Promise<number> => (await w.pool.query(`SELECT 1 FROM ${table}`)).rowCount ?? 0;

  it('create: a pending member (real id), their alias id and a tombstone id as payer or recipient are rejected with trip_party_deleted, before the membership check, and nothing is written', async () => {
    await makePending(w, SUBJECT.id);
    const tombstoneId = `deadc0de-${randomUUID().slice(9)}`;
    const attempts: Record<string, unknown>[] = [
      { shares: [{ memberId: SUBJECT.id, amountCents: 500 }] },
      { shares: [{ memberId: PLACEHOLDER, amountCents: 500 }] },
      { shares: [{ memberId: tombstoneId, amountCents: 500 }] },
      { payerId: SUBJECT.id },
      { splitMode: 'even', shares: undefined, participantIds: [BOB.id, SUBJECT.id] },
    ];
    for (const over of attempts) {
      await expect(repo.createExpense(tripId, BOB.id, expenseBody(over))).rejects.toMatchObject({ code: 'trip_party_deleted' });
    }
    await expect(
      repo.createSettlement(tripId, BOB.id, { payerId: BOB.id, recipientId: SUBJECT.id, amountCents: 100, date: '2026-10-04' } as never),
    ).rejects.toMatchObject({ code: 'trip_party_deleted' });
    await expect(
      repo.createSettlement(tripId, BOB.id, { payerId: PLACEHOLDER, recipientId: BOB.id, amountCents: 100, date: '2026-10-04' } as never),
    ).rejects.toMatchObject({ code: 'trip_party_deleted' });
    expect(await countRows('expenses')).toBe(0);
    expect(await countRows('settlements')).toBe(0);
  });

  it('route level: POST /trips/:id/expenses naming a pending member is 409 trip_party_deleted; DELETE of a record that names one is 204', async () => {
    const expenseId = await seedExpense();
    await makePending(w, SUBJECT.id);
    const app = await buildApp(tripExpenseRoutes({ repo, pool: w.pool, requireSession: sessionStub }));

    const post = await app.inject({
      method: 'POST',
      url: `/trips/${tripId}/expenses`,
      headers: as(BOB.id),
      payload: { payerId: BOB.id, amountCents: 1000, description: 'Snacks', date: '2026-10-04', splitMode: 'exact', shares: [{ memberId: SUBJECT.id, amountCents: 500 }] },
    });
    expect(post.statusCode).toBe(409);
    expect((post.json() as { error: { code: string } }).error.code).toBe('trip_party_deleted');
    expect(post.body).not.toContain(SUBJECT.id);

    const del = await app.inject({ method: 'DELETE', url: `/trips/${tripId}/expenses/${expenseId}`, headers: as(BOB.id) });
    expect(del.statusCode).toBe(204);
  });

  it('an active party is accepted, and the same request is accepted again after restore', async () => {
    await makePending(w, SUBJECT.id);
    await expect(repo.createExpense(tripId, BOB.id, expenseBody({}))).resolves.toMatchObject({ amountCents: 1000 });
    await restore(w);
    await expect(
      repo.createExpense(tripId, BOB.id, expenseBody({ shares: [{ memberId: SUBJECT.id, amountCents: 500 }] })),
    ).resolves.toMatchObject({ amountCents: 1000 });
  });

  it('edit: a stored non-Visible party rejects the edit and changes nothing; a request naming one is rejected too; delete succeeds', async () => {
    const expenseId = await seedExpense();
    const settlement = await repo.createSettlement(tripId, BOB.id, {
      payerId: SUBJECT.id,
      recipientId: BOB.id,
      amountCents: 500,
      date: '2026-10-03',
    } as never);
    await makePending(w, SUBJECT.id);
    const storedExpense = JSON.stringify((await w.pool.query(`SELECT * FROM expenses WHERE id = $1`, [expenseId])).rows);
    const storedShares = JSON.stringify((await w.pool.query(`SELECT id, member_id, amount_cents FROM expense_shares ORDER BY id`)).rows);

    await expect(
      repo.editExpense(tripId, expenseId, BOB.id, 'organizer', expenseBody({ description: 'Edited' })),
    ).rejects.toMatchObject({ code: 'trip_party_deleted' });
    await expect(
      repo.editSettlement(tripId, settlement.id, BOB.id, 'organizer', { payerId: CAROL.id, recipientId: BOB.id, amountCents: 1, date: '2026-10-05' } as never),
    ).rejects.toMatchObject({ code: 'trip_party_deleted' });
    expect(JSON.stringify((await w.pool.query(`SELECT * FROM expenses WHERE id = $1`, [expenseId])).rows)).toBe(storedExpense);
    expect(JSON.stringify((await w.pool.query(`SELECT id, member_id, amount_cents FROM expense_shares ORDER BY id`)).rows)).toBe(storedShares);

    // Delete stays allowed under the existing authorization (adder or organizer).
    await repo.removeExpense(tripId, expenseId, BOB.id, 'organizer');
    await repo.removeSettlement(tripId, settlement.id, BOB.id, 'organizer');
    expect(await countRows('expenses')).toBe(0);
    expect(await countRows('settlements')).toBe(0);
  });

  it('edit works again after restore', async () => {
    const expenseId = await seedExpense();
    await makePending(w, SUBJECT.id);
    await expect(
      repo.editExpense(tripId, expenseId, BOB.id, 'organizer', expenseBody({ description: 'Edited', shares: [{ memberId: CAROL.id, amountCents: 100 }] })),
    ).rejects.toMatchObject({ code: 'trip_party_deleted' });
    await restore(w);
    // The stored SUBJECT share no longer blocks; an edit that keeps only active parties succeeds.
    const edited = await repo.editExpense(tripId, expenseId, BOB.id, 'organizer', expenseBody({ description: 'Edited' }));
    expect(edited.description).toBe('Edited');
  });

  describe('guests: the sponsor carries the guest (R12.11)', () => {
    const addGuest = async (sponsor: string, name: string): Promise<string> =>
      String((await w.seeder.insertRow('trip_guests', { trip_id: tripId, sponsor_member_id: sponsor, name })).id);

    it('a guest of a pending sponsor is rejected; a guest of an active sponsor is accepted; a guest of a purged sponsor is rejected', async () => {
      const activeGuest = await addGuest(CAROL.id, 'Carol Kid');
      const pendingGuest = await addGuest(SUBJECT.id, 'Subject Kid');
      await makePending(w, SUBJECT.id);

      await expect(
        repo.createExpense(tripId, BOB.id, expenseBody({ shares: [{ guestId: pendingGuest, amountCents: 500 }] })),
      ).rejects.toMatchObject({ code: 'trip_party_deleted' });
      await expect(
        repo.createExpense(tripId, BOB.id, expenseBody({ shares: [{ guestId: activeGuest, amountCents: 500 }] })),
      ).resolves.toMatchObject({ amountCents: 1000 });

      // Purged sponsor: the guest is now sponsored by the tombstone.
      const tombstoneId = await purgeSubject();
      await w.pool.query(`UPDATE trip_guests SET sponsor_member_id = $1 WHERE id = $2`, [tombstoneId, pendingGuest]);
      await expect(
        repo.createExpense(tripId, BOB.id, expenseBody({ shares: [{ guestId: pendingGuest, amountCents: 500 }] })),
      ).rejects.toMatchObject({ code: 'trip_party_deleted' });
    });

    it('findNonVisibleParties reports the user and the guest separately, and an unknown id is not reported', async () => {
      const guest = await addGuest(SUBJECT.id, 'Subject Kid');
      await makePending(w, SUBJECT.id);
      const bad = await findNonVisibleParties(w.pool, tripId, {
        userIds: [SUBJECT.id, CAROL.id, randomUUID()],
        guestIds: [guest],
      });
      expect(bad.userIds).toEqual([SUBJECT.id]);
      expect(bad.guestIds).toEqual([guest]);
    });
  });

  it('property: any request naming a non-Visible party is rejected and writes nothing (Property 29)', async () => {
    // Feature: account-deletion, Property 29: writes never involve a non-Visible money party
    const guest = String((await w.seeder.insertRow('trip_guests', { trip_id: tripId, sponsor_member_id: SUBJECT.id, name: 'Kid' })).id);
    await makePending(w, SUBJECT.id);
    const bad = [SUBJECT.id, PLACEHOLDER, `deadc0de-${randomUUID().slice(9)}`];
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...bad),
        fc.constantFrom('payer', 'share', 'recipient', 'guest'),
        fc.integer({ min: 1, max: 100000 }),
        async (party, role, cents) => {
          const before = await countRows('expenses');
          const attempt =
            role === 'recipient'
              ? repo.createSettlement(tripId, BOB.id, { payerId: BOB.id, recipientId: party, amountCents: cents, date: '2026-10-04' } as never)
              : role === 'guest'
                ? repo.createExpense(tripId, BOB.id, expenseBody({ shares: [{ guestId: guest, amountCents: 1 }] }))
                : role === 'payer'
                  ? repo.createExpense(tripId, BOB.id, expenseBody({ payerId: party }))
                  : repo.createExpense(tripId, BOB.id, expenseBody({ shares: [{ memberId: party, amountCents: 1 }] }));
          await expect(attempt).rejects.toMatchObject({ code: 'trip_party_deleted' });
          expect(await countRows('expenses')).toBe(before);
          expect(await countRows('settlements')).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
