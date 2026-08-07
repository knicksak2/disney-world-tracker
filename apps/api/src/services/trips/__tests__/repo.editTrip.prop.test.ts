// Feature: trips, Property 5: Editing a Trip changes only the targeted fields
/**
 * Property-based tests for `editTrip` (Trip lifecycle repo, task 5.1).
 *
 * Validates: Requirements 3.1
 *
 * Property 5 (design.md → Correctness Properties):
 *
 *   For any Trip and any valid edit touching a subset of
 *   `{name, description, start_date, end_date}`, a subsequent read returns the
 *   updated values for the touched fields and identical values for every
 *   untouched field.
 *
 * Test design
 * -----------
 * The stateful lifecycle properties run against an **in-memory model of the
 * repo** rather than a live Postgres, mirroring the way `aggregate.prop.test.ts`
 * drives its logic against a reference model so the property runs fast and
 * deterministically (design → Testing Strategy). Here the in-memory model is a
 * tiny fake `pg` pool that understands exactly the four statements `editTrip`
 * issues — `BEGIN`, `SELECT ... FOR UPDATE`, the dynamically-built
 * `UPDATE trips SET ...`, and `COMMIT`/`ROLLBACK`. The **real production
 * `editTrip`** is exercised end-to-end against it (it is reached through the
 * public `createTripRepo` factory), so this test pins the actual repo logic —
 * the partial-field SET assembly, the trimming of `name`, and the merged
 * date-order re-check — not a re-implementation. A thin integration test pins
 * the SQL repo to the same behavior against a real database.
 *
 * The generators only produce **valid** edits (merged `end >= start`, name
 * 1–100 chars after trim, description ≤ 2000) because Property 5 is scoped to
 * valid edits; rejection of invalid input is Property 2's concern. `name`
 * values are generated with surrounding whitespace so the trim-on-write
 * behavior (R3.2) is exercised, and the oracle trims accordingly.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { TripEditInput } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createTripRepo, type TripRepoDeps } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// In-memory model of the Trip repo: a fake `pg` pool for editTrip's statements
// ---------------------------------------------------------------------------

/** Row shape mirroring the `trips` columns `editTrip` reads and writes. */
interface StoredTrip {
  id: string;
  name: string;
  description: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  created_at: string; // ISO-8601
}

/**
 * Build a minimal fake pool backed by an in-memory `Map`. It interprets only
 * the statements `editTrip` issues, applying the dynamically-built `UPDATE`'s
 * `SET` assignments to the stored row exactly as Postgres would. Any other
 * statement throws so an accidental new dependency surfaces immediately.
 */
function makeInMemoryPool(store: Map<string, StoredTrip>): DbPool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function query(text: string, params?: unknown[]): Promise<any> {
    {
      const sql = text.trim();

      if (
        sql.startsWith('BEGIN') ||
        sql.startsWith('COMMIT') ||
        sql.startsWith('ROLLBACK')
      ) {
        return { rows: [], rowCount: 0 };
      }

      // The recorded-Resort-stay read (R19.1). These edit properties never
      // supply `resortIds`, so the stay is always empty and no
      // DELETE/INSERT trip_resorts is issued; the read returns no rows.
      if (sql.startsWith('SELECT') && sql.includes('trip_resorts')) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.startsWith('SELECT')) {
        const id = params?.[0] as string;
        const row = store.get(id);
        return row
          ? { rows: [{ ...row }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.startsWith('UPDATE trips')) {
        const id = params?.[params.length - 1] as string;
        const row = store.get(id);
        if (!row) return { rows: [], rowCount: 0 };

        // Parse only the SET clause (between `SET` and `WHERE`) so the trailing
        // `WHERE id = $N` and `updated_at = now()` are not treated as column
        // assignments. Each `column = $k` maps to the k-th bound parameter.
        const setClause = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
        const updated: StoredTrip = { ...row };
        const assignRe = /(\w+)\s*=\s*\$(\d+)/g;
        let match: RegExpExecArray | null;
        while ((match = assignRe.exec(setClause)) !== null) {
          const column = match[1] as keyof StoredTrip;
          const paramIndex = Number(match[2]) - 1;
          updated[column] = params?.[paramIndex] as string;
        }
        store.set(id, updated);
        return { rows: [{ ...updated }], rowCount: 1 };
      }

      throw new Error(`Unexpected SQL issued by the Trip repo: ${sql}`);
    }
  }

  // Both the direct `pool.query` path (getTripForMember) and the
  // `pool.connect()` transactional path (editTrip) route through `query`.
  const client = { query, release: (): void => {} };

  return {
    query,
    async connect() {
      return client;
    },
  } as unknown as DbPool;
}

/** editTrip never touches the canonical repos; empty stand-ins satisfy the type. */
const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Day offsets from the Unix epoch, rendered to `YYYY-MM-DD` calendar dates. */
const MIN_DAY = 10_000; // ~1997
const MAX_DAY = 30_000; // ~2052

function dayToISO(dayOffset: number): string {
  return new Date(dayOffset * 86_400_000).toISOString().slice(0, 10);
}

/** A non-empty, ≤100-char (after trim) name, optionally wrapped in whitespace. */
const spacesArb = fc.stringMatching(/^ {0,3}$/);
const nameArb = fc
  .tuple(
    spacesArb,
    // Core with no leading/trailing whitespace and 1..100 trimmed length.
    fc
      .string({ minLength: 1, maxLength: 100 })
      .map((s) => {
        const core = s.replace(/\s/g, 'x');
        return core.length === 0 ? 'Trip' : core;
      }),
    spacesArb,
  )
  .map(([lead, core, trail]) => `${lead}${core}${trail}`);

/** Description: any string ≤ 2000 chars (stored verbatim, no trim). */
const descriptionArb = fc.string({ maxLength: 200 });

/** A stored (already-created) Trip: name is stored trimmed, dates well-ordered. */
const storedTripArb = fc
  .record({
    startDay: fc.integer({ min: 12_000, max: 20_000 }),
    span: fc.integer({ min: 0, max: 3_000 }),
    name: nameArb.map((n) => n.trim()),
    description: descriptionArb,
  })
  .map(({ startDay, span, name, description }) => {
    const endDay = startDay + span;
    const stored: StoredTrip = {
      id: `11111111-1111-4111-8111-111111111111`,
      name,
      description,
      start_date: dayToISO(startDay),
      end_date: dayToISO(endDay),
      created_at: '2020-01-02T03:04:05.000Z',
    };
    return { stored, startDay, endDay };
  });

/**
 * A valid date edit for a given stored Trip. Guarantees the merged
 * `{start, end}` still satisfies `end >= start` (R3.6) so the edit is valid by
 * construction: an omitted date falls back to the stored value.
 */
function dateEditArb(startDay: number, endDay: number): fc.Arbitrary<{
  startDate?: string;
  endDate?: string;
}> {
  return fc.oneof(
    // Touch neither date.
    fc.constant({}),
    // Touch start only: new start must be <= stored end.
    fc
      .integer({ min: MIN_DAY, max: endDay })
      .map((d) => ({ startDate: dayToISO(d) })),
    // Touch end only: new end must be >= stored start.
    fc
      .integer({ min: startDay, max: MAX_DAY })
      .map((d) => ({ endDate: dayToISO(d) })),
    // Touch both: any well-ordered pair.
    fc
      .tuple(
        fc.integer({ min: MIN_DAY, max: MAX_DAY }),
        fc.integer({ min: 0, max: 3_000 }),
      )
      .map(([s, sp]) => ({ startDate: dayToISO(s), endDate: dayToISO(s + sp) })),
  );
}

/** A stored Trip paired with a valid edit touching an arbitrary field subset. */
const tripAndEditArb = storedTripArb.chain(({ stored, startDay, endDay }) =>
  fc
    .record({
      includeName: fc.boolean(),
      includeDescription: fc.boolean(),
      dateEdit: dateEditArb(startDay, endDay),
      newName: nameArb,
      newDescription: descriptionArb,
    })
    .map(({ includeName, includeDescription, dateEdit, newName, newDescription }) => {
      const edit: TripEditInput = {
        ...(includeName ? { name: newName } : {}),
        ...(includeDescription ? { description: newDescription } : {}),
        ...dateEdit,
      };
      return { stored, edit };
    }),
);

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('editTrip — Property 5: editing changes only the targeted fields', () => {
  it('touched fields take the new value; untouched fields are unchanged (R3.1)', async () => {
    await fc.assert(
      fc.asyncProperty(tripAndEditArb, async ({ stored, edit }) => {
        const store = new Map<string, StoredTrip>([[stored.id, { ...stored }]]);
        const repo = createTripRepo(makeInMemoryPool(store), NOOP_DEPS);

        const result = await repo.editTrip(stored.id, edit);
        expect(result).not.toBeNull();

        // Independent oracle: touched field → new value (name trimmed per
        // R3.2); untouched field → the originally stored value.
        const expectedName = edit.name !== undefined ? edit.name.trim() : stored.name;
        const expectedDescription =
          edit.description !== undefined ? edit.description : stored.description;
        const expectedStart = edit.startDate ?? stored.start_date;
        const expectedEnd = edit.endDate ?? stored.end_date;

        expect(result!.name).toBe(expectedName);
        expect(result!.description).toBe(expectedDescription);
        expect(result!.startDate).toBe(expectedStart);
        expect(result!.endDate).toBe(expectedEnd);

        // Identity and creation time are never part of an edit.
        expect(result!.id).toBe(stored.id);
        expect(result!.createdAt).toBe(stored.created_at);

        // A subsequent read observes exactly the same values.
        const reread = await repo.getTripForMember(stored.id);
        expect(reread).toEqual(result);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('an untouched field is byte-for-byte identical to its pre-edit value (R3.1)', async () => {
    await fc.assert(
      fc.asyncProperty(tripAndEditArb, async ({ stored, edit }) => {
        const store = new Map<string, StoredTrip>([[stored.id, { ...stored }]]);
        const repo = createTripRepo(makeInMemoryPool(store), NOOP_DEPS);

        const result = await repo.editTrip(stored.id, edit);
        expect(result).not.toBeNull();

        if (edit.name === undefined) expect(result!.name).toBe(stored.name);
        if (edit.description === undefined) {
          expect(result!.description).toBe(stored.description);
        }
        if (edit.startDate === undefined) {
          expect(result!.startDate).toBe(stored.start_date);
        }
        if (edit.endDate === undefined) {
          expect(result!.endDate).toBe(stored.end_date);
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a no-op edit (empty subset) leaves every field unchanged (R3.1)', async () => {
    await fc.assert(
      fc.asyncProperty(storedTripArb, async ({ stored }) => {
        const store = new Map<string, StoredTrip>([[stored.id, { ...stored }]]);
        const repo = createTripRepo(makeInMemoryPool(store), NOOP_DEPS);

        const result = await repo.editTrip(stored.id, {});
        expect(result).not.toBeNull();
        expect(result!.name).toBe(stored.name);
        expect(result!.description).toBe(stored.description);
        expect(result!.startDate).toBe(stored.start_date);
        expect(result!.endDate).toBe(stored.end_date);
        expect(result!.createdAt).toBe(stored.created_at);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------

describe('editTrip — fixed regression examples', () => {
  function seed(): { store: Map<string, StoredTrip>; id: string } {
    const id = '22222222-2222-4222-8222-222222222222';
    const store = new Map<string, StoredTrip>([
      [
        id,
        {
          id,
          name: 'Original',
          description: 'first',
          start_date: '2025-06-10',
          end_date: '2025-06-15',
          created_at: '2020-01-02T03:04:05.000Z',
        },
      ],
    ]);
    return { store, id };
  }

  it('editing only the name leaves description and dates intact (R3.1)', async () => {
    const { store, id } = seed();
    const repo = createTripRepo(makeInMemoryPool(store), NOOP_DEPS);
    const result = await repo.editTrip(id, { name: '  Renamed  ' });
    expect(result).toMatchObject({
      name: 'Renamed', // trimmed (R3.2)
      description: 'first',
      startDate: '2025-06-10',
      endDate: '2025-06-15',
    });
  });

  it('editing only the start date validated against the stored end date (R3.6)', async () => {
    const { store, id } = seed();
    const repo = createTripRepo(makeInMemoryPool(store), NOOP_DEPS);
    const result = await repo.editTrip(id, { startDate: '2025-06-12' });
    expect(result).toMatchObject({
      name: 'Original',
      description: 'first',
      startDate: '2025-06-12',
      endDate: '2025-06-15',
    });
  });

  it('editing description and end date together touches only those fields (R3.1)', async () => {
    const { store, id } = seed();
    const repo = createTripRepo(makeInMemoryPool(store), NOOP_DEPS);
    const result = await repo.editTrip(id, {
      description: 'updated',
      endDate: '2025-06-20',
    });
    expect(result).toMatchObject({
      name: 'Original',
      description: 'updated',
      startDate: '2025-06-10',
      endDate: '2025-06-20',
    });
  });

  it('editing walkingSpeed, earlyEntryEligible, and dayTouringHours persists and returns on read', async () => {
    const { store, id } = seed();
    const repo = createTripRepo(makeInMemoryPool(store), NOOP_DEPS);
    const dayHoursMap = {
      '2025-06-10': {
        startHour: 8,
        endHour: 23,
        useEarlyEntry: true,
        useExtendedEvening: true,
        hasAfterHoursTicket: true,
      },
    };
    const result = await repo.editTrip(id, {
      walkingSpeed: 'fast',
      earlyEntryEligible: true,
      dayTouringHours: dayHoursMap,
    });
    expect(result).toMatchObject({
      name: 'Original',
      walkingSpeed: 'fast',
      earlyEntryEligible: true,
      dayTouringHours: dayHoursMap,
    });

    const readBack = await repo.getTripForMember(id);
    expect(readBack).toMatchObject({
      name: 'Original',
      walkingSpeed: 'fast',
      earlyEntryEligible: true,
      dayTouringHours: dayHoursMap,
    });
  });

  it('returns null when the Trip does not exist', async () => {
    const { store } = seed();
    const repo = createTripRepo(makeInMemoryPool(store), NOOP_DEPS);
    const result = await repo.editTrip('33333333-3333-4333-8333-333333333333', {
      name: 'Nope',
    });
    expect(result).toBeNull();
  });
});
