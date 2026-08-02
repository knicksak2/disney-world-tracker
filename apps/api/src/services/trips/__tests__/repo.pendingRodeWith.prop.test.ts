// Feature: notification-center, Property 9: Rode-with pending read is scoped, filtered, ordered, and complete
/**
 * Property-based test for the rode-with pending read repo (task 2.4).
 *
 * **Validates: Requirements 3.1, 3.2, 3.3**
 *
 * Design Property 9 (design.md → Correctness Properties):
 *
 *   For any population of rode-with tags across arbitrary users and states,
 *   `GET /me/rode-with-tags?state=pending` for a given caller returns exactly
 *   the tags whose tagged member is that caller and whose state is `pending`,
 *   excludes every tag that is not pending or belongs to another user, orders
 *   the result by creation timestamp descending, and populates every required
 *   field (tag identifier, linked trip-log-entry identifier, referenced
 *   Experience name, tagging member display name, creation timestamp) for each
 *   returned tag.
 *
 * Test strategy
 * -------------
 * Following the `repo.readProjections.prop.test.ts` / `repo.ownerScoped.prop`
 * convention, this property runs the *real* `createTripRepo` factory over a
 * tiny in-memory fake `pg.Pool` that models exactly the one `pool.query` SQL
 * `listPendingRodeWithTags` emits — the scoped/filtered/ordered join across
 * `rode_with_tags` → `trip_log_entries` → `experiences` → `profiles`. The fake
 * pool faithfully applies the `WHERE tagged_member_id = $1 AND state = 'pending'`
 * scope+filter and the `ORDER BY created_at DESC, id ASC` ordering that
 * Postgres would, and projects the same five columns, so the property exercises
 * the production read path (query dispatch + row→DTO mapper) rather than a
 * re-implementation of it. Per the tasks.md convention the property runs
 * against this in-memory model; the SQL repo is pinned to the same behaviour by
 * the route example/integration tests (task 3.2).
 *
 * Each run generates an arbitrary population of rode-with tags spread across
 * several users (as both Tagged_Member and Tagging_Member), all four tag
 * states, arbitrary Experiences, and creation timestamps that deliberately
 * collide so the `id` tie-break is exercised. For a randomly chosen caller the
 * property asserts:
 *   - completeness + scope + filter: the returned tag-id set equals exactly the
 *     set of tags whose `taggedMemberId` is the caller and whose state is
 *     `pending` (R3.1, R3.2);
 *   - exclusion: no returned tag belongs to another user or is non-pending;
 *   - ordering: the result is sorted by `createdAt` descending, then `tagId`
 *     ascending (R3.1);
 *   - projection: every required field is populated and matches the seeded
 *     source row (R3.3).
 *
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { RodeWithTagState } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createTripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

/** The fixed set of Users, each usable as Tagged_Member and Tagging_Member. */
interface User {
  readonly userId: string;
  readonly displayName: string;
}
const USERS: readonly User[] = [
  { userId: '00000000-0000-4000-8000-000000000000', displayName: 'Olivia Organizer' },
  { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Aaron Member' },
  { userId: '22222222-2222-4222-8222-222222222222', displayName: 'Bianca Member' },
  { userId: '33333333-3333-4333-8333-333333333333', displayName: 'Carlos Member' },
] as const;

/** A fixed Catalog of Experiences the read projection references by name. */
interface CatalogExperience {
  readonly id: string;
  readonly name: string;
}
const CATALOG: readonly CatalogExperience[] = [
  { id: 'e0000000-0000-4000-8000-000000000001', name: 'Space Mountain' },
  { id: 'e0000000-0000-4000-8000-000000000002', name: 'Test Track' },
  { id: 'e0000000-0000-4000-8000-000000000003', name: 'Tower of Terror' },
  { id: 'e0000000-0000-4000-8000-000000000004', name: 'Expedition Everest' },
] as const;

const TAG_STATES: readonly RodeWithTagState[] = [
  'pending',
  'confirmed',
  'declined',
  'cancelled',
] as const;

/**
 * Base instant the per-tag `created_at` is offset from. `tsBucket` is a small
 * integer so distinct tags routinely share a `created_at`, forcing the
 * `id ASC` tie-break in the `ORDER BY created_at DESC, id ASC` to be exercised.
 */
const BASE_MS = Date.UTC(2024, 0, 1, 12, 0, 0);

function userOf(idx: number): User {
  return USERS[idx % USERS.length]!;
}
function experienceOf(idx: number): CatalogExperience {
  return CATALOG[idx % CATALOG.length]!;
}

// ---------------------------------------------------------------------------
// In-memory store the read projection touches
// ---------------------------------------------------------------------------

interface LogEntryRow {
  readonly id: string;
  /** The Tagging_Member (logger) whose display name the read joins. */
  readonly memberId: string;
  readonly experienceId: string;
}

interface RodeWithTagRow {
  readonly id: string;
  readonly logEntryId: string;
  readonly taggedMemberId: string;
  readonly state: RodeWithTagState;
  readonly createdAt: Date;
}

interface Store {
  readonly profiles: ReadonlyMap<string, string>;
  readonly experiences: ReadonlyMap<string, string>;
  readonly logEntries: Map<string, LogEntryRow>;
  readonly tags: RodeWithTagRow[];
}

function makeStore(): Store {
  const profiles = new Map<string, string>();
  for (const u of USERS) profiles.set(u.userId, u.displayName);
  const experiences = new Map<string, string>();
  for (const e of CATALOG) experiences.set(e.id, e.name);
  return { profiles, experiences, logEntries: new Map(), tags: [] };
}

// ---------------------------------------------------------------------------
// Fake pool: dispatches the exact `pool.query` SQL the pending read emits
// ---------------------------------------------------------------------------

interface QueryResult {
  rows: unknown[];
  rowCount: number;
}

/** Collapse SQL whitespace so multi-line statements match on a stable prefix. */
function norm(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** Order by `created_at` DESC then `id` ASC, matching the repo's ORDER BY. */
function orderPending(tags: readonly RodeWithTagRow[]): RodeWithTagRow[] {
  return [...tags].sort((a, b) => {
    const at = a.createdAt.getTime();
    const bt = b.createdAt.getTime();
    if (at !== bt) return bt - at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

interface FakeQueryPool {
  query(text: unknown, params?: unknown): Promise<QueryResult>;
}

/**
 * Build a fake pool whose `query` models `listPendingRodeWithTags`'s single
 * statement against the shared `Store`: it applies the caller scope and the
 * `pending` filter, orders by `created_at DESC, id ASC`, and projects the five
 * columns the repo's row→DTO mapper reads. Anything else fails loudly so a
 * future SQL drift is surfaced by the test rather than silently ignored.
 */
function makeFakePool(store: Store): FakeQueryPool {
  const ok = (rows: unknown[]): QueryResult => ({ rows, rowCount: rows.length });

  return {
    async query(text: unknown, params: unknown = []): Promise<QueryResult> {
      const sql = norm(String(text));
      const args = params as ReadonlyArray<unknown>;

      if (sql.startsWith('SELECT rwt.id')) {
        const [userId] = args as [string];
        const matching = orderPending(
          store.tags.filter(
            (t) => t.taggedMemberId === userId && t.state === 'pending',
          ),
        );
        const rows = matching.map((t) => {
          const le = store.logEntries.get(t.logEntryId)!;
          return {
            tag_id: t.id,
            trip_log_entry_id: le.id,
            experience_name: store.experiences.get(le.experienceId)!,
            tagging_member_display_name: store.profiles.get(le.memberId)!,
            created_at: t.createdAt,
          };
        });
        return ok(rows);
      }

      throw new Error(`unhandled SQL in fake pool: ${sql.slice(0, 80)}`);
    },
  };
}

/** The pending read never touches the canonical repos; stand-ins satisfy the type. */
const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

interface TagSpec {
  readonly taggedIdx: number;
  readonly taggingIdx: number;
  readonly experienceIdx: number;
  readonly stateIdx: number;
  /** Small bucket → colliding `created_at` values so the id tie-break bites. */
  readonly tsBucket: number;
}

const tagSpecArb: fc.Arbitrary<TagSpec> = fc.record({
  taggedIdx: fc.nat({ max: USERS.length - 1 }),
  taggingIdx: fc.nat({ max: USERS.length - 1 }),
  experienceIdx: fc.nat({ max: CATALOG.length - 1 }),
  stateIdx: fc.nat({ max: TAG_STATES.length - 1 }),
  tsBucket: fc.nat({ max: 5 }),
});

/** Seed the store from the generated specs, returning the seeded tag rows. */
function seedStore(store: Store, specs: readonly TagSpec[]): void {
  for (const spec of specs) {
    const tagging = userOf(spec.taggingIdx);
    const exp = experienceOf(spec.experienceIdx);
    const logEntryId = randomUUID();
    store.logEntries.set(logEntryId, {
      id: logEntryId,
      memberId: tagging.userId,
      experienceId: exp.id,
    });
    store.tags.push({
      id: randomUUID(),
      logEntryId,
      taggedMemberId: userOf(spec.taggedIdx).userId,
      state: TAG_STATES[spec.stateIdx % TAG_STATES.length]!,
      createdAt: new Date(BASE_MS + spec.tsBucket * 1000),
    });
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Rode-with pending read — Property 9: pending read is scoped, filtered, ordered, and complete', () => {
  it('returns exactly the caller\'s pending tags, excludes others, orders by created_at DESC, and populates every field', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(tagSpecArb, { maxLength: 30 }),
        fc.nat({ max: USERS.length - 1 }),
        async (specs, callerIdx) => {
          const store = makeStore();
          seedStore(store, specs);
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            NOOP_DEPS,
          );
          const caller = userOf(callerIdx);

          const dtos = await repo.listPendingRodeWithTags(caller.userId);

          // Independent oracle: the caller's pending tags, ordered DESC/id ASC.
          const expected = orderPending(
            store.tags.filter(
              (t) => t.taggedMemberId === caller.userId && t.state === 'pending',
            ),
          );

          // Completeness + scope + filter (R3.1, R3.2): exact tag-id sequence.
          expect(dtos.map((d) => d.tagId)).toEqual(expected.map((t) => t.id));

          // Exclusion (R3.1, R3.2): no returned tag belongs to another user or
          // is non-pending — checked against the full seeded population.
          const tagById = new Map(store.tags.map((t) => [t.id, t]));
          for (const dto of dtos) {
            const src = tagById.get(dto.tagId)!;
            expect(src).toBeDefined();
            expect(src.taggedMemberId).toBe(caller.userId);
            expect(src.state).toBe('pending');
          }

          // Ordering (R3.1): created_at strictly non-increasing, id ascending
          // within an equal-timestamp run.
          for (let i = 1; i < dtos.length; i += 1) {
            const prev = tagById.get(dtos[i - 1]!.tagId)!;
            const cur = tagById.get(dtos[i]!.tagId)!;
            const pt = prev.createdAt.getTime();
            const ct = cur.createdAt.getTime();
            expect(pt).toBeGreaterThanOrEqual(ct);
            if (pt === ct) {
              expect(prev.id < cur.id).toBe(true);
            }
          }

          // Projection (R3.3): every required field populated and matching the
          // seeded source row.
          for (const dto of dtos) {
            const src = tagById.get(dto.tagId)!;
            const le = store.logEntries.get(src.logEntryId)!;
            expect(dto.tagId).toBe(src.id);
            expect(dto.tripLogEntryId).toBe(le.id);
            expect(dto.experienceName).toBe(store.experiences.get(le.experienceId));
            expect(dto.taggingMemberDisplayName).toBe(
              store.profiles.get(le.memberId),
            );
            expect(dto.createdAt).toBe(src.createdAt.toISOString());
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
