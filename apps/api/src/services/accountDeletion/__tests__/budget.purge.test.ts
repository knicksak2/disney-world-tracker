// Feature: trip-budget, Property 30: Account deletion dispositions and anonymization
// Feature: account-deletion, Property 35: Budget dispositions (R21)
/**
 * Account deletion integration test for trip budget entities:
 * - trip_budget_lines.created_by is anonymized to tombstone placeholder.
 * - trip_budget_allocations.member_id is anonymized to tombstone placeholder.
 * - Budget totals remain completely unchanged after purge.
 * - Two distinct member allocations on one line remain two distinct allocations.
 * - trip_traveler_profiles.member_id row for the purged user is deleted.
 * - Bystander profiles and allocations remain intact.
 *
 * Validates: Requirements 18.5, 18.7, 21.1, 21.2, 21.5
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generatePlaceholderId } from '../placeholderId.js';
import type { ClaimedAccount } from '../ports.js';
import { drivePurge, photoDrivers } from './purgeDriver.js';
import {
  BOB,
  CAROL,
  CHUNK_ROWS,
  createWorld,
  makePending,
  SUBJECT,
  type World,
} from './world.js';

const CLAIM_AT = new Date('2026-05-02T09:00:00.000Z');
const PLACEHOLDER = generatePlaceholderId(() =>
  Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 101) & 255),
);

async function claim(w: World, placeholderId: string): Promise<ClaimedAccount> {
  await makePending(w, SUBJECT.id, { placeholderId });
  const claimed = await w.repo.claimDue(CLAIM_AT, 10);
  return claimed.find((x) => x.id === SUBJECT.id)!;
}

describe('Account Deletion - Trip Budget purge integration (Property 30 & Property 35)', () => {
  it('anonymizes budget lines and allocations, preserves budget totals and line allocation count, and deletes traveler profiles', async () => {
    const w = await createWorld();

    const tripId = randomUUID();
    await w.pool.query(
      `INSERT INTO trips (id, name, creator_id, start_date, end_date)
       VALUES ($1, 'Family Disney Trip', $2, '2026-07-01', '2026-07-10')`,
      [tripId, BOB.id],
    );

    // Memberships for Bob (organizer), Subject (member), Carol (member)
    await w.pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer'), ($1, $3, 'member'), ($1, $4, 'member')`,
      [tripId, BOB.id, SUBJECT.id, CAROL.id],
    );

    // Seed a budget line created by SUBJECT
    const lineId = randomUUID();
    await w.pool.query(
      `INSERT INTO trip_budget_lines (id, trip_id, category, description, price_source, created_by)
       VALUES ($1, $2, 'tickets', 'Park Hopper Tickets', 'user_entered', $3)`,
      [lineId, tripId, SUBJECT.id],
    );

    // Seed two allocations on that line: one for SUBJECT (5000 cents) and one for CAROL (5000 cents)
    const allocSubjectId = randomUUID();
    const allocCarolId = randomUUID();
    await w.pool.query(
      `INSERT INTO trip_budget_allocations (id, line_id, member_id, amount_cents)
       VALUES ($1, $2, $3, 5000), ($4, $2, $5, 5000)`,
      [allocSubjectId, lineId, SUBJECT.id, allocCarolId, CAROL.id],
    );

    // Seed traveler profiles for SUBJECT and BOB
    const profSubjectId = randomUUID();
    const profBobId = randomUUID();
    await w.pool.query(
      `INSERT INTO trip_traveler_profiles (id, trip_id, member_id, age_bracket)
       VALUES ($1, $2, $3, 'adult'), ($4, $2, $5, 'adult')`,
      [profSubjectId, tripId, SUBJECT.id, profBobId, BOB.id],
    );

    // Verify pre-purge state
    const preLine = (await w.pool.query('SELECT created_by FROM trip_budget_lines WHERE id = $1', [lineId])).rows[0];
    expect(preLine.created_by).toBe(SUBJECT.id);

    // Claim and drive full purge of SUBJECT
    const c = await claim(w, PLACEHOLDER);
    await drivePurge(w, c, photoDrivers(w), CHUNK_ROWS);

    // 1. Assert trip_budget_lines.created_by is anonymized to PLACEHOLDER
    const postLine = (await w.pool.query('SELECT created_by FROM trip_budget_lines WHERE id = $1', [lineId])).rows[0];
    expect(postLine.created_by).toBe(PLACEHOLDER);

    // 2. Assert trip_budget_allocations:
    // Two allocations still exist, line total is unchanged, subject's allocation is re-pointed to PLACEHOLDER
    const postAllocs = (await w.pool.query('SELECT * FROM trip_budget_allocations WHERE line_id = $1 ORDER BY id', [lineId])).rows;
    expect(postAllocs).toHaveLength(2);

    const alloc1 = postAllocs.find((r) => r.id === allocSubjectId)!;
    expect(alloc1).toBeDefined();
    expect(alloc1.member_id).toBe(PLACEHOLDER);
    expect(alloc1.amount_cents).toBe(5000);

    const alloc2 = postAllocs.find((r) => r.id === allocCarolId)!;
    expect(alloc2).toBeDefined();
    expect(alloc2.member_id).toBe(CAROL.id);
    expect(alloc2.amount_cents).toBe(5000);

    const postTotalCents = postAllocs.reduce((sum, r) => sum + r.amount_cents, 0);
    expect(postTotalCents).toBe(10000);

    // 3. Assert trip_traveler_profiles:
    // SUBJECT's profile is deleted
    const subjectProfiles = (await w.pool.query('SELECT * FROM trip_traveler_profiles WHERE member_id = $1', [SUBJECT.id])).rows;
    expect(subjectProfiles).toHaveLength(0);

    // BOB's profile remains untouched
    const bobProfiles = (await w.pool.query('SELECT * FROM trip_traveler_profiles WHERE member_id = $1', [BOB.id])).rows;
    expect(bobProfiles).toHaveLength(1);
    expect(bobProfiles[0].id).toBe(profBobId);
  });

  it('two deleted accounts on one line stay two allocations after both accounts are purged (Task 9.2, Property 30)', async () => {
    const w = await createWorld();

    const tripId = randomUUID();
    await w.pool.query(
      `INSERT INTO trips (id, name, creator_id, start_date, end_date)
       VALUES ($1, 'Two Deleted Accounts Trip', $2, '2026-08-01', '2026-08-10')`,
      [tripId, BOB.id],
    );

    // Memberships for Bob, Subject, Carol
    await w.pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer'), ($1, $3, 'member'), ($1, $4, 'member')`,
      [tripId, BOB.id, SUBJECT.id, CAROL.id],
    );

    // Seed budget line with two allocations: one for SUBJECT and one for CAROL
    const lineId = randomUUID();
    await w.pool.query(
      `INSERT INTO trip_budget_lines (id, trip_id, category, description, price_source, created_by)
       VALUES ($1, $2, 'dining', 'Character Breakfast', 'user_entered', $3)`,
      [lineId, tripId, SUBJECT.id],
    );

    const alloc1Id = randomUUID();
    const alloc2Id = randomUUID();
    await w.pool.query(
      `INSERT INTO trip_budget_allocations (id, line_id, member_id, amount_cents)
       VALUES ($1, $2, $3, 3500), ($4, $2, $5, 4500)`,
      [alloc1Id, lineId, SUBJECT.id, alloc2Id, CAROL.id],
    );

    // Purge SUBJECT
    const placeholder1 = generatePlaceholderId(() =>
      Uint8Array.from({ length: 16 }, (_, i) => (i * 13 + 37) & 255),
    );
    const c1 = await claim(w, placeholder1);
    await drivePurge(w, c1, photoDrivers(w), CHUNK_ROWS);

    // Purge CAROL
    const placeholder2 = generatePlaceholderId(() =>
      Uint8Array.from({ length: 16 }, (_, i) => (i * 29 + 71) & 255),
    );
    await makePending(w, CAROL.id, { placeholderId: placeholder2 });
    const claimedCarol = (await w.repo.claimDue(CLAIM_AT, 10)).find((x) => x.id === CAROL.id)!;
    await drivePurge(w, claimedCarol, photoDrivers(w), CHUNK_ROWS);

    // Assert: two distinct allocations remain on the line, each pointing to its own placeholder
    const postAllocs = (
      await w.pool.query('SELECT * FROM trip_budget_allocations WHERE line_id = $1 ORDER BY amount_cents', [lineId])
    ).rows;

    expect(postAllocs).toHaveLength(2);
    expect(placeholder1).not.toBe(placeholder2);

    const a1 = postAllocs.find((r) => r.id === alloc1Id)!;
    expect(a1).toBeDefined();
    expect(a1.member_id).toBe(placeholder1);
    expect(a1.amount_cents).toBe(3500);

    const a2 = postAllocs.find((r) => r.id === alloc2Id)!;
    expect(a2).toBeDefined();
    expect(a2.member_id).toBe(placeholder2);
    expect(a2.amount_cents).toBe(4500);

    const totalCents = postAllocs.reduce((sum, r) => sum + r.amount_cents, 0);
    expect(totalCents).toBe(8000);
  });
});
