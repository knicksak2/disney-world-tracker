/**
 * Disney World Tracker — visual theme ("Magical / Whimsical").
 *
 * A single source of truth for color, spacing, typography, radius, and
 * shadow so every screen renders against a consistent design language
 * instead of hand-rolled per-screen styles. The palette leans into a
 * "theme-park magic" feeling: deep royal purples, warm gold accents, and
 * soft surfaces with gentle elevation.
 *
 * Usage:
 *
 *   import { theme } from '../theme/theme';
 *   ...
 *   backgroundColor: theme.color.surface,
 *   padding: theme.spacing.lg,
 *
 * Park accent colors let each Walt Disney World park carry its own hue on
 * badges and section accents (see `parkAccent`). Categories get an Ionicon
 * glyph + tint via `categoryVisual`.
 */

import type { ExperienceCategory, Park } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

export const color = {
  // Brand — deep royal purple with a gold counterpoint.
  primary: '#5b2a86', // royal purple
  primaryDark: '#3d1c5c', // deep aubergine (header gradient end)
  primaryLight: '#7e57c2', // lighter purple for pressed/hover
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
} as const;

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

/**
 * Tuple form expected by `expo-linear-gradient`'s `colors` prop. The
 * header gradient is the signature "twilight over the castle" look.
 */
export const gradient = {
  header: ['#5b2a86', '#3d1c5c'] as const,
  headerVivid: ['#7e57c2', '#5b2a86', '#3d1c5c'] as const,
  gold: ['#f6c343', '#d4a017'] as const,
} as const;

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

export const shadow = {
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
} as const;

// ---------------------------------------------------------------------------
// Park accents
// ---------------------------------------------------------------------------

/**
 * Per-park accent hue used on badges and section accents so each Walt
 * Disney World park reads with its own identity. Keys match the `Park`
 * union from `@dwt/shared`.
 */
export const parkAccent: Record<Park, string> = {
  'Magic Kingdom': '#7e57c2', // castle purple
  EPCOT: '#2f80ed', // spaceship-earth blue
  'Hollywood Studios': '#e8505b', // clapperboard red
  'Animal Kingdom': '#3fa34d', // jungle green
  'Typhoon Lagoon': '#17a2b8', // lagoon teal
  'Blizzard Beach': '#4dabf7', // ice blue
  'Disney Springs': '#f6a609', // sunset amber
};

// ---------------------------------------------------------------------------
// Category visuals
// ---------------------------------------------------------------------------

/**
 * Ionicons glyph + tint per experience category. The glyph names are
 * valid `Ionicons` keys; consumers render `<Ionicons name={glyph} />`.
 */
export const categoryVisual: Record<
  ExperienceCategory,
  { readonly glyph: string; readonly tint: string; readonly label: string }
> = {
  Ride: { glyph: 'rocket', tint: '#7e57c2', label: 'Ride' },
  Show: { glyph: 'musical-notes', tint: '#e8505b', label: 'Show' },
  Restaurant: { glyph: 'restaurant', tint: '#f6a609', label: 'Restaurant' },
  Parade: { glyph: 'sparkles', tint: '#f6c343', label: 'Parade' },
  Character_Meet: { glyph: 'happy', tint: '#2f80ed', label: 'Character Meet' },
  Tour: { glyph: 'walk', tint: '#00897b', label: 'Tour' },
  Recreation: { glyph: 'bicycle', tint: '#43a047', label: 'Recreation' },
  Spa: { glyph: 'flower', tint: '#ec407a', label: 'Spa' },
  Event: { glyph: 'calendar', tint: '#8e24aa', label: 'Event' },
  Other: { glyph: 'star', tint: '#6b6480', label: 'Other' },
};

// ---------------------------------------------------------------------------
// Resort visual
// ---------------------------------------------------------------------------

/**
 * Placeholder visual for a Resort (a first-class catalog concept distinct from
 * an Experience). Used when a Resort's `imageUrl` is `null` so every resort in
 * the browse list still shows a recognizable glyph + tint rather than a blank
 * tile (R7.5).
 */
export const resortVisual: {
  readonly glyph: string;
  readonly tint: string;
  readonly label: string;
} = { glyph: 'bed', tint: '#5b2a86', label: 'Resort' };

// ---------------------------------------------------------------------------
// Aggregated export
// ---------------------------------------------------------------------------

export const theme = {
  color,
  gradient,
  spacing,
  radius,
  typography,
  shadow,
  parkAccent,
  categoryVisual,
  resortVisual,
} as const;

export type Theme = typeof theme;
