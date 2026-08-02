// Feature: trips, Property 2: Trip name/description/date input is validated identically on create and edit
/**
 * Property-based tests for the shared Trip input schemas (`tripCreateSchema`
 * and `tripEditSchema`).
 *
 * Property 2 (design.md → Correctness Properties):
 *
 *   For any create or edit input, the request is rejected without persisting
 *   or changing any field when a required field is missing (create), the
 *   Trip_Name is empty after trimming or longer than 100 characters, the
 *   Trip_Description exceeds 2000 characters, a date is not a valid calendar
 *   date, or the Trip_End_Date is earlier than the Trip_Start_Date; otherwise
 *   it is accepted with the Trip_Name stored trimmed of leading and trailing
 *   whitespace.
 *
 * The core of the property is that the field-content rules for Trip_Name,
 * Trip_Description, and the two dates are enforced *identically* on create and
 * edit. The only intended asymmetry is presence: create requires
 * `{name, startDate, endDate}` while edit treats every field as optional.
 *
 * Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 3.2, 3.4, 3.5, 3.6
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  TRIP_RESORT_LIMIT,
  tripCreateSchema,
  tripEditSchema,
} from '../trips.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** A single non-whitespace, printable character. */
const visibleCharArb = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%'.split(
    '',
  ),
);

/** A run of visible characters of a bounded length (never whitespace). */
const visibleStringArb = (minLength: number, maxLength: number) =>
  fc.array(visibleCharArb, { minLength, maxLength }).map((cs) => cs.join(''));

/** Leading/trailing whitespace padding (may be empty). */
const whitespaceArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f'), { maxLength: 5 })
  .map((cs) => cs.join(''));

/**
 * A valid Trip_Name core: 1–100 visible characters. Because it has no leading
 * or trailing whitespace, its trimmed form equals itself.
 */
const validNameCoreArb = visibleStringArb(1, 100);

/**
 * A valid, possibly whitespace-padded Trip_Name paired with the trimmed core
 * the schema is expected to store (R1.3, R3.2).
 */
const validPaddedNameArb = fc
  .tuple(whitespaceArb, validNameCoreArb, whitespaceArb)
  .map(([lead, core, trail]) => ({ raw: `${lead}${core}${trail}`, core }));

/** A valid Trip_Description: any string up to 2000 characters. */
const validDescriptionArb = fc.string({ maxLength: 2000 });

// --- Dates ------------------------------------------------------------------

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const fmtDate = (y: number, m: number, d: number) =>
  `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

/** A valid `YYYY-MM-DD` calendar date (leap years handled by the day bound). */
const validDateArb = fc
  .integer({ min: 1970, max: 2999 })
  .chain((year) =>
    fc.integer({ min: 1, max: 12 }).chain((month) => {
      // Day 0 of the next month is the last day of `month`.
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return fc
        .integer({ min: 1, max: daysInMonth })
        .map((day) => fmtDate(year, month, day));
    }),
  );

/** A valid date pair with `endDate >= startDate` (lexicographic == chrono). */
const validDatePairArb = fc
  .tuple(validDateArb, validDateArb)
  .map(([a, b]) =>
    a <= b ? { startDate: a, endDate: b } : { startDate: b, endDate: a },
  );

/** A date pair that violates the order rule: `endDate < startDate` (R1.8, R3.6). */
const endBeforeStartPairArb = fc
  .tuple(validDateArb, validDateArb)
  .filter(([a, b]) => a !== b)
  .map(([a, b]) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return { startDate: hi, endDate: lo };
  });

/** A string that is not a valid calendar date (R1.7). */
const invalidDateArb = fc.oneof(
  fc.constantFrom(
    '2023-02-30', // Feb never has 30 days
    '2023-13-01', // month 13
    '2023-00-10', // month 0
    '2023-01-32', // day 32
    '2023-01-00', // day 0
    '2021-02-29', // 2021 is not a leap year
    '2023/01/01', // wrong separator
    '20230101', // missing separators
    '2023-1-1', // unpadded
    'not-a-date',
    '',
  ),
  fc.string({ maxLength: 12 }).filter((s) => !/^\d{4}-\d{2}-\d{2}$/u.test(s)),
);

// --- Invalid name / description --------------------------------------------

/** A Trip_Name that violates the content rule (empty-after-trim or too long). */
const invalidNameArb = fc.oneof(
  // Whitespace-only (or empty) -> trims to empty -> min(1) fails (R1.5, R3.4).
  fc
    .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f'), { maxLength: 8 })
    .map((cs) => cs.join('')),
  // Longer than 100 characters after trimming (R1.5, R3.4).
  visibleStringArb(101, 160),
);

/** A Trip_Description longer than 2000 characters (R1.6, R3.5). */
const invalidDescriptionArb = fc
  .integer({ min: 2001, max: 2100 })
  .map((len) => 'x'.repeat(len));

// ---------------------------------------------------------------------------
// Parity helper: a create body (with valid required fields) and an edit body
// that isolate the same single field must agree on acceptance.
// ---------------------------------------------------------------------------

const VALID_BASE = {
  name: 'Valid Trip Name',
  startDate: '2024-01-10',
  endDate: '2024-01-20',
} as const;

function createAccepts(body: unknown): boolean {
  return tripCreateSchema.safeParse(body).success;
}
function editAccepts(body: unknown): boolean {
  return tripEditSchema.safeParse(body).success;
}

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe('Property 2: Trip name/description/date input is validated identically on create and edit', () => {
  it('accepts valid input on both create and edit, storing the Trip_Name trimmed (R1.3, R3.2)', () => {
    fc.assert(
      fc.property(
        validPaddedNameArb,
        validDescriptionArb,
        validDatePairArb,
        ({ raw, core }, description, { startDate, endDate }) => {
          const body = { name: raw, description, startDate, endDate };

          const created = tripCreateSchema.safeParse(body);
          const edited = tripEditSchema.safeParse(body);

          expect(created.success).toBe(true);
          expect(edited.success).toBe(true);
          // Trip_Name is stored trimmed on both paths.
          if (created.success) expect(created.data.name).toBe(core);
          if (edited.success) expect(edited.data.name).toBe(core);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects an invalid Trip_Name identically on create and edit (R1.5, R3.4)', () => {
    fc.assert(
      fc.property(invalidNameArb, (name) => {
        const create = createAccepts({ ...VALID_BASE, name });
        const edit = editAccepts({ name });
        expect(create).toBe(false);
        expect(edit).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects an over-long Trip_Description identically on create and edit (R1.6, R3.5)', () => {
    fc.assert(
      fc.property(invalidDescriptionArb, (description) => {
        const create = createAccepts({ ...VALID_BASE, description });
        const edit = editAccepts({ description });
        expect(create).toBe(false);
        expect(edit).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepts a valid Trip_Description (<=2000 chars) identically on create and edit (R1.6, R3.5)', () => {
    fc.assert(
      fc.property(validDescriptionArb, (description) => {
        const create = createAccepts({ ...VALID_BASE, description });
        const edit = editAccepts({ description });
        expect(create).toBe(true);
        expect(edit).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects an invalid calendar date identically on create and edit (R1.7)', () => {
    fc.assert(
      fc.property(invalidDateArb, fc.boolean(), (badDate, onStart) => {
        // Inject the invalid date into either the start or end position.
        const create = createAccepts(
          onStart
            ? { ...VALID_BASE, startDate: badDate }
            : { ...VALID_BASE, endDate: badDate },
        );
        const edit = editAccepts(
          onStart ? { startDate: badDate } : { endDate: badDate },
        );
        expect(create).toBe(false);
        expect(edit).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects end-before-start identically on create and edit when both dates are supplied (R1.8, R3.6)', () => {
    fc.assert(
      fc.property(endBeforeStartPairArb, ({ startDate, endDate }) => {
        const create = createAccepts({ ...VALID_BASE, startDate, endDate });
        const edit = editAccepts({ startDate, endDate });
        expect(create).toBe(false);
        expect(edit).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepts an ordered date pair identically on create and edit (R1.8, R3.6)', () => {
    fc.assert(
      fc.property(validDatePairArb, ({ startDate, endDate }) => {
        const create = createAccepts({ ...VALID_BASE, startDate, endDate });
        const edit = editAccepts({ startDate, endDate });
        expect(create).toBe(true);
        expect(edit).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('enforces required fields only on create; edit permits omission (R1.4)', () => {
    // The one intended asymmetry: create requires name/startDate/endDate,
    // while edit treats every field as optional.
    const requiredKeyArb = fc.constantFrom(
      'name',
      'startDate',
      'endDate',
    ) as fc.Arbitrary<'name' | 'startDate' | 'endDate'>;

    fc.assert(
      fc.property(requiredKeyArb, (missingKey) => {
        const body: Record<string, unknown> = { ...VALID_BASE };
        delete body[missingKey];

        // Create rejects a missing required field.
        expect(createAccepts(body)).toBe(false);
        // Edit accepts the same body (the field is simply not being changed).
        expect(editAccepts(body)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// resortIds — the Resort(s) a Trip's party stayed at (R21.1)
// ---------------------------------------------------------------------------
//
// resortIds is an optional array of catalog Resort ids, bounded by
// TRIP_RESORT_LIMIT and validated identically on create and edit. Existence /
// active-status of each id is a Trip_Service concern (checked against the
// catalog), not a schema concern; the schema only guards shape and bound.

/** A syntactically valid UUID string the shared uuidSchema accepts. */
const validUuidArb = fc.uuid();

describe('resortIds: the recorded Resort stay is validated identically on create and edit (R21.1)', () => {
  it('accepts an omitted resortIds on both create and edit (the field is optional)', () => {
    expect(createAccepts({ ...VALID_BASE })).toBe(true);
    expect(editAccepts({})).toBe(true);
  });

  it('accepts an empty resortIds (clears the stay on edit) on both schemas', () => {
    expect(createAccepts({ ...VALID_BASE, resortIds: [] })).toBe(true);
    expect(editAccepts({ resortIds: [] })).toBe(true);
  });

  it('accepts up to the limit of valid resort ids identically on create and edit', () => {
    fc.assert(
      fc.property(
        fc.array(validUuidArb, { minLength: 1, maxLength: TRIP_RESORT_LIMIT }),
        (resortIds) => {
          expect(createAccepts({ ...VALID_BASE, resortIds })).toBe(true);
          expect(editAccepts({ resortIds })).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects more than the limit of resort ids identically on create and edit', () => {
    fc.assert(
      fc.property(
        fc.array(validUuidArb, {
          minLength: TRIP_RESORT_LIMIT + 1,
          maxLength: TRIP_RESORT_LIMIT + 10,
        }),
        (resortIds) => {
          expect(createAccepts({ ...VALID_BASE, resortIds })).toBe(false);
          expect(editAccepts({ resortIds })).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a non-UUID entry identically on create and edit', () => {
    fc.assert(
      fc.property(
        fc
          .string({ maxLength: 20 })
          .filter(
            (s) =>
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
                s,
              ),
          ),
        (bad) => {
          expect(createAccepts({ ...VALID_BASE, resortIds: [bad] })).toBe(false);
          expect(editAccepts({ resortIds: [bad] })).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
