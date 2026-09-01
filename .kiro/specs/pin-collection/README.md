# Pin Collection — handover

**Read this before touching anything in this folder.** It exists because the answer to
"could someone else pick this up and continue the same way?" was *no* until it was written:
the entire quality gate was sitting in `%TEMP%`, unreferenced by the repo, one cleanup away
from gone.

Status: **the release catalogue exists and is under review; its provenance is unfinished.**
`requirements.md`, `design.md` and `tasks.md` are written. `pin-catalog-mockup.html` holds all
167 version-1 pins. The gate is deliberately RED on three suites — see §2 — and those failures
are the to-do list, not noise.

Nothing in this folder is committed yet. Until it is, all of it exists on one machine.

---

## 0 · How a fresh session finds this file

It doesn't, on its own. `.kiro/specs/` is **not** auto-loaded — it is read when someone opens
a spec or asks for it. Only `.kiro/steering/*.md` loads automatically: Kiro reads it natively,
and the root `AGENTS.md` orders every other agent to read every file in that folder as its
first tool calls, including files added later.

So the discoverability hook is **`.kiro/steering/pin-collection.md`** — a short always-on
pointer that names this README, gives the gate commands, and carries the four traps most
likely to bite. It is deliberately a pointer and not a copy, so the two cannot drift, and it
is deliberately short because always-on text is charged against every unrelated task in the
repo.

`verify/all.js` asserts that pointer exists, has no front matter (front matter would make it
conditional and it would stop loading), still names this README, still gives both commands,
and stays under 4.5KB. If someone deletes it, the gate fails.

**This only works for tools that honour `AGENTS.md` or read Kiro steering natively.** A model
pointed at the repo with no such convention will not find any of it, and the only fix for that
is to paste this file at it.

## 1 · What's here

| Path | What it is |
|---|---|
| `pin-frame-sample.html` | The working artefact. One parametric SVG renderer plus every decision, rejection and correction, each with live checks. Open it in a browser. |
| `pin-catalog-mockup.html` | The **release catalogue**: every pin planned for version 1, with tier, category, criteria and art. Filterable by tier and category. This is the file to review when checking the pins themselves. |
| `pins-mockup.html` | The **older** first-pass mockup. Superseded; kept for history. Don't extend it. |
| `motifs/*.svg` | Licensed motif art, CC BY 3.0 from game-icons.net. |
| `motifs/motif-paths.js` | **Generated** from those SVGs. Do not hand-edit — see §5. |
| `motifs/CREDITS.md` | Provenance and the attribution obligation. A motif without a row here must not ship. |
| `verify/` | Nine verifier suites, a runner, two "does it bite?" harnesses, and `trace.js` for finding a motif's source. This is the quality gate. |

## 2 · How to run the gate

```
node .kiro/specs/pin-collection/verify/run-all.js
```

Run it after **every** change to the mockup, and paste the tail when reporting work, per
`.kiro/steering/execution-discipline.md`. **Takes about 35 seconds.**

**It is RED right now, deliberately.** `provenance.js` and `dedup.js` fail because there
is real unfinished work: 70 of the 88 motifs the catalogue renders have no row in the
CREDITS provenance table, 43 have no source file at all, and `toriiGate` holds
`delapouite/pagoda.svg`'s path so two World Showcase pins render the same pagoda. Those
failures are the to-do list. Do not silence them.

Six suites target `pin-frame-sample.html`. Three target the release catalogue:
`dedup.js` guards artwork reuse, `catalog.js` guards structural invariants, and
`provenance.js` guards "no row, no ship".

```
node .kiro/specs/pin-collection/verify/bite.js
```

Asks whether the **catalogue** assertions actually fire, the way `selftest.js` does for
`all.js`. It cannot use selftest's approach: selftest tampers files in place and demands a
green baseline first, and the catalogue suites are legitimately red. So `bite.js` tampers a
**copy** and asserts a token that is present when tampered and absent from the clean run's
*failures*. That differential is what keeps it meaningful while other assertions in the
same suite fail. Run it whenever you add or change a catalogue assertion — it has already
caught two assertions of mine that did not bite, and seven of its own cases that were
vacuous because the token also appeared on a passing line. Three things the catalogue suites exist to remember, each learned the hard way:

- **The catalogue does not render from `motif-paths.js`.** It builds
  `MOTIFS = Object.assign({}, window.MOTIF_LIB, { ...129 inline keys... })`, so an inline
  entry silently shadows the licensed file. `all.js` byte-asserts `director-chair.svg` and
  `film-projector.svg` while the catalogue draws different inline paths, and `toriiGate`
  held the pagoda's path outright. 125 of the 129 inline keys are byte-identical copies of
  the library — pure shadowing hazard, no benefit. Any check on motif art must resolve
  through the same `Object.assign` the page uses.
- **Compare artwork, not keys, and not strings.** `dedup.js` reported "100% unique motifs"
  for a year of edits because it grouped by motif key. Byte comparison is not enough either:
  the same art reserialised (`m`/`l` versus `M` plus implicit repeats) produces different
  bytes, so the comparison is on normalised geometry.
- **Short enamel arrays are fine; long ones are not.** `renderDieCut` fills cell *i* with
  `enamel[i % enamel.length]`, so colours cycle by design — asserting "enough colours" would
  measure the wrong thing. Entries *beyond* the cell count never render, and that is worth
  failing on: seven pins declare 4–7 colours over single-cell art, so they render as one
  flat colour.

`catalog.js` deliberately asserts **no pin counts** — a typed count is a
derived value (rule 5) that fails the moment a pin is added, which only teaches people to
edit the number until the gate goes quiet. It asserts relationships that hold at any
catalogue size: id prefix agrees with the `tier` field, every pin sits under the section
header naming its tier, no sub-group comment names another tier, no hardcoded count
survives anywhere in the file, ids and names are unique, every motif and scene key
resolves to non-empty path data, and the Centurion ladder's thresholds rise with tier.
It also runs the page against a stub DOM and reads the counts back **on load with no
click simulated** — because `updateTabCounts` used to be declared inside the tier-pill
click handler, so the header showed a stale hardcoded `163` until you clicked a pill, and
text-matching that bug passes whether the function is nested or not.

It used to take 4.7 minutes, and the mockup alone took 2.8 minutes to open. The cause was the
inner loop: every raster sampled 40,000 points and each point walked *every* polygon segment,
so a single `silhouetteMetrics` call cost 936ms. `polyIndex` buckets segments into horizontal
rows so a query only visits segments that reach that height, and flattens them into a
`Float64Array` to stop allocating a pair of arrays per segment. Same arithmetic, ~12× faster.

`verify/equiv.js` runs first in the runner and exists to keep that honest — it compares the
indexed path against the original brute-force path over 96,000 point checks on real shapes,
including points beyond the canvas. `insideNonZero`, `insideEvenOdd` and `distToEdges` are
kept in the mockup **only** as the reference for that comparison; nothing else calls them.
If a future change makes them disagree, everything else the suites measure is suspect.

```
node .kiro/specs/pin-collection/verify/screen.js 5.2 baobab treeRoots oak
```

Screens candidate motifs through `emblemGate` **before** you design around them. Pass the rim
of the tier the pin will actually use — rim width changes the answer. With no keys it screens
everything in `motif-paths.js`. Use this whenever you're choosing art; it is much cheaper than
discovering later that an icon is five separate pieces.

```
node .kiro/specs/pin-collection/verify/selftest.js
```

Asks the harder question: **would the gate have failed?** It breaks things on purpose —
stale counts in this file, a missing gaps section — and requires the suite to notice. Run it
when you add or change an assertion, not on every edit; it costs a full suite run per case,
so several minutes. It restores every file in a `finally` block, so an interrupted run cannot
leave a tampered file behind. This exists because more than one assertion in this project
turned out to be checking something *adjacent* to the claim and passing regardless.

These are **mockup verifiers, not app tests.** They validate geometry, contrast and the
mockup's internal consistency. The app's real suites are Vitest (`apps/api`,
`packages/shared`) and Jest (`apps/mobile`). Nothing in `verify/` belongs in those, and
`npm run verify` does **not** cover this folder — it sits outside every tsconfig and test
glob. Say so plainly rather than implying the root gate covered it.

`all.js` keys some assertions to **literal strings on the page** (decision row names, open
question text, section ids). Rewording a decision or renaming an id will fail the suite.
That is deliberate: it is what stops the page drifting from the code.

## 3 · Where the project actually stands

Everything below is generated live in the mockup's section 00, checked against the
constants, so the page is the source of truth and this is a summary.

- **33 decisions** recorded, each with a `check()` that runs against the real constants.
  A row that disagrees with the code renders `MISMATCH`.
- **12 routes closed** with reasons, in "Tried and ruled out". Don't reopen one by accident.
- **5 questions open**, all appearance calls. None can be settled by measurement.
- **31 corrections logged** — my own retracted claims. Worth reading before trusting any
  judgement in here; the pattern is consistent and instructive.
- **51 park-emblem candidates** screened, plus 17 put through welding.

Those five numbers are asserted against the live arrays by `verify/all.js`, so this section
cannot quietly drift out of date. If you change an array, the gate will tell you to update
this file.

Decided and locked: 6 tiers bronze→prismatic · Royal palette (plus a luminous set for the
firework ladder only) · hybrid contained/die-cut decided by **meaning** · shape is *not*
category · castle = Magic Kingdom · fireworks for the completion ladder, composition **B4**,
contained · park emblems for all four parks.

## 4 · The working rules

These are not style preferences. Each one is here because ignoring it produced a defect that
a passing check had already called fine.

1. **I cannot see renders.** Never assert how something looks. Ask, or build both and let the
   user choose. Every appearance claim made without being shown has been wrong, and the
   corrections log is mostly this one mistake.
2. **Measure the claim, not a proxy.** The recurring failure. Examples: checked arc *flags*
   instead of the resulting circle centre (220 units off); checked `enamelShare` — how much
   colour survives — when the claim was about *where* it survives; checked that the pin set
   contained *some* die-cut pins while three violated the rule; checked distinct hex values
   while bronze and gold looked identical. Before writing an assertion, ask what would still
   pass if the thing were broken.
3. **A lookup key that can go stale silently will go stale.** Demos keyed by array index slid
   onto the wrong questions when two were inserted; demos keyed by display name vanished when
   a row was renamed. Neither errored. Key by stable text, surface orphans, assert the count.
4. **Generated geometry over typed coordinates.** Every geometry defect here came from typed
   numbers; the parametric generators have been reliable. If you must type coordinates, derive
   every dependent value and assert it.
5. **Never type a derived value.** `top`, extents, coverage — all derived from the geometry and
   asserted. Hand-typed `top` values were wrong every time.
6. **Winding discipline.** Every solid subpath winds the same way; only hole-cutters run
   opposite. Shapes relying on cancellation are marked `noSplit`.
7. **Never draw a circle with one near-360 arc** — the sweep flag then picks between two
   centres. Use two half-arcs (`circlePath`).
8. **Bounding box is the wrong size measure for radial shapes.** It depends on whether a ray
   points along an axis. Three phantom "the ladder shrank" bugs came from this. Use
   `radialSpan`.
9. **Overlap is not fusion.** `renderDieCut` strokes the rim along *every* subpath, so
   overlapping pieces each get their own full metal ring. For one silhouette, one rim, use
   `unionOutline`.
10. **Screen die-cut motifs with `emblemGate`, at the rim of the tier they will actually use.**
    Rim width changes the answer: narrow rims leave more enamel but weld less, so parts
    separate; wide rims weld everything but eat the colour.
11. **Verify external assets before relying on them.** Some library icons are circular
    *medallions*, so their die-cut silhouette is a plain disc — that is what made Magic
    Kingdom render as a gold coin. `discLikeness > 0.9` rejects them.
12. **Check the library before inventing art.** "Nothing in the library matches" was a
    statement about a 15-file download folder; game-icons has 4239 icons.

## 4b · Tracing a motif to its source

```
node .kiro/specs/pin-collection/verify/trace.js <motifKey> <search terms...>
node .kiro/specs/pin-collection/verify/trace.js coasterLoop roller coaster
```

Needed because motifs arrived here over time without their provenance recorded, and
`CREDITS.md` is the CC BY audit trail — no row, no ship. `trace.js` scores our motif against
every same-subject icon in the downloaded corpora by **filled-area overlap** after
normalising both into the same box, so the comparison is invariant to scale and position.

**Five rules, each of which cost a wrong answer.** Every one of these produced a confident
false negative that contradicted the user, who turned out to be right three times out of four.

1. **Always compare the UNION of a source icon's paths, not each path alone.** A two-path
   source — a coaster track plus its car — cannot match one combined motif. `coasterLoop`
   scored **0.246** against the Temaki icon it matches at **0.998** once unioned. This
   silently invalidated the negative result for every multi-path icon in the corpus.
2. **Never prefilter candidates by vertex count.** Reserialising the same curve changes the
   count by far more than any sane window. A 30% window excluded the true Temaki match on a
   re-run, so the same motif came back "unresolved" a second time.
3. **Search by the SUBJECT's name, not by our key.** Candidate filenames derived from our own
   key meant `steamTrain` never tried `steam-locomotive`, and `skyliner` never tried
   `cable-car` or `gondola`. `trace.js` takes the search terms as arguments for this reason.
4. **Overlap is meaningless below roughly 130 path numbers.** Any two rounded blocks score
   0.94+. An earlier sweep of mine "confidently" matched `autographBook` to an oven at 0.983
   and `vintageSuitcase` to a garage at 0.947. Check the vertex count before believing a score.
5. **Overlap is blind to welding.** A welded variant scores **1.000** against its original,
   because sealing the gaps does not change the nonzero-filled union. So 1.000 proves "this is
   that artwork" — which is what provenance needs — and never proves "unmodified".

**Ask the human before searching.** Naming a suspected source and verifying it with `trace.js`
resolved `steamTrain`, `coasterLoop` and the magic-wand family in seconds. Exhaustive sweeps
over 173,532 shapes across 19 libraries found none of them. Recall beats brute force here.

**Absolute-coordinate comparison finds nothing that was rescaled.** An icon lifted from a
15- or 24-unit grid and scaled to the 512 canvas becomes round integers, so "integer-only
coordinates" is *not* evidence of hand-authoring — it is equally consistent with borrowed art.
Nine motifs were resolved only after switching to scale-invariant comparison.

**Record derived art as derived.** Where our version is a union, a rescale or a weld rather
than the pristine file, store it as `<name>.path` beside the upstream `<name>.svg` and say so
in the CREDITS row. `coaster-loop.path` / `roller-coaster.svg` is the worked example. A row
that implies we ship the untouched original when we do not is the failure mode to avoid.

**Licences differ in what they demand.** game-icons is CC BY 3.0 and needs attribution;
Temaki and Maki are CC0 and need none; Tabler, Lucide and Font Awesome are MIT and need their
notice retained. `provenance.js` only requires the in-app credits block to cover licences that
actually oblige us — demanding it name CC0 would be inventing an obligation.

> **The corpora are not in the repo.** `trace.js` reads them from `$TEMP` and prints the
> download URLs if they are missing. This is the same fragility that put the whole gate in
> `%TEMP%` once before. If provenance work resumes, re-download them; do not assume they survived.

## 5 · Adding a motif

1. Download the SVG into `motifs/`. game-icons raw URL:
   `https://raw.githubusercontent.com/game-icons/icons/master/<author>/<name>.svg`
2. Regenerate `motifs/motif-paths.js`. Each value is the **second** `<path>` of the file —
   game-icons SVGs carry a full-canvas background rect as `path[0]`, and including it turns
   the die-cut silhouette into a square. The verifier asserts every entry still matches
   `path[1]` of its source byte for byte, so the file cannot drift from the licensed asset.
3. Add a row to `motifs/CREDITS.md`. No row, no ship.
4. Run it through `emblemGate` at its intended tier's rim before designing around it.
5. Run the gate.

## 6 · What to do next

**The challenge list, and nothing before it.** The contained/die-cut rule is *semantic* — it
turns on what an achievement means — so no further art can be assigned without it, and neither
can the schema, the award rules or the board screen.

The concrete task: walk the services that already exist — experiences and ratings, park and
land coverage, trips, friends and the sharing loop, the crowd calendar, the planner — and list
what each already knows how to count or reach a milestone on. That produces the candidate
challenges; each then needs a tier, a threshold, and an object-or-abstract call. Reuse those
services rather than recomputing, per `.kiro/steering/tech-conventions.md`.

Then: `requirements.md` (EARS), `design.md` (carrying every locked number, the correctness
properties, the error handling), schema + migration, award rules, the Pin Board screen.

## 7 · Known gaps, stated plainly

- **Nothing here is committed** except the superseded `pins-mockup.html`. Until it is, this
  work exists only on one machine.
- The eight sample pins in the mockup **predate** the contained/die-cut rule and the ladder
  decision. The compliance audit is honest about it, but the sample set is behind the
  decisions. Not worth fixing until the challenge list says which pins exist.
- Whether the art is *good* is unverified and unverifiable by the gate. It proves the pins are
  valid, not that anyone will want to collect them. The five open questions are all this.
- **The catalogue's provenance is unfinished**, and `provenance.js` fails until it is done.
  Of the 88 motifs a pin renders: 18 have a row in the CREDITS provenance table, 45 have a
  source file, and 47 have an origin proven against game-icons by geometry — 43 of those
  byte-identical to upstream, so saving the file and writing the row is mechanical. The
  remaining 41 are not in game-icons; 13 of them have a local file and are deliberately
  welded, and 28 are unexplained. Several of the 28 carry coordinates beyond the 512 canvas,
  so they are not raw game-icons paths — `motif-paths.js` names four other libraries
  (Temaki CC0, Iconify, Tabler MIT, Lucide MIT) whose obligations differ from CC BY, and the
  in-app credits row currently promises only the game-icons line.
- Two motif keys mislead about what they draw: `riverboatCruise` is `lorc/galleon.svg` and
  `compassRose` is `lorc/compass.svg`, the same art as the existing `compass` key.
- `magicLantern` is drawn on a 24-unit grid rather than 512. Its one pin is die-cut, and
  `renderDieCut` box-fits, so it survives; `catalog.js` asserts no *contained* pin can use
  it, because `renderPin` uses a fixed scale and it would land about 4px wide.
- `react-native-svg` filter support is untested; the cast and inner shadows may not survive on
  device. Pre-rendering PNGs is the likely answer and is still an open question.
