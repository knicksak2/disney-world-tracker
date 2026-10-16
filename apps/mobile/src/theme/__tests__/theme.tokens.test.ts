/**
 * Token-model tests for the dark-mode retrofit (`theme/theme.ts`):
 * Property 7 (light/dark key parity), Property 8 (light is byte-identical to
 * the pre-retrofit palette), Property 22's pure half (category fills behind
 * white), plus `withAlpha` / `definePalette` unit cases.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 9.2, 9.11, 10.2
 */

import fc from 'fast-check';
import { DefaultTheme } from '@react-navigation/native';
import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { buildNavigationTheme } from '../AppearanceChrome';
import { contrastRatio } from '../contrast';
import {
  categoryMeta,
  darkTheme,
  definePalette,
  lightColor,
  lightTheme,
  theme,
  themes,
  withAlpha,
  type AppTheme,
} from '../theme';

const NUM_RUNS = 100;
const RRGGBB = /^#[0-9a-f]{6}$/;
const COLOR_STRING =
  /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(\d*\.)?\d+\s*)?\))$/i;

const GROUPS = [
  'color',
  'gradient',
  'shadow',
  'outline',
  'parkAccent',
  'categoryVisual',
  'resortVisual',
  'tabBar',
] as const;
type Group = (typeof GROUPS)[number];

const groupOf = (t: AppTheme, g: Group): Record<string, unknown> =>
  t[g] as unknown as Record<string, unknown>;

/** Pre-retrofit literal values, copied from the design's "light" column. */
const PRE_RETROFIT_COLOR = {
  primary: '#5b2a86',
  primaryDark: '#3d1c5c',
  primaryLight: '#7e57c2',
  accent: '#f6c343',
  accentDark: '#d4a017',
  background: '#f5f2fb',
  surface: '#ffffff',
  surfaceAlt: '#efe9f7',
  textPrimary: '#1f1235',
  textSecondary: '#6b6480',
  textOnPrimary: '#ffffff',
  textOnAccent: '#3d1c5c',
  success: '#2e9e6b',
  danger: '#d6336c',
  warning: '#e8a317',
  warningSurface: '#fff4d6',
  warningText: '#8a5a00',
  border: '#e2d9f0',
  borderStrong: '#cdbce6',
  star: '#ffffff',
  starRating: '#f59e0b',
};
const PRE_RETROFIT_PARK = {
  'Magic Kingdom': '#7e57c2',
  EPCOT: '#2f80ed',
  'Hollywood Studios': '#e8505b',
  'Animal Kingdom': '#3fa34d',
  'Typhoon Lagoon': '#17a2b8',
  'Blizzard Beach': '#4dabf7',
  'Disney Springs': '#f6a609',
};
const PRE_RETROFIT_CATEGORY = {
  Ride: { glyph: 'rocket', tint: '#7e57c2', label: 'Ride' },
  Show: { glyph: 'musical-notes', tint: '#e8505b', label: 'Show' },
  Restaurant: { glyph: 'restaurant', tint: '#f6a609', label: 'Restaurant' },
  Parade: { glyph: 'sparkles', tint: '#f6c343', label: 'Parade' },
  Character_Meet: { glyph: 'happy', tint: '#2f80ed', label: 'Character Meet' },
  Walkthrough: { glyph: 'footsteps', tint: '#00897b', label: 'Walkthrough' },
  PlayArea: { glyph: 'football', tint: '#43a047', label: 'Play Area' },
  Game: { glyph: 'game-controller', tint: '#8e24aa', label: 'Game' },
  Tour: { glyph: 'walk', tint: '#00897b', label: 'Tour' },
  Recreation: { glyph: 'bicycle', tint: '#43a047', label: 'Recreation' },
  Spa: { glyph: 'flower', tint: '#ec407a', label: 'Spa' },
  Event: { glyph: 'calendar', tint: '#8e24aa', label: 'Event' },
  Other: { glyph: 'star', tint: '#6b6480', label: 'Other' },
  Resort: { glyph: 'bed', tint: '#5b2a86', label: 'Resort' },
};
const HEADER_VIVID_LIGHT = ['#7e57c2', '#5b2a86', '#3d1c5c'];

describe('Property 7: light/dark token key parity', () => {
  // Feature: dark-mode, Property 7: light/dark token key parity
  it('every token group has identical key sets and valid colour values in both schemes', () => {
    fc.assert(
      fc.property(fc.constantFrom(...GROUPS), (group) => {
        const light = groupOf(lightTheme, group);
        const dark = groupOf(darkTheme, group);
        expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
        for (const key of Object.keys(light)) {
          const lv = light[key];
          const dv = dark[key];
          if (Array.isArray(lv)) {
            expect((dv as unknown[]).length).toBe(lv.length);
            for (const stop of [...lv, ...(dv as string[])]) expect(stop).toMatch(COLOR_STRING);
          } else if (key === 'glyph' || key === 'label') {
            // resortVisual's colour-free metadata is scheme-invariant.
            expect(dv).toBe(lv);
          } else if (typeof lv === 'string') {
            expect(lv).toMatch(COLOR_STRING);
            expect(dv).toMatch(COLOR_STRING);
          } else if (lv !== null && typeof lv === 'object' && group !== 'outline') {
            // `outline.card` is deliberately a zero border in light and a
            // hairline in dark (a dark-only addition); every other nested
            // record matches.
            expect(Object.keys(dv as object).sort()).toEqual(Object.keys(lv).sort());
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dark-mode, Property 7: light/dark token key parity
  it('every (group, key) pair exists in both schemes', () => {
    const pairs = GROUPS.flatMap((g) => Object.keys(groupOf(lightTheme, g)).map((k) => [g, k] as const));
    fc.assert(
      fc.property(fc.constantFrom(...pairs), ([group, key]) => {
        expect(groupOf(darkTheme, group)).toHaveProperty([key]);
        expect(groupOf(lightTheme, group)).toHaveProperty([key]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: dark-mode, Property 7: light/dark token key parity
  it('category glyph/label are scheme-invariant and equal categoryMeta; tint and fill exist', () => {
    fc.assert(
      fc.property(fc.constantFrom(...EXPERIENCE_CATEGORIES), fc.constantFrom<'light' | 'dark'>('light', 'dark'), (cat, s) => {
        const v = themes[s].categoryVisual[cat];
        expect({ glyph: v.glyph, label: v.label }).toEqual(categoryMeta[cat]);
        expect(v.tint).toMatch(RRGGBB);
        expect(v.fill).toMatch(RRGGBB);
      }),
      { numRuns: NUM_RUNS },
    );
    for (const s of ['light', 'dark'] as const) {
      expect(themes[s].resortVisual.tint).toMatch(RRGGBB);
      expect(themes[s].resortVisual.fill).toMatch(RRGGBB);
      expect(themes[s].gradient.fab).toHaveLength(3);
      expect(themes[s].gradient.chartBar).toHaveLength(3);
    }
  });

  // Feature: dark-mode, Property 7: light/dark token key parity
  it('every color, parkAccent, category tint/fill and resortVisual value is lowercase #rrggbb in both schemes', () => {
    fc.assert(
      fc.property(fc.constantFrom<'light' | 'dark'>('light', 'dark'), (s) => {
        const t = themes[s];
        for (const v of Object.values(t.color)) expect(v).toMatch(RRGGBB);
        for (const p of PARKS) expect(t.parkAccent[p]).toMatch(RRGGBB);
        for (const c of EXPERIENCE_CATEGORIES) {
          expect(t.categoryVisual[c].tint).toMatch(RRGGBB);
          expect(t.categoryVisual[c].fill).toMatch(RRGGBB);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('themes maps each scheme to its theme, tagged with that scheme', () => {
    expect(themes.light).toBe(lightTheme);
    expect(themes.dark).toBe(darkTheme);
    expect(lightTheme.scheme).toBe('light');
    expect(darkTheme.scheme).toBe('dark');
    expect(darkTheme.spacing).toBe(lightTheme.spacing);
    expect(darkTheme.typography).toBe(lightTheme.typography);
  });

  it('the static theme export is colour-free and shares the scheme-invariant tokens', () => {
    expect(Object.keys(theme)).toEqual(['spacing', 'radius', 'layout', 'typography']);
    expect(theme.spacing).toBe(lightTheme.spacing);
    expect(theme.radius).toBe(lightTheme.radius);
    expect(theme.layout).toBe(lightTheme.layout);
    expect(theme.typography).toBe(lightTheme.typography);
  });
});

describe('Property 8: light theme is byte-identical to the pre-retrofit palette', () => {
  // Feature: dark-mode, Property 8: light theme is byte-identical to the pre-retrofit palette
  it('every pre-retrofit colour token keeps its literal value', () => {
    const keys = Object.keys(PRE_RETROFIT_COLOR) as (keyof typeof PRE_RETROFIT_COLOR)[];
    fc.assert(
      fc.property(fc.constantFrom(...keys), (key) => {
        expect(lightTheme.color[key]).toBe(PRE_RETROFIT_COLOR[key]);
        expect(lightColor[key]).toBe(PRE_RETROFIT_COLOR[key]);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(lightTheme.color.primaryFg).toBe(lightTheme.color.primary);
    expect(Object.keys(lightColor).sort()).toEqual([...Object.keys(PRE_RETROFIT_COLOR), 'primaryFg'].sort());
  });

  it('gradients, shadows, park accents, categories, resort visual, tab bar are unchanged in light', () => {
    expect(lightTheme.gradient.header).toEqual(['#5b2a86', '#3d1c5c']);
    expect(lightTheme.gradient.headerVivid).toEqual(HEADER_VIVID_LIGHT);
    expect(lightTheme.gradient.gold).toEqual(['#f6c343', '#d4a017']);
    expect(lightTheme.gradient.fab).toEqual(HEADER_VIVID_LIGHT);
    expect(lightTheme.gradient.chartBar).toEqual(HEADER_VIVID_LIGHT);

    expect(lightTheme.shadow).toEqual({
      card: {
        shadowColor: '#3d1c5c',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 3,
      },
      floating: {
        shadowColor: '#3d1c5c',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 6,
      },
    });

    expect(lightTheme.parkAccent).toEqual(PRE_RETROFIT_PARK);

    for (const cat of EXPERIENCE_CATEGORIES) {
      const pre = PRE_RETROFIT_CATEGORY[cat];
      expect(lightTheme.categoryVisual[cat]).toEqual({ ...pre, fill: pre.tint });
    }
    expect(lightTheme.resortVisual).toEqual({ glyph: 'bed', tint: '#5b2a86', fill: '#5b2a86', label: 'Resort' });

    expect(lightTheme.tabBar).toEqual({
      background: 'rgb(255, 255, 255)',
      border: 'rgb(216, 216, 216)',
      activeTint: '#003a9b',
      inactiveTint: '#6b7280',
      badgeBackground: '#d97706',
      badgeText: '#ffffff',
    });
    // The light tab surface is exactly React Navigation's DefaultTheme.
    expect(lightTheme.tabBar.background).toBe(DefaultTheme.colors.card);
    expect(lightTheme.tabBar.border).toBe(DefaultTheme.colors.border);
  });

  it('light dark-only additions are empty, and light navigation is DefaultTheme by identity', () => {
    // Regression (spec task 11 screenshot pass): light must *explicitly* zero
    // the border, not omit it. With `{}` a dark→light live switch never
    // reset Android's native border, leaving `overflow: 'hidden'` cards blank.
    // A zero width draws nothing, so light stays visually unchanged.
    expect(lightTheme.outline.card).toEqual({ borderWidth: 0 });
    expect(lightTheme.textDefault).toEqual({});
    expect(buildNavigationTheme(lightTheme)).toBe(DefaultTheme);
  });

  it("withAlpha reproduces the former hexToRgba string exactly", () => {
    expect(withAlpha('#5b2a86', 0.14)).toBe('rgba(91, 42, 134, 0.14)');
  });
});

describe('dark values (Configuration & Constants spot checks)', () => {
  it('pins the Twilight core, outline and default text', () => {
    expect(darkTheme.color.background).toBe('#120a1f');
    expect(darkTheme.color.surface).toBe('#1e1430');
    expect(darkTheme.color.primaryLight).toBe('#b28dff');
    expect(darkTheme.color.primaryFg).toBe('#c4a3ff');
    expect(darkTheme.gradient.header).toEqual(['#7e57c2', '#7650b9']);
    expect(darkTheme.gradient.fab).toEqual(['#9d7ae0', '#7e57c2', '#7650b9']);
    expect(darkTheme.gradient.chartBar).toEqual(['#c4a3ff', '#9d7ae0', '#7e57c2']);
    expect(darkTheme.outline.card).toEqual({ borderWidth: expect.any(Number), borderColor: '#33264d' });
    expect(darkTheme.textDefault).toEqual({ color: '#f3eefc' });
    expect(darkTheme.shadow.card.shadowColor).toBe('#000000');
    expect(darkTheme.shadow.card.elevation).toBe(lightTheme.shadow.card.elevation);
    expect(darkTheme.shadow.floating.elevation).toBe(lightTheme.shadow.floating.elevation);
  });
});

describe('Property 22 (pure half): category fills stay legible behind white in dark', () => {
  // Feature: dark-mode, Property 22: role-converted token reads and category fills stay legible in dark
  it('white on every dark category fill is >= 4.5:1, and light fill equals light tint', () => {
    fc.assert(
      fc.property(fc.constantFrom(...EXPERIENCE_CATEGORIES), (cat) => {
        expect(contrastRatio('#ffffff', darkTheme.categoryVisual[cat].fill)).toBeGreaterThanOrEqual(4.5);
        expect(lightTheme.categoryVisual[cat].fill).toBe(lightTheme.categoryVisual[cat].tint);
      }),
      { numRuns: NUM_RUNS },
    );
    expect(contrastRatio('#ffffff', darkTheme.resortVisual.fill)).toBeGreaterThanOrEqual(4.5);
    expect(lightTheme.resortVisual.fill).toBe(lightTheme.resortVisual.tint);
  });
});

describe('withAlpha', () => {
  it('accepts #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(), replacing any alpha', () => {
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(withAlpha('#FFF', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    expect(withAlpha('#7e57c2', 0.1)).toBe('rgba(126, 87, 194, 0.1)');
    expect(withAlpha('#7e57c280', 0.3)).toBe('rgba(126, 87, 194, 0.3)');
    expect(withAlpha('rgb(216, 216, 216)', 0.2)).toBe('rgba(216, 216, 216, 0.2)');
    expect(withAlpha('rgba(31, 18, 53, 0.5)', 0.14)).toBe('rgba(31, 18, 53, 0.14)');
  });

  it('passes alpha through unformatted', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (a) => {
        expect(withAlpha('#000000', a)).toBe(`rgba(0, 0, 0, ${a})`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws a clear error on unsupported input', () => {
    for (const bad of ['red', '#12', '#12345', 'hsl(0, 0%, 0%)', '', 'rgb(300, 0, 0)']) {
      expect(() => withAlpha(bad, 0.5)).toThrow(`withAlpha: unsupported colour ${bad}`);
    }
  });
});

describe('definePalette', () => {
  it('returns its argument unchanged (identity)', () => {
    const input = { light: { a: '#ffffff', b: '#000000' }, dark: { a: '#1e1430', b: '#f3eefc' } };
    const palette = definePalette(input);
    expect(palette).toBe(input);
    expect(palette.light.a).toBe('#ffffff');
    expect(palette.dark.b).toBe('#f3eefc');
  });
});
