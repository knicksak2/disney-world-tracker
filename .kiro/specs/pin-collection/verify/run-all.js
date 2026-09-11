#!/usr/bin/env node
/* Runs every mockup verifier and fails if any of them does.
 *
 *   node .kiro/specs/pin-collection/verify/run-all.js
 *
 * These are NOT app tests. They validate the design mockup
 * (pin-frame-sample.html) — its geometry, its colour contrast, its decision ledger and
 * its own internal consistency. The app's real test suites are Vitest and Jest per
 * .kiro/steering/tech-conventions.md, and nothing here belongs in those.
 *
 * They exist because the mockup makes claims that are cheap to get wrong and expensive
 * to spot by eye: "the ladder climbs", "this colour is visible", "this shape is one piece
 * of metal". Every assertion in here was added after a real defect, most of them defects
 * that a passing check had already declared fine.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const here = __dirname;
const html = path.resolve(here, '..', 'pin-frame-sample.html');

if (!fs.existsSync(html)) {
  console.error('cannot find the mockup at ' + html);
  process.exit(1);
}

/* all.js is the consolidated suite; the other three predate it and stayed separate
   because each one guards a specific bug class end to end. */
/* equiv.js runs first and is cheap: it proves the spatial index that makes everything else
   fast still gives the same answers as the brute-force path. If that ever fails, every
   number the other suites check is suspect, so there is no point running them. */
/* Four suites target pin-catalog-mockup.html (the v2 catalogue) rather than the frame sample.
   They do not regex a `const PINS = [...]` out of the HTML — v2 has none — they share
   verify/catalog-loader.js, which executes the page's own scripts (the external roster
   pins-v2-transcription.js, pin-descriptions.js, and the inline definitions) and returns the
   resolved pins/motifs, so every suite screens exactly what the catalogue renders:
     dedup.js      - no two pins render the same artwork (by geometry, not by key)
     catalog.js    - structural invariants: tier/id agreement, track-section placement, no
                     hardcoded counts, every pin renders to non-empty art, load-time counts
     provenance.js - every motif a pin renders has a CREDITS row and a demonstrable source
                     (or is authored in a render branch and recorded Project Original/derived)
     diecut.js     - every NEW plain die-cut pin passes emblemGate at its own tier rim; the
                     grandfathered failures are self-cleaning (fixing one without removing its
                     entry also fails). Colour die-cut pins are welded in their render branch,
                     so they are exempt here and covered by catalog.js's render check.
   All four are GREEN. Applies equally to AI-drawn SVGs, since it screens geometry, not
   provenance.

   "Would these bite?" is answered by verify/bite.js, which is not part of this runner
   for the same reason selftest.js is not - it costs a full suite run per case. */
const SUITES = ['equiv.js', 'all.js', 'weld.js', 'ladder.js', 'ferris.js', 'inner.js',
                'dedup.js', 'catalog.js', 'provenance.js', 'diecut.js'];
const CATALOG_SUITES = new Set(['dedup.js', 'catalog.js', 'provenance.js', 'diecut.js']);

let failed = [];
for (const suite of SUITES) {
  process.stdout.write('\n=== ' + suite + ' ===\n');
  try {
    /* equiv.js and weld.js locate the mockup themselves and take no argument */
    let targetHtml = html;
    if (CATALOG_SUITES.has(suite)) targetHtml = path.resolve(here, '..', 'pin-catalog-mockup.html');
    const args = (suite === 'equiv.js' || suite === 'weld.js')
      ? [path.join(here, suite)]
      : [path.join(here, suite), targetHtml];
    const out = execFileSync(process.execPath, args,
                             { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    /* only the tail matters on a pass; the full log is long and mostly "ok" */
    const lines = out.trimEnd().split('\n');
    process.stdout.write(lines.slice(-2).join('\n') + '\n');
  } catch (e) {
    failed.push(suite);
    const out = (e.stdout || '') + (e.stderr || '');
    /* on failure show every FAIL line, not the tail */
    const bad = out.split('\n').filter(l => /^FAIL|Error|not defined|threw/.test(l));
    process.stdout.write((bad.length ? bad.join('\n') : out.slice(-2000)) + '\n');
  }
}

console.log('\n' + '-'.repeat(60));
if (failed.length) {
  console.error('FAILED: ' + failed.join(', '));
  process.exit(1);
}
console.log('all ' + SUITES.length + ' mockup suites passed');
process.exit(0);
