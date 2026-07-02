/**
 * Unit tests for `isPlaceholderDocument` (sync.ts).
 *
 * Disney publishes its park-reservation / park-pass system as
 * `Attraction`-typed Facility_Documents (e.g. "Theme Park Reservation",
 * "Disney Park Pass - Cast Afternoon"). Because their Facility_Type is
 * `attraction`, `classifyFacility` maps them to `Ride`, so without a
 * name-based exclusion dozens of identical bogus "Ride" cards leak into the
 * catalogue. `isPlaceholderDocument` is the pure predicate that identifies
 * these so the sync's normalization step drops them.
 */

import { describe, expect, it } from 'vitest';

import { __internal } from '../sync.js';
import type { FacilityDocument } from '../disney/facilityDoc.js';

const { isPlaceholderDocument } = __internal;

function doc(name: string | undefined): FacilityDocument {
  const base: FacilityDocument = { id: '1;entityType=Attraction', type: 'attraction' };
  return name !== undefined ? { ...base, name } : base;
}

describe('isPlaceholderDocument', () => {
  it('matches the park-reservation placeholder', () => {
    expect(isPlaceholderDocument(doc('Theme Park Reservation'))).toBe(true);
  });

  it('matches Disney Park Pass variants', () => {
    expect(isPlaceholderDocument(doc('Disney Park Pass - Cast Afternoon'))).toBe(
      true,
    );
    expect(isPlaceholderDocument(doc('Disney Park Pass'))).toBe(true);
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(isPlaceholderDocument(doc('  theme park reservation  '))).toBe(true);
    expect(isPlaceholderDocument(doc('THEME PARK RESERVATION'))).toBe(true);
  });

  it('does not match real attractions', () => {
    expect(isPlaceholderDocument(doc('Big Thunder Mountain Railroad'))).toBe(
      false,
    );
    expect(isPlaceholderDocument(doc('Avatar Flight of Passage'))).toBe(false);
    expect(isPlaceholderDocument(doc('African Lions - Disney Animals'))).toBe(
      false,
    );
  });

  it('does not match a name that merely contains the phrase later on', () => {
    expect(
      isPlaceholderDocument(doc('The Theme Park Reservation Experience')),
    ).toBe(false);
  });

  it('returns false when the name is absent', () => {
    expect(isPlaceholderDocument(doc(undefined))).toBe(false);
  });
});
