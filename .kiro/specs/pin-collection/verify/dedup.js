const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'pin-catalog-mockup.html');
const html = fs.readFileSync(file, 'utf8');

// Extract PINS array
const pinsMatch = html.match(/const PINS = (\[[\s\S]*?\n\];)/);
if (!pinsMatch) {
  console.error('FAIL: Could not locate PINS array in catalog!');
  process.exit(1);
}

const vm = require('vm');
const sandbox = {
  B4_STAGES: {},
  PALETTES: { royal: { sky: '#2f6bb0', teal: '#14727f', forest: '#2f7d3e', crimson: '#a8323f', royal: '#4a2a7a', plum: '#6a3fb0', amber: '#b5721a', ink: '#241a3a' } }
};
for (let i = 1; i <= 20; i++) sandbox.B4_STAGES[i] = { cols: [] };

const pinsCode = 'var PINS = ' + pinsMatch[1];
vm.runInNewContext(pinsCode, sandbox);
const pins = sandbox.PINS;

/* ------------------------------------------------------------------------------
   Resolve the art each pin ACTUALLY renders.

   Grouping by motif key was measuring the wrong thing. The page builds
   MOTIFS = Object.assign({}, window.MOTIF_LIB, { ...inline overrides... }), so two
   different keys can hold the same path, and an inline entry silently shadows the
   licensed file that all.js byte-asserts. That is how `toriiGate` came to hold
   delapouite/pagoda.svg's path: two World Showcase pins rendered the same pagoda
   while this suite reported "100% unique motifs" because the keys differed.

   So resolve keys to path data, and compare NORMALISED GEOMETRY rather than the
   string - the same artwork reserialised (absolute vs relative commands, implicit
   command repeats) produces different bytes and would slip through a string compare.
   ------------------------------------------------------------------------------ */
const libSandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(path.dirname(file), 'motifs', 'motif-paths.js'), 'utf8'),
                   libSandbox);
const inlineMatch = html.match(
  /const MOTIFS = Object\.assign\(\{\}, window\.MOTIF_LIB \|\| \{\}, (\{[\s\S]*?\n\})\);/);
const inlineSandbox = {};
if (inlineMatch) vm.runInNewContext('var INLINE = ' + inlineMatch[1], inlineSandbox);
const MOTIFS = Object.assign({}, libSandbox.window.MOTIF_LIB || {}, inlineSandbox.INLINE || {});

const STEP = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
function canonGeometry(d) {
  const re = /([astvzqmhlc])|(-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
  let m, cmd = null, nums = [];
  const ops = [];
  const flush = () => {
    if (!cmd) return;
    const k = cmd.toLowerCase(), st = STEP[k];
    if (st === 0) { ops.push([cmd, []]); nums = []; return; }
    for (let i = 0; i + st <= nums.length; i += st) ops.push([cmd, nums.slice(i, i + st)]);
    nums = [];
  };
  while ((m = re.exec(d))) { if (m[1]) { flush(); cmd = m[1]; } else nums.push(parseFloat(m[2])); }
  flush();
  let cx = 0, cy = 0, sx = 0, sy = 0, first = true;
  const out = [], R = n => Math.round(n * 100) / 100;
  for (const [c, a] of ops) {
    const k = c.toLowerCase();
    const rel = c === k && !first;          // the opening m is effectively absolute
    if (k === 'z') { out.push('z'); cx = sx; cy = sy; continue; }
    if (k === 'h') { cx = rel ? cx + a[0] : a[0]; out.push('h' + R(cx)); continue; }
    if (k === 'v') { cy = rel ? cy + a[0] : a[0]; out.push('v' + R(cy)); continue; }
    if (k === 'a') {
      const x = rel ? cx + a[5] : a[5], y = rel ? cy + a[6] : a[6];
      out.push('a' + [R(a[0]), R(a[1]), a[2], a[3], a[4], R(x), R(y)].join(','));
      cx = x; cy = y; continue;
    }
    const seg = [];
    for (let i = 0; i + 1 < a.length; i += 2) {
      const x = rel ? cx + a[i] : a[i], y = rel ? cy + a[i + 1] : a[i + 1];
      seg.push(R(x) + ',' + R(y));
      if (i + 2 >= a.length) { cx = x; cy = y; }
    }
    out.push(k + seg.join(' '));
    if (k === 'm') { if (first) first = false; sx = cx; sy = cy; }
  }
  return out.join('|');
}

console.log(`Auditing deduplication across all ${pins.length} pins in catalog...`);

let bad = 0;
const A = (c, m) => {
  if (!c) { console.error('FAIL: ' + m); bad++; }
  else console.log('ok   ' + m);
};

// Group pins by motif/scene key
const motifUsage = {};
pins.forEach(p => {
  const key = p.scene ? `scene:${p.scene}` : (p.motif ? `motif:${p.motif}` : `text:${p.text}`);
  if (!motifUsage[key]) motifUsage[key] = [];
  motifUsage[key].push(p);
});

// Audit duplicates
for (const [key, list] of Object.entries(motifUsage)) {
  if (list.length === 1) continue;

  // Allowed exception 1: The 20-stage Experience Ladder (b4fire1..b4fire20)
  const isLadder = list.every(p => p.cat === 'ladder' || (p.scene && p.scene.startsWith('b4fire')));
  if (isLadder) continue;

  // Allowed exception 2: Land Progression (Bronze Starter -> Silver 100% Attraction Mastery -> Gold 100% Complete)
  const isLandProgression = (list.length >= 2 && list.length <= 3) &&
    list.every(p => p.cat === 'land');
  
  if (isLandProgression) {
    console.log(`ok   Land Progression verified: ${key} -> [${list.map(p => p.id).join(', ')}]`);
    continue;
  }

  // Allowed exception 3: Park Progression (Bronze Starter -> Gold 100% Attraction Master -> Amethyst 100% Sovereign)
  const isParkProgression = (list.length >= 2 && list.length <= 3) &&
    list.every(p => p.cat === 'park');
  
  if (isParkProgression) {
    console.log(`ok   Park Progression verified: ${key} -> [${list.map(p => p.id).join(', ')}]`);
    continue;
  }

  // Allowed exception 4: Thematic Progression (Bronze Contained Starter Crest -> Silver/Gold Die-Cut Mastery)
  const isThematicProgression = (list.length === 2) &&
    list.every(p => p.cat === 'sets');

  if (isThematicProgression) {
    console.log(`ok   Thematic Progression verified: ${key} -> [${list.map(p => p.id).join(', ')}]`);
    continue;
  }

  // Any other reuse is a strict duplicate violation!
  A(false, `Duplicate motif/scene detected: "${key}" is reused across ${list.length} pins: [${list.map(p => p.id).join(', ')}]`);
}

/* ---- the check the key-based pass above cannot make ----
   Two DIFFERENT keys holding the same artwork. Compared by normalised geometry, so a
   reserialised copy cannot hide. The progression exemptions above still apply: a land
   or park ladder legitimately reuses one emblem across its tiers. */
console.log('\nAuditing rendered artwork (geometry-normalised, not by key)...');
const artGroups = new Map();
let unresolved = 0;
pins.filter(p => !p.scene && p.motif).forEach(p => {
  const d = MOTIFS[p.motif];
  if (d == null || !String(d).trim()) { unresolved++; return; }
  const g = canonGeometry(String(d));
  if (!artGroups.has(g)) artGroups.set(g, []);
  artGroups.get(g).push(p);
});
A(unresolved === 0, `every pin's motif key resolves to path data (${unresolved} did not)`);

for (const [, list] of artGroups) {
  const keys = [...new Set(list.map(p => p.motif))];
  if (keys.length < 2) continue;                 // one key reused = handled above
  const allLand = list.every(p => p.cat === 'land');
  const allPark = list.every(p => p.cat === 'park');
  if ((allLand || allPark) && list.length <= 3) {
    console.log(`ok   progression shares one emblem: [${keys.join(', ')}]`);
    continue;
  }
  A(false, `Same artwork under different keys: [${keys.join(', ')}] renders identically on ` +
    `[${list.map(p => `${p.id} (${p.tier})`).join(', ')}]`);
}

if (bad > 0) {
  console.error(`\nDEDUPLICATION FAILED: ${bad} duplicate violations detected!`);
  process.exit(1);
} else {
  console.log('\nALL DEDUPLICATION CHECKS PASSED — unique keys AND unique artwork.');
}
