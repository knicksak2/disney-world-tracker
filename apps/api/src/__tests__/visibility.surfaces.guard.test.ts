/**
 * Surface guards (account-deletion R5.10; design Testing Strategy item 7). The structural guard stops NEW unsafe reads;
 * these pin four conversions that a looser rule could let slip, each by reading the real source literals (comments are
 * never inspected):
 *
 *  - stats `targetExists` selects `deletion_state`, so a pending friend and a never-existing id both answer
 *    `stats_target_not_found` (without it the first would be `profile_forbidden`, a 403 that reveals deactivation);
 *  - `tripRecapGate.ts` has no `FROM friendships` (it reads `active_friendships`);
 *  - pins `reconcileAll` selects only `deletion_state = 'active'` accounts;
 *  - `reactions/repo.ts` has no `JOIN profiles` (it reads `profile_identity` with `is_visible`).
 */
import { describe, expect, it } from 'vitest';

import { literalsOf, literalsOfFile } from './guardScan.js';

const pick = (file: string, pattern: RegExp): string[] => literalsOfFile(file).filter((l) => pattern.test(l));

describe('surface guards', () => {
  it('stats `targetExists` existence query contains deletion_state', () => {
    const hits = pick('services/stats/routes.ts', /FROM\s+users/i);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('deletion_state');
  });

  it('the shared trip recap gate has no raw FROM friendships and reads active_friendships', () => {
    const lits = literalsOfFile('services/sharing/tripRecapGate.ts');
    expect(lits.some((l) => /FROM\s+friendships/i.test(l))).toBe(false);
    expect(lits.some((l) => /FROM\s+active_friendships/i.test(l))).toBe(true);
  });

  it("pins `reconcileAll` selects only deletion_state = 'active' users", () => {
    const hits = pick('services/pins/repo.ts', /FROM\s+users/i);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain("deletion_state = 'active'");
  });

  it('share-reaction names join profile_identity with is_visible, and there is no JOIN profiles', () => {
    const lits = literalsOfFile('services/reactions/repo.ts');
    expect(lits.some((l) => /JOIN\s+profiles/i.test(l))).toBe(false);
    expect(lits.some((l) => /JOIN\s+profile_identity/i.test(l) && l.includes('is_visible'))).toBe(true);
  });

  it('the checks bite: the old forms are detected in synthetic sources', () => {
    expect(literalsOf("const q = 'SELECT EXISTS (SELECT 1 FROM users WHERE id = $1) AS exists';").some((l) => !l.includes('deletion_state'))).toBe(true);
    expect(literalsOf('const q = `SELECT 1 FROM friendships WHERE a = $1`;').some((l) => /FROM\s+friendships/i.test(l))).toBe(true);
    expect(literalsOf('const q = `SELECT id FROM users`;').some((l) => !l.includes("deletion_state = 'active'"))).toBe(true);
    expect(literalsOf('const q = `SELECT 1 FROM x r JOIN profiles p ON 1=1`;').some((l) => /JOIN\s+profiles/i.test(l))).toBe(true);
  });
});
