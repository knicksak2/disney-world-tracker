/* Do the catalogue assertions BITE?  node verify/bite.js [pin-catalog-mockup.html]
 *
 * A green gate proves nothing is broken; it does not prove the checks would CATCH a defect.
 * This harness introduces a real defect for each catalogue assertion and requires the suite
 * to report it, keyed on a SPECIFIC token that must appear among the FAILURES.
 *
 * v2 note. The catalogue no longer carries its pins as a literal array in the HTML; it builds
 * them from `pins-v2-transcription.js` (the roster), `pin-descriptions.js`, the inline MOTIFS
 * block in the HTML, and `motifs/CREDITS.md`. So a defect has to be introduced in whichever of
 * those files actually owns the thing under test — tampering the HTML alone would not reach a
 * pin. Each case therefore names the file it breaks. The baseline is green, so unlike the v1
 * harness this tampers the real file IN PLACE and restores it in a `finally`; an interrupted
 * run restores on the way out, and a sanity check confirms the token is absent from the clean
 * run before trusting its presence in the tampered one.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const here = __dirname;
const spec = path.resolve(here, '..');
const target = process.argv[2] || path.join(spec, 'pin-catalog-mockup.html');

const FILES = {
  TRANS: path.join(spec, 'pins-v2-transcription.js'),
  HTML: target,
  CREDITS: path.join(spec, 'motifs', 'CREDITS.md'),
};

function run(suite) {
  try {
    return execFileSync(process.execPath, [path.join(here, suite), target],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

/* Search only the FAILURES: an assertion's message appears in both its "ok" and "FAIL" lines,
   so matching the raw output would pass on a token that is present as a PASS. Take each FAIL
   line plus its indented continuation lines. */
function failText(out) {
  const keep = [];
  let inFail = false;
  for (const line of out.split(/\r?\n/)) {
    if (/^FAIL[: ]/.test(line)) { inFail = true; keep.push(line); continue; }
    if (inFail && /^\s+\S/.test(line)) { keep.push(line); continue; }
    inFail = false;
  }
  return keep.join('\n');
}

/* ---- each case: which suite, which file to break, how, and the token that must appear ---- */
const CASES = [
  { suite: 'catalog.js', file: 'TRANS', why: 'a pin whose id prefix disagrees with its tier',
    token: 'gold_coaster_royalty',
    mutate: t => t.replace(
      "{ id:'gold_coaster_royalty', name:'Coaster Royalty', tier:'gold'",
      "{ id:'gold_coaster_royalty', name:'Coaster Royalty', tier:'silver'") },

  { suite: 'catalog.js', file: 'HTML', why: 'a stale literal count restored in the markup',
    token: 'no count element in the markup holds a literal number',
    mutate: t => t.replace('<strong id="count-bronze">&mdash;</strong>',
      '<strong id="count-bronze">57</strong>') },

  { suite: 'catalog.js', file: 'TRANS', why: 'a duplicated pin id',
    token: 'pin ids are unique',
    mutate: t => t.replace("id:'silver_land_asia'", "id:'silver_land_adventureland'") },

  { suite: 'catalog.js', file: 'TRANS', why: 'a pin pointing at a motif that does not exist',
    token: 'trainStationTypo',
    mutate: t => t.replace("mode:'diecut', motif:'trainStation'", "mode:'diecut', motif:'trainStationTypo'") },

  { suite: 'catalog.js', file: 'TRANS', why: 'a pin filed under the wrong track section',
    token: 'sits under the section header matching its track',
    mutate: t => t.replace(
      "{ id:'silver_land_asia', name:'Asia 100%', tier:'silver', track:'places'",
      "{ id:'silver_land_asia', name:'Asia 100%', tier:'silver', track:'dining'") },

  { suite: 'dedup.js', file: 'TRANS', why: 'two different keys rendering the same artwork',
    token: 'compassRose',
    /* compass and compassRose hold identical art; only compassRose ships (gold_all_lands,
       gold). Pointing another GOLD pin at compass makes two gold pins render identically
       under different keys — same tier, so not a progression, so it must be caught. */
    mutate: t => t.replace(
      "motif:'world', allowRound:true",
      "motif:'compass', allowRound:true") },

  { suite: 'provenance.js', file: 'HTML', why: 'an inline override shadowing a licensed file',
    token: 'shadowed (1)',
    mutate: t => t.replace('const MOTIFS = Object.assign({}, window.MOTIF_LIB || {}, {',
      'const MOTIFS = Object.assign({}, window.MOTIF_LIB || {}, {\n  crown: "M0 0 H100 V100 H0 Z",') },

  { suite: 'diecut.js', file: 'TRANS', why: 'a new plain die-cut pin whose motif fails emblemGate',
    token: 'bronze_diecut_bite_probe',
    /* theater is 2 pieces at bronze 4.2px; the probe is plain die-cut (not colorDieCut) and
       not grandfathered, so it cannot be excused. */
    mutate: t => t.replace('  // ===== Thematic · Rides =====\n',
      "  // ===== Thematic · Rides =====\n  { id:'bronze_diecut_bite_probe', name:'Probe', " +
      "tier:'bronze', track:'thematic', status:'new', mode:'diecut', motif:'theater', enamel:['#991B1B'] },\n") },

  { suite: 'diecut.js', file: 'TRANS', why: 'a grandfathered pin fixed but left on the list',
    token: 'bronze_royal_encounter',
    /* swap crown (grandfathered 2 pieces) for a motif that passes at bronze; the entry should
       then be deleted, so leaving it must fail as a stale entry. */
    mutate: t => t.replace(
      "{ id:'bronze_royal_encounter', name:'Royal Encounter', tier:'bronze', track:'characters', status:'reuse', src:'bronze_royal_encounter_1', mode:'diecut', motif:'crown'",
      "{ id:'bronze_royal_encounter', name:'Royal Encounter', tier:'bronze', track:'characters', status:'reuse', src:'bronze_royal_encounter_1', mode:'diecut', motif:'trainStation'") },
];

let bad = 0;
console.log('Baseline: running each suite clean to confirm the tokens are absent from failures.\n');
const cleanFail = {};
[...new Set(CASES.map(c => c.suite))].forEach(s => { cleanFail[s] = failText(run(s)); });

for (const c of CASES) {
  const fpath = FILES[c.file];
  const original = fs.readFileSync(fpath, 'utf8');
  const mutated = c.mutate(original);
  if (mutated === original) {
    console.error('FAIL: tamper had no effect (the harness is stale) — ' + c.why + '  [' + c.file + ']');
    bad++; continue;
  }
  if (cleanFail[c.suite].includes(c.token)) {
    console.error('FAIL: token already among the clean failures, so this case is vacuous — ' +
      c.why + '  [' + c.token + ']');
    bad++; continue;
  }
  try {
    fs.writeFileSync(fpath, mutated);
    const out = failText(run(c.suite));
    if (out.includes(c.token)) console.log('ok   ' + c.suite.padEnd(14) + 'caught: ' + c.why);
    else {
      console.error('FAIL: NOT caught by ' + c.suite + ' — ' + c.why +
        '\n      expected token: ' + c.token);
      bad++;
    }
  } finally {
    fs.writeFileSync(fpath, original);
  }
}

console.log('\n' + (bad === 0
  ? 'BITE PASSED — all ' + CASES.length + ' catalogue assertions fire on a real defect'
  : bad + ' CASE(S) DID NOT BITE'));
process.exit(bad === 0 ? 0 : 1);
