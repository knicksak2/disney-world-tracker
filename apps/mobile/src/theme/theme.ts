/**
 * Disney World Tracker — visual theme ("Magical / Whimsical").
 *
 * A single source of truth for color, spacing, typography, radius, and
 * shadow so every screen renders against a consistent design language
 * instead of hand-rolled per-screen styles. The palette leans into a
 * "theme-park magic" feeling: deep royal purples, warm gold accents, and
 * soft surfaces with gentle elevation.
 *
 * Usage — colours come from the active scheme (light or "Twilight" dark):
 *
 *   const useStyles = makeStyles((t) => ({
 *     card: { backgroundColor: t.color.surface, padding: t.spacing.lg },
 *   }));
 *   // or, inline: const t = useAppTheme();
 *
 * The static `theme` export carries only scheme-invariant tokens (spacing,
 * radius, layout, typography). Park accents (`t.parkAccent`), category glyph +
 * tint/fill (`t.categoryVisual`) and the resort visual (`t.resortVisual`) live
 * on the active `AppTheme`; `categoryMeta` is the colour-free category metadata.
 */

import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import type { ExperienceCategory, Park } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Color scheme
// ---------------------------------------------------------------------------

/**
 * The two concrete schemes a theme exists for. Structurally identical to
 * `appearance.ts`'s `ActiveTheme`, declared here so this module imports
 * nothing at runtime from `appearance.ts` / `useActiveTheme.ts` / the store
 * (`appearance.ts` already imports this module — importing back would form a
 * runtime cycle).
 */
export type ColorScheme = 'light' | 'dark';

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/**
 * Light colour tokens — today's values verbatim, plus `primaryFg` (primary-hued
 * text / icons / links / data marks on surfaces). In light `primaryFg` equals
 * `primary`, so light mode renders exactly as before.
 */
export const lightColor = {
  // Brand — deep royal purple with a gold counterpoint.
  primary: '#5b2a86', // royal purple
  primaryDark: '#3d1c5c', // deep aubergine (header gradient end)
  primaryLight: '#7e57c2', // lighter purple for pressed/hover
  primaryFg: '#5b2a86', // primary-hued foreground on surfaces (dark-mode retrofit)
  accent: '#f6c343', // warm gold
  accentDark: '#d4a017', // deeper gold for text-on-gold contrast

  // Backgrounds / surfaces.
  background: '#f5f2fb', // very light lavender-tinted app background
  surface: '#ffffff', // card surface
  surfaceAlt: '#efe9f7', // subtly tinted alt surface (chips, fills)

  // Text.
  textPrimary: '#1f1235', // near-black with a purple cast
  textSecondary: '#6b6480', // muted lavender-grey
  textOnPrimary: '#ffffff', // text on purple/gradient
  textOnAccent: '#3d1c5c', // text on gold

  // Feedback.
  success: '#2e9e6b',
  danger: '#d6336c', // raspberry — fits the palette better than fire-engine red
  warning: '#e8a317',
  warningSurface: '#fff4d6',
  warningText: '#8a5a00',

  // Lines / borders.
  border: '#e2d9f0',
  borderStrong: '#cdbce6',

  // Star/sparkle highlights for the starry headers.
  star: '#ffffff',
  starRating: '#f59e0b',
} as const;

export type ColorToken = keyof typeof lightColor;
export type ColorTokens = { readonly [K in ColorToken]: string };

/**
 * "Twilight" dark colour tokens. `satisfies ColorTokens` makes a missing key
 * AND an extra key a compile error, so both schemes always share one key set.
 */
export const darkColor = {
  primary: '#7e57c2',
  primaryDark: '#2a1450',
  primaryLight: '#b28dff',
  primaryFg: '#c4a3ff',
  accent: '#f6c343',
  accentDark: '#d4a017',

  background: '#120a1f',
  surface: '#1e1430',
  surfaceAlt: '#2a1d42',

  textPrimary: '#f3eefc',
  textSecondary: '#b3a8c9',
  textOnPrimary: '#ffffff',
  textOnAccent: '#3d1c5c',

  success: '#4cc38a',
  danger: '#ff6b9a',
  warning: '#f5b83d',
  warningSurface: '#3a2c0e',
  warningText: '#ffd27a',

  border: '#33264d',
  borderStrong: '#4a3a6b',

  star: '#ffffff',
  starRating: '#f6c343',
} as const satisfies ColorTokens;

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

/** Tuple form expected by `expo-linear-gradient`'s `colors` prop. */
export interface GradientTokens {
  /** `PrimaryButton` only. */
  readonly header: readonly [string, string];
  /** `GradientHeader` and the Home / Live Waits heroes. */
  readonly headerVivid: readonly [string, string, string];
  readonly gold: readonly [string, string];
  /** `MagicFab` disc. Light equals `headerVivid`. */
  readonly fab: readonly [string, string, string];
  /** `RatingHistogram` bars. Light equals `headerVivid`. */
  readonly chartBar: readonly [string, string, string];
}

/**
 * Light gradients — today's values. The header gradient is the signature
 * "twilight over the castle" look.
 */
const lightGradient = {
  header: ['#5b2a86', '#3d1c5c'],
  headerVivid: ['#7e57c2', '#5b2a86', '#3d1c5c'],
  gold: ['#f6c343', '#d4a017'],
  fab: ['#7e57c2', '#5b2a86', '#3d1c5c'],
  chartBar: ['#7e57c2', '#5b2a86', '#3d1c5c'],
} as const satisfies GradientTokens;

const darkGradient = {
  header: ['#7e57c2', '#7650b9'],
  headerVivid: ['#5b2a86', '#3b1d6e', '#1a0d33'],
  gold: ['#f6c343', '#d4a017'],
  fab: ['#9d7ae0', '#7e57c2', '#7650b9'],
  chartBar: ['#c4a3ff', '#9d7ae0', '#7e57c2'],
} as const satisfies GradientTokens;

// ---------------------------------------------------------------------------
// Spacing (4-pt scale)
// ---------------------------------------------------------------------------

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// ---------------------------------------------------------------------------
// Radius
// ---------------------------------------------------------------------------

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Shared layout constants for composing screens against the themed shell.
 *
 * `headerOverlap` is the amount the first block of screen content rises up
 * into the `GradientHeader`'s rounded bottom edge (applied as a negative top
 * margin on the content body). The tuck fills the gap left by the header's
 * `borderBottomRadius` so content reads as emerging from the header rather
 * than sitting below a hard seam.
 *
 * Invariant: keep this <= `radius.xl` (the header's bottom corner radius) so
 * the content nests *within* the curve instead of overrunning it. It is
 * defined here — once — so every screen shares the same value instead of
 * hand-copying a magic negative margin, and so changing the header curve only
 * requires re-tuning a single named constant.
 */
export const layout = {
  headerOverlap: spacing.lg,
} as const;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const typography = {
  display: { fontSize: 28, fontWeight: '800' as const, letterSpacing: 0.3 },
  title: { fontSize: 22, fontWeight: '700' as const },
  heading: { fontSize: 18, fontWeight: '700' as const },
  subtitle: { fontSize: 15, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  meta: { fontSize: 12, fontWeight: '600' as const },
  button: { fontSize: 16, fontWeight: '700' as const },
} as const;

// ---------------------------------------------------------------------------
// Shadow (soft elevation)
// ---------------------------------------------------------------------------

export interface ShadowStyle {
  readonly shadowColor: string;
  readonly shadowOffset: { readonly width: number; readonly height: number };
  readonly shadowOpacity: number;
  readonly shadowRadius: number;
  /** Identical in both schemes — on Android it also sets z-order. */
  readonly elevation: number;
}
export interface ShadowTokens {
  readonly card: ShadowStyle;
  readonly floating: ShadowStyle;
}

const lightShadow = {
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
} as const satisfies ShadowTokens;

const darkShadow = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  floating: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 6,
  },
} as const satisfies ShadowTokens;

// ---------------------------------------------------------------------------
// Park accents
// ---------------------------------------------------------------------------

/**
 * Per-park accent hue used on badges and section accents so each Walt
 * Disney World park reads with its own identity. Keys match the `Park`
 * union from `@dwt/shared`.
 */
const lightParkAccent: Readonly<Record<Park, string>> = {
  'Magic Kingdom': '#7e57c2', // castle purple
  EPCOT: '#2f80ed', // spaceship-earth blue
  'Hollywood Studios': '#e8505b', // clapperboard red
  'Animal Kingdom': '#3fa34d', // jungle green
  'Typhoon Lagoon': '#17a2b8', // lagoon teal
  'Blizzard Beach': '#4dabf7', // ice blue
  'Disney Springs': '#f6a609', // sunset amber
};

/** Each park hue brightened until it clears 4.5:1 on the dark surface. */
const darkParkAccent: Readonly<Record<Park, string>> = {
  'Magic Kingdom': '#b28dff',
  EPCOT: '#5aa2ff',
  'Hollywood Studios': '#ff7a83',
  'Animal Kingdom': '#5cc46a',
  'Typhoon Lagoon': '#3cc9de',
  'Blizzard Beach': '#7cc4ff',
  'Disney Springs': '#ffb732',
};

// ---------------------------------------------------------------------------
// Category visuals
// ---------------------------------------------------------------------------

/**
 * Ionicons glyph + tint per experience category. The glyph names are
 * valid `Ionicons` keys; consumers render `<Ionicons name={glyph} />`.
 */
export interface CategoryVisual {
  readonly glyph: string;
  readonly label: string;
  /** Foreground role: text, icon, border, `Badge` colour, chip tint. */
  readonly tint: string;
  /** Solid fill behind a white glyph / text (placeholder tiles). Light: `=== tint`. */
  readonly fill: string;
}

/** Colour-free category metadata — safe to import statically anywhere. */
export const categoryMeta: Readonly<
  Record<ExperienceCategory, { readonly glyph: string; readonly label: string }>
> = {
  Ride: { glyph: 'rocket', label: 'Ride' },
  Show: { glyph: 'musical-notes', label: 'Show' },
  Restaurant: { glyph: 'restaurant', label: 'Restaurant' },
  Parade: { glyph: 'sparkles', label: 'Parade' },
  Character_Meet: { glyph: 'happy', label: 'Character Meet' },
  Walkthrough: { glyph: 'footsteps', label: 'Walkthrough' },
  PlayArea: { glyph: 'football', label: 'Play Area' },
  Game: { glyph: 'game-controller', label: 'Game' },
  Tour: { glyph: 'walk', label: 'Tour' },
  Recreation: { glyph: 'bicycle', label: 'Recreation' },
  Spa: { glyph: 'flower', label: 'Spa' },
  Event: { glyph: 'calendar', label: 'Event' },
  Other: { glyph: 'star', label: 'Other' },
  Resort: { glyph: 'bed', label: 'Resort' },
};

/** Today's category tints (light). In light the fill map is this map itself. */
const CATEGORY_TINT_LIGHT: Readonly<Record<ExperienceCategory, string>> = {
  Ride: '#7e57c2',
  Show: '#e8505b',
  Restaurant: '#f6a609',
  Parade: '#f6c343',
  Character_Meet: '#2f80ed',
  Walkthrough: '#00897b',
  PlayArea: '#43a047',
  Game: '#8e24aa',
  Tour: '#00897b',
  Recreation: '#43a047',
  Spa: '#ec407a',
  Event: '#8e24aa',
  Other: '#6b6480',
  Resort: '#5b2a86',
};

/** Dark tints: each hue brightened to clear 4.5:1 on the dark surface. */
const CATEGORY_TINT_DARK: Readonly<Record<ExperienceCategory, string>> = {
  Ride: '#b28dff',
  Show: '#ff7a83',
  Restaurant: '#ffb732',
  Parade: '#f6c343',
  Character_Meet: '#5aa2ff',
  Walkthrough: '#2ec4b0',
  PlayArea: '#6fcf73',
  Game: '#d27ff0',
  Tour: '#2ec4b0',
  Recreation: '#6fcf73',
  Spa: '#ff7eb3',
  Event: '#d27ff0',
  Other: '#b3a8c9',
  Resort: '#c4a3ff',
};

/** Dark fills: white text / glyph on each clears 4.5:1. */
const CATEGORY_FILL_DARK: Readonly<Record<ExperienceCategory, string>> = {
  Ride: '#7e57c2',
  Show: '#c42b3c',
  Restaurant: '#b5520f',
  Parade: '#9a5b00',
  Character_Meet: '#2563eb',
  Walkthrough: '#0e7490',
  PlayArea: '#1f7a52',
  Game: '#8e24aa',
  Tour: '#0e7490',
  Recreation: '#1f7a52',
  Spa: '#b8336f',
  Event: '#8e24aa',
  Other: '#4a3a6b',
  Resort: '#5b2a86',
};

function buildCategoryVisual(
  tints: Readonly<Record<ExperienceCategory, string>>,
  fills: Readonly<Record<ExperienceCategory, string>>,
): Readonly<Record<ExperienceCategory, CategoryVisual>> {
  const out = {} as Record<ExperienceCategory, CategoryVisual>;
  for (const key of Object.keys(categoryMeta) as ExperienceCategory[]) {
    out[key] = {
      glyph: categoryMeta[key].glyph,
      label: categoryMeta[key].label,
      tint: tints[key],
      fill: fills[key],
    };
  }
  return out;
}

const lightCategoryVisual = buildCategoryVisual(CATEGORY_TINT_LIGHT, CATEGORY_TINT_LIGHT);
const darkCategoryVisual = buildCategoryVisual(CATEGORY_TINT_DARK, CATEGORY_FILL_DARK);

// ---------------------------------------------------------------------------
// Resort visual
// ---------------------------------------------------------------------------

/**
 * Placeholder visual for a Resort (a first-class catalog concept distinct from
 * an Experience). Used when a Resort's `imageUrl` is `null` so every resort in
 * the browse list still shows a recognizable glyph + tint rather than a blank
 * tile (R7.5).
 */
const lightResortVisual: CategoryVisual = {
  glyph: 'bed',
  tint: '#5b2a86',
  fill: '#5b2a86',
  label: 'Resort',
};
const darkResortVisual: CategoryVisual = {
  glyph: 'bed',
  tint: '#c4a3ff',
  fill: '#5b2a86',
  label: 'Resort',
};

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

/**
 * Bottom-tab chrome. `background` / `border` are also the navigation theme's
 * `card` / `border`, which `BottomTabBar` paints from — so light keeps
 * React Navigation's `DefaultTheme` values exactly.
 */
export interface TabBarTokens {
  readonly background: string;
  readonly border: string;
  readonly activeTint: string;
  readonly inactiveTint: string;
  readonly badgeBackground: string;
  readonly badgeText: string;
}

const lightTabBar: TabBarTokens = {
  background: 'rgb(255, 255, 255)',
  border: 'rgb(216, 216, 216)',
  activeTint: '#003a9b',
  inactiveTint: '#6b7280',
  badgeBackground: '#d97706',
  badgeText: '#ffffff',
};
const darkTabBar: TabBarTokens = {
  background: '#170e27',
  border: '#33264d',
  activeTint: '#f6c343',
  inactiveTint: '#8a7fa3',
  badgeBackground: '#f6c343',
  badgeText: '#3d1c5c',
};

// ---------------------------------------------------------------------------
// Full themes
// ---------------------------------------------------------------------------

export interface AppTheme {
  readonly scheme: ColorScheme;
  readonly color: ColorTokens;
  readonly gradient: GradientTokens;
  readonly shadow: ShadowTokens;
  /**
   * Light: `{ borderWidth: 0 }` (renders as no border, but explicitly clears a
   * dark hairline on a live switch). Dark: hairline `border` outline — spread
   * into any card-like surface.
   */
  readonly outline: { readonly card: ViewStyle };
  /** Light: `{}` (keeps RN's default text colour exactly). Dark: `{ color: textPrimary }`. */
  readonly textDefault: TextStyle;
  readonly parkAccent: Readonly<Record<Park, string>>;
  readonly categoryVisual: Readonly<Record<ExperienceCategory, CategoryVisual>>;
  readonly resortVisual: CategoryVisual;
  readonly tabBar: TabBarTokens;
  /** Same static object in both themes. */
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly layout: typeof layout;
  readonly typography: typeof typography;
}

export const lightTheme: AppTheme = {
  scheme: 'light',
  color: lightColor,
  gradient: lightGradient,
  shadow: lightShadow,
  // Explicit zero, not `{}`: a key that is merely absent after a dark→light
  // switch is never reset natively, so Android kept the dark hairline border
  // state (blank `overflow: 'hidden'` cards, rectangular elevation halos).
  // A zero-width border renders identically to no border.
  outline: { card: { borderWidth: 0 } },
  textDefault: {},
  parkAccent: lightParkAccent,
  categoryVisual: lightCategoryVisual,
  resortVisual: lightResortVisual,
  tabBar: lightTabBar,
  spacing,
  radius,
  layout,
  typography,
};

export const darkTheme: AppTheme = {
  scheme: 'dark',
  color: darkColor,
  gradient: darkGradient,
  shadow: darkShadow,
  outline: { card: { borderWidth: StyleSheet.hairlineWidth, borderColor: darkColor.border } },
  textDefault: { color: darkColor.textPrimary },
  parkAccent: darkParkAccent,
  categoryVisual: darkCategoryVisual,
  resortVisual: darkResortVisual,
  tabBar: darkTabBar,
  spacing,
  radius,
  layout,
  typography,
};

export const themes: Readonly<Record<ColorScheme, AppTheme>> = {
  light: lightTheme,
  dark: darkTheme,
};

// ---------------------------------------------------------------------------
// Dark tonal ramp (for converting non-token literals)
// ---------------------------------------------------------------------------

export type TonalFamily =
  | 'violet'
  | 'green'
  | 'amber'
  | 'orange'
  | 'red'
  | 'pink'
  | 'blue'
  | 'sky'
  | 'teal';

export interface TonalRamp {
  /** Text / icon on a dark surface. */
  readonly fg: string;
  /** Tinted / subtle background (fg mixed 16 % over the dark surface). */
  readonly tint: string;
  /** Border / divider / track (fg mixed 35 % over the dark surface). */
  readonly border: string;
  /** Solid fill behind white text. */
  readonly fill: string;
}

/** Fixed dark tonal ramp — see design.md "Literal conversion rules". */
export const DARK_TONAL: Readonly<Record<TonalFamily, TonalRamp>> = {
  violet: { fg: '#c4a3ff', tint: '#392b51', border: '#584678', fill: '#7e57c2' },
  green: { fg: '#4cc38a', tint: '#25303e', border: '#2e5150', fill: '#1f7a52' },
  amber: { fg: '#f5b83d', tint: '#402e32', border: '#694d35', fill: '#9a5b00' },
  orange: { fg: '#ffa45c', tint: '#422b37', border: '#6d463f', fill: '#b5520f' },
  red: { fg: '#ff7a7a', tint: '#42243c', border: '#6d384a', fill: '#c42b3c' },
  pink: { fg: '#ff6b9a', tint: '#422241', border: '#6d3255', fill: '#b8336f' },
  blue: { fg: '#5aa2ff', tint: '#282b51', border: '#334678', fill: '#2563eb' },
  sky: { fg: '#7cc4ff', tint: '#2d3051', border: '#3f5278', fill: '#0369a1' },
  teal: { fg: '#3cc9de', tint: '#23314c', border: '#29536d', fill: '#0e7490' },
};

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i;

/**
 * Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)` or `rgba(r, g, b, a)`
 * into its `[r, g, b]` channels. Returns `null` for anything else.
 */
export function parseColorChannels(value: string): readonly [number, number, number] | null {
  const hex = HEX_RE.exec(value);
  if (hex !== null) {
    const body = hex[1]!;
    const full =
      body.length === 3
        ? body
            .split('')
            .map((c) => c + c)
            .join('')
        : body.slice(0, 6);
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = RGB_RE.exec(value);
  if (rgb !== null) {
    const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as const;
    if (channels.every((c) => c <= 255)) return channels;
  }
  return null;
}

/**
 * Colour → `rgba(r, g, b, alpha)`. Accepts `#rgb`, `#rrggbb`, `#rrggbbaa` (its
 * own alpha is replaced), `rgb(r, g, b)` and `rgba(r, g, b, a)` (alpha
 * replaced). Throws on anything else. The output format is pinned to
 * `rgba(${r}, ${g}, ${b}, ${alpha})` — the exact string the kit's former
 * `hexToRgba` produced — so light renders byte-identically.
 */
export function withAlpha(value: string, alpha: number): string {
  const channels = parseColorChannels(value);
  if (channels === null) {
    throw new Error(`withAlpha: unsupported colour ${value}`);
  }
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

/** Co-located light/dark literal pairs. Dark must have exactly the light keys. */
export interface ThemedPalette<K extends string> {
  readonly light: Readonly<Record<K, string>>;
  readonly dark: Readonly<Record<K, string>>;
}

/**
 * Declares a co-located `<File>.palette.ts` pair. The `dark` record's type is
 * mapped from the `light` keys, so a missing or extra dark key is a compile
 * error. Returns its argument unchanged.
 */
export function definePalette<const L extends Readonly<Record<string, string>>>(p: {
  readonly light: L;
  readonly dark: { readonly [K in keyof L]: string };
}): ThemedPalette<Extract<keyof L, string>> {
  return p as ThemedPalette<Extract<keyof L, string>>;
}

// ---------------------------------------------------------------------------
// Aggregated static export (colour-free)
// ---------------------------------------------------------------------------
//
// Only scheme-invariant tokens live here. Every colour, gradient, shadow,
// park accent and category/resort visual is read from the active theme via
// `useAppTheme()` / `makeStyles()` so it repaints on a scheme switch.

export const theme = {
  spacing,
  radius,
  layout,
  typography,
} as const;
