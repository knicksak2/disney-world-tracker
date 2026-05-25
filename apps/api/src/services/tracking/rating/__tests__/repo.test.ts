/**
 * Unit tests for the Rating repo (task 10.2).
 *
 * The repo is exercised against a hand-rolled fake `pg.Pool` that
 * captures every `query()` call and routes a small set of canned
 * responses based on a substring match on the SQL text. We never
 * connect to a real database; each test is hermetic and
 * deterministic.
 *
 * Coverage focuses on the requirements scoped to this task:
 *
 *   - R4.1, R4.7  range validation: integer 1..10 only (defense in
 *                 depth even though the route layer's Zod schema is
 *                 the primary guard).
 *   - R4.2        the UPSERT is keyed on (user_id, experience_id) so
 *                 a second set replaces rather than duplicates.
 *   - R4.3        UPDATE on existing — replacement emits the prior
 *                 value as `oldValue` and the new value as
 *                 `newValue`.
 *   - R4.4, R4.8  DELETE removes the row; DELETE on a missing row
 *                 throws `rating_not_found`.
 *   - Domain event: every successful set/delete emits exactly one
 *                 `RatingChanged` event with the correct
 *                 `(oldValue, newValue)` pair, *after* the COMMIT.
 *                 A pre-commit failure must not emit anything.
 */

import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../errors/AppError.js';
import {
  createRatingRepo,
  type RatingChangedEvent,
} from '../repo.js';

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface FakePool {
  readonly calls: FakeCall[];
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[] }>;
  connect(): Promise<{
    query: (
      text: string,
      params?: ReadonlyArray<unknown>,
    ) => Promise<{ rows: unknown[] }>;
    release: () => void;
  }>;
}

/**
 * Build a fake pool whose `responder` is given each captured call and
 * returns either a `{ rows }` object, an `Error` to reject with, or
 * `undefined` to fall back to an empty rows array. Captures call order
 * across both the (unused) top-level `query` and the per-client
 * `connect()` flow used by the repo's transactions.
 */
function makePool(
  responder: (call: FakeCall) => { rows: unknown[] } | Error | undefined,
): FakePool {
  const calls: FakeCall[] = [];
  const run = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: unknown[] }> => {
    const call: FakeCall = { text, params };
    calls.push(call);
    const result = responder(call);
    if (result instanceof Error) {
      throw result;
    }
    return result ?? { rows: [] };
  };
  return {
    calls,
    query: run,
    async connect() {
      return {
        query: run,
        release: () => undefined,
      };
    },
  };
}

/**
 * Recording emitter. Captures every event passed to it so each test
 * can assert the exact `(oldValue, newValue)` pairs in order.
 */
function makeEmitter(): {
  readonly events: RatingChangedEvent[];
  readonly emit: (evt: RatingChangedEvent) => Promise<void>;
} {
  const events: RatingChangedEvent[] = [];
  return {
    events,
    emit: async (evt: RatingChangedEvent) => {
      events.push(evt);
    },
  };
}

// ---------------------------------------------------------------------------
// Common fixtures
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';
const UPDATED_AT = new Date('2024-01-15T12:34:56.000Z');

/**
 * Build a responder that returns the given prior `value` for the
 * SELECT FOR UPDATE step (or no row when `prior === null`), and
 * returns `UPDATED_AT` for the UPSERT RETURNING step.
 */
function uprightResponder(prior: number | null): (call: FakeCall) => {
  rows: unknown[];
} {
  return (call) => {
    if (call.text.includes('SELECT value FROM ratings')) {
      return { rows: prior === null ? [] : [{ value: prior }] };
    }
    if (call.text.includes('INSERT INTO ratings')) {
      return { rows: [{ updated_at: UPDATED_AT }] };
    }
    if (
      call.text.startsWith('BEGIN') ||
      call.text.startsWith('COMMIT') ||
      call.text.startsWith('ROLLBACK') ||
      call.text.startsWith('DELETE FROM ratings')
    ) {
      return { rows: [] };
    }
    return { rows: [] };
  };
}

// ---------------------------------------------------------------------------
// setRating — UPSERT (no prior row)
// ---------------------------------------------------------------------------

describe('Rating repo — setRating', () => {
  it('UPSERTs a new rating, returns previousValue=null, and emits RatingChanged{null, value}', async () => {
    const pool = makePool(uprightResponder(null));
    const emitter = makeEmitter();
    const repo = createRatingRepo({
      pool: pool as unknown as Parameters<typeof createRatingRepo>[0]['pool'],
      emitRatingChanged: emitter.emit,
    });

    const result = await repo.setRating(USER_ID, EXPERIENCE_ID, 7);

    expect(result.experienceId).toBe(EXPERIENCE_ID);
    expect(result.value).toBe(7);
    expect(result.previousValue).toBeNull();
    expect(result.updatedAt).toEqual(UPDATED_AT);

    // SQL trace: BEGIN, SELECT FOR UPDATE, INSERT...ON CONFLICT, COMMIT.
    const texts = pool.calls.map((c) => c.text.trim().split(/\s+/)[0]);
    expect(texts[0]).toBe('BEGIN');
    expect(pool.calls[1]?.text).toContain('SELECT value FROM ratings');
    expect(pool.calls[1]?.text).toContain('FOR UPDATE');
    expect(pool.calls[2]?.text).toContain('INSERT INTO ratings');
    expect(pool.calls[2]?.text).toContain('ON CONFLICT (user_id, experience_id)');
    expect(pool.calls[2]?.params).toEqual([USER_ID, EXPERIENCE_ID, 7]);
    expect(texts.at(-1)).toBe('COMMIT');

    expect(emitter.events).toEqual([
      { experienceId: EXPERIENCE_ID, oldValue: null, newValue: 7 },
    ]);
  });

  // ---- R4.3 replacement -------------------------------------------------

  it('UPDATE on existing — emits RatingChanged{oldValue, newValue} with the prior value', async () => {
    const pool = makePool(uprightResponder(4));
    const emitter = makeEmitter();
    const repo = createRatingRepo({
      pool: pool as unknown as Parameters<typeof createRatingRepo>[0]['pool'],
      emitRatingChanged: emitter.emit,
    });

    const result = await repo.setRating(USER_ID, EXPERIENCE_ID, 9);

    expect(result.previousValue).toBe(4);
    expect(result.value).toBe(9);
    expect(emitter.events).toEqual([
      { experienceId: EXPERIENCE_ID, oldValue: 4, newValue: 9 },
    ]);
  });

  // ---- R4.7 range validation -------------------------------------------

  it.each([
    ['below range', 0],
    ['above range', 11],
    ['negative', -1],
    ['non-integer', 5.5],
    ['NaN', Number.NaN],
  ])('rejects %s with rating_out_of_range and does not emit', async (_label, value) => {
    const pool = makePool(uprightResponder(null));
    const emitter = makeEmitter();
    const repo = createRatingRepo({
      pool: pool as unknown as Parameters<typeof createRatingRepo>[0]['pool'],
      emitRatingChanged: emitter.emit,
    });

    await expect(
      repo.setRating(USER_ID, EXPERIENCE_ID, value),
    ).rejects.toMatchObject({
      code: 'rating_out_of_range',
    });

    // The repo must reject before opening a transaction so an invalid
    // value can never reach the database.
    expect(pool.calls).toEqual([]);
    expect(emitter.events).toEqual([]);
  });

  // ---- emit-after-commit invariant -------------------------------------

  it('does not emit when the transaction fails before COMMIT', async () => {
    const failure = new Error('upsert blew up');
    const pool = makePool((call) => {
      if (call.text.includes('SELECT value FROM ratings')) {
        return { rows: [] };
      }
      if (call.text.includes('INSERT INTO ratings')) {
        return failure;
      }
      return { rows: [] };
    });
    const emitter = makeEmitter();
    const repo = createRatingRepo({
      pool: pool as unknown as Parameters<typeof createRatingRepo>[0]['pool'],
      emitRatingChanged: emitter.emit,
    });

    await expect(
      repo.setRating(USER_ID, EXPERIENCE_ID, 5),
    ).rejects.toBe(failure);

    // No events emitted because the COMMIT never ran.
    expect(emitter.events).toEqual([]);
    // The repo must have rolled back so the connection is returned to
    // the pool in a clean state.
    expect(pool.calls.map((c) => c.text.trim().split(/\s+/)[0])).toContain(
      'ROLLBACK',
    );
  });
});

// ---------------------------------------------------------------------------
// removeRating — DELETE
// ---------------------------------------------------------------------------

describe('Rating repo — removeRating', () => {
  it('DELETEs an existing rating and emits RatingChanged{oldValue, null}', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('SELECT value FROM ratings')) {
        return { rows: [{ value: 6 }] };
      }
      return { rows: [] };
    });
    const emitter = makeEmitter();
    const repo = createRatingRepo({
      pool: pool as unknown as Parameters<typeof createRatingRepo>[0]['pool'],
      emitRatingChanged: emitter.emit,
    });

    const result = await repo.removeRating(USER_ID, EXPERIENCE_ID);

    expect(result.experienceId).toBe(EXPERIENCE_ID);
    expect(result.previousValue).toBe(6);

    // SQL trace: BEGIN, SELECT FOR UPDATE, DELETE, COMMIT.
    const texts = pool.calls.map((c) => c.text.trim().split(/\s+/)[0]);
    expect(texts[0]).toBe('BEGIN');
    expect(pool.calls[1]?.text).toContain('SELECT value FROM ratings');
    expect(pool.calls[2]?.text).toContain('DELETE FROM ratings');
    expect(pool.calls[2]?.params).toEqual([USER_ID, EXPERIENCE_ID]);
    expect(texts.at(-1)).toBe('COMMIT');

    expect(emitter.events).toEqual([
      { experienceId: EXPERIENCE_ID, oldValue: 6, newValue: null },
    ]);
  });

  // ---- R4.8 not-found semantics ----------------------------------------

  it('throws rating_not_found when no row exists, does not DELETE, does not emit', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('SELECT value FROM ratings')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const emitter = makeEmitter();
    const repo = createRatingRepo({
      pool: pool as unknown as Parameters<typeof createRatingRepo>[0]['pool'],
      emitRatingChanged: emitter.emit,
    });

    await expect(
      repo.removeRating(USER_ID, EXPERIENCE_ID),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      repo.removeRating(USER_ID, EXPERIENCE_ID),
    ).rejects.toMatchObject({ code: 'rating_not_found' });

    // No DELETE was issued, and no event was emitted.
    expect(
      pool.calls.some((c) => c.text.includes('DELETE FROM ratings')),
    ).toBe(false);
    expect(emitter.events).toEqual([]);
  });
});
