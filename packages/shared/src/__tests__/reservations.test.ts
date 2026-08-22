import { describe, expect, it } from 'vitest';

import {
  CONFIRMATION_NUMBER_MAX,
  PARTY_SIZE_MAX,
  PARTY_SIZE_MIN,
  RESERVATION_KINDS,
  plannedItemAddSchema,
  plannedItemEditSchema,
} from '../index.js';

/** A minimally valid Reservation add body: kind + anchor + venue. */
function reservationBody(overrides: Record<string, unknown> = {}) {
  return {
    experienceId: '11111111-1111-4111-8111-111111111111',
    plannedDate: '2026-10-02',
    plannedTime: '2026-10-02T22:00:00.000Z',
    reservationKind: 'dining' as const,
    ...overrides,
  };
}

describe('Reservation contract — vocabulary (R1.2)', () => {
  it('accepts every kind in RESERVATION_KINDS', () => {
    for (const kind of RESERVATION_KINDS) {
      const parsed = plannedItemAddSchema.safeParse(reservationBody({ reservationKind: kind }));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.reservationKind).toBe(kind);
    }
  });

  it('rejects a kind outside the vocabulary', () => {
    for (const invalid of ['DINING', 'lightninglane', 'adr', '']) {
      expect(plannedItemAddSchema.safeParse(reservationBody({ reservationKind: invalid })).success)
        .toBe(false);
    }
  });

  it('treats an omitted or null kind as an ordinary planned item (R1.3)', () => {
    const omitted = plannedItemAddSchema.safeParse({
      experienceId: '11111111-1111-4111-8111-111111111111',
    });
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data.reservationKind).toBeUndefined();

    // A null kind does NOT require an anchor — it is not a Reservation.
    const explicitNull = plannedItemAddSchema.safeParse({
      experienceId: '11111111-1111-4111-8111-111111111111',
      reservationKind: null,
    });
    expect(explicitNull.success).toBe(true);
    if (explicitNull.success) expect(explicitNull.data.reservationKind).toBeNull();
  });
});

describe('Reservation contract — party size and confirmation number (R1.4, R3.6)', () => {
  it('accepts party size at both bounds and null', () => {
    for (const partySize of [PARTY_SIZE_MIN, PARTY_SIZE_MAX, null]) {
      const parsed = plannedItemAddSchema.safeParse(reservationBody({ partySize }));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.partySize).toBe(partySize);
    }
  });

  it('rejects a party size outside the bounds or non-integer', () => {
    for (const partySize of [PARTY_SIZE_MIN - 1, PARTY_SIZE_MAX + 1, -3, 2.5]) {
      expect(plannedItemAddSchema.safeParse(reservationBody({ partySize })).success).toBe(false);
    }
  });

  it('accepts a confirmation number up to the max length and null', () => {
    const atMax = 'C'.repeat(CONFIRMATION_NUMBER_MAX);
    const parsed = plannedItemAddSchema.safeParse(reservationBody({ confirmationNumber: atMax }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.confirmationNumber).toBe(atMax);

    const cleared = plannedItemAddSchema.safeParse(
      reservationBody({ confirmationNumber: null }),
    );
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.confirmationNumber).toBeNull();
  });

  it('rejects a confirmation number longer than the max, and one that is blank after trimming', () => {
    expect(
      plannedItemAddSchema.safeParse(
        reservationBody({ confirmationNumber: 'C'.repeat(CONFIRMATION_NUMBER_MAX + 1) }),
      ).success,
    ).toBe(false);
    expect(
      plannedItemAddSchema.safeParse(reservationBody({ confirmationNumber: '   ' })).success,
    ).toBe(false);
  });

  it('trims a confirmation number', () => {
    const parsed = plannedItemAddSchema.safeParse(
      reservationBody({ confirmationNumber: '  ABC123  ' }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.confirmationNumber).toBe('ABC123');
  });
});

describe('Reservation contract — anchored to a date and time (R1.5)', () => {
  it('rejects a reservation add with no plannedDate', () => {
    const parsed = plannedItemAddSchema.safeParse(
      reservationBody({ plannedDate: undefined }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes('plannedDate'))).toBe(true);
    }
  });

  it('rejects a reservation add with no plannedTime', () => {
    const parsed = plannedItemAddSchema.safeParse(
      reservationBody({ plannedTime: undefined }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes('plannedTime'))).toBe(true);
    }
  });

  it('rejects a reservation add with an explicitly null anchor', () => {
    expect(plannedItemAddSchema.safeParse(reservationBody({ plannedDate: null })).success)
      .toBe(false);
    expect(plannedItemAddSchema.safeParse(reservationBody({ plannedTime: null })).success)
      .toBe(false);
  });

  it('rejects an edit that sets a kind while clearing the anchor (R1.6)', () => {
    expect(
      plannedItemEditSchema.safeParse({ reservationKind: 'dining', plannedDate: null }).success,
    ).toBe(false);
    expect(
      plannedItemEditSchema.safeParse({ reservationKind: 'dining', plannedTime: null }).success,
    ).toBe(false);
  });

  it('accepts an edit that changes only the booking metadata', () => {
    const parsed = plannedItemEditSchema.safeParse({
      confirmationNumber: 'XYZ987',
      partySize: 6,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.confirmationNumber).toBe('XYZ987');
      expect(parsed.data.partySize).toBe(6);
    }
  });
});

describe('Reservation contract — venue is always named (R5.4)', () => {
  it('accepts a non-catalog reservation with a customTitle and break itemType', () => {
    const parsed = plannedItemAddSchema.safeParse(
      reservationBody({
        experienceId: null,
        itemType: 'break',
        customTitle: 'Off-property steakhouse',
      }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.customTitle).toBe('Off-property steakhouse');
      expect(parsed.data.itemType).toBe('break');
    }
  });

  it('rejects a reservation with neither an experienceId nor a customTitle', () => {
    const parsed = plannedItemAddSchema.safeParse(
      reservationBody({ experienceId: null, itemType: 'break', customTitle: undefined }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes('customTitle'))).toBe(true);
    }
  });
});

describe('Reservation contract — strict schemas reject unknown fields', () => {
  it('rejects a misspelled reservation field rather than silently dropping it', () => {
    expect(
      plannedItemAddSchema.safeParse(reservationBody({ reservation_kind: 'dining' })).success,
    ).toBe(false);
    expect(
      plannedItemAddSchema.safeParse(reservationBody({ confirmationNo: 'ABC' })).success,
    ).toBe(false);
  });
});
