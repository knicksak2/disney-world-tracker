/**
 * Structural guard for the Dining Plan module (dining-plan-calculator Requirements 3.1, 16.3, 16.5, 23.2): every
 * non-test source file under `services/diningPlan/**` reads no role, roster, user or profile table directly (the
 * Party and the caller's role come through the ports wired in `wiring.ts`), never imports `trips/effectiveRole`, and
 * imports no Redis or queue client. SQL is matched inside string literals only (`guardScan.ts`), so comments never
 * count.
 */

import { describe, expect, it } from 'vitest';

import { listSourceFiles, literalsOf, literalsOfFile, readSource } from '../../../__tests__/guardScan.js';

const FORBIDDEN_SQL: readonly [string, RegExp][] = [
  ['a role read', /\brole\s+FROM\s+trip_memberships\b/i],
  ['a raw roster read', /\b(FROM|JOIN)\s+trip_memberships\b/i],
  ['a users read', /\b(FROM|JOIN)\s+users\b/i],
  ['a profiles read', /\b(FROM|JOIN)\s+profiles\b/i],
];
const FORBIDDEN_IMPORT: readonly [string, RegExp][] = [
  ['effectiveRole', /from\s+['"][^'"]*effectiveRole(\.js)?['"]/],
  ['a Redis or queue client', /from\s+['"](ioredis|redis|bullmq|@upstash\/redis)['"]/],
];

function sqlProblems(file: string, literals: readonly string[]): string[] {
  return FORBIDDEN_SQL.flatMap(([name, re]) => (literals.some((l) => re.test(l)) ? [`${file}: ${name}`] : []));
}
function importProblems(file: string, text: string): string[] {
  return FORBIDDEN_IMPORT.flatMap(([name, re]) => (re.test(text) ? [`${file}: imports ${name}`] : []));
}

const FILES = listSourceFiles().filter((f) => f.startsWith('services/diningPlan/'));

describe('dining-plan source guard: scanner (negative fixtures)', () => {
  it('finds each forbidden read in a literal and ignores comments and the visibility views', () => {
    const text = [
      '// SELECT role FROM trip_memberships',
      'const a = `SELECT role FROM trip_memberships WHERE trip_id = $1`;',
      "const b = 'SELECT 1 FROM users u JOIN profiles p ON p.user_id = u.id';",
      'const c = `SELECT 1 FROM active_trip_memberships JOIN profile_identity p ON true`;',
    ].join('\n');
    expect(sqlProblems('x.ts', literalsOf(text))).toEqual(['x.ts: a role read', 'x.ts: a raw roster read', 'x.ts: a users read', 'x.ts: a profiles read']);
    expect(sqlProblems('x.ts', literalsOf('const c = `SELECT 1 FROM active_trip_memberships JOIN profile_identity p ON true`;'))).toEqual([]);
  });

  it('finds a forbidden import', () => {
    expect(importProblems('x.ts', "import { resolveEffectiveRole } from '../trips/effectiveRole.js';\nimport IORedis from 'ioredis';")).toEqual([
      'x.ts: imports effectiveRole',
      'x.ts: imports a Redis or queue client',
    ]);
  });
});

describe('dining-plan source guard: services/diningPlan/**', () => {
  it('scans the module, including its SQL files', () => {
    expect(FILES).toEqual(expect.arrayContaining(['services/diningPlan/repo.ts', 'services/diningPlan/budgetPort.ts', 'services/diningPlan/routes.ts', 'services/diningPlan/wiring.ts']));
  });

  it('no file reads roles, the roster, users or profiles, imports effectiveRole, or imports a Redis client', () => {
    const problems = FILES.flatMap((f) => [...sqlProblems(f, literalsOfFile(f)), ...importProblems(f, readSource(f))]);
    expect(problems).toEqual([]);
  });
});
