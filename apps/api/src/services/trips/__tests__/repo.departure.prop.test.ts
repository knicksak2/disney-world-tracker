// Feature: trips, Property 10: Departure retains contributions and cancels pending tags
/**
 * Property-based test for Trip departure semantics (task 7.3).
 *
 * **Validates: Requirements 8.1, 8.2, 8.5, 8.6, 8.7, 5.7**
 *
 * Design Property 10 (design.md → Correctness Properties):
 *
 *   For any Trip_Member who leaves or is removed, their Trip_Log_Entries and
 *   confirmed Rode_With_Tags are retained on the Trip, every `pending`
 *   Rode_With_Tag they created as Tagging_Member and every `pending`
 *   Rode_With_Tag naming them as Tagged_Member is transitioned so it can no
 *   longer be confirmed, and when the departing Member was the Trip's only
 *   Member the Trip and its associated entities are deleted.
 *
 * Test strategy
 * -------------
 * Per the tasks.md convention, this stateful property runs against an
 * in-memory model of the repo rather than a live database: a tiny fake
 * `pg.Pool` drives the *real* `createTripRepo` factory (the production
 * `removeMember` / `leaveTrip` → shared `departMember` transaction), backed by
 * a store that models exactly the four tables the departure touches —
 * `trip_memberships`, `trip_log_entries`, `rode_with_tags`, and `trips`
 * (the last for the sole-Member cascade delete). The fake pool dispatches the
 * SQL fragments `departMember` emits (`BEGIN`, the membership lock, the
 * membership `DELETE`, the pending-tag `UPDATE ... FROM`, the trip `DELETE`,
 * and `COMMIT` / `ROLLBACK`) to a snapshot-per-transaction layer so a
 * `ROLLBACK` faithfully discards a rejected departure's partial writes.
 *
 * Because the store models *only* Trip tables — never `completions`,
 * `ratings`, or `notes` — any attempt by the departure to touch canonical
 * Tracking data would hit the fake pool's "unhandled SQL" guard and fail the
 * test. That is the test's standing assertion that a departure never mutates
 * canonical Tracking data (R5.7, R8.4): the real cascade `DELETE FROM trips`
 * likewise never references those tables.
 *
 * For each generated world (a membership set with at least one Organizer, a
 * set of log entries authored by members, and rode-with tags in assorted
 * states) and a chosen departure (a Member leaving or being removed), the
 * property asserts:
 *   - a departure that would strand a non-empty Trip without an Organizer is
 *     rejected with `trip_last_organizer` and leaves the whole store unchanged
 *     (this is Property 8's rule, reused here so the retain/cancel/delete
 *     clauses are only asserted on departures that actually happen);
 *   - otherwise the departing Member's membership is removed (R8.1, R8.2);
 *   - every Trip_Log_Entry is retained, including the departing Member's (R8.5);
 *   - every confirmed / declined / already-cancelled tag is untouched — the
 *     departing Member's confirmed contributions are retained (R8.5);
 *   - every `pending` tag the departing Member created as Tagging_Member (a tag
 *     on a log entry they authored) or is named in as Tagged_Member becomes
 *     `cancelled` so it can no longer be confirmed (R8.6, R8.7);
 *   - every `pending` tag unrelated to the departing Member is left `pending`;
 *   - when the departing Member was the Trip's only Member the Trip and all its
 *     child rows are deleted and `tripDeleted` is `true` (R5.7).
 *
 * The production `violatesLastOrganizer` predicate (already covered by
 * Property 8) is reused to decide the model's expected accept/reject outcome,
 * so this test does not re-implement that rule.
 *
 * `numRuns: 200` (≥100 per the spec convention).
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import {
  type Membership,
  type TripRole,
  violatesLastOrganizer,
} from '../permissions.js';
import { createTripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 200;
const MAX_MEMBERS = 5;
const MAX_LOG_ENTRIES = 6;

/** The single Trip every generated world belongs to. */
const TRIP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type TagState = 'pending' | 'confirmed' | 'declined' | 'cancelled';

// ---------------------------------------------------------------------------
// In-memory model of the tables a departure touches
// ---------------------------------------------------------------------------

interface MembershipRow {
  readonly tripId: string;
  readonly userId: string;
  readonly role: TripRole;
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
 * The whole backing store. Every table is mutable and snapshotted per
 * transaction so a `ROLLBACK` discards a rejected departure's partial writes.
 * `trips` is a set of live Trip ids so the sole-Member cascade `DELETE FROM
 * trips` can be modelled (removing the Trip and all of its child rows).
 */
interface Store {
  trips: Set<string>;
  memberships: MembershipRow[];
  logEntries: LogEntryRow[];
  tags: Map<string, TagRow>;
}

/** A mutable per-transaction snapshot of the store. */
interface Tx {
  trips: Set<string>;
  memberships: MembershipRow[];
  logEntries: LogEntryRow[];
  tags: Map<string, TagRow>;
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

/** Deep-copy a tag map so a transaction snapshot is fully isolated. */
function cloneTags(src: Map<string, TagRow>): Map<string, TagRow> {
  const out = new Map<string, TagRow>();
  for (const [id, row] of src) out.set(id, { ...row });
  return out;
}

/**
 * Build a fake pool whose `connect()` hands out clients backed by the shared
 * `Store`. Each client owns a per-transaction snapshot; `COMMIT` atomically
 * writes it back and `ROLLBACK` discards it. Only the SQL fragments the
 * departure emits are modelled; anything else — including any reference to a
 * canonical Tracking table — fails loudly so SQL drift (or an unexpected
 * canonical write) is surfaced by the test rather than silently ignored.
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
            tx = {
              trips: new Set(store.trips),
              memberships: store.memberships.slice(),
              logEntries: store.logEntries.slice(),
              tags: cloneTags(store.tags),
            };
            return ok([]);
          }
          if (sql.startsWith('COMMIT')) {
            if (tx === null) throw new Error('COMMIT without BEGIN');
            store.trips = new Set(tx.trips);
            store.memberships = tx.memberships.slice();
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
            throw new Error(
              `data-plane query without BEGIN: ${sql.slice(0, 64)}`,
            );
          }

          // ---- lockMemberships: SELECT the whole membership set -----
          if (sql.startsWith('SELECT user_id, role FROM trip_memberships')) {
            const [tripId] = params as [string];
            const rows = tx.memberships
              .filter((m) => m.tripId === tripId)
              .map((m) => ({ user_id: m.userId, role: m.role }));
            return ok(rows);
          }

          // ---- delete the departing Member's membership -------------
          if (sql.startsWith('DELETE FROM trip_memberships')) {
            const [tripId, userId] = params as [string, string];
            const before = tx.memberships.length;
            tx.memberships = tx.memberships.filter(
              (m) => !(m.tripId === tripId && m.userId === userId),
            );
            return ok(
              Array.from({ length: before - tx.memberships.length }, () => ({})),
            );
          }

          // ---- cancel the departing Member's pending rode-with tags -
          // Mirrors the UPDATE ... FROM join: a pending tag is cancelled
          // when its log entry belongs to this Trip and the departing Member
          // is either the tag's Tagged_Member or the log entry's author
          // (Tagging_Member).
          if (sql.startsWith('UPDATE rode_with_tags')) {
            const [tripId, userId] = params as [string, string];
            let affected = 0;
            for (const tag of tx.tags.values()) {
              if (tag.state !== 'pending') continue;
              const entry = tx.logEntries.find((e) => e.id === tag.logEntryId);
              if (!entry || entry.tripId !== tripId) continue;
              if (tag.taggedMemberId === userId || entry.memberId === userId) {
                tag.state = 'cancelled';
                affected += 1;
              }
            }
            return ok(Array.from({ length: affected }, () => ({})));
          }

          // ---- sole-Member cascade delete of the Trip ---------------
          // The real DELETE FROM trips fans out via ON DELETE CASCADE; model
          // that by dropping the Trip and all of its child rows.
          if (sql.startsWith('DELETE FROM trips')) {
            const [tripId] = params as [string];
            const existed = tx.trips.delete(tripId);
            tx.memberships = tx.memberships.filter((m) => m.tripId !== tripId);
            const survivingEntries = tx.logEntries.filter(
              (e) => e.tripId !== tripId,
            );
            const survivingIds = new Set(survivingEntries.map((e) => e.id));
            tx.logEntries = survivingEntries;
            for (const [id, tag] of [...tx.tags]) {
              if (!survivingIds.has(tag.logEntryId)) tx.tags.delete(id);
            }
            return ok(existed ? [{}] : []);
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

/** Departure never touches the canonical repos; stand-ins satisfy the type. */
const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

// ---------------------------------------------------------------------------
// Scenario generation
// ---------------------------------------------------------------------------

interface GenTag {
  readonly taggedIndex: number;
  readonly state: TagState;
}

interface GenLog {
  readonly authorIndex: number;
  readonly tags: readonly GenTag[];
}

interface Scenario {
  readonly n: number;
  readonly roles: readonly TripRole[];
  readonly logs: readonly GenLog[];
  readonly departIndex: number;
  readonly kind: 'remove' | 'leave';
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .integer({ min: 1, max: MAX_MEMBERS })
  .chain((n) =>
    fc
      .record({
        roles: fc.array(fc.constantFrom<TripRole>('organizer', 'member'), {
          minLength: n,
          maxLength: n,
        }),
        logs: fc.array(
          fc.record({
            authorIndex: fc.integer({ min: 0, max: n - 1 }),
            tags: fc.array(
              fc.record({
                taggedIndex: fc.integer({ min: 0, max: n - 1 }),
                state: fc.constantFrom<TagState>(
                  'pending',
                  'confirmed',
                  'declined',
                  'cancelled',
                ),
              }),
              { maxLength: n },
            ),
          }),
          { maxLength: MAX_LOG_ENTRIES },
        ),
        departIndex: fc.integer({ min: 0, max: n - 1 }),
        kind: fc.constantFrom<'remove' | 'leave'>('remove', 'leave'),
      })
      .map((rest) => ({ n, ...rest })),
  );

/** Deterministic per-index user ids. */
function userId(index: number): string {
  return `user-${index}`;
}

interface World {
  readonly members: Membership[];
  readonly memberships: MembershipRow[];
  readonly logEntries: LogEntryRow[];
  readonly tags: TagRow[];
  readonly departUserId: string;
}

/**
 * Materialize a generated scenario into a concrete world. Index 0's role is
 * forced to `organizer` so the Trip always satisfies the invariant that a
 * non-empty Trip has at least one Organizer (R5.1); self-tags and duplicate
 * tags within a log entry are dropped to mirror the creation-time constraints
 * (R10.5, and the `(log_entry, tagged_member)` unique index).
 */
function materialize(s: Scenario): World {
  const roles: TripRole[] = s.roles.map((r, i) => (i === 0 ? 'organizer' : r));
  const members: Membership[] = roles.map((role, i) => ({
    userId: userId(i),
    role,
  }));
  const memberships: MembershipRow[] = members.map((m) => ({
    tripId: TRIP_ID,
    userId: m.userId,
    role: m.role,
  }));

  const logEntries: LogEntryRow[] = [];
  const tags: TagRow[] = [];
  for (const log of s.logs) {
    const entryId = randomUUID();
    logEntries.push({
      id: entryId,
      tripId: TRIP_ID,
      memberId: userId(log.authorIndex),
    });
    const seenTagged = new Set<number>();
    for (const tag of log.tags) {
      if (tag.taggedIndex === log.authorIndex) continue; // no self-tag
      if (seenTagged.has(tag.taggedIndex)) continue; // one tag per member
      seenTagged.add(tag.taggedIndex);
      tags.push({
        id: randomUUID(),
        logEntryId: entryId,
        taggedMemberId: userId(tag.taggedIndex),
        state: tag.state,
      });
    }
  }

  return {
    members,
    memberships,
    logEntries,
    tags,
    departUserId: userId(s.departIndex),
  };
}

function makeStore(world: World): Store {
  return {
    trips: new Set([TRIP_ID]),
    memberships: world.memberships.slice(),
    logEntries: world.logEntries.slice(),
    tags: new Map(world.tags.map((t) => [t.id, { ...t }])),
  };
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Trip departure — Property 10: retains contributions and cancels pending tags', () => {
  it('leaving/removal retains log entries + confirmed tags, cancels the departing member\'s pending tags, and deletes a sole-member Trip', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const world = materialize(scenario);
        const store = makeStore(world);
        const repo = createTripRepo(
          makeFakePool(store) as unknown as DbPool,
          NOOP_DEPS,
        );

        const departUserId = world.departUserId;
        const { kind } = scenario;
        const rejected = violatesLastOrganizer(world.members, {
          kind,
          userId: departUserId,
        });

        // Snapshot the pre-state for the rejection (no-change) assertion.
        const tagsBefore = new Map(
          [...store.tags].map(([id, t]) => [id, t.state]),
        );
        const membershipsBefore = store.memberships.map((m) => m.userId).sort();
        const logIdsBefore = store.logEntries.map((e) => e.id).sort();
        const tripsBefore = [...store.trips].sort();

        const depart = (): Promise<{ tripDeleted: boolean }> =>
          kind === 'remove'
            ? repo.removeMember(TRIP_ID, departUserId)
            : repo.leaveTrip(TRIP_ID, departUserId);

        if (rejected) {
          // Last_Organizer_Rule: the departure is rejected and NOTHING changes
          // (R5.2–R5.4; the retain/cancel/delete clauses only apply to
          // departures that actually occur).
          let threw: unknown;
          try {
            await depart();
          } catch (err) {
            threw = err;
          }
          expect(threw).toBeInstanceOf(AppError);
          expect((threw as AppError).code).toBe('trip_last_organizer');

          expect(store.memberships.map((m) => m.userId).sort()).toEqual(
            membershipsBefore,
          );
          expect(store.logEntries.map((e) => e.id).sort()).toEqual(
            logIdsBefore,
          );
          expect([...store.trips].sort()).toEqual(tripsBefore);
          for (const [id, state] of tagsBefore) {
            expect(store.tags.get(id)?.state).toBe(state);
          }
          return;
        }

        // Accepted departure.
        const soleMember = world.members.length === 1;
        const result = await depart();
        expect(result.tripDeleted).toBe(soleMember);

        if (soleMember) {
          // R5.7: the sole Member leaving deletes the Trip and every child row.
          expect(store.trips.has(TRIP_ID)).toBe(false);
          expect(
            store.memberships.filter((m) => m.tripId === TRIP_ID),
          ).toHaveLength(0);
          expect(
            store.logEntries.filter((e) => e.tripId === TRIP_ID),
          ).toHaveLength(0);
          const survivingTags = [...store.tags.values()].filter((t) =>
            world.logEntries.some((e) => e.id === t.logEntryId),
          );
          expect(survivingTags).toHaveLength(0);
          return;
        }

        // R8.1 / R8.2: the departing Member's membership is removed; every
        // other membership is retained.
        expect(
          store.memberships.some((m) => m.userId === departUserId),
        ).toBe(false);
        const expectedRemaining = world.members
          .map((m) => m.userId)
          .filter((u) => u !== departUserId)
          .sort();
        expect(store.memberships.map((m) => m.userId).sort()).toEqual(
          expectedRemaining,
        );

        // R8.5: every Trip_Log_Entry is retained, including the departing
        // Member's own entries.
        expect(store.logEntries.map((e) => e.id).sort()).toEqual(logIdsBefore);

        // R8.5 / R8.6 / R8.7: tag transitions.
        const authorOf = new Map(
          world.logEntries.map((e) => [e.id, e.memberId]),
        );
        for (const original of world.tags) {
          const now = store.tags.get(original.id)?.state;
          const relatesToDeparting =
            original.taggedMemberId === departUserId ||
            authorOf.get(original.logEntryId) === departUserId;
          if (original.state === 'pending' && relatesToDeparting) {
            // R8.6 (created as Tagging_Member) / R8.7 (named as Tagged_Member):
            // the pending tag is cancelled and can no longer be confirmed.
            expect(now).toBe('cancelled');
          } else {
            // R8.5: confirmed/declined tags and pending tags unrelated to the
            // departing Member are left exactly as they were.
            expect(now).toBe(original.state);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
