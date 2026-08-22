// Feature: trip-reservations, Property 5: Reservation field bounds are enforced at the contract edge

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  CONFIRMATION_NUMBER_MAX,
  PARTY_SIZE_MAX,
  PARTY_SIZE_MIN,
  RESERVATION_KINDS,
  plannedItemAddSchema,
  plannedItemEditSchema,
} from '../index.js';

const EXPERIENCE_ID = '11111111-1111-4111-8111-111111111111';
const KIND = fc.constantFrom(...RESERVATION_KINDS);

/** Confirmation numbers that are in bounds: 1..MAX chars, non-blank after trim. */
const inBoundsConfirmation = fc
  .string({ minLength: 1, maxLength: CONFIRMATION_NUMBER_MAX })
  .filter((s) => s.trim().length >= 1 && s.trim().length <= CONFIRMATION_NUMBER_MAX);

const inBoundsPartySize = fc.integer({ min: PARTY_SIZE_MIN, max: PARTY_SIZE_MAX });

describe('Property 5: Reservation field bounds are enforced at the contract edge', () => {
  it('accepts every in-bounds combination and round-trips it unchanged', () => {
    fc.assert(
      fc.property(
        KIND,
        fc.option(inBoundsConfirmation, { nil: null }),
        fc.option(inBoundsPartySize, { nil: null }),
        (reservationKind, confirmationNumber, partySize) => {
          const parsed = plannedItemAddSchema.safeParse({
            experienceId: EXPERIENCE_ID,
            plannedDate: '2026-10-02',
            plannedTime: '2026-10-02T22:00:00.000Z',
            reservationKind,
            confirmationNumber,
            partySize,
          });

          expect(parsed.success).toBe(true);
          if (parsed.success) {
            expect(parsed.data.reservationKind).toBe(reservationKind);
            expect(parsed.data.partySize).toBe(partySize);
            // The only transformation applied to a confirmation number is trim.
            expect(parsed.data.confirmationNumber).toBe(
              confirmationNumber === null ? null : confirmationNumber.trim(),
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects every out-of-bounds party size', () => {
    fc.assert(
      fc.property(
        KIND,
        fc
          .integer({ min: -1000, max: 1000 })
          .filter((n) => n < PARTY_SIZE_MIN || n > PARTY_SIZE_MAX),
        (reservationKind, partySize) => {
          const parsed = plannedItemAddSchema.safeParse({
            experienceId: EXPERIENCE_ID,
            plannedDate: '2026-10-02',
            plannedTime: '2026-10-02T22:00:00.000Z',
            reservationKind,
            partySize,
          });
          expect(parsed.success).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects every over-long confirmation number', () => {
    fc.assert(
      fc.property(
        KIND,
        fc
          .string({ minLength: CONFIRMATION_NUMBER_MAX + 1, maxLength: CONFIRMATION_NUMBER_MAX + 40 })
          // Trimming could bring a whitespace-padded string back into bounds, so
          // only assert on values that are genuinely too long once trimmed.
          .filter((s) => s.trim().length > CONFIRMATION_NUMBER_MAX),
        (reservationKind, confirmationNumber) => {
          const parsed = plannedItemAddSchema.safeParse({
            experienceId: EXPERIENCE_ID,
            plannedDate: '2026-10-02',
            plannedTime: '2026-10-02T22:00:00.000Z',
            reservationKind,
            confirmationNumber,
          });
          expect(parsed.success).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects every kind outside the vocabulary', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(RESERVATION_KINDS as readonly string[]).includes(s)),
        (reservationKind) => {
          const parsed = plannedItemAddSchema.safeParse({
            experienceId: EXPERIENCE_ID,
            plannedDate: '2026-10-02',
            plannedTime: '2026-10-02T22:00:00.000Z',
            reservationKind,
          });
          expect(parsed.success).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never accepts a reservation whose anchor is missing (Property 2, contract half)', () => {
    fc.assert(
      fc.property(
        KIND,
        fc.constantFrom<'date' | 'time' | 'both'>('date', 'time', 'both'),
        (reservationKind, missing) => {
          const parsed = plannedItemAddSchema.safeParse({
            experienceId: EXPERIENCE_ID,
            ...(missing === 'time' ? { plannedDate: '2026-10-02' } : {}),
            ...(missing === 'date' ? { plannedTime: '2026-10-02T22:00:00.000Z' } : {}),
            reservationKind,
          });
          expect(parsed.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('keeps the add and edit schemas aligned on the reservation fields', () => {
    fc.assert(
      fc.property(
        fc.option(KIND, { nil: null }),
        fc.option(inBoundsConfirmation, { nil: null }),
        fc.option(inBoundsPartySize, { nil: null }),
        (reservationKind, confirmationNumber, partySize) => {
          // The edit schema accepts the same reservation payload as the add
          // schema for any in-bounds value (the anchor rule for an existing
          // Reservation is a repo concern, not a schema one).
          const parsed = plannedItemEditSchema.safeParse({
            plannedDate: '2026-10-02',
            plannedTime: '2026-10-02T22:00:00.000Z',
            reservationKind,
            confirmationNumber,
            partySize,
          });
          expect(parsed.success).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
