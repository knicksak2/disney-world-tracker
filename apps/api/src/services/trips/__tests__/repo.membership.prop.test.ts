// Feature: trips, Property 7: Promotion and demotion set the target role exactly
/**
 * Property-based test for `promote` / `demote` (task 7.2).
 *
 * Validates: Requirements 4.5, 4.6, 4.8
 *
 * Design Property 7 (design.md → Correctness Properties):
 *
 *   For any Trip_Member, promoting a Member sets their Trip_Role to `organizer`
 *   and demoting an Organizer (when permitted by the Last_Organizer_Rule) sets
 *   it to `member`; promoting an existing Organizer or demoting an existing
 *   Member is rejected as a validation error with no role change.
 *
 * Concretely, for any current membership set and any promote/demote request:
 *
 *   - promoting a `member` sets that Member's role to `organizer` (R4.5);
 *   - demoting an `organizer` sets that Member's role to `member` (R4.6),
 *     unless it would strand a non-empty Trip with zero organizers, in which
 *     case it is rejected with `trip_last_organizer` and the role is unchanged
 *     (R5.2 — the Last_Organizer_Rule guard on demotion);
 *   - promoting an existing `organizer` or demoting an existing `member` is a
 *     no-op role change, rejected with `trip_role_invalid` and no change (R4.8);
 *   - promoting or demoting a User who is not a Trip_Member is rejected with
 *     `trip_validation_failed` and no change.
 *
 * Test strategy
 * -------------
 * A `fast-check` `commands`-style state-machine test driven over the real
 * `createTripRepo` factory (task 7.1) backed by a tiny in-memory fake `pg.Pool`
 * that models exactly the one table these operations touch —
 * `trip_memberships` — with a snapshot-per-transaction layer so a `ROLLBACK`
 * faithfully discards a rejected operation's partial writes (the "no role
 * change on rejection" clause). The fake pool dispatches only the SQL fragments
 * `promote` / `demote` emit (`BEGIN`, the `FOR UPDATE` reads, the role
 * `UPDATE`s, and `COMMIT` / `ROLLBACK`); anything else fails loudly so a future
 * SQL drift is surfaced by the test rather than silently ignored. This mirrors
 * the repo.invites / createTrip property-test convention: the stateful property
 * runs against this in-memory model and the SQL repo is pinned to the same
 * behaviour by the cross-service integration tests (task 15.x).
 *
 * Each run seeds a random-but-valid initial membership set (always at least one
 * organizer so the Trip starts in a legal state), then applies a random
 * interleaving of promote/demote commands over the whole user universe
 * (members and non-members alike, exercising every rejection branch). After
 * every command a set of global invariants is re-checked: the model and store
 * role maps agree exactly, and a non-empty Trip always retains ≥1 organizer.
 * The expected demotion guard reuses the production `violatesLastOrganizer`
 * predicate so the test asserts the repo agrees with the pure rule rather than
 * a re-implementation of it. `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
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

/** The fixed Trip every membership in a run belongs to. */
const TRIP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** The universe of Users; some start as Trip_Members, some do not. */
const USER_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
] as const;

// ---------------------------------------------------------------------------
// In-memory model of the one table promote/demote touch
// ---------------------------------------------------------------------------

interface MembershipRow {
  readonly tripId: string;
  readonly userId: string;
  role: TripRole;
}

/**
 * The whole backing store: just the `trip_memberships` rows for the fixed Trip.
 * Both operations run their check-then-write inside a single transaction, so
 * the fake pool snapshots the rows on `BEGIN`, mutates the snapshot, and either
 * publishes it on `COMMIT` or discards it on `ROLLBACK`.
 */
interface Store {
  memberships: MembershipRow[];
}

/** A mutable per-transaction snapshot of the store's rows. */
interface Tx {
  memberships: MembershipRow[];
}

interface FakeClient {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[]; rowCount: number }>;
  release(): void;
}

interface FakePool {
  connect(): Promise<FakeClient>;
}

/** Collapse SQL whitespace so multi-line statements match on a stable prefix. */
function norm(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** Deep-copy the membership rows so a transaction snapshot is fully isolated. */
function cloneRows(src: readonly MembershipRow[]): MembershipRow[] {
  return src.map((r) => ({ ...r }));
}

/**
 * Build a fake pool whose `connect()` hands out clients backed by the shared
 * `Store`. Each client owns a per-transaction snapshot; `COMMIT` atomically
 * writes it back and `ROLLBACK` discards it.
 */
function makeFakePool(store: Store): FakePool {
  return {
    async connect(): Promise<FakeClient> {
      let tx: Tx | null = null;

      const ok = (
        rows: unknown[],
      ): { rows: unknown[]; rowCount: number } => ({
        rows,
        rowCount: rows.length,
      });

      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<{ rows: unknown[]; rowCount: number }> {
          const sql = norm(text);

          // ---- transaction control ---------------------------------
          if (sql.startsWith('BEGIN')) {
            tx = { memberships: cloneRows(store.memberships) };
            return ok([]);
          }
          if (sql.startsWith('COMMIT')) {
            if (tx === null) throw new Error('COMMIT without BEGIN');
            store.memberships = cloneRows(tx.memberships);
            tx = null;
            return ok([]);
          }
          if (sql.startsWith('ROLLBACK')) {
            tx = null;
            return ok([]);
          }

          if (tx === null) {
            throw new Error(
              `data-plane query without BEGIN: ${sql.slice(0, 64)}`,
            );
          }

          // ---- demote: lock the whole membership set (lockMemberships) ----
          // Must be tested before the single-row `SELECT role` branch since
          // both begin `SELECT ... FROM trip_memberships`.
          if (sql.startsWith('SELECT user_id, role FROM trip_memberships')) {
            const [tripId] = params as [string];
            return ok(
              tx.memberships
                .filter((m) => m.tripId === tripId)
                .map((m) => ({ user_id: m.userId, role: m.role })),
            );
          }

          // ---- promote: lock the single target row (lockMemberRole) -------
          if (sql.startsWith('SELECT role FROM trip_memberships')) {
            const [tripId, userId] = params as [string, string];
            const row = tx.memberships.find(
              (m) => m.tripId === tripId && m.userId === userId,
            );
            return ok(row ? [{ role: row.role }] : []);
          }

          // ---- promote/demote: the role UPDATE ----------------------------
          if (sql.startsWith('UPDATE trip_memberships SET role')) {
            const roleMatch = /SET role = '(\w+)'/u.exec(sql);
            const nextRole = roleMatch?.[1] as TripRole | undefined;
            const [tripId, userId] = params as [string, string];
            const row = tx.memberships.find(
              (m) => m.tripId === tripId && m.userId === userId,
            );
            if (row && nextRole) {
              row.role = nextRole;
              return ok([{ user_id: row.userId }]);
            }
            return ok([]);
          }

          throw new Error(`unhandled SQL in fake pool: ${sql.slice(0, 80)}`);
        },
        release(): void {
          tx = null;
        },
      };
    },
  };
}

/** Promote/demote never touch the canonical repos; stand-ins satisfy the type. */
const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface Model {
  /** Current role per Trip_Member; absent key ⇒ not a Member. */
  readonly roles: Map<string, TripRole>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
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

/** Snapshot the store's rows for the Trip as a role map for comparison. */
function storeRoles(store: Store): Map<string, TripRole> {
  const out = new Map<string, TripRole>();
  for (const row of store.memberships) {
    if (row.tripId === TRIP_ID) out.set(row.userId, row.role);
  }
  return out;
}

/** The model's roles as a {@link Membership} list for the pure rule check. */
function modelMembers(m: Model): Membership[] {
  return [...m.roles.entries()].map(([userId, role]) => ({ userId, role }));
}

/**
 * Global invariants re-checked after every command:
 *   - the model and store role maps agree exactly (roles set exactly, and no
 *     duplicate/phantom membership rows), and
 *   - a non-empty Trip always retains at least one organizer.
 */
function assertInvariants(m: Model, r: Real): void {
  const store = storeRoles(r.store);
  expect(store).toEqual(m.roles);

  // No duplicate membership row for any (trip, user).
  const seen = new Set<string>();
  for (const row of r.store.memberships) {
    const key = `${row.tripId}|${row.userId}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }

  // A non-empty Trip always has at least one organizer.
  if (m.roles.size > 0) {
    const hasOrganizer = [...m.roles.values()].some((role) => role === 'organizer');
    expect(hasOrganizer).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `Promote(userIndex)`: attempt to promote a User to organizer. Succeeds only
 * for a current `member` (role → `organizer`, R4.5); an existing `organizer` is
 * a no-op change rejected with `trip_role_invalid` (R4.8); a non-Member is
 * rejected with `trip_validation_failed`. In every rejection the role is
 * unchanged.
 */
class PromoteCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly userIndex: number) {}

  private user(): string {
    return USER_IDS[this.userIndex % USER_IDS.length]!;
  }

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const userId = this.user();
    const role = m.roles.get(userId);

    if (role === undefined) {
      await expectAppError(
        () => r.repo.promote(TRIP_ID, userId),
        'trip_validation_failed',
      );
    } else if (role === 'organizer') {
      await expectAppError(
        () => r.repo.promote(TRIP_ID, userId),
        'trip_role_invalid',
      );
    } else {
      await r.repo.promote(TRIP_ID, userId);
      m.roles.set(userId, 'organizer');
    }

    assertInvariants(m, r);
  }

  toString(): string {
    return `Promote(${this.user().slice(0, 8)})`;
  }
}

/**
 * `Demote(userIndex)`: attempt to demote a User to member. Succeeds only for a
 * current `organizer` whose demotion does not strand the non-empty Trip without
 * an organizer (role → `member`, R4.6); a demotion that would leave zero
 * organizers is rejected with `trip_last_organizer` (R5.2); an existing
 * `member` is a no-op change rejected with `trip_role_invalid` (R4.8); a
 * non-Member is rejected with `trip_validation_failed`. In every rejection the
 * role is unchanged.
 */
class DemoteCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly userIndex: number) {}

  private user(): string {
    return USER_IDS[this.userIndex % USER_IDS.length]!;
  }

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const userId = this.user();
    const role = m.roles.get(userId);

    if (role === undefined) {
      await expectAppError(
        () => r.repo.demote(TRIP_ID, userId),
        'trip_validation_failed',
      );
    } else if (role === 'member') {
      await expectAppError(
        () => r.repo.demote(TRIP_ID, userId),
        'trip_role_invalid',
      );
    } else if (
      violatesLastOrganizer(modelMembers(m), { kind: 'demote', userId })
    ) {
      await expectAppError(
        () => r.repo.demote(TRIP_ID, userId),
        'trip_last_organizer',
      );
    } else {
      await r.repo.demote(TRIP_ID, userId);
      m.roles.set(userId, 'member');
    }

    assertInvariants(m, r);
  }

  toString(): string {
    return `Demote(${this.user().slice(0, 8)})`;
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A random-but-valid initial membership set: each User is a non-member, a
 * `member`, or an `organizer`, with the guarantee that the Trip starts with at
 * least one organizer (a legal starting state, matching the Last_Organizer
 * invariant that create/accept always uphold).
 */
const initialRolesArb: fc.Arbitrary<Map<string, TripRole>> = fc
  .tuple(
    ...USER_IDS.map(() =>
      fc.constantFrom<'none' | TripRole>('none', 'member', 'organizer'),
    ),
  )
  .map((assignment) => {
    const roles = new Map<string, TripRole>();
    assignment.forEach((slot, i) => {
      if (slot !== 'none') roles.set(USER_IDS[i]!, slot);
    });
    // Guarantee a legal starting state: at least one organizer when non-empty.
    const hasOrganizer = [...roles.values()].some((r) => r === 'organizer');
    if (roles.size > 0 && !hasOrganizer) {
      const firstMember = [...roles.keys()][0]!;
      roles.set(firstMember, 'organizer');
    }
    return roles;
  });

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('promote/demote — Property 7: promotion and demotion set the target role exactly', () => {
  it('sets the target role exactly and rejects no-op / non-member / last-organizer changes for any interleaving', async () => {
    const userIndexArb = fc.nat({ max: USER_IDS.length - 1 });
    const commandArb = fc.oneof(
      userIndexArb.map((i) => new PromoteCommand(i)),
      userIndexArb.map((i) => new DemoteCommand(i)),
    );

    await fc.assert(
      fc.asyncProperty(
        initialRolesArb,
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (initialRoles, cmds) => {
          const store: Store = {
            memberships: [...initialRoles.entries()].map(([userId, role]) => ({
              tripId: TRIP_ID,
              userId,
              role,
            })),
          };
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            NOOP_DEPS,
          );
          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: { roles: new Map(initialRoles) },
            real: { store, repo },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
