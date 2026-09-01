#!/usr/bin/env node
/* Does the gate actually bite?
 *
 *   node .kiro/specs/pin-collection/verify/selftest.js
 *
 * A verifier that passes is only reassuring if it would have failed. Every assertion in
 * this project was added after a defect, and more than one of those assertions turned out
 * to be checking something adjacent to the claim — so this file breaks things on purpose
 * and requires all.js to notice.
 *
 * It edits files, runs the suite, and restores them, all in one process so a half-finished
 * run cannot leave a tampered file behind: the restore is in a finally block.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const spec = path.resolve(here, '..');
const html = path.join(spec, 'pin-frame-sample.html');
const readme = path.join(spec, 'README.md');
const suite = path.join(here, 'all.js');

/* The two count cases below used to hardcode the numbers ("**28 corrections logged**"),
   which is the very trap this project keeps falling into: a typed derived value. The
   corrections list grew to 31 and the selftest started reporting itself stale instead of
   testing anything. Read the live number out of the README and decrement it, so the case
   can never rot. If the label is missing entirely, that is a real failure worth shouting
   about, and `bump` returns a sentinel that the loop below reports. */
const readmeNow = fs.readFileSync(readme, 'utf8');
function bump(label) {
  const m = readmeNow.match(new RegExp('\\*\\*(\\d+) ' + label + '\\*\\*'));
  if (!m) return { from: '**<missing ' + label + '>**', to: 'x' };
  return { from: m[0], to: '**' + (Number(m[1]) - 1) + ' ' + label + '**' };
}

/* each case: a file, a string to break, what to break it to, and why it must be caught */
const CASES = [
  Object.assign(bump('corrections logged'),
    { file: readme, why: 'a stale count in the handover document' }),
  Object.assign(bump('decisions'),
    { file: readme, why: 'a stale decision count' }),
  { file: readme, from: 'Known gaps', to: 'Everything is fine',
    why: 'the honest-gaps section being removed' },
  /* The contract outside the spec is the only place a fresh agent reads the decisions, so
     a decision going missing from it must fail. Renamed rather than suffixed: appending to
     the string would leave the original as a substring and indexOf would still match. */
  { file: path.join(spec, '..', '..', '..', 'docs', 'pin-art-direction.md'),
    from: 'Winding discipline', to: 'Winding rules',
    why: 'a recorded decision dropping out of docs/pin-art-direction.md' },
  /* the discoverability pointer is the single point of failure for the whole handover:
     without it a new session never learns the README or the gate exist */
  /* three levels up, not two: spec is <repo>/.kiro/specs/pin-collection, so two `..`
     lands in .kiro and produced .kiro/.kiro/steering on the first attempt */
  { file: path.join(spec, '..', '..', '..', '.kiro', 'steering', 'pin-collection.md'),
    from: '.kiro/specs/pin-collection/README.md', to: 'somewhere else',
    why: 'the steering pointer no longer naming the README' }
];

/* NOTE ON COST. all.js takes roughly 100 seconds — it rasterises a lot of geometry — so
   each case here costs a full run and the whole file is several minutes. It is deliberately
   NOT part of run-all.js. Run it when you add or change an assertion, which is when the
   question "would this have failed?" actually needs answering. Trimmed to three cases plus
   the two bookends for that reason; the first draft had four and timed out at 15 minutes. */

function runSuite(){
  try {
    execFileSync(process.execPath, [suite, html], { encoding: 'utf8', maxBuffer: 64*1024*1024 });
    return true;                                  // passed
  } catch (e) { return false; }                   // non-zero exit = caught it
}

let bad = 0;

/* baseline: it must pass before we break anything, or nothing below means a thing */
if (!runSuite()) {
  console.error('FAIL: the suite does not pass on a clean tree, so this test proves nothing');
  process.exit(1);
}
console.log('ok   baseline: the suite passes on a clean tree');

for (const c of CASES) {
  const orig = fs.readFileSync(c.file, 'utf8');
  if (orig.indexOf(c.from) === -1) {
    console.error('FAIL: cannot find the text to break — ' + JSON.stringify(c.from)
      + ' (the selftest itself is stale)');
    bad++;
    continue;
  }
  try {
    fs.writeFileSync(c.file, orig.split(c.from).join(c.to));
    const stillPassed = runSuite();
    if (stillPassed) { console.error('FAIL: not caught — ' + c.why); bad++; }
    else console.log('ok   caught: ' + c.why);
  } finally {
    fs.writeFileSync(c.file, orig);               // always restore
  }
}

/* and the tree must be clean again afterwards */
if (!runSuite()) {
  console.error('FAIL: the suite does not pass after restoring, so a file was left broken');
  bad++;
} else console.log('ok   everything restored, suite green again');

console.log(bad === 0 ? '\nSELFTEST PASSED — the gate bites'
                      : '\n' + bad + ' SELFTEST FAILURE(S) — assertions that do not bite');
process.exit(bad === 0 ? 0 : 1);
