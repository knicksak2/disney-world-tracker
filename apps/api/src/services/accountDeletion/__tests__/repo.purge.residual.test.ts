/**
 * Whole-purge tests over a seeded multi-table graph (pg-mem, real SQL): one person referenced from EVERY table
 * in the disposition registry, across several trips with other members, is purged stage by stage and the
 * resulting database is searched and compared.
 *
 * Feature: account-deletion, Property 26: The finished purge leaves no residue of the person
 * Feature: account-deletion, Property 12: The anonymous identity is injective, stable, and non-derivable
 * Feature: account-deletion, Property 21: Retained content survives with only its attribution changed
 * Feature: account-deletion, Property 13: Money is preserved
 * Feature: account-deletion, Property 28: No delete statement destroys a row a survivor depends on
 * Feature: account-deletion, Property 17: A purge run is bounded
 *
 * The stages are driven by `purgeDriver.ts`, which follows design.md "Purge procedure"; the real runner (task 8.2)
 * is tested separately.
 *
 * Validates: Requirements 6.6, 9.1, 11.7, 11.8, 11.10, 12.6, 12.7, 12.8, 12.9, 12.10, 17.4, 17.10
 */
import { isDeletedUserId } from '@dwt/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import { createReportsRepo } from '../../photos/reportsRepo.js';
import {
  computeNetBalances,
  computePairwiseBalances,
  type BalanceEvent,
} from '../../tripExpenses/balances.js';
import { DISPOSITIONS, type DispositionEntry } from '../dispositions.js';
import { generatePlaceholderId } from '../placeholderId.js';
import type { ClaimedAccount } from '../ports.js';
import { drivePurge, photoDrivers } from './purgeDriver.js';
import { dumpAllTables, dumpAsText, migrationSchema, type Row } from './helpers.js';
import {
  BOB,
  CAROL,
  CHUNK_ROWS,
  createWorld,
  DAVE,
  makePending,
  seedEntry,
  SUBJECT,
  userRow,
  type EntryFixture,
  type World,
} from './world.js';

const CLAIM_AT = new Date('2026-05-02T09:00:00.000Z');
/** Deterministic bytes: the placeholder is "random-looking" without being derived from the subject's id. */
const PLACEHOLDER = generatePlaceholderId(() => Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 101) & 255));
const D = (day: number): Date => new Date(Date.UTC(2026, 2, day, 12));

async function claim(w: World, placeholderId: string): Promise<ClaimedAccount> {
  await makePending(w, SUBJECT.id, { placeholderId });
  const claimed = await w.repo.claimDue(CLAIM_AT, 10);
  return claimed.find((x) => x.id === SUBJECT.id)!;
}

// ---------------------------------------------------------------------------------------------------
// Money: balance events built from the rows, then the REAL computeNetBalances / computePairwiseBalances
// ---------------------------------------------------------------------------------------------------
async function balanceEvents(w: World, tripId: string): Promise<BalanceEvent[]> {
  const q = async (sql: string, p: unknown[]): Promise<Row[]> => (await w.pool.query(sql, p)).rows as Row[];
  const guests = new Map((await q(`SELECT id, sponsor_member_id FROM trip_guests WHERE trip_id = $1`, [tripId])).map((g) => [String(g.id), String(g.sponsor_member_id)]));
  const events: BalanceEvent[] = [];
  for (const e of await q(`SELECT id, payer_id, description FROM expenses WHERE trip_id = $1`, [tripId])) {
    for (const s of await q(`SELECT member_id, guest_id, amount_cents FROM expense_shares WHERE expense_id = $1`, [e.id])) {
      const recipient = s.guest_id ? guests.get(String(s.guest_id))! : String(s.member_id);
      const base = { amountCents: Number(s.amount_cents), sourceId: String(e.id), description: String(e.description), date: '2026-03-01', payerId: String(e.payer_id), recipientId: recipient };
      events.push({ ...base, kind: 'expense_share', memberId: recipient, counterpartyId: String(e.payer_id) });
      events.push({ ...base, kind: 'expense_payer', memberId: String(e.payer_id), counterpartyId: recipient });
    }
  }
  for (const s of await q(`SELECT id, payer_id, recipient_id, amount_cents FROM settlements WHERE trip_id = $1`, [tripId])) {
    const base = { amountCents: Number(s.amount_cents), sourceId: String(s.id), description: 'Settlement', date: '2026-03-01', payerId: String(s.payer_id), recipientId: String(s.recipient_id) };
    events.push({ ...base, kind: 'settlement_paid', memberId: String(s.payer_id), counterpartyId: String(s.recipient_id) });
    events.push({ ...base, kind: 'settlement_received', memberId: String(s.recipient_id), counterpartyId: String(s.payer_id) });
  }
  return events;
}

/** Party ids that appear in the trip's data, with the subject's id relabelled so before and after compare. */
async function balancesOf(w: World, tripId: string, label: (id: string) => string) {
  const events = await balanceEvents(w, tripId);
  const parties = [...new Set(events.map((e) => e.memberId))];
  const net = computeNetBalances(events, parties);
  const netByLabel = new Map([...net].map(([id, cents]) => [label(id), cents]));
  // "X owes Y" normalised so the canonical A<B ordering of the ids cannot hide a change.
  const owes = new Map<string, number>();
  for (const p of computePairwiseBalances(events)) {
    const [debtor, creditor, cents] = p.aOwesB >= 0 ? [p.memberIdA, p.memberIdB, p.aOwesB] : [p.memberIdB, p.memberIdA, -p.aOwesB];
    owes.set(`${label(debtor)}->${label(creditor)}`, cents);
  }
  return { net: netByLabel, owes };
}

interface Graph {
  tripA: string; // subject creator + organizer; Bob member, Carol organizer  -> transferred
  tripB: string; // Bob creator; subject member; Dave member                  -> unchanged (membership removed)
  tripC: string; // subject sole member                                       -> deleted with its photos
  logEntryA: Row; // subject's trip log entry on trip A, with a tag for another member
  tagA: Row;
  completionFeed: Row;
  bobFeedOnA: Row;
  photoTripB: string;
  photoFood: string;
  photoOnC: string;
  bobsPhoto: string;
  guestOfSubject: string;
}

// ===================================================================================================
describe('accountDeletion: whole purge over a seeded multi-table graph (pg-mem)', () => {
  let w: World;
  let c: ClaimedAccount;
  let g: Graph;
  let fixtures: Map<DispositionEntry, EntryFixture>;
  let before: Record<string, readonly Row[]>;
  let after: Record<string, readonly Row[]>;
  let textBefore: string;
  let textAfter: string;
  let moneyBefore: Awaited<ReturnType<typeof balancesOf>>;
  let moneyAfter: Awaited<ReturnType<typeof balancesOf>>;
  let reportBefore: { trip: number; food: number; open: number };
  let reportAfter: { trip: number; food: number; open: number };
  let verdict: string;

  const insert = (table: string, row: Row = {}): Promise<Row> => w.seeder.insertRow(table, row);

  beforeAll(async () => {
    w = await createWorld();

    // ---- one fixture per registry row (subject + a bystander control) --------------------------------
    fixtures = new Map();
    for (const entry of DISPOSITIONS) fixtures.set(entry, await seedEntry(w, entry));

    // ---- several trips with other members ----------------------------------------------------------
    const trip = async (creator: string, members: [string, 'organizer' | 'member', Date][]): Promise<string> => {
      const t = await insert('trips', { creator_id: creator });
      for (const [user, role, joined] of members) await insert('trip_memberships', { trip_id: t.id, user_id: user, role, joined_at: joined });
      return String(t.id);
    };
    const tripA = await trip(SUBJECT.id, [[SUBJECT.id, 'organizer', D(1)], [BOB.id, 'member', D(2)], [CAROL.id, 'organizer', D(3)]]);
    const tripB = await trip(BOB.id, [[BOB.id, 'organizer', D(1)], [SUBJECT.id, 'member', D(2)], [DAVE.id, 'member', D(3)]]);
    const tripC = await trip(SUBJECT.id, [[SUBJECT.id, 'organizer', D(1)]]);

    // ---- trip history others rely on (R12.9) ---------------------------------------------------------
    const log = await insert('experience_logs', { user_id: SUBJECT.id, note: 'we rode it twice' });
    const logEntryA = await insert('trip_log_entries', { trip_id: tripA, member_id: SUBJECT.id, log_id: log.id });
    const tagA = await insert('rode_with_tags', { log_entry_id: logEntryA.id, tagged_member_id: BOB.id, state: 'confirmed' });
    const completionFeed = await insert('trip_feed_items', { trip_id: tripA, actor_id: SUBJECT.id, type: 'completion_logged', metadata: { logEntryId: logEntryA.id } });
    const bobFeedOnA = await insert('trip_feed_items', { trip_id: tripA, actor_id: BOB.id, type: 'member_joined' });
    await insert('trip_comments', { trip_id: tripA, author_id: SUBJECT.id, target_type: 'feed_item', target_id: bobFeedOnA.id, body: 'great day' });

    // ---- money on trip A: payer, sharer, settlement party and guest sponsor -----------------------------
    // (No expense gives one payer two shares that resolve to the same person: the existing pairwise reducer
    // de-duplicates by (pair, expense), which would make a comparison depend on row order, not on this feature.)
    const guestOfSubject = String((await insert('trip_guests', { trip_id: tripA, sponsor_member_id: SUBJECT.id, name: 'Cousin Sam' })).id);
    const e1 = await insert('expenses', { trip_id: tripA, payer_id: SUBJECT.id, created_by: SUBJECT.id, amount_cents: 3000, split_mode: 'exact' });
    await insert('expense_shares', { expense_id: e1.id, member_id: BOB.id, amount_cents: 1000 });
    await insert('expense_shares', { expense_id: e1.id, member_id: CAROL.id, amount_cents: 1000 });
    const e2 = await insert('expenses', { trip_id: tripA, payer_id: BOB.id, created_by: BOB.id, amount_cents: 2400, split_mode: 'exact' });
    await insert('expense_shares', { expense_id: e2.id, member_id: SUBJECT.id, amount_cents: 800 });
    await insert('expense_shares', { expense_id: e2.id, member_id: CAROL.id, amount_cents: 800 });
    const e3 = await insert('expenses', { trip_id: tripA, payer_id: CAROL.id, created_by: CAROL.id, amount_cents: 1000, split_mode: 'exact' });
    await insert('expense_shares', { expense_id: e3.id, member_id: BOB.id, amount_cents: 500 });
    const e4 = await insert('expenses', { trip_id: tripA, payer_id: CAROL.id, created_by: CAROL.id, amount_cents: 600, split_mode: 'exact' });
    await insert('expense_shares', { expense_id: e4.id, guest_id: guestOfSubject, amount_cents: 400 }); // the guest's sponsor is the subject
    await insert('settlements', { trip_id: tripA, payer_id: SUBJECT.id, recipient_id: BOB.id, created_by: SUBJECT.id, amount_cents: 300 });
    await insert('settlements', { trip_id: tripA, payer_id: CAROL.id, recipient_id: SUBJECT.id, created_by: CAROL.id, amount_cents: 200 });

    // ---- photos and reports ----------------------------------------------------------------------------
    const photo = async (owner: string, kind: 'trip' | 'food_log', scope: string): Promise<string> =>
      String((await insert('photos', { owner_id: owner, target_kind: kind, target_id: scope, scope_id: scope, status: 'approved', harm_verdict: 'pass', vision_verdict: 'pass', full_etag: 'f', thumb_etag: 't' })).id);
    const photoTripB = await photo(DAVE.id, 'trip', tripB);
    const photoOnC = await photo(SUBJECT.id, 'trip', tripC);
    const photoFood = await photo(BOB.id, 'food_log', String((await insert('food_items')).id));
    const bobsPhoto = await photo(BOB.id, 'trip', tripA);
    await insert('photo_reports', { photo_id: photoTripB, reporter_id: SUBJECT.id, reason: 'spam' });
    await insert('photo_reports', { photo_id: photoTripB, reporter_id: DAVE.id, reason: 'spam' });
    await insert('photo_reports', { photo_id: photoFood, reporter_id: SUBJECT.id, reason: 'spam' });
    await insert('photo_reports', { photo_id: photoFood, reporter_id: CAROL.id, reason: 'spam' });

    g = { tripA, tripB, tripC, logEntryA, tagA, completionFeed, bobFeedOnA, photoTripB, photoFood, photoOnC, bobsPhoto, guestOfSubject };

    // ---- measure, purge, measure -------------------------------------------------------------------------
    const reports = createReportsRepo(w.pool);
    const reportCounts = async () => ({
      trip: await reports.countOpenDistinct(photoTripB),
      food: await reports.countOpenDistinct(photoFood),
      open: Number(((await w.pool.query(`SELECT count(*) AS n FROM photo_reports WHERE status = 'open'`)).rows[0] as Row).n),
    });
    c = await claim(w, PLACEHOLDER);
    before = dumpAllTables(w.db);
    textBefore = dumpAsText(w.db);
    moneyBefore = await balancesOf(w, tripA, (id) => (id === SUBJECT.id ? 'SUBJECT' : id));
    reportBefore = await reportCounts();

    verdict = await drivePurge(w, c, photoDrivers(w), CHUNK_ROWS);

    after = dumpAllTables(w.db);
    textAfter = dumpAsText(w.db);
    moneyAfter = await balancesOf(w, tripA, (id) => (id === PLACEHOLDER ? 'SUBJECT' : id));
    reportAfter = await reportCounts();
  }, 120_000);

  it('the purge completes: the users row is gone and exactly one ledger row was written', async () => {
    expect(verdict).toBe('purged');
    expect(after.users!.find((u) => u.id === SUBJECT.id)).toBeUndefined();
    expect(after.account_deletion_ledger).toHaveLength(1);
    const ledger = after.account_deletion_ledger![0]!;
    expect(ledger.outcome).toBe('completed');
    expect(Number(ledger.photos_deleted)).toBeGreaterThanOrEqual(2);
    expect(Number(ledger.trips_deleted)).toBeGreaterThanOrEqual(1);
    expect(Number(ledger.trips_transferred)).toBeGreaterThanOrEqual(1);
  });

  // ---- Property 26 / 12 ---------------------------------------------------------------------------------
  it('Property 26: the original id, email, display name and avatar preset appear in no table, column or JSON value (and did before the purge)', () => {
    for (const [label, needle] of [
      ['id', SUBJECT.id],
      ['email', SUBJECT.email],
      ['display name', SUBJECT.displayName],
      ['avatar preset', SUBJECT.avatarPreset!],
    ] as const) {
      expect(textBefore, `fixture sanity: ${label} is present before the purge`).toContain(needle);
      expect(textAfter, `${label} must not survive the purge`).not.toContain(needle);
    }
  });

  it('Property 12: the tombstone is the placeholder, recognisable by prefix, not derived from the person, and appears in the re-pointed rows', () => {
    expect(isDeletedUserId(PLACEHOLDER)).toBe(true);
    expect(PLACEHOLDER).not.toContain(SUBJECT.id.slice(0, 8));
    const tomb = after.users!.find((u) => u.id === PLACEHOLDER)!;
    expect(tomb.deletion_state).toBe('tombstone');
    expect(after.profiles!.find((p) => p.user_id === PLACEHOLDER)!.display_name).toBe('Deleted user');
    // Every anonymized column points at it, and no registry column names any other deleted-prefix id.
    const tombstones = after.users!.filter((u) => u.deletion_state === 'tombstone');
    expect(tombstones.map((t) => t.id)).toEqual([PLACEHOLDER]);
  });

  // ---- Property 21 ---------------------------------------------------------------------------------------
  it('Property 21: every anonymize row exists with its attribution re-pointed and every other column unchanged', () => {
    const entries = DISPOSITIONS.filter((e) => e.disposition === 'anonymize');
    expect(entries.length).toBe(20);
    for (const entry of entries) {
      const fx = fixtures.get(entry)!;
      const row = after[entry.table]!.find((r) => samePk(entry.table, r, fx.subject));
      expect(row, `${entry.table}.${entry.column}: the row must survive`).toBeDefined();
      expect(row![entry.column], `${entry.table}.${entry.column}`).toBe(PLACEHOLDER);
      for (const k of Object.keys(fx.subject)) {
        if (k === entry.column) continue;
        // The one other column the purge changes on an anonymized row: the embedded name in a share payload
        // (scrubbed by design; asserted in "shares sent by the subject" below).
        if (entry.table === 'shares' && k === 'payload_snapshot') continue;
        expect(JSON.stringify(row![k]), `${entry.table}.${k}`).toBe(JSON.stringify(fx.subject[k]));
      }
    }
  });

  it('Property 28 / R12.9: the trip log entries, the tag for another member and the completion_logged feed item survive, attributed to the tombstone; the log row is kept with its note blanked', () => {
    const entry = after.trip_log_entries!.find((r) => r.id === g.logEntryA.id)!;
    expect(entry).toBeDefined();
    expect(entry.member_id).toBe(PLACEHOLDER);
    const tag = after.rode_with_tags!.find((r) => r.id === g.tagA.id)!;
    expect(tag).toBeDefined();
    expect(tag.tagged_member_id).toBe(BOB.id);
    expect(tag.state).toBe('confirmed');
    const feed = after.trip_feed_items!.find((r) => r.id === g.completionFeed.id)!;
    expect(feed.actor_id).toBe(PLACEHOLDER);
    expect(JSON.stringify(feed.metadata)).toBe(JSON.stringify(g.completionFeed.metadata));
    const log = after.experience_logs!.find((r) => r.id === entry.log_id)!;
    expect(log.user_id).toBe(PLACEHOLDER);
    expect(log.note).toBeNull();
    // The subject's private logs (no trip entry) are gone.
    expect(after.experience_logs!.filter((r) => r.user_id === SUBJECT.id)).toHaveLength(0);
    // The fixture's own trip log entry from the registry survives too.
    const regEntry = DISPOSITIONS.find((e) => e.table === 'trip_log_entries')!;
    expect(after.trip_log_entries!.some((r) => samePk('trip_log_entries', r, fixtures.get(regEntry)!.subject))).toBe(true);
  });

  it('delete/nullify/session rows: the subject\'s rows are gone or nulled, and every bystander control row is unchanged', () => {
    for (const entry of DISPOSITIONS) {
      const fx = fixtures.get(entry)!;
      if (fx.control !== null && entry.disposition !== 'trip') {
        const row = after[entry.table]!.find((r) => samePk(entry.table, r, fx.control!));
        expect(row, `${entry.table}.${entry.column}: the bystander's row must remain`).toBeDefined();
        expect(JSON.stringify(row), `${entry.table}.${entry.column}`).toBe(JSON.stringify(fx.control));
      }
      if (entry.disposition === 'delete' || entry.disposition === 'session') {
        expect(after[entry.table]!.some((r) => samePk(entry.table, r, fx.subject)), `${entry.table}.${entry.column} subject row`).toBe(false);
      }
      if (entry.disposition === 'nullify') {
        const row = after[entry.table]!.find((r) => samePk(entry.table, r, fx.subject))!;
        expect(row, `${entry.table}.${entry.column}`).toBeDefined();
        expect(row[entry.column]).toBeNull();
      }
    }
  });

  it('trips: A transferred (creator Carol, subject membership gone), B unchanged but for the membership, C deleted with its photos; other members\' rows untouched', () => {
    const tripA = after.trips!.find((t) => t.id === g.tripA)!;
    expect(tripA.creator_id).toBe(CAROL.id);
    expect(after.trip_memberships!.filter((m) => m.trip_id === g.tripA).map((m) => m.user_id).sort()).toEqual([BOB.id, CAROL.id].sort());
    expect(after.trip_memberships!.find((m) => m.trip_id === g.tripA && m.user_id === CAROL.id)!.role).toBe('organizer');

    const tripB = after.trips!.find((t) => t.id === g.tripB)!;
    const tripBBefore = before.trips!.find((t) => t.id === g.tripB)!;
    expect(JSON.stringify(tripB)).toBe(JSON.stringify(tripBBefore));
    expect(after.trip_memberships!.filter((m) => m.trip_id === g.tripB).map((m) => m.user_id).sort()).toEqual([BOB.id, DAVE.id].sort());

    expect(after.trips!.some((t) => t.id === g.tripC)).toBe(false);
    const photoOnC = after.photos!.find((p) => p.id === g.photoOnC)!;
    expect(photoOnC.status).toBe('deleted');
    expect(photoOnC.owner_id).toBeNull();

    // Every trip not owned by the subject is present and unchanged; every other membership row too.
    const subjectTrips = new Set(before.trip_memberships!.filter((m) => m.user_id === SUBJECT.id).map((m) => m.trip_id));
    for (const t of before.trips!) {
      // Trips the subject was a member of or created are resolved (kept or deleted); every other trip is untouched.
      if (t.id === g.tripA || t.id === g.tripC || t.creator_id === SUBJECT.id || subjectTrips.has(t.id)) continue;
      expect(JSON.stringify(after.trips!.find((x) => x.id === t.id)), `trip ${String(t.id)}`).toBe(JSON.stringify(t));
    }
    for (const m of before.trip_memberships!) {
      if (m.user_id === SUBJECT.id || m.trip_id === g.tripC) continue;
      if (!after.trips!.some((t) => t.id === m.trip_id)) continue; // a fixture trip with no other candidate is deleted whole
      const found = after.trip_memberships!.find((x) => x.trip_id === m.trip_id && x.user_id === m.user_id);
      expect(found, `membership ${String(m.user_id)} on ${String(m.trip_id)}`).toBeDefined();
      if (m.trip_id !== g.tripA) expect(JSON.stringify(found)).toBe(JSON.stringify(m));
    }
  });

  it('photos: the subject\'s are deleted with a null owner; every other photo is untouched', () => {
    for (const p of before.photos!) {
      const now = after.photos!.find((x) => x.id === p.id);
      if (p.owner_id === SUBJECT.id) {
        expect(now, 'subject photo row kept for the sweep').toBeDefined();
        expect(now!.status).toBe('deleted');
        expect(now!.owner_id).toBeNull();
      } else if (!isOnDeletedTrip(p)) {
        expect(JSON.stringify(now), `photo ${String(p.id)}`).toBe(JSON.stringify(p));
      }
    }
    expect(after.photos!.find((p) => p.id === g.bobsPhoto)!.status).toBe('approved');
  });

  function isOnDeletedTrip(p: Row): boolean {
    return p.target_kind === 'trip' && before.trips!.some((t) => t.id === p.target_id) && !after.trips!.some((t) => t.id === p.target_id);
  }

  // ---- Property 13 -----------------------------------------------------------------------------------------------
  it('Property 13: Net_Balance and every pairwise balance are identical before and after for a purged payer, sharer, settlement party and guest sponsor', () => {
    expect(moneyBefore.net.get('SUBJECT')).not.toBe(0); // a meaningful fixture: the subject really owed or was owed
    expect([...moneyBefore.net.keys()].sort()).toEqual(['SUBJECT', BOB.id, CAROL.id].sort());
    expect([...moneyAfter.net.keys()].sort()).toEqual(['SUBJECT', BOB.id, CAROL.id].sort());
    expect(Object.fromEntries(moneyAfter.net)).toEqual(Object.fromEntries(moneyBefore.net));
    expect(Object.fromEntries(moneyAfter.owes)).toEqual(Object.fromEntries(moneyBefore.owes));
    // Zero-sum in both states.
    expect([...moneyBefore.net.values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect([...moneyAfter.net.values()].reduce((a, b) => a + b, 0)).toBe(0);
    // The remaining members' cents are exactly what they were, concretely.
    for (const member of [BOB.id, CAROL.id]) expect(moneyAfter.net.get(member)).toBe(moneyBefore.net.get(member));
  });

  it('Property 13: the sum of cents in every money table is unchanged for the trip, the guest still has the same sponsor semantics (re-pointed), and the guest row survives', () => {
    const sum = (rows: readonly Row[], col: string, tripId?: string, key?: string): number =>
      rows.filter((r) => (tripId === undefined ? true : r[key ?? 'trip_id'] === tripId)).reduce((s, r) => s + Number(r[col]), 0);
    expect(sum(after.expenses!, 'amount_cents', g.tripA)).toBe(sum(before.expenses!, 'amount_cents', g.tripA));
    expect(sum(after.settlements!, 'amount_cents', g.tripA)).toBe(sum(before.settlements!, 'amount_cents', g.tripA));
    const shareIds = new Set(before.expenses!.filter((e) => e.trip_id === g.tripA).map((e) => e.id));
    const sharesIn = (d: Record<string, readonly Row[]>): number => d.expense_shares!.filter((s) => shareIds.has(s.expense_id)).reduce((a, s) => a + Number(s.amount_cents), 0);
    expect(sharesIn(after)).toBe(sharesIn(before));
    const guest = after.trip_guests!.find((x) => x.id === g.guestOfSubject)!;
    expect(guest.sponsor_member_id).toBe(PLACEHOLDER);
    expect(guest.name).toBe('Cousin Sam');
  });

  // ---- Property 21: reports ----------------------------------------------------------------------------------------
  it('Property 21: a report by the purged member changes no photo status and deletes no report row; the member-scoped count of a trip photo drops 2 -> 1 and a food photo\'s stays', () => {
    expect(reportBefore).toMatchObject({ trip: 2, food: 2 });
    expect(reportAfter.trip).toBe(1);
    expect(reportAfter.food).toBe(2);
    expect(reportAfter.open).toBe(reportBefore.open); // the unscoped count of open rows is unchanged
    expect(after.photos!.find((p) => p.id === g.photoTripB)!.status).toBe('approved');
    expect(after.photos!.find((p) => p.id === g.photoFood)!.status).toBe('approved');
    const reports = after.photo_reports!.filter((r) => r.photo_id === g.photoTripB);
    expect(reports).toHaveLength(2);
    expect(reports.map((r) => r.reporter_id).sort()).toEqual([DAVE.id, PLACEHOLDER].sort());
    expect(after.photo_reports!.length).toBe(before.photo_reports!.length);
  });

  it('the freed email can register again, and no other user\'s row changed', async () => {
    const reborn = await w.seeder.insertRow('users', { email: SUBJECT.email, password_hash: 'x' });
    expect(reborn.deletion_state).toBe('active');
    for (const u of [BOB, CAROL, DAVE]) {
      const was = before.users!.find((x) => x.id === u.id)!;
      expect(JSON.stringify(await userRow(w, u.id))).toBe(JSON.stringify(was));
    }
  });

  it('shares sent by the subject are re-pointed and their payloads scrubbed; recipients keep the share', () => {
    const sent = before.shares!.filter((s) => s.sender_id === SUBJECT.id);
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) {
      const now = after.shares!.find((x) => x.id === s.id)!;
      expect(now.sender_id).toBe(PLACEHOLDER);
      expect(JSON.stringify(now.payload_snapshot)).not.toContain(SUBJECT.displayName);
    }
  });

  it('the registry-driven assertions covered every row of DISPOSITIONS (a new row without a fixture fails seedEntry above)', () => {
    expect(fixtures.size).toBe(DISPOSITIONS.length);
  });
});

/** Same row by primary key (the migrations' own definition). */
function samePk(table: string, a: Row, b: Row): boolean {
  return migrationSchema().tables.get(table)!.primaryKey.every((col) => JSON.stringify(a[col]) === JSON.stringify(b[col]));
}

// ===================================================================================================
// Property 17: a bounded run
// ===================================================================================================
describe('accountDeletion: bounded purge over per-user-unbounded tables (Property 17, pg-mem)', () => {
  const UNBOUNDED = ['completions', 'ratings', 'notes', 'experience_favorites', 'user_pins'] as const;
  let statements: World['statements'];
  let verdict: string;
  let leftovers: Record<string, number>;

  beforeAll(async () => {
    const w = await createWorld();
    const per = CHUNK_ROWS * 3;
    const experiences: string[] = [];
    for (let i = 0; i < per; i++) experiences.push(String((await w.seeder.insertRow('experiences')).id));
    for (const exp of experiences) {
      for (const table of ['completions', 'ratings', 'notes', 'experience_favorites'] as const) {
        await w.seeder.insertRow(table, { user_id: SUBJECT.id, experience_id: exp });
      }
    }
    for (let i = 0; i < per; i++) await w.seeder.insertRow('user_pins', { user_id: SUBJECT.id, pin_id: `pin-${i}` });
    // A bystander with the same shapes must be untouched.
    for (const exp of experiences.slice(0, 5)) await w.seeder.insertRow('completions', { user_id: BOB.id, experience_id: exp });
    // A trip and a photo so the three intentionally-unbounded statements actually run.
    const t = await w.seeder.insertRow('trips', { creator_id: SUBJECT.id });
    await w.seeder.insertRow('trip_memberships', { trip_id: t.id, user_id: SUBJECT.id, role: 'organizer' });
    await w.seeder.insertRow('photos', { owner_id: SUBJECT.id, target_kind: 'trip', target_id: t.id, scope_id: t.id, status: 'approved', harm_verdict: 'pass', full_etag: 'f', thumb_etag: 't' });

    const c = await claim(w, PLACEHOLDER);
    w.resetStatements();
    verdict = await drivePurge(w, c, photoDrivers(w), CHUNK_ROWS);
    statements = [...w.statements];
    leftovers = {};
    for (const table of UNBOUNDED) {
      leftovers[table] = ((await w.pool.query(`SELECT count(*) AS n FROM ${table} WHERE user_id = $1`, [SUBJECT.id])).rows[0] as { n: number }).n;
    }
    leftovers.bystander = Number(((await w.pool.query(`SELECT count(*) AS n FROM completions WHERE user_id = $1`, [BOB.id])).rows[0] as { n: number }).n);
  }, 120_000);

  // The three statements that are intentionally outside the row cap: bounded by one trip's or one person's own data.
  const EXEMPT: readonly { name: string; test: (sql: string) => boolean }[] = [
    { name: 'sole-member DELETE FROM trips', test: (s) => /^DELETE FROM trips\b/.test(s) },
    { name: 'softDeleteTripPhotos', test: (s) => /^UPDATE photos\b[\s\S]*target_kind = \$1\s+AND target_id = \$2/.test(s) },
    { name: 'final DELETE FROM users', test: (s) => /^DELETE FROM users\b/.test(s) },
  ];

  it('the purge completes and removes all of the subject\'s rows in the five unbounded tables, leaving the bystander\'s', () => {
    expect(verdict).toBe('purged');
    for (const table of UNBOUNDED) expect(Number(leftovers[table]), table).toBe(0);
    expect(leftovers.bystander).toBe(5);
  });

  it('no statement it issued touched more than CHUNK_ROWS rows, except exactly the three named ones, and those three ran', () => {
    const exempted = new Map<string, number>();
    for (const s of statements) {
      const sql = s.text.trim().replace(/\s+/g, ' ');
      const hit = EXEMPT.filter((e) => e.test(sql));
      expect(hit.length, `statement matches at most one exemption: ${sql.slice(0, 80)}`).toBeLessThanOrEqual(1);
      if (hit.length === 1) {
        exempted.set(hit[0]!.name, (exempted.get(hit[0]!.name) ?? 0) + 1);
        continue;
      }
      if (s.rowCount !== null) {
        expect(s.rowCount, `statement touched too many rows: ${sql.slice(0, 120)}`).toBeLessThanOrEqual(CHUNK_ROWS);
      }
    }
    // Nothing else was waved through: each exemption is used, and no more exemption names exist than the three.
    expect(EXEMPT).toHaveLength(3);
    expect(exempted.get('final DELETE FROM users')).toBe(1);
    expect(exempted.get('sole-member DELETE FROM trips')).toBe(1);
    expect(exempted.get('softDeleteTripPhotos')).toBe(1);
  });

  it('each of the five tables was cleared in at least three chunks, none larger than CHUNK_ROWS', () => {
    for (const table of UNBOUNDED) {
      const chunks = statements.filter((s) => new RegExp(`^DELETE FROM ${table}\\b`).test(s.text.trim()) && (s.rowCount ?? 0) > 0);
      expect(chunks.length, table).toBeGreaterThanOrEqual(3);
      for (const s of chunks) expect(s.rowCount, table).toBeLessThanOrEqual(CHUNK_ROWS);
    }
  });
});
