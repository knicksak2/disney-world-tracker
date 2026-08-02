// Feature: trips, Property 3: Creating a Trip establishes the creator as the sole organizer and returns its identity
/**
 * Property-based test for `createTrip` (task 5.2).
 *
 * Validates: Requirements 1.1, 1.2, 1.9
 *
 * Design Property 3 (design.md → Correctness Properties): creating a Trip
 * establishes the creator as the sole Organizer and returns the Trip's
 * identity. Concretely, for any creator and any valid create input, after
 * `createTrip` returns:
 *
 *   - the returned Trip carries a stable, unique `Trip_Identifier` and echoes
 *     the submitted name (trimmed), description (defaulting to `''`), and
 *     dates back to the caller (R1.1, R1.2),
 *   - exactly one Trip_Membership exists for that Trip, and it names the
 *     creator with the Trip_Role `organizer` — so the creator is both the sole
 *     Member and the sole Organizer (R1.1),
 *   - the persisted Trip records the submitting User as its Trip_Creator
 *     (R1.9).
 *
 * Test strategy: a `fast-check` `commands`-style state-machine test driven
 * over the real `createTripRepo` factory (task 5.1) backed by a tiny in-memory
 * fake `pg.Pool` that models the three tables `createTrip` writes in one
 * transaction — `trips`, `trip_memberships`, and `trip_feed_items`. The fake
 * pool dispatches the SQL fragments the repo emits (`BEGIN`, the three
 * `INSERT`s, and `COMMIT` / `ROLLBACK`) to a snapshot-per-transaction layer so
 * the property exercises the production code path rather than a reimplementation
 * of it. Per the tasks.md convention the stateful property runs against this
 * in-memory model; the SQL repo is pinned to the same behaviour by the
 * cross-service integration tests (task 15.x).
 *
 * Each generated `CreateTrip` command asserts the returned DTO and then the
 * global invariant across every Trip created so far: each Trip in the store
 * has exactly one membership — its creator as `organizer` — and every returned
 * `Trip_Identifier` is distinct. `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { TripCreateInput } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import type { CompletionRepo } from '../../tracking/completion/repo.js';
import type { RatingRepo } from '../../tracking/rating/repo.js';
import { createTripRepo, type TripRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 30;

// ---------------------------------------------------------------------------
// In-memory model of the tables createTrip writes
// ---------------------------------------------------------------------------

/** A row of the `trips` table as the repo INSERTs / RETURNs it. */
interface TripRow {
  readonly id: string;
  readonly creatorId: string;
  readonly name: string;
  readonly description: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly createdAt: Date;
}

/** A row of the `trip_memberships` table. */
interface MembershipRow {
  readonly tripId: string;
  readonly userId: string;
  readonly role: string;
}

/** A row of the `trip_feed_items` table (only the columns createTrip writes). */
interface FeedRow {
  readonly tripId: string;
  readonly type: string;
  readonly actorId: string;
}

/**
 * The whole backing store. `createTrip` runs its three writes inside one
 * transaction, so the fake pool takes a snapshot on `BEGIN`, mutates the
 * snapshot, and either publishes it on `COMMIT` or discards it on `ROLLBACK` —
 * mirroring the atomicity the repo relies on (a Trip can never exist without
 * its creator membership and `trip_created` feed item).
 */
interface Store {
  trips: Map<string, TripRow>;
  memberships: MembershipRow[];
  feedItems: FeedRow[];
}

function makeStore(): Store {
  return { trips: new Map(), memberships: [], feedItems: [] };
}

/** A mutable per-transaction snapshot of the store. */
interface Tx {
  trips: Map<string, TripRow>;
  memberships: MembershipRow[];
  feedItems: FeedRow[];
}

interface FakeClient {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[] }>;
  release(): void;
}

/** The minimal `pg.Pool` shape `createTrip` touches (`connect()` only). */
interface FakePool {
  connect(): Promise<FakeClient>;
}

/**
 * Build a fake pool whose `connect()` hands out clients backed by the shared
 * `Store`. Each client owns a per-transaction snapshot; `COMMIT` atomically
 * writes it back and `ROLLBACK` discards it. Only the SQL fragments
 * `createTrip` emits are modelled; anything else fails loudly so a future SQL
 * drift is surfaced by the test rather than silently ignored.
 */
function makeFakePool(store: Store): FakePool {
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
            tx = {
              trips: new Map(store.trips),
              memberships: store.memberships.slice(),
              feedItems: store.feedItems.slice(),
            };
            return { rows: [] };
          }
          if (trimmed.startsWith('COMMIT')) {
            if (tx === null) {
              throw new Error('COMMIT without BEGIN');
            }
            store.trips = new Map(tx.trips);
            store.memberships = tx.memberships.slice();
            store.feedItems = tx.feedItems.slice();
            tx = null;
            return { rows: [] };
          }
          if (trimmed.startsWith('ROLLBACK')) {
            tx = null;
            return { rows: [] };
          }

          if (tx === null) {
            throw new Error(
              `data-plane query without BEGIN: ${trimmed.slice(0, 64)}`,
            );
          }

          // ---- INSERT INTO trip_memberships ... 'organizer' -------
          if (trimmed.startsWith('INSERT INTO trip_memberships')) {
            const tripId = String(params[0]);
            const userId = String(params[1]);
            // Role is a SQL literal ('organizer') in the repo, not a param.
            tx.memberships.push({ tripId, userId, role: 'organizer' });
            return { rows: [] };
          }

          // ---- INSERT INTO trip_feed_items ... 'trip_created' -----
          if (trimmed.startsWith('INSERT INTO trip_feed_items')) {
            const tripId = String(params[0]);
            const actorId = String(params[1]);
            tx.feedItems.push({ tripId, type: 'trip_created', actorId });
            return { rows: [] };
          }

          // ---- INSERT INTO trips ... RETURNING ... ----------------
          if (trimmed.startsWith('INSERT INTO trips')) {
            const creatorId = String(params[0]);
            const name = String(params[1]);
            const description = String(params[2]);
            const startDate = String(params[3]);
            const endDate = String(params[4]);
            const id = randomUUID();
            const createdAt = new Date();
            const row: TripRow = {
              id,
              creatorId,
              name,
              description,
              startDate,
              endDate,
              createdAt,
            };
            tx.trips.set(id, row);
            return {
              rows: [
                {
                  id,
                  name,
                  description,
                  start_date: startDate,
                  end_date: endDate,
                  created_at: createdAt,
                },
              ],
            };
          }

          throw new Error(
            `unhandled SQL in fake pool: ${trimmed.slice(0, 64)}`,
          );
        },
        release(): void {
          // Drop any un-committed snapshot, matching PoolClient.release().
          tx = null;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Stub canonical repos (createTrip never touches them; the factory requires
// them, and later log/confirm operations will use them).
// ---------------------------------------------------------------------------

function makeUnusedCompletionRepo(): CompletionRepo {
  const fail = (): never => {
    throw new Error('createTrip must not touch the canonical Completion repo');
  };
  return {
    mark: fail,
    edit: fail,
    getCompletion: fail,
    unmark: fail,
  } as unknown as CompletionRepo;
}

function makeUnusedRatingRepo(): RatingRepo {
  const fail = (): never => {
    throw new Error('createTrip must not touch the canonical Rating repo');
  };
  return {
    setRating: fail,
    removeRating: fail,
    getRating: fail,
  } as unknown as RatingRepo;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Render a day offset from the Unix epoch to a `YYYY-MM-DD` calendar date. */
function dayToISO(dayOffset: number): string {
  return new Date(dayOffset * 86_400_000).toISOString().slice(0, 10);
}

/** Day offsets spanning roughly 1990 .. 2059 — ample range for real dates. */
const dayArb = fc.integer({ min: 7_305, max: 32_873 });

/**
 * A valid create input: a name that trims to a non-empty 1–100 char value
 * (padded with arbitrary surrounding whitespace to exercise the repo's trim),
 * an optional description, and a `end >= start` date pair.
 */
const createInputArb: fc.Arbitrary<TripCreateInput> = fc
  .record({
    core: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => /\S/u.test(s)),
    leftPad: fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { maxLength: 3 }),
    rightPad: fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { maxLength: 3 }),
    description: fc.option(fc.string({ maxLength: 2000 }), { nil: undefined }),
    d1: dayArb,
    d2: dayArb,
  })
  .map(({ core, leftPad, rightPad, description, d1, d2 }) => {
    const [startDay, endDay] = d1 <= d2 ? [d1, d2] : [d2, d1];
    return {
      name: `${leftPad}${core}${rightPad}`,
      ...(description === undefined ? {} : { description }),
      startDate: dayToISO(startDay),
      endDate: dayToISO(endDay),
    } satisfies TripCreateInput;
  });

const creatorIdArb = fc.uuid();

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface Model {
  /** Trip_Identifiers returned so far; used to assert global uniqueness. */
  readonly createdIds: Set<string>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
}

/**
 * Global invariant, re-checked after every create: every Trip in the store has
 * exactly one membership, naming its creator as `organizer`, and holds exactly
 * one `trip_created` feed item authored by that creator.
 */
function assertSoleOrganizerInvariant(store: Store): void {
  for (const [tripId, trip] of store.trips) {
    const memberships = store.memberships.filter((m) => m.tripId === tripId);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toEqual({
      tripId,
      userId: trip.creatorId,
      role: 'organizer',
    });

    const feed = store.feedItems.filter(
      (f) => f.tripId === tripId && f.type === 'trip_created',
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]?.actorId).toBe(trip.creatorId);
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * `CreateTrip(creatorId, input)`: create a Trip and assert Property 3 holds —
 * the returned identity is fresh and echoes the input, the creator is the sole
 * Organizer of the new Trip, and the persisted Trip records the creator.
 */
class CreateTripCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly creatorId: string,
    public readonly input: TripCreateInput,
  ) {}

  check(_m: Readonly<Model>): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const dto = await r.repo.createTrip(this.creatorId, this.input);

    // Identity: a Trip_Identifier is returned and is globally unique (R1.1).
    expect(typeof dto.id).toBe('string');
    expect(dto.id.length).toBeGreaterThan(0);
    expect(m.createdIds.has(dto.id)).toBe(false);

    // The returned Trip echoes the submitted fields (R1.1, R1.2): the name is
    // stored trimmed, the description defaults to '' when omitted.
    expect(dto.name).toBe(this.input.name.trim());
    expect(dto.description).toBe(this.input.description ?? '');
    expect(dto.startDate).toBe(this.input.startDate);
    expect(dto.endDate).toBe(this.input.endDate);

    // The persisted Trip records the submitting User as its Trip_Creator (R1.9).
    const trip = r.store.trips.get(dto.id);
    expect(trip).toBeDefined();
    expect(trip?.creatorId).toBe(this.creatorId);

    // The creator is the sole Member and sole Organizer of the new Trip (R1.1).
    const memberships = r.store.memberships.filter((x) => x.tripId === dto.id);
    expect(memberships).toEqual([
      { tripId: dto.id, userId: this.creatorId, role: 'organizer' },
    ]);

    m.createdIds.add(dto.id);

    // Creating another Trip never disturbs the sole-organizer invariant of any
    // previously created Trip.
    assertSoleOrganizerInvariant(r.store);
  }

  toString(): string {
    return `CreateTrip(${this.creatorId.slice(0, 8)}, ${JSON.stringify(this.input)})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('createTrip — Property 3: creator is the sole organizer and identity is returned', () => {
  it('establishes the creator as the sole organizer and returns a fresh identity for any sequence of creates', async () => {
    const commandArb = fc
      .tuple(creatorIdArb, createInputArb)
      .map(([creatorId, input]) => new CreateTripCommand(creatorId, input));

    await fc.assert(
      fc.asyncProperty(
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (cmds) => {
          const store = makeStore();
          const repo = createTripRepo(makeFakePool(store) as unknown as DbPool, {
            completions: makeUnusedCompletionRepo(),
            ratings: makeUnusedRatingRepo(),
          });
          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: { createdIds: new Set<string>() },
            real: { store, repo },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
