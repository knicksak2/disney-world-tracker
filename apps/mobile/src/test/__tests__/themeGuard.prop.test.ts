/**
 * Property tests for the pure theme-retrofit guard scanner
 * (`test/themeGuard.ts`) — dark-mode Property 15, fixture half.
 *
 * Validates: Requirements 11.1, 11.2, 11.4, 11.5
 */

import fc from 'fast-check';

import {
  FORBIDDEN_THEME_IMPORTS,
  THEME_INTERNALS,
  isAllowlisted,
  isInScanSet,
  scanSource,
  type GuardRule,
} from '../themeGuard';

const NUM_RUNS = 200;

/** A plain screen file — on no allowlist. */
const SCREEN = 'screens/catalog/SomeScreen.tsx';
const PALETTE = 'screens/catalog/SomeScreen.palette.ts';
const TOKEN_FILE = 'theme/theme.ts';
const ARTWORK = 'components/pins/PinView.tsx';

const rulesOf = (path: string, source: string): GuardRule[] =>
  scanSource(path, source).map((v) => v.rule);

const quote = fc.constantFrom("'", '"', '`');
const hexOf = (n: number) => fc.hexaString({ minLength: n, maxLength: n });
const hexBody = fc.oneof(hexOf(3), hexOf(6), hexOf(8));
const channel = fc.integer({ min: 0, max: 255 });
const alpha = fc.double({ min: 0, max: 1, noNaN: true }).map((a) => Number(a.toFixed(2)));
const colorKey = fc.constantFrom(
  'primary',
  'surface',
  'textPrimary',
  'border',
  'accent',
  'danger',
);
const tokenGroup = fc.constantFrom(
  'color',
  'gradient',
  'shadow',
  'parkAccent',
  'categoryVisual',
  'resortVisual',
);
const themeModule = fc.constantFrom('../theme/theme', '../../theme/theme', './theme', '../theme');
const forbidden = fc.constantFrom(...FORBIDDEN_THEME_IMPORTS);
const allowedSpecifier = fc.constantFrom(
  'spacing',
  'radius',
  'typography',
  'layout',
  'definePalette',
  'withAlpha',
  'theme',
  'type AppTheme',
  'type ThemedPalette',
  'categoryMeta',
);
const themeInternal = fc.constantFrom(...THEME_INTERNALS);

describe('scanSource — generated fixtures (Property 15)', () => {
  // Feature: dark-mode, Property 15: regression guard is sound and the tree is clean
  it('reports a quoted 3/6/8-digit hex on a plain file, and none on an allowlisted file', () => {
    fc.assert(
      fc.property(hexBody, quote, (hex, q) => {
        const source = `const c = ${q}#${hex}${q};\n`;
        expect(rulesOf(SCREEN, source)).toEqual(['hex']);
        expect(rulesOf(PALETTE, source)).toEqual([]);
        expect(rulesOf(TOKEN_FILE, source)).toEqual([]);
        expect(rulesOf(ARTWORK, source)).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dark-mode, Property 15: regression guard is sound and the tree is clean
  it('reports chromatic rgb()/rgba() triples and never the neutral white/black ones', () => {
    fc.assert(
      fc.property(channel, channel, channel, alpha, fc.boolean(), (r, g, b, a, withA) => {
        const literal = withA ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r},${g},${b})`;
        const source = `const c = '${literal}';\n`;
        const neutral = (r === 255 && g === 255 && b === 255) || (r === 0 && g === 0 && b === 0);
        expect(rulesOf(SCREEN, source)).toEqual(neutral ? [] : ['chromaticRgb']);
        expect(rulesOf(PALETTE, source)).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dark-mode, Property 15: regression guard is sound and the tree is clean
  it('never reports neutral rgba(255,255,255,a) / rgba(0,0,0,a) overlays or black shadows', () => {
    fc.assert(
      fc.property(alpha, fc.boolean(), fc.constantFrom("'", '"'), (a, white, q) => {
        const v = white ? 255 : 0;
        const source = [
          `const veil = 'rgba(${v}, ${v}, ${v}, ${a})';`,
          `const s = { shadowColor: ${q}#000${q} };`,
          `const s2 = { shadowColor: ${q}#000000${q} };`,
        ].join('\n');
        expect(rulesOf(SCREEN, source)).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dark-mode, Property 15: regression guard is sound and the tree is clean
  it('reports static theme token reads and destructuring everywhere but theme.ts', () => {
    fc.assert(
      fc.property(tokenGroup, colorKey, (group, key) => {
        const read = `const c = theme.${group}.${key};\n`;
        expect(rulesOf(SCREEN, read)).toEqual(['staticToken']);
        expect(rulesOf(PALETTE, read)).toEqual(['staticToken']);
        expect(rulesOf(TOKEN_FILE, read)).toEqual([]);
        const destructure = `const { spacing, ${group} } = theme;\n`;
        expect(rulesOf(SCREEN, destructure)).toEqual(['staticToken']);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dark-mode, Property 15: regression guard is sound and the tree is clean
  it('reports named imports of forbidden specifiers in every form, single- and multi-line', () => {
    fc.assert(
      fc.property(
        forbidden,
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        themeModule,
        themeInternal,
        (name, typeOnly, aliased, multiline, withOthers, mod, internal) => {
          const spec = `${typeOnly ? 'type ' : ''}${name}${aliased ? ' as Local' : ''}`;
          const specs = withOthers ? ['spacing', spec, 'radius'] : [spec];
          const list = multiline ? `\n  ${specs.join(',\n  ')},\n` : ` ${specs.join(', ')} `;
          const source = `import {${list}} from '${mod}';\nconst x = 1;\n`;
          expect(rulesOf(SCREEN, source)).toEqual(['staticImport']);
          expect(rulesOf(PALETTE, source)).toEqual([]);
          expect(rulesOf(internal, source)).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dark-mode, Property 15: regression guard is sound and the tree is clean
  it('reports an aliased `theme as T` import (it would bypass the staticToken rule)', () => {
    fc.assert(
      fc.property(themeModule, fc.boolean(), (mod, typeKeyword) => {
        const source = `import ${typeKeyword ? 'type ' : ''}{ theme as T } from '${mod}';\n`;
        expect(rulesOf(SCREEN, source)).toEqual(['staticImport']);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dark-mode, Property 15: regression guard is sound and the tree is clean
  it('never reports named imports of non-forbidden specifiers', () => {
    fc.assert(
      fc.property(
        fc.array(allowedSpecifier, { minLength: 1, maxLength: 4 }),
        themeModule,
        fc.boolean(),
        (specs, mod, multiline) => {
          const list = multiline ? `\n  ${specs.join(',\n  ')}\n` : ` ${specs.join(', ')} `;
          const source = `import {${list}} from '${mod}';\n`;
          expect(rulesOf(SCREEN, source)).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dark-mode, Property 15: regression guard is sound and the tree is clean
  it('reports a namespace import of the theme module outside the theme internals', () => {
    fc.assert(
      fc.property(themeModule, themeInternal, (mod, internal) => {
        const source = `import * as T from '${mod}';\nconst c = T.darkTheme;\n`;
        expect(rulesOf(SCREEN, source)).toEqual(['namespaceImport']);
        // Palettes may import named helpers, but not the namespace.
        expect(rulesOf(PALETTE, source)).toEqual(['namespaceImport']);
        expect(rulesOf(internal, source)).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('scanSource — unit cases', () => {
  it('ignores literals inside block, JSX and full-line comments, but not trailing comments', () => {
    const source = [
      "/* '#5b2a86' */",
      "{/* '#ffffff' */}",
      "// theme.color.primary '#123456'",
      " * '#abcdef' theme.color.x",
      "const a = 1; // '#7c3aed'",
    ].join('\n');
    const violations = scanSource(SCREEN, source);
    expect(violations).toEqual([{ file: SCREEN, line: 5, rule: 'hex', match: "'#7c3aed'" }]);
  });

  it('reports 1-based line numbers from the match offset, across multi-line imports', () => {
    const source = [
      "import React from 'react';",
      'import {',
      '  spacing,',
      '  darkTheme,',
      "} from '../theme/theme';",
      "const c = '#ff0000';",
    ].join('\n');
    expect(scanSource(SCREEN, source)).toEqual([
      { file: SCREEN, line: 6, rule: 'hex', match: "'#ff0000'" },
      { file: SCREEN, line: 2, rule: 'staticImport', match: expect.stringContaining('darkTheme') },
    ]);
  });

  it('does not flag scheme-qualified theme objects or the hook-based reads', () => {
    const source = [
      'const a = t.color.primary;',
      'const b = darkTheme.color.surface;',
      'const c = useAppTheme().color.background;',
    ].join('\n');
    expect(scanSource(SCREEN, source)).toEqual([]);
  });

  it('isAllowlisted is exact per rule', () => {
    expect(isAllowlisted('theme/theme.ts', 'staticToken')).toBe(true);
    expect(isAllowlisted('theme/AppearanceChrome.ts', 'staticToken')).toBe(false);
    expect(isAllowlisted('theme/AppearanceChrome.ts', 'staticImport')).toBe(true);
    expect(isAllowlisted('theme/AppearanceChrome.ts', 'hex')).toBe(false);
    expect(isAllowlisted('x/Foo.palette.ts', 'hex')).toBe(true);
    expect(isAllowlisted('x/Foo.palette.ts', 'staticImport')).toBe(true);
    expect(isAllowlisted('x/Foo.palette.ts', 'namespaceImport')).toBe(false);
    expect(isAllowlisted('avatars/AvatarPresets.tsx', 'chromaticRgb')).toBe(true);
  });

  it('isInScanSet excludes tests, test support, src/test and declaration files', () => {
    expect(isInScanSet('screens/Foo.tsx')).toBe(true);
    expect(isInScanSet('screens/foo.ts')).toBe(true);
    expect(isInScanSet('screens/__tests__/Foo.tsx')).toBe(false);
    expect(isInScanSet('screens/stats/__testSupport__/fixtures.ts')).toBe(false);
    expect(isInScanSet('screens/Foo.test.tsx')).toBe(false);
    expect(isInScanSet('test/themeGuard.ts')).toBe(false);
    expect(isInScanSet('types/env.d.ts')).toBe(false);
    expect(isInScanSet('assets/logo.png')).toBe(false);
  });
});
