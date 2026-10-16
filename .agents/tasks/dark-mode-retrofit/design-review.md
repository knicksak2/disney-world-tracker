# Design Review (iteration 4) — Dark-Mode Retrofit ("Twilight")

Reviewed:

- `.agents/tasks/dark-mode-retrofit/design.md` (revised after iteration 3)
- `.kiro/specs/dark-mode/{requirements,design,tasks}.md`

I checked both documents against the real `apps/mobile/src` tree and the installed packages.
Every new or changed contrast ratio was recomputed with a stdin `node -` WCAG 2.x expression.
Spec structure was cross-checked with a stdin script (requirement ids, `_Requirements:_` and
`**Validates:**` references, property headings, the dependency graph). No build or test suite
was run. Nothing was written to the repo except this review and its JSON.

**Verdict: CHANGES_REQUESTED** (0 HIGH, 1 MEDIUM, 4 NIT)

All 13 iteration-3 findings are resolved in both documents. Two fixes deliberately differ from
what the reviewer proposed: the end stop is `#7650b9`, not `#6d45b0`, and data marks reuse
`primaryFg` rather than a new `dataFill` token. Both differences are correct. I reproduced
`#6d45b0` at 2.61 and `#7650b9` at 3.02 against `#1e1430`, and `primaryFg` vs `surfaceAlt` at
7.41. The one remaining MEDIUM is in the new light-colour multiset audit. As written, it
produces "unexplained differences" on correctly converted real files, because it doesn't
extract several read forms the tree actually uses.

## Checklist results (a)–(g)

| Check | Result |
| --- | --- |
| (a) Spec amendment is additive | **Pass.** Requirements 1–6, Properties 1–6 and Tasks 1–6 are intact and still `[x]`. The superseding notes are present: Introduction, 6.1, Out-of-Scope bullets 1–2 "Superseded", bullet 5 "Partially superseded". New items are appended: 7.5, 9.10, 9.11, the amendment notes on 7.1/7.4/9.3/10.5, Property 22, and the iteration-3 notes in tasks 3.2/7.2/7.6/8.x/9.x/10.1. Structural checks are clean: 66 requirement/criterion ids; all 254 references resolve (the only non-numeric ones are the 2 pre-existing `_Requirements: all_` on tasks 6.1/12.1); Properties 1–22 are contiguous and each has `**Validates:**`; there are 0 bad checkbox markers; `# Implementation Plan` / `## Tasks` / `## Notes` / `## Task Dependency Graph` are present; every sub-task id appears in the graph and the graph has no extra ids. |
| (b) Light tokens equal today's hexes | **Pass.** The colour table matches `theme/theme.ts`: `#f5f2fb`, `#ffffff`, `#1f1235`, `#6b6480`, and so on. New iteration-3 keys are light-identical: `gradient.fab` and `chartBar` equal `headerVivid` light `['#7e57c2','#5b2a86','#3d1c5c']`, `fill === tint`, and `primaryLight` light stays `#7e57c2`. Pinned by Property 8. The `withAlpha` output matches today's `hexToRgba` (`components.tsx:490`) format. |
| (c) Dark set has every light key + `primaryFg` | **Pass.** There are 22 colour rows. `gradient` has 5 keys in both schemes. `fill` is present for all 14 categories and for `resortVisual`. `satisfies ColorTokens` and Property 7 enforce this. |
| (d) Tints ≥ 3:1 on `#1e1430`; text pairs ≥ 4.5:1, with computation | **Pass for every shown pair.** These reproduce to two decimals: `#7650b9` 3.02 (white 5.80), `#744eb6` 2.93, `#9d7ae0` 5.25 (white 3.34), `#7e57c2` 3.36 (white 5.21), `#c4a3ff` 8.37 (vs `surfaceAlt` 7.41), `#b28dff` 6.80/6.02/7.48 (badge 5.39/4.71/6.14, white 2.58), all 11 dark fills (white 5.03–9.96), the light white-on-fill column, toast 17.56/10.71 (vs background 1.10, hence the outline), and `#1e1430` on `#7e57c2` 3.36. Minor gaps are in NITs 3 and 4. |
| (e) Batch decomposition is disjoint | **Pass.** The iteration-3 W1 test ownership list exists on disk: all 12 named test files. A basename scan finds one more W1-matching test, `navigation/__tests__/StatsStack.test.tsx`, which is already covered by the "`src/navigation/__tests__/*`" bullet. The new Property 22 tests are owned by first-segment: `ExploreHubScreen.test.tsx` B1, `MarkGottenUndoToast.test.tsx` B3, `TripReservationsScreen.test.tsx` B5. No file has two owners. |
| (f) Regression-guard allowlist is concrete | **Pass.** The arrays are exact. The aliased `theme as <alias>` specifier is now flagged, with a Property 15 fixture. `useAppTheme.ts`/`makeStyles.ts` exist by task 7.3, before the guard (8.5) asserts existence. |
| (g) Hook / `makeStyles` API is unambiguous | **Pass.** Unchanged from iteration 3 (previously type-checked under `tsc --strict`). |

## Findings

### 1. MEDIUM — The light-colour multiset audit misses read forms the real tree uses, so correct conversions fail the gate

**Where:** task design "Per-batch definition of done" item 2 (the binding audit); spec
design "Light-colour multiset audit"; spec task 9 "Done when". The audit is the binding
pass/fail proof, and "an unexplained difference fails the definition of done". It has four
gaps, and each one produces a mismatch on a correctly converted file:

- **(a) `before` only extracts `theme.<group>…` reads.** The tree also reads colours through
  named imports:

  | File | Import | Owner |
  | --- | --- | --- |
  | `features/notifications/NotificationBell.tsx:16` | `import { color }` | W1 |
  | `screens/navigation/AvatarChip.tsx:18` | `import { color }` | B7 |
  | `screens/experienceLists/ExperienceListDetailScreen.tsx:36` | `import { theme, categoryVisual }` | B3 |
  | `screens/trips/ExperiencePicker.tsx:32` | `import { theme, categoryVisual }` | B5 |

  In these files, `color.primary` / `categoryVisual[cat]` contribute nothing to `before`, but
  their converted `t.color.primary` / `t.categoryVisual[cat]` contribute to `after`. So the
  audit reports a difference that no conversion rule justifies.
- **(b) Aliased palette records aren't extracted.** `after` only counts `P[t.scheme].k` and
  `usePalette(P).k`. But the memoized-consumer rule tells batches to list "a
  `usePalette(...)` result … the palette record" in dependency arrays, which presupposes
  `const pal = usePalette(P); … pal.k`. The task design also never states the inline-only read
  form that spec design line 654 states ("read inside a factory as `P[t.scheme].key`, or in a
  render as `usePalette(P).key`"). An executor following the memo rule writes code the audit
  can't see.
- **(c) Alpha normalisation is textual.** `TripPlannedListScreen.tsx:1186`
  `'rgba(91, 42, 134, 0.10)'` → rule 2 → `withAlpha(t.color.primary, 0.10)`, which renders
  `rgba(91, 42, 134, 0.1)`. After whitespace-stripping, `…,0.10)` ≠ `…,0.1)`. That's the same
  colour, but the audit fails it.
- **(d) Ambiguous exemption clause.** "except the rule-5 exemptions (…), counted only if they
  were also in before(F)" can be read two ways: "exempt literals are excluded", or "exempt
  literals are counted, capped at their `before` count".

**Fix (same text in both designs and in task 9's Done-when):**

```text
before(F) also includes, when S has `import { …color…, …categoryVisual…, … } from '<theme>'`
(the guard's STATIC_IMPORT_RE): LT's value for every bare read
  /(?<![\w.])(color|gradient|shadow|parkAccent|categoryVisual|resortVisual)((?:\.\w+)+)/g
and the symbolic `[*]` form for
  /(?<![\w.])(color|gradient|shadow|parkAccent|categoryVisual|resortVisual)\[[^\]]+\]((?:\.\w+)*)/g
(only names actually imported in S; an `as Alias` import uses Alias in place of the name).

after(F) palette reads: in addition to inline `P[t.scheme].k` / `usePalette(P).k`, resolve
aliases declared as
  /const\s+(\w+)\s*=\s*(?:usePalette\((\w+)\)|(\w+)\[t\.scheme\])\s*;/g
and count P.light[k] for every `<alias>.k` (and `<alias>[…]` → `P[*]`) in F.

Normalise rgb()/rgba(): parse each channel and the alpha with Number(), re-emit as
`rgba(r,g,b,a)` with JS default number formatting (so 0.10 ≡ 0.1, 1 ≡ 1.0).

Exemptions: a rule-5 exempt literal (black shadowColor, neutral rgba(255,255,255,a) /
rgba(0,0,0,a) left as a literal) is counted on both sides. An exempt literal present in F but
absent from S is a new literal and is listed as a difference.
```

Also copy spec design line 654's palette read-form sentence into the task design's consumer
pattern, with the alias form added.

### 2. NIT — Rule 2a covers only `${theme.color.X}NN`, but the tree also suffixes other colour values

**Where:** rule 2a; Property 7's `/^#[0-9a-f]{6}$/` check, which covers `color.*` only.
Other suffix sites:

| Site | Expression |
| --- | --- |
| `screens/home/HomeFavoritesSection.tsx:135` | `parkColor + '18'` (a park accent) |
| `screens/catalog/ResortsDirectoryScreen.tsx:2262` | `` `${tierColor}18` `` |
| `screens/trips/TripExpensesScreen.tsx:945` | `catMeta.fg + '33'` |

If a dark park accent, category tint or palette value used this way were ever `rgb()` or
8-digit hex, the result would silently be an invalid colour.

**Fix:**

- Extend rule 2a to "`X + 'NN'` or `` `${X}NN` `` where X is any token, park accent, category
  tint/fill or palette value → keep the suffix verbatim on the converted X".
- Extend Property 7's 6-digit-hex assertion to `parkAccent.*`, `categoryVisual[*].tint/fill`
  and `resortVisual.tint/fill`.
- Add to rule 3: "a palette value that is suffixed with an alpha must be `#rrggbb` in both
  schemes". Property 14 can't detect suffix use, so state it as a conversion-rule constraint.

### 3. NIT — The category-fill prose miscounts and misattributes

**Where:** task design "Category fills".

- "8 of 11 rows clear the glyph floor" in light. The recomputed light white-on-fill column
  shows **9 of 11**: only Restaurant (2.02) and Parade (1.64) fail. The iteration-3 review
  carried the same miscount.
- "Dark fills reuse the `DARK_TONAL` fill of each hue family" isn't true for three rows:
  Game/Event `#8e24aa`, Other `#4a3a6b` (`borderStrong`) and Resort `#5b2a86`.

**Fix:** change the count to "9 of 11 … Restaurant and Parade are below 3.0". Reword the second
sentence to "Dark fills reuse the `DARK_TONAL` fill of each hue family, except Game/Event
(kept at light `#8e24aa`), Other (`borderStrong`) and Resort (`#5b2a86`)".

### 4. NIT — Criterion 7.5 says "against the background they sit on", but the PrimaryButton and Chip-active pairs are only computed against `surface`

**Where:** requirements 7.5; task design "Non-text graphics" table. Recomputed:

| Stop | vs `background` | vs tab bar `#170e27` | vs `surfaceAlt` |
| --- | --- | --- | --- |
| `#7e57c2` | 3.70 | 3.57 | **2.98** |
| `#7650b9` | 3.32 | 3.21 | **2.67** |

So a `PrimaryButton` (or active `Chip`, `primary` fill) placed on a `surfaceAlt` container
would miss 7.5's literal wording.

**Fix:**

- Add the `background` row (3.70 / 3.32) to the table and to `CONTRAST_REQUIREMENTS`.
- Add one sentence: "7.5's 'background they sit on' means `surface` or `background`. A
  `PrimaryButton` is not placed on `surfaceAlt`. The text label, not the fill boundary,
  identifies Chip-active and the button there (WCAG 1.4.11 exempts a component identified by
  its text)."
- Alternatively, if a batch finds a `PrimaryButton` on `surfaceAlt`, it reports it.

### 5. NIT — Task 7.6 still opens by naming the `.agents` file as the source

**Where:** spec `tasks.md` 7.6. The first sentence still says "every row of
`.agents/tasks/dark-mode-retrofit/design.md` 'Additional used dark pairs'". The iteration-3
note that follows redirects it to the spec. This is additive and correct, but a cold-start
executor reads the stale pointer first.

**Fix:** prefix the original sentence's pointer with "(superseded by the iteration-3 note
below)", leaving the sentence in place.

## Verified Assumptions

- **Contrast values.** Every iteration-3 contrast value reproduces (listed under (d)).
- **Category placeholder tiles.** The four sites paint `backgroundColor: visual.tint` today:
  `ExploreHubScreen.tsx:900`, `ExperienceDetailScreen.tsx:1177`, `DestinationScreen.tsx:1013`
  and `ParkDestinationScreen.tsx:1445`. A broader grep finds no other category-tint solid
  fills. `ExploreHubScreen.test.tsx` has `imageUrl: null` fixtures, so the placeholder renders.
- **Rule 1a sites.** `TripReservationsScreen.tsx:1062,1079` are `color: theme.color.surface`,
  and `:872` is `Badge color={theme.color.primaryLight}`. `MarkGottenUndoToast.tsx`'s toast
  is `backgroundColor: theme.color.textPrimary` with `textOnPrimary` text.
  `foodLists/__tests__/MarkGottenUndoToast.test.tsx` exists, so the iteration-3 review's
  "no test" claim was wrong, as the design notes.
- **Template alpha sites.** The rule 2a sites cited
  (`AttachedExperienceListsSection`, `TripDetailScreen`, `ResortPicker`,
  `GroupFavoritesSection`) all use `` `${theme.color.X}NN` ``.
- **Audit loader.** `esbuild@0.28.1` is installed at the repo root. `theme.ts` and
  `pinTierMeta.ts` import only `type`s from `@dwt/shared`, which esbuild erases, so the
  stated loader (bare imports → `{}`) can evaluate them.
- **Spec mirror.** Spec design mirrors the task design's gradients (`fab`, `chartBar`,
  `header` `['#7e57c2','#7650b9']`), `primaryLight` `#b28dff`, the category-fill table and
  the `DARK_TONAL` fill column.
- **Ownership.** All 12 W1-owned test files named in iteration 3 exist.

## Unverified / Wrong Assumptions

- **Wrong:** that the audit as written passes a correct conversion. It doesn't extract
  named-import reads, aliased palette records or numerically equal alphas (finding 1).
- **Wrong:** "8 of 11" light fills clear the glyph floor. It's 9 of 11 (NIT 3).
- **Unverified:** the Kiro IDE spec-format validator can't be invoked from this step. The
  equivalent structural checks above are clean.
- **Unverified:** the additivity baseline. `.kiro/specs/dark-mode/` is untracked in git, so
  additivity was judged by every original numbered item and checkbox state being present.
- **Unverified:** whether any `PrimaryButton` sits on a `surfaceAlt` container today (NIT 4).
  That needs a JSX-context read that no grep can do reliably.
