/**
 * Structural guard (account-deletion R7.1, R7.6, R17.7): a caller's trip role is read in exactly three places,
 * and all three go through the Interim_Organizer derivation.
 *
 *   - `trips/authz.ts` `assertTripMember`
 *   - `trips/repo.ts` `lockMemberRole` (the `FOR UPDATE` role read)
 *   - `composeServices.ts`, whose trip-share `roleOf` calls `resolveEffectiveRole`
 *
 * 1. No other non-test file contains a SQL literal that selects `role FROM trip_memberships`. A fourth reader
 *    would read the persisted role and silently skip the interim organizer.
 * 2. The derivation module `trips/effectiveRole.ts` is imported only by those three files.
 * 3. The three readers really call it (`actingRole` / `resolveEffectiveRole`), so a reader cannot drop it.
 *
 * Feature: account-deletion, Property 10: Effective role equals persisted role except for the interim organizer
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, '..', '..', '..');

const ALLOWED_READERS = ['composeServices.ts', 'services/trips/authz.ts', 'services/trips/repo.ts'].sort();
const ROLE_READ = /\brole\s+FROM\s+trip_memberships\b/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string): string => relative(API_SRC, file).split(sep).join('/');

/** Text of every string and template literal in a source text (comments are not literals, so they never count). */
function literalsOf(source: string): string[] {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push(node.text);
    else if (ts.isTemplateExpression(node)) found.push(node.getText(sf));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function filesReading(files: readonly string[]): string[] {
  return files
    .filter((f) => literalsOf(readFileSync(f, 'utf8')).some((l) => ROLE_READ.test(l)))
    .map(rel)
    .sort();
}

describe('detector (can it trip?)', () => {
  it('flags a SQL literal that selects the persisted role', () => {
    const src = "const q = 'SELECT role FROM trip_memberships WHERE trip_id = $1';";
    expect(literalsOf(src).some((l) => ROLE_READ.test(l))).toBe(true);
    const tmpl = 'const q = `SELECT user_id, role FROM trip_memberships tm WHERE ${x}`;';
    expect(literalsOf(tmpl).some((l) => ROLE_READ.test(l))).toBe(true);
  });

  it('ignores a comment, a non-role select and a join', () => {
    expect(literalsOf("// SELECT role FROM trip_memberships\nconst a = 1;").some((l) => ROLE_READ.test(l))).toBe(false);
    expect(literalsOf("const q = 'SELECT 1 FROM trip_memberships WHERE trip_id = $1';").some((l) => ROLE_READ.test(l))).toBe(false);
    expect(literalsOf("const q = 'SELECT tm.user_id FROM trip_memberships tm';").some((l) => ROLE_READ.test(l))).toBe(false);
  });
});

describe('trip role readers (Property 10 guard)', () => {
  const files = walk(API_SRC);

  it('the walk really sees the source tree', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.map(rel)).toContain('services/trips/authz.ts');
  });

  it('no file outside authz.ts, repo.ts and composeServices.ts selects `role FROM trip_memberships`', () => {
    const readers = filesReading(files);
    const unexpected = readers.filter((f) => !ALLOWED_READERS.includes(f));
    expect(unexpected).toEqual([]);
  });

  it('effectiveRole.ts is imported only by the three readers', () => {
    const importers = files
      .filter((f) => rel(f) !== 'services/trips/effectiveRole.ts')
      .filter((f) => /from\s+['"][^'"]*\/effectiveRole\.js['"]|from\s+['"]\.\/effectiveRole\.js['"]/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(importers).toEqual(ALLOWED_READERS);
  });

  it('each reader goes through the derivation', () => {
    const read = (r: string): string => readFileSync(join(API_SRC, r), 'utf8');
    expect(read('services/trips/authz.ts')).toMatch(/actingRole\(/);
    expect(read('services/trips/repo.ts')).toMatch(/actingRole\(/);
    expect(read('composeServices.ts')).toMatch(/resolveEffectiveRole\(/);
  });
});
