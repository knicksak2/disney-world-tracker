// Feature: trips, Property 9: Trip lifecycle never mutates canonical Tracking data
/**
 * Property-based test for canonical-Tracking preservation across the Trip
 * lifecycle (task 5.5).
 *
 * Validates: Requirements 3.10, 8.4, 5.7
 *
 * Design Property 9 (design.md → Correctness Properties): the Trip lifecycle
 * operations that tear down Trip state — `deleteTrip` (R3.10), `removeMember`
 * and `leaveTrip` (R8.4), including the sole-Member-leaves cascade delete
 * (R5.7) — never mutate a Trip_Member's canonical Tracking data. Concretely,
 * for any Trip topology and any interleaving of delete / leave / remove
 * operations:
 *
 *   - the repo issues NO write (`INSERT` / `UPDATE` / `DELETE`) — indeed no SQL
 *     at all — against the canonical `completions`, `ratings`, or `notes`
 *     tables; it only ever touches the `trip_*` tables, and
 *   - the injected canonical Tracking repos (the Completion repo and the Rating
 *     repo) are never called, so canonical data cannot be mutated through a
 *     delegated write either.
 *
 * Test strategy
 * -------------
 * A `fast-check` `commands`-style state-machine test driven over the real
 * `createTripRepo` factory (task 5.1) backed by a tiny in-memory fake `pg.Pool`
 * that models exactly the `trip_*` tables the lifecycle operations touch —
 * `trips`, `trip_memberships`, `trip_log_entries`, and `rode_with_tags`. The
 * fake pool dispatches the SQL fragments the repo emits (`DELETE FROM trips`
 * for `deleteTrip`; and, inside a transaction, the membership lock/delete, the
 * pending-tag cancellation `UPDATE`, and the sole-Member cascade `DELETE` for
 * `departMember`) to a snapshot-per-transaction layer, so the property
 * exercises the production code path rather than a re-implementation. Per the
 * tasks.md convention the stateful property runs against this in-memory model;
 * the SQL repo is pinned to the same behaviour by the cross-service
 * integration test (task 15.1).
 *
 * Two independent guards enforce the property:
 *
 *   1. Every SQL string the repo emits (through either `pool.query` or a
 *      transaction client) is inspected: any statement mentioning a canonical
 *      table (`completions` / `ratings` / `notes`) is recorded as a violation.
 *      Any statement the fake does not recognise fails loudly, so a future
 *      canonical write added to a lifecycle path surfaces here rather than
 *      being silently ignored.
 *   2. The injected canonical Completion and Rating repos are stand-ins whose
 *      every method records the call and throws; a single invocation both
 *      records a violation and aborts the operation.
 *
 * After every command the property asserts both guards are still clean and that
 * a seeded canonical snapshot (representative Completions/Ratings/Notes) is
 * byte-for-byte unchanged. The last-organizer / sole-Member outcomes are
 * predicted with the same `violatesLastOrganizer` predicate the repo uses, so
 * the store's Trip state is checked too — but the property's heart is that no
 * matter which lifecycle operations run, canonical Tracking data is inert.
 *
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import type { CompletionRepo } from '../../tracking/completion/repo.js';
import type { RatingRepo } from '../../tracking/rating/repo.js';
import {
  type Membership,
  type TripRole,
  violatesLastOrganizer,
} from '../permissions.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 40;

/** Matches any reference to a canonical Tracking table as a whole word. */
const CANONICAL_TABLE_RE = /\b(completions|ratings|notes)\b/iu;

type TagState = 'pending' | 'confirmed' | 'declined' | 'cancelled';

// ---------------------------------------------------------------------------
// In-memory model of the `trip_*` tables the lifecycle operations touch
// ---------------------------------------------------------------------------

interface MembershipRow {
  readonly tripId: string;
  readonly userId: string;
  role: TripRole;
}

interface LogEntryRow {
  readonly id: string;
  readonly tripId: string;
  readonly memberId: string;
}

interface TagRow {
  readonly id: string;
  readonly logEntryId: string;
  readonly taggedMemberId: string;
  state: TagState;
}

/**
 * A seeded snapshot of the canonical Tracking tables. The repo must never
 * reference these; the property asserts this object is unchanged after every
 * command as a belt-and-braces check alongside the SQL/repo-call guards.
 */
interface CanonicalSnapshot {
  readonly completions: ReadonlyArray<{ userId: string; experienceId: string }>;
  readonly ratings: ReadonlyArray<{ userId: string; experienceId: string; value: number }>;
  readonly notes: ReadonlyArray<{ userId: string; experienceId: string; body: string }>;
}

function seedCanonical(): CanonicalSnapshot {
  return {
    completions: [
      { userId: 'u-alpha', experienceId: 'exp-1' },
      { userId: 'u-bravo', experienceId: 'exp-2' },
    ],
    ratings: [{ userId: 'u-alpha', experienceId: 'exp-1', value: 8 }],
    notes: [{ userId: 'u-bravo', experienceId: 'exp-2', body: 'loved it' }],
  };
}

/** Records property violations discovered by the two guards. */
interface Probe {
  /** SQL statements that referenced a canonical table (must stay empty). */
  readonly canonicalSql: string[];
  /** Canonical-repo method calls (must stay empty). */
  readonly repoCalls: string[];
}

/**
 * The whole backing store: the mutable `trip_*` tables plus the seeded (and
 * expected-immutable) canonical snapshot and the shared {@link Probe}.
 */
interface Store {
  trips: Set<string>;
  memberships: MembershipRow[];
  logEntries: LogEntryRow[];
  tags: TagRow[];
  readonly canonical: CanonicalSnapshot;
  readonly probe: Probe;
}

/** A mutable per-transaction snapshot of the mutable `trip_*` tables. */
interface Tx {
  trips: Set<string>;
  memberships: MembershipRow[];
  logEntries: LogEntryRow[];
  tags: TagRow[];
}

interface FakeClient {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[]; rowCount: number }>;
  release(): void;
}

interface FakePool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[]; rowCount: number }>;
  connect(): Promise<FakeClient>;
}

/** Collapse SQL whitespace so multi-line statements match on a stable prefix. */
function norm(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function cloneMemberships(src: MembershipRow[]): MembershipRow[] {
  return src.map((m) => ({ ...m }));
}

function cloneTags(src: TagRow[]): TagRow[] {
  return src.map((t) => ({ ...t }));
}

/** Record any statement that references a canonical table. */
function inspectForCanonical(store: Store, sql: string): void {
  if (CANONICAL_TABLE_RE.test(sql)) {
    store.probe.canonicalSql.push(sql);
  }
}

/** Cascade a Trip delete to its child `trip_*` rows (mirrors ON DELETE CASCADE). */
function cascadeTripDelete(
  target: { trips: Set<string>; memberships: MembershipRow[]; logEntries: LogEntryRow[]; tags: TagRow[] },
  tripId: string,
): void {
  target.trips.delete(tripId);
  target.memberships = target.memberships.filter((m) => m.tripId !== tripId);
  const removedEntries = new Set(
    target.logEntries.filter((e) => e.tripId === tripId).map((e) => e.id),
  );
  target.logEntries = target.logEntries.filter((e) => e.tripId !== tripId);
  target.tags = target.tags.filter((t) => !removedEntries.has(t.logEntryId));
}

/**
 * Build a fake pool whose `query()` serves the direct (`deleteTrip`) path and
 * whose `connect()` hands out transaction clients for the `departMember` path.
 * Both share the one {@link Store}. Only the SQL fragments the lifecycle
 * operations emit are modelled; anything else fails loudly.
 */
function makeFakePool(store: Store): FakePool {
  const ok = (rows: unknown[]): { rows: unknown[]; rowCount: number } => ({
    rows,
    rowCount: rows.length,
  });

  return {
    // Non-transactional path: deleteTrip issues `DELETE FROM trips WHERE id=$1`.
    async query(
      text: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<{ rows: unknown[]; rowCount: number }> {
      const sql = norm(text);
      inspectForCanonical(store, sql);

      if (sql.startsWith('DELETE FROM trips')) {
        const tripId = String(params[0]);
        const existed = store.trips.has(tripId);
        if (existed) cascadeTripDelete(store, tripId);
        return { rows: [], rowCount: existed ? 1 : 0 };
      }

      throw new Error(`unhandled pool SQL in fake pool: ${sql.slice(0, 80)}`);
    },

    async connect(): Promise<FakeClient> {
      let tx: Tx | null = null;

      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<{ rows: unknown[]; rowCount: number }> {
          const sql = norm(text);
          inspectForCanonical(store, sql);

          // ---- transaction control ---------------------------------
          if (sql.startsWith('BEGIN')) {
            tx = {
              trips: new Set(store.trips),
              memberships: cloneMemberships(store.memberships),
              logEntries: store.logEntries.slice(),
              tags: cloneTags(store.tags),
            };
            return ok([]);
          }
          if (sql.startsWith('COMMIT')) {
            if (tx === null) throw new Error('COMMIT without BEGIN');
            store.trips = new Set(tx.trips);
            store.memberships = cloneMemberships(tx.memberships);
            store.logEntries = tx.logEntries.slice();
            store.tags = cloneTags(tx.tags);
            tx = null;
            return ok([]);
          }
          if (sql.startsWith('ROLLBACK')) {
            tx = null;
            return ok([]);
          }

          if (tx === null) {
            throw new Error(`data-plane query without BEGIN: ${sql.slice(0, 64)}`);
          }

          // ---- departMember: lock the Trip's membership set --------
          if (sql.startsWith('SELECT user_id, role FROM trip_memberships')) {
            const [tripId] = params as [string];
            const rows = tx.memberships
              .filter((m) => m.tripId === tripId)
              .map((m) => ({ user_id: m.userId, role: m.role }));
            return ok(rows);
          }

          // ---- departMember: delete the departing membership -------
          if (sql.startsWith('DELETE FROM trip_memberships')) {
            const [tripId, userId] = params as [string, string];
            const before = tx.memberships.length;
            tx.memberships = tx.memberships.filter(
              (m) => !(m.tripId === tripId && m.userId === userId),
            );
            return { rows: [], rowCount: before - tx.memberships.length };
          }

          // ---- departMember: cancel the departing Member's pending tags
          if (sql.startsWith('UPDATE rode_with_tags')) {
            const [tripId, userId] = params as [string, string];
            const entriesById = new Map(tx.logEntries.map((e) => [e.id, e]));
            let affected = 0;
            for (const tag of tx.tags) {
              const entry = entriesById.get(tag.logEntryId);
              if (
                entry &&
                entry.tripId === tripId &&
                tag.state === 'pending' &&
                (tag.taggedMemberId === userId || entry.memberId === userId)
              ) {
                tag.state = 'cancelled';
                affected += 1;
              }
            }
            return { rows: [], rowCount: affected };
          }

          // ---- departMember: sole-Member cascade delete ------------
          if (sql.startsWith('DELETE FROM trips')) {
            const [tripId] = params as [string];
            const existed = tx.trips.has(tripId);
            if (existed) cascadeTripDelete(tx, tripId);
            return { rows: [], rowCount: existed ? 1 : 0 };
          }

          throw new Error(`unhandled client SQL in fake pool: ${sql.slice(0, 80)}`);
        },
        release(): void {
          tx = null;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Canonical repos that must never be called (guard #2)
// ---------------------------------------------------------------------------

/**
 * Build canonical Completion + Rating stand-ins whose every method records the
 * call on the shared {@link Probe} and then throws. A single invocation both
 * flags a violation and aborts the lifecycle operation — which the test would
 * catch — so the "never called" invariant is enforced two ways.
 */
function makeGuardedDeps(probe: Probe): TripRepoDeps {
  const guard =
    (method: string) =>
    (): never => {
      probe.repoCalls.push(method);
      throw new Error(
        `Trip lifecycle must not touch the canonical repo: ${method}`,
      );
    };

  const completions = {
    mark: guard('completions.mark'),
    edit: guard('completions.edit'),
    getCompletion: guard('completions.getCompletion'),
    unmark: guard('completions.unmark'),
  } as unknown as CompletionRepo;

  const ratings = {
    setRating: guard('ratings.setRating'),
    removeRating: guard('ratings.removeRating'),
    getRating: guard('ratings.getRating'),
  } as unknown as RatingRepo;

  return { completions, ratings };
}

// ---------------------------------------------------------------------------
// Scenario generator — a set of Trips with members, log entries, pending tags
// ---------------------------------------------------------------------------

interface ScenarioMember {
  readonly userId: string;
  readonly role: TripRole;
}

interface ScenarioTrip {
  readonly id: string;
  readonly members: ScenarioMember[];
}

/**
 * A Trip topology: 1..4 members with at least one organizer (a real Trip
 * invariant), plus a log entry per member and a pending rode-with tag between
 * members so the departure path's tag-cancellation `UPDATE` and the cascade
 * `DELETE` both do real work.
 */
const scenarioTripArb: fc.Arbitrary<ScenarioTrip> = fc
  .array(fc.constantFrom<TripRole>('organizer', 'member'), {
    minLength: 1,
    maxLength: 4,
  })
  .map((roles) => {
    const tripId = randomUUID();
    // Guarantee at least one organizer (Last_Organizer_Rule holds on seed).
    const withOrganizer: TripRole[] = roles.includes('organizer')
      ? roles
      : ['organizer', ...roles.slice(1)];
    const members = withOrganizer.map((role) => ({
      userId: randomUUID(),
      role,
    }));
    return { id: tripId, members };
  });

const scenarioArb: fc.Arbitrary<ScenarioTrip[]> = fc.array(scenarioTripArb, {
  minLength: 1,
  maxLength: 4,
});

/** Materialise the scenario into a fresh {@link Store}. */
function buildStore(scenario: ScenarioTrip[], probe: Probe): Store {
  const trips = new Set<string>();
  const memberships: MembershipRow[] = [];
  const logEntries: LogEntryRow[] = [];
  const tags: TagRow[] = [];

  for (const trip of scenario) {
    trips.add(trip.id);
    for (const m of trip.members) {
      memberships.push({ tripId: trip.id, userId: m.userId, role: m.role });
      const entryId = randomUUID();
      logEntries.push({ id: entryId, tripId: trip.id, memberId: m.userId });
    }
    // A pending tag naming the next member (wraps) exercises the cancel path.
    const entries = logEntries.filter((e) => e.tripId === trip.id);
    for (let i = 0; i < trip.members.length; i += 1) {
      const tagged = trip.members[(i + 1) % trip.members.length]!;
      tags.push({
        id: randomUUID(),
        logEntryId: entries[i]!.id,
        taggedMemberId: tagged.userId,
        state: 'pending',
      });
    }
  }

  return {
    trips,
    memberships,
    logEntries,
    tags,
    canonical: seedCanonical(),
    probe,
  };
}

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface Model {
  /** Live Trips → their current membership set. */
  readonly trips: Map<string, Membership[]>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
  readonly probe: Probe;
  /** A frozen deep-clone of the seeded canonical data for equality checks. */
  readonly canonicalBaseline: string;
}

function modelFromScenario(scenario: ScenarioTrip[]): Model {
  const trips = new Map<string, Membership[]>();
  for (const t of scenario) {
    trips.set(
      t.id,
      t.members.map((m) => ({ userId: m.userId, role: m.role })),
    );
  }
  return { trips };
}

/**
 * The property's core assertion, re-run after every command: no canonical SQL
 * was ever emitted, no canonical repo method was ever called, and the seeded
 * canonical data is byte-for-byte unchanged.
 */
function assertCanonicalUntouched(r: Real): void {
  expect(r.probe.canonicalSql).toEqual([]);
  expect(r.probe.repoCalls).toEqual([]);
  expect(JSON.stringify(r.store.canonical)).toBe(r.canonicalBaseline);
}

/** Assert the store's live Trip set / memberships agree with the model. */
function assertStoreMatchesModel(m: Model, r: Real): void {
  const storeTrips = new Set(r.store.trips);
  expect(storeTrips).toEqual(new Set(m.trips.keys()));

  for (const [tripId, members] of m.trips) {
    const storeMembers = new Set(
      r.store.memberships
        .filter((x) => x.tripId === tripId)
        .map((x) => `${x.userId}:${x.role}`),
    );
    const modelMembers = new Set(members.map((x) => `${x.userId}:${x.role}`));
    expect(storeMembers).toEqual(modelMembers);
  }
}

async function expectAppError(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected AppError(${code}) but the call resolved`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `DeleteTrip(sel)`: delete a live Trip (an Organizer action). The Trip and all
 * its `trip_*` children vanish; canonical Tracking data is untouched (R3.10).
 */
class DeleteTripCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly sel: number) {}

  check(m: Readonly<Model>): boolean {
    return m.trips.size > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const tripId = [...m.trips.keys()][this.sel % m.trips.size]!;

    const deleted = await r.repo.deleteTrip(tripId);
    expect(deleted).toBe(true);
    m.trips.delete(tripId);

    assertStoreMatchesModel(m, r);
    assertCanonicalUntouched(r);
  }

  toString(): string {
    return `DeleteTrip(#${this.sel})`;
  }
}

/**
 * `LeaveTrip(sel, memberSel)`: a Member leaves. Predicted with the same
 * `violatesLastOrganizer` predicate the repo uses: a last-organizer violation
 * is rejected and the Trip is unchanged (R5.3); the sole Member leaving deletes
 * the Trip (R5.7); otherwise the membership is removed. Canonical data is
 * untouched throughout (R8.4, R5.7).
 */
class LeaveTripCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly sel: number, public readonly memberSel: number) {}

  check(m: Readonly<Model>): boolean {
    return m.trips.size > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const tripId = [...m.trips.keys()][this.sel % m.trips.size]!;
    const members = m.trips.get(tripId)!;
    const actor = members[this.memberSel % members.length]!;

    if (violatesLastOrganizer(members, { kind: 'leave', userId: actor.userId })) {
      await expectAppError(
        () => r.repo.leaveTrip(tripId, actor.userId),
        'trip_last_organizer',
      );
    } else {
      const result = await r.repo.leaveTrip(tripId, actor.userId);
      if (members.length === 1) {
        expect(result.tripDeleted).toBe(true);
        m.trips.delete(tripId);
      } else {
        expect(result.tripDeleted).toBe(false);
        m.trips.set(
          tripId,
          members.filter((x) => x.userId !== actor.userId),
        );
      }
    }

    assertStoreMatchesModel(m, r);
    assertCanonicalUntouched(r);
  }

  toString(): string {
    return `LeaveTrip(#${this.sel}, m#${this.memberSel})`;
  }
}

/**
 * `RemoveMember(sel, memberSel)`: an Organizer removes a Member. Uses the same
 * departure discipline as leaving (the Last_Organizer_Rule predicate is
 * identical for `remove`); canonical data is untouched (R8.4).
 */
class RemoveMemberCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly sel: number, public readonly memberSel: number) {}

  check(m: Readonly<Model>): boolean {
    return m.trips.size > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const tripId = [...m.trips.keys()][this.sel % m.trips.size]!;
    const members = m.trips.get(tripId)!;
    const target = members[this.memberSel % members.length]!;

    if (violatesLastOrganizer(members, { kind: 'remove', userId: target.userId })) {
      await expectAppError(
        () => r.repo.removeMember(tripId, target.userId),
        'trip_last_organizer',
      );
    } else {
      const result = await r.repo.removeMember(tripId, target.userId);
      if (members.length === 1) {
        expect(result.tripDeleted).toBe(true);
        m.trips.delete(tripId);
      } else {
        expect(result.tripDeleted).toBe(false);
        m.trips.set(
          tripId,
          members.filter((x) => x.userId !== target.userId),
        );
      }
    }

    assertStoreMatchesModel(m, r);
    assertCanonicalUntouched(r);
  }

  toString(): string {
    return `RemoveMember(#${this.sel}, m#${this.memberSel})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Trip lifecycle — Property 9: canonical Tracking data is never mutated', () => {
  it('delete / leave / remove never write to completions/ratings/notes and never call the canonical repos', async () => {
    const selectorArb = fc.nat({ max: 1000 });
    const commandArb = fc.oneof(
      selectorArb.map((s) => new DeleteTripCommand(s)),
      fc
        .tuple(selectorArb, selectorArb)
        .map(([s, ms]) => new LeaveTripCommand(s, ms)),
      fc
        .tuple(selectorArb, selectorArb)
        .map(([s, ms]) => new RemoveMemberCommand(s, ms)),
    );

    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (scenario, cmds) => {
          const probe: Probe = { canonicalSql: [], repoCalls: [] };
          const store = buildStore(scenario, probe);
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            makeGuardedDeps(probe),
          );
          const canonicalBaseline = JSON.stringify(store.canonical);

          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: modelFromScenario(scenario),
            real: { store, repo, probe, canonicalBaseline },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
