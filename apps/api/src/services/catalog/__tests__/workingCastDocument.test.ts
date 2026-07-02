/**
 * Unit tests for `isWorkingCastDocument` (sync.ts).
 *
 * Walt Disney World publishes a Cast-Member-only ("working cast") variant of
 * many quick-service restaurants as its own `restaurant`-typed
 * Facility_Document — the guest venue name with a `" - Working Cast Dining"`
 * suffix (e.g. "Backlot Express - Working Cast Dining"). Because their
 * Facility_Type is `restaurant`, `classifyFacility` maps them to `Restaurant`,
 * so without a name-based exclusion these back-of-house locations leak into the
 * guest catalogue. `isWorkingCastDocument` is the pure predicate that
 * identifies them so the sync's normalization step drops them.
 */

import { describe, expect, it } from 'vitest';

import { __internal } from '../sync.js';
import type { FacilityDocument } from '../disney/facilityDoc.js';

const { isWorkingCastDocument } = __internal;

function doc(name: string | undefined): FacilityDocument {
  const base: FacilityDocument = { id: '1;entityType=restaurant', type: 'restaurant' };
  return name !== undefined ? { ...base, name } : base;
}

describe('isWorkingCastDocument', () => {
  it('matches the working-cast dining suffix', () => {
    expect(
      isWorkingCastDocument(doc('Backlot Express - Working Cast Dining')),
    ).toBe(true);
    expect(
      isWorkingCastDocument(doc("Satu'li Canteen - Working Cast Dining")),
    ).toBe(true);
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(
      isWorkingCastDocument(doc('  Everything Pop - working cast dining  ')),
    ).toBe(true);
    expect(
      isWorkingCastDocument(doc('THE MARA - WORKING CAST DINING')),
    ).toBe(true);
  });

  it('does not match guest-facing restaurants', () => {
    expect(isWorkingCastDocument(doc('Backlot Express'))).toBe(false);
    expect(isWorkingCastDocument(doc("Satu'li Canteen"))).toBe(false);
    expect(isWorkingCastDocument(doc("Crew's Cup Lounge"))).toBe(false);
  });

  it('returns false when the name is absent', () => {
    expect(isWorkingCastDocument(doc(undefined))).toBe(false);
  });
});
