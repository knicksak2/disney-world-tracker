/**
 * Structural visibility guard (account-deletion R5.8, R5.13; design "The visibility guard: one rule, one allowlist").
 *
 * ONE rule. Every outermost SQL literal in a non-test `.ts` file under `apps/api/src/**` that matches
 * `(FROM|JOIN) (profiles|users|friendships)` is a hit. A hit PASSES when the SAME literal contains `ACTIVE_USER_SQL(`
 * or `deletion_state = 'active'`. Every other hit must be covered by a per-file allowlist entry
 * `{ file, reason, hits }`: a non-empty one-line reason and the pinned count of non-passing hits in that file, so a new
 * raw query is caught both in an unlisted file and inside a listed one. The views (`profile_identity`,
 * `active_friendships`, `active_trip_memberships`) never match, which is the point of them.
 *
 * The pinned counts are the guard's own report on the finished, fully converted tree. Never extend an allowlist to
 * make a new unsafe query pass: convert the query to a view or to `ACTIVE_USER_SQL`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { allowlistProblems, listSourceFiles, literalsOf, literalsOfFile, SRC_ROOT } from './guardScan.js';

export const HIT = /\b(FROM|JOIN)\s+(profiles|users|friendships)\b/i;
const PASSES = (literal: string): boolean => literal.includes('ACTIVE_USER_SQL(') || literal.includes("deletion_state = 'active'");

export interface AllowlistEntry {
  readonly file: string;
  /** One line: why this file may read the raw table. */
  readonly reason: string;
  /** Pinned count of NON-passing hits (literals) in the file. */
  readonly hits: number;
}

/** Non-passing hits (literals) of one source text. Exported for the negative fixtures. */
export function nonPassingHits(text: string, fileName = 'fixture.ts'): number {
  return literalsOf(text, fileName).filter((l) => HIT.test(l) && !PASSES(l)).length;
}

/**
 * Pinned from the guard's own report on the finished tree. Every file here reads a raw table for a reason that is not
 * "showing another user"; a new raw query anywhere (listed file or not) fails the guard until it is converted.
 */
export const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    file: 'composeServices.ts',
    reason: "The session adapter joins users to read the session owner's own deletion_state (R4.8); it never reads another user.",
    hits: 1,
  },
  {
    file: 'services/accountDeletion/repo.ts',
    reason: 'The feature itself: state transitions, grant checks, the purge claim, trip roster facts and finalize act on one account by id.',
    hits: 7,
  },
  {
    file: 'services/admin/repo.ts',
    reason: 'Admin is not another user (R5.7): it sees a pending account with its status and excludes tombstones explicitly.',
    hits: 5,
  },
  {
    file: 'services/auth/routes.ts',
    reason: "Sign-in, change-password and GET /me read the caller's own row; eligibility is classified from deletion_state selected in the same query.",
    hits: 4,
  },
  {
    file: 'services/friends/repo.ts',
    reason: 'DELETE FROM friendships in removeFriend is a write, and writes must target the base table.',
    hits: 1,
  },
  {
    file: 'services/tripExpenses/repo.ts',
    reason: "findNonVisibleParties must find the NON-active accounts, so its literal says deletion_state <> 'active', the one place that rule is written.",
    hits: 1,
  },
];

function report(): Map<string, number> {
  const out = new Map<string, number>();
  for (const file of listSourceFiles()) {
    const n = literalsOfFile(file).filter((l) => HIT.test(l) && !PASSES(l)).length;
    if (n > 0) out.set(file, n);
  }
  return out;
}

describe('visibility guard: scanner (negative fixtures)', () => {
  it('a raw read with no predicate is a non-passing hit', () => {
    expect(nonPassingHits("const q = 'SELECT id FROM users WHERE id = $1';")).toBe(1);
    expect(nonPassingHits('const q = `SELECT 1 FROM friendships WHERE a = $1`;')).toBe(1);
    expect(nonPassingHits('const q = `SELECT * FROM x JOIN profiles p ON p.user_id = x.id`;')).toBe(1);
  });

  it('the predicate in the SAME literal passes, as ACTIVE_USER_SQL( or as the literal text', () => {
    expect(nonPassingHits("const q = `SELECT id FROM users u WHERE ${ACTIVE_USER_SQL('u')}`;")).toBe(0);
    expect(nonPassingHits(`const q = "SELECT id FROM users WHERE deletion_state = 'active'";`)).toBe(0);
  });

  it('the predicate in a DIFFERENT literal does not pass', () => {
    const text = [
      "const where = \"deletion_state = 'active'\";",
      'const q = `SELECT id FROM users u WHERE u.id = $1`;',
    ].join('\n');
    expect(nonPassingHits(text)).toBe(1);
  });

  it('a comment never counts, and the views never match', () => {
    expect(nonPassingHits("// SELECT id FROM users WHERE id = 1\n/* JOIN profiles */ const a = 1;")).toBe(0);
    expect(nonPassingHits('const q = `SELECT 1 FROM profile_identity JOIN active_friendships f ON f.x = y`;')).toBe(0);
  });

  it('counts literals, so a second raw query in the same file is a second hit', () => {
    const text = "const a = 'FROM users'; const b = `JOIN profiles p`; const c = `FROM profile_identity`;";
    expect(nonPassingHits(text)).toBe(2);
  });
});

describe('visibility guard: apps/api/src/**', () => {
  it('every allowlist entry has a one-line reason, exists, is not a test file, and pins a positive count', () => {
    for (const e of ALLOWLIST) {
      expect(e.reason.trim().length, `${e.file}: empty reason`).toBeGreaterThan(0);
      expect(e.reason.includes('\n'), `${e.file}: reason must be one line`).toBe(false);
      expect(e.file.includes('__tests__') || e.file.endsWith('.test.ts'), `${e.file}: names a test file`).toBe(false);
      expect(existsSync(join(SRC_ROOT, e.file)), `${e.file}: does not exist`).toBe(true);
      expect(e.hits, `${e.file}: pin must be positive (remove a stale entry)`).toBeGreaterThan(0);
    }
    expect(new Set(ALLOWLIST.map((e) => e.file)).size).toBe(ALLOWLIST.length);
  });

  it('no file has a non-passing hit outside the allowlist, and every pin equals the real count', () => {
    const actual = report();
    const problems = allowlistProblems(actual, ALLOWLIST, 'convert the query to a view or ACTIVE_USER_SQL');
    expect(problems, `\nGuard report on the current tree:\n${[...actual].map(([f, n]) => `  ${f}: ${n}`).join('\n')}\n`).toEqual([]);
  });
});

describe('visibility guard: allowlist comparison (synthetic reports)', () => {
  const entries = [{ file: 'a.ts', hits: 2 }];

  it('an unlisted file with a non-passing hit fails', () => {
    expect(allowlistProblems(new Map([['b.ts', 1]]), entries, 'x')).toEqual([
      'b.ts: 1 hit(s), not allowlisted (x)',
      'a.ts: pinned 2, found 0 (remove the entry)',
    ]);
  });

  it('a listed file whose count differs from its pin fails, in both directions', () => {
    expect(allowlistProblems(new Map([['a.ts', 3]]), entries, 'x')).toEqual(['a.ts: pinned 2, found 3']);
    expect(allowlistProblems(new Map([['a.ts', 1]]), entries, 'x')).toEqual(['a.ts: pinned 2, found 1']);
  });

  it('a matching report has no problems', () => {
    expect(allowlistProblems(new Map([['a.ts', 2]]), entries, 'x')).toEqual([]);
  });
});
