// Feature: trips, Property 17: Read projections carry the required display fields
/**
 * Property-based test for the Trip read projections (task 9.6).
 *
 * Validates: Requirements 9.9, 12.4, 12.8
 *
 * Design Property 17 (design.md → Correctness Properties):
 *
 *   For any Planned_Item the read projection includes the referenced
 *   Experience's name, its Park, and the adding Member's display name; and for
 *   any Shared_Log entry the projection shows the current canonical Rating as a
 *   whole number 1–10 when the Trip_Member has one and an unrated indicator
 *   (`null`) when they do not (R9.9, R12.4, R12.8). The Rating is joined live
 *   at read time, never copied into the Trip, so a later rating change is
 *   always reflected (R12.4).
 *
 * Test strategy
 * -------------
 * A `fast-check` `commands`-style state-machine test driven over the real
 * `createTripRepo` factory (task 8.1 / 9.5) backed by a tiny in-memory fake
 * `pg.Pool` that models exactly the tables the two read projections touch —
 * `trip_log_entries` + `rode_with_tags` + `ratings` (live) for
 * `listLogEntries`, and `planned_items` for `listPlannedItems` — plus the
 * read-only `experiences` (name + Park) and `profiles` (display name) lookups
 * the projections join. The fake pool dispatches the exact `pool.query` SQL the
 * repo emits (the log projection's `LEFT JOIN ratings` + `json_agg` of tags,
 * and the planned-item join), so the property exercises the production read
 * path (`listLogEntries` / `listPlannedItems` and their row→DTO mappers) rather
 * than a re-implementation of it. Per the tasks.md convention the stateful
 * property runs against this in-memory model; the SQL repo is pinned to the
 * same behaviour by the cross-service integration tests.
 *
 * A random interleaving of commands is generated:
 *   - `LogEntry` seeds a Trip_Log_Entry (with a random set of rode-with tags in
 *     assorted states) into the store, mirroring it into the model;
 *   - `AddPlannedItem` seeds a Planned_Item;
 *   - `SetRating` sets, changes, or clears a Member's *canonical* Rating — the
 *     lever that must be reflected live by a subsequent read (R12.4/R12.8);
 *   - `ReadLog` calls `listLogEntries` and asserts every entry's projection
 *     carries `memberDisplayName`, `experienceName`, the current canonical
 *     Rating (whole number 1–10) or `null` when unrated, and each rode-with tag
 *     as `{ taggedMemberId, state }`;
 *   - `ReadPlanned` calls `listPlannedItems` and asserts every item's
 *     projection carries `experienceName`, `park`, and `addedByDisplayName`.
 *
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { Park, RodeWithTagState } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 40;

/** The fixed Trip every seeded row in a run belongs to. */
const TRIP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** A second Trip whose entries must never leak into `TRIP_ID`'s reads. */
const OTHER_TRIP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The fixed Trip_Members whose display names the projections join. */
interface Member {
  readonly userId: string;
  readonly displayName: string;
}
const MEMBERS: readonly Member[] = [
  { userId: '00000000-0000-4000-8000-000000000000', displayName: 'Olivia Organizer' },
  { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Aaron Member' },
  { userId: '22222222-2222-4222-8222-222222222222', displayName: 'Bianca Member' },
  { userId: '33333333-3333-4333-8333-333333333333', displayName: 'Carlos Member' },
] as const;

/** A fixed Catalog of Experiences the projections reference. */
interface CatalogExperience {
  readonly id: string;
  readonly name: string;
  readonly park: Park;
}
const CATALOG: readonly CatalogExperience[] = [
  { id: 'e0000000-0000-4000-8000-000000000001', name: 'Space Mountain', park: 'Magic Kingdom' },
  { id: 'e0000000-0000-4000-8000-000000000002', name: 'Test Track', park: 'EPCOT' },
  { id: 'e0000000-0000-4000-8000-000000000003', name: 'Tower of Terror', park: 'Hollywood Studios' },
  { id: 'e0000000-0000-4000-8000-000000000004', name: 'Expedition Everest', park: 'Animal Kingdom' },
] as const;

const TAG_STATES: readonly RodeWithTagState[] = [
  'pending',
  'confirmed',
  'declined',
  'cancelled',
] as const;

// ---------------------------------------------------------------------------
// In-memory model of the tables the read projections touch
// ---------------------------------------------------------------------------

interface LogEntryRow {
  readonly id: string;
  readonly tripId: string;
  readonly memberId: string;
  readonly experienceId: string;
  /** Monotonic insertion order → the `created_at` used to order the log. */
  readonly seq: number;
}

interface RodeWithTagRow {
  readonly id: string;
  readonly logEntryId: string;
  readonly taggedMemberId: string;
  readonly state: RodeWithTagState;
  /** Monotonic insertion order → the `created_at` used to order the tags. */
  readonly seq: number;
}

interface PlannedItemRow {
  readonly id: string;
  readonly tripId: string;
  readonly experienceId: string;
  readonly addedBy: string;
  readonly seq: number;
}

/** `experienceId|memberId` → canonical Rating (1–10); absence = unrated. */
type RatingKey = string;
function ratingKey(memberId: string, experienceId: string): RatingKey {
  return `${memberId}|${experienceId}`;
}

/**
 * The whole backing store. `experiences` and `profiles` are read-only lookups
 * seeded at setup; the rest are appended to by the seeding commands. `ratings`
 * is the *canonical* Rating table the log projection joins live — mutating it
 * mid-run and re-reading is exactly what proves R12.4/R12.8.
 */
interface Store {
  readonly experiences: ReadonlyMap<string, CatalogExperience>;
  readonly profiles: ReadonlyMap<string, string>;
  logEntries: LogEntryRow[];
  tags: RodeWithTagRow[];
  plannedItems: PlannedItemRow[];
  ratings: Map<RatingKey, number>;
  clock: number;
}

function makeStore(): Store {
  const experiences = new Map<string, CatalogExperience>();
  for (const e of CATALOG) experiences.set(e.id, e);
  const profiles = new Map<string, string>();
  for (const m of MEMBERS) profiles.set(m.userId, m.displayName);
  return {
    experiences,
    profiles,
    logEntries: [],
    tags: [],
    plannedItems: [],
    ratings: new Map(),
    clock: 0,
  };
}

// ---------------------------------------------------------------------------
// Fake pool: dispatches the exact `pool.query` SQL the read projections emit
// ---------------------------------------------------------------------------

interface QueryResult {
  rows: unknown[];
  rowCount: number;
}

/** Collapse SQL whitespace so multi-line statements match on a stable prefix. */
function norm(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Order `trip_log_entries` reverse-chronologically by `created_at` then `id`
 * (matching the repo's `ORDER BY le.created_at DESC, le.id DESC`). `seq` is a
 * strictly increasing insertion clock, so it is a faithful stand-in for
 * `created_at`; the `id` tie-break mirrors Postgres's byte-wise uuid ordering
 * via lexicographic string comparison of the lowercase uuid text.
 */
function orderEntriesDesc(entries: readonly LogEntryRow[]): LogEntryRow[] {
  return [...entries].sort((a, b) => {
    if (a.seq !== b.seq) return b.seq - a.seq;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** Order a log entry's tags by `created_at` then `id` ascending (json_agg order). */
function orderTagsAsc(tags: readonly RodeWithTagRow[]): RodeWithTagRow[] {
  return [...tags].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Build a fake pool whose `query` models the two read projections against the
 * shared `Store`. The log projection joins the *live* `ratings` map, so a
 * `SetRating` performed after a `LogEntry` is reflected on the next read. Only
 * the SQL the read projections emit is modelled; anything else fails loudly so
 * a future SQL drift is surfaced by the test rather than silently ignored.
 */
interface FakeQueryPool {
  query(text: unknown, params?: unknown): Promise<QueryResult>;
}

function makeFakePool(store: Store): FakeQueryPool {
  const ok = (rows: unknown[]): QueryResult => ({ rows, rowCount: rows.length });

  return {
    async query(text: unknown, params: unknown = []): Promise<QueryResult> {
      const sql = norm(String(text));
      const args = params as ReadonlyArray<unknown>;

      // ---- listLogEntries: log projection with live Rating + tags ----------
      if (sql.startsWith('SELECT le.id')) {
        const [tripId] = args as [string];
        const entries = orderEntriesDesc(
          store.logEntries.filter((e) => e.tripId === tripId),
        );
        const rows = entries.map((e) => {
          const exp = store.experiences.get(e.experienceId)!;
          // LEFT JOIN ratings — the current canonical value or null (R12.4).
          const live = store.ratings.get(ratingKey(e.memberId, e.experienceId));
          const tags = orderTagsAsc(
            store.tags.filter((t) => t.logEntryId === e.id),
          ).map((t) => ({ taggedMemberId: t.taggedMemberId, state: t.state }));
          return {
            id: e.id,
            member_id: e.memberId,
            member_display_name: store.profiles.get(e.memberId)!,
            experience_id: e.experienceId,
            experience_name: exp.name,
            rating: live === undefined ? null : live,
            rode_with: tags,
          };
        });
        return ok(rows);
      }

      // ---- listPlannedItems: planned-item join projection (R9.9) -----------
      if (sql.startsWith('SELECT pi.id')) {
        const [tripId] = args as [string];
        const items = [...store.plannedItems.filter((i) => i.tripId === tripId)].sort(
          (a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.id < b.id ? -1 : 1),
        );
        const rows = items.map((i) => {
          const exp = store.experiences.get(i.experienceId)!;
          return {
            id: i.id,
            experience_id: i.experienceId,
            experience_name: exp.name,
            park: exp.park,
            added_by_display_name: store.profiles.get(i.addedBy)!,
          };
        });
        return ok(rows);
      }

      throw new Error(`unhandled SQL in fake pool: ${sql.slice(0, 80)}`);
    },
  };
}

/** Read projections never touch the canonical repos; stand-ins satisfy the type. */
const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface ModelTag {
  readonly taggedMemberId: string;
  readonly state: RodeWithTagState;
  readonly seq: number;
  readonly id: string;
}
interface ModelLogEntry {
  readonly id: string;
  readonly memberId: string;
  readonly experienceId: string;
  readonly seq: number;
  readonly tags: ModelTag[];
}
interface ModelPlannedItem {
  readonly id: string;
  readonly experienceId: string;
  readonly addedBy: string;
  readonly seq: number;
}
interface Model {
  logEntries: ModelLogEntry[];
  plannedItems: ModelPlannedItem[];
  ratings: Map<RatingKey, number>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
}

function memberOf(idx: number): Member {
  return MEMBERS[idx % MEMBERS.length]!;
}
function experienceOf(idx: number): CatalogExperience {
  return CATALOG[idx % CATALOG.length]!;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `LogEntry(memberIdx, experienceIdx, tags, otherTrip)`: seed one
 * Trip_Log_Entry (with a set of rode-with tags in assorted states) into the
 * store and mirror it into the model. `otherTrip` seeds it under a different
 * Trip to prove the read is scoped to `TRIP_ID`.
 */
class LogEntryCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly memberIdx: number,
    public readonly experienceIdx: number,
    public readonly tagSpecs: ReadonlyArray<{ memberIdx: number; stateIdx: number }>,
    public readonly otherTrip: boolean,
  ) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const member = memberOf(this.memberIdx);
    const exp = experienceOf(this.experienceIdx);
    const tripId = this.otherTrip ? OTHER_TRIP_ID : TRIP_ID;
    const id = randomUUID();
    const seq = (r.store.clock += 1);
    r.store.logEntries.push({
      id,
      tripId,
      memberId: member.userId,
      experienceId: exp.id,
      seq,
    });

    const modelTags: ModelTag[] = [];
    for (const spec of this.tagSpecs) {
      const tagged = memberOf(spec.memberIdx);
      const state = TAG_STATES[spec.stateIdx % TAG_STATES.length]!;
      const tagId = randomUUID();
      const tagSeq = (r.store.clock += 1);
      r.store.tags.push({
        id: tagId,
        logEntryId: id,
        taggedMemberId: tagged.userId,
        state,
        seq: tagSeq,
      });
      modelTags.push({ taggedMemberId: tagged.userId, state, seq: tagSeq, id: tagId });
    }

    // Only entries under TRIP_ID are expected in the Trip's read projection.
    if (!this.otherTrip) {
      m.logEntries.push({
        id,
        memberId: member.userId,
        experienceId: exp.id,
        seq,
        tags: modelTags,
      });
    }
  }

  toString(): string {
    return `LogEntry(member=${memberOf(this.memberIdx).displayName}, exp=${
      experienceOf(this.experienceIdx).name
    }, tags=${this.tagSpecs.length}, otherTrip=${this.otherTrip})`;
  }
}

/**
 * `AddPlannedItem(memberIdx, experienceIdx)`: seed one Planned_Item into the
 * store and mirror it into the model so `ReadPlanned` can check its projection.
 */
class AddPlannedItemCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly memberIdx: number,
    public readonly experienceIdx: number,
  ) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const member = memberOf(this.memberIdx);
    const exp = experienceOf(this.experienceIdx);
    // The read projection tolerates repeats fine; keep the list unique on
    // Experience to mirror the real Planned_List's duplicate rule (R9.3).
    if (m.plannedItems.some((i) => i.experienceId === exp.id)) return;
    const id = randomUUID();
    const seq = (r.store.clock += 1);
    r.store.plannedItems.push({
      id,
      tripId: TRIP_ID,
      experienceId: exp.id,
      addedBy: member.userId,
      seq,
    });
    m.plannedItems.push({ id, experienceId: exp.id, addedBy: member.userId, seq });
  }

  toString(): string {
    return `AddPlannedItem(member=${memberOf(this.memberIdx).displayName}, exp=${
      experienceOf(this.experienceIdx).name
    })`;
  }
}

/**
 * `SetRating(memberIdx, experienceIdx, value)`: set, change, or clear the
 * *canonical* Rating for a (Member, Experience). `value === 0` clears it
 * (unrated). This is the lever that must be reflected live by the next
 * `ReadLog` (R12.4/R12.8).
 */
class SetRatingCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly memberIdx: number,
    public readonly experienceIdx: number,
    public readonly value: number,
  ) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const member = memberOf(this.memberIdx);
    const exp = experienceOf(this.experienceIdx);
    const key = ratingKey(member.userId, exp.id);
    if (this.value === 0) {
      r.store.ratings.delete(key);
      m.ratings.delete(key);
    } else {
      r.store.ratings.set(key, this.value);
      m.ratings.set(key, this.value);
    }
  }

  toString(): string {
    return `SetRating(member=${memberOf(this.memberIdx).displayName}, exp=${
      experienceOf(this.experienceIdx).name
    }, value=${this.value === 0 ? 'unrated' : this.value})`;
  }
}

/**
 * `ReadLog`: call `listLogEntries` and assert every entry's projection carries
 * the required display fields — `memberDisplayName`, `experienceName`, the
 * *current* canonical Rating (whole number 1–10) or `null` when unrated
 * (R12.4/R12.8), and each rode-with tag as `{ taggedMemberId, state }` — and
 * that the entries are scoped to the Trip and ordered reverse-chronologically.
 */
class ReadLogCommand implements fc.AsyncCommand<Model, Real> {
  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const dtos = await r.repo.listLogEntries(TRIP_ID);

    // Expected order: created_at (seq) DESC, id DESC.
    const expected = [...m.logEntries].sort((a, b) =>
      a.seq !== b.seq ? b.seq - a.seq : a.id < b.id ? 1 : -1,
    );
    expect(dtos.map((d) => d.id)).toEqual(expected.map((e) => e.id));

    const byId = new Map(dtos.map((d) => [d.id, d]));
    for (const e of expected) {
      const dto = byId.get(e.id)!;
      expect(dto).toBeDefined();

      // Required display fields (R12.4).
      expect(dto.memberId).toBe(e.memberId);
      expect(dto.memberDisplayName).toBe(r.store.profiles.get(e.memberId));
      expect(dto.experienceId).toBe(e.experienceId);
      expect(dto.experienceName).toBe(r.store.experiences.get(e.experienceId)!.name);

      // Live canonical Rating: whole number 1–10 when present, null otherwise
      // (R12.4, R12.8). Read from the model's canonical map — mutated by
      // SetRating — so a rating change is reflected without any Trip-local copy.
      const rating = m.ratings.get(ratingKey(e.memberId, e.experienceId));
      if (rating === undefined) {
        expect(dto.rating).toBeNull();
      } else {
        expect(dto.rating).toBe(rating);
        expect(Number.isInteger(dto.rating)).toBe(true);
        expect(dto.rating as number).toBeGreaterThanOrEqual(1);
        expect(dto.rating as number).toBeLessThanOrEqual(10);
      }

      // Rode-with projection: one entry per tag, carrying member + state,
      // ordered by tag created_at ascending.
      const expectedTags = [...e.tags]
        .sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.id < b.id ? -1 : 1))
        .map((t) => ({ taggedMemberId: t.taggedMemberId, state: t.state }));
      expect(dto.rodeWith).toEqual(expectedTags);
    }
  }

  toString(): string {
    return 'ReadLog';
  }
}

/**
 * `ReadPlanned`: call `listPlannedItems` and assert every item's projection
 * carries the referenced Experience's name and Park and the adding Member's
 * display name (R9.9).
 */
class ReadPlannedCommand implements fc.AsyncCommand<Model, Real> {
  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const dtos = await r.repo.listPlannedItems(TRIP_ID);

    const expected = [...m.plannedItems].sort((a, b) =>
      a.seq !== b.seq ? a.seq - b.seq : a.id < b.id ? -1 : 1,
    );
    expect(dtos.map((d) => d.id)).toEqual(expected.map((i) => i.id));

    const byId = new Map(dtos.map((d) => [d.id, d]));
    for (const i of expected) {
      const dto = byId.get(i.id)!;
      const exp = r.store.experiences.get(i.experienceId)!;
      expect(dto.experienceId).toBe(i.experienceId);
      expect(dto.experienceName).toBe(exp.name);
      expect(dto.park).toBe(exp.park);
      expect(dto.addedByDisplayName).toBe(r.store.profiles.get(i.addedBy));
    }
  }

  toString(): string {
    return 'ReadPlanned';
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Trip read projections — Property 17: read projections carry the required display fields', () => {
  it('projects display fields and the live canonical Rating (or unrated indicator) for the Shared_Log and Planned_List', async () => {
    const memberIdx = fc.nat({ max: MEMBERS.length - 1 });
    const experienceIdx = fc.nat({ max: CATALOG.length - 1 });

    const logEntryArb = fc
      .tuple(
        memberIdx,
        experienceIdx,
        fc.array(
          fc.record({
            memberIdx,
            stateIdx: fc.nat({ max: TAG_STATES.length - 1 }),
          }),
          { maxLength: 4 },
        ),
        fc.boolean(),
      )
      .map(([mi, ei, tags, other]) => new LogEntryCommand(mi, ei, tags, other));

    const plannedArb = fc
      .tuple(memberIdx, experienceIdx)
      .map(([mi, ei]) => new AddPlannedItemCommand(mi, ei));

    // value 0 = clear (unrated); 1–10 = a valid canonical Rating.
    const setRatingArb = fc
      .tuple(memberIdx, experienceIdx, fc.nat({ max: 10 }))
      .map(([mi, ei, v]) => new SetRatingCommand(mi, ei, v));

    const commandArb = fc.oneof(
      logEntryArb,
      plannedArb,
      setRatingArb,
      fc.constant(new ReadLogCommand()),
      fc.constant(new ReadPlannedCommand()),
    );

    await fc.assert(
      fc.asyncProperty(
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (cmds) => {
          const store = makeStore();
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            NOOP_DEPS,
          );
          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: { logEntries: [], plannedItems: [], ratings: new Map() },
            real: { store, repo },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
