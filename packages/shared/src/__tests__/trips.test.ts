// Feature: notification-center
/**
 * Unit (example) tests for the shared Trips read-projection DTO schemas that
 * back the Notification_Center pending reads:
 *
 *  - `pendingRodeWithTagSchema` — the `.strict()` validator for a single
 *    `pending` Rode_With_Tag as returned by
 *    `GET /me/rode-with-tags?state=pending` (R3.3).
 *  - `tripIncomingInviteSchema` — the trip-invite inbox validator, updated to
 *    carry an additive, optional `createdAt` ISO-8601 timestamp so an incoming
 *    invite can supply a source timestamp for Notification_Center ordering
 *    without reshaping the existing contract (R7.3).
 *
 * These example tests complement the property tests: they pin down specific
 * well-formed and malformed payloads so drift between the Trips_API producer
 * and the Notification_Center consumer surfaces as a failing test.
 *
 * Validates: Requirements 3.3, 7.3
 */

import { describe, expect, it } from 'vitest';

import {
  pendingRodeWithTagSchema,
  tripIncomingInviteSchema,
  isMealPeriodServed,
} from '../trips.js';

// A stable, well-formed pending rode-with tag DTO (all fields present, valid).
const VALID_PENDING_RODE_WITH_TAG = {
  tagId: '11111111-1111-4111-8111-111111111111',
  tripLogEntryId: '22222222-2222-4222-8222-222222222222',
  experienceName: 'Space Mountain',
  taggingMemberDisplayName: 'Ada Lovelace',
  createdAt: '2024-01-15T12:00:00.000Z',
} as const;

// A well-formed incoming trip-invite DTO (without the additive createdAt).
const VALID_INCOMING_INVITE = {
  inviteId: '33333333-3333-4333-8333-333333333333',
  tripId: '44444444-4444-4444-8444-444444444444',
  tripName: 'Summer 2024',
  startDate: '2024-06-01',
  endDate: '2024-06-07',
  inviterDisplayName: 'Grace Hopper',
  inviterAvatarPreset: null,
} as const;

describe('pendingRodeWithTagSchema (R3.3)', () => {
  it('accepts a well-formed pending rode-with tag DTO', () => {
    const result = pendingRodeWithTagSchema.safeParse(
      VALID_PENDING_RODE_WITH_TAG,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(VALID_PENDING_RODE_WITH_TAG);
    }
  });

  it('rejects each missing required field', () => {
    const requiredKeys = [
      'tagId',
      'tripLogEntryId',
      'experienceName',
      'taggingMemberDisplayName',
      'createdAt',
    ] as const;

    for (const key of requiredKeys) {
      const body: Record<string, unknown> = { ...VALID_PENDING_RODE_WITH_TAG };
      delete body[key];
      expect(pendingRodeWithTagSchema.safeParse(body).success).toBe(false);
    }
  });

  it('rejects an extra/unexpected field (strict drift guard)', () => {
    const body = { ...VALID_PENDING_RODE_WITH_TAG, unexpected: 'nope' };
    expect(pendingRodeWithTagSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a non-UUID tagId', () => {
    const body = { ...VALID_PENDING_RODE_WITH_TAG, tagId: 'not-a-uuid' };
    expect(pendingRodeWithTagSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a non-UUID tripLogEntryId', () => {
    const body = {
      ...VALID_PENDING_RODE_WITH_TAG,
      tripLogEntryId: '123',
    };
    expect(pendingRodeWithTagSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a createdAt that is not an ISO-8601 UTC timestamp', () => {
    const body = {
      ...VALID_PENDING_RODE_WITH_TAG,
      createdAt: '2024-01-15 12:00:00',
    };
    expect(pendingRodeWithTagSchema.safeParse(body).success).toBe(false);
  });
});

describe('tripIncomingInviteSchema: additive createdAt (R7.3)', () => {
  it('accepts a payload carrying a valid createdAt ISO-8601 timestamp', () => {
    const body = {
      ...VALID_INCOMING_INVITE,
      createdAt: '2024-05-01T08:30:00.000Z',
    };
    const result = tripIncomingInviteSchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdAt).toBe('2024-05-01T08:30:00.000Z');
    }
  });

  it('still accepts a payload omitting createdAt (the field is additive/optional)', () => {
    const result = tripIncomingInviteSchema.safeParse(VALID_INCOMING_INVITE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdAt).toBeUndefined();
    }
  });

  it('rejects a createdAt that is present but not a valid ISO-8601 UTC timestamp', () => {
    const body = { ...VALID_INCOMING_INVITE, createdAt: 'yesterday' };
    expect(tripIncomingInviteSchema.safeParse(body).success).toBe(false);
  });
});

describe('isMealPeriodServed (B3, R3.17)', () => {
  it('correctly matches compound meal periods like Pecos Bill (Lunch And Dinner)', () => {
    const pecosBill = ['Lunch And Dinner'];
    expect(isMealPeriodServed(pecosBill, 'lunch')).toBe(true);
    expect(isMealPeriodServed(pecosBill, 'dinner')).toBe(true);
    expect(isMealPeriodServed(pecosBill, 'breakfast')).toBe(false);
  });

  it('matches All Day token for all meal periods', () => {
    const allDay = ['All Day'];
    expect(isMealPeriodServed(allDay, 'breakfast')).toBe(true);
    expect(isMealPeriodServed(allDay, 'lunch')).toBe(true);
    expect(isMealPeriodServed(allDay, 'dinner')).toBe(true);
    expect(isMealPeriodServed(allDay, 'snack')).toBe(true);
  });

  it('matches Brunch token for both breakfast and lunch', () => {
    const brunch = ['Brunch'];
    expect(isMealPeriodServed(brunch, 'breakfast')).toBe(true);
    expect(isMealPeriodServed(brunch, 'lunch')).toBe(true);
    expect(isMealPeriodServed(brunch, 'dinner')).toBe(false);
  });

  it('matches Late Night Dining token for dinner', () => {
    const lateNight = ['Late Night Dining'];
    expect(isMealPeriodServed(lateNight, 'dinner')).toBe(true);
    expect(isMealPeriodServed(lateNight, 'lunch')).toBe(false);
  });

  it('does not warn (returns true) when servedMealPeriods is empty, null, or undefined', () => {
    expect(isMealPeriodServed([], 'dinner')).toBe(true);
    expect(isMealPeriodServed(null, 'dinner')).toBe(true);
    expect(isMealPeriodServed(undefined, 'dinner')).toBe(true);
  });

  it('always returns true for snack target', () => {
    expect(isMealPeriodServed(['Breakfast'], 'snack')).toBe(true);
  });
});

