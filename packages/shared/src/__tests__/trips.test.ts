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
  attachFoodListSchema,
  tripFoodListSchema,
  tripExperienceListSchema,
  dayTouringHoursSchema,
  dayParkSetSchema,
  dayParkParamsSchema,
  tripOptimizationInputSchema,
  tripEditSchema,
  tripLogEntryCreateSchema,
  rodeWithConfirmSchema,
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

describe('attachFoodListSchema (R22.1)', () => {
  const VALID_UUID = '55555555-5555-4555-8555-555555555555';

  it('accepts a well-formed attach body', () => {
    const result = attachFoodListSchema.safeParse({ foodListId: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.foodListId).toBe(VALID_UUID);
    }
  });

  it('rejects missing foodListId', () => {
    expect(attachFoodListSchema.safeParse({}).success).toBe(false);
  });

  it('rejects non-UUID foodListId', () => {
    expect(attachFoodListSchema.safeParse({ foodListId: 'invalid-id' }).success).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(
      attachFoodListSchema.safeParse({ foodListId: VALID_UUID, extra: 'forbidden' }).success,
    ).toBe(false);
  });
});

describe('tripFoodListSchema (R22.9, R22.10)', () => {
  const VALID_UUID = '66666666-6666-4666-8666-666666666666';

  it('accepts an available food list DTO', () => {
    const dto = {
      available: true as const,
      foodListId: VALID_UUID,
      name: 'Best Snacks in Epcot',
      itemCount: 5,
      ownerDisplayName: 'Mickey',
    };
    const result = tripFoodListSchema.safeParse(dto);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(dto);
    }
  });

  it('accepts an unavailable food list DTO (R22.10)', () => {
    const dto = {
      available: false as const,
      foodListId: VALID_UUID,
    };
    const result = tripFoodListSchema.safeParse(dto);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(dto);
    }
  });

  it('rejects missing fields on available variant', () => {
    expect(
      tripFoodListSchema.safeParse({
        available: true,
        foodListId: VALID_UUID,
        name: 'List',
      }).success,
    ).toBe(false);
  });

  it('rejects negative itemCount', () => {
    expect(
      tripFoodListSchema.safeParse({
        available: true,
        foodListId: VALID_UUID,
        name: 'List',
        itemCount: -1,
        ownerDisplayName: 'Mickey',
      }).success,
    ).toBe(false);
  });

  it('rejects extra fields on unavailable variant', () => {
    expect(
      tripFoodListSchema.safeParse({
        available: false,
        foodListId: VALID_UUID,
        name: 'Extra Name',
      }).success,
    ).toBe(false);
  });
});

describe('tripExperienceListSchema (R14.8)', () => {
  const VALID_UUID = '77777777-7777-4777-8777-777777777777';

  it('accepts an available experience list DTO', () => {
    const dto = {
      available: true as const,
      experienceListId: VALID_UUID,
      name: 'Must-Do Thrill Rides',
      itemCount: 5,
      ownerDisplayName: 'Mickey',
    };
    const result = tripExperienceListSchema.safeParse(dto);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(dto);
    }
  });

  it('accepts an unavailable experience list DTO (R14.8)', () => {
    const dto = {
      available: false as const,
      experienceListId: VALID_UUID,
    };
    const result = tripExperienceListSchema.safeParse(dto);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(dto);
    }
  });

  it('rejects missing fields on available variant', () => {
    expect(
      tripExperienceListSchema.safeParse({
        available: true,
        experienceListId: VALID_UUID,
        name: 'List',
      }).success,
    ).toBe(false);
  });

  it('rejects negative itemCount', () => {
    expect(
      tripExperienceListSchema.safeParse({
        available: true,
        experienceListId: VALID_UUID,
        name: 'List',
        itemCount: -1,
        ownerDisplayName: 'Mickey',
      }).success,
    ).toBe(false);
  });

  it('rejects extra fields on unavailable variant', () => {
    expect(
      tripExperienceListSchema.safeParse({
        available: false,
        experienceListId: VALID_UUID,
        name: 'Extra Name',
      }).success,
    ).toBe(false);
  });
});

describe('dayTouringHoursSchema (R7.1, R9.7)', () => {
  it('accepts valid startMinutes and startMode', () => {
    const result = dayTouringHoursSchema.safeParse({
      startHour: 9,
      endHour: 21,
      startMinutes: 750,
      startMode: 'custom',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startMinutes).toBe(750);
      expect(result.data.startMode).toBe('custom');
    }
  });

  it('accepts park_open and party_mix_in startMode', () => {
    expect(dayTouringHoursSchema.safeParse({ startMode: 'park_open' }).success).toBe(true);
    expect(dayTouringHoursSchema.safeParse({ startMode: 'party_mix_in' }).success).toBe(true);
  });

  it('rejects ephemeral "now" startMode on persisted dayTouringHoursSchema (R9.7)', () => {
    const result = dayTouringHoursSchema.safeParse({ startMode: 'now' });
    expect(result.success).toBe(false);
  });

  it('rejects out of range startMinutes', () => {
    expect(dayTouringHoursSchema.safeParse({ startMinutes: -1 }).success).toBe(false);
    expect(dayTouringHoursSchema.safeParse({ startMinutes: 1440 }).success).toBe(false);
  });
});

describe('tripOptimizationInputSchema (R9.1, R9.2)', () => {
  it('accepts valid startMinutes and ephemeral "now" startMode', () => {
    const result = tripOptimizationInputSchema.safeParse({
      date: '2026-10-01',
      startMinutes: 750,
      startMode: 'now',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startMinutes).toBe(750);
      expect(result.data.startMode).toBe('now');
    }
  });

  it('accepts park_open, party_mix_in, and custom startModes', () => {
    expect(tripOptimizationInputSchema.safeParse({ date: '2026-10-01', startMode: 'park_open' }).success).toBe(true);
    expect(tripOptimizationInputSchema.safeParse({ date: '2026-10-01', startMode: 'party_mix_in' }).success).toBe(true);
    expect(tripOptimizationInputSchema.safeParse({ date: '2026-10-01', startMode: 'custom' }).success).toBe(true);
  });

  it('rejects unknown startMode', () => {
    expect(tripOptimizationInputSchema.safeParse({ date: '2026-10-01', startMode: 'invalid' }).success).toBe(false);
  });

  it('rejects out of range startMinutes', () => {
    expect(tripOptimizationInputSchema.safeParse({ date: '2026-10-01', startMinutes: -1 }).success).toBe(false);
    expect(tripOptimizationInputSchema.safeParse({ date: '2026-10-01', startMinutes: 1440 }).success).toBe(false);
  });
});

describe('tripEditSchema: walkWaitWeighting (R10.1)', () => {
  it('accepts each valid walkWaitWeighting value', () => {
    expect(tripEditSchema.safeParse({ walkWaitWeighting: 'balanced' }).success).toBe(true);
    expect(tripEditSchema.safeParse({ walkWaitWeighting: 'minimize_walking' }).success).toBe(true);
    expect(tripEditSchema.safeParse({ walkWaitWeighting: 'minimize_waits' }).success).toBe(true);
  });

  it('accepts an edit payload omitting walkWaitWeighting entirely', () => {
    expect(tripEditSchema.safeParse({ name: 'Summer 2026' }).success).toBe(true);
  });

  it('rejects an unknown walkWaitWeighting value', () => {
    const result = tripEditSchema.safeParse({ walkWaitWeighting: 'fastest' });
    expect(result.success).toBe(false);
  });
});



describe('dayParkSetSchema (R24.3, R24.4, R24.6)', () => {
  it('accepts valid park and null park', () => {
    expect(dayParkSetSchema.safeParse({ park: 'EPCOT' }).success).toBe(true);
    expect(dayParkSetSchema.safeParse({ park: null }).success).toBe(true);
  });

  it('rejects empty object, unknown park, extra properties, and undefined', () => {
    expect(dayParkSetSchema.safeParse({}).success).toBe(false);
    expect(dayParkSetSchema.safeParse({ park: 'Space Mountain' }).success).toBe(false);
    expect(dayParkSetSchema.safeParse({ park: 'EPCOT', extra: 1 }).success).toBe(false);
    expect(dayParkSetSchema.safeParse({ park: undefined }).success).toBe(false);
  });
});

describe('dayParkParamsSchema (R24.6)', () => {
  const validId = '44444444-4444-4444-8444-444444444444';

  it('accepts valid id and calendar date', () => {
    expect(dayParkParamsSchema.safeParse({ id: validId, date: '2026-10-01' }).success).toBe(true);
  });

  it('rejects invalid dates: 2026-02-30 and not-a-date', () => {
    expect(dayParkParamsSchema.safeParse({ id: validId, date: '2026-02-30' }).success).toBe(false);
    expect(dayParkParamsSchema.safeParse({ id: validId, date: 'not-a-date' }).success).toBe(false);
  });

  it('rejects non-uuid id', () => {
    expect(dayParkParamsSchema.safeParse({ id: 'invalid-id', date: '2026-10-01' }).success).toBe(false);
  });
});

describe('tripLogEntryCreateSchema (note support)', () => {
  const validExpId = '55555555-5555-4555-8555-555555555555';

  it('accepts valid input without note', () => {
    const parsed = tripLogEntryCreateSchema.safeParse({ experienceId: validExpId });
    expect(parsed.success).toBe(true);
  });

  it('accepts valid input with null note', () => {
    const parsed = tripLogEntryCreateSchema.safeParse({ experienceId: validExpId, note: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.note).toBeNull();
    }
  });

  it('accepts valid input with a note and trims whitespace', () => {
    const parsed = tripLogEntryCreateSchema.safeParse({
      experienceId: validExpId,
      note: '  Great ride!  ',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.note).toBe('Great ride!');
    }
  });

  it('rejects whitespace-only note', () => {
    const parsed = tripLogEntryCreateSchema.safeParse({
      experienceId: validExpId,
      note: '    ',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects note exceeding 2000 characters', () => {
    const parsed = tripLogEntryCreateSchema.safeParse({
      experienceId: validExpId,
      note: 'a'.repeat(2001),
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts valid input with visitedOn and userTz (R5.6)', () => {
    const parsed = tripLogEntryCreateSchema.safeParse({
      experienceId: validExpId,
      visitedOn: '2026-05-10',
      userTz: 'America/New_York',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.visitedOn).toBe('2026-05-10');
      expect(parsed.data.userTz).toBe('America/New_York');
    }
  });

  it('rejects invalid visitedOn date format', () => {
    const parsed = tripLogEntryCreateSchema.safeParse({
      experienceId: validExpId,
      visitedOn: 'not-a-date',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects invalid userTz', () => {
    const parsed = tripLogEntryCreateSchema.safeParse({
      experienceId: validExpId,
      userTz: 'not a timezone!',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown extra fields (strict)', () => {
    const parsed = tripLogEntryCreateSchema.safeParse({
      experienceId: validExpId,
      extraField: 'unknown',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('rodeWithConfirmSchema', () => {
  it('accepts undefined (omitted body) and defaults to {}', () => {
    const parsed = rodeWithConfirmSchema.safeParse(undefined);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({});
      expect(parsed.data.rating).toBeUndefined();
    }
  });

  it('accepts an empty object {} without rating', () => {
    const parsed = rodeWithConfirmSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({});
      expect(parsed.data.rating).toBeUndefined();
    }
  });

  it('accepts a valid integer rating between 1 and 10', () => {
    const parsed = rodeWithConfirmSchema.safeParse({ rating: 7 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rating).toBe(7);
    }
  });

  it('rejects ratings outside 1..10 range', () => {
    expect(rodeWithConfirmSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(rodeWithConfirmSchema.safeParse({ rating: 11 }).success).toBe(false);
  });

  it('rejects non-integer ratings', () => {
    expect(rodeWithConfirmSchema.safeParse({ rating: 7.5 }).success).toBe(false);
  });

  it('rejects unrecognized extra fields due to strict mode', () => {
    expect(rodeWithConfirmSchema.safeParse({ rating: 5, extra: 'forbidden' }).success).toBe(false);
  });
});
