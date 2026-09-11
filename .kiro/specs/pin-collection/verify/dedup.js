/* Deduplication gate for pin-catalog-mockup.html (v2 roster).
 *
 * Two pins must not render the same artwork by accident. That bug is real here: `toriiGate`
 * once held delapouite/pagoda.svg's path, so two different World Showcase pins rendered the
 * same pagoda while a key-based check reported "100% unique motifs" because the keys differed.
 * So this compares NORMALISED GEOMETRY, not keys and not raw strings (the same artwork
 * reserialised — absolute vs relative commands, implicit repeats — produces different bytes).
 *
 * Legitimate reuse is a tier PROGRESSION: a land/park/theme starter and its higher-tier
 * mastery share one emblem on purpose (bronze Adventureland starter -> silver Adventureland
 * 100%). A progression climbs tiers, so it is recognised as "same art across DISTINCT tiers,
 * at most 3 pins". The two ladder mechanics (the b4fire attractions arch and the starLadder
 * emblem+stars) intentionally share one scene across many pins, differing by emblem/stage, so
 * those scene keys are exempt too.
 *
 * The roster is executed through catalog-loader.js (the page builds PINS via mapV2Pins, not a
 * literal array), so what is compared is what the catalogue actually renders.
 */
const path = require('path');
const { loadCatalog } = require('./catalog-loader');

const file = process.argv[2] || path.join(__dirname, '..', 'pin-catalog-mockup.html');

let cat;
try { cat = loadCatalog(file); }
catch (e) { console.error('FAIL: could not load catalogue -> ' + e.message); process.exit(1); }
const pins = cat.PINS;
const MOTIFS = cat.MOTIFS;
if (!Array.isArray(pins) || !pins.length) { console.error('FAIL: no pins'); process.exit(1); }

let bad = 0;
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); bad++; } else console.log('ok   ' + m); };

console.log(`Auditing deduplication across all ${pins.length} pins in catalog...`);

/* ---- normalise path geometry so a reserialised copy cannot hide ---- */
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

/* A group of pins is a legitimate progression if it reuses one emblem across DISTINCT tiers,
   at most three pins (starter -> mastery -> sovereign). */
function isProgression(list) {
  if (list.length < 2 || list.length > 3) return false;
  const tiers = new Set(list.map(p => p.tier));
  return tiers.size === list.length;         // every pin at a different tier
}

/* ---- phase 1: the same scene/motif KEY reused across pins ---- */
const usage = {};
pins.forEach(p => {
  const key = p.scene ? `scene:${p.scene}` : (p.motif ? `motif:${p.motif}` : `text:${p.text || p.emblem || p.id}`);
  (usage[key] = usage[key] || []).push(p);
});

for (const [key, list] of Object.entries(usage)) {
  if (list.length === 1) continue;

  /* the two shared ladder mechanics: the b4fire attractions arch and the starLadder emblem
     ladder. Both intentionally reuse one scene across many pins, differing by emblem/stage. */
  if (key === 'scene:starLadder' || key.startsWith('scene:b4fire') ||
      list.every(p => p.scene && p.scene.startsWith('b4fire'))) {
    console.log(`ok   shared ladder mechanic: ${key} -> ${list.length} pins`);
    continue;
  }

  if (isProgression(list)) {
    console.log(`ok   progression shares one emblem: ${key} -> [${list.map(p => p.id).join(', ')}]`);
    continue;
  }

  A(false, `Duplicate motif/scene: "${key}" reused across ${list.length} pins that are not a ` +
    `tier progression: [${list.map(p => `${p.id} (${p.tier})`).join(', ')}]`);
}

/* ---- phase 2: DIFFERENT keys that render the same artwork (geometry-normalised) ---- */
console.log('\nAuditing rendered artwork (geometry-normalised, not by key)...');
const artGroups = new Map();
let bespokeSkipped = 0;
pins.filter(p => !p.scene && p.motif).forEach(p => {
  const d = MOTIFS[p.motif];
  /* a motif pin with no static path is drawn by a dedicated renderPin branch (magicCarpet,
     monorailScene, …). There is no comparable geometry, so it cannot collide by artwork;
     catalog.js owns the "every pin resolves to something renderable" check. Skip it here. */
  if (d == null || !String(d).trim()) { bespokeSkipped++; return; }
  const g = canonGeometry(String(d));
  if (!artGroups.has(g)) artGroups.set(g, []);
  artGroups.get(g).push(p);
});
if (bespokeSkipped) console.log(`     (${bespokeSkipped} bespoke-branch motif pin(s) have no static path; compared by catalog.js render check instead)`);

for (const [, list] of artGroups) {
  const keys = [...new Set(list.map(p => p.motif))];
  if (keys.length < 2) continue;                 // one key reused = handled in phase 1
  /* different keys, identical art. Allowed only for a genuine progression (same subject at
     different tiers drawn from two keys) — otherwise it is the toriiGate/pagoda bug class. */
  if (isProgression(list)) {
    console.log(`ok   progression shares one emblem across keys: [${keys.join(', ')}]`);
    continue;
  }
  A(false, `Same artwork under different keys: [${keys.join(', ')}] renders identically on ` +
    `[${list.map(p => `${p.id} (${p.tier})`).join(', ')}]`);
}

if (bad > 0) {
  console.error(`\nDEDUPLICATION FAILED: ${bad} duplicate violation(s) detected!`);
  process.exit(1);
} else {
  console.log('\nALL DEDUPLICATION CHECKS PASSED — unique keys AND unique artwork.');
}
