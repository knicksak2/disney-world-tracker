// Feature: disney-world-tracker, Property 10: rating state has at most one entry, validates 1..10 integers, replaces and removes correctly
/**
 * Property-based test for the Rating state machine (task 10.6).
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 *
 * Design Property 10 (design.md → Correctness Properties → "Rating state
 * machine and validator"):
 *
 *   For any `(User, Experience)` pair and any sequence of rating
 *   `set(value)` and `remove()` operations, the stored state contains at
 *   most one rating; after a successful `set(v)` with `v` an integer in
 *   `1..10` the stored value equals `v`; `set(v)` for non-integer or
 *   out-of-range `v` is rejected and the prior state is unchanged;
 *   `remove()` after `set(v)` returns the state to no-rating.
 *
 * Test strategy: a `fast-check` `commands`-style state-machine test driven
 * over the real `createRatingRepo` factory (task 10.2) backed by a tiny
 * in-memory fake `pg.Pool` whose only state is a single
 * `(user_id, experience_id) -> value` row. The fake pool dispatches the
 * five SQL fragments the repo emits — `BEGIN`, `SELECT ... FOR UPDATE`,
 * the `INSERT ... ON CONFLICT` UPSERT, `DELETE ... `, and `COMMIT` /
 * `ROLLBACK` — to a Map-backed transactional layer so the property is
 * truly exercising the production code path rather than a bespoke
 * imitation of it.
 *
 * Three commands cover the full transition space:
 *
 *   - `SetValid(int 1..10)`        — must accept and emit one
 *                                   `RatingChanged{oldValue, newValue}`
 *                                   event (R4.1, R4.3, R4.5, R4.6).
 *   - `SetInvalid(out-of-range or  — must reject with
 *      non-integer)                  `rating_out_of_range`, leave the
 *                                   state untouched, and emit no event
 *                                   (R4.7).
 *   - `Remove`                     — must succeed when a rating exists
 *                                   (emit `{oldValue, newValue: null}`),
 *                                   and reject with `rating_not_found`
 *                                   when no rating exists, in either
 *                                   case leaving the model invariant
 *                                   "at most one rating" intact (R4.4,
 *                                   R4.8).
 *
 * R4.5 and R4.6 are covered by the per-command assertion that the
 * recording emitter sees exactly one new event with the expected
 * `(oldValue, newValue)` pair on every successful state change, and zero
 * new events on every rejected operation.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import { AppError } from '../../../../errors/AppError.js';
import {
  createRatingRepo,
  type RatingChangedEvent,
  type RatingRepo,
} from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 50;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// In-memory fake pg.Pool
// ---------------------------------------------------------------------------

/**
 * Backing store: a single `(user_id, experience_id) -> value` row. The
 * row also carries the most recent `updated_at` so the repo's
 * `RETURNING updated_at` clause has something to return. We model the
 * `(user_id, experience_id)` composite primary key by using the pair as
 * the Map key — encoding R4.2's "at most one rating per User per
 * Experience" structurally so a buggy repo cannot create a duplicate.
 */
interface RatingsRow {
  readonly value: number;
  readonly updatedAt: Date;
}

interface RatingsStore {
  readonly rows: Map<string, RatingsRow>;
}

function rowKey(userId: string, experienceId: string): string {
  return `${userId}\u0000${experienceId}`;
}

/**
 * Per-transaction snapshot. `setRating`/`removeRating` each open one
 * transaction, mutate inside it, and either COMMIT (publishing the
 * snapshot back to `RatingsStore`) or ROLLBACK (discarding it). This
 * mirrors the actual semantics the repo relies on for its emit-after-
 * commit invariant.
 */
interface Tx {
  rows: Map<string, RatingsRow>;
}

interface FakeClient {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[] }>;
  release(): void;
}

/** The minimal `pg.Pool` shape the repo touches. */
interface FakePool {
  connect(): Promise<FakeClient>;
}

/**
 * Build a fake pool whose `connect()` hands out clients backed by a
 * shared `RatingsStore`. Each client carries its own per-transaction
 * snapshot; COMMIT atomically writes the snapshot back to the store
 * and ROLLBACK discards it. This is enough fidelity for the SQL
 * fragments the rating repo emits.
 */
function makeFakePool(store: RatingsStore): FakePool {
  return {
    async connect(): Promise<FakeClient> {
      let tx: Tx | null = null;
      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<{ rows: unknown[] }> {
          const trimmed = text.trim();
          // ---- transaction control ---------------------------------
          if (trimmed.startsWith('BEGIN')) {
            tx = { rows: new Map(store.rows) };
            return { rows: [] };
          }
          if (trimmed.startsWith('COMMIT')) {
            if (tx === null) {
              throw new Error('COMMIT without BEGIN');
            }
            store.rows.clear();
            for (const [k, v] of tx.rows) {
              store.rows.set(k, v);
            }
            tx = null;
            return { rows: [] };
          }
          if (trimmed.startsWith('ROLLBACK')) {
            tx = null;
            return { rows: [] };
          }

          // Outside a transaction the repo does not issue data-plane
          // statements; if it does, fail loudly so the test surfaces
          // the regression.
          if (tx === null) {
            throw new Error(
              `data-plane query without BEGIN: ${trimmed.slice(0, 64)}`,
            );
          }

          // ---- SELECT value FROM ratings ... FOR UPDATE -----------
          if (
            trimmed.startsWith('SELECT value FROM ratings') &&
            trimmed.includes('FOR UPDATE')
          ) {
            const [userId, experienceId] = readPair(params);
            const row = tx.rows.get(rowKey(userId, experienceId));
            return {
              rows: row === undefined ? [] : [{ value: row.value }],
            };
          }

          // ---- INSERT INTO ratings ... ON CONFLICT ... -----------
          if (trimmed.startsWith('INSERT INTO ratings')) {
            const userId = String(params[0]);
            const experienceId = String(params[1]);
            const value = Number(params[2]);
            const updatedAt = new Date();
            tx.rows.set(rowKey(userId, experienceId), {
              value,
              updatedAt,
            });
            return { rows: [{ updated_at: updatedAt }] };
          }

          // ---- DELETE FROM ratings -------------------------------
          if (trimmed.startsWith('DELETE FROM ratings')) {
            const [userId, experienceId] = readPair(params);
            tx.rows.delete(rowKey(userId, experienceId));
            return { rows: [] };
          }

          throw new Error(
            `unhandled SQL in fake pool: ${trimmed.slice(0, 64)}`,
          );
        },
        release(): void {
          // No-op; matches `pg.PoolClient.release()` semantics. If a
          // caller forgets to COMMIT/ROLLBACK we drop the snapshot.
          tx = null;
        },
      };
    },
  };
}

function readPair(
  params: ReadonlyArray<unknown>,
): readonly [string, string] {
  return [String(params[0]), String(params[1])];
}

// ---------------------------------------------------------------------------
// Recording emitter
// ---------------------------------------------------------------------------

interface Recorder {
  readonly events: RatingChangedEvent[];
  readonly emit: (evt: RatingChangedEvent) => Promise<void>;
}

function makeRecorder(): Recorder {
  const events: RatingChangedEvent[] = [];
  return {
    events,
    emit: async (evt: RatingChangedEvent) => {
      events.push(evt);
    },
  };
}

// ---------------------------------------------------------------------------
// Model and Real
// ---------------------------------------------------------------------------

interface Model {
  /** The single allowed entry per (user, experience). `null` means absent. */
  current: number | null;
  /** Number of `RatingChanged` events the model expects to have observed. */
  emittedCount: number;
}

interface Real {
  store: RatingsStore;
  recorder: Recorder;
  repo: RatingRepo;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `SetValid(value)`: integer in `1..10`. Must succeed; the model's
 * `current` becomes `value` and exactly one new event is emitted with
 * `{oldValue: priorModelCurrent, newValue: value}` (R4.1, R4.3, R4.5,
 * R4.6).
 */
class SetValidCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly value: number) {}
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const prior = m.current;
    const result = await r.repo.setRating(USER_ID, EXPERIENCE_ID, this.value);

    if (result.value !== this.value) {
      throw new Error(
        `setRating returned wrong value: expected=${this.value}, got=${result.value}`,
      );
    }
    if (result.previousValue !== prior) {
      throw new Error(
        `setRating returned wrong previousValue: expected=${String(prior)}, got=${String(result.previousValue)}`,
      );
    }

    m.current = this.value;

    // The store must hold exactly one row matching the model.
    assertStoreMatchesModel(r.store, m);

    // Exactly one new event must have been emitted with the right pair.
    m.emittedCount += 1;
    if (r.recorder.events.length !== m.emittedCount) {
      throw new Error(
        `expected ${m.emittedCount} emitted events, got ${r.recorder.events.length}`,
      );
    }
    const last = r.recorder.events[r.recorder.events.length - 1]!;
    if (
      last.experienceId !== EXPERIENCE_ID ||
      last.oldValue !== prior ||
      last.newValue !== this.value
    ) {
      throw new Error(
        `unexpected RatingChanged event: ${JSON.stringify(last)}; expected oldValue=${String(prior)}, newValue=${this.value}`,
      );
    }
  }
  toString(): string {
    return `SetValid(${this.value})`;
  }
}

/**
 * `SetInvalid(value)`: non-integer or out-of-range. Must throw
 * `AppError('rating_out_of_range', ...)`. The store and the model must
 * be unchanged and no new event must be emitted (R4.7).
 */
class SetInvalidCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly value: number) {}
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const priorEventCount = r.recorder.events.length;
    let threw: unknown = null;
    try {
      await r.repo.setRating(USER_ID, EXPERIENCE_ID, this.value);
    } catch (err) {
      threw = err;
    }
    if (!(threw instanceof AppError)) {
      throw new Error(
        `expected AppError on invalid rating ${this.value}, got ${String(threw)}`,
      );
    }
    if (threw.code !== 'rating_out_of_range') {
      throw new Error(
        `expected code 'rating_out_of_range', got '${threw.code}' for value ${this.value}`,
      );
    }

    // Model and store unchanged.
    assertStoreMatchesModel(r.store, m);
    if (r.recorder.events.length !== priorEventCount) {
      throw new Error(
        `invalid set leaked an event: events=${r.recorder.events.length}, expected=${priorEventCount}`,
      );
    }
    if (r.recorder.events.length !== m.emittedCount) {
      throw new Error(
        `event count drift after rejected set: events=${r.recorder.events.length}, model=${m.emittedCount}`,
      );
    }
  }
  toString(): string {
    return `SetInvalid(${this.value})`;
  }
}

/**
 * `Remove`: when a rating exists, must succeed and emit
 * `{oldValue, newValue: null}`; when no rating exists, must throw
 * `AppError('rating_not_found', ...)` and emit nothing (R4.4, R4.8).
 */
class RemoveCommand implements fc.AsyncCommand<Model, Real> {
  check(_m: Readonly<Model>): boolean {
    return true;
  }
  async run(m: Model, r: Real): Promise<void> {
    const prior = m.current;
    const priorEventCount = r.recorder.events.length;

    if (prior === null) {
      let threw: unknown = null;
      try {
        await r.repo.removeRating(USER_ID, EXPERIENCE_ID);
      } catch (err) {
        threw = err;
      }
      if (!(threw instanceof AppError)) {
        throw new Error(
          `expected AppError on remove of missing rating, got ${String(threw)}`,
        );
      }
      if (threw.code !== 'rating_not_found') {
        throw new Error(
          `expected code 'rating_not_found', got '${threw.code}'`,
        );
      }
      // No state change, no event.
      assertStoreMatchesModel(r.store, m);
      if (r.recorder.events.length !== priorEventCount) {
        throw new Error(
          `rejected remove leaked an event: events=${r.recorder.events.length}, expected=${priorEventCount}`,
        );
      }
      return;
    }

    const result = await r.repo.removeRating(USER_ID, EXPERIENCE_ID);
    if (result.previousValue !== prior) {
      throw new Error(
        `removeRating returned wrong previousValue: expected=${prior}, got=${result.previousValue}`,
      );
    }

    m.current = null;
    assertStoreMatchesModel(r.store, m);

    m.emittedCount += 1;
    if (r.recorder.events.length !== m.emittedCount) {
      throw new Error(
        `expected ${m.emittedCount} emitted events after remove, got ${r.recorder.events.length}`,
      );
    }
    const last = r.recorder.events[r.recorder.events.length - 1]!;
    if (
      last.experienceId !== EXPERIENCE_ID ||
      last.oldValue !== prior ||
      last.newValue !== null
    ) {
      throw new Error(
        `unexpected RatingChanged event on remove: ${JSON.stringify(last)}; expected oldValue=${prior}, newValue=null`,
      );
    }
  }
  toString(): string {
    return 'Remove';
  }
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * R4.2: at most one rating per `(user, experience)`. The Map encoding
 * makes that structurally true; this assertion also pins the row's
 * value to the model's `current` so a silently-buggy UPSERT cannot drift.
 */
function assertStoreMatchesModel(store: RatingsStore, m: Readonly<Model>): void {
  if (store.rows.size > 1) {
    throw new Error(
      `R4.2 violation: store contains ${store.rows.size} rows, expected at most 1`,
    );
  }
  const row = store.rows.get(rowKey(USER_ID, EXPERIENCE_ID));
  if (m.current === null) {
    if (row !== undefined) {
      throw new Error(
        `model expects no rating but store has value=${row.value}`,
      );
    }
  } else {
    if (row === undefined) {
      throw new Error(
        `model expects value=${m.current} but store has no row`,
      );
    }
    if (row.value !== m.current) {
      throw new Error(
        `model.current=${m.current} but store.value=${row.value}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Command arbitraries
// ---------------------------------------------------------------------------

const validRatingArb = fc.integer({ min: 1, max: 10 });

/**
 * Out-of-range or non-integer values. The constants seed the boundary
 * points (0 and 11 are the immediate neighbors of the 1..10 window;
 * non-integers and special floats exercise R4.7's "non-integer"
 * branch); `fc.integer` and `fc.float` rounds out the search space.
 */
const invalidRatingArb = fc.oneof(
  fc.constantFrom(
    0,
    11,
    -1,
    100,
    -100,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1.5,
    9.999,
    0.5,
    10.5,
  ),
  fc.integer({ min: -1000, max: 0 }),
  fc.integer({ min: 11, max: 1000 }),
  fc
    .float({ noNaN: true, noDefaultInfinity: true })
    .filter((v) => !Number.isInteger(v) || v < 1 || v > 10),
);

const setValidArb = validRatingArb.map((v) => new SetValidCommand(v));
const setInvalidArb = invalidRatingArb.map((v) => new SetInvalidCommand(v));
const removeArb = fc.constant(new RemoveCommand());

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Rating repo — Property 10: state machine and validator', () => {
  it('upholds at-most-one-entry, 1..10 integer validation, replacement, removal, and event emission', async () => {
    // Bias the distribution toward `SetValid` so most runs spend time
    // in the "rating exists" half of the state machine; `SetInvalid`
    // and `Remove` keep the validator branch and the not-found branch
    // both well-exercised.
    const cmdArb = fc.oneof(
      { weight: 5, arbitrary: setValidArb },
      { weight: 2, arbitrary: setInvalidArb },
      { weight: 3, arbitrary: removeArb },
    );

    await fc.assert(
      fc.asyncProperty(
        fc.commands([cmdArb], { maxCommands: MAX_COMMANDS }),
        async (cmds) => {
          const setup = () => {
            const store: RatingsStore = { rows: new Map() };
            const recorder = makeRecorder();
            const pool = makeFakePool(store);
            const repo = createRatingRepo({
              pool: pool as unknown as Parameters<
                typeof createRatingRepo
              >[0]['pool'],
              emitRatingChanged: recorder.emit,
            });
            const real: Real = { store, recorder, repo };
            const model: Model = { current: null, emittedCount: 0 };
            return { model, real };
          };
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
