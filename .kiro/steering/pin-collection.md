# Pins, badges, achievements — read the contract first

Always-on and deliberately tiny: this file only **routes**. It used to carry the full detail at
4.4KB, which was charged to every unrelated task's context. That bulk now lives in
`pin-collection-detail.md`, loaded only when a pin file is open.

**Creating or changing a pin, badge, motif or challenge? Read both in full before editing:**

1. **`docs/pin-art-direction.md`** — the standing contract. Die-cut versus contained, tier
   rims, the Royal palette, geometry rules, `emblemGate` screening, motif provenance, and the
   fabrication ladder to apply when an icon fails screening. An icon is not a pin; converting
   one into the other is the job, so fabricate rather than reject.
2. **`.kiro/specs/pin-collection/README.md`** — current state, the 12 working rules, how to add
   a motif, and the next task. Skipping it means re-deriving decisions already made and
   repeating mistakes already documented.

`.kiro/specs/pin-collection/pin-catalog-mockup.html` is the master catalogue of every existing
pin. Open it before adding one, to avoid a duplicate achievement or duplicate artwork.

**The pin gate is scoped to the rendered catalogue/artwork, not "anything pin-related."** Run
`node .kiro/specs/pin-collection/verify/run-all.js` (must exit 0) only when a change touches
`pin-catalog-mockup.html`, `pin-frame-sample.html`, `pins-v2-transcription.js`,
`pin-descriptions.js`, or anything under `motifs/` — i.e. a pin's art, motif, or geometry
changed. It checks artwork validity, dedup, provenance, and die-cut screening; it has nothing
to say about backend routes, repos, migrations, DTOs, or mobile screens, even ones named
`Pin*` (e.g. claim logic, the Showcase's drag/overlap/sharing code, `PinRepo`, `PinBoardScreen`).
For that code, `npm run verify` (or the scoped `verify:api`/`verify:mobile`/`verify:shared`) is
the right and sufficient gate, exactly like any other feature — `npm run verify` does **not**
cover the mockup/catalogue folder, but the reverse is also true: the pin gate does not cover
app code, so do not run it as a substitute or a habit when no catalogue file changed.
