/**
 * Feature: trips Property 30 departure half / trip-budget Property 25
 * Validates: Requirements 4.7, 25.5
 *
 * Tests that departMember (leaveTrip / removeMember):
 * 1. Deletes the departing member's profile on this Trip from trip_traveler_profiles.
 * 2. Leaves that member's traveler profiles on other Trips intact.
 * 3. Leaves their trip_budget_allocations untouched (same ids and amount_cents).
 * 4. Leaves the Budget by-person total unchanged.
 * 5. deriveSuggestions over reloaded profiles no longer generates ticket suggestions for the departed member.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTripRepo } from '../../trips/repo.js';
import { createTripBudgetRepo } from '../repo.js';
import { deriveSuggestions } from '../suggestions.js';
import { seedTestData, setupTestDb } from './testDb.js';

describe('departMember traveler profile cleanup (Property 25)', () => {
  it('cleans up profile on leaving and on removal while preserving allocations, other trips, and by-person totals', async () => {
    const { pool } = setupTestDb();
    const data = await seedTestData(pool);
    const tripRepo = createTripRepo(pool, {} as any);
    const budgetRepo = createTripBudgetRepo(pool);

    // Seed traveler profiles for Bob (memberId) on Trip 1 and Trip 2
    const bobTrip1ProfId = randomUUID();
    const bobTrip2ProfId = randomUUID();
    await pool.query(
      `INSERT INTO trip_traveler_profiles (id, trip_id, member_id, age_bracket, ticket_option, ticket_days, discount_group, pass_type)
       VALUES ($1, $2, $3, 'adult', 'base', 4, 'std-gst', 'none'),
              ($4, $5, $3, 'adult', 'base', 5, 'std-gst', 'none')`,
      [bobTrip1ProfId, data.tripId, data.memberId, bobTrip2ProfId, data.otherTripId],
    );

    // Seed a budget line and allocation for Bob on Trip 1
    const lineId = randomUUID();
    const allocId = randomUUID();
    await pool.query(
      `INSERT INTO trip_budget_lines (id, trip_id, category, description, created_by, price_source)
       VALUES ($1, $2, 'tickets', 'Theme Park Tickets', $3, 'user_entered')`,
      [lineId, data.tripId, data.organizerId],
    );
    await pool.query(
      `INSERT INTO trip_budget_allocations (id, line_id, member_id, amount_cents)
       VALUES ($1, $2, $3, 45000)`,
      [allocId, lineId, data.memberId],
    );

    // Initial check: Bob has suggestions derived on Trip 1
    const initialProfiles = await budgetRepo.listTravelerProfiles(data.tripId);
    expect(initialProfiles.some((p) => p.memberId === data.memberId)).toBe(true);

    const initialSuggestions = deriveSuggestions({
      plannedItems: [],
      dayTouringHours: {},
      profiles: initialProfiles,
      tripStart: '2026-10-01',
      existingKeys: new Set(),
      dismissedKeys: new Set(),
      llSingleAvailable: new Set(),
      experiencePark: new Map(),
      serviceStyleByExperience: new Map(),
    });
    expect(initialSuggestions.some((s) => s.draft.allocations?.some((a) => a.memberId === data.memberId))).toBe(true);

    // 1. Bob leaves Trip 1
    await tripRepo.leaveTrip(data.tripId, data.memberId);

    // Assert Bob's traveler profile for Trip 1 is gone
    const bobTrip1Res = await pool.query(
      'SELECT id FROM trip_traveler_profiles WHERE trip_id = $1 AND member_id = $2',
      [data.tripId, data.memberId],
    );
    expect(bobTrip1Res.rows.length).toBe(0);

    // Assert Bob's traveler profile on Trip 2 remains intact
    const bobTrip2Res = await pool.query(
      'SELECT id FROM trip_traveler_profiles WHERE trip_id = $1 AND member_id = $2',
      [data.otherTripId, data.memberId],
    );
    expect(bobTrip2Res.rows.length).toBe(1);
    expect(bobTrip2Res.rows[0].id).toBe(bobTrip2ProfId);

    // Assert Bob's budget allocations on Trip 1 are untouched
    const allocRes = await pool.query(
      'SELECT id, amount_cents FROM trip_budget_allocations WHERE id = $1',
      [allocId],
    );
    expect(allocRes.rows.length).toBe(1);
    expect(Number(allocRes.rows[0].amount_cents)).toBe(45000);

    // Assert Budget by-person total still includes Bob's allocations
    const bundleAfterLeave = await budgetRepo.loadBudget(data.tripId);
    expect(bundleAfterLeave.people.has(`m:${data.memberId}`)).toBe(true);
    expect(bundleAfterLeave.storedLines[0]!.allocations[0]!.storedCents).toBe(45000);

    // Assert deriveSuggestions over reloaded profiles no longer contains Bob
    const reloadedProfiles = await budgetRepo.listTravelerProfiles(data.tripId);
    expect(reloadedProfiles.some((p) => p.memberId === data.memberId)).toBe(false);
    const suggestionsAfterLeave = deriveSuggestions({
      plannedItems: [],
      dayTouringHours: {},
      profiles: reloadedProfiles,
      tripStart: '2026-10-01',
      existingKeys: new Set(),
      dismissedKeys: new Set(),
      llSingleAvailable: new Set(),
      experiencePark: new Map(),
      serviceStyleByExperience: new Map(),
    });
    expect(suggestionsAfterLeave.some((s) => s.draft.allocations?.some((a) => a.memberId === data.memberId))).toBe(false);

    // 2. Organizer removes another member (Carol / otherMemberId)
    const carolProfId = randomUUID();
    await pool.query(
      `INSERT INTO trip_traveler_profiles (id, trip_id, member_id, age_bracket, ticket_days, discount_group, pass_type)
       VALUES ($1, $2, $3, 'adult', 3, 'std-gst', 'none')`,
      [carolProfId, data.tripId, data.otherMemberId],
    );

    await tripRepo.removeMember(data.tripId, data.otherMemberId);

    const carolRes = await pool.query(
      'SELECT id FROM trip_traveler_profiles WHERE trip_id = $1 AND member_id = $2',
      [data.tripId, data.otherMemberId],
    );
    expect(carolRes.rows.length).toBe(0);
  });
});
