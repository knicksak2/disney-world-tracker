// Feature: dark-mode — WCAG 2.x contrast helpers and the declared dark-mode
// contrast floors (design.md "Configuration & Constants"). Pure: no React,
// no I/O. `__tests__/contrast.prop.test.ts` (Property 9) re-checks every
// floor against the real tokens, so a token edit that breaks legibility
// fails CI.

import { TIER_COLOR } from '../components/pins/pinTierMeta';
import { LENS } from '../screens/catalog/LensSwitcher.palette';
import { COLLECTION } from '../screens/collection/CollectionScreen.palette';
import { PARK_WAIT_PULSE } from '../screens/home/ParkWaitPulse.palette';
import { SHARE_COMPOSER } from '../screens/share/ShareComposerScreen.palette';
import { FORM } from '../screens/trips/ExpenseFormModal.palette';
import { BALANCES } from '../screens/trips/TripBalancesScreen.palette';
import { EXPENSES } from '../screens/trips/TripExpensesScreen.palette';
import { SCHEDULE } from '../screens/trips/TripScheduleScreen.palette';
import { HEADER } from './components.palette';
import { themedSwitchProps } from './switchColors';
import { DARK_TONAL, darkTheme, lightTheme, parseColorChannels, type TonalFamily } from './theme';

// ---------------------------------------------------------------------------
// WCAG helpers
// ---------------------------------------------------------------------------

function channelsOf(color: string): readonly [number, number, number] {
  const channels = parseColorChannels(color);
  if (channels === null) {
    throw new Error(`contrast: unsupported colour ${color}`);
  }
  return channels;
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque colour, in `[0, 1]`. */
export function relativeLuminance(color: string): number {
  const [r, g, b] = channelsOf(color);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG 2.x contrast ratio between two opaque colours, in `[1, 21]`. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function toHex(channel: number): string {
  return Math.round(channel).toString(16).padStart(2, '0');
}

/**
 * Composites `fg` at `alpha` over an opaque `bg` (source-over) and returns the
 * resulting opaque colour as `#rrggbb`.
 */
export function mixOver(fg: string, bg: string, alpha: number): string {
  const f = channelsOf(fg);
  const b = channelsOf(bg);
  const mixed = [0, 1, 2].map((i) => f[i]! * alpha + b[i]! * (1 - alpha));
  return `#${mixed.map(toHex).join('')}`;
}

// ---------------------------------------------------------------------------
// Declared dark-mode floors
// ---------------------------------------------------------------------------

export interface ContrastRequirement {
  /** Human-readable pair name, printed when a floor fails. */
  readonly label: string;
  readonly fg: string;
  readonly bg: string;
  /** 4.5 for text, 3.0 for icons / non-text graphics (WCAG 1.4.11). */
  readonly min: number;
}

const TEXT = 4.5;
const NON_TEXT = 3.0;
/** `Badge` paints its text colour at 14 % alpha as its own background. */
const BADGE_TINT_ALPHA = 0.14;

const d = darkTheme.color;
const WHITE = d.textOnPrimary;

const SURFACES: ReadonlyArray<readonly [string, string]> = [
  ['background', d.background],
  ['surface', d.surface],
  ['surfaceAlt', d.surfaceAlt],
];

/**
 * Dark `TIER_TEXT` values (design.md rule 7): the pin tier colours used as UI
 * text, with amethyst and bronze lifted to read on the night surfaces.
 */
export const TIER_TEXT_DARK: Readonly<Record<keyof typeof TIER_COLOR, string>> = {
  ...TIER_COLOR,
  amethyst: '#c08ff5',
  bronze: '#e0965f',
};

function onSurfaces(label: string, fg: string, min: number): ContrastRequirement[] {
  return SURFACES.map(([name, bg]) => ({ label: `${label} on ${name}`, fg, bg, min }));
}

function badgeOnSurfaces(label: string, fg: string): ContrastRequirement[] {
  return SURFACES.map(([name, surface]) => ({
    label: `${label} badge text on its 14% tint over ${name}`,
    fg,
    bg: mixOver(fg, surface, BADGE_TINT_ALPHA),
    min: TEXT,
  }));
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

const TONAL_FAMILIES = Object.keys(DARK_TONAL) as TonalFamily[];

const selectedRowOverSurface = mixOver(d.primary, d.surface, BADGE_TINT_ALPHA);
const selectedRowOverSurfaceAlt = mixOver(d.primary, d.surfaceAlt, BADGE_TINT_ALPHA);

/** The shipped dark Switch colours (theme/switchColors.ts), on and off. */
const switchOn = themedSwitchProps(darkTheme, true);
const switchOff = themedSwitchProps(darkTheme, false);

const badgeTints = unique([
  ...Object.values(darkTheme.parkAccent),
  ...Object.values(darkTheme.categoryVisual).map((v) => v.tint),
  darkTheme.resortVisual.tint,
  d.primaryFg,
  d.primaryLight,
  d.accent,
]);

/**
 * Every dark text/surface, badge, tonal, fill and non-text pair the design
 * declares, with its floor. Property 9 asserts `contrastRatio(fg, bg) >= min`
 * for every entry.
 */
export const CONTRAST_REQUIREMENTS: readonly ContrastRequirement[] = [
  // Core text and hue tokens on every surface.
  ...onSurfaces('textPrimary', d.textPrimary, TEXT),
  ...onSurfaces('textSecondary', d.textSecondary, TEXT),
  ...onSurfaces('primaryFg', d.primaryFg, TEXT),
  ...onSurfaces('success', d.success, TEXT),
  ...onSurfaces('danger', d.danger, TEXT),
  ...onSurfaces('warning', d.warning, TEXT),
  ...onSurfaces('accent', d.accent, TEXT),
  ...onSurfaces('starRating', d.starRating, TEXT),
  ...onSurfaces('primaryLight (as text)', d.primaryLight, TEXT),

  // Text on fills.
  { label: 'textOnPrimary on primary', fg: d.textOnPrimary, bg: d.primary, min: TEXT },
  { label: 'white on primaryDark', fg: WHITE, bg: d.primaryDark, min: TEXT },
  { label: 'textOnAccent on accent', fg: d.textOnAccent, bg: d.accent, min: TEXT },
  { label: 'textOnAccent on accentDark', fg: d.textOnAccent, bg: d.accentDark, min: TEXT },
  { label: 'warningText on warningSurface', fg: d.warningText, bg: d.warningSurface, min: TEXT },
  { label: 'textPrimary on warningSurface', fg: d.textPrimary, bg: d.warningSurface, min: TEXT },
  { label: 'textSecondary on warningSurface', fg: d.textSecondary, bg: d.warningSurface, min: TEXT },

  // GradientHeader (headerVivid) title, subtitle veil and eyebrow.
  ...darkTheme.gradient.headerVivid.map((stop, i) => ({
    label: `header title white on headerVivid stop ${i}`,
    fg: WHITE,
    bg: stop,
    min: TEXT,
  })),
  ...darkTheme.gradient.headerVivid.slice(0, 2).map((stop, i) => ({
    label: `header subtitle rgba(255,255,255,0.82) on headerVivid stop ${i}`,
    fg: mixOver(WHITE, stop, 0.82),
    bg: stop,
    min: TEXT,
  })),
  ...darkTheme.gradient.headerVivid.slice(0, 2).map((stop, i) => ({
    label: `header eyebrow on headerVivid stop ${i}`,
    fg: HEADER.dark.eyebrowText,
    bg: stop,
    min: TEXT,
  })),

  // Selected row (primary at 14 % over a surface).
  { label: 'textSecondary on selected row (surface)', fg: d.textSecondary, bg: selectedRowOverSurface, min: TEXT },
  { label: 'primaryFg on selected row (surface)', fg: d.primaryFg, bg: selectedRowOverSurface, min: TEXT },
  { label: 'textPrimary on selected row (surface)', fg: d.textPrimary, bg: selectedRowOverSurface, min: TEXT },
  { label: 'primaryFg on selected row (surfaceAlt)', fg: d.primaryFg, bg: selectedRowOverSurfaceAlt, min: TEXT },

  // Danger SecondaryButton.
  { label: 'danger on DARK_TONAL.pink.tint', fg: d.danger, bg: DARK_TONAL.pink.tint, min: TEXT },

  // Tab bar and navigation header.
  { label: 'tab active tint on tab bar', fg: darkTheme.tabBar.activeTint, bg: darkTheme.tabBar.background, min: NON_TEXT },
  { label: 'tab inactive tint on tab bar', fg: darkTheme.tabBar.inactiveTint, bg: darkTheme.tabBar.background, min: NON_TEXT },
  { label: 'tab badge text on badge', fg: darkTheme.tabBar.badgeText, bg: darkTheme.tabBar.badgeBackground, min: TEXT },
  { label: 'nav header textPrimary on card', fg: d.textPrimary, bg: darkTheme.tabBar.background, min: TEXT },
  { label: 'nav header textSecondary on card', fg: d.textSecondary, bg: darkTheme.tabBar.background, min: TEXT },

  // Badge text on its own 14 % tint (park accents, category tints, primaryFg, primaryLight, accent).
  ...badgeTints.flatMap((fg) => badgeOnSurfaces(fg, fg)),

  // Park accents and category tints as text / icons.
  ...Object.entries(darkTheme.parkAccent).flatMap(([park, fg]) => onSurfaces(`parkAccent ${park}`, fg, TEXT)),
  ...Object.entries(darkTheme.categoryVisual).flatMap(([cat, v]) =>
    onSurfaces(`categoryVisual ${cat} tint`, v.tint, TEXT),
  ),
  ...onSurfaces('resortVisual tint', darkTheme.resortVisual.tint, TEXT),

  // Category fills behind a white glyph / text.
  ...Object.entries(darkTheme.categoryVisual).map(([cat, v]) => ({
    label: `white on categoryVisual ${cat} fill`,
    fg: WHITE,
    bg: v.fill,
    min: TEXT,
  })),
  { label: 'white on resortVisual fill', fg: WHITE, bg: darkTheme.resortVisual.fill, min: TEXT },

  // DARK_TONAL ramp.
  ...TONAL_FAMILIES.flatMap((family) => {
    const ramp = DARK_TONAL[family];
    return [
      ...onSurfaces(`DARK_TONAL.${family}.fg`, ramp.fg, TEXT),
      { label: `DARK_TONAL.${family}.fg on its tint`, fg: ramp.fg, bg: ramp.tint, min: TEXT },
      { label: `textPrimary on DARK_TONAL.${family}.tint`, fg: d.textPrimary, bg: ramp.tint, min: TEXT },
      { label: `textSecondary on DARK_TONAL.${family}.tint`, fg: d.textSecondary, bg: ramp.tint, min: TEXT },
      { label: `white on DARK_TONAL.${family}.fill`, fg: WHITE, bg: ramp.fill, min: TEXT },
    ];
  }),

  // Non-text graphics (WCAG 1.4.11, Requirement 7.5).
  ...darkTheme.gradient.chartBar.map((stop, i) => ({
    label: `RatingHistogram chartBar stop ${i} vs surface`,
    fg: stop,
    bg: d.surface,
    min: NON_TEXT,
  })),
  { label: 'ProgressBar fill primaryFg vs surfaceAlt track', fg: d.primaryFg, bg: d.surfaceAlt, min: NON_TEXT },
  { label: 'ProgressRing arc primaryLight vs surfaceAlt track', fg: d.primaryLight, bg: d.surfaceAlt, min: NON_TEXT },
  ...darkTheme.gradient.gold.map((stop, i) => ({
    label: `ProgressBar complete gold stop ${i} vs surfaceAlt track`,
    fg: stop,
    bg: d.surfaceAlt,
    min: NON_TEXT,
  })),
  ...darkTheme.gradient.header.flatMap((stop, i) => [
    { label: `PrimaryButton header stop ${i} vs surface`, fg: stop, bg: d.surface, min: NON_TEXT },
    { label: `PrimaryButton header stop ${i} vs background`, fg: stop, bg: d.background, min: NON_TEXT },
    { label: `PrimaryButton white label on header stop ${i}`, fg: WHITE, bg: stop, min: TEXT },
  ]),
  { label: 'Chip active fill primary vs surface', fg: d.primary, bg: d.surface, min: NON_TEXT },
  { label: 'Chip active fill primary vs background', fg: d.primary, bg: d.background, min: NON_TEXT },
  ...darkTheme.gradient.fab.flatMap((stop, i) => [
    { label: `MagicFab fab stop ${i} vs surface ring`, fg: stop, bg: d.surface, min: NON_TEXT },
    { label: `MagicFab white glyph on fab stop ${i}`, fg: WHITE, bg: stop, min: NON_TEXT },
  ]),

  // Rule 1a: the inverse toast stays `#1f1235` (light textPrimary) in both schemes.
  { label: 'white on inverse toast', fg: WHITE, bg: lightTheme.color.textPrimary, min: TEXT },
  { label: 'accent on inverse toast', fg: d.accent, bg: lightTheme.color.textPrimary, min: TEXT },
  { label: 'white on primary (active chip text)', fg: WHITE, bg: d.primary, min: TEXT },

  // Pin tier text (rule 7): on surface, and as badge text on its tint.
  ...Object.entries(TIER_TEXT_DARK).flatMap(([tier, fg]) => [
    { label: `TIER_TEXT ${tier} on surface`, fg, bg: d.surface, min: TEXT },
    ...badgeOnSurfaces(`TIER_TEXT ${tier}`, fg),
  ]),

  // Dark-mode polish pass (Requirement 9.12 / 9.15): selected states and Switches.
  { label: 'ParkWaitPulse active ring vs surface', fg: PARK_WAIT_PULSE.dark.activeBorder, bg: d.surface, min: NON_TEXT },
  { label: 'ParkWaitPulse active ring vs inactive ring', fg: PARK_WAIT_PULSE.dark.activeBorder, bg: PARK_WAIT_PULSE.dark.pillBorder, min: NON_TEXT },
  { label: 'ShareComposer unselected icon vs surface', fg: SHARE_COMPOSER.dark.unselectedIcon, bg: d.surface, min: NON_TEXT },
  { label: 'Expenses active tab label on active pill', fg: d.primaryFg, bg: EXPENSES.dark.tabActiveBg, min: TEXT },
  { label: 'Expenses idle tab label on track', fg: EXPENSES.dark.tabIdleText, bg: EXPENSES.dark.tabTrack, min: TEXT },
  { label: 'Expenses active tab badge text on badge', fg: d.primaryFg, bg: EXPENSES.dark.tabBadgeActiveBg, min: TEXT },
  { label: 'Expenses idle tab badge text on badge', fg: EXPENSES.dark.tabIdleText, bg: EXPENSES.dark.tabBadgeIdleBg, min: TEXT },
  { label: 'Balances active toggle label on active pill', fg: BALANCES.dark.inkText, bg: BALANCES.dark.toggleActiveBg, min: TEXT },
  { label: 'Balances idle toggle label on track', fg: BALANCES.dark.slateText, bg: BALANCES.dark.toggleTrack, min: TEXT },
  { label: 'Expense tier pill active border vs pill', fg: FORM.dark.tierPillActiveBorder, bg: FORM.dark.tierPillActiveBg, min: NON_TEXT },
  { label: 'Expense tier pill active border vs inactive border', fg: FORM.dark.tierPillActiveBorder, bg: FORM.dark.violetHairline, min: NON_TEXT },
  { label: 'Showtime active pill border vs section', fg: SCHEDULE.dark.showtimeActiveBorder, bg: d.surfaceAlt, min: NON_TEXT },
  { label: 'Switch on thumb on on track', fg: switchOn.thumbColor!, bg: switchOn.trackColor!.true!, min: NON_TEXT },
  { label: 'Switch on track vs surface', fg: switchOn.trackColor!.true!, bg: d.surface, min: NON_TEXT },
  { label: 'Switch off thumb vs surface', fg: switchOff.thumbColor!, bg: d.surface, min: NON_TEXT },
  { label: 'Switch off thumb vs off track', fg: switchOff.thumbColor!, bg: switchOff.trackColor!.false!, min: NON_TEXT },

  // Dark-mode visual-verify pass (Requirement 9.12): emulator-found selected states.
  { label: 'Expense split-mode selected label on selected chip', fg: d.primaryFg, bg: FORM.dark.modeChipSelectedBg, min: TEXT },
  { label: 'Expense split-mode idle label on track', fg: d.textSecondary, bg: FORM.dark.lavenderWellAlt, min: TEXT },
  { label: 'Expense matrix stepper active border vs pill', fg: FORM.dark.matrixPillActiveBorder, bg: d.surface, min: NON_TEXT },
  { label: 'Expense matrix stepper active border vs inactive border', fg: FORM.dark.matrixPillActiveBorder, bg: FORM.dark.violetHairline, min: NON_TEXT },
  { label: 'LensSwitcher active label on active segment', fg: d.primaryFg, bg: LENS.dark.activeBg, min: TEXT },
  { label: 'LensSwitcher idle label on track', fg: LENS.dark.inactiveText, bg: LENS.dark.trackBg, min: TEXT },
  { label: 'Vault segment active label on active segment', fg: d.primaryFg, bg: COLLECTION.dark.segActiveBg, min: TEXT },
  { label: 'Vault segment idle label on track', fg: COLLECTION.dark.segText, bg: COLLECTION.dark.segTrackBg, min: TEXT },
  // Shared by the Coverage / friend Coverage lenses, Crowd Calendar park filter, park category
  // tabs, stats sort toggles and the schedule timing-mode segments (active fill `borderStrong`).
  { label: 'Segmented control active label on active segment', fg: d.primaryFg, bg: d.borderStrong, min: TEXT },
  { label: 'Segmented control idle label on surfaceAlt track', fg: d.textSecondary, bg: d.surfaceAlt, min: TEXT },
];
