/* Do the catalogue assertions BITE?  node verify/bite.js
 *
 * selftest.js answers this question for all.js, but it cannot cover the catalogue
 * suites: it tampers files in place and demands a GREEN baseline first ("if the suite
 * does not pass on a clean tree, this test proves nothing"). catalog.js, dedup.js and
 * provenance.js are legitimately RED right now - there is real unfinished provenance
 * work and a real duplicate-art bug - so a pass/fail baseline carries no information.
 *
 * So this harness works differently, and better:
 *   - it tampers a COPY, never the real file, so an interrupted run cannot leave the
 *     tree broken (the copy sits beside the original because the suites resolve
 *     motifs/ relative to the html, and is removed in a finally);
 *   - it asserts on a SPECIFIC token in the output, present when tampered and ABSENT
 *     when clean. That differential is what makes it meaningful while other assertions
 *     in the same suite are already failing.
 *
 * Every case below was written after a real defect, and two of them exist because the
 * first version of an assertion did NOT bite: the section-header regex silently slid
 * onto the previous tier when a count was reintroduced, and the updateTabCounts checks
 * were textual and passed with the bug reinstated.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const here = __dirname;
const spec = path.resolve(here, '..');
const src = path.join(spec, 'pin-catalog-mockup.html');
const copy = path.join(spec, '__bite-copy.html');

function run(suite, target) {
  try {
    return execFileSync(process.execPath, [path.join(here, suite), target],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

/* Search only the FAILURES, not the whole log. An assertion's message appears in both
   its "ok   <message>" and its "FAIL: <message>" line, so matching the raw output made
   seven cases below look vacuous when they were fine - the token was present as a PASS.
   Take each FAIL line plus its indented continuation lines. */
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

const original = fs.readFileSync(src, 'utf8');

/* ---- each case: which suite, how to break it, and the token that must appear ---- */
const CASES = [
  { suite: 'catalog.js', why: 'a silver pin placed under the GOLD header',
    token: 'silver_bite_probe',
    mutate: t => t.replace('  // === GOLD ===\n',
      "  // === GOLD ===\n  { id: 'silver_bite_probe', name: 'Bite Probe', tier: 'silver', " +
      "cat: 'sets', mode: 'diecut', motif: 'flatStar', enamel: ['#FEF3C7'], criteria: 'probe' },\n") },

  { suite: 'catalog.js', why: 'a hardcoded count restored on a section header',
    token: 'no section header carries a hardcoded pin count',
    mutate: t => t.replace('// === BRONZE ===', '// === BRONZE (55) ===') },

  { suite: 'catalog.js', why: 'a sub-group comment naming another tier',
    token: 'no sub-group comment names a tier other than its section',
    mutate: t => t.replace('// Touring & Dining (Silver)', '// Touring & Dining (Gold)') },

  { suite: 'catalog.js', why: 'updateTabCounts nested back inside the click handler',
    token: 'count-all shows the real total on load',
    mutate: t => t
      .replace('\n/* Declared at top level on purpose.', '\n  if (1) {\n/* Declared at top level',
      ).replace('\nupdateTabCounts();\nfilterAndRender();', '\n}\nfilterAndRender();') },

  { suite: 'catalog.js', why: 'a stale literal count restored in the markup',
    token: 'no count element in the markup holds a literal number',
    mutate: t => t.replace('<strong id="count-bronze">&mdash;</strong>',
      '<strong id="count-bronze">52</strong>') },

  { suite: 'catalog.js', why: 'a pin pointing at a motif that does not exist',
    token: "motif 'trainStationTypo' undefined",
    mutate: t => t.replace("motif: 'trainStation'", "motif: 'trainStationTypo'") },

  { suite: 'catalog.js', why: 'an id prefix disagreeing with the tier field',
    token: "gold_coaster_king has tier 'silver'",
    mutate: t => t.replace("{ id: 'gold_coaster_king', name: 'Coaster Royalty', tier: 'gold'",
      "{ id: 'gold_coaster_king', name: 'Coaster Royalty', tier: 'silver'") },

  { suite: 'catalog.js', why: 'a ladder id number contradicting its banner',
    token: 'bronze_centurion_25 shows 27',
    mutate: t => t.replace("banner: '25', motifEnamel: B4_STAGES[4].cols",
      "banner: '27', motifEnamel: B4_STAGES[4].cols") },

  { suite: 'catalog.js', why: 'a duplicated pin id',
    token: 'pin ids are unique',
    mutate: t => t.replace("id: 'bronze_asia_starter'", "id: 'bronze_africa_starter'") },

  { suite: 'catalog.js', why: 'a contained pin using a motif drawn on a 24-unit grid',
    token: 'bronze_epcot_starter uses magicLantern',
    mutate: t => t.replace(
      "{ id: 'bronze_epcot_starter', name: 'EPCOT Starter', tier: 'bronze', cat: 'park', shape: 'disc', motif: 'wireframeGlobe'",
      "{ id: 'bronze_epcot_starter', name: 'EPCOT Starter', tier: 'bronze', cat: 'park', shape: 'disc', motif: 'magicLantern'") },

  { suite: 'catalog.js', why: 'an enamel array given more colours than the art has cells',
    token: 'gold_coaster_king (',
    mutate: t => t.replace('motif: \'coasterLoop\', enamel: ["#475569","#94a3b8","#dc2626","#f59e0b"]',
      'motif: \'coasterLoop\', enamel: ["#475569","#94a3b8","#dc2626","#f59e0b","#111111","#222222","#333333","#444444","#555555","#666666"]') },

  /* dedup.js already reports pagoda/toriiGate, so the generic message is not evidence
     here - key on the injected clone name instead */
  /* `compass` and `compassRose` hold the same art already, but only compassRose is used.
     Pointing a second pin at `compass` creates two keys rendering identically - which is
     precisely the class the old key-based dedup could not see. Keyed on compassRose,
     which is absent from dedup's clean failures. */
  { suite: 'dedup.js', why: 'two different keys holding the same artwork',
    token: 'compassRose',
    mutate: t => t.replace(
      "{ id: 'prism_legendary_guide', name: 'The Legendary Disney Guide', tier: 'prism', cat: 'social', mode: 'diecut', motif: 'flatStar'",
      "{ id: 'prism_legendary_guide', name: 'The Legendary Disney Guide', tier: 'prism', cat: 'social', mode: 'diecut', motif: 'compass'") },

  /* The inline MOTIFS block is now EMPTY - every redundant copy was removed, so the
     catalogue renders purely from the licensed, byte-asserted library and the shadowing
     hazard is gone structurally. Injecting one override for a key that does have a
     licensed .svg is therefore the only way to exercise the assertion. Prepending is safe
     precisely because the block is empty; when it held the key already, the later
     definition won and a prepended override was silently discarded. */
  /* A NEW die-cut pin using unscreened art must fail. `theater` is 2 pieces at bronze's
     4.2px rim, and this probe id is not in the grandfather list, so it cannot be excused. */
  { suite: 'diecut.js', why: 'a new die-cut pin whose motif fails emblemGate',
    token: 'diecut_bite_probe',
    mutate: t => t.replace('  // === BRONZE ===\n',
      "  // === BRONZE ===\n  { id: 'bronze_diecut_bite_probe', name: 'Die-Cut Bite Probe', " +
      "tier: 'bronze', cat: 'sets', mode: 'diecut', motif: 'theater', " +
      "enamel: ['#991B1B'], criteria: 'probe' },\n") },

  /* Fixing a grandfathered pin without deleting its entry must also fail, or the list rots
     into a permanent dumping ground. Switching one to a contained plate IS the plate remedy,
     so its entry should have gone with it. */
  { suite: 'diecut.js', why: 'a grandfathered pin fixed but left on the list',
    token: 'switched to a contained plate while keeping its entry',
    mutate: t => t.replace(
      "{ id: 'bronze_theater_spectacular', name: 'Stage Spectacular (First Show)', tier: 'bronze', cat: 'sets', mode: 'diecut'",
      "{ id: 'bronze_theater_spectacular', name: 'Stage Spectacular (First Show)', tier: 'bronze', cat: 'sets', shape: 'crest'") },

  { suite: 'provenance.js', why: 'an inline override shadowing a licensed file',
    token: 'shadowed (1)',
    mutate: t => t.replace('const MOTIFS = Object.assign({}, window.MOTIF_LIB || {}, {',
      'const MOTIFS = Object.assign({}, window.MOTIF_LIB || {}, {\n  balloons: "M0 0 H10 V10 H0 Z",') },
];

let bad = 0;
console.log('Baseline: running each suite on an untampered copy to record what already fails.\n');
fs.writeFileSync(copy, original);
const cleanOut = {};
[...new Set(CASES.map(c => c.suite))].forEach(s => { cleanOut[s] = run(s, copy); });

try {
  for (const c of CASES) {
    const mutated = c.mutate(original);
    if (mutated === original) {
      console.error('FAIL: tamper had no effect (the harness is stale) — ' + c.why);
      bad++; continue;
    }
    /* the token must NOT already be among the clean copy's FAILURES, or the case proves
       nothing - several of these suites are legitimately red for other reasons */
    if (failText(cleanOut[c.suite]).includes(c.token)) {
      console.error('FAIL: token already among the clean failures, so this case is vacuous — ' +
        c.why + '  [' + c.token + ']');
      bad++; continue;
    }
    fs.writeFileSync(copy, mutated);
    const out = failText(run(c.suite, copy));
    if (out.includes(c.token)) console.log('ok   ' + c.suite.padEnd(15) + 'caught: ' + c.why);
    else {
      console.error('FAIL: NOT caught by ' + c.suite + ' — ' + c.why +
        '\n      expected token: ' + c.token);
      bad++;
    }
  }
} finally {
  fs.rmSync(copy, { force: true });
}

if (fs.existsSync(copy)) { console.error('FAIL: the tampered copy was left behind'); bad++; }

console.log('\n' + (bad === 0
  ? 'BITE PASSED — all ' + CASES.length + ' catalogue assertions fire on a real defect'
  : bad + ' CASE(S) DID NOT BITE'));
process.exit(bad === 0 ? 0 : 1);
