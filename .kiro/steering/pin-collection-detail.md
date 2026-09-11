---
inclusion: fileMatch
fileMatchPattern: '*pin*'
---

# Pin collection — working detail

Loaded **conditionally**, only when a pin-related file is in context. The always-on
`pin-collection.md` is a ~1KB router; this is the bulk, kept out of every unrelated task's
context. Authority still lives in `docs/pin-art-direction.md` and the spec README — this is a
fast path, not a source of truth. If it disagrees with them, they win.

The working artefact is `.kiro/specs/pin-collection/pin-frame-sample.html` — one parametric
SVG renderer plus a live decision ledger of 33 decisions, 12 closed routes and 5 open
questions. `pins-mockup.html` in the same folder is the superseded first pass; do not extend
it. `pin-catalog-mockup.html` is the master catalogue of every released pin.

## The gate is not optional and is not `npm run verify`

```
node .kiro/specs/pin-collection/verify/run-all.js     # after every change, ~35s
node .kiro/specs/pin-collection/verify/selftest.js    # when you change an all.js assertion
node .kiro/specs/pin-collection/verify/bite.js        # when you change a catalogue assertion
node .kiro/specs/pin-collection/verify/trace.js       # to find a motif's source
```

All ten suites pass as of writing. A red run means your change broke something — check what
you added rather than assuming it was already broken.

`npm run verify` does **not** cover this folder — `.kiro/specs/` sits outside every tsconfig
and test glob. Say that plainly rather than implying the root gate covered it. Conversely,
these mockup verifiers are **not** app tests and nothing in `verify/` belongs in Vitest or
Jest.

`verify/all.js` keys assertions to literal strings on the page — decision row names, open
question text, section ids, and the counts quoted in the README. Rewording one will fail the
suite. That is deliberate: it is what stops the document drifting from the code.

## Making a pin

**A new die-cut pin must pass `emblemGate` at its tier's rim** — `verify/diecut.js` enforces
it, for AI-drawn SVGs as much as for library icons, because it screens geometry and ignores
where the art came from. If it fails, **fabricate rather than reject**: weld, then scale up in
the die, then fall back to a contained plate (`docs/pin-art-direction.md` §5). Do **not** add
a new pin to that suite's `GRANDFATHERED` list — those entries (6 in the v2 catalogue) are
pre-existing debt and the list is asserted to only shrink. Colour die-cut pins
(`colorDieCut:true`) are welded in their render branch and are exempt from the raw screen.

An icon is not a pin. Turning one into the other is the job; "that icon fails screening" is
not an answer.

## Four traps that already cost real work

The full list is in the README; these are the ones most likely to bite immediately.

1. **Measure the claim, not something adjacent to it.** The recurring failure across the whole
   feature. Assertions here have passed while checking arc *flags* instead of the resulting
   circle centre, *how much* enamel survived instead of *where*, and distinct hex values while
   two tiers looked identical on screen. Before writing a check, ask what would still pass if
   the thing were broken.
2. **Appearance cannot be asserted.** Nobody in this loop can see the renders. Ask, or build
   both options and let the user choose. Roughly 31 logged corrections are mostly this one
   mistake.
3. **A lookup key that can go stale silently will go stale.** Demos keyed by array index slid
   onto the wrong questions; demos keyed by display name vanished on a rename. Neither errored.
4. **Verify library assets before designing around them.** Some icons are circular medallions,
   so their die-cut silhouette is a plain disc — screen every die-cut motif through
   `emblemGate` at the rim of the tier it will actually use.

## Provenance is a shipping requirement

Every motif needs a row in `.kiro/specs/pin-collection/motifs/CREDITS.md` before it ships —
it is the audit trail for the CC BY attribution obligation. `motifs/motif-paths.js` is
**generated** from the SVGs and asserted to match them byte for byte; never hand-edit it.
Licences differ in what they oblige: game-icons CC BY needs the **author** named, Boxicons
CC BY 4.0 needs its own line, Temaki CC0 needs nothing, MIT needs its notice retained.
