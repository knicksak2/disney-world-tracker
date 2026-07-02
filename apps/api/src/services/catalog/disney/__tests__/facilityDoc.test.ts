/**
 * Unit tests for `parseEnterpriseId` and the Facility_Type membership sets.
 *
 * `parseEnterpriseId` is the pure, total, null-on-failure Enterprise_Id parser
 * described in design.md → "3. Facility_Document model and Enterprise_Id". These
 * examples cover well-formed ids, the malformed/empty cases that must yield
 * `null`, and the eligible/non-eligible Facility_Type membership that underpins
 * classification (R4.1). The exhaustive membership property lives in
 * `classifyFacility.prop.test.ts`; here we pin down concrete examples.
 *
 * Validates: Requirements 4.1
 */

import { describe, expect, it } from 'vitest';

import {
  EXPERIENCE_ELIGIBLE_TYPES,
  NON_EXPERIENCE_TYPES,
  parseEnterpriseId,
  RESORT_TYPE,
} from '../facilityDoc.js';

describe('parseEnterpriseId', () => {
  describe('well-formed ids', () => {
    it('parses a canonical Attraction id', () => {
      expect(parseEnterpriseId('80010177;entityType=Attraction')).toEqual({
        numericId: '80010177',
        entityType: 'Attraction',
      });
    });

    it('parses a theme-park id whose entityType contains a hyphen', () => {
      expect(parseEnterpriseId('80007944;entityType=theme-park')).toEqual({
        numericId: '80007944',
        entityType: 'theme-park',
      });
    });

    it('parses a single-digit numeric id', () => {
      expect(parseEnterpriseId('1;entityType=resort')).toEqual({
        numericId: '1',
        entityType: 'resort',
      });
    });

    it('preserves the entityType verbatim, including a trailing semicolon segment', () => {
      // Everything after the first `;entityType=` is captured as the entityType.
      expect(parseEnterpriseId('123;entityType=A;extra=1')).toEqual({
        numericId: '123',
        entityType: 'A;extra=1',
      });
    });
  });

  describe('malformed ids yield null', () => {
    it('returns null when the separator is missing entirely', () => {
      expect(parseEnterpriseId('80010177')).toBeNull();
    });

    it('returns null when the numeric id is non-numeric', () => {
      expect(parseEnterpriseId('abc;entityType=Attraction')).toBeNull();
    });

    it('returns null when the numeric id is absent', () => {
      expect(parseEnterpriseId(';entityType=Attraction')).toBeNull();
    });

    it('returns null when the entityType is empty', () => {
      expect(parseEnterpriseId('80010177;entityType=')).toBeNull();
    });

    it('returns null when the separator key is wrong', () => {
      expect(parseEnterpriseId('80010177;type=Attraction')).toBeNull();
    });

    it('returns null when there is leading whitespace before the numeric id', () => {
      expect(parseEnterpriseId(' 80010177;entityType=Attraction')).toBeNull();
    });

    it('returns null when there is a leading non-digit garbage prefix', () => {
      expect(parseEnterpriseId('x80010177;entityType=Attraction')).toBeNull();
    });
  });

  describe('empty and whitespace ids yield null', () => {
    it('returns null for the empty string', () => {
      expect(parseEnterpriseId('')).toBeNull();
    });

    it('returns null for a whitespace-only string', () => {
      expect(parseEnterpriseId('   ')).toBeNull();
    });
  });

  it('never throws for arbitrary inputs', () => {
    const inputs = ['', ';', '=', ';entityType=', '80010177;entityType=Attraction', 'nonsense'];
    for (const input of inputs) {
      expect(() => parseEnterpriseId(input)).not.toThrow();
    }
  });
});

describe('Facility_Type membership sets', () => {
  const EXPECTED_ELIGIBLE = [
    'attraction',
    'entertainment',
    'restaurant',
    'dinner-show',
    'recreation',
    'recreation-activity',
    'tour',
    'audio-tour',
    'spa',
    'event',
    'dining-event',
  ];

  const EXPECTED_NON_EXPERIENCE = [
    'guest-service',
    'merchandise-facility',
    'transportation',
    'photopass',
    'bus-stop',
    'land',
    'entertainment-venue',
    'resort-area',
    'destination',
    'theme-park',
    'water-park',
    'avatar',
  ];

  it('EXPERIENCE_ELIGIBLE_TYPES contains exactly the Glossary eligible types', () => {
    expect([...EXPERIENCE_ELIGIBLE_TYPES].sort()).toEqual([...EXPECTED_ELIGIBLE].sort());
  });

  it('NON_EXPERIENCE_TYPES contains exactly the Glossary non-experience types', () => {
    expect([...NON_EXPERIENCE_TYPES].sort()).toEqual([...EXPECTED_NON_EXPERIENCE].sort());
  });

  it('classifies each eligible type as a member of the eligible set only', () => {
    for (const type of EXPECTED_ELIGIBLE) {
      expect(EXPERIENCE_ELIGIBLE_TYPES.has(type)).toBe(true);
      expect(NON_EXPERIENCE_TYPES.has(type)).toBe(false);
    }
  });

  it('classifies each non-experience type as a member of the non-experience set only', () => {
    for (const type of EXPECTED_NON_EXPERIENCE) {
      expect(NON_EXPERIENCE_TYPES.has(type)).toBe(true);
      expect(EXPERIENCE_ELIGIBLE_TYPES.has(type)).toBe(false);
    }
  });

  it('keeps the two sets disjoint', () => {
    for (const type of EXPERIENCE_ELIGIBLE_TYPES) {
      expect(NON_EXPERIENCE_TYPES.has(type)).toBe(false);
    }
  });

  it('treats resort as neither eligible nor non-experience (handled as a Resort record)', () => {
    // R4.1 / R6: `resort` is never an Experience but is produced as a Resort
    // record rather than simply excluded, so it belongs to neither set.
    expect(EXPERIENCE_ELIGIBLE_TYPES.has(RESORT_TYPE)).toBe(false);
    expect(NON_EXPERIENCE_TYPES.has(RESORT_TYPE)).toBe(false);
    expect(RESORT_TYPE).toBe('resort');
  });
});
