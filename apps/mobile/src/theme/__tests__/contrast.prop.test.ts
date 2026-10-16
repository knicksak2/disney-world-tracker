/**
 * Property 9: the declared dark-mode contrast floors hold against the real
 * tokens, and `contrastRatio` behaves as the WCAG 2.x ratio.
 *
 * Validates: Requirements 7.4, 7.5, 9.8
 */

import fc from 'fast-check';

import {
  CONTRAST_REQUIREMENTS,
  TIER_TEXT_DARK,
  contrastRatio,
  mixOver,
  relativeLuminance,
} from '../contrast';
import { TIER_COLOR } from '../../components/pins/pinTierMeta';

const NUM_RUNS = 200;
const hex6 = fc.hexaString({ minLength: 6, maxLength: 6 }).map((h) => `#${h}`);

describe('Property 9: declared contrast floors hold', () => {
  it('declares every documented pair family', () => {
    const labels = CONTRAST_REQUIREMENTS.map((r) => r.label);
    for (const needle of [
      'textPrimary on surface',
      'badge text on its 14% tint over surfaceAlt',
      'DARK_TONAL.violet.fg on its tint',
      'white on DARK_TONAL.red.fill',
      'white on categoryVisual Restaurant fill',
      'RatingHistogram chartBar stop 2 vs surface',
      'PrimaryButton header stop 1 vs background',
      'Chip active fill primary vs background',
      'MagicFab fab stop 2 vs surface ring',
      'white on inverse toast',
      'TIER_TEXT amethyst badge text on its 14% tint over surfaceAlt',
      'tab badge text on badge',
    ]) {
      expect(labels.some((l) => l.includes(needle))).toBe(true);
    }
    expect(CONTRAST_REQUIREMENTS.length).toBeGreaterThan(150);
  });

  // Feature: dark-mode, Property 9: declared contrast floors hold
  it('contrastRatio(fg, bg) >= min for every declared requirement', () => {
    fc.assert(
      fc.property(fc.constantFrom(...CONTRAST_REQUIREMENTS), (req) => {
        expect({ label: req.label, ok: contrastRatio(req.fg, req.bg) >= req.min }).toEqual({
          label: req.label,
          ok: true,
        });
      }),
      { numRuns: Math.max(100, CONTRAST_REQUIREMENTS.length) },
    );
    // Exhaustive pass so no entry depends on sampling.
    const failing = CONTRAST_REQUIREMENTS.filter((r) => contrastRatio(r.fg, r.bg) < r.min).map(
      (r) => `${r.label}: ${contrastRatio(r.fg, r.bg).toFixed(2)} < ${r.min}`,
    );
    expect(failing).toEqual([]);
  });

  // Feature: dark-mode, Property 9: declared contrast floors hold
  it('contrastRatio is symmetric and lies within [1, 21]', () => {
    fc.assert(
      fc.property(hex6, hex6, (a, b) => {
        const ab = contrastRatio(a, b);
        expect(ab).toBeCloseTo(contrastRatio(b, a), 12);
        expect(ab).toBeGreaterThanOrEqual(1);
        expect(ab).toBeLessThanOrEqual(21 + 1e-9);
        expect(contrastRatio(a, a)).toBeCloseTo(1, 12);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('pins known reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#000000')).toBe(0);
    // Design table: textPrimary on surface 15.40, white on dark primary 5.21.
    expect(contrastRatio('#f3eefc', '#1e1430')).toBeCloseTo(15.4, 1);
    expect(contrastRatio('#ffffff', '#7e57c2')).toBeCloseTo(5.21, 2);
    // Light reference (unchanged by design): white on light primary 9.90.
    expect(contrastRatio('#ffffff', '#5b2a86')).toBeCloseTo(9.9, 1);
  });

  it('mixOver composites source-over to an opaque #rrggbb', () => {
    expect(mixOver('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixOver('#7e57c2', '#1e1430', 0)).toBe('#1e1430');
    expect(mixOver('#7e57c2', '#1e1430', 1)).toBe('#7e57c2');
    // Design: primary 14 % over surface = selected row #2b1d44.
    expect(mixOver('#7e57c2', '#1e1430', 0.14)).toBe('#2b1d44');
    fc.assert(
      fc.property(hex6, hex6, fc.double({ min: 0, max: 1, noNaN: true }), (fg, bg, a) => {
        expect(mixOver(fg, bg, a)).toMatch(/^#[0-9a-f]{6}$/);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('TIER_TEXT dark values lift only amethyst and bronze; the other tiers keep their art colour', () => {
    expect(TIER_TEXT_DARK.amethyst).toBe('#c08ff5');
    expect(TIER_TEXT_DARK.bronze).toBe('#e0965f');
    for (const tier of ['silver', 'gold', 'pearl', 'prism', 'mythic'] as const) {
      expect(TIER_TEXT_DARK[tier]).toBe(TIER_COLOR[tier]);
    }
  });
});
