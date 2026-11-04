import { describe, expect, it } from 'vitest';

import type { LogDraft, LogTripRef } from '../unifiedLogging.js';
import {
  buildLogSubmission,
  formatLogToast,
  isDateWithinTrip,
  offersDishPrompt,
  preselectTripId,
  reconcileDraft,
  ridingWithCandidates,
  ridingWithLabel,
} from '../unifiedLogging.js';

const TRIP_A: LogTripRef = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Walt Disney World Spring 2026',
  startDate: '2026-05-10',
  endDate: '2026-05-15',
};

const TRIP_B: LogTripRef = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'EPCOT Overlap 2026',
  startDate: '2026-05-12',
  endDate: '2026-05-18',
};

const USER_ME = '99999999-9999-4999-8999-999999999999';
const USER_ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('unifiedLogging unit tests', () => {
  describe('isDateWithinTrip boundary checks (R2.6, R2.7)', () => {
    it('is inclusive on both start and end dates', () => {
      expect(isDateWithinTrip('2026-05-10', TRIP_A)).toBe(true);
      expect(isDateWithinTrip('2026-05-15', TRIP_A)).toBe(true);
      expect(isDateWithinTrip('2026-05-12', TRIP_A)).toBe(true);
    });

    it('rejects one day before startDate and one day after endDate', () => {
      expect(isDateWithinTrip('2026-05-09', TRIP_A)).toBe(false);
      expect(isDateWithinTrip('2026-05-16', TRIP_A)).toBe(false);
    });
  });

  describe('preselectTripId (R2.1, R2.2, R2.3)', () => {
    it('returns null when activeTrips is empty (0 trips)', () => {
      expect(preselectTripId([], '2026-05-10')).toBeNull();
    });

    it('returns the trip id when exactly 1 active trip contains the date', () => {
      expect(preselectTripId([TRIP_A], '2026-05-10')).toBe(TRIP_A.id);
    });

    it('returns null when 2 active trips contain the date (overlap)', () => {
      // 2026-05-13 is within both TRIP_A (10-15) and TRIP_B (12-18)
      expect(preselectTripId([TRIP_A, TRIP_B], '2026-05-13')).toBeNull();
    });

    it('returns the trip id when only 1 of 2 active trips contains the date', () => {
      // 2026-05-11 is within TRIP_A, but not TRIP_B
      expect(preselectTripId([TRIP_A, TRIP_B], '2026-05-11')).toBe(TRIP_A.id);
    });
  });

  describe('reconcileDraft (R2.4, R2.6, R2.8, R2.9)', () => {
    const baseDraft: LogDraft = {
      visitedOn: '2026-05-12',
      rating: 9,
      note: 'Super fun!',
      tripId: TRIP_A.id,
      rodeWith: [USER_ALICE, USER_BOB],
    };

    it('clears tripId and rodeWith and sets date_outside_trip hint when date moves out of range', () => {
      const result = reconcileDraft(
        baseDraft,
        { visitedOn: '2026-05-20' },
        [TRIP_A],
        null,
      );
      expect(result.draft.visitedOn).toBe('2026-05-20');
      expect(result.draft.tripId).toBeNull();
      expect(result.draft.rodeWith).toEqual([]);
      expect(result.hint).toBe('date_outside_trip');
    });

    it('retains tripId and rodeWith when date moves within range', () => {
      const result = reconcileDraft(
        baseDraft,
        { visitedOn: '2026-05-14' },
        [TRIP_A],
        null,
      );
      expect(result.draft.visitedOn).toBe('2026-05-14');
      expect(result.draft.tripId).toBe(TRIP_A.id);
      expect(result.draft.rodeWith).toEqual([USER_ALICE, USER_BOB]);
      expect(result.hint).toBeNull();
    });

    it('clears rodeWith when tripId is switched to a different trip', () => {
      const result = reconcileDraft(
        baseDraft,
        { tripId: TRIP_B.id },
        [TRIP_A, TRIP_B],
        null,
      );
      expect(result.draft.tripId).toBe(TRIP_B.id);
      expect(result.draft.rodeWith).toEqual([]);
    });

    it('clears rodeWith when tripId is switched to null', () => {
      const result = reconcileDraft(
        baseDraft,
        { tripId: null },
        [TRIP_A],
        null,
      );
      expect(result.draft.tripId).toBeNull();
      expect(result.draft.rodeWith).toEqual([]);
    });

    it('ignores tripId change when trip is locked', () => {
      const lockedDraft: LogDraft = { ...baseDraft, tripId: TRIP_A.id };
      const result = reconcileDraft(
        lockedDraft,
        { tripId: TRIP_B.id },
        [TRIP_A, TRIP_B],
        TRIP_A.id,
      );
      expect(result.draft.tripId).toBe(TRIP_A.id);
      expect(result.draft.rodeWith).toEqual([USER_ALICE, USER_BOB]);
    });

    it('locked trip leaves draft unchanged if new date is outside locked trip range', () => {
      const lockedDraft: LogDraft = { ...baseDraft, tripId: TRIP_A.id };
      const result = reconcileDraft(
        lockedDraft,
        { visitedOn: '2026-05-25' },
        [TRIP_A],
        TRIP_A.id,
      );
      expect(result.draft).toEqual(lockedDraft);
      expect(result.hint).toBeNull();
    });
  });

  describe('ridingWithCandidates (R3.1)', () => {
    it('filters out the caller and deduplicates by userId preserving order', () => {
      const members = [
        { userId: USER_ALICE, name: 'Alice' },
        { userId: USER_ME, name: 'Me (Caller)' },
        { userId: USER_BOB, name: 'Bob' },
        { userId: USER_ALICE, name: 'Alice Duplicate' },
      ];
      const candidates = ridingWithCandidates(members, USER_ME);
      expect(candidates).toEqual([
        { userId: USER_ALICE, name: 'Alice' },
        { userId: USER_BOB, name: 'Bob' },
      ]);
    });
  });

  describe('ridingWithLabel and offersDishPrompt (R3.2, R8.1, R8.3)', () => {
    it('returns Dined with and true for Restaurant', () => {
      expect(ridingWithLabel('Restaurant')).toBe('Dined with');
      expect(offersDishPrompt('Restaurant')).toBe(true);
    });

    it('returns Rode with and false for Attraction and other categories', () => {
      expect(ridingWithLabel('Attraction')).toBe('Rode with');
      expect(offersDishPrompt('Attraction')).toBe(false);
      expect(ridingWithLabel(null)).toBe('Rode with');
      expect(offersDishPrompt(null)).toBe(false);
      expect(ridingWithLabel(undefined)).toBe('Rode with');
      expect(offersDishPrompt(undefined)).toBe(false);
    });
  });

  describe('buildLogSubmission (R1.3, R4.4, R5.1, R13.2)', () => {
    const expId = '33333333-3333-4333-8333-333333333333';

    it('trims whitespace-only note and removes caller and duplicates from rodeWith', () => {
      const draft: LogDraft = {
        visitedOn: '2026-05-12',
        rating: 8,
        note: '   \n\t  ',
        tripId: TRIP_A.id,
        rodeWith: [USER_ALICE, USER_ME, USER_BOB, USER_ALICE],
      };

      const unlockedSub = buildLogSubmission({
        experienceId: expId,
        draft,
        userTz: 'America/New_York',
        lockedTripId: null,
        callerUserId: USER_ME,
      });

      expect(unlockedSub.path).toBe(`/me/experiences/${expId}/logs`);
      expect(unlockedSub.body.note).toBeNull();
      expect(unlockedSub.body.rodeWith).toEqual([USER_ALICE, USER_BOB]);

      const lockedSub = buildLogSubmission({
        experienceId: expId,
        draft,
        userTz: 'America/New_York',
        lockedTripId: TRIP_A.id,
        callerUserId: USER_ME,
      });

      expect(lockedSub.path).toBe(`/trips/${TRIP_A.id}/log-entries`);
      expect(lockedSub.body.note).toBeUndefined();
      expect(lockedSub.body.rodeWith).toEqual([USER_ALICE, USER_BOB]);
    });
  });

  describe('formatLogToast (R7.2)', () => {
    const exp = 'Space Mountain';
    const trip = 'Summer Vacation';

    it('formats with 0 tagged names (no trip and with trip)', () => {
      expect(formatLogToast({ experienceName: exp, tripName: null, taggedNames: [] }))
        .toBe('Space Mountain logged');
      expect(formatLogToast({ experienceName: exp, tripName: trip, taggedNames: [] }))
        .toBe('Space Mountain logged to Summer Vacation');
    });

    it('formats with 1 tagged name', () => {
      expect(formatLogToast({ experienceName: exp, tripName: null, taggedNames: ['Alice'] }))
        .toBe('Space Mountain logged with Alice');
      expect(formatLogToast({ experienceName: exp, tripName: trip, taggedNames: ['Alice'] }))
        .toBe('Space Mountain logged to Summer Vacation with Alice');
    });

    it('formats with 2 tagged names', () => {
      expect(formatLogToast({ experienceName: exp, tripName: null, taggedNames: ['Alice', 'Bob'] }))
        .toBe('Space Mountain logged with Alice and Bob');
      expect(formatLogToast({ experienceName: exp, tripName: trip, taggedNames: ['Alice', 'Bob'] }))
        .toBe('Space Mountain logged to Summer Vacation with Alice and Bob');
    });

    it('formats with 3 tagged names ("and 1 more")', () => {
      expect(formatLogToast({ experienceName: exp, tripName: null, taggedNames: ['Alice', 'Bob', 'Charlie'] }))
        .toBe('Space Mountain logged with Alice, Bob and 1 more');
      expect(formatLogToast({ experienceName: exp, tripName: trip, taggedNames: ['Alice', 'Bob', 'Charlie'] }))
        .toBe('Space Mountain logged to Summer Vacation with Alice, Bob and 1 more');
    });

    it('formats with 5 tagged names ("and 3 more")', () => {
      expect(formatLogToast({ experienceName: exp, tripName: trip, taggedNames: ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve'] }))
        .toBe('Space Mountain logged to Summer Vacation with Alice, Bob and 3 more');
    });
  });
});

