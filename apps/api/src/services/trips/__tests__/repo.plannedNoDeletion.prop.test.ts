// Feature: planned-list-completion-sync, Property 3: Logging a Completion never deletes or mutates a Planned_Item
/**
 * Property-based test for the no-deletion invariant of Planned List Completion
 * Sync (task 2.4).
 *
 * **Validates: Requirements 3.5, 3.6, 6.2**
 *
 * Design Property 3 (design.md → Correctness Properties):
 *
 *   For any `Trip` and any logged Completion (`POST /trips/:id/log-entries`),
 *   the Trip's set of `Planned_Items` after the operation is identical to the
 *   set before it — no `Planned_Item` is deleted as a result of a
 *   `Trip_Log_Entry` being created, and every `Planned_Item`'s referenced
 *   `Experience` and recorded adding `Trip_Member` are preserved unchanged even
 *   when the log entry causes that item to become a `Completed_Planned_Item`.
 *
 * Test strategy
 * -------------
 * Per the tasks.md convention this stateful property runs against an in-memory
 * model of the repo rather than a live database. A tiny fake `pg.Pool` drives
 * the *real* `createTripRepo` factory (the production `logCompletion`
 * transaction), backed by a store that models exactly the tables
 * `logCompletion` writes — `trip_memberships` (seeded, read-only),
 * `trip_log_entries`, `rode_with_tags`, and `trip_feed_items` — **plus** a
 * seeded, read-only `planned_items` table that `logCompletion` must never
 * touch.
 *
 * Two guards enforce the property:
 *
 *   1. Every SQL string the repo emits is inspected: any statement mentioning
 *      `planned_items` is recorded as a violation. Because the fake pool fails
 *      loudly on any statement it does not recognise, a future write to
 *      `planned_items` added to the log path surfaces here rather than being
 *      silently ignored.
 *   2. After every `logCompletion` the whole `planned_items` set is compared
 *      byte-for-byte against the seeded baseline: the set of ids is identical
 *      (nothing deleted, nothing added), and every item's `experience_id` and
 *      `added_by` are unchanged — even for the item(s) that the completion just
 *      turned into a `Completed_Planned_Item`.
 *
 * The scenario deliberately overlaps the logged Experiences with the
 * Planned_List so completions frequently *do* flip a Planned_Item to done: the
 * completion pool is the union of the planned Experiences and a few extras. To
 * make the "becomes a Completed_Planned_Item" clause concrete, after each log
 * the test derives the Planned_List presentation from the accumulated feed
 * (`derivePlannedListPresentation`) and asserts the matching items now read
 * `done` — while their underlying `planned_items` rows remain untouched.
 *
 * `numRuns: 200` (>= 100 per the spec convention).
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  completedExperienceIdsFromFeed,
  derivePlannedListPresentation,
  type Park,
  type PlannedItemDTO,
  type TripFeedItemDTO,
} from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import type { CompletionRepo } from '../../tracking/completion/repo.js';
import type { RatingRepo } from '../../tracking/rating/repo.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 200;
const MAX_COMMANDS = 40;

/** The fixed Trip every log entry and planned item in a run belongs to. */
const TRIP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Matches any reference to the `planned_items` table as a whole word. */
const PLANNED_ITEMS_TABLE_RE = /\bplanned_items\b/iu;

/** The current Trip_Members; any may be the logging Member or an adder. */
const MEMBERS: readonly { userId: string; displayName: string }[] = [
  { userId: '00000000-0000-4000-8000-000000000000', displayName: 'Olivia Organizer' },
  { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Aaron Member' },
  { userId: '22222222-2222-4222-8222-222222222222', displayName: 'Bianca Member' },
] as const;

/** Experiences that may appear on the Planned_List. */
interface CatalogExperience {
  readonly id: string;
  readonly name: string;
  readonly park: Park;
}
const PLANNED_CATALOG: readonly CatalogExperience[] = [
  { id: 'e0000000-0000-4000-8000-000000000001', name: 'Space Mountain', park: 'Magic Kingdom' },
  { id: 'e0000000-0000-4000-8000-000000000002', name: 'Test Track', park: 'EPCOT' },
  { id: 'e0000000-0000-4000-8000-000000000003', name: 'Tower of Terror', park: 'Hollywood Studios' },
  { id: 'e0000000-0000-4000-8000-000000000004', name: 'Expedition Everest', park: 'Animal Kingdom' },
] as const;

/**
 * Extra Experiences that are *not* on the Planned_List. Logging one of these
 * exercises the case where a completion matches no Planned_Item, while the
 * completion pool below still overlaps the Planned_List heavily so completions
 * frequently flip a Planned_Item to done.
 */
const EXTRA_EXPERIENCE_IDS = [
  'e9999999-9999-4999-8999-999999999991',
  'e9999999-9999-4999-8999-999999999992',
] as const;

/** The pool of Experiences a log-completion may reference (planned ∪ extra). */
const LOG_EXPERIENCE_POOL: readonly string[] = [
  ...PLANNED_CATALOG.map((e) => e.id),
  ...EXTRA_EXPERIENCE_IDS,
] as const;

// ---------------------------------------------------------------------------
// In-memory model of the tables logCompletion writes, plus the read-only
// planned_items table it must never touch.
// ---------------------------------------------------------------------------

interface PlannedItemRow {
  readonly id: string;
  readonly tripId: string;
  readonly experienceId: string;
  readonly addedBy: string;
}

interface LogEntryRow {
  readonly id: string;
  readonly tripId: string;
  readonly memberId: string;
  readonly experienceId: string;
}

interface TagRow {
  readonly id: string;
  readonly logEntryId: string;
  readonly taggedMemberId: string;
  readonly state: string;
}

interface FeedRow {
  readonly tripId: string;
  readonly type: string;
  readonly actorId: string;
  readonly experienceId: string;
}

/** Records SQL statements that referenced `planned_items` (must stay empty). */
interface Probe {
  readonly plannedItemsSql: string[];
}

/**
 * The whole backing store. `memberIds` and `plannedItems` are read-only lookups
 * seeded at setup — `plannedItems` is the very set the property proves inert.
 * The mutable log tables are snapshotted per transaction so a `ROLLBACK`
 * faithfully discards partial writes.
 */
interface Store {
  readonly memberIds: ReadonlySet<string>;
  readonly plannedItems: readonly PlannedItemRow[];
  logEntries: LogEntryRow[];
  tags: TagRow[];
  feedItems: FeedRow[];
  readonly probe: Probe;
}

/** A mutable per-transaction snapshot of the store's mutable tables. */
interface Tx {
  logEntries: LogEntryRow[];
  tags: TagRow[];
  feedItems: FeedRow[];
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

/** Record any statement that references the `planned_items` table (guard #1). */
function inspectForPlannedItems(store: Store, sql: string): void {
  if (PLANNED_ITEMS_TABLE_RE.test(sql)) {
    store.probe.plannedItemsSql.push(sql);
  }
}

/**
 * Build a fake pool whose `connect()` hands out clients backed by the shared
 * `Store`. Each client owns a per-transaction snapshot; `COMMIT` atomically
 * writes it back and `ROLLBACK` discards it. Only the SQL fragments
 * `logCompletion` emits are modelled; anything else fails loudly so a future
 * SQL drift — including any touch of `planned_items` — is surfaced by the test.
 */
function makeFakePool(store: Store): FakePool {
  const ok = (rows: unknown[]): { rows: unknown[]; rowCount: number } => ({
    rows,
    rowCount: rows.length,
  });

  return {
    async connect(): Promise<FakeClient> {
      let tx: Tx | null = null;

      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<{ rows: unknown[]; rowCount: number }> {
          const sql = norm(text);
          inspectForPlannedItems(store, sql);

          // ---- transaction control ---------------------------------
          if (sql.startsWith('BEGIN')) {
            tx = {
              logEntries: store.logEntries.slice(),
              tags: store.tags.slice(),
              feedItems: store.feedItems.slice(),
            };
            return ok([]);
          }
          if (sql.startsWith('COMMIT')) {
            if (tx === null) throw new Error('COMMIT without BEGIN');
            store.logEntries = tx.logEntries.slice();
            store.tags = tx.tags.slice();
            store.feedItems = tx.feedItems.slice();
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

          // ---- membership set read for tag target validation (R10.4) --
          if (sql.startsWith('SELECT user_id FROM trip_memberships')) {
            const [tripId] = params as [string];
            const rows =
              tripId === TRIP_ID
                ? [...store.memberIds].map((user_id) => ({ user_id }))
                : [];
            return ok(rows);
          }

          // ---- insert the Trip_Log_Entry (R10.1, R10.2) --------------
          if (sql.startsWith('INSERT INTO trip_log_entries')) {
            const [tripId, memberId, experienceId] = params as [
              string,
              string,
              string,
            ];
            const id = randomUUID();
            tx.logEntries.push({ id, tripId, memberId, experienceId });
            return ok([{ id }]);
          }

          // ---- insert one pending Rode_With_Tag per tag (R10.3) ------
          if (sql.startsWith('INSERT INTO rode_with_tags')) {
            const [logEntryId, taggedMemberId] = params as [string, string];
            const id = randomUUID();
            tx.tags.push({ id, logEntryId, taggedMemberId, state: 'pending' });
            return ok([{ id }]);
          }

          // ---- completion_logged feed item (R10.9) -------------------
          if (sql.startsWith('INSERT INTO trip_feed_items')) {
            const [tripId, actorId, metadataJson] = params as [
              string,
              string,
              string,
            ];
            const metadata = JSON.parse(metadataJson) as { experienceId: string };
            tx.feedItems.push({
              tripId,
              type: 'completion_logged',
              actorId,
              experienceId: metadata.experienceId,
            });
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

// ---------------------------------------------------------------------------
// Injected canonical repos. logCompletion delegates the canonical Completion
// (and optional Rating) writes here; this property never supplies a Rating, so
// only `mark` is exercised. The canonical write is orthogonal to the
// planned_items invariant, so `mark` is a trivial no-op that returns null.
// ---------------------------------------------------------------------------

function makeDeps(): TripRepoDeps {
  const fail = (): never => {
    throw new Error('logCompletion must not touch this canonical operation');
  };

  const completions = {
    async mark() {
      return null;
    },
    edit: fail,
    getCompletion: fail,
    unmark: fail,
  } as unknown as CompletionRepo;

  const ratings = {
    setRating: fail,
    removeRating: fail,
    getRating: fail,
  } as unknown as RatingRepo;

  return { completions, ratings };
}

// ---------------------------------------------------------------------------
// Scenario generator — a Planned_List of distinct Experiences, each with an
// adder, that the run's completions must leave untouched.
// ---------------------------------------------------------------------------

/**
 * A Planned_List: a non-empty subset of the planned Catalog (distinct
 * Experiences, mirroring the real duplicate-Experience rejection R9.3), each
 * item recording one of the Members as its adder.
 */
const plannedListArb: fc.Arbitrary<PlannedItemRow[]> = fc
  .uniqueArray(fc.nat({ max: PLANNED_CATALOG.length - 1 }), {
    minLength: 1,
    maxLength: PLANNED_CATALOG.length,
  })
  .chain((experienceIndices) =>
    fc
      .array(fc.nat({ max: MEMBERS.length - 1 }), {
        minLength: experienceIndices.length,
        maxLength: experienceIndices.length,
      })
      .map((adderIndices) =>
        experienceIndices.map((expIdx, i) => {
          const exp = PLANNED_CATALOG[expIdx]!;
          const adder = MEMBERS[adderIndices[i]! % MEMBERS.length]!;
          return {
            id: randomUUID(),
            tripId: TRIP_ID,
            experienceId: exp.id,
            addedBy: adder.userId,
          };
        }),
      ),
  );

/** Build a fresh store seeded with the given Planned_List. */
function buildStore(plannedItems: readonly PlannedItemRow[]): Store {
  return {
    memberIds: new Set(MEMBERS.map((m) => m.userId)),
    plannedItems: plannedItems.map((p) => ({ ...p })),
    logEntries: [],
    tags: [],
    feedItems: [],
    probe: { plannedItemsSql: [] },
  };
}

/** Project the store's planned_items into the shared `PlannedItemDTO` shape. */
function plannedItemDTOs(store: Store): PlannedItemDTO[] {
  return store.plannedItems.map((p) => {
    const exp = PLANNED_CATALOG.find((e) => e.id === p.experienceId)!;
    const adder = MEMBERS.find((m) => m.userId === p.addedBy)!;
    return {
      id: p.id,
      experienceId: p.experienceId,
      experienceName: exp.name,
      park: exp.park,
      addedByDisplayName: adder.displayName,
      plannedDate: null,
      plannedTime: null,
      isFixed: false,
      isLightningLane: false,
      useSingleRider: false,
      priority: 2,
      itemType: 'experience',
      durationMinutes: null,
      predictedWaitMinutes: null,
      travelFromPrev: null,
      optimizedAt: null,
    };
  });
}

/** Project the store's feed into the shared `TripFeedItemDTO` shape. */
function feedDTOs(store: Store): TripFeedItemDTO[] {
  return store.feedItems.map((f) => ({
    id: randomUUID(),
    type: f.type,
    actorDisplayName: '',
    actorAvatarPreset: null,
    createdAt: new Date().toISOString(),
    metadata: { experienceId: f.experienceId },
    reactions: [],
    comments: [],
  }));
}

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface Model {
  /** Experience ids completed (logged) in the Trip so far. */
  readonly completedExperiences: Set<string>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
  /** A frozen JSON baseline of the seeded planned_items for equality checks. */
  readonly plannedBaseline: string;
}

/** Canonical serialization of the planned_items set, order-independent. */
function serializePlanned(items: readonly PlannedItemRow[]): string {
  return JSON.stringify(
    [...items]
      .map((p) => ({ id: p.id, experienceId: p.experienceId, addedBy: p.addedBy }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

/**
 * The property's core assertion, re-run after every command:
 *   - no SQL ever referenced `planned_items` (guard #1),
 *   - the planned_items set is byte-for-byte unchanged: same ids (nothing
 *     deleted, nothing added), same Experience and adder on every item (R3.5,
 *     R3.6, R6.2),
 *   - and, for the "becomes a Completed_Planned_Item" clause, deriving the
 *     Planned_List presentation from the accumulated feed marks exactly the
 *     logged-and-planned Experiences `done` — yet the rows above are untouched.
 */
function assertPlannedItemsPreserved(m: Model, r: Real): void {
  // Guard #1: the log path never touched planned_items.
  expect(r.store.probe.plannedItemsSql).toEqual([]);

  // Guard #2: the planned_items set is identical to the seeded baseline.
  expect(serializePlanned(r.store.plannedItems)).toBe(r.plannedBaseline);

  // The "even when it becomes a Completed_Planned_Item" clause: the derived
  // presentation flips the matching items to `done`, but the underlying rows
  // (asserted unchanged above) are preserved — the item keeps its Experience,
  // Park, and adder attribution.
  const items = plannedItemDTOs(r.store);
  const completedSet = completedExperienceIdsFromFeed(feedDTOs(r.store));
  const presentation = derivePlannedListPresentation(items, completedSet);

  // Every planned item is still present across the two sections (none dropped).
  expect(
    presentation.doneSection.length + presentation.notDoneSection.length,
  ).toBe(items.length);

  // A planned item reads `done` iff its Experience was logged in the Trip.
  for (const view of [...presentation.doneSection, ...presentation.notDoneSection]) {
    const expectedDone = m.completedExperiences.has(view.experienceId);
    expect(view.completionState).toBe(expectedDone ? 'done' : 'not_done');

    // The derived view preserves the source item's Experience and adder.
    const source = items.find((p) => p.id === view.id)!;
    expect(view.experienceId).toBe(source.experienceId);
    expect(view.experienceName).toBe(source.experienceName);
    expect(view.park).toBe(source.park);
    expect(view.addedByDisplayName).toBe(source.addedByDisplayName);
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * `LogCompletion(memberIndex, experienceIndex)`: the chosen Member logs a
 * Completion of the chosen Experience (from the planned ∪ extra pool) with no
 * rode-with tags. The command asserts a fresh Trip_Log_Entry and
 * `completion_logged` feed item were created, then re-checks that the Trip's
 * Planned_List is untouched by the log.
 */
class LogCompletionCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly memberIndex: number,
    public readonly experienceIndex: number,
  ) {}

  private member(): string {
    return MEMBERS[this.memberIndex % MEMBERS.length]!.userId;
  }

  private experienceId(): string {
    return LOG_EXPERIENCE_POOL[this.experienceIndex % LOG_EXPERIENCE_POOL.length]!;
  }

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const member = this.member();
    const experienceId = this.experienceId();

    const logEntriesBefore = r.store.logEntries.length;
    const feedBefore = r.store.feedItems.length;

    const result = await r.repo.logCompletion(TRIP_ID, member, {
      experienceId,
      rodeWith: [],
    });

    // A fresh Trip_Log_Entry and completion_logged feed item were created —
    // the Shared_Log records the logging event. (Sanity that a log happened.)
    expect(r.store.logEntries.length).toBe(logEntriesBefore + 1);
    expect(r.store.feedItems.length).toBe(feedBefore + 1);
    expect(result.pendingTags).toHaveLength(0);

    m.completedExperiences.add(experienceId);

    // The heart of Property 3: the log left the Planned_List untouched.
    assertPlannedItemsPreserved(m, r);
  }

  toString(): string {
    return `LogCompletion(member=${this.member().slice(0, 8)}, experience=${this.experienceId().slice(0, 8)})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('logCompletion Planned_List preservation — Property 3: logging a Completion never deletes or mutates a Planned_Item', () => {
  it('leaves the Trip planned_items set identical (Experience + adder unchanged) across any interleaving of log-completions, even when an item becomes a Completed_Planned_Item', async () => {
    const commandArb = fc
      .record({
        memberIndex: fc.nat({ max: MEMBERS.length - 1 }),
        experienceIndex: fc.nat({ max: LOG_EXPERIENCE_POOL.length - 1 }),
      })
      .map(
        ({ memberIndex, experienceIndex }) =>
          new LogCompletionCommand(memberIndex, experienceIndex),
      );

    await fc.assert(
      fc.asyncProperty(
        plannedListArb,
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (plannedItems, cmds) => {
          const store = buildStore(plannedItems);
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            makeDeps(),
          );
          const plannedBaseline = serializePlanned(store.plannedItems);

          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: { completedExperiences: new Set<string>() },
            real: { store, repo, plannedBaseline },
          });
          await fc.asyncModelRun(setup, cmds);

          // Final belt-and-braces: nothing across the whole run mutated the
          // Planned_List, and no statement ever named planned_items.
          expect(store.probe.plannedItemsSql).toEqual([]);
          expect(serializePlanned(store.plannedItems)).toBe(plannedBaseline);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
