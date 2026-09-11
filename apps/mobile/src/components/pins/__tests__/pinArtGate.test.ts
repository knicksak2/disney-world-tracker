/**
 * Build-gate: every pin in the shared Series 1 catalog must have baked artwork in `pinArt.ts`,
 * and every baked entry must be a real SVG. This guards the pre-bake pipeline — if a pin is added
 * to the catalog (or the bake is stale/regenerated wrong), the board would render a fallback box
 * for it; this test fails instead, so missing art can never ship silently.
 */
import { PINS } from '@dwt/shared';

import { PIN_ART } from '../pinArt';

describe('baked pin art coverage', () => {
  it('has baked artwork for every catalog pin', () => {
    const missing = PINS.filter((p) => !PIN_ART[p.id]).map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it('every baked entry is a non-trivial SVG document', () => {
    for (const p of PINS) {
      const svg = PIN_ART[p.id]!;
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('</svg>');
      expect(svg.length).toBeGreaterThan(200);
    }
  });

  it('does not carry orphan art for pins no longer in the catalog', () => {
    const ids = new Set(PINS.map((p) => p.id));
    const orphans = Object.keys(PIN_ART).filter((id) => !ids.has(id));
    expect(orphans).toEqual([]);
  });
});
