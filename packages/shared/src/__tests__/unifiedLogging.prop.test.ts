import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  createExperienceLogInputSchema,
  tripLogEntryCreateSchema,
} from '../index.js';
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

// Arbitraries
const isoDateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map((d) => d.toISOString().slice(0, 10));

const tripRefArb = fc.tuple(isoDateArb, isoDateArb, fc.uuid(), fc.string({ minLength: 1, maxLength: 50 }))
  .map(([d1, d2, id, name]): LogTripRef => {
    const [startDate, endDate] = d1 <= d2 ? [d1, d2] : [d2, d1];
    return { id, name, startDate, endDate };
  });

const draftArb = fc.record({
  visitedOn: isoDateArb,
  rating: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 10 })),
  note: fc.oneof(fc.string({ maxLength: 500 }), fc.constant('   ')),
  tripId: fc.oneof(fc.constant(null), fc.uuid()),
  rodeWith: fc.array(fc.uuid(), { maxLength: 10 }),
});

describe('unifiedLogging property tests', () => {
  // Feature: unified-experience-logging, Property 1: Trip date range is inclusive and decides attribution
  // Validates: Requirements 2.6, 2.7, 2.8
  it('Property 1: Trip date range is inclusive and decides attribution', () => {
    fc.assert(
      fc.property(
        tripRefArb,
        isoDateArb,
        draftArb,
        fc.boolean(),
        (trip, date, baseDraft, isLocked) => {
          // Part 1: isDateWithinTrip is true exactly when startDate <= date <= endDate
          const expectedWithin = date >= trip.startDate && date <= trip.endDate;
          expect(isDateWithinTrip(date, trip)).toBe(expectedWithin);

          // Part 2: reconcileDraft with visitedOn change
          if (isLocked) {
            const lockedDraft: LogDraft = { ...baseDraft, tripId: trip.id };
            const { draft, hint } = reconcileDraft(
              lockedDraft,
              { visitedOn: date },
              [trip],
              trip.id,
            );
            if (expectedWithin) {
              expect(draft.visitedOn).toBe(date);
              expect(draft.tripId).toBe(trip.id);
            } else {
              expect(draft).toEqual(lockedDraft);
            }
            expect(hint).toBeNull();
          } else {
            const unlockedDraft: LogDraft = { ...baseDraft, tripId: trip.id };
            const { draft, hint } = reconcileDraft(
              unlockedDraft,
              { visitedOn: date },
              [trip],
              null,
            );
            if (expectedWithin) {
              expect(draft.visitedOn).toBe(date);
              expect(draft.tripId).toBe(trip.id);
              expect(draft.rodeWith).toEqual(unlockedDraft.rodeWith);
              expect(hint).toBeNull();
            } else {
              expect(draft.visitedOn).toBe(date);
              expect(draft.tripId).toBeNull();
              expect(draft.rodeWith).toEqual([]);
              expect(hint).toBe('date_outside_trip');
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: unified-experience-logging, Property 2: Pre-selection is unambiguous or absent
  // Validates: Requirements 2.1, 2.2, 2.3
  it('Property 2: Pre-selection is unambiguous or absent', () => {
    fc.assert(
      fc.property(
        fc.array(tripRefArb, { maxLength: 10 }),
        isoDateArb,
        (activeTrips, visitedOn) => {
          const containingTrips = activeTrips.filter((t) => isDateWithinTrip(visitedOn, t));
          const selected = preselectTripId(activeTrips, visitedOn);

          if (containingTrips.length === 1) {
            expect(selected).toBe(containingTrips[0]?.id);
          } else {
            expect(selected).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: unified-experience-logging, Property 3: Changing the Trip clears riders
  // Validates: Requirements 2.4, 2.9, 3.5
  it('Property 3: Changing the Trip clears riders', () => {
    fc.assert(
      fc.property(
        draftArb,
        fc.oneof(fc.constant(null), fc.uuid()),
        fc.array(tripRefArb, { minLength: 1, maxLength: 5 }),
        fc.oneof(fc.constant(null), fc.uuid()),
        (baseDraft, newTripId, trips, lockedTripId) => {
          if (lockedTripId !== null) {
            const lockedDraft: LogDraft = { ...baseDraft, tripId: lockedTripId };
            const { draft } = reconcileDraft(
              lockedDraft,
              { tripId: newTripId },
              trips,
              lockedTripId,
            );
            // In locked mode, changes to tripId are ignored entirely
            expect(draft.tripId).toBe(lockedTripId);
            expect(draft.rodeWith).toEqual(lockedDraft.rodeWith);
          } else {
            // Unlocked mode
            // Ensure draft is within current trip's range if tripId is set
            const currentTrip = trips.find((t) => t.id === baseDraft.tripId);
            const initialDraft: LogDraft = currentTrip
              ? { ...baseDraft, visitedOn: currentTrip.startDate }
              : baseDraft;

            const { draft } = reconcileDraft(
              initialDraft,
              { tripId: newTripId },
              trips,
              null,
            );

            if (newTripId !== initialDraft.tripId) {
              expect(draft.rodeWith).toEqual([]);
            } else {
              expect(draft.rodeWith).toEqual(initialDraft.rodeWith);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: unified-experience-logging, Property 4: The submission targets the right endpoint with a well-formed, safe body
  // Validates: Requirements 1.3, 3.5, 4.4, 5.1, 13.2
  it('Property 4: The submission targets the right endpoint with a well-formed, safe body', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        draftArb,
        fc.constantFrom('America/New_York', 'America/Los_Angeles', 'UTC'),
        fc.oneof(fc.constant(null), fc.uuid()),
        fc.uuid(),
        (experienceId, draft, userTz, lockedTripId, callerUserId) => {
          const submission = buildLogSubmission({
            experienceId,
            draft,
            userTz,
            lockedTripId,
            callerUserId,
          });

          // Check endpoint path
          if (lockedTripId !== null) {
            expect(submission.path).toBe(`/trips/${encodeURIComponent(lockedTripId)}/log-entries`);
            // Body validates against tripLogEntryCreateSchema
            const parsed = tripLogEntryCreateSchema.safeParse(submission.body);
            expect(parsed.success).toBe(true);

            // Never contains callerUserId in rodeWith
            const bodyRodeWith = submission.body.rodeWith as string[];
            expect(bodyRodeWith).not.toContain(callerUserId);
            // No duplicates
            expect(new Set(bodyRodeWith).size).toBe(bodyRodeWith.length);

            // Whitespace-only note is treated as absent
            if (draft.note.trim().length === 0) {
              expect(submission.body.note).toBeUndefined();
            } else {
              expect(submission.body.note).toBe(draft.note.trim());
            }
          } else {
            expect(submission.path).toBe(`/me/experiences/${encodeURIComponent(experienceId)}/logs`);
            // Body validates against createExperienceLogInputSchema
            const parsed = createExperienceLogInputSchema.safeParse(submission.body);
            expect(parsed.success).toBe(true);

            // rodeWith is absent unless tripId != null and non-empty
            if (draft.tripId !== null) {
              if (submission.body.rodeWith !== undefined) {
                const bodyRodeWith = submission.body.rodeWith as string[];
                expect(bodyRodeWith.length).toBeGreaterThan(0);
                expect(bodyRodeWith).not.toContain(callerUserId);
                expect(new Set(bodyRodeWith).size).toBe(bodyRodeWith.length);
              }
            } else {
              expect(submission.body.rodeWith).toBeUndefined();
            }

            // Whitespace-only note treated as absent (null)
            if (draft.note.trim().length === 0) {
              expect(submission.body.note).toBeNull();
            } else {
              expect(submission.body.note).toBe(draft.note.trim());
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: unified-experience-logging, Property 5: Candidates, labels, and toast text are derived consistently
  // Validates: Requirements 3.1, 3.2, 7.2, 8.1, 8.3
  it('Property 5: Candidates, labels, and toast text are derived consistently', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ userId: fc.uuid(), displayName: fc.string() }), { maxLength: 10 }),
        fc.uuid(),
        fc.oneof(fc.constant('Restaurant'), fc.constant('Attraction'), fc.string()),
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 30 })),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
        (members, callerUserId, category, expName, tripName, taggedNames) => {
          // 1. Candidates: non-caller, input order preserved, unique ids
          const candidates = ridingWithCandidates(members, callerUserId);
          expect(candidates.some((c) => c.userId === callerUserId)).toBe(false);
          const candidateIds = candidates.map((c) => c.userId);
          expect(new Set(candidateIds).size).toBe(candidateIds.length);

          // 2. Labels and dish prompt
          const isRestaurant = category === 'Restaurant';
          expect(ridingWithLabel(category)).toBe(isRestaurant ? 'Dined with' : 'Rode with');
          expect(offersDishPrompt(category)).toBe(isRestaurant);

          // 3. Toast formatting
          const toast = formatLogToast({
            experienceName: expName,
            tripName,
            taggedNames,
          });

          expect(toast.startsWith(`${expName} logged`)).toBe(true);
          if (tripName) {
            expect(toast).toContain(`logged to ${tripName}`);
          } else {
            expect(toast).not.toContain('logged to');
          }

          if (taggedNames.length === 1) {
            expect(toast).toContain(`with ${taggedNames[0]}`);
          } else if (taggedNames.length === 2) {
            expect(toast).toContain(`with ${taggedNames[0]} and ${taggedNames[1]}`);
          } else if (taggedNames.length >= 3) {
            const remainder = taggedNames.length - 2;
            expect(toast).toContain(`with ${taggedNames[0]}, ${taggedNames[1]} and ${remainder} more`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

