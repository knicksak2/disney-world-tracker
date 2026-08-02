// Feature: trips, Property 21: Confirming a Rode_With_Tag links the completion and honors the rating choice
/**
 * Property-based test for confirmation linking and the rating choice (task 10.3).
 *
 * Validates: Requirements 11.2, 11.3, 11.4, 11.5
 *
 * Design Property 21 (design.md → Correctness Properties): for any `pending`
 * Rode_With_Tag confirmed by its Tagged_Member, the Trip_Service ensures the
 * Tagged_Member has a canonical Completion for the referenced Experience linked
 * to the Trip — creating it when absent and leaving an existing one (and its
 * Rating) unaltered — sets a provided valid Rating as the Tagged_Member's single
 * canonical Rating, leaves the canonical Rating unchanged when the update is
 * skipped, and transitions the tag to `confirmed`. Concretely, confirming a
 * pending tag by its Tagged_Member:
 *
 *   - ensures the Tagged_Member's canonical Completion for the Experience: it is
 *     created when the Member had none (R11.2), and an already-present Completion
 *     is linked as-is with its Rating left untouched (R11.3);
 *   - when a valid whole-number 1–10 Rating is supplied, applies it via the
 *     injected Tracking rating repo as the single canonical Rating, whether the
 *     Member previously had one or not (R11.4 / R11.5);
 *   - when no Rating is supplied, leaves the canonical Rating exactly as it was —
 *     absent stays absent, present stays at its old value (R11.5);
 *   - transitions the tag to `confirmed` and writes no Trip_Feed_Item (R11.10).
 *
 * Test strategy
 * -------------
 * A `fast-check` `commands`-style state-machine test driven over the real
 * `createTripRepo` factory (task 10.1) backed by a tiny in-memory fake `pg.Pool`
 * that models exactly the tables `confirmRodeWithTag` touches — `rode_with_tags`
 * and `trip_log_entries` (read for the join). Confirm writes no `trip_feed_items`
 * row (R11.10), so the fake pool has no INSERT branch — a stray feed insert
 * would surface as an unhandled statement. Per the tasks.md convention the
 * stateful property runs against this in-memory model; the SQL repo is pinned to
 * the same behaviour by the cross-service integration tests.
 *
 * The injected canonical Tracking repos are fakes that *record every call* and
 * *apply it* to an in-memory canonical store keyed by `(userId, experienceId)`.
 * The `mark` fake models insert-on-conflict-do-nothing: it ensures the pair is
 * `completed` but never alters an existing entry's Rating — exactly the
 * "leave the existing Completion/Rating unaltered" semantics of R11.3. The
 * `setRating` fake sets the canonical Rating for the pair. Each tag references a
 * distinct Experience and a distinct Tagged_Member, so a canonical entry maps
 * unambiguously to exactly one tag, and each tag is seeded with one of four
 * starting canonical states (none / completion-only / rating-only / both) so the
 * "create when absent" and "leave existing unaltered" branches are both exercised.
 *
 * After every command the model re-derives the expected canonical entry for each
 * tag (completed once confirmed; Rating = supplied value if given else the
 * pre-existing Rating) and asserts the real canonical store matches, that the tag
 * reached `confirmed`, and that `setRating` was called iff a Rating was supplied.
 * The confirm writes no `trip_feed_items` row (R11.10).
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
const LOG_CREATED_AT = '2025-06-15T12:00:00.000Z';

type TagState = 'pending' | 'confirmed' | 'declined';

// ---------------------------------------------------------------------------
// In-memory model of the tables confirm touches
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

/** The whole backing store shared by the fake pool and the fake repos. */
interface Store {
  logEntries: Map<string, LogEntryRow>;
  tags: TagRow[];
  /** Canonical data keyed by `${userId}::${experienceId}`. */
  readonly canonical: Map<string, CanonicalEntry>;
  /** Every delegated canonical-repo call, in order. */
  readonly calls: CanonicalCall[];
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

// ---------------------------------------------------------------------------
// Fake pool: models the `trip_*` SQL confirm emits
// ---------------------------------------------------------------------------

/**
 * Build a fake pool whose `connect()` hands out a transaction client. Confirm
 * runs entirely inside a transaction (BEGIN … COMMIT/ROLLBACK) that locks the
 * tag row, so all its Trip-table SQL flows through the client. A
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
      throw new Error('confirm never uses the non-transactional path');
    },

    async connect(): Promise<FakeClient> {
      let tx: TagRow[] | null = null;

      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<{ rows: unknown[]; rowCount: number }> {
          const sql = norm(text);

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

          // ---- confirm: transition the tag state -------------------
          if (sql.startsWith('UPDATE rode_with_tags')) {
            const [tagId] = params as [string];
            const tag = tx.find((t) => t.id === tagId);
            if (!tag) return { rows: [], rowCount: 0 };
            tag.state = 'confirmed';
            return { rows: [], rowCount: 1 };
          }

          // Confirm writes no feed item (R11.10); a stray INSERT would fall
          // through to the guard below and fail the run.
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
 * Build canonical Completion + Rating stand-ins that record every call and
 * apply it to the canonical store.
 *
 *   - `mark` models insert-on-conflict-do-nothing: it ensures the pair is
 *     `completed` and, crucially, never touches an existing entry's Rating —
 *     this is the "leave the existing Completion/Rating unaltered" semantics of
 *     R11.3.
 *   - `setRating` sets the canonical Rating for the pair (creating an entry when
 *     the Member had a Rating but no Completion is impossible here since confirm
 *     always marks first, but it is handled defensively).
 */
function makeRecordingDeps(store: Store): TripRepoDeps {
  const completions = {
    async mark(input: {
      userId: string;
      experienceId: string;
    }): Promise<null> {
      store.calls.push({
        method: 'completions.mark',
        userId: input.userId,
        experienceId: input.experienceId,
      });
      const key = canonKey(input.userId, input.experienceId);
      const existing = store.canonical.get(key);
      if (existing) {
        // Insert-on-conflict-do-nothing: keep the existing Rating untouched.
        existing.completed = true;
      } else {
        store.canonical.set(key, { completed: true, rating: null });
      }
      return null;
    },
    edit() {
      throw new Error('confirm must not call completions.edit');
    },
    getCompletion() {
      throw new Error('confirm must not call completions.getCompletion');
    },
    unmark() {
      throw new Error('confirm must not call completions.unmark');
    },
  } as unknown as CompletionRepo;

  const ratings = {
    async setRating(
      userId: string,
      experienceId: string,
      value: number,
    ): Promise<{ status: 'set' }> {
      store.calls.push({
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
      throw new Error('confirm must not call ratings.removeRating');
    },
    getRating() {
      throw new Error('confirm must not call ratings.getRating');
    },
  } as unknown as RatingRepo;

  return { completions, ratings };
}

// ---------------------------------------------------------------------------
// Scenario generator — a set of pending rode-with tags with seeded canonical state
// ---------------------------------------------------------------------------

/** Pre-existing canonical state of the Tagged_Member for the tag's Experience. */
type InitialCanonical =
  | { readonly kind: 'none' }
  | { readonly kind: 'completionOnly' }
  | { readonly kind: 'ratingOnly'; readonly rating: number }
  | { readonly kind: 'both'; readonly rating: number };

interface ScenarioTag {
  readonly id: string;
  readonly tripId: string;
  readonly experienceId: string;
  readonly taggingMemberId: string;
  readonly taggedMemberId: string;
  readonly initial: InitialCanonical;
}

const initialCanonicalArb: fc.Arbitrary<InitialCanonical> = fc.oneof(
  fc.constant<InitialCanonical>({ kind: 'none' }),
  fc.constant<InitialCanonical>({ kind: 'completionOnly' }),
  fc
    .integer({ min: 1, max: 10 })
    .map<InitialCanonical>((rating) => ({ kind: 'ratingOnly', rating })),
  fc
    .integer({ min: 1, max: 10 })
    .map<InitialCanonical>((rating) => ({ kind: 'both', rating })),
);

/**
 * A tag references a distinct Experience (so a canonical write maps to exactly
 * one tag), a Tagging_Member and a distinct Tagged_Member, starts `pending`
 * (the confirmable state), and seeds the Tagged_Member's canonical state for
 * the Experience so both the "create when absent" and "leave existing
 * unaltered" branches are covered.
 */
const scenarioTagArb: fc.Arbitrary<ScenarioTag> = initialCanonicalArb.map(
  (initial) => ({
    id: randomUUID(),
    tripId: randomUUID(),
    experienceId: randomUUID(),
    taggingMemberId: randomUUID(),
    taggedMemberId: randomUUID(),
    initial,
  }),
);

const scenarioArb: fc.Arbitrary<ScenarioTag[]> = fc.array(scenarioTagArb, {
  minLength: 1,
  maxLength: 6,
});

/** The canonical entry a seeded initial state materialises to, if any. */
function initialEntry(initial: InitialCanonical): CanonicalEntry | null {
  switch (initial.kind) {
    case 'none':
      return null;
    case 'completionOnly':
      return { completed: true, rating: null };
    case 'ratingOnly':
      return { completed: false, rating: initial.rating };
    case 'both':
      return { completed: true, rating: initial.rating };
  }
}

/** Materialise the scenario into a fresh {@link Store}. */
function buildStore(scenario: ScenarioTag[]): Store {
  const logEntries = new Map<string, LogEntryRow>();
  const tags: TagRow[] = [];
  const canonical = new Map<string, CanonicalEntry>();

  for (const t of scenario) {
    const logEntryId = randomUUID();
    logEntries.set(logEntryId, {
      id: logEntryId,
      tripId: t.tripId,
      experienceId: t.experienceId,
      memberId: t.taggingMemberId,
      createdAt: LOG_CREATED_AT,
    });
    tags.push({
      id: t.id,
      logEntryId,
      taggedMemberId: t.taggedMemberId,
      state: 'pending',
    });
    const seeded = initialEntry(t.initial);
    if (seeded) {
      canonical.set(canonKey(t.taggedMemberId, t.experienceId), { ...seeded });
    }
  }

  return {
    logEntries,
    tags,
    canonical,
    calls: [],
  };
}

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface ModelTag {
  readonly experienceId: string;
  readonly taggedMemberId: string;
  state: TagState;
  /** Expected canonical entry for (taggedMember, experience); null = no entry. */
  expected: CanonicalEntry | null;
}

interface Model {
  /** tagId → its modelled state and expected canonical projection. */
  readonly tags: Map<string, ModelTag>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
}

function modelFromScenario(scenario: ScenarioTag[]): Model {
  const tags = new Map<string, ModelTag>();
  for (const t of scenario) {
    const seeded = initialEntry(t.initial);
    tags.set(t.id, {
      experienceId: t.experienceId,
      taggedMemberId: t.taggedMemberId,
      state: 'pending',
      expected: seeded ? { ...seeded } : null,
    });
  }
  return { tags };
}

/**
 * The property's heart, re-run after every command: the canonical store holds
 * exactly the expected projection for every tag and the tag states match the
 * model. The expected projection encodes Property 21: a confirmed tag
 * is `completed` with a Rating equal to the value supplied at confirm (if any)
 * or the pre-existing Rating (unchanged when skipped); a still-pending tag keeps
 * its seeded canonical state exactly.
 */
function assertConfirmProjection(m: Model, r: Real): void {
  const expectedKeys = new Set<string>();
  for (const tag of m.tags.values()) {
    const key = canonKey(tag.taggedMemberId, tag.experienceId);
    if (tag.expected !== null) {
      expectedKeys.add(key);
      expect(r.store.canonical.get(key)).toEqual(tag.expected);
    } else {
      expect(r.store.canonical.has(key)).toBe(false);
    }
  }
  expect(new Set(r.store.canonical.keys())).toEqual(expectedKeys);
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
 * `Confirm(sel, withRating, ratingValue)`: the Tagged_Member confirms a tag.
 *
 *   - a `pending` tag becomes `confirmed`: its canonical Completion is ensured
 *     (created when absent — R11.2; existing left unaltered — R11.3), a supplied
 *     valid Rating is applied via `setRating` (R11.4 / R11.5), and when no Rating
 *     is supplied the canonical Rating is left unchanged (R11.5). `mark` is
 *     always called; `setRating` is called iff a Rating was supplied.
 *   - a non-`pending` (already `confirmed`) tag is rejected with
 *     `trip_tag_state_invalid` and nothing changes.
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
      const markCallsBefore = r.store.calls.filter(
        (c) => c.method === 'completions.mark',
      ).length;
      const setRatingCallsBefore = r.store.calls.filter(
        (c) => c.method === 'ratings.setRating',
      ).length;

      const result = await r.repo.confirmRodeWithTag(
        tagId,
        tag.taggedMemberId,
        rating,
      );

      // The confirm returns the linked tag/trip/experience identity.
      expect(result.tagId).toBe(tagId);
      expect(result.experienceId).toBe(tag.experienceId);

      // R11.2 / R11.3: the Completion is always ensured via the injected repo,
      // targeting the Tagged_Member and the referenced Experience.
      const markCalls = r.store.calls.filter(
        (c) => c.method === 'completions.mark',
      );
      expect(markCalls.length).toBe(markCallsBefore + 1);
      const lastMark = markCalls[markCalls.length - 1]!;
      expect(lastMark.userId).toBe(tag.taggedMemberId);
      expect(lastMark.experienceId).toBe(tag.experienceId);

      // R11.4 / R11.5: setRating is invoked exactly when a Rating was supplied.
      const setRatingCalls = r.store.calls.filter(
        (c) => c.method === 'ratings.setRating',
      );
      if (this.withRating) {
        expect(setRatingCalls.length).toBe(setRatingCallsBefore + 1);
        const lastSet = setRatingCalls[setRatingCalls.length - 1]!;
        expect(lastSet.userId).toBe(tag.taggedMemberId);
        expect(lastSet.experienceId).toBe(tag.experienceId);
        expect(lastSet.value).toBe(this.ratingValue);
      } else {
        expect(setRatingCalls.length).toBe(setRatingCallsBefore);
      }

      // Advance the model: confirmed, completed, and the Rating honours the
      // caller's choice — supplied value or the pre-existing value untouched.
      const priorRating = tag.expected?.rating ?? null;
      tag.expected = {
        completed: true,
        rating: this.withRating ? this.ratingValue : priorRating,
      };
      tag.state = 'confirmed';
    } else {
      const callsBefore = r.store.calls.length;
      await expectAppError(
        () => r.repo.confirmRodeWithTag(tagId, tag.taggedMemberId, rating),
        'trip_tag_state_invalid',
      );
      // A rejected confirm on a terminal tag writes nothing (R11.8).
      expect(r.store.calls.length).toBe(callsBefore);
    }

    assertConfirmProjection(m, r);
  }

  toString(): string {
    return `Confirm(#${this.sel}, rating=${this.withRating ? this.ratingValue : 'none'})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Rode_With_Tag confirm — Property 21: confirmation links the completion and honors the rating choice', () => {
  it('ensures the completion (creating when absent, leaving existing unaltered), applies a supplied rating, leaves it unchanged when skipped, and confirms the tag', async () => {
    const selectorArb = fc.nat({ max: 1000 });
    const ratingArb = fc.integer({ min: 1, max: 10 });
    const commandArb = fc
      .tuple(selectorArb, fc.boolean(), ratingArb)
      .map(([s, wr, rv]) => new ConfirmCommand(s, wr, rv));

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
