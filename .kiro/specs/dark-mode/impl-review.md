# Dark Mode — Implementation Review

Appearance-preference mechanism (system/light/dark) for `apps/mobile`, reviewed against
`.kiro/specs/dark-mode/{requirements,design,tasks}.md`. The implementation adds a pure
`appearance.ts` domain module, an `appearanceStorage.ts` AsyncStorage boundary, a `themeStore.ts`
Zustand store, a `useActiveTheme()` hook, a `deriveAppearanceChrome()` chrome-derivation function
wired into `App.tsx`, and an `AppearancePreferenceControl.tsx` built on the existing `Chip`
primitive and inserted into `ProfileScreen.tsx`. Every file, type, and value named in design.md
(`DARK_ROOT_BACKGROUND`, the AsyncStorage key, the mock path/export shape, the `useColorScheme`
mock pattern) matches what's actually in the diff — nothing was invented or diverged from the
spec. This is a second pass: the prior review (same file, prior revision) flagged exactly one
blocking issue — Task 6.1's full `npm run verify` gate was unchecked with no recorded run. That
gap is now closed: `tasks.md` Task 6.1 is checked and carries a recorded result (`npm run verify`
from the repo root, exit code 0, 411/2905 `apps/api`, 261/1829 `apps/mobile`, 37/470
`packages/shared` test files/tests passed, plus a note on one earlier flaky unrelated failure
re-confirmed clean on rerun). Watch for: the working tree also carries a sizeable unrelated change
(a global `keyboardShouldPersistTaps` default plus a `FriendsSearchScreen` status-indicator
feature) bundled into the same diff — out of this spec's scope but not a guardrail violation
(confirmed below), and a narrow `npm run typecheck` spot-check in `apps/mobile` run during this
pass passed clean, consistent with the recorded gate.

**Verdict**: APPROVED

## High-level view

The pure/domain layer (`appearance.ts`: `isAppearancePreference`, `resolveActiveTheme`,
`resolveStatusBarStyle`, the two root-background constants) is implemented exactly as
design.md specifies, including one legitimate addition beyond the spec text —
`useActiveTheme.ts` normalizes RN 0.85's `'unspecified'` `useColorScheme()` return value to
`null` before calling `resolveActiveTheme`, which design.md's four-value domain didn't anticipate
but which is the correct behavior under Requirement 1.3's "unknown/null scheme" fallback.

Persistence is a faithful mirror of `api/sessionStorage.ts`'s shape: `appearanceStorage.ts` is
the sole AsyncStorage-touching module, catches both a throwing read and a corrupt/missing value,
and falls back to `'system'` without ever throwing past its boundary — all three Requirement 3.3
failure modes have an explicit matching unit test. `themeStore.ts` mirrors `sessionStore.ts`'s
shape (`preference`/`hydrated`/`setPreference`/`loadFromStorage`) and, as Requirement 3.4/Property
6 demand, imports nothing from `sessionStore.ts` or `api/sessionStorage.ts` — verified both
structurally (no such import exists in the file) and by a passing 100-run property test driving
arbitrary `setToken`/`clearToken` sequences against an independently-asserted-unchanged
`themeStore` preference.

The three chrome surfaces (Requirement 6) are wired through one single exported function,
`deriveAppearanceChrome()`, called identically by `App.tsx` and by `App.appearance.test.tsx` —
exactly the Finding-2 fix design.md describes, so the test exercises the real production path,
not a parallel stand-in. `App.tsx`'s diff shows the Navigation `theme` prop, the `StatusBar
style`, and the `SafeAreaProvider` background all now derived from this one function, replacing
the prior hardcoded `style="auto"`.

The Profile control reuses the existing `Chip` primitive verbatim (confirmed by reading
`theme/components.tsx`: `accessibilityRole="button"`, `accessibilityState={{ selected }}`, and a
spoken label combining the option name with its selection state), so Requirement 5's
accessibility criteria are satisfied by construction with no new accessibility code introduced.
It's gated to self-mode in `ProfileScreen.tsx` identically to the existing Notifications/Account
Security cards, and a dedicated test asserts the card is absent for a non-self `userId`.

All 6 Correctness Properties have a matching, correctly-tagged `fast-check` test at ≥100 runs,
and all of them exercise real production code (the actual exported `resolveActiveTheme`,
`deriveAppearanceChrome`, and a fully-rendered `AppearancePreferenceControl` via
`@testing-library/react-native`) rather than reimplemented logic. No scope creep into `apps/api`
or `packages/shared` — confirmed by `git status`, nothing under either path is touched. No
per-screen `StyleSheet` retrofit was found anywhere in the diff. The dependency is pinned to
exact `"2.2.0"` in both `package.json` and `package-lock.json`, matching Configuration & Constants.

<details>
<summary>Issues (0)</summary>

No blocking issues. The prior pass's single finding (Task 6.1 verification gate never run) is
resolved: `tasks.md` now records the full `npm run verify` run with per-workspace pass counts and
exit code 0, and the task checkbox is checked. A narrow spot-check (`npm run typecheck` in
`apps/mobile`) was re-run during this pass and passed clean, consistent with that record — the
full suite itself was not re-run, per this review's instruction to read recorded evidence rather
than re-running it absent a specific doubt.

</details>

<details>
<summary>Details</summary>

### Requirement coverage (1.x–6.x)

- **Requirement 1 (three-state preference, default system)** — `AppearancePreference =
  'system' | 'light' | 'dark'`, `APPEARANCE_PREFERENCE_VALUES`, and
  `DEFAULT_APPEARANCE_PREFERENCE = 'system'` are all defined exactly as design.md specifies in
  `appearance.ts`. `resolveActiveTheme` returns the explicit preference for `'light'`/`'dark'`
  and falls through to the OS scheme (defaulting to `'light'` on null/undefined) for `'system'` —
  covered by both exhaustive unit tests (`appearance.test.ts`) and the Property 2 fast-check test.
- **Requirement 2 (live OS-scheme reaction)** — `useActiveTheme()` subscribes to both
  `useThemeStore`'s `preference` and RN's `useColorScheme()`, so a change to either triggers a
  re-render through each hook's own subscription — no manual listener wiring, matching the design.
  `useActiveTheme.test.tsx` simulates a live OS-scheme change via `act(() => { mock...; rerender()
  })` and confirms it only takes effect while `preference === 'system'`, and stays pinned
  otherwise (Requirement 2.2) — asserted directly, not inferred.
- **Requirement 3 (AsyncStorage persistence, fallback-to-system)** — `appearanceStorage.ts`
  implements all three named failure modes (missing key, throwing read, corrupt string) with each
  one having its own dedicated unit test in `appearanceStorage.test.ts`, plus a round-trip
  set/get test. `themeStore.ts`'s `setPreference` sets in-memory state synchronously before
  awaiting the storage write, and swallows a write failure (asserted in `themeStore.test.ts`'s "a
  simulated storage-write failure still leaves preference updated in memory" test) — matching the
  Error Handling table's row 4 exactly. Session-invariance (Requirement 3.4) is both structurally
  true (no import from `sessionStore.ts`/`api/sessionStorage.ts` in either `themeStore.ts` or
  `appearanceStorage.ts`) and covered by the Property 6 100-run test driving arbitrary
  `setToken`/`clearToken` sequences.
- **Requirement 4 (Profile toggle via Chip)** — `AppearancePreferenceControl.tsx` renders exactly
  three `Chip`s from `theme/components.tsx` (the real component import, not a reimplementation),
  inserted into `ProfileScreen.tsx`'s self-mode block between the Notifications and Account
  Security cards. Selecting an option calls `setPreference` without awaiting
  (`void setPreference(...)`), so the Zustand `set()` call (which happens before the storage
  `await`) is reflected on the very next render — exercised by
  `AppearancePreferenceControl.test.tsx`'s selection tests and the Property 4 sequence test.
- **Requirement 5 (accessibility)** — `Chip`'s existing implementation sets
  `accessibilityRole="button"` and `accessibilityState={{ selected: active }}`
  unconditionally, plus a spoken `accessibilityLabel` of `"{label}, {selected/not selected}"`
  when no override is passed; `AppearancePreferenceControl` passes no override, so every option
  gets this label by construction. Property 5's test independently confirms every option keeps
  its role and a name-containing label regardless of selection state — the one thing that could
  have silently regressed if the control conditionally rendered chips instead of always
  rendering all three.
- **Requirement 6 (chrome: nav theme, status bar, safe-area background)** — `App.tsx`'s diff
  shows all three wired through the single `deriveAppearanceChrome(activeTheme)` call: `theme=`
  on `NavigationContainer`, `style=` on `StatusBar` (replacing the previous hardcoded `"auto"`),
  and `backgroundColor` on `SafeAreaProvider`. `App.appearance.test.tsx` calls the identical
  exported function (not a parallel reimplementation) and asserts the DefaultTheme/DarkTheme,
  `'dark'`/`'light'` status-bar-style, and `LIGHT_ROOT_BACKGROUND`/`DARK_ROOT_BACKGROUND` triple
  for both Active themes, plus the Property 3 test over the full `(preference, osScheme)` input
  domain confirming the triple collapses correctly onto each Active theme.

### Correctness Properties — test mapping

| Property | Test file | Confirmed real-behavior? |
| --- | --- | --- |
| 1 — fallback is total | `appearance.prop.test.ts` | Yes — calls real `isAppearancePreference` |
| 2 — pinned preference scheme-invariant | `appearance.prop.test.ts` | Yes — calls real `resolveActiveTheme` |
| 3 — chrome triple is pure/total | `App.appearance.test.tsx` | Yes — calls real `deriveAppearanceChrome` + `resolveActiveTheme` |
| 4 — control selection agrees with store | `AppearancePreferenceControl.prop.test.tsx` | Yes — renders real component, `fireEvent.press`, reads real `useThemeStore.getState()` |
| 5 — every option labeled/operable | `AppearancePreferenceControl.prop.test.tsx` | Yes — renders real component, inspects real `accessibilityRole`/`accessibilityLabel` props |
| 6 — preference invariant under session change | `themeStore.test.ts` | Yes — drives real `useSessionStore`, reads real `useThemeStore.getState()` |

The mocking boundary in every component/store test is exactly what design.md names: only
`@react-native-async-storage/async-storage` (via the package's own shipped jest mock, confirmed
to be a default export backed by a real in-memory fake) and, for the hook test, `react-native`'s
`useColorScheme` via `Object.getOwnPropertyDescriptors` spreading (a deliberate, well-explained
deviation from design.md's literal `{ ...jest.requireActual(...) }` spread form — the test file's
own comment explains that a plain object-spread eagerly invokes every lazy getter in RN
0.85.3's `index.js`, including `DevMenu`, which throws outside a native runtime; the
descriptor-copy form preserves every export as a lazy getter and replaces only
`useColorScheme`'s descriptor, reaching the same "don't shadow anything else" intent design.md
describes). This is a reasoned, necessary adaptation to the installed RN version, not scope
drift.

### Unrelated changes bundled in the same diff

The working tree also contains a sizeable, unrelated change: a new `setupScrollDefaults.ts` that
monkey-patches `ScrollView`/`FlatList`/`SectionList`'s `defaultProps` to default
`keyboardShouldPersistTaps` to `'handled'` app-wide, wired into both `App.tsx` and
`apps/mobile/src/index.ts`, plus a `FriendsSearchScreen.tsx` feature (showing
friends/pending-request status on search result rows) with its own new test file
(`FriendsSearchScreen.test.tsx`), and a scattering of individual `keyboardShouldPersistTaps`
props and `jest.mock('@react-native-async-storage/async-storage', ...)` additions across
~20 other trip/navigation test files. None of this is dark-mode scope — it isn't under
`apps/api`/`packages/shared` so it doesn't trip that specific guardrail, but it's a materially
separate feature/fix bundled into the same working tree. The `@react-native-async-storage`
mock additions in pre-existing navigation/trip test files are legitimate and necessary (those
tests render `ProfileScreen`, which now transitively mounts `AppearancePreferenceControl`), not
scope creep. The scroll-default and friends-status changes are unrelated to this spec and worth
flagging to the user, though they don't violate this review's specific no-scope-creep check
(apps/api / packages/shared / per-screen StyleSheet retrofit).

</details>
