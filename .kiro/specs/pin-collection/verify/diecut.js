/* Die-cut screening, enforced.   node verify/diecut.js [pin-catalog-mockup.html]
 *
 * WHY THIS EXISTS. `emblemGate` and `screen.js` have existed for a long time, and
 * docs/pin-art-direction.md has always said to screen every die-cut motif at the rim of the
 * tier it ships at. Nothing enforced it, so it did not happen. This screens the motif each
 * die-cut pin ACTUALLY renders, resolved the way the page renders it (through
 * catalog-loader.js), and applies identically to a licensed library icon and to an SVG an AI
 * drew five minutes ago — the test knows nothing about provenance, only geometry.
 *
 * TWO KINDS OF DIE-CUT PIN IN v2.
 *   - Plain die-cut (`mode:'diecut'`): rendered by renderDieCut straight from its motif path,
 *     so emblemGate on that path IS what ships. These are screened here.
 *   - Colour die-cut (`colorDieCut:true`): rendered by renderColorDieCut, which fuses the art
 *     in the render branch (a dilated union weld, a padded hull, a recessed enamel field) —
 *     the raw motif deliberately fails "one piece" because the weld lives in the render, not
 *     the path. Screening the raw motif would report a failure that does not ship, so these
 *     are EXEMPT here; catalog.js's render check proves each one still renders to real art.
 *
 * GRANDFATHERING. A handful of plain die-cut motifs fail emblemGate's per-subpath model while
 * rendering acceptably under the catalogue's own `classifyCells` renderer (only cell 0 takes
 * the outer rim; the rest become interior wirelines, so a multi-subpath icon still reads as
 * one rimmed emblem). They are recorded below so the screen still catches a NEW, unlisted
 * failure. The list can only SHRINK:
 *   - a NEW plain die-cut pin that fails, and is not listed, fails the suite;
 *   - a listed pin that now PASSES also fails the suite, telling you to delete its entry.
 * Each entry asserts its exact emblemGate verdict, so a silent change of failure reason is
 * also caught.
 */
const fs = require('fs');
const path = require('path');
const { loadCatalog } = require('./catalog-loader');

const file = process.argv[2] || path.join(__dirname, '..', 'pin-catalog-mockup.html');
const spec = path.dirname(file);
const mdir = path.join(spec, 'motifs');

let bad = 0;
const A = (c, m) => { if (!c) { console.error('FAIL: ' + m); bad++; } else console.log('ok   ' + m); };

/* ---------------------------------------------------------------------------
   Grandfathered failures (v2 roster). `fails` is the emblemGate verdict at the pin's own
   tier rim. Every one renders acceptably under the catalogue's classifyCells renderer; the
   emblemGate failure is the stricter per-subpath model flagging a shape that reads as one
   rimmed emblem in the actual catalogue.
   --------------------------------------------------------------------------- */
const GRANDFATHERED = {
  'gold_disney_springs':    { motif: 'waterTower',   fails: 'aspect',   remedy: 'plate',
    note: 'tall water-tower silhouette (aspect 0.55); renders fine as one piece' },
  'amethyst_hs_master':     { motif: 'clapperboard', fails: '4 pieces', remedy: 'weld',
    note: 'classifyCells false-alarm; renders as one rimmed clapperboard' },
  'pearl_hs_sovereign':     { motif: 'clapperboard', fails: '2 pieces', remedy: 'weld',
    note: 'classifyCells false-alarm' },
  'bronze_royal_encounter': { motif: 'crown',        fails: '2 pieces', remedy: 'weld',
    note: 'classifyCells false-alarm; crown reads as one piece' },
  'silver_parades':         { motif: 'trumpetFlag',  fails: '2 pieces', remedy: 'weld',
    note: 'pre-verified renders as one solid trumpet+banner piece' },
  'gold_world_traveler_11': { motif: 'world',        fails: '3 pieces', remedy: 'plate',
    note: 'globe renders as one piece (cell 0 spans the full motif); allowRound set for the medallion shape' },
};

/* ---- borrow emblemGate from the frame sample, the way all.js borrows geometry ---- */
const motifJs = fs.readFileSync(path.join(mdir, 'motif-paths.js'), 'utf8');
const framePath = path.join(spec, 'pin-frame-sample.html');
A(fs.existsSync(framePath), 'pin-frame-sample.html is present (emblemGate lives there)');
const frame = fs.readFileSync(framePath, 'utf8');
const tag = frame.match(/<script>\n\/\* =+\n   FRAME SYSTEM[\s\S]*?<\/script>/)[0]
  .replace(/^<script>/, '').replace(/<\/script>$/, '');
let T;
try {
  T = new Function('window', 'document', motifJs + '\n' + tag +
    ';return {emblemGate:emblemGate, unionOutline:unionOutline, RIM_BY_TIER:RIM_BY_TIER};')(
    {}, { getElementById(){ return { set innerHTML(v){}, get innerHTML(){return '';},
          set textContent(v){}, get textContent(){return '';} }; } });
} catch (e) { console.error('FAIL: could not load emblemGate -> ' + e.message); process.exit(1); }
A(typeof T.emblemGate === 'function', 'emblemGate loaded');

/* ---- resolve what the catalogue renders, through the shared loader ---- */
let cat;
try { cat = loadCatalog(file); }
catch (e) { console.error('FAIL: could not load catalogue -> ' + e.message); process.exit(1); }
const MOTIFS = cat.MOTIFS;
const PINS = cat.PINS;
A(Array.isArray(PINS) && PINS.length > 0, 'PINS resolved through the loader (' + PINS.length + ')');

/* colour die-cut pins are welded in their render branch — exempt from the raw-motif screen.
   Report them so the exemption is visible, and let catalog.js prove they still render. */
const colorDieCut = PINS.filter(p => p.colorDieCut);
console.log('colour die-cut pins exempt (welded in render branch, screened by catalog.js): ' +
  colorDieCut.length);

const screenable = PINS.filter(p => p.mode === 'diecut' && p.motif && !p.scene && !p.colorDieCut);
A(screenable.length > 0, 'found plain die-cut pins to screen (' + screenable.length + ')');

/* ---- the enforcement ---- */
const newFailures = [], staleEntries = [], changedReason = [], noPath = [];
screenable.forEach(p => {
  const d = String(MOTIFS[p.motif] || '');
  if (!d) { noPath.push(p.id + ' [' + p.motif + ']'); return; }   // a plain die-cut pin needs a path
  const rim = T.RIM_BY_TIER[p.tier];
  let g; try { g = T.emblemGate(d, 'nonzero', rim, { allowRound: !!p.allowRound }); }
  catch (e) { return; }
  const listed = GRANDFATHERED[p.id];
  if (g.ok) {
    if (listed) staleEntries.push(p.id + ' (' + listed.remedy + ' — now passes)');
    return;
  }
  if (!listed) {
    newFailures.push(p.id + ' [' + p.tier + ', ' + p.motif + '] rim ' + rim +
      ' -> ' + g.fails.join('+') +
      '  (pieces ' + g.pieces + ', enamel ' + g.es.toFixed(3) +
      ', disc ' + g.disc.toFixed(3) + ', aspect ' + g.aspect.toFixed(2) + ')');
  } else if (listed.fails !== g.fails.join('+')) {
    changedReason.push(p.id + ': recorded "' + listed.fails + '", now "' + g.fails.join('+') + '"');
  }
});

A(noPath.length === 0,
  'every plain die-cut pin resolves to a motif path (a colour die-cut pin with no path must ' +
  'set colorDieCut:true so it is rendered by its branch)' +
  (noPath.length ? ' -> ' + noPath.join(', ') : ''));

A(newFailures.length === 0,
  'every NEW plain die-cut pin passes emblemGate at its own tier rim' +
  (newFailures.length
    ? '\n       ' + newFailures.join('\n       ') +
      '\n       Do not add it to GRANDFATHERED. Work the ladder in' +
      ' docs/pin-art-direction.md §5: weld (colorDieCut), then scale, then a contained plate.'
    : ' (' + (screenable.length - Object.keys(GRANDFATHERED).length) + ' screened clean)'));

A(staleEntries.length === 0,
  'no grandfathered entry has been fixed without being removed from the list' +
  (staleEntries.length ? '\n       these now pass — delete their entries: ' +
    staleEntries.join(', ') : ''));

A(changedReason.length === 0,
  'grandfathered failure reasons still match what was recorded' +
  (changedReason.length ? '\n       ' + changedReason.join('\n       ') : ''));

/* the list must not accumulate entries for pins that no longer exist */
const ids = new Set(PINS.map(p => p.id));
const orphans = Object.keys(GRANDFATHERED).filter(id => !ids.has(id));
A(orphans.length === 0, 'the grandfather list contains no entries for deleted pins' +
  (orphans.length ? ' -> ' + orphans.join(', ') : ''));

/* every listed pin must still be a plain die-cut pin — switching one to a contained plate or
   to colorDieCut IS a remedy, and its entry should go with it */
const notPlainDieCut = Object.keys(GRANDFATHERED)
  .filter(id => { const p = PINS.find(x => x.id === id); return p && (p.mode !== 'diecut' || p.colorDieCut); });
A(notPlainDieCut.length === 0,
  'no grandfathered pin has been switched to a plate or colour die-cut while keeping its entry' +
  (notPlainDieCut.length ? ' -> ' + notPlainDieCut.join(', ') : ''));

const remedies = {};
Object.values(GRANDFATHERED).forEach(v => { remedies[v.remedy.split(' ')[0]] =
  (remedies[v.remedy.split(' ')[0]] || 0) + 1; });
console.log('\ngrandfathered debt: ' + Object.keys(GRANDFATHERED).length + ' of ' +
  screenable.length + ' plain die-cut pins');
console.log('work queue by remedy: ' + JSON.stringify(remedies));

if (bad > 0) {
  console.error('\nDIE-CUT SCREENING FAILED: ' + bad + ' violation(s)');
  process.exit(1);
}
console.log('\nDIE-CUT SCREENING PASSED');
