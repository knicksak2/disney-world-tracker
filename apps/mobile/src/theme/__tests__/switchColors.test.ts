// Feature: dark-mode, Property 24: Every Switch is themed in dark and unchanged in light
//
// `themedSwitchProps` returns the call site's light props verbatim (undefined
// stays undefined, so platform defaults survive) and, in dark, one
// token-derived set where "on" reads stronger than "off".
import fc from 'fast-check';

import { contrastRatio } from '../contrast';
import { themedSwitchProps, type SwitchColorProps } from '../switchColors';
import { darkTheme, lightTheme } from '../theme';

const hexArb = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map(([r, g, b]) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`);

const lightPropsArb: fc.Arbitrary<SwitchColorProps> = fc.record(
  {
    trackColor: fc.record({ false: hexArb, true: hexArb }, { requiredKeys: [] }),
    thumbColor: hexArb,
    ios_backgroundColor: hexArb,
  },
  { requiredKeys: [] },
);

describe('Feature: dark-mode, Property 24: themedSwitchProps', () => {
  it('light returns the call-site props verbatim (same reference, deep-equal)', () => {
    fc.assert(
      fc.property(fc.boolean(), lightPropsArb, (value, light) => {
        const snapshot = JSON.parse(JSON.stringify(light)) as SwitchColorProps;
        const out = themedSwitchProps(lightTheme, value, light);
        expect(out).toBe(light);
        expect(out).toEqual(snapshot);
      }),
      { numRuns: 200 },
    );
  });

  it('light with no props keeps every colour undefined (platform default)', () => {
    fc.assert(
      fc.property(fc.boolean(), (value) => {
        const out = themedSwitchProps(lightTheme, value);
        expect(out.trackColor).toBeUndefined();
        expect(out.thumbColor).toBeUndefined();
        expect(out.ios_backgroundColor).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('dark ignores the light props and returns the token set; on is stronger than off', () => {
    fc.assert(
      fc.property(fc.boolean(), lightPropsArb, (value, light) => {
        const out = themedSwitchProps(darkTheme, value, light);
        expect(out.trackColor).toEqual({
          false: darkTheme.color.borderStrong,
          true: darkTheme.color.primary,
        });
        expect(out.ios_backgroundColor).toBe(darkTheme.color.borderStrong);
        expect(out.thumbColor).toBe(
          value ? darkTheme.color.textOnPrimary : darkTheme.color.textSecondary,
        );

        const on = themedSwitchProps(darkTheme, true, light);
        const off = themedSwitchProps(darkTheme, false, light);
        expect(on.thumbColor).not.toBe(off.thumbColor);
        // The on track is brighter against the card than the off track.
        expect(contrastRatio(on.trackColor!.true!, darkTheme.color.surface)).toBeGreaterThan(
          contrastRatio(off.trackColor!.false!, darkTheme.color.surface),
        );
        // Thumbs stay visible on their own tracks (non-text >= 3:1).
        expect(contrastRatio(on.thumbColor!, on.trackColor!.true!)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(off.thumbColor!, off.trackColor!.false!)).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 200 },
    );
  });
});
