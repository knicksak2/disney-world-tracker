#!/usr/bin/env node
/* Trace a motif to its source.   node verify/trace.js <motifKey> <search-term> [...]
 *
 *   node verify/trace.js coasterLoop roller coaster
 *   node verify/trace.js skyliner cable gondola aerial
 *
 * Exists because a human naming the suspected source and this verifying it has been far
 * more effective than any exhaustive search I built. Three of four guesses from the user
 * were right; my sweeps missed all three, for three different reasons:
 *
 *   1. candidate filenames were guessed from OUR key, so steamTrain never tried
 *      steam-locomotive;
 *   2. every <path> element was indexed separately, so a two-path source (a coaster track
 *      plus its car) could not match one combined motif - coasterLoop read 0.246 against
 *      art it matches at 0.998 once unioned;
 *   3. a prefilter on vertex count excluded true matches, because reserialising the same
 *      curve changes the count by far more than the window allowed.
 *
 * So this tool: searches by NAME across every library, always tries the UNION of an icon's
 * paths as well as each path alone, and applies no prefilter.
 *
 * Reading the score: it is filled-area overlap after normalising both shapes into the same
 * box, so it is invariant to scale and position. >0.99 on a COMPLEX shape (say 100+ path
 * numbers) means the same artwork. On a simple shape it means little - any two rounded
 * blocks overlap ~0.95 - so the vertex count is printed beside every score. And overlap is
 * blind to welding: a welded variant scores 1.000 against its original, because sealing the
 * gaps does not change the filled union.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const [, , KEY, ...TERMS] = process.argv;
if (!KEY) {
  console.error('usage: node verify/trace.js <motifKey> <search-term> [...]');
  process.exit(2);
}

const spec = path.resolve(__dirname, '..');
const mdir = path.join(spec, 'motifs');
const TMP = process.env.TEMP || process.env.TMPDIR || '/tmp';

/* Corpora are downloaded on demand and live outside the repo; absent ones are skipped. */
const REPOS = {
  'game-icons': path.join(TMP, 'gi', 'icons-master'),
  temaki: path.join(TMP, 'lib-temaki'),
  lucide: path.join(TMP, 'lib-lucide'),
  maki: path.join(TMP, 'lib-maki'),
};
const ICONIFY = path.join(TMP, 'iconify');

const motifJs = fs.readFileSync(path.join(mdir, 'motif-paths.js'), 'utf8');
const frame = fs.readFileSync(path.join(spec, 'pin-frame-sample.html'), 'utf8');
const tag = frame.match(/<script>\n\/\* =+\n   FRAME SYSTEM[\s\S]*?<\/script>/)[0]
  .replace(/^<script>/, '').replace(/<\/script>$/, '');
const T = new Function('window', 'document', motifJs + '\n' + tag +
  ';return {toPolys:toPolys,insideNonZero:insideNonZero,pathBBox:pathBBox};')(
  {}, { getElementById(){ return { set innerHTML(v){}, get innerHTML(){return '';},
        set textContent(v){}, get textContent(){return '';} }; } });

const N = 128;
function mask(d) {
  let polys, bb;
  try { polys = T.toPolys(d); bb = T.pathBBox(d); } catch (e) { return null; }
  const s = Math.max(bb.w, bb.h);
  if (!(s > 0)) return null;
  const ox = bb.minX - (s - bb.w) / 2, oy = bb.minY - (s - bb.h) / 2;
  const m = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
    if (T.insideNonZero(polys, ox + (i + 0.5) * s / N, oy + (j + 0.5) * s / N)) m[j * N + i] = 1;
  return m;
}
const iou = (a, b) => { let s = 0, u = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i], y = b[i]; if (x || y) u++; if (x && y) s++; }
  return u ? s / u : 0; };
const numCount = d => (String(d).match(/-?\d*\.?\d+/g) || []).length;

/* ---- our motif, resolved the way the catalogue resolves it ---- */
const sb = { window: {} }; vm.runInNewContext(motifJs, sb);
const html = fs.readFileSync(path.join(spec, 'pin-catalog-mockup.html'), 'utf8');
const im = html.match(/const MOTIFS = Object\.assign\(\{\}, window\.MOTIF_LIB \|\| \{\}, (\{[\s\S]*?\n\})\);/);
const isb = {}; if (im) vm.runInNewContext('var I = ' + im[1], isb);
const MOTIFS = Object.assign({}, sb.window.MOTIF_LIB, isb.I || {});
const ours = String(MOTIFS[KEY] || '');
if (!ours) { console.error('no motif called ' + KEY); process.exit(2); }
const om = mask(ours);
if (!om) { console.error(KEY + ' could not be rasterised'); process.exit(2); }

/* ---- candidates by name, each icon contributing its paths AND their union ---- */
const re = TERMS.length ? new RegExp(TERMS.join('|'), 'i') : /.*/;
const cands = [];
const addIcon = (label, ds) => {
  ds.forEach((d, i) => cands.push({ label: label + (ds.length > 1 ? '#' + i : ''), d }));
  if (ds.length > 1) {
    cands.push({ label: label + ' [UNION]', d: ds.join(' ') });
    cands.push({ label: label + ' [UNION minus path0]', d: ds.slice(1).join(' ') });
  }
};
function walk(p, acc) { if (!fs.existsSync(p)) return acc;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name);
    if (e.isDirectory()) walk(f, acc); else if (e.name.endsWith('.svg')) acc.push(f); } return acc; }
let libsSeen = 0;
for (const [lib, root] of Object.entries(REPOS)) {
  if (!fs.existsSync(root)) continue;
  libsSeen++;
  walk(root, []).forEach(f => {
    const nm = path.basename(f, '.svg');
    if (!re.test(nm)) return;
    const t = fs.readFileSync(f, 'utf8');
    addIcon(lib + ':' + nm, [...t.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(m => m[1]));
  });
}
if (fs.existsSync(ICONIFY)) for (const f of fs.readdirSync(ICONIFY)) {
  if (!f.endsWith('.json')) continue;
  let j; try { j = JSON.parse(fs.readFileSync(path.join(ICONIFY, f), 'utf8')); } catch (e) { continue; }
  libsSeen++;
  const pre = j.prefix || f.replace(/\.json$/, '');
  for (const [nm, ic] of Object.entries(j.icons || {})) {
    if (!re.test(nm)) continue;
    addIcon(pre + ':' + nm, [...(ic.body || '').matchAll(/\sd="([^"]+)"/g)].map(m => m[1]));
  }
}
/* the answer may already be sitting in motifs/ under another name */
walk(mdir, []).forEach(f => {
  const nm = path.basename(f, '.svg');
  if (!re.test(nm)) return;
  const t = fs.readFileSync(f, 'utf8');
  addIcon('LOCAL:' + nm, [...t.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(m => m[1]));
});

if (!libsSeen) {
  console.error('no corpora found under ' + TMP + '. Download them first, e.g.\n' +
    '  game-icons: https://codeload.github.com/game-icons/icons/tar.gz/refs/heads/master -> $TEMP/gi\n' +
    '  temaki:     https://codeload.github.com/ideditor/temaki/tar.gz/refs/heads/main    -> $TEMP/lib-temaki\n' +
    '  iconify:    https://raw.githubusercontent.com/iconify/icon-sets/master/json/<set>.json -> $TEMP/iconify/');
  process.exit(2);
}

console.log('tracing ' + KEY + '  (' + numCount(ours) + ' path numbers, ' + ours.length + ' chars)');
console.log('searching ' + libsSeen + ' libraries for names matching /' + re.source + '/');
console.log('candidate shapes (paths + unions): ' + cands.length + '\n');
if (!cands.length) { console.log('nothing matched those terms.'); process.exit(0); }

const scored = cands.map(c => { const m = mask(c.d);
    return m ? { v: iou(om, m), label: c.label, n: numCount(c.d) } : null; })
  .filter(Boolean).sort((a, b) => b.v - a.v).slice(0, 15);

const mine = numCount(ours);
console.log('  score  numbers  source');
scored.forEach(s => {
  const verdict = s.v > 0.99
    ? (mine >= 100 ? '   <-- SAME ARTWORK' : '   <-- high, but our shape is simple; not conclusive')
    : s.v > 0.9 ? '   <-- strong' : '';
  console.log('  ' + s.v.toFixed(3) + '  ' + String(s.n).padStart(7) + '  ' + s.label + verdict);
});
const top = scored[0];
console.log('\n' + (top.v > 0.99 && mine >= 100
  ? 'CONFIRMED: ' + KEY + ' is ' + top.label.replace(/ \[UNION.*/, '') + '. Record it in CREDITS.md.'
  : top.v > 0.99
  ? 'High overlap but ' + KEY + ' has only ' + mine + ' path numbers, so overlap alone cannot ' +
    'settle it - simple shapes overlap by default. Compare them by eye.'
  : 'NOT CONFIRMED. Best overlap ' + top.v.toFixed(3) + '. Either the source is not in these ' +
    'libraries, or it was modified enough that area overlap no longer sees it.'));
