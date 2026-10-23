/**
 * Trip Expenses — Postgres persistence and transactional operations.
 *
 * Validates: Requirements 1.1–1.12, 2.1–2.10, 3.1–3.7, 4.1–4.6, 5.1–5.15,
 *            6.1–6.6, 7.1–7.6, 8.1–8.6, 11.1–11.8, 12.1–12.6, 13.1, 13.3,
 *            14.1–14.4
 */

import type { PoolClient } from 'pg';

import type {
  BalanceDrillDownEntryDTO,
  ExpenseCategory,
  ExpenseCreateInput,
  ExpenseDTO,
  ExpenseEditInput,
  ExpenseItemDTO,
  ExpenseShareDTO,
  ExpenseTierCountDTO,
  ExpenseTierDTO,
  NetBalanceDTO,
  PairwiseBalanceDTO,
  RefundCreateInput,
  RefundDTO,
  SettlementCreateInput,
  SettlementDTO,
  TripGuestAddInput,
  TripGuestDTO,
  TripGuestRenameInput,
} from '@dwt/shared';
import { EXPENSE_LIMIT, isDeletedUserId } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { resolvePublicIds } from '../accountDeletion/visibility.js';
import type { TripRole } from '../trips/permissions.js';
import { allocateProportionally, type AllocationTarget, splitEvenly } from './allocation.js';
import { type BalanceEvent, computeNetBalances, computePairwiseBalances } from './balances.js';
import { computeItemizedTotals, type ItemizedLineItem } from './itemizedTotals.js';

export interface TripExpenseRepo {
  // Trip Guests
  addTripGuest(tripId: string, sponsorMemberId: string, input: TripGuestAddInput): Promise<TripGuestDTO>;
  renameTripGuest(
    tripId: string,
    guestId: string,
    callerId: string,
    callerRole: TripRole,
    input: TripGuestRenameInput,
  ): Promise<TripGuestDTO>;
  removeTripGuest(tripId: string, guestId: string, callerId: string, callerRole: TripRole): Promise<void>;
  listTripGuests(tripId: string): Promise<readonly TripGuestDTO[]>;

  // Expenses
  createExpense(tripId: string, submittedByUserId: string, input: ExpenseCreateInput): Promise<ExpenseDTO>;
  editExpense(
    tripId: string,
    expenseId: string,
    callerId: string,
    callerRole: TripRole,
    input: ExpenseEditInput,
  ): Promise<ExpenseDTO>;
  removeExpense(tripId: string, expenseId: string, callerId: string, callerRole: TripRole): Promise<void>;
  getExpense(tripId: string, expenseId: string): Promise<ExpenseDTO | null>;

  // Settlements
  createSettlement(
    tripId: string,
    submittedByUserId: string,
    input: SettlementCreateInput,
  ): Promise<SettlementDTO>;
  editSettlement(
    tripId: string,
    settlementId: string,
    callerId: string,
    callerRole: TripRole,
    input: SettlementCreateInput,
  ): Promise<SettlementDTO>;
  removeSettlement(tripId: string, settlementId: string, callerId: string, callerRole: TripRole): Promise<void>;

  // Refunds
  createRefund(
    tripId: string,
    expenseId: string,
    submittedByUserId: string,
    callerRole: TripRole,
    input: RefundCreateInput,
  ): Promise<RefundDTO>;
  editRefund(
    tripId: string,
    expenseId: string,
    refundId: string,
    callerId: string,
    callerRole: TripRole,
    input: RefundCreateInput,
  ): Promise<RefundDTO>;
  removeRefund(
    tripId: string,
    expenseId: string,
    refundId: string,
    callerId: string,
    callerRole: TripRole,
  ): Promise<void>;

  // Ledger listing, balances, export
  listExpensesAndSettlements(
    tripId: string,
    filters?: { category?: ExpenseCategory | undefined; payerId?: string | undefined },
  ): Promise<readonly (ExpenseDTO | SettlementDTO)[]>;
  getNetBalances(tripId: string): Promise<readonly NetBalanceDTO[]>;
  getPairwiseBalances(tripId: string): Promise<readonly PairwiseBalanceDTO[]>;
  getBalanceDrillDown(
    tripId: string,
    memberId: string,
    counterpartyId?: string,
  ): Promise<readonly BalanceDrillDownEntryDTO[]>;
  exportLedgerCsv(tripId: string): Promise<string>;
}

async function withTx<T>(pool: DbPool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

function formatDate(val: Date | string): string {
  if (typeof val === 'string') {
    return val.length >= 10 ? val.slice(0, 10) : val;
  }
  const yyyy = val.getUTCFullYear().toString().padStart(4, '0');
  const mm = (val.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = val.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatTimestamp(val: Date | string): string {
  if (typeof val === 'string') {
    return val;
  }
  return val.toISOString();
}

/** People an entry names: user ids (members) and guest ids. An ambiguous id may be listed in both. */
export interface PartyIds {
  readonly userIds: readonly string[];
  readonly guestIds: readonly string[];
}

/**
 * Which of the named parties are NOT visible (account-deletion R12.10, R12.11): a placeholder id
 * (`isDeletedUserId`, which covers a pending account's alias and a tombstone), a real id whose account is
 * not `active`, or a guest whose sponsor is one of those (the sponsor carries the guest's balance). The only
 * place the rule is written in SQL as `deletion_state <> 'active'`, the negation of the visibility predicate.
 */
export async function findNonVisibleParties(
  db: DbPool | PoolClient,
  tripId: string,
  parties: PartyIds,
): Promise<{ readonly userIds: readonly string[]; readonly guestIds: readonly string[] }> {
  const userIds = [...new Set(parties.userIds)];
  const guestIds = [...new Set(parties.guestIds)];

  const sponsorOf = new Map<string, string>();
  if (guestIds.length > 0) {
    const guests = await db.query<{ id: string; sponsor_member_id: string }>(
      `SELECT id, sponsor_member_id FROM trip_guests WHERE trip_id = $1 AND id = ANY($2::uuid[])`,
      [tripId, guestIds],
    );
    for (const g of guests.rows) sponsorOf.set(g.id, g.sponsor_member_id);
  }

  const candidates = [...new Set([...userIds, ...sponsorOf.values()])];
  const gone = new Set(candidates.filter((id) => isDeletedUserId(id)));
  const lookup = candidates.filter((id) => !gone.has(id));
  if (lookup.length > 0) {
    const res = await db.query<{ id: string }>(
      `SELECT u.id FROM users u WHERE u.id = ANY($1::uuid[]) AND u.deletion_state <> 'active'`,
      [lookup],
    );
    for (const row of res.rows) gone.add(row.id);
  }

  return {
    userIds: userIds.filter((id) => gone.has(id)),
    guestIds: guestIds.filter((id) => {
      const sponsor = sponsorOf.get(id);
      return sponsor !== undefined && gone.has(sponsor);
    }),
  };
}

/** Throws `trip_party_deleted` (409) when any named party is not visible. The message names nobody. */
async function assertPartiesVisible(db: DbPool | PoolClient, tripId: string, parties: PartyIds): Promise<void> {
  if (parties.userIds.length === 0 && parties.guestIds.length === 0) return;
  const bad = await findNonVisibleParties(db, tripId, parties);
  if (bad.userIds.length > 0 || bad.guestIds.length > 0) {
    throw new AppError(
      'trip_party_deleted',
      "This entry involves someone who deleted their account, so it can't be changed. You can still delete it.",
    );
  }
}

/** The parties a create or edit request body names. Ambiguous ids (even-split participants, item assignees) go in both lists. */
function partiesOfExpenseInput(input: {
  payerId: string;
  splitMode?: string | undefined;
  shares?: readonly { memberId?: string | undefined; guestId?: string | undefined }[] | undefined;
  participantIds?: readonly string[] | undefined;
  tierCounts?: readonly { memberId?: string | undefined; guestId?: string | undefined }[] | undefined;
  items?: readonly { assigneeIds: readonly string[] }[] | undefined;
}): PartyIds {
  const userIds = new Set<string>([input.payerId]);
  const guestIds = new Set<string>();
  const addBoth = (id: string): void => {
    userIds.add(id);
    guestIds.add(id);
  };
  for (const s of input.shares ?? []) {
    if (s.memberId) userIds.add(s.memberId);
    if (s.guestId) guestIds.add(s.guestId);
  }
  for (const p of input.participantIds ?? []) addBoth(p);
  for (const tc of input.tierCounts ?? []) {
    if (tc.memberId) userIds.add(tc.memberId);
    if (tc.guestId) guestIds.add(tc.guestId);
  }
  for (const item of input.items ?? []) {
    for (const a of item.assigneeIds) addBoth(a);
  }
  return { userIds: [...userIds], guestIds: [...guestIds] };
}

/** The parties already stored on an expense: payer, shares, tier counts and item assignees. */
async function storedExpenseParties(db: DbPool | PoolClient, expenseId: string, payerId: string): Promise<PartyIds> {
  const userIds = new Set<string>([payerId]);
  const guestIds = new Set<string>();
  const collect = (rows: readonly { member_id: string | null; guest_id: string | null }[]): void => {
    for (const r of rows) {
      if (r.member_id) userIds.add(r.member_id);
      if (r.guest_id) guestIds.add(r.guest_id);
    }
  };
  collect(
    (
      await db.query<{ member_id: string | null; guest_id: string | null }>(
        `SELECT member_id, guest_id FROM expense_shares WHERE expense_id = $1`,
        [expenseId],
      )
    ).rows,
  );
  collect(
    (
      await db.query<{ member_id: string | null; guest_id: string | null }>(
        `SELECT etc.member_id, etc.guest_id
           FROM expense_tier_counts etc
           JOIN expense_tiers et ON et.id = etc.tier_id
          WHERE et.expense_id = $1`,
        [expenseId],
      )
    ).rows,
  );
  collect(
    (
      await db.query<{ member_id: string | null; guest_id: string | null }>(
        `SELECT a.member_id, a.guest_id
           FROM expense_item_assignees a
           JOIN expense_items i ON i.id = a.item_id
          WHERE i.expense_id = $1`,
        [expenseId],
      )
    ).rows,
  );
  return { userIds: [...userIds], guestIds: [...guestIds] };
}

export function createTripExpenseRepo(pool: DbPool): TripExpenseRepo {
  /** Maps ids through `profile_identity` once and returns the public form of each (guest ids pass through). */
  async function publicIdMap(ids: readonly (string | null | undefined)[]): Promise<(id: string) => string> {
    const real = ids.filter((id): id is string => typeof id === 'string');
    const map = await resolvePublicIds(pool, real);
    return (id) => map.get(id)?.publicId ?? id;
  }

  return {
    async addTripGuest(tripId, sponsorMemberId, input) {
      const targetSponsorId = input.sponsorMemberId ?? sponsorMemberId;
      const memberCheck = await pool.query(
        `SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
        [tripId, targetSponsorId],
      );
      if (memberCheck.rowCount === 0) {
        throw new AppError('trip_validation_failed', 'Sponsor must be a trip member');
      }

      const res = await pool.query<{
        id: string;
        trip_id: string;
        sponsor_member_id: string;
        name: string;
        created_at: Date | string;
      }>(
        `INSERT INTO trip_guests (trip_id, sponsor_member_id, name)
         VALUES ($1, $2, $3)
         RETURNING id, trip_id, sponsor_member_id, name, created_at`,
        [tripId, targetSponsorId, input.name.trim()],
      );
      const row = res.rows[0]!;
      return {
        id: row.id,
        tripId: row.trip_id,
        sponsorMemberId: row.sponsor_member_id,
        name: row.name,
        createdAt: formatTimestamp(row.created_at),
      };
    },

    async renameTripGuest(tripId, guestId, callerId, callerRole, input) {
      const check = await pool.query<{ id: string; sponsor_member_id: string }>(
        `SELECT id, sponsor_member_id FROM trip_guests WHERE id = $1 AND trip_id = $2`,
        [guestId, tripId],
      );
      const guest = check.rows[0];
      if (!guest) {
        throw new AppError('trip_forbidden', 'Guest not found');
      }
      if (callerRole !== 'organizer' && guest.sponsor_member_id !== callerId) {
        throw new AppError('trip_forbidden', 'Only sponsor or organizer may rename a guest');
      }

      let newSponsorId = guest.sponsor_member_id;
      if (input.sponsorMemberId && input.sponsorMemberId !== guest.sponsor_member_id) {
        const memberCheck = await pool.query(
          `SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
          [tripId, input.sponsorMemberId],
        );
        if (memberCheck.rowCount === 0) {
          throw new AppError('trip_validation_failed', 'Sponsor must be a trip member');
        }
        newSponsorId = input.sponsorMemberId;
      }

      const res = await pool.query<{
        id: string;
        trip_id: string;
        sponsor_member_id: string;
        name: string;
        created_at: Date | string;
      }>(
        `UPDATE trip_guests
         SET name = $1, sponsor_member_id = $2
         WHERE id = $3 AND trip_id = $4
         RETURNING id, trip_id, sponsor_member_id, name, created_at`,
        [input.name.trim(), newSponsorId, guestId, tripId],
      );
      const row = res.rows[0]!;
      return {
        id: row.id,
        tripId: row.trip_id,
        sponsorMemberId: row.sponsor_member_id,
        name: row.name,
        createdAt: formatTimestamp(row.created_at),
      };
    },

    async removeTripGuest(tripId, guestId, callerId, callerRole) {
      const check = await pool.query<{ id: string; sponsor_member_id: string }>(
        `SELECT id, sponsor_member_id FROM trip_guests WHERE id = $1 AND trip_id = $2`,
        [guestId, tripId],
      );
      const guest = check.rows[0];
      if (!guest) {
        throw new AppError('trip_forbidden', 'Guest not found');
      }
      if (callerRole !== 'organizer' && guest.sponsor_member_id !== callerId) {
        throw new AppError('trip_forbidden', 'Only sponsor or organizer may remove a guest');
      }

      // Check if guest is referenced by any share, assignee, or tier count (Req 2.9)
      const inUse = await pool.query<{ exists: boolean }>(
        `SELECT (
           EXISTS (SELECT 1 FROM expense_shares WHERE guest_id = $1) OR
           EXISTS (SELECT 1 FROM expense_item_assignees WHERE guest_id = $1) OR
           EXISTS (SELECT 1 FROM expense_tier_counts WHERE guest_id = $1)
         ) AS exists`,
        [guestId],
      );
      if (inUse.rows[0]?.exists) {
        throw new AppError(
          'trip_validation_failed',
          'Cannot remove guest with recorded expense shares or assignments',
        );
      }

      await pool.query(`DELETE FROM trip_guests WHERE id = $1 AND trip_id = $2`, [guestId, tripId]);
    },

    async listTripGuests(tripId) {
      const res = await pool.query<{
        id: string;
        trip_id: string;
        sponsor_member_id: string;
        name: string;
        created_at: Date | string;
      }>(
        `SELECT id, trip_id, sponsor_member_id, name, created_at
         FROM trip_guests
         WHERE trip_id = $1
         ORDER BY created_at ASC`,
        [tripId],
      );
      const pub = await publicIdMap(res.rows.map((r) => r.sponsor_member_id));
      return res.rows.map((row) => ({
        id: row.id,
        tripId: row.trip_id,
        sponsorMemberId: pub(row.sponsor_member_id),
        name: row.name,
        createdAt: formatTimestamp(row.created_at),
      }));
    },

    async createExpense(tripId, submittedByUserId, input) {
      return withTx(pool, async (client) => {
        // Row lock on trip
        const tripCheck = await client.query<{ id: string }>(
          `SELECT id FROM trips WHERE id = $1 FOR UPDATE`,
          [tripId],
        );
        if (!tripCheck.rows[0]) {
          throw new AppError('trip_forbidden', 'Trip not found');
        }

        // A party who is not visible (pending, purging, purged) cannot be named: checked before any
        // membership check, because a pending member's real id still passes that check (R12.10, R12.11).
        await assertPartiesVisible(client, tripId, partiesOfExpenseInput(input));

        // Cap check (Req 1.12)
        const countRes = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM expenses WHERE trip_id = $1`,
          [tripId],
        );
        if (parseInt(countRes.rows[0]?.count ?? '0', 10) >= EXPENSE_LIMIT) {
          throw new AppError('trip_validation_failed', 'Expense limit of 1,000 reached for trip');
        }

        // Validate payer is a trip member (Req 1.2)
        const payerCheck = await client.query(
          `SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
          [tripId, input.payerId],
        );
        if (payerCheck.rowCount === 0) {
          throw new AppError('trip_validation_failed', 'Payer must be a trip member');
        }

        // Validate catalog links (Req 11.1, 11.2, 11.6, 11.8)
        if (input.experienceId) {
          const expCheck = await client.query<{ category: string }>(
            `SELECT category FROM experiences WHERE id = $1`,
            [input.experienceId],
          );
          if (expCheck.rowCount === 0 || expCheck.rows[0]?.category !== 'Restaurant') {
            throw new AppError('trip_validation_failed', 'Linked experience must be a catalog restaurant');
          }
        }
        if (input.resortId) {
          const resortCheck = await client.query(
            `SELECT 1 FROM resorts WHERE id = $1`,
            [input.resortId],
          );
          if (resortCheck.rowCount === 0) {
            throw new AppError('trip_validation_failed', 'Linked resort must exist in catalog');
          }
        }

        // Collect all referenced recipients and validate they belong to trip (Req 2.5)
        const memberIdsToCheck = new Set<string>();
        const guestIdsToCheck = new Set<string>();

        if (input.splitMode === 'exact' && input.shares) {
          for (const s of input.shares) {
            if (s.memberId) memberIdsToCheck.add(s.memberId);
            if (s.guestId) guestIdsToCheck.add(s.guestId);
          }
        } else if (input.splitMode === 'even' && input.participantIds) {
          for (const p of input.participantIds) {
            memberIdsToCheck.add(p);
          }
        } else if (input.splitMode === 'tiered' && input.tierCounts) {
          for (const tc of input.tierCounts) {
            if (tc.memberId) memberIdsToCheck.add(tc.memberId);
            if (tc.guestId) guestIdsToCheck.add(tc.guestId);
          }
        } else if (input.splitMode === 'itemized' && input.items) {
          for (const item of input.items) {
            for (const a of item.assigneeIds) {
              memberIdsToCheck.add(a);
            }
          }
        }

        if (memberIdsToCheck.size > 0) {
          const mIds = Array.from(memberIdsToCheck);
          const mRes = await client.query<{ id: string }>(
            `SELECT user_id AS id FROM trip_memberships WHERE trip_id = $1 AND user_id = ANY($2::uuid[])
             UNION
             SELECT id FROM trip_guests WHERE trip_id = $1 AND id = ANY($2::uuid[])`,
            [tripId, mIds],
          );
          const found = new Set(mRes.rows.map((r) => r.id));
          for (const id of mIds) {
            if (!found.has(id)) {
              throw new AppError('trip_validation_failed', `Recipient ${id} is not in trip`);
            }
          }
        }

        if (guestIdsToCheck.size > 0) {
          const gIds = Array.from(guestIdsToCheck);
          const gRes = await client.query<{ id: string }>(
            `SELECT id FROM trip_guests WHERE trip_id = $1 AND id = ANY($2::uuid[])`,
            [tripId, gIds],
          );
          const found = new Set(gRes.rows.map((r) => r.id));
          for (const id of gIds) {
            if (!found.has(id)) {
              throw new AppError('trip_validation_failed', `Guest ${id} is not in trip`);
            }
          }
        }

        let amountCents = input.amountCents ?? 0;
        let calculatedShares: { memberId?: string | undefined; guestId?: string | undefined; amountCents: number }[] = [];
        let createdTiers: ExpenseTierDTO[] = [];
        let createdTierCounts: ExpenseTierCountDTO[] = [];
        let createdItems: ExpenseItemDTO[] = [];

        if (input.splitMode === 'exact') {
          if (!input.shares) {
            calculatedShares = [];
          } else {
            const sumShares = input.shares.reduce((s, sh) => s + sh.amountCents, 0);
            if (sumShares > amountCents) {
              throw new AppError('trip_validation_failed', 'Shares sum exceeds expense amount');
            }
            calculatedShares = input.shares.map((s) => ({
              memberId: s.memberId,
              guestId: s.guestId,
              amountCents: s.amountCents,
            }));
          }
        } else if (input.splitMode === 'even') {
          const participants = input.participantIds ?? [];
          const payerIncluded = participants.includes(input.payerId);
          const nonPayers = participants.filter((p) => p !== input.payerId);

          if (nonPayers.length < 1) {
            throw new AppError('trip_validation_failed', 'Fewer than one other participant selected');
          }

          if (payerIncluded) {
            // Req 3.4: floor(amount / participantCount) for non-payers, remainder to payer
            const count = participants.length;
            const baseShare = Math.floor(amountCents / count);
            for (const p of nonPayers) {
              calculatedShares.push({ memberId: p, amountCents: baseShare });
            }
          } else {
            // Req 3.5: split evenly among remaining participants only
            const splits = splitEvenly(amountCents, nonPayers);
            for (const split of splits) {
              calculatedShares.push({ memberId: split.assigneeId, amountCents: split.amountCents });
            }
          }
        } else if (input.splitMode === 'tiered') {
          const tiersInput = input.tiers ?? [];
          if (tiersInput.length === 0) {
            throw new AppError('trip_validation_failed', 'Tiered expense requires at least one tier');
          }

          // We will generate IDs for tiers if needed
          const tierMap = new Map<string, { id: string; name: string; priceCents: number }>();
          for (const t of tiersInput) {
            const tierId = t.id ?? (await client.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0]!.id;
            tierMap.set(t.name, { id: tierId, name: t.name, priceCents: t.priceCents });
            if (t.id) {
              tierMap.set(t.id, { id: tierId, name: t.name, priceCents: t.priceCents });
            }
          }

          const tierCountsInput = input.tierCounts ?? [];
          const recipientTotals = new Map<string, { memberId?: string | undefined; guestId?: string | undefined; amountCents: number }>();

          for (const tc of tierCountsInput) {
            const tier = tierMap.get(tc.tierId);
            if (!tier) {
              throw new AppError('trip_validation_failed', `Tier ${tc.tierId} does not belong to expense`);
            }
            const cost = tc.count * tier.priceCents;
            const recKey = tc.memberId ? `m:${tc.memberId}` : `g:${tc.guestId}`;
            const cur = recipientTotals.get(recKey) ?? {
              memberId: tc.memberId,
              guestId: tc.guestId,
              amountCents: 0,
            };
            cur.amountCents += cost;
            recipientTotals.set(recKey, cur);
          }

          let sumTierShares = 0;
          for (const rec of recipientTotals.values()) {
            if (rec.memberId !== input.payerId) {
              calculatedShares.push(rec);
            }
            sumTierShares += rec.amountCents;
          }

          if (sumTierShares > amountCents) {
            throw new AppError('trip_validation_failed', 'Tiered shares sum exceeds expense amount');
          }
        } else if (input.splitMode === 'itemized') {
          const rawItems = input.items ?? [];
          if (rawItems.length === 0) {
            throw new Error('trip_validation_failed');
          }

          const itemizedLines: ItemizedLineItem[] = [];
          for (const item of rawItems) {
            const itemId = item.id ?? (await client.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0]!.id;
            itemizedLines.push({
              id: itemId,
              priceCents: item.priceCents,
              assigneeIds: item.assigneeIds,
              isAlcohol: Boolean(item.isAlcohol),
            });
          }

          const chargeLines = input.chargeLines ?? [];
          const totals = computeItemizedTotals(itemizedLines, chargeLines, input.payerId);
          amountCents = totals.amountCents;

          calculatedShares = totals.shares.map((s) => ({
            memberId: s.recipientId,
            amountCents: s.amountCents,
          }));
        }

        // Insert expense row
        const expRes = await client.query<{
          id: string;
          trip_id: string;
          payer_id: string;
          created_by: string;
          amount_cents: string;
          description: string;
          expense_date: Date | string;
          category: ExpenseCategory | null;
          split_mode: string;
          experience_id: string | null;
          resort_id: string | null;
          created_at: Date | string;
        }>(
          `INSERT INTO expenses (
             trip_id, payer_id, created_by, amount_cents, description,
             expense_date, category, split_mode, experience_id, resort_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, trip_id, payer_id, created_by, amount_cents, description,
                     expense_date, category, split_mode, experience_id, resort_id, created_at`,
          [
            tripId,
            input.payerId,
            submittedByUserId,
            amountCents,
            input.description.trim(),
            input.date,
            input.category ?? null,
            input.splitMode,
            input.experienceId ?? null,
            input.resortId ?? null,
          ],
        );
        const expRow = expRes.rows[0]!;
        const expenseId = expRow.id;

        // Insert shares
        const insertedShares: ExpenseShareDTO[] = [];
        for (const s of calculatedShares) {
          // Check if recipient is a guest vs member
          let memberId = s.memberId ?? null;
          let guestId = s.guestId ?? null;

          if (memberId) {
            const isGuest = await client.query(`SELECT 1 FROM trip_guests WHERE id = $1`, [memberId]);
            if (isGuest.rowCount! > 0) {
              guestId = memberId;
              memberId = null;
            }
          }

          const shareRes = await client.query<{
            id: string;
            expense_id: string;
            member_id: string | null;
            guest_id: string | null;
            amount_cents: string;
          }>(
            `INSERT INTO expense_shares (expense_id, member_id, guest_id, amount_cents)
             VALUES ($1, $2, $3, $4)
             RETURNING id, expense_id, member_id, guest_id, amount_cents`,
            [expenseId, memberId, guestId, s.amountCents],
          );
          const sh = shareRes.rows[0]!;
          insertedShares.push({
            id: sh.id,
            expenseId: sh.expense_id,
            memberId: sh.member_id,
            guestId: sh.guest_id,
            amountCents: parseInt(sh.amount_cents, 10),
          });
        }

        // Insert tiers & tier counts if tiered
        if (input.splitMode === 'tiered' && input.tiers) {
          const tierNameToId = new Map<string, string>();
          for (const t of input.tiers) {
            const tierRes = await client.query<{
              id: string;
              expense_id: string;
              tier_name: string;
              price_cents: string;
            }>(
              `INSERT INTO expense_tiers (expense_id, tier_name, price_cents)
               VALUES ($1, $2, $3)
               RETURNING id, expense_id, tier_name, price_cents`,
              [expenseId, t.name.trim(), t.priceCents],
            );
            const tr = tierRes.rows[0]!;
            createdTiers.push({
              id: tr.id,
              expenseId: tr.expense_id,
              name: tr.tier_name,
              priceCents: parseInt(tr.price_cents, 10),
            });
            tierNameToId.set(t.name, tr.id);
            if (t.id) tierNameToId.set(t.id, tr.id);
          }

          if (input.tierCounts) {
            for (const tc of input.tierCounts) {
              const tierId = tierNameToId.get(tc.tierId) ?? tc.tierId;
              let memberId = tc.memberId ?? null;
              let guestId = tc.guestId ?? null;
              if (memberId) {
                const isGuest = await client.query(`SELECT 1 FROM trip_guests WHERE id = $1`, [memberId]);
                if (isGuest.rowCount! > 0) {
                  guestId = memberId;
                  memberId = null;
                }
              }

              const tcRes = await client.query<{
                id: string;
                tier_id: string;
                member_id: string | null;
                guest_id: string | null;
                unit_count: number;
              }>(
                `INSERT INTO expense_tier_counts (tier_id, member_id, guest_id, unit_count)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, tier_id, member_id, guest_id, unit_count`,
                [tierId, memberId, guestId, tc.count],
              );
              const tcr = tcRes.rows[0]!;
              createdTierCounts.push({
                id: tcr.id,
                tierId: tcr.tier_id,
                memberId: tcr.member_id,
                guestId: tcr.guest_id,
                count: tcr.unit_count,
              });
            }
          }
        }

        // Insert items & charge lines if itemized
        const createdChargeLines: {
          id: string;
          expenseId: string;
          kind: any;
          amountCents: number;
          excludeAlcohol: boolean;
          scopeItemIds: string[];
        }[] = [];

        if (input.splitMode === 'itemized' && input.items) {
          const itemKeyToId = new Map<string, string>();
          for (const item of input.items) {
            const itemRes = await client.query<{
              id: string;
              expense_id: string;
              item_name: string;
              price_cents: string;
              is_alcohol: boolean;
            }>(
              `INSERT INTO expense_items (expense_id, item_name, price_cents, is_alcohol)
               VALUES ($1, $2, $3, $4)
               RETURNING id, expense_id, item_name, price_cents, is_alcohol`,
              [expenseId, item.name.trim(), item.priceCents, Boolean(item.isAlcohol)],
            );
            const ir = itemRes.rows[0]!;
            const realItemId = ir.id;
            if (item.id) itemKeyToId.set(item.id, realItemId);

            const insertedAssignees: string[] = [];
            for (const aId of item.assigneeIds) {
              const isGuest = await client.query(`SELECT 1 FROM trip_guests WHERE id = $1`, [aId]);
              const memberId = isGuest.rowCount! > 0 ? null : aId;
              const guestId = isGuest.rowCount! > 0 ? aId : null;

              await client.query(
                `INSERT INTO expense_item_assignees (item_id, member_id, guest_id)
                 VALUES ($1, $2, $3)`,
                [realItemId, memberId, guestId],
              );
              insertedAssignees.push(aId);
            }

            createdItems.push({
              id: realItemId,
              expenseId: ir.expense_id,
              name: ir.item_name,
              priceCents: parseInt(ir.price_cents, 10),
              isAlcohol: ir.is_alcohol,
              assigneeIds: insertedAssignees,
            });
          }

          if (input.chargeLines) {
            for (const cl of input.chargeLines) {
              const clRes = await client.query<{
                id: string;
                expense_id: string;
                kind: any;
                amount_cents: string;
                exclude_alcohol: boolean;
              }>(
                `INSERT INTO charge_lines (expense_id, kind, amount_cents, exclude_alcohol)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, expense_id, kind, amount_cents, exclude_alcohol`,
                [expenseId, cl.kind, cl.amountCents, Boolean(cl.excludeAlcohol)],
              );
              const clr = clRes.rows[0]!;
              const resolvedScopeIds: string[] = [];
              if (cl.scopeItemIds) {
                for (const sId of cl.scopeItemIds) {
                  const targetId = itemKeyToId.get(sId) ?? sId;
                  await client.query(
                    `INSERT INTO charge_line_scopes (charge_line_id, item_id)
                     VALUES ($1, $2)`,
                    [clr.id, targetId],
                  );
                  resolvedScopeIds.push(targetId);
                }
              }
              createdChargeLines.push({
                id: clr.id,
                expenseId: clr.expense_id,
                kind: clr.kind,
                amountCents: parseInt(clr.amount_cents, 10),
                excludeAlcohol: clr.exclude_alcohol,
                scopeItemIds: resolvedScopeIds,
              });
            }
          }
        }

        return {
          id: expenseId,
          tripId: expRow.trip_id,
          payerId: expRow.payer_id,
          createdByUserId: expRow.created_by,
          amountCents: parseInt(expRow.amount_cents, 10),
          description: expRow.description,
          date: formatDate(expRow.expense_date),
          category: expRow.category,
          splitMode: expRow.split_mode as any,
          experienceId: expRow.experience_id,
          resortId: expRow.resort_id,
          shares: insertedShares,
          tiers: createdTiers,
          tierCounts: createdTierCounts,
          items: createdItems,
          chargeLines: createdChargeLines,
          refunds: [],
          createdAt: formatTimestamp(expRow.created_at),
        };
      });
    },

    async editExpense(tripId, expenseId, callerId, callerRole, input) {
      return withTx(pool, async (client) => {
        const expCheck = await client.query<{
          id: string;
          created_by: string;
          payer_id: string;
          split_mode: string;
        }>(
          `SELECT id, created_by, payer_id, split_mode FROM expenses WHERE id = $1 AND trip_id = $2 FOR UPDATE`,
          [expenseId, tripId],
        );
        const existing = expCheck.rows[0];
        if (!existing) {
          throw new AppError('trip_forbidden', 'Expense not found');
        }
        if (callerRole !== 'organizer' && existing.created_by !== callerId) {
          throw new AppError('trip_forbidden', 'Only creator or organizer may edit an expense');
        }

        // The request body may not name a party who is not visible, and neither may the stored entry
        // (the client holds alias ids for those people and cannot resubmit the real ones). Delete stays
        // allowed (R12.10).
        const stored = await storedExpenseParties(client, expenseId, existing.payer_id);
        await assertPartiesVisible(client, tripId, {
          userIds: [...stored.userIds, ...partiesOfExpenseInput(input).userIds],
          guestIds: [...stored.guestIds, ...partiesOfExpenseInput(input).guestIds],
        });

        // Clean out existing child rows (Req 8.3)
        await client.query(`DELETE FROM expense_shares WHERE expense_id = $1`, [expenseId]);
        await client.query(`DELETE FROM expense_tiers WHERE expense_id = $1`, [expenseId]);
        await client.query(`DELETE FROM expense_items WHERE expense_id = $1`, [expenseId]);
        await client.query(`DELETE FROM charge_lines WHERE expense_id = $1`, [expenseId]);

        // Re-run mode validation and calculation logic
        let amountCents = input.amountCents ?? 0;
        let calculatedShares: { memberId?: string | undefined; guestId?: string | undefined; amountCents: number }[] = [];
        let createdTiers: ExpenseTierDTO[] = [];
        let createdTierCounts: ExpenseTierCountDTO[] = [];
        let createdItems: ExpenseItemDTO[] = [];
        let createdChargeLines: any[] = [];

        if (input.splitMode === 'exact') {
          if (!input.shares) {
            calculatedShares = [];
          } else {
            const sumShares = input.shares.reduce((s, sh) => s + sh.amountCents, 0);
            if (sumShares > amountCents) {
              throw new AppError('trip_validation_failed', 'Shares sum exceeds expense amount');
            }
            calculatedShares = input.shares.map((s) => ({
              memberId: s.memberId,
              guestId: s.guestId,
              amountCents: s.amountCents,
            }));
          }
        } else if (input.splitMode === 'even') {
          const participants = input.participantIds ?? [];
          const payerIncluded = participants.includes(input.payerId);
          const nonPayers = participants.filter((p) => p !== input.payerId);

          if (nonPayers.length < 1) {
            throw new AppError('trip_validation_failed', 'Fewer than one other participant selected');
          }

          if (payerIncluded) {
            const count = participants.length;
            const baseShare = Math.floor(amountCents / count);
            for (const p of nonPayers) {
              calculatedShares.push({ memberId: p, amountCents: baseShare });
            }
          } else {
            const splits = splitEvenly(amountCents, nonPayers);
            for (const split of splits) {
              calculatedShares.push({ memberId: split.assigneeId, amountCents: split.amountCents });
            }
          }
        } else if (input.splitMode === 'tiered') {
          const tiersInput = input.tiers ?? [];
          if (tiersInput.length === 0) {
            throw new AppError('trip_validation_failed', 'Tiered expense requires at least one tier');
          }

          const tierMap = new Map<string, { id: string; name: string; priceCents: number }>();
          for (const t of tiersInput) {
            const tierId = t.id ?? (await client.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0]!.id;
            tierMap.set(t.name, { id: tierId, name: t.name, priceCents: t.priceCents });
            if (t.id) {
              tierMap.set(t.id, { id: tierId, name: t.name, priceCents: t.priceCents });
            }
          }

          const tierCountsInput = input.tierCounts ?? [];
          const recipientTotals = new Map<string, { memberId?: string | undefined; guestId?: string | undefined; amountCents: number }>();

          for (const tc of tierCountsInput) {
            const tier = tierMap.get(tc.tierId);
            if (!tier) {
              throw new AppError('trip_validation_failed', `Tier ${tc.tierId} does not belong to expense`);
            }
            const cost = tc.count * tier.priceCents;
            const recKey = tc.memberId ? `m:${tc.memberId}` : `g:${tc.guestId}`;
            const cur = recipientTotals.get(recKey) ?? {
              memberId: tc.memberId,
              guestId: tc.guestId,
              amountCents: 0,
            };
            cur.amountCents += cost;
            recipientTotals.set(recKey, cur);
          }

          let sumTierShares = 0;
          for (const rec of recipientTotals.values()) {
            if (rec.memberId !== input.payerId) {
              calculatedShares.push(rec);
            }
            sumTierShares += rec.amountCents;
          }

          if (sumTierShares > amountCents) {
            throw new AppError('trip_validation_failed', 'Tiered shares sum exceeds expense amount');
          }
        } else if (input.splitMode === 'itemized') {
          const rawItems = input.items ?? [];
          if (rawItems.length === 0) {
            throw new Error('trip_validation_failed');
          }

          const itemizedLines: ItemizedLineItem[] = [];
          for (const item of rawItems) {
            const itemId = item.id ?? (await client.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0]!.id;
            itemizedLines.push({
              id: itemId,
              priceCents: item.priceCents,
              assigneeIds: item.assigneeIds,
              isAlcohol: Boolean(item.isAlcohol),
            });
          }

          const chargeLines = input.chargeLines ?? [];
          const totals = computeItemizedTotals(itemizedLines, chargeLines, input.payerId);
          amountCents = totals.amountCents;

          calculatedShares = totals.shares.map((s) => ({
            memberId: s.recipientId,
            amountCents: s.amountCents,
          }));
        }

        // Update expense row
        const expRes = await client.query<{
          id: string;
          trip_id: string;
          payer_id: string;
          created_by: string;
          amount_cents: string;
          description: string;
          expense_date: Date | string;
          category: ExpenseCategory | null;
          split_mode: string;
          experience_id: string | null;
          resort_id: string | null;
          created_at: Date | string;
        }>(
          `UPDATE expenses
           SET payer_id = $1, amount_cents = $2, description = $3, expense_date = $4,
               category = $5, split_mode = $6, experience_id = $7, resort_id = $8
           WHERE id = $9
           RETURNING id, trip_id, payer_id, created_by, amount_cents, description,
                     expense_date, category, split_mode, experience_id, resort_id, created_at`,
          [
            input.payerId,
            amountCents,
            input.description.trim(),
            input.date,
            input.category ?? null,
            input.splitMode,
            input.experienceId ?? null,
            input.resortId ?? null,
            expenseId,
          ],
        );
        const expRow = expRes.rows[0]!;

        // Insert new shares
        const insertedShares: ExpenseShareDTO[] = [];
        for (const s of calculatedShares) {
          let memberId = s.memberId ?? null;
          let guestId = s.guestId ?? null;
          if (memberId) {
            const isGuest = await client.query(`SELECT 1 FROM trip_guests WHERE id = $1`, [memberId]);
            if (isGuest.rowCount! > 0) {
              guestId = memberId;
              memberId = null;
            }
          }
          const shareRes = await client.query<{
            id: string;
            expense_id: string;
            member_id: string | null;
            guest_id: string | null;
            amount_cents: string;
          }>(
            `INSERT INTO expense_shares (expense_id, member_id, guest_id, amount_cents)
             VALUES ($1, $2, $3, $4)
             RETURNING id, expense_id, member_id, guest_id, amount_cents`,
            [expenseId, memberId, guestId, s.amountCents],
          );
          const sh = shareRes.rows[0]!;
          insertedShares.push({
            id: sh.id,
            expenseId: sh.expense_id,
            memberId: sh.member_id,
            guestId: sh.guest_id,
            amountCents: parseInt(sh.amount_cents, 10),
          });
        }

        // Insert tiers & tier counts if tiered
        if (input.splitMode === 'tiered' && input.tiers) {
          const tierNameToId = new Map<string, string>();
          for (const t of input.tiers) {
            const tierRes = await client.query<{
              id: string;
              expense_id: string;
              tier_name: string;
              price_cents: string;
            }>(
              `INSERT INTO expense_tiers (expense_id, tier_name, price_cents)
               VALUES ($1, $2, $3)
               RETURNING id, expense_id, tier_name, price_cents`,
              [expenseId, t.name.trim(), t.priceCents],
            );
            const tr = tierRes.rows[0]!;
            createdTiers.push({
              id: tr.id,
              expenseId: tr.expense_id,
              name: tr.tier_name,
              priceCents: parseInt(tr.price_cents, 10),
            });
            tierNameToId.set(t.name, tr.id);
            if (t.id) tierNameToId.set(t.id, tr.id);
          }

          if (input.tierCounts) {
            for (const tc of input.tierCounts) {
              const tierId = tierNameToId.get(tc.tierId) ?? tc.tierId;
              let memberId = tc.memberId ?? null;
              let guestId = tc.guestId ?? null;
              if (memberId) {
                const isGuest = await client.query(`SELECT 1 FROM trip_guests WHERE id = $1`, [memberId]);
                if (isGuest.rowCount! > 0) {
                  guestId = memberId;
                  memberId = null;
                }
              }
              const tcRes = await client.query<{
                id: string;
                tier_id: string;
                member_id: string | null;
                guest_id: string | null;
                unit_count: number;
              }>(
                `INSERT INTO expense_tier_counts (tier_id, member_id, guest_id, unit_count)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, tier_id, member_id, guest_id, unit_count`,
                [tierId, memberId, guestId, tc.count],
              );
              const tcr = tcRes.rows[0]!;
              createdTierCounts.push({
                id: tcr.id,
                tierId: tcr.tier_id,
                memberId: tcr.member_id,
                guestId: tcr.guest_id,
                count: tcr.unit_count,
              });
            }
          }
        }

        // Insert items & charge lines if itemized
        if (input.splitMode === 'itemized' && input.items) {
          const itemKeyToId = new Map<string, string>();
          for (const item of input.items) {
            const itemRes = await client.query<{
              id: string;
              expense_id: string;
              item_name: string;
              price_cents: string;
              is_alcohol: boolean;
            }>(
              `INSERT INTO expense_items (expense_id, item_name, price_cents, is_alcohol)
               VALUES ($1, $2, $3, $4)
               RETURNING id, expense_id, item_name, price_cents, is_alcohol`,
              [expenseId, item.name.trim(), item.priceCents, Boolean(item.isAlcohol)],
            );
            const ir = itemRes.rows[0]!;
            const realItemId = ir.id;
            if (item.id) itemKeyToId.set(item.id, realItemId);

            const insertedAssignees: string[] = [];
            for (const aId of item.assigneeIds) {
              const isGuest = await client.query(`SELECT 1 FROM trip_guests WHERE id = $1`, [aId]);
              const memberId = isGuest.rowCount! > 0 ? null : aId;
              const guestId = isGuest.rowCount! > 0 ? aId : null;
              await client.query(
                `INSERT INTO expense_item_assignees (item_id, member_id, guest_id)
                 VALUES ($1, $2, $3)`,
                [realItemId, memberId, guestId],
              );
              insertedAssignees.push(aId);
            }

            createdItems.push({
              id: realItemId,
              expenseId: ir.expense_id,
              name: ir.item_name,
              priceCents: parseInt(ir.price_cents, 10),
              isAlcohol: ir.is_alcohol,
              assigneeIds: insertedAssignees,
            });
          }

          if (input.chargeLines) {
            for (const cl of input.chargeLines) {
              const clRes = await client.query<{
                id: string;
                expense_id: string;
                kind: any;
                amount_cents: string;
                exclude_alcohol: boolean;
              }>(
                `INSERT INTO charge_lines (expense_id, kind, amount_cents, exclude_alcohol)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, expense_id, kind, amount_cents, exclude_alcohol`,
                [expenseId, cl.kind, cl.amountCents, Boolean(cl.excludeAlcohol)],
              );
              const clr = clRes.rows[0]!;
              const resolvedScopeIds: string[] = [];
              if (cl.scopeItemIds) {
                for (const sId of cl.scopeItemIds) {
                  const targetId = itemKeyToId.get(sId) ?? sId;
                  await client.query(
                    `INSERT INTO charge_line_scopes (charge_line_id, item_id)
                     VALUES ($1, $2)`,
                    [clr.id, targetId],
                  );
                  resolvedScopeIds.push(targetId);
                }
              }
              createdChargeLines.push({
                id: clr.id,
                expenseId: clr.expense_id,
                kind: clr.kind,
                amountCents: parseInt(clr.amount_cents, 10),
                excludeAlcohol: clr.exclude_alcohol,
                scopeItemIds: resolvedScopeIds,
              });
            }
          }
        }

        // Get existing refunds
        const refundsRes = await client.query<{
          id: string;
          expense_id: string;
          created_by: string;
          amount_cents: string;
          refund_date: Date | string;
          created_at: Date | string;
        }>(
          `SELECT id, expense_id, created_by, amount_cents, refund_date, created_at
           FROM expense_refunds WHERE expense_id = $1 ORDER BY created_at ASC`,
          [expenseId],
        );
        const refunds: RefundDTO[] = refundsRes.rows.map((r) => ({
          id: r.id,
          expenseId: r.expense_id,
          createdByUserId: r.created_by,
          amountCents: parseInt(r.amount_cents, 10),
          date: formatDate(r.refund_date),
          createdAt: formatTimestamp(r.created_at),
        }));

        return {
          id: expenseId,
          tripId: expRow.trip_id,
          payerId: expRow.payer_id,
          createdByUserId: expRow.created_by,
          amountCents: parseInt(expRow.amount_cents, 10),
          description: expRow.description,
          date: formatDate(expRow.expense_date),
          category: expRow.category,
          splitMode: expRow.split_mode as any,
          experienceId: expRow.experience_id,
          resortId: expRow.resort_id,
          shares: insertedShares,
          tiers: createdTiers,
          tierCounts: createdTierCounts,
          items: createdItems,
          chargeLines: createdChargeLines,
          refunds,
          createdAt: formatTimestamp(expRow.created_at),
        };
      });
    },

    async removeExpense(tripId, expenseId, callerId, callerRole) {
      const expCheck = await pool.query<{ id: string; created_by: string }>(
        `SELECT id, created_by FROM expenses WHERE id = $1 AND trip_id = $2`,
        [expenseId, tripId],
      );
      const existing = expCheck.rows[0];
      if (!existing) {
        throw new AppError('trip_forbidden', 'Expense not found');
      }
      if (callerRole !== 'organizer' && existing.created_by !== callerId) {
        throw new AppError('trip_forbidden', 'Only creator or organizer may delete an expense');
      }

      await pool.query(`DELETE FROM expenses WHERE id = $1 AND trip_id = $2`, [expenseId, tripId]);
    },

    async getExpense(tripId, expenseId) {
      const expRes = await pool.query<{
        id: string;
        trip_id: string;
        payer_id: string;
        created_by: string;
        amount_cents: string;
        description: string;
        expense_date: Date | string;
        category: ExpenseCategory | null;
        split_mode: string;
        experience_id: string | null;
        resort_id: string | null;
        created_at: Date | string;
      }>(
        `SELECT id, trip_id, payer_id, created_by, amount_cents, description,
                expense_date, category, split_mode, experience_id, resort_id, created_at
         FROM expenses WHERE id = $1 AND trip_id = $2`,
        [expenseId, tripId],
      );
      const exp = expRes.rows[0];
      if (!exp) return null;

      // Shares
      const sharesRes = await pool.query<{
        id: string;
        expense_id: string;
        member_id: string | null;
        guest_id: string | null;
        amount_cents: string;
      }>(
        `SELECT id, expense_id, member_id, guest_id, amount_cents
         FROM expense_shares WHERE expense_id = $1`,
        [expenseId],
      );
      const shares: ExpenseShareDTO[] = sharesRes.rows.map((s) => ({
        id: s.id,
        expenseId: s.expense_id,
        memberId: s.member_id,
        guestId: s.guest_id,
        amountCents: parseInt(s.amount_cents, 10),
      }));

      // Tiers
      const tiersRes = await pool.query<{
        id: string;
        expense_id: string;
        tier_name: string;
        price_cents: string;
      }>(
        `SELECT id, expense_id, tier_name, price_cents
         FROM expense_tiers WHERE expense_id = $1`,
        [expenseId],
      );
      const tiers: ExpenseTierDTO[] = tiersRes.rows.map((t) => ({
        id: t.id,
        expenseId: t.expense_id,
        name: t.tier_name,
        priceCents: parseInt(t.price_cents, 10),
      }));

      // Tier counts
      const tcRes = await pool.query<{
        id: string;
        tier_id: string;
        member_id: string | null;
        guest_id: string | null;
        unit_count: number;
      }>(
        `SELECT etc.id, etc.tier_id, etc.member_id, etc.guest_id, etc.unit_count
         FROM expense_tier_counts etc
         JOIN expense_tiers et ON et.id = etc.tier_id
         WHERE et.expense_id = $1`,
        [expenseId],
      );
      const tierCounts = tcRes.rows.map((tc) => ({
        id: tc.id,
        tierId: tc.tier_id,
        memberId: tc.member_id,
        guestId: tc.guest_id,
        count: tc.unit_count,
      }));

      // Items
      const itemsRes = await pool.query<{
        id: string;
        expense_id: string;
        item_name: string;
        price_cents: string;
        is_alcohol: boolean;
      }>(
        `SELECT id, expense_id, item_name, price_cents, is_alcohol
         FROM expense_items WHERE expense_id = $1`,
        [expenseId],
      );
      const items: ExpenseItemDTO[] = [];
      for (const item of itemsRes.rows) {
        const assigneesRes = await pool.query<{
          member_id: string | null;
          guest_id: string | null;
        }>(
          `SELECT member_id, guest_id FROM expense_item_assignees WHERE item_id = $1`,
          [item.id],
        );
        const assigneeIds = assigneesRes.rows.map((a) => (a.member_id ?? a.guest_id)!);
        items.push({
          id: item.id,
          expenseId: item.expense_id,
          name: item.item_name,
          priceCents: parseInt(item.price_cents, 10),
          isAlcohol: item.is_alcohol,
          assigneeIds,
        });
      }

      // Charge lines
      const clRes = await pool.query<{
        id: string;
        expense_id: string;
        kind: any;
        amount_cents: string;
        exclude_alcohol: boolean;
      }>(
        `SELECT id, expense_id, kind, amount_cents, exclude_alcohol
         FROM charge_lines WHERE expense_id = $1`,
        [expenseId],
      );
      const chargeLines = [];
      for (const cl of clRes.rows) {
        const scopesRes = await pool.query<{ item_id: string }>(
          `SELECT item_id FROM charge_line_scopes WHERE charge_line_id = $1`,
          [cl.id],
        );
        chargeLines.push({
          id: cl.id,
          expenseId: cl.expense_id,
          kind: cl.kind,
          amountCents: parseInt(cl.amount_cents, 10),
          excludeAlcohol: cl.exclude_alcohol,
          scopeItemIds: scopesRes.rows.map((s) => s.item_id),
        });
      }

      // Refunds
      const refundsRes = await pool.query<{
        id: string;
        expense_id: string;
        created_by: string;
        amount_cents: string;
        refund_date: Date | string;
        created_at: Date | string;
      }>(
        `SELECT id, expense_id, created_by, amount_cents, refund_date, created_at
         FROM expense_refunds WHERE expense_id = $1 ORDER BY created_at ASC`,
        [expenseId],
      );
      const refunds: RefundDTO[] = refundsRes.rows.map((r) => ({
        id: r.id,
        expenseId: r.expense_id,
        createdByUserId: r.created_by,
        amountCents: parseInt(r.amount_cents, 10),
        date: formatDate(r.refund_date),
        createdAt: formatTimestamp(r.created_at),
      }));

      // PLACEHOLDER (account-deletion R5.3): every person id the reader gets is the public form, so a pending
      // account appears under its alias and a purged one under its tombstone. Amounts are untouched.
      const pub = await publicIdMap([
        exp.payer_id,
        exp.created_by,
        ...shares.map((s) => s.memberId),
        ...tierCounts.map((tc) => tc.memberId),
        ...items.flatMap((i) => i.assigneeIds),
        ...refunds.map((r) => r.createdByUserId),
      ]);

      return {
        id: exp.id,
        tripId: exp.trip_id,
        payerId: pub(exp.payer_id),
        createdByUserId: pub(exp.created_by),
        amountCents: parseInt(exp.amount_cents, 10),
        description: exp.description,
        date: formatDate(exp.expense_date),
        category: exp.category,
        splitMode: exp.split_mode as any,
        experienceId: exp.experience_id,
        resortId: exp.resort_id,
        shares: shares.map((s) => ({ ...s, memberId: s.memberId ? pub(s.memberId) : s.memberId })),
        tiers,
        tierCounts: tierCounts.map((tc) => ({ ...tc, memberId: tc.memberId ? pub(tc.memberId) : tc.memberId })),
        items: items.map((i) => ({ ...i, assigneeIds: i.assigneeIds.map(pub) })),
        chargeLines,
        refunds: refunds.map((r) => ({ ...r, createdByUserId: pub(r.createdByUserId) })),
        createdAt: formatTimestamp(exp.created_at),
      };
    },

    async createSettlement(tripId, submittedByUserId, input) {
      if (input.payerId === input.recipientId) {
        throw new AppError('trip_validation_failed', 'Payer and recipient must be distinct');
      }

      // A settlement naming a party who is not visible is rejected before the membership check (R12.10).
      await assertPartiesVisible(pool, tripId, {
        userIds: [input.payerId, input.recipientId],
        guestIds: [],
      });

      // Validate both are trip members (Req 7.2)
      const membersRes = await pool.query(
        `SELECT user_id FROM trip_memberships WHERE trip_id = $1 AND user_id IN ($2, $3)`,
        [tripId, input.payerId, input.recipientId],
      );
      if (membersRes.rowCount !== 2) {
        throw new AppError('trip_validation_failed', 'Both parties must be trip members');
      }

      const res = await pool.query<{
        id: string;
        trip_id: string;
        payer_id: string;
        recipient_id: string;
        created_by: string;
        amount_cents: string;
        settled_date: Date | string;
        created_at: Date | string;
      }>(
        `INSERT INTO settlements (
           trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date, created_at`,
        [tripId, input.payerId, input.recipientId, submittedByUserId, input.amountCents, input.date],
      );
      const row = res.rows[0]!;
      return {
        id: row.id,
        tripId: row.trip_id,
        payerId: row.payer_id,
        recipientId: row.recipient_id,
        createdByUserId: row.created_by,
        amountCents: parseInt(row.amount_cents, 10),
        date: formatDate(row.settled_date),
        createdAt: formatTimestamp(row.created_at),
      };
    },

    async editSettlement(tripId, settlementId, callerId, callerRole, input) {
      if (input.payerId === input.recipientId) {
        throw new AppError('trip_validation_failed', 'Payer and recipient must be distinct');
      }

      const check = await pool.query<{
        id: string;
        created_by: string;
        payer_id: string;
        recipient_id: string;
      }>(
        `SELECT id, created_by, payer_id, recipient_id FROM settlements WHERE id = $1 AND trip_id = $2`,
        [settlementId, tripId],
      );
      const existing = check.rows[0];
      if (!existing) {
        throw new AppError('trip_forbidden', 'Settlement not found');
      }
      if (callerRole !== 'organizer' && existing.created_by !== callerId) {
        throw new AppError('trip_forbidden', 'Only creator or organizer may edit a settlement');
      }

      // Neither the stored parties nor the requested ones may be non-visible (R12.10); delete stays allowed.
      await assertPartiesVisible(pool, tripId, {
        userIds: [existing.payer_id, existing.recipient_id, input.payerId, input.recipientId],
        guestIds: [],
      });

      const membersRes = await pool.query(
        `SELECT user_id FROM trip_memberships WHERE trip_id = $1 AND user_id IN ($2, $3)`,
        [tripId, input.payerId, input.recipientId],
      );
      if (membersRes.rowCount !== 2) {
        throw new AppError('trip_validation_failed', 'Both parties must be trip members');
      }

      const res = await pool.query<{
        id: string;
        trip_id: string;
        payer_id: string;
        recipient_id: string;
        created_by: string;
        amount_cents: string;
        settled_date: Date | string;
        created_at: Date | string;
      }>(
        `UPDATE settlements
         SET payer_id = $1, recipient_id = $2, amount_cents = $3, settled_date = $4
         WHERE id = $5 AND trip_id = $6
         RETURNING id, trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date, created_at`,
        [input.payerId, input.recipientId, input.amountCents, input.date, settlementId, tripId],
      );
      const row = res.rows[0]!;
      return {
        id: row.id,
        tripId: row.trip_id,
        payerId: row.payer_id,
        recipientId: row.recipient_id,
        createdByUserId: row.created_by,
        amountCents: parseInt(row.amount_cents, 10),
        date: formatDate(row.settled_date),
        createdAt: formatTimestamp(row.created_at),
      };
    },

    async removeSettlement(tripId, settlementId, callerId, callerRole) {
      const check = await pool.query<{ id: string; created_by: string }>(
        `SELECT id, created_by FROM settlements WHERE id = $1 AND trip_id = $2`,
        [settlementId, tripId],
      );
      const existing = check.rows[0];
      if (!existing) {
        throw new AppError('trip_forbidden', 'Settlement not found');
      }
      if (callerRole !== 'organizer' && existing.created_by !== callerId) {
        throw new AppError('trip_forbidden', 'Only creator or organizer may delete a settlement');
      }

      await pool.query(`DELETE FROM settlements WHERE id = $1 AND trip_id = $2`, [settlementId, tripId]);
    },

    async createRefund(tripId, expenseId, submittedByUserId, callerRole, input) {
      return withTx(pool, async (client) => {
        const expCheck = await client.query<{
          id: string;
          created_by: string;
          amount_cents: string;
        }>(
          `SELECT id, created_by, amount_cents FROM expenses WHERE id = $1 AND trip_id = $2 FOR UPDATE`,
          [expenseId, tripId],
        );
        const exp = expCheck.rows[0];
        if (!exp) {
          throw new AppError('trip_forbidden', 'Expense not found');
        }
        if (callerRole !== 'organizer' && exp.created_by !== submittedByUserId) {
          throw new AppError('trip_forbidden', 'Only original expense creator or organizer may add a refund');
        }

        const sumRes = await client.query<{ sum: string }>(
          `SELECT coalesce(sum(amount_cents), 0)::text AS sum FROM expense_refunds WHERE expense_id = $1`,
          [expenseId],
        );
        const existingRefunds = parseInt(sumRes.rows[0]?.sum ?? '0', 10);
        const expenseTotal = parseInt(exp.amount_cents, 10);

        if (existingRefunds + input.amountCents > expenseTotal) {
          throw new AppError('trip_validation_failed', 'Refund would exceed original expense amount');
        }

        const res = await client.query<{
          id: string;
          expense_id: string;
          created_by: string;
          amount_cents: string;
          refund_date: Date | string;
          created_at: Date | string;
        }>(
          `INSERT INTO expense_refunds (expense_id, created_by, amount_cents, refund_date)
           VALUES ($1, $2, $3, $4)
           RETURNING id, expense_id, created_by, amount_cents, refund_date, created_at`,
          [expenseId, submittedByUserId, input.amountCents, input.date],
        );
        const row = res.rows[0]!;
        return {
          id: row.id,
          expenseId: row.expense_id,
          createdByUserId: row.created_by,
          amountCents: parseInt(row.amount_cents, 10),
          date: formatDate(row.refund_date),
          createdAt: formatTimestamp(row.created_at),
        };
      });
    },

    async editRefund(tripId, expenseId, refundId, callerId, callerRole, input) {
      return withTx(pool, async (client) => {
        const check = await client.query<{
          id: string;
          created_by: string;
          expense_creator: string;
          expense_amount: string;
        }>(
          `SELECT r.id, r.created_by, e.created_by AS expense_creator, e.amount_cents AS expense_amount
           FROM expense_refunds r
           JOIN expenses e ON e.id = r.expense_id
           WHERE r.id = $1 AND r.expense_id = $2 AND e.trip_id = $3 FOR UPDATE`,
          [refundId, expenseId, tripId],
        );
        const row = check.rows[0];
        if (!row) {
          throw new AppError('trip_forbidden', 'Refund not found');
        }
        if (callerRole !== 'organizer' && row.expense_creator !== callerId) {
          throw new AppError('trip_forbidden', 'Only original expense creator or organizer may edit a refund');
        }

        const sumRes = await client.query<{ sum: string }>(
          `SELECT coalesce(sum(amount_cents), 0)::text AS sum
           FROM expense_refunds
           WHERE expense_id = $1 AND id != $2`,
          [expenseId, refundId],
        );
        const otherRefunds = parseInt(sumRes.rows[0]?.sum ?? '0', 10);
        const expenseTotal = parseInt(row.expense_amount, 10);

        if (otherRefunds + input.amountCents > expenseTotal) {
          throw new AppError('trip_validation_failed', 'Refund would exceed original expense amount');
        }

        const res = await client.query<{
          id: string;
          expense_id: string;
          created_by: string;
          amount_cents: string;
          refund_date: Date | string;
          created_at: Date | string;
        }>(
          `UPDATE expense_refunds
           SET amount_cents = $1, refund_date = $2
           WHERE id = $3
           RETURNING id, expense_id, created_by, amount_cents, refund_date, created_at`,
          [input.amountCents, input.date, refundId],
        );
        const updated = res.rows[0]!;
        return {
          id: updated.id,
          expenseId: updated.expense_id,
          createdByUserId: updated.created_by,
          amountCents: parseInt(updated.amount_cents, 10),
          date: formatDate(updated.refund_date),
          createdAt: formatTimestamp(updated.created_at),
        };
      });
    },

    async removeRefund(tripId, expenseId, refundId, callerId, callerRole) {
      const check = await pool.query<{
        id: string;
        expense_creator: string;
      }>(
        `SELECT r.id, e.created_by AS expense_creator
         FROM expense_refunds r
         JOIN expenses e ON e.id = r.expense_id
         WHERE r.id = $1 AND r.expense_id = $2 AND e.trip_id = $3`,
        [refundId, expenseId, tripId],
      );
      const row = check.rows[0];
      if (!row) {
        throw new AppError('trip_forbidden', 'Refund not found');
      }
      if (callerRole !== 'organizer' && row.expense_creator !== callerId) {
        throw new AppError('trip_forbidden', 'Only original expense creator or organizer may delete a refund');
      }

      await pool.query(`DELETE FROM expense_refunds WHERE id = $1`, [refundId]);
    },

    async listExpensesAndSettlements(tripId, filters?: { category?: ExpenseCategory | undefined; payerId?: string | undefined }) {
      // 1. Fetch expenses
      let expenseQuery = `SELECT id FROM expenses WHERE trip_id = $1`;
      const expParams: any[] = [tripId];
      if (filters?.category) {
        expParams.push(filters.category);
        expenseQuery += ` AND category = $${expParams.length}`;
      }
      if (filters?.payerId) {
        expParams.push(filters.payerId);
        expenseQuery += ` AND payer_id = $${expParams.length}`;
      }
      expenseQuery += ` ORDER BY expense_date ASC, created_at ASC`;

      const expRows = await pool.query<{ id: string }>(expenseQuery, expParams);
      const expenses: ExpenseDTO[] = [];
      for (const row of expRows.rows) {
        const exp = await this.getExpense(tripId, row.id);
        if (exp) expenses.push(exp);
      }

      // 2. Fetch settlements
      let settlementQuery = `SELECT id, trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date, created_at
                             FROM settlements WHERE trip_id = $1`;
      const setParams: any[] = [tripId];
      if (filters?.payerId) {
        setParams.push(filters.payerId);
        settlementQuery += ` AND payer_id = $${setParams.length}`;
      }
      settlementQuery += ` ORDER BY settled_date ASC, created_at ASC`;

      const setRows = await pool.query<{
        id: string;
        trip_id: string;
        payer_id: string;
        recipient_id: string;
        created_by: string;
        amount_cents: string;
        settled_date: Date | string;
        created_at: Date | string;
      }>(settlementQuery, setParams);

      const settlementPub = await publicIdMap(
        setRows.rows.flatMap((r) => [r.payer_id, r.recipient_id, r.created_by]),
      );
      const settlements: SettlementDTO[] = filters?.category
        ? [] // Settlements have no category, so category filter excludes them
        : setRows.rows.map((r) => ({
            id: r.id,
            tripId: r.trip_id,
            payerId: settlementPub(r.payer_id),
            recipientId: settlementPub(r.recipient_id),
            createdByUserId: settlementPub(r.created_by),
            amountCents: parseInt(r.amount_cents, 10),
            date: formatDate(r.settled_date),
            createdAt: formatTimestamp(r.created_at),
          }));

      // Interleave by date
      const merged: (ExpenseDTO | SettlementDTO)[] = [...expenses, ...settlements];
      merged.sort((a, b) => {
        const dateCmp = a.date.localeCompare(b.date);
        if (dateCmp !== 0) return dateCmp;
        return a.createdAt.localeCompare(b.createdAt);
      });

      return merged;
    },

    async getNetBalances(tripId) {
      // The deliberate raw read of memberships (pending members included): money must count everyone, or
      // the Net_Balances stop summing to exactly zero (account-deletion R12.10). A purged person is no longer
      // a member, so every party found in the data is added too.
      const allMembersRes = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM trip_memberships WHERE trip_id = $1 ORDER BY joined_at ASC`,
        [tripId],
      );
      const memberPub = await publicIdMap(allMembersRes.rows.map((r) => r.user_id));
      const memberIds = allMembersRes.rows.map((r) => memberPub(r.user_id));

      // Events already carry public ids (see buildBalanceEvents).
      const events = await buildBalanceEvents(pool, tripId);
      const listed = new Set(memberIds);
      const extras = [...new Set(events.map((e) => e.memberId))].filter((id) => !listed.has(id)).sort();
      const allParties = [...memberIds, ...extras];
      const balancesMap = computeNetBalances(events, allParties);

      return allParties.map((mId) => ({
        memberId: mId,
        netCents: balancesMap.get(mId) ?? 0,
      }));
    },

    async getPairwiseBalances(tripId) {
      const events = await buildBalanceEvents(pool, tripId);
      const computed = computePairwiseBalances(events);
      return computed.map((p) => ({
        memberIdA: p.memberIdA,
        memberIdB: p.memberIdB,
        aOwesBCents: p.aOwesB,
      }));
    },

    async getBalanceDrillDown(tripId, memberId, counterpartyId) {
      const events = await buildBalanceEvents(pool, tripId);
      const consolidated = new Map<string, BalanceDrillDownEntryDTO>();

      for (const e of events) {
        if (e.memberId === memberId) {
          if (counterpartyId && e.counterpartyId !== counterpartyId) {
            continue;
          }
          const sign = counterpartyId
            ? (e.kind === 'expense_share' || e.kind === 'settlement_received' ? 1 : -1)
            : (e.kind === 'expense_payer' || e.kind === 'settlement_received' ? 1 : -1);
          const kind = e.kind.startsWith('expense') ? 'expense' : 'settlement';
          const key = `${kind}:${e.sourceId}`;
          const existing = consolidated.get(key);
          if (existing) {
            consolidated.set(key, {
              ...existing,
              contributionCents: existing.contributionCents + sign * e.amountCents,
            });
          } else {
            consolidated.set(key, {
              kind,
              sourceId: e.sourceId,
              description: e.description,
              date: e.date,
              contributionCents: sign * e.amountCents,
              payerId: e.payerId,
              recipientId: e.recipientId,
            });
          }
        }
      }

      const drillDown = Array.from(consolidated.values());
      drillDown.sort((a, b) => a.date.localeCompare(b.date));
      return drillDown;
    },

    async exportLedgerCsv(tripId) {
      const list = await this.listExpensesAndSettlements(tripId);

      // Map member and guest names. The name map is built over the ids that appear in the data (not over current
      // membership), through `profile_identity`, so a pending member or a purged tombstone prints as
      // `Deleted user` and never as a raw id (account-deletion R12.10).
      const guestsRes = await pool.query<{
        id: string;
        sponsor_member_id: string;
        name: string;
      }>(
        `SELECT id, sponsor_member_id, name FROM trip_guests WHERE trip_id = $1`,
        [tripId],
      );
      const partyIds: string[] = guestsRes.rows.map((g) => g.sponsor_member_id);
      for (const item of list) {
        partyIds.push(item.payerId);
        if ('recipientId' in item) partyIds.push(item.recipientId);
        else for (const s of item.shares) if (s.memberId) partyIds.push(s.memberId);
      }
      const identities = await resolvePublicIds(pool, partyIds);
      const memberNames = {
        get: (id: string | null | undefined): string | undefined =>
          id === null || id === undefined ? undefined : identities.get(id)?.displayName,
      };
      const guestNames = new Map(
        guestsRes.rows.map((g) => {
          const sponsor = memberNames.get(g.sponsor_member_id) ?? 'Unknown';
          return [g.id, `${sponsor} — ${g.name}`];
        }),
      );

      const lines: string[] = [
        'Type,Date,Description,Payer,Amount,Category,Details',
      ];

      for (const item of list) {
        if ('recipientId' in item) {
          // Settlement
          const payer = memberNames.get(item.payerId) ?? item.payerId;
          const recipient = memberNames.get(item.recipientId) ?? item.recipientId;
          const amount = (item.amountCents / 100).toFixed(2);
          lines.push(`Settlement,${item.date},"Payment to ${recipient}",${payer},${amount},,Settlement`);
        } else {
          // Expense
          const payer = memberNames.get(item.payerId) ?? item.payerId;
          const amount = (item.amountCents / 100).toFixed(2);
          const category = item.category ?? '';
          const sharesSummary = item.shares
            .map((s) => {
              const name = s.guestId
                ? (guestNames.get(s.guestId) ?? s.guestId)
                : (memberNames.get(s.memberId!) ?? s.memberId);
              return `${name}: $${(s.amountCents / 100).toFixed(2)}`;
            })
            .join('; ');
          lines.push(`Expense,${item.date},"${item.description.replace(/"/g, '""')}",${payer},${amount},${category},"${sharesSummary}"`);
        }
      }

      return lines.join('\n');
    },
  };
}

/**
 * Build the full set of BalanceEvents for a Trip, resolving Trip_Guests onto
 * their sponsoring Trip_Member (Req 2.7) and proportionally reducing shares by
 * any refunds against the Expense (Req 12.3).
 */
async function buildBalanceEvents(pool: DbPool, tripId: string): Promise<BalanceEvent[]> {
  const events: BalanceEvent[] = [];

  // Map guests to their sponsor
  const guestRes = await pool.query<{ id: string; sponsor_member_id: string }>(
    `SELECT id, sponsor_member_id FROM trip_guests WHERE trip_id = $1`,
    [tripId],
  );
  const guestSponsorMap = new Map(guestRes.rows.map((g) => [g.id, g.sponsor_member_id]));

  // 1. Process Expenses
  const expRes = await pool.query<{
    id: string;
    payer_id: string;
    amount_cents: string;
    description: string;
    expense_date: Date | string;
  }>(
    `SELECT id, payer_id, amount_cents, description, expense_date
     FROM expenses WHERE trip_id = $1`,
    [tripId],
  );

  for (const exp of expRes.rows) {
    const expenseId = exp.id;
    const payerId = exp.payer_id;
    const totalAmount = parseInt(exp.amount_cents, 10);
    const date = formatDate(exp.expense_date);

    // Get shares
    const sharesRes = await pool.query<{
      member_id: string | null;
      guest_id: string | null;
      amount_cents: string;
    }>(
      `SELECT member_id, guest_id, amount_cents FROM expense_shares WHERE expense_id = $1`,
      [expenseId],
    );

    // Resolve guest shares onto sponsor
    const rawShares: { recipientId: string; amountCents: number }[] = [];
    for (const sh of sharesRes.rows) {
      let recId: string;
      if (sh.guest_id) {
        recId = guestSponsorMap.get(sh.guest_id) ?? sh.guest_id;
      } else {
        recId = sh.member_id!;
      }
      rawShares.push({
        recipientId: recId,
        amountCents: parseInt(sh.amount_cents, 10),
      });
    }

    // Check refunds (Req 12.1, 12.3)
    const refundRes = await pool.query<{ amount_cents: string }>(
      `SELECT amount_cents FROM expense_refunds WHERE expense_id = $1`,
      [expenseId],
    );
    const totalRefundCents = refundRes.rows.reduce(
      (sum, r) => sum + parseInt(r.amount_cents, 10),
      0,
    );

    let effectiveShares = rawShares;
    if (totalRefundCents > 0 && totalAmount > 0) {
      // Build allocation targets: each share + payer implicit portion
      const sharesSum = rawShares.reduce((s, sh) => s + sh.amountCents, 0);
      const payerImplicitCents = Math.max(0, totalAmount - sharesSum);

      const targets: AllocationTarget[] = [
        ...rawShares.map((sh, idx) => ({
          recipientId: `${sh.recipientId}:${idx}`,
          weight: sh.amountCents,
        })),
        { recipientId: `payer:${payerId}`, weight: payerImplicitCents },
      ];

      const refundAllocations = allocateProportionally(totalRefundCents, targets);
      const refundByTarget = new Map(refundAllocations.map((a) => [a.recipientId, a.amountCents]));

      effectiveShares = rawShares.map((sh, idx) => {
        const refAmount = refundByTarget.get(`${sh.recipientId}:${idx}`) ?? 0;
        return {
          recipientId: sh.recipientId,
          amountCents: Math.max(0, sh.amountCents - refAmount),
        };
      });
    }

    // Emit events for effective shares
    for (const sh of effectiveShares) {
      if (sh.amountCents <= 0) continue;

      // Debtor's share event
      events.push({
        kind: 'expense_share',
        memberId: sh.recipientId,
        amountCents: sh.amountCents,
        counterpartyId: payerId,
        sourceId: expenseId,
        description: exp.description,
        date,
        payerId,
        recipientId: sh.recipientId,
      });

      // Payer's mirror event
      events.push({
        kind: 'expense_payer',
        memberId: payerId,
        amountCents: sh.amountCents,
        counterpartyId: sh.recipientId,
        sourceId: expenseId,
        description: exp.description,
        date,
        payerId,
        recipientId: sh.recipientId,
      });
    }
  }

  // 2. Process Settlements
  const setRes = await pool.query<{
    id: string;
    payer_id: string;
    recipient_id: string;
    amount_cents: string;
    settled_date: Date | string;
  }>(
    `SELECT id, payer_id, recipient_id, amount_cents, settled_date
     FROM settlements WHERE trip_id = $1`,
    [tripId],
  );

  for (const s of setRes.rows) {
    const amountCents = parseInt(s.amount_cents, 10);
    const date = formatDate(s.settled_date);

    events.push({
      kind: 'settlement_paid',
      memberId: s.payer_id,
      counterpartyId: s.recipient_id,
      amountCents,
      sourceId: s.id,
      description: 'Settlement',
      date,
      payerId: s.payer_id,
      recipientId: s.recipient_id,
    });

    events.push({
      kind: 'settlement_received',
      memberId: s.recipient_id,
      counterpartyId: s.payer_id,
      amountCents,
      sourceId: s.id,
      description: 'Settlement',
      date,
      payerId: s.payer_id,
      recipientId: s.recipient_id,
    });
  }

  // PLACEHOLDER (account-deletion R5.3, R12.10): the balances are computed over every party in the data,
  // pending ones included (so they still sum to zero), but each id leaves here in its public form. Done once
  // over all ids so net, pairwise and drill-down agree on who is who.
  const ids = events.flatMap((e) => [e.memberId, e.counterpartyId, e.payerId, e.recipientId]);
  const resolved = await resolvePublicIds(
    pool,
    ids.filter((id): id is string => typeof id === 'string'),
  );
  const pub = (id: string): string => resolved.get(id)?.publicId ?? id;
  return events.map((e) => ({
    ...e,
    memberId: pub(e.memberId),
    counterpartyId: e.counterpartyId === null ? null : pub(e.counterpartyId),
    ...(e.payerId === undefined ? {} : { payerId: pub(e.payerId) }),
    ...(e.recipientId === undefined ? {} : { recipientId: pub(e.recipientId) }),
  }));
}
