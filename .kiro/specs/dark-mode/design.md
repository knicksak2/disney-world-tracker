# Design Document

## Overview

This feature adds a device-local **Appearance** preference (`system`/`light`/`dark`) to the
mobile App, resolved against the OS color scheme into an **Active theme**, and wires that Active
theme into the three chrome surfaces that are already structurally theme-aware today: React
Navigation's `theme` prop, `expo-status-bar`'s `style`, and the root safe-area background. The
preference itself is a new Zustand store (`themeStore`), persisted via a new
`@react-native-async-storage/async-storage` dependency, mirroring the existing `sessionStore`'s
shape and persistence-helper pattern (`api/sessionStorage.ts`) exactly — same store shape
(`value`, `hydrated`, a setter, `loadFromStorage`), same "thin I/O wrapper module + store module"
split, same one-time `loadFromStorage()` call from `App.tsx`.

**Retrofit-scope decision (binding for this spec).** `theme/theme.ts` exports one frozen `theme`
object built once at module load from static hex values; `theme/components.tsx` and
`theme/charts.tsx` build their `StyleSheet.create({...})` calls from those same static values,
also once, at module load — there is no context/hook seam today, and 135 of 239 `apps/mobile/src`
files import `theme`/`color` this way (plus 15 files with hardcoded hex literals and no theme
import at all: `avatars/AvatarPresets.tsx`, `components/pins/{pinArt.ts, pinRenderModel.ts,
pinTierMeta.ts, PinView.tsx}`, `features/notifications/AttentionBadge.tsx`,
`navigation/RootNavigator.tsx`, `screens/catalog/{destinationVisuals.ts, FloatingActionDock.tsx,
LensSwitcher.tsx, LocationGroupSection.tsx, QuickSpecsRow.tsx, ResortGuideSection.tsx,
VirtualQueueBanner.tsx}`, `theme/components.tsx` itself for a few one-off `rgba(255,255,255,…)`
overlay tints). Converting every one of those consumers to a dynamic, theme-aware source and
designing the actual dark palette's hex values is a substantial, separate body of work with its
own visual-design decisions (every screen's look is on the line) that cannot be done silently as
a side effect of "add a preference toggle." Per requirements.md's Introduction and Out of Scope,
**this spec builds the full preference mechanism and the chrome-level wiring it owns outright
(Navigation theme, status bar, root safe-area background) but does not retrofit any per-screen
`StyleSheet`.** The follow-up spec that does so can build directly on this one's `useActiveTheme()`
hook without any changes to this spec's surface.

**Superseding note — dark-mode retrofit amendment (Requirements 7–12).** The per-screen
retrofit and the dark palette deferred above are now in scope, in this same spec. The paragraph
above is kept for history.

The retrofit adds four things:

- typed light/dark token sets ("Twilight") in `theme.ts`
- `useAppTheme()` / `usePalette()` / `makeStyles()` so styles are built at render time from the
  Active theme
- conversion of the shared kit, the navigation chrome and every screen (seven parallel batches
  with disjoint files)
- a structural regression guard

Light mode stays byte-identical. Everything this spec built for Requirements 1–6 is reused
unchanged, except two small edits: `DARK_ROOT_BACKGROUND` becomes `#120a1f`, and the dark
navigation theme is now token-built instead of stock `DarkTheme`.

The retrofit design is in the sections marked **(Retrofit)** below. The full working design,
including computed contrast tables and the per-batch file lists, is mirrored in
`.agents/tasks/dark-mode-retrofit/design.md`. **This file is authoritative if the two differ.**

## Architecture

```
AsyncStorage (device)
      │  key: 'dwt.appearance.preference'  (raw string, no JSON wrapper)
      ▼
appearanceStorage.ts  ── thin I/O wrapper (get/set), mirrors api/sessionStorage.ts
      │
      ▼
themeStore.ts (Zustand)  ── { preference, hydrated, setPreference, loadFromStorage }
      │                      mirrors state/sessionStore.ts's shape exactly
      ▼
useActiveTheme() hook  ── combines themeStore.preference + RN's useColorScheme()
      │                   via the pure resolveActiveTheme() function
      ▼
App.tsx  ── NavigationContainer theme=..., StatusBar style=..., root background
      │
      ▼
AppearancePreferenceControl.tsx  ── Profile screen control, reads/writes themeStore directly
```

`appearance.ts` holds every pure, I/O-free function and the enum type (property-testable in
isolation); `appearanceStorage.ts` is the only module that imports `@react-native-async-storage/
async-storage` (so tests mock exactly one module boundary, matching `api/sessionStorage.ts`'s
isolation of `expo-secure-store`); `themeStore.ts` is the only Zustand store; `useActiveTheme.ts`
is the only module that calls React Native's `useColorScheme()`.

### Retrofit Architecture (Requirements 7–11)

```
useActiveTheme() (unchanged) ──► theme/useAppTheme.ts: useAppTheme() = themes[active]
                                                      usePalette(p)  = p[active]
theme/theme.ts (pure): lightTheme / darkTheme / themes, definePalette, DARK_TONAL,
                       withAlpha, categoryMeta, static spacing/radius/layout/typography
theme/makeStyles.ts: makeStyles((t) => styles) → useStyles()  (StyleSheet.create once per scheme, lazily)
     │
     ├─► theme/components.tsx, theme/charts.tsx, navigation chrome, MagicFab   (W1, sequential)
     ├─► screens/** + co-located <File>.palette.ts                               (W2, 7 parallel batches)
     └─► AppearanceChrome.buildNavigationTheme(t) → NavigationContainer theme    (dark built from tokens)
```

The decisions below are binding.

**No module cycle.** `theme.ts` must not import the hooks. `appearance.ts` already imports
`theme.ts`, so `theme → useActiveTheme → themeStore → appearanceStorage → appearance → theme`
would be a runtime cycle. That's why the hooks live in their own modules (`useAppTheme.ts`,
`makeStyles.ts`), and `theme.ts` declares its own `type ColorScheme = 'light' | 'dark'`.

**Hook per component (A), not a context provider (B).** `useAppTheme()` calls
`useActiveTheme()` directly. The task fixed this. It also means dark mode can't be silently
disabled by a missing provider, and Zustand/`useColorScheme` subscriptions are cheap. The cost
is that every component module graph reaches AsyncStorage. A global automatic jest mock handles
that (Testing Strategy).

**Legacy static exports are temporary.** `color`, `gradient`, `shadow`, `parkAccent`,
`categoryVisual`, `resortVisual` and the colour keys of `theme` remain as light aliases until
task 10.1. In the end state, `theme` is `{ spacing, radius, layout, typography }`, so `tsc`
rejects any static colour read.

**Single working tree, no commits, disjoint file ownership.** Worktrees would need W1
committed, and the tree carries unrelated uncommitted work. Commits require explicit user
approval. Batches never edit shared files and never change exported signatures. A batch that
needs a shared change stops and reports it.

## Components and Interfaces

### `apps/mobile/src/theme/appearance.ts` (new, pure — no I/O, no React)

```typescript
/** The three persisted/selectable preference states (Requirement 1.1). */
export type AppearancePreference = 'system' | 'light' | 'dark';

/** The resolved theme the App actually renders with at any moment. */
export type ActiveTheme = 'light' | 'dark';

export const APPEARANCE_PREFERENCE_VALUES: readonly AppearancePreference[] =
  ['system', 'light', 'dark'];

/** Default when never set, and fallback when stored/corrupt (Requirements 1.2, 3.3). */
export const DEFAULT_APPEARANCE_PREFERENCE: AppearancePreference = 'system';

/** Narrows an arbitrary value (e.g. a raw AsyncStorage read) to a valid preference. */
export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return (
    typeof value === 'string' &&
    (APPEARANCE_PREFERENCE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Resolve the Active theme from the preference and the OS color scheme
 * (Requirements 1.3, 1.4). `osScheme` is RN `useColorScheme()`'s return type
 * (`'light' | 'dark' | null | undefined`); an unknown/null OS scheme falls
 * back to `'light'`.
 */
export function resolveActiveTheme(
  preference: AppearancePreference,
  osScheme: 'light' | 'dark' | null | undefined,
): ActiveTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return osScheme === 'dark' ? 'dark' : 'light';
}

/**
 * OS status bar content style for the given Active theme (Requirement 6.2).
 * `expo-status-bar`'s real `StatusBarStyle` type is
 * `'auto' | 'inverted' | 'light' | 'dark'`; this function intentionally never
 * produces `'auto'` or `'inverted'` — the Active theme is always resolved to
 * exactly one of two concrete styles, never deferred to the OS or inverted.
 *
 * `'auto'` (the status quo today, via `<StatusBar style="auto" />`) is
 * deliberately dropped rather than kept as a `'system'`-preference
 * passthrough: `'auto'` would make `expo-status-bar` perform its own,
 * second, independent OS-scheme read, which could in principle disagree with
 * `resolveActiveTheme`'s OS-scheme read on the exact render where the OS
 * scheme is changing — two sources of truth for one visual outcome. Resolving
 * to a concrete style here means the status bar always agrees with the same
 * Active theme every other chrome surface derives from, with zero risk of a
 * one-frame mismatch between the two reads. This is not an oversight (NIT
 * finding 7).
 */
export function resolveStatusBarStyle(activeTheme: ActiveTheme): 'light' | 'dark' {
  return activeTheme === 'dark' ? 'light' : 'dark';
}
```

### `apps/mobile/src/theme/appearanceStorage.ts` (new — the only module touching AsyncStorage)

Mirrors `api/sessionStorage.ts` exactly in shape and in its reasoning comment (one key, one
"not found" sentinel, dependency-light so it's trivial to mock):

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_APPEARANCE_PREFERENCE,
  isAppearancePreference,
  type AppearancePreference,
} from './appearance';

/** AsyncStorage key under which the Appearance_Preference is persisted (local-only). */
export const APPEARANCE_PREFERENCE_KEY = 'dwt.appearance.preference';

export async function setStoredAppearancePreference(
  preference: AppearancePreference,
): Promise<void> {
  await AsyncStorage.setItem(APPEARANCE_PREFERENCE_KEY, preference);
}

/**
 * Read the persisted preference, falling back to the default when the key is
 * missing (never set), the read throws (unreadable), or the stored string is
 * not one of the three valid values (corrupt) — Requirement 3.3. Never
 * throws.
 */
export async function getStoredAppearancePreference(): Promise<AppearancePreference> {
  try {
    const raw = await AsyncStorage.getItem(APPEARANCE_PREFERENCE_KEY);
    return isAppearancePreference(raw) ? raw : DEFAULT_APPEARANCE_PREFERENCE;
  } catch {
    return DEFAULT_APPEARANCE_PREFERENCE;
  }
}
```

The value is stored as the raw enum string itself (e.g. the three bytes `"dark"`), not a JSON
envelope — there is nothing to version or nest, and `AsyncStorage.getItem`/`setItem` already
operate on strings natively.

### `apps/mobile/src/state/themeStore.ts` (new — Zustand, mirrors `sessionStore.ts`)

```typescript
import { create } from 'zustand';
import {
  getStoredAppearancePreference,
  setStoredAppearancePreference,
} from '../theme/appearanceStorage';
import { DEFAULT_APPEARANCE_PREFERENCE, type AppearancePreference } from '../theme/appearance';

export interface ThemeState {
  preference: AppearancePreference;
  hydrated: boolean;
  setPreference: (preference: AppearancePreference) => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: DEFAULT_APPEARANCE_PREFERENCE,
  hydrated: false,
  setPreference: async (preference) => {
    // Update in-memory state even if the write fails, so the current session's
    // UI still reflects the User's choice (Error Handling below) — never block
    // on persistence succeeding.
    set({ preference });
    try {
      await setStoredAppearancePreference(preference);
    } catch {
      // Non-fatal: see Error Handling. The next cold start may not see this
      // change if the write never succeeds, but the running session already does.
    }
  },
  loadFromStorage: async () => {
    const stored = await getStoredAppearancePreference();
    set({ preference: stored, hydrated: true });
  },
}));
```

`hydrated` exists for parity with `sessionStore` and future-proofing, but — unlike the session
token, where the navigator must not render until it knows whether a token exists — nothing in
this spec blocks rendering on `hydrated`: the store's initial in-memory value is already the
correct default (`'system'`), so the App can render immediately with that default and seamlessly
pick up the persisted value the moment `loadFromStorage()` resolves (Requirement 3.2 says "before
or as soon as the main UI renders," not "block startup on it").

### `apps/mobile/src/theme/useActiveTheme.ts` (new — the only module calling `useColorScheme()`)

```typescript
import { useColorScheme } from 'react-native';
import { useThemeStore } from '../state/themeStore';
import { resolveActiveTheme, type ActiveTheme } from './appearance';

/**
 * The resolved Active theme (Requirements 1.3, 1.4, 2.1, 2.2). Re-renders
 * automatically on either an OS color-scheme change (`useColorScheme`'s own
 * subscription) or a `themeStore.preference` change (Zustand's own
 * subscription) — no manual listener wiring needed.
 */
export function useActiveTheme(): ActiveTheme {
  const preference = useThemeStore((state) => state.preference);
  const osScheme = useColorScheme();
  return resolveActiveTheme(preference, osScheme);
}
```

### `apps/mobile/src/theme/AppearanceChrome.ts` (new — the exported, testable chrome-derivation)

Addresses spec-review Finding 2: rather than inlining the three chrome values as local
`const`s inside `App.tsx` (which a test could only re-derive in a parallel stand-in, silently
drifting from the real component over time), the derivation is a small named, exported function
that `App.tsx` calls directly and that `App.appearance.test.tsx` imports and asserts against —
the same production code path, not a reimplementation of it:

```typescript
import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';
import {
  DARK_ROOT_BACKGROUND,
  LIGHT_ROOT_BACKGROUND,
  resolveStatusBarStyle,
  type ActiveTheme,
} from './appearance';

export interface AppearanceChrome {
  readonly navigationTheme: Theme;
  readonly statusBarStyle: 'light' | 'dark';
  readonly rootBackground: string;
}

/**
 * Derives the full (navigationTheme, statusBarStyle, rootBackground) chrome
 * triple from the Active theme alone (Requirement 6; Correctness Property 3).
 * Exported so `App.tsx` and `App.appearance.test.tsx` call the identical
 * function — the test exercises this literal production code, not a stand-in
 * that could silently diverge from what `App.tsx` actually renders.
 */
export function deriveAppearanceChrome(activeTheme: ActiveTheme): AppearanceChrome {
  return {
    navigationTheme: activeTheme === 'dark' ? DarkTheme : DefaultTheme,
    statusBarStyle: resolveStatusBarStyle(activeTheme),
    rootBackground: activeTheme === 'dark' ? DARK_ROOT_BACKGROUND : LIGHT_ROOT_BACKGROUND,
  };
}
```

### `apps/mobile/src/App.tsx` (modified)

```typescript
import { NavigationContainer } from '@react-navigation/native';
import { useActiveTheme } from './theme/useActiveTheme';
import { deriveAppearanceChrome } from './theme/AppearanceChrome';
import { useThemeStore } from './state/themeStore';
// ...existing imports unchanged...

export default function App(): JSX.Element {
  const loadSessionFromStorage = useSessionStore((state) => state.loadFromStorage);
  const loadThemeFromStorage = useThemeStore((state) => state.loadFromStorage);

  useEffect(() => {
    void loadSessionFromStorage();
  }, [loadSessionFromStorage]);

  useEffect(() => {
    void loadThemeFromStorage();
  }, [loadThemeFromStorage]);

  const activeTheme = useActiveTheme();
  const { navigationTheme, statusBarStyle, rootBackground } = deriveAppearanceChrome(activeTheme);

  // ...usePushRegistration(); useNotificationResponse(); unchanged...

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider style={{ backgroundColor: rootBackground }}>
        <QueryClientProvider client={queryClient}>
          <NavigationContainer ref={navigationRef} theme={navigationTheme}>
            <RootNavigator />
          </NavigationContainer>
          <StatusBar style={statusBarStyle} />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

`DARK_ROOT_BACKGROUND`/`LIGHT_ROOT_BACKGROUND` are added to `appearance.ts` as plain exported
constants (Configuration & Constants below) — `LIGHT_ROOT_BACKGROUND` is the existing
`theme.color.background` value so light mode's root is unchanged from today, and
`DARK_ROOT_BACKGROUND` is a neutral placeholder dark surface (not a designed Disney dark palette —
see Out of Scope).

**What this root background concretely covers (spec-review Round 2, Finding 1 — citation
corrected to the component `App.tsx` actually renders, re-verified against the real source, not
asserted).** The prior revision of this section cited
`node_modules/@react-navigation/elements/src/SafeAreaProviderCompat.tsx` as "the component
`App.tsx` actually renders, re-exported as `SafeAreaProvider`." That was wrong: `App.tsx` imports
`SafeAreaProvider` directly from `'react-native-safe-area-context'`
(`import { SafeAreaProvider } from 'react-native-safe-area-context';` — `App.tsx` line 8), a
distinct component from a distinct package. `SafeAreaProviderCompat` is instead used internally by
`@react-navigation/native-stack`'s own `NativeStackView`
(`export default function NativeStackView(props) { return
<SafeAreaProviderCompat><NativeStackViewInner {...props} /></SafeAreaProviderCompat>; }` —
`node_modules/@react-navigation/native-stack/src/views/NativeStackView.native.tsx`), nested
*inside* `RootNavigator`, several layers below `App.tsx`'s own `SafeAreaProvider`, and it is
called there with **no `style` prop at all** — so even setting the wrong-file citation aside,
this spec's `rootBackground` wiring (which only sets `style` on `App.tsx`'s own `SafeAreaProvider`)
never reaches it.

I re-read the actually-relevant file,
`node_modules/react-native-safe-area-context/src/SafeAreaContext.tsx`'s `SafeAreaProvider` (the
component `App.tsx` really renders). Two concrete, source-confirmed facts replace the prior
(wrong-file) ones: (1) it forwards `style` onto the native `NativeSafeAreaProvider` host view —
`<NativeSafeAreaProvider style={[styles.fill, style]} onInsetsChange={onInsetsChange}
{...others}>` — which is codegen'd as the real native host component `'RNCSafeAreaProvider'`
(`node_modules/react-native-safe-area-context/src/specs/NativeSafeAreaProvider.ts`), so
`rootBackground` is in fact painted as a real `backgroundColor` on a real native view — the same
conclusion as before, now from the right source. (2) Critically, this component renders `null`
for `children` — not merely an unpainted background, but *no children at all* — until its first
`onInsetsChange` native callback resolves:
`{insets != null ? (<SafeAreaFrameContext.Provider value={frame}><SafeAreaInsetsContext.Provider
value={insets}>{children}</SafeAreaInsetsContext.Provider></SafeAreaFrameContext.Provider>) :
null}`, and `insets`'s initial state is `initialMetrics?.insets ?? initialSafeAreaInsets ??
parentInsets ?? null`. `App.tsx`'s call site (`<SafeAreaProvider style={{ backgroundColor:
rootBackground }}>`) passes none of `initialMetrics`/`initialSafeAreaInsets` and has no parent
`SafeAreaProvider` to inherit insets from, so `insets` starts `null` on first mount. The
cold-mount window is therefore **not** "a backdrop sitting behind `NavigationContainer`'s
content" — it is a bare, background-colored native view with nothing else drawn inside it yet:
`QueryClientProvider`/`NavigationContainer`/`RootNavigator` are all descendants of `{children}`,
and `{children}` itself renders as `null` until insets resolve, so none of them have been mounted
into the tree at all for that window's duration.

Separately, the native-stack `MaybeNestedStack` claim (Requirement 6.1) was independently
re-confirmed by reading `NativeStackView.native.tsx` directly (not assumed, and not retracted by
this correction): `const { colors } = useTheme(); ...` is applied to each screen's content
wrapper (`DebugContainer`) as `presentation !== 'transparentModal' && presentation !==
'containedTransparentModal' && { backgroundColor: colors.background }` — that part of the
original citation holds and is kept as-is. What is retracted is only the claim that
`SafeAreaProviderCompat` is "the component `App.tsx` actually renders" or that it plays any role
in this spec's `rootBackground` wiring — it is a different, nested, unrelated component with no
`style` prop passed to it anywhere in this App.

Net effect on the claim: outside the cold-mount window, every `'card'`/`'modal'` screen still
paints its own `colors.background` over this root once mounted, so the root background remains
inert / not visible in the steady state — a safety backdrop, not the primary surface. This spec
still does not claim (and cannot, from static source reading alone) that a human eye would
perceive zero flash on a real device; it claims only that the root color is
Active-theme-consistent for the window where it is the visible layer, which is what Requirement
6.3 (as amended below) now states — with the cold-mount window described accurately as a bare
background-colored view with nothing else drawn inside it yet, rather than implying
`NavigationContainer` content is already present underneath it.

**Native window background (polish Fix 11, Requirement 6.5; Property 25).** In some layouts
Expo Go's `ExperienceActivity` bounds the React root above the Android gesture bar. A
`uiautomator` dump shows `android:id/content` at `[0,136][1080,2337]` on a 1080×2400 screen, so
rows 2337–2399 are the native window/decor background, which no JS view can paint. `App.tsx`
therefore adds, beside the status-bar wiring:

```typescript
import * as SystemUI from 'expo-system-ui';

useEffect(() => {
  SystemUI.setBackgroundColorAsync(rootBackground).catch((error: unknown) => {
    console.warn('expo-system-ui: setBackgroundColorAsync failed', error);
  });
}, [rootBackground]);
```

It reuses `deriveAppearanceChrome`'s `rootBackground` and adds no new colour. On Android the
module calls `window.decorView.setBackgroundColor(...)`
(`node_modules/expo-system-ui/android/.../SystemUIModule.kt`).

### `apps/mobile/src/screens/AppearancePreferenceControl.tsx` (new)

Self-contained, following `PushNotificationPreferenceControl.tsx`'s exact placement pattern (a
standalone component the parent `YouAndCrewScreen` renders inside its own titled `Card`, owning
its own state/behavior — see the corrected "`YouAndCrewScreen.tsx` (modified)" section below for
why this is `YouAndCrewScreen`, not `ProfileScreen`) and reusing the **existing** `Chip` primitive
from `theme/components.tsx` for
the three options — `Chip` already implements `accessibilityRole="button"`,
`accessibilityState={{ selected }}`, and a default spoken label of `"{label}, {selected/not
selected}"`, which satisfies Requirement 5's accessibility criteria by construction, with zero new
accessibility code to get right or re-review. This also follows the "do not invent a new
settings-row style if one exists" guidance literally: `Chip` is already the App's selectable-pill
primitive (used today for category/land filter chips), so no new control style is introduced.
This is the concrete decision Requirement 5.2 (as amended) now states directly:
`accessibilityState.selected`, not `.checked` — `Chip` never sets `.checked`, so there is nothing
in this component that could satisfy a `.checked`-based reading of the requirement, and the
requirement no longer leaves that as an open alternative.

```typescript
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme/theme';
import { Chip } from '../theme/components';
import { useThemeStore } from '../state/themeStore';
import type { AppearancePreference } from '../theme/appearance';

const OPTIONS: ReadonlyArray<{ readonly value: AppearancePreference; readonly label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function AppearancePreferenceControl(): JSX.Element {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);

  return (
    <View style={styles.container} testID="appearance-preference-control">
      <Text style={styles.title}>Appearance</Text>
      <Text style={styles.description}>
        Choose how the app looks, or follow your device's setting.
      </Text>
      <View style={styles.row}>
        {OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={preference === option.value}
            onPress={() => {
              void setPreference(option.value);
            }}
            testID={`appearance-option-${option.value}`}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: theme.spacing.sm },
  title: { ...theme.typography.subtitle, color: theme.color.textPrimary },
  description: { ...theme.typography.meta, color: theme.color.textSecondary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: 2 },
});
```

`setPreference` is `async`, but the control fires it without awaiting (`void setPreference(...)`)
— the Zustand `set({ preference })` call inside `setPreference` happens synchronously before the
`await` on the storage write, so `preference === option.value` (and thus the `Chip`'s `active`
state) updates on the very next render regardless of how long the AsyncStorage write takes
(Requirement 4.3's "without requiring … an app restart").

Like the chrome in `App.tsx` below, this control reads `preference` straight from `useThemeStore`
without checking `hydrated`: on first render after a cold start it briefly shows the in-memory
default (`'system'` selected) even when the persisted value is `'light'`/`'dark'`, until
`loadFromStorage()` resolves a render or two later. This is the same brief, allowed mismatch
window Requirement 3.2 permits ("before or as soon as the main UI renders") — not a bug — and
applies to this control's initial selected `Chip` exactly as it applies to the chrome's initial
`navigationTheme`/`statusBarStyle`/`rootBackground`.

### `apps/mobile/src/screens/youAndCrew/YouAndCrewScreen.tsx` (modified)

**Corrected placement (post-implementation note).** This section originally named
`apps/mobile/src/screens/ProfileScreen.tsx` as the insertion point. That was wrong: by the time
this spec was implemented, the earlier `navigation-redesign` spec had already relocated the App's
reachable Profile/settings surface off `ProfileScreen.tsx` (whose default-exported screen is not
registered on any navigator — only its `ProfileIdentityBlock` export is reused elsewhere) onto
`YouAndCrewScreen.tsx`. The real, reachable implementation — confirmed by reading the actual
source — inserts the control into `YouAndCrewScreen.tsx`'s "Preferences & Security" section,
alongside `PushNotificationPreferenceControl` and `ChangePasswordControl`, gated by the same
self-mode condition that section already uses. The corresponding test coverage lives in
`apps/mobile/src/screens/youAndCrew/__tests__/YouAndCrewScreen.test.tsx`, not
`ProfileScreen.test.tsx`. See also Requirement 4.1's corrective note in requirements.md.

Inserted as a new titled `Card` in that "Preferences & Security" section:

```typescript
import AppearancePreferenceControl from '../AppearancePreferenceControl';

// ...inside YouAndCrewScreen's "Preferences & Security" section, between the Notifications
// Card and the Account Security Card...
<Card style={styles.securityCard}>
  <Text style={styles.statLabel}>Appearance</Text>
  <AppearancePreferenceControl />
</Card>
```

No other change to `YouAndCrewScreen.tsx`. The control is rendered only in self-mode (viewing
another User's profile never shows it), matching Requirement 4.1 — this is a deliberate, simple
choice even though Appearance is a device-level (not account-level) setting: it keeps the
control's placement/gating identical to every other settings control already on this screen
rather than introducing a one-off exception, and a device-level preference is still meaningless
to show while viewing someone else's profile (there's no "their device" to affect).

### (Retrofit) `apps/mobile/src/theme/theme.ts` (modified — pure)

```typescript
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import type { ExperienceCategory, Park } from '@dwt/shared';

export type ColorScheme = 'light' | 'dark';
export const lightColor = { /* today's 21 values verbatim */ primaryFg: '#5b2a86' } as const;
export type ColorToken = keyof typeof lightColor;
export type ColorTokens = { readonly [K in ColorToken]: string };
export const darkColor = { /* Configuration & Constants */ } as const satisfies ColorTokens; // missing/extra key = tsc error

export interface GradientTokens { readonly header: readonly [string, string];
  readonly headerVivid: readonly [string, string, string]; readonly gold: readonly [string, string];
  readonly fab: readonly [string, string, string];        // iteration 3 — MagicFab; light = today's headerVivid
  readonly chartBar: readonly [string, string, string] }  // iteration 3 — RatingHistogram; light = today's headerVivid
export interface ShadowStyle { readonly shadowColor: string;
  readonly shadowOffset: { readonly width: number; readonly height: number };
  readonly shadowOpacity: number; readonly shadowRadius: number; readonly elevation: number }
export interface ShadowTokens { readonly card: ShadowStyle; readonly floating: ShadowStyle }
export interface CategoryVisual { readonly glyph: string; readonly label: string;
  readonly tint: string;   // foreground: text, icon, border, Badge colour
  readonly fill: string }  // iteration 3 — solid fill behind a white glyph/text; light === tint
export interface TabBarTokens { readonly background: string; readonly border: string;
  readonly activeTint: string; readonly inactiveTint: string;
  readonly badgeBackground: string; readonly badgeText: string }

export interface AppTheme {
  readonly scheme: ColorScheme;
  readonly color: ColorTokens;
  readonly gradient: GradientTokens;
  readonly shadow: ShadowTokens;
  readonly outline: { readonly card: ViewStyle };   // light {} ; dark hairline #33264d border
  readonly textDefault: TextStyle;                   // light {} ; dark { color: textPrimary }
  readonly parkAccent: Readonly<Record<Park, string>>;
  readonly categoryVisual: Readonly<Record<ExperienceCategory, CategoryVisual>>;
  readonly resortVisual: CategoryVisual;
  readonly tabBar: TabBarTokens;
  readonly spacing: typeof spacing; readonly radius: typeof radius;
  readonly layout: typeof layout; readonly typography: typeof typography;
}
export const categoryMeta: Readonly<Record<ExperienceCategory, { readonly glyph: string; readonly label: string }>>;
export const lightTheme: AppTheme;
export const darkTheme: AppTheme;
export const themes: Readonly<Record<ColorScheme, AppTheme>>;
export type TonalFamily = 'violet' | 'green' | 'amber' | 'orange' | 'red' | 'pink' | 'blue' | 'sky' | 'teal';
export const DARK_TONAL: Readonly<Record<TonalFamily, { readonly fg: string; readonly tint: string; readonly border: string; readonly fill: string }>>;
export function withAlpha(color: string, alpha: number): string; // #rgb/#rrggbb/#rrggbbaa, rgb(), rgba() (alpha replaced); else throws Error('withAlpha: unsupported colour <v>')
// Output format pinned (iteration 3): exactly `rgba(${r}, ${g}, ${b}, ${alpha})` (comma-space, alpha
// unformatted) — today's hexToRgba string, e.g. 'rgba(91, 42, 134, 0.14)', so Badge light is byte-identical.
export interface ThemedPalette<K extends string> { readonly light: Readonly<Record<K, string>>; readonly dark: Readonly<Record<K, string>> }
export function definePalette<const L extends Readonly<Record<string, string>>>(p: {
  readonly light: L; readonly dark: { readonly [K in keyof L]: string } }): ThemedPalette<Extract<keyof L, string>>;
export const spacing, radius, layout, typography;               // unchanged, static
// END STATE (task 10.1): export const theme = { spacing, radius, layout, typography } as const;
// Task 10.1 also removes `export type Theme = typeof theme` (no consumers); use `AppTheme`.
```

`categoryVisual[k]` = `{ ...categoryMeta[k], tint: CATEGORY_TINT_<SCHEME>[k] }`. Both tint maps
are typed `Record<ExperienceCategory, string>`, so every category must have a tint.
*(Iteration 3)* Each entry also has `fill`: `CATEGORY_TINT_LIGHT[k]` in light (so
`fill === tint`), and `CATEGORY_FILL_DARK[k]` in dark (Configuration & Constants "Category
fills"). `CATEGORY_FILL_DARK` is typed `Record<ExperienceCategory, string>` too.
`resortVisual.fill` is `#5b2a86` in both schemes.
`withAlpha` replaces `components.tsx`'s private `hexToRgba`. It accepts every format a token
or palette value can take, so `Badge` (any `color` string, tinted via `withAlpha(color, 0.14)`)
can't crash on an `rgba(...)` or 8-digit palette value. Property 14 asserts that every token
and palette value parses.

### (Retrofit) `apps/mobile/src/theme/useAppTheme.ts` (new)

```typescript
export function useAppTheme(): AppTheme { return themes[useActiveTheme()]; }
export function usePalette<K extends string>(p: ThemedPalette<K>): Readonly<Record<K, string>> {
  return p[useActiveTheme()];
}
```

### (Retrofit) `apps/mobile/src/theme/makeStyles.ts` (new)

```typescript
export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (t: AppTheme) => T & StyleSheet.NamedStyles<any>,
): () => T {
  const cache: Partial<Record<ColorScheme, T>> = {};
  return function useStyles(): T {
    const t = useAppTheme();
    let s = cache[t.scheme];
    if (s === undefined) { s = StyleSheet.create(factory(t)); cache[t.scheme] = s; }
    return s;
  };
}
```

**Consumer pattern:** declare `const useStyles = makeStyles((t) => ({ ... }))` at module scope.
The factory body runs lazily, so it's not a module-scope colour read. Then follow these rules:

- Every function component that uses styles calls `const styles = useStyles();`.
- Inline colour props come from `const t = useAppTheme();`.
- Module-scope helpers that took `styles` move inside the component or take `styles`/`t` as a
  parameter.
- Pure view-model `.ts` modules that embed colours (e.g. `statsView.ts`) take
  `t: Pick<AppTheme, 'color' | 'parkAccent' | 'categoryVisual'>`. Their tests pass
  `lightTheme`.
- A palette is read inside a factory as `P[t.scheme].key`, or in a render as
  `usePalette(P).key`. *(iteration 4)* It may also be read through one `const` alias,
  declared as `const pal = usePalette(P);` in a render or `const pal = P[t.scheme];` in a
  factory block body, and then read as `pal.key` or `pal[k]`. A palette record is never
  destructured. These are the only forms the light-colour multiset audit sees.

**Memoized and virtualized consumers (binding; Requirement 8.5).** `styles` and `t` change
identity on a scheme switch, so a memo that omits them keeps stale light colours.

- A `useMemo`/`useCallback`/`useEffect`/`useLayoutEffect` whose body reads `styles`, `t` or a
  `usePalette` result lists that value in its deps. This includes `navigation.setOptions`
  colour effects.
- A `useRef` never holds a colour or style. An `Animated` colour interpolation is built in a
  `useMemo` with `t` in its deps.
- A `FlatList`/`SectionList`/`DraggableFlatList` whose render callbacks read `styles`/`t` from
  the parent's closure gets `extraData={t.scheme}`. An existing `extraData={x}` becomes
  `extraData={[x, t.scheme]}`. Rows that call `useStyles()`/`useAppTheme()` themselves need
  nothing.
- A `React.memo` component that gets styles only by prop needs nothing. One that reads module
  `styles` calls `useStyles()` itself.

Property 20 pins these patterns.

### (Retrofit) `theme/appearance.ts` and `theme/AppearanceChrome.ts` (modified)

`LIGHT_ROOT_BACKGROUND = lightTheme.color.background` (`#f5f2fb`, unchanged).
`DARK_ROOT_BACKGROUND = darkTheme.color.background` (`#120a1f`).

`AppearanceChrome.ts` adds `buildNavigationTheme(t: AppTheme): Theme`:

- **light:** returns `DefaultTheme` by identity.
- **dark:** a module-level constant built once:
  `{ dark: true, colors: { primary: t.color.primaryFg, background: t.color.background, card: t.tabBar.background, text: t.color.textPrimary, border: t.tabBar.border, notification: t.color.danger } }`.

`deriveAppearanceChrome(active)` returns `navigationTheme: buildNavigationTheme(themes[active])`
and `rootBackground: themes[active].color.background`. `bottom-tabs@6.6.1` paints the tab bar
from `colors.card`/`colors.border` (`BottomTabBar.tsx` lines 262–263), so no `tabBarStyle`
override is needed.

### (Retrofit) `navigation/RootNavigator.tsx` and `screens/quickAction/MagicFab.tsx` (modified)

**`RootNavigator.tsx`.** `MainTabsNavigator` calls `useAppTheme()` and sets these options:

- `tabBarActiveTintColor: t.tabBar.activeTint`
- `tabBarInactiveTintColor: t.tabBar.inactiveTint`
- `tabBarBadgeStyle: { backgroundColor: t.tabBar.badgeBackground, color: t.tabBar.badgeText, fontSize: 10, fontWeight: '700' }`

It sets no `tabBarStyle`.

**`MagicFab.tsx`.** The FAB gradient is `t.gradient.headerVivid` (**superseded in iteration
3:** `t.gradient.fab`, whose light value is today's `headerVivid` byte-for-byte and whose dark
value `['#9d7ae0','#7e57c2','#7650b9']` stays at least 3:1 against the `surface` ring), the glyph is
`t.color.textOnPrimary`, and the ring is `surface` + `shadow.card` + `outline.card`. The sheet
uses the background, border and text tokens. The scrim stays `rgba(0, 0, 0, 0.4)`.

### (Retrofit) Shared kit token mapping (`theme/components.tsx`, `theme/charts.tsx`)

| Primitive | Token mapping (light values unchanged) |
| --- | --- |
| `ScreenContainer` | bg `background` |
| `GradientHeader` | default `gradient.headerVivid`. Neutral white overlays stay as they are. Eyebrow text comes from `theme/components.palette.ts` `HEADER.eyebrowText` (`#ffd54f` in both schemes). |
| `Card` | `surface` + `shadow.card` + `outline.card` |
| `PrimaryButton` | `gradient.header`; label and spinner `textOnPrimary` |
| `SecondaryButton` | bg `surfaceAlt`, border `borderStrong`, label/icon `primaryFg`. Danger tone: `DANGER_BUTTON` palette `{bg '#fdebf2' → DARK_TONAL.pink.tint, border '#f3b6cf' → DARK_TONAL.pink.border}`, text `danger`. |
| `Badge` | default colour `primaryFg` |
| `Chip` | idle `surfaceAlt`/`border`/`textSecondary`; active `primary`/`primary`/`textOnPrimary` |
| `SectionLabel` | `textPrimary` |
| `EmptyState` | circle `surfaceAlt`, icon `primaryFg`, title `textPrimary`, body `textSecondary` |
| `ProgressRing` | track `surfaceAlt`, arc `[primaryLight, primary]` → **iteration 3: `[primaryLight, primaryFg]`** (same light `[#7e57c2, #5b2a86]`), centre `primaryFg`, sub `textSecondary` |
| `ProgressBar` | track `surfaceAlt`, fill `primary` → **iteration 3: `primaryFg`** (same light `#5b2a86`), complete `gradient.gold` |
| `RatingHistogram` | bars `gradient.headerVivid` → **iteration 3: `gradient.chartBar`** (same light values), hot `gradient.gold`, labels `textSecondary` |

**Non-text graphics rule (iteration 3, Requirement 7.5).** A data mark (progress fill, ring
arc, chart bar) is a primary-hued foreground mark on a surface, so it uses `primaryFg` (dark
`#c4a3ff`, 7.41:1 on the `surfaceAlt` track), not `primary` (2.98:1). No new colour token is
added. `PrimaryButton` keeps `gradient.header`, whose dark value changes in iteration 3 to
`['#7e57c2','#7650b9']` (Configuration & Constants).
| `RatingDial` | number `primaryFg`, out-of `textSecondary`, stars `accent` |
| `CompleteBadge` | `gradient.gold` / `textOnAccent` |

### (Retrofit) Third-party and native props

- **`react-native-calendars`** (`DatePickerField`, `CrowdCalendarScreen`). The theme comes from
  `useAppTheme()`, and the component also gets **`key={t.scheme}`**. `Calendar`/`BasicDay`
  capture styles once via `useRef(styleConstructor(theme))` (verified in
  `node_modules/react-native-calendars/src/calendar/index.js` line 26), so they need a remount.
  Mapping:
  - `calendarBackground`: `surface`
  - month and day text: `textPrimary`
  - section title: `textSecondary`
  - disabled: palette pair `#e2d9f0` / `#4a3a6b`
  - today and arrows: `primaryFg`
  - selected: `primary` with `textOnPrimary`
- **`TextInput`.** Style gets `...t.textDefault` under the default-text rule below,
  `placeholderTextColor={t.color.textSecondary}`, and `keyboardAppearance={t.scheme}`.
- **`ActivityIndicator`/`RefreshControl`.** Tint is `primaryFg`, or `textOnPrimary` on fills.
- **`Switch`.** Track and thumb go in a palette pair.

**Default-text rule (`t.textDefault`, binding; Requirement 9.7 amendment).** Spread
`...t.textDefault` into a `Text`/`TextInput` style only when all three hold:

1. No entry of its style array (including conditional entries) sets `color`.
2. It has no `Text` ancestor in the component's JSX, and it isn't the `children` of a
   component whose root is a `Text`. A nested `Text` inherits its parent's colour.
3. Its nearest ancestor that paints a `backgroundColor` is a themed surface (`background`,
   `surface`, `surfaceAlt`, a `DARK_TONAL` tint, or a `withAlpha` of a token), or there is no
   painted ancestor in the component.

On a mode-invariant background (role G, H or V, a gradient, an image or art), it's left
unchanged. That background is identical in both schemes, so RN's default is unchanged too.

### (Retrofit) Literal conversion rules (binding, no free choice)

Rules apply in order, and the first rule that matches decides. These are identical to the
rules in `.agents/tasks/dark-mode-retrofit/design.md`.

0. **Non-black `shadowColor`** (any hex, checked before rule 1):
   - `'#3d1c5c'` → `t.shadow.card.shadowColor` (light `#3d1c5c`, dark `#000000`).
   - Any other hex → a palette pair `{ light: '<original>', dark: '#000000' }`.
   - Chromatic `rgba(r,g,b,a)` → a palette pair
     `{ light: '<original>', dark: 'rgba(0, 0, 0, a)' }`, with the same `a`.
1. **Exact light-token match** (case-insensitive, `#fff` ≡ `#ffffff`) → that token, picked by
   role:
   - `#ffffff`:
     - background → `surface`;
     - text or icon on a fill or gradient → `textOnPrimary`;
     - `star` decoration → `star`;
     - border, ring or cut-out on a themed surface → `surface`;
     - border or ring on a gradient, image or H surface → `textOnPrimary`.
   - `#5b2a86`: fill → `primary`; text, icon or border on a surface → `primaryFg`.
   - `#3d1c5c`: fill or gradient stop → `primaryDark`; text on gold → `textOnAccent`; text,
     icon or border on a surface → `primaryFg`.
   - `#7e57c2`: text or icon on a surface → `primaryLight` (dark `#b28dff`, 6.80:1, iteration
     3). A fill behind white text → a palette pair
     `{ light: '#7e57c2', dark: DARK_TONAL.violet.fill }` (white on dark `primaryLight` is
     only 2.58:1).
   - Every other token value maps to its token **in its natural role only**:
     - text tokens as text or icon;
     - border tokens as border, divider or track;
     - surface tokens as background;
     - hue tokens (`accent`, `accentDark`, `success`, `danger`, `warning`, `starRating`) as
       text, icon, fill or border, except a status fill behind white text, which follows
       rule 4.
   - A token value in any role not listed (e.g. `#1f1235` as a hero background) goes to
     rule 3.
   - A park hue used for a park → `t.parkAccent[park]`; used for a category →
     `t.categoryVisual[c].tint`. This takes precedence over the `#7e57c2` bullet.
     **Split in iteration 3 (Requirement 9.11):** a category hue as text, an icon, a border,
     a chip tint or a `Badge` colour → `.tint`. As a solid fill behind white text or a white
     glyph → `.fill` (`t.resortVisual.fill` for resorts). The four placeholder-tile sites are
     `ExperienceDetailScreen.tsx:1177`, `DestinationScreen.tsx:1013`,
     `ExploreHubScreen.tsx:900` and `ParkDestinationScreen.tsx:1445`.

1a. **Token reads follow the same role rules as literals (iteration 3, Requirement 9.10).**
    `theme.color.X` → `t.color.X` only when X is used in its natural role. Otherwise convert
    it exactly as if X's light value were a literal in that role:
    - `surface`/`star`/`textOnPrimary` as text or an icon on a fill or gradient →
      `t.color.textOnPrimary`. Example: `TripReservationsScreen.tsx:1062,1079` active chip text
      `theme.color.surface` on `primary`. A straight substitution gives 3.36:1; the converted
      white gives 5.21:1.
    - A text token as a background → rule 3. `#1f1235` (L < 0.03) is H-role, so it is
      mode-invariant. Example: `foodLists/MarkGottenUndoToast.tsx:82` becomes the pair
      `{ light: '#1f1235', dark: '#1f1235' }` with `textOnPrimary`/`accent` text, at
      17.56 / 10.71:1 instead of 1.14 / 1.44:1. It also spreads `...t.outline.card`, which is
      `{}` in light.
    - `primary`/`primaryDark` as text, an icon, a border or a data mark on a surface →
      `primaryFg`.
    - `primaryLight` as a fill behind white → the rule-1 violet pair.
    - Any other out-of-role read → rule 3, using the light value as the literal.

    The owning batches name these sites in their reports (B3 the toast, B5 the chips) and
    assert them in their owned tests (Property 22).
2. **`rgba(r,g,b,a)` of a token** → `withAlpha(t.color.<token>, a)`. Exception:
   `rgba(31,18,53,a)` used as a scrim → palette pair `{light: original, dark: 'rgba(0, 0, 0, a)'}`.
2a. **Template-literal alpha suffix (iteration 3).** `` `${theme.color.X}NN` `` →
    `` `${t.color.X}NN` `` verbatim. The light string stays byte-identical, and the role of X
    is decided by rule 1a. Property 7 asserts that every `color.*` value is `#rrggbb`, so the
    suffix always yields valid 8-digit hex.

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
      constraint. The batch checks it and lists each such site in its report (task 9
      "Done when").
    - Theme-side values are pinned by Property 7: every `color.*`, `parkAccent.*`,
      `categoryVisual[*].tint`/`.fill` and `resortVisual.tint`/`.fill` value matches
      `/^#[0-9a-f]{6}$/` in both schemes.
3. **Non-token literal** → co-located `<File>.palette.ts` via `definePalette`. The light value is
   the original literal byte-for-byte. The dark value comes from the family and role below.
   - **Family.** Use the high-frequency table in Configuration & Constants below ("High-frequency
     literal families"; previously this pointed to `.agents/tasks/dark-mode-retrofit/design.md`,
     which carries the identical table).
     For anything not in it, use the HSL hue of the light literal: saturation < 0.20 → neutral;
     otherwise red `[345,15)`, orange `[15,35)`, amber `[35,62)`, green `[62,170)`,
     teal `[170,195)`, sky `[195,215)`, blue `[215,250)`, violet `[250,300)`,
     pink `[300,345)`.
   - **Role:**
     - **T** text/icon → `DARK_TONAL[f].fg`.
     - **S** tinted background → `.tint`.
     - **B** border/track → `.border`.
     - **F** solid fill behind white text → `.fill`.
     - **G** gold fill behind dark text → mode-invariant.
     - **H** already-dark hero/art surface (relative luminance < 0.03) → mode-invariant.
     - **V** data-encoding scale → mode-invariant, unless text on it falls below 4.5:1 (then
       use F).
   - **Neutral family** (Tailwind slate/gray, app lavender-greys). `L` is the WCAG relative
     luminance of the light literal. Every band is closed:
     - T: L < 0.12 → `textPrimary`; L ≥ 0.12 → `textSecondary`.
     - S: every lavender-subtle entry, and any neutral with L ≥ 0.70 → `surfaceAlt`; a
       neutral with L < 0.70 → `borderStrong`.
     - B: L ≥ 0.75 → `border`; otherwise `borderStrong`.
     - F: `borderStrong`.
     - The listed lavender-subtle literals always count as neutral, whatever their
       saturation. Unlisted violets follow the violet family.
   - **Alpha-suffixed values (iteration 4).** A palette value that the code ever suffixes with
     an alpha (rule 2a) must be `#rrggbb` in both `light` and `dark`.
4. **Status token (`success`/`danger`/`warning`) as a solid fill behind white text** → palette
   pair: light = the token's light value, dark = `DARK_TONAL.green|pink|amber.fill`.
5. **Exempt:** `shadowColor: '#000'`/`'#000000'`, and neutral `rgba(255,255,255,a)` /
   `rgba(0,0,0,a)` on a gradient, image or scrim. A neutral `rgba(255,255,255,a)` veil on a
   themed surface becomes `withAlpha(t.color.surface, a)`, which in light is the same colour.
   A neutral `rgba(0,0,0,a)` on a themed surface stays literal.
6. **Artwork is never recoloured.** Embedded art literals get mode-invariant pairs commented
   `// artwork — mode-invariant`. `destinationVisuals.ts` drops its `accent` field (consumers
   use `t.parkAccent[id]`, or `primaryFg` for Resorts; every light value matches), and its
   `gradient`s stay.
7. **Pin tier colours used as UI text** (Requirement 9.9). `TIER_COLOR` stays artwork,
   allowlisted and unedited. B6 creates `screens/profile/tierText.palette.ts`:
   `export const TIER_TEXT = definePalette({ light: TIER_COLOR, dark: { ...TIER_COLOR,
   amethyst: '#c08ff5', bronze: '#e0965f' } })`. Every tier colour used as text or an icon
   (the `Badge` `color` in `PinCelebrationModal`, `PinDetailModal`, `PinShowcaseScreen` and
   `CollectionScreen`) uses `usePalette(TIER_TEXT)[tier]`. Tier dots, progress fills and
   swatches keep `TIER_COLOR`.

### (Retrofit) Polish-pass rulings (Requirements 9.12–9.15)

These rulings were made after the W2 batch reviews and the dark screenshot pass. They are
binding in the same way as the conversion rules above, and they only ever change a `dark`
value or selected-state wiring; no `light` value changes.

- **Selected states (9.12).** A selected/active indicator whose rule-derived dark value lands
  within 3:1 of its unselected sibling or its surface is re-assigned by exception:
  - `ParkWaitPulse` active ring → `DARK_TONAL.green.fg` (role T, 7.91:1 on `surface`, 3.70:1
    against the idle `violet.border`).
  - `ShareComposer` unselected recipient ring → `textSecondary` (muted, distinct from the
    selected `primaryFg`).
  - Segmented switchers on a `surfaceAlt` track (Expenses tabs, Balances Net/Pairwise): the
    active pill is a new palette key, light `#ffffff` (today's `surface`), dark
    `borderStrong` (lighter than the track); the idle label is `textSecondary`.
  - `ExpenseFormModal` active tier count pill → new keys `tierPillActiveBg` (light
    `#f5effa`, dark `violet.tint`) and `tierPillActiveBorder` (light `#bca5db`, dark
    `primaryFg`).
  - Schedule showtime pill → new key `showtimeActiveBorder` (light `#5b2a86`, dark
    `primaryFg`), because dark `primary` is only 2.98:1 on the `surfaceAlt` section.
- **`#655d78` band (9.13).** The light neutral `#655d78` (L 0.1195) sits just under rule 3's
  0.12 split, which made muted copy `textPrimary` and brighter than its `violet.fg` heading.
  Muted copy in this band → `textSecondary`; the near-black `#190c2d`/`#372f4a`/`#4a3f60`
  heading/body ink *in the same component* → `textPrimary` (ResortGuide, LocationGroup,
  LensSwitcher, LiveWaitCockpit, PassportAndLoreLens, DiningReservationCard,
  ParkPassportCard tip close). Ink with no muted sibling (`QuickSpecsRow.specText`,
  `ShowtimesCard.title/futureText`) keeps `violet.fg`; violet text on violet tints is the
  accent role and stays. Name ink `#1e1b4b` (Expenses/Balances member and flow names, the
  active Balances toggle label) → `textPrimary` (B4-4).
- **On-photo overlays (9.14).** A badge drawn on a photograph is mode-invariant: the
  Resorts directory tier badges keep their light fills in dark. White on them is the
  pre-existing light ratio (3.19 / 5.70 / 4.10 / 5.38), kept for parity and therefore not
  declared in `CONTRAST_REQUIREMENTS`.
- **Switch pattern (9.15).** Every `Switch` spreads `themedSwitchProps(t, value, lightProps)`
  (`theme/switchColors.ts`) and sets `key={t.scheme}`. Light returns `lightProps` verbatim
  (`{}` where the site used platform defaults). Dark returns `trackColor
  { false: borderStrong, true: primary }`, `thumbColor` on `textOnPrimary` / off
  `textSecondary`, and `ios_backgroundColor: borderStrong`. `FORM_SWITCH` and
  `NOTIFICATION_SWITCH` dark values mirror these tokens.
- **Crowd scale (B1-1).** `CrowdCalendar`'s `CROWD_LEVEL` is a rule-V data scale and stays
  mode-invariant even where white text on it is below 4.5:1: applying the F fallback would
  map Quiet and Below-average to the same `green.fill` and merge two scale levels. Its
  contrast is identical to light. Rule V's F fallback applies only when the scheme change
  itself causes the failure.
- **starRating/amber as a fill behind white (B2-1).** It uses `DARK_TONAL.amber.fill`, like a
  rule-4 status fill (white on it is already a Property 9 pair).
- **`#3d1c5c` as a border (B7).** `primaryFg`'s light value is `#5b2a86`, so a `#3d1c5c`
  border on a surface is a palette pair `{ light: '#3d1c5c', dark: primaryFg }`.
- **Dark-only placeholder colour (B3-N1, B4-6).** For a `TextInput` that set no placeholder
  colour before, `placeholderTextColor={t.scheme === 'dark' ? t.color.textSecondary :
  undefined}` is the sanctioned form, because it keeps the platform default in light
  (Property 8).

### (Retrofit) Regression guard — `src/test/themeGuard.ts` + `src/__tests__/themeRetrofit.guard.test.ts` (new)

`themeGuard.ts` is pure. It exports these:

- `scanSource(relPath, source): Violation[]`, where
  `Violation = { file, line, rule: 'hex' | 'chromaticRgb' | 'staticToken' | 'staticImport' | 'namespaceImport', match }`
- `ARTWORK_AND_TOKEN_FILES`
- `THEME_INTERNALS`
- `PALETTE_FILE = /\.palette\.ts$/`

**Scan set.** `apps/mobile/src/**/*.{ts,tsx}`, excluding `__tests__/`, `__testSupport__/`,
`*.test.ts(x)`, `src/test/**` and `*.d.ts`. Paths are POSIX and relative to `src`.

**Preprocessing.** Strip `/* */` blocks, full-line `//` comments and full-line JSDoc `*` lines.
Then remove `/shadowColor:\s*(['"])#0{3}(?:0{3})?\1/g`. A hex inside a trailing comment is a
violation, and the comment gets reworded.

**Rules.**

| Rule | Pattern | Allowed in |
| --- | --- | --- |
| `hex` | ``(['"`])#(?:[0-9a-fA-F]{3,4}\|[0-9a-fA-F]{6}\|[0-9a-fA-F]{8})\1`` | `ARTWORK_AND_TOKEN_FILES`, `*.palette.ts` |
| `chromaticRgb` | `rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})` where the triple is not `255,255,255` or `0,0,0` | `ARTWORK_AND_TOKEN_FILES`, `*.palette.ts` |
| `staticToken` | `\btheme\.(color\|gradient\|shadow\|parkAccent\|categoryVisual\|resortVisual)\b`, or destructuring those keys from `theme` | `theme/theme.ts` |
| `staticImport` | `STATIC_IMPORT_RE` below. Split group 1 on `,`, trim, and strip a leading `type `. Flag a specifier matching `/^theme\s+as\s+\w+$/` (an aliased `theme` would bypass `staticToken`; iteration 3). Otherwise strip a trailing `as <alias>` and flag any name in `FORBIDDEN_THEME_IMPORTS` | `THEME_INTERNALS`, `*.palette.ts` |
| `namespaceImport` | `NAMESPACE_IMPORT_RE` below (any match) | `THEME_INTERNALS` |

```typescript
// Run over the whole preprocessed source, so multi-line import lists match.
export const STATIC_IMPORT_RE =
  /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"](?:\.\.?\/)+(?:theme\/)?theme['"]/g;
export const NAMESPACE_IMPORT_RE =
  /import\s+\*\s+as\s+\w+\s+from\s*['"](?:\.\.?\/)+(?:theme\/)?theme['"]/g;
export const FORBIDDEN_THEME_IMPORTS = ['color', 'gradient', 'shadow', 'parkAccent',
  'categoryVisual', 'resortVisual', 'lightColor', 'darkColor', 'lightTheme', 'darkTheme',
  'themes', 'DARK_TONAL'] as const;
```

**Allowlists (exact):**

- `ARTWORK_AND_TOKEN_FILES` = `theme/theme.ts`, `components/pins/motifPaths.ts`,
  `components/pins/pinArt.ts`, `components/pins/pinRenderModel.ts`,
  `components/pins/pinTierMeta.ts`, `components/pins/PinView.tsx`,
  `avatars/AvatarPresets.tsx`, `screens/catalog/destinationVisuals.ts`.
- `THEME_INTERNALS` = `theme/theme.ts`, `theme/useAppTheme.ts`, `theme/makeStyles.ts`,
  `theme/appearance.ts`, `theme/AppearanceChrome.ts`.

**Test assertions.**

1. There are zero violations outside the allowlists and `PENDING_RETROFIT`.
2. Every allowlist entry exists on disk.
3. Every `*.palette.ts` passes three checks:
   - It contains `definePalette(`.
   - Every `export` matches `^export const [A-Z][A-Z0-9_]* = definePalette\(`.
   - It contains no `StyleSheet`, `function`, `=>` or JSX.
4. Every `PENDING_RETROFIT` entry exists.
5. When `PENDING_RETROFIT` is empty, `Object.keys(theme)` deep-equals
   `['spacing','radius','layout','typography']`, and no legacy colour export exists.

**Migration mode.** `PENDING_RETROFIT: Record<'B1'…'B7', readonly string[]>` holds the batch
file lists below. Batches don't edit it. They self-check with
`$env:THEME_GUARD_STRICT='<id>'; npx jest src/__tests__/themeRetrofit.guard.test.ts --maxWorkers=2`.
Task 10.1 deletes the map and the env handling, and makes assertion 5 unconditional.

### (Retrofit) Batch decomposition (W2 — disjoint file sets, all under `apps/mobile/src/`)

**W1 (task 8, sequential) owns these files:**

- `theme/components.tsx`, `theme/charts.tsx`
- `components/{ActiveTripShortcut, DatePickerField, ResortPicker, TimeWheelPicker}.tsx`
- `features/notifications/{AttentionBadge, AttentionItemRow, NotificationBell}.tsx`
- `navigation/{RootNavigator, ExploreStack, TripsStack, CollectionStack, YouAndCrewStack, StatsStack}.tsx`
- `screens/quickAction/{MagicFab, QuickActionSheet}.tsx`
- `screens/AppearancePreferenceControl.tsx`
- Tests: `src/__tests__/navigation.test.tsx` and `src/navigation/__tests__/*`
- **Test ownership (iteration 3).** W1 also owns, by the first-segment rule below, every
  `__tests__/` file whose first dot-separated filename segment is a W1 file's basename. Today
  that is:
  - `components/__tests__/{ActiveTripShortcut, DatePickerField, ResortPicker, TimeWheelPicker}.test.tsx`
  - `screens/notifications/__tests__/AttentionItemRow.test.tsx`
  - `screens/__tests__/AppearancePreferenceControl{,.prop}.test.tsx`
  - `theme/__tests__/{charts, components.card, components.gradientHeader}.test.tsx`

  W1 also owns two tests explicitly:
  - `screens/quickAction/__tests__/quickActionComponents.test.tsx` (renders `MagicFab` and
    `QuickActionSheet`)
  - `screens/notifications/__tests__/notificationNavigation.test.tsx` (renders
    `RootNavigator`, `AttentionBadge` and `NotificationBell`)

**W2 batches:**

- **B1:** `screens/catalog/{ExploreHubScreen, DestinationScreen, ParkDestinationScreen, ResortsDirectoryScreen, ResortGuideSection, CrowdCalendarScreen, LocationGroupSection, TodayInParkLens}.tsx`, plus `screens/catalog/destinationVisuals.ts`.
- **B2:** `screens/catalog/{ExperienceDetailScreen, QuickSpecsRow, LensSwitcher, LiveStatusStrip, LiveWaitCockpit, FloatingActionDock, PassportAndLoreLens, ParkPassportCard, AboutSection, WaitInsightsSection, VirtualQueueBanner, ShowtimesCard, DiningReservationCard, YourVisitCard, VisitHistoryTimeline, CompletionControls, RatingControl, NoteControl, FavoriteToggle, MenuScreen, MenuSummaryCard}.tsx`, `screens/catalog/live/{DiningSection, ForecastChart, liveSectionShared, RideLiveSection, ShowtimesSection}.tsx`, and `screens/liveWaits/LiveWaitsScreen.tsx`.
- **B3:** `screens/catalog/{AddToTripOrListChoiceSheet, AddToTripPickerSheet, CreateLocationModal, FoodItemLogHistorySheet, FoodItemPickerModal, LogFoodItemModal, LogVisitModal, MyFoodHistoryScreen, RateExperienceModal, RestaurantDishLogCard, RestaurantFoodLogsSheet}.tsx`, `screens/foodLists/*.tsx`, and `screens/experienceLists/*.tsx`.
- **B4:** `screens/trips/{TripScheduleScreen, TripExpensesScreen, ExpenseFormModal, TripBalancesScreen, SettlementModal, RefundModal, ReceiptReviewModal}.tsx`.
- **B5:** `screens/trips/{AttachedExperienceListsSection, AttachedFoodListsSection, ExperiencePicker, GroupFavoritesSection, ResortPickerModal, RodeWithConfirmScreen, TripDetailScreen, TripEditScreen, TripFeedScreen, TripGuestManagementModal, TripInviteScreen, TripMembersScreen, TripPlannedListScreen, TripReservationsScreen, TripsListScreen, TripSummaryScreen}.tsx`.
- **B6:** `screens/home/*.tsx`, `screens/collection/CollectionScreen.tsx`, `screens/profile/*.tsx` (UI around pin art only), `screens/share/*.tsx`, and `screens/notifications/NotificationCenterScreen.tsx`.
- **B7:** `screens/stats/**/*.tsx` and `screens/stats/statsView.ts`, `screens/friends/*.tsx`, `screens/navigation/*.tsx`, `screens/youAndCrew/YouAndCrewScreen.tsx`, and `screens/{AvatarPicker, ChangePasswordControl, ForgotPasswordScreen, LoginScreen, ProfileScreen, PushNotificationPreferenceControl, RegisterScreen, ResetPasswordScreen}.tsx`. B7 also owns the cross-cutting test `screens/catalog/__tests__/consumerSurfacesTaxonomy.test.ts`.

**Ownership rules:**

- A batch edits only its files, the test files it owns, and new `<File>.palette.ts` files next
  to owned files.
- **Test ownership is exact.** A batch owns a test file when either of these holds:
  - it sits in a `__tests__/` directory and the first dot-separated segment of its filename
    equals the basename of an owned file
    (`ExperienceDetailScreen.recreationExperience.test.tsx` → `ExperienceDetailScreen.tsx`);
  - it's in an explicit cross-cutting assignment:
    - **B7:** everything under `screens/stats/**/__tests__/` and
      `screens/stats/__testSupport__/` (e.g. `orderingDeterminism.prop.test.ts` calls
      `buildParkTiles`/`buildCategoryTiles`), plus
      `screens/catalog/__tests__/consumerSurfacesTaxonomy.test.ts` and
      `screens/catalog/__tests__/shareEntryPointProjection.prop.test.tsx`.
    - **B4:** `screens/trips/__tests__/TripScheduleScreen.test.tsx`.
  - Any other failing test that the batch doesn't own is a stop-and-report.
- It makes no exported-signature changes. The one exception is a pure view model whose callers
  are all in the same batch.
- Unlisted `.ts` helpers are frozen. If one embeds a colour, the batch stops and reports it.
- Allowlisted artwork files have no owner, with one exception:
  `screens/catalog/destinationVisuals.ts`. B1 edits it only to remove `accent`. Its gradient
  literals stay, and it stays allowlisted. B6 creates `screens/profile/tierText.palette.ts`,
  which reads `pinTierMeta.ts` without editing it.

**Light-colour multiset audit (iteration 3, binding; runs for W1 tasks 8.1–8.3 and every W2
batch; identical to `.agents/tasks/dark-mode-retrofit/design.md`; amended in iteration 4 for
named-import reads, palette aliases, numeric alpha and exemptions).** Before editing, the
executor copies its owned files to `$env:TEMP\dark-mode-snapshot\<batch>\`, outside the repo.
After converting, it runs this check as a stdin `node -` script from the repo root, so no file
is written. Then it deletes the snapshot.

```text
Loader: transform theme/theme.ts and each referenced *.palette.ts with
  require('esbuild').transformSync(src, { loader: 'ts', format: 'cjs' }) and evaluate it with a
  custom require: relative imports load recursively the same way; 'react-native' resolves to
  { StyleSheet: { hairlineWidth: 1, create: (s) => s } }; any other bare import resolves to {}.
  (esbuild is hoisted at the repo root as tsx's dependency.) LT = the loaded lightTheme.

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
  Normalise: lowercase; #rgb → #rrggbb. (iteration 4: numeric, replacing the earlier
  whitespace-strip) Parse each rgb()/rgba() channel and its alpha with Number() and re-emit
  as `rgba(r,g,b,a)` using JS default number formatting (`rgb(r,g,b)` → `rgba(r,g,b,1)`), so
  `0.10` ≡ `0.1` and `1` ≡ `1.0`. Example: `TripPlannedListScreen.tsx:1186`
  `'rgba(91, 42, 134, 0.10)'` and its rule-2 conversion `withAlpha(t.color.primary, 0.10)`
  (which renders `rgba(91, 42, 134, 0.1)`) both normalise to `rgba(91,42,134,0.1)`.
  Exemptions (iteration 4: replaces the earlier "counted only if they were also in
  before(F)" wording, which read two ways): a rule-5 exempt literal (black shadowColor, or a
  neutral rgba(255,255,255,a) / rgba(0,0,0,a) left as a literal) is counted on BOTH sides
  like any other literal. An exempt literal present in F but absent from S is a new literal
  and is listed as a difference.
  PASS iff before(F) == after(F) as multisets.
```

*Audit notes (iteration 4).* A bare-name match on a local variable that shadows an imported
name (e.g. a parameter named `color`) is a false match; list it as a difference justified
"shadowed local". Palette records are read only in the forms the audit sees (inline, or
through one `const` alias; see the consumer pattern's palette read-form rule); a destructured
palette record is not allowed.
*(Iteration 5)* Fixture: `withAlpha(t.color.primary, 0.10)` → after contributes exactly
`rgba(91,42,134,0.1)` (not also `#5b2a86`); a rule-5 veil `withAlpha(t.color.surface, a)`
likewise contributes only its rgba value, not an extra `#ffffff`.

Every difference is listed in the report with its rule-based justification. Examples:

- `categoryVisual[*].tint` → `.fill` (rule 1 split)
- `TIER_COLOR[*]` → `TIER_TEXT[*]` (rule 7)
- `destinationVisuals` `accent` → `parkAccent[*]` (rule 6)
- a dark-only `outline.card`/`textDefault` spread, which contributes no light colour

**An unexplained difference fails the task.** Rule-1a conversions keep the light value, so they
produce no difference. Existing light assertions in tests are only a thin secondary net: a
repo search finds 6 hex colour assertions in 4 mobile test files and no `rgba` assertions.

## Data Models

No database table, no DTO, no Zod schema — this feature has no backend or `packages/shared`
surface at all (confirmed scope: mobile-only, local-only). The only "data model" is the
`AppearancePreference` enum (`appearance.ts`, above) and its AsyncStorage serialization (a raw
string under one key, Configuration & Constants below).

## Correctness Properties

### Property 1: Fallback Is Total — Every Non-Valid Stored Value Resolves to the Default

*For any arbitrary string (fast-check `fc.string()`, plus the explicit `null`/`undefined` cases)
that is not exactly `'system'`, `'light'`, or `'dark'`, `isAppearancePreference` returns `false`,
and `getStoredAppearancePreference()` (with `AsyncStorage.getItem` mocked to return that string)
resolves to `DEFAULT_APPEARANCE_PREFERENCE` without throwing.*

**Validates:** Requirements 1.2, 3.3

### Property 2: A Pinned Preference Is Invariant Under Any OS Scheme Change

*For any fixed preference value in `{'light', 'dark'}` and any sequence of OS color-scheme values
(fast-check `fc.array(fc.constantFrom('light','dark',null,undefined))`), `resolveActiveTheme`
applied to that fixed preference against every scheme in the sequence returns the same value
(the preference itself) every time; only `'system'` lets the OS value flow through.*

**Validates:** Requirements 2.1, 2.2

### Property 3: Chrome Triple Is a Pure, Total Function of Preference and OS Scheme

*For any `(preference, osScheme)` pair (fast-check `fc.constantFrom('system','light','dark')` ×
`fc.constantFrom('light','dark',null,undefined)`), the derived chrome triple returned by
`deriveAppearanceChrome(resolveActiveTheme(preference, osScheme))` — the React Navigation `theme`
passed to `NavigationContainer` (`DefaultTheme`/`DarkTheme`), the `expo-status-bar` `style`
(`resolveStatusBarStyle`'s output), and the root background
(`LIGHT_ROOT_BACKGROUND`/`DARK_ROOT_BACKGROUND`) — is fully determined by
`resolveActiveTheme(preference, osScheme)` alone: whenever two different `(preference, osScheme)`
pairs resolve to the same Active theme, their triples are identical, and the triple always matches
the Active theme's expected light/dark values with no third combination ever occurring. This is
Requirement 6's "chrome follows the Active theme" guarantee, stated as a property over the full
input domain rather than two hand-picked cases, and tested against the real exported
`deriveAppearanceChrome` function (not a stand-in — see Components and Interfaces and the
Testing Strategy's `App.appearance.test.tsx` entry).*

*Superseding note (retrofit amendment): the dark navigation theme is no longer `DarkTheme`.
It's the token-built theme from Property 12. The "fully determined by the Active theme"
invariant in this property still holds unchanged. Task 7.4 updates `App.appearance.test.tsx`'s
`toBe(DarkTheme)` assertions.*

**Validates:** Requirements 6.1, 6.2, 6.3

### Property 4: Appearance Control Selection Always Agrees With Store State

*For any sequence of selections among the three options (fast-check
`fc.array(fc.constantFrom('system','light','dark'), { minLength: 1, maxLength: 10 })` applied via
repeated `fireEvent.press` on `AppearancePreferenceControl`), after each selection in the sequence
is applied in order, the `Chip` whose `value` equals the just-selected option exposes
`accessibilityState.selected: true`, every other `Chip` exposes `false`, and
`useThemeStore.getState().preference` equals that same value — the rendered control and the store
are never observed out of agreement at any point in the sequence, including when the same option
is selected twice in a row or the sequence revisits an earlier option.*

**Validates:** Requirements 4.2, 4.3, 5.2

### Property 5: Every Option Is Labeled and Operable Regardless of Selection State

*For each of the three options crossed with both selection states (fast-check
`fc.constantFrom('system','light','dark')` × `fc.boolean()` driving which option is rendered as
active), the corresponding `Chip` renders with `accessibilityRole="button"` and a non-empty spoken
`accessibilityLabel` containing the option's visible name, independent of whether that option is
the currently-selected one — i.e. losing selection never strips an option's label or role, and
gaining it never replaces the label with something that omits the option's name.*

**Validates:** Requirements 5.1, 5.3

### Property 6: Appearance_Preference Is Invariant Under Any Session Token Change

*For any starting `preference` value in `{'system', 'light', 'dark'}` and any sequence of session
mutations (fast-check `fc.array(fc.constantFrom('setToken', 'clearToken'), { minLength: 1,
maxLength: 10 })`, each `'setToken'` applying an arbitrary non-empty token string) applied via
`useSessionStore.getState().setToken(...)`/`.clearToken()` in order, `useThemeStore.getState()
.preference` is unchanged before and after the entire sequence. This holds by construction —
`themeStore.ts` and `appearanceStorage.ts` import nothing from `state/sessionStore.ts` or
`api/sessionStorage.ts` and read no session-scoped data — but is asserted as an explicit test
rather than left as an unverified inference, since `sessionStore.clearToken()`/`setToken()` are
exactly the two mutations Requirement 3.4's "signing out and back in, or switching between User
accounts" describes.*

**Validates:** Requirement 3.4

### Property 7: Light/Dark Token Key Parity

*For every token group (`color`, `gradient`, `shadow`, `outline`, `parkAccent`,
`categoryVisual`, `resortVisual`, `tabBar`), `lightTheme` and `darkTheme` have identical key
sets. Every gradient tuple has the same length in both schemes. Every colour value is a valid
`#rgb`/`#rrggbb`/`rgb()`/`rgba()` string. `categoryVisual[k].glyph`/`.label` are identical
across schemes and equal `categoryMeta[k]`.* (fast-check `fc.constantFrom` over groups × keys,
at least 100 runs.)

*Iteration 3 additions: `gradient` includes `fab` and `chartBar` in both schemes; every
`categoryVisual[k]` and `resortVisual` has `tint` and `fill` in both schemes; every `color.*`
value in both schemes matches `/^#[0-9a-f]{6}$/` (rule 2a).*

*Iteration 4 addition: the same `/^#[0-9a-f]{6}$/` assertion covers every `parkAccent.*`
value and every `categoryVisual[k].tint`, `categoryVisual[k].fill`, `resortVisual.tint` and
`resortVisual.fill` value, in both schemes, because the generalised rule 2a lets code suffix
any of them with an alpha.*

**Validates:** Requirements 7.1, 7.3

### Property 8: Light Theme Is Byte-Identical to the Pre-Retrofit Palette

*Every `lightTheme` value (colour, gradient, shadow, parkAccent, category tints, resortVisual
tint, tab tints, badge) equals the "Light" column of Configuration & Constants exactly.
`lightTheme.color.primaryFg === lightTheme.color.primary`. `lightTheme.outline.card` and
`lightTheme.textDefault` are `{}`. `buildNavigationTheme(lightTheme) === DefaultTheme`.*

*Iteration 3 additions:*

- *`lightTheme.categoryVisual[k].fill === .tint` for every `k`, and the same holds for
  `resortVisual`.*
- *`lightTheme.gradient.fab` and `.chartBar` both deep-equal `['#7e57c2','#5b2a86','#3d1c5c']`.*
- *`lightTheme.gradient.header` deep-equals `['#5b2a86','#3d1c5c']`.*
- *`lightTheme.color.primaryLight === '#7e57c2'`.*
- *`withAlpha('#5b2a86', 0.14) === 'rgba(91, 42, 134, 0.14)'`.*

**Validates:** Requirements 7.2, 9.2, 10.2

### Property 9: Declared Contrast Floors Hold

*For every `(fg, bg, min)` in `CONTRAST_REQUIREMENTS` (`theme/contrast.ts`: the dark pairs in
Configuration & Constants, including `DARK_TONAL` fg-on-surface, fg-on-tint and white-on-fill),
`contrastRatio(fg, bg) >= min`. As a generator property over arbitrary hex pairs,
`contrastRatio` is symmetric, lies within `[1, 21]`, and equals 21 for black/white.*

*Iteration 3 additions to the table (Configuration & Constants "(Retrofit) Iteration 3
pairs"):*

- *min 4.5:*
  - *`primaryLight` badge text on its tint over surface / surfaceAlt / background;*
  - *white on every dark category `fill` and on `resortVisual.fill`;*
  - *the rule-1a pairs.*
- *min 3.0:*
  - *`gradient.chartBar` stops vs `surface`;*
  - *`primaryFg` and `primaryLight` vs `surfaceAlt`;*
  - *`gradient.header` and `gradient.fab` stops vs `surface`;*
  - *white on every `gradient.fab` stop.*

*Iteration 4 additions (min 3.0, criterion 7.5 scope): `gradient.header` stops vs
`background` (3.70 / 3.32), and the Chip-active fill `primary` vs `surface` and vs
`background` (3.36 / 3.70). The `surfaceAlt` values (2.98 / 2.67 / 2.98) are recorded in
Configuration & Constants but are not entries, because 7.5 is scoped to `surface` and
`background`.*

**Validates:** Requirements 7.4, 7.5, 9.8

### Property 10: Active Theme Resolution Is Total and Consistent

*For any `(preference, osScheme)` in `{'system','light','dark'} × {'light','dark',null,undefined}`,
a probe rendering `useAppTheme()` receives `themes[resolveActiveTheme(preference, osScheme)]`
by identity, and `.scheme` equals that Active theme. The OS scheme is driven by
`setTestOsScheme` over the descriptor-copy `useColorScheme` mock (Testing Strategy).*

**Validates:** Requirements 8.1, 8.2

### Property 11: `makeStyles` Is Lazy and Memoized per Scheme

*For any sequence of scheme switches (`fc.array(fc.constantFrom('light','dark'), {minLength: 1,
maxLength: 12})`) applied to a mounted probe:*

- *the factory runs zero times before first render (including at `require` time),*
- *it runs at most once per distinct scheme,*
- *renders under the same scheme return the identical (`===`) object,*
- *its colour values equal that scheme's tokens,*
- *its non-colour values (spacing, typography) are identical across schemes.*

**Validates:** Requirements 8.3, 8.4

### Property 12: Navigation Chrome Is Derived From Tokens

*For each Active theme `s`:*

- *`deriveAppearanceChrome(s).rootBackground === themes[s].color.background`.*
- *Light `navigationTheme === DefaultTheme`.*
- *Dark `navigationTheme` is `{ dark: true, colors: { primary: primaryFg, background, card:
  tabBar.background, text: textPrimary, border: tabBar.border, notification: danger } }` of
  `darkTheme`.*
- *`DARK_ROOT_BACKGROUND === '#120a1f'`.*

**Validates:** Requirements 10.3, 10.4, 6.1, 6.3

### Property 13: Tab Bar and MagicFab Follow the Active Theme

*For each scheme, rendering the authenticated `RootNavigator` with a non-zero claimable-pin
count gives these results:*

- *the focused tab icon `color === tabBar.activeTint`, and every unfocused icon
  `=== tabBar.inactiveTint`;*
- *the Vault badge style has `backgroundColor === tabBar.badgeBackground` and
  `color === tabBar.badgeText`;*
- *light yields `#003a9b`/`#6b7280`/`#d97706`/`#ffffff`, and dark yields
  `#f6c343`/`#8a7fa3`/`#f6c343`/`#3d1c5c`;*
- *the rendered `MagicFab` gradient `colors` equal `t.gradient.headerVivid` (**superseded in
  iteration 3:** `t.gradient.fab`, which in light deep-equals `['#7e57c2','#5b2a86','#3d1c5c']`
  and in dark `['#9d7ae0','#7e57c2','#7650b9']`).*

**Validates:** Requirements 10.1, 10.2, 10.5

### Property 14: Every Palette Pair Is Complete and Valid

*For every exported palette in every `*.palette.ts` (discovered by filesystem scan and
`require`d), `light` and `dark` have equal key sets, and every value is a valid colour string.
For every such value, and every colour value of `lightTheme`/`darkTheme`/`DARK_TONAL`,
`withAlpha(value, 0.14)` does not throw.*

**Validates:** Requirements 9.4, 11.3

### Property 15: Regression Guard Is Sound and the Tree Is Clean

*For generated fixture sources (3/6/8-digit hex in any quote style, arbitrary rgba triples,
`theme.<group>.<key>` reads, named imports of each forbidden specifier (single- and
multi-line, with and without `type`/`as <alias>`), an aliased `import { theme as T }` from the
theme module (iteration 3), and `import * as X from` the theme
module), `scanSource` reports the matching rule for a non-allowlisted path and nothing for an
allowlisted path. It never reports neutral white/black `rgba`, `shadowColor: '#000'`, or a
named import of a non-forbidden specifier such as `spacing` or `definePalette`. On the real tree, there are
zero violations outside `PENDING_RETROFIT`, and every allowlist and pending entry exists.*

**Validates:** Requirements 11.1, 11.2, 11.4, 11.5

### Property 16: Kit Primitives Render With the Active Theme's Tokens

*For each kit primitive × scheme, the flattened rendered colour props equal the "Shared kit
token mapping" table for that scheme. Examples:*

- *Card bg `surface`, with a dark `borderColor === border` and no light `borderWidth`*
- *Chip active bg `primary` with text `textOnPrimary`*
- *SecondaryButton label `primaryFg`*
- *Badge default text `primaryFg`*
- *ScreenContainer bg `background`*
- *GradientHeader `colors === gradient.headerVivid`*
- *ProgressRing track `surfaceAlt`*
- *(iteration 3) RatingHistogram bars `colors === gradient.chartBar`, ProgressBar default fill
  `primaryFg`, ProgressRing default arc `[primaryLight, primaryFg]`, PrimaryButton
  `colors === gradient.header`; each deep-equals today's literal values under light*

**Validates:** Requirements 7.5, 9.1, 9.3

### Property 17: A Mounted Tree Repaints Live Without Remount

*For any sequence of preference changes with the OS scheme mocked to `'dark'` (the
descriptor-copy mock plus `setTestOsScheme('dark')` before first render), a mounted
`ScreenContainer > Card > Chip` tree keeps the same host instances (`===` refs). After each
change, they report the colours of `themes[resolveActiveTheme(pref, 'dark')]`.*

**Validates:** Requirements 8.2, 9.1

### Property 18: Artwork Is Invariant Across Schemes

*For every pin tier fixture rendered by `PinView` and every avatar preset id, the serialized
render tree under light equals the tree under dark.*

**Validates:** Requirement 9.5

### Property 19: Native and Third-Party Controls Receive Themed Props; Default Text Is Dark-Only

*For each scheme, rendering the real `DatePickerField` (opened) and `ResortPicker` gives these
results:*

- *the `Calendar` receives `theme.calendarBackground === surface`,
  `dayTextColor === textPrimary`, `selectedDayBackgroundColor === primary`, and
  `arrowColor === primaryFg` for that scheme;*
- *the `Calendar`'s React `key` differs between schemes, so switching the scheme on a mounted
  picker yields a new `Calendar` instance;*
- *the search `TextInput` has `placeholderTextColor === textSecondary` and
  `keyboardAppearance === scheme`;*
- *its flattened style `color` is `textPrimary` in dark and absent in light, matching
  `t.textDefault`.*

*A second case renders, under dark, a nested `<Text>` inside a coloured parent `Text`, and a
plain `Text` on a G-role gold fill. Neither gets `color: textPrimary`: the nested one keeps the
inherited colour, and the one on gold has no `color` set. This covers the Requirement 9.7
amendment.*

**Validates:** Requirements 9.6, 9.7

### Property 20: Memoized and Virtualized Consumers Repaint Live

*For any sequence of scheme switches (`fc.array(fc.constantFrom('light','dark'), {minLength:
1, maxLength: 8})`, at least 100 runs) applied with `setTestScheme` to a mounted probe, every
probed host instance reports the current scheme's token value after each switch, without a
remount. The probe combines:*

- *a `useMemo` over `styles` (with `styles` in deps);*
- *a `useCallback` `renderItem` passed to a `FlatList` with `extraData={t.scheme}`;*
- *a `React.memo` row styled by prop;*
- *a `useLayoutEffect` calling a mocked `navigation.setOptions` with
  `headerStyle.backgroundColor`.*

*A control variant that omits `styles` from the `useMemo` deps does **not** repaint, which
proves the probe detects the defect. Each batch also adds one instance on its designated list
screen: mount under light, `setTestScheme('dark')` without remounting, and the row colour
equals the dark value.* Test file: `theme/__tests__/consumerPatterns.prop.test.tsx`.

**Validates:** Requirements 8.2, 8.5

### Property 21: Pin Tier UI Text Is Legible While Tier Art Is Unchanged

*For every `PinTier`:*

- *`TIER_TEXT.light[tier] === TIER_COLOR[tier]`;*
- *`TIER_TEXT.dark[tier]` reaches at least 4.5:1 as badge text on its 14 % tint over
  `surface`, `surfaceAlt` and `background` (via `CONTRAST_REQUIREMENTS`);*
- *a rendered `PinDetailModal` tier `Badge` text `color` equals `TIER_TEXT[scheme][tier]`;*
- *the `PinView` subtree is identical across schemes.*

Test file: `screens/profile/__tests__/PinDetailModal.tierText.test.tsx`.

**Validates:** Requirements 9.5, 9.9

### Property 22: Role-Converted Token Reads and Category Fills Stay Legible in Dark

*For every category `k` (`fc.constantFrom(...EXPERIENCE_CATEGORIES)`, at least 100 runs) and
`resortVisual`, `contrastRatio('#ffffff', darkTheme.categoryVisual[k].fill) >= 4.5` and the
light fill equals the light tint. For each rendered site under each scheme:*

- *the `ExploreHubScreen` category placeholder tile has `backgroundColor ===
  t.categoryVisual[k].fill` and a glyph `color === textOnPrimary` (B1);*
- *`MarkGottenUndoToast` has toast `backgroundColor === '#1f1235'`, message
  `color === '#ffffff'` and Undo `color === accent` (B3, `MarkGottenUndoToast.test.tsx`);*
- *`TripReservationsScreen`'s active chip text is `color === textOnPrimary` on
  `backgroundColor === primary` (B5, `TripReservationsScreen.test.tsx`).*

*Under light, every asserted value equals the pre-retrofit value. The pure half lives in
`theme/__tests__/theme.tokens.test.ts` (task 7.6).*

**Validates:** Requirements 9.10, 9.11

### Property 23: Dark Selected States and Text Hierarchy Are Preserved

*For each polish-pass site, rendered under dark: the selected/active indicator's colour is
not equal to the unselected sibling's, and `contrastRatio(selected, surface) >= 3` (ParkWaitPulse
ring, ShareComposer ring, Expenses/Balances active pill and label, tier count pill border,
showtime pill border); the active tab/toggle label's contrast against the track is not lower
than the idle label's; each listed component's muted copy is `textSecondary` while its
heading/ink is `textPrimary`; and the Resorts on-photo tier badges equal their light fills.
Under light, every asserted value equals the pre-polish value. The declared pairs are added to
`CONTRAST_REQUIREMENTS`, so Property 9 re-checks them.*

**Validates:** Requirements 9.12, 9.13, 9.14

### Property 24: Every Switch Is Themed in Dark and Unchanged in Light

*For every `value: boolean` and every generated light-props object (fast-check, at least 100
runs), `themedSwitchProps(lightTheme, value, light)` returns `light` itself, and
`themedSwitchProps(darkTheme, value, light)` returns `trackColor { false: borderStrong, true:
primary }`, `ios_backgroundColor: borderStrong` and `thumbColor` `textOnPrimary` when on /
`textSecondary` when off, with each thumb at least 3:1 on its own track
(`theme/__tests__/switchColors.test.ts`). Each of the six `Switch` sites renders those dark
props, renders today's props (platform defaults where it set none) in light, and remounts on a
live scheme switch.*

**Validates:** Requirement 9.15

### Property 25: The Native Window Background Tracks the Active Theme

*This extends Property 3's chrome triple to a chrome tuple of four: the native window/root view
background equals `rootBackground`. For each Active theme, mounting the real `App` calls
`expo-system-ui`'s `setBackgroundColorAsync` exactly once, with `deriveAppearanceChrome(s)
.rootBackground` (`'#120a1f'` dark, `'#f5f2fb'` light). Every Active theme change while `App` stays
mounted (light → dark → light) calls it once more, with the new value. A re-render that leaves the
Active theme unchanged does not call it again. A rejected call is logged with `console.warn`, and
`App` stays mounted (`src/__tests__/App.systemUI.test.tsx`; `expo-system-ui` is the only module
mocked besides the navigator subtree and the push hooks).*

**Validates:** Requirements 6.5, 6.4

## Error Handling

| Failure | Recoverable? | Behavior | Logged? |
| --- | --- | --- | --- |
| `AsyncStorage.getItem` throws (e.g. storage backend unavailable) during `loadFromStorage()` | Recoverable | `getStoredAppearancePreference()` catches and returns `DEFAULT_APPEARANCE_PREFERENCE` (`'system'`); the store hydrates with the default and `hydrated: true` | No — not actionable by the User, and failing silently to the safe default is the correct behavior (Requirement 3.3) |
| Stored value present but not one of the three valid strings (corrupt — e.g. a future version wrote a 4th value, or a non-string JSON artifact) | Recoverable | `isAppearancePreference` returns `false`; same fallback to `'system'` as the above row | No |
| Stored value absent (key never written — first launch, or a User who never opened the control) | N/A — expected first-run state, not a failure | Same fallback to `'system'`, which is also Requirement 1.2's default | No |
| `AsyncStorage.setItem` throws during `setPreference(...)` | Recoverable | The in-memory `preference` has already been set via `set({ preference })` before the write is attempted, so the current session's UI reflects the new choice regardless; the write failure is swallowed. A subsequent cold start reads whatever was last successfully persisted (or falls back to the Requirement 3.3 default if nothing ever was) | No — this is a best-effort local write with no user-facing retry affordance in this spec; the User sees their change take effect immediately, which is the behavior Requirement 4.3 actually asks for |
| `useColorScheme()` reports `null`/`undefined` (web preview, or a device that hasn't reported a scheme yet) | Recoverable | `resolveActiveTheme` treats this as `'light'` (Requirement 1.3's explicit fallback) | No |
| User signs out, signs back in, or switches accounts (`sessionStore.clearToken()`/`setToken(...)`) while an Appearance_Preference is set | N/A — not a failure, a non-event for this feature | `themeStore`/`appearanceStorage` have no import of, or read access to, `sessionStore`/`api/sessionStorage`/the session token, so no session mutation can alter `preference` — the AsyncStorage-persisted value and the in-memory store are both untouched (Requirement 3.4; Property 6) | No |

No error in this feature is fatal or ever blocks app startup or navigation — every failure mode
resolves to a well-defined default rather than throwing past this module's boundary.

### (Retrofit) Error handling

| Operation | Failure | Recoverable? | Caller receives | Logged? |
| --- | --- | --- | --- | --- |
| `useAppTheme()`/`usePalette()` | Store not hydrated yet | Yes (expected) | The `'system'` resolution (Requirement 3.2's allowed first-frame window) | No |
| `useAppTheme()` | `useColorScheme()` returns `null`/`undefined` | Yes | Light theme (existing fallback) | No |
| `makeStyles` factory | Throws (programming error) | Fatal for that component | Render error propagates to the nearest boundary. Typed token access means `tsc` catches it first. | RN red box (dev) |
| `withAlpha` | Input isn't 3/6/8-digit hex, `rgb()` or `rgba()` | Fatal (programming error) | `Error('withAlpha: unsupported colour <value>')`. Property 14 proves that no token or palette value reaches it. | No |
| `definePalette` | Missing or extra dark key | Compile-time | `tsc` error; Property 14 backs it up at runtime | n/a |
| Guard test | Violation, or a stale allowlist/pending entry | Build-blocking | Jest failure listing `file:line rule match` or the stale path | Jest output |
| Calendar remount on scheme switch | Visible month resets | Accepted | Re-opens on the field's value/min/today month | No |
| Batch needs a shared/kit change | Out-of-ownership edit | Stop | The batch reports it and leaves its task unchecked. The integrator applies it serially. | Batch report |
| `SystemUI.setBackgroundColorAsync` (Requirement 6.5) | Native call rejects (module unavailable, activity gone) | Yes | Nothing. The window keeps its previous colour, and the React tree renders as normal. | `console.warn('expo-system-ui: setBackgroundColorAsync failed', error)` |

## Testing Strategy

**Unit-testable in isolation (no React, no mocks needed beyond the one I/O boundary):**
`appearance.ts`'s `isAppearancePreference`, `resolveActiveTheme`, and `resolveStatusBarStyle` are
pure functions over a 3-value and 2-value domain respectively.

- `apps/mobile/src/theme/__tests__/appearance.test.ts` — unit tests for every valid/invalid input
  to `isAppearancePreference` (including non-string types, empty string, a plausible-looking but
  wrong string), and every `(preference, osScheme)` combination for `resolveActiveTheme`
  (`'system'` × `{'light','dark',null,undefined}`, `'light'`/`'dark'` × same set, confirming the
  explicit preference always wins).
- **Property tests, judgment call:** `resolveActiveTheme` and `isAppearancePreference` each have a
  domain small enough (3 preference values × 4 OS-scheme values; a handful of string shapes) that
  exhaustive unit tests already cover every case directly and more legibly than a `fast-check`
  generator would. Per this repo's convention, the project still writes `fast-check` (≥100 runs)
  property tests for the two Correctness Properties above where a generator meaningfully adds
  coverage over hand-picked cases — arbitrary strings for the validator (Property 1), and
  arbitrary preference/scheme *sequences* for the "OS changes don't affect a pinned preference"
  property (Property 2) — rather than for every pure function mechanically.
  - Property 1 test location: `apps/mobile/src/theme/__tests__/appearance.prop.test.ts`
    (`// Feature: dark-mode, Property 1: fallback is total`), plus
    `apps/mobile/src/theme/__tests__/appearanceStorage.test.ts` (mocked AsyncStorage: missing key,
    throwing key, corrupt string — three explicit unit cases, Requirement 3.3's three named
    failure modes).
  - Property 2 test location: `apps/mobile/src/theme/__tests__/appearance.prop.test.ts`
    (`// Feature: dark-mode, Property 2: pinned preference is scheme-invariant`).
  - Property 3 (the chrome triple is a pure, total function of `resolveActiveTheme`'s output) is
    likewise a case where a generator earns its keep over the 2-value Active-theme domain by
    additionally covering the 4 (preference, osScheme)-pair *input* combinations that collapse
    onto each Active theme — asserting the collapse itself, not just the two output triples. Test
    location: `apps/mobile/src/__tests__/App.appearance.test.tsx`
    (`// Feature: dark-mode, Property 3: chrome triple is a pure function of Active theme`),
    alongside that file's existing two-case assertions (same file, Testing Strategy's "App Root
    Wiring" row below).
  - Property 4 (control selection always agrees with store state across an arbitrary sequence of
    presses) and Property 5 (every option stays labeled/operable regardless of selection state)
    are stateful/sequence properties where a generator genuinely explores order-dependent cases
    (repeats, revisits) that hand-picked cases would under-cover. Test location:
    `apps/mobile/src/screens/__tests__/AppearancePreferenceControl.prop.test.tsx`
    (`// Feature: dark-mode, Property 4: control selection always agrees with store state` and
    `// Feature: dark-mode, Property 5: every option is labeled and operable regardless of
    selection state`), rendering the real `AppearancePreferenceControl` with
    `@testing-library/react-native` and mocking only
    `@react-native-async-storage/async-storage`, per this repo's mobile component-test convention.

**Store/hook tests (I/O and React, mocked at the one AsyncStorage/useColorScheme boundary):**

- `apps/mobile/src/state/__tests__/themeStore.test.ts` — mocks
  `@react-native-async-storage/async-storage` via the package's own shipped jest mock. At the
  time of writing this design the package is not yet installed, so the exact mock subpath/export
  shape is **unverified**; the best current reference is the commonly-documented
  `@react-native-async-storage/async-storage/jest/async-storage-mock` path, but task 1.1 (right
  after `npm install`) MUST open `node_modules/@react-native-async-storage/async-storage/jest/`
  and confirm the real file name and export (default vs. named) before task 2.1 onward writes
  any test against it — if the path or shape differs, use the real one and note the correction in
  a one-line comment at the top of this test file so later test files (2.3/2.4/5.3/5.4) copy the
  corrected import, not this design's guess. Mirrors how `ProfileScreen.test.tsx` already mocks
  `expo-secure-store` per-file rather than globally in `jest.config.js`. Asserts: `loadFromStorage()` with nothing stored yields `'system'` and
  `hydrated: true`; `loadFromStorage()` with a corrupt stored string yields `'system'` (the
  regression-guarding "fallback-on-corrupt-storage" test the task explicitly calls for);
  `setPreference('dark')` updates `preference` synchronously and the mock storage reflects
  `'dark'` after the returned promise resolves; a simulated storage-write failure (mock rejects)
  still leaves the in-memory `preference` updated (Error Handling table, row 4); and the
  `fast-check` (≥100 runs) Property 6 test (`// Feature: dark-mode, Property 6:
  Appearance_Preference is invariant under any session token change`) that sets an initial
  `preference`, drives an arbitrary sequence of `useSessionStore.getState().setToken(...)`/
  `.clearToken()` calls, and asserts `useThemeStore.getState().preference` is unchanged
  throughout — the regression guard for Requirement 3.4 (Error Handling table, session-change
  row).
- `apps/mobile/src/theme/__tests__/useActiveTheme.test.tsx` — mocks `react-native`'s
  `useColorScheme` with the concrete, fully-specified pattern (spec-review Finding 4 — this
  codebase has zero existing `useColorScheme` usages/mocks to follow, so the exact form is spelled
  out here rather than left for the implementer to invent mid-task).

  **Superseded (correction, design-review iteration 3):** the spread form below crashes on RN
  0.85.3, because spreading `jest.requireActual('react-native')` eagerly invokes the lazy
  `DevMenu` getter. The shipped `useActiveTheme.test.tsx` uses the descriptor-copy mock
  instead. Use that form, given in "(Retrofit) Testing strategy" → "OS-scheme mocking". The
  snippet and paragraph below are kept unedited for history:

  ```typescript
  jest.mock('react-native', () => ({
    ...jest.requireActual('react-native'),
    useColorScheme: jest.fn(),
  }));
  import { useColorScheme } from 'react-native';
  const mockUseColorScheme = useColorScheme as jest.Mock;
  // in each test: mockUseColorScheme.mockReturnValue('dark'); then act(() => mockUseColorScheme.mockReturnValue('light'));
  // combined with a re-render (fireEvent/act or the host component re-rendering on its own
  // subscription) to simulate the live OS-scheme-change path, since the mock itself does not
  // replicate react-native's real useSyncExternalStore subscription — only the hook's React-visible
  // *return value* needs to change between renders for this test's purposes.
  ```

  `jest.requireActual('react-native')` spreads every real export (`StyleSheet`, `View`, `Platform`,
  Animated internals, etc.) before overriding only `useColorScheme`, so no other module the test
  tree depends on is shadowed — this directly resolves Finding 4's "a partial mock risks shadowing
  other RN exports" concern by using the full-spread-then-override form rather than a hand-rolled
  partial object. The test then drives the Zustand store directly via
  `useThemeStore.setState(...)`; renders a minimal host component calling the hook and exposing
  its return value via `testID`'s text content. Asserts the hook's value changes when either input changes, and that `'system'` +
  a live `useColorScheme` mock change re-renders with the new OS value (the "React to OS scheme
  changes live" requirement, Requirement 2.1) — simulated by having the mock return a new value
  and firing the mock's registered change listener/triggering a re-render, matching how
  `react-native`'s own `useColorScheme` is implemented as a subscription hook.

**Mobile component tests (`@testing-library/react-native`).** The repo's `tech-conventions.md`
steering says to "mock only the network/query layer, not the component under test" — it does not
itself carve out an AsyncStorage exception. This spec adds that exception explicitly here, as its
own reasoned addition (not an existing steering rule): AsyncStorage is, like the network/query
layer, an I/O boundary external to the component under test, and this feature has no
network/query layer of its own to mock, so AsyncStorage is the one I/O seam that stands in its
place. Mocking only `@react-native-async-storage/async-storage` (never the real `Chip`/`Card`
primitives or `AppearancePreferenceControl` itself):

- `apps/mobile/src/screens/__tests__/AppearancePreferenceControl.test.tsx` — renders the real
  component (no mocked child primitives); mocks only
  `@react-native-async-storage/async-storage` (via the package's jest mock, using the exact
  path/export verified in task 1.1 — see the `themeStore.test.ts` note above). For **each of the
  three states** (the task's explicit requirement): asserts the corresponding `Chip` renders with
  `accessibilityState.selected: true` and the other two `false`; `fireEvent.press` on each of the
  other two options updates the applied Active theme — asserted by re-querying
  `useThemeStore.getState().preference` after `waitFor`, since the component itself has no visual
  color output to assert on (that's the deferred per-screen retrofit) — and confirms the mocked
  storage received the write (`AsyncStorage.getItem(APPEARANCE_PREFERENCE_KEY)` resolves to the
  new value after the interaction settles).
- `apps/mobile/src/screens/__tests__/AppearancePreferenceControl.prop.test.tsx` (new) — the
  `fast-check` Properties 4 and 5 (≥100 runs each) described above, driving the real rendered
  control through an arbitrary sequence of option presses and asserting agreement with
  `useThemeStore.getState().preference` after each one, and asserting every option's label/role
  independent of selection state.
- Extend `apps/mobile/src/screens/youAndCrew/__tests__/YouAndCrewScreen.test.tsx` (**corrected** —
  originally written here as `ProfileScreen.test.tsx`, before this design doc's placement
  correction above; `ProfileScreen.test.tsx` has no Appearance assertion and is not the reachable
  screen) — asserts the Appearance card renders in self-mode (reusing the suite's existing
  self-mode render case) with all three `appearance-option-*` testIDs present, and (a quick
  negative check) that it does *not* render when `YouAndCrewScreen` is viewing a different User
  (friend/non-self mode), mirroring the suite's existing self/non-self distinction.
- `apps/mobile/src/__tests__/App.appearance.test.tsx` (new, small, focused) — **imports and calls
  the real, exported `deriveAppearanceChrome` from `theme/AppearanceChrome.ts`** (the same function
  `App.tsx` itself calls — see Components and Interfaces above; this directly resolves spec-review
  Finding 2's concern that a hand-rolled stand-in tree could silently diverge from the production
  wiring) to assert the (navigationTheme, statusBarStyle, rootBackground) triple is correct for
  both Active theme values, plus the `fast-check` Property 3 test (`// Feature: dark-mode,
  Property 3: chrome triple is a pure function of Active theme`, ≥100 runs) over the full
  `(preference, osScheme)` input domain, resolving each pair to an Active theme via
  `resolveActiveTheme` and feeding it to `deriveAppearanceChrome` directly. This test does not
  render the full `App.tsx` component tree (which still has no dedicated test and pulls in
  push-notification/navigation wiring unrelated to this feature) — but because `App.tsx` now
  delegates its chrome derivation entirely to this one exported, tested function rather than
  inlining equivalent logic, there is no second code path left to diverge: any future edit to
  `App.tsx`'s chrome wiring is, by construction, an edit to `deriveAppearanceChrome` (or it stops
  using it, which would be visible in review as `App.tsx` no longer importing it).

**What is explicitly not covered by a new per-screen visual test:** no test in this spec asserts
that any existing screen's rendered colors change under `'dark'`, because none of them do yet
(Introduction's Scope decision) — asserting "no screen's colors changed" would be testing a
tautology of the deferred scope, not a behavior this spec introduces. *(Superseded by the
retrofit amendment. The per-screen dark tests below now assert exactly that change.)*

### (Retrofit) Testing strategy

**AsyncStorage jest-mock strategy.** Once components call `useAppTheme()`, nearly every test's
module graph reaches `themeStore → appearanceStorage → @react-native-async-storage/async-storage`.
The installed `AsyncStorage.native.ts` throws at import when the native module is null. So
task 7.5 adds the automatic manual mock
`apps/mobile/__mocks__/@react-native-async-storage/async-storage.js`, which contains
`module.exports = require('@react-native-async-storage/async-storage/jest/async-storage-mock');`.
This is the same `<rootDir>/__mocks__` node-module convention as the existing
`__mocks__/@expo/vector-icons.js`, and Jest applies it to every test file. The 15 existing
explicit per-file `jest.mock(...)` calls keep working (an explicit factory takes precedence)
and are left untouched.

Under Jest, `useColorScheme` is mocked to `'light'` by `@react-native/jest-preset`, and the
store defaults to `'system'`. So every existing light assertion keeps passing. Dark cases use
`src/test/themeTestUtils.ts` (`setTestScheme(s)`, which wraps
`act(() => useThemeStore.setState({ preference: s }))`, and `resetTestScheme()`), with
`afterEach(resetTestScheme)`.

**OS-scheme mocking (Properties 10, 17 and any `'system'` case).** `setTestScheme` sets only
the preference, and the preset's `useColorScheme` is `jest.fn(() => 'light')`. Those test files
install the descriptor-copy mock that `theme/__tests__/useActiveTheme.test.tsx` already uses:
`jest.mock('react-native', () => { const a = jest.requireActual('react-native'); const d =
Object.getOwnPropertyDescriptors(a); d.useColorScheme = { value: jest.fn(), writable: true,
enumerable: true, configurable: true }; return Object.defineProperties({}, d); })`. The spread
form `{ ...jest.requireActual('react-native'), … }` crashes on RN 0.85.3, because the spread
eagerly invokes the lazy `DevMenu` getter.

`themeTestUtils.ts` also exports `setTestOsScheme(s: 'light' | 'dark' | null)`. It calls
`require('react-native').useColorScheme.mockReturnValue(s)`. It throws a clear error if
`useColorScheme` isn't a jest mock, which means the file forgot the mock. A changed mock value
notifies nobody, so callers set it before first render or follow it with `rerender` or a store
change. `resetTestScheme()` restores `'light'` when the mock is present.

**Unit and property tests:**

- `theme/__tests__/theme.tokens.test.ts` (Properties 7 and 8, plus `withAlpha` and
  `definePalette`)
- `theme/contrast.ts` (pure: `relativeLuminance`, `contrastRatio`, `mixOver`,
  `CONTRAST_REQUIREMENTS`) with `theme/__tests__/contrast.prop.test.ts` (Property 9)
- `test/__tests__/themeGuard.prop.test.ts` (Property 15, fixture half)

**Hook and kit tests** (RTL; only the AsyncStorage mock):

- `theme/__tests__/useAppTheme.test.tsx` (Property 10)
- `theme/__tests__/makeStyles.prop.test.tsx` (Property 11)
- `__tests__/App.appearance.test.tsx`, updated (Property 12)
- `theme/__tests__/components.theme.test.tsx` and `charts.theme.test.tsx` (Properties 16 and 17)
- `navigation/__tests__/tabBarTheme.test.tsx` (Property 13)
- `components/pins/__tests__/artworkInvariance.test.tsx` (Property 18)
- `components/__tests__/nativeControlsTheme.test.tsx` (Property 19, including the
  default-text exclusion cases)
- `theme/__tests__/consumerPatterns.prop.test.tsx` (Property 20 probe, task 8.4)
- `screens/profile/__tests__/PinDetailModal.tierText.test.tsx` (Property 21, task 9.6)
- `__tests__/themeRetrofit.guard.test.ts` (Property 14, plus Property 15's tree half)

**Per-batch screen tests.** For every top-level screen, modal or sheet in the batch that has an
existing render test, add one `describe('dark mode')` case to that file. It asserts three
things:

- **(a)** The root `backgroundColor` equals `darkTheme.color.background`, or `surface` for
  sheets and modals.
- **(b)** One primary text node `color === darkTheme.color.textPrimary`.
- **(c)** For a file that had literals, one converted element carries its dark token or palette
  value.
- **(d)** On the batch's designated screen, mount under light, call `setTestScheme('dark')`
  without remounting, and assert that a rendered row's colour is the dark value
  (Property 20). The designated screens:
  - B1 `ExploreHubScreen`
  - B2 `LiveWaitsScreen`
  - B3 `MyFoodListsScreen`
  - B4 `TripScheduleScreen` (no list screen; it's the most memo-heavy one)
  - B5 `TripsListScreen`
  - B6 `NotificationCenterScreen`
  - B7 `FriendsListScreen` (in `FriendsListScreen.removeConfirmation.test.tsx`)

The batch report names every converted file that has no render test. Unchanged existing light
assertions are the per-file light-parity net.

*Iteration 3 correction:* that net is thin (6 hex assertions in 4 test files, none for
`rgba`). The binding light-parity proof is the light-colour multiset audit in "(Retrofit)
Batch decomposition", which W1 (tasks 8.1–8.3) and every batch run.

**Iteration 3 tests.** Property 22's render cases are added to tests the batches already
own:

- `ExploreHubScreen` tests (B1): the placeholder tile uses `fill`
- `foodLists/__tests__/MarkGottenUndoToast.test.tsx` (B3): the inverse toast
- `trips/__tests__/TripReservationsScreen.test.tsx` (B5): the active chip text

Property 22's pure half, and the Property 7/8 additions, go in
`theme/__tests__/theme.tokens.test.ts`. The Property 16 additions (histogram, progress bar,
progress ring, primary button) go in `charts.theme.test.tsx`/`components.theme.test.tsx`.
The Property 13 change (`gradient.fab`) goes in `navigation/__tests__/tabBarTheme.test.tsx`.

**Visual verification** (tasks 7.1 and 11). Run Expo Go on the `Pixel_7` AVD via
`npm run dev:cloud`, on a signed-in test account. Capture
`adb exec-out screencap -p > .agents/tasks/dark-mode-retrofit/screenshots/NN-<screen>-{baseline|light|dark}.png`
for the checklist in `.agents/tasks/dark-mode-retrofit/design.md`. Review every PNG: compare
light against baseline side by side, and check the dark set for light surfaces, invisible text
or icons, and recoloured artwork. If no account or backend is available, pause and ask the user.
Don't skip this step.

**What green doesn't prove.** The guard plus `npm run verify` prove that no static or literal
colour remains and that the asserted elements repaint. They don't prove that unstyled `Text`
(RN's default black) was caught everywhere. That's what the screenshot pass is for.

**Commands.**

- Inner loop: `npx jest <file> --maxWorkers=2`.
- Batch self-check: the guard in strict mode, plus `npm run typecheck --workspace apps/mobile`,
  with zero errors in owned files.
- Final gate, run once (task 12.1): `npm run verify`.

## Configuration & Constants

| Constant | Location | Value | Purpose |
| --- | --- | --- | --- |
| `APPEARANCE_PREFERENCE_KEY` | `theme/appearanceStorage.ts` | `'dwt.appearance.preference'` | AsyncStorage key; `dwt.` prefix matches the existing `dwt.session.token` SecureStore key's namespacing convention |
| `AppearancePreference` values | `theme/appearance.ts` | `'system' \| 'light' \| 'dark'` | The three persisted/selectable states; serialized as the raw string itself, no JSON envelope |
| `DEFAULT_APPEARANCE_PREFERENCE` | `theme/appearance.ts` | `'system'` | Default when never set; fallback when missing/unreadable/corrupt |
| `LIGHT_ROOT_BACKGROUND` | `theme/appearance.ts` | `theme.color.background` (`'#f5f2fb'`) | Root safe-area background in light Active theme — identical to today's existing value, so light mode is visually unchanged |
| `DARK_ROOT_BACKGROUND` | `theme/appearance.ts` | `'#121212'` | Root safe-area background in dark Active theme — a neutral placeholder (Material Design's conventional dark-surface baseline), **not** a designed Disney dark palette value; the follow-up retrofit spec may replace this |
| New dependency | `apps/mobile/package.json` `dependencies` | `"@react-native-async-storage/async-storage": "2.2.0"` (exact, no `^`/`~`) | Local persistence. **New dependency — flagged per task instructions.** No `AsyncStorage` usage exists anywhere in `apps/mobile/src` today (confirmed). Version `2.2.0` is pinned because it is the exact version listed for this package in the installed `expo@56.0.12`'s `bundledNativeModules.json` (`node_modules/expo/bundledNativeModules.json`) — the version Expo's own compatibility matrix expects for this SDK, consistent with every other native-module version already pinned in `package.json` (e.g. `react-native-screens`, `react-native-svg`) |

**Superseding note (retrofit amendment):** `DARK_ROOT_BACKGROUND` becomes `'#120a1f'`
(`darkTheme.color.background`), replacing the `'#121212'` placeholder above.
`LIGHT_ROOT_BACKGROUND` becomes `lightTheme.color.background`, with the same `'#f5f2fb'` value.

### (Retrofit) Twilight colour tokens

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
| primary | `#5b2a86` | `#7e57c2` |
| primaryDark | `#3d1c5c` | `#2a1450` |
| primaryLight | `#7e57c2` | `#b28dff` (iteration 3; was `#9d7ae0` — see "(Retrofit) Deviations from the brief's palette") |
| primaryFg (new; text, icons, links and data marks on surfaces) | `#5b2a86` | `#c4a3ff` |
| accent | `#f6c343` | `#f6c343` |
| accentDark | `#d4a017` | `#d4a017` |
| success | `#2e9e6b` | `#4cc38a` |
| danger | `#d6336c` | `#ff6b9a` |
| warning | `#e8a317` | `#f5b83d` |
| warningSurface | `#fff4d6` | `#3a2c0e` |
| warningText | `#8a5a00` | `#ffd27a` |
| star | `#ffffff` | `#ffffff` |
| starRating | `#f59e0b` | `#f6c343` |

### (Retrofit) Gradients, shadow, outline, default text, tab bar

| Token | Light (unchanged) | Dark |
| --- | --- | --- |
| gradient.header (PrimaryButton) | `['#5b2a86','#3d1c5c']` | `['#7e57c2','#7650b9']` (iteration 3; was `['#3b1d6e','#1a0d33']`) |
| gradient.headerVivid | `['#7e57c2','#5b2a86','#3d1c5c']` | `['#5b2a86','#3b1d6e','#1a0d33']` |
| gradient.gold | `['#f6c343','#d4a017']` | unchanged |
| gradient.fab (new, iteration 3; MagicFab) | `['#7e57c2','#5b2a86','#3d1c5c']` | `['#9d7ae0','#7e57c2','#7650b9']` |
| gradient.chartBar (new, iteration 3; RatingHistogram) | `['#7e57c2','#5b2a86','#3d1c5c']` | `['#c4a3ff','#9d7ae0','#7e57c2']` |
| shadow.card | `#3d1c5c`, offset 0/4, opacity 0.12, radius 12, elevation 3 | `#000000`, offset 0/4, opacity 0.08, radius 12, elevation 3 |
| shadow.floating | `#3d1c5c`, offset 0/8, opacity 0.20, radius 20, elevation 6 | `#000000`, offset 0/8, opacity 0.14, radius 20, elevation 6 |
| outline.card | `{ borderWidth: 0 }` (spec task 11 fix; was `{}`; draws nothing) | `{ borderWidth: StyleSheet.hairlineWidth, borderColor: '#33264d' }` |
| textDefault | `{}` | `{ color: '#f3eefc' }` |
| tabBar.background (nav `card`) | `rgb(255, 255, 255)` (DefaultTheme) | `#170e27` |
| tabBar.border (nav `border`) | `rgb(216, 216, 216)` (DefaultTheme) | `#33264d` |
| tabBar.activeTint / inactiveTint | `#003a9b` / `#6b7280` | `#f6c343` / `#8a7fa3` |
| tabBar.badgeBackground / badgeText | `#d97706` / `#ffffff` | `#f6c343` / `#3d1c5c` |

Elevation stays identical because on Android it also sets z-order.

### (Retrofit) Park accents and category tints

Dark tints clear 4.5:1 on `surface` `#1e1430`, so they're safe as `Badge` text on their own
14 % tint.

| Key | Light (unchanged) | Dark | vs surface | Badge text on 14 % tint |
| --- | --- | --- | --- | --- |
| park Magic Kingdom | `#7e57c2` | `#b28dff` | 6.80 | 5.39 |
| park EPCOT | `#2f80ed` | `#5aa2ff` | 6.72 | 5.39 |
| park Hollywood Studios | `#e8505b` | `#ff7a83` | 6.98 | 5.58 |
| park Animal Kingdom | `#3fa34d` | `#5cc46a` | 7.98 | 6.29 |
| park Typhoon Lagoon | `#17a2b8` | `#3cc9de` | 8.85 | 6.90 |
| park Blizzard Beach | `#4dabf7` | `#7cc4ff` | 9.35 | 7.06 |
| park Disney Springs | `#f6a609` | `#ffb732` | 10.08 | 7.58 |
| category Ride | `#7e57c2` | `#b28dff` | 6.80 | 5.39 |
| category Show | `#e8505b` | `#ff7a83` | 6.98 | 5.58 |
| category Restaurant | `#f6a609` | `#ffb732` | 10.08 | 7.58 |
| category Parade | `#f6c343` | `#f6c343` | 10.69 | 7.93 |
| category Character_Meet | `#2f80ed` | `#5aa2ff` | 6.72 | 5.39 |
| category Walkthrough / Tour | `#00897b` | `#2ec4b0` | 8.05 | 6.36 |
| category PlayArea / Recreation | `#43a047` | `#6fcf73` | 9.06 | 7.03 |
| category Game / Event | `#8e24aa` | `#d27ff0` | 6.71 | 5.34 |
| category Spa | `#ec407a` | `#ff7eb3` | 7.42 | 5.83 |
| category Other | `#6b6480` | `#b3a8c9` | 7.81 | 6.06 |
| category Resort, resortVisual.tint | `#5b2a86` | `#c4a3ff` | 8.37 | 6.42 |

**(Retrofit) Category fills (iteration 3; `CategoryVisual.fill`, Requirement 9.11).** These
are solid tiles behind a white glyph or white text. The light fill equals the tint. The floor
is 4.5. *(Iteration 4.)* Dark fills reuse the `DARK_TONAL` fill of each hue family, except
Game/Event (kept at light `#8e24aa`), Other (`borderStrong` `#4a3a6b`) and Resort
(`#5b2a86`).

| Category | Light fill (= tint) | Dark fill | White on dark fill | Light white-on-fill (pre-existing) |
| --- | --- | --- | --- | --- |
| Ride | `#7e57c2` | `#7e57c2` | 5.21 | 5.21 |
| Show | `#e8505b` | `#c42b3c` | 5.59 | 3.67 |
| Restaurant | `#f6a609` | `#b5520f` | 5.03 | 2.02 |
| Parade | `#f6c343` | `#9a5b00` | 5.43 | 1.64 |
| Character_Meet | `#2f80ed` | `#2563eb` | 5.17 | 3.87 |
| Walkthrough / Tour | `#00897b` | `#0e7490` | 5.36 | 4.32 |
| PlayArea / Recreation | `#43a047` | `#1f7a52` | 5.30 | 3.30 |
| Game / Event | `#8e24aa` | `#8e24aa` | 7.04 | 7.04 |
| Spa | `#ec407a` | `#b8336f` | 5.61 | 3.76 |
| Other | `#6b6480` | `#4a3a6b` | 9.96 | 5.59 |
| Resort, resortVisual | `#5b2a86` | `#5b2a86` | 9.90 | 9.90 |

The light Restaurant (2.02) and Parade (1.64) values fall below 3.0, so 9 of 11 light rows
clear the 3.0 glyph floor *(count added in iteration 4)*. That is pre-existing and deliberately
unchanged (Requirement 9.2; see Out of Scope, "Light-mode accessibility fixes").

### (Retrofit) `DARK_TONAL` ramp

`tint` = fg at 16 % over `#1e1430`; `border` = fg at 35 % over `#1e1430`.

| Family | fg | tint | border | fill | fg/surface | fg/tint | white/fill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| violet | `#c4a3ff` | `#392b51` | `#584678` | `#7e57c2` | 8.37 | 6.12 | 5.21 |
| green | `#4cc38a` | `#25303e` | `#2e5150` | `#1f7a52` | 7.91 | 6.03 | 5.30 |
| amber | `#f5b83d` | `#402e32` | `#694d35` | `#9a5b00` | 9.86 | 7.13 | 5.43 |
| orange | `#ffa45c` | `#422b37` | `#6d463f` | `#b5520f` | 8.95 | 6.57 | 5.03 |
| red | `#ff7a7a` | `#42243c` | `#6d384a` | `#c42b3c` | 6.94 | 5.37 | 5.59 |
| pink | `#ff6b9a` | `#422241` | `#6d3255` | `#b8336f` | 6.53 | 5.09 | 5.61 |
| blue | `#5aa2ff` | `#282b51` | `#334678` | `#2563eb` | 6.72 | 5.18 | 5.17 |
| sky | `#7cc4ff` | `#2d3051` | `#3f5278` | `#0369a1` | 9.35 | 6.77 | 5.93 |
| teal | `#3cc9de` | `#23314c` | `#29536d` | `#0e7490` | 8.85 | 6.56 | 5.36 |

**High-frequency literal families** (rule 3; the 71 most frequent non-token literals):

- **Neutral:** `#64748b #655d78 #475569 #94a3b8 #334155 #1e293b #0f172a #f1f5f9 #e2e8f0 #cbd5e1 #f8fafc`.
- **Neutral lavender-subtle** (always neutral; S → `surfaceAlt` per the neutral bands): `#fbf9fe #faf7ff #f5f3ff #f1ecf7 #f5f0fb #ede6f6 #e9e3f5 #f1edfb #f1edfa`.
- **Violet:** `#7c3aed #6d28d9 #7e22ce #6b21a8 #581c87 #e8dcfa #ede9fe #f3e8ff #e9d5ff #ebdff8 #d8c7f2 #ded3f0 #dcd1ed`.
- **Violet in the H role:** `#190c2d #371756 #3b1d60 #1e1b4b`.
- **Green:** `#15803d #16a34a #059669 #22c55e #10b981 #2e7d32 #dcfce7 #bbf7d0 #ecfdf5 #f0fdf4 #86efac`.
- **Amber:** `#fef3c7 #fde68a #fffbeb`, plus `#ffd700` in the G role.
- **Orange:** `#d97706 #b45309 #92400e #78350f #451a03 #e65100 #f97316`.
- **Red:** `#dc2626 #b91c1c #ef4444 #e11d48 #ff2d55 #fee2e2 #fef2f2 #fecdd3 #fff1f2`.
- **Sky:** `#2f80ed` (when not a park/category role) and `#0284c7`.
- **Blue:** `#eef2ff`.

### (Retrofit) Computed contrast (dark) — re-checked in CI by Property 9

| Pair | Ratio | Floor |
| --- | --- | --- |
| textPrimary on background / surface / surfaceAlt | 16.94 / 15.40 / 13.64 | 4.5 |
| textSecondary on background / surface / surfaceAlt | 8.60 / 7.81 / 6.92 | 4.5 |
| primaryFg on background / surface / surfaceAlt | 9.21 / 8.37 / 7.41 | 4.5 |
| success on background / surface / surfaceAlt | 8.71 / 7.91 / 7.01 | 4.5 |
| danger on background / surface / surfaceAlt | 7.18 / 6.53 / 5.78 | 4.5 |
| warning on background / surface / surfaceAlt | 10.84 / 9.86 / 8.73 | 4.5 |
| accent / starRating on background / surface / surfaceAlt | 11.76 / 10.69 / 9.47 | 4.5 |
| primaryLight `#b28dff` (text) on surface / surfaceAlt / background (iteration 3) | 6.80 / 6.02 / 7.48 | 4.5 |
| textOnPrimary on primary | 5.21 | 4.5 |
| white on primaryDark | 15.98 | 4.5 |
| textOnAccent on accent / accentDark | 8.43 / 5.82 | 4.5 |
| warningText on warningSurface | 9.54 | 4.5 |
| textPrimary / textSecondary on warningSurface | 11.93 / 6.05 | 4.5 |
| white on header stops `#5b2a86` / `#3b1d6e` / `#1a0d33` | 9.90 / 13.23 / 18.27 | 4.5 |
| header subtitle `rgba(255,255,255,0.82)` on `#5b2a86` / `#3b1d6e` | 7.22 / 9.32 | 4.5 |
| header eyebrow `#ffd54f` on `#5b2a86` / `#3b1d6e` | 7.02 / 9.38 | 4.5 |
| Chip idle textSecondary on surfaceAlt | 6.92 | 4.5 |
| primaryFg / textPrimary on primary 14 % over surface | 7.36 / 13.54 | 4.5 |
| danger on `DARK_TONAL.pink.tint` | 5.09 | 4.5 |
| tab active / inactive on `#170e27` | 11.35 / 5.00 | 3.0 |
| tab badge `#3d1c5c` on `#f6c343` | 8.43 | 4.5 |
| nav header textPrimary / textSecondary on `#170e27` | 16.35 / 8.29 | 4.5 |
| **Disallowed:** white on success / danger | 2.22 / 2.68 | fails → conversion rule 4 |
| **Disallowed:** white on primaryLight `#b28dff` | 2.58 | fails → primaryLight never fills behind body text |
| border / borderStrong on surface (decorative) | 1.27 / 1.76 | Parity with light (1.36 / 1.76). Not a regression. |
| Badge text on its 14 % tint over surfaceAlt / background, minimum across every category tint and park accent (`#d27ff0` Game/Event) | 4.66 / 6.07 | 4.5 |
| Park accents vs surfaceAlt / background, minimum (`#5aa2ff` EPCOT) | 5.95 / 7.39 | 4.5 |
| textSecondary on each `DARK_TONAL.*.tint`, minimum (amber, sky) | 5.66 | 4.5 |
| `DARK_TONAL.*.fg` on background, minimum (pink) | 7.18 | 4.5 |
| textSecondary / primaryFg on the selected row (primary 14 % over surface, `#2b1d44`) | 6.87 / 7.36 | 4.5 |
| primaryFg on the selected row over surfaceAlt | 6.47 | 4.5 |

**(Retrofit) Pin tier text — `TIER_TEXT` (rule 7, Requirement 9.9).** These are badge-text
ratios on the tier's own 14 % tint. Light equals `TIER_COLOR` verbatim. Only amethyst and
bronze change in dark.

| Tier | Light | Dark | on surface | badge over surface / surfaceAlt / background |
| --- | --- | --- | --- | --- |
| bronze | `#c97f4a` | `#e0965f` | 7.26 | 5.77 / 5.06 / 6.50 (the unchanged `#c97f4a` fails at 4.02 over surfaceAlt) |
| silver | `#b0b9c8` | `#b0b9c8` | 8.86 | 6.78 / 5.89 / 7.66 |
| gold | `#e5ab2c` | `#e5ab2c` | 8.51 | 6.63 / 5.80 / 7.47 |
| amethyst | `#8a45c9` | `#c08ff5` | 7.09 | 5.58 / 4.88 / 6.33 (the unchanged `#8a45c9` fails at 2.79 over surface) |
| pearl | `#c2bcdd` | `#c2bcdd` | 9.63 | 7.18 / 6.32 / 8.21 |
| prism | `#c9a8ff` | `#c9a8ff` | 8.79 | 6.66 / 5.86 / 7.61 |
| mythic | `#ffb347` | `#ffb347` | 9.84 | 7.44 / 6.50 / 8.44 |

The per-tint and per-family rows behind the minima above were tabulated in
`.agents/tasks/dark-mode-retrofit/design.md` ("Additional used dark pairs"). *(Iteration 3:
they're now copied below, so this spec is self-sufficient.)* Every one of them is an entry in
`CONTRAST_REQUIREMENTS`.

**(Retrofit) Additional used dark pairs.** Every row is an entry in `CONTRAST_REQUIREMENTS`.

*Badge text on its own 14 % tint, by the surface the badge sits on (floor 4.5):*

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
| `#d27ff0` (Game, Event): minimum | 5.34 | 4.66 | 6.07 |
| `#ff7eb3` (Spa) | 5.83 | 5.10 | 6.64 |
| `#b3a8c9` (Other) | 6.06 | 5.34 | 6.90 |
| `#c4a3ff` (Resort, resortVisual, primaryFg default Badge) | 6.42 | 5.59 | 7.33 |

*Park accents as text or icons (floor 4.5):*

| Park | vs surfaceAlt | vs background |
| --- | --- | --- |
| Magic Kingdom `#b28dff` | 6.02 | 7.48 |
| EPCOT `#5aa2ff` | 5.95 | 7.39 |
| Hollywood Studios `#ff7a83` | 6.18 | 7.68 |
| Animal Kingdom `#5cc46a` | 7.07 | 8.78 |
| Typhoon Lagoon `#3cc9de` | 7.84 | 9.74 |
| Blizzard Beach `#7cc4ff` | 8.28 | 10.28 |
| Disney Springs `#ffb732` | 8.92 | 11.09 |

*`DARK_TONAL` secondary text and background pairs (floor 4.5):*

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

*Selected row* (primary at 14 % over surface = `#2b1d44`): textSecondary 6.87, primaryFg 7.36,
textPrimary 13.54. Over surfaceAlt, primaryFg is 6.47.

**(Retrofit) Iteration 3 pairs.** All were recomputed with the WCAG 2.x formula (stdin
`node -`), and every row is an entry in `CONTRAST_REQUIREMENTS`.

*`primaryLight` as `Badge` text on its 14 % tint (floor 4.5).* Sites include
`TripReservationsScreen.tsx:872` and `TripScheduleScreen.tsx:1552,1595`.

| Dark primaryLight | over surface | over surfaceAlt | over background |
| --- | --- | --- | --- |
| `#9d7ae0` (old, rejected) | 4.34 | 3.81 | 4.89 |
| **`#b28dff`** (chosen) | 5.39 | 4.71 | 6.14 |

*Rule 1a sites (floor 4.5):*

| Pair (dark) | Straight substitution | Converted |
| --- | --- | --- |
| `MarkGottenUndoToast` message / Undo on the toast | white / `#f6c343` on `#f3eefc`: 1.14 / 1.44 | on `#1f1235`: 17.56 / 10.71 |
| `TripReservationsScreen` active chip text on `primary` `#7e57c2` | `#1e1430`: 3.36 | `#ffffff`: 5.21 |

*Non-text graphics (WCAG 1.4.11, Requirement 7.5; floor 3.0 unless noted):*

| Element (dark) | Against | Before | Iteration 3 |
| --- | --- | --- | --- |
| `RatingHistogram` bars (`gradient.chartBar`) | card `#1e1430` | 1.77 / 1.32 / 1.04 | 8.37 / 5.25 / 3.36 |
| `ProgressBar` default fill (`primaryFg`) | track `surfaceAlt` | 2.98 | 7.41 |
| `ProgressRing` arc (`primaryLight`, `primaryFg`) | track `surfaceAlt` | 4.65 / 2.98 | 6.02 / 7.41 |
| `ProgressBar` complete `gradient.gold` | track `surfaceAlt` | 9.47 / 6.53 | unchanged |
| `PrimaryButton` stops (`gradient.header`) | card | 1.32 / 1.04 | 3.36 / 3.02 |
| `PrimaryButton` stops (`gradient.header`) *(iteration 4)* | screen `background` `#120a1f` | 1.46 / 1.06 | 3.70 / 3.32 |
| Chip active fill (`primary` `#7e57c2`) *(iteration 4)* | card `surface` / screen `background` | unchanged | 3.36 / 3.70 |
| `PrimaryButton` white label (floor 4.5) | its stops | 13.23 / 18.27 | 5.21 / 5.80 |
| `MagicFab` disc (`gradient.fab`) | ring `surface` | 1.77 / 1.32 / 1.04 | 5.25 / 3.36 / 3.02 |
| `MagicFab` white glyph (icon floor 3.0) | its stops | 9.90 / 13.23 / 18.27 | 3.34 / 5.21 / 5.80 |

Among the candidates checked on the same violet ramp, the end stop `#7650b9` is the deepest one
that still clears 3.0 against `#1e1430` (`#744eb6` is 2.93), with
white on it at 5.80. The reviewer's proposed `#6d45b0` is 2.61 against `#1e1430`.

**Scope of criterion 7.5 (iteration 4).** "The background they sit on" means `surface` (a
card) or `background` (the screen). A `PrimaryButton` is not placed on `surfaceAlt`. Against
`surfaceAlt` `#2a1d42` the stops would be 2.98 / 2.67 and the Chip-active fill 2.98, below
3.0, so those pairs are recorded here but are not floors. A `PrimaryButton` and an active
`Chip` are identified by their text label, which meets 4.5:1 on the fill, and WCAG 1.4.11
exempts a component identified by its text. As a backstop, a batch that finds a
`PrimaryButton` or active `Chip` rendered directly on a `surfaceAlt` container lists it in its
report (task 9 "Done when"), and the integrator decides whether to move it. The `background`
rows above join `CONTRAST_REQUIREMENTS` at min 3.0.

**(Retrofit) Deviations from the brief's palette (iteration 3).** The brief also mandated the
contrast targets. Where they conflict with a brief value, the target wins, and the change is
the smallest one that clears it. All light values are unchanged, and no colour token was added
besides `primaryFg`.

| Token | Brief dark | Spec dark | Why |
| --- | --- | --- | --- |
| `primaryLight` | `#9d7ae0` | `#b28dff` | Badge text on its tint fails at 4.34 / 3.81. `#b28dff` is the MK/Ride tint already in the palette. |
| `gradient.header` | `['#3b1d6e','#1a0d33']` | `['#7e57c2','#7650b9']` | Its only consumer is `PrimaryButton`, and the brief's stops are 1.32 / 1.04 against the card. |

The additive keys `gradient.fab`, `gradient.chartBar` and `CategoryVisual.fill` carry the other
fixes. Data marks reuse `primaryFg`.

These light values are pre-existing and are deliberately not changed by this amendment
(Requirement 9.2):

- textSecondary on surfaceAlt 4.70
- tab inactive on white 4.83
- **Vault badge white on `#d97706` 3.19**, deferred (see Out of Scope)

### (Retrofit) Polish-pass constants (Requirements 9.12–9.15)

Every new key keeps its light value equal to what rendered before the polish pass.

| Key | Light | Dark | Dark ratio |
| --- | --- | --- | --- |
| `PARK_WAIT_PULSE.activeBorder` | `#22c55e` (unchanged) | `DARK_TONAL.green.fg` `#4cc38a` | 7.91 vs `surface`; 3.70 vs idle ring |
| `SHARE_COMPOSER.unselectedIcon` | `#cdbce6` (unchanged) | `textSecondary` `#b3a8c9` | 7.81 vs `surface` |
| `EXPENSES.tabActiveBg` (new) | `#ffffff` | `borderStrong` `#4a3a6b` | `primaryFg` label on it 4.76 |
| `EXPENSES.tabIdleText` | `#655d78` (unchanged) | `textSecondary` | 6.92 on the `surfaceAlt` track |
| `EXPENSES.indigoText` | `#1e1b4b` (unchanged) | `textPrimary` | — |
| `BALANCES.toggleActiveBg` (new) | `#ffffff` | `borderStrong` | `textPrimary` label on it 8.75 |
| `BALANCES.inkText` | `#1e1b4b` (unchanged) | `textPrimary` | 8.75 on `toggleActiveBg` |
| `FORM.tierPillActiveBg` (new) | `#f5effa` | `DARK_TONAL.violet.tint` | — |
| `FORM.tierPillActiveBorder` (new) | `#bca5db` | `primaryFg` | 6.12 vs pill; 8.37 vs `surface` |
| `SCHEDULE.showtimeActiveBorder` (new) | `#5b2a86` | `primaryFg` | 7.41 vs `surfaceAlt` |
| `RESORTS.tierDeluxe/Villa/Moderate/Value` | `#d97706` / `#7c3aed` / `#0284c7` / `#9333ea` | same as light (on-photo) | light parity |
| Dark `Switch` track off / on | — (call-site props) | `borderStrong` / `primary` | on track 3.36 vs `surface` |
| Dark `Switch` thumb on / off | — (call-site props) | `textOnPrimary` / `textSecondary` | 5.21 on on-track; 4.44 on off-track; off thumb 7.81 vs `surface` |
| Dark `Switch` `ios_backgroundColor` | — (call-site props) | `borderStrong` | — |

The native window background behind the Android navigation bar is **not** changed by this
pass: doing so needs `expo-system-ui`, a new native dependency that remains out of scope.

**Superseding note (polish Fix 11, user-approved):** the user approved `expo-system-ui`. The
native window background now follows the Active theme (Requirement 6.5; Property 25):

| Constant / dependency | Location | Value | Purpose |
| --- | --- | --- | --- |
| New dependency | `apps/mobile/package.json` `dependencies` | `"expo-system-ui": "56.0.5"` (exact, no `^`/`~`) | `setBackgroundColorAsync` for the native window/root view. Installed with `npx expo install expo-system-ui`, which picks the SDK 56 version. Expo Go for SDK 56 bundles the native module, so no rebuild is needed there. A custom dev or EAS build must be rebuilt to include it. |
| Window background, dark | `App.tsx`, from `deriveAppearanceChrome('dark').rootBackground` | `'#120a1f'` (`DARK_ROOT_BACKGROUND`) | The strip behind the gesture bar matches the dark screen background |
| Window background, light | `App.tsx`, from `deriveAppearanceChrome('light').rootBackground` | `'#f5f2fb'` (`LIGHT_ROOT_BACKGROUND`) | The strip behind the gesture bar matches the light screen background |
| `app.config.ts` | — | No change | Prebuild already auto-applies `expo-system-ui`'s config plugin for an installed package (`@expo/prebuild-config` `withVersionedExpoSDKPlugins`). It writes the existing `userInterfaceStyle: 'automatic'` into the Android `expo_system_ui_user_interface_style` string, so nothing needs listing in `plugins`. |

### (Retrofit) Commands and env

| Name | Value | Use |
| --- | --- | --- |
| `THEME_GUARD_STRICT` | comma-separated batch ids (e.g. `B4`) | Batch self-check during W2. Removed in task 10.1. |
| Jest workers during W2 | `--maxWorkers=2` | Seven concurrent batches on one machine |
| Emulator | AVD `Pixel_7`; `adb` at `C:\Users\knick\dev\android\platform-tools\adb.exe` | Tasks 7.1 and 11 |
| Screenshot dir | `.agents/tasks/dark-mode-retrofit/screenshots/` | Baseline, light and dark PNGs |

## External Interfaces

**On-device `AsyncStorage` (`@react-native-async-storage/async-storage`).** Not a network API, but
documented here per the spec-authoring standard's "integrating an external/undocumented API"
trigger, since it's a new integration point this spec introduces:

- **Interface used:** `AsyncStorage.getItem(key): Promise<string | null>` and
  `AsyncStorage.setItem(key, value): Promise<void>` only — no `multiGet`/`multiSet`/`clear`/
  `getAllKeys` usage anywhere in this feature.
- **Key:** `'dwt.appearance.preference'` (see Configuration & Constants). No other key is read or
  written by this feature.
- **Value encoding:** the raw `AppearancePreference` string (`"system"`, `"light"`, or `"dark"`),
  not JSON-stringified — `AsyncStorage` already stores/returns plain strings, so there is nothing
  to encode or decode beyond the `isAppearancePreference` validity check on read.
- **No id-mapping:** unlike `Live_Service`/ThemeParks.wiki, there is no foreign id scheme to
  reconcile — this is a single local scalar under a single local key, scoped to the device, never
  transmitted.

**(Retrofit) Library contracts relied on.** Each was verified against the installed packages.

- **`@react-navigation/native@6.1.18` `Theme`.** The shape is
  `{ dark, colors: { primary, background, card, text, border, notification } }`, with no
  `fonts` (that's v7). DefaultTheme's `card` is `rgb(255, 255, 255)` and its `border` is
  `rgb(216, 216, 216)`.
- **`@react-navigation/bottom-tabs@6.6.1`.** The tab bar background is `colors.card` and the
  top border is `colors.border` (`BottomTabBar.tsx` lines 262–263). Options used:
  `tabBarActiveTintColor`, `tabBarInactiveTintColor`, `tabBarBadgeStyle`.
- **`react-native-calendars@1.1314.0`.** The `theme` is captured once with `useRef`, so the
  component needs `key={t.scheme}`.
- **`@react-native-async-storage/async-storage@2.2.0`.** It throws at import without the native
  module. Its jest mock is the default export of `jest/async-storage-mock.js`.
- **`@react-native/jest-preset`.** `useColorScheme` is mocked to return `'light'`.
- **Expo `userInterfaceStyle: 'automatic'`** is already set in `app.config.ts`. Per Expo's docs
  (not verified here), following the OS scheme on Android standalone builds also needs
  `expo-system-ui`. That doesn't block this work: a pinned Dark preference is independent of
  the OS, and Expo Go supports `automatic`. Adding it is out of scope (new native dependency).
  **Superseding note (polish Fix 11):** `expo-system-ui@56.0.5` is now installed (see the next
  bullet).
- **`expo-system-ui@56.0.5` (polish Fix 11).** Verified against the installed package.
  - **Function used:** `setBackgroundColorAsync(color: ColorValue | null): Promise<void>` only.
    On Android it runs on the main queue, saves the colour to the `expo_ui_preferences` shared
    prefs, and calls `activity.window.decorView.setBackgroundColor`. `null` would reset it to the
    system black/white, but this App never passes `null`.
  - **Config plugin:** prebuild auto-applies it. Its Android `withAndroidUserInterfaceStyle`
    writes `userInterfaceStyle` (`'automatic'` here) into the `expo_system_ui_user_interface_style`
    string. Without that string, the library's default resource is `light`, and its activity
    `onCreate` listener would call `AppCompatDelegate.setDefaultNightMode(MODE_NIGHT_NO)`. Do not
    disable the auto-applied plugin.
  - **Jest:** `jest-expo`'s preset mocks the `ExpoSystemUI` native module
    (`jest-expo/src/preset/moduleMocks/expoModules.js`), so importing `App.tsx` needs no per-file
    mock. `App.systemUI.test.tsx` mocks `expo-system-ui` itself only to assert the calls.
- **React Native `Switch` (polish pass).** Props relied on: `trackColor: { false?, true? }`,
  `thumbColor` and `ios_backgroundColor`. Android does not reset a colour prop that is merely
  omitted on re-render, so each site sets `key={t.scheme}` to remount the native view on a
  scheme switch.

## Cross-Spec Dependencies

None. This is a new, self-contained mobile-only feature with no `apps/api` or `packages/shared`
surface and no dependency on any other spec's tables, endpoints, or components. No other spec
needs to be built before or after this one. The deferred per-screen retrofit (see Introduction/Out
of Scope) is anticipated future work, not a dependency of this spec — `useActiveTheme()` and
`themeStore` are deliberately designed so that follow-up work can consume them without any change
to this spec's files.

**(Retrofit) Build order.** The retrofit builds on Tasks 1–6 (complete) and depends on no other
spec. The order is:

1. Task 7 (foundation + light baseline screenshots)
2. Task 8 (kit, chrome and guard)
3. Tasks 9.1–9.7 (in parallel, disjoint files)
4. Task 10 (legacy removal and steering)
5. Task 11 (visual verification)
6. Task 12 (`npm run verify`)

No pin artwork, motif or catalogue file is touched, so the pin gate
(`node .kiro/specs/pin-collection/verify/run-all.js`) is not required. Pin UI screens are app
code, and `npm run verify` covers them.

## Spec Review Responses

Responses to the two review rounds recorded in `spec-review.md`/`spec-review.json`. Round 1
(verdict: CHANGES_REQUESTED, 5 MEDIUM + 2 NIT findings) was addressed in the revision prior to
this one; Round 2 (verdict: CHANGES_REQUESTED, 1 MEDIUM finding — a defect in that Round 1 fix
itself) is addressed by this revision. All entries below are kept together so the full history
is visible in one place:

- **Finding 1, Round 1 (SafeAreaProvider flash claim unverified)** — Addressed in the Round 1
  revision. Narrowed Requirement 6.3 and the App.tsx component section to the two concrete,
  source-identifiable windows where the root background is actually the visible layer
  (pre-first-layout cold mount, and the `transparentModal`/`containedTransparentModal`
  presentations), and explicitly disclaimed the stronger "no human-visible flash" claim as
  unverifiable from static source reading alone. **However, that revision's own citation was
  itself wrong** — see Finding 1, Round 2 below; this is why there are two entries for "Finding 1."
- **Finding 1, Round 2 (the Round 1 fix cited the wrong component/package)** — Addressed. The
  Round 1 revision claimed to have verified the root-background behavior by reading
  `node_modules/@react-navigation/elements/src/SafeAreaProviderCompat.tsx`, calling it "the
  component `App.tsx` actually renders, re-exported as `SafeAreaProvider`." That is factually
  wrong: `App.tsx` line 8 imports `SafeAreaProvider` directly from
  `'react-native-safe-area-context'`, not from `@react-navigation/elements`.
  `SafeAreaProviderCompat` is instead used internally, nested, by
  `@react-navigation/native-stack`'s `NativeStackView`, called there with no `style` prop at all —
  so even if it had been the relevant component, this spec's `rootBackground` wiring (set only on
  `App.tsx`'s own `SafeAreaProvider`) would never reach it. Corrected the App.tsx component
  section's citation to the real
  `node_modules/react-native-safe-area-context/src/SafeAreaContext.tsx`'s `SafeAreaProvider`
  (confirming it forwards `style` onto the native `RNCSafeAreaProvider` host view, so
  `rootBackground` is still painted as a real `backgroundColor` on a real native view — the prior
  bottom-line conclusion holds, just now cited correctly), and added the one materially new fact
  this file reveals that the prior citation never surfaced: `SafeAreaProvider` renders `null` for
  `children` — not just an unpainted background, but no children at all, so
  `NavigationContainer`/`RootNavigator` are not yet mounted — until its first `onInsetsChange`
  native callback resolves on initial mount. The native-stack `MaybeNestedStack`/
  `colors.background` half of the original citation was independently re-confirmed against the
  real `NativeStackView.native.tsx` source and is kept as-is; only the `SafeAreaProviderCompat`
  mis-citation is corrected. Requirement 6.3 is amended (additively, same criterion number) to
  describe the cold-mount window as "a bare background-colored native view with nothing else drawn
  inside it yet" rather than implying `NavigationContainer` content may already be present
  underneath it.
- **Finding 2 (App.appearance.test.tsx tests a stand-in, not real App.tsx)** — Addressed by
  design change, not just wording. Extracted the chrome derivation into a new, exported
  `theme/AppearanceChrome.ts` / `deriveAppearanceChrome()` that `App.tsx` calls directly and that
  `App.appearance.test.tsx` imports and calls directly — the test now exercises the literal
  production code path (task 4.1, new; tasks 4.2/4.3 renumbered accordingly in tasks.md).
- **Finding 3 (Requirement 5.2's `.selected`/`.checked` ambiguity)** — Addressed. Amended
  Requirement 5.2 to commit to `accessibilityState.selected` only, with an explicit note that this
  is a closed decision following from the `Chip` component choice, not an open alternative.
- **Finding 4 (unspecified `useColorScheme` mock pattern)** — Addressed. Design.md's Testing
  Strategy and tasks.md task 3.2 now both spell out the exact `jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'), useColorScheme: jest.fn() }))` form.
- **Finding 5 (native-stack transition-background claim unverified)** — Addressed. Read the
  installed `@react-navigation/native-stack@6.11.0` source (`NativeStackView.native.tsx`'s
  `MaybeNestedStack`) and confirmed `colors.background` from `useTheme()` is applied as the
  content wrapper's `backgroundColor` for every presentation this App actually uses (`'card'`,
  `'modal'`), with the one real exception (`transparentModal`/`containedTransparentModal`, unused
  today) now named explicitly in Requirement 6.1 rather than left as an unqualified claim.
- **NIT 6 (Requirement 3.2's cold-start mismatch window not surfaced as acceptance criteria)** —
  Addressed. Requirement 3.2 now states the brief non-blocking mismatch window explicitly and
  cross-references Requirement 4.2 (the control) and Requirement 6 (the chrome) so it isn't later
  mistaken for a regression.
- **NIT 7 (`resolveStatusBarStyle` doesn't explain dropping `'auto'`)** — Addressed. Added the
  one-sentence rationale to the function's doc comment in design.md (avoiding a second,
  independent OS-scheme read that could disagree with `resolveActiveTheme`'s own read).

No finding was backlogged or ignored; all 5 MEDIUM and both NIT findings are addressed above. The
"Verified Assumptions" and "Unverified / Wrong Assumptions" sections of spec-review.md otherwise
stand uncontested — this revision did not find reason to dispute any of them.

### (Retrofit) Design review responses (iteration 2)

These respond to `.agents/tasks/dark-mode-retrofit/design-review.md` (6 MEDIUM, 8 NIT). All 14
findings are addressed. Full rationale is in that folder's `design.md` under "Design Review
Responses (iteration 2)". The changes in this spec are additive, with no renumbering:

- **Requirements.** New criteria 8.5 (memoized and virtualized consumers repaint) and 9.9 (pin
  tier UI text), plus an amendment note on 9.7 (default-text exclusions).
- **Design.**
  - Conversion rule 0 (non-black `shadowColor`), and rule 1 role rows (`#ffffff` rings,
    `#3d1c5c`/`#5b2a86` on surfaces, `#7e57c2`, natural-role-only mapping).
  - Closed neutral bands, identical to the task design.
  - Rule 5 single veil mapping, and rule 7 `TIER_TEXT`.
  - The memoized-consumer rules and the default-text rule.
  - Exact guard import regexes and the `namespaceImport` rule.
  - Exact test ownership, and the `destinationVisuals.ts` ownership wording.
  - `withAlpha` accepting 8-digit hex and `rgb()`/`rgba()`.
  - `setTestOsScheme` and the descriptor-copy mock.
  - The extra contrast rows, the tier-text table, and the "21 values" and "15 files" fixes.
  - Properties 10, 14, 15, 17 and 19 amended; Properties 20 and 21 added.
- **Tasks.** Wording was added to 7.2, 7.5, 7.6, 8.4, 8.5, 9, 9.6 and 9.7. The
  `_Requirements:_` lines reference 8.5 and 9.9 where relevant.

### (Retrofit) Design review responses (iteration 4)

These respond to `.agents/tasks/dark-mode-retrofit/design-review.md` iteration 4 (1 MEDIUM,
4 NIT). All five are addressed in place, additively. Full rationale is in that folder's
`design.md` under "Design Review Responses (iteration 4)".

1. **Audit read forms (MEDIUM).** The light-colour multiset audit adds `IMPORTS(S)` bare
   reads, `ALIASES(F)` palette aliases, numeric `Number()` alpha normalisation and
   both-sides exemption counting. The consumer pattern gains the alias read form, and
   destructuring a palette record is disallowed. Task 9's Done-when mirrors this.
2. **Rule 2a (NIT).** Generalised to any suffixed token, park accent, category tint/fill,
   tier colour or palette value. Rule 3 requires suffixed palette values to be `#rrggbb` in
   both schemes, and Property 7's 6-digit check extends to `parkAccent` and
   `categoryVisual`/`resortVisual` `tint`/`fill`.
3. **Category fills (NIT).** "9 of 11" light rows clear 3.0, and the Game/Event, Other and
   Resort exceptions to the `DARK_TONAL` reuse are named.
4. **7.5 scope (NIT).** `background` rows (3.70 / 3.32) and Chip-active rows (3.36 / 3.70)
   added to the non-text table and to `CONTRAST_REQUIREMENTS` (Property 9, task 7.6). The
   7.5 amendment note and the scope paragraph limit the criterion to `surface`/`background`,
   and batches report any `PrimaryButton`/active `Chip` on `surfaceAlt`.
5. **Task 7.6 pointer (NIT).** Marked "(superseded by the iteration-3 note below)".

### (Retrofit) Design review responses (iteration 5)

These respond to `.agents/tasks/dark-mode-retrofit/design-review-final.md` (0 HIGH, 1 MEDIUM,
1 NIT). Nothing was deleted or renumbered.

1. **Numeric `withAlpha` double count (MEDIUM).** The audit block's `after(F)` `withAlpha`
   bullet now gives the explicit regex and removes matched spans before the `t.<GROUPS>`
   read regex, so a numeric `withAlpha(t.x, a)` counts once, as its rgba value. A fixture
   line is added to the audit notes; task 9's Done-when and tasks.md Notes mirror it.
2. **7.5 scope wording (NIT).** Backlogged. The design already enforces the `surfaceAlt`
   track pairs for progress fills (7.41 / 6.02), so nothing is broken; the narrower wording
   is recorded in the task design's iteration-5 responses for a later pass.
