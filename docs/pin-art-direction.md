# Pin Art Direction — the standing contract

**Read this before creating or changing any collectible pin.** It applies whenever pins are
added or edited, not just while the `pin-collection` spec is open. A spec describes building a
feature once; these are the rules the next pin has to obey regardless of which spec is live.

Where the other pieces live:

| | |
|---|---|
| **This file** | the rules. Standing, versioned, outlives any spec. |
| `.kiro/specs/pin-collection/pin-catalog-mockup.html` | the **master catalogue** — every released pin, filterable by tier and category. Open it to see what exists before adding anything. |
| `.kiro/specs/pin-collection/pin-frame-sample.html` | the working renderer plus the live decision ledger (33 decisions, 12 closed routes, 5 open questions), each with a `check()` against the real constants. |
| `.kiro/specs/pin-collection/verify/` | the gate. `run-all.js` must exit 0. |
| `.kiro/specs/pin-collection/motifs/CREDITS.md` | provenance and the attribution obligation. |

Every number in this file is a constant in the renderer, and the ledger's `check()` functions
assert them against the code. If a value here disagrees with the code, the code wins and this
file is stale — say so rather than editing the code to match.

---

## 1 · The decision that governs everything else: die-cut or contained

This is the first call to make, and it is **semantic**. No measurement makes it for you, and no
verifier can catch getting it wrong.

> **Hybrid, decided by meaning:** an achievement with a recognisable, readable-silhouette
> **object** is die-cut; anything **abstract** — a rating count, a leaderboard place — takes a
> contained plate.

Die-cut is the **default** for anything with a readable object silhouette. Contained plates are
for genuinely abstract achievements, and for series that need a shared frame.

It is *not* decided by cost. All four cost and risk objections raised against die-cut collapsed
under measurement.

**The one declared exception: the experience ladder stays contained.** Not for either of the two
reasons originally given. A firework is thin radial lines over a sky, and a die-cut rim destroys
the lines while removing the sky — measured, at 16 rays only about **2%** of the ray area still
holds enamel. A ladder rung is therefore contained even though a firework is an object.

If you add another exception, record the measured reason with it. "It looks better" is not a
reason anyone can check.

---

## 2 · Tiers and metal

Six tiers, each a different substance, luminance climbing to the top:

```
bronze → silver → gold → amethyst → pearl → prismatic
```

Four is flat; seven or more are not distinguishable at the 88px grid size.

**Die-cut rim grows with tier** — this is `RIM_BY_TIER`:

| bronze | silver | gold | amethyst | pearl | prism |
|---|---|---|---|---|---|
| 4.2px | 5.2px | 6.2px | 7.2px | 8.2px | 9.2px |

Rim width changes which motifs work, so screening (§5) must use the rim of the tier the pin will
actually ship at.

Two metal ramps carry deliberate constraints you must not "simplify":

- **Bronze** is darker and redder than the obvious choice. The earlier mid tone sat 18° from
  gold's hue at a luminance ratio of only 1.55 with near-identical saturation, so bronze pins
  read as gold. The ramp keeps the hue family but drops the mid tone's luminance so the two
  separate on lightness.
- **Pearl's lightest stop is deliberately not `#ffffff`.** Sharing a top stop with silver made
  the two tiers ambiguous at the highlight.

**Animation:** pearl (5.5s glow) and prismatic (2.4s sweep) only, and it honours
`prefers-reduced-motion`.

---

## 3 · Enamel and colour

The palette is **Royal**, 8 enamels plus 3 sky gradients:

```
royal #4a2a7a   plum #6a3fb0   teal  #14727f   forest  #2f7d3e
crimson #a8323f amber #b5721a  sky   #2f6bb0   ink     #241a3a
```

Skies: `day` `#8fc4f0→#dfeaf7` · `dusk` `#3f2f78→#c47a8e` · `night` `#1b1a4a→#4b3f8f`

**One declared exception, for the firework ladder only:** six luminous colours plus a spark
cream. Not a style preference — every one of the eight Royal colours falls under the 3:1
contrast floor on a night sky, royal worst at 1.01:1. The alternative was fireworks in daylight.

**Colour separation rules, both hard:**

- A metal motif on enamel needs **≥40° hue separation or ≥3.5:1 contrast**.
- **No two tiers may share hue *and* lightness *and* saturation.**

**Motif against sky is a checked pairing, not a mood choice.** Ladder rungs use `night` on every
rung: every bright burst colour clears 3:1 on night and **fails** on dusk, whose pale pink
horizon sits at luminance 0.26 and would need a near-white burst. Day was worse — silver on day
measured 1.01:1.

**Multi-colour enamel is one colour per cell**, poured the way a real cloisonné pin is. Two
consequences that have each caused a defect:

- `renderDieCut` fills cell *i* with `enamel[i % enamel.length]`, so a **short array cycles by
  design**. That is fine. An array **longer** than the cell count is a defect — the tail never
  renders, and it usually means the author was colouring a different cell count than the art
  has. A `noSplit` motif has exactly one cell, so only `enamel[0]` is ever used.
- In contained mode the motif takes enamel per cell via **`motifEnamel`**. Filling it with the
  tier metal gradient makes the motif the plate colour — redundant, and invisible at the rare
  end.

**Interior detail gets a thin divider**, `0.32×` the outer rim, so its enamel survives. Without
it the rim paints over interior features.

---

## 4 · Shape is not a category code

Retired as a signal. It only cohered while every pin was a contained plate; a die-cut pin has no
plate to carry the code. **Category comes from board grouping** — section headers.

The plates survive as presentation options chosen for **fit**, not as a code. A contained pin
must declare a `shape`; the renderer reads it directly.

The **arch as a window** is the scene treatment: sky in the well, motif standing on the ground
line rather than floating centred.

---

## 5 · Where motifs come from, and screening them

**Preferred: an existing library icon.** No new geometry means none of the hand-authoring
defects are possible. Fallback: draw in a vector editor. **Rejected outright:** hand-computed
coordinates — the source of nearly every geometry defect in this project — and composing
silhouettes from rectangle/triangle primitives, which only ever produces fortress-like shapes.

**Check the library before concluding nothing fits.** "Nothing in the library matches" was once
a statement about a 15-file download folder. game-icons alone has 4,239 icons.

### Licence obligations differ by source

| Source | Licence | What it obliges |
|---|---|---|
| game-icons.net | CC BY 3.0 | **Attribution.** An *Art credits* row in Profile is the whole obligation. |
| Temaki, Maki | CC0 1.0 | Nothing. Record provenance anyway. |
| Tabler, Lucide, Font Awesome Free | MIT | Retain the notice. |

Scene silhouettes and the frame system are original work; the three non-castle park emblems are
original geometry, so no attribution attaches to them. The castle motif is licensed and does
carry the obligation.

**No row in `CREDITS.md`, no ship.** `verify/provenance.js` enforces it. Where our version is a
weld, a rescale, or a union of several source paths rather than the pristine file, store it as
`<name>.path` beside the upstream `<name>.svg` and say *derived* in the row. A row that implies
we ship the untouched original when we do not is the failure to avoid.

### A die-cut pin is one solid piece of metal with enamel inside it

A real cloisonné pin has no floating parts and no see-through gaps. Everything inside the
silhouette is either metal or an enamel well bounded by metal. So:

- **Line-art and outline-style icons cannot be used as-is.** A gauge drawn as a thin arc, a
  stroked circle, a wireframe — the area "inside" the shape is not enamel, it is *background*.
  On a pin that reads as a bare metal ring floating in space with a needle beside it, which is
  the tell that the icon was never screened.
- **The fix is welding:** enclose the shape in a single closed outline so the sealed gaps become
  enamel. `unionOutline` exists for this. Welding rescued 16 of 17 otherwise-rejected icons.
- **Interior voids are fine when they are enamel wells.** The castle is 41% interior void and so
  is `holy-oak`; both are correct, because the void sits *inside* a closed body and gets poured.
  The distinction is enclosed-and-poured versus open-to-the-background.
- If an icon cannot be welded into one body, **replace it**. Assembled objects — anything with
  legs, arms, a stand or separate hardware — systematically fail this and are the wrong subject
  for a pin. Prefer solid masses: trees, animals, spheres.

### Fabricate, don't gatekeep

**An icon is not a pin, and turning one into the other is the job.** `emblemGate` is a
diagnostic, not a bouncer. When asked to make a pin from a given icon, do not come back with
"that icon fails screening" — work the ladder below and report what you did to it. Anyone can
download an icon; the value added is the fabrication.

Apply in order, stopping at the first that passes:

1. **As-is.** Screen at the pin's own tier rim. If it passes, ship it.
2. **Weld** — `unionOutline` at that rim. Fuses parts that are close enough to touch into one
   silhouette, so the sealed gaps become enamel. This is the single highest-yield step.
3. **Scale up inside the die.** A wider rim eats a fixed amount of the art, so growing the motif
   raises `enamelShare` without touching the rim, which must stay tied to the tier. Try 1.15×,
   1.3×, 1.5×, 1.75×, 2×. Use the smallest that clears the 0.30 floor.
4. **Declared exception**, where the failure is `medallion` and the circle genuinely *is* the
   object — a globe, a clock face. Set `allowRound` and record the reason on the emblem.
5. **Contained plate.** The guaranteed fallback. A plate has no rim eating the art, so anything
   renders. This is **not** a failure state and it does not contradict §1: die-cut requires a
   *readable one-piece silhouette*, so art that cannot hold one has not met the condition and a
   plate is the correct call. It is the same reasoning that keeps the firework ladder contained.

Only reject a motif when the **subject** is wrong for the achievement, or when it is unlicensed
and unidentifiable. "It fails `emblemGate`" is not grounds for rejection on its own.

Measured across the 99 die-cut pins in the catalogue at their own tier rims: **46 pass as-is, 24
are fixed by welding alone, 4 by scaling, 3 by weld-then-scale, and 22 need a plate** — several of
those 22 being globes that want a declared exception rather than a plate. So roughly four in five
fabricate with no judgement call at all, which is the work an AI should be doing here unprompted.

**Diagnose before reaching for `unionOutline`** — for two of the three failure modes it achieves
nothing. Sweep the rim with `componentCount(d, rimPx, rule)` to tell them apart: if a wider rim
fuses the parts, they were close enough to weld.

| Diagnosis | What it looks like | Remedy |
|---|---|---|
| **Weldable** — multi-piece at its own rim, one piece at a wider rim | parts nearly touch | `unionOutline`. One silhouette, one rim, sealed gaps become enamel. A flag, not a redraw. Measured examples: `rocket` (2 pieces at gold 6.2px, fuses at 12px), `speedometer` (2 pieces at silver 5.2px). |
| **Detached** — still multi-piece at 3× rim | floating droplets, sparks, orbiting bits | No union can reach them. Delete the free-floating parts, or replace the icon. Measured example: `waterSplash` — 4 pieces at silver, still 2 at 3× rim. |
| **Starved** — already one piece, `enamelShare` under 0.30 | solid metal, barely any colour | Welding changes **nothing**; the body is already connected. Use the motif at a lower tier where the rim is narrower, scale it up inside the die, or replace it. Measured examples: `hourglass` 0.285 at amethyst 7.2px, `highFive` 0.233 at pearl 8.2px. |

Note the two tests are independent: `rocket` passes on enamel (0.312) and fails on pieces, while
`hourglass` passes on pieces and fails on enamel. Read both before choosing a fix.

A caution on "one piece": `componentCount` measures whether the **metal** is connected. It does
not mean the shape reads as solid — a frame can be one connected body while its interior is
mostly background. Interior subpaths *do* get enamel, because `renderDieCut` fills every cell;
what shows the board through is area covered by no subpath at all.

**There is no separate metric for this, and one was tried.** Convex-hull solidity looked like the
obvious measure and does not discriminate at all: across the catalogue, suspected line-art shapes
average 0.555 and known-good solid bodies average 0.554, with `holy-oak` scoring *below* the
speedometer. Enclosed-void share is no better — `castle` reads 41% and the speedometer 0%. Do not
add either; `emblemGate` already covers this through **pieces** and **enamelShare**, which is why
the speedometer fails it twice (2 pieces, enamel 0.270 against the 0.30 floor).

### Screening is enforced — `verify/diecut.js`

Every **new** die-cut pin must pass `emblemGate` at its own tier's rim. The suite screens the
path the catalogue actually renders, so it applies identically to a licensed library icon and to
an **SVG an AI drew from scratch** — the test knows nothing about provenance, only geometry. That
matters, because AI-authored art is the case most likely to arrive as line work with floating
parts.

Set `allowRound: true` on a pin to claim the medallion exception; the suite honours it. Record the
reason.

**The 53 pre-existing failures are grandfathered, not fixed.** Fixing them changes how about 31
pins look and nobody in this loop can see the renders, so they are recorded in `GRANDFATHERED` in
that suite with their failure reason and the remedy the ladder found. The list is built to only
shrink:

- a new die-cut pin that fails and is **not** listed fails the suite;
- a listed pin that now **passes** also fails the suite, telling you to delete its entry;
- so does switching one to a contained plate while leaving its entry behind, or leaving an entry
  for a deleted pin.

A plain allowlist rots into a permanent dumping ground. Asserting each entry is still *needed*
makes it self-cleaning. **Do not add a new pin to that list to make the gate quiet** — work the
ladder above instead. The remaining work queue is weld 24 · plate 22 · scale 4 · weld+scale 3.

### Screen every die-cut motif before designing around it

```
node .kiro/specs/pin-collection/verify/screen.js <rimPx> <motifKey...>
```

Use the rim of the tier the pin will actually use — **rim width changes the answer**. Narrow
rims leave more enamel but weld less, so parts separate; wide rims weld everything but eat the
colour.

`emblemGate` rejects on four measured grounds:

| Test | Fails when | Why |
|---|---|---|
| pieces | `!== 1` | a die-cut pin is one piece of metal. `renderDieCut` strokes the rim along *every* subpath, so overlapping pieces each get their own full ring. For one silhouette, one rim, use `unionOutline` — **overlap is not fusion**. |
| medallion | `discLikeness > 0.9` | some library icons are drawn *inside a circular frame*, so the die-cut silhouette is a plain disc. This is what made Magic Kingdom render as a gold coin. |
| starved | `enamelShare < 0.30` | too little colour survives behind the rim. |
| aspect | `< 0.55` or `> 1.8` | too thin or too wide to read at 44px. |

**`allowRound` is a declared exception, not a loophole.** The medallion rule exists to catch
icons where the circle is *packaging*. Where the circle **is** the object — a globe — a round pin
is an ordinary pin. Applied blanket, the rule rejected every globe in the library. So it is
opt-in per emblem, with the reason recorded on the emblem.

**Welding** — enclosing a multi-part icon in a single closed outline so the sealed gaps become
enamel — rescues most otherwise-rejected icons. A welded motif is a derivative: credit it as
derived.

**No two pins may render the same artwork.** `verify/dedup.js` compares normalised geometry, not
motif keys, because the same art under two key names passed for a long time. Land and park
progressions are the exemption: a tier ladder legitimately reuses one emblem across 2–3 pins.

---

## 6 · Geometry rules

Each of these exists because ignoring it produced a defect that a passing check had called fine.

1. **Generated geometry over typed coordinates.** Every geometry defect here came from typed
   numbers. If you must type coordinates, derive every dependent value and assert it.
2. **Never type a derived value.** Extents, coverage, counts — derive and assert them. Hand-typed
   values have been wrong every time.
3. **Winding discipline.** Every solid subpath winds the same way; only hole-cutters run
   opposite. Shapes relying on cancellation are marked **`noSplit`**.
4. **Never draw a circle with one near-360° arc** — the sweep flag then picks between two
   centres. Use two half-arcs (`circlePath`).
5. **Bounding box is the wrong size measure for radial shapes.** It depends on whether a ray
   points along an axis. Use **`radialSpan`**.
6. **A contained motif must be drawn on the 512 canvas.** `renderPin` scales it by a fixed
   factor rather than box-fitting, so a path drawn on a 24-unit grid lands about 4px wide.
   `renderDieCut` box-fits and absorbs the difference, which is why this only bites contained
   pins.

---

## 7 · Counts, locked state, and the completion ladder

**Counts on pins:** an engraved metal banner, **max 4 characters**. A bare numeral as the whole
design was rejected as boring.

**Locked state:** dead pewter, drained well, padlock. A die-cut pin keeps its silhouette when
locked, which is *more* informative than a contained plate.

**The completion ladder is fireworks**, and the pattern is **additive** — rung 1 is one finished
burst, later rungs add more. A subtractive motif (one object revealed in pieces) makes rung 1 a
fragment in an empty sky, which is a structural problem and not a styling one.

Composition is **B4**: one dominant burst with satellites over the top, a spark at each core ray
tip, and a seeded scatter of sky stars. **Coverage of the well grows every rung** — 8.9% → 10.5%
→ 12.1% → 14.0% → 15.8% → 18.5%. Size alone cannot carry the climb because the composition is
near-constant in extent; the climb is ink, burst count and tier metal.

**The castle belongs to Magic Kingdom / park conquest, not the ladder.** It was double-booked.

**Mickey ears are not usable** — there is no safe near-miss on the tri-circle.

---

## 8 · Adding a pin — the order to do it in

1. **Open the master catalogue** and confirm the achievement does not already exist, and that
   the artwork you have in mind is not already used. Duplicates are the most common defect.
2. **Make the die-cut/contained call** by §1 — object or abstract. Write down which and why.
3. **Pick the tier**, and note its rim width from §2.
4. **Choose the motif**, preferring a library icon (§5). Check its licence.
5. **Screen it through `emblemGate` at that tier's rim** before designing anything around it.
   Weld it if it fails on pieces; declare `allowRound` with a reason if it fails as a medallion.
6. **Save the source asset** into `motifs/`, regenerate `motif-paths.js` from it, and add the
   `CREDITS.md` row. Mark it *derived* if it is welded, rescaled or unioned.
7. **Choose enamel** from Royal (§3), one colour per cell, no more colours than the art has
   cells. Check the separation rules.
8. **Add the pin to the catalogue** under the section header matching its tier, with its `id`
   prefixed by that tier.
9. **Run the gate.** `node .kiro/specs/pin-collection/verify/run-all.js` must exit 0.

---

## 9 · Closed routes — do not reopen these

Each was tried and ruled out with a reason. Reopening one costs the same work again.

- **Castle as the completion ladder** — subtractive, so early rungs are fragments.
- **Balloons as the ladder** — built and measured; fireworks were preferred. Still the fallback.
- **Four tiers, or seven-plus** — flat, or indistinguishable at 88px.
- **Black nickel, platinum, or celestial as the top tier** — black nickel makes the rarest pin
  the least visible on a dark board; platinum sits too close to silver; celestial is still dark.
- **Shape as the category code** — incoherent once pins are mostly die-cut.
- **Hand-computed silhouette coordinates** — the source of nearly every geometry defect.
- **Composing silhouettes from primitives** — only produces fortress-like shapes.
- **Die-cut fireworks** — three attempts. No combination of ray count and inner radius is both
  burst-like and colour-holding.
- **Rising trails on the fireworks** — killed on arithmetic: one unit of the 512 space is
  ~0.12px at a 96px render, so a 7-unit trail is 0.8px.
- **Day and dusk skies on the ladder** — every bright burst colour fails 3:1 against dusk.
- **A bare numeral as the whole design** — boring; the count lives on a banner.
- **Mickey ears, or any near-miss** — no safe distance exists on the tri-circle.

---

## 10 · What the gate can and cannot check

`verify/run-all.js` enforces the mechanical half: tier and id agreement, section placement,
motif keys that resolve, no duplicate artwork, enamel that matches the cell count, contained
pins declaring a shape and using a 512-grid motif, provenance rows, and no hardcoded counts.

**It cannot check the object-or-abstract call, and it cannot tell you whether the art is any
good.** Those are the two judgements that stay human. If you are working on this without being
able to see the renders, do not assert how something looks — ask, or build both options and let
the reviewer choose. Roughly 31 logged corrections in the ledger are that one mistake.

---

## 11 · Decision index — the ledger's coverage map

Every recorded decision in `pin-frame-sample.html`'s `DECIDED` ledger, by its exact subject,
mapped to the section here that carries it.

**`verify/all.js` asserts that every subject below appears verbatim in this file.** So a new
decision added to the ledger fails the gate until it is written up here, and the two cannot
drift apart. That is the same trick that keeps the spec README's counts honest. The strings are
matched literally — if you rename a decision in the ledger, rename it here too.

| Ledger subject | Covered in |
|---|---|
| Visual language | §1, §2 |
| Palette | §3 |
| Tier count | §2 |
| Tier ladder | §2 |
| Top tier | §2, §9 |
| Black nickel | §9 |
| Animated tiers | §2 |
| Rim weight | §2 |
| Contained vs die-cut | §1 |
| Shape is NOT category | §4 |
| Castle = Magic Kingdom | §7 |
| Mostly die-cut | §1 |
| Completion ladder motif | §7 |
| Ladder composition | §7 |
| Ladder stays contained | §1, §7 |
| Ladder climbs | §7 |
| Fireworks are enamel, not tier metal | §3 |
| Motif vs sky is a checked pairing | §3 |
| Night sky on every rung | §3 |
| Colours outside Royal, for the ladder only | §3 |
| Ladder density | §7 |
| Park emblems | §5 |
| Park emblems are ours outright | §5 |
| Counts on pins | §7 |
| Mickey ears | §7, §9 |
| Scene pins | §4 |
| Multi-colour enamel | §3 |
| Interior rims | §3 |
| Winding discipline | §6 |
| Colour separation | §3 |
| Silhouette sourcing | §5 |
| Locked state | §7 |
| Attribution | §5 |

The ledger also holds 12 **closed routes** (§9 here) and 5 **open questions**, which are all
appearance calls that no measurement can settle. Read them in the mockup before proposing a
change to any of the above — several have already been reopened and re-closed.
