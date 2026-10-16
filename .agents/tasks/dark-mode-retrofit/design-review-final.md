# Design Review (final round, iteration 6): Dark-Mode Retrofit ("Twilight")

Reviewed:

- `.agents/tasks/dark-mode-retrofit/design.md`, revised after iteration 5
- `.kiro/specs/dark-mode/{requirements,design,tasks}.md`

All checks were read-only stdin `node -` scripts plus source greps against `apps/mobile/src`:

- whitespace-normalised comparison of the two audit blocks;
- a simulation of the amended `after(F)` regexes on realistic converted lines;
- the spec structure and additivity checks.

No build or test suite was run, because no source was edited. The only files written are
this review and its JSON.

**Verdict: APPROVED** (0 HIGH, 0 MEDIUM, 1 NIT)

The iteration-5 MEDIUM is resolved in both documents. Nothing was deleted or renumbered. The
one remaining NIT is the iteration-5 wording NIT on 7.5, which was deliberately backlogged. It
doesn't block.

## Prior-round findings: resolution check

Iteration 5 raised 2 findings (the brief's "5 findings" refers to iteration 4; all five were
confirmed resolved last round and are still present, as shown in the second table).

| # | Finding | Task design | Spec | Result |
| --- | --- | --- | --- | --- |
| 5.1 (MEDIUM) | `after(F)` double-counts the `t.<path>` inside a numeric `withAlpha` | DoD item 2, `after(F)` bullet 3 (lines 1356–1365) now has the explicit regex and removes matched spans before the `t.<GROUPS>` read regex. The non-numeric-alpha fallback is stated. A fixture is in the audit notes (lines 1394–1397). | Spec design audit block (lines 1061–1070) and fixture (lines 1098–1101). Task 9 Done-when iteration-5 bullet (tasks.md line 139). tasks.md Notes iteration-5 entry. | **Resolved.** Both audit blocks are identical after whitespace normalisation (4562 = 4562 chars, `===` true). |
| 5.2 (NIT) | The 7.5 scope sentence is broader than intended | Backlogged, with the recommended wording recorded in the iteration-5 responses | Backlogged, and the spec's iteration-5 responses say so | **Not changed.** Carried forward as NIT 1 below. Not blocking. |

Simulation of the amended `after(F)`, using the exact regexes from the block:

| Input F | `withAlpha` entries | Ordinary `t.` reads |
| --- | --- | --- |
| `bg: withAlpha(t.color.primary, 0.10), c: t.color.primary` | `color.primary@0.1` | `color.primary` (the second, genuine read only) |
| `withAlpha(t.color.surface,.5)` (rule-5 veil) | `color.surface@0.5` | none (no extra `#ffffff`) |
| `withAlpha(t.color.primary, alpha)` | none | `color.primary` (fallback, as specified) |
| `withAlpha( t.color.primary , 1 )` | `color.primary@1` | none |
| `withAlpha(t.parkAccent[p], 0.2)` | none | none, so the computed-index rule records it as `parkAccent[*]`, matching a before-side `${theme.parkAccent[p]}NN` |

`withAlpha`'s pinned output format, `rgba(${r}, ${g}, ${b}, ${alpha})` (task design lines
183–192), goes through the block's `Number()` normalisation. So the fixture
`withAlpha(t.color.primary, 0.10)` → `rgba(91,42,134,0.1)` holds against `#5b2a86`.

Iteration-4 items are still present in both documents:

- rule 2a's real sites;
- "9 of 11";
- the "Scope of criterion 7.5" paragraph;
- the Property 7 `#rrggbb` extension;
- the task 7.6 "(superseded …)" pointer.

## Additivity check

- **Requirements:** 1–12 are present, with 54 criteria. There are 66 ids in total, the same as
  iterations 4 and 5.
- **References:** there are 64 `_Requirements:_` / `**Validates:**` lines carrying 254 numeric
  references, and 0 are unresolved. Iteration 5 also had 254.
- **Properties:** 1–22 are contiguous.
- **Checkboxes:** there are 60, 29 `[x]` and 31 `[ ]`, with 0 malformed. This is unchanged, so
  no checkbox state moved.
- **`tasks.md` headings:** it starts with `# Implementation Plan`, and `## Tasks`, `## Notes`
  and `## Task Dependency Graph` are all present.
- **Dependency graph:** every sub-task id is in the graph, and the graph has no extra ids.

## Findings

### 1. NIT: The 7.5 scope sentence still redefines "background" for every 7.5 element (carried from iteration 5, backlogged)

**Where:**

- requirements.md 7.5 amendment
- the "Scope of criterion 7.5 (iteration 4)" paragraph in the task design (line 1714) and the
  spec design (line 2034)

Read literally, the sentence excludes the `ProgressBar`'s `surfaceAlt` track. The design
already enforces the stronger `primaryFg`/`primaryLight` vs `surfaceAlt` pairs (7.41 / 6.02),
so nothing breaks.

**Fix:** apply the wording already recorded in the iteration-5 responses, in all three places:

> For the primary button gradient and the active `Chip` fill, "the background they sit on"
> means `surface` or `background`. Chart marks and progress fills are measured against the
> element they are drawn on (the card, or the `surfaceAlt` track).

## Verified Assumptions

- **Audit block parity.** The task-design and spec-design audit blocks are character-identical
  after whitespace normalisation, including the iteration-5 `withAlpha` bullet.
- **Span removal.** Removing the `withAlpha` span before the read regex gives exactly one
  entry per numeric call. A genuine sibling `t.color.primary` read is still counted.
  Non-numeric alphas fall back to an ordinary read, as specified.
- **Computed-index reads inside `withAlpha`.** These (e.g. `t.parkAccent[p]`) aren't matched by
  the `withAlpha` regex. They're recorded symbolically as `parkAccent[*]`, which pairs with
  the before-side rule-2a template read. No new false difference results.
- **`withAlpha` output format.** It is pinned to the `hexToRgba` format, and the audit
  normalises it numerically, so the fixture value is consistent.
- **Task 9 and Notes.** Task 9's Done-when and the tasks.md Notes carry the iteration-5
  amendment, stated as additive with no checkbox change. That matches the counts above.

## Unverified / Wrong Assumptions

- **Unverified:** the Kiro spec-format validator can't be invoked from this step. The
  equivalent structural checks above are clean.
- **Unverified:** the additivity baseline. `.kiro/specs/dark-mode/` is untracked, so
  additivity was judged by id, reference, property and checkbox counts matching iterations
  4 and 5.
- **Unverified:** the esbuild loader against the post-7.2 `theme.ts` and the palette files.
  Those files don't exist yet. `withAlpha` exists only as a design signature: there is no
  `withAlpha` in `apps/mobile/src` today, as the design states.
- **Wrong:** none found this round.
