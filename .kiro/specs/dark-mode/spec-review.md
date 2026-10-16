# Dark Mode Spec Review (Round 3 — Fix Confirmation Pass)

Reviewed fresh against `requirements.md`, `design.md`, `tasks.md` in this spec folder, and the
real source files the design claims to cite for the one outstanding finding from Round 2
(`spec-review.md`/`spec-review.json`, prior revision): `apps/mobile/src/App.tsx`,
`node_modules/react-native-safe-area-context/src/SafeAreaContext.tsx`,
`node_modules/react-native-safe-area-context/src/NativeSafeAreaProvider.tsx`,
`node_modules/react-native-safe-area-context/src/specs/NativeSafeAreaProvider.ts`,
`node_modules/@react-navigation/native-stack/src/views/NativeStackView.native.tsx`,
`node_modules/@react-navigation/elements/src/SafeAreaProviderCompat.tsx`,
`apps/mobile/src/navigation/RootNavigator.tsx`, `apps/mobile/src/theme/components.tsx` (`Chip`),
`apps/mobile/src/theme/theme.ts`, and `apps/mobile/package.json`.

This is explicitly a **confirmation pass**, not a fresh design review: the brief was to verify
that the single Round 2 MEDIUM finding (the wrong-component `SafeAreaProvider` citation) is
correctly fixed, and to do a final format-cleanliness pass. No new design debates are opened.

## Finding 1 (Round 2) — Fix Verification

**Claim being checked:** design.md's App.tsx component section and "Spec Review Responses" now
cite `node_modules/react-native-safe-area-context/src/SafeAreaContext.tsx`'s `SafeAreaProvider`
as "the component `App.tsx` actually renders," rather than `@react-navigation/elements`'s
`SafeAreaProviderCompat.tsx`.

**Verified directly against real source, not taken on the document's word:**

- `apps/mobile/src/App.tsx` line 8: `import { SafeAreaProvider } from 'react-native-safe-area-context';`.
  Confirmed — this is exactly the component the corrected design.md citation now points to.
  Installed version: `react-native-safe-area-context@5.7.0` (`apps/mobile/package.json` pins
  `~5.7.0`; `node_modules/react-native-safe-area-context/package.json` confirms `5.7.0` resolved).
- `node_modules/react-native-safe-area-context/src/SafeAreaContext.tsx`'s `SafeAreaProvider`:
  confirmed it forwards `style` onto `<NativeSafeAreaProvider style={[styles.fill, style]}
  onInsetsChange={onInsetsChange} {...others}>`, and confirmed the render body is
  `{insets != null ? (<SafeAreaFrameContext.Provider ...><SafeAreaInsetsContext.Provider
  ...>{children}</SafeAreaInsetsContext.Provider></SafeAreaFrameContext.Provider>) : null}` with
  `insets`'s initial state `initialMetrics?.insets ?? initialSafeAreaInsets ?? parentInsets ??
  null`. Since `App.tsx`'s call site passes none of those and has no parent provider, `insets`
  starts `null`, so `children` (i.e. everything from `QueryClientProvider` down through
  `RootNavigator`) renders as `null` until the first native `onInsetsChange` callback — exactly
  what design.md's corrected text and requirements.md's amended 6.3 now state. This is the design's
  "renders `null` for `children`, not merely an unpainted background" claim, confirmed verbatim.
- `node_modules/react-native-safe-area-context/src/NativeSafeAreaProvider.tsx` re-exports
  `./specs/NativeSafeAreaProvider`, which is `codegenNativeComponent<NativeProps>('RNCSafeAreaProvider')`
  — confirms design.md's claim that the native host component is `'RNCSafeAreaProvider'` and that
  `style` reaches a real native view.
- `node_modules/@react-navigation/elements/src/SafeAreaProviderCompat.tsx`: confirmed this is a
  *different* component — it only wraps `NativeStackView`'s content, never receives a `style`
  prop from `App.tsx`, and in fact short-circuits to a plain `<View>` (no `SafeAreaProvider` at
  all) whenever a parent's insets are already in context, which they would be here since `App.tsx`
  renders its own `SafeAreaProvider` above `NavigationContainer`. Confirmed via
  `node_modules/@react-navigation/native-stack/src/views/NativeStackView.native.tsx`: `export
  default function NativeStackView(props) { return <SafeAreaProviderCompat><NativeStackViewInner
  {...props} /></SafeAreaProviderCompat>; }`, with no `style` prop passed. Design.md's claim that
  this component plays no role in this spec's `rootBackground` wiring is correct.
- `MaybeNestedStack`'s `colors.background` claim (Requirement 6.1), independently re-checked
  against the same `NativeStackView.native.tsx` source: `const { colors } = useTheme(); ...`
  applied as `presentation !== 'transparentModal' && presentation !== 'containedTransparentModal'
  && { backgroundColor: colors.background }` on the `DebugContainer` content wrapper — matches
  design.md/requirements.md verbatim.
- The "no screen in this App uses `transparentModal`/`containedTransparentModal`/`formSheet`"
  claim: grepped `apps/mobile/src/**/*.tsx` for those three presentation strings — zero matches.
  Confirmed `apps/mobile/src/navigation/RootNavigator.tsx` sets `ShareComposer`
  (`options={{ title: 'Share', presentation: 'modal' }}`) and `NotificationCenter`
  (`options={{ presentation: 'modal', headerShown: false }}`) to plain `'modal'`. Matches
  Requirement 6.1's and the design's claim exactly.

**Verdict on Finding 1: correctly fixed.** The citation now points at the real component
`App.tsx` renders, the "renders `null` for children" fact is folded in accurately, the
`MaybeNestedStack`/native-stack half of the original claim (which was never wrong) is correctly
retained, and the `SafeAreaProviderCompat` tangent is correctly described as irrelevant to this
spec's wiring rather than silently dropped. Requirement 6.3's amendment note and design.md's App.tsx
section and Spec Review Responses section are all mutually consistent on this point — no
contradiction found between them.

## Format Cleanliness Pass

- **EARS criteria:** all six requirements (`requirements.md`) use `THE/WHEN/WHILE/IF ... SHALL`
  phrasing consistently; checked every acceptance criterion in Requirements 1–6. No bare
  declarative statements masquerading as acceptance criteria.
- **Design.md required sections, all present and in order:** Overview → Architecture →
  Components and Interfaces → Data Models → Correctness Properties → Error Handling → Testing
  Strategy → Configuration & Constants → External Interfaces → Cross-Spec Dependencies (plus a
  trailing "Spec Review Responses" appendix, which is additive documentation, not a required
  section, and doesn't displace any of the above).
- **Correctness Properties formatting:** all six properties use `### Property N: <title>` headings
  and a `**Validates:**` line citing real requirement numbers. Checked every citation
  (`1.2/3.3`, `2.1/2.2`, `6.1/6.2/6.3`, `4.2/4.3/5.2`, `5.1/5.3`, `3.4`) against requirements.md —
  all resolve to criteria that exist.
- **tasks.md checkboxes:** every task/subtask line uses `- [ ]` exclusively (regex-checked for any
  `- [x]`, `- [/]`, or other marker — none found; this spec has no completed tasks yet, which is
  consistent with it having no implementation).
- **`_Requirements:` references:** every task/subtask carries one, and every requirement number
  cited (spanning 1.1–6.4, plus task 6.1's `all`) resolves to a real acceptance criterion in
  requirements.md. No dangling reference found.
- **Task Dependency Graph consistency:** the JSON `waves` block lists every task id from 1.1
  through 6.1 exactly once, in an order consistent with the prose dependency list below it (1 → 2
  → 3 → {4, 5 in parallel} → 6) and with the inline "Tasks 4 and 5 both depend only on Task 3 ...
  may be implemented in either order or in parallel" note. No task id appears twice or is missing
  from the graph.
- **`## Notes` section present** and consistent with the rest of the plan (no visual retrofit, one
  AsyncStorage key/store/hook, placeholder dark-background value, no backend/shared changes).

No format defects found.

## Verified Assumptions

- `apps/mobile/src/App.tsx` imports `SafeAreaProvider` from `'react-native-safe-area-context'`
  directly (line 8), matching design.md's corrected citation.
- `react-native-safe-area-context`'s `SafeAreaProvider` (`src/SafeAreaContext.tsx`) forwards
  `style` onto the real native `RNCSafeAreaProvider` host view and renders `null` children until
  insets resolve — both facts design.md now states, confirmed against source.
- `@react-navigation/elements`'s `SafeAreaProviderCompat` is a distinct, internal component used
  only by `native-stack`'s `NativeStackView`, receives no `style` prop, and (per its own source)
  degrades to a plain `View` when insets are already in context — confirming it has no bearing on
  this spec's `rootBackground` wiring, as design.md now states.
- `NativeStackView.native.tsx`'s `MaybeNestedStack` applies `colors.background` from `useTheme()`
  for every presentation except `transparentModal`/`containedTransparentModal`, and no screen
  anywhere in `apps/mobile/src` uses either of those or `formSheet`; `ShareComposer` and
  `NotificationCenter` both use plain `'modal'`.
- `Chip` (`theme/components.tsx`) sets `accessibilityRole="button"`, `accessibilityState={{
  selected: active }}`, and a default spoken label of `"{label}, {selected/not selected}"` —
  matching every claim design.md makes about it in the `AppearancePreferenceControl` section and
  Requirement 5.
- Requirements.md's EARS phrasing, design.md's section set/order, the Correctness Properties'
  `### Property N` / `**Validates:**` formatting, and tasks.md's checkbox/`_Requirements:`/Task
  Dependency Graph formatting are all clean per the checks above.

## Unverified / Wrong Assumptions

None found this round. The one outstanding finding carried in from Round 2 is resolved (see
Finding 1 above), and no new issue surfaced during this confirmation pass.

## Verdict

0 HIGH, 0 MEDIUM, 0 NIT findings this round → **APPROVED**.
