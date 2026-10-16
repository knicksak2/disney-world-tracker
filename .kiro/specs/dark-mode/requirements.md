# Requirements Document

## Introduction

Guests use the mobile App (`apps/mobile`) in both bright park daylight and dark evening/hotel
settings, and in both cases today it renders with a single, fixed light-themed palette (the
"Magical / Whimsical" purple/gold theme in `apps/mobile/src/theme/theme.ts`). This feature adds
a user-facing **Appearance** preference — `system` / `light` / `dark` — so a User can either let
the App follow the device's OS color scheme or pin it to a specific one.

**Scope decision (retrofit depth) — read this before implementing.** An investigation of
`apps/mobile/src/theme/theme.ts`, `theme/components.tsx`, and `theme/charts.tsx` found that the
shared theme module exports a single frozen `theme` object (`color`, `gradient`, `shadow`, …)
consumed as **static values**, not through a React context or hook — 135 of 239 source files
import `theme`/`color` directly from `theme/theme.ts`, and every shared primitive in
`theme/components.tsx`/`theme/charts.tsx` builds its `StyleSheet.create({...})` from those static
values once, at module load. There is no existing theme-context seam a dark palette can be
swapped into without widening that seam first. Given that, this spec is split into two parts:

1. **Built now (this spec):** the full appearance-preference mechanism — the three-state
   preference, OS-scheme following and live reaction, local persistence, the Profile toggle
   control, and the React Navigation / status-bar / safe-area chrome following the active theme.
   The preference is fully functional and testable end-to-end.
2. **Explicitly deferred (follow-up, NOT built by this spec):** retrofitting the 15 files
   identified as having hardcoded hex-color literals with no `theme/theme` import at all (see
   Design → Architecture → Retrofit Scope for the file list), and converting every one of the 135
   `theme`-consuming files from the static import to the new theme-aware hook/context so their
   screens visually repaint for dark mode. **Until that follow-up spec lands, selecting "dark" or
   having the OS in dark mode while on "system" will NOT visually change any existing screen's
   colors** — every current screen keeps rendering the light "Magical / Whimsical" palette
   regardless of the active Appearance preference. What *does* react immediately, because this
   spec builds it directly: the React Navigation chrome (header/background/border colors derived
   from the nav `theme` prop), the OS status bar style, and the Profile screen's own toggle control
   (built fresh in this spec, so it is theme-aware by construction). This is a deliberate,
   explicitly-scoped partial rollout, not a silent gap — see Out of Scope.

**Superseding note (dark-mode retrofit amendment).** Item 2 above is no longer deferred. Users
saw a near-black tab bar under light screens, with the tab icons nearly invisible, so the
per-screen retrofit and the dark ("Twilight") palette are now **in scope**. Requirements 7–12
below cover them. Item 1 and Requirements 1–6 are unchanged and still hold. The paragraph above
is kept as written for history, per the repo's additive spec-editing convention. Where it
conflicts with Requirements 7–12, those requirements win.

## Glossary

- **App**: The mobile client (`apps/mobile`).
- **User**: An authenticated or unauthenticated user of the App (the preference applies on both
  the auth screens and the main tabs, since it is a device-level display preference, not an
  account setting).
- **Appearance_Preference**: The three-state value (`'system' | 'light' | 'dark'`) this spec
  introduces, persisted locally per device.
- **OS color scheme**: The value reported by React Native's `Appearance` API /
  `useColorScheme()` (`'light' | 'dark' | null`).
- **Active theme**: The resolved `'light' | 'dark'` value the App actually renders with at any
  moment — equal to the Appearance_Preference when it is `'light'` or `'dark'`, or equal to the
  OS color scheme (falling back to `'light'` if the OS reports `null`/unknown) when the
  Appearance_Preference is `'system'`.

## Requirements

### Requirement 1: Three-State Appearance Preference

**User Story:** As a User, I want to choose whether the App follows my device's light/dark
setting or stays fixed to one mode, so that I can control how the App looks regardless of my
device's own setting.

#### Acceptance Criteria

1. THE App SHALL support exactly three Appearance_Preference values: `'system'`, `'light'`, and
   `'dark'`.
2. WHILE the App has never had an Appearance_Preference explicitly set by the User on this
   device, THE App SHALL behave as if the Appearance_Preference is `'system'`.
3. WHEN the Appearance_Preference is `'system'`, THE App's Active theme SHALL equal the current
   OS color scheme (`'light'` or `'dark'`), falling back to `'light'` if the OS reports an
   unknown/null scheme.
4. WHEN the Appearance_Preference is `'light'` or `'dark'`, THE App's Active theme SHALL equal
   that value regardless of the OS color scheme.

### Requirement 2: Live Reaction to OS Color Scheme Changes

**User Story:** As a User with the Appearance_Preference set to "system", I want the App to
switch its Active theme immediately when my device's system-wide setting changes (including a
scheduled light/dark switch), so that I don't have to restart the App to see the change take
effect.

#### Acceptance Criteria

1. WHILE the Appearance_Preference is `'system'` and the App is foregrounded, WHEN the OS color
   scheme changes, THE App SHALL update its Active theme to match the new OS color scheme without
   requiring the User to restart or manually refresh the App.
2. WHILE the Appearance_Preference is `'light'` or `'dark'`, a change in the OS color scheme
   SHALL NOT change the App's Active theme.

### Requirement 3: Local-Only Persistence Across App Restarts

**User Story:** As a User, I want my Appearance_Preference choice to be remembered the next time
I open the App, so that I don't have to re-select it every session.

#### Acceptance Criteria

1. WHEN the User selects an Appearance_Preference value, THE App SHALL persist that value to
   on-device storage (`AsyncStorage`) and SHALL NOT transmit it to the backend API or persist it
   in Postgres in any form.
2. WHEN the App restarts (cold start), THE App SHALL read the persisted Appearance_Preference
   from on-device storage and apply it as the active preference before or as soon as the main UI
   renders, without requiring the User to re-select it. This criterion is explicitly non-blocking:
   a brief render (one or a few frames) showing the in-memory default (`'system'`) before the
   persisted value resolves is expected, intentional behavior, not a defect to be filed or
   "fixed" later — it applies identically to the navigation/status-bar/safe-area chrome
   (Requirement 6) and to the Profile Appearance control's initially-selected option
   (Requirement 4.2).
3. IF the persisted Appearance_Preference value is missing (never set), unreadable (a storage
   read error), or corrupt (present but not one of the three valid enum values), THE App SHALL
   fall back to `'system'` and SHALL NOT crash, error-toast, or block app startup.
4. Signing out and back in, or switching between User accounts on the same device, SHALL NOT
   reset or alter the persisted Appearance_Preference — it is a device-level, not an
   account-level, setting.

### Requirement 4: Appearance Toggle Control on the Profile Screen

**User Story:** As a User, I want to find the Appearance setting on my Profile screen alongside
my other preferences, so that it's where I'd expect to look for it.

#### Acceptance Criteria

1. THE App SHALL present an Appearance control on `ProfileScreen.tsx`, visible only in self-mode
   (the same gating as the existing Notifications and Account Security controls), styled as a
   titled settings card consistent with the existing `PushNotificationPreferenceControl`/
   `ChangePasswordControl` card pattern on that screen.

   **Corrective/superseding note (docs-drift audit, HIGH-1):** this criterion's literal text is
   now false as a description of the real App and must not be read as naming the actual insertion
   point. By the time this spec was implemented, the earlier `navigation-redesign` spec had
   already relocated the App's reachable Profile/settings surface off `ProfileScreen.tsx` (whose
   default-exported screen is not registered as a route on any navigator — only its
   `ProfileIdentityBlock` export is reused, inside `YouAndCrewScreen`) onto
   `apps/mobile/src/screens/youAndCrew/YouAndCrewScreen.tsx`. The control was correctly built
   theme-aware and functional (satisfying this spec's actual mechanism requirements), but its real,
   reachable home — confirmed by reading the source — is `YouAndCrewScreen.tsx`'s "Preferences &
   Security" section, gated by that section's own self-mode condition, not `ProfileScreen.tsx`.
   See design.md's corrected "`YouAndCrewScreen.tsx` (modified)" section and tasks.md tasks 5.2/5.5
   for the corrected file/test references. This note is additive; criterion 4.1's original text is
   left in place rather than rewritten, per the repo's spec-editing convention.
2. THE Appearance control SHALL present exactly three selectable options corresponding to
   `'system'`, `'light'`, and `'dark'`, with the currently-active option visibly indicated.
3. WHEN the User selects a different Appearance option, THE App SHALL update the Active theme
   (per Requirement 1) and persist the new Appearance_Preference (per Requirement 3) without
   requiring navigation away from the Profile screen or an app restart.
4. THE Appearance control SHALL be reachable and operable without needing an authenticated
   network request to succeed — it is derived and persisted entirely client-side.

### Requirement 5: Accessibility of the Appearance Control

**User Story:** As a User relying on a screen reader or who cannot distinguish color alone, I
want the Appearance control to be fully usable without seeing color, so that I can tell which
option is selected and operate the control with assistive technology.

#### Acceptance Criteria

1. EVERY option in the Appearance control SHALL carry an explicit accessible label describing the
   option by name (e.g. "System", "Light", "Dark"), never relying on an icon or color alone to
   convey meaning.
2. THE currently-selected Appearance option SHALL be exposed to assistive technology via an
   explicit `accessibilityState.selected` state, not solely through a visual-only highlight. (This
   is a closed decision, not an open choice between `.selected` and `.checked`: the control reuses
   the existing `Chip` primitive from `theme/components.tsx`, which only ever sets
   `accessibilityState.selected`, so `.checked` is not used by this spec.)
3. EVERY option in the Appearance control SHALL expose an accessibility role appropriate to a
   selectable control (e.g. `button` or `radio`) and SHALL be operable via the standard
   accessibility activation action.

### Requirement 6: React Navigation Theming and Chrome Follow the Active Theme

**User Story:** As a User, I want the parts of the App that already respond to Appearance
changes (navigation chrome, status bar) to look correct and consistent with my chosen Appearance,
so that at least the shell of the App doesn't look visually broken or mismatched.

#### Acceptance Criteria

1. THE App SHALL supply `NavigationContainer` (`App.tsx`) a React Navigation `theme` prop derived
   from the Active theme (React Navigation's built-in `DefaultTheme` when Active theme is
   `'light'`, `DarkTheme` when `'dark'`), so navigator-chrome-owned surfaces match the Active
   theme. **Verified against the installed `@react-navigation/native-stack@6.11.0` source**
   (`lib/module/views/NativeStackView.native.js`'s `MaybeNestedStack`): every `'card'`-presentation
   screen's content wrapper reads `colors.background` from `useTheme()` (the same `theme` prop
   passed to `NavigationContainer`) and applies it as that screen's own `backgroundColor` — this
   is the concrete, source-confirmed mechanism by which the nav `theme` prop reaches the
   transition/content background, not an assumption. The one documented exception: native-stack's
   `MaybeNestedStack` explicitly skips applying `colors.background` for the `'transparentModal'`
   and `'containedTransparentModal'` presentations (neither of which this App currently uses —
   `ShareComposer`/`NotificationCenter` use plain `'modal'`), so this criterion's guarantee applies
   to every presentation this App actually configures today.

   **Superseding note (retrofit amendment):** in the `'dark'` case, the stock `DarkTheme`
   greys are replaced by a navigation theme built from the Twilight tokens (Requirement 10.3).
   The `'light'` case stays React Navigation's `DefaultTheme`, by identity. The mechanism
   described in this criterion is unchanged.
2. THE App SHALL set the OS status bar's style (`expo-status-bar`'s `StatusBar` `style` prop) to
   track the Active theme — `'dark'` content (dark icons/text) on a light Active theme, `'light'`
   content on a dark Active theme — replacing the existing hardcoded `style="auto"`.
3. THE safe-area root background (`react-native-safe-area-context`'s `SafeAreaProvider`'s root
   view / the outermost app container in `App.tsx`) SHALL use a background color consistent with
   the Active theme (light or dark). This covers two concrete, source-traced gaps where no
   `'card'`-presentation screen's own `colors.background` (Requirement 6.1) is yet painted: (a)
   the cold-mount window on initial app launch — `react-native-safe-area-context`'s
   `SafeAreaProvider` renders `null` for its `children` (not merely an unpainted background, but
   no children at all — `NavigationContainer`/`RootNavigator` are themselves among those
   unmounted children) until its first native insets callback resolves, so for this window the
   screen shows a bare, background-colored native view with nothing else drawn inside it yet, not
   `NavigationContainer` content sitting unpainted behind a backdrop; and (b) a
   `'transparentModal'`/`'containedTransparentModal'` presentation, where native-stack
   deliberately leaves the content wrapper transparent (per 6.1's note) so whatever sits behind it
   — ultimately this root background — is what shows through. Neither case is empirically
   demonstrated with a running app in this spec (that would require manual/device testing beyond
   static source inspection), so this criterion commits only to "the root background color is
   Active-theme-consistent," not to a stronger, unverifiable "no flash is ever visible" claim.
   (Amended, Spec Review Round 2 Finding 1: the cold-mount window's description is corrected from
   "the native root view committing and the first native-stack `Screen` completing its own
   layout" — which implied `NavigationContainer` content was already present and simply
   unpainted — to the source-confirmed fact that `SafeAreaProvider` renders no children at all
   during this window, verified against
   `node_modules/react-native-safe-area-context/src/SafeAreaContext.tsx`.)
4. Requirement 6.1–6.3 SHALL apply regardless of whether any individual screen's own content retrofits
   to the Active theme (see Introduction's Scope decision) — the navigation/status-bar/safe-area
   chrome is owned entirely by this spec and is unaffected by the deferred per-screen retrofit.
5. WHEN the App mounts, and again WHEN the Active theme changes, THE App SHALL set the native
   window/root view background (`expo-system-ui`'s `setBackgroundColorAsync`) to the same
   Active-theme root background as 6.3 (`#120a1f` dark, `#f5f2fb` light), so the area behind the
   Android edge-to-edge gesture/navigation bar, which lies outside the React root and cannot be
   painted by any JS view, never shows the platform default white under a dark Active theme. IF
   the native call rejects, THE App SHALL log the failure and SHALL NOT crash or block rendering.
   Like 6.1–6.3, this applies regardless of any screen's own retrofit (6.4). (Added, polish Fix 11:
   user-reported white strip below short stack screens in Dark, e.g. You & Crew scrolled to the
   bottom; root cause measured on `emulator-5554` in `.agents/tasks/dark-mode-retrofit/`
   `POLISH-plan.md`.)

### Requirement 7: Twilight Light/Dark Token Sets

**User Story:** As a User, I want dark mode to use a designed palette that fits the App's
purple-and-gold "twilight over the castle" look, so that it feels like the same App at night
rather than a generic grey inversion.

#### Acceptance Criteria

1. THE theme module (`apps/mobile/src/theme/theme.ts`) SHALL define a light and a dark value
   set with identical keys for each of these groups: `color`, `gradient`, `shadow`, `outline`,
   `parkAccent`, `categoryVisual` tint, `resortVisual` tint, and `tabBar`. The types SHALL make
   a missing or extra dark key a compile error.
2. THE light value set SHALL equal the pre-retrofit values exactly (design.md Configuration &
   Constants, "Light" columns). It SHALL add one new colour token, `primaryFg`, whose light
   value is `#5b2a86`.
3. THE dark value set SHALL equal the values in design.md Configuration & Constants ("Dark"
   columns), including the chosen category tints and the `DARK_TONAL` ramp.
4. THE dark palette SHALL meet these WCAG 2.x contrast floors:
   - `textPrimary`, `textSecondary`, `primaryFg` and the `success`/`danger`/`warning`
     foregrounds: at least 4.5:1 on `background`, `surface` and `surfaceAlt`.
   - `textOnPrimary` on `primary`: at least 4.5:1.
   - `textOnAccent` on `accent`: at least 4.5:1.
   - `warningText` on `warningSurface`: at least 4.5:1.
   - Every category tint and park accent: at least 3:1 on `surface`.
   - The tab-bar inactive tint: at least 3:1 on the tab-bar background.

   **Amendment (design-review iteration 3):** the first bullet also covers `primaryLight`.
   Every colour used as `Badge` text (category tints, park accents, `primaryFg`,
   `primaryLight`, tier text) SHALL reach at least 4.5:1 as text on its own 14 % tint over
   `surface`, `surfaceAlt` and `background`. White text or a white glyph on every dark category
   `fill` SHALL reach at least 4.5:1.
5. WHILE the Active theme is `'dark'`, chart marks (rating-histogram bars), progress fills
   (progress bar fill, progress-ring arc), the primary button gradient and the MagicFab disc
   SHALL reach at least 3:1 against the background they sit on (WCAG 1.4.11). Light values
   SHALL stay unchanged. *(Added by design-review iteration 3.)*
   **Amendment (design-review iteration 4):** "the background they sit on" means `surface` or
   `background`. The active `Chip` fill SHALL also reach at least 3:1 against `surface` and
   `background`. A `PrimaryButton` or active `Chip` rendered directly on a `surfaceAlt`
   container is outside this criterion (both are identified by their text label). WHEN a
   batch finds one, it SHALL list it in its report so the integrator can decide whether to
   move it.

**Amendment to criterion 1 (design-review iteration 3):** the `gradient` group also contains
`fab` and `chartBar`, and each `categoryVisual` entry and `resortVisual` carries both a `tint`
(foreground) and a `fill` (solid background behind white). Both have identical keys in both
schemes. In light, `fill` equals `tint`, and `fab`/`chartBar` equal today's `headerVivid`.
Criterion 2's single new colour token, `primaryFg`, is unchanged. No other colour token is
added.

### Requirement 8: Runtime Theme Resolution for Components

**User Story:** As a User, I want every part of the App to switch the moment I change the
Appearance setting or my device switches scheme, so that I never see a half-light,
half-dark screen.

#### Acceptance Criteria

1. THE App SHALL provide a `useAppTheme()` hook that returns the full theme (light or dark set)
   for the Active theme resolved by `useActiveTheme()`.
2. WHEN the Active theme changes, every mounted component that reads the theme SHALL re-render
   with the new theme's values, without an App restart or remount.
3. THE App SHALL provide a `makeStyles((t) => styles)` helper. Its returned `useStyles()` hook
   SHALL build the style sheet lazily on first use and at most once per scheme, never at module
   load. It SHALL return the identical object for the same scheme.
4. Non-colour tokens (`spacing`, `radius`, `layout`, `typography`) SHALL stay static and
   importable directly. Their values SHALL be identical in both schemes.
5. WHEN the Active theme changes, values derived from the theme inside memoized hooks
   (`useMemo`, `useCallback`, effects such as `navigation.setOptions`) and rows of virtualized
   lists (`FlatList`, `SectionList`, `DraggableFlatList`) SHALL also repaint with the new
   theme's values, without a remount. *(Added by design-review iteration 2. It makes the
   memoized and virtualized cases of 8.2 explicit.)*

### Requirement 9: Full-App Dark Retrofit With Unchanged Light Mode

**User Story:** As a User with Dark active, I want every screen, modal, sheet, card, chip,
header gradient, chart, badge and input to render dark, so that dark mode is real. As a User
with Light active, I want the App to look exactly as it does today.

#### Acceptance Criteria

1. WHILE the Active theme is `'dark'`, every reachable screen, modal, sheet, card, chip, header
   gradient, chart, badge, input and the tab bar SHALL render with the dark value set.
2. WHILE the Active theme is `'light'`, every surface SHALL render with the same colours as
   before this retrofit.
3. WHERE the primary hue is used as text, an icon, a link or a border on a surface, THE App
   SHALL use `primaryFg`. WHERE it is a fill behind light text, THE App SHALL use `primary`.
4. Every hardcoded colour literal in converted UI code SHALL become either a theme token whose
   light value equals the literal, or a co-located light/dark pair (`definePalette`) whose light
   value equals the original literal byte-for-byte. The dark value SHALL be chosen by
   design.md's literal conversion rules.
5. Pin artwork, avatar artwork and destination hero gradients SHALL render identically in both
   schemes. Only the UI around them changes.
6. Third-party and native controls SHALL receive themed props where the library supports them:
   - `react-native-calendars` calendars SHALL get a themed `theme` prop and remount when the
     scheme changes.
   - Every `TextInput` SHALL set its text colour, `placeholderTextColor` and
     `keyboardAppearance` from the Active theme.
7. WHILE the Active theme is `'dark'`, any `Text` or `TextInput` that previously relied on React
   Native's default text colour SHALL render in `textPrimary`. WHILE `'light'`, it SHALL keep
   the default exactly.
   **Amendment (design-review iteration 2):** criterion 7 applies only to a `Text`/`TextInput`
   that sets no colour, is not nested inside another `Text` (a nested `Text` inherits its
   parent's colour), and sits on a themed surface (`background`, `surface`, `surfaceAlt`, or a
   themed tint). On a background that is identical in both schemes (a gold fill, a dark hero
   surface, a data-encoding scale, a gradient, an image or artwork), React Native's default is
   kept in both schemes.
8. WHILE the Active theme is `'dark'`, a solid status fill (success, danger or warning) behind
   white text SHALL use a dark fill value that keeps the text at 4.5:1 or better.
9. WHERE a pin tier colour is used as UI text or an icon (e.g. a tier `Badge`), THE App SHALL
   use a tier-text value. Its light value SHALL equal the tier's artwork colour, and its dark
   value SHALL reach at least 4.5:1 as badge text over `surface`, `surfaceAlt` and
   `background`. Tier artwork, dots, swatches and progress fills SHALL keep the artwork colour
   in both schemes. *(Added by design-review iteration 2.)*
10. WHERE converted code reads a theme token in a role other than that token's natural role
    (e.g. a text token used as a background, or the `surface` token used as text on a
    `primary` fill), THE App SHALL convert the read by its role, exactly as design.md's
    conversion rules convert a literal of that token's light value in that role. It SHALL NOT
    substitute the same token's dark value. The light colour SHALL stay unchanged. *(Added by
    design-review iteration 3.)*
11. WHERE a category hue is a solid fill behind white text or a white glyph (e.g. an
    experience placeholder tile), THE App SHALL use that category's `fill` value. WHERE a
    category hue is text, an icon, a border or a `Badge` colour, THE App SHALL use its `tint`
    value. *(Added by design-review iteration 3.)*
12. WHILE the Active theme is `'dark'`, a selected or active indicator (a selected card ring, a
    selected pill border, a selected recipient icon, an active tab/toggle pill) SHALL differ
    from the unselected state and reach at least 3:1 against the surface it sits on, and an
    active tab, toggle or pill label SHALL NOT be dimmer than the idle label beside it.
    *(Added by the dark-mode polish pass.)*
13. WHILE the Active theme is `'dark'`, muted secondary copy (the light neutral `#655d78` band)
    SHALL use `textSecondary`, and the near-black heading, name or ink text in the same
    component SHALL use `textPrimary`, so muted copy is never brighter than its heading.
    *(Added by the dark-mode polish pass.)*
14. Badges and overlays drawn on a photograph SHALL keep the same fill in both schemes, because
    the photograph does not change with the scheme. *(Added by the dark-mode polish pass.)*
15. WHILE the Active theme is `'dark'`, every React Native `Switch` SHALL receive token-derived
    `trackColor` (false and true), `thumbColor` and `ios_backgroundColor`, with the "on" state
    reading stronger than "off". WHILE `'light'`, it SHALL receive exactly today's props
    (platform defaults where it set none). It SHALL remount on a scheme switch.
    *(Added by the dark-mode polish pass.)*

**Amendment to criterion 3 (design-review iteration 3):** "text, an icon, a link or a border"
also includes data marks drawn on a surface: progress-bar fills and progress-ring arcs use
`primaryFg`, not `primary`. Their light value is unchanged, because `primaryFg` equals
`primary` in light.

### Requirement 10: Dark Tab Bar and Navigation Chrome

**User Story:** As a User with Dark active, I want the tab bar and the navigation chrome to
match the dark screens and keep their icons clearly visible.

#### Acceptance Criteria

1. WHILE the Active theme is `'dark'`, the bottom tab bar SHALL render as follows:
   - background `#170e27`, top border `#33264d`
   - active tint `#f6c343`, inactive tint `#8a7fa3`
   - Vault badge background `#f6c343`, badge text `#3d1c5c`
2. WHILE the Active theme is `'light'`, the tab bar SHALL keep today's exact values:
   - active `#003a9b`, inactive `#6b7280`
   - React Navigation `DefaultTheme` card and border
   - badge `#d97706` with `#ffffff` text
3. WHEN the Active theme is `'dark'`, `deriveAppearanceChrome` SHALL pass `NavigationContainer`
   a theme built from the Twilight tokens: `primary` = `primaryFg`, `background` =
   `background`, `card` = tab-bar background, `text` = `textPrimary`, `border` = tab-bar
   border, `notification` = `danger`.
4. `DARK_ROOT_BACKGROUND` SHALL equal the dark `background` token (`#120a1f`).
5. THE center `MagicFab` and its sheet SHALL render from the Active theme's gradient and
   surface tokens.
   **Amendment (design-review iteration 3):** the FAB disc uses the dedicated `gradient.fab`
   token. Its light value equals today's FAB gradient, and its dark value meets criterion 7.5.

### Requirement 11: Structural Regression Guard

**User Story:** As a maintainer, I want the build to fail when someone adds a colour that
can't follow the Active theme, so that dark mode can't silently rot.

#### Acceptance Criteria

1. A structural test SHALL scan every non-test `apps/mobile/src/**/*.{ts,tsx}` file. It SHALL
   fail when a file outside the allowlist contains any of the following:
   - a hex colour literal
   - an `rgb()`/`rgba()` literal whose RGB triple is not `255,255,255` or `0,0,0`
   - a static colour-token read (`theme.color|gradient|shadow|parkAccent|categoryVisual|resortVisual`)
   - a named import of a static or per-scheme colour export from the theme module
2. THE allowlist SHALL be exactly the one in design.md. The only other exemption SHALL be
   `shadowColor: '#000'`/`'#000000'`.
3. Every `*.palette.ts` file SHALL define its pairs only with `definePalette`, with identical
   light and dark keys.
4. WHEN the retrofit is complete, the static `theme` export SHALL contain only `spacing`,
   `radius`, `layout` and `typography`. The theme module SHALL export no static colour objects.
5. THE guard SHALL fail when an allowlist entry names a file that does not exist.

### Requirement 12: Conventions and Verification Record

**User Story:** As a future contributor, I want the repo's conventions to describe the themed
pattern, and the visual result to be on record, so that new work follows the pattern and dark
mode isn't declared done on test output alone.

#### Acceptance Criteria

1. THE `.kiro/steering/tech-conventions.md` Mobile conventions SHALL be updated in the same
   change. They SHALL describe `useAppTheme`/`makeStyles`/`definePalette`, the
   `primary`/`primaryFg` rule, and the regression guard.
2. Before the retrofit is declared done, light and dark screenshots of every screen on
   design.md's checklist SHALL be captured into `.agents/tasks/dark-mode-retrofit/screenshots/`
   and reviewed. The light baseline SHALL be captured before any visual change.

## Out of Scope

- **Per-screen visual retrofit of the 135 files currently importing the static `theme`/`color`
  export, and the 15 files with hardcoded hex colors and no theme import at all.** This spec adds
  the preference mechanism, the Profile control, and the navigation/status-bar/safe-area chrome
  only. No individual screen's `StyleSheet` colors are changed by this spec. A follow-up spec must
  define and execute that retrofit (widening `theme/theme.ts`'s static export into a theme-aware
  hook/context, defining the actual dark palette's color values, and converting consumers).
  **Superseded (retrofit amendment):** now in scope via Requirements 8, 9, 10 and 11.
- **Defining the dark color palette's actual values.** This spec defines the *mechanism*
  (preference, persistence, resolution, chrome wiring) and leaves the dark palette's concrete hex
  values as a follow-up-spec/design decision — the only immediate consumer of "dark" colors in
  this spec is React Navigation's own built-in `DarkTheme`, not a new Disney-themed dark palette.
  **Superseded (retrofit amendment):** the Twilight palette is now defined by Requirement 7 and
  design.md Configuration & Constants.
- **Per-account/synced appearance preference.** The preference is local-only (Requirement 3); no
  `apps/api` or `packages/shared` change is in scope. If a future need for a synced,
  cross-device preference emerges, that is a separate spec.
- **Scheduled/time-based automatic dark mode independent of the OS setting** (e.g. "dark from
  sunset to sunrise" inside the App itself) — the App only ever follows the OS's own scheme in
  `'system'` mode; it does not implement its own sunset/sunrise scheduling.
- **Theming of third-party native UI not under this App's style control** (e.g. OS-rendered
  permission dialogs, the native image picker, calendar picker's native chrome) beyond what
  `react-native-calendars`/`expo-image-picker` already theme automatically.
  **Partially superseded (retrofit amendment):** `react-native-calendars` and `TextInput` now
  receive themed props (Requirement 9.6). OS-rendered dialogs, the native image picker and the
  Android system navigation bar remain out of scope. So does adding `expo-system-ui`, a new
  native dependency.
- **Light-mode accessibility fixes** found while computing contrast (e.g. the pre-existing light
  Vault badge, white on `#d97706` at 3.19:1). Requirement 9.2 keeps light mode unchanged, so
  these are recorded in design.md for a future pass and not fixed here.
