/**
 * Unit tests for the Experience_Log contracts.
 *
 * Covers a valid and an invalid case for each schema:
 *   - `createExperienceLogInputSchema` accepts a minimal body, a fully
 *     populated body, and `null` for the optional fields; it rejects an
 *     out-of-range rating, an over-long note, a bad date shape, a non-UUID
 *     tripId, and unknown extra fields (`.strict`).
 *   - `experienceLogSchema` accepts a DTO with a rated/noted log and with the
 *     null variants; it rejects a bad rating.
 *   - `experienceVisitHistorySchema` accepts a history payload and rejects a
 *     negative repeatCount.
 *
 * Validates: Requirements 1.1, 1.2, 4.1, 4.2
 */

import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorCodeToHttpStatus } from '../../errors.js';
import {
  createExperienceLogInputSchema,
  experienceLogSchema,
  experienceVisitHistorySchema,
} from '../ExperienceLog.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

describe('createExperienceLogInputSchema', () => {
  it('accepts a minimal body (date + tz only)', () => {
    const result = createExperienceLogInputSchema.safeParse({
      visitedOn: '2026-01-02',
      userTz: 'America/New_York',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a fully populated body with rating, note, and tripId', () => {
    const result = createExperienceLogInputSchema.safeParse({
      visitedOn: '2026-01-02',
      userTz: 'America/New_York',
      rating: 8,
      note: 'Great ride',
      tripId: UUID_A,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null for the optional rating/note/tripId fields', () => {
    const result = createExperienceLogInputSchema.safeParse({
      visitedOn: '2026-01-02',
      userTz: 'America/New_York',
      rating: null,
      note: null,
      tripId: null,
    });
    expect(result.success).toBe(true);
  });

  it('trims a note per noteBodySchema', () => {
    const result = createExperienceLogInputSchema.safeParse({
      visitedOn: '2026-01-02',
      userTz: 'America/New_York',
      note: '  padded  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe('padded');
    }
  });

  it('rejects a rating outside 1..10', () => {
    expect(
      createExperienceLogInputSchema.safeParse({
        visitedOn: '2026-01-02',
        userTz: 'America/New_York',
        rating: 11,
      }).success,
    ).toBe(false);
    expect(
      createExperienceLogInputSchema.safeParse({
        visitedOn: '2026-01-02',
        userTz: 'America/New_York',
        rating: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects a note over 2000 characters', () => {
    expect(
      createExperienceLogInputSchema.safeParse({
        visitedOn: '2026-01-02',
        userTz: 'America/New_York',
        note: 'x'.repeat(2001),
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed visitedOn date', () => {
    expect(
      createExperienceLogInputSchema.safeParse({
        visitedOn: '01/02/2026',
        userTz: 'America/New_York',
      }).success,
    ).toBe(false);
  });

  it('rejects a non-UUID tripId', () => {
    expect(
      createExperienceLogInputSchema.safeParse({
        visitedOn: '2026-01-02',
        userTz: 'America/New_York',
        tripId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });

  it('rejects unknown extra fields (strict)', () => {
    expect(
      createExperienceLogInputSchema.safeParse({
        visitedOn: '2026-01-02',
        userTz: 'America/New_York',
        surprise: true,
      }).success,
    ).toBe(false);
  });
});

// Feature: experience-activity-logging, R1.5 — a future visit date is a
// domain error the create route surfaces with this catalog code (400).
describe('log_future_date error code (R1.5)', () => {
  it('is a member of the closed ErrorCode catalog mapped to HTTP 400', () => {
    expect(ERROR_CODES).toContain('log_future_date');
    expect(errorCodeToHttpStatus.log_future_date).toBe(400);
  });

  it('does not invent an adjacent unlisted code', () => {
    expect(ERROR_CODES).not.toContain('log_past_date');
  });
});

describe('experienceLogSchema', () => {
  it('accepts a rated and noted log DTO', () => {
    const result = experienceLogSchema.safeParse({
      id: UUID_A,
      userId: UUID_B,
      experienceId: UUID_C,
      visitedOn: '2026-01-02',
      userTz: 'America/New_York',
      loggedAt: '2026-01-02T15:00:00Z',
      rating: 9,
      note: 'Loved it',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null rating and note (unrated, unnoted visit)', () => {
    const result = experienceLogSchema.safeParse({
      id: UUID_A,
      userId: UUID_B,
      experienceId: UUID_C,
      visitedOn: '2026-01-02',
      userTz: 'America/New_York',
      loggedAt: '2026-01-02T15:00:00Z',
      rating: null,
      note: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a rating outside 1..10', () => {
    const result = experienceLogSchema.safeParse({
      id: UUID_A,
      userId: UUID_B,
      experienceId: UUID_C,
      visitedOn: '2026-01-02',
      userTz: 'America/New_York',
      loggedAt: '2026-01-02T15:00:00Z',
      rating: 42,
      note: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('experienceVisitHistorySchema', () => {
  it('accepts a visit-history payload', () => {
    const result = experienceVisitHistorySchema.safeParse({
      experienceId: UUID_C,
      repeatCount: 1,
      logs: [
        {
          id: UUID_A,
          userId: UUID_B,
          experienceId: UUID_C,
          visitedOn: '2026-01-02',
          userTz: 'America/New_York',
          loggedAt: '2026-01-02T15:00:00Z',
          rating: null,
          note: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty history with repeatCount 0', () => {
    const result = experienceVisitHistorySchema.safeParse({
      experienceId: UUID_C,
      repeatCount: 0,
      logs: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative repeatCount', () => {
    const result = experienceVisitHistorySchema.safeParse({
      experienceId: UUID_C,
      repeatCount: -1,
      logs: [],
    });
    expect(result.success).toBe(false);
  });
});
