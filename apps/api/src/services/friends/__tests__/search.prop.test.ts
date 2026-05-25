// Feature: disney-world-tracker, Property 20: search returns case-insensitive substring matches over population minus requester, capped at 50
/**
 * Property-based test for `Friends_Service.searchUsers` (task 7.3).
 *
 * Validates: Requirements 8.1
 *
 * Property 20 (design.md → Correctness Properties):
 *
 *   For any User population, search query of length `1..100`, and
 *   requesting User `r`, the result set is exactly the case-insensitive
 *   substring matches on `displayName` or `email` over the population
 *   minus `{r}`, capped at 50 entries.
 *
 * The repo's `searchUsers` ships an `ILIKE $2 ESCAPE '\'` query against
 * Postgres. The user-supplied query is escaped (so an attacker passing
 * `%` cannot match every row) and then wrapped with `%...%` so the
 * resulting pattern is a pure substring search. The hard 50-row cap is
 * enforced both by the SQL `LIMIT $3` and by a JS clamp inside the
 * repo, so a misconfigured caller can never blow past R8.1's
 * "up to 50 Users" upper bound.
 *
 * To exercise this end-to-end without spinning up Postgres, the test
 * drives the real `createFriendsRepo` against a fake pool that:
 *
 *   1. Recognises the `searchUsers` projection (and only that).
 *   2. Re-implements Postgres `ILIKE ... ESCAPE '\'` semantics in JS
 *      against the in-memory population — `%` → "any sequence", `_` →
 *      "any single character", `\X` → "literal X". This is the bit
 *      that makes the test meaningful: if the repo failed to escape a
 *      `%` or `_` in the user query, the fake's ILIKE matcher (which
 *      receives the escaped pattern) would still expand the
 *      pre-existing wildcards from the *column value* differently from
 *      the oracle's pure substring search, and the property would fail.
 *   3. Filters out the requester id, sorts by `lower(display_name)
 *      ASC, id ASC` to mirror the SQL `ORDER BY` clause, and applies
 *      the `LIMIT $3` cap.
 *
 * The oracle is a from-scratch reimplementation of the contract in
 * Property 20: case-insensitive substring on `displayName` OR `email`,
 * exclude the requester, cap at 50, ordered the same way as the repo.
 *
 * Generator notes:
 *
 *   - **Population**: 0..100 users with sequential ids `u-0, u-1, ...`
 *     so id uniqueness is structural. Display name and email are drawn
 *     from printable ASCII (0x20..0x7E) so JS `toLowerCase()` and
 *     Postgres `LOWER` agree on case folding — the test would otherwise
 *     trip on locale-sensitive cases like `ı/I` or `ß/SS` that have
 *     different lowercase forms in different locales. Property 20 is
 *     about substring matching, not locale handling, so restricting to
 *     ASCII keeps the property tight.
 *   - **Query**: 1..100 printable ASCII characters per R8.1's length
 *     bound. The full ASCII range is in scope so the SQL-wildcard
 *     escape path (`%`, `_`, `\`) is exercised on most runs.
 *   - **Requester id**: drawn from `u-0..u-120` so it lands inside the
 *     population on most runs (exercising self-exclusion) and outside
 *     it on the rest (exercising the no-op branch).
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { createFriendsRepo, type FriendSearchHit } from '../repo.js';

const NUM_RUNS = 100;

/** Hard cap on user-search result size (R8.1, repeated here for the oracle). */
const SEARCH_RESULT_CAP = 50;

// ---------------------------------------------------------------------------
// In-memory user model
// ---------------------------------------------------------------------------

interface User {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

// ---------------------------------------------------------------------------
// ILIKE matcher — Postgres `ILIKE ... ESCAPE '\'` semantics in JS
// ---------------------------------------------------------------------------

/**
 * Escape a single character for inclusion as a literal in a JS regex.
 *
 * ILIKE patterns can produce arbitrary characters as literals (after
 * unescaping `\X`), and many of those are regex metacharacters
 * (`.+*?()[]{}|^$\`). Escaping them keeps the regex faithful to a
 * "match this exact character" semantics.
 */
function escapeRegexChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Translate a Postgres ILIKE pattern (with `\` as the escape character)
 * into a JS regex source string anchored to the full input. This is the
 * same translation Postgres performs internally, just expressed as a
 * regex so the test can run without a database:
 *
 *   - `\X` → literal `X`, regex-escaped (so `\%` → `%`, `\\` → `\`).
 *   - `%`  → `.*` (any sequence of zero or more characters).
 *   - `_`  → `.` (exactly one character).
 *   - any other character → that character, regex-escaped.
 */
function ilikePatternToRegex(pattern: string): RegExp {
  let body = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i] as string;
    if (ch === '\\') {
      // Whatever follows is a literal. If `\` is the last character,
      // Postgres treats the trailing `\` as a literal `\`; emulate that
      // by emitting a literal backslash. The repo's escape function
      // never produces a trailing `\`, but the fake stays honest in
      // case a future test passes a hand-crafted pattern.
      const next = pattern[i + 1];
      if (next === undefined) {
        body += escapeRegexChar('\\');
        break;
      }
      body += escapeRegexChar(next);
      i += 1;
    } else if (ch === '%') {
      body += '.*';
    } else if (ch === '_') {
      body += '.';
    } else {
      body += escapeRegexChar(ch);
    }
  }
  // `i` flag → ASCII case-insensitive, which agrees with JS
  // `String.prototype.toLowerCase` for the printable-ASCII range used
  // by the population generators. `s` flag → `.` matches `\n` so a
  // display name containing a newline is not silently truncated.
  return new RegExp(`^${body}$`, 'isu');
}

/** Run a Postgres ILIKE pattern against `input`. */
function ilikeMatch(input: string, pattern: string): boolean {
  return ilikePatternToRegex(pattern).test(input);
}

// ---------------------------------------------------------------------------
// Fake pool — recognises searchUsers' projection only
// ---------------------------------------------------------------------------

interface FakePoolResult {
  readonly rows: ReadonlyArray<unknown>;
  readonly rowCount?: number;
}

/**
 * Build a `DbPool`-shaped fake whose `query` faithfully simulates the
 * `searchUsers` projection against an in-memory population. Any other
 * SQL is rejected so a regression that asks the repo to issue a
 * different query surfaces immediately rather than silently passing.
 */
function makeFakePool(population: ReadonlyArray<User>): DbPool {
  const fake = {
    async query(
      text: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<FakePoolResult> {
      // The repo issues exactly one SELECT for searchUsers; identify it
      // by a fragment that no other repo method emits.
      if (
        !text.includes('SELECT u.id, p.display_name') ||
        !text.includes('FROM users u')
      ) {
        throw new Error(`unexpected SQL in searchUsers fake: ${text}`);
      }
      const requesterId = String(params[0]);
      const pattern = String(params[1]);
      const limit = Number(params[2]);

      const matched = population.filter((u) => {
        if (u.id === requesterId) return false;
        return (
          ilikeMatch(u.displayName, pattern) ||
          ilikeMatch(u.email, pattern)
        );
      });
      // Mirror `ORDER BY lower(p.display_name) ASC, u.id ASC`. The
      // sort is applied to a fresh array so the population reference
      // is left undisturbed across repeated calls in a single run.
      const ordered = [...matched].sort(compareSearchHit);
      const limited = ordered.slice(0, limit);
      return {
        rows: limited.map((u) => ({
          id: u.id,
          display_name: u.displayName,
          email: u.email,
        })),
      };
    },
    async connect(): Promise<never> {
      // searchUsers never opens a transaction; surfacing this as a
      // hard error keeps the fake from accidentally covering for a
      // future repo change that introduces one.
      throw new Error('searchUsers fake: connect() must not be called');
    },
  };
  return fake as unknown as DbPool;
}

/**
 * Compare two users using the same `(lower(display_name), id)`
 * lexicographic order the SQL `ORDER BY` clause produces.
 */
function compareSearchHit(a: User, b: User): number {
  const la = a.displayName.toLowerCase();
  const lb = b.displayName.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Oracle — the literal statement of Property 20
// ---------------------------------------------------------------------------

/**
 * Compute the expected search result directly from the contract:
 * case-insensitive substring on `displayName` OR `email`, exclude the
 * requester, sort by `(lower(displayName), id)`, cap at 50.
 *
 * Implemented with `String.prototype.includes` on lower-cased values so
 * the oracle is independent of the ILIKE pattern translation in the
 * fake pool — that independence is what makes the property meaningful.
 */
function oracleSearch(
  population: ReadonlyArray<User>,
  requesterId: string,
  query: string,
): ReadonlyArray<FriendSearchHit> {
  const needle = query.toLowerCase();
  const matched = population.filter((u) => {
    if (u.id === requesterId) return false;
    return (
      u.displayName.toLowerCase().includes(needle) ||
      u.email.toLowerCase().includes(needle)
    );
  });
  const ordered = [...matched].sort(compareSearchHit);
  return ordered.slice(0, SEARCH_RESULT_CAP).map((u) => ({
    id: u.id,
    displayName: u.displayName,
    email: u.email,
  }));
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Printable ASCII characters (0x20..0x7E). */
const PRINTABLE_ASCII: ReadonlyArray<string> = Array.from(
  { length: 0x7e - 0x20 + 1 },
  (_, i) => String.fromCharCode(0x20 + i),
);

const asciiStringArb = (minLength: number, maxLength: number) =>
  fc.stringOf(fc.constantFrom(...PRINTABLE_ASCII), {
    minLength,
    maxLength,
  });

/**
 * Population of 0..100 users with structurally-unique sequential ids.
 * Display name and email are independently random ASCII strings so the
 * matcher must run on both columns to find every hit.
 */
const populationArb: fc.Arbitrary<ReadonlyArray<User>> = fc
  .array(
    fc.record({
      displayName: asciiStringArb(0, 30),
      email: asciiStringArb(0, 30),
    }),
    { minLength: 0, maxLength: 100 },
  )
  .map((items) =>
    items.map(
      (item, i): User => ({
        id: `u-${i}`,
        displayName: item.displayName,
        email: item.email,
      }),
    ),
  );

/** Query length 1..100 per R8.1 (Property 20's "length 1..100" clause). */
const queryArb = asciiStringArb(1, 100);

/**
 * Requester id drawn from `u-0..u-120`. With population size up to 100
 * this puts the requester inside the population on most runs (so the
 * self-exclusion branch fires) and outside it on the rest (so the
 * no-op branch fires).
 */
const requesterIdArb: fc.Arbitrary<string> = fc
  .nat({ max: 120 })
  .map((n) => `u-${n}`);

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('Friends_Service.searchUsers — Property 20: substring scope, self-exclusion, 50-cap', () => {
  it('returns exactly the case-insensitive substring matches on (displayName or email) over population minus requester, capped at 50', async () => {
    await fc.assert(
      fc.asyncProperty(
        populationArb,
        queryArb,
        requesterIdArb,
        async (population, query, requesterId) => {
          const repo = createFriendsRepo(makeFakePool(population));
          const actual = await repo.searchUsers(requesterId, query);
          const expected = oracleSearch(population, requesterId, query);
          expect(actual).toEqual(expected);
          // Cap is part of the property statement; assert it explicitly
          // so a regression that lifts the limit (e.g. by passing a
          // bigger custom limit) shows up as a clear failure rather
          // than as a downstream `toEqual` mismatch.
          expect(actual.length).toBeLessThanOrEqual(SEARCH_RESULT_CAP);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
