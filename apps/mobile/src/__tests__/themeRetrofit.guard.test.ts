/**
 * Theme-retrofit regression guard (dark-mode spec, Properties 14 and 15).
 *
 * In the style of the API's `retirement.smoke.test.ts`: it scans the real
 * `apps/mobile/src` tree and fails the build if a file reads static colour
 * tokens, imports a per-scheme theme object, or carries a raw colour literal
 * outside the exact allowlists — anything that can't repaint on a scheme
 * switch. It also validates every co-located `*.palette.ts`.
 *
 * End state (spec task 10.1): every file is converted, so there is no
 * pending/migration list — any violation anywhere in the scan set fails, and
 * the static `theme` export must be colour-free.
 */

import fs from 'fs';
import path from 'path';

import fc from 'fast-check';

import {
  ARTWORK_AND_TOKEN_FILES,
  PALETTE_FILE,
  THEME_INTERNALS,
  isInScanSet,
  preprocessSource,
  scanSource,
  type Violation,
} from '../test/themeGuard';
import { DARK_TONAL, darkTheme, lightTheme, theme, withAlpha, type ThemedPalette } from '../theme/theme';

const SRC_ROOT = path.resolve(__dirname, '..');

function walk(dir: string, out: string[]): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(path.relative(SRC_ROOT, abs).split(path.sep).join('/'));
  }
  return out;
}

const ALL_FILES = walk(SRC_ROOT, []);
const SCAN_SET = ALL_FILES.filter(isInScanSet);
const PALETTE_FILES = SCAN_SET.filter((f) => PALETTE_FILE.test(f));

const exists = (rel: string): boolean => fs.existsSync(path.join(SRC_ROOT, rel));
const format = (v: Violation): string => `${v.file}:${v.line} ${v.rule} ${v.match}`;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:\d*\.)?\d+\s*)?\)$/;
const isColor = (v: unknown): boolean =>
  typeof v === 'string' && (HEX_COLOR.test(v) || RGB_COLOR.test(v));

/** Every string leaf of a value (tokens, nested records, gradient tuples). */
function colourLeaves(value: unknown, at: string, out: Array<[string, string]>): void {
  if (typeof value === 'string') {
    if (value.startsWith('#') || value.startsWith('rgb')) out.push([at, value]);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) colourLeaves(v, `${at}.${k}`, out);
  }
}

describe('theme retrofit guard — the real tree (Property 15, tree half)', () => {
  it('finds the source tree', () => {
    expect(SCAN_SET.length).toBeGreaterThan(100);
    expect(SCAN_SET).toContain('theme/theme.ts');
  });

  it('has zero violations outside the allowlists', () => {
    const violations = SCAN_SET.flatMap((f) =>
      scanSource(f, fs.readFileSync(path.join(SRC_ROOT, f), 'utf8')),
    );
    expect(violations.map(format)).toEqual([]);
  });

  it('every allowlisted path exists on disk (no stale entries)', () => {
    const stale = [...ARTWORK_AND_TOKEN_FILES, ...THEME_INTERNALS].filter((f) => !exists(f));
    expect(stale).toEqual([]);
  });

  it('every *.palette.ts is a pure definePalette module', () => {
    expect(PALETTE_FILES.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const rel of PALETTE_FILES) {
      const source = fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');
      const code = preprocessSource(source);
      if (!code.includes('definePalette(')) problems.push(`${rel}: no definePalette(`);
      for (const line of code.split('\n')) {
        if (/^\s*export\b/.test(line) && !/^export const [A-Z][A-Z0-9_]* = definePalette\(/.test(line)) {
          problems.push(`${rel}: bad export line: ${line.trim()}`);
        }
      }
      if (/StyleSheet|\bfunction\b|=>/.test(code)) problems.push(`${rel}: contains code`);
      if (/<\/?[A-Z][\w.]*(?:\s[^<>]*)?\/?>/.test(code)) {
        problems.push(`${rel}: contains JSX`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the static theme object is colour-free and theme.ts has no colour named exports (end state)', () => {
    expect(Object.keys(theme)).toEqual(['spacing', 'radius', 'layout', 'typography']);
    const source = fs.readFileSync(path.join(SRC_ROOT, 'theme/theme.ts'), 'utf8');
    expect(source).not.toMatch(
      /export\s+const\s+(color|gradient|shadow|parkAccent|categoryVisual|resortVisual)\b/,
    );
    expect(source).not.toMatch(/export\s+type\s+Theme\b/);
  });
});

describe('palette pairs are complete and valid (Property 14)', () => {
  const palettes: Array<[string, ThemedPalette<string>]> = PALETTE_FILES.flatMap((rel) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(SRC_ROOT, rel)) as Record<string, unknown>;
    return Object.entries(mod).map(
      ([name, value]) => [`${rel}#${name}`, value as ThemedPalette<string>] as [string, ThemedPalette<string>],
    );
  });

  it('discovers at least one exported palette', () => {
    expect(palettes.length).toBeGreaterThan(0);
  });

  it('every palette has identical light/dark key sets and only valid colour values', () => {
    for (const [name, p] of palettes) {
      expect({ name, keys: Object.keys(p.dark).sort() }).toEqual({
        name,
        keys: Object.keys(p.light).sort(),
      });
      for (const scheme of ['light', 'dark'] as const) {
        for (const [k, v] of Object.entries(p[scheme])) {
          expect({ at: `${name}.${scheme}.${k}`, valid: isColor(v) }).toEqual({
            at: `${name}.${scheme}.${k}`,
            valid: true,
          });
        }
      }
    }
  });

  // Feature: dark-mode, Property 14: every palette pair is complete and valid
  it('withAlpha(value, 0.14) never throws on any token, DARK_TONAL or palette value', () => {
    const leaves: Array<[string, string]> = [];
    colourLeaves(lightTheme, 'lightTheme', leaves);
    colourLeaves(darkTheme, 'darkTheme', leaves);
    colourLeaves(DARK_TONAL, 'DARK_TONAL', leaves);
    for (const [name, p] of palettes) colourLeaves(p, name, leaves);
    expect(leaves.length).toBeGreaterThan(100);

    fc.assert(
      fc.property(fc.constantFrom(...leaves), ([, value]) => {
        expect(() => withAlpha(value, 0.14)).not.toThrow();
      }),
      { numRuns: Math.max(100, leaves.length) },
    );
    // And exhaustively, so no leaf depends on sampling.
    for (const [at, value] of leaves) {
      expect({ at, rgba: withAlpha(value, 0.14).startsWith('rgba(') }).toEqual({ at, rgba: true });
    }
  });
});
