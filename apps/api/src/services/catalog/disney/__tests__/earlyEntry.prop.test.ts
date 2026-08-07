/**
 * Property + unit tests for the Early Entry participation derivation
 * (disney-facilities-catalog-source Property 25).
 *
 * Validates: Requirements 5.8, 5.9
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  classifySpecialHours,
  operatesDuringEarlyEntry,
  specialHoursByFacility,
  type ScheduleBlock,
} from '../earlyEntry.js';

const EARLY_ENTRY_RAW = [
  'EARLY_ENTRY',
  'Early Entry',
  'early-entry',
  'EARLY_PARK_ENTRY',
  'Early Park Entry',
  'EXTRA_MAGIC_HOURS',
  'Extra Magic Hours',
  'extra-magic-hour',
];

const NON_EARLY_RAW = [
  'OPERATING',
  'Operating',
  'EXTENDED_EVENING',
  'Extended Evening Hours',
  'SPECIAL_TICKETED_EVENT',
  'Ticketed Event',
  '',
  '   ',
];

describe('operatesDuringEarlyEntry (Property 25)', () => {
  it('is TRUE for any recognized early-entry / extra-magic morning type', () => {
    for (const type of EARLY_ENTRY_RAW) {
      expect(operatesDuringEarlyEntry([{ type }])).toBe(true);
    }
  });

  it('honors the real `scheduleType` field (as returned by the Sync Gateway)', () => {
    // Mirrors a real wdw.today.1_0.Attraction block (verified against the gateway).
    expect(
      operatesDuringEarlyEntry([
        { scheduleType: 'Early Entry' },
        { scheduleType: 'Operating' },
        { scheduleType: 'Special Ticketed Event' },
      ]),
    ).toBe(true);
    expect(
      operatesDuringEarlyEntry([{ scheduleType: 'Operating' }, { scheduleType: 'Closed' }]),
    ).toBe(false);
  });

  it('is FALSE for operating / evening / ticketed / blank types', () => {
    for (const type of NON_EARLY_RAW) {
      expect(operatesDuringEarlyEntry([{ type }])).toBe(false);
    }
  });

  it('is FALSE (total) for an empty, null, or undefined block list', () => {
    expect(operatesDuringEarlyEntry([])).toBe(false);
    expect(operatesDuringEarlyEntry(null)).toBe(false);
    expect(operatesDuringEarlyEntry(undefined)).toBe(false);
  });

  it('classifySpecialHours classifies all three windows from scheduleType', () => {
    // Verified live: Early Entry + Special Ticketed Event; Extended Evening token
    // matched defensively (not observed live).
    expect(
      classifySpecialHours([
        { scheduleType: 'Early Entry' },
        { scheduleType: 'Operating' },
        { scheduleType: 'Special Ticketed Event' },
      ]),
    ).toEqual({ earlyEntry: true, extendedEvening: false, ticketedEvent: true });

    expect(classifySpecialHours([{ scheduleType: 'Extended Evening' }])).toEqual({
      earlyEntry: false,
      extendedEvening: true,
      ticketedEvent: false,
    });

    expect(classifySpecialHours([{ scheduleType: 'Operating' }, { scheduleType: 'Closed' }])).toEqual({
      earlyEntry: false,
      extendedEvening: false,
      ticketedEvent: false,
    });
  });

  it('specialHoursByFacility parses the real `facilities` map shape', () => {
    // Shape verified against the live wdw.today.1_0.Attraction document.
    const facilities = {
      '80010190;entityType=Attraction': [
        { scheduleType: 'Early Entry', facilityId: '80010190;entityType=Attraction' },
        { scheduleType: 'Operating' },
      ],
      '80010110;entityType=Attraction': [
        { scheduleType: 'Operating' },
        { scheduleType: 'Special Ticketed Event' },
      ],
      '16767284;entityType=Attraction': [{ scheduleType: 'Early Entry' }],
    };
    const byId = specialHoursByFacility(facilities);
    expect(byId.get('80010190;entityType=Attraction')).toEqual({ earlyEntry: true, extendedEvening: false, ticketedEvent: false });
    expect(byId.get('80010110;entityType=Attraction')).toEqual({ earlyEntry: false, extendedEvening: false, ticketedEvent: true });
    expect(byId.get('16767284;entityType=Attraction')).toEqual({ earlyEntry: true, extendedEvening: false, ticketedEvent: false });
  });

  it('specialHoursByFacility is total for malformed input', () => {
    expect(specialHoursByFacility(undefined).size).toBe(0);
    expect(specialHoursByFacility(null).size).toBe(0);
    expect(specialHoursByFacility([]).size).toBe(0);
    expect(specialHoursByFacility('nope').size).toBe(0);
    // A non-array value for a facility is skipped, not crashed on.
    expect(specialHoursByFacility({ x: 'not-an-array' }).size).toBe(0);
  });

  // Feature: disney-facilities-catalog-source, Property 25: early-entry derivation
  it('Property 25: TRUE iff at least one block normalizes to an early-entry type', () => {
    const earlyArb = fc.constantFrom(...EARLY_ENTRY_RAW);
    const otherArb = fc.oneof(
      fc.constantFrom(...NON_EARLY_RAW),
      fc.string(),
    );
    const blockArb: fc.Arbitrary<ScheduleBlock> = fc.oneof(
      earlyArb.map((type) => ({ type })),
      otherArb.map((type) => ({ type })),
      fc.constant({} as ScheduleBlock), // block with no type
    );

    fc.assert(
      fc.property(fc.array(blockArb, { maxLength: 8 }), (blocks) => {
        const norm = (s: string) => s.trim().toUpperCase().replace(/[\s-]+/g, '_');
        const earlySet = new Set([
          'EARLY_ENTRY',
          'EARLY_PARK_ENTRY',
          'EXTRA_MAGIC_HOURS',
          'EXTRA_MAGIC_HOUR',
        ]);
        const expected = blocks.some(
          (b) => typeof b.type === 'string' && b.type.trim() !== '' && earlySet.has(norm(b.type)),
        );
        expect(operatesDuringEarlyEntry(blocks)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });
});
