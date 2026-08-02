// Feature: trips, Property 20: A pending or declined Rode_With_Tag never writes the Tagged_Member's data
/**
 * Property-based test for the pending/declined no-write invariant (task 10.2).
 *
 * Validates: Requirements 11.1, 11.6
 *
 * Design Property 20 (design.md → Correctness Properties): for any
 * Rode_With_Tag that is `pending` or has been `declined`, the Tagged_Member's
 * canonical Completions, Ratings, and Notes are exactly what they were before
 * the tag existed — no Completion, Rating, or Note is created, modified, or
 * linked on the Tagged_Member's behalf. Concretely:
 *
 *   - a `pending` tag on its own triggers no canonical write (R11.1): merely
 *     existing, being read, or being the target of a rejected confirm/decline
 *     never touches the Tagged_Member's data;
 *   - `declineRodeWithTag` sets the tag `declined` and writes nothing to the
 *     Tagged_Member's data (R11.6) — no canonical repo call and no canonical
 *     SQL at all;
 *   - by contrast `confirmRodeWithTag` *does* write (it ensures the
 *     Tagged_Member's Completion and, when a Rating is supplied, applies it),
 *     which is the negative control proving the guard would fire on a real
 *     write.
 *
 * Test strategy
 * -------------
 * A `fast-check` `commands`-style state-machine test driven over the real
 * `createTripRepo` factory (task 10.1) backed by a tiny in-memory fake `pg.Pool`
 * that models exactly the tables the confirm/decline operations touch —
 * `rode_with_tags` and `trip_log_entries` (read for the join). Neither confirm
 * nor decline writes a `trip_feed_items` row (R11.10), so the fake pool has no
 * INSERT branch. Per the tasks.md convention the stateful property runs against
 * this in-memory model; the SQL repo is pinned to the same behaviour by the
 * cross-service integration tests.
 *
 * The injected canonical Tracking repos are fakes that both *record every call*
 * and *apply it* to an in-memory canonical store keyed by `(userId,
 * experienceId)`. Every distinct tag references a distinct Experience, so a
 * canonical write is unambiguously attributable to exactly one tag. The
 * property's central guard, re-run after every command, is:
 *
 *     the canonical store contains an entry for `(taggedMember, experience)`
 *     if and only if that tag is `confirmed`.
 *
 * Equivalently: no `pending` and no `declined` tag ever leaves a trace in the
 * Tagged_Member's canonical data. A second guard inspects every SQL string the
 * repo emits and fails if it ever names a canonical table (`completions` /
 * `ratings` / `notes`) directly — those writes must always be delegated to the
 * injected repos, never issued by the Trip repo.
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
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 40;

/** Matches any reference to a canonical Tracking table as a whole word. */
const CANONICAL_TABLE_RE = /\b(completions|ratings|notes)\b/iu;

type TagState = 'pending' | 'confirmed' | 'declined';

// ---------------------------------------------------------------------------
// In-memory model of the tables confirm/decline touch
// ---------------------------------------------------------------------------

interface LogEntryRow {
  readonly id: string;
  readonly tripId: string;
  readonly experienceId: string;
  readonly memberId: string;
  readonly createdAt: string;
}

interface TagRow {
  readonly id: string;
  readonly logEntryId: string;
  readonly taggedMemberId: string;
  state: TagState;
}

/** One entry in the fake canonical store: the trickled-down data for a pair. */
interface CanonicalEntry {
  completed: boolean;
  rating: number | null;
}

/** Records a single delegated canonical-repo call. */
interface CanonicalCall {
  readonly method: 'completions.mark' | 'ratings.setRating';
  readonly userId: string;
  readonly experienceId: string;
  readonly value?: number;
}

/** Records probe findings across the run. */
interface Probe {
  /** SQL statements that referenced a canonical table directly (must stay empty). */
  readonly canonicalSql: string[];
  /** Every delegated canonical-repo call, in order. */
  readonly calls: CanonicalCall[];
}

/** The whole backing store shared by the fake pool and the fake repos. */
interface Store {
  logEntries: Map<string, LogEntryRow>;
  tags: TagRow[];
  /** Canonical data keyed by `${userId}::${experienceId}`. */
  readonly canonical: Map<string, CanonicalEntry>;
  readonly probe: Probe;
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

function canonKey(userId: string, experienceId: string): string {
  return `${userId}::${experienceId}`;
}

/** Collapse SQL whitespace so multi-line statements match on a stable prefix. */
function norm(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function cloneTags(src: TagRow[]): TagRow[] {
  return src.map((t) => ({ ...t }));
}

/** Record any statement that references a canonical table directly. */
function inspectForCanonical(store: Store, sql: string): void {
  if (CANONICAL_TABLE_RE.test(sql)) {
    store.probe.canonicalSql.push(sql);
  }
}

// ---------------------------------------------------------------------------
// Fake pool: models the `trip_*` SQL confirm/decline emit
// ---------------------------------------------------------------------------

/**
 * Build a fake pool whose `connect()` hands out a transaction client. Confirm
 * and decline both run entirely inside a transaction (BEGIN … COMMIT/ROLLBACK)
 * that locks the tag row, so all their SQL flows through the client. A
 * per-transaction snapshot of `tags` gives the ROLLBACK-on-error paths their
 * "nothing changed" semantics.
 */
function makeFakePool(store: Store): FakePool {
  const ok = (rows: unknown[]): { rows: unknown[]; rowCount: number } => ({
    rows,
    rowCount: rows.length,
  });

  return {
    async query(): Promise<{ rows: unknown[]; rowCount: number }> {
      throw new Error('confirm/decline never use the non-transactional path');
    },

    async connect(): Promise<FakeClient> {
      let tx: TagRow[] | null = null;

      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<{ rows: unknown[]; rowCount: number }> {
          const sql = norm(text);
          inspectForCanonical(store, sql);

          // ---- transaction control ---------------------------------
          if (sql.startsWith('BEGIN')) {
            tx = cloneTags(store.tags);
            return ok([]);
          }
          if (sql.startsWith('COMMIT')) {
            if (tx === null) throw new Error('COMMIT without BEGIN');
            store.tags = cloneTags(tx);
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

          // ---- confirm: lock the tag and read its log-entry context
          if (sql.startsWith('SELECT rwt.state')) {
            const [tagId] = params as [string];
            const tag = tx.find((t) => t.id === tagId);
            if (!tag) return ok([]);
            const entry = store.logEntries.get(tag.logEntryId)!;
            return ok([
              {
                state: tag.state,
                tagged_member_id: tag.taggedMemberId,
                trip_id: entry.tripId,
                experience_id: entry.experienceId,
                log_created_at: entry.createdAt,
              },
            ]);
          }

          // ---- decline: lock the tag and read its state/tagged member
          if (sql.startsWith('SELECT state, tagged_member_id FROM rode_with_tags')) {
            const [tagId] = params as [string];
            const tag = tx.find((t) => t.id === tagId);
            if (!tag) return ok([]);
            return ok([
              { state: tag.state, tagged_member_id: tag.taggedMemberId },
            ]);
          }

          // ---- confirm/decline: transition the tag state -----------
          if (sql.startsWith('UPDATE rode_with_tags')) {
            const [tagId] = params as [string];
            const tag = tx.find((t) => t.id === tagId);
            if (!tag) return { rows: [], rowCount: 0 };
            tag.state = sql.includes("state = 'confirmed'")
              ? 'confirmed'
              : 'declined';
            return { rows: [], rowCount: 1 };
          }

          // Neither confirm nor decline writes a feed item (R11.10); a stray
          // INSERT would fall through to the guard below and fail the run.
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
// Fake canonical repos: record AND apply every call to the canonical store
// ---------------------------------------------------------------------------

/**
 * Build canonical Completion + Rating stand-ins that record every call on the
 * shared {@link Probe} and apply it to the canonical store. A `pending` or
 * `declined` tag must never reach these; the property's guard proves the store
 * only ever gains entries backed by a `confirmed` tag.
 */
function makeRecordingDeps(store: Store): TripRepoDeps {
  const completions = {
    async mark(input: {
      userId: string;
      experienceId: string;
    }): Promise<null> {
      store.probe.calls.push({
        method: 'completions.mark',
        userId: input.userId,
        experienceId: input.experienceId,
      });
      const key = canonKey(input.userId, input.experienceId);
      const existing = store.canonical.get(key);
      if (existing) {
        existing.completed = true;
      } else {
        store.canonical.set(key, { completed: true, rating: null });
      }
      // Mirror the real repo: `mark` returns null when a Completion existed.
      return null;
    },
    edit() {
      throw new Error('confirm/decline must not call completions.edit');
    },
    getCompletion() {
      throw new Error('confirm/decline must not call completions.getCompletion');
    },
    unmark() {
      throw new Error('confirm/decline must not call completions.unmark');
    },
  } as unknown as CompletionRepo;

  const ratings = {
    async setRating(
      userId: string,
      experienceId: string,
      value: number,
    ): Promise<{ status: 'set' }> {
      store.probe.calls.push({
        method: 'ratings.setRating',
        userId,
        experienceId,
        value,
      });
      const key = canonKey(userId, experienceId);
      const existing = store.canonical.get(key);
      if (existing) {
        existing.rating = value;
      } else {
        store.canonical.set(key, { completed: false, rating: value });
      }
      return { status: 'set' };
    },
    removeRating() {
      throw new Error('confirm/decline must not call ratings.removeRating');
    },
    getRating() {
      throw new Error('confirm/decline must not call ratings.getRating');
    },
  } as unknown as RatingRepo;

  return { completions, ratings };
}

// ---------------------------------------------------------------------------
// Scenario generator — a set of pending/declined rode-with tags
// ---------------------------------------------------------------------------

interface ScenarioTag {
  readonly id: string;
  readonly tripId: string;
  readonly experienceId: string;
  readonly taggingMemberId: string;
  readonly taggedMemberId: string;
  readonly initialState: 'pending' | 'declined';
}

/**
 * A tag references a distinct Experience (so a canonical write maps to exactly
 * one tag), a Tagging_Member and a distinct Tagged_Member, and starts either
 * `pending` (the confirmable state) or already `declined` (a terminal state
 * that must stay write-free and reject any further confirm/decline).
 */
const scenarioTagArb: fc.Arbitrary<ScenarioTag> = fc
  .constantFrom<'pending' | 'declined'>('pending', 'declined')
  .map((initialState) => ({
    id: randomUUID(),
    tripId: randomUUID(),
    experienceId: randomUUID(),
    taggingMemberId: randomUUID(),
    taggedMemberId: randomUUID(),
    initialState,
  }));

const scenarioArb: fc.Arbitrary<ScenarioTag[]> = fc.array(scenarioTagArb, {
  minLength: 1,
  maxLength: 6,
});

/** Materialise the scenario into a fresh {@link Store}. */
function buildStore(scenario: ScenarioTag[]): Store {
  const logEntries = new Map<string, LogEntryRow>();
  const tags: TagRow[] = [];

  for (const t of scenario) {
    const logEntryId = randomUUID();
    logEntries.set(logEntryId, {
      id: logEntryId,
      tripId: t.tripId,
      experienceId: t.experienceId,
      memberId: t.taggingMemberId,
      createdAt: '2025-06-15T12:00:00.000Z',
    });
    tags.push({
      id: t.id,
      logEntryId,
      taggedMemberId: t.taggedMemberId,
      state: t.initialState,
    });
  }

  return {
    logEntries,
    tags,
    canonical: new Map<string, CanonicalEntry>(),
    probe: { canonicalSql: [], calls: [] },
  };
}

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface ModelTag {
  readonly experienceId: string;
  readonly taggedMemberId: string;
  state: TagState;
  /** The Rating value the confirm applied, if any (for the store equality check). */
  confirmedRating: number | null;
}

interface Model {
  /** tagId → its modelled state and identity. */
  readonly tags: Map<string, ModelTag>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
}

function modelFromScenario(scenario: ScenarioTag[]): Model {
  const tags = new Map<string, ModelTag>();
  for (const t of scenario) {
    tags.set(t.id, {
      experienceId: t.experienceId,
      taggedMemberId: t.taggedMemberId,
      state: t.initialState,
      confirmedRating: null,
    });
  }
  return { tags };
}

/**
 * The property's heart, re-run after every command: the canonical store holds
 * an entry for `(taggedMember, experience)` iff that tag is `confirmed`, and
 * the confirmed entry's rating matches what the confirm applied. Any entry for
 * a `pending` or `declined` tag would be a write on the Tagged_Member's data
 * from a non-confirm path — a Property 20 violation. Plus: the repo never
 * emitted SQL naming a canonical table directly.
 */
function assertNoWriteFromPendingOrDeclined(m: Model, r: Real): void {
  // Guard #1: no canonical SQL issued by the Trip repo itself.
  expect(r.store.canonical).toBeDefined();
  expect(r.store.probe.canonicalSql).toEqual([]);

  // Guard #2: the canonical store is exactly the confirmed projection.
  const expected = new Map<string, CanonicalEntry>();
  for (const tag of m.tags.values()) {
    if (tag.state === 'confirmed') {
      expected.set(canonKey(tag.taggedMemberId, tag.experienceId), {
        completed: true,
        rating: tag.confirmedRating,
      });
    }
  }

  expect(new Set(r.store.canonical.keys())).toEqual(new Set(expected.keys()));
  for (const [key, entry] of expected) {
    expect(r.store.canonical.get(key)).toEqual(entry);
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
 * `Decline(sel)`: the Tagged_Member declines a tag (R11.6). A `pending` tag
 * becomes `declined` and — the property's focus — writes nothing to the
 * Tagged_Member's data: not one canonical repo call is made during the
 * operation. A non-`pending` (already `declined`) tag is rejected with
 * `trip_tag_state_invalid` and, again, no write.
 */
class DeclineCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly sel: number) {}

  check(m: Readonly<Model>): boolean {
    return m.tags.size > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const tagId = [...m.tags.keys()][this.sel % m.tags.size]!;
    const tag = m.tags.get(tagId)!;

    const callsBefore = r.store.probe.calls.length;

    if (tag.state === 'pending') {
      await r.repo.declineRodeWithTag(tagId, tag.taggedMemberId);
      tag.state = 'declined';
    } else {
      await expectAppError(
        () => r.repo.declineRodeWithTag(tagId, tag.taggedMemberId),
        'trip_tag_state_invalid',
      );
    }

    // R11.6 / R11.1: declining (or a rejected decline) performs no canonical
    // write whatsoever.
    expect(r.store.probe.calls.length).toBe(callsBefore);

    assertNoWriteFromPendingOrDeclined(m, r);
  }

  toString(): string {
    return `Decline(#${this.sel})`;
  }
}

/**
 * `Confirm(sel, withRating, ratingValue)`: the Tagged_Member confirms a tag —
 * the negative control. A `pending` tag becomes `confirmed` and the confirm
 * *does* write: it ensures the Tagged_Member's Completion and, when a Rating is
 * supplied, applies it. A non-`pending` tag is rejected with
 * `trip_tag_state_invalid` and writes nothing. This command proves the guard
 * fires on a genuine write and drives tags into the `confirmed` state that the
 * invariant must account for.
 */
class ConfirmCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly sel: number,
    public readonly withRating: boolean,
    public readonly ratingValue: number,
  ) {}

  check(m: Readonly<Model>): boolean {
    return m.tags.size > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const tagId = [...m.tags.keys()][this.sel % m.tags.size]!;
    const tag = m.tags.get(tagId)!;
    const rating = this.withRating ? this.ratingValue : undefined;

    if (tag.state === 'pending') {
      await r.repo.confirmRodeWithTag(tagId, tag.taggedMemberId, rating);
      tag.state = 'confirmed';
      tag.confirmedRating = this.withRating ? this.ratingValue : null;
    } else {
      const callsBefore = r.store.probe.calls.length;
      await expectAppError(
        () => r.repo.confirmRodeWithTag(tagId, tag.taggedMemberId, rating),
        'trip_tag_state_invalid',
      );
      // A rejected confirm on a terminal tag writes nothing (R11.8 / R11.1).
      expect(r.store.probe.calls.length).toBe(callsBefore);
    }

    assertNoWriteFromPendingOrDeclined(m, r);
  }

  toString(): string {
    return `Confirm(#${this.sel}, rating=${this.withRating ? this.ratingValue : 'none'})`;
  }
}

/**
 * `WrongCallerConfirm(sel)` / `WrongCallerDecline(sel)`: a User who is not the
 * Tagged_Member attempts to confirm/decline. Both are rejected with
 * `trip_forbidden`, the tag is left unchanged, and — the point for Property 20
 * — no canonical write occurs, so a `pending` tag stays entirely write-free
 * even under attempted access by the wrong caller (R11.1, R11.7).
 */
class WrongCallerConfirmCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly sel: number) {}

  check(m: Readonly<Model>): boolean {
    return m.tags.size > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const tagId = [...m.tags.keys()][this.sel % m.tags.size]!;
    const callsBefore = r.store.probe.calls.length;

    await expectAppError(
      () => r.repo.confirmRodeWithTag(tagId, `intruder-${randomUUID()}`, 7),
      'trip_forbidden',
    );

    expect(r.store.probe.calls.length).toBe(callsBefore);
    assertNoWriteFromPendingOrDeclined(m, r);
  }

  toString(): string {
    return `WrongCallerConfirm(#${this.sel})`;
  }
}

class WrongCallerDeclineCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly sel: number) {}

  check(m: Readonly<Model>): boolean {
    return m.tags.size > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const tagId = [...m.tags.keys()][this.sel % m.tags.size]!;
    const callsBefore = r.store.probe.calls.length;

    await expectAppError(
      () => r.repo.declineRodeWithTag(tagId, `intruder-${randomUUID()}`),
      'trip_forbidden',
    );

    expect(r.store.probe.calls.length).toBe(callsBefore);
    assertNoWriteFromPendingOrDeclined(m, r);
  }

  toString(): string {
    return `WrongCallerDecline(#${this.sel})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Rode_With_Tag confirm/decline — Property 20: pending/declined never write the Tagged_Member data', () => {
  it('a pending or declined tag leaves the Tagged_Member canonical data untouched; only a confirm writes', async () => {
    const selectorArb = fc.nat({ max: 1000 });
    const ratingArb = fc.integer({ min: 1, max: 10 });
    const commandArb = fc.oneof(
      selectorArb.map((s) => new DeclineCommand(s)),
      fc
        .tuple(selectorArb, fc.boolean(), ratingArb)
        .map(([s, wr, rv]) => new ConfirmCommand(s, wr, rv)),
      selectorArb.map((s) => new WrongCallerConfirmCommand(s)),
      selectorArb.map((s) => new WrongCallerDeclineCommand(s)),
    );

    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (scenario, cmds) => {
          const store = buildStore(scenario);
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            makeRecordingDeps(store),
          );

          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: modelFromScenario(scenario),
            real: { store, repo },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
