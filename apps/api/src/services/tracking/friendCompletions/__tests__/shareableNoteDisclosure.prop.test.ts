// Feature: friend-stats-viewing, Property 6: Shareable-note disclosure is opaque
// for absent and private Notes. For any Completion_Entry, the shared-note value
// equals the Friend's Note body when a Note exists AND is marked shareable, and
// is exactly `null` in BOTH the no-Note case and the present-but-private case,
// so the response cannot distinguish a private Note from no Note at all.
/**
 * Property-based test for the Friend Completions read's shareable-note
 * disclosure (task 3.3).
 *
 * Validates: Requirements 4.6, 4.7
 *
 * The disclosure decision lives SQL-side in `repo.ts` as the projection
 *
 *   CASE WHEN n.shareable THEN n.body ELSE NULL END AS shared_note
 *
 * combined with a `LEFT JOIN notes`, so that:
 *
 *   - absent Note            → the LEFT JOIN yields NULL for every `n.*`
 *                              column → `shared_note = NULL`;
 *   - present-but-private    → `n.shareable = FALSE` → the CASE's ELSE arm
 *                              yields `NULL` (the body is never read out);
 *   - present-and-shareable  → `n.shareable = TRUE`  → `shared_note = n.body`.
 *
 * Because the decision is enforced in SQL (exercised end-to-end by the
 * integration test, task 4.4), this property test models that exact CASE rule
 * in a hermetic fake `pg.Pool`: given a generated Note state (absent /
 * present-private / present-shareable) plus a body, the fake pool emits the
 * `shared_note` column the production SQL would emit, and the test asserts the
 * repo's row → `CompletionEntry` mapping carries that value through faithfully
 * AND that the absent and present-private cases are byte-for-byte
 * indistinguishable (`null`) regardless of the underlying private body.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { createFriendCompletionsRepo } from '../repo.js';

const NUM_RUNS = 100;

const TARGET_USER_ID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Generated Note state
// ---------------------------------------------------------------------------

/**
 * The three Note states a Completion_Entry can be in for the purposes of
 * shareable-note disclosure. `body` is the underlying Note body that the
 * owner wrote; it is only ever disclosed when `kind === 'shareable'`.
 */
type NoteKind = 'absent' | 'private' | 'shareable';

interface GeneratedEntry {
  readonly experienceName: string;
  readonly park: (typeof PARKS)[number];
  readonly category: (typeof EXPERIENCE_CATEGORIES)[number];
  readonly completedOn: string;
  readonly rating: number | null;
  readonly note: { readonly kind: NoteKind; readonly body: string };
}

const entryArb: fc.Arbitrary<GeneratedEntry> = fc.record({
  experienceName: fc.string({ minLength: 1, maxLength: 40 }),
  park: fc.constantFrom(...PARKS),
  category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
  completedOn: fc
    .date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
    .map((d) => d.toISOString().slice(0, 10)),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  note: fc.record({
    kind: fc.constantFrom<NoteKind>('absent', 'private', 'shareable'),
    // Include the empty string deliberately: a shareable empty-body Note must
    // still surface "" (distinct from the `null` no-shared-note indicator).
    body: fc.string({ maxLength: 60 }),
  }),
});

// ---------------------------------------------------------------------------
// Fake pool that mirrors the production SQL `shared_note` projection
// ---------------------------------------------------------------------------

/**
 * Apply the exact SQL disclosure rule the repo relies on:
 *   LEFT JOIN notes + CASE WHEN n.shareable THEN n.body ELSE NULL END.
 * Absent and private both collapse to `null`; only shareable yields the body.
 */
function sqlSharedNote(note: GeneratedEntry['note']): string | null {
  return note.kind === 'shareable' ? note.body : null;
}

/**
 * Build a fake `pg.Pool` whose single `query()` returns one row per generated
 * entry, with the `shared_note` column already resolved through the modeled
 * CASE rule (exactly as Postgres would hand it back to the repo).
 */
function makePool(entries: readonly GeneratedEntry[]) {
  return {
    async query(_text: string, _params?: ReadonlyArray<unknown>) {
      return {
        rows: entries.map((e) => ({
          experience_name: e.experienceName,
          park: e.park,
          category: e.category,
          completed_on: e.completedOn,
          rating: e.rating,
          shared_note: sqlSharedNote(e.note),
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Property 6
// ---------------------------------------------------------------------------

describe('Friend Completions — Property 6: shareable-note disclosure is opaque', () => {
  it('sharedNote equals the body iff a shareable Note exists, else null', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(entryArb, { maxLength: 30 }), async (entries) => {
        const repo = createFriendCompletionsRepo(makePool(entries) as never);
        const result = await repo.listCompletions(TARGET_USER_ID);

        expect(result).toHaveLength(entries.length);

        for (let i = 0; i < entries.length; i += 1) {
          const note = entries[i]!.note;
          const got = result[i]!.sharedNote;

          if (note.kind === 'shareable') {
            // The body — and only the body — is disclosed for a shareable Note.
            expect(got).toBe(note.body);
          } else {
            // Both no-Note and present-but-private disclose nothing: null.
            expect(got).toBeNull();
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('absent and present-private are indistinguishable regardless of body', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Same surrounding entry; only the Note state differs between the two
        // runs. The private run carries an arbitrary body that must never leak.
        entryArb,
        fc.string({ maxLength: 60 }),
        async (base, privateBody) => {
          const repo = createFriendCompletionsRepo;

          const absent: GeneratedEntry = {
            ...base,
            note: { kind: 'absent', body: '' },
          };
          const priv: GeneratedEntry = {
            ...base,
            note: { kind: 'private', body: privateBody },
          };

          const absentResult = await repo(makePool([absent]) as never).listCompletions(
            TARGET_USER_ID,
          );
          const privateResult = await repo(makePool([priv]) as never).listCompletions(
            TARGET_USER_ID,
          );

          // The two responses are byte-for-byte identical: a private Note is
          // indistinguishable from no Note at all (R4.7).
          expect(privateResult).toEqual(absentResult);
          expect(absentResult[0]!.sharedNote).toBeNull();
          expect(privateResult[0]!.sharedNote).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------

describe('Friend Completions — Property 6 fixed examples', () => {
  const base = {
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom' as const,
    category: 'Ride' as const,
    completedOn: '2025-01-15',
    rating: 9 as number | null,
  };

  it('discloses a shareable Note body verbatim', async () => {
    const repo = createFriendCompletionsRepo(
      makePool([{ ...base, note: { kind: 'shareable', body: 'Best ride ever' } }]) as never,
    );
    const [entry] = await repo.listCompletions(TARGET_USER_ID);
    expect(entry!.sharedNote).toBe('Best ride ever');
  });

  it('withholds a private Note body as null', async () => {
    const repo = createFriendCompletionsRepo(
      makePool([{ ...base, note: { kind: 'private', body: 'secret thoughts' } }]) as never,
    );
    const [entry] = await repo.listCompletions(TARGET_USER_ID);
    expect(entry!.sharedNote).toBeNull();
  });

  it('reports null when no Note exists', async () => {
    const repo = createFriendCompletionsRepo(
      makePool([{ ...base, note: { kind: 'absent', body: '' } }]) as never,
    );
    const [entry] = await repo.listCompletions(TARGET_USER_ID);
    expect(entry!.sharedNote).toBeNull();
  });

  it('discloses a shareable empty-body Note as "" (distinct from null)', async () => {
    const repo = createFriendCompletionsRepo(
      makePool([{ ...base, note: { kind: 'shareable', body: '' } }]) as never,
    );
    const [entry] = await repo.listCompletions(TARGET_USER_ID);
    expect(entry!.sharedNote).toBe('');
    expect(entry!.sharedNote).not.toBeNull();
  });
});
