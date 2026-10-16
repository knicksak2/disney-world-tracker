// Feature: dark-mode — structural regression guard for the theme retrofit.
//
// Pure: `scanSource` takes a path + source text and returns violations, so it
// is property-testable on generated fixtures (`test/__tests__/
// themeGuard.prop.test.ts`) and runs over the real tree in
// `__tests__/themeRetrofit.guard.test.ts`. A file that reads static colour
// tokens, imports a per-scheme theme object, or carries a raw colour literal
// outside the allowlists can't repaint on a scheme switch.

export type GuardRule = 'hex' | 'chromaticRgb' | 'staticToken' | 'staticImport' | 'namespaceImport';

export interface Violation {
  /** POSIX path relative to `apps/mobile/src`. */
  readonly file: string;
  /** 1-based line of the match. */
  readonly line: number;
  readonly rule: GuardRule;
  readonly match: string;
}

/** Files allowed to carry raw colour literals (tokens and artwork). */
export const ARTWORK_AND_TOKEN_FILES = [
  'theme/theme.ts', // token source of truth
  'theme/contrast.ts', // declared contrast floors (pin tier text pairs)
  'components/pins/motifPaths.ts', // pin artwork (generated motif paths)
  'components/pins/pinArt.ts', // pin artwork
  'components/pins/pinRenderModel.ts', // pin artwork render model
  'components/pins/pinTierMeta.ts', // pin tier identity colours (artwork)
  'components/pins/PinView.tsx', // pin artwork renderer (inline SVG + lock overlay)
  'avatars/AvatarPresets.tsx', // avatar artwork
  'screens/catalog/destinationVisuals.ts', // destination hero gradients (artwork)
] as const;

/** Theme modules allowed to import the per-scheme theme objects. */
export const THEME_INTERNALS = [
  'theme/theme.ts',
  'theme/useAppTheme.ts',
  'theme/makeStyles.ts',
  'theme/appearance.ts',
  'theme/AppearanceChrome.ts',
  'theme/contrast.ts',
] as const;

export const PALETTE_FILE = /\.palette\.ts$/;

export const STATIC_IMPORT_RE =
  /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](?:\.\.?\/)+(?:theme\/)?theme['"]/g;
export const NAMESPACE_IMPORT_RE =
  /import\s+\*\s+as\s+\w+\s+from\s*['"](?:\.\.?\/)+(?:theme\/)?theme['"]/g;
export const FORBIDDEN_THEME_IMPORTS = [
  'color',
  'gradient',
  'shadow',
  'parkAccent',
  'categoryVisual',
  'resortVisual',
  'lightColor',
  'darkColor',
  'lightTheme',
  'darkTheme',
  'themes',
  'DARK_TONAL',
] as const;

const HEX_RE = /(['"`])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\1/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
const STATIC_TOKEN_READ_RE =
  /\btheme\.(color|gradient|shadow|parkAccent|categoryVisual|resortVisual)\b/g;
const STATIC_TOKEN_DESTRUCTURE_RE =
  /\{[^}]*\b(color|gradient|shadow|parkAccent|categoryVisual|resortVisual)\b[^}]*\}\s*=\s*theme\b/g;
const SHADOW_EXEMPTION_RE = /shadowColor:\s*(['"])#0{3}(?:0{3})?\1/g;

const NEUTRAL_TRIPLES = new Set(['255,255,255', '0,0,0']);

/** Whether `relPath` is exempt from `rule`. */
export function isAllowlisted(relPath: string, rule: GuardRule): boolean {
  switch (rule) {
    case 'hex':
    case 'chromaticRgb':
      return (
        (ARTWORK_AND_TOKEN_FILES as readonly string[]).includes(relPath) ||
        PALETTE_FILE.test(relPath)
      );
    case 'staticToken':
      return relPath === 'theme/theme.ts';
    case 'staticImport':
      return (THEME_INTERNALS as readonly string[]).includes(relPath) || PALETTE_FILE.test(relPath);
    case 'namespaceImport':
      return (THEME_INTERNALS as readonly string[]).includes(relPath);
  }
}

/** Replaces every non-newline character of `text` with a space (keeps offsets and lines). */
function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * Strips `/* … *\/` blocks (incl. JSX `{/* *\/}`), full-line `//` comments and
 * full-line JSDoc `*` lines, then the black-shadow exemption. Offsets and line
 * numbers are preserved. Trailing comments on code lines are NOT stripped.
 */
export function preprocessSource(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, blank);
  out = out.replace(/^[ \t]*\/\/.*$/gm, blank);
  out = out.replace(/^[ \t]*\*.*$/gm, blank);
  out = out.replace(SHADOW_EXEMPTION_RE, blank);
  return out;
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function isForbiddenSpecifier(raw: string): boolean {
  let spec = raw.trim();
  if (spec === '') return false;
  spec = spec.replace(/^type\s+/, '');
  if (/^theme\s+as\s+\w+$/.test(spec)) return true;
  const name = spec.replace(/\s+as\s+\w+$/, '').trim();
  return (FORBIDDEN_THEME_IMPORTS as readonly string[]).includes(name);
}

/** Scans one source file. `relPath` is POSIX, relative to `apps/mobile/src`. */
export function scanSource(relPath: string, source: string): Violation[] {
  const text = preprocessSource(source);
  const violations: Violation[] = [];
  const push = (rule: GuardRule, offset: number, match: string): void => {
    if (isAllowlisted(relPath, rule)) return;
    violations.push({ file: relPath, line: lineOf(text, offset), rule, match });
  };

  for (const m of text.matchAll(HEX_RE)) push('hex', m.index ?? 0, m[0]);
  for (const m of text.matchAll(RGB_RE)) {
    const triple = `${Number(m[1])},${Number(m[2])},${Number(m[3])}`;
    if (!NEUTRAL_TRIPLES.has(triple)) push('chromaticRgb', m.index ?? 0, m[0]);
  }
  for (const m of text.matchAll(STATIC_TOKEN_READ_RE)) push('staticToken', m.index ?? 0, m[0]);
  for (const m of text.matchAll(STATIC_TOKEN_DESTRUCTURE_RE)) {
    push('staticToken', m.index ?? 0, m[0]);
  }
  for (const m of text.matchAll(STATIC_IMPORT_RE)) {
    const specifiers = (m[1] ?? '').split(',');
    if (specifiers.some(isForbiddenSpecifier)) push('staticImport', m.index ?? 0, m[0]);
  }
  for (const m of text.matchAll(NAMESPACE_IMPORT_RE)) push('namespaceImport', m.index ?? 0, m[0]);

  return violations;
}

/** Whether a POSIX path (relative to `apps/mobile/src`) is in the guard's scan set. */
export function isInScanSet(relPath: string): boolean {
  if (!/\.(ts|tsx)$/.test(relPath)) return false;
  if (/\.d\.ts$/.test(relPath)) return false;
  if (/\.test\.tsx?$/.test(relPath)) return false;
  if (relPath.startsWith('test/')) return false;
  const segments = relPath.split('/');
  return !segments.includes('__tests__') && !segments.includes('__testSupport__');
}
