/**
 * Shared scanner for the structural guards of account-deletion R5.8, R5.12 and R5.13.
 *
 * It parses every non-test `.ts` file under `apps/api/src/**` with the TypeScript compiler API and yields the
 * source text of each OUTERMOST string literal, no-substitution template literal and template expression
 * (`node.getText()`, which for a template includes the source of its `${...}` interpolations). Comments are never
 * visited, so prose in a comment cannot trip a guard. A guard decides what a "hit" is from that text.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
/** `apps/api/src` */
export const SRC_ROOT = resolve(here, '..');

/** A path with `__tests__` in it, or ending `.test.ts`, is a test file; so are declaration files. */
export function isTestOrDeclaration(path: string): boolean {
  const parts = path.split(sep);
  return parts.includes('__tests__') || path.endsWith('.test.ts') || path.endsWith('.d.ts');
}

/** Every non-test source file under `apps/api/src/**`, as a path relative to `src`, with `/` separators. */
export function listSourceFiles(root: string = SRC_ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules') continue;
        walk(full);
      } else if (name.endsWith('.ts') && !isTestOrDeclaration(full)) {
        out.push(relative(root, full).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
}

/** The source text of every outermost SQL-bearing literal in `text`. Template interpolations are not descended into. */
export function literalsOf(text: string, fileName = 'fixture.ts'): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      out.push(node.getText(sf));
      return; // outermost only: an interpolated literal is part of its parent's text
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Compares a real per-file hit report with pinned allowlist entries. A file with hits that is not listed is a
 * problem; a listed file whose count differs from its pin is a problem; a pin for a file with no hits is stale.
 */
export function allowlistProblems(
  actual: ReadonlyMap<string, number>,
  entries: readonly { readonly file: string; readonly hits: number }[],
  hint: string,
): string[] {
  const pinned = new Map(entries.map((e) => [e.file, e.hits]));
  const problems: string[] = [];
  for (const [file, n] of actual) {
    const pin = pinned.get(file);
    if (pin === undefined) problems.push(`${file}: ${n} hit(s), not allowlisted (${hint})`);
    else if (pin !== n) problems.push(`${file}: pinned ${pin}, found ${n}`);
  }
  for (const [file, pin] of pinned) {
    if (!actual.has(file)) problems.push(`${file}: pinned ${pin}, found 0 (remove the entry)`);
  }
  return problems;
}

export function readSource(file: string): string {
  return readFileSync(join(SRC_ROOT, file), 'utf8');
}

export function literalsOfFile(file: string): string[] {
  return literalsOf(readSource(file), file);
}
