# Design — Dark-Mode Retrofit ("Twilight")

## Overview

Picking **Dark** in the Appearance control today only repaints three chrome surfaces (React
Navigation theme, status bar, root safe-area background). Every screen still renders the light
palette, because ~139 of the 244 non-test files under `apps/mobile/src` import the frozen
`theme` object from `theme/theme.ts` and build their styles once at module load
(`StyleSheet.create({... theme.color.x ...})`). About 1,678 more hardcoded hex literals (313
distinct values) and 125 chromatic `rgba(...)` literals sit in 87 files. Styles built at module
scope can't change at runtime, so dark mode needs an architecture change first. Then every
consumer has to be converted.

This design does both. `theme.ts` gets a typed light theme and a typed dark theme with
identical keys. A `useAppTheme()` hook returns the active one. A `makeStyles((t) => ...)`
helper builds styles lazily, once per scheme, at render time. The shared kit and navigation
chrome convert first. Then seven parallel batches with disjoint file sets convert every
screen, modal, sheet and component. A structural regression guard
(`themeRetrofit.guard.test.ts`, in the style of the API's `retirement.smoke.test.ts`) fails
the build if a file reads static colour tokens or carries raw colour literals outside an exact
allowlist. Light mode must stay pixel-identical. Every light token keeps today's value, every
converted literal keeps its original light value, and light-only layout additions (borders,
default text colour) are applied in dark only.

**Technology stack (locked):** TypeScript (`typescript ~6.0.3`), React Native 0.85.3, Expo SDK
56, `@react-navigation/native@6.1.18`, `@react-navigation/bottom-tabs@6.6.1`, Zustand 4
(existing `themeStore`), `expo-linear-gradient`, `react-native-svg`,
`react-native-calendars@1.1314.0`, `@react-native-async-storage/async-storage@2.2.0` (already
pinned). Tests: Jest (`jest-expo`) + `@testing-library/react-native` + `fast-check` in
`apps/mobile`. No new dependencies. No `apps/api` or `packages/shared` changes.

## Architecture

```
themeStore (Zustand, existing) ──┐
useColorScheme() (RN) ───────────┴─► useActiveTheme(): 'light'|'dark'   (existing, unchanged)
                                            │
theme/theme.ts (pure, no React)             ▼
  lightTheme: AppTheme ─┐        theme/useAppTheme.ts
  darkTheme:  AppTheme ─┴─ themes ─► useAppTheme(): AppTheme  = themes[useActiveTheme()]
  definePalette(), DARK_TONAL,       usePalette(p)             = p[useActiveTheme()]
  withAlpha(), categoryMeta                 │
  static: spacing/radius/layout/typography  ▼
                                    theme/makeStyles.ts
                                      makeStyles((t) => styles) → useStyles()
                                      (StyleSheet.create once per scheme, lazily)
                                            │
            ┌───────────────────────────────┼─────────────────────────────┐
            ▼                               ▼                             ▼
   theme/components.tsx, charts.tsx   screens/**, components/**     App.tsx → AppearanceChrome
   (kit; converted first)             (7 parallel batches)          (nav theme from tokens,
                                      + co-located *.palette.ts      DARK_ROOT_BACKGROUND)
```

**Module-graph rule (no cycles):** `theme.ts` imports nothing at runtime from
`appearance.ts`, `useActiveTheme.ts`, or the store. It defines its own
`type ColorScheme = 'light' | 'dark'`, which is structurally identical to `ActiveTheme`.
`appearance.ts` already imports `theme.ts` (for `LIGHT_ROOT_BACKGROUND`). If `theme.ts`
imported the hook, the result would be the runtime cycle
`theme → useActiveTheme → themeStore → appearanceStorage → appearance → theme`. So the hooks
live in their own modules: `useAppTheme.ts` and `makeStyles.ts`.

**Hook-per-component vs. context provider (decision).** There are two ways to wire this:

- **(A)** `useAppTheme()` calls `useActiveTheme()` directly in every consumer.
- **(B)** An `AppThemeProvider` at the App root puts the theme into React context, and
  `useAppTheme()` reads that context.

(B) would mean one store subscription instead of hundreds, and isolated test defaults. But the
task fixed "a hook returning the active full theme from `useActiveTheme()`". With (A), dark
mode can't be silently disabled by a missing provider. Zustand selectors and
`useColorScheme`'s `useSyncExternalStore` are cheap, and a scheme switch re-renders every
themed component under either option. **Chosen: (A).** The cost is that every component
module graph now reaches `themeStore → appearanceStorage → AsyncStorage`. Jest handles that
with a global automatic mock (see Testing Strategy).

**Static exports during migration.** While unconverted files exist, `theme.ts` keeps the legacy
named exports (`color`, `gradient`, `shadow`, `parkAccent`, `categoryVisual`, `resortVisual`)
and the aggregated `theme` object, as light-value aliases. The integration task (spec 10.1)
removes them. In the end state the static `theme` object has exactly
`{ spacing, radius, layout, typography }`. TypeScript itself then rejects `theme.color.x`
anywhere, and the guard rejects colour literals and imports of the per-scheme theme objects.

**Execution model (decision).** All batches run in the **single main working tree**. They
don't use git worktrees and they don't commit. Worktrees would need W1's work committed, the
tree already carries unrelated uncommitted docs-audit edits, and this repo's rules forbid
commits without explicit user approval. Isolation comes from **disjoint file ownership** plus
a "no exported-signature changes" rule. Batches never edit a shared file (theme modules, the
guard, `jest.config.js`, `__mocks__`, steering). A batch that needs a kit change stops and
reports it.

## Components and Interfaces

### `apps/mobile/src/theme/theme.ts` (modified — pure, no React hooks)

```typescript
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import type { ExperienceCategory, Park } from '@dwt/shared';

export type ColorScheme = 'light' | 'dark';

// Light values are TODAY'S values verbatim, plus the one new key `primaryFg`.
export const lightColor = {
  primary: '#5b2a86', primaryDark: '#3d1c5c', primaryLight: '#7e57c2',
  primaryFg: '#5b2a86',            // NEW — primary-hued text/icons/links on surfaces
  accent: '#f6c343', accentDark: '#d4a017',
  background: '#f5f2fb', surface: '#ffffff', surfaceAlt: '#efe9f7',
  textPrimary: '#1f1235', textSecondary: '#6b6480', textOnPrimary: '#ffffff', textOnAccent: '#3d1c5c',
  success: '#2e9e6b', danger: '#d6336c', warning: '#e8a317', warningSurface: '#fff4d6', warningText: '#8a5a00',
  border: '#e2d9f0', borderStrong: '#cdbce6',
  star: '#ffffff', starRating: '#f59e0b',
} as const;

export type ColorToken = keyof typeof lightColor;
export type ColorTokens = { readonly [K in ColorToken]: string };

// `satisfies` makes a missing key AND an extra key a compile error.
export const darkColor = { /* Configuration & Constants table */ } as const satisfies ColorTokens;

export interface GradientTokens {
  readonly header: readonly [string, string];               // PrimaryButton only
  readonly headerVivid: readonly [string, string, string];  // GradientHeader, Home/LiveWaits heroes
  readonly gold: readonly [string, string];
  readonly fab: readonly [string, string, string];          // NEW (iteration 3) — MagicFab disc; light = today's headerVivid
  readonly chartBar: readonly [string, string, string];     // NEW (iteration 3) — RatingHistogram bars; light = today's headerVivid
}
export interface ShadowStyle {
  readonly shadowColor: string;
  readonly shadowOffset: { readonly width: number; readonly height: number };
  readonly shadowOpacity: number;
  readonly shadowRadius: number;
  readonly elevation: number;               // identical in both schemes (Android z-order)
}
export interface ShadowTokens { readonly card: ShadowStyle; readonly floating: ShadowStyle }
export interface CategoryVisual {
  readonly glyph: string;
  readonly label: string;
  /** Foreground role: text, icon, border, Badge colour, chip tint. */
  readonly tint: string;
  /** NEW (iteration 3). Solid fill behind a white glyph/text (placeholder tiles). Light: === tint. */
  readonly fill: string;
}
export interface TabBarTokens {
  readonly background: string; readonly border: string;
  readonly activeTint: string; readonly inactiveTint: string;
  readonly badgeBackground: string; readonly badgeText: string;
}

export interface AppTheme {
  readonly scheme: ColorScheme;
  readonly color: ColorTokens;
  readonly gradient: GradientTokens;
  readonly shadow: ShadowTokens;
  /** Light: `{}`. Dark: hairline `border` outline — spread into any card-like surface. */
  readonly outline: { readonly card: ViewStyle };
  /** Light: `{}` (keeps RN's default text colour exactly). Dark: `{ color: textPrimary }`. */
  readonly textDefault: TextStyle;
  readonly parkAccent: Readonly<Record<Park, string>>;
  readonly categoryVisual: Readonly<Record<ExperienceCategory, CategoryVisual>>;
  readonly resortVisual: CategoryVisual;
  readonly tabBar: TabBarTokens;
  readonly spacing: typeof spacing;          // same static object in both themes
  readonly radius: typeof radius;
  readonly layout: typeof layout;
  readonly typography: typeof typography;
}

/** Colour-free category metadata — safe to import statically anywhere. */
export const categoryMeta: Readonly<Record<ExperienceCategory, { readonly glyph: string; readonly label: string }>>;
const CATEGORY_TINT_LIGHT: Readonly<Record<ExperienceCategory, string>>; // today's tints
const CATEGORY_TINT_DARK: Readonly<Record<ExperienceCategory, string>>;  // Configuration & Constants
const CATEGORY_FILL_DARK: Readonly<Record<ExperienceCategory, string>>;  // Configuration & Constants (iteration 3)
// Light fill map is CATEGORY_TINT_LIGHT itself (fill === tint in light, byte-identical).

export const lightTheme: AppTheme;  // scheme 'light'
export const darkTheme: AppTheme;   // scheme 'dark'
export const themes: Readonly<Record<ColorScheme, AppTheme>> = { light: lightTheme, dark: darkTheme };

/** Fixed dark tonal ramp for converting non-token literals (see "Literal conversion rules"). */
export const DARK_TONAL: Readonly<Record<TonalFamily, { fg: string; tint: string; border: string; fill: string }>>;
export type TonalFamily = 'violet' | 'green' | 'amber' | 'orange' | 'red' | 'pink' | 'blue' | 'sky' | 'teal';

/**
 * Colour → `rgba(r, g, b, alpha)`. Replaces components.tsx's private hexToRgba. Accepts
 * `#rgb`, `#rrggbb`, `#rrggbbaa` (its own alpha is replaced), `rgb(r, g, b)` and
 * `rgba(r, g, b, a)` (alpha replaced). Throws on anything else.
 * Output format is pinned (iteration 3): exactly `rgba(${r}, ${g}, ${b}, ${alpha})` —
 * comma-space separators, decimal channels, `alpha` interpolated unformatted — the same
 * string hexToRgba produces today (e.g. `rgba(91, 42, 134, 0.14)`), so Badge light is
 * byte-identical.
 */
export function withAlpha(color: string, alpha: number): string;

/** Co-located light/dark literal pairs. Dark must have exactly the light keys. */
export interface ThemedPalette<K extends string> {
  readonly light: Readonly<Record<K, string>>;
  readonly dark: Readonly<Record<K, string>>;
}
export function definePalette<const L extends Readonly<Record<string, string>>>(p: {
  readonly light: L;
  readonly dark: { readonly [K in keyof L]: string };
}): ThemedPalette<Extract<keyof L, string>>;

// Static, colour-free tokens (unchanged).
export const spacing, radius, layout, typography;

// LEGACY (removed by spec task 10.1): color, gradient, shadow, parkAccent, categoryVisual,
// resortVisual, and `theme = { color, gradient, ..., resortVisual }` — all light-value aliases.
// Task 10.1 also removes `export type Theme = typeof theme` (no consumers today); use `AppTheme`.
// END STATE: export const theme = { spacing, radius, layout, typography } as const;
```

Every `CategoryVisual.label`/`.glyph` comes from `categoryMeta`, so the two themes differ only
in `tint` and `fill`. In light, `fill === tint` for every category and for `resortVisual`. `withAlpha` accepts every format any token or palette value can take (3/6/8-digit
hex, `rgb()`, `rgba()`), so `Badge` (which accepts any `color` string and calls `withAlpha`
for its 14 % tint) can't crash on an `rgba(...)` or 8-digit palette value. On anything else it
throws `Error('withAlpha: unsupported colour <value>')`. That's a programming error, and
Property 14 makes sure it never fires: it calls `withAlpha(v, 0.14)` on every token value and
every palette value and asserts no throw.

### `apps/mobile/src/theme/useAppTheme.ts` (new)

```typescript
import { useActiveTheme } from './useActiveTheme';
import { themes, type AppTheme, type ThemedPalette } from './theme';

export function useAppTheme(): AppTheme {
  return themes[useActiveTheme()];
}
export function usePalette<K extends string>(palette: ThemedPalette<K>): Readonly<Record<K, string>> {
  return palette[useActiveTheme()];
}
```

### `apps/mobile/src/theme/makeStyles.ts` (new)

```typescript
import { StyleSheet } from 'react-native';
import { useAppTheme } from './useAppTheme';
import type { AppTheme, ColorScheme } from './theme';

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (t: AppTheme) => T & StyleSheet.NamedStyles<any>,
): () => T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  return function useStyles(): T {
    const t = useAppTheme();                       // unconditional hook call
    let styles = cache[t.scheme];
    if (styles === undefined) {
      styles = StyleSheet.create(factory(t));      // runs lazily, never at import
      cache[t.scheme] = styles;
    }
    return styles;
  };
}
```

`makeStyles` guarantees the following:

- The factory runs at most once per scheme per module.
- The factory never runs at import, so no module-scope colour read happens.
- The same object comes back for the same scheme, so `React.memo` children and style
  equality checks stay stable.

**Consumer pattern** (every batch uses exactly this):

```typescript
const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.color.background },
  title: { ...t.typography.title, color: t.color.textPrimary },
  link: { color: t.color.primaryFg },                       // primary as text → primaryFg
  cta: { backgroundColor: t.color.primary },                // primary as fill → primary
  card: { backgroundColor: t.color.surface, ...t.shadow.card, ...t.outline.card },
  plainText: { ...t.textDefault },                          // Text that had no colour before
  pill: { backgroundColor: P[t.scheme].lodgingBg },          // co-located palette in a factory
}));

export default function MyScreen(): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();                                  // for inline colour props
  return <Ionicons name="star" color={t.color.accent} />;
}
```

Batches follow these rules when converting a file:

- Every function component that touches `styles` calls `useStyles()` itself.
- Module-scope helpers that took `styles` (`renderItem` functions, module-level style arrays)
  move inside the component or take `styles`/`t` as a parameter.
- Pure `.ts` view-model modules that embed colours (e.g. `statsView.ts`) take
  `t: Pick<AppTheme, 'color' | 'parkAccent' | 'categoryVisual'>` as a parameter. Their callers
  pass `useAppTheme()`, and their unit tests pass `lightTheme`.
- A palette is read inside a factory as `P[t.scheme].key`, or in a render as
  `usePalette(P).key`. *(iteration 4)* It may also be read through one `const` alias,
  declared as `const pal = usePalette(P);` in a render or `const pal = P[t.scheme];` in a
  factory block body, and then read as `pal.key` or `pal[k]`. A palette record is never
  destructured. These are the only forms the light-colour multiset audit sees.

**Memoized and virtualized consumers (binding).** Today `styles` and `theme` are module
constants, so existing `useMemo`/`useCallback` dependency arrays legitimately omit them. After
conversion, `styles` and `t` change identity on a scheme switch (one object per scheme), so any
memo that omits them keeps stale light colours until something else invalidates it. That's a
half-repainted screen, which Requirement 8.2 forbids. The tree has about 46 memo/callback blocks
that read `styles.`/`theme.color` nearby, 37 `FlatList`/`SectionList` usages and 12
`React.memo` components. Every batch applies these rules to each one:

- **`useMemo`/`useCallback`/`useEffect`/`useLayoutEffect`** whose body reads `styles`, `t`, or a
  `usePalette(...)` result lists that value (`styles`, `t`, or the palette record) in its
  dependency array. This includes `navigation.setOptions({ headerStyle: … })` effects.
- **`useRef`** never holds a colour or a style object. Compute colours during render. An
  `Animated` interpolation whose `outputRange` holds colours is built in a `useMemo` with `t` in
  its deps.
- **`FlatList`/`SectionList`/`DraggableFlatList`** whose `renderItem`/`renderSectionHeader`/
  `ListHeaderComponent` reads `styles` or `t` from the parent's closure gets
  `extraData={t.scheme}`. If it already has `extraData={x}`, that becomes
  `extraData={[x, t.scheme]}`, or `x` is put into a `useMemo` that also depends on `t.scheme`.
  Rows rendered by their own component that calls `useStyles()`/`useAppTheme()` need nothing:
  the hook subscribes the row itself.
- **`React.memo` components** that receive colours or styles only through props need nothing
  (the prop identity changes). Ones that read `styles` from a module-scope closure are converted
  to call `useStyles()` themselves.

Property 20 pins these patterns on a probe component. Each batch also pins them on one real
list screen (per-batch test (d), Testing Strategy).

`LIGHT_ROOT_BACKGROUND = lightTheme.color.background` (`#f5f2fb`, unchanged) and
`DARK_ROOT_BACKGROUND = darkTheme.color.background` (`#120a1f`, replacing the `#121212`
placeholder).

### `apps/mobile/src/theme/AppearanceChrome.ts` (modified)

```typescript
export function buildNavigationTheme(t: AppTheme): Theme {
  if (t.scheme === 'light') return DefaultTheme;   // identity — light nav chrome unchanged
  return {
    dark: true,
    colors: {
      primary: t.color.primaryFg,          // nav uses `primary` as a tint on chrome → text-safe value
      background: t.color.background,      // #120a1f — every card/modal screen wrapper
      card: t.tabBar.background,           // #170e27 — tab bar + native-stack header surface
      text: t.color.textPrimary,           // #f3eefc
      border: t.tabBar.border,             // #33264d — tab bar top hairline + header border
      notification: t.color.danger,        // #ff6b9a
    },
  };
}
// deriveAppearanceChrome(active) → { navigationTheme: buildNavigationTheme(themes[active]),
//   statusBarStyle: resolveStatusBarStyle(active), rootBackground: themes[active].color.background }
```

The dark navigation theme is a module-level constant, built once, so its identity stays stable
across renders. `@react-navigation/bottom-tabs@6.6.1`'s `BottomTabBar` paints its background
from `colors.card` and its top border from `colors.border`. That's confirmed in
`node_modules/@react-navigation/bottom-tabs/src/views/BottomTabBar.tsx` lines 262–263. So the
tab-bar surface follows the theme without a `tabBarStyle` override, and light stays the exact
`DefaultTheme` values (`rgb(255, 255, 255)` / `rgb(216, 216, 216)`).

### `apps/mobile/src/navigation/RootNavigator.tsx` (modified)

`MainTabsNavigator` calls `const t = useAppTheme()` and sets these options:

- `tabBarActiveTintColor: t.tabBar.activeTint`
- `tabBarInactiveTintColor: t.tabBar.inactiveTint`
- `tabBarBadgeStyle: { backgroundColor: t.tabBar.badgeBackground, color: t.tabBar.badgeText, fontSize: 10, fontWeight: '700' }`

It sets no `tabBarStyle`. Light values come out as today's `#003a9b` / `#6b7280` / `#d97706` /
`#ffffff`.

### `apps/mobile/src/screens/quickAction/MagicFab.tsx` (modified)

The FAB gradient uses `t.gradient.fab` (iteration 3; light is today's `headerVivid` values
byte-for-byte, dark `['#9d7ae0','#7e57c2','#7650b9']` so the disc stays ≥ 3:1 against its
`surface` ring — the old dark `headerVivid` end `#1a0d33` was 1.04:1 and vanished into the
ring), and the glyph uses `t.color.textOnPrimary` instead of `'#ffffff'`. The ring is `t.color.surface` + `...t.shadow.card` + `...t.outline.card`.
The sheet uses the background, border and text tokens. The scrim keeps `rgba(0, 0, 0, 0.4)`.

### Shared kit — `theme/components.tsx`, `theme/charts.tsx` (modified)

All styles move to `makeStyles`, and inline colour reads go through `useAppTheme()`. The
token mapping is fixed:

| Primitive | Element | Token (light value unchanged) |
| --- | --- | --- |
| `ScreenContainer` | background | `color.background` |
| `GradientHeader` | default colours | `gradient.headerVivid`. Sparkles/subtitle/back-pill keep neutral `rgba(255,255,255,…)`. Eyebrow text `#ffd54f` → `components.palette.ts` `HEADER.eyebrowText` (mode-invariant, light = dark = `#ffd54f`; 9.38:1 on dark `#3b1d6e`). |
| `Card` | surface | `color.surface` + `shadow.card` + `outline.card` |
| `PrimaryButton` | gradient / label / spinner | `gradient.header` (dark value changed in iteration 3 to `['#7e57c2','#7650b9']`) / `color.textOnPrimary` |
| `SecondaryButton` | fill / border / label / icon | `surfaceAlt` / `borderStrong` / `primaryFg` (was `primary`) / `primaryFg`. Danger tone: `components.palette.ts` `DANGER_BUTTON` `{bg: '#fdebf2'→DARK_TONAL.pink.tint, border: '#f3b6cf'→DARK_TONAL.pink.border}`, text `color.danger` |
| `Badge` | default colour | `color.primaryFg` (was `primary`; same light value) |
| `Chip` | idle bg / border / text; active bg / border / text | `surfaceAlt` / `border` / `textSecondary`; `primary` / `primary` / `textOnPrimary` |
| `SectionLabel` | text | `textPrimary` |
| `EmptyState` | circle / icon / title / body | `surfaceAlt` / `primaryFg` / `textPrimary` / `textSecondary` |
| `ProgressRing` | track / default arc / center label / sub | `surfaceAlt` / `[primaryLight, primaryFg]` (iteration 3; was `[primaryLight, primary]`, same light `[#7e57c2, #5b2a86]`) / `primaryFg` / `textSecondary` |
| `ProgressBar` | track / default fill / complete | `surfaceAlt` / `primaryFg` (iteration 3; was `primary`, same light `#5b2a86`) / `gradient.gold` |
| `RatingHistogram` | bars / hot / labels | `gradient.chartBar` (iteration 3; was `headerVivid`, same light values) / `gradient.gold` / `textSecondary` |

**Non-text graphics rule (iteration 3, Requirement 7.5).** A data mark (progress fill, ring
arc, chart bar) is a primary-hued foreground mark on a surface, so it uses `primaryFg`, not
`primary`, exactly like text (Requirement 9.3 amendment). No new colour token is added for
it: `primaryFg`'s light value equals `primary`'s, so light is unchanged, and dark `#c4a3ff` is
7.41:1 on the `surfaceAlt` track.
| `RatingDial` | number / out-of / stars | `primaryFg` / `textSecondary` / `accent` |
| `CompleteBadge` | gradient / text | `gradient.gold` / `textOnAccent` |

### Third-party and native props

- **`react-native-calendars`** (`DatePickerField`, `CrowdCalendarScreen`). The `theme` prop is
  built from `useAppTheme()`, and the component also gets **`key={t.scheme}`**.
  `Calendar` and `BasicDay` capture their styles once via
  `useRef(styleConstructor(theme))` (`node_modules/react-native-calendars/src/calendar/index.js`
  line 26 and `day/basic/index.js` line 9), so a theme prop change doesn't restyle them without
  a remount. Mapping: `calendarBackground: surface`, `monthTextColor`/`dayTextColor:
  textPrimary`, `textSectionTitleColor: textSecondary`, `textDisabledColor: border` (light) /
  `borderStrong` (dark), `todayTextColor`/`arrowColor: primaryFg`,
  `selectedDayBackgroundColor: primary`, `selectedDayTextColor: textOnPrimary`. The
  `textDisabledColor` difference is a `DatePickerField.palette.ts` pair, light `#e2d9f0`, dark
  `#4a3a6b`.
- **`TextInput`**: style gets `...t.textDefault` under the default-text rule below,
  `placeholderTextColor={t.color.textSecondary}`, and `keyboardAppearance={t.scheme}` (iOS;
  Android ignores it).
- **`ActivityIndicator` / `RefreshControl`**: tint `t.color.primaryFg`. On a filled button it's
  `textOnPrimary`.
- **`Switch`**: track and thumb literals become a co-located palette pair.
- OS-rendered UI (permission dialogs, image picker, the Android system navigation bar) stays
  out of scope.

### Default-text rule (`t.textDefault`, binding)

React Native's default text colour is black, which is unreadable on a dark surface. But
blindly adding a colour breaks two common cases: a nested `<Text>` inherits its parent
`Text`'s colour (gold, white, primary), and text on a mode-invariant background is already
correct in both schemes. So a batch spreads `...t.textDefault` into a `Text` or `TextInput`
style **only when all three hold**:

1. **No colour is set.** No entry of the element's style array, including conditional
   entries, sets `color`.
2. **It's not nested in a `Text`.** It has no `Text` ancestor in the same component's JSX, and
   it isn't the `children` of a component whose root is a `Text`.
3. **Its effective background is themed.** The nearest ancestor that paints a
   `backgroundColor` is a themed surface: `background`, `surface`, `surfaceAlt`, a
   `DARK_TONAL` tint, a `withAlpha` of a token, or no painted ancestor in the component (the
   screen background).

If the effective background is mode-invariant (role G, H or V, a gradient, an image, or art),
the element is left unchanged. That background is identical in both schemes, so RN's default
stays exactly as correct, or as incorrect, as it is in light today. Light parity holds either
way, because `lightTheme.textDefault` is `{}`.

### Literal conversion rules (deterministic — every batch applies these, no free choice)

Rules are applied in order. The first rule that matches a literal decides it.

0. **`shadowColor` (any non-black literal).** This rule comes first, whatever the hex is. The
   tree has about 60 of these (`#5b2a86` ×28, `#3d1c5c` ×5, `#7c3aed` ×5, `#1f1235` ×3,
   `#d4a017` ×3, `#22c55e` ×3 and others).
   - `shadowColor: '#3d1c5c'` → spread or read `t.shadow.card.shadowColor` (light `#3d1c5c`,
     dark `#000000`).
   - Any other non-black hex `shadowColor` → a palette pair
     `{ light: '<original>', dark: '#000000' }`.
   - A chromatic `rgba(r,g,b,a)` `shadowColor` → a palette pair
     `{ light: '<original>', dark: 'rgba(0, 0, 0, a)' }`, with the same `a`.
   - `shadowOpacity`, `shadowRadius`, `shadowOffset` and `elevation` stay as they are.
1. **Exact token match (light value).** Compare case-insensitively, with `#fff` ≡ `#ffffff`.
   If the literal equals a light token value, it becomes that token, picked by **role**:
   - `#ffffff`:
     - a background → `surface`;
     - text or an icon on a fill or gradient → `textOnPrimary`;
     - a `star` decoration stays `star`;
     - a `borderColor`, ring or cut-out on a themed surface → `surface` (the ring has to match
       the surface the element sits on);
     - a `borderColor` or ring on a gradient, image or H-role surface → `textOnPrimary`
       (white in both schemes).
   - `#5b2a86`: a fill is `primary`; text, icon or border on a surface is `primaryFg`.
   - `#3d1c5c`: a fill or gradient stop is `primaryDark`; text on gold is `textOnAccent`;
     text, icon or border on a surface is `primaryFg` (`primaryDark` `#2a1450` would be
     invisible on `#1e1430`).
   - `#7e57c2`: text or an icon on a surface is `primaryLight` (6.80:1 in dark, iteration-3
     value `#b28dff`). A fill behind white text becomes a palette pair
     `{ light: '#7e57c2', dark: DARK_TONAL.violet.fill }`, because white on dark
     `primaryLight` is only 2.58:1.
   - `#1f1235`, `#6b6480` or any other token value used in a role this list doesn't name (for
     example `#1f1235` as a hero background) is **not** mapped to its token. It goes to rule 3
     (palette pair; family and role from the tables), so no batch guesses a token.
   - Each of the remaining tokens maps to itself **in its natural role** only:
     - text tokens, as text or icon colour: `#1f1235` → `textPrimary`, `#6b6480` →
       `textSecondary`, `#8a5a00` → `warningText`;
     - border tokens, as border, divider or track: `#e2d9f0` → `border`, `#cdbce6` →
       `borderStrong`;
     - surface tokens, as background: `#efe9f7` → `surfaceAlt`, `#f5f2fb` → `background`,
       `#fff4d6` → `warningSurface`;
     - hue tokens, as text, icon, fill or border: `#f6c343` → `accent`, `#d4a017` →
       `accentDark`, `#2e9e6b` → `success`, `#d6336c` → `danger`, `#e8a317` → `warning`,
       `#f59e0b` → `starRating`. A status hue that's a solid fill behind white text goes to
       rule 4 instead.
     Any other role falls through to rule 3, per the last bullet above.
   - A park hue (`#7e57c2`, `#2f80ed`, `#e8505b`, `#3fa34d`, `#17a2b8`, `#4dabf7`, `#f6a609`)
     used for a **park** becomes `t.parkAccent[park]`. Used for a **category** (split in
     iteration 3, Requirement 9.11):
     - as text, an icon, a border, a chip tint or a `Badge` colour → `t.categoryVisual[cat].tint`;
     - as a solid fill behind white text or a white glyph (the placeholder tiles in
       `ExperienceDetailScreen.tsx:1177`, `DestinationScreen.tsx:1013`,
       `ExploreHubScreen.tsx:900`, `ParkDestinationScreen.tsx:1445`) →
       `t.categoryVisual[cat].fill` (and `t.resortVisual.fill`).
     This bullet takes precedence over the `#7e57c2` bullet. A park hue used as a solid fill
     behind white is not in the tree today; if one appears it goes to rule 3 role F.

1a. **Token reads are converted by the same rules as literals (iteration 3, Requirement
    9.10).** A `theme.color.X` read becomes `t.color.X` **only when X is used in its natural
    role** (rule 1's role list). Otherwise it is converted exactly as if X's light value were
    written as a literal in that role. Concretely:
    - `surface`, `star` or `textOnPrimary` used as text or an icon on a fill or gradient →
      `t.color.textOnPrimary` (e.g. `TripReservationsScreen.tsx:1062,1079`
      `kindChipTextActive`/`dateChipTextActive` `color: theme.color.surface` on a `primary`
      fill: straight substitution would be `#1e1430` on `#7e57c2` = 3.36:1; converted it is
      white on `#7e57c2` = 5.21:1).
    - A text token used as a background → rule 3. `#1f1235` has L < 0.03, so it is H-role and
      mode-invariant: an inverse toast stays `#1f1235` with `textOnPrimary`/`accent` text in
      both schemes (`foodLists/MarkGottenUndoToast.tsx:82`: straight substitution would be
      white on `#f3eefc` 1.14:1 and gold on it 1.44:1; converted it is 17.56:1 / 10.71:1). The
      toast is a palette pair `{ light: '#1f1235', dark: '#1f1235' }` and also spreads
      `...t.outline.card` so its edge reads against the dark screen (light `{ borderWidth: 0 }`, visually unchanged).
    - `primary` or `primaryDark` used as text, an icon, a border or a data mark on a surface →
      `t.color.primaryFg` (Requirement 9.3).
    - `primaryLight` used as a fill behind white text → the rule-1 palette pair
      `{ light: '#7e57c2', dark: DARK_TONAL.violet.fill }`.
    - Any other out-of-role read → rule 3 with the token's light value as the literal.
    B3's report names the `MarkGottenUndoToast` site, and B5's report names the
    `TripReservationsScreen` sites. Each gets a dark-case assertion in its owned test
    (`foodLists/__tests__/MarkGottenUndoToast.test.tsx` and
    `trips/__tests__/TripReservationsScreen.test.tsx`; Property 22).
2. **Chromatic `rgba(r,g,b,a)` of a token.** It becomes `withAlpha(t.color.<token>, a)`, e.g.
   `rgba(91,42,134,a)` → `withAlpha(t.color.primary, a)` and `rgba(246,195,67,a)` →
   `withAlpha(t.color.accent, a)`. One exception: `rgba(31,18,53,a)` (textPrimary) used as a
   **scrim or overlay** becomes a palette pair `{light: original, dark: 'rgba(0, 0, 0, a)'}`.
2a. **Template-literal alpha suffix (iteration 3).** `` `${theme.color.X}NN` `` becomes
    `` `${t.color.X}NN` `` verbatim (the light string stays byte-identical; it is not rewritten
    to `withAlpha`). The role of X is still decided by rule 1a. This is safe only while every
    `color.*` value is a 6-digit hex, which Property 7 asserts (`/^#[0-9a-f]{6}$/`). Sites
    include `AttachedExperienceListsSection.tsx:631–760`, `TripDetailScreen.tsx:787/816/917/1138`,
    `ResortPicker.tsx:184/229` and `GroupFavoritesSection.tsx:165/168`.

    **Generalised in iteration 4.** Rule 2a applies to any colour value X followed by a
    two-hex-digit alpha suffix, written either `` `${X}NN` `` or `X + 'NN'`, where X is a
    theme token, a park accent, a category `tint`/`fill`, a tier colour, a palette value, or
    a local variable holding one of these. The converted X keeps the suffix verbatim, so the
    light string stays byte-identical. The role of X is decided by rule 1a for a token read,
    and by rules 1 and 3 otherwise. Real non-token sites: `HomeFavoritesSection.tsx:135`
    `parkColor + '18'` (a park accent, falling back to `primary`),
    `ResortsDirectoryScreen.tsx:2262` `` `${tierColor}18` `` (a local resort-tier literal) and
    `TripExpensesScreen.tsx:945` `catMeta.fg + '33'`.
    - **Constraint on palette values (rule 3).** A palette value that is ever suffixed with
      an alpha must be a 6-digit `#rrggbb` hex in **both** schemes. It must never be `rgb()`,
      `rgba()`, 3-digit or 8-digit hex, because the suffix would then produce an invalid
      colour silently. Property 14 can't see suffix use, so this is a conversion-rule
      constraint. The batch checks it and lists each such site in its report (DoD item 8).
    - Theme-side values are pinned by Property 7: every `color.*`, `parkAccent.*`,
      `categoryVisual[*].tint`/`.fill` and `resortVisual.tint`/`.fill` value matches
      `/^#[0-9a-f]{6}$/` in both schemes.
3. **Non-token literal.** It goes into a co-located `<File>.palette.ts`
   (`definePalette({ light: { key: '<original literal, byte-for-byte>' }, dark: { key: ... } })`).
   The dark value is chosen by **family** and **role** from the tables below. The family comes
   from the explicit table for the high-frequency literals. For anything else it comes from the
   HSL hue of the light literal: saturation < 0.20 → neutral; otherwise `[345,15)` red,
   `[15,35)` orange, `[35,62)` amber, `[62,170)` green, `[170,195)` teal, `[195,215)` sky,
   `[215,250)` blue, `[250,300)` violet, `[300,345)` pink.
   - **Roles:**
     - **T**: text or icon on a surface → `DARK_TONAL[f].fg`.
     - **S**: tinted or subtle background → `DARK_TONAL[f].tint`.
     - **B**: border, divider or track → `DARK_TONAL[f].border`.
     - **F**: solid fill behind white text → `DARK_TONAL[f].fill`, and the text stays
       `textOnPrimary`.
     - **G**: gold/yellow fill behind dark text → mode-invariant (light value in both).
     - **H**: hero or art surface that is already dark in light mode (relative luminance
       < 0.03, light text on it) → mode-invariant.
     - **V**: data-encoding scale (crowd levels, wait heat) → mode-invariant, as long as any
       text on it still meets 4.5:1 in dark. If it doesn't, use F.
   - **Neutral family.** `L` is WCAG relative luminance of the light literal. Every band is
     closed, so every neutral literal in every role has exactly one dark value. This rule is
     identical in the spec design.
     - **T:** L < 0.12 → `darkTheme.color.textPrimary`; L ≥ 0.12 →
       `darkTheme.color.textSecondary`.
     - **S:** every entry of the lavender-subtle list (high-frequency table), and any neutral
       with L ≥ 0.70 → `darkTheme.color.surfaceAlt`. A neutral with L < 0.70 →
       `darkTheme.color.borderStrong`. (`#ffffff` never gets here; rule 1 maps it to
       `surface`.)
     - **B:** L ≥ 0.75 → `darkTheme.color.border`; otherwise `darkTheme.color.borderStrong`.
     - **F:** `darkTheme.color.borderStrong` (white text on it 9.96:1).
     - Example luminances: `#e2e8f0` 0.80 and `#cbd5e1` 0.66 (S → `surfaceAlt` /
       `borderStrong`; T → `textSecondary`), `#ede6f6` 0.81 and `#e9e3f5` 0.79 (lavender
       subtle, so S → `surfaceAlt`).
   - **Lavender subtle backgrounds.** The listed lavender-subtle literals always count as
     **neutral**, whatever their HSL saturation, so they follow the neutral S/T/B bands above.
     An unlisted violet goes through the hue table to the violet family.
   - **Alpha-suffixed values (iteration 4).** A palette value that the code ever suffixes with
     an alpha (rule 2a) must be `#rrggbb` in both `light` and `dark`.
4. **Status token as a solid fill behind white text.** Applies to `success`, `danger` or
   `warning` filled with white text. In dark, white on `#4cc38a` is only 2.22:1 and on
   `#ff6b9a` only 2.68:1. These become a palette pair: light is the token's light value, dark is
   `DARK_TONAL.green.fill` (success), `.pink.fill` (danger) or `.amber.fill` (warning).
5. **Exempt (left as literal):** `shadowColor: '#000'` / `'#000000'`, and neutral
   `rgba(255,255,255,a)` / `rgba(0,0,0,a)` overlays on a gradient, image or scrim. A neutral
   `rgba(255,255,255,a)` veil **on a themed surface** becomes `withAlpha(t.color.surface, a)`.
   In light that's exactly `rgba(255, 255, 255, a)` (the same colour; only whitespace inside
   the string can differ, as with every rule-2 conversion), so there's no other choice to make. A
   neutral `rgba(0,0,0,a)` on a themed surface stays literal.
6. **Artwork is never recoloured.** That covers pin art (`components/pins/**`), avatar art
   (`avatars/AvatarPresets.tsx`), and destination hero gradients
   (`destinationVisuals.ts` `gradient`). Literals that are art embedded in a UI file get a
   mode-invariant palette pair with the comment `// artwork — mode-invariant`.
   `destinationVisuals.ts`'s `accent` field is removed. Consumers use `t.parkAccent[id]`, or
   `t.color.primaryFg` for `'Resorts'`. Every removed light accent equals the light
   `parkAccent`/`primary` value exactly (MK `#7e57c2` … DS `#f6a609`, Resorts `#5b2a86`).
7. **Pin tier colours used as UI text.** `components/pins/pinTierMeta.ts` `TIER_COLOR` is
   artwork and stays unchanged and allowlisted. But it is also used as UI text: `<Badge
   color={TIER_COLOR[tier]}>` in `PinCelebrationModal.tsx:198`, `PinDetailModal.tsx:58`,
   `PinShowcaseScreen.tsx:846` and `CollectionScreen.tsx:667`. In dark, amethyst `#8a45c9` is
   2.79:1 as badge text on its tint over surface, and bronze `#c97f4a` is 4.02:1 over
   surfaceAlt. Both fail 4.5:1. So B6 creates `screens/profile/tierText.palette.ts`:

   ```typescript
   import { TIER_COLOR } from '../../components/pins/pinTierMeta';
   import { definePalette } from '../../theme/theme';

   export const TIER_TEXT = definePalette({
     light: TIER_COLOR,                                              // byte-identical
     dark: { ...TIER_COLOR, amethyst: '#c08ff5', bronze: '#e0965f' },
   });
   ```

   Every place a tier colour is **text or an icon** (a `Badge` `color`, a `Text` `color`, an
   `Ionicons` `color`) uses `usePalette(TIER_TEXT)[tier]`. Tier dots, progress fills and
   swatches are non-text fills (`CollectionScreen.tsx:614/681`, `PinBoardScreen.tsx:398`), so
   they keep `TIER_COLOR`. `pinTierMeta.ts` is not edited. The pairs go into
   `CONTRAST_REQUIREMENTS` (Configuration & Constants, "Pin tier text").

**High-frequency family table** (the 71 most frequent non-token literals): neutral = `#64748b #655d78 #475569 #94a3b8 #334155 #1e293b
#0f172a #f1f5f9 #e2e8f0 #cbd5e1 #f8fafc` plus lavender subtle `#fbf9fe #faf7ff #f5f3ff #f1ecf7
#f5f0fb #ede6f6 #e9e3f5 #f1edfb #f1edfa`. Violet = `#7c3aed #6d28d9 #7e22ce #6b21a8 #581c87
#e8dcfa #ede9fe #f3e8ff #e9d5ff #ebdff8 #d8c7f2 #ded3f0 #dcd1ed`. H-role violet =
`#190c2d #371756 #3b1d60 #1e1b4b`. Green = `#15803d #16a34a #059669 #22c55e #10b981 #2e7d32
#dcfce7 #bbf7d0 #ecfdf5 #f0fdf4 #86efac`. Amber = `#fef3c7 #fde68a #fffbeb #ffd700(G)`.
Orange = `#d97706 #b45309 #92400e #78350f #451a03 #e65100 #f97316`. Red = `#dc2626 #b91c1c
#ef4444 #e11d48 #ff2d55 #fee2e2 #fef2f2 #fecdd3 #fff1f2`. Sky = `#2f80ed #0284c7`.
Blue = `#eef2ff`.

### Regression guard — `apps/mobile/src/test/themeGuard.ts` + `apps/mobile/src/__tests__/themeRetrofit.guard.test.ts` (new)

`themeGuard.ts` exports a pure `scanSource(relPath: string, source: string): Violation[]` and
`isAllowlisted(relPath, rule)`. `Violation = { file, line, rule, match }`, where `rule` is one
of `'hex' | 'chromaticRgb' | 'staticToken' | 'staticImport' | 'namespaceImport'`.

**Scan set.** Every `apps/mobile/src/**/*.{ts,tsx}`, excluding these:

- any path segment `__tests__` or `__testSupport__`
- `*.test.ts` / `*.test.tsx`
- `src/test/**`
- `*.d.ts`

Paths are normalised to POSIX and relative to `apps/mobile/src`.

**Preprocessing.** Strip `/* … */` blocks (this also covers JSX `{/* */}`), full-line `//`
comments, and full-line JSDoc `*` lines. Then remove matches of the shadow exemption
`/shadowColor:\s*(['"])#0{3}(?:0{3})?\1/g`. Trailing comments on code lines are *not*
stripped, so a hex inside one is a violation and the comment gets reworded.

**Rules.**

| Rule | Pattern | Allowlist |
| --- | --- | --- |
| `hex` | ``/(['"`])#(?:[0-9a-fA-F]{3,4}\|[0-9a-fA-F]{6}\|[0-9a-fA-F]{8})\1/g`` | `ARTWORK_AND_TOKEN_FILES` + `*.palette.ts` |
| `chromaticRgb` | `/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g` where the triple is not `255,255,255` or `0,0,0` | same as `hex` |
| `staticToken` | `/\btheme\.(color\|gradient\|shadow\|parkAccent\|categoryVisual\|resortVisual)\b/` and `/\{[^}]*\b(color\|gradient\|shadow\|parkAccent\|categoryVisual\|resortVisual)\b[^}]*\}\s*=\s*theme\b/` | `theme/theme.ts` only |
| `staticImport` | `STATIC_IMPORT_RE` below. For each match, split capture group 1 on `,`, trim each specifier, strip a leading `type `. Report a violation if the specifier matches `/^theme\s+as\s+\w+$/` (an aliased `theme` import would bypass `staticToken`; iteration 3), or if, after stripping a trailing `as <alias>`, the remaining name is in `FORBIDDEN_THEME_IMPORTS` | `THEME_INTERNALS` + `*.palette.ts` |
| `namespaceImport` | `NAMESPACE_IMPORT_RE` below (any match is a violation) | `THEME_INTERNALS` only |

**Import patterns (exact).** Both run over the preprocessed source as a whole, not line by
line, so multi-line import lists are caught (`[^}]*` spans newlines).

```typescript
export const STATIC_IMPORT_RE =
  /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](?:\.\.?\/)+(?:theme\/)?theme['"]/g;
export const NAMESPACE_IMPORT_RE =
  /import\s+\*\s+as\s+\w+\s+from\s*['"](?:\.\.?\/)+(?:theme\/)?theme['"]/g;
export const FORBIDDEN_THEME_IMPORTS = [
  'color', 'gradient', 'shadow', 'parkAccent', 'categoryVisual', 'resortVisual',
  'lightColor', 'darkColor', 'lightTheme', 'darkTheme', 'themes', 'DARK_TONAL',
] as const;
```

A namespace import (`import * as T from '../theme/theme'`) would otherwise bypass the
named-import rule for `T.darkTheme`/`T.DARK_TONAL`, so it's banned outright outside the theme
internals. `Violation.rule` gains `'namespaceImport'`. Line numbers are computed from the
match offset.

**Exact allowlists:**

```typescript
export const ARTWORK_AND_TOKEN_FILES = [
  'theme/theme.ts',                       // token source of truth
  'components/pins/motifPaths.ts',        // pin artwork (generated motif paths)
  'components/pins/pinArt.ts',            // pin artwork
  'components/pins/pinRenderModel.ts',    // pin artwork render model
  'components/pins/pinTierMeta.ts',       // pin tier identity colours (artwork)
  'components/pins/PinView.tsx',          // pin artwork renderer (inline SVG + lock overlay)
  'avatars/AvatarPresets.tsx',            // avatar artwork
  'screens/catalog/destinationVisuals.ts',// destination hero gradients (artwork)
] as const;
export const THEME_INTERNALS = [
  'theme/theme.ts', 'theme/useAppTheme.ts', 'theme/makeStyles.ts',
  'theme/appearance.ts', 'theme/AppearanceChrome.ts',
] as const;
export const PALETTE_FILE = /\.palette\.ts$/;
```

**Guard test assertions:**

1. The real tree has zero violations outside the allowlists and outside `PENDING_RETROFIT`.
2. Every allowlisted path exists on disk, so stale entries fail.
3. Every `*.palette.ts` passes three checks:
   - It contains `definePalette(`.
   - Every `export` line matches `/^export const [A-Z][A-Z0-9_]* = definePalette\(/`.
   - It contains no `StyleSheet`, `function`, `=>` or JSX.
4. Every `PENDING_RETROFIT` path exists.
5. **When `PENDING_RETROFIT` is empty**, `Object.keys(theme)` deep-equals
   `['spacing','radius','layout','typography']` and `theme.ts` has no named export
   `color|gradient|shadow|parkAccent|categoryVisual|resortVisual`.

Spec task 10.1 deletes the `PENDING_RETROFIT` map and the strict-mode code, and makes
assertion 5 unconditional. That locks the end state.

**Migration mode.** `PENDING_RETROFIT: Readonly<Record<'B1'|…|'B7', readonly string[]>>` lists
the exact unconverted files per batch (the batch lists below). Batches **never edit the guard**.
To self-check, a batch runs it in strict mode for its own id. In PowerShell:

```powershell
$env:THEME_GUARD_STRICT='B4'; npx jest src/__tests__/themeRetrofit.guard.test.ts --maxWorkers=2; Remove-Item Env:THEME_GUARD_STRICT
```

That treats the batch's files as not pending.

### AsyncStorage jest-mock strategy

Once kit components call `useAppTheme()`, nearly every test file's module graph reaches
`themeStore → appearanceStorage → @react-native-async-storage/async-storage`.
`AsyncStorage.native.ts` **throws at import** when the native module is absent
(`if (!RCTAsyncStorage) throw new Error('[@RNC/AsyncStorage]: NativeModule: AsyncStorage is
null…')` — read from the installed package). So the design adds an **automatic manual mock**:
`apps/mobile/__mocks__/@react-native-async-storage/async-storage.js` containing
`module.exports = require('@react-native-async-storage/async-storage/jest/async-storage-mock');`.
This is the same `<rootDir>/__mocks__` node-module convention the repo already uses for
`@expo/vector-icons` (`apps/mobile/__mocks__/@expo/vector-icons.js`). Jest applies it to every
test file with no `jest.mock` call needed.

Existing explicit per-file `jest.mock('@react-native-async-storage/async-storage', …)` calls
(in 15 files, e.g. `navigation.test.tsx`, `themeStore.test.ts`) keep working, because an
explicit factory takes precedence. They become redundant but are left untouched to avoid
churn across batch-owned files.

Under jest the default scheme is light. RN's preset mocks `useColorScheme` to `'light'`
(`@react-native/jest-preset/jest/mocks/useColorScheme.js`), and the store default is
`'system'`. So existing light-value assertions keep passing unchanged.

Dark tests use `apps/mobile/src/test/themeTestUtils.ts`:

```typescript
export function setTestScheme(s: 'light' | 'dark'): void   // act(() => useThemeStore.setState({ preference: s }))
export function resetTestScheme(): void                     // setState({ preference: 'system', hydrated: false })
```

Every test that calls `setTestScheme` registers `afterEach(resetTestScheme)`. Zustand state
persists within a test file's module registry, though not across files.

**Mocking the OS scheme (Properties 10, 17 and any `'system'` case).** `setTestScheme` sets
only the preference. Under jest-expo, `useColorScheme` is the preset's
`jest.fn(() => 'light')`, so a `'system'` test needs to control it too. Those test files reuse
the descriptor-copy mock that `theme/__tests__/useActiveTheme.test.tsx` already uses. The
spread form `{ ...jest.requireActual('react-native'), useColorScheme: jest.fn() }` crashes on
RN 0.85.3, because the spread eagerly invokes the lazy `DevMenu` getter. The working form:

```typescript
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(actual);
  descriptors.useColorScheme = { value: jest.fn(), writable: true, enumerable: true, configurable: true };
  return Object.defineProperties({}, descriptors);
});
```

`themeTestUtils.ts` also exports a helper for these files:

```typescript
/** Requires the file to have installed the descriptor-copy mock above. */
export function setTestOsScheme(s: 'light' | 'dark' | null): void
// const m = require('react-native').useColorScheme;
// if (typeof m?.mockReturnValue !== 'function') throw new Error(
//   'setTestOsScheme: mock react-native useColorScheme first (see useActiveTheme.test.tsx)');
// m.mockReturnValue(s);
```

A changed mock return value notifies no subscriber. So callers set it before the first render,
or follow it with `rerender(...)` or a store change.

`resetTestScheme()` also calls `mockReturnValue('light')` when the mock is installed. Without
the mock, a `'system'` assertion would always see `'light'`, so a Property 10/17 test that
claims to cover `'system'` + dark OS must use this helper.

## Data Models

There is no persisted data, DTO, migration or Zod change. The only data is the in-memory token
model above, plus `*.palette.ts` constant maps. The Appearance preference storage from the
existing spec is unchanged.

## Correctness Properties

Numbering continues the spec's existing Properties 1–6.

### Property 7: Light/Dark Token Key Parity

*For every token group (`color`, `gradient`, `shadow`, `outline`, `parkAccent`,
`categoryVisual`, `resortVisual`, `tabBar`), `lightTheme` and `darkTheme` have identical key
sets. Each gradient tuple has the same length in both schemes. Every colour value is a valid
`#rgb`/`#rrggbb`/`rgb()`/`rgba()` string. `categoryVisual[k].glyph`/`.label` are identical
across schemes and equal `categoryMeta[k]`.* fast-check: `fc.constantFrom(...groupNames)` ×
`fc.constantFrom(...keys)`, at least 100 runs.

*Iteration 3 additions: the `gradient` group includes `fab` and `chartBar` in both schemes;
every `categoryVisual[k]` and `resortVisual` has both `tint` and `fill` in both schemes; and
every `color.*` value in both schemes matches `/^#[0-9a-f]{6}$/` (so rule 2a's
`` `${t.color.X}NN` `` suffixes stay valid 8-digit hex).*

*Iteration 4 addition: the same `/^#[0-9a-f]{6}$/` assertion covers every `parkAccent.*`
value and every `categoryVisual[k].tint`, `categoryVisual[k].fill`, `resortVisual.tint` and
`resortVisual.fill` value, in both schemes, because the generalised rule 2a lets code suffix
any of them with an alpha.*

**Validates:** Requirements 7.1, 7.3

### Property 8: Light Theme Is Byte-Identical to the Pre-Retrofit Palette

*For every key in the pre-retrofit literal table (Configuration & Constants "light" column:
colour, gradient, shadow, parkAccent, category tints, resortVisual tint, tab tints, badge), the
`lightTheme` value equals that literal exactly. `lightTheme.color.primaryFg ===
lightTheme.color.primary`. `lightTheme.outline.card` and `lightTheme.textDefault` are empty
objects. `buildNavigationTheme(lightTheme)` is `DefaultTheme` by identity.*

*Iteration 3 additions: `lightTheme.categoryVisual[k].fill === lightTheme.categoryVisual[k].tint`
for every category, and `lightTheme.resortVisual.fill === lightTheme.resortVisual.tint`;
`lightTheme.gradient.fab` and `lightTheme.gradient.chartBar` both deep-equal
`['#7e57c2','#5b2a86','#3d1c5c']` (today's `headerVivid`); `lightTheme.gradient.header`
deep-equals `['#5b2a86','#3d1c5c']`; `lightTheme.color.primaryLight === '#7e57c2'`;
`withAlpha('#5b2a86', 0.14) === 'rgba(91, 42, 134, 0.14)'` (today's `hexToRgba` string).*

**Validates:** Requirements 7.2, 9.2, 10.2

### Property 9: Declared Contrast Floors Hold

*For every entry `(fg, bg, min)` in `CONTRAST_REQUIREMENTS` (the dark pairs in Configuration &
Constants, including `DARK_TONAL` fg-on-surface, fg-on-tint and white-on-fill),
`contrastRatio(fg, bg) >= min`. As a generator property, `contrastRatio` over arbitrary hex
pairs is symmetric, lies within `[1, 21]`, and equals 21 for `#000000`/`#ffffff`.*

*Iteration 3 additions to `CONTRAST_REQUIREMENTS` (Configuration & Constants "Iteration 3
pairs"): `primaryLight` as badge text on its 14 % tint over surface / surfaceAlt / background
(min 4.5); white on every dark `categoryVisual[k].fill` and `resortVisual.fill` (min 4.5);
the non-text graphics pairs (min 3.0): `gradient.chartBar` stops vs `surface`, `primaryFg`
and `primaryLight` vs `surfaceAlt` (progress fill and ring arc), `gradient.header` stops vs
`surface`, `gradient.fab` stops vs `surface`, and white on every `gradient.fab` stop (glyph);
plus the rule-1a pairs (white and `accent` on `#1f1235`, white on `primary`, min 4.5).*

*Iteration 4 additions (min 3.0, criterion 7.5 scope): `gradient.header` stops vs
`background` (3.70 / 3.32), and the Chip-active fill `primary` vs `surface` and vs
`background` (3.36 / 3.70). The `surfaceAlt` values (2.98 / 2.67 / 2.98) are recorded in
Configuration & Constants but are not entries, because 7.5 is scoped to `surface` and
`background`.*

**Validates:** Requirements 7.4, 7.5, 9.8

### Property 10: Active Theme Resolution Is Total and Consistent

*For any `(preference, osScheme)` in `{'system','light','dark'} × {'light','dark',null,undefined}`,
a rendered probe calling `useAppTheme()` yields `themes[resolveActiveTheme(preference,
osScheme)]` (identity), and its `.scheme` equals that Active theme. The OS scheme is set with
`setTestOsScheme` over the descriptor-copy `useColorScheme` mock.*

**Validates:** Requirements 8.1, 8.2

### Property 11: `makeStyles` Is Lazy and Memoized per Scheme

*For any sequence of scheme switches (`fc.array(fc.constantFrom('light','dark'), {minLength:
1, maxLength: 12})`) applied to a mounted probe using a `makeStyles` hook:*

- *the factory runs 0 times before first render,*
- *it runs at most once per distinct scheme visited,*
- *every render under the same scheme returns the identical (`===`) style object,*
- *each object's colour values equal that scheme's tokens.*

**Validates:** Requirements 8.3, 8.4

### Property 12: Navigation Chrome Is Derived From Tokens

*For each Active theme `s`:*

- *`deriveAppearanceChrome(s).rootBackground === themes[s].color.background`.*
- *For `s = 'light'`, `navigationTheme === DefaultTheme`.*
- *For `s = 'dark'`, `navigationTheme.dark === true` and `navigationTheme.colors` equals
  `{ primary: primaryFg, background, card: tabBar.background, text: textPrimary, border:
  tabBar.border, notification: danger }` of `darkTheme`.*
- *`DARK_ROOT_BACKGROUND === '#120a1f'`.*

*Property 3's "fully determined by the Active theme" invariant continues to hold.*

**Validates:** Requirements 10.3, 10.4, 6.1, 6.3

### Property 13: Tab Bar and MagicFab Follow the Active Theme

*For each scheme, rendering `RootNavigator` (authenticated) with a non-zero claimable-pin
count gives these results:*

- *the focused tab icon's `color` equals `tabBar.activeTint`, and every unfocused icon's
  `color` equals `tabBar.inactiveTint`;*
- *the Vault badge style has `backgroundColor === tabBar.badgeBackground` and `color ===
  tabBar.badgeText`;*
- *light yields `#003a9b` / `#6b7280` / `#d97706` / `#ffffff`, and dark yields `#f6c343` /
  `#8a7fa3` / `#f6c343` / `#3d1c5c`;*
- *the rendered `MagicFab` gradient `colors` equal `t.gradient.fab` for that scheme (iteration
  3; light deep-equals today's `['#7e57c2','#5b2a86','#3d1c5c']`, dark
  `['#9d7ae0','#7e57c2','#7650b9']`).*

**Validates:** Requirements 10.1, 10.2, 10.5

### Property 14: Every Palette Pair Is Complete and Valid

*For every exported palette in every `*.palette.ts` (discovered by filesystem scan and loaded
with `require`), `Object.keys(light)` equals `Object.keys(dark)` as sets, and every value is a
valid colour string. For every such value, and every colour value of `lightTheme`/`darkTheme`
(including `DARK_TONAL`), `withAlpha(value, 0.14)` does not throw.*

**Validates:** Requirements 9.4, 11.3

### Property 15: Regression Guard Is Sound and the Tree Is Clean

*For generated fixture sources (`fc.hexaString` 3/6/8-digit hex inside `'`, `"` or `` ` ``
quotes; `fc.tuple(fc.integer({min:0,max:255}) ×3)` rgba triples; `theme.color.<key>` reads;
named imports of each forbidden specifier, single- and multi-line, with and without
`type`/`as <alias>`; an aliased `import { theme as T } from` the theme module (iteration 3);
`import * as X from` the theme module), `scanSource` reports a violation
of the matching rule for a non-allowlisted path, and none for an allowlisted path. A named
import of a non-forbidden specifier (e.g. `spacing`, `definePalette`) is never reported. Neutral `rgba(255,255,255,a)`
/ `rgba(0,0,0,a)` and `shadowColor: '#000'` are never reported. Over the real `apps/mobile/src`
tree, the guard reports zero violations outside `PENDING_RETROFIT`, and every allowlist and
pending entry exists.*

**Validates:** Requirements 11.1, 11.2, 11.4, 11.5

### Property 16: Kit Primitives Render With the Active Theme's Tokens

*For each kit primitive × scheme (`fc.constantFrom(...primitives)` × `fc.constantFrom('light','dark')`),
the flattened rendered colour props equal the token-mapping table's tokens for that scheme.
Examples: Card `backgroundColor === surface`, Chip active `backgroundColor === primary` and
text `color === textOnPrimary`, SecondaryButton label `color === primaryFg`, Badge default text
`color === primaryFg`, ScreenContainer `backgroundColor === background`, GradientHeader
`colors === gradient.headerVivid`, ProgressRing track `stroke === surfaceAlt`, Card in dark has
`borderColor === border` and in light no `borderWidth`.*

*Iteration 3 additions: `RatingHistogram` bar gradients `colors === gradient.chartBar`;
`ProgressBar` default fill `backgroundColor === primaryFg`; `ProgressRing` default arc stops
`=== [primaryLight, primaryFg]`; `PrimaryButton` gradient `colors === gradient.header`. Under
light each of these deep-equals today's literal values (`headerVivid` light, `#5b2a86`,
`['#7e57c2','#5b2a86']`, `['#5b2a86','#3d1c5c']`).*

**Validates:** Requirements 7.5, 9.1, 9.3

### Property 17: A Mounted Tree Repaints Live Without Remount

*For any sequence of preference changes (`fc.array(fc.constantFrom('system','light','dark'))`
with the OS scheme mocked to `'dark'` via the descriptor-copy mock and `setTestOsScheme('dark')`
before first render), applied with `setTestScheme`/store `setState` to a
mounted tree of `ScreenContainer > Card > Chip`, the same host instances (captured refs
compared with `===`) report the colours of `themes[resolveActiveTheme(pref, 'dark')]` after
each change.*

**Validates:** Requirements 8.2, 9.1

### Property 18: Artwork Is Invariant Across Schemes

*For each pin fixture (`PinView` with every tier in `TIER_COLOR`) and each avatar preset id
(`AVATAR_PRESET_IDS`), the serialized render tree under light equals the serialized render tree
under dark.*

**Validates:** Requirement 9.5

### Property 19: Native and Third-Party Controls Receive Themed Props; Default Text Is Dark-Only

*For each scheme, rendering the real `DatePickerField` (opened) and `ResortPicker` gives these
results:*

- *the `Calendar` receives `theme.calendarBackground === surface`,
  `dayTextColor === textPrimary`, `selectedDayBackgroundColor === primary`, and
  `arrowColor === primaryFg`;*
- *its React `key` changes with the scheme, so a mounted picker gets a new `Calendar`
  instance;*
- *the search `TextInput` has `placeholderTextColor === textSecondary` and
  `keyboardAppearance === scheme`;*
- *its flattened style `color` is `textPrimary` in dark and absent in light.*

Test file: `components/__tests__/nativeControlsTheme.test.tsx`.

The `TextInput` in this property sits on a themed surface with no `Text` ancestor, so the
default-text rule applies. A second case renders a nested `<Text>` inside a coloured parent
`Text`, and a plain `Text` on a G-role gold fill, both under dark. It asserts that neither
gets `color: textPrimary`: the nested one keeps the inherited parent colour, and the one on
gold has no `color` set (Requirement 9.7 amendment).

**Validates:** Requirements 9.6, 9.7

### Property 20: Memoized and Virtualized Consumers Repaint Live

*For any sequence of scheme switches (`fc.array(fc.constantFrom('light','dark'), {minLength:
1, maxLength: 8})`) applied with `setTestScheme` to a mounted probe that uses the binding
consumer patterns, every probed host instance reports the current scheme's token value after
each switch, without a remount. The probe covers:*

- *a `useMemo` that derives a style from `styles`, with `styles` in its deps;*
- *a `useCallback` `renderItem` that reads `styles`/`t`, passed to a `FlatList` with
  `extraData={t.scheme}`;*
- *a `React.memo` row that receives its style by prop;*
- *a `useLayoutEffect` that calls a mocked `navigation.setOptions` with
  `headerStyle.backgroundColor`, asserted on the mock's last call.*

*A control case drops `styles` from the `useMemo` deps and asserts that it does **not**
repaint. That proves the probe can detect the defect.* Test file:
`theme/__tests__/consumerPatterns.prop.test.tsx`, at least 100 runs.

*Per-batch instance (test (d)): for at least one list screen per batch, mount under light, call
`setTestScheme('dark')` without remounting, and assert that a rendered row's colour equals the
dark value.*

**Validates:** Requirements 8.2, 8.5

### Property 21: Pin Tier UI Text Is Legible While Tier Art Is Unchanged

*For every `PinTier`:*

- *`TIER_TEXT.light[tier] === TIER_COLOR[tier]`;*
- *`TIER_TEXT.dark[tier]` has contrast of at least 4.5:1 as badge text on its 14 % tint over
  `surface`, over `surfaceAlt` and over `background` (via `CONTRAST_REQUIREMENTS`);*
- *rendering `PinDetailModal` under dark gives the tier `Badge` text
  `color === TIER_TEXT.dark[tier]`, and under light `=== TIER_COLOR[tier]`;*
- *the `PinView` subtree is identical across schemes (Property 18).*

Test file: `screens/profile/__tests__/PinDetailModal.tierText.test.tsx`, owned by B6.

**Validates:** Requirements 9.5, 9.9

### Property 22: Role-Converted Token Reads and Category Fills Stay Legible in Dark

*For every category `k` (`fc.constantFrom(...EXPERIENCE_CATEGORIES)`, at least 100 runs) and
`resortVisual`: `contrastRatio('#ffffff', darkTheme.categoryVisual[k].fill) >= 4.5`, and the
light fill equals the light tint. For each rendered site under each scheme:*

- *a category placeholder tile (asserted on `ExploreHubScreen`'s tile in its owned test, B1)
  has `backgroundColor === t.categoryVisual[k].fill` and a glyph `color === textOnPrimary`;*
- *`MarkGottenUndoToast` has toast `backgroundColor === '#1f1235'`, message
  `color === '#ffffff'` and Undo `color === accent` in both schemes (B3,
  `MarkGottenUndoToast.test.tsx`);*
- *`TripReservationsScreen`'s active kind/date chip text `color === textOnPrimary` on a
  `backgroundColor === primary` chip (B5, `TripReservationsScreen.test.tsx`).*

*Under light, every asserted value equals the pre-retrofit value.*

**Validates:** Requirements 9.10, 9.11

## Spec Amendment Summary (`.kiro/specs/dark-mode/`)

All changes are additive. No existing requirement, property or task was deleted or renumbered.

- **requirements.md.** Superseding notes were added to the Introduction ("explicitly
  deferred"), to criterion 6.1 (`DarkTheme` replaced by a token-built theme), and to the three
  affected Out of Scope bullets. A new Out of Scope bullet defers light-mode a11y fixes. New
  **Requirements 7–12** were added: Twilight tokens, runtime theme resolution, full-app retrofit
  with unchanged light, tab bar and navigation chrome, the regression guard, and conventions
  plus the verification record. Design-review iteration 2 appended criterion **8.5**
  (memoized/virtualized consumers repaint), criterion **9.9** (pin tier colours used as UI
  text), and an amendment note on **9.7** (default-text exclusions), with no renumbering.
- **design.md.** It gets a superseding note in the Overview, and `(Retrofit)` subsections in
  Architecture, Components and Interfaces, Error Handling, Testing Strategy, Configuration &
  Constants (full palette, tints, ramp, contrast), External Interfaces and Cross-Spec. It adds
  **Properties 7–21** (20 and 21 added in design-review iteration 2), plus a note on Property 3. Requirements 12.1 and 12.2 are
  process/doc requirements, verified by tasks 10.2 and 11, and have no property.
- **tasks.md.** It gets new tasks **7–12** (all unchecked), superseding and execution-model
  notes, and dependency-graph waves 14–29 plus an ASCII chain.
- **Design-review iteration 3 (additive).** requirements.md gains criterion **7.5**
  (non-text graphics ≥ 3:1), criteria **9.10** (out-of-role token reads converted by role)
  and **9.11** (category fills behind white), and amendment notes on **7.1** (`fill`,
  `fab`/`chartBar`), **7.4** (`primaryLight` badge pairs, category fills), **9.3** (data
  marks use `primaryFg`) and **10.5** (`gradient.fab`). design.md gains **Property 22**,
  extended Properties 7/8/9/13/15/16, rules 1a and 2a, the category-fill and iteration-3
  contrast tables (copied in full so the spec is self-sufficient), the light-colour multiset
  audit, W1 test ownership, and superseded notes on the historical spread-form mock.
  tasks.md amends tasks 3.2 (note), 7.2, 7.6, 8.1, 8.3, 8.4, 8.5, 9 (Done-when audit), 9.3,
  9.5 and 10.1 in place with "(iteration 3)" wording. Nothing is renumbered or removed.
- **Design-review iteration 4 (additive).** requirements.md gains an amendment note on
  **7.5** (scope `surface`/`background`, Chip-active included, `surfaceAlt` placements
  reported). design.md amends the light-colour multiset audit (named-import reads, palette
  aliases, numeric alpha, exemptions on both sides), generalises rule 2a, adds the rule-3
  `#rrggbb` constraint, the palette alias read form, the Property 7 and Property 9 iteration-4
  additions, the `background` non-text rows and the 7.5 scope paragraph, and corrects the
  category-fill prose. tasks.md amends 7.6 (new rows, Property 7 extension, superseded
  pointer) and task 9's Done-when, and adds an iteration-4 note. Nothing is renumbered or
  removed.
- **Design-review iteration 5 (additive).** design.md's audit block makes the numeric
  `withAlpha` bullet of `after(F)` exact (explicit regex; matched spans removed before the
  `t.<GROUPS>` read regex) and adds a fixture to the audit notes. tasks.md amends task 9's
  Done-when and adds an iteration-5 note. Nothing is renumbered or removed.

## Error Handling

| Operation | Failure | Recoverable? | Caller receives | Logged? |
| --- | --- | --- | --- | --- |
| `useAppTheme()` / `usePalette()` | Store not hydrated yet | Yes (expected) | The `'system'` default resolution (Requirement 3.2's allowed first-frame window) | No |
| `useAppTheme()` | `useColorScheme()` returns `null`/`undefined` | Yes | Light theme (existing `resolveActiveTheme` fallback) | No |
| `makeStyles` factory | Throws (a programming error, e.g. undefined token) | Fatal for that component | The error propagates to the nearest error boundary (render error). Typecheck catches it first, because token access is fully typed. | RN red box in dev |
| `withAlpha(color, a)` | Input isn't 3/6/8-digit hex, `rgb()` or `rgba()` | Fatal | `Error('withAlpha: unsupported colour <value>')` at the call site. This is a programming error. Property 14 asserts that every token and palette value parses, so `Badge` can't reach this with a real value. | No |
| `definePalette` | Missing or extra dark key | Compile-time | `tsc` error; Property 14 backs it up at runtime | n/a |
| Guard test | Violation found | Build-blocking | Jest failure listing `file:line rule match` per violation | Jest output |
| Guard test | Allowlist or pending entry missing on disk | Build-blocking | Jest failure naming the stale entry | Jest output |
| Calendar remount on scheme switch | Selected month resets to `current` | Accepted | The calendar re-opens on the field's value/min/today month (existing `initialMonth` logic) | No |
| Batch finds a needed kit/shared change | Out-of-ownership edit | Stop | The batch reports the needed change and leaves its task unchecked. The integrator applies it serially. | Batch report |

## Testing Strategy

**Unit / property (pure, no React):**

- `theme/__tests__/theme.tokens.test.ts` covers Property 7 and Property 8, and also
  `withAlpha` (valid 3- and 6-digit hex, invalid input throws, alpha passthrough) and
  `definePalette` identity.
- `theme/contrast.ts` (new, pure) exports `relativeLuminance(hex)`, `contrastRatio(a, b)`
  (WCAG 2.x), `mixOver(fg, bg, alpha)`, and the `CONTRAST_REQUIREMENTS` table. Its test is
  `theme/__tests__/contrast.prop.test.ts` (Property 9).
- `test/__tests__/themeGuard.prop.test.ts` covers Property 15's fixture half.

**Hook / kit (jest-expo + RTL, mocking only AsyncStorage via the automatic mock):**

- `theme/__tests__/useAppTheme.test.tsx` (Property 10)
- `theme/__tests__/makeStyles.prop.test.tsx` (Property 11, plus a test that the factory is not
  called at `require` time)
- `__tests__/App.appearance.test.tsx`, updated: the `toBe(DarkTheme)` assertions are replaced
  per Property 12, and the `DARK_ROOT_BACKGROUND` value check is added.
- `theme/__tests__/components.theme.test.tsx` (Property 16, Property 17)
- `theme/__tests__/charts.theme.test.tsx` (Property 16, chart rows)
- `navigation/__tests__/tabBarTheme.test.tsx` (Property 13)
- `components/pins/__tests__/artworkInvariance.test.tsx` (Property 18, avatar rows included)
- `components/__tests__/nativeControlsTheme.test.tsx` (Property 19, with the default-text
  exclusion cases)
- `theme/__tests__/consumerPatterns.prop.test.tsx` (Property 20 probe, written in W1)
- `screens/profile/__tests__/PinDetailModal.tierText.test.tsx` (Property 21, written by B6)
- `__tests__/themeRetrofit.guard.test.ts` (Property 14, Property 15 tree half)

**Per-batch screen tests.** For every top-level screen, modal or sheet in the batch that already
has a render test, add one `describe('dark mode')` case to that existing test file with
`setTestScheme('dark')` / `afterEach(resetTestScheme)`. It asserts three things:

- **(a)** The root container's flattened `backgroundColor` equals
  `darkTheme.color.background`, or `surface` for sheets and modals.
- **(b)** One primary text node's `color` equals `darkTheme.color.textPrimary`.
- **(c)** For a file that had hardcoded literals, at least one converted element has its
  `darkTheme`/palette dark value.
- **(d)** On one designated screen per batch, mount under light, call
  `setTestScheme('dark')` **without remounting**, and assert that a rendered row's colour
  equals the dark value (Property 20's per-batch instance). The designated screens all have
  existing render tests:
  - B1 `ExploreHubScreen`
  - B2 `LiveWaitsScreen`
  - B3 `MyFoodListsScreen`
  - B4 `TripScheduleScreen` (B4 has no `FlatList` screen, so it uses its most memo-heavy one)
  - B5 `TripsListScreen`
  - B6 `NotificationCenterScreen`
  - B7 `FriendsListScreen` (in `FriendsListScreen.removeConfirmation.test.tsx`)

Each batch report lists every converted file that has no render test, so it is covered only by
the guard and screenshots. Existing light assertions must keep passing unchanged. That's the
light-parity regression net for each file.

*Iteration 3 correction:* existing light assertions are a **thin** net. A repo search finds
only 6 hex colour assertions in 4 mobile test files and no `rgba` assertions, and the
screenshot pass can't see a near-neighbour mis-map (e.g. `#655d78` → `textSecondary`
`#6b6480`). The real light-parity proof is the deterministic **light-colour multiset audit**
in "Per-batch definition of done" item 2, which every W1 task (8.1–8.3) and every W2 batch
runs. Existing light assertions stay as a secondary net.

**Iteration 3 tests:** Property 22's render assertions live in the owning batches' existing
tests (`ExploreHubScreen` B1, `MarkGottenUndoToast.test.tsx` B3,
`TripReservationsScreen.test.tsx` B5). Its pure half (white on every dark fill) is in
`theme/__tests__/theme.tokens.test.ts`, written in task 7.6.

**Visual verification (spec task 11).** This is a manual-but-recorded step on the `Pixel_7`
Android emulator:

- Run Expo Go via `npm run dev:cloud` in `apps/mobile` (hosted API, real data), on a signed-in
  test account.
- Capture `adb exec-out screencap -p` PNGs into `.agents/tasks/dark-mode-retrofit/screenshots/`
  as `NN-<screen>-light.png` / `NN-<screen>-dark.png`.
- Spec task 7.1 captures the light baseline (`NN-<screen>-baseline.png`) before any visual
  change.
- Checklist: Login, Register, Forgot/Reset Password, Home, the You & Crew sheet with
  Appearance, Explore hub, a Destination, a Park destination, Resorts directory, Crowd calendar,
  Live waits, Experience detail (ride Today lens, Passport lens, restaurant with menu), Menu,
  Trips list, Trip detail, Schedule, Expenses, Balances, Expense form modal, Members, Feed,
  Summary, Reservations, Planned list, Vault (Collection), Pin board, Pin showcase, Food lists +
  detail, Experience lists + detail, Stats + one detail, Friends list/search/profile,
  Notification center, Inbox, Sent shares, Share composer, MagicFab sheet, Date picker modal,
  and tab bar.
- The verifier views each PNG. Light/baseline pairs are compared side by side (dynamic data
  makes a pixel diff meaningless). The dark set is checked for light surfaces, black/invisible
  text, unreadable icons, and recoloured artwork. Findings are fixed in the owning file and the
  shot is re-captured.

**What green does not prove.** A green `npm run verify` and guard prove no static or literal
colour remains and that the asserted elements repaint. They do not prove every pixel reads
well, or that unstyled `Text` (RN default black) was caught everywhere. That's why the
screenshot pass is a required task, not optional.

**Commands.**

- Inner loop: `npx jest <file> --maxWorkers=2` in `apps/mobile`. Seven batches share the
  machine, and the jest-expo workers are memory-heavy.
- Batch self-check: the guard in strict mode, plus `npm run typecheck --workspace apps/mobile`.
  A batch owns zero errors **in its own files**. Errors in other in-flight batches' files are
  reported, not fixed.
- Final gate once (spec task 12): `npm run verify`.

## Parallel-Batch Decomposition

**Waves:**

- **W0** (spec task 7, sequential): foundation plus the baseline screenshots.
- **W1** (spec task 8, sequential): kit + chrome, then the guard with `PENDING_RETROFIT`.
- **W2** (spec task 9, **7 parallel batches**).
- **W3** (spec tasks 10–12, sequential): legacy-export removal, steering, visual
  verification, final gate.

**Ownership rules for W2:**

- A batch may edit only its listed files and the test files it owns. **Test ownership is
  exact.** A batch owns a test file when either of these holds:
  - it sits in a `__tests__/` directory and the first dot-separated segment of its filename
    equals the basename (without extension) of a file the batch owns. For example,
    `ExperienceDetailScreen.recreationExperience.test.tsx` → `ExperienceDetailScreen.tsx`
    (B2), and `TripScheduleScreen.test.tsx` → `TripScheduleScreen.tsx` (B4);
  - it's in the explicit cross-cutting list:
    - **B7:** every file under `screens/stats/**/__tests__/` and `screens/stats/__testSupport__/`
      (they call `statsView` functions that gain the theme parameter, e.g.
      `orderingDeterminism.prop.test.ts` calls `buildParkTiles`/`buildCategoryTiles` 6 times),
      plus `screens/catalog/__tests__/consumerSurfacesTaxonomy.test.ts` (imports `statsView`
      and `categoryVisual`) and `screens/catalog/__tests__/shareEntryPointProjection.prop.test.tsx`
      (imports `statsView`'s `buildProgressShareParams`).
    - **B4:** `screens/trips/__tests__/TripScheduleScreen.test.tsx` (already matched by rule
      1; listed because it mentions `theme.color` in a comment).
  - Any other test that fails because of a batch's change, and that the batch doesn't own,
    is a stop-and-report, not an edit.
- It may create new `<File>.palette.ts` files next to owned files.
- It must not change any exported signature, props or names. The exceptions are pure view
  models that gain a theme parameter, and only when all their callers are in the same batch.
- It must not touch unlisted `.ts` view-model or helper files. If one embeds a colour, stop and
  report.

**W1 — Kit & chrome (spec task 8, sequential):**

- `theme/components.tsx`, `theme/charts.tsx`
- `components/{ActiveTripShortcut, DatePickerField, ResortPicker, TimeWheelPicker}.tsx`
- `features/notifications/{AttentionBadge, AttentionItemRow, NotificationBell}.tsx`
- `navigation/{RootNavigator, ExploreStack, TripsStack, CollectionStack, YouAndCrewStack, StatsStack}.tsx`
- `screens/quickAction/{MagicFab, QuickActionSheet}.tsx`
- `screens/AppearancePreferenceControl.tsx`
- Tests: `src/__tests__/navigation.test.tsx` and `src/navigation/__tests__/*`
- **Test ownership (iteration 3).** W1 also owns, by the same first-segment rule the batches
  use, every `__tests__/` file whose first dot-separated filename segment is a W1 file's
  basename. Today that is `components/__tests__/{ActiveTripShortcut, DatePickerField,
  ResortPicker, TimeWheelPicker}.test.tsx`, `screens/notifications/__tests__/AttentionItemRow.test.tsx`,
  `screens/__tests__/AppearancePreferenceControl{,.prop}.test.tsx` and
  `theme/__tests__/{charts, components.card, components.gradientHeader}.test.tsx`. The
  MagicFab/QuickActionSheet and AttentionBadge/NotificationBell tests don't match by name, so
  W1 owns them explicitly: `screens/quickAction/__tests__/quickActionComponents.test.tsx`
  (renders `MagicFab` and `QuickActionSheet`) and
  `screens/notifications/__tests__/notificationNavigation.test.tsx` (renders `RootNavigator`,
  `AttentionBadge`, `NotificationBell`).

**W2 batches (disjoint):**

| Batch | Files (all under `apps/mobile/src/`) | ~Lines |
| --- | --- | --- |
| **B1** Explore & destinations | `screens/catalog/{ExploreHubScreen, DestinationScreen, ParkDestinationScreen, ResortsDirectoryScreen, ResortGuideSection, CrowdCalendarScreen, LocationGroupSection, TodayInParkLens}.tsx`, `screens/catalog/destinationVisuals.ts` (remove `accent`; gradients stay) | 14.3k |
| **B2** Experience detail & live | `screens/catalog/{ExperienceDetailScreen, QuickSpecsRow, LensSwitcher, LiveStatusStrip, LiveWaitCockpit, FloatingActionDock, PassportAndLoreLens, ParkPassportCard, AboutSection, WaitInsightsSection, VirtualQueueBanner, ShowtimesCard, DiningReservationCard, YourVisitCard, VisitHistoryTimeline, CompletionControls, RatingControl, NoteControl, FavoriteToggle, MenuScreen, MenuSummaryCard}.tsx`, `screens/catalog/live/{DiningSection, ForecastChart, liveSectionShared, RideLiveSection, ShowtimesSection}.tsx`, `screens/liveWaits/LiveWaitsScreen.tsx` | 12.3k |
| **B3** Logging sheets & lists | `screens/catalog/{AddToTripOrListChoiceSheet, AddToTripPickerSheet, CreateLocationModal, FoodItemLogHistorySheet, FoodItemPickerModal, LogFoodItemModal, LogVisitModal, MyFoodHistoryScreen, RateExperienceModal, RestaurantDishLogCard, RestaurantFoodLogsSheet}.tsx`, `screens/foodLists/*.tsx` (8), `screens/experienceLists/*.tsx` (6) | 14.2k |
| **B4** Trip money & schedule | `screens/trips/{TripScheduleScreen, TripExpensesScreen, ExpenseFormModal, TripBalancesScreen, SettlementModal, RefundModal, ReceiptReviewModal}.tsx` | 13.5k |
| **B5** Trip shell | `screens/trips/{AttachedExperienceListsSection, AttachedFoodListsSection, ExperiencePicker, GroupFavoritesSection, ResortPickerModal, RodeWithConfirmScreen, TripDetailScreen, TripEditScreen, TripFeedScreen, TripGuestManagementModal, TripInviteScreen, TripMembersScreen, TripPlannedListScreen, TripReservationsScreen, TripsListScreen, TripSummaryScreen}.tsx` | 14.4k |
| **B6** Home, Vault, pins UI, social | `screens/home/*.tsx` (6), `screens/collection/CollectionScreen.tsx`, `screens/profile/*.tsx` (5 — UI around pin art only), `screens/share/*.tsx` (3), `screens/notifications/NotificationCenterScreen.tsx` | 10.5k |
| **B7** Identity, stats, friends | `screens/stats/**/*.tsx` + `screens/stats/statsView.ts`, `screens/friends/*.tsx` (3), `screens/navigation/*.tsx` (6), `screens/youAndCrew/YouAndCrewScreen.tsx`, `screens/{AvatarPicker, ChangePasswordControl, ForgotPasswordScreen, LoginScreen, ProfileScreen, PushNotificationPreferenceControl, RegisterScreen, ResetPasswordScreen}.tsx`. Cross-cutting test owned by B7: `screens/catalog/__tests__/consumerSurfacesTaxonomy.test.ts` (it imports `statsView` and `categoryVisual`). | 12.8k |

Allowlisted files have no owner, with one exception: `screens/catalog/destinationVisuals.ts`.
B1 edits it only to remove the `accent` field. Its gradient literals stay, and the file stays
allowlisted. B6 also creates `screens/profile/tierText.palette.ts` (rule 7). It reads
`pinTierMeta.ts` but doesn't edit it.

**Per-batch definition of done:**

1. Every owned file passes the guard in strict mode.
2. Every converted literal follows the conversion rules, and the light values are
   byte-identical. The batch checks this with a read-only diff audit: every removed literal
   reappears as a palette `light` value, or maps to a token whose light value equals it. The
   audit diffs against a **pre-batch snapshot**, not `HEAD`. Many owned files already carry
   unrelated uncommitted edits (confirmed with `git status`; e.g. most `screens/trips/*`), so
   `git diff` alone would mix those in. Before editing, the batch copies its owned files to
   `$env:TEMP\dark-mode-snapshot\<batch>\` (outside the repo). It diffs against that copy with
   `git diff --no-index`, then deletes the snapshot. No helper file is left in the repo.

   **Light-colour multiset audit (iteration 3, binding, identical text in the spec; amended
   in iteration 4 for named-import reads, palette aliases, numeric alpha and exemptions).** The
   diff above is for reading; the pass/fail proof is this deterministic multiset check, run
   as a stdin `node -` script from the repo root so no file is written:

   ```text
   Loader: transform theme/theme.ts and each referenced *.palette.ts with
     require('esbuild').transformSync(src, { loader: 'ts', format: 'cjs' }) and evaluate it
     with a custom require: relative imports load recursively the same way; 'react-native'
     resolves to { StyleSheet: { hairlineWidth: 1, create: (s) => s } }; any other bare
     import resolves to {}. (esbuild is hoisted at the repo root as tsx's dependency.)
     LT = the loaded lightTheme.

   GROUPS = color|gradient|shadow|parkAccent|categoryVisual|resortVisual

   For each owned file F, with snapshot S = $env:TEMP\dark-mode-snapshot\<batch>\F:
     IMPORTS(S) (iteration 4) = the names S imports from the theme module, found with the
       guard's STATIC_IMPORT_RE: split capture group 1 on ',', trim, strip a leading `type `.
       Keep `theme` and the GROUPS names. A specifier `name as Alias` records Alias as the
       local name for `name`. (Real sites: `import { color }` in NotificationBell.tsx and
       AvatarChip.tsx; `import { theme, categoryVisual }` in ExperienceListDetailScreen.tsx
       and ExperiencePicker.tsx.)
     ALIASES(F) (iteration 4) = alias → P for every declaration in F matched by
       /const\s+(\w+)\s*=\s*(?:usePalette\((\w+)\)|(\w+)\[t\.scheme\])\s*(?:;|$)/gm
       (P = group 2 or group 3), where P is imported by F from a `*.palette` module.

     before(F) = multiset over S of
       - every hex literal matched by the guard's `hex` rule and every /rgba?\([^)]*\)/g literal,
       - LT's value for every /\btheme\.(color|gradient|shadow|parkAccent|categoryVisual|resortVisual)((?:\.\w+)+)/g
         read (a gradient contributes each stop; a spread shadow contributes its shadowColor).
         (iteration 4) If S imports `theme as Alias`, Alias replaces `theme` in this regex.
       - (iteration 4) LT's value for every bare read of an imported group name N in
         IMPORTS(S) (or its local alias), matched by
         /(?<![\w.])(N)((?:\.\w+)+)/g and resolved as LT.<group of N><path>
         (e.g. NotificationBell's `color.primary` → LT.color.primary).
     after(F) = multiset over F of
       - every literal as above, including rule-5 exempt literals (see Exemptions below),
       - LT's value for every /\bt\.(color|gradient|shadow|parkAccent|categoryVisual|resortVisual)((?:\.\w+)+)/g read,
       - withAlpha(LT value, a) for every `withAlpha(t.<path>, <numeric literal a>)` call,
         (iteration 5: makes the bullet above exact) i.e. for every call matched by
           /withAlpha\(\s*t\.((?:color|gradient|shadow|parkAccent|categoryVisual|resortVisual)(?:\.\w+)+)\s*,\s*(\d*\.?\d+)\s*\)/g
         (a = Number(group 2)). Before applying the `t.<GROUPS>` read regex above, remove
         every span this regex matched from F, so the call contributes only its rgba value,
         not also its base token. A withAlpha call whose alpha is not a numeric literal is
         not removed; its `t.<path>` counts as an ordinary read (matching a before-side
         `hexToRgba`/template read of the same token).
       - the palette `light` value for every `P[t.scheme].k` / `usePalette(P).k` read
         (P resolved from F's own `./<File>.palette` import),
       - (iteration 4) P.light[k] for every `<alias>.k` read, for every alias in ALIASES(F).
     Computed-index reads, matched by /\b(?:theme|t)\.(\w+)\[[^\]]+\]((?:\.\w+)*)/g and
     /\b(TIER_COLOR|usePalette\(\w+\))\[[^\]]+\]/g, are recorded symbolically on both sides with
     `[*]` (e.g. `categoryVisual[*].tint`, `parkAccent[*]`, `TIER_COLOR[*]`).
     (iteration 4) Also recorded symbolically: on the before side, a bare computed read of an
     imported group name N, /(?<![\w.])(N)\[[^\]]+\]((?:\.\w+)*)/g → `<group of N>[*]<path>`
     (e.g. `categoryVisual[cat].tint` → `categoryVisual[*].tint`); on the after side, every
     palette computed read — inline `usePalette(P)[…]`, `P[t.scheme][…]`, or `<alias>[…]` for
     an alias in ALIASES(F) — → `P[*]` (e.g. `TIER_TEXT[*]`).
     Normalise: lowercase; #rgb → #rrggbb. (iteration 4: numeric, replacing the
     earlier whitespace-strip) Parse each rgb()/rgba() channel and its alpha with Number() and
     re-emit as `rgba(r,g,b,a)` using JS default number formatting (`rgb(r,g,b)` →
     `rgba(r,g,b,1)`), so `0.10` ≡ `0.1` and `1` ≡ `1.0`. Example:
     `TripPlannedListScreen.tsx:1186` `'rgba(91, 42, 134, 0.10)'` and its rule-2 conversion
     `withAlpha(t.color.primary, 0.10)` (which renders `rgba(91, 42, 134, 0.1)`) both
     normalise to `rgba(91,42,134,0.1)`.
     Exemptions (iteration 4: replaces the earlier "counted only if they were also in
     before(F)" wording, which read two ways): a rule-5 exempt literal (black shadowColor, or a neutral
     rgba(255,255,255,a) / rgba(0,0,0,a) left as a literal) is counted on BOTH sides like any
     other literal. An exempt literal present in F but absent from S is a new literal and is
     listed as a difference.
     PASS iff before(F) == after(F) as multisets.
   ```

   *Audit notes (iteration 4).* A bare-name match on a local variable that shadows an
   imported name (e.g. a parameter named `color`) is a false match; list it as a difference
   justified "shadowed local". Palette records are read only in the forms the audit sees
   (inline, or through one `const` alias; see the consumer pattern's palette read-form rule);
   a destructured palette record is not allowed.
   *(iteration 5)* Fixture: `withAlpha(t.color.primary, 0.10)` → after contributes exactly
   `rgba(91,42,134,0.1)` (not also `#5b2a86`); a rule-5 veil `withAlpha(t.color.surface, a)`
   likewise contributes only its rgba value, not an extra `#ffffff`.

   Every difference is listed in the batch report with its rule-based justification, e.g.
   `categoryVisual[*].tint → categoryVisual[*].fill` (rule 1, fill split), `TIER_COLOR[*] →
   TIER_TEXT[*]` (rule 7), a removed `destinationVisuals` `accent` read → `parkAccent[*]`
   (rule 6), or a dark-only addition (`outline.card`, `textDefault`) that contributes no light
   colour. **An unexplained difference fails the definition of done.** Rule-1a conversions
   (`surface` → `textOnPrimary`, a text token → an H-role pair) keep the same light value, so
   they produce no difference.
3. The dark-mode test cases (a)–(d) are added.
4. Every `useMemo`/`useCallback`/effect/`FlatList` site in owned files follows the
   memoized-consumer rules, and `...t.textDefault` was applied only where the default-text
   rule allows. The report lists each memo/list site it touched.
5. Its owned tests pass at file level.
6. There are no typecheck errors in owned files.
7. The report includes a behavior→test map and lists the files with no render test.
8. *(iteration 4)* The report lists every value it converted under rule 2a whose suffixed
   value is not a theme token (park accent, category tint/fill, tier colour, palette value),
   and confirms each palette value used that way is `#rrggbb` in both schemes. It also lists
   any `PrimaryButton` (or active `Chip`) it finds rendered directly on a `surfaceAlt`
   container, because that placement falls outside criterion 7.5's scope (see "Non-text
   graphics" in Configuration & Constants). The integrator decides whether to move it.

## Configuration & Constants

### Colour tokens

| Token | Light (unchanged) | Dark |
| --- | --- | --- |
| background | `#f5f2fb` | `#120a1f` |
| surface | `#ffffff` | `#1e1430` |
| surfaceAlt | `#efe9f7` | `#2a1d42` |
| border | `#e2d9f0` | `#33264d` |
| borderStrong | `#cdbce6` | `#4a3a6b` |
| textPrimary | `#1f1235` | `#f3eefc` |
| textSecondary | `#6b6480` | `#b3a8c9` |
| textOnPrimary | `#ffffff` | `#ffffff` |
| textOnAccent | `#3d1c5c` | `#3d1c5c` |
| primary (fills) | `#5b2a86` | `#7e57c2` |
| primaryDark | `#3d1c5c` | `#2a1450` |
| primaryLight | `#7e57c2` | `#b28dff` (iteration 3; was `#9d7ae0`, see "Deviations from the brief's palette") |
| **primaryFg** (new; text, icons, links **and data marks** on surfaces) | `#5b2a86` | `#c4a3ff` |
| accent | `#f6c343` | `#f6c343` |
| accentDark | `#d4a017` | `#d4a017` |
| success | `#2e9e6b` | `#4cc38a` |
| danger | `#d6336c` | `#ff6b9a` |
| warning | `#e8a317` | `#f5b83d` |
| warningSurface | `#fff4d6` | `#3a2c0e` |
| warningText | `#8a5a00` | `#ffd27a` |
| star | `#ffffff` | `#ffffff` |
| starRating | `#f59e0b` | `#f6c343` |

### Gradients, shadow, outline, default text

| Token | Light (unchanged) | Dark |
| --- | --- | --- |
| gradient.header (PrimaryButton) | `['#5b2a86','#3d1c5c']` | `['#7e57c2','#7650b9']` (iteration 3; was `['#3b1d6e','#1a0d33']`) |
| gradient.headerVivid | `['#7e57c2','#5b2a86','#3d1c5c']` | `['#5b2a86','#3b1d6e','#1a0d33']` |
| gradient.gold | `['#f6c343','#d4a017']` | `['#f6c343','#d4a017']` |
| gradient.fab (new, iteration 3; MagicFab) | `['#7e57c2','#5b2a86','#3d1c5c']` | `['#9d7ae0','#7e57c2','#7650b9']` |
| gradient.chartBar (new, iteration 3; RatingHistogram) | `['#7e57c2','#5b2a86','#3d1c5c']` | `['#c4a3ff','#9d7ae0','#7e57c2']` |
| shadow.card | `#3d1c5c`, offset 0/4, opacity 0.12, radius 12, elevation 3 | `#000000`, offset 0/4, opacity **0.08**, radius 12, elevation 3 |
| shadow.floating | `#3d1c5c`, offset 0/8, opacity 0.20, radius 20, elevation 6 | `#000000`, offset 0/8, opacity **0.14**, radius 20, elevation 6 |
| outline.card | `{ borderWidth: 0 }` (spec task 11 fix; was `{}` — an omitted key is not reset natively on a live dark→light switch, which left `overflow: 'hidden'` cards blank on Android; zero width draws nothing) | `{ borderWidth: StyleSheet.hairlineWidth, borderColor: '#33264d' }` |
| textDefault | `{}` | `{ color: '#f3eefc' }` |

Elevation is kept identical on purpose. On Android it also sets z-order, so changing it could
reorder overlapping views.

### Tab bar and navigation

| Token | Light (unchanged) | Dark |
| --- | --- | --- |
| tabBar.background (= nav `card`) | `rgb(255, 255, 255)` (DefaultTheme) | `#170e27` |
| tabBar.border (= nav `border`) | `rgb(216, 216, 216)` (DefaultTheme) | `#33264d` |
| tabBar.activeTint | `#003a9b` | `#f6c343` |
| tabBar.inactiveTint | `#6b7280` | `#8a7fa3` |
| tabBar.badgeBackground | `#d97706` | `#f6c343` |
| tabBar.badgeText | `#ffffff` | `#3d1c5c` |
| `DARK_ROOT_BACKGROUND` | — | `#120a1f` (was `#121212`) |
| `LIGHT_ROOT_BACKGROUND` | `#f5f2fb` | — |

### Park accents

| Park | Light (unchanged) | Dark | vs surface `#1e1430` | Badge text on 14 % tint |
| --- | --- | --- | --- | --- |
| Magic Kingdom | `#7e57c2` | `#b28dff` | 6.80 | 5.39 |
| EPCOT | `#2f80ed` | `#5aa2ff` | 6.72 | 5.39 |
| Hollywood Studios | `#e8505b` | `#ff7a83` | 6.98 | 5.58 |
| Animal Kingdom | `#3fa34d` | `#5cc46a` | 7.98 | 6.29 |
| Typhoon Lagoon | `#17a2b8` | `#3cc9de` | 8.85 | 6.90 |
| Blizzard Beach | `#4dabf7` | `#7cc4ff` | 9.35 | 7.06 |
| Disney Springs | `#f6a609` | `#ffb732` | 10.08 | 7.58 |

### Category tints (chosen here)

The rule: brighten each hue until it clears 4.5:1 on `#1e1430`. That's above the 3:1 icon
target, so a tint is also safe as `Badge` *text* on its own 14 % tint, the way `Badge` renders
it. Categories that share a light tint share a dark tint.

| Category | Light (unchanged) | Dark | vs surface | vs surfaceAlt | vs background | Badge text on 14 % tint |
| --- | --- | --- | --- | --- | --- | --- |
| Ride | `#7e57c2` | `#b28dff` | 6.80 | 6.02 | 7.48 | 5.39 |
| Show | `#e8505b` | `#ff7a83` | 6.98 | 6.18 | 7.68 | 5.58 |
| Restaurant | `#f6a609` | `#ffb732` | 10.08 | 8.92 | 11.09 | 7.58 |
| Parade | `#f6c343` | `#f6c343` | 10.69 | 9.47 | 11.76 | 7.93 |
| Character_Meet | `#2f80ed` | `#5aa2ff` | 6.72 | 5.95 | 7.39 | 5.39 |
| Walkthrough | `#00897b` | `#2ec4b0` | 8.05 | 7.12 | 8.85 | 6.36 |
| PlayArea | `#43a047` | `#6fcf73` | 9.06 | 8.02 | 9.96 | 7.03 |
| Game | `#8e24aa` | `#d27ff0` | 6.71 | 5.94 | 7.38 | 5.34 |
| Tour | `#00897b` | `#2ec4b0` | 8.05 | 7.12 | 8.85 | 6.36 |
| Recreation | `#43a047` | `#6fcf73` | 9.06 | 8.02 | 9.96 | 7.03 |
| Spa | `#ec407a` | `#ff7eb3` | 7.42 | 6.57 | 8.16 | 5.83 |
| Event | `#8e24aa` | `#d27ff0` | 6.71 | 5.94 | 7.38 | 5.34 |
| Other | `#6b6480` | `#b3a8c9` | 7.81 | 6.92 | 8.60 | 6.06 |
| Resort | `#5b2a86` | `#c4a3ff` | 8.37 | 7.41 | 9.21 | 6.42 |
| resortVisual.tint | `#5b2a86` | `#c4a3ff` | 8.37 | 7.41 | 9.21 | 6.42 |

**Category fills (iteration 3, `CategoryVisual.fill`).** A tint is a bright foreground; behind
a white glyph it fails (dark white-on-tint is 2.09–2.61 for every category). The fill is the
solid tile colour behind a white glyph or white text. Light `fill === tint` (unchanged). Dark
fills reuse the `DARK_TONAL` fill of each hue family, except Game/Event (kept at light
`#8e24aa`), Other (`borderStrong` `#4a3a6b`) and Resort (`#5b2a86`) *(corrected in iteration
4)*. Floor: 4.5 (text) — every value also clears the 3.0 glyph floor.

| Category | Light fill (= tint) | Dark fill | White on dark fill | Light white-on-fill (pre-existing, unchanged) |
| --- | --- | --- | --- | --- |
| Ride | `#7e57c2` | `#7e57c2` (violet) | 5.21 | 5.21 |
| Show | `#e8505b` | `#c42b3c` (red) | 5.59 | 3.67 |
| Restaurant | `#f6a609` | `#b5520f` (orange) | 5.03 | 2.02 |
| Parade | `#f6c343` | `#9a5b00` (amber) | 5.43 | 1.64 |
| Character_Meet | `#2f80ed` | `#2563eb` (blue) | 5.17 | 3.87 |
| Walkthrough / Tour | `#00897b` | `#0e7490` (teal) | 5.36 | 4.32 |
| PlayArea / Recreation | `#43a047` | `#1f7a52` (green) | 5.30 | 3.30 |
| Game / Event | `#8e24aa` | `#8e24aa` (violet-magenta, same as light) | 7.04 | 7.04 |
| Spa | `#ec407a` | `#b8336f` (pink) | 5.61 | 3.76 |
| Other | `#6b6480` | `#4a3a6b` (neutral `borderStrong`) | 9.96 | 5.59 |
| Resort, resortVisual | `#5b2a86` | `#5b2a86` | 9.90 | 9.90 |

The light column is below 3.0 for Restaurant (2.02) and Parade (1.64) today, so 9 of 11 rows
clear the glyph floor *(corrected in iteration 4; earlier text said 8 of 11)*. That is pre-existing and stays unchanged (Requirement 9.2; see "Light-mode
accessibility fixes" in the spec's Out of Scope).

### `DARK_TONAL` ramp (for converting non-token literals)

`tint` = fg mixed 16 % over `#1e1430`; `border` = fg mixed 35 % over `#1e1430`.

| Family | fg | tint | border | fill | fg/surface | fg/surfaceAlt | fg/tint | textPrimary/tint | white/fill |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| violet | `#c4a3ff` | `#392b51` | `#584678` | `#7e57c2` | 8.37 | 7.41 | 6.12 | 11.26 | 5.21 |
| green | `#4cc38a` | `#25303e` | `#2e5150` | `#1f7a52` | 7.91 | 7.01 | 6.03 | 11.74 | 5.30 |
| amber | `#f5b83d` | `#402e32` | `#694d35` | `#9a5b00` | 9.86 | 8.73 | 7.13 | 11.15 | 5.43 |
| orange | `#ffa45c` | `#422b37` | `#6d463f` | `#b5520f` | 8.95 | 7.92 | 6.57 | 11.30 | 5.03 |
| red | `#ff7a7a` | `#42243c` | `#6d384a` | `#c42b3c` | 6.94 | 6.15 | 5.37 | 11.91 | 5.59 |
| pink | `#ff6b9a` | `#422241` | `#6d3255` | `#b8336f` | 6.53 | 5.78 | 5.09 | 12.00 | 5.61 |
| blue | `#5aa2ff` | `#282b51` | `#334678` | `#2563eb` | 6.72 | 5.95 | 5.18 | 11.87 | 5.17 |
| sky | `#7cc4ff` | `#2d3051` | `#3f5278` | `#0369a1` | 9.35 | 8.28 | 6.77 | 11.16 | 5.93 |
| teal | `#3cc9de` | `#23314c` | `#29536d` | `#0e7490` | 8.85 | 7.84 | 6.56 | 11.42 | 5.36 |

### Computed contrast — every text/surface pair in the dark palette

All ratios are WCAG 2.x relative-luminance ratios. They were computed during design with a
throwaway Node expression (nothing was committed). `theme/contrast.ts` + Property 9 re-check
them in CI.

| Pair (dark) | Ratio | Target | Result |
| --- | --- | --- | --- |
| textPrimary `#f3eefc` on background / surface / surfaceAlt | 16.94 / 15.40 / 13.64 | 4.5 | pass |
| textSecondary `#b3a8c9` on background / surface / surfaceAlt | 8.60 / 7.81 / 6.92 | 4.5 | pass |
| primaryFg `#c4a3ff` on background / surface / surfaceAlt | 9.21 / 8.37 / 7.41 | 4.5 | pass |
| success `#4cc38a` on background / surface / surfaceAlt | 8.71 / 7.91 / 7.01 | 4.5 | pass |
| danger `#ff6b9a` on background / surface / surfaceAlt | 7.18 / 6.53 / 5.78 | 4.5 | pass |
| warning `#f5b83d` on background / surface / surfaceAlt | 10.84 / 9.86 / 8.73 | 4.5 | pass |
| accent / starRating `#f6c343` on background / surface / surfaceAlt | 11.76 / 10.69 / 9.47 | 4.5 | pass |
| primaryLight `#b28dff` (as text) on surface / surfaceAlt / background (iteration 3) | 6.80 / 6.02 / 7.48 | 4.5 | pass |
| textOnPrimary `#ffffff` on primary `#7e57c2` (buttons, active chip) | 5.21 | 4.5 | pass |
| `#ffffff` on primaryDark `#2a1450` | 15.98 | 4.5 | pass |
| textOnAccent `#3d1c5c` on accent `#f6c343` / accentDark `#d4a017` | 8.43 / 5.82 | 4.5 | pass |
| warningText `#ffd27a` on warningSurface `#3a2c0e` | 9.54 | 4.5 | pass |
| textPrimary / textSecondary on warningSurface | 11.93 / 6.05 | 4.5 | pass |
| `#ffffff` header title on gradient stops `#5b2a86` / `#3b1d6e` / `#1a0d33` | 9.90 / 13.23 / 18.27 | 4.5 | pass |
| Header subtitle `rgba(255,255,255,0.82)` on `#5b2a86` / `#3b1d6e` | 7.22 / 9.32 | 4.5 | pass |
| Header eyebrow `#ffd54f` on `#5b2a86` / `#3b1d6e` | 7.02 / 9.38 | 4.5 | pass |
| Chip idle text textSecondary on surfaceAlt | 6.92 | 4.5 | pass |
| Selected row: primaryFg / textPrimary on primary 14 % over surface | 7.36 / 13.54 | 4.5 | pass |
| Danger secondary button: danger on `DARK_TONAL.pink.tint` | 5.09 | 4.5 | pass |
| Tab active `#f6c343` on tab bar `#170e27` | 11.35 | 3.0 (icon+label) | pass |
| Tab inactive `#8a7fa3` on `#170e27` | 5.00 | 3.0 | pass |
| Tab badge `#3d1c5c` on `#f6c343` | 8.43 | 4.5 | pass |
| Nav header text textPrimary / textSecondary on card `#170e27` | 16.35 / 8.29 | 4.5 | pass |
| **Disallowed:** `#ffffff` on success `#4cc38a` / danger `#ff6b9a` | 2.22 / 2.68 | 4.5 | **fail → conversion rule 4** |
| **Disallowed:** `#ffffff` on primaryLight `#b28dff` | 2.58 | 4.5 | **fail → primaryLight is never a fill behind body text (rule 1 / 1a palette pair)** |
| Hairline border `#33264d` / borderStrong `#4a3a6b` on surface (non-text, decorative) | 1.27 / 1.76 | — | Parity with light (`#e2d9f0` 1.36 / `#cdbce6` 1.76 on white). Not a regression. Dark cards rely on it, not on text contrast. |

### Additional used dark pairs (design-review iteration 2)

These pairs are used in the UI but weren't shown before. All pass. Every row is added to
`CONTRAST_REQUIREMENTS`, so Property 9 pins it. They were computed the same way as the tables
above.

**Badge text on its own 14 % tint, by the surface the badge sits on (floor 4.5):**

| Dark tint (used by) | over surface | over surfaceAlt | over background |
| --- | --- | --- | --- |
| `#b28dff` (MK, Ride, and `primaryLight` from iteration 3) | 5.39 | 4.71 | 6.14 |
| `#5aa2ff` (EPCOT, Character_Meet, blue fg) | 5.39 | 4.71 | 6.12 |
| `#ff7a83` (Hollywood Studios, Show) | 5.58 | 4.90 | 6.31 |
| `#5cc46a` (Animal Kingdom) | 6.29 | 5.57 | 7.16 |
| `#3cc9de` (Typhoon Lagoon, teal fg) | 6.90 | 6.02 | 7.77 |
| `#7cc4ff` (Blizzard Beach, sky fg) | 7.06 | 6.23 | 8.08 |
| `#ffb732` (Disney Springs, Restaurant) | 7.58 | 6.62 | 8.67 |
| `#f6c343` (Parade, accent) | 7.93 | 6.97 | 9.06 |
| `#2ec4b0` (Walkthrough, Tour) | 6.36 | 5.63 | 7.22 |
| `#6fcf73` (PlayArea, Recreation) | 7.03 | 6.13 | 7.92 |
| `#d27ff0` (Game, Event) — **minimum** | 5.34 | **4.66** | **6.07** |
| `#ff7eb3` (Spa) | 5.83 | 5.10 | 6.64 |
| `#b3a8c9` (Other) | 6.06 | 5.34 | 6.90 |
| `#c4a3ff` (Resort, resortVisual, primaryFg default Badge) | 6.42 | 5.59 | 7.33 |

**Park accents as text or icons, against the other surfaces (floor 4.5; the category table
already covers category tints):**

| Park | vs surfaceAlt | vs background |
| --- | --- | --- |
| Magic Kingdom `#b28dff` | 6.02 | 7.48 |
| EPCOT `#5aa2ff` | 5.95 | 7.39 |
| Hollywood Studios `#ff7a83` | 6.18 | 7.68 |
| Animal Kingdom `#5cc46a` | 7.07 | 8.78 |
| Typhoon Lagoon `#3cc9de` | 7.84 | 9.74 |
| Blizzard Beach `#7cc4ff` | 8.28 | 10.28 |
| Disney Springs `#ffb732` | 8.92 | 11.09 |

**`DARK_TONAL` secondary-text and background pairs (floor 4.5):**

| Family | textSecondary on `.tint` | `.fg` on background |
| --- | --- | --- |
| violet | 5.71 | 9.21 |
| green | 5.96 | 8.71 |
| amber | 5.66 | 10.84 |
| orange | 5.73 | 9.84 |
| red | 6.04 | 7.64 |
| pink | 6.09 | 7.18 |
| blue | 6.02 | 7.39 |
| sky | 5.66 | 10.28 |
| teal | 5.80 | 9.74 |

**Selected row** (primary at 14 % over surface = `#2b1d44`): textSecondary 6.87, primaryFg
7.36, textPrimary 13.54. The same row over surfaceAlt: primaryFg 6.47.

**Pin tier text** (`TIER_TEXT.dark`, rule 7; badge text on its 14 % tint; floor 4.5):

| Tier | Light = `TIER_COLOR` | Dark | on surface | badge over surface | badge over surfaceAlt | badge over background |
| --- | --- | --- | --- | --- | --- | --- |
| bronze | `#c97f4a` | **`#e0965f`** (was 4.02 over surfaceAlt) | 7.26 | 5.77 | 5.06 | 6.50 |
| silver | `#b0b9c8` | `#b0b9c8` | 8.86 | 6.78 | 5.89 | 7.66 |
| gold | `#e5ab2c` | `#e5ab2c` | 8.51 | 6.63 | 5.80 | 7.47 |
| amethyst | `#8a45c9` | **`#c08ff5`** (was 2.79 over surface) | 7.09 | 5.58 | 4.88 | 6.33 |
| pearl | `#c2bcdd` | `#c2bcdd` | 9.63 | 7.18 | 6.32 | 8.21 |
| prism | `#c9a8ff` | `#c9a8ff` | 8.79 | 6.66 | 5.86 | 7.61 |
| mythic | `#ffb347` | `#ffb347` | 9.84 | 7.44 | 6.50 | 8.44 |

The `#c08ff5` amethyst keeps the tier's violet hue, lifted to read on the night surfaces. The
`#e0965f` bronze keeps the copper hue.

Light reference values are unchanged by design. They're recorded so nobody "fixes" them in
this change:

- textPrimary on bg 15.86
- textSecondary on surface / bg / surfaceAlt: 5.59 / 5.05 / 4.70
- white on primary 9.90
- tab inactive `#6b7280` on white 4.83
- **light tab badge white on `#d97706` 3.19** (pre-existing; kept to honor "light unchanged";
  flagged for a future light-mode accessibility pass)

### Iteration 3 pairs (design-review iteration 3)

Every row is recomputed with the WCAG 2.x formula (stdin `node -`, nothing written) and added
to `CONTRAST_REQUIREMENTS`, so Property 9 pins it.

**`primaryLight` as `Badge` text on its own 14 % tint** (4 sites, e.g.
`TripReservationsScreen.tsx:872`, `TripScheduleScreen.tsx:1552,1595`; floor 4.5):

| Dark primaryLight | over surface | over surfaceAlt | over background |
| --- | --- | --- | --- |
| `#9d7ae0` (old, rejected) | 4.34 | 3.81 | 4.89 |
| **`#b28dff`** (chosen) | 5.39 | 4.71 | 6.14 |

**Rule 1a sites (floor 4.5):**

| Pair (dark) | Straight substitution | Converted |
| --- | --- | --- |
| `MarkGottenUndoToast` message / Undo on toast bg | `#ffffff` / `#f6c343` on `#f3eefc`: 1.14 / 1.44 | on `#1f1235`: 17.56 / 10.71 |
| `TripReservationsScreen` active chip text on `primary` `#7e57c2` | `#1e1430`: 3.36 | `#ffffff`: 5.21 |

**Category fills:** see "Category fills" above (white on every dark fill 5.03–9.96, floor 4.5).

**Non-text graphics (WCAG 1.4.11, Requirement 7.5; floor 3.0):**

| Element (dark) | Against | Before (iteration 2) | Iteration 3 |
| --- | --- | --- | --- |
| `RatingHistogram` bar stops (`gradient.chartBar`) | card `#1e1430` | 1.77 / 1.32 / 1.04 (`headerVivid`) | 8.37 / 5.25 / 3.36 |
| `ProgressBar` default fill (`primaryFg`) | track `surfaceAlt` `#2a1d42` | 2.98 (`primary`) | 7.41 |
| `ProgressRing` default arc stops (`primaryLight`, `primaryFg`) | track `surfaceAlt` | 4.65 / 2.98 | 6.02 / 7.41 |
| `ProgressBar` complete fill `gradient.gold` | track `surfaceAlt` | 9.47 / 6.53 | unchanged |
| `PrimaryButton` gradient stops (`gradient.header`) | card `#1e1430` | 1.32 / 1.04 | 3.36 / 3.02 |
| `PrimaryButton` gradient stops (`gradient.header`) *(iteration 4)* | screen `background` `#120a1f` | 1.46 / 1.06 | 3.70 / 3.32 |
| Chip active fill (`primary` `#7e57c2`) *(iteration 4)* | card `surface` / screen `background` | unchanged | 3.36 / 3.70 |
| `PrimaryButton` white label on stops | — (floor 4.5) | 13.23 / 18.27 | 5.21 / 5.80 |
| `MagicFab` disc stops (`gradient.fab`) | ring `surface` `#1e1430` | 1.77 / 1.32 / 1.04 | 5.25 / 3.36 / 3.02 |
| `MagicFab` white glyph on disc stops | — (icon floor 3.0) | 9.90 / 13.23 / 18.27 | 3.34 / 5.21 / 5.80 |

The `PrimaryButton` and FAB end stop `#7650b9` was chosen over the reviewer's `#6d45b0` (2.61
vs card, below 3.0). Among the candidates checked on the same violet ramp, it was the deepest
one that still clears 3.0 against `#1e1430` (3.02; `#744eb6` is 2.93),
while keeping white at 5.80. Light values are unchanged: `PrimaryButton` keeps
`['#5b2a86','#3d1c5c']` (white 9.90 / 13.82), and the FAB and histogram keep
`['#7e57c2','#5b2a86','#3d1c5c']`.

**Scope of criterion 7.5 (iteration 4).** "The background they sit on" means `surface` (a
card) or `background` (the screen). A `PrimaryButton` is not placed on `surfaceAlt`. Against
`surfaceAlt` `#2a1d42` the stops would be 2.98 / 2.67 and the Chip-active fill 2.98, below
3.0, so those pairs are recorded here but are not floors. A `PrimaryButton` and an active
`Chip` are identified by their text label, which meets 4.5:1 on the fill, and WCAG 1.4.11
exempts a component identified by its text. As a backstop, a batch that finds a
`PrimaryButton` or active `Chip` rendered directly on a `surfaceAlt` container lists it in its
report (DoD item 8), and the integrator decides whether to move it. The `background` rows
above join `CONTRAST_REQUIREMENTS` at min 3.0.

### Deviations from the brief's palette (iteration 3)

The brief fixed the dark palette, and also fixed the contrast targets ("body and secondary
text at least WCAG AA 4.5:1"). Where the two conflict, the contrast target wins, and the change
is the smallest one that clears it. Every light value is unchanged, and no colour key was
added besides `primaryFg`:

| Token | Brief dark value | Design dark value | Why |
| --- | --- | --- | --- |
| `primaryLight` | `#9d7ae0` | `#b28dff` | Badge text on its tint is 4.34 / 3.81 over surface / surfaceAlt (fails 4.5). `#b28dff` is the MK/Ride tint already in the palette. |
| `gradient.header` | `['#3b1d6e','#1a0d33']` | `['#7e57c2','#7650b9']` | Its only consumer is `PrimaryButton`. The brief's stops are 1.32 / 1.04 against the card, so the primary CTA disappears. The new stops match dark `primary`/Chip-active. |

Two new gradient keys (`fab`, `chartBar`) and one new `CategoryVisual` field (`fill`) are added
instead of changing more brief values. The data-mark fix reuses `primaryFg` rather than adding
a colour token, so the brief's "one new token" constraint holds. `headerVivid` keeps the
brief's dark value, because white header text on it is 9.90 or better and it is a background,
not a mark.

### Commands and env

| Name | Value | Use |
| --- | --- | --- |
| `THEME_GUARD_STRICT` | comma-separated batch ids, e.g. `B4` | Batch self-check of the guard during W2. It is removed with `PENDING_RETROFIT` in spec task 10.1. |
| Jest workers during W2 | `--maxWorkers=2` | Seven concurrent batches on one machine |
| Emulator | AVD `Pixel_7`, `adb` at `C:\Users\knick\dev\android\platform-tools\adb.exe` | Spec tasks 7.1 and 11 |
| Screenshot dir | `.agents/tasks/dark-mode-retrofit/screenshots/` | Baseline, light and dark PNGs |

## External Interfaces

These are library contracts this design relies on. Each was verified against the installed
packages, not assumed.

- **`@react-navigation/native@6.1.18` `Theme`.** The shape is
  `{ dark: boolean; colors: { primary, background, card, text, border, notification } }`, with
  no `fonts` field (that's v7). `DefaultTheme`'s `card` is `rgb(255, 255, 255)` and its
  `border` is `rgb(216, 216, 216)`, read from `src/theming/DefaultTheme.tsx`.
- **`@react-navigation/bottom-tabs@6.6.1`.** The tab bar background is `colors.card` and the
  top border is `colors.border` (`BottomTabBar.tsx` lines 262–263). Options used:
  `tabBarActiveTintColor`, `tabBarInactiveTintColor`, `tabBarBadgeStyle`.
- **`react-native-calendars@1.1314.0`.** The `theme` prop is captured once with `useRef`, so a
  remount is needed (`key={t.scheme}`).
- **`@react-native-async-storage/async-storage@2.2.0`.** It throws at import without the native
  module. The jest mock is the default export from `jest/async-storage-mock.js` (as task 1.1
  established).
- **`@react-native/jest-preset`.** `useColorScheme` is mocked to return `'light'`.
- **`expo-linear-gradient`.** `colors` accepts a readonly tuple of at least two entries
  (current usage already passes `as const` tuples).
- **Expo `userInterfaceStyle: 'automatic'`** is already set in `apps/mobile/app.config.ts`.
  Per Expo's documentation (not verified in this repo), the OS-scheme-follow on Android
  standalone builds also needs `expo-system-ui`. That doesn't block this change: a pinned
  **Dark** preference doesn't depend on the OS scheme, and Expo Go supports `automatic`. Adding
  `expo-system-ui` is a native dependency and stays out of scope.

## Cross-Spec Dependencies and Build Order

- This change builds on the existing `dark-mode` spec Tasks 1–6 (all complete), and on nothing
  else.
- **Build order:** spec task 7 (foundation, plus the light baseline screenshots) → 8 (kit,
  chrome and guard) → 9.1–9.7 (in parallel) → 10 (legacy removal and steering) → 11 (visual
  verification) → 12 (`npm run verify`).
- **Pin-collection spec:** no pin artwork, motif, catalogue or mockup file is touched, so the
  pin gate (`node .kiro/specs/pin-collection/verify/run-all.js`) is not required. Pin UI screens
  are app code covered by `npm run verify`.
- **Steering:** the `.kiro/steering/tech-conventions.md` Mobile conventions bullet is updated
  in spec task 10.2. It names `useAppTheme`/`makeStyles`/`definePalette`, the conversion rules,
  and the guard.

## Risks and Open Points

- **Unstyled `Text` / `TextInput`.** RN's default text colour is black, and no regex guard can
  catch an unstyled `Text`. The mitigations are `t.textDefault` (dark-only), the per-batch
  checklist item, and the screenshot pass.
- **Visual verification needs a signed-in test account and a reachable backend.** If neither is
  available at spec task 7.1 or 11, the executor pauses and asks the user. It doesn't skip.
- **Seven concurrent batches in one tree.** Typecheck output will include other batches'
  in-flight errors. Ownership is by file, and only the W3 full gate proves the combined tree.
- **Calendar remount** on a scheme switch resets the visible month. That's accepted, since
  switching appearance while a picker is open is rare.
- **Default-text and memo rules need judgement at the call site.** "Effective background" and
  "reads `styles` in its body" are decided by reading the JSX and closures, which no regex can
  do. The backstops are Property 20, test (d) per batch, the batch report's list of touched
  memo/list sites, and the screenshot pass.

## Design Review Responses (iteration 2)

These respond to `design-review.md` / `design-review.json` (verdict CHANGES_REQUESTED: 0 HIGH,
6 MEDIUM, 8 NIT). Every finding is addressed. None is backlogged or ignored. The same fixes are
mirrored into `.kiro/specs/dark-mode/` additively.

1. **MEDIUM. Rule 1 role gaps (non-black `shadowColor`, white rings, `#3d1c5c` borders).**
   Addressed.
   - New rule 0 handles every non-black `shadowColor`: `#3d1c5c` → `t.shadow.card.shadowColor`,
     other hex → `{light: original, dark: '#000000'}`, and chromatic rgba →
     `rgba(0, 0, 0, a)`.
   - Rule 1 gains these rows: `#ffffff` border or ring → `surface` on themed surfaces and
     `textOnPrimary` on gradients/images/H; `#3d1c5c`/`#5b2a86` as text, icon or border on a
     surface → `primaryFg`; and `#7e57c2` text vs fill.
   - Every token value now maps only in its natural role. Anything else falls to rule 3.
   - Rules are applied in order, and the first match wins.
2. **MEDIUM. Neutral-band holes, and the two documents conflicting.** Addressed, with one
   identical rule in both files:
   - T: L < 0.12 → `textPrimary`, otherwise `textSecondary`.
   - S: lavender-subtle entries, plus neutrals with L ≥ 0.70 → `surfaceAlt`; otherwise
     `borderStrong`.
   - B/F unchanged.
   - The listed lavender-subtle literals always count as neutral.
3. **MEDIUM. Tier colours as UI text fail dark contrast.** Addressed.
   - New rule 7, plus B6's `screens/profile/tierText.palette.ts` (`TIER_TEXT`: light =
     `TIER_COLOR`, dark amethyst `#c08ff5`, bronze `#e0965f`). The other five tiers already
     pass, recomputed at ≥ 5.80 over surfaceAlt.
   - New Requirement 9.9 and Property 21. `pinTierMeta.ts` stays unedited and allowlisted.
     Dots, fills and swatches keep `TIER_COLOR`.
   - The ratios are in Configuration & Constants and `CONTRAST_REQUIREMENTS`.
4. **MEDIUM. Memoized consumers won't repaint live.** Addressed.
   - New binding "Memoized and virtualized consumers" rules: deps include `styles`/`t`/palette;
     no colours in `useRef`; `extraData` includes `t.scheme`; and `React.memo` handling.
   - New Requirement 8.5 and Property 20, a probe with a control variant that must fail.
   - Per-batch test (d) on a designated screen. Each screen was verified to have an existing
     render test, and B4 has no `FlatList` screen, so it uses `TripScheduleScreen`.
   - Batch DoD item 4 and the report list touched sites.
5. **MEDIUM. `textDefault` breaks nested Text and text on invariant backgrounds.** Addressed.
   - New "Default-text rule" with three conditions: no colour, not nested in `Text`, and a
     themed effective background.
   - The TextInput bullet references it.
   - Requirement 9.7 gets an additive amendment note with the same exclusions, and Property 19
     gains the exclusion cases.
6. **MEDIUM. Test ownership ambiguous; B7 can't edit `orderingDeterminism.prop.test.ts`.**
   Addressed.
   - Exact rule: a test in `__tests__/` whose first dot-separated segment equals an owned
     basename.
   - B7 now explicitly owns all `screens/stats/**/__tests__/` and `__testSupport__/` files,
     `consumerSurfacesTaxonomy.test.ts`, and `shareEntryPointProjection.prop.test.tsx` (the
     last one also imports `statsView`, found by grep).
   - Other failing unowned tests are stop-and-report.
7. **NIT. "23 values".** Addressed. It now reads 21 in the spec design.
8. **NIT. `destinationVisuals.ts` ownership wording.** Addressed with the reviewer's wording,
   plus a note that B6 creates `tierText.palette.ts` without editing `pinTierMeta.ts`.
9. **NIT. Used-but-unshown passing pairs.** Addressed. The new "Additional used dark pairs"
   tables cover badge over surfaceAlt/background (minimum 4.66 / 6.07), park accents vs
   surfaceAlt/background, textSecondary on tonal tints (minimum 5.66), tonal fg on background
   (minimum 7.18), and the selected row (6.87 / 7.36 / 6.47). All were recomputed and all
   join `CONTRAST_REQUIREMENTS`.
10. **NIT. `staticImport` not a concrete regex; namespace bypass.** Addressed.
    - Exact `STATIC_IMPORT_RE`/`NAMESPACE_IMPORT_RE`/`FORBIDDEN_THEME_IMPORTS`, with
      specifier splitting and `type`/`as` stripping. Matching runs over the whole source, so
      multi-line imports are caught.
    - A new `namespaceImport` rule is allowlisted only for `THEME_INTERNALS`.
    - Property 15's generators cover these forms.
11. **NIT. Redundant veil choice.** Addressed. A white veil on a themed surface →
    `withAlpha(t.color.surface, a)`. On a gradient, image or scrim it stays literal.
12. **NIT. `withAlpha` throws while `Badge` accepts any string.** Addressed by widening
    `withAlpha` to 3/6/8-digit hex, `rgb()` and `rgba()` (alpha replaced). Property 14 asserts
    that every token and palette value parses. This option was chosen over a hex-only rule
    because palette values legitimately include `rgba(...)` (rules 0 and 2).
13. **NIT. OS scheme not mockable via `themeTestUtils`.** Addressed.
    - Specified the descriptor-copy `useColorScheme` mock already proven in
      `useActiveTheme.test.tsx`. The reviewer's spread form crashes on RN 0.85.3's lazy
      `DevMenu` getter, as that test's header documents.
    - Added `setTestOsScheme` with a fail-loud guard.
    - Properties 10/17 reference it.
14. **NIT. Counts.** Addressed. The family table is "71 most frequent", and the unverified
    occurrence total was dropped. The per-file AsyncStorage mocks are 15, re-counted with a
    repo search.

**Unverified after iteration 2.** No `tsc` or Jest was run: this is a design step, and no
source was edited. The Kiro spec-format validator can't be invoked from here. Structural
checks were re-run instead (see the step report). The new contrast numbers come from stdin
`node -` expressions using the WCAG 2.x formula, and no files were written.

## Design Review Responses (iteration 3)

These respond to `design-review.md` / `design-review.json` iteration 3 (CHANGES_REQUESTED:
0 HIGH, 5 MEDIUM, 8 NIT). Every finding is addressed, and none is backlogged or ignored. Two
adopt a different value than the reviewer proposed, with the reason given. Every fix is
mirrored into `.kiro/specs/dark-mode/` additively. Every reviewer ratio was recomputed and
reproduces.

1. **MEDIUM. Out-of-role token reads.** Addressed with new **rule 1a**, using the reviewer's
   mapping plus two clarifications:
   - `primaryLight` as a fill behind white → the violet palette pair;
   - any other out-of-role read → rule 3 with the light value.
   - The inverse toast also spreads `t.outline.card`, because `#1f1235` on the dark
     background is only 1.10:1 as a shape. Light is unchanged.
   - New Requirement 9.10 and Property 22.
   - Correction to the review: `MarkGottenUndoToast` **does** have its own test
     (`foodLists/__tests__/MarkGottenUndoToast.test.tsx`, B3 by the first-segment rule), so
     the dark case goes there. `TripReservationsScreen.test.tsx` (B5) gets the chip case.
2. **MEDIUM. `primaryLight` badge text.** Addressed as proposed. Dark `primaryLight` →
   `#b28dff` (6.80 on surface; badge 5.39 / 4.71 / 6.14).
   - Updated rule 1's ratio (6.80), the disallowed row (white 2.58) and the iteration-3 pair
     table.
   - Added the pairs to `CONTRAST_REQUIREMENTS`, plus a 7.4 amendment note.
   - Recorded as a brief deviation in "Deviations from the brief's palette".
3. **MEDIUM. Category tints as fills.** Addressed as proposed.
   - `CategoryVisual.fill`: light === tint, dark from the reviewer's table, all recomputed
     (white 5.03–9.96).
   - Rule 1's category bullet split into tint vs fill, with the four tile sites named.
   - Properties 7 and 8 extended, Property 22 added, and new Requirement 9.11.
   - The light white-on-fill column is recorded as pre-existing (Restaurant 2.02, Parade 1.64).
4. **MEDIUM. Non-text graphics.** Addressed, with two deliberate differences from the review:
   - **No `color.dataFill` token.** The brief allows exactly one new colour token
     (`primaryFg`). A data mark is a primary-hued foreground on a surface, which is
     `primaryFg`'s role, and `primaryFg`'s light value equals `primary`'s.
     - `ProgressBar` fill → `primaryFg` (7.41 vs track).
     - `ProgressRing` arc → `[primaryLight, primaryFg]` (6.02 / 7.41).
     - Light is byte-identical. Requirement 9.3 gets a "data marks" amendment note.
   - **End stop `#7650b9`, not `#6d45b0`,** for `gradient.header` and `gradient.fab`.
     `#6d45b0` is only 2.61:1 against the card, which still fails the floor this finding sets.
     `#7650b9` is 3.02 against the card with white at 5.80.
   - `gradient.chartBar` adopted as proposed (8.37 / 5.25 / 3.36). `gradient.fab` dark is
     `['#9d7ae0','#7e57c2','#7650b9']`, with the white glyph at 3.34 / 5.21 / 5.80.
   - New criterion 7.5, and Properties 9, 13 and 16 extended.
   - The `gradient.header` dark change is recorded as a brief deviation.
5. **MEDIUM. Light-parity audit procedure.** Addressed. The **light-colour multiset audit** is
   specified as a stdin `node -` procedure in DoD item 2. It includes:
   - an esbuild-transform loader that resolves real `lightTheme`/palette values with no
     file written (`theme.ts` imports `react-native`, so plain `require` can't load it);
   - exact extraction regexes, symbolic `[*]` handling for computed indexes, normalisation,
     and a pass/fail rule;
   - a justification requirement for every difference.

   It applies to W1 (tasks 8.1–8.3) and every W2 batch. The same text is in the spec design
   and task 9's Done-when. The Testing Strategy now states that existing light assertions are
   a thin secondary net.
6. **NIT. Template-literal alpha.** Addressed with rule 2a (verbatim) and Property 7's
   `/^#[0-9a-f]{6}$/` assertion on every `color.*`.
7. **NIT. `withAlpha` format.** Addressed. The output is pinned to
   `` `rgba(${r}, ${g}, ${b}, ${alpha})` ``, and Property 8 asserts
   `withAlpha('#5b2a86', 0.14) === 'rgba(91, 42, 134, 0.14)'`.
8. **NIT. Spec leans on the `.agents` file.** Addressed. The "Additional used dark pairs"
   tables, the category-fill table, the iteration-3 pair tables and the deviation table are
   copied into the spec design's Configuration & Constants. Task 7.6 points at the spec
   section.
9. **NIT. Property 13 title.** Addressed. Both documents use "Tab Bar and MagicFab Follow the
   Active Theme".
10. **NIT. Historical spread-form mock.** Addressed with additive "Superseded" notes under the
    spec design's Tasks 1–6 snippet and under tasks.md 3.2.
11. **NIT. W1 test ownership.** Addressed with the first-segment rule for W1 plus an explicit
    list.
    - Correction: there is no `MagicFab*.test.tsx`. The MagicFab/QuickActionSheet test is
      `quickActionComponents.test.tsx`, and the AttentionBadge/NotificationBell test is
      `notificationNavigation.test.tsx`. Both are now explicitly W1-owned.
12. **NIT. `Theme` type.** Addressed. Task 10.1 removes `export type Theme`; use `AppTheme`.
13. **NIT. Aliased `theme as T`.** Addressed. `staticImport` flags `/^theme\s+as\s+\w+$/`
    specifiers, and Property 15 has the fixture.

**Unverified after iteration 3.** No `tsc` or Jest was run: this is a design step, and no
source was edited. The Kiro spec-format validator can't be invoked from here. Equivalent
structural checks were run on the spec (see the step report). The audit loader was
smoke-tested read-only against today's `theme/theme.ts` via stdin `node -`: it loaded the
module and returned `theme.color.primaryLight === '#7e57c2'` and the `headerVivid` stops. It
has not been run against the post-7.2 `theme.ts` (which adds the `react-native` import that
the stub covers) or against any palette file, because neither exists yet.

## Design Review Responses (iteration 4)

These respond to `design-review.md` / `design-review.json` iteration 4 (CHANGES_REQUESTED:
0 HIGH, 1 MEDIUM, 4 NIT). All five are addressed, none is backlogged or ignored, and each fix
is mirrored into `.kiro/specs/dark-mode/` additively.

1. **MEDIUM. Audit misses real read forms.** Addressed in DoD item 2, the spec design's audit
   (same text) and task 9's Done-when:
   - `before(F)` adds `IMPORTS(S)` (from the guard's `STATIC_IMPORT_RE`, `as` aliases
     honoured) and counts bare reads `/(?<![\w.])(N)((?:\.\w+)+)/g` plus their `[*]` computed
     forms. An aliased `theme as Alias` replaces `theme` in the legacy regex.
   - `after(F)` adds `ALIASES(F)` from
     `/const\s+(\w+)\s*=\s*(?:usePalette\((\w+)\)|(\w+)\[t\.scheme\])\s*(?:;|$)/gm`. I
     changed the reviewer's mandatory `;` to `(?:;|$)` with `m`, so a no-semicolon line still
     matches but `const x = P[t.scheme].k;` doesn't become an alias. Every palette computed
     read is recorded as `P[*]`.
   - rgb()/rgba() are normalised numerically with `Number()` (`rgb()` → `rgba(…,1)`).
   - Exempt literals are counted on both sides. A new exempt literal is a listed difference.
   - The palette read-form sentence is now in this design's consumer pattern, with the alias
     form, and the same extended sentence is in the spec design. Destructuring a palette
     record is disallowed, since the audit can't see destructured keys.
   - Added a "shadowed local" justification for a bare-name false match.
2. **NIT. Rule 2a too narrow.** Addressed. Rule 2a now covers any token, park accent, category
   tint/fill, tier colour, palette value or local holding one, written `` `${X}NN` `` or
   `X + 'NN'`, with the three real sites named. Rule 3 gains the `#rrggbb`-in-both-schemes
   constraint for suffixed palette values, and DoD item 8 makes the batch list those sites.
   Property 7's 6-digit check now covers `parkAccent`, `categoryVisual` tint/fill and
   `resortVisual` tint/fill. Every value in the existing tables already satisfies it.
3. **NIT. Category-fill prose.** Addressed: "9 of 11" with Restaurant 2.02 and Parade 1.64
   named, and the `DARK_TONAL` sentence now names the Game/Event, Other and Resort exceptions.
   The spec design gets the same wording.
4. **NIT. 7.5 scope.** Addressed with both options the reviewer offered. New table rows:
   `PrimaryButton` stops vs `background` 3.70 / 3.32, and Chip-active `primary` vs
   `surface`/`background` 3.36 / 3.70. They're added to `CONTRAST_REQUIREMENTS` (Property 9,
   task 7.6). A scope paragraph and a 7.5 amendment note limit "the background they sit on"
   to `surface`/`background`, and DoD item 8 makes batches report any `PrimaryButton` or
   active `Chip` on `surfaceAlt`. I recomputed all values with stdin `node -`: `#7e57c2`
   3.70 bg / 3.36 surface / 2.98 surfaceAlt; `#7650b9` 3.32 / 3.02 / 2.67. The old stops vs
   `background` are 1.46 / 1.06.
5. **NIT. Task 7.6 pointer.** Addressed. The original sentence is kept, with
   "(superseded by the iteration-3 note below)" placed before the `.agents` path.

**Unverified after iteration 4.** No `tsc` or Jest was run, because no source was edited.
The new audit regexes were smoke-tested read-only with stdin `node -`. `IMPORTS` found
`color` in `NotificationBell.tsx`/`AvatarChip.tsx` (bare read `color.textOnPrimary`) and
`categoryVisual` in `ExperienceListDetailScreen.tsx`/`ExperiencePicker.tsx` (`categoryVisual[*]`).
The alias regex accepted `const pal = usePalette(P);` and `const q = P[t.scheme]` and rejected
`const bad = P[t.scheme].k;`. Numeric normalisation mapped both `0.10` and `0.1` to
`rgba(91,42,134,0.1)`.

## Design Review Responses (iteration 5)

These respond to `design-review-final.md` / `design-review-final.json` (CHANGES_REQUESTED:
0 HIGH, 1 MEDIUM, 1 NIT). Only the MEDIUM was in scope for this round; no settled decision
(palette, `useAppTheme`/`makeStyles`, batch decomposition) was reopened, and nothing was
deleted or renumbered.

1. **MEDIUM. `after(F)` double-counts the `t.<path>` inside a numeric `withAlpha`.**
   Addressed with the reviewer's text. The `withAlpha` bullet of `after(F)` now carries the
   explicit regex
   `/withAlpha\(\s*t\.((?:GROUPS)(?:\.\w+)+)\s*,\s*(\d*\.?\d+)\s*\)/g` (a = `Number(group 2)`)
   and removes every matched span from F before the `t.<GROUPS>` read regex runs, so the
   call contributes only its rgba value. A `withAlpha` with a non-numeric alpha keeps its
   `t.<path>` as an ordinary read. The audit notes gain the fixture
   `withAlpha(t.color.primary, 0.10)` → exactly `rgba(91,42,134,0.1)` (and a rule-5 veil
   contributes no extra `#ffffff`). Mirrored word for word into the spec design's audit
   block, plus an iteration-5 bullet in task 9's Done-when and in tasks.md Notes. Smoke-tested
   read-only with stdin `node -`: `withAlpha(t.color.primary, 0.10), c: t.color.primary`
   yields one `withAlpha` entry and one ordinary `color.primary` read;
   `withAlpha(t.color.surface,.5)` yields only its `withAlpha` entry;
   `withAlpha(t.color.primary, alpha)` yields only an ordinary read.
2. **NIT. 7.5 scope sentence too broad.** Backlogged, not changed this round. This step's
   brief limits the final round to HIGH/MEDIUM findings. The reviewer confirms nothing is
   broken: the design already asserts the stronger `primaryFg`/`primaryLight` vs
   `surfaceAlt` track pairs (7.41 / 6.02) in `CONTRAST_REQUIREMENTS`. Recommended wording
   for a later pass: "For the primary button gradient and the active `Chip` fill, 'the
   background they sit on' means `surface` or `background`. Chart marks and progress fills
   are measured against the element they are drawn on (the card, or the `surfaceAlt`
   track)."

**Unverified after iteration 5.** No `tsc` or Jest was run, because no source was edited.
