/**
 * Roster guard (account-deletion R5.12; design "A second guard covers it"). The visibility guard cannot see raw
 * `trip_memberships` reads, because most services legitimately read that table for the caller's own membership. This
 * guard scans every non-test `.ts` under `apps/api/src/**` for `(FROM|JOIN) trip_memberships` inside SQL literals
 * (comments never count) and compares the per-file MATCH count with a pinned allowlist. A file not listed fails; a
 * listed file whose count differs fails too, so a new roster read inside an already-listed file is caught. The views
 * (`active_trip_memberships`) never match. Changing a pin needs a one-line reason in the same change.
 *
 * The pins are the guard's own report on the finished, fully converted tree.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { allowlistProblems, listSourceFiles, literalsOf, literalsOfFile, SRC_ROOT } from './guardScan.js';

const RAW = /\b(FROM|JOIN)\s+trip_memberships\b/gi;

export interface RosterAllowEntry {
  readonly file: string;
  /** One line: why this file reads the raw membership table. */
  readonly reason: string;
  /** Pinned number of `(FROM|JOIN) trip_memberships` matches in the file's SQL literals. */
  readonly hits: number;
}

export function rosterHits(text: string, fileName = 'fixture.ts'): number {
  return literalsOf(text, fileName).reduce((n, l) => n + (l.match(RAW)?.length ?? 0), 0);
}

export const ROSTER_ALLOWLIST: readonly RosterAllowEntry[] = [
  { file: 'composeServices.ts', hits: 1, reason: "The trip-share port's isMember checks the caller's own membership." },
  { file: 'services/accountDeletion/repo.ts', hits: 3, reason: 'The feature itself: listTripsOf, resolveTrip and membership removal act on one account.' },
  { file: 'services/admin/repo.ts', hits: 1, reason: 'Admin is not another user (R5.7): the lookup counts the account\'s own trips.' },
  { file: 'services/experienceLists/repo.ts', hits: 2, reason: 'Caller-scoped joins deciding whether the caller shares a trip with an attached list; no other member is returned.' },
  { file: 'services/foodLists/repo.ts', hits: 5, reason: 'Caller-scoped joins deciding whether the caller shares a trip with an attached list; no other member is returned.' },
  { file: 'services/photos/reportsRepo.ts', hits: 1, reason: 'The member-scoped open-report count (countOpenDistinct, R11.10) returns a number, never an identity.' },
  { file: 'services/pins/repo.ts', hits: 1, reason: "The caller's own trip count for pin progress." },
  { file: 'services/tracking/logs/repo.ts', hits: 1, reason: "Caller membership check for trip logging." },
  { file: 'services/tripExpenses/repo.ts', hits: 7, reason: 'Sponsor and party validation (after the trip_party_deleted check) and getNetBalances, the deliberate raw read: money must count pending members.' },
  { file: 'services/tripExpenses/routes.ts', hits: 2, reason: 'Guest sponsor membership checks on add and rename.' },
  { file: 'services/trips/authz.ts', hits: 1, reason: "assertTripMember: the caller's own role and membership (the caller always has a session, so is active)." },
  { file: 'services/trips/effectiveRole.ts', hits: 2, reason: "Effective-role resolution reads the persisted roster to find the caller's role and the interim organizer (R7)." },
  { file: 'services/trips/repo.ts', hits: 5, reason: "The invitee-already-a-member check, the membership delete in departMember, the FOR UPDATE role and roster locks, and the caller's own trip list." },
];

function report(): Map<string, number> {
  const out = new Map<string, number>();
  for (const file of listSourceFiles()) {
    const n = literalsOfFile(file).reduce((sum, l) => sum + (l.match(RAW)?.length ?? 0), 0);
    if (n > 0) out.set(file, n);
  }
  return out;
}

describe('roster guard: scanner (negative fixtures)', () => {
  it('counts raw reads, both FROM and JOIN, in literals', () => {
    expect(rosterHits('const a = `SELECT 1 FROM trip_memberships WHERE x`; const b = "JOIN trip_memberships m ON 1=1";')).toBe(2);
  });

  it('two raw reads in one literal are two hits, so a new roster read inside a listed literal is caught', () => {
    expect(rosterHits('const a = `SELECT 1 FROM trip_memberships a JOIN trip_memberships b ON 1=1`;')).toBe(2);
  });

  it('the view and comments never count', () => {
    expect(rosterHits('// FROM trip_memberships\nconst a = `SELECT 1 FROM active_trip_memberships`;')).toBe(0);
  });
});

describe('roster guard: allowlist comparison (synthetic reports)', () => {
  const entries = [{ file: 'a.ts', hits: 1 }];

  it('a file outside the list fails', () => {
    expect(allowlistProblems(new Map([['b.ts', 1]]), entries, 'x')[0]).toBe('b.ts: 1 hit(s), not allowlisted (x)');
  });

  it('a different hit count for a listed file fails (a new roster read inside a listed file)', () => {
    expect(allowlistProblems(new Map([['a.ts', 2]]), entries, 'x')).toEqual(['a.ts: pinned 1, found 2']);
  });
});

describe('roster guard: apps/api/src/**', () => {
  it('every entry has a one-line reason, exists, is not a test file, and pins a positive count', () => {
    for (const e of ROSTER_ALLOWLIST) {
      expect(e.reason.trim().length, `${e.file}: empty reason`).toBeGreaterThan(0);
      expect(e.reason.includes('\n'), `${e.file}: reason must be one line`).toBe(false);
      expect(e.file.includes('__tests__') || e.file.endsWith('.test.ts'), `${e.file}: names a test file`).toBe(false);
      expect(existsSync(join(SRC_ROOT, e.file)), `${e.file}: does not exist`).toBe(true);
      expect(e.hits, `${e.file}: pin must be positive`).toBeGreaterThan(0);
    }
    expect(new Set(ROSTER_ALLOWLIST.map((e) => e.file)).size).toBe(ROSTER_ALLOWLIST.length);
  });

  it('no file reads the raw roster outside the allowlist, and every pin equals the real count', () => {
    const actual = report();
    const problems = allowlistProblems(actual, ROSTER_ALLOWLIST, 'read active_trip_memberships');
    expect(problems, `\nGuard report on the current tree:\n${[...actual].map(([f, n]) => `  ${f}: ${n}`).join('\n')}\n`).toEqual([]);
  });
});
